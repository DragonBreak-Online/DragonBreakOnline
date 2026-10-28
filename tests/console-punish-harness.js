// The remote staff console's punishment rules (Jake, 21 Oct 2026: "allow /discipline in the web console too", then "We need
// all options to be available under punishment. Add Stike is just one of them"). console.js now takes /discipline #TAG with
// each of discipline.js's record kinds (warn, strike, suspend <length>, lift, overturn <n>) and a plain reason; /kick #TAG
// stays as it was. Part R holds the rule itself (cleanCommand then checkLine, as the reader runs them); part E runs signed
// requests through the reader, the real gate (gamemode.js handleLine, cut as written) and the real discipline.js, so the
// command's own checks (Lead GM for suspend, lift and overturn, never one's own account, is suspended, record numbers) still
// decide. On origin/server c3f37f9dc, where /discipline is refused as notYet, 52 of these checks fail; the other 9 guard
// what must not change (/kick, requests the backend did not clean, the repo config).
//   node tests/console-punish-harness.js    (as root: the spool checks want root-owned files; keep TMPDIR off the HDD)
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
const { lengthMs } = require(DISCIPLINE_JS);
const REPO_CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));

// ==== R. the rule ==========================================================================================================
// What the reader decides for a line typed or sent as it is: the backend's cleaning (the game's copy), then the rule
const has = (n) => ['discipline', 'kick', 'jail', 'tp', 'whoami', 'players'].includes(n);
const NO_DENY = new Set();
const decide = (text, deny = NO_DENY, opts) => { const clean = rules.cleanCommand(text); return clean === null ? { why: 'clean' } : rules.checkLine(clean, has, deny, opts); };
const runs = (l) => !!l && !l.why && l.cmd === 'discipline' && /^#[A-Za-z0-9]{4}$/.test(l.tag || '');
const R300 = `Took ${'a'.repeat(289)} goods`; // 300 characters
{
  const accepted = [
    '/discipline #8KWH warn Spamming the market chat', '/discipline #8KWH strike Griefing at the Bruma gate', '/discipline #8kwh strike lower-case tag, still one tag',
    '/discipline #8KWH suspend 12h stole from a barrel', '/discipline #8KWH suspend 3d stole from a barrel', '/discipline #8KWH suspend 1h short one',
    '/discipline #8KWH suspend 720h the longest in hours', '/discipline #8KWH suspend 30d the longest in days', '/discipline #8KWH suspend 12H upper case unit',
    '/discipline #8KWH lift appeal accepted by Nate', '/discipline #8KWH ban threats against players, ticket 0200', '/discipline #8KWH overturn 3 wrong person, see ticket 0141', '/discipline #8KWH overturn 99999 the largest number',
    '/discipline #8KWH WARN Upper case kind word', '/discipline #8KWH warn abcde', `/discipline #8KWH warn ${R300}`,
    `/discipline #8KWH warn Plain: . , ; : ! ? ' " ( ) - / & + % all allowed`, '/discipline #8KWH warn Ticket no. 0141, 2 of 3 strikes',
    `/discipline #8KWH warn Caf${'e'}${ch(0x301)} accents are composed (NFC)`, '/discipline #8KWH warn \u00c5sa \u00fcber \u00e7a \u0416\u0435\u043d\u044f letters in any script',
  ];
  const bad = accepted.map((t) => [t, decide(t)]).filter(([, l]) => !runs(l));
  check('R1. every kind runs: warn, strike, suspend 1h..720h and 1d..30d, lift, overturn 1..99999, the plain punctuation, letters of any script', !bad.length, bad);
  check('R1. ...each with the kind the game will record', ['warn', 'strike', 'suspend', 'lift', 'overturn'].every((k) => (decide(`/discipline #8KWH ${k} ${k === 'suspend' ? '3d ' : k === 'overturn' ? '2 ' : ''}a good reason`) || {}).kind === k));
  const e = decide(`/discipline #8KWH warn Caf${'e'}${ch(0x301)} visit`);
  check('R1. the line the game runs is the cleaned one: NFC (e + combining acute is one letter)', runs(e) && e.body === `#8KWH warn Caf${ch(0xe9)} visit`, e);
  const folded = decide(`/discipline #8KWH warn spam${ch(0x202e)}med${ch(0x200d)} the  chat\tagain`);
  check('R1. control, zero-width and bidi characters become spaces and whitespace collapses (the reason the game records)', runs(folded) && folded.body === '#8KWH warn spam med the chat again', folded);

  const refused = [
    // names and odd targets: only one #TAG, first
    ['/discipline Bob warn spamming the chat', 'needTag'], ['/discipline Bob #8KWH warn spamming the chat', 'needTag'], ['/discipline 5 warn spamming the chat', 'needTag'],
    ['/discipline ff000b01 warn spamming the chat', 'needTag'], ['/discipline #8KW warn spamming the chat', 'needTag'], ['/discipline #8KWHX warn spamming the chat', 'needTag'],
    ['/discipline 8KWH warn spamming the chat', 'needTag'], ['/discipline me warn spamming the chat', 'needTag'], ['/discipline #8K_H warn spamming the chat', 'needTag'],
    // wrong words: the record views stay in game, and only the five kinds
    ['/discipline', 'badKind'], ['/discipline #8KWH', 'badKind'], ['/discipline list', 'badKind'], ['/discipline LIST', 'badKind'], ['/discipline #8KWH note quiet staff note', 'badKind'],
    // (ban is a kind since 25 Oct, R7; tempban is a command of its own, never a kind)
    ['/discipline #8KWH tempban 3d spamming the chat', 'badKind'], ['/discipline #8KWH kick spamming the chat', 'badKind'],
    ['/discipline #8KWH warns spamming the chat', 'badKind'], ['/discipline #8KWH show', 'badKind'], ['/discipline #8KWH #LLX8 warn spamming the chat', 'badKind'],
    ['/discipline #8KWH constructor spamming the chat', 'badKind'], ['/discipline #8KWH __proto__ spamming the chat', 'badKind'], ['/discipline #8KWH hasOwnProperty spamming', 'badKind'],
    // bad durations: whole hours or days within maxSuspendDays (30), no decimals, no leading zero, a unit
    ['/discipline #8KWH suspend stole from a barrel', 'badLength'], ['/discipline #8KWH suspend 0h stole from a barrel', 'badLength'], ['/discipline #8KWH suspend 0d stole from a barrel', 'badLength'],
    ['/discipline #8KWH suspend 721h stole from a barrel', 'badLength'], ['/discipline #8KWH suspend 31d stole from a barrel', 'badLength'], ['/discipline #8KWH suspend 1.5d stole from a barrel', 'badLength'],
    ['/discipline #8KWH suspend 0.01h stole from a barrel', 'badLength'], ['/discipline #8KWH suspend 012h stole from a barrel', 'badLength'], ['/discipline #8KWH suspend 3 stole from a barrel', 'badLength'],
    ['/discipline #8KWH suspend 3w stole from a barrel', 'badLength'], ['/discipline #8KWH suspend 3m stole from a barrel', 'badLength'], ['/discipline #8KWH suspend -3d stole from a barrel', 'badLength'],
    ['/discipline #8KWH suspend 1e2h stole from a barrel', 'badLength'], ['/discipline #8KWH suspend 3dd stole from a barrel', 'badLength'], ['/discipline #8KWH suspend h stole from a barrel', 'badLength'],
    ['/discipline #8KWH suspend 1000h stole from a barrel', 'badLength'], ['/discipline #8KWH suspend 100d stole from a barrel', 'badLength'], ['/discipline #8KWH suspend 3d', 'reasonShort'],
    [`/discipline #8KWH suspend ${ch(0x0663)}d stole from a barrel`, 'badLength'],
    // record numbers: digits only
    ['/discipline #8KWH overturn wrong person here', 'badRecord'], ['/discipline #8KWH overturn #3 wrong person', 'badRecord'], ['/discipline #8KWH overturn 03 wrong person', 'badRecord'],
    ['/discipline #8KWH overturn 0 wrong person', 'badRecord'], ['/discipline #8KWH overturn -1 wrong person', 'badRecord'], ['/discipline #8KWH overturn 1.0 wrong person', 'badRecord'],
    ['/discipline #8KWH overturn 123456 wrong person', 'badRecord'], ['/discipline #8KWH overturn three wrong person', 'badRecord'], ['/discipline #8KWH overturn 3', 'reasonShort'],
    // lift and warn take no number or length of their own: whatever follows the kind is the reason
    ['/discipline #8KWH lift 3', 'reasonShort'], ['/discipline #8KWH warn', 'reasonShort'], ['/discipline #8KWH warn hi', 'reasonShort'], ['/discipline #8KWH warn abcd', 'reasonShort'],
    [`/discipline #8KWH warn ${R300}x`, 'reasonLong'],
    // bad characters
    ['/discipline #8KWH warn #{ff0000}red text for everyone', 'reasonChars'], ['/discipline #8KWH warn [[S]]Server: fake notice', 'reasonChars'], ['/discipline #8KWH warn end ]] markup here', 'reasonChars'],
    ['/discipline #8KWH warn <@200000000000000001> pinged', 'reasonChars'], ['/discipline #8KWH warn hi @everyone look', 'reasonChars'], ['/discipline #8KWH warn a > b and c', 'reasonChars'],
    ['/discipline #8KWH warn `code` in the audit', 'reasonChars'], ['/discipline #8KWH warn pipe | ends a PM', 'reasonChars'], ['/discipline #8KWH warn back \\ slash', 'reasonChars'],
    ['/discipline #8KWH warn **bold** in Discord', 'reasonChars'], ['/discipline #8KWH warn under_score name', 'reasonChars'], ['/discipline #8KWH warn ~~struck~~ text', 'reasonChars'],
    ['/discipline #8KWH warn Ticket #0141 here', 'reasonChars'], ['/discipline #8KWH warn spam = bad', 'reasonChars'], ['/discipline #8KWH warn price $5 total', 'reasonChars'],
    [`/discipline #8KWH warn spamming ${ch(0x1f600)} faces`, 'reasonChars'], [`/discipline #8KWH warn ${ch(0x1d400)}${ch(0x1d401)}cdef astral letters`, 'reasonChars'],
    [`/discipline #8KWH warn x${ch(0x301)}${ch(0x301)} lone combining marks`, 'reasonChars'], [`/discipline #8KWH warn heart ${ch(0x2764)} symbol`, 'reasonChars'],
    // colour codes typed with the command word folded, and markup after the length or the number
    ['/discipline #8KWH suspend 3d #{ff0000}red', 'reasonChars'], ['/discipline #8KWH overturn 2 [[A]]admin tab', 'reasonChars'],
    // newlines: folded into one line by the cleaning, so a second command is only words of the reason, and '/kick #LLX8' is refused
    ['/discipline #8KWH warn spamming the chat\n/kick #LLX8', 'reasonChars'], [`/discipline #8KWH warn spamming${ch(0x2028)}/kick #LLX8`, 'reasonChars'],
    // other commands are still refused as before
    ['/jail add cell', 'inWorld'], ['/tp #8KWH', 'self'],
  ];
  const wrong = refused.map(([t, why]) => [t, why, decide(t)]).filter(([, why, l]) => !l || l.why !== why);
  check('R2. each refused form is refused with its class (names, wrong words, bad durations, record numbers, short or long reasons, bad characters, colour codes, newlines)', !wrong.length, wrong);
  check('R2. a line over 500 characters is not a command (the backend refuses it, the game refuses its request as bad)', decide(`/discipline #8KWH warn ${'a'.repeat(478)}`).why === 'clean' && runs(decide(`/discipline #8KWH warn ${'a'.repeat(299)}`)));
  check('R2. a request text with a raw newline is not one the backend would write (the game refuses it as bad)', rules.cleanCommand('/discipline #8KWH warn one\ntwo') !== '/discipline #8KWH warn one\ntwo');

  // The console never lets through what discipline.js would refuse or cut: each length the console takes, lengthMs takes
  // with the same cap, and every reason it takes is 5..300 UTF-16 units (discipline.js cuts at 300 and wants 5)
  const lengths = []; for (let n = 0; n <= 1000; n++) lengths.push(`${n}h`); for (let n = 0; n <= 100; n++) lengths.push(`${n}d`);
  const taken = lengths.filter((w) => runs(decide(`/discipline #8KWH suspend ${w} stole from a barrel`)));
  check('R3. the console takes 1h..720h and 1d..30d, 750 lengths in all', taken.length === 750 && taken.includes('720h') && taken.includes('30d') && !taken.includes('721h') && !taken.includes('31d'), taken.length);
  check('R3. ...and discipline.js takes every one of them at maxSuspendDays 30', taken.length === 750 && taken.every((w) => lengthMs(w, 30) > 0), taken.filter((w) => !(lengthMs(w, 30) > 0)));
  const reasons = accepted.map((t) => decide(t)).filter(runs).map((l) => l.body.split(' ').slice(l.kind === 'suspend' || l.kind === 'overturn' ? 3 : 2).join(' '));
  check('R3. every accepted reason is 5..300 UTF-16 units, so the game neither cuts it nor asks for a reason', reasons.length === accepted.length && reasons.every((x) => x.length >= 5 && x.length <= 300 && x.slice(0, 300) === x), reasons.map((x) => x.length));

  // maxSuspendDays comes from the game's own config, read as discipline.js reads it
  const seven = { maxSuspendDays: 7 };
  check('R4. maxSuspendDays 7: 7d and 168h run, 8d and 169h are refused', runs(decide('/discipline #8KWH suspend 7d stole goods', NO_DENY, seven)) && runs(decide('/discipline #8KWH suspend 168h stole goods', NO_DENY, seven))
    && decide('/discipline #8KWH suspend 8d stole goods', NO_DENY, seven).why === 'badLength' && decide('/discipline #8KWH suspend 169h stole goods', NO_DENY, seven).why === 'badLength');
  check('R4. ...and its refusal names that cap', rules.TEXT.badLength && rules.TEXT.badLength(7) === 'Give a length in whole hours or days, 1h to 168h or 1d to 7d, like 12h or 3d.', rules.TEXT.badLength && rules.TEXT.badLength(7));
  check('R4. a config that allows no length (0) leaves suspend out: refused as switched off', decide('/discipline #8KWH suspend 3d stole goods', NO_DENY, { maxSuspendDays: 0 }).why === 'denied'
    && runs(decide('/discipline #8KWH warn stole goods', NO_DENY, { maxSuspendDays: 0 })));

  // gamemode-config remoteConsole.deny narrows one kind or the whole command
  const noSuspend = new Set(['discipline suspend']);
  const ds = decide('/discipline #8KWH suspend 3d stole goods', noSuspend);
  check('R5. deny "discipline suspend": suspend is denied (and named), warn still runs', ds.why === 'denied' && ds.subject === 'discipline suspend' && runs(decide('/discipline #8KWH warn stole goods', noSuspend)), ds);
  check('R5. deny "discipline": every kind is denied', ['warn x reason', 'strike x reason', 'suspend 3d x reason', 'lift x reason', 'overturn 1 x reason'].every((t) => decide(`/discipline #8KWH ${t}`, new Set(['discipline'])).why === 'denied'));

  // The wording the admin reads
  const T = rules.TEXT;
  check('R6. each new refusal says what to do, in plain words', typeof T.badKind === 'function' && /^From the console: \/discipline #TAG warn\|strike\|ban\|lift <reason>; suspend <1-720h\|1-30d> <reason>; overturn <n> <reason>\. A player's record and \/discipline list stay in game\.$/.test(T.badKind(decide('/discipline').subject))
    && /record number in digits/.test(T.badRecord()) && /at least 5 characters/.test(T.reasonShort()) && /at most 300 characters/.test(T.reasonLong())
    && /no colour codes, markup, mentions, symbols or line breaks/.test(T.reasonChars()) && T.denied('discipline suspend') === "/discipline suspend is switched off for the console in the game's config.", decide('/discipline'));
}

