// The Enchanting suggestion (enchanting.js, 20 Oct): globalThis.__dboEnchantScale, which fork craftedExtrasSystem asks
// for each new player enchantment. Checks the item share by armor type, the apparel soul share replacing vanilla's, the
// gemstone families (flawless, regular, none; one gem per family; never refused), the player's line, the off switch,
// and that the shipped gamemode-config.json block resolves (every effect editor id and gem desc is well formed).
//
//   node tests/enchanting-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'enchanting.js');

let fails = 0;
const ok = (c, what, detail) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!c) fails++; };
const near = (a, b) => Math.abs(a - b) < 1e-3;

const SHIPPED = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'gamemode-config.json'), 'utf8')).enchanting;
const MGEF = { 0x7a0f6: 'EnchFortifyDestructionConstantSelf', 0x48c8b: 'EnchResistFireConstantSelf', 0x4605a: 'EnchFireDamageFFContact',
  0x7a0fe: 'EnchFortifyArcheryConstantSelf', 0x493aa: 'EnchFortifyHealthConstantSelf', 0x109631: 'EnchRobesFortifyDestructionConstantSelf' };
const DESTRUCTION = 0x7a0f6, RESIST_FIRE = 0x48c8b, FIRE_DAMAGE = 0x4605a, ARCHERY = 0x7a0fe, HEALTH = 0x493aa;
const RUBY = 0x63b42, RUBY_FLAWLESS = 0x68522, EMERALD = 0x63b43;
const mp = {
  lookupEspmRecordById: (id) => (MGEF[id] ? { record: { type: 'MGEF', editorId: MGEF[id], fields: [] } } : null),
  getIdFromDesc: (d) => { const m = /^([0-9a-f]+):Skyrim\.esm$/i.exec(d); if (!m) throw new Error('bad desc ' + d); return parseInt(m[1], 16); },
};
const logs = [];
const load = (conf) => {
  delete require.cache[MODULE];
  globalThis.__dboEnchantScale = null;
  return require(MODULE)({ mp, log: (...x) => logs.push(x.join(' ')), cfg: { enchanting: conf } });
};
const ask = (info) => globalThis.__dboEnchantScale(0xff000014, Object.assign({ baseId: 1, weapon: false, armorType: 2, soul: 5, effects: [ARCHERY], spare: [] }, info));

// ---- shipped config: on with gems only (Nat, 25 Oct), and every entry resolves ----
load(Object.assign({}, SHIPPED, { enabled: false }));
ok(ask({}) === null, 'off: no verdict, so vanilla strength stands');
load(SHIPPED);
ok(SHIPPED && SHIPPED.enabled === true, 'the shipped block is on (gems only, Nat 25 Oct)');
ok(logs.some((l) => /enchanting\.js: on; items clothing 1, light 1, heavy 1; \d+ effects in 6 gem families/.test(l)), 'shipped: the load line names neutral armour shares and six families', logs.slice(-1));
let s = ask({ armorType: 1, soul: 4 });
ok(s && near(s.mults[0], 1) && s.note === undefined, 'shipped: heavy armor and a Greater soul change nothing, as in vanilla', s);
s = ask({ armorType: 0, soul: 1 });
ok(s && near(s.mults[0], 1) && s.note === undefined, 'shipped: light armor and a Petty soul change nothing', s);
// The 20 Oct rebalance (armour type and soul shares), which the mechanism below is tested with: the code still supports it
const on = Object.assign({}, SHIPPED, { enabled: true, itemShare: { clothing: 1, light: 0.66, heavy: 0.33, unknown: 1 },
  soulShare: { apparel: [0.0833, 0.1667, 0.3333, 1, 1], weapon: [1, 1, 1, 1, 1] } });
load(on);
ok(logs.some((l) => /enchanting\.js: on; items clothing 1, light 0\.66, heavy 0\.33; \d+ effects in 6 gem families/.test(l)), 'the load line names the shares and six families', logs.slice(-1));
const descs = Object.entries(SHIPPED.gemFamilies).filter(([k]) => !k.startsWith('_')).flatMap(([, f]) => [...f.regular, ...f.flawless]);
ok(descs.length === 12 && descs.every((d) => /^[0-9a-f]+:Skyrim\.esm$/.test(d)), 'twelve gem descs, regular and flawless of six gems', descs);
const effects = Object.entries(SHIPPED.gemFamilies).filter(([k]) => !k.startsWith('_')).flatMap(([, f]) => f.effects);
ok(new Set(effects.map((e) => e.toLowerCase())).size === effects.length, 'no effect sits in two families');

// ---- item share (an effect in no family, grand soul) ----
let r = ask({ armorType: 2 });
ok(r && near(r.mults[0], 1) && r.take.length === 0 && r.note === undefined, 'robes, clothing and jewelry keep 100%, no note', r);
r = ask({ armorType: 0 });
ok(near(r.mults[0], 0.66) && /Light armor holds 66%/.test(r.note), 'light armor keeps 66% and says so', r);
r = ask({ armorType: 1 });
ok(near(r.mults[0], 0.33) && /Heavy armor holds 33%/.test(r.note), 'heavy armor keeps 33%', r);
r = ask({ armorType: -1 });
ok(near(r.mults[0], 1), 'an item with no armor type keeps all of it', r);
r = ask({ weapon: true, armorType: -1, effects: [ARCHERY] });
ok(near(r.mults[0], 1) && r.note === undefined, 'a weapon keeps its strength', r);

