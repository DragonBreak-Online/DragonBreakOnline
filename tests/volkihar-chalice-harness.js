// Castle Volkihar's Bloodstone Chalice (Nate, 24 Oct, fac-0336: "make them work"): Dawnguard's DLC1BloodChaliceActivatorEmpty
// (141a1, on JK's shrine of Molag Bal) did nothing, its use being a quest script SkyMP never runs. A vampire now drinks from
// it once a game day, a meal like a Blood Potion's; anyone else is turned from it. Loads the real supernatural.js (with
// racial.js, greathunt.js, bloodranks.js) against an mp stub.
//   node tests/volkihar-chalice-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-chalice-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

const DESCS = {};
const cfgFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
const store = new Map();
const timers = {};
const cmds = {};
const told = [];
const audits = [];
const noop = () => {};
let days = 20.5;
globalThis.__dboClock = { gameDays: () => days, summary: () => ({ timeScale: 6 }), isNight: () => false, isFullMoon: () => false };
globalThis.__dboSuperState = { crown: { holder: 999, name: 'K', since: Date.now() }, revoke: [] };
const mp = {
  get: (id, p) => (p === 'type' ? 'MpActor' : store.get(`${id}|${p}`)),
  set: (id, p, v) => { store.set(`${id}|${p}`, v); },
  getDescFromId: (id) => ((id >>> 0) === CHALICE ? '141a1:Dawnguard.esm' : `${id.toString(16)}:x`),
  getIdFromDesc: (d) => { if (DESCS[d]) return DESCS[d]; const [hex, plugin] = String(d).split(':'); return plugin === 'Skyrim.esm' ? parseInt(hex, 16) : 0x1234; },
  callPapyrusFunction: () => null,
  lookupEspmRecordById: () => null,
};
const VAMP = 0x2f6, MORTAL = 0x2f7, CHALICE = 0x020141a1, BARREL = 0x0300aaaa;
const cfg = { goblinRace: cfgFile.goblinRace, snowElfRace: cfgFile.snowElfRace, racial: { enabled: true, overhaul: true }, supernatural: {} };
const api = {
  mp, log: noop, audit: (t) => audits.push(t), personal: (a, t) => told.push({ a, t }), system: noop, registerChatCommand: (n, f) => { cmds[n] = f; },
  onUi: noop, openWidget: noop, closeWidget: noop, sendPacket: noop, display: String, who: String, isAdmin: () => true,
  findByName: (n) => (n === 'mortal' ? MORTAL : VAMP), onlineActors: () => [VAMP, MORTAL], every: (k, ms, f) => { timers[k] = f; }, profileOf: (a) => (a < 0x10000 ? a : -1),
  nameOf: String, isWorldspace: () => true, needsFeed: noop, hungerOf: () => 0, zoneOfActor: () => null, zoneById: () => null, cfg,
  hasUiCap: () => true, recordOf: () => null, giveItem: () => true, weaponHandsOf: () => '', sourceResistsOf: () => new Set(),
};
let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 400)}`); if (!c) fail++; };
require(path.resolve(ROOT, 'racial.js'))(api);
for (const f of ['greathunt.js', 'bloodranks.js', 'supernatural.js']) require(path.resolve(ROOT, f))(api);

for (const a of [VAMP, MORTAL]) {
  store.set(`${a}|appearance`, { raceId: 0x13746, isFemale: false, headpartIds: [], skinColor: 0, tints: [] });
  store.set(`${a}|private.supernatural`, { kind: null, disease: null });
  store.set(`${a}|worldOrCellDesc`, '803:Dawnguard.esm'); store.set(`${a}|pos`, [0, 0, 0]);
}
cmds.curse(VAMP, 'me vampire');
const sup = () => store.get(`${VAMP}|private.supernatural`);
ok(sup().kind === 'vampire' && !!sup().unfed, 'a new vampire, unfed');

const act = (t, a) => { told.length = 0; return globalThis.__dboSuperActivate(t, a); };
ok(act(CHALICE, MORTAL) === true && told.some((x) => x.a === MORTAL && /not meant for the living/.test(x.t)), 'a mortal at the chalice is turned from it', told);
ok(act(CHALICE, VAMP) === true && !sup().unfed && sup().stage === 1 && told.some((x) => /withering lifts/.test(x.t)), 'a vampire drinks: the first meal, the withering lifts', [sup(), told]);
ok(audits.some((t) => /drank from the Bloodstone Chalice/.test(t)), '...audited', audits);
ok(act(CHALICE, VAMP) === true && told.some((x) => /will not fill for you again until tomorrow/.test(x.t)), 'once a game day: a second drink is refused', told);
days += 1;
ok(act(CHALICE, VAMP) === true && told.some((x) => /You drink from the Bloodstone Chalice\. The thirst recedes/.test(x.t)), 'the next game day it fills again', told);
ok(act(BARREL, MORTAL) !== true || !told.some((x) => /chalice/i.test(x.t)), 'anything else is not the chalice', told);

console.log(fail ? `${fail} failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
