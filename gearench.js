// DragonBreak Online: enchantments the server judges (enchantment audit 20 Oct; Nate: "fix them all"). Loaded by gamemode.js.
//
// The server judges every hit from the weapon record alone (fork ActionListener OnWeaponHit), and a worn enchantment runs
// only on its wearer's own game, so most enchantments did nothing. This module reads them from the records and the
// inventory copies and gives the hit judge, the regeneration tick and the pickpocket roll what they need:
//   weaponAttempt   an enchanted weapon's (not a staff's) effects on a landed blow: elemental and chaos damage, absorb,
//                   stamina and magicka damage, paralysis, frost slow; Dawnbreaker, the Ebony Blade, Mehrunes' Razor
//   landed          after a hit lands: a staff's absorb (while the C++ absorb is off), Dawnbreaker's burst on undead
//   staffSpellHit   a staff's slow and its stamina or magicka damage on a player (its paralysis goes through gamemode.js)
//   resistMult      worn Resist Fire, Frost, Shock, Magic and Poison, on the target side (inside racial.js reductionCap)
//   healthPoints    worn Fortify Health points, which potionTakenMult adds to the pool
//   regenOf         worn Heal, Magicka and Stamina Rate effects for prayer.js's regeneration tick
//   bonus           worn Fortify Block, Heavy Armor, Light Armor, Unarmed and Pickpocket, as a capped share
//   spellbreakerMult, backstabMult   Spellbreaker's ward while blocking; the Shrouded Gloves' doubled sneak attack
// Charge belongs to the client: the engine drains it and craftedExtrasSystem keeps the reported charge on the server's
// copy (chargePercent, in points). A player's weapon with less than one hit's cost left applies nothing; an NPC's never runs dry.
// An NPC's weapon hitting the player who hosts that NPC is skipped: that player's own engine applied the enchantment to
// them and their own bars reached the server already.
// Config "gearEnchantments" in gamemode-config.json; every part has its own enabled.
'use strict';

