// A copy deleted while SpawnProcess waited for its resurrect (a respawn, a clean-up, the 0.3.95 clone storm) threw from
// the resurrect's continuation: setRefrCollision's native looks the ref up and throws "'refr' nullptr", an unhandled
// rejection every time (cerr 3c759f09, 93 on 13 Oct). The earlier steps (enable, resurrect) already look the copy up
// again and stop when it is gone; the last one now does too. Latent natives resolve in Skyrim Platform's update (jsThrQ,
// then the promise jobs, all with the VM set), so the continuation may call getFormEx; this fake game resolves them inside
// an update and throws on natives outside one. Runs the real spawnProcess.ts. Run from skymp5-client:
//
//   node tests/spawn-resurrect-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP spawn-resurrect (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

// The game: a native works only inside an update; a latent one returns a promise resolved on a later update
const G = globalThis.__sres = { inUpdate: false, forms: new Map(), latent: [], collisions: [], tints: [], flyerBits: 0 };
const native = (name, fn) => (...args) => {
  if (!G.inUpdate) throw new Error(`'${name}' can't be called in this context`);
  return fn(...args);
};
const latent = (name, id) => native(name, () => new Promise((resolve) => G.latent.push({ name, id, resolve })));
const copy = (id) => {
  const r = { isRef: true, isActor: true, id,
    getFormID: native('Form.getFormID', () => id), getBaseObject: native('ObjectReference.getBaseObject', () => ({ id: 0x7 })),
    setPosition: latent('ObjectReference.setPosition', id), enable: latent('ObjectReference.enable', id),
    resurrect: latent('Actor.resurrect', id), setMotionType: latent('ObjectReference.setMotionType', id) };
  G.forms.set(id, r);
  return r;
};

const STUBS = {
  skyrimPlatform: `const G = () => globalThis.__sres;
    const native = (name, fn) => (...a) => { if (!G().inUpdate) throw new Error("'" + name + "' can't be called in this context"); return fn(...a); };
    const player = { getWorldSpace: native('ObjectReference.getWorldSpace', () => ({ id: 0x3c })), getParentCell: native('ObjectReference.getParentCell', () => null) };
    module.exports = {
      Game: { getFormEx: native('Game.getFormEx', (id) => G().forms.get(id >>> 0) || null), getPlayer: () => player },
      ObjectReference: { from: (f) => (f && f.isRef ? f : null) }, Actor: { from: (f) => (f && f.isActor ? f : null) },
      TESModPlatform: { moveRefrToPosition: native('TESModPlatform.moveRefrToPosition', () => {}) },
      MotionType: { Keyframed: 4 }, Cell: {}, WorldSpace: {},
    };`,
  appearance: `module.exports = { applyTints: (ac, look) => globalThis.__sres.tints.push(ac.id) };`,
  // Skyrim Platform's setCollision: TESForm::LookupByID, no VM needed, throws on a missing ref (ObjectReferenceApi.cpp)
  animation: `module.exports = { setRefrCollision: (id, on) => {
    if (!globalThis.__sres.forms.has(id >>> 0)) throw new Error("'refr' nullptr");
    globalThis.__sres.collisions.push([id, on]); } };`,
  objectReferenceEx: 'module.exports = { ObjectReferenceEx: { dealWithRef() {} } };',
  flyerGuard: 'module.exports = { FLYER_NO_RESURRECT: 2, guardOn: (bits, b) => (bits & b) !== 0 };',
  flyerRuntime: `module.exports = { noteFlyer() {}, takeSpawnGuard: () => (globalThis.__sres.flyerBits ? { bits: globalThis.__sres.flyerBits, remoteId: 0xff0000aa, bornAt: 0 } : undefined) };`,
  empty: 'module.exports = {};',
};
const STUB_OF = {
  skyrimPlatform: 'skyrimPlatform', '../sync/appearance': 'appearance', '../sync/animation': 'animation', '../sync/movement': 'empty',
  '../extensions/objectReferenceEx': 'objectReferenceEx', './flyerGuard': 'flyerGuard', './flyerRuntime': 'flyerRuntime',
};

const rejections = [];
process.on('unhandledRejection', (e) => rejections.push(String(e && e.message ? e.message : e)));
const settle = () => new Promise((r) => setImmediate(r));
// One update: the latent natives finish, then their continuations run, all inside it
const frame = async () => {
  G.inUpdate = true;
  for (const l of G.latent.splice(0)) l.resolve();
  await settle();
  G.inUpdate = false;
  await settle();
};
const pending = () => G.latent.map((l) => l.name);

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-jake-spawn-resurrect-'));
  const out = path.join(tmp, 'spawnProcess.js');
  try {
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/view/spawnProcess.ts')], bundle: true, platform: 'node',
      format: 'cjs', outfile: out, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
      } }],
    });
    await run(require(out));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}

async function run({ SpawnProcess }) {
  const LOOK = { name: 'Lydia' };
  const reset = () => { G.forms.clear(); G.latent = []; G.collisions = []; G.tints = []; G.flyerBits = 0; rejections.length = 0; };
  // formView starts the process from its update
  const start = (id, done) => { G.inUpdate = true; try { new SpawnProcess(LOOK, [10, 20, 30], id, done); } finally { G.inUpdate = false; } };

  reset();
  let born = 0;
  copy(0xff000101);
  start(0xff000101, () => born++);
  check('a spawn waits for setPosition', JSON.stringify(pending()) === '["ObjectReference.setPosition"]', pending());
  await frame();
  check('...then tints and enables the copy', G.tints.length === 1 && JSON.stringify(pending()) === '["ObjectReference.enable"]', pending());
  await frame();
  check('...then resurrects it', JSON.stringify(pending()) === '["Actor.resurrect"]', pending());
  await frame();
  check('...and once resurrected turns its collision on and reports it born', born === 1 && JSON.stringify(G.collisions) === JSON.stringify([[0xff000101, true]])
    && rejections.length === 0, { born, collisions: G.collisions, rejections });

  reset();
  born = 0;
  copy(0xff000102);
  start(0xff000102, () => born++);
  await frame(); await frame();
  check('a second copy is waiting on its resurrect', JSON.stringify(pending()) === '["Actor.resurrect"]', pending());
  G.forms.delete(0xff000102); // deleted meanwhile (a respawn, a clean-up)
  await frame();
  check('deleted while it was being resurrected: no unhandled rejection', rejections.length === 0, rejections);
  check('...no collision call and no "born" for a copy that is gone', born === 0 && G.collisions.length === 0, { born, collisions: G.collisions });

  reset();
  born = 0;
  copy(0xff000103);
  start(0xff000103, () => born++);
  await frame();
  G.forms.delete(0xff000103);
  await frame(); await frame();
  check('deleted before its enable finished: it stops there, as before', born === 0 && G.collisions.length === 0 && rejections.length === 0
    && pending().length === 0, { born, rejections, pending: pending() });

  reset();
  born = 0;
  G.flyerBits = 2; // a dragon's copy with FLYER_NO_RESURRECT on
  copy(0xff000104);
  start(0xff000104, () => born++);
  await frame(); await frame();
  check('a dragon\'s copy told not to be resurrected gets its collision and is born without a resurrect', born === 1
    && JSON.stringify(G.collisions) === JSON.stringify([[0xff000104, true]]) && pending().length === 0 && rejections.length === 0,
  { born, collisions: G.collisions, pending: pending(), rejections });
}

main().catch((e) => { console.error(e); process.exit(1); });
