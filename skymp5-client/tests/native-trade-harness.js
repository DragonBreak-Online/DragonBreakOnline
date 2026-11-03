// Runs the native trade window (swf/dbo_trade) on the stub stage with the widget tradeService publishes (widget 14), against
// the browser window's own rules (skymp5-front features/trade): the three lists, the stack prompt, the gold amount, the
// category, sort and search, Accept locking first, Change offer and Back out, the countdown, the reset note, Escape and Cancel.
//   node tests/native-trade-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const held = (t) => t.sent.reduce((n, m) => n + (m.e === 'allowTextInput' ? (m.on ? 1 : -1) : 0), 0);
const lowest = (t) => t.sent.reduce((s, m) => { if (m.e === 'allowTextInput') { s.n += m.on ? 1 : -1; s.min = Math.min(s.min, s.n); } return s; }, { n: 0, min: 0 }).min;

const P = (t) => t.root.dboPanel;
const visible = (c) => { for (let k = c; k; k = k._parent) if (k._visible === false) return false; return true; };
const buttons = (t) => { const out = []; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.label && k.onRelease && visible(k)) out.push(k); if (k.kids) walk(k); } }; walk(P(t)); return out; };
const btn = (t, label) => buttons(t).find((b) => b.label.text === label);
const btns = (t, label) => buttons(t).filter((b) => b.label.text === label);
const press = (t, label) => { const b = btn(t, label); if (!b) throw new Error('no button ' + label + ' among ' + buttons(t).map((x) => x.label.text).join('|')); b.onRelease(); };
const tabBtn = (t, n) => P(t).tabs['t' + n];
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
// The list rows on the shown page, top to bottom: their names
// (the rows are pooled clips, refilled in place: a hidden one is not on the page)
const rows = (t) => { const l = P(t).list; return Object.values(l.kids).filter((r) => r.kids && r.label && r.sub && r._visible !== false).sort((a, b) => a._y - b._y); };
const names = (t) => rows(t).map((r) => r.label.text);
const rowBtn = (t, name) => { const r = rows(t).find((x) => x.label.text === name); return r && r.btn0 && r.btn0._visible !== false ? r.btn0 : undefined; };
const texts = (t) => { const out = []; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (typeof k.text === 'string' && visible(k)) out.push(k.text); if (k.kids) walk(k); } }; walk(P(t)); return out.join(' | '); };

const events = { add: 'trade:add', remove: 'trade:remove', lock: 'trade:lock', unlock: 'trade:unlock', accept: 'trade:accept', cancel: 'trade:cancel',
  inviteAccept: 'trade:invite:accept', inviteDecline: 'trade:invite:decline' };
const goldLine = (n) => ({ lineId: '15||||||||', baseId: 15, count: n, name: 'Gold', cat: 'misc', value: 1, weight: 0 });
const inventory = [
  { lineId: '1|a', baseId: 0x12eb7, count: 1, name: 'Iron Sword', cat: 'weapons', value: 25, weight: 9, equipped: true },
  { lineId: '2|b', baseId: 0x5ace4, count: 12, name: 'Iron Ingot', cat: 'ingots', value: 7, weight: 1 },
  { lineId: '3|c', baseId: 0x3eada, count: 1, name: 'Amulet of Mara', cat: 'jewellery', value: 150, weight: 1, tags: ['enchanted'] },
  goldLine(500),
];
const base = { type: 'trade', id: 14, partnerName: 'Lydia', inventory, myOffer: [], theirOffer: [], myLocked: false, theirLocked: false, bothLocked: false,
  iAccepted: false, theyAccepted: false, stackPromptThreshold: 1, events };
const w = (o) => Object.assign({}, base, o);

