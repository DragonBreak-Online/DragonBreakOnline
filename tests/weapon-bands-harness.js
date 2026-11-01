// Weapon damage bands (Nat, 1 Nov: "yes start with weapon bands"; _work/ladder-review-1031.md step 2): a weapon above the
// best ordinary vanilla weapon of its type at its tier counts at that ceiling, by editor id (gamemode-config.json
// weaponBands.damageByEditorId, from tools/materials/weapon-bands-1031.tsv), for every attacker; the arrow's share,
// tempering and the inventory read the banded damage; a creature's weapon comes off a player and is never loot; the
// named uniques are filed as artifacts. The section is lifted from gamemode.js and run against stubs; each mutant must
// fail at least one scenario.
//   node tests/weapon-bands-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const GM = read('gamemode.js');
const CFG = JSON.parse(read('gamemode-config.json'));
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 300)}`); if (!c) fails++; };
const cut = (from, to) => { const i = GM.indexOf(from), j = GM.indexOf(to, i); return i >= 0 && j > i ? GM.slice(i, j) : ''; };
const tsv = (f) => { const r = read(f).trim().split('\n'); const h = r.shift().split('\t'); return r.map((l) => { const c = l.split('\t'); return Object.fromEntries(h.map((k, i) => [k, c[i]])); }); };

// ---- the data ----
const WB = CFG.weaponBands || {};
const table = WB.damageByEditorId || {};
const bands = tsv('tools/materials/weapon-bands-1031.tsv'), creatures = tsv('tools/materials/weapon-bands-1031-creatures.tsv');
ok(WB.enabled === true && Array.isArray(WB.creature) && typeof WB.line === 'string', 'gamemode-config.json has weaponBands, on, with creature patterns and a line', Object.keys(WB));
const wrong = bands.filter((b) => Number(table[b.edid]) !== Number(b.target));
ok(bands.length > 100 && wrong.length === 0 && Object.keys(table).length === bands.length, `every one of the ${bands.length} band targets is counted by editor id at its value`, wrong.slice(0, 3));
const notLower = bands.filter((b) => !(Number(b.target) < Number(b.damage)));
ok(notLower.length === 0, 'every target is below the record damage it replaces (a band only lowers)', notLower.slice(0, 3));
ok(table.CYRPOIFallenStormcloakTriKeyChestNordHeroAntique === 12, 'the Antique Nordic Sword (tier 2, 25) counts at the tier 2 sword ceiling, 12', table.CYRPOIFallenStormcloakTriKeyChestNordHeroAntique);
ok(table.manny_GF_Weapon_Umbra === 15 && table.KamenGreatsword === 25 && table.manny_GF_Weapon_BladesSwordGuardian === 13,
  'uniques count at the tier they belong to: Umbra 15 (sword T7), Kamen greatsword 25 (T7), the Blades guardian sword 13 (T6)', [table.manny_GF_Weapon_Umbra, table.KamenGreatsword, table.manny_GF_Weapon_BladesSwordGuardian]);
// The bands never touch vanilla's own ladder, so the ceilings stay what they are measured from
const VANILLA = ['IronSword', 'SteelSword', 'DaedricSword', 'DragonboneSword', 'EbonyWarhammer', 'DaedricBow', 'DLC1DragonboneBow', 'DLC1DwarvenCrossbow', 'DLC2StalhrimSword', 'GlassGreatsword'];
ok(VANILLA.every((e) => !(e in table)), 'no vanilla ladder weapon is banded (Iron to Dragonbone, the crossbows, Stalhrim)', VANILLA.filter((e) => e in table));

const rx = WB.creature.map((p) => new RegExp(p));
const isCreature = (e) => rx.some((r) => r.test(e));
const missed = creatures.filter((c) => !isCreature(c.edid));
ok(creatures.length >= 20 && missed.length === 0, `every one of the ${creatures.length} creature weapons matches weaponBands.creature`, missed.map((c) => c.edid));
const ORDINARY = ['DLC1CrossBow', 'CrossBow', 'DLC1DwarvenCrossbow', 'IronSword', 'DaedricBattleaxe', 'NightingaleBow01', 'DBBladeOfWoeReward', 'SkyforgeSteelSword', 'manny_GF_Weapon_Umbra', 'DLC2MKMiraakSword3', 'Scimitar'];
ok(!bands.some((b) => isCreature(b.edid)) && ORDINARY.every((e) => !isCreature(e)), 'no banded or player weapon matches a creature pattern (the crossbows, the Nightingale Bow, the Blade of Woe)', ORDINARY.filter(isCreature));
ok(['CrGiantClub', 'DLC1FrostGiantClub', 'crDwarvenSphereCrossbow', 'DLC1TrapCrossbowWeapon01', 'NightingaleBowNPC', 'DLC2CrBenthicLurkerWeapon', 'manny_GF_Weapon_UmbraNonPlayable'].every(isCreature),
  'giant clubs, sphere and trap crossbows, the Benthic Lurker and the NPC-only copies are creature weapons');

const never = new Set(Object.keys(JSON.parse(read('loot-overrides.json')).never).map((k) => k.toLowerCase()));
const loose = creatures.filter((c) => !never.has(c.desc.toLowerCase()));
ok(loose.length === 0, 'every creature weapon is never loot (loot-overrides.json)', loose.map((c) => c.desc));
const fam = JSON.parse(read('loot-materials.json')).items;
const REFILED = { '9ccdc:skyrim.esm': 'Blade of Woe', '334e:gray fox cowl.esm': 'Umbra', '39fb4:dragonborn.esm': "Miraak's sword", '5bf18:skyrim.esm': "Tsun's axe",
  'f71d0:skyrim.esm': 'Dragonbane', '279a:gray fox cowl.esm': 'the Blades guardian sword', '800:dragonbreak hub.esp': "Saarthal's Vengeance" };
const notArt = Object.keys(REFILED).filter((d) => fam[d] !== 'artifact');
ok(notArt.length === 0, 'the named uniques are filed as artifacts, not steel, honed Ancient Nord or Ebony', notArt.map((d) => `${REFILED[d]}: ${fam[d]}`));
ok(fam['f8318:skyrim.esm'] === 'glass' && fam['956b5:skyrim.esm'] === 'EBONY' && fam['478ce:immersive weapons.esp'] === 'DAEDRIC',
  'Chillrend (glass) and Wuuthrad (Ebony) keep their family, and so does the forgeable Immersive Weapons Blade of Woe');
const py = read('tools/loot/loot_materials.py');
// The generator's EDID_FIRST rules that file as 'artifact', joined from their r'...' parts, run on the uniques' editor ids
const artifactRules = (() => {
  const body = py.slice(py.indexOf('EDID_FIRST = ['), py.indexOf(']\n', py.indexOf('EDID_FIRST = [')) + 1);
  const out = [];
  for (const m of body.matchAll(/\((r'(?:[^']|'\s*r')*'(?:\s*r'[^']*')*)\s*,\s*'artifact'\)/g)) {
    const src = [...m[1].matchAll(/r'([^']*)'/g)].map((x) => x[1]).join('');
    try { out.push(new RegExp(src)); } catch (e) { /* a Python-only pattern: not one of these */ }
  }
  return out;
})();
const filedAsArtifact = (edid) => artifactRules.some((rx) => rx.test(edid));
const REFILED_EDIDS = ['DBBladeOfWoeReward', 'manny_GF_Weapon_Umbra', 'DLC2MKMiraakSword3', 'MQ304DraugrBattleAxeTsun04', 'MQ203AkaviriKatana5', 'manny_GF_Weapon_BladesSwordGuardian', 'RP_SaarthalsVengeance'];
ok(REFILED_EDIDS.every(filedAsArtifact) && !['IWCBladeOfWoe', 'TG07Chillrend006', 'C06BladeOfYsgramor', 'IronSword'].some(filedAsArtifact),
  'loot_materials.py files the same uniques as artifacts (not the forgeable replicas, Chillrend or Wuuthrad), so a regeneration keeps them', REFILED_EDIDS.filter((e) => !filedAsArtifact(e)));

// ---- the wiring ----
const SECTION = cut('// Weapon bands (Nat, 1 Nov', 'const arrowDamageMult');
const ARROW = cut('const arrowDamageMult = (aggressorId, sourceId) => {', '\n};\n') + '\n};\n';
const TEMPER = cut('const temperDamageMult = (aggressorId, sourceId) => {', '\n};\n') + '\n};\n';
ok(SECTION.length > 500 && ARROW.length > 100 && TEMPER.length > 100, 'gamemode.js has the band, arrow and temper sections');
ok(!/mp\.on\(/.test(SECTION), 'the band section registers no mp.on listener (a hot reload would stack it)');
ok(/materialDamageMult\(agg, src\) \* weaponBandMult\(src\) \* temperDamageMult\(agg, src\) \* arrowDamageMult\(agg, src\)/.test(GM)
  && /let mult = \(beastAgg \? 1 : masteryDamageMult\(agg, src\) \* potionAttackMult\(agg, src\)\) \*[^;]*weaponBandMult\(src\)/.test(GM),
  'the hit multiplies weaponBandMult for every attacker, NPCs too, PvE and PvP');
ok(/const bow = bandedDamageOf\(sourceId\);/.test(ARROW) && /const base = bandedDamageOf\(sourceId\);/.test(TEMPER), 'the arrow\'s share and tempering are counted over the banded damage');
ok(/const base = bandedDamageOf\(id\);\n {4}if \(base > 0\) \{\n {6}const skill = DISPLAY_SKILL/.test(GM), 'the inventory shows the banded damage');
ok(/if \(isAllowed\) \{ try \{ creatureWeaponCheck\(a, equipment\); \}/.test(GM), 'the equip hook takes a creature weapon off (inside the existing hook, no new listener)');

// ---- the behaviour, against stubs ----
const W = { 0x10: ['CYRPOIFallenStormcloakTriKeyChestNordHeroAntique', 25], 0x11: ['IronSword', 7], 0x12: ['UpTable', 10], 0x13: ['BandedBow', 25], 0x14: ['CrGiantClub', 60], 0x15: ['TemperSword', 20] };
const run = (sec, arrowSec, temperSec, cfg) => {
  const said = [], unequipped = [];
  const timers = [];
  const env = {
    cfg: { weaponBands: cfg },
    log: () => {}, personal: (a, t) => said.push([a, t]), sendPacket: () => {}, display: (a) => `#${a}`,
    profileOf: (a) => (a >= 100 ? 1 : -1),
    recordOf: (id) => (W[id] ? { record: { type: 'WEAP', editorId: W[id][0] } } : (id === 0x99 ? { record: { type: 'AMMO', editorId: 'Arrow' } } : null)),
    recordDamageOf: (id, type) => (type === 'WEAP' && W[id] ? W[id][1] : (type === 'AMMO' && id === 0x99 ? 20 : 0)),
    wornOf: (eq) => (eq.worn || []).map((id) => ({ baseId: id, left: false })),
    setTimeout: (f) => timers.push(f),
    mp: { callPapyrusFunction: (k, c, m, self, args) => unequipped.push(args[0].desc), getDescFromId: (id) => id.toString(16), get: () => ({ worn: [0x13, 0x99] }) },
    ARROWS: { enabled: true, scale: 1 }, weaponSkillOf: (id) => (id === 0x13 ? 'archery' : 'blade'),
    wornWithHealth: () => [{ baseId: 0x15, health: 1.5, cond: 1 }], temperBonus: () => 4,
  };
  const names = Object.keys(env);
  const body = `${sec}\n${arrowSec}\n${temperSec}\nreturn { bandedDamageOf, weaponBandMult, creatureWeaponCheck, arrowDamageMult, temperDamageMult };`;
  const api = new Function(...names, body)(...names.map((k) => env[k]));
  api.flush = () => { while (timers.length) timers.shift()(); };
  return Object.assign(api, { said, unequipped });
};
const LIVE = { enabled: true, damageByEditorId: { CYRPOIFallenStormcloakTriKeyChestNordHeroAntique: 12, UpTable: 30, BandedBow: 20, TemperSword: 15 }, creature: WB.creature, line: 'no' };
const scenarios = (sec, arrowSec, temperSec, live) => {
  let bad = 0;
  const t = (c, what, got) => { if (!c) bad++; if (live) ok(c, what, got); };
  const s = run(sec, arrowSec, temperSec, LIVE);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  t(near(25 * s.weaponBandMult(0x10), 12), 'the engine\'s 25 from the Antique Nordic Sword lands as 12', 25 * s.weaponBandMult(0x10));
  t(s.weaponBandMult(0x11) === 1 && s.bandedDamageOf(0x11) === 7, 'an Iron sword, not in the table, is untouched', s.weaponBandMult(0x11));
  t(s.weaponBandMult(0x12) === 1 && s.bandedDamageOf(0x12) === 10, 'a table value above the record never raises it', s.bandedDamageOf(0x12));
  t(s.weaponBandMult(0x51) === 1, 'a spell or a fist (no WEAP damage) is untouched', s.weaponBandMult(0x51));
  const bow = 25 * s.weaponBandMult(0x13) * s.arrowDamageMult(100, 0x13);
  t(near(bow, 40), 'a banded bow (25 to 20) with a 20 arrow lands 20 + 20 = 40, the arrow counted over the banded bow', bow);
  const temp = 20 * s.weaponBandMult(0x15) * s.temperDamageMult(100, 0x15);
  t(near(temp, 19), 'a banded sword (20 to 15) tempered +4 lands 15 + 4 = 19', temp);
  s.creatureWeaponCheck(100, { worn: [0x14, 0x11] }); s.flush();
  t(s.unequipped.length === 1 && s.unequipped[0] === '14' && s.said.length === 1, 'a player who puts on a giant club has it taken off and told why; their sword stays', [s.unequipped, s.said]);
  s.creatureWeaponCheck(5, { worn: [0x14] }); s.flush();
  t(s.unequipped.length === 1, 'an NPC keeps its giant club', s.unequipped);
  const off = run(sec, arrowSec, temperSec, Object.assign({}, LIVE, { enabled: false }));
  off.creatureWeaponCheck(100, { worn: [0x14] }); off.flush();
  t(off.weaponBandMult(0x10) === 1 && off.unequipped.length === 0, 'enabled false turns both off', [off.weaponBandMult(0x10), off.unequipped]);
  return bad;
};
ok(scenarios(SECTION, ARROW, TEMPER, true) === 0, 'all scenarios pass on the live code');

