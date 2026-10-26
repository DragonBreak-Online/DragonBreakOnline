// Runs the native deity picker (swf/dbo_deity) on the stub stage with prayer.js's pickerPayload shape: 10 Divines,
// 16 Princes and 9 other faiths, as skills.json holds them on 26 Oct.
//   node tests/native-deity-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const god = (id, name, kind, o) => Object.assign({ id, name, kind, sphere: `${name}'s sphere.`, boon: `${name}'s boon.`, reachable: true, lawful: true, aspectOf: '' }, o || {});
const DIVINES = ['Akatosh', 'Arkay', 'Dibella', 'Julianos', 'Kynareth', 'Mara', 'Stendarr', 'Talos', 'Zenithar', 'Auri-El'].map((n) => god(n.toLowerCase().replace('-', ''), n, 'divine', n === 'Auri-El' ? { aspectOf: 'akatosh' } : {}));
const PRINCES = Array.from({ length: 16 }, (_, i) => god('prince' + i, 'Prince ' + i, 'daedra', i === 0 ? { lawful: false, reachable: false } : {}));
const FAITHS = Array.from({ length: 9 }, (_, i) => god('faith' + i, 'Faith ' + i, 'faith'));
const picker = (o) => Object.assign({ type: 'deityPicker', id: 36, nonce: 'd1', current: '', first: true, daysLeft: 0, cooldownDays: 7, canChoose: true, notice: '', noticeKind: '', choices: DIVINES.concat(PRINCES, FAITHS) }, o || {});
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const P = (t) => t.root.dboPanel;
const rowsOf = (t) => Object.keys(P(t).list.kids).filter((n) => /^r\d$/.test(n)).map((n) => P(t).list[n]);
const closed = (t) => t.closed();

{
  const t = S.boot('dbo_deity');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1, t.msgs());
  t.push(picker());
  check('first pick: the browser\'s title and line', P(t).head.title.text === 'Choose your god' && P(t).head.sub.text === 'One god, and only their shrines will hear you. You may turn to another later, but not often.');
  check('the three groups are tabs with their counts, the Divines open', P(t).head.tab0.label.text === 'The Divines  10' && P(t).head.tab1.label.text === 'The Princes  16' && P(t).head.tab2.label.text === 'Other Faiths  9' && P(t).head.tab0._alpha === 100 && P(t).head.tab1._alpha === 30);
  check('at most nine rows, paged', rowsOf(t).length === 9 && P(t).list.page.text === 'Page 1 of 2' && P(t).list.up.disabled === true && !P(t).list.down.disabled, rowsOf(t).length);
  check('nothing chosen yet: the browser\'s prompt, and Take greyed', /Choose a name to hear/.test(P(t).detail.empty.text) && P(t).foot.take.disabled === true);
  check('the close row reads Not yet on the first pick', P(t).foot.close.label.text === 'Not yet');
  t.press(54);
  check('key 6 shows Mara: name, sphere, boon, shrines', P(t).detail.name.text === 'Mara' && P(t).detail.sphere.text === 'Mara\'s sphere.' && P(t).detail.boon.text === 'Mara\'s boon.' && P(t).detail.shrines.text === 'There are shrines you can reach.');
  check('...her row lit and underlined, the rest at 30%', rowsOf(t)[5]._alpha === 100 && rowsOf(t)[0]._alpha === 30);
  check('...and Take Mara', P(t).foot.take.label.text === 'Take Mara' && !P(t).foot.take.disabled);
  P(t).foot.take.onRelease();
  const c = msgs(t, 'dbo:deityChoose');
  check('the first pick goes straight through, as in the browser: dbo:deityChoose [nonce, id]', c.length === 1 && c[0].args.join('|') === 'd1|mara' && !closed(t), c);
  t.push(picker({ nonce: 'd2', current: 'mara', first: false, daysLeft: 7, canChoose: false, notice: 'You now follow Mara.', noticeKind: 'taken' }));
  check('the answer: the notice in the success colour', P(t).head.notice.text === 'You now follow Mara.' && P(t).head.notice.textColor === 0x8FBF7F);
  check('...the title and the days left', P(t).head.title.text === 'Your faith' && P(t).head.sub.text === 'You may turn to another god in 7 days.');
  check('...Mara is yours and shown: Already yours, greyed', rowsOf(t)[5].marks.text === 'yours' && P(t).foot.take.label.text === 'Already yours' && P(t).foot.take.disabled === true);
  check('...the close row now reads Close', P(t).foot.close.label.text === 'Close');
  t.press(49);
  check('while the cooldown runs another god cannot be taken', P(t).detail.name.text === 'Akatosh' && P(t).foot.take.label.text === 'Turn to Akatosh' && P(t).foot.take.disabled === true);
  P(t).foot.take.onRelease();
  check('...and a greyed Turn sends nothing', msgs(t, 'dbo:deityChoose').length === 1);
}

