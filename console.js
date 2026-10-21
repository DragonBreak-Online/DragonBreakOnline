// DragonBreak Online: the remote staff console, game side (Jake, 13 Oct: "/wwremote clear #8KWH ... through a remote
// console or even in discord", admins only). Loaded last by gamemode.js on every hot reload, after every module has
// registered its commands. Design: /root/dragonbreak-jake/console/design/DESIGN.md, sections 6 to 8.
//
// The backend (skymp5-backend sources/console) writes one HMAC-signed JSON request per command into
// /run/dragonbreak-console/in/ (tmpfs, root 0700). Every 500 ms this module claims what is waiting by renaming it into
// work/, so a request runs at most once, and checks everything again itself: the signature and a 10 s window, the ids
// already seen, the switch file, the game's own pin of Discord ids, its own limits, the caller (the admin's own
// character, stamped with the same Discord id), the tier (the lower of the roles the backend just fetched and the roles
// stamped at login, Lead GM or above), the allowlist and its argument rule, and that a #TAG target is exactly one
// online player. Then the line goes through gamemode.js handleLine, the gate typed chat uses (admin flag, LEAD_ONLY, the
// #staff-commands line), inside captureFor, and a signed reply goes into out/.
//
// No listener, no shell, no network: a file in, a file out. The tick never throws (a missing or bad spool counts as off),
// and a reader left behind by a gamemode generation that did not load this module stops itself (the generation guard).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PATHS = Object.freeze({ spool: '/run/dragonbreak-console', key: '/etc/dragonbreak/console.key', switch: '/etc/dragonbreak/console' });
const TICK_MS = 500;
const MAX_FILE_BYTES = 8192;
// Never block the game's thread on a spool or switch path: a FIFO (or a device) opened O_NONBLOCK returns at once, and then
// fails the fstat isFile check. A blocking open of a FIFO with no writer would hang every player until a writer came
const NOBLOCK_READ = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
const MAX_SWITCH_BYTES = 64;
const MAX_WAITING = 50;          // more than this waiting: every one is refused as busy (a flood)
const PER_TICK = 5;              // so a tick stays short
const FUTURE_SKEW_MS = 2000;     // one clock on CT 115; a request from further ahead than this is refused
const TTL_MAX_MS = 10000;
const SEEN_MS = 10 * 60 * 1000;
const WORK_KEEP_MS = 60 * 60 * 1000;
const OUT_KEEP_MS = 15 * 60 * 1000;
const LIMITS = Object.freeze({ perProfile: 10, all: 60, windowMs: 60 * 1000 });
const MAX_LINES = 40, MAX_CHARS = 4000, MAX_LINE = 500;
const LOG_EVERY_MS = 60 * 1000;
// The lowest tier the console ever lets in, in code (Jake, 14 Oct: "Jake, Nate and Lead GMs"). gamemode-config
// remoteConsole.minTier can raise it (developer, senior), never lower it, so a GM or a Trial GM is refused whatever the
// config says. Above the floor every command keeps its own in-game checks (the admin flag, LEAD_ONLY, the handler's own)
const CODE_FLOOR = 'leadgm';
const FLOOR_LABEL = Object.freeze({ leadgm: 'Lead GM', developer: 'Developer', senior: 'Senior' });

