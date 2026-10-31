// Runs the native business ledger (swf/dbo_ledger) on the stub stage with the widget server business.js publishes (widget 64),
// against the browser ledger's own rules (skymp5-front features/businessLedger): the public page and its shop, the staff's
// tabs, typed fields, one action in flight, the nonce on every event, the close confirm, Escape and Close.
//   node tests/native-ledger-harness.js
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
const press = (t, label) => { const b = btn(t, label); if (!b) throw new Error('no button ' + label + ' among ' + buttons(t).map((x) => x.label.text).join('|')); b.onRelease(); };
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const acts = (t) => msgs(t, 'dbo:bizLedger');
const lastAct = (t) => acts(t).slice(-1)[0];
const texts = (t) => { const out = []; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (typeof k.text === 'string' && visible(k)) out.push(k.text); if (k.kids) walk(k); } }; walk(P(t)); return out.join(' | '); };
const tabNames = (t) => Object.values(P(t).tabs.kids).map((b) => b.label.text);
const tab = (t, label) => Object.values(P(t).tabs.kids).find((b) => b.label.text === label).onRelease();
// the open typing box, wherever its row is
const boxOf = (t) => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.type === 'input' && visible(k)) f = k; if (k.kids) walk(k); } }; walk(P(t)); return f; };
const type = (t, text) => { boxOf(t).text = text; t.press(13); };
// the Type... button on the row whose label is this
const typeOn = (t, label) => { const r = buttons(t).find((b) => b.label.text === 'Type...' && b._parent.label && b._parent.label.text === label); if (!r) throw new Error('no field ' + label); r.onRelease(); };

const chests = [{ ref: 'ff1', price: 5, state: 'free', renter: '', until: 0 }, { ref: 'ff2', price: 8, state: 'rented', renter: 'Olaf', until: 1790000000000 }];
const pub = { type: 'businessLedger', id: 64, nonce: 'n1', role: 'customer', name: 'The Jerall View', ownerName: 'Lydia', hold: 'Bruma', taxPct: 10, rent: 20,
  minRent: 5, maxRent: 500, maxChestPrice: 200, chests, result: '', resultKind: '' };
const shop = { shopOpen: true, maxPerBuy: 5, shopItems: [{ key: 'k1', name: 'Iron Dagger', tags: ['improved'], price: 30, count: 3 }, { key: 'k2', name: 'Bread', tags: [], price: 2, count: 50 }] };
const staffFields = { staff: [{ profile: 7, name: 'Faendal' }], maxStaff: 2, maxNote: 300, owed: 120, week: 300, month: 1200,
  log: [{ at: 1790000000000, text: 'Olaf rented a bed for 20 gold.' }], notes: [{ at: 1790000000000, text: 'More bread.', by: 'Faendal' }],
  ledgerPlaced: true, armSeconds: 60, placeMode: true };
const own = Object.assign({}, pub, staffFields, { role: 'owner' });

