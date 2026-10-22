// The remote console's punishment hardening (21 Oct 2026, before the dashboard's Send is turned on; dashboard security review
// wf_7461a8d3 and the punish-actions review): H1 a rank check for /discipline and /kick from the console, against the target
// ACCOUNT's highest tier over all its characters (and its fresh Discord roles when the backend sends them); H2 the page's
// account check (targetProfileId) and the request shape that carries it; H3 a #TAG two live characters carry is refused,
// even with one of them online; H4 the reason rule, pinned (the backend's consoleHardening test holds the same table); H5 at
// most 3 console suspensions of one account an hour; H6 a Lead GM runs only /discipline and /kick from the console (Jake,
// 22 Oct: "Punishments only"), Developers and Owners every command. Signed requests run through the reader, the real gate
// (gamemode.js handleLine, cut as written) and the real discipline.js. On the review head (punish-actions-1021-review
// aeb501748) the H1, H2, H3 and H5 checks fail; H4 and the "unchanged" checks pass there too. On 45e90896c the H6 checks fail.
//   node tests/console-hardening-harness.js    (as root: the spool checks want root-owned files; keep TMPDIR off the HDD)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const CONSOLE_JS = path.join(ROOT, 'console.js');
const DISCIPLINE_JS = path.join(ROOT, 'discipline.js');
let failures = 0, checks = 0;
const check = (name, ok, got) => { checks++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!ok) failures++; };
const cut = (from, to, label) => {
  const a = src.indexOf(from); const b = a < 0 ? -1 : src.indexOf(to, a + from.length);
  if (a < 0 || b < 0) { console.log(`FAIL the ${label} markers are gone`); process.exit(1); }
  return src.slice(a, b);
};
const lineOf = (re, label) => { const m = src.match(re); if (!m) { console.log(`FAIL ${label} not found in gamemode.js`); process.exit(1); } return m[0]; };
const ch = (n) => String.fromCodePoint(n);
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
if (!isRoot) { console.log('FAIL run as root: the spool and key checks require root-owned files'); process.exit(1); }

const { rules } = require(CONSOLE_JS);
const REPO_CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'console-hardening-'));
const SPOOL = path.join(SCRATCH, 'spool');
const KEY_FILE = path.join(SCRATCH, 'console.key');
const SWITCH_FILE = path.join(SCRATCH, 'console');
const RECORDS = path.join(SCRATCH, 'discipline.json');
const IN = path.join(SPOOL, 'in'), WORK = path.join(SPOOL, 'work'), OUT = path.join(SPOOL, 'out');
for (const d of [SPOOL, IN, WORK, OUT]) { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.chmodSync(d, 0o700); }
const KEY_HEX = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(KEY_FILE, `${KEY_HEX}\n`, { mode: 0o600 });
const setSwitch = (text) => fs.writeFileSync(SWITCH_FILE, text);
setSwitch('on\n');

const ROLE = { owner: '1494126527489507369', dev: '1494491999305338981', lead: '1494126618065506425', gm: '1553844072878178384', trial: '1558248795932860507' };
const ID = { jake: '200000000000000001', nate: '200000000000000002', gm: '200000000000000003', bob: '200000000000000005', lydia: '200000000000000006', lead: '200000000000000008' };
const store = new Map(); const chatWrites = []; const kicked = []; const logs = []; const staffLines = []; const packets = [];
let nextUser = 10;
const actor = (id, o) => { store.set(id >>> 0, Object.assign({ __user: -1, profileId: 0, appearance: { name: o.name }, 'private.charTag': o.tag, 'private.skympDiscordId': o.discord || '', 'private.discordRoles': o.roles || [] }, { __user: o.online ? nextUser++ : -1, profileId: o.profile })); return id >>> 0; };
const A = {
  jakeAlt: actor(0xff000a01, { name: 'Jake Alt', tag: 'JALT', profile: 1, discord: ID.jake, roles: [] }),
  jake: actor(0xff000a02, { name: 'Jake', tag: 'ABCD', profile: 1, discord: ID.jake, roles: [ROLE.owner], online: true }),
  nate: actor(0xff000a10, { name: 'Nate', tag: 'NNAT', profile: 2, discord: ID.nate, roles: [ROLE.dev] }),
  gm: actor(0xff000a20, { name: 'Gemma', tag: 'GMGM', profile: 3, discord: ID.gm, roles: [ROLE.gm] }),
  lead: actor(0xff000a40, { name: 'Leda', tag: 'LEAD', profile: 9, discord: ID.lead, roles: [ROLE.lead] }),
  bob: actor(0xff000b01, { name: 'Bob', tag: '8KWH', profile: 5, discord: ID.bob, online: true }),
  bobAlt: actor(0xff000b02, { name: 'Bobette', tag: 'BOB2', profile: 5, discord: ID.bob }),
  lydia: actor(0xff000c01, { name: 'Lydia', tag: 'LLX8', profile: 6, discord: ID.lydia, online: true }),
  // H1: a second Lead GM account and a second Owner account, both offline
  lars: actor(0xff000a50, { name: 'Lars', tag: 'LARS', profile: 11, discord: '200000000000000011', roles: [ROLE.lead] }),
  olaf: actor(0xff000a60, { name: 'Olaf', tag: 'OLAF', profile: 12, discord: '200000000000000012', roles: [ROLE.owner] }),
};
const online = () => [...store].filter(([, o]) => o.__user >= 0).map(([id]) => id);
const setOnline = (id, on) => { store.get(id).__user = on ? nextUser++ : -1; };
const mp = {
  get: (id, k) => { const o = store.get(id >>> 0); if (!o) throw new Error(`no actor ${id}`); return o[k]; },
  set: (id, k, v) => { const o = store.get(id >>> 0); if (!o) throw new Error(`no actor ${id}`); o[k] = v; if (k === 'ff_chatMsg') chatWrites.push([id >>> 0, v]); },
  getUserByActor: (id) => { const o = store.get(id >>> 0); return o && o.__user >= 0 ? o.__user : 65535; },
  getUserActor: (u) => { for (const [id, o] of store) if (o.__user === u) return id; return 0; },
  getActorsByProfileId: (pid) => [...store].filter(([, o]) => o.profileId === pid).map(([id]) => id),
  // The engine's tag index, as indexName writes it: the lower-case tag of every character, offline ones included
  findFormsByPropertyValue: (k, v) => (k === 'private.indexed.tagKey' ? [...store].filter(([, o]) => String(o['private.charTag'] || '').toLowerCase() === v).map(([id]) => id) : []),
  kick: (u) => kicked.push(u),
  getServerSettings: () => ({}),
};
const log = (...a) => logs.push(a.join(' '));