const MUTANTS = [
  ['a band may raise', SECTION, 'return t > 0 && t < raw ? t : raw;', 'return t > 0 ? t : raw;'],
  ['the hit ignores the band', SECTION, 'return raw > 0 ? bandedDamageOf(sourceId) / raw : 1;', 'return 1;'],
  ['the switch is ignored', SECTION, 'if (!WEAPON_BANDS.enabled || !(raw > 0)) return raw;', 'if (!(raw > 0)) return raw;'],
  ['NPCs lose their clubs', SECTION, ' || !(profileOf(a) >= 0)) return;', ') return;'],
  ['the club stays on', SECTION, 'if (!isCreatureWeapon(Number(w.baseId) >>> 0)) continue;', 'continue;'],
  ['the arrow counts over the record', ARROW, 'const bow = bandedDamageOf(sourceId);', "const bow = recordDamageOf(sourceId, 'WEAP');"],
  ['tempering counts over the record', TEMPER, 'const base = bandedDamageOf(sourceId);', "const base = recordDamageOf(sourceId, 'WEAP');"],
];
for (const [name, sec, a, b] of MUTANTS) {
  if (!sec.includes(a)) { ok(false, `mutant "${name}": its line is in the code`, a); continue; }
  const m = sec.replace(a, b);
  let bad;
  try { bad = scenarios(sec === SECTION ? m : SECTION, sec === ARROW ? m : ARROW, sec === TEMPER ? m : TEMPER, false); } catch (e) { bad = 1; }
  ok(bad > 0, `mutant caught: ${name}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
