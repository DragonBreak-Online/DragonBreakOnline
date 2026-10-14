// Scripted test for adminCopyPolicy.ts and its use in formView.ts: a player hidden by ff_adminModes.invis (an Invisible
// admin, someone in character creation) has no local copy on the client of a player or of lower-ranked staff, so no
// footsteps, no body and no nametag; staff of the same or a higher rank keep a ghost copy, and Ghost mode is a ghost copy;
// the copy returns once the player has stayed un-hidden for REVEAL_HOLD_MS.
//
// adminCopyPolicy.ts has no imports, so it transpiles on its own. Run it from skymp5-client:
//
//   ./node_modules/typescript/bin/tsc src/view/adminCopyPolicy.ts --outDir "$TMPDIR/dbo-invisquiet" --module commonjs --target es2019
//   node tests/invisquiet-harness.js "$TMPDIR/dbo-invisquiet/adminCopyPolicy.js"
'use strict';
const fs = require('fs');
const path = require('path');
const { adminViewOfModes, keepNoCopy, nextHiddenAt, REVEAL_HOLD_MS, staffRankOf, seesInvisible } = require(path.resolve(process.argv[2]));

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

// formView.update's block, frame by frame: view is what adminViewOf returns this frame
const watcher = () => {
  const s = { hiddenAt: 0, copy: false, spawns: 0, destroys: 0 };
  s.frame = (view, now) => {
    s.hiddenAt = nextHiddenAt(view, s.hiddenAt, now);
    if (keepNoCopy(view, s.hiddenAt, now)) {
      if (s.copy) { s.copy = false; s.destroys++; }
      return;
    }
    s.hiddenAt = 0;
    if (!s.copy) { s.copy = true; s.spawns++; }
  };
  return s;
};
const run = (s, view, from, to, step = 16) => { for (let t = from; t <= to; t += step) s.frame(view, t); };

// ---- the policy on its own ------------------------------------------------------------------------------------
check('hidden keeps no copy', keepNoCopy('hidden', 1000, 1000) === true);
check('a player never hidden has a copy', keepNoCopy('visible', 0, 5000) === false);
check('a ghost (staff of the same or a higher rank watching, or Ghost mode) has a copy', keepNoCopy('ghost', 0, 5000) === false);
check('un-hidden a moment ago: still no copy', keepNoCopy('visible', 1000, 1000 + REVEAL_HOLD_MS - 1) === true);
check('un-hidden for the whole hold: the copy returns', keepNoCopy('visible', 1000, 1000 + REVEAL_HOLD_MS) === false);
check('nextHiddenAt moves only while hidden', nextHiddenAt('hidden', 5, 99) === 99 && nextHiddenAt('visible', 5, 99) === 5 && nextHiddenAt('ghost', 5, 99) === 5);
check('the hold is short enough not to look broken (<= 2 s)', REVEAL_HOLD_MS > 0 && REVEAL_HOLD_MS <= 2000, REVEAL_HOLD_MS);

// ---- a player watching an admin who turns Invisible on and off ------------------------------------------------
{
  const s = watcher();
  run(s, 'visible', 0, 1000);
  check('visible admin: one copy', s.copy && s.spawns === 1 && s.destroys === 0, s);
  run(s, 'hidden', 1016, 5000);
  check('Invisible on: the copy is deleted once and stays gone', !s.copy && s.destroys === 1 && s.spawns === 1, s);
  run(s, 'visible', 5016, 5016 + REVEAL_HOLD_MS - 32);
  check('Invisible off: no copy during the hold', !s.copy && s.spawns === 1, s);
  run(s, 'visible', 5016 + REVEAL_HOLD_MS, 9000);
  check('after the hold: exactly one new copy', s.copy && s.spawns === 2 && s.destroys === 1, s);
}

// ---- the character-creation sweep: AdminSystem rewrites the mirror (invis off) and the 1 s sweep sets it back ---
{
  const s = watcher();
  run(s, 'hidden', 0, 3000);
  run(s, 'visible', 3016, 3900);   // up to a second un-hidden
  run(s, 'hidden', 3916, 6000);
  check('a mirror flicker shorter than the hold never spawns a copy', !s.copy && s.spawns === 0 && s.destroys === 0, s);
}

// ---- the view from the mirror: the same for every watcher ------------------------------------------------------
check('Invisible is hidden', adminViewOfModes({ invis: true }) === 'hidden');
check('Invisible wins over Ghost', adminViewOfModes({ invis: true, ghost: true }) === 'hidden');
check('Ghost alone is a ghost', adminViewOfModes({ ghost: true, invis: false }) === 'ghost');
check('god, smite and the rest change nothing', adminViewOfModes({ god: true, smite: true, healhit: true }) === 'visible');
check('no mirror, or a bad one, is visible', ['visible', 'visible', 'visible'].join() === [undefined, null, 'x'].map(adminViewOfModes).join());

// ---- a staff watcher of the same or a higher rank sees a ghost throughout ---------------------------------------
{
  const s = watcher();
  run(s, 'ghost', 0, 3000);
  check('staff of the same or a higher rank watching an Invisible admin keep one ghost copy', s.copy && s.spawns === 1 && s.destroys === 0, s);
}

