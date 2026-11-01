// Non-mages viable in PvP without nerfing magic (Nat, 31 Oct: "do what you recommend"; _work/pvp-balance-1031.md):
//   P1  worn heavy and medium armour takes a share off a player's spell, staff or scroll blow (pvp.spellArmour)
//   P2  a raised shield toward a player's fire, frost or shock spell halves it (pvp.shieldElements)
//   P3  a Blade or Blunt weapon's PvP blow x pvp.weaponMult, P4 an arrow's x pvp.arrowMult; spells unchanged
//   and one measurement line per PvP hit (pvp.logHits). The sections are lifted from gamemode.js and run against stubs;
//   each mutant must fail at least one scenario.
//   node tests/pvp-warriors-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const GM = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
const GE = fs.readFileSync(path.join(ROOT, 'gearench.js'), 'utf8').replace(/\r\n/g, '\n');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!c) fails++; };
const cut = (from, to) => { const i = GM.indexOf(from), j = GM.indexOf(to, i); return i >= 0 && j > i ? GM.slice(i, j) : ''; };

// The numbers are Nat's to tune (arrowMult went back to 1 on 31 Oct): the checks read them, they never pin them
const W = Number(CFG.pvp.weaponMult) || 1, AR = Number(CFG.pvp.arrowMult) || 1, SH = Number(CFG.pvp.spellArmour.share), FULL = Number(CFG.pvp.spellArmour.fullAt), SE = Number(CFG.pvp.shieldElements.mult);
ok(W >= 1 && AR >= 1 && SH > 0 && SH < 1 && FULL > 0 && SE > 0 && SE <= 1, 'live config sane: weaponMult and arrowMult at least 1, spellArmour share under 1, shield mult in (0, 1]', CFG.pvp);

// ---- P3, P4 ----
const SRC_SECTION = cut('const pvpSourceMult = (src, beast) => {', '\n};\n') + '\n};\nreturn pvpSourceMult;';
const SPELL_SECTION = cut('// The plate turns the flame', "// Alteration's Flesh spells") + '\nreturn { pvpShieldElementMult, pvpSpellArmourMult, isMagicSource };';
ok(SRC_SECTION.length > 60 && SPELL_SECTION.length > 200, 'gamemode.js has the PvP source and spell sections');
ok(/\* huntDamageMult\(agg, tgt\) \* pvp \* \(agg !== tgt && profileOf\(agg\) >= 0 && profileOf\(tgt\) >= 0 \? pvpSourceMult\(src, beastAgg\) \* pvpArcheryMult\(agg, src, beastAgg\) : 1\);/.test(GM), 'the hit multiplies the source factor and the archery tier fix, between players only');
ok(/\* gearResistMult\(tgt, src\) \* pvpSpellArmourMult\(agg, tgt, src\) \* pvpShieldElementMult\(agg, tgt, src, flags\);/.test(GM), 'the target side takes P1 and P2 (so racial.js reductionCap caps them with the rest)');
ok(/const guardFacing = \(tgt, agg\) => blocking\(tgt\) && facing\(tgt, agg\);/.test(GE) && /spellbreakerMult, backstabMult, guardFacing,/.test(GE), 'gearench.js gives the guard as Spellbreaker reads it');
ok(/log\(`pvp hit \$\{display\(agg\)\} -> \$\{display\(tgt\)\} kind=.* rank=\$\{skill\}:\$\{rank\} .*armour=.*shield=.*resist=.*\$\{sta\}`\)/.test(GM), 'one measurement line per PvP hit: kind, rank, armour, shield, resist, stamina on a power attack');

const SKILL = { 0x10: 'blade', 0x11: 'blunt', 0x12: 'archery', 0x1f4: 'unarmed', 0x13: '' };
// The source factor's logic, on test multipliers of its own: the live ones may sit at 1, where a mutant cannot show
const TEST_PVP = { weaponMult: 1.25, arrowMult: 1.35 };
const runSource = (src) => new Function('PVP', 'weaponSkillOf', src)(TEST_PVP, (id) => SKILL[id] || '');
// Spell-side stubs: pieces [rating, heavy, slot mask, medium]
const PIECES = { HEAVY_BODY: [150, true, 0x4], HEAVY_HEAD: [75, true, 0x1002], HEAVY_HANDS: [37.5, true, 0x8], HEAVY_FEET: [37.5, true, 0x80],
  LIGHT_BODY: [40, false, 0x4], MEDIUM_LIGHT_BODY: [40, false, 0x4, true], SHIELD: [30, true, 0x200] };
