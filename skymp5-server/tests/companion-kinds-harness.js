// The pet, tame and mount kinds (taming-server-1108, Nat 7 Nov: passive pets take no command slot and never fight; dangerous tames
// are companions under the PvP rules; one of each at a time). Checks: a pet or mount takes no attack order and never defends, its
// blows never land and blows on a pet never land; a tame fights NPCs and a player only under the PvP rules; a second pet, tame or
// mount replaces the first without touching the summon slot; the gameplay's __dboCompanionEnded hook hears every end and why;
// the kinds survive a logout in the registry; __dboCompanions.level reads the record's ACBS level. Bundles companionSystem.ts
// with esbuild (settings and placement stubbed). Run it from skymp5-server with node_modules present:
//
//   node tests/companion-kinds-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'companion-kinds-'));
const bundle = path.join(out, 'companion.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const A = 0xff000101, B = 0xff000102, NPC = 0xff000201;
const PLAYER_BASE = 0x7, HARE = 0x6dc9d, WOLF = 0x23abe, HORSE = 0x68d03, SUMMON_BASE = 0x640b5;

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
              ? 'module.exports = { HOSTILE_PROP: "ff_hostile", placeNpc: (...x) => globalThis.__ckPlace(...x), placeAtMe: () => 0 };'
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
  const descOf = (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`;
  // ACBS: flags u32, then magicka/stamina offsets, level u16 at 8, calc min at 10 (a wolf at 6, a hare at 1)
  const acbs = (level) => { const b = Buffer.alloc(24); b.writeUInt16LE(level, 8); return new Uint8Array(b); };
  const records = { [WOLF]: acbs(6), [HARE]: acbs(1) };
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
    lookupEspmRecordById: (id) => {
      const base = (id >>> 0) >= 0xff000000 ? parseInt(String(get(id, 'baseDesc') || '0'), 16) : id >>> 0;
      return { record: { type: 'NPC_', fields: records[base] ? [{ type: 'ACBS', data: records[base] }] : [] }, fileIdx: 0 };
    },
    makeProperty: () => {},
    destroyActor: (id) => set(id, 'gone', true),
    sendCustomPacket: () => {},
    setHoster: () => {},
  };
  const actor = (id, base, profile, pos) => {
    set(id, 'baseDesc', descOf(base)); set(id, 'isDead', false); set(id, 'pos', pos);
    set(id, 'worldOrCellDesc', '3c:Skyrim.esm'); set(id, 'angle', [0, 0, 0]);
    if (profile >= 0) set(id, 'profileId', profile);
  };
  actor(A, PLAYER_BASE, 11, [0, 0, 0]); actor(B, PLAYER_BASE, 12, [300, 0, 0]); actor(NPC, 0x23abf, -1, [200, 200, 0]);
  let nextId = 0xff000500;
  globalThis.__ckPlace = (_mp, _ownerId, baseDesc, loc) => { const id = nextId++; actor(id, parseInt(baseDesc, 16), -1, loc.pos); return id; };
  const ended = [];
  globalThis.__dboCompanionEnded = (info, reason) => ended.push([info.kind, info.id, reason]);
  let pvpRule = false;
  globalThis.__dboCompanionMayFight = () => pvpRule;

  const ctx = { svr: mp, gm: { on() {}, once() {}, emit() {} } };
  process.chdir(out);
  const sys = new CompanionSystem((...x) => logs.push(x.join(' ')));
  await sys.initAsync(ctx);
  const api = globalThis.__dboCompanions;

  const summon = sys.spawn(A, SUMMON_BASE, { kind: 'summon' });
  const pet = sys.spawn(A, HARE, { kind: 'pet', persistent: true });
  const tame = sys.spawn(A, WOLF, { kind: 'tame', persistent: true });
  const horse = sys.spawn(A, HORSE, { kind: 'mount' });
  check('a summon, a pet, a tame and a mount spawn side by side', [summon, pet, tame, horse].every(Boolean) && sys.list(A).length === 4, sys.list(A).map((c) => c.kind));
  check('the summon keeps its slot beside them', !!sys.info(summon));

  // Orders and defence
  check('a pet takes no attack order', sys.orderAttack(pet, NPC) === false);
  check('a mount takes no attack order', sys.orderAttack(horse, NPC) === false);
  check('a tame takes an attack order on an NPC', sys.orderAttack(tame, NPC) === true && sys.info(tame).targetId === NPC);
  sys.orderFollow(tame);
  sys.defend(A, NPC);
  check('defending: the tame turns on the NPC', sys.info(tame).targetId === NPC);
  check('defending: the pet does not', sys.info(pet).targetId === 0);
  check('defending: the mount does not', sys.info(horse).targetId === 0);

  // Blows
  const hit = (agg, tgt) => mp.onHitDamageAttempt(agg, tgt, 0, 10);
  check('a pet\'s blow on an NPC never lands', hit(pet, NPC) === false);
  check('a mount\'s blow on a player never lands', hit(horse, B) === false);
  check('a player\'s blow on someone\'s pet never lands', hit(B, pet) === false);
  check('an NPC\'s blow on a pet never lands', hit(NPC, pet) === false);
  check('a blow on a mount lands (it can be hurt)', hit(NPC, horse) === true);
  check('a tame\'s blow on an NPC lands', hit(tame, NPC) === true);
  check('a tame\'s blow on a player with no fight between them never lands', hit(tame, B) === false);
  pvpRule = true;
  hit(B, A);
  check('...and lands once the players fight and the PvP rule agrees', hit(tame, B) === true);
  pvpRule = false;

  // One of each kind
  const pet2 = sys.spawn(A, HARE, { kind: 'pet', persistent: true });
  check('a second pet replaces the first', !sys.info(pet) && !!sys.info(pet2));
  check('...the hook hears the first one replaced', ended.some(([k, id, r]) => k === 'pet' && id === pet && r === 'replaced'), ended);
  check('...and the summon is untouched', !!sys.info(summon));
  const tame2 = sys.spawn(A, WOLF, { kind: 'tame', persistent: true });
  check('a second tame replaces the first', !sys.info(tame) && !!sys.info(tame2));
  check('another player\'s pet does not replace mine', !!sys.spawn(B, HARE, { kind: 'pet' }) && !!sys.info(pet2));

  // A death reaches the hook
  set(horse, 'isDead', true);
  await sys.updateAsync();
  check('a mount that dies ends with reason "died"', ended.some(([k, id, r]) => k === 'mount' && id === horse && r === 'died'), ended);

  // Level
  check('level reads the wolf\'s ACBS level', api.level(tame2) === 6, api.level(tame2));
  check('level of a hare is 1', api.level(pet2) === 1, api.level(pet2));

  // The registry keeps the kinds of persistent ones
  const reg = JSON.parse(fs.readFileSync(path.join(out, 'companions.json'), 'utf8'));
  const kinds = reg.active.filter((x) => x.ownerId === A).map((x) => x.kind).sort();
  check('the registry holds the pet and the tame with their kinds', kinds.includes('pet') && kinds.includes('tame'), kinds);
  const sys2 = new CompanionSystem(() => {});
  await sys2.initAsync(ctx);
  const assign = [];
  sys2.spawn = (owner, base, opts) => { assign.push(opts.kind); return 1; };
  sys2['onOwnerAssigned'](A);
  check('after a restart the owner\'s pet and tame are placed again with their kinds', assign.includes('pet') && assign.includes('tame'), assign);

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
