// Scripted test for Fortify Smithing on tempering in craftedExtrasSystem.ts (/bug 2026-11-10T22-31-15-UA9B: "Major Smithing
// enchant on gloves are not working"). The rank and item caps used to discard the fortify the client's engine had applied.
// Now a cap is read as the most skill still at its quality (Superior 64, Exquisite 99), lifted by the engine's own formula (UESP
// Skyrim:Smithing). Reading it as the least skill (11 Nov #UA9B, still at 1.3) meant no base game item ever lifted a cap.
// The formula (UESP
// Skyrim:Smithing): effective = (skill - 13.29) x (1 + enchantments) x (1 + potion) + 13.29, quality = floor((effective + 38) x 3 / 103).
// Bundles craftedExtrasSystem.ts with esbuild (settings stubbed) and sends tempering reports.
//   node tests/temper-fortify-harness.js   (from skymp5-server, node_modules present)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-fortify-'));
const bundle = path.join(out, 'crafted.js');
process.on('exit', () => { try { fs.rmSync(out, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const u32s = (...xs) => { const b = new Uint8Array(4 * xs.length); const v = new DataView(b.buffer); xs.forEach((x, i) => v.setUint32(4 * i, x >>> 0, true)); return b; };
const cnto = (id, n) => { const b = new Uint8Array(8); const v = new DataView(b.buffer); v.setUint32(0, id, true); v.setInt32(4, n, true); return b; };
const records = new Map();
const rec = (id, type, editorId, fields) => records.set(id >>> 0, { record: { type, editorId, fields }, toGlobalRecordId: (x) => x >>> 0 });
const SWORD = 0x00012eb7, INGOT = 0x0005ace4, GRIND = 0x00088108, RECIPE = 0x000c4501, BENCH = 0x000bad0c, BENCH_BASE = 0x000bad0d;
rec(SWORD, 'WEAP', 'IronSword', []);
rec(INGOT, 'MISC', 'IngotIron', []);
rec(GRIND, 'KYWD', 'CraftingSmithingSharpeningWheel', []);
rec(RECIPE, 'COBJ', 'TemperWeaponIronSword', [{ type: 'CNAM', data: u32s(SWORD) }, { type: 'BNAM', data: u32s(GRIND) }, { type: 'CNTO', data: cnto(INGOT, 1) }]);
rec(BENCH_BASE, 'FURN', 'CraftingSmithingSharpeningWheel01', [{ type: 'WBDT', data: new Uint8Array([2, 0]) }, { type: 'KWDA', data: u32s(GRIND) }]);

(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'craftedExtrasSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /^\.\.\/settings$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = { Settings: { get: async () => globalThis.__craftedSettings } };', loader: 'js' }));
    } }] });
  const { CraftedExtrasSystem } = require(bundle);
  const A = 0xff000014;
  const props = new Map(), sent = [], logs = [];
  const mp = {
    get: (id, k) => props.get(`${id >>> 0}|${k}`), set: (id, k, v) => props.set(`${id >>> 0}|${k}`, v),
    getUserActor: (u) => (u === 1 ? A : 0), getActorPos: () => [0, 0, 0], getIdFromDesc: () => BENCH_BASE,
    lookupEspmRecordById: (id) => records.get(id >>> 0) || null,
    getEspmRecordIdsByType: (t) => [...records.entries()].filter(([, r]) => r.record.type === t).map(([id]) => id),
    sendCustomPacket: (u, p) => sent.push([u, JSON.parse(p)]),
  };
  props.set(`${BENCH}|worldOrCellDesc`, 'cell'); props.set(`${A}|worldOrCellDesc`, 'cell');
  props.set(`${BENCH}|pos`, [50, 0, 0]); props.set(`${BENCH}|baseDesc`, 'bench');
  const rank = (r) => props.set(`${A}|private.mastery`, { order: ['blacksmith'], skills: { blacksmith: { rank: r } } });
  globalThis.__craftedSettings = { allSettings: { craftedExtrasRankGates: true }, loadOrder: [] };
  const sys = new CraftedExtrasSystem((...a) => logs.push(a.join(' ')));
  const ctx = { svr: mp, gm: { on() {}, emit() {} } };
  await sys.initAsync(ctx);
  let now = 1_000_000; Date.now = () => now;
  const temper = (claim) => {
    props.set(`${A}|inventory`, { entries: [{ baseId: SWORD, count: 1 }, { baseId: INGOT, count: 1 }] });
    sent.length = 0; logs.length = 0; now += 5000;
    sys.customPacket(1, 'craftedExtras', { workbench: BENCH, gained: [{ baseId: SWORD, count: 1, health: claim }], lost: [{ baseId: SWORD, count: 1 }, { baseId: INGOT, count: 1 }] }, ctx);
    const s = props.get(`${A}|inventory`).entries.find((e) => e.baseId === SWORD);
    return s ? Math.round((s.health || 1) * 10) : null;
  };
  const fortify = (enchantments, potion) => { globalThis.__dboSmithingFortify = (a) => (a === A ? { enchantments, potion } : {}); };
  delete globalThis.__dboTemperCap;

  rank(2);   // Adept: Exquisite (13), as the reporter's Reach Guard pieces stopped at 1.3
  delete globalThis.__dboSmithingFortify;
  check('no fortify hook: an Adept is held at Exquisite (13)', temper(1.6) === 13, temper(1.6));
  fortify(0, 0);
  check('nothing worn or drunk: still 13', temper(1.6) === 13, temper(1.6));
  // Major Smithing gloves (17% in Skyrim.esm): Exquisite's most skill 99 becomes 85.71 x 1.17 + 13.29 = 113.6, quality 4
  fortify(0.17, 0);
  check('one Fortify Smithing item: 99 -> 113.6 effective skill, Flawless (14)', temper(1.6) === 14, temper(1.6));
  // Epic needs 133.67 effective (floor of 171.67 x 3 / 103 = 5): x1.41 reaches it, x1.40 does not
  fortify(0.41, 0);
  check('x1.41: 99 -> 134.1, Epic (15)', temper(1.6) === 15, temper(1.6));
  fortify(0.40, 0);
  check('x1.40: 99 -> 133.3, just short, Flawless (14)', temper(1.6) === 14, temper(1.6));
  fortify(0.2, 0.2);
  check('enchantments and a potion multiply: x1.44, 99 -> 136.7, Epic (15)', temper(1.6) === 15, temper(1.6));
  check('the log names the claim and the lifted cap', logs.some((l) => /tempered to 1\.5 \(asked 1\.6\) \(fortify x1\.44: cap 1\.3 -> 1\.5\)/.test(l)), logs);
  check('a lower claim stands under a lifted cap (Flawless, 14)', temper(1.4) === 14, temper(1.4));
  fortify(5, 5);
  check('MAX_HEALTH_STEP stays the ceiling (16)', temper(1.9) === 16, temper(1.9));

  rank(4);
  globalThis.__dboTemperCap = () => 12;   // smithing.js: an item of the smith's tier improves 2 levels
  fortify(0.17, 0);
  check('the item cap is lifted the same way: Superior (64) x1.17 -> 72.6, Exquisite (13)', temper(1.6) === 13, temper(1.6));
  fortify(1, 0);
  check('...x2 -> 114.7, Flawless (14)', temper(1.6) === 14, temper(1.6));
  fortify(0.01, 0);
  check('...x1.01 -> 64.5, still Superior (12)', temper(1.6) === 12, temper(1.6));
  fortify(5, 5);
  check('the note never names a cap above Legendary', temper(1.6) === 16 && logs.some((l) => /cap 1\.2 -> 1\.6\)/.test(l)), logs);
  globalThis.__dboTemperCap = () => 10;
  fortify(5, 5);
  check('cap 10 (the rules allow no tempering): fortify does not open it', temper(1.3) !== 13 && sent.some(([, p]) => p.customPacketType === 'craftedExtrasRefused'), temper(1.3));
  props.delete(`${A}|private.mastery`);
  delete globalThis.__dboTemperCap;
  check('no Blacksmith skill: fortify does not open tempering either', temper(1.3) !== 13, temper(1.3));

  rank(2);
  globalThis.__dboSmithingFortify = () => { throw new Error('boom'); };
  check('a throwing hook leaves the cap (13)', temper(1.6) === 13, temper(1.6));
  globalThis.__dboSmithingFortify = () => ({ enchantments: 'x', potion: -3 });
  check('non-numbers and negatives count as nothing (13)', temper(1.6) === 13, temper(1.6));
  console.log(failures ? `${failures} FAILED` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL', e && e.stack || e); process.exit(1); });
