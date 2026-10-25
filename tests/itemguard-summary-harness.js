// itemguards.js's move trace is capped (trace.perMinute lines a minute per actor). A minute that left lines out now also
// logs one summary of what moved, per container and kind (Telvanni house, 24 Oct: 556 lines left out while a house was
// emptied), and a take out of a claimed property's container by anyone but its owner is logged in full, never capped, with
// or without logMoves. The housing system is faked as globalThis.__dboHousing. Runs in a scratch folder.
//   node tests/itemguard-summary-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-igsummary-'));
process.chdir(dir);
const MODULE = path.resolve(__dirname, '..', 'itemguards.js');
let pending = [];
global.setTimeout = (fn) => { pending.push(fn); return pending.length; };
const flush = () => { const due = pending; pending = []; due.forEach((f) => f()); };
let clock = Date.parse('2026-10-24T02:17:00Z');
Date.now = () => clock;
const OWNER = 0xff000101, STEWARD = 0xff0017ea, HOUSE_CHEST = 0x8002d26, STASH = 0x806e2d9, DOOR = 0x8000ef7;
const KINDS = Array.from({ length: 30 }, (_, i) => 0x7600000 + i);
const types = {}; for (const k of KINDS) types[k] = 'INGR';
const inv = {};
const reset = () => { inv[STEWARD] = []; inv[OWNER] = []; inv[STASH] = []; inv[HOUSE_CHEST] = KINDS.map((baseId) => ({ baseId, count: 10 })); };
const add = (id, baseId, n) => { const e = inv[id].find((x) => x.baseId === baseId); if (e) e.count += n; else inv[id].push({ baseId, count: n }); inv[id] = inv[id].filter((x) => x.count > 0); };
const logs = [];
const mp = { get: (id, k) => (k === 'inventory' && inv[id] ? { entries: inv[id].map((e) => Object.assign({}, e)) } : undefined), set: () => {} };
const load = (cfg) => { delete require.cache[MODULE]; logs.length = 0;
  require(MODULE)({ mp, log: (...a) => logs.push(a.join(' ')), who: (a) => `P${(a >>> 0).toString(16)}`, recordOf: (id) => (types[id] ? { record: { type: types[id] } } : null), cfg }); };
const take = (actor, from, baseId, n) => { if (globalThis.__dboTakeGuard(from, actor, baseId, n) === false) return false; add(actor, baseId, n); add(from, baseId, -n); flush(); return true; };
const put = (actor, into, baseId, n) => { if (mp.onPutItem(into, actor, baseId, n) === false) return false; add(into, baseId, n); add(actor, baseId, -n); flush(); return true; };
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };
const S = () => globalThis.__dboItemGuards;
const nextMinute = () => { clock += 61000; S().flushTrace(); };

// No housing system: an ordinary chest, 30 takes in a minute against a cap of 20
globalThis.__dboItemGuards = undefined;
reset();
load({ itemGuards: { logMoves: true, trace: { perMinute: 20 } } });
for (const k of KINDS) take(STEWARD, HOUSE_CHEST, k, 10);
ok(logs.filter((l) => /^ITEMGUARD move take/.test(l)).length === 20, 'the trace still stops at 20 lines a minute', logs.length);
ok(!logs.some((l) => /summary/.test(l)), '...and says nothing more while the minute runs');
logs.length = 0;
nextMinute();
ok(logs.some((l) => l === 'ITEMGUARD trace: 10 line(s) for Pff0017ea left out in the last minute (perMinute 20)'), 'the timer closes the minute with the count left out, with no later move needed', logs);
const sum = logs.find((l) => /^ITEMGUARD summary for Pff0017ea, the minute from 02:17:00 UTC: /.test(l)) || '';
ok(!!sum, '...and one summary line for it', logs);
ok(/took 300 item\(s\) of 30 kind\(s\) from 8002d26: /.test(sum), '...counting every item taken in the minute, the 20 traced lines included', sum);
ok(/7600000 x10, .*and 22 more kind\(s\)$/.test(sum) && (sum.match(/ x10/g) || []).length === 8, '...listing the 8 largest kinds and how many more', sum);

