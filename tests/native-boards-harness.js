// The server half of the native notice-board Citizenship and Voting (dbo_citizen) and Expeditions / Hunting Contracts
// (dbo_expedition) panels (Nat, 1 Nov: "zero web pages"):
//   - gamemode's NATIVE_SWF routes citizenBoard and expeditionBoard to their swfs, so a client naming native:<type> gets
//     the custom menu and any other the browser widget, as for every native panel;
//   - citizenship.js: a citizenAct "browser" (the native panel, for a game that cannot type) re-sends the board with
//     browser: 1 for the rest of that visit, which nativeSwfFor sends to the browser; a fresh citizenOpen starts native again;
//   - dungeons.js opens the board for a client that draws it natively (gamemode's hasUiCap native:expeditionBoard), not
//     only for the browser HUD's dbo:uiCaps, and gamemode hands dungeons.js hasUiCap.
// The routing itself is run: nativeSwfFor and openWidget are cut from gamemode.js and given packets to send.
//   node tests/native-boards-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0, oks = 0;
const ok = (c, what, d) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && d !== undefined ? '   ' + JSON.stringify(d).slice(0, 400) : ''}`); if (c) oks++; else fails++; };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const gm = read('gamemode.js'), cz = read('citizenship.js'), dg = read('dungeons.js');
const cut = (src, start) => {
  const i = src.indexOf(start); if (i < 0) throw new Error('not found: ' + start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{' || ch === '(' || ch === '[') depth++; else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (ch === ';' && depth === 0) return src.slice(i, j + 1);
  }
  throw new Error('unterminated: ' + start);
};

// ---- the routing, run ----
const code = ['const NATIVE_SWF = ', 'const NATIVE_MAX_CHARS = ', 'const nativeState = ', 'const NATIVE_TO_BROWSER = ', 'const JOURNAL_TABS_TO_BROWSER = ', 'const nativeSwfFor = ', 'const openWidget = '].map((s) => cut(gm, s)).join('\n');
const sent = [];
const R = new Function('sendPacket', 'log', `${code}\nreturn { NATIVE_SWF, nativeSwfFor, openWidget, nativeState };`)((a, p) => { sent.push(p); return true; }, () => {});
globalThis.__dboPanelState = undefined;
ok(R.NATIVE_SWF.citizenBoard === 'dbo_citizen' && R.NATIVE_SWF.expeditionBoard === 'dbo_expedition', 'NATIVE_SWF routes both boards to their swfs');
ok(R.NATIVE_SWF.namePrompt === 'dbo_naming', '...and the name prompt to dbo_naming (Round 2)');
const A = 0x14;
R.nativeState().native.set(A, new Set(['native:citizenBoard', 'native:expeditionBoard']));
const board = { type: 'citizenBoard', id: 84, nonce: 'n1', tab: 'citizenship' };
R.openWidget(A, board, true);
ok(sent.slice(-1)[0].customPacketType === 'dboScaleform' && sent.slice(-1)[0].swf === 'dbo_citizen', 'a client naming native:citizenBoard gets the custom menu', sent.slice(-1)[0]);
R.openWidget(A, Object.assign({}, board, { browser: 1 }), true);
ok(sent.slice(-2)[0].close === true && sent.slice(-1)[0].customPacketType === 'dboWidget', 'the same board with browser: 1 closes the custom menu and goes to the browser', sent.slice(-2));
R.openWidget(A, { type: 'expeditionBoard', id: 63, expeditions: [] }, true);
ok(sent.slice(-1)[0].swf === 'dbo_expedition', 'the expedition board goes native for its cap');
R.nativeState().native.set(A, new Set());
R.openWidget(A, { type: 'expeditionBoard', id: 63, expeditions: [] }, true);
ok(sent.slice(-1)[0].customPacketType === 'dboWidget', 'without the cap it stays the browser widget');

// ---- citizenship's hand-over to the browser ----
ok(/const boardPayload = \(a, zid, nonce, tab, text, kind, browser\) => \{[\s\S]{0,400}if \(browser\) w\.browser = 1;/.test(cz), 'boardPayload marks the board browser: 1 when asked');
ok(/openWidget\(a, boardPayload\(a, p\.zone, p\.nonce, p\.tab, text, kind, p\.browser\), true\);/.test(cz), 'every re-send of the panel carries the visit\'s choice');
ok(/if \(String\(args\[1\]\) === 'browser'\) \{ p\.browser = true; return sendBoard\(a\); \}/.test(cz), 'citizenAct "browser" switches this visit to the browser and re-sends');
ok(/S\.panels\.set\(a >>> 0, \{ zone: String\(zone\), tab: [^}]*nonce: '' \}\);/.test(cz) && !/S\.panels\.set\([^)]*browser/.test(cz), 'a fresh citizenOpen starts native again (no browser flag carried over)');
ok(cz.indexOf("if (String(args[1]) === 'browser')") > cz.indexOf("if (!p || !p.nonce || String((args || [])[0] || '') !== p.nonce) return;"), '...and only for the panel\'s own nonce');

// ---- the expedition board's gate ----
ok(/uiCap\(a, 'expeditionBoard', uiCaps\) \|\| uiCap\(a, 'native:expeditionBoard'\)/.test(dg), 'dungeons.js opens the board for the native cap as well as W1\'s hasUiCap gate');
ok(/globalThis\.__dboHasUiCap = hasUiCap|__dboHasUiCap = /.test(gm), 'gamemode publishes hasUiCap for the modules\' uiCap');
// the gate run as it is: W1's uiCap (dungeons.js top) over gamemode's hasUiCap (globalThis.__dboHasUiCap) and the module's own map
const gate = cut(dg, 'const uiCap = ') + '\n' + cut(dg, 'const boardCaps = ');
const mk = (browserCaps, hasCaps) => {
  const was = globalThis.__dboHasUiCap;
  globalThis.__dboHasUiCap = hasCaps ? (a, c) => hasCaps.includes(c) : undefined;
  try { return new Function('uiCaps', `${gate}\nreturn boardCaps.has(${A});`)(new Map([[A, new Set(browserCaps)]])); } finally { globalThis.__dboHasUiCap = was; }
};
ok(mk([], ['native:expeditionBoard']) && mk([], ['expeditionBoard']) && mk(['expeditionBoard'], null) && !mk([], []) && !mk([], null),
  'the gate: the native cap, the browser cap through hasUiCap, or the module\'s own map opens it; none does not');

console.log(fails ? `\n${fails} failed` : `\nall passed (${oks})`);
process.exit(fails ? 1 : 0);