// gamemode.js, cut as written: the gate, the capture, names and tiers, the audit, /kick, and findAnyByName (discipline.js's lookup)
const body = [
  lineOf(/^const C = \{.*\};$/m, 'C'),
  lineOf(/^const idList = .*$/m, 'idList'),
  cut('// ---- remote staff console capture', '// What a player is refused goes into the log too', 'capture and deliver'),
  lineOf(/^const personal = \(actorId, text\) => .*$/m, 'personal'),
  cut('const actorOf = ', '// Names for lists and answers', 'identity helpers'),
  cut('const ROSTER_MASKS', 'const tierFrom = ', 'names and who'),
  cut('const tierFrom = ', 'const onlineActors = () =>', 'tiers and LEAD_ONLY'),
  'const onlineActors = () => world.online();',
  cut("// Inside the remote console's capture (captureFor) a broadcast", '// ---- Discord audit log', 'broadcast and findByName'),
  cut('const auditQueue = []', '// ---- staff commands', 'audit'),
  'const commands = new Map();',
  lineOf(/^const plogCommand = .*$/m, 'plogCommand'),
  lineOf(/^const registerChatCommand = .*$/m, 'registerChatCommand'),
  lineOf(/^const staffSay = .*$/m, 'staffSay'),
  cut('const quoteSay = ', '// ---- Realm of Lorkhan hold gates', 'handleChat and handleLine'),
  cut("registerChatCommand('players'", '// The staff teleport:', '/players to /rename'),
  cut('// Online first, then any character (offline included) by tag or exact name.', '// ---- letters:', 'findAnyByName'),
  `return { deliver, system, personal, captureFor, userOf, nameOf, profileOf, discordOf, tagOf, display, who, isAdmin, isLeadStaff, staffTierFrom, staffTierOf,
    TIER_RANK, TIER_LABEL, broadcast, findByName, findAnyByName, audit, commands, registerChatCommand, handleLine, accountRankOf, rankRefusalOf };`,
].join('\n');
const world = { online };
const G = new Function('mp', 'log', 'cfg', 'fs', 'path', 'world', 'CHAT_PROP', 'US', 'noteTold', 'ADMIN_PROFILES', 'TIERS', 'tierRoles', 'legacyAdminRoles',
  'trialRoles', 'FLOOD', 'R', 'sendNear', 'bubbleNear', 'hasPlayerMenu', 'openPlayerMenu', 'staffLog', 'indexName', 'discordTarget', 'postJson', 'setTimeout', body)(
  mp, log, {}, fs, path, world, 'ff_chatMsg', String.fromCharCode(31), () => {}, new Set(), ['senior', 'developer', 'leadgm', 'gm'],
  { senior: [ROLE.owner], developer: [ROLE.dev], leadgm: [ROLE.lead], gm: [ROLE.gm] }, [], [ROLE.trial],
  { chatMaxChars: 2000, stripColourCodes: true }, { say: 20, low: 8, whisper: 3, wide: 35, shout: 80, emote: 20, emoteLow: 8, emoteLong: 35, looc: 20, loocLow: 8, loocLong: 35 },
  () => {}, () => {}, () => false, () => {}, (who, tier, what, detail) => staffLines.push({ who, tier, what, detail }), () => {}, null, async () => {}, () => 0);

