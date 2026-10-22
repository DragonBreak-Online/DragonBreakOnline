'use strict';
// DragonBreak Online: staff discipline, one record per account (Nate, 12 Oct 2026, after ticket #0138: "we need to create a
// discipline action"). Loaded by gamemode.js on every hot reload.
//
//   /discipline #TAG                          the account's record (staff)
//   /discipline #TAG warn <reason>            a warning: the player is told, nothing else happens
//   /discipline #TAG strike <reason>          a strike: told; strikes count for strikeDays, and staff are told at strikesForReview
//   /discipline #TAG suspend <n>h|<n>d <reason>   Lead GM and above: logged out now and refused at login until it ends
//   /discipline #TAG lift <reason>            Lead GM and above: ends a suspension early
//   /discipline list                          every suspension still running
// The record is the account's (profile), so it follows every character on it. Every kind is refused on an account of the
// caller's own rank or higher (gamemode.js rankRefusalOf: the account's highest staff tier over all its characters, so an alt
// with no roles stamped counts as its owner), and when that rank cannot be read. Every action goes to the audit log with who
// did it and why. A player offline is told at their next login.
// Records (discipline.json beside world/, never in git): { profiles: { <profile>: [{ n, kind, reason, by, at, char, until?, seen, lifted? }] } }
// Config "discipline" in gamemode-config.json: { enabled, strikeDays, strikesForReview, maxSuspendDays, record, discordFile }.
// record lists actions decided outside the game, each added once, matched by key:
//   { key, tag, kind: warn|strike, reason, by }
//   { key, profile and/or tag, kind: 'suspend', from, until or length ('38h'), reason, by }   (ticket rep-0305, Jake 21 Oct)
//       the end is fixed by from/until (ISO), whenever the reload that adds it runs; a length needs its from; over
//       maxSuspendDays, or already over, is refused. The account is logged out at once and refused at login until it ends.
//   { key, kind: 'lift', of: <suspension key>, reason, by }   ends that suspension early, the undo that needs no Lead GM in game
// A suspension can also hold out Discord accounts, a second account that has never played (no profile) included: their ids
// sit only in discordFile (default discipline-discord.json beside discipline.json, root only, never in git, never written or
// logged here): { "<record key>": ["<discord id>", ...] }, read at every load. A character whose session's Discord id
// (private.skympDiscordId, set by the fork's spawn.ts at assign) is listed under a running suspension's key is refused too.
const fs = require('fs');
const path = require('path');

const DEFAULTS = { enabled: true, strikeDays: 90, strikesForReview: 3, maxSuspendDays: 30, file: '' };
const KINDS = ['warn', 'strike', 'suspend', 'lift', 'overturn'];

