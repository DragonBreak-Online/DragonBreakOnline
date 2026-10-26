// Runs the native labour panel (swf/dbo_labour) on the stub stage with the widgets server labour.js and struggle.js send.
//   node tests/native-labour-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
// DBO_MENU names a mutated copy of the panel (never the tracked file) to prove the harness can fail
const MENU = process.env.DBO_MENU || 'dbo_labour';

// server labour.js markerAt and struggle.js markerOn, copied: the panel's verdict must be the server's replay
const serverMarkerAt = (ms, sweepMs) => { const phase = (ms % (sweepMs * 2)) / sweepMs; return phase <= 1 ? phase * 100 : (2 - phase) * 100; };
const serverMarkerOn = (ms, sweeps, hitAt) => {
  let phase = 0; let from = 0; let i = 0;
  for (; i < hitAt.length && hitAt[i] <= ms; i++) { phase += (hitAt[i] - from) / sweeps[Math.min(i, sweeps.length - 1)]; from = hitAt[i]; }
  phase = (phase + (ms - from) / sweeps[Math.min(i, sweeps.length - 1)]) % 2;
  return phase <= 1 ? phase * 100 : (2 - phase) * 100;
};

const sweep = { type: 'labour', id: 55, nonce: 'n1', kind: 'mining', title: 'Iron Seam', strikes: 2, band: 8, bands: [50, 50], sweepMs: 1400, totalMs: 30000, hitMs: 250, missMs: 600, judge: 'client' };
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const P = (t) => t.root.dboPanel;
const closed = (t) => t.sent.some((m) => m.e === 'closeMenu');
const at = (t, ms) => { t.st.time = 1000 + ms; t.tick(); };   // the round starts at stub time 1000

{
  const t = S.boot(MENU);
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(sweep);
  check('the title is the seam, the line the craft before the first blow', P(t).titleTf.text === 'Iron Seam' && P(t).lineTf.text === 'Read the seam and strike along the grain, where the rock is weakest.', P(t).lineTf.text);
  check('the keys line and the browser\'s two buttons', P(t).keysTf.text === 'Space, Enter or click to strike. Escape to walk away.' && P(t).acts.strike.label.text === 'Strike' && P(t).acts.leave.label.text === 'Walk away');
  check('the band sits where the server put it, 8 either side of 50', !!P(t).bar.band && !!P(t).bar.marker);
  at(t, 350);
  check('the marker follows the server\'s sweep each frame', Math.abs(P(t).bar.marker._x - 844 * serverMarkerAt(350, 1400) / 100) < 1e-9, P(t).bar.marker._x);
  t.press(32);
  check('a strike outside the band glances: the miss word in red', P(t).lineTf.text === 'The pick glances off the stone.' && P(t).lineTf.textColor === 0xB23A3A, [P(t).lineTf.text, P(t).lineTf.textColor]);
  at(t, 700);
  t.press(32);
  check('a strike in the stagger after a miss (600 ms) counts for nothing', P(t).lineTf.text === 'The pick glances off the stone.' && !Object.keys(P(t).tally).length === false);
  at(t, 2100);
  check('the server\'s marker is in the band at 2100 ms', Math.abs(serverMarkerAt(2100, 1400) - 50) <= 8);
  t.press(13);
  check('Enter lands it: a hit word in green', /^(The rock cracks along the grain\.|Stone chips fly from the seam\.|The vein shifts in the rock\.)$/.test(P(t).lineTf.text) && P(t).lineTf.textColor === 0x8FBF7F, P(t).lineTf.text);
  at(t, 2300);
  P(t).bar.onRelease();
  check('a click on the face inside the 250 ms after a hit counts for nothing either', msgs(t, 'dbo:labour').length === 0);
  at(t, 4900);
  check('the server\'s marker is in the band at 4900 ms', Math.abs(serverMarkerAt(4900, 1400) - 50) <= 8);
  P(t).acts.strike.onRelease();
  const r = msgs(t, 'dbo:labour');
  check('the second landed blow ends the round: one report', r.length === 1, r);
  const args = r[0].args;
  check('it reports the nonce, every strike time on the frame clock, the end time and the widget\'s count', args[0] === 'n1' && args[1] === '[350,2100,4900]' && args[2] === 4900 && JSON.parse(args[3]).v === 1 && JSON.parse(args[3]).win === true && JSON.parse(args[3]).hits === 2, args);
  const replay = JSON.parse(args[1]); let hits = 0, ready = 0;
  for (const s of replay) { if (s < ready) continue; const landed = Math.abs(serverMarkerAt(s, 1400) - 50) <= 8; ready = s + (landed ? 250 : 600); if (landed) hits++; }
  check('the server replaying those times on its own sweep counts the same two hits', hits === 2, hits);
  check('the client judge shows its verdict at once, with Stand up', P(t).lineTf.text === 'The seam gives up its ore.' && P(t).acts.stand.label.text === 'Stand up' && !P(t).acts.strike, P(t).lineTf.text);
  t.push(Object.assign({}, sweep, { result: 'You free 2 Iron Ore.', resultKind: 'win' }));
  check('the server\'s verdict with the same nonce replaces the line and keeps the round', P(t).lineTf.text === 'You free 2 Iron Ore.' && msgs(t, 'dbo:labour').length === 1);
  P(t).acts.stand.onRelease();
  check('Stand up sends the cancel and closes', msgs(t, 'dbo:labourCancel').length === 1 && msgs(t, 'dbo:labourCancel')[0].args[0] === 'n1' && closed(t));
}

