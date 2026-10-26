// Tomebound in the server's data (The Elder Scrolls - Tomebound, Nexus 21403; its working spells merged into the DLE, Nat 25 Oct;
// child _notes-to-server\staged-20261026-tomebound-child, DLE d33c745f, ids 1d2281..1d244a). Checks the files the server reads:
//   spell-tomes.json   the 73 tomes, in the DLE range, ranked Novice..Expert, each teaching a spell of the same range
//   regions-overrides  every tome, scroll and staff placed by lore origin (Cyrodiil or Skyrim), and loot.json agreeing with it
//   loot.json          the scrolls pool and the staves in ench_weapons; loot-materials.json makes the staves trinkets, the
//                      real loottiers.js classes them so, and dungeons.js rolls the scrolls (config dungeons.scrolls)
//   admin-items.json   the tomes, scrolls and staves in their categories
//   and nothing from the spells left out: the teleports (Planewalk, Mark, Recall) and the script spells
// The Synod shop's stock (a Tomebound Cyrodiil tome on the shelf, a Skyrim one not) is in regions-harness.js.
//   node tests/tomebound-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (what, c, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 500)}`); if (!c) fails++; };
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const DLE = 'DragonBreak Online Edits.esp';
const LO = 0x1d2281, HI = 0x1d244a;
const inRange = (hex) => { const n = parseInt(hex, 16); return n >= LO && n <= HI; };
const canonHex = (id) => id.split(':')[1];          // 'DragonBreak Online Edits.esp:1D23E4'
const descHex = (d) => d.split(':')[0];             // '1d23e4:DragonBreak Online Edits.esp'
const TB = /^UDLC01/;
const LEFT_OUT = /Planewalk|Mark|Recall|OpenLock|Open.*Lock|Charm|Seduce|Mesmerize|Slowfall|SoulSiphon|SoulSplit|Teleport/i;

// ---- spell-tomes.json ---------------------------------------------------------------------------------------------------
const tomes = read('spell-tomes.json').tomes.filter((t) => TB.test(t.name));
ok('73 Tomebound tomes', tomes.length === 73, tomes.length);
ok('...all of them DLE records in Tomebound\'s range, and so are the spells they teach', tomes.every((t) => t.plugin === DLE && t.id.startsWith(DLE + ':') && inRange(canonHex(t.id)) && inRange(canonHex(t.spellId))),
  tomes.filter((t) => !inRange(canonHex(t.id))).map((t) => t.id));
ok('...no two share a book or a spell', new Set(tomes.map((t) => t.id)).size === 73 && new Set(tomes.map((t) => t.spellId)).size === 73);
const SCHOOLS = ['Alteration', 'Conjuration', 'Destruction', 'Illusion', 'Restoration'];
ok('...each of a school and ranked Novice to Expert (0-3, no Master)', tomes.every((t) => SCHOOLS.includes(t.school) && [0, 1, 2, 3].includes(t.rank)), tomes.filter((t) => !SCHOOLS.includes(t.school) || t.rank > 3).map((t) => t.name));
ok('...valued on the base game\'s scale (median by rank 49 / 95 / 340 / 690, Expert under 900)', (() => {
  const med = (r) => { const v = tomes.filter((t) => t.rank === r).map((t) => t.value).sort((a, b) => a - b); return v[v.length >> 1]; };
  return med(0) < 60 && med(1) < 120 && med(2) < 400 && med(3) < 800 && Math.max(...tomes.map((t) => t.value)) < 900;
})());
ok('...none teaches a spell left out (teleports, script spells)', !tomes.some((t) => LEFT_OUT.test(t.name) || LEFT_OUT.test(t.spell)), tomes.filter((t) => LEFT_OUT.test(t.spell)).map((t) => t.spell));
ok('Lightning Form keeps its tome (its boost toned down in the plugin, 500 -> 50)', tomes.some((t) => t.spell === 'UDLC01_DES_LightningFormSpell'));

