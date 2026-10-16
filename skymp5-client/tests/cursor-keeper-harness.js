// Scripted test for the game's pointer ("Cursor Menu") around the browser's focus (#bugs "Mouse disappearing in in-game
// menus", 15 Oct: "When opening my inventory or storages my cursor doesn't appear").
// SkyrimPlatform's SetFocused is ported line for line from BrowserApiTilted.cpp (source 02626f15 of the shipped
// SkyrimPlatformImpl.dll): focus opens the pointer when it is not up and remembers that it did; the end of that focus
// closes it, whatever opened since. The game is modelled as the server's input reports show it: a menu that shows the
// pointer opens it, and a menu closing with no such menu left closes it (Fader Menu closing under a focused panel did so
// in 36 of the reports). BrowserService and widgetMenuUtil are the real ones, bundled with esbuild on a stubbed platform.
// Run it from skymp5-client with node_modules present (esbuild is borrowed from ../skymp5-server/node_modules):
//
//   node tests/cursor-keeper-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const client = path.resolve(__dirname, '..');
const services = path.join(client, 'src', 'services', 'services');
const ts = require(path.join(client, 'node_modules', 'typescript'));
const esbuild = require(require.resolve('esbuild', { paths: [client, path.resolve(client, '..', 'skymp5-server')] }));

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const CURSOR = 'Cursor Menu';
// Menus that show the pointer for a mouse player (the game's own list is not readable; these are the ones the reports show it in)
const SHOWS_POINTER = new Set(['InventoryMenu', 'ContainerMenu', 'BarterMenu', 'GiftMenu', 'Journal Menu', 'MapMenu', 'TweenMenu',
  'Crafting Menu', 'RaceSex Menu', 'Console', 'MessageBoxMenu', 'Dialogue Menu', 'Main Menu']);

function makeGame() {
  const g = {
    open: new Set(['HUD Menu']), queue: [], late: [], events: [], focus: false, cursorIsOpenByFocus: false, visible: false,
    controllerMode: false, lateCursorHide: false, ignoreCursorShow: false, focusCalls: 0,
  };
  // BrowserApiTilted::SetFocused
  g.setFocused = (newFocus) => {
    g.focusCalls++;
    if (g.focus === newFocus) return;
    g.focus = newFocus;
    const alreadyOpen = g.open.has(CURSOR);
    if (newFocus) {
      if (!alreadyOpen) { g.queue.push([CURSOR, 'show']); g.cursorIsOpenByFocus = true; }
    } else if (g.cursorIsOpenByFocus) {
      g.queue.push([CURSOR, 'hide']); g.cursorIsOpenByFocus = false;
    }
  };
  g.openMenu = (name) => g.queue.push([name, 'show']);
  g.closeMenu = (name) => g.queue.push([name, 'hide']);
  // UIMessageQueue, once a frame
  g.process = () => {
    g.queue.unshift(...g.late.splice(0));
    while (g.queue.length) {
      const [name, type] = g.queue.shift();
      if (type === 'show') {
        if (g.open.has(name)) continue;
        if (name === CURSOR && g.ignoreCursorShow) continue;
        g.open.add(name);
        if (name !== CURSOR) g.events.push(['menuOpen', name]);
        if (SHOWS_POINTER.has(name) && !g.controllerMode) g.queue.push([CURSOR, 'show']);
      } else {
        if (!g.open.has(name)) continue;
        g.open.delete(name);
        if (name !== CURSOR) g.events.push(['menuClose', name]);
        if (name !== CURSOR && ![...g.open].some((m) => SHOWS_POINTER.has(m))) (g.lateCursorHide ? g.late : g.queue).push([CURSOR, 'hide']);
      }
    }
  };
  return g;
}

