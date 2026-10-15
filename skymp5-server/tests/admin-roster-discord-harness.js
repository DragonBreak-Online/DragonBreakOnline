// Scripted test for who sees Discord ids and names in the F7 admin roster (security audit L2-7 / L3-05, 15 Oct): Lead GM
// and above see each account's Discord id and name, online and offline, as before; a Trial GM gets only who is online, with no Discord, address or hardware id, and the backend's account list is not fetched for them.
// The tools still work: the rows keep the actor id, name and #TAG a teleport or rename acts on.
// It bundles adminSystem.ts with esbuild (settings, NPC spawns, mastery and the ban store stubbed) and fakes the native
// server and the backend's GET /:key/players with made-up accounts. Run it from skymp5-server with node_modules present:
//
//   node tests/admin-roster-discord-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-adminroster-'));

const stubSources = {
  '../settings': 'module.exports = { Settings: { get: async () => globalThis.__admin.settings } };',
  './npcSpawnSystem': 'module.exports = { NpcSpawnSystem: class {} };',
  './masterySystem': 'module.exports = { MasterySystem: class {}, MAX_GRANT: 0 };',
  './adminBans': 'module.exports = { AdminBans: class { list() { return []; } } };',
};
const stubFilter = new RegExp('^(' + Object.keys(stubSources).map((k) => k.replace(/[./-]/g, '\\$&')).join('|') + ')$');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };

// One staff member per rank, two online players (one with no profile yet) and one account that is offline
const STAFF = [
  { tier: 'senior', userId: 1, actorId: 0xff000011, profileId: 11, roles: ['role-senior'] },
  { tier: 'developer', userId: 2, actorId: 0xff000012, profileId: 12, roles: ['role-dev'] },
  { tier: 'leadgm', userId: 3, actorId: 0xff000013, profileId: 13, roles: ['role-lead'] },
  { tier: 'gm', userId: 4, actorId: 0xff000014, profileId: 14, roles: ['role-gm'] },
  { tier: 'trialgm', userId: 5, actorId: 0xff000015, profileId: 15, roles: ['role-trial'] },
];
const MIRA = { userId: 6, actorId: 0xff000016, profileId: 16, name: 'Mira', tag: 'MRA2', discordId: 'DISCORD-ID-MIRA', discordName: 'Discord Name Mira' };
const NOPROFILE = { userId: 7, actorId: 0xff000017, profileId: 0, name: 'Newcomer', tag: 'NEW3', discordId: 'DISCORD-ID-NEW' };
const OFFLINE = { profileId: 30, discordId: 'DISCORD-ID-OFFLINE', discordName: 'Discord Name Offline' };
const backendPlayers = [
  { profileId: MIRA.profileId, discordId: MIRA.discordId, username: 'discord-user-mira', displayName: MIRA.discordName, hwid: 'hwid-mira', lastIp: 'lastip-mira' },
  { profileId: OFFLINE.profileId, discordId: OFFLINE.discordId, username: 'discord-user-offline', displayName: OFFLINE.discordName, hwid: 'hwid-offline', lastIp: 'lastip-offline' },
].concat(STAFF.map((s) => ({ profileId: s.profileId, discordId: `DISCORD-ID-${s.tier}`, username: `discord-user-${s.tier}`, displayName: `Discord Name ${s.tier}`, hwid: `hwid-${s.tier}`, lastIp: `lastip-${s.tier}` })));
// Every Discord value above: none may reach a GM or a Trial GM, in any field
const DISCORD_VALUES = backendPlayers.flatMap((r) => [r.discordId, r.username, r.displayName]).concat([NOPROFILE.discordId]);

const users = new Map();
const props = {};
const packets = [];
const addActor = (userId, actorId, p) => { users.set(userId, actorId); props[actorId] = p; };
for (const s of STAFF) addActor(s.userId, s.actorId, { appearance: { name: `Staff ${s.tier}` }, profileId: s.profileId, 'private.discordRoles': s.roles, ff_charTag: `S${s.userId}AA` });
addActor(MIRA.userId, MIRA.actorId, { appearance: { name: MIRA.name }, profileId: MIRA.profileId, 'private.discordRoles': [], ff_charTag: MIRA.tag, 'private.skympDiscordId': MIRA.discordId, locationalData: { cellOrWorldDesc: 'cell-mira', pos: [1, 2, 3], rot: [0, 0, 0] } });
addActor(NOPROFILE.userId, NOPROFILE.actorId, { appearance: { name: NOPROFILE.name }, profileId: 0, 'private.discordRoles': [], ff_charTag: NOPROFILE.tag, 'private.skympDiscordId': NOPROFILE.discordId });
const mp = {
  isConnected: (u) => users.has(u),
  getUserActor: (u) => users.get(u) || 0,
  get: (a, k) => (props[a] || {})[k],
  set: (a, k, v) => { (props[a] = props[a] || {})[k] = v; },
  getUserIp: (u) => `userip-${u}`,
  getUserGuid: (u) => `guid-${u}`,
  getPrometheusMetrics: () => '',
  sendCustomPacket: (u, s) => packets.push({ u, p: JSON.parse(s) }),
  setEnabled: () => {},
  kick: () => {},
  getIdFromDesc: () => 0,
};

