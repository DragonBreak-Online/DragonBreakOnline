// tradeService on the native path (Worker 4's router, openNative): the service is bundled with its imports stubbed, then
// driven through its packets and the router's onKey. Covered: native when the router takes it and the browser when it does
// not, one panel refreshed for every tradeState, the panel's keys handled as the browser's are, Cancel, the panel going on
// its own, failover, a trade too big for a Scaleform payload, and the browser focus an answered invite held.
//   node tests/native-trade-service-harness.js      (env ESBUILD_DIR, else the fork's skymp5-server esbuild)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const HERE = path.resolve(__dirname, '..');
const ESB = [process.env.ESBUILD_DIR, path.join(HERE, '../skymp5-server/node_modules/esbuild'), path.join(HERE, '../../../fork/skymp5-server/node_modules/esbuild')].find((d) => d && fs.existsSync(path.join(d, 'package.json')));
if (!ESB) { console.log('SKIP needs ESBUILD_DIR'); process.exit(0); }
const esbuild = require(ESB);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'trade-native-'));

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

// Everything the service imports from the game and the other services, as recorders the test reads back
fs.writeFileSync(path.join(TMP, 'stub.js'), `
const R = () => globalThis.__svcStub;
class ClientListener {}
const sendCustomPacket = (c, p) => R().packets.push(p);
const notifyNextUpdate = (c, sp, t) => R().notices.push(t);
const closeWidget = (sp, id) => R().browser.push({ close: id });
const readMenuKeyCode = (sp, k, d) => d;
const showUi = () => {};
const isMenuKeyPressBlocked = () => false;
const buttonKeyCode = (e) => e.code;
const logTrace = () => {};
class ScaleformMenuService {}
class EmoteService {}
class FunctionInfo { constructor(f) { this.f = f; } getText(vars) { R().browser.push({ widget: JSON.parse(JSON.stringify(vars)) }); return ''; } }
const getInventory = () => ({ entries: R().inv });
const effectsKey = () => '';
const isBoundItem = () => false;
const PROPERTY_KEY_BASE_ID = 0x7fffffff;
const DxScanCode = { Escape: 1, X: 45 };
const FormType = {};
const InputDeviceType = { Keyboard: 0 };
module.exports = { ClientListener, sendCustomPacket, notifyNextUpdate, closeWidget, readMenuKeyCode, showUi, isMenuKeyPressBlocked, buttonKeyCode,
  logTrace, ScaleformMenuService, EmoteService, FunctionInfo, getInventory, effectsKey, isBoundItem, PROPERTY_KEY_BASE_ID, DxScanCode, FormType, InputDeviceType };
`);
const STUBBED = /\/(clientListener|customPacketUtil|widgetMenuUtil|mouseKeys|logging|scaleformMenuService|emoteService|functionInfo|inventory)$|^skyrimPlatform$|connectionMessage$|customPacketMessage$/;

const bundle = async (name) => {
  const out = path.join(TMP, name + '.js');
  await esbuild.build({
    entryPoints: [path.join(HERE, `src/services/services/${name}.ts`)], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
    plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /.*/ }, (a) => (STUBBED.test(a.path) ? { path: path.join(TMP, 'stub.js') } : undefined)); } }],
  });
  return require(out);
};

const world = (nativeOn) => {
  const S = { packets: [], notices: [], browser: [], focus: [], native: [], owner: null, open: false, inv: [{ baseId: 0x5ace4, count: 12 }, { baseId: 0xf, count: 500 }] };
  globalThis.__svcStub = S;
  const handlers = {};
  const scaleform = {
    openNative: (o) => { if (!nativeOn) return false; S.owner = o; S.open = true; S.native.push({ open: o.type, id: o.widgetId, widget: JSON.parse(JSON.stringify(o.widget)) }); return true; },
    refreshNative: (wd, id) => S.native.push({ refresh: true, id, widget: JSON.parse(JSON.stringify(wd)) }),
    isNativeOpen: (t) => S.open && (!t || (S.owner && S.owner.type === t)),
    closeNative: (t) => { S.native.push({ close: t }); S.owner = null; S.open = false; },
  };
  const controller = {
    on: (ev, fn) => { handlers[ev] = fn; },
    once: (ev, fn) => fn(),
    emitter: { on: (ev, fn) => { handlers['emit:' + ev] = fn; } },
    lookupListener: () => scaleform,
  };
  const sp = { Game: { getPlayer: () => ({}), getFormEx: () => null }, browser: { executeJavaScript: () => {}, setVisible: () => {}, setFocused: (f) => S.focus.push(f) } };
  const packet = (content) => handlers['emit:customPacketMessage']({ message: { contentJsonDump: JSON.stringify(content) } });
  const browser = (...args) => handlers.browserMessage({ arguments: args });
  const key = (k, args) => S.owner.onKey(k, args || []);
  const tradeWidgets = () => S.browser.filter((x) => x.widget && x.widget.WIDGET_ID === 14);
  return { S, sp, controller, packet, browser, key, handlers, tradeWidgets };
};

const state = (extra) => Object.assign({ customPacketType: 'tradeState', partnerName: 'Lydia', myOffer: [], theirOffer: [], myLocked: false, theirLocked: false,
  bothLocked: false, iAccepted: false, theyAccepted: false }, extra || {});

