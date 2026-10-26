// Runs the native notice board (swf/dbo_board) on the stub stage with the widget bountyBoardService publishes.
//   node tests/native-board-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const ev = { post: 'bountyBoard:post', remove: 'bountyBoard:remove', close: 'bountyBoard:close' };
const board = {
  boardName: 'Bruma', costGold: 30, gold: 120, maxTextLen: 600, maxNotes: 40, expiryDays: 7, events: ev,
  tabs: [{ id: 'hold', label: 'Hold Notices', cost: 0, canPost: false }, { id: 'shop', label: 'Shop Ads', cost: 30, canPost: true }, { id: 'citizen', label: 'Citizen Notices', cost: 30, canPost: true }],
  notes: [
    { id: 1, tab: 'hold', author: 'Jarl Narri', text: 'Curfew at dusk.\nBy order of the Jarl.', ageHours: 5, canRemove: false },
    { id: 2, tab: 'shop', author: 'Olaf', text: 'Iron ingots, cheap.', ageHours: 30, canRemove: true },
    { id: 3, tab: 'shop', author: 'Gemma', text: 'Mead for sale at the Jerall View.', ageHours: 100, canRemove: false },
  ],
};
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const P = (t) => t.root.dboPanel;
const rowsOf = (t) => Object.keys(P(t).list.kids).filter((n) => /^r\d$/.test(n)).map((n) => P(t).list[n]);
const closed = (t) => t.closed();

{
  const t = S.boot('dbo_board');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1, t.msgs());
  t.push(board);
  const cb = P(t).foot.close; cb.onRollOver(); cb.onRollOut(); cb.onRollOver();
  check('a button the mouse leaves and comes back to brightens again (dbo-controls)', cb._alpha === 100, cb._alpha);
  check('the title names the board', P(t).head.title.text === 'Bruma Notice Board', P(t).head.title.text);
  check('tabs carry their counts, the first open and bright', P(t).head.tab0.label.text === 'Hold Notices  1' && P(t).head.tab1.label.text === 'Shop Ads  2' && P(t).head.tab0._alpha === 100 && P(t).head.tab1._alpha === 30);
  const r = rowsOf(t);
  check('hold tab lists its one notice, first line only, with author and age', r.length === 1 && r[0].label.text === 'Curfew at dusk.' && r[0].sub.text === 'Jarl Narri  -  Pinned today', r.map((x) => [x.label.text, x.sub.text]));
  check('on the hold tab Write a notice is greyed: officials only', P(t).foot.write.disabled === true && P(t).foot.write.label.text === 'Officials only');
  P(t).foot.write.onRelease();
  check('a greyed Write sends nothing', msgs(t, 'native:handoff').length === 0);
  P(t).head.tab1.onRelease();
  check('a tab click switches the list', rowsOf(t).length === 2 && P(t).head.tab1._alpha === 100, rowsOf(t).length);
  check('ages read yesterday and days ago', rowsOf(t)[0].sub.text === 'Olaf  -  Pinned yesterday' && rowsOf(t)[1].sub.text === 'Gemma  -  Pinned 4 days ago');
  check('the hint gives the cost and the gold carried', /costs 30 gold.*fades after 7 days.*carry 120 gold/.test(P(t).foot.hint.text), P(t).foot.hint.text);
  P(t).foot.write.onRelease();
  const h = msgs(t, 'native:handoff');
  check('Write a notice hands off to the browser composer for this tab', h.length === 1 && h[0].args.join('|') === 'bountyBoard|compose:shop', h);
  check('and leaves the native board open for the router to close', !closed(t));
  t.press(9);
  check('Tab does nothing, it is the Skyrim menu key', !t.root.dboPanel.list.text && !t.sent.some((m) => m.e === 'closeMenu'));
  t.press(97);
  check('numpad 1 is key 1: it opens the first note', t.root.dboPanel.list.text && t.root.dboPanel.list.text.text === 'Iron ingots, cheap.');
  t.press(27);
  t.press(49);
  check('key 1 opens the first note in the reader', P(t).list.text.text === 'Iron ingots, cheap.' && P(t).list.author.text === '- Olaf');
  check('the reader shows when it fades', P(t).list.age.text === 'Pinned yesterday  -  Fades in 6 days', P(t).list.age.text);
  P(t).list.remove.onRelease();
  const rm = msgs(t, 'bountyBoard:remove');
  check('Take down sends the widget remove event with the note id', rm.length === 1 && rm[0].args[0] === 2, rm);
  check('and goes back to the list', rowsOf(t).length === 2);
  rowsOf(t)[1].onRelease();
  check('a note the viewer cannot remove has no Take down', !P(t).list.remove && P(t).list.back);
  t.press(27);
  check('Escape in the reader goes back to the list, not out', rowsOf(t).length === 2 && !closed(t));
  t.push(Object.assign({}, board, { notes: board.notes.slice(0, 2) }));
  check('a re-publish keeps the open tab', P(t).head.tab1._alpha === 100 && rowsOf(t).length === 1);
  t.press(27);
  check('the panel hides at once but the menu waits, so the client can still read the close from the outbox', t.root._visible === false && !t.sent.some((m) => m.e === 'closeMenu') && String(t.root.dboOut).indexOf('bountyBoard:close') >= 0);
  t.press(49); P(t).foot.write.onRelease();
  check('a key or click in the frames before the menu closes sends nothing', msgs(t, 'native:handoff').length === 1 && msgs(t, 'bountyBoard:close').length === 1);
  check('Escape on the list sends the widget close (no bare close, as the browser Close) and closes', msgs(t, 'bountyBoard:close').length === 1 && msgs(t, 'close').length === 0 && closed(t));
}

