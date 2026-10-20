// A dungeon spawn loses the artifacts its base carries before its first host grant (Bthardamz, 20 Oct: Immersive Weapons
// gives Orchendor Chrysamere, EquipBestWeapon put the two-hander in his hand and he never cast). dungeons.js dropArtifacts.
//   node tests/boss-artifact-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) { pass++; console.log('ok', what); } else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };

const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts.json'), 'utf8')).patterns;
const ARTIFACT = new RegExp(list.map((p) => `(?:${p})`).join('|'), 'i');
ok(ARTIFACT.test('IWChrysamereGreatsword'), 'Chrysamere is an artifact');

const dj = fs.readFileSync(path.join(ROOT, 'dungeons.js'), 'utf8');
const start = dj.indexOf('  const dropArtifacts = (id) => {');
const end = dj.indexOf('  const armLease = (lease, snap = spawnSnapshot()) => {');
ok(start > 0 && end > start, 'dungeons.js defines dropArtifacts before armLease');
const body = dj.slice(start, end);
const arm = dj.slice(end, dj.indexOf('\n  };\n', end));
ok(/lease\.armed\.add\(id\);\n\s+const dropped = dropArtifacts\(id\);/.test(arm), 'armLease drops them first, for every spawn of the lease');

const RECORDS = { 0x1: { type: 'WEAP', editorId: 'EnchDaggerFrost01' }, 0x2650d62: { type: 'WEAP', editorId: 'IWChrysamereGreatsword' },
  0x3: { type: 'ARMO', editorId: 'ArmorDragonPriestMaskUltraHelmet' }, 0xf: { type: 'MISC', editorId: 'Gold001' } };
const recordOf = (id) => RECORDS[id] || null;
const make = (inventories) => {
  const sets = [];
  const mp = {
    get: (id, prop) => { if (prop !== 'inventory') throw new Error(prop); if (!(id in inventories)) throw new Error('gone'); return { entries: inventories[id].map((e) => Object.assign({}, e)) }; },
    set: (id, prop, v) => { sets.push([id, prop, v]); inventories[id] = v.entries; },
  };
  const drop = new Function('mp', 'recordOf', 'ARTIFACT', `${body}\nreturn dropArtifacts;`)(mp, recordOf, ARTIFACT);
  return { drop, sets, inventories };
};

{
  const t = make({ 0xff002fd2: [{ baseId: 0x1, count: 1 }, { baseId: 0x2650d62, count: 1 }, { baseId: 0xf, count: 20 }] });
  ok(t.drop(0xff002fd2) === 1, "Orchendor's Chrysamere goes");
  ok(t.inventories[0xff002fd2].map((e) => e.baseId).join() === [0x1, 0xf].join(), 'the dagger and gold stay', t.inventories[0xff002fd2]);
  ok(t.sets.length === 1, 'one write');
}
{
  const t = make({ 7: [{ baseId: 0x1, count: 1 }, { baseId: 0xf, count: 3 }] });
  ok(t.drop(7) === 0 && t.sets.length === 0, 'a spawn with no artifact is not written');
}
{
  const t = make({ 8: [{ baseId: 0x3, count: 1 }, { baseId: 0x999, count: 1 }] });
  ok(t.drop(8) === 1 && t.inventories[8].length === 1 && t.inventories[8][0].baseId === 0x999, 'worn artifacts go too, unknown records stay');
}
{
  const t = make({});
  ok(t.drop(9) === 0, 'a spawn already gone is left alone');
}

console.log(`${pass}/${pass + fail}`);
process.exitCode = fail ? 1 : 0;
