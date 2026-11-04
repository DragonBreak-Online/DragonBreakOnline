// Basic spell scrolls drop across Tamriel (Nat, 4 Nov: "basic scrolls everywhere"). Skyrim dungeons dropped only
// Conjuration (par.lar, #bugs 1 Nov): the 25 Oct lore rule put every Destruction, Restoration and Illusion scroll in
// Cyrodiil. The novice and apprentice ones (value 30 and 60, tome rank 0 and 1) now carry no province in loot.json and
// are 'common' in regions-overrides.json; every other scroll keeps its province. dungeons.js's own province test
// (hasProv) is read out of its source, so the check is the one the dungeons run.
//   node tests/loot-scrolls-basic-harness.js        (from server/; env LOOT_JSON / OVERRIDES_JSON / BASE_LOOT_JSON to point elsewhere)
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!ok) fails++; };

const read = (env, file) => JSON.parse(fs.readFileSync(process.env[env] || path.join(SERVER, file), 'utf8'));
const loot = read('LOOT_JSON', 'loot.json');
const ovr = read('OVERRIDES_JSON', 'regions-overrides.json');
// dungeons.js: const hasProv = (it, prov) => ...
const src = fs.readFileSync(path.join(SERVER, 'dungeons.js'), 'utf8');
const m = /const hasProv = (\(it, prov\) => [^;]+);/.exec(src);
check('dungeons.js still has its province test', !!m);
const hasProv = m ? eval(m[1]) : () => false;

const scrolls = loot.pools.scrolls;
const schoolOf = (it) => (/^UDLC01_([A-Z]+)_/.exec(it.name) || [])[1] || '';
const BASIC_SCHOOLS = ['DES', 'RES', 'ILLU'];
const basic = (it) => BASIC_SCHOOLS.includes(schoolOf(it)) && it.value <= 60;

const skyrim = scrolls.filter((it) => hasProv(it, 'skyrim'));
for (const s of BASIC_SCHOOLS) {
  check(`a Skyrim dungeon's scroll pool has ${s} scrolls`, skyrim.some((it) => schoolOf(it) === s), skyrim.map((it) => it.name));
}
check('...only novice and apprentice ones of those schools', skyrim.filter((it) => BASIC_SCHOOLS.includes(schoolOf(it))).every((it) => it.value <= 60),
  skyrim.filter((it) => BASIC_SCHOOLS.includes(schoolOf(it)) && it.value > 60).map((it) => it.name));
check('every basic one drops in every province', scrolls.filter(basic).every((it) => ['skyrim', 'cyrodiil', 'solstheim'].every((p) => hasProv(it, p))) && scrolls.filter(basic).length === 19,
  scrolls.filter(basic).filter((it) => it.p).map((it) => it.name));

// Everything else exactly as the 25 Oct rule left it
let base = null;
try { base = process.env.BASE_LOOT_JSON ? JSON.parse(fs.readFileSync(process.env.BASE_LOOT_JSON, 'utf8')) : JSON.parse(execSync('git show origin/server:loot.json', { cwd: SERVER, maxBuffer: 64 << 20 }).toString()); } catch (e) { base = null; }
if (!base) {
  console.log('SKIP  the comparison with origin/server (no git; set BASE_LOOT_JSON)');
} else {
  const before = new Map(base.pools.scrolls.map((it) => [it.name, JSON.stringify(it.p || null)]));
  const moved = scrolls.filter((it) => !basic(it) && before.get(it.name) !== JSON.stringify(it.p || null)).map((it) => it.name);
  check('every other scroll keeps its province (higher tiers, Conjuration, the Volkihar arts)', moved.length === 0 && scrolls.length === base.pools.scrolls.length, moved);
  const conj = (pool, p) => pool.filter((it) => schoolOf(it) === 'CONJ' && hasProv(it, p)).length;
  check('Conjuration is where it was: Skyrim and Cyrodiil counts unchanged', conj(scrolls, 'skyrim') === conj(base.pools.scrolls, 'skyrim') && conj(scrolls, 'cyrodiil') === conj(base.pools.scrolls, 'cyrodiil'),
    [conj(scrolls, 'skyrim'), conj(base.pools.scrolls, 'skyrim')]);
}

// The hand rules agree, so a regeneration (ck-mcp loot.py) keeps it
const items = ovr.items || {};
check('regions-overrides marks each basic scroll common', scrolls.filter(basic).every((it) => items[it.name] === 'common'), scrolls.filter(basic).filter((it) => items[it.name] !== 'common').map((it) => it.name));
check('...and no higher one', scrolls.filter((it) => !basic(it)).every((it) => items[it.name] !== 'common'));

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