{
  const t = S.boot('dbo_board');
  t.push(Object.assign({}, board, { gold: 10 }));
  P(t).head.tab2.onRelease();
  check('short of gold: Not enough gold', P(t).foot.write.label.text === 'Not enough gold' && P(t).foot.write.disabled);
  const full = S.boot('dbo_board');
  full.push(Object.assign({}, board, { maxNotes: 3 }));
  full.root.dboPanel.head.tab2.onRelease();
  check('a full board: The board is full', full.root.dboPanel.foot.write.label.text === 'The board is full');
  check('an empty tab says so', /Nothing is pinned here yet/.test(P(t).list.empty.text));
  P(t).head.ho1.onRelease();
  const c = msgs(t, 'dbo:citizenOpen');
  check('Citizenship hands over to the citizen panel and closes the board', c.length === 1 && c[0].args[0] === 'citizenship' && msgs(t, 'bountyBoard:close').length === 1 && closed(t));
  const u = S.boot('dbo_board');
  u.push(board);
  u.root.dboPanel.foot.f0.onRelease();
  check('Send a pigeon opens the coop on send', msgs(u, 'dbo:pigeonOpen').pop().args[0] === 'send');
}

{
  const many = Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, tab: 'citizen', author: 'A', text: `Note ${i}`, ageHours: 1, canRemove: false }));
  const t = S.boot('dbo_board');
  t.push(Object.assign({}, board, { notes: many, maxNotes: 50 }));
  P(t).head.tab2.onRelease();
  check('20 notes draw 8 a page', rowsOf(t).length === 8 && P(t).foot.page.text.indexOf('Page 1 of 3') === 0, rowsOf(t).length);
  t.press(39); t.press(39);
  check('Right twice reaches the last page of 4', rowsOf(t).length === 4 && rowsOf(t)[0].label.text === 'Note 16');
  t.press(39);
  check('Right past the end stays on it', rowsOf(t).length === 4);
  t.press(37);
  check('Left goes back', rowsOf(t)[0].label.text === 'Note 8');
}

{
  const t = S.boot('dbo_board', true);
  t.tick();
  t.st.time += 8000; t.tick();
  check('without skse nothing is sent', t.sent.length === 0);
  t.arrive(); t.tick();
  check('once skse appears: ready, then the self-close for the missing payload', t.msgs()[0].key === 'ready' && closed(t), t.sent);
  const u = S.boot('dbo_board');
  u.push({ boardName: 'x' });
  check('an unreadable payload is logged, not drawn', u.logs.some((l) => l.indexOf('unreadable payload') >= 0) && !u.root.dboPanel.list);
}

T.done();
