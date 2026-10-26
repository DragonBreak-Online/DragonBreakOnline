// Runs the native pigeon coop (swf/dbo_pigeon) on the stub stage with the widget gamemode.js openPigeonCoop publishes
// (post.js supply, couriers.js courier).
//   node tests/native-pigeon-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
// DBO_MENU names a mutated copy of the panel (never the tracked file) to prove the harness can fail
const MENU = process.env.DBO_MENU || 'dbo_pigeon';

const coop = (extra) => Object.assign({
  type: 'pigeon', id: 34, nonce: 'n1', boardName: 'Bruma', gold: 120, cooldownMinutes: 0, maxText: 240, view: 'letters',
  contacts: [{ id: 11, name: 'Bob', tag: 'BOBB', online: true, price: 5 }, { id: 12, name: 'Eve', tag: 'EVEE', online: false, price: 6 }],
  letters: [
    { id: 'l1', from: 'Ann', text: 'Meet me at the gate.', at: 0, read: false },
    { id: 'l2', from: 'Bob', text: 'Here is the gold.', at: 0, read: true, parcel: { gold: 20, items: [{ name: 'Iron Ingot', count: 2 }] } },
    { id: 'l3', from: 'Cid', text: 'Old news.', at: 0, read: true },
  ],
  supply: { enabled: true, zone: 'Bruma', feeShare: 0.1, minFee: 5, maxCount: 50, maxOpen: 3, openDays: 3, search: '', results: [],
    orders: [{ id: 7, name: 'Iron Ore', count: 5, filled: 1, reward: 50, perUnit: 10, held: 40, poster: 'Ann', hoursLeft: 10, zone: 'Bruma', state: 'open', mine: false, have: 3 }],
    mine: [{ id: 9, name: 'Wheat', count: 10, filled: 0, reward: 30, perUnit: 3, held: 30, poster: 'You', hoursLeft: 50, zone: 'Bruma', state: 'open', mine: true, have: 0 }] },
  courier: { enabled: true, place: 'Bruma', placeId: 'bruma', destinations: [], goods: [],
    rules: { feeShare: 0.1, minFee: 5, premiumRate: 0.05, maxStacks: 3, minPay: 10, maxPay: 1000, limitGameDays: 3, openDays: 3, maxCarried: 2, maxOpen: 3, maxPayoutsPerWeek: 5 },
    rank: { name: 'Novice', delivered: 1, carry: 1, maxValue: 100, boards: true, line: 'Bring five parcels to become a Runner.', next: { name: 'Runner', at: 5 } },
    open: [{ id: 3, goods: '2 Iron Ingot', kinds: 1, pay: 40, dest: 'Whiterun', kind: 'board', origin: 'Bruma', sender: 'Ann', recipient: 'Ann', insured: 0, state: 'open', hoursLeft: 20, gameHoursLeft: 0, mine: false }],
    carrying: [{ id: 4, goods: '1 Silver Ingot', kinds: 1, pay: 60, dest: 'Bruma', kind: 'board', origin: 'Chorrol', sender: 'Dee', recipient: 'Dee', insured: 30, state: 'carried', hoursLeft: 30, gameHoursLeft: 30, mine: false, here: true }],
    broken: [{ id: 5, goods: '?', kinds: 1, pay: 10, dest: 'Skingrad', kind: 'board', origin: 'Bruma', sender: 'Eli', recipient: 'Eli', insured: 0, state: 'robbed', hoursLeft: 0, gameHoursLeft: 0, mine: false }],
    mine: [{ id: 6, goods: '3 Wheat', kinds: 1, pay: 25, dest: 'Cheydinhal', kind: 'board', origin: 'Bruma', sender: 'You', recipient: 'You', insured: 0, state: 'open', hoursLeft: 40, gameHoursLeft: 0, mine: true }] },
}, extra || {});

const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const P = (t) => t.root.dboPanel;
const rows = (t) => Object.keys(P(t).list.kids).filter((n) => /^r\d$/.test(n)).map((n) => P(t).list[n]);
const heads = (t) => Object.keys(P(t).list.kids).filter((n) => /^h\d$/.test(n)).map((n) => P(t).list[n].text);
const tabs = (t) => Object.keys(P(t).tabs.kids).filter((n) => /^t\d$/.test(n)).map((n) => P(t).tabs[n]);
const tab = (t, label) => tabs(t).find((b) => b.label.text.indexOf(label) === 0);
const R = (t) => P(t).right;

