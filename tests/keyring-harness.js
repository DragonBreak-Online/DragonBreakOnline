// Scripted test for keyring.js (the Key Ring panel, Nate 13 Oct): without the panel (client 0.3.95) /keys and "Give a key"
// open contextMenu widgets whose rows give, accept, cut and take back, and a row the server never sent does nothing; with it
// /keys opens the panel; a stale window's buttons do nothing; a gift opens the recipient's panel with the offer; an owner's
// cut and take-back go through __dboHousing; the X menu offers "Give a key" only with the ring on and a key on it.
//   node tests/keyring-harness.js
'use strict';
const path = require('path');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const A = 0xff000001, B = 0xff000002;
const ui = new Map(), cmds = new Map(), widgets = [], chat = [], audits = [], calls = [];
let ringOn = true;
const INN = { name: 'Key to the Inn', place: 'Inn', opens: true };
const keys = { [A]: [INN], [B]: [] };
let offer = null;
// Like housingSystem: a gift is refused for a key not on the giver's ring; accepting moves it
globalThis.__dboHousing = {
  keyRingOn: () => ringOn,
  ringView: (a) => ({
    keys: keys[a] || [], near: [{ actor: a === A ? B : A, name: a === A ? 'Bo' : 'Ana' }],
    owned: a === A ? [{ ref: 5, place: 'Inn', copies: [{ name: 'Key to the Inn No. 2', holder: 'Bo' }] }] : [],
    offer: a === B ? offer : null,
  }),
  ringGive: (a, k, to) => {
    calls.push(['give', a, k, to]);
    if (!(keys[a] || []).some((x) => x.name === k)) return 'That key is not on your ring.';
    offer = { from: 'Ana', key: k, giver: a }; return '';
  },
  ringAnswer: (a, yes) => {
    calls.push(['answer', a, yes]);
    const o = offer; offer = null;
    if (o && yes) { const k = keys[o.giver].find((x) => x.name === o.key); keys[o.giver] = keys[o.giver].filter((x) => x !== k); keys[a].push(k); }
    return '';
  },
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

const menuOf = (a) => { const w = lastWidget(a); return w && w[1].type === 'contextMenu' ? w[1] : null; };
const pick = (a, re) => { const m = menuOf(a); const r = m && m.actions.find((x) => re.test(x.label)); fire('keyRingMenu', a, [r ? r.id : 'none']); return r ? r.id : null; };

// ---- no panel (client 0.3.95): contextMenu widgets ----
cmds.get('keys')(A, '');
let m = menuOf(A);
check('without the panel, /keys opens a contextMenu (not widget 91) listing the key', !!m && m.id !== 91 && m.events.action === 'dbo:keyRingMenu' && m.actions.some((x) => /Key to the Inn \(Inn\)/.test(x.label)), m);
check('the /keys menu offers take-back of the copies of your own locks', !!m && m.actions.some((x) => /^Take back Key to the Inn No\. 2 from Bo$/.test(x.label)));
check('the id is unique among widgets (not 81/82/83/91)', !!m && ![81, 82, 83, 91].includes(m.id), m && m.id);
const handled = typeof globalThis.__dboKeyRingAction === 'function' && globalThis.__dboKeyRingAction(A, 'keyring:give', B, () => 'Bo');
m = menuOf(A);
check('Give a key on the X menu opens a menu of the giver\'s keys for that player', handled && !!m && /Bo/.test(m.targetName) && m.actions.length === 1 && /Key to the Inn/.test(m.actions[0].label), m);
const giveRow = pick(A, /Key to the Inn/);
check('picking a key gives it to the target, once, and is audited', calls.filter((c) => c[0] === 'give').length === 1 && calls[0][1] === A && calls[0][2] === 'Key to the Inn' && calls[0][3] === B && /offered "Key to the Inn"/.test(audits[0] || ''), calls);
check('the giver is told', /You offer Key to the Inn/.test((chat.filter((c) => c[0] === A).slice(-1)[0] || [])[1] || ''));
m = menuOf(B);
check('the target gets a menu with the offer', !!m && m.actions.some((x) => /^Accept Key to the Inn from Ana$/.test(x.label)), m);
pick(B, /^Accept/);
check('accepting moves the key to the target, once, audited and told', keys[B].length === 1 && keys[A].length === 0 && calls.filter((c) => c[0] === 'answer').length === 1 && /accepted "Key to the Inn"/.test(audits[1] || '') && /is on your key ring/.test(chat.filter((c) => c[0] === B).slice(-1)[0][1]), { calls, audits });
const before = calls.length;
fire('keyRingMenu', A, [giveRow]);
fire('keyRingMenu', A, ['keyring:give:Key to the Inn']);
cmds.get('keys')(A, '');
const n0 = menuOf(A).actions[0].id.split(':')[1];
fire('keyRingMenu', A, [`kr:${n0}:99`]);
check('a replayed or forged row for a key you no longer hold is refused (no housing call)', calls.length === before, calls.slice(before));
cmds.get('keys')(A, '');
pick(A, /^Take back Key to the Inn No\. 2/);
check('take-back from the menu goes to housing with that copy, and the menu comes back', calls.slice(-1)[0][0] === 'take' && calls.slice(-1)[0][2] === 5 && calls.slice(-1)[0][3] === 'Key to the Inn No. 2' && !!menuOf(A) && /no longer opens/.test(chat.slice(-1)[0][1]), calls.slice(-1));
const live = menuOf(A).actions[0].id, nCalls = calls.length;
fire('keyRingMenuClose', A, []);
fire('keyRingMenu', A, [live]);
check('closing the menu closes its widget and forgets its rows', widgets.some((w) => w[0] === A && w[1].close === 92) && calls.length === nCalls, calls.slice(nCalls));

// ---- with the panel ----
keys[A] = [INN]; keys[B] = []; offer = null; calls.length = 0; audits.length = 0; widgets.length = 0;
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
keys[A] = [INN]; keys[B] = [];
check('the X menu offers Give a key with a key on the ring', globalThis.__dboKeyRingEntries(A, B).length === 1 && globalThis.__dboKeyRingEntries(B, A).length === 0);
ringOn = false;
check('with the ring off, no X menu entry and /keys points to the inventory', globalThis.__dboKeyRingEntries(A, B).length === 0 && (cmds.get('keys')(A, ''), /inventory/.test(chat.slice(-1)[0][1])));
fire('keyRingClose', A, []);
check('close closes widget 91', lastWidget(A)[1].close === 91);

console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
