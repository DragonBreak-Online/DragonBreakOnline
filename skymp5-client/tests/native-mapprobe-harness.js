// Runs the map image probe (swf/dbo_mapprobe) on the stub stage with a fake MovieClipLoader: each path's answer (loaded,
// an error, nothing) is shown and all of them go to the server as dbo:mapProbe once every path has answered or timed out.
//   node tests/native-mapprobe-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const answers = { 'a.png': ['init', 952, 752], 'b.dds': ['error', 'URLNotFound'] };
function MovieClipLoader() { this.ls = []; }
MovieClipLoader.prototype.addListener = function (l) { this.ls.push(l); };
MovieClipLoader.prototype.loadClip = function (path, target) {
  const a = answers[path];
  for (const l of this.ls) l.onLoadStart && l.onLoadStart(target);
  if (!a) return;
  if (a[0] === 'init') { target._width = a[1]; target._height = a[2]; for (const l of this.ls) l.onLoadInit(target); } else for (const l of this.ls) l.onLoadError(target, a[1]);
};

const t = S.boot('dbo_mapprobe', false, { MovieClipLoader });
t.push({ paths: ['a.png', 'b.dds', 'c.png'], waitMs: 3000 });
const row = (i) => t.root.dboPanel.list['r' + i].text;
check('a loaded image shows its size', /loaded 952 x 752/.test(row(0)), row(0));
check('an error shows its code', /error: URLNotFound/.test(row(1)), row(1));
check('a path with no answer yet says it started', /started, no result yet/.test(row(2)), row(2));
check('nothing is sent while a path is still waiting', !t.msgs().some((m) => m.key === 'dbo:mapProbe'));
check('the loaded image is scaled to a thumbnail', Math.abs(t.root.dboPanel.img0.pic._xscale - (175 / 952) * 100) < 0.01);
t.st.time += 3000; t.tick();
const r = t.msgs().filter((m) => m.key === 'dbo:mapProbe');
check('after the wait every answer goes to the server once, the silent one as a timeout', r.length === 1 && r[0].args[0].map((x) => x.state).join() === 'init,error,timeout' && r[0].args[0][0].w === 952, r);
t.tick();
check('and only once', t.msgs().filter((m) => m.key === 'dbo:mapProbe').length === 1);
t.press(27);
check('Escape closes', t.closed());
T.done();
