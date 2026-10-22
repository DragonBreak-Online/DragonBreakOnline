// Scripted test for the player log's command wrapper (CMD-WRAP, playerlog-taps.js runCommand, DESIGN.md 2.2.3), with the real
// command registry, personal() and handleChat cut out of gamemode.js: every run of a command by every route is one action
// (its name, a sub-verb from a fixed list, targets resolved through the indexes BEFORE the run, numbers at fixed places, the
// route, the outcome), the handler runs exactly once and its result or error goes back as it was, and nothing a player
// typed is kept: no argument text, no chat verb, no long chat line, no unknown command's name.
//   node tests/playerlog-commands-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const F = require('./lib/playerlog-fakes.js');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'playerlog.js');
const R = require(path.join(ROOT, 'playerlog-rules.js'));
const CANARY = 'PLOGCANARY';
let failures = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!c) failures++; };

const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); if (a < 0 || b < 0) { console.log(`FAIL marker gone: ${from}`); process.exit(1); } return src.slice(a, b); };
const personalSrc = cut('const personal = (actorId, text) =>', '\n');
const registrySrc = cut('const commands = new Map();', '// /help groups');
const chatSrc = cut('const handleChat = (userId, text) => {', '\n// ---- Realm of Lorkhan hold gates');

// The world: Rowan #PGDB (user 3), Selene #K2QX (user 4), Dar #U6T6 (user 6, staff), Mike Morethi #5D8L offline, and two
// characters sharing the tag ZZ9Q
const M = F.makeMp(), FS = F.makeFs(), TM = F.makeTimers(), QU = F.makeQueue(), CL = F.makeClock();
QU.install();
const A = 0xff000014, B = 0xff000015, D = 0xff000017, MIKE = 0xff000016, T1 = 0xff000018, T2 = 0xff000019;
M.player(A, { user: 3 }); M.player(B, { profile: 2, name: 'Selene', tag: 'K2QX', user: 4 }); M.player(D, { profile: 4, name: 'Dar', tag: 'U6T6', user: 6 });
M.player(MIKE, { profile: 3, name: 'Mike Morethi', tag: '5D8L' });
M.player(T1, { profile: 5, name: 'Aela', tag: 'ZZ9Q', user: 7 }); M.player(T2, { profile: 6, name: 'Brynjolf', tag: 'ZZ9Q', user: 8 });
const ONLINE = [A, B, D, T1, T2];
const said = [];
const env = {
  globalThis, noteTold: () => {}, deliver: (a, line) => said.push([a, line]), isAdmin: (a) => a === D, actorOf: (u) => M.mp.getUserActor(u), nameOf: (a) => (M.mp.get(a, 'appearance') || {}).name,
  FLOOD: { stripColourCodes: true, chatMaxChars: 2000 }, R: { say: 20, low: 8, whisper: 3, wide: 35, shout: 80, emote: 20, emoteLow: 8, emoteLong: 35, looc: 20, loocLow: 8, loocLong: 35 },
  C: { WHITE: 'f', SHOUT: 's', ME: 'm', OOC: 'o', SYS: 'y' }, sendNear: () => {}, quoteSay: () => '', bubbleNear: () => {}, findByName: () => 0, broadcast: () => {}, audit: () => {},
  who: () => '', staffLog: () => {}, display: () => '', tierOf: () => 'gm', staffCan: (a) => a === D, TIER_LABEL: {}, staffWho: () => '', hasPlayerMenu: () => false,
  openPlayerMenu: () => {}, TRIAL_COMMANDS: {}, LEAD_ONLY: new Set(['wipechars']), isLeadStaff: () => env.lead === true, staffTierOf: () => 'gm', log: () => {},
};
const names = Object.keys(env);
const G = new Function(...names, `${personalSrc}\n${registrySrc}\n${chatSrc}\nreturn { personal, commands, registerChatCommand, aliasChatCommand, handleChat };`)(...names.map((k) => env[k]));
const { personal, commands, registerChatCommand, aliasChatCommand, handleChat } = G;
// the commands, as fakes that do what the real ones do to their target
const ran = [];
registerChatCommand('kick', (a, args) => { ran.push(['kick', args]); const t = M.mp.findFormsByPropertyValue('private.indexed.nameKey', args.trim().toLowerCase())[0]; if (!t) return personal(a, 'No such player.'); M.users.forEach((v, k) => { if (v === t) M.users.delete(k); }); M.props.delete(t); }, { admin: true });
registerChatCommand('rename', (a, args) => { ran.push(['rename', args]); M.mp.set(B, 'appearance', { name: 'Selena' }); M.mp.set(B, 'private.indexed.nameKey', 'selena'); }, { admin: true });
registerChatCommand('wipechars', (a, args) => { ran.push(['wipechars', args]); M.props.delete(MIKE); }, { admin: true });
registerChatCommand('party', (a, args) => { ran.push(['party', args]); if (/nobody/.test(args)) return personal(a, 'No player by that name is near.'); });
registerChatCommand('faction', (a, args) => { ran.push(['faction', args]); });
registerChatCommand('pigeonblock', (a, args) => { ran.push(['pigeonblock', args]); });
registerChatCommand('ledger', (a, args) => { ran.push(['ledger', args]); });
registerChatCommand('bank', (a, args) => { ran.push(['bank', args]); return undefined; });
registerChatCommand('ticket', (a, args) => { ran.push(['ticket', args]); return Promise.resolve(1); });
registerChatCommand('broken', (a) => { ran.push(['broken']); throw new Error('handler failure'); });
registerChatCommand('players', (a) => { ran.push(['players']); personal(a, 'Rowan, Selene'); });
registerChatCommand('sign', (a, args) => { ran.push(['sign', args]); personal(a, 'Your next letter is signed.'); });
registerChatCommand('help', (a) => { ran.push(['help']); personal(a, 'Topics...'); });
registerChatCommand('unstuck', (a) => { ran.push(['unstuck']); return 'went'; });
registerChatCommand('newone', (a) => { ran.push(['newone']); });
registerChatCommand('realnames', (a, args) => { ran.push(['realnames', args]); personal(a, 'Real names on: every player shows by their own name to you.'); }, { admin: true });
aliasChatCommand('oldkick', 'kick');