{
  const t = S.boot('dbo_deity');
  t.push(picker({ current: 'mara', first: false, canChoose: true }));
  check('opens on the worshipper\'s own god, marked yours', P(t).detail.name.text === 'Mara' && rowsOf(t)[5].marks.text === 'yours' && P(t).head.sub.text === 'You may turn to another god.');
  t.press(39);
  check('Right opens the Princes', P(t).head.tab1._alpha === 100 && rowsOf(t)[0].label.text === 'Prince 0');
  check('...an unlawful god without a reachable shrine says both', rowsOf(t)[0].marks.text === 'no shrine  -  unlawful', rowsOf(t)[0].marks.text);
  rowsOf(t)[0].onRollOver();
  check('hover focuses a row without choosing it', rowsOf(t)[0]._alpha === 100 && P(t).detail.name.text === 'Mara');
  rowsOf(t)[0].onRelease();
  check('a click shows the Prince in the daedric accent, with the law line', P(t).detail.name.textColor === 0xC9A86A && /Proscribed in the Empire/.test(P(t).detail.law.text) && P(t).detail.law.textColor === 0xB23A3A);
  check('...and the shrine warning', /No shrine you can reach yet/.test(P(t).detail.shrines.text));
  P(t).foot.take.onRelease();
  check('turning from a god asks first, naming the cooldown', (P(t).foot.ask || {}).text === 'Turn from Mara to Prince 0? You keep a new god at least 7 days.' && msgs(t, 'dbo:deityChoose').length === 0, P(t).foot.ask && P(t).foot.ask.text);
  t.press(27);
  check('Escape backs out of the question, not the panel', !P(t).foot.ask && !closed(t) && P(t).foot.take.label.text === 'Turn to Prince 0');
  P(t).foot.take.onRelease();
  P(t).foot.back.onRelease();
  check('Back does the same', !P(t).foot.ask && msgs(t, 'dbo:deityChoose').length === 0);
  P(t).foot.take.onRelease();
  P(t).foot.go.onRelease();
  check('Turn to sends dbo:deityChoose with the Prince', msgs(t, 'dbo:deityChoose').length === 1 && msgs(t, 'dbo:deityChoose')[0].args.join('|') === 'd1|prince0');
  t.push(picker({ nonce: 'd3', current: 'mara', first: false, canChoose: true, notice: 'You must wait.', noticeKind: 'refused' }));
  check('a refusal: the notice in the failure colour, the selection back on the current god', P(t).head.notice.textColor === 0xB23A3A && P(t).detail.name.text === 'Mara');
  check('...and the open tab is kept', P(t).head.tab1._alpha === 100);
}

