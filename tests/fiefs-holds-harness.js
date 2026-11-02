// nobility-fiefs.json against the real hold borders: every exterior cell of a Skyrim fief must lie in the hold that
// fief answers to, or a Jarl is granting land that is not theirs. Also the invariants that make "which fief is this
// reference in" answerable at all. Mutants at the end must each break a check.
//   node tests/fiefs-holds-harness.js   (from server/)
//
// hold-cells.json is Worker 6's and lives outside this repo (it is Bethesda-derived cell data, kept private), so the
// border checks SKIP when it is absent rather than passing. The structural checks always run.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIEFS_FILE = path.join(ROOT, 'nobility-fiefs.json');
// where the staged borders sit on the PC; absent on CT115 and in a fresh clone
// ROOT is server/, which in a git worktree is two levels under the project root, not one: the generator hit the
// same trap and loaded no plugins at all. So try both depths, and let DBO_HOLD_CELLS override.
const HOLD_CELLS = [
  process.env.DBO_HOLD_CELLS,
  ...['..', path.join('..', '..'), path.join('..', '..', '..')].flatMap((up) => [
    path.resolve(ROOT, up, '_notes-to-server', 'staged-20261101-real-borders', 'server-private', 'hold-cells.json'),
    path.resolve(ROOT, up, '_work', 'map-borders', 'tools', 'hold-cells.json'),
  ]),
].filter(Boolean).find((p) => fs.existsSync(p));

let fails = 0, skips = 0;
const ok = (what, cond, got) => {
  if (cond) { console.log(`ok    ${what}`); return true; }
  fails++;
  console.log(`FAIL  ${what}${got === undefined ? '' : `   ${JSON.stringify(got)}`}`);
  return false;
};
const skip = (what, why) => { skips++; console.log(`skip  ${what} (${why})`); };

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const TAMRIEL = '3c:skyrim.esm';
// the nine Skyrim holds by their capital, as hold-cells.json and nobility.js both name them
const SKYRIM_HOLDS = ['whiterun', 'riften', 'solitude', 'windhelm', 'markarth', 'falkreath', 'morthal', 'dawnstar', 'winterhold'];
// a capital is a seat, never a grantable fief
const CAPITAL_LOCS = ['WhiterunLocation', 'RiftenLocation', 'SolitudeLocation', 'WindhelmLocation', 'MarkarthLocation',
  'FalkreathLocation', 'MorthalLocation', 'DawnstarLocation', 'WinterholdLocation'];

// ---- the checks, as a function so a mutant can be run through them ----------------------------------------------------
const checks = (doc, quiet) => {
  const say = quiet ? (w, c) => !!c : ok;
  const F = Array.isArray(doc.fiefs) ? doc.fiefs : [];
  const r = [];
  r.push(say('the file holds fiefs', F.length > 0));
  r.push(say('every fief has an id, name, hold, world, grid and buildings',
    F.every((f) => f.id && f.name && f.hold && f.world && Array.isArray(f.grid) && Array.isArray(f.buildings))));
  r.push(say('fief ids are unique', new Set(F.map((f) => f.id)).size === F.length));
  r.push(say('every fief has at least one exterior cell', F.every((f) => f.grid.length > 0),
    F.filter((f) => !f.grid.length).map((f) => f.id)));
  r.push(say('every fief has at least one building, or it cannot be stewarded', F.every((f) => f.buildings.length > 0),
    F.filter((f) => !f.buildings.length).map((f) => f.id)));
  r.push(say('no capital is a fief', !F.some((f) => CAPITAL_LOCS.includes(f.edid)),
    F.filter((f) => CAPITAL_LOCS.includes(f.edid)).map((f) => f.id)));
  r.push(say('no two fiefs claim the same cell in the same world', (() => {
    const seen = new Set();
    for (const f of F) for (const g of f.grid) { const k = `${f.world}|${g[0]},${g[1]}`; if (seen.has(k)) return false; seen.add(k); }
    return true;
  })()));
  const sky = F.filter((f) => String(f.world).toLowerCase() === TAMRIEL);
  r.push(say('every Tamriel fief answers to one of the nine Skyrim holds',
    sky.every((f) => SKYRIM_HOLDS.includes(f.hold)), sky.filter((f) => !SKYRIM_HOLDS.includes(f.hold)).map((f) => [f.id, f.hold])));
  r.push(say('Winterhold has no fief on purpose (the Great Collapse left it no villages)',
    !F.some((f) => f.hold === 'winterhold'), F.filter((f) => f.hold === 'winterhold').map((f) => f.id)));
  r.push(say('every other Skyrim hold has at least one',
    SKYRIM_HOLDS.filter((h) => h !== 'winterhold').every((h) => F.some((f) => f.hold === h)),
    SKYRIM_HOLDS.filter((h) => h !== 'winterhold' && !F.some((f) => f.hold === h))));
  return { r, sky };
};

