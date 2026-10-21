// DragonBreak Online: one leadership seat per character. Loaded by gamemode.js on every hot reload.
//
// Nate, 21 Oct: "Make it so no leadership can have leadership in any other faction or hold. Leadership of College of
// Whispers is tryna be the new Count." A character who leads something cannot lead anything else: they step down first.
//
// Leadership is two things, and nothing else:
//   - the LEADER rank of a faction, guild, college, clan, cult, pack or chartered player faction (guilds.js, the rank
//     whose role is 'leader'; a charter's Founder becomes it on approval)
//   - the RULER seat of a hold, county or stronghold (config rulerRanks: jarl, count, chieftain), as officials-seats.json
//     records it. Stewards, Guard Captains, Thanes, Court Mages, faction officers and sergeants are NOT leadership: they
//     answer to a leader rather than being one. guilds.js's officer role may set ranks below itself, which is delegation,
//     not leadership.
// Per CHARACTER, not per account: an account may lead with one character and follow with another, which is how ranksOf
// and the faction rosters already read (both are actor-keyed since 19 Oct). An account holding two leaderships on two
// characters is allowed by this rule and is Nate's to judge, so the audit prints the account beside each seat.
//
// Every path that seats a leader or a ruler asks __dboLeadershipRefusal first: '' to go ahead, else the line to show.
//   globalThis.__dboLeadershipOf(actor)              -> [{ kind, id, name }], the seats that character holds
//   globalThis.__dboLeadershipRefusal(actor, skip)   -> '' or "X already holds ...". skip: { kind, id } to ignore,
//                                                       for a re-seat of the same seat or a transfer inside one faction
//   globalThis.__dboLeadershipDoubles()              -> every character holding two or more, for /leadership audit
// Nothing is ever taken away here: existing doubles stand until staff sort them out (Nate: don't strip anyone).
//
// config "leadership": { enabled, rulerRanks, staffOverride }. staffOverride true lets a Lead GM seat a double anyway
// (the refusal still shows for everyone else); false, the default, holds the rule for staff appointments too.
'use strict';

