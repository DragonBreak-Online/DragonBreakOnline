// DragonBreak Online: citizenship of the holds, and the first vote for a Jarl (Nate, 13/14 Oct 2026; design
// ~/claude-nate-release/specs/citizenship-1014.md, plan citizenship-1014-plan.md). Loaded by gamemode.js after court.js,
// nobility.js and tenancy.js.
//
// A hold grants citizenship when its first office is a ruler's (config rulerOffices: the Jarl of a Skyrim hold, the Count
// or Countess of Bruma). Its ruler or a seated Steward sets how (policy): 'manual' (the character asks, the ruler or Steward
// grants it, from the notice board, the F3 Citizen tab or the X menu), 'paid' (a fee into the hold's treasury) or 'free'.
// A hold with nobody in the ruler's seat grants it free and at once, whatever the policy ("first time citizen with no Jarl
// is free"). Citizenship belongs to one character: at most maxHolds (two), the first its Primary, the next its Secondary.
// Renouncing one starts cooldownDays (seven) in which the character joins no other hold. Members of the factions and courts
// based in an auto hold (Bruma) are its citizens while the membership lasts (a faction whose zone or hall is there, or an
// account seated in its offices).
// Citizenship is the whitelist for buying property in the hold (tenancy.js asks __dboCitizenOf), and gives a Discord role
// per hold (discordroles.js asks __dboCitizenRoleIds; role ids from config discordRoles, never created here).
//
// The vote (Nate's election rules, 14 Oct): in a hold not in noElection (Bruma has a Count), an election starts by itself
// once election.threshold (15) accounts have a citizen character there. registrationHours (24) for candidates to enter a
// complete court (Jarl, Steward, Lord Commander, Housecarl; every member a citizen in no faction, each one accepting; the
// Jarl a Breton, Nord or Imperial), then votingHours (24) of voting by citizens in no faction, one ballot per account. No
// count is shown to anyone until the vote ends. No complete court at the close: registration runs again while the hold
// still has its 15, else the election is cancelled until it does. A tie: a revote between the tied courts only, as often as
// it takes. A single court takes office with at least one vote. Eligibility is judged at each close: in registration a court
// with a member who lost it is dropped unless the candidate replaced them; in voting such a seat starts empty, and a Jarl
// candidate who lost it strikes the court off and voids its votes. The winner is seated (officials.json and the household
// rank), the result shown with each court's count. Every phase's start and end are stored, so a restart resumes the clock.
//
// State in citizenship.json (runtime, gitignored):
//   { chars: { <actor hex>: { pid, name, holds: [{ zone, since, how }], cooldownUntil, renounced: [{ zone, at }] } },
//     requests: [{ zone, actor, pid, name, at }], policies: { zone: { policy, fee, by, at } },
//     elections: { zone: { phase, round, startedAt, phaseStartedAt, phaseEndsAt, courts: [court], ballot: [id], votes: { pid: id },
//                          result?: { winner, counts, at }, held? } } }
//   court: { id, at, members: { jarl|steward|commander|housecarl: { actor, pid, name, accepted } | null }, struck? }
//
// Panels: the notice board's Citizenship and Voting tabs (front bountyBoard sends dbo:citizenOpen <tab>) open the board panel
// (front citizenBoard, widget 84) for the board's hold; the F3 journal's Citizen tab (__dboJournalSections.citizen). Events:
//   citizenOpen [tab]                       at a notice board
//   citizenAct  [nonce, action, ...args]    the board panel (nonce of its last draw)
//   citizenJ    [journalNonce, action, zone, ...args]  the F3 Citizen tab (answers through __dboJournalLimited)
//   citizenClose / citizenBack                close the panel / back to the board's notices
// actions: join, renounce <zone>, primary <zone>, policy <policy> <fee>, grant <actorHex>, decline <actorHex>,
//   register <steward> <commander> <housecarl>, replace <seat> <name>, withdraw, accept <courtId>, refuse <courtId>,
//   vote <courtId>, staff <cancel|restart|resume>, revoke <actorHex>
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, audit, who, onUi, onlineActors, profileOf, cfg, every, zoneList, zoneById, readOfficials, rankTitle, officialTarget,
    accountActors, seatOfficial } = api;
  const personal = typeof api.personal === 'function' ? api.personal : () => {};
  const isAdmin = typeof api.isAdmin === 'function' ? api.isAdmin : () => false;
  const isLeadStaff = typeof api.isLeadStaff === 'function' ? api.isLeadStaff : () => false;
  const nameOf = typeof api.nameOf === 'function' ? api.nameOf : () => '';
  const ownNameOf = typeof api.ownNameOf === 'function' ? api.ownNameOf : nameOf;
  const tagOf = typeof api.tagOf === 'function' ? api.tagOf : () => '';
  const takeGold = typeof api.takeGold === 'function' ? api.takeGold : () => false;
  const depositToTreasury = typeof api.depositToTreasury === 'function' ? api.depositToTreasury : () => 0;
  const openWidget = api.openWidget || (() => false), closeWidget = api.closeWidget || (() => false);
  const boardZoneNear = typeof api.boardZoneNear === 'function' ? api.boardZoneNear : () => null;
  const raceEdidOf = typeof api.raceEdidOf === 'function' ? api.raceEdidOf : () => '';
  const unseatOfficialBy = typeof api.unseatOfficialBy === 'function' ? api.unseatOfficialBy : null;

  const E0 = { threshold: 15, registrationHours: 24, votingHours: 24, jarlRaces: ['BretonRace', 'NordRace', 'ImperialRace'], noFactionVoters: true,
    // The ballot's four seats and where the winner sits: an office of zones.json ('@ruler' = the hold's first office) or a
    // rank of the hold's household (guild-defs.json)
    seats: [{ id: 'jarl', label: 'Jarl', office: '@ruler' }, { id: 'steward', label: 'Steward', office: 'steward' },
      { id: 'commander', label: 'Lord Commander', office: 'commander' }, { id: 'housecarl', label: 'Housecarl', rank: 'Housecarl' }] };
  const C = Object.assign({ enabled: true, rulerOffices: ['jarl', 'count'], stewardOffices: ['steward'], maxHolds: 2, cooldownDays: 7, maxFee: 100000,
    defaultPolicy: 'free', requestDays: 14, auto: ['bruma'], noElection: ['bruma'], discordRoles: {} }, (cfg && cfg.citizenship) || {});
  C.election = Object.assign({}, E0, C.election || {});
  const PANEL_ID = 84;
  const FILE = path.resolve('citizenship.json');
  const DAY = 86400000, HOUR = 3600000;
  const POLICIES = ['manual', 'paid', 'free'];
  const SEATS = C.election.seats;

  // ---- state ---------------------------------------------------------------------------------------------------------
  const S = globalThis.__dboCitizen || (globalThis.__dboCitizen = { data: null });
  if (!(S.panels instanceof Map)) S.panels = new Map(); // actor -> { zone, nonce, tab }
  const fill = (d) => {
    for (const k of ['chars', 'policies', 'elections']) if (!d[k] || typeof d[k] !== 'object' || Array.isArray(d[k])) d[k] = {};
    if (!Array.isArray(d.requests)) d.requests = [];
    return d;
  };
  const data = () => {
    if (S.data) return S.data;
    let d = null;
    try { d = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { d = null; }
    S.data = fill(d && typeof d === 'object' ? d : {});
    return S.data;
  };
  if (S.data) fill(S.data);
  const save = () => {
    try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(data(), null, 1)); fs.renameSync(FILE + '.tmp', FILE); }
    catch (e) { log('citizenship: saving failed', e.message); }
  };

  // ---- characters ------------------------------------------------------------------------------------------------------
  const hex = (a) => (Number(a) >>> 0).toString(16);
  const unhex = (s) => (parseInt(String(s || ''), 16) >>> 0);
  const exists = (a) => { if (!a) return false; try { mp.get(a >>> 0, 'type'); return true; } catch (e) { return false; } };
  const isOnline = (a) => onlineActors().includes(a >>> 0);
  const tagSafe = (a) => { try { return String(tagOf(a) || ''); } catch (e) { return ''; } };
  const nameNow = (a, fallback) => { try { const n = ownNameOf(a); if (n) return String(n); } catch (e) { /* fallback */ } return String(fallback || 'someone'); };
  const ofPlace = (name) => String(name || '').replace(/^The /, 'the ');
  const dateText = (t) => new Date(Number(t) || 0).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const tell = (a, text) => { if (a && isOnline(a)) personal(a >>> 0, text); };

  // ---- holds ---------------------------------------------------------------------------------------------------------
  const grants = (z) => !!z && (C.rulerOffices || []).includes((z.officials || [])[0]);
  const holdOf = (id) => { const z = zoneById(String(id || '')); return grants(z) ? z : null; };
  const holds = () => zoneList().filter(grants);
  const rulerOffice = (z) => (z.officials || [])[0];
  const seated = (z, office) => (((readOfficials() || {})[z.id] || {})[office] || []).map(Number);
  const courtFaction = (zid) => (typeof globalThis.__dboCourtFaction === 'function' ? globalThis.__dboCourtFaction(zid) : null);
  const guildsOf = (a) => { try { return typeof globalThis.__dboGuildsOf === 'function' ? (globalThis.__dboGuildsOf(a >>> 0) || []) : []; } catch (e) { return []; } };
  // The hold's ruler: the account in its first office, or its household's leader
  const rules = (a, z) => {
    if (seated(z, rulerOffice(z)).includes(Number(profileOf(a)))) return true;
    const fid = courtFaction(z.id);
    return !!fid && guildsOf(a).some((g) => g.id === fid && g.role === 'leader');
  };
  const hasRuler = (z) => {
    if (seated(z, rulerOffice(z)).length) return true;
    const fid = courtFaction(z.id);
    try { return !!fid && typeof globalThis.__dboGuildHolders === 'function' && globalThis.__dboGuildHolders(fid, 0).some(exists); } catch (e) { return false; }
  };
  const isSteward = (a, z) => (C.stewardOffices || []).some((o) => seated(z, o).includes(Number(profileOf(a))));
  // Who runs the hold's citizenship: the ruler, a Steward, or staff
  const manages = (a, z) => isAdmin(a) || rules(a, z) || isSteward(a, z);
  const rulerWord = (z) => rankTitle(rulerOffice(z), z.id);
  const hasTreasury = (z) => !!(z && z.treasury);

  // ---- citizenship -----------------------------------------------------------------------------------------------------
  const entryOf = (a) => data().chars[hex(a)] || null;
  const explicit = (a) => { const e = entryOf(a); return e && Array.isArray(e.holds) ? e.holds.filter((h) => holdOf(h.zone)) : []; };
  // The auto holds this character is a citizen of through a faction or court based there
  const factionZone = (g) => String(g.zone || (g.hall && g.hall.zone) || '');
  const autoHolds = (a) => {
    const out = [];
    for (const zid of C.auto || []) {
      const z = holdOf(zid); if (!z) continue;
      const viaFaction = guildsOf(a).some((g) => factionZone(g) === z.id);
      const pid = Number(profileOf(a));
      const viaOffice = pid >= 0 && (z.officials || []).some((o) => seated(z, o).includes(pid));
      if (viaFaction || viaOffice) out.push(z.id);
    }
    return out;
  };
  // Every hold of the character, Primary first: { zone, since, how, auto }
  const holdsOf = (a) => {
    const list = explicit(a).map((h) => ({ zone: h.zone, since: h.since, how: h.how, auto: false }));
    for (const zid of autoHolds(a)) if (!list.some((h) => h.zone === zid)) list.push({ zone: zid, since: 0, how: 'faction or court', auto: true });
    return list;
  };
  const citizenOf = (a, zid) => holdsOf(a).some((h) => h.zone === String(zid || ''));
  // "In no faction": no membership but a hold household's Citizen rank
  const factionsOf = (a) => guildsOf(a).filter((g) => !(g.kind === 'hold' && String(g.title).toLowerCase() === 'citizen'));
  const factionFree = (a) => factionsOf(a).length === 0;
  const cooldownLeft = (a) => { const e = entryOf(a); return e && Number(e.cooldownUntil) > Date.now() ? Number(e.cooldownUntil) - Date.now() : 0; };
  const requestOf = (a, zid) => data().requests.find((r) => (r.actor >>> 0) === (a >>> 0) && r.zone === zid) || null;
  const liveRequests = () => { const cut = Date.now() - C.requestDays * DAY; data().requests = data().requests.filter((r) => Number(r.at) > cut && exists(r.actor)); return data().requests; };
  const policyOf = (z) => {
    const p = data().policies[z.id] || {};
    return { policy: POLICIES.includes(p.policy) ? p.policy : (POLICIES.includes(C.defaultPolicy) ? C.defaultPolicy : 'free'), fee: Math.max(0, Math.floor(Number(p.fee) || 0)), set: !!p.policy };
  };
  // How this character could join z now: { how: 'free'|'paid'|'manual'|'nofee', fee } or { error }
  const joinCheck = (a, z) => {
    if (citizenOf(a, z.id)) return { error: `You are already a citizen of ${ofPlace(z.name)}.` };
    const left = cooldownLeft(a);
    if (left) return { error: `You renounced a citizenship lately. You may take another from ${dateText(Date.now() + left)}.` };
    if (holdsOf(a).length >= C.maxHolds) return { error: `You are a citizen of ${C.maxHolds} holds already, the most anyone may be. Renounce one first (F3, Citizen).` };
    if (!hasRuler(z)) return { how: 'free', fee: 0, noRuler: true };
    const p = policyOf(z);
    if (p.policy === 'paid') return p.fee > 0 && hasTreasury(z) ? { how: 'paid', fee: p.fee } : { how: 'free', fee: 0 };
    return { how: p.policy, fee: 0 };
  };
  const addHold = (a, z, how) => {
    const d = data(); const k = hex(a);
    const e = d.chars[k] || (d.chars[k] = { pid: Number(profileOf(a)), name: '', holds: [], renounced: [] });
    e.pid = Number(profileOf(a)); e.name = nameNow(a, e.name);
    if (!Array.isArray(e.holds)) e.holds = [];
    e.holds = e.holds.filter((h) => h.zone !== z.id).concat([{ zone: z.id, since: Date.now(), how }]);
    d.requests = d.requests.filter((r) => !((r.actor >>> 0) === (a >>> 0) && r.zone === z.id));
    save();
  };
  const join = (a, zid) => {
    const z = holdOf(zid); if (!z) return { error: 'This land grants no citizenship.' };
    const chk = joinCheck(a, z); if (chk.error) return chk;
    if (chk.how === 'manual') {
      if (requestOf(a, z.id)) return { error: `You have asked already. The ${rulerWord(z)} or the Steward of ${ofPlace(z.name)} decides.` };
      data().requests.push({ zone: z.id, actor: a >>> 0, pid: Number(profileOf(a)), name: nameNow(a), at: Date.now() });
      save();
      for (const m of onlineActors()) if (m !== (a >>> 0) && !isAdmin(m) && (rules(m, z) || isSteward(m, z))) personal(m, `${nameNow(a)} asks to become a citizen of ${ofPlace(z.name)}. Grant or decline it at a notice board (Citizenship) or in your journal (F3, Citizen).`);
      audit(`CITIZEN ${who(a)} asked for the citizenship of ${z.name}`);
      return { text: `You have asked for the citizenship of ${ofPlace(z.name)}. Go before the ${rulerWord(z)} or the Steward: they grant it.` };
    }
    if (chk.how === 'paid') {
      if (!takeGold(a, chk.fee)) return { error: `The citizenship of ${ofPlace(z.name)} costs ${chk.fee} gold, and you do not carry it.` };
      const paid = depositToTreasury(z.id, chk.fee);
      if (paid !== chk.fee) log(`citizenship: the treasury of ${z.id} took ${paid} of a ${chk.fee} gold fee`);
    }
    addHold(a, z, chk.noRuler ? 'free (no ruler)' : chk.how === 'paid' ? `paid ${chk.fee}` : 'free');
    audit(`CITIZEN ${who(a)} became a citizen of ${z.name} (${chk.noRuler ? 'free, no ruler seated' : chk.how}${chk.fee ? `, ${chk.fee} gold to the treasury` : ''})`);
    return { text: `You are a citizen of ${ofPlace(z.name)}${chk.fee ? `, for ${chk.fee} gold paid into its treasury` : ''}.${holdsOf(a).length > 1 ? ' It is your Secondary citizenship.' : ''}` };
  };
  const grant = (by, zid, actor) => {
    const z = holdOf(zid); if (!z) return { error: 'This land grants no citizenship.' };
    if (!manages(by, z)) return { error: `Only the ${rulerWord(z)} or the Steward of ${ofPlace(z.name)} grants its citizenship.` };
    const r = requestOf(actor, z.id); if (!r) return { error: 'That character has not asked for citizenship here.' };
    if (!exists(actor)) { liveRequests(); save(); return { error: 'That character no longer exists.' }; }
    const chk = joinCheck(actor, z);
    if (chk.error) return { error: `${r.name} cannot take it now: ${chk.error.replace(/^You are/, 'they are').replace(/^You /, 'they ')}` };
    addHold(actor, z, `granted by ${who(by)}`);
    audit(`CITIZEN ${who(by)} granted ${r.name} (character ${hex(actor)}) the citizenship of ${z.name}`);
    tell(actor, `You are now a citizen of ${ofPlace(z.name)}, granted by ${nameNow(by)}.`);
    return { text: `${r.name} is now a citizen of ${ofPlace(z.name)}.` };
  };
  const decline = (by, zid, actor) => {
    const z = holdOf(zid); if (!z) return { error: 'This land grants no citizenship.' };
    if (!manages(by, z)) return { error: `Only the ${rulerWord(z)} or the Steward of ${ofPlace(z.name)} decides on its citizenship.` };
    const r = requestOf(actor, z.id); if (!r) return { error: 'That request has already gone.' };
    data().requests = data().requests.filter((x) => x !== r); save();
    audit(`CITIZEN ${who(by)} declined ${r.name}'s request for the citizenship of ${z.name}`);
    tell(actor, `Your request for the citizenship of ${ofPlace(z.name)} was declined.`);
    return { text: `You declined ${r.name}'s request.` };
  };
  const renounce = (a, zid) => {
    const z = holdOf(zid); if (!z) return { error: 'There is no such hold.' };
    const h = holdsOf(a).find((x) => x.zone === z.id);
    if (!h) { const r = requestOf(a, z.id); if (r) { data().requests = data().requests.filter((x) => x !== r); save(); return { text: 'Your request is withdrawn.' }; } return { error: `You are no citizen of ${ofPlace(z.name)}.` }; }
    if (h.auto) return { error: `You are a citizen of ${ofPlace(z.name)} through a faction or court based there, for as long as you serve it.` };
    const e = entryOf(a);
    e.holds = e.holds.filter((x) => x.zone !== z.id);
    e.cooldownUntil = Date.now() + C.cooldownDays * DAY;
    e.renounced = (Array.isArray(e.renounced) ? e.renounced : []).concat([{ zone: z.id, at: Date.now() }]).slice(-10);
    save();
    audit(`CITIZEN ${who(a)} renounced the citizenship of ${z.name}; no other until ${dateText(e.cooldownUntil)}`);
    return { text: `You are no longer a citizen of ${ofPlace(z.name)}. You may take another citizenship from ${dateText(e.cooldownUntil)}.` };
  };
  const makePrimary = (a, zid) => {
    const e = entryOf(a); const list = explicit(a);
    if (!e || !list.some((h) => h.zone === zid)) return { error: 'That is not one of your citizenships.' };
    e.holds = [list.find((h) => h.zone === zid)].concat(list.filter((h) => h.zone !== zid));
    save();
    const z = holdOf(zid);
    return { text: `${z ? z.name : zid} is now your Primary citizenship.` };
  };
  const revoke = (by, zid, actor) => {
    if (!isLeadStaff(by)) return { error: 'Only a Lead GM or above revokes a citizenship.' };
    const z = holdOf(zid); const e = entryOf(actor);
    if (!z || !e || !explicit(actor).some((h) => h.zone === z.id)) return { error: 'That character holds no such citizenship, or holds it through a faction.' };
    e.holds = e.holds.filter((h) => h.zone !== z.id); save();
    audit(`CITIZEN STAFF ${who(by)} revoked the citizenship of ${z.name} from ${e.name} (character ${hex(actor)})`);
    tell(actor, `Your citizenship of ${ofPlace(z.name)} was revoked by the staff.`);
    return { text: `${e.name} is no longer a citizen of ${ofPlace(z.name)}.` };
  };
  const setPolicy = (by, zid, policy, fee) => {
    const z = holdOf(zid); if (!z) return { error: 'This land grants no citizenship.' };
    if (!manages(by, z)) return { error: `Only the ${rulerWord(z)} or the Steward of ${ofPlace(z.name)} sets how its citizenship is granted.` };
    const p = String(policy || '').toLowerCase();
    if (!POLICIES.includes(p)) return { error: 'Choose Manual approval, Paid or Free.' };
    let f = 0;
    if (p === 'paid') {
      if (!hasTreasury(z)) return { error: `${z.name} keeps no treasury, so it cannot charge a fee.` };
      f = Math.floor(Number(fee));
      if (!(f >= 1 && f <= C.maxFee)) return { error: `A fee is a whole number of gold from 1 to ${C.maxFee}.` };
    }
    data().policies[z.id] = { policy: p, fee: f, by: who(by), at: Date.now() }; save();
    audit(`CITIZEN ${who(by)} set the citizenship of ${z.name} to ${p}${f ? ` at ${f} gold` : ''}`);
    return { text: p === 'paid' ? `The citizenship of ${ofPlace(z.name)} now costs ${f} gold, paid into its treasury.` : p === 'free' ? `The citizenship of ${ofPlace(z.name)} is now free.` : `The citizenship of ${ofPlace(z.name)} is now granted only by you or the Steward, on request.` };
  };

  // ---- the vote --------------------------------------------------------------------------------------------------------
  const EL = C.election;
  const electing = (z) => !!z && grants(z) && !(C.noElection || []).includes(z.id);
  const elOf = (zid) => data().elections[zid] || null;
  // The accounts with a citizen character in z: explicit entries, and the auto holds' faction members and officials
  const citizenAccounts = (z) => {
    const pids = new Set();
    for (const [k, e] of Object.entries(data().chars)) {
      if (!e || !Array.isArray(e.holds) || !e.holds.some((h) => h.zone === z.id)) continue;
      if (!exists(unhex(k))) continue;
      const pid = Number(profileOf(unhex(k))); pids.add(pid >= 0 ? pid : Number(e.pid));
    }
    if ((C.auto || []).includes(z.id)) {
      for (const o of z.officials || []) for (const pid of seated(z, o)) pids.add(pid);
      try {
        for (const fid of (typeof globalThis.__dboFactionList === 'function' ? globalThis.__dboFactionList() : []).concat(courtFaction(z.id) || [])) {
          const info = typeof globalThis.__dboGuildInfo === 'function' ? globalThis.__dboGuildInfo(fid) : null;
          if (!info || String(info.zone || (info.hall && info.hall.zone) || '') !== z.id) continue;
          for (const m of (typeof globalThis.__dboGuildMembers === 'function' ? globalThis.__dboGuildMembers(fid) : [])) { const p = Number(profileOf(m)); if (p >= 0) pids.add(p); }
        }
      } catch (e) { /* no guilds */ }
    }
    return pids.size;
  };
  const isJarlRace = (a) => { const r = String(raceEdidOf(a) || ''); return (EL.jarlRaces || []).some((p) => new RegExp(`^${p}(Vampire)?$`).test(r)); };
  // Why a character cannot stand for a seat of z's ballot, or ''
  const unfit = (a, z, seat) => {
    if (!exists(a)) return 'no longer exists';
    if (!citizenOf(a, z.id)) return `is no citizen of ${ofPlace(z.name)}`;
    if (!factionFree(a)) return 'serves a faction';
    if (seat === 'jarl' && !isJarlRace(a)) return 'is no Breton, Nord or Imperial: only they may be Jarl';
    return '';
  };
  const canVote = (a, z) => {
    if (!citizenOf(a, z.id)) return `Only the citizens of ${ofPlace(z.name)} vote here.`;
    if (EL.noFactionVoters && !factionFree(a)) return 'Those who serve a faction or a court cannot vote in this first election.';
    return '';
  };
  const courtById = (E, id) => (E.courts || []).find((c) => c.id === String(id || '')) || null;
  const courtOfActor = (E, a) => (E.courts || []).find((c) => SEATS.some((s) => c.members[s.id] && (c.members[s.id].actor >>> 0) === (a >>> 0))) || null;
  const courtOfAccount = (E, pid, except) => (E.courts || []).find((c) => c !== except && SEATS.some((s) => c.members[s.id] && Number(c.members[s.id].pid) === Number(pid))) || null;
  const complete = (c, z) => SEATS.every((s) => c.members[s.id] && c.members[s.id].accepted && !unfit(c.members[s.id].actor, z, s.id));
  const startPhase = (E, phase, hours) => { E.phase = phase; E.phaseStartedAt = Date.now(); E.phaseEndsAt = Date.now() + hours * HOUR; };
  const startElection = (z, why) => {
    const E = { phase: '', round: 1, startedAt: Date.now(), courts: [], ballot: [], votes: {} };
    startPhase(E, 'registration', EL.registrationHours);
    data().elections[z.id] = E; save();
    audit(`ELECTION ${z.name}: registration opened (${why}); closes ${dateText(E.phaseEndsAt)}`);
    for (const m of onlineActors()) if (citizenOf(m, z.id)) personal(m, `${z.name} will choose its Jarl. Candidates have until ${dateText(E.phaseEndsAt)} to enter a full court at any notice board of the hold (Voting).`);
    return E;
  };
  const cancel = (z, why, held) => {
    const E = elOf(z.id); if (!E) return;
    if (held) { E.phase = 'held'; E.phaseEndsAt = 0; } else delete data().elections[z.id];
    save();
    audit(`ELECTION ${z.name}: cancelled (${why})`);
  };
  const seatWinner = (z, E, c) => {
    const ruler = rulerOffice(z);
    const empty = [];
    for (const s of SEATS) {
      const m = c.members[s.id];
      if (!m || unfit(m.actor, z, s.id === 'jarl' ? 'jarl' : s.id)) { empty.push(s.label); continue; }
      const actor = m.actor >>> 0; const pid = Number(profileOf(actor)) >= 0 ? Number(profileOf(actor)) : Number(m.pid);
      const tg = { pid, actor, online: onlineActors().find((x) => profileOf(x) === pid) || 0, label: nameNow(actor, m.name), who: who(actor) };
      if (s.office) {
        const office = s.office === '@ruler' ? ruler : s.office;
        if (!(z.officials || []).includes(office)) { empty.push(s.label); continue; }
        for (const prev of seated(z, office)) if (prev !== pid && unseatOfficialBy) unseatOfficialBy(z, { pid: prev, actor: accountActors(prev)[0] || 0, online: onlineActors().find((x) => profileOf(x) === prev) || 0, label: `profile ${prev}`, who: `profile ${prev}` }, 'the election');
        const r = seatOfficial(z, office, tg, { who: 'the election', staff: false, via: `, elected (${s.label})` });
        if (r && r.error) { empty.push(s.label); log(`citizenship: seating ${tg.who} as ${office} of ${z.id} failed: ${r.error}`); }
      } else if (s.rank) {
        let text = '';
        try { text = typeof globalThis.__dboCourtSync === 'function' ? globalThis.__dboCourtSync(z.id, actor, [s.rank], true) : ''; } catch (e) { text = ''; }
        if (text) log(`citizenship: ${text}`);
        audit(`ELECTION ${z.name}: ${tg.who} is ${s.label} (${s.rank} of the household)`);
        tell(actor, `You are now ${s.label} of ${ofPlace(z.name)}, chosen by its people.`);
      }
    }
    return empty;
  };
  const tally = (E) => {
    const counts = {};
    for (const id of E.ballot) counts[id] = 0;
    for (const id of Object.values(E.votes || {})) if (id in counts) counts[id]++;
    return counts;
  };
  // Phase ends, run by the tick (and the harnesses)
  const advance = (z, E) => {
    const now = Date.now();
    if (E.phase === 'registration' && now >= E.phaseEndsAt) {
      // Members who lost their eligibility were not replaced in time: their courts drop
      const ok = (E.courts || []).filter((c) => complete(c, z));
      if (ok.length) {
        E.courts = ok; E.ballot = ok.map((c) => c.id); E.votes = {};
        startPhase(E, 'voting', EL.votingHours); save();
        audit(`ELECTION ${z.name}: ${ok.length} court(s) on the ballot; the vote closes ${dateText(E.phaseEndsAt)}`);
        for (const m of onlineActors()) if (citizenOf(m, z.id)) personal(m, `The vote for the Jarl of ${ofPlace(z.name)} is open until ${dateText(E.phaseEndsAt)}. Cast yours at a notice board of the hold (Voting).`);
        return true;
      }
      if (citizenAccounts(z) >= EL.threshold) {
        startPhase(E, 'registration', EL.registrationHours); E.reopened = (Number(E.reopened) || 0) + 1; save();
        audit(`ELECTION ${z.name}: no complete court; registration reopened until ${dateText(E.phaseEndsAt)}`);
        return true;
      }
      cancel(z, `no complete court, and fewer than ${EL.threshold} citizens`);
      return true;
    }
    if (E.phase === 'voting' && now >= E.phaseEndsAt) {
      // A Jarl candidate who lost eligibility strikes the court off and voids its votes
      for (const id of E.ballot) {
        const c = courtById(E, id); const j = c && c.members.jarl;
        if (c && !c.struck && (!j || unfit(j.actor, z, 'jarl'))) { c.struck = j ? unfit(j.actor, z, 'jarl') : 'no Jarl'; audit(`ELECTION ${z.name}: the court of ${j ? j.name : '?'} is struck off (${c.struck}); its votes are void`); }
      }
      E.ballot = E.ballot.filter((id) => { const c = courtById(E, id); return c && !c.struck; });
      const counts = tally(E);
      log(`citizenship: ${z.id} round ${E.round} closed: ${JSON.stringify(counts)}`);
      if (!E.ballot.length) {
        E.courts = []; E.ballot = []; E.votes = {};
        if (citizenAccounts(z) >= EL.threshold) { startPhase(E, 'registration', EL.registrationHours); save(); audit(`ELECTION ${z.name}: no court left on the ballot; registration reopened`); }
        else cancel(z, 'no court left on the ballot');
        return true;
      }
      const top = Math.max(...E.ballot.map((id) => counts[id]));
      const best = E.ballot.filter((id) => counts[id] === top);
      if (E.ballot.length === 1 && top < 1) {
        E.courts = []; E.ballot = []; E.votes = {};
        if (citizenAccounts(z) >= EL.threshold) { startPhase(E, 'registration', EL.registrationHours); save(); audit(`ELECTION ${z.name}: the one court had no vote; registration reopened`); }
        else cancel(z, 'the one court had no vote');
        return true;
      }
      if (best.length > 1) {
        E.round = (Number(E.round) || 1) + 1; E.ballot = best; E.votes = {}; E.revote = true;
        E.courts = E.courts.filter((c) => best.includes(c.id));
        startPhase(E, 'voting', EL.votingHours); save();
        audit(`ELECTION ${z.name}: a tie between ${best.length} courts; a revote between them until ${dateText(E.phaseEndsAt)}`);
        for (const m of onlineActors()) if (citizenOf(m, z.id)) personal(m, `The vote in ${ofPlace(z.name)} is tied. A new vote between the tied courts runs until ${dateText(E.phaseEndsAt)}.`);
        return true;
      }
      const winner = courtById(E, best[0]);
      const empty = seatWinner(z, E, winner);
      E.result = { winner: winner.id, counts, at: Date.now(), empty };
      E.phase = 'seated'; E.phaseEndsAt = 0; E.revote = false; save();
      const j = winner.members.jarl;
      audit(`ELECTION ${z.name}: ${j.name} is elected Jarl with a court of ${SEATS.filter((s) => s.id !== 'jarl').map((s) => `${s.label} ${winner.members[s.id] ? winner.members[s.id].name : '(empty)'}`).join(', ')}${empty.length ? `; empty: ${empty.join(', ')}` : ''}`);
      for (const m of onlineActors()) if (citizenOf(m, z.id)) personal(m, `${j.name} is elected Jarl of ${ofPlace(z.name)}.${empty.length ? ` The seats of ${empty.join(', ')} start empty; the new Jarl appoints them.` : ''}`);
      return true;
    }
    return false;
  };
  const tick = () => {
    if (!C.enabled) return;
    for (const z of holds()) {
      if (!electing(z)) continue;
      const E = elOf(z.id);
      try {
        if (!E) { if (citizenAccounts(z) >= EL.threshold) startElection(z, `${EL.threshold} citizens`); continue; }
        advance(z, E);
      } catch (e) { log(`citizenship: the election of ${z.id} failed this tick`, e.stack || e.message); }
    }
  };
  const resolve = (q, z) => {
    const s = String(q || '').trim();
    if (!s) return { error: 'Name every member of your court.' };
    if (/^\d+$/.test(s)) return { error: 'Name each member by their name or #TAG.' };
    const tg = officialTarget(s); if (tg.error) return tg;
    if (!tg.actor || !exists(tg.actor)) return { error: `${s}: no such character.` };
    return tg;
  };
  const member = (tg, accepted) => ({ actor: tg.actor >>> 0, pid: Number(tg.pid), name: nameNow(tg.actor, tg.label), accepted: !!accepted });
  const inviteText = (z, c, s) => `${c.members.jarl.name} names you ${s.label} in the court they put forward for Jarl of ${ofPlace(z.name)}. Accept or refuse at a notice board of the hold (Voting) or in your journal (F3, Citizen).`;
  const register = (a, zid, names) => {
    const z = holdOf(zid); if (!z) return { error: 'This land grants no citizenship.' };
    if (!electing(z)) return { error: `${z.name} holds no election.` };
    const E = elOf(z.id); if (!E || E.phase !== 'registration') return { error: 'Courts can be entered only while registration is open.' };
    if (courtOfActor(E, a) || courtOfAccount(E, profileOf(a))) return { error: 'You are already named in a court of this election.' };
    const why = unfit(a, z, 'jarl'); if (why) return { error: `You cannot stand for Jarl: you ${why.replace(/^is /, 'are ').replace(/^serves/, 'serve').replace(/^no longer exists/, 'no longer exist')}.` };
    const others = SEATS.filter((s) => s.id !== 'jarl');
    const tgs = {};
    const pids = new Set([Number(profileOf(a))]);
    for (let i = 0; i < others.length; i++) {
      const s = others[i]; const tg = resolve((names || [])[i], z); if (tg.error) return { error: `${s.label}: ${tg.error}` };
      if (pids.has(Number(tg.pid))) return { error: `${s.label}: every member of a court is a different player.` };
      const w = unfit(tg.actor, z, s.id); if (w) return { error: `${s.label}: ${tg.label} ${w}.` };
      if (courtOfActor(E, tg.actor) || courtOfAccount(E, tg.pid)) return { error: `${s.label}: ${tg.label} is already named in another court.` };
      pids.add(Number(tg.pid)); tgs[s.id] = tg;
    }
    const c = { id: `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), members: { jarl: member({ actor: a, pid: profileOf(a), label: nameNow(a) }, true) } };
    for (const s of others) c.members[s.id] = member(tgs[s.id], false);
    E.courts.push(c); save();
    for (const s of others) tell(c.members[s.id].actor, inviteText(z, c, s));
    audit(`ELECTION ${z.name}: ${who(a)} entered a court: ${others.map((s) => `${s.label} ${c.members[s.id].name}`).join(', ')}`);
    return { text: 'Your court is entered. It stands on the ballot once every member has accepted.' };
  };
  const myCourt = (a, z) => { const E = elOf(z.id); const c = E && courtOfActor(E, a); return c && (c.members.jarl.actor >>> 0) === (a >>> 0) ? { E, c } : null; };
  const replace = (a, zid, seatId, name) => {
    const z = holdOf(zid); if (!z) return { error: 'There is no such hold.' };
    const m = myCourt(a, z); if (!m) return { error: 'You have entered no court here.' };
    if (m.E.phase !== 'registration') return { error: 'A court can be changed only while registration is open.' };
    const s = SEATS.find((x) => x.id === String(seatId || '') && x.id !== 'jarl'); if (!s) return { error: 'There is no such seat.' };
    const tg = resolve(name, z); if (tg.error) return tg;
    const w = unfit(tg.actor, z, s.id); if (w) return { error: `${tg.label} ${w}.` };
    const others = SEATS.filter((x) => x.id !== s.id && m.c.members[x.id]);
    if (others.some((x) => Number(m.c.members[x.id].pid) === Number(tg.pid))) return { error: 'Every member of a court is a different player.' };
    const elsewhere = courtOfActor(m.E, tg.actor) || courtOfAccount(m.E, tg.pid, m.c);
    if (elsewhere && elsewhere !== m.c) return { error: `${tg.label} is already named in another court.` };
    const was = m.c.members[s.id];
    m.c.members[s.id] = member(tg, false); save();
    if (was && (was.actor >>> 0) !== (tg.actor >>> 0)) tell(was.actor, `You are no longer named ${s.label} in ${m.c.members.jarl.name}'s court.`);
    tell(tg.actor, inviteText(z, m.c, s));
    audit(`ELECTION ${z.name}: ${who(a)} named ${tg.who} ${s.label}${was ? ` in place of ${was.name}` : ''}`);
    return { text: `${tg.label} is named ${s.label}. They must accept.` };
  };
  const withdraw = (a, zid) => {
    const z = holdOf(zid); if (!z) return { error: 'There is no such hold.' };
    const m = myCourt(a, z); if (!m) return { error: 'You have entered no court here.' };
    if (m.E.phase !== 'registration') return { error: 'Once the vote is open a court stays on the ballot.' };
    m.E.courts = m.E.courts.filter((c) => c !== m.c); save();
    for (const s of SEATS) if (s.id !== 'jarl' && m.c.members[s.id]) tell(m.c.members[s.id].actor, `${m.c.members.jarl.name} has withdrawn their court from the election of ${ofPlace(z.name)}.`);
    audit(`ELECTION ${z.name}: ${who(a)} withdrew their court`);
    return { text: 'Your court is withdrawn.' };
  };
  const answerInvite = (a, zid, courtId, yes) => {
    const z = holdOf(zid); if (!z) return { error: 'There is no such hold.' };
    const E = elOf(z.id); const c = E && courtById(E, courtId);
    const s = c && SEATS.find((x) => c.members[x.id] && (c.members[x.id].actor >>> 0) === (a >>> 0) && x.id !== 'jarl');
    if (!s) return { error: 'That court no longer names you.' };
    if (E.phase !== 'registration') return { error: 'Registration has closed.' };
    if (!yes) {
      c.members[s.id] = null; save();
      tell(c.members.jarl.actor, `${nameNow(a)} refused the seat of ${s.label} in your court. Name someone else before registration closes.`);
      audit(`ELECTION ${z.name}: ${who(a)} refused ${s.label} in ${c.members.jarl.name}'s court`);
      return { text: 'You refused the seat.' };
    }
    const w = unfit(a, z, s.id); if (w) return { error: `You cannot take the seat: you ${w.replace(/^is /, 'are ').replace(/^serves/, 'serve')}.` };
    c.members[s.id].accepted = true; save();
    tell(c.members.jarl.actor, `${nameNow(a)} accepted the seat of ${s.label} in your court.${complete(c, z) ? ' Your court is complete and will stand on the ballot.' : ''}`);
    audit(`ELECTION ${z.name}: ${who(a)} accepted ${s.label} in ${c.members.jarl.name}'s court`);
    return { text: `You accepted the seat of ${s.label}.` };
  };
  const vote = (a, zid, courtId) => {
    const z = holdOf(zid); if (!z) return { error: 'There is no such hold.' };
    const E = elOf(z.id); if (!E || E.phase !== 'voting') return { error: 'No vote is open here.' };
    const why = canVote(a, z); if (why) return { error: why };
    const pid = String(Number(profileOf(a)));
    if (E.votes[pid] !== undefined) return { error: 'Your vote is cast. One vote per player.' };
    if (!E.ballot.includes(String(courtId || ''))) return { error: 'That court is not on the ballot.' };
    E.votes[pid] = String(courtId); save();
    // The ballot is secret: the audit says that a vote was cast, never for whom
    audit(`ELECTION ${z.name}: ${who(a)} voted (round ${E.round})`);
    return { text: 'Your vote is cast. The result is known when the vote closes.' };
  };
  const staffAct = (a, zid, what) => {
    if (!isLeadStaff(a)) return { error: 'Only a Lead GM or above changes an election.' };
    const z = holdOf(zid); if (!z || !electing(z)) return { error: 'That hold holds no election.' };
    const E = elOf(z.id);
    if (what === 'cancel') { if (!E || E.phase === 'held') return { error: 'There is no election running there.' }; cancel(z, `by ${who(a)}`, true); return { text: `The election of ${ofPlace(z.name)} is held until staff restart it.` }; }
    if (what === 'restart') { delete data().elections[z.id]; save(); startElection(z, `restarted by ${who(a)}`); return { text: `The election of ${ofPlace(z.name)} starts again: registration is open for ${EL.registrationHours} hours.` }; }
    if (what === 'resume') { if (!E || E.phase !== 'held') return { error: 'That election is not held.' }; delete data().elections[z.id]; save(); return { text: `The hold is back on its own clock: an election starts when it has ${EL.threshold} citizens.` }; }
    return { error: 'That cannot be done.' };
  };

  // ---- views -------------------------------------------------------------------------------------------------------------
  const holdLine = (h) => { const z = holdOf(h.zone); return { zone: h.zone, name: z ? z.name : h.zone, since: Number(h.since) || 0, how: String(h.how || ''), auto: !!h.auto }; };
  const memberView = (z, m, seat, E) => (m ? { seat: seat.id, label: seat.label, name: m.name, tag: tagSafe(m.actor), accepted: !!m.accepted,
    fit: !unfit(m.actor, z, seat.id), why: E && E.phase === 'registration' ? unfit(m.actor, z, seat.id) : '' } : { seat: seat.id, label: seat.label, name: '', tag: '', accepted: false, fit: false, why: 'empty' });
  const courtView = (z, E, c, a) => ({ id: c.id, jarl: c.members.jarl ? c.members.jarl.name : '', members: SEATS.map((s) => memberView(z, c.members[s.id], s, E)),
    complete: complete(c, z), struck: c.struck || '', mine: !!c.members.jarl && (c.members.jarl.actor >>> 0) === (a >>> 0) });
  const votingView = (a, z) => {
    const v = { hold: z.id, name: z.name, electing: electing(z), threshold: EL.threshold, registrationHours: EL.registrationHours, votingHours: EL.votingHours, seats: SEATS.map((s) => ({ id: s.id, label: s.label })) };
    if (!v.electing) {
      v.why = (C.noElection || []).includes(z.id)
        ? `${z.name} is a county of the Empire. Its ${rulerWord(z)} holds the seat by the Emperor's charter and the Elder Council's leave, and no vote of its citizens makes or unmakes one. Elections choose the Jarls of Skyrim's holds.`
        : `${z.name} holds no election.`;
      return v;
    }
    const E = elOf(z.id);
    v.citizens = citizenAccounts(z);
    v.phase = E ? E.phase : 'none';
    v.round = E ? Number(E.round) || 1 : 0;
    v.endsAt = E ? Number(E.phaseEndsAt) || 0 : 0;
    v.revote = !!(E && E.revote);
    v.voteWhy = canVote(a, z);
    v.staff = isLeadStaff(a);
    if (!E) return v;
    const pid = String(Number(profileOf(a)));
    if (E.phase === 'registration') {
      v.courts = E.courts.map((c) => courtView(z, E, c, a));
      const mine = courtOfActor(E, a);
      v.inCourt = !!mine;
      v.standWhy = mine ? '' : unfit(a, z, 'jarl');
      v.invites = E.courts.filter((c) => SEATS.some((s) => s.id !== 'jarl' && c.members[s.id] && (c.members[s.id].actor >>> 0) === (a >>> 0) && !c.members[s.id].accepted))
        .map((c) => { const s = SEATS.find((x) => x.id !== 'jarl' && c.members[x.id] && (c.members[x.id].actor >>> 0) === (a >>> 0)); return { court: c.id, jarl: c.members.jarl.name, seat: s.label }; });
    }
    // No count anywhere until the vote has a winner
    if (E.phase === 'voting') { v.ballot = E.ballot.map((id) => courtView(z, E, courtById(E, id), a)); v.voted = E.votes[pid] !== undefined; }
    if (E.phase === 'seated' && E.result) {
      const w = courtById(E, E.result.winner);
      v.result = { winner: w ? courtView(z, E, w, a) : null, empty: E.result.empty || [], at: E.result.at,
        counts: E.courts.filter((c) => c.id in (E.result.counts || {})).map((c) => ({ jarl: c.members.jarl.name, votes: E.result.counts[c.id] })) };
    }
    return v;
  };
  const citizenshipView = (a, z) => {
    const p = policyOf(z); const mine = holdsOf(a); const chk = joinCheck(a, z); const req = requestOf(a, z.id);
    const ruler = hasRuler(z);
    const v = { hold: z.id, name: z.name, ruler: rulerWord(z), hasRuler: ruler, policy: ruler ? p.policy : 'free', fee: ruler && p.policy === 'paid' && hasTreasury(z) ? p.fee : 0,
      citizen: citizenOf(a, z.id), primary: !!mine[0] && mine[0].zone === z.id, auto: mine.some((h) => h.zone === z.id && h.auto), holds: mine.map(holdLine),
      maxHolds: C.maxHolds, cooldownUntil: cooldownLeft(a) ? Date.now() + cooldownLeft(a) : 0, requested: !!req,
      can: chk.error ? '' : chk.how, why: chk.error || '' };
    if (manages(a, z)) v.manage = { policy: p.policy, fee: p.fee, treasury: hasTreasury(z), maxFee: C.maxFee,
      requests: liveRequests().filter((r) => r.zone === z.id).map((r) => ({ actor: hex(r.actor), name: r.name, tag: tagSafe(r.actor), at: r.at })) };
    return v;
  };
  const boardPayload = (a, zid, nonce, tab, text, kind) => {
    const z = holdOf(zid) || zoneById(zid);
    const w = { type: 'citizenBoard', id: PANEL_ID, nonce, tab: tab === 'voting' ? 'voting' : 'citizenship', result: text || '', resultKind: kind || '' };
    if (!z || !grants(z)) return Object.assign(w, { hold: zid, name: z ? z.name : '', grants: false, why: 'This land grants no citizenship: its people answer to their clan or to no one.' });
    return Object.assign(w, { hold: z.id, name: z.name, grants: true, citizenship: citizenshipView(a, z), voting: votingView(a, z) });
  };

  // ---- the board panel --------------------------------------------------------------------------------------------------
  const sendBoard = (a, text, kind) => {
    const p = S.panels.get(a >>> 0); if (!p) return;
    p.nonce = `${(a >>> 0).toString(36)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    openWidget(a, boardPayload(a, p.zone, p.nonce, p.tab, text, kind), true);
  };
  onUi('citizenOpen', (a, args) => {
    if (!C.enabled) return;
    const zone = boardZoneNear(a);
    if (!zone) return personal(a, 'Use a notice board of the hold.');
    S.panels.set(a >>> 0, { zone: String(zone), tab: String((args || [])[0]) === 'voting' ? 'voting' : 'citizenship', nonce: '' });
    sendBoard(a);
  });
  const ACT = {
    join: (a, z) => join(a, z),
    renounce: (a, z, x) => renounce(a, x || z),
    primary: (a, z, x) => makePrimary(a, x || z),
    policy: (a, z, x, y) => setPolicy(a, z, x, y),
    grant: (a, z, x) => grant(a, z, unhex(x)),
    decline: (a, z, x) => decline(a, z, unhex(x)),
    register: (a, z, x, y, w) => register(a, z, [x, y, w]),
    replace: (a, z, x, y) => replace(a, z, x, y),
    withdraw: (a, z) => withdraw(a, z),
    accept: (a, z, x) => answerInvite(a, z, x, true),
    refuse: (a, z, x) => answerInvite(a, z, x, false),
    vote: (a, z, x) => vote(a, z, x),
    staff: (a, z, x) => staffAct(a, z, String(x || '')),
    revoke: (a, z, x) => revoke(a, z, unhex((String(x || '')))),
  };
  const run = (a, zone, args) => {
    const name = String(args[0] || '');
    if (!Object.prototype.hasOwnProperty.call(ACT, name)) return { error: 'That cannot be done.' };
    try { return ACT[name](a >>> 0, zone, ...args.slice(1, 4).map((x) => String(x == null ? '' : x).slice(0, 64))) || {}; }
    catch (e) { log('citizenship: action failed', e.stack || e.message); return { error: 'That cannot be done just now.' }; }
  };
  onUi('citizenAct', (a, args) => {
    const p = S.panels.get(a >>> 0);
    if (!p || !p.nonce || String((args || [])[0] || '') !== p.nonce) return;
    if (boardZoneNear(a) !== p.zone) { S.panels.delete(a >>> 0); closeWidget(a, PANEL_ID); return personal(a, 'You have walked away from the notice board.'); }
    if (String(args[1]) === 'tab') { p.tab = String(args[2]) === 'voting' ? 'voting' : 'citizenship'; return sendBoard(a); }
    const r = run(a, p.zone, args.slice(1));
    sendBoard(a, r.error || r.text || '', r.error ? 'refused' : 'ok');
  });
  onUi('citizenClose', (a) => { S.panels.delete(a >>> 0); closeWidget(a, PANEL_ID); });
  // Back to the board's notices (fork bountyBoardSystem.ts __alduinakBountyOpen: the nearest board, reach checked there)
  onUi('citizenBack', (a) => {
    S.panels.delete(a >>> 0); closeWidget(a, PANEL_ID);
    try { if (typeof globalThis.__alduinakBountyOpen === 'function') globalThis.__alduinakBountyOpen(a >>> 0); } catch (e) { log('citizenship: reopening the board failed', e.message); }
  });
  onUi('close', (a, args, widgetId) => { if (Number(widgetId) === PANEL_ID) S.panels.delete(a >>> 0); });

  // ---- the F3 Citizen tab --------------------------------------------------------------------------------------------------
  const journalView = (a) => {
    const mine = holdsOf(a).map(holdLine);
    const v = { holds: mine, maxHolds: C.maxHolds, cooldownUntil: cooldownLeft(a) ? Date.now() + cooldownLeft(a) : 0,
      requests: liveRequests().filter((r) => (r.actor >>> 0) === (a >>> 0)).map((r) => { const z = holdOf(r.zone); return { zone: r.zone, name: z ? z.name : r.zone, at: r.at }; }),
      invites: [], elections: [], manage: [], staff: isLeadStaff(a) ? [] : null };
    for (const z of holds()) {
      const E = elOf(z.id);
      if (E && E.phase === 'registration') {
        for (const c of E.courts) for (const s of SEATS) {
          const m = c.members[s.id];
          if (s.id !== 'jarl' && m && (m.actor >>> 0) === (a >>> 0) && !m.accepted) v.invites.push({ zone: z.id, name: z.name, court: c.id, jarl: c.members.jarl.name, seat: s.label });
        }
      }
      if (E && electing(z) && (citizenOf(a, z.id) || courtOfActor(E, a))) v.elections.push({ zone: z.id, name: z.name, phase: E.phase, endsAt: Number(E.phaseEndsAt) || 0, revote: !!E.revote,
        voted: E.phase === 'voting' && E.votes[String(Number(profileOf(a)))] !== undefined, mine: !!courtOfActor(E, a) });
      if (!isAdmin(a) && (rules(a, z) || isSteward(a, z))) v.manage.push({ zone: z.id, name: z.name, policy: policyOf(z).policy, fee: policyOf(z).fee,
        requests: liveRequests().filter((r) => r.zone === z.id).map((r) => ({ actor: hex(r.actor), name: r.name, tag: tagSafe(r.actor), at: r.at })) });
      if (v.staff && electing(z)) v.staff.push({ zone: z.id, name: z.name, phase: E ? E.phase : 'none', endsAt: E ? Number(E.phaseEndsAt) || 0 : 0, citizens: citizenAccounts(z), threshold: EL.threshold });
    }
    return v;
  };
  const sections = globalThis.__dboJournalSections || (globalThis.__dboJournalSections = {});
  if (C.enabled) sections.citizen = {
    visible: (a) => { const v = journalView(a); const n = v.invites.length + v.manage.reduce((k, m) => k + m.requests.length, 0); return n ? { badge: n } : true; },
    view: (a) => journalView(a), label: () => 'Citizen',
  };
  else delete sections.citizen;
  const fresh = (a, args) => typeof globalThis.__dboJournalFresh === 'function' && !!globalThis.__dboJournalFresh(a, String((args || [])[0] || ''));
  onUi('citizenJ', (a, args) => {
    if (!C.enabled || !fresh(a, args)) return;
    const act = () => { const r = run(a, String(args[2] || ''), [args[1]].concat(args.slice(3))); return { tab: 'citizen', text: r.error || r.text || '', kind: r.error ? 'refused' : 'ok' }; };
    if (typeof globalThis.__dboJournalLimited === 'function') globalThis.__dboJournalLimited(a, act);
  });

  // ---- the X menu: the ruler or Steward answers a request face to face ------------------------------------------------------
  globalThis.__dboCitizenMenuEntries = (a, t) => {
    if (!C.enabled) return [];
    const out = [];
    for (const r of liveRequests()) {
      if ((r.actor >>> 0) !== (t >>> 0)) continue;
      const z = holdOf(r.zone); if (!z || !(rules(a, z) || isSteward(a, z) || isAdmin(a))) continue;
      out.push({ id: `citizen:grant:${z.id}`, label: `Grant citizenship of ${z.name}` }, { id: `citizen:decline:${z.id}`, label: `Decline citizenship of ${z.name}` });
    }
    return out;
  };
  globalThis.__dboCitizenMenuAction = (a, id, t) => {
    const m = String(id || '').match(/^citizen:(grant|decline):([a-z-]+)$/); if (!m) return false;
    const r = m[1] === 'grant' ? grant(a, m[2], t >>> 0) : decline(a, m[2], t >>> 0);
    personal(a, r.error || r.text);
    return true;
  };

  // ---- other modules ask these ----------------------------------------------------------------------------------------------
  // tenancy.js: whether a character may buy property in a hold. A zone that grants no citizenship asks none.
  globalThis.__dboCitizenOf = (a, zid) => (C.enabled ? citizenOf(Number(a) >>> 0, String(zid || '')) : true);
  globalThis.__dboCitizenGates = (zid) => !!C.enabled && !!holdOf(zid);
  globalThis.__dboCitizenHolds = (a) => (C.enabled ? holdsOf(Number(a) >>> 0).map((h) => h.zone) : []);
  // discordroles.js: the citizen roles this character should wear, and every role this module manages
  const roleIds = () => Object.fromEntries(Object.entries(C.discordRoles || {}).filter(([, id]) => /^\d{15,22}$/.test(String(id))));
  globalThis.__dboCitizenRoleIds = (a) => { const ids = roleIds(); return C.enabled ? holdsOf(Number(a) >>> 0).map((h) => ids[h.zone]).filter(Boolean) : []; };
  globalThis.__dboCitizenManagedRoleIds = () => Object.values(roleIds());

  if (typeof every === 'function') every('citizenship', 60000, tick);
  log(`citizenship ${C.enabled ? 'on' : 'off'}: ${holds().length} holds grant it, ${Object.keys(data().chars).length} characters on the rolls, ${Object.keys(data().elections).length} election(s)`);
  return { join, grant, decline, renounce, makePrimary, revoke, setPolicy, register, replace, withdraw, answerInvite, vote, staffAct, tick, advance,
    holdsOf, citizenOf, factionFree, citizenAccounts, boardPayload, journalView, votingView, citizenshipView, data, PANEL_ID };
};
