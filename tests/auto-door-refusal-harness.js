// A refused dungeon door that is automatic steps the player back (/bug 2026-10-01 01:43, Plundered Mine): an automatic
// load door (DOOR FNAM 0x02, AutoLoadDoor01) starts the engine's load before the server answers, and a refusal left the
// Fader and Mist menus up and the player frozen. dungeons.js now also moves the refused player onto the entrance's
// outside marker. Real dungeons.js, two dungeons claimed by someone else: one behind an automatic door, one normal.
//   node tests/auto-door-refusal-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const DUNGEONS = path.resolve(__dirname, '..', 'dungeons.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-autodoor-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
global.setTimeout = () => 0;
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const W = 'a764b:BSHeartland.esm';
const entrance = (out, inside, pos) => ({ outsideDesc: out, insideDesc: inside, world: W, cell: 'a7646:BSHeartland.esm', pos, rot: [0, 0, 1.5708], insidePos: [0, 0, 0], insideCell: '9999:BSHeartland.esm' });   // verify-formids: ignore (fixture ids)
const MINE = { id: 'CYRPlunderedMineLocation', name: 'Plundered Mine', type: 'mine', cells: [{ desc: '1111:BSHeartland.esm' }], chests: [], zones: [], entrances: [entrance('35f7:BSHeartland.esm', '35f8:BSHeartland.esm', [87525, 209776, 2648])] };   // verify-formids: ignore (fixture ids)
const FORT = { id: 'CYRFortHorunnLocation', name: 'Fort Horunn', type: 'fort', cells: [{ desc: '2222:BSHeartland.esm' }], chests: [], zones: [], entrances: [entrance('5000:BSHeartland.esm', '5001:BSHeartland.esm', [1000, 2000, 300])] };   // verify-formids: ignore (fixture ids)
fs.writeFileSync('dungeons.json', JSON.stringify({ dungeons: [MINE, FORT] }));

const ids = new Map(); let next = 0x01000000;
const idOf = (d) => { const k = String(d).toLowerCase(); if (!ids.has(k)) ids.set(k, next++); return ids.get(k); };
const AUTO_BASE = '31897:Skyrim.esm', NORMAL_BASE = '60010f:BSAssets.esm';
const baseOf = new Map([[idOf('35f7:BSHeartland.esm'), AUTO_BASE], [idOf('5000:BSHeartland.esm'), NORMAL_BASE]]);   // verify-formids: ignore (fixture ids)
const records = new Map([[idOf(AUTO_BASE), { type: 'DOOR', fields: [{ type: 'FNAM', data: new Uint8Array([0x02]) }] }], [idOf(NORMAL_BASE), { type: 'DOOR', fields: [{ type: 'FNAM', data: new Uint8Array([0x00]) }] }]]);
// The doors' own plugin records carry their base (NAME): the census reads that, not the reference (1 Nov: mp.get of each door
// is a native load, 11 s after every boot)
const u32 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
for (const [door, base] of baseOf) records.set(door, { type: 'REFR', fields: [{ type: 'NAME', data: u32(idOf(base)) }] });
let baseDescReads = 0;
const everyFns = new Map();
const A = 0x14, PID = 3, OTHER = 9;
const moves = [], said = [], logs = [], widgets = [];
const lease = (d) => ({ id: d.id, name: d.name, difficulty: 'normal', leader: OTHER, members: new Set([OTHER]), startedAt: Date.now(), endsAt: Date.now() + 3600000, warned: false,
  lastInsideAt: Date.now(), locked: new Map(), zones: [], seenNpcs: new Set(), deadNpcs: new Set(), bossZones: new Set(), bossIds: new Set(), looted: new Set(), unlocked: new Set() });
globalThis.__dboDungeons = { leases: new Map([[MINE.id, lease(MINE)], [FORT.id, lease(FORT)]]), parties: new Map(), memberOf: new Map(), invites: new Map(), pending: new Map() };
globalThis.__dboDungeonsBooted = true;
delete globalThis.__dboAutoDoorBases;
require(DUNGEONS)({
  mp: {
    get: (id, p) => (p === 'profileId' ? (id === A ? PID : -1) : p === 'baseDesc' ? (baseDescReads++, baseOf.get(id >>> 0)) : undefined),
    set: (id, p, v) => { if (p === 'locationalData') moves.push([id, v]); },
    getIdFromDesc: idOf, lookupEspmRecordById: (id) => (records.has(id >>> 0) ? { record: records.get(id >>> 0), toGlobalRecordId: (x) => x >>> 0 } : null),
  },
  log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push(t), system: (a, t) => said.push(t), audit: () => {},
  registerChatCommand: () => {}, onUi: () => {}, openWidget: (a, w) => { widgets.push(w); return true; }, closeWidget: () => true,
  sendPacket: () => true, findByName: () => 0, display: () => 'P', who: () => 'P', profileOf: (a) => (a === A ? PID : -1), nameOf: () => 'P',
  onlineActors: () => [A], isAdmin: () => false, giveItem: () => true, cfg: {}, every: (name, ms, fn) => everyFns.set(name, fn),
});
// The census runs in slices after boot (CAPACITY_PLAN, 24 Oct), one door per tick
const census = everyFns.get('dungeons.doorCensus');
for (let i = 0; census && i < 10; i++) census();
ok(logs.some((l) => /1 of 2 entrance doors are automatic/.test(l)), 'after boot the automatic entrances are counted from the door records (1 of 2)', logs.filter((l) => /automatic/.test(l)));
ok(baseDescReads === 0, 'the census reads the base of each door from its plugin record, never the reference itself', baseDescReads);

// Refused at the automatic mine door: the message stays, and the player is put on the outside marker
const mineDoor = idOf('35f7:BSHeartland.esm');
let v = globalThis.__dboDungeonActivate(mineDoor, A);
ok(v === false && said.some((t) => /Someone is inside Plundered Mine/.test(t)), 'the refusal and its message are kept');
ok(moves.length === 1 && moves[0][1].cellOrWorldDesc === W && moves[0][1].pos.join() === '87525,209776,2648' && Math.abs(moves[0][1].rot[2] - 90) < 0.01,
  'a refusal at the automatic door steps the player back onto the entrance\'s outside marker (rotation in degrees)', moves);
// A second walk-in within the swallow window: no second message, but still the step back
said.length = 0;
globalThis.__dboDungeonActivate(mineDoor, A);
ok(moves.length === 2 && !said.length, 'walking into it again a moment later steps them back again, without a second message', { moves: moves.length, said });

// Refused at a normal door: message only, nobody is moved
moves.length = 0; said.length = 0;
const fortDoor = idOf('5000:BSHeartland.esm');   // verify-formids: ignore (fixture ids)
const realNow = Date.now; Date.now = () => realNow() + 5000;   // past the swallow window
v = globalThis.__dboDungeonActivate(fortDoor, A);
Date.now = realNow;
ok(v === false && said.some((t) => /Someone is inside Fort Horunn/.test(t)) && !moves.length, 'a refusal at a normal door moves nobody', { moves, said });

// Not refused: the claim panel opens at the automatic door and the player stays where they are
globalThis.__dboDungeons.leases.delete(MINE.id);
moves.length = 0; widgets.length = 0;
Date.now = () => realNow() + 10000;
globalThis.__dboDungeonActivate(mineDoor, A);
Date.now = realNow;
ok(!moves.length && widgets.some((w) => w.type === 'dungeonGate'), 'an automatic door that is not refused opens the claim panel and moves nobody', { moves, widgets: widgets.map((w) => w.type) });

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
