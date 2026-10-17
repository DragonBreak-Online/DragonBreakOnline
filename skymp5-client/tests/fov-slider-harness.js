// Scripted test for fovService.ts and the F3 field of view slider ("dbo:fov" set / reset / query).
// SkyrimPlatform delivers browserMessage as a tick task (main.cpp HandleMessage, AddTickTask). There is no Papyrus VM in
// tick, so callNative throws "can't be called in this context" (CallNativeApi.cpp): Utility.wait, Utility.setINIFloat,
// Ui.isMenuOpen, Game.getCameraState and the SKSE Camera natives. SkyrimPlatform's own getCameraFov/setCameraFov and
// browser.executeJavaScript work anywhere. The fake below throws the same way outside an update, so a slider step that
// touches a Papyrus native from the message handler fails here as it does in the game.
//
// Run from skymp5-client:
//
//   node tests/fov-slider-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP fov-slider (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };
const STUBS = {
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  logging: 'module.exports = { logError: (s, ...a) => globalThis.__fovLog.push(["error", ...a.map(String)]), logTrace: (s, ...a) => globalThis.__fovLog.push(["trace", ...a.map(String)]) };',
  skyrimPlatform: 'module.exports = {};',
};
const STUB_OF = { './clientListener': 'clientListener', '../../logging': 'logging', skyrimPlatform: 'skyrimPlatform' };

// A game: Papyrus natives only inside an update; the platform camera calls anywhere
function makeGame({ platform, ini = 90, saved = null }) {
  const g = { inUpdate: false, camera: { world: 65, first: 65 }, ini: { 'fDefaultWorldFOV:Display': ini, 'fDefault1stPersonFOV:Display': ini },
    waits: [], pageJs: [], natives: [], cameraState: 9, bounces: 0, raceMenuOpen: false };
  const papyrus = (name, f) => (...a) => {
    if (!g.inUpdate) throw new Error(`'${name}' can't be called in this context`);
    g.natives.push(name);
    return f(...a);
  };
  const sp = {
    Utility: {
      wait: papyrus('Utility.wait', (s) => new Promise((res) => g.waits.push({ s, res }))),
      getINIFloat: papyrus('Utility.getINIFloat', (k) => g.ini[k]),
      setINIFloat: papyrus('Utility.setINIFloat', (k, v) => { g.ini[k] = v; }),
    },
    Ui: { isMenuOpen: papyrus('Ui.isMenuOpen', () => g.raceMenuOpen) },
    Game: {
      getCameraState: papyrus('Game.getCameraState', () => g.cameraState),
      forceThirdPerson: papyrus('Game.forceThirdPerson', () => { g.bounces++; }),
      forceFirstPerson: papyrus('Game.forceFirstPerson', () => {}),
    },
    // 1.6.1170: the SKSE Camera natives are never bound, callNative returns null
    callNative: (cls, fn) => { if (!g.inUpdate) throw new Error(`'${cls}.${fn}' can't be called in this context`); g.natives.push(`${cls}.${fn}`); return null; },
    browser: { executeJavaScript: (src) => { g.pageJs.push(src); } },
    getPluginSourceCode: () => (saved ? '//' + JSON.stringify({ ui: { fov: saved } }) : ''),
  };
  if (platform) {
    sp.getCameraFov = () => ({ world: g.camera.world, firstPerson: g.camera.first });
    sp.setCameraFov = (w, f) => {
      if (w !== null && w !== undefined) g.camera.world = w;
      if (f !== null && f !== undefined) g.camera.first = f;
      return { world: g.camera.world, firstPerson: g.camera.first };
    };
  }
  const handlers = {}, onceUpdate = [];
  const controller = {
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
    once: (ev, fn) => { if (ev === 'update') onceUpdate.push(fn); else (handlers[ev] = handlers[ev] || []).push(fn); },
  };
  g.sp = sp; g.controller = controller; g.onceUpdate = onceUpdate;
  // One frame: the update handlers queued before it run with the VM
  g.update = () => { const run = onceUpdate.splice(0); g.inUpdate = true; try { for (const f of run) f(); } finally { g.inUpdate = false; } return run.length; };
  // A page message, delivered the way SkyrimPlatform does: in tick, outside an update
  g.message = (...args) => { let threw = null; for (const f of handlers.browserMessage || []) { try { f({ arguments: args }); } catch (e) { threw = e; } } return threw; };
  // Resolves every pending Utility.wait, then lets the promise callbacks run
  g.elapse = async () => { const w = g.waits.splice(0); for (const x of w) x.res(); await new Promise((r) => setImmediate(r)); return w.map((x) => x.s); };
  return g;
}

