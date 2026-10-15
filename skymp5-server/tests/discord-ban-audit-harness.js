// A ban issued on Discord reaches the player log and the GM audit trail (security audit L4-2): leave reason before the kick, who and why to __dboDiscordBan.
//   node tests/discord-ban-audit-harness.js   (from skymp5-server, node_modules present; discord.js and settings are stubbed)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-discord-ban-'));
const bundle = path.join(out, 'discordBan.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

// Test-only ids: a guild, the ban role, a banned player, a moderator
const GUILD = '500000000000000005', BAN_ROLE = '600000000000000006', ZED = '209000000000000209', MOD = '100000000000000001';
const DISCORD_STUB = `
  const handlers = globalThis.__fakeDiscordHandlers = {};
  class Client { constructor() {} on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return this; } async login() { return 'ok'; } }
  module.exports = { Client, GatewayIntentBits: { Guilds: 1, GuildMembers: 2, GuildModeration: 4 },
    AuditLogEvent: { MemberBanAdd: 22, MemberBanRemove: 23, MemberRoleUpdate: 25 } };`;
const SETTINGS_STUB = `module.exports = { Settings: { get: async () => ({ offlineMode: false,
  discordAuth: { botToken: 'test-token', guilds: [{ guildId: '${GUILD}', banRoleId: '${BAN_ROLE}' }] } }) } };`;

(async () => {
  await esbuild.build({
    entryPoints: [path.join(root, 'ts', 'systems', 'discordBanSystem.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /^\.\.\/settings$|^discord\.js$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: a.path === 'discord.js' ? DISCORD_STUB : SETTINGS_STUB, loader: 'js' }));
      },
    }],
  });
  const { DiscordBanSystem } = require(bundle);
  const handlers = globalThis.__fakeDiscordHandlers;

  // ---- the fake server: user 3 plays Zed's second character, the first is offline ----------------------------------------
  const ZED_OFF = 0xff000100, ZED_ON = 0xff000101;
  const users = new Map([[3, ZED_ON]]);
  const events = [];
  const svr = {
    getUserActor: (u) => users.get(u) || 0,
    getUserByActor: (a) => { for (const [u, x] of users) if (x === a) return u; return 65535; },
    isConnected: (u) => users.has(u),
    setEnabled: (a, on) => events.push(['enabled', a, on]),
    findFormsByPropertyValue: (k, v) => (k === 'private.indexed.discordId' && v === ZED ? [ZED_OFF, ZED_ON] : []),
    sendCustomPacket: (u, p) => events.push(['packet', u, JSON.parse(p).customPacketType]),
    kick: (u) => events.push(['kick', u]),
  };
  const gm = new EventEmitter();
  const ctx = { svr, gm };
  const records = [];
  globalThis.__dboPlogHook = (name, ...args) => events.push(['plog', name, ...args]);
  globalThis.__dboDiscordBan = (info) => records.push(info);

  // ---- the fake guild's audit log ----------------------------------------------------------------------------------------
  let entries = [], denied = false, fetches = 0;
  const guild = {
    id: GUILD,
    fetchAuditLogs: async ({ type }) => {
      fetches++;
      if (denied) throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
      return { entries: new Map(entries.filter((e) => e.action === type).map((e, i) => [String(i), e])) };
    },
  };
  const entry = (action, extra) => Object.assign({ action, targetId: ZED, executorId: MOD, executor: { username: 'rowan_staff', bot: false }, reason: 'threats in chat', createdTimestamp: Date.now() - 1000, changes: [] }, extra || {});
  const member = (roles, partial) => ({ id: ZED, partial: !!partial, guild, roles: { cache: new Map(roles.map((r) => [r, {}])) } });
  const fire = (ev, ...a) => (handlers[ev] || []).forEach((fn) => fn(...a));

  const sys = new DiscordBanSystem();
  await sys.initAsync(ctx);
  sys.auditWaitsMs = [0, 5, 10];
  gm.emit('spawnAllowed', 3, 209, [], ZED);
  check('the stubbed Discord client got its handlers', !!handlers && typeof (handlers.guildBanAdd || [])[0] === 'function', handlers && Object.keys(handlers));

  // ---- a guild ban ---------------------------------------------------------------------------------------------------------
  entries = [entry(22)];
  fire('guildBanAdd', { guild, user: { id: ZED } });
  const leave = events.findIndex((e) => e[0] === 'plog' && e[1] === 'leave_reason');
  const kick = events.findIndex((e) => e[0] === 'kick');
  check('a guild ban names the leave reason to the player log for the character being played', leave >= 0 && events[leave][2] === ZED_ON && events[leave][3] === 'discord_ban', events);
  check('...before the kick (so the logout reads kicked, not unknown)', leave >= 0 && kick > leave, events);
  check('...and only for that character, not the offline one', events.filter((e) => e[0] === 'plog').length === 1, events.filter((e) => e[0] === 'plog'));
  check('the kick and the disabling work as before', kick >= 0 && events.filter((e) => e[0] === 'enabled' && e[2] === false).length === 2, events);
  await settle();
  check('the gamemode gets one ban record', records.length === 1, records);
  const r0 = records[0] || {};
  check('...op ban, via guild ban, the banned Discord account', r0.op === 'ban' && r0.via === 'guild ban' && r0.discordId === ZED, r0);
  check('...who did it and why, from the guild\'s audit log', r0.by && r0.by.discordId === MOD && r0.by.name === 'rowan_staff' && r0.by.bot === false && r0.reason === 'threats in chat', r0);

  // ---- a guild unban -------------------------------------------------------------------------------------------------------
  records.length = 0; events.length = 0;
  entries = [entry(23, { reason: 'appeal accepted' })];
  fire('guildBanRemove', { guild, user: { id: ZED } });
  await settle();
  check('a guild unban gives the gamemode an unban record with the moderator and reason', records.length === 1 && records[0].op === 'unban' && records[0].via === 'guild ban' && records[0].by.discordId === MOD && records[0].reason === 'appeal accepted', records);
  check('...and kicks nobody', !events.some((e) => e[0] === 'kick'), events);

  // ---- what the audit log does not tell ------------------------------------------------------------------------------------
  records.length = 0; denied = true; fetches = 0;
  fire('guildBanAdd', { guild, user: { id: ZED } });
  await settle();
  check('no View Audit Log: still recorded, with no moderator, after one read (no retries)', records.length === 1 && records[0].op === 'ban' && !records[0].by.discordId && !records[0].reason && fetches === 1, { records, fetches });
  records.length = 0; denied = false; entries = [entry(22, { createdTimestamp: Date.now() - 10 * 60000 })]; fetches = 0;
  fire('guildBanAdd', { guild, user: { id: ZED } });
  await settle();
  check('an audit-log entry from 10 minutes ago is an older ban: no moderator', records.length === 1 && !records[0].by.discordId && fetches === 3, { records, fetches });
  records.length = 0; entries = []; fetches = 0;
  const later = entry(22, { reason: 'late entry' });
  guild.fetchAuditLogs = ((orig) => async (o) => { if (fetches === 1) entries = [later]; return orig(o); })(guild.fetchAuditLogs);
  fire('guildBanAdd', { guild, user: { id: ZED } });
  await settle();
  check('an entry Discord writes a moment late is found on the next read', records.length === 1 && records[0].reason === 'late entry' && fetches === 2, { records, fetches });

  // ---- the ban role ----------------------------------------------------------------------------------------------------------
  records.length = 0; events.length = 0;
  entries = [entry(25, { reason: 'role ban', changes: [{ key: '$add', new: [{ id: BAN_ROLE, name: 'Banned' }] }] })];
  fire('guildMemberUpdate', member([]), member([BAN_ROLE]));
  await settle();
  check('the ban role given: the kick as before, and a ban record via ban role', events.some((e) => e[0] === 'kick') && records.length === 1 && records[0].op === 'ban' && records[0].via === 'ban role' && records[0].reason === 'role ban', records);
  records.length = 0;
  entries = [entry(25, { reason: 'lifted', changes: [{ key: '$remove', new: [{ id: BAN_ROLE, name: 'Banned' }] }] })];
  fire('guildMemberUpdate', member([BAN_ROLE]), member([]));
  await settle();
  check('the ban role taken off: an unban record via ban role', records.length === 1 && records[0].op === 'unban' && records[0].via === 'ban role' && records[0].reason === 'lifted', records);
  records.length = 0; entries = [entry(25, { changes: [{ key: '$add', new: [{ id: '42', name: 'Other' }] }] })];
  fire('guildMemberUpdate', member([], true), member([BAN_ROLE]));
  await settle();
  check('an uncached member with the role (not known to be new): no record unless the audit log shows the role given', records.length === 0, records);
  entries = [entry(25, { changes: [{ key: '$add', new: [{ id: BAN_ROLE, name: 'Banned' }] }] })];
  fire('guildMemberUpdate', member([], true), member([BAN_ROLE]));
  await settle();
  check('...and a record when it does', records.length === 1 && records[0].op === 'ban' && records[0].via === 'ban role', records);
  records.length = 0;
  fire('guildMemberUpdate', member([BAN_ROLE]), member([BAN_ROLE, '42']));
  await settle();
  check('another role change on a banned member records nothing', records.length === 0, records);

  // ---- robustness ----------------------------------------------------------------------------------------------------------
  records.length = 0;
  fire('guildBanAdd', { guild: Object.assign({}, guild, { id: '1' }), user: { id: ZED } });
  fire('guildBanRemove', { guild: Object.assign({}, guild, { id: '1' }), user: { id: ZED } });
  await settle();
  check('a ban on another guild is not ours', records.length === 0, records);
  delete globalThis.__dboDiscordBan;
  let threw = false;
  try { fire('guildBanRemove', { guild, user: { id: ZED } }); await settle(); } catch (e) { threw = true; }
  check('no gamemode loaded: nothing throws', !threw);

  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL', e && e.stack); try { fs.rmSync(out, { recursive: true, force: true }); } catch (x) { /* ignore */ } process.exit(1); });
