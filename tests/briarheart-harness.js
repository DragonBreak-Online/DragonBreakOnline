// Scripted test for briarheart.js (Nat, 25 Oct: Briarhearts, design A1-A4). Loads the real module against stubs: characters
// with races, faiths, inventories and places; the rite (every refusal, success, a death under the knife, the cooldown, a
// death for good), the gifts (spells, health, resistances), the price (no Divine, the faith lock, fire, the heart torn out
// of a fallen Briarheart), the cure, staff grant / revoke, the login, the X menu, and the hooks the other modules carry.
// Run it from this folder's parent with
//
//   node tests\briarheart-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!c) fails++; };

// ---- the world ---------------------------------------------------------------------------------------------------------
const WORLD = '3c:Skyrim.esm', ELSE = '1a26f:Skyrim.esm';
const RACES = { 1: 'DBOReachmanRace', 2: 'NordRace', 3: 'DBOReachmanRaceVampire' };
const ID = { '5d009:Skyrim.esm': 0x5d009, '3ad61:Skyrim.esm': 0x3ad61, '2e504:Skyrim.esm': 0x2e504, '72317:Skyrim.esm': 0x72317, '400ad:Skyrim.esm': 0x400ad, '51b16:Skyrim.esm': 0x51b16, '3aea3:Skyrim.esm': 0x3aea3, '4359e:Skyrim.esm': 0x4359e, '43599:Skyrim.esm': 0x43599, '5d008:Skyrim.esm': 0x5d008, 'd8d50:Skyrim.esm': 0xd8d50, '90d63:unofficial skyrim special edition patch.esp': 0x7090d63 };
const HEART = 0x3ad61, GEM = 0x2e504;
// ARMO biped slots for the look, as the live load order has them: the two briar bodies in slot 35 (0x20, USSEP's), a cuirass
// the body (0x4), a helmet the head (0x1), an amulet slot 35 (0x20)
const BRIAR = 0x5d008, BRIAR_EMPTY = 0x5d009, CUIRASS = 0x13ed9, HELMET = 0x12e4d, AMULET = 0xc8911;
const WOUND = 0x7090d63, BRACERS = 0x13ec1, GREAVES = 0x6f398;   // USSEP's wound body (slot 32); a player's slot 34 and 38 pieces
const ROBE = 0x10cee5;   // a robe: clothing in the body slot (32)
const ARMOS = { [BRIAR]: 0x20, [BRIAR_EMPTY]: 0x20, [CUIRASS]: 0x4, [HELMET]: 0x1, [AMULET]: 0x20, [WOUND]: 0x4, [BRACERS]: 0x10, [GREAVES]: 0x100, [ROBE]: 0x4 };
const props = new Map();   // `${actor}|${prop}` -> value
const P = (a, k) => props.get(`${a >>> 0}|${k}`);
const setP = (a, k, v) => props.set(`${a >>> 0}|${k}`, v);
const papyrusCalls = []; const papyrusThrows = new Set();
const mp = {
  get: (a, k) => { const v = P(a, k); if (v === undefined && k === 'type') throw new Error('no actor'); return v === undefined ? null : JSON.parse(JSON.stringify(v)); },
  set: (a, k, v) => setP(a, k, v === null ? null : JSON.parse(JSON.stringify(v))),
  getIdFromDesc: (d) => ID[d] || 0,
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
  lookupEspmRecordById: (id) => (RACES[id] ? { record: { editorId: RACES[id] } } : ARMOS[id >>> 0] ? { record: { type: 'ARMO', editorId: 'armo', fields: [{ type: 'BOD2', data: new Uint8Array(new Uint32Array([ARMOS[id >>> 0], 2]).buffer) }] } } : { record: null }),
  // As the server does: a 'form' argument is looked up among world forms only, so a base record passed that way throws
  // "Form with id ... doesn't exist" (dev, 25 Oct: every spell, faction and armour call failed so). papyrusThrows names a
  // method the server refuses outright, for the failure-reporting checks
  callPapyrusFunction: (kind, cls, method, self, args) => {
    for (const x of args) if (x && x.type === 'form') throw new Error(`Form with id 0x${String(x.desc).split(':')[0]} doesn't exist`);
    if (papyrusThrows.has(method)) throw new Error(`${method} refused (test)`);
    papyrusCalls.push({ method, self: self.desc, args: args.map((x) => x.desc !== undefined ? x.desc : x), types: args.map((x) => (x && x.type) || typeof x) });
    return method === 'IsInFaction' ? true : undefined;
  },
};
const actor = (id, race, faith, pos, inv) => {
  setP(id, 'appearance', { raceId: race });
  setP(id, 'locationalData', { cellOrWorldDesc: WORLD, pos: pos || [0, 0, 0], rot: [0, 0, 0] });
  setP(id, 'inventory', { entries: inv || [] });
  faiths.set(id >>> 0, faith);
  return id >>> 0;
};
const faiths = new Map();
const TARRARE = 0x14, NORD = 0x15, HUNTER = 0x16, LEAD = 0x17, STAFFER = 0x18, VAMP = 0x19, CARRIER = 0x1a, ROLLED = 0x1b;
actor(TARRARE, 1, 'reach', [10, 0, 0], [{ baseId: HEART, count: 2 }]);
actor(NORD, 2, 'reach', [10, 0, 0], [{ baseId: HEART, count: 1 }]);
actor(HUNTER, 2, 'imperial', [10, 50, 0], []);
actor(LEAD, 2, 'imperial', [0, 0, 0], []);
actor(STAFFER, 1, 'reach', [0, 0, 0], [{ baseId: HEART, count: 1 }]);
actor(VAMP, 3, 'reach', [0, 0, 0], [{ baseId: HEART, count: 1 }]);
actor(CARRIER, 1, 'reach', [0, 0, 0], [{ baseId: HEART, count: 1 }]);
actor(ROLLED, 1, 'reach', [0, 0, 0], [{ baseId: HEART, count: 1 }]);
setP(VAMP, 'private.supernatural', { kind: 'vampire' });
setP(CARRIER, 'private.supernatural', { kind: null, disease: { kind: 'werewolf' } });
const online = [TARRARE, NORD, HUNTER, LEAD, STAFFER, VAMP, CARRIER, ROLLED];
const said = []; const audits = []; const given = []; const commands = new Map(); let ticker = null;
const downed = new Set(); const kills = []; const permas = []; const syncs = []; let duelers = new Set();
const shrines = new Map();
globalThis.__dboFaithIdOf = (a) => faiths.get(a >>> 0) || '';
globalThis.__dboSuperKind = (a) => (P(a, 'private.supernatural') || {}).kind || null;
globalThis.__dboIsStaff = (a) => (a >>> 0) === STAFFER;
globalThis.__dboIsDowned = (a) => downed.has(a >>> 0);
globalThis.__dboDownedKill = (t, by, why) => { kills.push({ t, by, why }); return true; };
globalThis.__dboPermaKill = (a, why) => { permas.push({ a, why }); setP(a, 'private.permaDead', true); };
globalThis.__dboCharLevelSyncBonus = (a) => syncs.push(a);
globalThis.__dboInDuel = (a) => duelers.has(a >>> 0);
globalThis.__dboPrayerLastShrine = shrines;
const RESIST = { 0x500: new Set([40]), 0x501: new Set([43]), 0x502: new Set([41]), 0x503: new Set() };

// The module writes briarheart.json beside the server (cwd): a scratch folder
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'briarheart-'));
const cwd = process.cwd(); process.chdir(scratch);
const MODULE = path.resolve(__dirname, '..', 'briarheart.js');
// The checks before the harder rite (26 Oct) keep its old bar unless a block asks for the shipped defaults (keepDefaults)
const oldBar = (cfg) => { const b = cfg && cfg.briarheart; if (!b || b.keepDefaults) return cfg; return Object.assign({}, cfg, { briarheart: Object.assign({ components: [], riteAt: 'any', failChance: 0.1, failCooldownHours: 24 }, b) }); };
const load = (cfg) => {
  cfg = oldBar(cfg);
  delete require.cache[MODULE]; delete globalThis.__dboBriarheart;
  return require(MODULE)({
    mp, log: () => {}, personal: (a, t) => said.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `who${(a >>> 0).toString(16)}`,
    display: (a) => `char${(a >>> 0).toString(16)}`, cfg, registerChatCommand: (n, f) => commands.set(n, f), onlineActors: () => online.slice(),
    isLeadStaff: (a) => (a >>> 0) === LEAD, findByName: (q) => ({ tarrare: TARRARE, nord: NORD, hunter: HUNTER })[String(q).trim().toLowerCase()] || 0,
    every: (n, ms, f) => { ticker = f; }, giveItem: (a, id, n) => given.push([a >>> 0, id, n]), sourceResistsOf: (id) => RESIST[id] || new Set(),
  });
};
const run = (a, args) => { said.length = 0; commands.get('briarheart')(a, args); return said.map(([, t]) => t).join(' | '); };
const inv = (a, id) => ((P(a, 'inventory') || {}).entries || []).filter((e) => e.baseId === id).reduce((n, e) => n + e.count, 0);
const realRandom = Math.random;
const setRandom = (v) => { Math.random = () => v; };

// ---- off ---------------------------------------------------------------------------------------------------------------
let M = load({});
ok(/not taking hearts/.test(run(TARRARE, 'rite')), 'off by default: the rite is refused');
ok(globalThis.__dboBriarheartTargetMult(HUNTER, TARRARE, 0x502) === 1 && !globalThis.__dboIsBriarheart(TARRARE), 'off: no hook does anything');

// ---- on: the altar, then every refusal ---------------------------------------------------------------------------------
const CFG = { briarheart: { enabled: true } };
M = load(CFG);
ok(/Usage/.test(run(TARRARE, 'altar add')), 'a player cannot place an altar');
ok(/The rite is made at a Hagraven altar/.test(run(TARRARE, 'rite')), 'no altar placed: refused');
ok(/altar 1 added here/.test(run(LEAD, 'altar add 300')), 'a Lead GM places an altar where they stand');
ok(M.data().altars.length === 1 && M.data().altars[0].radius === 300 && JSON.parse(fs.readFileSync('briarheart.json', 'utf8')).altars.length === 1, 'the altar is saved to briarheart.json');
ok(/only to the Reachfolk/.test(run(NORD, 'rite')), 'a Nord is refused (races)');
faiths.set(TARRARE, 'imperial');
ok(/Old Gods of the Reach/.test(run(TARRARE, 'rite')), 'a Reachman of another faith is refused (faiths)');
faiths.set(TARRARE, 'reach');
ok(/The dead have no heart/.test(run(VAMP, 'rite')), 'a vampire is refused');
ok(/A fever holds you/.test(run(CARRIER, 'rite')), 'a carrier of a fever is refused');
ok(/Staff take no rite/.test(run(STAFFER, 'rite')), 'a staff character is refused');
setP(TARRARE, 'locationalData', { cellOrWorldDesc: WORLD, pos: [1000, 0, 0], rot: [0, 0, 0] });
ok(/at a Hagraven altar/.test(run(TARRARE, 'rite')), 'outside the altar\'s radius: refused');
setP(TARRARE, 'locationalData', { cellOrWorldDesc: ELSE, pos: [10, 0, 0], rot: [0, 0, 0] });
ok(/at a Hagraven altar/.test(run(TARRARE, 'rite')), 'the same spot in another world: refused');
setP(TARRARE, 'locationalData', { cellOrWorldDesc: WORLD, pos: [10, 0, 0], rot: [0, 0, 0] });
ok(/Say \/briarheart confirm within 5 minutes/.test(run(TARRARE, 'rite')), 'a Reachman of the Old Gods at the altar with a heart is offered the rite');
ok(/nothing to confirm/.test(run(NORD, 'confirm')), 'confirm with nothing pending says so');