// ---- R7. /ban, /tempban, /unban (Nat, 25 Oct): /discipline's ban, suspend and lift under their own words, the same rule ------
{
  const has7 = (n) => has(n) || ['ban', 'tempban', 'unban'].includes(n);
  const d7 = (text, deny = NO_DENY, opts) => { const clean = rules.cleanCommand(text); return clean === null ? { why: 'clean' } : rules.checkLine(clean, has7, deny, opts); };
  const ok7 = [['/ban #8KWH threats against players', 'ban'], ['/tempban #8KWH 3d stole from a barrel', 'suspend'], ['/tempban #8KWH 720h the longest in hours', 'suspend'],
    ['/unban #8KWH appeal accepted by Nate', 'lift'], ['/BAN #8kwh upper case command word', 'ban']];
  const bad7 = ok7.map(([t, k]) => [t, k, d7(t)]).filter(([, k, l]) => !l || l.why || l.kind !== k || !/^#[A-Za-z0-9]{4}$/.test(l.tag || ''));
  check('R7. /ban, /tempban <length>, /unban run with the kind discipline.js records (ban, suspend, lift), the #TAG named', !bad7.length, bad7);
  const t = d7('/tempban #8KWH 3d stole from a barrel');
  check('R7. ...and the line the game runs is the alias as typed (handleLine sends it to the alias)', t.cmd === 'tempban' && t.body === '#8KWH 3d stole from a barrel', t);
  const refused7 = [['/ban Bob threats against players', 'needTag'], ['/ban', 'badKind'], ['/ban list', 'badKind'], ['/ban #8KWH', 'reasonShort'], ['/ban #8KWH hi', 'reasonShort'],
    ['/ban #8KWH #{ff0000}red text', 'reasonChars'], ['/ban #8KWH <@200000000000000001> pinged', 'reasonChars'], [`/ban #8KWH ${R300}x`, 'reasonLong'],
    ['/tempban #8KWH stole from a barrel', 'badLength'], ['/tempban #8KWH 31d stole from a barrel', 'badLength'], ['/tempban #8KWH 1.5d stole from a barrel', 'badLength'],
    ['/tempban #8KWH 3d', 'reasonShort'], ['/unban #8KWH [[S]]fake notice', 'reasonChars'], ['/unban #8KWH 3', 'reasonShort']];
  const w7 = refused7.map(([x, why]) => [x, why, d7(x)]).filter(([, why, l]) => !l || l.why !== why);
  check('R7. ...each refused form is refused as /discipline refuses it (one #TAG, the length, REASON_RE, 5..300)', !w7.length, w7);
  check('R7. deny "discipline suspend" denies /tempban, "discipline" all three, "ban" only /ban', d7('/tempban #8KWH 3d stole goods', new Set(['discipline suspend'])).why === 'denied'
    && ['/ban #8KWH stole goods', '/tempban #8KWH 3d stole goods', '/unban #8KWH stole goods'].every((x) => d7(x, new Set(['discipline'])).why === 'denied')
    && d7('/ban #8KWH stole goods', new Set(['ban'])).why === 'denied' && !d7('/tempban #8KWH 3d stole goods', new Set(['ban'])).why);
  check('R7. maxSuspendDays 7 holds /tempban to 7d', !d7('/tempban #8KWH 7d stole goods', NO_DENY, { maxSuspendDays: 7 }).why && d7('/tempban #8KWH 8d stole goods', NO_DENY, { maxSuspendDays: 7 }).why === 'badLength');
  check('R7. the aliases carry the rank check and take an offline #TAG, as /discipline', ['ban', 'tempban', 'unban'].every((n) => rules.ALLOW[n].rank === true && rules.ALLOW[n].offline === true && rules.ALLOW[n].rule === 'tagKindReason'));
  check('R7. a Lead GM runs them (PUNISH_ONLY), and the usage the refusals show', ['ban', 'tempban', 'unban'].every((n) => rules.PUNISH_ONLY.includes(n))
    && rules.usageOf('tempban', ['suspend'], 30) === '/tempban #TAG <1-720h|1-30d> <reason>' && rules.usageOf('ban', ['ban'], 30) === '/ban #TAG <reason>', rules.usageOf('tempban', ['suspend'], 30));
}

// ==== E. end to end: signed requests through the reader, the gate and discipline.js ==========================================
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'console-punish-'));
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
    TIER_RANK, TIER_LABEL, broadcast, findByName, findAnyByName, audit, commands, registerChatCommand, handleLine, accountRankOf, rankRefusalOf, authorRefusalOf };`,
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
    registerChatCommand: G.registerChatCommand, isAdmin: G.isAdmin, isLeadStaff: G.isLeadStaff, findAnyByName: G.findAnyByName, rankRefusal: G.rankRefusalOf, authorRefusal: G.authorRefusalOf,
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
  r.sig = sign(r);
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

// ---- E1. allow.json: what the backend's pre-check and the page read ---------------------------------------------------------
{
  const allow = allowNow() || [];
  const d = allow.find((x) => x.name === 'discipline');
  check('E1. allow.json lists /discipline with rule tagKindReason, every kind, and the longest suspension (30 days, from the config)', !!d && d.rule === 'tagKindReason'
    && JSON.stringify(d.kinds) === '["warn","strike","suspend","lift","overturn"]' && d.maxSuspendDays === 30, d);
  check('E1. ...with a usage that names each kind and its word', !!d && d.usage === '/discipline #TAG warn|strike|lift <reason>; suspend <1-720h|1-30d> <reason>; overturn <n> <reason>', d && d.usage);
  check("E1. ...and the console's own help (the registry's names the record view and list, which the console refuses), at most 200 characters", !!d && /^A warning, strike, suspension, ban, lift or overturn on the player's account record/.test(d.help) && d.help.length <= 200, d && d.help);
  const k = allow.find((x) => x.name === 'kick');
  check('E1. /kick stays #TAG only, and its help says it takes no reason', !!k && k.usage === '/kick #TAG' && k.rule === 'tag' && /takes no reason/.test(k.help), k);
  check('E1. no other entry carries kinds', allow.filter((x) => x.kinds).map((x) => x.name).join() === 'discipline', allow.map((x) => x.name));
  // 25 Oct: the backend's copy (skymp5-backend allowlist.js) refuses all of allow.json for a kind or an entry it does not know, so
  // ban and the aliases stay out of it until the backend learns them (console.js BACKEND_KINDS); the reader takes them all the same
  check('E1. allow.json stays what the backend parses: no ban kind, no /ban, /tempban or /unban entry', !allow.some((x) => ['ban', 'tempban', 'unban'].includes(x.name))
    && !(d && d.kinds.includes('ban')), allow.map((x) => x.name));
  loadConsole(CFG({ deny: ['discipline suspend', 'discipline overturn'] }));
  const n = (allowNow() || []).find((x) => x.name === 'discipline');
  check('E1. deny "discipline suspend" and "discipline overturn": allow.json lists warn, strike and lift only, no length, and a usage without them', !!n && JSON.stringify(n.kinds) === '["warn","strike","lift"]'
    && n.maxSuspendDays === undefined && n.usage === '/discipline #TAG warn|strike|lift <reason>', n);
  reset();
  const ds = send('/discipline #8KWH suspend 3d stole from a barrel');
  check('E1. ...and a suspend from the console is refused as denied, with the kind named, and nothing recorded', ds && ds.why === 'denied' && header(ds) === "/discipline suspend is switched off for the console in the game's config." && !recordOf(5).length && !staffLines.length, ds);
  loadConsole(CFG({ deny: ['discipline'] }));
  check('E1. deny "discipline": not listed at all', !(allowNow() || []).some((x) => x.name === 'discipline') && (allowNow() || []).some((x) => x.name === 'kick'));
  loadConsole(Object.assign(CFG(), { discipline: Object.assign({}, REPO_CFG.discipline, { maxSuspendDays: 7 }) }));
  const seven = (allowNow() || []).find((x) => x.name === 'discipline');
  check("E1. the game config's maxSuspendDays 7 is what allow.json says, and what the reader holds a length to", !!seven && seven.maxSuspendDays === 7 && /suspend <1-168h\|1-7d>/.test(seven.usage)
    && send('/discipline #8KWH suspend 8d stole from a barrel').why === 'badLength' && /1h to 168h or 1d to 7d/.test(header(send('/discipline #8KWH suspend 8d stole from a barrel'))), seven);
  loadConsole(CFG());
}

// ---- E2. every kind through the reader, as Jake (Owner, online): the record, the reply, the player, the staff line ------------
reset();
{
  let rep = send('/discipline #8KWH warn Spamming the market chat');
  check('E2. warn ran on Bob #8KWH: "Recorded: warn #1 on Bob #8KWH."', rep && rep.state === 'ran' && rep.target === 'Bob #8KWH' && header(rep) === 'Recorded: warn #1 on Bob #8KWH.', rep);
  const w = recordOf(5)[0] || {};
  check("E2. ...on Bob's account record (profile 5), by Jake's own character, the reason as sent", w.kind === 'warn' && w.n === 1 && w.by === 'Jake #ABCD' && w.byProfile === 1 && w.reason === 'Spamming the market chat' && w.seen === true, w);
  check('E2. ...Bob (online) read it at once', said(A.bob).some((l) => /A warning from staff: Spamming the market chat/.test(l)), said(A.bob));
  check('E2. ...one #staff-commands line with the whole command and the remote tag', staffLines.length === 1 && /^Jake #ABCD <@200000000000000001> \(Senior\): \/discipline #8KWH warn Spamming the market chat \[remote web [0-9a-f]{8}\]$/.test(staffLines[0].detail), staffLines);
  check('E2. ...and the DISCIPLINE audit line in the reply', rep.lines.some((l) => l.to === 'audit' && /^DISCIPLINE warn #1 on Bob #8KWH \(profile 5, <@200000000000000005>\) \(profile 5\) by Jake #ABCD \(profile 1, <@200000000000000001>\): Spamming the market chat$/.test(l.text)), rep.lines);
  rep = send('/discipline #8KWH strike Griefing at the Bruma gate');
  check('E2. strike ran: "Recorded: strike #2 on Bob #8KWH."', rep && rep.state === 'ran' && header(rep) === 'Recorded: strike #2 on Bob #8KWH.' && (recordOf(5)[1] || {}).kind === 'strike', rep);
  reset();
  rep = send('/discipline #8KWH suspend 3d stole from a barrel');
  const s = recordOf(5)[2] || {};
  check('E2. suspend 3d ran: "Recorded: suspend #3 on Bob #8KWH until <UTC>." and the record ends 3 days on', rep && rep.state === 'ran' && /^Recorded: suspend #3 on Bob #8KWH until \d{4}-\d\d-\d\d \d\d:\d\d UTC\.$/.test(header(rep))
    && s.kind === 'suspend' && Math.abs(s.until - (Date.now() + 3 * 86400000)) < 60000, { rep, s });
  check('E2. ...and Bob is logged out with the reason', kicked.includes(store.get(A.bob).__user) && packets.some(([a, p]) => a === A.bob && p.customPacketType === 'kicked' && /suspended until .* Reason: stole from a barrel/.test(p.reason)), { kicked, packets });
  setOnline(A.bob, false); reset();
  rep = send('/discipline #8KWH lift appeal accepted by Nate');
  check('E2. lift ran on the offline Bob: "Recorded: lift #4 on Bob #8KWH. They are told at their next login."', rep && rep.state === 'ran' && header(rep) === 'Recorded: lift #4 on Bob #8KWH. They are told at their next login.'
    && (recordOf(5)[2] || {}).lifted === true && (recordOf(5)[3] || {}).kind === 'lift', rep);
  rep = send('/discipline #8KWH overturn 2 wrong person, see ticket 0141');
  const o = recordOf(5);
  // (discipline.js sets the overturn's undid after add() has saved, so with the player offline the file holds it only from the
  // next save; the in-memory record has it. Not changed here: the console only carries the line)
  check('E2. overturn 2 ran: "Recorded: overturn #5 on Bob #8KWH of #2 (strike by Jake #ABCD)." and #2 is marked, not deleted', rep && rep.state === 'ran'
    && header(rep) === 'Recorded: overturn #5 on Bob #8KWH of #2 (strike by Jake #ABCD). They are told at their next login.' && o[1] && o[1].overturned && o[1].overturned.by === 'Jake #ABCD'
    && o[1].kind === 'strike' && (o[4] || {}).kind === 'overturn' && o.length === 5, { rep, o });
  rep = send('/discipline #BOB2 warn Same account, other character');
  check("E2. a warn on Bob's other character (offline, found in the tag index) lands on the same account record", rep && rep.state === 'ran' && rep.target === 'Bobette #BOB2' && (recordOf(5)[5] || {}).char === 'Bobette #BOB2', rep);
  reset();
  rep = send('/discipline #LLX8 warn From Discord this time', { src: 'discord' });
  check('E2. the same rule serves Discord /console (one allowlist): a warn from Discord ran, tagged discord', rep && rep.state === 'ran' && header(rep) === 'Recorded: warn #1 on Lydia #LLX8.'
    && staffLines.some((l) => /\[remote discord \d{8}\]$/.test(l.detail)), rep);
  setOnline(A.bob, true);
}

// ---- E3. the command's own checks still decide -----------------------------------------------------------------------------
reset();
{
  const before = JSON.stringify(recordOf(1));
  let rep = send('/discipline #JALT warn Testing my own account');
  // (the hardening's rank check refuses one's own account in the console first, ownAccount; discipline.js refuses it in game)
  check("E3. never one's own account: Jake on Jake Alt (profile 1) is refused (ownAccount), nothing recorded", rep && rep.state === 'refused' && rep.why === 'ownAccount' && JSON.stringify(recordOf(1)) === before, rep);
  rep = send('/discipline #LLX8 lift appeal accepted');
  check('E3. a lift with no running suspension: "Lydia #LLX8 is not suspended."', rep && header(rep) === 'Lydia #LLX8 is not suspended or banned.' && recordOf(6).length === 1, rep);
  rep = send('/discipline #LLX8 overturn 9 no such record');
  check('E3. an overturn of a record the account does not have: "has no record #9", nothing recorded', rep && /^Lydia #LLX8 has no record #9\./.test(header(rep)) && recordOf(6).length === 1, rep);
  rep = send('/discipline #8KWH overturn 5 overturn the overturn');
  check('E3. an overturn of an overturn is refused by discipline.js', rep && /That entry is itself an overturn/.test(header(rep)), rep);
  rep = send('/discipline #8KWH overturn 2 again please');
  check('E3. a record already overturned: "#2 was already overturned by Jake #ABCD."', rep && header(rep) === '#2 was already overturned by Jake #ABCD.', rep);
  // A Lead GM passes the console's floor and discipline.js's Lead-GM kinds; she may discipline staff below her (Gemma, GM), as
  // in game. A Developer (Nate) is at or above her rank: the hardening refuses that from the console (console-hardening-harness H1)
  reset();
  rep = send('/discipline #GMGM suspend 12h tested a dupe on the live server', AS_LEAD);
  check('E3. a pinned Lead GM suspends from the console (suspend is Lead GM and above in discipline.js)', rep && rep.state === 'ran' && /^Recorded: suspend #1 on Gemma #GMGM until /.test(header(rep)) && rep.tier === 'leadgm', rep);
  rep = send('/discipline #GMGM lift it was a test server', AS_LEAD);
  check('E3. ...and lifts it', rep && rep.state === 'ran' && /^Recorded: lift #2 on Gemma #GMGM\./.test(header(rep)), rep);
  // A GM never reaches discipline.js from the console: the floor in code is Lead GM
  reset();
  rep = send('/discipline #8KWH warn Gemma tries the console', { discordId: ID.gm, profileId: 3, roles: [ROLE.gm], user: 'gemma' });
  check('E3. a pinned GM is refused (tier) before the gate: nothing recorded, no staff line', rep && rep.why === 'tier' && !staffLines.length && recordOf(5).length === 6, rep);
}

// ---- E4. refused lines never reach the gate or discipline.js -----------------------------------------------------------------
reset();
{
  const n5 = recordOf(5).length;
  const lines = [
    ['/discipline Bob warn spamming the chat', 'needTag'], ['/discipline #8KWH', 'badKind'], ['/discipline list', 'badKind'], ['/discipline #8KWH note quiet staff note', 'badKind'],
    ['/discipline #8KWH suspend 1.5d stole from a barrel', 'badLength'], ['/discipline #8KWH suspend 31d stole from a barrel', 'badLength'], ['/discipline #8KWH overturn #3 wrong person', 'badRecord'],
    ['/discipline #8KWH warn #{ff0000}red text for everyone', 'reasonChars'], ['/discipline #8KWH warn <@200000000000000001> hi there', 'reasonChars'], ['/discipline #8KWH warn hi', 'reasonShort'],
    [`/discipline #8KWH warn ${R300}x`, 'reasonLong'], ['/discipline #ZZZZ warn nobody carries this tag', 'targetAny'], ['/kick #8KWH spamming the chat', 'needTag'],
  ];
  const wrong = lines.map(([t, why]) => [t, why, send(t)]).filter(([, why, rep]) => !rep || rep.state !== 'refused' || rep.why !== why);
  check('E4. each refused line is refused by the reader with its class', !wrong.length, wrong.map(([t, why, rep]) => [t, why, rep && rep.state, rep && rep.why]));
  check('E4. ...none reached #staff-commands or the record, and nobody was kicked', !staffLines.length && recordOf(5).length === n5 && !kicked.length, { staffLines, kicked });
  const r = send('/discipline #8KWH warn #{ff0000}red text');
  check('E4. the refusal tells the admin which characters a reason takes', /^A reason from the console takes letters, numbers, spaces/.test(header(r)), r);
  const raw = send('/discipline #8KWH warn #{ff0000}red text', { raw: true });
  const nl = send('/discipline #8KWH warn spamming the chat\n/kick #LLX8', { raw: true });
  check('E4. a request whose text the backend did not clean (a raw colour code, a newline) is refused as bad, nothing runs', raw && raw.state === 'bad' && nl && nl.state === 'bad' && !kicked.length && recordOf(5).length === n5, [raw, nl]);
  store.get(A.lydia)['private.charTag'] = 'BOB2'; setOnline(A.lydia, false);
  const dup = send('/discipline #BOB2 warn two characters carry it');
  check('E4. a tag two characters carry (none online) is refused as tagShared, nothing recorded', dup && dup.why === 'tagShared' && recordOf(5).length === n5, dup);
  store.get(A.lydia)['private.charTag'] = 'LLX8'; setOnline(A.lydia, true);
  globalThis.__dboFormGone = (id) => (id >>> 0) === A.bobAlt;
  const gone = send('/discipline #BOB2 warn a deleted character');
  check('E4. a deleted character in the tag index is not a target', gone && gone.why === 'targetAny', gone);
  globalThis.__dboFormGone = undefined;
}

