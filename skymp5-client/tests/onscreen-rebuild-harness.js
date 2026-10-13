// Scripted test for onScreenRebuildDue (view/onScreenRebuild.ts): a remote copy's 3D is rebuilt for its face tints once per
// 3D load, not on every return to the screen (the face-morph crash SkyrimSE+04328E9). Run from skymp5-client:
//
//   node tests/onscreen-rebuild-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP onscreen-rebuild (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

(async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-onscreen-')), 'b.js');
  await esbuild.build({ entryPoints: [path.resolve(__dirname, '../src/view/onScreenRebuild.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent' });
  const { onScreenRebuildDue } = require(out);
  const MIN = 5000;
  const fresh = () => ({ isOnScreen: false, lastMs: 0, doneThisLoad: false });

  // Walk the head on and off screen every 6 s for a minute with the 3D loaded throughout
  let s = fresh(); let n = 0;
  for (let i = 0; i < 20; i++) if (onScreenRebuildDue(s, i % 2 === 0, true, false, 10000 + i * 3000, MIN)) n++;
  check('one rebuild for one 3D load, however often the head comes back on screen', n === 1, n);

  // The old rule (interval only) rebuilt on most of those returns: the case the fix guards against
  let old = 0; let on = false; let last = 0;
  for (let i = 0; i < 20; i++) { const t = 10000 + i * 3000; const v = i % 2 === 0; if (v !== on) { on = v; if (v && t - last >= MIN) { last = t; old++; } } }
  check('...where the interval alone allowed several', old > 3, old);

  // An unload makes it due again on the next return
  s = fresh();
  onScreenRebuildDue(s, true, true, false, 10000, MIN);
  onScreenRebuildDue(s, false, true, false, 12000, MIN);
  onScreenRebuildDue(s, false, false, false, 14000, MIN);
  check('a copy whose 3D went away is due again when it returns', onScreenRebuildDue(s, true, true, false, 20000, MIN) === true);

  // Still within the interval after a reload: waits, then goes out on the next entry past it
  s = fresh();
  onScreenRebuildDue(s, true, true, false, 10000, MIN);
  onScreenRebuildDue(s, false, false, false, 11000, MIN);
  check('a reload inside the interval waits', onScreenRebuildDue(s, true, true, false, 12000, MIN) === false);
  onScreenRebuildDue(s, false, true, false, 13000, MIN);
  check('...and goes out on the next entry past it', onScreenRebuildDue(s, true, true, false, 16000, MIN) === true);

  // A beast copy never rebuilds, and being blocked does not use up the load
  s = fresh();
  check('a beast copy is never rebuilt', onScreenRebuildDue(s, true, true, true, 10000, MIN) === false && !s.doneThisLoad);
  onScreenRebuildDue(s, false, true, false, 11000, MIN);
  check('...and is rebuilt once it is no longer a beast', onScreenRebuildDue(s, true, true, false, 17000, MIN) === true);

  // Leaving the screen never rebuilds, and an unchanged state does nothing
  s = fresh();
  check('staying off screen does nothing', onScreenRebuildDue(s, false, true, false, 10000, MIN) === false);
  onScreenRebuildDue(s, true, true, false, 10000, MIN);
  s.doneThisLoad = false;
  check('staying on screen does not fire again', onScreenRebuildDue(s, true, true, false, 30000, MIN) === false);

  // driftConfig faceRebuild (the quick undo): "entry" ignores doneThisLoad, so the walk above rebuilds as the old rule did
  s = fresh(); let ne = 0;
  for (let i = 0; i < 20; i++) if (onScreenRebuildDue(s, i % 2 === 0, true, false, 10000 + i * 3000, MIN, true)) ne++;
  check('faceRebuild "entry" rebuilds on every return past the interval, as before 0.3.96', ne === old, { entry: ne, old });
  s = fresh(); let nl = 0;
  for (let i = 0; i < 20; i++) if (onScreenRebuildDue(s, i % 2 === 0, true, false, 10000 + i * 3000, MIN, false)) nl++;
  check('faceRebuild "load" (perEntry false) is the once-per-load rule', nl === 1, nl);
  s = fresh();
  check('"entry" still never rebuilds a beast copy', onScreenRebuildDue(s, true, true, true, 10000, MIN, true) === false);
  s = fresh(); onScreenRebuildDue(s, true, true, false, 10000, MIN, true); onScreenRebuildDue(s, false, true, false, 11000, MIN, true);
  check('"entry" still keeps the interval', onScreenRebuildDue(s, true, true, false, 12000, MIN, true) === false);

  // The switch itself (sync/driftConfig.ts): default "load", the packet sets "entry" or "load", anything else is ignored
  const dout = path.join(path.dirname(out), 'd.js');
  await esbuild.build({ entryPoints: [path.resolve(__dirname, '../src/sync/driftConfig.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: dout, logLevel: 'silent' });
  const { driftConfig, applyDriftConfig, driftConfigEcho } = require(dout);
  check('faceRebuild defaults to "load"', driftConfig.faceRebuild === 'load', driftConfig.faceRebuild);
  applyDriftConfig({ faceRebuild: 'entry' });
  check('an npcDriftConfig with faceRebuild "entry" sets it, and the echo reports it live', driftConfig.faceRebuild === 'entry' && driftConfigEcho().faceRebuild === 'entry');
  applyDriftConfig({ faceRebuild: 'always' });
  check('an unknown value is ignored', driftConfig.faceRebuild === 'entry');
  applyDriftConfig({ faceRebuild: 'load' });
  check('"load" sets it back', driftConfig.faceRebuild === 'load');
  const fv = fs.readFileSync(path.resolve(__dirname, '../src/view/formView.ts'), 'utf8');
  check('formView passes faceRebuild "entry" as perEntry and counts doneThisLoad only under "load"',
    /onScreenRebuildDue\(this\.rebuild, isOnScreen, loaded, this\.isBeastCopy\(model\), Date\.now\(\), FormView\.niNodeUpdateMinIntervalMs, driftConfig\.faceRebuild === "entry"\)/.test(fv)
    && /this\.rebuild\.doneThisLoad && driftConfig\.faceRebuild !== "entry"\) faceSync\.skip\(this\.refrId, "doneThisLoad"\)/.test(fv));

  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL', e); process.exit(1); });
