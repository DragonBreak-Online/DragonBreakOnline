// The native emote wheel (route H): nativeEmoteWheel.ts against the browser wheel's own geometry and dwell rule (skymp5-front
// features/emoteWheel/wheelGeometry.ts, compiled and run side by side), its pointing by the mouse and the stick, the payload,
// and swf/dbo_emotewheel drawing that payload on the stub stage, each segment where the client reads it. Plus the wiring in
// EmoteService: native when the swf is up, the browser wheel otherwise, and only the controls it turned off turned on again.
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
const W = require(find('nativeEmoteWheel.js'));
const F = require(find('wheelGeometry.js'));

// ---- the browser wheel's geometry, the same ----
check('the rings are the browser wheel\'s', ['HUB_R', 'GROUP_INNER', 'GROUP_OUTER', 'EMOTE_INNER', 'EMOTE_OUTER', 'GROUP_DWELL_MS'].every((k) => W[k] === F[k]), ['HUB_R', 'GROUP_INNER', 'GROUP_OUTER', 'EMOTE_INNER', 'EMOTE_OUTER', 'GROUP_DWELL_MS'].map((k) => [k, W[k], F[k]]));
let same = 0, total = 0, firstDiff = null;
for (let y = -320; y <= 320; y += 4) for (let x = -320; x <= 320; x += 4) for (const [g, e] of [[8, 12], [5, 7], [1, 1], [9, 16]]) {
  total++;
  const a = W.pickAt(x, y, g, e), b = F.pickAt(x, y, g, e);
  if (a.ring === b.ring && a.index === b.index) same++; else firstDiff = firstDiff || [x, y, g, e, a, b];
}
check(`every point picks what the browser wheel picks (${total})`, same === total, firstDiff);
check('angle 0 is straight up, clockwise: right is 90, down 180', W.angleOf(0, -1) === 0 && W.angleOf(1, 0) === 90 && W.angleOf(0, 1) === 180 && W.angleOf(-1, 0) === 270);
check('the rings by radius: hub, group, emote, and far past the edge still the emote ring', W.pickAt(0, -50, 8, 8).ring === 'hub' && W.pickAt(0, -120, 8, 8).ring === 'group' && W.pickAt(0, -200, 8, 8).ring === 'emote' && W.pickAt(0, -900, 8, 8).ring === 'emote');

// ---- a catalog shaped like EmoteService's GROUPS ----
const G = [
  { id: 'greetings', label: 'Greetings', emotes: [{ anim: 'IdleWave', label: 'Wave' }, { anim: 'IdleSalute', label: 'Salute' }, { anim: 'IdleSilentBow', label: 'Silent Bow' }] },
  { id: 'activities', label: 'Activities', emotes: Array.from({ length: 11 }, (_, i) => ({ anim: 'Act' + i, label: 'Act ' + i })).concat([{ anim: 'IdleSmokePipe', label: 'Smoke Pipe' }]) },
  { id: 'moods', label: 'Moods', emotes: [{ anim: 'IdleLaugh', label: 'Laugh' }, { anim: 'IdleCry', label: 'Cry' }] },
  { id: 'dance', label: 'Dance', emotes: [{ anim: 'Dance1', label: 'Dance' }] },
];
const at = (st, ring, i, n) => { const r = ring === 'group' ? (W.GROUP_INNER + W.GROUP_OUTER) / 2 : (W.EMOTE_INNER + W.EMOTE_OUTER) / 2; const a = (i * 360 / n) * Math.PI / 180; st.x = r * Math.sin(a); st.y = -r * Math.cos(a); };

let st = W.newWheel();
W.moveMouse(st, 100, 0);
check('closed, the mouse moves nothing', st.x === 0 && st.y === 0);
W.openWheel(st, G);
check('opened: the pointer on the hub, the first group shown, nothing pointed', st.open && st.x === 0 && st.y === 0 && st.group === 0 && W.pointedAnim(st, G) === '');
st.last = 'IdleCry'; W.closeWheel(st); W.openWheel(st, G);
check('...opened again after an emote: on that emote\'s group', st.group === 2);
st.last = 'NotInTheCatalog'; W.openWheel(st, G);
check('...an unknown last emote: the first group', st.group === 0);