// ---- the public page and the shop ----
{
  const t = S.boot('dbo_ledger');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(Object.assign({}, pub, shop));
  check('the title is the business, the line under it its keeper and hold', P(t).head.title.text === 'THE JERALL VIEW' && P(t).head.sub.text === 'Kept by Lydia  ·  Bruma');
  check('a customer gets no tabs', Object.keys(P(t).tabs.kids).length === 0);
  check('the public page: rent, tax, one free chest (the rented one not shown)', /20 gold/.test(texts(t)) && /10% of every rent/.test(texts(t)) && /5 gold a day/.test(texts(t)) && !/8 gold a day/.test(texts(t)), texts(t));
  check('the shop lists its goods with tags, stock and price', /Iron Dagger \(improved\)/.test(texts(t)) && /3 left  ·  30 gold each/.test(texts(t)));
  check('Buy starts at one: Buy: 30', !!btn(t, 'Buy: 30') && !!btn(t, 'Buy: 2'));
  const plus = () => btn(t, 'Buy: 30') ? btn(t, 'Buy: 30')._parent.btn1 : buttons(t).find((b) => /^Buy 3/.test(b.label.text))._parent.btn1;
  plus().onRelease();
  check('+ raises the count and the total: Buy 2: 60', !!btn(t, 'Buy 2: 60'));
  btn(t, 'Buy 2: 60')._parent.btn1.onRelease();
  check('...up to the stock', !!btn(t, 'Buy 3: 90') && btn(t, 'Buy 3: 90')._parent.btn1.disabled === true);
  check('- is greyed at one', btn(t, 'Buy: 2')._parent.btn0.disabled === true);
  const breadBuy = () => buttons(t).find((x) => x._parent.label && x._parent.label.text === 'Bread' && /^Buy/.test(x.label.text));
  for (let i = 0; i < 9; i++) breadBuy()._parent.btn1.onRelease();
  check('...and never past the most a buy takes (5)', !!btn(t, 'Buy 5: 10'));
  press(t, 'Buy 3: 90');
  const b = lastAct(t);
  check('Buy sends the nonce, buy, the key, the count and the price shown', b && b.args.join('|') === 'n1|buy|k1|3|30', b);
  press(t, 'Buy 5: 10');
  check('one action in flight: a second press sends nothing', acts(t).length === 1);
  t.push(Object.assign({}, pub, shop, { result: 'You buy 3 Iron Dagger.', resultKind: 'ok' }));
  check('the answer ends it, resets the counts and shows the result in green', !!btn(t, 'Buy: 30') && P(t).foot.result.text === 'You buy 3 Iron Dagger.' && P(t).foot.result.textColor === 0x7FBF7F);
  t.st.time += 9000;
  t.push(Object.assign({}, pub, shop, { shopOpen: false, result: 'The shop is shut.', resultKind: 'refused' }));
  check('a shut shop greys Buy; a refusal is red', btn(t, 'Buy: 30').disabled === true && P(t).foot.result.textColor === 0xB23A3A);
  const e = S.boot('dbo_ledger');
  e.push(Object.assign({}, pub, { chests: [] }));
  check('no shop and no free chests says so', !/For sale/i.test(texts(e)) && /No chests for rent just now\./.test(texts(e)));
}

