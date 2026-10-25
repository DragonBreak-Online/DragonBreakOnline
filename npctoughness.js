// DragonBreak Online: how tough one family of creatures is against players, by race (Nate, 17 Oct: "draugr, they're too
// strong apparently"). Loaded by gamemode.js like crashycreatures.js; config gamemode-config.json "npcToughness".
//
// The server gives an NPC its race's starting health plus its own health offset (fork GetBaseActorValues.cpp) and no
// health by level, so most enemies stand near vanilla's level-1 numbers while the draugr, whose records carry vanilla's
// fixed offsets, keep all of theirs: a Wight (level 13-15) 200-370, a Scourge (level 21-24) 500-700, a Deathlord (level
// 30-40) 710-960, where a bandit, a Falmer or a vampire of the same level has 140-330 (records of the 140-plugin order, 17 Oct).
//
// kinds { <name>: { races, knee, slope, dealt, weakTo, magicTaken, magicShouts } }:
//   races  RACE descs; an NPC_ is judged by its race after its template chain (ACBS Use Traits), a LVLN by any entry
//   knee, slope  a player's (or their summon's or companion's) hit on one lands as if its health were
//          knee + (health - knee) * slope above the knee, as it is below: hits scale by health / that, so a 960-health
//          Deathlord takes the blows of a 504-health one and a 150-health Restless Draugr is unchanged
//   dealt  scales every hit one lands on a player (weapon, fists, spells and shouts), on top of npcDamage
//   weakTo { <keyword desc>: mult }  a weapon carrying that keyword hits one of this kind that much harder, on top of
//          knee/slope. Vanilla's silver bonus is an enchantment on the weapon, and an enchantment-source hit never
//          reaches this server's damage (hitService drops it), so silver has done nothing to the undead here; the
//          keyword is read off the weapon record instead (WeapMaterialSilver, 10aa1a:Skyrim.esm). The largest matching
//          weakness counts, never the product of several
//   magicTaken  scales the magic that lands on one, from anyone: a spell, a staff's or a scroll's cast, an enchantment's
//          hit when one reaches the server (a SPEL, ENCH or SCRL source, or the engine's spell flag on any source that is
//          not a weapon or a fist); weapon blows and fists stay as they are (Nat, 25 Oct: "buff giants against magic").
//          Shouts only with magicShouts true: a shout is a SPEL of type Voice (SPIT 11), and the Thu'um is not magic
// log    one line per scaled hit
// enabled false turns it all off. Read at load; gamemode.js reloads this module with the config.
'use strict';

const TEMPLATE_USE_TRAITS = 0x01;
const MAX_DEPTH = 8;