{
  const t = S.boot(MENU);
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(coop());
  check('the title and the four tabs, letters waiting counted (an unread one and a parcel)', P(t).title.text.text === 'Bruma Pigeon Coop' && tabs(t).map((b) => b.label.text).join('|') === 'Letters (2)|Send a pigeon|Supply orders|Couriers (1)', tabs(t).map((b) => b.label.text));
  check('the view the server asked for is lit', tab(t, 'Letters')._alpha === 100 && tab(t, 'Send')._alpha === 30);
  check('letters: each from whom, the waiting ones marked', rows(t).length === 3 && rows(t)[0].label.text === '• Ann' && rows(t)[1].label.text === '• Bob' && rows(t)[2].label.text === 'Cid' && /^Parcel/.test(rows(t)[1].sub.text), rows(t).map((r) => r.label.text));
  check('nothing chosen: the browser\'s prompt', R(t).empty.text === 'Choose a letter to read it.');
  check('the footer counts the waiting letters', P(t).foot.hint.text === '2 letters waiting.');
  rows(t)[0].onRelease();
  check('opening an unread letter reads it out and tells the server it was read', /^From Ann/.test(R(t).head.text) && R(t).body.text === 'Meet me at the gate.' && msgs(t, 'dbo:pigeonRead').length === 1 && msgs(t, 'dbo:pigeonRead')[0].args.join('|') === 'n1|l1');
  check('a letter without a parcel can be burned or its sender ignored', R(t).burn.label.text === 'Burn this letter' && R(t).ignore.label.text === 'Ignore this sender' && !R(t).collect);
  R(t).burn.onRelease();
  check('burning asks first: nothing is sent and the button asks', !msgs(t, 'dbo:pigeonDelete').length && R(t).burn.label.text === 'Burn it for good?');
  R(t).burn.onRelease();
  check('the second press burns it', msgs(t, 'dbo:pigeonDelete').length === 1 && msgs(t, 'dbo:pigeonDelete')[0].args.join('|') === 'n1|l1');
  R(t).ignore.onRelease();
  check('while the server answers, nothing more is sent', !msgs(t, 'dbo:pigeonBlockLetter').length);
  t.push(coop({ nonce: 'n2', letters: coop().letters.slice(1), result: 'The letter burns.', resultKind: 'sent' }));
  check('the answer (a new nonce) ends the wait; the burned letter is let go; the result in green', R(t).empty.text === 'Choose a letter to read it.' && P(t).tabs.result.text === 'The letter burns.' && P(t).tabs.result.textColor === 0x8FBF7F);
  rows(t)[0].onRelease();
  check('opening a read letter tells the server nothing', msgs(t, 'dbo:pigeonRead').length === 1);
  check('a letter with a parcel: what comes with it, and Collect', R(t).parcel.text === 'With it: 20 gold, 2 Iron Ingot' && R(t).collect.label.text === 'Collect the parcel' && !R(t).burn);
  R(t).collect.onRelease();
  check('an action greys the panel until the answer', R(t).ignore.disabled === true);
  R(t).ignore.onPick();
  check('even a direct call of a greyed action sends nothing while it waits', !msgs(t, 'dbo:pigeonBlockLetter').length);
  check('Collect sends pigeonCollect with the letter', msgs(t, 'dbo:pigeonCollect').length === 1 && msgs(t, 'dbo:pigeonCollect')[0].args.join('|') === 'n2|l2');
  t.push(coop({ nonce: 'n3', result: 'Your pigeon will not carry that.', resultKind: 'refused' }));
  R(t).ignore && R(t).ignore.onRelease();
  check('a refusal shows in red', P(t).tabs.result.textColor === 0xB23A3A);
}

