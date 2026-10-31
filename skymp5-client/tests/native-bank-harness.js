// Runs the native bank (swf/dbo_bank) on the stub stage with the widget server bank.js publishes (widget 48), against the
// browser bank's own rules (skymp5-front features/bank, vault.tsx): the account, a treasury, the vault rented or not, the
// amount stepper and typed box, one action in flight, the nonce on every event, Escape and Close.
//   node tests/native-bank-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const held = (t) => t.sent.reduce((n, m) => n + (m.e === 'allowTextInput' ? (m.on ? 1 : -1) : 0), 0);
const lowest = (t) => t.sent.reduce((s, m) => { if (m.e === 'allowTextInput') { s.n += m.on ? 1 : -1; s.min = Math.min(s.min, s.n); } return s; }, { n: 0, min: 0 }).min;

const P = (t) => t.root.dboPanel;
// Every button the player can see: a clip with a label whose page (if any) is the shown one
// anyPage: the flow's pages count as shown (a check about a row that may sit on page 2), else only the shown page's
let anyPage = false;
const visible = (c) => { for (let k = c; k; k = k._parent) if (k._visible === false && !(anyPage && k.pageNo !== undefined)) return false; return true; };
const buttons = (t) => { const out = []; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.label && k.onRelease && visible(k)) out.push(k); if (k.kids) walk(k); } }; walk(P(t)); return out; };
const btn = (t, label) => buttons(t).find((b) => b.label.text === label);
const btns = (t, label) => buttons(t).filter((b) => b.label.text === label);
const press = (t, label) => { const b = btn(t, label); if (!b) throw new Error('no button ' + label + ' among ' + buttons(t).map((x) => x.label.text).join('|')); b.onRelease(); };
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const texts = (t) => { const out = []; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (typeof k.text === 'string' && visible(k)) out.push(k.text); if (k.kids) walk(k); } }; walk(P(t)); return out.join(' | '); };

const base = { type: 'bank', id: 48, nonce: 'n1', where: 'Whiterun', balance: 1200, carried: 350, history: [{ at: 1790000000000, kind: 'deposit', amount: 200, where: '' }],
  treasuries: [], result: '', resultKind: '' };
const tiers = [{ id: 'strongbox', name: 'Strongbox', weight: 100, weekly: 100 }, { id: 'coffer', name: 'Coffer', weight: 250, weekly: 250 }, { id: 'vault', name: 'Vault', weight: 500, weekly: 500 }];

// ---- the account ----
{
  const t = S.boot('dbo_bank');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(base);
  check('the title names the town, the figures are the account and the purse', P(t).head.title.text === 'THE BANK OF WHITERUN' && /1,200 gold/.test(P(t).head.account.text) && /350 gold/.test(P(t).head.carried.text), [P(t).head.title.text, P(t).head.account.text]);
  check('no tabs with only the account', Object.keys(P(t).tabs.kids).length === 0);
  check('the amount starts at none, and Deposit and Withdraw are greyed', P(t).amount.value.text === 'None' && btn(t, 'Deposit').disabled === true && btn(t, 'Withdraw').disabled === true);
  check('the history is listed', /Deposited/.test(texts(t)) && /200 gold/.test(texts(t)), texts(t));
  press(t, '+100'); press(t, '+100'); press(t, '+1000'); press(t, '-100');
  check('the stepper sets the amount: 100 + 100 + 1000 - 100 = 1,100', P(t).amount.value.text === '1,100', P(t).amount.value.text);
  check('...more than you carry: Deposit stays greyed, Withdraw does not (1,200 in the account)', btn(t, 'Deposit').disabled === true && btn(t, 'Withdraw').disabled !== true);
  press(t, 'Withdraw');
  const w = msgs(t, 'dbo:bankWithdraw');
  check('Withdraw sends the nonce and the amount as text', w.length === 1 && w[0].args.join('|') === 'n1|1100', w);
  press(t, 'Withdraw everything');
  check('one action in flight: a second press before the answer sends nothing', msgs(t, 'dbo:bankWithdraw').length === 1);
  t.push(Object.assign({}, base, { balance: 100, carried: 1450, result: 'You withdraw 1,100 gold.', resultKind: 'ok' }));
  check('the answer ends it, clears the amount and shows the result in green', P(t).amount.value.text === 'None' && P(t).foot.result.text === 'You withdraw 1,100 gold.' && P(t).foot.result.textColor === 0x7FBF7F);
  press(t, 'Deposit all you carry');
  check('Deposit all you carry sends all', msgs(t, 'dbo:bankDeposit').slice(-1)[0].args.join('|') === 'n1|all');
  t.push(Object.assign({}, base, { result: 'You cannot.', resultKind: 'refused' }));
  check('a refusal shows red', P(t).foot.result.textColor === 0xB23A3A);
  t.st.time += 9000;
  press(t, '+1000'); press(t, '-1000'); press(t, '-1000');
  check('the amount never goes below none', P(t).amount.value.text === 'None');
  press(t, '+100');
  check('...and a step up from there starts at nothing, not below it', P(t).amount.value.text === '100', P(t).amount.value.text);
  press(t, '+1000'); press(t, '+100'); press(t, '+100');
  check('more than the account holds (1,300 > 1,200) greys Withdraw', btn(t, 'Withdraw').disabled === true, P(t).amount.value.text);
  press(t, '-1000'); press(t, '-100'); press(t, '-100'); press(t, '-100');
  // typing
  press(t, 'Type...');
  const box = P(t).amount.box;
  check('Type... opens a digits-only box with the keys taken', box && box.type === 'input' && box.restrict === '0-9' && box.maxChars === 9 && held(t) === 1 && t.ctx.Selection.focused === box);
  t.press(40);
  check('arrows are typing while the box is open', P(t).amount.box === box);
  box.text = '250';
  t.press(13);
  check('Enter takes the typed amount and gives the keys back', P(t).amount.value.text === '250' && held(t) === 0 && !P(t).amount.box, [P(t).amount.value.text, held(t)]);
  press(t, 'Type...'); P(t).amount.box.text = '75'; t.press(27);
  check('Escape leaves the box without changing the amount, keys back', P(t).amount.value.text === '250' && held(t) === 0 && !t.closed());
  press(t, 'Type...'); t.push(base);
  check('a re-publish while typing gives the keys back once', held(t) === 0 && lowest(t) >= 0, [held(t), lowest(t)]);
  press(t, 'Deposit');
  check('Deposit 250 (of 350 carried) goes', msgs(t, 'dbo:bankDeposit').slice(-1)[0].args.join('|') === 'n1|250');
  t.press(27);
  check('Escape closes the bank with dbo:bankClose', msgs(t, 'dbo:bankClose').length === 1 && t.closed());
}
{
  const t = S.boot('dbo_bank', false, { noTyping: true });
  t.push(base);
  check('a game that cannot type gets no Type... button, only the stepper', !btn(t, 'Type...') && btn(t, '+100'));
}

