// Menu hotkeys refused while one of our native panels is up (2 Nov: Nat, "in other panels if I hit U, it brings up the U
// menu"). Every native Scaleform panel runs as the engine's one CustomMenu, which BrowserService's blocking menus do not list,
// so a second panel opened over the first. The real widgetMenuUtil.ts is bundled into each real service with esbuild (every
// other import stubbed); a press with the CustomMenu up must open nothing, while Esc and a panel's own key still close it.
// Run it from skymp5-client with node_modules present (esbuild is borrowed from ../skymp5-server/node_modules):
//
//   node tests/hotkey-custommenu-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const client = path.resolve(__dirname, '..');
const services = path.join(client, 'src', 'services', 'services');
const esbuild = require(require.resolve('esbuild', { paths: [client, path.resolve(client, '..', 'skymp5-server')] }));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-hotkey-'));

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const KEYBOARD = 0;
const DX = { Escape: 1, U: 22, K: 37, F3: 61, F7: 65 };
const state = { custom: false, calls: [] };
globalThis.__hk = state;

const SP_STUB = `
const anything = (name) => new Proxy(function () {}, {
  get: (t, k) => (k === 'then' ? undefined : anything(name + '.' + String(k))),
  apply: () => { globalThis.__hk.calls.push(name); return undefined; },
});
const DxScanCode = new Proxy(${JSON.stringify(DX)}, { get: (t, k) => (k in t ? t[k] : 1000 + String(k).length) });
const Menu = new Proxy({}, { get: (t, k) => String(k) });
module.exports = new Proxy({ DxScanCode, Menu, InputDeviceType: { Keyboard: 0, Mouse: 1, Gamepad: 2, VirtualKeyboard: 3 },
  on: () => ({}), once: () => ({}) }, { get: (t, k) => (k in t ? t[k] : (k === '__esModule' ? undefined : anything(String(k)))) });
`;

// Stubs for everything but widgetMenuUtil: menu keys at their defaults, sends and opens recorded by name
const stubFor = (spec, names) => {
  if (spec === 'skyrimPlatform') return SP_STUB;
  return names.map((n) => {
    if (n === 'readMenuKeyCode') return `exports.${n} = function (sp, name, fallback) { return fallback; };`;
    if (n === 'FunctionInfo') return `exports.${n} = class { getText() { return ''; } };`;
    if (n === 'BrowserService') return `exports.${n} = class BrowserService {};`;
    if (/^(readMenuLanguage)$/.test(n)) return `exports.${n} = function () { return 'en'; };`;
    if (/^(buttonKeyCode)$/.test(n)) return `exports.${n} = function (e) { return e.device === 0 ? e.code : null; };`;
    if (/^(isGamepadChord|isTradeInviteWaiting)$/.test(n)) return `exports.${n} = function () { return false; };`;
    return `exports.${n} = function ${n}() { globalThis.__hk.calls.push(${JSON.stringify(spec + ':' + n)}); };`;
  }).join('\n');
};

const importsOf = (file) => {
  const src = fs.readFileSync(path.join(services, file), 'utf8');
  const imports = {};
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    imports[m[2]] = (imports[m[2]] || []).concat(m[1].split(',').map((x) => x.trim().replace(/^type\s+/, '')).filter(Boolean));
  }
  return imports;
};

async function load(file) {
  const outfile = path.join(out, file.replace(/\.ts$/, '.js'));
  const imports = Object.assign({}, importsOf('widgetMenuUtil.ts'), importsOf(file));
  await esbuild.build({
    entryPoints: [path.join(services, file)], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'error',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => {
          if (a.kind === 'entry-point') return undefined;
          if (a.path === './widgetMenuUtil') return { path: a.path, namespace: 'real' };
          return { path: a.path, namespace: 'stub' };
        });
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubFor(a.path, imports[a.path] || []), loader: 'js' }));
        b.onLoad({ filter: /.*/, namespace: 'real' }, (a) => ({ contents: fs.readFileSync(path.join(services, a.path.slice(2) + '.ts'), 'utf8'), loader: 'ts', resolveDir: services }));
      },
    }],
  });
  return require(outfile);
}

