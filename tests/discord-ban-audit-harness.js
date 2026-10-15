// A ban or unban issued on Discord (security audit L4-2): gamemode.js __dboDiscordBan writes BAN lines, the player log reads them as session.ban.
//   node tests/discord-ban-audit-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const F = require('./lib/playerlog-fakes.js');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
let failures = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!c) failures++; };
const cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); if (a < 0 || b < 0) { ok(false, `gamemode.js has the Discord ban hook (marker "${from}")`); console.log(`\n${failures} FAILED`); process.exit(1); } return src.slice(a, b); };

// ---- the fake world: Discord ids are made up, test-only values ----------------------------------------------------------------
const DISCORD = { zed: '209000000000000209', rowan: '100000000000000001', dar: '400000000000000004', nochar: '700000000000000007', bot: '900000000000000009' };
const M = F.makeMp(), FS = F.makeFs(), TM = F.makeTimers(), QU = F.makeQueue(), CL = F.makeClock();
QU.install();
const char = (a, o, discord) => { M.player(a, o); M.mp.set(a, 'private.indexed.discordId', discord); return a; };
// Zed's account has two characters: the offline one comes first in the store, the online one is the one named
const ZEDD = char(0xff000100, { profile: 209, name: 'Zedd', tag: 'K7QM', discord: DISCORD.zed }, DISCORD.zed);
const ZED = char(0xff000101, { profile: 209, name: 'Zed', tag: 'RC9H', discord: DISCORD.zed, user: 3 }, DISCORD.zed);
const ROWAN = char(0xff000014, { profile: 1, name: 'Rowan', tag: 'PGDB', discord: DISCORD.rowan, user: 1 }, DISCORD.rowan);
const DAR = char(0xff000016, { profile: 4, name: 'Dar', tag: 'U6T6', discord: DISCORD.dar }, DISCORD.dar);
const ONLINE = [ZED, ROWAN];

// ---- the hook, cut out of gamemode.js and run with the gamemode's helpers as stubs ----------------------------------------
const hookSrc = cut('const DISCORD_BAN_VIA', '\n// ---- character height');
const lines = [];
const G = {};
new Function('mp', 'audit', 'profileOf', 'tagOf', 'realNameOf', 'onlineActors', 'globalThis', hookSrc)(
  M.mp, (t) => lines.push(String(t)), (a) => Number(M.mp.get(a, 'profileId')), (a) => M.mp.get(a, 'private.charTag'),
  (a) => (M.mp.get(a, 'appearance') || {}).name || 'Stranger', () => ONLINE.slice(), G);
const discordBan = G.__dboDiscordBan;
ok(typeof discordBan === 'function', 'gamemode.js publishes globalThis.__dboDiscordBan for the fork');
const call = (info) => { lines.length = 0; const n = discordBan(info); return { n, lines: lines.slice() }; };
const noIds = (l) => !Object.values(DISCORD).some((d) => l.includes(d));

let r = call({ op: 'ban', via: 'guild ban', discordId: DISCORD.zed, by: { discordId: DISCORD.rowan, name: 'rowan_staff' }, reason: 'threats in chat\n[2026-10-15 00:00:00] GM fake line' });
ok(r.n === 1 && r.lines.length === 1, 'a ban writes one audit line for the account', r);
ok(r.lines[0] === 'BAN Discord ban (guild ban) on Zed #RC9H (profile 209), 1 more character by Rowan #PGDB (profile 1): threats in chat [2026-10-15 00:00:00] GM fake line',
  '...naming the online character by name, #TAG and profile, the moderator by their own character, and the reason on the same line', r.lines[0]);
ok(r.lines.every(noIds), '...and no Discord id value, the banned player\'s or the moderator\'s', r.lines);
const banLine = r.lines[0];

r = call({ op: 'unban', via: 'ban role', discordId: DISCORD.zed, by: { discordId: DISCORD.bot, name: 'Mod#Bot (profile 5)', bot: true } });
ok(r.lines[0] === 'BAN Discord unban (ban role) on Zed #RC9H (profile 209), 1 more character by Discord user ModBot profile 5 (a bot)',
  'an unban by a moderator with no character: their Discord username, cut to plain characters so it can never read as a character', r.lines[0]);
const unbanLine = r.lines[0];
ok(r.lines.every(noIds), '...still no Discord id value', r.lines);