// Pure: '12h' or '3d' -> ms, else 0
const lengthMs = (s, maxDays) => {
  const m = /^(\d+(?:\.\d+)?)([hd])$/i.exec(String(s || '').trim());
  if (!m) return 0;
  const ms = Number(m[1]) * (m[2].toLowerCase() === 'd' ? 86400000 : 3600000);
  return ms > 0 && ms <= maxDays * 86400000 ? Math.round(ms) : 0;
};
// Pure: the suspension running at `now`, or null (one decided outside the game may start at its own `from`)
const activeSuspension = (entries, now) => (entries || []).filter((e) => e.kind === 'suspend' && !e.lifted && !e.overturned && e.until > now && !(e.from > now)).sort((a, b) => b.until - a.until)[0] || null;
// Pure: a suspension decided outside the game -> { from, until } in ms, or { error }. The end never depends on when it is read.
const configWindow = (r, maxDays, now) => {
  const max = maxDays * 86400000;
  const from = r.from ? Date.parse(r.from) : now;
  if (!Number.isFinite(from)) return { error: `from "${r.from}" is not a date` };
  const len = r.length ? lengthMs(r.length, maxDays) : 0;
  if (r.length && !len) return { error: `length "${r.length}" is not 1h to ${maxDays}d` };
  if (len && !r.from) return { error: 'a length needs its from, so the end is fixed' };
  if (!r.until && !len) return { error: 'give until, or from and a length' };
  const until = r.until ? Date.parse(r.until) : from + len;
  if (!Number.isFinite(until)) return { error: `until "${r.until}" is not a date` };
  if (r.until && len && Math.abs(until - (from + len)) > 60000) return { error: 'until and from + length disagree' };
  if (until <= from) return { error: 'until is not after from' };
  if (until - from > max) return { error: `longer than ${maxDays} days` };
  return { from, until };
};
// An overturned record is kept for the history and counts for nothing: a strike given for something the game allowed
// had to be cut out of discipline.json by hand before this existed (ticket #0141, 12 Oct).
const activeStrikes = (entries, now, days) => (entries || []).filter((e) => e.kind === 'strike' && !e.overturned && now - Date.parse(e.at) < days * 86400000).length;
const stamp = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, profileOf, onlineActors, registerChatCommand, isAdmin, isLeadStaff, findAnyByName,
    sendPacket, userOf, every } = api;
  // gamemode.js's rank rule; without it every record kind is refused (fails closed)
  const rankRefusal = typeof api.rankRefusal === 'function' ? api.rankRefusal : () => 'unknown';
  const C = Object.assign({}, DEFAULTS, (api.cfg || {}).discipline || {});
  if (C.enabled === false) { globalThis.__dboDisciplineLogin = null; globalThis.__dboVoiceRefused = null; log('discipline: off'); return; }
  const stateDir = () => { try { return path.dirname(fs.realpathSync(path.resolve('world'))); } catch (e) { return path.resolve('.'); } };
  const FILE = C.file ? path.resolve(C.file) : path.join(stateDir(), 'discipline.json');
  let readOnly = false;
  const load = () => {
    try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return d && d.profiles ? d : { profiles: {} }; }
    catch (e) { if (e.code !== 'ENOENT') { readOnly = true; log(`discipline: ${FILE} unreadable (${e.message}); records are read only until it is fixed`); } return { profiles: {} }; }
  };
  const D = load();
  const save = () => {
    if (readOnly) return false;
    try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(D, null, 1)); fs.renameSync(FILE + '.tmp', FILE); return true; }
    catch (e) { log('discipline: write failed', e.message); return false; }
  };
  const recordOf = (profile) => D.profiles[profile] || [];

  // Discord accounts held out by a suspension's key (see the head of this file). Never log an id, nor a JSON error's
  // message: it quotes the file's text.
  const DISCORD_FILE = C.discordFile ? path.resolve(C.discordFile) : path.join(path.dirname(FILE), 'discipline-discord.json');
  const DISCORD_NAME = path.basename(DISCORD_FILE);
  // A key typed where an id belongs must not put that id in the log
  const safeKey = (k) => String(k).replace(/\d{5,}/g, '[digits]').slice(0, 60);
  const loadDiscord = () => {
    const held = new Map();
    let raw;
    try { raw = JSON.parse(fs.readFileSync(DISCORD_FILE, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') log(`discipline: ${DISCORD_NAME} unreadable (${e.code || 'not valid JSON'}); no Discord account is held out`); return held; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { log(`discipline: ${DISCORD_NAME} is not { key: [ids] }; no Discord account is held out`); return held; }
    for (const [key, ids] of Object.entries(raw)) {
      const good = (Array.isArray(ids) ? ids : []).map(String).filter((d) => /^\d{15,22}$/.test(d));
      if (good.length !== (Array.isArray(ids) ? ids.length : -1)) log(`discipline: ${DISCORD_NAME}: ${safeKey(key)} holds something that is not a list of Discord ids; only the ids are used`);
      if (good.length) held.set(key, new Set(good));
    }
    try { if (fs.statSync(DISCORD_FILE).mode & 0o077) log(`discipline: ${DISCORD_NAME} can be read by other users: chmod 600 it`); } catch (e) { /* gone */ }
    return held;
  };
  const DISCORD = loadDiscord();
  const discordOf = (a) => {
    for (const k of ['private.skympDiscordId', 'private.indexed.discordId']) { try { const v = mp.get(a, k); if (v) return String(v); } catch (e) { /* next */ } }
    return '';
  };
  const heldByDiscord = (d, now) => {
    if (!d) return null;
    const hits = [];
    for (const list of Object.values(D.profiles)) for (const e of list) if (e.key && DISCORD.has(e.key) && DISCORD.get(e.key).has(d)) hits.push(e);
    return activeSuspension(hits, now);
  };
  // The account's own suspension, else one that holds out the Discord account this character was logged in with
  const suspensionOf = (a, now) => activeSuspension(recordOf(profileOf(a)), now) || (DISCORD.size ? heldByDiscord(discordOf(a), now) : null);
  const discordNote = (e) => (e && e.key && DISCORD.has(e.key) ? ` (+${DISCORD.get(e.key).size} Discord account${DISCORD.get(e.key).size === 1 ? '' : 's'})` : '');

  const kickWithReason = (a, reason) => {
    // the player log (playerlog.js): the logout's reason, a suspension (never its text)
    try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('leave_reason', a, 'suspension'); } catch (e) { /* the player log is optional */ }
    try { sendPacket(a, { customPacketType: 'kicked', reason }); } catch (e) { /* gone */ }
    setTimeout(() => { try { const u = userOf(a); if (u >= 0) mp.kick(u); } catch (e) { log('discipline: kick failed', e.message); } }, 1500);
  };
  const suspendedText = (s) => `Your account is suspended until ${stamp(s.until)}. Reason: ${s.reason}`;
  const tell = (a, e) => personal(a, e.kind === 'warn' ? `A warning from staff: ${e.reason}`
    : e.kind === 'strike' ? `A strike from staff: ${e.reason}. Strikes count against your account for ${C.strikeDays} days.`
      : e.kind === 'lift' ? `Your suspension was lifted: ${e.reason}`
        : e.kind === 'overturn' ? `A staff decision against you was overturned: ${e.reason}` : e.reason);

  // Unseen warnings and strikes are shown at login; a suspended account is logged out
  globalThis.__dboDisciplineLogin = (a) => {
    const p = profileOf(a); const list = recordOf(p); const now = Date.now();
    const own = activeSuspension(list, now);
    const s = own || (DISCORD.size ? heldByDiscord(discordOf(a), now) : null);
    if (s) {
      kickWithReason(a, suspendedText(s));
      audit(`DISCIPLINE refused ${who(a)}: suspended until ${stamp(s.until)} (${own ? `#${s.n}` : `config ${s.key}, held out by Discord account`})`);
      return true;
    }
    const unseen = list.filter((e) => !e.seen && (e.kind === 'warn' || e.kind === 'strike' || e.kind === 'lift' || e.kind === 'overturn'));
    if (!unseen.length) return false;
    for (const e of unseen) { tell(a, e); e.seen = true; }
    save();
    return false;
  };

  // The fork's voice system asks before it mints a voice token and in its room sweep: a suspended account gets no voice
  globalThis.__dboVoiceRefused = (a) => (suspensionOf(a, Date.now()) ? 'suspended' : '');

  // from: an action decided outside the game ({ key, by }, and { profile, char, start } when it names an account, not a character)
  const add = (actor, target, kind, reason, until, from) => {
    const p = from && from.profile !== undefined ? from.profile : profileOf(target);
    const list = D.profiles[p] || (D.profiles[p] = []);
    const e = { n: list.length + 1, kind, reason, by: from ? from.by : display(actor), byProfile: from ? 0 : profileOf(actor), at: new Date().toISOString(), char: target ? display(target) : (from && from.char) || `profile ${p}`, seen: false };
    if (from) e.key = from.key;
    if (until) e.until = until;
    if (from && from.start) e.from = from.start;
    list.push(e);
    if (!save()) { list.pop(); return null; }
    return e;
  };
  const online = (target) => onlineActors().includes(target);

  const show = (a, target) => {
    const p = profileOf(target); const list = recordOf(p); const now = Date.now();
    if (!list.length) return personal(a, `${display(target)} (profile ${p}): no record.`);
    const s = activeSuspension(list, now);
    personal(a, `${display(target)} (profile ${p}): ${list.length} entr${list.length === 1 ? 'y' : 'ies'}, ${activeStrikes(list, now, C.strikeDays)} strike(s) in ${C.strikeDays} days${s ? `, suspended until ${stamp(s.until)}` : ''}.`);
    for (const e of list.slice(-10)) personal(a, `#${e.n} ${e.at.slice(0, 10)} ${e.kind}${e.from ? ` from ${stamp(e.from)}` : ''}${e.until ? ` until ${stamp(e.until)}` : ''}${discordNote(e)}${e.lifted ? ' (lifted)' : ''}${e.overturned ? ` (overturned by ${e.overturned.by})` : ''} by ${e.by}: ${e.reason}`);
  };

  const command = (a, args) => {
    if (!isAdmin(a)) return personal(a, 'Only staff can use /discipline.');
    const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return personal(a, 'Use: /discipline #TAG [warn|strike|suspend <12h|3d>|lift|overturn <n>] <reason>, or /discipline list');
    if (parts[0].toLowerCase() === 'list') {
      const now = Date.now(); let n = 0;
      for (const [p, list] of Object.entries(D.profiles)) { const s = activeSuspension(list, now); if (s) { n++; personal(a, `profile ${p} ${s.char}: until ${stamp(s.until)}${discordNote(s)} by ${s.by}: ${s.reason}`); } }
      return n || personal(a, 'No suspension is running.');
    }
    const target = findAnyByName(parts[0]);
    if (target < 0) return personal(a, `"${parts[0]}" matches more than one character; use their #TAG.`);
    if (!target) return personal(a, `No character "${parts[0]}". Use their #TAG.`);
    if (profileOf(target) === profileOf(a)) return personal(a, 'You cannot discipline your own account.');
    const kind = (parts[1] || '').toLowerCase();
    if (!kind) return show(a, target);
    if (!KINDS.includes(kind)) return personal(a, `Unknown action "${kind}": warn, strike, suspend, lift or overturn.`);
    // The rank rule replaces "a Lead GM or above can discipline staff", which went by the named character alone (21 Oct review:
    // a GM struck an Owner through an alt with no roles stamped) and let a Lead GM act on an Owner's or a Developer's account
    let no = 'unknown'; try { no = rankRefusal(a, target); } catch (e) { log('discipline: rank rule failed', e.message); }
    if (no === 'own') return personal(a, 'You cannot discipline your own account.');
    if (no === 'rank') return personal(a, `${display(target)} is on a staff account of your rank or higher, so you cannot discipline it. Take it to someone above that rank, or to the Owners: reports about staff go through the Report a GM ticket.`);
    if (no) return personal(a, `The staff rank of ${display(target)}'s account could not be read, so nothing was recorded. Try again, or ask an Owner.`);
    if ((kind === 'suspend' || kind === 'lift') && !isLeadStaff(a)) return personal(a, 'Suspensions are for Lead GMs and above. Give a strike and tell a Lead GM.');
    // Overturning undoes another staff member's decision, so it sits with suspensions rather than with warnings
    if (kind === 'overturn' && !isLeadStaff(a)) return personal(a, 'Only a Lead GM or above can overturn a record. Ask one, with what you found.');
    const ms = kind === 'suspend' ? lengthMs(parts[2], C.maxSuspendDays) : 0;
    if (kind === 'suspend' && !ms) return personal(a, `Give a length from 1h to ${C.maxSuspendDays}d, like 12h or 3d.`);
    const nth = kind === 'overturn' ? Number(String(parts[2] || '').replace(/^#/, '')) : 0;
    if (kind === 'overturn' && !(nth > 0)) return personal(a, 'Which record? /discipline #TAG overturn <n> <reason>, with the number from their record.');
    const reason = parts.slice(kind === 'suspend' || kind === 'overturn' ? 3 : 2).join(' ').slice(0, 300);
    if (reason.length < 5) return personal(a, 'Give a reason; the player is shown it.');
    if (kind === 'lift') {
      const s = activeSuspension(recordOf(profileOf(target)), Date.now());
      if (!s) return personal(a, `${display(target)} is not suspended.`);
      s.lifted = true;
    }
    // The record is marked, never deleted: staff keep the history of what was decided and of its being undone.
    let undone = null;
    if (kind === 'overturn') {
      const list = recordOf(profileOf(target));
      undone = list.find((e) => e.n === nth);
      if (!undone) return personal(a, `${display(target)} has no record #${nth}. /discipline ${parts[0]} shows them.`);
      if (undone.kind === 'overturn') return personal(a, 'That entry is itself an overturn; overturn the record it undid.');
      if (undone.overturned) return personal(a, `#${nth} was already overturned by ${undone.overturned.by}.`);
      undone.overturned = { by: display(a), byProfile: profileOf(a), at: new Date().toISOString(), reason };
      if (!save()) { delete undone.overturned; return personal(a, 'The record could not be saved; nothing was done.'); }
    }
    const e = add(a, target, kind, reason, ms ? Date.now() + ms : 0);
    if (!e) {
      if (undone) { delete undone.overturned; save(); }
      return personal(a, 'The record could not be saved; nothing was done.');
    }
    if (undone) e.undid = nth;
    const extra = kind === 'suspend' ? ` until ${stamp(e.until)}` : undone ? ` of #${nth} (${undone.kind} by ${undone.by})` : '';
    audit(`DISCIPLINE ${kind} #${e.n} on ${who(target)} (profile ${profileOf(target)})${extra} by ${who(a)}: ${reason}`);
    personal(a, `Recorded: ${kind} #${e.n} on ${display(target)}${extra}.${online(target) || kind === 'suspend' ? '' : ' They are told at their next login.'}`);
    if (kind === 'suspend') { for (const x of onlineActors()) if (profileOf(x) === profileOf(target)) kickWithReason(x, suspendedText(e)); }
    else if (online(target)) { tell(target, e); e.seen = true; save(); }
    if (kind === 'strike') {
      const n = activeStrikes(recordOf(profileOf(target)), Date.now(), C.strikeDays);
      if (n >= C.strikesForReview) {
        audit(`DISCIPLINE ${who(target)} has ${n} strikes in ${C.strikeDays} days: a Lead GM should review a suspension`);
        personal(a, `${display(target)} now has ${n} strikes in ${C.strikeDays} days. Ask a Lead GM to review a suspension.`);
      }
    }
  };
  registerChatCommand('discipline', command, { admin: true, help: '#TAG [warn|strike|suspend <12h|3d>|lift|overturn <n>] <reason>: a player\'s record, or list' });

  // Actions decided outside the game (config record, see the head of this file), each added once by its key
  const byKey = (k) => { for (const [p, list] of Object.entries(D.profiles)) { const e = list.find((x) => x.key === k); if (e) return { p: Number(p), e }; } return null; };
  const onProfile = (p) => onlineActors().filter((x) => profileOf(x) === p);
  for (const r of Array.isArray(C.record) ? C.record : []) {
    if (!r || !r.key || !['warn', 'strike', 'suspend', 'lift'].includes(r.kind) || String(r.reason || '').length < 5) { log(`discipline: record entry ${r && r.key} refused`); continue; }
    if (byKey(String(r.key))) continue;
    const by = String(r.by || 'staff').slice(0, 40);
    const reason = String(r.reason).slice(0, 300);
    if (r.kind === 'lift') {
      const hit = r.of ? byKey(String(r.of)) : null;
      if (!hit || hit.e.kind !== 'suspend') { log(`discipline: record ${r.key}: no suspension ${r.of} on record to lift`); continue; }
      if (hit.e.lifted || hit.e.overturned) { log(`discipline: record ${r.key}: ${r.of} was already ${hit.e.lifted ? 'lifted' : 'overturned'}`); continue; }
      hit.e.lifted = true;
      const e = add(0, 0, 'lift', reason, 0, { key: String(r.key), by, profile: hit.p, char: hit.e.char });
      if (!e) { delete hit.e.lifted; log(`discipline: record ${r.key}: not saved, ${r.of} still runs`); continue; }
      e.lifts = hit.e.n;
      save();
      audit(`DISCIPLINE lift #${e.n} on ${hit.e.char} (profile ${hit.p}) of #${hit.e.n} (config ${r.of})${discordNote(hit.e)} by ${by} (config ${r.key}): ${reason}`);
      const here = onProfile(hit.p);
      if (here.length) { tell(here[0], e); e.seen = true; save(); }
      continue;
    }
    const tagged = r.tag ? findAnyByName(`#${String(r.tag).replace(/^#/, '')}`) : 0;
    const target = tagged > 0 ? tagged : 0;
    let p;
    if (r.profile !== undefined && r.profile !== null && r.profile !== '') {
      p = Number(r.profile);
      if (!(Number.isInteger(p) && p >= 0)) { log(`discipline: record ${r.key}: profile ${r.profile} is not a profile number`); continue; }
      // The tag is a check on the profile: a typo in either refuses the entry rather than reach someone else
      if (target && profileOf(target) !== p) { log(`discipline: record ${r.key}: #${r.tag} is on profile ${profileOf(target)}, not ${p}; refused`); continue; }
    } else {
      if (!target) { log(`discipline: record ${r.key}: no character #${r.tag}`); continue; }
      p = profileOf(target);
      if (!(Number.isInteger(p) && p >= 0)) { log(`discipline: record ${r.key}: #${r.tag} has no profile`); continue; }
    }
    let win = null;
    if (r.kind === 'suspend') {
      win = configWindow(r, C.maxSuspendDays, Date.now());
      if (win.error) { log(`discipline: record ${r.key} refused: ${win.error}`); continue; }
      if (win.until <= Date.now()) { log(`discipline: record ${r.key}: it ended ${stamp(win.until)}; not added`); continue; }
    }
    const from = { key: String(r.key), by, profile: p, char: target ? display(target) : `profile ${p}` };
    if (win && r.from) from.start = win.from;
    const e = add(0, target, r.kind, reason, win ? win.until : 0, from);
    if (!e) { log(`discipline: record ${r.key}: not saved`); continue; }
    const extra = win ? `${e.from ? ` from ${stamp(e.from)}` : ''} until ${stamp(e.until)}${discordNote(e)}` : '';
    audit(`DISCIPLINE ${r.kind} #${e.n} on ${target ? who(target) : e.char} (profile ${p})${extra} by ${by} (config ${r.key}): ${e.reason}`);
    if (r.kind === 'suspend') {
      // Logged out at once, every character of the account and any held out by a listed Discord account
      const now = Date.now();
      for (const x of onlineActors()) { const s = suspensionOf(x, now); if (s) kickWithReason(x, suspendedText(s)); }
    } else {
      const here = target && online(target) ? [target] : onProfile(p);
      if (here.length) { tell(here[0], e); e.seen = true; save(); }
    }
  }
  for (const key of DISCORD.keys()) if (!byKey(key)) log(`discipline: ${DISCORD_NAME} lists ${safeKey(key)}, which is not on record: it holds no one out`);

  // A suspension given while the player was in character select, or a login that raced the record, is caught here
  every('discipline', 30000, () => {
    const now = Date.now();
    for (const a of onlineActors()) { const s = suspensionOf(a, now); if (s) kickWithReason(a, suspendedText(s)); }
  });
  log(`discipline on: ${Object.keys(D.profiles).length} account(s) on record${DISCORD.size ? `, ${[...DISCORD.values()].reduce((n, ids) => n + ids.size, 0)} Discord account(s) listed under ${DISCORD.size} key(s)` : ''}`);
};
module.exports.lengthMs = lengthMs;
module.exports.activeSuspension = activeSuspension;
module.exports.activeStrikes = activeStrikes;
module.exports.configWindow = configWindow;
