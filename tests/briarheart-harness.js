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
const ID = { '5d009:Skyrim.esm': 0x5d009, '3ad61:Skyrim.esm': 0x3ad61, '2e504:Skyrim.esm': 0x2e504, '72317:Skyrim.esm': 0x72317, '400ad:Skyrim.esm': 0x400ad, '43599:Skyrim.esm': 0x43599, '5d008:Skyrim.esm': 0x5d008 };
const HEART = 0x3ad61, GEM = 0x2e504;
// ARMO biped slots for the look: the two briar bodies and a cuirass cover the body (0x4), a helmet the head (0x1)
const BRIAR = 0x5d008, BRIAR_EMPTY = 0x5d009, CUIRASS = 0x13ed9, HELMET = 0x12e4d;
const ARMOS = { [BRIAR]: 0x4, [BRIAR_EMPTY]: 0x4, [CUIRASS]: 0x4, [HELMET]: 0x1 };
const props = new Map();   // `${actor}|${prop}` -> value
const P = (a, k) => props.get(`${a >>> 0}|${k}`);
const setP = (a, k, v) => props.set(`${a >>> 0}|${k}`, v);
const papyrusCalls = [];
const mp = {
  get: (a, k) => { const v = P(a, k); if (v === undefined && k === 'type') throw new Error('no actor'); return v === undefined ? null : JSON.parse(JSON.stringify(v)); },
  set: (a, k, v) => setP(a, k, v === null ? null : JSON.parse(JSON.stringify(v))),
  getIdFromDesc: (d) => ID[d] || 0,
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
  lookupEspmRecordById: (id) => (RACES[id] ? { record: { editorId: RACES[id] } } : ARMOS[id >>> 0] ? { record: { type: 'ARMO', editorId: 'armo', fields: [{ type: 'BOD2', data: new Uint8Array(new Uint32Array([ARMOS[id >>> 0], 2]).buffer) }] } } : { record: null }),
  callPapyrusFunction: (kind, cls, method, self, args) => { papyrusCalls.push({ method, self: self.desc, args: args.map((x) => x.desc !== undefined ? x.desc : x) }); return method === 'IsInFaction' ? true : undefined; },
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
const load = (cfg) => {
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
ok(papyrusCalls.filter((c) => c.method === 'AddSpell').map((c) => c.args[0]).join() === '72317:Skyrim.esm,400ad:Skyrim.esm', 'Ironflesh and Lightning Cloak are given', papyrusCalls);
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
ok(papyrusCalls.filter((c) => c.method === 'RemoveSpell').length === 2 && globalThis.__dboBriarheartVitalBonus(TARRARE).health === 0, 'the spells and the health go with it');
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
{
  const logLines = [];
  delete require.cache[MODULE]; delete globalThis.__dboBriarheart;
  const ML = require(MODULE)({
    mp, log: (...x) => logLines.push(x.join(' ')), personal: (a, t) => said.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `who${(a >>> 0).toString(16)}`,
    display: (a) => `char${(a >>> 0).toString(16)}`, cfg: { briarheart: { enabled: true, visual: { enabled: true, armor: '5d008:Skyrim.esm', emptyArmor: '5d009:Skyrim.esm', women: false, retrySeconds: 10, maxTries: 3 } } },
    registerChatCommand: (n, f) => commands.set(n, f), onlineActors: () => online.slice(), isLeadStaff: (a) => (a >>> 0) === LEAD, findByName: () => 0, every: (n, ms, f) => { ticker = f; },
    giveItem: (a, id, n) => { given.push([a >>> 0, id, n]); const e = ((P(a, 'inventory') || {}).entries || []).slice(); e.push({ baseId: id, count: n }); setP(a, 'inventory', { entries: e }); return true; }, sourceResistsOf: () => new Set(),
  });
  const MAN = actor(0x50, 1, 'reach', [0, 0, 0], [{ baseId: CUIRASS, count: 1 }]); online.push(MAN);
  const WOMAN = actor(0x51, 1, 'reach', [0, 0, 0], []); online.push(WOMAN); setP(WOMAN, 'appearance', { raceId: 1, isFemale: true });
  const eq = (...worn) => ({ inv: { entries: worn.map((id) => ({ baseId: id, count: 1, worn: true })) } });
  const look = globalThis.__dboBriarheartEquip;
  const lookCalls = () => papyrusCalls.filter((c) => c.method === 'EquipItem');
  // the rite with their own cuirass on: nothing shows
  setP(MAN, 'equipment', eq(CUIRASS)); papyrusCalls.length = 0; given.length = 0; logLines.length = 0;
  ML.become(MAN, 'staff', 'test');
  ok(!lookCalls().length && !given.some(([a, id]) => a === MAN && id === BRIAR), 'their own cuirass on: no briar body given or worn');
  // the cuirass comes off: a bare chest gets the briar body
  setP(MAN, 'equipment', eq());
  look(MAN, eq());
  ok(lookCalls().some((c) => c.args[0] === '5d008:Skyrim.esm') && given.some(([a, id]) => a === MAN && id === BRIAR), 'a bare chest: the briar body is given and equipped');
  ok(logLines.some((l) => /briarheart: look on char50 \(equipment\): bare chest, briar body 5d008:Skyrim\.esm equipped \(try 1\)/.test(l)), '...and logged', logLines);
  papyrusCalls.length = 0; look(MAN, eq());
  ok(!lookCalls().length, 'a second report within retrySeconds does not equip again');
  // a helmet alone is still a bare chest
  globalThis.__dboBriarheart.looks.get(MAN).at = 0; papyrusCalls.length = 0;
  look(MAN, eq(HELMET));
  ok(lookCalls().length === 1, 'a helmet alone is still a bare chest');
  // the briar body shows in the equipment: done
  papyrusCalls.length = 0; look(MAN, eq(BRIAR, HELMET));
  ok(!lookCalls().length && !globalThis.__dboBriarheart.looks.has(MAN), 'the briar body worn: nothing more to do');
  // their own armour back on: the briar body leaves the pack
  logLines.length = 0; look(MAN, eq(CUIRASS));
  ok(inv(MAN, BRIAR) === 0 && inv(MAN, CUIRASS) === 1, 'their cuirass back on: the briar body leaves the pack (nothing to steal)');
  ok(logLines.some((l) => /look off on char50 \(equipment\): own body armour 13ed9 on, briar body taken from the pack/.test(l)), '...and logged', logLines);
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
  ok(inv(MAN, BRIAR) === 0 && inv(MAN, BRIAR_EMPTY) === 0 && logLines.some((l) => /look cleared on char50 \(login\): 2 briar bodies taken, not a Briarheart/.test(l)), 'not a Briarheart at login: leftover briar bodies are taken', logLines);
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
}
// ---- the hooks in the other modules ---------------------------------------------------------------------------------------
const src = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
ok(/__dboBriarheartTargetMult\(agg, tgt, src\)/.test(src('gamemode.js')) && /require\(BRIARHEART_JS\)/.test(src('gamemode.js')) && /__dboBriarheartLogin\(a\)/.test(src('gamemode.js')), 'gamemode.js loads it, asks the target side, and calls the login');
ok(/__dboBriarheartVitalBonus/.test(src('charlevel.js')) && /__dboCharLevelSyncBonus = /.test(src('charlevel.js')), 'charlevel.js adds the health and syncs it');
ok(/d\.kind === 'divine' && typeof globalThis\.__dboBriarheartRefusesDivine/.test(src('prayer.js')) && /__dboBriarheartFaithLock/.test(src('prayer.js')) && /__dboFaithIdOf = /.test(src('prayer.js')), 'prayer.js refuses the Divines, locks the faith, and names the faith');
ok(/isBriarheart\(t\)/.test(src('supernatural.js')) && /deity === 'hircine'\) && isBriarheart\(a\)/.test(src('supernatural.js')), 'supernatural.js keeps fevers and its rites off a Briarheart');
ok(/__dboBriarheartMenuEntries/.test(src('playermenu.js')) && /__dboBriarheartMenuAction/.test(src('playermenu.js')), 'playermenu.js offers the tear');
const gcfg = JSON.parse(src('gamemode-config.json'));
ok(gcfg.briarheart && gcfg.briarheart.enabled === false, 'the shipped config has it OFF');

Math.random = realRandom;
process.chdir(cwd);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
