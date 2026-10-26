// emoteService on the native path (Worker 4's router, openNative; swf/dbo_emotes): the service is bundled with its imports
// stubbed, then driven through its key, the router's onKey and its browser messages. Covered: native when the router takes
// it, with the widget object the panel reads; the browser when it does not, or after native:failed; the panel's keys
// handled as the browser's are; close from either side; the browser-cursor watch leaving the native wheel alone.
//   node tests/native-emote-service-harness.js      (env ESBUILD_DIR, else the fork's skymp5-server esbuild)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const HERE = path.resolve(__dirname, '..');
const ESB = [process.env.ESBUILD_DIR, path.join(HERE, '../skymp5-server/node_modules/esbuild'), 'E:/DragonBreak Online Dev files/fork/skymp5-server/node_modules/esbuild'].find((d) => d && fs.existsSync(path.join(d, 'package.json')));
if (!ESB) { console.log('SKIP needs ESBUILD_DIR'); process.exit(0); }
const esbuild = require(ESB);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'emote-native-'));

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

// Everything the service imports that touches the game, as recorders the test reads back
fs.writeFileSync(path.join(TMP, 'stub.js'), `
const R = () => globalThis.__svcStub;
class ClientListener {}
class ScaleformMenuService {}
class RestraintService {}
class BrowserService {}
const notifyNextUpdate = (c, sp, t) => R().notices.push(t);
const parseCustomPacket = (e) => e;
const openFormMenu = (sp, setter, args) => R().browser.push({ open: true, args: JSON.parse(JSON.stringify(args)) });
const closeFormMenu = (sp, id) => R().browser.push({ close: id });
const readMenuKeyCode = (sp, name, fallback) => fallback;
const isGameInputBlocked = () => false;
const isMenuKeyPressBlocked = () => false;
const menuKeyBlockReason = () => '';
const isConsoleOpen = () => false;
const buttonKeyCode = (e) => e.code;
const GamepadButton = { LeftThumb: 64 };
const isGamepadChord = () => false;
const emoteNote = (t) => R().notes.push(t);
const logTrace = () => {};
const DxScanCode = new Proxy({ Escape: 1, B: 48 }, { get: (o, k) => (k in o ? o[k] : 1000) });
const InputDeviceType = { Keyboard: 0 };
module.exports = { ClientListener, ScaleformMenuService, RestraintService, BrowserService, notifyNextUpdate, parseCustomPacket, openFormMenu, closeFormMenu,
  readMenuKeyCode, isGameInputBlocked, isMenuKeyPressBlocked, menuKeyBlockReason, isConsoleOpen, buttonKeyCode, GamepadButton, isGamepadChord, emoteNote,
  logTrace, DxScanCode, InputDeviceType };
`);
const STUBBED = /\/(clientListener|customPacketUtil|widgetMenuUtil|mouseKeys|gamepadKeys|restraintService|browserService|emoteDiag|scaleformMenuService)$|logging$|^skyrimPlatform$|connectionMessage$|customPacketMessage$/;

const world = (nativeOn, focused) => {
  const S = { notices: [], browser: [], native: [], notes: [], owner: null, focused: focused !== false };
  globalThis.__svcStub = S;
  const handlers = {};
  const scaleform = {
    openNative: (o) => { if (!nativeOn) return false; S.owner = o; S.native.push({ open: o.type, widgetId: o.widgetId, widget: JSON.parse(JSON.stringify(o.widget)) }); return true; },
    closeNative: (t) => { S.native.push({ close: t }); S.owner = null; },
  };
  const controller = {
    on: (ev, fn) => { handlers[ev] = fn; },
    emitter: { on: (ev, fn) => { handlers['emit:' + ev] = fn; } },
    // one object answers every lookup (the router, the restraint and browser services): the bundle has its own stub classes
    lookupListener: () => Object.assign(scaleform, { isPoseLocked: false, liveBlockingMenus: () => [] }),
    once: () => {},
  };
  const sp = {
    hooks: { sendAnimationEvent: { add: () => {} } }, browser: { isFocused: () => S.focused }, Game: { getPlayer: () => null },
    Utility: { wait: () => ({ then: () => {} }) }, Debug: { sendAnimationEvent: () => {} },
  };
  const press = (code) => handlers.buttonEvent({ code, isDown: true, device: 0 });
  const browser = (...args) => handlers.browserMessage({ arguments: args });
  const key = (k, args) => S.owner.onKey(k, args || []);
  return { S, sp, controller, press, browser, key, handlers };
};

