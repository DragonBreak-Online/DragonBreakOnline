// DragonBreak Online: one leadership seat per character. Loaded by gamemode.js on every hot reload.
//
// Nate, 21 Oct: "Make it so no leadership can have leadership in any other faction or hold. Leadership of College of
// Whispers is tryna be the new Count." Nate, 23 Oct: "we need to make it so people cant be leadership in more than one
// faction regardless if it's secret, college, or hold/allegiance". A character who leads, or is an officer of, something
// cannot lead or be an officer of anything else: they step down first.
//
// A leadership seat is one of:
//   - the LEADER rank of any faction guilds.js holds (guild, college, secret society, allegiance, faith, cult, house,
//     pack, clan, a chartered player faction or a rising): the rank whose role is 'leader'. A pack's Alpha is this seat,
//     exactly as before (Nate, 23 Oct: "Keep pack alphas the same")
//   - an OFFICER rank of one (config officerRoles, guild-defs.json's role 'officer': Keeper of Secrets, Legate, Second)
//   - a court office (officials-seats.json): the ruler (rulerRanks: jarl, count, chieftain) and the court's officers
//     (courtSeats: steward, guard captain, hold commander, bane, stronghold guard commander)
// Not leadership: sergeants, mages, smiths, members, guards, court mages, shamans, wise-women, and a player guild's ('band')
// Guildmaster or officers (Nate, 21 Oct). A hold's or stronghold's own faction is never counted: its ranks follow the
// court's offices (court.js), so the office is the one seat. config officers false goes back to leaders and rulers only.
//
// Per CHARACTER by default: an account may lead with one character and follow with another. config perAccount true holds
// the rule across every character of one account. /leadership audit prints the account beside each seat either way.
//
// Every path that seats a leader, an officer or a court office asks __dboLeadershipRefusal first.
//   globalThis.__dboLeadershipOf(actor)              -> [{ kind, id, name, actor }], the seats that character holds
//   globalThis.__dboLeadershipRefusal(actor, skip, by) -> '' or "X already holds ...". skip: { kind, id } to ignore, for a
//                                                       re-seat of the same seat or a move inside one faction or court
//   globalThis.__dboLeadershipRole(role)             -> a faction rank role that is leadership
//   globalThis.__dboLeadershipOffice(office)         -> a court office that is leadership
//   globalThis.__dboLeadershipDoubles()              -> every character holding two or more, for /leadership audit
//   globalThis.__dboLeadershipAccountDoubles()       -> every account holding two or more over its characters
// Nothing is ever taken away here: existing doubles stand until staff sort them out. A double is told to step down from
// all but one (doublesNotice), and staff are told after staffAfterDays.
//
// config "leadership": { enabled, rulerRanks, staffOverride, officers, officerRoles, courtSeats, perAccount,
// doublesNotice: { enabled, everyHours, staffAfterDays, sweepMinutes } }. staffOverride true lets a Lead GM seat a double
// anyway; false, the default, holds the rule for staff appointments too.
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { log, personal, profileOf, display, registerChatCommand, isAdmin, cfg } = api;
  const audit = typeof api.audit === 'function' ? api.audit : () => {};
  const staffNote = typeof api.staffNote === 'function' ? api.staffNote : () => {};
  const onlineActors = typeof api.onlineActors === 'function' ? api.onlineActors : () => [];
  const accountActors = typeof api.accountActors === 'function' ? api.accountActors : () => [];
  const isLeadStaff = typeof api.isLeadStaff === 'function' ? api.isLeadStaff : () => false;
  const rulerSeats = typeof api.rulerSeats === 'function' ? api.rulerSeats : () => [];
  const C = Object.assign({
    enabled: true, rulerRanks: ['jarl', 'count', 'chieftain'], staffOverride: false,
    officers: true, officerRoles: ['officer'], courtSeats: ['steward', 'captain', 'guardcaptain', 'commander', 'bane', 'strongholdcommander'],
    perAccount: false,
  }, (cfg && cfg.leadership) || {});
  const N = Object.assign({ enabled: true, everyHours: 24, staffAfterDays: 7, sweepMinutes: 5 }, C.doublesNotice || {});
  const low = (xs) => (Array.isArray(xs) ? xs : []).map((r) => String(r).toLowerCase());
  const RULER = new Set(low(C.rulerRanks));
  const OFFICES = new Set(low(C.rulerRanks).concat(C.officers === true ? low(C.courtSeats) : []));
  const ROLES = new Set(['leader'].concat(C.officers === true ? low(C.officerRoles) : []));
  const isRole = (role) => ROLES.has(String(role || '').toLowerCase());
  const isOffice = (rank) => OFFICES.has(String(rank || '').toLowerCase());
  // guilds.js kinds whose ranks follow a court's offices, counted once as the office and never as a faction
  const COURT_KINDS = new Set(['hold', 'stronghold']);
  // A player guild's Guildmaster and officers are NOT leadership (Nate, 21 Oct). guilds.js keeps bands out of
  // __dboGuildsOf and __dboGuildLeaders already; named here so a later change to either cannot quietly count one.
  const BAND_KINDS = new Set(['band']);
  const skipKind = (k) => COURT_KINDS.has(String(k || '')) || BAND_KINDS.has(String(k || ''));
  const guildSeats = () => {
    try { return typeof globalThis.__dboGuildLeaders === 'function' ? (globalThis.__dboGuildLeaders({ roles: [...ROLES] }) || []) : []; } catch (e) { return []; }
  };
  const guildsOf = (a) => { try { return typeof globalThis.__dboGuildsOf === 'function' ? (globalThis.__dboGuildsOf(a >>> 0) || []) : []; } catch (e) { return []; } };
  const seatsOf = (a) => { try { return typeof api.ranksOf === 'function' ? (api.ranksOf(profileOf(a >>> 0), a >>> 0) || []) : []; } catch (e) { return []; } };
  const titleOf = (rank, zoneId) => { try { return typeof api.rankTitle === 'function' ? api.rankTitle(rank, zoneId) : String(rank); } catch (e) { return String(rank); } };
  const pidOf = (a) => { try { return Number(profileOf(a >>> 0)); } catch (e) { return -1; } };

  // The seats one character holds. kind: 'faction' for anything guilds.js holds, 'hold' for a court office
  const ownSeats = (a) => {
    const out = [];
    for (const m of guildsOf(a)) {
      if (!isRole(m.role) || skipKind(m.kind)) continue;
      out.push({ kind: 'faction', id: String(m.id), name: `${m.shown || m.title || 'Leader'} of ${m.name}`, actor: a >>> 0 });
    }
    for (const s of seatsOf(a)) {
      if (!s || !s.zone || !isOffice(s.rank)) continue;
      out.push({ kind: 'hold', id: String(s.zone.id), name: `${titleOf(s.rank, s.zone.id)} of ${s.zone.name}`, actor: a >>> 0 });
    }
    return out;
  };
  const leadershipOf = (a) => (C.enabled === true ? ownSeats(a) : []);
  // perAccount: the seats of every character of a's account, each seat once (a court office is per account)
  const accountSeats = (a) => {
    const me = a >>> 0; const pid = pidOf(me);
    const chars = [me].concat(pid >= 0 ? accountActors(pid).map((x) => Number(x) >>> 0).filter((x) => x && x !== me) : []);
    const seen = new Set(); const out = [];
    for (const c of chars) for (const s of ownSeats(c)) { const k = `${s.kind}:${s.id}`; if (!seen.has(k)) { seen.add(k); out.push(s); } }
    return out;
  };

  const nameOfActor = (a) => { try { return display(a >>> 0); } catch (e) { return 'They'; } };
  // '' when the character may take a new seat, else the line to show whoever is seating them.
  // skip is the seat being replaced: the same faction (a promotion or transfer inside it) or the same court (a re-seat or
  // a move), never counted
  const refusal = (a, skip) => {
    if (C.enabled !== true) return '';
    const sk = skip && skip.id ? { kind: String(skip.kind || ''), id: String(skip.id) } : null;
    const all = C.perAccount === true ? accountSeats(a) : leadershipOf(a);
    const held = all.filter((h) => !(sk && h.id === sk.id && (!sk.kind || h.kind === sk.kind)));
    if (!held.length) return '';
    const who = nameOfActor(a);
    const list = held.map((h) => (h.actor !== (a >>> 0) ? `${h.name} (as ${nameOfActor(h.actor)})` : h.name)).join(' and ');
    if (C.perAccount === true) return `${who}'s account already holds ${list}. One leadership seat per account, leader or officer, in any faction or court: step down from that first.`;
    return `${who} already holds ${list}. One leadership seat per character, leader or officer, in any faction or court: they step down from that first.`;
  };

  globalThis.__dboLeadershipOf = (a) => leadershipOf(Number(a) >>> 0);
  globalThis.__dboLeadershipRole = (role) => C.enabled === true && isRole(role);
  globalThis.__dboLeadershipOffice = (rank) => C.enabled === true && isOffice(rank);
  // by: the character doing the seating, so a Lead GM can be let through with leadership.staffOverride
  globalThis.__dboLeadershipRefusal = (a, skip, by) => {
    const text = refusal(Number(a) >>> 0, skip);
    if (!text) return '';
    if (C.staffOverride === true && by !== undefined && by !== null && isLeadStaff(Number(by) >>> 0)) return '';
    return text;
  };

  // Every seat in the live state: the faction leaders and officers guilds.js knows, and the court offices
  // officials-seats.json records. Offline characters are included. { actor, pid, who, seat }
  const allSeats = () => {
    const out = [];
    for (const l of guildSeats()) {
      if (skipKind(l.kind)) continue;
      if (l.role !== undefined && !isRole(l.role)) continue;   // an older guilds.js returns leaders only, without a role
      out.push({ actor: Number(l.actor) >>> 0, pid: Number(l.pid), who: l.who || '', seat: { kind: 'faction', id: String(l.id), name: `${l.title || 'Leader'} of ${l.name}` } });
    }
    for (const s of rulerSeats()) {
      if (!isOffice(s.rank)) continue;
      out.push({ actor: Number(s.actor) >>> 0, pid: Number(s.pid), who: '', seat: { kind: 'hold', id: String(s.zone), name: `${titleOf(s.rank, s.zone)} of ${s.zoneName || s.zone}` } });
    }
    return out;
  };
  const group = (keyOf) => {
    const by = new Map();
    for (const r of allSeats()) {
      const k = keyOf(r); if (k === null) continue;
      const e = by.get(k) || { actor: r.actor, actors: [], pid: r.pid, who: r.who, seats: [], ids: new Set() };
      const sid = `${r.seat.kind}:${r.seat.id}`;
      if (!e.ids.has(sid)) { e.ids.add(sid); e.seats.push(Object.assign({ actor: r.actor }, r.seat)); }
      if (r.actor && !e.actors.includes(r.actor)) e.actors.push(r.actor);
      if (!e.who && r.who) e.who = r.who;
      if (!(e.pid >= 0)) e.pid = r.pid;
      by.set(k, e);
    }
    return [...by.values()].filter((e) => e.seats.length > 1).sort((x, y) => y.seats.length - x.seats.length)
      .map((e) => ({ actor: e.actor, actors: e.actors, pid: e.pid, who: e.who, seats: e.seats }));
  };
  // Characters with two or more seats (an office not yet bound to a character counts for no one here)
  const doubles = () => group((r) => (r.actor ? `a${r.actor}` : null));
  // Accounts with two or more seats over all their characters
  const accountDoubles = () => group((r) => (r.pid >= 0 ? `p${r.pid}` : null));
  globalThis.__dboLeadershipDoubles = doubles;
  globalThis.__dboLeadershipAccountDoubles = accountDoubles;

  const nameFor = (actor, pid, fallback) => { try { return display(actor >>> 0); } catch (e) { return fallback || `profile ${pid}`; } };
  const DAY = 86400000;

  // ---- doubles told to step down: leadership-doubles.json { key: { since, seats, toldAt, staffAt } } ----
  const STATE = api.leadershipStatePath || path.resolve('leadership-doubles.json');
  const readState = () => { try { const v = JSON.parse(fs.readFileSync(STATE, 'utf8')); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
  const writeState = (o) => { try { fs.writeFileSync(STATE, JSON.stringify(o, null, 1)); } catch (e) { log('leadership-doubles.json write failed', e.message); } };
  const seatList = (seats, actor) => seats.map((s) => (actor && s.actor && s.actor !== actor ? `${s.name} (as ${nameFor(s.actor, -1, 'another character')})` : s.name)).join(' and ');
  const noticeText = (r, actor) => {
    const days = Number(N.staffAfterDays) || 0;
    return `You hold more than one seat of leadership: ${seatList(r.seats, actor)}. No one may lead or be an officer in more than one faction, hold or court${C.perAccount === true ? ' on one account' : ''}. Step down from all but one: leave the faction or ask its leader to lower your rank, or ask your court to release you from its office.${days > 0 ? ` If you still hold them ${days} day${days === 1 ? '' : 's'} after you were first told, the staff will be told.` : ''}`;
  };
  // The rows the notice works from: characters, or accounts with perAccount on
  const noticeRows = () => (C.perAccount === true
    ? accountDoubles().map((r) => Object.assign({ key: `p:${r.pid}` }, r))
    : doubles().map((r) => Object.assign({ key: `a:${r.actor}`, actors: [r.actor] }, r)));
  const sweep = (now = Date.now()) => {
    const out = { told: 0, staff: 0 };
    if (C.enabled !== true || N.enabled === false) return out;
    // guilds.js not up yet (a reload in progress) reads as nobody holding anything: never clear the record on that
    if (!guildSeats().length) return out;
    const st = readState(); let dirty = false;
    const live = new Set();
    const online = new Set(onlineActors().map((x) => Number(x) >>> 0));
    for (const r of noticeRows()) {
      live.add(r.key);
      if (!st[r.key]) { st[r.key] = { since: now }; dirty = true; }
      const e = st[r.key];
      const names = r.seats.map((s) => s.name);
      if (JSON.stringify(e.seats) !== JSON.stringify(names)) { e.seats = names; dirty = true; }
      const on = (r.actors || []).filter((x) => online.has(x >>> 0));
      if (on.length && now - (Number(e.toldAt) || 0) >= Math.max(1, Number(N.everyHours) || 24) * 3600000) {
        for (const x of on) personal(x, noticeText(r, x));
        if (!e.firstToldAt) e.firstToldAt = now;
        e.toldAt = now; dirty = true; out.told++;
      }
      const days = Number(N.staffAfterDays) || 0;
      const from = Number(e.firstToldAt) || 0;
      if (days > 0 && from && !e.staffAt && now - from >= days * DAY) {
        e.staffAt = now; dirty = true; out.staff++;
        const label = C.perAccount === true ? `Account ${r.pid}` : `${nameFor(r.actor, r.pid, r.who)} (account ${r.pid})`;
        const text = `${label} still holds ${r.seats.length} leadership seats, ${days} day${days === 1 ? '' : 's'} after being told to step down: ${seatList(r.seats)}. Nothing has been taken away; /leadership audit lists every double.`;
        audit(`LEADERSHIP ${text}`);
        try { staffNote(r.actor || (r.actors || [])[0], 'leadership double', text); } catch (err) { log('leadership: staff note failed', err.message); }
      }
    }
    for (const k of Object.keys(st)) if (!live.has(k)) { delete st[k]; dirty = true; }
    if (dirty) writeState(st);
    return out;
  };
  if (globalThis.__dboLeadershipTimer) { clearInterval(globalThis.__dboLeadershipTimer); globalThis.__dboLeadershipTimer = null; }
  if (api.leadershipSweep !== false && C.enabled === true && N.enabled !== false) {
    const t = setInterval(() => { try { sweep(); } catch (e) { log('leadership sweep failed', e.message); } }, Math.max(1, Number(N.sweepMinutes) || 5) * 60000);
    if (t && typeof t.unref === 'function') t.unref();
    globalThis.__dboLeadershipTimer = t;
  }

  registerChatCommand('leadership', (a, args) => {
    if (!isAdmin(a)) return personal(a, 'Staff only.');
    const sub = String(args || '').trim().toLowerCase();
    if (sub && sub !== 'audit') return personal(a, 'Usage: /leadership audit');
    if (C.enabled !== true) personal(a, 'One seat per character is OFF (config leadership.enabled), so nothing is refused; the list below is what it would catch.');
    const st = readState();
    const since = (k) => { const e = st[k]; return e && e.firstToldAt ? `, told ${Math.floor((Date.now() - e.firstToldAt) / DAY)} day(s) ago${e.staffAt ? ', staff told' : ''}` : ''; };
    const rows = doubles();
    const what = C.officers === true ? 'leadership seats (leader or officer)' : 'leadership seats';
    if (!rows.length) personal(a, `No character holds two ${what}.`);
    else {
      personal(a, `${rows.length} character${rows.length === 1 ? ' holds' : 's hold'} two or more ${what}. Nothing has been taken away; they step down by hand:`);
      for (const r of rows) personal(a, `  ${nameFor(r.actor, r.pid, r.who)} (account ${r.pid}): ${r.seats.map((s) => s.name).join(', ')}${C.perAccount === true ? '' : since(`a:${r.actor}`)}`);
    }
    // Accounts whose seats are spread over two or more characters: what perAccount holds (or would hold, when off)
    const acc = accountDoubles().filter((r) => C.perAccount === true || new Set(r.seats.map((s) => s.actor)).size > 1);
    if (acc.length) {
      personal(a, C.perAccount === true ? `${acc.length} account${acc.length === 1 ? ' holds' : 's hold'} two or more over their characters (perAccount is on):`
        : `With perAccount on, ${acc.length} more account${acc.length === 1 ? ' would' : 's would'} be over the limit across characters:`);
      for (const r of acc) personal(a, `  account ${r.pid}: ${r.seats.map((s) => `${s.name} (${s.actor ? nameFor(s.actor, r.pid, 'a character') : 'no character bound'})`).join(', ')}${C.perAccount === true ? since(`p:${r.pid}`) : ''}`);
    }
    return undefined;
  }, { admin: true, help: 'audit: characters (and accounts) holding more than one leadership seat' });

  log(`leadership on: one seat per ${C.perAccount === true ? 'account' : 'character'} ${C.enabled === true ? 'enforced' : 'OFF'}, rulers ${[...RULER].join('/')}${C.officers === true ? `, officers (${[...ROLES].filter((r) => r !== 'leader').join('/')}; ${low(C.courtSeats).join('/')})` : ''}${C.staffOverride === true ? ', a Lead GM may override' : ''}`);
  return { leadershipOf, refusal, doubles, accountDoubles, sweep, isRole, isOffice };
};
