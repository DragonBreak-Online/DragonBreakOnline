// Scripted test for gearench.js (enchantments the server judges, audit of 20 Oct) and its wiring in gamemode.js, racial.js,
// prayer.js, combat.js and pickpocket.js. No server and no game: run it from this folder's parent with
//   node tests/gear-enchant-harness.js
// Records are laid out as the plugins have them (MGEF DATA archetype at 0x40, actor value at 0x44, resist at 0x10; ENIT
// enchant type at 20; CTDA function at 8), with the ids of Skyrim.esm where one exists (read from /opt/skyrim-data 20 Oct).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : ` (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const flush = () => new Promise((r) => setImmediate(r));

// ---- records -----------------------------------------------------------------------------------------------------------
const records = new Map();
const add = (id, type, editorId, fields) => records.set(id >>> 0, { record: { type, editorId, fields }, toGlobalRecordId: (x) => x });
const buf = (n, f) => { const b = new Uint8Array(n); f(new DataView(b.buffer)); return b; };
const mgefData = (arch, av, flags, resist, cost = 1, av2 = -1, weight2 = 0) => buf(0x98, (v) => { v.setUint32(0, flags, true); v.setFloat32(4, cost, true); v.setInt32(16, resist, true); v.setFloat32(60, weight2, true); v.setUint32(0x40, arch, true); v.setInt32(0x44, av, true); v.setInt32(88, av2, true); });
const ctda = (op, fn, value, param = 0, flags = 0) => ({ type: 'CTDA', data: buf(32, (v) => { v.setUint8(0, (op << 5) | flags); v.setFloat32(4, value, true); v.setUint16(8, fn, true); v.setUint32(12, param, true); v.setUint32(20, 0, true); }) });
const mgef = (id, edid, arch, av, flags, resist = -1, conds = [], extra = {}) => add(id, 'MGEF', edid, [{ type: 'DATA', data: mgefData(arch, av, flags, resist, extra.cost || 1, extra.av2 === undefined ? -1 : extra.av2, extra.weight2 || 0) }, ...conds]);
const efid = (id) => ({ type: 'EFID', data: buf(4, (v) => v.setUint32(0, id, true)) });
const efit = (mag, area, dur) => ({ type: 'EFIT', data: buf(12, (v) => { v.setFloat32(0, mag, true); v.setUint32(4, area, true); v.setUint32(8, dur, true); }) });
const enit = (staff, fixedCost) => ({ type: 'ENIT', data: buf(36, (v) => { v.setInt32(0, fixedCost || 0, true); v.setUint32(4, fixedCost ? 1 : 0, true); v.setUint32(20, staff ? 0x0c : 0x06, true); }) });
const ench = (id, edid, effects, staff, conds = {}, fixedCost) => add(id, 'ENCH', edid, [enit(staff, fixedCost), ...effects.flatMap(([fx, mag, area, dur], i) => [efid(fx), efit(mag, area, dur), ...(conds[i] || [])])]);
const item = (id, type, edid, enchId, kw = []) => add(id, type, edid, [...(enchId ? [{ type: 'EITM', data: buf(4, (v) => v.setUint32(0, enchId, true)) }] : []), ...(kw.length ? [{ type: 'KWDA', data: buf(4 * kw.length, (v) => kw.forEach((k, i) => v.setUint32(i * 4, k, true))) }] : [])]);
const HOSTILE = 0x5;
// magic effects
const FIRE = 0x4605a, ABSORB = 0xaa155, PARA = 0xacbb6, CHILLPARA = 0x2b2f, SLOW = 0x51b16, STAM = 0x5b4e3, MAGDMG = 0x5b4e4, RFIRE = 0x48c8b, RMAGIC = 0x39e51, FHEALTH = 0x493aa, HEALMULT = 0x7a10f, MAGRATE = 0x7a10a;
const BLOCK = 0x7a104, HEAVY = 0x7a0f5, LIGHT = 0x7a0f6, PICK = 0x7a0fd, UNARMED = 0x3f5d6, WARD = 0x7dcdb, RAZOR = 0x91ae5, EBONY = 0x10faf1, DAWN = 0xfee38, DAWNFIRE = 0xfefbc, BURSTFIRE = 0xfee39, BACKSTAB = 0xff15c, FROST = 0x4605c;
mgef(FIRE, 'EnchFireDamageFFContact', 0, 24, HOSTILE, 41, [], { cost: 0.7 });
mgef(FROST, 'EnchFrostDamageFFContact', 5, 24, HOSTILE, 43, [], { av2: 26, weight2: 1 });
mgef(ABSORB, 'EnchAbsorbHealthFFContact', 4, 24, HOSTILE, 44);
mgef(PARA, 'EnchParalysisFFContact', 21, 53, HOSTILE, 44);
mgef(CHILLPARA, 'ChillrendParalysisFFContact', 21, 53, HOSTILE, 44, [ctda(5, 77, 25)]);
mgef(SLOW, 'FrostSlowFFContact', 34, 30, HOSTILE, 43);
mgef(STAM, 'EnchStaminaDamageFFContact', 0, 26, HOSTILE, 44);
mgef(MAGDMG, 'EnchMagickaDamageFFContact', 0, 25, HOSTILE, 44);
mgef(RFIRE, 'EnchResistFireConstantSelf', 34, 41, 0);
mgef(RMAGIC, 'EnchResistMagicConstantSelf', 34, 44, 0);
mgef(FHEALTH, 'EnchFortifyHealthConstantSelf', 34, 24, 0);
mgef(HEALMULT, 'EnchFortifyHealRateConstantSelf', 34, 155, 0);
mgef(MAGRATE, 'EnchFortifyMagickaRateConstantSelf', 34, 156, 0);
mgef(BLOCK, 'EnchFortifyBlockConstantSelf', 34, 99, 0);
mgef(HEAVY, 'EnchFortifyHeavyArmorConstantSelf', 34, 11, 0);
mgef(LIGHT, 'EnchFortifyLightArmorConstantSelf', 34, 12, 0);
mgef(PICK, 'EnchFortifyPickpocketConstantSelf', 34, 103, 0);
mgef(UNARMED, 'AbFortifyUnarmedDamage', 34, 35, 0);
mgef(WARD, 'DA13SpellbreakerwardEffect', 0, 63, 0);
mgef(RAZOR, 'DA07MehrunesRazorMagicEffect', 0, 20, 0);
mgef(EBONY, 'DA08EnchAbsorbHealthFFContact', 4, 24, HOSTILE, 44);
// Dawnbreaker's script effect at a sure chance here (the record says GetRandomPercent <= 25)
mgef(DAWN, 'DA09EncDawnbreakeScriptEffect', 1, -1, 0, -1, [ctda(5, 77, 100)]);
mgef(DAWNFIRE, 'DA09EnchDawnbreakerEnchFireDamageFFContact', 0, 24, HOSTILE, 41);
mgef(BURSTFIRE, 'DA09EncDawnbreakerFireDamageFFSelfAreaUndead', 0, 24, HOSTILE, 41, [ctda(0, 715, 1, 0, 1), ctda(0, 560, 1, 0x13796, 1)]);
mgef(BACKSTAB, 'DBEnchBackstab', 1, -1, 0);
// enchantments and items
const E = { fire: 0x49bb7, absorb: 0x5b450, para: 0x5b46b, chill: 0x2b2e, frost: 0x45d97, stam: 0x5b44a, mag: 0x5b44b, staffSlow: 0x29b5b, staffPara: 0x29b4a,
  rfire: 0x48f45, rmagic: 0x4950d, fh: 0x4b210, heal: 0x4b212, mrate: 0x4b213, block: 0x4b215, heavy: 0x4b216, light: 0x4b217, pick: 0x4b218, unarmed: 0x4b219,
  ward: 0xc51f7, razor: 0x91ae7, ebony: 0x10faf0, dawn: 0xfee34, burst: 0xfee36, backstab: 0xff15d, bigfire: 0x9001, rfire2: 0x9002 };
