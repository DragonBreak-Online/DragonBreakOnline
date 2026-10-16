// "Random bug causing game to close with zero crash report" (#bugs, 13 Oct). SkyrimPlatform runs the client in Node 23.2.0
// started with argv ["node"]: no --unhandled-rejections flag, NODE_OPTIONS ignored. Node's default "throw" mode raises an
// unhandled rejection as an uncaught exception, and with no "uncaughtException" listener Node prints it and calls exit(1):
// Skyrim closes with exit code 1 and no Crash Logger log, which the launcher reports as "ended". In the field (13-16 Oct)
// every at=rejection cerr line (114 of 114) was the last line from its game, the server dropped the player 60 s later, and
// the launcher saw exit code 1. This runs the real clientDiagService.ts in a child Node started the same way and makes the
// client's errors: an unhandled rejection (the 13 Oct setRefrCollision one) and a throw in a timer. The game must go on.
// Run from skymp5-client:
//
//   node tests/rejection-exit-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP rejection-exit (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);
const SRC = path.resolve(__dirname, '../src');

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`);
  if (!ok) failures++;
};

// The stubs write every dboDiag packet line to a file at once (fs.appendFileSync), so a line sent just before an exit is kept
const STUBS = {
  clientListener: 'export class ClientListener {}',
  customPacketUtil: `import * as fs from 'fs';
    export const sendCustomPacket = (_c, p) => { for (const l of p.lines || []) fs.appendFileSync(process.env.REJ_OUT, 'sent ' + l + '\\n'); };`,
  networkingService: 'export class NetworkingService {}',
};
const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /^(\.\/clientListener|\.\/customPacketUtil|\.\/networkingService)$/ }, (a) => ({ path: a.path.replace(/.*\//, ''), namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
  },
};

// The game: ClientDiagService first (as index.ts main() builds it), its tick flushing the queue, then the scenario
const CHILD = `'use strict';
const fs = require('fs');
const say = (s) => fs.appendFileSync(process.env.REJ_OUT, s + '\\n');
const S = require(process.env.REJ_BUNDLE);
const ticks = [];
const controller = { on: (ev, fn) => { if (ev === 'tick') ticks.push(fn); }, once: () => {}, emitter: { on: () => {} },
  lookupListener: () => ({ isConnected: () => true }) };
new S.ClientDiagService({ writeLogs() {}, getPlatformVersion: () => '2.9.0' }, controller);
const frames = setInterval(() => ticks.forEach((f) => f()), 10);
say('started node ' + process.version + ' execArgv=' + JSON.stringify(process.execArgv));
const scenario = process.argv[2];
if (scenario === 'rejection') {
  // A latent native's continuation that calls a native on a copy that went away (cerr 3c759f09, 13 Oct)
  Promise.resolve().then(() => { throw new Error("Expected 'refr' to not to be nullptr"); });
} else if (scenario === 'uncaught') {
  setTimeout(() => { throw new Error('timer boom'); }, 5);
} else if (scenario === 'both') {
  Promise.reject(new Error('first'));
  setTimeout(() => Promise.reject(new Error('second')), 30);
  setTimeout(() => { throw new Error('third'); }, 60);
}
setTimeout(() => {
  globalThis.__dboReportError('on:update', new Error('after'));
  setTimeout(() => { clearInterval(frames); say('alive'); process.exit(0); }, 1200);
}, 150);
`;

const run = (dir, bundle, scenario) => {
  const out = path.join(dir, `out-${scenario}.txt`);
  fs.writeFileSync(out, '');
  const env = Object.assign({}, process.env, { REJ_OUT: out, REJ_BUNDLE: bundle });
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [path.join(dir, 'child.js'), scenario], { env, encoding: 'utf8', timeout: 20000 });
  const lines = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean);
  return { code: r.status, signal: r.signal, lines, stderr: (r.stderr || '').split('\n').filter(Boolean).slice(0, 3) };
};

(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-jake-rejection-exit-'));
  try {
    const bundle = path.join(dir, 'clientDiagService.js');
    await esbuild.build({ entryPoints: [path.join(SRC, 'services/services/clientDiagService.ts')], bundle: true, platform: 'node', format: 'cjs',
      outfile: bundle, plugins: [stubPlugin], logLevel: 'error' });
    fs.writeFileSync(path.join(dir, 'child.js'), CHILD);

    const none = run(dir, bundle, 'none');
    check('control: a game with no error runs to its end (exit 0)', none.code === 0 && none.lines.includes('alive'), none);
    check('...started as SkyrimPlatform starts Node: no flags', /execArgv=\[\]$/.test(none.lines[0] || ''), none.lines[0]);
    console.log(`     (${(none.lines[0] || '').replace(/ execArgv.*/, '')}; the game's Node is 23.2.0, the same default mode)`);

    const rej = run(dir, bundle, 'rejection');
    const rejLine = rej.lines.find((l) => / at=rejection n=1 m=Error: Expected 'refr' to not to be nullptr/.test(l));
    check('an unhandled rejection is reported (cerr at=rejection)', !!rejLine, rej.lines);
    check('...and the game goes on: not closed with exit code 1, still reporting', rej.code === 0 && rej.lines.includes('alive')
      && rej.lines.some((l) => / at=on:update n=1 m=Error: after/.test(l)), { code: rej.code, lines: rej.lines, stderr: rej.stderr });

    const unc = run(dir, bundle, 'uncaught');
    check('a throw in a timer is reported (cerr at=uncaught)', unc.lines.some((l) => / at=uncaught n=1 m=Error: timer boom/.test(l)), unc.lines);
    check('...and the game goes on', unc.code === 0 && unc.lines.includes('alive'), { code: unc.code, lines: unc.lines, stderr: unc.stderr });

    const both = run(dir, bundle, 'both');
    const sent = (re) => both.lines.filter((l) => re.test(l)).length;
    check('three errors in a row: each reported once, the game still up', both.code === 0 && both.lines.includes('alive')
      && sent(/ at=rejection n=1 m=Error: first/) === 1 && sent(/ at=rejection n=1 m=Error: second/) === 1 && sent(/ at=uncaught n=1 m=Error: third/) === 1,
    { code: both.code, lines: both.lines, stderr: both.stderr });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL harness threw', e && e.stack); process.exit(1); });
