// The rank rule for punishments typed in game (22 Oct 2026; the console review of 21 Oct, wf_dfff04c3 check X5): /discipline
// of every kind and /kick refuse one's own account, a staff account of one's rank or higher (the ACCOUNT's highest tier over
// all its characters, so an alt with no roles stamped counts as its owner), and an account whose rank cannot be read. The
// remote console keeps the same rule from the same code (gamemode.js accountRankOf). The real gate (gamemode.js handleLine,
// cut as written), /kick, discipline.js and console.js run against a fake world.
// K /kick typed, D /discipline typed, P the same decisions typed and from the console, A the record-author rule for lift and
// overturn (a lower rank does not undo a higher rank's record; a config record is the Owners'), R a Discord demotion reaches
// every character of the account once the role sync sees it (staffRolesSeen), S the code holds one rule.
//   node tests/staff-rank-harness.js    (as root: the console's spool and key checks want root-owned files)
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
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
if (!isRoot) { console.log('FAIL run as root: the spool and key checks require root-owned files'); process.exit(1); }

const { rules } = require(CONSOLE_JS);
const REPO_CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-rank-'));
const SPOOL = path.join(SCRATCH, 'spool');
const KEY_FILE = path.join(SCRATCH, 'console.key');
const SWITCH_FILE = path.join(SCRATCH, 'console');
const RECORDS = path.join(SCRATCH, 'discipline.json');
const IN = path.join(SPOOL, 'in'), WORK = path.join(SPOOL, 'work'), OUT = path.join(SPOOL, 'out');
for (const d of [SPOOL, IN, WORK, OUT]) { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.chmodSync(d, 0o700); }
const KEY_HEX = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(KEY_FILE, `${KEY_HEX}\n`, { mode: 0o600 });
fs.writeFileSync(SWITCH_FILE, 'on\n');

const ROLE = { owner: '1494126527489507369', dev: '1494491999305338981', lead: '1494126618065506425', gm: '1553844072878178384', trial: '1558248795932860507' };
const ID = { jake: '200000000000000001', nate: '200000000000000002', gm: '200000000000000003', lead: '200000000000000008' };
const ADMIN_PROFILE = 15;
const store = new Map(); const chatWrites = []; const kicked = []; const logs = []; const staffLines = []; const packets = [];
let nextUser = 10;
const actor = (id, o) => { store.set(id >>> 0, { __user: o.online ? nextUser++ : -1, profileId: o.profile, appearance: { name: o.name }, 'private.charTag': o.tag, 'private.skympDiscordId': o.discord || '', 'private.discordRoles': o.roles || [] }); return id >>> 0; };
const A = {
  // Owners: Jake (profile 1) with an alt that has no roles stamped; Olaf (12); and an account Owner by the code's admin profiles alone (15)
  jakeAlt: actor(0xff000a01, { name: 'Jake Alt', tag: 'JALT', profile: 1, discord: ID.jake, roles: [] }),
  jake: actor(0xff000a02, { name: 'Jake', tag: 'ABCD', profile: 1, discord: ID.jake, roles: [ROLE.owner], online: true }),
  olaf: actor(0xff000a60, { name: 'Olaf', tag: 'OLAF', profile: 12, discord: '200000000000000012', roles: [ROLE.owner] }),
  admn: actor(0xff000a70, { name: 'Ada', tag: 'ADMN', profile: ADMIN_PROFILE, discord: '200000000000000015', roles: [] }),
  // Developers: Nate (2); Dina (14), demoted on Discord: her online character has no roles, her old alt still has Developer stamped
  nate: actor(0xff000a10, { name: 'Nate', tag: 'NNAT', profile: 2, discord: ID.nate, roles: [ROLE.dev] }),
  dina: actor(0xff000a80, { name: 'Dina', tag: 'DINA', profile: 14, discord: '200000000000000014', roles: [] }),
  dinaOld: actor(0xff000a81, { name: 'Dina Old', tag: 'DOLD', profile: 14, discord: '200000000000000014', roles: [ROLE.dev] }),
  // Lead GMs: Leda (9), Lars (11). GMs: Gemma (3), Gary (4). A Trial GM: Tina (13)
  lead: actor(0xff000a40, { name: 'Leda', tag: 'LEAD', profile: 9, discord: ID.lead, roles: [ROLE.lead] }),
  lars: actor(0xff000a50, { name: 'Lars', tag: 'LARS', profile: 11, discord: '200000000000000011', roles: [ROLE.lead] }),
  gm: actor(0xff000a20, { name: 'Gemma', tag: 'GMGM', profile: 3, discord: ID.gm, roles: [ROLE.gm] }),
  gary: actor(0xff000a30, { name: 'Gary', tag: 'GARY', profile: 4, discord: '200000000000000004', roles: [ROLE.gm] }),
  tina: actor(0xff000a90, { name: 'Tina', tag: 'TRIA', profile: 13, discord: '200000000000000013', roles: [ROLE.trial] }),
  // Players: Bob (5) and his alt; Pia (16), suspended by a config record in A
  bob: actor(0xff000b01, { name: 'Bob', tag: '8KWH', profile: 5, discord: '200000000000000005', online: true }),
  bobAlt: actor(0xff000b02, { name: 'Bobette', tag: 'BOB2', profile: 5, discord: '200000000000000005' }),
  pia: actor(0xff000b10, { name: 'Pia', tag: 'PIAA', profile: 16, discord: '200000000000000016' }),
};
const online = () => [...store].filter(([, o]) => o.__user >= 0).map(([id]) => id);
const setOnline = (id, on) => { const o = store.get(id); if (on && o.__user >= 0) return; o.__user = on ? nextUser++ : -1; };
const mp = {
  get: (id, k) => { const o = store.get(id >>> 0); if (!o) throw new Error(`no actor ${id}`); return o[k]; },
  set: (id, k, v) => { const o = store.get(id >>> 0); if (!o) throw new Error(`no actor ${id}`); o[k] = v; if (k === 'ff_chatMsg') chatWrites.push([id >>> 0, v]); },
  getUserByActor: (id) => { const o = store.get(id >>> 0); return o && o.__user >= 0 ? o.__user : 65535; },
  getUserActor: (u) => { for (const [id, o] of store) if (o.__user === u) return id; return 0; },
  getActorsByProfileId: (pid) => [...store].filter(([, o]) => o.profileId === pid).map(([id]) => id),
  findFormsByPropertyValue: (k, v) => (k === 'private.indexed.tagKey' ? [...store].filter(([, o]) => String(o['private.charTag'] || '').toLowerCase() === v).map(([id]) => id) : []),
  kick: (u) => kicked.push(u),
  getServerSettings: () => ({}),
};
const log = (...a) => logs.push(a.join(' '));