ench(E.fire, 'EnchWeaponFireDamage03', [[FIRE, 8, 0, 0]]);
ench(E.absorb, 'EnchWeaponAbsorbHealth03', [[ABSORB, 10, 0, 1]]);
ench(E.para, 'EnchWeaponParalysis03', [[PARA, 0, 0, 4]]);
ench(E.chill, 'EnchWeaponChillrend', [[CHILLPARA, 0, 0, 3]]);
ench(E.frost, 'EnchWeaponFrostDamage03', [[FROST, 10, 0, 0], [SLOW, 50, 0, 3]]);
ench(E.stam, 'EnchWeaponStaminaDamage03', [[STAM, 20, 0, 0]]);
ench(E.mag, 'EnchWeaponMagickaDamage03', [[MAGDMG, 30, 0, 0]]);
ench(E.staffSlow, 'StaffEnchFrostbite', [[FROST, 8, 0, 0], [SLOW, 50, 0, 3]], true);
ench(E.staffPara, 'StaffEnchParalyze', [[PARA, 0, 0, 10]], true);
ench(E.rfire, 'EnchArmorResistFire03', [[RFIRE, 40, 0, 0]]);
ench(E.rfire2, 'EnchArmorResistFire06', [[RFIRE, 70, 0, 0]]);
ench(E.rmagic, 'EnchArmorResistMagic03', [[RMAGIC, 15, 0, 0]]);
ench(E.fh, 'EnchArmorFortifyHealth06', [[FHEALTH, 35, 0, 0]]);
ench(E.heal, 'EnchArmorFortifyHealRate06', [[HEALMULT, 25, 0, 0]]);
ench(E.mrate, 'EnchRobesCollegeIllusion05', [[MAGRATE, 75, 0, 0]]);
ench(E.block, 'EnchArmorFortifyBlock06', [[BLOCK, 20, 0, 0]]);
ench(E.heavy, 'EnchArmorFortifyHeavyArmor06', [[HEAVY, 13, 0, 0]]);
ench(E.light, 'EnchArmorFortifyLightArmor06', [[LIGHT, 13, 0, 0]]);
ench(E.pick, 'EnchArmorFortifyPickpocket06', [[PICK, 20, 0, 0]]);
ench(E.unarmed, 'EnchArmorFortifyUnarmed01', [[UNARMED, 10, 0, 0]]);
ench(E.ward, 'DA13SpellBreakerEnch', [[WARD, 50, 0, 0]], false, { 0: [ctda(0, 569, 1)] });
ench(E.razor, 'DA07MehrunesRazorEnchantment', [[RAZOR, 0, 0, 0]]);
ench(E.ebony, 'DA08EbonyBladeTraditionalEnchantment', [[EBONY, 10, 0, 1], [EBONY, 14, 0, 1], [EBONY, 30, 0, 1]], false, { 0: [ctda(5, 629, 2, 0x10faec)], 1: [ctda(2, 629, 2, 0x10faec)], 2: [ctda(2, 629, 10, 0x10faec)] });
ench(E.dawn, 'DA09EncDawnbreaker', [[DAWN, 1, 0, 10], [DAWNFIRE, 5, 0, 0]]);
add(E.burst, 'SPEL', 'DA09DawnbreakerBaneOfUndeadSpell', [efid(BURSTFIRE), efit(25, 80, 0)]);
ench(E.backstab, 'DBEnchantGloves', [[BACKSTAB, 0, 0, 0]]);
ench(E.bigfire, 'EnchWeaponFireDamage06', [[FIRE, 30, 0, 0]], false, {}, 40);
const W = { fire: 0x1000, absorb: 0x1001, para: 0x1002, chill: 0x1003, frost: 0x1004, stam: 0x1005, mag: 0x1006, plain: 0x1007, razor: 0x240d2, ebony: 0x4a38f, dawn: 0x4e4ee, staff: 0x1008, staffPara: 0x1009, big: 0x100a };
item(W.fire, 'WEAP', 'IronSwordFire03', E.fire); item(W.absorb, 'WEAP', 'SteelSwordAbsorb', E.absorb); item(W.para, 'WEAP', 'SteelMaceParalyze', E.para);
item(W.chill, 'WEAP', 'Chillrend', E.chill); item(W.frost, 'WEAP', 'SteelAxeFrost', E.frost); item(W.stam, 'WEAP', 'SteelSwordStam', E.stam); item(W.mag, 'WEAP', 'SteelSwordMag', E.mag);
item(W.plain, 'WEAP', 'IronSword', 0); item(W.razor, 'WEAP', 'DA07MehrunesRazor', E.razor); item(W.ebony, 'WEAP', 'DA08EbonyBlade', E.ebony); item(W.dawn, 'WEAP', 'DA09Dawnbreaker', E.dawn);
item(W.staff, 'WEAP', 'StaffFrostbite', E.staffSlow); item(W.staffPara, 'WEAP', 'StaffParalyze', E.staffPara); item(W.big, 'WEAP', 'DaedricSwordFire06', E.bigfire);
const A = {};
for (const k of ['rfire', 'rfire2', 'rmagic', 'fh', 'heal', 'mrate', 'block', 'heavy', 'light', 'pick', 'unarmed', 'ward', 'backstab']) { A[k] = 0x2000 + Object.keys(A).length; item(A[k], 'ARMO', `Armor_${k}`, E[k]); }
A.plain = 0x2100; item(A.plain, 'ARMO', 'ArmorPlain', 0);
// actors: players 1-3, NPCs 100+ (a draugr is undead by its race keyword)
const NPC_DRAUGR = 0x3000, NPC_BANDIT = 0x3001, NPC_BOSS = 0x3002, NPC_ESSENTIAL = 0x3003, RACE_DRAUGR = 0x3010, RACE_NORD = 0x3011;
add(RACE_DRAUGR, 'RACE', 'DraugrRace', [{ type: 'KWDA', data: buf(4, (v) => v.setUint32(0, 0x13796, true)) }]);
add(RACE_NORD, 'RACE', 'NordRace', [{ type: 'KWDA', data: buf(4, (v) => v.setUint32(0, 0x13794, true)) }]);
const npc = (id, edid, race, acbsFlags = 0) => add(id, 'NPC_', edid, [{ type: 'RNAM', data: buf(4, (v) => v.setUint32(0, race, true)) }, { type: 'ACBS', data: buf(24, (v) => v.setUint32(0, acbsFlags, true)) }]);
npc(NPC_DRAUGR, 'EncDraugr01Melee', RACE_DRAUGR); npc(NPC_BANDIT, 'EncBandit01Melee', RACE_NORD); npc(NPC_BOSS, 'EncDraugr05TemplateBoss', RACE_DRAUGR); npc(NPC_ESSENTIAL, 'Lydia', RACE_NORD, 0x2);
add(0x7, 'NPC_', 'Player', [{ type: 'RNAM', data: buf(4, (v) => v.setUint32(0, RACE_NORD, true)) }]);

