// The native emote wheel (route H): nativeEmoteWheel.ts against the browser wheel's own geometry (skymp5-front
// features/emoteWheel/wheelGeometry.ts, compiled and run side by side), its pointing by the mouse and the stick, the Recent
// group, the payload, and swf/dbo_emotewheel drawing that payload on the stub stage, each segment where the client reads it
// and the tabs under it. Plus the wiring in EmoteService: native when the swf is up, the browser wheel otherwise, and only the
// controls it turned off turned on again. The mutants run the pure checks on altered copies of the compiled module and must
// each fail.
//   node tests/native-emote-wheel-harness.js [<tmp dir with nativeEmoteWheel.js and wheelGeometry.js>]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const ROOT = path.resolve(__dirname, '..');
const FRONT_GEOMETRY = path.join(ROOT, '..', 'skymp5-front', 'src', 'features', 'emoteWheel', 'wheelGeometry.ts');

const out = process.argv[2] || (() => {
  const dir = path.join(os.tmpdir(), 'dbo-nativeemotewheel');
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), path.join(ROOT, 'src', 'services', 'services', 'nativeEmoteWheel.ts'),
    FRONT_GEOMETRY, '--outDir', dir, '--module', 'commonjs', '--target', 'es2019'], { stdio: 'pipe' });
  return dir;
})();
const find = (name) => [path.join(out, name), path.join(out, 'skymp5-client', 'src', 'services', 'services', name), path.join(out, 'skymp5-front', 'src', 'features', 'emoteWheel', name)].find((p) => fs.existsSync(p));
const W_FILE = find('nativeEmoteWheel.js');
const W = require(W_FILE);
const F = require(find('wheelGeometry.js'));