r = call({ op: 'ban', discordId: DISCORD.dar, by: {} });
ok(r.lines[0] === 'BAN Discord ban (guild ban) on Dar #U6T6 (profile 4) by an unknown moderator', 'no audit-log access: an unknown moderator; an offline-only account names its character; via defaults to guild ban', r.lines[0]);
const offlineLine = r.lines[0];

r = call({ op: 'ban', via: 'guild ban', discordId: DISCORD.nochar, by: { name: 'rowan_staff' }, reason: 'alt account' });
ok(r.n === 1 && r.lines[0] === 'BAN Discord ban (guild ban) on a Discord account with no character by Discord user rowan_staff: alt account', 'an account with no character still gets its line', r.lines);
const nocharLine = r.lines[0];

r = call({ op: 'ban', discordId: DISCORD.zed, reason: `alt of <@${DISCORD.dar}> and <@!${DISCORD.rowan}>, also ${DISCORD.nochar}` });
ok(/: alt of \[id\] and \[id\], also \[id\]$/.test(r.lines[0]) && r.lines.every(noIds), 'a Discord id or mention typed into the reason is masked', r.lines[0]);
r = call({ op: 'ban', discordId: DISCORD.zed, reason: 'x'.repeat(5000) });
ok(r.lines[0].length < 320, 'a long reason is cut (200 characters)', r.lines[0].length);
ok(call({ op: 'kick', discordId: DISCORD.zed }).lines.length === 0 && call({ op: 'ban', discordId: 'not-an-id' }).lines.length === 0 && call(null).lines.length === 0,
  'anything but a ban or unban of a real Discord id writes nothing');
ok(call({ op: 'ban', discordId: DISCORD.zed, via: 'made up' }).lines[0].startsWith('BAN Discord ban (guild ban) on '), 'an unknown via is read as a guild ban');

// ---- the player log reads the lines as session.ban ---------------------------------------------------------------------------
const MODULE = path.join(ROOT, 'playerlog.js');
const api = { mp: M.mp, log: () => {}, cfg: { playerLog: { dir: '/fake/events', stopFile: '/fake/STOP' } }, every: TM.every, stopTimer: TM.stopTimer,
  onlineActors: () => ONLINE.slice(), actorOf: (u) => M.mp.getUserActor(u), fs: FS.fs, clock: CL, discordOf: (a) => String(M.mp.get(a, 'private.skympDiscordId') || ''),
  recordOf: (id) => M.mp.lookupEspmRecordById(id), adminItemName: () => '', commandsHas: () => true, WORLD_GROUPS: [], lastPacketAt: new Map() };
delete require.cache[MODULE];
const K = require(MODULE)(api);
QU.run();
const run = (line) => { const n0 = K.S.q.length; globalThis.__dboPlogHook('audit', line); K.G.parseAudits(Infinity); QU.run(); return K.S.q.slice(n0).filter((x) => !String(x.ev).startsWith('sys.')); };
const staffOf = (e) => (e.o || []).find((x) => x.r === 'staff');

let out = run(banLine);
ok(out.length === 1 && out[0].ev === 'session.ban' && out[0].f.kind === 'ban' && out[0].p === 209 && out[0].c === 'RC9H', 'the ban line is a session.ban {kind: ban} on the banned character\'s post', out);
ok(out[0] && staffOf(out[0]) && staffOf(out[0]).p === 1 && staffOf(out[0]).c === 'PGDB', '...with the moderator as its staff party', out[0]);
ok(!/threats|GM fake/.test(JSON.stringify(out)), '...and never the reason (staff-written text)', out);
out = run(unbanLine);
ok(out.length === 1 && out[0].f.kind === 'unban' && out[0].c === 'RC9H' && !staffOf(out[0]) && !/ModBot/.test(JSON.stringify(out)), 'the unban is session.ban {kind: unban}; a Discord username is never a party or kept', out);
out = run(offlineLine);
ok(out.length === 1 && out[0].p === 4 && out[0].c === 'U6T6' && out[0].f.kind === 'ban', 'an offline character\'s ban still reaches their post (by profile and #TAG)', out);
out = run(nocharLine);
ok(out.length === 0, 'an account with no character gives no player-log event (the audit channel has the line)', out);
const R = require(path.join(ROOT, 'playerlog-rules.js'));
for (const e of K.S.q.filter((x) => x.ev === 'session.ban')) {
  const drops = new Map();
  ok(R.validate(JSON.parse(JSON.stringify(e)), drops, new Map()) && drops.size === 0, `session.ban {kind: ${e.f.kind}} passes the schema with no field dropped`, [...drops.keys()]);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
