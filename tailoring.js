// DragonBreak Online: the Tailor's ranks gate what a loom makes (Nate, 12 Oct: "enforce tailor tiers"; quinn028, #bugs
// 11 Oct: "Level 1 Tailors have the Fine and Noble clothing recipes"). Loaded by gamemode.js after smithing.js; regions.js's
// craft hook asks globalThis.__dboTailorCraft right after the smithing gate, before the faction and province rules.
//
// skills.json names the Tailor's five tiers: Common clothes; Fine clothes, padded armor; Noble clothes, studded medium
// armor; Scaled medium armor; Masterwork garments. A loom recipe (a COBJ whose bench keyword is one of benchKeywords) is
// placed on a tier by its item's gold value, the honest rarity signal the plugins already carry, as skinning does with
// pelts. The bands come from the 407 loom recipes of the live load order (12 Oct): Common <= 15 (beggar's and everyday
// clothes, thread), Fine <= 50 (Fine Clothes 20-50), Noble <= 150 (Colovian Noble and Jarl's clothes 100), Scaled <= 400,
// Masterwork above (Dragonhide robes 400-2,000). The Tailor's rank (Novice 0 .. Master 4) must reach the recipe's tier
// (tier = rank + 1); refused, the materials come back as for any refused craft. Staff pass (unless /tailoring test), as
// do a faction's own tailors making that faction's gear (factiongear.js decides those).
// Config "tailoring": { enabled, tierValueCap: [15, 50, 150, 400, 1e9], benchKeywords }. Hot reload.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, who, cfg, isAdmin, sendPacket, registerChatCommand } = api;
  const C = Object.assign({ enabled: true, tierValueCap: [15, 50, 150, 400, 1e9], benchKeywords: ['MCE_CraftingLoom', 'MCE_Loom', 'TailorBench'] }, cfg.tailoring || {});
  const TIERS = ['Common clothes', 'Fine clothes', 'Noble clothes', 'Scaled armor', 'Masterwork garments'];
  const RANKS = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'];
  const S = globalThis.__dboTailorState || (globalThis.__dboTailorState = { bench: new Map(), value: new Map(), told: new Map(), test: new Set() });

  const get = (id, prop, dflt) => { try { const v = mp.get(id, prop); return v === undefined || v === null ? dflt : v; } catch (e) { return dflt; } };
  const lookup = (id) => { try { const r = id ? mp.lookupEspmRecordById(id >>> 0) : null; return r && r.record ? r : null; } catch (e) { return null; } };
  const u32 = (f) => (f && f.data && f.data.byteLength >= 4 ? new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(0, true) : 0);
  const i32 = (f) => (f && f.data && f.data.byteLength >= 4 ? new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getInt32(0, true) : 0);
  const fieldId = (res, type) => { const f = (res.record.fields || []).find((x) => x && x.type === type); const v = u32(f); try { return v ? res.toGlobalRecordId(v) >>> 0 : 0; } catch (e) { return 0; } };
  const BENCH = new Set((C.benchKeywords || []).map(String));

  // A COBJ made at a loom
  const isLoomRecipe = (recipeId) => {
    const id = recipeId >>> 0;
    if (S.bench.has(id)) return S.bench.get(id);
    const res = lookup(id); let yes = false;
    if (res && String(res.record.type) === 'COBJ') { const b = lookup(fieldId(res, 'BNAM')); yes = !!b && BENCH.has(String(b.record.editorId || '')); }
    if (S.bench.size > 5000) S.bench.clear();
    S.bench.set(id, yes);
    return yes;
  };
  // The item's gold value: ARMO, WEAP, MISC and the like keep it at the start of DATA; 0 when unknown
  const valueOf = (itemId) => {
    const id = itemId >>> 0;
    if (S.value.has(id)) return S.value.get(id);
    const res = lookup(id);
    const v = res ? Math.max(0, i32((res.record.fields || []).find((x) => x && x.type === 'DATA'))) : 0;
    if (S.value.size > 5000) S.value.clear();
    S.value.set(id, v);
    return v;
  };
  // 1..5
  const tierOfValue = (value) => { const caps = Array.isArray(C.tierValueCap) ? C.tierValueCap : [15, 50, 150, 400, 1e9]; for (let i = 0; i < caps.length; i++) if (value <= Number(caps[i])) return i + 1; return caps.length; };

  // The curated list first, the item's value only for what it does not name (Nate, 14 Oct: the tailoring spec). Value
  // was the rarity signal the plugins already carried and it reads a mourner's hat and a master's robe the same way
  // when their prices are close; a named tier does not. The list covers 260 of the 377 loom items, so the rest still
  // need the old rule, and a missing or broken file leaves every one of them on it rather than opening the loom.
  const LIST = (() => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.resolve('tailoring-tiers.json'), 'utf8'));
      const out = new Map();
      for (const [desc, v] of Object.entries((raw && raw.items) || {})) {
        const t = Math.round(Number(v && v.tier));
        if (t >= 1 && t <= 5) out.set(String(desc).toLowerCase(), t);
      }
      log(`tailoring: ${out.size} item(s) placed by name, the rest by value`);
      return out;
    } catch (e) {
      log(`tailoring: tailoring-tiers.json not read (${e.message}); every item falls back to its value`);
      return new Map();
    }
  })();
  const descOf = (itemId) => { try { return String(mp.getDescFromId(itemId >>> 0) || '').toLowerCase(); } catch (e) { return ''; } };
  const tierOfItem = (itemId) => {
    const named = LIST.get(descOf(itemId));
    return named || tierOfValue(valueOf(itemId));
  };
  // 0 without the Tailor skill, else 1..5
  const tailorTier = (a) => {
    const r = get(a, 'private.mastery', null);
    if (!r || !Array.isArray(r.order) || !r.order.includes('tailor')) return 0;
    const p = r.skills && r.skills.tailor;
    return Math.max(0, Math.min(4, Number(p && p.rank) || 0)) + 1;
  };
  const tell = (a, text) => {
    if (Date.now() - (S.told.get(a) || 0) < 3000) return;
    S.told.set(a, Date.now());
    personal(a, text);
    try { sendPacket(a, { customPacketType: 'dboNotice', text }); } catch (e) { /* the chat line is enough */ }
  };

  // regions.js: false refuses the craft (the materials come back), anything else lets the rest of the chain decide
  globalThis.__dboTailorCraft = (actorId, itemId, recipeId) => {
    if (C.enabled === false) return true;
    const a = actorId >>> 0;
    if (!isLoomRecipe(recipeId)) return true;
    if (isAdmin(a) && !S.test.has(a)) return true;
    // A faction's own tailor makes that faction's gear (factiongear.js), as smithing.js lets its smiths
    try { if (typeof globalThis.__dboFactionGearMember === 'function' && globalThis.__dboFactionGearMember(a, itemId) === true) return true; } catch (e) { /* the usual gate */ }
    const need = tierOfItem(itemId), have = tailorTier(a);
    if (have >= need) return true;
    tell(a, `${TIERS[need - 1]} are ${RANKS[need - 1]} Tailor's work; ${have ? `you are ${/^[AEIOU]/.test(RANKS[have - 1]) ? 'an' : 'a'} ${RANKS[have - 1]} Tailor` : 'you have not taken up the Tailor'}. Your materials come back when you close the menu.`);
    audit(`TAILOR craft refused ${who(a)} at Tailor tier ${have}: recipe ${(recipeId >>> 0).toString(16)} needs tier ${need} (${LIST.has(descOf(itemId)) ? 'by name' : `by value ${valueOf(itemId)}`})`);
    return false;
  };
  globalThis.__dboTailorTierOf = (itemId) => tierOfItem(itemId >>> 0);

  if (typeof registerChatCommand === 'function') {
    registerChatCommand('tailoring', (a, rest) => {
      if (!isAdmin(a)) return personal(a, 'Staff only.');
      if (String(rest || '').trim() === 'test') {
        if (S.test.has(a)) S.test.delete(a); else S.test.add(a);
        return personal(a, `Tailor tiers ${S.test.has(a) ? 'now apply to you (test)' : 'no longer apply to you'}.`);
      }
      personal(a, `Tailor tiers ${C.enabled === false ? 'off' : 'on'}: value caps ${(C.tierValueCap || []).join(' / ')}. /tailoring test applies them to you.`);
    }, { admin: true, help: 'Tailor tiers: test on yourself' });
  }
  log(`tailoring ${C.enabled === false ? 'off' : 'on'}: loom recipes gated by item value ${(C.tierValueCap || []).join('/')}`);
};
