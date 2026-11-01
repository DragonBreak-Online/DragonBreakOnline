// Vampire bloodlines (vampirepath.js bloodlines; Nat, 31 Oct; _work\vampire-bloodlines-build-1031.md): the clan -> line
// mapping, each line's gift and cost, the bloodfiend (Feral x1.5, Molag Bal's path capped at Sworn), every Ravenwatch rule
// (no path, powers at half, the code's feeds, its breach and expulsion, no Feral while kept), the grandfathered Crown, the
// switch, and the hooks supernatural.js, gamemode.js and guilds.js call. The real module against a stub world.
//   node tests/vampire-bloodlines-harness.js   (from server\)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, name, got) => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); };
const near = (x, y) => Math.abs(x - y) < 1e-9;

let clock = Date.parse('2026-10-31T12:00:00Z');
Date.now = () => clock;
global.setTimeout = () => 0; global.clearTimeout = () => {};
let dice = [];
Math.random = () => (dice.length ? dice.shift() : 0.999);

// ---- the world -----------------------------------------------------------------------------------------------------
const VOLK = 0xff000001, CYRO = 0xff000002, KEER = 0xff000003, BERNE = 0xff000004, RAVEN = 0xff000005, FIEND = 0xff000006, LORD = 0xff000007, MORTAL = 0xff000008, OUTLAW = 0xff000009, NPC = 0xff0000aa;
const PROFILE = { [VOLK]: 1, [CYRO]: 2, [KEER]: 3, [BERNE]: 4, [RAVEN]: 5, [FIEND]: 6, [LORD]: 29, [MORTAL]: 8, [OUTLAW]: 9 };
const CLAN = { [VOLK]: 'clan-volkihar', [CYRO]: 'cyrodiil-vampyrum-order', [KEER]: 'bloodmist-clan', [BERNE]: 'crimson-scars', [RAVEN]: 'house-ravenwatch' };
const props = new Map();
const setp = (a, k, v) => props.set(`${a}|${k}`, v);
const getp = (a, k) => props.get(`${a}|${k}`);
const vampires = new Map(), patrons = new Map(), ranks = new Map(), downedSet = new Set(), downedBy = new Map();
const clans = new Map(Object.entries(CLAN).map(([a, f]) => [Number(a), f]));
let crown = 0, night = false, nightBonus = 1;
const onlineSet = new Set([VOLK, CYRO, KEER, BERNE, RAVEN, FIEND, LORD, MORTAL, OUTLAW]);
const mp = { get: (a, k) => (k === 'isDead' ? false : getp(a, k)), set: setp, getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0, lookupEspmRecordById: () => null };
const said = [], audits = [], packets = [], cmds = new Map(), every = new Map(), calls = [];
const lastSaid = (a) => { for (let i = said.length - 1; i >= 0; i--) if (said[i][0] === a) return said[i][1]; return ''; };
const DRAIN = 0x10fb5, FROST_SPELL = 0x2b96b, FIRE_SPELL = 0x12fcd, UNARMED = 0x1f4, SWORD = 0x12eb7;
Object.assign(globalThis, {
  __dboSuperVampState: (a) => (vampires.has(a) ? Object.assign({ kind: 'vampire' }, vampires.get(a)) : { kind: null, stage: 0, pure: false, unfed: false }),
  __dboSuperCrownHolder: () => crown,
  __dboSuperCrownSince: () => 0,
  __dboBloodRank: (a) => ranks.get(a) || 0,
  __dboBloodThirstRate: () => 1,
  __dboBloodDamageMult: () => (night ? nightBonus : 1),
  __dboGuildsOf: (a) => (clans.has(a) ? [{ id: clans.get(a) }] : []),
  __dboGuildLeave: (a, fid) => { calls.push(['leave', a, fid]); if (clans.get(a) !== fid) return false; clans.delete(a); return true; },
  __dboFaithOf: (a) => (patrons.has(a) ? { patron: patrons.get(a) } : null),
  __dboIsDowned: (a) => downedSet.has(a),
  __dboDownedBy: (a) => downedBy.get(a) || 0,
  __dboInDuel: () => false,
  __dboSuperSunBurnAt: () => 0,
  __dboSuperLoginAt: new Map(),
  __dboSuperSetThirst: (a, n, why) => { calls.push(['thirst', a, n, why]); vampires.get(a).stage = n; return true; },
  __dboVampIsDrain: (src) => (Number(src) >>> 0) === DRAIN,
  __dboSuperKilledBy: new Map(),
  __dboOutlaws: { data: { zones: { bruma: { 9: { amount: 200 } }, chorrol: { 8: { amount: 0 } } } } },
  __dboClock: { isNight: () => night, gameDays: () => clock / 14400000 },
  __dboRites: new Map(),
});
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bloodlines-'));
process.chdir(scratch);
const load = (cfg) => {
  delete globalThis.__dboVampPath; delete globalThis.__dboVampSafeCells; every.clear(); cmds.clear();
  delete require.cache[path.join(SERVER, 'vampirepath.js')];
  return require(path.join(SERVER, 'vampirepath.js'))({
    mp, log: () => {}, personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), who: (a) => `#${a.toString(16)}`, display: (a) => `A${a.toString(16)}`,
    sendPacket: (a, p) => packets.push([a, p]), onlineActors: () => [...onlineSet], every: (n, ms, fn) => every.set(n, fn),
    registerChatCommand: (n, fn) => cmds.set(n, fn), profileOf: (a) => (PROFILE[a] === undefined ? -1 : PROFILE[a]), cfg: { vampirePath: cfg || {} },
    isLeadStaff: () => true, findByName: () => null, inEditor: () => false,
    fitsElement: (el, src) => (el === 'frost' && src === FROST_SPELL) || (el === 'fire' && src === FIRE_SPELL),
    isMagicSource: (src) => src === FROST_SPELL || src === FIRE_SPELL || src === DRAIN,
  });
};
const reset = () => {
  vampires.clear(); patrons.clear(); ranks.clear(); downedSet.clear(); downedBy.clear(); props.clear(); calls.length = 0; packets.length = 0; dice = []; night = false; nightBonus = 1; crown = 0;
  clans.clear(); for (const [a, f] of Object.entries(CLAN)) clans.set(Number(a), f);
  for (const a of [VOLK, CYRO, KEER, BERNE, RAVEN, FIEND, LORD]) vampires.set(a, { stage: 1, pure: false, unfed: false });
  for (const a of onlineSet) { setp(a, 'worldOrCellDesc', '3c:Skyrim.esm'); setp(a, 'pos', [0, 0, 0]); setp(a, 'percentages', { health: 1 }); }
  globalThis.__dboSuperKilledBy.clear();
  clock += 3600000;
};
const H = (name, ...a) => globalThis[name](...a);

