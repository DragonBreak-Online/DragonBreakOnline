// Runs the native rite (swf/dbo_rite) on the stub stage with supernatural.js's showRite payloads: the timed rite judged by
// the client, the old server-judged one, and the pick rite. The verdicts are checked against the browser's own judge
// (skymp5-front utils/minigameJudge), compiled from its TypeScript on the fly.
//   node tests/native-rite-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

// Node's own type stripping (22.13+), else the TypeScript compiler; either way the browser's file, not a copy
const judgeSrc = fs.readFileSync(path.resolve(__dirname, '../../skymp5-front/src/utils/minigameJudge.ts'), 'utf8');
const strip = require('module').stripTypeScriptTypes;
const judgeJs = strip ? strip(judgeSrc) : require('typescript').transpileModule(judgeSrc, { compilerOptions: { target: 99 } }).outputText;
const J = {};
for (const m of judgeJs.matchAll(/^export const (\w+)/gm)) J[m[1]] = new Function(judgeJs.replace(/^export /gm, '') + `\nreturn ${m[1]};`)();

const timed = (o) => Object.assign({ type: 'rite', id: 39, nonce: 'r1', title: 'The Rite of the Moon', flavor: 'Hircine watches.', deadly: true, round: 1, rounds: 3, need: 2, hits: 0, misses: 0,
  period: 1600, zone: [0.5, 0.2], startsIn: 1000, result: '', judge: 'client', rnonce: 'a1', graceMs: 100, limitMs: 7000 }, o || {});
const picked = (o) => Object.assign({ type: 'rite', id: 39, nonce: 'p1', title: 'The Blood Fever', flavor: 'The heart slows.', deadly: false, round: 1, rounds: 3, need: 2, hits: 0, misses: 0,
  result: '', judge: 'client', rnonce: 'b1', mode: 'pick', spots: [[20, 40, 0.3], [50, 60, 0.9], [80, 30, 0.5]], cue: 'pulse', minPickMs: 300, limitMs: 9000 }, o || {});
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const B = (t) => t.root.dboPanel.body;
const closed = (t) => t.sent.some((m) => m.e === 'closeMenu');
const pipStates = (t) => Object.keys(B(t).pips.kids).map((n) => B(t).pips[n].state).join(',');
// steps the stage clock by ms, one frame at a time (30 fps)
const run = (t, ms) => { for (let left = ms; left > 0; left -= 33) { t.st.time += Math.min(33, left); t.tick(); } };

{
  const t = S.boot('dbo_rite');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1, t.msgs());
  t.push(timed());
  check('title, flavour and three pending pips', B(t).title.text === 'The Rite of the Moon' && B(t).flavor.text === 'Hircine watches.' && pipStates(t) === ',,');
  check('the browser\'s hint, with the deadly line', B(t).hint.text === 'Round 1 of 3: strike 2 true blows. Space or Enter. Failure here can be the end of this life.', B(t).hint.text);
  check('the zone sits where the payload puts it', B(t).bar.zone && B(t).bar.marker._x === 0);
  t.press(32);
  check('a press in the lead-in is not a strike and does not use the round', msgs(t, 'dbo:riteStrike').length === 0 && !B(t).strike.disabled);
  run(t, 1000 + 400);
  const at = B(t).bar.marker._x / (680 - 56);
  check('the marker sweeps on the panel\'s clock (0.5 at a quarter period)', Math.abs(at - 0.5) < 0.05, at);
  t.press(32);
  const s = msgs(t, 'dbo:riteStrike')[0];
  const press = s && s.args[4];
  check('Space strikes: [nonce, round, rnonce, verdict, pressMs, atMs, shown]', s && s.args.length === 7 && s.args[0] === 'r1' && s.args[1] === 1 && s.args[2] === 'a1' && Number.isInteger(press) && s.args[5] >= 1400, s);
  check('the verdict is the browser judge\'s for the same press', s && s.args[3] === (J.riteHit(1600, 0.5, 0.2, press, 100) ? 'hit' : 'miss') && s.args[3] === 'hit', s && s.args);
  check('shown is the marker drawn on that frame, to 4 places', s && s.args[6] === Math.round(J.riteMarkerAt(1600, press) * 10000) / 10000 && String(s.args[6]).length <= 6, s && [s.args[6], J.riteMarkerAt(1600, press)]);
  check('the hit counts at once: True., a filled pip, Strike greyed', /^True\. Round 1/.test(B(t).hint.text) && pipStates(t) === 'hit,,' && B(t).strike.disabled === true, [B(t).hint.text, pipStates(t)]);
  t.press(32);
  run(t, 8000);
  check('one strike a round, and no timeout after it', msgs(t, 'dbo:riteStrike').length === 1 && msgs(t, 'dbo:riteTimeout').length === 0);
  t.push(timed({ round: 2, rnonce: 'a2', hits: 1, startsIn: 0, result: 'True.' }));
  check('the next round restarts: Strike live again, the server\'s tally', !B(t).strike.disabled && pipStates(t) === 'hit,,' && /^True\. Round 2 of 3/.test(B(t).hint.text), B(t).hint.text);
  run(t, 1600);
  t.press(13);
  const m = msgs(t, 'dbo:riteStrike')[1];
  check('Enter strikes too; at the period\'s end the marker is home, off the mark: a miss', m && m.args[3] === 'miss' && m.args[3] === (J.riteHit(1600, 0.5, 0.2, m.args[4], 100) ? 'hit' : 'miss'), m && m.args);
  check('...shown as Missed (off the mark). with a red pip', /^Missed \(off the mark\)\./.test(B(t).hint.text) && pipStates(t) === 'hit,miss,' && B(t).bar.marker._alpha === 60, [B(t).hint.text, pipStates(t)]);
  t.push(timed({ round: 3, rnonce: 'a3', hits: 1, misses: 1, startsIn: 0 }));
  run(t, 7100);
  const to = msgs(t, 'dbo:riteTimeout');
  check('no press within limitMs: dbo:riteTimeout [nonce, round, rnonce, atMs]', to.length === 1 && to[0].args.slice(0, 3).join('|') === 'r1|3|a3' && to[0].args[3] >= 7000, to);
  check('...shown as Missed (too late).', /^Missed \(too late\)\./.test(B(t).hint.text));
  t.push(timed({ round: 3, rnonce: 'a3', hits: 1, misses: 2, startsIn: 0, result: 'The rite fails.' }));
  check('the same round again redraws in place without restarting it', B(t).strike.disabled === true && msgs(t, 'dbo:riteTimeout').length === 1);
}

