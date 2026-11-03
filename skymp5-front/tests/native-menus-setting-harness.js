// The web page's "Game menus" settings (utils/uiSettings.ts; Nat, 3 Nov): Native menus on or off and the menu size, read
// from and saved to the chat-settings file's ui block the client's scaleformMenuService reads, so a player who turned the
// game's own panels off can turn them on again here. uiSettings.ts is compiled on its own and run against a window stand-in.
//   node tests/native-menus-setting-harness.js        (from skymp5-front)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!ok) failures++; };

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-nmenus-'));
const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
if (!fs.existsSync(tsc)) { console.log('skipped: no typescript in the front\'s node_modules'); process.exit(0); }
try {
  execFileSync(process.execPath, [tsc, path.join(ROOT, 'src', 'utils', 'uiSettings.ts'), '--outDir', OUT, '--module', 'commonjs', '--target', 'es2019', '--skipLibCheck', '--noResolve', '--jsx', 'react'], { stdio: 'pipe' });
} catch (e) { /* the emitted file is checked below */ }
const COMPILED = path.join(OUT, 'uiSettings.js');
if (!fs.existsSync(COMPILED)) { console.log('FAIL uiSettings.ts did not compile'); process.exit(1); }

const resolve0 = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'react' ? 'react' : resolve0.call(this, req, ...rest); };
require.cache.react = { id: 'react', filename: 'react', loaded: true, exports: { useEffect: () => {}, useState: (v) => [v, () => {}] } };
const sent = [];
global.window = { __alduinakChatSettings: { fontSize: 16, ui: { vitals: 'hidden', nativeMenus: 'off', nativeScale: 0.7 } }, skyrimPlatform: { sendMessage: (...a) => sent.push(a) }, dispatchEvent: () => {} };
global.CustomEvent = function (n) { this.type = n; };
const U = require(COMPILED);

let s = U.getUiSettings();
check('a saved "Native menus: off" and size 70% are read', s.nativeMenus === 'off' && s.nativeScale === 0.7, s);
check('the defaults: on, 85%', U.UI_DEFAULTS.nativeMenus === 'on' && U.UI_DEFAULTS.nativeScale === 0.85);
global.window.__alduinakChatSettings = { ui: { nativeMenus: 'maybe', nativeScale: 3 } };
s = U.getUiSettings();
check('values no control offers fall back to the defaults', s.nativeMenus === 'on' && s.nativeScale === 0.85, s);
global.window.__alduinakChatSettings = { fontSize: 18, ui: { vitals: 'hidden', nativeMenus: 'off' } };
s = U.setUiSettings({ nativeMenus: 'on' });
const saved = sent.length ? JSON.parse(sent[sent.length - 1][1]) : null;
check('turning them on again saves it to the file, the other settings kept', sent.length === 1 && sent[0][0] === 'cef::chat:saveSettings' && saved.ui.nativeMenus === 'on' && saved.ui.vitals === 'hidden' && saved.fontSize === 18, saved);
check('...and reads back on', s.nativeMenus === 'on');

const tab = fs.readFileSync(path.join(ROOT, 'src', 'features', 'journal', 'tabs', 'SettingsTab.tsx'), 'utf8');
check('the Interface part offers Native menus and Menu size', /<Row label="Native menus"/.test(tab) && /ui2\(\{ nativeMenus: v \}\)/.test(tab) && /<Row label="Menu size"/.test(tab) && /ui2\(\{ nativeScale: v \}\)/.test(tab));

fs.rmSync(OUT, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
