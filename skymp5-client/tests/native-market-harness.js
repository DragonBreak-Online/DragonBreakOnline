// Runs the native property market (swf/dbo_market) on the stub stage with the widget server tenancy.js publishes (widget 82),
// against the browser market's own rules (skymp5-front features/propertyMarket): each state's figures and actions, the
// questions asked before buying, moving in, leaving and evicting, the officials' section, typed prices, one action in flight,
// every argument as text with the nonce, Escape and Close.
//   node tests/native-market-harness.js
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
const acts = (t) => msgs(t, 'dbo:propertyMarketAct');
const lastAct = (t) => acts(t).slice(-1)[0];
const texts = (t) => { const out = []; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (typeof k.text === 'string' && visible(k)) out.push(k.text); if (k.kids) walk(k); } }; walk(P(t)); return out.join(' | '); };
const boxOf = (t) => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.type === 'input' && visible(k)) f = k; if (k.kids) walk(k); } }; walk(P(t)); return f; };
const typeOn = (t, label, text) => { const r = buttons(t).find((b) => b.label.text === 'Type...' && b._parent.label && b._parent.label.text === label); if (!r) throw new Error('no field ' + label); r.onRelease(); boxOf(t).text = text; t.press(13); };

const base = { type: 'propertyMarket', id: 82, nonce: 'm1', name: 'Rose Hall', hold: 'Bruma', taxPct: 2, owned: false, ownerName: '', yours: false, manager: false, state: 'none',
  maxPrice: 1000000, maxDeposit: 50000, maxWeekly: 5000, result: '' };
const w = (o) => Object.assign({}, base, o);