// ---- the rite works ------------------------------------------------------------------------------------------------------
papyrusCalls.length = 0; syncs.length = 0;
setRandom(0.99);
ok(/takes root/.test(run(TARRARE, 'confirm')), 'the rite: the briar takes');
ok(M.isBriar(TARRARE) && P(TARRARE, 'private.dboBriarheart').how === 'rite', 'the record is on the character');
ok(inv(TARRARE, HEART) === 1, 'one Briar Heart is spent');
ok(papyrusCalls.filter((c) => c.method === 'AddSpell').map((c) => c.args[0]).join() === '51b16:Skyrim.esm,3aea3:Skyrim.esm', 'Ironflesh and Lightning Cloak are given, the player\'s (51B16, 3AEA3), not the template\'s LeftHand pair', papyrusCalls);
ok(papyrusCalls.filter((c) => c.method === 'RemoveSpell').map((c) => c.args[0]).join() === '72317:Skyrim.esm,400ad:Skyrim.esm', 'and the LeftHand pair an earlier Briarheart learned is taken back', papyrusCalls);
ok(!papyrusCalls.some((c) => c.method === 'AddToFaction'), 'forswornFriendly is off: no faction');
ok(!papyrusCalls.some((c) => c.method === 'EquipItem') && !given.length, 'the visual is off: nothing worn or given');
ok(syncs.includes(TARRARE) && globalThis.__dboBriarheartVitalBonus(TARRARE).health === 50 && globalThis.__dboBriarheartVitalBonus(NORD).health === 0, '+50 health, sent at once');
ok(/already beats/.test(run(TARRARE, 'rite')), 'a second rite is refused');
ok(/has beaten in your chest since/.test(run(TARRARE, 'status')), '/briarheart says so');
ok(audits.some((t) => /took the briar heart/.test(t)), 'the rite is audited');