// gamemode.js, cut as written: the gate, the capture, names and tiers (with the rank rule), the audit, /kick, findAnyByName
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
    TIER_RANK, TIER_LABEL, broadcast, findByName, findAnyByName, audit, commands, registerChatCommand, handleLine, staffRolesSeen,
    accountRankOf: typeof accountRankOf === 'function' ? accountRankOf : undefined, rankRefusalOf: typeof rankRefusalOf === 'function' ? rankRefusalOf : undefined,
    authorRefusalOf: typeof authorRefusalOf === 'function' ? authorRefusalOf : undefined };`,
].join('\n');
const world = { online };
const G = new Function('mp', 'log', 'cfg', 'fs', 'path', 'world', 'CHAT_PROP', 'US', 'noteTold', 'ADMIN_PROFILES', 'TIERS', 'tierRoles', 'legacyAdminRoles',
  'trialRoles', 'FLOOD', 'R', 'sendNear', 'bubbleNear', 'hasPlayerMenu', 'openPlayerMenu', 'staffLog', 'indexName', 'discordTarget', 'postJson', 'setTimeout', body)(
  mp, log, {}, fs, path, world, 'ff_chatMsg', String.fromCharCode(31), () => {}, new Set([ADMIN_PROFILE]), ['senior', 'developer', 'leadgm', 'gm'],
  { senior: [ROLE.owner], developer: [ROLE.dev], leadgm: [ROLE.lead], gm: [ROLE.gm] }, [], [ROLE.trial],
  { chatMaxChars: 2000, stripColourCodes: true }, { say: 20, low: 8, whisper: 3, wide: 35, shout: 80, emote: 20, emoteLow: 8, emoteLong: 35, looc: 20, loocLow: 8, loocLong: 35 },
  () => {}, () => {}, () => false, () => {}, (who, tier, what, detail) => staffLines.push({ who, tier, what, detail }), () => {}, null, async () => {}, () => 0);

// The real discipline.js on a scratch record file; its kick waits 1.5 s with setTimeout, run at once here
const realTimeout = global.setTimeout;
global.setTimeout = (fn) => { fn(); return 0; };
const loadDiscipline = (record = []) => {
  delete require.cache[DISCIPLINE_JS];
  require(DISCIPLINE_JS)({ mp, log, personal: G.personal, audit: G.audit, who: G.who, display: G.display, profileOf: G.profileOf, onlineActors: online,
    registerChatCommand: G.registerChatCommand, isAdmin: G.isAdmin, isLeadStaff: G.isLeadStaff, findAnyByName: G.findAnyByName, rankRefusal: G.rankRefusalOf, authorRefusal: G.authorRefusalOf,
    sendPacket: (a, p) => packets.push([a >>> 0, p]), userOf: G.userOf, every: () => {},
    cfg: { discipline: Object.assign({}, REPO_CFG.discipline, { file: RECORDS, discordFile: path.join(SCRATCH, 'none.json'), record }) } });
};
loadDiscipline();
const recordOf = (p) => { try { return JSON.parse(fs.readFileSync(RECORDS, 'utf8')).profiles[p] || []; } catch (e) { return []; } };
const n = (p) => recordOf(p).length;

// The real console.js, as gamemode.js loads it (accountRank: gamemode.js accountRankOf), with signed requests
let clock = Date.now();
const KEY = Buffer.from(KEY_HEX, 'hex');
const sign = (r) => crypto.createHmac('sha256', KEY).update(rules.reqPayload(r)).digest('hex');
let seq = 0;
const req = (text, o) => {
  const r = { v: 1, id: `w-7a2b3c4d-5e6f-4a01-9b2c-${String(++seq).padStart(12, '0')}`, src: 'web', discordId: o.discordId, user: o.user, profileId: o.profileId, roles: o.roles,
    text, mode: 'on', issuedAt: clock, expiresAt: clock + 10000 };
  r.sig = sign(r);
  return r;
};
const readReply = (id) => { const f = path.join(OUT, `${id}.json`); if (!fs.existsSync(f)) return null; const rep = JSON.parse(fs.readFileSync(f, 'utf8')); fs.unlinkSync(f); return rep; };
let ticker = null;
const PIN = [ID.jake, ID.nate, ID.gm, ID.lead];
const CFG = Object.assign({}, REPO_CFG, { remoteConsole: Object.assign({}, REPO_CFG.remoteConsole, { discordIds: PIN }) });
const loadConsole = (accountRank) => {
  delete require.cache[CONSOLE_JS];
  globalThis.__dboRunCommand = globalThis.__dboRunCommand || (() => null);
  require(CONSOLE_JS)({ mp, log, audit: G.audit, every: (nm, ms, fn) => { ticker = fn; }, stopTimer: () => {}, cfg: CFG, commands: G.commands, handleLine: G.handleLine,
    findByName: G.findByName, tagOf: G.tagOf, profileOf: G.profileOf, discordOf: G.discordOf, userOf: G.userOf, display: G.display, who: G.who, staffTierFrom: G.staffTierFrom,
    staffTierOf: G.staffTierOf, TIER_LABEL: G.TIER_LABEL, TIER_RANK: G.TIER_RANK, captureFor: G.captureFor, onlineActors: online, gen: globalThis.__dboRunCommand,
    accountRank, paths: { spool: SPOOL, key: KEY_FILE, switch: SWITCH_FILE }, now: () => clock });
  ticker();
};
loadConsole(G.accountRankOf);
const send = (text, as) => {
  globalThis.__dboConsoleState.all = []; globalThis.__dboConsoleState.perProfile.clear();
  const r = req(rules.cleanCommand(text), as); fs.writeFileSync(path.join(IN, `${r.id}.json`), JSON.stringify(r), { mode: 0o600 }); ticker(); return readReply(r.id);
};
const AS = {
  jake: { discordId: ID.jake, profileId: 1, roles: [ROLE.owner], user: 'jake' },
  nate: { discordId: ID.nate, profileId: 2, roles: [ROLE.dev], user: 'nate' },
  lead: { discordId: ID.lead, profileId: 9, roles: [ROLE.lead], user: 'leda' },
  gm: { discordId: ID.gm, profileId: 3, roles: [ROLE.gm], user: 'gemma' },
};

// A line typed in game by an online staff member: what they were told
const US = String.fromCharCode(31);
const toldAll = [];
const typed = (who, line) => {
  setOnline(who, true);
  const from = chatWrites.length;
  G.handleLine(who, line, G.userOf(who));
  const told = chatWrites.slice(from).filter(([a]) => a === who).map(([, l]) => String(l).split(US).pop().replace(/^\[\[PM\]\]System\|/, ''));
  toldAll.push(...told);
  return told;
};
const reset = () => { kicked.length = 0; staffLines.length = 0; chatWrites.length = 0; logs.length = 0; packets.length = 0; };
const userOf = (id) => store.get(id).__user;
const audits = () => logs.filter((l) => l.startsWith('audit: ')).map((l) => l.slice(7));
const RANK_KICK = (t) => `${t} is on a staff account of your rank or higher, so you cannot kick them. Take it to someone above that rank, or to the Owners.`;
const RANK_DISC = (t) => `${t} is on a staff account of your rank or higher, so you cannot discipline it. Take it to someone above that rank, or to the Owners: reports about staff go through the Report a GM ticket.`;

// ==== K. /kick typed in game ================================================================================================
reset();
{
  setOnline(A.gm, true); setOnline(A.jakeAlt, true);
  let told = typed(A.gm, '/kick #ABCD');
  check('K1. a GM cannot kick an Owner', told.includes(RANK_KICK('Jake #ABCD')) && !kicked.length, { told, kicked });
  told = typed(A.gm, '/kick #JALT');
  check("K1. ...nor the Owner's alt with no roles stamped: the account counts, not the character (X5)", told.includes(RANK_KICK('Jake Alt #JALT')) && !kicked.length, { told, kicked });
  setOnline(A.gary, true);
  told = typed(A.gm, '/kick #GARY');
  check('K1. ...nor another GM: the same rank is refused too', told.includes(RANK_KICK('Gary #GARY')) && !kicked.length, { told, kicked });
  for (const t of [A.nate, A.lars, A.tina]) setOnline(t, true);
  told = typed(A.gm, '/kick #TRIA');
  check('K2. a GM kicks a Trial GM (below GM)', kicked.includes(userOf(A.tina)) && !told.some((l) => /staff account|own account|could not be read/.test(l)), { told, kicked });
  reset();
  typed(A.gm, '/kick #8KWH');
  check('K2. ...and a player, with the broadcast and the audit line as before (the player log reads it)', kicked.includes(userOf(A.bob))
    && chatWrites.some(([, l]) => /Bob was kicked by Gemma\./.test(l)) && audits().some((l) => /^GM Gemma #GMGM \(profile 3, <@200000000000000003>\) kicked Bob #8KWH \(profile 5, <@200000000000000005>\) via \/kick$/.test(l)), audits());
  reset();
  told = typed(A.lead, '/kick #NNAT');
  const told2 = typed(A.lead, '/kick #LARS');
  check('K3. a Lead GM cannot kick a Developer, nor another Lead GM', told.includes(RANK_KICK('Nate #NNAT')) && told2.includes(RANK_KICK('Lars #LARS')) && !kicked.length, { told, told2, kicked });
  typed(A.lead, '/kick #GMGM');
  check('K3. ...and kicks a GM', kicked.length === 1 && kicked[0] === userOf(A.gm), kicked);
  reset();
  setOnline(A.dina, true);
  told = typed(A.lead, '/kick #DINA');
  check("K4. a Developer demoted on Discord still counts by her old alt's stamp (raise-only: a false refusal, never a pass)", told.includes(RANK_KICK('Dina #DINA')) && !kicked.length, { told, kicked });
  for (const t of [A.olaf, A.admn]) setOnline(t, true);
  told = typed(A.jake, '/kick #OLAF');
  const told3 = typed(A.jake, '/kick #ADMN');
  check("K5. an Owner cannot kick another Owner, by roles or by the code's admin profiles", told.includes(RANK_KICK('Olaf #OLAF')) && told3.includes(RANK_KICK('Ada #ADMN')) && !kicked.length, { told, told3, kicked });
  typed(A.jake, '/kick #NNAT');
  check('K5. ...and kicks a Developer', kicked.length === 1 && kicked[0] === userOf(A.nate), kicked);
  reset();
  told = typed(A.jake, '/kick #JALT');
  const told4 = typed(A.jake, '/kick #ABCD');
  check('K6. nobody kicks their own account, another character on it or themself', told.includes('You cannot kick your own account: Jake Alt #JALT is on it. Log out instead.') && told4.includes('You cannot kick your own account: Jake #ABCD is on it. Log out instead.') && !kicked.length, { told, told4, kicked });
  // fails closed: the profile, or the account's characters, cannot be read
  const realGet = mp.get;
  mp.get = (id, k) => { if ((id >>> 0) === A.bob && k === 'profileId') throw new Error('store gone'); return realGet(id, k); };
  told = typed(A.lead, '/kick #8KWH');
  mp.get = realGet;
  check("K7. a target whose profile cannot be read is not kicked", told.includes("The staff rank of Bob #8KWH's account could not be read, so nobody was kicked. Try again, or ask an Owner.") && !kicked.length, { told, kicked });
  const realIdx = mp.getActorsByProfileId;
  mp.getActorsByProfileId = () => { throw new Error('index gone'); };
  told = typed(A.jake, '/kick #8KWH');
  mp.getActorsByProfileId = realIdx;
  check("K7. ...nor one whose account's characters cannot be listed, and the log says why", told.some((l) => /could not be read, so nobody was kicked/.test(l)) && !kicked.length
    && logs.some((l) => /rank rule: staff rank of profile 5 unreadable: index gone/.test(l)), { told, kicked, logs: logs.slice(-3) });
  for (const t of [A.jakeAlt, A.gary, A.nate, A.lars, A.tina, A.dina, A.olaf, A.admn]) setOnline(t, false);
}

// ==== D. /discipline typed in game, every kind ==============================================================================
reset();
{
  const n1 = n(1);
  let told = typed(A.gm, '/discipline #JALT strike gm strikes the owner through an alt');
  check("D1. a GM cannot strike an Owner through an alt with no roles stamped, and nothing lands on the Owner's account (X5)", told.includes(RANK_DISC('Jake Alt #JALT')) && n(1) === n1, { told, records: recordOf(1) });
  told = typed(A.gm, '/discipline #ABCD warn gm warns the owner directly');
  check('D1. ...nor warn the Owner directly, with the rank wording', told.includes(RANK_DISC('Jake #ABCD')) && n(1) === n1, told);
  const kinds = ['warn spamming the market chat', 'strike griefing at the gate', 'suspend 3d stole from a barrel', 'lift appeal accepted here', 'overturn 1 it was the wrong person'];
  const by = (who, tag) => kinds.map((k) => typed(who, `/discipline #${tag} ${k}`));
  const n2 = n(2), n1b = n(1), n12 = n(12), n11 = n(11);
  const onNate = by(A.lead, 'NNAT'), onJake = by(A.lead, 'ABCD'), onAlt = by(A.lead, 'JALT'), onLars = by(A.lead, 'LARS');
  check('D2. a Lead GM can neither warn, strike, suspend, lift nor overturn on a Developer, an Owner, an Owner\'s alt, or another Lead GM',
    onNate.every((t) => t.includes(RANK_DISC('Nate #NNAT'))) && onJake.every((t) => t.includes(RANK_DISC('Jake #ABCD'))) && onAlt.every((t) => t.includes(RANK_DISC('Jake Alt #JALT')))
    && onLars.every((t) => t.includes(RANK_DISC('Lars #LARS'))) && n(2) === n2 && n(1) === n1b && n(11) === n11 && !kicked.length, { onNate, onJake, onAlt, onLars, kicked });
  check('D2. ...nor on a Developer demoted minutes ago on Discord (her old stamp still counts)', by(A.lead, 'DINA').every((t) => t.includes(RANK_DISC('Dina #DINA'))) && n(14) === 0);
  reset();
  const n3 = n(3);
  told = typed(A.lead, '/discipline #GMGM warn a Lead GM warns a GM');
  const sus = typed(A.lead, '/discipline #GMGM suspend 1h a Lead GM suspends a GM');
  setOnline(A.gm, true);
  const lift = typed(A.lead, '/discipline #GMGM lift a Lead GM lifts it again');
  check('D3. a Lead GM warns, suspends and lifts on a GM account, as before', told.some((l) => /^Recorded: warn #\d+ on Gemma #GMGM/.test(l)) && sus.some((l) => /^Recorded: suspend #\d+ on Gemma #GMGM until/.test(l))
    && lift.some((l) => /^Recorded: lift #\d+ on Gemma #GMGM/.test(l)) && n(3) === n3 + 3, { told, sus, lift });
  told = typed(A.nate, '/discipline #LARS strike a Developer strikes a Lead GM');
  const ow = typed(A.jake, '/discipline #NNAT warn an Owner warns a Developer');
  check('D4. a Developer disciplines a Lead GM, an Owner a Developer', told.some((l) => /^Recorded: strike #\d+ on Lars #LARS/.test(l)) && ow.some((l) => /^Recorded: warn #\d+ on Nate #NNAT/.test(l)), { told, ow });
  told = typed(A.jake, '/discipline #OLAF warn an Owner warns an Owner');
  const ad = typed(A.jake, '/discipline #ADMN warn an Owner warns an admin profile');
  check("D4. ...but an Owner cannot discipline another Owner, by roles or by the code's admin profiles", told.includes(RANK_DISC('Olaf #OLAF')) && ad.includes(RANK_DISC('Ada #ADMN')) && n(12) === n12 && n(ADMIN_PROFILE) === 0, { told, ad });
  told = typed(A.gm, '/discipline #TRIA warn a GM warns a Trial GM');
  const pl = typed(A.gm, '/discipline #8KWH strike a GM strikes a player');
  check('D5. a GM disciplines a Trial GM and a player, as before', told.some((l) => /^Recorded: warn #\d+ on Tina #TRIA/.test(l)) && pl.some((l) => /^Recorded: strike #\d+ on Bob #8KWH/.test(l)), { told, pl });
  told = typed(A.gm, '/discipline #JALT');
  check("D6. reading a record is no punishment: a GM still reads an Owner's alt's record", told.some((l) => /^Jake Alt #JALT \(profile 1\)/.test(l)), told);
  const realIdx = mp.getActorsByProfileId; const n5 = n(5);
  mp.getActorsByProfileId = () => { throw new Error('index gone'); };
  told = typed(A.jake, '/discipline #8KWH warn the index is gone');
  mp.getActorsByProfileId = realIdx;
  check("D7. an account whose rank cannot be read gets no record (fails closed)", told.includes("The staff rank of Bob #8KWH's account could not be read, so nothing was recorded. Try again, or ask an Owner.") && n(5) === n5, told);
  setOnline(A.gm, false); setOnline(A.nate, false); setOnline(A.lead, false);
}

// ==== P. the same decision typed in game and from the console ===============================================================
reset();
{
  // caller -> rank; target tag -> [profile, the account's rank]. The console takes Lead GMs and above (its floor), so a GM's
  // console request is refused as tier whatever the target; typed, the GM gets the rank rule
  const CALLERS = { gm: [A.gm, 3, 1], lead: [A.lead, 9, 2], nate: [A.nate, 2, 3], jake: [A.jake, 1, 4] };
  const TARGETS = { '8KWH': [5, 0], TRIA: [13, 0.5], GARY: [4, 1], LARS: [11, 2], NNAT: [2, 3], DINA: [14, 3], OLAF: [12, 4], JALT: [1, 4], ADMN: [ADMIN_PROFILE, 4] };
  const wrong = []; let pairs = 0, floor = 0;
  for (const [cn, [who, cpid, crank]] of Object.entries(CALLERS)) {
    for (const [tag, [tpid, trank]] of Object.entries(TARGETS)) {
      const expect = tpid !== cpid && trank < crank;
      let before = n(tpid);
      typed(who, `/discipline #${tag} warn parity check typed in game`);
      const inGame = n(tpid) === before + 1;
      setOnline(who, false); setOnline(A.jake, true);
      before = n(tpid);
      const rep = send(`/discipline #${tag} warn parity check from the console`, AS[cn]);
      pairs++;
      // A GM never reaches the rank rule from the console: its floor refuses them as tier first, whatever the target
      if (cn === 'gm') { floor++; if (inGame !== expect || !rep || rep.why !== 'tier' || n(tpid) !== before) wrong.push({ caller: cn, tag, expect, inGame, why: rep && rep.why }); continue; }
      const remote = !!rep && rep.state === 'ran' && n(tpid) === before + 1;
      if (inGame !== expect || remote !== expect || (!expect && !(rep && ['rank', 'ownAccount'].includes(rep.why)))) wrong.push({ caller: cn, tag, expect, inGame, remote, why: rep && rep.why });
    }
  }
  check(`P1. /discipline warn: typed in game as the rule says for ${pairs} caller and account pairs; from the console alike for the ${pairs - floor} of Lead GMs and above (refused as rank or own account), and a GM's ${floor} as tier (the console's floor)`,
    !wrong.length && pairs === 36 && floor === 9, wrong);
  // /kick from the console on online targets, against the same rule typed
  const kwrong = [];
  for (const [cn, [who, cpid, crank]] of Object.entries(CALLERS)) {
    for (const [tag, [tpid, trank]] of Object.entries(TARGETS)) {
      if (tpid === 1) continue; // Jake's alt online would be Jake's console character (online first)
      const t = [...store].find(([, o]) => o['private.charTag'] === tag)[0];
      setOnline(t, true); setOnline(who, true); reset();
      typed(who, `/kick #${tag}`);
      const inGame = kicked.includes(userOf(t));
      reset();
      const rep = send(`/kick #${tag}`, AS[cn]);
      const expect = tpid !== cpid && trank < crank;
      if (cn === 'gm') { if (inGame !== expect || !rep || rep.why !== 'tier' || kicked.length) kwrong.push({ caller: cn, tag, expect, inGame, why: rep && rep.why }); }
      else {
        const remote = !!rep && rep.state === 'ran' && kicked.includes(userOf(t));
        if (inGame !== expect || remote !== expect || (!expect && !(rep && ['rank', 'ownAccount'].includes(rep.why)))) kwrong.push({ caller: cn, tag, expect, inGame, remote, why: rep && rep.why });
      }
      if (t !== A.bob && t !== A.jake) setOnline(t, false);
    }
    if (who !== A.jake) setOnline(who, false);
  }
  check("P2. /kick: typed in game and from the console decide alike, and as the rule says (a GM's console request: tier)", !kwrong.length, kwrong);
}

// ==== A. the record-author rule: lift and overturn ==========================================================================
reset();
{
  const num = (told, kind) => { const m = told.join(' ').match(new RegExp(`Recorded: ${kind} #(\\d+)`)); return m ? Number(m[1]) : 0; };
  const entry = (p, k) => recordOf(p).find((e) => e.n === k) || {};
  const sus = num(typed(A.jake, '/discipline #8KWH suspend 3d an Owner suspends a player'), 'suspend');
  let told = typed(A.lead, '/discipline #8KWH lift a Lead GM lifts the Owner suspension');
  const told2 = typed(A.nate, '/discipline #8KWH lift a Developer lifts the Owner suspension');
  check("A1. a Lead GM and a Developer cannot lift an Owner's suspension of a player (review finding 3)", sus > 0
    && told.includes(`Suspension #${sus} was given by Jake #ABCD, of a rank above yours, so you cannot lift it. Ask someone of that rank, or the Owners.`)
    && told2.some((l) => l.startsWith(`Suspension #${sus} was given by Jake #ABCD, of a rank above yours`)) && !entry(5, sus).lifted, { sus, told, told2 });
  told = typed(A.olaf, '/discipline #8KWH lift another Owner lifts it');
  check('A1. ...another Owner can (the same rank)', told.some((l) => /^Recorded: lift #\d+ on Bob #8KWH/.test(l)) && entry(5, sus).lifted === true, told);
  setOnline(A.olaf, false);
  const lst = num(typed(A.lead, '/discipline #8KWH strike a Lead GM strikes a player'), 'strike');
  told = typed(A.lars, '/discipline #8KWH overturn ' + lst + ' another Lead GM overturns it');
  check("A2. a Lead GM overturns another Lead GM's strike (the same rank)", lst > 0 && told.some((l) => /^Recorded: overturn #\d+ on Bob #8KWH/.test(l)) && !!entry(5, lst).overturned, told);
  setOnline(A.lars, false);
  const dst = num(typed(A.nate, '/discipline #8KWH strike a Developer strikes a player'), 'strike');
  told = typed(A.lead, '/discipline #8KWH overturn ' + dst + ' a Lead GM overturns the Developer strike');
  check("A2. ...but not a Developer's", told.includes(`Record #${dst} was given by Nate #NNAT, of a rank above yours, so you cannot overturn it. Ask someone of that rank, or the Owners.`) && !entry(5, dst).overturned, told);
  told = typed(A.jake, '/discipline #8KWH overturn ' + dst + ' an Owner overturns the Developer strike');
  check("A2. ...and an Owner overturns the Developer's", told.some((l) => /^Recorded: overturn #\d+ on Bob #8KWH/.test(l)) && !!entry(5, dst).overturned, told);
  const gst = num(typed(A.gm, '/discipline #8KWH strike a GM strikes a player'), 'strike');
  told = typed(A.lead, '/discipline #8KWH overturn ' + gst + ' a Lead GM overturns a GM strike');
  check("A3. a Lead GM overturns a GM's strike (a higher rank undoes a lower one's, as before)", told.some((l) => /^Recorded: overturn #\d+ on Bob #8KWH/.test(l)) && !!entry(5, gst).overturned, told);
  // A suspension decided outside the game (gamemode-config.json's discipline records, byProfile 0) is the Owners'
  loadDiscipline([{ key: 'owners-test', tag: 'PIAA', kind: 'suspend', from: new Date(Date.now() - 60000).toISOString(), length: '3d', reason: 'decided by the Owners for the test', by: 'Jake' }]);
  const cfgN = (recordOf(16)[0] || {}).n;
  told = typed(A.lead, '/discipline #PIAA lift a Lead GM lifts a config suspension');
  const told3 = typed(A.nate, '/discipline #PIAA lift a Developer lifts a config suspension');
  check('A4. a Lead GM and a Developer cannot lift a suspension decided outside the game (a config record)', cfgN === 1 && (recordOf(16)[0] || {}).byProfile === 0
    && told.includes('Suspension #1 was decided outside the game by the Owners, so only an Owner can lift it.') && told3.includes('Suspension #1 was decided outside the game by the Owners, so only an Owner can lift it.')
    && !recordOf(16)[0].lifted, { told, told3, rec: recordOf(16) });
  told = typed(A.jake, '/discipline #PIAA lift an Owner lifts the config suspension');
  check('A4. ...an Owner can', told.some((l) => /^Recorded: lift #2 on Pia #PIAA/.test(l)) && recordOf(16)[0].lifted === true, told);
  // Fails closed: the author's account cannot be read, or an entry carries no author
  const ost = num(typed(A.lead, '/discipline #8KWH strike a strike to test the unreadable author'), 'strike');
  const realIdx = mp.getActorsByProfileId;
  mp.getActorsByProfileId = (pid) => { if (pid === 9) throw new Error('index gone'); return realIdx(pid); };
  told = typed(A.nate, '/discipline #8KWH overturn ' + ost + ' the author cannot be read');
  mp.getActorsByProfileId = realIdx;
  check("A5. a record whose author's account cannot be read is not overturned by a Developer (fails closed)", told.includes(`Who gave Record #${ost} cannot be read, so it was not overturned. Ask an Owner.`) && !entry(5, ost).overturned, told);
  const file = JSON.parse(fs.readFileSync(RECORDS, 'utf8')); delete file.profiles[5].find((e) => e.n === ost).byProfile; fs.writeFileSync(RECORDS, JSON.stringify(file));
  loadDiscipline();
  told = typed(A.nate, '/discipline #8KWH overturn ' + ost + ' the entry has no author');
  check('A5. ...nor an entry that carries no author', told.includes(`Who gave Record #${ost} cannot be read, so it was not overturned. Ask an Owner.`) && !entry(5, ost).overturned, told);
  setOnline(A.nate, false);
  told = typed(A.jake, '/discipline #8KWH overturn ' + ost + ' an Owner overturns the entry with no author');
  check('A5. ...but an Owner does: no author outranks an Owner, so the record is never left undoable by anyone in game (review, 22 Oct)', told.some((l) => /^Recorded: overturn #\d+ on Bob #8KWH/.test(l)) && !!entry(5, ost).overturned, told);
  // From the console the same rule holds: discipline.js runs behind the console's own checks
  const sus2 = num(typed(A.jake, '/discipline #8KWH suspend 1d an Owner suspends again'), 'suspend');
  setOnline(A.lead, false); setOnline(A.jake, true);
  const rep = send('/discipline #8KWH lift a Lead GM lifts it from the console', AS.lead);
  check("A6. from the console a Lead GM cannot lift an Owner's suspension either (X9), and the reply says why", sus2 > 0 && !entry(5, sus2).lifted
    && !!rep && rep.lines.some((l) => l.text === `Suspension #${sus2} was given by Jake #ABCD, of a rank above yours, so you cannot lift it. Ask someone of that rank, or the Owners.`), rep && rep.lines);
}

// ==== R. a Discord demotion reaches every character of the account (review of 22 Oct, PROVEN: old stamps protected) ========
reset();
{
  // Dina (14), a Developer demoted on Discord: her online character has no roles, Dina Old still has Developer stamped (K4, D2)
  setOnline(A.dina, true); setOnline(A.lead, true);
  let told = typed(A.lead, '/kick #DINA');
  check("R1. before the role sync has seen it, Dina Old's Developer stamp still protects her account (raise-only, as K4)", told.includes(RANK_KICK('Dina #DINA')) && !kicked.length, { told, kicked });
  G.staffRolesSeen(A.dina, []);
  check("R1. the role sync reads her roles from the character she plays: Dina Old's Developer stamp comes off, Dina is not logged out (no staff stamp of her own)",
    JSON.stringify(store.get(A.dinaOld)['private.discordRoles']) === '[]' && !kicked.length, store.get(A.dinaOld)['private.discordRoles']);
  told = typed(A.lead, '/kick #DINA');
  check('R1. ...and a Lead GM can kick her now', kicked.includes(userOf(A.dina)) && !told.some((l) => /staff account|could not be read/.test(l)), { told, kicked });
  const n14 = n(14);
  told = typed(A.lead, '/discipline #DOLD warn the old character of a demoted Developer');
  check('R1. ...and discipline her account typed in game (on the old character, offline)', told.some((l) => /^Recorded: warn #\d+ on Dina Old #DOLD/.test(l)) && n(14) === n14 + 1, told);
  setOnline(A.lead, false); setOnline(A.jake, true);
  const rep = send('/discipline #DINA warn from the console after the demotion', AS.lead);
  check('R1. ...and from the console (the same accountRankOf)', !!rep && rep.state === 'ran' && n(14) === n14 + 2, rep && { state: rep.state, why: rep.why });
  setOnline(A.dina, false);
  // Olaf (12), an Owner demoted on Discord while offline, logs in on a new character (stamped at that login with his roles now)
  reset();
  const olaf2 = actor(0xff000a61, { name: 'Olaf Two', tag: 'OLF2', profile: 12, discord: '200000000000000012', roles: [], online: true });
  const before = ['jake', 'nate', 'lead', 'gm'].map((k) => typed(A[k], '/kick #OLF2'));
  check('R2. before the role sync has seen it, the ex-Owner can be kicked by nobody, not even an Owner (the finding as proven)',
    before.every((t) => t.includes(RANK_KICK('Olaf Two #OLF2'))) && !kicked.length, { before, kicked });
  G.staffRolesSeen(olaf2, []);
  check('R2. the role sync on the character he plays brings the old Owner stamp down', JSON.stringify(store.get(A.olaf)['private.discordRoles']) === '[]', store.get(A.olaf)['private.discordRoles']);
  told = typed(A.gm, '/kick #OLF2');
  const n12 = n(12);
  const dis = typed(A.lead, '/discipline #OLAF strike the old character of an ex-Owner');
  check('R2. ...so a GM kicks him, and a Lead GM disciplines his old character', kicked.includes(userOf(olaf2)) && dis.some((l) => /^Recorded: strike #\d+ on Olaf #OLAF/.test(l)) && n(12) === n12 + 1, { told, dis, kicked });
  setOnline(olaf2, false);
  for (const k of ['nate', 'lead', 'gm']) setOnline(A[k], false);
  // Leda (9) demoted from Lead GM to GM while online: logged out, and every stamp of her account says GM, never less
  reset();
  const ledaAlt = actor(0xff000a41, { name: 'Leda Alt', tag: 'LED2', profile: 9, discord: ID.lead, roles: [ROLE.lead, 'patron'] });
  setOnline(A.lead, true);
  G.staffRolesSeen(A.lead, [ROLE.gm]);
  check('R3. a Lead GM demoted to GM while online is logged out, and her other character now carries GM, its other roles kept (the account is a GM\'s, not a player\'s)',
    audits().some((l) => /^STAFF Leda #LEAD .*: Discord roles now give gm \(was leadgm\); logged out so it takes effect$/.test(l)) && JSON.stringify(store.get(ledaAlt)['private.discordRoles']) === JSON.stringify(['patron', ROLE.gm]) && G.accountRankOf(9, null, 0) === 1,
    { audits: audits(), alt: store.get(ledaAlt)['private.discordRoles'], rank: G.accountRankOf(9, null, 0) });
  told = typed(A.gary, '/kick #LEAD');
  check('R3. ...so a GM still cannot kick her (same rank): the demotion never lets anyone below her new rank through', told.includes(RANK_KICK('Leda #LEAD')), told);
  // restore Leda for the sections below
  store.get(A.lead)['private.discordRoles'] = [ROLE.lead]; store.get(ledaAlt)['private.discordRoles'] = [ROLE.lead, 'patron'];
  setOnline(A.lead, false); setOnline(A.gary, false);
}

// ==== S. one rule in the code ===============================================================================================
{
  const consoleSrc = fs.readFileSync(CONSOLE_JS, 'utf8');
  check('S1. gamemode.js holds the one accountRankOf, and console.js computes no rank of its own (it calls api.accountRank)',
    (src.match(/^const accountRankOf = /gm) || []).length === 1 && !/getActorsByProfileId\(pid\)/.test(consoleSrc) && /api\.accountRank\(pid, freshRoles, target/.test(consoleSrc));
  check('S1. gamemode.js hands the rule to console.js and to discipline.js', /accountRank: accountRankOf \}\);/.test(src) && /rankRefusal: rankRefusalOf, authorRefusal: authorRefusalOf \}\);/.test(src));
  // console.js without gamemode.js's rule refuses the rank commands (fails closed); other commands are not touched
  loadConsole(undefined); reset();
  setOnline(A.jake, true);
  const rep = send('/kick #8KWH', AS.jake);
  check('S2. console.js loaded without accountRank refuses /kick as rankUnknown, and nobody is kicked', !!rep && rep.state === 'refused' && rep.why === 'rankUnknown' && !kicked.length, rep && { state: rep.state, why: rep.why });
  const calls = [];
  loadConsole((...a) => { calls.push(a.slice(0, 3)); return G.accountRankOf(...a); }); reset();
  const rep2 = send('/discipline #NNAT warn console asks the shared rule', AS.lead);
  check("S2. with it, the console asks gamemode.js's rule for the target's account (and refuses a Lead GM on a Developer)", !!rep2 && rep2.why === 'rank' && calls.some(([pid, fresh, t]) => pid === 2 && fresh === null && t === A.nate), { calls, rep: rep2 && rep2.why });
  loadConsole(G.accountRankOf);
}

// The player log records a command's outcome from what it told (playerlog-rules.js REFUSAL_RX): every refusal of the rank
// rule and the record-author rule told above must read as one, or a refused /kick is logged as a kick that ran (review, 22 Oct)
{
  const { REFUSAL_RX } = require(path.join(ROOT, 'playerlog-rules.js'));
  const said = [...new Set(toldAll.filter((l) => /staff account of your rank|your own account|could not be read|cannot be read|of a rank above yours|decided outside the game/.test(l))
    .map((l) => l.replace(/[A-Z][a-z]+(?: [A-Z][a-z]+)? #[A-Z0-9]{4}/g, 'X').replace(/#\d+/g, '#n')))];
  check(`S3. each of the ${said.length} refusal texts of the rank and record-author rules reads as a refusal to the player log`, said.length >= 9 && said.every((l) => REFUSAL_RX.test(l)), said.filter((l) => !REFUSAL_RX.test(l)).concat([`kinds: ${said.length}`]));
}

global.setTimeout = realTimeout;
fs.rmSync(SCRATCH, { recursive: true, force: true });
console.log('');
console.log(failures ? `${failures} FAILED of ${checks}` : `all ${checks} checks passed`);
process.exit(failures ? 1 : 0);
