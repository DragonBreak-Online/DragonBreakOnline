// The Scholar's reading as a native panel (swf/dbo_reading, a port of skymp5-front features/reading) on the stub stage:
// words placed and taken back, the reading reported as the browser does (v2 with the candle's clock, v3 for a pick round,
// the bare order for a server judge), a wrong reading's locked words and its penalty with the wait on the verdict not
// burnt, the candle guttering, Backspace, Escape and Close the book. Each mutant must fail.
//   node tests/native-reading-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const SRC_FILE = path.resolve(__dirname, '..', 'swf/dbo_reading/scripts/frame_1/DoAction.as');
const SRC = fs.readFileSync(SRC_FILE, 'utf8');

// "the ink has run" shuffled as run, the, has, ink: the right order is 1, 3, 2, 0
const round = (extra) => Object.assign({ type: 'reading', id: 30, nonce: 'r1', title: 'The Lusty Argonian Maid', words: ['run', 'the', 'has', 'ink'],
  seconds: 30, endsInMs: 30000, locked: [], attempt: 0, judge: 'client', candleMs: 30000, penaltyMs: 8000 }, extra || {});
const at = (t, ms) => { t.st.time = 1000 + ms; t.tick(); };
const reads = (t) => t.msgs().filter((m) => m.key === 'dbo:reading');
const P = (t) => t.root.dboPanel;
const placeAll = (t, order) => { for (const i of order) P(t).pool['w' + i].onRelease(); };

