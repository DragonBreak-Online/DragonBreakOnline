// Scripted test: with housingKeyRing on, old property keys cut on the vanilla Werewolf Cage Key (0xdb0e2) that open no lock
// any more are thrown away (fork housingSystem.ts deadLegacyKeys). Pippin the Tall (#8BR9, 20 Oct) took two such keys from a
// chest (05:54Z "took 2 key(s) that open nothing from container 806d16a"); the game stacks both under one name, so the
// client's apply took them off and gave them back every 5 s ("invKeys keys rebuilt": held "...No. 4", server "...No. 5"),
// the pickup notice cycled "Werewolf Cage Key (2)" and they could not be dropped.
//
//   node tests/keyring-dead-keys-harness.js [--fork <skymp5-server dir>] [--esbuild <esbuild package dir>]
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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined && !ok ? '   ' + JSON.stringify(detail) : ''}`);
  if (!ok) failures++;
};

const CAGE = 0x000db0e2;
const HUT = 0x0806ca04, OTHER = 0x0806cb00, CHEST = 0x0806d16a, HOLDER = 0xff0019fc, HOLDER_USER = 7;
const LIVE = "Key to the Janitor's Hut (recut 2)";
const DEAD4 = "Key to the Neem's Nest (recut) No. 4", DEAD5 = "Key to the Neem's Nest (recut) No. 5";
const item = (name, base = CAGE) => ({ baseId: base, count: 1, name });

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
  const mp = {
    get: (id, key) => { if (key === 'profileId') return id === HOLDER ? 55 : 0; const v = props.get(`${id >>> 0}:${key}`); return v === undefined ? undefined : JSON.parse(v); },
    set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
    getUserByActor: (id) => (id === HOLDER ? HOLDER_USER : -1),
    getUserActor: (u) => (u === HOLDER_USER ? HOLDER : 0),
    isConnected: (u) => u === HOLDER_USER,
    get onlinePlayers() { return [HOLDER]; },
    sendCustomPacket: () => { },
    getIdFromDesc: () => 0,
    lookupEspmRecordById: () => null,
  };
  const ctx = { svr: mp };
  const housing = new HousingSystem((m) => logs.push(String(m)));
  housing.keyRing = true;
  housing.holdOf = () => null; housing.isAdmin = () => false; housing.holdRanks = () => []; housing.partnerOf = () => 0;
  housing.saveRegistry = () => { }; housing.pushDecor = () => { }; housing.notice = (c, u, t) => notices.push(t); housing.baseTypeOf = () => 'CONT';
  housing.claimed = [HUT, OTHER];
  mp.set(HUT, HP, { owner: 49, ownerName: 'Lord Elion', name: "Janitor's Hut", locked: true, serial: 3, partner: 0, containers: [], issued: [LIVE] });
  mp.set(OTHER, HP, { owner: 50, ownerName: 'Someone', name: 'Other House', locked: true, serial: 2, partner: 0, containers: [], issued: [] });
  const pack = () => (mp.get(HOLDER, 'inventory') || {}).entries || [];
  return { housing, ctx, mp, HP, RING, logs, notices, pack };
};

(async () => {
  if (!forkDir || !esbuildDir) { console.log('SKIP  no fork with esbuild'); process.exit(0); }
  if (!/deadLegacyKeys/.test(fs.readFileSync(path.join(forkDir, 'ts', 'systems', 'housingSystem.ts'), 'utf8'))) {
    require('./expect')('keyring-dead-keys', 'this housingSystem keeps old keys that open nothing');
    console.log('SKIP  this housingSystem has no deadLegacyKeys'); process.exit(0);
  }
  const esbuild = require(esbuildDir);
  const scratch = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-deadkeys-'));
  const cwd = process.cwd();
  process.chdir(scratch);
  try {
    console.log(`-- ${forkDir}`);
    let t = await fresh(esbuild, scratch);
    const vanilla = { baseId: CAGE, count: 1 }; // the real Werewolf Cage Key from its dungeon: no name extra
    t.mp.set(HOLDER, 'inventory', { entries: [item(DEAD4), item(DEAD5), item(LIVE), vanilla, { baseId: 0xf, count: 5 }] });
    t.housing.ringAtLogin(t.ctx, HOLDER);
    let p = t.pack();
    check('at login two old keys that open nothing are thrown away', !p.some((e) => e.name === DEAD4 || e.name === DEAD5), p);
    check('...a live key moves onto the ring, not thrown away', (t.mp.get(HOLDER, t.RING) || []).some((k) => k.n === LIVE) && !p.some((e) => e.name === LIVE));
    check('...the unnamed vanilla Werewolf Cage Key and gold stay', p.some((e) => e.baseId === CAGE && !e.name) && p.some((e) => e.baseId === 0xf), p);
    check('...the player is told, and the log names them', t.notices.some((s) => s.includes(DEAD4) && s.includes('thrown away')) && t.logs.some((s) => s.includes('threw away 2') && s.includes(DEAD5)), [t.notices, t.logs]);

    t = await fresh(esbuild, scratch);
    t.mp.set(OTHER, t.HP, undefined); // a claimed record that does not read yet (lazy load after boot)
    t.mp.set(HOLDER, 'inventory', { entries: [item(DEAD4), item(DEAD5)] });
    t.housing.ringAtLogin(t.ctx, HOLDER);
    check('while any claimed lock does not read, nothing is thrown away', t.pack().length === 2, t.pack());

    t = await fresh(esbuild, scratch);
    t.housing.claimed = [];
    t.mp.set(HOLDER, 'inventory', { entries: [item(DEAD4)] });
    t.housing.ringAtLogin(t.ctx, HOLDER);
    check('with no claim registry loaded, nothing is thrown away', t.pack().length === 1, t.pack());

    t = await fresh(esbuild, scratch);
    t.mp.set(HOLDER, 'inventory', { entries: [item(DEAD4, 0x3c18860d)] });
    t.housing.ringAtLogin(t.ctx, HOLDER);
    check('a dead key on another record (not the cage key) is left alone', t.pack().length === 1, t.pack());

    t = await fresh(esbuild, scratch);
    t.mp.set(CHEST, 'inventory', { entries: [item(DEAD4), item(DEAD5), { baseId: 0x12345, count: 2 }] });
    t.mp.set(HOLDER, 'inventory', { entries: [] });
    t.housing.takeKeysFrom(t.ctx, CHEST, HOLDER);
    const chest = (t.mp.get(CHEST, 'inventory') || {}).entries || [];
    check('old keys in a chest leave it when it is opened', !chest.some((e) => e.baseId === CAGE) && chest.some((e) => e.baseId === 0x12345), chest);
    check('...and are not put in the opener\'s pack', !t.pack().some((e) => e.baseId === CAGE), t.pack());

    t = await fresh(esbuild, scratch);
    t.mp.set(OTHER, t.HP, undefined);
    t.mp.set(CHEST, 'inventory', { entries: [item(DEAD4)] });
    t.mp.set(HOLDER, 'inventory', { entries: [] });
    t.housing.takeKeysFrom(t.ctx, CHEST, HOLDER);
    check('while a lock does not read, a chest\'s dead key still goes to the opener as before', t.pack().some((e) => e.name === DEAD4), t.pack());
  } finally {
    process.chdir(cwd);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} FAILED` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