// ---- regions-overrides.json -------------------------------------------------------------------------------------------------
const OVR = read('regions-overrides.json');
const SKYRIM = /Draugr|DeathHound|VAMP_|Vamp|Wispmother|CorruptedShade/;
const want = (edid) => (SKYRIM.test(edid) ? 'skyrim' : 'cyrodiil');
ok('every tome has its province by editor id, by lore origin', tomes.every((t) => JSON.stringify(OVR.tomes[t.name]) === JSON.stringify([want(t.name)])), tomes.filter((t) => JSON.stringify(OVR.tomes[t.name]) !== JSON.stringify([want(t.name)])).map((t) => t.name));
ok('...63 Cyrodiil (the Synod sells them now), 10 Skyrim', tomes.filter((t) => want(t.name) === 'cyrodiil').length === 63 && tomes.filter((t) => want(t.name) === 'skyrim').length === 10);

// ---- loot.json, loot-materials.json, loottiers.js, dungeons.js ------------------------------------------------------------
const POOLS = read('loot.json').pools;
const scrolls = (POOLS.scrolls || []).filter((x) => TB.test(x.name)), staves = POOLS.ench_weapons.filter((x) => TB.test(x.name));
ok('a scrolls pool with Tomebound\'s 55 scrolls', Array.isArray(POOLS.scrolls) && scrolls.length === 55, (POOLS.scrolls || []).length);
ok('34 Tomebound staves in ench_weapons', staves.length === 34);
ok('...all DLE records in Tomebound\'s range', scrolls.concat(staves).every((x) => x.id.endsWith(':' + DLE) && inRange(descHex(x.id))));
ok('...each with the province regions-overrides gives it, and that province by lore origin', scrolls.concat(staves).every((x) => JSON.stringify(x.p) === JSON.stringify(OVR.items[x.name]) && x.p.join() === want(x.name)),
  scrolls.concat(staves).filter((x) => JSON.stringify(x.p) !== JSON.stringify(OVR.items[x.name])).map((x) => x.name));
ok('...and none of a spell left out', !scrolls.concat(staves).some((x) => LEFT_OUT.test(x.name)), scrolls.concat(staves).filter((x) => LEFT_OUT.test(x.name)).map((x) => x.name));
const MATERIALS = read('loot-materials.json');
ok('loot-materials.json: every Tomebound staff is a staff', staves.every((x) => MATERIALS.items[x.id.toLowerCase()] === 'staff'));
const T = require(path.join(ROOT, 'loottiers.js'))({ materials: MATERIALS, factionGear: read('faction-gear.json'), overrides: read('loot-overrides.json'), cfg: { cap: 'none' } });
ok('...so loottiers.js classes them as trinkets (the rare "trinket or staff" roll), lootable', staves.every((x) => T.classOf(x.id).kind === 'trinket' && T.lootable(x.id)), staves.map((x) => T.classOf(x.id).kind));
const dj = fs.readFileSync(path.join(ROOT, 'dungeons.js'), 'utf8');
ok('dungeons.js: a scroll chance per chest and boss, from config dungeons.scrolls', /const SCROLLS = Object\.assign\(\{ chest: 0\.08, boss: 0\.3 \}, C\.scrolls \|\| \{\}\);/.test(dj));
ok('...rolled in chestLoot from the scrolls pool, under the dungeon\'s province filter', /if \(p\(Number\(boss \? SCROLLS\.boss : SCROLLS\.chest\)\)\) addEntry\(entries, pickFrom\(pool\('scrolls', 0, ok\)\), 1\);/.test(dj));

// ---- admin-items.json -------------------------------------------------------------------------------------------------------
const CAT = Object.fromEntries(read('admin-items.json').categories.map((c) => [c.id, c.items]));
const has = (cat, desc) => (CAT[cat] || []).some((r) => r[0] === desc && r[2] === DLE);
ok('admin-items: the 73 tomes in Spell Tomes', tomes.every((t) => has('Spell Tomes', `${canonHex(t.id).toLowerCase().replace(/^0+/, '')}:${DLE}`)));
ok('...the 55 scrolls in Scrolls, the 34 staves in Enchanted Weapons', scrolls.every((x) => has('Scrolls', x.id)) && staves.every((x) => has('Enchanted Weapons', x.id)));
ok('...each by its game name', (CAT['Spell Tomes'] || []).filter((r) => r[2] === DLE && r[1].startsWith('Spell Tome: ')).length >= 73);

console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
