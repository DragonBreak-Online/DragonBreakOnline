// gamemode.js's move guard (Nat, 2 Nov: claiming an expedition from the native board moved him on the server, his client
// never followed and he black-screened): a player's locationalData set while their native panel is up closes the panel
// first and lands NATIVE_MOVE_GAP_MS after the close; a move soon after the server closed one waits out the rest of the
// gap; anything else, and every other property, is set at once; a hot reload never wraps mp.set twice. The block from
// NATIVE_SWF to the end of the mp.set wrapper runs on its own with a stub mp and sendPacket.
//   node tests/native-move-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
const a0 = src.indexOf('const NATIVE_SWF = ');
const w0 = src.indexOf('if (!globalThis.__dboMpSetWrapped');
const end = src.indexOf('\n}\n', w0) + 3;
if (a0 < 0 || w0 < 0) { console.log('FAIL  the move guard is not in gamemode.js'); process.exit(1); }
const block = src.slice(a0, end);

const sent = [], sets = [], logs = [];
const mp = { set(actor, prop, value) { sets.push({ actor, prop, value, at: Date.now(), self: this === mp }); } };
const load = () => new Function('sendPacket', 'log', 'display', 'mp', block + '\nreturn { openWidget, closeWidget, nativeState };')(
  (a, p) => { sent.push({ a, p, at: Date.now() }); return true; }, (...x) => logs.push(x.join(' ')), (a) => `P${a}`, mp);
globalThis.__dboPanelState = undefined;
globalThis.__dboMpSetWrapped = undefined;
let api = load();

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const A = 0xff000001, B = 0xff000002, C = 0xff000003, D = 0xff000004;
const LOC = { cellOrWorldDesc: 'x:1', pos: [1, 2, 3], rot: [0, 0, 0] };
const setsOf = (a) => sets.filter((s) => s.actor === a && s.prop === 'locationalData');

(async () => {
  // A native panel up: the close goes first, the move after the gap
  api.nativeState().native.set(A, new Set(['native:expeditionBoard']));
  api.openWidget(A, { type: 'expeditionBoard', id: 38, nonce: 'n' }, true);
  ok(api.nativeState().nativeOpen.get(A) === 38, 'the expedition board opened native');
  sent.length = 0;
  const t0 = Date.now();
  mp.set(A, 'locationalData', LOC);
  ok(sent.length === 1 && sent[0].p.customPacketType === 'dboScaleform' && sent[0].p.close === true, 'a move with the panel up closes the native panel first', sent.map((s) => s.p));
  ok(setsOf(A).length === 0, '...and does not move them yet');
  ok(!api.nativeState().nativeOpen.has(A), '...and the panel is no longer counted open');
  await wait(560);
  ok(setsOf(A).length === 1 && setsOf(A)[0].at - t0 >= 490, 'the move lands after the gap', setsOf(A).map((s) => s.at - t0));
  ok(setsOf(A)[0].self && setsOf(A)[0].value === LOC, '...on the real mp.set, with the same value');
  ok(logs.some((l) => /panel move: PA?\d* is moved \d+ ms from now/.test(l) || /panel move:/.test(l)), 'a held move is logged');

  // The server closed the panel a moment ago (the claim's own closeWidget): the move waits out the rest
  api.nativeState().native.set(B, new Set(['native:dungeonGate']));
  api.openWidget(B, { type: 'dungeonGate', id: 31, nonce: 'g' }, true);
  api.closeWidget(B, 31);
  const t1 = Date.now();
  mp.set(B, 'locationalData', LOC);
  ok(setsOf(B).length === 0, 'a move right after closeWidget is held');
  await wait(560);
  ok(setsOf(B).length === 1 && setsOf(B)[0].at - t1 >= 440, '...and lands once the gap since the close has passed', setsOf(B).map((s) => s.at - t1));

  // Long after a close, or with no native panel at all, the move is immediate
  mp.set(B, 'locationalData', LOC);
  ok(setsOf(B).length === 2, 'a move long after the close is immediate');
  mp.set(C, 'locationalData', LOC);
  ok(setsOf(C).length === 1, 'a player with no native panel is moved at once');
  // A browser panel is not a CustomMenu: no hold
  api.openWidget(C, { type: 'expeditionBoard', id: 38, nonce: 'n' }, true);
  mp.set(C, 'locationalData', LOC);
  ok(setsOf(C).length === 2, 'a browser panel does not hold a move');

  // Other properties are never held
  api.nativeState().native.set(D, new Set(['native:expeditionBoard']));
  api.openWidget(D, { type: 'expeditionBoard', id: 38, nonce: 'n' }, true);
  mp.set(D, 'isDead', false);
  ok(sets.some((s) => s.actor === D && s.prop === 'isDead') && api.nativeState().nativeOpen.has(D), 'another property is set at once and leaves the panel up');

  // A hot reload re-runs the block: mp.set stays wrapped once, and the new hook is the one used
  api = load();
  const before = sets.length;
  mp.set(C, 'locationalData', LOC);
  ok(sets.length === before + 1, 'after a reload one call is still one set (not wrapped twice)');
  globalThis.__dboPanelMoveHook = () => { throw new Error('boom'); };
  mp.set(C, 'locationalData', LOC);
  ok(sets.length === before + 2, 'a hook that throws still lets the move through at once');

  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
