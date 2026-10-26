// The Great House capes' server data (DLE 1D2258-1D2280, merged 26 Oct by Worker 3 from Worker 7's child; the Leader's and
// Worker 2's decisions): the 9 capes in the admin panel, the 7 house capes gated to their house's tailors in faction gear, and
// their recipes' provinces in regions-overrides (the house capes common, Dagoth and the New Temple Solstheim). Data only, no
// server. Run from the server folder: node tests/great-house-capes-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };
const D = ':DragonBreak Online Edits.esp';
// item, name, recipe, house (null: no faction)
const CAPES = [
  ['1d2266', 'House Redoran Cape', '1d226f', 'house-redoran'],
  ['1d226e', 'House Hlaalu Cape', '1d2277', 'house-hlaalu'],
  ['1d2267', 'House Telvanni Cape', '1d2270', 'house-telvanni'],
  ['1d226c', 'House Telvanni Cape (Purple)', '1d2276', 'house-telvanni'],
  ['1d226a', 'House Indoril Cape', '1d2272', 'house-indoril'],
  ['1d226d', 'House Indoril Cape (White and Gold)', '1d2275', 'house-indoril'],
  ['1d2269', 'House Dres Cape', '1d2271', 'house-dres'],
  ['1d2268', 'House Dagoth Cape', '1d2274', null],
  ['1d226b', 'New Temple Cape', '1d2273', null],
];

// ---- the admin panel ----
const clothing = read('admin-items.json').categories.find((c) => c.id === 'Clothing').items;
for (const [item, name] of CAPES) ok(clothing.some((r) => r[0] === item + D && r[1] === name && r[2] === 'DragonBreak Online Edits.esp'), `${name} is in the admin panel's Clothing`);
ok(clothing.map((r) => r[1].toLowerCase()).every((n, i, a) => i === 0 || a[i - 1] <= n), 'Clothing is still sorted by name');

// ---- faction gear: each house cape for its own house's tailors ----
const gear = read('faction-gear.json').items;
const guilds = fs.readFileSync(path.join(__dirname, '..', 'guild-defs.json'), 'utf8');
for (const [item, name, recipe, house] of CAPES) {
  const e = gear[item + D];
  if (house) ok(e && e.name === name && e.role === 'tailor' && JSON.stringify(e.factions) === JSON.stringify([house]) && JSON.stringify(e.recipes) === JSON.stringify([recipe + D]), `${name}: ${house}'s tailors only, from its tanning-rack recipe`, e);
  else ok(!e, `${name}: no faction holds it, so it is open to any tailor`, e);
}
for (const h of new Set(CAPES.map((c) => c[3]).filter(Boolean))) ok(guilds.includes(`"${h}"`), `${h} is a faction in guild-defs.json`);
ok(/'1d2266:DragonBreak Online Edits\.esp': \('House Redoran Cape'/.test(fs.readFileSync(path.join(__dirname, '..', 'tools', 'faction_gear.py'), 'utf8')), 'tools/faction_gear.py carries them too, so a rerun reproduces them');

// ---- regions: the recipes' provinces ----
const rec = read('regions-overrides.json').recipes;
for (const [, name, recipe, house] of CAPES) {
  const v = rec[recipe + D.toLowerCase()];
  if (house) ok(v === 'common', `${name}'s recipe is common (the faction is its only gate)`, v);
  else ok(JSON.stringify(v) === '["solstheim"]', `${name}'s recipe is Solstheim's`, v);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