// ---- the line a clan gives -----------------------------------------------------------------------------------------
let M = load(); reset();
const ids = [VOLK, CYRO, KEER, BERNE, RAVEN, FIEND].map((a) => M.bloodlineOf(a).id);
ok(ids.join() === 'volkihar,cyrodiilic,keerilth,berne,ravenwatch,bloodfiend', 'each clan gives its line; a vampire of no clan is a bloodfiend', ids);
ok(M.bloodlineOf(MORTAL) === null, 'a mortal has no line');
clans.delete(VOLK);
ok(M.bloodlineOf(VOLK).id === 'bloodfiend', 'leaving the clan takes the line: a bloodfiend at once');
clans.set(VOLK, 'clan-volkihar');
ok(M.bloodlineOf(VOLK).id === 'volkihar', '...and joining gives it back at once');
// the line-change notice
said.length = 0; every.get('vampLine')();
ok(said.some(([a, t]) => a === FIEND && t === 'You are a bloodfiend: no clan, no line. Join a clan, or seek a cure.'), 'a bloodfiend is told plainly, in the build note\'s words');
clans.set(FIEND, 'crimson-scars'); said.length = 0; every.get('vampLine')();
ok(said.some(([a, t]) => a === FIEND && /^The Berne blood/.test(t)), 'joining a clan: the new line is told at the next minute', said);
clans.delete(FIEND);

