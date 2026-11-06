// A take refused by an actiondelays gate (body beat, gap between takes) resyncs the pack through itemguards.js, and
// must do it quietly: nothing was wrong with the pack, so itemguards' "set right: it showed items you do not really
// have" is false there (Local Leader, 3 Nov). itemguards' own refusals keep that note. Both real modules run together,
// so the check covers the call between them, not a stub of it.
//   node tests/quiet-gate-resync-harness.js   (from server/)
// QR_DIR=<folder holding both modules> runs it against other copies, e.g. the code before the change, which must FAIL.
'use strict';
const path = require('path');
const DIR = process.env.QR_DIR ? path.resolve(process.env.QR_DIR) : path.resolve(__dirname, '..');

let now = Date.parse('2026-11-03T20:00:00Z');
Date.now = () => now;
let pending = [];
global.setTimeout = (fn) => { const h = { fn, dead: false }; pending.push(h); return h; };
global.clearTimeout = (h) => { if (h) h.dead = true; };
const flush = () => { const due = pending; pending = []; due.forEach((h) => { if (!h.dead) h.fn(); }); };

const P = 0xff000001, BODY = 0xff000050, CHEST = 0x5000;
const HERB = 0x6bc02, POTION = 0x3eadd;
const types = { [HERB]: 'INGR', [POTION]: 'ALCH' };
const inv = { [P]: [{ baseId: POTION, count: 2 }], [BODY]: [{ baseId: HERB, count: 5 }], [CHEST]: [] };
const sets = [], said = [], logs = [];
const mp = {
  get: (id, k) => {
    if (k === 'inventory' && inv[id >>> 0]) return { entries: inv[id >>> 0].map((e) => Object.assign({}, e)) };
    if (k === 'profileId') return (id >>> 0) === P ? 7 : undefined;
    return undefined;
  },
  set: (id, k, v) => sets.push([id >>> 0, k, v]),
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:x`,
  callPapyrusFunction: () => null,
  lookupEspmRecordById: () => null,
};
const api = {
  mp, cfg: {},
  log: (...a) => logs.push(a.join(' ')),
  who: (a) => `P${(a >>> 0).toString(16)}`,
  personal: (a, t) => said.push({ a: a >>> 0, t }),
  recordOf: (id) => (types[id] ? { record: { type: types[id] } } : null),
  profileOf: (a) => ((a >>> 0) === P ? 7 : -1),
  openWidget: () => 1,
  closeWidget: () => {},
};
for (const k of ['__dboItemGuards', '__dboTakeGuard', '__dboItemResync', '__dboActionDelayState']) delete globalThis[k];
const load = (f) => { const file = path.join(DIR, f); delete require.cache[file]; return require(file)(api); };
load('itemguards.js');
const T = load('actiondelays.js')._test;

let fails = 0, checks = 0;
const ok = (cond, what, got) => { checks++; if (cond) { console.log(`ok    ${what}`); return; } fails++; console.log(`FAIL  ${what}${got === undefined ? '' : '   ' + JSON.stringify(got)}`); };
const setsTo = (a) => sets.filter(([id, k]) => id === a && k === 'inventory').length;
const setRight = () => said.filter((s) => s.a === P && /set right/.test(s.t));

// The body beat: a first take from a corpse is refused
ok(T.takeGate(BODY, P) === false, 'body beat: the first take from a corpse is refused');
flush();
ok(setsTo(P) === 1, '...the pack is still resynced (the client already moved the item)', setsTo(P));
ok(setRight().length === 0, '...without itemguards\' "set right" note: nothing was wrong with the pack', said);
ok(said.some((s) => /still searching/i.test(s.t)), '...the gate\'s own line is what the player reads', said);
ok(logs.some((l) => /ITEMGUARD resynced the inventory of Pff000001/.test(l)), '...and the resync is still logged, so it can be counted', logs);

// The gap between takes
now += 3100; T.takeGate(BODY, P);                // the beat done: this take stands
now += 1100;
ok(T.takeGate(BODY, P) === undefined, 'next take past the gap stands');
now += 100;
// Another source inside the 0.4 s: one source's take-all is not held up by the gap since 6 Nov (#bugs loot-all)
const BODY2 = 0xff000051; T.S.done.set(`${P}:${BODY2}`, now);
ok(T.takeGate(BODY2, P) === false, 'gap: a take from another source inside the 0.4 s is refused');
flush();
ok(setsTo(P) === 2 && setRight().length === 0, '...resynced, still no "set right" note', [setsTo(P), said]);
ok(said.some((s) => /hands are full/i.test(s.t)), '...the gap\'s own line instead', said);

// itemguards' own refusal right after: the quiet ones must not have used up its once-a-minute note
now += 2000;
ok(mp.onDropItem(P, HERB, 1) === false, 'itemguards: a drop of an ingredient the server never gave is refused');
flush();
ok(setsTo(P) === 3, '...and resynced', setsTo(P));
ok(setRight().length === 1, '...and THIS one keeps its "set right" note', said);

for (const k of ['__dboItemGuards', '__dboTakeGuard', '__dboItemResync', '__dboActionDelayState']) delete globalThis[k];
console.log(fails ? `\n${fails} of ${checks} FAILED` : `\nall ${checks} checks passed`);
process.exit(fails ? 1 : 0);