const errors = () => globalThis.__fovLog.filter((l) => l[0] === 'error');
const traces = (word) => globalThis.__fovLog.filter((l) => l[0] === 'trace' && l.some((x) => x.includes(word)));

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'fov-slider-'));
  const out = path.join(tmp, 'fovService.js');
  try {
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/services/services/fovService.ts')], bundle: true, platform: 'node', format: 'cjs',
      outfile: out, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
      } }],
    });
    const { FovService } = require(out);

    // ---- the new DLL (platform route)
    globalThis.__fovLog = [];
    let g = makeGame({ platform: true });
    new FovService(g.sp, g.controller);
    g.update();
    check('startup reads the launcher value 90 from the ini', traces('configured').length === 1 && traces('configured')[0].join(' ').includes('world 90'), globalThis.__fovLog);
    globalThis.__fovLog = []; g.natives.length = 0;

    let threw = g.message('dbo:fov', 'set', 100);
    check('a slider step in tick does not throw', threw === null, threw && threw.message);
    check('a slider step in tick logs no error', errors().length === 0, errors());
    check('a slider step in tick calls no Papyrus native', g.natives.length === 0, g.natives);
    check('the step waits for the next update', g.camera.world === 65 && g.onceUpdate.length === 1, g.camera);
    g.update();
    check('on the next update the camera holds 100 / 100', g.camera.world === 100 && g.camera.first === 100, g.camera);
    check('and the ini holds 100 / 100', g.ini['fDefaultWorldFOV:Display'] === 100 && g.ini['fDefault1stPersonFOV:Display'] === 100, g.ini);
    check('no error on the update either', errors().length === 0, errors());

    // A drag: three steps before one frame are applied once, with the newest value
    g.message('dbo:fov', 'set', 105); g.message('dbo:fov', 'set', 110); threw = g.message('dbo:fov', 'set', 120);
    check('three steps queue one update', g.onceUpdate.length === 1 && threw === null, g.onceUpdate.length);
    const writes0 = g.natives.filter((n) => n === 'Utility.setINIFloat').length;
    g.update();
    check('the newest step wins (120)', g.camera.world === 120 && g.camera.first === 120, g.camera);
    check('one apply for the three steps', g.natives.filter((n) => n === 'Utility.setINIFloat').length - writes0 === 2);
    check('a value outside 50-140 is ignored', g.message('dbo:fov', 'set', 200) === null && g.message('dbo:fov', 'set', 'x') === null && g.onceUpdate.length === 0);

    // The rested apply: only the last step's wait applies and logs
    const waited = await g.elapse();
    check('each applied step waited 0.5 s', waited.length === 2 && waited.every((s) => s === 0.5), waited);
    globalThis.__fovLog = [];
    g.update();
    check('the slider rested: logged once', traces('the slider rested').length === 1, globalThis.__fovLog);
    check('rested at 120', g.camera.world === 120);

    // query answers at once, in tick
    g.pageJs.length = 0;
    threw = g.message('dbo:fov', 'query');
    check('query answers in tick', threw === null && g.pageJs.length === 1 && g.pageJs[0].includes('"value":120') && g.pageJs[0].includes('"launcher":90') && g.pageJs[0].includes('"camera":"platform"'), g.pageJs);

    // reset in tick: no throw, applied on the next update, the page told
    g.pageJs.length = 0; globalThis.__fovLog = [];
    threw = g.message('dbo:fov', 'reset');
    check('reset in tick does not throw or log an error', threw === null && errors().length === 0, threw && threw.message);
    g.update();
    check('reset puts the launcher value 90 back', g.camera.world === 90 && g.camera.first === 90 && g.ini['fDefaultWorldFOV:Display'] === 90, g.camera);
    check('reset tells the page', g.pageJs.length === 1 && g.pageJs[0].includes('"value":90'), g.pageJs);
    check('reset is logged as applied', traces('reset').length === 1, globalThis.__fovLog);

    // a step then reset before one frame: reset wins
    g.message('dbo:fov', 'set', 70); g.message('dbo:fov', 'reset');
    g.update();
    check('a step then reset in one frame ends at the launcher value', g.camera.world === 90, g.camera);

    // the creator open: the step is left for its menuClose
    g.raceMenuOpen = true;
    g.message('dbo:fov', 'set', 75); g.update();
    check('with the creator open the camera is not touched', g.camera.world === 90, g.camera);
    g.raceMenuOpen = false;

    // ---- the saved choice wins at startup
    globalThis.__fovLog = [];
    g = makeGame({ platform: true, ini: 90, saved: { value: 110, launcher: 90 } });
    new FovService(g.sp, g.controller);
    g.update();
    check('a saved 110 (made against launcher 90) wins at startup', traces('configured')[0].join(' ').includes('world 110') && traces('configured')[0].join(' ').includes('from saved'), globalThis.__fovLog);
    globalThis.__fovLog = [];
    g = makeGame({ platform: true, ini: 95, saved: { value: 110, launcher: 90 } });
    new FovService(g.sp, g.controller);
    g.update();
    check('a launcher changed since the save (95) wins', traces('configured')[0].join(' ').includes('world 95') && traces('configured')[0].join(' ').includes('from launcher'), globalThis.__fovLog);

    // ---- 0.3.102's DLL (SKSE route, natives return null)
    globalThis.__fovLog = [];
    g = makeGame({ platform: false });
    new FovService(g.sp, g.controller);
    g.update();
    globalThis.__fovLog = []; g.natives.length = 0;
    g.cameraState = 0; // first person
    threw = g.message('dbo:fov', 'set', 100);
    check('old DLL: a step in tick does not throw, log or call a native', threw === null && errors().length === 0 && g.natives.length === 0, { threw: threw && threw.message, natives: g.natives });
    g.update();
    check('old DLL: the step calls the SKSE setters on the update', g.natives.includes('Camera.SetWorldFieldOfView') && g.natives.includes('Camera.SetFirstPersonFieldOfView'), g.natives);
    check('old DLL: no person bounce on a slider step', g.bounces === 0, g.bounces);
    check('old DLL: no error', errors().length === 0, errors());
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* left in TMPDIR */ }
  }
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.log('FAIL harness crashed', e && e.stack || e); process.exit(1); });
