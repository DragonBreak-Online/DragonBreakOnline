// Scripted test for sync/equipment.ts applyEquipment on an NPC copy (Nate, 11 Oct: "the boneman doesnt actually use his
// bow"). The server equips an NPC's weapon only (MpActor::EquipBestWeapon), so a Conjure Boneman's equipment is its
// DraugrBow alone; the worn-only inventory took its arrows away and the engine put the bow away on every draw. An NPC
// copy with a bow or crossbow and no ammo now gets arrows or bolts, worn; players, the dead and melee NPCs are unchanged.
// Run from skymp5-client:
//
//   node tests/npc-ammo-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild')].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP npc-ammo (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

// Forms by id: weapons carry a weapon type (7 bow, 9 crossbow), ammo is flagged
const DRAUGR_BOW = 0x302ca, CROSSBOW = 0x200f19f, IRON_SWORD = 0x12eb7, IRON_ARROW = 0x1397d, DRAUGR_ARROW = 0x34182;
const DLC1_BOLT = 0x2000bb3, HIDE_ARMOR = 0x13911, DRAUGR_SWORD = 0x2c66f, BONEMAN_SUMMON = 0x20045b9, BANDIT = 0x3df1e;
const STUBS = {
  sp: `
    const forms = {
      ${DRAUGR_BOW}: { weaponType: 7 }, ${CROSSBOW}: { weaponType: 9 }, ${IRON_SWORD}: { weaponType: 1 },
      ${IRON_ARROW}: { ammo: true }, ${DRAUGR_ARROW}: { ammo: true }, ${DLC1_BOLT}: { ammo: true }, ${HIDE_ARMOR}: {},
      ${DRAUGR_SWORD}: { weaponType: 1 }, ${BONEMAN_SUMMON}: {}, ${BANDIT}: {},
    };
    const formOf = (id) => (forms[id] ? { id, ...forms[id], getFormID: () => id } : null);
    const files = { 'Skyrim.esm': 0x00, 'Dawnguard.esm': 0x02 };
    const log = globalThis.__npcAmmoLog = [];
    module.exports = {
      Ammo: { from: (f) => (f && f.ammo ? f : null) },
      Weapon: { from: (f) => (f && f.weaponType !== undefined ? { getWeaponType: () => f.weaponType } : null) },
      WeaponType: { Bow: 7, Crossbow: 9 },
      Game: { getFormEx: (id) => formOf(id), getFormFromFile: (local, file) => formOf(((files[file] << 24) | local) >>> 0) },
      Spell: { from: () => null },
      Ui: { isMenuOpen: () => false },
      Actor: {},
      ObjectReference: {},
      setInventory: (formId, inv) => log.push({ formId, inv }),
    };`,
  inventory: 'module.exports = { getInventory: () => ({ entries: [] }), getPlayerEnchantment: () => null, isBoundItem: () => false };',
};
const STUB_OF = { skyrimPlatform: 'sp', './inventory': 'inventory' };

