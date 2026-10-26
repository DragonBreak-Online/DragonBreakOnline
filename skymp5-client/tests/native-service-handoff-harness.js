// bountyBoardService and housingService on the native path (Worker 4's router, openNative): each service is bundled with its
// imports stubbed, then driven through its packets and the router's onKey. Covered: native when the router takes it, the
// browser when it does not, the panel's keys handled as the browser's are, the typed-input hand-off to the browser and the
// way back once the server answers the post or rename (and not on anyone else's refresh), close and failover.
//   node tests/native-service-handoff-harness.js      (env ESBUILD_DIR, else the fork's skymp5-server esbuild)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const HERE = path.resolve(__dirname, '..');
const ESB = [process.env.ESBUILD_DIR, path.join(HERE, '../skymp5-server/node_modules/esbuild'), path.join(HERE, '../../../fork/skymp5-server/node_modules/esbuild')].find((d) => d && fs.existsSync(path.join(d, 'package.json')));
if (!ESB) { console.log('SKIP needs ESBUILD_DIR'); process.exit(0); }
const esbuild = require(ESB);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-native-'));

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

// Everything the two services import, as recorders the test reads back
fs.writeFileSync(path.join(TMP, 'stub.js'), `
const R = () => globalThis.__svcStub;
class ClientListener {}
const sendCustomPacket = (c, p) => R().packets.push(p);
const parseCustomPacket = (e) => e;
const notifyNextUpdate = (c, sp, t) => R().notices.push(t);
const openFormMenu = (sp, setter, args) => R().browser.push({ open: true, args: JSON.parse(JSON.stringify(args)) });
const closeFormMenu = (sp, id) => R().browser.push({ close: id });
const readMenuKeyCode = () => 45;
const isMenuKeyPressBlocked = () => false;
const buttonKeyCode = (e) => e.code;
const localIdToRemoteId = (x) => x;
const logTrace = () => {};
class ScaleformMenuService {}
const DxScanCode = { Escape: 1, X: 45 };
const InputDeviceType = { Keyboard: 0 };
module.exports = { ClientListener, sendCustomPacket, parseCustomPacket, notifyNextUpdate, openFormMenu, closeFormMenu, readMenuKeyCode,
  isMenuKeyPressBlocked, buttonKeyCode, localIdToRemoteId, logTrace, ScaleformMenuService, DxScanCode, InputDeviceType, Actor: {} };
`);
const STUBBED = /\/(clientListener|customPacketUtil|widgetMenuUtil|mouseKeys|logging|scaleformMenuService|worldViewMisc)$|^skyrimPlatform$|connectionMessage$|customPacketMessage$/;

const bundle = async (name) => {
  const out = path.join(TMP, name + '.js');
  await esbuild.build({
    entryPoints: [path.join(HERE, `src/services/services/${name}.ts`)], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
    plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /.*/ }, (a) => (STUBBED.test(a.path) ? { path: path.join(TMP, 'stub.js') } : undefined)); } }],
  });
  return require(out);
};

const world = (nativeOn) => {
  const S = { packets: [], notices: [], browser: [], native: [], owner: null };
  globalThis.__svcStub = S;
  const handlers = {};
  const scaleform = {
    openNative: (o) => { if (!nativeOn) return false; S.owner = o; S.native.push({ open: o.type, widget: JSON.parse(JSON.stringify(o.widget)) }); return true; },
    closeNative: (t) => { S.native.push({ close: t }); S.owner = null; },
  };
  const controller = {
    on: (ev, fn) => { handlers[ev] = fn; },
    emitter: { on: (ev, fn) => { handlers['emit:' + ev] = fn; } },
    lookupListener: () => scaleform,
  };
  const packet = (content) => handlers['emit:customPacketMessage'](content);
  const browser = (...args) => handlers.browserMessage({ arguments: args });
  const key = (k, args) => S.owner.onKey(k, args || []);
  return { S, controller, packet, browser, key, handlers };
};