// ---- the window, the goods list ----
{
  const t = S.boot('dbo_trade');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(base);
  check('the title names the partner', P(t).head.title.text === 'TRADE WITH LYDIA', P(t).head.title.text);
  check('the banner says what to do, both still choosing', P(t).head.banner.text === 'Add items, review both offers, then press Accept.' && P(t).head.status.text === 'You still choosing     Lydia still choosing', [P(t).head.banner.text, P(t).head.status.text]);
  check('three tabs, with counts', tabBtn(t, 0).label.text === 'Your goods (4)' && tabBtn(t, 1).label.text === 'Your offer (0)' && tabBtn(t, 2).label.text === "Lydia's offer (0)", [0, 1, 2].map((n) => tabBtn(t, n).label.text));
  check('the goods are listed by name', names(t).join('|') === 'Amulet of Mara|Gold|Iron Ingot|Iron Sword', names(t));
  const sword = rows(t).find((r) => r.label.text === 'Iron Sword');
  check('a row shows value, weight and equipped; tags too', sword.sub.text === '25 gold  ·  weighs 9  ·  equipped' && /enchanted/.test(rows(t)[0].sub.text), [sword.sub.text, rows(t)[0].sub.text]);
  check('a stack says how many and the value of each', /^x12  ·  7 gold each/.test(rows(t).find((r) => r.label.text === 'Iron Ingot').sub.text));
  rowBtn(t, 'Iron Sword').onRelease();
  const a = msgs(t, 'trade:add');
  check('a single item is offered at once: trade:add with its line and count 1', a.length === 1 && a[0].args[0] === '1|a' && a[0].args[1] === 1, a);
  check('Accept is there; Change offer is not until locked', !!btn(t, 'Accept') && !btn(t, 'Change offer') && !!btn(t, 'Cancel'));

  // the stack prompt
  rowBtn(t, 'Iron Ingot').onRelease();
  check('a stack asks how many first, nothing sent', msgs(t, 'trade:add').length === 1 && /Offer how many Iron Ingot\?/.test(P(t).tools.question.text) && P(t).tools.value.text === '1 of 12');
  check('...with the focus on Confirm', t.ctx.focus === P(t).tools.confirm.idx);
  const toolsClip = P(t).tools, listClip = P(t).list;
  press(t, '+10'); press(t, '+10');
  check('+10 twice stops at the stack: 12 of 12', P(t).tools.value.text === '12 of 12', P(t).tools.value.text);
  check('...rewriting the count in place: the tools and the list are not redrawn', P(t).tools === toolsClip && P(t).list === listClip);
  press(t, '-1'); press(t, '-10'); press(t, '-10');
  check('...and never below 1', P(t).tools.value.text === '1 of 12', P(t).tools.value.text);
  P(t).tools.s2.onRollOver(); press(t, '+1'); press(t, '+1');
  check('focus stays on the button pressed through a redraw', t.ctx.focus === P(t).tools.s2.idx, t.ctx.focus);
  press(t, 'Confirm');
  const a2 = msgs(t, 'trade:add');
  check('Confirm sends the count chosen', a2.length === 2 && a2[1].args[0] === '2|b' && a2[1].args[1] === 3, a2);
  check('...and the prompt goes', P(t).tools.question === undefined);
  rowBtn(t, 'Iron Ingot').onRelease();
  press(t, 'All');
  check('All takes the whole stack', P(t).tools.value.text === '12 of 12');
  t.press(27);
  check('Escape leaves the prompt, not the window, and sends nothing', P(t).tools.question === undefined && !t.closed() && msgs(t, 'trade:add').length === 2 && msgs(t, 'trade:cancel').length === 0);
  rowBtn(t, 'Iron Ingot').onRelease();
  press(t, 'Back');
  check('Back leaves the prompt too', P(t).tools.question === undefined && msgs(t, 'trade:add').length === 2);
  rowBtn(t, 'Iron Ingot').onRelease();
  t.push(w({ inventory: inventory.filter((i) => i.name !== 'Iron Ingot') }));
  check('a payload without the waiting stack drops its prompt', P(t).tools.question === undefined);
  rowBtn(t, 'Gold').onRelease(); press(t, '+10');
  t.push(w({ inventory: inventory.map((i) => i.name === 'Gold' ? goldLine(5) : i) }));
  check('a smaller stack clamps the waiting count', P(t).tools.value.text === '5 of 5', P(t).tools.value.text);
  t.press(27);
}

