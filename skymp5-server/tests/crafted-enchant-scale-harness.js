// Scripted test for the gameplay's share of a new enchantment in craftedExtrasSystem.ts (staff suggestion "Enchanting",
// 20 Oct): the system hands globalThis.__dboEnchantScale the item's armor type (ARMO BOD2 or BODT), the soul size, the
// effects and the spare inventory; it stores each effect at the share returned (the rank's cap applied first, and bounding
// a share above 1), takes the spare items asked for (a gemstone) in the same inventory write, and treats the client's
// later report of its vanilla-strength copy as a held copy, not a refused craft. Without the hook nothing changes.
//
//   node tests/crafted-enchant-scale-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-crafted-scale-'));
const bundle = path.join(out, 'crafted.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const u32s = (...xs) => { const b = new Uint8Array(4 * xs.length); const v = new DataView(b.buffer); xs.forEach((x, i) => v.setUint32(4 * i, x >>> 0, true)); return b; };
const efit = (mag, area = 0, dur = 0) => { const b = new Uint8Array(12); const v = new DataView(b.buffer); v.setFloat32(0, mag, true); v.setUint32(4, area, true); v.setUint32(8, dur, true); return b; };
const enit = (weapon) => u32s(0, 0, weapon ? 1 : 0, 0, weapon ? 1 : 0, 6, 0, 0, 0);
const mgefData = (av, flags = 0) => { const b = new Uint8Array(152); const v = new DataView(b.buffer); v.setUint32(0, flags, true); v.setFloat32(4, 1, true); v.setInt32(68, av, true); return b; };
const records = new Map();
const rec = (id, type, editorId, fields) => records.set(id >>> 0, { record: { type, editorId, fields }, toGlobalRecordId: (x) => x >>> 0 });
const ench = (id, editorId, weapon, effects) => rec(id, 'ENCH', editorId,
  [{ type: 'ENIT', data: enit(weapon) }, ...effects.flatMap(([e, m, a, d]) => [{ type: 'EFID', data: u32s(e) }, { type: 'EFIT', data: efit(m, a, d) }])]);

const FORTIFY_DESTRUCTION = 0x0007a0f6, RESIST_FIRE = 0x00048c8b, PARALYSIS = 0x000acbb6;
rec(FORTIFY_DESTRUCTION, 'MGEF', 'EnchFortifyDestructionConstantSelf', [{ type: 'DATA', data: mgefData(24) }]);
rec(RESIST_FIRE, 'MGEF', 'EnchResistFireConstantSelf', [{ type: 'DATA', data: mgefData(24) }]);
rec(PARALYSIS, 'MGEF', 'EnchParalysisFFContact', [{ type: 'DATA', data: mgefData(24, 0x400000) }]);
ench(0x0007a10e, 'EnchArmorFortifyDestruction06', false, [[FORTIFY_DESTRUCTION, 25]]);
ench(0x00048c90, 'EnchArmorResistFire06', false, [[RESIST_FIRE, 60]]);
ench(0x000acbbb, 'EnchWeaponParalysis06', true, [[PARALYSIS, 0, 0, 6]]);

const bod2 = (type) => [{ type: 'BOD2', data: u32s(4, type) }];
const IRON = 0x00012e49, GLASS = 0x00013939, ROBE = 0x000bacf3, OLD = 0x00700001, NOTYPE = 0x00700002, SWORD = 0x00012eb7;
rec(IRON, 'ARMO', 'ArmorIronCuirass', bod2(1));
rec(GLASS, 'ARMO', 'ArmorGlassCuirass', bod2(0));
rec(ROBE, 'ARMO', 'ClothesMonkRobes', bod2(2));
rec(OLD, 'ARMO', 'OldFormHeavy', [{ type: 'BODT', data: u32s(4, 0, 1) }]);
rec(NOTYPE, 'ARMO', 'OldFormNoType', [{ type: 'BODT', data: u32s(4, 0) }]);
rec(SWORD, 'WEAP', 'IronSword', []);
const GRAND = 0x0002e4ff, GREATER = 0x0002e4fb, RUBY = 0x00063b42, RUBY_FLAWLESS = 0x00068522, BENCH = 0x000bad0c, BENCH_BASE = 0x000bad0d;
rec(GRAND, 'SLGM', 'SoulGemGrandFilled', [{ type: 'SOUL', data: new Uint8Array([5]) }]);
rec(GREATER, 'SLGM', 'SoulGemGreaterFilled', [{ type: 'SOUL', data: new Uint8Array([4]) }]);
rec(RUBY, 'MISC', 'GemRuby', []);
rec(RUBY_FLAWLESS, 'MISC', 'gemRubyFlawless', []);
rec(BENCH_BASE, 'FURN', 'ArcaneEnchanter', [{ type: 'WBDT', data: new Uint8Array([3, 0]) }]);

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

  const A = 0xff000014;
  const props = new Map();
  const sent = [];
  const logs = [];
  const mp = {
    get: (id, k) => props.get(`${id >>> 0}|${k}`),
    set: (id, k, v) => props.set(`${id >>> 0}|${k}`, v),
    getUserActor: (u) => (u === 1 ? A : 0),
    getActorPos: () => [0, 0, 0],
    getIdFromDesc: () => BENCH_BASE,
    lookupEspmRecordById: (id) => records.get(id >>> 0) || null,
    getEspmRecordIdsByType: (t) => [...records.entries()].filter(([, r]) => r.record.type === t).map(([id]) => id),
    sendCustomPacket: (u, p) => sent.push([u, JSON.parse(p)]),
  };
  props.set(`${BENCH}|worldOrCellDesc`, 'cell'); props.set(`${A}|worldOrCellDesc`, 'cell');
  props.set(`${BENCH}|pos`, [50, 0, 0]); props.set(`${BENCH}|baseDesc`, 'bench');
  props.set(`${A}|private.mastery`, { order: ['enchanter'], skills: { enchanter: { rank: 4 } } });
  const ctx = { svr: mp, gm: { on() {}, emit() {} } };
  let now = 1_000_000;
  const realNow = Date.now;
  Date.now = () => now;
  globalThis.__craftedSettings = { allSettings: { craftedExtrasRankGates: true }, loadOrder: ['Skyrim.esm'] };
  const sys = new CraftedExtrasSystem((...x) => logs.push(x.join(' ')));
  await sys.initAsync(Object.assign({}, ctx, { svr: Object.assign({}, mp) }));

  const calls = [];
  let verdict = null;
  globalThis.__dboEnchantScale = (actorId, info) => { calls.push(info); return typeof verdict === 'function' ? verdict(info) : verdict; };
  const inventory = () => props.get(`${A}|inventory`).entries;
  const notice = () => { const n = sent.filter(([, p]) => p.customPacketType === 'notification').pop(); return n ? n[1].text : ''; };
  const reverted = () => sent.filter(([, p]) => p.customPacketType === 'craftedExtrasRefused').flatMap(([, p]) => p.baseIds);
  const enchant = (item, effects, { gem = GRAND, extra = [] } = {}) => {
    props.set(`${A}|inventory`, { entries: [{ baseId: item, count: 1 }, { baseId: gem, count: 1 }, ...extra] });
    sent.length = 0; calls.length = 0;
    now += 61000;
    const g = { baseId: item, count: 1, enchantmentEffects: effects.map(([effectId, magnitude, duration]) => ({ effectId, magnitude, area: 0, duration: duration || 0, cost: 50 })) };
    if (item === SWORD) Object.assign(g, { maxCharge: 3000, chargePercent: 3000 });
    sys.customPacket(1, 'craftedExtras', { workbench: BENCH, gained: [g], lost: [{ baseId: item, count: 1 }, { baseId: gem, count: 1 }] }, ctx);
    const made = inventory().find((e) => e.baseId === item && e.enchantmentEffects);
    return { g, made, mag: (id) => (made ? (made.enchantmentEffects.find((e) => e.effectId === id) || {}).magnitude : undefined) };
  };

  // ---- no hook, or no verdict: vanilla's strength ----
  verdict = null;
  let r = enchant(IRON, [[FORTIFY_DESTRUCTION, 20]]);
  check('with no verdict the enchantment is stored as made', r.mag(FORTIFY_DESTRUCTION) === 20, r.made);
  check('the hook is told the armor type (BOD2 heavy = 1), the soul and the effects', calls[0] && calls[0].armorType === 1 && calls[0].soul === 5 &&
    calls[0].weapon === false && calls[0].effects[0] === FORTIFY_DESTRUCTION && calls[0].baseId === IRON, calls[0]);
  enchant(GLASS, [[FORTIFY_DESTRUCTION, 20]]);
  check('light armor reads 0', calls[0] && calls[0].armorType === 0, calls[0]);
  enchant(ROBE, [[FORTIFY_DESTRUCTION, 20]]);
  check('robes read 2 (clothing)', calls[0] && calls[0].armorType === 2, calls[0]);
  enchant(OLD, [[FORTIFY_DESTRUCTION, 20]]);
  check('an old-form BODT carries its type at offset 8', calls[0] && calls[0].armorType === 1, calls[0]);
  enchant(NOTYPE, [[FORTIFY_DESTRUCTION, 20]]);
  check('a BODT without a type reads -1', calls[0] && calls[0].armorType === -1, calls[0]);
  enchant(SWORD, [[PARALYSIS, 0, 4]]);
  check('a weapon reads weapon true and armor type -1', calls[0] && calls[0].weapon === true && calls[0].armorType === -1, calls[0]);

  // ---- shares ----
  verdict = { mults: [0.33], note: 'Heavy armor holds a third.' };
  r = enchant(IRON, [[FORTIFY_DESTRUCTION, 20]]);
  check('heavy armor at 0.33: 20 is stored as 6.6', Math.abs(r.mag(FORTIFY_DESTRUCTION) - 6.6) < 1e-6, r.made);
  check('the player is told the gameplay\'s line', notice() === 'Heavy armor holds a third.', notice());
  check('the log names the share', logs.some((l) => /scaled 33%/.test(l)), logs.slice(-2));
  r = enchant(IRON, [[FORTIFY_DESTRUCTION, 1e6]]);
  check('a claim above the cap is capped first (25 x 2 = 50), then scaled: 16.5', Math.abs(r.mag(FORTIFY_DESTRUCTION) - 16.5) < 1e-6, r.made);
  verdict = { mults: [1.5] };
  r = enchant(ROBE, [[FORTIFY_DESTRUCTION, 20]], { gem: GREATER });
  check('a share above 1 raises it (20 x 1.5 = 30)', r.mag(FORTIFY_DESTRUCTION) === 30, r.made);
  r = enchant(ROBE, [[FORTIFY_DESTRUCTION, 45]], { gem: GREATER });
  check('...but never past the rank\'s cap (25 x 2 = 50)', r.mag(FORTIFY_DESTRUCTION) === 50, r.made);
  verdict = { mults: [99] };
  r = enchant(ROBE, [[FORTIFY_DESTRUCTION, 10]]);
  check('a share is bounded at 2 before the cap', r.mag(FORTIFY_DESTRUCTION) === 20, r.made);
  verdict = { mults: [0.5, 1] };
  r = enchant(ROBE, [[FORTIFY_DESTRUCTION, 20], [RESIST_FIRE, 40]]);
  check('two effects take their own share each', r.mag(FORTIFY_DESTRUCTION) === 10 && r.mag(RESIST_FIRE) === 40, r.made);
  verdict = { mults: ['x'] };
  r = enchant(ROBE, [[FORTIFY_DESTRUCTION, 20]]);
  check('a share that is not a number counts as 1', r.mag(FORTIFY_DESTRUCTION) === 20, r.made);
  verdict = () => { throw new Error('boom'); };
  r = enchant(ROBE, [[FORTIFY_DESTRUCTION, 20]]);
  check('a hook that throws leaves vanilla\'s strength', r.mag(FORTIFY_DESTRUCTION) === 20 && logs.some((l) => /enchanting scale failed/.test(l)), r.made);
  verdict = { mults: [0.5] };
  r = enchant(SWORD, [[PARALYSIS, 0, 4]]);
  check('Paralysis, whose duration the power scales, is shortened (4 s to 2 s)', r.made && r.made.enchantmentEffects[0].duration === 2, r.made && r.made.enchantmentEffects);

  // ---- gemstones ----
  verdict = (info) => ({ mults: [1], take: info.spare.some((e) => e.baseId === RUBY_FLAWLESS) ? [RUBY_FLAWLESS] : [] });
  r = enchant(ROBE, [[RESIST_FIRE, 40]], { extra: [{ baseId: RUBY, count: 2 }, { baseId: RUBY_FLAWLESS, count: 1 }] });
  check('the hook sees the spare lines (not the gem the craft spent)', calls[0] && calls[0].spare.some((e) => e.baseId === RUBY && e.count === 2) &&
    !calls[0].spare.some((e) => e.baseId === GRAND), calls[0] && calls[0].spare);
  check('the flawless ruby asked for is taken in the same write; the plain rubies stay',
    !inventory().some((e) => e.baseId === RUBY_FLAWLESS) && inventory().find((e) => e.baseId === RUBY).count === 2 && r.mag(RESIST_FIRE) === 40, inventory());
  check('the soul is spent as before', !inventory().some((e) => e.baseId === GRAND), inventory());
  verdict = { mults: [1], take: [RUBY_FLAWLESS] };
  r = enchant(ROBE, [[RESIST_FIRE, 40]], { extra: [{ baseId: RUBY, count: 1 }] });
  check('a take of an item the player lacks takes nothing', inventory().find((e) => e.baseId === RUBY).count === 1 && r.mag(RESIST_FIRE) === 40, inventory());
  verdict = { mults: [1], take: [RUBY] };
  r = enchant(ROBE, [[RESIST_FIRE, 40]], { extra: [{ baseId: RUBY, count: 1, name: 'x', health: 1.2 }] });
  check('a copy with extras is never taken', inventory().some((e) => e.baseId === RUBY), inventory());
  verdict = { mults: [1], take: [RUBY] };
  props.set(`${A}|inventory`, { entries: [{ baseId: ROBE, count: 1 }, { baseId: GRAND, count: 1 }, { baseId: RUBY, count: 1 }] });
  now += 61000; sent.length = 0;
  sys.customPacket(1, 'craftedExtras', { workbench: BENCH, gained: [{ baseId: ROBE, count: 1, enchantmentEffects: [{ effectId: FORTIFY_DESTRUCTION, magnitude: 1, area: 0, duration: 0, cost: 1 }] }], lost: [{ baseId: ROBE, count: 1 }] }, ctx);
  check('a refused enchantment (no soul) takes no gemstone', inventory().some((e) => e.baseId === RUBY) && reverted().includes(ROBE), inventory());

  // ---- the client's own copy afterwards ----
  verdict = { mults: [0.33] };
  r = enchant(IRON, [[FORTIFY_DESTRUCTION, 20]]);
  sent.length = 0; now += 61000;
  sys.customPacket(1, 'craftedExtras', { workbench: BENCH, gained: [r.g], lost: [{ ...r.made }] }, ctx);
  check('the client\'s vanilla-strength copy is held, not refused: it is told to take the server\'s', reverted().includes(IRON) &&
    !/cannot take an enchantment/.test(notice()) && logs.some((l) => /kept the held enchantment 12e49/.test(l)), { notice: notice(), reverted: reverted() });
  verdict = { mults: [1.5] };
  r = enchant(ROBE, [[FORTIFY_DESTRUCTION, 20]], { gem: GREATER });
  sent.length = 0; now += 61000;
  sys.customPacket(1, 'craftedExtras', { workbench: BENCH, gained: [r.g], lost: [{ ...r.made }] }, ctx);
  check('...and so is a copy weaker than the server\'s (a raised share)', reverted().includes(ROBE) && !/cannot take an enchantment/.test(notice()), { notice: notice(), reverted: reverted() });
  check('the server keeps one robe at 30', inventory().filter((e) => e.baseId === ROBE).length === 1 && inventory().find((e) => e.baseId === ROBE).enchantmentEffects[0].magnitude === 30, inventory());

  delete globalThis.__dboEnchantScale;
  r = enchant(IRON, [[FORTIFY_DESTRUCTION, 20]]);
  check('with the gameplay hook gone the enchantment is stored as made', r.mag(FORTIFY_DESTRUCTION) === 20, r.made);

  Date.now = realNow;
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
