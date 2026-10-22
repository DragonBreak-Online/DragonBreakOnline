// The Dawnguard Vampire Lord rings and amulets with no enchantment (value 1000 each) are never dungeon loot: the Amulet of
// the Empath came out of a Master chest (#8HSY, 17 Oct). Eleven of them are cut content: a2a1-a2a8 sit only in the QA
// test container DLC01QAAllWeaponsAndArmor, and e7eb, e803, f4d7 are placed nowhere. The twelfth, the Amulet of the
// Gargoyle (f4d5), is not cut: it is the vanilla reward of the Volkihar radiant quest DLC1RV09 (Amulets of Night Power,
// alias ALCO) and DLC1PlayerVampireQuest's script gives its bonus. Our Vampire Lord is server-driven (beastform.js), so
// here it does nothing either and stays out of loot, but its never reason must not call it cut (review VJ-2, 22 Oct).
// Loads the real loottiers.js with this tree's loot-materials, faction-gear, loot-overrides and gear-swap, as
// dungeons.js does, and checks the gear pools' filter and the reasons staff read.
//   node tests/cut-vampire-jewelry-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (f, fb) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { return fb; } };
const cfg = read('gamemode-config.json', {});
const OVERRIDES = read('loot-overrides.json', { never: {} });
const TIERS = require(path.join(ROOT, 'loottiers.js'))({
  materials: read('loot-materials.json', { items: {} }), factionGear: read('faction-gear.json', { items: {} }),
  overrides: OVERRIDES, swap: read('gear-swap.json', null), cfg: ((cfg.dungeons || {}).lootTiers),
});
const LOOT = read('loot.json', { pools: {} }).pools;
const NEVER = OVERRIDES.never || {};
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const CUT = {
  'a2a1:Dawnguard.esm': 'DLC1VampireBloodMagicRing1', 'a2a2:Dawnguard.esm': 'DLC1VampireBloodMagicRing2',
  'a2a3:Dawnguard.esm': 'DLC1VampireBloodMagicRing3', 'a2a4:Dawnguard.esm': 'DLC1VampireBloodMagicRing4',
  'a2a5:Dawnguard.esm': 'DLC1VampireNightPowerNecklace1', 'a2a6:Dawnguard.esm': 'DLC1VampireNightPowerNecklace2',
  'a2a7:Dawnguard.esm': 'DLC1VampireNightPowerNecklace3', 'a2a8:Dawnguard.esm': 'DLC1VampireNightPowerNecklace4',
  'e7eb:Dawnguard.esm': 'DLC1nVampireBloodMagicRingDrainingClaws', 'e803:Dawnguard.esm': 'DLC1nVampireNightPowerNecklaceBloodyGrip',
  'f4d7:Dawnguard.esm': 'DLC1nVampireNightPowerNecklaceDrain',
};
const GARGOYLE = { 'f4d5:Dawnguard.esm': 'DLC1nVampireNightPowerNecklaceGargoyle' };
const ALL = { ...CUT, ...GARGOYLE };
const GEAR = ['weapons', 'armor', 'ench_weapons', 'ench_armor'];
const rows = (id) => Object.values(LOOT).flat().filter((it) => it && String(it.id).toLowerCase() === id.toLowerCase());
const drawable = (id) => GEAR.some((p) => (LOOT[p] || []).some((it) => String(it.id).toLowerCase() === id.toLowerCase() && TIERS.lootable(it.id)));

// ---- the data ----
const badRows = Object.entries(ALL).filter(([id, edid]) => { const r = rows(id); return !r.length || r.some((it) => it.name !== edid || Number(it.value) !== 1000); });
ok(!badRows.length, "loot.json carries all 12 under their editor ids at value 1000 (why a Master chest reached them)", badRows.map(([id]) => id));
const unnamed = Object.entries(ALL).filter(([id, edid]) => !(typeof NEVER[id] === 'string' && NEVER[id].startsWith(edid)));
ok(!unnamed.length, 'loot-overrides.json names all 12 never loot, each reason led by its editor id', unnamed.map(([id]) => id));

// ---- the reasons staff read (review VJ-2) ----
const cutWords = Object.keys(CUT).filter((id) => !/cut Vampire Lord jewellery the base game never places/.test(String(NEVER[id] || '')));
ok(!cutWords.length, "the 11 cut pieces' reasons say they are cut and never placed", cutWords);
const garg = String(NEVER['f4d5:Dawnguard.esm'] || '');
ok(!/cut Vampire Lord jewellery|the base game never places/.test(garg), 'the Amulet of the Gargoyle (f4d5) is not called cut or never placed: DLC1RV09 hands it out', garg);
ok(/DLC1RV09/.test(garg) && /quest reward/i.test(garg), "the Amulet of the Gargoyle's reason names it the DLC1RV09 quest reward", garg);
ok(!/came out of a Master chest/.test(garg), "the Amulet of the Gargoyle's reason does not claim it came out of the #8HSY chest (that was the Empath, a2a5)", garg);

// ---- the real module ----
ok(TIERS.lootable('a2a5:Dawnguard.esm') === false, 'the Amulet of the Empath (DLC1VampireNightPowerNecklace1) is not loot');
const left = Object.keys(ALL).filter(drawable);
ok(!left.length, 'none of the 12 unenchanted Vampire Lord rings and amulets can be drawn from a gear pool', left);
const CONTROL = ['6020c3:BSAssets.esm', '6020d1:BSAssets.esm', '3b97c:Skyrim.esm', '6bbb5:Skyrim.esm'];
const lost = CONTROL.filter((id) => !drawable(id));
ok(!lost.length, 'ordinary rings and necklaces (brass ring, bronze necklace, silver ring, HMD necklace) are still loot', lost);
const stillIn = Object.values(LOOT).flat().filter((it) => it && /^DLC1n?Vampire(BloodMagicRing|NightPowerNecklace)/.test(String(it.name)) && TIERS.lootable(it.id)).map((it) => it.name);
console.log(`info  enchanted Vampire Lord jewellery the loot filter still passes (owner's call; artifacts.json may hold some back): ${[...new Set(stillIn)].join(', ') || 'none'}`);
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