const ID_RE = /^(w-[0-9a-f-]{36}|d-\d{17,20})$/;
const SNOWFLAKE = /^\d{17,20}$/;
const USER_RE = /^[a-z0-9_.]{2,32}$/;
const TAG_RE = /^#[A-Za-z0-9]{4}$/;
// gamemode.js NAME_RE: the rename handler's own rule for a new name
const NAME_RE = /^[A-Za-z][A-Za-z' -]{1,30}$/;
// The backend's cleaning set (serverControl.js UNSAFE_RE): C0, DEL, soft hyphen, zero-width and bidi controls, the line and
// paragraph separators, BOM, C1 and the Arabic letter mark
const UNSAFE_RE = /[\u0000-\u001f\u007f\u00ad\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff\u0080-\u009f\u061c]/g;
const SETTINGS = ['off', 'dry-run', 'on'];
const REQ_KEYS = ['v', 'id', 'src', 'discordId', 'user', 'profileId', 'roles', 'text', 'mode', 'issuedAt', 'expiresAt', 'sig'];
// Chat markup the client reads: the PM sender, the system and admin tabs, the bubble tag and colour codes
const MARKUP_RE = /\[\[(?:PM\]\][^|\]]{0,64}\||S\]\]|A\]\]|B[0-9a-fA-F]{1,8}\]\])|#\{[0-9a-fA-F]{6}\}/g;
// A console reason (rule tagKindReason), after cleanCommand's folding (NFC; control, zero-width and bidi characters to
// spaces; whitespace collapsed): plain words only. Letters, digits, the space and . , ; : ! ? ' " ( ) - / & + %; so no '#{'
// colour code, no '[[' ']]' chat markup, no '<' '>' '@' mention, no '|' (the PM sender's end), no backtick, '\' '*' '_' '~'
// (Discord markdown in the audit channel) and no symbol or emoji. Nothing outside the Basic Multilingual Plane either, so its
// code points are the UTF-16 units discipline.js counts when it cuts a reason at 300: 5 to 300 of them, so the game never
// cuts or refuses for length a reason the console let through
const REASON_RE = /^[\p{L}\p{N} .,;:!?'"()\/&+%-]+$/u;
const ASTRAL_RE = /[\ud800-\udfff]/;
// The four letters that draw nothing (the Hangul fillers, default-ignorable): five of them made a reason that reads as empty
const BLANK_RE = /[\u115f\u1160\u3164\uffa0]/;
const REASON_MIN = 5, REASON_MAX = 300;
// The record kinds the console takes for /discipline (Jake, 21 Oct: "We need all options to be available under punishment"),
// and the one word each takes before its reason, as discipline.js reads them: none; a length, whole hours or days
// (discipline.js also takes '1.5d' and '0.01h', the console does not), at most the config's maxSuspendDays; a record
// number, digits only (discipline.js also takes '#3', the console does not). Not the record view (/discipline #TAG) or list
const KIND_ARGS = Object.freeze({ warn: 'none', strike: 'none', suspend: 'length', lift: 'none', overturn: 'record' });
const LENGTH_RE = /^(?:([1-9][0-9]{0,2})h|([1-9][0-9]?)d)$/;
const RECORD_RE = /^[1-9][0-9]{0,4}$/;
const MAX_SUSPEND_DAYS = 30; // discipline.js DEFAULTS.maxSuspendDays

// ---- the v1 allowlist (DESIGN section 8.1). Widening it is a code change and a review; gamemode-config can only narrow it.
// rule: switch = none | on | off | clear #TAG; tag = #TAG (noArg: what the empty form would do); tagName = #TAG <new name>;
// load = none | reset; none = no argument; tagKindReason = #TAG <kind> [<length>|<n>] <reason>, kind one of `kinds` (each
// with its KIND_ARGS word), reason held to REASON_RE. offline: the #TAG may name an offline character (one live form in the
// tag index). help: what the page lists instead of the registry's help (which names forms the console refuses).
// Free text: /rename's new name, held to NAME_RE, and /discipline's reason (Jake, 21 Oct: "allow /discipline in the web
// console too"), held to REASON_RE above, so the only words that reach #staff-commands and the audit channel are plain ones.
// Review SEC-2 took the 'any' rule away (/players took any words, and they reached #staff-commands); there is still none.
// gamemode-config remoteConsole.deny takes a command ('discipline') or one kind of it ('discipline suspend')
const ALLOW = Object.freeze({
  wwremote: { usage: '/wwremote [on|off|clear #TAG]', rule: 'switch' },
  vlremote: { usage: '/vlremote [on|off|clear #TAG]', rule: 'switch' },
  kick: { usage: '/kick #TAG', rule: 'tag', noArg: 'needTag',
    help: 'Kicks one online character, named by #TAG. It takes no reason, and they can log straight back in.' },
  fixloc: { usage: '/fixloc #TAG', rule: 'tag', noArg: 'self' },
  rename: { usage: '/rename #TAG <new name>', rule: 'tagName', offline: true },
  chars: { usage: '/chars #TAG', rule: 'tag', noArg: 'needTag', offline: true },
  chargen: { usage: '/chargen #TAG', rule: 'tag', noArg: 'self', noBeast: true },
  players: { usage: '/players', rule: 'none' },
  load: { usage: '/load [reset]', rule: 'load' },
  whoami: { usage: '/whoami', rule: 'none' },
  // A warning, strike, suspension, lift or overturn on the account's record, as typed in game; discipline.js keeps its own
  // checks (suspend, lift and overturn need a Lead GM, so do staff targets; never one's own account; a lift needs a running
  // suspension, an overturn a record of the account). The record view and /discipline list stay in game
  // (its usage is written out from the kinds left after the config's deny, usageOf below)
  discipline: { usage: '/discipline #TAG <kind> <reason>', rule: 'tagKindReason', kinds: Object.freeze(Object.keys(KIND_ARGS)), offline: true,
    help: "A warning, strike, suspension, lift or overturn on the player's account record, as in game; the player is told. The record view and list stay in game." },
});
// Why the rest are refused, by class (DESIGN 8.2). Built-ins that are not registry commands are notChat; any other
// registry command is notYet
const IN_WORLD = new Set(['npc', 'placed', 'jail', 'setweather', 'war', 'region', 'warband', 'raid', 'property', 'dungeon', 'whereami', 'teach']);
const SELF = new Set(['tp', 'gm', 'masktest', 'mv', 'placeundo', 'factiongear', 'tailoring', 'smithing', 'beastform', 'makesuper', 'unstuck', 'appearance']);
const LATER = new Set(['bugs', 'update', 'schedule']);
const BUILTIN = new Set(['say', 'low', 'whisper', 'wide', 'shout', 'me', 'melow', 'melong', 'my', 'mylow', 'mylong', 'do', 'dolow', 'dolong',
  'looc', 'ooc', 'ooclow', 'ooclong', 'pm', 'dm', 'to', 'too', 'system', 'admin']);

const TEXT = {
  needTag: () => 'Name the player by #TAG from the console.',
  target: (x) => `${x} is not online (or no such tag).`,
  targetAny: (x) => `No character carries ${x} (or more than one does).`,
  beast: (x) => `${x} is in a beast form. /chargen waits until they change back.`,
  inWorld: (cmd) => `/${cmd} needs you standing in the world. Run it in game.`,
  self: (cmd) => `/${cmd} acts on your own character. Run it in game.`,
  later: (cmd) => `/${cmd} answers later. That is not in the console yet.`,
  notChat: (cmd) => (cmd === 'system' ? 'Only staff commands can be run from the console. Use /announce when it comes to the console.'
    : 'Only staff commands can be run from the console.'),
  notYet: (cmd) => `/${cmd} is not available from the console in v1.`,
  denied: (cmd) => `/${cmd} is switched off for the console in the game's config.`,
  badArgs: (cmd) => `From the console: ${ALLOW[cmd] ? ALLOW[cmd].usage : `/${cmd}`}`,
  badName: () => 'Names: 2-31 letters, spaces, apostrophes or hyphens, starting with a letter.',
  // The tagKindReason refusals: the subject is the usage (badKind), the config's maxSuspendDays (badLength)
  badKind: (usage) => `From the console: ${usage || '/discipline'}. A player's record and /discipline list stay in game.`,
  badLength: (max) => `Give a length in whole hours or days, ${lengthWords(Number(max) || MAX_SUSPEND_DAYS)}, like 12h or 3d.`,
  badRecord: () => 'Give the record number in digits, like overturn 3 <reason>. /discipline #TAG in game shows the record.',
  // The backend's alone (allowlist.js, the same words): a reason line typed with a line break in it
  oneLine: () => 'From the console: one line of at most 500 characters.',
  reasonShort: () => `Give a reason of at least ${REASON_MIN} characters. The player is shown it.`,
  reasonLong: () => `The reason can be at most ${REASON_MAX} characters.`,
  reasonChars: () => 'A reason from the console takes letters, numbers, spaces and . , ; : ! ? \' " ( ) - / & + % only: no colour codes, markup, mentions, symbols or line breaks.',
  dryRecord: () => "Dry run: it passed the console and the command gate only. Nothing was recorded, and the record's own checks (own account, staff target, record number, is suspended) did not run.",
  noChar: () => 'The console acts as your own character. Make one in game first.',
  suspended: () => 'Your account is suspended, so the console cannot act as you: a suspended account cannot act in game either.',
  tier: (floor) => `The console is for ${floor || 'Lead GM'} and above in game.`,
  rolesChanged: () => 'Your Discord roles changed since you last logged in (or your character has not been stamped with them yet). Log in once.',
  notPinned: () => "This Discord account is not on the game's console list.",
  tooMany: () => 'Too many console commands. Wait a minute.',
  off: () => 'The console is switched off in the game.',
  expired: () => 'The request reached the game too late, so it was not run.',
  busy: () => 'Too many requests were waiting, so none was run.',
  bad: () => 'The request could not be read or verified, so it was not run.',
  unknown: () => 'Only staff commands can be run from the console.',
  gate: () => 'The in-game command gate refused it.',
  failed: () => 'That command failed in the game.',
};

// ---- rules shared with the backend (skymp5-backend sources/console/allowlist.js keeps the same code) -------------------
const cleanCommand = (value) => {
  if (typeof value !== 'string') return null;
  let t = value.normalize('NFC').replace(UNSAFE_RE, ' ').replace(/\s+/g, ' ').trim();
  if (/^[A-Za-z]/.test(t)) t = `/${t}`;
  if (t.length > 500) return null;
  const m = /^\/([A-Za-z]{2,24})(?: (.*))?$/.exec(t);
  if (!m) return null;
  return `/${m[1].toLowerCase()}${m[2] !== undefined ? ` ${m[2]}` : ''}`.split('#{').join('# {');
};
// One line of at most 64 bytes: off | dry-run | on, then web=<setting> and discord=<setting>, which only narrow it.
// Anything else, a key twice, a missing or unreadable file: off for both
const parseSwitch = (text) => {
  const OFF = { web: 'off', discord: 'off' };
  if (typeof text !== 'string' || Buffer.byteLength(text) > 64) return OFF;
  const body = text.replace(/\r?\n$/, '');
  if (/[\r\n]/.test(body)) return OFF;
  const words = body.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || !SETTINGS.includes(words[0])) return OFF;
  const out = { web: words[0], discord: words[0] }; const keys = new Set();
  for (const w of words.slice(1)) {
    const m = /^(web|discord)=(off|dry-run|on)$/.exec(w);
    if (!m || keys.has(m[1])) return OFF;
    keys.add(m[1]);
    if (SETTINGS.indexOf(m[2]) < SETTINGS.indexOf(out[m[1]])) out[m[1]] = m[2];
  }
  return out;
};
// discipline.js's maxSuspendDays as it reads it (its default, else the config's value), or 0 when it allows no length
const maxDaysOf = (cfg) => {
  const d = cfg && typeof cfg.discipline === 'object' && cfg.discipline ? cfg.discipline : {};
  const n = d.maxSuspendDays === undefined ? MAX_SUSPEND_DAYS : Number(d.maxSuspendDays);
  return Number.isFinite(n) && n * 24 >= 1 ? n : 0;
};
const lengthWords = (maxDays) => { const h = Math.floor(maxDays * 24), d = Math.floor(maxDays); return d >= 1 ? `1h to ${h}h or 1d to ${d}d` : `1h to ${h}h`; };
const lengthShort = (maxDays) => { const h = Math.floor(maxDays * 24), d = Math.floor(maxDays); return d >= 1 ? `1-${h}h|1-${d}d` : `1-${h}h`; };
// A suspension's length word -> whole hours, else 0: '12h' or '3d', no decimals, no leading zero, within maxDays as
// discipline.js lengthMs counts it (n x 1 h or n x 1 d against maxDays x 1 d), so the game takes every length the console does
const lengthHours = (word, maxDays) => {
  const m = LENGTH_RE.exec(String(word || '').toLowerCase());
  if (!m) return 0;
  const h = m[1] ? Number(m[1]) : Number(m[2]) * 24;
  return h * 3600000 <= maxDays * 86400000 ? h : 0;
};
// What is wrong with a console reason, or '' when it may run (REASON_RE above)
const reasonWhy = (reason) => {
  if (!reason) return 'reasonShort';
  if (ASTRAL_RE.test(reason) || BLANK_RE.test(reason) || !REASON_RE.test(reason)) return 'reasonChars';
  if (reason.length < REASON_MIN) return 'reasonShort';
  return reason.length > REASON_MAX ? 'reasonLong' : '';
};
// The kinds a tagKindReason command takes here: its own, less those the config denies ('discipline suspend'), and suspend
// only while the config allows a length at all
const kindsOf = (cmd, deny, maxDays) => {
  const a = Object.prototype.hasOwnProperty.call(ALLOW, cmd) ? ALLOW[cmd] : null;
  if (!a || a.rule !== 'tagKindReason' || deny.has(cmd)) return [];
  return a.kinds.filter((k) => !deny.has(`${cmd} ${k}`) && !(KIND_ARGS[k] === 'length' && !(maxDays > 0)));
};
// The usage the page, Discord and the refusals show, for the kinds that are left
const usageOf = (cmd, kinds, maxDays) => {
  const plain = kinds.filter((k) => KIND_ARGS[k] === 'none');
  const parts = plain.length ? [`${plain.join('|')} <reason>`] : [];
  for (const k of kinds) {
    if (KIND_ARGS[k] === 'length') parts.push(`${k} <${lengthShort(maxDays)}> <reason>`);
    if (KIND_ARGS[k] === 'record') parts.push(`${k} <n> <reason>`);
  }
  return `/${cmd} #TAG ${parts.join('; ')}`;
};
const reqPayload = (r) => `dbo-console-req-v1\n${JSON.stringify([r.v, r.id, r.src, r.discordId, r.user, r.profileId, r.roles, r.text, r.mode, r.issuedAt, r.expiresAt])}`;
const canonLines = (lines) => lines.map((l) => ({ to: String(l.to), text: String(l.text) }));
const repPayload = (r) => `dbo-console-rep-v1\n${JSON.stringify([r.v, r.id, r.state, r.gate, r.ranAs, r.online, r.tier, r.target, canonLines(r.lines), r.why, r.at])}`;
const hmac = (key, text) => crypto.createHmac('sha256', key).update(text, 'utf8').digest();
const id8 = (id) => (String(id).startsWith('w-') ? String(id).slice(2, 10) : String(id).slice(-8));