(async () => {
  const out = path.join(TMP, 'emoteService.js');
  await esbuild.build({
    entryPoints: [path.join(HERE, 'src/services/services/emoteService.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
    plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /.*/ }, (a) => (STUBBED.test(a.path) ? { path: path.join(TMP, 'stub.js') } : undefined)); } }],
  });
  const { EmoteService } = require(out);
  const B = 48;

  let w = world(true);
  let svc = new EmoteService(w.sp, w.controller);
  w.press(B);
  const o = w.S.native[0];
  ok(o && o.open === 'emoteWheel' && o.widgetId === 24 && !w.S.browser.length, 'B opens the wheel natively when the router takes it, and not in the browser', w.S);
  ok(o.widget.type === 'emoteWheel' && o.widget.id === 24 && o.widget.groups.length === 6 && o.widget.events.play === 'emote:play' && o.widget.events.stop === 'emote:stop' && o.widget.events.close === 'emote:close',
    'the router gets the widget object the panel reads: type, id, the six groups and the events', o.widget);
  w.S.focused = false;
  { const realNow = Date.now; let fake = realNow(); Date.now = () => fake; fake += 1200; w.handlers.update(); for (let i = 0; i < 10; i++) { fake += 300; w.handlers.update(); } Date.now = realNow; }
  ok(!w.S.native.some((x) => x.close), 'the browser-cursor watch leaves the native wheel up (it never has the cursor), however long', w.S.native);
  w.S.focused = true;
  w.key('emote:play', ['IdleWave']);
  ok(w.S.native.some((x) => x.close === 'emoteWheel') && w.S.notes.some((n) => /^play IdleWave/.test(n)), 'emote:play from the panel plays as the browser\'s does, and closes the native wheel', w.S.notes);
  w.S.native.length = 0;
  w.press(B);
  w.key('close', ['selfClosed']);
  ok(!w.S.native.some((x) => x.close), 'the panel closing itself clears the wheel without closing it again', w.S.native);
  w.press(B);
  ok(w.S.native.filter((x) => x.open).length === 2, 'and B opens it again (the service knew it had gone)');
  w.press(B);
  ok(w.S.native.some((x) => x.close === 'emoteWheel'), 'B while it is up takes the native wheel down');
  w.press(B);
  w.press(1);
  ok(w.S.native.filter((x) => x.close === 'emoteWheel').length === 2, 'Escape takes it down too');
  w.press(B);
  w.key('emote:stop', []);
  ok(w.S.native.filter((x) => x.close === 'emoteWheel').length === 3 && w.S.notes.some((n) => /closed .*the wheel's stop/.test(n)), 'emote:stop closes it and stops the emote', w.S.notes);

  // failover: the panel cannot be drawn
  w = world(true);
  svc = new EmoteService(w.sp, w.controller);
  w.press(B);
  w.key('native:failed', ['timeout']);
  ok(w.S.browser.length === 1 && w.S.browser[0].open && w.S.browser[0].args.WIDGET_ID === 24, 'native:failed opens the browser wheel for this opening', w.S.browser);
  w.browser('emote:close');
  ok(w.S.browser.some((x) => x.close === 24), 'the browser wheel then closes as before');
  w.press(B);
  ok(w.S.native.filter((x) => x.open).length === 2, 'the next opening tries the native wheel again (the router decides whether it failed this session)');

  // the router declines
  w = world(false);
  svc = new EmoteService(w.sp, w.controller);
  w.press(B);
  ok(w.S.browser.length === 1 && w.S.browser[0].open && !w.S.native.length, 'without the native panel the browser wheel opens, as before');
  w.browser('emote:play', 'IdleSalute');
  ok(w.S.browser.some((x) => x.close === 24) && w.S.notes.some((n) => /^play IdleSalute/.test(n)), 'and its emote:play plays and closes it, as before', w.S.notes);
  w.press(B);
  w.S.focused = false;
  // the watch's clock: past its open grace, then a watch period at a time until it gives up on the cursor
  const realNow = Date.now; let fake = realNow();
  Date.now = () => fake;
  fake += 1200; w.handlers.update();
  for (let i = 0; i < 10; i++) { fake += 300; w.handlers.update(); }
  Date.now = realNow;
  ok(w.S.browser.filter((x) => x.close === 24).length === 2, 'the browser wheel without the cursor is still taken down by the watch', w.S.browser);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e.stack || e.message)); process.exit(1); });