{
  // every press of a period against the browser judge, through the panel itself
  const t = S.boot('dbo_rite');
  let agree = 0, total = 0, hits = 0;
  for (let k = 0; k < 40; k++) {
    t.push(timed({ round: 1 + k, rnonce: 'k' + k, startsIn: 0, zone: [0.3 + (k % 5) * 0.1, 0.15] }));
    run(t, 33 + k * 37);
    t.press(32);
    const s = msgs(t, 'dbo:riteStrike').pop();
    total++;
    if (s.args[3] === (J.riteHit(1600, 0.3 + (k % 5) * 0.1, 0.15, s.args[4], 100) ? 'hit' : 'miss')) agree++;
    if (s.args[3] === 'hit') hits++;
  }
  const r = S.boot('dbo_rite');
  r.push(timed({ period: 1700, startsIn: 0 }));
  run(r, 1000);
  r.press(32);
  const odd = msgs(r, 'dbo:riteStrike')[0].args;
  check('a period that does not divide evenly: shown is rounded to 4 places', odd[6] === Math.round(J.riteMarkerAt(1700, odd[4]) * 10000) / 10000 && odd[6] !== J.riteMarkerAt(1700, odd[4]), odd);
  check('40 presses across the sweep: every verdict matches the browser judge, some hit and some miss', agree === total && hits > 0 && hits < total, { agree, total, hits });
}

{
  const t = S.boot('dbo_rite');
  t.push(timed({ judge: 'server', rnonce: undefined, graceMs: undefined, limitMs: undefined, deadly: false, startsIn: 0 }));
  run(t, 200);
  t.press(32);
  const s = msgs(t, 'dbo:riteStrike');
  check('a server-judged rite sends the old bare strike [nonce]', s.length === 1 && s[0].args.length === 1 && s[0].args[0] === 'r1', s);
  check('...and claims no verdict of its own', !/^True|^Missed/.test(B(t).hint.text) && B(t).hint.text === 'Round 1 of 3: strike 2 true blows. Space or Enter.', B(t).hint.text);
  run(t, 9000);
  check('...nor a timeout: the server keeps the time', msgs(t, 'dbo:riteTimeout').length === 0);
}

