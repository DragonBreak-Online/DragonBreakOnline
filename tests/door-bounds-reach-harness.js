// Scripted test for plugin doors in gamemode.js's activate chain (#bugs 17 Oct, Whiterun Bakery and Hearth-Healer's
// Hall: "the ladder doesn't work, can't reach the upper floor"). SurWR's ladders up are load doors on a Hearthfire
// trapdoor base (BYOHBYOHWRtowerLTrapDoor01, OBND -730,-57,254 .. -609,57,764, each ref scaled 0.77): the ref sits 338
// units under the floor and the ladder itself stands 469-562 units along the door's X axis, so the chain's 6.5 m reach
// from the ref point refused every climb. It cuts doorBoundsInReach out of the gamemode and runs it on the plugins' own
// positions and scales.
//
//   node tests/door-bounds-reach-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined && !ok ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const a = src.indexOf('// A plugin door whose reference point is far from its own mesh');
const b = src.indexOf("// A hold's treasury chest", a);
check('the door bounds helper is in gamemode.js', a >= 0 && b > a);
check('the reach check in the chain lets a plugin door within its bounds through',
  /distanceMeters\(caster, target\) > 6\.5 && !\(typeof hawkBodyInReach === 'function' && hawkBodyInReach\(caster, target, q\)\) && !\(typeof doorBoundsInReach === 'function' && doorBoundsInReach\(caster, target, q\)\)\) return false;/.test(src));