globalThis.__admin = {
  settings: {
    name: 'test', master: 'http://master.test', masterKey: 'KEY',
    allSettings: { masterApiAuthToken: 't', adminRoles: { senior: ['role-senior'], developer: ['role-dev'], leadgm: ['role-lead'], gm: ['role-gm'], trialgm: ['role-trial'] } },
  },
};
let fetches = 0;
globalThis.fetch = async (url) => {
  fetches++;
  if (!/\/api\/servers\/KEY\/players$/.test(url)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ players: JSON.parse(JSON.stringify(backendPlayers)) }) };
};
const turn = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 30; i++) await turn(); };

(async () => {
  await esbuild.build({
    entryPoints: [path.join(root, 'ts', 'systems', 'adminSystem.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'admin.js'), logLevel: 'error',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: stubFilter }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubSources[a.path], loader: 'js' }));
      },
    }],
  });
  const cwd = process.cwd();
  process.chdir(out);
  const { AdminSystem } = require(path.join(out, 'admin.js'));
  const sys = new AdminSystem(() => {}, { listZones: () => [] }, { summaryOf: () => null });
  sys.adminLog = () => {};
  const ctx = { svr: mp, gm: new EventEmitter() };
  await sys.initAsync(ctx);

  const menuFor = async (s, label) => {
    packets.length = 0;
    const before = fetches;
    sys.customPacket(s.userId, 'adminMenuRequest', { customPacketType: 'adminMenuRequest' }, ctx);
    await settle();
    const menu = (packets.find((x) => x.u === s.userId && x.p.customPacketType === 'adminMenu') || {}).p;
    check(`${label}: the menu comes, as ${s.tier}`, !!menu && menu.tier === s.tier, menu && menu.tier);
    return { menu: menu || { players: [] }, fetched: fetches - before };
  };
  const rowOf = (rows, profileId) => rows.find((r) => r.p === profileId);
  const leaks = (menu) => { const text = JSON.stringify(menu); return DISCORD_VALUES.filter((v) => text.includes(v)); };

  // ---- Lead GM and above: unchanged, Discord id and name on online and offline rows ----
  for (const s of STAFF.filter((x) => ['senior', 'developer', 'leadgm'].includes(x.tier))) {
    const { menu } = await menuFor(s, s.tier);
    const mira = rowOf(menu.players, MIRA.profileId), off = rowOf(menu.players, OFFLINE.profileId);
    check(`${s.tier}: an online player's row carries the Discord id and name`, !!mira && mira.online && mira.d === MIRA.discordId && mira.dn === MIRA.discordName, mira);
    check(`${s.tier}: an offline account's row carries them too`, !!off && !off.online && off.d === OFFLINE.discordId && off.dn === OFFLINE.discordName, off);
  }

  // ---- a Trial GM: who is online, by character name and #TAG, nothing that names an account ----
  const trial = STAFF.find((x) => x.tier === 'trialgm');
  {
    const { menu, fetched } = await menuFor(trial, 'Trial GM');
    const rows = menu.players;
    check('Trial GM: only online rows', rows.length > 0 && rows.every((r) => r.online === true), rows.map((r) => [r.p, r.online]));
    check('Trial GM: no offline account is listed', !rowOf(rows, OFFLINE.profileId), rowOf(rows, OFFLINE.profileId));
    check('Trial GM: no row carries a Discord id or name', rows.every((r) => r.d === '' && r.dn === ''), rows.map((r) => [r.p, r.d, r.dn]));
    check('Trial GM: no Discord value anywhere in the menu', leaks(menu).length === 0, leaks(menu));
    check('Trial GM: no address or hardware id, as before', rows.every((r) => r.ip === '' && r.hwid === ''), rows.map((r) => [r.ip, r.hwid]));
    check('Trial GM: the backend account list is not fetched for their menu', fetched === 0, fetched);
    const mira = rowOf(rows, MIRA.profileId);
    check('Trial GM: online players keep the actor id, name and #TAG', !!mira && mira.a === MIRA.actorId.toString(16) && mira.n === MIRA.name && mira.t === MIRA.tag, mira);
    check('Trial GM: the player with no profile yet is listed too', rows.some((r) => r.n === NOPROFILE.name), rows.map((r) => r.n));
    check('Trial GM: the trial caps are unchanged', menu.caps && menu.caps.trial === true && menu.caps.tabs.join() === 'debug,players,teleport,modes', menu.caps);
    props[trial.actorId].locationalData = undefined;
    packets.length = 0;
    sys.customPacket(trial.userId, 'adminAction', { customPacketType: 'adminAction', action: 'teleportTo', target: mira ? mira.a : '' }, ctx);
    const r = (packets.find((x) => x.p.customPacketType === 'adminActionResult') || {}).p;
    check('Trial GM: teleport to a player from the roster still works', !!r && r.ok === true && props[trial.actorId].locationalData && props[trial.actorId].locationalData.cellOrWorldDesc === 'cell-mira', r);
  }

  // ---- a player still gets nothing ----
  packets.length = 0;
  sys.customPacket(MIRA.userId, 'adminMenuRequest', { customPacketType: 'adminMenuRequest' }, ctx);
  await settle();
  check('a player asking for the menu gets nothing', packets.length === 0, packets.map((x) => x.p.customPacketType));

  process.chdir(cwd);
  fs.rmSync(out, { recursive: true, force: true });
  console.log('');
  console.log(failures ? `${failures} FAILURES` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); try { fs.rmSync(out, { recursive: true, force: true }); } catch (x) { /* gone */ } process.exit(1); });
