// A claim on a reference the load order no longer has (the 21 Oct order moved DragonBreak Online Edits from 48 to 49, and
// housing.json still lists 48172d19 and 4812ae14; 80d9643 is a door the DLE deleted) throws "doesn't exist" on every read,
// and the server logs each one: rest.js, business.js and ledgersale.js scan the registry on every login, bed and shop sale,
// about 2 error lines a minute. housingSystem.ts reads such a reference once (its gone memo); the gameplay modules that
// read the registry themselves must do the same, and a gone claim must not cost the live ones (worldstats.js summed a
// profile's stored gold in one try, so a gone claim dropped every claim after it). Loads the real modules with a mock
// gamemode api; no server and no game:
//
//   node tests/housing-gone-reads-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'housing-gone-reads-'));
process.chdir(dir);

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!cond) fails++; };

// Two chests on the old DLE index and the deleted Mountainwatch door, between live claims as housing.json lists them
const GONE = [0x48172d19, 0x80d9643, 0x4812ae14];
const DOOR = 0x4001, DOOR_IN = 0x4002, CHEST = 0x4003;
const TAMRIEL = '3c:Skyrim.esm', HOME = '13a5c:Skyrim.esm', INN = '13a5d:Skyrim.esm';
const CELLS = { 0x3c: 'WRLD', 0x13a5c: 'CELL', 0x13a5d: 'CELL' };
const ME = 0x14, PROFILE = 101;
fs.writeFileSync('housing.json', JSON.stringify([GONE[0], DOOR, GONE[1], GONE[2]]));

const props = new Map();
const put = (id, prop, v) => props.set(`${id >>> 0}|${prop}`, v);
put(DOOR, 'worldOrCellDesc', TAMRIEL); put(DOOR_IN, 'worldOrCellDesc', HOME); put(CHEST, 'worldOrCellDesc', HOME);
put(DOOR, 'private.housing', { owner: PROFILE, ownerName: 'Me', partner: DOOR_IN, containers: [CHEST] });
put(CHEST, 'inventory', { entries: [{ baseId: 0xf, count: 250 }] });
put(ME, 'profileId', PROFILE); put(ME, 'appearance', { name: 'Me', raceId: 0x13746 }); put(ME, 'inventory', { entries: [] });

const reads = new Map();
const goneReads = () => GONE.reduce((n, id) => n + (reads.get(id) || 0), 0);
const mp = {
  get: (id, prop) => {
    const r = id >>> 0;
    reads.set(r, (reads.get(r) || 0) + 1);
    if (GONE.includes(r)) throw new Error(`Form with id 0x${r.toString(16)} doesn't exist`);
    return props.get(`${r}|${prop}`);
  },
  set: (id, prop, v) => { put(id, prop, v); },
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
  getDescFromId: (id) => (id >>> 0).toString(16),
  lookupEspmRecordById: (id) => (CELLS[id >>> 0] ? { record: { type: CELLS[id >>> 0] } } : null),
  getActorsByProfileId: (pid) => (pid === PROFILE ? [ME] : []),
  // The owner index answers the gone chest first, as a stale index entry would
  findFormsByPropertyValue: (key, value) => (key === 'private.indexed.housingOwner' && value === String(PROFILE) ? [GONE[0], CHEST] : []),
};
const timers = new Map(), commands = new Map();
const base = {
  mp, cfg: {},
  log: () => {}, personal: () => {}, system: () => {}, audit: () => {},
  display: (a) => `P${a}`, who: (a) => `P${a}`, ownDisplay: (a) => `P${a}`, publicDisplay: (a) => `P${a}`,
  onUi: () => {}, openWidget: () => true, closeWidget: () => true, sendPacket: () => true,
  registerChatCommand: (name, fn) => commands.set(name, fn), every: (name, ms, fn) => timers.set(name, fn),
  onlineActors: () => [ME], profileOf: (a) => ((a >>> 0) === ME ? PROFILE : -1), userOf: (a) => a + 1000,
  findByName: () => 0, takeGold: () => false, giveGold: () => true, giveItem: () => true, depositToTreasury: () => 0,
  zoneOfActor: () => 'whiterun', zoneById: () => null, ranksOf: () => [], distanceMeters: () => 0, isAdmin: () => false,
};
// Anything else a module asks the gamemode for is a no-op
const api = new Proxy(base, { get: (t, k) => (k in t ? t[k] : () => undefined) });
const load = (file) => { const p = path.join(ROOT, file); delete require.cache[p]; return require(p)(api); };
const fresh = () => { reads.clear(); delete globalThis.__dboGoneRefs; };

// ---- rest.js: every login scans the registry for rent held (collectOwed) --------------------------------------------
fresh(); load('rest.js');
for (let i = 0; i < 5; i++) globalThis.__dboRestLogin(ME);
ok('rest.js: five logins read each gone claim at most once', goneReads() <= GONE.length, goneReads());
ok('rest.js: ...and still read the live claim every time', (reads.get(DOOR) || 0) >= 5, reads.get(DOOR));

// ---- business.js: a shop sale asks for the business at its cell (claimAt over the registry) -------------------------
fresh(); load('business.js');
for (let i = 0; i < 5; i++) globalThis.__dboBusinessRent(mp.getIdFromDesc(HOME));
ok('business.js: five lookups read each gone claim at most once', goneReads() <= GONE.length, goneReads());
ok('business.js: ...and still read the live claim', (reads.get(DOOR) || 0) >= 5, reads.get(DOOR));

// ---- ledgersale.js: a ledger sale finds the claim on its building -----------------------------------------------------
fresh(); const ls = load('ledgersale.js');
let claim = null, none = null;
// A cell no claim covers walks the whole registry
for (let i = 0; i < 5; i++) { claim = ls.claimAt(mp.getIdFromDesc(HOME)); none = ls.claimAt(mp.getIdFromDesc(INN)); }
ok('ledgersale.js: five lookups read each gone claim at most once', goneReads() <= GONE.length, goneReads());
ok('ledgersale.js: ...and still find the live claim', !!claim && claim.primary === DOOR && claim.owner === PROFILE && none === null, [claim, none]);

// ---- worldstats.js: a gone claim neither throws away the others' gold nor is read every minute -------------------------
fresh(); load('worldstats.js');
const stats = () => JSON.parse(fs.readFileSync('server-stats.json', 'utf8'));
const snap = async () => { await timers.get('worldStats')(); for (let i = 0; i < 50 && !fs.existsSync('server-stats.json'); i++) await new Promise((r) => setTimeout(r, 10)); };
(async () => {
  try {
    for (let i = 0; i < 3; i++) { await snap(); await new Promise((r) => setTimeout(r, 20)); }
    const s = stats();
    ok('worldstats.js: the live chest\'s 250 gold is counted past a gone claim', s.gold && s.gold.stored >= 250, s.gold);
    ok('worldstats.js: three snapshots read the gone claim at most once', (reads.get(GONE[0]) || 0) <= 1, reads.get(GONE[0]));
  } catch (e) { ok(`worldstats.js: snapshot ran (${e.message})`, false); }
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
