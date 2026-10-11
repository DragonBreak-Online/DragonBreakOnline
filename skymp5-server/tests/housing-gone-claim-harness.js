// Scripted test for a claim whose reference the load order no longer has (11 Oct: the DLE update deleted the Frost-Iron
// Mine door 80d9643, and "[housing] owner migration NOT applied: 1 of 299 claims are still unreadable" held every other
// claim back). A reference that throws "doesn't exist" is left out of the owner and place plans; a record that reads as
// null (not loaded yet after boot) still makes both plans wait. Bundles housingSystem.ts with esbuild on a fake mp.
//
//   node tests/housing-gone-claim-harness.js            (HOUSING_ROOT=<another skymp5-server> tests that tree instead)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(process.env.HOUSING_ROOT || path.join(__dirname, '..'));
const esbuild = require(path.join(__dirname, '..', 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-goneclaim-'));
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'housingSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'housing.js'), logLevel: 'error' });
  const { HousingSystem } = require(path.join(out, 'housing.js'));
  const src = fs.readFileSync(path.join(out, 'housing.js'), 'utf8');
  const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(src) || [])[1];

  const A = 0x08000101, B = 0x08000102, GONE = 0x080d9643, UNLOADED = 0x08000103;
  const ACTOR = 0xff000f7f, PROFILE = 49;
  const props = new Map();
  const mp = {
    get: (id, key) => {
      if ((id >>> 0) === GONE) throw new Error(`Form with id 0x${GONE.toString(16)} doesn't exist`);
      if (key === 'profileId') return id === ACTOR ? PROFILE : 0;
      const v = props.get(`${id >>> 0}:${key}`); return v === undefined ? undefined : JSON.parse(v);
    },
    set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
    getActorsByProfileId: (p) => (p === PROFILE ? [ACTOR] : []),
    getUserByActor: () => -1,
    getUserActor: () => 0,
    isConnected: () => false,
    sendCustomPacket: () => { },
    getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
    lookupEspmRecordById: () => null,
  };
  mp.set(ACTOR, 'private.charSlot', 0);
  mp.set(ACTOR, 'appearance', { name: 'Lord Elion' });
  const record = (name) => ({ owner: PROFILE, ownerName: 'Lord Elion', name, locked: true, serial: 1, partner: 0, containers: [], issued: [] });
  mp.set(A, HP, record('House'));
  mp.set(B, HP, record('Shop'));
  const ctx = { svr: mp };

  const cwd = process.cwd(); process.chdir(out);
  const logs = [];
  const make = (claimed) => {
    const sys = new HousingSystem((m) => logs.push(String(m)));
    sys.holdOf = () => null; sys.isAdmin = () => false; sys.holdRanks = () => []; sys.partnerOf = () => 0; sys.saveRegistry = () => { };
    sys.cellDescOf = () => ''; sys.isWorldDesc = () => false; sys.placeGrants = () => [];
    sys.claimed = claimed;
    sys.ownerMigration = 'apply'; sys.placeMigration = 'apply'; sys.perCharacter = true;
    sys.applied = { owners: 0, places: 0 };
    sys.applyOwners = () => { sys.applied.owners++; };
    sys.applyPlaces = () => { sys.applied.places++; };
    return sys;
  };

  try {
    // A deleted reference: the plans go ahead without it, on the first try
    let sys = make([A, GONE, B]);
    logs.length = 0;
    const ownersDone = sys.dryRunOwners(ctx, false);
    check('owner plan completes on the first try with a deleted claim in the registry', ownersDone === true, ownersDone);
    check('...and applies', sys.applied.owners === 1, sys.applied);
    check('...without "NOT applied"', !logs.some((l) => /owner migration NOT applied/.test(l)), logs.filter((l) => /NOT applied/.test(l)));
    check('...naming the deleted claim in the log', logs.some((l) => /80d9643/.test(l) && /no longer has/.test(l)), logs.filter((l) => /owner plan \(/.test(l)));
    const ownerPlan = JSON.parse(fs.readFileSync(path.join(out, 'housing-owners-plan.json'), 'utf8'));
    check('...and in the plan file, apart from the unreadable', (ownerPlan.gone || []).includes('80d9643') && ownerPlan.unreadable.length === 0, { gone: ownerPlan.gone, unreadable: ownerPlan.unreadable });

    logs.length = 0;
    const placesDone = sys.dryRunPlaces(ctx, false);
    check('place plan completes on the first try with a deleted claim', placesDone === true, placesDone);
    check('...and applies', sys.applied.places === 1, sys.applied);

    // A record not loaded yet (null read) still makes both plans wait, and the last try still applies nothing
    sys = make([A, UNLOADED, B]);
    check('owner plan still waits while a record reads as null', sys.dryRunOwners(ctx, false) === false);
    check('place plan still waits while a record reads as null', sys.dryRunPlaces(ctx, false) === false);
    logs.length = 0;
    sys.dryRunOwners(ctx, true); sys.dryRunPlaces(ctx, true);
    check('...and on the last try applies nothing', sys.applied.owners === 0 && sys.applied.places === 0, sys.applied);
    check('...saying so', logs.some((l) => /owner migration NOT applied/.test(l)) && logs.some((l) => /place migration NOT applied/.test(l)));

    // Both at once: the unloaded one still holds the plans back
    sys = make([A, GONE, UNLOADED]);
    check('a deleted and an unloaded claim together: still waits', sys.dryRunOwners(ctx, false) === false && sys.dryRunPlaces(ctx, false) === false);
  } finally {
    process.chdir(cwd);
    fs.rmSync(out, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