module.exports = (deps) => {
  const { mp, cfg, log, profileOf, recordOf } = deps;
  const C = Object.assign({ enabled: false, log: false, kinds: {} }, (cfg && cfg.npcToughness) || {});
  const idOf = (d) => { try { return typeof d === 'number' ? d >>> 0 : mp.getIdFromDesc(String(d)) >>> 0; } catch (e) { return 0; } };
  // race id -> kind name
  const KIND_OF_RACE = new Map();
  const KINDS = {};
  for (const [name, k] of Object.entries(C.kinds && typeof C.kinds === 'object' ? C.kinds : {})) {
    if (name.startsWith('_') || !k || typeof k !== 'object') continue;
    const knee = Number(k.knee), slope = Number(k.slope), dealt = Number(k.dealt), magicTaken = Number(k.magicTaken);
    const weakTo = new Map();
    for (const [kw, mult] of Object.entries(k.weakTo && typeof k.weakTo === 'object' ? k.weakTo : {})) {
      const id = idOf(kw); const m = Number(mult);
      if (id && m > 0) weakTo.set(id, m);
    }
    KINDS[name] = { knee: knee > 0 ? knee : 0, slope: slope > 0 && slope <= 1 ? slope : 1, dealt: dealt > 0 ? dealt : 1, weakTo,
      magicTaken: magicTaken > 0 ? magicTaken : 1, magicShouts: k.magicShouts === true };
    for (const r of Array.isArray(k.races) ? k.races : []) { const id = idOf(r); if (id) KIND_OF_RACE.set(id, name); }
  }
  // base id -> kind ('' for none); the plugins never change while the process runs
  const key = JSON.stringify([...KIND_OF_RACE].sort());
  const G = globalThis.__dboToughnessCache && globalThis.__dboToughnessCache.key === key
    ? globalThis.__dboToughnessCache : (globalThis.__dboToughnessCache = { key, kinds: new Map() });

  const fieldsOf = (res, type) => (res.record.fields || []).filter((f) => f && f.type === type && f.data instanceof Uint8Array);
  const viewOf = (data) => new DataView(data.buffer, data.byteOffset, data.byteLength);
  const globalAt = (res, data, at) => { try { return data.byteLength >= at + 4 ? res.toGlobalRecordId(viewOf(data).getUint32(at, true)) >>> 0 : 0; } catch (e) { return 0; } };
  const kindOfRecord = (id, depth) => {
    if (!id || depth > MAX_DEPTH) return '';
    const res = recordOf(id);
    if (!res) return '';
    const type = String(res.record.type);
    if (type === 'LVLN') {
      for (const f of fieldsOf(res, 'LVLO')) { const k = kindOfRecord(globalAt(res, f.data, 4), depth + 1); if (k) return k; }
      return '';
    }
    if (type !== 'NPC_') return '';
    const acbs = fieldsOf(res, 'ACBS')[0];
    const flags = acbs && acbs.data.byteLength >= 20 ? viewOf(acbs.data).getUint16(18, true) : 0;
    const tplt = fieldsOf(res, 'TPLT')[0];
    const next = tplt ? globalAt(res, tplt.data, 0) : 0;
    if (next && (flags & TEMPLATE_USE_TRAITS)) return kindOfRecord(next, depth + 1);
    const rnam = fieldsOf(res, 'RNAM')[0];
    return KIND_OF_RACE.get(rnam ? globalAt(res, rnam.data, 0) : 0) || '';
  };
  const kindOfBase = (base) => {
    const id = idOf(base);
    if (!id) return '';
    let k = G.kinds.get(id);
    if (k === undefined) { k = kindOfRecord(id, 0); G.kinds.set(id, k); }
    return k;
  };
  // The kind of an NPC (never a player's character), or ''
  const kindOf = (a) => {
    if (C.enabled !== true || !KIND_OF_RACE.size) return '';
    try { if (profileOf(a) >= 0) return ''; return kindOfBase(String(mp.get(a, 'baseDesc') || '')); } catch (e) { return ''; }
  };
  // A player, or someone fighting for one (ff_companionOf names a player: a summon, a raised corpse, a companion)
  const playerSide = (a) => {
    if (profileOf(a) >= 0) return true;
    try { const o = Number(mp.get(a, 'ff_companionOf')) >>> 0; return !!o && profileOf(o) >= 0; } catch (e) { return false; }
  };
  const note = (s) => { if (C.log === true) log(`toughness ${s}`); };

  // The keywords of the record a hit came from, as load-order ids. A weapon's KWDA; a spell or a fist has none, so it
  // never matches a weakness. Records never change while the process runs, so the list is cached per source.
  const KWDA_OF = globalThis.__dboToughnessKwda instanceof Map ? globalThis.__dboToughnessKwda : (globalThis.__dboToughnessKwda = new Map());
  const keywordsOf = (src) => {
    const id = Number(src) >>> 0;
    if (!id) return [];
    let out = KWDA_OF.get(id);
    if (out) return out;
    out = [];
    const res = recordOf(id);
    if (res && String(res.record.type) === 'WEAP') {
      for (const f of fieldsOf(res, 'KWDA')) {
        const n = Math.floor(f.data.byteLength / 4);
        for (let i = 0; i < n; i++) { const g = globalAt(res, f.data, i * 4); if (g && !out.includes(g)) out.push(g); }
      }
    }
    KWDA_OF.set(id, out);
    return out;
  };
  // The largest weakness of this kind the hit's weapon carries, else 1
  const weaknessMult = (k, src) => {
    if (!k.weakTo || !k.weakTo.size) return 1;
    let m = 1;
    for (const kw of keywordsOf(src)) { const w = k.weakTo.get(kw); if (w > m) m = w; }
    return m;
  };

  // The health a hit lands against: the health itself up to the knee, slope of the rest above it
  const effectiveHealth = (k, health) => (k.knee > 0 && health > k.knee ? k.knee + (health - k.knee) * k.slope : health);
  // A player's side hitting an NPC of a kind: the factor its hit scales by (>= 1)
  const takenMult = (agg, tgt, dmg, flags, src) => {
    if (!(dmg > 0) || agg === tgt || !playerSide(agg)) return 1;
    const kind = kindOf(tgt);
    const k = kind ? KINDS[kind] : null;
    if (!k) return 1;
    const weak = weaknessMult(k, src);
    const max = Number(flags && flags.targetMaxHealth);
    // A weakness stands on its own: it counts even where the health is unknown, which the knee and slope need
    if (!(max > 0)) return weak;
    const m = (max / effectiveHealth(k, max)) * weak;
    if (m > 1) note(`taken ${kind} ${tgt.toString(16)} health ${max.toFixed(0)} as ${effectiveHealth(k, max).toFixed(0)}`
      + `${weak > 1 ? `, weak to ${(src >>> 0).toString(16)} x${weak}` : ''}: x${m.toFixed(2)}`);
    return m > 1 ? m : 1;
  };
  // What a hit's source is: 'physical' (the fist 0x1f4, a WEAP), 'magic' (a SPEL, ENCH or SCRL), 'voice' (a SPEL of type
  // Voice, SPIT 11, as combat.js tells shouts apart) or 'none' (anything else). Records never change; cached per source
  const SOURCE_OF = globalThis.__dboToughnessSource instanceof Map ? globalThis.__dboToughnessSource : (globalThis.__dboToughnessSource = new Map());
  const sourceKindOf = (src) => {
    const id = Number(src) >>> 0;
    let m = SOURCE_OF.get(id);
    if (m) return m;
    const res = id && id !== 0x1f4 ? recordOf(id) : null;
    const type = res ? String(res.record.type) : '';
    if (id === 0x1f4 || type === 'WEAP') m = 'physical';
    else if (type === 'ENCH' || type === 'SCRL') m = 'magic';
    else if (type === 'SPEL') { const spit = fieldsOf(res, 'SPIT')[0]; m = spit && spit.data.byteLength >= 12 && viewOf(spit.data).getUint32(8, true) === 11 ? 'voice' : 'magic'; }
    else m = 'none';
    SOURCE_OF.set(id, m);
    return m;
  };
  // Magic landing on an NPC of a kind with magicTaken, from anyone but itself: that factor, else 1
  const magicTakenMult = (agg, tgt, dmg, flags, src) => {
    if (!(dmg > 0) || agg === tgt) return 1;
    const kind = kindOf(tgt);
    const k = kind ? KINDS[kind] : null;
    if (!k || k.magicTaken === 1) return 1;
    const what = sourceKindOf(src);
    const spellFlag = !!(flags && typeof flags === 'object' && flags.spell === true);
    const magic = what === 'magic' || (what === 'none' && spellFlag) || (what === 'voice' && k.magicShouts);
    if (!magic) return 1;
    note(`magic ${kind} ${tgt.toString(16)} from ${(src >>> 0).toString(16)} (${what}${spellFlag ? ', spell flag' : ''}): x${k.magicTaken}`);
    return k.magicTaken;
  };
  // An NPC of a kind hitting a player: the kind's dealt factor
  const dealtMult = (agg, tgt, dmg) => {
    if (!(dmg > 0) || agg === tgt) return 1;
    try { if (profileOf(tgt) < 0) return 1; } catch (e) { return 1; }
    const kind = kindOf(agg);
    const k = kind ? KINDS[kind] : null;
    if (!k || k.dealt === 1) return 1;
    note(`dealt ${kind} ${agg.toString(16)}: x${k.dealt}`);
    return k.dealt;
  };
  return { enabled: C.enabled === true, kindOf, kindOfBase, effectiveHealth: (kind, h) => (KINDS[kind] ? effectiveHealth(KINDS[kind], h) : h), takenMult, dealtMult, magicTakenMult };
};
