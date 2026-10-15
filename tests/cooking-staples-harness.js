// Butter, flour and milk come out of Cyrodiil loot too (Worker F's cooking census, 30 Sep: loot.json gave them only to
// Skyrim and Solstheim, so 17 Cook recipes could not be made inside the Bruma lock; they are made and sold all over
// Tamriel). Checks loot.json, regions-overrides.json, and dungeons.js's own province test (lifted from the file).
//   node tests/cooking-staples-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };
const STAPLES = ['BYOHFoodButter', 'BYOHFoodFlour', 'BYOHFoodMilk'];

const loot = JSON.parse(fs.readFileSync(path.join(SERVER, 'loot.json'), 'utf8'));
const entries = [];
for (const [pool, list] of Object.entries(loot.pools || {})) for (const it of Array.isArray(list) ? list : []) if (it && STAPLES.includes(it.name)) entries.push({ pool, it });
ok(STAPLES.every((n) => entries.some((e) => e.it.name === n)), 'all three staples are in the loot pools', entries.map((e) => e.it.name));

// dungeons.js: "An item with no p is Tamriel-wide"
const src = fs.readFileSync(path.join(SERVER, 'dungeons.js'), 'utf8');
const line = src.split('\n').find((l) => /const hasProv = /.test(l));
ok(!!line, "dungeons.js still has its province test (hasProv)");
const hasProv = new Function(`${line}\nreturn hasProv;`)();
for (const n of STAPLES) {
  const e = entries.filter((x) => x.it.name === n);
  ok(e.length && e.every((x) => hasProv(x.it, 'cyrodiil')), `${n} can drop in a Cyrodiil dungeon`, e.map((x) => x.it.p));
  ok(e.length && e.every((x) => hasProv(x.it, 'skyrim') && hasProv(x.it, 'solstheim')), `${n} still drops in Skyrim and Solstheim`);
  ok(e.every((x) => !('p' in x.it)), `${n} carries no province list (Tamriel-wide, as loot.py writes it)`, e.map((x) => x.it.p));
}

// regions-overrides.json: the source of truth, applied at runtime by regions.js and by the next loot.py run
const ovr = JSON.parse(fs.readFileSync(path.join(SERVER, 'regions-overrides.json'), 'utf8'));
for (const n of STAPLES) ok(ovr.items && ovr.items[n] === 'common', `regions-overrides.json makes ${n} common`, ovr.items && ovr.items[n]);

// loot.json was regenerated on the 140-plugin order (PC, 15 Oct: ck-mcp loot.py, final-fixes gen140), so the old
// "nothing else moved since release-1003" comparison no longer applies; what must survive a regeneration is checked instead:
// the hand additions the generator does not make (the lights pool's Torch01, plain Jade in the gems)
ok((loot.pools.lights || []).some((it) => it.name === 'Torch01') && (loot.pools.gems || []).some((it) => it.name === 'BSKGemJade'), 'the hand additions survive the regeneration (Torch01 lights, BSKGemJade gems)');

console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