const doc = read(FIEFS_FILE);
const { sky } = checks(doc, false);

// ---- the borders -------------------------------------------------------------------------------------------------------
const borderCheck = (doc2, quiet) => {
  if (!HOLD_CELLS) return null;
  const H = read(HOLD_CELLS);
  const say = quiet ? (w, c) => !!c : ok;
  const out = [];
  out.push(say('hold-cells.json is for Tamriel', String(H.world).toLowerCase() === TAMRIEL, H.world));
  // rows are written north first (hold_cells.py: gy = C0 + N - 1 - j), so the row index is (c0+n-1) - y.
  // Reading it as y - c0 agrees with the plugins for only 21 of 57 towns, which is how this was caught.
  const at = (x, y) => {
    const row = H.c0 + H.n - 1 - y, col = x - H.c0;
    if (row < 0 || row >= H.n || col < 0 || col >= H.n) return null;
    const ch = H.rows[row][col];
    return /[0-9]/.test(ch) && Number(ch) < H.holds.length ? H.holds[Number(ch)] : null;
  };
  out.push(say('the grid decodes: Whiterun city sits in whiterun', at(5, -1) === 'whiterun', at(5, -1)));
  const bad = [];
  for (const f of (Array.isArray(doc2.fiefs) ? doc2.fiefs : []).filter((f) => String(f.world).toLowerCase() === TAMRIEL)) {
    for (const g of f.grid) {
      const h = at(g[0], g[1]);
      if (h && h !== f.hold) bad.push([f.id, g, f.hold, h]);
    }
  }
  out.push(say('every cell of every Skyrim fief lies in the hold that fief answers to', bad.length === 0, bad.slice(0, 4)));
  return out;
};

if (!HOLD_CELLS) {
  skip('the hold-border checks', 'hold-cells.json is not on this box; it is staged outside the repo');
} else {
  console.log(`      (borders read from ${path.basename(HOLD_CELLS)})`);
  borderCheck(doc, false);
}

// ---- mutants -----------------------------------------------------------------------------------------------------------
// Each must break at least one check above. A mutant nothing catches means the checks are decoration.
const MUTANTS = [
  ['a fief in a hold it does not border', (d) => { d.fiefs.find((f) => f.id === 'riverwood').hold = 'riften'; }],
  ['Winterhold given a fief after all', (d) => { d.fiefs.find((f) => f.id === 'stonehills').hold = 'winterhold'; }],
  ['a hold left with no fief', (d) => { d.fiefs = d.fiefs.filter((f) => f.hold !== 'morthal'); }],
  ['two fiefs claiming one cell', (d) => { d.fiefs.find((f) => f.id === 'rorikstead').grid.push(d.fiefs.find((f) => f.id === 'riverwood').grid[0]); }],
  ['a fief with no buildings', (d) => { d.fiefs.find((f) => f.id === 'ivarstead').buildings = []; }],
  ['a fief with no cells', (d) => { d.fiefs.find((f) => f.id === 'karthwasten').grid = []; }],
  ['a capital made a fief', (d) => { d.fiefs.find((f) => f.id === 'riverwood').edid = 'WhiterunLocation'; }],
  ['duplicate fief ids', (d) => { d.fiefs.find((f) => f.id === 'ivarstead').id = 'riverwood'; }],
  ['a Tamriel fief answering to a Cyrodiil county', (d) => { d.fiefs.find((f) => f.id === 'kynesgrove').hold = 'bruma'; }],
];
console.log('');
for (const [what, mutate] of MUTANTS) {
  const d = read(FIEFS_FILE);
  mutate(d);
  let caught = false;
  try {
    const { r } = checks(d, true);
    const b = borderCheck(d, true) || [];
    caught = r.concat(b).some((x) => !x);
  } catch (e) { caught = true; }
  ok(`mutant caught: ${what}`, caught);
}

console.log('');
if (skips) console.log(`${skips} check group skipped`);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
