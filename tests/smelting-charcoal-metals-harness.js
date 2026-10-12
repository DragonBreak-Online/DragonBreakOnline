// Scripted test for the charcoal a smelt burns by metal (server\regions.js charcoalByMetal, Nate 7 Oct; eased the same day:
// iron, copper and tin none). The metal is read from the product's editor id, and 'silver' is inside IngotQuicksilver: the
// first match in the table's order charged a Quicksilver Ingot silver's 1 charcoal, not its own 2 (website fact-check,
// 12 Oct; the 7 Oct patch note says 2). Every real smelter ingot recipe of regions.json is crafted once with firewood and
// charcoal enough, and the charcoal burned is checked against the table. No server and no game: from this folder's parent
//
//   node tests\smelting-charcoal-metals-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const REGIONS = path.join(SERVER, 'regions.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smelting-charcoal-metals-harness-'));
process.chdir(dir);
for (const f of ['regions.json', 'regions-overrides.json']) fs.copyFileSync(path.join(SERVER, f), f);

let wallClock = 1780000000000;
Date.now = () => wallClock;

const PLUGINS = { 'Skyrim.esm': 0x00, 'BSAssets.esm': 0x07, 'BSHeartland.esm': 0x0b };
const BY_INDEX = Object.fromEntries(Object.entries(PLUGINS).map(([k, v]) => [v, k]));
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const descOf = (id) => { const p = BY_INDEX[id >>> 24]; if (!p) throw new Error('no plugin'); return `${(id & 0xffffff).toString(16)}:${p}`; };

// Every smelter ingot recipe in regions.json (bench CraftingSmelter): recipe, product, the product's editor id (the real
// records', as tests/gearswap-harness.js and tests/skill-rates-harness.js carry them) and the charcoal per ingot the
// 7 Oct table and patch note give it. Bronze and Brass are in no row of the table: charcoalDefault, 0.
const SMELTS = [
  ['a30c3:Skyrim.esm', 'RecipeIngotIron', '5ace4:Skyrim.esm', 'IngotIron', 0],
  ['601c5b:BSAssets.esm', 'BSKRecipeIngotCopper', '601c5a:BSAssets.esm', 'BSKIngotCopper', 0],
  ['601c4e:BSAssets.esm', 'BSKRecipeIngotBronze', '601c51:BSAssets.esm', 'BSKIngotBronze', 0],
  ['601c8a:BSAssets.esm', 'BSKRecipeIngotBrass', '601c89:BSAssets.esm', 'BSKIngotBrass', 0],
  ['601c93:BSAssets.esm', 'BSKRecipeIngotMeteoricIron', '601c91:BSAssets.esm', 'BSKIngotMeteoricIron', 0],
  ['a30e4:Skyrim.esm', 'RecipeIngotSteel', '5ace5:Skyrim.esm', 'IngotSteel', 1],
  ['a30dd:Skyrim.esm', 'RecipeIngotSilver', '5ace3:Skyrim.esm', 'ingotSilver', 1],
  ['a30cb:Skyrim.esm', 'RecipeIngotCorundum', '5ad93:Skyrim.esm', 'IngotCorundum', 1],
  ['10dd2b:Skyrim.esm', 'RecipeIngotDwarvenScrapLarge', 'db8a2:Skyrim.esm', 'IngotDwarven', 1],
  ['a30d4:Skyrim.esm', 'RecipeIngotGold', '5ad9e:Skyrim.esm', 'IngotGold', 2],
  ['a30db:Skyrim.esm', 'RecipeIngotOrichalcum', '5ad99:Skyrim.esm', 'IngotOrichalcum', 2],
  ['a30d9:Skyrim.esm', 'RecipeIngotMoonstone', '5ad9f:Skyrim.esm', 'IngotIMoonstone', 2],
  ['a30dc:Skyrim.esm', 'RecipeIngotQuicksilver', '5ada0:Skyrim.esm', 'IngotQuicksilver', 2],
  ['a30da:Skyrim.esm', 'RecipeIngotMalachite', '5ada1:Skyrim.esm', 'IngotMalachite', 2],
  ['a30d3:Skyrim.esm', 'RecipeIngotEbony', '5ad9d:Skyrim.esm', 'IngotEbony', 3],
];
const SMELTER_KW = 'a5cce:Skyrim.esm';
const FIREWOOD = '6f993:Skyrim.esm';
const CHARCOAL = '33760:Skyrim.esm';
const bnam = (kw) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, idOf(kw), true); return { type: 'BNAM', data: b }; };
const RECORDS = { [idOf(SMELTER_KW)]: { type: 'KYWD', editorId: 'CraftingSmelter', fields: [] } };
for (const [recipe, recipeEdid, item, itemEdid] of SMELTS) {
  RECORDS[idOf(recipe)] = { type: 'COBJ', editorId: recipeEdid, fields: [bnam(SMELTER_KW)] };
  RECORDS[idOf(item)] = { type: 'MISC', editorId: itemEdid, fields: [] };
}