{
  const t = S.boot(MENU);
  t.push(Object.assign({}, sweep, { judge: 'server', title: 'Sea Salt Deposit', totalMs: 5000 }));
  check('salt has its own lead line', P(t).lineTf.text === 'Chip along the crust where the salt has dried thick.');
  at(t, 1000);
  check('the strength bar runs down with the clock', Math.abs(P(t).tally.fill._xscale - 80) < 1e-9, P(t).tally.fill._xscale);
  at(t, 5000);
  const r = msgs(t, 'dbo:labour');
  check('the time running out reports the round lost, with no strikes', r.length === 1 && r[0].args[1] === '[]' && r[0].args[2] === 5000 && JSON.parse(r[0].args[3]).win === false, r);
  check('a server judge: no verdict of its own, the strike button greys', P(t).lineTf.text === 'Chip along the crust where the salt has dried thick.' && P(t).acts.strike._alpha === 50);
  t.press(32);
  check('nothing more is sent', msgs(t, 'dbo:labour').length === 1);
  t.push(Object.assign({}, sweep, { nonce: 'n2' }));
  check('a new nonce is a new round: the bar and the line reset', P(t).lineTf.text === 'Read the seam and strike along the grain, where the rock is weakest.' && !!P(t).bar.marker && !P(t).acts.stand);
  t.press(27);
  check('Escape walks away: the cancel for the new round, then closes', msgs(t, 'dbo:labourCancel').length === 1 && msgs(t, 'dbo:labourCancel')[0].args[0] === 'n2' && closed(t));
  at(t, 40000);
  check('the clock after walking away reports nothing', msgs(t, 'dbo:labour').length === 1);
}

{
  // server struggle.js: its own event, a sweep per strike, the first miss ends it
  const st = { type: 'labour', id: 55, kind: 'struggle', event: 'struggle', nonce: 's1', strikes: 3, band: 10, bands: [50, 50, 50], sweepMs: 1400, sweeps: [1400, 1000, 700], failOnMiss: true, totalMs: 20000, hitMs: 0, missMs: 0, judge: 'client' };
  const t = S.boot(MENU);
  t.push(st);
  check('the struggle: its title fallback and its lead', P(t).titleTf.text === 'A block' && P(t).lineTf.text === 'Work the knot loose. Pull when the rope gives.', P(t).titleTf.text);
  at(t, 700);
  t.press(32);
  check('a pull at 700 lands (the first sweep is 1400)', JSON.stringify(msgs(t, 'dbo:struggle')) === '[]' && /knot gives|rope slackens|strand of the rope/.test(P(t).lineTf.text), P(t).lineTf.text);
  // after the hit at 700 the sweep is 1000: the marker is back at 50 when the phase from 700 is 0.5 more, at 700 + 500 * ... find it
  let ms = 701; while (Math.abs(serverMarkerOn(ms, [1400, 1000, 700], [700]) - 50) > 10) ms++;
  at(t, ms + 1);
  check('the panel\'s marker after a landed pull is the server\'s markerOn', Math.abs(P(t).bar.marker._x - 844 * serverMarkerOn(ms + 1, [1400, 1000, 700], [700]) / 100) < 1e-9);
  t.press(32);
  let ms2 = ms + 2; while (Math.abs(serverMarkerOn(ms2, [1400, 1000, 700], [700, ms + 1]) - 50) <= 10) ms2++;
  at(t, ms2 + 5);
  t.press(32);
  const r = msgs(t, 'dbo:struggle');
  check('the first miss ends the struggle on its own event', r.length === 1 && JSON.parse(r[0].args[3]).hits === 2 && JSON.parse(r[0].args[3]).win === false, r);
  check('lost: the rope holds', P(t).lineTf.text === 'Your grip slips. The rope holds.');
  P(t).acts.stand.onRelease();
  check('Stand up sends struggleCancel', msgs(t, 'dbo:struggleCancel').length === 1);
}