// ---- the owner's tabs ----
{
  const t = S.boot('dbo_ledger');
  t.push(own);
  check('the owner gets Overview, Logbook, Ledger, Staff, Storage and The book', tabNames(t).join('|') === 'Overview|Logbook|Ledger|Staff|Storage|The book', tabNames(t));
  check('the overview: week, month, held for you', /300 gold/.test(texts(t)) && /1,200 gold/.test(texts(t)) && /120 gold/.test(texts(t)));
  press(t, 'Collect the takings');
  check('Collect sends collect with the nonce', lastAct(t).args.join('|') === 'n1|collect');
  t.push(own);
  check('Set the rent is greyed until a rent is typed', btn(t, 'Set the rent').disabled === true);
  typeOn(t, 'New rent');
  const f = boxOf(t);
  check('Type... opens a digits box, typing allowed', f && f.restrict === '0-9' && f.maxChars === 4 && held(t) === 1);
  t.press(40);
  check('arrow keys are typing while it is open', boxOf(t) === f);
  type(t, '45');
  check('Enter takes it and gives the keys back', held(t) === 0 && /45/.test(texts(t)) && btn(t, 'Set the rent').disabled !== true);
  press(t, 'Set the rent');
  check('Set the rent sends the number', lastAct(t).args[1] === 'rent' && lastAct(t).args[2] === 45, lastAct(t));
  t.push(Object.assign({}, own, { result: 'The rent is 45 gold.', resultKind: 'ok' }));
  check('a success clears what was typed', btn(t, 'Set the rent').disabled === true);
  typeOn(t, 'New rent');
  boxOf(t).text = '9';
  t.push(own);
  check('a payload keeps what is being typed, and takes no second count', boxOf(t) && boxOf(t).text === '9' && held(t) === 1);
  t.press(27);
  check('Escape leaves the box, not the panel', !boxOf(t) && !t.closed() && held(t) === 0 && lowest(t) === 0);

  tab(t, 'Logbook');
  check('the logbook lists notes with who wrote them', /Faendal:  More bread\./.test(texts(t)));
  typeOn(t, 'A note');
  check('the note box takes the server\'s length', boxOf(t).maxChars === 300 && boxOf(t).restrict === undefined);
  type(t, '   ');
  check('a blank note cannot be written', btn(t, 'Write').disabled === true);
  typeOn(t, 'A note'); type(t, 'Mead is low');
  press(t, 'Write');
  check('Write sends the note', lastAct(t).args.join('|') === 'n1|note|Mead is low');
  t.push(own);
  tab(t, 'Ledger');
  check('the ledger page lists the log', /Olaf rented a bed for 20 gold\./.test(texts(t)));

  tab(t, 'Staff');
  check('the staff page: the owner, then staff with Let go', /Owner/.test(texts(t)) && !!btn(t, 'Let go'));
  press(t, 'Let go');
  check('Let go sends staffRemove with the profile', lastAct(t).args.join('|') === 'n1|staffRemove|7');
  t.push(own);
  typeOn(t, 'Take someone on'); type(t, '  Olaf ');
  press(t, 'Take on');
  check('Take on sends the name trimmed', lastAct(t).args.join('|') === 'n1|staffAdd|Olaf');
  t.push(Object.assign({}, own, { staff: [{ profile: 7, name: 'Faendal' }, { profile: 8, name: 'Gerdur' }] }));
  typeOn(t, 'Take someone on'); type(t, 'Olaf');
  check('a full staff greys Take on', btn(t, 'Take on').disabled === true);

  tab(t, 'Storage');
  check('storage lists each chest and its state, the renter and when', /For rent/.test(texts(t)) && /Rented: Olaf until /.test(texts(t)));
  typeOn(t, 'A chest\'s price'); type(t, '12');
  press(t, 'Put a chest up');
  check('Put a chest up sends the price', lastAct(t).args.join('|') === 'n1|chest|12');
  t.push(own);
  press(t, 'Take a chest off the list');
  check('Take a chest off sends off', lastAct(t).args.join('|') === 'n1|chest|off');
  t.push(own);

  tab(t, 'The book');
  check('the book: both ways to move it', !!btn(t, 'Move it like the Place tool') && !!btn(t, 'Move it in front of me'));
  press(t, 'Further');
  check('a nudge sends its direction and the step (5 by default)', lastAct(t).args.join('|') === 'n1|nudge|away|5');
  t.push(own);
  press(t, 'Step: Large');
  press(t, 'Turn left');
  check('the step chosen goes with the next nudge', lastAct(t).args.join('|') === 'n1|nudge|turnLeft|20');
  t.push(own);
  press(t, 'Move it like the Place tool');
  check('the Place tool sends placeMode', lastAct(t).args.join('|') === 'n1|placeMode');
  t.push(Object.assign({}, own, { ledgerPlaced: false }));
  check('unplaced: Place the ledger here, no pad', !!btn(t, 'Place the ledger here') && !btn(t, 'Further'));
  typeOn(t, 'Rename the business'); type(t, ' The Mead Hall ');
  press(t, 'Rename');
  check('Rename sends the name trimmed', lastAct(t).args.join('|') === 'n1|rename|The Mead Hall');
  t.push(own);
  press(t, 'Close the business');
  check('Close the business asks first and sends nothing', !!btn(t, 'Yes, close it') && lastAct(t).args[1] === 'rename');
  t.press(27);
  check('Escape takes the question back, not the panel', !btn(t, 'Yes, close it') && !t.closed());
  press(t, 'Close the business'); press(t, 'Keep it open');
  check('Keep it open takes it back too', !btn(t, 'Yes, close it') && lastAct(t).args[1] === 'rename');
  press(t, 'Close the business'); press(t, 'Yes, close it');
  check('Yes, close it sends close', lastAct(t).args.join('|') === 'n1|close');
}

