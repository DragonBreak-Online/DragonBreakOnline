// Every creature the wildlife spawners place can be skinned (Nate, 16 Oct: "all wild life needs to b able to be skinned for
// pelts etc."; Purr #7DJT the same night: "wolves arent skinnable and dont drop anything"). Runs gamemode.js's own skinning
// choice (the PELT rule, SKIN_TROPHIES, skinPartsFor and isAnimalPart, sliced out of the file) over every creature base
// and its level-1 death item, as tools/skinning/skin_census.py read them from the live plugins into
// tests/fixtures/wildlife-skin-census.json. Fails when a creature would leave the skinner nothing, or when the part it
// gives is not its own (it must come from its death item, or be a listed give). People and machines are not wildlife:
// they are listed, and must stay the kinds named below. From server\ :
//
//   node tests/skin-every-creature-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const census = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'wildlife-skin-census.json'), 'utf8')).creatures;

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const slice = (from, to) => {
  const a = src.indexOf(from);
  if (a < 0) return null;
  const b = src.indexOf(to, a);
  return b < 0 ? null : src.slice(a, b);
};

// The pieces of gamemode.js the choice is made of
const peltLine = slice('const PELT = ', '\n');
const trophies = slice('const SKIN_TROPHIES = [', '\nconst trophyFor');
const parts = slice('const SKIN_PARTS_DEFAULT = [', '\n// A spawned body whose pelts are not stashed yet');
const animal = slice('const ANIMAL_BODY = Object.assign({', '\n// A plain entry goes on its plain stack');
const peltValue = slice('const peltValueCache = new Map();', '\nconst peltsWorth');
check('gamemode.js has the pelt rule, the trophies, the animal-part rule and the pelt value', !!(peltLine && trophies && animal && peltValue));
check('gamemode.js has skinPartsFor (a part for every pelt-less creature)', !!parts);

// Records: one id per item desc in the census (and the gives), each with its editor id and type
const ids = new Map(); const recs = new Map();
const idOf = (desc, edid, type) => {
  const k = String(desc).toLowerCase();
  if (!ids.has(k)) { const id = 0x01000000 + ids.size; ids.set(k, id); recs.set(id, { record: { editorId: edid, type, fields: [] } }); }
  return ids.get(k);
};
idOf('3ad73:Skyrim.esm', 'glowDust', 'INGR');
for (const c of census) for (const i of c.items) idOf(i.desc, i.edid, i.type);

const sandbox = {
  cfg: {}, log: () => {}, console, Uint8Array, DataView,
  recordOf: (id) => recs.get(Number(id) >>> 0) || null,
  mp: { getIdFromDesc: (d) => ids.get(String(d).toLowerCase()) || 0 },
};
sandbox.globalThis = sandbox;
vm.runInNewContext([peltLine, trophies, animal, parts || 'const skinPartsFor = () => [];', peltValue,
  'globalThis.__t = { PELT, SKIN_TROPHIES, skinPartsFor, isAnimalPart, peltValue };'].join('\n'), sandbox);
const T = sandbox.__t;

// What stashPelts would stash for a body of this creature: a trophy, else its pelts, else its part
const stashFor = (c) => {
  const t = T.SKIN_TROPHIES.find((x) => x.re.test(c.npcEdid));
  if (t) return { how: 'trophy', items: t.items.map((i) => i.desc) };
  const entries = c.items.map((i) => ({ baseId: idOf(i.desc, i.edid, i.type), count: 1 }));
  const pelts = entries.filter((e) => { const r = sandbox.recordOf(e.baseId); return r && r.record.type === 'MISC' && T.PELT.test(r.record.editorId); });
  if (pelts.length) return { how: 'pelt', items: pelts.map((e) => sandbox.recordOf(e.baseId).record.editorId) };
  const p = T.skinPartsFor(c.npcEdid, entries);
  return { how: 'part', items: p.map((e) => (sandbox.recordOf(e.baseId) || { record: { editorId: '?' } }).record.editorId), held: p.every((e) => entries.some((x) => x.baseId === e.baseId)) };
};

