// Scripted test for the client diagnostics (client 0.3.91, shipped as 0.3.95): lib/clientDiag.ts (the trace gate, the error digest, path
// scrubbing, stack frames), services/services/clientDiagService.ts (the dboDiag queue, the process hook) and the controller's
// on/once error reporting in services/spApiInteractor.ts. Nothing may throw, errors are deduplicated with counts and sent
// at most 10 lines a minute, trace lines are rate-limited and size-capped. Run from skymp5-client:
//
//   node tests/client-diag-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP client-diag (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);
const SRC = path.resolve(__dirname, '../src');

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`);
  if (!ok) failures++;
};

const H = { packets: [], sentAt: [], connected: true, logs: [], spOn: [], spOnce: [] };
globalThis.__cdH = H;
const STUBS = {
  skyrimPlatform: `const H = globalThis.__cdH;
    export const on = (ev, fn) => { H.spOn.push([ev, fn]); return { handle: H.spOn.length }; };
    export const once = (ev, fn) => { H.spOnce.push([ev, fn]); return { handle: -H.spOnce.length }; };`,
  clientListener: 'export class ClientListener {}',
  customPacketUtil: 'export const sendCustomPacket = (_c, p) => { globalThis.__cdH.packets.push(p); globalThis.__cdH.sentAt.push([Date.now(), p]); };',
  networkingService: 'export class NetworkingService {}',
  events: 'export class EventEmitterFactory { static makeEventEmitter() { const m = {}; return { on: (e, f) => (m[e] = m[e] || []).push(f), emit: (e, x) => (m[e] || []).forEach((f) => f(x)) }; } }',
};
const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /^(skyrimPlatform|\.\/clientListener|\.\/services\/clientListener|\.\/customPacketUtil|\.\/networkingService|\.\/events\/events)$/ },
      (a) => ({ path: a.path.replace(/.*\//, ''), namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
  },
};
const bundle = async (rel, dir, plugins) => {
  const out = path.join(dir, rel.replace(/\W/g, '_') + '.js');
  await esbuild.build({ entryPoints: [path.join(SRC, rel)], bundle: true, platform: 'node', format: 'cjs', outfile: out, plugins, logLevel: 'error' });
  return require(out);
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-clientdiag-'));
  let D, S, I;
  try {
    D = await bundle('lib/clientDiag.ts', dir, []);
    S = await bundle('services/services/clientDiagService.ts', dir, [stubPlugin]);
    I = await bundle('services/spApiInteractor.ts', dir, [stubPlugin]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---- scrubbing and frames ----
  const winPath = 'ENOENT: no such file, open \'C:\\Users\\SomePlayer\\AppData\\Local\\Skyrim\\x.json\'';
  const scrubbed = D.scrubText(winPath, 160);
  check('a Windows path keeps only its last part (no user name)', !/SomePlayer|Users|AppData/.test(scrubbed) && /x\.json/.test(scrubbed), scrubbed);
  check('a unix path and a webpack url too', !/home|nate/.test(D.scrubText('at /home/nate/a/b.js and webpack://skymp5-client/./src/x.ts', 160)), D.scrubText('at /home/nate/a/b.js and webpack://skymp5-client/./src/x.ts', 160));
  check('plain ratios and text stay', D.scrubText('3/19 sliders, a b', 160) === '3/19 sliders, a b', D.scrubText('3/19 sliders, a b', 160));
  check('control characters go and the length is capped', D.scrubText('a\nb\tc' + 'x'.repeat(500), 40).length <= 40 && !/\n/.test(D.scrubText('a\nb', 40)));
  // 10 Oct review (client-code required change 1): a user or folder name with spaces inside a path, and a very long token
  {
    const cerrOf = (message) => {
      const d = new D.ErrorDigest(D.DBO_CLIENT_VERSION);
      const e = new Error(message); e.stack = `Error: ${message}`;
      d.add('on:update', e);
      return d.drain(5000000)[0] || '';
    };
    const word = (line, w) => new RegExp(`(^|[^A-Za-z0-9])${w}([^A-Za-z0-9]|$)`).test(line);
    const win = cerrOf("ENOENT: no such file or directory, open 'C:\\Users\\A B C\\Documents\\My Games\\Skyrim Special Edition\\x.ini'");
    check("R1 scrub: 'C:\\Users\\A B C\\...' leaves no 'A', 'B' or 'C' word and no folder in the cerr line, only the file name",
      !word(win, 'A') && !word(win, 'B') && !word(win, 'C') && !/Users|Documents|Games|Special/.test(win) && / open 'x\.ini'$/.test(win), win);
    const winFwd = cerrOf('Cannot open C:/Users/First Last/AppData/Local/Skyrim Special Edition/Plugins.txt');
    check("R1 scrub: 'C:/Users/First Last/...' with forward slashes too", !/First|Last|Users|AppData/.test(winFwd) && /m=Error: Cannot open Plugins\.txt$/.test(winFwd), winFwd);
    const nix = cerrOf("EACCES: permission denied, open '/home/a b/.local/share/Steam/x.log'");
    check("R1 scrub: '/home/a b/...' leaves no 'a' or 'b' word and no folder in the cerr line", !word(nix, 'a') && !word(nix, 'b') && !/home|local|Steam/.test(nix)
      && / open 'x\.log'$/.test(nix), nix);
    const named = cerrOf("Cannot load D:\\Games\\Fink Winky's Skyrim\\Data\\a.esp");
    check("R1 scrub: 'D:\\Games\\<Name>'s Skyrim\\...' leaves no part of the name", !/Fink|Winky|Games|Skyrim|Data/.test(named) && /m=Error: Cannot load a\.esp$/.test(named), named);
    const two = D.scrubText("open 'C:\\a b\\x.ini' failed\nthen /home/c d/y.txt too", 160);
    check('R1 scrub: a line break ends a path run, the text between two paths stays', two === "open 'x.ini' failed then y.txt too", two);
    check('R1 scrub: ordinary messages are unchanged', D.scrubText("Cannot read properties of undefined (reading 'f')", 160) === "Cannot read properties of undefined (reading 'f')"
      && D.scrubText('3/19 sliders, a b', 160) === '3/19 sliders, a b' && D.scrubText('x is not a function', 160) === 'x is not a function');
    const slow = (fn) => { const t0 = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t0) / 1e6; };
    const parens = ')'.repeat(80000) + 'x', dots = '.'.repeat(80000) + 'x';
    const ms1 = slow(() => D.scrubText(parens, D.ERROR_MESSAGE_MAX)), ms2 = slow(() => D.scrubText(dots, D.ERROR_MESSAGE_MAX));
    const ms3 = slow(() => D.scrubText(parens, D.DIAG_LINE_MAX)), ms4 = slow(() => cerrOf(parens));
    check('R1 scrub: an 80,000-character ")))...x" or "...x" token is scrubbed in under 50 ms (the game thread never stalls)',
      ms1 < 50 && ms2 < 50 && ms3 < 50 && ms4 < 50, [ms1, ms2, ms3, ms4].map((x) => Math.round(x * 10) / 10));
    // Found with probe-frames.js: the frame regex is quadratic too, on an "at ..." line that only an error message can carry
    const longAt = 'Error: x\n    at ' + ' ( '.repeat(26667) + ':x\n    at g (C:\\Users\\P\\skymp5-client.js:5:6)';
    let fr = [];
    const ms5 = slow(() => { fr = D.stackFrames(longAt); });
    const ms6 = slow(() => { const d = new D.ErrorDigest(D.DBO_CLIENT_VERSION); const e = new Error('x'); e.stack = longAt; d.add('on:update', e); d.drain(5000000); });
    check('R1 scrub: an 80,000-character "at ..." line in a stack costs under 50 ms and the real frame after it is still read',
      ms5 < 50 && ms6 < 50 && fr.length === 1 && fr[0] === 'g@b:5:6', [ms5, ms6, fr]);
  }
  const stack = ['TypeError: x is undefined',
    '    at RacemenuPresetService.capture (C:\\Users\\SomePlayer\\Skyrim\\Data\\Platform\\Plugins\\skymp5-client.js:21243:15)',
    '    at Object.onUpdate (C:\\Users\\SomePlayer\\Skyrim\\Data\\Platform\\Plugins\\skymp5-client.js:21212:9)',
    '    at C:\\Users\\SomePlayer\\Skyrim\\Data\\Platform\\Plugins\\skymp5-client.js:100:1',
    ...Array.from({ length: 10 }, (_, i) => `    at f${i} (node:internal/x:${i}:1)`)].join('\n');
  const frames = D.stackFrames(stack);
  check('frames: the top 8, "fn@file:line:col", the bundle as "b", no directories',
    frames.length === 8 && frames[0] === 'RacemenuPresetService.capture@b:21243:15' && frames[1] === 'onUpdate@b:21212:9' && frames[2] === '?@b:100:1'
    && !frames.join().includes('SomePlayer'), frames);

  // ---- the error digest ----
  let T = 1000000;
  const dg = new D.ErrorDigest('0.3.91');
  const err = new TypeError('Cannot read properties of undefined (reading \'f\')'); err.stack = stack;
  for (let i = 0; i < 100; i++) dg.add('on:update', err);
  let lines = dg.drain(T);
  check('the same error 100 times: one line, in full', lines.length === 1 && /^cerr v=0\.3\.91 id=[0-9a-f]{8} at=on:update n=100 m=TypeError: Cannot read properties of undefined \(reading 'f'\) f=RacemenuPresetService\.capture@b:21243:15</.test(lines[0]), lines);
  check('...within the line cap and with no directory or user name', lines[0].length <= D.DIAG_LINE_MAX && !/SomePlayer|Users/.test(lines[0]), lines[0].length);
  dg.add('on:update', err);
  check('a repeat within the minute is only counted', dg.drain(T + 1000).length === 0);
  lines = dg.drain(T + 61000);
  check('after a minute the repeats go as a count with the same id', lines.length === 1 && /^cerr v=0\.3\.91 id=[0-9a-f]{8} at=on:update n=101 \+1$/.test(lines[0]), lines);
  check('nothing new, nothing sent', dg.drain(T + 130000).length === 0);
  const dg2 = new D.ErrorDigest('0.3.91');
  for (let i = 0; i < 30; i++) { const e = new Error(`boom ${i}`); e.stack = `Error: boom ${i}\n    at f${i} (x.js:${i}:1)`; dg2.add('once:tick', e); }
  const m1 = dg2.drain(T), m1b = dg2.drain(T + 30000), m2 = dg2.drain(T + 60001), m3 = dg2.drain(T + 120002), m4 = dg2.drain(T + 180003);
  check('30 distinct errors: 10 lines a minute at most, none lost', m1.length === 10 && m1b.length === 0 && m2.length === 10 && m3.length === 10 && m4.length === 0, [m1.length, m1b.length, m2.length, m3.length, m4.length]);
  let threw = null;
  try {
    const nasty = { get message() { throw new Error('getter'); }, toString() { throw new Error('toString'); } };
    const circ = {}; circ.self = circ;
    const proxy = new Proxy({}, { get() { throw new Error('proxy'); } });
    [null, undefined, 42, 'text', Symbol('s'), nasty, circ, proxy, { message: 5 }, new Error('')].forEach((x) => dg2.add(proxy, x));
    dg2.add(nasty, nasty);
    dg2.drain(T + 400000);
  } catch (e) { threw = e; }
  check('never throws: null, symbols, throwing getters and toString, proxies, circular objects', threw === null, threw && threw.message);
  const many = new D.ErrorDigest('0.3.91');
  for (let i = 0; i < 80; i++) many.add('on:update', new Error(`e${i}`));
  let total = [];
  for (let k = 0; k < 10; k++) total = total.concat(many.drain(T + k * 60001));
  check('past 64 distinct errors the rest are counted in one line', total.filter((l) => / more=16 distinct errors past 64/.test(l)).length === 1, total.slice(-2));

  // ---- the trace gate ----
  const tg = new D.TraceGate();
  const admitted = [];
  for (let i = 0; i < 40; i++) { const l = tg.admit(`rmp ask have=${i}`, T); if (l) admitted.push(l); }
  check('trace: 20 lines a minute at most', admitted.length === 20 && admitted[0] === 'apr rmp ask have=0', admitted.length);
  check('trace: the same line again for the same step within a minute is counted, not sent', tg.admit('own spawn mm=-', T + 61000) !== null && tg.admit('own spawn mm=-', T + 62000) === null);
  check('trace: a stats line says what was held back', /^apr stats sent=21 gated=20 same=1$/.test(tg.stats(T + 400000) || ''), tg.stats(T + 400001));
  check('trace: characters outside codes and numbers are dropped, length capped', tg.admit('rm open "Fink Winky\'s" ' + 'x'.repeat(600), T + 500000).length <= D.DIAG_LINE_MAX
    && !/["']/.test(tg.admit('rmx ask "q"', T + 500001)));
  const cap = new D.TraceGate(1000, 5);
  let n = 0;
  for (let i = 0; i < 20; i++) if (cap.admit(`own x i=${i}`, T + i)) n++;
  check('trace: the per-process cap holds', n === 5);
  check('trace(): a no-op without a sink, and never throws with a throwing one', (() => {
    try { delete globalThis.__dboTrace; D.trace('x'); globalThis.__dboTrace = () => { throw new Error('sink'); }; D.trace('y'); delete globalThis.__dboTrace; return true; } catch (e) { return false; }
  })());

  // ---- the service: queue, flush, process hook ----
  let NOW = 2000000;
  const realNow = Date.now;
  Date.now = () => NOW;
  const ons = {}, emits = {};
  const controller = {
    on: (ev, fn) => (ons[ev] = ons[ev] || []).push(fn), once: () => {},
    emitter: { on: (ev, fn) => (emits[ev] = emits[ev] || []).push(fn) },
    lookupListener: () => ({ isConnected: () => H.connected }),
  };
  const before = ['uncaughtExceptionMonitor', 'uncaughtException', 'unhandledRejection'].map((e) => process.listenerCount(e));
  const sp = { writeLogs: (_n, line) => H.logs.push(line), getPlatformVersion: () => '2.9.0' };
  new S.ClientDiagService(sp, Object.assign({}, controller, { on: () => {}, emitter: { on: () => {} } }));
  new S.ClientDiagService(sp, controller);
  // Node ends the process on an unhandled rejection or uncaught exception only while nobody listens for it (rejection-exit-harness.js)
  check('the process hook listens for unhandledRejection and uncaughtException, installed once (no monitor)',
    process.listenerCount('unhandledRejection') === before[2] + 1 && process.listenerCount('uncaughtException') === before[1] + 1
    && process.listenerCount('uncaughtExceptionMonitor') === before[0], ['uncaughtExceptionMonitor', 'uncaughtException', 'unhandledRejection'].map((e) => process.listenerCount(e)));
  const tick = () => (ons.tick || []).forEach((f) => f());
  H.connected = false;
  for (let i = 0; i < 12; i++) globalThis.__dboTrace(`rmp ask have=${i}`);
  NOW += 1500; tick();
  check('nothing is sent while not connected', H.packets.length === 0);
  H.connected = true;
  (emits.connectionAccepted || []).forEach((f) => f());
  NOW += 1500; tick();
  check('connected: a dboDiag packet of at most 8 lines, each "apr ..."', H.packets.length === 1 && H.packets[0].customPacketType === 'dboDiag'
    && H.packets[0].lines.length === 8 && H.packets[0].lines.every((l) => l.startsWith('apr ')), H.packets);
  tick();
  check('...and not again within a second', H.packets.length === 1);
  NOW += 1000; tick();
  check('the rest next second, with the client line (version and platform)', H.packets.length === 2
    && H.packets[1].lines.some((l) => l === `apr client v=${D.DBO_CLIENT_VERSION} sp=2.9.0`), H.packets[1]);
  check('the client version in every apr client and cerr line is the package version, 0.3.102', D.DBO_CLIENT_VERSION === '0.3.102', D.DBO_CLIENT_VERSION);
  H.packets = [];
  const e1 = new RangeError('bad index'); e1.stack = 'RangeError: bad index\n    at g (C:\\Users\\P\\skymp5-client.js:5:6)';
  globalThis.__dboReportError('on:update', e1);
  NOW += 1000; tick();
  check('a reported error goes out as one cerr line with the client version', H.packets.length === 1 && H.packets[0].lines.length === 1
    && H.packets[0].lines[0] === `cerr v=${D.DBO_CLIENT_VERSION} id=${H.packets[0].lines[0].replace(/^.* id=([0-9a-f]{8}) .*$/, '$1')} at=on:update n=1 m=RangeError: bad index f=g@b:5:6`
    && /^cerr v=\S+ id=[0-9a-f]{8} at=on:update n=1 m=RangeError: bad index f=g@b:5:6$/.test(H.packets[0].lines[0]), H.packets);
  check('...and is written to the local dbo-diag log too, without the user name', H.logs.some((l) => /^cerr .* m=RangeError: bad index/.test(l)) && !H.logs.some((l) => /Users/.test(l)));
  H.packets = [];
  const e2 = new Error('async boom'); e2.stack = 'Error: async boom\n    at h (skymp5-client.js:9:9)';
  process.emit('unhandledRejection', e2, Promise.resolve());
  check('an unhandled rejection is sent at once, as at=rejection', H.packets.length === 1 && /at=rejection n=1 m=Error: async boom/.test(H.packets[0].lines[0]), H.packets);
  H.packets = [];
  process.emit('uncaughtException', new Error('sync boom'), 'uncaughtException');
  check('an uncaught exception as at=uncaught', H.packets.length === 1 && /at=uncaught n=1 m=Error: sync boom/.test(H.packets[0].lines[0]), H.packets);
  H.packets = [];
  process.emit('unhandledRejection', 'not an Error', Promise.resolve());
  check('a rejection with a reason that is not an Error is sent too', H.packets.length === 1 && /at=rejection n=1 m=.*not an Error/.test(H.packets[0].lines[0]), H.packets);
  H.packets = [];
  // A real one: no listener of the harness's own, so only the hook keeps this process alive
  Promise.reject(new Error('real rejection'));
  await new Promise((r) => setTimeout(r, 20));
  check('a real unhandled rejection reaches the hook and this process goes on', H.packets.length === 1 && /at=rejection n=1 m=Error: real rejection/.test(H.packets[0].lines[0]), H.packets);
  H.packets = [];
  threw = null;
  try { globalThis.__dboReportError({ toString() { throw new Error('x'); } }, { get stack() { throw new Error('y'); } }); globalThis.__dboTrace({ toString() { throw new Error('z'); } }); } catch (e) { threw = e; }
  check('the hooks never throw', threw === null, threw && threw.message);
  for (let i = 0; i < 25; i++) { const e = new Error(`burst ${i}`); e.stack = `Error: burst ${i}\n    at q${i} (a.js:1:1)`; globalThis.__dboReportError('on:update', e); }
  for (let k = 0; k < 240; k++) { NOW += 1000; tick(); }
  const cerrAt = H.sentAt.reduce((a, [t, p]) => a.concat(p.lines.filter((l) => l.startsWith('cerr ')).map(() => t)), []);
  const worst = Math.max(...cerrAt.map((t) => cerrAt.filter((u) => u >= t && u < t + 60000).length));
  check('a burst of 25 new errors on top: never more than 10 cerr lines in any minute', worst <= 10, [worst, cerrAt.map((t) => t - cerrAt[0])]);
  const burstSent = H.sentAt.reduce((a, [, p]) => a.concat(p.lines.filter((l) => / m=Error: burst \d+ /.test(l))), []);
  check('...and every one of them goes out in full within 4 minutes', burstSent.length === 25, burstSent.length);

  {
    // A runtime whose process.on throws: the service still starts
    const realOn = process.on;
    delete globalThis.__dboProcessHookInstalled;
    delete globalThis.__dboProcessHookVersion;
    process.on = () => { throw new Error('no process events here'); };
    let threw = null;
    try { new S.ClientDiagService(sp, Object.assign({}, controller, { on: () => {}, emitter: { on: () => {} } })); } catch (e) { threw = e; }
    process.on = realOn;
    check('a runtime whose process.on throws: the service starts anyway (the client must start)', threw === null && !globalThis.__dboProcessHookInstalled
      && !globalThis.__dboProcessHookVersion, threw && threw.message);
    globalThis.__dboProcessHookInstalled = true;
    globalThis.__dboProcessHookVersion = 2;
  }
  {
    // Hot-reloaded over a 0.3.95-0.3.101 bundle: its monitor stays and reports uncaught errors, the new listeners keep the game up
    const saved = ['uncaughtException', 'unhandledRejection'].map((e) => [e, process.listeners(e)]);
    saved.forEach(([e]) => process.removeAllListeners(e));
    delete globalThis.__dboProcessHookVersion;
    globalThis.__dboProcessHookInstalled = true;
    let monitorSaw = 0;
    const oldMonitor = (err, origin) => { monitorSaw++; globalThis.__dboReportError(origin === 'unhandledRejection' ? 'rejection' : 'uncaught', err, true); };
    process.on('uncaughtExceptionMonitor', oldMonitor);
    new S.ClientDiagService(sp, Object.assign({}, controller, { on: () => {}, emitter: { on: () => {} } }));
    const sentBefore = H.logs.length;
    process.emit('uncaughtExceptionMonitor', new Error('reload boom'), 'uncaughtException');
    process.emit('uncaughtException', new Error('reload boom'), 'uncaughtException');
    process.emit('unhandledRejection', new Error('reload async'), Promise.resolve());
    const lines = H.logs.slice(sentBefore);
    check('over an older bundle: both listeners are added, an uncaught error is reported once (by the old monitor), a rejection once',
      process.listenerCount('uncaughtException') === 1 && process.listenerCount('unhandledRejection') === 1 && monitorSaw === 1
      && lines.filter((l) => /reload boom/.test(l)).length === 1 && lines.filter((l) => /at=rejection n=1 m=Error: reload async/.test(l)).length === 1, lines);
    process.removeListener('uncaughtExceptionMonitor', oldMonitor);
    saved.forEach(([e, fns]) => { process.removeAllListeners(e); fns.forEach((f) => process.on(e, f)); });
    globalThis.__dboProcessHookVersion = 2;
  }

  // ---- the controller's on/once ----
  Date.now = realNow;
  const reported = [];
  globalThis.__dboReportError = (where, e) => reported.push([where, e && e.message]);
  const c = I.SpApiInteractor.getControllerInstance();
  const handle = c.on('update', () => { throw new Error('handler failed'); });
  check('controller.on hands back what skyrimPlatform.on returned (timersService unsubscribes with it)', handle && handle.handle === H.spOn.length);
  const wrapped = H.spOn[H.spOn.length - 1];
  let rethrown = null;
  try { wrapped[1](); } catch (e) { rethrown = e; }
  check('a throwing on("update") handler is reported as on:update and the error still reaches SkyrimPlatform', reported.length === 1
    && reported[0][0] === 'on:update' && reported[0][1] === 'handler failed' && rethrown && rethrown.message === 'handler failed', reported);
  c.once('tick', (a, b) => a + b);
  check('a handler that works returns its value and reports nothing', H.spOnce[H.spOnce.length - 1][1](2, 3) === 5 && reported.length === 1);
  c.once('tick', () => { throw new Error('once failed'); });
  try { H.spOnce[H.spOnce.length - 1][1](); } catch (e) { /* expected */ }
  check('once:tick too', reported.length === 2 && reported[1][0] === 'once:tick');
  globalThis.__dboReportError = () => { throw new Error('reporter broken'); };
  rethrown = null;
  try { wrapped[1](); } catch (e) { rethrown = e; }
  check('a broken reporter does not replace the handler\'s own error', rethrown && rethrown.message === 'handler failed');

  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL harness threw', e && e.stack); process.exit(1); });