// The chain's own reach line, run as it stands (before the fix it has no door clause)
const lineM = src.match(/^[ \t]*if \(Array\.isArray\(q\) && mp\.get\(caster, 'type'\) === 'MpActor' && distanceMeters\(caster, target\) > 6\.5.*return false;$/m);
check('the chain still has its 6.5 m reach line', !!lineM);
const helperSrc = a >= 0 && b > a ? src.slice(a, b) : 'const doorBoundsInReach = undefined;';

// Records as mp.lookupEspmRecordById gives them: OBND is six little-endian int16
const obnd = (v) => { const d = new Uint8Array(12); const dv = new DataView(d.buffer); v.forEach((x, i) => dv.setInt16(i * 2, x, true)); return { type: 'OBND', data: d }; };
// A ref's XSCL is one little-endian float32
const xscl = (k) => { const d = new Uint8Array(4); new DataView(d.buffer).setFloat32(0, k, true); return { type: 'XSCL', data: d }; };
const LADDER_UP = 0x3b6d, TRAPDOOR = 0x3b6c, CHEST = 0x1234, PLAIN_DOOR = 0x29cb0;
const RECORDS = {
  [LADDER_UP]: { type: 'DOOR', editorId: 'BYOHBYOHWRtowerLTrapDoor01', fields: [obnd([-730, -57, 254, -609, 57, 764])] },
  [TRAPDOOR]: { type: 'DOOR', editorId: 'BYOHBYOHWRtowerKTrapDoor02', fields: [obnd([-53, -62, -5, 53, 28, 5])] },
  [CHEST]: { type: 'CONT', editorId: 'BarrelFood01', fields: [obnd([-730, -57, 254, -609, 57, 764])] },
  [PLAIN_DOOR]: { type: 'DOOR', editorId: 'FarmhouseLDoor01', fields: [obnd([-61, -9, 0, 61, 9, 230])] },
};
const props = new Map();
let lookups = 0;
const mp = {
  get: (id, p) => props.get(`${id >>> 0}|${p}`),
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
  lookupEspmRecordById: (id) => { lookups++; const r = RECORDS[id >>> 0]; return r ? { record: r } : { record: null }; },
};
const UNITS_PER_METER = 70;
const doorBoundsInReach = new Function('mp', 'UNITS_PER_METER', `${helperSrc}; return doorBoundsInReach;`)(mp, UNITS_PER_METER);
const BAKERY = '76e4a:SurWR.esp';
const put = (id, base, cell, pos, angle) => { props.set(`${id >>> 0}|baseDesc`, `${base.toString(16)}:x`); props.set(`${id >>> 0}|worldOrCellDesc`, cell); props.set(`${id >>> 0}|pos`, pos); props.set(`${id >>> 0}|angle`, angle); };
const P = 0xff000100;
const at = (pos, cell) => { props.set(`${P}|worldOrCellDesc`, cell || BAKERY); props.set(`${P}|pos`, pos); };
const reach = (door) => typeof doorBoundsInReach === 'function' && doorBoundsInReach(P, door, mp.get(door, 'pos'));
const distanceMeters = (x, y) => { if (mp.get(x, 'worldOrCellDesc') !== mp.get(y, 'worldOrCellDesc')) return Infinity; const p = mp.get(x, 'pos'), q = mp.get(y, 'pos'); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / UNITS_PER_METER; };
// What the activate chain answers: false = refused by the reach line
const chainLets = (door) => new Function('mp', 'distanceMeters', 'doorBoundsInReach', 'caster', 'target', 'q',
  `const hawkBodyInReach = () => false; try { ${lineM ? lineM[0] : 'return false;'} } catch (e) { } return true;`)(
  Object.assign({}, mp, { get: (id, k) => (k === 'type' ? ((id >>> 0) === P ? 'MpActor' : 'MpObjectReference') : mp.get(id, k)) }), distanceMeters, doorBoundsInReach, P, door, mp.get(door, 'pos'));
const dist = (door) => { const p = mp.get(P, 'pos'), q = mp.get(door, 'pos'); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / UNITS_PER_METER; };

// The Bakery's two ladder doors (SurWR.esp 76f9b up, 76fa4 down), as the plugin places them; the Hearth-Healer's Hall's
// pair (c8566/c8543) stand at the same spots in its copy of the room
const UP = 0x1b076f9b, DOWN = 0x1b076fa4;
RECORDS[UP] = { type: 'REFR', fields: [xscl(0.77)] };
RECORDS[DOWN] = { type: 'REFR', fields: [xscl(0.9)] };
put(UP, LADDER_UP, BAKERY, [97.2, -981.3, -338.4], [0, 0, 270]);
put(DOWN, TRAPDOOR, BAKERY, [97.6, -1456.7, 254.1], [0, 0, 0]);

at([82, -1467, 0]);      // where the way down lands you: the foot of the ladder
check('the foot of the ladder is 8.5 m from the ladder door\'s ref point (beyond the plain 6.5 m reach)', dist(UP) > 6.5, dist(UP));
check('the activate chain lets the climb up through from the foot of the ladder', chainLets(UP) === true);
at([97, -1600, 0]);
check('...and from right against the ladder', chainLets(UP) === true);
at([97, -300, 0]);
check('the chain still refuses the ladder from across the room', chainLets(UP) === false);
at([82, -1467, 0]);
check('the door bounds let the climb through', reach(UP) === true);
at([97, -1600, 0]);
check('standing against the ladder is in reach', reach(UP) === true);
at([97, -1650, 120]);
check('halfway up the ladder is in reach', reach(UP) === true);
at([97, -1500, 0]);
check('right under the trapdoor down, where the scaled ladder stands, is in reach', reach(UP) === true);
at([97, -300, 0]);
check('across the room, 16 m from the ladder, is refused', reach(UP) === false);
at([650, -1650, 0]);
check('7.1 m to the side of the ladder is refused', reach(UP) === false);
at([97, -1600, 0], '3c:Skyrim.esm');
check('another cell is refused', reach(UP) === false);
at([37, -1438, 254]);
check('upstairs by the trapdoor down: in reach by its own small bounds too', reach(DOWN) === true);

// Turning: the same ladder turned 90 degrees instead of 270 puts its box on the other side of the ref point
put(0x1b000001, LADDER_UP, BAKERY, [0, 0, 0], [0, 0, 90]);
at([0, 669, 300]);
check('turned 90: the box is along +Y (clockwise turn, as the engine and traps.js)', reach(0x1b000001) === true);
at([0, -669, 300]);
check('turned 90: the opposite side is refused', reach(0x1b000001) === false);
put(0x1b000002, LADDER_UP, BAKERY, [0, 0, 0], [0, 0, 0]);
at([-669, 0, 300]);
check('not turned: the box is along -X', reach(0x1b000002) === true);
put(0x1b000003, LADDER_UP, BAKERY, [0, 0, 0], [30, 0, 270]);
at([0, -669, 300]);
check('a tilted door keeps the plain reach', reach(0x1b000003) === false);
put(0x1b00000a, LADDER_UP, BAKERY, [0, 0, 0], [360, -0.5, 0]);
at([-669, 0, 300]);
check('an X angle of 360 (or -0.5) is level, not tilted', reach(0x1b00000a) === true);

// Scale: the bounds grow and shrink with the ref's XSCL, as the mesh does
RECORDS[0x1b000008] = { type: 'REFR', fields: [xscl(0.5)] };
put(0x1b000008, LADDER_UP, BAKERY, [0, 0, 0], [0, 0, 0]);
at([-1180, 0, 300]);
check('a door scaled 0.5: 11.6 m from its scaled bounds is refused (6.4 m from the unscaled ones)', reach(0x1b000008) === false);
at([-500, 0, 250]);
check('a door scaled 0.5: next to its scaled bounds is in reach', reach(0x1b000008) === true);
RECORDS[0x1b000009] = { type: 'REFR', fields: [xscl(2)] };
put(0x1b000009, LADDER_UP, BAKERY, [0, 0, 0], [0, 0, 0]);
at([-1860, 0, 600]);
check('a door scaled 2: 5.7 m from its scaled bounds is in reach (16 m from the unscaled ones)', reach(0x1b000009) === true);
RECORDS[0x1b00000b] = { type: 'REFR', fields: [xscl(0)] };
put(0x1b00000b, LADDER_UP, BAKERY, [0, 0, 0], [0, 0, 0]);
at([-669, 0, 300]);
check('a broken scale of 0 counts as 1', reach(0x1b00000b) === true);

// Only plugin doors
put(0x1b000004, CHEST, BAKERY, [97.2, -981.3, -338.4], [0, 0, 270]);
at([97, -1600, 0]);
check('a container with the same bounds is not let through', reach(0x1b000004) === false);
put(0xff000200, LADDER_UP, BAKERY, [97.2, -981.3, -338.4], [0, 0, 270]);
check('a runtime (0xff) ref is never let through', reach(0xff000200) === false);
put(0x1b000005, PLAIN_DOOR, BAKERY, [0, 0, 0], [0, 0, 0]);
at([0, 700, 0]);
check('an ordinary door 10 m away is still refused', reach(0x1b000005) === false);
at([0, 400, 0]);
check('an ordinary door 5.6 m away is in reach (as before)', reach(0x1b000005) === true);
props.set(`${0x1b000006}|baseDesc`, undefined);
check('a ref with no base is not let through', reach(0x1b000006) === false);
put(0x1b000007, 0x999999, BAKERY, [0, 0, 0], [0, 0, 0]);
check('a base the load order does not have is not let through', reach(0x1b000007) === false);

const before = lookups;
for (let i = 0; i < 50; i++) reach(UP);
check('the records are looked up once per base and ref, not per activation', lookups === before, lookups - before);

console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