// ---- the mouse and the stick ----
W.moveMouse(st, 0, -100);
check('mouse movement moves the pointer by the gain, up is up', Math.abs(st.y + 100 * W.MOUSE_GAIN) < 1e-9 && st.x === 0, [st.x, st.y]);
W.moveMouse(st, 50, 0);
check('...right is right, by the same gain', Math.abs(st.x - 50 * W.MOUSE_GAIN) < 1e-9, [st.x, st.y]);
W.moveMouse(st, -50, 0);
W.moveMouse(st, 0, -100000);
check('...and stops at the outer ring\'s edge, so a flick overshoots harmlessly', Math.abs(Math.hypot(st.x, st.y) - W.EMOTE_OUTER) < 1e-6 && W.pickOf(st, G).ring === 'emote');
W.moveMouse(st, 'junk', undefined);
check('...junk input moves nothing', Math.abs(Math.hypot(st.x, st.y) - W.EMOTE_OUTER) < 1e-6);
st.x = 10; st.y = 10;
W.pointStick(st, 0.1, 0.1);
check('the stick inside its dead zone leaves the pointer where it was', st.x === 10 && st.y === 10);
W.pointStick(st, 0, 1);
check('the stick pushed up points up (its y is up, the wheel\'s down), into the emote ring', st.x === 0 && st.y < -W.EMOTE_INNER && W.pickOf(st, G).ring === 'emote', [st.x, st.y]);
W.pointStick(st, 1, 0);
check('...pushed right, right', st.x > W.EMOTE_INNER && Math.abs(st.y) < 1e-9);

// ---- the group dwell, the browser wheel's rule ----
st = W.newWheel(); W.openWheel(st, G);
at(st, 'group', 2, G.length);
W.tickWheel(st, G, 1000); W.tickWheel(st, G, 1000 + W.GROUP_DWELL_MS - 1);
check('a group rested on under the dwell does not take the outer ring', st.group === 0);
W.tickWheel(st, G, 1000 + W.GROUP_DWELL_MS);
check('...at the dwell it does', st.group === 2);
st = W.newWheel(); W.openWheel(st, G);
let t0 = 5000;
for (const g of [1, 2, 3]) { at(st, 'group', g, G.length); W.tickWheel(st, G, t0); t0 += 60; }
at(st, 'emote', 0, G[0].emotes.length); W.tickWheel(st, G, t0);
check('a flick across the groups to an emote keeps the shown group', st.group === 0 && W.pointedAnim(st, G) === 'IdleWave');
// side by side with the front's dwellStep over a pointed path
let fd = { candidate: -1, since: 0 }, fg = 0, agree = true;
st = W.newWheel(); W.openWheel(st, G);
const path1 = [[-1, 0], [1, 10], [1, 150], [1, 260], [2, 300], [-1, 320], [3, 330], [3, 600], [0, 610], [0, 809], [0, 811]];
for (const [g, now] of path1) {
  if (g < 0) { st.x = 0; st.y = 0; } else at(st, 'group', g, G.length);
  W.tickWheel(st, G, now);
  const r = F.dwellStep(fd, g, now, fg); fd = r.dwell; fg = r.group;
  if (fg !== st.group) agree = false;
}
check('the dwell agrees with the front\'s dwellStep along a path', agree && st.group === 0, [st.group, fg]);

// ---- choosing ----
st = W.newWheel(); W.openWheel(st, G); W.stepGroup(st, G, 1);
at(st, 'emote', 11, 12);
check('the pointed emote of the shown group', W.pointedAnim(st, G) === 'IdleSmokePipe');
st.x = 0; st.y = 0;
check('the hub points at nothing', W.pointedAnim(st, G) === '');
at(st, 'group', 0, G.length);
check('a group points at no emote', W.pointedAnim(st, G) === '');
check('1..9 pick from the shown group; beyond it nothing', W.numberedAnim(st, G, 1) === 'Act0' && W.numberedAnim(st, G, 9) === 'Act8' && W.numberedAnim(st, G, 0) === '' && W.numberedAnim(st, G, 13) === '');
st.group = 3;
check('...a group of one: 2 picks nothing', W.numberedAnim(st, G, 1) === 'Dance1' && W.numberedAnim(st, G, 2) === '');
W.stepGroup(st, G, 1);
check('the next group wraps to the first', st.group === 0);
W.stepGroup(st, G, -1);
check('...the previous from the first wraps to the last', st.group === 3);
st.dwell = { candidate: 2, since: 1 }; W.stepGroup(st, G, -1);
check('...and a step forgets a dwell in progress', st.group === 2 && st.dwell.candidate === -1);

