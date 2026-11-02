// How big native panel payloads get (census Round 2, W6 item 3): gamemode's nativeSwfFor measures every widget it would send
// natively, per type (journal per tab): count, largest, average, how many went to the browser for being over NATIVE_MAX_CHARS.
// An oversize payload is logged at once, one line per type a minute, and the table every hour, as "[native-size]" lines, so a
// day of logs names the panels to page. The block from NATIVE_SWF to closeWidget and the measuring after it are run on their own.
//   node tests/native-size-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
let fails = 0, oks = 0;
const ok = (c, what, d) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && d !== undefined ? '   ' + JSON.stringify(d).slice(0, 400) : ''}`); if (c) oks++; else fails++; };
const a0 = src.indexOf('const NATIVE_SWF = ');
const m0 = src.indexOf("// How big each native panel's payload gets");
const m1 = src.indexOf('\n});\n', src.indexOf("every('nativeSizes'")) + 5;
const block = src.slice(a0, src.indexOf('\n', src.indexOf('const closeWidget = '))) + '\n' + src.slice(src.indexOf('\n', src.indexOf('const closeWidget = ')) + 1, m1);
ok(m0 > 0 && m0 < m1, 'the measuring block is in gamemode.js after closeWidget');
const logs = [], timers = {};
let now = 1000000;
const realNow = Date.now;
Date.now = () => now;
globalThis.__dboPanelState = undefined; globalThis.__dboNativeSizes = undefined;
const R = new Function('sendPacket', 'log', 'every', 'profileOf', block + '\nreturn { nativeSwfFor, nativeState, nativeSizes, NATIVE_MAX_CHARS };')(
  () => true, (...a) => logs.push(a.join(' ')), (name, ms, fn) => { timers[name] = { ms, fn }; }, () => 7);
const A = 0x14;
R.nativeState().native.set(A, new Set(['native:keyRing', 'native:journal', 'native:journalTab:faction']));
const big = (n) => 'x'.repeat(n);
ok(R.nativeSwfFor(A, { type: 'keyRing', id: 91, nonce: 'a', pad: big(1000) }) === 'dbo_keyring', 'a small panel still goes native');
R.nativeSwfFor(A, { type: 'keyRing', id: 91, nonce: 'b', pad: big(3000) });
ok(R.nativeSwfFor(A, { type: 'keyRing', id: 91, nonce: 'c', pad: big(R.NATIVE_MAX_CHARS + 10) }) === '', 'one over the limit goes to the browser, as before');
const k = R.nativeSizes().types.get('keyRing');
ok(k && k.n === 3 && k.over === 1 && k.max > R.NATIVE_MAX_CHARS && k.sum > k.max, 'its type counts each payload, the largest and the one over', k);
ok(logs.some((l) => /^\[native-size\] keyRing \d+ chars, over 60000: sent to the browser \(profile 7\)$/.test(l)), 'the oversize one is logged at once, with its size and profile', logs);
R.nativeSwfFor(A, { type: 'keyRing', id: 91, nonce: 'd', pad: big(R.NATIVE_MAX_CHARS + 20) });
ok(logs.filter((l) => /keyRing \d+ chars/.test(l)).length === 1 && R.nativeSizes().types.get('keyRing').over === 2, 'a second within the minute is counted, not logged again');
now += 61000;
R.nativeSwfFor(A, { type: 'keyRing', id: 91, nonce: 'e', pad: big(R.NATIVE_MAX_CHARS + 30) });
ok(logs.filter((l) => /keyRing \d+ chars/.test(l)).length === 2, '...and one a minute later is');
R.nativeSwfFor(A, { type: 'journal', id: 50, hub: true, tab: 'faction', pad: big(500) });
ok(R.nativeSizes().types.has('journal:faction'), 'the journal is measured per tab');
R.nativeSwfFor(A, { type: 'bank', id: 48 });
ok(!R.nativeSizes().types.has('bank'), 'a panel the client does not draw natively is not measured');
ok(timers.nativeSizes && timers.nativeSizes.ms === 3600000, 'the table is logged every hour');
logs.length = 0; timers.nativeSizes.fn();
ok(/^\[native-size\] since /.test(logs[0]) && /keyRing: 5 sent, largest \d+, average \d+, over 60000 3/.test(logs[1]) && logs.some((l) => /journal:faction: 1 sent/.test(l)), 'the hourly table: largest first, each type\'s numbers', logs);
const again = new Function('sendPacket', 'log', 'every', 'profileOf', block + '\nreturn { nativeSizes };')(() => true, () => {}, () => {}, () => 7);
ok(again.nativeSizes().types.get('keyRing').n === 5, 'the table survives a hot reload');
const broken = new Function('sendPacket', 'log', 'every', 'profileOf', block + '\nreturn { nativeSwfFor, nativeState };')(() => true, () => { throw new Error('log down'); }, () => {}, () => 7);
broken.nativeState().native.set(A, new Set(['native:keyRing']));
ok(broken.nativeSwfFor(A, { type: 'keyRing', id: 91, pad: big(R.NATIVE_MAX_CHARS + 1) }) === '' && broken.nativeSwfFor(A, { type: 'keyRing', id: 91 }) === 'dbo_keyring', 'measuring never breaks routing (a failing log)');
// A client that sends big payloads in pieces (nativeChunked) gets them natively up to NATIVE_CHUNKED_MAX_CHARS: Nat's staff
// Faction tab, 63,411 characters, fell back to the browser at 60,000 (2 Nov)
const C2 = new Function('sendPacket', 'log', 'every', 'profileOf', block + '\nreturn { nativeSwfFor, nativeState, NATIVE_CHUNKED_MAX_CHARS };')(() => true, (...x) => logs.push(x.join(' ')), () => {}, () => 2);
const B = 0x15, O = 0x16;
C2.nativeState().native.set(B, new Set(['native:journal', 'native:journalTab:faction', 'nativeChunked']));
C2.nativeState().native.set(O, new Set(['native:journal', 'native:journalTab:faction']));
const faction = { type: 'journal', id: 50, hub: true, tab: 'faction', pad: big(63411) };
ok(C2.nativeSwfFor(B, faction) === 'dbo_journal', 'a 63k Faction tab goes native to a client that sends payloads in pieces');
ok(C2.nativeSwfFor(O, faction) === '', '...and to the browser for one that does not, as before');
ok(C2.NATIVE_CHUNKED_MAX_CHARS === 400000 && C2.nativeSwfFor(B, Object.assign({}, faction, { pad: big(400001) })) === '', 'past the piece ceiling it goes to the browser too');
logs.length = 0;
now += 61000;
C2.nativeSwfFor(B, Object.assign({}, faction, { tab: 'faction', pad: big(400010) }));
ok(logs.some((l) => /over 400000: sent to the browser \(profile 2\)/.test(l)), 'the oversize line names the ceiling that applied', logs);
// dbo:nativeTiming, the panel's own report of a big delivery, as one [native-timing] line
const handlers = {};
const onUiSrc = src.slice(src.indexOf("onUi('nativeTiming'"), src.indexOf('\n});\n', src.indexOf("onUi('nativeTiming'")) + 5);
new Function('onUi', 'log', 'profileOf', onUiSrc)((e, f) => { handlers[e] = f; }, (...x) => logs.push(x.join(' ')), () => 2);
logs.length = 0;
handlers.nativeTiming && handlers.nativeTiming(B, ['journal-14', 63411, 2, 180.4, 95]);
ok(logs[0] === '[native-timing] journal-14 63411 chars in 2 piece(s): parse 180 ms, draw 95 ms (profile 2)', 'a panel timing report is logged with its numbers', logs);
handlers.nativeTiming && handlers.nativeTiming(B, [{ x: 1 }, 'lots', null]);
ok(/ -1 chars in 0 piece\(s\): parse -1 ms, draw -1 ms \(profile 2\)$/.test(logs[1]), 'nonsense numbers are logged as -1 (a missing one as 0), never thrown on', logs[1]);
Date.now = realNow;
console.log(fails ? `\n${fails} failed` : `\nall passed (${oks})`);
process.exit(fails ? 1 : 0);
