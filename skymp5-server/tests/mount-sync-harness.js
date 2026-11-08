// Horse riding sync, the server half (mountSyncSystem.ts, _work/horse-sync-1108). Checks: a rider's "mounted" report
// makes it the horse's host and is relayed once to each neighbour, a neighbour that streams in later is told, one that
// leaves view or a ride that ends is told off; only the rider may host the horse while it rides; E on a horse it may
// ride sends the ride order with the host grant, E on anything else or on a dead horse passes through; someone else's
// mount, a ridden horse and the gameplay's refusal are refused; the ride ends on the horse's death, a teleport, a cell
// change and the rider's logout; a host lost mid-ride is granted back. It bundles mountSyncSystem.ts with esbuild.
// Run it from skymp5-server with node_modules present:
//
//   node tests/mount-sync-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mount-sync-'));
const bundle = path.join(out, 'mountSync.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const A = 0xff000101, B = 0xff000102, C = 0xff000103;
const H = 0xff0002a0, H2 = 0xff0002a1, WOLF = 0xff0002b0;
const HORSE_BASE = 0x68d04, WOLF_BASE = 0x23aba, HORSE_RACE = 0x131fd, WOLF_RACE = 0x1320a;
const TAMRIEL = 0x3c;

(async () => {
  await esbuild.build({
    entryPoints: [path.join(root, 'ts', 'systems', 'mountSyncSystem.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
  });
  const { MountSyncSystem, isRidden, horseOf, RIDE_GAP } = require(bundle);

  let now = 1790000000000; const realNow = Date.now; Date.now = () => now;
  const users = new Map([[A, 1], [B, 2], [C, 3]]);
  const actors = new Map();
  const put = (id, base, pos, extra) => actors.set(id, Object.assign({ base, pos, cell: TAMRIEL, dead: false, neighbors: [] }, extra || {}));
  put(A, 7, [0, 0, 0], { player: true });
  put(B, 7, [300, 0, 0], { player: true });
  put(C, 7, [9000, 0, 0], { player: true });
  put(H, HORSE_BASE, [100, 0, 0]);
  put(H2, HORSE_BASE, [150, 50, 0]);
  put(WOLF, WOLF_BASE, [120, 0, 0]);
  const race = (raceId) => ({ record: { type: 'NPC_', fields: [{ type: 'RNAM', data: Uint8Array.from([raceId & 0xff, (raceId >> 8) & 0xff, (raceId >> 16) & 0xff, 0]) }] }, toGlobalRecordId: (x) => x });
  const records = new Map([
    [HORSE_BASE, race(HORSE_RACE)], [WOLF_BASE, race(WOLF_RACE)],
    [HORSE_RACE, { record: { type: 'RACE', editorId: 'HorseRace', fields: [] } }],
    [WOLF_RACE, { record: { type: 'RACE', editorId: 'WolfRace', fields: [] } }],
  ]);
  const hosters = new Map();
  const sent = [];
  const logs = [];
  const actor = (id) => { const a = actors.get(id >>> 0); if (!a) throw new Error(`no form ${(id >>> 0).toString(16)}`); return a; };
  const mp = {
    get: (id, k) => {
      if (id === 0 && k === 'onlinePlayers') return [...users.keys()];
      const a = actor(id);
      if (k === 'type') return 'MpActor';
      if (k === 'isDead') return a.dead;
      if (k === 'baseDesc') return `${a.base.toString(16)}:Skyrim.esm`;
      if (k === 'profileId') return a.player ? 1 : -1;
      if (k === 'actorNeighbors') return a.neighbors;
      throw new Error(`no ${k}`);
    },
    getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16),
    getUserActor: (u) => { for (const [id, x] of users) if (x === u) return id; return 0; },
    getUserByActor: (id) => (users.has(id >>> 0) ? users.get(id >>> 0) : -1),
    isConnected: (u) => [...users.values()].includes(u),
    getActorCellOrWorld: (id) => actor(id).cell,
    getActorPos: (id) => actor(id).pos,
    lookupEspmRecordById: (id) => records.get(id >>> 0) || null,
    setHoster: (h, r) => { hosters.set(h >>> 0, r >>> 0); },
    getHoster: (h) => hosters.get(h >>> 0) || 0,
    sendCustomPacket: (u, s) => sent.push([u, JSON.parse(s)]),
  };
  const prevHost = [];
  mp.onHostAttempt = (r, a) => { prevHost.push([r, a]); return true; };
  const prevActivate = [];
  mp.onActivate = (t, c) => { prevActivate.push([t, c]); return true; };
  const companions = new Map();
  globalThis.__dboCompanions = { info: (id) => companions.get(id >>> 0) };

  const sys = new MountSyncSystem((...x) => logs.push(x.join(' ')));
  const ctx = { svr: mp, gm: null };
  await sys.initAsync(ctx);
  const packetsTo = (u, type) => sent.filter(([x, p]) => x === u && p.customPacketType === type).map(([, p]) => p);
  const clear = () => { sent.length = 0; };
  const tick = (ms = 300) => { now += ms; sys.tick(mp, now); };

  // 1. the rider's report
  actor(A).neighbors = [A, B, H];
  sys.customPacket(1, 'dboRide', { op: 'mounted', horse: H }, ctx);
  check('a mounted report starts the ride', horseOf(A) === H && isRidden(H), horseOf(A));
  check('the rider is made the horse host', hosters.get(H) === A, hosters.get(H));
  check('__dboRides tells anticheat the horse', globalThis.__dboRides.horseOf(A) === H && globalThis.__dboRides.riderOf(H) === A);
  tick();
  let toB = packetsTo(2, 'dboRiders');
  check('a neighbour is told the rider and the horse', toB.length === 1 && JSON.stringify(toB[0].on) === JSON.stringify([A, H]), toB);
  check('the rider is not told of itself', packetsTo(1, 'dboRiders').length === 0, packetsTo(1, 'dboRiders'));
  clear(); tick();
  check('a neighbour already told hears nothing more', packetsTo(2, 'dboRiders').length === 0, sent);

  // 2. streaming in a rider already mounted, and one leaving view
  actor(A).neighbors = [A, B, C, H];
  clear(); tick();
  const toC = packetsTo(3, 'dboRiders');
  check('a player who streams in later is told the ride', toC.length === 1 && JSON.stringify(toC[0].on) === JSON.stringify([A, H]), toC);
  actor(A).neighbors = [A, C, H];
  clear(); tick();
  toB = packetsTo(2, 'dboRiders');
  check('a player who leaves view is told off', toB.length === 1 && JSON.stringify(toB[0].off) === JSON.stringify([A]), toB);

  // 3. host reservation
  check('another player may not host the ridden horse', mp.onHostAttempt(B, H) === false);
  check('the rider may host it', mp.onHostAttempt(A, H) === true);
  prevHost.length = 0;
  check('other actors go down the chain', mp.onHostAttempt(B, WOLF) === true && prevHost.length === 1, prevHost);

  // 4. a lost host is granted back
  hosters.set(H, B);
  tick(2100);
  check('a host taken mid-ride goes back to the rider', hosters.get(H) === A, hosters.get(H));

  // 5. dismount
  actor(A).neighbors = [A, B, C, H];
  clear(); tick();
  clear();
  sys.customPacket(1, 'dboRide', { op: 'dismounted' }, ctx);
  check('a dismount report ends the ride', !isRidden(H) && horseOf(A) === 0);
  tick();
  check('watchers are told off after the dismount', JSON.stringify(packetsTo(2, 'dboRiders')[0]?.off) === JSON.stringify([A]) && JSON.stringify(packetsTo(3, 'dboRiders')[0]?.off) === JSON.stringify([A]), sent);
  check('the dismounted rider is not told the ride ended', packetsTo(1, 'dboRide').length === 0, packetsTo(1, 'dboRide'));
  prevHost.length = 0;
  check('after the ride the horse is free to host', mp.onHostAttempt(B, H) === true && prevHost.length === 1);

  // 6. E on a horse
  clear(); prevActivate.length = 0; hosters.clear();
  check('E on a horse is handled here', mp.onActivate(H, A) === false && prevActivate.length === 0, prevActivate);
  const order = packetsTo(1, 'dboRide');
  check('E on a horse sends the rider a ride order', order.length === 1 && order[0].op === 'ride' && order[0].horse === H, order);
  check('the host grant goes out with the order', hosters.get(H) === A, hosters.get(H));
  check('the horse is reserved for the rider before it mounts', mp.onHostAttempt(B, H) === false);
  clear();
  check("the client's own activate on the order is swallowed", mp.onActivate(H, A) === false && packetsTo(1, 'dboRide').length === 0 && prevActivate.length === 0, sent);
  check('E on a wolf passes down the chain', mp.onActivate(WOLF, A) === true && prevActivate.length === 1, prevActivate);
  actor(H2).dead = true;
  check('E on a dead horse passes down the chain (looting)', mp.onActivate(H2, A) === true && prevActivate.length === 2, prevActivate);
  actor(H2).dead = false;
  sys.customPacket(1, 'dboRide', { op: 'mounted', horse: H }, ctx);
  clear();
  check('E by B on the horse A rides is refused', mp.onActivate(H, B) === false);
  const refusedB = packetsTo(2, 'dboRide');
  check('B is told someone rides it', refusedB.length === 1 && refusedB[0].op === 'refused' && /riding/.test(refusedB[0].reason), refusedB);
  check('B was not given the horse', hosters.get(H) === A, hosters.get(H));
  companions.set(H2, { ownerId: C, kind: 'mount' });
  clear();
  check("E on someone else's mount is refused", mp.onActivate(H2, B) === false && /not yours/.test(packetsTo(2, 'dboRide')[0]?.reason || ''), sent);
  companions.set(H2, { ownerId: B, kind: 'mount' });
  clear();
  check('E on your own mount sends the order', mp.onActivate(H2, B) === false && packetsTo(2, 'dboRide')[0]?.op === 'ride', sent);
  companions.clear();

  // 7. the gameplay decides ownership
  globalThis.__dboMountMayRide = (r, h) => (h === H2 ? 'That horse is stabled.' : true);
  clear();
  sys.customPacket(2, 'dboRide', { op: 'mounted', horse: H2 }, ctx);
  check("the gameplay's refusal refuses a report", horseOf(B) === 0 && packetsTo(2, 'dboRide')[0]?.reason === 'That horse is stabled.', sent);
  delete globalThis.__dboMountMayRide;
  actor(H2).pos = [5000, 0, 0];
  clear();
  sys.customPacket(2, 'dboRide', { op: 'mounted', horse: H2 }, ctx);
  check('a report from far away is refused', horseOf(B) === 0 && packetsTo(2, 'dboRide')[0]?.op === 'refused', sent);
  actor(H2).pos = [150, 50, 0];
  clear();
  sys.customPacket(2, 'dboRide', { op: 'mounted', horse: H }, ctx);
  check("a report on another's ridden horse is refused", horseOf(B) === 0 && horseOf(A) === H, [horseOf(B), horseOf(A)]);

  // 8. edge cases: death, teleport, cell change, logout
  actor(A).neighbors = [A, B, H];
  clear(); tick();
  actor(H).dead = true;
  clear(); tick();
  const endedDead = packetsTo(1, 'dboRide');
  check('the horse dying ends the ride and tells the rider', !isRidden(H) && endedDead[0]?.op === 'ended', endedDead);
  check('watchers are told off when the horse dies', JSON.stringify(packetsTo(2, 'dboRiders')[0]?.off) === JSON.stringify([A]), sent);
  actor(H).dead = false;

  sys.customPacket(1, 'dboRide', { op: 'mounted', horse: H }, ctx);
  actor(A).pos = [RIDE_GAP + 500, 0, 0];
  clear(); tick();
  check('a teleport off the horse ends the ride', !isRidden(H) && packetsTo(1, 'dboRide')[0]?.op === 'ended', sent);
  actor(A).pos = [0, 0, 0];

  sys.customPacket(1, 'dboRide', { op: 'mounted', horse: H }, ctx);
  actor(A).cell = 0x16bb4;
  clear(); tick();
  check('a cell change ends the ride', !isRidden(H) && packetsTo(1, 'dboRide')[0]?.op === 'ended', sent);
  actor(A).cell = TAMRIEL;

  sys.customPacket(1, 'dboRide', { op: 'mounted', horse: H }, ctx);
  clear(); tick();
  check('the new ride is told to the neighbour', packetsTo(2, 'dboRiders').length === 1, sent);
  sys.disconnect(1, ctx);
  users.delete(A);
  clear(); tick();
  check('the rider logging out ends the ride', !isRidden(H));
  check('watchers are told off after the logout', JSON.stringify(packetsTo(2, 'dboRiders')[0]?.off) === JSON.stringify([A]), sent);

  check('the log names each ride', logs.some((l) => /rides ff0002a0/.test(l)) && logs.some((l) => /off ff0002a0: horse dead/.test(l)), logs);

  Date.now = realNow;
  try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* temp */ }
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.log('FAIL harness threw', e && e.stack); process.exitCode = 1; });
