// Scripted test: with housingKeyRing on, a key item cut on a pool record (house-keys.json, every key cut since 8 Oct) still
// opens its lock and moves onto the key ring at login. From the 13 Oct 06:14Z boot it did neither: houseKeys.ts knows the
// pool only after refreshKeyPool has read house-keys.json, and only keyBaseFor and migrateKeys called it, and neither runs
// with the ring on. So isPropertyKeyBase(0x3c18860d) was false, the key read as no key at all, ringAtLogin left it in the
// pack and the door refused it: Neem (profile 97) holds "Key to the Janitor's Hut (recut 2)" (base 3c18860d), the exact name
// the hut's record issued, was let in at 04:46Z and refused at 6ca04/6ca06 35 times from 06:29Z; 33 characters hold such keys.
//
//   node tests/keyring-pool-keys-harness.js [--fork <skymp5-server dir>] [--esbuild <esbuild package dir>]
//   (or FORK_SERVER=<fork with skymp5-server>, as tests/run-all.sh sets)
//
// Each check runs on a fresh bundle of the fork's housingSystem.ts, so nothing has read the pool before it, as after a boot.
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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined && !ok ? '   ' + JSON.stringify(detail) : ''}`);
  if (!ok) failures++;
};

const DLE = 0x3c000000;
const POOL = ['18860d:DragonBreak Online Edits.esp', '18860e:DragonBreak Online Edits.esp'];
const KEY_BASE = (DLE | 0x18860d) >>> 0;
const HUT = 0x0806ca04, CHEST = 0x0807586d, HOLDER = 0xff001415, HOLDER_USER = 7;
const KEY = "Key to the Janitor's Hut (recut 2)";

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
  const mp = {
    get: (id, key) => { if (key === 'profileId') return id === HOLDER ? 97 : 0; const v = props.get(`${id >>> 0}:${key}`); return v === undefined ? undefined : JSON.parse(v); },
    set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
    getUserByActor: (id) => (id === HOLDER ? HOLDER_USER : -1),
    getUserActor: (u) => (u === HOLDER_USER ? HOLDER : 0),
    isConnected: (u) => u === HOLDER_USER,
    get onlinePlayers() { return [HOLDER]; },
    sendCustomPacket: () => { },
    getIdFromDesc: (d) => { const m = /^([0-9a-f]+):DragonBreak Online Edits\.esp$/i.exec(String(d)); return m ? (DLE | parseInt(m[1], 16)) >>> 0 : 0; },
    getDescFromId: (id) => `${(id & 0xffffff).toString(16)}:BSHeartland.esm`,
    lookupEspmRecordById: (id) => ((id >>> 24) === (DLE >>> 24) ? { record: { type: 'KEYM' } } : null),
  };
  const ctx = { svr: mp };
  const housing = new HousingSystem(() => { });
  housing.keyRing = true;
  housing.holdOf = () => null; housing.isAdmin = () => false; housing.holdRanks = () => []; housing.partnerOf = () => 0;
  housing.saveRegistry = () => { }; housing.pushDecor = () => { }; housing.notice = () => { }; housing.baseTypeOf = () => 'CONT';
  housing.claimed = [HUT];
  mp.set(HUT, HP, { owner: 49, ownerName: 'Lord Elion', name: "Janitor's Hut", locked: true, serial: 3, partner: 0, containers: [], issued: [KEY], keyBase: KEY_BASE });
  return { housing, ctx, mp, RING, rec: () => housing.read(ctx, HUT) };
};

(async () => {
  if (!forkDir || !esbuildDir) { console.log('SKIP  no fork with esbuild'); process.exit(0); }
  const esbuild = require(esbuildDir);
  const scratch = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-post-ringpool-'));
  const cwd = process.cwd();
  process.chdir(scratch);
  fs.writeFileSync('house-keys.json', JSON.stringify({ pool: POOL }));
  try {
    console.log(`-- ${forkDir}`);
    let t = await fresh(esbuild, scratch);
    t.mp.set(HOLDER, 'inventory', { entries: [{ baseId: KEY_BASE, count: 1, name: KEY }] });
    check('right after boot, a key item on a pool record opens the lock its name was issued for',
      t.housing.hasAccess(t.ctx, HUT, t.rec(), HOLDER) === true);

    t = await fresh(esbuild, scratch);
    t.mp.set(HOLDER, 'inventory', { entries: [{ baseId: KEY_BASE, count: 1, name: KEY }, { baseId: 0xf, count: 5 }] });
    t.housing.ringAtLogin(t.ctx, HOLDER);
    const ring = t.mp.get(HOLDER, t.RING) || [];
    const pack = (t.mp.get(HOLDER, 'inventory') || {}).entries || [];
    check('at the first login after boot the pool key moves onto the ring', ring.some((k) => k.n === KEY && k.p === HUT), ring);
    check('...leaves the pack (gold kept)', !pack.some((e) => e.name === KEY) && pack.some((e) => e.baseId === 0xf), pack);
    check('...and the ring key opens the door', t.housing.hasAccess(t.ctx, HUT, t.rec(), HOLDER) === true);
    check('...and the lock records who holds it', !!(t.rec().holders && t.rec().holders[KEY]), t.rec().holders);

    t = await fresh(esbuild, scratch);
    t.mp.set(CHEST, 'inventory', { entries: [{ baseId: KEY_BASE, count: 1, name: KEY }] });
    t.housing.takeKeysFrom(t.ctx, CHEST, HOLDER);
    check('a pool key left in a container goes onto the ring of whoever opens it',
      (t.mp.get(HOLDER, t.RING) || []).some((k) => k.n === KEY) && !((t.mp.get(CHEST, 'inventory') || {}).entries || []).length);

    // A key no lock accepts (its lock was recut) stayed in a container and could not be taken out (GM ticket 152, 17 Oct):
    // whoever opens it takes it into the pack, never onto the ring and never destroyed (fork dead-keys-out)
    t = await fresh(esbuild, scratch);
    t.mp.set(CHEST, 'inventory', { entries: [{ baseId: KEY_BASE, count: 1, name: 'Key to Nowhere (recut 9)' }, { baseId: 0xf, count: 3 }] });
    t.mp.set(HOLDER, 'inventory', { entries: [] });
    t.housing.takeKeysFrom(t.ctx, CHEST, HOLDER);
    const chestLeft = (t.mp.get(CHEST, 'inventory') || {}).entries || [], packNow = (t.mp.get(HOLDER, 'inventory') || {}).entries || [];
    if (typeof t.housing.ringFromItems === 'function' && (t.housing.ringFromItems(t.ctx, [], HOLDER) || {}).dead) {
      check('a key that opens nothing leaves the container for the opener\'s pack (gold stays)',
        !chestLeft.some((e) => e.name === 'Key to Nowhere (recut 9)') && chestLeft.some((e) => e.baseId === 0xf) && packNow.some((e) => e.name === 'Key to Nowhere (recut 9)'), { chestLeft, packNow });
      check('...and never onto the key ring', !(t.mp.get(HOLDER, t.RING) || []).some((k) => k.n === 'Key to Nowhere (recut 9)'));
    } else console.log('skipped: this fork keeps dead keys in containers (before dead-keys-out)');

    t = await fresh(esbuild, scratch);
    t.mp.set(HOLDER, 'inventory', { entries: [{ baseId: KEY_BASE, count: 1, name: KEY }] });
    const r = t.rec();
    t.housing.reKey(t.ctx, HUT, r);
    check('changing the locks takes a pool key item off an online holder',
      !(((t.mp.get(HOLDER, 'inventory') || {}).entries || []).some((e) => e.name === KEY)));
  } finally {
    process.chdir(cwd);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} FAILED` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
