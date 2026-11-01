// The realm's legend drawn inside the M map (swf/dbo_maplegend, loaded by MapRealmService; Worker 1, 1 Nov): the swf on the
// stub stage, and mapRealm.ts's loader, which gives the legend to the browser for the session when the swf never comes alive.
// The mutants at the end are compiled from altered copies of mapRealm.ts and must each fail a loader check.
//   node tests/native-maplegend-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'services', 'services', 'mapRealm.ts'), 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-maplegend-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* the OS */ } });
const compile = (source, name) => {
  const d = path.join(TMP, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'mapRealm.ts'), source);
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), path.join(d, 'mapRealm.ts'), '--outDir', d, '--module', 'commonjs', '--target', 'es2019'], { stdio: 'pipe' });
  return require(path.join(d, 'mapRealm.js'));
};

// ---- the swf ----
const t = S.boot('dbo_maplegend', true);
const R = t.root;
check('the swf says it is alive, its version, and locks its root (it runs inside the MapMenu)', R.dboAlive === 'yes' && R.dboVersion === 'maplegend-1' && t.ctx._lockroot === true);
check('nothing shows before the first data', R.legend._visible === false && R.bar._visible === false);
const rows = [{ id: 'seat', label: 'Seats', key: '1', count: 1, shown: true }, { id: 'fort', label: 'Forts', key: '4', count: 2, shown: false },
  { id: 'other', label: 'Everything else', key: '0', count: 7, shown: true }];
t.push({ shown: true, rows });
const B = R.legend.body;
check('the panel at the top right: THE REALM, a row a kind with its key, label and count', R.legend._visible === true && !!B && B.title.text === 'THE REALM' && B.r0.key.text === '1' && B.r0.label.text === 'Seats'
  && B.r1.count.text === '2' && R.legend._x === 1280 - 300 && Math.abs(R.legend._y - 6.7 * 7.2) < 0.01, B && [B.title.text, B.r0.label.text, B.r1.count.text]);
check('...a hidden kind greyed, the rest full', B.r1._alpha === 40 && B.r0._alpha === 100);
check('...everything else last, under its own rule, with 0', B.r2.key.text === '0' && B.r2.label.text === 'Everything else' && B.r2._y > B.r1._y);
check('the R Realm bar at the bottom', R.bar._visible === true && R.bar.key.text === 'R' && R.bar.label.text === 'Realm' && R.bar._y > 600);
t.push({ shown: false, rows });
check('R hides the panel; the bar stays', R.legend._visible === false && R.bar._visible === true);
let threw = false;
try { t.push({ shown: true }); } catch (e) { threw = true; }
check('an unreadable payload changes nothing', !threw && R.legend._visible === false && R.bar._visible === true);
check('no character the game\'s font lacks', !/[^\x00-\x7f]/.test(fs.readFileSync(path.join(ROOT, 'swf', 'dbo_maplegend', 'scripts', 'frame_1', 'DoAction.as'), 'utf8')));

// ---- the loader ----
const loader = (M) => {
  let bad = 0;
  const c = (ok) => { if (!ok) bad++; };
  const st = M.newLegendLoad();
  c(M.legendStep(st, false) === 'inject');
  c(M.legendStep(st, true) === 'up' && M.legendStep(st, true) === '');
  M.legendReset(st);
  c(M.legendStep(st, false) === 'inject');
  let last = '';
  for (let i = 0; i < M.LEGEND_ALIVE_FRAMES; i++) last = M.legendStep(st, false);
  c(last === 'fail' && st.phase === 'off');
  M.legendReset(st);
  c(M.legendStep(st, false) === '' && st.phase === 'off');
  const j = JSON.parse(M.legendJson(true, rows));
  c(j.shown === true && j.rows.length === 3);
  return bad;
};
const live = compile(SRC, 'live');
check('the loader: inject on opening, up when alive, again after the map closes', loader(live) === 0);
check('...a second with no answer (60 frames) gives the legend to the browser for the session', live.LEGEND_ALIVE_FRAMES === 60);
[
  ['a failure retries every opening', 'if (st.phase !== "off") { st.phase = "idle"; st.frames = 0; }', '{ st.phase = "idle"; st.frames = 0; }'],
  ['never gives up', 'if (++st.frames >= LEGEND_ALIVE_FRAMES) { st.phase = "off"; return "fail"; }', '++st.frames;'],
  ['not loaded again after a close', 'export const legendReset = (st: LegendLoad): void => {\n  if (st.phase !== "off")', 'export const legendReset = (st: LegendLoad): void => {\n  if (false)'],
  ['alive is not heard', 'if (alive) { st.phase = "up"; return "up"; }', ''],
].forEach(([name, a, b], i) => {
  if (!SRC.includes(a)) { check(`mutant "${name}": its line is in mapRealm.ts`, false, a); return; }
  let bad = 0;
  try { bad = loader(compile(SRC.replace(a, b), `m${i}`)); } catch (e) { bad = 1; }
  check(`mutant caught: ${name}`, bad > 0);
});
T.done();
