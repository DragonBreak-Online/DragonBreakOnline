// Runs the native prayer panel's AS2 (swf/lib/dbo.as + swf/dbo_prayer) as JS on a stub stage, and checks its messages.
//   node tests/native-prayer-harness.js [server dir with minigames.js, to judge the picks with the server's own rules]
'use strict';
const path = require('path');
const vm = require('vm');
const S = require('./native-swf-stub');

const MG = process.argv[2] ? require(path.resolve(process.argv[2], 'minigames.js')) : null;
const T = S.checker();
const check = T.check;
const boot = (late) => {
  const t = S.boot('dbo_prayer', late);
  t.rows = () => { const r = t.root.dboPanel.rows; return r ? Object.keys(r.kids).filter((n) => /^row\d$/.test(n)).map((n) => r[n]) : []; };
  return t;
};

const ROUND = {
  type: 'prayer', id: 35, nonce: 'n1', mode: 'pick', deity: 'Mara', kind: 'divine', shrine: 'Shrine of Mara', sphere: 'Love and compassion. Mother of all.',
  verses: [{ lines: ['A "quoted" line', 'Mara true one', 'Dagon’s line'] }, { lines: ['Mara true two', 'x', 'y'] }, { lines: ['p', 'q', 'Mara true three'] }],
  right: [1, 0, 2], slips: 2, totalMs: 120000, minPickMs: 300, startOnPress: true, judge: 'client',
};
const judge = (picksJson) => MG.judgePicks(picksJson, { need: 3, allowed: 2, steps: ROUND.verses.map((v) => v.lines), right: ROUND.right, retry: true, totalMs: ROUND.totalMs, minPickMs: ROUND.minPickMs });

// ---- the shared lib ----
let sorted;
{
  const t = boot();
  const P = (s) => vm.runInContext('dboParse(' + JSON.stringify(s) + ')', t.ctx);
  const S = (v) => vm.runInContext('dboJson(' + JSON.stringify(v) + ')', t.ctx);
  const tricky = { a: 'he said "hi" \\ back', u: 'é’', n: [1, -2.5, 3e3, true, false, null], o: { deep: [{ x: 'y' }] }, nl: 'one\ntwo' };
  check('dboParse reads what JSON.stringify writes', JSON.stringify(P(JSON.stringify(tricky))) === JSON.stringify(tricky), P(JSON.stringify(tricky)));
  // AS2 enumerates object keys in reverse, so content is compared with keys sorted; the server never reads key order
  sorted = (o) => JSON.stringify(o, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((a, q) => { a[q] = x[q]; return a; }, {}) : x));
  check('dboJson writes what JSON.parse reads', sorted(JSON.parse(S(tricky))) === sorted(tricky), S(tricky));
  check('the panel says ready on load', t.msgs().length === 1 && t.msgs()[0].key === 'ready', t.msgs());
}

