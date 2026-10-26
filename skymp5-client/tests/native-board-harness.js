// Runs the native notice board (swf/dbo_board) on the stub stage with the widget bountyBoardService publishes.
//   node tests/native-board-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
// SKSE's AllowTextInput is a counter (GameInput.cpp): what the panel holds is the trues less the falses
const held = (t) => t.sent.reduce((n, m) => n + (m.e === 'allowTextInput' ? (m.on ? 1 : -1) : 0), 0);
// the lowest the count went: below 0 is a release SKSE refuses (counter underflow)
const lowest = (t) => t.sent.reduce((s, m) => { if (m.e === 'allowTextInput') { s.n += m.on ? 1 : -1; s.min = Math.min(s.min, s.n); } return s; }, { n: 0, min: 0 }).min;

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
  check('the focused button carries the aqua wash and loses it on roll-out', cb.wash !== undefined && (cb.onRollOut(), cb.wash === undefined), cb.wash);
  check('the title names the board', P(t).head.title.text === 'BRUMA NOTICE BOARD', P(t).head.title.text);
  check('tabs carry their counts, the first open and bright', P(t).head.tab0.label.text === 'Hold Notices  1' && P(t).head.tab1.label.text === 'Shop Ads  2' && P(t).head.tab0._alpha === 100 && P(t).head.tab1._alpha === 50);
  const r = rowsOf(t);
  check('hold tab lists its one notice, first line only, with author and age', r.length === 1 && r[0].label.text === 'Curfew at dusk.' && r[0].sub.text === 'Jarl Narri  -  Pinned today', r.map((x) => [x.label.text, x.sub.text]));
  check('on the hold tab Write a notice is greyed: officials only', P(t).foot.write.disabled === true && P(t).foot.write.label.text === 'Officials only');
  P(t).foot.write.onRelease();
  check('a greyed Write sends nothing', msgs(t, 'native:handoff').length === 0);
  P(t).head.tab1.onRelease();
  check('a tab click switches the list', rowsOf(t).length === 2 && P(t).head.tab1._alpha === 100, rowsOf(t).length);
  check('ages read yesterday and days ago', rowsOf(t)[0].sub.text === 'Olaf  -  Pinned yesterday' && rowsOf(t)[1].sub.text === 'Gemma  -  Pinned 4 days ago');
  check('the hint gives the cost and the gold carried', /costs 30 gold.*fades after 7 days.*carry 120 gold/.test(P(t).foot.hint.text), P(t).foot.hint.text);
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
  t.press(49); P(t).foot.close.onRelease();
  check('a key or click in the frames before the menu closes sends nothing', msgs(t, 'bountyBoard:close').length === 1);
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

// ---- the layout Nat saw (26 Oct): every tab fits, and the reader's actions stand clear of the footnote ----
{
  const t = S.boot('dbo_board');
  const tabs = board.tabs.concat([{ id: 'recruit', label: 'Recruitment', cost: 30, canPost: true }]);
  t.push(Object.assign({}, board, { tabs }));
  const h = P(t).head;
  const right = (b) => b._x + b.label._width;
  const all = Object.keys(h.kids).filter((k) => /^(tab|ho)\d$/.test(k)).map((k) => h[k]);
  check('every tab and hand-over ends inside the panel (920 less the padding)', all.length === 7 && all.every((b) => right(b) <= 920 - 28), all.map((b) => [b.label.text, right(b)]));
  check('the hand-overs are a second row in the same weight as the tabs', h.ho0._y > h.tab0._y && h.ho0.label.fmt.font === h.tab0.label.fmt.font && h.ho2.label.text === 'Voting');
  const long = Object.assign({}, board, { notes: [{ id: 9, tab: 'hold', author: 'Jarl Narri', text: new Array(12).fill('A long line of the decree of the Jarl that wraps across the page.').join(' '), ageHours: 1, canRemove: true }] });
  t.push(long);
  t.press(49);
  const l = P(t).list;
  const footTop = 640 - 90 - 8;
  check('a long note: its Take down and Back stay above the footer rule', l.remove._y + 30 <= footTop && l.back._y === l.remove._y, [l.remove._y, footTop]);
  check('...under its signature', l.remove._y > l.age._y && l.age._y > l.author._y && l.author._y > l.text._y);
  check('the footnote is hidden while reading', P(t).foot.hint.text === '');
  const s2 = S.boot('dbo_board');
  s2.push(board);
  s2.press(49);
  const sl = P(s2).list;
  check('a short note keeps its signature close under the text, not at the bottom', sl.author._y - sl.text._y < 80, [sl.text._y, sl.author._y]);
}