const api = { mp: M.mp, log: () => {}, cfg: { playerLog: { dir: '/fake/events', stopFile: '/fake/STOP' } }, every: TM.every, stopTimer: TM.stopTimer, onlineActors: () => ONLINE,
  actorOf: (u) => M.mp.getUserActor(u), fs: FS.fs, clock: CL, discordOf: (a) => String(M.mp.get(a, 'private.skympDiscordId') || ''), recordOf: () => null, adminItemName: () => '',
  commandsHas: (n) => commands.has(n), WORLD_GROUPS: [['players', 'Who is about']], lastPacketAt: new Map(), isAdmin: (a) => a === D };
delete require.cache[MODULE];
const K = require(MODULE)(api);
QU.run();
const q = () => K.S.q;
const lastOf = (type) => { const l = q().filter((r) => r.ev === type); return l[l.length - 1]; };
const runs = (type) => q().filter((r) => r.ev === type).length;
const chat = (u, text) => { const n0 = q().length; handleChat(u, text); return q().slice(n0); };

// ---- runs, subs, targets before the run, nums ----------------------------------------------------------------------------
let out = chat(6, '/kick selene');
ok(out.length === 1 && out[0].ev === 'cmd.run' && out[0].f.name === 'kick' && out[0].f.route === 'chat' && out[0].f.outcome === 'ok', '/kick: one cmd.run, route chat, outcome ok', out);
ok(out[0].o && out[0].o[0].c === 'K2QX' && out[0].o[0].r === 'target', '...the target resolved before the run, though /kick removed it', out[0].o);
ok(!M.props.has(B), '...(the fake kick did remove the form)');
M.player(B, { profile: 2, name: 'Selene', tag: 'K2QX', user: 4 });
out = chat(6, '/rename Selene Selena');
ok(out[0].o && out[0].o[0].n === 'Selene', '/rename: the target as it was before the rename', out[0].o);
M.player(B, { profile: 2, name: 'Selene', tag: 'K2QX', user: 4 });
env.lead = true;
out = chat(6, '/wipechars 3');
env.lead = false;
ok(out[0].o && out[0].o[0].p === 3 && out[0].o[0].c === '5D8L', '/wipechars by profile: the destroyed character recorded from before', out[0].o);
out = chat(6, '/kick Aela #ZZ9Q');
ok(out[0].o && out[0].o[0].c === 'ZZ9Q' && out[0].o[0].n === 'Aela', 'a target as "Name #TAG" with two forms on the tag: the name narrows it', out[0].o);
M.player(T1, { profile: 5, name: 'Aela', tag: 'ZZ9Q', user: 7 });
out = chat(6, `/kick ${CANARY}`);
ok(out[0].o === undefined && !JSON.stringify(out).includes(CANARY), 'a miss: no target, and the query text is never kept', out);
out = chat(3, `/party invite Selene ${CANARY}`);
ok(out[0].f.sub === 'invite' && out[0].o && out[0].o[0].c === 'K2QX' && out[0].f.mirror === true, '/party invite: sub from the list, the target mirrored (an acting command)', out[0]);
out = chat(3, `/party ${CANARY} Selene`);
ok(out[0].f.sub === undefined && !JSON.stringify(out).includes(CANARY), 'a first word off the sub list is not kept', out[0].f);
out = chat(6, `/realnames on ${CANARY}`);
ok(out.length === 1 && out[0].ev === 'cmd.run' && out[0].f.name === 'realnames' && out[0].f.sub === 'on' && out[0].f.outcome === 'ok' && out[0].o === undefined && !JSON.stringify(out).includes(CANARY),
  '/realnames on (the staff real-names mode, Jake 14 Oct): one cmd.run, sub on, no target and no text', out);