// The real discipline.js on a scratch record file; its kick waits 1.5 s with setTimeout, run at once here
const realTimeout = global.setTimeout;
global.setTimeout = (fn) => { fn(); return 0; };
const loadDiscipline = () => {
  delete require.cache[DISCIPLINE_JS];
  require(DISCIPLINE_JS)({ mp, log, personal: G.personal, audit: G.audit, who: G.who, display: G.display, profileOf: G.profileOf, onlineActors: online,
    registerChatCommand: G.registerChatCommand, isAdmin: G.isAdmin, isLeadStaff: G.isLeadStaff, findAnyByName: G.findAnyByName, rankRefusal: G.rankRefusalOf,
    sendPacket: (a, p) => packets.push([a >>> 0, p]), userOf: G.userOf, every: () => {},
    cfg: { discipline: Object.assign({}, REPO_CFG.discipline, { file: RECORDS, discordFile: path.join(SCRATCH, 'none.json'), record: [] }) } });
};
loadDiscipline();
const recordOf = (p) => { try { return JSON.parse(fs.readFileSync(RECORDS, 'utf8')).profiles[p] || []; } catch (e) { return []; } };

let clock = Date.now();
const KEY = Buffer.from(KEY_HEX, 'hex');
const sign = (r) => crypto.createHmac('sha256', KEY).update(rules.reqPayload(r)).digest('hex');
let seq = 0;
const uuid = () => `7a2b3c4d-5e6f-4a01-9b2c-${String(++seq).padStart(12, '0')}`;
const req = (text, o = {}) => {
  const srcName = o.src || 'web';
  const r = { v: 1, id: srcName === 'web' ? `w-${uuid()}` : `d-${String(1400000000000000000n + BigInt(++seq))}`, src: srcName, discordId: o.discordId || ID.jake, user: o.user || 'jake',
    profileId: o.profileId ?? 1, roles: o.roles || [ROLE.owner], text, mode: o.mode || 'on', issuedAt: clock, expiresAt: clock + 10000 };
  // The hardening's optional fields, as the backend adds them for the dashboard
  if (o.targetProfileId !== undefined) r.targetProfileId = o.targetProfileId;
  if (o.targetRoles !== undefined) r.targetRoles = o.targetRoles;
  r.sig = sign(r);
  if (o.tamper) o.tamper(r);
  return r;
};
const readReply = (id) => { const f = path.join(OUT, `${id}.json`); if (!fs.existsSync(f)) return null; const rep = JSON.parse(fs.readFileSync(f, 'utf8')); fs.unlinkSync(f); return rep; };
let ticker = null;
const loadConsole = (cfg) => {
  delete require.cache[CONSOLE_JS];
  globalThis.__dboRunCommand = globalThis.__dboRunCommand || (() => null);
  try { fs.unlinkSync(path.join(SPOOL, 'allow.json')); } catch (e) { /* none yet */ }
  const mod = require(CONSOLE_JS)({ mp, log, audit: G.audit, every: (n, ms, fn) => { ticker = fn; }, stopTimer: () => {}, cfg, commands: G.commands, handleLine: G.handleLine,
    findByName: G.findByName, tagOf: G.tagOf, profileOf: G.profileOf, discordOf: G.discordOf, userOf: G.userOf, display: G.display, who: G.who, staffTierFrom: G.staffTierFrom,
    staffTierOf: G.staffTierOf, TIER_LABEL: G.TIER_LABEL, TIER_RANK: G.TIER_RANK, captureFor: G.captureFor, onlineActors: online, gen: globalThis.__dboRunCommand,
    accountRank: G.accountRankOf,
    paths: { spool: SPOOL, key: KEY_FILE, switch: SWITCH_FILE }, now: () => clock });
  ticker();
  return mod;
};
const allowNow = () => { try { return JSON.parse(fs.readFileSync(path.join(SPOOL, 'allow.json'), 'utf8')); } catch (e) { return null; } };
const PIN = [ID.jake, ID.nate, ID.gm, ID.lead];
const CFG = (extra = {}) => Object.assign({}, REPO_CFG, { remoteConsole: Object.assign({}, REPO_CFG.remoteConsole, { discordIds: PIN }, extra) });
loadConsole(CFG());
const reset = () => { kicked.length = 0; staffLines.length = 0; chatWrites.length = 0; logs.length = 0; packets.length = 0; globalThis.__dboConsoleState.all = []; globalThis.__dboConsoleState.perProfile.clear(); };
// The text as the backend sends it (cleanCommand: '#{' broken, one line), unless o.raw
const send = (text, o = {}) => { globalThis.__dboConsoleState.all = []; globalThis.__dboConsoleState.perProfile.clear(); const r = req(o.raw ? text : rules.cleanCommand(text), o); fs.writeFileSync(path.join(IN, `${r.id}.json`), JSON.stringify(r), { mode: 0o600 }); ticker(); return readReply(r.id); };
const header = (rep) => ((rep && (rep.lines.find((l) => l.to === 'console') || rep.lines.find((l) => l.to === 'you') || rep.lines.find((l) => l.to === 'all'))) || {}).text || 'no reply';
const said = (id) => chatWrites.filter(([a]) => a === id).map(([, l]) => String(l).split(String.fromCharCode(31)).pop());
const audits = () => logs.filter((l) => l.startsWith('audit: ')).map((l) => l.slice(7));
const AS_LEAD = { discordId: ID.lead, profileId: 9, roles: [ROLE.lead], user: 'icedsky' };

const AS_NATE = { discordId: ID.nate, profileId: 2, roles: [ROLE.dev], user: 'nate.pierce' };
const ran = (rep, re) => !!rep && rep.state === 'ran' && (!re || re.test(header(rep)));
const refused = (rep, why) => !!rep && rep.state === 'refused' && rep.why === why;
const brief = (rep) => rep && { state: rep.state, why: rep.why, said: header(rep) };

