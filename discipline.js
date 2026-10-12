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
// The record is the account's (profile), so it follows every character on it. A GM cannot discipline staff; Lead GM and above
// can. Every action goes to the audit log with who did it and why. A player offline is told at their next login.
// Records (discipline.json beside world/, never in git): { profiles: { <profile>: [{ n, kind, reason, by, at, char, until?, seen, lifted? }] } }
// Config "discipline" in gamemode-config.json: { enabled, strikeDays, strikesForReview, maxSuspendDays, record }. record lists
// actions decided outside the game ({ key, tag, kind: warn|strike, reason, by }), each added once, matched by key.
const fs = require('fs');
const path = require('path');

const DEFAULTS = { enabled: true, strikeDays: 90, strikesForReview: 3, maxSuspendDays: 30, file: '' };
const KINDS = ['warn', 'strike', 'suspend', 'lift'];

// Pure: '12h' or '3d' -> ms, else 0
const lengthMs = (s, maxDays) => {
  const m = /^(\d+(?:\.\d+)?)([hd])$/i.exec(String(s || '').trim());
  if (!m) return 0;
  const ms = Number(m[1]) * (m[2].toLowerCase() === 'd' ? 86400000 : 3600000);
  return ms > 0 && ms <= maxDays * 86400000 ? Math.round(ms) : 0;
};
// Pure: the suspension running at `now`, or null
const activeSuspension = (entries, now) => (entries || []).filter((e) => e.kind === 'suspend' && !e.lifted && e.until > now).sort((a, b) => b.until - a.until)[0] || null;
const activeStrikes = (entries, now, days) => (entries || []).filter((e) => e.kind === 'strike' && now - Date.parse(e.at) < days * 86400000).length;
const stamp = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, profileOf, onlineActors, registerChatCommand, isAdmin, isLeadStaff, findAnyByName,
    sendPacket, userOf, every } = api;
  const C = Object.assign({}, DEFAULTS, (api.cfg || {}).discipline || {});
  if (C.enabled === false) { globalThis.__dboDisciplineLogin = null; log('discipline: off'); return; }
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

  const kickWithReason = (a, reason) => {
    try { sendPacket(a, { customPacketType: 'kicked', reason }); } catch (e) { /* gone */ }
    setTimeout(() => { try { const u = userOf(a); if (u >= 0) mp.kick(u); } catch (e) { log('discipline: kick failed', e.message); } }, 1500);
  };
  const suspendedText = (s) => `Your account is suspended until ${stamp(s.until)}. Reason: ${s.reason}`;
  const tell = (a, e) => personal(a, e.kind === 'warn' ? `A warning from staff: ${e.reason}`
    : e.kind === 'strike' ? `A strike from staff: ${e.reason}. Strikes count against your account for ${C.strikeDays} days.`
      : e.kind === 'lift' ? `Your suspension was lifted: ${e.reason}` : e.reason);

  // Unseen warnings and strikes are shown at login; a suspended account is logged out
  globalThis.__dboDisciplineLogin = (a) => {
    const p = profileOf(a); const list = recordOf(p);
    const s = activeSuspension(list, Date.now());
    if (s) { kickWithReason(a, suspendedText(s)); audit(`DISCIPLINE refused ${who(a)}: suspended until ${stamp(s.until)} (#${s.n})`); return true; }
    const unseen = list.filter((e) => !e.seen && (e.kind === 'warn' || e.kind === 'strike' || e.kind === 'lift'));
    if (!unseen.length) return false;
    for (const e of unseen) { tell(a, e); e.seen = true; }
    save();
    return false;
  };

  const add = (actor, target, kind, reason, until, from) => {
    const p = profileOf(target);
    const list = D.profiles[p] || (D.profiles[p] = []);
    const e = { n: list.length + 1, kind, reason, by: from ? from.by : display(actor), byProfile: from ? 0 : profileOf(actor), at: new Date().toISOString(), char: display(target), seen: false };
    if (from) e.key = from.key;
    if (until) e.until = until;
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
    for (const e of list.slice(-10)) personal(a, `#${e.n} ${e.at.slice(0, 10)} ${e.kind}${e.until ? ` until ${stamp(e.until)}` : ''}${e.lifted ? ' (lifted)' : ''} by ${e.by}: ${e.reason}`);
  };

  const command = (a, args) => {
    if (!isAdmin(a)) return personal(a, 'Only staff can use /discipline.');
    const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return personal(a, 'Use: /discipline #TAG [warn|strike|suspend <12h|3d>|lift] <reason>, or /discipline list');
    if (parts[0].toLowerCase() === 'list') {
      const now = Date.now(); let n = 0;
      for (const [p, list] of Object.entries(D.profiles)) { const s = activeSuspension(list, now); if (s) { n++; personal(a, `profile ${p} ${s.char}: until ${stamp(s.until)} by ${s.by}: ${s.reason}`); } }
      return n || personal(a, 'No suspension is running.');
    }
    const target = findAnyByName(parts[0]);
    if (target < 0) return personal(a, `"${parts[0]}" matches more than one character; use their #TAG.`);
    if (!target) return personal(a, `No character "${parts[0]}". Use their #TAG.`);
    if (profileOf(target) === profileOf(a)) return personal(a, 'You cannot discipline your own account.');
    const kind = (parts[1] || '').toLowerCase();
    if (!kind) return show(a, target);
    if (!KINDS.includes(kind)) return personal(a, `Unknown action "${kind}": warn, strike, suspend or lift.`);
    if (isAdmin(target) && !isLeadStaff(a)) return personal(a, 'Only a Lead GM or above can discipline staff. Owners take reports about GMs through the Report a GM ticket.');
    if ((kind === 'suspend' || kind === 'lift') && !isLeadStaff(a)) return personal(a, 'Suspensions are for Lead GMs and above. Give a strike and tell a Lead GM.');
    const ms = kind === 'suspend' ? lengthMs(parts[2], C.maxSuspendDays) : 0;
    if (kind === 'suspend' && !ms) return personal(a, `Give a length from 1h to ${C.maxSuspendDays}d, like 12h or 3d.`);
    const reason = parts.slice(kind === 'suspend' ? 3 : 2).join(' ').slice(0, 300);
    if (reason.length < 5) return personal(a, 'Give a reason; the player is shown it.');
    if (kind === 'lift') {
      const s = activeSuspension(recordOf(profileOf(target)), Date.now());
      if (!s) return personal(a, `${display(target)} is not suspended.`);
      s.lifted = true;
    }
    const e = add(a, target, kind, reason, ms ? Date.now() + ms : 0);
    if (!e) return personal(a, 'The record could not be saved; nothing was done.');
    const extra = kind === 'suspend' ? ` until ${stamp(e.until)}` : '';
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
  registerChatCommand('discipline', command, { admin: true, help: '#TAG [warn|strike|suspend <12h|3d>|lift] <reason>: a player\'s record, or list' });

  for (const r of Array.isArray(C.record) ? C.record : []) {
    if (!r || !r.key || !['warn', 'strike'].includes(r.kind) || String(r.reason || '').length < 5) { log(`discipline: record entry ${r && r.key} refused`); continue; }
    if (Object.values(D.profiles).some((list) => list.some((e) => e.key === r.key))) continue;
    const target = findAnyByName(`#${String(r.tag || '').replace(/^#/, '')}`);
    if (!(target > 0)) { log(`discipline: record ${r.key}: no character #${r.tag}`); continue; }
    const by = String(r.by || 'staff').slice(0, 40);
    const e = add(0, target, r.kind, String(r.reason).slice(0, 300), 0, { key: String(r.key), by });
    if (e) audit(`DISCIPLINE ${r.kind} #${e.n} on ${who(target)} (profile ${profileOf(target)}) by ${by} (config ${r.key}): ${e.reason}`);
    if (e && onlineActors().includes(target)) { tell(target, e); e.seen = true; save(); }
  }

  // A suspension given while the player was in character select, or a login that raced the record, is caught here
  every('discipline', 30000, () => {
    const now = Date.now();
    for (const a of onlineActors()) { const s = activeSuspension(recordOf(profileOf(a)), now); if (s) kickWithReason(a, suspendedText(s)); }
  });
  log(`discipline on: ${Object.keys(D.profiles).length} account(s) on record`);
};
module.exports.lengthMs = lengthMs;
module.exports.activeSuspension = activeSuspension;
module.exports.activeStrikes = activeStrikes;
