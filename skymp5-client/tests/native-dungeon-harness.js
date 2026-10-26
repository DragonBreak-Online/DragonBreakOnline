// Runs the native dungeon gate (swf/dbo_dungeon) on the stub stage with the widget dungeons.js opens.
//   node tests/native-dungeon-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const DIFFS = [
  { id: 'story', label: 'Novice', blurb: 'Ordinary foes, fewer of them.' },
  { id: 'normal', label: 'Adept', blurb: 'As Bethesda placed them.' },
  { id: 'hard', label: 'Expert', blurb: 'The strongest of each kind.' },
  { id: 'nightmare', label: 'Master', blurb: 'The strongest, half again as many.' },
];
const gate = { type: 'dungeonGate', id: 60, nonce: 'g1', name: 'Bleak Falls Barrow', kind: 'Nordic ruin', party: ['Lydia', 'Faendal'], difficulties: DIFFS, minutes: 60, cooldownMinutes: 120, canClaim: true };
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const B = (t) => t.root.dboPanel.body;
const rowsOf = (t) => Object.keys(B(t).kids).filter((n) => /^d\d$/.test(n)).map((n) => B(t)[n]);
const closed = (t) => t.closed();

{
  const t = S.boot('dbo_dungeon');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1, t.msgs());
  t.push(gate);
  check('kind above the name, as the browser gate', B(t).kind.text === 'Nordic ruin' && B(t).title.text === 'Bleak Falls Barrow');
  check('the hint gives the lease and the rest in the browser\'s words', B(t).hint.text === 'Claim it for 60 minutes. Nobody else gets in while you are inside; afterwards it rests 120 minutes for you.', B(t).hint.text);
  check('the party line names who enters', B(t).party.text === 'Entering with you: Lydia, Faendal', B(t).party.text);
  const r = rowsOf(t);
  check('one row per difficulty, in the server\'s order, label and blurb', r.length === 4 && r.map((x) => x.label.text).join() === 'Novice,Adept,Expert,Master' && r[3].blurb.text === 'The strongest, half again as many.', r.map((x) => x.label.text));
  check('rows rest at 30%, numbered 1-4', r.every((x) => x._alpha === 30) && r[2].key.text === '3');
  check('a Close row: Turn back', B(t).back.label.text === 'Turn back');
  t.press(40); t.press(40);
  check('Down twice focuses the second row, full brightness, with a focus sound', r[1]._alpha === 100 && r[0]._alpha === 30 && t.sounds.filter((s) => s === 'PlaySound:UIMenuFocus').length === 2, r.map((x) => x._alpha));
  t.press(87);
  check('W goes back up', r[0]._alpha === 100);
  t.press(13);
  const c = msgs(t, 'dbo:dungeonClaim');
  check('Enter claims the focused difficulty with the nonce', c.length === 1 && c[0].args.join('|') === 'g1|story', c);
  check('and the gate closes itself, with the OK sound', closed(t) && t.sounds.includes('PlaySound:UIMenuOK'));
}

{
  const t = S.boot('dbo_dungeon');
  t.push(gate);
  t.press(51);
  check('key 3 claims Expert', msgs(t, 'dbo:dungeonClaim')[0].args[1] === 'hard');
  const u = S.boot('dbo_dungeon');
  u.push(gate);
  rowsOf(u)[3].onRollOver();
  check('the mouse focuses a row', rowsOf(u)[3]._alpha === 100);
  rowsOf(u)[3].onRelease();
  check('a click claims it', msgs(u, 'dbo:dungeonClaim')[0].args[1] === 'nightmare');
  const w = S.boot('dbo_dungeon');
  w.push(gate);
  w.root.dboPanel.body.back.onRelease();
  check('Turn back sends dbo:dungeonCancel with the nonce and closes', msgs(w, 'dbo:dungeonCancel').length === 1 && msgs(w, 'dbo:dungeonCancel')[0].args[0] === 'g1' && closed(w) && !msgs(w, 'dbo:dungeonClaim').length);
  const e = S.boot('dbo_dungeon');
  e.push(gate);
  e.press(27);
  check('Escape turns back too', msgs(e, 'dbo:dungeonCancel').length === 1 && closed(e) && e.sounds.includes('PlaySound:UIMenuCancel'));
  const tab = S.boot('dbo_dungeon');
  tab.push(gate);
  tab.press(9);
  check('Tab does nothing (STYLE: Escape alone closes)', msgs(tab, 'dbo:dungeonCancel').length === 0 && !closed(tab));
  tab.press(98);
  check('numpad 2 claims Adept', msgs(tab, 'dbo:dungeonClaim').length === 1 && msgs(tab, 'dbo:dungeonClaim')[0].args[1] === 'normal');
  check('no bare close is ever sent', [t, u, w, e, tab].every((x) => msgs(x, 'close').length === 0));
}

{
  const t = S.boot('dbo_dungeon');
  t.push(Object.assign({}, gate, { canClaim: false, reason: 'Only your party leader, Lydia, can claim Bleak Falls Barrow.', party: [] }));
  check('cannot claim: the reason instead of the hint', B(t).hint.text === 'Only your party leader, Lydia, can claim Bleak Falls Barrow.', B(t).hint.text);
  check('...and no difficulty rows', rowsOf(t).length === 0);
  check('alone: the party hint', B(t).party.text === 'You go in alone. Use /party invite to bring others.');
  t.press(49);
  check('...so a number key claims nothing', msgs(t, 'dbo:dungeonClaim').length === 0);
  t.push(Object.assign({}, gate, { canClaim: false, reason: '' }));
  check('no reason given: the browser\'s fallback', B(t).hint.text === 'You cannot enter right now.');
  t.push(Object.assign({}, gate, { nonce: 'g2' }));
  t.press(50);
  check('a new payload redraws and claims with its own nonce', msgs(t, 'dbo:dungeonClaim')[0].args.join('|') === 'g2|normal');
}

{
  const t = S.boot('dbo_dungeon', true);
  t.tick();
  t.st.time += 8000; t.tick();
  check('without skse nothing is sent', t.sent.length === 0);
  t.arrive(); t.tick();
  check('once skse appears: ready, then the self-close for the missing payload', t.msgs()[0].key === 'ready' && closed(t), t.sent);
  const u = S.boot('dbo_dungeon');
  u.push({ kind: 'x' });
  check('an unreadable payload is logged, not drawn', u.logs.some((l) => l.indexOf('unreadable payload') >= 0) && !u.root.dboPanel.body);
}

T.done();