// ---- category, sort, search ----
{
  const t = S.boot('dbo_trade');
  t.push(base);
  check('the category starts at All', P(t).tools.cat.label.text === 'Show: All');
  P(t).tools.cat.onRelease();
  check('it steps through the categories that have goods, in the browser\'s order', P(t).tools.cat.label.text === 'Show: Weapons' && names(t).join('|') === 'Iron Sword', [P(t).tools.cat.label.text, names(t)]);
  P(t).tools.cat.onRelease();
  check('...Jewellery next (no armour or clothing here)', P(t).tools.cat.label.text === 'Show: Jewellery' && names(t).join('|') === 'Amulet of Mara');
  P(t).tools.cat.onRelease(); P(t).tools.cat.onRelease();
  check('...Ingots, then Misc', P(t).tools.cat.label.text === 'Show: Misc' && names(t).join('|') === 'Gold');
  P(t).tools.cat.onRelease();
  check('...and round to All', P(t).tools.cat.label.text === 'Show: All' && names(t).length === 4);
  P(t).tools.cat.onRelease();
  t.push(w({ inventory: inventory.filter((i) => i.cat !== 'weapons') }));
  check('a category emptied by a move shows All', P(t).tools.cat.label.text === 'Show: All' && names(t).length === 3);
  t.push(base);
  check('the chosen category comes back with its goods', P(t).tools.cat.label.text === 'Show: Weapons');
  for (let i = 0; i < 4; i++) P(t).tools.cat.onRelease();
  P(t).tools.sort.onRelease();
  check('Sort by value: dearest first', P(t).tools.sort.label.text === 'Sort: Value' && names(t).join('|') === 'Amulet of Mara|Iron Sword|Iron Ingot|Gold', names(t));
  P(t).tools.sort.onRelease();
  check('Sort by weight: heaviest first, ties by name', P(t).tools.sort.label.text === 'Sort: Weight' && names(t).join('|') === 'Iron Sword|Amulet of Mara|Iron Ingot|Gold', names(t));
  P(t).tools.sort.onRelease();
  check('...and back to name', names(t).join('|') === 'Amulet of Mara|Gold|Iron Ingot|Iron Sword');
  press(t, 'Search...');
  const box = P(t).tools.box;
  check('Search opens a box with the focus, typing allowed', box && box.type === 'input' && t.ctx.Selection.focused === box && held(t) === 1);
  t.press(40);
  check('arrow keys are typing while the box is open', P(t).tools.box === box);
  box.text = 'iron';
  t.push(base);
  check('a payload keeps what was typed and takes no second count', P(t).tools.box.text === 'iron' && held(t) === 1, [P(t).tools.box.text, held(t)]);
  t.press(13);
  check('Enter filters by name, case aside, and gives the keys back', names(t).join('|') === 'Iron Ingot|Iron Sword' && held(t) === 0 && /"iron"/.test(P(t).tools.filter.text), names(t));
  press(t, 'Clear');
  check('Clear shows everything again', names(t).length === 4);
  press(t, 'Search...'); P(t).tools.box.text = 'zzz'; t.press(13);
  check('no match says so', /No matches\./.test(texts(t)));
  press(t, 'Search...'); t.press(27);
  check('Escape leaves the box, not the window, and gives the keys back', !P(t).tools.box && !t.closed() && held(t) === 0 && lowest(t) === 0);
  check('the filter is kept after an Escape', /"zzz"/.test(P(t).tools.filter.text));
  const nt = S.boot('dbo_trade', false, { noTyping: true });
  nt.push(base);
  check('a game without typed input shows no Search', !btn(nt, 'Search...'));
}