// ---- E5. dry run: the gate only; the reply says the record's own checks did not run -----------------------------------------
reset();
{
  const n5 = recordOf(5).length;
  const rep = send('/discipline #8KWH suspend 3d stole from a barrel', { mode: 'dry-run' });
  check('E5. a dry run passes the console and the gate, records nothing, kicks nobody, writes no staff line', rep && rep.state === 'dry-run' && rep.target === 'Bob #8KWH' && recordOf(5).length === n5 && !kicked.length && !staffLines.length, rep);
  check('E5. ...and says that the record\'s own checks did not run', rep && /^Dry run: it passed the console and the command gate only\. Nothing was recorded, and the record's own checks .* did not run\.$/.test(header(rep)), rep && rep.lines);
  const own = send('/discipline #LLX8 lift Lydia is not suspended', { mode: 'dry-run' });
  check('E5. ...so a dry run of a line discipline.js would refuse (a lift with nothing to lift) still reads dry-run, with that warning', own && own.state === 'dry-run' && /Dry run/.test(header(own)), own);
  setSwitch('dry-run\n');
  const sw = send('/discipline #8KWH warn the switch is at dry run');
  check('E5. the switch at dry-run forces it for /discipline too', sw && sw.state === 'dry-run' && recordOf(5).length === n5, sw);
  setSwitch('on\n');
  const k = send('/kick #8KWH', { mode: 'dry-run' });
  check('E5. a /kick dry run carries no record warning (it is no record)', k && k.state === 'dry-run' && !k.lines.some((l) => /Dry run/.test(l.text)), k);
}

// ---- E6. /kick from the console: unchanged, one online #TAG, no reason -----------------------------------------------------
reset();
{
  const k = send('/kick #LLX8');
  check('E6. /kick #LLX8 ran: Lydia is kicked, everyone reads who did it', k && k.state === 'ran' && kicked.includes(store.get(A.lydia).__user) && k.lines.some((l) => l.to === 'all' && /Lydia was kicked by Jake/.test(l.text)), k);
  setOnline(A.bob, false);
  check('E6. /kick of an offline character is refused (online only)', (send('/kick #8KWH') || {}).why === 'target');
  setOnline(A.bob, true);
}

// ---- E7. the repo's own config -------------------------------------------------------------------------------------------
{
  const rc = REPO_CFG.remoteConsole || {};
  check('E7. the repo config denies nothing, so every kind is on once console.js ships (narrow it with deny "discipline <kind>")', Array.isArray(rc.deny) && !rc.deny.length);
  check('E7. the repo config keeps discipline.maxSuspendDays 30', (REPO_CFG.discipline || {}).maxSuspendDays === 30);
  logs.length = 0; loadConsole(CFG());
  // eleven, and /ban, /tempban, /unban from 25 Oct
  check('E7. the reader counts nineteen commands (/unstuck and the staff item and spell commands since 28 Oct)', logs.some((l) => /console: reader on .*, 19 commands, floor leadgm, game pin 4$/.test(l)), logs);
}

// ---- E8. review (21 Oct): a suspended account cannot act from the console; a reason of blank letters is no reason -------------
reset();
{
  let rep = send('/discipline #LEAD suspend 3d a suspended caller is refused');
  check('E8. Jake suspends Leda (Lead GM)', rep && rep.state === 'ran' && /^Recorded: suspend #\d+ on Leda #LEAD until /.test(header(rep)), rep);
  reset();
  const n5 = recordOf(5).length, n1 = recordOf(1).length;
  const web = send('/discipline #8KWH strike acting while suspended', AS_LEAD);
  const disc = send('/discipline #ABCD suspend 30d acting while suspended', Object.assign({ src: 'discord' }, AS_LEAD));
  const kick = send('/kick #LLX8', Object.assign({ src: 'discord' }, AS_LEAD));
  check('E8. ...then Leda, suspended, is refused (suspended) from the web and from Discord, for /discipline and /kick alike', [web, disc, kick].every((x) => x && x.state === 'refused' && x.why === 'suspended')
    && header(web) === 'Your account is suspended, so the console cannot act as you: a suspended account cannot act in game either.', [web, disc, kick]);
  check('E8. ...and nothing reached the gate: no record, no staff line, nobody kicked', recordOf(5).length === n5 && recordOf(1).length === n1 && !staffLines.length && !kicked.length, { staffLines, kicked });
  const hook = globalThis.__dboVoiceRefused;
  globalThis.__dboVoiceRefused = () => { throw new Error('record unreadable'); };
  const thrown = send('/discipline #LLX8 warn the check throws here', { mode: 'dry-run' });
  globalThis.__dboVoiceRefused = null;
  const off = send('/discipline #LLX8 warn discipline is switched off', Object.assign({ mode: 'dry-run' }, AS_LEAD));
  globalThis.__dboVoiceRefused = hook;
  check('E8. a suspension check that throws refuses (as suspended); with discipline.js off (no check) the console does not refuse for it', thrown && thrown.why === 'suspended' && off && off.state === 'dry-run', [thrown, off]);
  rep = send('/discipline #LEAD lift review over, she may act again');
  const back = send('/discipline #LLX8 warn back on duty after the lift', AS_LEAD);
  check('E8. once Jake lifts it, Leda acts again', rep && rep.state === 'ran' && back && back.state === 'ran' && /^Recorded: warn #\d+ on Lydia #LLX8\.$/.test(header(back)), [rep, back]);
  const blanks = [ch(0x3164).repeat(5), ch(0x115f).repeat(5), ch(0x1160).repeat(5), ch(0xffa0).repeat(5), `ok ${ch(0x3164)} reason`].map((x) => decide(`/discipline #8KWH warn ${x}`).why);
  check('E8. a reason holding a Hangul filler (a letter that draws nothing) is refused as reasonChars', blanks.every((w) => w === 'reasonChars'), blanks);
}

// ---- E9. /ban, /tempban, /unban from the console (Nat, 25 Oct: "discord commands that correlate so lead GMs can use it") ------
reset();
{
  const n5 = recordOf(5).length;
  let rep = send('/ban #8KWH threats against players, ticket 0200', AS_LEAD);
  const b = recordOf(5)[n5] || {};
  check('E9. a pinned Lead GM bans Bob from the console: "Recorded: ban #n on Bob #8KWH permanently.", a ban record with no end', rep && rep.state === 'ran' && rep.tier === 'leadgm'
    && /^Recorded: ban #\d+ on Bob #8KWH permanently\.$/.test(header(rep)) && b.kind === 'ban' && b.until === undefined && b.by === 'Leda #LEAD', { rep, b });
  check('E9. ...Bob is logged out with "banned permanently", and the #staff-commands line names /ban', kicked.includes(store.get(A.bob).__user)
    && packets.some(([a, p]) => a === A.bob && p.customPacketType === 'kicked' && /^Your account is banned permanently\. Reason: threats against players/.test(p.reason))
    && staffLines.length === 1 && /\(Lead GM\): \/ban #8KWH threats against players, ticket 0200 \[remote web [0-9a-f]{8}\]$/.test(staffLines[0].detail), { packets, staffLines });
  check('E9. ...the DISCIPLINE audit line says permanently', audits().some((l) => /^DISCIPLINE ban #\d+ on Bob #8KWH .* permanently by Leda #LEAD .*: threats against players, ticket 0200$/.test(l)), audits().slice(-3));
  reset();
  rep = send('/unban #8KWH appeal accepted on ticket 0201', Object.assign({ src: 'discord' }, AS_LEAD));
  check('E9. /unban from Discord lifts it (the lift kind)', rep && rep.state === 'ran' && /^Recorded: lift #\d+ on Bob #8KWH\./.test(header(rep)) && recordOf(5)[n5].lifted === true, rep);
  rep = send('/tempban #8KWH 3d stole from a barrel', AS_LEAD);
  check('E9. /tempban 3d suspends for 3 days', rep && rep.state === 'ran' && /^Recorded: suspend #\d+ on Bob #8KWH until /.test(header(rep)), rep);
  rep = send('/ban #8KWH a fourth hold in the hour', AS_LEAD);
  check('E9. the console cap counts bans and temp bans with the suspensions (3 an hour on one account): the next is suspendCap', rep && rep.why === 'suspendCap', rep);
  reset();
  const n5b = recordOf(5).length, n6 = recordOf(6).length;
  rep = send('/ban #8KWH Gemma tries to ban', { discordId: ID.gm, profileId: 3, roles: [ROLE.gm], user: 'gemma' });
  check('E9. a pinned GM is refused /ban by the floor (tier), nothing recorded, no staff line', rep && rep.why === 'tier' && recordOf(5).length === n5b && !staffLines.length, rep);
  rep = send('/ban #LLX8 <@200000000000000001> pinged', AS_LEAD);
  check('E9. a bad reason is refused (reasonChars) before the gate', rep && rep.why === 'reasonChars' && recordOf(6).length === n6 && !staffLines.length, rep);
  rep = send('/ban #NNAT a Lead GM bans a Developer', AS_LEAD);
  check('E9. a Lead GM cannot ban a Developer account from the console (rank)', rep && rep.why === 'rank' && !recordOf(2).some((e) => e.kind === 'ban'), rep);
  rep = send('/ban #LEAD banning my own account', AS_LEAD);
  check('E9. ...nor her own account (ownAccount)', rep && rep.why === 'ownAccount', rep);
}

global.setTimeout = realTimeout;
fs.rmSync(SCRATCH, { recursive: true, force: true });
console.log('');
console.log(failures ? `${failures} FAILED of ${checks}` : `all ${checks} checks passed`);
process.exit(failures ? 1 : 0);
