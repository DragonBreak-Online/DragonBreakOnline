// Hunting contracts: the hold pays for dangerous work, out of its own treasury. Standing contracts
// are drawn from the creatures that actually spawn in the zone, so a Bruma notice never asks for a
// horker. Officials post their own with /contract post. Loaded by gamemode.js like champions.js.
// Players find, take and give up work on the Contracts tab of the expedition board (Nate, 2026-09-30); /contract stays.
// Nate, 17 Oct: a hold's standing (automatic) contracts are taken only by its citizens where it grants citizenship, pay
// what its officials set per danger tier (/contract price), and commit at most a weekly budget (/contract budget, UTC
// week from Monday); /contract standing on|off stops them. Work an official posts by hand is open to all and outside the
// budget. Anyone reads the terms with /contract status.
// Nat, 25 Oct (ticket 0414, Bruma's treasurer: "add Ogres ... there is only a single bear within the county"): every creature
// a hold's spots really put down is work, undead and goblins included; officials post from the Court tab too, under a weekly
// posting budget and a daily cap each; and commissions buy goods for the hold (N of an item at a price each), handed in at
// the board, the goods into the hold's treasury chest.
'use strict';

module.exports = (api) => {
  const { mp, log, personal, audit, display, who, cfg, giveItem, registerChatCommand, zones, ranksOf, profileOf, saveSoon, discordOf, onUi, zoneOfActor, every } = api;
  const fs = require('fs');
  const path = require('path');

  const CFG = Object.assign({
    enabled: true,
    // Nate, 5 Oct: "Contracts need to be per player. Add more contracts." 3 -> 6 notices per hold, and 24 -> 12 hours, so
    // the board turns over twice as fast now that a finished notice stays up for the other hunters
    perZone: 6,
    // Kills asked for, by how dangerous the quarry is
    countRange: [4, 10],
    // Gold per kill by danger tier, before the count
    rewardPerKill: { 1: 12, 2: 25, 3: 60 },
    expiryHours: 12,
    // Nate, 5 Oct: a hunter may hold up to this many contracts at once, each notice once
    maxActive: 3,
    // Nate, 5 Oct: "make sure treasuries don't get bled dry". No take or new notice may leave a hold's treasury under
    // max(gold, share x its balance): boards shrink instead of draining it
    treasuryFloor: { gold: 200, share: 0.25 },
    // A champion kill counts for this many
    championWorth: 2,
    // Nate, 17 Oct (Ohoom's suggestion; Bruma paid ~17,100 gold a week to standing contracts against ~2,100 of tax):
    // a hold's standing contracts are for its own citizens (citizenship.js), where the hold grants citizenship at all
    citizensOnly: true,
    // Gold a hold's standing contracts may commit in one UTC week (Monday 00:00), each hunter's copy counted when taken;
    // its officials change it with /contract budget. 0: no standing contract is paid
    weeklyBudget: 1000,
    budgetMax: 100000,
    // What an official may set the pay per kill to (/contract price), for each danger tier
    priceBounds: { min: 1, max: 200 },
    // Nate, 18 Oct ("bounties pay back, not an expense but a transaction"): the hold claims the pelts and hides of every
    // contract kill and sells them on, so holdShare of their value goes back into its treasury. A creature with no pelt
    // (skeevers, mudcrabs) pays as before. 0 turns it off
    holdShare: 0.75,
    // A kind needs this many spawn spots in a hold before work is posted for it (config 3, so a lone ice wraith is no contract)
    minSpots: 1,
    // At most this many standing notices of a danger tier on a hold's board (config { 3: 2 }, so ogres and trolls do not
    // crowd out the rest)
    tierLimit: {},
    // Gold a hold's hand-posted work and commissions may commit in one UTC week (config 2000); its tax-setters change it
    postBudget: 100000,
    // Notices and commissions one official may post in a day, UTC (config 3); 0: no cap
    postsPerDay: 0,
    // Commissions: hours up, the most a hold pays for an item against its base value, and what may be asked for
    commissionHours: 48,
    commissionValueMult: 1.5,
    commissionMaxCount: 200,
    commissionCategories: ['Weapons', 'Armor', 'Clothing', 'Arrows', 'Potions', 'Food', 'Ingredients', 'Misc'],
  }, cfg.contracts || {});

  // How dangerous each creature kind is: tier 3 is worth real money and real risk
  const DANGER = {
    chicken: 0, cow: 0, hare: 0, dog: 0, deer: 0, elk: 0, goat: 0, fox: 0,
    mudcrab: 1, skeever: 1, slaughterfish: 1, horker: 1, rat: 1, boar: 1, skeleton: 1, zombie: 1, goblin: 1,
    wolf: 1, frostbitespider: 2, sabrecat: 2, bear: 2, riekling: 2, netch: 2, mountainlion: 2, icewraith: 2, chaurus: 2, draugr: 2,
    werebear: 3, troll: 3, giant: 3, mammoth: 3, lurker: 3, ogre: 3, minotaur: 3,
  };
  const PLURAL = { wolf: 'wolves', fox: 'foxes', sabrecat: 'sabre cats', frostbitespider: 'frostbite spiders', mudcrab: 'mudcrabs', skeever: 'skeevers', troll: 'trolls', bear: 'bears', giant: 'giants', mammoth: 'mammoths', riekling: 'rieklings', netch: 'netches', horker: 'horkers', slaughterfish: 'slaughterfish', lurker: 'lurkers', werebear: 'werebears',
    mountainlion: 'mountain lions', icewraith: 'ice wraiths', chaurus: 'chaurus', draugr: 'draugr' };
  const SINGULAR = { mountainlion: 'mountain lion', icewraith: 'ice wraith', sabrecat: 'sabre cat', frostbitespider: 'frostbite spider' };
  const single = (kind) => SINGULAR[kind] || kind;
  const aOrAn = (word) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
  // What an official types for a kind: its key, its name or its plural, spaces or not ("mountain lions" is mountainlion)
  const kindFromWords = (text) => {
    const t = String(text || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!t) return '';
    return Object.keys(DANGER).find((k) => k === t || single(k).replace(/[^a-z]/g, '') === t || plural(k).replace(/[^a-z]/g, '') === t) || t;
  };
  const GOLD_BASE = 0x0000000f;
  const FILE = path.resolve('contracts.json');
  const SPAWNS = path.resolve('NPC-Spawns.json');
  // A hold's fauna is drawn from this far around its capital, roughly a hold's worth of ground
  const CAPITAL_REACH = 45000;

  const OFF_TEXT = 'Hunting contracts are closed for now. The expedition boards post no hunting work.';

  const plural = (kind) => PLURAL[kind] || `${kind}s`;
  const zoneList = () => [].concat(zones.holds || [], zones.strongholds || [], zones.regions || []);
  const zoneById = (id) => zoneList().find((z) => z.id === String(id).toLowerCase()) || null;

  const state = (() => {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return { contracts: [], taken: {} }; }
  })();
  if (!Array.isArray(state.contracts)) state.contracts = [];
  if (!state.taken || typeof state.taken !== 'object') state.taken = {};
  // Per hold, what its officials set and what its standing work committed this week:
  // state.holds[zone] = { prices: { 1, 2, 3 }?, budget?, standing?, week, spent, by, at }; an unset field follows the config
  if (!state.holds || typeof state.holds !== 'object') state.holds = {};
  // A kill would otherwise write the file on every hit of progress, per player
  const save = () => saveSoon(FILE, () => JSON.stringify(state, null, 2));
  // Whenever gold moves: the file must already say so, or a crash inside the debounce brings the notice back to pay twice
  const saveNow = () => (typeof api.saveNow === 'function' ? api.saveNow : saveSoon)(FILE, () => JSON.stringify(state, null, 2));

  // Notices from before the reward was set aside hold nothing, so they would pay nothing and could still be the
  // exploit's own (nobody recorded who posted them). They are dropped; no gold was ever taken for them, and refresh()
  // puts fresh work up. Anyone holding one is released.
  {
    const legacy = state.contracts.filter((c) => c.held === undefined);
    if (legacy.length) {
      const ids = new Set(legacy.map((c) => c.id));
      state.contracts = state.contracts.filter((c) => !ids.has(c.id));
      for (const key of Object.keys(state.taken)) {
        const left = [].concat(state.taken[key] || []).filter((w) => w && !ids.has(w.id));
        if (left.length) state.taken[key] = left; else delete state.taken[key];
      }
      save();
      log(`contracts: dropped ${legacy.length} notice(s) posted before rewards were set aside`);
    }
  }

  // What a creature is, by its own record. A wild:<kind> spot is named after the first creature of its leveled list, but
  // wildlife.js places one entry of that list picked by level: a Bruma "wolf" spot puts down a rat where the pick is
  // "low" and an ogre or a troll elsewhere, and most Skyrim "skeever" spots a bear or a sabre cat. So the tag let a rat
  // count for a wolf contract (#bugs, 1 Oct 2026). The kind is the first creature word in the editor id
  // (EncFrostbiteSpiderGiant is a spider, EncMudcrabGiant a mudcrab, dunPOITrappedWolf a wolf); BSKEncRat, CYREncOgre01
  // and EncIceWraith name no kind at all.
  // Case-sensitive: every spawn edid is CamelCase, and /Crab/i matched CYREncRabbit ('EncRabbit'), so rabbits counted for
  // mudcrab contracts and fox spots were read as mudcrab fauna (sunk_turtle, 9 Oct)
  // Nat, 25 Oct: Bruma's 356 spots put down 41 ogres, 13 boars, 9 rats and its undead and goblins, none of them work until
  // these words were added. A rat (BSKEncRat) is its own kind, not a skeever: a hold's notice names what its spots put down.
  const CREATURE_WORD = /(Werewolf|Werebear|FrostbiteSpider|SabreCat|MountainLion|IceWraith|Slaughterfish|Skeever|Mudcrab|Crab|Horker|Mammoth|Giant|Troll|Riekling|Netch|Lurker|Minotaur|Ogre|Chaurus|Draugr|Skeleton|Zombie|Goblin|Boar|Rat|Wolf|Bear|Chicken|Cow|Hare|Dog|Deer|Elk|Goat|Fox)/;
  const kindOfEdid = (edid) => { const m = CREATURE_WORD.exec(String(edid || '')); if (!m) return ''; const k = m[1].toLowerCase(); return k === 'crab' ? 'mudcrab' : k; };
  // undefined when the record cannot be read: the caller then goes by the spawn tag, as before
  const kindOfBase = (desc) => {
    if (!desc) return undefined;
    try { const r = mp.lookupEspmRecordById(mp.getIdFromDesc(String(desc)) >>> 0); return r && r.record ? kindOfEdid(r.record.editorId) : undefined; } catch (e) { return undefined; }
  };

  // Which creature kinds the spawner actually places in a zone's worldspaces: the NPC each spot puts down, not its name
  const kindsByZone = (() => {
    const out = {};
    let list = [];
    try { const raw = JSON.parse(fs.readFileSync(SPAWNS, 'utf8')); list = Array.isArray(raw) ? raw : (raw.zones || []); } catch (e) { return out; }
    const worldOf = {};
    for (const z of zoneList()) for (const w of (z.worldspaces || [])) worldOf[String(w).toLowerCase()] = z.id;
    // A hold owns no worldspace of its own, so its fauna is whatever roams within reach of its capital
    const capitals = zoneList().filter((z) => Array.isArray(z.capital) && !(z.worldspaces || []).length);
    for (const entry of list) {
      const m = /^wild:([^:]+):/.exec(String(entry.Name || entry.name || ''));
      if (!m) continue;
      const npcs = entry.NPC || entry.npc;
      const own = kindOfBase(Array.isArray(npcs) && npcs[0] ? npcs[0].id : '');
      const kind = own === undefined ? m[1] : own;
      if (!kind) continue;
      let zoneId = worldOf[String(entry.ID || entry.id || '').toLowerCase()];
      if (!zoneId && Array.isArray(entry.POS)) {
        let best = null; let bestD = CAPITAL_REACH;
        for (const z of capitals) {
          const d = Math.hypot(entry.POS[0] - z.capital[0], entry.POS[1] - z.capital[1]);
          if (d < bestD) { bestD = d; best = z.id; }
        }
        zoneId = best;
      }
      if (!zoneId) continue;
      (out[zoneId] = out[zoneId] || {})[kind] = (out[zoneId][kind] || 0) + 1;
    }
    return out;
  })();

  // A hold's treasury is its balance in the bank (bank.js __dboTreasuryZone); the chest is only the fallback without it
  const bankTreasury = () => (globalThis.__dboTreasuryZone && typeof globalThis.__dboTreasuryZone.spend === 'function' ? globalThis.__dboTreasuryZone : null);
  const treasuryGold = (zone) => {
    if (!zone || !zone.treasury) return 0;
    if (bankTreasury()) return bankTreasury().balance(zone.id);
    try {
      const inv = mp.get(mp.getIdFromDesc(zone.treasury) >>> 0, 'inventory');
      const entries = inv && Array.isArray(inv.entries) ? inv.entries : [];
      const gold = entries.find((e) => (Number(e && e.baseId) >>> 0) === GOLD_BASE);
      return gold ? Number(gold.count) || 0 : 0;
    } catch (e) { return 0; }
  };

  // Returns what was actually paid; the hold cannot pay what it does not have
  const payFromTreasury = (zone, amount) => {
    if (amount <= 0 || !zone || !zone.treasury) return 0;
    if (bankTreasury()) { const paid = Math.min(bankTreasury().balance(zone.id), amount); return paid > 0 && bankTreasury().spend(zone.id, paid) ? paid : 0; }
    try {
      const chestId = mp.getIdFromDesc(zone.treasury) >>> 0;
      const inv = mp.get(chestId, 'inventory');
      const entries = inv && Array.isArray(inv.entries) ? inv.entries.map((e) => Object.assign({}, e)) : [];
      const gold = entries.find((e) => (Number(e.baseId) >>> 0) === GOLD_BASE);
      const have = gold ? Number(gold.count) || 0 : 0;
      const paid = Math.min(have, amount);
      if (paid <= 0) return 0;
      gold.count = have - paid;
      mp.set(chestId, 'inventory', { entries: entries.filter((e) => (Number(e.count) || 0) > 0 || (Number(e.baseId) >>> 0) !== GOLD_BASE) });
      return paid;
    } catch (e) { log('treasury payout failed', e.message); return 0; }
  };

  // The mirror of payFromTreasury: what a contract held and no longer needs goes back to the hold
  const refundToTreasury = (zone, amount) => {
    if (amount <= 0 || !zone || !zone.treasury) return false;
    if (bankTreasury()) return !!bankTreasury().deposit(zone.id, amount);
    try {
      const chestId = mp.getIdFromDesc(zone.treasury) >>> 0;
      const inv = mp.get(chestId, 'inventory');
      const entries = inv && Array.isArray(inv.entries) ? inv.entries.map((e) => Object.assign({}, e)) : [];
      const gold = entries.find((e) => (Number(e.baseId) >>> 0) === GOLD_BASE);
      if (gold) gold.count = (Number(gold.count) || 0) + amount; else entries.push({ baseId: GOLD_BASE, count: amount });
      mp.set(chestId, 'inventory', { entries });
      return true;
    } catch (e) { log('treasury refund failed', e.message); return false; }
  };

  // A contract holds its reward from the moment it is posted, so it can never pay out what the hold no longer has.
  // All or nothing: a treasury that covers only part of it keeps what it had and the notice does not go up.
  const escrow = (zone, amount) => {
    const paid = payFromTreasury(zone, amount);
    if (paid >= amount) return true;
    if (paid > 0) refundToTreasury(zone, paid);
    return false;
  };

  // The floor no take or new notice may push a treasury under (CFG.treasuryFloor)
  const floorOf = (zone) => {
    const f = CFG.treasuryFloor || {};
    const gold = Number.isFinite(Number(f.gold)) ? Math.max(0, Number(f.gold)) : 200;
    const share = Number.isFinite(Number(f.share)) ? Math.max(0, Math.min(1, Number(f.share))) : 0.25;
    return Math.max(gold, Math.ceil(share * treasuryGold(zone)));
  };
  const canSpare = (zone, amount) => !!zone && amount > 0 && treasuryGold(zone) - amount >= floorOf(zone);
  const TREASURY_TEXT = "The hold's treasury cannot spare more bounties right now.";

  // ---- the hold's own terms for standing work (Nate, 17 Oct) ---------------------------------------------------------
  // A notice an official posted by hand carries its poster (c.by); every other notice is standing work
  const isStanding = (c) => !!c && (c.standing === true || (c.standing === undefined && c.by === undefined));
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const bounds = () => { const b = CFG.priceBounds || {}; const min = Math.max(1, Math.floor(num(b.min, 1))); return { min, max: Math.max(min, Math.floor(num(b.max, 200))) }; };
  const budgetMax = () => Math.max(0, Math.floor(num(CFG.budgetMax, 100000)));
  const defaultBudget = () => Math.max(0, Math.floor(num(CFG.weeklyBudget, 1000)));
  // The UTC week a moment falls in, by its Monday 00:00
  const weekStart = (t = Date.now()) => { const d = new Date(t); const day = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day); };
  const weekKey = (t) => new Date(weekStart(t)).toISOString().slice(0, 10);
  const resetsAt = () => weekStart() + 7 * 86400000;
  const untilText = (t) => { const ms = Math.max(0, t - Date.now()); const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.ceil((ms % 3600000) / 60000);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
  const RESET_TEXT = () => `Monday 00:00 UTC (in ${untilText(resetsAt())})`;
  // A hold's record, rolled over to this week (spent back to 0) on first touch in a new week
  const holdState = (zid) => {
    const h = state.holds[zid] || (state.holds[zid] = {});
    const wk = weekKey();
    if (h.week !== wk) { h.week = wk; h.spent = 0; h.postSpent = 0; }
    return h;
  };
  const priceOf = (zid, tier) => {
    const set = (state.holds[zid] || {}).prices || {};
    const { min, max } = bounds();
    const v = Number.isFinite(Number(set[tier])) ? Number(set[tier]) : Number(CFG.rewardPerKill[tier]) || 12;
    return Math.max(min, Math.min(max, Math.floor(v)));
  };
  const budgetOf = (zid) => { const b = (state.holds[zid] || {}).budget; return Math.min(budgetMax(), Number.isFinite(Number(b)) ? Math.max(0, Math.floor(Number(b))) : defaultBudget()); };
  const standingOn = (zid) => (state.holds[zid] || {}).standing !== false;
  const budgetLeft = (zid) => Math.max(0, budgetOf(zid) - (Number(holdState(zid).spent) || 0));
  // Hand-posted work and commissions have their own weekly pool (Nat, 25 Oct), set by the same tax-setters
  const postBudgetOf = (zid) => { const b = (state.holds[zid] || {}).postBudget; return Math.min(budgetMax(), Number.isFinite(Number(b)) ? Math.max(0, Math.floor(Number(b))) : Math.max(0, Math.floor(num(CFG.postBudget, 100000)))); };
  const postLeft = (zid) => Math.max(0, postBudgetOf(zid) - (Number(holdState(zid).postSpent) || 0));
  // Charged when a hunter takes a notice (standing work to the standing budget, posted work to the posting one) or when a
  // commission goes up; given back when it is given up, withdrawn or runs out in the same week
  const POOL_FIELD = { standing: 'spent', posted: 'postSpent' };
  const charge = (w, zid, amount, pool = 'standing') => {
    const h = holdState(zid); const f = POOL_FIELD[pool] || 'spent';
    h[f] = (Number(h[f]) || 0) + amount; if (pool === 'standing') w.standing = true; w.pool = pool; w.charged = amount; w.week = h.week;
  };
  const uncharge = (w, amount) => {
    if (!w || !(Number(w.charged) > 0)) return;
    const back = Math.min(Number(w.charged), amount === undefined ? Number(w.charged) : Math.max(0, Number(amount)));
    const h = holdState(w.zone); const f = POOL_FIELD[w.pool] || 'spent';
    if (w.week === h.week) h[f] = Math.max(0, (Number(h[f]) || 0) - back);
    w.charged = Number(w.charged) - back;
  };
  // Citizens only: only where citizenship.js runs and this hold grants it (__dboCitizenGates); elsewhere open to all
  const citizensOnly = (zid) => {
    if (CFG.citizensOnly === false) return false;
    try { return typeof globalThis.__dboCitizenGates === 'function' && !!globalThis.__dboCitizenGates(zid); } catch (e) { return false; }
  };
  const isCitizen = (a, zid) => { try { return typeof globalThis.__dboCitizenOf === 'function' && !!globalThis.__dboCitizenOf(a, zid); } catch (e) { return false; } };
  const mayTakeStanding = (a, zid) => !citizensOnly(zid) || isCitizen(a, zid);
  // Who sets a hold's terms: whoever may set its tax (business.js taxRanks: Jarl, Count, Steward; and staff)
  const setsTerms = (a, zid) => { try { return typeof globalThis.__dboCanSetHoldTax === 'function' && !!globalThis.__dboCanSetHoldTax(a, zid); } catch (e) { return false; } };
  const refusals = globalThis.__dboContractRefusals || (globalThis.__dboContractRefusals = {});
  const refused = (reason, a, zid) => { refusals[reason] = (refusals[reason] || 0) + 1; log(`contracts: refused ${reason} for ${who(a)} in ${zid} (${refusals[reason]} since start)`); };
  const citizensText = (zone) => `Standing contracts of ${zone.name} are for citizens of ${zone.name} only. Become a citizen there to take them; work an official posts by hand is open to all.`;
  const budgetText = (zone) => `${zone.name} has spent this week's budget for standing contracts (${budgetOf(zone.id)} gold). It resets ${RESET_TEXT()}.`;
  const postBudgetText = (zone) => `${zone.name} has spent this week's budget for posted work (${postBudgetOf(zone.id)} gold). It resets ${RESET_TEXT()}.`;

  const nextId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

  // The kinds a hold posts standing work for: dangerous, and roaming at enough of its spots to be found
  const minSpots = () => Math.max(1, Math.floor(num(CFG.minSpots, 1)));
  const workKinds = (zid) => Object.keys(kindsByZone[zid] || {}).filter((k) => (DANGER[k] || 0) > 0 && kindsByZone[zid][k] >= minSpots());
  const tierLimit = (t) => { const v = Number((CFG.tierLimit || {})[t]); return Number.isFinite(v) && v >= 0 ? v : Infinity; };

  const makeContract = (zone) => {
    const up = zoneContracts(zone.id).filter((c) => c.type !== 'commission' && isStanding(c));
    const posted = up.map((c) => c.kind);
    const ofTier = (t) => up.filter((c) => (DANGER[c.kind] || 1) === t).length;
    const kinds = workKinds(zone.id).filter((k) => posted.indexOf(k) === -1 && ofTier(DANGER[k]) < tierLimit(DANGER[k]));
    if (!kinds.length) return null;
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const danger = DANGER[kind] || 1;
    const [lo, hi] = CFG.countRange;
    // Fewer of the dangerous things
    const count = Math.max(2, Math.round((lo + Math.random() * (hi - lo)) / danger));
    const reward = count * priceOf(zone.id, danger);
    // No new standing notice the week's budget could not pay for, nor one the treasury's floor forbids
    if (reward > budgetLeft(zone.id)) return null;
    if (!canSpare(zone, reward)) return null;
    return {
      id: nextId(), zone: zone.id, kind, count, reward, standing: true,
      postedAt: Date.now(), expiresAt: Date.now() + (Number(CFG.expiryHours) || 12) * 3600000,
    };
  };

  const zoneContracts = (zoneId) => state.contracts.filter((c) => c.zone === zoneId && c.expiresAt > Date.now());

  // Number(x) || 3 would turn a deliberate 0 into 3, so perZone 0 could never mean "no standing work"
  const perZone = Number.isFinite(Number(CFG.perZone)) ? Math.max(0, Number(CFG.perZone)) : 6;

  const refresh = () => {
    const before = state.contracts.length;
    const kept = [];
    const expired = [];
    // A hold whose officials switched standing work off takes its standing notices down; copies already taken run on
    for (const c of state.contracts) (c.expiresAt > Date.now() && !(isStanding(c) && !standingOn(c.zone)) ? kept : expired).push(c);
    state.contracts = kept;
    // An unfilled commission's gold left over goes back to the week's posting budget as well as the treasury
    for (const c of expired) if (c.type === 'commission') uncharge(c, Number(c.held) || 0);
    // A hunter's own copy that ran out gives its share back to the hold; the hunter is told when next they look (closeIfOver)
    for (const key of Object.keys(state.taken)) {
      for (const w of [].concat(state.taken[key] || [])) {
        if (w && w.kind && !w.expired && !(Number(w.expiresAt) > Date.now())) {
          expired.push({ label: `${key}'s contract`, zone: w.zone, held: Number(w.held) || 0 });
          // Unspent: its share of the week's budget comes back with its gold
          if (Number(w.held) > 0) uncharge(w);
          w.held = 0; w.expired = true;
        }
      }
    }
    // An expired notice or copy hands its reward back rather than leaving the gold nowhere, once it is written off on disk
    if (expired.length) {
      saveNow();
      for (const c of expired) if (Number(c.held) > 0 && !refundToTreasury(zoneById(c.zone), Number(c.held))) log(`contracts: ${c.held} gold of expired ${c.label || `notice ${c.id}`} could not go back to ${c.zone}`);
    }
    // Off: what is already posted stays listed so nobody loses work in hand, but no new notice goes up
    if (!CFG.enabled) { if (state.contracts.length !== before) save(); return; }
    for (const zone of zoneList()) {
      if (!zone.treasury || !standingOn(zone.id)) continue;
      let have = zoneContracts(zone.id).length;
      for (let i = have; i < perZone; i++) {
        const c = makeContract(zone);
        if (!c) break;
        if (!escrow(zone, c.reward)) break;
        c.held = c.reward;
        state.contracts.push(c);
      }
    }
    if (state.contracts.length !== before) saveNow();
  };

  // The zone a player stands in, by worldspace first and the hold capital as the fallback
  const zoneOf = (a) => {
    let world = ''; try { world = String(mp.get(a, 'worldOrCellDesc') || '').toLowerCase(); } catch (e) { return null; }
    for (const z of zoneList()) if ((z.worldspaces || []).some((w) => String(w).toLowerCase() === world)) return z;
    let pos = null; try { pos = mp.get(a, 'pos'); } catch (e) { pos = null; }
    if (!Array.isArray(pos)) return null;
    let best = null; let bestD = Infinity;
    for (const z of zoneList()) {
      if (!Array.isArray(z.capital)) continue;
      const d = Math.hypot(pos[0] - z.capital[0], pos[1] - z.capital[1]);
      if (d < bestD) { bestD = d; best = z; }
    }
    return bestD < 60000 ? best : null;
  };

  // A player's zone is the gamemode's (indoors by the owning plugin, else where they last stood outside), so the boards
  // in Bruma's halls and /contract indoors know their hold; beasts are placed by their worldspace (zoneOf) as before
  const playerZone = (a) => {
    let id = null; try { id = typeof zoneOfActor === 'function' ? zoneOfActor(a) : null; } catch (e) { id = null; }
    return (id && zoneById(id)) || zoneOf(a);
  };

  const keyOf = (a) => String(profileOf(a));
  // A hunter's contracts: an array of copies. Older files hold one object (a copy, or { id, progress } from before)
  const rawList = (key) => { const v = state.taken[key]; return v ? [].concat(v).filter(Boolean) : []; };
  const putList = (key, list) => { if (list.length) state.taken[key] = list; else delete state.taken[key]; };
  const takenBy = (a) => rawList(keyOf(a)).length > 0;
  const contractById = (id) => state.contracts.find((c) => c.id === id) || null;
  const maxActive = () => (Number.isFinite(Number(CFG.maxActive)) ? Math.max(1, Math.floor(Number(CFG.maxActive))) : 3);
  // Contracts are per hunter (Nate, 5 Oct; three hunters had taken the same 2 trolls and only the first was paid): taking
  // a notice gives the hunter a copy of their own, with its own count, its own share of the reward set aside from the
  // treasury and its own time limit, and leaves the notice up for everyone else. A notice is done once per hunter, and a
  // hunter holds up to maxActive at once.
  // state.taken[profile] = [{ id, kind, count, reward, zone, held, progress, counted, takenAt, expiresAt[, expired] }]
  const copyHours = () => (Number(CFG.expiryHours) || 12) * 3600000;
  // The share for one more hunter: what the notice still holds (the first taker's), else set aside now, all or nothing,
  // and only above the treasury's floor. 0 when the hold cannot spare it: nobody is sent out for pay that is not there
  const shareFor = (c) => {
    const reward = Number(c.reward) || 0;
    if (Number(c.held) >= reward && reward > 0) { c.held = Number(c.held) - reward; return reward; }
    const zone = zoneById(c.zone);
    return canSpare(zone, reward) && escrow(zone, reward) ? reward : 0;
  };
  const copyFor = (c, progress = 0) => ({ id: c.id, kind: c.kind, count: c.count, reward: c.reward, zone: c.zone, held: 0, progress,
    counted: [], takenAt: Date.now(), expiresAt: Date.now() + copyHours() });
  // A contract taken under the one-notice rule ({ id, progress }) becomes a copy of its notice, keeping its progress; null
  // when its notice is gone
  const migrate = (key, old) => {
    const c = contractById(old.id);
    if (!c) return null;
    const w = copyFor(c, Number(old.progress) || 0);
    w.held = shareFor(c);
    log(`contracts: profile ${key}'s contract ${c.id} (${c.count} ${c.kind}) is its own copy now, ${w.progress} done, ${w.held} gold set aside`);
    return w;
  };
  const GONE_TEXT = 'Your contract is closed: its notice is no longer posted. Take new work at the board.';
  const ranOutText = (w) => `Your contract for ${w.count} ${plural(w.kind)} ran out before the last beast fell, and its reward went back to the hold.`;
  // The hunter's live contracts. One that is over (its notice gone before it became a copy, or run out) is closed with
  // word of it wherever they next look: a kill, the board, /contract
  const copiesOf = (a, tell = true) => {
    const key = keyOf(a);
    const raw = rawList(key);
    if (!raw.length) return [];
    const live = [], refunds = [];
    let changed = !Array.isArray(state.taken[key]);
    for (const old of raw) {
      const w = old.kind ? old : migrate(key, old);
      if (w !== old) changed = true;
      if (!w) { if (tell) personal(a, GONE_TEXT); continue; }
      if (w.expired || !(Number(w.expiresAt) > Date.now())) {
        if (Number(w.held) > 0) { refunds.push(w); uncharge(w); }
        changed = true;
        if (tell) personal(a, ranOutText(w));
        continue;
      }
      live.push(w);
    }
    if (changed) { putList(key, live); saveNow(); }
    // Written off on disk first, then the share goes back to the hold
    for (const w of refunds) if (!refundToTreasury(zoneById(w.zone), Number(w.held))) log(`contracts: ${w.held} gold of run-out ${key}'s contract could not go back to ${w.zone}`);
    return live;
  };
  const doneBy = (c, a) => (c.doneBy || []).indexOf(keyOf(a)) !== -1;

  const describe = (c, progress) => {
    const zone = zoneById(c.zone);
    if (c.type === 'commission') return `${c.count - (Number(c.delivered) || 0)} ${c.itemName} wanted by ${zone ? zone.name : c.zone} at ${c.price} gold each`;
    const done = progress === undefined ? '' : ` [${progress}/${c.count}]`;
    return `${c.count} ${plural(c.kind)} in ${zone ? zone.name : c.zone} for ${c.reward} gold${done}`;
  };

  // The account behind a character, so a poster cannot take his own notice on a second character of his
  const accountOf = (a) => { try { return String((typeof discordOf === 'function' && discordOf(a)) || ''); } catch (e) { return ''; } };
  const postedBy = (c, a) => {
    if (c.by !== undefined && Number(c.by) === Number(profileOf(a))) return true;
    const acc = accountOf(a);
    return !!acc && String(c.byAccount || '') === acc;
  };

  const isOfficial = (a, zoneId) => {
    try { return ranksOf(profileOf(a), a).some((r) => r.zone && r.zone.id === zoneId); } catch (e) { return false; }
  };

  // Death of a spawned creature: every one of the killer's contracts it matches moves on, each at most once per body
  // A kill by a player's summon, raised corpse or companion counts for its owner (ff_companionOf; soapyfresh, 13 Oct:
  // a familiar's kill of a contracted wolf gave no credit)
  const creditedTo = (killerId) => {
    try {
      if (mp.get(killerId, 'private.dboCompanion')) { const o = Number(mp.get(killerId, 'ff_companionOf')) >>> 0; if (o) return o; }
    } catch (e) { /* not a companion */ }
    return killerId;
  };
  // The pelts of a counted kill go to the hold, which sells them: its treasury gets holdShare of their value. The body's pelts
  // are set aside 50 ms after the death (gamemode.js stashPelts), so the claim waits for them
  const claimForHold = (npcId, zoneId, hunter) => {
    const share = Math.max(0, Math.min(1, Number(CFG.holdShare) || 0));
    if (!share || typeof globalThis.__dboClaimPelts !== 'function') return;
    setTimeout(() => {
      try {
        const r = globalThis.__dboClaimPelts(npcId);
        if (!r || !r.count) return;
        const zone = zoneById(zoneId);
        const gold = Math.floor(r.value * share);
        if (gold > 0) refundToTreasury(zone, gold);
        personal(hunter, `${zone ? zone.name : 'The hold'} takes the ${r.count === 1 ? 'pelt' : `${r.count} pelts`} as proof of the kill.`);
        audit(`CONTRACT PELTS ${who(hunter)}'s kill: ${r.count} pelt(s) worth ${r.value} claimed by ${zone ? zone.name : zoneId}, ${gold} gold to its treasury`);
      } catch (e) { log('contracts: pelt claim failed', e.message); }
    }, 400);
  };
  globalThis.__dboContractKill = (npcId, killer) => {
    if (!CFG.enabled) return;
    const killerId = creditedTo(Number(killer) >>> 0);
    if (!takenBy(killerId)) return;
    const work = copiesOf(killerId);
    if (!work.length) return;
    let tag = ''; try { tag = String(mp.get(npcId, 'private.npcSpawner') || ''); } catch (e) { return; }
    const m = /^wild:([^:]+):/.exec(tag);
    if (!m) return;
    // The body's own record says what fell; the spot's name only when that cannot be read (kindOfBase above)
    let base = ''; try { base = String(mp.get(npcId, 'baseDesc') || ''); } catch (e) { base = ''; }
    const own = kindOfBase(base);
    const kind = own === undefined ? m[1] : own;
    const where = zoneOf(npcId);
    const body = (Number(npcId) >>> 0).toString(16);
    let worth = 1;
    try { if (mp.get(npcId, 'private.dboChampion') === true) worth = Math.max(1, Number(CFG.championWorth) || 1); } catch (e) { /* plain beast */ }
    const key = keyOf(killerId);
    const sameKind = work.filter((w) => w.kind === kind);
    if (!sameKind.length) {
      // A spot named for the quarry that put down something else (a rat at a "wolf" spot) is said, not silently skipped
      const named = work.find((w) => w.kind === m[1]);
      if (named) personal(killerId, `That was ${own ? aOrAn(single(own)) : 'some other creature'}, not one of your ${plural(named.kind)}: it does not count for the contract.`);
      return;
    }
    let counted = 0;
    for (const w of sameKind) {
      // The hold pays for its own ground: a wolf felled in another hold is not this notice's work
      if (!where || where.id !== w.zone) continue;
      w.counted = Array.isArray(w.counted) ? w.counted : [];
      if (w.counted.indexOf(body) !== -1) continue;
      w.counted.push(body);
      if (w.counted.length > 60) w.counted.splice(0, w.counted.length - 60);
      counted++;
      if (counted === 1) claimForHold(npcId, w.zone, killerId);
      w.progress = (Number(w.progress) || 0) + worth;
      if (w.progress < w.count) { personal(killerId, `Contract: ${w.progress}/${w.count} ${plural(w.kind)}.`); continue; }
      const zone = zoneById(w.zone);
      // The hunter's share was set aside when they took the notice; a copy that holds none (one migrated while the
      // treasury was short) is paid now if the hold can, else it waits
      if (!(Number(w.held) > 0)) w.held = payFromTreasury(zone, Number(w.reward) || 0);
      const paid = Number(w.held) || 0;
      if (paid <= 0) {
        personal(killerId, `The work is done, but the ${zone ? zone.name : w.zone} treasury is empty. Speak to its officials.`);
        continue;
      }
      // Closed and written before the gold changes hands, so no crash can pay it twice. The notice stays up for the
      // other hunters; this one has done it
      putList(key, rawList(key).filter((x) => x !== w));
      const notice = contractById(w.id);
      if (notice) notice.doneBy = (notice.doneBy || []).concat(key);
      saveNow();
      giveItem(killerId, GOLD_BASE, paid);
      personal(killerId, `Contract complete: ${w.count} ${plural(w.kind)}. ${paid} gold from the ${zone ? zone.name : w.zone} treasury.`);
      // Imperial Luck (racial.js): new coin on top of the pay, never out of the treasury
      try { if (typeof globalThis.__dboRaceGold === 'function') globalThis.__dboRaceGold(killerId, paid, 'contract pay'); } catch (e) { /* the pay itself is done */ }
      audit(`CONTRACT ${who(killerId)} completed ${w.count} ${plural(w.kind)} for ${zone ? zone.name : w.zone} (${paid} gold)`);
    }
    if (!counted && sameKind.some((w) => !where || where.id !== w.zone)) {
      const z = zoneById(sameKind[0].zone);
      personal(killerId, `Only ${plural(sameKind[0].kind)} felled in ${z ? z.name : sameKind[0].zone}'s wilds count for your contract.`);
    }
    save();
    refresh();
  };

  // Take and give up, shared by /contract and the board's Contracts tab; each returns what the player is told
  const takeContract = (a, c, zone) => {
    if (!CFG.enabled) return OFF_TEXT;
    const work = copiesOf(a);
    if (work.length >= maxActive()) return `You already hold ${maxActive()} contracts. Finish or give one up first.`;
    if (!c || c.zone !== zone.id || !(c.expiresAt > Date.now())) return 'That contract is no longer posted here.';
    if (c.type === 'commission') return 'That is a commission: bring the goods to the board and hand them in.';
    if (work.some((w) => w.id === c.id)) return 'You already hold that contract.';
    if (postedBy(c, a)) return 'You posted that notice yourself. Someone else does the hunting.';
    if (doneBy(c, a)) return 'You have already done the work on that notice. Take another.';
    const standing = isStanding(c);
    if (standing && !mayTakeStanding(a, zone.id)) { refused('not a citizen', a, zone.id); return citizensText(zone); }
    if (standing && (Number(c.reward) || 0) > budgetLeft(zone.id)) { refused('budget spent', a, zone.id); return budgetText(zone); }
    // A posted notice pays every hunter who takes it, each copy out of the week's posting budget (it held one share only)
    if (!standing && (Number(c.reward) || 0) > postLeft(zone.id)) { refused('post budget spent', a, zone.id); return postBudgetText(zone); }
    const w = copyFor(c);
    w.held = shareFor(c);
    if (!(w.held > 0)) return TREASURY_TEXT;
    charge(w, zone.id, w.held, standing ? 'standing' : 'posted');
    putList(keyOf(a), work.concat([w]));
    saveNow();
    audit(`CONTRACT ${who(a)} took ${c.count} ${plural(c.kind)} for ${zone.name}`);
    return `Taken: ${describe(c, 0)}. Kills count anywhere in ${zone.name}'s wilds, and you are paid when the last one falls.`;
  };
  // which: a number from /contract's list of what you hold, or a notice id; none is fine only while one is held
  const abandonContract = (a, which) => {
    const work = copiesOf(a, false);
    if (!work.length) return 'You hold no contract.';
    let w = null;
    if (which === undefined || which === null || which === '') {
      if (work.length > 1) return `You hold ${work.length} contracts. Give one up with /contract abandon <number>; /contract lists them.`;
      w = work[0];
    } else {
      const n = Number(which);
      w = Number.isInteger(n) && n >= 1 && n <= work.length ? work[n - 1] : work.find((x) => x.id === String(which)) || null;
    }
    if (!w) return 'No such contract. /contract lists the ones you hold.';
    putList(keyOf(a), work.filter((x) => x !== w));
    if (Number(w.held) > 0) uncharge(w);
    saveNow();
    // the player log (playerlog.js): a contract given up, which nothing recorded before
    try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('contract', 'abandon', a, w.kind, w.count, w.zone, 0); } catch (e) { /* the player log is optional */ }
    // The share set aside for this hunter goes back to the hold, once the contract is gone on disk
    if (Number(w.held) > 0 && !refundToTreasury(zoneById(w.zone), Number(w.held))) log(`contracts: ${w.held} gold of given-up ${keyOf(a)}'s contract could not go back to ${w.zone}`);
    return `Contract for ${w.count} ${plural(w.kind)} given up. Its reward goes back to the hold.`;
  };

  // What the Contracts tab of the expedition board shows (dungeons.js puts it in the board's payload)
  const boardView = (a) => {
    refresh();
    const zone = playerZone(a);
    const work = copiesOf(a);
    // The board of client 0.3.77 takes nothing more while it shows a contract held, so it is shown only at the cap; every
    // held notice is stamped as yours either way, and heldAll carries them all for a board that lists several
    const held = work.length >= maxActive() ? work[0] : null;
    const hc = held;
    // A notice this hunter has done is off their board; the others still see it
    const list = zone ? zoneContracts(zone.id).filter((c) => !doneBy(c, a)) : [];
    const hours = (c) => Math.max(0, Math.ceil((c.expiresAt - Date.now()) / 3600000));
    const zoneName = (id) => { const z = zoneById(id); return z ? z.name : id; };
    // The hold's terms for standing work (Nate, 17 Oct). The board of client 0.3.77+ draws a notice's state as its stamp
    // when it is not one it knows, and offers Take only on 'open', so a notice this hunter may not take carries its reason
    // as the stamp ('Citizens only', 'Budget spent') and, for citizens only, the hold in its name. The budget left is
    // spoken in the note, which that board shows when nothing is listed; budget/citizensOnly are there for a later board.
    const restricted = zone ? citizensOnly(zone.id) : false;
    const citizen = zone ? mayTakeStanding(a, zone.id) : true;
    const left = zone ? budgetLeft(zone.id) : 0;
    const budgetNote = zone ? (standingOn(zone.id) ? ` Standing work this week: ${left} of ${budgetOf(zone.id)} gold left, renewed ${RESET_TEXT()}.` : ` ${zone.name}'s officials have stopped its standing work.`) : '';
    const standingState = (c) => (!isStanding(c) ? ((Number(c.reward) || 0) > (zone ? postLeft(zone.id) : 0) ? 'Budget spent' : 'open')
      : !citizen ? 'Citizens only' : (Number(c.reward) || 0) > left ? 'Budget spent' : 'open');
    // A commission is handed in, never taken: the board of client 0.3.108b and older shows its state as the stamp
    const commissionRow = (c) => {
      const wanted = c.count - (Number(c.delivered) || 0);
      return { id: c.id, type: 'commission', what: `${wanted} ${c.itemName} at ${c.price} gold each`, item: c.itemName, count: wanted, price: c.price,
        reward: wanted * c.price, danger: 0, hoursLeft: hours(c), standing: false, have: plainCount(a, idOf(c.item)),
        state: postedBy(c, a) ? 'posted' : 'Hand in: /contract deliver' };
    };
    return {
      enabled: !!CFG.enabled,
      zone: zone ? zone.name : '',
      treasury: zone ? treasuryGold(zone) : 0,
      note: !CFG.enabled ? OFF_TEXT : !zone ? 'No hold claims this ground, so there is no hunting work posted here.'
        : list.length ? '' : `${zone.name} has no hunting work posted. Its coffers may be empty, or its budget for standing work spent.${budgetNote}`,
      citizensOnly: restricted,
      citizen,
      budget: zone ? { total: budgetOf(zone.id), left, standing: standingOn(zone.id), resetsAt: resetsAt() } : null,
      heldAll: work.map((w) => ({ id: w.id, what: `${w.count} ${plural(w.kind)}`, zone: zoneName(w.zone), progress: Math.min(w.count, Number(w.progress) || 0), count: w.count, reward: w.reward, hoursLeft: hours(w) })),
      maxActive: maxActive(),
      held: hc ? { id: hc.id, what: `${hc.count} ${plural(hc.kind)}`, zone: zoneName(hc.zone), progress: Math.min(hc.count, Number(held.progress) || 0), count: hc.count, reward: hc.reward, hoursLeft: hours(hc) } : null,
      list: list.map((c) => (c.type === 'commission' ? commissionRow(c) : { id: c.id, what: `${c.count} ${plural(c.kind)}${isStanding(c) && restricted ? ` (citizens of ${zone.name} only)` : ''}`, count: c.count, reward: c.reward, danger: DANGER[c.kind] || 1, hoursLeft: hours(c),
        standing: isStanding(c), postedBy: isStanding(c) ? '' : String(c.byName || ''),
        state: work.some((w) => w.id === c.id) ? 'yours' : postedBy(c, a) ? 'posted' : standingState(c) })),
      canPost: !!(zone && isOfficial(a, zone.id)),
      postLeft: zone ? postLeft(zone.id) : 0,
    };
  };
  globalThis.__dboContractsBoard = { view: boardView };
  // The tab's buttons, honoured only while that player's board is open (dungeons.js keeps the open set)
  const boardOpen = (a) => { const m = globalThis.__dboExpeditionPending; return m instanceof Map && m.has(a); };
  const reopen = (a) => { try { if (typeof globalThis.__dboExpeditionBoardRefresh === 'function') globalThis.__dboExpeditionBoardRefresh(a, 'contracts'); } catch (e) { log('contracts: board refresh failed', e.message); } };
  if (typeof onUi === 'function') {
    onUi('contractTake', (a, args) => {
      if (!boardOpen(a)) return;
      const zone = playerZone(a);
      personal(a, zone ? takeContract(a, contractById(String((args || [])[0] || '')), zone) : 'There is no work posted on this ground.');
      reopen(a);
    });
    onUi('contractAbandon', (a, args) => { if (!boardOpen(a)) return; personal(a, abandonContract(a, (args || [])[0])); reopen(a); });
    // contractDeliver [id, count?]: hand in goods for a commission of the hold the board stands in
    onUi('contractDeliver', (a, args) => {
      if (!boardOpen(a)) return;
      const zone = playerZone(a);
      const c = contractById(String((args || [])[0] || ''));
      const r = zone && c && c.zone === zone.id ? deliver(a, c, (args || [])[1]) : { error: 'That commission is not posted on this board.' };
      personal(a, r.error || r.text);
      reopen(a);
    });
  }

  // ---- posting by hand, and commissions (Nat, 25 Oct) -----------------------------------------------------------------
  // Each returns { text } or { error }, shared by /contract and the Court tab (court.js courtContractPost and the rest)
  if (!state.posters || typeof state.posters !== 'object') state.posters = {};
  const DAY_MS = 86400000;
  const postsPerDay = () => Math.max(0, Math.floor(num(CFG.postsPerDay, 0)));
  const postsToday = (a) => { const k = keyOf(a); const since = Date.now() - DAY_MS; return [].concat(state.posters[k] || []).filter((t) => Number(t) > since); };
  const notePost = (a) => { const k = keyOf(a); state.posters[k] = postsToday(a).concat(Date.now()); };
  // The usual gates for an official posting in a hold's name; null when they may
  const postGate = (a, zone, gold) => {
    if (!CFG.enabled) return OFF_TEXT;
    if (!zone || !zone.treasury) return 'That hold has no treasury to pay for work.';
    if (!isOfficial(a, zone.id)) { refused('not an official (post)', a, zone.id); return `Only an official of ${zone.name} posts work in its name.`; }
    if (postsPerDay() && postsToday(a).length >= postsPerDay()) return `You have posted ${postsPerDay()} notices in the last day. Post again tomorrow.`;
    if (gold > postLeft(zone.id)) { refused('post budget spent', a, zone.id); return `That would pass ${zone.name}'s budget for posted work: ${postLeft(zone.id)} of ${postBudgetOf(zone.id)} gold left this week, renewed ${RESET_TEXT()}.`; }
    // An official's own post needs only its reward (escrow); the floor guards each further hunter's share (shareFor)
    return null;
  };
  const postContract = (a, zone, kindText, countIn, rewardIn) => {
    const kind = kindFromWords(kindText);
    const count = Math.floor(Number(countIn)), reward = Math.floor(Number(rewardIn));
    if (!kind || !(count >= 1) || !(reward >= 1)) return { error: 'Use: /contract post <creature> <count> <reward>' };
    if (count > 50) return { error: 'Fifty at most on one notice.' };
    if (!(kindsByZone[zone.id] || {})[kind]) return { error: `No ${plural(kind)} are known to roam ${zone.name}.` };
    // A hold pays for danger. Harmless quarry is not work, and no reward may run past what the risk is worth:
    // without this an official could post one chicken at 10,000 gold and empty the treasury into his own purse.
    const danger = DANGER[kind] || 0;
    if (danger <= 0) return { error: `${plural(kind)[0].toUpperCase()}${plural(kind).slice(1)} are no danger to anyone. ${zone.name} pays for dangerous work.` };
    // At most the hold's own pay per kill for that danger (its officials' /contract price), not the default
    const most = count * priceOf(zone.id, danger);
    if (reward > most) return { error: `${count} ${plural(kind)} is worth at most ${most} gold at ${zone.name}'s pay of ${priceOf(zone.id, danger)} a kill. Post it for that or less.` };
    const gate = postGate(a, zone, reward); if (gate) return { error: gate };
    if (!escrow(zone, reward)) return { error: `The ${zone.name} treasury holds ${treasuryGold(zone)} gold, less than the reward.` };
    const c = { id: nextId(), zone: zone.id, kind, count, reward, held: reward, standing: false, by: profileOf(a), byAccount: accountOf(a), byName: ownName(a),
      postedAt: Date.now(), expiresAt: Date.now() + (Number(CFG.expiryHours) || 12) * 3600000 };
    state.contracts.push(c);
    notePost(a);
    saveNow();
    audit(`CONTRACT ${who(a)} posted ${c.count} ${plural(c.kind)} for ${zone.name} at ${c.reward} gold`);
    return { text: `Posted: ${describe(c)}. The reward is set aside from the treasury; each hunter who takes it is paid from this week's budget for posted work.` };
  };

  // Commissions: the goods a hold buys, from the item catalog's categories (admin-items.json, plain items only)
  const GOODS = (() => {
    const out = [];
    try {
      const cats = new Set([].concat(CFG.commissionCategories || []));
      for (const c of JSON.parse(fs.readFileSync(path.resolve('admin-items.json'), 'utf8')).categories || []) {
        if (!cats.has(c.id)) continue;
        for (const it of c.items || []) out.push({ desc: String(it[0]), name: String(it[1]), lower: String(it[1]).toLowerCase(), cat: c.id });
      }
    } catch (e) { log('contracts: admin-items.json unreadable, no commissions', e.message); }
    return out;
  })();
  const idOf = (desc) => { try { return mp.getIdFromDesc(String(desc)) >>> 0; } catch (e) { return 0; } };
  const baseValue = (id) => { try { return typeof globalThis.__dboBaseValue === 'function' ? Math.max(0, Number(globalThis.__dboBaseValue(id >>> 0)) || 0) : 0; } catch (e) { return 0; } };
  const maxPriceOf = (id) => Math.max(1, Math.ceil(baseValue(id) * Math.max(0, num(CFG.commissionValueMult, 1.5))));
  // By catalog id, exact name, or every word given; the first few for a list
  const findGoods = (query, max = 12) => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const byDesc = GOODS.filter((g) => g.desc.toLowerCase() === q);
    if (byDesc.length) return byDesc.slice(0, 1);
    const exact = GOODS.filter((g) => g.lower === q);
    const words = q.split(/\s+/);
    return (exact.length ? exact : GOODS.filter((g) => words.every((w) => g.lower.includes(w)))).slice(0, max);
  };
  const goodsRow = (g) => { const id = idOf(g.desc); return { desc: g.desc, name: g.name, value: baseValue(id), maxPrice: maxPriceOf(id) }; };
  const postCommission = (a, zone, itemText, countIn, priceIn) => {
    const count = Math.floor(Number(countIn)), price = Math.floor(Number(priceIn));
    const hits = findGoods(itemText, 9);
    if (!hits.length) return { error: `No goods a hold buys match "${String(itemText || '').trim()}".` };
    const names = new Set(hits.map((g) => g.lower));
    if (hits.length > 1 && names.size > 1) return { error: `${hits.length} goods match. Be more exact: ${hits.slice(0, 8).map((g) => g.name).join(', ')}.` };
    const g = hits[0]; const id = idOf(g.desc);
    if (!id) return { error: `${g.name} is not in this world's load order.` };
    if (!(count >= 1) || count > Math.floor(num(CFG.commissionMaxCount, 200))) return { error: `Ask for 1 to ${Math.floor(num(CFG.commissionMaxCount, 200))}.` };
    if (!baseValue(id)) return { error: `${g.name} has no worth to buy it by.` };
    if (!(price >= 1) || price > maxPriceOf(id)) return { error: `${zone.name} pays at most ${maxPriceOf(id)} gold each for ${g.name} (worth ${baseValue(id)}).` };
    const reward = count * price;
    const gate = postGate(a, zone, reward); if (gate) return { error: gate };
    if (!escrow(zone, reward)) return { error: `The ${zone.name} treasury holds ${treasuryGold(zone)} gold, less than ${reward}.` };
    const c = { id: nextId(), type: 'commission', zone: zone.id, item: g.desc, itemName: g.name, count, delivered: 0, price, reward, held: reward,
      standing: false, by: profileOf(a), byAccount: accountOf(a), byName: ownName(a), postedAt: Date.now(),
      expiresAt: Date.now() + Math.max(1, num(CFG.commissionHours, 48)) * 3600000 };
    charge(c, zone.id, reward, 'posted');
    state.contracts.push(c);
    notePost(a);
    saveNow();
    audit(`CONTRACT ${who(a)} commissioned ${count} ${g.name} (${g.desc}) for ${zone.name} at ${price} gold each (${reward} held)`);
    return { text: `Commission posted: ${count} ${g.name} at ${price} gold each for ${zone.name}. ${reward} gold is set aside; hunters and crafters hand them in at the board.` };
  };
  // A plain stack only (no name, enchantment, tempering or worn state) is taken: a commission buys the goods, not keepsakes
  const plainOf = (e) => Object.keys(e).every((k) => k === 'baseId' || k === 'count' || e[k] === undefined || e[k] === null || ((k === 'worn' || k === 'wornLeft') && !e[k]));
  const plainCount = (a, id) => { try { const inv = mp.get(a, 'inventory'); return ((inv && inv.entries) || []).reduce((n, e) => n + ((Number(e.baseId) >>> 0) === id && plainOf(e) ? Number(e.count) || 0 : 0), 0); } catch (e) { return 0; } };
  const takePlain = (a, id, n) => {
    const inv = mp.get(a, 'inventory');
    const entries = ((inv && inv.entries) || []).map((e) => Object.assign({}, e));
    let left = n;
    for (const e of entries) { if (left <= 0) break; if ((Number(e.baseId) >>> 0) !== id || !plainOf(e)) continue; const t = Math.min(left, Number(e.count) || 0); e.count = Number(e.count) - t; left -= t; }
    if (left > 0) return false;
    mp.set(a, 'inventory', { entries: entries.filter((e) => (Number(e.count) || 0) > 0) });
    return true;
  };
  const toChest = (zone, id, n) => {
    try {
      const chestId = mp.getIdFromDesc(zone.treasury) >>> 0;
      const inv = mp.get(chestId, 'inventory');
      const entries = (inv && Array.isArray(inv.entries) ? inv.entries : []).map((e) => Object.assign({}, e));
      const hit = entries.find((e) => (Number(e.baseId) >>> 0) === id && plainOf(e));
      if (hit) hit.count = (Number(hit.count) || 0) + n; else entries.push({ baseId: id, count: n });
      mp.set(chestId, 'inventory', { entries });
      return true;
    } catch (e) { log('contracts: commission goods to the chest failed', e.message); return false; }
  };
  const deliver = (a, c, want) => {
    if (!CFG.enabled) return { error: OFF_TEXT };
    const zone = c ? zoneById(c.zone) : null;
    if (!c || c.type !== 'commission' || !(c.expiresAt > Date.now()) || !zone) return { error: 'That commission is no longer posted here.' };
    if (postedBy(c, a)) return { error: 'You posted that commission yourself. Someone else fills it.' };
    const id = idOf(c.item);
    const left = c.count - (Number(c.delivered) || 0);
    const have = plainCount(a, id);
    if (!have) return { error: `You carry no plain ${c.itemName} to hand in (named, enchanted or tempered ones are kept back).` };
    const n = Math.max(1, Math.min(left, have, Number.isFinite(Number(want)) && Number(want) > 0 ? Math.floor(Number(want)) : have));
    const pay = Math.min(n * c.price, Number(c.held) || 0);
    if (pay < n * c.price) return { error: `The commission's gold has run short. Speak to ${zone.name}'s officials.` };
    if (!takePlain(a, id, n)) return { error: 'Those goods could not be taken from your pack. Try again.' };
    // Written before the gold changes hands, so no crash can pay twice
    c.delivered = (Number(c.delivered) || 0) + n;
    c.held = Number(c.held) - pay;
    const done = c.delivered >= c.count;
    if (done) state.contracts = state.contracts.filter((x) => x !== c);
    saveNow();
    if (!toChest(zone, id, n)) log(`contracts: ${n} ${c.itemName} of commission ${c.id} did not reach ${zone.id}'s treasury chest`);
    giveItem(a, GOLD_BASE, pay);
    audit(`CONTRACT ${who(a)} delivered ${n} ${c.itemName} to ${zone.name}'s commission ${c.id} for ${pay} gold (${c.delivered}/${c.count})`);
    try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('contract', 'deliver', a, c.itemName, n, c.zone, pay); } catch (e) { /* the player log is optional */ }
    return { text: `Handed in ${n} ${c.itemName}: ${pay} gold from the ${zone.name} treasury.${done ? ' The commission is filled.' : ` ${c.count - c.delivered} still wanted.`}` };
  };
  // The poster, a tax-setter of the hold, or staff takes down a hand-posted notice or a commission; what it still holds goes back
  const withdraw = (a, zone, id) => {
    const c = state.contracts.find((x) => x.id === String(id) && x.zone === zone.id && !isStanding(x));
    if (!c) return { error: 'No such posted notice in that hold.' };
    if (!postedBy(c, a) && !setsTerms(a, zone.id)) return { error: 'Only whoever posted it, or those who set the hold\'s tax, take it down.' };
    state.contracts = state.contracts.filter((x) => x !== c);
    const back = Number(c.held) || 0;
    if (c.type === 'commission') uncharge(c, back);
    c.held = 0;
    saveNow();
    if (back > 0 && !refundToTreasury(zone, back)) log(`contracts: ${back} gold of withdrawn ${c.id} could not go back to ${zone.id}`);
    audit(`CONTRACT ${who(a)} withdrew ${c.type === 'commission' ? `commission ${c.count} ${c.itemName}` : `${c.count} ${plural(c.kind)}`} in ${zone.name} (${back} gold back)`);
    return { text: `Taken down; ${back} gold goes back to the ${zone.name} treasury. Hunters already holding it keep their copy.` };
  };
  // The Court tab's commission search, kept per viewer until their next one
  const searches = globalThis.__dboContractSearches instanceof Map ? globalThis.__dboContractSearches : (globalThis.__dboContractSearches = new Map());
  const search = (a, q) => {
    const rows = findGoods(q, 12).map(goodsRow);
    searches.set(a >>> 0, { query: String(q || '').slice(0, 60), items: rows });
    if (searches.size > 200) searches.delete(searches.keys().next().value);
    return { text: rows.length ? `${rows.length} goods match.` : 'Nothing a hold buys matches that.' };
  };

  // ---- /contract status, price, budget, standing ----------------------------------------------------------------------
  const TIER_WORD = { 1: 'pests', 2: 'dangerous beasts', 3: 'deadly beasts' };
  const statusLines = (a, zone) => {
    const out = [];
    const on = standingOn(zone.id);
    out.push(`Standing contracts of ${zone.name}: ${!CFG.enabled ? 'closed everywhere for now' : on ? 'on' : 'stopped by its officials'}.`);
    out.push(`  Pay per kill: ${[1, 2, 3].map((t) => `tier ${t} (${TIER_WORD[t]}) ${priceOf(zone.id, t)} gold`).join(', ')}.`);
    out.push(`  This week's budget: ${budgetLeft(zone.id)} of ${budgetOf(zone.id)} gold left; it renews ${RESET_TEXT()}.`);
    out.push(`  ${citizensOnly(zone.id) ? `Only citizens of ${zone.name} take its standing contracts${mayTakeStanding(a, zone.id) ? ' (you are one)' : ' (you are not one)'}.` : 'Its standing contracts are open to every hunter.'} Work an official posts by hand is open to all.`);
    out.push(`  Posted work and commissions this week: ${postLeft(zone.id)} of ${postBudgetOf(zone.id)} gold left${postsPerDay() ? `; each official posts at most ${postsPerDay()} a day` : ''}.`);
    const h = state.holds[zone.id] || {};
    if (h.by) out.push(`  Last set by ${h.by} on ${new Date(Number(h.at) || 0).toISOString().slice(0, 16).replace('T', ' ')} UTC.`);
    if (isOfficial(a, zone.id)) out.push('  As an official: /contract post <creature> <count> <reward>, /contract commission <goods> <count> <gold each>, /contract withdraw <number>, or the Court tab.');
    if (setsTerms(a, zone.id)) { const { min, max } = bounds(); out.push(`  As a tax-setter: /contract price <1|2|3> <gold> (${min} to ${max}), /contract budget <gold a week> (0 to ${budgetMax()}), /contract postbudget <gold a week>, /contract standing on|off.`); }
    return out;
  };
  // An official's change to the hold's terms: { text } or { error }. Shared by the chat and any later panel
  const setTerms = (a, zone, what, args) => {
    if (!setsTerms(a, zone.id)) { refused('not an official', a, zone.id); return { error: `Only those who set ${zone.name}'s tax set the terms of its standing contracts.` }; }
    const h = holdState(zone.id);
    let text;
    if (what === 'price') {
      const tier = Number(args[0]), gold = Number(args[1]);
      const { min, max } = bounds();
      if (![1, 2, 3].includes(tier) || !Number.isInteger(gold)) return { error: `Use: /contract price <1|2|3> <gold>, from ${min} to ${max} gold a kill.` };
      if (gold < min || gold > max) return { error: `Pay per kill runs from ${min} to ${max} gold.` };
      const was = priceOf(zone.id, tier);
      h.prices = Object.assign({}, h.prices, { [tier]: gold });
      // Notices already up at the old price come down (their gold back to the treasury) and fresh ones go up at the new
      const old = state.contracts.filter((c) => c.zone === zone.id && isStanding(c) && (DANGER[c.kind] || 1) === tier);
      state.contracts = state.contracts.filter((c) => old.indexOf(c) === -1);
      saveNow();
      for (const c of old) if (Number(c.held) > 0 && !refundToTreasury(zone, Number(c.held))) log(`contracts: ${c.held} gold of re-priced notice ${c.id} could not go back to ${zone.id}`);
      text = `${zone.name} now pays ${gold} gold a kill for ${TIER_WORD[tier]} (tier ${tier}; was ${was}). Contracts already taken keep their pay.`;
    } else if (what === 'budget') {
      const gold = Number(args[0]);
      if (!Number.isInteger(gold) || gold < 0 || gold > budgetMax()) return { error: `Use: /contract budget <gold a week>, from 0 to ${budgetMax()}. 0 pays no standing contracts.` };
      const was = budgetOf(zone.id);
      h.budget = gold;
      text = `${zone.name}'s standing contracts may now commit ${gold} gold a week (was ${was}); ${budgetLeft(zone.id)} is left this week.`;
    } else if (what === 'postbudget') {
      const gold = Number(args[0]);
      if (!Number.isInteger(gold) || gold < 0 || gold > budgetMax()) return { error: `Use: /contract postbudget <gold a week>, from 0 to ${budgetMax()}. 0 lets no work be posted by hand.` };
      const was = postBudgetOf(zone.id);
      h.postBudget = gold;
      text = `${zone.name}'s posted work and commissions may now commit ${gold} gold a week (was ${was}); ${postLeft(zone.id)} is left this week.`;
    } else {
      const v = String(args[0] || '').toLowerCase();
      if (v !== 'on' && v !== 'off') return { error: 'Use: /contract standing on|off' };
      h.standing = v === 'on';
      text = v === 'on' ? `${zone.name} posts standing contracts again.` : `${zone.name} posts no standing contracts; those up now come down and their gold goes back to the treasury. Contracts already taken run on.`;
    }
    h.by = ownName(a); h.at = Date.now();
    saveNow();
    audit(`CONTRACT ${who(a)} set ${zone.name} ${what} ${args.join(' ')}: ${text}`);
    refresh();
    return { text };
  };
  const ownName = (a) => { try { return String(display(a) || who(a)); } catch (e) { return String(who(a)); } };
  // The creatures of each danger tier, for the Court tab's labels (plural names, the zero tier left out)
  const kindsOfTier = (t) => Object.keys(DANGER).filter((k) => DANGER[k] === t).map(plural);
  // For the Court tab (court.js courtContract*): the same view and the same rules as the chat. spent, tiers, by and at
  // were added for that tab (18 Oct); by/at are the official who last changed the terms and when ('' / 0: never)
  globalThis.__dboContractTerms = {
    view: (a, zid) => { const z = zoneById(zid); if (!z) return null; const h = state.holds[z.id] || {};
      return { prices: { 1: priceOf(z.id, 1), 2: priceOf(z.id, 2), 3: priceOf(z.id, 3) }, budget: budgetOf(z.id), left: budgetLeft(z.id), standing: standingOn(z.id),
        citizensOnly: citizensOnly(z.id), resetsAt: resetsAt(), canSet: setsTerms(a, z.id), bounds: bounds(), budgetMax: budgetMax(),
        spent: Math.max(0, Math.floor(Number(holdState(z.id).spent) || 0)), enabled: CFG.enabled !== false,
        tiers: [1, 2, 3].map((t) => ({ tier: t, name: TIER_WORD[t], price: priceOf(z.id, t), kinds: kindsOfTier(t) })),
        by: h.by ? String(h.by) : '', at: Number(h.at) || 0,
        // Posting by hand and commissions (Nat, 25 Oct): the hold's own fauna with its cap per kill, the week's pool, what is up
        canPost: isOfficial(a, z.id), postBudget: postBudgetOf(z.id), postLeft: postLeft(z.id), postsPerDay: postsPerDay(), postsLeftToday: postsPerDay() ? Math.max(0, postsPerDay() - postsToday(a).length) : null,
        fauna: Object.keys(kindsByZone[z.id] || {}).filter((k) => (DANGER[k] || 0) > 0).map((k) => ({ kind: k, name: plural(k), tier: DANGER[k], perKill: priceOf(z.id, DANGER[k]), spots: kindsByZone[z.id][k] })).sort((x, y) => x.tier - y.tier || y.spots - x.spots),
        posted: zoneContracts(z.id).filter((c) => !isStanding(c)).map((c) => ({ id: c.id, type: c.type === 'commission' ? 'commission' : 'hunt', what: describe(c), by: String(c.byName || ''),
          held: Number(c.held) || 0, hoursLeft: Math.max(0, Math.ceil((c.expiresAt - Date.now()) / 3600000)), mine: postedBy(c, a), canWithdraw: postedBy(c, a) || setsTerms(a, z.id) })),
        search: searches.get(a >>> 0) || null,
        commissionMaxCount: Math.floor(num(CFG.commissionMaxCount, 200)) }; },
    set: (a, zid, what, args) => { const z = zoneById(zid); return z ? setTerms(a, z, String(what), [].concat(args || []).map(String)) : { error: 'There is no such hold.' }; },
    post: (a, zid, kind, count, reward) => { const z = zoneById(zid); return z ? postContract(a, z, kind, count, reward) : { error: 'There is no such hold.' }; },
    commission: (a, zid, item, count, price) => { const z = zoneById(zid); return z ? postCommission(a, z, item, count, price) : { error: 'There is no such hold.' }; },
    withdraw: (a, zid, id) => { const z = zoneById(zid); return z ? withdraw(a, z, id) : { error: 'There is no such hold.' }; },
    search: (a, zid, q) => search(a, q),
  };

  // The list is its own function so /contract with no words can show it, and /contracts survives as an alias
  const listContracts = (a) => {
    refresh();
    const zone = playerZone(a);
    if (!zone) return personal(a, 'No hold claims this ground, so there is no work posted here.');
    const list = zoneContracts(zone.id);
    if (!list.length) return personal(a, `${zone.name} has no work posted. Its coffers may be empty.`);
    personal(a, `Work posted in ${zone.name} (treasury ${treasuryGold(zone)} gold; standing work ${budgetLeft(zone.id)} of ${budgetOf(zone.id)} gold left this week):`);
    const restricted = citizensOnly(zone.id);
    list.forEach((c, i) => personal(a, `  ${i + 1}. ${describe(c)}${c.type === 'commission' ? ', a commission: /contract deliver ' + (i + 1) : isStanding(c) ? (restricted ? `, standing, citizens of ${zone.name} only` : ', standing') : ', posted by an official, open to all'}`));
    personal(a, CFG.enabled ? 'Take one on the Contracts tab of the expedition board, or with /contract take <number>.' : OFF_TEXT);
  };

  registerChatCommand('contracts', listContracts, { hidden: true, help: 'the work posted here; /contract shows it too' });
  registerChatCommand('contract', (a, args) => {
    const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
    const verb = (parts[0] || '').toLowerCase();
    const work = takenBy(a) ? copiesOf(a) : [];

    // No words: what you hold, then what is posted here. Two commands' worth in one answer.
    if (!verb) {
      if (work.length) {
        personal(a, `You hold ${work.length} of ${maxActive()} contracts:`);
        work.forEach((w, i) => personal(a, `  ${i + 1}. ${describe(w, Number(w.progress) || 0)}`));
      }
      return listContracts(a);
    }

    if (verb === 'take') {
      if (!CFG.enabled) return personal(a, OFF_TEXT);
      const zone = playerZone(a);
      if (!zone) return personal(a, 'There is no work posted on this ground.');
      const c = zoneContracts(zone.id)[Math.max(1, Number(parts[1]) || 1) - 1];
      if (!c) return personal(a, 'No such contract. /contracts lists them.');
      return personal(a, takeContract(a, c, zone));
    }

    if (verb === 'abandon') return personal(a, abandonContract(a, parts[1]));

    // post <creature words> <count> <reward> and commission <goods words> <count> <gold each>: the last two words are numbers
    if (verb === 'post' || verb === 'commission') {
      if (!CFG.enabled) return personal(a, OFF_TEXT);
      const zone = playerZone(a);
      if (!zone) return personal(a, 'You stand outside any hold.');
      const nums = parts.slice(-2), words = parts.slice(1, -2).join(' ');
      if (parts.length < 4 || !nums.every((n) => /^\d+$/.test(n))) return personal(a, verb === 'post' ? 'Use: /contract post <creature> <count> <reward>' : 'Use: /contract commission <goods> <count> <gold each>');
      const r = verb === 'post' ? postContract(a, zone, words, nums[0], nums[1]) : postCommission(a, zone, words, nums[0], nums[1]);
      return personal(a, r.error || r.text);
    }

    // deliver <number on the list> [count]: hand in goods for a commission posted here
    if (verb === 'deliver') {
      const zone = playerZone(a);
      if (!zone) return personal(a, 'There is no work posted on this ground.');
      const c = zoneContracts(zone.id)[Math.max(1, Number(parts[1]) || 1) - 1];
      if (!c || c.type !== 'commission') return personal(a, 'That is not a commission. /contract lists the work posted here.');
      const r = deliver(a, c, parts[2]);
      return personal(a, r.error || r.text);
    }

    if (verb === 'withdraw') {
      const zone = playerZone(a);
      if (!zone) return personal(a, 'You stand outside any hold.');
      const c = zoneContracts(zone.id)[Math.max(1, Number(parts[1]) || 0) - 1];
      if (!c) return personal(a, 'No such notice. /contract lists them.');
      const r = withdraw(a, zone, c.id);
      return personal(a, r.error || r.text);
    }

    if (verb === 'status') {
      const named = parts.slice(1).join(' ').toLowerCase();
      const zone = named ? zoneList().find((z) => z.id === named || String(z.name || '').toLowerCase() === named) || null : playerZone(a);
      if (!zone) return personal(a, named ? `No hold is called ${parts.slice(1).join(' ')}.` : 'You stand outside any hold. /contract status <hold> names one.');
      for (const line of statusLines(a, zone)) personal(a, line);
      return;
    }

    if (verb === 'price' || verb === 'budget' || verb === 'standing' || verb === 'postbudget') {
      const zone = playerZone(a);
      if (!zone) return personal(a, 'You stand outside any hold.');
      const r = setTerms(a, zone, verb, parts.slice(1));
      return personal(a, r.error || r.text);
    }

    return personal(a, 'Use: /contract, /contract take <n>, /contract abandon [n], /contract deliver <n> [count], /contract status [hold]; officials: /contract post <creature> <count> <reward>, /contract commission <goods> <count> <gold each>, /contract withdraw <n>; tax-setters: /contract price <1|2|3> <gold>, /contract budget <gold>, /contract postbudget <gold>, /contract standing on|off.');
  }, { help: 'take, post or hand in work; /contract status shows a hold\'s pay, budgets and who may take its standing work' });

  // Contracts taken under the one-notice rule keep working, as copies with their progress
  {
    let moved = 0;
    for (const key of Object.keys(state.taken)) {
      const raw = rawList(key);
      if (!raw.some((w) => !w.kind && contractById(w.id)) && Array.isArray(state.taken[key])) continue;
      putList(key, raw.map((w) => (w.kind ? w : migrate(key, w) || w)));
      moved++;
    }
    if (moved) saveNow();
  }
  // refresh() reads each zone's treasury inventory, which cost 4.2 s of the boot block at module load
  // (CAPACITY_PLAN, 24 Oct). The first one runs just after boot instead, off the require path, and the
  // summary goes with it so it still counts what the refresh posted.
  const firstRefresh = () => {
    try { refresh(); } catch (e) { log('contracts: the first refresh failed', e.message); }
    log(`contracts ${CFG.enabled ? 'on' : 'off'}: ${state.contracts.length} posted across ${Object.keys(kindsByZone).length} zone(s) with known fauna, ${perZone} per zone, rewards held from the zone treasury`);
  };
  // Deferred on the server, where there is a timer; inline anywhere there is not, so a harness with a
  // plain api object still loads the module and sees the same state it always did.
  if (typeof every === 'function') {
    let firstRefreshDone = false;
    every('contracts.firstRefresh', 2000, () => { if (firstRefreshDone) return; firstRefreshDone = true; firstRefresh(); });
  } else firstRefresh();
};
