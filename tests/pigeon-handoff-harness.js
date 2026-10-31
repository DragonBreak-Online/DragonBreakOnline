// The native pigeon coop's typed-input hand-off (gamemode.js pigeonHandoff, Worker 1's pattern, 26 Oct): pigeonCompose marks
// the coop browser-drawn for one composer until the action succeeds, is cancelled, or the coop is closed or opened afresh.
// openPigeonCoop and the pigeon handlers are run out of gamemode.js with stubs; post.js and couriers.js are checked by text.
//   node tests/pigeon-handoff-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const gm = read('gamemode.js');
const slice = (from, to) => { const a = gm.indexOf(from); const b = gm.indexOf(to, a); if (a < 0 || b < 0) throw new Error('missing ' + from); return gm.slice(a, b); };
const coop = slice('const pigeonHandoff = ', 'globalThis.__dboOpenPigeonCoop = openPigeonCoop;');
const openLine = gm.slice(gm.indexOf("onUi('pigeonOpen'"), gm.indexOf('\n', gm.indexOf("onUi('pigeonOpen'")));
const handlers = slice("onUi('pigeonSign'", "onUi('close', (a, args, widgetId) => { if (widgetId === PIGEON_WIDGET_ID)");

let fails = 0;
const ok = (c, t, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${t}${c ? '' : '   ' + JSON.stringify(g)}`); if (!c) fails++; };

const A = 0xff000001, BOB = 0xff000002, EVE = 0xff000003;
const published = [], closed = [], refused = [];
const ui = {};
let sendOk = true;
globalThis.__dboPigeonHandoff = undefined;
const deps = {
  mp: { get: () => ({ name: 'x' }) }, boardZoneNear: () => 'bruma', zoneById: () => ({ name: 'Bruma' }), isAdmin: () => false, onlineActors: () => [A, BOB],
  pigeonFee: () => 5, pigeonContactsOf: () => [BOB, EVE], ownNameOf: (a) => (a === BOB ? 'Bob' : 'Eve'), tagOf: () => 'TAGG', presenceShown: () => false, presenceMutual: () => false,
  PIGEON_COOLDOWN_MS: 35 * 60000, pigeonLastSent: new Map(), profileOf: () => 1, pigeonNonces: new Map(), PIGEON_WIDGET_ID: 34, goldOf: () => 100, PIGEON_MAX_TEXT: 240,
  lettersOf: () => [], postItemName: String, pigeonsWaiting: () => 0, postView: () => ({ supply: { enabled: true } }), courierView: () => ({ courier: { enabled: true } }),
  openWidget: (a, w) => published.push(w), closeWidget: (a, id) => closed.push(id), refusePigeon: (a) => refused.push(a),
  sendPigeon: () => (sendOk ? { ok: true, text: 'Your pigeon flies to Bob.' } : { ok: false, text: 'Your pigeon is still out.' }),
  onUi: (name, fn) => { ui[name] = fn; },
};
new Function(...Object.keys(deps), `${coop}\nglobalThis.__dboOpenPigeonCoop = openPigeonCoop;\n${openLine}\n${handlers}`)(...Object.values(deps));
const last = () => published[published.length - 1];
const nonce = () => last().nonce;

ok(/pigeon: 'dbo_pigeon'/.test(gm.slice(gm.indexOf('const NATIVE_SWF = '), gm.indexOf('\n', gm.indexOf('const NATIVE_SWF = ')))), 'NATIVE_SWF routes the coop to dbo_pigeon');
ui.pigeonOpen(A, ['letters']);
ok(!last().browser && !last().handoff && last().view === 'letters', 'a coop opened at a board is unmarked (native for a client with the cap)', last());
ui.pigeonCompose(A, [nonce(), 'send', BOB]);
ok(last().browser === 1 && last().handoff === 'send' && last().handoffTo === BOB && last().view === 'send', '"Write the letter..." re-publishes the coop for the browser: the letter composer, to Bob', last());
// /sign answers in the composer: the same view, its line, and the mark kept (a sign is not the letter)
globalThis.__dboRunCommand = (a, cmd, how) => (cmd === 'sign' ? ['Your next letter is signed with your own name.'] : null);
ui.pigeonSign(A, [nonce(), 'clear']);
ok(last().browser === 1 && last().handoff === 'send' && last().view === 'send' && last().resultKind === 'sent' && last().result === 'Your next letter is signed with your own name.', 'signing answers inside the letter composer and does not end it', last());
globalThis.__dboRunCommand = () => ['No such name.'];
ui.pigeonSign(A, [nonce(), 'Nobody']);
ok(last().handoff === 'send' && last().resultKind === 'refused', 'a refused signature is refused, still in the composer', last());
const n1 = nonce();
// A refused send keeps the composer up
sendOk = false;
ui.pigeonSend(A, [n1, BOB, 'hello']);
ok(last().browser === 1 && last().handoff === 'send' && last().resultKind === 'refused', 'a refused letter keeps the composer in the browser, with the reason', last());
sendOk = true;
ui.pigeonSend(A, [nonce(), BOB, 'hello']);
ok(!last().browser && last().resultKind === 'sent' && last().view === 'send', 'a letter that flew answers it: the coop comes back unmarked, with the result', last());

ui.pigeonCompose(A, [nonce(), 'send', 0xff0000ff]);
ok(last().handoff === 'send' && last().handoffTo === 0, 'a recipient who is no contact is not carried into the composer', last());
ui.pigeonCompose(A, [nonce(), '']);
ok(!last().browser && !last().handoff, 'the composer\'s Cancel (mode \'\') brings the native coop back', last());

ui.pigeonCompose(A, [nonce(), 'supply']);
ok(last().handoff === 'supply' && last().view === 'supply' && last().browser === 1, 'Post an order... hands the supply composer over', last());
ui.pigeonCompose(A, [nonce(), '']);
ok(!last().browser && last().view === 'supply', 'its Cancel brings the native coop back on the supply tab', last());
ui.pigeonCompose(A, [nonce(), 'supply']);
globalThis.__dboPigeonHandoffDone(A, 'courier');
globalThis.__dboOpenPigeonCoop(A, 'x', 'sent', 'supply');
ok(last().handoff === 'supply', 'another composer\'s success does not end this one', last());
globalThis.__dboPigeonHandoffDone(A, 'supply');
globalThis.__dboOpenPigeonCoop(A, 'Your order is up.', 'sent', 'supply');
ok(!last().browser && last().result === 'Your order is up.', 'post.js\'s posted order ends it (pigeonHandoffDone)', last());

ui.pigeonCompose(A, [nonce(), 'courier']);
ok(last().handoff === 'courier' && last().view === 'courier', 'Send a parcel... hands the courier composer over', last());
ui.pigeonClose(A);
ok(closed.includes(34), 'Close closes the coop');
globalThis.__dboOpenPigeonCoop(A, undefined, undefined, 'courier');
ok(!last().browser && !last().handoff, '...and the mark goes with it (seen without the board-open path, which also clears it)', last());
ui.pigeonCompose(A, [nonce(), 'courier']);
ui.pigeonCompose(A, [nonce(), '']);
ok(!last().browser && last().view === 'courier', 'Cancel from the courier composer comes back on the couriers tab', last());
ui.pigeonCompose(A, [nonce(), 'supply']);
ui.pigeonOpen(A, []);
ok(!last().browser, 'a composer Escaped away is not left marked: the next open at a board is native', last());

const before = published.length;
ui.pigeonCompose(A, ['stale', 'send', BOB]);
ok(published.length === before, 'a stale nonce is ignored');
ui.pigeonCompose(A, [nonce(), 'nonsense']);
ok(!last().browser, 'an unknown mode clears rather than marks', last());

const post = read('post.js'), cour = read('couriers.js');
ok(/if \(r\.ok\) \{ S\.search\.delete\(a >>> 0\); if \(typeof globalThis\.__dboPigeonHandoffDone === 'function'\) globalThis\.__dboPigeonHandoffDone\(a, 'supply'\); \}/.test(post), 'post.js: a posted supply order ends the supply composer');
ok(/if \(r && r\.ok && typeof globalThis\.__dboPigeonHandoffDone === 'function'\) globalThis\.__dboPigeonHandoffDone\(a, 'courier'\);/.test(cour), 'couriers.js: a posted courier job ends the courier composer');

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
