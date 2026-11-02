// The tracked admin catalogues never offer what the code holds out: a piece that crashes games once placed (decor.js
// blockBases) on the Place tab, an item no one may obtain (staffitemspells.js UNOBTAINABLE) on the Items tab. A
// regeneration put the Bruma Banner back once (window-1101); tooling/admin_catalog_merge.js now reads both lists.
// node tests/catalog-holdouts-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!c) fails++; };
const rows = (f) => JSON.parse(R(f)).categories.flatMap((c) => c.items.map((it) => [c.id, String(it[0]).toLowerCase(), it[1]]));

const bm = R('decor.js').match(/blockBases: \[([^\]]*)\]/);
ok(!!bm, 'decor.js blockBases is in the shape the merge reads');
const blocked = new Set(bm ? bm[1].split(',').map((x) => x.trim().replace(/['"]/g, '').toLowerCase()).filter(Boolean) : []);
ok(blocked.size > 0, 'blockBases names at least one piece', [...blocked]);
const placed = rows('admin-placeables.json').filter(([, d]) => blocked.has(d));
ok(placed.length === 0, 'the Place tab offers no piece in blockBases', placed);

const um = R('staffitemspells.js').match(/const UNOBTAINABLE = new Set\(\[([^\]]*)\]\.map\(\(x\) => `\$\{x\}:([^`]+)`\)\)/);
ok(!!um, 'staffitemspells.js UNOBTAINABLE is in the shape the merge reads');
const never = new Set(um ? um[1].split(',').map((x) => `${x.trim().replace(/['"]/g, '')}:${um[2]}`.toLowerCase()) : []);
const items = rows('admin-items.json').filter(([, d]) => never.has(d));
ok(never.size > 0 && items.length === 0, 'the Items tab offers nothing in UNOBTAINABLE', items);

const merge = R('tooling/admin_catalog_merge.js');
ok(/blockBases/.test(merge) && /UNOBTAINABLE/.test(merge), 'the merge reads both lists, so a regeneration keeps them out');

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