// ---- the bloodfiend --------------------------------------------------------------------------------------------------
reset();
vampires.get(FIEND).stage = 4; vampires.get(VOLK).stage = 4;
ok(near(M.feralChance(FIEND, vampires.get(FIEND)), 0.06) && near(M.feralChance(VOLK, vampires.get(VOLK)), 0.04), 'a bloodfiend\'s Feral comes 1.5x as often (6% a minute at stage 4 by day, against 4%)', [M.feralChance(FIEND, vampires.get(FIEND)), M.feralChance(VOLK, vampires.get(VOLK))]);
patrons.set(FIEND, 'molagbal'); patrons.set(VOLK, 'molagbal');
setp(FIEND, 'private.molagDevotion', { points: 400 }); setp(VOLK, 'private.molagDevotion', { points: 400 });
ok(M.tierOf(FIEND).name === 'Sworn' && M.tierOf(VOLK).name === 'Chosen', 'Molag Bal\'s path stops at Sworn for a bloodfiend (400 devotion: Sworn, a clan\'s vampire Chosen)', [M.tierOf(FIEND), M.tierOf(VOLK)]);
vampires.get(FIEND).pure = true; vampires.get(VOLK).pure = true;
ok(M.tierOf(FIEND).name === 'Sworn' && M.tierOf(VOLK).name === 'Pure-blood', '...a pure-blood bloodfiend too');
ranks.set(FIEND, 4); ranks.set(VOLK, 4);
ok(!M.isElder(FIEND) && M.isElder(VOLK), 'an Elder needs a clan: a pure Master Vampire bloodfiend is none');
ok(/bloodfiend: no clan, no line/.test(H('__dboVampEmbraceRefusal', FIEND)) && H('__dboVampEmbraceRefusal', VOLK) === '', 'Molag Bal\'s Embrace needs a clan', H('__dboVampEmbraceRefusal', FIEND));
ok(/bloodfiend/.test(H('__dboVampCrownRefusal', FIEND)) && H('__dboVampCrownRefusal', VOLK) === '', 'a new claim to the Crown needs a clan');
setp(FIEND, 'private.molagDevotion', { points: 140 });
M.addDevotion(FIEND, 20, 'test');
ok(/raises no bloodfiend past Sworn/.test(lastSaid(FIEND)), 'a bloodfiend crossing Devout\'s mark is told the path is closed to them', lastSaid(FIEND));

// ---- the Crown, grandfathered --------------------------------------------------------------------------------------
reset();
crown = LORD; patrons.set(LORD, 'molagbal'); vampires.get(LORD).pure = true; setp(LORD, 'private.molagDevotion', { points: 400 });
ok(M.bloodlineOf(LORD).id === 'bloodfiend' && !M.isFiend(LORD), 'the Crown\'s clanless holder is of no clan, but no bloodfiend in the rules');
ok(M.tierOf(LORD).name === 'Pure-blood', '...his path is not capped (Pure-blood)', M.tierOf(LORD));
vampires.get(LORD).stage = 4;
ok(near(M.feralChance(LORD, vampires.get(LORD)), 0.04 * 0.15), '...no bloodfiend Feral multiplier on him');
ok(H('__dboVampJoinRefusal', LORD, 'clan-volkihar') === '' && /lay the Crown down first/.test(H('__dboVampJoinRefusal', LORD, 'house-ravenwatch')), 'the holder may join any clan but House Ravenwatch');
ok(H('__dboVampJoinRefusal', VOLK, 'house-ravenwatch') === '', '...anyone else may join the house');