// ---- a treasury ----
{
  const t = S.boot('dbo_bank');
  t.push(Object.assign({}, base, { treasuries: [{ key: 'whiterun', name: 'Whiterun treasury', why: 'you are its Steward', balance: 5000 }] }));
  check('a treasury you answer for adds a tab', btn(t, 'Your account') && btn(t, 'Whiterun treasury'));
  press(t, 'Whiterun treasury');
  check('its tab shows its balance and why', /5,000 gold/.test(texts(t)) && /Steward/.test(texts(t)), texts(t));
  check('...Pay in greyed until an amount is set', btn(t, 'Pay in').disabled === true);
  press(t, '+100'); press(t, '+100'); press(t, '+100'); press(t, '+100');
  check('...and while it is more than you carry (400 > 350)', btn(t, 'Pay in').disabled === true);
  press(t, '-100'); press(t, '-100'); press(t, '-100'); press(t, '-100');
  press(t, '+100');
  press(t, 'Pay in');
  const p = msgs(t, 'dbo:bankTreasury');
  check('Pay in sends the nonce, the treasury key and the amount', p.length === 1 && p[0].args.join('|') === 'n1|whiterun|100', p);
  t.push(Object.assign({}, base, { treasuries: [] }));
  check('a treasury gone from the payload falls back to the account', btn(t, 'Deposit') && !btn(t, 'Pay in'));
}

