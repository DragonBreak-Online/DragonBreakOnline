// The goblin vampire (PC 15 Oct: DBOGoblinRaceVampire 1d1fa2 in DragonBreak Online Edits.esp). config goblinRace.vampire
// pairs it with DBOGoblinRace 1aca01 the way snowElfRace pairs the Snow Elf: a goblin turned vampire wears the vampire race,
// its tells are the skin tone alone (the Goblin has no head parts, so no eyes to swap), the cure puts the race and colour
// back, the Goblin's gift stays on the vampire race, and gamemode's goblinLook (a RaceMenu close) keeps the vampire race.
// Loads the real greathunt.js, bloodranks.js, supernatural.js and racial.js against an mp stub.
// node tests/goblin-vampire-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goblin-vamp-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

const GOB = 0x481aca01, GOBV = 0x481d1fa2, SNOW = 0x481ac9ff, SNOWV = 0x481aca00;
const DESCS = { '1aca01:DragonBreak Online Edits.esp': GOB, '1d1fa2:DragonBreak Online Edits.esp': GOBV, '1ac9ff:DragonBreak Online Edits.esp': SNOW, '1aca00:DragonBreak Online Edits.esp': SNOWV };
const RACE = { type: 'RACE', fields: [] };
const RECORDS = new Map([[GOB, RACE], [GOBV, RACE], [SNOW, RACE], [SNOWV, RACE]]);
const cfgFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));

