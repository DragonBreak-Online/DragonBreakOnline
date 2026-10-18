// DragonBreak Online: the bank (WAR_DESIGN.md section 8). Loaded by gamemode.js.
//
// The TheBank activator (DragonBreak.esp 0x000005, one in each town's bank) opens it. Every character has one account,
// kept on the character itself (private.bankGold), so gold banked in Falkreath comes out in Bruma and the balance lives
// and dies with the character like its inventory. Gold in the bank is never a container in the world: it cannot be looted,
// lockpicked or raided.
//
// Treasuries (Nate, 2026-09-26): a hold's ruler (Jarl, Count, Chieftain) and a faction's leader also see the treasuries
// they answer for. Anyone of them may pay their own gold in; nobody may take gold out, to prevent corruption. The game
// spends treasuries itself (contracts, board fees, and later wages and the war fee). Every treasury is a balance in
// bank.json, a hold's under zones (Nate, 2026-09-27: gold in the bank, not a chest anyone can break into). A hold's old
// treasury chest (zones.json "treasury", seeded once by gamemode.js) is swept every minute: whatever gold it holds moves
// into the hold's balance, which carried the chests over and still catches what pays into a chest (BountyBoardSystem).
//
// The panel (widget 48, type 'bank') opens only for a client whose UI said it has one (dbo:uiCaps from the HUD); anyone
// else gets the same bank in chat, /bank at a bank, so an older client is never handed a window it cannot draw.
// Every transaction is refused unless the character is still at the bank they opened, moves the gold and the balance in
// the same tick, and is audited.
//
// Vaults (Nate, 16 Oct): item storage rented by weight, one per hold. Each hold's banks keep their own vaults, so goods put
// in at Whiterun come out only at a bank in Whiterun's hold; a character may rent one vault in every hold, each with its own
// tier. A vault is kept on the character (private.bankStorage[zoneId]), never a container in the world. The weekly fee is
// taken from the account, else from gold carried, and goes to that hold's treasury; a week that cannot be paid is owed
// (arrears, up to arrearsCapWeeks, so every week before the seizure is owed), and nothing comes out of that vault until the
// debt is paid. seizeAfterDays after the first unpaid week the goods are sold to the hold, and never before the shortest
// warning letter (seizeWarnDays) has had its days: a late letter moves the seizure. seizeCredit 'debt' (the default, bank
// review 16 Oct) sells only what covers the debt and credits the hold at most the debt, and the rest of the goods go back to
// the owner by parcel letter (kept in the vault, tierless and free, if no letter can carry them); 'value' sells everything
// at base value, the hold keeping it all (Nate's first wording). Staff-granted artifacts (artifacts.json) are never sold.
// Every seizure is kept whole in bank.json vaultSeized for seizeLogDays, so staff can restore it (/vaults restore) and a
// crash between the two saves never pays the hold twice.
// The hold of a bank is the hold of the teller ref's own cell (zone-cells.json pins every bank cell; an exterior teller by
// its position), never the player's: a teller in an unpinned interior, or one staff placed outdoors, keeps no vaults.
// Vaults are used only in the bank panel (Nate, 16 Oct); a client without it is told it needs the update. storage.enabled
// false closes them: no fee, no arrears, no seizure, no letter, and on reopening every vault's paid week and seizure date
// move on by the time they were closed (bank.json vaultClock); holders with the panel can still pay and take out.
// Staff: globalThis.__dboVaultHas / __dboVaultTake (restitution.js, gearstrip.js, sprstrip.js), /vaults <name|#TAG> (Lead GM+).

