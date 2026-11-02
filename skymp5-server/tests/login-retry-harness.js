// The login fetches' retry rule (login.ts getFetchOptions retryOn), built from the real login.ts with esbuild: a 408 is
// retried like a network error or a 5xx (live, 2 Nov: 14 logins failed at once with getUserProfile 408 because the game
// server's own loop was blocked for 120 s at boot and the backend dropped the half-sent requests), and a 404, 403 or 200
// is not; every retry stops at the tenth attempt. A mutant without the 408 must fail. Run from skymp5-server with
// node_modules present:
//
//   node tests/login-retry-harness.js [login.ts to test]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const SRC_FILE = path.resolve(process.argv[2] || path.join(root, 'ts', 'systems', 'login.ts'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-loginretry-'));
process.on('exit', () => { try { fs.rmSync(out, { recursive: true, force: true }); } catch (e) { /* the OS */ } });

const stubs = {
  '../settings': 'module.exports = { Settings: { get: async () => ({}) } };',
  './metricsSystem': 'const c = { inc() {} }; module.exports = { loginsCounter: c, loginErrorsCounter: c };',
  'fetch-retry': 'module.exports = { __esModule: true, default: () => () => { throw new Error("no fetch here"); } };',
  './kickUtil': 'module.exports = { kickWithReason: () => {} };',
  './discordBanSystem': 'module.exports = { hasDiscordBanRole: () => false };',
};
// Builds login.ts (the given source text, written beside the real file so its relative imports resolve) and returns retryOn
let n = 0;
const retryOnOf = async (srcText) => {
  const entry = path.join(path.dirname(path.join(root, 'ts', 'systems', 'login.ts')), `.login-retry-${process.pid}-${n++}.ts`);
  fs.writeFileSync(entry, srcText);
  const bundle = path.join(out, `login-${n}.js`);
  try {
    await esbuild.build({
      entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /^(\.\.\/settings|\.\/metricsSystem|fetch-retry|\.\/kickUtil|\.\/discordBanSystem)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubs[a.path], loader: 'js' }));
      } }],
    });
  } finally { fs.unlinkSync(entry); }
  const { Login } = require(bundle);
  const login = new Login(() => {}, 100, 'http://master.test', 7777, 'KEY', false);
  return login.getFetchOptions('test').retryOn;
};

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };
const res = (status) => ({ status });
const quiet = (fn) => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };
const checks = (retryOnLoud, ck) => {
  const retryOn = (...a) => quiet(() => retryOnLoud(...a));
  ck('a 408 is retried (the backend dropped a request this server could not finish sending)', retryOn(0, null, res(408)) === true);
  ck('a network error is retried', retryOn(0, new Error('ECONNRESET'), undefined) === true);
  ck('a 500 and a 503 are retried', retryOn(0, null, res(500)) === true && retryOn(3, null, res(503)) === true);
  ck('a 404, a 403 and a 200 are not', retryOn(0, null, res(404)) === false && retryOn(0, null, res(403)) === false && retryOn(0, null, res(200)) === false);
  ck('the tenth attempt is the last, for a 408 too', retryOn(9, null, res(408)) === true && retryOn(10, null, res(408)) === false && retryOn(10, null, res(500)) === false);
};

(async () => {
  const SRC = fs.readFileSync(SRC_FILE, 'utf8').replace(/\r\n/g, '\n');
  checks(await retryOnOf(SRC), check);

  const from = 'response.status === 408 || ';
  if (!SRC.includes(from)) check('mutant: its line is still in login.ts', false, from);
  else {
    let bad = 0;
    checks(await retryOnOf(SRC.replace(from, '')), (_n, ok) => { if (!ok) bad++; });
    check('mutant caught: a 408 is not retried', bad > 0);
  }
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exitCode = failures ? 1 : 0;
})();