module.exports = (api) => {
  const { log, personal, profileOf, display, registerChatCommand, isAdmin, cfg } = api;
  const isLeadStaff = typeof api.isLeadStaff === 'function' ? api.isLeadStaff : () => false;
  const rulerSeats = typeof api.rulerSeats === 'function' ? api.rulerSeats : () => [];
  const guildLeaders = () => { try { return typeof globalThis.__dboGuildLeaders === 'function' ? (globalThis.__dboGuildLeaders() || []) : []; } catch (e) { return []; } };
  const C = Object.assign({ enabled: true, rulerRanks: ['jarl', 'count', 'chieftain'], staffOverride: false }, (cfg && cfg.leadership) || {});
  const RULER = new Set((C.rulerRanks || []).map((r) => String(r).toLowerCase()));
  // guilds.js kinds whose leader rank IS a court's ruler seat, counted once as the seat and never as a faction
  const COURT_KINDS = new Set(['hold', 'stronghold']);
  // A player guild's Guildmaster is NOT a leadership seat (Nate, 21 Oct). guilds.js already keeps bands out of
  // __dboGuildsOf and __dboGuildLeaders, so neither the check nor the audit sees one; named here so a later change to
  // either does not quietly make a Guildmaster a leader.
  const BAND_KINDS = new Set(['band']);

  const guildsOf = (a) => { try { return typeof globalThis.__dboGuildsOf === 'function' ? (globalThis.__dboGuildsOf(a >>> 0) || []) : []; } catch (e) { return []; } };
  const seatsOf = (a) => { try { return typeof api.ranksOf === 'function' ? (api.ranksOf(profileOf(a >>> 0), a >>> 0) || []) : []; } catch (e) { return []; } };
  const titleOf = (rank, zoneId) => { try { return typeof api.rankTitle === 'function' ? api.rankTitle(rank, zoneId) : String(rank); } catch (e) { return String(rank); } };

  // The seats this character leads with. kind: 'faction' for anything guilds.js holds, 'hold' for a ruler seat
  const leadershipOf = (a) => {
    if (C.enabled !== true) return [];
    const out = [];
    for (const m of guildsOf(a)) {
      if (String(m.role || '') !== 'leader') continue;
      // A hold's or stronghold's own faction is NOT a second seat: court.js keeps its leader rank in step with the
      // office, so a Jarl leads "Whiterun Hold" because they are Jarl of Whiterun. Counting both would refuse every
      // ruler their own seat. The ruler seat below is the one that speaks for a court.
      if (COURT_KINDS.has(String(m.kind || '')) || BAND_KINDS.has(String(m.kind || ''))) continue;
      out.push({ kind: 'faction', id: String(m.id), name: `${m.shown || m.title || 'Leader'} of ${m.name}` });
    }
    for (const s of seatsOf(a)) {
      if (!s || !s.zone || !RULER.has(String(s.rank).toLowerCase())) continue;
      out.push({ kind: 'hold', id: String(s.zone.id), name: `${titleOf(s.rank, s.zone.id)} of ${s.zone.name}` });
    }
    return out;
  };

  // '' when the character may take a new leadership seat, else the line to show whoever is seating them.
  // skip is the seat being replaced: the same faction (a transfer inside it) or the same zone (a re-seat), never counted.
  const refusal = (a, skip) => {
    if (C.enabled !== true) return '';
    const sk = skip && skip.id ? { kind: String(skip.kind || ''), id: String(skip.id) } : null;
    const held = leadershipOf(a).filter((h) => !(sk && h.id === sk.id && (!sk.kind || h.kind === sk.kind)));
    if (!held.length) return '';
    const who = (() => { try { return display(a >>> 0); } catch (e) { return 'They'; } })();
    const list = held.map((h) => h.name).join(' and ');
    return `${who} already holds ${list}. One leadership seat per character: they step down from that first.`;
  };

  globalThis.__dboLeadershipOf = (a) => leadershipOf(Number(a) >>> 0);
  // by: the character doing the seating, so a Lead GM can be let through with leadership.staffOverride
  globalThis.__dboLeadershipRefusal = (a, skip, by) => {
    const text = refusal(Number(a) >>> 0, skip);
    if (!text) return '';
    if (C.staffOverride === true && by !== undefined && isLeadStaff(Number(by) >>> 0)) return '';
    return text;
  };

  // Every character with two or more seats, read from the live state: the faction leaders guilds.js knows and the ruler
  // seats officials-seats.json records. Offline characters are included; the account is named beside each one.
  const doubles = () => {
    const by = new Map();   // actor -> { pid, seats: [{ kind, id, name }] }
    const add = (actor, pid, seat) => {
      const k = Number(actor) >>> 0;
      if (!k) return;
      const e = by.get(k) || { pid: Number(pid), seats: [] };
      e.seats.push(seat); if (!(e.pid >= 0)) e.pid = Number(pid);
      by.set(k, e);
    };
    for (const l of guildLeaders()) {
      if (COURT_KINDS.has(String(l.kind || ''))) continue;   // the same seat as the ruler row below
      if (BAND_KINDS.has(String(l.kind || ''))) continue;    // a player guild is no leadership seat
      add(l.actor, l.pid, { kind: 'faction', id: String(l.id), name: `${l.title || 'Leader'} of ${l.name}` });
    }
    for (const s of rulerSeats()) if (RULER.has(String(s.rank).toLowerCase())) add(s.actor, s.pid, { kind: 'hold', id: String(s.zone), name: `${titleOf(s.rank, s.zone)} of ${s.zoneName || s.zone}` });
    return [...by.entries()].filter(([, e]) => e.seats.length > 1)
      .map(([actor, e]) => ({ actor, pid: e.pid, seats: e.seats }))
      .sort((x, y) => y.seats.length - x.seats.length);
  };
  globalThis.__dboLeadershipDoubles = doubles;

  const nameFor = (actor, pid) => { try { return display(actor >>> 0); } catch (e) { return `profile ${pid}`; } };
  registerChatCommand('leadership', (a, args) => {
    if (!isAdmin(a)) return personal(a, 'Staff only.');
    const sub = String(args || '').trim().toLowerCase();
    if (sub && sub !== 'audit') return personal(a, 'Usage: /leadership audit');
    if (C.enabled !== true) personal(a, 'One seat per character is OFF (config leadership.enabled), so nothing is refused; the list below is what it would catch.');
    const rows = doubles();
    if (!rows.length) return personal(a, 'No character holds two leadership seats.');
    personal(a, `${rows.length} character${rows.length === 1 ? ' holds' : 's hold'} two or more leadership seats. Nothing has been taken away; they step down by hand:`);
    for (const r of rows) personal(a, `  ${nameFor(r.actor, r.pid)} (account ${r.pid}): ${r.seats.map((s) => s.name).join(', ')}`);
    return undefined;
  }, { admin: true, help: 'audit: characters holding more than one leadership seat' });

  log(`leadership on: one seat per character ${C.enabled === true ? 'enforced' : 'OFF'}, rulers ${[...RULER].join('/')}${C.staffOverride === true ? ', a Lead GM may override' : ''}`);
  return { leadershipOf, refusal, doubles };
};
