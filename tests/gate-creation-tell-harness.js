// Scripted test for the Realm's hold gates and a character still in creation (/bug 20 Oct 15:43, "seem to be stuck in the
// starting room, relog didnt fix"). The race menu's close threw in the reporter's client (getAppearance on a null base), so
// no look reached the server and the character stayed in creation; the gates then refused 8 tries in 9 s without a word.
// It cuts the gate step of the activate chain (and its tell helper) out of gamemode.js and runs it with stubs.
//
//   node tests/gate-creation-tell-harness.js   (from server/; GAMEMODE_JS=<path> runs it against another gamemode.js)
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(process.env.GAMEMODE_JS || path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined && !ok ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const b0 = src.indexOf('const g = gateOf(targetId >>> 0);'), b1 = src.indexOf('const prev = globalThis.__dboPrevActivate;', b0);
check('the gate step is in the activate chain', b0 > 0 && b1 > b0);
const block = src.slice(b0, b1);
const h0 = src.indexOf('// A gate refuses a character still in creation'), h1 = src.indexOf('// One spot picker per gate', h0);
const helper = h0 > 0 && h1 > h0 ? src.slice(h0, h1) : 'const gateCreationTold = undefined;';

let now = 1792510953000;
const told = [], moved = [], said = [];
const pending = new Set();
const GATE = ['Whiterun', [[18313, -10665, -4588.5]], 90];
const sandbox = {
  Date: { now: () => now },
  globalThis: {},
  personal: (a, t) => told.push([a, t]),
  system: (a, t) => said.push([a, t]),
  log: () => {},
  display: (a) => `Stranger #${a.toString(16)}`,
  gateOf: (t) => (t === 0x174f4 || t === 0x174e5 ? GATE : null),
  creationPending: (a) => pending.has(a),
  gateAnswersStart: () => {},
  gateSpotFor: (g) => g[1][0],
  TAMRIEL: '3c:Skyrim.esm',
  mp: { set: (a, k, v) => { if (k === 'locationalData') moved.push([a, v]); } },
};
const names = Object.keys(sandbox);
const gateStep = new Function(...names, `${helper}\nreturn (targetId, casterId) => { ${block} return 'through'; };`)(...names.map((k) => sandbox[k]));

const NEW = 0xff002077, DONE = 0xff000042;
pending.add(NEW);
// The reporter's 8 tries: 174e5 (Falkreath) at 15:42:33, :34, :35; 174f4 (Whiterun) at :39, :40, :41.0, :41.2, :41.4
const tries = [[0x174e5, 0], [0x174e5, 1155], [0x174e5, 1890], [0x174f4, 6537], [0x174f4, 7529], [0x174f4, 7746], [0x174f4, 7909], [0x174f4, 8162]];
const t0 = now;
const answers = tries.map(([door, dt]) => { now = t0 + dt; return gateStep(door, NEW); });
check('every gate try by a character in creation is refused', answers.every((x) => x === false), answers);
check('nobody in creation is moved through a gate', moved.length === 0, moved);
check('the character in creation is told why, once for the 8 tries in 9 s', told.filter(([a]) => a === NEW).length === 1, told);
check('the line says the gates cannot take them and how to get the race menu back', told.length > 0 && /cannot take you/.test(told[0][1]) && /quit Skyrim completely/.test(told[0][1]) && /race menu opens again/.test(told[0][1]), told[0]);
now = t0 + 8162 + 10001;
gateStep(0x174f4, NEW);
check('a try more than 10 s later is told again', told.filter(([a]) => a === NEW).length === 2, told.length);
// A finished character goes through as before, with no such line
now += 500;
const r = gateStep(0x174f4, DONE);
check('a finished character is moved through the gate', r === false && moved.length === 1 && moved[0][0] === DONE && moved[0][1].cellOrWorldDesc === '3c:Skyrim.esm', moved);
check('...told it stepped through, and never told it is unfinished', said.some(([a, t]) => a === DONE && /step through the gate to Whiterun/.test(t)) && !told.some(([a]) => a === DONE));
// Anything that is no gate falls through to the rest of the chain, in creation or not
const toldBefore = told.length;
check('a door that is no gate falls through for a character in creation', gateStep(0x12345, NEW) === 'through');
check('...and is never told about the gates', told.length === toldBefore);

console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
