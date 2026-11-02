// A companion its owner's client reports missing is sent to that client again (the live log 29-31 Oct: 803 of 14,834 owner
// reports said the companion did not exist there, for up to about 3 minutes each). The gameplay calls
// __dboCompanions.regroup(id) after two such reports in a row; the system places the companion beside its owner and
// disables it, and its 500 ms check enables it a second later, which resubscribes every listener (MpObjectReference
// Disable/Enable), so the owner's client is sent it afresh. Not in one tick: the client queues Actor::Disable, and a
// recreate before it runs is the 12-17 Oct crash family (Worker 4). Checks: placed behind the owner and disabled; enabled
// only after a second; never left disabled when it ends or its owner leaves; a "stay" companion, an offline owner and a
// non-companion are left alone; a second call within the cooldown is refused. It bundles
// companionSystem.ts with esbuild (settings and placement stubbed). Run it from skymp5-server with node_modules present:
//
//   node tests/companion-regroup-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'companion-regroup-'));
const bundle = path.join(out, 'companion.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const A = 0xff000101, B = 0xff000102;
const PLAYER_BASE = 0x7, SUMMON_BASE = 0x640b5;

(async () => {
  await esbuild.build({
    entryPoints: [path.join(root, 'ts', 'systems', 'companionSystem.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /^\.\.\/settings$|^\.\/npcPlacement$|^\.\.\/scampNative$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
          contents: a.path === '../settings'
            ? 'module.exports = { Settings: { get: async () => ({ allSettings: {} }) } };'
            : a.path === './npcPlacement'
              ? 'module.exports = { HOSTILE_PROP: "ff_hostile", placeNpc: (...x) => globalThis.__crPlace(...x), placeAtMe: () => 0 };'
              : 'module.exports = {};',
          loader: 'js',
        }));
      },
    }],
  });
  const { CompanionSystem } = require(bundle);

  const props = new Map();
  const get = (id, k) => props.get(`${id >>> 0}|${k}`);
  const writes = [];
  const set = (id, k, v) => { props.set(`${id >>> 0}|${k}`, v); writes.push([id >>> 0, k, v]); };
  const users = new Map([[A, 1], [B, 2]]);
  const logs = [];
  const descOf = (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`;
  let now = 1790000000000; const realNow = Date.now; Date.now = () => now;
  const mp = {
    get: (id, k) => { const v = get(id, k); if (v === undefined && k === 'profileId') return -1; if (v === undefined) throw new Error(`no ${k} on ${id.toString(16)}`); return v; },
    set,
    getUserByActor: (id) => (users.has(id >>> 0) ? users.get(id >>> 0) : -1),
    isConnected: (u) => [...users.values()].includes(u),
    getUserActor: (u) => [...users].find(([, x]) => x === u)?.[0] ?? 0,
    getActorCellOrWorld: () => 0x3c,
    getActorPos: (id) => get(id, 'pos') || [0, 0, 0],
    getDescFromId: descOf,
    getIdFromDesc: (d) => parseInt(String(d), 16) >>> 0,
    lookupEspmRecordById: () => ({ record: { type: 'NPC_' } }),
    makeProperty: () => {},
    destroyActor: (id) => set(id, 'gone', true),
    sendCustomPacket: () => {},
  };
  const actor = (id, base, profile, pos) => {
    set(id, 'baseDesc', descOf(base)); set(id, 'isDead', false); set(id, 'pos', pos);
    set(id, 'worldOrCellDesc', '3c:Skyrim.esm'); set(id, 'angle', [0, 0, 0]);
    if (profile >= 0) set(id, 'profileId', profile);
  };
  actor(A, PLAYER_BASE, 11, [1000, 2000, 0]); actor(B, PLAYER_BASE, 12, [5000, 0, 0]);
  let nextId = 0xff000500;
  globalThis.__crPlace = (_mp, ownerId, baseDesc, loc) => { const id = nextId++; actor(id, parseInt(baseDesc, 16), -1, loc.pos); return id; };

  const ctx = { svr: mp, gm: { on() {}, once() {}, emit() {} } };
  process.chdir(out);
  const sys = new CompanionSystem((...x) => logs.push(x.join(' ')));
  await sys.initAsync(ctx);
  const S = sys.spawn(A, SUMMON_BASE, { kind: 'summon' });
  const T = sys.spawn(B, SUMMON_BASE, { kind: 'summon' });
  check('two summons spawned', !!S && !!T, [S, T]);
  const api = globalThis.__dboCompanions;
  check('the system exposes regroup', typeof api.regroup === 'function');

  writes.length = 0;
  let r = api.regroup(S);
  const mine = writes.filter(([id]) => id === S).map(([, k, v]) => [k, k === 'locationalData' ? v.pos.map(Math.round) : v]);
  check('a missing summon is placed: answer "placed"', r === 'placed', r);
  check('...behind its owner (128 units back, in the owner\'s cell)', JSON.stringify(mine[0]) === JSON.stringify(['locationalData', [1000, 1872, 16]]) && get(S, 'locationalData').cellOrWorldDesc === '3c:Skyrim.esm', mine);
  check('...its spawn point too', mine.some(([k]) => k === 'spawnPoint'), mine);
  const dis = mine.map(([k, v]) => (k === 'isDisabled' ? v : null)).filter((x) => x !== null);
  check('...then disabled after the move, and not enabled in the same tick', JSON.stringify(dis) === '[true]' && mine.findIndex(([k]) => k === 'isDisabled') > mine.findIndex(([k]) => k === 'locationalData'), mine);
  const comp = (id) => sys.companions.get(id >>> 0);
  writes.length = 0; now += 999; sys.check(comp(S), now);
  check('...still disabled 999 ms later', !writes.some(([id, k]) => id === S && k === 'isDisabled') && get(S, 'isDisabled') === true, writes);
  now += 1; sys.check(comp(S), now);
  check('...enabled by the check a second after the disable (the fresh subscription)', get(S, 'isDisabled') === false, writes);
  writes.length = 0; now += 500; sys.check(comp(S), now);
  check('...and only once', !writes.some(([id, k]) => id === S && k === 'isDisabled'), writes);
  now -= 1500;
  check('...and logged', logs.some((l) => /placed beside ff000101 again \(missing on the owner's client\)/.test(l)), logs.slice(-2));

  writes.length = 0;
  r = api.regroup(S);
  check('a second report within 30 s is too soon: nothing written', r === 'too soon' && !writes.some(([id]) => id === S), [r, writes]);
  now += 31000;
  check('...after 30 s it may be placed again', api.regroup(S) === 'placed');

  now += 31000;
  // A companion whose owner leaves while it waits is enabled before it is put away for the next login
  sys.companions.get(T >>> 0).persistent = true;
  check('T placed', api.regroup(T) === 'placed' && get(T, 'isDisabled') === true);
  sys.release(sys.companions.get(T >>> 0));
  check('...released while waiting: enabled first, never left disabled', get(T, 'isDisabled') === false);
  const T2 = sys.spawn(B, SUMMON_BASE, { kind: 'summon' });
  now += 31000;
  check('T2 placed', api.regroup(T2) === 'placed' && get(T2, 'isDisabled') === true);
  sys.dismiss(T2, 'dismissed');
  check('...dismissed while waiting: enabled before it goes', writes.some(([id, k, v]) => id === T2 && k === 'isDisabled' && v === false));
  now += 31000;
  const T3 = sys.spawn(B, SUMMON_BASE, { kind: 'summon' });
  api.stay(T3);
  writes.length = 0;
  check('a "stay" companion is left where it was told to stay', api.regroup(T3) === 'staying' && !writes.some(([id]) => id === T3), writes);
  api.follow(T3);
  users.delete(B);
  check('an owner who is offline: left alone', api.regroup(T3) === 'owner offline');
  check('not a companion: left alone', api.regroup(0xff0009ff) === 'not a companion' && api.regroup(A) === 'not a companion');

  Date.now = realNow;
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
