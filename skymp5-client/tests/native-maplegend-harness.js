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
check('the swf says it is alive, its version, and locks its root (it runs inside the MapMenu)', R.dboAlive === 'yes' && R.dboVersion === 'maplegend-3' && t.ctx._lockroot === true);
check('nothing shows before the first data', R.legend._visible === false && R.bar._visible === false);
const rows = [{ id: 'seat', label: 'Seats', key: '1', count: 1, shown: true }, { id: 'fort', label: 'Forts', key: '4', count: 2, shown: false },
  { id: 'other', label: 'Everything else', key: '0', count: 7, shown: true }];
t.push({ shown: true, rows });
const B = R.legend.body;
check('the panel at the top right: THE REALM, a row a kind with its key, label and count', R.legend._visible === true && !!B && B.title.text === 'THE REALM' && B.r0.key.text === '1' && B.r0.label.text === 'Seats'
  && B.r1.count.text === '2' && R.legend._x === 1280 - 300 && Math.abs(R.legend._y - 6.7 * 7.2) < 0.01, B && [B.title.text, B.r0.label.text, B.r1.count.text]);
check('...a hidden kind greyed, the rest full', B.r1._alpha === 40 && B.r0._alpha === 100);
check('...everything else last, under its own rule, with 0', B.r2.key.text === '0' && B.r2.label.text === 'Everything else' && B.r2._y > B.r1._y);
check('the hint names T for the territory colours', /T the territory colours/.test(B.hint.text), B.hint.text);
t.push({ shown: true, rows: rows.slice(0, 2).concat([{ id: 'territories', label: 'Territory colours', key: 'T', count: 4, shown: false }], rows.slice(2)) });
const B2 = R.legend.body;
check('the colours\' row (MapRealmService adds it) drawn with the realm\'s, before everything else, greyed when off', B2.r2.key.text === 'T' && B2.r2.label.text === 'Territory colours' && B2.r2._alpha === 40 && B2.r3.label.text === 'Everything else');
t.push({ shown: true, rows });
check('the R Realm bar at the bottom', R.bar._visible === true && R.bar.key.text === 'R' && R.bar.label.text === 'Realm' && R.bar._y > 600);
t.push({ shown: false, rows });
check('R hides the panel; the bar stays', R.legend._visible === false && R.bar._visible === true);
let threw = false;
try { t.push({ shown: true }); } catch (e) { threw = true; }
check('an unreadable payload changes nothing', !threw && R.legend._visible === false && R.bar._visible === true);
// ---- who owns what, in this menu over the map (since 2 Nov) ----
check('its visible area goes to dboStageL/T/W/H, for the client to carry the map\'s positions over', R.dboStageL === 0 && R.dboStageT === 0 && R.dboStageW === 1280 && R.dboStageH === 720);
check('the owners layer lies under the panel and the bar, and starts hidden', !!R.owners && !!R.owners.layer && !!R.owners.layer.shapes && R.owners.layer._visible === false);
const osh = R.owners.layer.shapes;
const ostrokes = [];
osh.lineStyle = (w, col, a) => ostrokes.push({ w, col, a, pts: [] });
const omv = osh.moveTo, olt = osh.lineTo;
osh.moveTo = (x, y) => { omv(x, y); if (!osh._fill && ostrokes.length) ostrokes[ostrokes.length - 1].pts.push([x, y]); };
osh.lineTo = (x, y) => { olt(x, y); if (!osh._fill && ostrokes.length) ostrokes[ostrokes.length - 1].pts.push([x, y]); };
const ownersPush = (p) => require('vm').runInContext(`_root.dboOwners(${JSON.stringify(JSON.stringify(p))})`, t.ctx);
ownersPush({ fills: [{ rgb: 0xc80000, alpha: 11, pts: [0, 0, 10, 0, 10, 10] }, { rgb: 0x0000c8, alpha: 11, rects: [0, 0, 2, 1, 2, 0, 4, 1] }], lines: [{ rgb: 0x111111, alpha: 45, pts: [0, 0, 10, 10] }] });
check('dboOwners draws each polygon closed, the cells of one owner in one fill, in their colours', osh.fills.length === 2 && osh.fills[0].color === 0xc80000 && JSON.stringify(osh.fills[0].pts) === '[[0,0],[10,0],[10,10],[0,0]]'
  && osh.fills[1].color === 0x0000c8 && osh.fills[1].pts.length === 10, osh.fills);
check('...and each line as a hairline (thickness 0, thin at any zoom)', ostrokes.filter((x) => x.w === 0).length === 1 && JSON.stringify(ostrokes.filter((x) => x.w === 0)[0].pts) === '[[0,0],[10,10]]', ostrokes);
ownersPush({ fills: [], lines: [] });
check('...a new payload clears the old', osh.fills.length === 0);
let othrew = false;
try { ownersPush({ fills: 'x' }); } catch (e) { othrew = true; }
check('...an unreadable one is logged and changes nothing', !othrew && t.ctx.dboQueue.some((q) => q[0] === 'log' && /unreadable owners/.test(q[1])));
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

