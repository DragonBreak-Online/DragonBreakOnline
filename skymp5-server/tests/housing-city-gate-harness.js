// Scripted test for housingSystem.ts city gates (Nat, 9 Nov: Jarl Ysra locked Windhelm's docks gate a17d2 on 1 Nov and it shut
// everyone out): a lock on a city gate is refused for anyone with a message, a lock left on one never holds it shut, and each boot
// clears the locks left on gates with an audit line each. A city gate is a door with a worldspace on both sides, or a listed ref.
// Run it from skymp5-server with node_modules:
//
//   node tests/housing-city-gate-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(process.platform !== 'win32' && fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-housing-'));
const bundle = path.join(out, 'housing.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'housingSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error' });
  const { HousingSystem } = require(bundle);
  const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(fs.readFileSync(bundle, 'utf8')) || [])[1];
  const cwd = process.cwd(); process.chdir(out);

  // The docks gate (listed), Solitude's gate (worldspace both sides, not listed), a house door (world to interior), a chest
  const DOCKS = 0xa17d2, DOCKS_IN = 0xa17d3, SOLGATE = 0x300, SOLGATE_IN = 0x301, HOUSE = 0x400, HOUSE_IN = 0x401, CHEST = 0x500, LATE = 0x600;
  const partners = { [DOCKS]: DOCKS_IN, [DOCKS_IN]: DOCKS, [SOLGATE]: SOLGATE_IN, [SOLGATE_IN]: SOLGATE, [HOUSE]: HOUSE_IN, [HOUSE_IN]: HOUSE };
  // The docks gate's cells read as unknown here, so only the list can name it a gate
  const cells = { [SOLGATE]: 'world:Tamriel', [SOLGATE_IN]: 'world:SolitudeWorld', [HOUSE]: 'world:Tamriel', [HOUSE_IN]: 'cell:Home', [CHEST]: 'cell:Home' };
  const JARL = 0xff000014, OTHER = 0xff000015, USER = 3, OTHER_USER = 4;
  const props = new Map(), logs = [], notices = [];
  const mp = {
    get: (id, key) => {
      if (key === 'profileId') return id === JARL ? 70 : id === OTHER ? 71 : 0;
      if (key === 'appearance') return { name: id === JARL ? 'Ysra' : 'Bysnwulf' };
      const v = props.get(`${id >>> 0}:${key}`); return v === undefined ? undefined : JSON.parse(v);
    },
    set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
    getUserByActor: (id) => (id === JARL ? USER : id === OTHER ? OTHER_USER : -1), getUserActor: (u) => (u === USER ? JARL : u === OTHER_USER ? OTHER : 0),
    isConnected: () => false, sendCustomPacket: () => { },
  };
  const ctx = { svr: mp };
  const sys = new HousingSystem((m) => logs.push(m));
  sys.holdOf = () => null; sys.isAdmin = () => false; sys.holdRanks = () => []; sys.saveRegistry = () => { };
  sys.partnerOf = (_c, id) => partners[id] || 0;
  sys.cellDescOf = (_c, id) => cells[id] || '';
  sys.isWorldDesc = (_c, d) => /^world:/.test(d);
  sys.primaryOf = (_c, id) => (id === DOCKS_IN ? DOCKS : id === SOLGATE_IN ? SOLGATE : id === HOUSE_IN ? HOUSE : id);
  sys.actorOf = (_c, u) => (u === USER ? JARL : OTHER);
  sys.nearProperty = () => true; sys.inDungeon = () => false; sys.placesOn = () => false;
  sys.notice = (_c, _u, t) => notices.push(t); sys.sendMenu = () => { }; sys.overCap = () => ''; sys.ensurePlace = () => { };
  sys.openClaims = true; sys.claimed = [];
  const recOf = (id) => sys.read(ctx, id);
  const owned = (o) => Object.assign({ owner: 70, ownerName: 'Jarl Ysra Stormcloak', name: null, locked: false, serial: 1, partner: 0, containers: [], issued: [] }, o);
  let t = 0;
  const ask = (target, action, user = USER) => { sys.lastRequestMs = new Map(); sys.onPropertyRequest(ctx, user, { target, action }); t++; };

  mp.set(DOCKS, HP, owned({ partner: DOCKS_IN }));
  mp.set(SOLGATE, HP, owned({ partner: SOLGATE_IN }));
  mp.set(HOUSE, HP, owned({ partner: HOUSE_IN }));
  mp.set(CHEST, HP, owned({}));

  // the refusal
  notices.length = 0; logs.length = 0;
  ask(DOCKS, 'lock');
  check('the owner cannot lock the docks gate (listed)', recOf(DOCKS).locked === false, recOf(DOCKS));
  check('...and is told why', notices[notices.length - 1] === 'City gates cannot be locked: they stay open for everyone.', notices);
  check('...and the refusal is logged with who asked', logs.some((l) => /^\[housing\] refused lock on city gate a17d2 for Ysra \(actor ff000014, profile 70\)$/.test(l)), logs);
  ask(DOCKS_IN, 'lock');
  check('aimed at the city side, the gate is refused too', recOf(DOCKS).locked === false);
  ask(SOLGATE, 'lock');
  check('a door with a worldspace on both sides is a gate, listed or not', recOf(SOLGATE).locked === false && /City gates/.test(notices[notices.length - 1]));
  sys.isManager = () => true; sys.isStaffOverride = () => true;
  ask(SOLGATE, 'lock', OTHER_USER);
  check('staff cannot lock a gate either', recOf(SOLGATE).locked === false);
  delete sys.isManager; delete sys.isStaffOverride;
  ask(HOUSE, 'lock');
  check('a house door still locks', recOf(HOUSE).locked === true, recOf(HOUSE));
  ask(CHEST, 'lock');
  check('a chest still locks', recOf(CHEST).locked === true);
  ask(HOUSE, 'unlock');

  // a lock already on a gate
  mp.set(DOCKS, HP, owned({ partner: DOCKS_IN, locked: true }));
  mp.set(HOUSE, HP, owned({ partner: HOUSE_IN, locked: true }));
  check('a locked gate opens for anyone', sys.onActivate(ctx, DOCKS_IN, OTHER) === true && sys.onActivate(ctx, DOCKS, OTHER) === true);
  check('a locked house door still refuses others', sys.onActivate(ctx, HOUSE, OTHER) === false);

  // the boot pass: the warm-up reads each claim once, one per update pass, and notes the locked gates; when done it unlocks them
  mp.set(SOLGATE, HP, owned({ partner: SOLGATE_IN, locked: true }));
  mp.set(LATE, HP, owned({ locked: true }));
  sys.claimed = [DOCKS, SOLGATE, HOUSE, CHEST, LATE];
  sys.warm = false; sys.warmQueue = sys.claimed.slice(); sys.warmStartMs = Date.now();
  logs.length = 0;
  for (let i = 0; i < 4; i++) sys.warmStep(ctx);
  check('nothing is unlocked while the warm-up runs', recOf(DOCKS).locked === true && recOf(SOLGATE).locked === true && !logs.some((l) => /city gates:/.test(l)));
  sys.warmStep(ctx);
  check('when the warm-up ends, both gates are unlocked, owners kept', recOf(DOCKS).locked === false && recOf(SOLGATE).locked === false && recOf(DOCKS).owner === 70);
  check('the house, the chest and the rest keep their locks', recOf(HOUSE).locked === true && recOf(CHEST).locked === true && recOf(LATE).locked === true);
  const audits = logs.filter((l) => /^\[housing\] AUDIT gate-unlock /.test(l));
  check('one audit line per gate, saying unlocked by the boot', audits.length === 2 && audits.every((l) => / by the boot \(city gates cannot be locked\): owner profile 70 "Jarl Ysra Stormcloak" -> .*, unlocked; changed$/.test(l)) && /AUDIT gate-unlock a17d2 /.test(audits.join('\n')), audits);
  check('a summary line names them', logs.some((l) => l === '[housing] city gates: 2 lock(s) cleared: a17d2 300'), logs);
  logs.length = 0;
  sys.warm = false; sys.warmQueue = sys.claimed.slice();
  for (let i = 0; i < 5; i++) sys.warmStep(ctx);
  check('a boot with nothing locked writes no audit line', !logs.some((l) => /AUDIT/.test(l)) && logs.includes('[housing] city gates: 0 lock(s) cleared'), logs);
  sys.warm = false; sys.warmQueue = [DOCKS]; mp.set(DOCKS, HP, owned({ partner: DOCKS_IN, locked: true }));
  await sys.updateAsync(ctx);
  check('the update loop drives it', recOf(DOCKS).locked === false && sys.warm === true);

  process.chdir(cwd);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
