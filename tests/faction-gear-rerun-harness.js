// A rerun of tools/faction_gear.py changes nothing the file already decides (the Leader, 26 Oct).
//   node tests/faction-gear-rerun-harness.js   (from server/)
//
// faction-gear.json carries decisions the script's SETS do not: the Dawnguard makes Silver Hand silver (7851da06, 7 Oct),
// House Ravenwatch makes vampire gear (2cdf618d, 21 Oct), the Windhelm guard cloak is Windhelm's (57fc61ef, 5 Oct). An entry
// the run produced used to win, so a rerun quietly undid all 27. The merge now keeps a committed entry's name, set, factions
// and role and only adds recipes. This runs the real script on a copy (tools/, regions.json, faction-gear.json in a temp
// folder) and fails if the result differs from the committed file in any entry's name, set, factions or role, drops a
// recipe, drops an entry, or gates an item the file does not: each of those is a decision, not housekeeping.
// It also fails if the committed file lacks a recipe the run finds, so the file stays what a rerun would write.
// Fails, never skips, when no Python runs: a harness that cannot fail proves nothing.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 400)}`); if (!c) fails++; };

const python = ['python3', 'py', 'python'].find((p) => { const r = spawnSync(p, ['-c', 'print(1)'], { encoding: 'utf8' }); return r.status === 0 && r.stdout.trim() === '1'; });
ok(!!python, 'a Python runs here (python3, py or python)');
if (!python) process.exit(1);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-factiongear-'));
fs.mkdirSync(path.join(dir, 'tools'));
fs.copyFileSync(path.join(SERVER, 'tools', 'faction_gear.py'), path.join(dir, 'tools', 'faction_gear.py'));
for (const f of ['regions.json', 'faction-gear.json']) fs.copyFileSync(path.join(SERVER, f), path.join(dir, f));
const run = (args) => spawnSync(python, [path.join(dir, 'tools', 'faction_gear.py')].concat(args || []), { cwd: dir, encoding: 'utf8', timeout: 120000 });

const r = run([]);
ok(r.status === 0, 'the script runs on a copy', (r.stderr || '').slice(-400));
const committed = JSON.parse(fs.readFileSync(path.join(SERVER, 'faction-gear.json'), 'utf8')).items;
const rerun = JSON.parse(fs.readFileSync(path.join(dir, 'faction-gear.json'), 'utf8')).items;
const FIELDS = ['name', 'set', 'factions', 'role'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const fieldChanges = Object.keys(committed).filter((k) => rerun[k] && FIELDS.some((f) => !same(committed[k][f], rerun[k][f])));
ok(fieldChanges.length === 0, `a rerun keeps every committed entry's ${FIELDS.join(', ')}`, fieldChanges.map((k) => `${committed[k].name} [${k}]`));
const dropped = Object.keys(committed).filter((k) => !rerun[k]);
ok(dropped.length === 0, 'a rerun drops no entry', dropped);
const lostRecipe = Object.keys(committed).filter((k) => rerun[k] && (committed[k].recipes || []).some((x) => !(rerun[k].recipes || []).includes(x)));
ok(lostRecipe.length === 0, 'a rerun drops no recipe', lostRecipe);
const newlyGated = Object.keys(rerun).filter((k) => !committed[k]);
ok(newlyGated.length === 0, 'a rerun gates no item the file does not', newlyGated.map((k) => `${rerun[k].name} [${k}]`));
const behind = Object.keys(rerun).filter((k) => committed[k] && !same(committed[k].recipes || [], rerun[k].recipes || []));
ok(behind.length === 0, 'the committed file already lists every recipe a rerun finds', behind.map((k) => `${committed[k].name} [${k}]`));

// The three decisions by name, so a regression says what it undid
const has = (k, f) => (committed[k] && committed[k].factions || []).includes(f) && (rerun[k] && rerun[k].factions || []).includes(f);
ok(has('747dc:Immersive Weapons.esp', 'dawnguard'), 'the Dawnguard still makes Silver Hand silver (Silver Longsword)');
ok(has('142c7:Dawnguard.esm', 'house-ravenwatch'), 'House Ravenwatch still makes vampire gear (Vampire Armor)');
ok(has('2df7:Cloaks&Capes.esp', 'hold-windhelm') && rerun['2df7:Cloaks&Capes.esp'].name === 'Windhelm Guard Cloak', 'the Windhelm guard cloak is still Windhelm\'s');
ok(committed['6aa04:Hothtrooper44_ArmorCompilation.esp'].role === 'tailor', 'the Imperial Knight Cape, a loom recipe, is tailor work (was blacksmith until 26 Oct)');

// --rules-win still lets the SETS win, and says so
fs.copyFileSync(path.join(SERVER, 'faction-gear.json'), path.join(dir, 'faction-gear.json'));
const w = run(['--rules-win', '--check']);
ok(w.status === 0 && /SETS disagree with the file \(the rules won: --rules-win\)/.test(w.stdout), '--rules-win reports the entries where the SETS disagree', w.stdout.split('\n').filter((l) => /disagree/.test(l)));

fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