// ---- House Ravenwatch ------------------------------------------------------------------------------------------------
reset();
patrons.set(RAVEN, 'molagbal'); setp(RAVEN, 'private.molagDevotion', { points: 400 }); vampires.get(RAVEN).pure = true; ranks.set(RAVEN, 4);
ok(M.tierOf(RAVEN) === null && M.addDevotion(RAVEN, 50, 'test') === 0, 'Ravenwatch: no Molag Bal path, sworn or not; no devotion gained');
ok(!M.isElder(RAVEN), '...no Elder, a pure Master Vampire included');
ok(/Ravenwatch takes nothing from Molag Bal/.test(H('__dboVampEmbraceRefusal', RAVEN)) && /not for you/.test(H('__dboVampCrownRefusal', RAVEN)), '...no Embrace, no Crown');
ok(!M.isFiend(RAVEN), '...and the bloodfiend rules do not apply to members');
vampires.get(RAVEN).stage = 4;
ok(M.beginFeral(RAVEN, 'test') === false && M.feralChance(RAVEN, vampires.get(RAVEN)) >= 0, 'while the code holds, the thirst never turns them Feral');
// powers at half
night = true; nightBonus = 1.1;
ok(near(H('__dboBloodlineAttackMult', RAVEN, MORTAL, DRAIN, {}), 0.5 * 1.05 / 1.1), 'their Drain lands at half, and half the night\'s strength is kept (x1.05 of x1.1)', H('__dboBloodlineAttackMult', RAVEN, MORTAL, DRAIN, {}));
ok(near(H('__dboBloodlineAttackMult', RAVEN, MORTAL, SWORD, {}), 1.05 / 1.1), '...a blade at night: only the night\'s share');
night = false;
ok(H('__dboBloodlineAttackMult', RAVEN, MORTAL, SWORD, {}) === 1, '...by day a blade is untouched');
ok(H('__dboVampBloodMult', RAVEN) === 0.5 && H('__dboVampBloodMult', VOLK) === 1, 'blood ranks at half a feed');
// the feeds the code allows
ok(H('__dboVampFeedRefusal', RAVEN, MORTAL, { willing: true }) === '', 'a player who offers their neck: allowed');
ok(/offers their neck, or from an outlaw/.test(H('__dboVampFeedRefusal', RAVEN, MORTAL, { willing: true, seduced: true })), 'one under Seduction is no willing neck: refused');
ok(/offers their neck/.test(H('__dboVampFeedRefusal', RAVEN, MORTAL, {})), 'a bound captive who is no outlaw: refused');
ok(H('__dboVampFeedRefusal', RAVEN, OUTLAW, {}) === '', 'a bound outlaw (a bounty on them): allowed');
ok(/do not drink from the fallen/.test(H('__dboVampFeedRefusal', RAVEN, NPC, { onCorpse: true })), 'a body they did not bring down: refused');
downedSet.add(OUTLAW);
ok(H('__dboVampFeedRefusal', RAVEN, OUTLAW, { onCorpse: true }) === '', 'a downed outlaw: allowed, the code kept');
downedSet.delete(OUTLAW);
ok(H('__dboVampFeedRefusal', VOLK, MORTAL, {}) === '' && H('__dboVampFeedRefusal', VOLK, NPC, { onCorpse: true }) === '', 'the other lines feed as before');
// breaking the code
globalThis.__dboSuperKilledBy.set(NPC, RAVEN);
ok(H('__dboVampFeedRefusal', RAVEN, NPC, { onCorpse: true }) === '', 'a body they slew themselves: the feed goes ahead...');
ok(!M.codeBroken(RAVEN), '...the code holds until it ends');
H('__dboVampFed', RAVEN, NPC, 'body');
ok(M.codeBroken(RAVEN) && calls.some((c) => c[0] === 'thirst' && c[1] === RAVEN && c[2] === 4), '...then it breaks: the thirst at stage 4', calls);
ok(near(H('__dboVampSunMult', RAVEN), 1.5), '...the sun 1.5x as hard', H('__dboVampSunMult', RAVEN));
ok(M.beginFeral(RAVEN, 'test') === true, '...and the Feral can take them');
ok(/broke the Ravenwatch code/.test(audits.join('\n')), '...audited');
M.endFeral(RAVEN, 'test');
clock += 25 * 3600000;
ok(!M.codeBroken(RAVEN) && M.beginFeral(RAVEN, 'test') === false, 'after 24 hours the penalty is over and the comfort is back');
// a second breach within seven days: cast out
H('__dboVampFed', RAVEN, NPC, 'body');
ok(!M.codeBroken(RAVEN) && !calls.some((c) => c[0] === 'leave') && getp(RAVEN, 'private.dboRavenCode').breaches.length === 1, 'a feed that ends without the code\'s pass is no breach (only the refusal decides)', getp(RAVEN, 'private.dboRavenCode'));
downedSet.add(MORTAL); downedBy.set(MORTAL, RAVEN);
ok(H('__dboVampFeedRefusal', RAVEN, MORTAL, { onCorpse: true }) === '', 'a player they downed themselves: allowed, as a breach to come');
H('__dboVampFed', RAVEN, MORTAL, 'body');
ok(calls.some((c) => c[0] === 'leave' && c[1] === RAVEN && c[2] === 'house-ravenwatch') && M.bloodlineOf(RAVEN).id === 'bloodfiend', 'a second breach within 7 days: House Ravenwatch casts them out, a bloodfiend now', calls);
ok(/casts you out/.test(lastSaid(RAVEN)), '...and they are told');
// a Feral kill breaks it too
reset(); vampires.get(RAVEN).stage = 4; setp(RAVEN, 'private.dboRavenCode', { breaches: [], until: clock + 3600000 });
M.beginFeral(RAVEN, 'test');
globalThis.__dboFeralKilled(RAVEN, MORTAL);
ok((M.S.feral.has(RAVEN) === false) && (getp(RAVEN, 'private.dboRavenCode').breaches.length === 1), 'a Feral\'s kill is a breach of the code', getp(RAVEN, 'private.dboRavenCode'));

