// Scripted test for a city gate taken for a house (24 Oct, #bugs "LEWIN IS TAKING OVER THE WORLD"). Solitude's gate 101d9d
// joins SolitudeWorld to Tamriel, a worldspace on both sides. At the 21 Oct 03:30 boot the place migration planned it as a
// "house" whose interior was the far side, Tamriel ("place plan: ... house 101d9d cells=3c:Skyrim.esm"), and applied it:
// every unclaimed door and chest in the open world read as its owner's (the Whiterun gate, Winterhold College, Blackreach's
// door) until he gave the gate up. A door between two worldspaces is no way into a building, and no place is ever indexed
// under a worldspace. Bundles housingPlaces.ts and housingSystem.ts with esbuild on a fake mp.
//
//   node tests/housing-gate-place-harness.js            (HOUSING_ROOT=<another skymp5-server> tests that tree instead)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(process.env.HOUSING_ROOT || path.join(__dirname, '..'));
const esbuild = require(path.join(__dirname, '..', 'node_modules', 'esbuild'));
const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
const out = fs.mkdtempSync(path.join(base, 'claude-nate-gateplace-'));
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  for (const f of ['housingPlaces', 'housingSystem']) {
    await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', `${f}.ts`)], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, `${f}.js`), logLevel: 'error' });
  }
  const { planPlaces } = require(path.join(out, 'housingPlaces.js'));
  const { HousingSystem } = require(path.join(out, 'housingSystem.js'));
  const src = fs.readFileSync(path.join(out, 'housingSystem.js'), 'utf8');
  const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(src) || [])[1];

  const TAMRIEL = '3c:Skyrim.esm', SOLITUDE = '37edf:Skyrim.esm', HOUSE_CELL = '1234:Skyrim.esm';
  const WORLDS = new Set([TAMRIEL, SOLITUDE]);
  const isWorld = (d) => WORLDS.has(d);
  const GATE = 0x101d9d, HOUSE_DOOR = 0x2000, CHEST = 0x3000, OWNER = 91;
  const claim = (ref, door, cell, partnerCell) => ({ ref, owner: OWNER, ownerName: 'Jarl Lewin Ashcroft', name: null, locked: false, door, cell, partnerCell });

  // The planner: the gate is no house, a real house still is
  const gate = claim(GATE, true, SOLITUDE, TAMRIEL), house = claim(HOUSE_DOOR, true, TAMRIEL, HOUSE_CELL);
  const plan = planPlaces([gate, house], isWorld, 5);
  const g = plan.places.find((p) => p.root === GATE), h = plan.places.find((p) => p.root === HOUSE_DOOR);
  check('a city gate (a worldspace on both sides) is not planned as a house', !!g && g.kind !== 'house', g);
  check('...and no planned place lists a worldspace as a cell', plan.places.every((p) => p.cells.every((c) => !isWorld(c))), plan.places.map((p) => [p.root.toString(16), p.cells]));
  check('a door from the world into an interior is still a house, with its interior as its cell', !!h && h.kind === 'house' && h.cells.join() === HOUSE_CELL, h);

  // The system, on a fake mp
  const props = new Map();
  const cellOf = new Map([[GATE, SOLITUDE], [HOUSE_DOOR, TAMRIEL], [CHEST, TAMRIEL]]);
  const mp = {
    get: (id, key) => {
      if (key === 'worldOrCellDesc') return cellOf.get(id >>> 0) || '';
      const v = props.get(`${id >>> 0}:${key}`); return v === undefined ? undefined : JSON.parse(v);
    },
    set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
    getActorsByProfileId: () => [], getUserByActor: () => -1, getUserActor: () => 0, isConnected: () => false, sendCustomPacket: () => { },
    getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
    lookupEspmRecordById: (id) => ([0x3c, 0x37edf].includes(id >>> 0) ? { record: { type: 'WRLD' } } : { record: { type: 'CELL' } }),
  };
  const ctx = { svr: mp };
  const cwd = process.cwd(); process.chdir(out);
  const make = (claimed) => {
    const sys = new HousingSystem(() => { });
    sys.holdOf = () => null; sys.isAdmin = () => false; sys.holdRanks = () => []; sys.saveRegistry = () => { }; sys.placeGrants = () => [];
    sys.partnerOf = (ctx2, ref) => (ref === GATE ? 0x101d9e : ref === HOUSE_DOOR ? 0x2001 : 0);
    sys.claimed = claimed; sys.perCharacter = true;
    return sys;
  };
  try {
    // The interior a planned house is refined from: none for the gate, so nothing is applied to it
    const sys = make([GATE]);
    mp.set(GATE, HP, { owner: OWNER, ownerName: 'Jarl Lewin Ashcroft', name: null, locked: false, serial: 1, partner: 0x101d9e, containers: [], issued: [] });
    const forced = [{ owner: OWNER, ownerName: 'Jarl Lewin Ashcroft', root: GATE, name: null, kind: 'house', cells: [], members: [], openChests: [] }];
    const details = sys.refinePlaces(ctx, forced, [gate]);
    const d = details.get(GATE);
    check('refining a gate planned as a house finds no interior and applies nothing', !!d && !!d.notApplied && d.cells.length === 0, d && { notApplied: d.notApplied, cells: d.cells });

    // A record the 21 Oct migration already wrote, with Tamriel as its place's cell: never indexed under Tamriel
    mp.set(GATE, HP, { owner: OWNER, ownerName: 'Jarl Lewin Ashcroft', name: null, locked: false, serial: 1, partner: 0x101d9e, containers: [], issued: [], place: { cells: [TAMRIEL], builtAt: 1 } });
    const sys2 = make([GATE]);
    check('a stored place listing a worldspace is not indexed under it', !sys2.placeIndex(ctx).has(TAMRIEL), [...sys2.placeIndex(ctx).keys()]);
    check('...so an unclaimed chest in the open world belongs to no place', sys2.placeAt(ctx, CHEST) === null, sys2.placeAt(ctx, CHEST));
    // A real house's interior is still indexed
    mp.set(HOUSE_DOOR, HP, { owner: OWNER, ownerName: 'Jarl Lewin Ashcroft', name: null, locked: false, serial: 1, partner: 0x2001, containers: [], issued: [], place: { cells: [HOUSE_CELL], builtAt: 1 } });
    const sys3 = make([HOUSE_DOOR]);
    check('a house\'s interior cell is still indexed', sys3.placeIndex(ctx).get(HOUSE_CELL) === HOUSE_DOOR, [...sys3.placeIndex(ctx)]);
  } finally {
    process.chdir(cwd);
    fs.rmSync(out, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