{
  const t = S.boot(MENU);
  t.push(coop({ view: 'send' }));
  check('send: the contacts, in the land or away, with the price', rows(t).length === 2 && rows(t)[0].label.text === 'Bob #BOBB' && rows(t)[0].sub.text === 'In the land · 5 gold' && rows(t)[1].sub.text === 'Away · 6 gold');
  check('the first is chosen, and the footer gives the price', rows(t)[0]._alpha === 100 && P(t).foot.hint.text === 'A pigeon to Bob costs 5 gold. You carry 120 gold.');
  rows(t)[1].onRelease();
  check('choosing Eve: the letter is for her', R(t).who.text === 'A letter for Eve' && R(t).write.label.text === 'Write to Eve...' && rows(t)[1]._alpha === 100);
  R(t).write.onRelease();
  check('Write to Eve... hands the letter to the browser coop with her id', msgs(t, 'dbo:pigeonCompose').length === 1 && msgs(t, 'dbo:pigeonCompose')[0].args.join('|') === 'n1|send|12');
  R(t).write.onRelease();
  R(t).write.onPick();
  check('a second press while the server answers sends nothing more, nor a direct call', msgs(t, 'dbo:pigeonCompose').length === 1);
  check('and every button greys while it waits', R(t).write.disabled === true && R(t).signNone.disabled === true);
  t.st.time += 7000; t.tick();
  check('7 s with no answer: still waiting', R(t).write.disabled === true);
  t.st.time += 1500; t.tick();
  check('8 s with no answer (only a line in chat, no redraw): the wait lapses and the buttons come back', R(t).write.disabled !== true && R(t).signNone.disabled !== true);
  R(t).write.onRelease();
  check('and they work again', msgs(t, 'dbo:pigeonCompose').length === 2);
  const u = S.boot(MENU);
  u.push(coop({ view: 'send' }));
  u.root.dboPanel.right.signNone.onRelease();
  check('Unsigned sends pigeonSign unsigned', msgs(u, 'dbo:pigeonSign').length === 1 && msgs(u, 'dbo:pigeonSign')[0].args.join('|') === 'n1|unsigned');
  u.push(coop({ view: 'send', nonce: 'n2' }));
  P(u).right.signOwn.onRelease();
  check('Your name sends pigeonSign clear', msgs(u, 'dbo:pigeonSign').pop().args.join('|') === 'n2|clear');
  const w = S.boot(MENU);
  w.push(coop({ view: 'send', cooldownMinutes: 12 }));
  check('rows are drawn at 22, as STYLE asks for a list row', P(w).list.r0.label.fmt.size === 22);
  P(w).right.signOther.onRelease();
  check('Another name... opens the letter composer even while the pigeon is out, as the browser allows', msgs(w, 'dbo:pigeonCompose').length === 1 && msgs(w, 'dbo:pigeonCompose')[0].args.join('|') === 'n1|send|11');
  w.push(coop({ view: 'send', cooldownMinutes: 12, nonce: 'n2' }));
  check('a pigeon still out: greyed, says so, and the footer gives the minutes', P(w).right.write.label.text === 'Pigeon is out' && P(w).right.write.disabled === true && P(w).foot.hint.text === 'Your pigeon is still out. The next one can fly in 12 min.');
  const before = msgs(w, 'dbo:pigeonCompose').length;
  P(w).right.write.onRelease();
  check('and sends nothing', msgs(w, 'dbo:pigeonCompose').length === before);
  const x = S.boot(MENU);
  x.push(coop({ view: 'send', contacts: [] }));
  check('no contacts: the browser\'s words, and nobody to write to', /only knows the way to people you have met/.test(P(x).list.empty.text) && P(x).right.write.label.text === 'Choose someone' && P(x).right.write.disabled === true);
}

{
  const t = S.boot(MENU);
  t.push(coop({ view: 'supply' }));
  check('supply: your orders, then the board\'s, under their headings', heads(t)[0] === 'Your orders (1 of 3)' && heads(t)[1] === 'On the Bruma boards' && rows(t).map((r) => r.label.text).join('|') === '10 Wheat|4 Iron Ore', heads(t).concat(rows(t).map((r) => r.label.text)));
  check('each with its price and time, and who posted another\'s', rows(t)[1].sub.text === '10 gold each · 10 h left · Ann', rows(t)[1].sub.text);
  check('nothing chosen: post an order (in the browser)', R(t).head.text === 'Post a supply order' && R(t).post.label.text === 'Post an order...');
  R(t).post.onRelease();
  check('Post an order... hands the supply composer over', msgs(t, 'dbo:pigeonCompose').pop().args.join('|') === 'n1|supply|0');
  const u = S.boot(MENU);
  u.push(coop({ view: 'supply' }));
  rows(u)[1].onRelease();
  check('another\'s order: what it wants, and Hand over as many as you carry and it still wants (3)', R(u).head.text === '5 Iron Ore, 1 brought' && R(u).carry.text === 'You carry 3' && R(u).deliver.label.text === 'Hand over 3');
  R(u).more.onRelease();
  check('+ goes no higher than you carry', R(u).deliver.label.text === 'Hand over 3' && R(u).more.disabled === true);
  R(u).less.onRelease(); R(u).less.onRelease(); R(u).less.onRelease();
  check('- goes no lower than one', R(u).deliver.label.text === 'Hand over 1' && R(u).less.disabled === true);
  R(u).more.onRelease();
  R(u).deliver.onRelease();
  check('Hand over 2 sends supplyDeliver with the order and the count', msgs(u, 'dbo:supplyDeliver').length === 1 && msgs(u, 'dbo:supplyDeliver')[0].args.join('|') === 'n1|7|2');
  const v = S.boot(MENU);
  v.push(coop({ view: 'supply' }));
  rows(v)[0].onRelease();
  check('your own open order: Take it down, and what comes back', R(v).cancel.label.text === 'Take it down' && /fee does not/.test(R(v).cancelHint.text));
  R(v).cancel.onRelease();
  check('taking it down asks first', !msgs(v, 'dbo:supplyCancel').length && R(v).cancel.label.text === 'Take it down for good?');
  R(v).cancel.onRelease();
  check('the second press takes it down', msgs(v, 'dbo:supplyCancel').length === 1 && msgs(v, 'dbo:supplyCancel')[0].args.join('|') === 'n1|9');
  const w = S.boot(MENU);
  w.push(coop({ view: 'supply', supply: Object.assign({}, coop().supply, { orders: [Object.assign({}, coop().supply.orders[0], { have: 0 })] }) }));
  rows(w)[1].onRelease();
  check('carrying none of it: Hand over is greyed', R(w).deliver.disabled === true);
  R(w).back.onRelease();
  check('Post an order instead goes back to the form', R(w).head.text === 'Post a supply order');
}

