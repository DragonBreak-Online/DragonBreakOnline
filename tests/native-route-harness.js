// gamemode.js native panel routing: openWidget/closeWidget send dboScaleform to a client that named the panel in nativeCaps.
// The block from NATIVE_SWF to closeWidget is run on its own with a stub sendPacket.
//   node tests/native-route-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
const a0 = src.indexOf('const NATIVE_SWF = '), a1 = src.indexOf('\n', src.indexOf('const closeWidget = '));
const end = src.indexOf('\n};\n', a1) + 3;
const sent = [];
globalThis.__dboPanelState = undefined;
const sendPacket = (a, p) => { sent.push([a, p]); return true; };
const log = () => {};
const block = src.slice(a0, end);
const { openWidget, closeWidget, nativeState } = new Function('sendPacket', 'log', block + '\nreturn { openWidget, closeWidget, nativeState };')(sendPacket, log);
const caps = src.match(/onUi\('nativeCaps', \(a, args\) => \{ (.*) \}\);/)[1];
const setCaps = new Function('nativeState', 'a', 'args', caps).bind(null, nativeState);

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };
const last = () => sent[sent.length - 1][1];
const A = 0xff000001, B = 0xff000002;

openWidget(A, { type: 'decor', id: 171, nonce: 'x' }, true);
ok(last().customPacketType === 'dboWidget', 'without nativeCaps the browser widget is sent', last());
setCaps(A, ['native:decor', 'native:prayer', 'bank']);
ok(nativeState().native.get(A).has('native:decor') && !nativeState().native.get(A).has('bank'), 'nativeCaps keeps only native: names');
openWidget(A, { type: 'decor', id: 171, nonce: 'x' }, true);
ok(last().customPacketType === 'dboScaleform' && last().swf === 'dbo_decor' && last().widget === 171 && last().payload.nonce === 'x', 'with it, dboScaleform carries the swf, the widget id and the payload', last());
openWidget(A, { type: 'prayer', id: 35, nonce: 'p' }, true);
ok(last().customPacketType === 'dboWidget', 'a hold prayer stays in the browser (only pick mode is native)', last());
openWidget(A, { type: 'prayer', id: 35, nonce: 'p', mode: 'pick' }, true);
ok(last().customPacketType === 'dboScaleform' && last().swf === 'dbo_prayer', 'a pick prayer goes native', last());
closeWidget(A, 171);
ok(last().customPacketType === 'dboWidget' && last().close === 171, 'closing a widget that is not the open native one is a plain close', last());
closeWidget(A, 35);
ok(last().customPacketType === 'dboScaleform' && last().close === true, 'closing the open native one closes the custom menu', last());
closeWidget(A, 35);
ok(last().customPacketType === 'dboWidget', 'and only once', last());
openWidget(B, { type: 'bank', id: 40 }, true);
ok(last().customPacketType === 'dboWidget', 'a type with no SWF is untouched', last());

// The journal: native per hub tab the client's swf names, and a tab switch moves it between the two surfaces
const C = 0xff000003;
const J = (tab, extra) => Object.assign({ type: 'journal', id: 50, nonce: 'j', hub: 1, tab }, extra || {});
setCaps(C, ['native:journal', 'native:journalTab:stats', 'native:journalTab:deity']);
openWidget(C, J('stats'), true);
ok(last().customPacketType === 'dboScaleform' && last().swf === 'dbo_journal', 'a journal tab the swf draws goes native', last());
sent.length = 0;
openWidget(C, J('profile'));
ok(sent.length === 2 && sent[0][1].customPacketType === 'dboScaleform' && sent[0][1].close === true && sent[1][1].customPacketType === 'dboWidget' && sent[1][1].focus === true,
  'switching to Profile closes the custom menu, then opens the browser journal with the cursor', sent.map((x) => x[1]));
sent.length = 0;
openWidget(C, J('profile', { result: 'saved' }));
ok(sent.length === 1 && sent[0][1].customPacketType === 'dboWidget' && sent[0][1].focus === false, 'a redraw in the browser stays a plain redraw', sent.map((x) => x[1]));
sent.length = 0;
openWidget(C, J('deity'));
ok(sent.length === 2 && sent[0][1].customPacketType === 'dboWidget' && sent[0][1].close === 50 && sent[1][1].customPacketType === 'dboScaleform',
  'switching back to a native tab closes the browser journal, then opens the native one', sent.map((x) => x[1]));
openWidget(C, J('magic'));
ok(last().customPacketType === 'dboWidget' && last().focus === true, 'a tab the swf does not name goes to the browser', last());
openWidget(C, Object.assign(J('stats'), { hub: 0 }));
ok(last().customPacketType === 'dboWidget', 'a journal without the hub is never native', last());
sent.length = 0;
openWidget(C, J('stats')); closeWidget(C, 50);
ok(sent.length === 3 && sent[2][1].close === true, 'closing the journal closes whichever surface has it', sent.map((x) => x[1]));
sent.length = 0;
openWidget(C, J('settings')); closeWidget(C, 50); openWidget(C, J('stats'));
ok(sent.length === 3 && sent[1][1].close === 50 && sent[2][1].customPacketType === 'dboScaleform', 'a closed browser journal is not closed again on the next native open', sent.map((x) => x[1]));
openWidget(C, J('stats', { browser: 1 }));
ok(last().customPacketType === 'dboWidget' && last().focus === true, 'a draw marked browser (the native journal handing off typed input) goes to the browser', last());
openWidget(C, J('stats'));
ok(last().customPacketType === 'dboScaleform', 'and the next unmarked one comes back native', last());
setCaps(B, ['native:decor']);
openWidget(B, J('stats'));
ok(last().customPacketType === 'dboWidget', 'a client without native:journal keeps the browser journal', last());

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
