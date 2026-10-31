// The pigeon coop's composers as native forms (swf/dbo_pigeon + lib/dbo-form.as): a letter with its count, signing and a
// parcel of gold and goods; a supply order searched, chosen and priced; a courier job with its destination, recipient, goods,
// pay and insurance. Each sends the browser coop's own action; the browser composer is only the can't-type fallback.
//   node tests/native-pigeon-compose-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const held = (t) => t.sent.reduce((n, m) => n + (m.e === 'allowTextInput' ? (m.on ? 1 : -1) : 0), 0);
const lowest = (t) => t.sent.reduce((s, m) => { if (m.e === 'allowTextInput') { s.n += m.on ? 1 : -1; s.min = Math.min(s.min, s.n); } return s; }, { n: 0, min: 0 }).min;

const P = (t) => t.root.dboPanel;
const R = (t) => P(t).right;
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const last = (t, key) => msgs(t, key).slice(-1)[0];
const shownPage = (t) => Object.values(R(t).flowClip.kids).find((p) => p._visible);
const texts = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out.join('|'); };
const buttonsOf = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (x.kids && x.label && x.onPick) out.push(x); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out; };
const btn = (t, label) => buttonsOf(t).find((b) => b.label.text === label);
const turn = (t, d) => t.press(d < 0 ? 33 : 34);
const first = (t) => { for (let i = 0; i < 6; i++) turn(t, -1); };
const seek = (t, label, test) => { const ok = (b) => (test ? test(b) : b.label.text === label); let b = buttonsOf(t).find(ok); if (b) return b; first(t); for (let i = 0; i < 8 && !(b = buttonsOf(t).find(ok)); i++) turn(t, 1); return b; };
const press = (t, label) => { const b = seek(t, label); if (!b) throw new Error('no button ' + label + ' among ' + buttonsOf(t).map((x) => x.label.text).join('|')); b.onRelease(); };
const everyPage = (t) => { first(t); const out = []; for (let i = 0; i < 6; i++) { out.push(texts(t)); const before = texts(t); turn(t, 1); if (texts(t) === before) break; } return out.join('|'); };
const boxOf = (t) => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.type === 'input') f = k; if (k.kids) walk(k); } }; walk(shownPage(t)); return f; };
const field = (t, label) => seek(t, null, (b) => b.label.text === 'Type...' && b._parent.label && b._parent.label.text.indexOf(label) === 0);
const typeOn = (t, label, text) => { const r = field(t, label); if (!r) throw new Error('no field ' + label); r.onRelease(); boxOf(t).text = text; if (boxOf(t).multiline) press(t, 'Done'); else t.press(13); };

const coop = (extra) => Object.assign({
  type: 'pigeon', id: 34, nonce: 'n1', boardName: 'Bruma', gold: 120, cooldownMinutes: 0, maxText: 240, view: 'send', letters: [],
  contacts: [{ id: 11, name: 'Bob', tag: 'BOBB', online: true, price: 5 }, { id: 12, name: 'Eve', tag: 'EVEE', online: false, price: 6 }],
  parcel: { enabled: true, taxRate: 0.1, itemFee: 2, maxStacks: 2, maxGold: 1000 },
  sendable: [{ baseId: 0x5ace4, name: 'Iron Ingot', count: 5 }, { baseId: 0x5ace5, name: 'Steel Ingot', count: 2 }, { baseId: 0x6, name: 'Bread', count: 9 }],
}, extra || {});

