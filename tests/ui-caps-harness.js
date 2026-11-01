// The client names its own caps (B1, Worker 1, 1 Nov): the browser HUD's dbo:uiCaps was the only list the server had, so a
// client without the page lost every panel and client feature gated on it. Now nativeCaps carries the native panels and
// the client's own features, hasUiCap counts native:<panel> as the panel, and the modules with their own uiCaps maps ask
// hasUiCap first. Lifts gamemode.js's own handlers, then loads keyring.js for a client that never sent dbo:uiCaps.
//   node tests/ui-caps-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const check = (what, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${ok || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!ok) fails++; };

// ---- gamemode.js: hasUiCap and the two announcements, lifted ----
const GM = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
const stmt = (start) => { const i = GM.indexOf(start); if (i < 0) return ''; const one = GM.indexOf('\n', i); return /;\s*$/.test(GM.slice(i, one)) ? GM.slice(i, one) : GM.slice(i, GM.indexOf('\n};\n', i) + 3); };
const parts = ['const hasUiCap = ', 'globalThis.__dboHasUiCap = ', "onUi('uiCaps', ", "onUi('nativeCaps', "].map(stmt);
check('gamemode.js has hasUiCap, its global, and both announcements', parts.every(Boolean), parts.map((p) => p.slice(0, 40)));
const handlers = new Map();
const onUi = (ev, fn) => handlers.set(ev, fn);
const panelState = { caps: new Map() }, native = { native: new Map() };
let hasUiCap = () => false;
try { hasUiCap = new Function('panelState', 'nativeState', 'onUi', `${parts.join('\n')}\nreturn hasUiCap;`)(panelState, () => native, onUi); } catch (e) { check('the lifted code runs', false, e.message); }
const BROWSER = 0xff000101, CLIENT = 0xff000102, OLD = 0xff000103;
handlers.get('uiCaps')(BROWSER, ['bank', 'dboIdle', 'keyRing']);
handlers.get('nativeCaps')(CLIENT, ['native:bank', 'native:keyRing', 'native:journal', 'dboIdle', 'beastBody', 'pickRound']);
handlers.get('nativeCaps')(OLD, []);
check('a browser cap still counts (the page is still there)', hasUiCap(BROWSER, 'bank') && hasUiCap(BROWSER, 'dboIdle'));
check('a client that never sent dbo:uiCaps: native:bank counts as the bank, native:keyRing as the key ring', hasUiCap(CLIENT, 'bank') && hasUiCap(CLIENT, 'keyRing') && hasUiCap(CLIENT, 'journal'));
check('...and its own features count (dboIdle, beastBody, pickRound), kept from nativeCaps', hasUiCap(CLIENT, 'dboIdle') && hasUiCap(CLIENT, 'beastBody') && hasUiCap(CLIENT, 'pickRound'));
check('...a native cap still answers as itself (nativeSwfFor asks native:<type>)', hasUiCap(CLIENT, 'native:bank'));
check('nothing it did not name: no robPrompt, no lockpickLocal, nothing for a client that named nothing', !hasUiCap(CLIENT, 'robPrompt') && !hasUiCap(CLIENT, 'lockpickLocal') && !hasUiCap(OLD, 'bank') && !hasUiCap(0xff000999, 'bank'));
check('the global the modules ask is the same answer', typeof globalThis.__dboHasUiCap === 'function' && globalThis.__dboHasUiCap(CLIENT, 'keyRing') === true && globalThis.__dboHasUiCap(OLD, 'keyRing') === false);

// ---- keyring.js for a native-only client: /keys opens the key ring (widget 91), not the contextMenu list ----
const widgets = [], cmds = new Map(), kui = new Map();
globalThis.__dboHousing = { keyRingOn: () => true, ringView: () => ({ keys: [{ name: 'Key to the Inn', place: 'Inn' }], near: [], owned: [], offer: null }) };
require(path.join(SERVER, 'keyring.js'))({
  log: () => {}, personal: () => {}, audit: () => {}, who: String,
  openWidget: (a, w) => widgets.push([a, w]), closeWidget: () => {},
  onUi: (ev, fn) => { const l = kui.get(ev) || []; l.push(fn); kui.set(ev, l); }, registerChatCommand: (n, fn) => cmds.set(n, fn),
});
cmds.get('keys')(CLIENT, '');
const got = (widgets.filter((w) => w[0] === CLIENT).slice(-1)[0] || [])[1] || {};
check('keyring.js: a client with native:keyRing and no browser caps gets the key ring panel', got.type === 'keyRing' && got.id === 91, { type: got.type, id: got.id });
cmds.get('keys')(OLD, '');
const old = (widgets.filter((w) => w[0] === OLD).slice(-1)[0] || [])[1] || {};
check('...and a client that named nothing still gets the contextMenu list', old.type === 'contextMenu', old.type);

// ---- every module that kept its own uiCaps map asks hasUiCap first ----
for (const f of ['bank.js', 'business.js', 'couriers.js', 'keyring.js', 'spells.js', 'downed.js', 'robbery.js', 'naming.js', 'dungeons.js']) {
  const src = fs.readFileSync(path.join(SERVER, f), 'utf8').replace(/\r\n/g, '\n');
  const line = (src.match(/^const uiCap = .*$/m) || [''])[0];
  let ok = false;
  try {
    const uiCap = new Function(`${line}\nreturn uiCap;`)();
    const own = new Map([[OLD >>> 0, new Set(['x'])]]);
    const viaGlobal = uiCap(CLIENT, 'keyRing', own);
    const saved = globalThis.__dboHasUiCap; delete globalThis.__dboHasUiCap;
    const viaOwn = uiCap(OLD, 'x', own) && !uiCap(CLIENT, 'keyRing', own);
    globalThis.__dboHasUiCap = saved;
    ok = viaGlobal === true && viaOwn;
  } catch (e) { ok = false; }
  check(`${f}: its uiCap asks gamemode.js's hasUiCap, and falls back to its own map`, ok, line.slice(0, 80));
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
