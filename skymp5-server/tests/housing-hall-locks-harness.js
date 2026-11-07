// Scripted test for housingSystem.ts hall locks (Nat, 7 Nov, #bug-tracker 1566332108966858856): in a faction's hall a plain
// member gets the ways in and the shared chests, while each room and chest keeps its own lock; the hall's keepers
// (guilds.js __dboHallKeeper) open them all, and gameplay without that hook keeps the old rule. Run it from skymp5-server:
//
//   node tests/housing-hall-locks-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = path.resolve(fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-hall-locks-')));
const bundle = path.join(out, 'housing.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'housingSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error' });
  const { HousingSystem } = require(bundle);
  const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(fs.readFileSync(bundle, 'utf8')) || [])[1];
  const cwd = process.cwd(); process.chdir(out);

  // The hall's front door (root), a back door to the world, a room assigned to one member, an inner door nobody holds,
  // a chest the owner keeps, a chest the owner shares; and an unclaimed chest and door in the hall's cells
  const ROOT = 0x100, BACK = 0x200, ROOM = 0x300, INNER = 0x400, CHEST = 0x500, SHARED = 0x600, LOOSE = 0x700, LOOSEDOOR = 0x800;
  const LEADER = 0xff000010, MEMBER = 0xff000011, TENANT = 0xff000012, OUTSIDER = 0xff000013;
  const PROFILE = { [LEADER]: 501, [MEMBER]: 502, [TENANT]: 503, [OUTSIDER]: 504 };
  const props = new Map();
  const mp = {
    get: (id, key) => {
      if (key === 'profileId') return PROFILE[id >>> 0] || 0;
      if (key === 'inventory') return { entries: [] };
      const v = props.get(`${id >>> 0}:${key}`); return v === undefined ? undefined : JSON.parse(v);
    },
    set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
  };
  const ctx = { svr: mp };
  const sys = new HousingSystem(() => { });
  sys.placeMigration = 'apply';
  sys.holdOf = () => null; sys.isAdmin = () => false; sys.holdRanks = () => []; sys.isFiefHolder = () => false;
  sys.baseTypeOf = (_c, id) => ([CHEST, SHARED, LOOSE].includes(id) ? 'CONT' : 'DOOR');
  sys.isEntrance = (_c, id) => id === ROOT || id === BACK;
  sys.claimed = [ROOT, BACK, ROOM, INNER, CHEST, SHARED];

  const owned = (o) => Object.assign({ owner: 501, ownerName: 'Leader', name: null, locked: true, serial: 1, partner: 0, containers: [], issued: [] }, o);
  mp.set(ROOT, HP, owned({ partner: 0x101, place: { cells: ['hall'], builtAt: 1 }, assigned: { '300': { profile: 503, name: 'Tenant' } }, shared: ['600'] }));
  mp.set(BACK, HP, owned({ partner: 0x201, memberOf: ROOT }));
  mp.set(ROOM, HP, owned({ partner: 0x301, memberOf: ROOT }));
  mp.set(INNER, HP, owned({ partner: 0x401, memberOf: ROOT }));
  mp.set(CHEST, HP, owned({ memberOf: ROOT }));
  mp.set(SHARED, HP, owned({ memberOf: ROOT }));

  // guilds.js: the leader and the member are in the faction whose hall this is; the tenant and the outsider are not
  const inFaction = new Set([LEADER, MEMBER]);
  globalThis.__dboHallMember = (_refs, _owner, actor) => inFaction.has(actor >>> 0);
  const opens = (ref, actor) => sys.hasAccess(ctx, ref, sys.read(ctx, ref), actor);
  const loose = (ref, actor) => { const r = sys.read(ctx, ROOT); return sys.placeRefAccess(ctx, ROOT, r, ref, sys.viewerAccess(ctx, actor)); };

  // Gameplay older than __dboHallKeeper: every member opens every lock, as before
  check('without the keeper hook a member still opens a kept chest (unchanged rule)', opens(CHEST, MEMBER) === true);

  globalThis.__dboHallKeeper = (_refs, actor) => (actor >>> 0) === LEADER;
  check('a member opens the front door', opens(ROOT, MEMBER) === true);
  check('...and the back door', opens(BACK, MEMBER) === true);
  check('...and a chest the owner shares', opens(SHARED, MEMBER) === true);
  check("...but not a room assigned to someone else", opens(ROOM, MEMBER) === false);
  check('...nor a chest the owner keeps', opens(CHEST, MEMBER) === false);
  check('...nor an inner door with its own lock', opens(INNER, MEMBER) === false);
  check('...nor an unclaimed chest in the hall', loose(LOOSE, MEMBER) === false);
  check('an unclaimed inner door stays open, as a house\'s are', loose(LOOSEDOOR, MEMBER) === true);
  check('the tenant opens their own room', opens(ROOM, TENANT) === true);
  check("the leader (a keeper, not the owner's profile here) opens every lock", (() => { PROFILE[LEADER] = 509; const r = [ROOT, BACK, ROOM, INNER, CHEST, SHARED].every((x) => opens(x, LEADER)) && loose(LOOSE, LEADER); PROFILE[LEADER] = 501; return r; })());
  check('an outsider opens nothing locked', [ROOT, BACK, ROOM, INNER, CHEST, SHARED].every((x) => !opens(x, OUTSIDER)));

  process.chdir(cwd);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(`\n${failures ? failures + ' FAILED' : 'all checks passed'}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
