// The remote staff console, game side (console.js and its gamemode.js seams; Jake, 13 Oct). The command gate, the capture,
// the target lookup, the tiers, the timers and the console loader are cut out of gamemode.js as they are written there, the
// real /kick /chargen /rename /fixloc /unstuck /load /players /whoami handlers with them, and /wwremote /vlremote out of beastform.js.
// console.js is loaded against a scratch spool, and requests are signed here the way DESIGN.md 6.2 writes them.
//   node tests/console-harness.js    (keep TMPDIR off the HDD: it holds the scratch spool)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const beastSrc = fs.readFileSync(path.join(ROOT, 'beastform.js'), 'utf8');
const CONSOLE_JS = path.join(ROOT, 'console.js');
let failures = 0, checks = 0;
const check = (name, ok, got) => { checks++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!ok) failures++; };
const cutIn = (text, from, to, label) => {
  const a = text.indexOf(from); const b = a < 0 ? -1 : text.indexOf(to, a + from.length);
  if (a < 0 || b < 0) { console.log(`FAIL the ${label} markers are gone`); process.exit(1); }
  return text.slice(a, b);
};
const cut = (from, to, label) => cutIn(src, from, to, label);
const lineOf = (re, label) => { const m = src.match(re); if (!m) { console.log(`FAIL ${label} not found in gamemode.js`); process.exit(1); } return m[0]; };
const RLO = String.fromCharCode(0x202e);

// ---- scratch spool, key and switch --------------------------------------------------------------------------------------
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'console-harness-'));
const SPOOL = path.join(SCRATCH, 'spool');
const KEY_FILE = path.join(SCRATCH, 'console.key');
const SWITCH_FILE = path.join(SCRATCH, 'console');
const IN = path.join(SPOOL, 'in'), WORK = path.join(SPOOL, 'work'), OUT = path.join(SPOOL, 'out');
const makeSpool = () => { for (const d of [SPOOL, IN, WORK, OUT]) { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.chmodSync(d, 0o700); } };
makeSpool();
const KEY_HEX = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(KEY_FILE, `${KEY_HEX}\n`, { mode: 0o600 });
const setSwitch = (text) => { if (text === null) { try { fs.unlinkSync(SWITCH_FILE); } catch (e) { /* none */ } } else fs.writeFileSync(SWITCH_FILE, text); };
setSwitch('on\n');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
if (!isRoot) { console.log('FAIL run as root: the spool and key checks require root-owned files'); process.exit(1); }

// ---- the world ----------------------------------------------------------------------------------------------------------
const ROLE = { owner: '1494126527489507369', dev: '1494491999305338981', lead: '1494126618065506425', gm: '1553844072878178384', trial: '1558248795932860507', player: '1500000000000000001' };
const ID = { jake: '200000000000000001', nate: '200000000000000002', gm: '200000000000000003', trial: '200000000000000004', bob: '200000000000000005', lydia: '200000000000000006', mallory: '200000000000000007', lead: '200000000000000008' };
const store = new Map(); const chatWrites = []; const kicked = []; const raceMenus = []; const logs = []; const staffLines = [];
let nextUser = 10;
const actor = (id, o) => { store.set(id >>> 0, Object.assign({ __user: -1, profileId: 0, appearance: { name: o.name }, 'private.charTag': o.tag, 'private.skympDiscordId': o.discord || '', 'private.discordRoles': o.roles || [] }, o.extra || {}, { __user: o.online ? nextUser++ : -1, profileId: o.profile })); return id >>> 0; };
const A = {
  jakeAlt: actor(0xff000a01, { name: 'Jake Alt', tag: 'JALT', profile: 1, discord: ID.jake, roles: [] }),
  jake: actor(0xff000a02, { name: 'Jake', tag: 'ABCD', profile: 1, discord: ID.jake, roles: [ROLE.owner], online: true }),
  jakeForeign: actor(0xff000a00, { name: 'Not Jake', tag: 'FRGN', profile: 1, discord: ID.mallory, roles: [ROLE.owner] }),
  nate: actor(0xff000a10, { name: 'Nate', tag: 'NNAT', profile: 2, discord: ID.nate, roles: [ROLE.dev] }),
  gm: actor(0xff000a20, { name: 'Gemma', tag: 'GMGM', profile: 3, discord: ID.gm, roles: [ROLE.gm] }),
  trial: actor(0xff000a30, { name: 'Trina', tag: 'TRIA', profile: 4, discord: ID.trial, roles: [ROLE.trial] }),
  lead: actor(0xff000a40, { name: 'Leda', tag: 'LEAD', profile: 9, discord: ID.lead, roles: [ROLE.lead] }),
  bob: actor(0xff000b01, { name: 'Bob', tag: '8KWH', profile: 5, discord: ID.bob, online: true }),
  lydia: actor(0xff000c01, { name: 'Lydia', tag: 'LLX8', profile: 6, discord: ID.lydia, online: true }),
};
const online = () => [...store].filter(([, o]) => o.__user >= 0).map(([id]) => id);
const setOnline = (id, on) => { store.get(id).__user = on ? nextUser++ : -1; };
const mp = {
  get: (id, k) => { const o = store.get(id >>> 0); if (!o) throw new Error(`no actor ${id}`); return o[k]; },
  set: (id, k, v) => { const o = store.get(id >>> 0); if (!o) throw new Error(`no actor ${id}`); if (o.__throwOnSet === k) throw new Error('write refused'); o[k] = v; if (k === 'ff_chatMsg') chatWrites.push([id >>> 0, v]); },
  getUserByActor: (id) => { const o = store.get(id >>> 0); return o && o.__user >= 0 ? o.__user : 65535; },
  getUserActor: (u) => { for (const [id, o] of store) if (o.__user === u) return id; return 0; },
  getActorsByProfileId: (pid) => [...store].filter(([, o]) => o.profileId === pid).map(([id]) => id),
  kick: (u) => kicked.push(u),
  setRaceMenuOpen: (t) => raceMenus.push(t >>> 0),
  getServerSettings: () => ({}),
};
const log = (...a) => logs.push(a.join(' '));

// ---- gamemode.js, cut as written -----------------------------------------------------------------------------------------
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
  cut('const findAnyByName = ', '// ---- letters: kept in private.pigeons', 'findAnyByName'),
  cut('const hubActor = ', '// One line per online player on every reload', 'the hub move and /fixloc'),
  lineOf(/^const UNSTUCK = .*$/m, 'UNSTUCK'), lineOf(/^const pvpAt = .*$/m, 'pvpAt'), lineOf(/^const combatAt = .*$/m, 'combatAt'),
  cut('const unstuckActor = ', '\nconst setDeathTemple = ', '/unstuck'),
  cut("registerChatCommand('load'", '// The spawned npcs near you', '/load'),
  `return { deliver, system, personal, captureFor, actorOf, userOf, nameOf, profileOf, discordOf, tagOf, display, who, tierFrom, tierOf, isAdmin,
    isLeadStaff, staffTierFrom, staffTierOf, TIER_RANK, TIER_LABEL, LEAD_ONLY, broadcast, findByName, audit, commands, registerChatCommand, staffSay,
    handleChat, handleLine, NAME_RE, offlineByTag, accountRankOf, rankRefusalOf, staffTargetOf };`,
].join('\n');
const world = { online };
const G = new Function('mp', 'log', 'cfg', 'fs', 'path', 'world', 'CHAT_PROP', 'US', 'noteTold', 'ADMIN_PROFILES', 'TIERS', 'tierRoles', 'legacyAdminRoles',
  'trialRoles', 'FLOOD', 'R', 'sendNear', 'bubbleNear', 'hasPlayerMenu', 'openPlayerMenu', 'staffLog', 'indexName', 'discordTarget', 'postJson', 'setTimeout',
  // /chargen marks the editor open (the editor guard, origin/server 355afd2cd, 19 Oct); its bookkeeping is not what this harness tests
  'markEditorOpen',
  // /unstuck's temple and creation gate (tests/death-temple-hold-harness.js runs the real temples, offline ones included)
  'templeZoneOf', 'templeFor', 'creationPending', 'GATE_CREATION_LINE', body)(
  mp, log, {}, fs, path, world, 'ff_chatMsg', String.fromCharCode(31), () => {}, new Set(), ['senior', 'developer', 'leadgm', 'gm'],
  { senior: [ROLE.owner], developer: [ROLE.dev], leadgm: [ROLE.lead], gm: [ROLE.gm] }, [], [ROLE.trial],
  { chatMaxChars: 2000, stripColourCodes: true }, { say: 20, low: 8, whisper: 3, wide: 35, shout: 80, emote: 20, emoteLow: 8, emoteLong: 35, looc: 20, loocLow: 8, loocLong: 35 },
  () => {}, () => {}, () => false, () => {}, (who, tier, what, detail) => staffLines.push({ who, tier, what, detail }), () => {}, null, async () => {}, () => 0, () => {},
  () => 'bruma', (z) => (z === 'bruma' ? { world: 'a764b:BSHeartland.esm', pos: [59151, 201645, 7559], rotZ: 0 } : null), () => false, 'unfinished');

// beastform.js's /wwremote and /vlremote, with its BODY table and breaker flag, cut as written
// beastform.js's bodyTripped as written, with what it reads. One line until origin/server d4be291be (Nate's hotfix-1014b,
// 14 Oct: a werewolf breaker trip expires after breakerHoldMinutes); a block after it, with minutes() and HOLD_MS before
// it, read from the module's CFG, which is {} here, so the defaults. The cut runs to bodyShown either way
const trippedCut = (text) => {
  const t = text.indexOf('\n  const bodyTripped = '); const end = t < 0 ? -1 : text.indexOf('\n  const bodyShown = ', t);
  if (t < 0 || end < 0) { console.log('FAIL the bodyTripped markers are gone from beastform.js'); process.exit(1); };
  const m = text.lastIndexOf('\n  const minutes = ', t); const wb = text.indexOf('\n  const WB = ');
  return `const CFG = {};${text.slice(m > wb && wb >= 0 ? m : t, end)}`;
};
const beastBody = [
  cutIn(beastSrc, '  const BODY = {', '  const WB = ', 'BODY'),
  trippedCut(beastSrc),
  cutIn(beastSrc, '  // /vlremote and /wwremote', "  registerChatCommand('forms'", 'remoteCommand'),
].join('\n');
const beastSent = [];
new Function('mp', 'log', 'personal', 'registerChatCommand', 'display', 'who', 'audit', 'findByName', 'api', 'saveRemote', 'saveWerewolfRemote', 'sendBeastBodies', 'counted', beastBody)(
  mp, log, G.personal, G.registerChatCommand, G.display, G.who, G.audit, G.findByName, { onlineActors: online }, () => {}, () => {}, () => beastSent.push(1), new Map());
// Commands the console must never run, registered so their refusals can be told apart from an unknown name
const neverRan = [];
for (const [n, admin] of [['tp', true], ['npc', true], ['bugs', true], ['wipechars', true], ['schedule', true], ['announce', true], ['dungeon', false], ['beastform', true]]) G.registerChatCommand(n, (a, b) => neverRan.push([n, b]), { admin, help: 'test' });
globalThis.__dboNameKey = (n) => n.toLowerCase(); globalThis.__dboNameTaken = () => false;
// stafftools.js registers /chars (on the console allowlist) and /event (not on it)
require(path.join(ROOT, 'stafftools.js'))({ mp, log, personal: G.personal, system: G.system, audit: G.audit, who: G.who, tagOf: G.tagOf, profileOf: G.profileOf,
  onlineActors: online, registerChatCommand: G.registerChatCommand, isAdmin: G.isAdmin, cfg: {}, staffTier: G.staffTierOf, realNameOf: G.nameOf, userOf: G.userOf,
  findByName: G.findByName, offlineByTag: G.offlineByTag });
globalThis.__dboBeastOriginalRace = () => 0;

// ---- requests, signed as the backend writes them (DESIGN 6.2) -------------------------------------------------------------
let clock = Date.now();
const KEY = Buffer.from(KEY_HEX, 'hex');
const sign = (r, key = KEY) => crypto.createHmac('sha256', key).update(`dbo-console-req-v1\n${JSON.stringify([r.v, r.id, r.src, r.discordId, r.user, r.profileId, r.roles, r.text, r.mode, r.issuedAt, r.expiresAt])}`).digest('hex');
let seq = 0;
const uuid = () => `6f1c2a3b-4d5e-4f60-8a7b-${String(++seq).padStart(12, '0')}`;
const req = (text, o = {}) => {
  const src = o.src || 'web';
  const r = { v: 1, id: o.id || (src === 'web' ? `w-${uuid()}` : `d-${String(1400000000000000000n + BigInt(++seq))}`), src, discordId: o.discordId || ID.jake, user: o.user ?? 'jake',
    profileId: o.profileId ?? 1, roles: o.roles || [ROLE.owner], text, mode: o.mode || 'on', issuedAt: o.issuedAt ?? clock, expiresAt: o.expiresAt ?? (o.issuedAt ?? clock) + 10000 };
  r.sig = o.sig ?? sign(r);
  if (o.tamper) o.tamper(r);
  return r;
};
const drop = (r, name) => { const f = path.join(IN, `${name || r.id}.json`); fs.writeFileSync(f, typeof r === 'string' ? r : JSON.stringify(r), { mode: 0o600 }); return r; };
const readReply = (id) => {
  const f = path.join(OUT, `${id}.json`);
  if (!fs.existsSync(f)) return null;
  const rep = JSON.parse(fs.readFileSync(f, 'utf8')); fs.unlinkSync(f);
  const want = crypto.createHmac('sha256', KEY).update(`dbo-console-rep-v1\n${JSON.stringify([rep.v, rep.id, rep.state, rep.gate, rep.ranAs, rep.online, rep.tier, rep.target,
    rep.lines.map((l) => ({ to: l.to, text: l.text })), rep.why, rep.at])}`).digest('hex');
  rep.sigOk = rep.sig === want;
  return rep;
};

// What both front ends put after the state (DESIGN 6.3): the console's own line, else the first line to the caller, else the
// first broadcast
const header = (rep) => ((rep.lines.find((l) => l.to === 'console') || rep.lines.find((l) => l.to === 'you') || rep.lines.find((l) => l.to === 'all') || {}).text || 'no reply');

// ---- load console.js ---------------------------------------------------------------------------------------------------
let ticker = null;
const fakeEvery = (name, ms, fn) => { ticker = fn; };
const audits = () => logs.filter((l) => l.startsWith('audit: ')).map((l) => l.slice(7));
const loadConsole = (cfg) => {
  delete require.cache[CONSOLE_JS];
  globalThis.__dboRunCommand = globalThis.__dboRunCommand || (() => null);
  return require(CONSOLE_JS)({ mp, log, audit: G.audit, every: fakeEvery, stopTimer: () => {}, cfg, commands: G.commands, handleLine: G.handleLine, findByName: G.findByName,
    tagOf: G.tagOf, profileOf: G.profileOf, discordOf: G.discordOf, userOf: G.userOf, display: G.display, who: G.who, staffTierFrom: G.staffTierFrom,
    staffTierOf: G.staffTierOf, TIER_LABEL: G.TIER_LABEL, TIER_RANK: G.TIER_RANK, captureFor: G.captureFor, onlineActors: online, gen: globalThis.__dboRunCommand,
    accountRank: G.accountRankOf, paths: { spool: SPOOL, key: KEY_FILE, switch: SWITCH_FILE }, now: () => clock });
};
const PINNED = { remoteConsole: { discordIds: [ID.jake, ID.nate, ID.gm, ID.trial, ID.lead] } };
const RC = loadConsole(PINNED);
const { rules } = require(CONSOLE_JS);
const reset = () => { kicked.length = 0; raceMenus.length = 0; staffLines.length = 0; chatWrites.length = 0; neverRan.length = 0; logs.length = 0; beastSent.length = 0; globalThis.__dboConsoleState.all = []; globalThis.__dboConsoleState.perProfile.clear(); };
// One request through one tick, and its reply
// The game's own limit (10 a minute per profile) is emptied before each, except where the limit itself is tested
const send = (text, o = {}) => {
  if (!o.keepLimits) { globalThis.__dboConsoleState.all = []; globalThis.__dboConsoleState.perProfile.clear(); }
  const r = drop(req(text, o)); ticker(); return { r, rep: readReply(r.id) };
};

// ---- 16. allow.json at the first tick, wwremote and vlremote (registered late by beastform.js) included --------------------
ticker();
const allow = JSON.parse(fs.readFileSync(path.join(SPOOL, 'allow.json'), 'utf8'));
check('16. allow.json is written at the first tick, 0600', (fs.statSync(path.join(SPOOL, 'allow.json')).mode & 0o777) === 0o600);
check('16. ...and lists the eleven commands, wwremote, vlremote, chars and unstuck included', allow.map((x) => x.name).sort().join() === 'chargen,chars,fixloc,kick,load,players,rename,unstuck,vlremote,whoami,wwremote', allow.map((x) => x.name));
check('16. ...each with its console usage and the registry help', allow.every((x) => x.usage.startsWith(`/${x.name}`) && typeof x.help === 'string'), allow[0]);

