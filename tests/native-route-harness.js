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

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
