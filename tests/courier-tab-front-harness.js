// The Courier tab of the pigeon coop window (skymp5-front features/pigeon, courier.tsx; server couriers.js, Nate 11 Oct):
// renders the real widget with React's static renderer for the payloads couriers.js view() sends. run-all bundles the
// widget from $FORK; by hand:
//
//   node tests/courier-tab-front-harness.js <bundle of skymp5-front/src/features/pigeon/index.tsx>
//
// A front from before the tab has nothing to test, which is said and not failed: couriers.enabled stays false until it ships.
'use strict';
const fs = require('fs');

const bundle = process.argv[2];
if (!bundle) { console.log('usage: node tests/courier-tab-front-harness.js <bundle>'); process.exit(2); }
if (!/dbo:courierPost/.test(fs.readFileSync(bundle, 'utf8'))) {
  require('./expect')('courier-tab-front', 'this front has no Courier tab');
  console.log('ok   skipped: this front predates the Courier tab');
  process.exit(0);
}
const { Widget, Courier, renderToStaticMarkup, createElement } = require(bundle);

let failures = 0;
const check = (label, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!ok) failures++; };
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const RULES = { feeShare: 0.1, minFee: 10, premiumRate: 0.1, maxStacks: 6, minPay: 1, maxPay: 50000, limitGameDays: 3, openDays: 7, maxCarried: 3, maxOpen: 3, maxPayoutsPerWeek: 2 };
const job = (over) => Object.assign({ id: 1, goods: '2x Steel Sword', kinds: 1, pay: 100, dest: 'Aleswell', kind: 'drop', origin: 'Bruma', sender: 'Sela #SELA', recipient: 'Rin #RIN', insured: 0, state: 'open', hoursLeft: 160, gameHoursLeft: 0, mine: false }, over);
const COURIER = {
  enabled: true, place: 'Bruma', placeId: 'bruma',
  destinations: [{ key: 'drop:aleswell', kind: 'drop', name: 'Aleswell', hint: 'at the door of the Aleswell Inn' }, { key: 'person', kind: 'person', name: 'The recipient, in person', hint: '' }],
  goods: [{ baseId: 0x12eb7, name: 'Steel Sword', count: 4, value: 45 }, { baseId: 0x5ace4, name: 'Steel Ingot', count: 10, value: 20 }],
  rules: RULES,
  open: [job({ id: 7, pay: 250, dest: 'Rin #RIN in person', kind: 'person' })],
  carrying: [job({ id: 3, state: 'carried', gameHoursLeft: 50, hoursLeft: 9 })],
  broken: [],
  mine: [job({ id: 9, mine: true, insured: 90 })],
};
const pigeon = (over) => Object.assign({ id: 30, nonce: 'n1', boardName: 'Bruma', contacts: [{ id: 5, name: 'Rin', tag: 'RIN', online: true, price: 5 }], gold: 500, cooldownMinutes: 0, maxText: 240, letters: [] }, over);
const render = (data) => text(renderToStaticMarkup(createElement(Widget, { data })));
const tab = (c, select) => text(renderToStaticMarkup(createElement(Courier, { c, nonce: 'n1', gold: 500, contacts: [{ id: 5, name: 'Rin', tag: 'RIN' }], busy: false, act: () => {}, select })));

let t = render(pigeon({}));
check('an older server sends no courier data: no Couriers tab', !/Couriers/.test(t), t);
t = render(pigeon({ courier: COURIER }));
check('with courier data the window has a Couriers tab, its badge counting the parcels carried', /Couriers 1/.test(t), t);
check('...and opens where the server says (Send a pigeon by default)', !/Send goods by courier/.test(t));
t = render(pigeon({ courier: COURIER, view: 'courier', result: 'Posted: a courier is wanted...', resultKind: 'sent' }));
check('view courier: the tab opens, the result line above it', /Send goods by courier/.test(t) && /Posted: a courier is wanted/.test(t), t);
check('the lists: carried (with game time left), wanted here, your own', /You carry \(1 of 3\)/.test(t) && /2 d 2 h left/.test(t) && /Wanted at Bruma/.test(t) && /250 gold · Rin #RIN in person/.test(t) && /Your parcels/.test(t) && /insured/.test(t), t);
check('the form: destinations, Yourself and the people met, the goods with counts', /Aleswell/.test(t) && /The recipient, in person/.test(t) && /Yourself/.test(t) && /Rin #RIN/.test(t) && /Steel Sword x4/.test(t) && /Steel Ingot x10/.test(t), t);
check('the rules line: fee, insurance, kinds and the days', /10% of the pay to post \(at least 10\)/.test(t) && /insurance 10% of the value/.test(t) && /Up to 6 kinds; the courier has 3 days/.test(t), t);
check('the post button waits for the goods', /Choose the goods/.test(t), t);
check('the footer says what couriers do', /Couriers carry goods for pay/.test(t), t);
// The courier's rank (couriers.js tiers, 12 Oct); a front or server without ranks shows none
t = tab(COURIER);
const ranked = /Novice courier/.test(t) || /Apprentice courier/.test(t);
if (/rank\?:|c\.rank/.test(String(Courier))) {
  t = tab(Object.assign({}, COURIER, { rank: { name: 'Apprentice', delivered: 7, carry: 2, maxValue: 0, boards: true, line: '2 parcels at once, jobs worth any amount, routes to other holds', next: { name: 'Journeyman', at: 15 } } }));
  check('the rank line: Apprentice, 7 deliveries, Journeyman at 15, and what the rank allows', /Apprentice courier · 7 deliveries · Journeyman at 15/.test(t) && /2 parcels at once, jobs worth any amount, routes to other holds/.test(t), t);
  check('...and no rank line when the server sends none', !ranked);
} else console.log('ok   skipped: this front shows no courier rank');
t = render(pigeon({ courier: Object.assign({}, COURIER, { enabled: false }), view: 'courier' }));
check('couriers off on the server: no form, a plain line', /No courier takes work here yet/.test(t) && !/Post the job/.test(t), t);

t = tab(COURIER, 7);
check('a job wanted here: Carry it, for 3 days', /Carry it \(3 days\)/.test(t) && /From Sela #SELA to Rin #RIN, posted at Bruma/.test(t), t);
t = tab(COURIER, 3);
check('a parcel carried to a drop point: where to hand it in, no Deliver button', /Hand it in at Aleswell/.test(t) && !/Deliver it here/.test(t), t);
t = tab(Object.assign({}, COURIER, { carrying: [job({ id: 4, state: 'carried', kind: 'board', dest: 'the Cheydinhal notice boards', here: true, gameHoursLeft: 10 })] }), 4);
check('a board parcel at its board: Deliver it here', /Deliver it here/.test(t), t);
t = tab(Object.assign({}, COURIER, { carrying: [job({ id: 4, state: 'carried', kind: 'person', dest: 'Rin #RIN in person', gameHoursLeft: 10 })] }), 4);
check('an in-person parcel: find them, X on them', /Find Rin #RIN and offer it to them \(X on them\)/.test(t), t);
t = tab(Object.assign({}, COURIER, { broken: [job({ id: 8, state: 'robbed' })] }), 8);
check('a broken parcel the robber holds: Break it open, the goods not shown', /Break it open/.test(t) && /A broken parcel/.test(t) && !/2x Steel Sword/.test(t), t);
t = tab(COURIER, 9);
check('your own open job: Take it down, the fee kept', /Take it down/.test(t) && /fee and the insurance do not/.test(t) && /insured for 90 gold/.test(t), t);

console.log('');
console.log(failures ? `${failures} FAILURES` : 'all passed');
process.exit(failures ? 1 : 0);
