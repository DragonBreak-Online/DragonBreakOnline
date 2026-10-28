// Scripted test for /unstuck and a character still in creation (/bug 20 Oct, review GC-2). Stranger #MSFB's race menu
// close threw in the client, so no look reached the server; at 15:43:35 the live log has "UNSTUCK Stranger #MSFB from
// "17482:DragonBreak Hub.esp" ... to the bruma respawn", 12 s after the last refused gate try. The Realm has no zone, so
// /unstuck fell back to the Bruma temple and the unfinished character (no look, no name) walked about Cyrodiil until a
// later login put it back in the Realm. /unstuck now refuses an unfinished character with the gates' own line (a game
// restart brings the race menu back, which also frees anyone caught in the Realm's geometry); staff may still move one.
// It cuts /unstuck (and the gates' line) out of gamemode.js and runs them with stubs.
//
//   node tests/unstuck-creation-harness.js   (from server/; GAMEMODE_JS=<path> runs it against another gamemode.js)
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(process.env.GAMEMODE_JS || path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined && !ok ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const u0 = src.indexOf("const unstuckActor = (a, by, refs = '') => {"), u1 = src.indexOf('\nconst setDeathTemple', u0);
check('/unstuck is in gamemode.js', u0 > 0 && u1 > u0);
if (!(u0 > 0 && u1 > u0)) process.exit(1);
const cmd = src.slice(u0, u1);
const l0 = src.indexOf('const GATE_CREATION_LINE = ');
const lineSrc = l0 > 0 ? src.slice(l0, src.indexOf('\n', l0)) : "const GATE_CREATION_LINE = '(no GATE_CREATION_LINE in gamemode.js)';";
check('the gates\' line for an unfinished character is one const, GATE_CREATION_LINE', l0 > 0);
const h0 = src.indexOf('const gateCreationTold = (a, line) => {'), h1 = src.indexOf('\n};', h0);
check('...which the gate tell sends', h0 > 0 && h1 > h0 && /personal\(id, line \|\| GATE_CREATION_LINE\)/.test(src.slice(h0, h1)));
check('...and which is defined above both the gate tell and /unstuck', l0 > 0 && l0 < h0 && l0 < u0);

const HUB = '17482:DragonBreak Hub.esp', HUB_POS = [1965.4, 1820.2, -1.3];
const HEARTLAND = 'a764b:BSHeartland.esm';
const STAFF = 0xff000001, NEW = 0xff002077, DONE = 0xff000042;
const props = new Map();
const put = (a, k, v) => props.set(`${a >>> 0}|${k}`, v);
for (const a of [STAFF, NEW, DONE]) { put(a, 'isDead', false); put(a, 'worldOrCellDesc', HUB); put(a, 'pos', HUB_POS.slice()); put(a, 'private.unstuckAt', 0); }
const pending = new Set([NEW]);
const told = [], moved = [], audits = [], plog = [], bleedStops = [];
let handler = null;
const sandbox = {
  registerChatCommand: (name, fn) => { if (name === 'unstuck') handler = fn; },
  staffCan: (a) => (a >>> 0) === STAFF,
  mp: {
    get: (a, k) => props.get(`${a >>> 0}|${k}`),
    set: (a, k, v) => { if (k === 'locationalData') { moved.push([a >>> 0, v]); put(a, 'worldOrCellDesc', v.cellOrWorldDesc); put(a, 'pos', v.pos); } else put(a, k, v); },
  },
  globalThis: { __dboPlogHook: (...x) => plog.push(x), __dboBleedOutStop: (a) => bleedStops.push(a >>> 0) },
  pvpAt: new Map(), combatAt: new Map(),
  UNSTUCK: { cooldownMinutes: 30, combatSeconds: 60 },
  findByName: (q) => (/stranger/i.test(q) ? NEW : 0),
  // staff /unstuck <name> resolves through staffTargetOf (the console harness runs the real one); online characters here
  staffTargetOf: (by, q) => { const t = /stranger/i.test(q) ? NEW : 0; if (!t) told.push([by >>> 0, 'No such player.']); return t; },
  findAnyByName: (q) => (/stranger/i.test(q) ? NEW : 0),
  exactNamed: (q) => (/^stranger$/i.test(q) ? [NEW] : []),
  userOf: () => 1,
  // typed in game (tests/console-harness.js runs the remote console's)
  remoteLine: null, remoteBy: () => '',
  display: (a) => `#${(a >>> 0).toString(16)}`,
  personal: (a, t) => told.push([a >>> 0, t]),
  zoneOfActor: () => null, // the Realm has no zone
  templeZoneOf: () => null, // nor a hold (tests/death-temple-hold-harness.js runs the real one)
  templeFor: (z) => (z === 'bruma' ? { world: HEARTLAND, pos: [59151, 201645, 7559], rotZ: 0 } : null),
  log: () => {},
  audit: (t) => audits.push(t),
  who: (a) => `#${(a >>> 0).toString(16)}`,
  creationPending: (a) => pending.has(a >>> 0),
};
const names = Object.keys(sandbox);
let GATE_LINE = '';
try {
  GATE_LINE = new Function(...names, `${lineSrc}\n${cmd}\nreturn GATE_CREATION_LINE;`)(...names.map((k) => sandbox[k]));
} catch (e) { check('/unstuck and the gates\' line load', false, e.message); process.exit(1); }
check('/unstuck registers', typeof handler === 'function');

// The reporter's case: the unfinished character's own /unstuck in the Realm
handler(NEW, '');
const toldNew = told.filter(([a]) => a === NEW).map(([, t]) => t);
check('an unfinished character\'s own /unstuck does not move it out of the Realm', !moved.some(([a]) => a === NEW) && sandbox.mp.get(NEW, 'worldOrCellDesc') === HUB, moved);
check('...it is told the gates\' line (not finished yet, and a full restart brings the race menu back)', toldNew.length === 1 && toldNew[0] === GATE_LINE && /not finished yet/.test(toldNew[0]) && /quit Skyrim completely/.test(toldNew[0]), toldNew);
check('...its /unstuck cooldown is not spent', sandbox.mp.get(NEW, 'private.unstuckAt') === 0, sandbox.mp.get(NEW, 'private.unstuckAt'));
check('...no UNSTUCK audit line and no player-log travel action', audits.length === 0 && !plog.some((x) => x[0] === 'travel'), { audits, plog });
// Asking again a moment later is refused the same way (no cooldown message, no move)
handler(NEW, '');
check('...a second try is refused the same way', !moved.some(([a]) => a === NEW) && told.filter(([a]) => a === NEW).length === 2 && told[told.length - 1][1] === GATE_LINE);

// A finished character's /unstuck is as before
handler(DONE, '');
check('a finished character\'s /unstuck still moves it to the Bruma respawn', moved.some(([a, v]) => a === DONE && v.cellOrWorldDesc === HEARTLAND), moved);
check('...with its UNSTUCK audit line', audits.length === 1 && /to the bruma respawn/.test(audits[0]) && !/by staff/.test(audits[0]), audits);
check('...and its cooldown spent', Number(sandbox.mp.get(DONE, 'private.unstuckAt')) > 0);

// Staff may still send an unfinished character to the respawn
handler(STAFF, 'Stranger');
check('staff can still /unstuck an unfinished character by name', moved.some(([a, v]) => a === NEW && v.cellOrWorldDesc === HEARTLAND), moved);
check('...audited as by staff', audits.length === 2 && /by staff/.test(audits[1]), audits);
check('...and the unfinished character is never told the gates\' line for staff\'s move', told.filter(([a, t]) => a === NEW && t === GATE_LINE).length === 2);

// A dead unfinished character is told it is dead first (the existing first check stays first)
pending.add(DONE); put(DONE, 'isDead', true); told.length = 0;
handler(DONE, '');
check('a dead character still gets the dead line first', told.length === 1 && /while dead/.test(told[0][1]), told);

console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