const recorder = (name) => new Proxy(function () {}, {
  get: (t, k) => {
    if (k === 'then') return undefined;
    if (name === 'sp.browser' && k === 'isFocused') return () => false;
    if (name === 'sp.Ui' && k === 'isMenuOpen') return (m) => m === 'CustomMenu' && state.custom;
    if (name === 'sp' && k === 'settings') return { 'skymp5-client': {} };
    if (name === 'listener' && k === 'isBlockingMenuOpen') return () => false;
    if (name === 'listener' && k === 'isUiHidden') return () => false;
    if (name === 'listener' && k === 'recordedBlockingMenus') return () => [];
    return recorder(`${name}.${String(k)}`);
  },
  apply: () => { state.calls.push(name); return undefined; },
});

function instance(Cls) {
  const handlers = {};
  const controller = {
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
    once: () => {},
    emitter: { on: () => {}, emit: (...a) => state.calls.push('emit:' + a[0]) },
    lookupListener: () => recorder('listener'),
  };
  const svc = new Cls(recorder('sp'), controller);
  const press = (code) => {
    state.calls = [];
    for (const fn of handlers.buttonEvent || []) fn({ device: KEYBOARD, code, isDown: true, isUp: false, isHeld: false, isPressed: true, value: 1, heldDuration: 0, userEventName: '' });
    return state.calls.slice();
  };
  return { svc, press };
}

const CASES = [
  { file: 'personalMenuService.ts', cls: 'PersonalMenuService', key: DX.U, name: 'U (player menu)' },
  { file: 'adminMenuService.ts', cls: 'AdminMenuService', key: DX.F7, name: 'F7 (admin panel)' },
  { file: 'factionService.ts', cls: 'FactionService', key: DX.F3, name: 'F3 (faction menu)' },
  { file: 'masteryService.ts', cls: 'MasteryService', key: DX.K, name: 'K (mastery)' },
];

(async () => {
  try {
    // ---- the guard itself ----
    const util = await load('widgetMenuUtil.ts');
    const sp = recorder('sp'), controller = { lookupListener: () => recorder('listener') };
    const key = { device: KEYBOARD, code: DX.U, isDown: true };
    state.custom = false;
    check('no panel up: a menu key is not blocked', util.isMenuKeyPressBlocked(sp, controller, key) === false && util.isMenuHotkeyBlocked(sp, controller) === false);
    state.custom = true;
    check('a native panel (CustomMenu) up: isMenuHotkeyBlocked refuses', util.isMenuHotkeyBlocked(sp, controller) === true);
    check('...and isMenuKeyPressBlocked refuses a key', util.isMenuKeyPressBlocked(sp, controller, key) === true);
    check('...and a mouse-button menu key too', util.isMenuKeyPressBlocked(sp, controller, { device: 1, code: 3, isDown: true }) === true);
    check('...and the block reason names it', /CustomMenu/.test(util.menuKeyBlockReason(sp, controller, key)), util.menuKeyBlockReason(sp, controller, key));
    state.custom = false;

    // ---- each real service ----
    for (const c of CASES) {
      const mod = await load(c.file);
      const { svc, press } = instance(mod[c.cls]);
      // Whether the press reaches the open is the question, not what an open draws (openFormMenu needs a page)
      if (typeof svc.openMenu === 'function') svc.openMenu = () => { state.calls.push('openMenu'); };
      state.custom = false;
      const free = press(c.key);
      check(`${c.name}: with no panel up the key does something (the baseline)`, free.length > 0, free);
      state.custom = true;
      if (typeof svc.closeMenu === 'function') { svc.menuOpen = false; svc.awaitingOpen = false; }
      const over = press(c.key);
      check(`${c.name}: with a native panel up the key opens nothing`, over.length === 0, over);
      state.custom = false;
    }

    // ---- what must still work with a panel up ----
    {
      const { svc, press } = instance((await load('adminMenuService.ts')).AdminMenuService);
      state.custom = true; svc.menuOpen = true; svc.native = false;
      let closed = false; svc.closeMenu = () => { closed = true; svc.menuOpen = false; };
      press(DX.F7);
      check('F7 still closes its own open panel while the CustomMenu is up', closed);
    }
    {
      const { svc, press } = instance((await load('factionService.ts')).FactionService);
      state.custom = true; svc.menuOpen = true;
      let closed = false; svc.closeMenu = () => { closed = true; svc.menuOpen = false; };
      press(DX.Escape);
      check('Esc still closes an open faction menu while the CustomMenu is up', closed);
    }
    state.custom = false;
  } catch (e) {
    check('runs', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
  }
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