// ---- a letter ----
{
  const t = S.boot('dbo_pigeon');
  t.push(coop());
  R(t).write.onRelease();
  check('Write to Bob... opens the letter here: the page with its count, signing, the parcel, the cost', !msgs(t, 'dbo:pigeonCompose').length && /A letter for Bob  \(0 \/ 240\)/.test(everyPage(t)) && /A pigeon to Bob costs 5 gold\. You carry 120 gold\./.test(everyPage(t)), everyPage(t));
  check('an empty letter cannot be sent', seek(t, 'Send the pigeon').disabled === true);
  field(t, 'A letter for Bob').onRelease();
  check('the letter is a box of several lines holding the coop\'s most', boxOf(t).multiline === true && boxOf(t).maxChars === 240 && held(t) === 1);
  boxOf(t).text = 'Meet me\rat the gate.'; boxOf(t).onChanged();
  check('the count follows what is typed', /A letter for Bob  \(20 \/ 240\)/.test(texts(t)), texts(t));
  t.press(13);
  check('Enter is a new line in a letter, the box stays', !!boxOf(t));
  press(t, 'Done');
  check('Done takes it and gives the keys back', held(t) === 0 && seek(t, 'Send the pigeon').disabled !== true);
  press(t, 'Send the pigeon');
  const s = last(t, 'dbo:pigeonSend');
  check('Send sends the recipient, the letter with its line, no gold and no goods', s && s.args.join('|') === 'n1|11|Meet me\nat the gate.|0|[]', s);
  check('...and the form goes', !R(t).flowClip);
  t.push(coop({ nonce: 'n2' }));
  P(t).list.r1.onRelease();
  R(t).write.onRelease();
  typeOn(t, 'Gold', '50');
  press(t, 'Iron Ingot x5');
  check('a good picked asks how many, 1 until typed', !!field(t, 'Iron Ingot, of 5'));
  press(t, 'Steel Ingot x2');
  check('no more kinds than the parcel takes', seek(t, 'Bread x9').disabled === true);
  check('...and the cost: flight, tax (10% of 50 + 2 a kind), the gold', /Flight 6, parcel tax 9, gold sent 50: 65 gold\. You carry 120\./.test(everyPage(t)), everyPage(t));
  typeOn(t, 'Steel Ingot, of 2', '3');
  check('more than you carry: Not that many', !!seek(t, 'Not that many') && seek(t, 'Not that many').disabled === true);
  typeOn(t, 'Steel Ingot, of 2', '2');
  check('a parcel with no words can be sent', seek(t, 'Send the pigeon').disabled !== true);
  press(t, 'Send the pigeon');
  const p = last(t, 'dbo:pigeonSend');
  check('...and sends Eve, the gold and the goods with their counts', p && p.args[1] === 12 && p.args[2] === '' && p.args[3] === 50 && JSON.stringify(JSON.parse(p.args[4])) === JSON.stringify([[0x5ace4, 1], [0x5ace5, 2]]), p);
  t.push(coop({ nonce: 'n3', gold: 10 }));
  R(t).write.onRelease();
  typeOn(t, 'Gold', '50');
  check('not enough gold: greyed and says so', !!seek(t, 'Not enough gold') && seek(t, 'Not enough gold').disabled === true);
  typeOn(t, 'Gold', '0'); typeOn(t, 'A letter for Eve', 'Hi');
  press(t, 'Sign with your name');
  check('signing from the letter sends pigeonSign and keeps the letter open', last(t, 'dbo:pigeonSign').args.join('|') === 'n3|clear' && !!R(t).flowClip);
  check('...and while the server answers, Send is greyed', seek(t, 'Send the pigeon').disabled === true);
  typeOn(t, 'Gold', '50');
  t.push(coop({ nonce: 'n4', gold: 10 }));
  check('a fresh coop from the server keeps the letter and what was typed', !!R(t).flowClip && /50/.test(everyPage(t)));
  t.push(coop({ nonce: 'n5', contacts: [{ id: 11, name: 'Bob', tag: 'BOBB', online: true, price: 5 }] }));
  check('the one written to is gone from the contacts: Choose someone, greyed', !!seek(t, 'Choose someone') && seek(t, 'Choose someone').disabled === true);
  first(t); turn(t, 1);
  check('a long letter turns to its second page', Object.values(R(t).flowClip.kids)[1] && Object.values(R(t).flowClip.kids)[1]._visible === true);
  t.press(27); R(t).write.onRelease();
  check('a form opened again starts on its first page', Object.values(R(t).flowClip.kids)[0]._visible === true);
  t.press(27);
  check('Escape closes the letter, not the coop', !R(t).flowClip && !t.closed() && !msgs(t, 'dbo:pigeonClose').length);
  P(t).tabs.letters && P(t).tabs.letters.onRelease && P(t).tabs.letters.onRelease();
}

