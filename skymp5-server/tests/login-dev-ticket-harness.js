// Scripted test for dev server tickets (8 Nov 2026). The dev server stays in offline mode behind a public relay, so the
// profileId a client states can no longer be trusted: with server-settings "devTickets" set, a remote client must bring a
// ticket the backend signed for a Lead GM or above (skymp5-backend scripts/dev-ticket.js), and a bare profileId is only
// taken from loopback (Nat's 7779 admin relay). Without "devTickets" nothing changes.
//
// It bundles login.ts with esbuild (settings, metrics, fetch-retry, the kick helper and Discord ban roles stubbed), signs
// tickets with the backend's own signer, and drives customPacket. Run it from skymp5-server with node_modules present:
//
//   node tests/login-dev-ticket-harness.js
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const { signDevTicket, publicKeyOf } = require(path.join(root, '..', 'skymp5-backend', 'scripts', 'dev-ticket.js'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'login-devticket-'));
const bundle = path.join(out, 'login.js');

const stubs = {
  '../settings': 'module.exports = { Settings: { get: async () => globalThis.__dt.settings } };',
  './metricsSystem': 'module.exports = { loginsCounter: { inc() {} }, loginErrorsCounter: { inc() {} } };',
  'fetch-retry': 'module.exports = { __esModule: true, default: () => (...a) => globalThis.__dt.fetch(...a) };',
  './kickUtil': 'module.exports = { kickWithReason: (mp, userId, reason) => globalThis.__dt.kicks.push([userId, reason]) };',
  './discordBanSystem': 'module.exports = { hasDiscordBanRole: () => false };',
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

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { failed++; if (detail !== undefined) console.log('      ', JSON.stringify(detail)); }
};

const { privateKey } = crypto.generateKeyPairSync('ed25519');
const other = crypto.generateKeyPairSync('ed25519').privateKey;
const PUB = publicKeyOf(privateKey);
const claims = { profileId: 42, discordId: '310000000000000042', username: 'LeadGm', tier: 'leadgm', roles: ['1494126618065506425'] };
const ticket = (over = {}, opts = {}, key = privateKey) => signDevTicket(key, { ...claims, ...over }, opts).ticket;

globalThis.__dt = { settings: null, kicks: [], fetch: async () => { throw new Error('no network in this test'); } };
const settingsWith = (devTickets) => ({ allSettings: { adminProfileIds: [1, 2, 899999], ...(devTickets === undefined ? {} : { devTickets }) } });