// ---- the four lines ------------------------------------------------------------------------------------------------
reset();
ok(near(H('__dboBloodlineTargetMult', MORTAL, VOLK, FROST_SPELL), 0.85) && H('__dboBloodlineTargetMult', MORTAL, VOLK, FIRE_SPELL) === 1, 'Volkihar: frost lands at 85%, fire as before');
H('__dboVampFed', VOLK, MORTAL, 'living');
const chill = packets.find(([a, p]) => a === MORTAL && p.customPacketType === 'dboStatus');
ok(chill && chill[1].kind === 'chill' && chill[1].seconds === 6 && chill[1].speedMult === -40, 'Volkihar: a living feed chills the victim (the dboStatus chill, 6 s at -40)', chill);
packets.length = 0; H('__dboVampFed', VOLK, NPC, 'body');
ok(!packets.length, '...a body is not chilled');
ok(H('__dboVampTellsShift', CYRO) === 1 && H('__dboVampTellsShift', VOLK) === 0, 'Cyrodiilic: passes for mortal one stage of thirst longer');
ok(near(H('__dboVampSunMult', CYRO), 1.25) && H('__dboVampSunMult', VOLK) === 1, 'Cyrodiilic: the sun x1.25');
ok(near(H('__dboVampTakenMult', CYRO, MORTAL, FIRE_SPELL, true), 1.25) && H('__dboVampTakenMult', CYRO, MORTAL, SWORD, false) === 1, 'Cyrodiilic: fire x1.25, a blade as before');
ok(near(H('__dboVampTakenMult', KEER, MORTAL, SWORD, false), 1.1) && H('__dboVampTakenMult', KEER, KEER, SWORD, false) === 1, 'Keerilth: every blow from another x1.1');
cmds.get('mist')(KEER);
ok(H('__dboVampMist', KEER) === true && /come apart into mist/.test(lastSaid(KEER)), 'Keerilth: /mist, untouchable');
clock += 5000;
ok(H('__dboVampMist', KEER) === false, '...for 4 seconds');
cmds.get('mist')(KEER);
ok(/will not come again yet/.test(lastSaid(KEER)) && H('__dboVampMist', KEER) === false, '...then not again for 10 minutes');
clock += 10 * 60000; cmds.get('mist')(KEER);
ok(H('__dboVampMist', KEER) === true, '...and again after');
cmds.get('mist')(VOLK);
ok(/Only the Keerilth blood/.test(lastSaid(VOLK)) && H('__dboVampMist', VOLK) === false, 'no other line has the mist');
ok(near(H('__dboBloodlineAttackMult', BERNE, MORTAL, SWORD, { sneak: true }), 1.15), 'Berne: a sneak attack x1.15');
ok(near(H('__dboBloodlineAttackMult', BERNE, MORTAL, UNARMED, {}), 1.15) && near(H('__dboBloodlineAttackMult', BERNE, MORTAL, UNARMED, { sneak: true }), 1.15 * 1.15), 'Berne: a fist x1.15, a sneaking fist both');
setp(BERNE, 'private.beast', { form: 'vampirelord' });
ok(H('__dboBloodlineAttackMult', BERNE, MORTAL, UNARMED, {}) === 1, '...a Vampire Lord\'s claws are no Berne fist');
setp(BERNE, 'private.beast', null);
ok(near(H('__dboBloodlineAttackMult', BERNE, MORTAL, FIRE_SPELL, { spell: true, sneak: true }), 0.9), 'Berne: their spells x0.9 (no sneak share)');
ok(H('__dboBloodlineAttackMult', BERNE, BERNE, SWORD, { sneak: true }) === 1 && H('__dboBloodlineAttackMult', MORTAL, BERNE, SWORD, { sneak: true }) === 1, 'never on oneself, nothing for a mortal');
ok(H('__dboBloodlineAttackMult', VOLK, MORTAL, DRAIN, {}) === 1, 'Drain is untouched for the other lines');
// /bloodline speaks of the line first
said.length = 0; cmds.get('bloodline')(CYRO);
ok(/^The Cyrodiilic blood: you pass for mortal 1 stage of thirst longer, but the sun and fire hurt you 25% and 25% more\.$/.test(said[0] && said[0][1]), '/bloodline: the line\'s gift and cost', said[0]);