// ---- signing as another name; the pigeon out; no parcel ----
{
  const t = S.boot('dbo_pigeon');
  t.push(coop({ cooldownMinutes: 12, parcel: { enabled: false } }));
  R(t).signOther.onRelease();
  check('Another name opens its form even while the pigeon is out', /Sign as another name/.test(texts(t)) && btn(t, 'Use it').disabled === true);
  typeOn(t, 'The name', 'A Friend');
  press(t, 'Use it');
  check('Use it sends pigeonSign with the name', last(t, 'dbo:pigeonSign').args.join('|') === 'n1|A Friend');
  const u = S.boot('dbo_pigeon');
  u.push(coop({ parcel: { enabled: false } }));
  u.root.dboPanel.right.write.onRelease();
  check('no parcels here: no gold or goods asked', !field(u, 'Gold') && !seek(u, 'Iron Ingot x5'));
  typeOn(u, 'A letter for Bob', 'Hello');
  u.push(coop({ nonce: 'n2', cooldownMinutes: 3, parcel: { enabled: false } }));
  check('the pigeon goes out meanwhile: Pigeon is out, greyed, with the minutes', !!seek(u, 'Pigeon is out') && seek(u, 'Pigeon is out').disabled === true && /fly in 3 min/.test(everyPage(u)));
}

// ---- a supply order ----
{
  const supply = { enabled: true, zone: 'Bruma', feeShare: 0.1, minFee: 5, maxCount: 50, maxOpen: 3, openDays: 3, search: '', results: [], orders: [], mine: [] };
  const t = S.boot('dbo_pigeon');
  t.push(coop({ view: 'supply', supply }));
  R(t).post.onRelease();
  check('Post an order: search first, nothing to choose yet', /Search for the item to order\./.test(everyPage(t)) && seek(t, 'Search').disabled === true);
  typeOn(t, 'Search for an item', 'i');
  check('one letter is not a search', seek(t, 'Search').disabled === true);
  typeOn(t, 'Search for an item', 'iron');
  press(t, 'Search');
  check('Search sends supplySearch and keeps the form', last(t, 'dbo:supplySearch').args.join('|') === 'n1|iron' && !!R(t).flowClip);
  t.push(coop({ view: 'supply', nonce: 'n2', supply: Object.assign({}, supply, { search: 'iron', results: [{ desc: 'Skyrim.esm:05ACE4', name: 'Iron Ingot' }, { desc: 'Skyrim.esm:071CF3', name: 'Iron Ore' }] }) }));
  check('the server\'s results come back into the open form as choices', !!seek(t, 'Iron Ingot') && !!seek(t, 'Iron Ore'));
  press(t, 'Iron Ore'); typeOn(t, 'How many', '10'); typeOn(t, 'The whole reward', '9');
  check('a reward under the count is refused', seek(t, 'Post order').disabled === true);
  typeOn(t, 'The whole reward', '200');
  check('a reward past the gold you carry (200 + 20 to post) is refused', seek(t, 'Post order').disabled === true && /Reward 200 and 20 to post: 220 gold\. You carry 120\./.test(everyPage(t)));
  typeOn(t, 'The whole reward', '115');
  check('...the posting fee counts too (115 + 12 > 120)', seek(t, 'Post order').disabled === true);
  typeOn(t, 'How many', '51'); typeOn(t, 'The whole reward', '60');
  check('more than the most an order takes is refused', seek(t, 'Post order').disabled === true);
  typeOn(t, 'How many', '10');
  press(t, 'Post order');
  check('Post order sends the item, the count and the reward', last(t, 'dbo:supplyPost').args.join('|') === 'n2|Skyrim.esm:071CF3|10|60');
}

