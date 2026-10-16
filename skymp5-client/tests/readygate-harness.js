// Scripted test for the character select ready gate: Play may not start a load until the client is ready, the front
// shows the wait meanwhile, a cap opens Play whatever is left, and one diag line per login says what each part took.
// Part 1 drives clientReadiness.ts alone (each part late, never, the cap). Part 2 bundles the real
// characterSelectService.ts (and clientReadiness.ts) with esbuild on a stubbed platform and a fake clock, and plays a
// fresh login, a slow main menu, an older front, a relog, a reconnect, a list sent again and a menu the server closes.
// Run from skymp5-client (esbuild is borrowed from ../skymp5-server/node_modules):
//
//   node tests/readygate-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const client = path.resolve(__dirname, '..');
const esbuild = require(require.resolve('esbuild', { paths: [client, path.resolve(client, '..', 'skymp5-server')] }));

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const STUBS = {
  skyrimPlatform: 'module.exports = { Menu: { Journal: "Journal Menu", Main: "Main Menu" } };',
  clientListener: 'class ClientListener {} module.exports = { ClientListener };',
  customPacketUtil: `module.exports = {
    sendCustomPacket: (controller, content) => globalThis.__sent.push(content),
    parseCustomPacket: (e) => { try { return JSON.parse(e.message.contentJsonDump); } catch (x) { return null; } },
  };`,
  widgetMenuUtil: `module.exports = {
    openFormMenu: (sp, setter, args) => { globalThis.__opened.push(args); },
    readMenuLanguage: () => 'en',
  };`,
  logging: 'module.exports = { logTrace: (...a) => globalThis.__trace.push(a.slice(1).join(" ")), logError: () => {} };',
  networking: 'class NetworkingService {} module.exports = { NetworkingService };',
  singlePlayer: 'class SinglePlayerService {} module.exports = { SinglePlayerService };',
};
const STUB_OF = { skyrimPlatform: 'skyrimPlatform', './clientListener': 'clientListener', './customPacketUtil': 'customPacketUtil',
  './widgetMenuUtil': 'widgetMenuUtil', '../../logging': 'logging', './networkingService': 'networking', './singlePlayerService': 'singlePlayer' };

async function bundle(tmp, entry, name) {
  const out = path.join(tmp, name);
  await esbuild.build({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
    } }],
  });
  return require(out);
}

function partOne(R) {
  const { ClientReadiness, READY_CAP_MS } = R;
  check('the cap is 30 s', READY_CAP_MS === 30000, READY_CAP_MS);
  const lines = [];
  // One login as characterSelectService sets it up: the list (in), startup and menu checks, and the front's answer
  const login = (startupAt) => {
    const g = new ClientReadiness((l) => lines.push(l));
    lines.length = 0;
    g.begin(0);
    g.add('list')(0);
    g.add('startup', (now) => startupAt !== null && now >= startupAt);
    g.add('menu', (now) => now >= 1000);
    return { g, front: g.add('front') };
  };
  const pollTo = (g, until, step = 100) => { for (let t = 0; t < until; t += step) g.poll(t); };

  // A ready client: the client started long ago and the front answers at once, so only the 1 s floor waits
  let { g, front } = login(0);
  front(40);
  check('not ready while the screen is new', !g.poll(0).ready && !g.poll(500).ready && !g.poll(999).ready);
  let s = g.poll(1000);
  check('ready 1 s after the list arrived', s.ready && !s.byCap && s.done === 4 && s.total === 4, s);
  check('one line: "after 1000 ms" with each part\'s time', lines.length === 1 && lines[0] === 'after 1000 ms (parts: list 0, startup 0, menu 1000, front 40)', lines);
  g.poll(5000);
  g.end(5000, 'play');
  check('later polls and closing a ready login write no second line', lines.length === 1, lines);

  // Each part late: startup at 2.5 s, then the front at 4.2 s
  ({ g, front } = login(2500));
  pollTo(g, 2500);
  s = g.poll(2400);
  check('startup late: held at 2.4 s, waiting for startup and front', !s.ready && JSON.stringify(s.waiting) === '["startup","front"]', s);
  s = g.poll(2500);
  check('startup late: at 2.5 s only the front is left', !s.ready && JSON.stringify(s.waiting) === '["front"]' && s.done === 3, s);
  front(4200);
  s = g.poll(4200);
  check('front late: ready when it answers at 4.2 s', s.ready && !s.byCap, s);
  check('...and the line names each part\'s time', lines[0] === 'after 4200 ms (parts: list 0, startup 2500, menu 1000, front 4200)', lines);

  // A part that never finishes: the cap opens Play at 30 s and the line says what was missing
  ({ g, front } = login(0));
  pollTo(g, 29999, 250);
  check('a part that never finishes holds Play to 29.99 s', !g.poll(29999).ready);
  s = g.poll(30000);
  check('the cap opens Play at 30 s', s.ready && s.byCap && JSON.stringify(s.waiting) === '["front"]', s);
  check('the cap line names the missing part', lines.length === 1 && lines[0] === 'by the cap after 30000 ms, still waiting for front (parts: list 0, startup 0, menu 1000, front -)', lines);
  front(31000);
  check('a part that finishes after the cap changes nothing', g.poll(31000).ready && lines.length === 1, lines);

  // Startup never: the cap again, naming startup
  ({ g, front } = login(null));
  front(10);
  pollTo(g, 30000, 500);
  s = g.poll(30000);
  check('startup never: the cap opens Play', s.ready && s.byCap && lines[0] === 'by the cap after 30000 ms, still waiting for startup (parts: list 0, startup -, menu 1000, front 10)', lines);

  // A check that throws counts as not done, and the cap still opens Play
  g = new ClientReadiness(() => { });
  g.begin(0);
  g.add('broken', () => { throw new Error('boom'); });
  check('a throwing part is not done', !g.poll(100).ready);
  check('...and the cap opens Play', g.poll(30000).ready && g.poll(30000).byCap);

  // The screen closing before ready leaves a line too
  ({ g, front } = login(0));
  g.poll(0);
  g.poll(400);
  g.end(400, 'play');
  check('a login closed before ready writes "never"', lines.length === 1 && lines[0] === 'never: the screen closed (play) after 400 ms, still waiting for menu, front (parts: list 0, startup 0, menu -, front -)', lines);
  check('with no login open, Play is not held', g.poll(500).ready && g.gate === 0);
  check('a part added with no login open does nothing', (g.add('x')(600), g.poll(600).total === 0));
  const older = (g.begin(1000), g.add('front'));
  g.begin(2000);
  g.add('front');
  older(2100);
  check('a part of an older login does not finish the new one', !g.poll(2100).ready && g.gate === 3, g.poll(2100));
  check('a login with nothing to wait for is ready at once', (g.begin(3000), g.poll(3000).ready));
  check('a report callback that throws never breaks the gate', (() => {
    const t = new ClientReadiness(() => { throw new Error('x'); });
    t.begin(0);
    return t.poll(0).ready;
  })());
}

