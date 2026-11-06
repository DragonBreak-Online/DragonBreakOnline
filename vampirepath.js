// DragonBreak Online: the vampire's path (Nat, 31 Oct; proposal _work\vampires-feral-1031.md on the PC, approved with Feral
// lethal to players). Loaded by gamemode.js after supernatural.js, bloodranks.js and frenzy.js; each asks this file through
// globalThis hooks when it runs, and without it nothing of theirs changes.
//
// Feral       the thirst takes a vampire at stage 3-4: a chance each real minute (feral.perMinute by stage), more at night,
//             while the sun burns them, and with a downed or bleeding player near (blood scent); and one roll each time their
//             health falls through feral.atBayHealth (at bay). A warning first (lines and screen shakes, as the werewolf's
//             forced change), then the vampire's own client is driven against the nearest living thing (frenzy.js, kind
//             'vampire', lethal to players as the werewolf's frenzy is) for feral.seconds; a kill is a meal and ends it. Any
//             blood (a feed, a bottle, the chalice) ends the warning or the Feral; so do bound hands. While Feral: hits
//             feral.damageMult harder, the sun feral.sunMult worse. Never: the Crown's holder, a vampire not yet fed for the
//             first time, in the login grace, a rite, a duel, downed, bound or jailed.
// Molag Bal   devotion (private.molagDevotion) grows only while Molag Bal is the character's patron (prayer.js faiths): a
//             prayer at his shrine (once a game day), a living person fed on (once per victim account a real day), a filled
//             black soul gem offered at his shrine (/offer, which also calms the thirst one stage), and each real day sworn.
//             Another patron resets it. Tiers (tiers): Sworn, Devout, Chosen, and a sworn pure-blood (pure): the Feral's chance
//             falls (feral ×), the Drain spells land harder (power ×), and every use of a power that lands on someone rolls a
//             backlash (backlash): the thirst jumps a stage, Molag Bal takes his price in health, or a Feral flare.
// Bloodline   Molag Bal's Embrace (supernatural.js /rite) is offered only to a vampire of embraceTier (Devout) or above.
// Elders      a pure-blood of blood rank elder.rank (Master Vampire). They sense the Crown's holder in the same world or
//             interior by bands (sense.bands: distance only, never where), and the holder feels the hunt.
// The drain   the Crown's holder can be ended for good only by an Elder feeding on them while they are down, held for
//             drain.seconds (a blow on the Elder or a step away breaks it, supernatural.js's feed rules). Then the holder's
//             character ends (__dboPermaKill) and the Crown passes to the Elder. Never within drain.shieldHours of the holder
//             taking the Crown, before they have been online drain.onlineMinutes this session, in a duel, in jail or in a
//             safe place (cities are allowed: Nat via the Leader, 31 Oct). A safe place: a jail cell, an interior whose
//             location is a temple, inn or home (safe.keywords, verified in Skyrim.esm; Bruma's carry them in BSHeartland),
//             or safe.cells. This file also answers frenzy.js's __dboSafeZone, so no frenzy picks a target there.
// Bloodlines  (Nat, 31 Oct; _work\vampire-bloodlines-build-1031.md) a vampire's clan gives its line (bloodlines.clans, the
//             guild-defs id): leave the clan and the line goes with it, read live from the faction rolls. Each gift and cost
//             is a lever the server already owns:
//               Volkihar    a living feed chills the victim (the client's dboStatus chill, as a frost spell's); frost hits
//                           them frostTaken as hard (gamemode.js damage chain, the target side, under the racial cap)
//               Cyrodiilic  they pass for mortal tellsShift stages of thirst longer (supernatural.js tells); the sun burns
//                           sunMult and fire fireTaken as hard (__dboVampSunMult, supernatural.js's weakness multiplier)
//               Keerilth    /mist: for mist.seconds no blow lands on them and they land none (gamemode.js's ethereal gate,
//                           the Vampire Lord's Mist Form's), once every mist.cooldownMinutes; every blow on them lands
//                           damageTaken as hard
//               Berne       sneak attacks and bare fists land sneakMult / unarmedMult as hard, their spells spellMult
//             A vampire in none of the clans is a bloodfiend: no line, the Feral bloodfiend.feralMult as often, and Molag
//             Bal's path stops at tier bloodfiend.maxTier (Sworn); an Elder, the Embrace and a claim to the Crown need a
//             clan. House Ravenwatch keeps a code instead of a line: no path of Molag Bal at all (no tier, no Elder, no
//             Embrace, no Crown, and the Crown's holder cannot join), its Drain and night strength at powerMult, blood
//             ranks at bloodMult a feed, and a feed only on a player who offers their neck or an outlaw (a bounty in
//             outlaws.json). A body they brought down themselves, or a Feral's kill, breaks the code: the thirst at
//             breach.thirstStage, the sun breach.sunMult as hard and the Feral back for breach.hours, and a second breach
//             within breach.windowDays ends their place in the house. While the code holds, the thirst never turns them
//             Feral. The Crown's holder is grandfathered: none of the bloodfiend rules touch them.
//             bloodlines.enabled false undoes all of it (hot reload).
// Config gamemode-config.json "vampirePath"; enabled false is the off switch (hot reload). /bloodline shows a vampire their
// path; staff: /vampath <player|me> status|devotion <n>|feral|calm.
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  enabled: true,
  feral: {
    enabled: true,
    perMinute: [0, 0, 0.01, 0.04],      // by thirst stage 1-4
    nightMult: 1.5, sunMult: 2, sunRecentSeconds: 30,
    scentMult: 5, scentMeters: 15,
    atBayHealth: 0.25, atBayChance: 0.2,
    warnSeconds: 90, flareWarnSeconds: 20,
    seconds: [30, 60],
    damageMult: 1.15, sunBurnMult: 1.2,
    blockMinutes: 30,                   // after a Feral that drank nothing, before the next roll
    loginGraceMinutes: 5,
    lines: [
      { at: 70, text: 'Your teeth ache and your mouth runs dry. The thirst is rising.' },
      { at: 45, text: 'The smell of blood is everywhere. Get away from people, or drink.' },
      { at: 20, text: 'The red is at the edge of your sight. Seconds now.' },
    ],
    shakes: [{ at: 90, strength: 0.1, seconds: 2 }, { at: 70, strength: 0.15, seconds: 2 }, { at: 45, strength: 0.25, seconds: 2.5 }, { at: 20, strength: 0.4, seconds: 3 }, { at: 5, strength: 0.6, seconds: 3 }],
  },
  devotion: { prayer: 5, livingFeed: 10, offering: 15, dailySworn: 2, feedEveryHours: 24 },
  tiers: [
    { name: 'Sworn', at: 0, feral: 0.8, power: 1.1, backlash: 0.03 },
    { name: 'Devout', at: 150, feral: 0.5, power: 1.2, backlash: 0.06 },
    { name: 'Chosen', at: 400, feral: 0.25, power: 1.35, backlash: 0.1 },
  ],
  pure: { name: 'Pure-blood', feral: 0.15, power: 1.5, backlash: 0.12 },
  embraceTier: 1,
  backlash: { useWindowSeconds: 10, weights: { thirst: 3, price: 2, flare: 1 }, priceHealth: 0.25 },
  offering: { item: '2e504:Skyrim.esm', shrineMemoryMs: 120000 },
  elder: { rank: 4 },
  sense: {
    enabled: true, everySeconds: 30, hunted: 'Something old is hunting your blood.', huntedEveryMs: 120000,
    bands: [
      { name: 'close', meters: 50, shake: 0.25, repeat: true, text: 'The Crown is close enough to taste.' },
      { name: 'near', meters: 250, shake: 0.1, text: 'The Crown is near. You can feel its pulse.' },
      { name: 'faint', meters: 1000, shake: 0, text: 'Somewhere in this land the Crown\'s blood is awake.' },
    ],
  },
  drain: { enabled: true, seconds: 15, shieldHours: 48, onlineMinutes: 10 },
  safe: {
    // LocTypeTemple, LocTypeInn, LocTypeHouse, LocTypePlayerHouse, LocTypeJail (Skyrim.esm KYWD, read 31 Oct)
    keywords: ['1cd56:Skyrim.esm', '1cb87:Skyrim.esm', '1cb85:Skyrim.esm', 'fc1a3:Skyrim.esm', '1cd59:Skyrim.esm'],
    cells: [],
  },
  bloodlines: {
    enabled: true,
    clans: { 'clan-volkihar': 'volkihar', 'cyrodiil-vampyrum-order': 'cyrodiilic', 'bloodmist-clan': 'keerilth', 'crimson-scars': 'berne', 'house-ravenwatch': 'ravenwatch' },
    lines: {
      volkihar: { name: 'Volkihar', frostTaken: 0.85, feedChill: { seconds: 6, speedMult: -40, text: 'Cold spreads from the bite. Your limbs are slow.' } },
      cyrodiilic: { name: 'Cyrodiilic', tellsShift: 1, sunMult: 1.25, fireTaken: 1.25 },
      keerilth: { name: 'Keerilth', mist: { seconds: 4, cooldownMinutes: 10 }, damageTaken: 1.1 },
      berne: { name: 'Berne', sneakMult: 1.15, unarmedMult: 1.15, spellMult: 0.9 },
    },
    bloodfiend: { feralMult: 1.5, maxTier: 0 },
    ravenwatch: { name: 'Ravenwatch', powerMult: 0.5, bloodMult: 0.5, breach: { hours: 24, thirstStage: 4, sunMult: 1.5, windowDays: 7 } },
  },
};
const merge = (d, o) => {
  const out = Object.assign({}, d, o || {});
  for (const k of ['feral', 'devotion', 'pure', 'backlash', 'offering', 'elder', 'sense', 'drain', 'safe']) out[k] = Object.assign({}, d[k], (o || {})[k] || {});
  // bloodlines: each line, the bloodfiend, Ravenwatch and its breach merged key by key, so a partial override keeps the rest
  const bd = d.bloodlines, bo = (o || {}).bloodlines || {};
  const lines = {};
  for (const k of new Set(Object.keys(bd.lines).concat(Object.keys(bo.lines || {})))) lines[k] = Object.assign({}, bd.lines[k], (bo.lines || {})[k] || {});
  const rw = Object.assign({}, bd.ravenwatch, bo.ravenwatch || {});
  rw.breach = Object.assign({}, bd.ravenwatch.breach, (bo.ravenwatch || {}).breach || {});
  out.bloodlines = Object.assign({}, bd, bo, { clans: Object.assign({}, bd.clans, bo.clans || {}), lines, bloodfiend: Object.assign({}, bd.bloodfiend, bo.bloodfiend || {}), ravenwatch: rw });
  return out;
};

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, sendPacket, onlineActors, every, registerChatCommand, profileOf, cfg, isLeadStaff, findByName } = api;
  const inEditor = typeof api.inEditor === 'function' ? api.inEditor : () => false;
  const C = merge(DEFAULTS, cfg.vampirePath);
  const S = globalThis.__dboVampPath || (globalThis.__dboVampPath = { due: new Map(), feral: new Map(), blocked: new Map(), lastUse: new Map(), atBay: new Map(), band: new Map(), huntedAt: new Map(), timers: new Map() });
  // bloodlines: the line last told (actor -> id), a Keerilth's mist (actor -> until) and its cooldown, a feed that will break
  // Ravenwatch's code when it finishes (feeder -> victim)
  for (const k of ['lineTold', 'mist', 'mistAt', 'breachFeed']) if (!(S[k] instanceof Map)) S[k] = new Map();
  const DEV = 'private.molagDevotion';
  const UNITS = 70;
  const now = () => Date.now();
  const on = () => C.enabled !== false;

  // ---- reads ----------------------------------------------------------------------------------------------------------
  const hook = (h, ...a) => { try { return typeof globalThis[h] === 'function' ? globalThis[h](...a) : undefined; } catch (e) { log(`vampirepath: ${h} failed: ${e.message}`); return undefined; } };
  const get = (a, k, d) => { try { const v = mp.get(a, k); return v === undefined || v === null ? d : v; } catch (e) { return d; } };
  const isPlayer = (a) => Number(profileOf(a)) >= 0;
  const online = (a) => onlineActors().some((x) => (Number(x) >>> 0) === (a >>> 0));
  const vamp = (a) => { const s = hook('__dboSuperVampState', a >>> 0); return s && s.kind === 'vampire' ? s : null; };
  const crownHolder = () => Number(hook('__dboSuperCrownHolder')) >>> 0;
  const rank = (a) => Math.max(0, Math.floor(Number(hook('__dboBloodRank', a >>> 0)) || 0));
  const patron = (a) => { const f = hook('__dboFaithOf', a >>> 0); return f && f.patron ? String(f.patron) : ''; };
  const sworn = (a) => patron(a) === 'molagbal';
  const downed = (a) => !!hook('__dboIsDowned', a >>> 0);
  const dead = (a) => get(a, 'isDead', false) === true;
  const bound = (a) => { const r = get(a, 'private.restrained', null); return !!(r && (r.boundHands || r.carried || r.captorActorId)); };
  const jailed = (a) => { const s = get(a, 'private.dboSentence', null); return !!(s && Number(s.totalMs) > 0); };
  const inDuel = (a) => !!hook('__dboInDuel', a >>> 0);
  const inRite = (a) => globalThis.__dboRites instanceof Map && globalThis.__dboRites.has(a >>> 0);
  const loginAt = (a) => (globalThis.__dboSuperLoginAt instanceof Map ? Number(globalThis.__dboSuperLoginAt.get(a >>> 0)) || 0 : 0);
  const place = (a) => ({ world: String(get(a, 'worldOrCellDesc', '')), pos: get(a, 'pos', null) });
  const meters = (p, q) => (p.world && p.world === q.world && Array.isArray(p.pos) && Array.isArray(q.pos)
    ? Math.hypot(p.pos[0] - q.pos[0], p.pos[1] - q.pos[1], p.pos[2] - q.pos[2]) / UNITS : Infinity);
  const isNight = () => { const c = globalThis.__dboClock; try { return !!(c && c.isNight()); } catch (e) { return false; } };
  const idOf = (d) => { try { return mp.getIdFromDesc(String(d)) >>> 0; } catch (e) { return 0; } };
  const shake = (a, strength, seconds) => { if (strength > 0) { try { sendPacket(a, { customPacketType: 'dboShake', strength, seconds }); } catch (e) { /* offline */ } } };
  const banner = (a, text, seconds) => { try { sendPacket(a, { customPacketType: 'dboBanner', text, seconds: seconds || 5 }); } catch (e) { /* old client */ } personal(a, text); };

  // ---- bloodlines -------------------------------------------------------------------------------------------------------
  const BL = C.bloodlines;
  const blOn = () => on() && BL.enabled !== false;
  const fitsElement = typeof api.fitsElement === 'function' ? api.fitsElement : () => false;
  const isMagicSource = typeof api.isMagicSource === 'function' ? api.isMagicSource : () => false;
  const UNARMED = 0x1f4; // the engine's bare-hands source (TES5DamageFormula IsUnarmedAttack; downed.js, martial.js)
  // { id, clan, name } for a vampire: a line, 'ravenwatch', or 'bloodfiend' (no clan); null for anyone else or with it off
  const bloodlineOf = (a) => {
    if (!blOn() || !vamp(a)) return null;
    const mine = hook('__dboGuildsOf', a >>> 0);
    for (const g of Array.isArray(mine) ? mine : []) {
      const id = BL.clans[String(g && g.id)];
      if (!id) continue;
      const def = id === 'ravenwatch' ? BL.ravenwatch : BL.lines[id];
      if (def) return { id, clan: String(g.id), name: String(def.name || id) };
    }
    return { id: 'bloodfiend', clan: '', name: 'bloodfiend' };
  };
  const lineDef = (a) => { const l = bloodlineOf(a); return l && BL.lines[l.id] ? BL.lines[l.id] : null; };
  const isRaven = (a) => { const l = bloodlineOf(a); return !!l && l.id === 'ravenwatch'; };
  // The Crown's holder is grandfathered: never a bloodfiend in the rules' eyes (build note section 4)
  const isFiend = (a) => { const l = bloodlineOf(a); return !!l && l.id === 'bloodfiend' && crownHolder() !== (a >>> 0); };
  // A line that may walk Molag Bal's path past Sworn, be an Elder, take the Embrace or claim the Crown: any but these two
  const hasGiftedLine = (a) => { const l = bloodlineOf(a); return !l || (l.id !== 'bloodfiend' && l.id !== 'ravenwatch'); };
  // Ravenwatch's code: private.dboRavenCode { breaches: [ms], until } (until: the penalty's end)
  const CODE = 'private.dboRavenCode';
  const codeOf = (a) => { const c = get(a, CODE, null); return Object.assign({ breaches: [], until: 0 }, c && typeof c === 'object' ? c : {}); };
  const codeBroken = (a) => Number(codeOf(a).until) > now();
  const outlaw = (t) => {
    const pid = String(profileOf(t));
    if (!(Number(pid) >= 0)) return false;
    let zones = globalThis.__dboOutlaws && globalThis.__dboOutlaws.data && globalThis.__dboOutlaws.data.zones;
    if (!zones) { try { zones = JSON.parse(fs.readFileSync(path.resolve('outlaws.json'), 'utf8')).zones; } catch (e) { zones = null; } }
    if (!zones) return false;
    const hexId = (Number(t) >>> 0).toString(16);
    return Object.values(zones).some((z) => {
      if (!z) return false;
      if (z[hexId] && Number(z[hexId].amount) > 0) return true;
      for (const [k, b] of Object.entries(z)) {
        if (!b || !(Number(b.amount) > 0)) continue;
        if (b.actor && (Number(b.actor) >>> 0) === (Number(t) >>> 0)) return true;
        if (b.char && String(b.char).toLowerCase() === hexId) return true;
      }
      if (z[pid] && Number(z[pid].amount) > 0) {
        const b = z[pid];
        if (!b.actor && !b.char) return true;
      }
      return false;
    });
  };
  const breach = (a, why) => {
    a = a >>> 0;
    const B = BL.ravenwatch.breach;
    const c = codeOf(a);
    const window = Number(B.windowDays) * 86400000;
    c.breaches = (Array.isArray(c.breaches) ? c.breaches : []).filter((t) => now() - Number(t) < window).concat([now()]);
    c.until = now() + Number(B.hours) * 3600000;
    try { mp.set(a, CODE, c); } catch (e) { log(`vampirepath: code save failed: ${e.message}`); }
    const l = bloodlineOf(a);
    audit(`VAMPATH ${who(a)} broke the Ravenwatch code (${why}); ${c.breaches.length} in ${B.windowDays} days`);
    if (c.breaches.length >= 2 && l && l.clan && hook('__dboGuildLeave', a, l.clan) === true) {
      banner(a, 'You have broken the code twice. House Ravenwatch casts you out: you are a bloodfiend now.', 8);
      audit(`VAMPATH ${who(a)} cast out of House Ravenwatch for a second breach`);
      return;
    }
    hook('__dboSuperSetThirst', a, Math.max(1, Math.min(4, Number(B.thirstStage) || 4)), 'broke the Ravenwatch code');
    banner(a, `You fed to the kill, and the code is broken. For ${B.hours} hours the thirst rages, the sun burns deeper and the red haze can take you. Break it again within ${B.windowDays} days and the house casts you out.`, 8);
  };

  // ---- devotion and tiers -------------------------------------------------------------------------------------------
  const devOf = (a) => { const d = get(a, DEV, null); return Object.assign({ points: 0, prayerDay: -1, dailyAt: 0, fedOn: {} }, d && typeof d === 'object' ? d : {}); };
  const saveDev = (a, d) => { try { mp.set(a, DEV, d); } catch (e) { log(`vampirepath: devotion save failed: ${e.message}`); } };
  const tierIndex = (points) => { let i = 0; C.tiers.forEach((t, k) => { if (points >= Number(t.at)) i = k; }); return i; };
  // { name, feral, power, backlash, index } for this character now, or null when they are not on the path
  const tierOf = (a) => {
    if (!sworn(a) || isRaven(a)) return null;
    const v = vamp(a);
    // a bloodfiend stops at Sworn, a pure-blood among them too (bloodlines.bloodfiend.maxTier)
    const cap = isFiend(a) ? Math.max(0, Math.min(C.tiers.length - 1, Number(BL.bloodfiend.maxTier) || 0)) : Infinity;
    if (v && v.pure && cap === Infinity) return Object.assign({ index: C.tiers.length }, C.pure);
    const i = Math.min(cap, tierIndex(Number(devOf(a).points) || 0));
    return Object.assign({ index: i }, C.tiers[i]);
  };
  const addDevotion = (a, n, why) => {
    if (!on() || !(n > 0) || !sworn(a) || isRaven(a)) return 0;
    const d = devOf(a); const before = tierIndex(d.points);
    d.points = (Number(d.points) || 0) + n; saveDev(a, d);
    const after = tierIndex(d.points);
    if (after > before && vamp(a) && isFiend(a)) personal(a, `Molag Bal knows you better now, but he raises no bloodfiend past ${C.tiers[Math.max(0, Number(BL.bloodfiend.maxTier) || 0)].name}. Join a clan, and his path opens.`);
    else if (after > before && vamp(a)) {
      banner(a, `Molag Bal knows you better now. You are ${C.tiers[after].name}.`, 6);
      audit(`VAMPATH ${who(a)} rose to ${C.tiers[after].name} (${d.points} devotion, ${why})`);
    }
    return n;
  };
  // Another patron empties it (checked whenever the path is read; prayer.js's own conversion clock stops the flipping)
  const checkPatron = (a) => { const d = get(a, DEV, null); if (d && Number(d.points) > 0 && !sworn(a)) { saveDev(a, { points: 0, prayerDay: -1, dailyAt: 0, fedOn: {} }); audit(`VAMPATH ${who(a)} left Molag Bal; devotion ${d.points} lost`); } };
  // An Elder needs a clan of a line (bloodlines): never a bloodfiend, never Ravenwatch
  const isElder = (a) => { const v = vamp(a); return !!(v && v.pure && rank(a) >= Number(C.elder.rank) && hasGiftedLine(a)); };

  // ---- safe places ------------------------------------------------------------------------------------------------------
  const safeKeywords = new Set((C.safe.keywords || []).map(idOf).filter(Boolean));
  const safeCells = new Set((C.safe.cells || []).map(idOf).filter(Boolean));
  const jailCells = (() => { try { return new Set((JSON.parse(fs.readFileSync(path.resolve('jail-cells.json'), 'utf8')).cells || []).map(idOf).filter(Boolean)); } catch (e) { return new Set(); } })();
  const cellSafe = globalThis.__dboVampSafeCells instanceof Map ? globalThis.__dboVampSafeCells : (globalThis.__dboVampSafeCells = new Map());
  const fieldOf = (res, type) => (res && res.record && res.record.fields || []).find((f) => f && f.type === type && f.data instanceof Uint8Array);
  const u32 = (f, at) => (f && f.data.byteLength >= at + 4 ? new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(at, true) : 0);
  // An interior cell is safe when it is a jail, a listed cell, or its location carries a safe keyword (cached per cell)
  const safeCell = (cellId) => {
    if (!cellId) return false;
    if (cellSafe.has(cellId)) return cellSafe.get(cellId);
    let safe = safeCells.has(cellId) || jailCells.has(cellId);
    if (!safe) {
      try {
        const cell = mp.lookupEspmRecordById(cellId);
        if (cell && cell.record && String(cell.record.type) === 'CELL') {
          const loc = u32(fieldOf(cell, 'XLCN'), 0);
          const locId = loc ? cell.toGlobalRecordId(loc) >>> 0 : 0;
          const lctn = locId ? mp.lookupEspmRecordById(locId) : null;
          const kw = fieldOf(lctn, 'KWDA');
          for (let i = 0; kw && i + 4 <= kw.data.byteLength; i += 4) if (safeKeywords.has(lctn.toGlobalRecordId(u32(kw, i)) >>> 0)) { safe = true; break; }
        }
      } catch (e) { safe = false; }
    }
    if (cellSafe.size > 4096) cellSafe.clear();
    cellSafe.set(cellId, safe);
    return safe;
  };
  const inSafePlace = (a) => {
    if (jailed(a)) return true;
    const w = String(get(a, 'worldOrCellDesc', ''));
    return !!w && safeCell(idOf(w));
  };
  globalThis.__dboSafeZone = (a) => on() && inSafePlace(Number(a) >>> 0);

  // ---- Feral --------------------------------------------------------------------------------------------------------
  const feralOn = () => on() && C.feral.enabled !== false;
  // Why this vampire cannot go Feral now, or ''
  const feralRefusal = (a, v) => {
    if (!v) return 'not a vampire';
    if (v.unfed) return 'never fed';
    if (crownHolder() === (a >>> 0)) return 'holds the Crown';
    if (isRaven(a) && !codeBroken(a)) return 'keeps the Ravenwatch code';
    if (!online(a) || dead(a) || downed(a)) return 'down';
    if (bound(a)) return 'bound';
    if (jailed(a)) return 'jailed';
    if (inDuel(a)) return 'duel';
    if (inRite(a)) return 'rite';
    if (inEditor(a)) return 'editor';
    if (now() - loginAt(a) < Number(C.feral.loginGraceMinutes) * 60000) return 'login grace';
    if (S.due.has(a) || S.feral.has(a) || hook('__dboFrenzyActive', a)) return 'already';
    return '';
  };
  const scentNear = (a) => {
    const p = place(a);
    return onlineActors().some((x) => { x = Number(x) >>> 0; return x !== (a >>> 0) && (downed(x) || (Number((get(x, 'percentages', {}) || {}).health) || 1) < 0.3) && meters(p, place(x)) <= Number(C.feral.scentMeters); });
  };
  // A bloodfiend's thirst turns Feral more often (bloodlines.bloodfiend.feralMult), each minute's roll and at bay alike
  const fiendFeral = (a) => (isFiend(a) ? Math.max(0, Number(BL.bloodfiend.feralMult) || 1) : 1);
  // The chance this minute
  const feralChance = (a, v) => {
    const base = Number((C.feral.perMinute || [])[Math.max(0, Math.min(3, (Number(v.stage) || 1) - 1))]) || 0;
    if (!(base > 0)) return 0;
    let p = base;
    if (isNight()) p *= Number(C.feral.nightMult) || 1;
    if (now() - (Number(hook('__dboSuperSunBurnAt', a)) || 0) < Number(C.feral.sunRecentSeconds) * 1000) p *= Number(C.feral.sunMult) || 1;
    if (scentNear(a)) p *= Number(C.feral.scentMult) || 1;
    const rate = Number(hook('__dboBloodThirstRate', a)); if (Number.isFinite(rate) && rate > 0) p *= rate;
    const t = tierOf(a); if (t) p *= Number(t.feral);
    return Math.min(1, p * fiendFeral(a));
  };
  const clearTimers = (a) => { for (const id of S.timers.get(a) || []) clearTimeout(id); S.timers.delete(a); };
  const later = (a, ms, fn) => { const id = setTimeout(() => { try { fn(); } catch (e) { log(`vampirepath: timer failed: ${e.message}`); } }, ms); const l = S.timers.get(a) || []; l.push(id); S.timers.set(a, l); };
  // The warning, then the Feral. flare: a backlash's short warning, which also comes at a low stage
  const beginFeral = (a, why, flare) => {
    a = a >>> 0;
    const v = vamp(a); const refused = feralRefusal(a, v);
    if (refused) { log(`vampirepath: ${display(a)} would go Feral (${why}) but ${refused}`); return false; }
    const lead = Math.max(0, Number(flare ? C.feral.flareWarnSeconds : C.feral.warnSeconds) || 0);
    S.due.set(a, { at: now(), until: now() + lead * 1000, why, flare: !!flare });
    banner(a, flare ? 'Molag Bal takes his price: the thirst floods you. Moments, no more.' : 'The thirst is rising in you. You have a minute or so: drink, or get away from people.', 5);
    audit(`VAMPATH feral warning ${who(a)} (${why})`);
    for (const x of flare ? [] : C.feral.lines || []) { const at = Math.min(lead, Number(x.at) || 0); if (at < lead) later(a, (lead - at) * 1000, () => { if (S.due.has(a)) personal(a, String(x.text)); }); }
    for (const x of C.feral.shakes || []) { const at = Math.min(lead, Number(x.at) || 0); later(a, (lead - at) * 1000, () => { if (S.due.has(a)) shake(a, Number(x.strength) || 0, Number(x.seconds) || 2); }); }
    later(a, lead * 1000, () => goFeral(a));
    return true;
  };
  const goFeral = (a) => {
    const due = S.due.get(a); S.due.delete(a);
    if (!due) return;
    const v = vamp(a);
    // Fed during the warning: thirst back under stage 3 (not for a flare, which comes at any stage)
    if (!v || (!due.flare && (Number(v.stage) || 1) < 3)) { personal(a, 'The thirst ebbs. You hold it, this time.'); return; }
    const refused = feralRefusal(a, v); if (refused && refused !== 'already') { log(`vampirepath: ${display(a)}'s Feral passed: ${refused}`); return; }
    const lo = Math.max(1, Number((C.feral.seconds || [])[0]) || 30), hi = Math.max(lo, Number((C.feral.seconds || [])[1]) || lo);
    const secs = Math.round(lo + Math.random() * (hi - lo));
    S.feral.set(a, { at: now(), until: now() + secs * 1000, why: due.why, fed: false });
    const frenzy = hook('__dboFrenzyVampire', a, { seconds: secs, by: due.why });
    if (frenzy) personal(a, 'The red haze takes you. You are faster, hungrier, and the sun is worse.');
    audit(`VAMPATH feral ${who(a)} for ${secs} s (${due.why})${frenzy ? `, no frenzy: ${frenzy}` : ', frenzied'}`);
    later(a, secs * 1000, () => endFeral(a, 'time'));
  };
  const endFeral = (a, why) => {
    a = a >>> 0;
    const due = S.due.get(a);
    if (due) { S.due.delete(a); clearTimers(a); personal(a, 'The blood calms you. The thirst lets go before it takes you.'); audit(`VAMPATH feral warning ended ${who(a)} (${why})`); return true; }
    const f = S.feral.get(a); if (!f) return false;
    S.feral.delete(a); clearTimers(a);
    if (hook('__dboFrenzyActive', a)) hook('__dboFrenzyEnd', a, `feral over: ${why}`);
    if (!f.fed && why !== 'fed') S.blocked.set(a, now() + Number(C.feral.blockMinutes) * 60000);
    audit(`VAMPATH feral end ${who(a)}: ${why}`);
    return true;
  };
  // frenzy.js: the frenzy ended on its own (time, no target, the vampire fell); the Feral ends with it
  globalThis.__dboFeralFrenzyEnded = (a, why) => { if (S.feral.has(a >>> 0)) endFeral(a, `frenzy ${why}`); };
  // frenzy.js: a feral vampire's kill is a meal
  globalThis.__dboFeralKilled = (a, victim) => {
    a = a >>> 0;
    const f = S.feral.get(a); if (f) f.fed = true;
    hook('__dboSuperFeralMeal', a);
    endFeral(a, 'fed');
    if (isRaven(a)) breach(a, 'a Feral kill');
  };
  // supernatural.js: any blood ends a warning or a Feral; a living victim is devotion for the sworn
  globalThis.__dboVampFed = (a, t, how) => {
    a = a >>> 0;
    if (S.due.has(a) || S.feral.has(a)) { const f = S.feral.get(a); if (f) f.fed = true; endFeral(a, 'fed'); }
    // Ravenwatch: a feed __dboVampFeedRefusal let through on one they brought down themselves breaks the code as it ends
    const owed = S.breachFeed.get(a); S.breachFeed.delete(a);
    if (owed && t && owed === (t >>> 0) && isRaven(a)) breach(a, 'fed on one they brought down');
    // Volkihar: a living victim takes the cold of the bite (the dboStatus chill a frost spell sends, client ParalysisService)
    const vl = bloodlineOf(a);
    if (how === 'living' && t && vl && vl.id === 'volkihar' && isPlayer(t)) {
      const ch = BL.lines.volkihar.feedChill || {};
      const secs = Math.max(0, Number(ch.seconds) || 0);
      if (secs > 0) { try { sendPacket(t >>> 0, { customPacketType: 'dboStatus', kind: 'chill', seconds: secs, speedMult: Math.max(-90, Math.min(0, Number(ch.speedMult) || 0)), text: String(ch.text || '') }); } catch (e) { /* offline */ } }
    }
    if (how === 'living' && t && isPlayer(t) && sworn(a)) {
      const pv = String(profileOf(t)), pa = String(profileOf(a));
      if (pv !== pa) {
        const d = devOf(a); const fedOn = Object.assign({}, d.fedOn);
        if (now() - (Number(fedOn[pv]) || 0) >= Number(C.devotion.feedEveryHours) * 3600000) {
          fedOn[pv] = now(); d.fedOn = fedOn; saveDev(a, d); addDevotion(a, Number(C.devotion.livingFeed), 'a living person fed on');
        }
      }
    }
  };
  // supernatural.js: the feral vampire's hits and the devout's Drain
  globalThis.__dboVampAggMult = (a, isDrain) => {
    if (!on()) return 1;
    let m = S.feral.has(a >>> 0) ? Number(C.feral.damageMult) || 1 : 1;
    if (isDrain) { const t = tierOf(a); if (t) m *= Number(t.power) || 1; }
    return m;
  };
  // The sun: worse while Feral, for a Cyrodiilic (bloodlines.lines.cyrodiilic.sunMult), and for a Ravenwatch who broke the code
  globalThis.__dboVampSunMult = (a) => {
    if (!on()) return 1;
    let m = S.feral.has(a >>> 0) ? Number(C.feral.sunBurnMult) || 1 : 1;
    const l = bloodlineOf(a);
    if (l && l.id === 'cyrodiilic') m *= Math.max(0, Number(BL.lines.cyrodiilic.sunMult) || 1);
    if (l && l.id === 'ravenwatch' && codeBroken(a)) m *= Math.max(0, Number(BL.ravenwatch.breach.sunMult) || 1);
    return m;
  };

  // ---- bloodlines: the hooks the damage chain, the feed, the tells, the Crown and the faction rolls ask -----------------
  // gamemode.js damage chain, the attacker's side: Berne's sneak attacks, fists and spells; Ravenwatch's Drain and night strength
  globalThis.__dboBloodlineAttackMult = (agg, tgt, src, flags) => {
    agg = agg >>> 0; src = Number(src) >>> 0;
    if (agg === (tgt >>> 0) || !isPlayer(agg)) return 1;
    const l = bloodlineOf(agg); if (!l) return 1;
    // a beast form's claws come as the bare-hands source; a Vampire Lord's are not a Berne's fists
    const beast = (() => { const b = get(agg, 'private.beast', null); return !!(b && b.form); })();
    if (l.id === 'berne') {
      const B = BL.lines.berne; const spell = !!(flags && flags.spell) || isMagicSource(src);
      if (spell) return Math.max(0, Number(B.spellMult) || 1);
      let m = 1;
      if (flags && flags.sneak) m *= Math.max(0, Number(B.sneakMult) || 1);
      if (src === UNARMED && !beast) m *= Math.max(0, Number(B.unarmedMult) || 1);
      return m;
    }
    if (l.id === 'ravenwatch') {
      const pm = Math.max(0, Math.min(1, Number(BL.ravenwatch.powerMult)));
      let m = 1;
      if (hook('__dboVampIsDrain', src) === true) m *= pm;
      // bloodranks.js's night strength already in the chain: only powerMult of its bonus is kept
      const night = Number(hook('__dboBloodDamageMult', agg, tgt >>> 0));
      if (night > 1) m *= (1 + (night - 1) * pm) / night;
      return m;
    }
    return 1;
  };
  // gamemode.js damage chain, the target's side (capped with the race's): Volkihar's frost
  globalThis.__dboBloodlineTargetMult = (agg, tgt, src) => {
    tgt = tgt >>> 0;
    if ((agg >>> 0) === tgt || !isPlayer(tgt)) return 1;
    const l = bloodlineOf(tgt);
    if (l && l.id === 'volkihar' && fitsElement('frost', Number(src) >>> 0)) return Math.max(0, Number(BL.lines.volkihar.frostTaken) || 1);
    return 1;
  };
  // supernatural.js __dboSuperDamageMult, a weakness on top of the capped chain: Cyrodiilic's fire, Keerilth's every blow
  globalThis.__dboVampTakenMult = (tgt, agg, src, fire) => {
    tgt = tgt >>> 0;
    if ((agg >>> 0) === tgt) return 1;
    const l = bloodlineOf(tgt); if (!l) return 1;
    if (l.id === 'cyrodiilic' && fire) return Math.max(1, Number(BL.lines.cyrodiilic.fireTaken) || 1);
    if (l.id === 'keerilth') return Math.max(1, Number(BL.lines.keerilth.damageTaken) || 1);
    return 1;
  };
  // supernatural.js tells: how many stages later than vampireTellsStage the thirst shows in a Cyrodiilic's eyes
  globalThis.__dboVampTellsShift = (a) => { const d = lineDef(a); return d && Number(d.tellsShift) > 0 ? Math.floor(Number(d.tellsShift)) : 0; };
  // supernatural.js feed: the blood rank a feed gives, Ravenwatch's at bloodMult
  globalThis.__dboVampBloodMult = (a) => (isRaven(a) ? Math.max(0, Number(BL.ravenwatch.bloodMult)) : 1);
  // supernatural.js startFeed: why this vampire may not feed here, or ''. Ravenwatch: a living player who offers their neck
  // (not under Seduction) or an outlaw; a body only one they brought down themselves, which breaks the code when it ends
  globalThis.__dboVampFeedRefusal = (a, t, o) => {
    a = a >>> 0; t = t >>> 0;
    S.breachFeed.delete(a);
    if (!isRaven(a)) return '';
    o = o || {};
    const downedPlayer = isPlayer(t) && downed(t);
    if (!o.onCorpse) {
      if ((o.willing && !o.seduced) || (isPlayer(t) && outlaw(t))) return '';
      return 'The Ravenwatch code: you drink only from one who offers their neck, or from an outlaw.';
    }
    if (downedPlayer && outlaw(t)) return '';
    const killer = globalThis.__dboSuperKilledBy instanceof Map ? Number(globalThis.__dboSuperKilledBy.get(t)) >>> 0 : 0;
    const by = downedPlayer ? Number(hook('__dboDownedBy', t)) >>> 0 : killer;
    if (by && by === a) { S.breachFeed.set(a, t); return ''; }
    return 'The Ravenwatch code: you do not drink from the fallen.';
  };
  // supernatural.js: why this vampire cannot take the Blood Crown (a vacant one, or by slaying its holder), or ''
  globalThis.__dboVampCrownRefusal = (a) => {
    if (!blOn()) return '';
    const l = bloodlineOf(a);
    if (l && l.id === 'ravenwatch') return 'House Ravenwatch takes nothing from Molag Bal: the Blood Crown is not for you.';
    if (l && l.id === 'bloodfiend') return 'Molag Bal gives the Blood Crown only to a vampire of a clan. You are a bloodfiend: no clan, no line.';
    return '';
  };
  // guilds.js setMember: the Crown's holder cannot join House Ravenwatch; they must lay the Crown down first
  globalThis.__dboVampJoinRefusal = (a, fid) => {
    if (!blOn() || BL.clans[String(fid)] !== 'ravenwatch' || crownHolder() !== (a >>> 0)) return '';
    return `${display(a)} holds the Blood Crown. House Ravenwatch takes no one who wears Molag Bal's gift: lay the Crown down first.`;
  };
  // gamemode.js: a Keerilth in mist is touched by nothing and touches nothing (the Vampire Lord's Mist Form gate)
  globalThis.__dboVampMist = (a) => blOn() && (Number(S.mist.get(a >>> 0)) || 0) > now();
  registerChatCommand('mist', (a) => {
    a = a >>> 0;
    const l = bloodlineOf(a);
    if (!l || l.id !== 'keerilth') return personal(a, 'Only the Keerilth blood knows the way into mist.');
    const v = vamp(a);
    if (!v || v.unfed) return personal(a, 'Your gifts sleep until you have fed.');
    if (dead(a) || downed(a) || bound(a) || jailed(a)) return personal(a, 'Not now.');
    const M = BL.lines.keerilth.mist || {};
    const wait = Number(M.cooldownMinutes) * 60000 - (now() - (Number(S.mistAt.get(a)) || 0));
    if (wait > 0) return personal(a, `The mist will not come again yet. ${Math.ceil(wait / 60000)} min.`);
    const secs = Math.max(1, Number(M.seconds) || 4);
    S.mistAt.set(a, now()); S.mist.set(a, now() + secs * 1000);
    banner(a, `You come apart into mist. For ${secs} seconds nothing can touch you, and you touch nothing.`, secs);
    audit(`VAMPATH ${who(a)} became mist for ${secs} s`);
  }, { help: 'Keerilth vampires: become mist for a few seconds, untouchable (every few minutes)' });

  every('vampFeral', 60000, () => {
    if (!feralOn()) return;
    for (const x of onlineActors()) {
      const a = Number(x) >>> 0;
      if (!isPlayer(a)) continue;
      checkPatron(a);
      const v = vamp(a); if (!v || (Number(v.stage) || 1) < 3) continue;
      if ((S.blocked.get(a) || 0) > now()) continue;
      if (feralRefusal(a, v)) continue;
      const p = feralChance(a, v);
      if (p > 0 && Math.random() < p) beginFeral(a, `thirst stage ${v.stage}, ${(p * 100).toFixed(1)}%/min`);
    }
  });
  // At bay: health falling through atBayHealth at stage 3+ rolls once; bound hands end a warning or a Feral
  every('vampAtBay', 2000, () => {
    if (!feralOn()) return;
    for (const x of onlineActors()) {
      const a = Number(x) >>> 0;
      if ((S.due.has(a) || S.feral.has(a)) && bound(a)) { endFeral(a, 'bound'); continue; }
      const v = vamp(a); if (!v) { S.atBay.delete(a); continue; }
      const h = Number((get(a, 'percentages', {}) || {}).health);
      if (!Number.isFinite(h)) continue;
      const was = S.atBay.get(a); S.atBay.set(a, h);
      if (was === undefined || !(was > Number(C.feral.atBayHealth)) || !(h <= Number(C.feral.atBayHealth)) || h <= 0) continue;
      if ((Number(v.stage) || 1) < 3 || feralRefusal(a, v)) continue;
      const t = tierOf(a);
      if (Math.random() < Number(C.feral.atBayChance) * (t ? Number(t.feral) : 1) * fiendFeral(a)) beginFeral(a, 'at bay');
    }
  });

  // ---- Molag Bal: prayer, offering, the daily gift, the Embrace's gate, the backlash --------------------------------------
  globalThis.__dboVampPrayed = (a, deityId, where) => {
    if (String(deityId) !== 'molagbal' || (where && where.atShrine === false) || !sworn(a)) return;
    const c = globalThis.__dboClock; const day = c && typeof c.gameDays === 'function' ? Math.floor(Number(c.gameDays())) : Math.floor(now() / 14400000);
    const d = devOf(a); if (Number(d.prayerDay) === day) return;
    d.prayerDay = day; saveDev(a, d); addDevotion(a, Number(C.devotion.prayer), 'a prayer at his shrine');
  };
  every('vampDaily', 600000, () => {
    if (!on()) return;
    const day = Math.floor(now() / 86400000);
    for (const x of onlineActors()) {
      const a = Number(x) >>> 0;
      if (!isPlayer(a) || !sworn(a)) continue;
      const d = devOf(a); if (Math.floor((Number(d.dailyAt) || 0) / 86400000) === day) continue;
      d.dailyAt = now(); saveDev(a, d); addDevotion(a, Number(C.devotion.dailySworn), 'a day sworn');
    }
  });
  const atMolagShrine = (a) => { const m = globalThis.__dboPrayerLastShrine; const v = m instanceof Map ? m.get(a >>> 0) : null; return !!(v && String(v.deityId) === 'molagbal' && now() - Number(v.at) < Number(C.offering.shrineMemoryMs)); };
  const takeOne = (a, baseId) => {
    const inv = get(a, 'inventory', { entries: [] }); const entries = (inv.entries || []).map((e) => Object.assign({}, e));
    const hit = entries.find((e) => (Number(e.baseId) >>> 0) === baseId && Number(e.count) > 0);
    if (!hit) return false;
    hit.count -= 1; mp.set(a, 'inventory', { entries: entries.filter((e) => Number(e.count) > 0) }); return true;
  };
  registerChatCommand('offer', (a, argStr) => {
    // /offer <gold> is prayer.js's offering to the player's own god; only a bare /offer by his sworn or at his shrine is a soul
    const gold = globalThis.__dboOfferGold;
    if (typeof gold === 'function' && (!on() || String(argStr || '').trim() !== '' || (!sworn(a) && !atMolagShrine(a)))) return gold(a, argStr);
    if (!on()) return personal(a, 'Nothing answers.');
    if (!atMolagShrine(a)) return personal(a, 'Offerings are made at a shrine of Molag Bal: touch one, then say /offer.');
    if (!sworn(a)) return personal(a, 'He takes offerings only from his own. Swear yourself to him first.');
    const gem = idOf(C.offering.item);
    if (!gem || !takeOne(a, gem)) return personal(a, 'He asks for a soul: a filled black soul gem.');
    addDevotion(a, Number(C.devotion.offering), 'a black soul gem offered');
    const v = vamp(a);
    if (v && (Number(v.stage) || 1) > 1) { hook('__dboSuperSetThirst', a, (Number(v.stage) || 1) - 1, 'an offering to Molag Bal'); personal(a, 'The soul is taken. The thirst eases a little.'); }
    else personal(a, 'The soul is taken. He is pleased.');
    if (S.due.has(a >>> 0)) endFeral(a, 'offering');
    audit(`VAMPATH ${who(a)} offered a filled black soul gem to Molag Bal`);
  }, { help: '/offer <gold> to your god at their shrine; a bare /offer at a shrine of Molag Bal gives him a filled black soul gem (his sworn)' });

  globalThis.__dboVampEmbraceRefusal = (a) => {
    if (!on()) return '';
    const v = vamp(a);
    const need = C.tiers[Math.max(0, Math.min(C.tiers.length - 1, Number(C.embraceTier) || 0))];
    if (!v) return `Molag Bal takes only his own into his blood. Be turned first, swear yourself to him, and come back ${need.name}.`;
    if (isRaven(a)) return 'House Ravenwatch takes nothing from Molag Bal, his Embrace least of all.';
    if (isFiend(a)) return 'Molag Bal gives his Embrace only to a vampire of a clan. You are a bloodfiend: no clan, no line. Join a clan, or seek a cure.';
    if (!sworn(a)) return 'He does not know your name. Swear yourself to Molag Bal, and serve him.';
    const t = tierOf(a);
    if (!t || t.index < Number(C.embraceTier)) return `He does not know your name well enough yet. Come back ${need.name} (${Number(devOf(a).points) || 0} of ${need.at} devotion).`;
    return '';
  };

  // A use of a power that lands on someone (supernatural.js); one roll per use window, however many hits a Drain lands
  globalThis.__dboVampPowerUsed = (a, spellId) => {
    a = a >>> 0;
    if (!on()) return;
    const t = tierOf(a); if (!t || !(Number(t.backlash) > 0)) return;
    if (now() - (S.lastUse.get(a) || 0) < Number(C.backlash.useWindowSeconds) * 1000) return;
    S.lastUse.set(a, now());
    if (Math.random() >= Number(t.backlash)) return;
    const w = C.backlash.weights || {};
    const list = [['thirst', Number(w.thirst) || 0], ['price', Number(w.price) || 0], ['flare', Number(w.flare) || 0]].filter(([, n]) => n > 0);
    let r = Math.random() * list.reduce((s, [, n]) => s + n, 0); let pick = list.length ? list[list.length - 1][0] : '';
    for (const [k, n] of list) { if ((r -= n) < 0) { pick = k; break; } }
    const v = vamp(a); if (!v) return;
    if (pick === 'thirst') {
      hook('__dboSuperSetThirst', a, Math.min(4, (Number(v.stage) || 1) + 1), 'Molag Bal\'s price');
      personal(a, 'Molag Bal takes his price: the thirst leaps in you.');
    } else if (pick === 'price') {
      hook('__dboSuperHurt', a, Number(C.backlash.priceHealth));
      personal(a, 'Molag Bal takes his price in your own blood.');
    } else if (pick === 'flare') {
      if (!beginFeral(a, 'backlash', true)) personal(a, 'Molag Bal\'s price brushes past you, this time.');
    }
    audit(`VAMPATH backlash ${who(a)}: ${pick} (${t.name})`);
  };

  // ---- Elders and the Crown sense -----------------------------------------------------------------------------------------
  const bandFor = (m) => { const bands = (C.sense.bands || []).slice().sort((x, y) => Number(x.meters) - Number(y.meters)); return bands.find((b) => m <= Number(b.meters)) || null; };
  const senseSuppressed = (h) => inSafePlace(h) || jailed(h) || inDuel(h) || now() - loginAt(h) < Number(C.feral.loginGraceMinutes) * 60000;
  every('vampSense', Math.max(5, Number(C.sense.everySeconds) || 30) * 1000, () => {
    if (!on() || C.sense.enabled === false) return;
    const h = crownHolder();
    if (!h || !online(h) || senseSuppressed(h)) { S.band.clear(); return; }
    const hp = place(h);
    let hunted = false;
    for (const x of onlineActors()) {
      const a = Number(x) >>> 0;
      if (a === h || !isElder(a)) { S.band.delete(a); continue; }
      const b = bandFor(meters(place(a), hp));
      const was = S.band.get(a) || '';
      S.band.set(a, b ? b.name : '');
      if (!b) continue;
      if (b.name !== 'faint') hunted = true;
      if (b.name === was && !b.repeat) continue;
      personal(a, String(b.text));
      shake(a, Number(b.shake) || 0, 2);
    }
    if (hunted && now() - (S.huntedAt.get(h) || 0) >= Number(C.sense.huntedEveryMs)) { S.huntedAt.set(h, now()); personal(h, String(C.sense.hunted)); shake(h, 0.1, 2); }
  });

  // ---- the drain ----------------------------------------------------------------------------------------------------------
  // Why this Elder cannot drain this holder now, or '' (supernatural.js asks when a feed on a downed body starts)
  const drainRefusal = (a, t) => {
    if (!on() || C.drain.enabled === false) return 'off';
    if (!t || crownHolder() !== (t >>> 0)) return 'not the Crown';
    if (!isElder(a)) return 'not an Elder';
    if (String(profileOf(a)) === String(profileOf(t))) return 'own account';
    if (!downed(t)) return 'not down';
    const since = Number(hook('__dboSuperCrownSince')) || 0;
    if (since && now() - since < Number(C.drain.shieldHours) * 3600000) return 'shielded';
    if (now() - loginAt(t) < Number(C.drain.onlineMinutes) * 60000) return 'just arrived';
    if (inDuel(a) || inDuel(t)) return 'duel';
    if (jailed(a) || jailed(t)) return 'jail';
    if (inSafePlace(t) || inSafePlace(a)) return 'safe place';
    return '';
  };
  const DRAIN_TOLD = { shielded: 'The Crown is too new on its head: Molag Bal shields a new Lord for a while. Drink, but you cannot take it.',
    'just arrived': 'The Lord has only just come into the world. You cannot drain the Crown from them yet.',
    duel: 'Not in a duel.', jail: 'Not here.', 'safe place': 'Not in a place of peace. The Crown cannot be drained here.' };
  globalThis.__dboVampDrainSeconds = (a, t) => {
    a = a >>> 0; t = t >>> 0;
    const why = drainRefusal(a, t);
    if (!why) return Math.max(1, Number(C.drain.seconds) || 15);
    if (DRAIN_TOLD[why] && isElder(a) && crownHolder() === t) personal(a, DRAIN_TOLD[why]);
    return 0;
  };
  globalThis.__dboVampDrainStarted = (a, t) => {
    personal(t >>> 0, `${display(a)} bends over you and drinks, and does not stop. The Crown's blood is leaving you.`);
    audit(`VAMPATH drain started: ${who(a)} on the Crown's holder ${who(t)}`);
  };
  globalThis.__dboVampDrainBroken = (a, t, why) => {
    personal(t >>> 0, 'The teeth leave you. The Crown is still yours.');
    audit(`VAMPATH drain broken: ${who(a)} on ${who(t)} (${why})`);
  };
  globalThis.__dboVampDrainDone = (a, t) => {
    a = a >>> 0; t = t >>> 0;
    // The holder may have been raised or the Crown passed while the feed ran: checked again, the timing rules too
    const why = drainRefusal(a, t);
    if (why) { audit(`VAMPATH drain finished without the Crown: ${who(a)} on ${who(t)} (${why})`); return false; }
    const holderName = display(t);
    if (typeof globalThis.__dboPermaKill !== 'function') { log('vampirepath: no __dboPermaKill; the drain ends nobody'); return false; }
    globalThis.__dboPermaKill(t, `drained of the Blood Crown by the Elder ${display(a)}`);
    hook('__dboSuperTakeCrown', a, `drained ${holderName} of it, the old way`);
    audit(`VAMPATH drain: the Elder ${who(a)} ended ${who(t)} for good and took the Blood Crown`);
    return true;
  };

  // ---- /bloodline and staff -------------------------------------------------------------------------------------------
  // What a line gives and costs, in one sentence (for /bloodline and the line-change notice)
  const FIEND_LINE = 'You are a bloodfiend: no clan, no line. Join a clan, or seek a cure.';
  const pctOf = (x) => Math.round(Math.abs(Number(x) - 1) * 100);
  const lineText = (l) => {
    if (!l) return '';
    if (l.id === 'bloodfiend') return `${FIEND_LINE} The red haze takes you more often, and Molag Bal raises no bloodfiend past ${C.tiers[Math.max(0, Number(BL.bloodfiend.maxTier) || 0)].name}.`;
    if (l.id === 'ravenwatch') return `House Ravenwatch keeps a code, and you with it: you drink only from one who offers their neck, or from an outlaw, and never to the kill. You take nothing from Molag Bal, and your gifts of the blood run at ${Math.round(Number(BL.ravenwatch.powerMult) * 100)}%. While you keep the code, the thirst never turns you Feral.`;
    const d = BL.lines[l.id];
    if (l.id === 'volkihar') return `The Volkihar blood: your bite leaves the living chilled and slow, and frost hurts you ${pctOf(d.frostTaken)}% less.`;
    if (l.id === 'cyrodiilic') return `The Cyrodiilic blood: you pass for mortal ${d.tellsShift} stage${Number(d.tellsShift) === 1 ? '' : 's'} of thirst longer, but the sun and fire hurt you ${pctOf(d.sunMult)}% and ${pctOf(d.fireTaken)}% more.`;
    if (l.id === 'keerilth') return `The Keerilth blood: /mist makes you untouchable for ${(d.mist || {}).seconds} seconds, every ${(d.mist || {}).cooldownMinutes} minutes, but every blow lands on you ${pctOf(d.damageTaken)}% harder.`;
    if (l.id === 'berne') return `The Berne blood: your sneak attacks and bare fists land ${pctOf(d.sneakMult)}% harder, and your spells ${pctOf(d.spellMult)}% softer.`;
    return '';
  };
  const lineOf = (a) => {
    const v = vamp(a); const d = devOf(a); const t = tierOf(a);
    const out = [];
    const bl = bloodlineOf(a);
    if (bl) out.push(lineText(bl));
    if (bl && bl.id === 'ravenwatch' && codeBroken(a)) out.push(`You broke the code: its penalty holds for ${Math.ceil((Number(codeOf(a).until) - now()) / 3600000)} more hours.`);
    if (bl && bl.id === 'ravenwatch') { /* no path of Molag Bal to describe */ } else if (!sworn(a)) out.push(v ? 'You are not sworn to Molag Bal. His path, and his Embrace, are for those who serve him.' : 'You are not on Molag Bal\'s path.');
    else {
      const next = C.tiers[tierIndex(d.points) + 1];
      out.push(`Sworn to Molag Bal: ${t ? t.name : 'Sworn'}, ${Number(d.points) || 0} devotion${next && !(v && v.pure) ? `; ${next.name} at ${next.at}` : ''}.`);
      if (t) out.push(`The thirst takes you ${Math.round((1 - Number(t.feral)) * 100)}% less often; your Drain lands ${Math.round((Number(t.power) - 1) * 100)}% harder; each use of his gifts carries a ${Math.round(Number(t.backlash) * 100)}% risk.`);
    }
    if (v) out.push(isElder(a) ? 'You are an Elder of the blood: you feel the Crown when it is near.' : v.pure ? 'A pure-blood. At the highest rank of the blood you become an Elder.' : 'Not of the pure blood.');
    return out;
  };
  registerChatCommand('bloodline', (a) => { for (const l of lineOf(a)) personal(a, l); }, { help: 'your standing on Molag Bal\'s path, for vampires and his sworn' });
  const addStatus = (key, order, fn) => { try { if (typeof globalThis.__dboRegisterStatus === 'function') globalThis.__dboRegisterStatus(key, order, fn); } catch (e) { /* older gamemode */ } };
  addStatus('bloodline', 71, (a) => {
    const t = vamp(a) ? tierOf(a) : null; const l = bloodlineOf(a);
    const line = !l ? '' : l.id === 'bloodfiend' ? 'Bloodfiend: no clan, no line' : l.id === 'ravenwatch' ? `Ravenwatch code${codeBroken(a) ? ' (broken)' : ''}` : `${l.name} blood`;
    const path = t ? `${t.name} of Molag Bal${isElder(a) ? ', Elder' : ''}` : (isElder(a) ? 'Elder' : '');
    return [line, path].filter(Boolean).join('; ') || null;
  });
  // A line found or lost (a clan joined or left, the switch): told once, as it changes
  every('vampLine', 60000, () => {
    if (!blOn()) { S.lineTold.clear(); return; }
    for (const x of onlineActors()) {
      const a = Number(x) >>> 0;
      if (!isPlayer(a)) continue;
      const l = bloodlineOf(a); const id = l ? l.id : '';
      const was = S.lineTold.get(a);
      S.lineTold.set(a, id);
      // the first look at a login only remembers it; a bloodfiend is reminded then, the others need no telling
      if (was === undefined) { if (isFiend(a)) personal(a, FIEND_LINE); continue; }
      if (was !== id && l) personal(a, lineText(l));
    }
  });
  registerChatCommand('vampath', (a, args) => {
    if (typeof isLeadStaff === 'function' && !isLeadStaff(a)) return personal(a, 'Only lead staff can do that.');
    const [name, what, n] = String(args || '').trim().split(/\s+/);
    const t = !name || name === 'me' ? a : findByName(name);
    if (!t) return personal(a, 'Usage: /vampath <player|me> status|devotion <n>|feral|calm');
    const w = String(what || 'status').toLowerCase();
    if (w === 'devotion') { const d = devOf(t); d.points = Math.max(0, Math.floor(Number(n)) || 0); saveDev(t, d); audit(`VAMPATH GM ${who(a)} set ${who(t)}'s devotion to ${d.points}`); return personal(a, `${display(t)}: ${d.points} devotion.`); }
    if (w === 'feral') { const ok = beginFeral(t, `GM ${display(a)}`); return personal(a, ok ? `${display(t)}'s thirst is rising (warning first).` : `${display(t)} cannot go Feral now: ${feralRefusal(t >>> 0, vamp(t)) || 'not a vampire'}.`); }
    if (w === 'calm') return personal(a, endFeral(t, `GM ${display(a)}`) ? `${display(t)} is calm.` : `${display(t)} was not Feral.`);
    const f = S.feral.get(t >>> 0), due = S.due.get(t >>> 0);
    personal(a, `${display(t)}: ${lineOf(t).join(' ')} ${f ? `Feral, ${Math.ceil((f.until - now()) / 1000)} s left.` : due ? `Feral warning, ${Math.ceil((due.until - now()) / 1000)} s.` : ''}`.trim());
  }, { admin: true, help: '<player|me> status|devotion <n>|feral|calm: Molag Bal\'s path and the Feral (lead staff)' });

  log(`vampirepath ${on() ? 'on' : 'OFF'}: feral ${feralOn() ? `on (${C.feral.perMinute.join('/')} per minute by stage)` : 'off'}, tiers ${C.tiers.map((t) => `${t.name} ${t.at}`).join(', ')}, Elder from blood rank ${C.elder.rank}, drain ${C.drain.enabled === false ? 'off' : `${C.drain.seconds} s, shield ${C.drain.shieldHours} h`}, bloodlines ${blOn() ? 'on' : 'OFF'}`);
  return { C, S, tierOf, isElder, feralChance, beginFeral, endFeral, drainRefusal, inSafePlace, safeCell, bandFor, devOf, addDevotion, lineOf, bloodlineOf, isFiend, isRaven, codeBroken, breach };
};
