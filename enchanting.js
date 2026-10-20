// DragonBreak Online: what a new player enchantment is worth by the item it goes on and the materials spent (staff
// suggestion "Enchanting", 20 Oct). Loaded by gamemode.js; fork craftedExtrasSystem.ts asks globalThis.__dboEnchantScale
// once per accepted enchantment and stores each effect at the share returned (the Enchanter rank's cap applies first).
//   item      robes and clothing (jewelry too) keep all of it, light armor 66%, heavy armor 33%; weapons keep theirs
//   soul      apparel: the share of a Grand soul each size gives, in place of vanilla's (Greater 2/3 becomes full);
//             weapons: vanilla's soul sets the charge, not the strength, so they keep theirs by default
//   gemstone  effects in a gem family use one gemstone of it from the inventory: flawless full, regular less, none least;
//             never refused. The gem is taken by the same inventory write as the craft
// The enchanting menu shows vanilla's numbers; the stored strength reaches the client right after (craftedExtrasRefused).
// Config "enchanting" in gamemode-config.json.
'use strict';

// Vanilla's apparel magnitude per soul size against a Grand soul (UESP Skyrim:Enchanting_Effects; black counts as Grand)
const VANILLA_APPAREL_SOUL = [0, 1 / 12, 1 / 6, 1 / 3, 2 / 3, 1];
const SOUL_NAMES = ['', 'petty', 'lesser', 'common', 'greater', 'grand'];
const ARMOR_TYPES = { 0: 'light', 1: 'heavy', 2: 'clothing' };

module.exports = (api) => {
  const { mp, log, cfg } = api;
  const raw = cfg.enchanting || {};
  const C = Object.assign({ enabled: false, weaponShare: 1, notify: true }, raw);
  const ITEM = Object.assign({ clothing: 1, light: 0.66, heavy: 0.33, unknown: 1 }, raw.itemShare || {});
  const SOUL = Object.assign({ apparel: [1 / 12, 1 / 6, 1 / 3, 1, 1], weapon: [1, 1, 1, 1, 1] }, raw.soulShare || {});
  const GEM = Object.assign({ flawless: 1, regular: 0.8, none: 0.6, weapons: true, flawlessFirst: true }, raw.gems || {});
  const FAMILIES = raw.gemFamilies && typeof raw.gemFamilies === 'object' ? raw.gemFamilies : {};

  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const share = (v) => Math.max(0, Math.min(2, num(v, 1)));
  const idOf = (desc) => { try { return desc ? mp.getIdFromDesc(String(desc)) >>> 0 : 0; } catch (e) { return 0; } };
  const editorIds = new Map();
  const editorIdOf = (id) => {
    if (editorIds.has(id)) return editorIds.get(id);
    let e = '';
    try { const r = mp.lookupEspmRecordById(id >>> 0); e = r && r.record && r.record.editorId ? String(r.record.editorId) : ''; } catch (err) { e = ''; }
    editorIds.set(id, e);
    return e;
  };
  // Family by MGEF editor id, and its gem ids (flawless, regular), resolved once per load
  const familyOfEffect = new Map();
  const gemsOf = new Map();
  for (const [name, f] of Object.entries(FAMILIES)) {
    if (!f || typeof f !== 'object' || name.startsWith('_')) continue;
    for (const e of Array.isArray(f.effects) ? f.effects : []) familyOfEffect.set(String(e).toLowerCase(), name);
    gemsOf.set(name, {
      label: String(f.label || name),
      flawless: (Array.isArray(f.flawless) ? f.flawless : []).map(idOf).filter(Boolean),
      regular: (Array.isArray(f.regular) ? f.regular : []).map(idOf).filter(Boolean),
    });
  }
  const pct = (m) => `${Math.round(m * 100)}%`;

  // The item's and the soul's share, the same for every effect
  const baseShare = (info) => {
    const soul = Math.max(1, Math.min(5, Math.floor(num(info.soul, 5))));
    if (info.weapon) return { m: share(C.weaponShare) * share((SOUL.weapon || [])[soul - 1]), item: '', soul };
    const kind = ARMOR_TYPES[info.armorType] || 'unknown';
    const configured = (Array.isArray(SOUL.apparel) ? SOUL.apparel : [])[soul - 1];
    const soulShare = configured === undefined ? VANILLA_APPAREL_SOUL[soul] : share(configured);
    return { m: share(ITEM[kind]) * soulShare / VANILLA_APPAREL_SOUL[soul], item: kind, soul, soulShare };
  };

  globalThis.__dboEnchantScale = (actorId, info) => {
    if (!C.enabled || !info || !Array.isArray(info.effects)) return null;
    const base = baseShare(info);
    const spare = new Map();
    for (const e of Array.isArray(info.spare) ? info.spare : []) spare.set(Number(e.baseId) >>> 0, (spare.get(Number(e.baseId) >>> 0) || 0) + Math.max(0, num(e.count, 0)));
    const take = [];
    const used = new Map();   // family -> 'flawless' | 'regular' | 'none'
    const pick = (ids) => { const id = ids.find((x) => (spare.get(x) || 0) > 0); if (id) spare.set(id, spare.get(id) - 1); return id || 0; };
    const gemShareOf = (family) => {
      if (!used.has(family)) {
        const g = gemsOf.get(family);
        const order = GEM.flawlessFirst ? [['flawless', g.flawless], ['regular', g.regular]] : [['regular', g.regular], ['flawless', g.flawless]];
        let grade = 'none';
        for (const [name, ids] of order) { const id = pick(ids); if (id) { take.push(id); grade = name; break; } }
        used.set(family, grade);
      }
      return share(GEM[used.get(family)]);
    };
    const mults = info.effects.map((effectId) => {
      const family = familyOfEffect.get(editorIdOf(Number(effectId) >>> 0).toLowerCase());
      const gem = family && gemsOf.has(family) && (GEM.weapons || !info.weapon) ? gemShareOf(family) : 1;
      return Math.round(base.m * gem * 1000) / 1000;
    });
    // One line for the player: what the item and soul did, and each gemstone used or missing
    const parts = [];
    if (!info.weapon && base.item && share(ITEM[base.item]) !== 1) parts.push(`${base.item === 'heavy' ? 'Heavy' : 'Light'} armor holds ${pct(share(ITEM[base.item]))} of an enchantment's power`);
    if (!info.weapon && Math.abs(base.soulShare - VANILLA_APPAREL_SOUL[base.soul]) > 1e-3) parts.push(`a ${SOUL_NAMES[base.soul]} soul gives ${pct(base.soulShare)} of a grand one`);
    for (const [family, grade] of used) {
      const label = gemsOf.get(family).label;
      if (grade === 'flawless') parts.push(`a flawless ${label} was used`);
      else if (grade === 'regular') parts.push(`a ${label} was used (${pct(share(GEM.regular))}; a flawless one gives full strength)`);
      else parts.push(`without a ${label} that effect has ${pct(share(GEM.none))} of its strength`);
    }
    const note = C.notify && parts.length ? `Enchanting: ${parts.join('; ')}.` : undefined;
    return { mults, take, note };
  };
  log(`enchanting.js: ${C.enabled ? 'on' : 'off'}; items clothing ${ITEM.clothing}, light ${ITEM.light}, heavy ${ITEM.heavy}; ${familyOfEffect.size} effects in ${gemsOf.size} gem families`);
  return { baseShare };
};
