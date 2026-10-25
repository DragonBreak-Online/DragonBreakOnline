// Bank doors are never dungeon doors (Nat, 25 Oct: "windhelm bank door doesnt work"). The DLE leads WindhelmSSE's
// Warehouse door 0903DE to the Windhelm bank, but dungeons.json still had the Warehouse as a dungeon with that door as its
// entrance, and dungeons.js's lease gate answered the door before the engine could follow its XTEL.
// Checks:
//   - every bank's outside door and cell is kept out of the dungeons dungeons.js builds (gamemode-config dungeons.exclude
//     applies the same filter as dungeons.js, read from its source);
// node tests/bank-doors-census-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const S = path.resolve(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(S, f), 'utf8'));
let fails = 0;
const ok = (c, what, detail) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!c) fails++; };

// Bank doors whose far side we changed, and every bank's cell. Windhelm: the Warehouse door 0903DE leads to the bank cell
// WindhelmBank (DragonBreak.esp 00B93C) and its door 00BA6F. Cheydinhal: the Bank of Cheydinhal (DBO_Cheydinhal.esp).
const BANK_DOORS = ['903de:windhelmsse.esp', 'ba6f:dragonbreak.esp'];
const buildings = read('buildings.json');
const bankBuildings = buildings.buildings.filter((b) => /bank/i.test(b.name));
const BANK_CELLS = new Set(['b93c:dragonbreak.esp'].concat(...bankBuildings.map((b) => b.cells.map((c) => c.toLowerCase()))));
const bankDoors = new Set(BANK_DOORS.concat(...bankBuildings.map((b) => b.entrances.map((e) => String(e.door).toLowerCase()))));

// dungeons.js's own exclusion: its built-in ids plus config dungeons.exclude
const src = fs.readFileSync(path.join(S, 'dungeons.js'), 'utf8');
const m = src.match(/const EXCLUDED = new Set\(\[([^\]]*)\]\.concat\(Array\.isArray\(C\.exclude\) \? C\.exclude : \[\]\)\);/);
ok(!!m, 'dungeons.js still drops excluded ids before building anything (EXCLUDED from config dungeons.exclude)');
const builtIn = m ? (m[1].match(/'[^']+'/g) || []).map((x) => x.slice(1, -1)) : [];
const cfg = read('gamemode-config.json').dungeons || {};
const EXCLUDED = new Set(builtIn.concat(Array.isArray(cfg.exclude) ? cfg.exclude : []));
const dungeons = read('dungeons.json').dungeons.filter((d) => !EXCLUDED.has(d.id));

ok(cfg.exclude.includes('0WindhelmExtWarehouse') && typeof cfg._excludeWarehouse === 'string', 'config dungeons.exclude names the Warehouse, with its note');
const doorHits = dungeons.flatMap((d) => (d.entrances || []).filter((e) => bankDoors.has(String(e.outsideDesc).toLowerCase()) || bankDoors.has(String(e.insideDesc).toLowerCase())).map((e) => `${d.id} ${e.outsideDesc}`));
ok(doorHits.length === 0, `no bank door (${bankDoors.size} checked) is a dungeon entrance`, doorHits);
const cellHits = dungeons.flatMap((d) => (d.cells || []).filter((c) => BANK_CELLS.has(String(c.desc).toLowerCase())).map((c) => `${d.id} ${c.desc}`));
ok(cellHits.length === 0, `no bank cell (${BANK_CELLS.size} checked) is a dungeon cell`, cellHits);
ok(read('dungeons.json').dungeons.some((d) => d.id === '0WindhelmExtWarehouse'), '...and the exclusion is what does it: the generated file still has the Warehouse (a regenerate keeps it out the same way)');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