// ---- 1. signature and shape ----------------------------------------------------------------------------------------------
reset();
{
  const { rep } = send('/whoami');
  check('1. a good signature runs: /whoami answers "ran" with a verifiable reply', rep && rep.state === 'ran' && rep.sigOk, rep);
  check('1. ...as Jake #ABCD, online, senior', rep.ranAs === 'Jake #ABCD' && rep.online === true && rep.tier === 'senior', rep);
  for (const [label, tamper] of [['text', (r) => { r.text = '/kick #8KWH'; }], ['roles', (r) => { r.roles = [ROLE.owner, ROLE.dev]; }], ['user', (r) => { r.user = 'nate'; }],
    ['expiresAt', (r) => { r.expiresAt += 1; }], ['profileId', (r) => { r.profileId = 2; }], ['discordId', (r) => { r.discordId = ID.nate; }]]) {
    reset();
    const { rep: x } = send('/whoami', { tamper });
    check(`1. a changed ${label} is refused as bad, and nothing runs`, x && x.state === 'bad' && x.sigOk && !staffLines.length, x);
  }
  reset();
  const noSig = req('/whoami'); delete noSig.sig; drop(noSig); ticker();
  check('1. a missing sig is refused as bad', (readReply(noSig.id) || {}).state === 'bad');
  const wrongKey = req('/whoami', { sig: sign(req('/whoami'), crypto.randomBytes(32)) }); drop(wrongKey); ticker();
  check('1. a request signed with another key is refused', (readReply(wrongKey.id) || {}).state === 'bad');
  for (const [label, user] of [['a right-to-left override', `jake${RLO}`], ['a newline', 'jake\nGM Nate'], ['33 characters', 'a'.repeat(33)], ['a capital', 'Jake']]) {
    const r = req('/whoami', { user }); drop(r); ticker();
    check(`1. a user with ${label} is refused (signed or not)`, (readReply(r.id) || {}).state === 'bad', label);
  }
  const newline = req('/whoami\n/kick #8KWH'); drop(newline); ticker();
  check('1. text with a newline (not as the backend cleans it) is refused', (readReply(newline.id) || {}).state === 'bad' && !kicked.length);
  const colour = req('/whoami #{ff0000}'); drop(colour); ticker();
  check('1. text with a raw colour code is refused (the backend writes "# {")', (readReply(colour.id) || {}).state === 'bad');
  const fileId = `w-${uuid()}`; const wrongName = req('/whoami'); drop(wrongName, fileId); ticker();
  check('1. an id that differs from the file name is refused: bad under the file\'s id, nothing under the inner one, nothing runs',
    (readReply(fileId) || {}).state === 'bad' && readReply(wrongName.id) === null && !staffLines.length);
  const srcMix = req('/whoami', { id: `d-${'1'.repeat(19)}`, src: 'web' }); drop(srcMix); ticker();
  check('1. src web with a Discord id is refused', (readReply(srcMix.id) || {}).state === 'bad');
}

// ---- 2. time window, replay, claim -----------------------------------------------------------------------------------------
reset();
{
  const old = send('/whoami', { issuedAt: clock - 11000, expiresAt: clock - 1000 }).rep;
  check('2. an expired request is refused as expired, and nothing runs', old && old.state === 'expired' && !staffLines.length, old);
  const future = send('/whoami', { issuedAt: clock + 5000 }).rep;
  check('2. one from the future is refused as expired', future && future.state === 'expired', future);
  const long = send('/whoami', { expiresAt: clock + 60000 }).rep;
  check('2. a window over 10 s is refused as bad', long && long.state === 'bad', long);
  reset();
  const r = req('/kick #8KWH'); drop(r); ticker();
  const first = readReply(r.id);
  drop(r); ticker();
  check('2. the same id twice runs once: one kick, and the second write gets no reply', first && first.state === 'ran' && kicked.length === 1 && readReply(r.id) === null, { first, kicked });
  setOnline(A.bob, true); reset();
  const c = req('/kick #8KWH'); drop(c);
  fs.renameSync(path.join(IN, `${c.id}.json`), path.join(SCRATCH, 'taken.json')); // another reader claimed it first
  ticker();
  check('2. a file claimed by someone else is not run', !kicked.length && readReply(c.id) === null);
  check('2. a processed request leaves nothing in in/ or work/', !fs.readdirSync(IN).length && !fs.readdirSync(WORK).length, [fs.readdirSync(IN), fs.readdirSync(WORK)]);
}

