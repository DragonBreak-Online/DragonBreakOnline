// Scripted test for the login refusals after a restart (bug 1021a, 21 Oct 2026). When many players log in within the
// same second or two, Discord answers the guild member lookup with 429 (rate limited) and login.ts treated that as "not
// in any of the Discord servers": 99 refusals between 11 and 21 Oct, all in login bursts, and every one that could be
// tied to a profile was a player who had played in the 24 h before. A 429 is "ask again in retry_after seconds", never
// "not a member"; when Discord still gives no answer, the backend's own membership answer for this session, from
// seconds earlier, decides; a genuine non-member (Discord's 404) is always refused.
//
// It bundles login.ts with esbuild (settings, metrics, fetch-retry, the kick helper and Discord ban roles stubbed),
// fakes the master api and Discord with a scripted fetch, and drives customPacket. Run it from skymp5-server with
// node_modules present:
//
//   node tests/login-discord-ratelimit-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'login-ratelimit-'));
const bundle = path.join(out, 'login.js');

const stubs = {
  '../settings': 'module.exports = { Settings: { get: async () => globalThis.__rl.settings } };',
  './metricsSystem': 'const c = { inc(l) { globalThis.__rl.errors.push(l && l.reason) } }; module.exports = { loginsCounter: { inc() {} }, loginErrorsCounter: c };',
  'fetch-retry': 'module.exports = { __esModule: true, default: () => (...a) => globalThis.__rl.fetch(...a) };',
  './kickUtil': 'module.exports = { kickWithReason: (mp, userId, reason) => globalThis.__rl.kicks.push([userId, reason]) };',
  './discordBanSystem': 'module.exports = { hasDiscordBanRole: (g, roles) => !!g.banRoleId && roles.includes(g.banRoleId) };',
};
const built = esbuild.build({
  entryPoints: [path.join(root, 'ts', 'systems', 'login.ts')],
  bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
  plugins: [{
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: /^(\.\.\/settings|\.\/metricsSystem|fetch-retry|\.\/kickUtil|\.\/discordBanSystem)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubs[a.path], loader: 'js' }));
    },
  }],
});

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };
const section = (t) => console.log(`\n-- ${t}`);

// ---- the world ----
const rl = globalThis.__rl = { settings: null, fetch: null, kicks: [], errors: [] };
let world;          // { sessions: { token: user }, discord: (guildId, discordId, n) => answer }
let discordCalls;   // [{ at, guildId, discordId, status }]
let packets, emitted, logs;

const headersOf = (h) => ({ get: (k) => (h && Object.prototype.hasOwnProperty.call(h, k.toLowerCase()) ? String(h[k.toLowerCase()]) : null) });
const answer = (status, body, headers) => ({
  ok: status >= 200 && status < 300, status, statusText: String(status), headers: headersOf(headers),
  json: async () => body,
});
const member = (roles = ['R'], headers) => answer(200, { roles }, headers);
const notMember = () => answer(404, { message: 'Unknown Member', code: 10007 });
const limited = (retryAfterS, headers, global = false) => answer(429, { message: 'You are being rate limited.', retry_after: retryAfterS, global }, headers);

rl.fetch = async (url) => {
  const u = new URL(url);
  if (u.pathname.endsWith('/connection-check')) return answer(200, { allowed: true });
  let m = u.pathname.match(/^\/api\/servers\/KEY\/sessions\/([^/]+)$/);
  if (m) {
    const user = world.sessions[decodeURIComponent(m[1])];
    return user ? answer(200, { user }) : answer(404, {});
  }
  m = u.pathname.match(/^\/api\/guilds\/([^/]+)\/members\/([^/]+)$/);
  if (u.hostname === 'discord.com' && m) {
    const n = discordCalls.filter((c) => c.discordId === m[2]).length;
    const r = await world.discord(m[1], m[2], n);
    discordCalls.push({ at: Date.now(), guildId: m[1], discordId: m[2], status: r.status });
    return r;
  }
  if (u.hostname === 'discord.com') return answer(200, {});   // the event log channel post
  return answer(404, {});
};

