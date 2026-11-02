// Scripted test for the place walk past its cell cap (fac-0498, 28 Oct: the Palace of Kings). The palace's own building is a
// "dungeon, large" one in buildings.json (Windhelm's sewers join it through DragonBreak.esp's cellar), so placeCellsFrom
// walks it. The walk passed MAX_PLACE_CELLS in the sewers and kept the hall alone: the two upstairs cells, their bedroom
// doors and 34 chests could not be locked or assigned. Now the rooms that are closed pockets behind the hall join; the
// Bloodworks (its own street door) and the cellar (on into the sewers) stay out. Bundles housingSystem.ts with esbuild and
// gives it the palace's doors on a stub.
//
//   node tests/housing-palace-walk-harness.js        (HOUSING_ROOT=<another skymp5-server> tests that tree instead)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(process.env.HOUSING_ROOT || path.join(__dirname, '..'));
const esbuild = require(path.join(__dirname, '..', 'node_modules', 'esbuild'));
const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
const out = fs.mkdtempSync(path.join(base, 'claude-nate-palacewalk-'));
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'housingSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'housing.js'), logLevel: 'error' });
  const { HousingSystem } = require(path.join(out, 'housing.js'));
  const sys = new HousingSystem(() => { });
  const ctx = { svr: {} };
  const WORLD = 'world';
  // cell -> [[door ref, far cell]]; the palace's doors as the live load order has them (2 Nov)
  let map = {};
  const held = new Set();
  sys.doorsOut = (_c, cell) => (map[cell] || []).map(([ref, farCell]) => ({ ref, far: ref + 1, farCell }));
  sys.isWorldDesc = (_c, cell) => cell === WORLD;
  sys.buildingOf = () => null;
  sys.primaryOf = (_c, ref) => ref;
  sys.read = (_c, ref) => (held.has(ref) ? { owner: 99 } : null);
  sys.sameOwner = (r, o) => r.owner === o.owner;
  const walk = (inner) => sys.placeCellsFrom(ctx, inner, { owner: 70 });
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

  const HALL = 'hall', BLOOD = 'bloodworks', UP1 = 'upstairs1', UP2 = 'upstairs2', CELLAR = 'cellar';
  const palace = () => ({
    [HALL]: [[1, WORLD], [2, WORLD], [3, BLOOD], [4, UP1], [5, UP2], [6, CELLAR]],
    [BLOOD]: [[7, HALL], [8, WORLD]],
    [UP1]: [[9, HALL]],
    [UP2]: [[10, HALL]],
    [CELLAR]: [[11, HALL], [12, 'sewer1']],
    sewer1: [[13, CELLAR], [14, 'sewer2'], [15, 'sewer4']],
    sewer2: [[16, 'sewer1'], [17, 'sewer3']],
    sewer3: [[18, 'sewer2'], [19, WORLD]],
    sewer4: [[20, 'sewer1']],
  });
  map = palace();
  const got = walk(HALL);
  check('the palace is its hall and both upstairs cells', same(got, [HALL, UP1, UP2]), got);
  check('...not the Bloodworks, which has its own door to the street', !got.includes(BLOOD), got);
  check('...nor the cellar, which leads on into the sewers', !got.includes(CELLAR) && !got.some((c) => c.startsWith('sewer')), got);

  // A small house under the cap walks exactly as before
  map = { h: [[1, WORLD], [2, 'a']], a: [[3, 'h'], [4, 'b']], b: [[5, 'a']] };
  check('a house of three rooms under the cap is whole', same(walk('h'), ['h', 'a', 'b']), walk('h'));

  // Past the cap, a closed pocket of two rooms joins whole
  map = palace(); map[UP1] = [[9, HALL], [21, 'study']]; map.study = [[22, UP1]];
  const two = walk(HALL);
  check('a closed pocket two rooms deep joins whole', same(two, [HALL, UP1, 'study', UP2].slice(0, 4)) && two.length <= 4, two);

  // A pocket with a door someone else holds stays out
  map = palace(); held.add(10);
  check('a room behind a door someone else holds stays out', same(walk(HALL), [HALL, UP1]), walk(HALL));
  held.clear();
  map = palace(); map[UP2] = [[10, HALL], [23, 'guestroom']]; map.guestroom = [[24, UP2]]; held.add(24);
  check('...and so does a pocket with such a door anywhere in it', same(walk(HALL), [HALL, UP1]), walk(HALL));
  held.clear();

  // Never more than the cap
  map = palace();
  for (let i = 0; i < 6; i++) { map[HALL].push([100 + i, `room${i}`]); map[`room${i}`] = [[200 + i, HALL]]; }
  check('never more than MAX_PLACE_CELLS cells', walk(HALL).length <= 4 && walk(HALL)[0] === HALL, walk(HALL));

  // ---- widenPlaces: a place already built from its hall alone widens at the next boot plan ----
  process.chdir(out);
  const recs = new Map();
  const logs = [];
  const wsys = new HousingSystem((m) => logs.push(String(m)));
  const wctx = { svr: { get: (ref, k) => (k === 'housing' || /housing/i.test(k) ? recs.get(ref) || null : null) } };
  wsys.read = (_c, ref) => (recs.has(ref) ? JSON.parse(JSON.stringify(recs.get(ref))) : null);
  wsys.write = (_c, ref, rec) => { recs.set(ref, JSON.parse(JSON.stringify(rec))); return true; };
  wsys.sameOwner = (r, o) => r.owner === o.owner;
  const homes = [];
  wsys.markHomeCells = (p) => homes.push(p);
  const ROOT = 0xc0e2c, UPCHEST = 0x9001, OTHERS = 0x9002, SMALL = 0x7000;
  const reset = () => {
    recs.clear(); logs.length = 0; homes.length = 0;
    recs.set(ROOT, { owner: 70, ownerName: 'Jarl Ysra', name: 'The Gilded Palace', place: { cells: [HALL], builtAt: 5 } });
    recs.set(UPCHEST, { owner: 70, ownerName: 'Jarl Ysra', name: null });
    recs.set(OTHERS, { owner: 71, ownerName: 'Someone', name: null });
    recs.set(SMALL, { owner: 72, ownerName: 'Two Rooms', name: null, place: { cells: ['h', 'a'], builtAt: 5 } });
  };
  const detail = (root, owner, cells, members, notApplied = '') => ({ root, owner, cells, members, outside: [], skippedCells: [], openChests: [], entrances: [], unclaimedChests: [], innerDoors: [], notApplied });
  const plan = () => new Map([
    [ROOT, detail(ROOT, 70, [HALL, UP1, UP2], [UPCHEST, OTHERS])],
    [SMALL, detail(SMALL, 72, ['h', 'a', 'b'], [])],
  ]);

  reset(); wsys.placeMigration = 'dryrun'; wsys.widenPlaces(wctx, plan());
  check('dry run: the palace would widen, and nothing is written', recs.get(ROOT).place.cells.join() === HALL && logs.some((l) => /c0e2c "The Gilded Palace" would widen by upstairs1,upstairs2/.test(l)), logs);
  reset(); wsys.placeMigration = 'apply'; wsys.widenPlaces(wctx, plan());
  check('apply: the palace now holds its hall and both upstairs cells', recs.get(ROOT).place.cells.join() === [HALL, UP1, UP2].join() && recs.get(ROOT).place.builtAt === 5, recs.get(ROOT));
  check('...the owner\'s own claim there joins it, another owner\'s does not', recs.get(UPCHEST).memberOf === ROOT && !recs.get(OTHERS).memberOf, [recs.get(UPCHEST), recs.get(OTHERS)]);
  check('...the owner\'s home cells are sent again, and it is logged with its backup', homes.includes(70) && logs.some((l) => /place widened: .* c0e2c .* \+ upstairs1,upstairs2, 1 own claim\(s\) joined; backup .*widen-/.test(l)), logs);
  check('...a backup of the old records is written first', fs.readdirSync(out).some((f) => /^housing-places-backup-widen-.*\.json$/.test(f)));
  check('a place built from two cells is left as it is', recs.get(SMALL).place.cells.join() === 'h,a', recs.get(SMALL));
  reset(); wsys.widenPlaces(wctx, new Map([[ROOT, detail(ROOT, 70, [HALL, UP1], [], 'its interior is shared with another owner\'s place')]]));
  check('a place the plan does not apply is left as it is', recs.get(ROOT).place.cells.join() === HALL);
  reset(); recs.get(ROOT).owner = 99; wsys.widenPlaces(wctx, plan());
  check('...and one whose owner has changed since the plan', recs.get(ROOT).place.cells.join() === HALL);
  reset(); wsys.widenPlaces(wctx, new Map([[ROOT, detail(ROOT, 70, [HALL], [])]]));
  check('nothing to add: nothing written, no backup', logs.length === 0);

  console.log(failures ? `\n${failures} failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed', e); process.exit(1); });