// ---- the traced loader the map's swfs use now (swfStep): the HUD's rule, every step timed ----
const swfLoader = (M) => {
  let bad = 0;
  const c = (ok) => { if (!ok) bad++; };
  const SWF = 'dbo_maplegend.swf';
  const no = { menu: false, clip: false, url: '', alive: false };
  let st = M.newSwfLoad();
  c(M.swfStep(st, 1, no, SWF) === '' && st.phase === 'idle');
  c(M.swfStep(st, 2, Object.assign({}, no, { menu: true }), SWF) === 'inject' && st.t.menu === 2 && JSON.stringify(st.t.inject) === '[2]');
  c(M.swfStep(st, 3, { menu: true, clip: true, url: 'Interface/map.swf', alive: false }, SWF) === '' && st.t.clip === 3 && st.t.loaded === -1);
  c(M.lastSwfStep(st.t) === 'clip');
  // Scaleform escapes the url (Nat, 04:33Z: Interface/dbo%5Fmaplegend.swf): it still names the swf
  c(M.urlNames('Interface/dbo%5Fmaplegend.swf', 'dbo_maplegend.swf') && !M.urlNames('Interface/map.swf', 'dbo_maplegend.swf') && M.urlNames('bad %E0 url/dbo_maplegend.swf', 'dbo_maplegend.swf'));
  c(M.swfStep(st, 9, { menu: true, clip: true, url: 'Interface/DBO_MapLegend.swf', alive: false }, SWF) === '' && st.t.loaded === 9 && M.lastSwfStep(st.t) === 'loaded');
  c(M.swfStep(st, 10, { menu: true, clip: true, url: 'Interface/dbo_maplegend.swf', alive: true }, SWF) === 'up' && st.t.alive === 10 && M.lastSwfStep(st.t) === 'alive');
  st.t.drawn = 11; c(M.lastSwfStep(st.t) === 'drawn');
  st.t.fit = 12; c(M.lastSwfStep(st.t) === 'fit');
  // a gap stops the count: fitted but never drawn reads as alive
  st.t.drawn = -1; c(M.lastSwfStep(st.t) === 'alive');
  // never alive: a try per MAP_SWF_ALIVE_FRAMES, MAP_SWF_TRIES in all, then off
  st = M.newSwfLoad();
  const menu = Object.assign({}, no, { menu: true });
  const out = [];
  for (let tick = 1; tick <= M.MAP_SWF_ALIVE_FRAMES * M.MAP_SWF_TRIES + 5; tick++) { const s = M.swfStep(st, tick, menu, SWF); if (s) out.push(s + '@' + tick); }
  c(out.join() === `inject@1,inject@${1 + M.MAP_SWF_ALIVE_FRAMES},inject@${1 + 2 * M.MAP_SWF_ALIVE_FRAMES},fail@${1 + 3 * M.MAP_SWF_ALIVE_FRAMES}` && st.phase === 'off' && st.tries === M.MAP_SWF_TRIES);
  c(M.lastSwfStep(st.t) === 'inject');
  // our own CustomMenu: one try, then off (opening it twice is how a panel was lost on 26 Oct)
  const one = M.newSwfLoad();
  const once = [];
  for (let tick = 1; tick <= M.MAP_SWF_ALIVE_FRAMES + 5; tick++) { const s = M.swfStep(one, tick, menu, SWF, 1); if (s) once.push(s + '@' + tick); }
  c(once.join() === `inject@1,fail@${1 + M.MAP_SWF_ALIVE_FRAMES}` && one.phase === 'off');
  const r = M.swfReport(st);
  c(r.last === 'inject' && r.phase === 'off' && r.tries === 3 && r.inject.length === 3 && r.clip === -1);
  return bad;
};
check('the map\'s swfs: nothing until the menu is open, each step timed, the last one reached named', swfLoader(live) === 0);
check('...240 frames a try and three tries, the HUD\'s numbers (nativeHud.ts)', live.MAP_SWF_ALIVE_FRAMES === 240 && live.MAP_SWF_TRIES === 3);
[
  ['loads before the menu is open', '    if (!seen.menu) return "";\n', ''],
  ['one try only', 'if (st.tries < tries) {', 'if (false) {'],
  ['a CustomMenu tried again', 'swf: string, tries = MAP_SWF_TRIES): string => {', 'swf: string, tries = MAP_SWF_TRIES): string => { tries = MAP_SWF_TRIES;'],
  ['loaded read from any url', 'if (urlNames(seen.url, swf) && t.loaded < 0)', 'if (seen.url && t.loaded < 0)'],
  ['the url read escaped', 'try { u = decodeURIComponent(u); }', 'try { }'],
  ['the last step skips a gap', 'if (!at[s]) break; last = s;', 'if (!at[s]) continue; last = s;'],
].forEach(([name, a, b], i) => {
  if (!SRC.includes(a)) { check(`mutant "${name}": its line is in mapRealm.ts`, false, a); return; }
  let bad = 0;
  try { bad = swfLoader(compile(SRC.replace(a, b), `s${i}`)); } catch (e) { bad = 1; }
  check(`mutant caught: ${name}`, bad > 0);
});
T.done();