// ---- writing a notice in the panel (dboInput), and the browser as the fallback ----
{
  const t = S.boot('dbo_board');
  t.push(board);
  P(t).head.tab1.onRelease();
  P(t).foot.write.onRelease();
  const l = P(t).list;
  check('Write a notice opens a composer in the panel for this tab, typing allowed', l.head.text === 'Pin a notice  -  Shop Ads' && l.box.type === 'input' && l.box.maxChars === 600 && t.ctx.Selection.focused === l.box && t.sent.some((m) => m.e === 'allowTextInput' && m.on === true));
  check('the footnote makes way, and Write is greyed while composing', P(t).foot.hint.text === '' && P(t).foot.write.disabled === true);
  t.press(49);
  check('digits are typing now, not row picks', P(t).list.box && !P(t).list.text);
  l.box.text = '  Mead, 5 gold a bottle  '; l.box.onChanged();
  check('the count follows the typing, with the price', l.count.text === '25 / 600  -  30 gold', l.count.text);
  l.post.onRelease();
  const p = msgs(t, 'bountyBoard:post');
  check('Post sends the widget post event with the tab and the trimmed text', p.length === 1 && p[0].args.join('|') === 'shop|Mead, 5 gold a bottle', p);
  l.post.onRelease();
  check('a second Post while the first is on its way sends nothing', msgs(t, 'bountyBoard:post').length === 1);
  t.push(board);
  check('a refresh without our notice (someone else posted) keeps the composer and the text', P(t).list.box && P(t).list.box.text === '  Mead, 5 gold a bottle  ');
  check('...and the redraw takes no second count of the keys', held(t) === 1, held(t));
  t.push(Object.assign({}, board, { notes: board.notes.concat([{ id: 7, tab: 'shop', author: 'Olaf', text: 'Mead, 5 gold a bottle', ageHours: 0, canRemove: true }]) }));
  check('our notice on the board closes the composer and gives the keys back', !P(t).list.box && rowsOf(t).length === 3 && held(t) === 0, held(t));
  P(t).foot.write.onRelease();
  check('the next composer starts empty', P(t).list.box.text === '');
  P(t).list.box.text = 'Lost: a cat'; P(t).list.box.onChanged();
  P(t).list.post.onRelease();
  t.st.time += 6000; t.tick();
  P(t).list.post.onRelease();
  check('a post the server refused (no refresh) can be posted again after a while', msgs(t, 'bountyBoard:post').length === 3);
  t.press(27);
  check('Escape leaves the composer, not the board, and gives the keys back', !P(t).list.box && !t.sent.some((m) => m.e === 'closeMenu') && held(t) === 0, held(t));
  P(t).foot.write.onRelease();
  P(t).list.browser.onRelease();
  const h = msgs(t, 'native:handoff');
  check('Type in the browser instead hands the composer for this tab to the browser', h.length === 1 && h[0].args.join('|') === 'bountyBoard|compose:shop', h);
  const n = S.boot('dbo_board', false, { noTyping: true });
  n.push(board);
  P(n).head.tab1.onRelease();
  P(n).foot.write.onRelease();
  check('a game that cannot take typed input goes straight to the browser composer', msgs(n, 'native:handoff').length === 1 && !P(n).list.box);

  // Every way out of a composer, after N refreshes while typing: the keys are held once and given back exactly once
  const N = 5;
  const mine = Object.assign({}, board, { notes: board.notes.concat([{ id: 8, tab: 'shop', author: 'Olaf', text: 'Mead', ageHours: 0, canRemove: true }]) });
  const ways = {
    'Escape': (c) => c.press(27),
    'Close': (c) => P(c).foot.close.onRelease(),
    'another tab': (c) => P(c).head.tab0.onRelease(),
    'a hand-over (Letters)': (c) => P(c).head.ho0.onRelease(),
    'a footer hand-over': (c) => P(c).foot.f0.onRelease(),
    'Type in the browser instead': (c) => P(c).list.browser.onRelease(),
    'our notice pinned': (c) => { P(c).list.box.text = 'Mead'; P(c).list.box.onChanged(); P(c).list.post.onRelease(); c.push(mine); },
  };
  for (const [way, out] of Object.entries(ways)) {
    const c = S.boot('dbo_board');
    c.push(board);
    P(c).head.tab1.onRelease();
    P(c).foot.write.onRelease();
    for (let i = 0; i < N; i++) c.push(board);
    const during = held(c);
    out(c);
    check(`${way} after ${N} refreshes mid-compose: held once while typing, given back once`, during === 1 && held(c) === 0 && lowest(c) === 0, [during, held(c), lowest(c)]);
  }
}

T.done();
