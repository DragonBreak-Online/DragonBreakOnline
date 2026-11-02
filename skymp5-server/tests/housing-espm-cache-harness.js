// Scripted test for housing's espm cache across boots (1 Nov: right after a boot, resolving a hall door's claim loaded the
// interior behind each door, 26 s on dev). An unclaimed exterior door answers with its place's root through its teleport
// partner's cell; the first boot pays that partner's load once and saves what it learned; the next boot of the same load
// order reads it from housing-espm-cache.json and loads no interior; another load order starts empty. It bundles
// housingSystem.ts with esbuild and runs it on a fake mp. Run it from skymp5-server with node_modules present
// (DECOR_SRC=<file> tests another copy of the system):
//
//   node tests/housing-espm-cache-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-espmc-'));
const bundle = path.join(out, 'housing.js');
const src = process.env.DECOR_SRC ? path.resolve(process.env.DECOR_SRC) : path.join(root, 'ts', 'systems', 'housingSystem.ts');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  const entry = src.startsWith(path.join(root, 'ts')) ? src : path.join(root, 'ts', 'systems', '__espmc_src.ts');
  if (entry !== src) fs.copyFileSync(src, entry);
  try {
    await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error' });
  } finally { if (entry !== src) fs.unlinkSync(entry); }
  const { HousingSystem } = require(bundle);
  const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(fs.readFileSync(bundle, 'utf8')) || [])[1];

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-espmc-cwd-'));
  const cwd = process.cwd(); process.chdir(work);
  let now = 1e9;
  const realNow = Date.now;
  Date.now = () => now;

  // The world: a house (place root R inside cell "house"), its exterior door D (no claim of its own) whose teleport partner
  // P stands inside the house. Every first touch of P is the native load of the interior
  const R = 0x08000100, D = 0x08000200, P = 0x08000201, DOOR_BASE = 0x00000400;
  const cellOf = { [R]: 'house:Test.esp', [D]: 'world:Test.esp', [P]: 'house:Test.esp' };
  const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const espm = {
    [D]: { record: { type: 'REFR', fields: [{ type: 'NAME', data: u32(DOOR_BASE) }, { type: 'XTEL', data: u32(P) }] }, toGlobalRecordId: (x) => x >>> 0 },
    [P]: { record: { type: 'REFR', fields: [{ type: 'NAME', data: u32(DOOR_BASE) }, { type: 'XTEL', data: u32(D) }] }, toGlobalRecordId: (x) => x >>> 0 },
    [DOOR_BASE]: { record: { type: 'DOOR', fields: [] }, toGlobalRecordId: (x) => x >>> 0 },
  };
  const boot = (loadOrder) => {
    const props = new Map([[`${R}:${HP}`, JSON.stringify({ owner: 9, ownerName: 'X', name: 'House', locked: true, serial: 1, partner: 0, containers: [], issued: [], place: { cells: ['house:Test.esp'], builtAt: 1 } })]]);
    const loaded = new Set();
    const stats = { interiorLoads: 0 };
    const mp = {
      get: (id, key) => {
        if ((id >>> 0) === P && !loaded.has(P)) { loaded.add(P); stats.interiorLoads++; now += 2000; }
        if (key === 'worldOrCellDesc') return cellOf[id >>> 0] || '';
        const v = props.get(`${id >>> 0}:${key}`);
        return v === undefined ? undefined : JSON.parse(v);
      },
      set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
      lookupEspmRecordById: (id) => espm[id >>> 0] || null,
      getUserByActor: () => -1, getUserActor: () => 0, isConnected: () => false, sendCustomPacket: () => { },
    };
    const logs = [];
    const sys = new HousingSystem((...a) => logs.push(a.join(' ')));
    sys.holdOf = () => null; sys.isAdmin = () => false; sys.holdRanks = () => []; sys.saveRegistry = () => { };
    sys.keyRing = true; sys.placeMigration = 'apply'; sys.ownerMigration = 'off';
    sys.placePlanDone = true; sys.ownerPlanDone = true; sys.storageLockDone = true;
    sys.claimed = [R];
    if (typeof sys.loadEspmCache === 'function') sys.loadEspmCache(loadOrder);
    sys.exposeTenancy({ svr: mp });
    return { sys, mp, ctx: { svr: mp }, stats, logs, H: globalThis.__dboHousing };
  };
  const ORDER = ['/opt/skyrim-data/Skyrim.esm', '/opt/skyrim-data/Test.esp'];

  // Boot 1: nothing cached
  const b1 = boot(ORDER);
  check('boot 1: the exterior door answers with its house, the place root', (b1.H.primaryOf(D) >>> 0) === R, (b1.H.primaryOf(D) >>> 0).toString(16));
  check('boot 1: finding that loads the interior behind it once', b1.stats.interiorLoads === 1, b1.stats.interiorLoads);
  now += 31000; await b1.sys.updateAsync(b1.ctx);
  await new Promise((r) => setTimeout(r, 200));
  check('boot 1 saves what it learned (housing-espm-cache.json)', fs.existsSync(path.join(work, 'housing-espm-cache.json')));

  // Boot 2: the same load order reads it
  const b2 = boot(ORDER);
  check('boot 2: the door still answers with its house', (b2.H.primaryOf(D) >>> 0) === R, (b2.H.primaryOf(D) >>> 0).toString(16));
  check('boot 2: no interior is loaded to find it', b2.stats.interiorLoads === 0, b2.stats.interiorLoads);
  check('boot 2 says what it read', b2.logs.some((l) => /housing-espm-cache\.json: \d+ partners/.test(l)), b2.logs.filter((l) => /espm-cache/.test(l)));

  // Another load order: what a plugin says may have changed, so nothing is trusted
  const b3 = boot(ORDER.concat(['/opt/skyrim-data/New.esp']));
  b3.H.primaryOf(D);
  check('another load order ignores the file and loads again', b3.stats.interiorLoads === 1 && b3.logs.some((l) => /another load order/.test(l)), b3.stats.interiorLoads);

  Date.now = realNow; process.chdir(cwd);
  console.log(failures ? `\n${failures} check(s) failed` : '\nall housing-espm-cache checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
