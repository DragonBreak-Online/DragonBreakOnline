// Which claimed refs a RefDecorService sweep looks at (refDecorSweep.ts), plus the service's wiring.
//
// Why it exists: measured on the live dev server on 31 Oct across 1,381 client perf windows, RefDecorService
// was the second most expensive update handler in EVERY window at 1.39 ms/frame. The sweep ran once every 30
// frames and resolved the whole decor set (~1,700 refs, 873 claims plus partners), each costing a
// remoteIdToLocalId and a Game.getFormEx before it could even be rejected as not loaded - so one frame in
// thirty did ~3,400 native calls and threw nearly every answer away, because a player stands near a handful
// of claimed doors and the rest are in cells that are not loaded.
//
//   node tests/refdecor-sweep-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const client = path.resolve(__dirname, '..');
const svc = path.join(client, 'src', 'services', 'services');
const ts = require(path.join(client, 'node_modules', 'typescript'));
const LF = (s) => s.split('\r\n').join('\n');
let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 240) : ''}`);
  if (!ok) failures++;
};
const load = (src) => {
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
  const mod = {};
  new Function('exports', js)(mod);
  return mod;
};

const planSrc = LF(fs.readFileSync(path.join(svc, 'refDecorSweep.ts'), 'utf8'));
const plan = load(planSrc);

const ids = [];
for (let i = 1; i <= 1700; i++) ids.push(0x08000000 + i);
const st = (o) => Object.assign({ hot: new Set(), cursor: 0, full: false }, o);

// ---- a full pass is still available, and is what the old code always did ----
let r = plan.pickSweep(ids, st({ full: true }));
check('a full pass looks at every ref, as the old sweep always did', r.ids.length === 1700 && r.covered === true, r.ids.length);
check('...and it reports covered, so the caller can clear its flag', r.covered === true);
r = plan.pickSweep([], st({}));
check('an empty decor set looks at nothing and is covered', r.ids.length === 0 && r.covered === true);
r = plan.pickSweep([1, 2, 3], st({}));
check('a set smaller than the budget is done in one pass', r.ids.length === 3 && r.covered === true);

// ---- the rolling cursor ----
r = plan.pickSweep(ids, st({}));
check('a normal sweep is bounded by the budget, not the set size', r.ids.length === plan.SWEEP_BUDGET, r.ids.length);
check('...and it is NOT reported as covered', r.covered === false);
check('the budget is 120 of 1700, so a sweep costs about a fourteenth of what it did', plan.SWEEP_BUDGET === 120);
check('it starts at the start', r.ids[0] === ids[0] && r.cursor === plan.SWEEP_BUDGET, { first: r.ids[0], cursor: r.cursor });

// every ref is still visited, just over several sweeps
let cursor = 0;
const seen = new Set();
let sweeps = 0;
while (seen.size < ids.length && sweeps < 100) {
  const p = plan.pickSweep(ids, st({ cursor }));
  p.ids.forEach((id) => seen.add(id));
  cursor = p.cursor;
  sweeps++;
}
check('the cursor still covers every ref, over 15 sweeps rather than 1', seen.size === ids.length && sweeps === Math.ceil(1700 / 120), { seen: seen.size, sweeps });
check('the cursor wraps rather than running off the end', plan.pickSweep(ids, st({ cursor: 1699 })).ids.includes(ids[0]));
check('a cursor past the end or negative starts over instead of returning nothing',
  plan.pickSweep(ids, st({ cursor: 99999 })).ids.length === plan.SWEEP_BUDGET &&
  plan.pickSweep(ids, st({ cursor: -5 })).ids.length === plan.SWEEP_BUDGET);

// ---- hot refs ----
const hot = new Set([ids[1000], ids[1001], ids[1002]]);
r = plan.pickSweep(ids, st({ hot, cursor: 0 }));
check('a hot ref is looked at every sweep wherever the cursor is, so a chest in front of the player still settles at the same rate',
  hot.size === 3 && [...hot].every((id) => r.ids.includes(id)), r.ids.length);
check('...and hot refs do not eat the budget: the cursor still advances a full budget', r.cursor === plan.SWEEP_BUDGET, r.cursor);
check('a ref is never looked at twice in one sweep, even when it is both hot and under the cursor',
  (() => { const p = plan.pickSweep(ids, st({ hot: new Set([ids[0], ids[5]]), cursor: 0 })); return new Set(p.ids).size === p.ids.length; })());
check('every hot ref hot at once degrades to a full pass, not to a broken one',
  (() => { const p = plan.pickSweep(ids, st({ hot: new Set(ids), cursor: 0 })); return new Set(p.ids).size === 1700; })());
check('a budget of 0 falls back to a full pass rather than looking at nothing',
  plan.pickSweep(ids, st({}), 0).ids.length === 1700);

// ---- the service's wiring ----
const src = LF(fs.readFileSync(path.join(svc, 'refDecorService.ts'), 'utf8'));
check('the service asks the sweep which refs to look at', /pickSweep\(/.test(src) && !/this\.decor\.forEach\(\(d\) => this\.apply/.test(src));
check('a cell load forces a full pass, so walking into an area resolves it during the load',
  /controller\.on\("cellFullyLoaded"/.test(src) && /fullSweep = true/.test(src));
check('fresh decor from the server forces a full pass, since changed refs need not be under the cursor',
  /full pass: the refs that just[\s\S]{0,200}fullSweep = true|fullSweep = true;\s*\n\s*this\.updateCounter = APPLY_EVERY_N_UPDATES/.test(src));
check('a save load clears the hot set and the cursor as well as the applied state',
  /onGameLoad\(\)[\s\S]*?hot\.clear\(\)[\s\S]*?sweepCursor = 0[\s\S]*?fullSweep = true/.test(src));
check('a ref that resolves becomes hot, and one that does not leaves the hot set',
  /this\.hot\.add\(d\.refId\)/.test(src) && /this\.hot\.delete\(d\.refId\)/.test(src));
check('what a sweep DOES to a ref is unchanged: setDisplayName and the lock still go through apply()',
  /private apply\(d: RefDecor/.test(src) && /CHEST_SETTLE_TICKS/.test(src));

// ---- mutants ----
const mutants = [
  ['the budget is ignored', (s) => s.replace('while (examined < n && added < budget) {', 'while (examined < n) {')],
  ['the cursor never advances', (s) => s.replace('cursor = cursor + 1 >= n ? 0 : cursor + 1;', '')],
  ['hot refs are dropped', (s) => s.replace('state.hot.forEach((id) => {', 'const _unused = (id) => {').replace('});\n\n  // then a budget', '};\n\n  // then a budget')],
  ['a full pass is never honoured', (s) => s.replace('if (state.full || budget <= 0 || n <= budget) {', 'if (budget <= 0 || n <= budget) {')],
  ['covered is always true', (s) => s.replace('return { ids: out, cursor, covered: false };', 'return { ids: out, cursor, covered: true };')],
];
let killed = 0;
for (const [name, mutate] of mutants) {
  const mutated = mutate(planSrc);
  if (mutated === planSrc) { console.log(`FAIL mutant "${name}" did not apply`); failures++; continue; }
  let survived = true;
  try {
    const m = load(mutated);
    const h = new Set([ids[1000]]);
    const broke =
      m.pickSweep(ids, st({})).ids.length !== m.SWEEP_BUDGET ||
      m.pickSweep(ids, st({})).covered !== false ||
      m.pickSweep(ids, st({ cursor: 0 })).cursor !== m.SWEEP_BUDGET ||
      !m.pickSweep(ids, st({ hot: h })).ids.includes(ids[1000]) ||
      m.pickSweep(ids, st({ full: true })).ids.length !== 1700;
    survived = !broke;
  } catch {
    survived = false;
  }
  if (survived) { console.log(`FAIL mutant survived: ${name}`); failures++; } else { killed++; }
}
console.log(`ok   ${killed}/${mutants.length} mutants killed`);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
