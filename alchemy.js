// DragonBreak Online: alchemy at the ordinary alchemy labs. Loaded by gamemode.js on every hot reload.
//
// The lab's own menu mixes on the client and makes a potion no plugin holds (a 0xff... form), so the server's recipe
// check never matches it: every potion made this way used to be refused and rolled back. CraftService now fires
// onCraftUnmatched for such a craft, and this module honours it the way Nat chose: the effect is worked out here from
// the ingredient records (never taken from the client), and the player gets the nearest vanilla potion or poison
// (alchemy-potions.json, weakest to strongest), its strength set by their Alchemist rank. One of each ingredient used
// is taken, as in vanilla. The arcane enchanter's reports come here too: a disenchanted item is taken (disenchant below).
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, display, who, openWidget, closeWidget, every, itemName, onUi } = api;

  const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); } catch (e) { log(`alchemy: ${file} unreadable (${e.message})`); return fallback; } };
  const TABLE = readJson('alchemy-potions.json', { effects: {} }).effects || {};
  const idOf = (desc) => { try { return mp.getIdFromDesc(desc) >>> 0; } catch (e) { return 0; } };
  // Effect (global id) -> potion ids, weakest first
  const POTIONS = new Map();
  for (const [mg, v] of Object.entries(TABLE)) {
    const effect = idOf(`${mg}:Skyrim.esm`);
    // Sorted here: the table lists some out of order (Invisibility 01, 04, 02, 03), which gave a tier 1 brewer the strongest
    const ids = (v.potions || []).map((p) => ({ id: idOf(p.id), edid: p.edid, mag: Number(p.mag) || 0, dur: Number(p.dur) || 0 })).filter((p) => p.id)
      .sort((x, y) => x.mag - y.mag || x.dur - y.dur);
    if (effect && ids.length) POTIONS.set(effect, { name: v.effect, potions: ids });
  }

  const lookup = (id) => { try { const r = mp.lookupEspmRecordById(id >>> 0); return r && r.record ? r : null; } catch (e) { return null; } };
  const u32 = (f, off) => { const d = f && f.data; if (!(d instanceof Uint8Array) || d.byteLength < off + 4) return 0; return new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(off, true); };
  const f32 = (f, off) => { const d = f && f.data; if (!(d instanceof Uint8Array) || d.byteLength < off + 4) return 0; return new DataView(d.buffer, d.byteOffset, d.byteLength).getFloat32(off, true); };
  // An ingredient's effects as load-order ids (EFID is record-local, so it goes through the ingredient's own file)
  // A record lookup copies every subrecord and the plugins never change while the server runs, so both are kept per id
  // (the brew list pairs every ingredient carried)
  const CACHE = globalThis.__dboAlchemyCache || (globalThis.__dboAlchemyCache = { effects: new Map(), cost: new Map() });
  const effectsOf = (ingredient) => {
    const id = ingredient >>> 0;
    if (CACHE.effects.has(id)) return CACHE.effects.get(id);
    const lr = lookup(id);
    let out = null;
    if (lr && String(lr.record.type) === 'INGR') {
      out = [];
      for (const f of lr.record.fields || []) if (f.type === 'EFID') { try { const g = lr.toGlobalRecordId(u32(f, 0)) >>> 0; if (g) out.push(g); } catch (e) { /* unmapped */ } }
    }
    if (lr || id >= 0xff000000) CACHE.effects.set(id, out);
    return out;
  };
  const baseCost = (effect) => {
    const id = effect >>> 0;
    if (CACHE.cost.has(id)) return CACHE.cost.get(id);
    const lr = lookup(id); const data = lr && (lr.record.fields || []).find((f) => f.type === 'DATA');
    const cost = data ? f32(data, 4) : 0;
    if (lr) CACHE.cost.set(id, cost);
    return cost;
  };
  const isLab = (workbenchId) => {
    let base = 0; try { base = mp.getIdFromDesc(String(mp.get(workbenchId >>> 0, 'baseDesc'))) >>> 0; } catch (e) { return false; }
    const lr = lookup(base);
    return !!lr && /alchemy/i.test(String(lr.record.editorId || ''));
  };
  // The client names the workbench, so the brewer must stand at it (the old /brew range)
  const LAB_REACH = 400;
  const atLab = (a, workbenchId) => {
    try {
      if (String(mp.get(a, 'worldOrCellDesc')) !== String(mp.get(workbenchId, 'worldOrCellDesc'))) return false;
      const p = mp.get(a, 'pos'), q = mp.get(workbenchId, 'pos');
      if (!Array.isArray(p) || !Array.isArray(q)) return false;
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      return Number.isFinite(d) && d <= LAB_REACH;
    } catch (e) { return false; }
  };
  const alchemistTier = (a) => {
    try {
      const r = mp.get(a, 'private.mastery');
      if (!r || !Array.isArray(r.order) || !r.order.includes('alchemist')) return 0;
      const p = r.skills && r.skills.alchemist;
      return (p ? Math.max(0, Number(p.rank) || 0) : 0) + 1;
    } catch (e) { return 0; }
  };
  const invOf = (a) => { try { const inv = mp.get(a, 'inventory'); return inv && Array.isArray(inv.entries) ? inv.entries.map((e) => Object.assign({}, e)) : []; } catch (e) { return []; } };
  const countOf = (entries, id) => entries.filter((e) => (Number(e.baseId) >>> 0) === id).reduce((n, e) => n + (Number(e.count) || 0), 0);
  const take = (entries, id, n) => {
    for (const e of entries) {
      if (n <= 0) break;
      if ((Number(e.baseId) >>> 0) !== id || e.worn) continue;
      const k = Math.min(n, Number(e.count) || 0); e.count = (Number(e.count) || 0) - k; n -= k;
    }
  };
  const give = (entries, id, n) => { const hit = entries.find((e) => (Number(e.baseId) >>> 0) === id && !e.worn); if (hit) hit.count = (Number(hit.count) || 0) + n; else entries.push({ baseId: id, count: n }); };
  // Effects two or more of the ingredients share that a known potion carries, the most valuable first: that one decides
  const sharedEffects = (used) => {
    const tally = new Map();
    for (const id of used) for (const e of new Set(effectsOf(id) || [])) tally.set(e, (tally.get(e) || 0) + 1);
    return [...tally].filter(([, n]) => n >= 2).map(([e]) => e).filter((e) => POTIONS.has(e) || RULES.has(e)).sort((x, y) => baseCost(y) - baseCost(x));
  };
  const potionAt = (pick, tier) => pick.potions[Math.max(0, Math.min(pick.potions.length - 1, Math.round(tier / 5 * (pick.potions.length - 1))))];
  // Brewing is the Alchemist's work (Nate, 2026-09-30: Alchemist rose from picking mushrooms; gathering is the Harvesting
  // trade's). One brew is worth 1 at tier 1 up to 3 at tier 5, and the same potion again within the hour less
  // (masterySystem's repeat ring, keyed on the potion). __alduinakMasteryAward (fork server-next-v2) credits only a skill
  // already held; before that fork is live there is nothing to call, and the lab's own count in skills.json stands in.
  // What went into a brew, in gold (each ingredient's INGR DATA value at 0, at most 100): skillrates.js valueWeight reads it
  // (globalThis.__dboBrewValue) for the award that follows, so two Wheat earn less than Deathbell and Nightshade
  const ingredientValue = (ids) => ids.reduce((n, [id, count]) => {
    const lr = lookup(id); const f = lr && (lr.record.fields || []).find((x) => x.type === (String(lr.record.type) === 'ALCH' ? 'ENIT' : 'DATA'));
    const v = f && f.data instanceof Uint8Array && f.data.byteLength >= 4 ? new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getInt32(0, true) : 0;
    return n + Math.max(0, Math.min(100, v)) * (Number(count) || 1);
  }, 0);
  const creditBrew = (a, potionId, tier, value) => {
    const award = globalThis.__alduinakMasteryAward;
    if (typeof award !== 'function') return 0;
    globalThis.__dboBrewValue = Number.isFinite(Number(value)) ? { actor: a >>> 0, key: Number(potionId) >>> 0, value: Number(value) } : null;
    let units = 0;
    try { units = Number(award(a, 'alchemist', Math.min(3, 1 + 0.5 * Math.max(0, (Number(tier) || 1) - 1)), Number(potionId) >>> 0)) || 0; } catch (e) { log(`alchemy: mastery award failed for ${display(a)}: ${e.message}`); globalThis.__dboBrewValue = null; return 0; }
    globalThis.__dboBrewValue = null;
    // masterySystem reports what a craft event credited, never an award: tell skillrates.js, so a first brew of a potion is
    // marked made only when it earned something (skillrates.js craftAwards)
    try { if (typeof globalThis.__dboSkillRateCredited === 'function') globalThis.__dboSkillRateCredited(a, 'alchemist', 'award', { key: Number(potionId) >>> 0 }, units); } catch (e) { /* the bonus waits */ }
    return units;
  };
  const potionName = (potion) => potion.edid.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/\s+0?(\d+)$/, ' $1');

  // ---- the alchemy rework (Nate, 14 Oct, "DBO: Alchemy Rework"; alchemy-rework.json) -------------------------------
  // The Alchemist's five tiers are the design's five levels (skillPoints TIER_FLOORS 1/25/50/75/90), so each tier names its
  // own record per effect: the weakest restore (Minor) is never brewed, Apprentice and Adept no longer share a strength
  // (potionAt's rounding gave both index 2), and specials, fortify skills, Smithing and Enchanting open at 25, 50 and 75.
  // An effect the file does not list keeps potionAt. Config "alchemyRework" in gamemode-config.json overrides any key.
  const RW = Object.assign({ enabled: true, tierNames: ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'], tierLevels: [1, 25, 50, 75, 90],
    words: { potion: ['Potion', 'Draught', 'Solution', 'Philter', 'Elixir'], poison: ['Weak Poison', 'Poison', 'Potent Poison', 'Virulent Poison', 'Deadly Poison'] },
    restoreBands: [[25, 0.1], [50, 0.2], [75, 0.3], [100, 0.45], [150, 0.6], [1e9, 0.75]], resist: { enabled: true }, effects: {}, combos: [],
    records: {}, percentEffects: [], overTime: {}, fortify: {}, poisons: {} },
  readJson('alchemy-rework.json', {}), (api.cfg || {}).alchemyRework || {});
  const EDID_IDS = new Map();
  for (const v of Object.values(TABLE)) for (const p of v.potions || []) { const id = idOf(p.id); if (id) EDID_IDS.set(String(p.edid), { id, edid: String(p.edid) }); }
  // The PC's records (DragonBreak Online Edits) are named by editor id; `records` maps each to its desc once the PC has
  // sent the local ids. A desc whose record carries another editor id is refused (a wrong id would hand out the wrong
  // potion), and an editor id not mapped yet leaves that tier to its vanilla fallback.
  const MAPPED = RW.records && typeof RW.records === 'object' ? RW.records : {};
  const unmapped = new Set();
  const byEditorId = (edid) => {
    const desc = MAPPED[edid];
    if (!desc || typeof desc !== 'string' || !/:/.test(desc)) { unmapped.add(edid); return null; }
    const id = idOf(desc); const r = id ? lookup(id) : null;
    if (!r || String(r.record.editorId || '') !== edid) { log(`alchemy: rework record ${edid} -> ${desc} is ${r ? `${r.record.editorId}, not ${edid}` : 'not in the load order'}; left out`); return null; }
    return { id, edid };
  };
  const recordRef = (ref) => {
    if (!ref) return null;
    if (EDID_IDS.has(String(ref))) return EDID_IDS.get(String(ref));
    if (!/:/.test(String(ref))) return byEditorId(String(ref));
    const id = idOf(String(ref)); if (!id) return null;
    const r = lookup(id);
    return { id, edid: String((r && r.record.editorId) || ref) };
  };
  // A magic effect named in the data: a Skyrim.esm local id ('03eb15'), a desc ('60193e:BSAssets.esm') or a PC editor id
  const effectRef = (ref) => {
    const s = String(ref || '');
    if (/^[0-9a-f]{1,6}$/i.test(s)) return idOf(`${s}:Skyrim.esm`);
    if (/:/.test(s)) return idOf(s);
    const r = byEditorId(s); return r ? r.id : 0;
  };
  const RULES = new Map();   // effect (global id) -> { label, kind, minTier, byTier: [{ id, edid } | null] x5, why }
  if (RW.enabled !== false) {
    for (const [mg, v] of Object.entries(RW.effects || {})) {
      if (!v || mg.startsWith('_')) continue;
      const effect = effectRef(mg);
      if (!effect) continue;
      // byTier names the design's records, fallback the vanilla ones used until those are mapped
      // A fallback record is named for what it is (fallbackLabel: a vanilla One-handed potion is not a Fortify Blade)
      const byTier = [0, 1, 2, 3, 4].map((i) => { const own = recordRef((v.byTier || [])[i]); if (own) return own; const fb = recordRef((v.fallback || [])[i]); return fb && v.fallbackLabel ? Object.assign({ label: String(v.fallbackLabel) }, fb) : fb; });
      const unresolved = (v.byTier || []).filter((x, i) => x && !byTier[i] && (EDID_IDS.has(x) || /:/.test(x) || MAPPED[x]));
      if (unresolved.length) log(`alchemy: rework ${v.label || mg} names ${unresolved.join(', ')}, not a known potion; those tiers brew nothing`);
      RULES.set(effect, { label: String(v.label || mg), kind: String(v.kind || ''), minTier: Math.max(1, Math.min(5, Math.floor(Number(v.minTier) || 1))), byTier, why: String(v.why || '') });
    }
  }
  if (unmapped.size) log(`alchemy: rework ${unmapped.size} PC record(s) not mapped yet (alchemy-rework.json records); their tiers brew the vanilla fallback`);
  // Two-effect records for tier 4 and 5 (combination potions): { effects: ['03eb42', '03a2c6'], minTier: 4, byTier: [..x5], name }
  const COMBOS = (RW.enabled !== false && Array.isArray(RW.combos) ? RW.combos : []).map((c) => ({
    effects: (c.effects || []).map(effectRef).filter(Boolean),
    minTier: Math.max(1, Math.min(5, Math.floor(Number(c.minTier) || 4))),
    byTier: [0, 1, 2, 3, 4].map((i) => recordRef((c.byTier || [])[i])),
    name: String(c.name || ''),
    names: Array.isArray(c.names) ? c.names.map((x) => (x ? String(x) : '')) : [],
  })).filter((c) => c.effects.length === 2 && c.byTier.some(Boolean));
  const tierName = (tier) => RW.tierNames[Math.max(0, Math.min(4, (Number(tier) || 1) - 1))];
  const tierLevel = (tier) => RW.tierLevels[Math.max(0, Math.min(4, (Number(tier) || 1) - 1))];
  const designName = (rule, tier, label) => {
    const words = rule.kind === 'poison' ? RW.words.poison : RW.words.potion;
    return `${words[Math.max(0, Math.min(4, tier - 1))]} of ${label || rule.label}`;
  };
  // The potion the brewer's tier gives for an effect: { id, edid, name, effect } or { locked: minTier } or null
  const chooseFor = (effect, tier) => {
    const t = Math.max(1, Math.min(5, Number(tier) || 1));
    const rule = RULES.get(effect);
    if (rule) {
      // An effect nothing on the server honours (Fortify Smithing, Enchanting, Illusion) is never brewed
      if (rule.kind === 'dropped') return { dropped: true, label: rule.label, why: rule.why };
      if (t < rule.minTier) return { locked: rule.minTier, label: rule.label };
      const rec = rule.byTier[t - 1];
      return rec ? { id: rec.id, edid: rec.edid, name: designName(rule, t, rec.label), effect } : null;
    }
    const pick = POTIONS.get(effect);
    if (!pick) return null;
    const potion = potionAt(pick, tier);
    return { id: potion.id, edid: potion.edid, name: potionName(potion), effect };
  };
  // What a mix makes: a combination first at tier 4+, else the most valuable shared effect the brewer may brew, and the
  // stronger effects it passed over because they open later
  const choose = (shared, tier) => {
    const t = Math.max(1, Math.min(5, Number(tier) || 1));
    for (const c of COMBOS) {
      if (t < c.minTier || !c.effects.every((e) => shared.includes(e))) continue;
      const rec = c.byTier[t - 1];
      if (rec) return { potion: { id: rec.id, edid: rec.edid, name: c.names[t - 1] || c.name || potionName(rec), effect: c.effects[0] }, passed: [] };
    }
    const passed = [];
    for (const e of shared) {
      const got = chooseFor(e, t);
      if (!got) continue;
      if (got.locked || got.dropped) { passed.push(got); continue; }
      return { potion: got, passed };
    }
    return { potion: null, passed };
  };
  const passedLine = (p) => (p.dropped ? ` ${p.label} is not brewed here${p.why ? `: ${p.why}` : ''}.` : ` ${p.label} needs an Alchemist of ${tierName(p.locked)} rank (level ${tierLevel(p.locked)}).`);
  const lockedHint = (passed) => (passed.length ? passedLine(passed[0]) : '');

  // ---- what a potion does when drunk, read from its record (ALCH ENIT, EFID/EFIT; MGEF DATA, libespm MGEF.cpp) -----
  // ENIT flags at 4: 0x2 food, 0x20000 poison (libespm ALCH.cpp). MGEF DATA: flags at 0 (0x1 hostile, 0x2 recover,
  // 0x4 detrimental), archetype at 0x40 (0 value modifier), primary actor value at 0x44 (24 Health, 25 Magicka, 26 Stamina,
  // 41 FireResist, 42 ElectricResist, 43 FrostResist; libespm ActorValue.h). EFIT: magnitude float at 0, duration at 8.
  const AV_POOL = { 24: 'health', 25: 'magicka', 26: 'stamina' };
  const AV_ELEMENT = { 41: 'fire', 42: 'shock', 43: 'frost' };
  const DRAUGHT_OF_REVIVAL = idOf('12ae16:DragonBreak Online Edits.esp');
  const drinkCache = new Map();   // rebuilt at each reload, so new restoreBands take at once
  const restoreShare = (magnitude) => {
    for (const [upTo, share] of RW.restoreBands || []) if (magnitude <= Number(upTo)) return Number(share) || 0;
    return 0;
  };
  // The PC's restore effects carry the share itself as their magnitude ("Restores <mag>% of your Health"); a vanilla one
  // carries points, read through restoreBands. Philter and Elixir strength (fromShare and up) and the PC's slow effects
  // restore over overTime.seconds in ticks, so a burst of damage meanwhile can still win (Nate, 14 Oct)
  const PCT_EFFECTS = new Set((RW.percentEffects || []).map(effectRef).filter(Boolean));
  const OVER = Object.assign({ enabled: true, fromShare: 0.6, seconds: 5, tickMs: 500, slowEffects: [] }, RW.overTime || {});
  const SLOW_EFFECTS = new Set((OVER.slowEffects || []).map(effectRef).filter(Boolean));
  // Fortify potions the server honours, by magic effect: hook (what reads it: blade, blunt, archery, one, two, bow,
  // school:20 Destruction, school:22 Restoration, duration:18 Alteration, duration:19 Conjuration, block, armor, lockpick),
  // bonus = magnitude x perPoint, at most cap. The game's own copy of the effect never reaches the server's numbers.
  const FORT = Object.assign({ enabled: true, effects: {}, lockpickTiers: [[0.35, 1], [1e9, 2]] }, RW.fortify || {});
  const FORT_EFFECTS = new Map();
  for (const [ref, v] of Object.entries(FORT.effects || {})) {
    if (ref.startsWith('_') || !v || !v.hook) continue;
    const id = effectRef(ref);
    if (id) FORT_EFFECTS.set(id, { hook: String(v.hook), perPoint: Number(v.perPoint) || 0.01, cap: Number(v.cap) || 0.5, text: String(v.text || v.hook) });
  }
  const drinkOf = (baseId) => {
    const id = baseId >>> 0;
    if (drinkCache.has(id)) return drinkCache.get(id);
    let out = null;
    const lr = id && id !== DRAUGHT_OF_REVIVAL ? lookup(id) : null;
    if (lr && String(lr.record.type) === 'ALCH') {
      const fields = lr.record.fields || [];
      const flags = u32(fields.find((f) => f.type === 'ENIT'), 4);
      if (!(flags & 0x2) && !(flags & 0x20000)) {
        out = { restores: [], resists: [], fortify: [] };
        let effect = 0;
        for (const f of fields) {
          if (f.type === 'EFID') { try { effect = lr.toGlobalRecordId(u32(f, 0)) >>> 0; } catch (e) { effect = 0; } continue; }
          if (f.type !== 'EFIT' || !effect) continue;
          const mg = effect; effect = 0;
          const magnitude = f32(f, 0), duration = u32(f, 8);
          const fort = FORT.enabled !== false ? FORT_EFFECTS.get(mg) : null;
          if (fort) {
            if (magnitude > 0 && duration > 0) out.fortify.push({ hook: fort.hook, bonus: Math.min(fort.cap, magnitude * fort.perPoint), seconds: duration, text: fort.text });
            continue;
          }
          const m = lookup(mg); const data = m && (m.record.fields || []).find((x) => x.type === 'DATA');
          if (!data || !(data.data instanceof Uint8Array) || data.data.byteLength < 0x48) continue;
          const mflags = u32(data, 0), archetype = u32(data, 0x40), av = new DataView(data.data.buffer, data.data.byteOffset, data.data.byteLength).getInt32(0x44, true);
          if (AV_POOL[av] && archetype === 0 && !(mflags & 0x7)) {
            const share = PCT_EFFECTS.has(mg) || SLOW_EFFECTS.has(mg) ? Math.max(0, Math.min(1, magnitude / 100)) : restoreShare(magnitude);
            const slow = OVER.enabled !== false && (SLOW_EFFECTS.has(mg) || share >= (Number(OVER.fromShare) || 2));
            out.restores.push({ av: AV_POOL[av], share, magnitude, slow });
          } else if (AV_ELEMENT[av] && !(mflags & 0x4) && magnitude > 0 && duration > 0) out.resists.push({ element: AV_ELEMENT[av], share: Math.min(1, magnitude / 100), seconds: duration });
        }
        if (!out.restores.length && !out.resists.length && !out.fortify.length) out = null;
      }
    }
    if (lr || !id) drinkCache.set(id, out);
    return out;
  };
  // What a brewed potion does, in words for the brew message and the panel
  const overText = () => `over ${Number(OVER.seconds) || 5} s`;
  const doesText = (potionId, short) => {
    const d = drinkOf(potionId);
    if (!d) return '';
    return d.restores.map((r) => (short ? `${Math.round(r.share * 100)}% ${r.av}${r.slow ? ` ${overText()}` : ''}` : `restores ${Math.round(r.share * 100)}% of your ${r.av}${r.slow ? ` ${overText()}` : ''}`))
      .concat(d.resists.map((r) => (short ? `${Math.round(r.share * 100)}% ${r.element}` : `${Math.round(r.share * 100)}% ${r.element} resistance for ${r.seconds} s`)))
      .concat(d.fortify.map((r) => (r.hook === 'lockpick' ? `locks one rank easier for ${r.seconds} s` : short ? `+${Math.round(r.bonus * 100)}% ${r.text}` : `+${Math.round(r.bonus * 100)}% ${r.text} for ${r.seconds} s`))).join(', ');
  };

  // Drinking: a restore gives a share of the drinker's own pool (percentages are fractions of the actor's maximum, so a
  // larger pool gains more), never the record's points. The C++ applies the record first (MpActor ApplyMagicEffect,
  // which also opens the 5 s window that echoes the client's stale reports); on the next turn of the loop the value is
  // set to what it was before the drink plus the share, or, for a restore over time, back to what it was, the share then
  // coming in ticks (a new drink of the same pool replaces a running one; the C++'s 10 s potion cooldown stays). A resist
  // and a fortify are remembered for the damage judge and the systems that read them (gamemode.js potionResistMult,
  // __dboPotionBonus), which knew nothing of them: the client's own copy of the effect never reaches the server.
  const RESIST = globalThis.__dboPotionResist instanceof Map ? globalThis.__dboPotionResist : (globalThis.__dboPotionResist = new Map()); // actor -> { element: { share, until } }
  const FORTIFIED = globalThis.__dboPotionFortify instanceof Map ? globalThis.__dboPotionFortify : (globalThis.__dboPotionFortify = new Map()); // actor -> { hook: { bonus, until } }
  // Restores and poison drains in ticks: `${actor}|${pool}` -> { a, av, per (signed share per tick), left (ticks), floor, why }
  const TICKS = globalThis.__dboAlchemyTicks instanceof Map ? globalThis.__dboAlchemyTicks : (globalThis.__dboAlchemyTicks = new Map());
  const later = typeof setImmediate === 'function' ? setImmediate : (fn) => setTimeout(fn, 0);
  const pctOf = (a) => { try { const p = mp.get(a, 'percentages'); return p && typeof p.health === 'number' ? p : null; } catch (e) { return null; } };
  const downed = (a) => { try { return typeof globalThis.__dboIsDowned === 'function' && !!globalThis.__dboIsDowned(a); } catch (e) { return false; } };
  const tickMs = () => Math.max(100, Number(OVER.tickMs) || 500);
  const startTicks = (a, av, total, seconds, floor, why) => {
    const n = Math.max(1, Math.round((Math.max(0, Number(seconds) || 0) * 1000) / tickMs()));
    TICKS.set(`${a >>> 0}|${av}`, { a: a >>> 0, av, per: total / n, left: n, floor: Number(floor) || 0, why });
  };
  // One turn of every running restore and drain, one write per actor; a dead or downed actor's stop
  const runTicks = () => {
    const byActor = new Map();
    for (const [k, t] of TICKS) { if (!byActor.has(t.a)) byActor.set(t.a, []); byActor.get(t.a).push([k, t]); }
    for (const [a, list] of byActor) {
      const p = pctOf(a);
      if (!p || !(p.health > 0) || downed(a)) { for (const [k] of list) TICKS.delete(k); continue; }
      const next = { health: p.health, magicka: p.magicka, stamina: p.stamina };
      for (const [k, t] of list) {
        const v = Number(next[t.av]) || 0;
        next[t.av] = t.per >= 0 ? Math.min(1, v + t.per) : Math.max(Math.min(v, t.floor), v + t.per);
        if (--t.left <= 0) TICKS.delete(k);
      }
      try { mp.set(a, 'percentages', next); } catch (e) { for (const [k] of list) TICKS.delete(k); }
    }
  };
  globalThis.__dboAlchemyRunTicks = runTicks;
  if (every) every('alchemyTicks', tickMs(), () => { if (TICKS.size) runTicks(); });
  const onDrink = (a, baseId, before) => {
    const d = drinkOf(baseId);
    if (!d) return;
    if (d.resists.length && (RW.resist || {}).enabled !== false) {
      const s = Object.assign({}, RESIST.get(a) || {});
      for (const r of d.resists) s[r.element] = { share: r.share, until: Date.now() + r.seconds * 1000 };
      RESIST.set(a, s);
    }
    // A fortify replaces the running one of its kind, never stacks with it
    if (d.fortify.length) {
      const s = Object.assign({}, FORTIFIED.get(a) || {});
      for (const r of d.fortify) s[r.hook] = { bonus: r.bonus, until: Date.now() + r.seconds * 1000 };
      FORTIFIED.set(a, s);
      if (FORTIFIED.size > 512) { const now = Date.now(); for (const [k, v] of FORTIFIED) if (Object.values(v).every((x) => x.until <= now)) FORTIFIED.delete(k); }
    }
    if (!d.restores.length || !before || !(before.health > 0) || downed(a)) return;
    later(() => {
      try {
        const now = pctOf(a);
        if (!now || !(now.health > 0)) return;
        const next = { health: now.health, magicka: now.magicka, stamina: now.stamina };
        for (const r of d.restores) {
          const from = Number(before[r.av]) || 0;
          // Over time: the C++'s instant points come off again, the share arrives in ticks from here
          if (r.slow) { next[r.av] = Math.min(Number(next[r.av]) || 0, from); startTicks(a, r.av, r.share, OVER.seconds, 0, 'potion'); } else next[r.av] = Math.max(0, Math.min(1, from + r.share));
        }
        mp.set(a, 'percentages', next);
        const r0 = lookup(baseId);
        log(`alchemy: ${display(a)} drank ${r0 ? r0.record.editorId : (baseId >>> 0).toString(16)}: ${d.restores.map((r) => `${r.av} ${(Number(before[r.av]) || 0).toFixed(2)} -> ${r.slow ? `+${Math.round(r.share * 100)}% ${overText()}` : `${next[r.av].toFixed(2)} (+${Math.round(r.share * 100)}%)`}`).join(', ')}`);
      } catch (e) { log(`alchemy: restore for ${display(a)} failed: ${e.message}`); }
    });
  };
  globalThis.__dboPotionResistOf = (a, element) => {
    const s = RESIST.get(a >>> 0);
    const r = s && s[element];
    if (!r) return 0;
    if (Date.now() >= r.until) { delete s[element]; return 0; }
    return r.share;
  };
  // The bonus a fortify potion gives `a` for `hook` now (0 when none): gamemode.js (weapon and spell damage, armour, the
  // Flesh spells' and summons' durations, Restoration's healing), combat.js (block) and lockpick.js read it
  globalThis.__dboPotionBonus = (a, hook) => {
    const s = FORTIFIED.get(a >>> 0);
    const r = s && s[hook];
    if (!r) return 0;
    if (Date.now() >= r.until) { delete s[hook]; return 0; }
    return Number(r.bonus) || 0;
  };
  // A lockpicking potion counts as this many Lockpicking ranks more (lockpickTiers: [[bonus up to, ranks], ...])
  globalThis.__dboPotionLockpickTiers = (a) => {
    const b = globalThis.__dboPotionBonus(a, 'lockpick');
    if (!(b > 0)) return 0;
    for (const [upTo, n] of FORT.lockpickTiers || []) if (b <= Number(upTo)) return Math.max(0, Math.floor(Number(n) || 0));
    return 0;
  };

  // ---- weapon poisons, judged on the server (inert until poisons.judge; plan section 9) ----------------------------
  // A poison the player puts on a weapon reaches the server's copy of it (fork craftedExtrasSystem: poisonId and
  // poisonCount on the inventory entry, from the client's craft report), and its blow arrives as that weapon's own hit:
  // the client never reports a hit whose source is the poison (staffHit.ts routeHit drops "other source"). So the hit
  // judge can find the poison on the attacker's worn copy of the weapon. Damage is a share of the TARGET's own pool, the
  // record's points over anchorPool (200: a 200-point pool takes exactly the design's numbers, 30/35/40/50/65 at once and
  // 2/3/5/5 a second for 10 s), so a larger pool loses more points, a smaller one fewer. Poison never lands the killing
  // blow (minHealth, as the mastery give-back: percentages carry no killer); the next blow does. A drain replaces a running
  // one on the same pool. Charges are counted here, since the client's "used up" report comes up to 10 s later.
  const POISON = Object.assign({ judge: false, anchorPool: 200, minHealth: 0.01, ledgerMinutes: 5,
    damage: { '03eb42': 'health', '03a2b6': 'magicka', '03a2c6': 'stamina' },
    linger: { '10aa4a': 'health', '10de5f': 'magicka', '10de5e': 'stamina' } }, RW.poisons || {});
  const POISON_DAMAGE = new Map(), POISON_LINGER = new Map();
  for (const [ref, av] of Object.entries(POISON.damage || {})) { const id = effectRef(ref); if (id) POISON_DAMAGE.set(id, String(av)); }
  for (const [ref, av] of Object.entries(POISON.linger || {})) { const id = effectRef(ref); if (id) POISON_LINGER.set(id, String(av)); }
  const poisonCache = new Map();
  // { hits: [{ av, share }], drains: [{ av, perSecond, seconds }] } of a poison record, null for anything else
  const poisonOf = (baseId) => {
    const id = baseId >>> 0;
    if (poisonCache.has(id)) return poisonCache.get(id);
    let out = null;
    const lr = id ? lookup(id) : null;
    if (lr && String(lr.record.type) === 'ALCH' && (u32((lr.record.fields || []).find((f) => f.type === 'ENIT'), 4) & 0x20000)) {
      const anchor = Math.max(1, Number(POISON.anchorPool) || 200);
      out = { hits: [], drains: [] };
      let effect = 0;
      for (const f of lr.record.fields || []) {
        if (f.type === 'EFID') { try { effect = lr.toGlobalRecordId(u32(f, 0)) >>> 0; } catch (e) { effect = 0; } continue; }
        if (f.type !== 'EFIT' || !effect) continue;
        const mg = effect; effect = 0;
        const magnitude = f32(f, 0), duration = u32(f, 8);
        if (!(magnitude > 0)) continue;
        if (POISON_DAMAGE.has(mg)) out.hits.push({ av: POISON_DAMAGE.get(mg), share: Math.min(1, magnitude / anchor) });
        else if (POISON_LINGER.has(mg) && duration > 0) out.drains.push({ av: POISON_LINGER.get(mg), perSecond: magnitude / anchor, seconds: duration });
      }
      if (!out.hits.length && !out.drains.length) out = null;
    }
    if (lr || !id) poisonCache.set(id, out);
    return out;
  };
  const LEDGER = globalThis.__dboPoisonLedger instanceof Map ? globalThis.__dboPoisonLedger : (globalThis.__dboPoisonLedger = new Map()); // agg|weapon|poison -> { left, at }
  // From gamemode.js's hit judge for a landed, unblocked weapon hit. Returns what it did (for the log and the harness)
  globalThis.__dboPoisonHit = (aggressor, target, source, flags) => {
    if (POISON.judge !== true) return null;
    const agg = aggressor >>> 0, tgt = target >>> 0, src = source >>> 0;
    if (agg === tgt || (flags && (flags.blocked || flags.spell))) return null;
    let entries = [];
    try { const inv = mp.get(agg, 'inventory'); entries = inv && Array.isArray(inv.entries) ? inv.entries : []; } catch (e) { return null; }
    const copy = entries.find((e) => e && (Number(e.baseId) >>> 0) === src && (e.worn || e.wornLeft) && (Number(e.poisonId) >>> 0));
    const now = Date.now();
    for (const [k, v] of LEDGER) if (now - v.at > Math.max(1, Number(POISON.ledgerMinutes) || 5) * 60000) LEDGER.delete(k);
    if (!copy) { for (const k of [...LEDGER.keys()]) if (k.startsWith(`${agg}|${src}|`)) LEDGER.delete(k); return null; }
    const poisonId = Number(copy.poisonId) >>> 0;
    const p = poisonOf(poisonId);
    if (!p) return null;
    const key = `${agg}|${src}|${poisonId}`;
    const l = LEDGER.get(key) || { left: Math.max(1, Math.floor(Number(copy.poisonCount) || 1)), at: now };
    if (l.left <= 0) return null;
    l.left -= 1; l.at = now; LEDGER.set(key, l);
    later(() => {
      try {
        const q = pctOf(tgt);
        if (!q || !(q.health > 0) || downed(tgt)) return;
        const next = { health: q.health, magicka: q.magicka, stamina: q.stamina };
        const floor = (av) => (av === 'health' ? Math.max(0, Number(POISON.minHealth) || 0) : 0);
        for (const h of p.hits) { const v = Number(next[h.av]) || 0; next[h.av] = Math.max(Math.min(v, floor(h.av)), v - h.share); }
        mp.set(tgt, 'percentages', next);
        for (const d of p.drains) startTicks(tgt, d.av, -d.perSecond * d.seconds, d.seconds, floor(d.av), 'poison');
        const r0 = lookup(poisonId);
        log(`alchemy: poison ${r0 ? r0.record.editorId : poisonId.toString(16)} from ${display(agg)} on ${display(tgt)}: ${p.hits.map((h) => `${h.av} -${Math.round(h.share * 1000) / 10}%`).concat(p.drains.map((d) => `${d.av} -${Math.round(d.perSecond * 1000) / 10}%/s for ${d.seconds} s`)).join(', ')}`);
      } catch (e) { log(`alchemy: poison on ${display(tgt)} failed: ${e.message}`); }
    });
    return { poison: poisonId, hits: p.hits, drains: p.drains };
  };
  if (RW.enabled !== false) {
    // gamemode.js re-installs its eat hook before this module on every reload; a second load without that unwraps first
    let inner = mp.onEatItem;
    if (inner && inner.__dboAlchemyEat) inner = inner.__inner;
    const hook = function (actorId, baseId, ...rest) {
      const a = Number(actorId) >>> 0, id = Number(baseId) >>> 0;
      let before = null;
      try { if (drinkOf(id)) before = pctOf(a); } catch (e) { before = null; }
      const out = typeof inner === 'function' ? inner.call(this, actorId, baseId, ...rest) : undefined;
      if (out !== false) { try { onDrink(a, id, before); } catch (e) { log(`alchemy: drink handling failed: ${e.message}`); } }
      return out;
    };
    hook.__dboAlchemyEat = true; hook.__inner = inner;
    mp.onEatItem = hook;
  }
  // The F7 catalog's display name (gamemode adminItemName), else the editor id spaced out
  const ingredientName = (id) => {
    try { const n = itemName && mp.getDescFromId ? itemName(mp.getDescFromId(id >>> 0)) : ''; if (n) return n; } catch (e) { /* not in the catalog */ }
    const r = lookup(id);
    return String((r && r.record.editorId) || id.toString(16)).replace(/^(?:BSK|CYR|DLC\d|BYOH|cc[A-Z]+SSE\d+_?)/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/\s*\d+$/, '').trim();
  };

  // ---- what the lab can make from the pack (groundedpasta, 2026-09-29: "show the potions you can actually craft") -----
  // Using a lab opens an unfocused panel beside its menu: every potion two of the ingredients carried would make, worked
  // out exactly as brew() does, and a pair that makes each. It follows each brew and closes when the player leaves the lab.
  const PANEL_ID = 71;
  const PANEL_LINES = 14;
  const S = globalThis.__dboAlchemyPanel || (globalThis.__dboAlchemyPanel = { panels: new Map() });
  const brewable = (a) => {
    const held = [...new Set(invOf(a).filter((e) => (Number(e.count) || 0) > 0).map((e) => Number(e.baseId) >>> 0))].filter((id) => id < 0xff000000 && (effectsOf(id) || []).length);
    const tier = alchemistTier(a);
    const found = new Map();   // potion edid -> { name, does, value, pair }
    const locked = new Map();  // label -> tier it opens at, for a pair whose strongest effect waits on a rank
    for (let i = 0; i < held.length; i++) {
      for (let j = i + 1; j < held.length; j++) {
        const shared = sharedEffects([held[i], held[j]]);
        if (!shared.length) continue;
        const { potion, passed } = choose(shared, tier);
        for (const p of passed) if (p.locked && !locked.has(p.label)) locked.set(p.label, p.locked);
        if (!potion) continue;
        if (!found.has(potion.edid)) found.set(potion.edid, { name: potion.name, does: doesText(potion.id, true), value: baseCost(potion.effect), pair: [held[i], held[j]] });
      }
    }
    const list = [...found.values()].sort((x, y) => y.value - x.value || x.name.localeCompare(y.name));
    list.locked = [...locked].sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0]));
    return list;
  };
  const showBrewable = (a) => {
    const list = brewable(a);
    const tier = Math.max(1, alchemistTier(a));
    const lines = list.length
      ? list.slice(0, PANEL_LINES).map((p) => `${p.name}${p.does ? ` (${p.does})` : ''}: ${p.pair.map(ingredientName).join(' + ')}`).concat(list.length > PANEL_LINES ? [`and ${list.length - PANEL_LINES} more`] : [])
      : ['Nothing yet: no two of your ingredients share an effect you can brew.'];
    if (list.locked.length) lines.push(`Later: ${list.locked.slice(0, 3).map(([label, t]) => `${label} at ${tierName(t)} (${tierLevel(t)})`).join(', ')}${list.locked.length > 3 ? ` and ${list.locked.length - 3} more` : ''}`);
    if (BREW.length) lines.push('Crouch and use the lab to brew drinks.');
    const head = `${tierName(tier)}: ${RW.words.potion[tier - 1]} strength`;
    openWidget(a, { type: 'contextMenu', id: PANEL_ID, mode: 'inspect', targetName: list.length ? `You can brew (${list.length}), ${head}` : `You can brew, ${head}`, lines }, false);
  };
  // ---- drinks (Nate, 8 Oct: "add or create alcohol recipes for alchemy, includes skooma etc") ------------------------
  // Crouching at a lab opens the Brewing panel instead of the lab's menu: every recipe of brewing.json at or under the
  // brewer's Alchemist tier, one brewed per click, the inputs taken here (none of these is a two-ingredient mix the lab's
  // own menu could make). The sneak state is the server's copy of the IsSneaking animation variable, as pickpocket.js reads.
  const BREW_PANEL = 72;
  const BREW = (() => {
    const file = readJson('brewing.json', { recipes: [] });
    const names = file.ingredients || {};
    const id = (d) => { try { return mp.getIdFromDesc(String(d)) >>> 0; } catch (e) { return 0; } };
    const list = [];
    for (const r of file.recipes || []) {
      const product = id(r.product);
      const inputs = (r.inputs || []).map(([d, n]) => ({ id: id(d), n: Math.max(1, Math.floor(Number(n) || 1)), name: names[d] || String(d) }));
      if (!product || !inputs.length || inputs.some((x) => !x.id)) { log(`alchemy: drink ${r.name || r.product} left out (an item the server cannot resolve)`); continue; }
      list.push({ product, name: String(r.name || r.product), tier: Math.max(1, Math.min(5, Math.floor(Number(r.tier) || 1))), inputs, contraband: r.contraband === true });
    }
    return list;
  })();
  const sneaking = (a) => { try { return !!mp.callPapyrusFunction('method', 'ObjectReference', 'GetAnimationVariableBool', { type: 'form', desc: mp.getDescFromId(a >>> 0) }, ['IsSneaking']); } catch (e) { return false; } };
  const canBrew = (entries, r) => r.inputs.every((x) => countOf(entries, x.id) >= x.n);
  const brewLab = globalThis.__dboBrewLab instanceof Map ? globalThis.__dboBrewLab : (globalThis.__dboBrewLab = new Map());
  const openBrewing = (a, lab) => {
    const tier = alchemistTier(a);
    if (!tier) { personal(a, 'Brewing drinks is the Alchemist\'s trade. Take it up first.'); return; }
    brewLab.set(a >>> 0, lab >>> 0);
    const entries = invOf(a);
    const mine = BREW.filter((r) => r.tier <= tier);
    const actions = mine.map((r, i) => ({ id: `brew:${i}`, label: `${r.name}: ${r.inputs.map((x) => `${x.name} x${x.n}`).join(', ')}${canBrew(entries, r) ? '' : ' (missing)'}` }));
    const locked = BREW.length - mine.length;
    openWidget(a, { type: 'contextMenu', id: BREW_PANEL, mode: 'menu', targetName: `Brewing (Alchemist tier ${tier}${locked ? `; ${locked} more at higher tiers` : ''})`,
      actions, events: { action: 'dbo:brewChoose', close: 'dbo:brewClose' } }, true);
  };
  const brewDrink = (a, choice) => {
    const lab = brewLab.get(a >>> 0);
    if (!lab || !atLab(a, lab)) { brewLab.delete(a >>> 0); return closeWidget(a, BREW_PANEL); }
    const tier = alchemistTier(a);
    const mine = BREW.filter((r) => r.tier <= tier);
    const r = mine[Number(String(choice).split(':')[1])];
    if (!r) return;
    const entries = invOf(a);
    if (!canBrew(entries, r)) { personal(a, `${r.name} needs ${r.inputs.map((x) => `${x.name} x${x.n}`).join(', ')}.`); return openBrewing(a, lab); }
    for (const x of r.inputs) take(entries, x.id, x.n);
    give(entries, r.product, 1);
    try { mp.set(a, 'inventory', { entries: entries.filter((e) => Number(e.count) > 0) }); } catch (e) { log(`alchemy: inventory write failed for ${display(a)}: ${e.message}`); return; }
    personal(a, `You brew ${r.name}.`);
    creditBrew(a, r.product, tier, ingredientValue(r.inputs.map((x) => [x.id, x.n])));
    log(`alchemy: ${display(a)} brewed ${r.name} (tier ${tier})`);
    audit(`ALCHEMY ${who(a)} brewed ${r.name}${r.contraband ? ' (contraband)' : ''}`);
    // the player log (playerlog.js): the potion and what went into it, by base id
    try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('brew', a, r.product, tier, r.inputs.map((x) => ({ baseId: x.id, count: x.n }))); } catch (e) { /* the player log is optional */ }
    openBrewing(a, lab);
  };
  if (onUi) {
    onUi('brewChoose', (a, args) => { try { brewDrink(a >>> 0, args && args[0]); } catch (e) { log(`alchemy: brewing failed: ${e.message}`); } });
    onUi('brewClose', (a) => { brewLab.delete(a >>> 0); closeWidget(a, BREW_PANEL); });
  }
  globalThis.__dboBrewDrinks = BREW;

  // true when the lab opened the Brewing panel instead of its own menu (gamemode.js then refuses the activation)
  globalThis.__dboAlchemyLab = (targetId, casterId) => {
    if (!openWidget || !isLab(targetId)) return false;
    if (BREW.length && onUi && sneaking(casterId >>> 0)) { openBrewing(casterId >>> 0, targetId >>> 0); return true; }
    S.panels.set(casterId >>> 0, targetId >>> 0);
    try { showBrewable(casterId >>> 0); } catch (e) { log(`alchemy: brew list failed: ${e.message}`); }
    return false;   // the lab's own menu still opens
  };
  if (every) every('alchemyPanel', 2000, () => {
    for (const [a, lab] of [...S.panels]) {
      if (atLab(a, lab)) continue;
      S.panels.delete(a);
      try { closeWidget(a, PANEL_ID); } catch (e) { /* gone */ }
    }
  });

  const said = new Map();
  const tell = (a, text) => { if (Date.now() - (said.get(a) || 0) > 1500) { said.set(a, Date.now()); personal(a, text); } };

  const brew = (a, workbenchId, inputs) => {
    if (!isLab(workbenchId)) return;
    if (!atLab(a, workbenchId)) return log(`alchemy: ${display(a)} reported a mix at lab ${workbenchId.toString(16)} while not at it; ignored`);
    const reported = inputs && Array.isArray(inputs.entries) ? inputs.entries : [];
    // Distinct ingredients the client says went in; vanilla mixes two or three, one of each
    const all = [...new Set(reported.map((e) => Number(e.baseId) >>> 0))];
    // A dynamic id is a created object, never an ingredient record, and the craft report carries the result
    // itself among its inputs (Falcius, 2026-09-28: pond fish + wormwood + ff000b2f, a perfectly good pair
    // refused because of a third thing that was never an ingredient). Drop those before judging the mix.
    const made = all.filter((id) => id >= 0xff000000);
    const used = all.filter((id) => id < 0xff000000);
    // Anything else is not a mix (such as the inventory re-applied while seated at the lab), so nothing is made
    if (used.length > 3 || used.some((id) => !effectsOf(id))) {
      const counts = reported.map((e) => `${(Number(e.baseId) >>> 0).toString(16)}x${Number(e.count) || 1}`).join(' ');
      log(`alchemy: ${display(a)} report detail: ${counts}${made.length ? `, ${made.length} created object(s) dropped` : ''}`);
      const why = used.length > 3 ? `${used.length} distinct items` : 'an item with no alchemy effect';
      log(`alchemy: ${display(a)} reported ${used.map((id) => { const r = lookup(id); return r ? r.record.editorId : id.toString(16); }).join(' + ')}, not a lab mix (${why}); ignored`);
      // Only ingredients, too many of them: a real mix the client misreported, so the player is told
      if (used.length > 3 && used.every((id) => id < 0xff000000 && effectsOf(id))) tell(a, 'The lab did not recognise that mix, so nothing was brewed. Your ingredients come back when you leave the lab. Try again.');
      return;
    }
    // One ingredient named twice: the player's own lab brewed from two, but the report lost the second (24 times 23-30 Sep,
    // e.g. BSKCairnBolete x1 + BSKCairnBolete x1; Skyrim cannot put one ingredient in a potion twice). The server cannot
    // know the other ingredient, and one ingredient never makes a potion here, so nothing is brewed and nothing is taken;
    // the player is told what happened instead of "needs two ingredients", and the line below gathers the evidence
    // (the report, and how the player's own stack of that ingredient is held) for the client fix.
    const ids = reported.filter((e) => (Number(e.baseId) >>> 0) < 0xff000000).map((e) => Number(e.baseId) >>> 0);
    if (used.length === 1 && ids.length >= 2) {
      const held = invOf(a).filter((e) => (Number(e.baseId) >>> 0) === used[0]);
      const r = lookup(used[0]);
      log(`alchemy: ${display(a)} report named ${r ? r.record.editorId : used[0].toString(16)} ${ids.length} times and nothing else at lab ${workbenchId.toString(16)}; `
        + `held as ${held.length} stack(s) [${held.map((e) => Object.entries(e).filter(([k]) => k !== 'baseId').map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')).join(' | ')}]; `
        + `report ${reported.map((e) => `${(Number(e.baseId) >>> 0).toString(16)}x${Number(e.count) || 1}`).join(' ')}`);
      return tell(a, 'The lab lost track of your second ingredient, so nothing was brewed and nothing was used up. Try the mix again.');
    }
    if (used.length < 2) return tell(a, 'A potion needs at least two ingredients.');
    const entries = invOf(a);
    const missing = used.find((id) => countOf(entries, id) < 1);
    if (missing) { log(`alchemy: ${display(a)} reported ${missing.toString(16)} it does not hold`); return tell(a, 'You do not have those ingredients.'); }
    // The Draught of Revival replaces the ordinary potion for its exact recipe (downed.js decides)
    const draught = typeof globalThis.__dboLabDraught === 'function' ? globalThis.__dboLabDraught(a, used) : null;
    if (draught && draught.potion) {
      for (const id of used) take(entries, id, 1);
      give(entries, draught.potion, 1);
      try { mp.set(a, 'inventory', { entries: entries.filter((e) => Number(e.count) > 0) }); } catch (e) { log(`alchemy: inventory write failed for ${display(a)}: ${e.message}`); return; }
      draught.brewed();
      creditBrew(a, draught.potion, alchemistTier(a), ingredientValue(used.map((id) => [id, 1])));
      log(`alchemy: ${display(a)} brewed the ${draught.name} (tier ${alchemistTier(a)}) from ${used.map((id) => { const r = lookup(id); return r ? r.record.editorId : id.toString(16); }).join(' + ')}`);
      return;
    }
    const hint = draught && draught.hint ? ` ${draught.hint}` : '';
    const shared = sharedEffects(used);
    if (!shared.length) {
      const tally = new Map();
      for (const id of used) for (const e of new Set(effectsOf(id))) tally.set(e, (tally.get(e) || 0) + 1);
      const seen = [...tally].map(([e, n]) => { const r = lookup(e); return `${r ? r.record.editorId : e.toString(16)} x${n}${POTIONS.has(e) ? '' : ' (no potion)'}`; });
      log(`alchemy: ${display(a)} mixed ${used.map((id) => { const r = lookup(id); return r ? r.record.editorId : id.toString(16); }).join(' + ')} and nothing matched; effects ${seen.join(', ')}`);
      return tell(a, 'These ingredients share no effect that makes a potion you know. You keep them.');
    }
    const tier = alchemistTier(a);   // 0 without the trade, 1..5 by rank
    const { potion, passed } = choose(shared, tier);
    if (shared.length > 1) log(`alchemy: ${display(a)} shared ${shared.map((e) => { const r = lookup(e); return `${r ? r.record.editorId : e.toString(16)}@${Math.round(baseCost(e))}`; }).join(', ')}; took ${potion ? potion.edid : 'none (locked)'}`);
    if (!potion) {
      log(`alchemy: ${display(a)} mixed ${used.map((id) => { const r = lookup(id); return r ? r.record.editorId : id.toString(16); }).join(' + ')} at tier ${tier}: every shared effect opens later`);
      return tell(a, `You cannot brew that${passed.length && passed.every((p) => p.dropped) ? '' : ' yet'}.${lockedHint(passed)} You keep your ingredients.`);
    }
    for (const id of used) take(entries, id, 1);
    give(entries, potion.id, 1);
    try { mp.set(a, 'inventory', { entries: entries.filter((e) => Number(e.count) > 0) }); } catch (e) { log(`alchemy: inventory write failed for ${display(a)}: ${e.message}`); return; }
    const does = doesText(potion.id);
    tell(a, `You brew ${/^[AEIOU]/.test(potion.name) ? 'an' : 'a'} ${potion.name}${does ? ` (${does})` : ''}.${lockedHint(passed)}${hint}`);
    creditBrew(a, potion.id, tier, ingredientValue(used.map((id) => [id, 1])));
    log(`alchemy: ${display(a)} brewed ${potion.edid} (${potion.name}, tier ${tier}) from ${used.map((id) => { const r = lookup(id); return r ? r.record.editorId : id.toString(16); }).join(' + ')}`);
    audit(`ALCHEMY ${who(a)} brewed ${potion.edid}`);
    try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('brew', a, potion.id, tier, used.map((id) => ({ baseId: id, count: 1 }))); } catch (e) { /* the player log is optional */ }
    if (S.panels.has(a)) showBrewable(a);
  };

  // ---- disenchanting at an arcane enchanter (/bug 2026-10-01 "disassembleenchantedweapon") ------------------------
  // Vanilla destroys the item it teaches the enchantment of. The game does that on the client and tells the server
  // nothing, so the server kept every disenchanted weapon and the next inventory sync handed it back: the enchantment
  // learned, the weapon kept, free to trade on and disenchant again. What the client does send is its craft report from
  // the enchanter: every item that left the pack while seated there, closed by the next one to arrive (usually the
  // disenchanted item handed back by that sync). No recipe matches it, so it ends here, and one copy is taken for each
  // enchantment it taught, as vanilla takes it. The report names only base items, so the copy is the one the enchanter
  // could have offered: the base's own enchantment (EITM) or one a plugin enchantment in its extra data gives it
  // (gearswap.js). A copy the player enchanted is never one (vanilla never disenchants it), except as the last resort on
  // a base enchanted by its record, where vanilla never makes one.
  const BENCH_ENCHANTING = new Set([3, 4]); // FURN WBDT bench type: Enchanting, EnchantingExperiment
  const isEnchanter = (workbenchId) => {
    let base = 0; try { base = mp.getIdFromDesc(String(mp.get(workbenchId >>> 0, 'baseDesc'))) >>> 0; } catch (e) { return false; }
    const lr = lookup(base);
    if (!lr || String(lr.record.type) !== 'FURN') return false;
    const wbdt = (lr.record.fields || []).find((f) => f.type === 'WBDT');
    return !!wbdt && wbdt.data instanceof Uint8Array && wbdt.data.byteLength > 0 && BENCH_ENCHANTING.has(wbdt.data[0]);
  };
  const DISALLOW_ENCHANTING = 0x000c27bd; // MagicDisallowEnchanting (Skyrim.esm): such an item is never disenchanted
  const isPluginId = (id) => id > 0 && id < 0xff000000;
  // What the enchanter knows of a base item: whether it is a weapon or armour, whether the game refuses to disenchant
  // it (MagicDisallowEnchanting), and its own enchantment (EITM) as a load-order id, 0 if it has none
  const itemOf = (id) => {
    const lr = isPluginId(id) ? lookup(id) : null;
    if (!lr || !/^(WEAP|ARMO)$/.test(String(lr.record.type))) return null;
    const fields = lr.record.fields || [];
    const kwda = fields.find((f) => f.type === 'KWDA');
    const n = kwda && kwda.data instanceof Uint8Array ? Math.floor(kwda.data.byteLength / 4) : 0;
    let disallowed = false;
    for (let i = 0; i < n && !disallowed; i++) { try { disallowed = (lr.toGlobalRecordId(u32(kwda, i * 4)) >>> 0) === DISALLOW_ENCHANTING; } catch (e) { /* unmapped */ } }
    const eitm = fields.find((f) => f.type === 'EITM');
    let ench = 0;
    // An EITM that maps to no load-order id still enchants the item: it is keyed by the base instead
    if (eitm) { try { ench = lr.toGlobalRecordId(u32(eitm, 0)) >>> 0; } catch (e) { ench = 0; } if (!ench) ench = `eitm:${id.toString(16)}`; }
    return { disallowed, ench };
  };
  const playerMade = (e) => (Number(e.enchantmentId) >>> 0) >= 0xff000000 || (Array.isArray(e.enchantmentEffects) && e.enchantmentEffects.length > 0);
  // The enchantment the enchanter would teach from this copy: a plugin enchantment in its extra data, else the record's
  // (0: none, a plain or player-enchanted copy of a base with no enchantment of its own)
  const copyEnch = (e, item) => {
    const x = Number(e.enchantmentId) >>> 0;
    if (isPluginId(x)) return x;
    return item.ench;
  };
  const isSoulGem = (id) => { const lr = lookup(id); return !!lr && String(lr.record.type) === 'SLGM'; };
  // Azura's Star and the Black Star (keyword ReusableSoulGem, ed2f1:Skyrim.esm) enchant without being used up, so whether
  // one shows in the report is not known; holding one means a plain item may have been enchanted with no gem reported
  const REUSABLE_SOUL_GEM = 0x000ed2f1;
  const isReusableGem = (id) => {
    const lr = lookup(id);
    if (!lr || String(lr.record.type) !== 'SLGM') return false;
    const kwda = (lr.record.fields || []).find((f) => f.type === 'KWDA');
    const n = kwda && kwda.data instanceof Uint8Array ? Math.floor(kwda.data.byteLength / 4) : 0;
    for (let i = 0; i < n; i++) { try { if ((lr.toGlobalRecordId(u32(kwda, i * 4)) >>> 0) === REUSABLE_SOUL_GEM) return true; } catch (e) { /* unmapped */ } }
    return false;
  };
  // An enchantment taught once is known for the rest of the session, and vanilla never offers a known one again; a
  // report naming it again is the server's own removal of the item seen by the client's report (or a stale one), never a
  // second disenchant. Cleared at each login (the client forgets what it learned unless learnedEnchantments restores it).
  const SESSION = globalThis.__dboDisenchantSession || (globalThis.__dboDisenchantSession = new Map()); // actor -> { at, ench:Set, effects:Set, resendDue }
  const SESSION_MS = 12 * 60 * 60 * 1000;
  const sessionOf = (a) => {
    let s = SESSION.get(a);
    if (!s || Date.now() - s.at > SESSION_MS) { s = { at: Date.now(), ench: new Set(), effects: new Set() }; SESSION.set(a, s); }
    return s;
  };
  const knownThisSession = (a, ench) => {
    const s = SESSION.get(a);
    if (!s || Date.now() - s.at > SESSION_MS) return false;
    if (s.ench.has(ench)) return true;
    const effects = effectsOfEnch(ench);
    return effects.length > 0 && effects.every((x) => s.effects.has(x));
  };
  // Which copy goes: an unworn one before a worn one (vanilla disenchants worn items too, and the client's report can come
  // before its equipment report), a copy enchanted by extra data before the record's own, then the plainest: tempered or
  // poisoned, then player-named ones are the last taken. A copy also carrying a player-made enchantment goes last of all.
  const extrasScore = (e) => (e.name ? 2 : 0) + ((Number(e.health) || 1) > 1 || e.poisonId ? 1 : 0);
  const order = (x, y) => ((x.worn || x.wornLeft ? 1 : 0) - (y.worn || y.wornLeft ? 1 : 0))
    || ((playerMade(x) ? 1 : 0) - (playerMade(y) ? 1 : 0))
    || ((isPluginId(Number(y.enchantmentId) >>> 0) ? 1 : 0) - (isPluginId(Number(x.enchantmentId) >>> 0) ? 1 : 0))
    || extrasScore(x) - extrasScore(y);
  const copyNote = (e) => [e.worn || e.wornLeft ? 'worn' : '', (Number(e.health) || 1) > 1 ? 'tempered' : '', e.name ? `named "${String(e.name).slice(0, 40)}"` : '', e.poisonId ? 'poisoned' : ''].filter(Boolean).join(', ');
  const enchName = (ench) => { const r = typeof ench === 'number' && ench ? lookup(ench) : null; return r && r.record.editorId ? r.record.editorId : typeof ench === 'number' ? (ench >>> 0).toString(16) : String(ench); };

  const disenchant = (a, workbenchId, inputs) => {
    const reported = (inputs && Array.isArray(inputs.entries) ? inputs.entries : []).filter((e) => e && isPluginId(Number(e.baseId) >>> 0) && (Number(e.count) || 0) > 0);
    const entries = invOf(a);
    // How many of each base left the pack, and the soul gems among them (each enchant uses one)
    const left = new Map();
    let gems = 0;
    for (const e of reported) {
      const id = Number(e.baseId) >>> 0, n = Math.min(MAX_REPORT_COUNT, Number(e.count) || 0);
      if (isSoulGem(id)) { gems += n; continue; }
      left.set(id, (left.get(id) || 0) + n);
    }
    // Per base: the copies the enchanter could disenchant (an enchantment not yet taught this session), and whether a
    // copy could have been the one enchanted (a weapon or armour piece with no enchantment of its own)
    const bases = [];
    for (const [id, n] of left) {
      const item = itemOf(id);
      if (!item || item.disallowed) continue;
      const copies = entries.filter((e) => (Number(e.baseId) >>> 0) === id && (Number(e.count) || 0) > 0);
      const candidates = copies.filter((e) => copyEnch(e, item) && (item.ench || !playerMade(e)));
      const enchantable = !item.ench && copies.some((e) => !isPluginId(Number(e.enchantmentId) >>> 0));
      bases.push({ id, n, item, candidates, enchantable });
    }
    // A soul gem belongs to the enchant of a plain item, so it goes first to a base that holds nothing to disenchant, then
    // to one that could be either: a disenchant cannot hide behind a gem spent on something else in the same report
    for (const b of bases) if (b.enchantable && !b.candidates.length) { const k = Math.min(gems, b.n); gems -= k; b.n -= k; }
    for (const b of bases) if (b.enchantable && b.candidates.length) { const k = Math.min(gems, b.n); gems -= k; b.n -= k; }
    const due = bases.filter((b) => b.n > 0 && b.candidates.length);
    if (!due.length) return;   // enchanting (a plain item and a soul gem): craftedExtras records that
    if (!atLab(a, workbenchId)) return log(`disenchant: ${display(a)} reported a disenchant at ${workbenchId.toString(16)} while not at it; ignored`);
    const taken = [];   // [baseId, entry copy, ench]
    let ambiguous = false;
    const session = sessionOf(a);
    const reusableHeld = entries.some((e) => (Number(e.count) || 0) > 0 && isReusableGem(Number(e.baseId) >>> 0));
    const reusableReported = reported.some((e) => isReusableGem(Number(e.baseId) >>> 0));
    for (const b of due) {
      // The enchantments this base's copies could still teach, each with the copy that goes for it (unworn and plainest
      // first). One already taught this session narrows the choice: vanilla no longer offers it
      const byEnch = new Map();
      const known = new Set();
      for (const e of b.candidates.slice().sort(order)) {
        const ench = copyEnch(e, b.item);
        if (byEnch.has(ench) || known.has(ench)) continue;
        if (knownThisSession(a, ench)) known.add(ench); else byEnch.set(ench, e);
      }
      if (known.size) log(`disenchant: ${display(a)} reported ${ingredientName(b.id)}: ${[...known].map(enchName).join(', ')} already taught this session; not taken again`);
      if (!byEnch.size) { log(`disenchant: ${display(a)} reported ${ingredientName(b.id)}, nothing taken (no copy with an enchantment it could still teach)`); continue; }
      // The report names the base only: with more enchantments to choose from than copies that left, the server cannot
      // tell which went (gearswap.js makes many steel copies of one base, each carrying its own enchantment). Taking the
      // wrong one would destroy a kept item and record the wrong enchantment as learned, so none is taken and staff settle it
      const why = byEnch.size > b.n ? `${b.n} left the pack, ${byEnch.size} enchantments to choose from`
        : b.enchantable && reusableHeld && !reusableReported ? 'a reusable soul gem held could have enchanted a plain copy' : '';
      // Every candidate teaching the same effects and no plain copy held (an enchant's gem often comes in its own report): the plainest goes
      const same = !!why && byEnch.size > b.n && !b.enchantable && sameEffects([...byEnch.keys()]);
      if (why && !same) {
        const copies = b.candidates.map((e) => { const note = copyNote(e); return `${enchName(copyEnch(e, b.item))}${note ? `; ${note}` : ''}${(Number(e.count) || 0) > 1 ? ` x${Number(e.count)}` : ''}`; }).join(' | ');
        log(`disenchant: ${display(a)} reported ${ingredientName(b.id)} at ${workbenchId.toString(16)}: ${why}; nothing taken`);
        audit(`DISENCHANT-AMBIGUOUS ${who(a)} ${ingredientName(b.id)} (${(b.id >>> 0).toString(16)}): ${why}; nothing taken, nothing learned [${copies}]`);
        ambiguous = true;
        continue;
      }
      const go = same ? [[...byEnch].sort(([, x], [, y]) => order(x, y))[0]] : [...byEnch];
      if (same) log(`disenchant: ${display(a)} reported ${ingredientName(b.id)} at ${workbenchId.toString(16)}: ${why}, all teaching the same effects; the plainest copy (${enchName(go[0][0])}) goes`);
      for (const [ench, e] of go) {
        if ((Number(e.count) || 0) <= 0) continue;
        taken.push([b.id, Object.assign({}, e, { count: 1 }), ench]);
        e.count = (Number(e.count) || 0) - 1;
        session.ench.add(ench);
        for (const x of effectsOfEnch(ench)) session.effects.add(x);
      }
    }
    // The client's own disenchant went through all the same, and with it the game forgets the list restored at login
    if (!taken.length) { if (ambiguous) resendLearned(a, session); return; }
    try { mp.set(a, 'inventory', { entries: entries.filter((e) => Number(e.count) > 0) }); } catch (e) { log(`disenchant: inventory write failed for ${display(a)}: ${e.message}`); return; }
    const what = taken.map(([id]) => ingredientName(id)).join(', ');
    const detail = taken.map(([id, e, ench]) => { const note = copyNote(e); return `${ingredientName(id)} [${enchName(ench)}${note ? `; ${note}` : ''}]`; }).join(', ');
    log(`disenchant: ${display(a)} disenchanted ${detail} at ${workbenchId.toString(16)}; taken`);
    rememberLearned(a, taken.map(([, , ench]) => ench));
    // The game forgets the enchantments restored at login when a disenchant goes through (SMJ, 7 Oct: only the new one
    // was left; players had taken to /syncenchant after each one), so the whole list goes back once the inventory write
    // above has reached the client
    resendLearned(a, session);
    // Disenchanting is Enchanter work, as in the base game: 1 for each enchantment learned, the same one again within
    // the hour less (masterySystem's repeat ring, keyed on the enchantment)
    for (const [, , ench] of taken) creditDisenchant(a, ench);
    audit(`DISENCHANT ${who(a)} used up ${detail}`);
    // the player log: each item disenchanted, by base id (the audit's names may be custom ones)
    for (const [id] of taken) { try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('extras', a, 'disenchant', id); } catch (e) { /* the player log is optional */ } }
    tell(a, `Disenchanting uses up the item: ${what} ${taken.length > 1 ? 'are' : 'is'} gone.`);
  };
  const MAX_REPORT_COUNT = 16;

  // ---- enchantments learned by disenchanting, kept across relogs (#bugs thread 7) ----------------------------------
  // The game keeps what a character has learned at the table in its own save, which a SkyMP client never loads, so every
  // learned enchantment was gone at the next login. Each disenchant writes the enchantment's effects (the copy's
  // enchantment: its extra data's, else the item's EITM; its EFIDs, as load-order ids) on the character, newest last and
  // at most max; at login they go back to the client (dboEnchLearned), which marks each effect known again. Recorded
  // always; sent only with learnedEnchantments.enabled, since a client before the one that reads the packet would ignore it.
  const LEARN = Object.assign({ enabled: false, max: 256 }, (api.cfg || {}).learnedEnchantments || {});
  const LEARNED_PROP = 'private.dboEnchLearned';
  function effectsOfEnch(ench) {
    const er = typeof ench === 'number' && ench ? lookup(ench) : null;
    if (!er || String(er.record.type) !== 'ENCH') return [];
    const out = [];
    for (const f of er.record.fields || []) if (f.type === 'EFID') { try { const g = er.toGlobalRecordId(u32(f, 0)) >>> 0; if (g && !out.includes(g)) out.push(g); } catch (e) { /* unmapped */ } }
    return out;
  }
  const RESEND_MS = 2000;
  // One pending resend per actor: its due time sits on the session entry (globalThis), so a hot reload never adds a second
  const resendLearned = (a, s) => {
    const pending = s.resendDue > 0 && Date.now() < s.resendDue + RESEND_MS;
    s.resendDue = Date.now() + RESEND_MS;
    if (pending) return;
    // A disenchant while it waits moves the due time on; the same timer then waits out the rest
    const fire = (due) => () => {
      if (s.resendDue > due) { setTimeout(fire(s.resendDue), Math.max(0, s.resendDue - Date.now())); return; }
      s.resendDue = 0;
      try { sendLearned(a); } catch (e) { log(`disenchant: resend failed for ${display(a)}: ${e.message}`); }
    };
    setTimeout(fire(s.resendDue), RESEND_MS);
  };
  // Whether these enchantments all teach one same set of effects (none unreadable)
  const sameEffects = (enchs) => { const sets = enchs.map((x) => effectsOfEnch(x)); return sets.every((l) => l.length > 0 && l.length === sets[0].length && l.every((x) => sets[0].includes(x))); };
  const creditDisenchant = (a, ench) => {
    const award = globalThis.__alduinakMasteryAward;
    if (typeof award !== 'function' || typeof ench !== 'number' || !ench) return 0;
    try { return Number(award(a, 'enchanter', 1, ench >>> 0)) || 0; } catch (e) { log(`disenchant: mastery award failed for ${display(a)}: ${e.message}`); return 0; }
  };
  const learnedOf = (a) => { try { const v = mp.get(a, LEARNED_PROP); return Array.isArray(v) ? v.map((x) => Number(x) >>> 0).filter(Boolean) : []; } catch (e) { return []; } };
  const rememberLearned = (a, enchIds) => {
    const list = learnedOf(a);
    let seen = 0;
    for (const ench of enchIds) for (const effect of effectsOfEnch(ench)) {
      const at = list.indexOf(effect);
      if (at >= 0) list.splice(at, 1);
      list.push(effect);
      seen++;
    }
    if (!seen) return;
    const max = Math.max(1, Number(LEARN.max) || 256);
    while (list.length > max) list.shift();
    try { mp.set(a, LEARNED_PROP, list); } catch (e) { log(`disenchant: learned enchantments write failed for ${display(a)}: ${e.message}`); }
  };
  // One-off (Nate, 5 Oct): enchantments learned before the server recorded them, proven by its own disenchant log lines,
  // are added once at the character's next login (ench-restore-1005.json, beside this file; the marker makes it once)
  const RESTORE = readJson('ench-restore-1005.json', { actors: {} });
  const RESTORE_PROP = 'private.dboEnchRestore';
  const restoreOnce = (a) => {
    const entry = RESTORE && RESTORE.actors ? RESTORE.actors[(a >>> 0).toString(16)] : null;
    if (!entry || !Array.isArray(entry.effects)) return;
    const marker = String(RESTORE.marker || '');
    let done = null; try { done = mp.get(a, RESTORE_PROP); } catch (e) { done = null; }
    if (!marker || done === marker) return;
    let profile = -1; try { profile = Number(mp.get(a, 'profileId')); } catch (e) { return; }
    if (profile !== Number(entry.profileId)) return log(`disenchant: restore for ${display(a)} skipped: profile ${profile}, the list names ${entry.profileId}`);
    const list = learnedOf(a);
    const added = entry.effects.map((x) => Number(x) >>> 0).filter((x) => x && !list.includes(x));
    const max = Math.max(1, Number(LEARN.max) || 256);
    const next = list.concat(added).slice(-max);
    try { mp.set(a, LEARNED_PROP, next); mp.set(a, RESTORE_PROP, marker); } catch (e) { return log(`disenchant: restore for ${display(a)} failed: ${e.message}`); }
    audit(`ENCH-RESTORE ${who(a)} given back ${added.length} learned enchantment effect(s) [${added.map((x) => x.toString(16)).join(', ')}] (pre-recording disenchants, marker ${marker})`);
  };
  globalThis.__dboEnchLearnedLogin = (a) => {
    // A new session: the client learned nothing at the table yet (the restore below is not counted, so a client that
    // ignores it can still have its disenchants taken)
    SESSION.delete(a >>> 0);
    try { restoreOnce(a >>> 0); } catch (e) { log(`disenchant: restore failed: ${e.message}`); }
    return sendLearned(a >>> 0, true) > 0;
  };
  // Only magic effects go out: ENCH ids (marker 1005e mapped some wrongly) and other records are dropped, unknown ids kept
  const cleanLearned = (a) => {
    const list = learnedOf(a);
    const dropped = list.map((id) => [id, lookup(id)]).filter(([, r]) => r && String(r.record.type) !== 'MGEF');
    if (!dropped.length) return list;
    const out = list.filter((id) => !dropped.some(([x]) => x === id));
    try { mp.set(a, LEARNED_PROP, out); } catch (e) { log(`disenchant: learned list clean-up failed for ${display(a)}: ${e.message}`); return out; }
    audit(`ENCH-LEARNED-REPAIR ${who(a)} dropped ${dropped.length} id(s) that are no magic effect, nothing added [${dropped.map(([x, r]) => `${x.toString(16)} ${r.record.type} ${r.record.editorId || '?'}`).join(', ')}]`);
    return out;
  };
  // The game marks the base enchantment known, not its effects (Form.SetPlayerKnows on the Enchantment, CK wiki
  // PlayerKnows: the player knows the base version); ench-bases.json lists each base with its effects (tools/ench-base-table.py)
  const BASES = readJson('ench-bases.json', { bases: {} });
  const BASE_LIST = Object.entries((BASES && BASES.bases) || {}).map(([id, b]) => [parseInt(id, 16) >>> 0, (b.effects || []).map((x) => parseInt(x, 16) >>> 0)]).filter(([id, fx]) => id && fx.length);
  // Bases whose every effect the character holds
  const ALL_KNOWABLE = [...new Set(BASE_LIST.flatMap(([id, fx]) => [id, ...fx]))];
  const basesOf = (effects) => { const held = new Set(effects); return BASE_LIST.filter(([, fx]) => fx.every((x) => held.has(x))).map(([id]) => id); };
  // The learned effects and their base enchantments to the client again; how many were sent (0: none recorded or sending off, -1: it failed)
  // At login (atLogin) the list goes even when empty, with every other known enchantment id to forget: the game keeps
  // "known" on the form, so a character played second in one game session inherited the first one's (SMJ, 12 Oct)
  const sendLearned = (a, atLogin) => {
    const learned = cleanLearned(a);
    if (!LEARN.enabled || typeof api.sendPacket !== 'function') return 0;
    if (!learned.length && !atLogin) return 0;
    // The client marks every id it gets known (Form.setPlayerKnows), so the bases ride in the same list
    const effects = learned.concat(basesOf(learned).filter((id) => !learned.includes(id)));
    const packet = { customPacketType: 'dboEnchLearned', effects };
    if (atLogin) packet.forget = ALL_KNOWABLE.filter((id) => !effects.includes(id));
    try { api.sendPacket(a, packet); } catch (e) { log(`disenchant: learned enchantments send failed for ${display(a)}: ${e.message}`); return -1; }
    return effects.length;
  };
  // /syncenchant (gamemode.js) resends only. It must not run the login above: that clears this session's disenchants,
  // so a later report naming one again would take a second copy (6 Oct)
  globalThis.__dboEnchLearnedResend = (a) => {
    const n = sendLearned(a >>> 0);
    log(`disenchant: ${display(a)} asked for their learned enchantments: ${n < 0 ? 'the send failed' : `${n} effect(s) sent`}`);
    return n;
  };

  // Using an Arcane Enchanter resends the list on its own, at most once a minute, so nobody has to type /syncenchant: the
  // game forgets it with a disenchant the server never heard of, and the next use of the table shows it all again
  const touchedAt = globalThis.__dboEnchTouchedAt || (globalThis.__dboEnchTouchedAt = new Map()); // actorId -> ms
  globalThis.__dboEnchanterTouched = (target, caster) => {
    const a = caster >>> 0;
    if (Date.now() - (touchedAt.get(a) || 0) < 60000 || !isEnchanter(target >>> 0)) return;
    touchedAt.set(a, Date.now());
    const n = sendLearned(a);
    if (n > 0) log(`disenchant: ${display(a)} used an enchanter: ${n} learned effect(s) resent`);
  };

  // A soul captured in a gem (fork soulTrapSystem) is a little Enchanter work, a few times an hour at most (SMJ, 12 Oct: ten
  // gems for one level). size 1..5 petty to grand, 0 black. Config "soulTrapXp": { enabled, weightBySize, perHour }
  const TRAP_XP = Object.assign({ enabled: true, weightBySize: [0.8, 0.4, 0.5, 0.6, 0.7, 0.8], perHour: 10 }, (api.cfg || {}).soulTrapXp || {});
  const trapsAt = globalThis.__dboSoulTrapXpAt || (globalThis.__dboSoulTrapXpAt = new Map()); // actorId -> [ms]
  globalThis.__dboSoulCaptured = (caster, target, size) => {
    const a = caster >>> 0;
    if (!TRAP_XP.enabled || typeof globalThis.__alduinakMasteryAward !== 'function') return 0;
    const now = Date.now();
    const recent = (trapsAt.get(a) || []).filter((t) => now - t < 3600000);
    if (recent.length >= TRAP_XP.perHour) { trapsAt.set(a, recent); return 0; }
    const weight = Number(TRAP_XP.weightBySize[Number(size) || 0]) || 0;
    if (!(weight > 0)) return 0;
    let units = 0;
    try { units = Number(globalThis.__alduinakMasteryAward(a, 'enchanter', weight, target >>> 0)) || 0; } catch (e) { log(`soul trap award failed for ${display(a)}: ${e.message}`); return 0; }
    // Only a credited capture uses the hour's room, so one before Enchanter is taken up costs nothing
    if (units > 0) recent.push(now);
    trapsAt.set(a, recent);
    return units;
  };

  // CustomEvent prepends the actor: (actor, workbench, result, inputs)
  mp.onCraftUnmatched = (actorId, workbenchId, resultId, inputs) => {
    const a = Number(actorId) >>> 0, wb = Number(workbenchId) >>> 0;
    try { if (isEnchanter(wb)) { disenchant(a, wb, inputs); return true; } } catch (e) { log(`disenchant: failed: ${e.message}`); return true; }
    try { brew(a, wb, inputs); } catch (e) { log(`alchemy: brew failed: ${e.message}`); }
    return true;
  };

  log(`alchemy on: ${POTIONS.size} effects with vanilla potions, strength by Alchemist rank`);
};