(async () => {
  const { BountyBoardService } = await bundle('bountyBoardService');
  const { HousingService } = await bundle('housingService');

  // ---- the notice board ----
  const menu = (reason, extra) => Object.assign({ customPacketType: 'bountyBoardMenu', reason, board: 'bruma', boardName: 'Bruma', costGold: 30, gold: 100, maxTextLen: 600, maxNotes: 40, expiryDays: 7,
    tabs: [{ id: 'shop', label: 'Shop Ads', cost: 30, canPost: true }], notes: [] }, extra || {});
  let w = world(true);
  new BountyBoardService({}, w.controller);
  w.packet(menu('open'));
  ok(w.S.native.length === 1 && w.S.native[0].open === 'bountyBoard' && !w.S.browser.length, 'a board opens natively when the router takes it, and not in the browser');
  const nw = w.S.native[0].widget;
  ok(nw.type === 'bountyBoard' && nw.id === 26 && nw.boardName === 'Bruma' && nw.events.post === 'bountyBoard:post' && nw.tabs.length === 1, 'the native panel gets the same widget the browser does', nw);
  w.key('bountyBoard:post', ['shop', '  Iron, cheap  ']);
  ok(w.S.packets.pop().text === 'Iron, cheap', 'a post from the native panel is sent to the server as the browser one is, trimmed');
  w.key('bountyBoard:remove', [7]);
  ok(w.S.packets.pop().customPacketType === 'bountyBoardRemove', 'so is Take down');
  w.key('native:handoff', ['bountyBoard', 'compose:shop']);
  const comp = w.S.browser.pop();
  ok(comp.open && comp.args.handoff === 'compose:shop', 'the hand-off opens the browser board in composer mode for that tab', comp);
  w.packet(menu('refresh'));
  ok(w.S.native.length === 1 && w.S.browser.pop().args.handoff === 'compose:shop', "someone else's post meanwhile redraws the composer, it does not end it");
  w.browser('bountyBoard:post', 'shop', 'Mead for sale');
  ok(w.S.packets.pop().text === 'Mead for sale', 'the composer posts');
  w.packet({ customPacketType: 'bountyBoardNotice', text: 'The pin is still warm; give it a moment.' });
  w.packet(menu('refresh'));
  ok(w.S.native.length === 1 && w.S.browser.pop().args.handoff === 'compose:shop', 'a refused post keeps the composer: a foreign refresh after it does not end it (Worker 6)');
  w.browser('bountyBoard:post', 'shop', 'Mead for sale');
  w.packet({ customPacketType: 'bountyBoardNotice', text: 'Your notice is pinned to the board.' });
  w.packet(menu('refresh'));
  ok(w.S.browser.some((x) => x.close === 26) && w.S.native.length === 2 && w.S.native[1].open === 'bountyBoard', 'the refresh after our post closes the composer and brings the native board back');
  w.key('bountyBoard:close', []);
  ok(w.S.native.pop().close === 'bountyBoard' && w.S.packets.pop().customPacketType === 'bountyBoardClose', 'Close closes the native board and ends the board session');
  w = world(true);
  new BountyBoardService({}, w.controller);
  w.packet(menu('open'));
  w.key('close', ['souls']);
  ok(w.S.packets.pop().customPacketType === 'bountyBoardClose', 'the panel going on its own (a walk-away) ends the board session too');
  w.handlers['emit:browserWindowLoaded']();
  ok(!w.S.packets.length, '...and a later front reload sends no second close');
  w = world(true);
  new BountyBoardService({}, w.controller);
  w.packet(menu('open'));
  w.key('native:failed', []);
  ok(w.S.browser.pop().open === true, 'a panel that could not be drawn falls back to the browser board');
  w = world(false);
  new BountyBoardService({}, w.controller);
  w.packet(menu('open'));
  ok(w.S.browser.length === 1 && w.S.browser[0].args.handoff === '' && !w.S.native.length, 'without the native panel the browser board opens, unchanged');

  // the client keys on the server's own words: the pinned notice must still be what bountyBoardSystem sends (Worker 6)
  const sys = fs.readFileSync(path.join(HERE, '../skymp5-server/ts/systems/bountyBoardSystem.ts'), 'utf8');
  const svc = fs.readFileSync(path.join(HERE, 'src/services/services/bountyBoardService.ts'), 'utf8');
  const pinned = (svc.match(/const PINNED = \/\^([^/]+)\//) || [])[1];
  ok(pinned && sys.includes('this.notice(ctx, userId, "' + pinned), 'bountyBoardSystem still sends the notice the client waits for', pinned);

  // ---- the property menu ----
  const prop = (extra) => Object.assign({ customPacketType: 'propertyMenu', target: 0x5000, view: 'owner', owned: true, name: 'Rose Hall', locked: false, hasKeys: true, canGrantContainers: false, ownerName: 'Olaf', keyRing: true }, extra || {});
  w = world(true);
  const h = new HousingService({ Game: {} }, w.controller);
  h.target = 0x5000;
  w.packet(prop());
  ok(w.S.native.length === 1 && w.S.native[0].open === 'housing' && w.S.native[0].widget.view === 'owner' && w.S.native[0].widget.events.lock === 'housing:lock', 'a property menu opens natively with the browser widget');
  w.key('housing:lock', []);
  ok(w.S.packets.pop().action === 'lock', 'Lock from the native menu is the browser request');
  w.key('native:handoff', ['housing', 'rename']);
  ok(w.S.browser.pop().args.handoff === 'rename', 'Rename hands the name box to the browser');
  w.browser('housing:rename', 'Thorn Hall');
  const rn = w.S.packets.pop();
  ok(rn.action === 'rename' && rn.name === 'Thorn Hall', 'the browser box renames');
  w.packet(prop({ name: 'Thorn Hall' }));
  ok(w.S.browser.some((x) => x.close === 8) && w.S.native.pop().open === 'housing', 'the answer brings the native menu back');
  w.key('housing:transfer', []);
  ok(w.S.native.pop().close === 'housing' && /Look at the recipient/.test(w.S.notices.pop()), 'Transfer closes the native menu and waits for the recipient');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e.stack || e.message)); process.exit(1); });