// ---- the switch ------------------------------------------------------------------------------------------------------
M = load({ bloodlines: { enabled: false } }); reset();
vampires.get(FIEND).stage = 4; patrons.set(FIEND, 'molagbal'); setp(FIEND, 'private.molagDevotion', { points: 400 });
ok(M.bloodlineOf(FIEND) === null && near(M.feralChance(FIEND, vampires.get(FIEND)), 0.04 * 0.25) && M.tierOf(FIEND).name === 'Chosen', 'bloodlines.enabled false: no lines, no bloodfiend rules', [M.feralChance(FIEND, vampires.get(FIEND)), M.tierOf(FIEND)]);
ok(H('__dboVampFeedRefusal', RAVEN, MORTAL, {}) === '' && H('__dboBloodlineAttackMult', RAVEN, MORTAL, DRAIN, {}) === 1 && H('__dboVampTellsShift', CYRO) === 0 && H('__dboVampMist', KEER) === false && H('__dboVampCrownRefusal', FIEND) === '', '...and every hook neutral');
M = load({ bloodlines: { lines: { berne: { sneakMult: 1.2 } } } }); reset();
ok(near(H('__dboBloodlineAttackMult', BERNE, MORTAL, SWORD, { sneak: true }), 1.2) && near(H('__dboBloodlineAttackMult', BERNE, MORTAL, FIRE_SPELL, {}), 0.9), 'a partial override keeps the rest of the line');