{
  const t = S.boot(MENU);
  t.push(coop({ view: 'courier' }));
  check('couriers: the rank and its line, what you carry, the broken, the wanted', heads(t)[0] === 'Novice courier \u00b7 1 delivery \u00b7 Runner at 5' && heads(t)[1] === 'Bring five parcels to become a Runner.' && heads(t)[2] === 'You carry (1 of 2)' && heads(t)[3] === 'Broken parcels' && heads(t)[4] === 'Wanted at Bruma', heads(t));
  check('the jobs by pay and destination, with their state', rows(t)[0].label.text === '60 gold · Bruma' && rows(t)[0].sub.text === '1 d 6 h left · insured · deliver here' && rows(t)[1].sub.text === 'Robbed' && rows(t)[2].sub.text === '20 h on the board', rows(t).map((r) => r.sub.text));
  rows(t)[0].onRelease();
  check('a parcel for here: Deliver it here', R(t).deliver.label.text === 'Deliver it here');
  R(t).deliver.onRelease();
  check('Deliver sends courierDeliver', msgs(t, 'dbo:courierDeliver').pop().args.join('|') === 'n1|4');
  const u = S.boot(MENU);
  u.push(coop({ view: 'courier' }));
  rows(u)[1].onRelease();
  check('a broken parcel: unseen goods, Break it open', R(u).goods.text === 'A broken parcel. Open it to see what is inside.' && R(u).open.label.text === 'Break it open');
  R(u).open.onRelease();
  check('Break it open sends courierOpen', msgs(u, 'dbo:courierOpen').pop().args.join('|') === 'n1|5');
  const v = S.boot(MENU);
  v.push(coop({ view: 'courier' }));
  rows(v)[2].onRelease();
  check('a wanted job: Carry it for the courier\'s days', R(v).take.label.text === 'Carry it (3 days)');
  R(v).take.onRelease();
  check('Carry it sends courierTake', msgs(v, 'dbo:courierTake').pop().args.join('|') === 'n1|3');
  const w = S.boot(MENU);
  w.push(coop({ view: 'courier' }));
  check('nine entries page, and the Your parcels heading goes over with its row rather than end page 1', rows(w).length === 3 && heads(w).indexOf('Your parcels') < 0 && /Page 1 of 2/.test(P(w).list.more.text), heads(w));
  w.press(34);
  check('Page Down shows your parcels', heads(w)[0] === 'Your parcels' && rows(w)[0].label.text === '25 gold · Cheydinhal', heads(w).concat(rows(w).map((r) => r.label.text)));
  rows(w)[0].onRelease();
  R(w).cancel.onRelease();
  check('your posted job: taking it down asks first', !msgs(w, 'dbo:courierCancel').length && R(w).cancel.label.text === 'Take it down for good?');
  R(w).cancel.onRelease();
  check('then sends courierCancel', msgs(w, 'dbo:courierCancel').pop().args.join('|') === 'n1|6');
  // without the rank line the Your parcels heading would be the eighth line of page 1: it goes over with its row
  const z = S.boot(MENU);
  z.push(coop({ view: 'courier', courier: Object.assign({}, coop().courier, { rank: Object.assign({}, coop().courier.rank, { line: '' }) }) }));
  check('a heading never ends a page: page 1 stops before Your parcels', heads(z).indexOf('Your parcels') < 0 && rows(z).length === 3, heads(z));
  P(z).list.next.onRelease();
  check('page 2 opens with the heading and its row', heads(z)[0] === 'Your parcels' && rows(z)[0].label.text === '25 gold · Cheydinhal', heads(z).concat(rows(z).map((r) => r.label.text)));
  const x = S.boot(MENU);
  x.push(coop({ view: 'courier' }));
  check('nothing chosen: send a parcel (in the browser)', R(x).post.label.text === 'Send a parcel by courier...');
  R(x).post.onRelease();
  check('which hands the courier composer over', msgs(x, 'dbo:pigeonCompose').pop().args.join('|') === 'n1|courier|0');
  const y = S.boot(MENU);
  y.push(coop({ view: 'courier', courier: Object.assign({}, coop().courier, { enabled: false }) }));
  check('couriers off here: the browser\'s words', R(y).off.text === 'No courier takes work here yet.' && P(y).foot.hint.text === 'No courier takes work here yet.');
}

