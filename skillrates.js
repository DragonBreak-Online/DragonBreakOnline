// DragonBreak Online: how much a skill's metered work is worth, per skill and per activity (QoL feedback via Nate,
// 2026-10-04: mining x2-3, iron smithing x2-3, skinning +50%). Loaded by gamemode.js; config "skillRates".
//
// masterySystem (fork skymp5-server) meters every act through the repeat ring, the hourly bucket and the day's caps
// exactly as before, then multiplies what it kept by globalThis.__dboSkillRate(actorId, skillId, kind, detail), clamped
// to 0..5, the way the playtesters' boost (private.xpBoost) is applied. A rate therefore moves a skill further for the
// same hour of work and never lets more work through the bucket. A server without that hook ignores this file.
//
// rates.<skill> is a number (every activity), or { default, <kind>: n, craftByTier: [t1..t5] }. Kinds are the
// masterySystem event kinds: craft, mine, chop, skin, kill, hit, hurt, cast, read, lock, prayer, eat, activate, award.
// Anything done in beast form is worth beastRate (0), a staff award excepted: the beast trains no skill.
// firstCraft (Discord, 10 Oct: "bonus xp for new items crafted up to a certain number, then diminished"; Nate: build it):
// the first time a character makes an item it has never made in that skill, the craft is worth `rate` times as much, in
// full for the first `fullFor` different items, then less and less (1 + (rate - 1) x fullFor / (n + 1) for the n-th
// different item, never below 1). It multiplies after the meter like every rate here, so it speeds a skill along and
// never lets more work through the bucket or the day's caps. Tempering makes nothing new and earns none. The items made are
// kept on the character (private.dboCraftedKinds: { <skill>: [desc...] }), so a relog resets nothing. With masterySystem's
// credit report (__dboSkillRateCredited) an item is marked only when its craft credited something, so a craft at a spent
// hourly bucket or day's cap keeps the bonus for next time.
// craftAwards: skills whose craft reaches masterySystem as an award, not a craft event: alchemy.js credits each brew through
// __alduinakMasteryAward (kind "award", detail.key = the potion), as the lab has no COBJ recipe. For them an award is the
// craft: the skill's "craft" rate and the first-craft bonus apply to it (the potion is the item made). Found live 11 Oct:
// "alchemist { craft: 2 }" (Nate's economy scan, x2) and the first-craft bonus never reached a brew, as both waited for a
// kind "craft" that alchemy never sends; 21 characters had first crafts marked by 19Z, none for the Alchemist.
// craftByTier rates a craft by the recipe's tier: the recipe's own DBO_Skill_<skill>_T<n> gate when it carries one,
// otherwise the highest materialTiers entry among its ingredients (editor ids; anything not listed is tier 1: iron,
// copper, bronze, leather, hide, wood). salvageLoop rates a craft of a product the same character broke down at a
// station (salvage.js) in the last windowMinutes.
'use strict';

