// Scripted test for soulTrapSystem.ts: a player's weapon arms soul trap only while the copy held has a hit's worth of
// charge left (#bugs "Soul trap on weapons works whether charged or not", 11 Oct). The engine stops casting a weapon's
// enchantment once its charge is below one hit's cost and leaves that remainder on the copy, which craftedExtras records as
// chargePercent (0.01 for a copy run down to zero). It bundles soulTrapSystem.ts with esbuild and drives the OnHit hook and
// the death poll on a fake mp whose records copy the vanilla ones (Skyrim.esm). Run it from skymp5-server with node_modules:
//
//   node tests/soul-trap-charge-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'soultrap-charge-'));
const bundle = path.join(out, 'soultrap.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const u32s = (...xs) => { const b = new Uint8Array(4 * xs.length); const v = new DataView(b.buffer); xs.forEach((x, i) => v.setUint32(4 * i, x >>> 0, true)); return b; };
const efit = (mag, area, dur) => { const b = new Uint8Array(12); const v = new DataView(b.buffer); v.setFloat32(0, mag, true); v.setUint32(4, area, true); v.setUint32(8, dur, true); return b; };
// ENIT: cost, flags (0x1 manual calc), cast type, charge amount, delivery, type, charge time, base enchantment, worn restrictions
const enit = (cost, flags) => { const b = new Uint8Array(36); const v = new DataView(b.buffer); v.setUint32(0, cost, true); v.setUint32(4, flags, true); v.setUint32(8, 1, true); v.setUint32(16, 1, true); v.setUint32(20, 6, true); return b; };
// MGEF DATA: base cost at 0x04, archetype at 0x40
const mgef = (baseCost, archetype) => { const b = new Uint8Array(152); const v = new DataView(b.buffer); v.setFloat32(4, baseCost, true); v.setUint32(0x40, archetype, true); return b; };
// WEAP DNAM: animation type in the first byte (8 = staff)
const dnam = (animType) => { const b = new Uint8Array(100); b[0] = animType; return b; };
const acbs = (level) => { const b = new Uint8Array(20); new DataView(b.buffer).setUint16(8, level, true); return b; };
const records = new Map();
const rec = (id, type, fields) => records.set(id >>> 0, { record: { type, fields, flags: 0 }, toGlobalRecordId: (x) => x >>> 0 });

// Skyrim.esm: EnchSoulTrapFFContact (base cost 25, Script archetype), EnchFireDamageFFContact (0.9), the Soul Trap spell
const SOUL_TRAP_CONTACT = 0x0005b452, FIRE_CONTACT = 0x0004605a, SOUL_TRAP_ACTOR = 0x0004dba3;
rec(SOUL_TRAP_CONTACT, 'MGEF', [{ type: 'DATA', data: mgef(25, 1) }]);
rec(FIRE_CONTACT, 'MGEF', [{ type: 'DATA', data: mgef(0.9, 0) }]);
rec(SOUL_TRAP_ACTOR, 'MGEF', [{ type: 'DATA', data: mgef(15, 1) }]);
// EnchWeaponSoulTrap01 (3 s), EnchWeaponSoulTrapBase (4 s), EnchFierySouls (5 s soul trap + 10 fire); a manual-calc one made up
const ENCH_TRAP_01 = 0x0005b45f, ENCH_TRAP_BASE = 0x0010fb9a, ENCH_FIERY_SOULS = 0x00040003, ENCH_MANUAL = 0x0a000801;
rec(ENCH_TRAP_01, 'ENCH', [{ type: 'ENIT', data: enit(6, 0x4) }, { type: 'EFID', data: u32s(SOUL_TRAP_CONTACT) }, { type: 'EFIT', data: efit(0, 0, 3) }]);
rec(ENCH_TRAP_BASE, 'ENCH', [{ type: 'ENIT', data: enit(9, 0x4) }, { type: 'EFID', data: u32s(SOUL_TRAP_CONTACT) }, { type: 'EFIT', data: efit(0, 0, 4) }]);
rec(ENCH_FIERY_SOULS, 'ENCH', [{ type: 'ENIT', data: enit(10, 0x4) },
  { type: 'EFID', data: u32s(SOUL_TRAP_CONTACT) }, { type: 'EFIT', data: efit(0, 0, 5) },
  { type: 'EFID', data: u32s(FIRE_CONTACT) }, { type: 'EFIT', data: efit(10, 0, 1) }]);
rec(ENCH_MANUAL, 'ENCH', [{ type: 'ENIT', data: enit(30, 0x1) }, { type: 'EFID', data: u32s(SOUL_TRAP_CONTACT) }, { type: 'EFIT', data: efit(0, 0, 3) }]);
// SoulTrapFFActor spell (60 s)
const SPELL_SOUL_TRAP = 0x0004dba4;
rec(SPELL_SOUL_TRAP, 'SPEL', [{ type: 'EFID', data: u32s(SOUL_TRAP_ACTOR) }, { type: 'EFIT', data: efit(0, 0, 60) }]);
// EnchSteelWarAxeSoulTrap1 (EAMT 200), a plain iron sword, a made-up Fiery Souls sword and soul trap staff, a manual-calc axe
const AXE_OF_SOULS = 0x000a69dc, IRON_SWORD = 0x00012eb7, FIERY_SWORD = 0x0a000802, STAFF_OF_SOULS = 0x0a000803, MANUAL_AXE = 0x0a000804;
rec(AXE_OF_SOULS, 'WEAP', [{ type: 'EITM', data: u32s(ENCH_TRAP_01) }, { type: 'EAMT', data: new Uint8Array([200, 0]) }, { type: 'DNAM', data: dnam(3) }]);
rec(IRON_SWORD, 'WEAP', [{ type: 'DNAM', data: dnam(1) }]);
rec(FIERY_SWORD, 'WEAP', [{ type: 'EITM', data: u32s(ENCH_FIERY_SOULS) }, { type: 'DNAM', data: dnam(1) }]);
rec(STAFF_OF_SOULS, 'WEAP', [{ type: 'EITM', data: u32s(ENCH_TRAP_01) }, { type: 'DNAM', data: dnam(8) }]);
rec(MANUAL_AXE, 'WEAP', [{ type: 'EITM', data: u32s(ENCH_MANUAL) }, { type: 'DNAM', data: dnam(3) }]);
const PETTY = 0x0002e4e2, PETTY_FILLED = 0x0002e4e3, WOLF_BASE = 0x00023aba;
rec(PETTY, 'SLGM', [{ type: 'SLCP', data: new Uint8Array([1]) },
  // NAM0 is the engine's link to the filled form; USSEP adds it to the four gems Skyrim.esm omits
  { type: 'NAM0', data: u32s(PETTY_FILLED) }]);
rec(PETTY_FILLED, 'SLGM', [{ type: 'SLCP', data: new Uint8Array([1]) }, { type: 'SOUL', data: new Uint8Array([1]) }]);
rec(WOLF_BASE, 'NPC_', [{ type: 'ACBS', data: acbs(1) }]);

(async () => {
  await esbuild.build({
    entryPoints: [path.join(root, 'ts', 'systems', 'soulTrapSystem.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
  });
  const { SoulTrapSystem } = require(bundle);

  const A = 0xff000014, T = 0xff000100;
  const props = new Map();
  const descs = new Map();
  const desc = (id) => { const d = `d${(id >>> 0).toString(16)}`; descs.set(d, id >>> 0); return { desc: d }; };
  const mp = {
    get: (id, k) => props.get(`${id >>> 0}|${k}`),
    set: (id, k, v) => props.set(`${id >>> 0}|${k}`, v),
    getIdFromDesc: (d) => { if (!descs.has(d)) throw new Error('no desc'); return descs.get(d); },
    lookupEspmRecordById: (id) => records.get(id >>> 0) || null,
    getUserByActor: () => 65535,
    sendCustomPacket: () => {},
  };
  const ctx = { svr: mp, gm: { on() {}, emit() {} } };
  let now = 1_000_000;
  const realNow = Date.now;
  Date.now = () => now;

  // One fight: the attacker (a player unless `npc`) holds `entries`, hits a level 1 wolf with `source`, and it dies 1 s later
  const fight = async (source, entries, npc = false) => {
    const sys = new SoulTrapSystem(() => {});
    await sys.initAsync(ctx);
    props.clear();
    props.set(`${A}|inventory`, { entries: [...entries, { baseId: PETTY, count: 1 }] });
    if (!npc) props.set(`${A}|profileId`, 3);
    props.set(`${T}|type`, 'MpActor');
    props.set(`${T}|isDead`, false);
    props.set(`${T}|templateChain`, [WOLF_BASE]);
    mp['onPapyrusEvent:OnHit'](T, desc(A), desc(source), null, false, false, false, false);
    now += 1000;
    props.set(`${T}|isDead`, true);
    await sys.updateAsync(ctx);
    return props.get(`${A}|inventory`).entries.some((e) => e.baseId === PETTY_FILLED);
  };
  // The live copy (11-12 Oct): a 4 s player-made soul trap, 500 charge, left at 2.18. One hit costs 25 x 0.4^1.1 = 9.12
  const trap4 = [{ effectId: SOUL_TRAP_CONTACT, magnitude: 0, area: 0, duration: 4, cost: 9.12 }];
  const made = (chargePercent, extra = {}) => ({ baseId: IRON_SWORD, count: 1, worn: true, maxCharge: 500, enchantmentEffects: trap4, ...(chargePercent === undefined ? {} : { chargePercent }), ...extra });

  // Charged copies still trap
  check('player-made soul trap at full charge traps', await fight(IRON_SWORD, [made(500)]));
  check('player-made soul trap with charge never reported (full) traps', await fight(IRON_SWORD, [made(undefined)]));
  check('player-made soul trap with one hit left (9.5 of 500, a hit costs 9.12) traps', await fight(IRON_SWORD, [made(9.5)]));
  check('found Steel War Axe of Souls never drained traps', await fight(AXE_OF_SOULS, [{ baseId: AXE_OF_SOULS, count: 1, worn: true }]));
  check('found axe at 100 of 200 traps', await fight(AXE_OF_SOULS, [{ baseId: AXE_OF_SOULS, count: 1, worn: true, chargePercent: 100 }]));

  // Spent copies do not (these fail on the base)
  check('player-made soul trap run down to zero (0.01 on the server) does not trap', !(await fight(IRON_SWORD, [made(0.01)])));
  check('player-made soul trap left below one hit (2.18 of 500, the live case) does not trap', !(await fight(IRON_SWORD, [made(2.18)])));
  check('found axe below one hit (5 of 200, a hit costs 6.65) does not trap',
    !(await fight(AXE_OF_SOULS, [{ baseId: AXE_OF_SOULS, count: 1, worn: true, chargePercent: 5 }])));
  check('an extra-data soul trap enchantment run down to zero does not trap',
    !(await fight(IRON_SWORD, [{ baseId: IRON_SWORD, count: 1, worn: true, enchantmentId: ENCH_TRAP_BASE, maxCharge: 500, chargePercent: 0.01 }])));
  check('the held copy decides: a spent held copy beside a charged one in the pack does not trap',
    !(await fight(IRON_SWORD, [made(0.01), made(500, { worn: false })])));
  check('a mixed enchantment costs all its effects: Fiery Souls at 12 (a hit costs 11.66 soul trap + 0.90 fire) does not trap',
    !(await fight(FIERY_SWORD, [{ baseId: FIERY_SWORD, count: 1, worn: true, chargePercent: 12 }])));
  check('a manual-calc enchantment costs its own ENIT cost: 20 of a 30 a hit does not trap',
    !(await fight(MANUAL_AXE, [{ baseId: MANUAL_AXE, count: 1, worn: true, chargePercent: 20 }])));

  // Unchanged paths
  check('Fiery Souls at 13 traps', await fight(FIERY_SWORD, [{ baseId: FIERY_SWORD, count: 1, worn: true, chargePercent: 13 }]));
  check('manual-calc axe at 40 traps', await fight(MANUAL_AXE, [{ baseId: MANUAL_AXE, count: 1, worn: true, chargePercent: 40 }]));
  check('either hand: a charged left-hand copy beside a spent right-hand one traps',
    await fight(IRON_SWORD, [made(0.01), made(500, { worn: false, wornLeft: true })]));
  check('an NPC\'s weapon never runs dry (vanilla): an NPC hit with a spent copy traps', await fight(IRON_SWORD, [made(0.01)], true));
  check('a staff only hits when it casts: a staff hit traps whatever the charge',
    await fight(STAFF_OF_SOULS, [{ baseId: STAFF_OF_SOULS, count: 1, worn: true, chargePercent: 0.01 }]));
  check('the Soul Trap spell traps (no weapon charge involved)', await fight(SPELL_SOUL_TRAP, [made(0.01)]));
  check('a plain held weapon still does not trap', !(await fight(IRON_SWORD, [{ baseId: IRON_SWORD, count: 1, worn: true }])));

  Date.now = realNow;
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); fs.rmSync(out, { recursive: true, force: true }); process.exit(1); });