const settingsWith = (guilds) => ({ allSettings: { masterApiAuthToken: 't' }, discordAuth: { botToken: 'bot', guilds } });
const svr = {
  getUserIp: () => '203.0.113.9',
  getUserGuid: (u) => `guid-${u}`,
  isConnected: () => true,
  sendCustomPacket: (u, p) => packets.push([u, JSON.parse(p).customPacketType]),
  getActorsByProfileId: () => [],
};
const ctx = { svr, gm: { emit: (...a) => emitted.push(a) } };

const sessionFor = (i) => String.fromCharCode(97 + (i % 26)).repeat(40) + String(i).padStart(24, '0');
const reset = (w) => { world = w; discordCalls = []; packets = []; emitted = []; logs = []; rl.kicks.length = 0; rl.errors.length = 0; };
const spawned = (u) => emitted.some((e) => e[0] === 'spawnAllowed' && e[1] === u);
const refusedNotInDiscord = (u) => packets.some(([pu, t]) => pu === u && t === 'loginFailedNotInTheDiscordServer');
const finished = (u) => spawned(u) || packets.some(([pu]) => pu === u);
const waitFor = async (pred, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; await new Promise((r) => setTimeout(r, 5)); } return pred(); };

let Login;
const quiet = { log: console.log, error: console.error, warn: console.warn };
const mute = () => { console.log = (...a) => logs.push(a.join(' ')); console.error = (...a) => logs.push(a.join(' ')); console.warn = (...a) => logs.push(a.join(' ')); };
const unmute = () => { console.log = quiet.log; console.error = quiet.error; console.warn = quiet.warn; };

// One login on a fresh Login (a fresh server process); resolves when it spawned or was refused
const newLogin = async (guilds) => {
  rl.settings = settingsWith(guilds);
  const login = new Login((...a) => logs.push(a.join(' ')), 100, 'http://master.test', 7777, 'KEY', false);
  await login.initAsync(ctx);
  return login;
};
const loginOnce = async (login, userId, session) => {
  const t0 = Date.now();
  login.customPacket(userId, 'loginWithSkympIo', { gameData: { session } }, ctx);
  await waitFor(() => finished(userId));
  return Date.now() - t0;
};

const G = [{ guildId: 'G', banRoleId: 'BANROLE' }];
const user = (i, extra) => ({ id: 100 + i, discordId: String(5550 + i), ...extra });

