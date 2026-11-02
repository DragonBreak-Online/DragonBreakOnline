// Scripted test for housing's claim warm-up (2 Nov: a pass over every claim right after a boot, guilds.js hall roots through
// rootOfKnown, paid each claim's first read, a cold native load: 78 s of one stalled loop for 884 claims on dev). Housing reads
// the claims itself, one per updateAsync pass, from the world's load, and says when all of them are read (isWarm). It bundles
// housingSystem.ts with esbuild and runs it on a fake mp. Run it from skymp5-server with node_modules present
// (DECOR_SRC=<file> tests another copy):
//
//   node tests/housing-claim-warm-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-warm-'));
const bundle = path.join(out, 'housing.js');
const src = process.env.DECOR_SRC ? path.resolve(process.env.DECOR_SRC) : path.join(root, 'ts', 'systems', 'housingSystem.ts');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  const entry = src.startsWith(path.join(root, 'ts')) ? src : path.join(root, 'ts', 'systems', '__warm_src.ts');
  if (entry !== src) fs.copyFileSync(src, entry);
  try {
    await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error' });
  } finally { if (entry !== src) fs.unlinkSync(entry); }
  const { HousingSystem } = require(bundle);
  const text = fs.readFileSync(bundle, 'utf8');
  const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(text) || [])[1];
  const WORLD = (/WORLD_LOADED_EVENT\s*=\s*"([^"]+)"/.exec(text) || [])[1];
  check('the bundle names the housing property and the world-loaded event', !!HP && !!WORLD, { HP, WORLD });

  // n claims, each with a record; a fake mp that counts reads of the housing property per ref
  const boot = (n) => {
    const claims = Array.from({ length: n }, (_, i) => 0x08000100 + i * 2);
    const props = new Map(claims.map((c) => [`${c}:${HP}`, JSON.stringify({ owner: 9, ownerName: 'X', name: 'N', locked: true, serial: 1, partner: 0, containers: [], issued: [] })]));
    const reads = new Map();
    const mp = {
      get: (id, key) => {
        if (key === HP) reads.set(id >>> 0, (reads.get(id >>> 0) || 0) + 1);
        const v = props.get(`${id >>> 0}:${key}`);
        return v === undefined ? undefined : JSON.parse(v);
      },
      set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
      lookupEspmRecordById: () => null, getUserByActor: () => -1, getUserActor: () => 0, isConnected: () => false, sendCustomPacket: () => { },
    };
    const logs = [];
    const sys = new HousingSystem((...a) => logs.push(a.join(' ')));
    sys.holdOf = () => null; sys.isAdmin = () => false; sys.holdRanks = () => []; sys.saveRegistry = () => { };
    sys.placeMigration = 'off'; sys.ownerMigration = 'off';
    sys.placePlanDone = true; sys.ownerPlanDone = true; sys.storageLockDone = true;
    sys.saveEspmCache = () => { };
    sys.loadRegistry = () => claims.slice();
    const gm = new EventEmitter();
    const ctx = { svr: mp, gm };
    return { sys, ctx, gm, claims, reads, logs };
  };
  // initAsync's own wiring, without Settings: the registry, the world-loaded hook and the exposed api
  const init = (b) => {
    b.sys.claimed = b.sys.loadRegistry();
    b.gm.once(WORLD, () => { b.sys.warmQueue = b.sys.claimed.slice(); b.sys.warmStartMs = Date.now(); });
    b.sys.exposeTenancy(b.ctx);
  };
  const claimReads = (b) => b.claims.reduce((s, c) => s + (b.reads.get(c >>> 0) || 0), 0);
  // initAsync must carry exactly that hook, or the test above would be testing its own copy
  const tsText = fs.readFileSync(src, 'utf8');
  check('initAsync starts the warm-up on the world-loaded event, from the registry',
    /ctx\.gm\.once\(WORLD_LOADED_EVENT,\s*\(\)\s*=>\s*\{\s*this\.warmQueue = this\.claimed\.slice\(\);/.test(tsText));

  const N = 40;
  const a = boot(N); init(a);
  const H = globalThis.__dboHousing;
  check('housing exposes isWarm', typeof H.isWarm === 'function');
  check('...and it is false before the world loads', H.isWarm() === false);
  for (let i = 0; i < 5; i++) await a.sys.updateAsync(a.ctx);
  check('no claim is read before the world loads', claimReads(a) === 0, claimReads(a));
  a.gm.emit(WORLD);
  let worst = 0, passes = 0;
  while (!H.isWarm() && passes < N * 3) {
    const before = claimReads(a);
    await a.sys.updateAsync(a.ctx);
    worst = Math.max(worst, claimReads(a) - before);
    passes++;
  }
  check('no pass reads more than one claim during the warm-up', worst <= 1, worst);
  check('isWarm turns true once every claim is read', H.isWarm() === true, { passes });
  check(`it takes one pass per claim (${N})`, passes === N, passes);
  check('every claim is read exactly once', a.claims.every((c) => a.reads.get(c >>> 0) === 1), a.claims.filter((c) => a.reads.get(c >>> 0) !== 1).map((c) => c.toString(16)));
  check('the log says how many and how long', a.logs.some((l) => /claim records warm: 40 claims in [\d.]+ s/.test(l)), a.logs.filter((l) => /warm/.test(l)));
  const after = claimReads(a);
  for (let i = 0; i < 5; i++) await a.sys.updateAsync(a.ctx);
  check('once warm, passes read no claim', claimReads(a) === after, claimReads(a) - after);

  // A server with no claims is warm at the first pass after the world loads
  const e = boot(0); init(e);
  e.gm.emit(WORLD);
  await e.sys.updateAsync(e.ctx);
  check('no claims: warm at the first pass', globalThis.__dboHousing.isWarm() === true);

  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL harness error', e && e.stack || e); process.exit(1); });
