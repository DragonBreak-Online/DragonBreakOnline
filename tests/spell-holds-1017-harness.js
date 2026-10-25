// Checks gamemode-config.json's spells lists after the 17 Oct new-spells pass (Nate: "fix all of the new spells, fix
// mounts"): the summoned mounts and the Ent are held with a reason, the joke summons are removed, the spells that only
// run on the caster's screen are held, Transmute stays removed, and no spell is both removed and held.
// The ids come from the 140-plugin order (tools scan of SPEL records, 17 Oct). The hold and removal mechanics are tested
// in tests/spells-harness.js.
//
//   node tests/spell-holds-1017-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'gamemode-config.json'), 'utf8'));
const S = cfg.spells || {};
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('ok  ', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };

// Desc as the server reads it (FormDesc): lower-case hex local id, a colon, the plugin's exact load-order name
const DESC = /^[0-9a-f]{1,6}:[^:]+\.(esm|esp|esl)$/;
const norm = (d) => { const [h, p] = String(d).split(':'); return `${parseInt(h, 16).toString(16)}:${p}`; };
const held = (S.suspendedSpells || []).map(norm);
const removed = (S.removedSpells || ['109111:Skyrim.esm']).map(norm);
const reasons = Object.fromEntries(Object.entries(S.suspendedReasons || {}).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [norm(k), v]));

check('every held and removed desc is well formed', [...held, ...removed, ...Object.keys(reasons)].every((d) => DESC.test(d)), [...held, ...removed].filter((d) => !DESC.test(d)));
check('no spell is both removed and held', !held.some((d) => removed.includes(d)), held.filter((d) => removed.includes(d)));
check('every reason belongs to a held spell', Object.keys(reasons).every((d) => held.includes(d)), Object.keys(reasons).filter((d) => !held.includes(d)));
check('the earlier holds stay (two Druadach spells)', ['8dcec:Druadach.esm', '94fca:Druadach.esm'].every((d) => held.includes(d)));
// Equilibrium comes back at the 1026 restart, with the fork's self-cost fix (d9e1de30) and the DLE's fairer trade (Restore Magicka 15)
check('Equilibrium is no longer held', !held.includes('da746:Skyrim.esm'));
check('Transmute Mineral Ore stays removed', removed.includes('109111:Skyrim.esm'));

// The summoned mounts: every SPEL whose SummonCreature actor is on Actors\Horse\HorseProject.hkx
const MOUNTS = {
  'a11ae:Druadach.esm': 'DrV_SpellIndrikSummon -> DrV_IndrikGloamRideable (DrV_IndrikMountRace_Horse)',
  '933e3:Druadach.esm': 'DRVC_ConjureEtherealStrider -> DRVC_EncHorseSaddledSummon (HorseRace)',
  'c600:Dawnguard.esm': 'DLC01SummonSoulHorse (Arvak) -> DLC01SoulCairnHorseSummon (HorseRace)',
};
for (const [d, what] of Object.entries(MOUNTS)) {
  check(`mount summon held with a reason: ${what}`, held.includes(d) && /mount/.test(reasons[d] || ''), reasons[d]);
}
check('Conjure Ent (Summer Druid Armor Set) held with a reason', held.includes('5e31:Summer Druid Armor Set.esp') && /crash/.test(reasons['5e31:Summer Druid Armor Set.esp'] || ''));

// Summerset Isles' joke summons, removed for lore (Nate's standing rule; 17 Oct)
const JOKES = {
  '685735:summersetisles.esp': 'SummonTolfdirSpell (a bloody skeleton named Tolfdir)',
  'c3cd49:summersetisles.esp': 'SummonTolfdirSpell2',
  'e30712:summersetisles.esp': 'SummonHeroOfSheoCharlesSpell (a fancy mudcrab)',
  '14c8bc:summersetisles.esp': 'SummonBabyDaedricTableSpell',
  '99ccc8:summersetisles.esp': 'SummonMimicChestSSISpell',
  '99ccc3:summersetisles.esp': 'SummonBookSSISpell (mimic book)',
  '99ccc2:summersetisles.esp': 'SummonOrbSSISpell (angry orb)',
  '68572b:summersetisles.esp': 'SummonSlugSpell',
};
for (const [d, what] of Object.entries(JOKES)) check(`joke summon removed: ${what}`, removed.includes(d));

// Spells that run only on the caster's game: a script places an object (turrets, walls) or a hazard lingers, and the
// server never sees a hit from them; held until each has a server-side version (17 Oct)
const LOCAL_ONLY = {
  '8313c:arnima.esm': 'ArnimaShockTurretSpell (Storm Vanguard)', '8bebb:arnima.esm': 'ArnimaFireTurretSpell (Infernal Watcher)',
  '8bebc:arnima.esm': 'ArnimaFrostTurretSpell (Frigid Bulwark)', '8bec9:arnima.esm': 'ArnimaHealTurretSpell',
  '83c5a:Druadach.esm': 'DRVC_RaiseWallSpell (Earthen Barrier)', '83c5b:Druadach.esm': 'DRVC_RaisePillarSpell (Earthen Pillar)',
  '83c59:Druadach.esm': 'DRVC_ProtectionSphereSpell (Protective Vortex)',
  '1aee56:arnima.esm': 'ArnimaCircleMaraSpellDark (hazard)', '96d52:Druadach.esm': 'DRVC_ThousandCuts (hazard)',
};
for (const [d, what] of Object.entries(LOCAL_ONLY)) check(`local-only spell held with a reason: ${what}`, held.includes(d) && !!reasons[d], reasons[d]);

// Then (Nate 17 Oct, "do what you recommend"): two more joke summons removed, and the caster-screen-only spells that act on
// other characters (or open locks the server keeps) held
for (const [d, what] of Object.entries({ 'a188e:summersetisles.esp': 'SummonSirRodericSpell (a slaughterfish)', '867:YokuWeapons.esp': '0_JarSpell2 (a jar bomb)' })) check(`joke summon removed: ${what}`, removed.includes(d));
const ON_OTHERS = {
  '933e6:Druadach.esm': 'DRVC_InciteHysteria (a decoy enemies attack)', '8dceb:Druadach.esm': 'DRVC_SplitTheMind (an ability on its target)',
  '8dce8:Druadach.esm': 'DRVC_BlindingMist (blinds those in it)', '960a7:Druadach.esm': 'DRVC_ShroudOfEndurance (links to a target)',
  '960a8:Druadach.esm': 'DRVC_ShroudOfFortitude (links to a target)', '20698:Gray Fox Cowl.esm': 'manny_GF_Spell_UnlockContainer',
  '6028cd:BSAssets.esm': 'BSKOpenSpell2', '6028cf:BSAssets.esm': 'BSKOpenSpell4', '6028d0:BSAssets.esm': 'BSKOpenSpell5',
};
for (const [d, what] of Object.entries(ON_OTHERS)) check(`held with a reason: ${what}`, held.includes(d) && !!reasons[d], reasons[d]);
const LEFT = { '8dce4:Druadach.esm': 'Concealing Fog', '94fc8:Druadach.esm': 'Drain Dead', '3e18:BSAssets.esm': 'Slowfall', '3e27:BSAssets.esm': 'Sanctuary', '3e28:BSAssets.esm': 'Danger Sense', '83c8f:BSHeartland.esm': 'Detect Traps', '302d:Gray Fox Cowl.esm': 'Ancient Vision', '3055ca:summersetisles.esp': 'Sustenance' };
check('the self or cosmetic ones stay free: ' + Object.values(LEFT).join(', '), Object.keys(LEFT).every((d) => !held.includes(d) && !removed.includes(d)));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
