// DragonBreak Online: craft recipe filtering (craftfilter.js).
// Hides locked faction equipment, level/tier locked tailoring, and tier-locked smithing recipes from the crafting menu.
// Sends { customPacketType: 'dboCraftFilter', locked: [recipeDesc...] } to the client's CraftFilterService.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, cfg, sendPacket, onlineActors, every, isAdmin } = api;
  const C = Object.assign({ enabled: true, syncIntervalSec: 60 }, (cfg && cfg.craftFilter) || {});

  const readJson = (file, dflt) => {
    try {
      return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    } catch (e) {
      log(`craftfilter: failed to read ${file} (${e.message})`);
      return dflt;
    }
  };

  const norm = (d) => {
    const s = String(d || '');
    const i = s.indexOf(':');
    if (i < 0) return s.toLowerCase();
    const n = parseInt(s.slice(0, i), 16);
    return (Number.isFinite(n) ? n.toString(16) : s.slice(0, i).toLowerCase()) + ':' + s.slice(i + 1).toLowerCase();
  };

  const REGIONS_FILE = path.resolve('regions.json');
  const FACTION_GEAR_FILE = path.resolve('faction-gear.json');
  const TAILORING_TIERS_FILE = path.resolve('tailoring-tiers.json');
  const SMITHING_FILE = path.resolve('smithing.json');
  const LOOT_MATERIALS_FILE = path.resolve('loot-materials.json');

  // Tempering and auxiliary recipes omitted by regions.json (which indexes only creation recipes)
  const EXTRA_RECIPES = {
    // Adamantium tempering (DragonBreak Nexus Patches.esp)
    'cf8:DragonBreak Nexus Patches.esp': { item: 'cf6:DragonBreak Nexus Patches.esp', bench: 'CraftingSmithingArmorTable' },
    'cfe:DragonBreak Nexus Patches.esp': { item: 'cfb:DragonBreak Nexus Patches.esp', bench: 'CraftingSmithingArmorTable' },
    'd05:DragonBreak Nexus Patches.esp': { item: 'd02:DragonBreak Nexus Patches.esp', bench: 'CraftingSmithingArmorTable' },
    'd0c:DragonBreak Nexus Patches.esp': { item: 'd09:DragonBreak Nexus Patches.esp', bench: 'CraftingSmithingArmorTable' },
    'd11:DragonBreak Nexus Patches.esp': { item: 'd0f:DragonBreak Nexus Patches.esp', bench: 'CraftingSmithingArmorTable' },
    'd17:DragonBreak Nexus Patches.esp': { item: 'd15:DragonBreak Nexus Patches.esp', bench: 'CraftingSmithingSharpeningWheel' },
    'd1c:DragonBreak Nexus Patches.esp': { item: 'd1a:DragonBreak Nexus Patches.esp', bench: 'CraftingSmithingSharpeningWheel' },
    'd21:DragonBreak Nexus Patches.esp': { item: 'd1f:DragonBreak Nexus Patches.esp', bench: 'CraftingSmithingSharpeningWheel' },
    'd26:DragonBreak Nexus Patches.esp': { item: 'd24:DragonBreak Nexus Patches.esp', bench: 'CraftingSmithingSharpeningWheel' },
    'd2b:DragonBreak Nexus Patches.esp': { item: 'd29:DragonBreak Nexus Patches.esp', bench: 'CraftingSmithingSharpeningWheel' },
    'd30:DragonBreak Nexus Patches.esp': { item: 'd2e:DragonBreak Nexus Patches.esp', bench: 'CraftingSmithingSharpeningWheel' },
    'd35:DragonBreak Nexus Patches.esp': { item: 'd33:DragonBreak Nexus Patches.esp', bench: 'CraftingSmithingSharpeningWheel' },
    'd3a:DragonBreak Nexus Patches.esp': { item: 'd38:DragonBreak Nexus Patches.esp', bench: 'CraftingSmithingSharpeningWheel' },

    // Adamantium tempering (DragonBreak Armory.esp)
    '83a:DragonBreak Armory.esp': { item: '829:DragonBreak Armory.esp', bench: 'CraftingSmithingArmorTable' },
    '83b:DragonBreak Armory.esp': { item: '82a:DragonBreak Armory.esp', bench: 'CraftingSmithingArmorTable' },
    '83c:DragonBreak Armory.esp': { item: '82b:DragonBreak Armory.esp', bench: 'CraftingSmithingArmorTable' },
    '83d:DragonBreak Armory.esp': { item: '82c:DragonBreak Armory.esp', bench: 'CraftingSmithingArmorTable' },
    '83e:DragonBreak Armory.esp': { item: '82d:DragonBreak Armory.esp', bench: 'CraftingSmithingArmorTable' },

    // Ancient Nord / Nord Hero tempering (Skyrim.esm)
    '1731b:Skyrim.esm': { item: '56a9d:Skyrim.esm', bench: 'CraftingSmithingArmorTable' },
    '1731c:Skyrim.esm': { item: '18388:Skyrim.esm', bench: 'CraftingSmithingArmorTable' },
    '1731d:Skyrim.esm': { item: '56b17:Skyrim.esm', bench: 'CraftingSmithingArmorTable' },
    '1731e:Skyrim.esm': { item: '56a9e:Skyrim.esm', bench: 'CraftingSmithingArmorTable' },
    'e49:Skyrim.esm': { item: '68c79:Skyrim.esm', bench: 'CraftingSmithingSharpeningWheel' },
    'e4a:Skyrim.esm': { item: '68c57:Skyrim.esm', bench: 'CraftingSmithingSharpeningWheel' },
    'e4b:Skyrim.esm': { item: 'a3115:Skyrim.esm', bench: 'CraftingSmithingSharpeningWheel' },
    'e4c:Skyrim.esm': { item: '68c7b:Skyrim.esm', bench: 'CraftingSmithingSharpeningWheel' },
    'e4d:Skyrim.esm': { item: '68c63:Skyrim.esm', bench: 'CraftingSmithingSharpeningWheel' },
    '1082c5:Skyrim.esm': { item: '1cb64:Skyrim.esm', bench: 'CraftingSmithingSharpeningWheel' },
    '1082c6:Skyrim.esm': { item: '5bf12:Skyrim.esm', bench: 'CraftingSmithingSharpeningWheel' },
    '1082c7:Skyrim.esm': { item: '236a5:Skyrim.esm', bench: 'CraftingSmithingSharpeningWheel' },
    '1082c8:Skyrim.esm': { item: '5bf13:Skyrim.esm', bench: 'CraftingSmithingSharpeningWheel' },
    '1082c9:Skyrim.esm': { item: '2c66f:Skyrim.esm', bench: 'CraftingSmithingSharpeningWheel' },
    '1082ca:Skyrim.esm': { item: '5bf14:Skyrim.esm', bench: 'CraftingSmithingSharpeningWheel' },
    '1082cb:Skyrim.esm': { item: '2c672:Skyrim.esm', bench: 'CraftingSmithingSharpeningWheel' },
    '1082cc:Skyrim.esm': { item: '5bf15:Skyrim.esm', bench: 'CraftingSmithingSharpeningWheel' },
    '108cff:Skyrim.esm': { item: '302ca:Skyrim.esm', bench: 'CraftingSmithingSharpeningWheel' },

    // Black Bear Ancient Nord tempering (Black Bear Ancient Nord Armor.esp)
    '804:Black Bear Ancient Nord Armor.esp': { item: '802:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    '808:Black Bear Ancient Nord Armor.esp': { item: '806:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    'd71:Black Bear Ancient Nord Armor.esp': { item: 'd68:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    'd72:Black Bear Ancient Nord Armor.esp': { item: 'd69:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    'd73:Black Bear Ancient Nord Armor.esp': { item: 'd6a:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    'd74:Black Bear Ancient Nord Armor.esp': { item: 'd6b:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    'd75:Black Bear Ancient Nord Armor.esp': { item: 'd76:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    'd93:Black Bear Ancient Nord Armor.esp': { item: 'd8e:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    'd9a:Black Bear Ancient Nord Armor.esp': { item: 'd8a:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    'd9b:Black Bear Ancient Nord Armor.esp': { item: 'd88:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    'd9c:Black Bear Ancient Nord Armor.esp': { item: 'd8b:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    'd9d:Black Bear Ancient Nord Armor.esp': { item: 'd8c:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    'd9e:Black Bear Ancient Nord Armor.esp': { item: 'd89:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    'd9f:Black Bear Ancient Nord Armor.esp': { item: 'd8d:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    'da3:Black Bear Ancient Nord Armor.esp': { item: 'd90:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    'da4:Black Bear Ancient Nord Armor.esp': { item: 'd91:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' },
    'da5:Black Bear Ancient Nord Armor.esp': { item: 'd8f:Black Bear Ancient Nord Armor.esp', bench: 'CraftingSmithingArmorTable' }
  };

  let classified = null;
  let lastMtime = 0;

  // The creation recipes the server itself loads, recipe desc -> { item, bench }: regions.json is built on an older load
  // order and missed later plugins and every benchless recipe, which smithing.js still refuses (#bugs 1568049991400816704).
  // No bench keyword counts as the forge, as CraftService does. Tempering stays EXTRA_RECIPES' explicit list. Null without the API
  const TEMPER_BENCHES = new Set(['CraftingSmithingArmorTable', 'CraftingSmithingSharpeningWheel']);
  let live = null;
  const liveRecipes = () => {
    if (live) return live;
    if (typeof mp.getEspmRecordIdsByType !== 'function' || typeof mp.lookupEspmRecordById !== 'function') return null;
    const started = Date.now();
    const lookup = (id) => { try { const r = id ? mp.lookupEspmRecordById(id >>> 0) : null; return r && r.record ? r : null; } catch (e) { return null; } };
    const u32 = (f) => (f && f.data && f.data.byteLength >= 4 ? new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(0, true) : 0);
    const fieldId = (res, type) => { const v = u32((res.record.fields || []).find((x) => x && x.type === type)); try { return v ? res.toGlobalRecordId(v) >>> 0 : 0; } catch (e) { return 0; } };
    const descOf = (id) => { try { return String(mp.getDescFromId(id >>> 0)); } catch (e) { return ''; } };
    let ids = [];
    try { ids = mp.getEspmRecordIdsByType('COBJ') || []; } catch (e) { return null; }
    const benchName = new Map(), out = {};
    for (const id of ids) {
      const res = lookup(id); if (!res || String(res.record.type) !== 'COBJ') continue;
      const item = fieldId(res, 'CNAM'); if (!item) continue;
      const b = fieldId(res, 'BNAM');
      if (!benchName.has(b)) { const k = b ? lookup(b) : null; benchName.set(b, b ? (k ? String(k.record.editorId || '') : '') : 'CraftingSmithingForge'); }
      const bench = benchName.get(b);
      if (TEMPER_BENCHES.has(bench)) continue;
      const rd = descOf(id), idd = descOf(item);
      if (rd && idd) out[rd] = { item: idd, bench };
    }
    live = out;
    log(`craftfilter: read ${Object.keys(out).length} creation recipes from the load order in ${Date.now() - started} ms`);
    return live;
  };

  const loadRecipes = () => {
    try {
      const regMtime = fs.statSync(REGIONS_FILE).mtimeMs;
      if (classified && regMtime === lastMtime) return classified;
      lastMtime = regMtime;
    } catch {
      if (classified) return classified;
    }

    const regData = readJson(REGIONS_FILE, { recipes: {} });
    const recipes = regData.recipes || {};
    const fgData = readJson(FACTION_GEAR_FILE, { items: {} });
    const fgItems = fgData.items || {};
    const ttData = readJson(TAILORING_TIERS_FILE, { items: {} });
    const ttItems = ttData.items || {};
    const smData = readJson(SMITHING_FILE, { families: [] });
    const lmData = readJson(LOOT_MATERIALS_FILE, { items: {} });
    const lmItems = lmData.items || {};

    const fgNorm = {};
    for (const [k, v] of Object.entries(fgItems)) fgNorm[norm(k)] = v;

    const ttNorm = {};
    for (const [k, v] of Object.entries(ttItems)) ttNorm[norm(k)] = v;

    const lmNorm = {};
    for (const [k, v] of Object.entries(lmItems)) lmNorm[norm(k)] = v;

    const famById = new Map((smData.families || []).map((f) => [f.id, f]));

    const LOOM_BENCHES = new Set(['MCE_CraftingLoom', 'MCE_Loom', 'TailorBench']);
    const FORGE_BENCHES = new Set([
      'CraftingSmithingForge',
      'CraftingSmithingSkyforge',
      'DLC1CraftingDawnguard',
      'DLC1LD_CraftingForgeAetherium',
      'CraftingSmelter',
      'CraftingSmithingArmorTable',
      'CraftingSmithingSharpeningWheel'
    ]);

    const factionList = []; // { recipeDesc, itemDesc, factions, role }
    const tailorList = [];  // { recipeDesc, itemDesc, tier }
    const smithList = [];   // { recipeDesc, itemDesc, family, tier }

    const allRecipes = Object.assign({}, recipes, EXTRA_RECIPES);
    // The load order's recipes regions.json lacks, under the server's own desc
    const listed = new Set(Object.keys(allRecipes).map(norm));
    for (const [rd, r] of Object.entries(liveRecipes() || {})) if (!listed.has(norm(rd))) allRecipes[rd] = r;

    for (const [rDesc, r] of Object.entries(allRecipes)) {
      const iDesc = norm(r.item);
      const bench = String(r.bench || '');

      if (fgNorm[iDesc]) {
        const entry = fgNorm[iDesc];
        factionList.push({
          recipeDesc: rDesc,
          itemDesc: iDesc,
          factions: entry.factions || [],
          role: entry.role || 'blacksmith'
        });
      }

      if (LOOM_BENCHES.has(bench)) {
        const tier = (ttNorm[iDesc] && Number(ttNorm[iDesc].tier)) || 1;
        tailorList.push({
          recipeDesc: rDesc,
          itemDesc: iDesc,
          tier
        });
      }

      if (FORGE_BENCHES.has(bench)) {
        const famId = lmNorm[iDesc];
        if (famId && famById.has(famId)) {
          const fam = famById.get(famId);
          smithList.push({
            recipeDesc: rDesc,
            itemDesc: iDesc,
            family: fam,
            tier: Number(fam.tier) || 1
          });
        }
      }
    }

    classified = { factionList, tailorList, smithList, fgNorm };
    log(`craftfilter: indexed ${factionList.length} faction recipes, ${tailorList.length} loom recipes, ${smithList.length} forge/smelter/temper recipes`);
    return classified;
  };

  const get = (id, prop, dflt) => {
    try {
      const v = mp.get(id, prop);
      return v === undefined || v === null ? dflt : v;
    } catch {
      return dflt;
    }
  };

  const getTailorTier = (a) => {
    const p = get(a, 'private.mastery.skills.tailor', null);
    return Math.max(0, Math.min(4, Number(p && p.rank) || 0)) + 1;
  };

  const getCraftTier = (a) => {
    if (typeof globalThis.__dboSmithCraftTier === 'function') {
      try { return globalThis.__dboSmithCraftTier(a); } catch { /* ignore */ }
    }
    const r = get(a, 'private.mastery', null);
    const p = r && r.skills && r.skills.blacksmith;
    if (!r || !(Array.isArray(r.order) && r.order.includes('blacksmith') || (p && Number(p.level) > 0))) return 0;
    const pts = Math.max(0, Math.min(100, Number(p && p.level) || 0));
    const tierPoints = [0, 15, 30, 45, 60, 76, 91];
    let t = 1;
    tierPoints.forEach((at, i) => { if (pts >= at) t = i + 1; });
    return t;
  };

  const knowsSmithFamily = (a, fam) => {
    if (!fam || fam.tier <= 1) return true;
    if (fam.free) return true;
    const targetId = fam.technique || fam.id;
    if (typeof globalThis.__dboSmithRaceKnows === 'function' && globalThis.__dboSmithRaceKnows(a, targetId)) {
      return true;
    }
    const rec = get(a, 'private.dboManuals', null) || {};
    return !!(rec[targetId] || rec[fam.id]);
  };

  const computeLocked = (actorId) => {
    const a = actorId >>> 0;
    const { factionList, tailorList, smithList, fgNorm } = loadRecipes();

    const fgState = globalThis.__dboFactionGearState;
    const isTesting = fgState && fgState.testing && fgState.testing.has(a);
    if (isAdmin(a) && !isTesting) {
      return [];
    }

    const mine = (typeof globalThis.__dboGuildsOf === 'function' ? globalThis.__dboGuildsOf(a) : null) || [];
    const myFactionIds = new Set(mine.map((m) => m.id));
    const myRolesByFaction = new Map(mine.map((m) => [m.id, m.role]));

    const isFactionCrafter = (factions, role) => {
      for (const fid of factions) {
        if (myFactionIds.has(fid)) {
          const r = myRolesByFaction.get(fid);
          if (r === role || r === 'leader') return true;
        }
      }
      return false;
    };

    const tTier = getTailorTier(a);
    const cTier = getCraftTier(a);

    const lockedSet = new Set();

    // 1. Faction gear filter
    for (const r of factionList) {
      if (!isFactionCrafter(r.factions, r.role)) {
        lockedSet.add(r.recipeDesc);
      }
    }

    // 2. Tailoring loom filter
    for (const r of tailorList) {
      if (tTier < r.tier) {
        const fg = fgNorm[r.itemDesc];
        if (fg && isFactionCrafter(fg.factions || [], 'tailor')) {
          continue;
        }
        lockedSet.add(r.recipeDesc);
      }
    }

    // 3. Smithing forge / smelter / temper filter, by smithing.js's own tier and technique rule where it is loaded: this
    // file's own rule missed a family worked with a free family's technique and hid 5 Imperial bows the forge allows
    const smithKnows = typeof globalThis.__dboSmithKnows === 'function' ? globalThis.__dboSmithKnows : null;
    const smithTier = typeof globalThis.__dboSmithFamilyTier === 'function' ? globalThis.__dboSmithFamilyTier : null;
    // Once per family, never per recipe: each answer reads the actor's race and manuals, and 2,830 recipes for every player
    // at once after a reload held the server's loop for 12 s (live, 7 Nov 00:30 and 01:42: 'craftfilter 1x max 12418')
    const tierOf = new Map(), knows = new Map();
    const famTier = (r) => { if (!tierOf.has(r.family.id)) tierOf.set(r.family.id, (smithTier && smithTier(r.family.id)) || r.tier); return tierOf.get(r.family.id); };
    const famKnown = (r) => { if (!knows.has(r.family.id)) knows.set(r.family.id, smithKnows ? smithKnows(a, r.family.id) : knowsSmithFamily(a, r.family)); return knows.get(r.family.id); };
    for (const r of smithList) {
      const tier = famTier(r);
      if (tier > 1) {
        if (cTier < tier || !famKnown(r)) {
          const fg = fgNorm[r.itemDesc];
          if (fg && isFactionCrafter(fg.factions || [], 'blacksmith')) {
            continue;
          }
          lockedSet.add(r.recipeDesc);
        }
      }
    }

    return Array.from(lockedSet);
  };

  const lastSignatures = new Map();

  const getSignature = (a) => {
    const mine = (typeof globalThis.__dboGuildsOf === 'function' ? globalThis.__dboGuildsOf(a) : null) || [];
    const fSig = mine.map((m) => `${m.id}:${m.role}`).sort().join(',');
    const tTier = getTailorTier(a);
    const cTier = getCraftTier(a);
    const manuals = Object.keys(get(a, 'private.dboManuals', {}) || {}).sort().join(',');
    const admin = isAdmin(a) ? 1 : 0;
    return `${admin}|${tTier}|${cTier}|${fSig}|${manuals}`;
  };

  const sync = (actorId, force = false) => {
    if (!C.enabled) return;
    const a = actorId >>> 0;
    const sig = getSignature(a);
    if (!force && lastSignatures.get(a) === sig) return;
    lastSignatures.set(a, sig);

    const locked = computeLocked(a);
    try {
      sendPacket(a, {
        customPacketType: 'dboCraftFilter',
        locked
      });
    } catch (e) {
      // offline or disconnected
    }
  };

  globalThis.__dboCraftFilterLogin = (a) => {
    lastSignatures.delete(a >>> 0);
    sync(a, true);
  };

  globalThis.__dboSyncCraftFilter = (a) => {
    sync(a, true);
  };

  if (typeof every === 'function') {
    every('craftfilter', (Number(C.syncIntervalSec) || 15) * 1000, () => {
      if (!C.enabled) return;
      for (const a of onlineActors()) {
        sync(a, false);
      }
    });
  }

  loadRecipes();
};
