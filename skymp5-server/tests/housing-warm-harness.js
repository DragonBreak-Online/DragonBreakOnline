// Scripted test for the after-boot claim warm-up (1 Nov: the first login after a boot froze the loop 26 s on dev, because
// its refDecor read all 676 claims cold, each first read a native ref load). A fake mp charges each ref's first read 40 ms of
// clock; the system must read every claim once after the boot delay, a slice per sweep step, so that no step blocks long and
// the first login's push meets no cold read. It bundles housingSystem.ts with esbuild and runs it on a fake mp. Run it from
// skymp5-server with node_modules present (DECOR_SRC=<file> tests another copy of the system):
//
//   node tests/housing-warm-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

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
  const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(fs.readFileSync(bundle, 'utf8')) || [])[1];

  const CLAIMS = 300, COLD_MS = 40;
  let now = 1e9;
  const realNow = Date.now;
  Date.now = () => now;
  const props = new Map();
  const warm = new Set();
  let coldReads = 0;
  const actors = { [0xff000100]: { user: 0, profile: 7 } };
  let online = false;
  const mp = {
    get: (id, key) => {
      const a = actors[id >>> 0];
      if (a) return key === 'profileId' ? a.profile : key === 'appearance' ? { name: 'P' } : undefined;
      // the first read of a ref after the boot is a native load
      if (!warm.has(id >>> 0)) { warm.add(id >>> 0); coldReads++; now += COLD_MS; }
      const v = props.get(`${id >>> 0}:${key}`);
      return v === undefined ? undefined : JSON.parse(v);
    },
    set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
    getUserByActor: (id) => (actors[id >>> 0] ? actors[id >>> 0].user : -1),
    getUserActor: (u) => (u === 0 && online ? 0xff000100 : 0),
    isConnected: (u) => u === 0 && online,
    sendCustomPacket: () => { },
  };
  const ctx = { svr: mp };
  const logs = [];
  const sys = new HousingSystem((...a) => logs.push(a.join(' ')));
  sys.holdOf = () => null; sys.isAdmin = () => false; sys.holdRanks = () => []; sys.partnerOf = () => 0;
  sys.baseTypeOf = () => 'DOOR'; sys.saveRegistry = () => { };
  sys.keyRing = true;
  sys.placeMigration = 'off'; sys.ownerMigration = 'off';
  sys.placePlanDone = true; sys.ownerPlanDone = true; sys.storageLockDone = true;
  sys.initAtMs = now;
  sys.claimed = [];
  for (let i = 0; i < CLAIMS; i++) {
    const ref = 0x1000 + i;
    sys.claimed.push(ref);
    props.set(`${ref}:${HP}`, JSON.stringify({ owner: 9, ownerName: 'X', name: 'H' + i, locked: true, serial: 1, partner: 0, containers: [], issued: [] }));
  }

  // The loop: updateAsync every 10 ms of clock, as the system loop does (a tick's own work moves the clock too)
  let worst = 0, stepsWithReads = [], firstReadAt = null;
  const tick = async () => {
    const t0 = now, c0 = coldReads;
    await sys.updateAsync(ctx);
    worst = Math.max(worst, now - t0);
    if (coldReads > c0) { stepsWithReads.push(t0); if (firstReadAt === null) firstReadAt = t0; }
    now += 10;
  };
  for (let t = 0; t < 2900; t++) await tick();
  check('nothing is read in the first 29 s after boot (records read as null then)', coldReads === 0, coldReads);
  for (let t = 0; t < 4000 && coldReads < CLAIMS; t++) await tick();
  check(`every claim is read once after the boot delay (${CLAIMS})`, coldReads === CLAIMS, coldReads);
  check('the warm-up starts at the boot delay', firstReadAt !== null && firstReadAt - sys.initAtMs >= 30000 && firstReadAt - sys.initAtMs < 30100, firstReadAt && firstReadAt - sys.initAtMs);
  const gaps = stepsWithReads.slice(1).map((t, k) => t - stepsWithReads[k]);
  check('a slice per sweep step: 50 ms or more apart', gaps.length > 0 && Math.min(...gaps) >= 50, Math.min(...gaps));
  check(`no tick blocks longer than one cold read past the budget (${COLD_MS} + 15 ms)`, worst <= COLD_MS + 15, worst);
  check('the end of the warm-up is logged', logs.some((l) => /claims read after boot/.test(l)), logs.filter((l) => /claims read/.test(l)));

  // The first login after the warm-up: its full refDecor meets no cold read
  online = true;
  const before = coldReads, t0 = now;
  sys.pushDecor(ctx, 0);
  check('the first login\'s refDecor reads no claim cold', coldReads === before, coldReads - before);
  check('...and costs no load time', now - t0 === 0, now - t0);
  Date.now = realNow;

  console.log(failures ? `\n${failures} check(s) failed` : '\nall housing-warm checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
