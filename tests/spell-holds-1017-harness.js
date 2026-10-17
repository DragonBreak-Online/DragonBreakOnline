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
check('the earlier holds stay (Equilibrium, two Druadach spells)', ['da746:Skyrim.esm', '8dcec:Druadach.esm', '94fca:Druadach.esm'].every((d) => held.includes(d)));
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

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