// ---- a courier job ----
{
  const courier = { enabled: true, place: 'Bruma', placeId: 'bruma', open: [], carrying: [], broken: [], mine: [],
    destinations: [{ key: 'b:whiterun', kind: 'board', name: 'Whiterun', hint: 'at the Whiterun boards' }, { key: 'p', kind: 'person', name: 'In person', hint: '' }],
    goods: [{ baseId: 0x5ace4, name: 'Iron Ingot', count: 5, value: 7 }, { baseId: 0x5ace5, name: 'Steel Ingot', count: 2, value: 20 }],
    rules: { feeShare: 0.1, minFee: 5, premiumRate: 0.1, maxStacks: 2, minPay: 10, maxPay: 1000, limitGameDays: 3, openDays: 3, maxCarried: 2, maxOpen: 3, maxPayoutsPerWeek: 5 } };
  const t = S.boot('dbo_pigeon');
  t.push(coop({ view: 'courier', courier }));
  R(t).post.onRelease();
  check('Send goods by courier: where, who (Yourself first), the goods; Choose the goods until some are picked', /Where it goes/.test(everyPage(t)) && seek(t, 'Yourself')._alpha === 100 && !!seek(t, 'Choose the goods'));
  press(t, 'Whiterun');
  check('a destination says where the courier hands it in', /The courier hands it in at the Whiterun boards/.test(everyPage(t)));
  press(t, 'Iron Ingot x5'); typeOn(t, 'Iron Ingot, of 5', '4');
  typeOn(t, 'The courier\'s pay', '9');
  check('pay under the least is refused', seek(t, 'Post the job').disabled === true);
  typeOn(t, 'The courier\'s pay', '20');
  check('the goods\' worth shows for insurance (4 x 7 = 28)', !!field(t, 'Insure for (worth 28)'));
  typeOn(t, 'Insure for', '100');
  check('the cost: pay, posting and insurance held to the worth (10% of 28)', /Pay 20, 5 to post, 3 insurance: 28 gold\. You carry 120\./.test(everyPage(t)), everyPage(t));
  press(t, 'Post the job');
  const c = last(t, 'dbo:courierPost');
  check('Post the job sends where, to whom (yourself: 0), pay, insurance (held to the worth) and the goods', c && c.args[1] === 'b:whiterun' && c.args[2] === 0 && c.args[3] === 20 && c.args[4] === 28 && JSON.stringify(JSON.parse(c.args[5])) === JSON.stringify([[0x5ace4, 4]]), c);
  t.push(coop({ view: 'courier', nonce: 'n2', courier }));
  R(t).post.onRelease();
  press(t, 'In person');
  check('in person: not to yourself, the first contact chosen', !seek(t, 'Yourself') && seek(t, 'Bob #BOBB')._alpha === 100);
  press(t, 'Steel Ingot x2'); typeOn(t, 'The courier\'s pay', '15');
  press(t, 'Eve #EVEE');
  press(t, 'Post the job');
  check('...and sends that person', last(t, 'dbo:courierPost').args[2] === 12);
  const off = S.boot('dbo_pigeon');
  off.push(coop({ view: 'courier', courier: Object.assign({}, courier, { goods: [] }) }));
  off.root.dboPanel.right.post.onRelease();
  check('nothing to carry says so', /You carry nothing a courier can take\./.test(everyPage(off)));
}

// ---- no typing; leaving ----
{
  const t = S.boot('dbo_pigeon', false, { noTyping: true });
  t.push(coop());
  R(t).write.onRelease();
  check('a game that cannot type: no Type..., the browser coop offered', !field(t, 'A letter') && !!seek(t, 'In the browser...') && /the browser coop has this form/.test(everyPage(t)));
  press(t, 'In the browser...');
  check('...which hands the letter to it as before', last(t, 'dbo:pigeonCompose').args.join('|') === 'n1|send|11');
  const x = S.boot('dbo_pigeon');
  x.push(coop());
  x.root.dboPanel.right.write.onRelease();
  field(x, 'A letter for Bob').onRelease();
  x.root.dboPanel.foot.close.onRelease();
  check('closing the coop with a box open gives the keys back', held(x) === 0 && lowest(x) === 0 && msgs(x, 'dbo:pigeonClose').length === 1);
  const y = S.boot('dbo_pigeon');
  y.push(coop({ supply: { enabled: true, zone: 'B', feeShare: 0.1, minFee: 5, maxCount: 50, maxOpen: 3, openDays: 3, search: '', results: [], orders: [], mine: [] } }));
  y.root.dboPanel.right.write.onRelease();
  field(y, 'A letter for Bob').onRelease();
  y.press(27); y.press(39);
  check('changing tab closes a letter and gives the keys back', held(y) === 0 && !y.root.dboPanel.right.flowClip);
}

T.done();