// ---- my offer, gold ----
{
  const t = S.boot('dbo_trade');
  const offer = [{ lineId: '2|b', baseId: 0x5ace4, count: 4, name: 'Iron Ingot', cat: 'ingots', value: 7, weight: 1 }, goldLine(100)];
  const inv = inventory.map((i) => i.name === 'Gold' ? goldLine(400) : i.name === 'Iron Ingot' ? Object.assign({}, i, { count: 8 }) : i);
  t.push(w({ inventory: inv, myOffer: offer }));
  t.press(9);
  check('Tab moves to Your offer', tabBtn(t, 1).label.text === 'Your offer (2)' && names(t).join('|') === 'Gold|Iron Ingot', names(t));
  check('the totals count every stack: 4 x 7 + 100 x 1 = 128 gold, weighs 4', P(t).foot.totals.text === 'Base value 128 gold  ·  weighs 4', P(t).foot.totals.text);
  check('the gold amount is what is offered of all you have', P(t).tools.value.text === '100 of 500', P(t).tools.value.text);
  check('Offer gold is greyed until the amount changes', btn(t, 'Offer gold').disabled === true);
  press(t, '+100'); press(t, '+100'); press(t, '-10');
  check('the steppers set it: 290', P(t).tools.value.text === '290 of 500');
  press(t, 'Offer gold');
  const a = msgs(t, 'trade:add');
  check('Offer gold sends the difference as an add on the gold line', a.length === 1 && a[0].args[0] === '15||||||||' && a[0].args[1] === 190, a);
  for (let i = 0; i < 8; i++) press(t, '-100');
  press(t, 'Offer gold');
  const r = msgs(t, 'trade:remove');
  check('down to 0 sends the difference as a remove', r.length === 1 && r[0].args[1] === 100, r);
  for (let i = 0; i < 9; i++) press(t, '+100');
  check('never more than you have', P(t).tools.value.text === '500 of 500');
  t.push(w({ inventory: inv.map((i) => i.name === 'Gold' ? goldLine(300) : i), myOffer: offer.map((i) => i.name === 'Gold' ? goldLine(200) : i) }));
  check('a payload that moved the gold shows what is offered now', P(t).tools.value.text === '200 of 500', P(t).tools.value.text);
  press(t, 'Type...');
  check('Type... opens a digits box with the amount', P(t).tools.box && P(t).tools.box.restrict === '0-9' && P(t).tools.box.text === '200' && held(t) === 1);
  P(t).tools.box.text = '9999'; t.press(13);
  check('a typed amount is held to what you have, keys given back', P(t).tools.value.text === '500 of 500' && held(t) === 0);
  rowBtn(t, 'Iron Ingot').onRelease();
  check('Take back on a stack asks how many', /Take back how many Iron Ingot\?/.test(P(t).tools.question.text) && P(t).tools.value.text === '1 of 4');
  press(t, 'All'); press(t, 'Confirm');
  const r2 = msgs(t, 'trade:remove');
  check('...and sends a remove of that many', r2.length === 2 && r2[1].args[0] === '2|b' && r2[1].args[1] === 4, r2);
  press(t, 'Type...');
  t.push(w({ inventory: inv, myOffer: offer, myLocked: true }));
  check('locking closes a gold box and gives the keys back', !P(t).tools.box && held(t) === 0 && lowest(t) === 0);
  check('locked: no steppers, Take back greyed', !btn(t, '+100') && rowBtn(t, 'Iron Ingot').disabled === true && /\[locked\]/.test(tabBtn(t, 1).label.text));
  tabBtn(t, 0).onRelease();
  check('locked: Offer greyed on the goods too', rowBtn(t, 'Iron Sword').disabled === true);
  rowBtn(t, 'Iron Ingot').onRelease();
  check('...and a greyed Offer opens no prompt', P(t).tools.question === undefined);
}
{
  const t = S.boot('dbo_trade');
  t.push(w({ inventory: [Object.assign(goldLine(40), { lineId: '15|x', tags: ['trades as plain'] })] }));
  tabBtn(t, 1).onRelease();
  check('a tagged gold line is goods, not the gold amount', P(t).tools.value === undefined && !btn(t, 'Offer gold'));
}

// ---- their offer ----
{
  const t = S.boot('dbo_trade');
  t.push(w({ theirOffer: [{ lineId: '9|z', baseId: 0x1, count: 2, name: 'Sweetroll', cat: 'food', value: 2, weight: 0.5 }, goldLine(50)], theirLocked: true }));
  tabBtn(t, 2).onRelease();
  check('their offer lists their goods with no buttons', names(t).join('|') === 'Gold|Sweetroll' && rows(t).every((r) => !visible(r.btn0)), names(t));
  check('their gold shows on its own line and the tab says locked', P(t).tools.their.text === 'Gold:  50' && /\[locked\]/.test(tabBtn(t, 2).label.text));
  check('their status says locked, not accepted', /Lydia locked, not accepted/.test(P(t).head.status.text));
  check('their totals', P(t).foot.totals.text === 'Base value 54 gold  ·  weighs 1', P(t).foot.totals.text);
}

