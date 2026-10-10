// Scripted test for the player's own look and its trace (sync/appearance.ts, sync/appearanceTrace.ts; client 0.3.91): the
// face presets go on before the face sliders, so with an engine whose setFacePreset resets the sliders the base still reads
// back what was sent; every own apply traces "own <event> ..." with the look sent and the mismatches read back from the
// live base; a read-back follows 8 s later (not for previews, not once a newer look went on); RaceMenu's face load asks
// for a read-back now and 3 s later; no name reaches a trace line. Run from skymp5-client:
//
//   node tests/appearance-trace-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP appearance-trace (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);
const SRC = path.resolve(__dirname, '../src');

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`);
  if (!ok) failures++;
};

const A = { base: null, waits: [], onces: [], traces: [] };
globalThis.__apT = A;
const STUBS = {
  skyrimPlatform: `
const A = globalThis.__apT;
const formOf = (id) => (id ? { id, getFormID: () => id } : null);
module.exports = {
  Game: { getPlayer: () => A.player, getFormEx: (id) => formOf(id >>> 0) },
  ActorBase: { from: (b) => b }, Actor: { from: (a) => a },
  TESModPlatform: { setNpcSex: (b, s) => { b.sex = s; }, setNpcRace: (b, r) => { b.race = r.getFormID(); }, setNpcSkinColor() {}, setNpcHairColor() {},
    resizeHeadpartsArray: (b, n) => { b.parts = new Array(n).fill(0); }, clearTintMasks() {}, pushTintMask() {}, setFormIdUnsafe() {}, createNpc: () => null },
  Race: { from: (f) => f }, HeadPart: { from: (f) => (f ? { getFormID: () => f.id, isExtraPart: () => false, getType: () => 1 } : null) },
  TextureSet: { from: () => null }, VoiceType: { from: () => null },
  printConsole() {}, on() {}, once: (ev, fn) => { if (ev === 'update') A.onces.push(fn); },
  Utility: { wait: (s) => ({ then: (fn) => { A.waits.push([s, fn]); } }) }, ObjectReference: {},
  writeLogs() {},
};`,
};
const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /^skyrimPlatform$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
  },
};

// An engine-like base: setFacePreset resets every face slider (what overwrote the sliders when it came second)
const makeBase = (opts = {}) => {
  const b = {
    race: 0, sex: 0, parts: [], presets: [0, 0, 0, 0], morphs: new Array(19).fill(0), calls: [],
    getFormID: () => 7, setWeight() {}, setFaceTextureSet() {}, setVoiceType() {}, setName: (n) => { b.name = n; },
    setNthHeadPart: (p, i) => { b.parts[i] = p.getFormID(); },
    setFacePreset: (v, i) => { b.presets[i] = v; b.morphs.fill(0); b.calls.push('preset'); },
    setFaceMorph: (v, i) => { if (opts.ignoreMorph !== i) b.morphs[i] = v; b.calls.push('morph'); },
    getFacePreset: (i) => b.presets[i], getFaceMorph: (i) => b.morphs[i], getSex: () => b.sex,
    getRace: () => (b.race ? { getFormID: () => b.race } : null), getNumHeadParts: () => b.parts.length,
  };
  return b;
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-aptrace-'));
  let M, T, D;
  try {
    const out = path.join(dir, 'appearance.js');
    await esbuild.build({ entryPoints: [path.join(SRC, 'sync/appearance.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, plugins: [stubPlugin], logLevel: 'error' });
    M = require(out);
    const t = path.join(dir, 'trace.js');
    await esbuild.build({ entryPoints: [path.join(SRC, 'sync/appearanceTrace.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: t, logLevel: 'error' });
    T = require(t);
    const d = path.join(dir, 'diag.js');
    await esbuild.build({ entryPoints: [path.join(SRC, 'lib/clientDiag.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: d, logLevel: 'error' });
    D = require(d);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const look = { name: 'Fink Winky', raceId: 0x13747, isFemale: true, weight: 75, skinColor: 0, hairColor: 0, headTextureSetId: 0,
    headpartIds: [0x1a2b3, 0x1a2b4, 0x1a2b5], tints: [], presets: [30, -1, 29, 26],
    options: [1, 1, -1, 1, -1, 1, 1, -0.42, 0.3, 0, 0.5, -0.5, 0.25, 0.1, -0.1, 0.9, -0.9, 0.6, -0.6] };
  const setup = (opts) => {
    A.base = makeBase(opts);
    A.player = { getBaseObject: () => A.base, queueNiNodeUpdate() {}, regenerateHead() {}, startDeferredKill() {}, changeHeadPart() {} };
    A.waits = []; A.onces = []; A.traces = [];
  };
  globalThis.__dboTrace = (line) => A.traces.push(line);
  const runTimers = (seconds) => {
    const due = A.waits.filter(([s]) => s === seconds); A.waits = A.waits.filter(([s]) => s !== seconds);
    due.forEach(([, fn]) => fn());
    const onces = A.onces.splice(0, A.onces.length); onces.forEach((fn) => fn());
  };

  // ---- the order and the read-back ----
  setup();
  M.applyAppearanceToPlayer(look, false, 'spawn');
  const firstMorph = A.base.calls.indexOf('morph'), lastPreset = A.base.calls.lastIndexOf('preset');
  check('every face preset goes on before the first face slider', lastPreset >= 0 && firstMorph > lastPreset, A.base.calls.join(','));
  check('so the base reads back all 19 sliders as sent, though setFacePreset resets them', look.options.every((v, i) => Math.abs(A.base.morphs[i] - v) < 1e-6), A.base.morphs);
  check('and the 4 presets', look.presets.every((v, i) => A.base.presets[i] === v), A.base.presets);
  const line = A.traces[0] || '';
  check('one trace line for the apply: event, race, sex, head parts, presets, sliders, no mismatch',
    line === 'own spawn r=13747 s=1 hp=3/3 p=30,-1,29,26 o=1,1,-1,1,-1,1,1,-.42,.3,0,.5,-.5,.25,.1,-.1,.9,-.9,.6,-.6 mm=-', line);
  check('the line is only codes and numbers (unchanged by the trace filter) and has no name', D.traceSafe(line) === line && !/Fink|Winky/.test(A.traces.join()), line);

  // the order the 0.3.90 client used, on the same engine-like base: what the trace would have shown
  {
    const b = makeBase();
    b.race = look.raceId; b.sex = 1;
    look.options.forEach((v, i) => b.setFaceMorph(v, i));
    look.presets.forEach((v, i) => b.setFacePreset(v, i));
    const mm = T.lookMismatches(look, T.readLook(b));
    check('sliders first then presets (0.3.90) reads back wrong, and the trace names each slider', mm.length === 13 && mm[0] === 'o0:1>0' && mm[12] === '+6', mm);
  }

  // ---- the read-back 8 s later ----
  const eights = () => A.waits.filter(([s]) => s === 8).length;
  check('a read-back is due 8 s later', eights() === 1, A.waits.map(([s]) => s));
  A.base.morphs[3] = 0.2;
  runTimers(8);
  check('8 s later: the base read again, a slider changed since is named', A.traces[1] === 'own spawn+8s hp=3 mm=o3:1>.2', A.traces);
  setup();
  M.applyAppearanceToPlayer(look, false, 'load');
  M.applyAppearanceToPlayer(Object.assign({}, look, { options: look.options.slice() }), true, 'update');
  runTimers(8);
  check('a look replaced within the 8 s gets no read-back of its own (only the newer one does)', A.traces.filter((l) => /\+8s/.test(l)).length === 1
    && A.traces.some((l) => /^own update\+8s /.test(l)), A.traces);
  setup();
  M.applyAppearanceToPlayer(look, false, 'preview');
  check('a creator preview is traced but schedules no read-back', A.traces.length === 1 && /^own preview /.test(A.traces[0]) && eights() === 0, A.waits.map(([s]) => s));

  // ---- mismatches ----
  setup({ ignoreMorph: 7 });
  M.applyAppearanceToPlayer(look, false, 'spawn');
  check('a slider the base did not take is listed with what it reads', /mm=o7:-\.42>0$/.test(A.traces[0]), A.traces[0]);
  {
    const got = { raceId: 0x13746, sex: 0, presets: [30, -1, 29, 26], options: look.options.slice(), parts: 3 };
    check('race and sex read back wrong are listed first', T.lookMismatches(look, got).join() === 'r:13747>13746,s:1>0', T.lookMismatches(look, got));
    const nan = { raceId: 0x13747, sex: 1, presets: [NaN, -1, 29, 26], options: look.options.slice(), parts: NaN };
    check('an unreadable value counts as a mismatch, shown as nan', T.lookMismatches(look, nan).join() === 'p0:30>nan', T.lookMismatches(look, nan));
    check('numbers: two decimals, no leading zero', [0.4242, -0.425, 1, 0, -0, 2.005, NaN, -1.5].map(T.num).join() === '.42,-.42,1,0,0,2.01,nan,-1.5', [0.4242, -0.425, 1, 0, -0, 2.005, NaN, -1.5].map(T.num));
  }
  {
    const throwing = { getRace() { throw new Error('x'); }, getSex() { throw new Error('x'); }, getFacePreset() { throw new Error('x'); },
      getFaceMorph() { throw new Error('x'); }, getNumHeadParts() { throw new Error('x'); } };
    let threw = null, r = null;
    try { r = T.readLook(throwing); } catch (e) { threw = e; }
    check('a base that throws on every read: no throw, every value unreadable', threw === null && r.raceId === 0 && Number.isNaN(r.sex) && r.options.every(Number.isNaN));
  }

  // ---- RaceMenu's face load asks for read-backs ----
  setup();
  M.applyAppearanceToPlayer(look, false, 'spawn');
  A.traces = []; A.waits = [];
  A.base.morphs[0] = 0.5;
  globalThis.__dboAppearanceRecheck('rmface');
  globalThis.__dboAppearanceRecheck('rmface', 3);
  check('rmface: read back at once against the last look', A.traces[0] === 'own rmface hp=3 mm=o0:1>.5', A.traces);
  runTimers(3);
  check('rmface+3s: and again 3 s later', A.traces[1] === 'own rmface+3s hp=3 mm=o0:1>.5', A.traces);
  globalThis.__dboAppearanceRecheck('rm face "x"');
  check('an event name is reduced to letters and digits', A.traces[2] === 'own rmfacex hp=3 mm=o0:1>.5', A.traces);

  // ---- without a trace sink nothing is read or scheduled; an apply never throws for the trace's sake ----
  delete globalThis.__dboTrace;
  setup();
  M.applyAppearanceToPlayer(look, false, 'spawn');
  check('no sink: nothing scheduled', eights() === 0);
  globalThis.__dboTrace = () => { throw new Error('sink broken'); };
  setup();
  let threw = null;
  try { M.applyAppearanceToPlayer(look, false, 'spawn'); } catch (e) { threw = e; }
  check('a broken sink does not break the apply', threw === null && A.base.morphs[7] === -0.42, threw && threw.message);

  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL harness threw', e && e.stack); process.exit(1); });