// ---- the service on a stubbed platform ----
function world(CharacterSelectService) {
  const handlers = {};
  const emitterHandlers = {};
  const on = (ev, f, once) => (handlers[ev] = handlers[ev] || []).push({ f, once });
  const controller = {
    on: (ev, f) => on(ev, f, false),
    once: (ev, f) => on(ev, f, true),
    emit(ev, arg) { const list = handlers[ev] || []; handlers[ev] = list.filter((h) => !h.once); for (const h of list) h.f(arg); },
    emitter: {
      on: (ev, f) => (emitterHandlers[ev] = emitterHandlers[ev] || []).push(f),
      emit: (ev, arg) => (emitterHandlers[ev] || []).forEach((f) => f(arg)),
    },
    lookupListener(cls) {
      if (cls.name.startsWith('SinglePlayerService')) return { isSinglePlayer: false };
      if (cls.name.startsWith('NetworkingService')) return { isConnected: () => true, isAutoReconnectBlocked: () => false, reconnect: () => {} };
      throw new Error(`no listener ${cls.name}`);
    },
  };
  // The page: every widget the client sets, read back the way the front would
  const page = { widgets: [] };
  const fakeWindow = { skyrimPlatform: { widgets: { get: () => page.widgets, set: (w) => { page.widgets = w; } } } };
  const sp = {
    storage: {},
    browser: { executeJavaScript: (src) => { new Function('window', src)(fakeWindow); }, setFocused: () => {}, setVisible: () => {} },
    win32: { exitProcess: () => {} },
  };
  globalThis.__sent = []; globalThis.__opened = []; globalThis.__trace = [];
  const notes = [];
  globalThis.__dboDiagNote = (kind, text) => notes.push(`${kind} ${text}`);
  const svc = new CharacterSelectService(sp, controller);
  const widget = () => page.widgets.find((w) => w && w.type === 'characterSelect');
  // The first open draws through openFormMenu (stubbed): run its setter the same way so the page holds the widget
  const drawOpened = () => { const a = globalThis.__opened[globalThis.__opened.length - 1]; if (a) page.widgets = [{ type: 'characterSelect', id: 7, readiness: a.readiness, characters: a.characters }]; };
  return {
    svc, page, notes, widget,
    tick: () => controller.emit('tick'),
    menu: (characters) => { controller.emitter.emit('customPacketMessage', { message: { contentJsonDump: JSON.stringify({ customPacketType: 'characterSelectMenu', maxCharacters: 3, characters }) } }); drawOpened(); },
    serverClose: () => controller.emitter.emit('customPacketMessage', { message: { contentJsonDump: JSON.stringify({ customPacketType: 'characterSelectMenuClose' }) } }),
    page_: (...args) => controller.emit('browserMessage', { arguments: args }),
    disconnect: () => controller.emitter.emit('connectionDisconnect'),
    results: () => globalThis.__sent.filter((c) => c.customPacketType === 'characterSelectResult'),
    readyNotes: () => notes.filter((n) => n.startsWith('ready ')),
  };
}