out = chat(6, '/realnames');
ok(out.length === 1 && out[0].f.name === 'realnames' && out[0].f.sub === undefined, '...a bare /realnames (the toggle): by its name alone', out[0] && out[0].f);
out = chat(3, '/pigeonblock Selene');
ok(out[0].f.mirror === undefined, '/pigeonblock: never mirrored to the target', out[0].f);
out = chat(3, '/ledger place My Ledger PLOGCANARY');
ok(out[0].f.sub === 'place' && out[0].f.mirror === undefined && !JSON.stringify(out).includes(CANARY), '/ledger: the sub only, never the ledger\'s name, never mirrored', out[0].f);
out = chat(3, `/bank deposit 250 ${CANARY}`);
ok(out[0].f.sub === 'deposit' && out[0].f.nums && out[0].f.nums[0] === 250 && out[0].f.nums.length === 1, '/bank deposit 250: the number at its position', out[0].f);
out = chat(3, '/bank deposit 9e99');
ok(out[0].f.nums === undefined, '...and only a number of the allowed shape');
// ---- outcomes ----------------------------------------------------------------------------------------------------------------
out = chat(3, '/party invite nobody');
ok(out[0].f.outcome === 'refused', 'a refusal told to the player: outcome refused (the text is not kept)', out[0].f);
ok(!JSON.stringify(q()).includes('No player by that name'), '...the told text never stored');
out = chat(3, '/ticket bug');
ok(out[0].f.outcome === 'async', 'a handler that returns a promise: outcome async');
said.length = 0;
const before = ran.length;
out = chat(3, '/broken');
ok(out[0].f.outcome === 'error' && ran.length === before + 1, 'a handler that throws: outcome error, run once', out[0].f);
ok(said.some(([a, line]) => /That command failed/.test(line)), '...and the error still reaches handleChat (the player is told)');
// fn exactly once even when the player log's own code throws
const realBegin = K.S.cmdStack;
K.S.cmdStack = null;   // breaks the wrapper's begin and end
const n1 = ran.length;
let res;
try { res = commands.get('unstuck').fn(A, ''); } catch (e) { res = e; }
K.S.cmdStack = realBegin;
ok(ran.length === n1 + 1 && res === 'went', 'the player log broken inside: the handler runs exactly once and its result comes back', [ran.length - n1, res]);
// ---- routes ------------------------------------------------------------------------------------------------------------------
globalThis.__dboPlogRoute = 'upanel';
try { out = chat(3, '/bank'); } finally { globalThis.__dboPlogRoute = null; }
ok(out[0].f.route === 'upanel', 'the U panel (G10 sets the route around handleChat)', out[0].f);
ok(/__dboPlogRoute = 'upanel';\s*\n\s*try \{ handleChat\(userOf\(a\)/.test(src), '...and gamemode.js menuRun does set it');
let n0 = q().length;
globalThis.__dboRunCommand(A, 'bank', 'deposit 5', false);
ok(q()[n0].f.route === 'journal' && q()[n0].f.sub === 'deposit', 'the journal\'s buttons (__dboRunCommand): route journal');
n0 = q().length;
globalThis.__dboRunCommand(A, 'players', '', true);
ok(q().length === n0, 'a quiet World-tab redraw (WORLD_GROUPS) records nothing');
globalThis.__dboRunCommand(A, 'sign', '', true);
ok(q()[n0] && q()[n0].f.route === 'quiet' && q()[n0].f.name === 'sign', '/sign run quietly is recorded, route quiet');
n0 = q().length;
commands.get('bank').fn(A, 'withdraw 5');
ok(q()[n0].f.route === 'xmenu', 'the X menu (no userId): route xmenu');
// ---- aliases: the inner run records it ----------------------------------------------------------------------------------
n0 = q().length;
chat(6, '/oldkick Selene');
M.player(B, { profile: 2, name: 'Selene', tag: 'K2QX', user: 4 });
const aliasRuns = q().slice(n0).filter((r) => r.ev === 'cmd.run');
ok(aliasRuns.length === 1 && aliasRuns[0].f.name === 'kick' && aliasRuns[0].f.via === 'alias', 'an alias: one run, the target command\'s, via alias', aliasRuns.map((r) => r.f));
// ---- chat never ------------------------------------------------------------------------------------------------------------
n0 = q().length;
for (const v of ['say', 'me', 'ooc', 'looc', 'pm Selene', 'whisper', 'shout', 'admin', 'system', 'my', 'do', 'low', 'wide']) chat(v === 'admin' || v === 'system' ? 6 : 3, `/${v} ${CANARY} hello there`);
chat(3, `${CANARY} plain chat`);
ok(q().length === n0, 'say, me, ooc, pm, whisper, shout, admin, system...: no event at all', q().slice(n0).map((r) => r.ev));
chat(3, `/say ${'x'.repeat(2100)}`);
ok(q().length === n0, 'a too-long chat line: nothing');
// ---- the gate refusals --------------------------------------------------------------------------------------------------------
out = chat(3, `/${CANARY.toLowerCase()} something`);
ok(out.length === 1 && out[0].ev === 'cmd.refused' && out[0].f.reason === 'unknown' && out[0].f.name === undefined, 'an unknown command: cmd.refused{unknown}, its name never kept', out);
out = chat(3, '/kick Selene');
ok(out.length === 1 && out[0].ev === 'cmd.refused' && out[0].f.reason === 'not_staff' && out[0].f.name === 'kick', 'a staff command by a player: not_staff, with the registered name', out);
out = chat(6, '/wipechars 3');
ok(out.length === 1 && out[0].f.reason === 'lead_only', 'a Lead GM command by a GM: lead_only', out);
out = chat(3, `/bank ${'y'.repeat(2100)}`);
ok(out.length === 1 && out[0].f.reason === 'too_long' && out[0].f.name === 'bank', 'a too-long command: too_long with the registered name', out);
// ---- nothing typed anywhere -------------------------------------------------------------------------------------------------
ok(!JSON.stringify(q()).includes(CANARY) && !JSON.stringify(q()).includes('hello there'), 'no argument text, no chat, anywhere in the queue');
// ---- the schema covers the registered commands (a warning only: the safe default is the name alone) --------------------------
const registered = new Set();
for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith('.js'))) for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/registerChatCommand\('([a-z0-9]+)'/g)) registered.add(m[1]);
const noSchema = [...registered].filter((n) => !Object.prototype.hasOwnProperty.call(R.COMMAND_SCHEMA, n)).sort();
console.log(`     warning: ${noSchema.length} registered command(s) with no COMMAND_SCHEMA entry (recorded by name only): ${noSchema.join(' ')}`);
ok(Object.keys(R.COMMAND_SCHEMA).every((n) => !R.CHAT_VERBS.has(n)), 'no chat verb has a schema entry');
// ---- a refused /kick takes back its leave mark (review of 22 Oct): else the target's logout within 60 s read as this kick -----
{
  registerChatCommand('kick', (a, args) => { ran.push(['kick', args]); return personal(a, 'Selene #K2QX is on a staff account of your rank or higher, so you cannot kick them. Take it to someone above that rank, or to the Owners.'); }, { admin: true });
  K.S.pendingLeave.delete(B);
  out = chat(6, '/kick Selene');
  ok(out.length === 1 && out[0].f.outcome === 'refused' && !K.S.pendingLeave.has(B), 'a /kick refused by the rank rule: outcome refused, and the target carries no leave mark', { out: out.map((r) => r.f), mark: K.S.pendingLeave.get(B) });
  registerChatCommand('kick', (a, args) => { K.S.pendingLeave.set(B, { reason: 'suspended', t: CL.t, by: 0 }); return personal(a, 'You cannot kick them.'); }, { admin: true });
  chat(6, '/kick Selene');
  ok((K.S.pendingLeave.get(B) || {}).reason === 'suspended', '...a leave mark something else set meanwhile (a suspension) is left alone', K.S.pendingLeave.get(B));
  // a mark that was there before the refused /kick (a demotion's, a suspension's) comes back (review of 22 Oct, I1)
  registerChatCommand('kick', (a) => personal(a, 'You cannot kick them.'), { admin: true });
  const prior = { reason: 'demotion', t: CL.t, by: 0 };
  K.S.pendingLeave.set(B, prior);
  chat(6, '/kick Selene');
  ok(K.S.pendingLeave.get(B) === prior, '...a mark that was there before a refused /kick comes back unchanged', K.S.pendingLeave.get(B));
  K.S.pendingLeave.delete(B);
  registerChatCommand('kick', (a, args) => { ran.push(['kick', args]); }, { admin: true });
  out = chat(6, '/kick Selene');
  const m = K.S.pendingLeave.get(B) || {};
  ok(out.length === 1 && out[0].f.outcome === 'ok' && m.reason === 'command' && m.by === D, '...a /kick that went through keeps it, as before', { out: out.map((r) => r.f), m });
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
