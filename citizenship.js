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
// Who may vote, and who counts toward the threshold (Nate, 16 Oct: no Discord alts voting; config election.voterRules): a
// Discord account at least discordAgeDays (90) old, playHours (10) of play on playDays (3) different days (playtime.js),
// and a character that was a citizen there citizenDays (7), each judged when the vote opens (during registration, against
// the time it is due to open). An election started before the rules existed (no E.rules stamp) finishes under the old rules.
// One vote per PC (oneVotePerDevice, the launcher's PC code) is OFF by owner decision (Jake, 16 Oct) until the Privacy
// Policy names this use and players have re-accepted it; turning it on needs Jake. A Lead GM strikes a vote with a reason
// (/strikevote) and undoes it (/unstrikevote); /electionreview lists the struck votes. No address is read or kept.
// Those standing in a court on the ballot (Jarl candidate, Steward, Lord Commander, Housecarl, and their accounts' other
// characters) do not vote (Nate, 14 Oct: "cabinets cant vote"). Each phase is announced (Nate, 14 Oct): registration open,
// reopened, voting open, revote and the result go to the hold's online citizens, to each citizen character once at login
// during the phase (gamemode.js calls __dboCitizenLogin), and to Discord (election.announceChannel, #server-updates) pinging
// only the hold's Citizen role (discordRoles) through discordroles.js's bot (__dboDiscordPost); no channel or role: no post.
//
// State in citizenship.json (runtime, gitignored):
//   { chars: { <actor hex>: { pid, name, holds: [{ zone, since, how }], cooldownUntil, renounced: [{ zone, at }] } },
//     requests: [{ zone, actor, pid, name, at }], policies: { zone: { policy, fee, by, at } },
//     staffApplied: [{ id, pid, by, why, at, removed: [{ actor, name, zone, since, how }], requests: [...], kept: [...] }],
//     elections: { zone: { phase, round, startedAt, phaseStartedAt, phaseEndsAt, courts: [court], ballot: [id], votes: { pid: id },
//                          result?: { winner, counts, at }, held?, notice?: { key, kind, text, at, until }, noticed?: { <actor hex>: key } } } }
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
// Staff releases (Jake, 16 Oct): config staffReleases, a staff revoke written in config and applied once at load; see the
// section after revoke().
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
  // A staff member as others may see them (Name #TAG), never with a Discord id (who() adds one)
  const display = typeof api.display === 'function' ? api.display : (a) => `${nameOf(a)} #${tagOf(a)}`;
  const takeGold = typeof api.takeGold === 'function' ? api.takeGold : () => false;
  const depositToTreasury = typeof api.depositToTreasury === 'function' ? api.depositToTreasury : () => 0;
  const openWidget = api.openWidget || (() => false), closeWidget = api.closeWidget || (() => false);
  const boardZoneNear = typeof api.boardZoneNear === 'function' ? api.boardZoneNear : () => null;
  const raceEdidOf = typeof api.raceEdidOf === 'function' ? api.raceEdidOf : () => '';
  const unseatOfficialBy = typeof api.unseatOfficialBy === 'function' ? api.unseatOfficialBy : null;
  const discordOf = typeof api.discordOf === 'function' ? api.discordOf : () => '';
  const registerChatCommand = typeof api.registerChatCommand === 'function' ? api.registerChatCommand : null;

  // announceChannel: the Discord channel of the election notices (#server-updates); resultLoginDays: how long a citizen logging
  // in is still told the result
  const E0 = { threshold: 15, registrationHours: 24, votingHours: 24, unopposedWins: true, jarlRaces: ['BretonRace', 'NordRace', 'ImperialRace'], noFactionVoters: true,
    announceChannel: '1555017562700390602', resultLoginDays: 7,
    // The ballot's four seats and where the winner sits: an office of zones.json ('@ruler' = the hold's first office) or a
    // rank of the hold's household (guild-defs.json)
    seats: [{ id: 'jarl', label: 'Jarl', office: '@ruler' }, { id: 'steward', label: 'Steward', office: 'steward' },
      { id: 'commander', label: 'Lord Commander', office: 'commander' }, { id: 'housecarl', label: 'Housecarl', rank: 'Housecarl' }] };
  const C = Object.assign({ enabled: true, rulerOffices: ['jarl', 'count'], stewardOffices: ['steward'], maxHolds: 2, cooldownDays: 7, maxFee: 100000,
    defaultPolicy: 'free', requestDays: 14, auto: ['bruma'], noElection: ['bruma'], discordRoles: {} }, (cfg && cfg.citizenship) || {});
  C.election = Object.assign({}, E0, C.election || {});
  // Who may vote, and who counts toward the threshold (Nate, 16 Oct: "make sure people can't make multiple Discord accounts
  // just to vote"). Judged when the vote opens; during registration, against the time it is due to open; with no election,
  // now. discordAgeDays: the Discord account's age (from its id); playHours on playDays different days (playtime.js,
  // server-measured); citizenDays: the voting character's citizenship of the hold; oneVotePerDevice: accounts the backend's
  // device store (deviceFile, launcher PC codes) links share one vote. That one is OFF by owner decision (Jake, 16 Oct) until
  // the Privacy Policy names this use and players have re-accepted it; turning it on needs Jake, and only a strict true does
  // citizenDaysFirstElection: the citizenship a hold's FIRST election asks for (Nate, 17 Oct: "waive the 7 day rule for
  // every first election"). Every hold's first vote waives it; every election after that hold's first asks for
  // citizenDays again, so it expires hold by hold with nothing to switch back.
  // It has to be waived for a hold with NO election yet as well, not only one already running: the hold's citizen count
  // and the 15 it needs to begin are ELIGIBLE voters (citizenAccounts -> eligiblePids), judged with no election in hand.
  // Waiving only once an election existed would have left every hold at nought and unable to start one, which is what
  // Whiterun and Solitude reported ("our citizen number count has been reset to 0 even though we had at least 11"):
  // 13 each on the roll, none a citizen for seven days, so nought eligible. Nothing had been reset.
  const VR0 = { enabled: true, discordAgeDays: 90, playHours: 10, playDays: 3, citizenDays: 7, citizenDaysFirstElection: 0, oneVotePerDevice: false,
    playersFile: '/opt/alduinak/skymp5-backend/data/players.json', deviceFile: '/opt/alduinak/skymp5-backend/data/device-ids.json', cacheMinutes: 10 };
  C.election.voterRules = Object.assign({}, VR0, C.election.voterRules || {});
  const PANEL_ID = 84;
  const FILE = path.resolve('citizenship.json');
  const DAY = 86400000, HOUR = 3600000;
  const POLICIES = ['manual', 'paid', 'free'];
  const SEATS = C.election.seats;

  // ---- state ---------------------------------------------------------------------------------------------------------
  const S = globalThis.__dboCitizen || (globalThis.__dboCitizen = { data: null });
  if (!(S.panels instanceof Map)) S.panels = new Map(); // actor -> { zone, nonce, tab }
  const fill = (d) => {
    for (const k of ['chars', 'policies', 'elections', 'voterHold', 'elected']) if (!d[k] || typeof d[k] !== 'object' || Array.isArray(d[k])) d[k] = {};
    if (!Array.isArray(d.requests)) d.requests = [];
    if (!Array.isArray(d.staffApplied)) d.staffApplied = [];
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
  // Who runs the hold's citizenship: the ruler, a Steward, or a Lead GM and above (Nate, 15 Oct: any GM could grant,
  // decline and set the policy and fee). A GM or Trial GM who holds the ruler's or Steward's office keeps that office's rights
  const manages = (a, z) => isLeadStaff(a) || rules(a, z) || isSteward(a, z);
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
  // Why an auto hold counts this character: the factions based there and the offices held, for staff
  const autoWhy = (a, z) => {
    const out = guildsOf(a).filter((g) => factionZone(g) === z.id).map((g) => String(g.name || g.id));
    const pid = Number(profileOf(a));
    if (pid >= 0) for (const o of z.officials || []) if (seated(z, o).includes(pid)) out.push(`its ${o} seat`);
    return out.join(', ');
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
      for (const m of onlineActors()) if (m !== (a >>> 0) && !isLeadStaff(m) && (rules(m, z) || isSteward(m, z))) personal(m, `${nameNow(a)} asks to become a citizen of ${ofPlace(z.name)}. Grant or decline it at a notice board (Citizenship) or in your journal (F3, Citizen).`);
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
    if (z && autoHolds(actor).includes(z.id) && !explicit(actor).some((h) => h.zone === z.id)) {
      return { error: `${nameNow(actor, e ? e.name : '')} is a citizen of ${ofPlace(z.name)} through ${autoWhy(actor, z) || 'a faction or court based there'}. It ends when they leave it.` };
    }
    if (!z || !e || !explicit(actor).some((h) => h.zone === z.id)) return { error: 'That character holds no such citizenship.' };
    e.holds = e.holds.filter((h) => h.zone !== z.id); save();
    audit(`CITIZEN STAFF ${who(by)} revoked the citizenship of ${z.name} from ${e.name} (character ${hex(actor)})`);
    tell(actor, `Your citizenship of ${ofPlace(z.name)} was revoked by the staff.`);
    return { text: `${e.name} is no longer a citizen of ${ofPlace(z.name)}.` };
  };
  // ---- staff releases (Jake, 16 Oct 2026): a staff revoke written in config, for when no Lead GM is in game ----------------
  // citizenship.staffReleases = [{ id, pid, actors?: [hex], zones?: [zone], by, why }]. At load, and so at every hot reload
  // of the config, each entry whose id is not yet in data().staffApplied takes from every character of profile pid (or only
  // the listed ones) every citizenship it holds on the rolls (or only those of the listed holds), as revoke() does: no
  // cooldown is started or changed. The profile's pending requests (to those holds) are withdrawn. One audit line per
  // removal, and the character is told if online. The id is then kept with what was removed, so the entry never applies
  // again: another load, a hot reload, or the player joining again later changes nothing (a new release needs a new id), and
  // a removed hold can be put back by hand from that record. A citizenship through a faction or court based in the hold
  // (auto) is no entry on the rolls and lasts while the membership does: the audit names it, nothing removes it. A bad entry
  // (no id, no pid, an unknown hold, a character not of that profile) is skipped with a log line and stays unapplied.
  // Audit lines carry character names, hexes and the entry's by/why with any Discord mention or id taken out.
  const clean = (s, n) => String(s == null ? '' : s).replace(/<[@#][!&]?\d+>/g, '').replace(/\d{15,22}/g, '').replace(/\s+/g, ' ').trim().slice(0, n || 80);
  const andList = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');
  const holdName = (zid) => { const z = holdOf(zid) || zoneById(zid); return z ? ofPlace(z.name) : String(zid); };
  // A profile id as saved on the rolls or a request, matched as a number only: a pid saved while the profile was unknown
  // (NaN, which JSON keeps as null) or an empty one is no profile 0
  const samePid = (v, pid) => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) && Number(v) === pid;
  // The characters of a profile: those on the rolls under it, and those the server knows for it
  const charsOfProfile = (pid) => {
    const out = new Set();
    for (const [k, e] of Object.entries(data().chars)) if (e && samePid(e.pid, pid)) out.add(k);
    try { for (const a of (typeof accountActors === 'function' ? accountActors(pid) : null) || []) out.add(hex(a)); } catch (e) { /* the rolls alone */ }
    return out;
  };
  const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
  const releaseCheck = (x) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return { error: 'not an object' };
    const id = typeof x.id === 'string' ? x.id.trim() : '';
    if (!RELEASE_ID.test(id)) return { error: id ? 'a bad id (letters, digits and . _ : - only, at most 64)' : 'no id' };
    const pid = typeof x.pid === 'number' || (typeof x.pid === 'string' && /^\d+$/.test(x.pid)) ? Number(x.pid) : NaN;
    if (!Number.isInteger(pid) || pid < 0) return { id, error: 'no profile id (pid)' };
    let zones = null;
    if (x.zones !== undefined) {
      if (!Array.isArray(x.zones) || !x.zones.length) return { id, error: 'zones is given but is no list of holds' };
      zones = new Set();
      for (const z of x.zones) { if (!holdOf(z)) return { id, error: `unknown hold ${clean(z, 32) || '(empty)'}: not a land that grants citizenship` }; zones.add(String(z)); }
    }
    let actors = null;
    if (x.actors !== undefined) {
      if (!Array.isArray(x.actors) || !x.actors.length) return { id, error: 'actors is given but is no list of characters' };
      const mine = charsOfProfile(pid);
      actors = new Set();
      for (const s of x.actors) {
        const t = String(s == null ? '' : s).trim().toLowerCase().replace(/^0x/, '');
        if (!/^[0-9a-f]{1,8}$/.test(t)) return { id, error: `a bad character ${clean(s, 16) || '(empty)'}: a form id in hex` };
        const k = hex(unhex(t));
        if (!mine.has(k)) return { id, error: `character ${k} is not one of profile ${pid}'s` };
        actors.add(k);
      }
    }
    return { id, pid, zones, actors, by: clean(x.by, 80) || 'staff', why: clean(x.why, 120) };
  };
  // Changes the rolls for one checked entry and returns its record; the audit and the players are told after. Everything is
  // worked out first and the rolls change only at the end, so a failure part way leaves them as they were
  const releaseApply = (r) => {
    const d = data();
    const inZone = (zid) => !r.zones || r.zones.has(zid);
    const targets = [...(r.actors || charsOfProfile(r.pid))].sort();
    const removed = [], kept = [], requests = [], cut = [];
    for (const k of targets) {
      const a = unhex(k); const e = d.chars[k];
      const take = e && Array.isArray(e.holds) ? explicit(a).filter((h) => inZone(h.zone)) : [];
      if (take.length) cut.push([e, new Set(take.map((h) => h.zone))]);
      for (const h of take) removed.push({ actor: k, name: clean(e.name, 64), zone: h.zone, since: Number(h.since) || 0, how: String(h.how || '') });
      let auto = []; try { auto = autoHolds(a).filter(inZone); } catch (err) { auto = []; }
      for (const zid of auto) kept.push({ actor: k, name: clean(e ? e.name : nameNow(a, ''), 64), zone: zid });
    }
    const keys = new Set(targets);
    const hit = (q) => !!q && inZone(q.zone) && (keys.has(hex(q.actor)) || (!r.actors && samePid(q.pid, r.pid)));
    for (const q of d.requests) if (hit(q)) requests.push({ actor: hex(q.actor), name: clean(q.name, 64), zone: q.zone, at: Number(q.at) || 0 });
    const rec = { id: r.id, pid: r.pid, by: r.by, why: r.why, at: Date.now(), removed, requests, kept };
    for (const [e, zs] of cut) e.holds = e.holds.filter((h) => !zs.has(h.zone));
    d.requests = d.requests.filter((q) => !hit(q));
    d.staffApplied.push(rec);
    return rec;
  };
  const releaseTell = (rec) => {
    const tag = `staff release ${rec.id}${rec.why ? `: ${rec.why}` : ''}`;
    // Each audit( takes its template literally, so tests/playerlog-audit-harness.js reads and pins every site (playerlog-rules.js
    // AUDIT_SITES); a variable there is a site nobody reviewed
    const say = (f) => { try { f(); } catch (e) { log('citizenship: audit failed', e.message); } };
    for (const x of rec.removed) say(() => audit(`CITIZEN STAFF ${rec.by} released ${x.name || 'a character'} from the citizenship of ${holdName(x.zone)} (character ${x.actor}; ${tag})`));
    for (const x of rec.requests) say(() => audit(`CITIZEN STAFF ${rec.by} withdrew ${x.name || 'a character'}'s request for the citizenship of ${holdName(x.zone)} (character ${x.actor}; ${tag})`));
    for (const x of rec.kept) say(() => audit(`CITIZEN STAFF ${rec.by} could not release ${x.name || 'a character'} from the citizenship of ${holdName(x.zone)} (character ${x.actor}): it comes from a faction or court based there and lasts while that membership does (${tag})`));
    if (!rec.removed.length && !rec.requests.length && !rec.kept.length) say(() => audit(`CITIZEN STAFF ${rec.by}: ${tag} found no citizenship of profile ${rec.pid} to release`));
    const told = new Map();
    const slot = (k) => told.get(k) || told.set(k, { gone: [], asked: [], kept: [] }).get(k);
    for (const x of rec.removed) slot(x.actor).gone.push(holdName(x.zone));
    for (const x of rec.requests) slot(x.actor).asked.push(holdName(x.zone));
    for (const x of rec.kept) if (told.has(x.actor)) slot(x.actor).kept.push(holdName(x.zone));
    for (const [k, t] of told) {
      const text = [t.gone.length ? `The staff have released you from the citizenship of ${andList(t.gone)}.` : '',
        t.asked.length ? `Your request for the citizenship of ${andList(t.asked)} was withdrawn by the staff.` : '',
        t.kept.length ? `You remain a citizen of ${andList(t.kept)} through a faction or court based there.` : ''].filter(Boolean).join(' ');
      try { tell(unhex(k), text); } catch (e) { log('citizenship: telling a released character failed', e.message); }
    }
  };
  // Applies every new entry of the config, saves once. Never throws: a load must not fail over a staff entry
  const staffReleases = () => {
    const out = { applied: [], before: 0, skipped: [] };
    const list = C.staffReleases;
    if (list === undefined || list === null) return out;
    if (!Array.isArray(list)) { log('citizenship: config staffReleases is not a list; nothing released'); return out; }
    // An unreadable citizenship.json leaves the rolls empty in memory (data()), and the save of a release would then write
    // that empty roll over the file at once. A release waits for a load that reads the file
    try { if (fs.existsSync(FILE)) JSON.parse(fs.readFileSync(FILE, 'utf8')); }
    catch (e) { log('citizenship: citizenship.json could not be read; staff releases wait for the next load'); return out; }
    const d = data();
    const done = new Set(d.staffApplied.map((x) => String((x && x.id) || '')));
    list.forEach((x, i) => {
      try {
        const id = x && typeof x.id === 'string' ? x.id.trim() : '';
        if (id && done.has(id)) { out.before++; return; }
        const r = releaseCheck(x);
        if (r.error) { out.skipped.push({ at: i, id: r.id || '', error: r.error }); log(`citizenship: staff release ${r.id ? `${r.id} ` : ''}(entry ${i + 1}) skipped: ${r.error}`); return; }
        const rec = releaseApply(r); done.add(r.id); out.applied.push(rec);
      } catch (e) { out.skipped.push({ at: i, id: '', error: e.message }); log(`citizenship: staff release (entry ${i + 1}) failed`, e.stack || e.message); }
    });
    if (out.applied.length) save();
    for (const rec of out.applied) { try { releaseTell(rec); } catch (e) { log('citizenship: staff release notices failed', e.stack || e.message); } }
    if (out.applied.length || out.skipped.length) {
      log(`citizenship: staff releases: ${out.applied.length} applied now (${out.applied.map((x) => `${x.id}: ${x.removed.length} released, ${x.requests.length} request(s) withdrawn, ${x.kept.length} faction or court citizenship(s) kept`).join('; ') || 'none'}), ${out.before} applied before, ${out.skipped.length} skipped`);
    }
    return out;
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
  // The accounts with a citizen character in z: pid -> [{ actor, since }] (explicit entries; the auto holds' faction members
  // and officials with since 0, as their citizenship has no date)
  const citizenPids = (z) => {
    const pids = new Map();
    const put = (pid, actor, since) => { if (!(pid >= 0)) return; if (!pids.has(pid)) pids.set(pid, []); pids.get(pid).push({ actor: actor >>> 0, since: Number(since) || 0 }); };
    for (const [k, e] of Object.entries(data().chars)) {
      const h = e && Array.isArray(e.holds) ? e.holds.find((x) => x.zone === z.id) : null;
      if (!h) continue;
      if (!exists(unhex(k))) continue;
      const pid = Number(profileOf(unhex(k))); put(pid >= 0 ? pid : Number(e.pid), unhex(k), h.since);
    }
    if ((C.auto || []).includes(z.id)) {
      for (const o of z.officials || []) for (const pid of seated(z, o)) if (!pids.has(pid)) put(pid, accountActors(pid)[0] || 0, 0);
      try {
        for (const fid of (typeof globalThis.__dboFactionList === 'function' ? globalThis.__dboFactionList() : []).concat(courtFaction(z.id) || [])) {
          const info = typeof globalThis.__dboGuildInfo === 'function' ? globalThis.__dboGuildInfo(fid) : null;
          if (!info || String(info.zone || (info.hall && info.hall.zone) || '') !== z.id) continue;
          for (const m of (typeof globalThis.__dboGuildMembers === 'function' ? globalThis.__dboGuildMembers(fid) : [])) { const p = Number(profileOf(m)); if (p >= 0 && !pids.has(p)) put(p, m, 0); }
        }
      } catch (e) { /* no guilds */ }
    }
    return pids;
  };

  // A hold that has seated a court by election: data().elected (written when a court is seated, kept apart from the
  // record, which staff restart and resume delete), or a record that still carries its result
  const electedOnce = (zid) => !!data().elected[zid] || !!(data().elections[zid] && data().elections[zid].result);
  // ---- who may vote (Nate, 16 Oct: no Discord alts voting) -------------------------------------------------------------
  const VR = EL.voterRules;
  // An election that began before the voter rules existed carries no rules stamp, and voterWhy lets everyone through: no
  // Discord age, no play time, no citizenship. Riften's did (opened 16 Oct 23:36Z, the rules shipped the next day).
  // Restarting it would apply them, but it deletes the election: the courts formed so far would have to form again and
  // the registration clock would start over, five hours later than it stands (Nate, 17 Oct: he would rather not).
  // So a hold named in voterRules.stampRunning has its RUNNING election stamped in place instead - rules, and firstEver
  // unless the hold has already seated a court (electedOnce), so it is judged as a first election and does not ask for
  // the seven days. Once only, and never when a vote has already
  // been cast, so no vote already made can be invalidated by it. Empty by default.
  const stampRunning = () => {
    const names = Array.isArray(VR.stampRunning) ? VR.stampRunning.map((h) => String(h).toLowerCase()) : [];
    if (!names.length || VR.enabled !== true) return;
    for (const zid of names) {
      // Only a hold that holds elections (not one in noElection, nor an unknown id): anything else is skipped and logged
      if (!electing(holdOf(zid))) { log(`citizenship: stampRunning names ${zid}, which holds no election; skipped`); continue; }
      const E = data().elections[zid];
      if (!E || E.rules || (E.phase !== 'registration' && E.phase !== 'voting')) continue;
      if (E.votes && Object.keys(E.votes).length) { log(`citizenship: ${zid}'s election already has votes cast; left under the old rules`); continue; }
      const first = !electedOnce(zid);
      E.rules = 1; if (first) E.firstEver = 1; save();
      audit(`ELECTION ${zid}: the voter rules now apply to the election already running${first ? ', as its first' : ''} (no vote had been cast)`);
      log(`citizenship: stamped ${zid}'s running election with the voter rules${first ? ', as a first election' : ''}`);
    }
  };
  // The backend's records, read-only, as journalstats.js reads players.json (the game server runs as root): profileId ->
  // { discordId } (nothing else is kept), and, only with oneVotePerDevice true, Discord id -> the PC codes the launcher
  // reported (sources/deviceChecks.js)
  const deviceRule = () => VR.enabled === true && VR.oneVotePerDevice === true;
  const BK = S.backend || (S.backend = { at: 0, players: new Map(), devAt: 0, devices: new Map(), devSeen: false, warned: {} });
  const players = (force) => {
    if (force || Date.now() - BK.at > VR.cacheMinutes * 60000) {
      BK.at = Date.now();
      try {
        const rows = JSON.parse(fs.readFileSync(VR.playersFile, 'utf8')); const m = new Map();
        for (const r of Object.values(rows || {})) { const p = Number(r && r.profileId); if (Number.isInteger(p) && p >= 0) m.set(p, { discordId: String(r.discordId || '') }); }
        BK.players = m;
      } catch (e) { if (!BK.warned.players) { BK.warned.players = true; log(`citizenship: ${VR.playersFile} cannot be read (${e.code || e.message}); Discord ids come from the characters only`); } }
    }
    return BK.players;
  };
  const devices = () => {
    if (!deviceRule()) return new Map();
    if (Date.now() - BK.devAt > VR.cacheMinutes * 60000) {
      BK.devAt = Date.now();
      try {
        const d = JSON.parse(fs.readFileSync(VR.deviceFile, 'utf8')); const m = new Map();
        for (const [id, acct] of Object.entries((d && d.accounts) || {})) { const hs = (acct && Array.isArray(acct.d) ? acct.d : []).map((x) => String(x && x.h || '')).filter(Boolean); if (hs.length) m.set(String(id), hs); }
        BK.devices = m; BK.devSeen = true;
      } catch (e) { BK.devices = new Map(); if (!BK.warned.devices) { BK.warned.devices = true; log(`citizenship: no device codes (${VR.deviceFile}: ${e.code || e.message}); one vote per device waits for a launcher that sends them`); } }
    }
    return BK.devices;
  };
  const discordIdOfPid = (pid, actor) => {
    let id = '';
    if (actor) { try { id = String(discordOf(actor >>> 0) || ''); } catch (e) { id = ''; } }
    if (!/^\d{17,20}$/.test(id)) { const r = players().get(Number(pid)); id = r ? r.discordId : ''; }
    return /^\d{17,20}$/.test(id) ? id : '';
  };
  // The Discord account's creation time, read from its id (a snowflake); 0 when unknown
  const discordCreated = (id) => { try { const t = Number((BigInt(id) >> 22n) + 1420070400000n); return t > Date.UTC(2015, 0, 1) && t <= Date.now() ? t : 0; } catch (e) { return 0; } };
  const playOf = (pid) => { try { return typeof globalThis.__dboPlaytimeOf === 'function' ? globalThis.__dboPlaytimeOf(Number(pid)) : undefined; } catch (e) { return undefined; } };
  const hm = (ms) => { const m = Math.floor(Math.max(0, ms) / 60000); return `${Math.floor(m / 60)} h ${m % 60} m`; };
  const dayText = (t) => new Date(Number(t) || 0).toISOString().slice(0, 10);
  // When the vote opens: the first voting round's start; during registration, the time it is due to open (so the panel gives
  // the answer the vote will); else now (the count toward the threshold)
  const refTime = (E) => {
    if (E && E.phase === 'voting' && Number(E.voteOpenedAt)) return Number(E.voteOpenedAt);
    if (E && E.phase === 'registration' && Number(E.phaseEndsAt)) return Math.max(Date.now(), Number(E.phaseEndsAt));
    return Date.now();
  };
  // Why this account (and, with since, its character's citizenship) may not vote, or ''. The text is the player's own.
  const voterWhy = (pid, actor, since, E, z) => {
    if (VR.enabled !== true) return '';
    // An election started before the rules (no stamp) finishes under the old rules; votes already cast stand
    if (E && !E.rules) return '';
    const at = refTime(E); const opened = !!(E && E.phase === 'voting' && Number(E.voteOpenedAt));
    const when = opened ? 'when the vote opened' : 'when the vote opens';
    if (Number(VR.discordAgeDays) > 0) {
      const id = discordIdOfPid(pid, actor); const born = id ? discordCreated(id) : 0;
      if (!born) return 'Your Discord account could not be checked, so you cannot vote. Ask the staff on Discord.';
      const need = born + VR.discordAgeDays * DAY;
      if (need > at) return `Only Discord accounts at least ${VR.discordAgeDays} days old ${when} may vote. Yours ${need > Date.now() ? 'will be' : 'was'} ${VR.discordAgeDays} days old on ${dayText(need)}.`;
    }
    if (Number(VR.playHours) > 0 || Number(VR.playDays) > 0) {
      const snap = opened && E.voterPlay && E.voterPlay[String(pid)];
      const p = snap ? { ms: snap[0], days: snap[1] } : playOf(pid);
      if (p === undefined) { if (!BK.warned.play) { BK.warned.play = true; log('citizenship: no play time source (playtime.js); the play time rule is not applied'); } }
      else {
        const ms = Number(p && p.ms) || 0, days = Number(p && p.days) || 0;
        if (ms < VR.playHours * HOUR || days < VR.playDays) return `To vote you need ${VR.playHours} hours of play, on at least ${VR.playDays} different days, before the vote opens. Your account had ${hm(ms)} on ${days} day${days === 1 ? '' : 's'}${opened ? ' when it opened' : ' so far'}.`;
      }
    }
    // EVERY hold's first election asks for citizenDaysFirstElection instead of citizenDays (Nate, 17 Oct). With no election
    // in hand (the hold's count, and the threshold that starts one) a hold that has never seated a court is at its first;
    // a running record decides by its own firstEver, stamped at its start.
    const first = E ? !!E.firstEver : !electedOnce(z.id);
    const needDays = first ? Math.max(0, Number(VR.citizenDaysFirstElection) || 0) : Number(VR.citizenDays);
    if (needDays > 0 && since !== undefined && Number(since) > 0) {
      const need = Number(since) + needDays * DAY;
      if (need > at) return `Only those who were citizens of ${ofPlace(z.name)} for ${needDays} day${needDays === 1 ? '' : 's'} ${when} may vote. This character became one on ${dayText(since)}.`;
    }
    return '';
  };
  // Accounts that share a PC (the launcher's device code) count once: groups of pids
  const deviceGroups = (pids) => {
    const dev = devices();
    const parent = new Map(pids.map((p) => [p, p]));
    const find = (p) => { while (parent.get(p) !== p) p = parent.get(p); return p; };
    if (dev.size) {
      const owner = new Map();
      for (const p of pids) {
        const id = discordIdOfPid(p); for (const h of (id && dev.get(id)) || []) { if (owner.has(h)) parent.set(find(p), find(owner.get(h))); else owner.set(h, p); }
      }
    }
    return find;
  };
  const sharesDevice = (pidA, pidB) => {
    if (!deviceRule()) return false;
    const dev = devices(); if (!dev.size) return false;
    const a = discordIdOfPid(pidA), b = discordIdOfPid(pidB);
    const ha = (a && dev.get(a)) || []; const hb = new Set((b && dev.get(b)) || []);
    return ha.some((h) => hb.has(h));
  };
  // The accounts that count toward the threshold: those with a citizen character there that passes the rules; accounts on
  // one PC count once
  const eligiblePids = (z, E) => {
    const out = [];
    for (const [pid, list] of citizenPids(z)) if (list.some((c) => !voterWhy(pid, c.actor, c.since, E, z))) out.push(pid);
    if (!deviceRule() || out.length < 2) return out;
    const find = deviceGroups(out); const seen = new Set();
    return out.filter((p) => { const g = find(p); if (seen.has(g)) return false; seen.add(g); return true; });
  };
  const citizenAccounts = (z, E) => eligiblePids(z, E === undefined ? elOf(z.id) : E).length;
  // At the vote's opening: each citizen account's play time then, so hours played during the vote do not count
  const snapPlay = (z, E) => {
    E.voteOpenedAt = E.phaseStartedAt; E.voterPlay = {};
    for (const pid of citizenPids(z).keys()) { const p = playOf(pid); if (p) E.voterPlay[String(pid)] = [Number(p.ms) || 0, Number(p.days) || 0]; }
  };
  const voterLabel = (E, pid) => { const v = E.voters && E.voters[String(pid)]; return v ? `${v.name}${v.tag ? ` #${v.tag}` : ''}` : `profile ${pid}`; };
  // A round's voter names (E.voters) live only while it is open; the play-time snapshot (E.voterPlay) until the election ends
  const forgetVoters = (E, all) => { delete E.voters; delete E.salt; if (all) delete E.voterPlay; };
  const struckCount = (E) => Object.keys((E && E.struckVotes) || {}).length;
  const isJarlRace = (a) => { const r = String(raceEdidOf(a) || ''); return (EL.jarlRaces || []).some((p) => new RegExp(`^${p}(Vampire)?$`).test(r)); };
  // Why a character cannot stand for a seat of z's ballot, or ''
  const unfit = (a, z, seat) => {
    if (!exists(a)) return 'no longer exists';
    if (!citizenOf(a, z.id)) return `is no citizen of ${ofPlace(z.name)}`;
    if (!factionFree(a)) return 'serves a faction';
    if (seat === 'jarl' && !isJarlRace(a)) return 'is no Breton, Nord or Imperial: only they may be Jarl';
    return '';
  };
  const courtById = (E, id) => (E.courts || []).find((c) => c.id === String(id || '')) || null;
  // Cabinets cannot vote (Nate, 14 Oct): the Jarl candidate and the named Steward, Lord Commander and Housecarl of a court on
  // this ballot. A court reaches the ballot only once all four have accepted, so every member of it has; members of a court
  // that was dropped at the close (one never accepted) or lost a tie are no cabinet of this vote any more. The account
  // counts too: another character of the same player does not vote for them. { court, seat, self } or null
  const cabinetOf = (E, a) => {
    if (!E || E.phase !== 'voting') return null;
    const pid = Number(profileOf(a));
    for (const id of E.ballot || []) {
      const c = courtById(E, id); if (!c || c.struck) continue;
      for (const s of SEATS) {
        const m = c.members[s.id]; if (!m) continue;
        const self = (m.actor >>> 0) === (a >>> 0);
        if (self || (pid >= 0 && Number(m.pid) === pid)) return { court: c, seat: s, self };
      }
    }
    return null;
  };
  const canVote = (a, z, E) => {
    if (!citizenOf(a, z.id)) return `Only the citizens of ${ofPlace(z.name)} vote here.`;
    // One hold per player (Nate, 16 Oct): an account votes in the hold of its first vote only, whichever character it uses
    const pidV = String(Number(profileOf(a)));
    const home = data().voterHold[pidV] || Object.keys(data().elections).find((zid) => zid !== z.id && data().elections[zid] && data().elections[zid].votes && data().elections[zid].votes[pidV] !== undefined);
    if (home && home !== z.id) { const h = holdOf(home); return `Your account votes in ${h ? ofPlace(h.name) : 'another hold'}. One hold per player, whichever of your characters you play.`; }
    if (E && E.struckVotes && E.struckVotes[pidV]) return 'Your vote in this election was struck by the staff after a review. If you think this is wrong, ask the staff on Discord.';
    if (EL.noFactionVoters && !factionFree(a)) return 'Those who serve a faction or a court cannot vote in this first election.';
    const cab = cabinetOf(E, a);
    if (cab) {
      const jarl = cab.court.members.jarl ? cab.court.members.jarl.name : 'a candidate';
      const where = cab.seat.id === 'jarl' ? 'You stand for Jarl on this ballot' : `You stand on this ballot as ${cab.seat.label} in the court of ${jarl}`;
      return cab.self ? `${where}. Those who stand in a court do not vote in its election.`
        : `Another of your characters stands on this ballot (${cab.court.members[cab.seat.id].name}, ${cab.seat.id === 'jarl' ? 'for Jarl' : `${cab.seat.label} in the court of ${jarl}`}). Those who stand in a court do not vote in its election.`;
    }
    const own = explicit(a).find((h) => h.zone === z.id);
    const why = voterWhy(Number(pidV), a, own ? own.since : 0, E, z);
    if (why) return why;
    // One vote per PC: an account the launcher's device code links to one that has voted here already
    if (E && E.phase === 'voting' && deviceRule() && E.rules && E.votes[pidV] === undefined && Object.keys(E.votes || {}).some((p) => sharesDevice(Number(pidV), Number(p)))) {
      return 'A vote has already been cast in this election from the computer you play on. One vote per computer, as well as one per account.';
    }
    return '';
  };
  const courtOfActor = (E, a) => (E.courts || []).find((c) => SEATS.some((s) => c.members[s.id] && (c.members[s.id].actor >>> 0) === (a >>> 0))) || null;
  const courtOfAccount = (E, pid, except) => (E.courts || []).find((c) => c !== except && SEATS.some((s) => c.members[s.id] && Number(c.members[s.id].pid) === Number(pid))) || null;
  const complete = (c, z) => SEATS.every((s) => c.members[s.id] && c.members[s.id].accepted && !unfit(c.members[s.id].actor, z, s.id));
  // ---- election notices (Nate, 14 Oct): to the hold's citizens in game, again at login, and on Discord ------------------------
  // Each notice is kept on the election ({ key, kind, text, at, until }) with the characters already told (noticed: actor hex
  // -> key), so a citizen logging in during the phase is told once per character, across restarts and reloads.
  const roleIds = () => Object.fromEntries(Object.entries(C.discordRoles || {}).filter(([, id]) => /^\d{15,22}$/.test(String(id))));
  const when = (t) => `<t:${Math.floor(Number(t) / 1000)}:f>`;
  const SEATLIST = () => SEATS.map((s) => s.label).join(', ');
  const noticeTexts = (z, E, kind, extra) => {
    const place = ofPlace(z.name);
    const until = dateText(E.phaseEndsAt);
    const at = 'at a notice board of the hold, on its Voting tab';
    switch (kind) {
      case 'registration': return {
        game: `The citizens of ${place} are to choose their Jarl. Until ${until}, any citizen who would rule may put forward a full court (${SEATLIST()}) ${at}. When that time is up, the vote begins.`,
        discord: `**${z.name} will choose its Jarl.** The hold counts ${citizenAccounts(z, E)} citizens who may vote. Until ${when(E.phaseEndsAt)}, any citizen who would rule may put forward a full court (${SEATLIST()}) at a notice board of the hold, Voting tab. The vote opens when that time is up.` };
      case 'reopened': return {
        game: `No full court stood before the citizens of ${place}, so the call goes out again. Until ${until}, any citizen who would rule may put forward a court (${SEATLIST()}) ${at}.`,
        discord: `**${z.name}: the call for courts goes out again.** No full court stood for the vote. Until ${when(E.phaseEndsAt)}, any citizen may put forward a court (${SEATLIST()}) at a notice board of the hold, Voting tab.` };
      case 'voting': return {
        game: `The vote for the Jarl of ${place} is open until ${until}. Each citizen who serves no faction casts one vote ${at}. Those who stand in a court do not vote.`,
        discord: `**The vote for the Jarl of ${z.name} is open** until ${when(E.phaseEndsAt)}. Citizens who serve no faction cast one vote each at a notice board of the hold, Voting tab. Those who stand in a court do not vote, and no count is shown until the vote closes.` };
      case 'revote': return {
        game: `The vote for the Jarl of ${place} is tied. A new vote between the tied courts runs until ${until}, ${at}. Every citizen who may vote, votes again.`,
        discord: `**The vote in ${z.name} is tied.** A new vote between the tied courts runs until ${when(E.phaseEndsAt)}, at a notice board of the hold, Voting tab. Every citizen who may vote, votes again.` };
      case 'result': {
        const struck = Number(extra.struck) > 0 ? ` ${extra.struck} vote${extra.struck === 1 ? ' was' : 's were'} struck after a staff review.` : '';
        return {
          game: `${extra.jarl} is elected Jarl of ${place} by its citizens.${extra.empty.length ? ` The seats of ${extra.empty.join(', ')} start empty; the new Jarl appoints them.` : ''} The count stands on the notice boards of the hold, on the Voting tab.${struck}`,
          discord: `**${extra.jarl} is elected Jarl of ${z.name}.**${extra.court ? ` The court: ${extra.court}.` : ''}${extra.empty.length ? ` The seats of ${extra.empty.join(', ')} start empty; the new Jarl appoints them.` : ''} The count is on the hold's notice boards, Voting tab.${struck}` };
      }
      default: return null;
    }
  };
  const discordPost = (z, kind, content) => {
    const ch = String(EL.announceChannel || ''); const role = roleIds()[z.id];
    if (!/^\d{15,22}$/.test(ch) || !role) { log(`citizenship: no Discord notice for ${kind} in ${z.id}: ${!/^\d{15,22}$/.test(ch) ? 'no announceChannel' : 'no citizen role'} set`); return false; }
    const post = globalThis.__dboDiscordPost;
    if (typeof post !== 'function') { log(`citizenship: no Discord notice for ${kind} in ${z.id}: no bot`); return false; }
    // Only the hold's citizen role is pinged: never @everyone or @here, nor a user named in the text
    const body = { content: `<@&${role}> ${content}`, allowed_mentions: { parse: [], roles: [role] } };
    try {
      Promise.resolve(post(ch, body)).then(() => log(`citizenship: Discord notice ${kind} for ${z.id} posted`), (e) => log(`citizenship: Discord notice ${kind} for ${z.id} failed: ${e && e.message}`));
    } catch (e) { log(`citizenship: Discord notice ${kind} for ${z.id} failed: ${e.message}`); }
    return true;
  };
  // Tells every online citizen of z now, keeps the notice for those who log in, and posts it on Discord
  const announce = (z, E, kind, extra) => {
    const t = noticeTexts(z, E, kind, extra || {}); if (!t) return;
    const at = Date.now();
    E.notice = { key: `${kind}:${Number(E.round) || 1}:${at}`, kind, text: t.game, at, until: kind === 'result' ? at + EL.resultLoginDays * DAY : Number(E.phaseEndsAt) || 0 };
    E.noticed = {};
    for (const m of onlineActors()) if (citizenOf(m, z.id)) { personal(m, t.game); E.noticed[hex(m)] = E.notice.key; }
    save();
    discordPost(z, kind, t.discord);
  };
  // At login: the notice of each hold's current phase, once per character
  const noticeLogin = (a) => {
    a = a >>> 0;
    let told = false;
    // A struck (or restored) vote, told once on whichever character of the account logs in first
    const vn = data().voteNotices; const vk = String(Number(profileOf(a)));
    if (vn && typeof vn === 'object' && vn[vk]) { personal(a, vn[vk]); delete vn[vk]; told = true; }
    for (const z of holds()) {
      const E = elOf(z.id); const n = E && E.notice;
      if (!n || !electing(z) || !(Date.now() < Number(n.until)) || !citizenOf(a, z.id)) continue;
      if (n.kind !== 'result' && !(E.phase === 'registration' || E.phase === 'voting')) continue;
      if (!E.noticed || typeof E.noticed !== 'object') E.noticed = {};
      if (E.noticed[hex(a)] === n.key) continue;
      E.noticed[hex(a)] = n.key; told = true;
      personal(a, n.text);
    }
    if (told) save();
  };
  // An election that ran before the notices existed: its current phase is announced once
  const backfill = (z, E) => {
    if (E.notice || !(E.phase === 'registration' || E.phase === 'voting')) return;
    announce(z, E, E.phase === 'voting' ? (E.revote ? 'revote' : 'voting') : (Number(E.reopened) ? 'reopened' : 'registration'));
    log(`citizenship: the running election of ${z.id} had no notice; announced its ${E.phase} now`);
  };
  const startPhase = (E, phase, hours) => { E.phase = phase; E.phaseStartedAt = Date.now(); E.phaseEndsAt = Date.now() + hours * HOUR; };
  const startElection = (z, why) => {
    // Its first ever unless the hold has seated a court by election (electedOnce: kept apart from the record, which staff
    // restart and resume delete). Stamped once, at the start, so the answer cannot change under a running election.
    const E = { phase: '', round: 1, startedAt: Date.now(), courts: [], ballot: [], votes: {} };
    if (!electedOnce(z.id)) E.firstEver = 1;
    // The voter rules apply to an election stamped at its start (one already running at the deploy keeps the old rules)
    if (VR.enabled === true) E.rules = 1;
    startPhase(E, 'registration', EL.registrationHours);
    data().elections[z.id] = E; save();
    audit(`ELECTION ${z.name}: registration opened (${why}); closes ${dateText(E.phaseEndsAt)}`);
    announce(z, E, 'registration');
    return E;
  };
  const cancel = (z, why, held) => {
    const E = elOf(z.id); if (!E) return;
    if (held) { E.phase = 'held'; E.phaseEndsAt = 0; forgetVoters(E, true); } else delete data().elections[z.id];
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
      // A single complete court takes office with no vote: nobody runs against it (otome, 18 Oct)
      if (ok.length === 1 && EL.unopposedWins !== false) {
        E.courts = ok; E.ballot = [ok[0].id]; E.votes = {};
        audit(`ELECTION ${z.name}: one complete court at the close of registration; it takes office unopposed`);
        elect(z, E, ok[0], { [ok[0].id]: 0 }, true);
        return true;
      }
      if (ok.length) {
        E.courts = ok; E.ballot = ok.map((c) => c.id); E.votes = {}; E.voters = {};
        startPhase(E, 'voting', EL.votingHours); snapPlay(z, E); save();
        audit(`ELECTION ${z.name}: ${ok.length} court(s) on the ballot; the vote closes ${dateText(E.phaseEndsAt)}`);
        announce(z, E, 'voting');
        return true;
      }
      if (citizenAccounts(z) >= EL.threshold) {
        startPhase(E, 'registration', EL.registrationHours); E.reopened = (Number(E.reopened) || 0) + 1; forgetVoters(E, true); save();
        audit(`ELECTION ${z.name}: no complete court; registration reopened until ${dateText(E.phaseEndsAt)}`);
        announce(z, E, 'reopened');
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
        E.courts = []; E.ballot = []; E.votes = {}; forgetVoters(E, true);
        if (citizenAccounts(z) >= EL.threshold) { startPhase(E, 'registration', EL.registrationHours); E.revote = false; save(); audit(`ELECTION ${z.name}: no court left on the ballot; registration reopened`); announce(z, E, 'reopened'); }
        else cancel(z, 'no court left on the ballot');
        return true;
      }
      const top = Math.max(...E.ballot.map((id) => counts[id]));
      const best = E.ballot.filter((id) => counts[id] === top);
      // Nobody voted (one court, or several tied at 0): never a revote, as nobody can become able to vote in one
      if (top < 1) {
        E.courts = []; E.ballot = []; E.votes = {}; forgetVoters(E, true);
        if (citizenAccounts(z) >= EL.threshold) { startPhase(E, 'registration', EL.registrationHours); E.revote = false; save(); audit(`ELECTION ${z.name}: no vote was cast; registration reopened`); announce(z, E, 'reopened'); }
        else cancel(z, 'no vote was cast');
        return true;
      }
      if (best.length > 1) {
        E.round = (Number(E.round) || 1) + 1; E.ballot = best; E.votes = {}; forgetVoters(E, false); E.revote = true;
        E.courts = E.courts.filter((c) => best.includes(c.id));
        startPhase(E, 'voting', EL.votingHours); save();
        audit(`ELECTION ${z.name}: a tie between ${best.length} courts; a revote between them until ${dateText(E.phaseEndsAt)}`);
        announce(z, E, 'revote');
        return true;
      }
      elect(z, E, courtById(E, best[0]), counts, false);
      return true;
    }
    return false;
  };
  // The winning court takes office: seated, recorded, audited and announced. unopposed: the only complete court at the close of
  // registration, seated with no vote (otome, 18 Oct; config election.unopposedWins)
  const elect = (z, E, winner, counts, unopposed) => {
    const empty = seatWinner(z, E, winner);
    E.result = { winner: winner.id, counts, at: Date.now(), empty, unopposed: !!unopposed };
    data().elected[z.id] = Date.now();   // it has seated a court: every later election there asks for the seven days
    E.phase = 'seated'; E.phaseEndsAt = 0; E.revote = false; forgetVoters(E, true); save();
    const j = winner.members.jarl; const struck = struckCount(E);
    audit(`ELECTION ${z.name}: ${j.name} is elected Jarl with a court of ${SEATS.filter((s) => s.id !== 'jarl').map((s) => `${s.label} ${winner.members[s.id] ? winner.members[s.id].name : '(empty)'}`).join(', ')}${empty.length ? `; empty: ${empty.join(', ')}` : ''}; ${struck} vote(s) struck by staff`);
    announce(z, E, 'result', { struck, jarl: j.name, empty, court: SEATS.filter((s) => s.id !== 'jarl' && winner.members[s.id] && !empty.includes(s.label)).map((s) => `${s.label} ${winner.members[s.id].name}`).join(', ') });
  };
  const tick = () => {
    if (!C.enabled) return;
    for (const z of holds()) {
      if (!electing(z)) continue;
      const E = elOf(z.id);
      try {
        if (!E) { if (citizenAccounts(z) >= EL.threshold) startElection(z, `${EL.threshold} citizens`); continue; }
        if (!advance(z, E)) backfill(z, E);
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
    const why = canVote(a, z, E); if (why) return { error: why };
    const pid = String(Number(profileOf(a)));
    if (E.votes[pid] !== undefined) return { error: 'Your vote is cast. One vote per player.' };
    if (!E.ballot.includes(String(courtId || ''))) return { error: 'That court is not on the ballot.' };
    E.votes[pid] = String(courtId); if (!data().voterHold[pid]) data().voterHold[pid] = z.id;
    // For a strike's label: who voted in this round (forgotten when the round closes)
    if (!E.voters || typeof E.voters !== 'object') E.voters = {};
    E.voters[pid] = { name: nameNow(a), tag: tagSafe(a), at: Date.now() };
    save();
    // The ballot is secret: the audit says that a vote was cast, never for whom
    audit(`ELECTION ${z.name}: ${who(a)} voted (round ${E.round})`);
    return { text: 'Your vote is cast. The result is known when the vote closes.' };
  };
  const staffAct = (a, zid, what, extra) => {
    if (!isLeadStaff(a)) return { error: 'Only a Lead GM or above changes an election.' };
    const z = holdOf(zid); if (!z || !electing(z)) return { error: 'That hold holds no election.' };
    const E = elOf(z.id);
    if (what === 'cancel') { if (!E || E.phase === 'held') return { error: 'There is no election running there.' }; cancel(z, `by ${who(a)}`, true); return { text: `The election of ${ofPlace(z.name)} is held until staff restart it.` }; }
    if (what === 'restart') { delete data().elections[z.id]; save(); startElection(z, `restarted by ${who(a)}`); return { text: `The election of ${ofPlace(z.name)} starts again: registration is open for ${EL.registrationHours} hours.` }; }
    if (what === 'strikevote') return strikeVote(a, zid, extra);
    if (what === 'unstrikevote') return unstrikeVote(a, zid, extra);
    if (what === 'review') return reviewText(a, zid);
    if (what === 'resume') { if (!E || E.phase !== 'held') return { error: 'That election is not held.' }; delete data().elections[z.id]; save(); return { text: `The hold is back on its own clock: an election starts when it has ${EL.threshold} citizens.` }; }
    return { error: 'That cannot be done.' };
  };

  // A voter named by staff: '#TAG', a name or 'profile <id>', then (strike) the reason. The longest name that matches wins.
  const voterAndReason = (text) => {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    const pm = /^profile$/i.test(words[0] || '') && /^\d+$/.test(words[1] || '');
    if (pm) return { pid: Number(words[1]), label: `profile ${words[1]}`, reason: words.slice(2).join(' ') };
    let err = null;
    for (let n = words.length; n >= 1; n--) {
      const tg = officialTarget(words.slice(0, n).join(' '));
      if (tg && !tg.error) return { pid: Number(tg.pid), label: tg.label, reason: words.slice(n).join(' ') };
      if (!err) err = tg;
    }
    return err && err.error ? err : { error: 'Name the voter: a character name or #TAG.' };
  };
  // A struck (or restored) voter is told on any character online now, or once at its next login
  const tellAccount = (pid, text) => {
    const on = accountActors(pid).filter((x) => isOnline(x));
    for (const x of on) tell(x, text);
    if (!data().voteNotices || typeof data().voteNotices !== 'object') data().voteNotices = {};
    if (on.length) delete data().voteNotices[String(pid)]; else data().voteNotices[String(pid)] = text;
  };
  // Lead GM and above, during the vote: strike an account's vote, with a reason. Its other characters cannot vote again in
  // this election (any round), nor in another hold's; /unstrikevote undoes it
  const strikeVote = (a, zid, q) => {
    if (!isLeadStaff(a)) return { error: 'Only a Lead GM or above strikes a vote.' };
    const z = holdOf(zid); const E = z && elOf(z.id);
    if (!E || E.phase !== 'voting') return { error: 'No vote is open there.' };
    if (cabinetOf(E, a)) return { error: 'Your account stands on this ballot, so you cannot strike a vote in it. Ask another Lead GM.' };
    if (!String(q || '').trim()) return { error: 'Name the voter (a character name or #TAG) and the reason.' };
    const t = voterAndReason(q); if (t.error) return t;
    const pid = t.pid; const k = String(pid);
    if (!(pid >= 0) || E.votes[k] === undefined) return { error: `${t.label} has cast no vote in this round.` };
    const reason = String(t.reason || '').trim().slice(0, 200);
    if (!reason) return { error: 'Give the reason after the name: /strikevote <hold> <name or #TAG> <reason>.' };
    const name = voterLabel(E, k);
    delete E.votes[k];
    if (!E.struckVotes || typeof E.struckVotes !== 'object') E.struckVotes = {};
    E.struckVotes[k] = { by: display(a), at: Date.now(), round: E.round, name, reason };
    tellAccount(pid, `Your vote in the election of ${ofPlace(z.name)} was struck by the staff after a review. If you think this is wrong, ask the staff on Discord.`);
    save();
    audit(`ELECTION STAFF ${who(a)} struck the vote of ${name} in ${z.name} (round ${E.round}): ${reason}`);
    return { text: `The vote of ${name} is struck. That account cannot vote again in this election; /unstrikevote ${z.id} ${name} undoes it.` };
  };
  // Lead GM and above: undo a strike, so the account may vote again in the open round
  const unstrikeVote = (a, zid, q) => {
    if (!isLeadStaff(a)) return { error: 'Only a Lead GM or above undoes a struck vote.' };
    const z = holdOf(zid); const E = z && elOf(z.id);
    if (!E || !E.struckVotes || !Object.keys(E.struckVotes).length) return { error: 'No vote is struck there.' };
    if (!String(q || '').trim()) return { error: 'Name the voter: a character name or #TAG.' };
    const t = voterAndReason(q); if (t.error) return t;
    const k = String(t.pid); const sv = E.struckVotes[k];
    if (!sv) return { error: `${t.label} has no struck vote there.` };
    delete E.struckVotes[k];
    tellAccount(t.pid, `Your vote in the election of ${ofPlace(z.name)} is no longer struck.${E.phase === 'voting' ? ' You may vote again, at a notice board of the hold (Voting tab).' : ''}`);
    save();
    audit(`ELECTION STAFF ${who(a)} undid the struck vote of ${sv.name} in ${z.name}`);
    return { text: `The strike of ${sv.name} is undone.${E.phase === 'voting' ? ' That account may vote again in this round.' : ''}` };
  };
  // The review list, for staff: the votes struck in each election, with who struck them and why
  const reviewText = (a, zid) => {
    if (!isLeadStaff(a)) return { error: 'Only a Lead GM or above sees the review list.' };
    const list = zid ? [holdOf(zid)].filter(Boolean) : holds().filter(electing);
    if (!list.length) return { error: 'There is no such hold.' };
    const lines = [];
    for (const z of list) {
      const E = elOf(z.id); if (!E) continue;
      for (const v of Object.values(E.struckVotes || {})) lines.push(`${z.name} (${E.phase}): struck ${v.name} (by ${v.by}, round ${v.round}): ${v.reason || 'no reason given'}`);
    }
    return { text: lines.length ? lines.join('\n') : 'No struck votes.' };
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
    v.voteWhy = canVote(a, z, E);
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
    staff: (a, z, x, y) => staffAct(a, z, String(x || ''), y),
    strikevote: (a, z, x) => strikeVote(a, z, x),
    unstrikevote: (a, z, x) => unstrikeVote(a, z, x),
    revoke: (a, z, x) => revoke(a, z, unhex((String(x || '')))),
    lookup: (a, z, x) => lookup(a, x),
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
  // Staff look up one character's citizenships (Nate, 17 Oct: a Revoke button for Lead GMs); kept per staff member until cleared
  if (!(S.lookups instanceof Map)) S.lookups = new Map();
  const lookup = (a, q) => {
    if (!isLeadStaff(a)) return { error: 'Only a Lead GM or above looks up a citizenship.' };
    if (!String(q || '').trim()) { S.lookups.delete(a >>> 0); return { text: '' }; }
    const tg = officialTarget(String(q).trim());
    if (tg.error) return tg;
    if (!tg.actor || !exists(tg.actor)) return { error: `${q}: no such character.` };
    S.lookups.set(a >>> 0, tg.actor >>> 0);
    return { text: '' };
  };
  const lookupView = (a) => {
    const t = S.lookups.get(a >>> 0);
    if (!t || !exists(t)) return null;
    const e = entryOf(t);
    return { actor: hex(t), name: nameNow(t, e ? e.name : ''), tag: tagSafe(t),
      holds: holdsOf(t).map((h) => { const z = holdOf(h.zone); return Object.assign(holdLine(h), { via: h.auto && z ? autoWhy(t, z) : '' }); }) };
  };
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
      if (!isLeadStaff(a) && (rules(a, z) || isSteward(a, z))) v.manage.push({ zone: z.id, name: z.name, policy: policyOf(z).policy, fee: policyOf(z).fee,
        requests: liveRequests().filter((r) => r.zone === z.id).map((r) => ({ actor: hex(r.actor), name: r.name, tag: tagSafe(r.actor), at: r.at })) });
      if (v.staff && electing(z)) v.staff.push({ zone: z.id, name: z.name, phase: E ? E.phase : 'none', endsAt: E ? Number(E.phaseEndsAt) || 0 : 0, citizens: citizenAccounts(z), threshold: EL.threshold });
    }
    if (v.staff) v.lookup = lookupView(a);
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
      const z = holdOf(r.zone); if (!z || !manages(a, z)) continue;
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
  // gamemode.js appointCheck and court.js's household ranks (coordinator's decision, 14 Oct): once a hold has elected its
  // court, a seat of it (an office or the household rank a ballot seat names) goes only to a citizen of the hold. office:
  // an office id, or '' with rankTitle a household rank title. '' when allowed, else the refusal
  globalThis.__dboCitizenSeatCheck = (zid, office, rankTitle, actor, label) => {
    if (!C.enabled) return '';
    const z = holdOf(zid); const E = z && elOf(z.id);
    if (!z || !E || E.phase !== 'seated') return '';
    const seat = SEATS.find((s) => (office && s.office && (s.office === '@ruler' ? rulerOffice(z) : s.office) === String(office))
      || (!office && rankTitle && s.rank && s.rank.toLowerCase() === String(rankTitle).toLowerCase()));
    if (!seat || citizenOf(Number(actor) >>> 0, z.id)) return '';
    return `${label || nameNow(actor)} is no citizen of ${ofPlace(z.name)}. The seats of its elected court go only to its citizens.`;
  };
  // gamemode.js's login: the election notice of the current phase, once per character
  globalThis.__dboCitizenLogin = (a) => { if (C.enabled) noticeLogin(Number(a) >>> 0); };
  globalThis.__dboCitizenHolds = (a) => (C.enabled ? holdsOf(Number(a) >>> 0).map((h) => h.zone) : []);
  // discordroles.js: the citizen roles this character should wear, and every role this module manages
  globalThis.__dboCitizenRoleIds = (a) => { const ids = roleIds(); return C.enabled ? holdsOf(Number(a) >>> 0).map((h) => ids[h.zone]).filter(Boolean) : []; };
  globalThis.__dboCitizenManagedRoleIds = () => Object.values(roleIds());

  // Staff (Lead GM and above): the struck votes, striking a vote and undoing it
  if (registerChatCommand) {
    registerChatCommand('electionreview', (a, args) => {
      const r = reviewText(a, String(args || '').trim().split(/\s+/)[0] || '');
      for (const line of String(r.error || r.text).split('\n')) personal(a, line);
    }, { admin: true, help: 'elections: the votes struck so far, by whom and why (Lead GM+). /electionreview [hold]' });
    registerChatCommand('strikevote', (a, args) => {
      const m = /^(\S+)\s+(.+)$/.exec(String(args || '').trim());
      if (!m) return personal(a, 'Use /strikevote <hold> <name or #TAG> <reason>, for example /strikevote whiterun #AB12 same person as #CD34 (admitted on Discord).');
      const r = strikeVote(a, m[1].toLowerCase(), m[2]);
      personal(a, r.error || r.text);
    }, { admin: true, help: "elections: strike an account's vote during the vote, with the reason (Lead GM+). Strike on evidence only. /strikevote <hold> <name or #TAG> <reason>" });
    registerChatCommand('unstrikevote', (a, args) => {
      const m = /^(\S+)\s+(.+)$/.exec(String(args || '').trim());
      if (!m) return personal(a, 'Use /unstrikevote <hold> <name or #TAG>.');
      const r = unstrikeVote(a, m[1].toLowerCase(), m[2]);
      personal(a, r.error || r.text);
    }, { admin: true, help: 'elections: undo a struck vote, so that account may vote again in the open round (Lead GM+). /unstrikevote <hold> <name or #TAG>' });
  }
  if (typeof every === 'function') every('citizenship', 60000, tick);
  // Staff releases in config, each applied once (at this load, or the first one after it was added)
  if (C.enabled) { try { staffReleases(); } catch (e) { log('citizenship: staff releases failed', e.stack || e.message); } }
  log(`citizenship ${C.enabled ? 'on' : 'off'}: ${holds().length} holds grant it, ${Object.keys(data().chars).length} characters on the rolls, ${Object.keys(data().elections).length} election(s)`);
  try { stampRunning(); } catch (e) { log('citizenship: stampRunning failed', e.message); }

  return { join, grant, decline, renounce, makePrimary, revoke, lookup, staffReleases, setPolicy, register, replace, withdraw, answerInvite, vote, staffAct, strikeVote, unstrikeVote, reviewText, voterWhy, tick, advance,
    holdsOf, citizenOf, factionFree, citizenAccounts, canVote, noticeLogin, boardPayload, journalView, votingView, citizenshipView, data, PANEL_ID };
};