const run = (src, live) => {
  let bad = 0;
  const c = (ok, what, got) => { if (!ok) bad++; if (live) check(what, ok, got); };
  const real = fs.readFileSync(SRC_FILE, 'utf8');
  fs.writeFileSync(SRC_FILE, src);
  try {
    let t = S.boot('dbo_reading'); t.st.time = 1000;
    t.push(round());
    c(/Put the words back in order, then read it out before the candle gutters/.test(P(t).hintTf.text) && P(t).pool.w3 !== undefined, 'the shuffled words are drawn, with the browser\'s words', P(t).hintTf.text);
    placeAll(t, [1, 3]);
    c(P(t).line.w1 !== undefined && P(t).line.w3 !== undefined && P(t).acts.read.disabled === true, 'placed words move to the line; Read it out waits for them all');
    P(t).line.w3.onRelease();
    c(P(t).line.w3 === undefined, 'a placed word clicked goes back');
    placeAll(t, [3, 0, 2]);
    t.press(8);
    c(P(t).line.w2 === undefined && P(t).line.w0 !== undefined, 'Backspace takes back the last word');
    placeAll(t, [2]);
    at(t, 6000);
    t.press(13);
    let r = reads(t);
    const v = r.length ? JSON.parse(r[0].args[2]) : {};
    c(r.length === 1 && r[0].args[1] === '[1,3,0,2]' && v.v === 2 && v.elapsedMs === 6000 && v.pausedMs === 0 && v.leftMs === 24000 && v.attempts === 0 && v.guttered === false,
      'Enter reads it out: the order and the candle\'s own clock (6 s burnt, 24 s left)', r.length ? r[0].args : r);
    at(t, 8000);
    t.push(round({ attempt: 1, locked: [1, 3], feedback: 'The words do not sit right.' }));
    c(/do not sit right/.test(P(t).hintTf.text) && P(t).line.w1 !== undefined && P(t).line.w3 !== undefined && P(t).line.w0 === undefined, 'a wrong reading comes back with the right words locked in place', P(t).hintTf.text);
    P(t).line.w1.onRelease && P(t).line.w1.onRelease();
    t.press(8);
    c(P(t).line.w1 !== undefined && P(t).line.w3 !== undefined, 'a locked word cannot be taken back, by a click or by Backspace');
    placeAll(t, [2, 0]);
    at(t, 10000); t.press(13);
    r = reads(t);
    const v2 = r.length > 1 ? JSON.parse(r[1].args[2]) : {};
    c(r.length === 2 && v2.pausedMs === 2000 && v2.elapsedMs === 8000 && v2.leftMs === 30000 - 8000 - 8000 && v2.attempts === 1,
      'the wait on the verdict is not burnt, and the wrong reading costs its penalty', r.length > 1 ? r[1].args : r);
    t.push(round({ attempt: 1, locked: [1, 3, 2, 0], result: 'You read the passage aloud.', resultKind: 'win' }));
    c(/read the passage aloud/.test(P(t).hintTf.text) && P(t).acts.close !== undefined, 'the verdict shows, with Close the book');
    t.press(13);
    c(t.msgs().some((m) => m.key === 'dbo:readingCancel') && t.closed(), 'Enter closes the book (as the browser does, with a cancel)');

    t = S.boot('dbo_reading'); t.st.time = 1000; t.push(round({ nonce: 'r2' }));
    placeAll(t, [1]);
    at(t, 30001);
    r = reads(t);
    c(r.length === 1 && r[0].args[1] === '[1]' && JSON.parse(r[0].args[2]).guttered === true, 'the candle guttering reads out whatever is placed', r.length ? r[0].args : r);

    t = S.boot('dbo_reading'); t.st.time = 1000; t.push(round({ nonce: 'r3', judge: undefined, candleMs: undefined, penaltyMs: undefined }));
    placeAll(t, [1, 3, 2, 0]); t.press(13);
    r = reads(t);
    c(r.length === 1 && r[0].args.length === 2, 'a server judge gets the order alone, as the browser sends it', r.length ? r[0].args : r);

    t = S.boot('dbo_reading'); t.st.time = 1000; t.push(round({ nonce: 'p1', mode: 'pick', stubs: 2, totalMs: 600000, seconds: undefined, endsInMs: undefined, candleMs: undefined, penaltyMs: undefined }));
    c(/Two stubs to spare/.test(P(t).candle.time.text), 'a pick round shows its stubs', P(t).candle.time.text);
    placeAll(t, [1, 3, 2, 0]); at(t, 5000); t.press(13);
    r = reads(t);
    const pv = r.length ? JSON.parse(r[0].args[2]) : {};
    c(r.length === 1 && pv.v === 3 && pv.mode === 'pick' && pv.elapsedMs === 5000, 'a pick round reports v3 with its elapsed time', pv);

    t = S.boot('dbo_reading'); t.st.time = 1000; t.push(round({ nonce: 'r4' }));
    t.press(27);
    c(t.msgs().some((m) => m.key === 'dbo:readingCancel' && m.args[0] === 'r4') && t.closed(), 'Escape gives up: a cancel and the panel closes');
    t = S.boot('dbo_reading'); t.st.time = 1000; t.push(round({ nonce: 'r5' }));
    vm.runInContext('_root.dboEscape()', t.ctx);
    c(t.msgs().some((m) => m.key === 'dbo:readingCancel') && t.closed(), '...through the client\'s Escape too');
  } catch (e) { bad++; if (live) check('scenarios ran', false, e.stack); }
  finally { fs.writeFileSync(SRC_FILE, real); }
  return bad;
};
check('every scenario passes on the panel as written', run(SRC, true) === 0);

const MUTANTS = [
  ['the penalty is ignored', '   return candle - burnt - num(data.attempt, 0) * penalty;', '   return candle - burnt;'],
  ['the wait on the verdict is burnt', '         paused += now - sentAt;\n', '\n'],
  ['the gutter flag is dropped', 'guttered: guttered == true || l <= 0}', 'guttered: false}'],
  ['a locked word can be taken back', '   if (sent || over() || indexIn(locked, i) >= 0)\n   {\n      return;\n   }\n   var k = indexIn(placed, i);', '   if (sent || over())\n   {\n      return;\n   }\n   var k = indexIn(placed, i);'],
];
for (const [name, a, b] of MUTANTS) {
  if (!SRC.includes(a)) { check(`mutant "${name}": its line is in the panel`, false, a); continue; }
  check(`mutant caught: ${name}`, run(SRC.replace(a, b), false) > 0);
}
T.done();