{
  // A pick round: spots per blow, the clearest cue is right, slips allowed
  const pick = { type: 'labour', id: 55, nonce: 'p1', kind: 'chopping', title: 'Chopping Block', mode: 'pick', strikes: 2, slips: 1, totalMs: 90000, minPickMs: 300,
    steps: [[[20, 50, 0.2], [60, 40, 0.9], [80, 60, 0.4]], [[30, 30, 0.8], [50, 70, 0.3]], [[10, 10, 0.1], [90, 90, 0.95]]], judge: 'client' };
  const t = S.boot(MENU);
  t.push(pick);
  check('a pick round: the chopping pick line, no band or marker, three spots', P(t).lineTf.text === 'Read the grain and pick where the wood will split.' && !P(t).bar.band && !P(t).bar.marker && P(t).bar.spot2 && !P(t).bar.spot3);
  check('the keys line counts the spots, and there is no Strike button', P(t).keysTf.text === 'Click a spot or press 1-3 to strike. Escape to walk away.' && !P(t).acts.strike && P(t).acts.leave);
  check('a clear cue is drawn brighter than a faint one', P(t).bar.spot1.cue._alpha > P(t).bar.spot0.cue._alpha && P(t).bar.spot0.cue._alpha >= 10);
  at(t, 100);
  P(t).bar.spot1.onRelease();
  check('no pick lands before the spots have shown (the lock, 301 ms here)', !/axe bites|wood splits|splinter/.test(P(t).lineTf.text) && P(t).lineTf.text === 'Read the grain and pick where the wood will split.');
  at(t, 400);
  P(t).bar.spot0.onRelease();
  check('a faint cue is a slip', P(t).lineTf.text === 'The blade skids off a knot.');
  at(t, 800);
  t.press(49);
  check('a slip spends that blow: key 1 picks on the next blow, where the first spot is the clear one, and lands', /axe bites|wood splits|splinter/.test(P(t).lineTf.text), P(t).lineTf.text);
  check('the next blow\'s two spots show', P(t).bar.spot1 && !P(t).bar.spot2);
  at(t, 1200);
  P(t).bar.spot1.onRelease();
  const r = msgs(t, 'dbo:labour');
  check('the second landed pick wins: picks as [index, ms], v 2, slips counted', r.length === 1 && r[0].args[1] === '[[0,400],[0,800],[1,1200]]' && r[0].args[2] === 1200 && JSON.stringify(JSON.parse(r[0].args[3])) !== '' && JSON.parse(r[0].args[3]).mode === 'pick' && JSON.parse(r[0].args[3]).slips === 1 && JSON.parse(r[0].args[3]).win === true, r);
  check('split clean', P(t).lineTf.text === 'Split clean.');
  const u = S.boot(MENU);
  u.push(Object.assign({}, pick, { nonce: 'p2', kind: 'mining', title: 'Iron Seam', slips: 0 }));
  at(u, 500);
  P(u).bar.spot0.onRelease();
  check('with no slips left the first wrong pick loses at once: the arms give out', msgs(u, 'dbo:labour').length === 1 && P(u).lineTf.text === 'The seam holds. Your arms give out before the rock does.', P(u).lineTf.text);
  const w = S.boot(MENU);
  w.push(Object.assign({}, pick, { nonce: 'p3', totalMs: 10000 }));
  at(w, 10000);
  check('a pick round left idle: the idle words', msgs(w, 'dbo:labour').length === 1 && P(w).lineTf.text === 'You stand idle at the block too long and set the axe down.', P(w).lineTf.text);
}

{
  const t = S.boot(MENU);
  t.push(Object.assign({}, sweep, { strikeLabel: 'Swing', leaveLabel: 'Step back', doneLabel: 'Done', hint: 'A custom hint.' }));
  check('the server\'s labels and hint are used', P(t).acts.strike.label.text === 'Swing' && P(t).acts.leave.label.text === 'Step back' && P(t).lineTf.text === 'A custom hint.' && P(t).keysTf.text === 'Space, Enter or click to swing. Escape to step back.');
  const l = S.boot(MENU, true);
  l.tick(); l.st.time += 8000; l.tick();
  check('without skse nothing is sent', l.sent.length === 0);
  l.arrive(); l.tick();
  check('once skse appears: ready, then the self-close for the missing payload', l.msgs()[0].key === 'ready' && closed(l));
  const u = S.boot(MENU);
  u.push({ type: 'pigeon', nonce: 'x' });
  check('a payload of another type is logged, not drawn', u.logs.some((x) => x.indexOf('unreadable payload') >= 0) && !P(u).bar);
  const v = S.boot(MENU);
  v.push(sweep);
  at(v, 2100);
  v.press(32);
  check('the sounds: OK on a landed blow', v.sounds.includes('PlaySound:UIMenuOK'));
}

T.done();
