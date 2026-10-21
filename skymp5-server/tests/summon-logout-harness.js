// A summon is removed when its owner logs out (#bugs "Ghost wolf in cathedral of st martin", 1559767332891394161). The
// server runs the systems' disconnect while it still maps the owner to a connection that is already closed, so a
// destroyActor there can throw "User with id N doesn't exist" part way and leave the summon in the world (server log
// 18-20 Oct: 3 of 8 "ended (owner left)" summons were followed by "destroyActor ... failed after the end"). The fake mp
// below throws the same way while the disconnect event runs. Checks: the summon is destroyed once the event is over, no
// destroy failure is logged, the owner's other players' summons stay. It bundles companionSystem.ts with esbuild
// (settings and placement stubbed). Run it from skymp5-server with node_modules present:
//
//   node tests/summon-logout-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'summon-logout-'));
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
              ? 'module.exports = { HOSTILE_PROP: "ff_hostile", placeNpc: (...x) => globalThis.__slPlace(...x), placeAtMe: () => 0 };'
              : 'module.exports = {};',
          loader: 'js',
        }));
      },
    }],
  });
  const { CompanionSystem } = require(bundle);

  const props = new Map();
  const get = (id, k) => props.get(`${id >>> 0}|${k}`);
  const set = (id, k, v) => props.set(`${id >>> 0}|${k}`, v);
  const users = new Map([[A, 1], [B, 2]]);
  const logs = [];
  // While the disconnect event runs, the closed connection is still the owner's: a destroy that reaches it throws
  let disconnecting = -1;
  const descOf = (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`;
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
    destroyActor: (id) => {
      if (disconnecting >= 0 && get(id, 'listener') === disconnecting) throw new Error(`User with id ${disconnecting} doesn't exist`);
      set(id, 'gone', true);
    },
    sendCustomPacket: () => {},
  };
  const actor = (id, base, profile, pos) => {
    set(id, 'baseDesc', descOf(base)); set(id, 'isDead', false); set(id, 'pos', pos);
    set(id, 'worldOrCellDesc', '3c:Skyrim.esm'); set(id, 'angle', [0, 0, 0]);
    if (profile >= 0) set(id, 'profileId', profile);
  };
  actor(A, PLAYER_BASE, 11, [0, 0, 0]); actor(B, PLAYER_BASE, 12, [300, 0, 0]);
  let nextId = 0xff000500;
  // A summon next to its owner has the owner's game among its listeners
  globalThis.__slPlace = (_mp, ownerId, baseDesc, loc) => { const id = nextId++; actor(id, parseInt(baseDesc, 16), -1, loc.pos); set(id, 'listener', users.get(ownerId)); return id; };

  const ctx = { svr: mp, gm: { on() {}, once() {}, emit() {} } };
  process.chdir(out);
  const sys = new CompanionSystem((...x) => logs.push(x.join(' ')));
  await sys.initAsync(ctx);
  const S = sys.spawn(A, SUMMON_BASE, { kind: 'summon' });
  const T = sys.spawn(B, SUMMON_BASE, { kind: 'summon' });
  check('two summons spawned', !!S && !!T, [S, T]);

  // The server's order: the disconnect event runs with the connection already closed, then the user is unmapped
  disconnecting = 1;
  sys.disconnect(1, ctx);
  disconnecting = -1;
  users.delete(A);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  check('the logged-out owner\'s summon is destroyed', get(S, 'gone') === true, { gone: get(S, 'gone'), logs });
  check('...with no destroy failure in the log', !logs.some((l) => /destroyActor .* failed|failed after the end/.test(l)), logs.filter((l) => /failed/.test(l)));
  check('...and the system no longer lists it', !sys.info(S), sys.info(S));
  check('another player\'s summon stays', get(T, 'gone') !== true && !!sys.info(T));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
