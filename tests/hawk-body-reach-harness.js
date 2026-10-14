// Scripted test for the dead hawk's body in gamemode.js's activate chain (14 Oct): the server keeps a hawk body
// (fcHawkGO, DLC1BoneHawkGO) at the spot it was placed, in the air, while every client shows it on the ground, so the
// chain's 6.5 m reach refused every loot (Purr #7DJT, 13 Oct 20:45: 130 units across, 2477 below). It cuts
// hawkBodyInReach out of the gamemode and runs it on the live log's positions. Run it from this folder's parent with
//
//   node tests/hawk-body-reach-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const a = src.indexOf("// A dead hawk's body (fcHawkGO");
const b = src.indexOf("// A hold's treasury chest", a);
if (a < 0 || b < 0) { console.log('FAIL the hawk body markers are gone from gamemode.js'); process.exit(1); }
const helperSrc = src.slice(a, b);

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined && !ok ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

check('the reach check in the chain lets a hawk body within its reach through',
  /distanceMeters\(caster, target\) > 6\.5 && !\(typeof hawkBodyInReach === 'function' && hawkBodyInReach\(caster, target, q\)\)\) return false;/.test(src));

const BRUMA = 'a764b:BSHeartland.esm';
const HAWK_GO = 0x105821, BONE_HAWK_GO = 0x2002992, CHEST = 0x1234, PLANT = 0x6018f3;
const RECORDS = {
  [HAWK_GO]: { type: 'CONT', editorId: 'fcHawkGO' },
  [BONE_HAWK_GO]: { type: 'CONT', editorId: 'DLC1BoneHawkGO' },
  [CHEST]: { type: 'CONT', editorId: 'TreasBanditChest' },
  [PLANT]: { type: 'FLOR', editorId: 'BSKTreeFloraCarrotPlant01' },
};
const props = new Map();
let lookups = 0;
const mp = {
  get: (id, p) => props.get(`${id >>> 0}|${p}`),
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
  lookupEspmRecordById: (id) => { lookups++; const r = RECORDS[id >>> 0]; return r ? { record: r } : { record: null }; },
};
const put = (id, base, cell, pos) => { props.set(`${id >>> 0}|baseDesc`, `${base.toString(16)}:x`); props.set(`${id >>> 0}|worldOrCellDesc`, cell); props.set(`${id >>> 0}|pos`, pos); };
const UNITS_PER_METER = 70;
const hawkBodyInReach = new Function('mp', 'UNITS_PER_METER', `${helperSrc}; return hawkBodyInReach;`)(mp, UNITS_PER_METER);

// The live spot of the four bodies (changeForms 1c, 272, fcd, 1570), and the players who were refused
const SPOT = [57755.09, 206604.39, 10300.94];
const BODY = 0xff000fcd, PURR = 0xff000100, OTHER = 0xff000101;
put(BODY, HAWK_GO, BRUMA, SPOT);
const at = (dx, dy, dz, cell) => { props.set(`${PURR}|worldOrCellDesc`, cell || BRUMA); props.set(`${PURR}|pos`, [SPOT[0] + dx, SPOT[1] + dy, SPOT[2] + dz]); };
const reach = (body) => hawkBodyInReach(PURR, body || BODY, mp.get(body || BODY, 'pos'));

at(92, 92, -2477);     // Purr, 13 Oct 20:45:16 (130 units across)
check('Purr under the body, 130 units across and 2477 below, may loot it', reach() === true);
at(31, 0, -2473);
check('Neem, 31 units across, may loot it', reach() === true);
at(0, 0, 0);
check('standing at the spot itself may loot it', reach() === true);
at(690, 0, -2480);
check('9.9 m across is within the 10 m reach', reach() === true);
at(710, 0, -2480);
check('10.1 m across is refused (the reach across still holds)', reach() === false);
at(0, 0, 450);
check('up to 6.5 m above the spot may loot it', reach() === true);
at(0, 0, 470);
check('more than 6.5 m above the spot is refused', reach() === false);
at(0, 0, -2480, '3c:Skyrim.esm');
check('another world or cell is refused', reach() === false);

put(0xff000200, BONE_HAWK_GO, BRUMA, SPOT);
at(50, 50, -2400);
check("Dawnguard's bone hawk body counts too", reach(0xff000200) === true);
put(0xff000201, CHEST, BRUMA, SPOT);
check('any other container keeps the plain 6.5 m reach (not let through)', reach(0xff000201) === false);
put(0x00172d4f, HAWK_GO, BRUMA, SPOT);
check('a plugin-placed ref is never let through, even a hawk body', reach(0x00172d4f) === false);
put(0xff000202, PLANT, BRUMA, SPOT);
check('a non-container is not let through', reach(0xff000202) === false);
props.set(`${0xff000203}|baseDesc`, undefined);
check('a ref with no base is not let through', reach(0xff000203) === false);

const before = lookups;
for (let i = 0; i < 50; i++) reach();
check('the record is looked up once per base, not per activation', lookups === before, lookups - before);

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
