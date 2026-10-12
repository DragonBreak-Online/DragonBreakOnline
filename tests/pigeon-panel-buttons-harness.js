// The pigeon coop's own buttons for what was chat only (Nate, 12 Oct: panels over chat commands): Ignore this sender on a
// letter (/pigeonblock for whoever wrote it, never named), and Sign as for the next letter (/sign, its answer on the
// panel). Cuts the two handlers out of gamemode.js and runs them with stubs.
//   node tests/pigeon-panel-buttons-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const start = src.indexOf("onUi('pigeonBlockLetter'");
const end = src.indexOf("onUi('pigeonSend'");
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
if (start < 0 || end < start) { console.log('FAIL the pigeon panel handlers are gone from gamemode.js'); process.exit(1); }

const A = 0xff000101;
const props = new Map();
const mp = { get: (a, k) => props.get(`${a}|${k}`), set: (a, k, v) => props.set(`${a}|${k}`, v) };
const handlers = new Map();
const onUi = (ev, fn) => handlers.set(ev, fn);
const pigeonNonces = new Map([[A, 'n1']]);
const letters = [{ id: 'l1', from: 'Unsigned', fromProfile: 77, text: 'I know what you did.' }, { id: 'l2', from: 'A friend', fromProfile: 77, text: 'Again.' },
  { id: 'l3', from: 'Old post', text: 'no sender kept' }];
const lettersOf = () => letters;
let opened = null;
const openPigeonCoop = (a, text, kind, view) => { opened = { text, kind, view }; };
const ran = [];
globalThis.__dboRunCommand = (a, name, args, quiet) => {
  ran.push([name, args, quiet]);
  return name === 'sign' ? [/^Lord/.test(args) ? 'Forging another\'s hand takes a Scholar of tier 3. You can still send it unsigned.' : 'Your next letter will go unsigned.'] : null;
};
new Function('onUi', 'mp', 'pigeonNonces', 'lettersOf', 'openPigeonCoop', src.slice(start, end))(onUi, mp, pigeonNonces, lettersOf, openPigeonCoop);
const fire = (ev, args) => { opened = null; handlers.get(ev)(A, args); return opened; };

let r = fire('pigeonBlockLetter', ['n1', 'l1']);
ok(JSON.stringify(mp.get(A, 'private.pigeonBlock')) === '[77]' && r.kind === 'sent' && /will be ignored/.test(r.text) && !/77|Unsigned/.test(r.text),
  'Ignore this sender blocks whoever wrote the letter, without naming them', [mp.get(A, 'private.pigeonBlock'), r]);
r = fire('pigeonBlockLetter', ['n1', 'l2']);
ok(JSON.stringify(mp.get(A, 'private.pigeonBlock')) === '[]' && /let through again/.test(r.text), '...again lets them through (the same toggle as /pigeonblock)', r);
r = fire('pigeonBlockLetter', ['n1', 'l3']);
ok(r.kind === 'refused' && /no sender/.test(r.text), 'a letter that kept no sender cannot be used to block', r);
r = fire('pigeonBlockLetter', ['stale', 'l1']);
ok(r === null && JSON.stringify(mp.get(A, 'private.pigeonBlock')) === '[]', 'a stale nonce does nothing');

r = fire('pigeonSign', ['n1', 'unsigned']);
ok(JSON.stringify(ran[0]) === JSON.stringify(['sign', 'unsigned', true]) && r.kind === 'sent' && r.view === 'send' && /go unsigned/.test(r.text),
  'Sign as runs /sign quietly and shows its answer on the send page', [ran[0], r]);
r = fire('pigeonSign', ['n1', 'Lord Vaeric\nGoldenshaft']);
ok(ran[1][1] === 'Lord Vaeric Goldenshaft' && r.kind === 'refused', 'a refused signature is shown as refused, line breaks taken out', [ran[1], r]);
ok(fire('pigeonSign', ['stale', 'unsigned']) === null && ran.length === 2, 'a stale nonce signs nothing');

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