const ID = {}; let n = 0x3000; for (const k of Object.keys(PIECES)) ID[k] = ++n;
const byId = (id) => PIECES[Object.keys(ID).find((k) => ID[k] === id)];
const SPELLS = { 0x51: ['SPEL', [41]], 0x52: ['SPEL', [39]], 0x53: ['ENCH', [42]], 0x54: ['WEAP', []] };
const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
const runSpell = (src, world) => {
  const recordOf = (id) => { if (SPELLS[id]) return { record: { type: SPELLS[id][0], fields: [] } }; const p = byId(id); return p ? { record: { type: 'ARMO', fields: [{ type: 'BOD2', data: u32(p[2]) }] } } : null; };
  globalThis.__dboArmourClassOf = (id) => ((byId(id) || [])[3] ? 'medium' : 'light');
  delete globalThis.__dboSpellSource;
  return new Function('cfg', 'PVP', 'mp', 'recordOf', 'fieldsOf', 'u32At', 'profileOf', 'sourceResistsOf', 'ELEMENT_RESIST', 'gearEnch', 'defensePieceMult', 'gearArmorMult',
    'wornWithHealth', 'armorPieceOf', 'armorCountOf', 'potionBonus', src)(
    { pvp: CFG.pvp }, CFG.pvp, { get: (a, k) => (k === 'equipment' ? { inv: { entries: (world.worn[a] || []).map((id) => ({ baseId: id, worn: true, wornLeft: byId(id)[2] === 0x200 })) } } : null) },
    recordOf, (r, t) => (r.record.fields || []).filter((f) => f.type === t), (f, o) => new DataView(f.data.buffer).getUint32(o, true),
    (a) => (a >= 100 ? 1 : -1), (id) => new Set((SPELLS[id] || [, []])[1]), { fire: 41, shock: 42, frost: 43 },
    { guardFacing: (tgt) => !!world.guard[tgt] }, () => ({ heavy: 1, light: 1 }), () => ({ heavy: 1, light: 1 }),
    (a) => (world.worn[a] || []).filter((id) => byId(id)[2] !== 0x200).map((id) => ({ baseId: id, health: 1, cond: 1 })),
    (id) => { const p = byId(id); return p ? { rating: p[0], counted: p[0], heavy: p[1], clothing: false } : null; },
    (p) => p.counted, () => 0);
};
const A = 100, B = 101, NPC = 5;
const scenarios = (srcSec, spellSec, live) => {
  let bad = 0;
  const t = (c, what, got) => { if (!c) bad++; if (live) ok(c, what, got); };
  const src = runSource(srcSec);
  t(src(0x10) === 1.25 && src(0x11) === 1.25, 'P3: a Blade or Blunt blow between players takes weaponMult (test 1.25)', [src(0x10), src(0x11)]);
  t(src(0x12) === 1.35, 'P4: an arrow takes arrowMult (test 1.35)', src(0x12));
  t(src(0x51) === 1 && src(0x1f4) === 1 && src(0x13) === 1, '...a spell, a fist or a staff unchanged');
  t(src(0x10, true) === 1, '...and a beast\'s claws unchanged');
  const world = { worn: { [B]: [ID.HEAVY_BODY, ID.HEAVY_HEAD, ID.HEAVY_HANDS, ID.HEAVY_FEET] }, guard: {} };
  const s = runSpell(spellSec, world);
  t(Math.abs(s.pvpSpellArmourMult(A, B, 0x51) - (1 - SH * Math.min(1, 300 / FULL))) < 1e-9 && s.pvpSpellArmourMult(A, B, 0x51) < 1, 'P1: full heavy plate (counted 300) takes the share off a fire bolt', s.pvpSpellArmourMult(A, B, 0x51));
  world.worn[B] = [ID.HEAVY_BODY];
  t(Math.abs(s.pvpSpellArmourMult(A, B, 0x51) - (1 - SH * Math.min(1, 150 / FULL))) < 1e-9, '...a heavy body alone (150) less', s.pvpSpellArmourMult(A, B, 0x51));
  t(Math.abs(s.pvpSpellArmourMult(A, B, 0x53) - (1 - SH * Math.min(1, 150 / FULL))) < 1e-9, '...a staff\'s enchantment too');
  t(s.pvpSpellArmourMult(A, B, 0x54) === 1, '...never a weapon\'s blow (armour already counts there)');
  t(s.pvpSpellArmourMult(NPC, B, 0x51) === 1, '...and never an NPC\'s spell (PvP only)');
  world.worn[B] = [ID.LIGHT_BODY];
  t(s.pvpSpellArmourMult(A, B, 0x51) === 1, '...light armour turns nothing');
  world.worn[B] = [ID.MEDIUM_LIGHT_BODY];
  t(s.pvpSpellArmourMult(A, B, 0x51) < 1, '...a light piece armorWear names medium does');
  world.worn[B] = [ID.HEAVY_BODY, ID.SHIELD]; world.guard[B] = true;
  t(s.pvpShieldElementMult(A, B, 0x51, { spell: true }) === SE && s.pvpShieldElementMult(A, B, 0x53, { spell: true }) === SE, 'P2: a raised shield toward a fire spell or a shock staff takes its mult');
  t(s.pvpShieldElementMult(A, B, 0x52, { spell: true }) === 1, '...not a non-elemental spell');
  t(s.pvpShieldElementMult(A, B, 0x54, { spell: false }) === 1, '...not a weapon');
  world.guard[B] = false;
  t(s.pvpShieldElementMult(A, B, 0x51, { spell: true }) === 1, '...not with the guard down');
  world.guard[B] = true; world.worn[B] = [ID.HEAVY_BODY];
  t(s.pvpShieldElementMult(A, B, 0x51, { spell: true }) === 1, '...not blocking with a weapon (no shield)');
  t(s.pvpShieldElementMult(NPC, B, 0x51, { spell: true }) === 1, '...and not against an NPC');
  return bad;
};
scenarios(SRC_SECTION, SPELL_SECTION, true);

