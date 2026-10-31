// Common Clothes and Armors (Nexus 21305; Leader, 31 Oct: Mail is Steel tier 2, forgeable, sold everywhere): the
// gameplay side that ships with the plugin. Its out-of-band armour counted at the 31 Oct bands by editor id, Mail
// classified Steel, every recipe Worker 3 adds (tools/materials/cca-recipes-1031.tsv) and every piece common in
// regions, the twin recipes' costs, and a patch note crediting the authors.
//   node tests/cca-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!c) fails++; };
const tsv = (f) => { const rows = read(f).trim().split(/\r?\n/).map((l) => l.split('\t')); const h = rows.shift(); return rows.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };

const bands = tsv('tools/materials/cca-bands-1031.tsv');
const table = JSON.parse(read('gamemode-config.json')).armorMaterials.ratingByEditorId;
const BODY = { Heavy: { 1: [25, 28], 2: [29, 31], 3: [32, 35], 4: [36, 41], 5: [40, 42], 6: [43, 45], 7: [46, 49] },
  Light: { 1: [20, 26], 2: [26, 28], 3: [29, 31], 4: [32, 34], 5: [35, 38], 6: [39, 41], 7: [42, 44] } };
ok(bands.length === 51, 'the 51 CCA armour pieces are listed', bands.length);
const patch = bands.filter((b) => b.action === 'patch');
ok(patch.length === 25 && patch.every((b) => table[b.edid] === Number(b.target)), 'the 25 out of band are counted by editor id at their target', patch.filter((b) => table[b.edid] !== Number(b.target)).map((b) => b.edid));
ok(bands.every((b) => { const [lo, hi] = BODY[b.type][b.tier]; const t = Number(b.target); return t >= lo && t <= hi; }), 'every piece sits in its tier band once counted');
ok(bands.filter((b) => b.action !== 'patch').every((b) => table[b.edid] === undefined), '...and the ones already in band are left to their records');
const mail = bands.filter((b) => /^CCA_Mail_/.test(b.edid));
ok(mail.length === 12 && mail.every((b) => b.family === 'steel' && b.tier === '2'), 'Mail is Steel, tier 2 (12 pieces)');
ok(/\(r'\^CCA_Mail_', 'steel'\)/.test(read('tools/loot/loot_materials.py')), '...and loot_materials.py classifies it so (EDID_FIRST)');
ok(table.CCA_SteelPlate_Fur === 40 && table.CCA_Fur_RagsDark === 20 && table.CCA_Mail_Jacket === 28, 'samples: Steel Plate 37 -> 40, Fur Rags 16 -> 20, Mail Jacket 30 -> 28');

const recipes = tsv('tools/materials/cca-recipes-1031.tsv');
const ro = JSON.parse(read('regions-overrides.json'));
const rule = (ro.recipePlugins || {})['dragonbreak nexus patches.esp'];
const rx = rule && rule[0] && new RegExp(rule[0].edid);
ok(recipes.length === 131 && !!rx && recipes.every((r) => rx.test(r.recipeEdid)) && rule[0].p === 'common', 'every one of the 131 new recipes is common by the Nexus Patches rule (regions.js pluginRule)');
ok(!rx.test('CCA_Tempering_Mail_Jacket') && !rx.test('RecipeArmorIronCuirass'), '...which matches nothing else');
ok(recipes.every((r) => ro.items[r.product] === 'common'), '...and every CCA piece (51 armour, 80 clothing) is common in items');
ok(recipes.filter((r) => r.bench === 'CraftingSmithingForge').length === 51 && recipes.filter((r) => r.bench === 'MCE_CraftingLoom').length === 80, 'armour at the forge, clothing at the loom');
ok(recipes.filter((r) => /^CCA_Mail_/.test(r.product)).every((r) => r.twinRecipe === 'RecipeArmorImperialCuirassLight' && /IngotSteel x2/.test(r.items)), 'Mail costs the light steel cuirass (Imperial light: 2 steel, 2 leather, 3 strips)');
ok(recipes.find((r) => r.product === 'CCA_Dwarven_Salvaged').twinWinner === 'DragonBreak Online Edits.esp', 'Dwarven costs our DLE recipe, the winning one');

const pn = JSON.parse(read('patch-notes.json'));
const note = pn.find((e) => /Common Clothes and Armors/.test(e.title));
ok(!!note && /Franklin Zunge/.test(JSON.stringify(note)) && /thetrader/.test(JSON.stringify(note)) && /ProbablyManuel/.test(JSON.stringify(note)), 'the patch note credits Franklin Zunge, thetrader and ProbablyManuel');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
