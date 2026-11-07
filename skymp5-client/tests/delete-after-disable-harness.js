// npcLifetimeRuntime's deletes never race a queued Papyrus Disable (56113+0x14C crash, 5-7 Nov): the engine's DisableFunctor
// keeps only the form id and looks it up when the VM runs it, so a Delete() before that frees the id for another form.
// The fake engine below queues every disable as a functor that runs only when the test lets the VM run. Run from skymp5-client:
//
//   node tests/delete-after-disable-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP delete-after-disable (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const SP_STUB = `
const forms = new Map();
const handlers = { tick: [], update: [] };
const calls = [];
const vmQueue = [];
const fake = { forms, handlers, calls, vmQueue, crashes: [], menus: false, retired: [], frame: 0 };
// A queued functor holding the id only, as SkyrimScript::DisableFunctor does
const queueDisable = (id, done) => vmQueue.push(() => {
  const r = forms.get(id);
  if (!r || r.deleted || r.gen !== fake.gens.get(id)) { fake.crashes.push(id); if (done) done.fail(); return; }
  r.disabled = true;
  if (done) done.ok();
});
fake.gens = new Map();
fake.runVm = () => { const q = vmQueue.splice(0); q.forEach((f) => f()); };
fake.mk = (id, o) => {
  const gen = (fake.gens.get(id) || 0) + 1; fake.gens.set(id, gen);
  const r = Object.assign({ gen, deleted: false, disabled: false, loaded: true, dead: false, actor: true }, o || {});
  r.getFormID = () => id;
  r.isDeleted = () => r.deleted;
  r.isDisabled = () => r.disabled;
  r.is3DLoaded = () => r.loaded && !r.disabled;
  r.isDead = () => r.dead;
  r.isBleedingOut = () => false; r.isUnconscious = () => false; r.isInKillMove = () => false;
  r.getBaseObject = () => ({ getFormID: () => 7 });
  r.delete = () => { r.deleted = true; calls.push(['delete', id, fake.frame]); };
  r.disableNoWait = () => { calls.push(['disable', id, fake.frame]); queueDisable(id, null); };
  r.disable = () => {
    calls.push(['disable', id, fake.frame]);
    if (r.throwOnDisable) throw new Error('gone');
    const cbs = [];
    queueDisable(id, { ok: () => cbs.forEach((c) => c[0]()), fail: () => cbs.forEach((c) => c[1]()) });
    return { then: (ok, fail) => { cbs.push([ok, fail]); } };
  };
  r.setPosition = () => calls.push(['setPosition', id, fake.frame]);
  r.getPositionX = () => 0; r.getPositionY = () => 0; r.getPositionZ = () => 0;
  forms.set(id, r);
  return r;
};
module.exports = {
  __fake: fake,
  Game: { getFormEx: (id) => forms.get(id) || null },
  ObjectReference: { from: (x) => x || null },
  Actor: { from: (x) => (x && x.actor ? x : null) },
  Ui: { isMenuOpen: () => fake.menus },
  on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
  writeLogs: () => {},
  settings: {},
  retireCopy: (id) => { fake.retired.push(id); return true; },
  processCopyRetires: () => [],
  isCopyRetiring: (id) => fake.retired.includes(id),
};`;

function pure({ deleteDecision, newPendingDelete, SAFE_DELETE_GIVE_UP_MS }) {
  let p = newPendingDelete(), d;
  let deleted = false;
  for (let i = 0; i < 200 && !deleted; i++) { ({ decision: d, next: p } = deleteDecision(p, false, false, 100)); deleted = d === 'delete'; }
  check('3D gone but the Disable not settled: never a delete', !deleted && p.disabled === false);
  p = newPendingDelete();
  let t = 0;
  for (; t < 400; t++) { ({ decision: d, next: p } = deleteDecision(p, false, false, 100)); if (d !== 'wait') break; }
  check('...and it gives up at the usual 30 s, left disabled', d === 'give-up' && p.waitedMs >= SAFE_DELETE_GIVE_UP_MS, { d, waited: p.waitedMs });
  p = Object.assign(newPendingDelete(), { disabled: true });
  let n = 0;
  for (; n < 100; n++) { ({ decision: d, next: p } = deleteDecision(p, false, false, 100)); if (d === 'delete') break; }
  check('settled and 3D gone: deleted after the usual 2 s', d === 'delete' && n === 19, n);
  ({ next: p } = deleteDecision(Object.assign(newPendingDelete(), { disabled: true }), false, true, 100));
  check('a loading screen keeps the settled flag', p.disabled === true);
}

function runtime(rt, fake, driftConfig) {
  const { forms, handlers, calls } = fake;
  let clock = 1_800_000_000_000;
  Date.now = () => clock;
  const step = () => { fake.frame++; clock += 100; handlers.tick.forEach((h) => h()); handlers.update.forEach((h) => h()); };
  const steps = (k) => { for (let i = 0; i < k; i++) step(); };
  const of = (id, kind) => calls.filter((c) => c[1] === id && (!kind || c[0] === kind));
  step();

  // A dead copy is deferred; its 3D goes with the cell while the VM is busy
  const a = 0xff005000; fake.mk(a, { dead: true });
  rt.safeDelete(forms.get(a));
  check('a dead copy is disabled, not deleted', of(a, 'disable').length === 1 && of(a, 'delete').length === 0);
  forms.get(a).loaded = false;
  steps(60);
  check('6 s of 3D gone with the Disable still queued: no Delete', of(a, 'delete').length === 0, of(a));
  check('...and it is still handed to delete', rt.isHandedToDelete(a));
  fake.runVm();
  check('the queued Disable then runs on the live ref', fake.crashes.length === 0 && forms.get(a).disabled);
  steps(25);
  check('once it settled, the copy is deleted', of(a, 'delete').length === 1, of(a));
  const dis = of(a, 'disable')[0], del = of(a, 'delete')[0];
  check('never in the frame of its disable', del && dis && del[2] > dis[2]);

  // The VM runs before the 3D goes: ordinary case, the delete follows as before
  const b = 0xff005001; fake.mk(b, { dead: true });
  rt.safeDelete(forms.get(b));
  step(); fake.runVm(); steps(25);
  check('a Disable that settles at once: deleted in the usual time', of(b, 'delete').length === 1 && fake.crashes.length === 0);

  // The id freed and reused: the engine's case, recorded as a crash by the fake
  const c = 0xff005002; fake.mk(c, { dead: true });
  rt.safeDelete(forms.get(c));
  forms.get(c).loaded = false;
  steps(40);
  fake.mk(c, { actor: false });
  fake.runVm();
  check('no functor ever met a freed or reused id', fake.crashes.length === 0, fake.crashes.map((x) => x.toString(16)));

  // A Disable that never settles: given up, left disabled, never deleted
  const g = 0xff005003; fake.mk(g, { dead: true });
  rt.safeDelete(forms.get(g));
  forms.get(g).loaded = false;
  steps(320);
  check('an unsettled Disable is given up after 30 s, never deleted', of(g, 'delete').length === 0 && !rt.isHandedToDelete(g));
  fake.runVm();

  // disable() throwing (the ref already going): nothing is queued, so the delete may follow
  const h = 0xff005004; fake.mk(h, { dead: true, throwOnDisable: true });
  rt.safeDelete(forms.get(h));
  forms.get(h).loaded = false;
  steps(25);
  check('a disable that throws counts as settled', of(h, 'delete').length === 1);

  // The immediate plan (a calm copy without 3D): Delete() alone, no disable in its frame
  const i0 = 0xff005005; fake.mk(i0, { loaded: false });
  const f0 = fake.frame;
  rt.safeDelete(forms.get(i0));
  check('the delete plan deletes at once', of(i0, 'delete').length === 1);
  check('...with no disable queued before it (no same-frame disable + delete)', of(i0, 'disable').length === 0 && of(i0).every((x) => x[2] === f0), of(i0));
  fake.runVm();
  check('...so no functor outlives it', fake.crashes.length === 0);

  // A loading screen still holds a settled delete
  const l = 0xff005006; fake.mk(l, { dead: true });
  rt.safeDelete(forms.get(l));
  forms.get(l).loaded = false;
  fake.runVm(); fake.menus = true; steps(40);
  check('a loading screen holds the delete', of(l, 'delete').length === 0);
  fake.menus = false; steps(25);
  check('...which runs after it', of(l, 'delete').length === 1);

  // nativeRetire: the platform's retireCopy, no Papyrus disable or delete
  driftConfig.nativeRetire = true;
  const n = 0xff005007; fake.mk(n, { dead: true });
  rt.safeDelete(forms.get(n));
  steps(30);
  check('nativeRetire: retired natively, no Papyrus disable or delete', fake.retired.includes(n) && of(n).length === 0 && rt.isHandedToDelete(n), of(n));
  driftConfig.nativeRetire = false;

  // Any delete anywhere above came after its own disable had settled
  const bad = calls.filter((x) => x[0] === 'delete').filter((x) => calls.some((y) => y[0] === 'disable' && y[1] === x[1] && y[2] === x[2]));
  check('no copy was ever disabled and deleted in the same frame', bad.length === 0, bad);
}

function wiring() {
  const rt = fs.readFileSync(path.resolve(__dirname, '../src/view/npcLifetimeRuntime.ts'), 'utf8');
  const body = rt.slice(rt.indexOf('const deleteOrDefer'), rt.indexOf('export const disableOnly'));
  check('deleteOrDefer never uses disableNoWait', body.length > 0 && !/disableNoWait/.test(body));
  check('the deferred delete waits on the Disable promise', /refr\.disable\(false\)\.then\(settled, settled\)/.test(body));
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-delafter-'));
  try {
    const stub = [{ name: 'sp', setup(b) {
      b.onResolve({ filter: /^skyrimPlatform$/ }, () => ({ path: 'sp', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: SP_STUB, loader: 'js' }));
    } }];
    const entry = path.join(tmp, 'entry.js');
    const src = (p) => JSON.stringify(path.resolve(__dirname, '../src', p));
    fs.writeFileSync(entry, `module.exports = { rt: require(${src('view/npcLifetimeRuntime.ts')}), pure: require(${src('view/npcLifetime.ts')}),
      drift: require(${src('sync/driftConfig.ts')}).driftConfig, fake: require('skyrimPlatform').__fake };`);
    const out = path.join(tmp, 'bundle.js');
    await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error', plugins: stub });
    const m = require(out);
    pure(m.pure);
    runtime(m.rt, m.fake, m.drift);
    wiring();
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
