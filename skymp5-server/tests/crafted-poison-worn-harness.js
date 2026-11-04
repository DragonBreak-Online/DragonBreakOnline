// A poisoned weapon keeps its worn flag on the server copy (#bugs: "poisoning a bow unequips it" and drops it from the
// favourites). craftedExtrasSystem wrote each coated, spent or used-up weapon as a new unworn entry (withCount deletes
// worn), so the client's 5 s re-apply saw its drawn weapon differ from the server's unworn copy and swapped it: off the
// hand, out of the favourites. It bundles craftedExtrasSystem.ts with esbuild (settings stubbed). Run it from
// skymp5-server with node_modules present:
//
//   node tests/crafted-poison-worn-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-poisonworn-'));
const bundle = path.join(out, 'crafted.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const records = new Map();
const rec = (id, type, editorId, fields) => records.set(id >>> 0, { record: { type, editorId, fields }, toGlobalRecordId: (x) => x >>> 0 });
// ALCH ENIT: value at 0, flags at 4 (0x20000 poison)
const enit = (flags) => { const b = new Uint8Array(20); new DataView(b.buffer).setUint32(4, flags, true); return b; };
const BOW = 0x00013985, AXE = 0x00013980, POISON = 0x0003a5a4;
rec(BOW, 'WEAP', 'HuntingBow', []);
rec(AXE, 'WEAP', 'SteelWarAxe', []);
rec(POISON, 'ALCH', 'DamageHealthPoison01', [{ type: 'ENIT', data: enit(0x20000) }]);

const LOAD_ORDER = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'].map((n) => `/opt/skyrim-data/${n}`);

(async () => {
  await esbuild.build({
    entryPoints: [path.join(root, 'ts', 'systems', 'craftedExtrasSystem.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /^\.\.\/settings$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'module.exports = { Settings: { get: async () => globalThis.__craftedSettings } };', loader: 'js',
        }));
      },
    }],
  });
  const { CraftedExtrasSystem } = require(bundle);

  const A = 0xff002071;
  const props = new Map();
  const sent = [];
  const logs = [];
  const mp = {
    get: (id, k) => props.get(`${id >>> 0}|${k}`),
    set: (id, k, v) => props.set(`${id >>> 0}|${k}`, JSON.parse(JSON.stringify(v))),
    getUserActor: (u) => (u === 1 ? A : 0),
    getActorPos: () => [0, 0, 0],
    getIdFromDesc: () => 0,
    lookupEspmRecordById: (id) => records.get(id >>> 0) || null,
    getEspmRecordIdsByType: (t) => [...records.entries()].filter(([, r]) => r.record.type === t).map(([id]) => id),
    sendCustomPacket: (u, p) => sent.push([u, JSON.parse(p)]),
  };
  props.set(`${A}|worldOrCellDesc`, 'cell');
  const ctx = { svr: mp, gm: { on() {}, emit() {} } };
  let now = 1_000_000;
  Date.now = () => now;
  globalThis.__craftedSettings = { allSettings: {}, loadOrder: LOAD_ORDER };
  const sys = new CraftedExtrasSystem((...x) => logs.push(x.join(' ')));
  await sys.initAsync(ctx);

  const inventory = () => props.get(`${A}|inventory`).entries;
  const setInv = (entries) => props.set(`${A}|inventory`, { entries });
  const report = (gained, lost) => { sent.length = 0; logs.length = 0; now += 61000; sys.customPacket(1, 'craftedExtras', { workbench: 0, gained, lost }, ctx); };
  const bows = () => inventory().filter((e) => e.baseId === BOW);
  const refused = () => sent.some(([, p]) => p.customPacketType === 'craftedExtrasRefused');

  // ---- an equipped bow coated with a poison from the pack ----
  setInv([{ baseId: BOW, count: 1, worn: true }, { baseId: POISON, count: 1 }]);
  report([{ baseId: BOW, count: 1, poisonId: POISON, poisonCount: 1 }], [{ baseId: BOW, count: 1 }, { baseId: POISON, count: 1 }]);
  let b = bows();
  check('the coat is accepted and the vial spent', !refused() && b.length === 1 && b[0].poisonId === POISON && !inventory().some((e) => e.baseId === POISON), inventory());
  check('the coated bow is still the worn one on the server', b.length === 1 && b[0].worn === true, b);

  // ---- its charge spent, then used up, while drawn ----
  setInv([{ baseId: BOW, count: 1, worn: true, poisonId: POISON, poisonCount: 2 }]);
  report([{ baseId: BOW, count: 1, poisonId: POISON, poisonCount: 1 }], [{ baseId: BOW, count: 1, poisonId: POISON, poisonCount: 2 }]);
  b = bows();
  check('a spent charge keeps it worn', b.length === 1 && b[0].poisonCount === 1 && b[0].worn === true, b);
  report([{ baseId: BOW, count: 1 }], [{ baseId: BOW, count: 1, poisonId: POISON, poisonCount: 1 }]);
  b = bows();
  check('the poison used up keeps it worn', b.length === 1 && !b[0].poisonId && b[0].worn === true, b);

  // ---- two bows, one in hand: only that one is worn after the coat ----
  setInv([{ baseId: BOW, count: 2, worn: true }, { baseId: POISON, count: 1 }]);
  report([{ baseId: BOW, count: 1, poisonId: POISON, poisonCount: 1 }], [{ baseId: BOW, count: 1 }, { baseId: POISON, count: 1 }]);
  b = bows();
  const coated = b.find((e) => e.poisonId), spare = b.find((e) => !e.poisonId);
  check('of two bows, the coated one is worn and the spare is not', !!coated && coated.worn === true && !!spare && spare.count === 1 && !spare.worn, b);

  // ---- a weapon in the pack, not in hand, stays unworn ----
  setInv([{ baseId: AXE, count: 1 }, { baseId: POISON, count: 1 }]);
  report([{ baseId: AXE, count: 1, poisonId: POISON, poisonCount: 1 }], [{ baseId: AXE, count: 1 }, { baseId: POISON, count: 1 }]);
  const axe = inventory().find((e) => e.baseId === AXE);
  check('a weapon coated in the pack stays unworn', !!axe && axe.poisonId === POISON && !axe.worn && !axe.wornLeft, axe);

  // ---- a left-hand weapon keeps its left-hand flag ----
  setInv([{ baseId: AXE, count: 1, wornLeft: true }, { baseId: POISON, count: 1 }]);
  report([{ baseId: AXE, count: 1, poisonId: POISON, poisonCount: 1 }], [{ baseId: AXE, count: 1 }, { baseId: POISON, count: 1 }]);
  const left = inventory().find((e) => e.baseId === AXE);
  check('a weapon in the left hand stays in the left hand', !!left && left.wornLeft === true && !left.worn, left);

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
