// The crafting menu's perk table (gamemode-config craftPerkTiers, masterySystem/craftPerkTiers.ts) must never hide a recipe
// smithing.js allows: each vanilla Smithing perk opens at the first Blacksmith rank whose points reach the earliest family
// that needs it (Barush #C9TM, an Orc at 34 points, saw no Orcish recipes, 13 Oct).
//   node tests/craft-perk-tiers-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
const SMITH = JSON.parse(fs.readFileSync(path.join(SERVER, 'smithing.json'), 'utf8'));
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const TIER_POINTS = (CONFIG.smithing && CONFIG.smithing.tierPoints) || [0, 15, 30, 45, 60, 76, 91];
const RANK_POINTS = [0, 25, 50, 75, 90];   // craftPerkTiers tier 1 Novice .. 5 Master
const rankAt = (points) => RANK_POINTS.reduce((r, p, i) => (points >= p ? i + 1 : r), 1);
// The families whose vanilla forge recipes ask for each perk
const PERK_FAMILIES = { SteelSmithing: ['steel'], OrcishSmithing: ['orcish'], AdvancedArmors: ['scaled', 'steelplate'], DwarvenSmithing: ['dwarven'],
  ElvenSmithing: ['elven'], GlassSmithing: ['glass'], EbonySmithing: ['EBONY'], DaedricSmithing: ['DAEDRIC'], DragonArmor: ['DRAGON'] };
const fam = new Map(SMITH.families.map((f) => [f.id, f]));
const perks = CONFIG.craftPerkTiers.perks;
for (const [perk, ids] of Object.entries(PERK_FAMILIES)) {
  const tiers = ids.map((id) => fam.get(id)).filter(Boolean).map((f) => f.tier);
  ok(tiers.length === ids.length, `${perk}: its families are in smithing.json`, ids);
  const opens = TIER_POINTS[Math.min(...tiers) - 1];
  const want = rankAt(opens);
  ok(Number(perks[perk]) <= want, `${perk} shows by rank ${want} (${opens} points, when smithing.js first allows ${ids[0]})`, perks[perk]);
}
ok(Number(perks.OrcishSmithing) <= rankAt(34), 'an Orc smith at 34 points (Barush) sees the Orcish recipes');
ok(!('ArcaneBlacksmith' in perks), 'ArcaneBlacksmith stays out');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