// ---- accepting ----
{
  const t = S.boot('dbo_trade');
  t.push(base);
  press(t, 'Accept');
  check('Accept on an open offer locks first, and is greyed while it waits', msgs(t, 'trade:lock').length === 1 && msgs(t, 'trade:accept').length === 0 && btn(t, 'Accept').disabled === true);
  t.push(w({ myLocked: true }));
  check('...the server\'s lock then sends the accept', msgs(t, 'trade:accept').length === 1);
  check('locked: Change offer appears', !!btn(t, 'Change offer'));
  t.push(w({ myLocked: true }));
  check('only once', msgs(t, 'trade:accept').length === 1);
  t.push(w({ myLocked: true, iAccepted: true }));
  check('accepted: the banner waits for the partner, Accepted greyed, Back out', P(t).head.banner.text === 'You accepted. Waiting for Lydia to accept.' && btn(t, 'Accepted').disabled === true && !!btn(t, 'Back out'));
  press(t, 'Back out');
  check('Back out sends unlock', msgs(t, 'trade:unlock').length === 1);
  t.push(w({ myLocked: true }));
  press(t, 'Accept');
  check('Accept when already locked accepts at once', msgs(t, 'trade:accept').length === 2 && msgs(t, 'trade:lock').length === 1);
  const t2 = S.boot('dbo_trade');
  t2.push(base);
  press(t2, 'Accept');
  t2.push(base);
  check('a lock the server refused sends no accept, and Accept comes back', msgs(t2, 'trade:accept').length === 0 && btn(t2, 'Accept').disabled !== true);
  t2.push(w({ theirLocked: true, theyAccepted: true }));
  check('their accept: the banner asks you to review', P(t2).head.banner.text === 'Lydia accepted. Review their offer and accept to trade.');
}

// ---- the countdown, the reset note ----
{
  const t = S.boot('dbo_trade');
  t.push(w({ myLocked: true, theirLocked: true, bothLocked: true, iAccepted: true, theyAccepted: true }));
  check('both accepted: the countdown starts at 3, green', P(t).head.banner.text === 'Both accepted. Trading in 3...' && P(t).head.banner.textColor === 0x7FBF7F && btn(t, 'Trading...').disabled === true, P(t).head.banner.text);
  t.st.time += 1000; t.tick();
  check('...counts down with time alone', P(t).head.banner.text === 'Both accepted. Trading in 2...', P(t).head.banner.text);
  t.push(w({ myLocked: true, theirLocked: true, bothLocked: true, iAccepted: true, theyAccepted: true }));
  check('...a re-sent payload does not restart it', P(t).head.banner.text === 'Both accepted. Trading in 2...', P(t).head.banner.text);
  t.st.time += 3000; t.tick();
  check('...and ends at Trading...', P(t).head.banner.text === 'Both accepted. Trading...');
  const r = S.boot('dbo_trade');
  r.push(w({ myLocked: true, theirLocked: true }));
  r.push(w({ theirOffer: [goldLine(5)] }));
  check('a changed offer after a lock shows the reset note, red', P(r).head.banner.text === 'An offer changed, so acceptance was reset. Review both offers again.' && P(r).head.banner.textColor === 0xB23A3A);
  r.st.time += 5000; r.tick();
  check('...for five seconds', P(r).head.banner.text === 'Add items, review both offers, then press Accept.', P(r).head.banner.text);
  const q = S.boot('dbo_trade');
  q.push(base);
  q.push(w({ theirOffer: [goldLine(5)] }));
  check('a change with nobody committed shows no note', P(q).head.banner.text === 'Add items, review both offers, then press Accept.');
}