async function partTwo(CharacterSelectService) {
  let T = 0;
  const realNow = Date.now;
  Date.now = () => T;
  try {
    // A fresh game: the client starts at 0, the list arrives at 4.3 s (as #A5V7's did), ticks every 16 ms
    T = 0;
    let w = world(CharacterSelectService);
    const run = (until) => { while (T < until) { T += 16; w.tick(); } };
    run(4300);
    w.menu([{ name: 'Lydia' }, null, null]);
    const opened = T;
    let r = (w.widget() || {}).readiness;
    check('the screen opens with the wait shown (ready false) and the list and startup already done', !!r && r.ready === false && r.done === 2 && r.total === 4 && r.gate === 1, r);
    w.page_('characterSelect:select', 0);
    w.page_('characterSelect:shown', 1);
    r = w.widget().readiness;
    check('the front\'s answer moves the progress on (3 of 4)', r.ready === false && r.done === 3, r);
    w.page_('characterSelect:play');
    check('Play from a front that shows the wait is refused while not ready', w.results().length === 0, w.results());
    check('...and the screen stays open', w.svc.menuOpen === true);
    let readyAt = null;
    while (T < opened + 5000) { T += 16; w.tick(); if (readyAt === null && w.widget().readiness.ready) readyAt = T; }
    check('the client is ready about 1 s after the list arrived (not more than 1.1 s)', readyAt !== null && readyAt - opened >= 1000 && readyAt - opened <= 1100, readyAt - opened);
    check('the page was told (ready true)', w.widget().readiness.ready === true);
    check('one diag line: "ready after N ms (parts: ...)"', w.readyNotes().length === 1 && /^ready after 10\d\d ms \(parts: list 0, startup 0, menu 10\d\d, front 0\)$/.test(w.readyNotes()[0]), w.readyNotes());
    w.page_('characterSelect:play');
    check('Play once ready sends the result and closes the screen', w.results().length === 1 && w.results()[0].action === 'play' && w.results()[0].slot === 0 && w.svc.menuOpen === false, w.results());
    check('closing a ready login writes no second line', w.readyNotes().length === 1, w.readyNotes());

    // A relog in the same process (the screen opens again later, in the world): the startup part is long done
    run(60000);
    w.menu([{ name: 'Lydia' }, null, null]);
    const reopened = T;
    r = w.widget().readiness;
    check('a relog opens a new wait (gate 2), held', r.gate === 2 && r.ready === false, r);
    w.page_('characterSelect:shown', 1);
    check('an answer for the older login is ignored', w.widget().readiness.done === 2, w.widget().readiness);
    w.page_('characterSelect:shown', 2);
    w.page_('characterSelect:select', 1);
    readyAt = null;
    while (T < reopened + 3000) { T += 16; w.tick(); if (readyAt === null && w.widget().readiness.ready) readyAt = T; }
    check('the relog is ready about 1 s after its list', readyAt !== null && readyAt - reopened <= 1100, readyAt - reopened);
    w.page_('characterSelect:play');
    check('an empty slot\'s Play (create) goes out once ready', w.results().length === 2 && w.results()[1].action === 'create' && w.results()[1].slot === 1, w.results());

    // A list sent again while the screen is up (after a delete) keeps the wait it had
    run(90000);
    w.menu([{ name: 'Lydia' }, { name: 'Brelyna' }, null]);
    w.page_('characterSelect:shown', 3);
    T += 400; w.tick();
    w.menu([{ name: 'Lydia' }, null, null]);
    r = w.widget().readiness;
    check('a list sent again keeps the same wait (gate 3, front still done)', r.gate === 3 && r.done === 3 && r.ready === false, r);

    // A reconnect: the connection drops with the screen up, the server sends the list again on the new connection
    w.disconnect();
    check('a drop before ready writes "never ... (disconnected)"', /^ready never: the screen closed \(disconnected\) after 4\d\d ms, still waiting for menu \(parts: list 0, startup 0, menu -, front 0\)$/.test(w.readyNotes()[w.readyNotes().length - 1]), w.readyNotes());
    run(T + 3000);
    w.menu([{ name: 'Lydia' }, null, null]);
    r = w.widget().readiness;
    check('the new connection\'s list opens a new wait (gate 4)', r.gate === 4 && r.ready === false, r);
    w.page_('characterSelect:shown', 3);
    w.page_('characterSelect:select', 0);
    run(T + 2000);
    check('without the front\'s answer for gate 4 Play stays held on the page', w.widget().readiness.ready === false);
    w.page_('characterSelect:shown', 4);
    run(T + 100);
    check('the answer for gate 4 opens it', w.widget().readiness.ready === true);

    // The server closes the screen before ready
    w.page_('characterSelect:play');
    run(T + 30000);
    w.menu([{ name: 'Lydia' }, null, null]);
    w.page_('characterSelect:shown', 5);
    T += 200; w.tick();
    w.serverClose();
    check('a screen the server closes before ready writes "never ... (the server)"', /^ready never: the screen closed \(the server\) after 2\d\d ms/.test(w.readyNotes()[w.readyNotes().length - 1]), w.readyNotes());
    check('...and the page is told nothing is held any more', w.svc.menuOpen === false);

    // A slow main menu: the list arrives 0.5 s after the client started; startup (2 s of the game loop) is the last part
    T = 0;
    w = world(CharacterSelectService);
    const runB = (until) => { while (T < until) { T += 16; w.tick(); } };
    runB(500);
    w.menu([{ name: 'Lydia' }]);
    w.page_('characterSelect:shown', 1);
    readyAt = null;
    while (T < 4000) { T += 16; w.tick(); if (readyAt === null && w.widget().readiness.ready) readyAt = T; }
    check('a list 0.5 s after start waits for 2 s of the game loop', readyAt !== null && readyAt >= 2000 && readyAt <= 2100, readyAt);
    check('...and the line shows startup was the slow part', /^ready after 1\d\d\d ms \(parts: list 0, startup 1\d\d\d, menu 1\d\d\d, front 0\)$/.test(w.readyNotes()[0]), w.readyNotes());

    // A hitching main menu (a tick every 2 s): the menu part never gets its 20 ticks; the cap opens Play at 30 s
    T = 0;
    w = world(CharacterSelectService);
    for (let i = 0; i < 200; i++) { T += 16; w.tick(); }
    w.menu([{ name: 'Lydia' }]);
    const opened3 = T;
    w.page_('characterSelect:shown', 1);
    w.page_('characterSelect:select', 0);
    while (T + 2000 < opened3 + 30000) { T += 2000; w.tick(); }
    check('still held at 28 s (14 ticks)', w.widget().readiness.ready === false);
    while (T < opened3 + 31000) { T += 2000; w.tick(); }
    check('the cap opens Play by 31 s', w.widget().readiness.ready === true);
    check('...with a warning line naming the slow part', /^ready by the cap after 3\d\d\d\d ms, still waiting for menu \(parts: list 0, startup 0, menu -, front 0\)$/.test(w.readyNotes()[0]), w.readyNotes());
    w.page_('characterSelect:play');
    check('...and Play goes out', w.results().length === 1);

    // An older front never answers: Play is not held by the client (it plays as before), and the line says so
    T = 0;
    w = world(CharacterSelectService);
    for (let i = 0; i < 300; i++) { T += 16; w.tick(); }
    w.menu([{ name: 'Lydia' }]);
    w.page_('characterSelect:select', 0);
    T += 300; w.tick();
    w.page_('characterSelect:play');
    check('an older front (no answer) still plays at once', w.results().length === 1);
    check('...and the line says the front never answered', /^ready never: the screen closed \(play\) after 3\d\d ms, still waiting for menu, front/.test(w.readyNotes()[0]), w.readyNotes());

    // The widget the page receives carries the wait (the browser-side setter's injected names line up)
    T = 0;
    w = world(CharacterSelectService);
    for (let i = 0; i < 300; i++) { T += 16; w.tick(); }
    w.menu([{ name: 'Lydia' }]);
    w.page_('characterSelect:select', 0);
    const drawn = w.page.widgets.find((x) => x.type === 'characterSelect');
    check('a re-drawn widget carries readiness and the shown event', !!drawn && drawn.readiness && drawn.readiness.gate === 1 && drawn.events && drawn.events.shown === 'characterSelect:shown' && drawn.strings.wait === 'Please wait', drawn && { readiness: drawn.readiness, events: drawn.events });
  } finally {
    Date.now = realNow;
    delete globalThis.__dboDiagNote;
  }
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'readygate-'));
  try {
    const readinessTs = path.join(client, 'src/services/services/clientReadiness.ts');
    if (fs.existsSync(readinessTs)) partOne(await bundle(tmp, readinessTs, 'readiness.js'));
    else check('clientReadiness.ts exists', false, 'missing');
    const { CharacterSelectService } = await bundle(tmp, path.join(client, 'src/services/services/characterSelectService.ts'), 'select.js');
    await partTwo(CharacterSelectService);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `FAILED ${failures}` : 'all ok');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.log('FAIL harness error', e && e.stack || e); process.exit(1); });