// ---- H0. allow.json says which commands the reader checks the page's account for, and which carry the rank check ------------
{
  const allow = allowNow() || [];
  const flag = (k) => allow.filter((x) => x[k] === true).map((x) => x.name).sort().join();
  // (this harness registers chargen, discipline, kick and rename of those; /chars and /fixloc are not cut in, so not listed)
  const tagRules = Object.entries(rules.ALLOW).filter(([, a]) => ['tag', 'tagName', 'tagKindReason'].includes(a.rule)).map(([k]) => k).sort().join();
  check('H0. targetProfile: every listed command that names one #TAG, so the backend may send the account (chargen, chars, discipline, fixloc, kick, rename in code)',
    tagRules === 'chargen,chars,discipline,fixloc,kick,rename' && flag('targetProfile') === 'chargen,discipline,kick,rename', [tagRules, flag('targetProfile')]);
  check('H0. rank: /discipline and /kick only, so the backend fetches the target account\'s Discord roles for those', flag('rank') === 'discipline,kick', flag('rank'));
  check('H0. the switch commands, /players, /load and /whoami carry neither', allow.filter((x) => ['wwremote', 'vlremote', 'players', 'load', 'whoami'].includes(x.name)).every((x) => x.targetProfile === undefined && x.rank === undefined), allow);
}