// The goods go into another container: puts are summed by the container they went into
logs.length = 0;
for (const k of KINDS) put(STEWARD, STASH, k, 10);
nextMinute();
const sum2 = logs.find((l) => /^ITEMGUARD summary/.test(l)) || '';
ok(/put 300 item\(s\) of 30 kind\(s\) into 806e2d9/.test(sum2) && !/took/.test(sum2), 'a minute of puts is summed per container they went into', sum2);

// A minute under the cap writes no summary
logs.length = 0;
take(STEWARD, STASH, KINDS[0], 1);
nextMinute();
ok(!logs.some((l) => /summary|left out/.test(l)), 'a minute with nothing left out has no summary', logs);

// A claimed house's chest: the housing system names the house and its owner
const lookups = [];
globalThis.__dboHousing = {
  recordOf: (c) => { lookups.push(c); return c === HOUSE_CHEST ? { owner: 101, ownerName: 'Raven The Shield', name: 'House Telvanni' } : null; },
  primaryOf: (c) => (c === HOUSE_CHEST ? DOOR : c),
  ownsRecord: (rec, a) => a === OWNER,
};
globalThis.__dboItemGuards = undefined;
reset();
load({ itemGuards: { logMoves: true, trace: { perMinute: 20 } } });
for (const k of KINDS) take(STEWARD, HOUSE_CHEST, k, 10);
const prop = logs.filter((l) => /^ITEMGUARD property take /.test(l));
ok(prop.length === 30, 'every take out of someone else\'s house is logged: 30 of 30, past the cap of 20', prop.length);
ok(/^ITEMGUARD property take take by Pff0017ea at 8002d26: 7600000 x10 \(pack 0 -> 10, container 10 -> 0\), from property 8000ef7 "House Telvanni" of profile 101 "Raven The Shield"$/.test(prop[0] || ''), '...naming the house, its owner and both counts', prop[0]);
ok(!logs.some((l) => /^ITEMGUARD move take/.test(l)), '...once each, not also as a trace line', logs.filter((l) => /move take/.test(l)).length);
ok(lookups.filter((c) => c === HOUSE_CHEST).length === 1, 'the house is looked up once for the chest, not once per take', lookups.length);
clock += 16000; add(HOUSE_CHEST, KINDS[0], 1); take(STEWARD, HOUSE_CHEST, KINDS[0], 1);
ok(lookups.filter((c) => c === HOUSE_CHEST).length === 2, '...and again only after 15 s', lookups.length);

// The owner's own takes are ordinary: traced and capped
reset(); inv[HOUSE_CHEST] = KINDS.map((baseId) => ({ baseId, count: 10 })); logs.length = 0; clock += 61000;
for (const k of KINDS) take(OWNER, HOUSE_CHEST, k, 10);
ok(!logs.some((l) => /property take/.test(l)), 'the owner taking from their own house is not a property take', logs.filter((l) => /property/.test(l)));
ok(logs.filter((l) => /^ITEMGUARD move take by Pff000101/.test(l)).length === 20, '...and is traced and capped as before');

// Without logMoves the property takes are still logged; nothing else is
globalThis.__dboItemGuards = undefined;
reset();
load({});
for (const k of KINDS.slice(0, 5)) take(STEWARD, HOUSE_CHEST, k, 10);
ok(logs.filter((l) => /^ITEMGUARD property take /.test(l)).length === 5, 'with logMoves off a property take is still logged', logs);
ok(!logs.some((l) => /^ITEMGUARD (move|trace|summary)/.test(l)), '...and nothing else is', logs);

// No housing system loaded (an older core): no property lines, no errors
globalThis.__dboHousing = undefined;
globalThis.__dboItemGuards = undefined;
reset();
load({ itemGuards: { logMoves: true } });
ok(take(STEWARD, HOUSE_CHEST, KINDS[0], 10) && !logs.some((l) => /property|failed/.test(l)), 'with no housing system the take is an ordinary one', logs);

try { clearInterval(S().flushTimer); } catch (e) { /* unref'd anyway */ }
process.chdir(os.tmpdir());
fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
