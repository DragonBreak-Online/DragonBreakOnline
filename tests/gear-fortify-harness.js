// Scripted test for worn Fortify One-handed, Two-handed and Archery in gamemode.js (gearAttackMult). No server and no
// game: run it from this folder's parent with `node tests/gear-fortify-harness.js`. Records are laid out as Skyrim.esm has
// them (read from /opt/skyrim-data on 2026-10-18): Gray Fox Cowl's Ancient Redguard Hood carries EITM
// EnchArmorFortifyMarksman06 (be00e), one effect EnchFortifyArcheryConstantSelf (7a0fe, archetype 34, AV 98) at 40.
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'gamemode.js'), 'utf8');
const START = '// Worn Fortify One-handed, Two-handed and Archery', END = '// Fortify potions (alchemy rework';
const from = src.indexOf(START), to = src.indexOf(END);
if (from < 0 || to < 0) { console.error('gear fortify block markers not found in gamemode.js'); process.exit(1); }
const block = src.slice(from, to);
let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : ` (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };
const u32 = (...v) => { const b = new DataView(new ArrayBuffer(v.length * 4)); v.forEach((x, i) => b.setUint32(i * 4, x, true)); return new Uint8Array(b.buffer); };
const f32 = (x) => { const b = new DataView(new ArrayBuffer(12)); b.setFloat32(0, x, true); return new Uint8Array(b.buffer); };
const mgefData = (arch, av) => { const b = new DataView(new ArrayBuffer(0x98)); b.setUint32(0x40, arch, true); b.setUint32(0x44, av, true); return new Uint8Array(b.buffer); };
const HOOD = 0x0e00ae01, ARCHERY_ENCH = 0xbe00e, ARCHERY_FX = 0x7a0fe, ONE_ENCH = 0x111, ONE_FX = 0x222, HEALTH_ENCH = 0x333, HEALTH_FX = 0x444;
const RING = 0x555, AMULET = 0x666, PLAIN = 0x777, BOW = 0x139a5, SWORD = 0x12eb7, GREATSWORD = 0x1359d, SPELL = 0x12fcd;
const ench = (fx, mag) => ({ type: 'ENCH', fields: [{ type: 'EFID', data: u32(fx) }, { type: 'EFIT', data: f32(mag) }] });
const armo = (e) => ({ type: 'ARMO', fields: e ? [{ type: 'EITM', data: u32(e) }] : [] });
const records = {
  [HOOD]: armo(ARCHERY_ENCH), [RING]: armo(ONE_ENCH), [AMULET]: armo(HEALTH_ENCH), [PLAIN]: armo(0),
  [ARCHERY_ENCH]: ench(ARCHERY_FX, 40), [ONE_ENCH]: ench(ONE_FX, 20), [HEALTH_ENCH]: ench(HEALTH_FX, 50),
  [ARCHERY_FX]: { type: 'MGEF', fields: [{ type: 'DATA', data: mgefData(34, 98) }] },
  [ONE_FX]: { type: 'MGEF', fields: [{ type: 'DATA', data: mgefData(34, 96) }] },
  [HEALTH_FX]: { type: 'MGEF', fields: [{ type: 'DATA', data: mgefData(34, 24) }] },
  [SPELL]: { type: 'SPEL', fields: [] },
};
const recordOf = (id) => (records[id >>> 0] ? { record: records[id >>> 0], toGlobalRecordId: (x) => x } : null);
const fieldsOf = (lr, type) => ((lr && lr.record && lr.record.fields) || []).filter((f) => f.type === type && f.data instanceof Uint8Array);
const u32At = (f, off) => (f && f.data.byteLength >= off + 4 ? new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(off, true) : 0);
const globalAt = (lr, local) => { try { return local ? lr.toGlobalRecordId(local) >>> 0 : 0; } catch (e) { return 0; } };
const SKILL = { [BOW]: 'archery', [SWORD]: 'blade', [GREATSWORD]: 'blade' }, HANDS = { [BOW]: 'bow', [SWORD]: 'one', [GREATSWORD]: 'two' };
const inv = new Map(), profiles = new Map([[1, 7], [2, -1]]);
const mp = { get: (id, prop) => { if (prop === 'inventory') return { entries: inv.get(id) || [] }; throw new Error(prop); } };
const load = (cfg) => {
  delete globalThis.__dboGearFortEffects;
  new Function('mp', 'cfg', 'recordOf', 'fieldsOf', 'u32At', 'globalAt', 'profileOf', 'isSpellSource', 'weaponSkillOf', 'weaponHandsOf', `${block}; globalThis.__t = gearAttackMult;`)(
    mp, cfg, recordOf, fieldsOf, u32At, globalAt, (a) => (profiles.has(a) ? profiles.get(a) : -1), (s) => s === SPELL, (s) => SKILL[s] || '', (s) => HANDS[s] || '');
  return globalThis.__t;
};
const near = (a, b) => Math.abs(a - b) < 1e-6;
let mult = load({});
inv.set(1, [{ baseId: HOOD, count: 1, worn: true }]);
check('the Ancient Redguard Hood (Fortify Archery 40) adds 20% to a bow, half of vanilla', near(mult(1, BOW), 1.2), mult(1, BOW));
check('...and nothing to a sword or a spell', mult(1, SWORD) === 1 && mult(1, SPELL) === 1);
inv.set(1, [{ baseId: HOOD, count: 1 }]);
check('carried, not worn: nothing', mult(1, BOW) === 1);
inv.set(1, [{ baseId: HOOD, count: 1, worn: true }, { baseId: PLAIN, count: 1, worn: true, enchantmentEffects: [{ effectId: ARCHERY_FX, magnitude: 30, area: 0, duration: 0, cost: 1 }] }]);
check('a player-made Fortify Archery 30 stacks, capped at 25%', near(mult(1, BOW), 1.25), mult(1, BOW));
inv.set(1, [{ baseId: RING, count: 1, worn: true }, { baseId: AMULET, count: 1, worn: true }]);
check('Fortify One-handed 20 on a ring: 10% to a one-handed sword', near(mult(1, SWORD), 1.1), mult(1, SWORD));
check('...not to a greatsword or a bow; Fortify Health counts for nothing here', mult(1, GREATSWORD) === 1 && mult(1, BOW) === 1);
inv.set(1, [{ baseId: PLAIN, count: 1, worn: true, enchantmentId: ONE_ENCH }]);
check('an extra enchantment on the entry counts (enchantmentId)', near(mult(1, SWORD), 1.1), mult(1, SWORD));
inv.set(2, [{ baseId: HOOD, count: 1, worn: true }]);
check('an NPC gets nothing from its gear', mult(2, BOW) === 1);
inv.set(1, [{ baseId: HOOD, count: 1, worn: true }]);
mult = load({ gearFortify: { enabled: false } });
check('enabled false: nothing', mult(1, BOW) === 1);
mult = load({ gearFortify: { perPoint: 0.01, cap: 1 } });
check('config: vanilla strength when asked', near(mult(1, BOW), 1.4), mult(1, BOW));
check('the hit judge multiplies it in, never for a beast', /if \(!beastAgg\) mult \*= gearAttackMult\(agg, src\);/.test(src));
console.log(failed ? `${failed} failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