// ---- a catalog shaped like EmoteService's GROUPS ----
const G = [
  { id: 'greetings', label: 'Greetings', emotes: [{ anim: 'IdleWave', label: 'Wave' }, { anim: 'IdleSalute', label: 'Salute' }, { anim: 'IdleSilentBow', label: 'Silent Bow' }] },
  { id: 'activities', label: 'Activities', emotes: Array.from({ length: 11 }, (_, i) => ({ anim: 'Act' + i, label: 'Act ' + i })).concat([{ anim: 'IdleSmokePipe', label: 'Smoke Pipe' }]) },
  { id: 'moods', label: 'Moods', emotes: [{ anim: 'IdleLaugh', label: 'Laugh' }, { anim: 'IdleCry', label: 'Cry' }] },
  { id: 'dance', label: 'Dance', emotes: [{ anim: 'Dance1', label: 'Dance' }] },
];
const at = (W, st, i, n) => { const r = (W.EMOTE_INNER + W.EMOTE_OUTER) / 2; const a = (i * 360 / n) * Math.PI / 180; st.x = r * Math.sin(a); st.y = -r * Math.cos(a); };
const labels = (g) => (g ? g.emotes.map((e) => e.label) : []);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The pure half's checks, run on the real module and on each mutant
const scenarios = (W, c) => {
  // ---- the browser wheel's geometry, the same ----
  c('the ring is the browser wheel\'s', ['HUB_R', 'EMOTE_INNER', 'EMOTE_OUTER'].every((k) => typeof F[k] === 'number' && W[k] === F[k]), ['HUB_R', 'EMOTE_INNER', 'EMOTE_OUTER'].map((k) => [k, W[k], F[k]]));
  let same = 0, total = 0, firstDiff = null;
  for (let y = -320; y <= 320; y += 4) for (let x = -320; x <= 320; x += 4) for (const e of [12, 7, 1, 16]) {
    total++;
    const a = W.pickAt(x, y, e), b = F.pickAt(x, y, e);
    if (a.ring === b.ring && a.index === b.index) same++; else firstDiff = firstDiff || [x, y, e, a, b];
  }
  c(`every point picks what the browser wheel picks (${total})`, same === total, firstDiff);
  c('angle 0 is straight up, clockwise: right is 90, down 180', W.angleOf(0, -1) === 0 && W.angleOf(1, 0) === 90 && W.angleOf(0, 1) === 180 && W.angleOf(-1, 0) === 270);
  c('one ring: the hub, then emotes from just past it to far past the edge', W.pickAt(0, -50, 8).ring === 'hub' && W.pickAt(0, -(W.HUB_R + 1), 8).ring === 'emote'
    && W.pickAt(0, -200, 8).ring === 'emote' && W.pickAt(0, -900, 8).ring === 'emote' && W.pickAt(0, -(W.HUB_R - 1), 8).ring === 'hub');

  let st = W.newWheel();
  c('a new wheel has played nothing: the catalogue as it is, no Recent', st.recent.length === 0 && W.wheelGroups(st, G) === G);
  W.moveMouse(st, 100, 0);
  c('closed, the mouse moves nothing', st.x === 0 && st.y === 0);
  W.openWheel(st, G);
  c('opened: the pointer on the hub, the first group shown, nothing pointed', st.open && st.x === 0 && st.y === 0 && st.group === 0 && W.pointedAnim(st, G) === '');
  st.last = 'IdleCry'; W.closeWheel(st); W.openWheel(st, G);
  c('...with no Recent, opened again after an emote: on that emote\'s group', st.group === 2);
  st.last = 'NotInTheCatalog'; W.openWheel(st, G);
  c('...an unknown last emote: the first group', st.group === 0);

  // ---- the mouse and the stick ----
  W.moveMouse(st, 0, -100);
  c('mouse movement moves the pointer by the gain, up is up', Math.abs(st.y + 100 * W.MOUSE_GAIN) < 1e-9 && st.x === 0, [st.x, st.y]);
  W.moveMouse(st, 50, 0);
  c('...right is right, by the same gain', Math.abs(st.x - 50 * W.MOUSE_GAIN) < 1e-9, [st.x, st.y]);
  W.moveMouse(st, -50, 0);
  W.moveMouse(st, 0, -100000);
  c('...and stops at the ring\'s edge, so a flick overshoots harmlessly', Math.abs(Math.hypot(st.x, st.y) - W.EMOTE_OUTER) < 1e-6 && W.pickOf(st, G).ring === 'emote');
  W.moveMouse(st, 'junk', undefined);
  c('...junk input moves nothing', Math.abs(Math.hypot(st.x, st.y) - W.EMOTE_OUTER) < 1e-6);
  st.x = 10; st.y = 10;
  W.pointStick(st, 0.1, 0.1);
  c('the stick inside its dead zone leaves the pointer where it was', st.x === 10 && st.y === 10);
  W.pointStick(st, 0, 1);
  c('the stick pushed up points up (its y is up, the wheel\'s down), into the ring', st.x === 0 && st.y < -W.EMOTE_INNER && W.pickOf(st, G).ring === 'emote', [st.x, st.y]);
  W.pointStick(st, 1, 0);
  c('...pushed right, right', st.x > W.EMOTE_INNER && Math.abs(st.y) < 1e-9);

  // ---- choosing, and the groups as tabs ----
  st = W.newWheel(); W.openWheel(st, G); W.stepGroup(st, G, 1);
  at(W, st, 11, 12);
  c('the pointed emote of the shown group', W.pointedAnim(st, G) === 'IdleSmokePipe');
  st.x = 0; st.y = 0;
  c('the hub points at nothing', W.pointedAnim(st, G) === '');
  c('1..9 pick from the shown group; beyond it nothing', W.numberedAnim(st, G, 1) === 'Act0' && W.numberedAnim(st, G, 9) === 'Act8' && W.numberedAnim(st, G, 0) === '' && W.numberedAnim(st, G, 13) === '');
  st.group = 3;
  c('...a group of one: 2 picks nothing', W.numberedAnim(st, G, 1) === 'Dance1' && W.numberedAnim(st, G, 2) === '');
  W.stepGroup(st, G, 1);
  c('the next group wraps to the first, at once', st.group === 0);
  W.stepGroup(st, G, -1);
  c('...the previous from the first wraps to the last', st.group === 3);
  at(W, st, 0, 1); W.stepGroup(st, G, -1);
  c('...and a step keeps the pointer where it is, now on the new group\'s emote', st.group === 2 && W.pointedAnim(st, G) === 'IdleLaugh');

  // ---- Recent: the emotes played this session, newest first ----
  st = W.newWheel();
  W.notePlayed(st, 'IdleCry'); W.notePlayed(st, 'IdleWave');
  let groups = W.wheelGroups(st, G);
  c('played emotes make a Recent group, first, newest first, then the whole catalogue', groups.length === G.length + 1 && groups[0].id === W.RECENT_ID && groups[0].label === 'Recent'
    && eq(labels(groups[0]), ['Wave', 'Cry']) && eq(groups.slice(1).map((g) => g.id), G.map((g) => g.id)), groups.map((g) => [g.id, labels(g)]));
  c('...and the last emote is the newest', st.last === 'IdleWave');
  W.notePlayed(st, 'IdleCry');
  c('playing one again moves it to the front, not in twice', eq(labels(W.wheelGroups(st, G)[0]), ['Cry', 'Wave']));
  for (let i = 0; i < 11; i++) W.notePlayed(st, 'Act' + i);
  groups = W.wheelGroups(st, G);
  c(`...at most ${W.RECENT_MAX}, the oldest dropped`, W.RECENT_MAX === 8 && eq(labels(groups[0]), ['Act 10', 'Act 9', 'Act 8', 'Act 7', 'Act 6', 'Act 5', 'Act 4', 'Act 3']), labels(groups[0]));
  W.notePlayed(st, '');
  c('...nothing played changes nothing', st.recent.length === 8 && st.last === 'Act10');
  c('the catalogue itself is untouched', G.length === 4 && G[0].id === 'greetings');
  const ghost = W.newWheel(); ghost.recent = ['Ghost', 'IdleLaugh'];
  c('an emote no longer in the catalogue is left out of Recent', eq(labels(W.wheelGroups(ghost, G)[0]), ['Laugh']));
  ghost.recent = ['Ghost'];
  c('...and Recent of only those is no Recent', W.wheelGroups(ghost, G).length === G.length);
  st = W.newWheel(); W.notePlayed(st, 'IdleCry'); W.notePlayed(st, 'Dance1');
  groups = W.wheelGroups(st, G);
  W.openWheel(st, groups);
  c('with Recent, the wheel opens on it', st.group === 0 && groups[st.group].id === W.RECENT_ID);
  c('...its numbers pick from it, the newest 1', W.numberedAnim(st, groups, 1) === 'Dance1' && W.numberedAnim(st, groups, 2) === 'IdleCry' && W.numberedAnim(st, groups, 3) === '');
  at(W, st, 1, 2);
  c('...and pointing picks from it', W.pointedAnim(st, groups) === 'IdleCry');
  W.stepGroup(st, groups, -1);
  c('...a step back from it wraps to the catalogue\'s last group', groups[st.group].id === 'dance');

  // ---- the payload ----
  st = W.newWheel(); st.last = 'IdleSalute'; W.openWheel(st, G);
  let p = W.payloadOf(st, G);
  c('the payload: the tabs, the shown group\'s emotes, the pointer, the hub\'s line, the hint', eq(p.groups, ['Greetings', 'Activities', 'Moods', 'Dance'])
    && eq(p.emotes, ['Wave', 'Salute', 'Silent Bow']) && p.group === 0 && p.hover.ring === 'hub' && p.title === 'Greetings' && p.pointer[0] === 0 && p.pointer[1] === 0
    && typeof p.hint === 'string' && /wheel/i.test(p.hint) && /Left/.test(p.hint), p);
  c('...the last emote edged where it is shown', p.last === 1);
  at(W, st, 2, 3); p = W.payloadOf(st, G);
  c('...the hovered emote names the hub', p.hover.ring === 'emote' && p.hover.index === 2 && p.title === 'Silent Bow');
  st.group = 2; st.x = 0; st.y = 0; p = W.payloadOf(st, G);
  c('...the last emote in another group: not edged; the hub names the shown group', p.last === -1 && p.title === 'Moods');
  st = W.newWheel(); W.notePlayed(st, 'IdleLaugh'); groups = W.wheelGroups(st, G); W.openWheel(st, groups); p = W.payloadOf(st, groups);
  c('...Recent is the first tab, its newest edged', p.groups[0] === 'Recent' && p.group === 0 && eq(p.emotes, ['Laugh']) && p.last === 0);
  c('the payload is JSON-safe and small', JSON.stringify(p).length < 2000);
};