// ---- the wiring ----------------------------------------------------------------------------------------------------
const src = (f) => fs.readFileSync(path.join(SERVER, f), 'utf8');
const sn = src('supernatural.js'), gm = src('gamemode.js'), gu = src('guilds.js');
ok(/const tellsShown = \(s, a\) => .*>= tellsStage\(a\);/.test(sn) && !/tellsShown\(s\)/.test(sn) && /vampPath\('__dboVampTellsShift', a >>> 0\)/.test(sn), 'supernatural.js: the tells stage per vampire, every caller passes the actor');
ok(/globalThis\.__dboVampIsDrain = \(src\) => VAMP_DRAIN_SET\.has/.test(sn), 'supernatural.js: the Drain spells, for Ravenwatch');
ok(/vampPath\('__dboVampFeedRefusal', a, t, \{ onCorpse: !!o\.onCorpse, willing: !!o\.willing, seduced: !!o\.seduced, long: !!o\.long \}\); if \(no\) \{ personal\(a, String\(no\)\); return false; \}/.test(sn), 'supernatural.js startFeed: the code refuses before a feed starts');
ok(/\* vampPathMult\('__dboVampBloodMult', a >>> 0\)\)/.test(sn), 'supernatural.js: the blood rank a feed gives, by line');
ok((sn.match(/vampPath\('__dboVampCrownRefusal'/g) || []).length === 2, 'supernatural.js: both claims to the Crown (vacant, and by slaying) ask');
ok(/Math\.max\(1, vampPathMult\('__dboVampTakenMult', tgt >>> 0, agg >>> 0, Number\(src\) >>> 0, isFireSource\(src\)\)\)/.test(sn), 'supernatural.js: a line\'s weakness on top of the chain, only ever more');
ok(/globalThis\.__dboVampMist\(tgt\) \|\| \(agg !== tgt && globalThis\.__dboVampMist\(agg\)\)\)\) return false;/.test(gm), 'gamemode.js: the mist at the ethereal gate');
ok(/globalThis\.__dboBloodlineTargetMult\(agg, tgt, src\)\); if \(b >= 0\) targetSide \*= b;/.test(gm) && gm.indexOf('__dboBloodlineTargetMult(agg') < gm.indexOf('racial.capTargetSide(targetSide'), 'gamemode.js: a line\'s resistance on the target side, under the racial cap');
ok(/globalThis\.__dboBloodlineAttackMult\(agg, tgt, src, flags\)\); if \(b >= 0\) mult \*= b;/.test(gm), 'gamemode.js: a line\'s blows on the attacker side');
ok(/inEditor, fitsElement, isMagicSource \}\);/.test(gm) && /'__dboVampJoinRefusal', '__dboVampMist'\]\) globalThis\[k\] = null;/.test(gm), 'gamemode.js: vampirepath gets the element readers; a failed load clears the new hooks');
ok(/globalThis\.__dboVampJoinRefusal\(a >>> 0, fid\) : ''; if \(no\) return String\(no\);/.test(gu) && gu.indexOf('__dboVampJoinRefusal') > gu.indexOf('const setMember = '), 'guilds.js setMember: the one write every join goes through asks');
ok(!/mp\.on\(/.test(src('vampirepath.js')), 'vampirepath.js adds no mp.on listener');
const cfg = JSON.parse(src('gamemode-config.json')).vampirePath.bloodlines;
ok(cfg && cfg.enabled === true && cfg.clans['house-ravenwatch'] === 'ravenwatch' && cfg.bloodfiend.feralMult === 1.5 && cfg.bloodfiend.maxTier === 0 && cfg.ravenwatch.powerMult === 0.5, 'gamemode-config.json vampirePath.bloodlines: on, the clans, the bloodfiend and Ravenwatch numbers');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