// ---- staff and the shop tab ----
{
  const t = S.boot('dbo_ledger');
  const stock = { shopChest: true, shopEnabled: true, minPrice: 1, maxPrice: 100000, shopArmSeconds: 30,
    shopStock: [{ key: 'k1', name: 'Iron Dagger', tags: [], price: 30, count: 3, banned: '' }, { key: 'k3', name: 'Skooma', tags: [], price: 0, count: 2, banned: 'contraband' },
      { key: 'k4', name: 'Bread', tags: [], price: 0, count: 9, banned: '' }] };
  t.push(Object.assign({}, pub, staffFields, stock, { role: 'staff', owed: 0 }));
  check('staff get a Shop tab and no book', tabNames(t).join('|') === 'Overview|Logbook|Ledger|Staff|Storage|Shop', tabNames(t));
  check('staff see no takings held for the owner and no Collect', !btn(t, 'Collect the takings') && !/Held for you/.test(texts(t)));
  tab(t, 'Staff');
  check('staff cannot let go or take on', !btn(t, 'Let go') && !btn(t, 'Take on'));
  tab(t, 'Shop');
  check('the shop tab: the chest chosen, Choose another and Make it a plain chest', !!btn(t, 'Choose another') && !!btn(t, 'Make it a plain chest') && /30 seconds/.test(texts(t)));
  check('a banned kind says why and has no price box', /Not for sale: contraband/.test(texts(t)) && !buttons(t).some((b) => b._parent.label && b._parent.label.text === 'Skooma' && b.label.text === 'Type...'));
  check('priced goods have Off sale, unpriced ones none', !!buttons(t).find((b) => b.label.text === 'Off sale' && b._parent.label.text === 'Iron Dagger') && !buttons(t).find((b) => b.label.text === 'Off sale' && b._parent.label.text === 'Bread'));
  typeOn(t, 'Bread'); type(t, '3');
  buttons(t).find((b) => b.label.text === 'Set' && b._parent.label.text === 'Bread').onRelease();
  check('Set prices that kind', lastAct(t).args.join('|') === 'n1|shopPrice|k4|3');
  t.push(Object.assign({}, pub, staffFields, stock, { role: 'staff' }));
  buttons(t).find((b) => b.label.text === 'Off sale').onRelease();
  check('Off sale takes it off', lastAct(t).args.join('|') === 'n1|shopPrice|k1|off');
  t.push(Object.assign({}, pub, staffFields, stock, { role: 'staff', shopChest: false, shopEnabled: false }));
  check('no chest: Make a shop chest, greyed when shops are off', btn(t, 'Make a shop chest').disabled === true && !/In the shop chest/i.test(texts(t)));
}

// ---- paging, keys, leaving ----
{
  const t = S.boot('dbo_ledger');
  const log = [];
  for (let i = 0; i < 30; i++) log.push({ at: 1790000000000 + i, text: 'Entry ' + i });
  t.push(Object.assign({}, own, { log }));
  t.press(9); t.press(9);
  check('Tab cycles the tabs: Overview, Logbook, Ledger', /Entry 0/.test(texts(t)));
  check('a long log pages', /Page 1 of /.test(P(t).foot.pages.text));
  t.press(39);
  check('Right turns the page', /Page 2 of /.test(P(t).foot.pages.text));
  t.press(37);
  check('Left turns it back', /Page 1 of /.test(P(t).foot.pages.text));
  t.push(Object.assign({}, pub, { role: 'customer' }));
  check('a customer\'s payload while on a staff tab shows the public page', Object.keys(P(t).tabs.kids).length === 0 && /A bed for the night/.test(texts(t)));
  press(t, 'Close');
  check('Close sends bizLedgerClose and closes', msgs(t, 'dbo:bizLedgerClose').length === 1 && t.closed());
  const e = S.boot('dbo_ledger');
  e.push(own);
  e.press(27);
  check('Escape closes with bizLedgerClose', msgs(e, 'dbo:bizLedgerClose').length === 1 && e.closed());
  const x = S.boot('dbo_ledger');
  x.push(own);
  typeOn(x, 'New rent');
  press(x, 'Close');
  check('closing with a box open gives the keys back', held(x) === 0 && lowest(x) === 0);
  const g = S.boot('dbo_ledger');
  g.push(own);
  typeOn(g, 'New rent');
  g.push(Object.assign({}, pub, { role: 'customer' }));
  check('a box whose row is gone gives the keys back', held(g) === 0 && !boxOf(g));
  const nt = S.boot('dbo_ledger', false, { noTyping: true });
  nt.push(own);
  check('a game without typed input offers no Type...', !btn(nt, 'Type...'));
  const n = S.boot('dbo_ledger');
  n.push({ type: 'businessLedger', id: 64 });
  check('an unreadable payload draws nothing', !n.root.dboPanel.head);
  n.st.time += 8000; n.tick();
  check('...and with no payload the panel closes itself', n.closed());
}

T.done();
