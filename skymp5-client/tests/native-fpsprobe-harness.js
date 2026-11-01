// The frame probe (swf/dbo_fpsprobe, /testmenu fps): the 60 fps check that gates native lockpick, skinning and reading.
// Runs the swf on the stub stage (frames counted, a key's lag, the answer and the close) and its statistics block in node
// with mutants.
//   node tests/native-fpsprobe-harness.js   (from skymp5-client)
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);

{
  const t = S.boot('dbo_fpsprobe');
  check('says ready', msgs(t, 'ready').length === 1);
  t.push({ probe: 'fps', frames: 60 });
  // Frames until it answers; a key 4 ms after the 40th frame, one 50 ms frame at the 30th
  let n = 0, midway = null;
  while (!msgs(t, 'dbo:fpsProbe').length && n < 200) {
    n++;
    t.st.time += n === 30 ? 50 : 16; t.tick();
    if (n === 20) midway = !msgs(t, 'dbo:fpsProbe').length && !t.closed();
    if (n === 40) { t.st.time += 4; t.press(65); t.st.time -= 4; }
  }
  check('not done before its frames', midway === true);
  const r = (msgs(t, 'dbo:fpsProbe')[0] || { args: [{}] }).args[0];
  check('after 60 frames it answers and closes', r.frames === 60 && r.end === 'done' && t.closed(), r);
  check('...one 50 ms frame counted as over 33 and not over 50', r.over33 === 1 && r.over50 === 0 && r.maxMs === 50, r);
  check('...the key\'s lag behind the last frame', r.keys === 1 && r.keyLagMaxMs === 4, r);
}
{
  const t = S.boot('dbo_fpsprobe');
  t.push({ probe: 'fps', frames: 600 });
  t.st.time += 16; t.tick();
  t.press(27);
  const r = (msgs(t, 'dbo:fpsProbe')[0] || { args: [{}] }).args[0];
  check('Escape ends it early and still answers', r.end === 'escape' && r.frames === 1 && t.closed(), r);
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'swf', 'dbo_fpsprobe', 'scripts', 'frame_1', 'DoAction.as'), 'utf8').replace(/\r\n/g, '\n');
const a = SRC.indexOf('// FPS-STATS-BEGIN'), b = SRC.indexOf('// FPS-STATS-END');
const STATS = a >= 0 && b > a ? SRC.slice(a, b) : '';
check('the swf has the marked statistics block', !!STATS);
const scenarios = (src) => {
  const f = new Function(`${src}\nreturn fpsStats;`)();
  let bad = 0;
  const steady = f(new Array(100).fill(16.7), []);
  if (!(steady.fps > 59 && steady.fps < 61 && steady.over33 === 0)) bad++;
  const gaps = new Array(95).fill(16).concat([40, 40, 60, 60, 100]);
  const r = f(gaps, [3, 9, 1]);
  if (r.p95Ms !== 40 || r.maxMs !== 100 || r.over33 !== 5 || r.over50 !== 3 || r.keyLagMaxMs !== 9 || r.keys !== 3 || r.fps !== 54.9) bad++;
  if (f([], []).fps !== 0) bad++;
  return bad;
};
check('statistics: fps, p95, max, frames over 33 and 50 ms, key lag', STATS && scenarios(STATS) === 0);
const MUTANTS = [
  ['p95 is the median', 'Math.floor(n * 0.95)', 'Math.floor(n * 0.5)'],
  ['over 50 counts over 33', 'if (s[i] > 50)', 'if (s[i] > 33)'],
  ['fps from the first gap', 'Math.round(n * 1000 / sum * 10) / 10', 'Math.round(1000 / s[0] * 10) / 10'],
  ['key lag unsorted', 'k.sort(function(a, b) { return a - b; });', ''],
];
for (const [name, from, to] of MUTANTS) {
  if (!STATS.includes(from)) { check(`mutant "${name}": its line is in the block`, false); continue; }
  let bad = 0; try { bad = scenarios(STATS.replace(from, to)); } catch (e) { bad = 1; }
  check(`mutant "${name}" is caught (${bad} failing)`, bad > 0);
}
T.done();
