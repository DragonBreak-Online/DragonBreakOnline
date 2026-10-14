// Scripted test for the alchemy rework (Nate, 14 Oct, "DBO: Alchemy Rework"; alchemy.js + alchemy-rework.json + the
// potion resist in gamemode.js's damage judge). Against mock records and the real data files:
// - each Alchemist tier brews its own strength (Apprentice and Adept no longer share one), the Minor restore never;
// - specials open at Apprentice (25), fortify skills at Adept (50), Smithing and Enchanting at Expert (75): a locked
//   strongest effect falls back to the next one with a hint, a mix of only locked effects brews nothing and keeps all;
// - combination records for tier 4+ when the mix shares both effects (config list; the shipped list is empty);
// - the lab panel names the tier's strength, what each potion does and what opens later;
// - drinking a restore gives a share of the drinker's own pool (before + share, after the C++ restore), by the record's
//   magnitude, never for food, poison, a refused eat, the downed or the dead, and once per drink after reloads;
// - a Resist Fire/Frost/Shock potion lowers that element's damage in gamemode.js until it wears off.
// Run it from this folder's parent with
//
//   node tests/alchemy-rework-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
process.chdir(SERVER);

let failures = 0, checks = 0;
const check = (name, ok, detail) => { checks++; if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); } else console.log(`ok   ${name}`); };
if (!fs.existsSync('alchemy-rework.json')) { check('alchemy-rework.json exists', false); console.log(`\n${checks - failures}/${checks} passed`); process.exit(1); }

const PLUGINS = { 'Skyrim.esm': 0x00, 'Mock.esp': 0x50, 'DragonBreak Online Edits.esp': 0x60 };
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const TABLE = JSON.parse(fs.readFileSync('alchemy-potions.json', 'utf8')).effects;
const RW = JSON.parse(fs.readFileSync('alchemy-rework.json', 'utf8'));
const EDID = new Map();
for (const v of Object.values(TABLE)) for (const p of v.potions) EDID.set(p.edid, { id: idOf(p.id), mag: p.mag, dur: p.dur });
const pid = (edid) => EDID.get(edid).id;

