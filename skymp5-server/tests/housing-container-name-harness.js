// Scripted test for housingSystem.ts container names (Nat, 10 Nov): a container inside a place keeps its own name, so
// Rename on a barrel names that barrel and never the place (a mine, 58d54, was renamed "Entrance Barrel 1" from its barrels).
// The place is still renamed from its doors, or from anywhere in it with renameplace. Run it from skymp5-server:
//
//   node tests/housing-container-name-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = path.resolve(fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-container-name-')));
const bundle = path.join(out, 'housing.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'housingSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error' });
  const { HousingSystem } = require(bundle);
  const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(fs.readFileSync(bundle, 'utf8')) || [])[1];
  const cwd = process.cwd(); process.chdir(out);

  // The mine's entrance (root), an inner door, a barrel that is a member, a barrel nobody claimed in the mine's cells
  const ROOT = 0x58d54, INNER = 0x400, BARREL = 0x500, LOOSE = 0x700, OUTSIDE = 0x900;
  const OWNER = 0xff000010, TENANT = 0xff000011, STRANGER = 0xff000012;
  const PROFILE = { [OWNER]: 501, [TENANT]: 502, [STRANGER]: 503 };
  const USER = { [OWNER]: 1, [TENANT]: 2, [STRANGER]: 3 };
  const props = new Map();
  const sent = [];
  const mp = {
    get: (id, key) => {
      if (key === 'profileId') return PROFILE[id >>> 0] || 0;
      if (key === 'inventory') return { entries: [] };
      const v = props.get(`${id >>> 0}:${key}`); return v === undefined ? undefined : JSON.parse(v);
    },
    set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
    getUserActor: (u) => Number(Object.keys(USER).find((a) => USER[a] === u)) || 0,
    getUserByActor: (a) => USER[a >>> 0] ?? -1,
    getActorsByProfileId: () => [],
    isConnected: () => true,
    sendCustomPacket: (u, s) => sent.push({ u, p: JSON.parse(s) }),
  };
  const ctx = { svr: mp };
  const lines = [];
  const sys = new HousingSystem((...a) => lines.push(a.join(' ')));
  sys.placeMigration = 'apply';
  sys.holdOf = () => null; sys.isAdmin = () => false; sys.holdRanks = () => []; sys.isFiefHolder = () => false;
  sys.nearProperty = () => true;
  sys.inDungeon = () => false;
  sys.primaryOf = (_c, ref) => ref >>> 0;
  sys.partnerOf = (_c, id) => ({ [ROOT]: 0x58d55, [INNER]: 0x401 })[id] || 0;
  sys.cellOf = () => 0;
  sys.baseTypeOf = (_c, id) => ([BARREL, LOOSE, OUTSIDE].includes(id) ? 'CONT' : 'DOOR');
  sys.isEntrance = (_c, id) => id === ROOT;
  sys.cellDescOf = (_c, id) => ([INNER, BARREL, LOOSE, 0x58d55, 0x401].includes(id) ? 'mine' : 'world');
  sys.isWorldDesc = (_c, d) => d === 'world';
  sys.refsInCell = () => [INNER, BARREL, LOOSE];
  sys.labelOf = (_c, ref) => (ref === INNER ? 'Door' : 'Barrel');
  sys.claimed = [ROOT, INNER, BARREL];

  const owned = (o) => Object.assign({ owner: 501, ownerName: 'Miner', name: null, locked: false, serial: 1, partner: 0, containers: [], issued: [] }, o);
  mp.set(ROOT, HP, owned({ name: 'Embershard Mine', partner: 0x58d55, place: { cells: ['mine'], builtAt: 1 }, assigned: { '500': { profile: 502, name: 'Tenant' } } }));
  mp.set(INNER, HP, owned({ partner: 0x401, memberOf: ROOT }));
  mp.set(BARREL, HP, owned({ memberOf: ROOT }));
  mp.set(OUTSIDE, HP, owned({ name: 'Old Chest' }));
  sys.claimed.push(OUTSIDE);

  const nameOf = (ref) => { const r = sys.read(ctx, ref); return r ? r.name : undefined; };
  const ask = (actor, target, action, name) => { sys.lastRequestMs.clear(); lines.length = 0; sys.onPropertyRequest(ctx, USER[actor], { target, action, name }); };
  const decorName = (ref) => { const e = sys.decorRefs(ctx).find((r) => r.refId === ref); return e ? e.name : undefined; };

  // Before any rename: doors of the mine show its name, its barrel only its own (none, so the base object's)
  check('a door of the place shows the place\'s name', decorName(INNER) === 'Embershard Mine', decorName(INNER));
  check('a member barrel does not wear the place\'s name', decorName(BARREL) === null, decorName(BARREL));

  ask(OWNER, BARREL, 'rename', 'Entrance Barrel 1');
  check('renaming a member barrel leaves the place\'s name alone', nameOf(ROOT) === 'Embershard Mine', nameOf(ROOT));
  check('...and names that barrel', nameOf(BARREL) === 'Entrance Barrel 1', nameOf(BARREL));
  check('...which its decor shows', decorName(BARREL) === 'Entrance Barrel 1', decorName(BARREL));
  check('...while the doors keep the place\'s name', decorName(ROOT) === 'Embershard Mine' && decorName(INNER) === 'Embershard Mine', [decorName(ROOT), decorName(INNER)]);
  check('...and the audit line is the barrel\'s', lines.some((l) => /AUDIT rename 500 .*name none -> "Entrance Barrel 1"; changed$/.test(l)), lines);

  ask(OWNER, LOOSE, 'rename', 'Ore Barrel');
  check('renaming a barrel nobody claimed in the place leaves the place\'s name alone', nameOf(ROOT) === 'Embershard Mine', nameOf(ROOT));
  const loose = sys.read(ctx, LOOSE);
  check('...and names that barrel, stored as a member of the place under the owner', !!loose && loose.name === 'Ore Barrel' && loose.memberOf === ROOT && loose.owner === 501, loose);
  check('...kept in the claim index, so the name survives a restart', sys.claimed.includes(LOOSE));
  check('...and shown by its decor', decorName(LOOSE) === 'Ore Barrel', decorName(LOOSE));

  ask(TENANT, BARREL, 'rename', 'Mine Now');
  check('the barrel\'s assignee cannot rename it', nameOf(BARREL) === 'Entrance Barrel 1', nameOf(BARREL));
  ask(STRANGER, LOOSE, 'rename', 'Mine Now');
  check('a stranger cannot rename a barrel in the place', nameOf(LOOSE) === 'Ore Barrel', nameOf(LOOSE));

  ask(OWNER, INNER, 'rename', 'Embershard Hold');
  check('Rename on a door of the place still renames the place', nameOf(ROOT) === 'Embershard Hold' && nameOf(INNER) === null, [nameOf(ROOT), nameOf(INNER)]);
  ask(OWNER, BARREL, 'renameplace', 'Embershard Mine');
  check('renameplace from a barrel renames the place', nameOf(ROOT) === 'Embershard Mine' && nameOf(BARREL) === 'Entrance Barrel 1', [nameOf(ROOT), nameOf(BARREL)]);
  ask(OWNER, OUTSIDE, 'rename', 'New Chest');
  check('a chest outside any place renames as before', nameOf(OUTSIDE) === 'New Chest', nameOf(OUTSIDE));

  // The menu says what its Rename names
  const menu = (target) => { sent.length = 0; sys.sendMenu(ctx, USER[OWNER], OWNER, target); const m = sent.find((x) => x.p.customPacketType === 'propertyMenu'); return m ? m.p : {}; };
  check('the menu on a member barrel renames a container, under its own name', menu(BARREL).renames === 'container' && menu(BARREL).name === 'Entrance Barrel 1', menu(BARREL));
  check('the menu on a door renames the place', menu(INNER).renames === 'place' && menu(ROOT).renames === 'place', [menu(INNER).renames, menu(ROOT).renames]);

  process.chdir(cwd);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(`\n${failures ? failures + ' FAILED' : 'all checks passed'}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