const actor = (formId, dead = false, base = BONEMAN_SUMMON) => ({
  getFormID: () => formId, isDead: () => dead, removeAllItems() {}, unequipAll() {},
  getBaseObject: () => ({ getFormID: () => base }),
  getEquippedSpell: () => null, unequipSpell() {}, equipSpell() {},
  getWornForm: () => null, getEquippedObject: () => null, unequipItem() {},
});
const eqOf = (...entries) => ({ inv: { entries }, numChanges: 2 });

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-npcammo-'));
  const out = path.join(tmp, 'equipment.js');
  try {
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/sync/equipment.ts')], bundle: true, platform: 'node', format: 'cjs',
      outfile: out, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (STUB_OF[a.path] ? { path: STUB_OF[a.path], namespace: 'stub' } : undefined));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
      } }],
    });
    const { applyEquipment } = require(out);
    const run = (ac, eq, opts) => {
      const log = globalThis.__npcAmmoLog;
      log.length = 0;
      applyEquipment(ac, eq, opts);
      return log.length ? log[log.length - 1].inv.entries : null;
    };
    const ammoIn = (entries) => (entries || []).filter((e) => e.baseId === IRON_ARROW || e.baseId === DRAUGR_ARROW || e.baseId === DLC1_BOLT);

    // The Boneman as the live change form has it: DraugrBow worn and nothing else (2869.json, 286c.json, 11 Oct)
    const BONEMAN = 0xff0015c7;
    const boneman = run(actor(BONEMAN), eqOf({ baseId: DRAUGR_BOW, count: 1, worn: true, wornLeft: false }), { npcAmmo: true });
    const bonemanAmmo = ammoIn(boneman);
    check('a Boneman copy given only its bow is also given arrows', bonemanAmmo.length === 1 && bonemanAmmo[0].baseId === IRON_ARROW, boneman);
    check('...worn, so the bow has something to shoot', bonemanAmmo.length === 1 && bonemanAmmo[0].worn === true, bonemanAmmo);
    check('...a full quiver (the 1000 every remote copy\'s worn ammo gets)', bonemanAmmo.length === 1 && bonemanAmmo[0].count === 1000, bonemanAmmo);
    check('...and keeps its bow', (boneman || []).some((e) => e.baseId === DRAUGR_BOW && e.worn));

    const xbow = ammoIn(run(actor(BONEMAN), eqOf({ baseId: CROSSBOW, count: 1, worn: true }), { npcAmmo: true }));
    check('an NPC crossbowman gets Dawnguard steel bolts', xbow.length === 1 && xbow[0].baseId === DLC1_BOLT, xbow);

    const own = ammoIn(run(actor(BONEMAN), eqOf({ baseId: DRAUGR_BOW, count: 1, worn: true }, { baseId: DRAUGR_ARROW, count: 20, worn: true }), { npcAmmo: true }));
    check('an NPC whose equipment already wears ammo keeps that ammo and gets no second kind', own.length === 1 && own[0].baseId === DRAUGR_ARROW, own);

    const sword = ammoIn(run(actor(BONEMAN), eqOf({ baseId: IRON_SWORD, count: 1, worn: true }, { baseId: HIDE_ARMOR, count: 1, worn: true }), { npcAmmo: true }));
    check('a melee NPC gets no ammo', sword.length === 0, sword);

    const dead = ammoIn(run(actor(BONEMAN, true), eqOf({ baseId: DRAUGR_BOW, count: 1, worn: true }), { npcAmmo: true }));
    check('a dead archer\'s copy gets no arrows to loot', dead.length === 0, dead);

    const remotePlayer = ammoIn(run(actor(0xff000f7f), eqOf({ baseId: DRAUGR_BOW, count: 1, worn: true }), { npcAmmo: false }));
    check('a player character\'s copy (formView passes npcAmmo false) is left as its owner sent it', remotePlayer.length === 0, remotePlayer);
    const noOpts = ammoIn(run(actor(0xff000f7f), eqOf({ baseId: DRAUGR_BOW, count: 1, worn: true })));
    check('...as is any caller that does not ask', noOpts.length === 0, noOpts);
    const local = ammoIn(run(actor(0x14), eqOf({ baseId: DRAUGR_BOW, count: 1, worn: true }), { npcAmmo: true }));
    check('the local player never gets ammo from this', local.length === 0, local);

    const sidearmOf = (entries) => (entries || []).filter((e) => e.baseId === DRAUGR_SWORD);
    const bonemanSword = sidearmOf(boneman);
    check('a Conjure Boneman copy carries an Ancient Nord Sword', bonemanSword.length === 1, boneman);
    check('...unworn, so the bow stays in hand until its AI switches', bonemanSword.length === 1 && !bonemanSword[0].worn && !bonemanSword[0].wornLeft, bonemanSword);
    const banditSword = sidearmOf(run(actor(0xff0015c8, false, BANDIT), eqOf({ baseId: DRAUGR_BOW, count: 1, worn: true }), { npcAmmo: true }));
    check('another archer gets no sidearm', banditSword.length === 0, banditSword);
    const deadSword = sidearmOf(run(actor(BONEMAN, true), eqOf({ baseId: DRAUGR_BOW, count: 1, worn: true }), { npcAmmo: true }));
    check("a dead Boneman's copy gets no sword", deadSword.length === 0, deadSword);

    const formView = fs.readFileSync(path.resolve(__dirname, '../src/view/formView.ts'), 'utf8');
    check('formView asks for NPC ammo on every copy that is not a player character',
      /applyEquipment\(ac, model\.equipment, \{ npcAmmo: !this\.isPlayerCharacter\(\) \}\)/.test(formView));
    check('formView does not force the server weapon back while the sidearm is in hand',
      /npcSidearmFor\(ac\)[\s\S]{0,120}getEquippedWeapon\(false\)\?\.getFormID\(\) === sidearmId\) \{\s*return;/.test(formView));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