{
  const t = S.boot(MENU);
  t.push(coop({ view: 'supply', supply: undefined, courier: undefined }));
  check('a view this board does not have falls back to the letters, and its tab is not drawn', tab(t, 'Letters')._alpha === 100 && tabs(t).length === 2);
  t.press(39);
  check('Right goes to the next tab', tab(t, 'Send')._alpha === 100 && t.sounds.includes('PlaySound:UIMenuPrevNext'));
  t.press(39);
  check('and wraps', tab(t, 'Letters')._alpha === 100);
  t.press(37);
  check('Left goes back, wrapping', tab(t, 'Send')._alpha === 100);
  tab(t, 'Letters').onRelease();
  check('a tab click goes there', tab(t, 'Letters')._alpha === 100);
  const many = [];
  for (let i = 0; i < 11; i++) many.push({ id: 'm' + i, from: 'Sender ' + i, text: 'x', at: 0, read: true });
  t.push(coop({ nonce: 'n2', view: 'letters', letters: many }));
  check('a long list pages eight at a time', rows(t).length === 8 && /Page 1 of 2/.test(P(t).list.more.text));
  check('on the first page Previous is greyed, Next is not', P(t).list.prev.disabled === true && P(t).list.next.disabled !== true && P(t).list.more.text === 'Page 1 of 2');
  P(t).list.next.onRelease();
  check('Next (the mouse alone) shows the rest', rows(t).length === 3 && rows(t)[0].label.text === 'Sender 8' && P(t).list.next.disabled === true);
  P(t).list.prev.onRelease();
  check('Previous comes back', rows(t)[0].label.text === 'Sender 0');
  t.wheel(-1);
  check('the wheel down turns to the next page', rows(t)[0].label.text === 'Sender 8');
  t.wheel(1);
  check('the wheel up turns back', rows(t)[0].label.text === 'Sender 0');
  t.wheel(1);
  check('and no further than the first', rows(t)[0].label.text === 'Sender 0');
  t.press(34);
  check('Page Down shows the rest', rows(t).length === 3 && rows(t)[0].label.text === 'Sender 8');
  t.press(33);
  check('Page Up comes back', rows(t)[0].label.text === 'Sender 0');
  for (let i = 0; i < 5; i++) t.press(40);
  t.press(13);
  check('five Downs and Enter: the focus order runs the four tabs, then the rows; this opens the first letter', /^From Sender 0/.test(R(t).head.text));
  P(t).foot.close.onRelease();
  check('Close sends pigeonClose with the nonce, then closes', msgs(t, 'dbo:pigeonClose').length === 1 && msgs(t, 'dbo:pigeonClose')[0].args.join('|') === 'n2' && t.closed() && t.sounds.includes('PlaySound:UIMenuCancel'));
  const u = S.boot(MENU);
  u.push(coop());
  u.press(9);
  check('Tab does nothing', !msgs(u, 'dbo:pigeonClose').length);
  u.press(27);
  check('Escape closes as Close does', msgs(u, 'dbo:pigeonClose').length === 1 && u.closed());
  const l = S.boot(MENU, true);
  l.tick(); l.st.time += 8000; l.tick();
  check('without skse nothing is sent', l.sent.length === 0);
  l.arrive(); l.tick();
  check('once skse appears: ready, then the self-close for the missing payload', l.msgs()[0].key === 'ready' && l.closed());
  const v = S.boot(MENU);
  v.push({ type: 'labour', nonce: 'x' });
  check('a payload of another type is logged, not drawn', v.logs.some((x) => x.indexOf('unreadable payload') >= 0) && !P(v).list);
}

T.done();