{
  const t = S.boot('dbo_deity');
  t.push(picker());
  P(t).list.down.onRelease();
  check('Down the list shows the tenth Divine', rowsOf(t).length === 1 && rowsOf(t)[0].label.text === 'Auri-El' && P(t).list.down.disabled === true);
  rowsOf(t)[0].onRelease();
  check('an aspect names its god by name', P(t).detail.aspect.text === 'An aspect of Akatosh, not a separate god - either shrine will hear you.', P(t).detail.aspect.text);
  t.press(33);
  check('Page Up goes back', rowsOf(t).length === 9);
  t.wheel(-1);
  check('the wheel pages down', rowsOf(t).length === 1);
  t.wheel(1);
  t.press(37);
  check('Left from the Divines wraps to Other Faiths', P(t).head.tab2._alpha === 100 && rowsOf(t)[0].label.text === 'Faith 0');
  P(t).head.tab1.onRelease();
  check('a tab click opens its group on page one', P(t).head.tab1._alpha === 100 && P(t).list.page.text === 'Page 1 of 2');
  t.press(40); t.press(40); t.press(13);
  check('Down, Down, Enter chooses the second row', P(t).detail.name.text === 'Prince 1');
  t.press(9);
  check('Tab closes with dbo:deityClose [nonce] (no bare close)', msgs(t, 'dbo:deityClose').length === 1 && msgs(t, 'dbo:deityClose')[0].args[0] === 'd1' && msgs(t, 'close').length === 0 && closed(t));
  const u = S.boot('dbo_deity');
  u.push(picker());
  u.root.dboPanel.foot.close.onRelease();
  check('Not yet closes the same way, with the cancel sound', msgs(u, 'dbo:deityClose').length === 1 && closed(u) && u.sounds.includes('PlaySound:UIMenuCancel'));
}

{
  const t = S.boot('dbo_deity');
  t.push(picker({ choices: DIVINES.slice(0, 3) }));
  check('a server with Divines only: one tab, no pager', P(t).head.tab0 && !P(t).head.tab1 && !P(t).head.tab2 && !P(t).list.page);
  t.press(39);
  check('...Right stays put', P(t).head.tab0._alpha === 100);
  const n = S.boot('dbo_deity');
  n.push(picker({ current: 'mara', first: false }));
  n.press(51);
  const okSounds = n.sounds.filter((x) => x === 'PlaySound:UIMenuOK').length;
  check('choosing a god plays UIMenuOK', okSounds === 1 && n.root.dboPanel.detail.name.text === 'Dibella', n.sounds);
  n.push(picker({ current: 'mara', first: false, notice: 'The shrine is quiet.' }));
  check('a re-send with the same nonce keeps the god being read', n.root.dboPanel.detail.name.text === 'Dibella');
  check('a notice with no kind is drawn white, not red', n.root.dboPanel.head.notice.textColor === 0xFFFFFF);
  const long = 'You now follow Dibella. Her shrines will hear you, and her blessing rests on you; you may turn to another god in seven days, not before.';
  n.push(picker({ nonce: 'd9', current: 'dibella', first: false, notice: long, noticeKind: 'taken' }));
  const nt = n.root.dboPanel.head.notice;
  check('a long notice wraps onto two lines with room for them, above the tabs', nt.multiline === true && nt._height >= 48 && nt._y + nt._height <= n.root.dboPanel.head.tab0._y && long.length > 120, [nt._height, n.root.dboPanel.head.tab0._y]);
  const o = S.boot('dbo_deity');
  o.push(picker({ current: 'prince12', first: false }));
  check('opens on the tab and page that hold the worshipper\'s god', o.root.dboPanel.head.tab1._alpha === 100 && o.root.dboPanel.list.page.text === 'Page 2 of 2' && o.root.dboPanel.detail.name.text === 'Prince 12');
  const l = S.boot('dbo_deity', true);
  l.tick();
  l.st.time += 8000; l.tick();
  check('without skse nothing is sent', l.sent.length === 0);
  l.arrive(); l.tick();
  check('once skse appears: ready, then the self-close for the missing payload', l.msgs()[0].key === 'ready' && closed(l), l.sent);
  const u = S.boot('dbo_deity');
  u.push({ nonce: 'x' });
  check('an unreadable payload is logged, not drawn', u.logs.some((s) => s.indexOf('unreadable payload') >= 0) && !u.root.dboPanel.list);
}

T.done();