// ---- a lower-ranked staff watcher keeps no copy (Jake, 14 Oct: heard walking and jumping) ------------------------
{
  const s = watcher();
  run(s, 'visible', 0, 1000);
  run(s, seesInvisible(staffRankOf(1, true), 5) ? 'ghost' : 'hidden', 1016, 5000);
  check('a Trial GM watching an owner who turns Invisible: the copy is deleted once and stays gone', !s.copy && s.spawns === 1 && s.destroys === 1, s);
}

// ---- formView.ts uses the policy where the copy is made ----------------------------------------------------------
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'view', 'formView.ts'), 'utf8');
const upd = src.slice(src.indexOf('  update(model: FormModel): void {'), src.indexOf('  destroy(): void {'));
const block = upd.indexOf('keepNoCopy(view, this.lastAdminHiddenAt, now)');
check('formView.update consults keepNoCopy', block > 0);
check('...after the other-cell check (same way of keeping no copy)', block > upd.indexOf('model.movement.worldOrCell !== worldOrCell'));
check('...before the appearance is applied and before any copy is spawned',
  block < upd.indexOf('// Apply appearance before base form selection') && block < upd.indexOf('spawnMethod.spawn('));
check('...only for players (forms with an appearance)', /if \(model\.appearance\) \{\s+const now = Date\.now\(\);\s+const view = FormView\.adminViewOf\(model\);/.test(upd));
check('...deletes an existing copy through destroy() and forgets its id, once',
  /if \(this\.refrId !== 0\) \{\s+this\.destroy\(\);\s+this\.refrId = 0;\s+\}\s+return;/.test(upd));
check('destroy() still removes the nametag', /this\.adminShaderReplayAt = 0;[\s\S]{0,120}this\.removeNickname\(\);\s+\}/.test(src));
check('adminViewOf: invis is hidden to players and lower ranks, a ghost to staff of the same or a higher rank',
  /if \(m\["invis"\]\) return seesInvisible\(FormView\.viewerRank\(\), m\["rank"\]\) \? "ghost" : "hidden";/.test(src));
// Staff ranks (Nate, 14 Oct): owner 5, developer 4, Lead GM 3, GM 2, Trial GM 1, player 0
check('a player never sees an Invisible staff member', !seesInvisible(0, 1) && !seesInvisible(0, undefined));
check('an owner is hidden from a Lead GM, a Lead GM from a GM, a GM from a Trial GM', !seesInvisible(3, 5) && !seesInvisible(2, 3) && !seesInvisible(1, 2));
check('...and a ghost to the same rank or a higher one', seesInvisible(5, 5) && seesInvisible(5, 2) && seesInvisible(3, 3) && seesInvisible(2, 1));
check('a mirror from before ranks (no rank) shows to every staff member, as before', seesInvisible(1, undefined) && seesInvisible(1, 0));
check('the viewer\'s rank: their mirror\'s, else 1 for staff and 0 for a player', staffRankOf(4, true) === 4 && staffRankOf(undefined, true) === 1 && staffRankOf(undefined, false) === 0 && staffRankOf('x', false) === 0);
check('the alpha path stays for a copy that exists (spell Invisibility, staff ghost)', /actor\.setAlpha\(view === "hidden" \? 0 :/.test(src));
check('the nametag guard stays', /adminViewOf\(model\) !== "hidden"/.test(src));

// ---- no potion shimmer on an Invisible admin (Nate, 11 Oct) -------------------------------------------------------
// The abilities that keep NPCs from seeing or hearing them carry hit shaders (read from Skyrim.esm, 11 Oct): MGEF
// TG05KarliahInvisibility -> EFSH 2df92 InvisFXShader (the potion's), DA02MuffleConstantSelf -> EFSH 81180
// DA02ArmorShadow. Both are stopped wherever the abilities are put on.
{
  const look = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'ghostLook.ts'), 'utf8');
  const ams = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'services', 'adminModeService.ts'), 'utf8');
  check('ghostLook lists the two abilities\' shaders', /INVIS_ABILITY_SHADER_IDS = \[0x0002df92, 0x00081180\]/.test(look));
  const apply = ams.slice(ams.indexOf('private applyInvisAbilities('), ams.indexOf('private stopAbilityShaders('));
  check('the admin\'s own client stops them after adding the abilities', /addSpell\(spell, false\)[\s\S]*if \(on\) this\.stopAbilityShaders\(\);/.test(apply));
  check('...on the player, for each shader id', /for \(const id of INVIS_ABILITY_SHADER_IDS\) this\.sp\.EffectShader\.from\(this\.sp\.Game\.getFormEx\(id\)\)\?\.stop\(player\)/.test(ams));
  check('...and again after the 2 s reapply re-adds Karliah\'s ability (it replays the shader)', /player\.addSpell\(karliah, false\);\s+\}\s+this\.stopAbilityShaders\(\);/.test(ams));
  const fv = src.slice(src.indexOf('private static applyInvisAbilities('));
  check('a copy given the abilities stops their shaders too (the ghost shader only)', /if \(on\) for \(const id of INVIS_ABILITY_SHADER_IDS\) EffectShader\.from\(Game\.getFormEx\(id\)\)\?\.stop\(actor\);/.test(fv.slice(0, 800)));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