(async () => {
  await built;
  const { Login } = require(bundle);
  let ip = '10.77.0.1';
  const emitted = [];
  const logs = [];
  const svr = {
    getUserIp: () => ip,
    getUserGuid: () => 'guid',
    isConnected: () => true,
    sendCustomPacket: () => {},
    getActorsByProfileId: () => [],
  };
  const ctx = { svr, gm: { emit: (...a) => emitted.push(a) } };
  const make = async (devTickets) => {
    globalThis.__dt.settings = settingsWith(devTickets);
    const l = new Login((...a) => logs.push(a.join(' ')), 100, '', 7777, '', true);
    await l.initAsync(ctx);
    return l;
  };
  let uid = 0;
  const run = (login, gameData) => {
    uid++;
    emitted.length = 0; globalThis.__dt.kicks.length = 0;
    login.customPacket(uid, 'loginWithSkympIo', { gameData }, ctx);
    const spawn = emitted.find((e) => e[0] === 'spawnAllowed');
    return { spawn, kick: globalThis.__dt.kicks.find(([u]) => u === uid) };
  };

  const on = await make({ publicKey: PUB });
  check('the boot line says dev tickets are on, loopback only for profileId logins', logs.some((l) => /dev tickets on .*offset 1000000.*loopback only/.test(l)), logs);

  let r = run(on, { session: ticket() });
  check('a Lead GM ticket logs in', !!r.spawn && !r.kick, r);
  check('...as the backend profile id plus 1000000', r.spawn && r.spawn[2] === 1000042, r.spawn);
  check('...with the Discord id and the roles from the ticket', r.spawn && r.spawn[4] === claims.discordId && JSON.stringify(r.spawn[3]) === JSON.stringify(claims.roles), r.spawn);
  check('...and logs who it was without the ticket itself', logs.some((l) => /dev ticket LeadGm \(leadgm, discord 310000000000000042, ticket [0-9a-f]{8}\) logged in as 1000042/.test(l)) && !logs.some((l) => l.includes('dbodev1.')), logs.slice(-2));

  for (const tier of ['owner', 'dev']) {
    r = run(on, { session: ticket({ tier }) });
    check(`a ${tier} ticket logs in`, !!r.spawn, r);
  }
  r = run(on, { session: ticket({ tier: 'gm' }) });
  check('a GM ticket is refused (Lead GM and above only)', !r.spawn && !!r.kick, r);

  const now = Math.floor(Date.now() / 1000);
  r = run(on, { session: ticket({}, { nowSec: now - 13 * 3600 }) });
  check('an expired ticket is refused', !r.spawn && !!r.kick && /expired/.test(r.kick[1]), r);
  r = run(on, { session: ticket({}, { nowSec: now + 3600 }) });
  check('a ticket issued in the future is refused', !r.spawn && !!r.kick, r);
  r = run(on, { session: ticket({}, {}, other) });
  check('a ticket signed by another key is refused', !r.spawn && !!r.kick, r);
  const good = ticket().split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(good[1], 'base64url')), p: 1 })).toString('base64url');
  r = run(on, { session: `${good[0]}.${forged}.${good[2]}` });
  check('a ticket whose payload was edited is refused', !r.spawn && !!r.kick, r);
  for (const bad of ['dbodev1.', 'dbodev1.a.b', `dbodev1.${good[1]}.${good[2]}.x`, `dbodev1.${good[1]}!.${good[2]}`, 'dbodev1.' + 'a'.repeat(5000), { toString: 1 }]) {
    r = run(on, { session: bad });
    if (r.spawn || !r.kick) check(`a malformed ticket is refused: ${String(bad).slice(0, 30)}`, false, r);
  }
  check('malformed tickets are all refused', true);

  r = run(on, { session: 'a'.repeat(64) });
  check('a production master session is refused on a ticket server', !r.spawn && !!r.kick && /Choose Dev in the DragonBreak launcher/.test(r.kick[1]), r);

  r = run(on, { profileId: 5150 });
  check('a remote profileId login is refused', !r.spawn && !!r.kick && /dev server/.test(r.kick[1]), r);
  r = run(on, { profileId: 1 });
  check('...an admin one too, not remapped', !r.spawn && !!r.kick, r);
  ip = '127.0.0.1';
  r = run(on, { profileId: 2 });
  check('a loopback profileId login still works (the 7779 admin relay)', !!r.spawn && r.spawn[2] === 2, r);
  ip = '10.77.0.1';

  const tail = await make({ publicKey: PUB, trustedProfileIdSources: ['100.64.0.0/10', 'nonsense', '300.1.1.1/8'] });
  check('the boot line names the trusted sources and reports unreadable ones', logs.some((l) => /from loopback and 100\.64\.0\.0\/10,/.test(l)) && logs.some((l) => /2 unreadable/.test(l)), logs.slice(-3));
  ip = '100.98.153.18';
  r = run(tail, { profileId: 5150 });
  check('a profileId login from a trusted source (Tailscale 100.64/10) works', !!r.spawn && r.spawn[2] === 5150, r);
  r = run(tail, { profileId: 2 });
  check('...but an admin profile id from there is still remapped, as before', !!r.spawn && r.spawn[2] !== 2, r);
  ip = '::ffff:100.111.0.9';
  r = run(tail, { profileId: 5151 });
  check('...an IPv4-mapped address counts too', !!r.spawn && r.spawn[2] === 5151, r);
  for (const outside of ['100.128.0.1', '100.63.255.255', '172.20.16.1', '10.77.0.1']) {
    ip = outside;
    r = run(tail, { profileId: 5150 });
    if (r.spawn || !r.kick) check(`a profileId login from outside the trusted list is refused: ${outside}`, false, r);
  }
  check('profileId logins from outside the trusted list (the public gate path among them) are refused', true);
  ip = '172.20.16.1';
  r = run(tail, { session: ticket() });
  check('...while a pass through the gate path still logs in', !!r.spawn && r.spawn[2] === 1000042, r);
  ip = '10.77.0.1';

  const revoked = await make({ publicKey: PUB, revokedDiscordIds: [claims.discordId] });
  r = run(revoked, { session: ticket() });
  check('a revoked Discord id is refused', !r.spawn && !!r.kick, r);

  const clash = await make({ publicKey: PUB, profileIdOffset: 0 });
  r = run(clash, { session: ticket({ profileId: 2 }) });
  check('a ticket landing on an admin profile id is refused', !r.spawn && !!r.kick, r);

  const open = await make({ publicKey: PUB, remoteProfileIdLogins: true, tiers: ['owner', 'dev', 'leadgm', 'gm'] });
  r = run(open, { profileId: 5150 });
  check('remoteProfileIdLogins: true takes remote profileId logins again', !!r.spawn && r.spawn[2] === 5150, r);
  r = run(open, { session: ticket({ tier: 'gm' }) });
  check('...and tiers can widen the ticket list', !!r.spawn, r);

  logs.length = 0;
  const broken = await make({ publicKey: 'not a key' });
  check('an unusable public key is reported at boot', logs.some((l) => /publicKey is unusable/.test(l)), logs);
  r = run(broken, { session: ticket() });
  check('...and every ticket is refused', !r.spawn && !!r.kick, r);
  r = run(broken, { profileId: 5150 });
  check('...and remote profileId logins stay refused', !r.spawn && !!r.kick, r);

  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  logs.length = 0;
  const wrongKind = await make({ publicKey: rsa });
  check('a key that is not Ed25519 is refused at boot', logs.some((l) => /not ed25519/.test(l)), logs);
  r = run(wrongKind, { session: ticket() });
  check('...and so is every ticket', !r.spawn, r);

  const off = await make(undefined);
  r = run(off, { profileId: 5150 });
  check('without devTickets a remote profileId login works as before', !!r.spawn && r.spawn[2] === 5150, r);
  r = run(off, { profileId: 1 });
  check('...and a remote admin profile id is still remapped', !!r.spawn && r.spawn[2] !== 1, r);
  r = run(off, { session: ticket() });
  check('...and a ticket is ignored there', !r.spawn && !r.kick, r);

  fs.rmSync(out, { recursive: true, force: true });
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