// What the argument rule says about one cleaned line: { cmd, body, tag } to run, or { cmd, why, subject? } refused (subject:
// what the refusal's text names, else the command). opts.maxSuspendDays: discipline's, from maxDaysOf (its default without)
const checkLine = (text, has, deny, opts) => {
  const m = /^\/([a-z]{2,24})(?: (.*))?$/.exec(text || '');
  if (!m) return { cmd: '', why: 'notChat' };
  const cmd = m[1]; const body = m[2] === undefined ? '' : m[2];
  const rule = Object.prototype.hasOwnProperty.call(ALLOW, cmd) ? ALLOW[cmd] : null;
  if (!rule) {
    if (BUILTIN.has(cmd) || !has(cmd)) return { cmd, why: 'notChat' };
    return { cmd, why: IN_WORLD.has(cmd) ? 'inWorld' : SELF.has(cmd) ? 'self' : LATER.has(cmd) ? 'later' : 'notYet' };
  }
  if (deny.has(cmd)) return { cmd, why: 'denied' };
  if (!has(cmd)) return { cmd, why: 'notYet' };
  const words = body ? body.split(' ') : [];
  switch (rule.rule) {
    case 'switch': {
      const v = (words[0] || '').toLowerCase();
      if (!words.length || ((v === 'on' || v === 'off') && words.length === 1)) return { cmd, body };
      if (v === 'clear') return words.length === 2 && TAG_RE.test(words[1]) ? { cmd, body, tag: words[1] } : { cmd, why: 'needTag' };
      return { cmd, why: 'badArgs' };
    }
    case 'tag':
      if (!words.length) return { cmd, why: rule.noArg };
      return words.length === 1 && TAG_RE.test(words[0]) ? { cmd, body, tag: words[0] } : { cmd, why: 'needTag' };
    case 'tagName': {
      if (!words.length || !TAG_RE.test(words[0])) return { cmd, why: words.length ? 'needTag' : 'badArgs' };
      if (words.length < 2) return { cmd, why: 'badArgs' };
      return NAME_RE.test(words.slice(1).join(' ')) ? { cmd, body, tag: words[0] } : { cmd, why: 'badName' };
    }
    case 'load': return !words.length || (words.length === 1 && words[0].toLowerCase() === 'reset') ? { cmd, body } : { cmd, why: 'badArgs' };
    case 'none': return words.length ? { cmd, why: 'badArgs' } : { cmd, body };
    // #TAG <kind> [<length>|<n>] <reason>: one target by tag, never a name; a fixed kind word; the kind's own word; a reason
    case 'tagKindReason': {
      const maxDays = opts && opts.maxSuspendDays !== undefined ? opts.maxSuspendDays : MAX_SUSPEND_DAYS;
      const kinds = kindsOf(cmd, deny, maxDays);
      if (!kinds.length) return { cmd, why: 'denied' };
      const usage = usageOf(cmd, kinds, maxDays);
      // No #TAG first: the bare command and 'list' are the record views (they stay in game); anything else is a name
      if (!words.length || !TAG_RE.test(words[0])) return words.length && words[0].toLowerCase() !== 'list' ? { cmd, why: 'needTag' } : { cmd, why: 'badKind', subject: usage };
      const kind = (words[1] || '').toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(KIND_ARGS, kind) || !rule.kinds.includes(kind)) return { cmd, why: 'badKind', subject: usage };
      if (!kinds.includes(kind)) return { cmd, why: 'denied', subject: `${cmd} ${kind}` };
      const arg = KIND_ARGS[kind];
      if (arg === 'length' && !lengthHours(words[2], maxDays)) return { cmd, why: 'badLength', subject: maxDays };
      if (arg === 'record' && !RECORD_RE.test(words[2] || '')) return { cmd, why: 'badRecord' };
      const why = reasonWhy(words.slice(arg === 'none' ? 2 : 3).join(' '));
      return why ? { cmd, why } : { cmd, body, tag: words[0], kind };
    }
    default: return { cmd, why: 'notYet' };
  }
};

