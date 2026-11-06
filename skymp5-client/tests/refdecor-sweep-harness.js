// RefDecorService under a time budget (refDecorSweep.ts), driven against a fake engine that counts native calls.
//
// Why: 0.3.118 perf reports showed one decor sweep every 30 updates costing p50 38 ms, inside and outside alike. Claimed
// doors are teleport doors, which are persistent refs that resolve from anywhere, so all of them stayed "hot" and were
// re-applied every sweep wherever the player was.
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
const load = (src, deps = {}) => {
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
  const mod = {};
  new Function('exports', 'require', js)(mod, (name) => {
    if (!(name in deps)) throw new Error('unexpected import ' + name);
    return deps[name];
  });
  return mod;
};

const planSrc = LF(fs.readFileSync(path.join(svc, 'refDecorSweep.ts'), 'utf8'));
const svcSrc = LF(fs.readFileSync(path.join(svc, 'refDecorService.ts'), 'utf8'));
const W = load(planSrc);

// ---- the scheduler alone ----
const ids = [];
for (let i = 1; i <= 1700; i++) ids.push(0x08000000 + i);
const drain = (work, perUpdate = W.UPDATE_MAX_VISITS) => {
  const got = [];
  let w;
  while (got.length < perUpdate && (w = work.next())) got.push(w);
  return got;
};

let work = new W.DecorWork();
work.markDirty(ids[5]); work.markDirty(ids[5]); work.markDirty(ids[9]);
check('a ref marked dirty twice is visited once', JSON.stringify(drain(work).map((w) => w.id)) === JSON.stringify([ids[5], ids[9]]));
check('with nothing queued there is no work', work.next() === null && work.backlog === 0);

work = new W.DecorWork();
work.seen(ids[1], true);
for (let u = 0; u < W.LIVE_EVERY_N_UPDATES; u++) work.tick(() => ids);
work.markDirty(ids[2]);
const order = drain(work, 1000).map((w) => w.kind);
check('server changes go first, then refs in loaded 3D, then probes', order[0] === 'dirty' && order[1] === 'live' && order.slice(2).every((k) => k === 'probe'), order.slice(0, 4));
check('the trickle probes PROBE_TRICKLE refs a slow tick and skips the live ones', order.length === 2 + W.PROBE_TRICKLE, order.length);

work = new W.DecorWork();
let probed = new Set();
let ticks = 0;
while (probed.size < ids.length && ticks < 10000) {
  work.tick(() => ids);
  ticks++;
  let w;
  while ((w = work.next())) probed.add(w.id);
}
check('the trickle alone still reaches every ref, in ceil(n / PROBE_TRICKLE) slow ticks',
  probed.size === ids.length && ticks === W.LIVE_EVERY_N_UPDATES * Math.ceil(ids.length / W.PROBE_TRICKLE), { probed: probed.size, ticks });

work = new W.DecorWork();
work.cellLoaded();
for (let u = 0; u < 5; u++) work.tick(() => ids);
work.cellLoaded();
let firstPass = -1;
let passVisits = 0;
for (let u = 0; u < 200; u++) {
  work.tick(() => ids);
  const got = drain(work);
  if (got.length && firstPass < 0) firstPass = u;
  passVisits += got.filter((w) => w.kind === 'probe').length;
}
check('a burst of cell loads starts one probe pass, CELL_SETTLE_UPDATES after the last of them', firstPass === W.CELL_SETTLE_UPDATES, firstPass);
check('...which probes every ref once, spread over updates', passVisits >= ids.length && passVisits < ids.length + 7 * W.PROBE_TRICKLE, passVisits);

work = new W.DecorWork();
let u = 0;
const tickTo = (n) => { while (u < n) { work.tick(() => ids); u++; } };
tickTo(3);
check('a ref seen in loaded 3D may be applied', work.mayApply(ids[0], 'probe') === true);
check('...but not again inside the same slow tick', work.mayApply(ids[0], 'live') === false);
check('...unless the server changed it', work.mayApply(ids[0], 'dirty') === true);
tickTo(3 + W.LIVE_EVERY_N_UPDATES);
check('a slow tick later it may be applied again', work.mayApply(ids[0], 'live') === true);
work.seen(ids[0], true); work.markDirty(ids[1]); work.cellLoaded();
work.reset();
check('reset drops every queue, the live set and the apply record', work.backlog === 0 && work.liveCount === 0 && work.mayApply(ids[0], 'live') === true);

let clock = 0;
work = new W.DecorWork();
ids.forEach((id) => work.markDirty(id));
let n = W.runBudget(work, () => { clock += 0.01; }, () => clock);
check('one update never visits more than UPDATE_MAX_VISITS', n === W.UPDATE_MAX_VISITS, n);
clock = 0;
n = W.runBudget(work, () => { clock += 1; }, () => clock);
check('...and stops when the time budget is spent', n === W.UPDATE_BUDGET_MS, n);
clock = 0;
n = W.runBudget(work, () => { clock += 50; }, () => clock);
check('...but always makes progress, even past the budget', n === 1, n);