{
  const t = S.boot('dbo_rite');
  t.push(timed({ startsIn: 0 }));
  B(t).yieldAsk.onRelease();
  check('Yield asks first, naming what a deadly rite costs', /^Yield the rite\? It counts as lost, and failure here can be the end of this life\.$/.test((B(t).ask || {}).text) && msgs(t, 'dbo:riteClose').length === 0);
  run(t, 300);
  t.press(32);
  check('...no strike while it asks', msgs(t, 'dbo:riteStrike').length === 0);
  B(t).goOn.onRelease();
  check('Go on returns to the rite', !B(t).ask && B(t).strike && !B(t).strike.disabled);
  t.press(27);
  check('Escape asks too', !!B(t).ask);
  t.press(27);
  check('Escape again backs out of the question', !B(t).ask && !closed(t));
  t.press(9);
  B(t).yield.onRelease();
  check('Yield sends dbo:riteClose [nonce] and closes (no bare close)', msgs(t, 'dbo:riteClose').length === 1 && msgs(t, 'dbo:riteClose')[0].args[0] === 'r1' && closed(t) && msgs(t, 'close').length === 0);
  const u = S.boot('dbo_rite');
  u.push(timed({ deadly: false, startsIn: 0 }));
  u.press(9);
  check('a rite that is not deadly asks without the death line', u.root.dboPanel.body.ask.text === 'Yield the rite? It counts as lost.');
  u.press(40); u.press(40); u.press(13);
  check('Down to Go on and Enter goes on', !u.root.dboPanel.body.ask && msgs(u, 'dbo:riteClose').length === 0, Object.keys(u.root.dboPanel.body.kids));
  u.press(40); u.press(40); u.press(13);
  check('Down to Yield and Enter asks', !!u.root.dboPanel.body.ask);
}

{
  const t = S.boot('dbo_rite');
  t.push(picked());
  const st = B(t).strip;
  check('a pick rite: three marks, numbered, no bar and no Strike', st && st.s0 && st.s2 && !st.s3 && !B(t).bar && !B(t).strike && st.s1.key.text === '2');
  check('marks placed by percent of the strip', Math.abs(st.s1._x - (0.5 * 624 - 32)) < 0.01 && Math.abs(st.s1._y - (0.6 * 200 - 32)) < 0.01, [st.s1._x, st.s1._y]);
  check('a mark\'s strength is its cue\'s brightness (pow 1.5), never under 10%', st.s1.cue._alpha === Math.round(Math.pow(0.9, 1.5) * 100) && st.s0.cue._alpha === Math.round(Math.pow(0.3, 1.5) * 100));
  check('the pulse hint, in the browser\'s words', B(t).hint.text === 'Round 1 of 3: two true marks. Choose the strongest beat of the slowing heart. Click a mark or press 1-3.', B(t).hint.text);
  t.st.time += 200; t.press(50);
  check('no pick before minPickMs + 1', msgs(t, 'dbo:riteStrike').length === 0);
  t.st.time += 200; t.press(50);
  const s = msgs(t, 'dbo:riteStrike');
  check('key 2 picks: [nonce, round, rnonce, pick, index, atMs]', s.length === 1 && s[0].args.slice(0, 5).join('|') === 'p1|1|b1|pick|1' && s[0].args[5] === 400, s);
  check('...the clearest mark, as the browser judge says: True.', J.pickRight(picked().spots) === 1 && /^True\./.test(B(t).hint.text) && pipStates(t) === 'hit,,');
  t.press(49);
  check('one pick a round', msgs(t, 'dbo:riteStrike').length === 1);
  t.push(picked({ round: 2, rnonce: 'b2', hits: 1, cue: 'trail', spots: [[30, 50, 0.95], [70, 50, 0.4]] }));
  check('the trail hint for a hunt', /Choose the freshest track of the prey\. Click a mark or press 1-2\.$/.test(B(t).hint.text), B(t).hint.text);
  t.st.time += 500;
  B(t).strip.s1.onRelease();
  check('a click on the fainter track: Missed (the wrong mark).', msgs(t, 'dbo:riteStrike')[1].args[4] === 1 && /^Missed \(the wrong mark\)\./.test(B(t).hint.text) && pipStates(t) === 'hit,miss,');
  t.push(picked({ judge: 'server' }));
  check('a pick payload from a server-judged rite falls back to the timed bar, as the browser', !!B(t).bar && !B(t).strip);
}

{
  const t = S.boot('dbo_rite', true);
  t.tick();
  t.st.time += 8000; t.tick();
  check('without skse nothing is sent', t.sent.length === 0);
  t.arrive(); t.tick();
  check('once skse appears: ready, then the self-close for the missing payload', t.msgs()[0].key === 'ready' && closed(t), t.sent);
  const u = S.boot('dbo_rite');
  u.push({ nonce: 'x' });
  check('an unreadable payload is logged, not drawn', u.logs.some((l) => l.indexOf('unreadable payload') >= 0) && !u.root.dboPanel.body);
}

T.done();
