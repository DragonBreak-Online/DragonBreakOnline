// F3, Settings in the native journal, the client's half (settingsLocal.ts, settingsNativeService.ts): the set:* keys route
// to the client and never to the server; the settings file is read and changed as the browser pages do (ui block, the chat's
// own values, everything else kept); the key capture's rules; the page bridge for the interface size and voice, run against
// a stand-in page; and the wiring, including every set:* key the journal sends having a case in the service.
//   node tests/settings-native-harness.js   (from skymp5-client)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const ts = require(path.resolve(__dirname, '../node_modules/typescript'));

const read = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-settings-native-'));
const load = (name) => {
  const out = ts.transpileModule(read(`src/services/services/${name}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
  fs.writeFileSync(path.join(tmp, `${name}.js`), out);
  return require(path.join(tmp, `${name}.js`));
};
const L = load('settingsLocal');
const W = load('nativeWidgets');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };
const J = JSON.stringify;

// ---- the route ----
check('a set:* key goes to the client service, untouched', J(W.replayFor('set:ui', [{ vitals: 'fade' }])) === J([{ do: 'local', key: 'set:ui', args: [{ vitals: 'fade' }] }]));
check('...from a gamemode panel too (no owner), never to the server', W.replayFor('set:get', [[]], false)[0].do === 'local');
check('a dbo: key still goes to the server', W.replayFor('dbo:journalTab', ['n1', 'settings'])[0].do === 'server');
check('a bare unknown key is still reported', W.replayFor('nonsense', [])[0].do === 'report');
check('close is still the close', W.replayFor('close', [])[1].do === 'close');

// ---- the file, read and changed as the browser does ----
check('parseFile reads the "//" + JSON plugin', J(L.parseFile('//{"fontSize":18}')) === '{"fontSize":18}');
check('...an empty file is {}, a broken one null (never written over)', J(L.parseFile('')) === '{}' && L.parseFile('//{broken') === null && L.parseFile('//[1]') === null);
check('readUi: the browser\'s defaults with no ui block', J(L.readUi({})) === J({ vitals: 'fade', vitalsStyle: 'quiet', vitalsFadeSeconds: 5, chat: 'fade', chatLettering: 'book' }));
check('...a saved choice wins, a value no control offers does not', J(L.readUi({ ui: { vitals: 'hidden', chat: 'loud', vitalsFadeSeconds: 7 } })) === J({ vitals: 'hidden', vitalsStyle: 'quiet', vitalsFadeSeconds: 5, chat: 'fade', chatLettering: 'book' }));
check('readChat: the chat\'s values and SettingsTab\'s defaults', J(L.readChat({ fontSize: 18, showFormIds: false })) === J({ fontSize: 18, chatTransparency: 25, fadeSeconds: 10, hidePlayerNames: false, showFormIds: false, customHighlights: '' }));
check('cleanUi keeps only offered values', J(L.cleanUi({ vitals: 'always', vitalsFadeSeconds: 10, chat: 'x', fov: 90, evil: 1 })) === J({ vitals: 'always', vitalsFadeSeconds: 10 }));
check('cleanChat: the ranges and kinds of the controls', J(L.cleanChat({ fontSize: 23, chatTransparency: 35, fadeSeconds: 0, hidePlayerNames: 'yes', customHighlights: 'gold', ui: {} })) === J({ chatTransparency: 35, fadeSeconds: 0, customHighlights: 'gold' }));
check('...highlights longer than the field\'s 300 are refused', J(L.cleanChat({ customHighlights: 'x'.repeat(301) })) === '{}');
const file = { fontSize: 18, windowPos: [1, 2], ui: { vitals: 'hidden', fov: { value: 90, launcher: 80 }, voiceOverride: { a: 1 } } };
const u = L.withUi(file, { chat: 'always' });
check('withUi merges into ui and keeps every other ui value and the chat\'s', J(u) === J({ fontSize: 18, windowPos: [1, 2], ui: { vitals: 'hidden', fov: { value: 90, launcher: 80 }, voiceOverride: { a: 1 }, chat: 'always' } }));
check('...and leaves the file it was given alone', J(file.ui) === J({ vitals: 'hidden', fov: { value: 90, launcher: 80 }, voiceOverride: { a: 1 } }));
check('withChat sets the top level and keeps ui', J(L.withChat(file, { fontSize: 20 }).ui) === J(file.ui) && L.withChat(file, { fontSize: 20 }).fontSize === 20);
check('fov and the mouse go into ui as the Camera and Mouse pages write them', J(L.withUi({}, { fov: null }).ui) === '{"fov":null}' && L.withUi({}, { mouseLeavesWindow: true }).ui.mouseLeavesWindow === true);

// ---- the key capture ----
check('Escape cancels', J(L.captureOf(1, false)) === '{"cancel":true}');
check('Backspace: the launcher\'s key back, or none for an optional row', J(L.captureOf(14, false)) === '{"save":null}' && J(L.captureOf(14, true)) === '{"save":0}');
check('Enter is refused with the reason', /Enter is kept/.test(L.captureOf(28, false).refuse));
check('left and right click are the panel\'s, ignored', L.captureOf(256, false) === null && L.captureOf(257, false) === null);
check('a key, and the middle and side mouse buttons, are taken', J(L.captureOf(37, false)) === '{"save":37}' && J(L.captureOf(258, false)) === '{"save":258}' && J(L.captureOf(260, false)) === '{"save":260}');
check('keyName as the front names keys', L.keyName(20) === 'T' && L.keyName(56) === 'Left Alt' && L.keyName(259) === 'Mouse 4' && L.keyName(250) === 'Key 250' && L.keyName(0) === '');
check('keyNamesFor names every code in use', J(L.keyNamesFor([20, 0, 61])) === J({ 20: 'T', 61: 'F3' }));

// ---- the page bridge, against a stand-in page ----
const page = (extra) => {
  const sent = [], events = [], calls = [];
  const win = Object.assign({
    skyrimPlatform: { sendMessage: (...a) => sent.push(a) },
    dispatchEvent: (e) => events.push(e),
    dboGetUiScale: () => ({ applied: 1.25, override: 1.25, auto: 1, launcher: 0, inGame: null }),
    dboSetUiScaleInGame: (v) => calls.push(['scale', v]),
    dboResetPanelScales: (s) => calls.push(['panels', s]),
  }, extra || {});
  win.window = win;
  win.CustomEvent = function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; };
  vm.createContext(win);
  return { win, sent, events, calls, run: (js) => vm.runInContext(js, win) };
};
{
  const p = page();
  p.run(L.pageSyncJs({ fontSize: 18, ui: { chat: 'hidden' } }, null));
  check('pageSyncJs: the page\'s copy follows the write, the HUD hears dbo:uiSettings', J(p.win.__alduinakChatSettings) === J({ fontSize: 18, ui: { chat: 'hidden' } }) && p.events.map((e) => e.type).join() === 'dbo:uiSettings');
  p.run(L.pageSyncJs({ fontSize: 20 }, { fontSize: 20 }));
  check('...a chat value is handed to the chat as the page does (dbo:chatSettings)', p.events.slice(-1)[0].type === 'dbo:chatSettings' && J(p.events.slice(-1)[0].detail) === '{"fontSize":20}');
}
{
  const p = page();
  p.run(L.pageQueryJs(['9']));
  const o = JSON.parse(p.sent[0][1]);
  check('pageQueryJs without voice: the interface size only', p.sent[0][0] === L.PAGE_MESSAGE && J(o) === J({ scale: { override: 1.25, auto: 1, launcher: 0 } }), o);
}
(async () => {
  const p = page({ __alduinakVoice: { getPrefs: () => ({ activation: 'ptt' }), peerSetting: (id) => ({ gain: id === '9' ? 0.5 : 1, muted: false }), listDevices: () => Promise.resolve({ inputs: ['Mic'], outputs: ['Out'] }),
    setPrefsInGame: (x) => p.calls.push(['prefs', x]), adjustPeer: (...a) => p.calls.push(['peer', ...a]) } });
  p.run(L.pageQueryJs(['9', '1a']));
  await new Promise((r) => setTimeout(r, 10));
  const o = JSON.parse(p.sent[0][1]);
  check('...with voice: the prefs, each nearby voice and the devices, once they are listed', J(o.voice) === J({ prefs: { activation: 'ptt' }, peers: { 9: { gain: 0.5, muted: false }, '1a': { gain: 1, muted: false } }, devices: { inputs: ['Mic'], outputs: ['Out'] } }), o);
  p.run(L.pageActJs('scale', [1.5])); p.run(L.pageActJs('panelReset', [42])); p.run(L.pageActJs('voice', [{ micGain: 1.1 }]));
  p.run(L.pageActJs('peer', ['9', 'set', 'Bjorn', 0.95])); p.run(L.pageActJs('peer', ['9', 'mute', 'Bjorn']));
  check('pageActJs calls the page\'s own functions as its controls do', J(p.calls) === J([['scale', 1.5], ['panels', 42], ['prefs', { micGain: 1.1 }], ['peer', '9', 'set', 'Bjorn', 0.95], ['peer', '9', 'mute', 'Bjorn']]), p.calls);
  check('cleanVoice: the pages\' ranges', J(L.cleanVoice({ micGain: 2.5, outputVolume: 3, activation: 'loud', vadThreshold: 0.065, inputLabel: 'Mic' })) === J({ outputVolume: 3, vadThreshold: 0.065, inputLabel: 'Mic' }));
  const bad = page();
  bad.run(L.pageActJs('voice', [{}]));
  check('...and a page without a voice manager is left alone', bad.calls.length === 0);

  // ---- the native HUD follows a save made here, without a restart (W1's review) ----
  {
    const H = load('nativeHud');
    const server = { stage: 'sated', gold: 10 };
    const file0 = { fontSize: 16, ui: { vitals: 'always', vitalsStyle: 'classic' } };
    const before = H.payloadOf(server, { h: 100, m: 100, s: 100 }, 'talk', false, H.uiFromFile(file0), H.newClock(0), 1000);
    // what settingsNativeService saves for "Show the bars: Hidden", read as NativeHudService.settingsSaved reads it
    const saved = L.withUi(file0, L.cleanUi({ vitals: 'hidden' }));
    const after = H.payloadOf(server, { h: 100, m: 100, s: 100 }, 'talk', false, H.uiFromFile(saved), H.newClock(0), 1000);
    check("Show the bars: Hidden, saved by the native journal, turns the HUD's bars off", before.bars.on === true && after.bars.on === false && after.corner.shown === false, { before: before.bars, after: after.bars });
    const HUD = read('src/services/services/nativeHudService.ts');
    check('NativeHudService.settingsSaved rereads the choice and forces a push', /public settingsSaved\(file: unknown\): void \{\s*this\.ui = uiFromFile\(file\);\s*this\.last = "";/.test(HUD));
    check("...the page's own save goes through it too", /if \(key === "cef::chat:saveSettings"\) \{\s*try \{ this\.settingsSaved\(JSON\.parse/.test(HUD));
    check("the native journal's save tells the HUD, with the file it wrote, right after writing it", /chat\.saveSettingsFile\(next\.file\);\s*(\/\/[^\n]*\n\s*)?this\.service\(NativeHudService, \(h\) => h\.settingsSaved\(next\.file\)\);/.test(read('src/services/services/settingsNativeService.ts')));
  }

  // ---- the wiring ----
  const SVC = read('src/services/services/settingsNativeService.ts');
  const MENU = read('src/services/services/scaleformMenuService.ts');
  const AS = read('swf/dbo_journal/tabs/settings.as');
  const sentKeys = Array.from(new Set((AS.match(/"set:[a-zA-Z]+"/g) || []).map((s) => s.slice(1, -1)).concat((AS.match(/setSay\("([a-zA-Z]+)"/g) || []).map((s) => 'set:' + s.slice(8, -1)))));
  const cases = (SVC.match(/case "set:[a-zA-Z]+"/g) || []).map((s) => s.slice(6, -1));
  check(`every set:* key the journal sends has a case in the service (${sentKeys.length})`, sentKeys.length >= 12 && sentKeys.every((k) => cases.includes(k)), sentKeys.filter((k) => !cases.includes(k)));
  check('index.ts registers the service', /new SettingsNativeService\(sp, controller\)/.test(read('src/index.ts')));
  check('the service registers for the set: keys with the Scaleform service', /onLocalKeys\(\(key, args\) => this\.onKey\(key, args\)\)/.test(SVC));
  check('an invoke runs only while that swf is up and ready', /if \(this\.state\.phase === "ready" && this\.state\.swf === a\.swf\) this\.sp\.Ui\.invokeString\(MENU_NAME, a\.target, a\.arg\)/.test(MENU));
  check('a file it could not read is never written over', /if \(!chat \|\| !file\) \{\s*this\.note = "Your settings file could not be read, so nothing was saved\.";/.test(SVC));
  check('chatService saves through its own writer, the page\'s', /public saveSettingsFile\(file: Record<string, unknown>\): void \{\s*this\.writeChatSettings\(JSON\.stringify\(file\)\);/.test(read('src/services/services/chatService.ts')));
  for (const f of ['keybindsService', 'fovService', 'mouseFreeService']) {
    check(`${f}: fromNative runs its own page-message handler`, /public fromNative\(args: unknown\[\]\): void \{\s*this\.onBrowserMessage\(\{ arguments: args \} as unknown as BrowserMessageEvent\);/.test(read(`src/services/services/${f}.ts`)));
  }
  check('the panel pushes to the functions the journal defines', /"_root\.dboLocal"/.test(SVC) && /"_root\.dboLocalLevel"/.test(SVC) && /_root\.dboLocal = function\(json\)/.test(AS) && /_root\.dboLocalLevel = function\(n\)/.test(AS));
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
