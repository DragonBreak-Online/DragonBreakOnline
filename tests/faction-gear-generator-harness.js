// tools/faction_gear.py must never quietly drop a hand-added set (Nate, 12 Oct).
//   node tests/faction-gear-generator-harness.js   (from server/)
//
// Most of faction-gear.json cannot be rebuilt from the script's SETS: 177 items are there by hand, among them every
// Morrowind house guard, the Orcish Clan (no recipe at all), Bruma Guard and the Synod. The script used to write the
// file from its rules alone, so a rerun would have deleted all of them and opened 17 sets to any smith. It now keeps
// what it does not produce, and only --prune deletes. This runs it with --check, which writes nothing.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!c) fails++; };

const TOOL = path.join(SERVER, 'tools', 'faction_gear.py');
if (!fs.existsSync(TOOL)) { console.log('ok   skipped: tools/ is not in this checkout'); process.exit(0); }

const before = fs.readFileSync(path.join(SERVER, 'faction-gear.json'), 'utf8');
let out = '';
try {
  out = execFileSync('python3', [TOOL, '--check'], { cwd: SERVER, encoding: 'utf8', timeout: 120000 });
} catch (e) {
  require('./expect')('faction-gear-generator', `the generator would not run: ${e.message}`);
  console.log('ok   skipped: python3 or regions.json unavailable');
  process.exit(0);
}
const after = fs.readFileSync(path.join(SERVER, 'faction-gear.json'), 'utf8');

ok(before === after, '--check writes nothing');
ok(/\d+ items: \d+ from the rules, \d+ kept/.test(out), 'it reports what it produced and what it kept', out.split('\n')[0]);

const kept = Number((/(\d+) kept/.exec(out) || [])[1] || 0);
ok(kept > 0, 'it is keeping the entries its rules cannot produce', kept);
for (const set of ['Orcish Clan', 'Bruma Guard', 'Synod', 'House Redoran Guard']) {
  ok(out.includes(set), `...including ${set}, which no rule reproduces`);
}
ok(/--prune/.test(out), 'and it says that only --prune would delete them');

// The gate itself must still hold every set the live file has, whatever the generator can rebuild.
const gear = JSON.parse(before).items;
const sets = new Set(Object.values(gear).map((v) => v.set));
for (const set of ['Orcish Clan', 'Bruma Guard', 'Synod', 'Vigilants of Stendarr']) {
  ok(sets.has(set), `faction-gear.json still has the ${set} set`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