const store = new Map();
const timers = {};
const cmds = {};
const told = [];
const packets = [];
const noop = () => {};
let now = Date.UTC(2026, 9, 15, 12, 0);
Date.now = () => now;
globalThis.__dboClock = { gameDays: () => 20.5, summary: () => ({ timeScale: 6 }), isNight: () => false, isFullMoon: () => false };
globalThis.__dboSuperState = { crown: { holder: 999, name: 'K', since: now }, revoke: [] };
const mp = {
  get: (id, p) => (p === 'type' ? 'MpActor' : store.get(`${id}|${p}`)),
  set: (id, p, v) => { store.set(`${id}|${p}`, v); },
  getDescFromId: (id) => `${id.toString(16)}:x`,
  getIdFromDesc: (d) => { if (DESCS[d]) return DESCS[d]; const [hex, plugin] = String(d).split(':'); return plugin === 'Skyrim.esm' ? parseInt(hex, 16) : 0x1234; },
  callPapyrusFunction: () => null,
  lookupEspmRecordById: (id) => (RECORDS.has(id >>> 0) ? { record: RECORDS.get(id >>> 0), toGlobalRecordId: (l) => l } : null),
};
const V = 0x2f6;
const cfg = { goblinRace: cfgFile.goblinRace, snowElfRace: cfgFile.snowElfRace, racial: { enabled: true, overhaul: true } };
const api = {
  mp, log: noop, audit: noop, personal: (a, t) => told.push({ a, t }), system: noop, registerChatCommand: (n, f) => { cmds[n] = f; },
  onUi: noop, openWidget: noop, closeWidget: noop, sendPacket: (a, p) => packets.push(p), display: String, who: String, isAdmin: () => true,
  findByName: () => V, onlineActors: () => [V], every: (k, ms, f) => { timers[k] = f; }, profileOf: (a) => (a < 0x10000 ? a : -1),
  nameOf: String, isWorldspace: () => true, needsFeed: noop, hungerOf: () => 0, zoneOfActor: () => null, zoneById: () => null, cfg,
  hasUiCap: () => true, recordOf: (id) => (RECORDS.has(id >>> 0) ? { record: RECORDS.get(id >>> 0) } : null), giveItem: () => true,
  weaponHandsOf: () => '', sourceResistsOf: () => new Set(),
};
let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 400)}`); if (!c) fail++; };

ok(cfgFile.goblinRace && cfgFile.goblinRace.vampire === '1d1fa2:DragonBreak Online Edits.esp', 'config pairs goblinRace.vampire with DBOGoblinRaceVampire 1d1fa2', cfgFile.goblinRace);
const R = require(path.resolve(ROOT, 'racial.js'))(api);
for (const f of ['greathunt.js', 'bloodranks.js', 'supernatural.js']) require(path.resolve(ROOT, f))(api);

const SKIN = 0x4a7a2a, TONE = 0xff4a7a2a | 0;
const TINTS = [{ texturePath: 'Actors\\Character\\Character Assets\\TintMasks\\SkinTone.dds', type: 6, argb: TONE }];
const app = () => store.get(`${V}|appearance`);
const sup = () => store.get(`${V}|private.supernatural`);
store.set(`${V}|appearance`, { raceId: GOB, isFemale: false, headpartIds: [], skinColor: SKIN, tints: TINTS.map((x) => Object.assign({}, x)) });
store.set(`${V}|private.supernatural`, { kind: null, disease: null });
store.set(`${V}|worldOrCellDesc`, 'tamriel'); store.set(`${V}|pos`, [0, 0, 0]);
store.set(`${V}|private.rp`, { race: 'goblin' });

ok(R.raceOf(V) === 'goblin', 'a mortal goblin has the Goblin gift', R.raceOf(V));
cmds.curse(V, 'me vampire');
ok((app().raceId >>> 0) === GOBV, 'turned, the goblin wears DBOGoblinRaceVampire', app().raceId.toString(16));
ok(packets.some((p) => p.customPacketType === 'dboBeast' && (p.race >>> 0) === GOBV && p.beast === false), 'the client is sent the vampire race');
ok(!!sup().unfed && sup().look && sup().look.skinOnly === true, 'unfed, the tells are laid as skin only', sup().look);
ok((app().skinColor >>> 0) !== SKIN && (app().tints[0].argb >>> 0) !== (TONE >>> 0), 'the skin colour and the skin tone tint go pale', [app().skinColor.toString(16), (app().tints[0].argb >>> 0).toString(16)]);
ok(Array.isArray(app().headpartIds) && app().headpartIds.length === 0, 'no head part is added (no eyes on a goblin)', app().headpartIds);
const paled = app().skinColor;
timers.superSlow(); timers.superSlow();
ok(app().skinColor === paled && app().headpartIds.length === 0, 'slow ticks leave the pallor as it is (laid once)', [app().skinColor, paled]);
ok(R.raceOf(V) === 'goblin', 'the goblin vampire keeps the Goblin gift', R.raceOf(V));

// A RaceMenu close (gamemode.js goblinLook) must keep the vampire race: the chosen goblin is the green one, its vampire is paired
ok(globalThis.__dboGoblinRaces.includes(GOB) && !globalThis.__dboGoblinRaces.includes(GOBV), '__dboGoblinRaces stays mortal only');
ok((globalThis.__dboGoblinVampires || {})[GOB] === GOBV, '__dboGoblinVampires maps the goblin to its vampire', globalThis.__dboGoblinVampires);
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
ok(/__dboGoblinVampires/.test(gm.slice(gm.indexOf('const goblinLook'), gm.indexOf('const appearanceHook'))), 'gamemode goblinLook reads __dboGoblinVampires before resetting the race');

// A saved appearance edit while the tells show: the kept colour stays the mortal one, the pallor goes back over it
ok(globalThis.__dboTellsRetake(V, JSON.parse(JSON.stringify(app()))) === true && sup().look && sup().look.prevSkin === SKIN, 'an appearance edit keeps the mortal colour under the pallor', sup().look);

// Cured: the race and the colour come back
cmds.curse(V, 'me cure');
ok((app().raceId >>> 0) === GOB, 'cured, the goblin is DBOGoblinRace again', app().raceId.toString(16));
ok((app().skinColor >>> 0) === SKIN && (app().tints[0].argb >>> 0) === (TONE >>> 0), 'cured, the goblin has its own colour back', [app().skinColor.toString(16), (app().tints[0].argb >>> 0).toString(16)]);

// A goblin werewolf shows no tells and keeps its look
store.set(`${V}|private.supernatural`, { kind: null, disease: null });
const before = JSON.stringify(app());
cmds.curse(V, 'me werewolf');
timers.superSlow();
ok(JSON.stringify(app()) === before, 'a goblin werewolf shows nothing (no eyes)', app());

console.log(fail ? `${fail} failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