(async () => {
  await built;
  ({ Login } = require(bundle));

  section('a single 429 is asked again, not a refusal');
  reset({ sessions: { [sessionFor(1)]: user(1) }, discord: async (g, d, n) => (n === 0 ? limited(0.05) : member()) });
  mute(); let login = await newLogin(G); await loginOnce(login, 1, sessionFor(1)); unmute();
  check('a member rate limited once logs in', spawned(1), { packets, calls: discordCalls.map((c) => c.status) });
  check('...after asking Discord again once the 429 passed', discordCalls.length === 2 && discordCalls[1].at - discordCalls[0].at >= 45, discordCalls.map((c) => c.status));
  check('...and is never told to join the Discord', !refusedNotInDiscord(1), packets);

  section('the wait comes from the Retry-After header when the body has none');
  reset({ sessions: { [sessionFor(2)]: user(2) }, discord: async (g, d, n) => (n === 0 ? answer(429, {}, { 'retry-after': '0.06' }) : member()) });
  mute(); login = await newLogin(G); await loginOnce(login, 2, sessionFor(2)); unmute();
  check('a 429 with only a Retry-After header is waited out and asked again', spawned(2) && discordCalls.length === 2 && discordCalls[1].at - discordCalls[0].at >= 55, discordCalls.map((c) => [c.status, c.at - discordCalls[0].at]));

  section('a genuine non-member is refused, with one Discord call');
  reset({ sessions: { [sessionFor(3)]: user(3) }, discord: async () => notMember() });
  mute(); login = await newLogin(G); await loginOnce(login, 3, sessionFor(3)); unmute();
  check('Discord\'s 404 refuses the login as not in the Discord', refusedNotInDiscord(3) && !spawned(3), packets);
  check('...without asking again', discordCalls.length === 1, discordCalls.length);
  reset({ sessions: { [sessionFor(4)]: user(4, { discordMember: true, roles: ['R'] }) }, discord: async () => notMember() });
  mute(); login = await newLogin(G); await loginOnce(login, 4, sessionFor(4)); unmute();
  check('Discord\'s own 404 wins over the backend\'s earlier yes (left the Discord a moment ago)', refusedNotInDiscord(4) && !spawned(4), packets);

  section('Discord keeps rate limiting: the backend\'s membership answer for this session decides');
  reset({ sessions: { [sessionFor(5)]: user(5, { discordMember: true, roles: ['R', 'R2'] }) }, discord: async () => limited(0.02) });
  mute(); login = await newLogin(G); const took5 = await loginOnce(login, 5, sessionFor(5)); unmute();
  check('a member the backend found in the Discord logs in while Discord rate limits the game server', spawned(5) && !refusedNotInDiscord(5), packets);
  const ev5 = emitted.find((e) => e[0] === 'spawnAllowed' && e[1] === 5);
  check('...with the roles the backend read for that member', !!ev5 && JSON.stringify(ev5[3]) === JSON.stringify(['R', 'R2']), ev5 && ev5[3]);
  check('...after a bounded number of tries', discordCalls.length >= 2 && discordCalls.length <= 4, discordCalls.length);
  check('...well inside the client\'s 15 s login wait', took5 < 8000, took5);
  check('...and the log says Discord rate limited the check', logs.some((l) => /rate limit/i.test(l) && /429/.test(l)), logs.filter((l) => /discord/i.test(l)).slice(0, 5));

  for (const [label, extra] of [['no backend answer (older backend)', {}], ['the backend could not reach Discord either', { discordMember: null }], ['the backend said not a member', { discordMember: false }]]) {
    reset({ sessions: { [sessionFor(6)]: user(6, extra) }, discord: async () => limited(0.02) });
    mute(); login = await newLogin(G); await loginOnce(login, 6, sessionFor(6)); unmute();
    check(`still rate limited and ${label}: not let in`, !spawned(6) && refusedNotInDiscord(6), { packets, emitted: emitted.length });
    check(`...and counted apart from a real "not in the Discord"`, rl.errors.some((r) => /did not answer|429/.test(String(r))) && !rl.errors.includes('Not in any of the Discord servers'), rl.errors);
  }

  reset({ sessions: { [sessionFor(7)]: user(7, { discordMember: true, roles: ['R', 'BANROLE'] }) }, discord: async () => limited(0.02) });
  mute(); login = await newLogin(G); await loginOnce(login, 7, sessionFor(7)); unmute();
  check('the backend\'s roles still carry the guild\'s ban role: refused as banned', !spawned(7) && packets.some(([u, t]) => u === 7 && t === 'loginFailedBanned'), packets);

  section('other answers that are not a "no"');
  for (const [status, label] of [[503, 'a 5xx left over after fetch-retry\'s own retries'], [401, 'a 401 (bot token problem)'], [403, 'a 403 (no members intent)']]) {
    reset({ sessions: { [sessionFor(8)]: user(8, { discordMember: true, roles: ['R'] }) }, discord: async () => answer(status, {}) });
    mute(); login = await newLogin(G); await loginOnce(login, 8, sessionFor(8)); unmute();
    check(`${label}, backend found the member: logs in`, spawned(8), { packets, calls: discordCalls.length });
    check('...asked once (only a 429 is asked again here)', discordCalls.length === 1, discordCalls.length);
  }
  reset({ sessions: { [sessionFor(9)]: user(9) }, discord: async () => answer(503, {}) });
  mute(); login = await newLogin(G); await loginOnce(login, 9, sessionFor(9)); unmute();
  check('a 5xx with no backend answer: not let in', !spawned(9) && refusedNotInDiscord(9), packets);

  section('a 429 longer than the login can wait is not waited out');
  reset({ sessions: { [sessionFor(10)]: user(10, { discordMember: true, roles: ['R'] }) }, discord: async () => limited(60, undefined, true) });
  mute(); login = await newLogin(G); const took10 = await loginOnce(login, 10, sessionFor(10)); unmute();
  check('a 60 s global rate limit gives up at once and the backend\'s answer decides', spawned(10) && took10 < 1500, { took10, calls: discordCalls.length });
  check('...with one Discord call', discordCalls.length === 1, discordCalls.length);

  section('a slow session check leaves less time for Discord retries (the client gives up at 15 s)');
  {
    const slow = { sessions: { [sessionFor(14)]: user(14, { discordMember: true, roles: ['R'] }) }, discord: async () => limited(1) };
    reset(slow);
    const fast = rl.fetch;
    rl.fetch = async (url, opts) => {
      if (/\/sessions\/[^/]+$/.test(new URL(url).pathname)) await new Promise((r) => setTimeout(r, 9500));
      return fast(url, opts);
    };
    mute(); login = await newLogin(G); const took14 = await loginOnce(login, 14, sessionFor(14)); unmute();
    rl.fetch = fast;
    check('a 9.5 s session check: no 1 s Discord wait past 10 s into the login, the backend\'s answer decides', spawned(14) && took14 < 10300, { took14, calls: discordCalls.length });
    check('...with one Discord call', discordCalls.length === 1, discordCalls.length);
  }

  section('two guilds: a member of one is in, as before');
  reset({ sessions: { [sessionFor(11)]: user(11) }, discord: async (g) => (g === 'A' ? notMember() : member(['RB'])) });
  mute(); login = await newLogin([{ guildId: 'A' }, { guildId: 'B' }]); await loginOnce(login, 11, sessionFor(11)); unmute();
  check('not in guild A, in guild B: logs in with guild B\'s roles', spawned(11) && JSON.stringify(emitted.find((e) => e[0] === 'spawnAllowed')[3]) === '["RB"]', emitted.map((e) => e[3]));
  reset({ sessions: { [sessionFor(12)]: user(12, { discordMember: true, roles: ['R'] }) }, discord: async (g) => (g === 'A' ? notMember() : limited(0.02)) });
  mute(); login = await newLogin([{ guildId: 'A' }, { guildId: 'B' }]); await loginOnce(login, 12, sessionFor(12)); unmute();
  check('not in guild A, guild B rate limited, backend found the member: logs in', spawned(12), packets);
  reset({ sessions: { [sessionFor(13)]: user(13, { discordMember: true, roles: ['R'] }) }, discord: async () => notMember() });
  mute(); login = await newLogin([{ guildId: 'A' }, { guildId: 'B' }]); await loginOnce(login, 13, sessionFor(13)); unmute();
  check('Discord says not a member of either guild: refused even though the backend said yes', refusedNotInDiscord(13) && !spawned(13), packets);

  section('a restart burst: 9 players at once against a bucket of 4 lookups per 200 ms (19 Oct 05:52)');
  {
    const N = 9, LIMIT = 4, WINDOW = 200;
    let windowStart = 0, used = 0;
    const sessions = {};
    for (let i = 0; i < N; i++) sessions[sessionFor(20 + i)] = user(20 + i);   // no backend answer: Discord alone must let them in
    reset({
      sessions,
      discord: async () => {
        const now = Date.now();
        if (now - windowStart >= WINDOW) { windowStart = now; used = 0; }
        if (used < LIMIT) { used++; return member(['R'], { 'x-ratelimit-remaining': String(LIMIT - used), 'x-ratelimit-reset-after': String((WINDOW - (now - windowStart)) / 1000) }); }
        return limited((WINDOW - (now - windowStart)) / 1000);
      },
    });
    mute();
    login = await newLogin(G);
    const t0 = Date.now();
    for (let i = 0; i < N; i++) login.customPacket(20 + i, 'loginWithSkympIo', { gameData: { session: sessionFor(20 + i) } }, ctx);
    await waitFor(() => Array.from({ length: N }, (_, i) => finished(20 + i)).every(Boolean));
    const took = Date.now() - t0;
    unmute();
    const ok = Array.from({ length: N }, (_, i) => spawned(20 + i)).filter(Boolean).length;
    const r429 = discordCalls.filter((c) => c.status === 429).length;
    check(`all ${N} log in (before the fix 5 of 9 were told to join the Discord)`, ok === N, { loggedIn: ok, refused: packets.filter(([, t]) => t === 'loginFailedNotInTheDiscordServer').length, calls: discordCalls.map((c) => c.status).join(',') });
    check('...without hammering Discord: at most one 429 per player', r429 <= N, { r429, calls: discordCalls.length });
    check('...within a few seconds', took < 6000, took);
    const rlLines = logs.filter((l) => /rate limit/i.test(l));
    check('...and the rate limit is logged a few times, not once per lookup', rlLines.length >= 1 && rlLines.length <= 2, rlLines);
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall passed');
  try { fs.rmSync(out, { recursive: true, force: true }); } catch { }
  process.exit(failures ? 1 : 0);
})().catch((e) => { unmute(); console.error(e); process.exit(2); });