// The request's shape, without the signature: '' when it is well formed, else what is wrong
const checkShape = (r, fileId) => {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'not an object';
  const keys = Object.keys(r);
  if (keys.length !== REQ_KEYS.length || !REQ_KEYS.every((k) => keys.includes(k))) return 'keys';
  if (r.v !== 1) return 'version';
  if (typeof r.id !== 'string' || !ID_RE.test(r.id) || r.id !== fileId) return 'id';
  if (!((r.src === 'web' && r.id.startsWith('w-')) || (r.src === 'discord' && r.id.startsWith('d-')))) return 'src';
  if (typeof r.discordId !== 'string' || !SNOWFLAKE.test(r.discordId)) return 'discordId';
  if (typeof r.user !== 'string' || !(USER_RE.test(r.user) || r.user === 'unknown')) return 'user';
  if (!Number.isSafeInteger(r.profileId) || r.profileId < 0) return 'profileId';
  if (!Array.isArray(r.roles) || r.roles.length > 100 || !r.roles.every((x) => typeof x === 'string' && SNOWFLAKE.test(x))) return 'roles';
  if (typeof r.text !== 'string' || r.text.length > 500 || cleanCommand(r.text) !== r.text) return 'text';
  if (r.mode !== 'on' && r.mode !== 'dry-run') return 'mode';
  if (!Number.isSafeInteger(r.issuedAt) || !Number.isSafeInteger(r.expiresAt) || r.expiresAt <= r.issuedAt || r.expiresAt - r.issuedAt > TTL_MAX_MS) return 'time';
  if (typeof r.sig !== 'string' || !/^[0-9a-f]{64}$/.test(r.sig)) return 'sig';
  return '';
};

