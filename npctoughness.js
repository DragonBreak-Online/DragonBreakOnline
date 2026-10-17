// DragonBreak Online: how tough one family of creatures is against players, by race (Nate, 17 Oct: "draugr, they're too
// strong apparently"). Loaded by gamemode.js like crashycreatures.js; config gamemode-config.json "npcToughness".
//
// The server gives an NPC its race's starting health plus its own health offset (fork GetBaseActorValues.cpp) and no
// health by level, so most enemies stand near vanilla's level-1 numbers while the draugr, whose records carry vanilla's
// fixed offsets, keep all of theirs: a Wight (level 13-15) 200-370, a Scourge (level 21-24) 500-700, a Deathlord (level
// 30-40) 710-960, where a bandit, a Falmer or a vampire of the same level has 140-330 (records of the 140-plugin order, 17 Oct).
//
// kinds { <name>: { races, knee, slope, dealt } }:
//   races  RACE descs; an NPC_ is judged by its race after its template chain (ACBS Use Traits), a LVLN by any entry
//   knee, slope  a player's (or their summon's or companion's) hit on one lands as if its health were
//          knee + (health - knee) * slope above the knee, as it is below: hits scale by health / that, so a 960-health
//          Deathlord takes the blows of a 504-health one and a 150-health Restless Draugr is unchanged
//   dealt  scales every hit one lands on a player (weapon, fists, spells and shouts), on top of npcDamage
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
    const knee = Number(k.knee), slope = Number(k.slope), dealt = Number(k.dealt);
    KINDS[name] = { knee: knee > 0 ? knee : 0, slope: slope > 0 && slope <= 1 ? slope : 1, dealt: dealt > 0 ? dealt : 1 };
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

  // The health a hit lands against: the health itself up to the knee, slope of the rest above it
  const effectiveHealth = (k, health) => (k.knee > 0 && health > k.knee ? k.knee + (health - k.knee) * k.slope : health);
  // A player's side hitting an NPC of a kind: the factor its hit scales by (>= 1)
  const takenMult = (agg, tgt, dmg, flags) => {
    if (!(dmg > 0) || agg === tgt || !playerSide(agg)) return 1;
    const kind = kindOf(tgt);
    const k = kind ? KINDS[kind] : null;
    if (!k) return 1;
    const max = Number(flags && flags.targetMaxHealth);
    if (!(max > 0)) return 1;
    const m = max / effectiveHealth(k, max);
    if (m > 1) note(`taken ${kind} ${tgt.toString(16)} health ${max.toFixed(0)} as ${effectiveHealth(k, max).toFixed(0)}: x${m.toFixed(2)}`);
    return m > 1 ? m : 1;
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
  return { enabled: C.enabled === true, kindOf, kindOfBase, effectiveHealth: (kind, h) => (KINDS[kind] ? effectiveHealth(KINDS[kind], h) : h), takenMult, dealtMult };
};