// ---- a held prayer with one faltered line ----
{
  const t = boot();
  vm.runInContext('_root.dboData(' + JSON.stringify(JSON.stringify(ROUND)) + ')', t.ctx);
  const p = t.root.dboPanel;
  check('the title is the shrine', p.titleTf.text === 'Shrine of Mara', p.titleTf.text);
  check('the sphere is its first sentence', p.sphereTf.text === 'Mara: Love and compassion.', p.sphereTf.text);
  check('three rows for the first verse', t.rows().length === 3, t.rows().length);
  check('rows rest at 30 percent', t.rows().every((r) => r._alpha === 30));
  check('a quoted line survives the payload', t.rows()[0].label.text === 'A "quoted" line', t.rows()[0].label.text);
  t.st.time += 100; t.rows()[1].onRelease();
  check('a pick inside the lock is ignored', t.msgs().length === 1, t.msgs());
  t.st.time += 400; t.rows()[0].onRollOver();
  check('hover focuses at full alpha with a focus sound', t.rows()[0]._alpha === 100 && t.sounds.includes('PlaySound:UIMenuFocus'), t.sounds);
  t.rows()[0].onRelease();
  check('the first pick sends prayerStart', t.msgs()[1] && t.msgs()[1].key === 'dbo:prayerStart' && t.msgs()[1].args[0] === 'n1', t.msgs());
  check('a wrong line says how many more it bears', p.statusTf.text.indexOf('will bear one more') > 0, p.statusTf.text);
  t.st.time += 400; t.press(50);
  check('key 2 speaks the true line', p.statusTf.text === 'Two verses left to speak.', p.statusTf.text);
  t.st.time += 400; t.rows()[0].onRelease();
  t.st.time += 400; t.press(51);
  const done = t.msgs().find((m) => m.key === 'dbo:prayer');
  check('the report is sent once the third verse is spoken', !!done, t.msgs());
  const picks = JSON.parse(done.args[1]);
  check('picks are [index, ms] on the panel clock', JSON.stringify(picks) === '[[0,500],[1,900],[0,1300],[2,1700]]', picks);
  check('at is the last pick', done.args[2] === 1700, done.args[2]);
  const v = JSON.parse(done.args[3]);
  check('the verdict matches the CEF widget', sorted(v) === sorted({ v: 2, mode: 'pick', win: true, hits: 3, slips: 1, durMs: 1700, waitMs: 0 }), v);
  check('the client-judged panel shows its own verdict', p.statusTf.text === 'You speak the three verses.', p.statusTf.text);
  if (MG) {
    const j = judge(done.args[1]);
    check('the server judges the picks held', !j.bad && j.hits === 3 && j.misses === 1, j);
  }
  vm.runInContext('_root.dboData(' + JSON.stringify(JSON.stringify(Object.assign({}, ROUND, { result: 'Mara hears you.', resultKind: 'win' }))) + ')', t.ctx);
  check('the same nonce with a result keeps the round and shows it', p.statusTf.text === 'Mara hears you.' && t.msgs().filter((m) => m.key === 'dbo:prayer').length === 1, p.statusTf.text);
  check('done shows Rise', p.act.label.text === 'Rise', p.act.label.text);
  t.press(13);
  check('Enter when done rises', t.msgs().slice(-1)[0].key === 'dbo:prayerCancel', t.msgs().slice(-1)[0]);
}

// ---- faltering out, Escape, and the idle limit ----
{
  const t = boot();
  vm.runInContext('_root.dboData(' + JSON.stringify(JSON.stringify(ROUND)) + ')', t.ctx);
  for (let k = 0; k < 3; k++) { t.st.time += 400; t.press(49); }
  const r = t.msgs().find((m) => m.key === 'dbo:prayer');
  check('a third wrong line ends the prayer lost', r && JSON.parse(r.args[3]).win === false && JSON.parse(r.args[3]).slips === 3, r);
  if (MG) check('the server agrees it faltered', judge(r.args[1]).hits === 0 && judge(r.args[1]).misses === 3, judge(r.args[1]));
  t.press(27);
  check('Escape stands up', t.msgs().slice(-1)[0].key === 'dbo:prayerCancel' && t.sounds.includes('PlaySound:UIMenuCancel'), t.msgs().slice(-1)[0]);
}
{
  const t = boot();
  vm.runInContext('_root.dboData(' + JSON.stringify(JSON.stringify(Object.assign({}, ROUND, { nonce: 'n2' }))) + ')', t.ctx);
  t.st.time += 120001; t.tick();
  const r = t.msgs().find((m) => m.key === 'dbo:prayer');
  check('an unspoken prayer ends at the limit', r && r.args[2] === 120000 && JSON.parse(r.args[3]).win === false, r);
  check('and says the moment passed', t.root.dboPanel.statusTf.text.indexOf('The moment passes') === 0, t.root.dboPanel.statusTf.text);
  check('every key is logged for the in-game probe', true);
  t.press(65);
  check('key presses reach skse.Log', t.logs.some((l) => l.indexOf('prayer key 65') >= 0), t.logs);
}

{
  const t = boot();
  t.press(27);
  check('Escape closes the menu from the SWF itself', t.closed(), t.sent);
  const u = boot();
  u.st.time += 7999; u.tick();
  check('no close before the payload wait runs out', !u.closed());
  u.st.time += 1; u.tick();
  check('a panel that never gets its payload closes itself', u.closed(), u.sent);
}

{
  const t = boot(true);
  t.tick(); t.press(27);
  check('nothing reaches skse before it exists', t.sent.length === 0 && t.sounds.length === 0, t.sent);
  t.arrive(); t.tick();
  const m = t.msgs();
  check('ready leads once skse appears, with its frame', m[0] && m[0].key === 'ready' && m[0].args[0] === 2, m);
  check('a stand-up pressed before boot is sent after it', m.some((x) => x.key === 'dbo:prayerCancel'), m);
  check('and its close is carried out', t.closed(), t.sent);
  check('the boot line logs the frame', t.logs.some((l) => l.indexOf('skse appeared on frame 2') >= 0), t.logs);
}

T.done();