(async () => {
  // ---- the decision module ----
  const keeperPath = path.join(services, 'cursorKeeper.ts');
  let K = null;
  if (fs.existsSync(keeperPath)) {
    const js = ts.transpileModule(fs.readFileSync(keeperPath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
    K = {}; new Function('exports', js)(K);
  }
  check('cursorKeeper.ts is there', !!K);
  if (K) {
    const s0 = K.initialPanelCursorState();
    const at = (o) => Object.assign({ focused: true, visible: true, cursorMenuOpen: false, blockingMenuOpen: false, now: 10000 }, o);
    let r = K.keepPanelCursor(at({}), s0);
    check('a pointer just found closed under focus is given its frames first', r.action === 'none' && r.state.missingSince === 10000);
    r = K.keepPanelCursor(at({ now: 10000 + K.RESHOW_AFTER_MS }), r.state);
    check('...and put back once it has stayed closed', r.action === 'reshow' && r.state.lastReshow === 10000 + K.RESHOW_AFTER_MS);
    check('nothing while the pointer is up', K.keepPanelCursor(at({ cursorMenuOpen: true, now: 20000 }), s0).action === 'none');
    check('nothing without the focus or with the page hidden', K.keepPanelCursor(at({ focused: false, now: 20000 }), { ...s0, missingSince: 1 }).action === 'none'
      && K.keepPanelCursor(at({ visible: false, now: 20000 }), { ...s0, missingSince: 1 }).action === 'none');
    check('nothing under a vanilla menu that takes the keyboard: the pointer is that menu\'s', K.keepPanelCursor(at({ blockingMenuOpen: true, now: 20000 }), { ...s0, missingSince: 1 }).action === 'none');
    let st = s0, n = 0, t = 30000;
    for (let i = 0; i < 400; i++, t += 50) { const x = K.keepPanelCursor(at({ now: t }), st); st = x.state; if (x.action === 'reshow') n++; }
    check(`a pointer that never comes back is tried ${K.MAX_FAILED_RESHOWS} times, at most once per ${K.RESHOW_GAP_MS} ms, then left`, n === K.MAX_FAILED_RESHOWS && st.failedReshows === K.MAX_FAILED_RESHOWS, { n, st });
    const w = K.watchVanillaMenu('InventoryMenu', 1000, false);
    check('the inventory and containers are watched, the HUD is not', !!w && !!K.watchVanillaMenu('ContainerMenu', 0, false) && K.watchVanillaMenu('HUD Menu', 0, false) === null);
    check('a vanilla menu with its pointer is never reported', K.checkVanillaMenu(w, true, 9000) === 'none' && w.missingSince === 0);
    K.checkVanillaMenu(w, false, 10000);
    check('...one without it is reported once, after a moment', K.checkVanillaMenu(w, false, 10000 + K.VANILLA_REPORT_MS - 1) === 'none'
      && K.checkVanillaMenu(w, false, 10000 + K.VANILLA_REPORT_MS) === 'report' && K.checkVanillaMenu(w, false, 20000) === 'none');
    check('the controller notice needs controller mode, a pointerless menu and no earlier notice',
      K.controllerNoticeDue(w, 20000, true, false) && !K.controllerNoticeDue(w, 20000, false, false) && !K.controllerNoticeDue(w, 20000, null, false)
      && !K.controllerNoticeDue(w, 20000, true, true) && !K.controllerNoticeDue(null, 20000, true, false));
    check('...and not when our own release emptied the menu', !K.controllerNoticeDue(Object.assign({}, w, { focusedAtOpen: true }), 20000, true, false));
    check('the notice tells the player what to do, in plain words', /Controller to Off in Settings, Gameplay/.test(K.CONTROLLER_NOTICE) && !/[—–]/.test(K.CONTROLLER_NOTICE));
  }

  // ---- BrowserService and widgetMenuUtil on the modelled game ----
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-cursor-keeper-'));
  const stubs = {
    skyrimPlatform: `module.exports = {
      DxScanCode: { Enter: 28, T: 20, F6: 64, F1: 59, F2: 60, F8: 66, Escape: 1, Tab: 15 },
      Menu: { Barter: "BarterMenu", Book: "Book Menu", Console: "Console", ConsoleNativeUI: "Console Native UI Menu", Container: "ContainerMenu",
        Crafting: "Crafting Menu", Cursor: "Cursor Menu", Gift: "GiftMenu", HUD: "HUD Menu", Inventory: "InventoryMenu", Journal: "Journal Menu",
        Lockpicking: "Lockpicking Menu", Loading: "Loading Menu", Main: "Main Menu", Map: "MapMenu", RaceSex: "RaceSex Menu", Stats: "StatsMenu",
        Tween: "TweenMenu", MessageBox: "MessageBoxMenu", Fader: "Fader Menu" },
      InputDeviceType: { Keyboard: 0, Mouse: 1, Gamepad: 2 },
      once: (ev, fn) => globalThis.__harnessOnce(ev, fn), on: () => {},
    };`,
    '../../view/formView': 'module.exports = { FormView: { isDisplayingNicknames: false } };',
    './systemNotification': 'module.exports = { showSystemNotification: (sp, t) => globalThis.__harnessNotices.push(t) };',
    '../../logging': 'module.exports = { logTrace: () => {}, logError: () => {} };',
    './placementService': 'module.exports = { PlacementService: class {} };',
    './perfDiag': 'module.exports = { updateTiming: { setLabel: () => {} } };',
  };
  fs.writeFileSync(path.join(out, 'entry.ts'),
    `export { BrowserService } from ${JSON.stringify(path.join(services, 'browserService'))};\n` +
    `export * as wmu from ${JSON.stringify(path.join(services, 'widgetMenuUtil'))};\n`);
  await esbuild.build({
    entryPoints: [path.join(out, 'entry.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'bundle.js'), logLevel: 'error',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /^(skyrimPlatform|\.\.\/\.\.\/view\/formView|\.\/systemNotification|\.\.\/\.\.\/logging|\.\/placementService|\.\/perfDiag)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubs[a.path], loader: 'js' }));
      },
    }],
  });
  const { BrowserService, wmu } = require(path.join(out, 'bundle.js'));

  let clock = 1000000;
  const realNow = Date.now;
  Date.now = () => clock;

  function world(opts) {
    const g = makeGame();
    Object.assign(g, opts || {});
    const handlers = {}, emitted = {}, onces = [];
    const page = [];
    const notes = [];
    globalThis.__harnessNotices = [];
    globalThis.__dboDiagNote = (kind, text) => notes.push(kind + ' ' + text);
    globalThis.__harnessOnce = (ev, fn) => { if (ev === 'update') onces.push(fn); };
    const sp = {
      browser: { setVisible: (v) => { g.visible = v; }, isVisible: () => g.visible, isFocused: () => g.focus, setFocused: (v) => g.setFocused(v),
        executeJavaScript: (s) => page.push(s) },
      settings: {},
      Utility: { isInMenuMode: () => [...g.open].some((m) => m !== 'HUD Menu' && m !== CURSOR), getINIBool: (k) => /^bGamepadEnable:/i.test(k) ? g.controllerMode : false },
      Ui: { isMenuOpen: (n) => g.open.has(n) },
    };
    let bs = null;
    const controller = {
      emitter: { on: (ev, fn) => (emitted[ev] = emitted[ev] || []).push(fn), emit: (ev, e) => (emitted[ev] || []).forEach((f) => f(e)) },
      on: (ev, fn) => (handlers[ev] = handlers[ev] || []).push(fn),
      once: (ev, fn) => { if (ev === 'update') onces.push(fn); },
      lookupListener: (cls) => (cls === BrowserService ? bs : { isActive: () => false }),
    };
    bs = new BrowserService(sp, controller);
    const fire = (ev, e) => (handlers[ev] || []).forEach((f) => f(e));
    const w = {
      g, sp, bs, controller, page, notes,
      tick(ms) {
        clock += ms === undefined ? 16 : ms;
        for (const [type, name] of g.events.splice(0)) fire(type, { name });
        for (const f of onces.splice(0)) f();
        fire('update');
        g.process();
      },
      run(ms) { for (let t = 0; t < ms; t += 16) w.tick(16); },
      press(...codes) { (emitted.queryKeyCodeBindings || []).forEach((f) => f({ isDown: (keys) => keys.some((k) => codes.includes(k)) })); },
      button(device, code) { fire('buttonEvent', { device, code, isDown: true, isUp: false }); },
      pointer: () => g.open.has(CURSOR),
    };
    w.tick(); w.tick();   // onceUpdate: the page is shown
    return w;
  }

  // ---- unchanged behaviour ----
  {
    const w = world();
    w.press(20); w.run(100);
    check('T opens the chat with the pointer', w.g.focus && w.pointer());
    w.press(1); w.run(100);
    check('Escape hands the keyboard back and the pointer goes with it', !w.g.focus && !w.pointer());
    w.g.openMenu('InventoryMenu'); w.run(100);
    check('Tab: the inventory has its pointer', w.g.open.has('InventoryMenu') && w.pointer());
    w.g.closeMenu('InventoryMenu'); w.run(100);
    check('...which closes with it', !w.pointer());
    const calls = w.g.focusCalls;
    w.press(20); w.run(10000);
    check('ten seconds of chat with the pointer up: the focus is never touched', w.g.focusCalls === calls + 1 && w.pointer(), w.g.focusCalls - calls);
  }

  // ---- a vanilla menu closing under a focused panel ----
  for (const menu of ['Fader Menu', 'MessageBoxMenu']) {
    const w = world();
    w.press(20); w.run(100);
    w.g.openMenu(menu); w.run(200); w.g.closeMenu(menu); w.tick();
    check(`${menu} closing under the chat takes the chat's pointer (the reports' case)`, w.g.focus && !w.pointer());
    w.run(500);
    check(`...and the chat has it again within half a second`, w.g.focus && w.pointer());
    check('...without the page being told it lost focus', !w.page.some((s) => /browserUnfocused/.test(s)));
    check('...and the repair is in the diag relay', w.notes.some((n) => /^cursor panel pointer put back after \d+ ms closed under focus \(1 this session\)$/.test(n)), w.notes);
  }

  {
    const w = world();
    w.press(20); w.run(100);
    for (let i = 0; i < 15; i++) { w.g.openMenu('Fader Menu'); w.run(100); w.g.closeMenu('Fader Menu'); w.run(2500); }
    const lines = w.notes.filter((n) => /^cursor /.test(n)).length;
    check('fifteen repairs in a session all work, and the relay hears of at most eight', w.g.focus && w.pointer() && lines === 8, { lines });
  }

  // ---- a deferred panel handed the focus while the game is still closing the pointer ----
  {
    const w = world({ lateCursorHide: true });
    w.g.openMenu('InventoryMenu'); w.run(100);
    wmu.openFormMenu(w.sp, () => {}, {}, w.controller);
    check('a panel opened over the inventory waits for the keyboard', !w.g.focus);
    w.g.closeMenu('InventoryMenu'); w.run(100);
    const lost = w.g.focus && !w.pointer();
    w.run(500);
    check('the handover after the inventory closed ends with the pointer up', w.g.focus && w.pointer(), { lostOnTheWay: lost });
  }

  // ---- a vanilla menu opened while the browser has focus ----
  {
    const w = world();
    w.press(20); w.run(100);
    w.g.openMenu('ContainerMenu'); w.run(100);
    check('a container the game opens while the chat has focus loses its pointer to the release (needs SkyrimPlatform)', w.g.open.has('ContainerMenu') && !w.g.focus && !w.pointer());
    w.run(2000);
    check('...which the diag relay reports, with the focus named', w.notes.some((n) => /^cursor ContainerMenu open \d+ ms, no pointer for \d+ ms; browser had focus when it opened true; controller mode false$/.test(n)), w.notes);
    w.button(1, 256);
    check('...and no controller notice for it', globalThis.__harnessNotices.length === 0);
  }
  {
    const w = world();
    const has = typeof wmu.releaseFocusBeforeVanillaMenu === 'function';
    check('widgetMenuUtil has releaseFocusBeforeVanillaMenu', has);
    w.press(20); w.run(100);
    if (has) wmu.releaseFocusBeforeVanillaMenu(w.sp, w.controller);
    w.g.openMenu('ContainerMenu'); w.run(100);
    check('a container the client opens with the focus released first keeps its pointer', w.g.open.has('ContainerMenu') && !w.g.focus && w.pointer());
    check('...and the page heard the release', w.page.some((s) => /browserUnfocused/.test(s)));
    const calls = w.g.focusCalls;
    if (has) wmu.releaseFocusBeforeVanillaMenu(w.sp, w.controller);
    check('...and releasing with nothing focused does nothing', w.g.focusCalls === calls);
  }
  const src = (f) => fs.readFileSync(path.join(services, f), 'utf8');
  const rs = src('remoteServer.ts');
  check('the server\'s container answer releases the focus right before it activates the container',
    /if \(baseType === FormType\.Container\) releaseFocusBeforeVanillaMenu\(this\.sp, this\.controller\);\n\s*refr\.activate\(Game\.getPlayer\(\), true\);/.test(rs));
  check('a granted search releases it right before it opens the inventory',
    /releaseFocusBeforeVanillaMenu\(this\.sp, this\.controller\);\n\s*actor\.openInventory\(true\);/.test(src('searchService.ts')));

  // ---- the panel keeper never fights a vanilla menu ----
  {
    const w = world();
    w.g.openMenu('InventoryMenu'); w.run(100);
    w.sp.browser.setVisible(true); w.sp.browser.setFocused(true);   // a trade window taking focus over the inventory
    w.g.queue.push([CURSOR, 'hide']); w.run(100);
    const calls = w.g.focusCalls;
    w.run(3000);
    check('a focused panel over the inventory with no pointer is left alone: that pointer is the inventory\'s', w.g.focusCalls === calls);
  }

  // ---- a pointer the game will not open ----
  {
    const w = world();
    w.press(20); w.run(100);
    w.g.ignoreCursorShow = true;
    w.g.openMenu('Fader Menu'); w.run(100); w.g.closeMenu('Fader Menu');
    w.run(20000);
    const tries = w.notes.filter((n) => /panel pointer put back/.test(n)).length;
    check('a pointer that never comes back is tried a few times, then left alone', tries >= 1 && tries <= 3 && w.notes.some((n) => /no more repairs this session/.test(n)), { tries });
  }

  // ---- controller mode ----
  {
    const w = world({ controllerMode: true });
    w.g.openMenu('InventoryMenu'); w.run(2000);
    check('in controller mode the inventory has no pointer (the game\'s own choice)', w.g.open.has('InventoryMenu') && !w.pointer());
    check('...which the diag relay reports, controller mode named', w.notes.some((n) => /^cursor InventoryMenu open \d+ ms, no pointer for \d+ ms; browser had focus when it opened false; controller mode true$/.test(n)), w.notes);
    w.button(0, 15);
    check('a key press there is not a reason to say anything', globalThis.__harnessNotices.length === 0);
    w.button(1, 256);
    check('a mouse click there gets one notice saying how to turn controller mode off', globalThis.__harnessNotices.length === 1 && /controller mode/.test(globalThis.__harnessNotices[0]), globalThis.__harnessNotices);
    w.button(1, 256);
    w.g.closeMenu('InventoryMenu'); w.run(100); w.g.openMenu('ContainerMenu'); w.run(2000); w.button(1, 256);
    check('...once a session', globalThis.__harnessNotices.length === 1);
  }
  {
    const w = world({ controllerMode: false, ignoreCursorShow: true });
    w.g.openMenu('InventoryMenu'); w.run(2000); w.button(1, 256);
    check('no notice when the game says controller mode is off', globalThis.__harnessNotices.length === 0);
  }
  {
    const w = world();
    w.g.openMenu('InventoryMenu'); w.run(2000); w.button(1, 256);
    check('a mouse player with the pointer gets neither a notice nor a report', globalThis.__harnessNotices.length === 0 && !w.notes.some((n) => /^cursor /.test(n)));
  }
  {
    const w = world();
    w.g.openMenu('InventoryMenu'); w.run(100);
    w.g.closeMenu('InventoryMenu'); w.g.openMenu('InventoryMenu'); w.run(2000);
    check('the inventory closed and reopened in one frame keeps its pointer and is not reported', w.g.open.has('InventoryMenu') && w.pointer() && !w.notes.some((n) => /^cursor /.test(n)));
  }
  check('every login\'s ini line in the diag relay says whether the game is in controller mode',
    /`bGamepadEnable=\$\{read\(\(\) => sp\.Utility\.getINIBool\("bGamepadEnable:MAIN"\) \|\| sp\.Utility\.getINIBool\("bGamepadEnable:Main"\)\)\}`/.test(src('pageInputDiagService.ts')));

  Date.now = realNow;
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL the harness threw', e && e.stack || e); process.exit(1); });