// ---- the service against a fake engine ----
const makeEngine = () => {
  const calls = { native: 0 };
  const refs = new Map();
  const nat = (fn) => (...a) => { calls.native++; return fn(...a); };
  const base = (kind, name) => ({ kind, getName: nat(() => name) });
  const add = (id, kind, where) => {
    const r = {
      id, where, locked: false, name: null, base: base(kind, kind === 'door' ? 'Door' : 'Chest'),
      is3DLoaded: nat(() => r.where === 'loaded'), getBaseObject: nat(() => r.base), isLocked: nat(() => r.locked),
      setLockLevel: nat(() => {}), lock: nat((v) => { r.locked = v; }), setDisplayName: nat((s) => { r.name = s; }),
    };
    refs.set(id, r);
    return r;
  };
  const sp = { Game: { getFormEx: nat((id) => { const r = refs.get(id); return r && r.where !== 'gone' ? r : null; }) } };
  const platform = {
    ObjectReference: { from: (x) => x || null },
    Door: { from: (b) => (b && b.kind === 'door' ? b : null) },
    Container: { from: (b) => (b && b.kind === 'chest' ? b : null) },
  };
  return { calls, refs, add, sp, platform };
};

const makeService = (src, sweepMod, eng) => {
  const handlers = {};
  const on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); };
  const controller = { on, emitter: { on }, lookupListener: () => null };
  class ClientListener {}
  const mod = load(src, {
    './clientListener': { ClientListener },
    '../../view/worldViewMisc': { remoteIdToLocalId: (id) => id },
    'skyrimPlatform': eng.platform,
    '../../logging': { logTrace: () => {} },
    './refDecorSweep': sweepMod,
  });
  const s = new mod.RefDecorService(eng.sp, controller);
  const fire = (name, arg) => (handlers[name] || []).forEach((f) => f(arg));
  const packet = (refs, full) => fire('customPacketMessage', { message: { contentJsonDump: JSON.stringify({ customPacketType: 'refDecor', full, refs }) } });
  return { s, fire, packet };
};

// The live shape: ~1,700 claimed refs, the doors persistent (resolve from anywhere, no 3D), the chests unresolved, a few here
const world = (eng) => {
  const all = [];
  for (let i = 0; i < 1700; i++) {
    const id = 0x0a000000 + i;
    const door = i % 2 === 0;
    eng.add(id, door ? 'door' : 'chest', i < 6 ? 'loaded' : door ? 'far' : 'gone');
    all.push({ refId: id, name: i % 4 === 0 ? 'Home ' + i : null, locked: door });
  }
  return all;
};

const eng = makeEngine();
const decor = world(eng);
const { s, fire, packet } = makeService(svcSrc, W, eng);
packet(decor, true);
let maxPer = 0;
let total = 0;
const run = (updates) => {
  for (let k = 0; k < updates; k++) {
    const before = eng.calls.native;
    fire('update');
    const d = eng.calls.native - before;
    total += d;
    if (d > maxPer) maxPer = d;
  }
};
run(60);
const farLocked = [...eng.refs.values()].filter((r) => r.where === 'far' && r.base.kind === 'door');
check('the login sync applies every resolvable ref, locking persistent doors wherever they are', farLocked.every((r) => r.locked), farLocked.filter((r) => !r.locked).length);
check('...spread out: no update makes more than UPDATE_MAX_VISITS x 8 native calls', maxPer <= W.UPDATE_MAX_VISITS * 8, maxPer);

maxPer = 0; total = 0;
run(1800);
check('steady state: no update makes more than 100 native calls (the old sweep made thousands at once)', maxPer <= 100, maxPer);
check('...and 30 s of updates cost under 20 native calls an update on average', total / 1800 < 20, total / 1800);

const touched = [];
for (const r of eng.refs.values()) { const f = r.lock; r.lock = (...a) => { touched.push(r.id); return f(...a); }; }
const far = farLocked[10];
far.locked = false;
run(300);
check('a far door is left alone in the background (unattached cells are skipped)', !touched.includes(far.id) && far.locked === false);
packet([{ refId: far.id, name: null, locked: true }], false);
const callsBefore = eng.calls.native;
run(1);
check('a delta packet applies its own ref on the next update, far or not', far.locked === true && touched.includes(far.id));
check('...and visits only that ref, not the whole set', eng.calls.native - callsBefore < 30, eng.calls.native - callsBefore);