(async () => {
  const { TradeService } = await bundle('tradeService');

  let w = world(true);
  new TradeService(w.sp, w.controller);
  w.packet(state());
  const n0 = w.S.native[0];
  ok(w.S.native.length === 1 && n0.open === 'trade' && n0.id === 14 && !w.tradeWidgets().length, 'a trade opens natively when the router takes it, and not in the browser', w.S.native);
  ok(n0.widget.type === 'trade' && n0.widget.id === 14 && n0.widget.partnerName === 'Lydia' && n0.widget.events.add === 'trade:add' && n0.widget.inventory.length === 2 && n0.widget.stackPromptThreshold === 1,
    'the panel gets the browser\'s widget: partner, inventory, events', n0.widget);
  const ingot = n0.widget.inventory.find((i) => i.baseId === 0x5ace4);
  w.key('trade:add', [ingot.lineId, 5]);
  const so = w.S.packets.pop();
  ok(so.customPacketType === 'tradeSetOffer' && so.items.length === 1 && so.items[0].baseId === 0x5ace4 && so.items[0].count === 5, 'trade:add from the panel sets the offer as the browser\'s does', so);
  w.packet(state({ myOffer: [{ baseId: 0x5ace4, count: 5 }] }));
  const r1 = w.S.native[1];
  ok(w.S.native.length === 2 && r1.refresh === true && r1.id === 14 && r1.widget.myOffer[0].count === 5 && r1.widget.inventory.find((i) => i.baseId === 0x5ace4).count === 7,
    'the next tradeState refreshes the same panel with the offer moved over', r1);
  w.key('trade:remove', [ingot.lineId, 2]);
  ok(w.S.packets.pop().items[0].count === 3, 'trade:remove takes some back');
  w.key('trade:add', [ingot.lineId, 99]);
  ok(w.S.packets.pop().items[0].count === 12, '...and an add is held to what you carry');
  w.key('trade:lock', []);
  ok(w.S.packets.pop().customPacketType === 'tradeLock', 'trade:lock locks');
  w.key('trade:accept', []);
  ok(w.S.packets.pop().customPacketType === 'tradeAccept', 'trade:accept accepts');
  w.key('trade:unlock', []);
  ok(w.S.packets.pop().customPacketType === 'tradeUnlock', 'trade:unlock unlocks');
  w.key('trade:cancel', []);
  ok(w.S.packets.pop().customPacketType === 'tradeCancel' && w.S.native.pop().close === 'trade', 'trade:cancel cancels and closes the native panel');
  ok(!w.S.focus.includes(true), 'the native window never takes the browser\'s focus', w.S.focus);
  w.packet(state());
  ok(w.S.native.pop().open === 'trade', 'a new trade after a cancel opens a new panel');

  w = world(true);
  new TradeService(w.sp, w.controller);
  w.packet(state());
  w.key('close', ['souls']);
  ok(w.S.packets.pop().customPacketType === 'tradeCancel', 'the panel going on its own ends the trade as a cancel');
  ok(!w.S.native.some((x) => x.close), '...with nothing left to close');

  w = world(true);
  new TradeService(w.sp, w.controller);
  w.packet(state());
  w.packet({ customPacketType: 'tradeCompleted' });
  ok(w.S.native.pop().close === 'trade' && w.S.notices.includes('Trade complete.'), 'a completed trade closes the native panel');
  w.packet(state());
  w.packet({ customPacketType: 'tradeCancelled', reason: 'Lydia walked away.' });
  ok(w.S.native.pop().close === 'trade', 'so does a trade the partner cancelled');

  w = world(true);
  new TradeService(w.sp, w.controller);
  w.packet(state());
  w.key('native:failed', []);
  ok(w.tradeWidgets().length === 1 && w.S.focus.slice(-1)[0] === true, 'a panel that could not be drawn falls back to the browser window, focused');
  w.packet(state());
  ok(w.tradeWidgets().length === 2 && w.S.native.filter((x) => x.open).length === 1, '...for the rest of that trade');
  w.browser('trade:add', w.tradeWidgets()[1].widget.tradeData.inventory[1].lineId, 3);
  ok(w.S.packets.pop().customPacketType === 'tradeSetOffer', 'the browser window still sends its keys');

  w = world(true);
  new TradeService(w.sp, w.controller);
  w.packet(state());
  // past MAX_PAYLOAD_CHARS, which is 400,000 since big payloads go in pieces (native-chunked-1102): about 0.7 million here
  for (let i = 0; i < 3000; i++) w.S.inv.push({ baseId: 0x100000 + i, count: 1, name: 'A very long and rather unlikely item name, one of a great many in a merchant\'s pack, number ' + i + ' of a very full inventory' });
  w.packet(state());
  ok(w.S.native.pop().close === 'trade' && w.tradeWidgets().length === 1, 'a trade grown past a Scaleform payload moves to the browser');
  w.packet(state());
  ok(w.tradeWidgets().length === 2 && !w.S.native.some((x) => x.refresh), '...and stays there');
  w.S.inv.splice(2);
  w.packet(state());
  ok(w.tradeWidgets().length === 3 && !w.S.native.some((x) => x.open && w.S.native.indexOf(x) > 0), '...even once it is small again: the window does not flip mid-trade');

  w = world(false);
  new TradeService(w.sp, w.controller);
  w.packet(state());
  ok(w.tradeWidgets().length === 1 && !w.S.native.length && w.S.focus.slice(-1)[0] === true, 'without the native panel the browser window opens, unchanged');

  w = world(true);
  new TradeService(w.sp, w.controller);
  w.packet({ customPacketType: 'tradeInvite', fromName: 'Lydia' });
  w.handlers.buttonEvent({ isDown: true, code: 45 });
  ok(w.S.focus.slice(-1)[0] === true, 'the interact key gives a waiting invite the browser focus');
  w.packet(state());
  ok(w.S.native.length === 1 && w.S.focus.slice(-1)[0] === false, 'the trade opening natively hands that focus back');

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed', e); process.exit(1); });