// ---- records -------------------------------------------------------------------------------------------------------
const RECORDS = {};
const bytes = (n) => new Uint8Array(n);
const MGEF = (desc, edid, cost, { flags = 0, archetype = 0, av = -1 } = {}) => {
  const data = bytes(152); const v = new DataView(data.buffer);
  v.setUint32(0, flags, true); v.setFloat32(4, cost, true); v.setUint32(0x40, archetype, true); v.setInt32(0x44, av, true);
  RECORDS[idOf(desc)] = { type: 'MGEF', editorId: edid, fields: [{ type: 'DATA', data }] };
};
MGEF('3eb15:Skyrim.esm', 'AlchRestoreHealth', 0.5, { av: 24 });
MGEF('0ffa03:Skyrim.esm', 'AlchRestoreHealthAll', 0.5, { av: 24 });
MGEF('3eb17:Skyrim.esm', 'AlchRestoreMagicka', 0.5, { av: 25 });
MGEF('3eb16:Skyrim.esm', 'AlchRestoreStamina', 0.5, { av: 26 });
MGEF('3eaea:Skyrim.esm', 'AlchResistFire', 0.5, { av: 41 });
MGEF('73f2d:Skyrim.esm', 'AlchWeaknessFire', 0.6, { av: 41, flags: 0x5 });
MGEF('3eb42:Skyrim.esm', 'AlchDamageHealth', 3, { av: 24, flags: 0x5 });
MGEF('3a2c6:Skyrim.esm', 'AlchDamageStamina', 1.8, { av: 26, flags: 0x5 });
MGEF('3eaf3:Skyrim.esm', 'AlchFortifyHealth', 0.35, { av: 24, flags: 0x2, archetype: 34 });
MGEF('3eb1b:Skyrim.esm', 'AlchFortifyMarksman', 2.5, { av: 8, flags: 0x2, archetype: 34 });
MGEF('3eb1d:Skyrim.esm', 'AlchFortifySmithing', 2.0, { av: 10, flags: 0x2, archetype: 34 });
MGEF('3eb3d:Skyrim.esm', 'AlchInvisibillity', 4, { av: -1 });
const u32 = (n) => { const b = bytes(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const efit = (mag, dur) => { const b = bytes(12); const v = new DataView(b.buffer); v.setFloat32(0, mag, true); v.setUint32(8, dur, true); return b; };
const ALCH = (id, edid, effects, flags = 0) => {
  const enit = bytes(20); new DataView(enit.buffer).setUint32(4, flags, true);
  RECORDS[id] = { type: 'ALCH', editorId: edid, fields: [{ type: 'ENIT', data: enit }].concat(effects.flatMap(([mg, mag, dur]) => [{ type: 'EFID', data: u32(idOf(mg)) }, { type: 'EFIT', data: efit(mag, dur || 0) }])) };
};
for (const n of ['01', '02', '03', '04', '05']) ALCH(pid(`RestoreHealth${n}`), `RestoreHealth${n}`, [['3eb15:Skyrim.esm', EDID.get(`RestoreHealth${n}`).mag]]);
ALCH(pid('RestoreHealth06'), 'RestoreHealth06', [['0ffa03:Skyrim.esm', 9999]]);
ALCH(pid('RestoreMagicka04'), 'RestoreMagicka04', [['3eb17:Skyrim.esm', 100]]);
ALCH(pid('ResistFire50'), 'ResistFire50', [['3eaea:Skyrim.esm', 30, 60]]);
ALCH(pid('FortifyHealth01'), 'FortifyHealth01', [['3eaf3:Skyrim.esm', 20, 60]]);
ALCH(pid('DamageHealth01'), 'DamageHealth01', [['3eb42:Skyrim.esm', 15]], 0x20000);
const FOOD = idOf('a01:Mock.esp'), RESTORE_ALL = idOf('a02:Mock.esp'), COMBO_T4 = idOf('c01:DragonBreak Online Edits.esp'), COMBO_T5 = idOf('c02:DragonBreak Online Edits.esp');
ALCH(FOOD, 'FoodApple', [['3eb15:Skyrim.esm', 50]], 0x2);
ALCH(RESTORE_ALL, 'MockRestoreAll', [['3eb15:Skyrim.esm', 50], ['3eb17:Skyrim.esm', 50], ['3eb16:Skyrim.esm', 50]]);
ALCH(COMBO_T4, 'DBO_AlchComboHealthStaminaT4', [['3eb42:Skyrim.esm', 50], ['3a2c6:Skyrim.esm', 50]], 0x20000);
ALCH(COMBO_T5, 'DBO_AlchComboHealthStaminaT5', [['3eb42:Skyrim.esm', 65], ['3a2c6:Skyrim.esm', 65]], 0x20000);
// Ingredients, two of each kind of mix
const INGR = (n, edid, effects) => { const id = idOf(`${n}:Mock.esp`); RECORDS[id] = { type: 'INGR', editorId: edid, fields: effects.map((d) => ({ type: 'EFID', data: u32(idOf(d)) })) }; return id; };
const HEAL_A = INGR('101', 'HealA', ['3eb15:Skyrim.esm']), HEAL_B = INGR('102', 'HealB', ['3eb15:Skyrim.esm']);
const ARCH_A = INGR('103', 'ArchA', ['3eb1b:Skyrim.esm', '3eb15:Skyrim.esm']), ARCH_B = INGR('104', 'ArchB', ['3eb1b:Skyrim.esm', '3eb15:Skyrim.esm']);
const SMITH_A = INGR('105', 'SmithA', ['3eb1d:Skyrim.esm']), SMITH_B = INGR('106', 'SmithB', ['3eb1d:Skyrim.esm']);
const INVIS_A = INGR('107', 'InvisA', ['3eb3d:Skyrim.esm']), INVIS_B = INGR('108', 'InvisB', ['3eb3d:Skyrim.esm']);
const VENOM_A = INGR('109', 'VenomA', ['3eb42:Skyrim.esm', '3a2c6:Skyrim.esm']), VENOM_B = INGR('10a', 'VenomB', ['3eb42:Skyrim.esm', '3a2c6:Skyrim.esm']);
RECORDS[idOf('bad0c:Skyrim.esm')] = { type: 'FURN', editorId: 'CraftingAlchemyWorkbench', fields: [] };

// ---- the mock server -----------------------------------------------------------------------------------------------
const props = new Map();
const put = (id, p, v) => props.set(id + '|' + p, v);
const A = 0x14, LAB = 0x5000;
const tierOf = (a, tier) => put(a, 'private.mastery', { v: 2, skills: { alchemist: { level: [1, 25, 50, 75, 90][tier - 1], xp: 0, rank: tier - 1 } }, order: ['alchemist'] });
const stockAll = () => put(A, 'inventory', { entries: [HEAL_A, HEAL_B, ARCH_A, ARCH_B, SMITH_A, SMITH_B, INVIS_A, INVIS_B, VENOM_A, VENOM_B].map((baseId) => ({ baseId, count: 5 })) });
const count = (baseId) => (props.get(A + '|inventory') || { entries: [] }).entries.filter((e) => e.baseId === baseId).reduce((n, e) => n + e.count, 0);
put(A, 'worldOrCellDesc', 'a:Skyrim.esm'); put(A, 'pos', [0, 0, 0]); put(A, 'profileId', 1);
put(LAB, 'baseDesc', 'bad0c:Skyrim.esm'); put(LAB, 'worldOrCellDesc', 'a:Skyrim.esm'); put(LAB, 'pos', [50, 0, 0]);
const out = { said: [], logs: [], widgets: [], sets: [] };
const mp = {
  getIdFromDesc: idOf,
  getDescFromId: (id) => `${(id & 0xffffff).toString(16)}:${Object.keys(PLUGINS).find((k) => PLUGINS[k] === (id >>> 24))}`,
  get: (id, p) => props.get(id + '|' + p),
  set: (id, p, v) => { if (p === 'percentages') out.sets.push([id, v]); props.set(id + '|' + p, JSON.parse(JSON.stringify(v))); },
  lookupEspmRecordById: (id) => (RECORDS[id] ? { record: RECORDS[id], toGlobalRecordId: (local) => local } : null),
  callPapyrusFunction: () => false,
};
let eatVerdict = true, innerEats = 0;
const baseHooks = () => { mp.onEatItem = () => { innerEats++; return eatVerdict; }; };
const api = (cfg) => ({ mp, cfg, log: (...x) => out.logs.push(x.join(' ')), personal: (a, t) => out.said.push(t), audit: () => {}, who: () => 'P', display: () => 'P',
  openWidget: (a, w, f) => out.widgets.push(w), closeWidget: () => {}, every: () => {}, itemName: () => '', onUi: () => {}, sendPacket: () => {} });
const load = (cfg = {}, hooks = true) => { if (hooks) baseHooks(); const p = path.resolve('alchemy.js'); delete require.cache[p]; require(p)(api(cfg)); };
let clock = 1790000000000;
Date.now = () => clock;
const craft = (ids) => { clock += 5000; out.said.length = 0; mp.onCraftUnmatched(A, LAB, 0xff000123, { entries: ids.map((baseId) => ({ baseId, count: 1 })) }); return out.said[0] || ''; };
const gave = (before, edid) => count(pid(edid)) - (before[edid] || 0);
const snapshot = (edids) => Object.fromEntries(edids.map((e) => [e, count(pid(e))]));

(async () => {
  load();
  check('alchemy.js loads with the rework data', typeof mp.onCraftUnmatched === 'function' && !out.logs.some((l) => /not a known potion|unreadable/.test(l)), out.logs);

  // ---- the data file ----
  const rules = Object.entries(RW.effects);
  check('every record the rework names is a known potion', rules.every(([, v]) => v.byTier.every((x) => x === null || EDID.has(x))), rules.filter(([, v]) => v.byTier.some((x) => x && !EDID.has(x))).map(([k]) => k));
  check('...with nothing below its minimum tier and something from it on', rules.every(([, v]) => v.byTier.length === 5 && v.byTier.every((x, i) => (i + 1 < v.minTier ? x === null : !!x))));
  check('...every tier at least as strong as the one below', rules.every(([, v]) => v.byTier.filter(Boolean).every((x, i, l) => i === 0 || EDID.get(x).mag * Math.max(1, EDID.get(x).dur) >= EDID.get(l[i - 1]).mag * Math.max(1, EDID.get(l[i - 1]).dur) || /Stamina0?5$/.test(x))));
  const restores = rules.filter(([, v]) => v.kind === 'restore');
  check('the three restores: five different records, never the Minor (01)', restores.length === 3 && restores.every(([, v]) => new Set(v.byTier).size === 5 && !v.byTier.some((x) => /01$/.test(x))));
  check('the shipped combination list is empty until the PC adds the records', Array.isArray(RW.combos) && RW.combos.length === 0);

  // ---- tiers ----
  const heal = ['RestoreHealth01', 'RestoreHealth02', 'RestoreHealth03', 'RestoreHealth04', 'RestoreHealth05', 'RestoreHealth06'];
  const names = [];
  for (let t = 1; t <= 5; t++) {
    tierOf(A, t); stockAll();
    const before = snapshot(heal);
    const msg = craft([HEAL_A, HEAL_B]);
    const got = heal.filter((e) => gave(before, e) === 1);
    names.push([t, got[0], msg]);
  }
  check('tiers 1..5 brew RestoreHealth 02/03/04/05/06', names.map(([, e]) => e).join(',') === 'RestoreHealth02,RestoreHealth03,RestoreHealth04,RestoreHealth05,RestoreHealth06', names);
  check('...never the Minor potion', !names.some(([, e]) => e === 'RestoreHealth01'));
  check('...named Potion / Draught / Solution / Philter / Elixir of Healing', names.every(([t, , m]) => m.startsWith(`You brew ${t === 5 ? 'an' : 'a'} ${['Potion', 'Draught', 'Solution', 'Philter', 'Elixir'][t - 1]} of Healing`)), names.map((n) => n[2]));
  check('...saying what each restores: 20/30/45/60/75%', names.every(([t, , m]) => m.includes(`(restores ${[20, 30, 45, 60, 75][t - 1]}% of your health)`)), names.map((n) => n[2]));

  // ---- minimum tiers ----
  tierOf(A, 2); stockAll();
  let msg = craft([ARCH_A, ARCH_B]);
  check('an Apprentice mixing Fortify Archery + Restore Health gets the restore', count(pid('RestoreHealth03')) === 1 && count(pid('FortifySkillMarksman02')) === 0, msg);
  check('...told that Fortify Archery needs Adept (50)', /Fortify Archery needs an Alchemist of Adept rank \(level 50\)\./.test(msg), msg);
  tierOf(A, 3); stockAll();
  msg = craft([ARCH_A, ARCH_B]);
  check('an Adept brews the Fortify Archery (FortifySkillMarksman02)', count(pid('FortifySkillMarksman02')) === 1 && /Solution of Fortify Archery/.test(msg), msg);
  tierOf(A, 3); stockAll();
  const inv = JSON.stringify(props.get(A + '|inventory'));
  msg = craft([SMITH_A, SMITH_B]);
  check('an Adept cannot brew Fortify Smithing: nothing made, nothing taken', JSON.stringify(props.get(A + '|inventory')) === inv, msg);
  check('...and is told it needs Expert (75)', /^You cannot brew that yet\. Fortify Smithing needs an Alchemist of Expert rank \(level 75\)\. You keep your ingredients\.$/.test(msg), msg);
  tierOf(A, 4); stockAll();
  msg = craft([SMITH_A, SMITH_B]);
  check('an Expert brews it (FortifySkillSmithing03)', count(pid('FortifySkillSmithing03')) === 1, msg);
  tierOf(A, 1); stockAll();
  msg = craft([INVIS_A, INVIS_B]);
  check('a Novice cannot brew Invisibility (Apprentice, 25)', count(pid('Invisibility01')) === 0 && /Invisibility needs an Alchemist of Apprentice rank \(level 25\)/.test(msg), msg);
  tierOf(A, 2); stockAll();
  craft([INVIS_A, INVIS_B]);
  check('...an Apprentice can (Invisibility01)', count(pid('Invisibility01')) === 1);

  // ---- combinations (config; the shipped list is empty) ----
  tierOf(A, 4); stockAll();
  msg = craft([VENOM_A, VENOM_B]);
  check('with no combination listed an Expert brews the single strongest poison', count(COMBO_T4) === 0 && count(pid('DamageHealth03')) === 1, msg);
  load({ alchemyRework: { combos: [{ effects: ['03eb42', '03a2c6'], minTier: 4, byTier: [null, null, null, 'c01:DragonBreak Online Edits.esp', 'c02:DragonBreak Online Edits.esp'], name: 'Virulent Poison of Ruin' }] } });
  tierOf(A, 3); stockAll();
  craft([VENOM_A, VENOM_B]);
  check('a listed combination is not for an Adept', count(COMBO_T4) === 0 && count(pid('DamageHealth03')) === 1);
  tierOf(A, 4); stockAll();
  msg = craft([VENOM_A, VENOM_B]);
  check('...an Expert sharing both effects gets the combination record', count(COMBO_T4) === 1 && /Virulent Poison of Ruin/.test(msg), msg);
  tierOf(A, 5); stockAll();
  craft([VENOM_A, VENOM_B]);
  check('...a Master the Master record', count(COMBO_T5) === 1);
  tierOf(A, 4); stockAll();
  craft([HEAL_A, VENOM_A]);
  check('...and a mix sharing neither makes nothing', count(COMBO_T4) === 0 && count(pid('RestoreHealth05')) === 0);
  load();

  // ---- the panel ----
  tierOf(A, 2); stockAll(); out.widgets.length = 0;
  globalThis.__dboAlchemyLab(LAB, A);
  const panel = out.widgets.filter((w) => w.id === 71).pop() || { lines: [] };
  check('the lab panel names the tier and its strength', /You can brew \(\d+\), Apprentice: Draught strength/.test(panel.targetName || ''), panel.targetName);
  check('...each potion by the design name and what it does', panel.lines.some((l) => /^Draught of Healing \(30% health\): /.test(l)), panel.lines);
  check('...and what opens later', panel.lines.some((l) => /^Later: .*Fortify Archery at Adept \(50\).*Fortify Smithing at Expert \(75\)/.test(l)), panel.lines);
  check('...never a locked potion as brewable', !panel.lines.some((l) => /Fortify Smithing.*:.*\+/.test(l) || /Fortify Archery \(/.test(l)), panel.lines);

  // ---- drinking: a share of the drinker's own pool ----
  const tick = () => new Promise((r) => setImmediate(r));
  // The C++ restore (MpActor ApplyMagicEffect) runs after the gamemode's hook: points over the server's maximum
  const drink = async (id, start, cppGain) => {
    out.sets.length = 0;
    put(A, 'percentages', Object.assign({}, start));
    const verdict = mp.onEatItem(A, id);
    if (verdict !== false && cppGain) { const p = Object.assign({}, mp.get(A, 'percentages')); for (const k of Object.keys(cppGain)) p[k] = Math.min(1, p[k] + cppGain[k]); props.set(A + '|percentages', p); }
    await tick();
    return mp.get(A, 'percentages');
  };
  const near = (x, y) => Math.abs(x - y) < 1e-6;
  let p = await drink(pid('RestoreHealth02'), { health: 0.3, magicka: 0.5, stamina: 0.5 }, { health: 0.125 });
  check('a Potion of Healing gives 20% of the pool, not its 50 points', near(p.health, 0.5) && near(p.magicka, 0.5), p);
  p = await drink(pid('RestoreHealth06'), { health: 0.1, magicka: 0.5, stamina: 0.5 }, { health: 0.9 });
  check('an Elixir (the old Ultimate, full) gives 75%', near(p.health, 0.85), p);
  p = await drink(pid('RestoreHealth04'), { health: 0.9, magicka: 0.5, stamina: 0.5 }, { health: 0.1 });
  check('...never past full', near(p.health, 1), p);
  p = await drink(pid('RestoreHealth01'), { health: 0.2, magicka: 0.5, stamina: 0.5 }, { health: 0.1667 });
  check('a Minor potion from a drop gives 10%', near(p.health, 0.3), p);
  p = await drink(pid('RestoreMagicka04'), { health: 0.4, magicka: 0.2, stamina: 0.5 }, { magicka: 0.25 });
  check('a magicka potion moves only magicka (45%)', near(p.magicka, 0.65) && near(p.health, 0.4), p);
  p = await drink(RESTORE_ALL, { health: 0.1, magicka: 0.1, stamina: 0.1 }, { health: 0.1, magicka: 0.1, stamina: 0.1 });
  check('another plugin\'s restore-all potion: each pool by its own magnitude (20%)', near(p.health, 0.3) && near(p.magicka, 0.3) && near(p.stamina, 0.3), p);
  p = await drink(FOOD, { health: 0.3, magicka: 0.5, stamina: 0.5 }, { health: 0.1 });
  check('food is left to the C++', near(p.health, 0.4) && out.sets.length === 0, p);
  p = await drink(pid('DamageHealth01'), { health: 0.3, magicka: 0.5, stamina: 0.5 });
  check('a poison drunk is left alone', near(p.health, 0.3) && out.sets.length === 0, p);
  p = await drink(pid('FortifyHealth01'), { health: 0.3, magicka: 0.5, stamina: 0.5 }, { health: 0.05 });
  check('a Fortify Health potion is not a restore', near(p.health, 0.35) && out.sets.length === 0, p);
  eatVerdict = false;
  p = await drink(pid('RestoreHealth02'), { health: 0.3, magicka: 0.5, stamina: 0.5 });
  check('an eat the chain refused restores nothing', near(p.health, 0.3) && out.sets.length === 0, p);
  eatVerdict = true;
  globalThis.__dboIsDowned = () => true;
  p = await drink(pid('RestoreHealth02'), { health: 0.3, magicka: 0.5, stamina: 0.5 }, { health: 0.125 });
  check('the downed get no share (downed.js decides their health)', near(p.health, 0.425) && out.sets.length === 0, p);
  delete globalThis.__dboIsDowned;
  p = await drink(pid('RestoreHealth02'), { health: 0, magicka: 0.5, stamina: 0.5 });
  check('nor the dead', p.health === 0 && out.sets.length === 0, p);
  load(); load(); load({}, false);
  innerEats = 0;
  p = await drink(pid('RestoreHealth03'), { health: 0.1, magicka: 0.5, stamina: 0.5 }, { health: 0.2 });
  check('after reloads (one without the gamemode re-installing its hook) one drink is one eat and one share', innerEats === 1 && out.sets.length === 1 && near(p.health, 0.4), { innerEats, sets: out.sets.length, p });

  // ---- resists ----
  await drink(pid('ResistFire50'), { health: 1, magicka: 1, stamina: 1 });
  const resistOf = typeof globalThis.__dboPotionResistOf === 'function' ? globalThis.__dboPotionResistOf : () => NaN;
  check('a Resist Fire potion (30%) is remembered for the damage judge', near(resistOf(A, 'fire'), 0.3) && resistOf(A, 'frost') === 0);
  // gamemode.js: the block from BLESS_COMBAT to the hit formula, lifted, as blessing-combat-harness.js does
  const src = fs.readFileSync('gamemode.js', 'utf8');
  const a = src.indexOf('const BLESS_COMBAT'), b = src.indexOf('// The server\'s hit formula counts only');
  const u32le = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const RES = (resist) => { const d = new Array(152).fill(0); u32le(resist >>> 0).forEach((x, i) => { d[16 + i] = x; }); return { record: { type: 'MGEF', fields: [{ type: 'DATA', data: Uint8Array.from(d) }] } }; };
  const spell = (m) => ({ record: { type: 'SPEL', fields: [{ type: 'EFID', data: Uint8Array.from(u32le(m)) }, { type: 'EFIT', data: Uint8Array.from(new Array(12).fill(0)) }] } });
  const recs = { 0x301: RES(41), 0x302: RES(43), 0x210: spell(0x301), 0x211: spell(0x302), 0x100: { record: { type: 'WEAP', fields: [] } } };
  let potionResistMult = null;
  try { potionResistMult = new Function('mp', 'recordOf', 'cfg', 'Date', src.slice(a, b) + '\nreturn potionResistMult;')({ get: () => undefined }, (id) => recs[id] || null, {}, { now: () => clock }); } catch (e) { /* not there */ }
  check('gamemode.js has potionResistMult', typeof potionResistMult === 'function');
  if (potionResistMult) {
    check('...a fire spell on the drinker lands at 70%', near(potionResistMult(A, 0x210), 0.7));
    check('...a frost spell and a sword in full', potionResistMult(A, 0x211) === 1 && potionResistMult(A, 0x100) === 1);
    check('...someone else in full', potionResistMult(A + 1, 0x210) === 1);
    clock += 61000;
    check('...and in full once the minute is up', potionResistMult(A, 0x210) === 1);
  }
  check('the damage judge multiplies the target side by it', /let targetSide = [^;]*potionResistMult\(tgt, src\)/.test(src));
  check('a failed alchemy.js load clears the resist hook', /alchemy\.js failed to load[^\n]*__dboPotionResistOf = null/.test(src));

  console.log(`\n${checks - failures}/${checks} passed`);
  process.exit(failures ? 1 : 0);
})();
