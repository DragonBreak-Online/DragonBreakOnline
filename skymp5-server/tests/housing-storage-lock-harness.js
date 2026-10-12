// Scripted test for housingSystem.ts storage locks (Nate, 12 Oct, ticket #0138): a claimed chest starts locked, a door does
// not; every lock and unlock is logged with who did it; and the chests left open before this are locked once, after boot,
// waiting while claims read as null, with a marker file so it never runs twice. Run it from skymp5-server with node_modules:
//
//   node tests/housing-storage-lock-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-housing-'));
const bundle = path.join(out, 'housing.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'housingSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error' });
  const { HousingSystem } = require(bundle);
  const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(fs.readFileSync(bundle, 'utf8')) || [])[1];
  const cwd = process.cwd(); process.chdir(out);

  const CHEST = 0x100, DOOR = 0x200, OPEN = 0x300, SHUT = 0x400, MEMBER = 0x500, DOORREC = 0x600, LATE = 0x700;
  const OWNER = 0xff000014, USER = 3;
  const props = new Map(), logs = [], notices = [];
  const mp = {
    get: (id, key) => {
      if (key === 'profileId') return id === OWNER ? 55 : 0;
      if (key === 'appearance') return { name: 'Kalidore' };
      const v = props.get(`${id >>> 0}:${key}`); return v === undefined ? undefined : JSON.parse(v);
    },
    set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
    getUserByActor: (id) => (id === OWNER ? USER : -1), getUserActor: (u) => (u === USER ? OWNER : 0),
    isConnected: () => false, sendCustomPacket: () => { },
  };
  const ctx = { svr: mp };
  const sys = new HousingSystem((m) => logs.push(m));
  sys.holdOf = () => null; sys.isAdmin = () => false; sys.holdRanks = () => []; sys.saveRegistry = () => { };
  sys.partnerOf = (_c, id) => (id === DOOR ? 0x201 : 0);
  sys.notice = (_c, _u, t) => notices.push(t); sys.sendMenu = () => { }; sys.overCap = () => ''; sys.ensurePlace = () => { };
  sys.openClaims = true; sys.claimed = [];
  const recOf = (id) => sys.read(ctx, id);
  const blank = () => ({ owner: 0, ownerName: '', name: null, locked: false, serial: 1, partner: 0, containers: [], issued: [] });

  mp.set(CHEST, HP, blank()); mp.set(DOOR, HP, blank());
  sys.doClaim(ctx, USER, OWNER, CHEST, recOf(CHEST), false);
  check('a claimed chest starts locked', recOf(CHEST).owner === 55 && recOf(CHEST).locked === true, recOf(CHEST));
  check('the owner is told it is locked', /locked\. Unlock it from this menu/.test(notices.pop()));
  sys.doClaim(ctx, USER, OWNER, DOOR, recOf(DOOR), false);
  check('a claimed door is left as it was', recOf(DOOR).owner === 55 && recOf(DOOR).locked === false && notices.pop() === 'This is yours now.');

  logs.length = 0;
  sys.doLock(ctx, USER, OWNER, CHEST, recOf(CHEST), false);
  sys.doLock(ctx, USER, OWNER, CHEST, recOf(CHEST), true);
  check('unlock and lock are logged with the ref, owner and who did it', logs[0] === '[housing] UNLOCK 100 "" owner 55 by Kalidore (profile 55)' && /^\[housing\] LOCK 100 /.test(logs[1]), logs);

  // the one-time lock of what was left open
  const owned = (o) => Object.assign(blank(), { owner: 55, ownerName: 'K' }, o);
  mp.set(OPEN, HP, owned({})); mp.set(SHUT, HP, owned({ locked: true })); mp.set(MEMBER, HP, owned({ memberOf: 0x999 })); mp.set(DOORREC, HP, owned({ partner: 0x601 }));
  sys.claimed = [OPEN, SHUT, MEMBER, DOORREC, LATE];
  check('no marker yet', !fs.existsSync('housing-storage-locked.json'));
  check('it waits while a claim reads as null', sys.lockOpenStorage(ctx, false) === false && recOf(OPEN).locked === false);
  mp.set(LATE, HP, owned({}));
  logs.length = 0;
  check('once every claim reads, it runs', sys.lockOpenStorage(ctx, false) === true);
  check('open chests are locked', recOf(OPEN).locked === true && recOf(LATE).locked === true);
  check('doors and place members are untouched', recOf(DOORREC).locked === false && recOf(MEMBER).locked === false);
  const marker = JSON.parse(fs.readFileSync('housing-storage-locked.json', 'utf8'));
  check('the marker lists what it locked', JSON.stringify(marker.locked) === JSON.stringify(['300', '700']) && marker.unreadable === 0, marker);
  check('the log says so', /storage lock: 2 open chest\(s\) locked: 300 700/.test(logs.join('\n')), logs);
  const again = new HousingSystem(() => { });
  check('a new boot sees the marker and never runs it again', again.storageLockDone === true);

  process.chdir(cwd);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