// ---- the fake server ---------------------------------------------------------------------------------------------------
let now = 1790000000000;
Date.now = () => now;
const S = new Map(); // actor -> props
const actor = (id, o) => S.set(id, Object.assign({ percentages: { health: 1, magicka: 1, stamina: 1 }, inventory: [], isDead: false, pos: [0, 0, 0], angle: [0, 0, 0], world: 'w', profile: -1, base: 0, blocking: false, hoster: 0 }, o));
const reset = () => {
  S.clear();
  actor(1, { profile: 11 }); actor(2, { profile: 12 }); actor(3, { profile: 13 });
  actor(100, { base: NPC_BANDIT }); actor(101, { base: NPC_DRAUGR, pos: [100, 0, 0] }); actor(102, { base: NPC_DRAUGR, pos: [300, 0, 0] }); actor(103, { base: NPC_BOSS }); actor(104, { base: NPC_ESSENTIAL });
  actor(105, { base: NPC_DRAUGR, pos: [9000, 0, 0] });
};
const sets = []; const packets = []; const logs = [];
const mp = {
  get: (id, k) => {
    const a = S.get(id >>> 0); if (!a) throw new Error('no actor');
    if (k === 'inventory') return { entries: a.inventory };
    if (k === 'percentages') return Object.assign({}, a.percentages);
    if (k === 'isDead') return a.isDead;
    if (k === 'pos') return a.pos; if (k === 'angle') return a.angle; if (k === 'worldOrCellDesc') return a.world;
    if (k === 'baseDesc') return a.base ? `${a.base.toString(16)}:Skyrim.esm` : '';
    if (k === 'appearance') return a.profile >= 0 ? { raceId: RACE_NORD } : null;
    if (k === 'templateChain') return [];
    if (k === 'ff_companionOf') return 0;
    if (k === 'private.npcSpawner') return '';
    throw new Error(k);
  },
  set: (id, k, v) => { const a = S.get(id >>> 0); sets.push([id, k, v]); if (k === 'percentages') a.percentages = Object.assign({}, v); else if (k === 'isDead') a.isDead = v; },
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16),
  getDescFromId: (id) => `${id.toString(16)}:x`,
  getHoster: (id) => (S.get(id >>> 0) || {}).hoster || 0,
  getServerSettings: () => ({ spellSync: { absorb: false } }),
  callPapyrusFunction: (kind, cls, fn, self) => { const id = parseInt(String(self.desc).split(':')[0], 16); return fn === 'GetAnimationVariableBool' ? !!(S.get(id) || {}).blocking : null; },
  getNeighborsByPosition: () => [...S.keys()],
};
const recordOf = (id) => records.get(id >>> 0) || null;
const profileOf = (id) => { const a = S.get(id >>> 0); return a ? a.profile : -1; };
const sourceResistsOf = (src) => {
  const r = recordOf(src); const out = new Set();
  if (!r) return out;
  if (r.record.type === 'MGEF') { out.add(new DataView(r.record.fields[0].data.buffer).getInt32(16, true)); return out; }
  if (!['SPEL', 'ENCH', 'SCRL'].includes(r.record.type)) return out;
  for (const f of r.record.fields) if (f.type === 'EFID') { const m = recordOf(new DataView(f.data.buffer).getUint32(0, true)); if (m) out.add(new DataView(m.record.fields[0].data.buffer).getInt32(16, true)); }
  return out;
};
const racial = { targetMult: (agg, tgt) => (S.get(tgt).dunmer ? 0.5 : 1), capTargetSide: (x) => Math.max(0.25, x) };
const load = (cfg) => {
  for (const k of ['__dboGearEnchCache', '__dboParalysedUntil', '__dboParalysisImmuneUntil', '__dboGearEnchWatch', '__dboGearEnchMax', '__dboDawnbreakerMarks', '__dboSpellbreakerWards']) delete globalThis[k];
  globalThis.__dboParalysedUntil = new Map();
  delete require.cache[require.resolve(path.join(ROOT, 'gearench.js'))];
  return require(path.join(ROOT, 'gearench.js'))({ mp, log: (...a) => logs.push(a.join(' ')), recordOf, profileOf, display: (a) => `#${a}`, personal: () => {}, sendPacket: (a, p) => packets.push([a, p]),
    sourceResistsOf, weaponHandsOf: (s) => (s === W.plain || s === W.fire ? 'one' : 'two'), racial, cfg, potionResistMult: () => 1, blessingTargetMult: () => 1, takenMult: () => 1 });
};
// The worn summary is kept a second per actor: a new piece moves the clock past it
const hold = (a, base, extra = {}) => { S.get(a).inventory.push(Object.assign({ baseId: base, count: 1, worn: true }, extra)); now += 1001; };
const flags = { targetMaxHealth: 200, targetMaxStamina: 100 };
const hp = (a) => S.get(a).percentages.health;

