// Every new character on 12 and 13 Oct still stood on the Realm's marker when RaceMenu opened (whereis 2122.2,2079.6 for
// #65ZZ, #479S and #38XK together, and #RMHQ), so two making a character stood inside each other (Eirik, 13 Oct). The
// creator now checks the server's position before it opens and moves the player again while it is off its spot, up to
// three moves. Runs the real code cut from gamemode.js on stubs.
//   node tests/creator-spot-recheck-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const a0 = src.indexOf('const CREATOR_SPOTS = ');
const b0 = src.indexOf('// New characters spawn straight into the hub', a0);
if (a0 < 0 || b0 < 0) { console.log('FAIL the creator spot markers are gone from gamemode.js'); process.exit(1); }

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const HUB = { cellOrWorldDesc: '17482:DragonBreak Hub.esp', pos: [2122.2, 2079.6, 3], rot: [0, 0, 22.9] };
const run = (holds) => {
  const A = 0xff000101;
  const pos = new Map([[A, HUB.pos.slice()]]);
  let moves = 0;
  const timers = [], logs = [], opened = [];
  const mp = {
    get: (a, k) => (k === 'pos' ? pos.get(a) : k === 'private.creationPending' ? true : k === 'isOnline' ? true : null),
    set: (a, k, v) => { if (k === 'locationalData') { moves++; if (holds(moves)) pos.set(a, v.pos.slice()); } },
    setRaceMenuOpen: (a, on) => { if (on) opened.push(a); },
  };
  const globals = {};
  const creation = new Map([[A, 'spawning']]);
  const f = new Function('mp', 'HUB', 'globalThis', 'onlineActors', 'inHub', 'creation', 'log', 'display', 'setFade', 'setTimeout', 'creationPending',
    src.slice(a0, b0) + '\nreturn { placeInCreatorSpot, confirmCreatorSpot, CREATOR_PLACE_MS };');
  const g = f(mp, HUB, globals, () => [A], () => true, creation, (t) => logs.push(t), () => 'Stranger #TEST', () => { }, (fn) => timers.push(fn), () => true);
  if (g.placeInCreatorSpot(A)) timers.push(() => g.confirmCreatorSpot(A, 1));
  while (timers.length) timers.shift()();
  const p = pos.get(A);
  return { moves, opened: opened.length, logs, off: Math.round(Math.hypot(p[0] - HUB.pos[0], p[1] - HUB.pos[1])) };
};

const ok1 = run(() => true);
check('a move that holds is made once, then the creator opens off the marker', ok1.moves === 1 && ok1.opened === 1 && ok1.off >= 100, ok1);
const ok2 = run((n) => n >= 2);
check('a move that did not hold is made again before the creator opens', ok2.moves === 2 && ok2.opened === 1 && ok2.off >= 100, ok2);
check('...and the miss is in the log', ok2.logs.some((t) => /creator spot Stranger #TEST: \d+ u off its spot after move 1/.test(t) && !/: 0 u/.test(t)), ok2.logs);
const ok3 = run(() => false);
check('a move that never holds stops at three and still opens the creator', ok3.moves === 3 && ok3.opened === 1, ok3);

console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
