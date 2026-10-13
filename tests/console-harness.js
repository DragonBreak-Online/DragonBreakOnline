// The remote staff console, game side (console.js and its gamemode.js seams; Jake, 13 Oct). The command gate, the capture,
// the target lookup, the tiers, the timers and the console loader are cut out of gamemode.js as they are written there, the
// real /kick /chargen /rename /fixloc /load /players /whoami handlers with them, and /wwremote /vlremote out of beastform.js.
// console.js is loaded against a scratch spool, and requests are signed here the way DESIGN.md 6.2 writes them.
//   node tests/console-harness.js    (keep TMPDIR off the HDD: it holds the scratch spool)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

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
  cut("registerChatCommand('fixloc'", '// One line per online player on every reload', '/fixloc'),
  cut("registerChatCommand('load'", '// The spawned npcs near you', '/load'),
  `return { deliver, system, personal, captureFor, actorOf, userOf, nameOf, profileOf, discordOf, tagOf, display, who, tierFrom, tierOf, isAdmin,
    isLeadStaff, staffTierFrom, staffTierOf, TIER_RANK, TIER_LABEL, LEAD_ONLY, broadcast, findByName, audit, commands, registerChatCommand, staffSay,
    handleChat, handleLine, NAME_RE };`,
].join('\n');
const world = { online };
const G = new Function('mp', 'log', 'cfg', 'fs', 'path', 'world', 'CHAT_PROP', 'US', 'noteTold', 'ADMIN_PROFILES', 'TIERS', 'tierRoles', 'legacyAdminRoles',
  'trialRoles', 'FLOOD', 'R', 'sendNear', 'bubbleNear', 'hasPlayerMenu', 'openPlayerMenu', 'staffLog', 'indexName', 'discordTarget', 'postJson', 'setTimeout', body)(
  mp, log, {}, fs, path, world, 'ff_chatMsg', String.fromCharCode(31), () => {}, new Set(), ['senior', 'developer', 'leadgm', 'gm'],
  { senior: [ROLE.owner], developer: [ROLE.dev], leadgm: [ROLE.lead], gm: [ROLE.gm] }, [], [ROLE.trial],
  { chatMaxChars: 2000, stripColourCodes: true }, { say: 20, low: 8, whisper: 3, wide: 35, shout: 80, emote: 20, emoteLow: 8, emoteLong: 35, looc: 20, loocLow: 8, loocLong: 35 },
  () => {}, () => {}, () => false, () => {}, (who, tier, what, detail) => staffLines.push({ who, tier, what, detail }), () => {}, null, async () => {}, () => 0);

// beastform.js's /wwremote and /vlremote, with its BODY table and breaker flag, cut as written
const beastBody = [
  cutIn(beastSrc, '  const BODY = {', '  const WB = ', 'BODY'),
  beastSrc.match(/^ {2}const bodyTripped = .*$/m)[0],
  cutIn(beastSrc, '  // /vlremote and /wwremote', "  registerChatCommand('forms'", 'remoteCommand'),
].join('\n');
const beastSent = [];
new Function('mp', 'log', 'personal', 'registerChatCommand', 'display', 'who', 'audit', 'findByName', 'api', 'saveRemote', 'saveWerewolfRemote', 'sendBeastBodies', 'counted', beastBody)(
  mp, log, G.personal, G.registerChatCommand, G.display, G.who, G.audit, G.findByName, { onlineActors: online }, () => {}, () => {}, () => beastSent.push(1), new Map());
