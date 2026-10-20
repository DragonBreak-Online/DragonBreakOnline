// Scripted test for the alchemy rework's second part (Nate, 14 Oct: claude-nate's recommendations approved). Against mock
// records and the real data files:
// - the PC's records are mapped by editor id (alchemy-rework.json records), checked against the record, else the vanilla
//   fallback brews; a fallback is named for what it is;
// - Philter and Elixir restore over 5 s in ticks (a burst between ticks still lands; a new drink replaces a running one),
//   Potion, Draught and Solution at once; the PC's percent effects carry the share as their magnitude;
// - fortify potions feed the server's numbers by hook (weapon skill or hands, Destruction/Restoration, Alteration and
//   Conjuration durations, block, armour, lockpicking), replace and never stack, and wear off;
// - Fortify Smithing, Enchanting and Illusion are never brewed (the ingredients are kept); Invisibility at Adept (50),
//   Paralysis at Expert (75); Light from the Beyond Skyrim effect once its record is mapped;
// - weapon poisons as a share of the TARGET's pool (points / 200), inert unless poisons.judge; charges counted;
//   never the killing blow; blocked or spell hits never;
// - gamemode.js, combat.js and lockpick.js read the bonuses at the hooks named in the plan;
// - skillrates.js weights a Cook or Alchemist craft by the value of what went in, after the meter, never above x1;
// - kitchen staples (butter, flour, milk, cheese, honey, coffee) reach dungeon provisions and camp chests.
// Run from server/: node tests/alchemy-rework-stage2-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
process.chdir(SERVER);
let failures = 0, checks = 0;
const check = (name, ok, detail) => { checks++; if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); } else console.log(`ok   ${name}`); };
const near = (x, y) => Math.abs(x - y) < 1e-6;
const RW = JSON.parse(fs.readFileSync('alchemy-rework.json', 'utf8'));

// ---- the data -------------------------------------------------------------------------------------------------------
const E = RW.effects || {};
check('Fortify Smithing, Enchanting and Illusion are dropped, each saying why', ['03eb1d', '03eb29', '03eb27'].every((k) => E[k] && E[k].kind === 'dropped' && E[k].why), ['03eb1d', '03eb29', '03eb27'].map((k) => E[k]));
check('Invisibility opens at Adept (50), Paralysis at Expert (75)', E['03eb3d'] && E['03eb3d'].minTier === 3 && E['073f30'] && E['073f30'].minTier === 4);
check('Light is brewed from the Beyond Skyrim effect (60193e:BSAssets.esm) from Apprentice', E['60193e:BSAssets.esm'] && E['60193e:BSAssets.esm'].minTier === 2);
check('every PC editor id the effects name is listed in records', Object.values(E).every((v) => (v.byTier || []).every((x) => !x || !/^DBO_/.test(x) || x in RW.records)));
check('...as are the percent and slow restore effects and the fortify effects', (RW.percentEffects || []).concat((RW.overTime || {}).slowEffects || [], Object.keys((RW.fortify || {}).effects || {}).filter((k) => /^DBO_/.test(k))).every((x) => x in RW.records));
check('overTime: from 60% (Philter, Elixir) over 5 s', RW.overTime && RW.overTime.fromShare === 0.6 && RW.overTime.seconds === 5);
check('poisons ship judged (judge true, 18 Oct), as a share of a 200-point pool', RW.poisons && RW.poisons.judge === true && RW.poisons.anchorPool === 200);
check('the 6 combinations ship for Expert and Master once the PC records are mapped (none left planned)', Array.isArray(RW.combos) && RW.combos.length === 6 && !RW._combosPlanned && RW.combos.every((c) => c.minTier === 4 && c.byTier[3] && c.byTier[4] && RW.records[c.byTier[3]] && RW.records[c.byTier[4]]));
check('every PC record is mapped to an id of DragonBreak Online Edits.esp (alchemy-records-apply.js, 15 Oct)', Object.values(RW.records || {}).every((v) => /^[0-9a-f]{1,6}:DragonBreak Online Edits\.esp$/.test(v)));
check('poison words: Level 1 and 25 "Poison" (Weak is the drop-only one)', JSON.stringify(RW.words.poison) === JSON.stringify(['Poison', 'Poison', 'Potent Poison', 'Virulent Poison', 'Deadly Poison']));

