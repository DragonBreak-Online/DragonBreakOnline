// Scripted test: the old-key cleanup (deadLegacyKeys, #8BR9 20 Oct) still runs while the registry holds a claim on a
// reference the load order no longer has. On 21 Oct the live registry held three such claims (80d9643 on BSHeartland,
// 48172d19 and 4812ae14 on DragonBreak Online Edits; "[housing] place plan ... 3 claim(s) on a reference the load order no
// longer has, left out"). read() is null for them for good, so "every claimed record reads" was never true: no "threw away"
// line since the 03:29Z deploy, and 52 dead named Werewolf Cage Keys stayed in 32 packs. A record that reads as null without
// throwing (not loaded yet after boot) still holds the cleanup back. It also checks what the cleanup does once it runs: only
// keys no lock accepts go, live keys (issued name, alias, credential suffix, no room on the ring) stay, it logs once and a
// second login or chest open changes nothing, and the deleted reference is read once, not on every pass.
// Bundles housingSystem.ts with esbuild on a fake mp. Run it from skymp5-server with node_modules present:
//
//   node tests/housing-dead-keys-gone-claim-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-deadkeys-gone-'));
const bundle = path.join(out, 'housing.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const CAGE = 0x000db0e2;
const HUT = 0x0806ca04, BARN = 0x0806cb00, MILL = 0x0806cc00, GONE = 0x080d9643, UNLOADED = 0x0806cd00, CHEST = 0x0806d16a;
const HOLDER = 0xff0019fc, HOLDER_USER = 7;
const LIVE = "Key to the Janitor's Hut (recut 2)";
const ALIASED = 'Key to the Old Barn';
const BY_CREDENTIAL = 'Mill Key (806CC00-2)';
const DEAD4 = "Key to the Neem's Nest (recut) No. 4", DEAD5 = "Key to the Neem's Nest (recut) No. 5";
const item = (name, base = CAGE) => ({ baseId: base, count: 1, name });

(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'housingSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error' });
  const { HousingSystem } = require(bundle);
  const src = fs.readFileSync(bundle, 'utf8');
  const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(src) || [])[1];
  const RING = (/KEY_RING_PROP\s*=\s*"([^"]+)"/.exec(src) || [])[1];
  const MAX_RING = Number((/MAX_KEYS_CARRIED\s*=\s*(\d+)/.exec(src) || [])[1]) || 64;

  const fresh = (claimed) => {
    const props = new Map();
    const logs = [], notices = [];
    let goneReads = 0;
    const mp = {
      get: (id, key) => {
        if ((id >>> 0) === GONE) { goneReads++; throw new Error(`Form with id 0x${GONE.toString(16)} doesn't exist`); }
        if (key === 'profileId') return id === HOLDER ? 55 : 0;
        const v = props.get(`${id >>> 0}:${key}`); return v === undefined ? undefined : JSON.parse(v);
      },
      set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
      getUserByActor: (id) => (id === HOLDER ? HOLDER_USER : -1),
      getUserActor: (u) => (u === HOLDER_USER ? HOLDER : 0),
      isConnected: (u) => u === HOLDER_USER,
      sendCustomPacket: () => { },
      getIdFromDesc: () => 0,
      lookupEspmRecordById: () => null,
    };
    const ctx = { svr: mp };
    const sys = new HousingSystem((m) => logs.push(String(m)));
    sys.keyRing = true;
    sys.holdOf = () => null; sys.isAdmin = () => false; sys.holdRanks = () => []; sys.partnerOf = () => 0;
    sys.saveRegistry = () => { }; sys.pushDecor = () => { }; sys.notice = (c, u, t) => notices.push(t); sys.baseTypeOf = () => 'CONT';
    sys.claimed = claimed.slice();
    mp.set(HUT, HP, { owner: 49, ownerName: 'Lord Elion', name: "Janitor's Hut", locked: true, serial: 3, partner: 0, containers: [], issued: [LIVE] });
    mp.set(BARN, HP, { owner: 50, ownerName: 'Someone', name: 'Barn', locked: true, serial: 1, partner: 0, containers: [], issued: [], keyAliases: [ALIASED] });
    mp.set(MILL, HP, { owner: 51, ownerName: 'Miller', name: 'Mill', locked: true, serial: 2, partner: 0, containers: [], issued: ['Key to the Mill (recut)'] });
    const pack = () => (mp.get(HOLDER, 'inventory') || {}).entries || [];
    const ring = () => (mp.get(HOLDER, RING) || []).map((k) => k.n);
    const threw = () => logs.filter((l) => /threw away/.test(l));
    return { sys, ctx, mp, logs, notices, pack, ring, threw, goneReads: () => goneReads };
  };
  const cwd = process.cwd(); process.chdir(out);

  try {
    // At login, with the deleted reference in the registry (the live state on 21 Oct)
    let t = fresh([HUT, GONE, BARN, MILL]);
    const vanilla = { baseId: CAGE, count: 1 }; // the real Werewolf Cage Key from its dungeon: no name extra
    t.mp.set(HOLDER, 'inventory', { entries: [item(DEAD4), item(DEAD5), item(LIVE), item(ALIASED), item(BY_CREDENTIAL), vanilla, { baseId: 0xf, count: 5 }] });
    t.sys.ringAtLogin(t.ctx, HOLDER);
    let p = t.pack();
    check('with a claim on a deleted reference in the registry, old keys that open nothing are thrown away at login', !p.some((e) => e.name === DEAD4 || e.name === DEAD5), p);
    check('...logged once and the player told once', t.threw().length === 1 && /threw away 2 old key/.test(t.threw()[0]) && t.threw()[0].includes(DEAD5)
      && t.notices.filter((s) => s.includes('thrown away')).length === 1, [t.threw(), t.notices]);
    check('...keys a lock accepts (issued name, alias, credential suffix) are not thrown: they move onto the ring',
      [LIVE, ALIASED, BY_CREDENTIAL].every((n) => t.ring().includes(n) && !p.some((e) => e.name === n)), { ring: t.ring(), pack: p });
    check('...the unnamed vanilla Werewolf Cage Key and gold stay', p.length === 2 && p.some((e) => e.baseId === CAGE && !e.name) && p.some((e) => e.baseId === 0xf), p);
    check('...the deleted claim stays in the registry', t.sys.claimed.includes(GONE), t.sys.claimed.map((x) => x.toString(16)));
    const before = JSON.stringify(t.pack()), logsBefore = t.logs.length, noticesBefore = t.notices.length;
    t.sys.ringAtLogin(t.ctx, HOLDER);
    check('a second login changes nothing and logs nothing', JSON.stringify(t.pack()) === before && t.logs.length === logsBefore && t.notices.length === noticesBefore,
      { pack: t.pack(), logs: t.logs.slice(logsBefore), notices: t.notices.slice(noticesBefore) });
    check('the deleted reference is read once, not on every pass', t.goneReads() <= 1, t.goneReads());

    // A live key with no room left on the ring stays in the pack: the cleanup never takes a key some lock accepts
    t = fresh([HUT, GONE, BARN, MILL]);
    t.mp.set(HOLDER, RING, Array.from({ length: MAX_RING }, (_, i) => ({ n: `Spare ${i}`, p: GONE, at: 1, by: '' })));
    t.mp.set(HOLDER, 'inventory', { entries: [item(LIVE), item(DEAD4)] });
    t.sys.ringAtLogin(t.ctx, HOLDER);
    p = t.pack();
    check('with the ring full, a live key stays in the pack and only the dead one goes', p.length === 1 && p[0].name === LIVE, p);

    // A record that reads as null without throwing (not loaded yet after boot) still holds the cleanup back
    t = fresh([HUT, GONE, UNLOADED]);
    t.mp.set(HOLDER, 'inventory', { entries: [item(DEAD4), item(DEAD5)] });
    t.sys.ringAtLogin(t.ctx, HOLDER);
    check('a deleted and a not-yet-loaded claim together: nothing is thrown away', t.pack().length === 2 && t.threw().length === 0, t.pack());

    t = fresh([]);
    t.mp.set(HOLDER, 'inventory', { entries: [item(DEAD4)] });
    t.sys.ringAtLogin(t.ctx, HOLDER);
    check('with no claim registry loaded, nothing is thrown away', t.pack().length === 1, t.pack());

    // Opening a chest, with the deleted reference in the registry
    t = fresh([HUT, GONE, BARN, MILL]);
    t.mp.set(CHEST, 'inventory', { entries: [item(DEAD4), item(DEAD5), item(LIVE), { baseId: 0x12345, count: 2 }] });
    t.mp.set(HOLDER, 'inventory', { entries: [] });
    t.sys.takeKeysFrom(t.ctx, CHEST, HOLDER);
    let chest = (t.mp.get(CHEST, 'inventory') || {}).entries || [];
    check('with a deleted claim in the registry, old keys in a chest leave it when it is opened', !chest.some((e) => e.baseId === CAGE) && chest.some((e) => e.baseId === 0x12345), chest);
    check('...and are not put in the opener\'s pack', !t.pack().some((e) => e.name === DEAD4 || e.name === DEAD5), t.pack());
    check('...the live key goes onto the opener\'s ring', t.ring().includes(LIVE), t.ring());
    check('...logged once', t.threw().length === 1 && /threw away 2 old key/.test(t.threw()[0]), t.threw());
    const logsAfterOpen = t.logs.length;
    t.sys.takeKeysFrom(t.ctx, CHEST, HOLDER);
    chest = (t.mp.get(CHEST, 'inventory') || {}).entries || [];
    check('a second opening changes nothing and logs nothing', chest.length === 1 && chest[0].baseId === 0x12345 && t.logs.length === logsAfterOpen, { chest, logs: t.logs.slice(logsAfterOpen) });

    t = fresh([HUT, GONE, UNLOADED]);
    t.mp.set(CHEST, 'inventory', { entries: [item(DEAD4)] });
    t.mp.set(HOLDER, 'inventory', { entries: [] });
    t.sys.takeKeysFrom(t.ctx, CHEST, HOLDER);
    check('while a lock does not read, a chest\'s dead key still goes to the opener as before', t.pack().some((e) => e.name === DEAD4) && t.threw().length === 0, t.pack());
  } finally {
    process.chdir(cwd);
    fs.rmSync(out, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