// ---- the gifts and the price -------------------------------------------------------------------------------------------
const tm = globalThis.__dboBriarheartTargetMult;
ok(Math.abs(tm(HUNTER, TARRARE, 0x500) - 0.85) < 1e-9, 'a poison spell hit: 15% less');
ok(Math.abs(tm(HUNTER, TARRARE, 0x501) - 0.85) < 1e-9, 'a frost spell hit: 15% less');
ok(Math.abs(tm(HUNTER, TARRARE, 0x502) - 1.25) < 1e-9, 'a fire spell hit: 25% more');
ok(tm(HUNTER, TARRARE, 0x503) === 1 && tm(TARRARE, TARRARE, 0x502) === 1 && tm(TARRARE, HUNTER, 0x502) === 1, 'a weapon, their own fire, and others: unchanged');
ok(/No Divine's blessing/.test(globalThis.__dboBriarheartRefusesDivine(TARRARE)) && globalThis.__dboBriarheartRefusesDivine(NORD) === '', 'no Divine blessing for a Briarheart only');
ok(/turn to no other/.test(globalThis.__dboBriarheartFaithLock(TARRARE)) && globalThis.__dboBriarheartFaithLock(NORD) === '', 'the faith is locked for a Briarheart only');

// ---- the knife, a cooldown, and death for good ----------------------------------------------------------------------------
setRandom(0.01);
setP(ROLLED, 'locationalData', { cellOrWorldDesc: WORLD, pos: [0, 0, 0], rot: [0, 0, 0] });
run(ROLLED, 'rite');
ok(/die on the altar, and wake again/.test(run(ROLLED, 'confirm')) && P(ROLLED, 'isDead') === true && !M.isBriar(ROLLED), 'under the knife at failChance: an ordinary death, no briar');
ok(inv(ROLLED, HEART) === 0, 'the heart is spent anyway');
setP(ROLLED, 'inventory', { entries: [{ baseId: HEART, count: 1 }] });
ok(/altar is cold to you/.test(run(ROLLED, 'rite')), 'the altar is cold for failCooldownHours');
M = load({ briarheart: { enabled: true, failPermadeath: true } }); M.data();
const DOOMED = actor(0x30, 1, 'reach', [0, 0, 0], [{ baseId: HEART, count: 1 }]); online.push(DOOMED);
run(DOOMED, 'rite');
ok(/This life is over/.test(run(DOOMED, 'confirm forever')) && permas.some((p) => p.a === DOOMED), 'failPermadeath: the death is for good');
setRandom(0.99);
M = load(CFG);

// ---- the heart torn out -------------------------------------------------------------------------------------------------
ok(globalThis.__dboBriarheartMenuEntries(HUNTER, TARRARE).length === 0, 'no X entry over a standing Briarheart');
said.length = 0; globalThis.__dboBriarheartMenuAction(HUNTER, 'briartear', TARRARE);
ok(/fallen Briarheart/.test(said.map(([, t]) => t).join()), 'tearing a standing Briarheart is refused');
downed.add(TARRARE);
ok(globalThis.__dboBriarheartMenuEntries(HUNTER, TARRARE).map((e) => e.label).join() === 'Tear out the heart', 'over a fallen Briarheart: "Tear out the heart"');
ok(globalThis.__dboBriarheartMenuEntries(STAFFER, TARRARE).length === 0, 'never offered to staff');
ok(globalThis.__dboBriarheartMenuEntries(HUNTER, NORD).length === 0, 'not over a mortal');
duelers = new Set([HUNTER]);
said.length = 0; globalThis.__dboBriarheartMenuAction(HUNTER, 'briartear', TARRARE);
ok(/Not in a duel/.test(said.map(([, t]) => t).join()), 'not in a duel');
duelers = new Set();
said.length = 0; globalThis.__dboBriarheartMenuAction(HUNTER, 'briartear', TARRARE);
ok(/Stay over them for 10 seconds/.test(said.map(([, t]) => t).join()) && said.some(([a, t]) => a === TARRARE && /reaches for the briar/.test(t)), 'the tear starts, and the Briarheart is told');
ticker();
ok(M.isBriar(TARRARE) && !kills.length, 'nothing happens before tearSeconds');
const tearAt = globalThis.__dboBriarheart.tears.get(HUNTER).at;
setP(HUNTER, 'locationalData', { cellOrWorldDesc: WORLD, pos: [900, 0, 0], rot: [0, 0, 0] });
ticker();
ok(!globalThis.__dboBriarheart.tears.has(HUNTER) && M.isBriar(TARRARE), 'the taker walks off: the tear is dropped');
setP(HUNTER, 'locationalData', { cellOrWorldDesc: WORLD, pos: [10, 50, 0], rot: [0, 0, 0] });
globalThis.__dboBriarheartMenuAction(HUNTER, 'briartear', TARRARE);
globalThis.__dboBriarheart.tears.get(HUNTER).at = Date.now() - 11000;
papyrusCalls.length = 0; given.length = 0;
ticker();
ok(!M.isBriar(TARRARE) && P(TARRARE, 'private.dboBriarheart') === null, 'after tearSeconds the Briarheart is one no more');
ok(kills.some((k) => k.t === TARRARE && k.by === HUNTER && /torn out/.test(k.why)), 'and dies at once (downed.js __dboDownedKill)');
ok(given.some(([a, id]) => a === HUNTER && id === HEART), 'the taker gets the Briar Heart');
ok(papyrusCalls.filter((c) => c.method === 'RemoveSpell').map((c) => c.args[0]).sort().join() === '3aea3:Skyrim.esm,400ad:Skyrim.esm,51b16:Skyrim.esm,72317:Skyrim.esm' && globalThis.__dboBriarheartVitalBonus(TARRARE).health === 0, 'the spells (and the retired LeftHand pair) and the health go with it');
ok(audits.some((t) => /tore the briar heart out of/.test(t)), 'audited');
ok(tearAt > 0, '(the tear kept its start time)');
downed.delete(TARRARE);

// ---- staff grant / revoke, login, the cure --------------------------------------------------------------------------------
ok(/Usage/.test(run(HUNTER, 'grant tarrare event')), 'a player cannot grant');
ok(/Give a reason/.test(run(LEAD, 'grant tarrare')), 'a grant needs a reason');
ok(/is a Briarheart\./.test(run(LEAD, 'grant tarrare Lore Master event')) && P(TARRARE, 'private.dboBriarheart').how === 'staff', 'a Lead GM makes a Briarheart, with a reason');
ok(audits.some((t) => /made who14 a Briarheart: Lore Master event/.test(t)), 'the grant and its reason are audited');
papyrusCalls.length = 0;
globalThis.__dboBriarheartLogin(TARRARE);
ok(papyrusCalls.filter((c) => c.method === 'AddSpell').length === 2, 'at login the spells come back');
ok(/touch one/.test(run(TARRARE, 'cure')), 'the cure needs a shrine of Arkay or Stendarr touched');
shrines.set(TARRARE, { deityId: 'talos', at: Date.now() });
ok(/touch one/.test(run(TARRARE, 'cure')), 'not at Talos');
shrines.set(TARRARE, { deityId: 'arkay', at: Date.now() });
ok(/filled black soul gem/.test(run(TARRARE, 'cure')), 'and a filled black soul gem');
setP(TARRARE, 'inventory', { entries: [{ baseId: GEM, count: 1 }] });
ok(/mortal again/.test(run(TARRARE, 'cure')) && !M.isBriar(TARRARE) && inv(TARRARE, GEM) === 0, 'cured at Arkay: the gem is spent, the briar withers');
run(LEAD, 'grant tarrare test');
ok(/no more/.test(run(LEAD, 'revoke tarrare test over')) && !M.isBriar(TARRARE), 'a Lead GM takes it away, with a reason');

// ---- the visual and the Forsworn, when switched on ----------------------------------------------------------------------
M = load({ briarheart: { enabled: true, forswornFriendly: true, visual: { enabled: true, armor: '5d008:Skyrim.esm' } } });
papyrusCalls.length = 0; given.length = 0;
M.become(NORD, 'staff', 'test');
ok(papyrusCalls.some((c) => c.method === 'AddToFaction' && c.args[0] === '43599:Skyrim.esm'), 'forswornFriendly: ForswornFaction through AddToFaction');
ok(given.some(([a, id]) => a === NORD && id === 0x5d008) && papyrusCalls.some((c) => c.method === 'EquipItem' && c.args[0] === '5d008:Skyrim.esm'), 'visual: the configured armour is given and worn');
M.end(NORD, 'test');
ok(papyrusCalls.some((c) => c.method === 'RemoveFromFaction'), 'and the faction goes at the end');


// ---- Nat's settings (25 Oct): both deaths for good, the Forsworn friendly, the visual empty -------------------------------
{
  const shipped = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'gamemode-config.json'), 'utf8')).briarheart;
  ok(shipped.failPermadeath === true && shipped.tearPermadeath === true && shipped.forswornFriendly === true, 'the shipped config: failPermadeath, tearPermadeath and forswornFriendly on');
  ok(shipped.visual && shipped.visual.enabled === true && shipped.visual.armor === '5d008:Skyrim.esm' && shipped.visual.emptyArmor === '5d009:Skyrim.esm' && shipped.visual.women === false, 'the shipped config: the vanilla briar body 05D008, the empty chest 05D009, men only');
  const logLines = [];
  delete require.cache[MODULE]; delete globalThis.__dboBriarheart;
  const M2 = require(MODULE)({
    mp, log: (...x) => logLines.push(x.join(' ')), personal: (a, t) => said.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `who${(a >>> 0).toString(16)}`,
    display: (a) => `char${(a >>> 0).toString(16)}`, cfg: { briarheart: Object.assign({}, shipped, { enabled: true }) }, registerChatCommand: (n, f) => commands.set(n, f), onlineActors: () => online.slice(),
    isLeadStaff: (a) => (a >>> 0) === LEAD, findByName: () => 0, every: (n, ms, f) => { ticker = f; }, giveItem: (a, id, n) => given.push([a >>> 0, id, n]), sourceResistsOf: (id) => RESIST[id] || new Set(),
  });
  M2.data().altars.push({ world: WORLD, pos: [0, 0, 0], radius: 400 });
  const NEWB = actor(0x40, 1, 'reach', [0, 0, 0], [{ baseId: HEART, count: 1 }]); online.push(NEWB);
  audits.length = 0;
  const offer = run(NEWB, 'rite');
  ok((offer.match(/PERMANENT DEATH/g) || []).length === 2, 'the rite names both permanent deaths in capitals', offer);
  ok(/die under the knife, and this character is gone for good/.test(offer) && /tears the briar out of you while you are down, this character is gone for good/.test(offer), '...the knife and the torn heart, each in plain words', offer);
  ok(/Say \/briarheart confirm forever within 5 minutes/.test(offer), '...and asks for /briarheart confirm forever', offer);
  ok(audits.some((t) => /asked for the rite and was warned \(rite death for good, heart torn out for good\)/.test(t)), 'staff see the warning in the audit', audits);
  const plain = run(NEWB, 'confirm');
  ok(/can end this character for good/.test(plain) && /PERMANENT DEATH/.test(plain) && /confirm forever/.test(plain), 'a plain confirm repeats the warning', plain);
  ok(globalThis.__dboBriarheart.pending.has(NEWB) && !M2.isBriar(NEWB) && inv(NEWB, HEART) === 1, '...and changes nothing: the rite still pending, the heart kept');
  setRandom(0.99); logLines.length = 0; papyrusCalls.length = 0;
  ok(/takes root/.test(run(NEWB, 'confirm forever')) && M2.isBriar(NEWB), '/briarheart confirm forever takes the rite');
  ok(audits.some((t) => /accepted the rite's risks \(rite death for good, heart torn out for good\)/.test(t)), 'staff see the acceptance in the audit');
  ok(papyrusCalls.some((c) => c.method === 'AddToFaction' && c.args[0] === '43599:Skyrim.esm') && papyrusCalls.some((c) => c.method === 'IsInFaction'), 'forswornFriendly: AddToFaction, then IsInFaction read back');
  ok(logLines.some((l) => /briarheart: faction AddToFaction 43599:Skyrim\.esm on char40 \(rite\); IsInFaction now true/.test(l)), 'the faction call is logged with the read-back, for the in-game check', logLines);
  ok(papyrusCalls.some((c) => c.method === 'EquipItem' && c.args[0] === '5d008:Skyrim.esm') && given.some(([a, id]) => a === NEWB && id === BRIAR), 'the shipped look: a bare chest gets the briar body at the rite');
  ok(/dies for good/.test(run(NEWB, 'status')), '/briarheart reminds a Briarheart what tearing means');
  logLines.length = 0;
  globalThis.__dboBriarheartLogin(NEWB);
  ok(logLines.some((l) => /faction AddToFaction .*\(login\)/.test(l)), 'at login the faction is applied again, and logged');
  downed.add(NEWB); said.length = 0; audits.length = 0; permas.length = 0; kills.length = 0;
  globalThis.__dboBriarheartMenuAction(HUNTER, 'briartear', NEWB);
  ok(said.some(([a, t]) => a === NEWB && /dies for good/.test(t)) && said.some(([a, t]) => a === HUNTER && /ends them for good/.test(t)), 'the tear warns both sides that it is for good', said);
  ok(audits.some((t) => /began to tear the briar heart out of who40 \(permadeath if it finishes\)/.test(t)), 'staff see the tear begin in the audit', audits);
  globalThis.__dboBriarheart.tears.get(HUNTER).at = Date.now() - 11000; logLines.length = 0;
  ticker();
  ok(permas.some((x) => x.a === NEWB && /torn out/.test(x.why)) && !kills.length && !M2.isBriar(NEWB), 'tearPermadeath: the heart torn out ends the character for good (no ordinary death)');
  ok(audits.some((t) => /tore the briar heart out of who40 \(for good\)/.test(t)), 'audited as for good');
  ok(logLines.some((l) => /faction RemoveFromFaction .*IsInFaction now true/.test(l)), 'the faction removal is logged too (the stub always answers true)');
  downed.delete(NEWB);
}

// ---- the look (Nat, 25 Oct): the vanilla briar body on a bare chest only ---------------------------------------------------
// (settleMs 0: these checks are the look's single steps; the equip spam block below drives the settling)
{
  const logLines = [];
  delete require.cache[MODULE]; delete globalThis.__dboBriarheart;
  const ML = require(MODULE)({
    mp, log: (...x) => logLines.push(x.join(' ')), personal: (a, t) => said.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `who${(a >>> 0).toString(16)}`,
    display: (a) => `char${(a >>> 0).toString(16)}`, cfg: { briarheart: { enabled: true, visual: { enabled: true, armor: '5d008:Skyrim.esm', emptyArmor: '5d009:Skyrim.esm', women: false, retrySeconds: 10, maxTries: 3, settleMs: 0 } } },
    registerChatCommand: (n, f) => commands.set(n, f), onlineActors: () => online.slice(), isLeadStaff: (a) => (a >>> 0) === LEAD, findByName: () => 0, every: (n, ms, f) => { ticker = f; },
    giveItem: (a, id, n) => { given.push([a >>> 0, id, n]); const e = ((P(a, 'inventory') || {}).entries || []).slice(); e.push({ baseId: id, count: n }); setP(a, 'inventory', { entries: e }); return true; }, sourceResistsOf: () => new Set(),
  });
  const MAN = actor(0x50, 1, 'reach', [0, 0, 0], [{ baseId: CUIRASS, count: 1 }]); online.push(MAN);
  const WOMAN = actor(0x51, 1, 'reach', [0, 0, 0], []); online.push(WOMAN); setP(WOMAN, 'appearance', { raceId: 1, isFemale: true });
  const eq = (...worn) => ({ inv: { entries: worn.map((id) => ({ baseId: id, count: 1, worn: true })) } });
  const look = globalThis.__dboBriarheartEquip;
  const lookCalls = () => papyrusCalls.filter((c) => c.method === 'EquipItem');
  const unequips = () => papyrusCalls.filter((c) => c.method === 'UnequipItem');
  // the grant with their own cuirass on (Nat, 25 Oct: "Briarhearts can't use chest armour"): it comes off into the pack
  setP(MAN, 'equipment', eq(CUIRASS)); papyrusCalls.length = 0; given.length = 0; logLines.length = 0; said.length = 0;
  ML.become(MAN, 'staff', 'test');
  ok(unequips().length === 1 && unequips()[0].args[0] === '13ed9:Skyrim.esm' && inv(MAN, CUIRASS) === 1, 'their own cuirass on at the grant: it is unequipped and stays in the pack', unequips());
  ok(said.some(([a, t]) => a === MAN && t === 'The briar in your chest will not be covered.'), '...they are told', said);
  ok(logLines.some((l) => /briarheart: chest cover refused on char50 \(staff\): 13ed9 unequipped, kept in the pack/.test(l)), '...logged', logLines);
  // the cuirass off: a bare chest gets the briar body
  setP(MAN, 'equipment', eq()); globalThis.__dboBriarheart.looks.delete(MAN); papyrusCalls.length = 0; given.length = 0; logLines.length = 0;
  look(MAN, eq());
  ok(lookCalls().some((c) => c.args[0] === '5d008:Skyrim.esm') && inv(MAN, BRIAR) === 1, 'a bare chest: the briar body (given at the grant) is equipped');
  ok(logLines.some((l) => /briarheart: look on char50 \(equipment\): bare chest, 5d008:Skyrim\.esm equipped \(try 1\)/.test(l)), '...and logged', logLines);
  papyrusCalls.length = 0; look(MAN, eq());
  ok(!lookCalls().length, 'a second report within retrySeconds does not equip again');
  // a helmet alone is still a bare chest
  globalThis.__dboBriarheart.looks.get(MAN).at = 0; papyrusCalls.length = 0;
  look(MAN, eq(HELMET));
  ok(lookCalls().length === 1, 'a helmet alone is still a bare chest');
  // the briar body shows in the equipment: done
  papyrusCalls.length = 0; look(MAN, eq(BRIAR, HELMET));
  ok(!lookCalls().length && !globalThis.__dboBriarheart.looks.has(MAN), 'the briar body worn: nothing more to do');
  // the cuirass put back on: it comes off again, the briar body stays theirs; within the minute nobody is told twice
  logLines.length = 0; papyrusCalls.length = 0; said.length = 0; look(MAN, eq(CUIRASS));
  ok(unequips().length === 1 && inv(MAN, CUIRASS) === 1 && inv(MAN, BRIAR) === 1, 'the cuirass put back on: unequipped again; the briar body is not taken');
  ok(!said.some(([a]) => a === MAN) && !logLines.some((l) => /chest cover refused/.test(l)), '...not told again within the minute');
  globalThis.__dboBriarheart.coverTold.set(MAN, Date.now() - 61000); said.length = 0; look(MAN, eq(CUIRASS));
  ok(said.filter(([a, t]) => a === MAN && /will not be covered/.test(t)).length === 1, '...a minute on: told again');
  // a robe in the body slot is refused the same way
  papyrusCalls.length = 0; look(MAN, eq(ROBE));
  ok(unequips().some((c) => c.args[0] === `${ROBE.toString(16)}:Skyrim.esm`), 'a robe (body slot) comes off too', unequips());
  // in a beast form the look is left alone (the race swap dresses the beast)
  setP(MAN, 'private.beast', { form: 'werewolf', original: { raceId: 1 } }); papyrusCalls.length = 0; look(MAN, eq(CUIRASS));
  ok(!papyrusCalls.length, 'in a beast form: nothing unequipped or equipped');
  setP(MAN, 'private.beast', null); globalThis.__dboBriarheart.looks.delete(MAN);
  // equips that never show stop after maxTries
  logLines.length = 0;
  for (let k = 0; k < 5; k++) { const L = globalThis.__dboBriarheart.looks.get(MAN); if (L) L.at = 0; look(MAN, eq()); }
  ok(logLines.filter((l) => /look on char50/.test(l)).length === 3 && logLines.some((l) => /look gave up on char50: 3 equips/.test(l)), 'an equip that never shows is tried maxTries times, then logged once', logLines);
  // a woman: the vanilla briar body has no female model
  papyrusCalls.length = 0; logLines.length = 0;
  ML.become(WOMAN, 'staff', 'test'); look(WOMAN, eq()); look(WOMAN, eq());
  ok(!lookCalls().length && logLines.filter((l) => /look skipped on char51: the vanilla briar body has no female model/.test(l)).length === 1, 'a woman gets no briar body (no MOD3), told once in the log', logLines);
  // the heart torn out with the briar body on: the empty chest
  globalThis.__dboBriarheart.looks.delete(MAN);
  setP(MAN, 'equipment', eq(BRIAR)); setP(MAN, 'inventory', { entries: [{ baseId: CUIRASS, count: 1 }, { baseId: BRIAR, count: 1 }] });
  downed.add(MAN); papyrusCalls.length = 0; logLines.length = 0; given.length = 0;
  setP(HUNTER, 'locationalData', { cellOrWorldDesc: WORLD, pos: [0, 30, 0], rot: [0, 0, 0] });
  globalThis.__dboBriarheartMenuAction(HUNTER, 'briartear', MAN);
  globalThis.__dboBriarheart.tears.get(HUNTER).at = Date.now() - 11000; ticker();
  ok(!ML.isBriar(MAN) && inv(MAN, BRIAR) === 0 && inv(MAN, BRIAR_EMPTY) === 1, 'the heart torn out: the briar body is gone, the empty chest given');
  ok(lookCalls().some((c) => c.args[0] === '5d009:Skyrim.esm') && logLines.some((l) => /look swap on char50: heart torn out, 5d008:Skyrim\.esm -> 5d009:Skyrim\.esm/.test(l)), '...equipped and logged', logLines);
  downed.delete(MAN);
  // the empty chest stays on the body after the end (it is worn); a living ex-Briarheart's unworn leftovers are cleared at login
  setP(MAN, 'equipment', eq(BRIAR_EMPTY)); logLines.length = 0; look(MAN, eq(BRIAR_EMPTY));
  ok(inv(MAN, BRIAR_EMPTY) === 1, 'the worn empty chest is left on the body');
  setP(MAN, 'equipment', eq(CUIRASS)); setP(MAN, 'inventory', { entries: [{ baseId: CUIRASS, count: 1 }, { baseId: BRIAR_EMPTY, count: 1 }, { baseId: BRIAR, count: 1 }] });
  globalThis.__dboBriarheartLogin(MAN);
  ok(inv(MAN, BRIAR) === 0 && inv(MAN, BRIAR_EMPTY) === 0 && logLines.some((l) => /look cleared on char50 \(login\): 2 briar pieces taken, not a Briarheart/.test(l)), 'not a Briarheart at login: leftover briar bodies are taken', logLines);
  // the cure takes the briar body
  ML.become(MAN, 'staff', 'again'); setP(MAN, 'equipment', eq()); globalThis.__dboBriarheart.looks.delete(MAN); look(MAN, eq());
  ok(inv(MAN, BRIAR) === 1, '(a Briarheart again, bare chest: briar body given)');
  ML.end(MAN, 'cured in the test');
  ok(inv(MAN, BRIAR) === 0, 'the end (a cure, a revoke) takes the briar body');
  ok(/__dboBriarheartEquip\(a, equipment\)/.test(fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8')), 'gamemode.js equipHook asks briarheart.js on every equipment report');
  // the login's naked reports: no briar body until the re-dress has settled
  ML.become(MAN, 'staff', 'login test'); globalThis.__dboBriarheart.looks.delete(MAN);
  globalThis.__dboConnectedAt = new Map([[MAN, Date.now() - 2000]]); papyrusCalls.length = 0;
  look(MAN, eq());
  ok(!lookCalls().length, 'within 15 s of connecting (the login re-dress): no briar body yet');
  globalThis.__dboConnectedAt.set(MAN, Date.now() - 16000);
  look(MAN, eq());
  ok(lookCalls().length === 1, 'after it: a bare chest gets it');
  delete globalThis.__dboConnectedAt; ML.end(MAN, 'login test done');
  // an amulet shares the briar body's slot 35 and the briar chest wins (Nat, 25 Oct): on a bare chest the amulet comes off,
  // stays in the pack, the player is told once a minute at most, and the briar body goes on
  ML.become(MAN, 'staff', 'amulet test'); globalThis.__dboBriarheart.looks.delete(MAN);
  setP(MAN, 'inventory', { entries: [{ baseId: AMULET, count: 1 }] }); papyrusCalls.length = 0; logLines.length = 0; said.length = 0;
  look(MAN, eq(AMULET));
  ok(unequips().length === 1 && unequips()[0].args[0] === 'c8911:Skyrim.esm' && unequips()[0].args[1] === false, 'a bare chest with an amulet: the amulet is unequipped', unequips());
  ok(inv(MAN, AMULET) === 1, '...and stays in the pack');
  ok(said.some(([a, t]) => a === MAN && t === 'Your briar heart leaves no room for an amulet. It stays in your pack.'), '...the player is told', said);
  ok(logLines.some((l) => /briarheart: amulet refused on char50 \(equipment\): c8911 unequipped, kept in the pack/.test(l)), '...logged', logLines);
  ok(lookCalls().some((c) => c.args[0] === '5d008:Skyrim.esm'), '...and the briar chest goes on in its slot');
  // put back on at once, five times: unequipped each time, told and logged once
  said.length = 0; logLines.length = 0; papyrusCalls.length = 0;
  for (let k = 0; k < 5; k++) { const L = globalThis.__dboBriarheart.looks.get(MAN); if (L) L.at = 0; look(MAN, eq(AMULET)); }
  ok(unequips().length === 5 && !said.some(([a]) => a === MAN) && !logLines.some((l) => /amulet refused/.test(l)), 'put back five times within the minute: unequipped each time, no second message or log line');
  globalThis.__dboBriarheart.amuletTold.set(MAN, Date.now() - 61000); look(MAN, eq(AMULET));
  ok(said.filter(([a]) => a === MAN).length === 1, 'a minute on: told again');
  // body armour no longer opens the amulet: both come off
  papyrusCalls.length = 0; said.length = 0; look(MAN, eq(CUIRASS, AMULET));
  ok(unequips().map((c) => c.args[0]).sort().join() === '13ed9:Skyrim.esm,c8911:Skyrim.esm', 'a cuirass and an amulet: both come off (the chest is never covered)', unequips());
  ML.end(MAN, 'amulet test done');
}

// ---- the briar skin (Nat, 25 Oct): armour as a Forsworn cuirass, stamina, DiseaseResist, only while the briar chest shows ----
{
  const logLines = [];
  const loadSkin = (skin) => {
    delete require.cache[MODULE]; delete globalThis.__dboBriarheart;
    return require(MODULE)({
      mp, log: (...x) => logLines.push(x.join(' ')), personal: (a, t) => said.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `who${(a >>> 0).toString(16)}`,
      display: (a) => `char${(a >>> 0).toString(16)}`, cfg: { briarheart: { enabled: true, visual: { enabled: true, armor: '5d008:Skyrim.esm', emptyArmor: '5d009:Skyrim.esm' }, briarSkin: skin } },
      registerChatCommand: (n, f) => commands.set(n, f), onlineActors: () => online.slice(), isLeadStaff: (a) => (a >>> 0) === LEAD, findByName: () => 0, every: (n, ms, f) => { ticker = f; },
      giveItem: (a, id, n) => { const e = ((P(a, 'inventory') || {}).entries || []).slice(); e.push({ baseId: id, count: n }); setP(a, 'inventory', { entries: e }); return true; }, sourceResistsOf: () => new Set(),
    });
  };
  const SKIN = { enabled: true, armor: 38, staminaRegen: 1.25, diseaseResist: 50 };
  const MS = loadSkin(SKIN);
  globalThis.__dboBriarSkinRating = () => 33;   // gamemode.js's: the light faction cuirass 38 less the briar body's 5, no multipliers
  const BH = actor(0x60, 1, 'reach', [0, 0, 0], []); online.push(BH);
  const eq = (...worn) => ({ inv: { entries: worn.map((id) => ({ baseId: id, count: 1, worn: true })) } });
  const report = globalThis.__dboBriarheartEquip;
  const avCalls = () => papyrusCalls.filter((c) => c.method === 'SetActorValue');
  setP(BH, 'equipment', eq()); MS.become(BH, 'staff', 'skin test');
  ok(globalThis.__dboBriarSkinArmor(BH) === null && globalThis.__dboBriarRegenMult(BH, 'stamina') === 1, 'a bare chest before the briar body shows: no skin yet (it waits for the equipment to show it)');
  papyrusCalls.length = 0; logLines.length = 0;
  report(BH, eq(BRIAR, HELMET));
  const s = globalThis.__dboBriarSkinArmor(BH);
  ok(s && s.rating === 38 && !s.from && s.shown === BRIAR, 'the briar chest shows: the skin counts as a light faction cuirass (38), over the briar body', s);
  ok(globalThis.__dboBriarRegenMult(BH, 'stamina') === 1.25 && globalThis.__dboBriarRegenMult(BH, 'magicka') === 1 && globalThis.__dboBriarRegenMult(BH, 'health') === 1, 'stamina regeneration x1.25, and nothing else');
  ok(avCalls().length === 1 && avCalls()[0].args[0] === 'DiseaseResist' && avCalls()[0].args[1] === 50, 'DiseaseResist 50 is sent through the server Papyrus', avCalls());
  ok(logLines.some((l) => /briarheart: skin on char60 \(equipment\): armour as a faction cuirass \(38\) \(\+33\.0 over the briar pieces\), stamina regeneration x1\.25, DiseaseResist 50/.test(l)), '...and logged', logLines);
  papyrusCalls.length = 0; logLines.length = 0; report(BH, eq(BRIAR));
  ok(!avCalls().length && !logLines.some((l) => /skin/.test(l)), 'a second report: no repeat, no second SetActorValue');
  // a cuirass reported worn (being taken off) never stacks with the skin: off until the bare chest is reported again
  report(BH, eq(BRIAR, CUIRASS));
  ok(globalThis.__dboBriarSkinArmor(BH) === null && globalThis.__dboBriarRegenMult(BH, 'stamina') === 1, 'a cuirass reported worn: the skin is off meanwhile (never both)');
  ok(papyrusCalls.some((c) => c.method === 'UnequipItem' && c.args[0] === '13ed9:Skyrim.esm'), '...and the cuirass is unequipped');
  ok(avCalls().length === 1 && avCalls()[0].args[1] === 0 && logLines.some((l) => /briarheart: skin off char60 \(equipment\), DiseaseResist 0/.test(l)), '...DiseaseResist back to 0, logged', logLines);
  report(BH, eq(BRIAR));
  ok(!!globalThis.__dboBriarSkinArmor(BH), 'the cuirass gone and the briar chest reported: the skin is on again');
  // a new client: the skin turns on afresh at login, so DiseaseResist reaches the new engine
  papyrusCalls.length = 0; setP(BH, 'equipment', eq(BRIAR)); globalThis.__dboBriarheartLogin(BH);
  ok(avCalls().some((c) => c.args[1] === 50), 'login: DiseaseResist is sent again to the new client', avCalls());
  papyrusCalls.length = 0; logLines.length = 0; MS.end(BH, 'skin test done');
  ok(globalThis.__dboBriarSkinArmor(BH) === null && avCalls().some((c) => c.args[1] === 0) && logLines.some((l) => /skin off char60/.test(l)), 'no longer a Briarheart: the skin is off', logLines);
  // a woman shows no briar chest (visual.women false), so no skin; briarSkin off gives nothing
  const BW = actor(0x61, 1, 'reach', [0, 0, 0], []); online.push(BW); setP(BW, 'appearance', { raceId: 1, isFemale: true });
  MS.become(BW, 'staff', 'woman'); report(BW, eq(BRIAR));
  ok(globalThis.__dboBriarSkinArmor(BW) === null, 'a woman (no briar chest shown): no skin');
  loadSkin(Object.assign({}, SKIN, { enabled: false })); MS.become(BH, 'staff', 'off test'); globalThis.__dboBriarheartEquip(BH, eq(BRIAR));
  ok(globalThis.__dboBriarSkinArmor(BH) === null && globalThis.__dboBriarRegenMult(BH, 'stamina') === 1, 'briarSkin off: nothing');
  // no rating of its own: the cuirass armorFrom names is counted instead (the earlier setting)
  loadSkin({ enabled: true, armor: 0, armorFrom: 'd8d50:Skyrim.esm', staminaRegen: 1.25, diseaseResist: 0 }); globalThis.__dboBriarheartEquip(BH, eq(BRIAR));
  const old = globalThis.__dboBriarSkinArmor(BH);
  ok(old && old.from === 0xd8d50 && !old.rating, 'armor 0 with armorFrom: the named cuirass counts', old);
  delete globalThis.__dboBriarSkinRating;
  // the arithmetic gamemode.js does: a bare-chested Briarheart's hit lands as a light faction cuirass wearer's would
  const scale = 0.12, cap = 80, kept = (r) => 1 - Math.min(r * scale, cap) / 100;
  ok(Math.abs(kept(5) * (kept(5 + 33) / kept(5)) - kept(38)) < 1e-12, 'the skin\'s factor on top of the engine\'s briar-body 5 equals a worn light faction cuirass (38)');
}
// ---- the server's Papyrus takes base records as 'espm', and a refused call is reported as refused (dev, 25 Oct) ------------
{
  const logLines = [];
  delete require.cache[MODULE]; delete globalThis.__dboBriarheart;
  const MP = require(MODULE)({
    mp, log: (...x) => logLines.push(x.join(' ')), personal: (a, t) => said.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `who${(a >>> 0).toString(16)}`,
    display: (a) => `char${(a >>> 0).toString(16)}`, cfg: { briarheart: { enabled: true, forswornFriendly: true, visual: { enabled: true, armor: '5d008:Skyrim.esm', emptyArmor: '5d009:Skyrim.esm' } } },
    registerChatCommand: (n, f) => commands.set(n, f), onlineActors: () => online.slice(), isLeadStaff: (a) => (a >>> 0) === LEAD, findByName: () => 0, every: (n, ms, f) => { ticker = f; },
    giveItem: (a, id, n) => { const e = ((P(a, 'inventory') || {}).entries || []).slice(); e.push({ baseId: id, count: n }); setP(a, 'inventory', { entries: e }); return true; }, sourceResistsOf: () => new Set(),
  });
  const PB = actor(0x70, 1, 'reach', [0, 0, 0], []); online.push(PB); setP(PB, 'equipment', { inv: { entries: [] } });
  papyrusCalls.length = 0; logLines.length = 0;
  MP.become(PB, 'staff', 'espm test');
  const byMethod = (m) => papyrusCalls.filter((c) => c.method === m);
  ok(byMethod('AddSpell').length === 2 && byMethod('AddSpell').every((c) => c.types[0] === 'espm'), 'the spells go to AddSpell as espm records (a form argument would throw, as live)', papyrusCalls);
  ok(byMethod('AddToFaction').length === 1 && byMethod('AddToFaction')[0].types[0] === 'espm' && byMethod('IsInFaction')[0].types[0] === 'espm', 'the faction goes as an espm record');
  ok(!logLines.some((l) => /failed/.test(l)), 'no Papyrus call failed', logLines.filter((l) => /failed/.test(l)));
  ok(byMethod('EquipItem').length === 1 && byMethod('EquipItem')[0].types[0] === 'espm' && logLines.some((l) => /look on char70 \((staff|equipment)\): bare chest, 5d008:Skyrim\.esm equipped/.test(l)), 'the briar body goes to EquipItem as an espm record, and the look says equipped', logLines);
  // the server refuses the equip: the look says so, never "equipped"
  papyrusThrows.add('EquipItem'); globalThis.__dboBriarheart.looks.delete(PB); logLines.length = 0;
  globalThis.__dboBriarheartEquip(PB, { inv: { entries: [] } });
  ok(logLines.some((l) => /look FAILED on char70 \(equipment\): EquipItem of 5d008:Skyrim\.esm refused by the server/.test(l)) && !logLines.some((l) => /equipped \(try/.test(l)), 'a refused EquipItem is logged as FAILED, never as equipped', logLines);
  papyrusThrows.clear(); MP.end(PB, 'espm test done');
}
// ---- the wound body (dev, 25 Oct): the heart alone shows nothing; USSEP's wound body goes on with it ----------------------
{
  const logLines = [];
  delete require.cache[MODULE]; delete globalThis.__dboBriarheart;
  const MW = require(MODULE)({
    mp, log: (...x) => logLines.push(x.join(' ')), personal: (a, t) => said.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `who${(a >>> 0).toString(16)}`,
    display: (a) => `char${(a >>> 0).toString(16)}`, cfg: { briarheart: { enabled: true, visual: { enabled: true, armor: '5d008:Skyrim.esm', emptyArmor: '5d009:Skyrim.esm', body: '90d63:unofficial skyrim special edition patch.esp', retrySeconds: 10, maxTries: 3 }, briarSkin: { enabled: true, armorFrom: 'd8d50:Skyrim.esm', staminaRegen: 1.25, diseaseResist: 0 } } },
    registerChatCommand: (n, f) => commands.set(n, f), onlineActors: () => online.slice(), isLeadStaff: (a) => (a >>> 0) === LEAD, findByName: () => 0, every: (n, ms, f) => { ticker = f; },
    giveItem: (a, id, n) => { const e = ((P(a, 'inventory') || {}).entries || []).slice(); e.push({ baseId: id, count: n }); setP(a, 'inventory', { entries: e }); return true; }, sourceResistsOf: () => new Set(),
  });
  const eq = (...worn) => ({ inv: { entries: worn.map((id) => ({ baseId: id, count: 1, worn: true })) } });
  const look = globalThis.__dboBriarheartEquip;
  const equips = () => papyrusCalls.filter((c) => c.method === 'EquipItem').map((c) => c.args[0]);
  const BW = actor(0x80, 1, 'reach', [0, 0, 0], [{ baseId: BRACERS, count: 1 }, { baseId: GREAVES, count: 1 }]); online.push(BW);
  setP(BW, 'equipment', eq(BRACERS, GREAVES)); papyrusCalls.length = 0; logLines.length = 0;
  MW.become(BW, 'staff', 'wound test');
  ok(equips().join() === '90d63:unofficial skyrim special edition patch.esp,5d008:Skyrim.esm', 'a bare chest: the wound body goes on, then the heart', equips());
  ok(inv(BW, WOUND) === 1 && inv(BW, BRIAR) === 1, '...both given');
  ok(logLines.some((l) => /look on char80 \(staff\): bare chest, 90d63:unofficial skyrim special edition patch\.esp \+ 5d008:Skyrim\.esm equipped/.test(l)), '...and logged as both equipped', logLines);
  // bracers (34) and greaves (38) share no ARMO slot with the wound body (32): nothing of the player's is unequipped or taken
  ok(!papyrusCalls.some((c) => c.method === 'UnequipItem') && inv(BW, BRACERS) === 1 && inv(BW, GREAVES) === 1, 'the player\'s bracers and greaves (slots 34, 38) are neither unequipped nor taken', papyrusCalls);
  // both worn: done, and the skin is on (the wound body is ours, not body armour)
  papyrusCalls.length = 0; look(BW, eq(WOUND, BRIAR, BRACERS, GREAVES));
  ok(!equips().length && !!globalThis.__dboBriarSkinArmor(BW), 'both worn: nothing more to equip, and the briar skin counts the wound body as the briar chest, not as own armour');
  const sk = globalThis.__dboBriarSkinArmor(BW);
  ok(sk.body === WOUND && sk.shown === BRIAR, 'the skin tells gamemode.js both pieces the engine already counts (heart 5 + wound 5)', sk);
  // only the heart worn (the wound slipped): the wound body goes back on, the heart is not equipped twice
  globalThis.__dboBriarheart.looks.delete(BW); papyrusCalls.length = 0; look(BW, eq(BRIAR, BRACERS, GREAVES));
  ok(equips().join() === '90d63:unofficial skyrim special edition patch.esp', 'the heart worn but not the wound: only the wound body is equipped', equips());
  // own body armour put on: only the cuirass comes off; the bracers and greaves stay worn, the briar pieces stay theirs
  setP(BW, 'inventory', { entries: [{ baseId: BRACERS, count: 1 }, { baseId: GREAVES, count: 1 }, { baseId: CUIRASS, count: 1 }, { baseId: WOUND, count: 1 }, { baseId: BRIAR, count: 1 }] });
  papyrusCalls.length = 0; logLines.length = 0; look(BW, eq(CUIRASS, BRACERS, GREAVES));
  const offs = papyrusCalls.filter((c) => c.method === 'UnequipItem').map((c) => c.args[0]);
  ok(offs.join() === '13ed9:Skyrim.esm' && inv(BW, WOUND) === 1 && inv(BW, BRIAR) === 1 && inv(BW, CUIRASS) === 1, 'a cuirass on: it alone is unequipped (kept in the pack); bracers and greaves stay on, the briar pieces stay', offs);
  ok(!globalThis.__dboBriarSkinArmor(BW), '...and the briar skin is off while the cuirass is reported worn');
  // the heart torn out: the empty chest replaces the heart, the wound body stays
  setP(BW, 'inventory', { entries: [{ baseId: WOUND, count: 1 }, { baseId: BRIAR, count: 1 }] }); setP(BW, 'equipment', eq(WOUND, BRIAR));
  downed.add(BW); globalThis.__dboIsDowned = (a) => downed.has(a >>> 0);
  papyrusCalls.length = 0; logLines.length = 0; said.length = 0;
  commands.get('briarheart')(HUNTER, ''); // keep the command map warm
  MW.startTear(HUNTER, BW); MW.tick();
  globalThis.__dboBriarheart.tears.forEach((j) => { j.at = 0; }); MW.tick();
  ok(inv(BW, BRIAR) === 0 && inv(BW, BRIAR_EMPTY) === 1 && inv(BW, WOUND) === 1 && equips().includes('5d009:Skyrim.esm'), 'the heart torn out: the empty chest goes on and the wound body is kept', { inv: P(BW, 'inventory'), eq: equips() });
  ok(logLines.some((l) => /look swap on char80: heart torn out, 5d008:Skyrim\.esm -> 5d009:Skyrim\.esm, the wound body 90d63:unofficial skyrim special edition patch\.esp kept/.test(l)), '...and logged', logLines);
  downed.delete(BW);
  // cured or revoked while alive (no empty chest worn): the wound body goes with the heart
  MW.become(BW, 'staff', 'cure test'); setP(BW, 'inventory', { entries: [{ baseId: WOUND, count: 1 }, { baseId: BRIAR, count: 1 }] }); setP(BW, 'equipment', eq(WOUND, BRIAR));
  MW.end(BW, 'cure test');
  ok(inv(BW, WOUND) === 0 && inv(BW, BRIAR) === 0, 'no longer a Briarheart, alive: the heart and the wound body both go', P(BW, 'inventory'));
}
// ---- equip spam (Nat's dev test, 26 Oct: "you can repeatedly press to equip a chest piece, then it bugs the form out") ------
// A fake clock and timers drive the settled look. Each press is two reports, as in the dev log: the piece worn over the heart
// (the wound body pushed out of slot 32), then the piece gone again after our UnequipItem
{
  const logLines = []; const realNow = Date.now, realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  let now = 1800000000000; const timers = new Map(); let seq = 0;
  Date.now = () => now;
  globalThis.setTimeout = (f, ms) => { const id = ++seq; timers.set(id, { at: now + ms, f }); return id; };
  globalThis.clearTimeout = (id) => { timers.delete(id); };
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((x, y) => x[1].at - y[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].at; due[1].f();
    }
    now = end;
  };
  const load = () => require(MODULE)({
    mp, log: (...x) => logLines.push(x.join(' ')), personal: (a, t) => said.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `who${(a >>> 0).toString(16)}`,
    display: (a) => `char${(a >>> 0).toString(16)}`, cfg: { briarheart: { enabled: true, visual: { enabled: true, armor: '5d008:Skyrim.esm', emptyArmor: '5d009:Skyrim.esm', body: '90d63:unofficial skyrim special edition patch.esp', retrySeconds: 10, maxTries: 5, settleMs: 1500 } } },
    registerChatCommand: (n, f) => commands.set(n, f), onlineActors: () => online.slice(), isLeadStaff: (a) => (a >>> 0) === LEAD, findByName: () => 0, every: (n, ms, f) => { ticker = f; },
    giveItem: (a, id, n) => { const e = ((P(a, 'inventory') || {}).entries || []).slice(); e.push({ baseId: id, count: n }); setP(a, 'inventory', { entries: e }); return true; }, sourceResistsOf: () => new Set(),
  });
  delete require.cache[MODULE]; delete globalThis.__dboBriarheart;
  const MX = load();
  const eq = (...worn) => ({ inv: { entries: worn.map((id) => ({ baseId: id, count: 1, worn: true })) } });
  const report = (a, ...worn) => { setP(a, 'equipment', eq(...worn)); globalThis.__dboBriarheartEquip(a, eq(...worn)); };
  const equips = () => papyrusCalls.filter((c) => c.method === 'EquipItem').map((c) => c.args[0]);
  const offs = () => papyrusCalls.filter((c) => c.method === 'UnequipItem').map((c) => c.args[0]);
  const SP = actor(0xa0, 1, 'reach', [0, 0, 0], [{ baseId: CUIRASS, count: 1 }]); online.push(SP);
  setP(SP, 'equipment', eq()); MX.become(SP, 'staff', 'spam test');
  report(SP, WOUND, BRIAR); advance(30000);
  // twenty presses, 300 ms apart
  papyrusCalls.length = 0; logLines.length = 0;
  for (let k = 0; k < 20; k++) { report(SP, CUIRASS, BRIAR); advance(150); report(SP, BRIAR); advance(150); }
  ok(offs().length === 20 && offs().every((d) => d === '13ed9:Skyrim.esm'), 'twenty presses of a cuirass: it is unequipped twenty times', offs());
  ok(!equips().length, 'while the presses keep coming, nothing is equipped (no crossing equips)', equips());
  ok(inv(SP, CUIRASS) === 1, '...the cuirass stays in the pack');
  advance(1500 - 300 - 10);
  ok(!equips().length, '...nor before the last refusal is settleMs old');
  advance(10);
  ok(equips().join() === '90d63:unofficial skyrim special edition patch.esp', 'settled: the wound body goes back on, once, without a new report (the heart is still worn)', equips());
  ok(logLines.some((l) => /look on chara0 \(settled\): bare chest, 90d63:unofficial skyrim special edition patch\.esp equipped \(try 1\)/.test(l)), '...logged as settled', logLines);
  report(SP, WOUND, BRIAR); papyrusCalls.length = 0; advance(60000);
  ok(!equips().length && !offs().length && !timers.size, 'the look shows: nothing more is equipped and no look stays pending');
  // the last press's own report still shows the cuirass (our UnequipItem lost to a crossing equip): the settled look takes it off again
  papyrusCalls.length = 0;
  for (let k = 0; k < 5; k++) { report(SP, CUIRASS, BRIAR); advance(150); report(SP, BRIAR); advance(150); }
  report(SP, CUIRASS, BRIAR); papyrusCalls.length = 0; advance(1600);
  ok(offs().join() === '13ed9:Skyrim.esm' && !equips().length, 'spam that ends on a worn cuirass: the settled look unequips it again, still nothing equipped over it', { offs: offs(), eq: equips() });
  setP(SP, 'equipment', eq(BRIAR)); advance(1600);
  ok(equips().join() === '90d63:unofficial skyrim special edition patch.esp', '...and once the chest is bare, the wound body goes on', equips());
  report(SP, WOUND, BRIAR); advance(60000);
  // the throttle no longer strands the look: the wound body slips within retrySeconds of a try and no report follows
  globalThis.__dboBriarheart.looks.delete(SP); report(SP, BRIAR); papyrusCalls.length = 0;
  report(SP, BRIAR); advance(1000);
  ok(!equips().length, 'a report within retrySeconds of a try equips nothing at once');
  advance(9500);
  ok(equips().length === 1, '...and the look is tried again when retrySeconds allows, with no new report', equips());
  // an equip that never shows: tried maxTries times by the settled looks alone, then given up, nothing left pending
  logLines.length = 0; papyrusCalls.length = 0; advance(120000);
  ok(equips().length === 3 && logLines.some((l) => /look gave up on chara0: 5 equips/.test(l)) && !timers.size, 'an equip that never shows: retried up to maxTries, given up once, no timer left', { eq: equips(), timers: timers.size });
  // a hot reload with a settled look pending: the timer runs the new module's look, once
  globalThis.__dboBriarheart.looks.delete(SP); report(SP, CUIRASS, BRIAR); report(SP, BRIAR); papyrusCalls.length = 0;
  delete require.cache[MODULE]; load();
  advance(1600);
  ok(equips().length === 1, 'a hot reload in between: the pending look runs once, in the reloaded module', equips());
  // offline: a pending look does nothing
  report(SP, WOUND, BRIAR); advance(60000); report(SP, CUIRASS, BRIAR); report(SP, BRIAR); online.splice(online.indexOf(SP), 1); papyrusCalls.length = 0; advance(60000);
  ok(!papyrusCalls.length, 'logged out before it settles: nothing is equipped');
  Date.now = realNow; globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear;
}
// ---- the seeded altar (Nat, 26 Oct: "place them at Deepwood Redoubt, at that open inner interior") -------------------------
{
  const VALE = '29ab7:Skyrim.esm', COURT = [-124700, 79930, -3316];
  const SEEKER = actor(0xb0, 1, 'reach', [COURT[0] + 300, COURT[1], COURT[2]], []); online.push(SEEKER);
  setP(SEEKER, 'locationalData', { cellOrWorldDesc: VALE, pos: [COURT[0] + 300, COURT[1], COURT[2]], rot: [0, 0, 0] });
  delete require.cache[MODULE]; delete globalThis.__dboBriarheart; fs.rmSync('briarheart.json', { force: true });
  let MA = load({ briarheart: { enabled: true } });
  ok(MA.C.altars.length === 1 && MA.C.altars[0].world === VALE && MA.C.altars[0].pos.join() === COURT.join(), 'the default seeds one altar: Deepwood Vale, the ritual court', MA.C.altars);
  ok(!MA.data().altars.length, '...it is not written to briarheart.json (staff placements only)');
  ok(!/Hagraven altar in the Reach/.test(MA.riteRefusal(SEEKER) || ''), 'a Reachman 300 units from the court is at an altar with no staff placement', MA.riteRefusal(SEEKER));
  setP(SEEKER, 'locationalData', { cellOrWorldDesc: VALE, pos: [COURT[0] + 700, COURT[1], COURT[2]], rot: [0, 0, 0] });
  ok(/Hagraven altar in the Reach/.test(MA.riteRefusal(SEEKER) || ''), '...700 units off (radius 500) is not');
  setP(SEEKER, 'locationalData', { cellOrWorldDesc: WORLD, pos: COURT.slice(), rot: [0, 0, 0] });
  ok(/Hagraven altar in the Reach/.test(MA.riteRefusal(SEEKER) || ''), '...nor the same coordinates in another worldspace');
  const list = run(LEAD, 'altar list');
  ok(/^seeded: Deepwood Vale, the Hagravens' ritual court, 29ab7:Skyrim\.esm -124700,79930,-3316 r500$/.test(list), 'altar list shows the seeded altar first', list);
  ok(/Usage: \/briarheart altar remove/.test(run(LEAD, 'altar remove 1')), 'altar remove cannot take a seeded altar (nothing placed to remove)');
  run(LEAD, 'altar add'); ok(/^seeded: .* \| 1\. /.test(run(LEAD, 'altar list')), 'a placed altar is listed after it, numbered from 1');
  delete require.cache[MODULE]; delete globalThis.__dboBriarheart; fs.rmSync('briarheart.json', { force: true });
  MA = load({ briarheart: { enabled: true, altars: [] } });
  setP(SEEKER, 'locationalData', { cellOrWorldDesc: VALE, pos: COURT.slice(), rot: [0, 0, 0] });
  ok(/Hagraven altar in the Reach/.test(MA.riteRefusal(SEEKER) || '') && /No Hagraven altar is placed/.test(run(LEAD, 'altar list')), 'config altars [] turns the seed off');
  online.splice(online.indexOf(SEEKER), 1);
}
// ---- visual.lockBody: the wound body equipped with abPreventRemoval (a dev test; off by default) ---------------------------
{
  const lockLoad = (lockBody) => load({ briarheart: { enabled: true, visual: Object.assign({ enabled: true, armor: '5d008:Skyrim.esm', emptyArmor: '5d009:Skyrim.esm', body: '90d63:unofficial skyrim special edition patch.esp' }, lockBody === undefined ? {} : { lockBody }) } });
  const LK = actor(0xc0, 1, 'reach', [0, 0, 0], []); online.push(LK);
  const eq = () => ({ inv: { entries: [] } });
  for (const [lock, want, what] of [[undefined, false, 'by default the briar pieces go on without abPreventRemoval'], [true, true, 'lockBody true: both go on with abPreventRemoval']]) {
    const ML = lockLoad(lock); setP(LK, 'equipment', eq()); papyrusCalls.length = 0;
    ML.become(LK, 'staff', 'lock test');
    const eqs = papyrusCalls.filter((c) => c.method === 'EquipItem');
    ok(eqs.length === 2 && eqs.every((c) => c.args[1] === want && c.args[2] === true), what, eqs.map((c) => c.args));
    ML.end(LK, 'lock test done');
  }
  // visual.blockReequip: the refused cuirass comes off with abPreventEquip; by default without
  for (const [flag, want] of [[undefined, false], [true, true]]) {
    const MB = load({ briarheart: { enabled: true, visual: Object.assign({ enabled: true, armor: '5d008:Skyrim.esm', emptyArmor: '5d009:Skyrim.esm', settleMs: 0 }, flag === undefined ? {} : { blockReequip: flag }) } });
    setP(LK, 'equipment', { inv: { entries: [] } }); MB.become(LK, 'staff', 'reequip test'); papyrusCalls.length = 0;
    globalThis.__dboBriarheartEquip(LK, { inv: { entries: [{ baseId: CUIRASS, count: 1, worn: true }] } });
    const offs = papyrusCalls.filter((c) => c.method === 'UnequipItem');
    ok(offs.length === 1 && offs[0].args[0] === '13ed9:Skyrim.esm' && offs[0].args[1] === want, flag ? 'blockReequip true: the cuirass comes off with abPreventEquip' : 'by default the cuirass comes off without abPreventEquip', offs.map((c) => c.args));
    MB.end(LK, 'reequip test done');
  }
  online.splice(online.indexOf(LK), 1);
}
// ---- the altar from the F7 Place tool (Nat, 26 Oct: "make sure it's in the Place tool") ----------------------------------
{
  const REACH = '3c:Skyrim.esm', AT = [5000, 6000, 100];
  const placedRows = [];
  globalThis.__dboPlacedOf = (desc) => placedRows.filter((e) => e.base.toLowerCase() === String(desc).toLowerCase());
  const PL = actor(0xd0, 1, 'reach', [AT[0] + 200, AT[1], AT[2]], []); online.push(PL);
  setP(PL, 'locationalData', { cellOrWorldDesc: REACH, pos: [AT[0] + 200, AT[1], AT[2]], rot: [0, 0, 0] });
  delete require.cache[MODULE]; delete globalThis.__dboBriarheart; fs.rmSync('briarheart.json', { force: true });
  const MP = load({ briarheart: { enabled: true, altars: [] } });
  ok(/Hagraven altar in the Reach/.test(MP.riteRefusal(PL) || ''), 'nothing placed: no altar there');
  placedRows.push({ id: 'ff00abcd', base: '6aeed:Skyrim.esm', name: 'Hagraven Altar (Briarheart rite)', kind: 'object', where: REACH, pos: AT.slice(), by: 7, at: 1 });
  ok(!/Hagraven altar in the Reach/.test(MP.riteRefusal(PL) || ''), 'a Hagraven Altar placed with F7 Place is an altar where it stands (radius altarRadius)', MP.riteRefusal(PL));
  ok(!MP.data().altars.length, '...with nothing written to briarheart.json');
  ok(/Place tool \(ff00abcd\): 3c:Skyrim\.esm 5000,6000,100 r400/.test(run(LEAD, 'altar list')), 'altar list shows it as placed with the Place tool', run(LEAD, 'altar list'));
  placedRows.push({ id: 'ff00abce', base: '13ed9:Skyrim.esm', name: 'something else', kind: 'object', where: REACH, pos: [AT[0] + 9000, AT[1], AT[2]], by: 7, at: 1 });
  setP(PL, 'locationalData', { cellOrWorldDesc: REACH, pos: [AT[0] + 9000, AT[1], AT[2]], rot: [0, 0, 0] });
  ok(/Hagraven altar in the Reach/.test(MP.riteRefusal(PL) || ''), 'another placed base is not an altar');
  setP(PL, 'locationalData', { cellOrWorldDesc: REACH, pos: [AT[0] + 200, AT[1], AT[2]], rot: [0, 0, 0] });
  placedRows.splice(0, placedRows.length);
  ok(/Hagraven altar in the Reach/.test(MP.riteRefusal(PL) || ''), 'removed with the Place tool (gone from its list): the altar is gone');
  delete globalThis.__dboPlacedOf;
  ok(/Hagraven altar in the Reach/.test(MP.riteRefusal(PL) || ''), 'without placement.js loaded, placed altars are simply none');
  online.splice(online.indexOf(PL), 1);
  // The catalog row and placement.js's reader, as shipped
  const cat = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'admin-placeables.json'), 'utf8')).categories;
  const last = cat[cat.length - 1];
  ok(last.id === 'Briarheart' && last.kind === 'object' && last.items.length === 1 && last.items[0][0] === '6aeed:Skyrim.esm' && last.items[0][1] === 'Hagraven Altar (Briarheart rite)', 'F7 Place: the Briarheart category is last, with the Hagraven Altar (so the catalog names the base after it)', last);
  ok(/globalThis\.__dboPlacedOf = \(desc\) =>/.test(fs.readFileSync(path.resolve(__dirname, '..', 'placement.js'), 'utf8')), 'placement.js exports __dboPlacedOf');
}
// ---- as hard as the werewolf's road (Nat, 26 Oct: "make it as hard as werewolf, and Reachman MALE required") -------------
{
  const FEATHER = 0x3ad66, CLAW = 0x6b689;
  ID['3ad66:Skyrim.esm'] = FEATHER; ID['6b689:Skyrim.esm'] = CLAW;
  let night = true; globalThis.__dboClock = { isNight: () => night, isFullMoon: () => false };
  const HH = actor(0xe0, 1, 'reach', [0, 0, 0], []); online.push(HH);
  const give = (inv) => setP(HH, 'inventory', { entries: inv.map(([id, n]) => ({ baseId: id, count: n })) });
  delete require.cache[MODULE]; delete globalThis.__dboBriarheart; fs.rmSync('briarheart.json', { force: true });
  const MH = load({ briarheart: { enabled: true, keepDefaults: true, altars: [{ world: WORLD, pos: [0, 0, 0], radius: 400 }] } });
  ok(MH.C.failChance === 0.25 && MH.C.failCooldownHours === 72 && MH.C.riteAt === 'night' && MH.C.sexes.join() === 'male', 'the defaults: one in four fails, a 72 h wait, night only, men only', [MH.C.failChance, MH.C.failCooldownHours, MH.C.riteAt, MH.C.sexes]);
  give([[HEART, 1]]);
  ok(/3 Hagraven Feathers and 2 Hagraven Claws beside the Briar Heart\. You lack 3 Hagraven Feathers and 2 Hagraven Claws/.test(MH.riteRefusal(HH)), 'a heart alone is not enough: the feathers and claws are named', MH.riteRefusal(HH));
  give([[HEART, 1], [FEATHER, 2], [CLAW, 2]]);
  ok(/You lack 1 Hagraven Feathers\.$/.test(MH.riteRefusal(HH)), '...and what is still lacking is counted', MH.riteRefusal(HH));
  give([[HEART, 1], [FEATHER, 3], [CLAW, 2]]);
  ok(MH.riteRefusal(HH) === '', 'a Reachman with all of it, by night, at the altar: no refusal', MH.riteRefusal(HH));
  night = false;
  ok(/only by night/.test(MH.riteRefusal(HH)), 'by day the Hagravens refuse', MH.riteRefusal(HH));
  night = true;
  setP(HH, 'appearance', { raceId: 1, isFemale: true });
  ok(MH.riteRefusal(HH) === 'The Hagravens give the briar only to Reachmen.', 'a Reachwoman is refused', MH.riteRefusal(HH));
  setP(HH, 'appearance', { raceId: 1 });
  // the offerings are taken whether the briar takes or not
  setRandom(0.99); MH.rite(HH); MH.confirm(HH, 'forever');
  ok(MH.isBriar(HH) && inv(HH, HEART) === 0 && inv(HH, FEATHER) === 0 && inv(HH, CLAW) === 0, 'the briar takes: the heart, the feathers and the claws are all used', P(HH, 'inventory'));
  MH.end(HH, 'harder test');
  give([[HEART, 1], [FEATHER, 3], [CLAW, 2]]); setRandom(0.1); MH.rite(HH); MH.confirm(HH, 'forever');
  ok(!MH.isBriar(HH) && inv(HH, FEATHER) === 0 && inv(HH, CLAW) === 0, 'a failed rite (0.1 < 0.25) takes the offerings too', P(HH, 'inventory'));
  Math.random = realRandom;
  delete globalThis.__dboClock; online.splice(online.indexOf(HH), 1);
}
// ---- the altar as an object you activate (Nat, 26 Oct: "more noticeable, like an activator") -----------------------------
{
  const FEATHER = 0x3ad66, CLAW = 0x6b689; ID['3ad66:Skyrim.esm'] = FEATHER; ID['6b689:Skyrim.esm'] = CLAW;
  const VALE = '29ab7:Skyrim.esm', COURT = [-124700, 79930, -3316];
  const rows = []; const placeCalls = [];
  globalThis.__dboPlacedOf = (desc) => rows.filter((e) => e.base.toLowerCase() === String(desc).toLowerCase());
  globalThis.__dboPlaceAs = (a, desc, pos, rot) => { placeCalls.push({ a, desc, pos, rot }); const e = { id: 'ff00beef', base: desc, name: 'Hagraven Altar (Briarheart rite)', kind: 'object', where: VALE, pos: pos.slice(), by: 1, at: 1 }; rows.push(e); return { ok: true, entry: e }; };
  globalThis.__dboClock = { isNight: () => true, isFullMoon: () => false };
  const AC = actor(0xf0, 1, 'reach', [0, 0, 0], []); online.push(AC);
  const at = (world, pos) => setP(AC, 'locationalData', { cellOrWorldDesc: world, pos, rot: [0, 0, 0] });
  delete require.cache[MODULE]; delete globalThis.__dboBriarheart; fs.rmSync('briarheart.json', { force: true });
  const MA = load({ briarheart: { enabled: true, keepDefaults: true, failPermadeath: true } });
  globalThis.__dboPermaKill = () => true;
  // the seeded Deepwood altar gets its object once someone stands in its cell, and only once
  at(VALE, [COURT[0] + 5000, COURT[1], COURT[2]]); globalThis.__dboBriarheart.seedAt = 0; MA.tick && ticker && ticker();
  ok(!placeCalls.length, 'nobody in the altar\'s cell: no object placed yet');
  at(VALE, [COURT[0] + 300, COURT[1] + 100, COURT[2]]); globalThis.__dboBriarheart.seedAt = 0; ticker();
  ok(placeCalls.length === 1 && placeCalls[0].desc === '6aeed:Skyrim.esm' && placeCalls[0].pos.join() === COURT.join() && placeCalls[0].a === AC, 'a player in the cell: the Place tool places the altar object at the seeded spot, once', placeCalls);
  ok(papyrusCalls.some((c) => c.method === 'SetDisplayName' && c.args[0] === 'Hagraven Altar'), '...and it is named Hagraven Altar on the crosshair');
  globalThis.__dboBriarheart.seedAt = 0; ticker();
  ok(placeCalls.length === 1, 'the next tick (and a restart, which reads the same Place list) does not place a second one');
  // activating it is the rite: refusals, the warning, then a second activation accepts
  const act = globalThis.__dboBriarheartActivate;
  ok(act(0x123, AC) === false, 'any other reference falls through to the rest of the activate chain');
  setP(AC, 'inventory', { entries: [{ baseId: HEART, count: 1 }] });
  said.length = 0; ok(act(0xff00beef, AC) === true && said.some(([a, t]) => a === AC && /3 Hagraven Feathers and 2 Hagraven Claws/.test(t)), 'activating the altar without the offerings: refused, with what is needed', said);
  setP(AC, 'inventory', { entries: [{ baseId: HEART, count: 1 }, { baseId: FEATHER, count: 3 }, { baseId: CLAW, count: 2 }] });
  said.length = 0; act(0xff00beef, AC);
  ok(said.some(([a, t]) => a === AC && /PERMANENT DEATH: 25 in 100 die/.test(t) && / Or activate the altar again to accept\.$/.test(t)) && !MA.isBriar(AC), 'with everything: the permanent-death warning, and a second activation to accept', said);
  setRandom(0.99); said.length = 0; act(0xff00beef, AC); Math.random = realRandom; delete globalThis.__dboPermaKill;
  ok(MA.isBriar(AC) && inv(AC, HEART) === 0, 'the second activation within the window takes the rite', said);
  said.length = 0; act(0xff00beef, AC);
  ok(said.some(([, t]) => /already beats/.test(t)), 'a Briarheart activating it is told so');
  MA.end(AC, 'activator test');
  delete globalThis.__dboPlaceAs; delete globalThis.__dboPlacedOf; delete globalThis.__dboClock; online.splice(online.indexOf(AC), 1);
  ok(/__dboBriarheartActivate\(target, caster\)/.test(fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8')), 'gamemode.js asks briarheart.js in the activate chain');
  ok(/globalThis\.__dboPlaceAs = /.test(fs.readFileSync(path.resolve(__dirname, '..', 'placement.js'), 'utf8')), 'placement.js exports __dboPlaceAs');
}
// ---- what a Briarheart is, in Active Effects: the display ability goes and comes with the gifts ---------------------------
{
  ID['801:DragonBreak Supernatural Displays.esp'] = 0xb4000801; // verify-formids: ignore - harness fixture: the display plugin is not in the release order (briarheart.display ships empty)
  const load = (display) => {
    delete require.cache[MODULE]; delete globalThis.__dboBriarheart;
    return require(MODULE)({
      mp, log: () => {}, personal: (a, t) => said.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `who${(a >>> 0).toString(16)}`,
      display: (a) => `char${(a >>> 0).toString(16)}`, cfg: { briarheart: { enabled: true, display } },
      registerChatCommand: (n, f) => commands.set(n, f), onlineActors: () => online.slice(), isLeadStaff: (a) => (a >>> 0) === LEAD, findByName: () => 0, every: (n, ms, f) => { ticker = f; },
      giveItem: () => true, sourceResistsOf: () => new Set(),
    });
  };
  const BD = actor(0x90, 1, 'reach', [0, 0, 0], []); online.push(BD);
  const shows = (method) => papyrusCalls.filter((c) => c.method === method && c.args[0] === '801:DragonBreak Supernatural Displays.esp'); // verify-formids: ignore - harness fixture: the display plugin is not in the release order (briarheart.display ships empty)
  let MD = load('801:DragonBreak Supernatural Displays.esp'); // verify-formids: ignore - harness fixture: the display plugin is not in the release order (briarheart.display ships empty)
  papyrusCalls.length = 0; MD.become(BD, 'staff', 'display test');
  ok(shows('AddSpell').length === 1 && shows('AddSpell')[0].types[0] === 'espm', 'the grant: the display ability is learned (an espm record)', papyrusCalls.filter((c) => c.method === 'AddSpell'));
  papyrusCalls.length = 0; MD.end(BD, 'display test done');
  ok(shows('RemoveSpell').length === 1, 'the end: it is taken back');
  MD = load(''); papyrusCalls.length = 0; MD.become(BD, 'staff', 'no display'); MD.end(BD, 'no display done');
  ok(!papyrusCalls.some((c) => /Supernatural Displays/.test(String(c.args[0]))), 'display empty: nothing is given');
}
// ---- the hooks in the other modules ---------------------------------------------------------------------------------------
const src = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
ok(/__dboBriarheartTargetMult\(agg, tgt, src\)/.test(src('gamemode.js')) && /require\(BRIARHEART_JS\)/.test(src('gamemode.js')) && /__dboBriarheartLogin\(a\)/.test(src('gamemode.js')), 'gamemode.js loads it, asks the target side, and calls the login');
ok(/__dboBriarheartVitalBonus/.test(src('charlevel.js')) && /__dboCharLevelSyncBonus = /.test(src('charlevel.js')), 'charlevel.js adds the health and syncs it');
ok(/d\.kind === 'divine' && typeof globalThis\.__dboBriarheartRefusesDivine/.test(src('prayer.js')) && /__dboBriarheartFaithLock/.test(src('prayer.js')) && /__dboFaithIdOf = /.test(src('prayer.js')), 'prayer.js refuses the Divines, locks the faith, and names the faith');
ok(/isBriarheart\(t\)/.test(src('supernatural.js')) && /deity === 'hircine'\) && isBriarheart\(a\)/.test(src('supernatural.js')), 'supernatural.js keeps fevers and its rites off a Briarheart');
ok(/__dboBriarheartMenuEntries/.test(src('playermenu.js')) && /__dboBriarheartMenuAction/.test(src('playermenu.js')), 'playermenu.js offers the tear');
const gcfg = JSON.parse(src('gamemode-config.json'));
ok(gcfg.briarheart && gcfg.briarheart.enabled === true && gcfg.briarheart.visual && gcfg.briarheart.visual.blockReequip === true, 'the shipped config has it ON, with blockReequip (Nat signed it off, 26 Oct)');
ok(/const extra = fleshArmorOf\(targetId\) \+ briarSkinArmorOf\(targetId\)/.test(src('gamemode.js')) && /__dboBriarSkinArmor\(targetId >>> 0\)/.test(src('gamemode.js')) && /__dboBriarSkinRating = briarSkinArmorOf/.test(src('gamemode.js')), 'gamemode.js counts the skin on the hit, with the Flesh spells');
ok(/__dboBriarRegenMult\(a, stat\)/.test(src('racial.js')), 'racial.js multiplies the regeneration by the skin');
const bs = gcfg.briarheart.briarSkin || {};
ok(bs.enabled === true && bs.armor === 38 && !bs.armorFrom && bs.staminaRegen === 1.25 && bs.diseaseResist === 50, 'the shipped briarSkin: on (with the module), a light faction cuirass (38), stamina x1.25, DiseaseResist 50', bs);
ok(/Number\(s\.rating\) > 0 \? \{ rating: Number\(s\.rating\), counted: Number\(s\.rating\), heavy: false \}/.test(src('gamemode.js')), 'gamemode.js counts a rating of its own as a light piece');
ok(/"spells": \["51b16:Skyrim\.esm", "3aea3:Skyrim\.esm"\]/.test(src('gamemode-config.json')), 'the shipped config gives the player\'s Ironflesh and Lightning Cloak');

// ---- the Forsworn spare a Briarheart (par.lar, 27 Oct) ---------------------------------------------------------------------
{
  const EDIDS = { 0xe1: 'EncForsworn01MissileBretonF01', 0xe2: 'EncWolf', 0xe3: 'EncHagravenBoss' };
  ID['e1:Skyrim.esm'] = 0xe1; ID['e2:Skyrim.esm'] = 0xe2; ID['e3:Skyrim.esm'] = 0xe3; // verify-formids: ignore - harness fixture: stand-in bases, read through the stub recordOf
  const loadFw = (b) => {
    delete require.cache[MODULE]; delete globalThis.__dboBriarheart;
    return require(MODULE)({
      mp, log: () => {}, personal: (a, t) => said.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `who${(a >>> 0).toString(16)}`,
      display: (a) => `char${(a >>> 0).toString(16)}`, cfg: { briarheart: Object.assign({ enabled: true, forswornFriendly: true, briarSkin: { enabled: true, armor: 38 } }, b || {}) },
      registerChatCommand: (n, f) => commands.set(n, f), onlineActors: () => online.slice(), isLeadStaff: () => false, findByName: () => 0, every: (n, ms, f) => { ticker = f; },
      giveItem: () => true, sourceResistsOf: () => new Set(), recordOf: (id) => (EDIDS[id >>> 0] ? { record: { editorId: EDIDS[id >>> 0] } } : null),
    });
  };
  const BH = actor(0xa0, 1, 'reach', [0, 0, 0], []); setP(BH, 'profileId', 501); online.push(BH);
  const MORTAL = actor(0xa1, 1, 'reach', [0, 0, 0], []); setP(MORTAL, 'profileId', 502); online.push(MORTAL);
  const npc = (id, base, factions) => { setP(id, 'profileId', -1); setP(id, 'baseDesc', base); if (factions) setP(id, 'ff_factions', { f: factions.map((f) => [f, 0]), c: 0 }); return id; };
  const CAMP = npc(0xff000b01, '9999:Skyrim.esm', [0x43599, 0x4359e]);   // a Forsworn camp's spawn: wildlife.js gave it the factions
  const LEASE = npc(0xff000b02, 'e1:Skyrim.esm', null);                   // a dungeon lease's Forsworn: no ff_factions, its base says it // verify-formids: ignore - harness fixture: stand-in base
  const HAG = npc(0xff000b03, 'e3:Skyrim.esm', null); // verify-formids: ignore - harness fixture: stand-in base
  const WOLF = npc(0xff000b04, 'e2:Skyrim.esm', null); // verify-formids: ignore - harness fixture: stand-in base
  const PLAYER_FW = actor(0xa2, 1, 'reach', [0, 0, 0], []); setP(PLAYER_FW, 'profileId', 503); setP(PLAYER_FW, 'ff_factions', { f: [[0x43599, 0]], c: 0 });
  let M = loadFw();
  M.become(BH, 'staff', 'forsworn test');
  const spares = (a, t) => typeof globalThis.__dboBriarheartSpares === 'function' && globalThis.__dboBriarheartSpares(a, t) === true;
  ok(spares(CAMP, BH), 'a Forsworn camp spawn (ForswornFaction in ff_factions) does not hurt a Briarheart');
  ok(spares(LEASE, BH), 'nor a dungeon lease\'s Forsworn, known by its base (EncForsworn01MissileBretonF01): the Deepwood Redoubt shots');
  ok(spares(HAG, BH), 'nor a hagraven');
  ok(!spares(WOLF, BH), 'a wolf still bites a Briarheart');
  ok(!spares(CAMP, MORTAL), 'the Forsworn still hurt anyone else');
  ok(!spares(PLAYER_FW, BH), 'a player is never spared this way, whatever factions it carries');
  ok(!spares(BH, CAMP) && !spares(CAMP, BH), 'a Briarheart that strikes a Forsworn provokes it: it may answer');
  globalThis.__dboBriarheart.provoked.set(CAMP >>> 0, Date.now() - 61000);
  ok(spares(CAMP, BH), 'and once provokeSeconds have passed it spares them again');
  ok(spares(LEASE, BH), '(the provocation was that one Forsworn\'s alone)');
  M = loadFw({ forswornFriendly: false });
  ok(!spares(CAMP, BH), 'with forswornFriendly off the Forsworn fight a Briarheart as anyone');
  M = loadFw();
  ok(/turns blades like faction armour \(38\): it counts against every weapon and fist blow in a fight, though your inventory shows only the armour you wear/.test(run(BH, 'status')), '/briarheart status says the briar skin counts in a fight though the inventory shows only worn armour');
  M = loadFw({ briarSkin: { enabled: false } });
  ok(!/faction armour/.test(run(BH, 'status')), 'and says nothing of it while the skin is off');
  const g = src('gamemode.js');
  ok(/globalThis\.__dboBriarheartSpares && globalThis\.__dboBriarheartSpares\(agg, tgt\)\) return false;/.test(g) && g.indexOf('__dboBriarheartSpares(agg, tgt)') < g.indexOf('// 3. Mastery'), 'gamemode.js refuses the spared hit in onHitDamageAttempt, before any damage is counted');
  ok(/sourceResistsOf, recordOf \}\);/.test(g), 'gamemode.js hands briarheart.js recordOf');
  online.splice(online.indexOf(BH), 1); online.splice(online.indexOf(MORTAL), 1);
}

Math.random = realRandom;
process.chdir(cwd);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
