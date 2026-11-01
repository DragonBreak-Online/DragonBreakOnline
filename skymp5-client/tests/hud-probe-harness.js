// Drives the HUD overlay probe (src/services/services/hudProbe.ts, /testmenu hud) against a fake HUD Menu: a movie tree the
// Ui calls reach by path, where loadMovie runs swf/dbo_hudprobe's real frame script some frames later. T1 (our clip drawn
// in the HUD), T2 (our swf loaded into it: alive, its own frame clock, a call in, a mod event out, keys and the mouse) and
// the endings (done, the HUD closing, the swf missing).
//   ./node_modules/typescript/bin/tsc src/services/services/hudProbe.ts --outDir <tmp> --module commonjs --target es2019
//   node tests/hud-probe-harness.js <tmp>/hudProbe.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const H = require(path.resolve(process.argv[2] || path.join(os.tmpdir(), 'claude-nate-hudprobe', 'hudProbe.js')));
const SWF = fs.readFileSync(path.resolve(__dirname, '..', 'swf/dbo_hudprobe/scripts/frame_1/DoAction.as'), 'utf8');

const clip = (name, parent) => {
  const c = { _name: name, _parent: parent, kids: {}, fills: [], _width: 0, _height: 0 };
  c.createEmptyMovieClip = (n) => { const k = clip(String(n), c); c[n] = k; c.kids[n] = k; return k; };
  c.removeMovieClip = () => { delete parent[name]; delete parent.kids[name]; };
  c.beginFill = (color, alpha) => { c._fill = { color, alpha, pts: [] }; };
  c.moveTo = (x, y) => { if (c._fill) c._fill.pts.push([x, y]); };
  c.lineTo = (x, y) => { if (c._fill) c._fill.pts.push([x, y]); };
  c.endFill = () => {
    if (!c._fill) return;
    c.fills.push(c._fill);
    const xs = c._fill.pts.map((p) => p[0]), ys = c._fill.pts.map((p) => p[1]);
    c._width = Math.max(...xs) - Math.min(...xs); c._height = Math.max(...ys) - Math.min(...ys); c._fill = null;
  };
  return c;
};

// o: loadDelay (frames before a loaded swf runs), swf (false: no such file), skseAt (the frame skse appears; 0 at once),
// clockRuns (false: the loaded swf's onEnterFrame never fires), noPing (the call into it is lost)
const hud = (o) => {
  o = Object.assign({ loadDelay: 3, swf: true, skseAt: 0, clockRuns: true }, o || {});
  const root = clip('_root', null);
  const probe = H.newProbe();
  const keys = [], mice = [];
  const skse = { SendModEvent: (e, s) => H.notePong(probe, e, s) };
  const env = { open: true, frame: 0, pending: null, code: 0, calls: [] };
  const g = { skse: o.skseAt ? undefined : skse };
  const ctx = vm.createContext({ _root: root, _global: g, Stage: { width: 1280, height: 720 }, String, Number,
    Key: { addListener: (l) => keys.push(l), getCode: () => env.code }, Mouse: { addListener: (l) => mice.push(l) } });
  const at = (p) => p.split('.').slice(1).reduce((c, k) => (c == null ? undefined : c[k]), root);
  const split = (target) => { const i = target.lastIndexOf('.'); return [at(target.slice(0, i)), target.slice(i + 1)]; };
  const call = (target, args) => { env.calls.push(target); const [obj, m] = split(target); if (obj && typeof obj[m] === 'function') obj[m](...args); };
  const ui = {
    isMenuOpen: (m) => m === 'HUD Menu' && env.open,
    invokeStringA: (m, t, a) => call(t, a || []),
    invokeFloatA: (m, t, a) => call(t, a || []),
    invokeString: (m, t, a) => {
      env.calls.push(t);
      const [obj, meth] = split(t);
      if (meth === 'loadMovie') { if (obj) env.pending = { host: obj, url: a, at: env.frame + o.loadDelay }; return; }
      if (obj && typeof obj[meth] === 'function') obj[meth](a);
    },
    getString: (m, t) => { const [obj, k] = split(t); const v = obj == null ? undefined : obj[k]; return v === undefined || typeof v === 'function' ? '' : String(v); },
    getFloat: (m, t) => { const [obj, k] = split(t); const v = obj == null ? undefined : Number(obj[k]); return Number.isFinite(v) ? v : 0; },
  };
  const frame = () => {
    env.frame++;
    if (o.skseAt && env.frame === o.skseAt) g.skse = skse;
    const p = env.pending;
    // loadMovie: the clip keeps its place and name, and the file's frame script runs with the clip as this
    if (p && env.frame >= p.at) {
      env.pending = null;
      if (o.swf && p.url === 'dbo_hudprobe.swf') { ctx.__host = p.host; vm.runInContext('(function () {\n' + SWF + '\n}).call(__host);', ctx); if (o.noPing) delete p.host.dboPing; }
    }
    const host = root.dboHudHost;
    if (o.clockRuns && host && host.onEnterFrame) host.onEnterFrame();
    H.probeStep(probe, ui);
  };
  const run = (n) => { for (let i = 0; i < n && !probe.done; i++) frame(); };
  const press = (code) => { env.code = code; keys.forEach((l) => l.onKeyDown()); };
  const move = () => mice.forEach((l) => l.onMouseMove());
  const click = () => mice.forEach((l) => l.onMouseDown());
  return { root, probe, env, run, frame, press, move, click, results: () => H.probeResults(probe) };
};

