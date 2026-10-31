// The armour balance of 31 Oct (Nat, yes to all four; _work/armor-balance-1031.md on the PC): the tier bands counted by
// editor id in gamemode-config.json armorMaterials.ratingByEditorId, from tools/materials/armor-bands-1031.tsv (the same
// list the PC's plugin pass writes), the re-tiered families, and the Dwemer Mantis armour out of every way to get it.
// node tests/armor-bands-harness.js [gamemode-config.json to test]
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const cfg = JSON.parse(fs.readFileSync(process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'gamemode-config.json'), 'utf8'));
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!c) fails++; };

const table = (cfg.armorMaterials || {}).ratingByEditorId || {};
const rows = read('tools/materials/armor-bands-1031.tsv').trim().split(/\r?\n/);
const head = rows.shift().split('\t');
const col = (r, k) => r.split('\t')[head.indexOf(k)];
const BODY = { Heavy: { 1: [25, 28], 2: [29, 31], 3: [32, 35], 4: [36, 41], 5: [40, 42], 6: [43, 45], 7: [46, 49] },
  Light: { 1: [20, 26], 2: [26, 28], 3: [29, 31], 4: [32, 34], 5: [35, 38], 6: [39, 41], 7: [42, 44] } };
// full: one piece over body, head, hands and feet (the Dwemer Mantis chassis), the four slots' sum
const RATIO = { Heavy: { body: 1, head: 0.47, hands: 0.36, feet: 0.36, full: 2.19 }, Light: { body: 1, head: 0.42, hands: 0.29, feet: 0.29, full: 2 } };
const missing = rows.filter((r) => Number(table[col(r, 'edid')]) !== Number(col(r, 'target')));
ok(rows.length > 300 && missing.length === 0, `every one of the ${rows.length} band targets is counted by editor id at its value`, missing.slice(0, 3));
const outside = rows.filter((r) => {
  const [lo, hi] = BODY[col(r, 'type')][col(r, 'tier')], k = RATIO[col(r, 'type')][col(r, 'slot')], t = Number(col(r, 'target'));
  return t < Math.round(lo * k) || t > Math.round(hi * k);
});
ok(outside.length === 0, 'each target sits inside its tier and slot band', outside.slice(0, 3));
ok(!rows.some((r) => /^BlackBearAncientNord/.test(col(r, 'edid'))) && table.BlackBearAncientNordCuirass === 41, 'the sets Nate counted by hand (Black Bear) are left as he set them');
ok(table.DLC2ArmorStalhrimHeavyCuirass === 44 && table.DLC2ArmorNordicHeavyCuirass === 41, 'the approved 30 Sep ladder: Stalhrim Heavy 44, Nordic 41');
const worst = rows.find((r) => /Ebony Coat of Plates/.test(col(r, 'set')) && col(r, 'slot') === 'body');
ok(worst && Number(col(worst, 'target')) <= 45, 'the worst offender (Ebony Coat of Plates, 90) comes into tier 6', worst && col(worst, 'target'));

const fam = Object.fromEntries(JSON.parse(read('smithing.json')).families.map((f) => [f.id, f.tier]));
ok(fam.dwarven === 3 && fam.elven === 3 && fam.orcish === 4 && fam.scaled === 4 && fam.nordic === 4 && fam.EBONY === 6 && fam.DAEDRIC === 7,
  'families re-tiered to vanilla\'s order: Dwarven and Elven 3, Orcish, Scaled and Nordic 4; Ebony 6, Daedric 7', fam);

const MANTIS = ['81d', '81e', '81f', '820', '821', '822', '823', '824'].map((x) => `${x}:DragonBreak Armory.esp`);
const never = JSON.parse(read('loot-overrides.json')).never;
ok(MANTIS.every((d) => never[d]), 'the Dwemer Mantis armour is never loot (all 8 pieces)');
// In its tier band too (Leader, 31 Oct: no exception), so a chassis already held counts as tier 3 Dwarven
ok(table.DBOArm_MantisArmorDwarvenAngelChassis === 73 && table.DBOArm_MantisArmorDwarvenAngelChassisLight === 60, '...and a chassis already held counts in the tier 3 band (73 heavy, 60 light, from 87 and 78)');
const catalogue = read('admin-items.json');
ok(MANTIS.every((d) => !catalogue.includes(`"${d}"`)), '...is out of the staff item catalogue');
ok(MANTIS.every((d) => JSON.parse(read('regions-overrides.json')).forgeNever[d]), '...is never forged');
ok(/UNOBTAINABLE\.has\(descOf\(it\.id\)\.toLowerCase\(\)\)\) return personal\(caller/.test(read('staffitemspells.js')), '...and /giveitem refuses it');
ok(/return 10 \+ \(craftTier\(actorId >>> 0\) >= fam\.tier \? TEMPER_LEVELS : 0\);/.test(read('smithing.js')) && /const TEMPER_LEVELS = 2;/.test(read('smithing.js')),
  'tempering: every tier two levels by a smith of its tier (smithing-harness and faction-temper-harness run it)');

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