// A chat line as the admin reads it on the page or in Discord: no client markup, no control characters, one line
const plainLine = (text) => String(text).replace(MARKUP_RE, '').replace(UNSAFE_RE, ' ').replace(/\s+/g, ' ').trim();
const replyLines = (lines) => {
  const out = []; let size = 0;
  for (const l of lines) {
    if (out.length >= MAX_LINES) break;
    let text = plainLine(l.text);
    if (!text) continue;
    if (text.length > MAX_LINE) text = `${text.slice(0, MAX_LINE)}...`;
    if (size + text.length > MAX_CHARS) break;
    size += text.length;
    out.push({ to: String(l.to), text });
  }
  return out;
};

module.exports = (api) => {
  const { mp, log, audit, every, stopTimer, cfg, commands, handleLine, tagOf, profileOf, discordOf, userOf, display, who,
    staffTierFrom, staffTierOf, TIER_RANK, captureFor, onlineActors, gen } = api;
  // The harness points these at a scratch spool; gamemode.js never passes them, so the paths are fixed in code
  const P = Object.assign({}, PATHS, api.paths || {});
  const IN = path.join(P.spool, 'in'), WORK = path.join(P.spool, 'work'), OUT = path.join(P.spool, 'out');
  const now = typeof api.now === 'function' ? api.now : Date.now;
  const C = (cfg && typeof cfg.remoteConsole === 'object' && cfg.remoteConsole) || {};
  const deny = new Set(Array.isArray(C.deny) ? C.deny.map((x) => String(x).toLowerCase()) : []);
  // The longest suspension discipline.js takes (its config, read the same way), for the tagKindReason length word
  const MAX_DAYS = maxDaysOf(cfg);
  const rank = (t) => (t && Object.prototype.hasOwnProperty.call(TIER_RANK, t) ? TIER_RANK[t] : 0);
  // The config can raise the floor (to developer or senior), never lower it below CODE_FLOOR
  const FLOOR = rank(C.minTier) > rank(CODE_FLOOR) ? String(C.minTier) : CODE_FLOOR;
  // The game's own pin: a non-empty list of Discord ids, else the console is off here whatever the backend says
  const PIN = Array.isArray(C.discordIds) && C.discordIds.length > 0 && C.discordIds.length <= 10 && C.discordIds.every((x) => typeof x === 'string' && SNOWFLAKE.test(x))
    ? new Set(C.discordIds) : null;
  const ENABLED = C.enabled !== false;

  // Survive a hot reload: ids already run, the limit windows, and when each kind of log line was last written
  const S = globalThis.__dboConsoleState || (globalThis.__dboConsoleState = { seen: new Map(), perProfile: new Map(), all: [], logAt: new Map(), sweptAt: 0 });
  const logOnce = (kind, text) => {
    const t = now(); if (t - (S.logAt.get(kind) || 0) < LOG_EVERY_MS) return;
    if (S.logAt.size > 500) S.logAt.clear();
    S.logAt.set(kind, t); log(`console: ${text}`);
  };

  // A directory of the spool: real, root's, nobody else's (the parentheses matter: mode & 0o077 === 0 is always 0)
  const privateDir = (p) => { try { const st = fs.lstatSync(p); return st.isDirectory() && !st.isSymbolicLink() && st.uid === 0 && (st.mode & 0o077) === 0; } catch (e) { return false; } };
  const spoolOk = () => [P.spool, IN, WORK, OUT].every(privateDir);

  // The key, re-read when its file changes: a regular root file nobody else can read, 64 hex characters
  let keyCache = { stamp: '', key: null };
  const readKey = () => {
    try {
      const st = fs.lstatSync(P.key);
      if (!st.isFile() || st.uid !== 0 || (st.mode & 0o077) !== 0) return null;
      const stamp = `${st.ino}:${st.size}:${st.mtimeMs}`;
      if (stamp === keyCache.stamp) return keyCache.key;
      const hex = fs.readFileSync(P.key, 'utf8').trim();
      keyCache = { stamp, key: /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null };
      return keyCache.key;
    } catch (e) { return null; }
  };
  // Through an fd opened without blocking: a regular file of at most 64 bytes, else off (a FIFO, a directory, a device, a
  // symlink, a bigger file)
  const readSwitch = () => {
    try {
      const fd = fs.openSync(P.switch, NOBLOCK_READ);
      try {
        const st = fs.fstatSync(fd);
        return st.isFile() && st.size <= MAX_SWITCH_BYTES ? parseSwitch(fs.readFileSync(fd, 'utf8')) : parseSwitch(null);
      } finally { fs.closeSync(fd); }
    } catch (e) { return parseSwitch(null); }
  };

  const limited = (profileId) => {
    const t = now(); const cut = t - LIMITS.windowMs;
    S.all = S.all.filter((x) => x > cut);
    const mine = (S.perProfile.get(profileId) || []).filter((x) => x > cut);
    if (S.perProfile.size > 1000) S.perProfile.clear();
    if (mine.length >= LIMITS.perProfile || S.all.length >= LIMITS.all) { S.perProfile.set(profileId, mine); return true; }
    mine.push(t); S.all.push(t); S.perProfile.set(profileId, mine);
    return false;
  };
  const seenBefore = (id) => {
    const t = now();
    for (const [k, at] of S.seen) { if (t - at <= SEEN_MS && S.seen.size <= 5000) break; S.seen.delete(k); }
    return S.seen.has(id);
  };

  const writeReply = (key, rep) => {
    const full = Object.assign({ v: 1, gate: '', ranAs: '', online: false, tier: '', target: '', lines: [], why: '', at: now() }, rep);
    full.lines = canonLines(full.lines);
    full.sig = hmac(key, repPayload(full)).toString('hex');
    const tmp = path.join(OUT, `.${full.id}.tmp`);
    try { fs.unlinkSync(tmp); } catch (e) { /* none left */ }
    fs.writeFileSync(tmp, JSON.stringify(full), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, path.join(OUT, `${full.id}.json`));
  };
  const refuse = (key, r, why, extra) => {
    const text = (TEXT[why] || TEXT.bad)(extra && extra.subject ? extra.subject : '');
    writeReply(key, Object.assign({ id: r.id, state: why === 'off' || why === 'expired' || why === 'busy' || why === 'bad' ? why : 'refused', why,
      lines: [{ to: 'console', text }] }, extra && extra.fields ? extra.fields : {}));
    audit(`REMOTE ${r.src} req ${id8(r.id)} ${r.user} <@${r.discordId}> refused (${why}): ${r.text}`);
  };

  // The admin's own character (DESIGN 7.5): online first; else the one whose stamped tier matches the fresh one; else the
  // lowest form id. Only actors of the profile that carry the requester's Discord id
  // Live characters carrying a tag in the index, offline ones included (a deleted one stays there until a restart)
  const offlineByTag = (want) => {
    let ids = []; try { ids = mp.findFormsByPropertyValue('private.indexed.tagKey', want) || []; } catch (e) { return []; }
    return ids.map((x) => Number(x) >>> 0).filter((id) => id && !(typeof globalThis.__dboFormGone === 'function' && globalThis.__dboFormGone(id)));
  };
  const callerOf = (profileId, discordId, fresh) => {
    let ids = [];
    try { ids = (mp.getActorsByProfileId(profileId) || []).map((x) => Number(x) >>> 0); } catch (e) { ids = []; }
    const keep = ids.filter((c) => c && profileOf(c) === profileId && discordOf(c) === discordId).sort((x, y) => x - y);
    if (!keep.length) return 0;
    const online = keep.find((c) => userOf(c) >= 0);
    if (online) return online;
    return keep.find((c) => staffTierOf(c) === fresh) || keep[0];
  };
  // discipline.js's own test (the account's running suspension, or one that holds out this Discord account), as it publishes
  // it for the voice gate; none without discipline.js; a test that throws counts as suspended
  const heldOut = (a) => {
    const f = globalThis.__dboVoiceRefused;
    if (typeof f !== 'function') return false;
    try { return f(a) === 'suspended'; } catch (e) { logOnce('heldOut', `suspension check failed: ${e.message}`); return true; }
  };

  // Writes allow.json for the backend's page and its pre-check: the commands this generation allows, after the config's deny
  let published = false, publishTriedAt = 0;
  const publish = () => {
    const t = now(); if (published || t - publishTriedAt < LOG_EVERY_MS) return; publishTriedAt = t;
    const list = [];
    for (const [name, a] of Object.entries(ALLOW)) {
      if (deny.has(name)) continue;
      const c = commands.get(name);
      if (!c) { logOnce(`allow:${name}`, `/${name} is on the allowlist but not registered; left out`); continue; }
      const entry = { name, usage: a.usage, rule: a.rule, help: String(a.help || c.help || '').slice(0, 200) };
      // A tagKindReason command lists the kinds the console takes here, and the longest suspension, so the backend's
      // pre-check and the page know them; with every kind denied it is left out
      if (a.rule === 'tagKindReason') {
        const kinds = kindsOf(name, deny, MAX_DAYS);
        if (!kinds.length) continue;
        Object.assign(entry, { usage: usageOf(name, kinds, MAX_DAYS), kinds }, kinds.some((k) => KIND_ARGS[k] === 'length') ? { maxSuspendDays: MAX_DAYS } : {});
      }
      list.push(entry);
    }
    const file = path.join(P.spool, 'allow.json'); const tmp = `${file}.tmp`;
    // As writeReply: whatever sits at the tmp name (a FIFO would block the open for write) is removed, then 'wx' creates a
    // new regular file or fails
    try {
      try { fs.unlinkSync(tmp); } catch (e) { /* none left */ }
      fs.writeFileSync(tmp, JSON.stringify(list), { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, file); published = true;
    }
    catch (e) { logOnce('publish', `allow.json not written: ${e.message}`); }
  };

  // Old files: a work/ file left by a crash mid-run (nothing ever runs it again), a reply nobody collected
  const sweep = () => {
    const t = now(); if (t - S.sweptAt < LOG_EVERY_MS) return; S.sweptAt = t;
    for (const [dir, keep] of [[WORK, WORK_KEEP_MS], [OUT, OUT_KEEP_MS]]) {
      let names = []; try { names = fs.readdirSync(dir); } catch (e) { continue; }
      for (const n of names) { try { const st = fs.lstatSync(path.join(dir, n)); if (t - st.mtimeMs > keep) fs.unlinkSync(path.join(dir, n)); } catch (e) { /* gone */ } }
    }
  };

  // One claimed request, start to finish. Never called twice for one file: the claim moved it out of in/
  const run = (key, name, sw) => {
    const fileId = name.slice(0, -5);
    const readable = ID_RE.test(fileId) && !seenBefore(fileId);
    const workFile = path.join(WORK, name);
    let r = null, why = '';
    try {
      const fd = fs.openSync(workFile, NOBLOCK_READ);
      try {
        const st = fs.fstatSync(fd);
        if (!st.isFile() || st.size > MAX_FILE_BYTES) why = `not a file of at most ${MAX_FILE_BYTES} bytes`;
        else r = JSON.parse(fs.readFileSync(fd, 'utf8'));
      } finally { fs.closeSync(fd); }
    } catch (e) { why = why || `unreadable (${e.code || e.message})`; }
    if (!why) why = checkShape(r, fileId);
    if (!why) {
      const want = hmac(key, reqPayload(r)); const got = Buffer.from(r.sig, 'hex');
      if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) why = 'signature';
    }
    if (why) {
      logOnce(`bad:${name}`, `request ${name} refused (${why})`);
      if (readable) writeReply(key, { id: fileId, state: 'bad', why: 'bad', lines: [{ to: 'console', text: TEXT.bad() }] });
      return;
    }
    // From here the request is genuine: an id is run once, whatever comes later
    if (seenBefore(r.id)) { logOnce(`seen:${r.id}`, `request ${id8(r.id)} seen before; not run again`); return; }
    S.seen.set(r.id, now());
    const t = now();
    if (t > r.expiresAt || r.issuedAt > t + FUTURE_SKEW_MS) return refuse(key, r, 'expired');
    const setting = sw[r.src];
    if (setting === 'off' || !ENABLED || !PIN) return refuse(key, r, 'off');
    if (!PIN.has(r.discordId)) return refuse(key, r, 'notPinned');
    const dry = setting === 'dry-run' || r.mode === 'dry-run';
    if (limited(r.profileId)) return refuse(key, r, 'tooMany');

    const fresh = staffTierFrom(r.profileId, r.roles);
    const a = callerOf(r.profileId, r.discordId, fresh);
    if (!a) return refuse(key, r, 'noChar');
    const stamped = staffTierOf(a);
    const online = userOf(a) >= 0;
    const as = { ranAs: display(a), online, tier: stamped || '' };
    // The effective tier is the lower of the two, and must reach the floor (DESIGN 0.3): a demotion counts at once, a
    // promotion only after a login stamps it, and so every remote caller passes isAdmin in the gate (and gets its staff line)
    if (rank(fresh) < rank(FLOOR)) return refuse(key, r, 'tier', { subject: FLOOR_LABEL[FLOOR] || FLOOR, fields: as });
    if (rank(stamped) > rank(fresh) || rank(stamped) < rank(FLOOR)) return refuse(key, r, 'rolesChanged', { fields: as });
    // A suspended account is refused at login, so it cannot act in game, nor from here (review, 21 Oct: a suspended Lead GM
    // still struck, suspended and kicked from the console)
    if (heldOut(a)) return refuse(key, r, 'suspended', { fields: as });

    const line = checkLine(r.text, (n) => commands.has(n), deny, { maxSuspendDays: MAX_DAYS });
    if (line.why) return refuse(key, r, line.why, { subject: line.subject !== undefined ? line.subject : line.cmd, fields: as });
    let target = 0;
    if (line.tag) {
      const want = line.tag.slice(1).toLowerCase();
      let hits = onlineActors().filter((o) => { try { return String(tagOf(o)).toLowerCase() === want; } catch (e) { return false; } });
      if (!hits.length && ALLOW[line.cmd].offline) hits = offlineByTag(want);
      if (hits.length !== 1) return refuse(key, r, ALLOW[line.cmd].offline ? 'targetAny' : 'target', { subject: line.tag, fields: as });
      target = hits[0];
      if (ALLOW[line.cmd].noBeast) {
        let beast = false;
        try { beast = typeof globalThis.__dboBeastOriginalRace === 'function' && !!globalThis.__dboBeastOriginalRace(target); } catch (e) { beast = true; }
        if (beast) return refuse(key, r, 'beast', { subject: line.tag, fields: as });
      }
    }
    const targetName = target ? display(target) : '';
    audit(`REMOTE ${r.src} req ${id8(r.id)} ${r.user} <@${r.discordId}> as ${who(a)}${targetName ? ` on ${targetName}` : ''}${dry ? ' (dry run)' : ''}: ${r.text}`);
    let gate = 'failed', lines = [];
    try {
      // The player log (playerlog.js) names a command's route from __dboPlogRoute before it guesses from the capture
      const out = captureFor(a, !online, () => {
        const route = globalThis.__dboPlogRoute; globalThis.__dboPlogRoute = 'console';
        try { return handleLine(a, r.text, userOf(a), { remote: { src: r.src, id8: id8(r.id) }, dry }); } finally { globalThis.__dboPlogRoute = route; }
      });
      gate = String(out.result || 'ran'); lines = out.lines;
    } catch (e) { log('console: command failed', e.stack || e.message); gate = 'failed'; }
    const state = gate === 'ran' ? 'ran' : gate === 'dry' ? 'dry-run' : gate === 'failed' ? 'failed' : 'refused';
    const whyCode = gate === 'refused' ? 'gate' : gate === 'unknown' ? 'unknown' : '';
    const shown = replyLines(lines);
    if (state === 'refused' && !shown.length) shown.push({ to: 'console', text: (TEXT[whyCode] || TEXT.gate)(line.cmd) });
    // A dry run stops in handleLine before the command, so discipline.js's own checks never ran: say so
    if (state === 'dry-run' && ALLOW[line.cmd].rule === 'tagKindReason') shown.unshift({ to: 'console', text: TEXT.dryRecord() });
    writeReply(key, Object.assign({ id: r.id, state, gate, target: targetName, lines: shown, why: whyCode }, as));
    audit(`REMOTE req ${id8(r.id)} -> ${state}/${gate}`);
  };

  const claim = (name) => { try { fs.renameSync(path.join(IN, name), path.join(WORK, name)); return true; } catch (e) { return false; } };
  const doneWith = (name) => { try { fs.unlinkSync(path.join(WORK, name)); } catch (e) { /* the sweep takes it */ } };

  const tick = () => {
    // The generation guard: every gamemode.js load assigns a new __dboRunCommand early. Another one than ours means a newer
    // gamemode loaded without replacing this reader (a rollback to a pre-console gamemode.js, or a load that failed first)
    if (globalThis.__dboRunCommand !== gen) {
      const timers = globalThis.__dboTimers;
      if (timers instanceof Map && mine && timers.get('remoteConsole') === mine) stopTimer('remoteConsole');
      log('console: a newer gamemode generation loaded without this reader; stopped');
      return;
    }
    let names;
    try { names = fs.readdirSync(IN); } catch (e) { logOnce('spool', `spool ${IN} unreadable (${e.code || e.message}); off`); return; }
    const waiting = names.filter((n) => n.endsWith('.json') && !n.startsWith('.'));
    // Idle, this is the whole cost: one readdir of a tmpfs directory (allow.json and the sweep come once a minute at most)
    if (!waiting.length && published && now() - S.sweptAt < LOG_EVERY_MS) return;
    if (!spoolOk()) { logOnce('dirs', `spool ${P.spool} is not root-only 0700 directories; off`); return; }
    publish();
    sweep();
    if (!waiting.length) return;
    const key = readKey();
    if (!key) { logOnce('key', `key ${P.key} missing or not a root-only 64-hex file; off`); return; }
    const sw = readSwitch();
    if (waiting.length > MAX_WAITING) {
      let n = 0;
      for (const name of waiting) {
        if (!claim(name)) continue;
        n++;
        const id = name.slice(0, -5);
        if (ID_RE.test(id) && !seenBefore(id)) { try { writeReply(key, { id, state: 'busy', why: 'busy', lines: [{ to: 'console', text: TEXT.busy() }] }); } catch (e) { /* the backend times out */ } }
        doneWith(name);
      }
      audit(`REMOTE flood: ${waiting.length} requests waiting, ${n} refused as busy`);
      return;
    }
    const order = waiting.map((n) => { let at = 0; try { at = fs.lstatSync(path.join(IN, n)).mtimeMs; } catch (e) { at = Infinity; } return [n, at]; })
      .sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1)).slice(0, PER_TICK).map((x) => x[0]);
    for (const name of order) {
      if (!claim(name)) continue;
      try { run(key, name, sw); } catch (e) { logOnce('run', `request ${name} failed: ${e.message}`); }
      doneWith(name);
    }
  };
  const safeTick = () => { try { tick(); } catch (e) { logOnce('tick', `tick failed: ${e.message}`); } };

  let mine = null;
  every('remoteConsole', TICK_MS, safeTick);
  mine = globalThis.__dboTimers instanceof Map ? globalThis.__dboTimers.get('remoteConsole') || null : null;
  log(`console: reader on ${P.spool}, ${Object.keys(ALLOW).filter((n) => !deny.has(n)).length} commands, floor ${FLOOR}, game pin ${PIN ? PIN.size : 'empty (off)'}${ENABLED ? '' : ', disabled in config'}`);
  return { tick: safeTick, rawTick: tick };
};

// Shared pure helpers, for the harness and the backend's copy of the same rules
module.exports.rules = { cleanCommand, parseSwitch, checkLine, checkShape, reqPayload, repPayload, replyLines, plainLine, id8, ALLOW, TEXT,
  KIND_ARGS, REASON_RE, maxDaysOf, lengthHours, reasonWhy, kindsOf, usageOf };