{
  const h = hud();
  h.run(2);
  check('T1: a clip made in the HUD Menu and a second to load into', h.root.dboHudProbe && h.root.dboHudHost && h.probe.t1.created === 'dboHudProbe' && h.probe.t2.host === 'dboHudHost');
  check('...the aqua bar drawn through invokeFloatA', h.root.dboHudProbe.fills.length === 1 && h.root.dboHudProbe.fills[0].color === 0x8fd3d0 && h.root.dboHudProbe.fills[0].alpha === 70);
  check('...and our swf asked for by name, by loadMovie on the second clip', h.env.calls.includes('_root.dboHudHost.loadMovie'));
  h.run(1);
  check('T1 reads the bar\'s size back', h.probe.t1.width === 200 && h.probe.t1.height === 40, h.probe.t1);
  h.run(3);
  check('T2: the swf alive on the frame it loaded, its version, skse there', h.probe.t2.loadedAtTick === 5 && h.probe.t2.version === 'hudprobe-1' && h.probe.t2.skse === 'yes', h.probe.t2);
  check('...its amber bar on its own clip, nothing written onto the HUD\'s root', h.root.dboHudHost.fills.length === 1 && h.root.dboHudHost.fills[0].color === 0xD0A050 && !Object.keys(h.root).some((k) => /^dbo(?!HudProbe$|HudHost$)/.test(k)), Object.keys(h.root));
  h.run(10);
  check('...called once, five frames after, and its SendModEvent heard', h.root.dboHudHost.dboPinged === 'ping-1' && h.probe.pongs === 1);
  for (let i = 0; i < 4; i++) h.press(17 + i);
  for (let i = 0; i < 7; i++) h.move();
  h.click();
  h.run(H.HOLD_TICKS - 17);
  check('not finished before the hold is up', !h.probe.done && h.root.dboHudProbe !== undefined);
  h.run(1);
  check('at the hold: both clips removed', h.root.dboHudProbe === undefined && h.root.dboHudHost === undefined);
  h.run(5);
  const r = h.results();
  check('the end two frames later: done, both gone', r.end === 'done' && r.afterRemove === '' && r.t2.afterRemove === '', r);
  check('T1 as the first probe reported it: still there at the hold, its width', r.created === 'dboHudProbe' && r.width === 200 && r.stillThere === 'dboHudProbe' && r.widthLater === 200, r);
  check('T2: its clock ran with the frames, the call in, the event out', r.t2.framesPerTick === 1 && r.t2.pinged === true && r.t2.pongs === 1, r.t2);
  check('...the keys with the last one, the mouse moves and the click, the stage', r.t2.keys === 4 && r.t2.lastKey === 20 && r.t2.mouseMoves === 7 && r.t2.clicks === 1 && r.t2.stage === '1280x720' && r.t2.skseLater === 'yes', r.t2);
  check('another mod\'s events are not pongs', (() => { const p = H.newProbe(); H.notePong(p, 'dboHudProbe', 'other'); H.notePong(p, 'SomeMod', 'pong'); return p.pongs === 0; })());
}

{
  const h = hud({ swf: false });
  h.run(H.HOLD_TICKS + 5);
  const r = h.results();
  check('no swf: T2 never loaded, T1 still reported, and the probe still ends', r.t2.loadedAtTick === 'never' && r.width === 200 && r.end === 'done' && r.t2.pinged === undefined, r);
  check('...and nothing is called on the empty clip', !h.env.calls.includes('_root.dboHudHost.dboPing'));
}

{
  const h = hud({ loadDelay: 400 });
  h.run(H.LOAD_TICKS);
  check('a swf not there by the load wait reads never...', h.probe.t2.loadedAtTick === 'never');
  h.run(H.HOLD_TICKS);
  check('...and one that comes later still has its frame recorded', h.results().t2.loadedAtTick === 402 && h.results().t2.pinged === true, h.results().t2);
  const s = hud({ loadDelay: H.HOLD_TICKS });
  s.run(H.HOLD_TICKS + 5);
  check('one not there by the hold stays never, with nothing read from it', s.results().t2.loadedAtTick === 'never' && s.results().t2.keys === undefined, s.results().t2);
}

{
  const h = hud({ skseAt: 50 });
  h.run(H.HOLD_TICKS + 5);
  const r = h.results();
  check('skse arriving late: said at load, and from which frame at the hold', r.t2.skse === 'no' && /^from frame \d+$/.test(r.t2.skseLater) && r.t2.pongs === 0 && r.t2.pinged === true, r.t2);
}

{
  const np = hud({ noPing: true });
  np.run(H.HOLD_TICKS + 5);
  check('a call that never reaches the swf reads not pinged, and no pong', np.results().t2.pinged === false && np.results().t2.pongs === 0, np.results().t2);
  const h = hud({ clockRuns: false });
  h.run(H.HOLD_TICKS + 5);
  check('a swf whose frame clock never runs reads 0 frames a tick', h.results().t2.framesPerTick === 0, h.results().t2);
}

{
  const h = hud();
  h.run(40);
  h.env.open = false;
  h.run(1);
  check('the HUD closing ends it, said so', h.probe.done === 'the HUD menu closed' && h.results().end === 'the HUD menu closed');
  const w = hud();
  w.env.open = false;
  w.run(30);
  check('armed while the HUD is not up, it waits rather than ends', w.probe.done === '' && w.probe.tick === 0);
  w.env.open = true;
  w.run(1);
  check('...and starts when it is', w.probe.tick === 1 && w.root.dboHudProbe !== undefined);
}

T.done();
