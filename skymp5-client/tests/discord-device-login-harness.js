// Scripted test for the in-game Discord sign-in (F1, security audit 15 Oct): services/services/authService.ts with
// discordDeviceLogin.ts, against a fake backend. The backend issues the state, the game shows the code, only the state goes
// into the browser URL, the device code goes only to the poll, and the result is taken once. Run from skymp5-client:
//
//   node tests/discord-device-login-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP discord-device-login (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);
const SRC = path.resolve(__dirname, '../src');

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`);
  if (!ok) failures++;
};

const STUBS = {
  skyrimPlatform: 'export const browser = { executeJavaScript: () => {} }; export const Menu = {};',
  clientListener: 'export class ClientListener {}',
  timersService: 'export class TimersService {}',
  networkingService: 'export class NetworkingService {}',
  settingsService: 'export class SettingsService {}',
  logging: 'export const logTrace = () => {}; export const logError = (...a) => globalThis.__dlH.errors.push(a);',
  messages: 'export const MsgType = { CustomPacket: 0 };',
};
const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /^(skyrimPlatform|\.\/clientListener|\.\/timersService|\.\/networkingService|\.\/settingsService|\.\.\/\.\.\/logging|\.\.\/\.\.\/messages)$/ },
      (a) => ({ path: a.path.replace(/.*\//, ''), namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
  },
};

const H = { posts: [], opened: [], timers: [], js: [], errors: [] };
globalThis.__dlH = H;

function makeService(AuthService) {
  const emitterHandlers = {};
  const handlers = {};
  const lookups = {
    TimersService: { setTimeout: (fn, ms) => H.timers.push({ fn, ms }) },
    SettingsService: { getMasterUrl: () => 'https://master.test/', getServerMasterKey: () => 'KEY' },
    NetworkingService: { close: () => {}, reconnect: () => {} },
  };
  const controller = {
    emitter: { on: (e, f) => (emitterHandlers[e] = emitterHandlers[e] || []).push(f), emit: () => {} },
    on: (e, f) => (handlers[e] = handlers[e] || []).push(f),
    once: () => {},
    lookupListener: (cls) => lookups[cls.name.replace(/\d+$/, '')],
  };
  const sp = {
    settings: { 'skymp5-client': { gameData: null } },
    browser: { executeJavaScript: (src) => H.js.push(src), setVisible: () => {}, setFocused: () => {} },
    win32: { loadUrl: (url) => H.opened.push(url), exitProcess: () => {} },
    HttpClient: class { constructor(base) { this.base = base; } post(route, opts, cb) { H.posts.push({ base: this.base, route, opts, cb }); } get(route) { H.posts.push({ route, get: true }); } },
    getPluginSourceCode: () => '',
    writePlugin: () => {},
    storage: {},
    Game: { disablePlayerControls: () => {} },
  };
  new AuthService(sp, controller);
  emitterHandlers.authNeeded.forEach((f) => f({}));
  emitterHandlers.browserWindowLoaded.forEach((f) => f({}));
  return { openLogin: () => handlers.browserMessage.forEach((f) => f({ arguments: ['openDiscordOauth'] })) };
}

const lastPost = () => H.posts[H.posts.length - 1];
const runLastTimer = () => { const t = H.timers.pop(); t.fn(); return t; };
const widgetText = () => H.js[H.js.length - 1] || '';
const STATE = 'a1'.repeat(32);
const DEVICE = 'd4'.repeat(32);
let D = null;
const startAnswer = { state: STATE, deviceCode: DEVICE, userCode: 'BCDF-GHJK', interval: 3, expiresIn: 600 };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-devicelogin-'));
  let A;
  try {
    const out = path.join(dir, 'auth.js');
    await esbuild.build({ entryPoints: [path.join(SRC, 'services/services/authService.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, plugins: [stubPlugin], logLevel: 'error' });
    A = require(out);
    const deviceSrc = path.join(SRC, 'services/services/discordDeviceLogin.ts');
    if (fs.existsSync(deviceSrc)) {
      const out2 = path.join(dir, 'device.js');
      await esbuild.build({ entryPoints: [deviceSrc], bundle: true, platform: 'node', format: 'cjs', outfile: out2, logLevel: 'error' });
      D = require(out2);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---- the flow ----
  const svc = makeService(A.AuthService);
  H.timers.length = 0;
  svc.openLogin();
  const start = lastPost();
  check('the sign-in starts with the backend, not with a state the game makes', start && start.route === '/api/users/login-discord/start', start && start.route);
  check('nothing opens in the browser before the backend answered', H.opened.length === 0, H.opened);
  check('the start body asks for the game flow', !!(start && start.opts && JSON.parse(start.opts.body).client === 'game'), start && start.route);
  if (!start || start.route !== '/api/users/login-discord/start') { console.log('\nthe flow cannot go on without /start'); finishParser(); return; }
  start.cb({ status: 200, body: JSON.stringify(startAnswer) });
  check('the browser opens the backend page with the issued state', H.opened[0] === `https://master.test/api/users/login-discord?state=${STATE}`, H.opened);
  check('the device code is never in a URL', !H.opened.some((u) => u.includes(DEVICE)), H.opened);
  check('the game shows the code and the warning', /BCDF-GHJK/.test(widgetText()) && /never give this code to anyone/.test(widgetText()));
  const firstTimer = runLastTimer();
  check('the poll waits the interval the backend gave', firstTimer.ms === 3000, firstTimer.ms);
  const poll1 = lastPost();
  check('the poll goes to /poll with the state and the device code', poll1.route === '/api/users/login-discord/poll' &&
    JSON.parse(poll1.opts.body).device_code === DEVICE && JSON.parse(poll1.opts.body).state === STATE, poll1 && poll1.opts);
  check('the old status route is never polled', !H.posts.some((p) => /login-discord\/status/.test(p.route)));
  poll1.cb({ status: 401, body: '{"error":"authorization_pending"}' });
  check('pending polls again', H.timers.length === 1);
  runLastTimer();
  const poll2 = lastPost();
  poll2.cb({ status: 200, body: JSON.stringify({ token: 'b2'.repeat(32), masterApiId: 5, discordUsername: 'Alpha', discordDiscriminator: null, discordAvatar: null }) });
  const play = lastPost();
  check('the result makes the play session with its token', play.route === '/api/users/me/play/KEY' && play.opts.headers.authorization === 'b2'.repeat(32), play && play.route);
  play.cb({ status: 200, body: JSON.stringify({ session: 'b2'.repeat(32) }) });
  check('the game says it is linked', /linked successfully/.test(widgetText()));
  check('no poll is left running after the result', H.timers.length === 0, H.timers.length);

  // ---- an expired sign-in and a backend without the new login ----
  svc.openLogin();
  lastPost().cb({ status: 200, body: JSON.stringify({ ...startAnswer, state: 'e5'.repeat(32) }) });
  runLastTimer();
  lastPost().cb({ status: 403, body: '{"error":"expired_token"}' });
  check('an expired sign-in says so and stops polling', /the sign-in expired/.test(widgetText()) && H.timers.length === 0);
  const openedBefore = H.opened.length;
  svc.openLogin();
  lastPost().cb({ status: 404, body: 'Cannot POST' });
  check('a backend without /start opens nothing and says sign-in is unavailable', H.opened.length === openedBefore && /unavailable/.test(widgetText()));

  finishParser();
})().catch((e) => { console.error(e); process.exit(2); });

function finishParser() {
  // ---- the parser ----
  if (!D) { check('discordDeviceLogin.ts exists', false); D = { parseStart: () => ({}), pollOutcome: () => ({}) }; }
  check('parseStart refuses a short state', D.parseStart(200, JSON.stringify({ ...startAnswer, state: 'a' }), 0) === null);
  check('parseStart refuses a missing device code', D.parseStart(200, JSON.stringify({ ...startAnswer, deviceCode: undefined }), 0) === null);
  check('parseStart refuses a non-200', D.parseStart(500, JSON.stringify(startAnswer), 0) === null);
  check('parseStart clamps the interval to 2-10 s', D.parseStart(200, JSON.stringify({ ...startAnswer, interval: 0.01 }), 0).intervalMs === 2000);
  check('a 200 without a token is retried, not taken', D.pollOutcome(200, '{}').kind === 'retry');

  const src = fs.readFileSync(path.join(SRC, 'services/services/authService.ts'), 'utf8');
  check('authService no longer makes its own login state', !/randomBytes/.test(src) && !/discordAuthState/.test(src));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}