const SMITH = 0x14;
const props = new Map();
const put = (id, p, v) => props.set(id + '|' + p, v);
const inv = (a) => (props.get(a + '|inventory') || { entries: [] }).entries;
const count = (a, desc) => inv(a).filter((e) => e.baseId === idOf(desc)).reduce((n, e) => n + e.count, 0);
const setHeld = (a, held) => put(a, 'inventory', { entries: Object.entries(held).map(([d, n]) => ({ baseId: idOf(d), count: n })) });
put(SMITH, 'worldOrCellDesc', 'a764b:BSHeartland.esm'); put(SMITH, 'pos', [0, 0, 0]);

const mp = {
  getIdFromDesc: idOf,
  getDescFromId: descOf,
  get: (id, p) => props.get(id + '|' + p),
  set: (id, p, v) => props.set(id + '|' + p, JSON.parse(JSON.stringify(v))),
  lookupEspmRecordById: (id) => (RECORDS[id] ? { record: RECORDS[id], toGlobalRecordId: (local) => local } : null),
};
mp.onCraft = () => undefined;   // masterySystem's chain: lets every craft on

const out = { said: [], audits: [], logs: [] };
delete require.cache[REGIONS];
require(REGIONS)({
  mp, log: (...a) => out.logs.push(a.join(' ')), personal: (a, t) => out.said.push(t), audit: (t) => out.audits.push(t),
  who: (a) => `P${a.toString(16)}`, isAdmin: () => false, registerChatCommand: () => {},
  sendPacket: () => true,
  cfg: { regions: { craft: true, tomes: false, adminBypass: true, failOpen: true, defaultPlace: 'skyrim' } },
});

let failures = 0, checks = 0;
const check = (name, ok, detail) => { checks++; if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); } else console.log(`ok   ${name}`); };
// One smelt of n ingots with fuel enough: [firewood burned, charcoal burned, the hook's verdict]
const smelt = (recipe, item, n) => {
  wallClock += 2000;
  setHeld(SMITH, { [FIREWOOD]: 100, [CHARCOAL]: 20 });
  const verdict = mp.onCraft(SMITH, idOf(item), n, idOf(recipe));
  return [100 - count(SMITH, FIREWOOD), 20 - count(SMITH, CHARCOAL), verdict];
};

check('regions.js holds the craft hook', typeof mp.onCraft === 'function' && mp.onCraft.__dboRegions === true);
for (const [recipe, recipeEdid, item, itemEdid, coal] of SMELTS) {
  const [wood, burned, verdict] = smelt(recipe, item, 1);
  check(`${recipeEdid} (${itemEdid}) burns ${coal} charcoal and 2 firewood an ingot`, verdict !== false && burned === coal && wood === 2, { verdict, burned, wood });
}

// The reported metal, with the count a smelt of several ingots carries
const QS = SMELTS.find((s) => s[3] === 'IngotQuicksilver');
const [, threeQs] = smelt(QS[0], QS[2], 3);
check('three Quicksilver Ingots burn 6 charcoal, not silver\'s 3', threeQs === 6, threeQs);
wallClock += 2000;
setHeld(SMITH, { [FIREWOOD]: 2, [CHARCOAL]: 1 });
out.said.length = 0;
check('a Quicksilver smelt with 1 charcoal and no spare firewood is refused', mp.onCraft(SMITH, idOf(QS[2]), 1, idOf(QS[0])) === false && count(SMITH, CHARCOAL) === 1 && count(SMITH, FIREWOOD) === 2);
check('...and asks for 2 charcoal an ingot', /^Smelting this needs 2 firewood and 2 charcoal for each ingot \(you have 2 firewood, 1 charcoal\)/.test(out.said[out.said.length - 1] || ''), out.said);
// The longer name wins only where it is in the editor id
const SILVER = SMELTS.find((s) => s[3] === 'ingotSilver');
check('silver itself still burns 1 (the longer name does not swallow the shorter)', smelt(SILVER[0], SILVER[2], 2)[1] === 2);

console.log(`\n${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
