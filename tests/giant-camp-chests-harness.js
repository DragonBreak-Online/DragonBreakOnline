// A giant camp excluded from dungeon claims (gamemode-config.json dungeons.exclude) is never filled by dungeons.js, so its
// big chest must be one of wildlife.js's per-player camp chests (wildlife.json giantCamps), or it stays empty for good.
// Guldun Rock's boss chest stands in its own cave, which ck-mcp/wildlife.py's exterior scan missed (#bugs 1560866913708539915).
//   node tests/giant-camp-chests-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const exclude = new Set((read('gamemode-config.json').dungeons || {}).exclude || []);
const camps = read('wildlife.json').giantCamps || [];
const campRefs = new Set(camps.flatMap((c) => (c.chests || []).map((ch) => String(ch.ref).toLowerCase())));
const raw = read('dungeons.json');
const locations = Array.isArray(raw) ? raw : (raw.dungeons || raw.locations || []);
ok(locations.length > 100, 'dungeons.json lists its locations', locations.length);

const giants = locations.filter((l) => (l.keywords || []).includes('LocTypeGiantCamp'));
const unfilled = giants.filter((l) => exclude.has(l.id))
  .filter((l) => (l.chests || []).some((ch) => ch.big && !campRefs.has(String(ch.ref).toLowerCase())))
  .map((l) => l.id);
ok(unfilled.length === 0, 'every giant camp kept out of claims has its big chest as a camp chest', unfilled);
ok(campRefs.has('b0d6f:skyrim.esm'), 'Guldun Rock\'s boss chest is a camp chest');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