// ---- the payload ----
st = W.newWheel(); st.last = 'IdleSalute'; W.openWheel(st, G);
let p = W.payloadOf(st, G);
check('the payload: the group labels, the shown group\'s emotes, the pointer, the hub\'s line', JSON.stringify(p.groups) === JSON.stringify(['Greetings', 'Activities', 'Moods', 'Dance'])
  && JSON.stringify(p.emotes) === JSON.stringify(['Wave', 'Salute', 'Silent Bow']) && p.group === 0 && p.hover.ring === 'hub' && p.title === 'Greetings' && p.pointer[0] === 0 && p.pointer[1] === 0, p);
check('...the last emote edged where it is shown', p.last === 1);
at(st, 'emote', 2, 3); p = W.payloadOf(st, G);
check('...the hovered emote names the hub', p.hover.ring === 'emote' && p.hover.index === 2 && p.title === 'Silent Bow');
at(st, 'group', 1, 4); p = W.payloadOf(st, G);
check('...a hovered group names it', p.title === 'Activities' && p.emotes[0] === 'Wave');
st.group = 2; p = W.payloadOf(st, G);
check('...the last emote in another group: not edged', p.last === -1);
check('the payload is JSON-safe and small', JSON.stringify(p).length < 2000);

// ---- swf/dbo_emotewheel on the stub stage ----
const t = S.boot('dbo_emotewheel', true);
const R = t.root;
check('the swf says it is alive, its version', R.dboAlive === 'yes' && R.dboVersion === 'emotewheel-1');
check('it locks its root first (it runs inside the HUD Menu)', t.ctx._lockroot === true);
check('hidden until shown', R.wheel._visible === false);
R.dboShow('1');
check('...shown with no data yet, it stays hidden', R.wheel._visible === false);
st = W.newWheel(); st.last = 'IdleSmokePipe'; W.openWheel(st, G);
at(st, 'emote', 4, 12);
t.push(W.payloadOf(st, G));
R.dboShow('1');
check('shown with data: drawn', R.wheel._visible === true);
const L = R.wheel.labels;
check('the group labels, in capitals', L.g0.text === 'GREETINGS' && L.g1.text === 'ACTIVITIES' && L.g3.text === 'DANCE');
check('the shown group\'s emotes and their numbers, 1..9 only', L.e0.text === 'Act 0' && L.e11.text === 'Smoke Pipe' && L.k0.text === '1' && L.k8.text === '9' && L.k9 === undefined);
check('the hub: the shown group and the hovered emote', R.wheel.hubGroup.text === 'ACTIVITIES' && R.wheel.hubTitle.text === 'Act 4');
const fills = R.wheel.rings.fills;
check('a segment for every group and emote, and the gold edge for the last', fills.length === 4 + 12 + 1, fills.length);
// each segment's middle, read back through the client's own pickAt, is that segment: the drawing and the pointing agree
const mid = (f) => { const xs = f.pts.map((q) => q[0]), ys = f.pts.map((q) => q[1]); return [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length]; };
const segOk = [];
for (let i = 0; i < 4; i++) { const [x, y] = mid(fills[i]); const k = W.pickAt(x, y, 4, 12); segOk.push(k.ring === 'group' && k.index === i); }
for (let i = 0; i < 12; i++) { const [x, y] = mid(fills[4 + i + (i > 11 ? 1 : 0)]); const k = W.pickAt(x, y, 4, 12); segOk.push(k.ring === 'emote' && k.index === i); }
check('every segment is drawn where the client reads it', segOk.every(Boolean), segOk);
// ...and every point of each, not only its middle: no segment reaches into its neighbour's angles
const inside = (f, ring, i, n) => f.pts.every(([x, y]) => { const k = W.pickAt(x * 0.999, y * 0.999, 4, n); return k.index === i && (ring === 'group' ? Math.hypot(x, y) <= W.GROUP_OUTER + 1e-6 : Math.hypot(x, y) >= W.EMOTE_INNER - 1e-6); });
const allIn = [];
for (let i = 0; i < 4; i++) allIn.push(inside(fills[i], 'group', i, 4));
for (let i = 0; i < 12; i++) allIn.push(inside(fills[4 + i], 'emote', i, 12));
check('...each wholly inside its own angles and ring', allIn.every(Boolean), allIn);
// ...and filling them, bar the gap: centred on its index, a whole step wide
const span = (f, i, n) => { const rel = f.pts.map(([x, y]) => ((W.angleOf(x, y) - i * 360 / n + 540) % 360) - 180); return [Math.min(...rel), Math.max(...rel)]; };
const wide2 = [];
for (let i = 0; i < 4; i++) { const [lo, hi] = span(fills[i], i, 4); wide2.push(Math.abs(lo + hi) < 1e-6 && hi - lo > 90 - 2); }
for (let i = 0; i < 12; i++) { const [lo, hi] = span(fills[4 + i], i, 12); wide2.push(Math.abs(lo + hi) < 1e-6 && hi - lo > 30 - 2); }
check('...each centred on its index and a whole step wide but for the gap', wide2.every(Boolean), wide2);
const ofColor = (c) => fills.filter((f) => f.color === c);
check('the shown group lit, the hovered emote lit', fills[1].color === 0x2F7C80 && fills[4 + 4].color === 0x5FB3B3 && fills[4 + 5].color !== 0x5FB3B3);
check('the gold edge sits on the last emote\'s segment, at the rim', ofColor(0xE0BA62).length === 1 && (() => { const [x, y] = mid(ofColor(0xE0BA62)[0]); const k = W.pickAt(x, y, 4, 12); return k.ring === 'emote' && k.index === 11 && Math.hypot(x, y) > 290; })());
check('the hovered emote\'s label white, its number gold', L.e4.textColor === 0xFFFFFF && L.k4.textColor === 0xE0BA62 && L.e5.textColor !== 0xFFFFFF);
check('the pointer drawn at the pointer', R.wheel.pointer._x === Math.round(st.x) && R.wheel.pointer._y === Math.round(st.y));
check('the wheel sits in the middle of the visible stage at 78% of its height', R.wheel._x === 640 && R.wheel._y === 360 && Math.abs(R.wheel._xscale - 100 * 0.78 * 720 / 640) < 1e-9);
const labelsBefore = R.wheel.labels;
at(st, 'emote', 7, 12); t.push(W.payloadOf(st, G));
check('a move redraws the rings, keeps the labels', R.wheel.labels === labelsBefore && R.wheel.rings.fills[4 + 7].color === 0x5FB3B3 && R.wheel.hubTitle.text === 'Act 7');
W.stepGroup(st, G, 1); st.x = 0; st.y = 0; t.push(W.payloadOf(st, G));
check('another group makes the labels again', R.wheel.labels !== labelsBefore && R.wheel.labels.e0.text === 'Laugh' && R.wheel.labels.e2 === undefined && R.wheel.rings.fills.length === 4 + 2);
let threw = false;
try { t.push({ groups: ['x'] }); } catch (e) { threw = true; }
check('an unreadable payload changes nothing', !threw && R.wheel.labels.e0.text === 'Laugh' && t.ctx.dboQueue.some((q) => q[0] === "log" && /unreadable/.test(q[1])));
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
  && /GamepadButton\.B\) this\.closeMenu/.test(nb) && /e\.code === 8\) stepGroup\(this\.native, GROUPS, -1\)/.test(nb) && /LeftArrow\) stepGroup/.test(nb) && /RightShoulder \|\| e\.code === GamepadButton\.DPadRight\) stepGroup\(this\.native, GROUPS, 1\)/.test(nb)
  && /numberedAnim\(this\.native, GROUPS, e\.code - DxScanCode\.N1 \+ 1\)/.test(nb));
check('the held key let go plays the pointed emote, or closes on none', /if \(this\.nativeOpen\) \{\n      const anim = pointedAnim\(this\.native, GROUPS\);\n      if \(anim\) this\.chooseFromWheel\(anim\); else this\.closeMenu/.test(fn('onWheelKeyUp')));
check('both wheels choose through one path, which remembers the last emote after the catalog check', /if \(key === events\.play\) \{\n      this\.chooseFromWheel\(/.test(es) && /not in the catalog`\);\n      return;\n    \}\n    \/\/ Edged on the wheel next time, which opens on its group\n    this\.native\.last = anim;/.test(fn('chooseFromWheel')) && /this\.playEmote\(anim\);/.test(fn('chooseFromWheel')));

T.done();
