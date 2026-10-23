// Scripted test: a key ITEM (the keys cut before the key ring, e.g. "Key to the Neem's Nest (recut) No. 4") stops opening a
// property once the property has a new owner or, for a room of a place, a new tenant after the key was cut (fork
// housingSystem.ts itemKeyFresh, server-settings housingStaleItemKeys; Nate, 23 Oct). Also checks it composes with the
// dead-key cleanup (deadkeys-bug1020): a stale old key opens nothing, so it is thrown away at login instead of moving onto
// the ring.
//
//   node tests/stale-item-keys-harness.js [--fork <skymp5-server dir>] [--esbuild <esbuild package dir>]
//   (or FORK_SERVER=<fork with skymp5-server>, as tests/run-all.sh sets)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const firstExisting = (...ps) => ps.find((p) => p && fs.existsSync(p));
const env = (name, sub) => (process.env[name] ? path.join(process.env[name], sub) : undefined);
const forkDir = firstExisting(arg('--fork'), env('FORK_SERVER', 'skymp5-server'), env('FORK', 'skymp5-server'), '/home/nate/dragonbreak/fork/skymp5-server');
const esbuildDir = firstExisting(arg('--esbuild'), forkDir && path.join(forkDir, 'node_modules', 'esbuild'), '/home/nate/dragonbreak/fork/skymp5-server/node_modules/esbuild');

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined && !ok ? '   ' + JSON.stringify(detail).slice(0, 400) : ''}`);
  if (!ok) failures++;
};

const CAGE = 0x000db0e2;
const NEST = 0x08089d5f, ROOM = 0x08019802, HOLDER = 0xff0019fc, HOLDER_USER = 7, OWNER = 0xff001000, NEWOWNER = 0xff002000;
const OLDKEY = "Key to the Neem's Nest (recut) No. 4";
const CRED = 'Property Key (8089D5F-2)';
const ROOMKEY = "Key to the Neem's Nest: Room 2 (8019802)";
const item = (name, base = CAGE) => ({ baseId: base, count: 1, name });
let now = Date.UTC(2026, 9, 23, 12, 0);
const realNow = Date.now;

let n = 0;
const fresh = async (esbuild, scratch) => {
  const out = path.join(scratch, `housing-${++n}.js`);
  await esbuild.build({
    entryPoints: [path.join(forkDir, 'ts', 'systems', 'housingSystem.ts')], bundle: true, platform: 'node', format: 'cjs',
    outfile: out, logLevel: 'error', nodePaths: [path.dirname(esbuildDir)],
  });
  const src = fs.readFileSync(out, 'utf8');
  const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(src) || [])[1];
  const RING = (/KEY_RING_PROP\s*=\s*"([^"]+)"/.exec(src) || [])[1];
  const { HousingSystem } = require(out);
  const props = new Map();
  const logs = [], notices = [];
  const PROFILES = { [HOLDER]: 55, [OWNER]: 49, [NEWOWNER]: 60 };
  const mp = {
    get: (id, key) => { if (key === 'profileId') return PROFILES[id >>> 0] || 0; const v = props.get(`${id >>> 0}:${key}`); return v === undefined ? undefined : JSON.parse(v); },
    set: (id, key, value) => props.set(`${id >>> 0}:${key}`, value === undefined ? undefined : JSON.stringify(value)),
    getUserByActor: (id) => (id === HOLDER ? HOLDER_USER : -1),
    getUserActor: (u) => (u === HOLDER_USER ? HOLDER : 0),
    isConnected: (u) => u === HOLDER_USER,
    get onlinePlayers() { return [HOLDER]; },
    getActorsByProfileId: () => [],
    sendCustomPacket: () => { },
    getIdFromDesc: () => 0,
    lookupEspmRecordById: () => null,
  };
  const ctx = { svr: mp };
  const housing = new HousingSystem((m) => logs.push(String(m)));
  housing.keyRing = true;
  housing.holdOf = () => null; housing.isAdmin = () => false; housing.holdRanks = () => []; housing.partnerOf = () => 0;
  housing.isFiefHolder = () => false; housing.inHall = () => false; housing.nameOf = (c, a) => `actor ${a.toString(16)}`;
  housing.saveRegistry = () => { }; housing.pushDecor = () => { }; housing.notice = (c, u, t) => notices.push(t); housing.baseTypeOf = () => 'CONT';
  housing.claimed = [NEST];
  mp.set(NEST, HP, { owner: 49, ownerChar: OWNER, ownerName: 'Neem', name: "Neem's Nest", locked: true, serial: 2, partner: 0, containers: [], issued: [OLDKEY] });
  const pack = () => (mp.get(HOLDER, 'inventory') || {}).entries || [];
  const rec = (p = NEST) => housing.read(ctx, p);
  const opens = (p = NEST) => housing.hasAccess(ctx, p, rec(p), HOLDER);
  return { housing, ctx, mp, HP, RING, logs, notices, pack, rec, opens };
};

(async () => {
  if (!forkDir || !esbuildDir) { console.log('SKIP  no fork with esbuild'); process.exit(0); }
  if (!/itemKeyFresh/.test(fs.readFileSync(path.join(forkDir, 'ts', 'systems', 'housingSystem.ts'), 'utf8'))) {
    require('./expect')('stale-item-keys', 'this housingSystem honours key items cut before a change of owner');
    console.log('SKIP  this housingSystem has no itemKeyFresh'); process.exit(0);
  }
  const esbuild = require(esbuildDir);
  const scratch = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-stalekeys-'));
  const cwd = process.cwd();
  process.chdir(scratch);
  Date.now = () => now;
  try {
    console.log(`-- ${forkDir}`);
    let t = await fresh(esbuild, scratch);
    t.mp.set(HOLDER, 'inventory', { entries: [item(OLDKEY)] });
    check('an old key item opens a property that has not changed hands (as before)', t.opens());
    // The live Neem's Nest case: the lock's issued names still carry the old key (no re-key), and it changes hands
    let r = t.rec(); t.housing.setOwner(t.ctx, r, NEWOWNER, 60); t.mp.set(NEST, t.HP, r);
    check('a change of owner stamps changedAt', Number(t.rec().changedAt) === now, t.rec());
    check('...and the old key item no longer opens it, though its name is still issued', !t.opens() && t.rec().issued.includes(OLDKEY));
    r = t.rec(); const was = r.changedAt; now += 1000; t.housing.setOwner(t.ctx, r, NEWOWNER, 60);
    check('setting the same owner again is no change of hands', r.changedAt === was, r.changedAt);
    t.housing.staleItemKeys = false;
    check('housingStaleItemKeys false: the old key item opens again (rollback)', t.opens());
    t.housing.staleItemKeys = true;
    // A key cut after the change opens
    r = t.rec(); r.cutAt = { [OLDKEY]: now + 5 }; t.mp.set(NEST, t.HP, r);
    check('a key item cut after the change of hands opens', t.opens());
    // A credential-suffix key, cut before
    r = t.rec(); r.cutAt = {}; r.issued = []; t.mp.set(NEST, t.HP, r);
    t.mp.set(HOLDER, 'inventory', { entries: [item(CRED)] });
    check('an old "(TAG-serial)" key item stops opening too', !t.opens());
    r.changedAt = 0; delete r.changedAt; t.mp.set(NEST, t.HP, r);
    check('...and opened before the change (no changedAt)', t.opens());

    // Cutting a key item stamps its time, and prunes names no longer issued
    t = await fresh(esbuild, scratch);
    t.housing.keyRing = false;
    t.housing.commit = (ctx, u, p, rr) => t.housing.write(ctx, p, rr); t.housing.sendMenu = () => { }; t.housing.giveKey = () => true;
    r = t.rec(); r.cutAt = { 'Gone Key': 1 }; r.changedAt = now - 1000; t.mp.set(NEST, t.HP, r);
    t.housing.doCreateKey(t.ctx, HOLDER_USER, HOLDER, NEST, t.rec(), true);
    const cut = t.rec();
    const newName = cut.issued[cut.issued.length - 1];
    check('a key item cut without the ring records when it was cut', cut.cutAt && cut.cutAt[newName] === now && !('Gone Key' in cut.cutAt), cut.cutAt);
    t.mp.set(HOLDER, 'inventory', { entries: [item(newName)] });
    check('...and opens though the property changed hands before', t.opens());
    now += 1000;
    r = t.rec(); t.housing.setOwner(t.ctx, r, NEWOWNER, 60); t.mp.set(NEST, t.HP, r);
    check('...until it changes hands again', !t.opens());

    // A ring key is the owner's to see and take back: not judged by the item rule
    t = await fresh(esbuild, scratch);
    r = t.rec(); r.changedAt = now; t.mp.set(NEST, t.HP, r);
    t.mp.set(HOLDER, t.RING, [{ n: OLDKEY, p: NEST, at: now - 1, by: '' }]);
    t.mp.set(HOLDER, 'inventory', { entries: [] });
    check('a ring key with an issued name still opens (rings are not judged here)', t.opens());

    // Composition with the dead-key cleanup (deadkeys-bug1020): a stale old cage key opens nothing, so at login it is thrown
    // away and never moves onto the ring; a fresh one still moves onto the ring
    t = await fresh(esbuild, scratch);
    r = t.rec(); r.changedAt = now; t.mp.set(NEST, t.HP, r);
    t.mp.set(HOLDER, 'inventory', { entries: [item(OLDKEY), { baseId: 0xf, count: 5 }] });
    t.housing.ringAtLogin(t.ctx, HOLDER);
    check('at login a stale old key is thrown away, not moved onto the ring', !t.pack().some((e) => e.name === OLDKEY) && !(t.mp.get(HOLDER, t.RING) || []).some((k) => k.n === OLDKEY) && t.pack().some((e) => e.baseId === 0xf), [t.pack(), t.mp.get(HOLDER, t.RING)]);
    check('...and the player is told', t.notices.some((s) => s.includes(OLDKEY) && s.includes('thrown away')), t.notices);
    t = await fresh(esbuild, scratch);
    t.mp.set(HOLDER, 'inventory', { entries: [item(OLDKEY)] });
    t.housing.ringAtLogin(t.ctx, HOLDER);
    check('a key of a property that has not changed hands still moves onto the ring', (t.mp.get(HOLDER, t.RING) || []).some((k) => k.n === OLDKEY) && !t.pack().length, [t.pack(), t.mp.get(HOLDER, t.RING)]);

    // A room of a place: a new tenant (or none) stamps the room, and its old key items stop opening it
    t = await fresh(esbuild, scratch);
    t.housing.placesOn = () => true;
    t.housing.claimed = [NEST, ROOM];
    r = t.rec(); r.place = { cells: ['89d51:Skyrim.esm'], builtAt: 1 }; r.assigned = { [ROOM.toString(16)]: { profile: 70, name: 'Old Tenant', char: 0xff003000 } }; t.mp.set(NEST, t.HP, r);
    t.mp.set(ROOM, t.HP, { owner: 49, ownerName: 'Neem', name: null, locked: true, serial: 1, partner: 0, containers: [], issued: [ROOMKEY], memberOf: NEST });
    t.housing.isEntrance = () => true; t.housing.isPlaceContainer = () => false;
    t.mp.set(HOLDER, 'inventory', { entries: [item(ROOMKEY)] });
    check('a room key item opens its room before the tenant changes', t.opens(ROOM));
    t.housing.roomsOf = () => [{ ref: ROOM, label: 'Room 2', kind: 'door' }];
    t.housing.commit = (ctx, u, p, rr) => t.housing.write(ctx, p, rr); t.housing.sendMenu = () => { };
    now += 1000;
    t.housing.doRoom(t.ctx, 1, OWNER, NEST, t.rec(), true, 'assign', ROOM, NEWOWNER);
    check('assigning the room to a new tenant stamps the room', Number(t.rec(ROOM).changedAt) === now && t.rec().assigned[ROOM.toString(16)].profile === 60, [t.rec(ROOM), t.rec().assigned]);
    check('...and the old room key item no longer opens it', !t.opens(ROOM));
    const at = t.rec(ROOM).changedAt; now += 1000;
    t.housing.doRoom(t.ctx, 1, OWNER, NEST, t.rec(), true, 'assign', ROOM, NEWOWNER);
    check('assigning it to the same tenant again changes nothing', t.rec(ROOM).changedAt === at);
    now += 1000;
    t.housing.doRoom(t.ctx, 1, OWNER, NEST, t.rec(), true, 'unassign', ROOM);
    check('taking the room back from its tenant stamps it too', t.rec(ROOM).changedAt === now);
    // The place's root changing hands reaches its rooms
    t = await fresh(esbuild, scratch);
    t.housing.placesOn = () => true; t.housing.claimed = [NEST, ROOM];
    t.housing.isEntrance = () => true; t.housing.isPlaceContainer = () => false;
    r = t.rec(); r.place = { cells: ['x'], builtAt: 1 }; r.changedAt = now; t.mp.set(NEST, t.HP, r);
    t.mp.set(ROOM, t.HP, { owner: 49, ownerName: 'Neem', name: null, locked: true, serial: 1, partner: 0, containers: [], issued: [ROOMKEY], memberOf: NEST });
    t.mp.set(HOLDER, 'inventory', { entries: [item(ROOMKEY)] });
    check("a room's old key item stops opening once its place's root changed hands", !t.opens(ROOM));
    // read() keeps the new fields
    check('a record read back keeps changedAt and cutAt', t.rec().changedAt === now && (() => { const x = t.rec(); x.cutAt = { a: 1 }; t.mp.set(NEST, t.HP, x); return t.rec().cutAt.a === 1; })());
  } finally {
    Date.now = realNow;
    process.chdir(cwd);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} FAILED` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
