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

// ---- the v1 allowlist (DESIGN section 8.1). Widening it is a code change and a review; gamemode-config can only narrow it.
// rule: switch = none | on | off | clear #TAG; tag = #TAG (noArg: what the empty form would do); tagName = #TAG <new name>;
// load = none | reset; none = no argument. There is no free-text rule: the only free text any allowed form carries is
// /rename's new name, held to NAME_RE (review SEC-2: /players took 'any', and its words reached #staff-commands)
const ALLOW = Object.freeze({
  wwremote: { usage: '/wwremote [on|off|clear #TAG]', rule: 'switch' },
  vlremote: { usage: '/vlremote [on|off|clear #TAG]', rule: 'switch' },
  kick: { usage: '/kick #TAG', rule: 'tag', noArg: 'needTag' },
  fixloc: { usage: '/fixloc #TAG', rule: 'tag', noArg: 'self' },
  rename: { usage: '/rename #TAG <new name>', rule: 'tagName' },
  chargen: { usage: '/chargen #TAG', rule: 'tag', noArg: 'self', noBeast: true },
  players: { usage: '/players', rule: 'none' },
  load: { usage: '/load [reset]', rule: 'load' },
  whoami: { usage: '/whoami', rule: 'none' },
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
  noChar: () => 'The console acts as your own character. Make one in game first.',
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
const reqPayload = (r) => `dbo-console-req-v1\n${JSON.stringify([r.v, r.id, r.src, r.discordId, r.user, r.profileId, r.roles, r.text, r.mode, r.issuedAt, r.expiresAt])}`;
const canonLines = (lines) => lines.map((l) => ({ to: String(l.to), text: String(l.text) }));
const repPayload = (r) => `dbo-console-rep-v1\n${JSON.stringify([r.v, r.id, r.state, r.gate, r.ranAs, r.online, r.tier, r.target, canonLines(r.lines), r.why, r.at])}`;
const hmac = (key, text) => crypto.createHmac('sha256', key).update(text, 'utf8').digest();
const id8 = (id) => (String(id).startsWith('w-') ? String(id).slice(2, 10) : String(id).slice(-8));

// What the argument rule says about one cleaned line: { cmd, body, tag } to run, or { cmd, why } refused
const checkLine = (text, has, deny) => {
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
  const callerOf = (profileId, discordId, fresh) => {
    let ids = [];
    try { ids = (mp.getActorsByProfileId(profileId) || []).map((x) => Number(x) >>> 0); } catch (e) { ids = []; }
    const keep = ids.filter((c) => c && profileOf(c) === profileId && discordOf(c) === discordId).sort((x, y) => x - y);
    if (!keep.length) return 0;
    const online = keep.find((c) => userOf(c) >= 0);
    if (online) return online;
    return keep.find((c) => staffTierOf(c) === fresh) || keep[0];
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
      list.push({ name, usage: a.usage, rule: a.rule, help: String(c.help || '').slice(0, 200) });
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

    const line = checkLine(r.text, (n) => commands.has(n), deny);
    if (line.why) return refuse(key, r, line.why, { subject: line.cmd, fields: as });
    let target = 0;
    if (line.tag) {
      const want = line.tag.slice(1).toLowerCase();
      const hits = onlineActors().filter((o) => { try { return String(tagOf(o)).toLowerCase() === want; } catch (e) { return false; } });
      if (hits.length !== 1) return refuse(key, r, 'target', { subject: line.tag, fields: as });
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
module.exports.rules = { cleanCommand, parseSwitch, checkLine, checkShape, reqPayload, repPayload, replyLines, plainLine, id8, ALLOW, TEXT };