// Commands the console must never run, registered so their refusals can be told apart from an unknown name
const neverRan = [];
for (const [n, admin] of [['tp', true], ['npc', true], ['bugs', true], ['wipechars', true], ['schedule', true], ['announce', true], ['dungeon', false], ['beastform', true]]) G.registerChatCommand(n, (a, b) => neverRan.push([n, b]), { admin, help: 'test' });
globalThis.__dboNameKey = (n) => n.toLowerCase(); globalThis.__dboNameTaken = () => false;
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
    paths: { spool: SPOOL, key: KEY_FILE, switch: SWITCH_FILE }, now: () => clock });
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
check('16. ...and lists the nine commands, wwremote and vlremote included', allow.map((x) => x.name).sort().join() === 'chargen,fixloc,kick,load,players,rename,vlremote,whoami,wwremote', allow.map((x) => x.name));
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
  rep = send('/whoami', { discordId: ID.trial, profileId: 4, roles: [ROLE.trial] }).rep;
  check('4. a Trial GM is refused (tier)', rep.why === 'tier', rep);
  rep = send('/whoami', { discordId: ID.lead, profileId: 9, roles: [ROLE.lead] }).rep;
  check('4. a Lead GM is refused in v1 (tier: Developer and above)', rep.why === 'tier', rep);
  rep = send('/whoami', { discordId: ID.nate, profileId: 2, roles: [ROLE.dev] }).rep;
  check('4. a Developer passes (Nate, offline)', rep.state === 'ran' && rep.tier === 'developer' && rep.online === false, rep);
  loadConsole({ remoteConsole: Object.assign({}, PINNED.remoteConsole, { minTier: 'gm' }) });
  rep = send('/whoami', { discordId: ID.lead, profileId: 9, roles: [ROLE.lead] }).rep;
  check('4. minTier "gm" in config cannot lower the floor: a Lead GM is still refused', rep.why === 'tier', rep);
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

// ---- 6. the allowlist and its argument rules ----------------------------------------------------------------------------------
reset();
{
  const passes = ['/wwremote', '/wwremote on', '/wwremote off', '/wwremote clear #8KWH', '/vlremote', '/vlremote clear #8kwh', '/kick #8KWH', '/fixloc #8KWH',
    '/rename #8KWH Bobby', '/chargen #8KWH', '/players', '/players anything', '/load', '/load reset', '/whoami'];
  const bad = [];
  for (const t of passes) { const rep = send(t, { mode: 'dry-run' }).rep; if (!rep || rep.state !== 'dry-run') bad.push([t, rep && rep.state, rep && rep.why]); }
  check('6. every allowed form passes every check (dry run)', !bad.length, bad);
  const refusals = [
    ['/kick', 'needTag'], ['/fixloc', 'self'], ['/chargen', 'self'], ['/kick Bob', 'needTag'], ['/kick Bob #8KWH', 'needTag'], ['/kick me', 'needTag'],
    ['/kick 5', 'needTag'], ['/kick ff000b01', 'needTag'], ['/rename Bob Bobby', 'needTag'], ['/rename #8KWH', 'badArgs'], ['/rename #8KWH B0b', 'badName'],
    ['/wwremote clear', 'needTag'], ['/wwremote clear Bob', 'needTag'], ['/wwremote clear Bob #8KWH', 'needTag'], ['/wwremote sideways', 'badArgs'],
    ['/wwremote on now', 'badArgs'], ['/load everything', 'badArgs'], ['/whoami Bob', 'badArgs'],
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
  const offline = ['/kick #8KWH', '/rename #8KWH Bobby', '/chargen #8KWH', '/fixloc #8KWH', '/wwremote clear #8KWH', '/kick #8KWJ'];
  const hit = offline.map((t) => [t, send(t).rep]).filter(([, rep]) => !rep || rep.why !== 'target');
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
  check('7. a tag two online players carry is refused as target', send('/kick #8KWH').rep.why === 'target');
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
  reset(); G.handleChat(store.get(A.jake).__user, '/players');
  check('9. typed /players still writes no staff line (unchanged)', !staffLines.length);
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
    'display', 'who', 'staffTierFrom', 'staffTierOf', 'TIER_LABEL', 'TIER_RANK', 'captureFor', 'onlineActors', 'path', 'require', loaderSrc)(
    mp, log, G.audit, T.every, T.stopTimer, PINNED, G.commands, G.handleLine, G.findByName, G.tagOf, G.profileOf, G.discordOf, G.userOf, G.display, G.who,
    G.staffTierFrom, G.staffTierOf, G.TIER_LABEL, G.TIER_RANK, G.captureFor, online, { resolve: () => file }, require);
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
