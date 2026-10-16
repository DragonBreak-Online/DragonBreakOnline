// Scripted test for the emote wheel's key diagnostics (#bugs 16 Oct, Elaava: "emotes dont open", only inside Dragonsreach).
// A press of the wheel's key that a gate refuses used to leave no trace: the shared menu-key gate returned without a line, and
// the restrained refusal only showed a notification. Each refusal now writes an "emote key refused: <gate>" line, the menu
// gate naming every recorded menu and whether the engine still has it open. And the emote lines get a relay allowance of
// their own (PageInputDiagService EVENT_KIND_MAX), so host-change lines can no longer spend the one they shared.
// Emote lines also go out in full until that allowance is spent, then as the 5 s summary (review of 72f91ab58: a close 2.6 s
// after the wheel opened was lost once a launch had six emote lines).
// Drives the real emoteService.ts and pageInputDiagService.ts against a stubbed game. Run from skymp5-client:
//
//   node tests/emote-key-diag-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP emote-key-diag (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);
const DTS = path.resolve(__dirname, '../node_modules/@skyrim-platform/skyrim-platform/index.d.ts');
if (!fs.existsSync(DTS)) { console.log('SKIP emote-key-diag (no SkyrimPlatform typings)'); process.exit(0); }

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`);
  if (!ok) failures++;
};

// The const enums the bundle reads at run time (tsc inlines them in the real build), with their values from the typings
const enumsOf = (src) => {
  const out = {};
  for (const m of src.matchAll(/export const enum (\w+) \{([^}]*)\}/g)) {
    const e = {}; let next = 0;
    for (const raw of m[2].split(',')) {
      const item = raw.replace(/\/\/.*$/gm, '').trim();
      if (!item) continue;
      const [k, v] = item.split('=').map((s) => s.trim());
      if (v === undefined) { e[k] = next++; continue; }
      const str = v.match(/^'(.*)'$/) || v.match(/^"(.*)"$/);
      if (str) { e[k] = str[1]; continue; }
      e[k] = Number(v); next = e[k] + 1;
    }
    out[m[1]] = e;
  }
  return out;
};
const ENUMS = enumsOf(fs.readFileSync(DTS, 'utf8'));
const { DxScanCode, InputDeviceType, Menu } = ENUMS;

const H = { notes: [], notified: [], js: [], focus: [], packets: [], file: [], lookups: {} };
globalThis.__ekH = H;
const STUBS = {
  skyrimPlatform: `module.exports = Object.assign(${JSON.stringify(ENUMS)}, { once: (ev, fn) => globalThis.__ekH.spOnce = fn });`,
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  customPacketUtil: `module.exports = {
    parseCustomPacket: (e) => { try { return JSON.parse(e.message.contentJsonDump); } catch { return null; } },
    sendCustomPacket: (_c, p) => globalThis.__ekH.packets.push(p),
    notifyNextUpdate: (_c, _sp, text) => globalThis.__ekH.notified.push(text) };`,
  logging: 'module.exports = { logTrace() {}, logError() {} };',
  browserService: 'class BrowserService {} module.exports = { BrowserService };',
  restraintService: 'class RestraintService {} module.exports = { RestraintService };',
  networkingService: 'class NetworkingService {} module.exports = { NetworkingService };',
};
const STUB_OF = { skyrimPlatform: 'skyrimPlatform', './clientListener': 'clientListener', './customPacketUtil': 'customPacketUtil',
  '../../logging': 'logging', './browserService': 'browserService', './restraintService': 'restraintService',
  './networkingService': 'networkingService' };

const bundle = async (rel, dir) => {
  const out = path.join(dir, rel.replace(/\W/g, '_') + '.js');
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, '../src', rel)], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
    } }],
  });
  return require(out);
};

// A controller whose listeners the test fires by hand; lookupListener answers with the fakes in H.lookups, by class name
const makeController = () => {
  const on = {}; const emit = {};
  const add = (m) => (ev, fn) => { (m[ev] = m[ev] || []).push(fn); };
  return {
    on: add(on), once: add(on),
    emitter: { on: add(emit), emit: (ev, x) => (emit[ev] || []).forEach((f) => f(x)) },
    // esbuild may suffix a class name (BrowserService2) to keep it apart from its import binding
    lookupListener: (ctor) => {
      const f = H.lookups[String(ctor && ctor.name).replace(/\d+$/, '')];
      if (!f) throw new Error(`no ${ctor.name}`);
      return f;
    },
    fire: (ev, x) => (on[ev] || []).slice().forEach((f) => f(x)),
  };
};

// The game as the emote key sees it: the browser, the engine's open menus, the settings block, the hooks
const world = { focused: false, engineOpen: new Set(), menuOpenThrows: false };
const sp = {
  settings: { 'skymp5-client': {} },
  getPluginSourceCode: () => '',
  writePlugin: () => {},
  writeLogs: (plugin, line) => { if (plugin === 'dbo-diag') H.file.push(line); },
  hooks: { sendAnimationEvent: { add: () => {} } },
  browser: {
    isFocused: () => world.focused,
    setFocused: (v) => { world.focused = v; H.focus.push(v); },
    setVisible: () => {},
    isVisible: () => true,
    executeJavaScript: (src) => H.js.push(src),
  },
  Ui: { isMenuOpen: (name) => { if (world.menuOpenThrows) throw new Error('unreadable'); return world.engineOpen.has(name); } },
  Debug: { notification: () => {} },
  Utility: { wait: () => ({ then: () => {} }), isInMenuMode: () => false },
  Game: { getPlayer: () => null },
};

// BrowserService as the gates read it: a recorded menu set, the hidden interface
const browser = {
  recorded: new Set(), uiHidden: false,
  isUiHidden() { return this.uiHidden; },
  setUiHidden(v) { this.uiHidden = v; },
  isBlockingMenuOpen() { return this.recorded.size > 0; },
  liveBlockingMenus() { const out = []; this.recorded.forEach((n) => { if (world.engineOpen.has(n) && n !== Menu.Main) out.push(n); }); return out; },
  recordedBlockingMenus() { const out = []; this.recorded.forEach((n) => out.push(n)); return out; },
};
const restraint = { isPoseLocked: false };

const reset = () => {
  H.notes.length = 0; H.notified.length = 0; H.js.length = 0; H.focus.length = 0; H.packets.length = 0; H.file.length = 0;
  world.focused = false; world.engineOpen = new Set(); world.menuOpenThrows = false;
  browser.recorded = new Set(); browser.uiHidden = false; restraint.isPoseLocked = false;
};
const key = (code, device) => ({ code, device: device === undefined ? InputDeviceType.Keyboard : device, isDown: true, userEventName: '' });
const emoteLines = () => H.notes.filter((n) => n.startsWith('emote '));
const wheelPushed = () => H.js.some((s) => /emoteWheel/.test(s));

(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-jake-emotekey-'));
  let E, P;
  try {
    E = await bundle('services/services/emoteService.ts', dir);
    P = await bundle('services/services/pageInputDiagService.ts', dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---- the wheel's key, with each gate -------------------------------------------------------------------------------------
  globalThis.__dboDiagNote = (kind, text) => H.notes.push(`${kind} ${text}`);
  H.lookups = { BrowserService: browser, RestraintService: restraint };
  const ec = makeController();
  const svc = new E.EmoteService(sp, ec);
  const pressB = () => ec.fire('buttonEvent', key(DxScanCode.B));
  const closeWheel = () => { if (wheelPushed()) pressB(); };

  reset();
  pressB();
  check('nothing in the way: B opens the wheel and says so', wheelPushed() && emoteLines().includes('emote wheel open'), H.notes);
  check('...and refuses nothing', !emoteLines().some((l) => /key refused/.test(l)), H.notes);
  closeWheel();

  // A recorded menu whose close never came: the engine says it is shut, the gate still refuses
  reset();
  browser.recorded.add(Menu.Inventory);
  pressB();
  check('a recorded menu still refuses the key (the gate is unchanged)', !wheelPushed() && !H.focus.includes(true), H.js);
  check('...and the line names it, and that the engine has it closed',
    emoteLines().includes(`emote key refused: menus ${Menu.Inventory} (closed)`), emoteLines());

  reset();
  browser.recorded.add(Menu.Loading); world.engineOpen.add(Menu.Loading); browser.recorded.add(Menu.Book);
  pressB();
  check('every recorded menu is named, the open one as open',
    emoteLines().includes(`emote key refused: menus ${Menu.Loading} (open), ${Menu.Book} (closed)`), emoteLines());

  reset();
  browser.recorded.add(Menu.Map); world.menuOpenThrows = true;
  pressB();
  check('an engine that cannot be asked gives "?", and the key handler does not throw',
    emoteLines().includes(`emote key refused: menus ${Menu.Map} (?)`), emoteLines());

  reset();
  browser.uiHidden = true;
  pressB();
  check('the hidden interface (F2) is named', !wheelPushed() && emoteLines().includes('emote key refused: interface hidden'), emoteLines());

  reset();
  world.engineOpen.add(Menu.Console); browser.recorded.add(Menu.Console);
  pressB();
  check('a B typed in the open console neither opens the wheel nor writes a line', !wheelPushed() && emoteLines().length === 0, emoteLines());

  reset();
  browser.recorded.add(Menu.Console);
  pressB();
  check('a console the engine has closed but the record still holds is named', !wheelPushed() &&
    emoteLines().includes(`emote key refused: menus ${Menu.Console} (closed)`), emoteLines());

  reset();
  world.focused = true;
  pressB();
  check('a browser holding the keyboard is named', !wheelPushed() && emoteLines().includes('emote key refused: browser focused'), emoteLines());

  reset();
  restraint.isPoseLocked = true;
  pressB();
  check('restrained: the notification as before', !wheelPushed() && H.notified.includes('You cannot use emotes while restrained.'), H.notified);
  check('...and now a line too', emoteLines().includes('emote key refused: restrained'), emoteLines());

  reset();
  H.lookups = { RestraintService: restraint };
  pressB();
  check('no browser service to ask: the gate lets the key through as before', wheelPushed(), H.js.length);
  closeWheel();
  H.lookups = { BrowserService: browser, RestraintService: restraint };

  reset();
  ec.fire('buttonEvent', key(DxScanCode.N, InputDeviceType.Keyboard));
  check('another key writes nothing', emoteLines().length === 0, emoteLines());

  // ---- the relay: emote lines past the shared allowance -------------------------------------------------------------------
  let clock = 1000000;
  const realNow = Date.now;
  Date.now = () => clock;
  try {
    const pc = makeController();
    H.lookups = { NetworkingService: { isConnected: () => true } };
    pc.emitter.on('sendMessage', (m) => {
      try { const p = JSON.parse(m.message.contentJsonDump); if (p.customPacketType === 'dboDiag') H.packets.push(p); } catch (e) { /* not ours */ }
    });
    const relayed = () => H.packets.reduce((a, p) => a.concat(p.lines || []), []);
    const tick = () => { clock += 6000; pc.fire('tick'); };
    reset();
    const diag = new P.PageInputDiagService(sp, pc);
    const note = globalThis.__dboDiagNote;
    // Forty-five different host-change kinds, one line each: the shared allowance is 40
    for (let i = 0; i < 45; i++) { note(`fv:k${i}`, `line ${i}`); clock += 300; }
    for (let i = 0; i < 10; i++) tick();
    const shared = relayed().filter((l) => /^fv:k/.test(l)).length;
    check('the shared allowance is spent at 40 lines, as before', shared === 40, shared);
    note('emote', 'wheel open'); clock += 300;
    note('emote', 'key refused: menus InventoryMenu (closed)');
    for (let i = 0; i < 3; i++) tick();
    check('an emote line still reaches the server once host changes have spent the shared allowance',
      relayed().includes('emote wheel open'), relayed().slice(-3));
    check('...and so does a refusal', relayed().includes('emote key refused: menus InventoryMenu (closed)'), relayed().slice(-3));

    // The emote allowance is bounded on its own: a flood of emote notes, one summary a window past the first 40
    for (let i = 0; i < 400; i++) { note('emote', `step ${i}`); clock += 5100; if (i % 4 === 0) tick(); }
    for (let i = 0; i < 20; i++) tick();
    const emoteRelayed = relayed().filter((l) => /^emote /.test(l)).length;
    check('emote lines stop at their own 40 in full plus 10 summaries a launch', emoteRelayed === 50, emoteRelayed);
    check('a packet carries at most 8 lines', H.packets.every((p) => p.lines.length <= 8), H.packets.map((p) => p.lines.length));

    // A fresh session: the emote lines leave the shared room alone
    reset();
    const pc2 = makeController();
    pc2.emitter.on('sendMessage', (m) => {
      try { const p = JSON.parse(m.message.contentJsonDump); if (p.customPacketType === 'dboDiag') H.packets.push(p); } catch (e) { /* not ours */ }
    });
    new P.PageInputDiagService(sp, pc2);
    const note2 = globalThis.__dboDiagNote;
    for (let i = 0; i < 6; i++) { note2('emote', `e${i}`); clock += 300; }
    for (let i = 0; i < 40; i++) { note2(`fv:j${i}`, `line ${i}`); clock += 300; }
    for (let i = 0; i < 12; i++) { clock += 6000; pc2.fire('tick'); }
    const all2 = H.packets.reduce((a, p) => a.concat(p.lines || []), []);
    check('six emote lines take nothing from the 40 shared ones', all2.filter((l) => /^fv:j/.test(l)).length === 40 && all2.filter((l) => /^emote /.test(l)).length === 6,
      [all2.filter((l) => /^fv:j/.test(l)).length, all2.filter((l) => /^emote /.test(l)).length]);
  } finally {
    Date.now = realNow;
  }

  // ---- Dragonsreach-like sequences past the first six emote lines of a launch: the real wheel feeding the real relay ----------
  Date.now = () => clock;
  try {
    reset();
    H.lookups = { BrowserService: browser, RestraintService: restraint, NetworkingService: { isConnected: () => true } };
    const pc3 = makeController();
    new P.PageInputDiagService(sp, pc3);
    const ec3 = makeController();
    new E.EmoteService(sp, ec3);
    // Gamepad codes from gamepadKeys.ts: the chord is Back held with the left stick click
    const PAD_BACK = 0x0020; const PAD_LEFT_THUMB = 0x0040;
    const pad = (code, down) => ({ code, device: InputDeviceType.Gamepad, isDown: down, isUp: !down, userEventName: '' });
    const press = (e) => { ec3.fire('buttonEvent', e); clock += 300; };
    const flush = () => { for (let i = 0; i < 12; i++) { clock += 6000; pc3.fire('tick'); } };
    const relayedEmote = () => H.packets.reduce((a, p) => a.concat(p.lines || []), []).filter((l) => /^emote /.test(l));
    const fileEmote = () => H.file.filter((l) => /^emote /.test(l));
    const inBoth = (line) => relayedEmote().includes(line) && fileEmote().includes(line);
    const isSummary = (l) => /^emote \+\d+ more \(\d+ this session\), latest: /.test(l);

    // Earlier this launch: the wheel opened and shut by its key three times, six lines
    for (let i = 0; i < 3; i++) { press(key(DxScanCode.B)); press(key(DxScanCode.B)); }
    flush();
    check('six earlier emote lines this launch', fileEmote().length === 6 && relayedEmote().length === 6, fileEmote());

    // In Dragonsreach: the key refused by each gate in turn, all inside one 5 s window
    const refusals = [];
    browser.recorded.add(Menu.Inventory); press(key(DxScanCode.B)); browser.recorded.clear();
    refusals.push(`emote key refused: menus ${Menu.Inventory} (closed)`);
    browser.recorded.add(Menu.Loading); world.engineOpen.add(Menu.Loading); press(key(DxScanCode.B));
    browser.recorded.clear(); world.engineOpen.clear();
    refusals.push(`emote key refused: menus ${Menu.Loading} (open)`);
    browser.uiHidden = true; press(key(DxScanCode.B)); browser.uiHidden = false;
    refusals.push('emote key refused: interface hidden');
    world.focused = true;
    press(pad(PAD_BACK, true)); press(pad(PAD_LEFT_THUMB, true)); press(pad(PAD_LEFT_THUMB, false)); press(pad(PAD_BACK, false));
    world.focused = false;
    refusals.push('emote key refused: browser focused');
    restraint.isPoseLocked = true; press(key(DxScanCode.B)); restraint.isPoseLocked = false;
    refusals.push('emote key refused: restrained');
    flush();
    for (const r of refusals) check(`past the 6th line, "${r.slice(6)}" reaches the file and the server in full`, inBoth(r), relayedEmote().slice(-6));
    check('...each refusal once, with no summary in between', relayedEmote().length === 11 && !relayedEmote().some(isSummary), relayedEmote().slice(6));

    // The wheel opened, then a panel took the cursor and the watch took the wheel down about 2.5 s later
    press(key(DxScanCode.B));
    const opened = H.focus[H.focus.length - 1] === true;
    world.focused = false;
    for (let i = 0; i < 16; i++) { clock += 250; ec3.fire('update'); }
    flush();
    const closeRe = /^emote wheel closed after (\d+) ms by losing the cursor$/;
    const closed = relayedEmote().filter((l) => closeRe.test(l));
    const ms = closed.length ? Number(closed[0].match(closeRe)[1]) : -1;
    check('the wheel opened past the 6th line is written in full', opened && relayedEmote().filter((l) => l === 'emote wheel open').length === 4
      && fileEmote().filter((l) => l === 'emote wheel open').length === 4, relayedEmote().slice(-3));
    check('...and its close by losing the cursor, under 5 s later, reaches the file and the server in full',
      closed.length === 1 && ms >= 2000 && ms < 5000 && fileEmote().some((l) => closeRe.test(l)), relayedEmote().slice(-3));

    // A flood that hits the cap: B mashed against a stale record, a press every 300 ms for 90 s
    const before = relayedEmote().length;
    browser.recorded.add(Menu.Inventory);
    for (let i = 0; i < 300; i++) { press(key(DxScanCode.B)); if (i % 10 === 0) pc3.fire('tick'); }
    browser.recorded.clear();
    flush();
    const rel = relayedEmote(); const fil = fileEmote();
    check('the first 40 emote lines of the launch go out in full, in the file and to the server',
      before === 13 && rel.filter((l) => !isSummary(l)).length === 40 && fil.filter((l) => !isSummary(l)).length === 40,
      [before, rel.filter((l) => !isSummary(l)).length, fil.filter((l) => !isSummary(l)).length]);
    const firstSummary = rel.find(isSummary) || '';
    check('the first summary counts from the allowance, not from 6',
      firstSummary === `emote +1 more (41 this session), latest: key refused: menus ${Menu.Inventory} (closed)`, firstSummary);
    check('the server gets 40 in full plus 10 summaries this launch, inside its 200 emote lines a player', rel.length === 50 && rel.filter(isSummary).length === 10,
      [rel.length, rel.filter(isSummary).length]);
    const sums = fil.filter(isSummary).map((l) => l.match(/^emote \+(\d+) more \((\d+) this session\)/).slice(1).map(Number));
    const chained = sums.every(([n, m], i) => m - n === (i ? sums[i - 1][1] : 40));
    check('the file keeps the 5 s summary past the relay cap, every line counted', sums.length > 10 && chained && sums[sums.length - 1][1] >= 300,
      sums.slice(0, 3).concat(sums.slice(-2)));
    check('a packet still carries at most 8 lines', H.packets.every((p) => p.lines.length <= 8), H.packets.map((p) => p.lines.length));

    // A kind with no allowance of its own is unchanged: six in full, then the 5 s summary
    const note3 = globalThis.__dboDiagNote;
    for (let i = 0; i < 10; i++) { note3('fv:host', `npc ${i}`); clock += 300; }
    flush();
    const fv = H.packets.reduce((a, p) => a.concat(p.lines || []), []).filter((l) => /^fv:host /.test(l));
    check('host-change lines still go out six in full, then one summary a window', fv.length === 7 && fv[6] === 'fv:host +1 more (7 this session), latest: npc 6', fv.slice(5));
  } finally {
    Date.now = realNow;
  }

  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log(`FAIL harness error: ${e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e}`); process.exit(1); });