// ---- soul share (apparel replaces vanilla's 1/12, 1/6, 1/3, 2/3, 1) ----
r = ask({ soul: 4 });
ok(near(r.mults[0], 1.5) && /a greater soul gives 100% of a grand one/.test(r.note), 'a Greater soul on robes is raised from vanilla 2/3 to full (x1.5)', r);
r = ask({ soul: 4, armorType: 1 });
ok(near(r.mults[0], 0.495), 'a Greater soul on heavy armor: 0.33 x 1.5', r);
r = ask({ soul: 3 });
ok(near(r.mults[0], 1) && r.note === undefined, 'a Common soul stays at vanilla\'s third (x1), no note', r);
r = ask({ soul: 1 });
ok(near(r.mults[0], 1), 'a Petty soul stays at vanilla\'s twelfth', r);
r = ask({ weapon: true, armorType: -1, soul: 1 });
ok(near(r.mults[0], 1), 'a weapon from a Petty soul keeps its strength (the soul sets its charge)', r);
load(Object.assign({}, on, { soulShare: { apparel: [0.05, 0.1, 0.2, 0.5, 1], weapon: [0.5, 0.6, 0.7, 0.9, 1] } }));
r = ask({ soul: 4 });
ok(near(r.mults[0], 0.75), 'a configured apparel table replaces vanilla\'s (0.5 against 2/3)', r);
r = ask({ weapon: true, armorType: -1, soul: 1 });
ok(near(r.mults[0], 0.5), 'a configured weapon table multiplies', r);
load(on);

// ---- gemstones ----
r = ask({ effects: [RESIST_FIRE], spare: [{ baseId: RUBY, count: 3 }, { baseId: RUBY_FLAWLESS, count: 1 }] });
ok(near(r.mults[0], 1) && r.take.length === 1 && r.take[0] === RUBY_FLAWLESS && /a flawless ruby was used/.test(r.note), 'Resist Fire with a flawless ruby: full, the flawless one is taken', r);
r = ask({ effects: [RESIST_FIRE], spare: [{ baseId: RUBY, count: 3 }] });
ok(near(r.mults[0], 0.8) && r.take[0] === RUBY && /a ruby was used \(80%/.test(r.note), 'with only a ruby: 80%, the ruby is taken', r);
r = ask({ effects: [RESIST_FIRE], spare: [{ baseId: EMERALD, count: 1 }] });
ok(near(r.mults[0], 0.6) && r.take.length === 0 && /without a ruby that effect has 60%/.test(r.note), 'without a ruby: 60%, nothing taken, never refused', r);
r = ask({ effects: [DESTRUCTION, RESIST_FIRE], spare: [{ baseId: RUBY, count: 1 }] });
ok(near(r.mults[0], 0.8) && near(r.mults[1], 0.8) && r.take.length === 1, 'two ruby effects on one item spend one ruby', r);
r = ask({ effects: [HEALTH, RESIST_FIRE], spare: [{ baseId: RUBY_FLAWLESS, count: 1 }, { baseId: EMERALD, count: 1 }] });
ok(near(r.mults[0], 0.8) && near(r.mults[1], 1) && r.take.length === 2, 'an emerald effect and a ruby effect each take their own gem', r);
r = ask({ effects: [ARCHERY, RESIST_FIRE], armorType: 1, spare: [] });
ok(near(r.mults[0], 0.33) && near(r.mults[1], 0.198), 'heavy armor and no ruby multiply (0.33 x 0.6)', r);
r = ask({ weapon: true, armorType: -1, effects: [FIRE_DAMAGE], spare: [{ baseId: RUBY, count: 1 }] });
ok(near(r.mults[0], 0.8) && r.take[0] === RUBY, 'a weapon\'s Fire Damage uses a ruby too', r);
load(Object.assign({}, on, { gems: Object.assign({}, on.gems, { weapons: false }) }));
r = ask({ weapon: true, armorType: -1, effects: [FIRE_DAMAGE], spare: [{ baseId: RUBY, count: 1 }] });
ok(near(r.mults[0], 1) && r.take.length === 0, 'gems.weapons false: weapons need none', r);
load(Object.assign({}, on, { gems: Object.assign({}, on.gems, { flawlessFirst: false }) }));
r = ask({ effects: [RESIST_FIRE], spare: [{ baseId: RUBY, count: 1 }, { baseId: RUBY_FLAWLESS, count: 1 }] });
ok(r.take[0] === RUBY && near(r.mults[0], 0.8), 'flawlessFirst false spends the regular gem first', r);
load(Object.assign({}, on, { notify: false }));
r = ask({ armorType: 1 });
ok(r.note === undefined && near(r.mults[0], 0.33), 'notify false: the share without a line', r);
load(Object.assign({}, on, { itemShare: { heavy: 7 } }));
r = ask({ armorType: 1 });
ok(near(r.mults[0], 2), 'a share is bounded at 2', r);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
