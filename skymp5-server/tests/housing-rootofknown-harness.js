// Scripted test for housing's rootOfKnown (1 Nov: guilds.js built its hall roots through primaryOf right after every boot, and
// primaryOf reads every door it is asked about; the first read of a door nobody claimed is a native load, 13.5 s on dev).
// rootOfKnown must give primaryOf's answer for every kind of door - a place's root, a claimed member, an unclaimed door
// whose partner stands in a place, a claimed pair asked from its pointer side, a lone unclaimed door, an unclaimed pair, a
// thing that is no door - while never reading the housing record of a ref no claim owns. It bundles housingSystem.ts with
// esbuild and runs it on a fake mp. Run it from skymp5-server with node_modules present (DECOR_SRC=<file> tests another copy):
//
//   node tests/housing-rootofknown-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-rootok-'));
const bundle = path.join(out, 'housing.js');
const src = process.env.DECOR_SRC ? path.resolve(process.env.DECOR_SRC) : path.join(root, 'ts', 'systems', 'housingSystem.ts');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  const entry = src.startsWith(path.join(root, 'ts')) ? src : path.join(root, 'ts', 'systems', '__rootok_src.ts');
  if (entry !== src) fs.copyFileSync(src, entry);
  try {
    await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error' });
  } finally { if (entry !== src) fs.unlinkSync(entry); }
  const { HousingSystem } = require(bundle);
  const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(fs.readFileSync(bundle, 'utf8')) || [])[1];

  // R: a place's root (cells "house"); M: a claimed member of it; D: an unclaimed exterior door whose partner P stands in the
  // house; Q: a claimed door whose partner Qp carries the { primary } pointer; U: a lone unclaimed door; V: an unclaimed door
  // whose unclaimed partner Vp has the lower id; S: a static, no door at all
  const R = 0x08000100, M = 0x08000110, D = 0x08000200, P = 0x08000201, Q = 0x08000300, Qp = 0x08000301,
    U = 0x08000400, V = 0x08000501, Vp = 0x08000500, S = 0x08000600, DOOR = 0x400, STAT = 0x401;
  const cellOf = { [R]: 'house:T.esp', [M]: 'house:T.esp', [P]: 'house:T.esp', [D]: 'world:T.esp', [Q]: 'world:T.esp', [Qp]: 'shed:T.esp',
    [U]: 'world:T.esp', [V]: 'world:T.esp', [Vp]: 'cave:T.esp', [S]: 'world:T.esp' };
  const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const refr = (base, xtel) => ({ record: { type: 'REFR', fields: [{ type: 'NAME', data: u32(base) }].concat(xtel ? [{ type: 'XTEL', data: u32(xtel) }] : []) }, toGlobalRecordId: (x) => x >>> 0 });
  const espm = { [R]: refr(DOOR), [M]: refr(DOOR), [D]: refr(DOOR, P), [P]: refr(DOOR, D), [Q]: refr(DOOR, Qp), [Qp]: refr(DOOR, Q),
    [U]: refr(DOOR), [V]: refr(DOOR, Vp), [Vp]: refr(DOOR, V), [S]: refr(STAT),
    [DOOR]: { record: { type: 'DOOR', fields: [] }, toGlobalRecordId: (x) => x >>> 0 }, [STAT]: { record: { type: 'STAT', fields: [] }, toGlobalRecordId: (x) => x >>> 0 } };
  const claim = (extra) => JSON.stringify(Object.assign({ owner: 9, ownerName: 'X', name: 'N', locked: true, serial: 1, partner: 0, containers: [], issued: [] }, extra));
  const boot = () => {
    const props = new Map([[`${R}:${HP}`, claim({ place: { cells: ['house:T.esp'], builtAt: 1 } })], [`${M}:${HP}`, claim({ memberOf: R })],
      [`${Q}:${HP}`, claim({ partner: Qp })], [`${Qp}:${HP}`, JSON.stringify({ primary: Q })]]);
    const reads = new Map();
    const mp = {
      get: (id, key) => {
        if (key === HP) reads.set(id >>> 0, (reads.get(id >>> 0) || 0) + 1);
        if (key === 'worldOrCellDesc') return cellOf[id >>> 0] || '';
        const v = props.get(`${id >>> 0}:${key}`);
        return v === undefined ? undefined : JSON.parse(v);
      },
      set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
      lookupEspmRecordById: (id) => espm[id >>> 0] || null,
      getUserByActor: () => -1, getUserActor: () => 0, isConnected: () => false, sendCustomPacket: () => { },
    };
    const sys = new HousingSystem(() => { });
    sys.holdOf = () => null; sys.isAdmin = () => false; sys.holdRanks = () => []; sys.saveRegistry = () => { };
    sys.keyRing = true; sys.placeMigration = 'apply'; sys.ownerMigration = 'off';
    sys.placePlanDone = true; sys.ownerPlanDone = true; sys.storageLockDone = true;
    sys.claimed = [R, M, Q];
    sys.exposeTenancy({ svr: mp });
    return { H: globalThis.__dboHousing, reads };
  };
  const hex = (n) => (n >>> 0).toString(16);
  const unclaimed = [D, P, U, V, Vp, S];

  const a = boot();
  check('housing exposes rootOfKnown', typeof a.H.rootOfKnown === 'function');
  if (typeof a.H.rootOfKnown !== 'function') { console.log(`\n${failures + 7} check(s) failed`); process.exit(1); }
  const known = {}; for (const r of [R, M, D, Q, Qp, U, V, S]) known[hex(r)] = hex(a.H.rootOfKnown(r));
  // A first boot of a load order (empty espm cache): the only refs read are teleport partners, housing's check that a far
  // side exists (partnerOf), and the espm cache keeps that answer for every later boot
  const coldRead = [...a.reads.keys()].filter((r) => unclaimed.includes(r));
  const partners = new Set([P, Vp, V].map((x) => x >>> 0));
  a.reads.clear();
  for (const r of [R, M, D, Q, Qp, U, V, S]) a.H.rootOfKnown(r);
  const warmReads = unclaimed.reduce((n, r) => n + (a.reads.get(r >>> 0) || 0), 0);
  const b = boot();
  const prim = {}; for (const r of [R, M, D, Q, Qp, U, V, S]) prim[hex(r)] = hex(b.H.primaryOf(r));
  const primReads = unclaimed.reduce((n, r) => n + (b.reads.get(r >>> 0) || 0), 0);

  check("a place's root answers with itself", known[hex(R)] === hex(R) && prim[hex(R)] === hex(R), [known[hex(R)], prim[hex(R)]]);
  check('a claimed member answers with its place, as primaryOf', known[hex(M)] === hex(R) && known[hex(M)] === prim[hex(M)], [known[hex(M)], prim[hex(M)]]);
  check("an unclaimed door whose partner stands in the place answers with the place, as primaryOf", known[hex(D)] === hex(R) && known[hex(D)] === prim[hex(D)], [known[hex(D)], prim[hex(D)]]);
  check('a claimed pair answers with the claim from either side, as primaryOf', known[hex(Q)] === hex(Q) && known[hex(Qp)] === hex(Q) && prim[hex(Qp)] === hex(Q), [known[hex(Qp)], prim[hex(Qp)]]);
  check('a lone unclaimed door and an unclaimed pair answer as primaryOf (itself; the lower id)', known[hex(U)] === prim[hex(U)] && known[hex(V)] === prim[hex(V)] && known[hex(V)] === hex(Vp), [known[hex(U)], known[hex(V)], prim[hex(V)]]);
  check('a thing that is no door answers 0, as primaryOf', known[hex(S)] === '0' && prim[hex(S)] === '0', [known[hex(S)], prim[hex(S)]]);
  check('cold espm cache: the only unclaimed refs read are partners checked for existence', coldRead.every((r) => partners.has(r)), coldRead.map(hex));
  check('warm espm cache (every later boot): rootOfKnown reads no housing record of a ref no claim owns', warmReads === 0, warmReads);
  check('...where primaryOf reads them (the boot cost it removes)', primReads > 0, primReads);

  console.log(failures ? `\n${failures} check(s) failed` : '\nall housing-rootofknown checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