(async () => {
  // ---- 1+6: weapon hits ------------------------------------------------------------------------------------------------
  reset(); let g = load({});
  hold(1, W.fire);
  let r = g.weaponAttempt(1, 100, W.fire, 10, flags); await flush();
  check('fire sword 8 on an NPC (200 health): 4% off, in full', near(hp(100), 0.96), hp(100));
  check('...the plan names the enchantment', r && r.ench === 'EnchWeaponFireDamage03', r);
  r = g.weaponAttempt(1, 2, W.fire, 10, flags); await flush();
  check('PvP: the same sword on a player takes pvpMult 0.5 of it: 2%', near(hp(2), 0.98), hp(2));
  S.get(101).dunmer = true; g.weaponAttempt(1, 101, W.fire, 10, flags); await flush();
  check('a target resisting fire half (race) takes 2%', near(hp(101), 0.98), hp(101));
  S.get(101).dunmer = false;
  hold(2, A.rfire2); g = load({});
  S.get(2).percentages.health = 1; g.weaponAttempt(1, 2, W.fire, 10, flags); await flush();
  check('worn Resist Fire 70 counts at most gearResistCap 0.4 on a player: 8 x 0.5 x 0.6 = 2.4 pts', near(hp(2), 1 - 2.4 / 200), hp(2));
  check('...a blocked blow carries no enchantment', g.weaponAttempt(1, 100, W.fire, 10, Object.assign({ blocked: true }, flags)) === null);
  check('...a staff is never a weapon hit here', (hold(1, W.staff), g.weaponAttempt(1, 100, W.staff, 10, flags)) === null);
  check('...a plain sword does nothing', (hold(1, W.plain), g.weaponAttempt(1, 100, W.plain, 10, flags)) === null);
  // charge
  reset(); g = load({});
  hold(1, W.big, { chargePercent: 30 });
  r = g.weaponAttempt(1, 100, W.big, 10, flags);
  check('a player copy with less charge than one hit (ENIT cost 40) applies nothing', r && r.skipped === 'no charge', r);
  S.get(1).inventory[0].chargePercent = 400;
  r = g.weaponAttempt(1, 100, W.big, 10, flags); await flush();
  check('...with charge it lands (30 pts = 15%)', near(hp(100), 0.85), hp(100));
  // NPC wielders and the host case
  reset(); g = load({});
  hold(100, W.fire); S.get(100).hoster = 2;
  r = g.weaponAttempt(100, 2, W.fire, 10, flags); await flush();
  check('an NPC hitting the player who hosts it: skipped (that engine applied it)', r && r.skipped === 'victim hosts the attacker' && hp(2) === 1, [r, hp(2)]);
  g.weaponAttempt(100, 1, W.fire, 10, flags); await flush();
  check('...the same NPC on another player lands at pvpMult (2%)', near(hp(1), 0.98), hp(1));
  S.get(1).percentages.health = 1; g.weaponAttempt(103, 1, W.fire, 10, flags); await flush();
  check('...an NPC whose weapon has no inventory entry uses the record (2% at pvpMult)', near(hp(1), 0.98), hp(1));
  // absorb, stamina, magicka, dual frost
  reset(); g = load({});
  S.get(1).percentages.health = 0.5; hold(1, W.absorb);
  g.weaponAttempt(3, 1, W.plain, 1, flags); // the attacker's pool is seen on a hit it takes
  g.weaponAttempt(1, 100, W.absorb, 10, flags); await flush();
  check('absorb health 10 on an NPC: 5% off it, 10 pts to the attacker (200 pool)', near(hp(100), 0.95) && near(hp(1), 0.55), [hp(100), hp(1)]);
  hold(1, W.stam); g.weaponAttempt(1, 2, W.stam, 10, flags); await flush();
  check('stamina damage 20 on a player: 10 pts of 100 at pvpMult', near(S.get(2).percentages.stamina, 0.9), S.get(2).percentages);
  hold(1, W.mag); g.weaponAttempt(1, 2, W.mag, 10, flags); await flush();
  check('magicka damage 30 on a player: 15 pts of assumedMaxMagicka 150', near(S.get(2).percentages.magicka, 0.9), S.get(2).percentages);
  S.get(100).percentages = { health: 1, magicka: 1, stamina: 1 }; hold(1, W.frost); g.weaponAttempt(1, 100, W.frost, 10, flags); await flush();
  check('frost (dual) 10 on an NPC: 5% health and 10% stamina', near(hp(100), 0.95) && near(S.get(100).percentages.stamina, 0.9), S.get(100).percentages);
  // paralysis: PvP cap and immunity
  reset(); g = load({}); packets.length = 0;
  hold(1, W.para); g.weaponAttempt(1, 2, W.para, 10, flags); await flush();
  let pk = packets.find(([a, p]) => a === 2 && p.customPacketType === 'dboParalyse');
  check('paralysis 4 s on a player is held pvpParalysisMaxSeconds 2', pk && pk[1].seconds === 2, packets);
  now += 3000; packets.length = 0; g.weaponAttempt(1, 2, W.para, 10, flags); await flush();
  check('...and again 3 s later: immune (15 s), nothing sent', !packets.some(([a, p]) => a === 2 && p.customPacketType === 'dboParalyse'), packets);
  check('...the same window covers gamemode.js paralysis (scrolls, staves)', g.playerParalysis(2, 5) === 0);
  now += 15000; packets.length = 0; g.weaponAttempt(1, 2, W.para, 10, flags); await flush();
  check('...after the window it holds again', packets.some(([a, p]) => a === 2 && p.seconds === 2), packets);
  S.get(100).hoster = 1; packets.length = 0; g.weaponAttempt(1, 100, W.para, 10, flags); await flush();
  check('an NPC the attacker hosts is held its full 4 s on the server', (globalThis.__dboParalysedUntil.get(100) || 0) - now === 4000, globalThis.__dboParalysedUntil.get(100));
  g.weaponAttempt(1, 101, W.para, 10, flags); await flush();
  check('...an NPC someone else hosts is not held (its host never paralysed it)', !globalThis.__dboParalysedUntil.has(101));
  globalThis.__dboIsDowned = (a) => a === 3; g.weaponAttempt(1, 3, W.para, 10, flags); await flush();
  check('a downed player is never paralysed', !globalThis.__dboParalysedUntil.has(3));
  delete globalThis.__dboIsDowned;
  // conditions: Chillrend's 25% roll
  reset(); g = load({});
  const rnd = Math.random; Math.random = () => 0.9; hold(1, W.chill); g.weaponAttempt(1, 100, W.chill, 10, flags); S.get(100).hoster = 1; g.weaponAttempt(1, 100, W.chill, 10, flags); await flush();
  check('Chillrend: a roll above 25 never paralyses', !globalThis.__dboParalysedUntil.has(100));
  Math.random = () => 0.1; g.weaponAttempt(1, 100, W.chill, 10, flags); await flush();
  check('...a roll at 10 does', globalThis.__dboParalysedUntil.has(100));
  Math.random = rnd;
  // frost slow on a player
  reset(); g = load({}); packets.length = 0; hold(1, W.frost); g.weaponAttempt(1, 2, W.frost, 10, flags); await flush();
  pk = packets.find(([a, p]) => a === 2 && p.customPacketType === 'dboStatus');
  check('frost slow on a player: dboStatus -50% for 3 s', pk && pk[1].speedMult === -50 && pk[1].seconds === 3, packets);
  // player-made enchantments
  reset(); g = load({});
  hold(1, W.plain, { enchantmentEffects: [{ effectId: FIRE, magnitude: 12, area: 0, duration: 0, cost: 10 }], chargePercent: 500 });
  g.weaponAttempt(1, 100, W.plain, 10, flags); await flush();
  check('a player-made Fire Damage 12 (copy effects) lands: 6%', near(hp(100), 0.94), hp(100));
  hold(2, A.rfire2); hold(1, W.plain); S.get(1).inventory = [S.get(1).inventory[0]];
  g.weaponAttempt(1, 2, W.plain, 10, flags); await flush();
  check('...its fire is resisted by its own MGEF (gear 0.4): 12 x 0.5 x 0.6 = 3.6 pts', near(hp(2), 1 - 3.6 / 200), hp(2));
  // PvP watch: once a minute per attacker
  reset(); g = load({}); logs.length = 0; hold(1, W.fire);
  for (let i = 0; i < 5; i++) { g.weaponAttempt(1, 2, W.fire, 10, flags); await flush(); }
  check('the PvP watch logs one line for five hits in a minute', logs.filter((l) => /on a player/.test(l)).length === 1, logs);
  now += 61000; g.weaponAttempt(1, 2, W.fire, 10, flags); await flush();
  check('...and one more after the minute', logs.filter((l) => /on a player/.test(l)).length === 2, logs);
  g.weaponAttempt(1, 100, W.fire, 10, flags); await flush();
  check('...never for a hit on an NPC', logs.filter((l) => /on a player/.test(l)).length === 2, logs);
  check('never kills: health stops at minHealth', (() => { S.get(100).percentages.health = 0.012; return true; })());
  g.weaponAttempt(1, 100, W.fire, 10, flags); await flush();
  check('...a 1.2% target is left at 1%', near(hp(100), 0.01), hp(100));

  // ---- 2: worn resistances (module side) ---------------------------------------------------------------------------------
  reset(); g = load({});
  hold(2, A.rfire);
  check('Resist Fire 40 worn: a fire spell lands x0.6 (gear cap 0.4)', near(g.resistMult(2, E.fire), 0.6), g.resistMult(2, E.fire));
  hold(2, A.rfire);
  check('...two pieces (80) still x0.6: gearResistCap', near(g.resistMult(2, E.fire), 0.6));
  hold(2, A.rmagic);
  check('...Resist Magic 15 stacks on any magic source: 0.6 x 0.85', near(g.resistMult(2, E.fire), 0.6 * 0.85), g.resistMult(2, E.fire));
  check('...a weapon blow is resisted by nothing', g.resistMult(2, W.fire) === 1);
  S.get(2).inventory = [{ baseId: A.rfire, count: 1 }];
  check('...carried, not worn: nothing', (g = load({}), g.resistMult(2, E.fire) === 1));
  g = load({ gearEnchantments: { resist: { enabled: false } } }); hold(2, A.rfire);
  check('resist.enabled false: nothing', g.resistMult(2, E.fire) === 1);

  // ---- 3: Fortify Health -----------------------------------------------------------------------------------------------
  reset(); g = load({});
  hold(1, A.fh);
  check('Fortify Health 35 worn: 35 points', g.healthPoints(1) === 35);
  hold(1, A.fh); hold(1, A.fh); hold(1, A.fh);
  check('...four pieces (140) capped at gearHealthCap 100', g.healthPoints(1) === 100, g.healthPoints(1));

  // ---- 4: regeneration ---------------------------------------------------------------------------------------------------
  reset(); g = load({});
  hold(1, A.heal); hold(1, A.mrate);
  const reg = g.regenOf(1);
  check('Heal Rate 25 and Magicka Rate 75 worn: two Mult boosts for prayer.js', reg.length === 2 && reg.some((e) => e.av === 'HealRateMult' && e.mag === 25) && reg.some((e) => e.av === 'MagickaRateMult' && e.mag === 75), reg);
  check('...gearRegenCap 0.5 for prayer.js', g.regenCap() === 0.5);
  check('...an NPC gets none', (hold(100, A.heal), g.regenOf(100).length === 0));

  // ---- 5: staff riders on players ----------------------------------------------------------------------------------------
  reset(); g = load({}); packets.length = 0;
  check('a Frostbite staff slows a player', (g.staffSpellHit(100, 2, E.staffSlow) || []).includes('slow'), packets);
  check('...not an NPC (the fork owns NPC riders)', g.staffSpellHit(1, 100, E.staffSlow) === null);
  check('...a weapon enchantment is not a staff', g.staffSpellHit(100, 2, E.fire) === null);
  check('staff paralysis on a player through playerParalysis: 10 s held 2', g.playerParalysis(2, 10) === 2);
  // staff absorb while the C++ absorb is off
  reset(); g = load({}); ench(0x9100, 'StaffEnchBlooddrain', [[ABSORB, 20, 0, 1]], true); g = load({});
  g.weaponAttempt(3, 1, W.plain, 1, flags); S.get(1).percentages.health = 0.5;
  g.landed(1, 100, 0x9100, 20);
  check('a Blooddrain staff hit that dealt 20 gives its caster 20 (spellSync.absorb off)', near(hp(1), 0.6), hp(1));

  // ---- 7: block, heavy, light, pickpocket ----------------------------------------------------------------------------------
  reset(); g = load({});
  hold(1, A.block); hold(1, A.heavy); hold(1, A.light); hold(1, A.pick);
  check('Fortify Block 20: 0.2 of the chip held back', near(g.bonus(1, 'block'), 0.2));
  check('Fortify Heavy Armor 13: heavy pieces count 0.13 more', near(g.bonus(1, 'heavy'), 0.13));
  check('Fortify Light Armor 13: 0.13', near(g.bonus(1, 'light'), 0.13));
  check('Fortify Pickpocket 20: +0.1 chance (0.005 a point, cap 0.1)', near(g.bonus(1, 'pickpocket'), 0.1));
  hold(1, A.block); hold(1, A.block);
  check('...three Block pieces (60) capped at 0.25', near(g.bonus(1, 'block'), 0.25), g.bonus(1, 'block'));
  check('...NPCs get none', (hold(100, A.block), g.bonus(100, 'block') === 0));

  // ---- 8: Spellbreaker, the uniques ---------------------------------------------------------------------------------------
  reset(); g = load({});
  hold(2, A.ward); S.get(2).blocking = true; S.get(1).pos = [0, 100, 0];
  const sp = { spell: true };
  check('Spellbreaker while blocking, a 30-point spell from the front: all of it held', g.spellbreakerMult(1, 2, E.fire, 30, sp) === 0);
  check('...the next 30: 20 left in the ward, 10 through', near(g.spellbreakerMult(1, 2, E.fire, 30, sp), 1 / 3));
  check('...spent: all through', g.spellbreakerMult(1, 2, E.fire, 30, sp) === 1);
  S.get(2).blocking = false; g.spellbreakerMult(1, 2, E.fire, 30, sp); S.get(2).blocking = true;
  check('...lowered and raised again: a fresh 50', g.spellbreakerMult(1, 2, E.fire, 30, sp) === 0);
  S.get(1).pos = [0, -100, 0];
  check('...from behind: nothing held', g.spellbreakerMult(1, 2, E.fire, 30, sp) === 1);
  S.get(2).blocking = false; S.get(1).pos = [0, 100, 0];
  check('...not blocking: nothing held', g.spellbreakerMult(1, 2, E.fire, 30, sp) === 1);
  check('...a weapon blow is never warded', (S.get(2).blocking = true, g.spellbreakerMult(1, 2, W.fire, 30, {}) === 1));
  // Mehrunes' Razor
  reset(); g = load({});
  Math.random = () => 0.001; hold(1, W.razor);
  g.weaponAttempt(1, 100, W.razor, 10, flags); await flush();
  check("Mehrunes' Razor at a 2/101 roll kills a bandit", S.get(100).isDead === true);
  for (const t of [2, 103, 104]) { g.weaponAttempt(1, t, W.razor, 10, flags); await flush(); }
  check('...never a player, a boss or an essential NPC', !S.get(2).isDead && !S.get(103).isDead && !S.get(104).isDead, [S.get(2).isDead, S.get(103).isDead, S.get(104).isDead]);
  Math.random = () => 0.5; g.weaponAttempt(1, 101, W.razor, 10, flags); await flush();
  check('...at a roll of 50 it does not', !S.get(101).isDead);
  Math.random = rnd;
  // Ebony Blade: the kill-count tier is unreadable, the lowest (10) counts
  reset(); g = load({}); hold(1, W.ebony); S.get(1).percentages.health = 0.5; g.weaponAttempt(3, 1, W.plain, 1, flags);
  g.weaponAttempt(1, 100, W.ebony, 10, flags); await flush();
  check('the Ebony Blade absorbs its base 10 from an NPC (5% off, 10 pts back)', near(hp(100), 0.95) && near(hp(1), 0.55), [hp(100), hp(1)]);
  g.weaponAttempt(1, 2, W.ebony, 10, flags); await flush();
  check('...5 on a player (pvpMult)', near(hp(2), 0.975), hp(2));
  // Dawnbreaker: fire 5, the mark, the burst on undead when the marked undead dies
  reset(); g = load({}); hold(1, W.dawn);
  for (const t of [101, 102, 105, 2]) g.weaponAttempt(3, t, W.plain, 1, flags); // pools seen
  S.get(2).percentages.health = 1; for (const t of [101, 102, 105]) S.get(t).percentages.health = 1;
  globalThis.__dboSuperKind = (a) => (a === 2 ? 'vampire' : '');
  g.weaponAttempt(1, 101, W.dawn, 10, flags); await flush();
  check('Dawnbreaker fire 5 on a draugr: 2.5%', near(hp(101), 0.975), hp(101));
  S.get(101).isDead = true; S.get(2).pos = [50, 0, 0];
  const out = g.landed(1, 101, W.plain, 10);
  check('...the draugr dies marked: the burst burns the undead in 80 ft (a draugr and a vampire player), not the far one', /dawnbreaker burst 2/.test(out.join()), out);
  check('...burst fire 25 on the draugr (12.5%), half on the vampire player', near(hp(102), 0.875) && near(hp(2), 1 - 12.5 / 200) && hp(105) === 1, [hp(102), hp(2), hp(105)]);
  delete globalThis.__dboSuperKind;
  // the Shrouded Gloves
  reset(); g = load({}); hold(1, A.backstab);
  check('Shrouded Gloves: a one-handed sneak attack x2', g.backstabMult(1, W.plain, { sneak: true }) === 2);
  check('...not two-handed, not a plain blow', g.backstabMult(1, W.ebony, { sneak: true }) === 1 && g.backstabMult(1, W.plain, {}) === 1);

  // ---- the wiring ----------------------------------------------------------------------------------------------------------
  const gm = read('gamemode.js');
  check('gamemode.js loads gearench.js once per reload, cache-busted', /delete require\.cache\[GEARENCH_JS\]/.test(gm));
  check('the hit judge applies a weapon enchantment beside the weapon poison (both paths)', (gm.match(/gearWeaponHit\(agg, tgt, src, dmg, flags\);/g) || []).length === 2);
  check('onHitDamage hands the landed hit to gearench', /gearEnch\.landed\(agg, tgt, Number\(sourceId\) >>> 0, dealt\)/.test(gm));
  check('sourceResistsOf takes a magic effect as its own source', /ownData = r && String\(r\.record\.type\) === 'MGEF'/.test(gm));
  check('racial.js counts a magic effect as magic', /\['SPEL', 'ENCH', 'SCRL', 'MGEF'\]/.test(read('racial.js')));
  check('item 2: worn resistances join the target side, before racial.js caps it', /potionResistMult\(tgt, src\) \* gearResistMult\(tgt, src\);\n    if \(racial\) \{ try \{ targetSide = racial\.capTargetSide/.test(gm));
  // item 3: potionTakenMult, lifted out of gamemode.js with a worn Fortify Health 50 and no potion
  {
    const from = gm.indexOf('// Worn Fortify Health counts the same way'), to = gm.indexOf('const potionAttackMult =');
    const fn = new Function('gearEnch', 'profileOf', 'potionBonus', 'potionMaxSeen', `${gm.slice(from, to)}; return potionTakenMult;`)(
      { healthPoints: (a) => (a === 1 ? 50 : 0) }, (a) => (a === 1 || a === 2 ? 7 : -1), () => 0, new Map());
    check('item 3: a 150-health player with Fortify Health 50 worn takes a hit as on a 200 pool (x0.75)', near(fn(1, { targetMaxHealth: 150 }), 0.75), fn(1, { targetMaxHealth: 150 }));
    check('...without it, x1', fn(2, { targetMaxHealth: 150 }) === 1);
    check('...works with alchemy.js not loaded (no early return on __dboPotionBonus)', !/const potionTakenMult = \(targetId, flags\) => \{\n  if \(typeof globalThis\.__dboPotionBonus/.test(gm));
  }
  check('item 5: a staff ENCH paralyses through explosionParalysisOf, capped for players by playerParalysis', /else if \(spell && spell\.record\.type === 'ENCH'\) seconds = paralysisIn\(spell\);/.test(gm) && /gearEnch\.playerParalysis\(tgt, seconds, isEnch\)/.test(gm));
  check('...the spell hit hands a staff to staffSpellHit (slow, drains)', /gearEnch\.staffSpellHit\(agg, tgt, spell\)/.test(gm));
  check('item 7: worn Heavy and Light Armor scale their own pieces in Defense and the Flesh spells', (gm.match(/\* \(w\.cond \|\| 1\) \* \(p\.heavy \? gm\.heavy : gm\.light\)/g) || []).length === 2);
  check('...Fortify Block adds to the block potion in combat.js', /1 - Math\.min\(1, blockPotion \+ blockGear\)/.test(read('combat.js')));
  check('...Fortify Pickpocket adds to the thief\'s chance in pickpocket.js', /chanceFor\(tier, g, drawn, a\)/.test(read('pickpocket.js')) && /b\(thief, 'pickpocket'\)/.test(read('pickpocket.js')));
  check('...Fortify Unarmed shares gearFortify (AV 35)', /35: 'unarmed'/.test(gm));
  console.log(failed ? `${failed} failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL harness threw', e.stack); process.exit(1); });