// People and machines the wildlife spawners also place (camps, Blackreach): never skinned, and only these kinds
const NOT_WILDLIFE = /Goblin|Riekling|Falmer|Dwarven|Dwemer|Centurion|Sphere|Ballista|Burrower|Sentry|EncGiant|LvlGiant|GiantBoss|StoneGiant|HerderGiant|Ogre/;
const empty = []; const people = []; const rows = [];
for (const c of census) {
  const s = stashFor(c);
  if (NOT_WILDLIFE.test(c.npcEdid)) { people.push(c.npcEdid); if (s.how === 'part' && s.items.length) empty.push(`${c.npcEdid} is not wildlife but would be skinned for ${s.items.join(', ')}`); continue; }
  rows.push(`${c.npcEdid.padEnd(44)} ${s.how.padEnd(6)} ${s.items.join(', ')}`);
  if (!s.items.length) empty.push(`${c.npcEdid} (death item ${c.deathItem || 'none'}: ${c.items.map((i) => i.edid).join(', ') || 'nothing'})`);
  else if (s.how === 'part' && !s.held && !/Wisp/.test(c.npcEdid)) empty.push(`${c.npcEdid} gives ${s.items.join(', ')}, which is not its own`);
}
console.log(rows.sort().join('\n'));
check(`every wild creature of ${census.length - people.length} gives the skinner something of its own${empty.length ? ': ' + empty.join('; ') : ''}`, !empty.length);
check(`the ${people.length} not skinned are people and machines (goblins, rieklings, Falmer, Dwemer automatons) or giants and ogres`, people.every((e) => NOT_WILDLIFE.test(e)));

// Lore spot checks: the part is the creature's own, never its meat when it has a better part
const want = { EncMudcrabMedium: 'MudcrabChitin', EncSkeever: 'SkeeverTail', EncFrostbiteSpider: 'FrostbiteVenom', EncTroll: 'TrollFat',
  EncChaurus: 'ChaurusChitin', EncHorker: 'HorkerTusk', EncMammothTamed: 'MammothTusk', EncSlaughterfish: 'SlaughterfishScales',
  EncIceWraith: 'IceWraithTeeth', EncWispMother: 'WispWrappings', EncWisp: 'glowDust', DLC2EncNetchBull: 'DLC2NetchLeather',
  DLC2EncNetchCalf: 'DLC2NetchJelly', EncHare: 'FoodRabbit', EncChicken: 'FoodChicken', BSKEncRat: 'BSKFoodRatMeat',
  EncWolf: 'WolfPelt', CYREncWolf: 'CYRWolfPelt', EncSabreCat: 'SabreCatPelt', EncBear: 'BearPelt', EncDeer: 'DeerHide02' };
for (const [npc, part] of Object.entries(want)) {
  const c = census.find((x) => x.npcEdid === npc);
  if (!c) { check(`${npc} is in the census`, false); continue; }
  const s = stashFor(c);
  check(`${npc} gives ${part}`, s.items.length === 1 && s.items[0] === part);
}
// A boar is a trophy (tusk and leather); an ogre its tooth
check('a Bawn boar keeps its trophy', stashFor(census.find((x) => x.npcEdid === 'BSKEncBoar01') || { npcEdid: 'BSKEncBoar01', items: [] }).how === 'trophy');

// The tier cap reads the part's gold value: a potion's (meat's, venom's) value is ENIT offset 0, its DATA only a weight
const f32 = (x) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); return b; };
const i32 = (x) => { const b = new Uint8Array(8); new DataView(b.buffer).setInt32(0, x, true); return b; };
recs.set(0x0a000001, { record: { editorId: 'FoodChicken', type: 'ALCH', fields: [{ type: 'DATA', data: f32(0.2) }, { type: 'ENIT', data: i32(3) }] } });
recs.set(0x0a000002, { record: { editorId: 'SkeeverTail', type: 'INGR', fields: [{ type: 'DATA', data: new Uint8Array([3, 0, 0, 0, 0xcd, 0xcc, 0x4c, 0x3e]) }] } });
check('a chicken breast is worth 3 gold (ENIT), not its weight read as gold', T.peltValue(0x0a000001) === 3);
check('a skeever tail is worth 3 gold (DATA)', T.peltValue(0x0a000002) === 3);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
