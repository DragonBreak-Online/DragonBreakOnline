// The courier's hand-over panel (skymp5-front features/courierHandover, widget 81; server couriers.js): the recipient's
// Take it / To my mailbox prompt, and the courier's drop-point hand-in. run-all bundles it from $FORK; by hand:
//
//   node tests/courier-handover-front-harness.js <bundle of skymp5-front/src/features/courierHandover/index.tsx>
'use strict';
const fs = require('fs');

const bundle = process.argv[2];
if (!bundle) { console.log('usage: node tests/courier-handover-front-harness.js <bundle>'); process.exit(2); }
if (!/dbo:courierAnswer/.test(fs.readFileSync(bundle, 'utf8'))) {
  require('./expect')('courier-handover-front', 'this front has no courier hand-over panel');
  console.log('ok   skipped: this front predates the courier hand-over panel');
  process.exit(0);
}
const { Widget, renderToStaticMarkup, createElement } = require(bundle);
let failures = 0;
const check = (label, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!ok) failures++; };
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const render = (data) => text(renderToStaticMarkup(createElement(Widget, { data })));

let t = render({ id: 81, mode: 'person', nonce: 'a-b-1', from: 'Kor', sender: 'Sela', goods: '2x Steel Sword', seconds: 30 });
check('in person: who brings it, from whom, what', /Kor has a parcel for you/.test(t) && /Sent by Sela: 2x Steel Sword/.test(t), t);
check('...two answers and the countdown', /Take it/.test(t) && /To my mailbox/.test(t) && /30 s\. No answer sends it to your mailbox/.test(t), t);
t = render({ id: 81, mode: 'drop', nonce: 'a-d-1', place: 'Aleswell', jobs: [{ id: 3, goods: '2x Steel Sword', pay: 100, recipient: 'Rin', sender: 'Sela' }, { id: 4, goods: '5x Steel Ingot', pay: 20, recipient: 'Tav', sender: 'Sela' }] });
check('at a drop point: the place and one Hand in per parcel', /Aleswell/.test(t) && (t.match(/Hand in/g) || []).length === 3 && /For Rin, from Sela: 100 gold/.test(t) && /For Tav, from Sela: 20 gold/.test(t), t);
check('...and Not now', /Not now/.test(t), t);

console.log('');
console.log(failures ? `${failures} FAILURES` : 'all passed');
process.exit(failures ? 1 : 0);
