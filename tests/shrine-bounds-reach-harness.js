// Scripted test for prayer shrines in gamemode.js's activate chain (/bug 16 Oct, "shrine of hircine near falkreath
// unusable"). DBO_ShrineOfHircine (DLE 1112C6, base 1112C5, OBND -122,-113,-399 .. 134,126,194, ref scale 0.91, turned
// 60.2) stands on the Daedric Shrines statue's plinth at (-4507.6, -83201.5, 3008.5). The reporter stood at the statue's
// foot, (-4736, -83300, 2609): 6.7 m from the ref point, so the chain's 6.5 m reach refused the prayer without a word.
// It cuts doorBoundsInReach out of the gamemode and runs the chain's own reach line on the plugin's positions.
//
//   node tests/shrine-bounds-reach-harness.js   (from server/; GAMEMODE_JS=<path> runs it against another gamemode.js)
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(process.env.GAMEMODE_JS || path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined && !ok ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const a = src.indexOf('// A plugin door whose reference point is far from its own mesh');
const b = src.indexOf("// A hold's treasury chest", a);
check('the bounds helper is in gamemode.js', a >= 0 && b > a);
const lineM = src.match(/^[ \t]*if \(Array\.isArray\(q\) && mp\.get\(caster, 'type'\) === 'MpActor' && distanceMeters\(caster, target\) > 6\.5.*return false;$/m);
check('the chain still has its 6.5 m reach line', !!lineM);
const helperSrc = a >= 0 && b > a ? src.slice(a, b) : 'const doorBoundsInReach = undefined;';

const obnd = (v) => { const d = new Uint8Array(12); const dv = new DataView(d.buffer); v.forEach((x, i) => dv.setInt16(i * 2, x, true)); return { type: 'OBND', data: d }; };
const xscl = (k) => { const d = new Uint8Array(4); new DataView(d.buffer).setFloat32(0, k, true); return { type: 'XSCL', data: d }; };
const HIRCINE = 0x481112c5, YFFRE = 0x481d1fbc, WATER = 0x106a25, LADDER_UP = 0x3b6d, STATUE = 0x56000d61;
const RECORDS = {
  [HIRCINE]: { type: 'ACTI', editorId: 'DBO_ShrineOfHircine', fields: [obnd([-122, -113, -399, 134, 126, 194])] },
  [YFFRE]: { type: 'ACTI', editorId: 'DBO_ShrineOfYffre', fields: [obnd([-20, -21, 0, 20, 20, 55])] },
  [WATER]: { type: 'ACTI', editorId: 'Water1024CreekFlowSW', fields: [obnd([-122, -113, -399, 134, 126, 194])] },
  [STATUE]: { type: 'STAT', editorId: 'aaaMan_HircineStatue', fields: [obnd([-122, -113, -399, 134, 126, 194])] },
  [LADDER_UP]: { type: 'DOOR', editorId: 'BYOHBYOHWRtowerLTrapDoor01', fields: [obnd([-730, -57, 254, -609, 57, 764])] },
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
const TAMRIEL = '3c:Skyrim.esm';
const put = (id, base, cell, pos, angle) => { props.set(`${id >>> 0}|baseDesc`, `${base.toString(16)}:x`); props.set(`${id >>> 0}|worldOrCellDesc`, cell); props.set(`${id >>> 0}|pos`, pos); props.set(`${id >>> 0}|angle`, angle); };
const P = 0xff000275;
const at = (pos, cell) => { props.set(`${P}|worldOrCellDesc`, cell || TAMRIEL); props.set(`${P}|pos`, pos); };
const distanceMeters = (x, y) => { if (mp.get(x, 'worldOrCellDesc') !== mp.get(y, 'worldOrCellDesc')) return Infinity; const p = mp.get(x, 'pos'), q = mp.get(y, 'pos'); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / UNITS_PER_METER; };
// What the activate chain answers: false = refused by the reach line
const chainLets = (ref) => new Function('mp', 'distanceMeters', 'doorBoundsInReach', 'caster', 'target', 'q',
  `const hawkBodyInReach = () => false; try { ${lineM ? lineM[0] : 'return false;'} } catch (e) { } return true;`)(
  Object.assign({}, mp, { get: (id, k) => (k === 'type' ? ((id >>> 0) === P ? 'MpActor' : 'MpObjectReference') : mp.get(id, k)) }), distanceMeters, doorBoundsInReach, P, ref, mp.get(ref, 'pos'));
const dist = (ref) => distanceMeters(P, ref);

// The Shrine of Hircine as the DLE places it (ref 1112C6, scale 0.91, turned 60.2)
const SHRINE = 0x481112c6;
RECORDS[SHRINE] = { type: 'REFR', fields: [xscl(0.91)] };
put(SHRINE, HIRCINE, TAMRIEL, [-4507.6, -83201.5, 3008.5], [0, 0, 60.2]);

at([-4736, -83300, 2609]);   // the reporter, /bug 16 Oct 19:47:12
check('the reporter at the statue\'s foot is 6.7 m from the shrine\'s ref point (beyond the plain 6.5 m reach)', dist(SHRINE) > 6.5 && dist(SHRINE) < 6.8, dist(SHRINE));
check('the activate chain lets the prayer through from where the reporter stood', chainLets(SHRINE) === true);
at([-4636.8, -83228.1, 2684.5]);   // on the shrine's base slab (man_DaedricShrines.esp 00080B)
check('...and from the shrine\'s base slab', chainLets(SHRINE) === true);
at([-5300, -83900, 2500]);
check('the chain still refuses the shrine from 15 m down the slope (13 m from its bounds)', chainLets(SHRINE) === false, dist(SHRINE));
at([-4736, -83300, 2609], '6c40f:BSHeartland.esm');
check('another world or cell is refused', chainLets(SHRINE) === false);

// Only shrines (and doors as before): the same bounds on another activator, a static or a runtime ref change nothing
const WATER_REF = 0x0004f52b, STATUE_REF = 0x56000827;
put(WATER_REF, WATER, TAMRIEL, [-4507.6, -83201.5, 3008.5], [0, 0, 60.2]);
put(STATUE_REF, STATUE, TAMRIEL, [-4507.6, -83201.5, 3008.5], [0, 0, 60.2]);
put(0xff000300, HIRCINE, TAMRIEL, [-4507.6, -83201.5, 3008.5], [0, 0, 60.2]);
at([-4736, -83300, 2609]);
check('an activator that is no shrine, with the same bounds, keeps the plain reach', chainLets(WATER_REF) === false);
check('a static with the same bounds keeps the plain reach', chainLets(STATUE_REF) === false);
check('a runtime (0xff) shrine copy keeps the plain reach', chainLets(0xff000300) === false);

// A small shrine (the new gods' DBO_ShrineOf* with OBND 40 x 41 x 55): in reach within 6.5 m of its bounds, as before
const Y_REF = 0x481d1fc8;
put(Y_REF, YFFRE, 'a764b:BSHeartland.esm', [53938.9, 206046.4, 8211.1], [0, 0, 107.9]);
at([54004, 206132, 8206], 'a764b:BSHeartland.esm');
check('the Shrine of Y\'ffre from 1.5 m is in reach', chainLets(Y_REF) === true);
at([54500, 206046, 8211], 'a764b:BSHeartland.esm');
check('the Shrine of Y\'ffre from 8 m is refused', chainLets(Y_REF) === false);

// Doors are unchanged (the Whiterun Bakery ladder of the door harness)
const UP = 0x1b076f9b;
RECORDS[UP] = { type: 'REFR', fields: [xscl(0.77)] };
put(UP, LADDER_UP, '76e4a:SurWR.esp', [97.2, -981.3, -338.4], [0, 0, 270]);
at([82, -1467, 0], '76e4a:SurWR.esp');
check('a plugin door is still in reach by its bounds (the Bakery ladder)', chainLets(UP) === true);
at([97, -300, 0], '76e4a:SurWR.esp');
check('...and still refused from across the room', chainLets(UP) === false);

const before = lookups;
at([-4736, -83300, 2609]);
for (let i = 0; i < 50; i++) chainLets(SHRINE);
check('the records are looked up once per base and ref, not per activation', lookups === before, lookups - before);

console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
