// Scripted test for keyring.js (the Key Ring panel, Nate 13 Oct): /keys opens the panel for a UI that has it and lists the
// ring in chat otherwise; a stale window's buttons do nothing; a gift opens the recipient's panel with the offer; an owner's
// cut and take-back go through __dboHousing; the X menu offers "Give a key" only with the ring on and a key on it.
//   node tests/keyring-harness.js
'use strict';
const path = require('path');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const A = 0xff000001, B = 0xff000002;
const ui = new Map(), cmds = new Map(), widgets = [], chat = [], audits = [], calls = [];
let ringOn = true;
const keys = { [A]: [{ name: 'Key to the Inn', place: 'Inn', opens: true }], [B]: [] };
let offer = null;
globalThis.__dboHousing = {
  keyRingOn: () => ringOn,
  ringView: (a) => ({ keys: keys[a] || [], near: [], owned: [], offer: a === B ? offer : null }),
  ringGive: (a, k, to) => { calls.push(['give', a, k, to]); offer = { from: 'Ana', key: k }; return ''; },
  ringAnswer: (a, yes) => { calls.push(['answer', a, yes]); offer = null; return ''; },
  ringCut: (a, ref, to) => { calls.push(['cut', a, ref, to]); return ref === 5 ? '' : 'That is not yours.'; },
  ringTakeBack: (a, ref, n) => { calls.push(['take', a, ref, n]); return ''; },
};
require(path.resolve(__dirname, '..', 'keyring.js'))({
  log: () => { }, personal: (a, t) => chat.push([a, t]), audit: (t) => audits.push(t), who: (a) => a.toString(16),
  openWidget: (a, w) => widgets.push([a, w]), closeWidget: (a, id) => widgets.push([a, { close: id }]),
  onUi: (ev, fn) => { const l = ui.get(ev) || []; l.push(fn); ui.set(ev, l); },
  registerChatCommand: (name, fn) => cmds.set(name, fn),
});
const fire = (ev, a, args) => (ui.get(ev) || []).forEach((h) => h(a, args || []));
const lastWidget = (a) => widgets.filter((w) => w[0] === a).slice(-1)[0];

cmds.get('keys')(A, '');
check('without the panel, /keys lists the ring in chat', chat.slice(-1)[0][1] === 'Key to the Inn (Inn)' && !widgets.length);
fire('uiCaps', A, ['bank', 'keyRing']); fire('uiCaps', B, ['keyRing']);
cmds.get('keys')(A, '');
const w = lastWidget(A)[1];
check('with it, /keys opens widget 91 with the ring', w.type === 'keyRing' && w.id === 91 && w.keys.length === 1 && !!w.nonce, w);
fire('keyRingGive', A, ['stale', 'Key to the Inn', B]);
check('a stale window does nothing', !calls.length);
fire('keyRingGive', A, [w.nonce, 'Key to the Inn', B]);
check('a gift goes to housing and is audited', calls[0][0] === 'give' && calls[0][3] === B && /offered "Key to the Inn"/.test(audits[0]), calls);
check('the recipient\'s panel opens with the offer', lastWidget(B)[1].offer.key === 'Key to the Inn');
check('the giver sees the result line', /You offer Key to the Inn/.test(lastWidget(A)[1].result));
fire('keyRingAnswer', B, [lastWidget(B)[1].nonce, true]);
check('accepting answers the offer and is audited', calls[1][0] === 'answer' && calls[1][2] === true && /accepted "Key to the Inn"/.test(audits[1]), audits);
const n = lastWidget(A)[1].nonce;
fire('keyRingCut', A, [n, 7, 0]);
check('a refused cut shows why', lastWidget(A)[1].result === 'That is not yours.' && lastWidget(A)[1].resultKind === 'refused');
fire('keyRingTake', A, [lastWidget(A)[1].nonce, 5, 'Key to the Inn No. 2']);
check('a take-back goes to housing', calls.slice(-1)[0][0] === 'take' && /no longer opens/.test(lastWidget(A)[1].result));
check('the X menu offers Give a key with a key on the ring', globalThis.__dboKeyRingEntries(A, B).length === 1 && globalThis.__dboKeyRingEntries(B, A).length === 0);
ringOn = false;
check('with the ring off, no X menu entry and /keys points to the inventory', globalThis.__dboKeyRingEntries(A, B).length === 0 && (cmds.get('keys')(A, ''), /inventory/.test(chat.slice(-1)[0][1])));
fire('keyRingClose', A, []);
check('close closes widget 91', lastWidget(A)[1].close === 91);

console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