const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, who, cfg, openWidget, closeWidget, onUi, registerChatCommand, takeGold, giveItem,
    goldOf, depositToTreasury, zoneById, zoneList, zoneOfActor, ranksOf, profileOf, distanceMeters, every } = api;
  const onlineActors = typeof api.onlineActors === 'function' ? api.onlineActors : () => [];
  const optFn = (f) => (typeof f === 'function' ? f : null);
  const zoneOfCell = optFn(api.zoneOfCell), zoneAtPlace = optFn(api.zoneAtPlace), isWorldspace = optFn(api.isWorldspace);

  const C = Object.assign({
    activators: ['5:DragonBreak.esp'], reachMeters: 8, sessionMinutes: 15, maxTransaction: 10000000,
    rulerRanks: ['jarl', 'count', 'chieftain'], historyKept: 20,
  }, cfg.bank || {});
  // Vault tiers by carry weight, a gold per weight a week (Nate, 16 Oct). The fee owed stops growing after arrearsCapWeeks
  // (never fewer than the weeks before a seizure); seizeAfterDays after the first unpaid week the goods are sold to the hold,
  // with letters seizeWarnDays before. Off until client 0.3.103 draws the vault tab (bank review R2)
  const V = Object.assign({
    enabled: false, maxStacks: 200, arrearsCapWeeks: 5, seizeAfterDays: 30, seizeWarnDays: [21, 14, 7, 3],
    seizeCredit: 'debt', seizeLogDays: 30, firstTickMinutes: 5,
    tiers: [
      { id: 'strongbox', name: 'Strongbox', weight: 100, weekly: 100 },
      { id: 'coffer', name: 'Coffer', weight: 250, weekly: 250 },
      { id: 'vault', name: 'Vault', weight: 500, weekly: 500 },
    ],
  }, (cfg.bank || {}).storage || {});
  const DAY = 86400000, WEEK = 7 * DAY;
  const NOTICES = 'private.bankNotices';
  const STORAGE = 'private.bankStorage';
  const WIDGET_ID = 48;
  const GOLD = 0x0000000f;
  const FILE = path.resolve('bank.json');
  const BALANCE = 'private.bankGold';
  const HISTORY = 'private.bankLog';

  // State kept across hot reloads: who stands at which bank, which window is open, which UIs can draw the panel
  const S = globalThis.__dboBankState || (globalThis.__dboBankState = { at: new Map(), nonces: new Map(), caps: new Map(), data: null });

  const bankBases = () => {
    const out = new Set();
    for (const d of C.activators) { try { const id = mp.getIdFromDesc(d) >>> 0; if (id) out.add(id); } catch (e) { /* not in this load order */ } }
    return out;
  };
  const isBank = (ref) => {
    try { const desc = String(mp.get(ref, 'baseDesc') || ''); return !!desc && bankBases().has(mp.getIdFromDesc(desc) >>> 0); } catch (e) { return false; }
  };

  // ---- faction treasuries without land (bank.json) ---------------------------------------------------------------
  const data = () => {
    if (S.data) return S.data;
    try { S.data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { S.data = null; }
    if (!S.data || typeof S.data !== 'object' || typeof S.data.factions !== 'object' || !S.data.factions) S.data = { factions: {} };
    if (typeof S.data.zones !== 'object' || !S.data.zones) S.data.zones = {};
    return S.data;
  };
  // Written through a temporary file, so a crash mid-write never leaves half a ledger
  const save = () => {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data(), null, 1));
    fs.renameSync(tmp, FILE);
  };

  // ---- accounts --------------------------------------------------------------------------------------------------
  const balanceOf = (a) => { try { const v = Number(mp.get(a, BALANCE)); return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0; } catch (e) { return 0; } };
  const setBalance = (a, n) => mp.set(a, BALANCE, Math.max(0, Math.floor(n)));
  const note = (a, kind, amount, where) => {
    try {
      const list = mp.get(a, HISTORY);
      const next = (Array.isArray(list) ? list : []).concat([{ at: Date.now(), kind, amount, where: String(where || '') }]);
      mp.set(a, HISTORY, next.slice(-C.historyKept));
    } catch (e) { /* the history is a courtesy; the balance is what counts */ }
  };
  const historyOf = (a) => { try { const list = mp.get(a, HISTORY); return Array.isArray(list) ? list.slice(-10).reverse() : []; } catch (e) { return []; } };

  // An amount typed by a player: a whole number of gold, or "all" of what is available
  const amountOf = (raw, available) => {
    const s = String(raw == null ? '' : raw).trim().toLowerCase();
    if (s === 'all') return available > 0 ? Math.min(available, C.maxTransaction) : 0;
    if (!/^\d+$/.test(s)) return 0;
    const n = Number(s);
    return n >= 1 && n <= C.maxTransaction ? n : 0;
  };

  // ---- treasuries --------------------------------------------------------------------------------------------------
  // A hold's treasury: its balance in bank.json, after moving in whatever gold its old chest holds
  const sweepChest = (zone) => {
    if (!zone || !zone.treasury) return;
    try {
      const id = mp.getIdFromDesc(zone.treasury) >>> 0; if (!id) return;
      const inv = mp.get(id, 'inventory');
      if (!inv || !Array.isArray(inv.entries)) return;
      const gold = inv.entries.filter((e) => (Number(e.baseId) >>> 0) === GOLD).reduce((s, e) => s + (Number(e.count) || 0), 0);
      if (!(gold > 0)) return;
      const had = Math.floor(Number(data().zones[zone.id]) || 0);
      data().zones[zone.id] = had + gold;
      try { save(); } catch (e) { data().zones[zone.id] = had; log('bank: bank.json write failed', e.message); return; }
      mp.set(id, 'inventory', { entries: inv.entries.filter((e) => (Number(e.baseId) >>> 0) !== GOLD) });
      audit(`BANK ${gold} gold moved from the ${zone.id} treasury chest into its bank balance (now ${had + gold})`);
    } catch (e) { log(`bank: sweeping the ${zone.id} treasury chest failed`, e.message); }
  };
  const zoneGold = (zone) => { sweepChest(zone); return Math.floor(Number(data().zones[zone.id]) || 0); };
  // A hold's income since the last reckoning (economy.js tithes it, Nate 18 Oct): { zone: { total, kinds: { kind: gold } } }.
  // Only a deposit whose caller names it income counts ({ income: '<kind>' }); refunds, returns, transfers, gifts and the
  // chest sweep pass none and are never tithed
  const incomeKind = (o) => (o && typeof o === 'object' && typeof o.income === 'string' && o.income.trim() ? o.income.trim().slice(0, 40) : '');
  const incomeMap = () => { const d = data(); if (!d.income || typeof d.income !== 'object') d.income = {}; return d.income; };
  const zoneAdd = (zone, n, opts) => {
    const had = Math.floor(Number(data().zones[zone.id]) || 0);
    const kind = incomeKind(opts); const inc = incomeMap(); const was = inc[zone.id] ? JSON.parse(JSON.stringify(inc[zone.id])) : undefined;
    data().zones[zone.id] = had + n;
    if (kind) {
      const e = inc[zone.id] = inc[zone.id] && typeof inc[zone.id] === 'object' ? inc[zone.id] : { total: 0, kinds: {} };
      if (!e.kinds || typeof e.kinds !== 'object') e.kinds = {};
      e.total = Math.floor(Number(e.total) || 0) + n; e.kinds[kind] = Math.floor(Number(e.kinds[kind]) || 0) + n;
    }
    try { save(); return true; } catch (e) {
      data().zones[zone.id] = had; if (kind) { if (was === undefined) delete inc[zone.id]; else inc[zone.id] = was; }
      log('bank: bank.json write failed', e.message); return false;
    }
  };
  const zoneTake = (zone, n) => {
    const had = zoneGold(zone);
    if (had < n) return false;
    data().zones[zone.id] = had - n;
    try { save(); return true; } catch (e) { data().zones[zone.id] = had; log('bank: bank.json write failed', e.message); return false; }
  };
  // outlaws.js: take up to n gold from a character's account for a fine; the gold taken
  globalThis.__dboBankTake = (a, n, where) => {
    n = Math.floor(Number(n) || 0); if (n <= 0) return 0;
    const take = Math.min(balanceOf(a), n); if (take <= 0) return 0;
    setBalance(a, balanceOf(a) - take);
    note(a, 'fine', take, where);
    audit(`BANK ${who(a)} paid ${take} gold from their account: ${where || 'a fine'} (balance ${balanceOf(a)})`);
    return take;
  };
  // For gamemode.js depositToTreasury and contracts.js: a hold's treasury by zone id
  globalThis.__dboTreasuryZone = {
    balance: (zoneId) => { const z = zoneById(zoneId); return z && z.treasury ? zoneGold(z) : 0; },
    deposit: (zoneId, n, opts) => { n = Math.floor(Number(n) || 0); const z = zoneById(zoneId); return z && z.treasury && n > 0 && zoneAdd(z, n, opts) ? n : 0; },
    spend: (zoneId, n) => { n = Math.floor(Number(n) || 0); const z = zoneById(zoneId); return !!(z && z.treasury && n > 0 && zoneTake(z, n)); },
    // economy.js: every hold's counted income, a copy
    income: () => JSON.parse(JSON.stringify(incomeMap())),
    // economy.js after the reckoning: takes off what it read (a deposit made since stays counted for next week)
    clearIncome: (zoneId, seen) => {
      const inc = incomeMap(); const e = inc[zoneId]; if (!e) return true;
      const was = JSON.parse(JSON.stringify(e));
      const left = Math.max(0, Math.floor(Number(e.total) || 0) - Math.floor(Number(seen && seen.total) || 0));
      const kinds = {};
      for (const [k, v] of Object.entries(e.kinds || {})) { const r = Math.floor(Number(v) || 0) - Math.floor(Number(((seen && seen.kinds) || {})[k]) || 0); if (r > 0) kinds[k] = r; }
      if (left > 0) inc[zoneId] = { total: left, kinds }; else delete inc[zoneId];
      try { save(); return true; } catch (x) { inc[zoneId] = was; log('bank: bank.json write failed', x.message); return false; }
    },
  };
  if (typeof every === 'function' && typeof zoneList === 'function') every('bankSweep', 60000, () => { for (const z of zoneList()) if (z.treasury) sweepChest(z); });
  // The treasuries a character answers for: the holds they rule, and the factions they lead (a hold faction's is its hold's)
  const treasuriesOf = (a) => {
    const out = new Map();
    const addZone = (zoneId, why) => {
      const z = zoneById(zoneId); if (!z || !z.treasury || out.has('zone:' + z.id)) return;
      out.set('zone:' + z.id, { key: 'zone:' + z.id, name: `${z.name} treasury`, why, balance: zoneGold(z) });
    };
    try { for (const m of ranksOf(profileOf(a)) || []) if (C.rulerRanks.includes(m.rank)) addZone(m.zone.id, 'you rule it'); } catch (e) { /* no ranks */ }
    // A faction leader whose faction holds a hold's capital by conquest (realm.js)
    try { if (typeof globalThis.__dboConqueredZonesLedBy === 'function') for (const zid of globalThis.__dboConqueredZonesLedBy(a) || []) addZone(zid, 'your faction took it'); } catch (e) { /* no realm */ }
    const guilds = typeof globalThis.__dboGuildsOf === 'function' ? (globalThis.__dboGuildsOf(a) || []) : [];
    for (const g of guilds) {
      if (g.role !== 'leader') continue;
      if (g.zone) { addZone(g.zone, `you lead ${g.name}`); continue; }
      const key = 'faction:' + g.id;
      if (!out.has(key)) out.set(key, { key, name: `${g.name} treasury`, why: 'you lead it', balance: Math.floor(Number(data().factions[g.id]) || 0) });
    }
    return [...out.values()];
  };

  // One treasury per faction for the rest of the game (realm.js: the war fee, tribute; later wages and taxes): a hold
  // faction's is its hold's balance, any other faction's its own, both in bank.json. Nobody withdraws from a treasury;
  // only the game spends it, through spend().
  const treasuryKeyOf = (fid) => {
    const g = typeof globalThis.__dboGuildInfo === 'function' ? globalThis.__dboGuildInfo(fid) : null;
    if (!g) return null;
    if (g.zone) { const z = zoneById(g.zone); if (z && z.treasury) return 'zone:' + z.id; }
    return 'faction:' + g.id;
  };
  globalThis.__dboTreasury = {
    keyOf: treasuryKeyOf,
    balance: (fid) => {
      const key = treasuryKeyOf(fid); if (!key) return 0;
      if (key.startsWith('zone:')) { const z = zoneById(key.slice(5)); return z ? zoneGold(z) : 0; }
      return Math.floor(Number(data().factions[key.slice(8)]) || 0);
    },
    // Takes n gold from a faction's treasury for the game's own purposes; false (and nothing taken) if it cannot
    spend: (fid, n, why) => {
      n = Math.floor(Number(n) || 0); const key = treasuryKeyOf(fid);
      if (!key || n <= 0) return false;
      if (key.startsWith('zone:')) {
        const z = zoneById(key.slice(5)); if (!z || !zoneTake(z, n)) return false;
      } else {
        const id = key.slice(8); const have = Math.floor(Number(data().factions[id]) || 0);
        if (have < n) return false;
        data().factions[id] = have - n;
        try { save(); } catch (e) { data().factions[id] = have; log('bank: bank.json write failed', e.message); return false; }
      }
      audit(`BANK treasury of ${fid} spent ${n} gold (${why || 'unspecified'})`);
      return true;
    },
    // opts { income: '<kind>' }: a hold's income, tithed (see incomeKind); a landless faction's treasury counts none
    deposit: (fid, n, why, opts) => {
      n = Math.floor(Number(n) || 0); const key = treasuryKeyOf(fid);
      if (!key || n <= 0) return false;
      if (key.startsWith('zone:')) { if (depositToTreasury(key.slice(5), n, opts) !== n) return false; }
      else {
        const id = key.slice(8); const have = Math.floor(Number(data().factions[id]) || 0);
        data().factions[id] = have + n;
        try { save(); } catch (e) { data().factions[id] = have; log('bank: bank.json write failed', e.message); return false; }
      }
      audit(`BANK treasury of ${fid} received ${n} gold (${why || 'unspecified'})`);
      return true;
    },
    // A new landless faction's treasury (charters.js): its bank.json key, at 0 or the given seed. An existing balance is kept
    open: (fid, seed, why) => {
      const key = treasuryKeyOf(fid);
      if (!key || !key.startsWith('faction:')) return false;
      const id = key.slice(8);
      if (Object.prototype.hasOwnProperty.call(data().factions, id)) return true;
      const n = Math.max(0, Math.floor(Number(seed) || 0));
      data().factions[id] = n;
      try { save(); } catch (e) { delete data().factions[id]; log('bank: bank.json write failed', e.message); return false; }
      audit(`BANK treasury of ${fid} opened with ${n} gold (${why || 'unspecified'})`);
      return true;
    },
    // A landless faction's treasury closed (charters.js, a disbanding a GM approved): the key goes, and the gold it held is
    // returned for the caller to pay out. -1 when it cannot be (not a landless faction, or bank.json would not write)
    close: (fid, why) => {
      const key = treasuryKeyOf(fid);
      if (!key || !key.startsWith('faction:')) return -1;
      const id = key.slice(8);
      const had = Object.prototype.hasOwnProperty.call(data().factions, id);
      const n = Math.max(0, Math.floor(Number(data().factions[id]) || 0));
      delete data().factions[id];
      try { save(); } catch (e) { if (had) data().factions[id] = n; log('bank: bank.json write failed', e.message); return -1; }
      audit(`BANK treasury of ${fid} closed: ${n} gold paid out (${why || 'unspecified'})`);
      return n;
    },
  };

  // A fief's treasury (nobility.js, Nate 10 Oct): its share of the property tax, in bank.json under fiefs. Deposits only:
  // nobody withdraws from it, and only the game will spend it
  const fiefGold = () => { const d = data(); if (!d.fiefs || typeof d.fiefs !== 'object') d.fiefs = {}; return d.fiefs; };
  globalThis.__dboFiefTreasury = {
    balance: (id) => Math.floor(Number(fiefGold()[String(id || '')]) || 0),
    deposit: (id, n, why) => {
      n = Math.floor(Number(n) || 0); const key = String(id || '');
      if (!/^[a-z0-9-]{1,40}$/.test(key) || n <= 0) return false;
      const have = Math.floor(Number(fiefGold()[key]) || 0);
      fiefGold()[key] = have + n;
      try { save(); } catch (e) { fiefGold()[key] = have; log('bank: bank.json write failed', e.message); return false; }
      audit(`BANK fief treasury of ${key} received ${n} gold (${why || 'unspecified'})`);
      return true;
    },
  };

  // ---- being at a bank -----------------------------------------------------------------------------------------------
  const atBank = (a) => {
    const s = S.at.get(a >>> 0);
    if (!s || Date.now() - s.since > C.sessionMinutes * 60000) return null;
    return distanceMeters(a, s.bank) <= C.reachMeters ? s : null;
  };
  const notAtBank = 'You are not at a bank. Use the bank in any town: your account is the same everywhere.';

  // ---- transactions: each returns { ok, text } ------------------------------------------------------------------------
  const deposit = (a, raw) => {
    if (!atBank(a)) return { ok: false, text: notAtBank };
    const carried = goldOf(a); const n = amountOf(raw, carried);
    if (!n) return { ok: false, text: carried ? `Deposit a whole number of gold, up to the ${carried} you carry, or "all".` : 'You carry no gold.' };
    if (n > carried) return { ok: false, text: `You carry only ${carried} gold.` };
    if (!takeGold(a, n)) return { ok: false, text: 'The clerk could not take your gold. Nothing was changed.' };
    setBalance(a, balanceOf(a) + n);
    note(a, 'deposit', n, S.at.get(a >>> 0).where);
    audit(`BANK ${who(a)} deposited ${n} gold (balance ${balanceOf(a)})`);
    return { ok: true, text: `Deposited ${n} gold. Your balance is ${balanceOf(a)} gold.` };
  };
  const withdraw = (a, raw) => {
    if (!atBank(a)) return { ok: false, text: notAtBank };
    const bal = balanceOf(a); const n = amountOf(raw, bal);
    if (!n) return { ok: false, text: bal ? `Withdraw a whole number of gold, up to your balance of ${bal}, or "all".` : 'Your account is empty.' };
    if (n > bal) return { ok: false, text: `Your balance is only ${bal} gold.` };
    setBalance(a, bal - n);
    if (!giveItem(a, GOLD, n)) { setBalance(a, bal); return { ok: false, text: 'The clerk could not hand you the gold. Your balance is unchanged.' }; }
    note(a, 'withdraw', n, S.at.get(a >>> 0).where);
    audit(`BANK ${who(a)} withdrew ${n} gold (balance ${balanceOf(a)})`);
    return { ok: true, text: `Withdrew ${n} gold. Your balance is ${balanceOf(a)} gold.` };
  };
  const payIn = (a, key, raw) => {
    if (!atBank(a)) return { ok: false, text: notAtBank };
    // By its key (zone:bruma), its id (bruma) or the start of its name
    const want = String(key || '').trim().toLowerCase();
    const t = want ? treasuriesOf(a).find((x) => x.key === want || x.key.split(':')[1] === want || x.name.toLowerCase().startsWith(want)) : null;
    if (!t) return { ok: false, text: 'You answer for no such treasury.' };
    const carried = goldOf(a); const n = amountOf(raw, carried);
    if (!n) return { ok: false, text: carried ? `Pay in a whole number of gold, up to the ${carried} you carry, or "all".` : 'You carry no gold.' };
    if (n > carried) return { ok: false, text: `You carry only ${carried} gold.` };
    if (!takeGold(a, n)) return { ok: false, text: 'The clerk could not take your gold. Nothing was changed.' };
    if (t.key.startsWith('zone:')) {
      if (depositToTreasury(t.key.slice(5), n) !== n) { giveItem(a, GOLD, n); return { ok: false, text: 'The treasury could not take the gold. It is returned to you.' }; }
    } else {
      const fid = t.key.slice(8);
      data().factions[fid] = Math.floor(Number(data().factions[fid]) || 0) + n;
      try { save(); } catch (e) {
        data().factions[fid] -= n; giveItem(a, GOLD, n);
        log('bank: bank.json write failed', e.message);
        return { ok: false, text: 'The treasury ledger could not be written. Your gold is returned.' };
      }
    }
    note(a, 'treasury', n, t.name);
    audit(`BANK ${who(a)} paid ${n} gold into the ${t.name}`);
    return { ok: true, text: `Paid ${n} gold into the ${t.name}. No one can take it out; the realm spends it.` };
  };

  // ---- vaults: goods stored by weight, one per hold ------------------------------------------------------------------
  const P = () => globalThis.__dboPostApi || null;
  const tierById = (id) => (Array.isArray(V.tiers) ? V.tiers : []).find((t) => t && t.id === String(id || '').toLowerCase()) || null;
  const tierList = () => (Array.isArray(V.tiers) ? V.tiers : []).filter((t) => t && t.id && Number(t.weight) > 0 && Number(t.weekly) >= 0)
    .map((t) => ({ id: t.id, name: String(t.name || t.id), weight: Number(t.weight), weekly: Math.floor(Number(t.weekly)) }));
  const vaultsOf = (a) => { try { const v = mp.get(a, STORAGE); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } };
  const saveVaults = (a, all) => mp.set(a, STORAGE, all);
  // A vault's size and price come from its tier as configured now; the figures from the day it was rented stand in if the tier is gone
  const capOf = (v) => { const t = tierById(v.tier); return t ? Number(t.weight) : Number(v.cap) || 0; };
  const weeklyOf = (v) => { const t = tierById(v.tier); return Math.max(0, Math.floor(t ? Number(t.weekly) : Number(v.weekly) || 0)); };

  // A base's weight is its record's DATA weight (f32): offset 0 for ALCH, 12 for BOOK, 16 for AMMO, 44 for LIGH, 4 for the rest
  const WEIGHT_AT = { WEAP: 4, ARMO: 4, MISC: 4, INGR: 4, KEYM: 4, SLGM: 4, SCRL: 4, ALCH: 0, BOOK: 12, AMMO: 16, LIGH: 44 };
  const weights = S.weights instanceof Map ? S.weights : (S.weights = new Map());
  const weightOf = (baseId) => {
    const id = Number(baseId) >>> 0;
    if (weights.has(id)) return weights.get(id);
    let w = null;
    try {
      const r = mp.lookupEspmRecordById(id); const t = r && r.record ? String(r.record.type) : '';
      const off = WEIGHT_AT[t];
      const f = off === undefined ? null : (r.record.fields || []).find((x) => x && x.type === 'DATA' && x.data instanceof Uint8Array && x.data.byteLength >= off + 4);
      if (f) { const v = new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getFloat32(off, true); w = Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null; }
    } catch (e) { w = null; }
    weights.set(id, w);
    return w;
  };
  const round2 = (n) => Math.round(n * 100) / 100;
  const usedOf = (v) => round2((Array.isArray(v.items) ? v.items : []).reduce((s, e) => s + (weightOf(e.baseId) || 0) * (Number(e.count) || 0), 0));

  // The vault of the hold the bank stands in, settled up to now
  const zoneOfBank = (a) => { const s = atBank(a); const z = s && s.zone ? zoneById(s.zone) : null; return z || null; };
  const noHold = 'This bank keeps no vaults: it answers to no hold.';
  const closedText = 'The vaults are closed for now.';
  // The hold of a teller: its own cell's pin (zone-cells.json) indoors, its position outdoors; never the player's, whose
  // zoneOfActor falls back to where they last stood outside (bank review R8/R9). A teller staff placed (a dynamic 0xff ref)
  // answers only to a pinned cell, so one put down outdoors keeps no vaults
  const holdOfTeller = (ref) => {
    if (!zoneOfCell) return '';
    let world = '', pos = null;
    try { world = String(mp.get(ref, 'worldOrCellDesc') || ''); pos = mp.get(ref, 'pos'); } catch (e) { return ''; }
    if (!world) return '';
    const outdoors = isWorldspace ? !!isWorldspace(world) : false;
    if (!outdoors) return zoneOfCell(world) || '';
    if ((ref >>> 0) >= 0xff000000 || !zoneAtPlace) return '';
    return zoneAtPlace(world, pos) || '';
  };

  // Takes n gold from the account first, then from gold carried; false and nothing taken if the two together fall short
  const charge = (a, n) => {
    if (n <= 0) return { bank: 0, carried: 0 };
    const bal = balanceOf(a); const fromBank = Math.min(bal, n); const rest = n - fromBank;
    if (rest > goldOf(a)) return null;
    if (rest > 0 && !takeGold(a, rest)) return null;
    if (fromBank > 0) setBalance(a, bal - fromBank);
    return { bank: fromBank, carried: rest };
  };
  const refund = (a, paid) => { if (paid.bank) setBalance(a, balanceOf(a) + paid.bank); if (paid.carried) giveItem(a, GOLD, paid.carried); };
  // The fee goes to the hold's treasury; a hold without one keeps it in its bank.json balance
  const payHold = (zone, n) => {
    if (n <= 0) return true;
    if (depositToTreasury(zone.id, n, { income: 'vault fees' }) === n) return true;
    if (zoneAdd(zone, n, { income: 'vault fees' })) { audit(`BANK VAULT ${n} gold kept for ${zone.id} in bank.json (the hold has no treasury yet)`); return true; }
    return false;
  };
  const feeFor = (a, zone, n, why) => {
    const paid = charge(a, n); if (!paid) return null;
    if (!payHold(zone, n)) { refund(a, paid); return null; }
    audit(`BANK VAULT ${who(a)} paid ${n} gold (${paid.bank} banked, ${paid.carried} carried) to ${zone.id} for ${why}`);
    return paid;
  };

  // Who keeps a vault, so the fees and seizures reach characters who are offline too (bank.json vaultHolders)
  const holders = () => { const d = data(); if (!d.vaultHolders || typeof d.vaultHolders !== 'object') d.vaultHolders = {}; return d.vaultHolders; };
  const noteHolder = (a) => {
    const key = (a >>> 0).toString(16); const has = Object.keys(vaultsOf(a)).length > 0;
    if (has === !!holders()[key]) return;
    if (has) holders()[key] = 1; else delete holders()[key];
    try { save(); } catch (e) { log('bank: bank.json write failed', e.message); }
  };

  // ---- the vault clock: frozen while the vaults are closed ------------------------------------------------------------
  // closedTotal: every millisecond the vaults have been closed, for good; each vault remembers the total it last caught up with
  const vclock = () => {
    const d = data();
    if (!d.vaultClock || typeof d.vaultClock !== 'object') d.vaultClock = { closedSince: 0, closedTotal: 0 };
    return d.vaultClock;
  };
  const syncClock = (now) => {
    const c = vclock(); now = now || Date.now();
    if (!V.enabled && !(Number(c.closedSince) > 0)) {
      c.closedSince = now;
      try { save(); } catch (e) { log('bank: bank.json write failed', e.message); }
      audit(`BANK VAULT vaults closed at ${new Date(now).toISOString()}: no fee, arrears or seizure until they open`);
    } else if (V.enabled && Number(c.closedSince) > 0) {
      const off = Math.max(0, now - Number(c.closedSince));
      c.closedTotal = (Number(c.closedTotal) || 0) + off; c.closedSince = 0;
      try { save(); } catch (e) { log('bank: bank.json write failed', e.message); }
      audit(`BANK VAULT vaults opened again after ${Math.round(off / 3600000)} hour(s) closed: every paid week and seizure date moves on by that`);
    }
  };
  // A vault catches up with the time the vaults were closed since it last looked: its paid week and seizure clock move on
  const catchUp = (v) => {
    const total = Number(vclock().closedTotal) || 0; const seen = Number(v.closedSeen) || 0;
    if (total === seen) return false;
    const by = total - seen; v.closedSeen = total;
    if (by < 0) return true; // bank.json was reset: start from its total
    if (Number(v.paidUntil) > 0) v.paidUntil = Number(v.paidUntil) + by;
    if (Number(v.arrearsSince) > 0) v.arrearsSince = Number(v.arrearsSince) + by;
    if (Number(v.seizeAt) > 0) v.seizeAt = Number(v.seizeAt) + by;
    if (v.warnedAt && typeof v.warnedAt === 'object') for (const k of Object.keys(v.warnedAt)) v.warnedAt[k] = Number(v.warnedAt[k]) + by;
    return true;
  };

  // A word for the character: in chat now if they are online, else at their next login; a letter at the boards as well.
  // With a parcel, true only when the letter carrying it was written
  const isOnline = (a) => { try { return onlineActors().map((x) => x >>> 0).includes(a >>> 0); } catch (e) { return false; } };
  const tell = (a, zone, text, parcel) => {
    // boardLetter tells an online recipient itself
    let lettered = false; const p = P();
    try { if (p && typeof p.boardLetter === 'function') { p.boardLetter(a >>> 0, zone.name, text, parcel, undefined, `The Bank of ${zone.name}`); lettered = true; } } catch (e) { log(`bank: a letter to ${who(a)} failed`, e.message); }
    if (parcel && !lettered) return false;
    if (isOnline(a)) { if (!lettered) personal(a, text); return true; }
    try { const list = mp.get(a, NOTICES); mp.set(a, NOTICES, (Array.isArray(list) ? list : []).concat([text]).slice(-10)); } catch (e) { /* the letter still waits */ }
    return true;
  };
  const dateText = (at) => new Date(at).toUTCString().slice(5, 16);
  const warnDays = () => (Array.isArray(V.seizeWarnDays) ? V.seizeWarnDays : []).map(Number).filter((d) => d > 0);
  // The seizure date: seizeAfterDays after the first unpaid week, or later when the last letter went out late
  const seizeAtOf = (v) => (Number(v.arrearsSince) > 0 ? Math.max(Number(v.arrearsSince) + Math.max(1, Number(V.seizeAfterDays) || 30) * DAY, Number(v.seizeAt) || 0) : 0);
  const valueOf = (id) => { try { return Math.max(0, Math.floor(Number(globalThis.__dboBaseValue(Number(id) >>> 0)) || 0)); } catch (e) { return 0; } };

  // Staff-granted artifacts (artifacts.json, by editor id) never go to a sale
  const artifactRx = (() => {
    try {
      const list = (JSON.parse(fs.readFileSync(path.resolve('artifacts.json'), 'utf8')).patterns || []).filter((x) => typeof x === 'string' && x);
      return list.length ? new RegExp(list.map((x) => `(?:${x})`).join('|'), 'i') : null;
    } catch (e) { log('bank: artifacts.json unreadable; seizures wait until it can be read', e.message); return undefined; }
  })();
  const isArtifact = (id) => {
    if (!artifactRx) return false;
    try { const r = mp.lookupEspmRecordById(Number(id) >>> 0); const ed = r && r.record ? String(r.record.editorId || '') : ''; return !!ed && artifactRx.test(ed); } catch (e) { return false; }
  };
  const plainEntry = (e) => Object.keys(e).every((k) => k === 'baseId' || k === 'count' || e[k] === undefined || e[k] === null);

  // The seizure log (bank.json vaultSeized): every seized vault in full for seizeLogDays, keyed by actor, hold and the
  // first unpaid week, so staff can restore it and a crash between the two saves never pays the hold twice
  const seizedLog = () => { const d = data(); if (!d.vaultSeized || typeof d.vaultSeized !== 'object') d.vaultSeized = {}; return d.vaultSeized; };
  const pruneSeized = (now) => {
    const keep = Math.max(1, Number(V.seizeLogDays) || 30) * DAY;
    for (const [k, r] of Object.entries(seizedLog())) if (r && Number(r.at) > 0 && now - Number(r.at) > keep) delete seizedLog()[k];
  };
  const seizeKey = (a, zoneId, v) => `${(a >>> 0).toString(16)}:${zoneId}:${Number(v.arrearsSince) || 0}`;
  const itemsLine = (list) => { const p = P(); return list.map((e) => `${Number(e.count)}x ${p ? p.nameOfItem(Number(e.baseId) >>> 0) : (Number(e.baseId) >>> 0).toString(16)}`).join(', '); };

  // What a seizure sells: in 'debt' mode plain goods first, then special ones, only as many as cover the debt; in 'value' mode
  // everything. Artifacts and goods with no value are never sold. -> { sold, kept, value, credit }
  const saleOf = (v, owed) => {
    const mode = String(V.seizeCredit || 'debt') === 'value' ? 'value' : 'debt';
    const rows = (v.items || []).map((e, i) => ({ e, i, id: Number(e.baseId) >>> 0, n: Number(e.count) || 0, each: valueOf(e.baseId), plain: plainEntry(e) }));
    const order = rows.filter((r) => r.n > 0).sort((x, y) => (x.plain === y.plain ? x.i - y.i : x.plain ? -1 : 1));
    const sold = [], kept = []; let need = owed, value = 0;
    for (const r of order) {
      let k = 0;
      if (r.each > 0 && !isArtifact(r.id)) k = mode === 'value' ? r.n : (need > 0 ? Math.min(r.n, Math.ceil(need / r.each)) : 0);
      if (k > 0) { sold.push(Object.assign({}, r.e, { count: k })); value += k * r.each; need -= k * r.each; }
      if (r.n - k > 0) kept.push(Object.assign({}, r.e, { count: r.n - k }));
    }
    return { sold, kept, value, credit: mode === 'value' ? value : Math.min(owed, value), mode };
  };

  // The goods are sold to the hold: the log first, then the vault emptied, then the hold paid (the vault put back if that
  // fails); the goods not sold go back by parcel letter, or stay in the vault, tierless and free, if no letter can carry them
  const seize = (a, zone, all) => {
    const v = all[zone.id];
    if (typeof globalThis.__dboBaseValue !== 'function') { log(`bank: seizing the ${zone.id} vault of ${who(a)} waits for couriers.js (__dboBaseValue)`); return false; }
    if (artifactRx === undefined) { log(`bank: seizing the ${zone.id} vault of ${who(a)} waits for artifacts.json`); return false; }
    const now = Date.now(); pruneSeized(now);
    const key = seizeKey(a, zone.id, v);
    const owed = Math.floor(Number(v.owed) || 0);
    const prior = seizedLog()[key];
    // A seizure already paid whose vault came back (a crash before the character saved): finish it without paying again
    const replay = !!(prior && prior.paid);
    const sale = replay ? { sold: prior.sold, kept: prior.kept, value: prior.value, credit: prior.credit, mode: prior.mode } : saleOf(v, owed);
    if (!replay) {
      seizedLog()[key] = { at: now, actor: (a >>> 0).toString(16), zone: zone.id, arrearsSince: Number(v.arrearsSince) || 0, tier: v.tier, owed, mode: sale.mode,
        value: sale.value, credit: sale.credit, sold: sale.sold, kept: sale.kept, vault: JSON.parse(JSON.stringify(v)), paid: false };
      try { save(); } catch (e) { delete seizedLog()[key]; log(`bank: seizing the ${zone.id} vault of ${who(a)} could not write its log; tried again next hour`, e.message); return false; }
    }
    const held = () => Object.assign({}, { items: sale.kept.map((e) => Object.assign({}, e)), tier: '', held: true, since: now, where: zone.name, owed: 0, weeksOwed: 0, arrearsSince: 0, warned: [] });
    try {
      if (sale.kept.length) all[zone.id] = held(); else delete all[zone.id];
      saveVaults(a, all);
    } catch (e) {
      all[zone.id] = v; if (!replay) { delete seizedLog()[key]; try { save(); } catch (e2) { /* the log entry is unpaid and harmless */ } }
      log(`bank: seizing the ${zone.id} vault of ${who(a)} could not empty it; tried again next hour`, e.message); return false;
    }
    if (!replay) {
      if (!payHold(zone, sale.credit)) {
        all[zone.id] = v;
        try { saveVaults(a, all); } catch (e) { log(`bank: putting back the ${zone.id} vault of ${who(a)} failed`, e.message); }
        delete seizedLog()[key]; try { save(); } catch (e) { /* the log entry is unpaid and harmless */ }
        log(`bank: seizing the ${zone.id} vault of ${who(a)} could not pay the hold; tried again next hour`); return false;
      }
      seizedLog()[key].paid = true;
      try { save(); } catch (e) { log('bank: bank.json write failed after a seizure was paid', e.message); }
    }
    const since = dateText(Number(v.arrearsSince));
    const soldText = sale.mode === 'value'
      ? `has sold the goods in your vault for ${sale.credit} gold to the hold, for fees unpaid since ${since}. The debt is cleared and the vault is closed.`
      : `has sold goods from your vault for ${sale.credit} gold to cover the ${owed} gold owed for fees unpaid since ${since}. The debt is cleared and the vault is closed.`;
    let how = 'none';
    if (sale.kept.length) {
      // The vault is emptied first and the goods put back if the letter cannot be written, so they are never in both
      delete all[zone.id];
      let sent = false;
      try { saveVaults(a, all); sent = tell(a, zone, `The Bank of ${zone.name} ${soldText} The rest of your goods come back to you with this letter: ${itemsLine(sale.kept)}.`, { gold: 0, items: sale.kept.map((e) => Object.assign({}, e)) }); }
      catch (e) { sent = false; }
      if (sent) how = 'parcel';
      else {
        all[zone.id] = held();
        try { saveVaults(a, all); } catch (e) { log(`bank: keeping the rest of the ${zone.id} vault of ${who(a)} failed`, e.message); }
        how = 'held';
        tell(a, zone, `The Bank of ${zone.name} ${soldText} The rest of your goods are held for you: take them out at a bank of ${zone.name}.`);
      }
    } else tell(a, zone, `The Bank of ${zone.name} ${soldText}`);
    noteHolder(a);
    if (seizedLog()[key]) { seizedLog()[key].returned = how; try { save(); } catch (e) { /* the seizure stands */ } }
    for (const e of sale.sold) { const id = Number(e.baseId) >>> 0; const each = valueOf(id); audit(`BANK VAULT SEIZED ${who(a)} ${zone.id}: ${Number(e.count)}x ${P() ? P().nameOfItem(id) : id.toString(16)} (${id.toString(16)}) at ${each} = ${each * Number(e.count)}`); }
    audit(`BANK VAULT SEIZED ${who(a)} ${zone.id}: ${v.tier} vault, ${sale.sold.length} kind(s) of goods sold for ${sale.value} gold, ${sale.credit} to ${zone.id}, ${owed} gold owed cleared, unpaid since ${new Date(Number(v.arrearsSince)).toISOString()}; ${sale.kept.length} kind(s) ${how === 'parcel' ? 'sent back by letter' : how === 'held' ? 'held in the vault' : 'kept'}${replay ? ' (finished after a restart, the hold already paid)' : ''}`);
    return true;
  };
  // The letters before a seizure: only the latest one due is sent, so a character away for long gets one, not four. When the
  // shortest-notice letter goes out late, the seizure moves to that many days after it (bank review R6)
  const warn = (a, zone, v, now) => {
    const at = seizeAtOf(v); if (!at) return false;
    const sentAt = v.warnedAt && typeof v.warnedAt === 'object' ? v.warnedAt : {};
    const sent = Array.isArray(v.warned) ? v.warned : [];
    const due = warnDays().filter((d) => now >= at - d * DAY && !sent.includes(d));
    if (!due.length) return false;
    v.warned = sent.concat(due);
    v.warnedAt = Object.assign({}, sentAt); for (const d of due) v.warnedAt[d] = now;
    const shortest = Math.min(...warnDays());
    if (due.includes(shortest) && now + shortest * DAY > at) v.seizeAt = now + shortest * DAY;
    const by = seizeAtOf(v);
    const days = Math.max(1, Math.ceil((by - now) / DAY));
    tell(a, zone, `Your vault at the Bank of ${zone.name} is held for ${Math.floor(Number(v.owed) || 0)} gold unpaid. Pay it at a bank of ${zone.name} within ${days} day${days === 1 ? '' : 's'} (by ${dateText(by)}), or its goods are sold to the hold.`);
    audit(`BANK VAULT ${who(a)} warned of the ${zone.id} seizure on ${new Date(by).toISOString()} (${Math.min(...due)} day notice)`);
    return true;
  };
  // A seizure waits until the shortest-notice letter has had its days
  const warnedLongEnough = (v, now) => {
    const ds = warnDays(); if (!ds.length) return true;
    const shortest = Math.min(...ds); const at = v.warnedAt && Number(v.warnedAt[shortest]);
    return at > 0 && now - at >= shortest * DAY;
  };

  // Each week that fell due is paid if it can be, in full, else owed; a vault in arrears pays nothing more until settled.
  // The seizure clock runs from the first unpaid week. Nothing moves while the vaults are closed. Returns the vault, or null
  // when there is none (or it was seized)
  const settle = (a, zoneId, now) => {
    const all = vaultsOf(a); const v = all[zoneId]; const zone = zoneById(zoneId);
    if (!v || !v.tier || !zone) return v || null;
    now = now || Date.now();
    syncClock(now);
    if (!V.enabled) return v;
    let changed = catchUp(v);
    const cap = Math.max(1, Number(V.arrearsCapWeeks) || 1, Math.ceil((Number(V.seizeAfterDays) || 30) / 7));
    for (let i = 0; i < 520 && Number(v.paidUntil) <= now; i++) {
      const fee = weeklyOf(v);
      if (!(Number(v.owed) > 0) && feeFor(a, zone, fee, `a week of the ${v.tier} vault`)) {
        note(a, 'vault', fee, zone.name);
      } else {
        if (!(Number(v.arrearsSince) > 0)) { v.arrearsSince = Number(v.paidUntil); v.warned = []; v.warnedAt = {}; v.seizeAt = 0; }
        if ((Number(v.weeksOwed) || 0) < cap) {
          v.owed = (Number(v.owed) || 0) + fee; v.weeksOwed = (Number(v.weeksOwed) || 0) + 1;
          audit(`BANK VAULT ${who(a)} owes ${v.owed} gold for the ${zoneId} vault (${v.weeksOwed} week(s) unpaid)`);
        }
      }
      v.paidUntil = Number(v.paidUntil) + WEEK; changed = true;
    }
    if (Number(v.owed) > 0 && warn(a, zone, v, now)) changed = true;
    if (Number(v.owed) > 0 && seizeAtOf(v) && now >= seizeAtOf(v) && warnedLongEnough(v, now)) {
      if (changed) saveVaults(a, all);
      if (seize(a, zone, all)) return null;
      return v;
    }
    if (changed) saveVaults(a, all);
    return v;
  };
  const settleAll = (a) => { for (const zid of Object.keys(vaultsOf(a))) settle(a, zid); };
  const gone = (id) => { try { return typeof globalThis.__dboFormGone === 'function' && !!globalThis.__dboFormGone(id); } catch (e) { return false; } };
  // The tick stops itself once another bank.js load (a newer one, or a revert) has taken over (bank review R11)
  let activate = null;
  const feeTick = () => {
    if (globalThis.__dboBankActivate !== activate) return;
    syncClock();
    if (!V.enabled) return;
    const ids = new Set(onlineActors().map((x) => x >>> 0));
    let pruned = false;
    for (const k of Object.keys(holders())) { const id = parseInt(k, 16) >>> 0; if (id) ids.add(id); }
    for (const a of ids) {
      if (gone(a)) { if (holders()[a.toString(16)]) { delete holders()[a.toString(16)]; pruned = true; } continue; }
      try { settleAll(a); } catch (e) { log('bank: vault fees failed', e.message); }
    }
    if (pruned) { try { save(); } catch (e) { log('bank: bank.json write failed', e.message); } }
  };
  if (typeof every === 'function') every('bankVaultFees', 3600000, feeTick);
  // A first tick a few minutes after each load, so a day of many reloads still gets its ticks (bank review R6)
  { const t = setTimeout(() => { try { feeTick(); } catch (e) { log('bank: vault fees failed', e.message); } }, Math.max(1, Number(V.firstTickMinutes) || 5) * 60000); if (t && typeof t.unref === 'function') t.unref(); }
  // At login: the fees, and any word about a vault that came while they were away
  globalThis.__dboBankLogin = (a) => {
    try { settleAll(a); } catch (e) { log('bank: vault fees at login failed', e.message); }
    let list = null; try { list = mp.get(a, NOTICES); } catch (e) { list = null; }
    if (Array.isArray(list) && list.length) { for (const t of list) personal(a, String(t)); mp.set(a, NOTICES, []); }
  };

  const vaultRent = (a, tierId) => {
    if (!V.enabled) return { ok: false, text: closedText };
    if (!atBank(a)) return { ok: false, text: notAtBank };
    const zone = zoneOfBank(a); if (!zone) return { ok: false, text: noHold };
    const t = tierById(tierId); if (!t) return { ok: false, text: `Rent one of: ${tierList().map((x) => `${x.id} (${x.weight} weight, ${x.weekly} gold a week)`).join(', ')}.` };
    const had = settle(a, zone.id);
    const now = Date.now();
    if (had && had.tier) {
      if (Number(had.owed) > 0) return { ok: false, text: `Settle the ${had.owed} gold you owe for this vault first.` };
      if (had.tier === t.id) return { ok: false, text: `You already rent a ${t.name} here.` };
      if (usedOf(had) > Number(t.weight)) return { ok: false, text: `Your goods here weigh ${usedOf(had)}; a ${t.name} holds ${t.weight}.` };
    } else if (had && usedOf(had) > Number(t.weight)) return { ok: false, text: `Your goods held here weigh ${usedOf(had)}; a ${t.name} holds ${t.weight}.` };
    // A change of tier starts a new week; what is left of the paid week counts towards it, and nothing is paid back
    const credit = had && had.tier ? Math.floor(weeklyOf(had) * Math.max(0, Math.min(1, (Number(had.paidUntil) - now) / WEEK))) : 0;
    const price = Math.max(0, Math.floor(Number(t.weekly)) - credit);
    if (!feeFor(a, zone, price, `renting a ${t.id} vault`)) return { ok: false, text: `A ${t.name} costs ${price} gold for its first week, and you have ${balanceOf(a)} banked and ${goldOf(a)} carried.` };
    const fresh = vaultsOf(a);
    const v = Object.assign(fresh[zone.id] || { items: [] }, { tier: t.id, cap: Number(t.weight), weekly: Math.floor(Number(t.weekly)), since: now, paidUntil: now + WEEK, owed: 0, weeksOwed: 0, arrearsSince: 0, warned: [], warnedAt: {}, seizeAt: 0, held: false, closedSeen: Number(vclock().closedTotal) || 0, where: zone.name });
    fresh[zone.id] = v; saveVaults(a, fresh); noteHolder(a);
    note(a, 'vault', price, zone.name);
    audit(`BANK VAULT ${who(a)} rents a ${t.id} vault (${t.weight} weight) in ${zone.id}${had && had.tier ? `, was ${had.tier}` : ''}, paid ${price}`);
    return { ok: true, text: `You rent a ${t.name} in ${zone.name}: ${t.weight} weight, ${t.weekly} gold a week, taken from your account (or what you carry). Paid ${price} gold.` };
  };
  // Paying and taking out stay open while the vaults are closed, so the off switch never strands goods (bank review R5)
  const vaultPay = (a) => {
    if (!atBank(a)) return { ok: false, text: notAtBank };
    const zone = zoneOfBank(a); if (!zone) return { ok: false, text: noHold };
    const v = settle(a, zone.id);
    if (!v || !(Number(v.owed) > 0)) return { ok: false, text: 'You owe nothing for a vault here.' };
    const n = Math.floor(Number(v.owed));
    if (!feeFor(a, zone, n, 'vault arrears')) return { ok: false, text: `You owe ${n} gold, and have ${balanceOf(a)} banked and ${goldOf(a)} carried.` };
    const all = vaultsOf(a);
    if (all[zone.id]) { Object.assign(all[zone.id], { owed: 0, weeksOwed: 0, arrearsSince: 0, warned: [], warnedAt: {}, seizeAt: 0 }); saveVaults(a, all); }
    note(a, 'vault', n, zone.name);
    return { ok: true, text: `Paid the ${n} gold you owed. Your vault in ${zone.name} is open to you again.` };
  };
  const vaultEnd = (a) => {
    if (!V.enabled) return { ok: false, text: closedText };
    if (!atBank(a)) return { ok: false, text: notAtBank };
    const zone = zoneOfBank(a); if (!zone) return { ok: false, text: noHold };
    const v = settle(a, zone.id);
    if (!v || !v.tier) return { ok: false, text: 'You rent no vault here.' };
    if (Number(v.owed) > 0) return { ok: false, text: `Settle the ${v.owed} gold you owe first.` };
    if ((v.items || []).length) return { ok: false, text: 'Empty the vault before you give it up.' };
    const all = vaultsOf(a); delete all[zone.id]; saveVaults(a, all); noteHolder(a);
    audit(`BANK VAULT ${who(a)} gave up the ${v.tier} vault in ${zone.id}`);
    return { ok: true, text: `You gave up your vault in ${zone.name}. The week already paid is not returned.` };
  };

  const STORE_VETO = (a, id, n) => { try { return typeof globalThis.__dboTradeItemVeto === 'function' ? globalThis.__dboTradeItemVeto(a, id, n) || null : null; } catch (e) { return null; } };
  const countOf = (raw, available) => { const s = String(raw == null ? '' : raw).trim().toLowerCase(); if (s === '' || s === 'all') return available; return /^\d+$/.test(s) ? Number(s) : 0; };
  const vaultStore = (a, baseRaw, countRaw) => {
    if (!V.enabled) return { ok: false, text: closedText };
    if (!atBank(a)) return { ok: false, text: notAtBank };
    const zone = zoneOfBank(a); if (!zone) return { ok: false, text: noHold };
    const p = P(); if (!p || typeof p.takeItems !== 'function') return { ok: false, text: 'The vault clerk is away. Try again later.' };
    const v = settle(a, zone.id);
    if (!v || !v.tier) return { ok: false, text: `You rent no vault in ${zone.name}.` };
    const id = Number(baseRaw) >>> 0;
    if (!id || !p.sendableBase(id)) return { ok: false, text: 'The clerk will not take that into a vault.' };
    const have = p.looseCount(a, id); const n = countOf(countRaw, have);
    if (!(n >= 1) || n > have) return { ok: false, text: have ? `Store between 1 and the ${have} you carry that you are not wearing.` : 'You carry none of that that you are not wearing.' };
    const why = STORE_VETO(a, id, n); if (why) return { ok: false, text: why };
    const w = weightOf(id); if (w === null) return { ok: false, text: 'The clerk cannot weigh that.' };
    const used = usedOf(v); const cap = capOf(v);
    if (used + w * n > cap + 1e-6) return { ok: false, text: `That weighs ${round2(w * n)}; your vault holds ${cap} and ${round2(used)} is used.` };
    const items = Array.isArray(v.items) ? v.items : [];
    const taken = p.takeItems(a, id, n); if (!taken) return { ok: false, text: 'The clerk could not take that. Nothing was changed.' };
    const next = items.map((e) => Object.assign({}, e));
    for (const t of taken) {
      const hit = plainEntry(t) && next.find((e) => (Number(e.baseId) >>> 0) === id && plainEntry(e));
      if (hit) hit.count = (Number(hit.count) || 0) + Number(t.count); else next.push(Object.assign({}, t, { baseId: id }));
    }
    if (next.length > V.maxStacks) { p.giveEntries(a, taken); return { ok: false, text: `A vault keeps at most ${V.maxStacks} kinds of goods.` }; }
    // The goods are out of the pack: if the vault cannot be written they go straight back (bank review R8)
    try {
      const all = vaultsOf(a); if (!all[zone.id]) throw new Error('the vault is gone');
      all[zone.id].items = next; saveVaults(a, all);
    } catch (e) {
      try { p.giveEntries(a, taken); } catch (e2) { log(`bank: giving back ${n}x ${id.toString(16)} to ${who(a)} failed`, e2.message); }
      log('bank: vault write failed', e.message);
      return { ok: false, text: 'The clerk could not write that into your vault. Your goods are returned.' };
    }
    audit(`BANK VAULT ${who(a)} stored ${n}x ${p.nameOfItem(id)} (${id.toString(16)}) in ${zone.id} (${round2(used + w * n)}/${cap})`);
    return { ok: true, text: `Stored ${n} ${p.nameOfItem(id)} in your vault in ${zone.name} (${round2(used + w * n)} of ${cap} weight).` };
  };
  // By the vault's row (as listed) and its base, so a stale window never takes the wrong goods
  const vaultTake = (a, rowRaw, baseRaw, countRaw) => {
    if (!atBank(a)) return { ok: false, text: notAtBank };
    const zone = zoneOfBank(a); if (!zone) return { ok: false, text: noHold };
    const p = P(); if (!p || typeof p.giveEntries !== 'function') return { ok: false, text: 'The vault clerk is away. Try again later.' };
    const v = settle(a, zone.id);
    if (!v || !(v.items || []).length) return { ok: false, text: `You keep nothing in a vault in ${zone.name}.` };
    const before = v.items.map((x) => Object.assign({}, x));
    if (Number(v.owed) > 0) return { ok: false, text: `Your vault is held for ${v.owed} gold unpaid. Pay it to take anything out.` };
    const row = Number(rowRaw); const e = Number.isInteger(row) ? v.items[row] : null;
    if (!e || (baseRaw !== undefined && baseRaw !== null && baseRaw !== '' && (Number(e.baseId) >>> 0) !== (Number(baseRaw) >>> 0))) return { ok: false, text: 'That is no longer in your vault.' };
    const n = countOf(countRaw, Number(e.count));
    if (!(n >= 1) || n > Number(e.count)) return { ok: false, text: `Take between 1 and ${e.count}.` };
    const all = vaultsOf(a); if (!all[zone.id]) return { ok: false, text: 'That is no longer in your vault.' };
    const items = all[zone.id].items.map((x) => Object.assign({}, x));
    const out = Object.assign({}, items[row], { count: n });
    items[row].count = Number(items[row].count) - n;
    all[zone.id].items = items.filter((x) => Number(x.count) > 0);
    // Goods held after a seizure (no tier) leave no vault behind once taken
    const emptied = !all[zone.id].tier && !all[zone.id].items.length;
    if (emptied) delete all[zone.id];
    saveVaults(a, all);
    try { p.giveEntries(a, [out]); } catch (err) {
      const back = vaultsOf(a); back[zone.id] = Object.assign({}, v, { items: before }); saveVaults(a, back);
      log('bank: vault give failed', err.message);
      return { ok: false, text: 'The clerk could not hand that over. It stays in your vault.' };
    }
    if (emptied) noteHolder(a);
    const id = Number(out.baseId) >>> 0;
    audit(`BANK VAULT ${who(a)} took ${n}x ${p.nameOfItem(id)} (${id.toString(16)}) out of ${zone.id}`);
    return { ok: true, text: `Took ${n} ${p.nameOfItem(id)} out of your vault in ${zone.name}.` };
  };

  // What the panel and the chat show: this hold's vault in full, the others only by name
  const vaultView = (a) => {
    const s = S.at.get(a >>> 0); const zone = s && s.zone ? zoneById(s.zone) : null;
    const p = P(); const name = (id) => (p ? p.nameOfItem(id) : (id >>> 0).toString(16));
    const out = { enabled: !!V.enabled, seizeCredit: String(V.seizeCredit || 'debt') === 'value' ? 'value' : 'debt', zone: zone ? zone.id : '', zoneName: zone ? zone.name : '', tiers: tierList(), rented: false, held: false, elsewhere: [] };
    if (zone) {
      const v = settle(a, zone.id);
      if (v && v.tier) Object.assign(out, { rented: true, tier: v.tier, cap: capOf(v), used: usedOf(v), weekly: weeklyOf(v), paidUntil: Number(v.paidUntil) || 0, owed: Math.floor(Number(v.owed) || 0), seizeAt: Number(v.owed) > 0 ? seizeAtOf(v) : 0 });
      else if (v && (v.items || []).length) Object.assign(out, { held: true, used: usedOf(v) });
      out.items = ((v && v.items) || []).map((e, i) => ({ row: i, baseId: Number(e.baseId) >>> 0, name: name(Number(e.baseId) >>> 0), count: Number(e.count) || 0, weight: weightOf(e.baseId) || 0, special: !Object.keys(e).every((k) => k === 'baseId' || k === 'count') }));
      const counts = new Map();
      try { for (const e of (mp.get(a, 'inventory') || {}).entries || []) { const id = Number(e.baseId) >>> 0; if (!e.worn && !e.wornLeft && Number(e.count) > 0 && p && p.sendableBase(id)) counts.set(id, (counts.get(id) || 0) + Number(e.count)); } } catch (e) { /* no pack */ }
      out.carry = [...counts].map(([id, n]) => ({ baseId: id, name: name(id), count: n, weight: weightOf(id) || 0 })).sort((x, y) => x.name.localeCompare(y.name)).slice(0, 200);
    }
    for (const zid of Object.keys(vaultsOf(a))) {
      if (zone && zid === zone.id) continue;
      const z = zoneById(zid); const v = settle(a, zid); if (!v) continue;
      out.elsewhere.push({ zone: zid, name: z ? z.name : zid, tier: v.tier || '', items: (v.items || []).length, used: usedOf(v), owed: Math.floor(Number(v.owed) || 0) });
    }
    return out;
  };

  // ---- staff: the vaults are within reach of the item sweeps, and readable -------------------------------------------------
  // How many of a base a character keeps in all their vaults
  const vaultHas = (a, base) => {
    const id = Number(base) >>> 0; let n = 0;
    for (const v of Object.values(vaultsOf(a))) for (const e of (v && v.items) || []) if ((Number(e.baseId) >>> 0) === id) n += Number(e.count) || 0;
    return n;
  };
  // Takes up to n of a base out of a character's vaults, debt or not, in one write; returns how many were taken (0 and
  // nothing changed if the write fails). For restitution.js, gearstrip.js and sprstrip.js (bank review R10)
  const vaultTakeStaff = (a, base, n, why) => {
    const id = Number(base) >>> 0; let left = Math.max(0, Math.floor(Number(n) || 0));
    if (!id || !left) return 0;
    const all = vaultsOf(a); const from = [];
    for (const [zid, v] of Object.entries(all)) {
      if (!v || !Array.isArray(v.items)) continue;
      const items = [];
      for (const e of v.items) {
        const k = (Number(e.baseId) >>> 0) === id ? Math.min(left, Number(e.count) || 0) : 0;
        if (k > 0) { left -= k; from.push(`${k} from ${zid}`); }
        if ((Number(e.count) || 0) - k > 0) items.push(k ? Object.assign({}, e, { count: Number(e.count) - k }) : e);
      }
      v.items = items;
      if (!v.tier && !items.length) delete all[zid];
    }
    const took = Math.max(0, Math.floor(Number(n) || 0)) - left;
    if (!took) return 0;
    try { saveVaults(a, all); } catch (e) { log(`bank: staff take from the vaults of ${who(a)} failed`, e.message); return 0; }
    noteHolder(a);
    audit(`BANK VAULT STAFF took ${took}x ${id.toString(16)} from the vaults of ${who(a)} (${from.join(', ')}) for ${String(why || 'staff')}`);
    return took;
  };
  globalThis.__dboVaultHas = (a, base) => { try { return vaultHas(a >>> 0, base); } catch (e) { return 0; } };
  globalThis.__dboVaultTake = (a, base, n, why) => { try { return vaultTakeStaff(a >>> 0, base, n, why); } catch (e) { log('bank: staff vault take failed', e.message); return 0; } };
  // Every vault of a character as it stands, never settled or changed
  const vaultLines = (a) => {
    const p = P(); const name = (id) => (p ? p.nameOfItem(id) : (id >>> 0).toString(16));
    const out = [];
    for (const [zid, v] of Object.entries(vaultsOf(a))) {
      if (!v) continue;
      const z = zoneById(zid);
      const state = v.tier ? `${v.tier}, ${usedOf(v)}/${capOf(v)} weight, paid to ${Number(v.paidUntil) ? dateText(Number(v.paidUntil)) : '-'}${Number(v.owed) > 0 ? `, owes ${Math.floor(Number(v.owed))} since ${dateText(Number(v.arrearsSince))}, seizure ${dateText(seizeAtOf(v))}` : ''}` : 'held after a seizure, no tier';
      out.push(`${z ? z.name : zid}: ${state}`);
      const items = (v.items || []).map((e) => `${Number(e.count)}x ${name(Number(e.baseId) >>> 0)} (${(Number(e.baseId) >>> 0).toString(16)})${plainEntry(e) ? '' : ' *'}`);
      if (items.length) out.push(`  ${items.join(', ')}`);
    }
    return out;
  };
  const isLeadGm = (a) => {
    try {
      const t = typeof api.staffTierOf === 'function' ? api.staffTierOf(a) : null; const R = api.TIER_RANK || {};
      return !!t && (Number(R[t]) || 0) >= (Number(R.leadgm) || 2);
    } catch (e) { return false; }
  };
  // A character online by name or #TAG (gamemode.js findByName), or a vault holder offline by #TAG or actor id
  const findHolder = (q) => {
    q = String(q || '').trim(); if (!q) return 0;
    try { if (typeof api.findByName === 'function') { const a = api.findByName(q); if (a) return a >>> 0; } } catch (e) { /* offline */ }
    const tag = (q.match(/#([a-z0-9]{4})$/i) || [])[1]; const hex = q.toLowerCase();
    for (const k of Object.keys(holders())) {
      const id = parseInt(k, 16) >>> 0; if (!id) continue;
      if (k === hex) return id;
      try { if (tag && String(mp.get(id, 'private.charTag') || '').toLowerCase() === tag.toLowerCase()) return id; } catch (e) { /* gone */ }
    }
    return 0;
  };
  // Staff restore a seizure from the log: the goods sold go back by parcel letter, the hold gives back what it was credited
  // when it can, and the debt stays cleared
  const restoreSeizure = (staff, key) => {
    const r = seizedLog()[key];
    if (!r || !r.paid) return `No paid seizure ${key} in the log (kept ${V.seizeLogDays} days).`;
    if (r.restored) return `Seizure ${key} was already restored on ${new Date(r.restored).toISOString()}.`;
    const a = parseInt(r.actor, 16) >>> 0; const zone = zoneById(r.zone);
    if (!a || !zone) return `Seizure ${key}: the character or the hold is gone.`;
    if (!(r.sold || []).length) return `Seizure ${key} sold nothing.`;
    r.restored = Date.now();
    try { save(); } catch (e) { delete r.restored; return 'bank.json could not be written; nothing restored.'; }
    const sent = tell(a, zone, `The Bank of ${zone.name} returns the goods it sold from your vault: ${itemsLine(r.sold)}.`, { gold: 0, items: r.sold.map((e) => Object.assign({}, e)) });
    if (!sent) { delete r.restored; try { save(); } catch (e) { /* unchanged */ } return 'The letter could not be written; nothing restored.'; }
    const back = Math.min(Math.floor(Number(r.credit) || 0), zoneGold(zone));
    const took = back > 0 && zoneTake(zone, back);
    audit(`BANK VAULT RESTORED ${who(a)} ${r.zone}: seizure ${key} given back by letter (${(r.sold || []).length} kind(s)) by ${who(staff)}; ${took ? back : 0} of ${r.credit} gold taken back from ${r.zone}`);
    return `Seizure ${key} restored: ${itemsLine(r.sold)} sent by letter to ${who(a)}; ${took ? back : 0} of ${r.credit} gold taken back from ${zone.name}.`;
  };
  if (typeof registerChatCommand === 'function') registerChatCommand('vaults', (a, args) => {
    if (!isLeadGm(a)) return personal(a, 'Lead GM and above only.');
    const raw = String(args || '').trim();
    const m = raw.match(/^restore\s+(\S+)$/i);
    if (m) return personal(a, restoreSeizure(a, m[1]));
    if (/^seized\b/i.test(raw)) {
      const q = raw.replace(/^seized\s*/i, ''); const id = q ? findHolder(q) : 0; const hex = id ? id.toString(16) : '';
      const list = Object.entries(seizedLog()).filter(([, r]) => !hex || r.actor === hex).slice(-10);
      if (!list.length) return personal(a, 'No seizures in the log.');
      for (const [k, r] of list) personal(a, `${k}: ${new Date(r.at).toISOString().slice(0, 16)} ${r.tier} in ${r.zone}, owed ${r.owed}, credited ${r.credit} (${r.mode}), sold ${itemsLine(r.sold || [])}${(r.kept || []).length ? `; ${r.returned || 'kept'} ${itemsLine(r.kept)}` : ''}${r.paid ? '' : ' (unpaid)'}${r.restored ? ' (restored)' : ''}`);
      return;
    }
    const t = findHolder(raw);
    if (!t) return personal(a, 'Usage: /vaults <name|#TAG|actor id>, /vaults seized [<name|#TAG>], /vaults restore <key>. A character offline is found only if they keep a vault.');
    const lines = vaultLines(t);
    personal(a, `Vaults of ${who(t)}: ${lines.length ? '' : 'none'}`);
    for (const l of lines) personal(a, l);
  }, { admin: true, help: '<name|#TAG> a character\'s vaults, read only; seized, restore <key> (Lead GM+)' });

  // ---- the panel and the chat bank -------------------------------------------------------------------------------------
  const hasPanel = (a) => { const c = S.caps.get(a >>> 0); return !!c && c.has('bank'); };
  // A panel that draws vaults says 'bankVault'; vaults are used only there, and any other client is told it needs the update
  const hasVaultPanel = (a) => { const c = S.caps.get(a >>> 0); return !!c && c.has('bankVault'); };
  const vaultPanelOnly = 'Vaults for your goods open in the bank window, which needs the latest client update.';
  // While the vaults are closed, a holder still sees theirs (to pay and take out); nobody else is shown them
  const showVault = (a) => hasVaultPanel(a) && (V.enabled || Object.keys(vaultsOf(a)).length > 0);
  const openPanel = (a, result, kind) => {
    const nonce = `${(a >>> 0).toString(16)}-${Date.now().toString(36)}`;
    S.nonces.set(a >>> 0, nonce);
    const at = S.at.get(a >>> 0);
    openWidget(a, {
      type: 'bank', id: WIDGET_ID, nonce, where: at ? at.where : '',
      balance: balanceOf(a), carried: goldOf(a), history: historyOf(a), treasuries: treasuriesOf(a),
      result: result || '', resultKind: kind || '',
      vault: showVault(a) ? vaultView(a) : undefined,
    }, true);
  };
  const chatBank = (a) => {
    personal(a, `Bank: your balance is ${balanceOf(a)} gold, and you carry ${goldOf(a)}. /bank deposit <gold|all>, /bank withdraw <gold|all>.`);
    if (V.enabled) personal(a, vaultPanelOnly);
    for (const t of treasuriesOf(a)) personal(a, `${t.name}: ${t.balance} gold (${t.why}). /bank treasury ${t.key.split(':')[1]} <gold|all> pays in; no one can take it out.`);
  };

  // The activator: remember where the character stands and the teller's own hold, then open the panel or the chat bank
  activate = (target, caster) => {
    if (!isBank(target)) return false;
    let where = '', zone = '';
    try { zone = holdOfTeller(target) || ''; } catch (e) { zone = ''; }
    try { const z = zoneById(zone || zoneOfActor(caster)); where = z ? z.name : ''; if (zone && !z) zone = ''; } catch (e) { /* unnamed */ }
    S.at.set(caster >>> 0, { bank: target >>> 0, since: Date.now(), where, zone });
    if (hasPanel(caster)) openPanel(caster); else chatBank(caster);
    if (hasPanel(caster) && !hasVaultPanel(caster) && V.enabled) personal(caster, vaultPanelOnly);
    return true;
  };
  globalThis.__dboBankActivate = activate;
  syncClock();

  // A UI's panels go with its session (review C6); the HUD says them again at the next login
  globalThis.__dboBankLeave = (a) => { S.caps.delete(a >>> 0); S.at.delete(a >>> 0); S.nonces.delete(a >>> 0); };
  onUi('uiCaps', (a, args) => { S.caps.set(a >>> 0, new Set((args || []).map(String))); });
  const fresh = (a, args) => S.nonces.get(a >>> 0) === String((args || [])[0] || '');
  const answer = (a, r) => (hasPanel(a) && S.nonces.has(a >>> 0) ? openPanel(a, r.text, r.ok ? 'ok' : 'refused') : personal(a, r.text));
  onUi('bankDeposit', (a, args) => { if (fresh(a, args)) answer(a, deposit(a, args[1])); });
  onUi('bankWithdraw', (a, args) => { if (fresh(a, args)) answer(a, withdraw(a, args[1])); });
  onUi('bankTreasury', (a, args) => { if (fresh(a, args)) answer(a, payIn(a, String(args[1] || ''), args[2])); });
  onUi('bankRent', (a, args) => { if (fresh(a, args) && hasVaultPanel(a)) answer(a, vaultRent(a, args[1])); });
  onUi('bankVaultPay', (a, args) => { if (fresh(a, args) && hasVaultPanel(a)) answer(a, vaultPay(a)); });
  onUi('bankVaultEnd', (a, args) => { if (fresh(a, args) && hasVaultPanel(a)) answer(a, vaultEnd(a)); });
  onUi('bankStore', (a, args) => { if (fresh(a, args) && hasVaultPanel(a)) answer(a, vaultStore(a, args[1], args[2])); });
  onUi('bankTake', (a, args) => { if (fresh(a, args) && hasVaultPanel(a)) answer(a, vaultTake(a, args[1], args[2], args[3])); });
  onUi('bankClose', (a) => { S.nonces.delete(a >>> 0); closeWidget(a, WIDGET_ID); });

  registerChatCommand('bank', (a, args) => {
    const [sub, x, y] = String(args || '').trim().split(/\s+/);
    const s = (sub || '').toLowerCase();
    if (!s) { if (!atBank(a)) return personal(a, `${notAtBank} Your balance is ${balanceOf(a)} gold.`); return hasPanel(a) ? openPanel(a) : chatBank(a); }
    if (s === 'deposit') return personal(a, deposit(a, x).text);
    if (s === 'withdraw') return personal(a, withdraw(a, x).text);
    if (s === 'treasury') return personal(a, payIn(a, x, y).text);
    if (['vault', 'rent', 'pay', 'store', 'take'].includes(s)) return personal(a, V.enabled ? vaultPanelOnly : closedText);
    personal(a, 'Usage at a bank: /bank, /bank deposit <gold|all>, /bank withdraw <gold|all>, /bank treasury <name> <gold|all>');
  }, { help: 'at a bank: your account (the same in every town); deposit, withdraw, or pay into a treasury you answer for' });

  log(`bank loaded: ${bankBases().size} bank activator base(s), ${Object.keys(data().factions).length} faction treasury balance(s), vaults ${V.enabled ? tierList().map((t) => `${t.weight}/${t.weekly}g`).join(' ') : 'closed'}${zoneOfCell ? '' : ' (no zoneOfCell: no bank keeps vaults)'}`);
  return { balanceOf, treasuriesOf, deposit, withdraw, payIn, vaultRent, vaultPay, vaultEnd, vaultStore, vaultTake, vaultView, settle, weightOf, vaultHas, vaultTakeStaff, vaultLines, restoreSeizure, saleOf };
};