// ---- for sale ----
{
  const t = S.boot('dbo_market');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(w({ state: 'sale', price: 12000, taxValue: 12000, weeklyTax: 240, listedValue: true }));
  check('the title is the house, the line under it the hold and For sale', P(t).head.title.text === 'ROSE HALL' && P(t).head.sub.text === 'Bruma  ·  For sale');
  check('no officials\' section for a buyer', !/For the hold's officials/i.test(texts(t)));
  check('the price, and the tax worked out on its listed value', /12,000 gold/.test(texts(t)) && /240 gold a week \(2% of 12,000, its listed value\)/.test(texts(t)), texts(t));
  press(t, 'Buy it for 12,000 gold');
  check('Buy asks first and sends nothing', !!btn(t, 'Yes') && acts(t).length === 0 && /Pay 12,000 gold for Rose Hall\?/.test(texts(t)));
  t.push(w({ state: 'sale', price: 12000 }));
  check('a re-sent panel ends the question it asked', !btn(t, 'Yes'));
  press(t, 'Buy it for 12,000 gold');
  t.press(27);
  check('Escape takes the question back, not the panel', !btn(t, 'Yes') && !t.closed());
  press(t, 'Buy it for 12,000 gold'); press(t, 'No');
  check('No takes it back too', !btn(t, 'Yes') && acts(t).length === 0);
  press(t, 'Buy it for 12,000 gold'); press(t, 'Yes');
  check('Yes sends buy with the nonce', lastAct(t).args.join('|') === 'm1|buy');
  check('one action in flight: the question cannot be asked again', btn(t, 'Buy it for 12,000 gold').disabled === true);
  t.push(w({ state: 'sale', price: 12000, result: 'You cannot afford it.' }));
  check('the answer ends it and shows the result', btn(t, 'Buy it for 12,000 gold').disabled !== true && P(t).foot.result.text === 'You cannot afford it.');
  check('without the tax figures the tax is a rate', /2% of its value a week/.test(texts(t)));
  t.push(w({ state: 'sale', price: 12000, citizenNeeded: 'Only citizens of Bruma may buy here.' }));
  check('a non-citizen is told why and gets no Buy', /Only citizens of Bruma may buy here\./.test(texts(t)) && !btn(t, 'Buy it for 12,000 gold'));
}

// ---- resale ----
{
  const t = S.boot('dbo_market');
  t.push(w({ state: 'resale', price: 9000, sellerName: 'Olaf', owned: true, ownerName: 'Olaf' }));
  check('a resale names its seller', P(t).head.sub.text === 'Bruma  ·  For sale by Olaf');
  press(t, 'Buy it for 9,000 gold');
  check('its question names who is paid', /Pay Olaf 9,000 gold for Rose Hall\?/.test(texts(t)));
  press(t, 'Yes');
  check('...and Yes buys', lastAct(t).args.join('|') === 'm1|buy');
  const y = S.boot('dbo_market');
  y.push(w({ state: 'resale', price: 9000, owned: true, yours: true, ownerName: 'You', yourSale: true, canResell: true }));
  check('your own sale: For sale by you, Take it off the market, Change your price', y.root.dboPanel.head.sub.text === 'Bruma  ·  For sale by you' && !!btn(y, 'Take it off the market') && !!btn(y, 'Change the price') && !btn(y, 'Buy it for 9,000 gold'));
  press(y, 'Take it off the market');
  check('Take it off sends unresell', lastAct(y).args.join('|') === 'm1|unresell');
  y.push(w({ state: 'resale', price: 9000, owned: true, yours: true, yourSale: true, canResell: true }));
  check('Change the price is greyed until one is typed', btn(y, 'Change the price').disabled === true);
  btn(y, 'Change the price')._parent.type.onRelease();
  check('the price box takes digits only, up to seven', boxOf(y).restrict === '0-9' && boxOf(y).maxChars === 7 && held(y) === 1);
  boxOf(y).text = '15,000'; y.press(13);
  check('Enter takes it, gives the keys back', held(y) === 0 && /15,000/.test(texts(y)));
  press(y, 'Change the price');
  check('...and the price goes as text', lastAct(y).args.join('|') === 'm1|resell|15000');
  const o = S.boot('dbo_market');
  o.push(w({ state: 'none', owned: true, yours: true, ownerName: 'You', canResell: true }));
  check('yours and not for sale: Yours, This property is yours, Put up for sale', o.root.dboPanel.head.sub.text === 'Bruma  ·  Yours' && /This property is yours\./.test(texts(o)) && !!btn(o, 'Put up for sale'));
}

// ---- for rent, let ----
{
  const t = S.boot('dbo_market');
  t.push(w({ state: 'rent', deposit: 500, weekly: 100, asked: 2 }));
  check('for rent: deposit and rent, and how many asked', /500 gold/.test(texts(t)) && /100 gold a week/.test(texts(t)) && /2 people have asked for it\./.test(texts(t)));
  press(t, 'Ask to rent it');
  check('Ask to rent it sends interest', lastAct(t).args.join('|') === 'm1|interest');
  t.push(w({ state: 'rent', deposit: 500, weekly: 100, asked: 1, youAsked: true }));
  check('once asked: your name is down, no button', /Your name is down/.test(texts(t)) && !btn(t, 'Ask to rent it'));
  t.push(w({ state: 'rent', deposit: 500, weekly: 100, offeredToYou: true }));
  press(t, 'Move in for 600 gold');
  check('offered: Move in for deposit plus a week asks first', /Pay 600 gold and move in\?/.test(texts(t)) && acts(t).length === 1);
  press(t, 'Yes');
  check('...and Yes accepts', lastAct(t).args.join('|') === 'm1|accept');
  t.push(w({ state: 'let', weekly: 100, youRent: true, paidUntil: '3 Nov', overdue: true }));
  check('your tenancy: Rented by you, paid until, overdue in red', P(t).head.sub.text === 'Bruma  ·  Rented by you' && /3 Nov  ·  overdue/.test(texts(t)));
  check('pay starts at a week, - greyed', btn(t, 'Pay 100 gold') && btn(t, '-').disabled === true);
  for (let i = 0; i < 10; i++) press(t, '+');
  check('+ stops at eight weeks', !!btn(t, 'Pay 800 gold') && btn(t, '+').disabled === true && /8 weeks/.test(texts(t)));
  press(t, '-');
  press(t, 'Pay 700 gold');
  check('Pay sends the weeks as text', lastAct(t).args.join('|') === 'm1|pay|7' && lastAct(t).args[2] === '7');
  t.push(w({ state: 'let', weekly: 100, youRent: true, paidUntil: '3 Nov' }));
  press(t, 'Hand back the keys');
  check('Hand back the keys asks first, in red', /Leave the house\?/.test(texts(t)) && btn(t, 'Yes').label.textColor === 0xB23A3A && lastAct(t).args[1] === 'pay');
  press(t, 'Yes');
  check('...and Yes leaves', lastAct(t).args.join('|') === 'm1|leave');
}

// ---- the officials ----
{
  const t = S.boot('dbo_market');
  t.push(w({ manager: true }));
  check('an empty house: Sell it and Rent it out, no plain note', /For the hold's officials/i.test(texts(t)) && !!btn(t, 'Put up for sale') && !!btn(t, 'Put up for rent') && !/neither for sale/.test(texts(t)));
  typeOn(t, 'Sell it', '20000');
  press(t, 'Put up for sale');
  check('Sell sends the price', lastAct(t).args.join('|') === 'm1|sell|20000');
  t.push(w({ manager: true }));
  typeOn(t, 'A week', '80');
  check('Put up for rent needs a deposit typed too (0 counts)', btn(t, 'Put up for rent').disabled === true);
  typeOn(t, 'Deposit', '0');
  press(t, 'Put up for rent');
  check('...and sends the deposit and the week', lastAct(t).args.join('|') === 'm1|list|0|80');
  t.push(w({ manager: true, state: 'rent', deposit: 0, weekly: 80, interest: [{ tag: 'AB12', name: 'Olaf' }, { tag: 'CD34', name: 'Gerdur' }], offeredTo: 'Gerdur' }));
  check('for rent: no Sell it, Change the terms, the people who asked', !btn(t, 'Put up for sale') && /Change the terms/.test(texts(t)) && /Offered/.test(texts(t)));
  press(t, 'Offer it');
  check('Offer it sends the tag', lastAct(t).args.join('|') === 'm1|offer|AB12');
  t.push(w({ manager: true, state: 'rent', deposit: 0, weekly: 80, interest: [] }));
  check('nobody yet says so', /Nobody yet\./.test(texts(t)));
  press(t, 'Take it off the market');
  check('Take it off the market sends unlist', lastAct(t).args.join('|') === 'm1|unlist');
  t.push(w({ manager: true, state: 'let', weekly: 80, tenantName: 'Olaf', owned: false }));
  check('let and not overdue: reminder and grace, no Evict', !!btn(t, 'Send a reminder') && !!btn(t, "A week's grace") && !btn(t, 'Evict') && !btn(t, 'Put up for sale'));
  press(t, "A week's grace");
  check('grace sends grace', lastAct(t).args.join('|') === 'm1|grace');
  t.push(w({ manager: true, state: 'let', weekly: 80, tenantName: 'Olaf', overdue: true }));
  press(t, 'Evict');
  check('overdue: Evict asks first', /Evict Olaf\? The hold keeps the deposit\./.test(texts(t)));
  press(t, 'Yes');
  check('...and Yes evicts', lastAct(t).args.join('|') === 'm1|evict');
  t.push(w({ manager: true, owned: true, ownerName: 'Olaf' }));
  check('an owned house: officials told only an empty one can be listed', /Olaf owns it\. Only an empty house/.test(texts(t)) && !btn(t, 'Put up for sale'));
}

// ---- keys, leaving ----
{
  const t = S.boot('dbo_market');
  t.push(w({ manager: true }));
  btn(t, 'Put up for sale')._parent.type.onRelease();
  boxOf(t).text = '5';
  t.push(w({ manager: true }));
  check('a payload keeps what is being typed and takes no second count', boxOf(t) && boxOf(t).text === '5' && held(t) === 1);
  t.press(40);
  check('arrow keys are typing while it is open', !!boxOf(t));
  t.press(27);
  check('Escape leaves the box, not the panel', !boxOf(t) && !t.closed() && held(t) === 0);
  btn(t, 'Put up for sale')._parent.type.onRelease();
  t.push(w({ manager: true, owned: true, ownerName: 'Olaf' }));
  check('a box whose row is gone gives the keys back', !boxOf(t) && held(t) === 0 && lowest(t) === 0);
  t.press(40);
  check('Down focuses the first control', t.ctx.focus === 0);
  press(t, 'Close');
  check('Close sends propertyMarketClose and closes', msgs(t, 'dbo:propertyMarketClose').length === 1 && t.closed());
  const e = S.boot('dbo_market');
  e.push(base);
  check('neither for sale nor for rent says so', /neither for sale nor for rent/.test(texts(e)) && e.root.dboPanel.head.sub.text === 'Bruma  ·  Empty');
  e.press(27);
  check('Escape closes with propertyMarketClose', msgs(e, 'dbo:propertyMarketClose').length === 1 && e.closed());
  const nt = S.boot('dbo_market', false, { noTyping: true });
  nt.push(w({ manager: true }));
  check('a game without typed input offers no Type...', !btn(nt, 'Type...'));
  const n = S.boot('dbo_market');
  n.push({ type: 'propertyMarket', id: 82 });
  check('an unreadable payload draws nothing', !n.root.dboPanel.head);
  n.st.time += 8000; n.tick();
  check('...and with no payload the panel closes itself', n.closed());
}

T.done();