// ---- H1. rank: the console refuses /discipline and /kick on an account at or above the caller's tier ----------------------
reset();
{
  const n = (p) => recordOf(p).length;
  const before = { 1: n(1), 2: n(2), 11: n(11), 12: n(12) };
  let rep = send('/discipline #NNAT warn A Lead GM warns a Developer', AS_LEAD);
  check('H1. a Lead GM cannot warn a Developer from the console (rank), nothing recorded, no staff line', refused(rep, 'rank') && n(2) === before[2] && !staffLines.length
    && header(rep) === '#NNAT is on a staff account of your rank or higher, so the console will not act on it. Take it to someone above that rank, or to the Owners.', brief(rep));
  rep = send('/discipline #NNAT suspend 30d A Lead GM suspends a Developer', Object.assign({ src: 'discord' }, AS_LEAD));
  check('H1. ...nor suspend one from Discord /console (review finding 2)', refused(rep, 'rank') && n(2) === before[2], brief(rep));
  rep = send('/discipline #JALT strike Strike on the Owner through his alt', AS_LEAD);
  check("H1. the account counts, not the character: Jake Alt has no staff roles stamped, but Jake's account is an Owner's (review finding 3)", refused(rep, 'rank') && n(1) === before[1], brief(rep));
  rep = send('/discipline #LARS warn One Lead GM warns another', AS_LEAD);
  check('H1. the same tier is refused too: a Lead GM on another Lead GM', refused(rep, 'rank') && n(11) === before[11], brief(rep));
  rep = send('/discipline #OLAF warn One Owner warns another');
  check('H1. ...and an Owner on another Owner', refused(rep, 'rank') && n(12) === before[12], brief(rep));
  reset();
  rep = send('/kick #ABCD', AS_LEAD);
  check('H1. a Lead GM cannot kick the Owner (online) from the console, nobody kicked', refused(rep, 'rank') && !kicked.length, brief(rep));
  rep = send('/discipline #NNAT lift A dry run is refused the same way', Object.assign({ mode: 'dry-run' }, AS_LEAD));
  check('H1. a dry run is refused by rank the same way (it is the console\'s own check)', refused(rep, 'rank'), brief(rep));
  rep = send('/discipline #JALT warn Testing my own account');
  check('H1. never the caller\'s own account, and it says so: Jake on Jake Alt (ownAccount), nothing recorded', refused(rep, 'ownAccount') && n(1) === before[1]
    && header(rep) === '#JALT is on your own account. The console does not act on your own account.', brief(rep));
  setOnline(A.lead, true);
  rep = send('/kick #LEAD', AS_LEAD);
  check('H1. ...a Lead GM kicking herself from the console too', refused(rep, 'ownAccount') && !kicked.length, brief(rep));
  setOnline(A.lead, false);
  reset();
  rep = send('/discipline #GMGM warn A Lead GM warns a GM', AS_LEAD);
  check('H1. below the caller it runs: a Lead GM warns a GM (discipline.js lets a Lead GM discipline staff)', ran(rep, /^Recorded: warn #\d+ on Gemma #GMGM\.( They are told at their next login\.)?$/), brief(rep));
  rep = send('/kick #8KWH', AS_LEAD);
  check('H1. ...and kicks a player', ran(rep) && kicked.includes(store.get(A.bob).__user), brief(rep));
  rep = send('/discipline #LEAD warn A Developer warns a Lead GM', AS_NATE);
  check('H1. a Developer warns a Lead GM', ran(rep, /^Recorded: warn #\d+ on Leda #LEAD\./), brief(rep));
  rep = send('/discipline #JALT warn A Developer on an Owner account', AS_NATE);
  check('H1. ...but not an Owner\'s account', refused(rep, 'rank'), brief(rep));
  rep = send('/discipline #NNAT warn An Owner warns a Developer');
  check('H1. an Owner warns a Developer', ran(rep, /^Recorded: warn #\d+ on Nate #NNAT\./), brief(rep));
  // The account's fresh Discord roles, when the backend sent them, count as well: Bob has no staff roles stamped
  rep = send('/discipline #8KWH warn Bob is a Lead GM in Discord now', Object.assign({ targetProfileId: 5, targetRoles: [ROLE.lead] }, AS_LEAD));
  check("H1. the target account's fresh roles from the backend raise it: Bob, now a Lead GM in Discord, is refused for a Lead GM", refused(rep, 'rank'), brief(rep));
  rep = send('/discipline #LARS warn Lars was demoted in Discord', Object.assign({ targetProfileId: 11, targetRoles: [] }, AS_LEAD));
  check('H1. ...and can never lower it: Lars, stamped Lead GM, with no fresh roles, is still refused (a stamp counts until it is gone)', refused(rep, 'rank'), brief(rep));
  rep = send('/discipline #8KWH warn Bob is a player in Discord too', Object.assign({ targetProfileId: 5, targetRoles: [] }, AS_LEAD));
  check('H1. Bob with no staff role anywhere: it runs', ran(rep, /^Recorded: warn #\d+ on Bob #8KWH\./), brief(rep));
  const real = mp.getActorsByProfileId;
  mp.getActorsByProfileId = (pid) => { if (pid === 6) throw new Error('store busy'); return real(pid); };
  rep = send('/discipline #LLX8 warn The account cannot be read', AS_LEAD);
  mp.getActorsByProfileId = real;
  check("H1. an account whose characters cannot be read is refused (rankUnknown), it fails closed", refused(rep, 'rankUnknown') && /could not read the staff rank/.test(header(rep)), brief(rep));
  mp.getActorsByProfileId = (pid) => (pid === 2 ? [] : real(pid));
  rep = send('/discipline #NNAT warn The profile index misses the target', AS_LEAD);
  mp.getActorsByProfileId = real;
  check("H1. the target character's own stamp counts even when the engine's profile index misses it: Nate (Developer) is refused for a Lead GM", refused(rep, 'rank'), brief(rep));
  // In game the typed command keeps the same rule since rank-typed-1022 (gamemode.js rankRefusalOf, the console's accountRank)
  setOnline(A.lead, true); reset();
  const n2 = n(2);
  G.handleLine(A.lead, '/discipline #NNAT warn typed in game by a Lead GM', G.userOf(A.lead));
  check('H1. in game too: a Lead GM typing /discipline on a Developer is refused by the same rank rule, and nothing is recorded',
    n(2) === n2 && said(A.lead).some((l) => /System\|Nate #NNAT is on a staff account of your rank or higher, so you cannot discipline it\./.test(l)), { records: recordOf(2).slice(-1), said: said(A.lead) });
  setOnline(A.lead, false);
}

// ---- H2. the page's account: targetProfileId, and the request shape that carries it ---------------------------------------
reset();
{
  const n5 = recordOf(5).length, n6 = recordOf(6).length;
  let rep = send('/discipline #8KWH warn Shown on the page as profile 5', { targetProfileId: 5 });
  check('H2. targetProfileId 5 and #8KWH (Bob, profile 5): it runs, on profile 5', ran(rep, /^Recorded: warn #\d+ on Bob #8KWH\./) && recordOf(5).length === n5 + 1, brief(rep));
  rep = send('/discipline #8KWH warn The page showed Lydia, profile 6', { targetProfileId: 6 });
  check('H2. targetProfileId 6 and #8KWH: refused (targetProfile), nothing on either account, no staff line', refused(rep, 'targetProfile') && recordOf(5).length === n5 + 1 && recordOf(6).length === n6
    && !staffLines.some((l) => /The page showed Lydia/.test(l.detail)) && header(rep) === '#8KWH is not a character of the account you opened, so nothing was done. Open the player again and pick the character from their list.', brief(rep));
  rep = send('/discipline #BOB2 strike Another character of the account', { targetProfileId: 5, targetRoles: [] });
  check("H2. any character of that account passes (Bobette #BOB2, offline), with targetRoles", ran(rep, /^Recorded: strike #\d+ on Bobette #BOB2\./), brief(rep));
  reset();
  rep = send('/kick #LLX8', { targetProfileId: 5 });
  check('H2. /kick #LLX8 with the page on profile 5: refused, nobody kicked', refused(rep, 'targetProfile') && !kicked.length, brief(rep));
  rep = send('/kick #LLX8', { targetProfileId: 6 });
  check('H2. ...with profile 6: Lydia is kicked', ran(rep) && kicked.includes(store.get(A.lydia).__user), brief(rep));
  rep = send('/players', { targetProfileId: 5 });
  check('H2. a command with no #TAG and a page account: refused (profileNoTag)', refused(rep, 'profileNoTag'), brief(rep));
  rep = send('/discipline #8KWH warn A dry run checks the account too', { targetProfileId: 6, mode: 'dry-run' });
  check('H2. a dry run checks the account too', refused(rep, 'targetProfile'), brief(rep));
  // The shape: either 12 keys as before, or with targetProfileId (and targetRoles only beside it), signed
  const bad = [
    ['targetRoles without targetProfileId', { targetRoles: [ROLE.lead] }], ['a negative targetProfileId', { targetProfileId: -1 }], ['a string targetProfileId', { targetProfileId: '5' }],
    ['a fractional targetProfileId', { targetProfileId: 5.5 }], ['targetRoles not ids', { targetProfileId: 5, targetRoles: ['lead'] }], ['targetRoles not a list', { targetProfileId: 5, targetRoles: ROLE.lead }],
    ['101 targetRoles', { targetProfileId: 5, targetRoles: Array(101).fill(ROLE.lead) }], ['an unknown extra key', { tamper: (r) => { r.targetName = 'Bob'; } }],
    ['targetProfileId changed after signing', { targetProfileId: 6, tamper: (r) => { r.targetProfileId = 5; } }],
    ['targetRoles dropped after signing', { targetProfileId: 5, targetRoles: [ROLE.lead], tamper: (r) => { delete r.targetRoles; } }],
    ['targetProfileId added after signing', { tamper: (r) => { r.targetProfileId = 5; } }],
  ];
  const wrong = bad.map(([label, o]) => [label, send('/discipline #8KWH warn A bad request shape here', o)]).filter(([, rep]) => !rep || rep.state !== 'bad');
  check('H2. each bad shape or tampered field is refused as bad (unverified), nothing recorded', !wrong.length && recordOf(5).length === n5 + 2, wrong.map(([l, rep]) => [l, brief(rep)]));
  rep = send('/discipline #8KWH warn The twelve key request still runs', { src: 'discord' });
  check('H2. a request without the new fields (Discord /console, an older backend) runs as before', ran(rep), brief(rep));
  // The signed text, pinned: the backend's consoleHardening test holds the same string
  const pinned = { v: 1, id: 'w-7a2b3c4d-5e6f-4a01-9b2c-000000000001', src: 'web', discordId: '200000000000000001', user: 'jake', profileId: 1, roles: ['1494126527489507369'],
    text: '/discipline #8KWH warn Spamming the chat', mode: 'on', issuedAt: 1000, expiresAt: 2000 };
  const base = 'dbo-console-req-v1\n[1,"w-7a2b3c4d-5e6f-4a01-9b2c-000000000001","web","200000000000000001","jake",1,["1494126527489507369"],"/discipline #8KWH warn Spamming the chat","on",1000,2000';
  check('H2. the signed payload: as before without the fields; with them, targetProfileId then targetRoles (or null) after expiresAt', rules.reqPayload(pinned) === `${base}]`
    && rules.reqPayload(Object.assign({ targetProfileId: 5 }, pinned)) === `${base},5,null]` && rules.reqPayload(Object.assign({ targetProfileId: 5, targetRoles: ['1494126618065506425'] }, pinned)) === `${base},5,["1494126618065506425"]]`,
  [rules.reqPayload(Object.assign({ targetProfileId: 5 }, pinned))]);
}

// ---- H3. a #TAG two live characters carry is refused, even with one of them online -----------------------------------------
reset();
{
  const lyra = actor(0xff000c02, { name: 'Lyra', tag: '8KWH', profile: 6, discord: ID.lydia });
  const n5 = recordOf(5).length, n6 = recordOf(6).length;
  let rep = send('/discipline #8KWH warn One online and one offline carry it');
  check('H3. Bob #8KWH online and Lyra #8KWH offline: /discipline is refused (tagShared), nothing on either account', refused(rep, 'tagShared') && recordOf(5).length === n5 && recordOf(6).length === n6
    && header(rep) === 'More than one character carries #8KWH, so the console will not guess which one you mean. Run it in game on the player you mean.', brief(rep));
  rep = send('/kick #8KWH');
  check('H3. ...and /kick too, nobody kicked', refused(rep, 'tagShared') && !kicked.length, brief(rep));
  rep = send('/discipline #8KWH warn With the page account of the online one', { targetProfileId: 5 });
  check('H3. ...even with the page account set to the online one', refused(rep, 'tagShared'), brief(rep));
  setOnline(lyra, true);
  rep = send('/kick #8KWH');
  check('H3. two online carry it: refused (tagShared)', refused(rep, 'tagShared') && !kicked.length, brief(rep));
  setOnline(lyra, false);
  globalThis.__dboFormGone = (id) => (id >>> 0) === lyra;
  rep = send('/discipline #8KWH warn The other one is deleted');
  check('H3. a deleted character carrying it does not count: it runs on Bob', ran(rep, /on Bob #8KWH\./), brief(rep));
  globalThis.__dboFormGone = undefined;
  store.delete(lyra);
  const real = mp.findFormsByPropertyValue;
  mp.findFormsByPropertyValue = () => { throw new Error('index busy'); };
  rep = send('/kick #8KWH');
  mp.findFormsByPropertyValue = real;
  check('H3. a tag index that cannot be read refuses (tagIndex), even for an online target: nobody kicked', refused(rep, 'tagIndex') && !kicked.length, brief(rep));
  rep = send('/discipline #8KWH warn Only Bob carries it again');
  check('H3. with one carrier again it runs', ran(rep, /on Bob #8KWH\./), brief(rep));
}

// ---- H4. the reason rule, pinned (consoleHardening.test.js in the backend holds the same table) -----------------------------
{
  // [reason, class]: '' runs; the class the console refuses with otherwise. Lengths in UTF-16 units after the folding
  const TABLE = [
    ['abcde', ''], ['abcd', 'reasonShort'], ['', 'reasonShort'], ['a'.repeat(300), ''], ['a'.repeat(301), 'reasonLong'],
    [`${ch(0xe9)}`.repeat(300), ''], [`e${ch(0x301)}`.repeat(150), ''], [`e${ch(0x301)}`.repeat(301), 'reasonLong'], [`${ch(0x1100)}${ch(0x1161)}`.repeat(5), ''],
    ['Plain . , ; : ! ? \' " ( ) - / & + %', ''], ['Женя Åsa über', ''], ['한글 Hangul letters', ''], ['١٢٣ Arabic-Indic digits', ''],
    [ch(0x3164).repeat(5), 'reasonChars'], [`ok ${ch(0x115f)} reason`, 'reasonChars'], [`ok ${ch(0x1160)} reason`, 'reasonChars'], [`ok ${ch(0xffa0)} reason`, 'reasonChars'],
    [`${ch(0x1d400)}bcdef`, 'reasonChars'], [`${ch(0x20000)} CJK B`, 'reasonChars'], [`smile ${ch(0x1f600)} x`, 'reasonChars'], [`x${ch(0x301)}${ch(0x301)} marks`, 'reasonChars'],
    ['#{ff0000}red', 'reasonChars'], ['a_b c d e', 'reasonChars'], ['<@1> ping', 'reasonChars'], ['pipe | here', 'reasonChars'], ['back \\ slash', 'reasonChars'],
    [`curly ${ch(0x2019)} quote`, 'reasonChars'], [`en ${ch(0x2013)} dash`, 'reasonChars'], [`nbsp${ch(0xa0)}folded here`, ''], [`zero${ch(0x200b)}width folded`, ''],
    [`${ch(0x2800)}${ch(0x2800)}${ch(0x2800)}${ch(0x2800)}${ch(0x2800)}`, 'reasonChars'], [`fullwidth ${ch(0xff21)}${ch(0xff22)}`, ''], ['ab\ncd ef', ''],
  ];
  const got = TABLE.map(([t, want]) => { const l = rules.checkLine(rules.cleanCommand(`/discipline #8KWH warn ${t}`) || '', (x) => x === 'discipline', new Set()); return [JSON.stringify(t).slice(0, 40), want, l.why || ''] ; }).filter(([, w, g]) => w !== g);
  check('H4. the reason table: the class, the Hangul fillers, astral characters, 5..300 UTF-16 units after NFC and the folding', !got.length, got);
}

// ---- H5. at most 3 console suspensions of one account an hour --------------------------------------------------------------
reset();
{
  const n5 = () => recordOf(5).filter((x) => x.kind === 'suspend').length;
  const s0 = n5();
  const three = [send('/discipline #8KWH suspend 1h first one this hour'), send('/discipline #BOB2 suspend 2h second one, other character', { src: 'discord' }), send('/discipline #8KWH suspend 3h third one this hour')];
  check('H5. three suspensions of Bob\'s account run, from the web and Discord, on either character', three.every((x) => ran(x, /^Recorded: suspend #\d+ on /)) && n5() === s0 + 3, three.map(brief));
  let rep = send('/discipline #8KWH suspend 4h fourth one this hour');
  check('H5. the fourth within the hour is refused (suspendCap), nothing recorded', refused(rep, 'suspendCap') && n5() === s0 + 3
    && header(rep) === "#8KWH's account has had 3 suspensions from the console in the last hour, the most the console takes. Wait, or do it in game.", brief(rep));
  rep = send('/discipline #8KWH suspend 4h fourth one, a dry run', { mode: 'dry-run' });
  check('H5. a dry run is checked against it too', refused(rep, 'suspendCap'), brief(rep));
  rep = send('/discipline #8KWH warn A warning is no suspension');
  check('H5. other kinds still run on the account', ran(rep), brief(rep));
  rep = send('/discipline #LLX8 suspend 1h another account is not capped');
  check('H5. another account is not capped', ran(rep, /^Recorded: suspend #\d+ on Lydia #LLX8/), brief(rep));
  loadConsole(CFG());
  rep = send('/discipline #8KWH suspend 4h after a hot reload');
  check('H5. the count survives a hot reload', refused(rep, 'suspendCap'), brief(rep));
  clock += 61 * 60 * 1000;
  rep = send('/discipline #8KWH suspend 1h an hour later');
  check('H5. an hour later it runs again', ran(rep, /^Recorded: suspend #\d+ on Bob #8KWH/), brief(rep));
  const dries = [1, 2, 3, 4].map((i) => send(`/discipline #LLX8 suspend 1h dry run number ${i}`, { mode: 'dry-run' }));
  const after = [send('/discipline #LLX8 suspend 1h real one after dry runs'), send('/discipline #LLX8 suspend 1h real two after dry runs')];
  check('H5. dry runs are not counted: four dry runs, then two real suspensions of Lydia still run', dries.every((x) => x && x.state === 'dry-run') && after.every((x) => ran(x)), [...dries, ...after].map(brief));
}

// ---- H6. a Lead GM runs only /discipline and /kick from the console; Developers and Owners every command -------------------
reset();
{
  const PUNISH_ONLY = 'A Lead GM can run only /discipline and /kick from the console. Run anything else in game.';
  const before = recordOf(5).length;
  store.get(A.bob)['private.wwBodyOff'] = { at: 1 };
  // Allowlisted ones (registered here or not), refused classes (/tp, /say) and an unknown word: punishOnly before the line's own rule
  const others = ['/players', '/whoami', '/ping', '/fixloc #8KWH', '/rename #8KWH Bobby Two', '/chars #8KWH', '/chargen #8KWH', '/wwremote clear #8KWH', '/vlremote on', '/load',
    '/tp #8KWH', '/say hello there', '/nosuchcommand', '/disciplinex #8KWH warn spelled wrong'];
  const got = others.flatMap((t) => ['web', 'discord'].map((src) => [t, src, send(t, Object.assign({ src }, AS_LEAD))]));
  const wrong = got.filter(([, , rep]) => !refused(rep, 'punishOnly') || header(rep) !== PUNISH_ONLY || rep.tier !== 'leadgm' || rep.ranAs !== 'Leda #LEAD');
  check('H6. a Lead GM is refused every other command from the web and Discord (punishOnly), with her own tier and character in the reply', !wrong.length, wrong.map(([t, src, rep]) => [t, src, brief(rep)]));
  check('H6. ...and none of them ran: no staff line, nobody kicked, the breaker stays, no record, no player told', !staffLines.length && !kicked.length && store.get(A.bob)['private.wwBodyOff'] !== null
    && recordOf(5).length === before && !packets.length && !said(A.bob).length, { staffLines, kicked });
  check('H6. ...each refusal has its REMOTE audit line naming punishOnly', got.every(([t]) => audits().some((l) => l.includes('refused (punishOnly): ') && l.endsWith(rules.cleanCommand(t)))), audits().slice(-3));
  let rep = send('/players', Object.assign({ mode: 'dry-run' }, AS_LEAD));
  check('H6. a dry run is refused the same way', refused(rep, 'punishOnly'), brief(rep));
  rep = send('/players', { discordId: ID.lead, profileId: 9, roles: [ROLE.dev], user: 'icedsky' });
  check('H6. a Lead GM promoted to Developer in Discord but stamped Lead GM: the lower tier counts, still punishOnly until a login', refused(rep, 'punishOnly'), brief(rep));
  reset();
  rep = send('/discipline #8KWH warn A Lead GM warns a player', Object.assign({ src: 'discord' }, AS_LEAD));
  check('H6. /discipline runs for her, from Discord as from the web (H1)', ran(rep, /^Recorded: warn #\d+ on Bob #8KWH\./) && recordOf(5).length === before + 1, brief(rep));
  rep = send('/discipline #8KWH strike A dry run of a strike', Object.assign({ mode: 'dry-run' }, AS_LEAD));
  check('H6. ...a dry run of /discipline passes the console', rep && rep.state === 'dry-run' && recordOf(5).length === before + 1, brief(rep));
  rep = send('/kick #8KWH', Object.assign({ src: 'discord' }, AS_LEAD));
  check('H6. ...and /kick runs for her', ran(rep) && kicked.includes(store.get(A.bob).__user), brief(rep));
  rep = send('/discipline #8KWH list', AS_LEAD);
  check("H6. /discipline's own rule still applies to her (the record view stays in game: badKind)", refused(rep, 'badKind'), brief(rep));
  rep = send('/kick', AS_LEAD);
  check("H6. ...and /kick's (needTag)", refused(rep, 'needTag'), brief(rep));
  reset();
  rep = send('/players', AS_NATE);
  check('H6. a Developer runs every command: /players for Nate', ran(rep), brief(rep));
  rep = send('/whoami', Object.assign({ src: 'discord' }, AS_NATE));
  check('H6. ...and /whoami from Discord', ran(rep), brief(rep));
  rep = send('/players');
  check('H6. an Owner runs every command: /players for Jake', ran(rep), brief(rep));
  rep = send('/players', { discordId: ID.gm, profileId: 3, roles: [ROLE.gm], user: 'gemma' });
  check('H6. a GM is still refused by the floor first (tier), not punishOnly', refused(rep, 'tier'), brief(rep));
  loadConsole(CFG({ deny: ['kick'] }));
  rep = send('/kick #8KWH', AS_LEAD);
  check("H6. the config's deny still narrows her two: /kick denied for a Lead GM", refused(rep, 'denied') && !kicked.length, brief(rep));
  loadConsole(CFG({ minTier: 'developer' }));
  rep = send('/discipline #8KWH warn The raised floor wins', AS_LEAD);
  check('H6. a raised floor (minTier developer) still refuses a Lead GM everything (tier)', refused(rep, 'tier'), brief(rep));
  loadConsole(CFG());
  check('H6. the rule is in code, for the backend\'s copy: PUNISH_ONLY discipline and kick, the full console from developer', JSON.stringify(rules.PUNISH_ONLY) === '["discipline","kick"]' && rules.FULL_TIER === 'developer'
    && Object.isFrozen(rules.PUNISH_ONLY), [rules.PUNISH_ONLY, rules.FULL_TIER]);
}

global.setTimeout = realTimeout;
fs.rmSync(SCRATCH, { recursive: true, force: true });
console.log('');
console.log(failures ? `${failures} FAILED of ${checks}` : `all ${checks} checks passed`);
process.exit(failures ? 1 : 0);
