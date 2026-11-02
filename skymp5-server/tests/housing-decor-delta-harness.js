// Scripted test for the refDecor push after a housing write (1 Nov: a lock rebuilt every claim for every online player, a
// 4-7 s event-loop stall on live at 40-65 online). A write must reach every player as a delta of its own claim, at a cost
// that grows with the players and not with players x claims; a bulk change and a full refresh go out one viewer per sweep
// step; the registry writes one file at a time, off the loop. It bundles housingSystem.ts with esbuild and runs it on a
// fake mp. Run it from skymp5-server with node_modules present (DECOR_SRC=<file> tests another copy of the system):
//
//   node tests/housing-decor-delta-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-decor-'));
const bundle = path.join(out, 'housing.js');
const src = process.env.DECOR_SRC ? path.resolve(process.env.DECOR_SRC) : path.join(root, 'ts', 'systems', 'housingSystem.ts');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  // A copy outside ts/systems still resolves its imports: bundle it from beside the real file
  const entry = src.startsWith(path.join(root, 'ts')) ? src : path.join(root, 'ts', 'systems', '__decor_src.ts');
  if (entry !== src) fs.copyFileSync(src, entry);
  try {
    await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error' });
  } finally { if (entry !== src) fs.unlinkSync(entry); }
  const { HousingSystem } = require(bundle);
  const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(fs.readFileSync(bundle, 'utf8')) || [])[1];

  const CLAIMS = 600, USERS = 50;
  const OWNER_PROFILE = 11;
  const actors = {};
  const byUser = {};
  for (let u = 0; u < USERS; u++) {
    const id = (0xff000100 + u) >>> 0;
    actors[id] = { user: u, profile: u === 0 ? OWNER_PROFILE : 100 + u, name: 'Player ' + u };
    byUser[u] = id;
  }
  const OWNER = byUser[0], STRANGER = byUser[1];
  const props = new Map();
  let packets = [];
  let gets = 0;
  const mp = {
    get: (id, key) => {
      gets++;
      const a = actors[id >>> 0];
      if (key === 'profileId') return a ? a.profile : 0;
      if (key === 'appearance') return a ? { name: a.name } : undefined;
      if (key === 'pos') return [0, 0, 0];
      const v = props.get(`${id >>> 0}:${key}`);
      return v === undefined ? undefined : JSON.parse(v);
    },
    set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
    getUserByActor: (id) => (actors[id >>> 0] ? actors[id >>> 0].user : -1),
    getUserActor: (u) => byUser[u] || 0,
    isConnected: (u) => byUser[u] !== undefined,
    sendCustomPacket: (u, json) => packets.push({ u, p: JSON.parse(json) }),
  };
  const ctx = { svr: mp };
  let now = 1e9;
  const realNow = Date.now;
  Date.now = () => now;

  const sys = new HousingSystem(() => { });
  sys.holdOf = () => null; sys.isAdmin = () => false; sys.holdRanks = () => []; sys.partnerOf = () => 0;
  sys.baseTypeOf = () => 'DOOR';
  sys.keyRing = true;
  sys.placeMigration = 'off'; sys.ownerMigration = 'off';
  sys.placePlanDone = true; sys.ownerPlanDone = true; sys.storageLockDone = true;
  const realSave = sys.saveRegistry.bind(sys);
  sys.saveRegistry = () => { };
  const ref = (i) => 0x100 + i * 2;
  const PARTNER_OF = (i) => (i % 3 === 0 ? 0x80000 + i : 0);
  sys.claimed = [];
  for (let i = 0; i < CLAIMS; i++) {
    sys.claimed.push(ref(i));
    mp.set(ref(i), HP, { owner: OWNER_PROFILE, ownerName: 'Nat', name: 'House ' + i, locked: false, serial: 1, partner: PARTNER_OF(i), containers: [], issued: [] });
  }
  const recOf = (id) => sys.read(ctx, id);
  const tick = async (ms) => { now += ms; await sys.updateAsync(ctx); };
  const refDecors = () => packets.filter((x) => x.p.customPacketType === 'refDecor');
  await tick(10000); packets = [];

  // 1. one lock: a delta to every player, with only that claim and its partner
  const H = ref(3);
  sys.doLock(ctx, 0, OWNER, H, recOf(H), true);
  packets = []; gets = 0;
  await tick(1);
  const sent = refDecors();
  check('every online player gets one refDecor for the lock on the next tick', sent.length === USERS && new Set(sent.map((x) => x.u)).size === USERS, sent.length);
  check('it is a delta, not a full sync', sent.every((x) => x.p.full !== true), sent.slice(0, 1).map((x) => x.p.full));
  check('it carries only the locked claim and its partner', sent.every((x) => x.p.refs.length === 2 && x.p.refs.some((r) => r.refId === H) && x.p.refs.some((r) => r.refId === PARTNER_OF(3))), sent[0] && sent[0].p.refs.length);
  const forU = (a) => sent.find((x) => x.u === actors[a].user).p.refs.find((r) => r.refId === H);
  check('the owner sees it unlocked, a stranger locked', forU(OWNER).locked === false && forU(STRANGER).locked === true, [forU(OWNER), forU(STRANGER)]);
  check('the name goes with it', forU(STRANGER).name === 'House 3');
  const perPlayer = gets / USERS;
  check(`the push reads O(players), not O(players x ${CLAIMS} claims)`, gets < USERS * 40, { gets, perPlayer: Math.round(perPlayer) });
  packets = []; await tick(1);
  check('nothing more goes out on the next tick', refDecors().length === 0, refDecors().length);

  // 2. a release reverts the claim on every client
  sys.write(ctx, ref(4), { owner: 0, ownerName: '', name: null, locked: false, serial: 2, partner: 0, containers: [], issued: [] });
  packets = []; await tick(1);
  const rel = refDecors();
  check('a released claim goes out with no name and unlocked', rel.length === USERS && rel.every((x) => x.p.refs.length === 1 && x.p.refs[0].refId === ref(4) && x.p.refs[0].name === null && x.p.refs[0].locked === false), rel[0] && rel[0].p.refs);

  // 3. a bulk change goes out as a paced full sweep, one viewer per step
  for (let i = 10; i < 50; i++) { const r = recOf(ref(i)); r.locked = true; sys.write(ctx, ref(i), r); }
  packets = []; await tick(1);
  check('40 changed claims in one tick send no per-player delta', refDecors().filter((x) => x.p.full !== true).length === 0, refDecors().length);
  // the sweep's first step goes out in the same tick as the bulk change
  const first = refDecors().filter((x) => x.p.full === true);
  let steps = first.length ? 1 : 0, sentTo = new Set(first.map((x) => x.u)), gaps = first.length ? [first.length] : [], at = first.length ? [now] : [];
  for (let t = 0; t < 400 && sentTo.size < USERS; t++) {
    packets = [];
    await tick(10);
    const f = refDecors().filter((x) => x.p.full === true);
    if (f.length) { steps++; gaps.push(f.length); at.push(now); f.forEach((x) => sentTo.add(x.u)); }
  }
  check('the sweep reaches every player', sentTo.size === USERS, sentTo.size);
  check('one player per sweep step', gaps.every((n) => n === 1), gaps.slice(0, 5));
  const minGap = Math.min(...at.slice(1).map((t, k) => t - at[k]));
  check('sweep steps are 50 ms or more apart', minGap >= 50, minGap);
  const full = (() => { packets = []; sys.pushDecor(ctx, actors[STRANGER].user); return refDecors()[0].p; })();
  check('a full refresh still lists every live claim and its partner', full.full === true && full.refs.length === CLAIMS - 1 + Math.floor((CLAIMS + 2) / 3) - (PARTNER_OF(4) ? 1 : 0), full.refs.length);

  // 4. the registry: off the loop, one write in flight, the last state on disk
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-reg-'));
  const cwd = process.cwd(); process.chdir(dir);
  let writes = 0, inFlight = 0, maxInFlight = 0;
  const realWrite = fs.promises.writeFile;
  fs.promises.writeFile = async (...a) => { writes++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 20)); try { return await realWrite(...a); } finally { inFlight--; } };
  sys.saveRegistry = realSave;
  sys.claimed = [1, 2, 3];
  sys.saveRegistry(); sys.claimed.push(4); sys.saveRegistry(); sys.claimed.push(5); sys.saveRegistry();
  check('saveRegistry returns before the file is written', !fs.existsSync(path.join(dir, 'housing.json')) || writes > 0);
  await new Promise((r) => setTimeout(r, 300));
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'housing.json'), 'utf8'));
  check('never two registry writes in flight', maxInFlight === 1, maxInFlight);
  check('three saves in a burst write at most twice', writes <= 2, writes);
  check('the file holds the last state', JSON.stringify(disk) === JSON.stringify([1, 2, 3, 4, 5]), disk);
  check('no temp file is left', !fs.existsSync(path.join(dir, 'housing.json.tmp')));
  fs.promises.writeFile = realWrite; process.chdir(cwd);
  Date.now = realNow;

  console.log(failures ? `\n${failures} check(s) failed` : '\nall housing-decor-delta checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