module.exports = (api) => {
  const { log, cfg, recordOf, fieldsOf, inBeastForm, mp, personal } = api;
  // beastRate: work done in werewolf or Vampire Lord form trains no skill (Nate, 5 Oct): claws arrive as fists (0x1f4)
  const C = Object.assign({ enabled: true, rates: {}, materialTiers: {}, salvageLoop: {}, beastRate: 0 }, cfg.skillRates || {});
  const LOOP = Object.assign({ enabled: false, windowMinutes: 60, rate: 0 }, C.salvageLoop || {});
  const FIRST = Object.assign({ enabled: false, rate: 3, fullFor: 25, skills: ['cook', 'blacksmith', 'alchemist', 'tailor'], maxKept: 3000,
    noBenches: ['CraftingSmithingArmorTable', 'CraftingSmithingSharpeningWheel'] }, C.firstCraft || {});
  const CRAFT_AWARDS = Array.isArray(C.craftAwards) ? C.craftAwards.map(String) : ['alchemist'];
  // The kind a rate is looked up as: an award of a craftAwards skill is its craft
  const kindOf = (skillId, kind) => (kind === 'award' && CRAFT_AWARDS.includes(skillId) ? 'craft' : kind);
  const TIERS = {};
  for (const [k, v] of Object.entries(C.materialTiers || {})) if (!k.startsWith('_') && Number(v) >= 1) TIERS[k.toLowerCase()] = Math.min(5, Math.floor(Number(v)));

  // Survive a gamemode reload; a restart forgets them, which only forgives a loop in progress
  const S = globalThis.__dboSkillRates = globalThis.__dboSkillRates || { brokeDown: new Map(), told: new Map() };
  if (!(S.firstPending instanceof Map)) S.firstPending = new Map();   // actor|skill -> the first-time craft waiting for its credit
  const recipeCache = new Map();   // recipe id -> { product, tier, inputValue }
  // A craft is worth what went into it (Nate, 14 Oct: "200 salt for one Cook level"). The weight a craft carries meters it
  // through the hourly bucket, which a pot of salt soup fills as fast as a stew (12-49 crafts, under a minute), so the hour
  // was the same whatever was cooked and only the cheapest route made sense. This factor multiplies the rate after the
  // meter, like every rate here: g = value / full, between min and 1, where value is the sum of the inputs' gold values
  // (each at most itemCap; the product's value when that is more). A rich dish or brew earns what any craft earns today,
  // salt soup half of it (Nate, 14 Oct: cheap work still teaches at least half); the bucket and the day's caps are unchanged. Config skillRates.valueWeight.
  const VALUE = Object.assign({ enabled: true, itemCap: 100, skills: { cook: { full: 10, min: 0.5 }, alchemist: { full: 12, min: 0.5 } } }, C.valueWeight || {});

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  const u32 = (f, off) => (f && f.data && f.data.byteLength >= off + 4 ? new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(off, true) : 0);
  const globalOf = (lr, local) => { try { return local ? lr.toGlobalRecordId(local) >>> 0 : 0; } catch (e) { return 0; } };

  // What the recipe makes, its tier by its ingredients, and the weapons and armour it takes apart (CNTO: the item's
  // record-local id at 0, the count at 4)
  const recipeOf = (recipeId) => {
    const id = Number(recipeId) >>> 0;
    if (recipeCache.has(id)) return recipeCache.get(id);
    const lr = id ? recordOf(id) : null;
    // An unreadable recipe has no tier, so it keeps the skill's default rate
    let tier = lr ? 1 : 0;
    const consumes = [];
    let inputValue = 0;
    for (const f of fieldsOf(lr, 'CNTO')) {
      const item = globalOf(lr, u32(f, 0));
      const r = recordOf(item);
      inputValue += itemValueOf(r) * Math.max(1, u32(f, 4));
      const t = TIERS[String((r && r.record.editorId) || '').toLowerCase()];
      if (t > tier) tier = t;
      const type = String((r && r.record.type) || '');
      if (item && (type === 'WEAP' || type === 'ARMO')) consumes.push(item);
    }
    const benchId = globalOf(lr, u32(fieldsOf(lr, 'BNAM')[0], 0));
    const benchRec = benchId ? recordOf(benchId) : null;
    const out = { product: globalOf(lr, u32(fieldsOf(lr, 'CNAM')[0], 0)), tier, consumes, bench: String((benchRec && benchRec.record.editorId) || ''), inputValue };
    recipeCache.set(id, out);
    return out;
  };

  // An item's gold value, at most itemCap: ALCH ENIT at 0, INGR/MISC/WEAP/ARMO/AMMO/SLGM DATA at 0 (an int32)
  const itemValueOf = (r) => {
    if (!r || !r.record) return 0;
    const f = fieldsOf(r, String(r.record.type) === 'ALCH' ? 'ENIT' : 'DATA')[0];
    const v = f && f.data && f.data.byteLength >= 4 ? new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getInt32(0, true) : 0;
    return Math.max(0, Math.min(Number(VALUE.itemCap) || 100, v));
  };
  // The value factor of a craft (1 when the skill has none or the value is not known)
  const valueFactor = (actorId, skillId, kind, detail) => {
    const spec = VALUE.enabled !== false && VALUE.skills ? VALUE.skills[skillId] : null;
    if (!spec || !detail) return 1;
    let value = NaN;
    if (kind === 'craft' && detail.recipeId) value = Math.max(recipeOf(detail.recipeId).inputValue || 0, Math.min(Number(VALUE.itemCap) || 100, Number(detail.value) || 0));
    else if (kind === 'award' && detail.key) {
      // alchemy.js leaves the brew's ingredient value just before it asks for the award
      const b = globalThis.__dboBrewValue;
      if (b && (b.actor >>> 0) === (actorId >>> 0) && (b.key >>> 0) === (Number(detail.key) >>> 0)) value = Number(b.value);
    }
    // Nothing known of what went in (a recipe or ingredient the server cannot read): the craft keeps its rate
    if (!Number.isFinite(value) || !(value > 0)) return 1;
    const full = Math.max(1, Number(spec.full) || 10), min = Math.max(0, Math.min(1, Number(spec.min) || 0));
    return Math.max(min, Math.min(1, value / full));
  };

  const loopKey = (actorId, baseId) => `${actorId >>> 0}:${baseId >>> 0}`;
  const brokeDownRecently = (actorId, baseId, now) => {
    const at = S.brokeDown.get(loopKey(actorId, baseId));
    return at !== undefined && now - at < Math.max(0, Number(LOOP.windowMinutes) || 0) * 60000;
  };

  const baseRate = (actorId, skillId, kind, detail) => {
    if (kind !== 'award' && typeof inBeastForm === 'function' && inBeastForm(actorId >>> 0)) return num(C.beastRate) ?? 0;
    if (!C.enabled) return 1;
    const spec = (C.rates || {})[skillId];
    const as = kindOf(skillId, kind);
    let rate = 1;
    if (num(spec) !== undefined) rate = spec;
    else if (spec && typeof spec === 'object') {
      rate = num(spec.default) !== undefined ? spec.default : 1;
      if (num(spec[as]) !== undefined) rate = spec[as];
      if (kind === 'craft' && Array.isArray(spec.craftByTier) && detail && detail.recipeId) {
        const marked = Number(detail[`tier:${skillId}`]) || 0;
        const tier = marked >= 1 ? Math.min(5, marked) : recipeOf(detail.recipeId).tier;
        if (tier >= 1 && num(spec.craftByTier[tier - 1]) !== undefined) rate = spec.craftByTier[tier - 1];
      }
    }
    // A product is matched, not a recipe: rotating through different items still works, and the bucket bounds that
    if (kind === 'craft' && LOOP.enabled && detail && detail.recipeId) {
      const now = Date.now();
      const { product, consumes } = recipeOf(detail.recipeId);
      if (product && brokeDownRecently(actorId, product, now)) {
        const k = loopKey(actorId, product);
        if (!(now - (S.told.get(k) || 0) < 60 * 60000)) { S.told.set(k, now); log(`skillRates: ${(actorId >>> 0).toString(16)} crafted ${product.toString(16)} after breaking one down; ${skillId} at x${num(LOOP.rate) ?? 0} for ${LOOP.windowMinutes} min`); }
        rate = num(LOOP.rate) !== undefined ? LOOP.rate : 0;
      }
      // A smelter recipe that takes a weapon or armour apart (Immersive Weapons' IWBreakdown*, Immersive Armors' IAB*) is a
      // breakdown too, as salvage.js's are
      for (const item of consumes) noteBreakdown(actorId, item);
    }
    // The race's one boosted skill (racial.js, the overhaul): after the rate above, never for a staff award
    if (typeof globalThis.__dboRaceSkillRate === 'function') {
      try { const r = Number(globalThis.__dboRaceSkillRate(actorId >>> 0, skillId, kind)); if (Number.isFinite(r) && r > 0) rate *= r; } catch (e) { /* no race boost */ }
    }
    // A god's skill boon (prayer.js skillBoon), never for a staff award
    if (kind !== 'award' && typeof globalThis.__dboBlessingSkillRate === 'function') {
      try { const r = Number(globalThis.__dboBlessingSkillRate(actorId >>> 0, skillId)); if (Number.isFinite(r) && r > 0) rate *= r; } catch (e) { /* no blessing boost */ }
    }
    if (as === 'craft' && rate > 0) rate *= valueFactor(actorId, skillId, kind, detail);
    if (as === 'craft' && rate > 0) rate *= firstCraftRate(actorId, skillId, detail, kind);
    return rate;
  };

  // A class at a Class Lectern before the first spell (schools.js, Nate 11 Oct): its award to Arcane Arts is worth the
  // class's firstRate, on top of the skill's own rate; the Wheel's meter has already decided how much work got through
  const rateFor = (actorId, skillId, kind, detail) => {
    // Priest held at an Apprentice or Adept pick until that spell is chosen (schools.js, Arcane Mastery)
    try { if (typeof globalThis.__dboSchoolsSkillHeld === 'function' && globalThis.__dboSchoolsSkillHeld(actorId >>> 0, skillId)) return 0; } catch (e) { /* never blocks on error */ }
    let rate = baseRate(actorId, skillId, kind, detail);
    // A referral or welcome boost (referrals.js) runs through here, never through private.xpBoost; normal play only, never an award (staff, alchemy)
    if (rate > 0 && kind !== 'award' && typeof globalThis.__dboReferralSkillRate === 'function') {
      try { const r = Number(globalThis.__dboReferralSkillRate(actorId >>> 0)); if (Number.isFinite(r) && r >= 1 && r <= 3) rate *= r; } catch (e) { /* no referral boost */ }
    }
    if (kind !== 'award' || typeof globalThis.__dboSchoolsAwardRate !== 'function') return rate;
    let k = 1;
    try { k = Number(globalThis.__dboSchoolsAwardRate(actorId >>> 0, skillId, kind, detail)); } catch (e) { k = 1; }
    return Number.isFinite(k) && k >= 0 ? rate * k : rate;
  };

  // The first-time bonus for this craft (1 when it is not one), noting the item as made
  const KINDS = 'private.dboCraftedKinds';
  const firstCraftRate = (actorId, skillId, detail, kind) => {
    // An award-made craft (a brew) names its product as detail.key; a craft event names its recipe
    const viaAward = kind === 'award' && CRAFT_AWARDS.includes(skillId);
    if (FIRST.enabled !== true || !detail || !(viaAward ? detail.key : detail.recipeId) || !(FIRST.skills || []).includes(skillId) || !mp) return 1;
    const { product, bench } = viaAward ? { product: Number(detail.key) >>> 0, bench: '' } : recipeOf(detail.recipeId);
    if (!product || (FIRST.noBenches || []).includes(bench)) return 1;
    let desc = ''; try { desc = String(mp.getDescFromId(product >>> 0)).toLowerCase(); } catch (e) { return 1; }
    if (!desc) return 1;
    let all = null; try { all = mp.get(actorId >>> 0, KINDS); } catch (e) { return 1; }
    all = all && typeof all === 'object' ? all : {};
    const made = Array.isArray(all[skillId]) ? all[skillId] : [];
    if (made.includes(desc)) return 1;
    const n = made.length;   // different items made before this one
    const full = Math.max(1, Number(FIRST.fullFor) || 25), r = Math.max(1, Number(FIRST.rate) || 1);
    const mult = n < full ? r : 1 + (r - 1) * full / (n + 1);
    // A server whose masterySystem reports what it credited (globalThis.__dboMasteryCreditsHook) marks the item only when the
    // craft really earned something: at a spent bucket or cap the bonus waits for the next time. An older one marks it now
    if (globalThis.__dboMasteryCreditsHook) S.firstPending.set(`${actorId >>> 0}|${skillId}`, { desc, mult });
    else markMade(actorId, skillId, desc, mult);
    return mult;
  };
  const markMade = (actorId, skillId, desc, mult) => {
    let all = null; try { all = mp.get(actorId >>> 0, KINDS); } catch (e) { return; }
    all = all && typeof all === 'object' ? all : {};
    const made = Array.isArray(all[skillId]) ? all[skillId] : [];
    if (made.includes(desc)) return;
    if (made.length < (Number(FIRST.maxKept) || 3000)) {
      try { mp.set(actorId >>> 0, KINDS, Object.assign({}, all, { [skillId]: made.concat([desc]) })); } catch (e) { return; }
    }
    try { if (typeof personal === 'function') personal(actorId >>> 0, mult >= 1.5 ? 'Something new: you learn more making it the first time.' : 'Something new, though by now you learn little more from it.'); } catch (e) { /* the message is optional */ }
  };
  // ---- the hourly bucket, said out loud (Nate, 14 Oct) ----------------------------------------------------------------
  // A craft at an empty bucket teaches nothing, and the fork says so at most once in ten minutes (masterySystem
  // POINT_REFUSE_NOTICE_MS), so players went on making salt soup for nothing ("200 salt for one Cook level"). Here: the
  // first refused craft of each empty bucket is told, then every refused craft once the bucket has been empty for
  // repeatAfterMinutes, each with how long until it pays again (the fork's own token bucket, skillPoints.ts
  // bucketAfterRefill / msUntilOneToken, from skills.json pointSystem). A craft that credits something ends the run.
  // Config skillRates.bucketNotice: { enabled, repeatAfterMinutes }.
  const NOTICE = Object.assign({ enabled: true, repeatAfterMinutes: 10 }, C.bucketNotice || {});
  const SKILLS_FILE = (() => { try { return JSON.parse(require('fs').readFileSync(require('path').resolve('skills.json'), 'utf8')); } catch (e) { return {}; } })();
  const PS = SKILLS_FILE.pointSystem || {};
  const PER_HOUR = Number(PS.bucketPerHour) > 0 ? Number(PS.bucketPerHour) : 30, BURST = Number(PS.bucketBurst) > 0 ? Number(PS.bucketBurst) : 20;
  const LABELS = new Map((Array.isArray(SKILLS_FILE.skills) ? SKILLS_FILE.skills : []).filter((k) => k && k.id).map((k) => [String(k.id), String(k.label || k.id)]));
  if (!(S.bucketRuns instanceof Map)) S.bucketRuns = new Map();   // actor|skill -> { since } while crafts find the bucket empty
  // ms until the skill's bucket pays for one unit again; 0 when it already would (so the refusal was something else)
  const bucketWait = (actorId, skillId) => {
    let b = null; try { const r = mp.get(actorId >>> 0, 'private.mastery'); b = r && r.skills && r.skills[skillId] && r.skills[skillId].bucket; } catch (e) { return 0; }
    if (!b || !Number.isFinite(Number(b.tokens)) || !Number.isFinite(Number(b.at))) return 0;
    const tokens = Math.max(0, Math.min(BURST, Number(b.tokens) + ((Date.now() - Number(b.at)) / 3600000) * PER_HOUR));
    return tokens >= 1 ? 0 : Math.ceil(((1 - tokens) / PER_HOUR) * 3600000);
  };
  const bucketNotice = (actorId, skillId, units) => {
    if (NOTICE.enabled === false || !mp || typeof personal !== 'function') return;
    const key = `${actorId >>> 0}|${skillId}`;
    if (Number(units) > 0) { S.bucketRuns.delete(key); return; }
    const wait = bucketWait(actorId, skillId);
    if (!(wait > 0)) return;
    const now = Date.now();
    const run = S.bucketRuns.get(key);
    if (run && now - run.since < Math.max(0, Number(NOTICE.repeatAfterMinutes) || 0) * 60000) return;
    if (!run) S.bucketRuns.set(key, { since: now });
    if (S.bucketRuns.size > 4096) S.bucketRuns.clear();
    const mins = Math.max(1, Math.round(wait / 60000));
    try { personal(actorId >>> 0, `Your ${LABELS.get(skillId) || skillId} has learned all it can for now: what you make teaches nothing until it rests. It counts again in about ${mins} minute${mins === 1 ? '' : 's'}.`); } catch (e) { /* the notice is optional */ }
  };

  // masterySystem, after the meter: the units this act credited to this skill (fork mastery-credited-hook)
  const credited = (actorId, skillId, kind, detail, units) => {
    if (kindOf(skillId, kind) === 'craft') bucketNotice(actorId, skillId, units);
    const key = `${actorId >>> 0}|${skillId}`;
    const p = S.firstPending.get(key);
    if (!p) return;
    S.firstPending.delete(key);
    if (kindOf(skillId, kind) === 'craft' && Number(units) > 0) markMade(actorId, skillId, p.desc, p.mult);
  };

  const noteBreakdown = (actorId, baseId) => {
    if (!LOOP.enabled || !baseId) return;
    const now = Date.now();
    S.brokeDown.set(loopKey(actorId, baseId), now);
    if (S.brokeDown.size > 5000) {
      const windowMs = Math.max(0, Number(LOOP.windowMinutes) || 0) * 60000;
      for (const [k, at] of S.brokeDown) if (now - at >= windowMs) { S.brokeDown.delete(k); S.told.delete(k); }
    }
  };

  globalThis.__dboSkillRate = rateFor;
  globalThis.__dboSkillRateCredited = credited;
  globalThis.__dboSkillRateBrokeDown = noteBreakdown;

  const plain = (v) => Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_')));
  const shown = Object.entries(C.rates || {}).filter(([k]) => !k.startsWith('_')).map(([k, v]) => `${k} ${v && typeof v === 'object' ? JSON.stringify(plain(v)) : 'x' + v}`);
  log(`skillRates ${C.enabled ? 'on' : 'off'}: ${shown.join(', ') || 'every skill x1'}; ${Object.keys(TIERS).length} material tiers; salvage loop ${LOOP.enabled ? `x${LOOP.rate} for ${LOOP.windowMinutes} min` : 'off'}; bucket notice ${NOTICE.enabled !== false ? `on, again after ${NOTICE.repeatAfterMinutes} min` : 'off'}; craft value ${VALUE.enabled !== false ? Object.entries(VALUE.skills || {}).map(([k, v]) => `${k} full ${v.full} min ${v.min}`).join(', ') : 'off'}; beast form x${num(C.beastRate) ?? 0}`);
  return { rateFor, noteBreakdown, recipeOf, valueFactor };
};