module.exports = (api) => {
  const { mp, log, recordOf, profileOf, display, sendPacket, sourceResistsOf, weaponHandsOf, racial, cfg } = api;
  const G = cfg.gearEnchantments || {};
  const part = (k, d) => Object.assign({ enabled: true }, d, G[k] || {});
  const W = part('weaponHits', { damageMult: 1, onBlocked: false, minHealth: 0.01, assumedMaxMagicka: 150, maxParalysisSeconds: 10, maxSlowSeconds: 10, log: false });
  // PvP balance (Nate 20 Oct, "balance everything with PvP in mind"): enchantments are a garnish on top of skill
  const PVP = Object.assign({ pvpMult: 0.5, pvpParalysisMaxSeconds: 2, pvpParalysisImmuneSeconds: 15, logEverySeconds: 60 }, G.pvp || {});
  const RES = part('resist', { gearResistCap: 0.4 });
  const FH = part('fortifyHealth', { gearHealthCap: 100 });
  const RG = part('regen', { gearRegenCap: 0.5 });
  const ST = part('staffRiders', { maxSlowSeconds: 10 });
  const SHARE = {
    block: part('block', { perPoint: 0.01, cap: 0.25 }), heavy: part('heavyArmor', { perPoint: 0.01, cap: 0.25 }),
    light: part('lightArmor', { perPoint: 0.01, cap: 0.25 }),
    pickpocket: part('pickpocket', { perPoint: 0.005, cap: 0.1 }),
  };
  const SB = part('spellbreaker', { rearmSeconds: 3, frontDegrees: 90 });
  const UQ_DEFAULTS = {
    dawnbreaker: { enabled: true, effects: ['DA09EncDawnbreakeScriptEffect'], markSeconds: 10, burstSpell: 'fee36:Skyrim.esm', feetToUnits: 21.33 },
    razor: { enabled: true, effects: ['DA07MehrunesRazorMagicEffect'], chance: 2 / 101 },
    backstab: { enabled: true, effects: ['DBEnchBackstab'], mult: 2 },
  };
  const UQ = G.uniques || {};
  const uq = (k) => Object.assign({}, UQ_DEFAULTS[k], UQ[k] || {}, UQ.enabled === false ? { enabled: false } : {});

  // libespm ActorValue.h and MGEF DATA (flags u32 at 0, base cost f32 at 4, resist i32 at 16, second AV weight f32 at 60,
  // archetype u32 at 64, actor value i32 at 68, second AV i32 at 88)
  const AV = { health: 24, magicka: 25, stamina: 26, healRate: 27, magickaRate: 28, staminaRate: 29, speed: 30, heavy: 11, light: 12, unarmed: 35, ward: 63, block: 99, pickpocket: 103, healMult: 155, magickaMult: 156, staminaMult: 157 };
  const ARCH = { value: 0, absorb: 4, dual: 5, paralysis: 21, peak: 34 };
  const F = { hostile: 0x1, detrimental: 0x4, noDuration: 0x200, hideInUi: 0x8000 };
  const RESIST_AVS = [40, 41, 42, 43, 44];
  const KW_UNDEAD = 0x13796;
  const FN = { isId: 72, randomPercent: 77, hasKeyword: 560, isBlocking: 569 };

  const dv = (d) => new DataView(d.buffer, d.byteOffset, d.byteLength);
  const fieldList = (lr) => ((lr && lr.record && lr.record.fields) || []).filter((f) => f && f.data instanceof Uint8Array);
  const toGlobal = (lr, local) => { try { return local ? lr.toGlobalRecordId(local) >>> 0 : 0; } catch (e) { return 0; } };
  const edidOf = (id) => { const r = id ? recordOf(id) : null; return r && r.record ? String(r.record.editorId || '') : ''; };
  const pct = (a) => { try { const p = mp.get(a, 'percentages'); return p && typeof p.health === 'number' ? p : null; } catch (e) { return null; } };
  const setPct = (a, p) => { try { mp.set(a, 'percentages', { health: p.health, magicka: p.magicka, stamina: p.stamina }); return true; } catch (e) { return false; } };
  const isPlayer = (a) => profileOf(a) >= 0;
  const later = typeof setImmediate === 'function' ? setImmediate : (fn) => setTimeout(fn, 0);
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

  // Parsed records live on globalThis so a reload keeps them; they are plain numbers, never native objects
  const C = globalThis.__dboGearEnchCache || (globalThis.__dboGearEnchCache = { mgef: new Map(), ench: new Map(), kw: new Map(), worn: new Map() });
  C.weap = C.weap || new Map(); // hit source -> { weap, ench (its EITM's global id) }
  // Whether a hit source is a WEAP and its record's enchantment, read once
  const weapOf = (src) => {
    if (C.weap.has(src)) return C.weap.get(src);
    const r = recordOf(src);
    const weap = !!r && String(r.record.type) === 'WEAP';
    const eitm = weap ? fieldList(r).find((f) => f.type === 'EITM' && f.data.byteLength >= 4) : null;
    const out = { weap, ench: eitm ? toGlobal(r, dv(eitm.data).getUint32(0, true)) : 0 };
    C.weap.set(src, out);
    return out;
  };

  // A CTDA: op (top 3 bits of byte 0), flags (low 5), value f32 at 4, function u16 at 8, param 1 u32 at 12, run on u32 at 20
  const readCond = (lr, d) => {
    const v = dv(d);
    const flags = d[0] & 0x1f;
    return { op: d[0] >> 5, or: !!(flags & 0x01), global: !!(flags & 0x04), value: v.getFloat32(4, true), fn: v.getUint16(8, true),
      param: d.byteLength >= 16 ? toGlobal(lr, v.getUint32(12, true)) || v.getUint32(12, true) : 0, runOn: d.byteLength >= 24 ? v.getUint32(20, true) : 0 };
  };
  const mgefOf = (id) => {
    id >>>= 0;
    if (C.mgef.has(id)) return C.mgef.get(id);
    let out = null;
    const lr = id ? recordOf(id) : null;
    if (lr && String(lr.record.type) === 'MGEF') {
      const fs = fieldList(lr);
      const data = fs.find((f) => f.type === 'DATA' && f.data.byteLength >= 92);
      if (data) {
        const v = dv(data.data);
        out = { id, edid: String(lr.record.editorId || ''), flags: v.getUint32(0, true), cost: v.getFloat32(4, true), resist: v.getInt32(16, true),
          weight2: v.getFloat32(60, true), arch: v.getUint32(64, true), av: v.getInt32(68, true), av2: v.getInt32(88, true),
          conds: fs.filter((f) => f.type === 'CTDA' && f.data.byteLength >= 12).map((f) => readCond(lr, f.data)) };
      }
    }
    C.mgef.set(id, out);
    return out;
  };
  // [{ effect, mag, area, dur, conds }] of an ENCH (or SPEL) record, and its ENIT cost when auto-calc is off
  const enchOf = (id) => {
    id >>>= 0;
    if (C.ench.has(id)) return C.ench.get(id);
    let out = null;
    const lr = id ? recordOf(id) : null;
    const type = lr ? String(lr.record.type) : '';
    if (type === 'ENCH' || type === 'SPEL') {
      out = { id, type, edid: String(lr.record.editorId || ''), effects: [], fixedCost: null, staff: false };
      let cur = null;
      for (const f of fieldList(lr)) {
        if (f.type === 'EFID' && f.data.byteLength >= 4) { cur = { effect: toGlobal(lr, dv(f.data).getUint32(0, true)), mag: 0, area: 0, dur: 0, conds: [] }; out.effects.push(cur); }
        else if (f.type === 'EFIT' && cur && f.data.byteLength >= 12) { const v = dv(f.data); cur.mag = v.getFloat32(0, true); cur.area = v.getUint32(4, true); cur.dur = v.getUint32(8, true); }
        else if (f.type === 'CTDA' && cur && f.data.byteLength >= 12) cur.conds.push(readCond(lr, f.data));
        else if (f.type === 'ENIT' && type === 'ENCH' && f.data.byteLength >= 24) {
          // ENIT: cost i32 at 0, flags u32 at 4 (0x1 no auto-calc), enchant type u32 at 20 (0x0c staff)
          const v = dv(f.data);
          if (v.getUint32(4, true) & 0x1) out.fixedCost = v.getInt32(0, true);
          out.staff = v.getUint32(20, true) === 0x0c;
        }
      }
    }
    C.ench.set(id, out);
    return out;
  };
  // A player-made enchantment's effects, as craftedExtras stores them (load-order MGEF ids)
  const copyEffects = (e) => (Array.isArray(e.enchantmentEffects) ? e.enchantmentEffects : []).map((x) => ({
    effect: Number(x.effectId) >>> 0, mag: num(x.magnitude, 0), area: num(x.area, 0), dur: num(x.duration, 0), conds: [] }));
  // The effects on one inventory copy: its own (player-made), its extra enchantment, else its record's EITM
  const effectsOfEntry = (e) => {
    const own = copyEffects(e);
    if (own.length) return { effects: own, ench: null };
    const extra = Number(e.enchantmentId) >>> 0;
    if (extra && extra < 0xff000000) { const x = enchOf(extra); return x ? { effects: x.effects, ench: x } : { effects: [], ench: null }; }
    const base = recordOf(Number(e.baseId) >>> 0);
    const t = base ? String(base.record.type) : '';
    if (t !== 'ARMO' && t !== 'WEAP') return { effects: [], ench: null };
    const eitm = fieldList(base).find((f) => f.type === 'EITM' && f.data.byteLength >= 4);
    const x = eitm ? enchOf(toGlobal(base, dv(eitm.data).getUint32(0, true))) : null;
    return x ? { effects: x.effects, ench: x } : { effects: [], ench: null };
  };
  const invOf = (a) => { try { const inv = mp.get(a, 'inventory'); return inv && Array.isArray(inv.entries) ? inv.entries : []; } catch (e) { return []; } };

  // ---- worn constant effects ------------------------------------------------------------------------------------------
  // Per actor for a second: { points: Map av -> magnitude of beneficial value or peak modifiers, ward: points while
  // blocking, edids: Set of the worn script effects }. The hit path reads it many times a fight.
  const WORN_MS = 1000;
  const wornOf = (a) => {
    a >>>= 0;
    const now = Date.now();
    const hit = C.worn.get(a);
    if (hit && now - hit.at < WORN_MS) return hit;
    const out = { at: now, points: new Map(), ward: 0, edids: new Set() };
    for (const e of invOf(a)) {
      if (!e || !(e.worn || e.wornLeft)) continue;
      const base = recordOf(Number(e.baseId) >>> 0);
      if (!base || String(base.record.type) !== 'ARMO') continue;
      for (const x of effectsOfEntry(e).effects) {
        const m = mgefOf(x.effect);
        if (!m) continue;
        out.edids.add(m.edid);
        if (!(x.mag > 0) || (m.flags & (F.hostile | F.detrimental)) || (m.arch !== ARCH.value && m.arch !== ARCH.peak)) continue;
        // Spellbreaker's ward holds only while blocking (its ENCH condition IsBlocking == 1); any other condition is not run here
        const conds = x.conds.concat(m.conds);
        if (m.av === AV.ward) { if (conds.every((c) => c.fn === FN.isBlocking)) out.ward += x.mag; continue; }
        if (conds.length) continue;
        out.points.set(m.av, (out.points.get(m.av) || 0) + x.mag);
      }
    }
    C.worn.set(a, out);
    if (C.worn.size > 2048) for (const [k, v] of C.worn) if (now - v.at > WORN_MS) C.worn.delete(k);
    return out;
  };
  const points = (a, av) => wornOf(a).points.get(av) || 0;
  const wornEffect = (a, list) => (list || []).some((ed) => wornOf(a).edids.has(String(ed)));

  // A capped share for block, heavy, light, unarmed, pickpocket; players only
  const SHARE_AV = { block: AV.block, heavy: AV.heavy, light: AV.light, pickpocket: AV.pickpocket };
  const bonus = (a, kind) => {
    const c = SHARE[kind];
    if (!c || c.enabled === false || !isPlayer(a)) return 0;
    return Math.min(Math.max(0, num(c.cap, 0)), points(a, SHARE_AV[kind]) * Math.max(0, num(c.perPoint, 0)));
  };

  // Resistances: each resistance the hit's source is resisted by, from worn gear, at most cap each
  const resistMult = (tgt, src) => {
    if (RES.enabled === false) return 1;
    let rs; try { rs = sourceResistsOf(src >>> 0); } catch (e) { return 1; }
    if (!rs) return 1;
    let m = 1;
    // Resist Magic counts against every magic source, as the race's does (racial.js targetMult)
    const r = recordOf(src >>> 0);
    const magic = !!r && ['SPEL', 'ENCH', 'SCRL', 'MGEF'].includes(String(r.record.type));
    const cap = Math.max(0, num(RES.gearResistCap, 0.4));
    for (const av of RESIST_AVS) if (rs.has(av) || (av === 44 && magic)) m *= 1 - Math.min(cap, points(tgt, av) / 100);
    return m;
  };
  const healthPoints = (tgt) => (FH.enabled === false ? 0 : Math.min(Math.max(0, num(FH.gearHealthCap, 100)), points(tgt, AV.health)));
  // prayer.js units: a rate effect adds its magnitude to the rate, a Mult effect its magnitude % of the race's rate
  const REGEN_AVS = [[AV.healRate, 'health', 'rate', 'HealRate'], [AV.magickaRate, 'magicka', 'rate', 'MagickaRate'], [AV.staminaRate, 'stamina', 'rate', 'StaminaRate'],
    [AV.healMult, 'health', 'mult', 'HealRateMult'], [AV.magickaMult, 'magicka', 'mult', 'MagickaRateMult'], [AV.staminaMult, 'stamina', 'mult', 'StaminaRateMult']];
  // prayer.js caps the gear's extra at gearRegenCap of the bar's base rate (its own regenPerSecond units)
  const regenCap = () => Math.max(0, num(RG.gearRegenCap, 0.5));
  const regenOf = (a) => {
    if (RG.enabled === false || !isPlayer(a)) return [];
    const out = [];
    for (const [av, stat, kind, name] of REGEN_AVS) {
      const mag = points(a, av);
      if (mag > 0) out.push({ av: name, stat, kind, mag, gear: true });
    }
    return out;
  };

  // ---- conditions ---------------------------------------------------------------------------------------------------
  // The keywords of an actor: its base NPC_ (or the player record), its template chain's and its race's
  const keywordsOfRecord = (id) => {
    const r = id ? recordOf(id) : null; const out = [];
    for (const f of fieldList(r)) if (f.type === 'KWDA') for (let i = 0; i + 4 <= f.data.byteLength; i += 4) out.push(toGlobal(r, dv(f.data).getUint32(i, true)));
    return out;
  };
  const raceOfRecord = (id) => { const r = id ? recordOf(id) : null; const f = fieldList(r).find((x) => x.type === 'RNAM' && x.data.byteLength >= 4); return f ? toGlobal(r, dv(f.data).getUint32(0, true)) : 0; };
  const baseIdOf = (a) => { if (isPlayer(a)) return 0x7; try { return mp.getIdFromDesc(String(mp.get(a, 'baseDesc'))) >>> 0; } catch (e) { return 0; } };
  const actorKeywords = (a) => {
    const base = baseIdOf(a);
    let race = 0;
    try { const app = mp.get(a, 'appearance'); race = app && app.raceId ? Number(app.raceId) >>> 0 : 0; } catch (e) { race = 0; }
    let chain = []; try { const t = mp.get(a, 'templateChain'); chain = Array.isArray(t) ? t.map((x) => Number(x) >>> 0) : []; } catch (e) { chain = []; }
    const key = `${base}|${race}|${chain.join(',')}`;
    if (C.kw.has(key)) return C.kw.get(key);
    const set = new Set();
    for (const id of [base, ...chain]) { for (const k of keywordsOfRecord(id)) set.add(k); if (!race) race = raceOfRecord(id); }
    for (const k of keywordsOfRecord(race)) set.add(k);
    C.kw.set(key, set);
    if (C.kw.size > 4096) C.kw.clear();
    return set;
  };
  // Undead: the keyword, or a vampire player (supernatural.js), for Dawnbreaker
  const isUndead = (a) => { if (isPlayer(a)) { try { return typeof globalThis.__dboSuperKind === 'function' && globalThis.__dboSuperKind(a) === 'vampire'; } catch (e) { return false; } } return actorKeywords(a).has(KW_UNDEAD); };
  const compare = (op, a, b) => [a === b, a !== b, a > b, a >= b, a < b, a <= b][op];
  // true, false, or null when the server cannot run it (run on someone else, a global, an unknown function)
  const evalCond = (c, tgt) => {
    if (c.global) return null;
    if (c.fn === FN.randomPercent) return compare(c.op, Math.floor(Math.random() * 100), c.value);
    if (c.runOn !== 0) return null;
    if (c.fn === FN.hasKeyword) return compare(c.op, actorKeywords(tgt).has(c.param >>> 0) ? 1 : 0, c.value);
    if (c.fn === FN.isId) return compare(c.op, baseIdOf(tgt) === (c.param >>> 0) ? 1 : 0, c.value);
    return null;
  };
  // Skyrim's order: consecutive conditions flagged OR form one group, the groups are ANDed
  const evalConds = (conds, tgt) => {
    let all = true, group = null;
    const close = () => { if (group === false) all = false; else if (group === null && all === true) all = null; };
    let open = false;
    for (const c of conds) {
      const v = evalCond(c, tgt);
      if (!open) { group = v; open = true; } else group = group === true || v === true ? true : (group === null || v === null ? null : false);
      if (!c.or) { close(); open = false; if (all === false) return false; }
    }
    if (open) close();
    return all;
  };
  // The effects that run on this target now. A tier the server cannot tell (the Ebony Blade's kill count) counts as its
  // lowest: several effects on one MGEF whose conditions cannot be run keep only the smallest magnitude
  const runnable = (effects, tgt) => {
    const out = [];
    const tiers = new Map();
    for (const x of effects) {
      const m = mgefOf(x.effect);
      if (!m) continue;
      const v = evalConds(x.conds.concat(m.conds), tgt);
      if (v === true) out.push({ x, m });
      else if (v === null) { const t = tiers.get(m.id); if (!t || x.mag < t.x.mag) tiers.set(m.id, { x, m, n: (t ? t.n : 0) + 1 }); else t.n += 1; }
    }
    for (const t of tiers.values()) if (t.n > 1) out.push({ x: t.x, m: t.m });
    return out;
  };

  // ---- charge -------------------------------------------------------------------------------------------------------
  // Most one hit can cost: ENIT's when auto-calc is off, else base cost x magnitude^1.1 x (duration / 10)^1.1
  const effectCost = (x) => { const m = mgefOf(x.effect); return m ? Math.max(0, m.cost) * Math.pow(Math.max(x.mag, 1), 1.1) * (x.dur > 0 ? Math.pow(x.dur / 10, 1.1) : 1) : 0; };
  const hitCost = (set) => (set.ench && set.ench.fixedCost !== null ? set.ench.fixedCost : set.effects.reduce((s, x) => s + effectCost(x), 0));
  const spent = (e, set) => typeof e.chargePercent === 'number' && Number.isFinite(e.chargePercent) && e.chargePercent < Math.max(1, hitCost(set));
  // The held copy of the weapon and its effects: both hands, else any carried copy; null without an enchantment
  const heldSet = (agg, src) => {
    const entries = invOf(agg).filter((e) => e && (Number(e.baseId) >>> 0) === src && num(e.count, 0) > 0);
    const held = entries.filter((e) => e.worn || e.wornLeft);
    for (const e of (held.length ? held : entries)) {
      const set = effectsOfEntry(e);
      if (!set.effects.length) continue;
      if (isPlayer(agg) && spent(e, set)) return { spent: true };
      return set;
    }
    if (entries.length) return null;
    // An NPC's weapon from its base outfit may have no inventory entry: the record's own enchantment
    const w = weapOf(src);
    const x = w.ench && !isPlayer(agg) ? enchOf(w.ench) : null;
    return x ? { effects: x.effects, ench: x } : null;
  };

  // ---- applying effects -----------------------------------------------------------------------------------------------
  // The server's maxima reach the gameplay only on a weapon hit's flags: the last seen per actor stands in
  const MAX = globalThis.__dboGearEnchMax instanceof Map ? globalThis.__dboGearEnchMax : (globalThis.__dboGearEnchMax = new Map()); // actor -> { health, stamina }
  const noteMax = (a, flags) => {
    const h = num(flags && flags.targetMaxHealth, 0), s = num(flags && flags.targetMaxStamina, 0);
    if (!(h > 0) && !(s > 0)) return;
    MAX.set(a >>> 0, { health: h > 0 ? h : (MAX.get(a >>> 0) || {}).health || 0, stamina: s > 0 ? s : (MAX.get(a >>> 0) || {}).stamina || 0 });
    if (MAX.size > 4096) MAX.clear();
  };
  const maxHealthOf = (a) => {
    const own = (MAX.get(a >>> 0) || {}).health; if (own > 0) return own;
    const m = globalThis.__dboPotionMaxSeen; const d = globalThis.__dboDownedState;
    return (m instanceof Map && Number(m.get(a >>> 0))) || (d && d.maxHp instanceof Map ? Number(d.maxHp.get(a >>> 0)) : 0) || 0;
  };
  const maxStaminaOf = (a) => (MAX.get(a >>> 0) || {}).stamina || 0;
  // The target side of an effect's damage: its resistance (race, potion, worn gear, a blessing), capped like a hit's
  const sideOf = (agg, tgt, src, dmg) => {
    let side = 1;
    try { side *= racial ? racial.targetMult(agg, tgt, src, dmg) : 1; } catch (e) { /* no race */ }
    try { side *= typeof api.potionResistMult === 'function' ? api.potionResistMult(tgt, src) : 1; } catch (e) { /* no alchemy */ }
    try { side *= typeof api.blessingTargetMult === 'function' ? api.blessingTargetMult(tgt, src) : 1; } catch (e) { /* no blessing */ }
    side *= resistMult(tgt, src);
    try { if (racial) side = racial.capTargetSide(side); } catch (e) { /* no cap */ }
    return side;
  };
  const downed = (a) => { try { return typeof globalThis.__dboIsDowned === 'function' && !!globalThis.__dboIsDowned(a); } catch (e) { return false; } };
  // A player is held at most pvpParalysisMaxSeconds, never while downed or held, then immune for pvpParalysisImmuneSeconds
  // to every paralysis gamemode.js sends (globalThis.__dboParalysisImmuneUntil); an NPC for the enchantment's own time
  const IMMUNE = globalThis.__dboParalysisImmuneUntil instanceof Map ? globalThis.__dboParalysisImmuneUntil : (globalThis.__dboParalysisImmuneUntil = new Map());
  const paralyse = (agg, tgt, seconds) => {
    const until = globalThis.__dboParalysedUntil;
    if (!(until instanceof Map) || !(seconds > 0)) return 0;
    const now = Date.now();
    if ((until.get(tgt) || 0) > now) return 0;
    let sec = seconds;
    if (isPlayer(tgt)) {
      if (downed(tgt) || (IMMUNE.get(tgt) || 0) > now) return 0;
      sec = Math.min(sec, Math.max(0, num(PVP.pvpParalysisMaxSeconds, 2)));
      if (!(sec > 0)) return 0;
      IMMUNE.set(tgt, now + (sec + Math.max(0, num(PVP.pvpParalysisImmuneSeconds, 15))) * 1000);
      if (IMMUNE.size > 512) for (const [k, t] of IMMUNE) if (t <= now) IMMUNE.delete(k);
    }
    until.set(tgt, now + sec * 1000);
    if (isPlayer(tgt)) { try { sendPacket(tgt, { customPacketType: 'dboParalyse', seconds: sec }); } catch (e) { /* offline */ } }
    return sec;
  };
  // The PvP watch: one line per attacker a minute for an enchanted hit on a player
  const watchAt = globalThis.__dboGearEnchWatch instanceof Map ? globalThis.__dboGearEnchWatch : (globalThis.__dboGearEnchWatch = new Map());
  const watch = (agg, tgt, line) => {
    const now = Date.now();
    if (now - (watchAt.get(agg) || 0) < Math.max(1, num(PVP.logEverySeconds, 60)) * 1000) return false;
    watchAt.set(agg, now);
    if (watchAt.size > 1024) for (const [k, t] of watchAt) if (now - t > 600000) watchAt.delete(k);
    log(`gear enchantment on a player: ${display(agg)} -> ${display(tgt)}: ${line}`);
    return true;
  };
  const slowSent = new Map();
  const slow = (tgt, speed, seconds, max) => {
    if (!isPlayer(tgt) || !(speed > 0) || !(seconds > 0)) return false;
    const now = Date.now();
    if (now - (slowSent.get(tgt) || 0) < 1000) return false;
    // One frost slow at a time on a player, shared with elements.js's chill (PvP: weapon and spell frost never stack)
    const F = globalThis.__dboFrostSlowUntil instanceof Map ? globalThis.__dboFrostSlowUntil : (globalThis.__dboFrostSlowUntil = new Map());
    { const f = F.get(tgt); if (f && f.until > now && f.kind !== 'slow') return false; }
    F.set(tgt, { kind: 'slow', until: now + Math.min(num(max, 10), seconds) * 1000 });
    slowSent.set(tgt, now);
    if (slowSent.size > 512) for (const [k, t] of slowSent) if (now - t > 5000) slowSent.delete(k);
    try { sendPacket(tgt, { customPacketType: 'dboStatus', kind: 'slow', seconds: Math.min(num(max, 10), seconds), speedMult: -Math.min(90, Math.round(speed)) }); } catch (e) { return false; }
    return true;
  };
  // Health off the target (points over its pool), what absorb gives back, stamina and magicka changes; one write each
  const applyPlan = (agg, tgt, plan, ctx) => {
    const out = [];
    const q = pct(tgt);
    if (!q || !(q.health > 0) || downed(tgt)) return out;
    const next = { health: q.health, magicka: q.magicka, stamina: q.stamina };
    const pool = ctx.maxHealth > 0 ? ctx.maxHealth : 0;
    if (plan.health > 0 && pool > 0) {
      const share = (plan.health * ctx.taken) / pool;
      next.health = Math.max(Math.min(next.health, num(W.minHealth, 0.01)), next.health - share);
      out.push(`health -${(share * 100).toFixed(1)}%`);
    }
    if (plan.stamina > 0 && ctx.maxStamina > 0) { next.stamina = Math.max(0, next.stamina - plan.stamina / ctx.maxStamina); out.push(`stamina -${plan.stamina.toFixed(1)}`); }
    if (plan.magicka > 0 && isPlayer(tgt)) { next.magicka = Math.max(0, next.magicka - plan.magicka / Math.max(1, num(W.assumedMaxMagicka, 150))); out.push(`magicka -${plan.magicka.toFixed(1)}`); }
    if (out.length) setPct(tgt, next);
    const dealt = pool > 0 ? (q.health - next.health) * pool : 0;
    // Absorb: the attacker gains what the target lost to the absorb effects, on its own pool
    const gainHp = plan.absorbHealthShare > 0 ? dealt * plan.absorbHealthShare : 0;
    const aPool = maxHealthOf(agg);
    const p = (gainHp > 0 && aPool > 0) || plan.absorbStamina > 0 || plan.absorbMagicka > 0 ? pct(agg) : null;
    if (p && p.health > 0) {
      const gain = { health: p.health, magicka: p.magicka, stamina: p.stamina };
      if (gainHp > 0 && aPool > 0) gain.health = Math.min(1, gain.health + gainHp / aPool);
      if (plan.absorbStamina > 0 && ctx.maxStamina > 0) gain.stamina = Math.min(1, gain.stamina + plan.absorbStamina / ctx.maxStamina);
      if (plan.absorbMagicka > 0 && isPlayer(agg)) gain.magicka = Math.min(1, gain.magicka + plan.absorbMagicka / Math.max(1, num(W.assumedMaxMagicka, 150)));
      if (setPct(agg, gain)) out.push('absorbed');
    }
    return out;
  };
  // What a set of effects does to a target: points of each pool, absorb shares, paralysis and slow seconds
  const planOf = (agg, tgt, list, side) => {
    const plan = { health: 0, absorbHealth: 0, stamina: 0, magicka: 0, absorbStamina: 0, absorbMagicka: 0, paralysis: 0, slow: 0, slowSeconds: 0, absorbHealthShare: 0 };
    for (const { x, m } of list) {
      const bad = !!(m.flags & (F.hostile | F.detrimental));
      const ticks = (m.arch === ARCH.value || m.arch === ARCH.dual || m.arch === ARCH.absorb) && x.dur > 1 && !(m.flags & F.noDuration);
      const amount = Math.max(0, x.mag) * (ticks ? x.dur : 1);
      if (m.arch === ARCH.paralysis && !(m.flags & F.hideInUi)) { plan.paralysis = Math.max(plan.paralysis, x.dur); continue; }
      if (m.arch === ARCH.peak && m.av === AV.speed && bad) { if (x.mag > plan.slow) { plan.slow = x.mag; plan.slowSeconds = x.dur; } continue; }
      if (!bad || !(amount > 0) || (m.arch !== ARCH.value && m.arch !== ARCH.dual && m.arch !== ARCH.absorb)) continue;
      const resisted = amount * (m.resist >= 0 ? side(m.id) : 1);
      const add = (av, pts) => {
        if (av === AV.health) { plan.health += pts; if (m.arch === ARCH.absorb) plan.absorbHealth += pts; }
        else if (av === AV.stamina) { plan.stamina += pts; if (m.arch === ARCH.absorb) plan.absorbStamina += pts; }
        else if (av === AV.magicka) { plan.magicka += pts; if (m.arch === ARCH.absorb) plan.absorbMagicka += pts; }
      };
      add(m.av, resisted);
      if (m.arch === ARCH.dual && m.av2 >= 0) add(m.av2, resisted * Math.max(0, m.weight2 || 1));
    }
    plan.absorbHealthShare = plan.health > 0 ? plan.absorbHealth / plan.health : 0;
    return plan;
  };
  const isNpcHostedBy = (npc, player) => { try { return typeof mp.getHoster === 'function' && (mp.getHoster(npc) >>> 0) === (player >>> 0); } catch (e) { return false; } };
  const nameOfEffects = (set) => (set.ench ? set.ench.edid || set.ench.id.toString(16) : 'a player-made enchantment');

  // ---- uniques --------------------------------------------------------------------------------------------------------
  const marks = globalThis.__dboDawnbreakerMarks instanceof Map ? globalThis.__dboDawnbreakerMarks : (globalThis.__dboDawnbreakerMarks = new Map()); // target -> { agg, until }
  // Mehrunes' Razor (DA07MehrunesRazorMagicEffectScript: Utility.RandomInt(0, 100) <= 1, so 2 in 101; DA07MehrunesRazorImmuneFaction
  // spared): NPCs only, never a player, a companion, an essential, protected or unique NPC, nor a boss
  const razorImmune = (tgt) => {
    if (isPlayer(tgt)) return true;
    try { if (Number(mp.get(tgt, 'ff_companionOf')) >>> 0) return true; } catch (e) { /* no companion */ }
    const base = baseIdOf(tgt);
    for (const id of [base]) {
      const r = id ? recordOf(id) : null;
      if (!r) return true;
      if (/boss|lord|champion/i.test(String(r.record.editorId || ''))) return true;
      const acbs = fieldList(r).find((f) => f.type === 'ACBS' && f.data.byteLength >= 4);
      // ACBS flags: 0x2 essential, 0x20 unique, 0x800 protected
      if (acbs && (dv(acbs.data).getUint32(0, true) & (0x2 | 0x20 | 0x800))) return true;
    }
    try { if (String(mp.get(tgt, 'private.npcSpawner') || '').includes('boss')) return true; } catch (e) { /* not spawned */ }
    return false;
  };
  const dawnbreakerBurst = (agg, dead) => {
    const D = uq('dawnbreaker');
    let spellId = 0; try { spellId = mp.getIdFromDesc(String(D.burstSpell)) >>> 0; } catch (e) { return 0; }
    const spell = enchOf(spellId);
    let fire = null; let radius = 0;
    for (const x of (spell ? spell.effects : [])) { const m = mgefOf(x.effect); if (m && m.av === AV.health && (m.flags & (F.hostile | F.detrimental))) { fire = { x, m }; radius = x.area * num(D.feetToUnits, 21.33); } }
    if (!fire || !(radius > 0)) return 0;
    let where = null, pos = null;
    try { where = String(mp.get(dead, 'worldOrCellDesc')); pos = mp.get(dead, 'pos'); } catch (e) { return 0; }
    let near = []; try { near = mp.getNeighborsByPosition(where, pos) || []; } catch (e) { return 0; }
    let n = 0;
    for (const id of near) {
      const t = Number(id) >>> 0;
      if (t === dead || t === agg) continue;
      let p = null, alive = false; try { p = mp.get(t, 'pos'); alive = mp.get(t, 'isDead') === false && String(mp.get(t, 'worldOrCellDesc')) === where; } catch (e) { continue; }
      if (!alive || !Array.isArray(p) || Math.hypot(p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]) > radius) continue;
      if (!isUndead(t)) continue;
      const pool = maxHealthOf(t);
      if (!(pool > 0)) continue;
      const plan = planOf(agg, t, [fire], (src) => sideOf(agg, t, src, 0));
      if (isPlayer(t)) { plan.health *= Math.max(0, num(PVP.pvpMult, 0.5)); watch(agg, t, 'Dawnbreaker burst'); }
      if (applyPlan(agg, t, plan, { maxHealth: pool, maxStamina: 0, taken: 1 }).length) n += 1;
    }
    return n;
  };

  // ---- the hit judge's calls ------------------------------------------------------------------------------------------
  // From hitDamageAttemptHook when a weapon blow (never a staff, spell or scroll) will land. Applies after the C++ writes
  // the blow's own health (setImmediate). Returns what it planned, for the log and the harness
  const weaponAttempt = (agg, tgt, src, dmg, flags) => {
    const f = flags && typeof flags === 'object' ? flags : {};
    noteMax(tgt, f);
    if (W.enabled === false || agg === tgt) return null;
    if (f.spell || (f.blocked && W.onBlocked !== true)) return null;
    if (!weapOf(src).weap) return null;
    // The host's own engine already applied an NPC's enchantment to the player hosting that NPC
    if (!isPlayer(agg) && isPlayer(tgt) && isNpcHostedBy(agg, tgt)) return { skipped: 'victim hosts the attacker' };
    const set = heldSet(agg, src);
    if (!set) return null;
    if (set.spent) return { skipped: 'no charge' };
    if (set.ench && set.ench.staff) return null;
    const list = runnable(set.effects, tgt);
    const result = { ench: nameOfEffects(set), effects: list.map(({ m }) => m.edid) };
    const R = uq('razor');
    if (R.enabled !== false && list.some(({ m }) => (R.effects || []).includes(m.edid)) && !razorImmune(tgt) && Math.random() < num(R.chance, 2 / 101)) {
      result.razor = true;
      later(() => { try { if (mp.get(tgt, 'isDead') === false) { mp.set(tgt, 'isDead', true); log(`gear enchantment: Mehrunes' Razor of ${display(agg)} took ${display(tgt)}`); } } catch (e) { log('razor failed', e.message); } });
      return result;
    }
    const D = uq('dawnbreaker');
    if (D.enabled !== false && list.some(({ m }) => (D.effects || []).includes(m.edid))) {
      marks.set(tgt, { agg, until: Date.now() + num(D.markSeconds, 10) * 1000 });
      if (marks.size > 512) { const now = Date.now(); for (const [k, v] of marks) if (v.until < now) marks.delete(k); }
    }
    // On a player the enchantment's points count pvpMult (0.5); on an NPC in full
    const pvp = isPlayer(tgt) ? Math.max(0, num(PVP.pvpMult, 0.5)) : 1;
    // dmg 0: reading the resistance must not spend a racial ward (racial.js wardAbsorb needs a damage)
    const plan = planOf(agg, tgt, list, (mgefId) => sideOf(agg, tgt, set.ench ? set.ench.id : mgefId, 0));
    for (const k of ['health', 'stamina', 'magicka', 'absorbStamina', 'absorbMagicka']) plan[k] *= Math.max(0, num(W.damageMult, 1)) * pvp;
    const ctx = { maxHealth: num(f.targetMaxHealth, 0), maxStamina: num(f.targetMaxStamina, 0), taken: typeof api.takenMult === 'function' ? api.takenMult(tgt, f) : 1 };
    result.plan = plan;
    later(() => {
      try {
        const did = applyPlan(agg, tgt, plan, ctx);
        const sec = Math.min(num(W.maxParalysisSeconds, 10), plan.paralysis);
        // An NPC's hold shows only where its host's engine paralysed it: the attacker's own game
        const held = sec > 0 && (isPlayer(tgt) || isNpcHostedBy(tgt, agg)) ? paralyse(agg, tgt, sec) : 0;
        if (held) did.push(`paralysed ${held} s`);
        if (plan.slow > 0 && slow(tgt, plan.slow, plan.slowSeconds, W.maxSlowSeconds)) did.push(`slowed ${Math.round(plan.slow)}%`);
        if (did.length && isPlayer(tgt)) watch(agg, tgt, `${result.ench} ${did.join(', ')}`);
        else if (W.log && did.length) log(`gear enchantment ${result.ench} ${display(agg)} -> ${display(tgt)}: ${did.join(', ')}`);
      } catch (e) { log('gear enchantment hit failed', e.message); }
    });
    return result;
  };
  // A staff's riders on a player (its damage is the C++'s, its paralysis gamemode.js spellHitHook's): slow, stamina and
  // magicka damage; NPC targets are the fork's (ActionListener riders)
  const staffSpellHit = (agg, tgt, spellId) => {
    if (ST.enabled === false || agg === tgt || !isPlayer(tgt)) return null;
    const x = enchOf(spellId);
    if (!x || x.type !== 'ENCH' || !x.staff) return null;
    const plan = planOf(agg, tgt, runnable(x.effects, tgt), () => sideOf(agg, tgt, x.id, 0));
    plan.stamina *= Math.max(0, num(PVP.pvpMult, 0.5)); plan.magicka *= Math.max(0, num(PVP.pvpMult, 0.5));
    const did = [];
    if (plan.slow > 0 && slow(tgt, plan.slow, plan.slowSeconds, ST.maxSlowSeconds)) did.push('slow');
    if (plan.stamina > 0 || plan.magicka > 0) {
      const q = pct(tgt);
      if (q && q.health > 0) {
        const next = { health: q.health, magicka: q.magicka, stamina: q.stamina };
        const maxSt = maxStaminaOf(tgt) || 100;
        if (plan.stamina > 0) next.stamina = Math.max(0, next.stamina - plan.stamina / maxSt);
        if (plan.magicka > 0) next.magicka = Math.max(0, next.magicka - plan.magicka / Math.max(1, num(W.assumedMaxMagicka, 150)));
        if (setPct(tgt, next)) did.push('drain');
      }
    }
    if (did.length) watch(agg, tgt, `${x.edid} ${did.join(', ')}`);
    return did.length ? did : null;
  };
  // From onHitDamage: a staff's absorb while the C++ absorb is off, and Dawnbreaker's burst when its mark's target died
  const cppAbsorb = (() => { try { const s = (mp.getServerSettings() || {}).spellSync; return !(s && s.absorb === false); } catch (e) { return true; } })();
  const landed = (agg, tgt, src, dealt) => {
    const out = [];
    const x = enchOf(src);
    if (ST.enabled !== false && !cppAbsorb && x && x.type === 'ENCH' && x.staff && dealt > 0 && agg !== tgt) {
      const plan = planOf(agg, tgt, runnable(x.effects, tgt), () => 1);
      const gain = plan.absorbHealthShare * dealt;
      const pool = maxHealthOf(agg);
      const p = gain > 0 && pool > 0 ? pct(agg) : null;
      if (p && p.health > 0 && setPct(agg, { health: Math.min(1, p.health + gain / pool), magicka: p.magicka, stamina: p.stamina })) out.push('staff absorb');
    }
    const mark = marks.get(tgt);
    if (mark) {
      let dead = false; try { dead = mp.get(tgt, 'isDead') === true; } catch (e) { dead = false; }
      if (mark.until < Date.now()) marks.delete(tgt);
      else if (dead) { marks.delete(tgt); if (!isPlayer(tgt) && isUndead(tgt)) { const n = dawnbreakerBurst(mark.agg, tgt); out.push(`dawnbreaker burst ${n}`); if (n) log(`gear enchantment: Dawnbreaker's burst from ${display(tgt)} burned ${n} undead`); } }
    }
    return out;
  };

  // ---- Spellbreaker and the Shrouded Gloves --------------------------------------------------------------------------
  // Spellbreaker (DA13SpellBreakerEnch: WardPower 50 while IsBlocking): a spell from the front takes the ward's points
  // until spent; lowering the shield for rearmSeconds sets the ward up again (UESP Skyrim:Spellbreaker, "up to 50 points")
  const wards = globalThis.__dboSpellbreakerWards instanceof Map ? globalThis.__dboSpellbreakerWards : (globalThis.__dboSpellbreakerWards = new Map()); // tgt -> { left, seen }
  const blocking = (a) => { try { return !!mp.callPapyrusFunction('method', 'ObjectReference', 'GetAnimationVariableBool', { type: 'form', desc: mp.getDescFromId(a >>> 0) }, ['IsBlocking']); } catch (e) { return false; } };
  const facing = (tgt, agg) => {
    try {
      const a = mp.get(agg, 'pos'), t = mp.get(tgt, 'pos'), rot = mp.get(tgt, 'angle');
      const z = (Number(Array.isArray(rot) ? rot[2] : rot && rot.z) || 0) * Math.PI / 180;
      const dx = a[0] - t[0], dy = a[1] - t[1], flat = Math.hypot(dx, dy);
      return flat > 0 && (Math.sin(z) * dx + Math.cos(z) * dy) / flat >= Math.cos(num(SB.frontDegrees, 90) * Math.PI / 180);
    } catch (e) { return false; }
  };
  const spellbreakerMult = (agg, tgt, src, dmg, flags) => {
    if (SB.enabled === false || agg === tgt || !(dmg > 0) || !(flags && flags.spell)) return 1;
    const ward = wornOf(tgt).ward;
    if (!(ward > 0)) return 1;
    const now = Date.now();
    if (!blocking(tgt)) { wards.delete(tgt); return 1; }
    // A raised shield after a lowered one, or after rearmSeconds without a spell, holds a fresh ward
    let w = wards.get(tgt);
    if (!w || now - w.seen > num(SB.rearmSeconds, 3) * 1000) w = { left: ward, seen: now };
    w.seen = now;
    if (!(w.left > 0) || !facing(tgt, agg)) { wards.set(tgt, w); return 1; }
    const took = Math.min(w.left, dmg);
    w.left -= took;
    wards.set(tgt, w);
    if (wards.size > 512) for (const [k, v] of wards) if (now - v.seen > 60000) wards.delete(k);
    if (!(w.left > 0) && isPlayer(tgt)) { try { if (typeof api.personal === 'function') api.personal(tgt, 'Your ward breaks.'); } catch (e) { /* optional */ } }
    return (dmg - took) / dmg;
  };
  // The Shrouded Gloves (Backstab, UESP: doubles the sneak attack multiplier of one-handed weapons): x2 on the blow
  const backstabMult = (agg, src, flags) => {
    const B = uq('backstab');
    if (B.enabled === false || !(flags && flags.sneak) || flags.spell) return 1;
    if (weaponHandsOf(src >>> 0) !== 'one' || !wornEffect(agg, B.effects)) return 1;
    return Math.max(1, num(B.mult, 2));
  };

  globalThis.__dboGearBonus = bonus;
  globalThis.__dboGearRegen = regenOf;
  // A player's paralysis from gamemode.js's own paths (scrolls, runes, staves), then immune as above
  // capped: a weapon's or staff's (pvpParalysisMaxSeconds); a scroll or rune keeps its time but sets and obeys the window
  const playerParalysis = (tgt, seconds, capped = true) => {
    if (!isPlayer(tgt) || !(seconds > 0)) return seconds;
    const now = Date.now();
    if (downed(tgt) || (IMMUNE.get(tgt) || 0) > now) return 0;
    const sec = capped ? Math.min(seconds, Math.max(0, num(PVP.pvpParalysisMaxSeconds, 2))) : seconds;
    if (sec > 0) IMMUNE.set(tgt, now + (sec + Math.max(0, num(PVP.pvpParalysisImmuneSeconds, 15))) * 1000);
    return sec;
  };
  return { weaponAttempt, playerParalysis, regenCap, staffSpellHit, landed, resistMult, healthPoints, regenOf, bonus, spellbreakerMult, backstabMult,
    noteMax, _test: { wornOf, runnable, evalConds, planOf, heldSet, enchOf, mgefOf, razorImmune, dawnbreakerBurst, C } };
};