// ---- paging, keys, leaving ----
{
  const t = S.boot('dbo_trade');
  const many = [];
  for (let i = 0; i < 15; i++) many.push({ lineId: 'm' + i, baseId: 0x100 + i, count: 1, name: 'Item ' + String(i).padStart(2, '0'), cat: 'misc', value: i, weight: 1 });
  t.push(w({ inventory: many }));
  const per = names(t).length;
  const where = () => (P(t).foot.pager ? P(t).foot.pager.where.text : '');
  check('a page holds at most 9 rows, the foot says page 1', per >= 5 && per <= 9 && where() === 'Page 1 of ' + Math.ceil(15 / per), [per, where()]);
  check('...with Previous greyed on the first page and Next live', P(t).foot.pager.prev.disabled === true && P(t).foot.pager.next.disabled !== true);
  t.press(39);
  check('Right turns the page', names(t)[0] === 'Item ' + String(per).padStart(2, '0') && /^Page 2 of /.test(where()), names(t));
  t.press(34); t.press(34); t.press(34);
  const last = Math.ceil(15 / per);
  check('Page Down stops at the last page, Next greyed there', where() === 'Page ' + last + ' of ' + last && P(t).foot.pager.next.disabled === true, where());
  t.press(33);
  check('Page Up goes back', where() === 'Page ' + (last - 1) + ' of ' + last);
  // the clickable footer and the wheel (3 Nov polish: players had only the arrow keys)
  P(t).foot.pager.prev.onRelease();
  check('clicking Previous turns back', where() === 'Page ' + Math.max(1, last - 2) + ' of ' + last, where());
  P(t).foot.pager.next.onRelease();
  check('clicking Next turns on', where() === 'Page ' + (last - 1) + ' of ' + last, where());
  const nextIdx = P(t).foot.pager.next.idx;
  t.ctx.setFocus(nextIdx);
  t.press(13);
  check('Enter on a focused Next turns, and the focus stays on Next', P(t).foot.pager.next.idx === t.ctx.focus && where() === 'Page ' + last + ' of ' + last, [t.ctx.focus, where()]);
  t.wheel(3);
  check('the wheel up turns back', where() === 'Page ' + (last - 1) + ' of ' + last, where());
  t.wheel(-3);
  check('the wheel down turns on', where() === 'Page ' + last + ' of ' + last, where());
  t.wheel(-3);
  check('...and stops at the last page', where() === 'Page ' + last + ' of ' + last, where());
  // a page turn redraws the list and the foot only: the head, tabs and tools are the clips they were
  const seen = new Set();
  const walk = (c) => { seen.add(c); for (const k of Object.values(c.kids || {})) walk(k); };
  walk(P(t));
  const head = P(t).head, tabs = P(t).tabs, tools = P(t).tools;
  t.wheel(3);
  let made = 0;
  const count = (c) => { if (!seen.has(c)) made++; for (const k of Object.values(c.kids || {})) count(k); };
  count(P(t));
  check('a page turn keeps the head, tabs and tools as they were', P(t).head === head && P(t).tabs === tabs && P(t).tools === tools);
  seen.clear(); walk(P(t));
  t.push(w({ inventory: many }));
  let full = 0;
  const countFull = (c) => { if (!seen.has(c)) full++; for (const k of Object.values(c.kids || {})) countFull(k); };
  countFull(P(t));
  // on base a turn made about fifty (every row again); now the rows are refilled and only the foot is new
  check('...and makes only the foot anew: no row clips (16 at most, where a full redraw made 66)', made > 0 && made <= 16 && full > made && P(t).head !== head, [made, full]);
  {
    const rowsBefore = Object.values(P(t).list.kids).filter((k) => k.kids);
    t.push(w({ inventory: many.slice().reverse() }));
    const rowsAfter = Object.values(P(t).list.kids).filter((k) => k.kids);
    check('a payload refills the same row clips', rowsAfter.length === rowsBefore.length && rowsAfter.every((r) => rowsBefore.includes(r)), [rowsBefore.length, rowsAfter.length]);
  }
  t.push(w({ inventory: many.slice(0, 2) }));
  check('a shorter list pulls the page back, and one page has no footer', !P(t).foot.pager && names(t).length === 2);
  t.press(40);
  check('Down focuses the first control', t.ctx.focus === 0);
  t.press(9);
  check('Tab cycles the tabs and back round', tabBtn(t, 1).label.text === 'Your offer (0)' && /Nothing offered yet\./.test(texts(t)));
  t.press(9); t.press(9);
  check('...to the goods', names(t).length === 2);
  press(t, 'Cancel');
  check('Cancel sends the cancel event and closes', msgs(t, 'trade:cancel').length === 1 && t.closed());
  const e = S.boot('dbo_trade');
  e.push(base);
  e.press(27);
  check('Escape cancels the trade and closes', msgs(e, 'trade:cancel').length === 1 && e.closed());
  const x = S.boot('dbo_trade');
  x.push(base);
  press(x, 'Search...');
  press(x, 'Cancel');
  check('closing with the box open gives the keys back', held(x) === 0 && lowest(x) === 0);
  const n = S.boot('dbo_trade');
  n.push({ type: 'trade', id: 14 });
  check('an unreadable payload draws nothing', !n.root.dboPanel.head);
  n.st.time += 8000; n.tick();
  check('...and with no payload the panel closes itself', n.closed());
  const o = S.boot('dbo_trade');
  o.push(w({ events: { add: 'x:add', remove: 'x:remove', lock: 'x:lock', unlock: 'x:unlock', accept: 'x:accept', cancel: 'x:cancel' } }));
  rowBtn(o, 'Iron Sword').onRelease();
  check('the keys are the payload\'s own events', msgs(o, 'x:add').length === 1 && msgs(o, 'trade:add').length === 0);
  const c = S.boot('dbo_trade');
  c.push(w({ inventory: [], partnerName: 'Faendal' }));
  check('nothing to trade says so', /Nothing to trade\./.test(texts(c)) && P(c).head.title.text === 'TRADE WITH FAENDAL');
}

T.done();