const MUTANTS = [
  ['weapon mult on everything', "if (skill === 'blade' || skill === 'blunt') return", 'if (true) return'],
  ['no arrow mult', "return skill === 'archery' ? Number(PVP.arrowMult) || 1 : 1;", 'return 1;'],
  ['claws buffed', '  if (beast) return 1;\n', ''],
  ['P1 without its share', 'return 1 - share * Math.min(1, rating', 'return 1 - Math.min(1, rating'],
  ['P1 not PvP only', '|| agg === tgt || profileOf(agg) < 0 || profileOf(tgt) < 0 || !isMagicSource(src)) return 1;', '|| !isMagicSource(src)) return 1;'],
  ['P1 counts light', "if (p.heavy || klass === 'medium') counted", 'if (true) counted'],
  ['P1 on weapons too', "const yes = t === 'SPEL' || t === 'ENCH' || t === 'SCRL';", 'const yes = true;'],
  ['P2 without a shield', '|| !shieldWorn(tgt)) return 1;', ') return 1;'],
  ['P2 any element', '!Object.values(ELEMENT_RESIST).some((v) => res.has(v)) ||', ''],
  ['P2 guard ignored', '|| !gearEnch.guardFacing(tgt, agg)) return 1;', ') return 1;'],
];
for (const [name, from, to] of MUTANTS) {
  const inSrc = SRC_SECTION.includes(from), inSpell = SPELL_SECTION.includes(from);
  if (!inSrc && !inSpell) { ok(false, `mutant "${name}": its line is in the sections`); continue; }
  let bad = 0; try { bad = scenarios(inSrc ? SRC_SECTION.replace(from, to) : SRC_SECTION, inSpell ? SPELL_SECTION.replace(from, to) : SPELL_SECTION, false); } catch (e) { bad = 1; }
  ok(bad > 0, `mutant "${name}" is caught (${bad} failing)`);
}
// ---- the archery tier on the bow only (Nat, 31 Oct: archery felt too strong) ----
const ARCH_SECTION = cut('const pvpArcheryMult = (agg, src, beast) => {', '\n};\n') + '\n};\nreturn pvpArcheryMult;';
ok(ARCH_SECTION.length > 60, 'gamemode.js has the archery tier fix');
ok(CFG.pvp.archeryTierOnBowOnly === true, 'live config: archeryTierOnBowOnly on');
const archScenarios = (src, live) => {
  let bad = 0;
  const t = (c, what, got) => { if (!c) bad++; if (live) ok(c, what, got); };
  // A Daedric bow (19) with Daedric arrows (24) at Master archery (x2): (19 + 24) x 2 = 86 before, 19 x 2 + 24 = 62 after
  const run = (pvp, m, a, skill) => new Function('PVP', 'weaponSkillOf', 'masteryDamageMult', 'arrowDamageMult', src)(pvp, () => skill, () => m, () => a);
  const A = 1 + 24 / 19;
  const f = run({ archeryTierOnBowOnly: true }, 2, A, 'archery')(1, 0x12, false);
  t(Math.abs(86 * f - 62) < 1e-9, 'Master archer, Daedric bow and arrows: 86 becomes 62 (the tier on the bow\'s 19 only)', 86 * f);
  t(run({}, 1, A, 'archery')(1, 0x12, false) === 1, '...no tier, no change');
  t(run({}, 2, 1, 'archery')(1, 0x12, false) === 1, '...no arrow counted, no change');
  t(run({}, 2, A, 'blade')(1, 0x10, false) === 1, '...never a sword');
  t(run({}, 2, A, 'archery')(1, 0x12, true) === 1, '...never a beast');
  t(run({ archeryTierOnBowOnly: false }, 2, A, 'archery')(1, 0x12, false) === 1, '...and off with the config');
  return bad;
};
archScenarios(ARCH_SECTION, true);
for (const [name, from, to] of [
  ['tier on the arrow too', 'return m > 1 && a > 1 ? (m + a - 1) / (m * a) : 1;', 'return 1;'],
  ['config ignored', "PVP.archeryTierOnBowOnly === false || ", ''],
  ['every skill', "|| weaponSkillOf(src) !== 'archery'", ''],
]) {
  if (!ARCH_SECTION.includes(from)) { ok(false, `mutant "${name}": its line is in the section`); continue; }
  let bad = 0; try { bad = archScenarios(ARCH_SECTION.replace(from, to), false); } catch (e) { bad = 1; }
  ok(bad > 0, `mutant "${name}" is caught (${bad} failing)`);
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
