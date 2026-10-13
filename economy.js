// DragonBreak Online: taxes, wages and the weekly reckoning (WAR_DESIGN.md section 7). Loaded by gamemode.js.
//
// Nate, 2026-09-26: land is taxed every week; the faction leader, or the hold's Jarl or Count, sets the tax rate (at most
// 30%), and it applies to the property taxes collected every week. Guards and soldiers are paid a wage.
//
// Once a week (reckonDay at reckonHour, UTC; missed reckonings are not run twice):
//   tax     every claimed property (the housing registry) stands on some territory (realm.js, by its outdoor door); it
//           owes that territory's owner the owner's tax rate times its assessed value (a steward's value, else
//           defaultPropertyValue). The tax comes out of the property owner's bank accounts (any of their characters)
//           into the faction's treasury (bank.js __dboTreasury). Unpaid tax is overdue: the owner is told, the count of
//           weeks grows, and the faction's report lists it; the hold's officials act on it (grace or seizure) as with rent.
//           A building in a fief (nobility.js, Nate 10 Oct) sends nobility.fiefShare of its tax to the fief's treasury
//           (bank.js __dboFiefTreasury, deposits only); the faction keeps the rest, and the tithe counts what it kept.
//   wages   each faction's leader sets a wage per rank. A hold faction pays its officials by their rank in the hold; any
//           other faction pays the members on its roster by rank title. Wages go from the treasury into the member's bank
//           account (a hold official's first character), so nobody has to be online. What the treasury cannot pay is owed
//           and paid first at the next reckoning.
//   tithe   the Empire's share of the tax (Nate, 2026-09-30: "the Legion needs to tax Bruma, since Bruma is a part of the
//           Empire"): titheRate of the property tax each faction collected on land in titheProvinces (Cyrodiil, by the
//           land marker's worldspace in regions.js) goes to the titheTo faction's treasury (the Imperial Legion), which
//           pays none on its own land. Skyrim's Holds are independent (4E 211) and pay nothing. What a treasury cannot
//           pay is arrears, taken first the next week. titheRate 0 turns it off.
//   stipend the Aldmeri Dominion pays its Thalmor in the Empire (Nate, 11 Oct: lore advantages for the Thalmor, whom the
//           playerbase is against): dominionStipend gold (default 300) into the dominionStipendTo treasury each reckoning,
//           before wages. It is NEW gold, not taken from anyone, so it is kept modest; 0 turns it off. In the report as
//           stipend, and in the leader's reckoning line.
//   report  each faction keeps its last reckoning (income, wages paid, owed, overdue, balance), shown in the faction panel.
//
// Settings come from the faction panel (F3): dbo:econRate, dbo:econWage (leaders) and dbo:econValue (a property's
// manager, a steward or equivalent). State in economy.json.
//
// Guards (review B2: a ruler could pay the treasury out to himself, or drain a rival with an assessment):
//   - nobody is paid a wage by a treasury their account controls (the hold's ruler, a roster's leader, and their alts),
//     and nobody sets the wage of a rank their own account holds;
//   - wages are paid in full while the treasury holds the gold (wageSavingsShare 1, Nate 13 Oct); below 1 a week's wages
//     take at most wageIncomeShare of the income since the last reckoning, up to wageShare of the balance, plus that share
//     of the savings (review A1-3). What does not fit is paid in part and the rest owed, paid first the next week;
//   - an owed wage is dropped once its payee no longer holds the rank (left the roster, lost the office, or the
//     character was deleted), and the leader may forgive what is owed (dbo econForgive);
//   - a property is assessed at most once every assessEveryDays, to at most assessMaxStep times or 1/assessMaxStep of
//     its value, and its owner is told.
// enabled (config economy.enabled, default false): off, no reckoning runs, so no tax is charged and no wage is paid;
// the settings can still be made. Switching it on is Nate's call.
//
// A reckoning runs once (review A1-2): lastReckoning is stamped and saved before anything is charged, every property
// and every payee is settled on its own (a failure is logged and the rest carry on), and a payee whose character no
// longer exists (deleted at character select, by /wipechars or from the admin panel) is never paid: a hold official is
// paid on the account's character of today, a roster member's entry is dropped, and guilds.js prunes the rosters of
// characters that are gone. Before this, paying a deleted character threw, the stamp was never written, and every tax
// and earlier wage was charged again each minute.
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, cfg, onUi, onlineActors, every, readOfficials, zoneById } = api;
  // Who set the hold's tax is kept by their own name, never a beast's, and a mask's only while rosterPrivacy.masks is
  // off (gamemode.js ownDisplay)
  const ownDisplay = typeof api.ownDisplay === 'function' ? api.ownDisplay : display;
  const C = Object.assign({ enabled: false, maxTaxRate: 0.30, defaultPropertyValue: 2000, maxPropertyValue: 1000000, maxWage: 100000, reckonDay: 0, reckonHour: 0,
    wageShare: 0.25, wageIncomeShare: 0.75, wageSavingsShare: 1, assessEveryDays: 7, assessMaxStep: 2,
    titheRate: 0.10, titheTo: 'imperial-legion', titheProvinces: ['cyrodiil'],
    dominionStipend: 300, dominionStipendTo: 'thalmor', dominionStipendFrom: 'the Aldmeri Dominion',
    // A hold's offices are paid these each week until its ruler or Steward sets another (Nate, 12 Oct); rulers are never paid
    defaultWages: { guard: 50, strongholdguard: 50, captain: 100, guardcaptain: 100, commander: 100, strongholdcommander: 100,
      courtmage: 100, shaman: 100, wisewoman: 100, steward: 150, bane: 150 } }, cfg.economy || {});
  const FILE = path.resolve('economy.json');
  const WEEK = 7 * 86400000;
  const BALANCE = 'private.bankGold';

  const S = globalThis.__dboEconomy || (globalThis.__dboEconomy = { data: null });
  // balanceAfter: each treasury's balance when the last reckoning ended, to tell what came in since (A1-3)
  const fill = (d) => {
    for (const k of ['rates', 'wages', 'values', 'owed', 'overdue', 'reports', 'assessed', 'balanceAfter', 'titheOwed']) if (!d[k] || typeof d[k] !== 'object') d[k] = {};
    if (!Number.isFinite(d.lastReckoning)) d.lastReckoning = 0;
    return d;
  };
  const data = () => {
    if (S.data) return S.data;
    try { S.data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { S.data = null; }
    S.data = fill(S.data && typeof S.data === 'object' ? S.data : {});
    return S.data;
  };
  // A hot reload keeps the data an older economy.js loaded, which may lack a newer key
  if (S.data && typeof S.data === 'object') fill(S.data);
  const save = () => { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data(), null, 1)); fs.renameSync(tmp, FILE); };

  const fn = (name) => (typeof globalThis[name] === 'function' ? globalThis[name] : null);
  const info = (fid) => (fn('__dboGuildInfo') ? fn('__dboGuildInfo')(fid) : null);
  const nameOfFaction = (fid) => (info(fid) || {}).name || fid;
  const leads = (a, fid) => (fn('__dboRealmLeads') ? !!fn('__dboRealmLeads')(a, fid) : false);
  const treasury = () => globalThis.__dboTreasury || null;
  const accountActors = (pid) => { try { return (mp.getActorsByProfileId(pid) || []).map((x) => Number(x) >>> 0); } catch (e) { return []; } };
  const balanceOf = (a) => { try { const v = Number(mp.get(a, BALANCE)); return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0; } catch (e) { return 0; } };
  const credit = (a, n) => { mp.set(a, BALANCE, balanceOf(a) + n); };
  // A form that was destroyed (a deleted character) throws on every get or set; 'type' is a property every form has
  const exists = (a) => { if (!a) return false; try { mp.get(a >>> 0, 'type'); return true; } catch (e) { return false; } };
  const profileOfActor = (a) => { try { const v = Number(mp.get(a, 'profileId')); return Number.isFinite(v) ? v : -1; } catch (e) { return -1; } };
  // An account that controls a faction's treasury is never on its payroll (review B2)
  const accountLeads = (pid, fid) => pid >= 0 && (fn('__dboRealmLeadsAccount') ? !!fn('__dboRealmLeadsAccount')(pid, fid) : false);

  // Takes n gold from the bank accounts of these characters, richest first; all or nothing
  const chargeActors = (ids, n) => {
    const actors = ids.map((a) => ({ a, b: balanceOf(a) })).sort((x, y) => y.b - x.b);
    if (actors.reduce((s, x) => s + x.b, 0) < n) return false;
    let left = n;
    for (const x of actors) { if (left <= 0) break; const off = Math.min(x.b, left); mp.set(x.a, BALANCE, x.b - off); left -= off; }
    return true;
  };
  const chargeAccount = (pid, n) => chargeActors(accountActors(pid), n);
  // Who a claim's tax and notices go to: its character once property is per character (housingSystem.ts), else the account
  const ownerActors = (H, rec) => { try { if (H && typeof H.ownerActorsOf === 'function') return H.ownerActorsOf(rec).map((x) => Number(x) >>> 0); } catch (e) { /* the account's */ } return accountActors(rec.owner); };
  const ownerKey = (H, rec) => { try { if (H && typeof H.ownerKeyOf === 'function') return String(H.ownerKeyOf(rec)); } catch (e) { /* the account's */ } return String(rec.owner); };

  // ---- the next reckoning ------------------------------------------------------------------------------------------
  const nextAfter = (t) => {
    const d = new Date(t);
    let at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), C.reckonHour, 0);
    while (new Date(at).getUTCDay() !== C.reckonDay || at <= t) at += 86400000;
    return at;
  };

  // ---- property ------------------------------------------------------------------------------------------------------
  const claimedRefs = () => { try { const v = JSON.parse(fs.readFileSync(path.resolve('housing.json'), 'utf8')); return Array.isArray(v) ? v.map((x) => Number(x) >>> 0) : []; } catch (e) { return []; } };
  const housing = () => globalThis.__dboHousing || null;
  // The territory a property stands on, by whichever of its doors is outdoors
  const territoryOfProperty = (ref, rec) => {
    const at = fn('__dboRealmTerritoryAt'); if (!at) return null;
    for (const r of [ref, rec && rec.partner].filter(Boolean)) {
      try { const t = at(String(mp.get(r, 'worldOrCellDesc') || ''), mp.get(r, 'pos')); if (t) return t; } catch (e) { /* not loaded */ }
    }
    return null;
  };
  // The claims a reckoning taxes: one per building (Nate, 4 Oct: the building is the property, not its doors or what is inside
  // it). With the place rules on the housing view answers a member's root, so a member is skipped; before them, one owner's
  // claims into the same interior are one building, taxed by its assessed claim, else its lowest. The others' overdue entries go.
  const interiorOf = (r) => { try { const w = String(mp.get(r, 'worldOrCellDesc') || ''); const x = w && mp.lookupEspmRecordById(mp.getIdFromDesc(w) >>> 0); return x && x.record && String(x.record.type) === 'CELL' ? w : ''; } catch (e) { return ''; } };
  const buildings = (H, d) => {
    const groups = new Map();
    for (const ref of claimedRefs().sort((x, y) => x - y)) {
      try {
        if (typeof H.primaryOf === 'function' && (Number(H.primaryOf(ref)) >>> 0) !== ref) { delete d.overdue[String(ref)]; continue; }
        const rec = H.recordOf(ref);
        if (!rec || !rec.owner) continue;
        // A chest or an inner door is no property and pays no tax (Nate, 5 Oct)
        if (typeof H.isBuilding === 'function' && !H.isBuilding(ref)) { delete d.overdue[String(ref)]; continue; }
        const inside = [ref, Number(rec.partner) >>> 0].filter(Boolean).map(interiorOf).find(Boolean);
        const key = inside ? `${ownerKey(H, rec)}|${inside}` : `ref|${ref}`;
        const had = groups.get(key);
        if (!had) { groups.set(key, { ref, rec }); continue; }
        const keep = !(String(had.ref) in d.values) && String(ref) in d.values ? { ref, rec } : had;
        groups.set(key, keep);
        delete d.overdue[String(keep === had ? ref : had.ref)];
      } catch (e) { log(`economy: the claim ${Number(ref).toString(16)} could not be read, skipped this week`, e.message); }
    }
    return [...groups.values()];
  };
  // The fief's share of a building's tax (nobility.js; null without one or with the nobility off), and the fief treasuries
  const FT = () => globalThis.__dboFiefTreasury || null;
  const fiefCut = (ref, rec, tax) => { try { const c = fn('__dboNobilityFiefCut') ? fn('__dboNobilityFiefCut')(ref, rec, tax) : null; return c && FT() && c.share > 0 && c.share < tax ? c : null; } catch (e) { return null; } };
  // A hold's land pays the hold's own rate (business.js /tax, Nate 12 Oct: "everything in bruma that can be owned"); any other
  // faction, or a hold that never set one, its rate from the faction panel
  const holdZoneOf = (fid) => { const f = info(fid); return f && f.kind === 'hold' && f.zone ? f.zone : null; };
  // The hold's tax-setting officials (business.js taxRanks: a Steward too) set its rate here as well; wages stay the leader's
  const setsHoldTax = (a, fid) => { const zone = holdZoneOf(fid); try { return !!zone && !!fn('__dboCanSetHoldTax') && !!fn('__dboCanSetHoldTax')(a, zone); } catch (e) { return false; } };
  const rateOf = (fid) => {
    const own = Number(data().rates[fid]) || 0;
    const zone = holdZoneOf(fid);
    let r = own;
    try { if (zone && fn('__dboHoldTax')) r = Number(fn('__dboHoldTax')(zone, own)); } catch (e) { r = own; }
    return Math.min(C.maxTaxRate, Math.max(0, Number.isFinite(r) ? r : 0));
  };
  const valueOf = (ref) => { const v = Number(data().values[String(ref)]); return Number.isFinite(v) && v >= 0 ? v : C.defaultPropertyValue; };

  // ---- the Imperial tithe ------------------------------------------------------------------------------------------------
  const titheRate = () => { const r = Number(C.titheRate); return Number.isFinite(r) ? Math.min(0.5, Math.max(0, r)) : 0; };
  // Whether a territory's land lies in a tithed province, by its land marker's worldspace
  const tithedLand = (t) => {
    const R = globalThis.__dboRegions; if (!R || typeof R.placeOf !== 'function' || !t || !t.marker) return false;
    try { return (C.titheProvinces || []).includes(R.placeOf(String(t.marker.world || '')).province); } catch (e) { return false; }
  };
  // Moves each payer's tithe (and its arrears) to the recipient's treasury; bases: { fid: property tax on tithed land }
  const payTithes = (T, bases, report) => {
    const d = data(); const rate = titheRate(); const to = String(C.titheTo || '');
    if (!d.titheOwed || typeof d.titheOwed !== 'object') d.titheOwed = {};
    if (!to || !info(to) || !T.keyOf || !T.keyOf(to)) { if (rate) log(`economy: no treasury for ${to || 'the tithe'}, no Imperial tithe taken`); return; }
    for (const fid of new Set(Object.keys(bases).concat(Object.keys(d.titheOwed)))) {
      if (fid === to) { delete d.titheOwed[fid]; continue; }
      try {
        const base = bases[fid] || 0; const owedBefore = Math.floor(Number(d.titheOwed[fid]) || 0);
        const due = Math.floor(base * rate) + owedBefore; if (due <= 0) continue;
        const r = report(fid);
        const take = Math.min(due, Math.floor(T.balance(fid)));
        let paid = 0;
        if (take > 0 && T.spend(fid, take, `Imperial tithe to ${nameOfFaction(to)}`)) {
          if (T.deposit(to, take, `Imperial tithe from ${nameOfFaction(fid)}`)) paid = take;
          else T.deposit(fid, take, `Imperial tithe returned: ${nameOfFaction(to)}'s treasury refused it`);
        }
        r.tithe = paid; r.titheBase = base; r.titheOwed = due - paid; r.titheTo = nameOfFaction(to);
        if (due - paid > 0) d.titheOwed[fid] = due - paid; else delete d.titheOwed[fid];
        if (paid) report(to).tithesIn = (report(to).tithesIn || 0) + paid;
        try { audit(`ECONOMY ${nameOfFaction(fid)}: Imperial tithe ${paid} gold to ${nameOfFaction(to)} (${Math.round(rate * 100)}% of ${base} in taxes${owedBefore ? `, ${owedBefore} in arrears` : ''})${due - paid > 0 ? `; ${due - paid} owed` : ''}`); } catch (e) { log('economy: tithe audit failed', e.message); }
      } catch (e) { log(`economy: the Imperial tithe of ${nameOfFaction(fid)} failed, skipped this week`, e.message); }
    }
  };

  // ---- the Dominion's stipend (Nate, 11 Oct) ------------------------------------------------------------------------------
  // New gold into one faction's treasury each reckoning; a treasury that refuses it is logged and nothing is paid
  const stipendGold = () => { const n = Math.floor(Number(C.dominionStipend)); return Number.isFinite(n) ? Math.min(100000, Math.max(0, n)) : 0; };
  const payStipend = (T, report) => {
    const n = stipendGold(); const to = String(C.dominionStipendTo || '');
    if (!n || !to) return;
    try {
      if (!info(to) || !T.keyOf || !T.keyOf(to)) { log(`economy: no treasury for ${to}, no Dominion stipend paid`); return; }
      const from = String(C.dominionStipendFrom || 'the Aldmeri Dominion');
      if (!T.deposit(to, n, `stipend from ${from}`)) { log(`economy: ${nameOfFaction(to)}'s treasury refused the stipend of ${n} gold`); return; }
      const r = report(to); r.stipend = (r.stipend || 0) + n; r.stipendFrom = from;
      audit(`ECONOMY ${nameOfFaction(to)}: stipend of ${n} gold from ${from} (new gold)`);
    } catch (e) { log('economy: the Dominion stipend failed, skipped this week', e.message); }
  };

  // ---- wages -----------------------------------------------------------------------------------------------------------
  // A faction's wage per rank: what its leader or Steward set, over the default for a hold's offices
  const wageTable = (fid) => {
    const set = data().wages[fid] || {};
    const f = info(fid);
    if (!(f && f.kind === 'hold' && f.zone)) return Object.assign({}, set);
    const z = zoneById(f.zone); const dflt = {};
    for (const r of (z && z.officials) || []) if (Number(C.defaultWages && C.defaultWages[r]) > 0) dflt[r] = Math.floor(Number(C.defaultWages[r]));
    return Object.assign(dflt, set);
  };
  // [{ key: owed key, actor: character to pay (0 if none), rank, name }] for one faction
  const payroll = (fid) => {
    const f = info(fid); const table = wageTable(fid);
    const out = [];
    if (f && f.kind === 'hold' && f.zone) {
      const o = (readOfficials() || {})[f.zone] || {};
      for (const [rank, pids] of Object.entries(o)) {
        const wage = Math.floor(Number(table[rank]) || 0); if (wage <= 0) continue;
        for (const pid of pids || []) {
          if (accountLeads(Number(pid), fid)) continue;
          const actor = accountActors(Number(pid)).find(exists) || 0; out.push({ key: `p${pid}`, pid: Number(pid), actor, rank, wage });
        }
      }
    } else {
      const members = fn('__dboGuildMembers') ? fn('__dboGuildMembers')(fid) : [];
      for (const actor of members) {
        if (!exists(actor)) continue;
        const g = (fn('__dboGuildsOf') ? fn('__dboGuildsOf')(actor) : []).find((x) => x.id === fid);
        const wage = g ? Math.floor(Number(table[g.title]) || 0) : 0;
        const pid = profileOfActor(actor);
        if (wage > 0 && !accountLeads(pid, fid)) out.push({ key: `a${actor}`, pid, actor, rank: g.title, wage });
      }
    }
    return out;
  };

  // Whether an owed wage's payee still holds the rank it was owed for: a hold official by account, a roster member by
  // character (which must still exist). Anyone who left, lost the office or was deleted is owed nothing (A1-3).
  const stillHolds = (fid, key, rank, actor) => {
    const f = info(fid);
    if (f && f.kind === 'hold' && f.zone) return key[0] === 'p' && ((((readOfficials() || {})[f.zone] || {})[rank]) || []).map(Number).includes(Number(key.slice(1)));
    if (key[0] !== 'a' || !exists(actor)) return false;
    return (fn('__dboGuildsOf') ? fn('__dboGuildsOf')(actor) : []).some((g) => g.id === fid && g.title === rank);
  };
  // The character a wage goes to now: a hold official's account's first character that exists today (it may have
  // changed since the wage was owed), a roster member's own character while it exists; 0 if nobody can be paid
  const payeeNow = (p) => (p.key[0] === 'p' ? accountActors(Number(p.key.slice(1))).find(exists) || 0 : exists(p.actor) ? p.actor >>> 0 : 0);

  // ---- the reckoning -----------------------------------------------------------------------------------------------------
  const reckon = () => {
    const d = data(); const T = treasury(); const H = housing();
    // Stamped and saved before anything is charged: whatever happens below, this week's reckoning never runs again
    // (A1-2: a throw here used to leave the stamp unwritten, and the minute timer charged everything again)
    d.lastReckoning = Date.now();
    save();
    // Deleted characters leave the rosters before anyone is paid
    try { const pruned = fn('__dboGuildPrune') ? fn('__dboGuildPrune')() : 0; if (pruned) log(`economy: ${pruned} deleted character(s) taken off the faction rosters`); }
    catch (e) { log('economy: roster prune failed', e.message); }
    const reports = {};
    const report = (fid) => (reports[fid] = reports[fid] || { at: Date.now(), income: 0, taxed: 0, overdue: [], wagesPaid: 0, owed: 0, unpaid: [], balance: 0 });
    // Taxes
    const titheBases = {};
    if (T && H) {
      for (const { ref, rec } of buildings(H, d)) {
        try {
          const t = territoryOfProperty(ref, rec); if (!t) continue;
          const fid = fn('__dboRealmOwnerOf') ? fn('__dboRealmOwnerOf')(t.id) : null; if (!fid) continue;
          const rate = rateOf(fid); if (!rate) continue;
          const tax = Math.floor(valueOf(ref) * rate); if (tax <= 0) continue;
          const r = report(fid);
          const payers = ownerActors(H, rec);
          const charged = chargeActors(payers, tax);
          // A building in a fief: the fief's share goes to its treasury, the rest to the faction (nobility.js)
          const cut = charged ? fiefCut(ref, rec, tax) : null;
          const held = cut ? tax - cut.share : tax;
          if (charged && T.deposit(fid, held, `property tax on ${ref.toString(16)}${cut ? ` (${cut.share} to the fief of ${cut.name})` : ''}`)) {
            let kept = held;
            if (cut && !FT().deposit(cut.id, cut.share, `property tax on ${ref.toString(16)}`)) {
              // The fief's treasury refused it: the faction takes the whole tax, as before fiefs
              if (T.deposit(fid, cut.share, `property tax on ${ref.toString(16)}: the fief's share it could not take`)) kept = tax;
              else { const back = payers[0]; if (back) credit(back, cut.share); }
            } else if (cut) r.fiefShares = (r.fiefShares || 0) + cut.share;
            r.income += kept; r.taxed++;
            delete d.overdue[String(ref)];
            if (tithedLand(t)) titheBases[fid] = (titheBases[fid] || 0) + kept;
          } else if (charged) {
            // The treasury refused it: the owner gets the tax back and owes nothing this week (review m1)
            const back = payers[0];
            if (back) credit(back, tax);
            log(`economy: ${nameOfFaction(fid)}'s treasury could not take ${tax} gold of tax on ${ref.toString(16)}; refunded`);
          } else {
            const o = d.overdue[String(ref)] = d.overdue[String(ref)] || { weeks: 0, gold: 0, owner: rec.owner, ownerName: rec.ownerName, faction: fid };
            o.weeks++; o.gold += tax; o.faction = fid;
            r.overdue.push({ ref: ref.toString(16), owner: rec.ownerName || `profile ${rec.owner}`, weeks: o.weeks, gold: o.gold, where: t.name });
            for (const a of payers) if (onlineActors().includes(a)) personal(a, `Your property tax of ${tax} gold to ${nameOfFaction(fid)} could not be paid from your bank account. It is overdue (${o.weeks} week${o.weeks > 1 ? 's' : ''}).`);
          }
        } catch (e) { log(`economy: the tax on ${Number(ref).toString(16)} failed, skipped this week`, e.message); }
      }
    }
    // The Empire's share comes out before wages, so the week's wage budget counts the income left after it
    if (T && titheRate() > 0) payTithes(T, titheBases, report);
    // The Dominion's stipend, before wages so they can be paid from it
    if (T) payStipend(T, report);
    // Wages: owed first, then this week's
    if (T) {
      const holds = [];
      try { for (const zone of Object.keys(readOfficials() || {})) { const fid = fn('__dboHoldFactionOf') ? fn('__dboHoldFactionOf')(zone) : null; if (fid) holds.push(fid); } } catch (e) { /* no officials */ }
      const factions = new Set(Object.keys(d.wages).concat(Object.keys(d.owed), holds));
      for (const fid of factions) {
        try {
          const r = report(fid);
          const owed = d.owed[fid] || {};
          const due = [];
          for (const [key, o] of Object.entries(owed)) {
            // A wage owed to someone who has since come to lead the faction is dropped, not paid
            const pid = key[0] === 'p' ? Number(key.slice(1)) : (exists(o.actor) ? profileOfActor(o.actor) : -1);
            if (accountLeads(pid, fid)) continue;
            if (!stillHolds(fid, key, o.rank, o.actor)) { log(`economy: dropped ${o.gold} gold owed by ${nameOfFaction(fid)} to ${key} (${o.rank}): no longer holds the rank`); continue; }
            due.push({ key, actor: o.actor, wage: o.gold, rank: o.rank, back: true });
          }
          for (const p of payroll(fid)) due.push(p);
          // The week's wages take at most wageIncomeShare of what came in since the last reckoning, never more than wageShare of
          // the balance (A1-3), plus wageSavingsShare of the savings before it (Nate, 12 Oct: wages may come from the treasury
          // too), never more than the balance. A treasury's first reckoning counts only this week's taxes and tithes as income.
          const balance = T.balance(fid);
          const last = Number(d.balanceAfter[fid]);
          const income = Number.isFinite(last) && fid in d.balanceAfter ? Math.max(0, balance - last) : Math.max(0, r.income - (r.tithe || 0) + (r.tithesIn || 0) + (r.stipend || 0));
          const savings = Math.max(0, balance - income);
          const fromIncome = Math.min(Math.max(0, Number(C.wageIncomeShare) || 0) * income, Math.max(0, Number(C.wageShare) || 0) * balance);
          // wageSavingsShare 1 (Nate, 13 Oct): the leader's wages are paid in full while the treasury holds the gold
          const savingsShare = Math.max(0, Number(C.wageSavingsShare) || 0);
          let budget = Math.floor(savingsShare >= 1 ? balance : Math.min(balance, fromIncome + savingsShare * savings));
          r.wageBudget = budget;
          const fresh = {};
          const owe = (p, actor) => { fresh[p.key] = { actor, gold: ((fresh[p.key] || {}).gold || 0) + p.wage, rank: p.rank }; r.owed += p.wage; r.unpaid.push(p.key); };
          for (const p of due) {
            try {
              const actor = payeeNow(p);
              // A roster member whose character is gone is owed nothing; a hold official with no character today is owed
              if (!actor && p.key[0] === 'a') { log(`economy: ${nameOfFaction(fid)} pays nobody for ${p.key} (${p.rank}): the character no longer exists`); continue; }
              // What the budget allows is paid and the rest owed: all or nothing let an owed wage grow past every week's
              // budget and never be paid (#bugs 12 Oct, Treasury Bugged)
              const pay = actor ? Math.min(p.wage, budget) : 0;
              if (pay > 0 && T.spend(fid, pay, `wage ${p.rank} ${p.key}`)) {
                // The treasury has paid: if the credit still fails, the gold goes back and the wage is owed
                try { credit(actor, pay); }
                catch (e) { T.deposit(fid, pay, `wage ${p.rank} ${p.key} returned: ${e.message}`); owe(p, actor); log(`economy: wage ${p.key} of ${nameOfFaction(fid)} could not be credited, returned`, e.message); continue; }
                r.wagesPaid += pay; budget -= pay;
                if (pay < p.wage) { r.capped = true; owe({ ...p, wage: p.wage - pay }, actor); }
              } else {
                if (actor && p.wage > budget) r.capped = true;
                owe(p, actor);
              }
            } catch (e) { log(`economy: wage ${p.key} of ${nameOfFaction(fid)} failed, skipped this week`, e.message); }
          }
          d.owed[fid] = fresh;
        } catch (e) { log(`economy: the wages of ${nameOfFaction(fid)} failed, skipped this week`, e.message); }
      }
    }
    for (const [fid, r] of Object.entries(reports)) {
      r.balance = T ? T.balance(fid) : 0;
      d.balanceAfter[fid] = r.balance;
      d.reports[fid] = r;
      audit(`ECONOMY ${nameOfFaction(fid)}: taxes ${r.income} gold from ${r.taxed} properties, ${r.overdue.length} overdue;${r.stipend ? ` stipend ${r.stipend} from ${r.stipendFrom};` : ''} wages ${r.wagesPaid} paid, ${r.owed} owed; treasury ${r.balance}`);
      for (const a of onlineActors()) if (leads(a, fid)) personal(a, `The week's reckoning for ${nameOfFaction(fid)}: ${r.income} gold in taxes${r.fiefShares ? ` (and ${r.fiefShares} gold to its fiefs' treasuries)` : ''}${r.tithesIn ? `, ${r.tithesIn} gold in Imperial tithes` : ''}${r.tithe || r.titheOwed ? `, ${r.tithe} gold Imperial tithe to ${r.titheTo}${r.titheOwed ? ` (${r.titheOwed} gold still owed)` : ''}` : ''}${r.stipend ? `, ${r.stipend} gold stipend from ${r.stipendFrom}` : ''}, ${r.wagesPaid} gold in wages${r.owed ? `, ${r.owed} gold of wages owed` : ''}${r.capped ? ` (${(Number(C.wageSavingsShare) || 0) >= 1 ? 'the treasury ran out' : `wages take at most ${Math.round(C.wageIncomeShare * 100)}% of the week's income, up to ${Math.round(C.wageShare * 100)}% of the treasury, plus ${Math.round((Number(C.wageSavingsShare) || 0) * 100)}% of its savings`}: ${r.wageBudget} gold this week; the rest is paid first next week)` : ''}${r.overdue.length ? `, ${r.overdue.length} properties overdue` : ''}. The treasury holds ${r.balance} gold.`);
    }
    save();
    return reports;
  };

  every('economy', 60000, () => {
    if (!C.enabled) return;
    try {
      const d = data();
      if (!d.lastReckoning) { d.lastReckoning = Date.now(); save(); return; }
      if (Date.now() >= nextAfter(d.lastReckoning)) reckon();
    } catch (e) { log('economy: reckoning failed', e.message); }
  });

  // ---- settings from the faction panel ---------------------------------------------------------------------------------
  // Whether a character holds a rank: its account's official rank in a hold, or its own title on a roster. (The payroll
  // leaves out every account that leads, alts included; this only tells a leader why their own rank cannot be paid.)
  const holdsRank = (a, fid, rank) => {
    const f = info(fid);
    if (f && f.kind === 'hold' && f.zone) { const pid = profileOfActor(a); return pid >= 0 && ((((readOfficials() || {})[f.zone] || {})[rank]) || []).map(Number).includes(pid); }
    return (fn('__dboGuildsOf') ? fn('__dboGuildsOf')(a) : []).some((g) => g.id === fid && g.title === rank);
  };
  const days = (ms) => { const d = Math.ceil(ms / 86400000); return `${d} day${d === 1 ? '' : 's'}`; };
  const fromPanel = (a, args) => fn('__dboFactionNonceOk') ? fn('__dboFactionNonceOk')(a, (args || [])[0]) : false;
  const reply = (a, ok, text) => { if (!(fn('__dboFactionRefresh') && fn('__dboFactionRefresh')(a, text, ok))) personal(a, text); };
  onUi('econRate', (a, args) => {
    if (!fromPanel(a, args)) return;
    const fid = String(args[1] || ''); const pct = Number(args[2]);
    if (!leads(a, fid) && !setsHoldTax(a, fid)) return reply(a, false, 'Only the leader, or a hold official who sets its tax, sets the tax rate.');
    if (!Number.isFinite(pct) || pct < 0 || pct > C.maxTaxRate * 100) return reply(a, false, `The tax rate is from 0% to ${Math.round(C.maxTaxRate * 100)}%.`);
    data().rates[fid] = Math.round(pct) / 100; save();
    const zone = holdZoneOf(fid);
    if (zone && fn('__dboSetHoldTax')) fn('__dboSetHoldTax')(zone, Math.round(pct), ownDisplay(a), who(a));
    audit(`ECONOMY ${who(a)} set ${nameOfFaction(fid)}'s tax rate to ${Math.round(pct)}%`);
    reply(a, true, `${nameOfFaction(fid)} taxes property at ${Math.round(pct)}% from the next reckoning.`);
  });
  // The leader, or a hold's tax-setting official (a Steward too), sets a rank's wage; nobody sets their own
  const setWage = (a, fid, rank, gold) => {
    rank = String(rank || '').slice(0, 64); gold = Math.floor(Number(gold));
    if (!leads(a, fid) && !setsHoldTax(a, fid)) return { ok: false, text: 'Only the leader, or a hold official who keeps its books, sets wages.' };
    if (!rank || !Number.isFinite(gold) || gold < 0 || gold > C.maxWage) return { ok: false, text: `A wage is a whole number of gold from 0 to ${C.maxWage}.` };
    if (gold > 0 && holdsRank(a, fid, rank)) return { ok: false, text: `You hold the rank of ${rank} yourself, and nobody sets their own wage.` };
    data().wages[fid] = data().wages[fid] || {}; data().wages[fid][rank] = gold; save();
    audit(`ECONOMY ${who(a)} set ${nameOfFaction(fid)}'s weekly wage for ${rank} to ${gold}`);
    return { ok: true, text: `${rank}: ${gold} gold a week.` };
  };
  globalThis.__dboEconomySetWage = setWage;
  globalThis.__dboEconomyWages = (fid) => wageTable(fid);
  globalThis.__dboEconomyKeepsBooks = (a, fid) => leads(a, fid) || setsHoldTax(a, fid);
  onUi('econWage', (a, args) => {
    if (!fromPanel(a, args)) return;
    const r = setWage(a, String(args[1] || ''), args[2], args[3]);
    reply(a, r.ok, r.text);
  });
  // The leader forgives what the treasury owes: one payee (its owed key) or everyone (no key)
  onUi('econForgive', (a, args) => {
    if (!fromPanel(a, args)) return;
    const fid = String(args[1] || ''); const key = String(args[2] || '');
    if (!leads(a, fid)) return reply(a, false, 'Only the leader forgives owed wages.');
    const owed = data().owed[fid] || {};
    const keys = key ? (owed[key] ? [key] : []) : Object.keys(owed);
    if (!keys.length) return reply(a, false, 'Nothing is owed there.');
    const gold = keys.reduce((n, k) => n + (Number(owed[k].gold) || 0), 0);
    for (const k of keys) delete owed[k];
    save();
    audit(`ECONOMY ${who(a)} forgave ${gold} gold of wages ${nameOfFaction(fid)} owed (${keys.join(', ')})`);
    reply(a, true, `Forgiven: ${gold} gold of owed wages.`);
  });
  // A house bought from the hold (tenancy.js /property buy, Nate 12 Oct) is worth what it sold for: the price becomes its
  // value for the weekly tax, stamped as an assessment, so a steward reassesses it within the usual limits after assessEveryDays
  globalThis.__dboEconomySaleValue = (ref, gold, byWho) => {
    const H = housing(); const primary = H && H.primaryOf(Number(ref) >>> 0);
    gold = Math.floor(Number(gold));
    if (!primary || !Number.isFinite(gold) || gold < 0) return false;
    const key = String(Number(primary) >>> 0); const prev = valueOf(Number(key));
    // A sale lowers the value no further than an assessment may (assessMaxStep), so a house sold for a token price is not
    // taxed on that price for months (claude-jake review, 12 Oct); a higher price stands, as the buyer agreed to it
    const step = Math.max(1, Number(C.assessMaxStep) || 1);
    const value = Math.min(C.maxPropertyValue, Math.max(gold, Math.floor(prev / step)));
    data().values[key] = value; data().assessed[key] = { at: Date.now(), by: `sale to ${byWho}`, from: prev }; delete data().overdue[key]; save();
    audit(`ECONOMY property ${(Number(key) >>> 0).toString(16)} sold for ${gold} gold to ${byWho}; its value is now ${value} (was ${prev})`);
    return true;
  };
  onUi('econValue', (a, args) => {
    if (!fromPanel(a, args)) return;
    const ref = Number(args[1]) >>> 0; const gold = Math.floor(Number(args[2]));
    const H = housing();
    if (!H || !H.primaryOf(ref)) return reply(a, false, 'That is not a property.');
    // The hold's officials, or the holder of the fief it stands in (nobility.js, Nate 10 Oct), there only
    const fiefHolder = !H.isManager(a, ref) && typeof H.isFiefHolder === 'function' && !!H.isFiefHolder(a, ref);
    if (!H.isManager(a, ref) && !fiefHolder) return reply(a, false, 'Only the officials who manage this property assess it.');
    if (!Number.isFinite(gold) || gold < 0 || gold > C.maxPropertyValue) return reply(a, false, `A value is a whole number of gold from 0 to ${C.maxPropertyValue}.`);
    const key = String(H.primaryOf(ref));
    const last = data().assessed[key];
    const wait = last ? last.at + C.assessEveryDays * 86400000 - Date.now() : 0;
    if (wait > 0) return reply(a, false, `This property was assessed recently. It can be assessed again in ${days(wait)}.`);
    const step = Math.max(1, Number(C.assessMaxStep) || 1);
    const prev = valueOf(Number(key));
    const lo = Math.floor(prev / step), hi = Math.min(C.maxPropertyValue, Math.max(prev * step, C.defaultPropertyValue));
    if (gold < lo || gold > hi) return reply(a, false, `An assessment moves a value by at most ${step} times at once: from ${lo} to ${hi} gold for this property (now ${prev}).`);
    data().values[key] = gold; data().assessed[key] = { at: Date.now(), by: who(a), from: prev }; save();
    audit(`ECONOMY ${who(a)}${fiefHolder ? ' (fief holder)' : ''} assessed property ${ref.toString(16)} at ${gold} gold (was ${prev})`);
    const rec = H.recordOf(Number(key));
    if (rec && rec.owner) for (const x of ownerActors(H, rec)) if (onlineActors().includes(x)) personal(x, `Your property has been assessed at ${gold} gold (it was ${prev}). Property tax is a share of that value each week.`);
    reply(a, true, `Assessed at ${gold} gold.`);
  });

  // guilds.js: ranks renamed in game keep their wages (a non-hold faction's wages are kept by rank title). pairs:
  // [[from, to]], applied together, so a swap (A->B, B->A) or a chain (A->B, B->C) moves every wage once
  globalThis.__dboEconomyRanksRenamed = (fid, pairs) => {
    const table = data().wages[String(fid)];
    const list = (Array.isArray(pairs) ? pairs : []).filter((p) => Array.isArray(p) && p[0] !== p[1]);
    if (!table || !list.some(([from]) => from in table)) return false;
    const next = {};
    const moved = new Set(list.map(([from]) => from));
    for (const [k, v] of Object.entries(table)) if (!moved.has(k)) next[k] = v;
    for (const [from, to] of list) if (from in table) next[to] = table[from];
    data().wages[String(fid)] = next; save();
    return true;
  };
  // What the faction panel shows: for each faction this character leads, its rate, wages by rank, and the last reckoning
  globalThis.__dboEconomyView = (a) => {
    const led = fn('__dboRealmFactionsLedBy') ? fn('__dboRealmFactionsLedBy')(a) : [];
    // Holds whose books this official keeps without leading them (a Steward): the rate and the wages
    const keeps = [];
    try {
      for (const zone of Object.keys(readOfficials() || {})) {
        const fid = fn('__dboHoldFactionOf') ? fn('__dboHoldFactionOf')(zone) : null;
        if (fid && !led.includes(fid) && !keeps.includes(fid) && setsHoldTax(a, fid)) keeps.push(fid);
      }
    } catch (e) { /* no officials yet */ }
    return {
      enabled: !!C.enabled, maxTaxRate: C.maxTaxRate, nextReckoning: nextAfter(data().lastReckoning || Date.now()),
      factions: led.concat(keeps).map((fid) => {
        const f = info(fid) || {};
        let ranks = [];
        // labels: each wage key (an office id, or a rank's own title) as people read it, staff names included (rolenames.js)
        let labels = {};
        if (f.kind === 'hold' && f.zone) {
          const z = zoneById(f.zone); ranks = z ? (z.officials || []).slice() : [];
          for (const r of ranks) { try { labels[r] = fn('__dboOfficeTitle') ? String(fn('__dboOfficeTitle')(f.zone, r) || r) : r; } catch (e) { labels[r] = r; } }
        } else if (fn('__dboGuildRanks')) {
          ranks = fn('__dboGuildRanks')(fid);
          try { labels = fn('__dboGuildRankShown') ? fn('__dboGuildRankShown')(fid) || {} : {}; } catch (e) { labels = {}; }
        }
        return { id: fid, name: nameOfFaction(fid), rate: rateOf(fid), wages: wageTable(fid), ranks, labels, report: data().reports[fid] || null };
      }),
    };
  };

  log(C.enabled ? `economy loaded: next reckoning ${new Date(nextAfter(data().lastReckoning || Date.now())).toISOString()}` : 'economy loaded: OFF (economy.enabled false), no reckoning runs');
  return { reckon, nextAfter, payroll, chargeAccount };
};
