// Weapon damage bands (Nat, 1 Nov: "yes start with weapon bands"): from _work/weapons-census-1031.csv, the ceiling of a tier
// for a weapon type is the best ordinary vanilla weapon (Skyrim, Update, Dawnguard, HearthFires, Dragonborn; no unique, no
// creature weapon) of a family at that tier or below. Creature weapons are left out (and blocked for players); named
// uniques and artifacts are re-filed to the tier they belong to. Writes weapon-bands-1031.tsv and prints the table.
// py tools/materials/weapon_census.py <Data> <plugins.txt> <server dir> <census.csv>, then
// node tools/materials/weapon_bands.js <census.csv> admin-items.json tools/materials/weapon-bands-1031.tsv
'use strict';
const fs = require('fs');
const [CSV, CATALOGUE, OUT] = process.argv.slice(2);
const rows = fs.readFileSync(CSV, 'utf8').trim().split(/\r?\n/);
const head = rows.shift().split(',');
const R = rows.map((l) => { const c = l.split(','); return Object.fromEntries(head.map((h, i) => [h, c[i]])); });
const cat = fs.readFileSync(CATALOGUE, 'utf8').toLowerCase();
const VANILLA = /:(skyrim\.esm|update\.esm|dawnguard\.esm|hearthfires\.esm|dragonborn\.esm)$/;
// Weapons only a creature or an NPC holds: never a player tier, out of the bands, blocked for players
const CREATURE_PREFIX = /^(Cr|cr|DLC1Cr|DLC2Cr|DLC2cr|BSKCr)[A-Z]/;
const CREATURE = /GiantClub|BenthicLurker|DwarvenSphere|DwarvenBallista|^BSKOgre|^BSKMinotaur|AshSpawn|^DLC1Trap|TrapCrossbow|NonPlayable|Unplayable|NPC$|NP$/i;
// Named uniques and artifacts, re-filed: tier 7 for the Daedric artifacts and legendaries, else the tier of what they are
const UNIQUE = [
  [/BladeOfWoe/i, 7, 'Daedric artifact (Mephala)'], [/Umbra/i, 7, 'Daedric artifact (Clavicus Vile, Umbra)'], [/DawnOfMan/i, 7, 'legendary (Dawn of Man)'],
  [/MiraakSword|MiraakFightSword/i, 7, "Miraak's sword"], [/Nerveshatter/i, 7, 'Daedric artifact'], [/ArtifactArgonianDagger/i, 7, 'artifact'],
  [/^RP_/i, 7, 'artifact'], [/KamenGreatsword/i, 7, 'legendary'], [/LoARPalLegendary/i, 7, 'legendary'], [/KarJeiKnife/i, 7, 'artifact'],
  [/BladesSwordGuardian/i, 6, 'Blades relic'], [/ScorchOfTheUndead/i, 6, 'relic'],
  [/MQ203AkaviriKatana/i, 6, 'Dragonbane'], [/C06BladeOfYsgramor/i, 6, 'Wuuthrad'], [/TG07Chillrend|IWCChillrend/i, 5, 'Chillrend'],
  [/MQ304DraugrBattleAxeTsun/i, 7, "Tsun's axe (Sovngarde)"], [/NightingaleBow/i, 7, 'Nightingale Bow'],
];
const isCreature = (r) => CREATURE_PREFIX.test(r.edid) || CREATURE.test(r.edid);
const uniqueOf = (r) => UNIQUE.find(([rx]) => rx.test(r.edid)) || null;
for (const r of R) if (r.type === 'bow' && /crossbow/i.test(r.edid)) r.type = 'crossbow';
// Catalogued weapons, and every named unique whether the staff catalogue lists it or not
const live = R.filter((r) => uniqueOf(r) && !isCreature(r) || cat.includes('"' + (parseInt(r.desc.split(':')[0], 16)).toString(16) + ':' + r.desc.split(':')[1] + '"'));


const tierOf = (r) => { const u = uniqueOf(r); return u ? u[1] : Number(r.tier); };
// Ceilings from ordinary vanilla weapons
const best = {};
for (const r of live) {
  if (!VANILLA.test(r.desc) || isCreature(r) || uniqueOf(r) || /^(Ench|dun|MG07|MQ|DA|DB|TG|C06|NordHero)/i.test(r.edid)) continue;
  const k = r.type + '|' + r.tier; best[k] = Math.max(best[k] || 0, Number(r.dmg));
}
const TYPES = [...new Set(live.map((r) => r.type))];
const ceil = {};
for (const t of TYPES) for (let tier = 1; tier <= 7; tier++) {
  let c = 0; for (let x = 1; x <= tier; x++) c = Math.max(c, best[t + '|' + x] || 0);
  if (c) ceil[t + '|' + tier] = c;
}
const out = [], creatures = [];
for (const r of live) {
  if (isCreature(r)) { creatures.push(r); continue; }
  const tier = tierOf(r), c = ceil[r.type + '|' + tier], dmg = Number(r.dmg);
  if (!c || dmg <= c) continue;
  const u = uniqueOf(r);
  out.push({ desc: r.desc, edid: r.edid, winner: r.winner, type: r.type, family: u ? 'artifact' : r.family, tier, why: u ? u[2] : 'above its tier', dmg, target: c });
}
const lines = ['desc\tedid\twinner\ttype\tfamily\ttier\twhy\tdamage\ttarget'].concat(out.map((o) => [o.desc, o.edid, o.winner, o.type, o.family, o.tier, o.why, o.dmg, o.target].join('\t')));
fs.writeFileSync(OUT, lines.join('\r\n') + '\r\n');
fs.writeFileSync(OUT.replace(/\.tsv$/, '-creatures.tsv'), ['desc\tedid\ttype\tdamage'].concat(creatures.map((r) => [r.desc, r.edid, r.type, r.dmg].join('\t'))).join('\r\n') + '\r\n');
console.log('catalogued weapons:', live.length, '; clamped:', out.length, '; creature weapons left out:', creatures.length);
console.log('ceilings (sword):', TYPES.includes('sword') ? [1, 2, 3, 4, 5, 6, 7].map((t) => ceil['sword|' + t]).join('/') : '');
for (const t of TYPES) console.log('  ', t.padEnd(11), [1, 2, 3, 4, 5, 6, 7].map((x) => ceil[t + '|' + x] || '-').join('/'));
const fam = {}; for (const o of out) { const k = o.family + ' T' + o.tier; fam[k] = fam[k] || { n: 0, before: 0, after: 0 }; fam[k].n++; fam[k].before += o.dmg; fam[k].after += o.target; }
console.log(JSON.stringify(Object.entries(fam).sort((a, b) => b[1].n - a[1].n).slice(0, 25).map(([k, v]) => `${k}: ${v.n} pieces, mean ${(v.before / v.n).toFixed(1)} -> ${(v.after / v.n).toFixed(1)}`), null, 1));