// ---- the vault (its rows may run onto page 2: they are found on any page) ----
{
  anyPage = true;
  const t = S.boot('dbo_bank');
  const vault = { enabled: true, zone: 'whiterun', zoneName: 'Whiterun', tiers, rented: false, elsewhere: [{ zone: 'rift', name: 'the Rift', tier: 'coffer', items: 2, used: 30, owed: 0 }] };
  t.push(Object.assign({}, base, { vault }));
  press(t, 'Vault');
  check('not rented: the three tiers to rent, the other hold\'s vault named', btns(t, 'Rent').length === 3 && /Stored in the Rift/.test(texts(t)), texts(t));
  btns(t, 'Rent')[1].onRelease();
  check('Rent asks to confirm, with the price', btn(t, 'Pay') && /Rent a Coffer: 250 gold now/.test(texts(t)) && msgs(t, 'dbo:bankRent').length === 0);
  t.press(27);
  check('Escape cancels the confirmation, not the bank', !btn(t, 'Pay') && !t.closed());
  btns(t, 'Rent')[1].onRelease(); press(t, 'Pay');
  const r = msgs(t, 'dbo:bankRent');
  check('Pay rents that tier', r.length === 1 && r[0].args.join('|') === 'n1|coffer', r);
  const rented = Object.assign({}, vault, { rented: true, tier: 'coffer', cap: 250, used: 40, weekly: 250, paidUntil: 1790600000000, owed: 0,
    items: [{ row: 0, baseId: 0x5ace4, name: 'Iron Ingot', count: 10, weight: 1, special: false }, { row: 1, baseId: 0x3ad57, name: 'Chaurus Chitin', count: 3, weight: 1, special: true }],
    carry: [{ baseId: 0x5ace5, name: 'Steel Ingot', count: 20, weight: 1 }, { baseId: 0x6bc0a, name: 'Anvil', count: 1, weight: 300 }] });
  t.push(Object.assign({}, base, { vault: rented }));
  check('rented: the tier, the weight used and the fee', /Coffer in Whiterun/.test(texts(t)) && /40 \/ 250 weight/.test(texts(t)) && /250 gold a week/.test(texts(t)), texts(t));
  check('the amount reads All for the vault', P(t).amount.value.text === 'All');
  check('a Take per stored item, a special one starred', btns(t, 'Take').length === 2 && /Chaurus Chitin \*/.test(texts(t)));
  btns(t, 'Take')[0].onRelease();
  const tk = msgs(t, 'dbo:bankTake');
  check('Take with no amount takes all: nonce, row, base id, all', tk.length === 1 && tk[0].args.join('|') === `n1|0|${0x5ace4}|all`, tk);
  t.push(Object.assign({}, base, { vault: rented }));
  press(t, '+100');
  check('an amount over what is stored greys Take', btns(t, 'Take').every((b) => b.disabled === true));
  press(t, '-100');
  const stores = btns(t, 'Store');
  check('Store too heavy for the room left is greyed (the anvil, 300 > 210)', stores.length === 2 && stores[1].disabled === true && stores[0].disabled !== true);
  stores[0].onRelease();
  const st = msgs(t, 'dbo:bankStore');
  check('Store sends the nonce, the base id and all', st.length === 1 && st[0].args.join('|') === `n1|${0x5ace5}|all`, st);
  t.push(Object.assign({}, base, { vault: Object.assign({}, rented, { owed: 250, seizeAt: 1791000000000 }) }));
  check('owed: the debt in red with Pay, and Take greyed', btn(t, 'Pay') && btns(t, 'Take').every((b) => b.disabled === true) && /250 gold owed/.test(texts(t)));
  press(t, 'Pay');
  check('Pay pays the vault fee', msgs(t, 'dbo:bankVaultPay').length === 1 && msgs(t, 'dbo:bankVaultPay')[0].args.join('|') === 'n1');
  t.push(Object.assign({}, base, { vault: rented }));
  check('Give it up is greyed while goods are stored', btn(t, 'Give it up').disabled === true);
  t.push(Object.assign({}, base, { vault: Object.assign({}, rented, { items: [] }) }));
  press(t, 'Give it up');
  check('...and with none it gives the vault up', msgs(t, 'dbo:bankVaultEnd').length === 1);
  t.push(Object.assign({}, base, { vault: Object.assign({}, rented, { items: [] }) }));
  press(t, 'Vault (500, 500 gold)');
  check('changing tier asks to confirm too, with the change text', /Change to a Vault/.test(texts(t)) && btn(t, 'Pay'));
  press(t, 'Pay');
  check('...and Pay rents the new tier', msgs(t, 'dbo:bankRent').slice(-1)[0].args.join('|') === 'n1|vault');
  t.push(Object.assign({}, base, { vault: Object.assign({}, rented, { enabled: false }) }));
  check('vaults closed: the notice, Store greyed, Take still allowed', /vaults are closed/.test(texts(t)) && btns(t, 'Store').every((b) => b.disabled === true) && btns(t, 'Take').some((b) => b.disabled !== true));
  t.push(Object.assign({}, base, { vault: { enabled: true, zone: '', zoneName: '', tiers, rented: false, elsewhere: [] } }));
  check('a bank of no hold keeps no vaults', /keeps no vaults/.test(texts(t)));
}
// ---- pages ----
anyPage = false;
{
  const t = S.boot('dbo_bank');
  const many = Array.from({ length: 14 }, (_, i) => ({ row: i, baseId: 0x1000 + i, name: 'Item ' + i, count: 1, weight: 1, special: false }));
  t.push(Object.assign({}, base, { vault: { enabled: true, zone: 'whiterun', zoneName: 'Whiterun', tiers, rented: true, tier: 'coffer', cap: 250, used: 14, weekly: 250, paidUntil: 1790600000000, owed: 0, items: many, carry: [], elsewhere: [] } }));
  press(t, 'Vault');
  const first = btns(t, 'Take').length;
  check('a long vault is paged, with the page line', first > 0 && first < 14 && /Page 1 of/.test(P(t).foot.pages.text), [first, P(t).foot.pages.text]);
  t.press(39);
  check('Right shows the next page', /Page 2 of/.test(P(t).foot.pages.text) && btns(t, 'Take').length > 0);
  t.press(37);
  check('Left goes back', /Page 1 of/.test(P(t).foot.pages.text));
  press(t, 'Close');
  check('Close closes the bank with dbo:bankClose', msgs(t, 'dbo:bankClose').length === 1 && t.closed());
}
{
  const t = S.boot('dbo_bank');
  t.push({ nonsense: true });
  check('an unreadable payload draws nothing', !P(t).head);
  t.st.time += 9000; t.tick();
  check('...and with no payload in 8 s the menu closes', t.closed());
}
T.done();