const p0 = s.takePerf();
// apply() drops an entry with nothing left to show, so the next full sync brings those back
const dropped = decor.filter((d) => !s.decor.has(d.refId)).length;
packet(decor.map((d) => (d.refId === far.id ? { refId: d.refId, name: null, locked: true } : d)), true);
const p1 = s.takePerf();
check('a full sync that repeats what the client has queues only the entries it had dropped', dropped < 10 && p1.q === p0.q + dropped, { before: p0.q, after: p1.q, dropped });
packet(decor.map((d) => (d.refId === far.id ? { refId: d.refId, name: 'Renamed', locked: true } : d)), true);
check('...and one that changes a single ref queues just that ref', s.takePerf().q === p1.q + 1);
check('the perf take counts packets and sweeps, and resets them', p0.pk >= 1 && p0.sweeps > 0 && p0.msPerSweep >= 0 && p1.pk === 1 && s.takePerf().pk === 0, p0);

const chest = eng.add(0x0b000001, 'chest', 'loaded');
packet([{ refId: chest.id, name: 'Strongbox', locked: false }], false);
let settled = -1;
for (let k = 0; k < 600 && settled < 0; k++) { fire('update'); if (chest.name === 'Strongbox') settled = k; }
check('a chest in front of the player is renamed only after it settles (CHEST_SETTLE_TICKS slow ticks), not sooner',
  settled >= 6 * W.LIVE_EVERY_N_UPDATES, settled);

const door = eng.add(0x0b000002, 'door', 'gone');
packet([{ refId: door.id, name: 'Late Door', locked: true }], false);
run(5);
check('a changed ref that is not loaded anywhere waits', door.locked === false);
door.where = 'loaded';
fire('cellFullyLoaded', {});
run(W.CELL_SETTLE_UPDATES + Math.ceil(1702 / W.UPDATE_MAX_VISITS) + 5);
check('...and is applied by the probe pass after its cell loads', door.locked === true && door.name === 'Late Door', { locked: door.locked, name: door.name });

for (const r of eng.refs.values()) { r.locked = false; r.name = null; }
fire('gameLoad');
maxPer = 0;
run(80);
check('a save load re-applies every resolvable ref', farLocked.every((r) => r.locked), farLocked.filter((r) => !r.locked).length);
check('...still within the per-update cap', maxPer <= W.UPDATE_MAX_VISITS * 8, maxPer);

// ---- the service's wiring ----
check('apply() is still the only place that names or locks', (svcSrc.match(/setDisplayName\(|\.lock\(/g) || []).length === 4 && /private apply\(d: RefDecor/.test(svcSrc));
check('the update handler runs under the budget', /runBudget\(this\.work/.test(svcSrc) && !/pickSweep/.test(svcSrc));

// ---- mutants ----
const mutants = [
  ['the visit cap is ignored', (src) => src.replace('while (n < maxVisits && (n === 0 || now() - t0 < budgetMs))', 'while (n === 0 || now() - t0 < budgetMs)')],
  ['the time budget is ignored', (src) => src.replace('while (n < maxVisits && (n === 0 || now() - t0 < budgetMs))', 'while (n < maxVisits)')],
  ['refs in loaded 3D are never revisited', (src) => src.replace('this.liveIds.forEach((id) => this.live.push(id));', '')],
  ['the trickle never runs', (src) => src.replace('if (this.probe.size === 0) this.trickle(ids());', '')],
  ['a cell load never probes', (src) => src.replace('ids().forEach((id) => this.probe.push(id));', '')],
  ['every visit may apply', (src) => src.replace('if (kind !== "dirty" && last !== undefined', 'if (false && last !== undefined')],
];
let killed = 0;
for (const [name, mutate] of mutants) {
  const mutated = mutate(planSrc);
  if (mutated === planSrc) { console.log(`FAIL mutant "${name}" did not apply`); failures++; continue; }
  let survived = true;
  try {
    const M = load(mutated);
    let c = 0;
    const wk = new M.DecorWork();
    ids.forEach((id) => wk.markDirty(id));
    const capOk = M.runBudget(wk, () => { c += 0.01; }, () => c) === M.UPDATE_MAX_VISITS;
    const timeOk = M.runBudget(wk, () => { c += 1; }, () => c) === M.UPDATE_BUDGET_MS;
    const w2 = new M.DecorWork();
    w2.seen(ids[0], true);
    let live = 0, probes = 0;
    for (let k = 0; k < M.LIVE_EVERY_N_UPDATES; k++) w2.tick(() => ids);
    let x;
    while ((x = w2.next())) { if (x.kind === 'live') live++; if (x.kind === 'probe') probes++; }
    const w3 = new M.DecorWork();
    w3.cellLoaded();
    let cellProbes = 0;
    for (let k = 0; k <= M.CELL_SETTLE_UPDATES; k++) w3.tick(() => ids);
    while ((x = w3.next())) cellProbes++;
    const w4 = new M.DecorWork();
    w4.mayApply(ids[0], 'live');
    const once = w4.mayApply(ids[0], 'live') === false;
    survived = capOk && timeOk && live === 1 && probes === M.PROBE_TRICKLE && cellProbes === ids.length && once;
  } catch {
    survived = false;
  }
  if (survived) { console.log(`FAIL mutant survived: ${name}`); failures++; } else { killed++; }
}
console.log(`ok   ${killed}/${mutants.length} mutants killed`);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