scenarios(W, check);

// ---- mutants: altered copies of the compiled module ----
const W_SRC = fs.readFileSync(W_FILE, 'utf8');
const MUTANTS = [
  ['no Recent group', [['recent.length ?', 'false ?']]],
  ['Recent after the catalogue, not first', [['recent.length ? [', 'recent.length ? [...catalogue, '], ['emotes: recent }, ...catalogue]', 'emotes: recent }]']]],
  ['Recent not deduped', [['.filter((a) => a !== anim)', '']]],
  ['Recent not capped', [['.slice(0, ', '.slice(0, 99 * ']]],
  ['Recent oldest first', [['[anim, ...st.recent.filter((a) => a !== anim)]', '[...st.recent.filter((a) => a !== anim), anim]']]],
  ['Recent keeps emotes that are not in the catalogue', [['.filter((e) => !!e)', '.map((e) => e || { anim: "", label: "?" })']]],
  ['opens on the last emote\'s group even with Recent', [['? 0 : groupOf(groups, st.last)', '? groupOf(groups, st.last) : groupOf(groups, st.last)']]],
  ['the hub reaches further than the browser wheel\'s', [['Math.hypot(dx, dy) < ', 'Math.hypot(dx, dy) < 20 + ']]],
  ['a step back from the first does not wrap', [['+ groups.length) % groups.length', ') % groups.length']]],
  ['no hint in the payload', [['hint: ', 'hint0: ']]],
];
for (const [name, edits] of MUTANTS) {
  let src = W_SRC, missing = null;
  for (const [a, b] of edits) { if (!src.includes(a)) { missing = a; break; } src = src.replace(a, b); }
  if (missing) { check(`mutant "${name}": its text is in the compiled module`, false, missing); continue; }
  const file = path.join(path.dirname(W_FILE), `nativeEmoteWheel.mutant.js`);
  fs.writeFileSync(file, src);
  delete require.cache[file];
  let bad = 0;
  try { scenarios(require(file), (w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  fs.unlinkSync(file);
  check(`mutant caught: ${name}`, bad > 0);
}

// ---- swf/dbo_emotewheel on the stub stage ----
const t = S.boot('dbo_emotewheel', true);
const R = t.root;
check('the swf says it is alive, its version', R.dboAlive === 'yes' && R.dboVersion === 'emotewheel-2');
check('it locks its root first (it runs inside the HUD Menu)', t.ctx._lockroot === true);
check('hidden until shown', R.wheel._visible === false);
R.dboShow('1');
check('...shown with no data yet, it stays hidden', R.wheel._visible === false);
let st = W.newWheel(); st.last = 'IdleSmokePipe'; W.openWheel(st, G);
at(W, st, 4, 12);
t.push(W.payloadOf(st, G));
R.dboShow('1');
check('shown with data: drawn', R.wheel._visible === true);
const L = R.wheel.labels;
check('the tabs, in capitals', L.g0.text === 'GREETINGS' && L.g1.text === 'ACTIVITIES' && L.g3.text === 'DANCE' && L.g4 === undefined);
check('the shown group\'s emotes and their numbers, 1..9 only', L.e0.text === 'Act 0' && L.e11.text === 'Smoke Pipe' && L.k0.text === '1' && L.k8.text === '9' && L.k9 === undefined);
check('the hint under the tabs', !!L.hint && L.hint.text === W.SWITCH_HINT && L.hint._y > L.g0._y);
check('the hub: the shown group and the hovered emote', R.wheel.hubGroup.text === 'ACTIVITIES' && R.wheel.hubTitle.text === 'Act 4');
const fills = R.wheel.rings.fills;
check('a box for every tab, a segment for every emote, and the gold edge for the last', fills.length === 4 + 12 + 1, fills.length);
const tabs = fills.slice(0, 4);
const ofColor = (c) => fills.filter((f) => f.color === c);
const segs = fills.slice(4).filter((f) => f.color !== 0xE0BA62);
const box = (f) => { const xs = f.pts.map((q) => q[0]), ys = f.pts.map((q) => q[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
const tb = tabs.map(box);
check('the tabs sit under the ring, left to right without overlapping, centred', tb.every((b) => b.y0 > W.EMOTE_OUTER) && tb.every((b, i) => i === 0 || b.x0 > tb[i - 1].x1)
  && Math.abs(tb[0].x0 + tb[3].x1) < 1e-6, tb);
check('...each round its own label', tabs.every((f, i) => { const b = tb[i], g = L['g' + i]; return Math.abs(g._x - b.x0) < 1e-6 && Math.abs(g._x + g._width - b.x1) < 1e-6; }));
check('...the shown one lit, its label bright', tabs[1].color === 0x2F7C80 && tabs[0].color !== 0x2F7C80 && tabs[2].color !== 0x2F7C80 && L.g1.textColor !== L.g0.textColor);
// each segment's middle, read back through the client's own pickAt, is that segment: the drawing and the pointing agree
const mid = (f) => { const xs = f.pts.map((q) => q[0]), ys = f.pts.map((q) => q[1]); return [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length]; };
const segOk = segs.map((f, i) => { const [x, y] = mid(f); const k = W.pickAt(x, y, 12); return k.ring === 'emote' && k.index === i; });
check('every segment is drawn where the client reads it', segOk.length === 12 && segOk.every(Boolean), segOk);
// ...and every point of each, not only its middle: no segment reaches into its neighbour's angles, and the ring starts past the hub
const allIn = segs.map((f, i) => f.pts.every(([x, y]) => { const k = W.pickAt(x * 0.999, y * 0.999, 12); const r = Math.hypot(x, y); return k.index === i && r >= W.EMOTE_INNER - 1e-6 && r <= W.EMOTE_OUTER + 1e-6; }));
check('...each wholly inside its own angles, from the ring\'s inner edge to its outer', allIn.every(Boolean), allIn);
const span = (f, i, n) => { const rel = f.pts.map(([x, y]) => ((W.angleOf(x, y) - i * 360 / n + 540) % 360) - 180); return [Math.min(...rel), Math.max(...rel)]; };
const wide = segs.map((f, i) => { const [lo, hi] = span(f, i, 12); return Math.abs(lo + hi) < 1e-6 && hi - lo > 30 - 2; });
check('...each centred on its index and a whole step wide but for the gap', wide.every(Boolean), wide);
check('the hovered emote lit, its neighbour not', segs[4].color === 0x5FB3B3 && segs[5].color !== 0x5FB3B3);
check('the gold edge sits on the last emote\'s segment, at the rim', ofColor(0xE0BA62).length === 1 && (() => { const [x, y] = mid(ofColor(0xE0BA62)[0]); const k = W.pickAt(x, y, 12); return k.ring === 'emote' && k.index === 11 && Math.hypot(x, y) > W.EMOTE_OUTER - 10; })());
check('the hovered emote\'s label white, its number gold', L.e4.textColor === 0xFFFFFF && L.k4.textColor === 0xE0BA62 && L.e5.textColor !== 0xFFFFFF);
check('the pointer drawn at the pointer', R.wheel.pointer._x === Math.round(st.x) && R.wheel.pointer._y === Math.round(st.y));
check('the wheel sits in the middle of the visible stage at 78% of its height', R.wheel._x === 640 && R.wheel._y === 360 && Math.abs(R.wheel._xscale - 100 * 0.78 * 720 / 640) < 1e-9);
const labelsBefore = R.wheel.labels;
at(W, st, 7, 12); t.push(W.payloadOf(st, G));
check('a move redraws the rings, keeps the labels', R.wheel.labels === labelsBefore && R.wheel.rings.fills.slice(4)[7].color === 0x5FB3B3 && R.wheel.hubTitle.text === 'Act 7');
W.stepGroup(st, G, 1); st.x = 0; st.y = 0; t.push(W.payloadOf(st, G));
check('another group makes the labels again, its tab lit', R.wheel.labels !== labelsBefore && R.wheel.labels.e0.text === 'Laugh' && R.wheel.labels.e2 === undefined
  && R.wheel.rings.fills.length === 4 + 2 && R.wheel.rings.fills[2].color === 0x2F7C80 && R.wheel.rings.fills[1].color !== 0x2F7C80);
st = W.newWheel(); W.notePlayed(st, 'IdleCry'); const RG = W.wheelGroups(st, G); W.openWheel(st, RG); t.push(W.payloadOf(st, RG));
check('Recent drawn as the first tab, lit, with its emotes', R.wheel.labels.g0.text === 'RECENT' && R.wheel.labels.g4.text === 'DANCE' && R.wheel.rings.fills[0].color === 0x2F7C80
  && R.wheel.labels.e0.text === 'Cry' && R.wheel.rings.fills.length === 5 + 1 + 1);
let threw = false;
try { t.push({ groups: ['x'] }); } catch (e) { threw = true; }
check('an unreadable payload changes nothing', !threw && R.wheel.labels.e0.text === 'Cry' && t.ctx.dboQueue.some((q) => q[0] === "log" && /unreadable/.test(q[1])));
R.dboShow('0');
check('hidden again', R.wheel._visible === false);

// ---- the wiring ----
const src = (p2) => fs.readFileSync(path.join(ROOT, p2), 'utf8').replace(/\r\n/g, '\n');
const es = src('src/services/services/emoteService.ts');
const ns = src('src/services/services/nativeEmoteWheelService.ts');
const fn = (name) => { const i = es.indexOf(`  private ${name}(`); return i < 0 ? '' : es.slice(i, es.indexOf('\n  }\n', i)); };
check('the service is started', /new NativeEmoteWheelService\(sp, controller\),/.test(src('src/index.ts')));
check('the swf is loaded into a clip of the HUD Menu, with the browser wheel kept until it is alive', /createEmptyMovieClip", \["dboEmoteWheel", "9994"\]/.test(ns) && /const SWF = "dbo_emotewheel\.swf";/.test(ns) && /ready\(\): boolean \{ return this\.load\.phase === "up"; \}/.test(ns));
check('the wheel opens native when the swf is up, else the browser wheel', /if \(this\.nativeReady\(\)\) \{\n      this\.openNative\(\);\n      return;\n    \}\n    openFormMenu\(/.test(fn('openMenu')));
check('closing takes down whichever is up', /if \(this\.nativeOpen\) this\.closeNative\(\); else closeFormMenu\(this\.sp, WIDGET_ID\);/.test(fn('closeMenu')));
const open = fn('openNative'), close = fn('closeNative');
check('only controls that were on are turned off, read on the next frame', /controller\.once\("update"/.test(open) && /G\.disablePlayerControls\(false, off\.fighting, false, off\.looking, false, off\.menu, off\.activate, off\.journal, 0\);/.test(open)
  && /G\.isLookingControlsEnabled\(\)/.test(open) && /G\.isMenuControlsEnabled\(\)/.test(open) && /G\.isJournalControlsEnabled\(\)/.test(open));
check('...and exactly those turned on again at close, once', /if \(!off\) return;\n      try \{ this\.sp\.Game\.enablePlayerControls\(false, off\.fighting, false, off\.looking, false, off\.menu, off\.activate, off\.journal, 0\); \}/.test(close) && /this\.ctlOff = null;\n      if \(!off\) return;/.test(close));
check('...a close before the open\'s frame turns nothing off', /if \(gen !== this\.nativeGen \|\| !this\.nativeOpen\) return;/.test(open) && /this\.nativeGen\+\+;/.test(close));
check('the mouse and the right stick point it only while it is up', /on\("mouseMove", \(e\) => \{ if \(this\.nativeOpen\) moveMouse\(this\.native, e\.inputX, e\.inputY\); \}\)/.test(es) && /on\("thumbstickEvent", \(e\) => \{ if \(this\.nativeOpen && !e\.isLeft\) pointStick/.test(es));
check('each frame it is pointed and drawn; the cursor watch is the browser wheel\'s only', /if \(this\.nativeOpen\) this\.tickNative\(\); else this\.watchWheel\(\);/.test(es));
check('a game menu opened over it, or the HUD losing it, takes it down', /if \(this\.gameMenuOpen\(\)\) this\.closeMenu\("a game menu"\);/.test(fn('tickNative')) && /!this\.nativeReady\(\)/.test(fn('tickNative')) && /try \{ return this\.nativeWheel\(\)\.ready\(\); \} catch \{ return false; \}/.test(es));
check('a front reload does not forget the native wheel is up', /browserWindowLoaded", \(\) => \{ if \(!this\.nativeOpen\) this\.menuOpen = false; \}/.test(es));
check('its presses are taken before the rest, and Esc and the wheel key fall through to their handling', /if \(this\.nativeOpen && e\.isDown && this\.onNativeButton\(e\)\) return;/.test(es) && !/Escape/.test(fn('onNativeButton')) && !/menuKey/.test(fn('onNativeButton')));
const nb = fn('onNativeButton');
check('click and A pick, right click and B close, the wheel / arrows / shoulders / d-pad turn groups, 1..9 pick', /e\.code === 0\) pick\(pointedAnim/.test(nb) && /e\.code === 1\) this\.closeMenu/.test(nb) && /GamepadButton\.A\) pick\(pointedAnim/.test(nb)
  && /GamepadButton\.B\) this\.closeMenu/.test(nb) && /e\.code === 8\) stepGroup\(this\.native, this\.wheelGroups\(\), -1\)/.test(nb) && /LeftArrow\) stepGroup/.test(nb) && /RightShoulder \|\| e\.code === GamepadButton\.DPadRight\) stepGroup\(this\.native, this\.wheelGroups\(\), 1\)/.test(nb)
  && /numberedAnim\(this\.native, this\.wheelGroups\(\), e\.code - DxScanCode\.N1 \+ 1\)/.test(nb));
check('the held key let go plays the pointed emote, or closes on none', /if \(this\.nativeOpen\) \{\n      const anim = pointedAnim\(this\.native, this\.wheelGroups\(\)\);\n      if \(anim\) this\.chooseFromWheel\(anim\); else this\.closeMenu/.test(fn('onWheelKeyUp')));
check('both wheels choose through one path, which remembers it (edged, and first in Recent) after the catalog check', /if \(key === events\.play\) \{\n      this\.chooseFromWheel\(/.test(es) && /not in the catalog`\);\n      return;\n    \}\n    \/\/ Edged on the wheel next time, and first in its Recent group\n    notePlayed\(this\.native, anim\);/.test(fn('chooseFromWheel')) && /this\.playEmote\(anim\);/.test(fn('chooseFromWheel')));

check('both wheels show Recent: the native one and the browser one are given the same groups', /private wheelGroups\(\): WheelGroup\[\] \{\n    return wheelGroups\(this\.native, GROUPS\);/.test(es) && /openFormMenu\(this\.sp, this\.emoteWidgetSetter, \{ GROUPS: this\.wheelGroups\(\), events, WIDGET_ID \}/.test(es) && /openWheel\(this\.native, this\.wheelGroups\(\)\)/.test(es));

T.done();