// ---- 3. the caller --------------------------------------------------------------------------------------------------------
reset();
{
  let rep = send('/whoami').rep;
  check('3. online preferred: Jake #ABCD (online) over the lower id Jake Alt', rep.ranAs === 'Jake #ABCD' && rep.online === true, rep);
  check('3. a character of the same profile stamped with another Discord id is never the caller', rep.ranAs !== 'Not Jake #FRGN');
  check('3. an online caller sees the answer in game too', chatWrites.some(([id, l]) => id === A.jake && /Jake #ABCD {2}actor/.test(l)));
  chatWrites.length = 0;
  setOnline(A.jake, false);
  rep = send('/whoami').rep;
  check('3. offline: the character whose stamped tier matches the fresh one (Jake, senior) over the lowest id (Jake Alt, none)', rep.ranAs === 'Jake #ABCD' && rep.online === false, rep);
  store.get(A.jake)['private.discordRoles'] = [];
  rep = send('/whoami').rep;
  check('3. no stamp matches: the lowest id, and its stale stamp is refused (rolesChanged)', rep.ranAs === 'Jake Alt #JALT' && rep.why === 'rolesChanged', rep);
  store.get(A.jake)['private.discordRoles'] = [ROLE.owner];
  rep = send('/whoami', { discordId: ID.mallory }).rep;
  check('3. a Discord id that matches no character of the profile: not pinned here, so refused before any caller is chosen', rep.state === 'refused' && rep.why === 'notPinned', rep);
  rep = send('/whoami', { discordId: ID.nate, profileId: 1, roles: [ROLE.dev] }).rep;
  check('3. a pinned id with another account\'s profile: no character of that profile carries the id (noChar)', rep.state === 'refused' && rep.why === 'noChar', rep);
  rep = send('/whoami', { profileId: 77 }).rep;
  check('3. no character at all: refused with the console\'s reason', rep.why === 'noChar' && /Make one in game first/.test(rep.lines[0].text), rep);
  check('3. offline output is never written into the offline character\'s chat', !chatWrites.some(([id]) => id === A.jake || id === A.jakeAlt), chatWrites);
  setOnline(A.jake, true);
}

// ---- 4. tiers ---------------------------------------------------------------------------------------------------------------
reset();
{
  let rep = send('/whoami', { roles: [] }).rep;
  check('4. stamped senior with fresh none is refused (tier)', rep.why === 'tier' && !staffLines.length, rep);
  setOnline(A.jake, false);
  store.get(A.jake)['private.discordRoles'] = []; store.get(A.jakeAlt)['private.discordRoles'] = [];
  rep = send('/players').rep;
  check('4. stamped none with fresh senior is refused by the console (rolesChanged), before the gate', rep.why === 'rolesChanged' && !staffLines.length, rep);
  store.get(A.jake)['private.discordRoles'] = [ROLE.owner];
  setOnline(A.jake, true);
  // The gate itself, as defence in depth behind that rule: a remote line for a character with no admin tier
  const lines = []; const gate = G.captureFor(A.bob, false, () => G.handleLine(A.bob, '/kick #LLX8', G.userOf(A.bob), { remote: { src: 'web', id8: 'deadbeef' } }));
  check('4. ...and behind it the gate says "Admins only." to a remote line from a non-admin (refused, nothing kicked)', gate.result === 'refused' && gate.lines.some((l) => /Admins only\./.test(l.text)) && !kicked.length, gate);
  rep = send('/whoami', { discordId: ID.gm, profileId: 3, roles: [ROLE.owner] }).rep;
  check('4. stamped gm with fresh senior is refused (rolesChanged): a forged or stale "senior" cannot lift a GM', rep.why === 'rolesChanged', rep);
  const gm = G.captureFor(A.gm, true, () => G.handleLine(A.gm, '/wwremote clear #8KWH', -1, { remote: { src: 'discord', id8: '12345678' } }));
  check('4. ...and behind it LEAD_ONLY refuses /wwremote for a GM, posted with the remote tag', gm.result === 'refused' && staffLines.some((s) => /REFUSED \(Lead GM and above\) \[remote discord 12345678\]/.test(s.detail)), staffLines);
  // Jake, 14 Oct: "Jake, Nate and Lead GMs". The floor in code is Lead GM; a GM and a Trial GM stay out even when pinned
  staffLines.length = 0;
  rep = send('/whoami', { discordId: ID.trial, profileId: 4, roles: [ROLE.trial] }).rep;
  check('4. a pinned Trial GM is refused (tier), with the floor named', rep.why === 'tier' && /^The console is for Lead GM and above in game\.$/.test(header(rep)) && !staffLines.length, rep);
  rep = send('/whoami', { discordId: ID.gm, profileId: 3, roles: [ROLE.gm] }).rep;
  check('4. a pinned GM is refused (tier): GM is below the floor in code', rep.state === 'refused' && rep.why === 'tier' && rep.tier === 'gm' && !staffLines.length, rep);
  // Jake, 22 Oct: "Punishments only". A pinned Lead GM passes the floor, then runs /discipline and /kick only
  rep = send('/whoami', { discordId: ID.lead, profileId: 9, roles: [ROLE.lead] }).rep;
  check('4. a pinned Lead GM passes the floor (Leda, offline, tier leadgm), but /whoami is refused (punishOnly), with no #staff-commands line', rep.state === 'refused' && rep.why === 'punishOnly'
    && rep.tier === 'leadgm' && rep.online === false && header(rep) === 'A Lead GM can run only /discipline, /kick, /ban, /tempban, /unban, /giveitem, /takeitem, /givespell, /removespell, /unstuck and /fixloc from the console. Run anything else in game.' && !staffLines.length, rep);
  rep = send('/kick #8KWH', { discordId: ID.lead, profileId: 9, roles: [ROLE.lead] }).rep;
  check('4. ...and /kick #8KWH runs for her, with a #staff-commands line naming her Lead GM tier and the remote tag', rep.state === 'ran' && kicked.includes(store.get(A.bob).__user)
    && staffLines.some((l) => /^Leda #LEAD <@200000000000000008> \(Lead GM\): \/kick #8KWH +\[remote web [0-9a-f]{8}\]$/.test(l.detail)), [rep, staffLines]);
  // A Lead-GM command in game (LEAD_ONLY): refused for a Lead GM from the console, from the web and from Discord, and in a dry run
  staffLines.length = 0; store.get(A.bob)['private.wwBodyOff'] = { at: 1 };
  const leadWw = ['web', 'discord'].map((src) => send('/wwremote clear #8KWH', { discordId: ID.lead, profileId: 9, roles: [ROLE.lead], src }).rep)
    .concat([send('/wwremote clear #8KWH', { discordId: ID.lead, profileId: 9, roles: [ROLE.lead], mode: 'dry-run' }).rep]);
  check('4. a pinned Lead GM is refused the Lead-GM command /wwremote clear #8KWH (punishOnly) from the web, Discord and a dry run; the breaker stays, no staff line',
    leadWw.every((x) => x.state === 'refused' && x.why === 'punishOnly') && store.get(A.bob)['private.wwBodyOff'] !== null && !staffLines.length, leadWw);
  rep = send('/wwremote clear #8KWH', { discordId: ID.nate, profileId: 2, roles: [ROLE.dev], src: 'discord' }).rep;
  check('4. a Developer runs it: /wwremote clear #8KWH ran, the breaker is cleared', rep.state === 'ran' && rep.target === 'Bob #8KWH' && store.get(A.bob)['private.wwBodyOff'] === null
    && /werewolf body may be shown again/.test(header(rep)), rep);
  check('4. ...and it went through LEAD_ONLY as a Developer, not around it (staff line, no refusal)', staffLines.some((l) => /\(Developer\): \/wwremote clear #8KWH \[remote discord /.test(l.detail)) && !staffLines.some((l) => /REFUSED/.test(l.detail)), staffLines);
  // A Developer/Senior-only command in game (/schedule: updates.js may(), senior and developer only) is never run for a Lead GM
  neverRan.length = 0;
  rep = send('/schedule restart 30m test', { discordId: ID.lead, profileId: 9, roles: [ROLE.lead] }).rep;
  check('4. a pinned Lead GM is refused a Developer/Senior-only command (/schedule, punishOnly), and it never runs', rep.state === 'refused' && rep.why === 'punishOnly' && !neverRan.length, rep);
  // Promoted in Discord but stamped Lead GM: the lower tier counts until a login, so still punishments only
  rep = send('/whoami', { discordId: ID.lead, profileId: 9, roles: [ROLE.dev] }).rep;
  check('4. a Lead GM promoted to Developer in Discord, not yet stamped, is still refused /whoami (punishOnly)', rep.state === 'refused' && rep.why === 'punishOnly', rep);
  // A handler's own tier check (as updates.js and placement.js keep them) sees the Lead GM's real tier through the console
  const realLoad = G.commands.get('load'); const loadRan = [];
  G.commands.set('load', Object.assign({}, realLoad, { fn: (a) => { if ((G.TIER_RANK[G.tierOf(a)] || 0) < G.TIER_RANK.developer) return G.personal(a, 'That is for a Developer and above.'); loadRan.push(a); } }));
  rep = send('/load', { discordId: ID.lead, profileId: 9, roles: [ROLE.lead] }).rep;
  check('4. the console refuses the pinned Lead GM /load before its handler (punishOnly; nothing lifts her tier)', rep.why === 'punishOnly' && !loadRan.length, rep);
  rep = send('/load', { discordId: ID.nate, profileId: 2, roles: [ROLE.dev] }).rep;
  check('4. ...and lets a Developer through', loadRan.length === 1 && loadRan[0] === A.nate, rep);
  G.commands.set('load', realLoad);
  rep = send('/whoami', { discordId: ID.nate, profileId: 2, roles: [ROLE.dev] }).rep;
  check('4. a Developer passes (Nate, offline)', rep.state === 'ran' && rep.tier === 'developer' && rep.online === false, rep);
  for (const low of ['gm', 'trialgm', 'nonsense']) {
    loadConsole({ remoteConsole: Object.assign({}, PINNED.remoteConsole, { minTier: low }) });
    rep = send('/whoami', { discordId: ID.gm, profileId: 3, roles: [ROLE.gm] }).rep;
    const lead = send('/whoami', { discordId: ID.lead, profileId: 9, roles: [ROLE.lead] }).rep;
    check(`4. minTier "${low}" in config cannot lower the floor: a GM is still refused, a Lead GM still passes it (to the punishOnly rule)`, rep.why === 'tier' && lead.why === 'punishOnly', [rep, lead]);
  }
  rep = send('/whoami', { discordId: ID.trial, profileId: 4, roles: [ROLE.trial] }).rep;
  check('4. ...and a Trial GM is still refused', rep.why === 'tier', rep);
  loadConsole({ remoteConsole: Object.assign({}, PINNED.remoteConsole, { minTier: 'developer' }) });
  rep = send('/whoami', { discordId: ID.lead, profileId: 9, roles: [ROLE.lead] }).rep;
  check('4. minTier "developer" raises it: a Lead GM is refused, with the raised floor named', rep.why === 'tier' && /^The console is for Developer and above in game\.$/.test(header(rep)), rep);
  loadConsole({ remoteConsole: Object.assign({}, PINNED.remoteConsole, { minTier: 'senior' }) });
  rep = send('/whoami', { discordId: ID.nate, profileId: 2, roles: [ROLE.dev] }).rep;
  check('4. minTier "senior" raises it: a Developer is refused', rep.why === 'tier', rep);
  rep = send('/whoami').rep;
  check('4. ...and a Senior still passes', rep.state === 'ran', rep);
  loadConsole(PINNED);
}

// ---- 5. the game's pin ---------------------------------------------------------------------------------------------------------
reset();
{
  for (const [label, cfg] of [['missing', {}], ['empty', { remoteConsole: { discordIds: [] } }], ['malformed', { remoteConsole: { discordIds: ['jake'] } }], ['a number', { remoteConsole: { discordIds: [Number(ID.jake)] } }]]) {
    loadConsole(cfg);
    const rep = send('/whoami').rep;
    check(`5. a ${label} game pin is off`, rep.state === 'off' && !staffLines.length, rep);
  }
  loadConsole({ remoteConsole: { discordIds: [ID.nate] } });
  const rep = send('/whoami').rep;
  check('5. an id not on the game pin is refused (notPinned)', rep.why === 'notPinned', rep);
  loadConsole({ remoteConsole: { discordIds: [ID.jake], enabled: false } });
  check('5. enabled: false is off', send('/whoami').rep.state === 'off');
  loadConsole(PINNED);
}

// ---- 5b. the repo's gamemode-config.json carries the game pin (review R3; Jake's list, 14 Oct) ---------------------------------
// Every gameplay deploy writes the repo's gamemode-config.json over the live one (keeping only the live admins), so the block
// lives in the repo. Jake, Nate and the Lead GMs are on it and may use it; the pin grants nothing by itself (the tier rule,
// Lead GM and above, still applies)
reset();
{
  const repoCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
  const rc = repoCfg.remoteConsole || {};
  const D1 = ['234362720420364288', '262414676489535489', '274310050762326017', '279763097881935873', '297172235397890050', '358760034769043457', '457340616230174740', '536260882930466816'];
  check('5b. the repo config has the remoteConsole block: on, the eight pinned ids, floor leadgm (Jake, 14 Oct), nothing denied',
    rc.enabled === true && JSON.stringify(rc.discordIds) === JSON.stringify(D1) && rc.minTier === 'leadgm' && Array.isArray(rc.deny) && rc.deny.length === 0, rc);
  check('5b. ...and nothing in it that console.js does not read (besides a comment)', Object.keys(rc).every((k) => ['_comment', 'enabled', 'discordIds', 'minTier', 'deny'].includes(k)), Object.keys(rc));
  logs.length = 0;
  loadConsole(repoCfg);
  // Eleven since /discipline came onto the allowlist (Jake, 21 Oct; tests/console-punish-harness.js holds its rule); nineteen since
  // the Dragon Baron rows of 28 Oct (/unstuck /giveitem /takeitem /givespell /removespell, rule itemSpells; 81925ca17)
  check('5b. console.js loads the repo config as a game pin of 8, floor leadgm, all nineteen commands (fourteen, and the five Dragon Baron rows of 28 Oct)', logs.some((l) => /console: reader on .*, 19 commands, floor leadgm, game pin 8$/.test(l)), logs);
  const owner = actor(0xff000d01, { name: 'Jacob', tag: 'JKOW', profile: 21, discord: D1[0], roles: [ROLE.owner] });
  const leadOnly = actor(0xff000d02, { name: 'Icara', tag: 'ICED', profile: 22, discord: D1[2], roles: [ROLE.lead] });
  let rep = send('/whoami', { discordId: D1[0], profileId: 21, user: 'jake', roles: [ROLE.owner] }).rep;
  check('5b. a pinned Owner runs as their own character while offline (Jake, 14 Oct: "Yes, as my character")', rep.state === 'ran' && rep.ranAs === 'Jacob #JKOW' && rep.online === false, rep);
  // /chargen, not /fixloc: since 28 Oct a bare /fixloc is itemSpells' badArgs (section 6), no longer 'self'
  rep = send('/chargen', { discordId: D1[0], profileId: 21, user: 'jake', roles: [ROLE.owner] }).rep;
  check('5b. ...and a form that would act on that character is refused with a clear message', rep.state === 'refused' && rep.why === 'self' && /acts on your own character\. Run it in game\./.test(header(rep)), rep);
  rep = send('/fixloc', { discordId: D1[0], profileId: 21, user: 'jake', roles: [ROLE.owner] }).rep;
  check('5b. ...and a bare /fixloc is refused with its usage (it names whom, 28 Oct)', rep.state === 'refused' && rep.why === 'badArgs' && header(rep) === 'From the console: /fixloc <#TAG|name>', rep);
  staffLines.length = 0;
  rep = send('/whoami', { discordId: D1[2], profileId: 22, user: 'icedsky', roles: [ROLE.lead] }).rep;
  check('5b. a pinned Lead GM passes on the repo config (Jake, 14 Oct: "Jake, Nate and Lead GMs"), as her own character, tier leadgm, but /whoami is punishOnly (22 Oct)',
    rep.state === 'refused' && rep.why === 'punishOnly' && rep.ranAs === 'Icara #ICED' && rep.tier === 'leadgm' && !staffLines.length, rep);
  store.get(A.lydia)['private.wwBodyOff'] = { at: 1 };
  rep = send('/wwremote clear #LLX8', { discordId: D1[2], profileId: 22, user: 'icedsky', roles: [ROLE.lead], src: 'discord' }).rep;
  check('5b. ...and so is the Lead-GM command /wwremote clear #LLX8: the breaker stays', rep.state === 'refused' && rep.why === 'punishOnly' && store.get(A.lydia)['private.wwBodyOff'] !== null, rep);
  rep = send('/kick #LLX8', { discordId: D1[2], profileId: 22, user: 'icedsky', roles: [ROLE.lead], src: 'discord' }).rep;
  check('5b. ...while /kick #LLX8 runs for her', rep.state === 'ran' && kicked.includes(store.get(A.lydia).__user) && staffLines.some((l) => /\(Lead GM\): \/kick #LLX8 +\[remote discord /.test(l.detail)), [rep, staffLines]);
  // One of the eight demoted to GM in Discord (and stamped GM at the next login): the pin is not a right
  const demoted = actor(0xff000d03, { name: 'Dunn', tag: 'DUNN', profile: 23, discord: D1[6], roles: [ROLE.gm] });
  staffLines.length = 0;
  rep = send('/whoami', { discordId: D1[6], profileId: 23, user: 'dunthril', roles: [ROLE.gm] }).rep;
  check('5b. a pinned account that is only a GM is refused (tier): the pin is not a right', rep.state === 'refused' && rep.why === 'tier' && !staffLines.length, rep);
  rep = send('/whoami', { discordId: D1[6], profileId: 23, user: 'dunthril', roles: [ROLE.trial] }).rep;
  check('5b. ...and so is one that is only a Trial GM', rep.state === 'refused' && rep.why === 'tier' && !staffLines.length, rep);
  rep = send('/whoami').rep;
  check('5b. an id that is not on the repo pin is refused (notPinned)', rep.why === 'notPinned', rep);
  store.delete(owner); store.delete(leadOnly); store.delete(demoted);
  loadConsole(PINNED);
}

// ---- 6. the allowlist and its argument rules ----------------------------------------------------------------------------------
reset();
{
  const passes = ['/wwremote', '/wwremote on', '/wwremote off', '/wwremote clear #8KWH', '/vlremote', '/vlremote clear #8kwh', '/kick #8KWH', '/fixloc #8KWH', '/unstuck #8KWH',
    '/unstuck #8KWH hub', '/unstuck #8KWH respawn ticket:481', '/unstuck Bob hub', '/unstuck Bob #8KWH hub ticket:12', '/fixloc Bob', '/fixloc Bob #8KWH', '/rename #8KWH Bobby', '/chargen #8KWH', '/players', '/load', '/load reset', '/whoami'];
  const bad = [];
  for (const t of passes) { const rep = send(t, { mode: 'dry-run' }).rep; if (!rep || rep.state !== 'dry-run') bad.push([t, rep && rep.state, rep && rep.why]); }
  check('6. every allowed form passes every check (dry run)', !bad.length, bad);
  const refusals = [
    ['/kick', 'needTag'], ['/fixloc', 'badArgs'], ['/chargen', 'self'], ['/unstuck', 'badArgs'], ['/unstuck #8KWH hub <@1>', 'badWord'], ['/unstuck @everyone', 'badWord'],
    ['/unstuck #8KWH hub **x**', 'badWord'], ['/fixloc Bob <@1>', 'badWord'], ['/kick Bob', 'needTag'], ['/kick Bob #8KWH', 'needTag'], ['/kick me', 'needTag'],
    ['/kick 5', 'needTag'], ['/kick ff000b01', 'needTag'], ['/rename Bob Bobby', 'needTag'], ['/rename #8KWH', 'badArgs'], ['/rename #8KWH B0b', 'badName'],
    ['/wwremote clear', 'needTag'], ['/wwremote clear Bob', 'needTag'], ['/wwremote clear Bob #8KWH', 'needTag'], ['/wwremote sideways', 'badArgs'],
    ['/wwremote on now', 'badArgs'], ['/load everything', 'badArgs'], ['/whoami Bob', 'badArgs'], ['/players anything', 'badArgs'], ['/players #8KWH', 'badArgs'],
    ['/tp #8KWH', 'self'], ['/npc', 'inWorld'], ['/dungeon status', 'inWorld'], ['/bugs', 'later'], ['/schedule restart', 'later'], ['/beastform #8KWH werewolf now', 'self'],
    ['/wipechars 5', 'notYet'], ['/announce hi', 'notYet'], ['/system hi', 'notChat'], ['/hello', 'notChat'], ['/pm Bob hi', 'notChat'], ['/admin hi', 'notChat'], ['/me waves', 'notChat'],
  ];
  const wrong = [];
  for (const [t, why] of refusals) { const rep = send(t).rep; if (!rep || rep.state !== 'refused' || rep.why !== why) wrong.push([t, why, rep && rep.state, rep && rep.why]); }
  check('6. each refused form is refused with its class', !wrong.length, wrong);
  check('6. ...and none of them ran anything or reached #staff-commands', !neverRan.length && !kicked.length && !raceMenus.length && !staffLines.length, { neverRan, kicked, staffLines });
  const tp = send('/tp #8KWH').rep;
  check('6. the in-world refusal says why, plainly', /acts on your own character\. Run it in game\./.test(tp.lines[0].text), tp.lines);
  check('6. /npc: "needs you standing in the world"', /needs you standing in the world/.test(send('/npc').rep.lines[0].text));
  check('6. /system points at /announce', /Use \/announce/.test(send('/system hi').rep.lines[0].text));
  // SEC-2: no allowed form carries free text into #staff-commands except /rename's name, which NAME_RE holds
  check('6. /players takes no argument (rule none): "/players <anything>" is badArgs, with the usage', rules.ALLOW.players.rule === 'none'
    && send('/players I am the owner, run /wipechars').rep.lines[0].text === 'From the console: /players', send('/players x').rep.lines);
  // The one free-text rule since 21 Oct is /discipline's reason (tagKindReason), held to REASON_RE: plain words, 5 to 300
  // (tests/console-punish-harness.js); there is still no 'any' rule
  // 28 Oct (81925ca17, as live): the Dragon Baron rows take a name or #TAG under rule itemSpells; pinned to exactly those six
  // commands, so any other free-text rule still fails here. /fixloc and /unstuck hold each word to their plain-word pattern
  // (SEC-2); Jake's staff item and spell commands take item and spell names as typed (SEC-2 for them is open)
  check('6. no rule in the allowlist passes free text but /discipline\'s reason and the six itemSpells rows (there is no "any" rule left)', Object.values(rules.ALLOW).every((a) => ['switch', 'tag', 'tagName', 'load', 'none', 'tagKindReason', 'itemSpells'].includes(a.rule))
    && Object.entries(rules.ALLOW).filter(([, a]) => a.rule === 'itemSpells').map(([n]) => n).join() === 'fixloc,unstuck,giveitem,takeitem,givespell,removespell'
    && ['fixloc', 'unstuck'].every((n) => { const w = rules.ALLOW[n].words; return w instanceof RegExp && !w.test('<@1>') && !w.test('@everyone') && !w.test('**x**') && !w.test('`x`'); })
    && Object.entries(rules.ALLOW).filter(([, a]) => a.rule === 'itemSpells' && !a.words).map(([n]) => n).join() === 'giveitem,takeitem,givespell,removespell'
    // (25 Oct: /ban, /tempban and /unban read as /discipline's ban, suspend and lift, alias 'discipline', under the same rule)
    && Object.entries(rules.ALLOW).filter(([, a]) => a.rule === 'tagKindReason').map(([n]) => n).join() === 'discipline,ban,tempban,unban'
    && ['ban', 'tempban', 'unban'].every((n) => rules.ALLOW[n].alias === 'discipline')
    && !/case 'any'/.test(fs.readFileSync(CONSOLE_JS, 'utf8')), Object.values(rules.ALLOW).map((a) => a.rule));
  loadConsole({ remoteConsole: Object.assign({}, PINNED.remoteConsole, { deny: ['kick'] }) });
  check('6. gamemode-config deny narrows it: /kick is denied', send('/kick #8KWH').rep.why === 'denied' && !kicked.length);
  loadConsole(PINNED);
}

// ---- 7. the target ------------------------------------------------------------------------------------------------------------
reset();
{
  setOnline(A.bob, false);
  check('G1. findByName("") with one player online is nobody (it was that player)', G.findByName('') === 0);
  check('G1. findByName("#ZZZZ") (a tag nobody online carries) is nobody', G.findByName('#ZZZZ') === 0 && G.findByName('#8KWH') === 0);
  setOnline(A.jake, false);
  check('G1. ...even with only one undisguised player online (Lydia)', online().length === 1 && G.findByName('#8KWH') === 0 && G.findByName('') === 0);
  check('G1. a real name, a unique prefix, a profile id and an actor id still resolve', G.findByName('Lydia') === A.lydia && G.findByName('lyd') === A.lydia
    && G.findByName('6') === A.lydia && G.findByName(A.lydia.toString(16)) === A.lydia && G.findByName('#LLX8') === A.lydia);
  const before = JSON.stringify(store.get(A.lydia));
  const offline = ['/kick #8KWH', '/rename #8KWH Bobby', '/chars #8KWH', '/chargen #8KWH', '/fixloc #8KWH', '/unstuck #8KWH', '/wwremote clear #8KWH', '/kick #8KWJ'];
  // /rename, /chars, /fixloc and /unstuck may name an offline character, found in the tag index; with none there they are
  // refused as targetAny
  const hit = offline.map((t) => [t, send(t).rep]).filter(([t, rep]) => !rep || rep.why !== (/^\/(rename|chars|fixloc|unstuck) /.test(t) ? 'targetAny' : 'target'));
  check('7. with #8KWH offline and one undisguised player online, each targeted form is refused as target', !hit.length, hit.map(([t, r]) => [t, r && r.why]));
  check('7. ...and nobody was kicked, renamed, moved or cleared', !kicked.length && !raceMenus.length && JSON.stringify(store.get(A.lydia)) === before);
  check('7. the reply says the tag is not online', /#8KWH is not online/.test(send('/kick #8KWH').rep.lines[0].text));
  setOnline(A.bob, true); setOnline(A.jake, true); reset();
  const dry = send('/kick #8KWH', { mode: 'dry-run' }).rep;
  check('7. dry run names the target and kicks nobody', dry.state === 'dry-run' && dry.target === 'Bob #8KWH' && !kicked.length, dry);
  const k = send('/kick #8kwh').rep;
  check('7. with the tag online the handler acts on that player (a lower-case tag matches)', k.state === 'ran' && kicked.length === 1 && kicked[0] === store.get(A.bob).__user && k.target === 'Bob #8KWH', { k, kicked });
  setOnline(A.bob, true);
  store.get(A.lydia)['private.charTag'] = '8KWH';
  check('7. a tag two online players carry is refused as tagShared', send('/kick #8KWH').rep.why === 'tagShared');
  store.get(A.lydia)['private.charTag'] = 'LLX8';
  globalThis.__dboBeastOriginalRace = (t) => ((t >>> 0) === A.bob ? 0x13746 : 0);
  const beast = send('/chargen #8KWH').rep;
  check('7. /chargen on a player in a beast form is refused (beast)', beast.why === 'beast' && !raceMenus.length && /beast form/.test(beast.lines[0].text), beast);
  globalThis.__dboBeastOriginalRace = () => 0;
  const cg = send('/chargen #8KWH').rep;
  check('7. /chargen #8KWH opens it for Bob, and Bob is told who opened it', cg.state === 'ran' && raceMenus[0] === A.bob && chatWrites.some(([id, l]) => id === A.bob && /Jake opened character creation for you/.test(l)), cg);
}

// ---- 8. the gate is the same code ---------------------------------------------------------------------------------------------
reset();
{
  const viaChat = []; const viaLine = [];
  const bobUser = store.get(A.bob).__user;
  chatWrites.length = 0; G.handleChat(bobUser, '/kick #LLX8'); viaChat.push(...chatWrites.map(([, l]) => l.split(String.fromCharCode(31))[1]));
  chatWrites.length = 0; G.handleLine(A.bob, '/kick #LLX8', bobUser); viaLine.push(...chatWrites.map(([, l]) => l.split(String.fromCharCode(31))[1]));
  check('8. handleChat and handleLine give the same refusal for the same actor and text', viaChat.length === 1 && JSON.stringify(viaChat) === JSON.stringify(viaLine) && /Admins only/.test(viaChat[0]), { viaChat, viaLine });
  check('8. typed chat returns nothing new to its callers (handleChat is a wrapper)', G.handleChat(bobUser, 'hello') === undefined);
  chatWrites.length = 0;
  check('8. a remote line never reaches speech: plain text from a remote caller is "unknown", nothing said', G.handleLine(A.jake, 'hello there', 1, { remote: { src: 'web', id8: 'x' } }) === 'unknown' && !chatWrites.length);
  check('8. ...nor /pm, /system, /admin or a bare /', ['/pm Bob hi', '/system hi', '/admin hi', '/'].every((t) => G.handleLine(A.jake, t, 1, { remote: { src: 'web', id8: 'x' } }) === 'unknown') && !chatWrites.length);
  check('8. the same text typed in chat by Jake still speaks (typed chat is unchanged)', (G.handleChat(store.get(A.jake).__user, '/system hi'), chatWrites.length > 0));
}

// ---- 9. the staff line ----------------------------------------------------------------------------------------------------------
reset();
{
  const p = send('/players').r; const w = send('/whoami').r;
  const tag = (r) => `[remote web ${rules.id8(r.id)}]`;
  check('9. a remote /players writes a #staff-commands line with the remote tag', staffLines.some((s) => s.what === '/players' && s.detail.endsWith(tag(p))), staffLines);
  check('9. a remote /whoami does too (both are registered without admin)', staffLines.some((s) => s.what === '/whoami' && s.detail.endsWith(tag(w))), staffLines);
  check('9. the line names the character and the Discord account', staffLines.every((s) => /^Jake #ABCD <@200000000000000001> \(Senior\): \//.test(s.detail)), staffLines);
  reset(); send('/players', { mode: 'dry-run' }); send('/wwremote clear #8KWH', { mode: 'dry-run' });
  check('9. a dry run writes none', !staffLines.length, staffLines);
  reset(); const d = send('/whoami', { src: 'discord' }).r;
  check('9. a Discord one is tagged discord with the last 8 digits of the interaction id', staffLines.length === 1 && staffLines[0].detail.endsWith(`[remote discord ${d.id.slice(-8)}]`), staffLines);
  // Typed, a command registered without admin writes none; /players is admin since Nate's 16 Oct change (players learn who is
  // about by meeting them), so typed it writes one as every staff command does: /whoami is the one without admin now
  reset(); G.handleChat(store.get(A.jake).__user, '/whoami');
  check('9. typed /whoami (registered without admin) still writes no staff line (unchanged)', !staffLines.length, staffLines);
}

// ---- 10. the capture ------------------------------------------------------------------------------------------------------------
reset();
{
  const cap = G.captureFor(A.jakeAlt, true, () => {
    G.personal(A.jakeAlt, 'p-line'); G.system(A.jakeAlt, 's-line'); G.staffSay(A.jakeAlt, 'a-line'); G.deliver(A.jakeAlt, 'raw-line');
    G.broadcast('[[S]]all-line'); G.broadcast('[[A]]staff-line', true); G.audit('audit-line'); G.personal(A.bob, 'not-mine');
  });
  const got = cap.lines.map((l) => `${l.to}:${rules.plainLine(l.text)}`);
  check('10. personal, system, staffSay, a direct line, a broadcast, an admin-tab broadcast and an audit line are kept, in order',
    JSON.stringify(got) === JSON.stringify(['you:p-line', 'you:s-line', 'you:a-line', 'you:raw-line', 'all:all-line', 'staff:staff-line', 'audit:audit-line']), got);
  check('10. a line to another player is not kept, and still reaches them', !got.some((l) => /not-mine/.test(l)) && chatWrites.some(([id, l]) => id === A.bob && /not-mine/.test(l)));
  check('10. an offline (quiet) caller gets no ff_chatMsg write', !chatWrites.some(([id]) => id === A.jakeAlt), chatWrites.filter(([id]) => id === A.jakeAlt));
  chatWrites.length = 0;
  const on = G.captureFor(A.jake, false, () => { G.broadcast('[[S]]hello all'); G.personal(A.jake, 'to-me'); });
  check('10. an online caller\'s copy of a broadcast is kept once (as all), and the caller still sees it in game', on.lines.filter((l) => /hello all/.test(l.text)).length === 1 && on.lines[0].to === 'all'
    && chatWrites.some(([id, l]) => id === A.jake && /hello all/.test(l)) && chatWrites.some(([id, l]) => id === A.jake && /to-me/.test(l)), on.lines);
  const prev = globalThis.__dboTellCapture;
  let threw = false; try { G.captureFor(A.jake, true, () => { throw new Error('boom'); }); } catch (e) { threw = true; }
  check('10. the capture is restored after a throw', threw && globalThis.__dboTellCapture === prev);
  const j = { a: A.jake >>> 0, lines: [], quiet: true }; globalThis.__dboTellCapture = j;
  G.personal(A.jake, 'journal'); G.system(A.jake, 'system-line'); globalThis.__dboTellCapture = prev;
  check('10. __dboRunCommand\'s capture (no all) still takes personal lines only, as strings', JSON.stringify(j.lines) === '["journal"]', j.lines);
  reset(); setOnline(A.jake, false);
  const k = send('/kick #LLX8').rep;
  check('10. /kick answers with a broadcast and an audit line only: an offline caller still sees both', k.state === 'ran' && k.lines.some((l) => l.to === 'all' && /was kicked by Jake/.test(l.text))
    && k.lines.some((l) => l.to === 'audit' && /kicked Lydia #LLX8/.test(l.text)) && !chatWrites.some(([id]) => id === A.jake), k.lines);
  check('10. reply lines carry no client markup', k.lines.every((l) => !/\[\[|#\{/.test(l.text)), k.lines);
  setOnline(A.jake, true); setOnline(A.lydia, true);
}

// ---- 11. dry run --------------------------------------------------------------------------------------------------------------
reset();
{
  const rep = send('/wwremote clear #8KWH', { mode: 'dry-run' }).rep;
  check('11. dry run: the gate passes, the handler and staffLog do not run', rep.state === 'dry-run' && rep.gate === 'dry' && !staffLines.length && !beastSent.length && !audits().some((l) => /cleared the werewolf/.test(l)), rep);
  check('11. ...the REMOTE audit line still says what would run, marked dry run', audits().some((l) => /^REMOTE web req \w{8} jake <@200000000000000001> as Jake #ABCD .* on Bob #8KWH \(dry run\): \/wwremote clear #8KWH$/.test(l)), audits());
  setSwitch('dry-run\n'); reset();
  const sw = send('/kick #8KWH').rep;
  check('11. the switch at dry-run forces a dry run whatever the request says', sw.state === 'dry-run' && !kicked.length, sw);
  setSwitch('on\n');
}

// ---- 7b. offline characters by #TAG: /rename and /chars (staff suggestion, aussiepie 9 Oct) ----------------------------------
reset();
{
  // The engine's tag index, as indexName writes it: the lower-case tag of every character
  mp.findFormsByPropertyValue = (k, v) => (k === 'private.indexed.tagKey' ? [...store].filter(([, o]) => String(o['private.charTag'] || '').toLowerCase() === v).map(([id]) => id) : []);
  const alt = actor(0xff000b02, { name: 'Bobette', tag: 'BOB2', profile: 5, discord: ID.bob });
  setOnline(A.bob, false);
  const chars = send('/chars #8KWH').rep;
  const text = chars.lines.map((l) => l.text).join(' | ');
  check('7b. /chars #8KWH with Bob offline lists both characters of his account with their tags', chars.state === 'ran' && chars.target === 'Bob #8KWH' && /2 characters/.test(text) && /Bob #8KWH/.test(text) && /Bobette #BOB2/.test(text), chars);
  check('7b. ...and no other account\'s character', !/Lydia|Jake/.test(text), text);
  const rn = send('/rename #BOB2 Roberta').rep;
  check('7b. /rename #BOB2 renames the offline character that carries it', rn.state === 'ran' && rn.target === 'Bobette #BOB2' && store.get(alt).appearance.name === 'Roberta' && store.get(A.bob).appearance.name === 'Bob', rn);
  check('7b. ...with the rename\'s own audit line', audits().some((l) => /renamed "Bobette" -> "Roberta"/.test(l)), audits());
  check('7b. /kick #8KWH with Bob offline is still refused as target (only /rename, /chars, /fixloc and /unstuck reach offline characters)', send('/kick #8KWH').rep.why === 'target');
  check('7b. ...and so are /chargen and /wwremote clear', send('/chargen #8KWH').rep.why === 'target' && send('/wwremote clear #8KWH').rep.why === 'target' && !raceMenus.length);
  store.get(alt)['private.charTag'] = '8KWH';
  const dup = send('/rename #8KWH Bobby').rep;
  check('7b. a tag two offline characters carry is refused (tagShared), nobody renamed', dup.why === 'tagShared' && store.get(A.bob).appearance.name === 'Bob' && /More than one character carries #8KWH/.test(header(dup)), dup);
  store.get(alt)['private.charTag'] = 'BOB2';
  globalThis.__dboFormGone = (id) => (id >>> 0) === alt;
  check('7b. a deleted character in the index is not a target', send('/rename #BOB2 Robin').rep.why === 'targetAny' && store.get(alt).appearance.name === 'Roberta');
  globalThis.__dboFormGone = undefined;
  for (const [t, why] of [['/chars', 'needTag'], ['/chars Bob', 'needTag'], ['/chars #8KWH #BOB2', 'needTag']]) check(`7b. ${t} is refused as ${why}`, send(t).rep.why === why);
  // The typed /rename in game: a typed #TAG binds, never a name prefix of someone else online
  setOnline(A.bob, true); reset();
  G.commands.get('rename').fn(A.jake, 'Lyd #ZZZZ Lyddie');
  check('7b. typed /rename "Lyd #ZZZZ" (tag nobody carries) renames nobody, not the online Lydia', store.get(A.lydia).appearance.name === 'Lydia');
  setOnline(A.bob, false);
  G.commands.get('rename').fn(A.jake, 'Bob #BOB2 Robyn');
  check('7b. typed /rename "Bob #BOB2" renames the offline Bobette, by her tag', store.get(alt).appearance.name === 'Robyn' && store.get(A.bob).appearance.name === 'Bob');
  setOnline(A.bob, true);
  store.delete(alt); delete mp.findFormsByPropertyValue;
}

// ---- 7c. typed /fixloc: an offline character by #TAG or name, a typed #TAG binds (Neem #LBRF, Jake 28 Oct; C's review) ------
reset();
{
  // The engine's indexes, as indexName writes them: the lower-case tag and own name of every character
  mp.findFormsByPropertyValue = (k, v) => [...store].filter(([, o]) => (k === 'private.indexed.tagKey' ? String(o['private.charTag'] || '').toLowerCase() === v
    : k === 'private.indexed.nameKey' ? String((o.appearance || {}).name || '').toLowerCase() === v : false)).map(([id]) => id);
  const neem = actor(0xff000d01, { name: 'Neem', tag: 'LBRF', profile: 97 });
  const neema = actor(0xff000d02, { name: 'Neema', tag: 'NMA1', profile: 98, online: true });
  const twin = actor(0xff000d03, { name: 'Neem', tag: 'NNN2', profile: 99, online: true });
  store.get(neem).worldOrCellDesc = '6ca03:BSHeartland.esm'; store.get(neem).pos = [77.4, -12.2, -65.9];
  const fix = (args) => { for (const id of [neem, neema, twin, A.lydia]) if (store.get(id)) delete store.get(id).locationalData; G.commands.get('fixloc').fn(A.jake, args); };
  const moved = () => [neem, neema, twin, A.lydia].filter((id) => store.get(id) && store.get(id).locationalData).map((id) => G.display(id));
  const told = () => (chatWrites.filter(([id]) => id === A.jake).slice(-1)[0] || [])[1] || '';
  fix('Neem #LBRF');
  check('7c. "/fixloc Neem #LBRF" with Neema and another Neem online moves the offline Neem #LBRF only', moved().join() === 'Neem #LBRF', moved());
  check('7c. ...to the hub', (store.get(neem).locationalData || {}).cellOrWorldDesc === '17482:DragonBreak Hub.esp');
  check('7c. ...with an UNSTUCK audit line naming where it was, offline, and the staff member', audits().some((l) => /^UNSTUCK Neem #LBRF \(profile 97\) from 6ca03:BSHeartland\.esm at 77,-12,-66 to the hub \(offline\) by staff Jake #ABCD .*via \/fixloc$/.test(l)), audits().slice(-2));
  check('7c. ...and the reply names the character with its tag, offline and where it was', /Moved Neem #LBRF \(offline, was in 6ca03:BSHeartland\.esm\) to the hub/.test(told()), told());
  fix('Neem #ZZZZ');
  check('7c. "/fixloc Neem #ZZZZ" (a tag nobody carries) moves nobody, not Neem #LBRF nor an online Neem', moved().length === 0, moved());
  check('7c. ...and says it cannot, so the player log marks it refused', /Cannot move #ZZZZ/.test(told()), told());
  fix('Lydia #LBRF');
  check('7c. "/fixloc Lydia #LBRF" binds the tag: the offline #LBRF carrier, never the online Lydia', moved().join() === 'Neem #LBRF', moved());
  fix('#LBRF');
  check('7c. the bare tag "/fixloc #LBRF" moves Neem #LBRF', moved().join() === 'Neem #LBRF', moved());
  const dup = actor(0xff000d04, { name: 'Neem Two', tag: 'LBRF', profile: 96 });
  fix('#LBRF');
  check('7c. a tag two characters carry moves nobody', moved().length === 0, moved());
  store.delete(dup);
  // a bare name still loses to an online prefix match (findByName first, as before); with nobody online it is ambiguous
  setOnline(twin, false); setOnline(neema, false);
  fix('Neem');
  check('7c. a bare name two offline characters share moves nobody (add their #TAG)', moved().length === 0 && /Cannot move Neem: 2 characters/.test(told()), [moved(), told()]);
  store.delete(twin);
  fix('Neem');
  check('7c. a unique bare name finds the offline Neem', moved().join() === 'Neem #LBRF', moved());
  setOnline(neema, true);
  fix('Lydia');
  check('7c. an online character moves as before', moved().join() === 'Lydia #LLX8', moved());
  // 7d. staff /unstuck names its target with the same lookup (staffTargetOf), the real one here
  const neema2 = actor(0xff000d05, { name: 'Neem', tag: 'NNN3', profile: 95, online: true });
  check('7d. staffTargetOf "Neem #LBRF" with an online namesake is the offline Neem #LBRF', G.staffTargetOf(A.jake, 'Neem #LBRF') === neem);
  check('7d. staffTargetOf "Lydia #LBRF" is the #LBRF carrier, never Lydia', G.staffTargetOf(A.jake, 'Lydia #LBRF') === neem);
  check('7d. staffTargetOf "Neem #ZZZZ" is nobody, and says it cannot', G.staffTargetOf(A.jake, 'Neem #ZZZZ') === 0 && /Cannot move #ZZZZ/.test(told()), told());
  store.delete(neema2);
  store.delete(neem); store.delete(neema); delete mp.findFormsByPropertyValue;
}

// ---- 7e. the remote console's /fixloc and /unstuck on an OFFLINE character, by #TAG only (Jake, 28 Oct: "Yes, allow it"), and
// /unstuck as the Dragon Baron's Unstuck form sends it: '/unstuck <#TAG|Name> <hub|respawn> [ticket:N]' ------------------------
reset();
{
  mp.findFormsByPropertyValue = (k, v) => [...store].filter(([, o]) => (k === 'private.indexed.tagKey' ? String(o['private.charTag'] || '').toLowerCase() === v
    : k === 'private.indexed.nameKey' ? String((o.appearance || {}).name || '').toLowerCase() === v : false)).map(([id]) => id);
  const neem = actor(0xff000d01, { name: 'Neem', tag: 'LBRF', profile: 97 });
  const HUB = '17482:DragonBreak Hub.esp', TEMPLE = 'a764b:BSHeartland.esm';
  const where = () => { for (const id of [neem, A.lydia, A.jake]) { const o = store.get(id); delete o.locationalData; } const o = store.get(neem); o.worldOrCellDesc = '6ca03:BSHeartland.esm'; o.pos = [77.4, -12.2, -65.9]; };
  const at = (id) => (store.get(id).locationalData || {}).cellOrWorldDesc || '';
  const unstuckLines = () => audits().filter((l) => l.startsWith('UNSTUCK '));
  const req8 = (r) => (r.id.startsWith('w-') ? r.id.slice(2, 10) : r.id.slice(-8));
  where();
  let { r, rep } = send('/fixloc #LBRF');
  check('7e. remote "/fixloc #LBRF" with Neem offline runs on Neem: to the hub, the caller stays', rep.state === 'ran' && rep.target === 'Neem #LBRF' && at(neem) === HUB && !at(A.jake), rep);
  check('7e. ...its UNSTUCK line says offline, the staff character, /fixloc and the remote console with who sent it and the request',
    unstuckLines().some((l) => new RegExp(`^UNSTUCK Neem #LBRF \\(profile 97\\) from 6ca03:BSHeartland\\.esm at 77,-12,-66 to the hub \\(offline\\) by staff Jake #ABCD .*via /fixloc from the remote console \\(web, jake, req ${req8(r)}\\)$`).test(l)), audits());
  check('7e. ...after the REMOTE line of the same request', audits().some((l) => l.startsWith(`REMOTE web req ${req8(r)} jake `) && / on Neem #LBRF: \/fixloc #LBRF$/.test(l)), audits());
  check('7e. ...and the console reply says offline, where it was and the next login', /Moved Neem #LBRF \(offline, was in 6ca03:BSHeartland\.esm\) to the hub; they arrive there at their next login/.test(header(rep)), header(rep));

  // The form's exact strings (dragonbaronCommand.js: `/unstuck ${target} ${dest || 'hub'}${ticket ? ` ${ticket}` : ''}`), from Discord
  const D = { src: 'discord' };
  const form = (target, dest, ticket) => `/unstuck ${target} ${dest || 'hub'}${ticket ? ` ${ticket}` : ''}`;
  where(); reset();
  ({ r, rep } = send(form('#LBRF', 'hub', ''), D));
  check('7e. form "/unstuck #LBRF hub", Neem offline: Neem to the hub, the caller stays', rep.state === 'ran' && rep.target === 'Neem #LBRF' && at(neem) === HUB && !at(A.jake), rep);
  check('7e. ...UNSTUCK line: offline, via /unstuck, from the remote console (discord) and who sent it',
    unstuckLines().some((l) => new RegExp(`^UNSTUCK Neem #LBRF \\(profile 97\\) from 6ca03:BSHeartland\\.esm at 77,-12,-66 to the hub \\(offline\\) by staff Jake #ABCD .*via /unstuck from the remote console \\(discord, jake, req ${req8(r)}\\)$`).test(l)), unstuckLines());
  check('7e. ...the reply says they arrive at their next login, and Neem is told nothing', /Moved Neem #LBRF \(offline, was in .*\) to the hub; they arrive there at their next login/.test(header(rep)) && !chatWrites.some(([id]) => id === neem), header(rep));
  where(); reset();
  ({ r, rep } = send(form('#LBRF', 'respawn', 'ticket:481'), D));
  check('7e. form "/unstuck #LBRF respawn ticket:481", Neem offline: Neem to the temple, the caller stays', rep.state === 'ran' && at(neem) === TEMPLE && !at(A.jake), rep);
  check('7e. ...UNSTUCK line: offline, the ticket, then the remote console',
    unstuckLines().some((l) => new RegExp(`^UNSTUCK Neem #LBRF \\(profile 97\\) from "6ca03:BSHeartland\\.esm" at 77,-12,-66 to the bruma respawn by staff Jake #ABCD .*, offline \\(ticket:481\\) from the remote console \\(discord, jake, req ${req8(r)}\\)$`).test(l)), unstuckLines());
  check('7e. ...the reply says they wake at the temple at their next login', /Neem #LBRF \(offline, was in .*\) will wake at the bruma respawn at their next login/.test(header(rep)), header(rep));
  check('7e. ...and a staff line for #staff-commands, tagged remote', staffLines.some((x) => /\/unstuck #LBRF respawn ticket:481 \[remote discord \d{8}\]$/.test(x.detail)), staffLines);
  where(); reset();
  ({ r, rep } = send(form('#LBRF', 'hub', 'ticket:#481'), D));
  check('7e. form "/unstuck #LBRF hub ticket:#481": the hub, and the ticket in the audit line as ticket:481', at(neem) === HUB && unstuckLines().some((l) => / via \/unstuck \(ticket:481\) from the remote console /.test(l)), unstuckLines());
  where(); reset();
  ({ r, rep } = send(form('Neem #LBRF', 'hub', 'ticket:12'), D));
  check('7e. form "/unstuck Neem #LBRF hub ticket:12": the tag binds, Neem to the hub with the ticket', rep.state === 'ran' && at(neem) === HUB && unstuckLines().some((l) => /^UNSTUCK Neem #LBRF .* via \/unstuck \(ticket:12\) from the remote console /.test(l)), [header(rep), unstuckLines()]);
  // The form's ticket box as staff have filled it (14:29Z log: '/unstuck Neem hub No ticket', '... hub N/a')
  where(); reset();
  ({ r, rep } = send(form('#LBRF', 'hub', 'No ticket'), D));
  check('7e. form "/unstuck #LBRF hub No ticket": Neem to the hub; "No ticket" is left out of the audit line, and said so', at(neem) === HUB
    && unstuckLines().length === 1 && !/No ticket/.test(unstuckLines()[0]) && rep.lines.some((l) => /Left out, not a ticket:<id> or call:<n>: No ticket/.test(l.text)), [unstuckLines(), rep.lines]);
  check('7e. ...and the move is the reply\'s first line', /^Moved Neem #LBRF/.test(header(rep)), header(rep));
  // A bare name: online, it is found as typed in game; offline, the console asks for the #TAG
  where(); reset();
  ({ r, rep } = send(form('Neem', 'hub', ''), D));
  check('7e. form "/unstuck Neem hub" with Neem offline moves nobody and asks for the #TAG', !at(neem) && !at(A.jake) && /Cannot move Neem #LBRF: they are offline, and from the console an offline character is named by its #TAG/.test(header(rep)) && !unstuckLines().length, header(rep));
  ({ r, rep } = send(form('Neem', 'respawn', 'ticket:481'), D));
  check('7e. ...and "/unstuck Neem respawn ticket:481" the same', !at(neem) && /they are offline, and from the console an offline character is named by its #TAG/.test(header(rep)), header(rep));
  where(); reset();
  ({ r, rep } = send(form('Lydia', 'hub', ''), D));
  check('7e. form "/unstuck Lydia hub" with Lydia online: Lydia to the hub, told who brought her', rep.state === 'ran' && at(A.lydia) === HUB && !at(A.jake)
    && chatWrites.some(([id, l]) => id === A.lydia && /Jake .*brings you to the DragonBreak Hub/.test(l)) && unstuckLines().some((l) => /^UNSTUCK Lydia #LLX8 .* to the hub \(online\) by staff Jake #ABCD .* via \/unstuck from the remote console /.test(l)), [header(rep), unstuckLines()]);
  where(); reset();
  ({ r, rep } = send(form('#LLX8', 'respawn', 'ticket:9'), D));
  check('7e. form "/unstuck #LLX8 respawn ticket:9" with Lydia online: Lydia to the temple, told, the ticket in the line', at(A.lydia) === TEMPLE
    && chatWrites.some(([id, l]) => id === A.lydia && /brings you back to safety/.test(l)) && unstuckLines().some((l) => /^UNSTUCK Lydia #LLX8 .* to the bruma respawn by staff Jake #ABCD \(profile 1, <@\d+>\) \(ticket:9\) from the remote console /.test(l)), unstuckLines());
  where(); reset();
  ({ r, rep } = send('/unstuck #LBRF hub ticket:481', Object.assign({ mode: 'dry-run' }, D)));
  check('7e. a dry run of the form names Neem and moves nobody', rep.state === 'dry-run' && rep.target === 'Neem #LBRF' && !at(neem) && !unstuckLines().length, rep);
  // Refused: a tag nobody or two carry, words that are not plain, and every other targeted command on an offline one
  where(); reset();
  ({ r, rep } = send('/fixloc Neem', D));
  check('7e. "/fixloc Neem" with Neem offline moves nobody and asks for the #TAG', !at(neem) && /Cannot move Neem #LBRF: they are offline, and from the console an offline character is named by its #TAG/.test(header(rep)), header(rep));
  ({ r, rep } = send('/fixloc Neem #LBRF', D));
  check('7e. "/fixloc Neem #LBRF": the tag binds, Neem to the hub', rep.state === 'ran' && at(neem) === HUB, header(rep));
  where(); reset();
  const refused = [['/unstuck #ZZZZ hub', 'targetAny'], ['/fixloc #ZZZZ', 'targetAny'],
    ['/unstuck #LBRF hub <@1>', 'badWord'], ['/kick #LBRF', 'target'], ['/chargen #LBRF', 'target'], ['/wwremote clear #LBRF', 'target'],
    ['/tp #LBRF', 'self'], ['/beastform #LBRF werewolf', 'self']];
  const wrong = refused.map(([t, why]) => [t, why, send(t, D).rep]).filter(([, why, rep]) => !rep || rep.state !== 'refused' || rep.why !== why).map(([t, why, rep]) => [t, why, rep && rep.why]);
  check('7e. a tag nobody carries, a word that is not plain and the other targeted commands on offline Neem are refused, each with its class', !wrong.length, wrong);
  const dup = actor(0xff000d04, { name: 'Neem Two', tag: 'LBRF', profile: 96 });
  const shared = ['/fixloc #LBRF', '/unstuck #LBRF hub', '/unstuck #LBRF respawn ticket:4'].map((t) => send(t, D).rep.why);
  check('7e. a tag two offline characters carry is refused (tagShared)', shared.join() === 'tagShared,tagShared,tagShared', shared);
  const sharedNamed = send('/unstuck Neem #LBRF hub', D).rep;
  check('7e. ..."Name #TAG" with that tag moves nobody either, and says so', /Cannot move #LBRF/.test(header(sharedNamed)), header(sharedNamed));
  check('7e. ...and nothing ran: nobody moved, kicked or reopened, no UNSTUCK line', !at(neem) && !at(dup) && !at(A.jake)
    && !kicked.length && !raceMenus.length && !neverRan.length && !unstuckLines().length, audits());
  store.delete(dup);
  // The rank and permission check is the game's: since 28 Oct a Lead GM may run /fixloc and /unstuck (PUNISH_ONLY), and the
  // in-game right is the handler's
  const lead = { discordId: ID.lead, profileId: 9, user: 'leda', roles: [ROLE.lead], src: 'discord' };
  ({ r, rep } = send('/unstuck #LBRF hub ticket:3', lead));
  check('7e. a Lead GM runs the form too: Neem to the hub, the line names her and the console', rep.state === 'ran' && rep.tier === 'leadgm' && at(neem) === HUB
    && unstuckLines().some((l) => new RegExp(`by staff Leda #LEAD .* via /unstuck \\(ticket:3\\) from the remote console \\(discord, leda, req ${req8(r)}\\)$`).test(l)), [rep, unstuckLines()]);
  check('7e. ...and a GM is still refused at the floor (tier)', send('/unstuck #LBRF hub', { discordId: ID.gm, profileId: 3, user: 'gemma', roles: [ROLE.gm], src: 'discord' }).rep.why === 'tier');
  where(); reset();
  globalThis.__dboStaffGuard = { rightOk: (a, what) => what !== 'unstuck', command: () => null };
  const noRight = send('/unstuck #LBRF hub', D).rep;
  check('7e. without the unstuck right the remote /unstuck moves nobody, never the caller instead', !at(neem) && !at(A.jake) && /Cannot move another character: \/unstuck on someone else is for staff/.test(header(noRight)), noRight);
  delete globalThis.__dboStaffGuard;
  // Typed in game: a bare name finds an offline character as before, the place and ticket work the same, no remote words
  where(); reset();
  G.commands.get('unstuck').fn(A.jake, 'Neem');
  check('7e. typed in game, "/unstuck Neem" (offline) sends Neem to the temple, with no remote words', at(neem) === TEMPLE && unstuckLines().some((l) => /^UNSTUCK Neem #LBRF .* by staff Jake #ABCD .*, offline$/.test(l)), unstuckLines());
  where(); reset();
  G.commands.get('unstuck').fn(A.jake, 'Neem hub ticket:7');
  check('7e. typed in game, "/unstuck Neem hub ticket:7": the hub, the ticket, no remote words', at(neem) === HUB && unstuckLines().some((l) => / via \/unstuck \(ticket:7\)$/.test(l)), unstuckLines());
  // A player keeps their own /unstuck through the gate (the live staffitemspells.js /unstuck, admin only, took it away at 05:53Z)
  where(); reset();
  const bobUser = store.get(A.bob).__user;
  G.handleLine(A.bob, '/unstuck', bobUser);
  check('7e. a player\'s own "/unstuck" passes the gate and sends them to the temple', at(A.bob) === TEMPLE && unstuckLines().some((l) => /^UNSTUCK Bob #8KWH .* to the bruma respawn$/.test(l))
    && !chatWrites.some(([id, l]) => id === A.bob && /Admins only/.test(l)), [unstuckLines(), chatWrites.filter(([id]) => id === A.bob)]);
  delete store.get(A.bob).locationalData; store.get(A.bob)['private.unstuckAt'] = 0; reset();
  G.handleLine(A.bob, '/unstuck Lydia hub', bobUser);
  check('7e. ...and a player naming someone else still only moves themselves', !at(A.lydia) && at(A.bob) === TEMPLE, [at(A.lydia), at(A.bob)]);
  delete store.get(A.bob).locationalData; store.get(A.bob)['private.unstuckAt'] = 0;
  // C's review (28 Oct): with Neema #NMA1 online beside the offline Neem #LBRF. The console checks the first #TAG a line names
  // and the lookup binds the last, so a line with two is refused before anyone moves; and a typed #TAG binds in /unstuck as in
  // /fixloc, never the online name it starts like
  const neema = actor(0xff000d06, { name: 'Neema', tag: 'NMA1', profile: 98, online: true });
  const both = () => [at(neem), at(neema), at(A.jake)].join('|');
  where(); delete store.get(neema).locationalData; reset();
  for (const t of ['/fixloc #NMA1 #LBRF', '/unstuck #NMA1 #LBRF hub', '/unstuck Neem #NMA1 #LBRF respawn ticket:5']) {
    ({ r, rep } = send(t, D));
    check(`7e. "${t}" (two #TAGs) moves nobody and says to name one`, both() === '||' && /name one character, with one #TAG/.test(header(rep)), [both(), header(rep)]);
  }
  G.commands.get('fixloc').fn(A.jake, '#NMA1 #LBRF');
  check('7e. ...typed in game the same', both() === '||', both());
  ({ r, rep } = send(form('Neem #LBRF', 'hub', ''), D));
  check('7e. form "/unstuck Neem #LBRF hub" with Neema online moves Neem #LBRF, never Neema', at(neem) === HUB && !at(neema), [both(), header(rep)]);
  where(); delete store.get(neema).locationalData; reset();
  G.commands.get('unstuck').fn(A.jake, 'Neem #LBRF');
  check('7e. typed "/unstuck Neem #LBRF" with Neema online sends Neem #LBRF to the temple, never Neema', at(neem) === TEMPLE && !at(neema), both());
  where(); delete store.get(neema).locationalData;
  ({ r, rep } = send('/fixloc Neem #LBRF', D));
  check('7e. remote "/fixloc Neem #LBRF" with Neema online moves Neem #LBRF, never Neema', at(neem) === HUB && !at(neema), both());
  store.delete(neema);
  store.delete(neem); delete mp.findFormsByPropertyValue;
}

// ---- 7f. the review of 28 Oct: /unstuck reads a name that holds Hub, Respawn or Temple (S2), a tag one online and one offline
// character carry is refused (S5), '_' in a ticket and a bad word named (RC-8), staff are told of a dead or bound target (U5),
// a staff move tells downed.js (U7) and the hub move from /unstuck is logged as an unstuck (U9) ----------------------------
reset();
{
  mp.findFormsByPropertyValue = (k, v) => [...store].filter(([, o]) => (k === 'private.indexed.tagKey' ? String(o['private.charTag'] || '').toLowerCase() === v
    : k === 'private.indexed.nameKey' ? String((o.appearance || {}).name || '').toLowerCase() === v : false)).map(([id]) => id);
  const HUB = '17482:DragonBreak Hub.esp', TEMPLE = 'a764b:BSHeartland.esm';
  const neem = actor(0xff000f01, { name: 'Neem', tag: 'LBRF', profile: 97 });
  const anna = actor(0xff000f02, { name: 'Anna', tag: 'ANN1', profile: 101, online: true });
  const annaT = actor(0xff000f03, { name: 'Anna Temple', tag: 'ANT1', profile: 102, online: true });
  const ralof = actor(0xff000f04, { name: 'Ralof Temple', tag: 'RT01', profile: 103 });
  const ids = [neem, anna, annaT, ralof, A.lydia, A.jake];
  const where = () => { for (const id of ids) delete store.get(id).locationalData; for (const id of [neem, ralof]) { const o = store.get(id); o.worldOrCellDesc = '6ca03:BSHeartland.esm'; o.pos = [77, -12, -66]; } };
  const at = (id) => (store.get(id).locationalData || {}).cellOrWorldDesc || '';
  const moved = () => ids.filter((id) => at(id)).map((id) => `${G.display(id)}@${at(id) === HUB ? 'hub' : at(id) === TEMPLE ? 'temple' : at(id)}`).join(',');
  const told = () => ((chatWrites.filter(([id]) => id === A.jake).slice(-1)[0] || [])[1] || '').split('|').slice(1).join('|');
  const typed = (args) => { where(); reset(); G.commands.get('unstuck').fn(A.jake, args); return moved(); };
  const D = { src: 'discord' };
  const remote = (text) => { where(); reset(); const { rep } = send(text, D); return [moved(), header(rep), rep]; };
  // S2: a name that holds a place word
  // Verification of a0d5517b9: with Anna and Anna Temple both live, 'Anna Temple [place]' reads two ways (the form's target 'Anna'
  // with place 'temple' and the ticket box, or the name 'Anna Temple'), so nobody moves; the #TAG picks one
  check('7f. typed "/unstuck Anna Temple" with Anna live moves nobody and asks for the #TAG', typed('Anna Temple') === '' && /2 characters could be meant; add the #TAG/.test(told()), [moved(), told()]);
  check('7f. typed "/unstuck Anna Temple hub" the same', typed('Anna Temple hub') === '' && /could be meant/.test(told()), [moved(), told()]);
  check('7f. typed "/unstuck Anna Temple #ANT1 hub" sends Anna Temple to the hub', typed('Anna Temple #ANT1 hub') === 'Anna Temple #ANT1@hub', moved());
  check('7f. typed "/unstuck Anna hub" sends Anna to the hub', typed('Anna hub') === 'Anna #ANN1@hub', moved());
  check('7f. typed "/unstuck #ANT1 respawn ticket:9" the temple, and the ticket in the line', typed('#ANT1 respawn ticket:9') === 'Anna Temple #ANT1@temple'
    && audits().some((l) => /^UNSTUCK Anna Temple #ANT1 .* by staff Jake #ABCD .*\(ticket:9\)$/.test(l)), audits());
  let [m, h] = remote('/unstuck Ralof Temple #RT01 hub');
  check('7f. remote "/unstuck Ralof Temple #RT01 hub" (offline, a name with Temple in it): Ralof Temple to the hub', m === 'Ralof Temple #RT01@hub', [m, h]);
  [m, h] = remote('/unstuck Ralof Temple #RT01');
  check('7f. ...and with no place, the temple', m === 'Ralof Temple #RT01@temple', [m, h]);
  [m, h] = remote('/unstuck #LBRF bruma');
  check('7f. an unknown word where the place goes moves nobody: "Unknown place bruma: hub or respawn"', m === '' && h === 'Unknown place bruma: hub or respawn.', [m, h]);
  [m, h] = remote('/unstuck hub #LBRF');
  check('7f. a place typed first gets the usage, nobody moves', m === '' && /^Usage: \/unstuck <player\|#TAG> \[hub\|respawn\]/.test(h), [m, h]);
  check('7f. ...typed in game the same', typed('hub #LBRF') === '' && /^Usage: \/unstuck/.test(told()), told());
  // Verification of 67de9db92 (28 Oct): a name before a place word is that name, never a longer online one it begins (F1); a
  // name that starts with Hub, Respawn or Temple binds with its #TAG, a place word typed first gets the usage (F2)
  // the Dragon Baron form, as dragonbaronCommand.js builds the line
  const form = (target, dest, ticket) => `/unstuck ${target} ${dest || 'hub'}${ticket ? ` ${ticket}` : ''}`;
  const extra = [actor(0xff000f11, { name: 'Anna Hubbard', tag: 'AHB1', profile: 111, online: true }), actor(0xff000f12, { name: 'Al', tag: 'AL01', profile: 112, online: true }),
    actor(0xff000f13, { name: 'Al Hubert', tag: 'ALHB', profile: 113, online: true }), actor(0xff000f14, { name: 'Lydia Respawnsen', tag: 'LRS1', profile: 114, online: true }),
    actor(0xff000f15, { name: 'Hub', tag: 'HUB1', profile: 115 }), actor(0xff000f16, { name: 'Respawn', tag: 'RSP1', profile: 116 }),
    actor(0xff000f17, { name: 'Temple Guard', tag: 'TG01', profile: 117 })];
  ids.push(...extra);
  check('7f. F1: typed "/unstuck Anna hub" with Anna Hubbard online sends Anna to the hub, never Anna Hubbard', typed('Anna hub') === 'Anna #ANN1@hub', moved());
  [m, h] = remote(form('Anna', 'hub', ''));
  check('7f. F1: ...the form "/unstuck Anna hub" the same', m === 'Anna #ANN1@hub', [m, h]);
  check('7f. F1: typed "/unstuck Lydia respawn" with Lydia Respawnsen online sends Lydia to the temple', typed('Lydia respawn') === 'Lydia #LLX8@temple', moved());
  [m, h] = remote(form('Al', '', ''));
  check('7f. F1: the form "/unstuck Al hub" with Al Hubert online sends Al to the hub', m === 'Al #AL01@hub', [m, h]);
  // C's rows (set3 review): Bob with Bob Hubert online, Ivar with Ivar Templeton online
  const bobH = actor(0xff000f18, { name: 'Bob Hubert', tag: 'BHB1', profile: 118, online: true });
  const ivar = actor(0xff000f19, { name: 'Ivar', tag: 'IVR0', profile: 119, online: true });
  const ivarT = actor(0xff000f1a, { name: 'Ivar Templeton', tag: 'IVT1', profile: 120, online: true });
  ids.push(A.bob, bobH, ivar, ivarT);
  check('7f. F1: typed "/unstuck Bob hub" with Bob Hubert online sends Bob to the hub', typed('Bob hub') === 'Bob #8KWH@hub', moved());
  [m, h] = remote(form('Bob', 'hub', 'ticket:7'));
  check('7f. F1: ...the form "/unstuck Bob hub ticket:7" the same', m === 'Bob #8KWH@hub', [m, h]);
  check('7f. F1: typed "/unstuck Ivar temple" with Ivar Templeton online sends Ivar to the temple', typed('Ivar temple') === 'Ivar #IVR0@temple', moved());
  for (const x of [bobH, ivar, ivarT]) store.delete(x);
  ids.splice(ids.indexOf(A.bob), 4);
  for (const [t, want] of [['/unstuck Hub #HUB1', 'Hub #HUB1@temple'], ['/unstuck Respawn #RSP1 hub', 'Respawn #RSP1@hub'], ['/unstuck Temple Guard #TG01', 'Temple Guard #TG01@temple'],
    ['/unstuck Temple #TG01 hub', 'Temple Guard #TG01@hub']]) {
    [m, h] = remote(t);
    check(`7f. F2: "${t}" binds the tag (a place word in the carrier's own name)`, m === want, [m, h]);
  }
  for (const t of ['/unstuck hub #LBRF', '/unstuck respawn #LBRF hub', '/unstuck hub #ALHB']) {
    [m, h] = remote(t);
    check(`7f. F2: "${t}" (a place word first, not in the carrier's name) moves nobody and gets the usage`, m === '' && /^Usage: \/unstuck/.test(h), [m, h]);
  }
  // Verification of a0d5517b9 (28 Oct): an exact name beats an online prefix (V1); a #TAG after the place, own or glued, never
  // binds (V2); a line two characters could be read as moves nobody (V3); a place typed first never prefix-matches (V4)
  const vx = [actor(0xff000f18, { name: 'Neema', tag: 'NMV1', profile: 118, online: true }), actor(0xff000f19, { name: 'Anna Hub', tag: 'AHV1', profile: 119, online: true }),
    actor(0xff000f1a, { name: 'Templeton', tag: 'TPV1', profile: 120, online: true })];
  ids.push(...vx);
  [m, h] = remote(form('Neem', 'hub', ''));
  check('7f. V1: the form "/unstuck Neem hub" (Neem offline, Neema online) moves nobody and asks for the #TAG', m === '' && /Cannot move Neem #LBRF: they are offline/.test(h), [m, h]);
  check('7f. V1: ...typed in game it moves Neem, never Neema', typed('Neem hub') === 'Neem #LBRF@hub', moved());
  check('7f. V1: typed "/unstuck Neem" the same, to the temple', typed('Neem') === 'Neem #LBRF@temple', moved());
  [m, h] = remote(form('Lydia', 'hub', 'see #HUB1'));
  check('7f. V2: a #TAG in the form ticket box ("see #HUB1", a carrier called Hub) moves nobody', m === '' && /put the place after the #TAG/.test(h), [m, h]);
  [m, h] = remote(form('Lydia', 'hub', 'Ticket#LBRF'));
  check('7f. V2: ...nor a glued one ("Ticket#LBRF")', m === '' && /put the place after the #TAG/.test(h), [m, h]);
  check('7f. V2: typed "hub#LBRF" gets the usage', typed('hub#LBRF') === '' && /^Usage: \/unstuck/.test(told()), told());
  check('7f. V2: typed "Temple Guard#TG01 hub" binds the glued tag', typed('Temple Guard#TG01 hub') === 'Temple Guard #TG01@hub', moved());
  [m, h] = remote(form('Anna', 'hub', ''));
  check('7f. V3: the form "/unstuck Anna hub" with Anna Hub online moves nobody, never Anna Hub to a temple', m === '' && /2 characters could be meant/.test(h), [m, h]);
  [m, h] = remote(form('Anna', 'hub', 'ticket:5'));
  check('7f. V3: ...with a ticket the same', m === '' && /could be meant/.test(h), [m, h]);
  [m, h] = remote(form('#AHV1', 'hub', ''));
  check('7f. V3: ...and its #TAG moves Anna Hub to the hub', m === 'Anna Hub #AHV1@hub', [m, h]);
  check('7f. V3: typed "Anna Temple bruma" moves nobody, never Anna', typed('Anna Temple bruma') === '' && /could be meant/.test(told()), [moved(), told()]);
  check('7f. V4: typed "temple Respawn" (a place first, Templeton online) gets the usage', typed('temple Respawn') === '' && /^Usage: \/unstuck/.test(told()), [moved(), told()]);
  for (const x of vx) store.delete(x);
  ids.splice(ids.length - vx.length, vx.length);
  for (const x of extra) store.delete(x);
  ids.splice(ids.length - extra.length, extra.length);
  // S5: one online and one offline character carry a tag
  const ghost = actor(0xff000f05, { name: 'Ghost', tag: 'LLX8', profile: 104 });
  [m, h] = remote('/unstuck Ghost #LLX8 hub');
  check('7f. "Ghost #LLX8 hub" with Lydia online and Ghost offline both carrying #LLX8 moves nobody, never Lydia', m === '' && /Cannot move #LLX8: no live character carries that tag, or more than one does/.test(h), [m, h]);
  where(); reset(); G.commands.get('fixloc').fn(A.jake, '#LLX8');
  check('7f. ...typed "/fixloc #LLX8" the same', moved() === '' && /Cannot move #LLX8/.test(told()), [moved(), told()]);
  [m, h] = remote('/fixloc #LLX8');
  check('7f. ...and the console refuses it itself (tagShared)', m === '' && /More than one character carries #LLX8/.test(h), [m, h]);
  store.delete(ghost);
  check('7f. with Ghost gone, "/fixloc #LLX8" moves Lydia', (() => { where(); reset(); G.commands.get('fixloc').fn(A.jake, '#LLX8'); return moved(); })() === 'Lydia #LLX8@hub', moved());
  // C's review: a place word typed before the #TAG is refused unless it is part of the carrier's own name; a tag glued to a word
  // counts as a second tag
  const neema = actor(0xff000f06, { name: 'Neema', tag: 'NMA1', profile: 98, online: true });
  ids.push(neema);
  [m, h] = remote('/unstuck Neem hub #LBRF');
  check('7f. "/unstuck Neem hub #LBRF" with Neema online moves nobody (not Neema, nor Neem to a temple) and says to put the place after the #TAG',
    m === '' && h === 'Cannot move Neem hub #LBRF: put the place after the #TAG, as /unstuck #LBRF hub.', [m, h]);
  check('7f. ...typed in game the same', typed('Neem hub #LBRF') === '' && /put the place after the #TAG/.test(told()), told());
  [m, h] = remote('/unstuck Ralof Temple #RT01 hub');
  check('7f. ...while "Temple" in the carrier\'s own name ("Ralof Temple #RT01 hub") is no place word', m === 'Ralof Temple #RT01@hub', [m, h]);
  for (const t of ['/fixloc #LBRF x#NMA1', '/unstuck #LBRF x#NMA1 hub', '/fixloc Neema#NMA1 #LBRF', '/fixloc #LBRF ticket:#ANN1']) {
    [m, h] = remote(t);
    check(`7f. "${t}" (a second tag glued to a word) moves nobody and says to name one`, m === '' && /name one character, with one #TAG/.test(h), [m, h]);
  }
  [m, h] = remote('/fixloc Neema#NMA1');
  check('7f. ...while one glued tag alone still binds it ("Neema#NMA1")', m === 'Neema #NMA1@hub', [m, h]);
  store.delete(neema); ids.pop();
  // RC-8: '_' in a ticket passes the console; a bad word is named, made harmless
  let rep;
  [m, h, rep] = remote('/unstuck #LBRF hub ticket:gm_4');
  check('7f. "ticket:gm_4" passes the console and reaches the line', m === 'Neem #LBRF@hub' && audits().some((l) => / via \/unstuck \(ticket:gm_4\) from the remote console /.test(l)), [m, h, rep.why]);
  [m, h, rep] = remote('/unstuck #LBRF hub <@1>');
  check('7f. a word that is not plain is named (its other characters as ?), with the usage, and nobody moves', m === '' && rep.why === 'badWord'
    && h === '"??1?" is not a word the console takes for /unstuck (letters, digits and \' # : / . _ - only). From the console: /unstuck <#TAG|name> [hub|respawn] [ticket:<id>]', [m, h]);
  // U5: staff are told whom, and the hub
  store.get(neem).isDead = true;
  check('7f. staff "/unstuck #LBRF" of a dead offline Neem: nobody moves, staff are told whom and the hub way', typed('#LBRF') === ''
    && told() === 'Cannot move Neem #LBRF to a temple while they are dead; once they are up, /unstuck #LBRF hub or /fixloc #LBRF moves them to the hub.', told());
  // ...nor the hub while they are down: the wake would undo it (C's review, 28 Oct); /fixloc is unchanged
  check('7f. ...and "/unstuck #LBRF hub" while they are down moves nobody: wait until they are up', typed('#LBRF hub') === ''
    && told() === 'Cannot move Neem #LBRF to the hub while they are down; once they are up (at most a minute), /unstuck #LBRF hub moves them.', told());
  [m, h] = remote('/unstuck #LBRF hub ticket:4');
  check('7f. ...the form the same', m === '' && /^Cannot move Neem #LBRF to the hub while they are down; once they are up/.test(h), [m, h]);
  where(); reset(); G.commands.get('fixloc').fn(A.jake, '#LBRF');
  check('7f. ...while /fixloc is unchanged: it moves them (Jake)', moved() === 'Neem #LBRF@hub', moved());
  // a Trial GM is not pointed to /fixloc (admins only); they keep the hub move (Jake, 28 Oct)
  setOnline(A.trial, true); where(); reset();
  G.commands.get('unstuck').fn(A.trial, '#LBRF');
  const trialTold = ((chatWrites.filter(([id]) => id === A.trial).slice(-1)[0] || [])[1] || '').split('|').slice(1).join('|');
  check('7f. ...a Trial GM is told the hub way only, without /fixloc', moved() === '' && trialTold === 'Cannot move Neem #LBRF to a temple while they are dead; once they are up, /unstuck #LBRF hub moves them to the hub.', trialTold);
  setOnline(A.trial, false);
  store.get(neem).isDead = false; store.get(neem)['private.restrained'] = { boundHands: true };
  check('7f. ...bound: the same, "restrained or carried"', typed('#LBRF') === '' && /^Cannot move Neem #LBRF to a temple while they are restrained or carried; /.test(told()), told());
  delete store.get(neem)['private.restrained'];
  // U7 and U9: a staff move tells downed.js; the hub move from /unstuck is logged as an unstuck, from /fixloc as a fixloc
  const staffMoves = [], hooks = [], prevHook = globalThis.__dboPlogHook;
  globalThis.__dboDownedStaffMoved = (x) => staffMoves.push(x >>> 0);
  // (the player log runs every command through its hook: 'command' calls it on)
  globalThis.__dboPlogHook = (...x) => { if (x[0] === 'command') return x[2].call(x[3], x[4], x[5], x[6]); if (x[0] === 'travel') hooks.push([x[1] >>> 0, x[2]]); };
  try {
    typed('#LBRF hub'); typed('#LBRF respawn'); where(); G.commands.get('fixloc').fn(A.jake, '#LBRF');
    check('7f. each staff move (hub, temple, /fixloc) tells downed.js, so a late crash note cannot undo it', staffMoves.length === 3 && staffMoves.every((x) => x === neem), staffMoves);
    check('7f. the player log hears "unstuck" for both /unstuck moves and "fixloc" for /fixloc', JSON.stringify(hooks.map((x) => x[1])) === '["unstuck","unstuck","fixloc"]', hooks);
    staffMoves.length = 0; where(); reset(); store.get(A.bob)['private.unstuckAt'] = 0;
    G.handleLine(A.bob, '/unstuck', store.get(A.bob).__user);
    check('7f. a player\'s own /unstuck does not (it is no staff move)', at(A.bob) === TEMPLE && !staffMoves.length, staffMoves);
  } finally { globalThis.__dboPlogHook = prevHook; delete globalThis.__dboDownedStaffMoved; delete store.get(A.bob).locationalData; store.get(A.bob)['private.unstuckAt'] = 0; }
  for (const id of [neem, anna, annaT, ralof]) store.delete(id);
  delete mp.findFormsByPropertyValue;
}

// ---- 7g. staff /unstuck refuses a prisoner, online or offline, typed or from the console, whatever the place (Jake, 28 Oct:
// "Yes, refuse prisoners"); jail.js's __dboJailSentence decides from the saved sentence (tests/jail-harness.js), stubbed here.
// /fixloc and a player's own /unstuck are unchanged ------------------------------------------------------------------------
reset();
{
  mp.findFormsByPropertyValue = (k, v) => [...store].filter(([, o]) => (k === 'private.indexed.tagKey' ? String(o['private.charTag'] || '').toLowerCase() === v
    : k === 'private.indexed.nameKey' ? String((o.appearance || {}).name || '').toLowerCase() === v : false)).map(([id]) => id);
  const HUB = '17482:DragonBreak Hub.esp', TEMPLE = 'a764b:BSHeartland.esm';
  const neem = actor(0xff000f21, { name: 'Neem', tag: 'LBRF', profile: 97 });
  const anna = actor(0xff000f22, { name: 'Anna', tag: 'ANN1', profile: 101, online: true });
  const ids = [neem, anna, A.lydia, A.jake, A.bob];
  const jailed = new Set(), concordat = new Set();
  // (whether the caller gets Release at the door is jail.js's lawfulAt; Lead GM and above always do, here)
  globalThis.__dboJailSentence = (x, by) => (jailed.has(x >>> 0) ? { cell: 'Bruma Castle Dungeon', release: G.isLeadStaff(by), concordat: concordat.has(x >>> 0) } : null);
  const where = () => { for (const id of ids) delete store.get(id).locationalData; const o = store.get(neem); o.worldOrCellDesc = '6c410:BSHeartland.esm'; o.pos = [-100, 0, 0]; };
  const at = (id) => (store.get(id).locationalData || {}).cellOrWorldDesc || '';
  const moved = () => ids.filter((id) => at(id)).map((id) => `${G.display(id)}@${at(id) === HUB ? 'hub' : at(id) === TEMPLE ? 'temple' : at(id)}`).join(',');
  const toldTo = (who) => ((chatWrites.filter(([id]) => id === who).slice(-1)[0] || [])[1] || '').split('|').slice(1).join('|');
  const typed = (by, args) => { where(); reset(); G.commands.get('unstuck').fn(by, args); return [moved(), toldTo(by)]; };
  const remote = (text) => { where(); reset(); const { rep } = send(text, { src: 'discord' }); return [moved(), header(rep), rep]; };
  const NEEM_HELD = 'Cannot move Neem #LBRF: they are serving a sentence in Bruma Castle Dungeon; release them first at their cell door (activate it, then Release).';
  jailed.add(neem); jailed.add(A.lydia);
  let m, h;
  for (const t of ['/unstuck #LBRF hub ticket:12', '/unstuck #LBRF respawn', '/unstuck #LBRF temple ticket:3', '/unstuck #LBRF']) {
    [m, h] = remote(t);
    check(`7g. remote "${t}" with Neem serving a sentence offline moves nobody: "Cannot move ... serving a sentence ... Release"`, m === '' && h === NEEM_HELD && !audits().some((l) => l.startsWith('UNSTUCK ')), [m, h]);
  }
  [m, h] = typed(A.jake, '#LBRF hub');
  check('7g. typed by an admin, the same', m === '' && h === NEEM_HELD, [m, h]);
  [m, h] = typed(A.jake, 'Lydia hub');
  check('7g. an ONLINE prisoner (Lydia), typed: refused, nobody moves', m === '' && /^Cannot move Lydia #LLX8: they are serving a sentence in Bruma Castle Dungeon; release them first/.test(h), [m, h]);
  // only who gets Release at the door is told to use it (C's review): a Trial GM or GM is told who can
  const NEEM_ASK = 'Cannot move Neem #LBRF: they are serving a sentence in Bruma Castle Dungeon; a Lead GM, or that hold\'s guards and officials, can release them at their cell door.';
  setOnline(A.trial, true);
  [m, h] = typed(A.trial, '#LBRF hub');
  check('7g. a Trial GM: refused, the hub included, and told a Lead GM or the hold\'s guards can release them', m === '' && h === NEEM_ASK, [m, h]);
  [m, h] = typed(A.trial, '#LBRF respawn');
  check('7g. ...and the temple', m === '' && h === NEEM_ASK, [m, h]);
  concordat.add(neem);
  [m, h] = typed(A.trial, '#LBRF hub');
  check('7g. ...a Concordat sentence: only the Thalmor or a Lead GM', m === '' && h === 'Cannot move Neem #LBRF: they are serving a sentence in Bruma Castle Dungeon; the White-Gold Concordat holds them, so only the Thalmor or a Lead GM can release them, at their cell door.', [m, h]);
  concordat.delete(neem);
  setOnline(A.trial, false);
  setOnline(A.lead, true);
  [m, h] = typed(A.lead, '#LBRF hub');
  check('7g. a Lead GM: refused, and told to release them at the cell door (they get Release there)', m === '' && h === NEEM_HELD, [m, h]);
  setOnline(A.lead, false);
  [m, h] = typed(A.jake, 'Anna hub');
  check('7g. someone not serving is moved as before', m === 'Anna #ANN1@hub', [m, h]);
  where(); reset(); G.commands.get('fixloc').fn(A.jake, '#LBRF');
  check('7g. /fixloc on a prisoner is unchanged (Jake): Neem to the hub', moved() === 'Neem #LBRF@hub', moved());
  jailed.delete(neem);
  [m, h] = remote('/unstuck #LBRF hub ticket:12');
  check('7g. just released: the form moves Neem to the hub', m === 'Neem #LBRF@hub', [m, h]);
  jailed.add(A.bob); where(); reset(); store.get(A.bob)['private.unstuckAt'] = 0;
  G.handleLine(A.bob, '/unstuck', store.get(A.bob).__user);
  check('7g. a player\'s own /unstuck never gets the staff refusal (the jail refuses it itself, __dboJailUnstuck)', !chatWrites.some(([id, l]) => id === A.bob && /Cannot move .*serving a sentence/.test(l)), chatWrites.filter(([id]) => id === A.bob));
  delete store.get(A.bob).locationalData; store.get(A.bob)['private.unstuckAt'] = 0;
  delete globalThis.__dboJailSentence;
  for (const id of [neem, anna]) store.delete(id);
  delete mp.findFormsByPropertyValue;
}

// ---- 7h. a staff move takes an exact full name or a #TAG, never a prefix (Jake, 28 Oct: "Yes, exact only"); other commands
// keep their lookup -----------------------------------------------------------------------------------------------------------
reset();
{
  mp.findFormsByPropertyValue = (k, v) => [...store].filter(([, o]) => (k === 'private.indexed.tagKey' ? String(o['private.charTag'] || '').toLowerCase() === v
    : k === 'private.indexed.nameKey' ? String((o.appearance || {}).name || '').toLowerCase() === v : false)).map(([id]) => id);
  const HUB = '17482:DragonBreak Hub.esp', TEMPLE = 'a764b:BSHeartland.esm';
  const annaH = actor(0xff000f31, { name: 'Anna Hubbard', tag: 'AHB1', profile: 131, online: true });
  const ids = [annaH, A.lydia, A.jake];
  const where = () => { for (const id of ids) delete store.get(id).locationalData; };
  const at = (id) => (store.get(id).locationalData || {}).cellOrWorldDesc || '';
  const moved = () => ids.filter((id) => at(id)).map((id) => `${G.display(id)}@${at(id) === HUB ? 'hub' : at(id) === TEMPLE ? 'temple' : at(id)}`).join(',');
  const told = () => ((chatWrites.filter(([id]) => id === A.jake).slice(-1)[0] || [])[1] || '').split('|').slice(1).join('|');
  const typed = (cmd, args) => { where(); reset(); G.commands.get(cmd).fn(A.jake, args); return [moved(), told()]; };
  const remote = (text) => { where(); reset(); const { rep } = send(text, { src: 'discord' }); return [moved(), header(rep)]; };
  let m, h;
  [m, h] = typed('unstuck', 'Lyd hub');
  check('7h. typed "/unstuck Lyd hub" (only Lydia online) moves nobody: no character is called Lyd', m === '' && h === 'Cannot move Lyd: no character is called that; use their full name or #TAG.', [m, h]);
  [m, h] = remote('/unstuck Lyd hub ticket:2');
  check('7h. ...the form the same', m === '' && /^Cannot move Lyd: no character is called that/.test(h), [m, h]);
  [m, h] = typed('fixloc', 'Anna');
  check('7h. typed "/fixloc Anna" (only Anna Hubbard online) moves nobody', m === '' && h === 'Cannot move Anna: no character is called that; use their full name or #TAG.', [m, h]);
  [m, h] = remote('/fixloc Anna');
  check('7h. ...from the console the same', m === '' && /^Cannot move Anna: no character is called that/.test(h), [m, h]);
  [m, h] = typed('unstuck', 'lydia hub');
  check('7h. typed "/unstuck lydia hub" (an exact name in any case) moves Lydia to the hub', m === 'Lydia #LLX8@hub', [m, h]);
  [m, h] = remote('/unstuck lydia respawn ticket:3');
  check('7h. ...the form "/unstuck lydia respawn ticket:3" moves Lydia to the temple', m === 'Lydia #LLX8@temple', [m, h]);
  [m, h] = typed('fixloc', 'anna hubbard');
  check('7h. typed "/fixloc anna hubbard" (the full name) moves Anna Hubbard', m === 'Anna Hubbard #AHB1@hub', [m, h]);
  check('7h. other commands keep their lookup: findByName still takes a unique prefix ("Lyd")', G.findByName('Lyd') === A.lydia);
  store.delete(annaH); delete mp.findFormsByPropertyValue;
}

// ---- 12. reply state is "ran", with the handler's own first line ------------------------------------------------------------------------
reset();
{
  globalThis.__dboNameTaken = () => true;
  const rep = send('/rename #8KWH Lydia').rep;
  check('12. a handler that reports a failure as a chat line gives state ran, and that line first', rep.state === 'ran' && /already carries the name Lydia/.test(header(rep)), rep);
  globalThis.__dboNameTaken = () => false;
  store.get(A.bob).__throwOnSet = 'private.wwBodyOff';
  const ww = send('/wwremote clear #8KWH').rep;
  check('12. /wwremote clear whose write fails: ran, "That failed: ..."', ww.state === 'ran' && /That failed: write refused/.test(header(ww)), ww);
  delete store.get(A.bob).__throwOnSet;
  store.get(A.bob)['private.wwBodyOff'] = { at: 1 };
  const ok = send('/wwremote clear #8KWH').rep;
  check('12. /wwremote clear #8KWH (Jake\'s example): ran, the breaker flag is cleared, the reply line and its audit come back', ok.state === 'ran' && store.get(A.bob)['private.wwBodyOff'] === null
    && header(ok) === "Bob #8KWH's werewolf body may be shown again." && ok.lines.some((l) => l.to === 'audit' && /cleared the werewolf body breaker for Bob #8KWH/.test(l.text)) && beastSent.length === 1, ok);
  check('12. ...with the REMOTE lines before and after it in the server log', audits().some((l) => /^REMOTE web req \w{8} jake <@200000000000000001> as Jake #ABCD \(profile 1, <@200000000000000001>\) on Bob #8KWH: \/wwremote clear #8KWH$/.test(l))
    && audits().some((l) => /^REMOTE req \w{8} -> ran\/ran$/.test(l)), audits());
  const fixloc = send('/fixloc #8KWH').rep;
  check('12. /fixloc #8KWH moves Bob to the hub, not the caller', fixloc.state === 'ran' && store.get(A.bob).locationalData && !store.get(A.jake).locationalData, fixloc);
  const load = send('/load').rep;
  check('12. /load answers with its counters', load.state === 'ran' && /online/.test(load.lines[0].text), load);
}

// ---- the player log sees the remote run as route console, and its route comes back afterwards ----------------------------------
reset();
{
  const routes = [];
  globalThis.__dboPlogHook = (kind, name, fn, self, a, args, userId) => { if (kind === 'command') { routes.push([name, globalThis.__dboPlogRoute]); return fn.call(self, a, args, userId); } return undefined; };
  globalThis.__dboPlogRoute = 'before';
  const rep = send('/whoami').rep;
  check('playerlog: the command wrapper runs the handler once, with __dboPlogRoute = console', rep.state === 'ran' && JSON.stringify(routes) === '[["whoami","console"]]', routes);
  check('playerlog: the route before the run is put back', globalThis.__dboPlogRoute === 'before');
  globalThis.__dboPlogHook = undefined; globalThis.__dboPlogRoute = null;
}

// ---- 13. the switch file, and a flood ---------------------------------------------------------------------------------------------------
reset();
{
  const P = rules.parseSwitch;
  check('13. parse: on, dry-run, off; anything else is off', P('on\n').web === 'on' && P('dry-run').discord === 'dry-run' && P('off').web === 'off' && P('yes').web === 'off' && P('').web === 'off' && P(null).web === 'off');
  check('13. parse: "on web=dry-run" narrows web only', JSON.stringify(P('on web=dry-run\n')) === '{"web":"dry-run","discord":"on"}');
  check('13. parse: a front end can only narrow, never widen', JSON.stringify(P('dry-run web=on')) === '{"web":"dry-run","discord":"dry-run"}');
  check('13. parse: a key twice, an unknown key, two lines or over 64 bytes is off for both', ['on web=on web=off', 'on cli=on', 'on\non', `on ${' '.repeat(70)}`, 'constructor', 'on web=toString'].every((t) => JSON.stringify(P(t)) === '{"web":"off","discord":"off"}'));
  for (const [label, text] of [['off', 'off\n'], ['missing', null], ['malformed', 'maybe\n']]) {
    setSwitch(text);
    const rep = send('/kick #8KWH').rep;
    check(`13. switch ${label}: refused as off, nothing runs`, rep.state === 'off' && !kicked.length && !staffLines.length, rep);
  }
  setSwitch('on web=dry-run\n');
  const web = send('/kick #8KWH').rep; const disc = send('/whoami', { src: 'discord' }).rep;
  check('13. "on web=dry-run": a web request is dry, a Discord one runs', web.state === 'dry-run' && !kicked.length && disc.state === 'ran', [web.state, disc.state]);
  setSwitch('on\n'); reset();
  const flood = []; for (let i = 0; i < 51; i++) flood.push(drop(req('/kick #8KWH')));
  ticker();
  const states = flood.map((r) => (readReply(r.id) || {}).state);
  check('13. more than 50 waiting: every one refused as busy, nothing runs, one audit line', states.every((s) => s === 'busy') && !kicked.length && audits().filter((l) => /^REMOTE flood/.test(l)).length === 1, [states.filter((s) => s !== 'busy').length, kicked.length]);
  reset();
  for (let i = 0; i < 7; i++) drop(req('/whoami'));
  ticker();
  check('13. at most 5 requests a tick', fs.readdirSync(IN).length === 2 && staffLines.length === 5, fs.readdirSync(IN).length);
  ticker(); for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));
}

// ---- rate limits in the game ---------------------------------------------------------------------------------------------------------
reset();
{
  const states = []; for (let i = 0; i < 11; i++) states.push(send('/whoami', { keepLimits: true }).rep.why || 'ok');
  check('limits: 10 a minute per profile, the 11th refused as tooMany', states.slice(0, 10).every((s) => s === 'ok') && states[10] === 'tooMany', states);
  clock += 61000;
  check('limits: ...and free again after the minute', send('/whoami', { keepLimits: true }).rep.state === 'ran');
}

// ---- 14. the tick never throws ----------------------------------------------------------------------------------------------------------
reset();
{
  let uncaught = 0; const onUncaught = () => { uncaught++; }; process.on('uncaughtException', onUncaught);
  const quiet = (fn) => { try { fn(); return true; } catch (e) { return false; } };
  fs.rmSync(SPOOL, { recursive: true, force: true });
  check('14. the spool directory removed: the tick does not throw', quiet(ticker) && quiet(ticker));
  check('14. ...and logs it once a minute, not every tick', logs.filter((l) => /spool .* unreadable/.test(l)).length === 1, logs);
  makeSpool(); clock += 61000; logs.length = 0;
  fs.chmodSync(IN, 0o750); const r1 = drop(req('/whoami'));
  check('14. a 0750 spool directory: off, the file is not read', quiet(ticker) && fs.existsSync(path.join(IN, `${r1.id}.json`)) && logs.some((l) => /not root-only 0700/.test(l)), logs);
  fs.chmodSync(IN, 0o700); fs.unlinkSync(path.join(IN, `${r1.id}.json`));
  const real = path.join(SCRATCH, 'elsewhere'); fs.mkdirSync(real, { mode: 0o700 }); fs.rmSync(OUT, { recursive: true }); fs.symlinkSync(real, OUT); clock += 61000;
  const r2 = drop(req('/whoami'));
  check('14. a symlinked spool directory: off, the file is not read', quiet(ticker) && fs.existsSync(path.join(IN, `${r2.id}.json`)));
  fs.unlinkSync(OUT); fs.mkdirSync(OUT, { mode: 0o700 }); fs.unlinkSync(path.join(IN, `${r2.id}.json`)); clock += 61000; logs.length = 0;
  drop('this is not json {', `w-${uuid()}`);
  check('14. a file of garbage: refused, logged once, never read again', quiet(ticker) && logs.filter((l) => /refused \(/.test(l)).length === 1 && !fs.readdirSync(IN).length && quiet(ticker), logs);
  const big = req('/whoami'); big.pad = 'x'.repeat(9 * 1024); drop(big);
  check('14. a 9 KB file: refused as bad', quiet(ticker) && (readReply(big.id) || {}).state === 'bad');
  const linked = `w-${uuid()}`; fs.symlinkSync(KEY_FILE, path.join(IN, `${linked}.json`));
  check('14. a symlink in in/: not followed (refused as bad), the key is not read into a reply', quiet(ticker) && (readReply(linked) || {}).state === 'bad');
  fs.chmodSync(KEY_FILE, 0o644); clock += 61000;
  const r3 = drop(req('/whoami'));
  check('14. a key readable by others: off, the file waits (the backend reports not run)', quiet(ticker) && fs.existsSync(path.join(IN, `${r3.id}.json`)) && logs.some((l) => /key .* missing or not/.test(l)));
  fs.chmodSync(KEY_FILE, 0o600); ticker(); readReply(r3.id);
  check('14. nothing reached uncaughtException', uncaught === 0);
  process.removeListener('uncaughtException', onUncaught);
}

// ---- 14b. a FIFO on a spool or switch path never blocks the game's thread ------------------------------------------------------
// Each probe runs console.js in a child process against its own scratch spool, with a FIFO where a file is expected, and one
// tick. A blocking open of a FIFO with no writer would hang the child; the timeout kills it and the check fails (so a
// regression shows as a FAIL here, never as a hung harness). Without the fix all three time out (review-game, 13 Oct).
{
  const probe = path.join(SCRATCH, 'fifo-probe.js');
  fs.writeFileSync(probe, `'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const { execFileSync } = require('child_process');
const [CONSOLE, MODE, DIR] = process.argv.slice(2);
const spool = path.join(DIR, 'spool'); const IN = path.join(spool, 'in'), WORK = path.join(spool, 'work'), OUT = path.join(spool, 'out');
for (const d of [spool, IN, WORK, OUT]) { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.chmodSync(d, 0o700); }
const keyHex = crypto.randomBytes(32).toString('hex'); const keyFile = path.join(DIR, 'console.key');
fs.writeFileSync(keyFile, keyHex + '\\n', { mode: 0o600 });
const sw = path.join(DIR, 'console');
const ID = '200000000000000001';
let tick = null;
globalThis.__dboRunCommand = () => null;
const mod = require(CONSOLE);
mod({ mp: { getActorsByProfileId: () => [] }, log: () => {}, audit: () => {}, every: (n, ms, fn) => { tick = fn; }, stopTimer: () => {},
  cfg: { remoteConsole: { discordIds: [ID] } }, commands: new Map([['whoami', { help: 'x' }]]), handleLine: () => 'ran', findByName: () => 0,
  tagOf: () => 'XXXX', profileOf: () => 1, discordOf: () => ID, userOf: () => -1, display: () => 'x', who: () => 'x', staffTierFrom: () => 'senior',
  staffTierOf: () => 'senior', TIER_LABEL: {}, TIER_RANK: { senior: 4, developer: 3, leadgm: 2, gm: 1, trialgm: 0.5 },
  captureFor: (a, q, fn) => ({ result: fn(), lines: [] }), onlineActors: () => [], gen: globalThis.__dboRunCommand,
  paths: { spool, key: keyFile, switch: sw }, now: Date.now });
const id = 'w-6f1c2a3b-4d5e-4f60-8a7b-00000000f1f0';
const signed = () => {
  const t = Date.now();
  const r = { v: 1, id, src: 'web', discordId: ID, user: 'jake', profileId: 1, roles: [], text: '/whoami', mode: 'on', issuedAt: t, expiresAt: t + 10000 };
  r.sig = crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update(mod.rules.reqPayload(r), 'utf8').digest('hex');
  return JSON.stringify(r);
};
if (MODE === 'request') { fs.writeFileSync(sw, 'on\\n'); execFileSync('mkfifo', ['-m', '600', path.join(IN, id + '.json')]); }
if (MODE === 'switch') { execFileSync('mkfifo', ['-m', '600', sw]); fs.writeFileSync(path.join(IN, id + '.json'), signed(), { mode: 0o600 }); }
if (MODE === 'allowtmp') { fs.writeFileSync(sw, 'on\\n'); execFileSync('mkfifo', ['-m', '600', path.join(spool, 'allow.json.tmp')]); }
process.stdout.write('TICK\\n');
tick();
const rep = fs.existsSync(path.join(OUT, id + '.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, id + '.json'), 'utf8')) : null;
const allow = path.join(spool, 'allow.json');
process.stdout.write(JSON.stringify({ state: rep && rep.state, why: rep && rep.why, inLeft: fs.readdirSync(IN).length, workLeft: fs.readdirSync(WORK).length,
  allowFile: fs.existsSync(allow) && fs.lstatSync(allow).isFile(), allowNames: fs.existsSync(allow) ? JSON.parse(fs.readFileSync(allow, 'utf8')).map((x) => x.name) : null,
  tmpLeft: fs.existsSync(path.join(spool, 'allow.json.tmp')) }) + '\\n');
`);
  const runProbe = (mode) => {
    const dir = fs.mkdtempSync(path.join(SCRATCH, `fifo-${mode}-`));
    const r = spawnSync(process.execPath, [probe, CONSOLE_JS, mode, dir], { timeout: 10000, killSignal: 'SIGKILL', encoding: 'utf8' });
    const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT') || r.signal === 'SIGKILL';
    const last = String(r.stdout || '').trim().split('\n').pop();
    let out = null; try { out = JSON.parse(last); } catch (e) { out = null; }
    return { timedOut, status: r.status, out, stderr: String(r.stderr || '').slice(0, 300) };
  };
  let p = runProbe('request');
  check('14b. a FIFO as a request file: the tick returns (O_NONBLOCK), refuses it as bad, and leaves nothing in in/ or work/',
    !p.timedOut && p.status === 0 && p.out && p.out.state === 'bad' && p.out.inLeft === 0 && p.out.workLeft === 0, p);
  p = runProbe('switch');
  check('14b. a FIFO as the switch file: the tick returns, the switch reads as off, and the request is refused off',
    !p.timedOut && p.status === 0 && p.out && p.out.state === 'off' && p.out.inLeft === 0 && p.out.workLeft === 0, p);
  p = runProbe('allowtmp');
  check('14b. a FIFO left at allow.json.tmp: the tick returns, the FIFO is removed, allow.json is written as a regular file',
    !p.timedOut && p.status === 0 && p.out && p.out.allowFile === true && p.out.tmpLeft === false && Array.isArray(p.out.allowNames) && p.out.allowNames.includes('whoami'), p);
  // The same read, in this process: what the switch path holds besides a regular file of at most 64 bytes is off
  setSwitch(null);
  fs.mkdirSync(SWITCH_FILE);
  check('14b. a directory at the switch path: off, nothing runs', send('/kick #8KWH').rep.state === 'off' && !kicked.length);
  fs.rmdirSync(SWITCH_FILE);
  const target = path.join(SCRATCH, 'switch-target'); fs.writeFileSync(target, 'on\n'); fs.symlinkSync(target, SWITCH_FILE);
  check('14b. a symlink at the switch path (to a file saying on): not followed, off', send('/kick #8KWH').rep.state === 'off' && !kicked.length);
  fs.unlinkSync(SWITCH_FILE);
  setSwitch(`on${' '.repeat(70)}\n`);
  check('14b. a switch file over 64 bytes: off', send('/kick #8KWH').rep.state === 'off' && !kicked.length);
  setSwitch('on\n'); reset();
  check('14b. ...and a plain "on" file runs again', send('/whoami').rep.state === 'ran');
}

// ---- 15. reloads: the real timers and the real console loader from gamemode.js ------------------------------------------------------------
{
  const intervals = new Map(); let nextTimer = 1; const timeouts = [];
  const fake = {
    setTimeout: (fn) => { const id = nextTimer++; timeouts.push({ id, fn }); return id; }, clearTimeout: (id) => { const i = timeouts.findIndex((t) => t.id === id); if (i >= 0) timeouts.splice(i, 1); },
    setInterval: (fn) => { const id = nextTimer++; intervals.set(id, fn); return id; }, clearInterval: (id) => { intervals.delete(id); },
  };
  const startAll = () => { while (timeouts.length) timeouts.shift().fn(); };
  const fireAll = () => { for (const fn of [...intervals.values()]) fn(); };
  delete globalThis.__dboTimers;
  const T = new Function('cfg', 'log', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    `${cut('const TIMERS = ', '// Event loop delay', 'timers')}\nreturn { TIMERS, every, stopTimer };`)({}, log, performance, fake.setTimeout, fake.clearTimeout, fake.setInterval, fake.clearInterval);
  const loaderSrc = cut('// ---- remote staff console (server\\console.js)', '\n\n', 'console loader');
  const wrapper = path.join(SCRATCH, 'console-wrapper.js');
  fs.writeFileSync(wrapper, `module.exports = (api) => require(${JSON.stringify(CONSOLE_JS)})(Object.assign({}, api, { paths: ${JSON.stringify({ spool: SPOOL, key: KEY_FILE, switch: SWITCH_FILE })}, now: () => ${JSON.stringify(clock)} }));\n`);
  const thrower = path.join(SCRATCH, 'console-throws.js');
  fs.writeFileSync(thrower, "throw new Error('broken console.js');\n");
  const runLoader = (file) => new Function('mp', 'log', 'audit', 'every', 'stopTimer', 'cfg', 'commands', 'handleLine', 'findByName', 'tagOf', 'profileOf', 'discordOf', 'userOf',
    'display', 'who', 'staffTierFrom', 'staffTierOf', 'TIER_LABEL', 'TIER_RANK', 'captureFor', 'onlineActors', 'accountRankOf', 'path', 'require', loaderSrc)(
    mp, log, G.audit, T.every, T.stopTimer, PINNED, G.commands, G.handleLine, G.findByName, G.tagOf, G.profileOf, G.discordOf, G.userOf, G.display, G.who,
    G.staffTierFrom, G.staffTierOf, G.TIER_LABEL, G.TIER_RANK, G.captureFor, online, G.accountRankOf, { resolve: () => file }, require);
  const newGeneration = () => { globalThis.__dboRunCommand = () => null; };
  const readers = () => [...T.TIMERS.keys()].filter((k) => k === 'remoteConsole').length;
  check('15. the loader in gamemode.js stops the old reader before it loads, and again in its catch', /^stopTimer\('remoteConsole'\);\ntry \{/m.test(loaderSrc) && /\} catch \(e\) \{ stopTimer\('remoteConsole'\); log\('console\.js failed to load:'/.test(loaderSrc));
  const after = src.slice(src.indexOf('// ---- remote staff console (server\\console.js)'));
  check('15. the loader comes after every module that registers commands (only the player log, which registers none, follows)',
    !/registerChatCommand/.test(after) && (after.match(/require\([A-Z_]+_JS\)\(/g) || []).length === 2, (after.match(/require\([A-Z_]+_JS\)\(/g) || []));
  check('15. the remote run tells the player log its route, and puts the old one back', /globalThis\.__dboPlogRoute = 'console';\n\s+try \{ return handleLine\(/.test(fs.readFileSync(CONSOLE_JS, 'utf8')));
  newGeneration(); runLoader(wrapper); startAll();
  check('15. a load starts exactly one reader', readers() === 1 && intervals.size === 1, intervals.size);
  newGeneration(); runLoader(wrapper); startAll();
  check('15. a normal reload leaves exactly one reader (the old interval is cleared)', readers() === 1 && intervals.size === 1, intervals.size);
  logs.length = 0;
  newGeneration(); runLoader(thrower); startAll();
  check('15. a console.js that throws at load leaves no remoteConsole timer at all', readers() === 0 && intervals.size === 0 && logs.some((l) => /console\.js failed to load:.*broken console\.js/.test(l)), logs);
  newGeneration(); runLoader(wrapper); startAll();
  check('15. (loaded again)', readers() === 1 && intervals.size === 1);
  // A rollback to a pre-console gamemode.js: a new __dboRunCommand, no console loader, nothing stops the reader by name
  newGeneration(); logs.length = 0;
  const r = drop(req('/kick #8KWH')); kicked.length = 0;
  fireAll();
  check('15. a pre-console generation: the old reader stops itself at its next tick, and runs nothing', readers() === 0 && intervals.size === 0 && !kicked.length
    && fs.existsSync(path.join(IN, `${r.id}.json`)) && logs.some((l) => /newer gamemode generation/.test(l)), { readers: readers(), intervals: intervals.size, logs });
  fs.unlinkSync(path.join(IN, `${r.id}.json`));
}

// ---- hot-reload gate greps on console.js --------------------------------------------------------------------------------------------------
{
  const c = fs.readFileSync(CONSOLE_JS, 'utf8');
  check('gate: console.js opens no listener, no socket, no child process, no network', !/\b(createServer|listen\(|child_process|execFile|spawn\(|require\('(net|http|https|dgram|tls|ws)'\)|fetch\()/.test(c));
  check('gate: console.js reads no env and takes its paths from code (the harness alone passes paths)', !/process\.env/.test(c) && /const PATHS = Object\.freeze\(\{ spool: '\/run\/dragonbreak-console', key: '\/etc\/dragonbreak\/console\.key', switch: '\/etc\/dragonbreak\/console' \}\)/.test(c));
  check('gate: gamemode.js never passes paths or now to console.js', !/paths:|now:/.test(cut('// ---- remote staff console (server\\console.js)', '\n\n', 'loader')));
  check('gate: the one timer goes through every(), wrapped in try/catch', (c.match(/[^.\w]every\(/g) || []).length === 1 && /every\('remoteConsole', TICK_MS, safeTick\)/.test(c) && /const safeTick = \(\) => \{ try \{ tick\(\); \} catch \(e\)/.test(c));
  check('gate: state that must survive a reload is on globalThis', /const S = globalThis\.__dboConsoleState \|\| \(globalThis\.__dboConsoleState = /.test(c));
  check('gate: console.js does not use __dboRunCommand to run anything (it skips LEAD_ONLY and the staff line)', !/__dboRunCommand\(/.test(c));
  check('gate: no interaction handler in the gameplay code (only the backend answers /console)', !/interactionCreate/.test(c + src));
  check('gate: console.js is pure ASCII (no literal bidi or line-separator characters)', !/[^\x00-\x7f]/.test(c));
}

fs.rmSync(SCRATCH, { recursive: true, force: true });
console.log('');
console.log(failures ? `${failures} FAILED of ${checks}` : `all ${checks} checks passed`);
process.exit(failures ? 1 : 0);