// ---- mock records ---------------------------------------------------------------------------------------------------
const PLUGINS = { 'Skyrim.esm': 0x00, 'Dawnguard.esm': 0x02, 'BSAssets.esm': 0x07, 'BSHeartland.esm': 0x08, 'Mock.esp': 0x50, 'DragonBreak Online Edits.esp': 0x60 };
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const TABLE = JSON.parse(fs.readFileSync('alchemy-potions.json', 'utf8')).effects;
const EDID = new Map();
for (const v of Object.values(TABLE)) for (const p of v.potions) EDID.set(p.edid, { id: idOf(p.id), mag: p.mag, dur: p.dur });
const pid = (edid) => EDID.get(edid).id;
const RECORDS = {};
const bytes = (n) => new Uint8Array(n);
const MGEF = (desc, edid, cost, { flags = 0, archetype = 0, av = -1 } = {}) => {
  const data = bytes(152); const v = new DataView(data.buffer);
  v.setUint32(0, flags, true); v.setFloat32(4, cost, true); v.setUint32(0x40, archetype, true); v.setInt32(0x44, av, true);
  RECORDS[idOf(desc)] = { type: 'MGEF', editorId: edid, fields: [{ type: 'DATA', data }] };
};
MGEF('3eb15:Skyrim.esm', 'AlchRestoreHealth', 0.5, { av: 24 });
MGEF('3eb19:Skyrim.esm', 'AlchFortifyOneHanded', 0.5, { av: 135, flags: 0x2, archetype: 34 });
MGEF('3eb21:Skyrim.esm', 'AlchFortifyLockpicking', 0.5, { av: 143, flags: 0x2, archetype: 34 });
MGEF('3eb27:Skyrim.esm', 'AlchFortifyIllusion', 0.6, { av: 150, flags: 0x2, archetype: 34 });
MGEF('73f30:Skyrim.esm', 'AlchParalysis', 500, { av: 53, flags: 0x5, archetype: 21 });
MGEF('3eb42:Skyrim.esm', 'AlchDamageHealth', 3, { av: 24, flags: 0x5 });
MGEF('10aa4a:Skyrim.esm', 'AlchDamageHealthDuration', 2, { av: 24, flags: 0x5 });
MGEF('60193e:BSAssets.esm', 'BSKAlchLight', 0.5, { archetype: 12 });
MGEF('e01:DragonBreak Online Edits.esp', 'DBO_AlchRestoreHealthEffect', 0.5, { av: 24 });
MGEF('e02:DragonBreak Online Edits.esp', 'DBO_AlchRestoreHealthSlowEffect', 0.5, { av: 24 });
MGEF('e03:DragonBreak Online Edits.esp', 'DBO_AlchFortifyBladeEffect', 0.5, { av: 135, flags: 0x2, archetype: 34 });
const u32 = (n) => { const b = bytes(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const efit = (mag, dur) => { const b = bytes(12); const v = new DataView(b.buffer); v.setFloat32(0, mag, true); v.setUint32(8, dur, true); return b; };
const ALCH = (id, edid, effects, flags = 0, value = 0) => {
  const enit = bytes(20); new DataView(enit.buffer).setUint32(4, flags, true); new DataView(enit.buffer).setInt32(0, value, true);
  RECORDS[id] = { type: 'ALCH', editorId: edid, fields: [{ type: 'ENIT', data: enit }].concat(effects.flatMap(([mg, mag, dur]) => [{ type: 'EFID', data: u32(idOf(mg)) }, { type: 'EFIT', data: efit(mag, dur || 0) }])) };
};
ALCH(pid('FortifySkillOneHanded02'), 'FortifySkillOneHanded02', [['3eb19:Skyrim.esm', 30, 60]]);
ALCH(pid('FortifySkillOneHanded03'), 'FortifySkillOneHanded03', [['3eb19:Skyrim.esm', 40, 60]]);
ALCH(pid('FortifySkillLockpicking02'), 'FortifySkillLockpicking02', [['3eb21:Skyrim.esm', 30, 30]]);
ALCH(pid('FortifySkillLockpicking04'), 'FortifySkillLockpicking04', [['3eb21:Skyrim.esm', 50, 30]]);
ALCH(pid('RestoreHealth05'), 'RestoreHealth05', [['3eb15:Skyrim.esm', 150]]);
const DBO = (n) => idOf(`${n}:DragonBreak Online Edits.esp`);
ALCH(DBO('a01'), 'DBO_AlchRestoreHealthT1', [['e01:DragonBreak Online Edits.esp', 20]]);
ALCH(DBO('a04'), 'DBO_AlchRestoreHealthT4', [['e02:DragonBreak Online Edits.esp', 60]]);
ALCH(DBO('a10'), 'DBO_AlchFortifyBladeT3', [['e03:DragonBreak Online Edits.esp', 10, 60]]);
ALCH(DBO('a11'), 'DBO_AlchFortifyBladeT4', [['e03:DragonBreak Online Edits.esp', 15, 60]]);
ALCH(DBO('a20'), 'DBO_AlchLightT2', [['60193e:BSAssets.esm', 5, 60]]);
ALCH(DBO('a30'), 'DBO_AlchPoisonHealthT3', [['3eb42:Skyrim.esm', 40], ['10aa4a:Skyrim.esm', 3, 10]], 0x20000);
ALCH(DBO('a31'), 'SomethingElse', [['3eb15:Skyrim.esm', 50]]);
const INGR = (n, edid, effects, value = 1) => { const id = idOf(`${n}:Mock.esp`); const data = bytes(8); new DataView(data.buffer).setInt32(0, value, true); RECORDS[id] = { type: 'INGR', editorId: edid, fields: effects.map((d) => ({ type: 'EFID', data: u32(idOf(d)) })).concat([{ type: 'DATA', data }]) }; return id; };
const HEAL_A = INGR('101', 'HealA', ['3eb15:Skyrim.esm'], 2), HEAL_B = INGR('102', 'HealB', ['3eb15:Skyrim.esm'], 3);
const ONE_A = INGR('103', 'OneA', ['3eb19:Skyrim.esm'], 10), ONE_B = INGR('104', 'OneB', ['3eb19:Skyrim.esm'], 10);
const ILL_A = INGR('105', 'IllA', ['3eb27:Skyrim.esm']), ILL_B = INGR('106', 'IllB', ['3eb27:Skyrim.esm']);
const PAR_A = INGR('107', 'ParA', ['73f30:Skyrim.esm']), PAR_B = INGR('108', 'ParB', ['73f30:Skyrim.esm']);
const LIGHT_A = INGR('109', 'LightA', ['60193e:BSAssets.esm']), LIGHT_B = INGR('10a', 'LightB', ['60193e:BSAssets.esm']);
RECORDS[idOf('bad0c:Skyrim.esm')] = { type: 'FURN', editorId: 'CraftingAlchemyWorkbench', fields: [] };
const WEAPON = idOf('200:Mock.esp');
RECORDS[WEAPON] = { type: 'WEAP', editorId: 'MockSword', fields: [] };

// ---- the mock server ------------------------------------------------------------------------------------------------
const props = new Map();
const put = (id, p, v) => props.set(id + '|' + p, v);
const A = 0x14, B = 0x15, LAB = 0x5000;
const tierOf = (a, tier) => put(a, 'private.mastery', { v: 2, skills: { alchemist: { level: [1, 25, 50, 75, 90][tier - 1], xp: 0, rank: tier - 1 } }, order: ['alchemist'] });
const stockAll = () => put(A, 'inventory', { entries: [HEAL_A, HEAL_B, ONE_A, ONE_B, ILL_A, ILL_B, PAR_A, PAR_B, LIGHT_A, LIGHT_B].map((baseId) => ({ baseId, count: 5 })) });
const count = (baseId) => (props.get(A + '|inventory') || { entries: [] }).entries.filter((e) => e.baseId === baseId).reduce((n, e) => n + e.count, 0);
for (const a of [A, B]) { put(a, 'worldOrCellDesc', 'a:Skyrim.esm'); put(a, 'pos', [0, 0, 0]); put(a, 'profileId', a); }
put(LAB, 'baseDesc', 'bad0c:Skyrim.esm'); put(LAB, 'worldOrCellDesc', 'a:Skyrim.esm'); put(LAB, 'pos', [50, 0, 0]);
const out = { said: [], logs: [], sets: [] };
const mp = {
  getIdFromDesc: idOf,
  getDescFromId: (id) => `${(id & 0xffffff).toString(16)}:${Object.keys(PLUGINS).find((k) => PLUGINS[k] === (id >>> 24))}`,
  get: (id, p) => props.get(id + '|' + p),
  set: (id, p, v) => { if (p === 'percentages') out.sets.push([id, v]); props.set(id + '|' + p, JSON.parse(JSON.stringify(v))); },
  lookupEspmRecordById: (id) => (RECORDS[id] ? { record: RECORDS[id], toGlobalRecordId: (local) => local } : null),
  callPapyrusFunction: () => false,
};
const api = (cfg) => ({ mp, cfg, log: (...x) => out.logs.push(x.join(' ')), personal: (a, t) => out.said.push(t), audit: () => {}, who: () => 'P', display: () => 'P',
  openWidget: () => {}, closeWidget: () => {}, every: () => {}, itemName: () => '', onUi: () => {}, sendPacket: () => {} });
const MAPPED = { DBO_AlchRestoreHealthEffect: 'e01:DragonBreak Online Edits.esp', DBO_AlchRestoreHealthSlowEffect: 'e02:DragonBreak Online Edits.esp', DBO_AlchFortifyBladeEffect: 'e03:DragonBreak Online Edits.esp',
  DBO_AlchRestoreHealthT1: 'a01:DragonBreak Online Edits.esp', DBO_AlchRestoreHealthT4: 'a04:DragonBreak Online Edits.esp', DBO_AlchFortifyBladeT3: 'a10:DragonBreak Online Edits.esp', DBO_AlchFortifyBladeT4: 'a11:DragonBreak Online Edits.esp',
  DBO_AlchLightT2: 'a20:DragonBreak Online Edits.esp', DBO_AlchPoisonHealthT3: 'a30:DragonBreak Online Edits.esp', DBO_AlchRestoreHealthT2: 'a31:DragonBreak Online Edits.esp' };
const load = (rw = {}) => { mp.onEatItem = () => true; out.logs.length = 0; const p = path.resolve('alchemy.js'); delete require.cache[p]; require(p)(api({ alchemyRework: rw })); };
let clock = 1790000000000;
Date.now = () => clock;
const craft = (ids) => { clock += 5000; out.said.length = 0; mp.onCraftUnmatched(A, LAB, 0xff000123, { entries: ids.map((baseId) => ({ baseId, count: 1 })) }); return out.said[0] || ''; };
const tick = () => new Promise((r) => setImmediate(r));
const drink = async (id, start, cppGain) => {
  put(A, 'percentages', Object.assign({}, start));
  mp.onEatItem(A, id);
  if (cppGain) { const p = Object.assign({}, mp.get(A, 'percentages')); for (const k of Object.keys(cppGain)) p[k] = Math.min(1, p[k] + cppGain[k]); props.set(A + '|percentages', p); }
  await tick();
  return mp.get(A, 'percentages');
};
const ticks = (n) => { for (let i = 0; i < n; i++) globalThis.__dboAlchemyRunTicks(); };

(async () => {
  // ---- before the PC's ids: the vanilla fallback, named for what it is ----
  // the shipped file is mapped now; the unmapped fallback is pinned with every record blanked
  const BLANK = Object.fromEntries(Object.keys(RW.records || {}).map((k) => [k, '']));
  load({ records: BLANK });
  check('without mapped ids, alchemy.js says the PC records wait and loads', /PC record\(s\) not mapped yet/.test(out.logs.join('\n')), out.logs);
  tierOf(A, 3); stockAll();
  let msg = craft([ONE_A, ONE_B]);
  check('an Adept mixing One-handed ingredients gets the vanilla One-handed potion while unmapped', count(pid('FortifySkillOneHanded02')) === 1 && /Solution of Fortify One-handed/.test(msg), msg);
  tierOf(A, 2); stockAll();
  msg = craft([LIGHT_A, LIGHT_B]);
  check('Light brews nothing until its record is mapped', !/You brew/.test(msg), msg);

  // ---- with the PC's ids ----
  load({ records: MAPPED });
  check('a mapped desc carrying another editor id is refused', /DBO_AlchRestoreHealthT2 -> a31:DragonBreak Online Edits\.esp is SomethingElse, not DBO_AlchRestoreHealthT2; left out/.test(out.logs.join('\n')), out.logs);
  tierOf(A, 3); stockAll();
  msg = craft([ONE_A, ONE_B]);
  check('One-handed ingredients make Fortify One-handed (by hands), never Blade: the vanilla record while unmapped', count(DBO('a10')) === 0 && count(pid('FortifySkillOneHanded02')) === 1 && /Solution of Fortify One-handed/.test(msg), msg);
  // the Blade specialty: Bear Claws + Black Eagle Feathers + Canis Root
  const CLAW = idOf('06bc02:Skyrim.esm'), EAGLE = idOf('05ef50:BSHeartland.esm'), CANIS = idOf('06abcb:Skyrim.esm');
  for (const [id, e] of [[CLAW, 'BearClaws'], [EAGLE, 'CYRBlackEagleFeathers'], [CANIS, 'CanisRoot01']]) RECORDS[id] = { type: 'INGR', editorId: e, fields: [{ type: 'EFID', data: u32(idOf('3eb19:Skyrim.esm')) }] };
  tierOf(A, 3); put(A, 'inventory', { entries: [CLAW, EAGLE, CANIS].map((baseId) => ({ baseId, count: 2 })) });
  msg = craft([CLAW, EAGLE, CANIS]);
  check('Bear Claws + Black Eagle Feathers + Canis Root: an Adept brews DBO_AlchFortifyBladeT3, a Solution of Fortify Blade', count(DBO('a10')) === 1 && /Solution of Fortify Blade \(\+10% blade damage for 60 s\)/.test(msg), msg);
  check('...one of each taken', count(CLAW) === 1 && count(EAGLE) === 1 && count(CANIS) === 1);
  tierOf(A, 4); craft([CLAW, EAGLE, CANIS]);
  check('...an Expert the Philter (T4)', count(DBO('a11')) === 1);
  tierOf(A, 2); put(A, 'inventory', { entries: [CLAW, EAGLE, CANIS].map((baseId) => ({ baseId, count: 2 })) });
  msg = craft([CLAW, EAGLE, CANIS]);
  check('...an Apprentice brews the mix as any other, told what it makes at Adept', count(DBO('a10')) === 0 && /These make a potion of Fortify Blade for an Alchemist of Adept rank \(level 50\)\./.test(msg), msg);
  // the Blood Potion: Vampire Dust + Human Heart + Nightshade at a Master's lab
  const DUST = idOf('03ad76:Skyrim.esm'), HEART = idOf('0b18cd:Skyrim.esm'), SHADE = idOf('02f44c:Skyrim.esm'), DG_BLOOD = idOf('018ef3:Dawnguard.esm');
  for (const [id, e] of [[DUST, 'vampireDust'], [HEART, 'HumanHeart'], [SHADE, 'Nightshade']]) RECORDS[id] = { type: 'INGR', editorId: e, fields: [{ type: 'EFID', data: u32(idOf('3eb15:Skyrim.esm')) }] };
  ALCH(DG_BLOOD, 'DLC1BloodPotion', [['3eb15:Skyrim.esm', 100]]);
  load({ records: MAPPED });
  tierOf(A, 5); put(A, 'inventory', { entries: [DUST, HEART, SHADE].map((baseId) => ({ baseId, count: 1 })) });
  msg = craft([DUST, HEART, SHADE]);
  check('a Master brews a Blood Potion (Dawnguard\'s record until the PC\'s is mapped)', count(DG_BLOOD) === 1 && /^You brew a Blood Potion/.test(msg), msg);
  tierOf(A, 4); put(A, 'inventory', { entries: [DUST, HEART, SHADE].map((baseId) => ({ baseId, count: 1 })) });
  msg = craft([DUST, HEART, SHADE]);
  check('...an Expert does not', count(DG_BLOOD) === 0 && /These make a Blood Potion for an Alchemist of Master rank/.test(msg), msg);
  let fed = [];
  globalThis.__dboSuperBloodPotion = (a) => { fed.push(a); return true; };
  await drink(DG_BLOOD, { health: 0.5, magicka: 1, stamina: 1 });
  check('drinking it asks supernatural.js to count a feed', fed.length === 1 && fed[0] === A, fed);
  delete globalThis.__dboSuperBloodPotion;
  tierOf(A, 2); stockAll();
  msg = craft([LIGHT_A, LIGHT_B]);
  check('mapped: an Apprentice brews Light (DBO_AlchLightT2) from the Beyond Skyrim effect', count(DBO('a20')) === 1 && /Draught of Light/.test(msg), msg);
  tierOf(A, 2); stockAll();
  craft([HEAL_A, HEAL_B]);
  check('...the refused Apprentice restore falls back to vanilla RestoreHealth03', count(pid('RestoreHealth03')) === 1);

  // ---- a planned combination, once mapped: named by tier ----
  MGEF('3eb16:Skyrim.esm', 'AlchRestoreStamina', 0.5, { av: 26 });
  ALCH(DBO('c04'), 'DBO_AlchComboRestoreHealthStaminaT4', [['e02:DragonBreak Online Edits.esp', 45]]);
  ALCH(DBO('c05'), 'DBO_AlchComboRestoreHealthStaminaT5', [['e02:DragonBreak Online Edits.esp', 60]]);
  const VIG_A = INGR('10b', 'VigA', ['3eb15:Skyrim.esm', '3eb16:Skyrim.esm']), VIG_B = INGR('10c', 'VigB', ['3eb15:Skyrim.esm', '3eb16:Skyrim.esm']);
  const planned = (RW.combos || []).concat(RW._combosPlanned || []).find((c) => c.effects.join() === '03eb15,03eb16');
  load({ records: Object.assign({ DBO_AlchComboRestoreHealthStaminaT4: 'c04:DragonBreak Online Edits.esp', DBO_AlchComboRestoreHealthStaminaT5: 'c05:DragonBreak Online Edits.esp' }, MAPPED), combos: planned ? [planned] : [] });
  for (const [t, id, word] of [[4, DBO('c04'), 'Philter'], [5, DBO('c05'), 'Elixir']]) {
    tierOf(A, t); put(A, 'inventory', { entries: [{ baseId: VIG_A, count: 2 }, { baseId: VIG_B, count: 2 }] });
    msg = craft([VIG_A, VIG_B]);
    check(`the planned Health + Stamina combination at tier ${t}: ${word} of Health and Stamina`, count(id) === 1 && msg.includes(`${word} of Health and Stamina`), msg);
  }
  load({ records: MAPPED });

  // ---- dropped and PvP gates ----
  for (const t of [1, 5]) {
    tierOf(A, t); stockAll();
    const inv = JSON.stringify(props.get(A + '|inventory'));
    msg = craft([ILL_A, ILL_B]);
    check(`tier ${t}: Fortify Illusion is not brewed and the ingredients are kept`, JSON.stringify(props.get(A + '|inventory')) === inv && /^You cannot brew that\. Fortify Illusion is not brewed here: no Illusion spell is judged on the server\. You keep your ingredients\.$/.test(msg), msg);
  }
  tierOf(A, 3); stockAll();
  msg = craft([PAR_A, PAR_B]);
  check('an Adept cannot brew Paralysis (Expert, 75)', count(pid('Paralyze02')) === 0 && /Paralysis needs an Alchemist of Expert rank \(level 75\)/.test(msg), msg);
  tierOf(A, 4); stockAll();
  craft([PAR_A, PAR_B]);
  check('...an Expert brews Paralyze02 (5 s)', count(pid('Paralyze02')) === 1);

  // ---- restores: percent effects, over time ----
  let p = await drink(DBO('a01'), { health: 0.3, magicka: 0.5, stamina: 0.5 }, { health: 0.2 * 0.7 });
  check('a PC Potion of Healing (percent effect, magnitude 20) gives 20% at once', near(p.health, 0.5), p);
  p = await drink(DBO('a04'), { health: 0.2, magicka: 0.5, stamina: 0.5 }, { health: 0.4 });
  check('a PC Philter (slow effect, 60) gives nothing at once', near(p.health, 0.2), p);
  ticks(4);
  check('...6% a tick (ten ticks over 5 s)', near(mp.get(A, 'percentages').health, 0.44), mp.get(A, 'percentages'));
  props.set(A + '|percentages', Object.assign({}, mp.get(A, 'percentages'), { health: 0.1 }));
  ticks(1);
  check('...a blow between ticks still lands (burst can win)', near(mp.get(A, 'percentages').health, 0.16), mp.get(A, 'percentages'));
  clock += 11000;
  p = await drink(pid('RestoreHealth05'), Object.assign({}, mp.get(A, 'percentages')), { health: 0.5 });
  ticks(10);
  check('a new slow drink replaces the running one: 0.16 + 60%, not more', near(mp.get(A, 'percentages').health, 0.76), mp.get(A, 'percentages'));
  ticks(3);
  check('...and stops when it is done', near(mp.get(A, 'percentages').health, 0.76));
  await drink(pid('RestoreHealth05'), { health: 0.5, magicka: 0.5, stamina: 0.5 }, { health: 0.5 });
  props.set(A + '|percentages', { health: 0, magicka: 0.5, stamina: 0.5 });
  ticks(2);
  check('...and for the dead', mp.get(A, 'percentages').health === 0);

  // ---- fortify ----
  load({ records: MAPPED });
  const bonus = (a, h) => globalThis.__dboPotionBonus(a, h);
  await drink(pid('FortifySkillOneHanded02'), { health: 1, magicka: 1, stamina: 1 });
  check('a vanilla Fortify One-handed (30%) feeds one-handed blows +30%', near(bonus(A, 'one'), 0.3) && bonus(A, 'blade') === 0, bonus(A, 'one'));
  await drink(pid('FortifySkillOneHanded03'), { health: 1, magicka: 1, stamina: 1 });
  check('...a second replaces it, never stacks (+40%)', near(bonus(A, 'one'), 0.4));
  await drink(DBO('a11'), { health: 1, magicka: 1, stamina: 1 });
  check('a PC Philter of Fortify Blade feeds blade blows +15%', near(bonus(A, 'blade'), 0.15));
  check('...nobody else', bonus(B, 'blade') === 0);
  clock += 61000;
  check('...and both wear off after 60 s', bonus(A, 'blade') === 0 && bonus(A, 'one') === 0);
  await drink(pid('FortifySkillLockpicking02'), { health: 1, magicka: 1, stamina: 1 });
  check('Fortify Lockpicking 30% counts as one Lockpicking rank more', globalThis.__dboPotionLockpickTiers(A) === 1);
  await drink(pid('FortifySkillLockpicking04'), { health: 1, magicka: 1, stamina: 1 });
  check('...50% as two', globalThis.__dboPotionLockpickTiers(A) === 2);

  // ---- Fortify Alchemy on worn gear (Nate, 18 Oct): one strength up at most, capped per item and in all ----
  {
    load({ records: MAPPED });
    const FA = idOf('08b65c:Skyrim.esm');
    const ring = (mag) => ({ baseId: 0x9000, count: 1, worn: true, enchantmentEffects: [{ effectId: FA, magnitude: mag, duration: 0, area: 0 }] });
    const realRandom = Math.random;
    const brewWith = (worn, roll, tier = 3) => { tierOf(A, tier); stockAll(); const e = props.get(A + '|inventory').entries; props.set(A + '|inventory', { entries: e.concat(worn) }); Math.random = () => roll; const m = craft([ONE_A, ONE_B]); Math.random = realRandom; return m; };
    let m = brewWith([], 0);
    check('gear: none worn, an Adept brews the Solution as before', count(pid('FortifySkillOneHanded02')) === 1 && !/steadies/.test(m), m);
    m = brewWith([ring(20)], 0.1);
    check('gear: a 20% ring and a roll under it: one strength up, and told why', count(pid('FortifySkillOneHanded02')) === 0 && /steadies your hand/.test(m), m);
    m = brewWith([ring(20)], 0.3);
    check('gear: a roll over it brews as the rank does', count(pid('FortifySkillOneHanded02')) === 1 && !/steadies/.test(m), m);
    props.set(A + '|inventory', { entries: [ring(500)] });
    check('gear: a forged 500% ring counts as 25% (perItemCap)', globalThis.__dboGearFortifyAlchemy(A) === 25);
    const bag = props.get(A + '|inventory').entries;
    props.set(A + '|inventory', { entries: bag.concat([ring(25), ring(25), ring(25), ring(25), ring(25), Object.assign(ring(25), { worn: false })]) });
    check('gear: all worn together count at most 100%, and an unworn copy not at all', globalThis.__dboGearFortifyAlchemy(A) === 100, globalThis.__dboGearFortifyAlchemy(A));
    m = brewWith([ring(25), ring(25), ring(25), ring(25)], 0.99, 5);
    check('gear: a Master gains nothing past Master strength', /steadies/.test(m) === false, m);
  }
  // ---- poisons ----
  put(A, 'inventory', { entries: [{ baseId: WEAPON, count: 1, worn: true, poisonId: DBO('a30'), poisonCount: 1 }] });
  put(B, 'percentages', { health: 1, magicka: 1, stamina: 1 });
  load({ records: MAPPED, poisons: Object.assign({}, RW.poisons, { judge: false }) });
  check('poisons are inert with judge false', globalThis.__dboPoisonHit(A, B, WEAPON, {}) === null);
  load({ records: MAPPED, poisons: Object.assign({}, RW.poisons, { judge: true }) });
  out.sets.length = 0;
  const got = globalThis.__dboPoisonHit(A, B, WEAPON, {});
  await tick();
  check('judged: a Potent Poison (40 points) takes 20% of the target\'s pool', got && near(mp.get(B, 'percentages').health, 0.8), mp.get(B, 'percentages'));
  ticks(20);
  check('...and drains 3 points a second for 10 s: 1.5% a second, 15% in all', near(mp.get(B, 'percentages').health, 0.65), mp.get(B, 'percentages'));
  check('...one charge: the next blow carries none', globalThis.__dboPoisonHit(A, B, WEAPON, {}) === null);
  put(A, 'inventory', { entries: [{ baseId: WEAPON, count: 1, worn: true }] });
  globalThis.__dboPoisonHit(A, B, WEAPON, {});
  put(A, 'inventory', { entries: [{ baseId: WEAPON, count: 1, worn: true, poisonId: DBO('a30'), poisonCount: 1 }] });
  check('...a fresh coat after the weapon was seen clean counts again', !!globalThis.__dboPoisonHit(A, B, WEAPON, { blocked: false }));
  await tick();
  put(B, 'percentages', { health: 0.05, magicka: 1, stamina: 1 });
  ticks(20);
  check('poison never lands the killing blow (1% left)', near(mp.get(B, 'percentages').health, 0.01), mp.get(B, 'percentages'));
  put(A, 'inventory', { entries: [{ baseId: WEAPON, count: 1, worn: true, poisonId: DBO('a30'), poisonCount: 2 }] });
  check('a blocked blow or a spell carries no poison', globalThis.__dboPoisonHit(A, B, WEAPON, { blocked: true }) === null && globalThis.__dboPoisonHit(A, B, WEAPON, { spell: true }) === null);

  // ---- the server's hooks ----
  const GM = fs.readFileSync('gamemode.js', 'utf8');
  const a0 = GM.indexOf('const potionBonus = '), b0 = GM.indexOf('// Weapon materials: vanilla keeps');
  let potionAttackMult = null;
  try {
    const skills = { 1: 'blade', 2: 'blunt', 3: 'archery', 4: '' }, hands = { 1: 'one', 2: 'two', 3: 'bow', 4: '' };
    potionAttackMult = new Function('weaponSkillOf', 'weaponHandsOf', 'isSpellSource', 'spellSchoolOf', GM.slice(a0, b0) + '\nreturn potionAttackMult;')((s) => skills[s] || '', (s) => hands[s] || '', (s) => s >= 20, (s) => s);
  } catch (e) { /* not there */ }
  check('gamemode.js has potionAttackMult', typeof potionAttackMult === 'function');
  if (potionAttackMult) {
    const saved = globalThis.__dboPotionBonus;
    const has = { blade: 0.1, two: 0.3, 'school:20': 0.2, 'school:22': 0.15 };
    globalThis.__dboPotionBonus = (a, h) => has[h] || 0;
    check('...a one-handed blade takes the Blade bonus, a two-handed blunt the Two-handed one', near(potionAttackMult(A, 1), 1.1) && near(potionAttackMult(A, 2), 1.3) && near(potionAttackMult(A, 3), 1));
    check('...a Destruction and a Restoration spell their school\'s, an Alteration spell none', near(potionAttackMult(A, 20), 1.2) && near(potionAttackMult(A, 22), 1.15) && near(potionAttackMult(A, 18), 1));
    globalThis.__dboPotionBonus = saved;
  }
  check('the hit multiplies by it (never for a beast)', /beastAgg \? 1 : masteryDamageMult\(agg, src\) \* potionAttackMult\(agg, src\)\)/.test(GM));
  check('armour counts for the Fortify Armor bonus (defenseDamageMult)', /counted \*= 1 \+ potionBonus\(targetId, 'armor'\);/.test(GM));
  check('a Flesh spell lasts the Fortify Alteration bonus longer', /f\.seconds \* 1000 \* \(1 \+ \(typeof globalThis\.__dboPotionBonus === 'function' \? Math\.max\(0, Number\(globalThis\.__dboPotionBonus\(casterId >>> 0, 'duration:18'\)\) \|\| 0\) : 0\)\)/.test(GM));
  check('a summon lasts the Fortify Conjuration bonus longer', /__dboPotionBonus\(owner >>> 0, 'duration:19'\)/.test(GM));
  check('a self-cast Restoration heal gets the Fortify Restoration share (castHook)', /potionRestorationCast\(Number\(casterId\) >>> 0, Number\(spellId\) >>> 0\)/.test(GM) && /spellSchoolOf\(spellId >>> 0\) !== 22/.test(GM));
  check('both landing paths of the hit judge hand weapon blows to the poison judge', (GM.match(/potionPoisonHit\(agg, tgt, src, dmg, flags\);/g) || []).length === 2);
  check('a failed alchemy.js load clears the new hooks', /alchemy\.js failed to load[^\n]*__dboPotionBonus = null; globalThis\.__dboPotionLockpickTiers = null; globalThis\.__dboPoisonHit = null;/.test(GM));
  // with worn Fortify Block beside it since 20 Oct (gearench.js), together at most all of the blow
  check('combat.js: Fortify Defence lets less through a block', /const through = raw \* share \* \(broken \? 1 : 1 - Math\.min\(1, blockPotion \+ blockGear\)\);/.test(fs.readFileSync('combat.js', 'utf8')));
  check('lockpick.js: a Lockpicking potion counts as ranks, up to Master', /__dboPotionLockpickTiers[\s\S]{0,200}Math\.min\(4, own \+ extra\)/.test(fs.readFileSync('lockpick.js', 'utf8')));

  // ---- craft XP by value (skillrates.js) ----
  const field = (type, n) => { const d = bytes(8); new DataView(d.buffer).setInt32(0, n, true); return { type, data: d }; };
  const REC = {
    0x901: { type: 'INGR', editorId: 'SaltPile', fields: [field('DATA', 2)] }, 0x902: { type: 'INGR', editorId: 'Potato', fields: [field('DATA', 1)] },
    0x903: { type: 'ALCH', editorId: 'Butter', fields: [field('ENIT', 4)] }, 0x904: { type: 'INGR', editorId: 'Venison', fields: [field('DATA', 4)] },
  };
  const cnto = (id, n) => { const d = bytes(8); const v = new DataView(d.buffer); v.setUint32(0, id, true); v.setUint32(4, n, true); return { type: 'CNTO', data: d }; };
  REC[0x951] = { type: 'COBJ', editorId: 'RecipeSoup', fields: [cnto(0x901, 1), cnto(0x902, 1)] };
  REC[0x952] = { type: 'COBJ', editorId: 'RecipeStew', fields: [cnto(0x901, 1), cnto(0x903, 1), cnto(0x904, 1)] };
  const recordOf = (id) => (REC[id] ? { record: REC[id], toGlobalRecordId: (l) => l } : null);
  const fieldsOf = (lr, type) => ((lr && lr.record && lr.record.fields) || []).filter((f) => f.type === type);
  const SR = path.resolve('skillrates.js'); delete require.cache[SR];
  const CFG = JSON.parse(fs.readFileSync('gamemode-config.json', 'utf8'));
  require(SR)({ log: () => {}, cfg: { skillRates: Object.assign({}, CFG.skillRates, { firstCraft: { enabled: false } }) }, recordOf, fieldsOf, inBeastForm: () => false, mp, personal: () => {} });
  const rate = globalThis.__dboSkillRate;
  check('a pot of potato soup (3 gold in, worth 5) earns half a craft: cook craft x2 x 0.5', near(rate(A, 'cook', 'craft', { recipeId: 0x951, value: 5 }), 2 * 0.5), rate(A, 'cook', 'craft', { recipeId: 0x951, value: 5 }));
  check('...a stew (10 gold in) a full one: x2', near(rate(A, 'cook', 'craft', { recipeId: 0x952, value: 6 }), 2));
  check('...never more than today, however rich', near(rate(A, 'cook', 'craft', { recipeId: 0x952, value: 400 }), 2));
  globalThis.__dboBrewValue = { actor: A, key: 0x777, value: 3 };
  check('a brew from 3 gold of ingredients still teaches half: alchemist x2 x 0.5', near(rate(A, 'alchemist', 'award', { key: 0x777 }), 2 * 0.5), rate(A, 'alchemist', 'award', { key: 0x777 }));
  globalThis.__dboBrewValue = { actor: A, key: 0x777, value: 30 };
  check('...from 30 gold: x2', near(rate(A, 'alchemist', 'award', { key: 0x777 }), 2));
  check('...another potion\'s award is not weighted by it', near(rate(A, 'alchemist', 'award', { key: 0x778 }), 2));
  check('other skills are untouched (miner x2)', near(rate(A, 'miner', 'mine', {}), 2));
  const AL = fs.readFileSync('alchemy.js', 'utf8');
  check('alchemy.js passes each brew\'s ingredient value to the award (lab, drinks, Draught, specialties)', (AL.match(/creditBrew\([^\n]*ingredientValue\(/g) || []).length === 4);

  // ---- Fortify Health is extra health; Sleeping Tree Sap ----
  load({ records: MAPPED });
  MGEF('3eaf3:Skyrim.esm', 'AlchFortifyHealth', 0.35, { av: 24, flags: 0x2, archetype: 34 });
  ALCH(pid('FortifyHealth03'), 'FortifyHealth03', [['3eaf3:Skyrim.esm', 60, 60]]);
  load({ records: MAPPED });
  let fp = await drink(pid('FortifyHealth03'), { health: 0.4, magicka: 1, stamina: 1 }, { health: 0.4 });
  check('Fortify Health 60: the C++\'s 60-point heal comes off, 60 extra health for 60 s', near(fp.health, 0.4) && near(globalThis.__dboPotionBonus(A, 'health'), 60), [fp, globalThis.__dboPotionBonus(A, 'health')]);
  const a1 = GM.indexOf('const potionMaxSeen = '), b1 = GM.indexOf('const potionAttackMult = ');
  let potionTakenMult = null;
  try { potionTakenMult = new Function('potionBonus', 'globalThis', GM.slice(a1, b1) + '\nreturn potionTakenMult;')((a, h) => globalThis.__dboPotionBonus(a, h), globalThis); } catch (e) { /* not there */ }
  check('gamemode.js has potionTakenMult', typeof potionTakenMult === 'function');
  if (potionTakenMult) {
    check('...a weapon hit on a 150-point pool with 60 extra lands at 150/210', near(potionTakenMult(A, { targetMaxHealth: 150 }), 150 / 210));
    check('...a spell hit (no maximum named) uses the last maximum seen', near(potionTakenMult(A, { spell: true }), 150 / 210));
    check('...nobody else', potionTakenMult(B, { targetMaxHealth: 150 }) === 1);
    await drink(pid('FortifyHealth03'), { health: 1, magicka: 1, stamina: 1 });
    check('...a second drink replaces, never stacks', near(potionTakenMult(A, { targetMaxHealth: 150 }), 150 / 210));
    clock += 61000;
    check('...and it wears off cleanly after 60 s', potionTakenMult(A, { targetMaxHealth: 150 }) === 1 && globalThis.__dboPotionBonus(A, 'health') === 0);
    const kept = globalThis.__dboPotionFortify;
    await drink(pid('FortifyHealth03'), { health: 1, magicka: 1, stamina: 1 });
    load({ records: MAPPED });
    check('...a reload keeps it (globalThis), keyed by the character, with its own end', globalThis.__dboPotionFortify === kept && near(globalThis.__dboPotionBonus(A, 'health'), 60));
    clock += 61000;
    check('...and still ends on time after the reload', globalThis.__dboPotionBonus(A, 'health') === 0);
  }
  check('the hit multiplies by potionTakenMult outside the racial cap', /potionAttackMult\(agg, src\)\) \* potionTakenMult\(tgt, flags\) \*/.test(GM));
  // the sap: inert as shipped, a Master's daily tap once enabled
  const SPIGOT = 0x7000;
  put(SPIGOT, 'baseDesc', '0e1fc1:Skyrim.esm');
  ALCH(DBO('a40'), 'DBO_AlchSleepingTreeSap', [['e04:DragonBreak Online Edits.esp', 25, 45]]);
  MGEF('e04:DragonBreak Online Edits.esp', 'DBO_AlchSleepingTreeSapEffect', 1, { av: 138, flags: 0x2, archetype: 34 });
  const SAPMAP = Object.assign({ DBO_AlchSleepingTreeSap: 'a40:DragonBreak Online Edits.esp', DBO_AlchSleepingTreeSapEffect: 'e04:DragonBreak Online Edits.esp' }, MAPPED);
  load({ records: SAPMAP });
  check('the Sleeping Tree is not tapped while the lock holds (sleepingTreeSap.enabled false)', RW.sleepingTreeSap && RW.sleepingTreeSap.enabled === false && globalThis.__dboSleepingTreeTap(SPIGOT, A) === false);
  load({ records: SAPMAP, sleepingTreeSap: Object.assign({}, RW.sleepingTreeSap, { enabled: true }) });
  tierOf(A, 4); put(A, 'inventory', { entries: [] }); props.delete(A + '|private.dboSapTapAt');
  clock += 5000; out.said.length = 0;
  check('enabled: an Expert is refused', globalThis.__dboSleepingTreeTap(SPIGOT, A) === true && count(DBO('a40')) === 0 && /Master rank/.test(out.said[0] || ''), out.said);
  tierOf(A, 5); clock += 5000;
  globalThis.__dboSleepingTreeTap(SPIGOT, A);
  check('...a Master taps one', count(DBO('a40')) === 1);
  clock += 5000; out.said.length = 0; globalThis.__dboSleepingTreeTap(SPIGOT, A);
  check('...once a day', count(DBO('a40')) === 1 && /Come back in about 24 hours/.test(out.said[0] || ''), out.said);
  await drink(DBO('a40'), { health: 1, magicka: 1, stamina: 1 });
  check('drinking the sap: 25% less damage taken for 45 s', near(globalThis.__dboPotionBonus(A, 'taken'), 0.25) && (!potionTakenMult || near(potionTakenMult(A, { targetMaxHealth: 150 }), 0.75)));
  load({ records: MAPPED });
  check('supernatural.js counts a Blood Potion as a vampire\'s meal, nobody else\'s', /globalThis\.__dboSuperBloodPotion = \(a\) => \{[\s\S]{0,200}s\.kind !== 'vampire'\) return false;[\s\S]{0,200}lastFed: gameDays\(\), stage: 1, unfed: null/.test(fs.readFileSync('supernatural.js', 'utf8')));

  // ---- the bucket said out loud ----
  {
    const told = [];
    const SR2 = path.resolve('skillrates.js'); delete require.cache[SR2];
    const CFG2 = JSON.parse(fs.readFileSync('gamemode-config.json', 'utf8'));
    require(SR2)({ log: () => {}, cfg: { skillRates: Object.assign({}, CFG2.skillRates, { firstCraft: { enabled: false } }) }, recordOf: () => null, fieldsOf: () => [], inBeastForm: () => false, mp, personal: (a, t) => told.push(t) });
    put(A, 'private.mastery', { skills: { cook: { level: 30, bucket: { tokens: 0.2, at: clock } } }, order: ['cook'] });
    const cr = globalThis.__dboSkillRateCredited;
    cr(A, 'cook', 'craft', {}, 0);
    check('the first craft at an empty bucket is told, with the wait (0.8 of a unit at 20 an hour: about 2 minutes)', told.length === 1 && /Your Cook has learned all it can for now[^.]*\. It counts again in about 2 minutes\./.test(told[0]), told);
    clock += 60000; cr(A, 'cook', 'craft', {}, 0);
    check('...not the next ones for ten minutes', told.length === 1, told);
    clock += 10 * 60000; put(A, 'private.mastery', { skills: { cook: { level: 30, bucket: { tokens: 0, at: clock } } }, order: ['cook'] });
    cr(A, 'cook', 'craft', {}, 0); cr(A, 'cook', 'craft', {}, 0);
    check('...then every refused craft', told.length === 3, told);
    cr(A, 'cook', 'craft', {}, 1.5);
    put(A, 'private.mastery', { skills: { cook: { level: 30, bucket: { tokens: 0, at: clock } } }, order: ['cook'] });
    cr(A, 'cook', 'craft', {}, 0); cr(A, 'cook', 'craft', {}, 0);
    check('...a craft that credits ends the run: the next empty bucket is told once again', told.length === 4, told);
    put(A, 'private.mastery', { skills: { cook: { level: 30, bucket: { tokens: 5, at: clock } } }, order: ['cook'] });
    clock += 11 * 60000; cr(A, 'cook', 'craft', {}, 0);
    check('...a refusal with a full bucket (the day\'s cap) is not this notice', told.length === 4, told);
  }

  // ---- Bruma food ----
  check('placed foods are harvest nodes: bread, honey, cheese, green apples, trout, turkey, brandy, watermelon, flour, milk',
    ['foodbread', 'foodhoney', 'foodcheesewheel', 'foodapple02', 'cyrfoodtrout', 'cyrfoodturkey', 'cyrfoodbrandybottle', 'bskfoodwatermelon', 'byohfoodflour', 'byohfoodmilk'].every((k) => new RegExp(`HARVEST_ITEM_PREFIXES = \\[[^\\]]*'${k}'`).test(GM)));
  const BREW = JSON.parse(fs.readFileSync('brewing.json', 'utf8')).recipes;
  check('Brandy (CYRFoodBrandyBottle01A) is brewed from three grapes', BREW.some((r) => r.product === '858ef:BSHeartland.esm' && r.name === 'Brandy' && JSON.stringify(r.inputs) === '[["601fca:BSAssets.esm",3]]'));

  // ---- kitchen staples ----
  const LOOT = JSON.parse(fs.readFileSync('loot.json', 'utf8')).pools;
  const STAPLES = ['BYOHFoodButter', 'BYOHFoodFlour', 'BYOHFoodMilk', 'FoodCheeseWheel02A', 'FoodHoney', 'BSKFoodCoffee'];
  check('every staple is in loot.json\'s food pool, for Cyrodiil', STAPLES.every((n) => (LOOT.food || []).some((it) => it.name === n && (!it.p || it.p.includes('cyrodiil')))));
  const DG = fs.readFileSync('dungeons.js', 'utf8'), WL = fs.readFileSync('wildlife.js', 'utf8');
  check('dungeon provisions draw the staples from the food pool, by the lease\'s province', /pickFrom\(provisionsFor\(ok\)\)/.test(DG) && /pool\('food', 0, ok\)\.filter\(\(it\) => PROVISION_FOODS\.has/.test(DG) && STAPLES.every((n) => DG.includes(`'${n}'`)));
  check('camp chests hold them now and then, by the camp\'s province', /CAMP_FOODS\.size && Math\.random\(\) < CAMP_FOOD_CHANCE/.test(WL) && STAPLES.every((n) => WL.includes(`'${n}'`)));

  console.log(`\n${checks - failures}/${checks} passed`);
  process.exit(failures ? 1 : 0);
})();
