// The first-time craft bonus (skillrates.js firstCraft; Discord 10 Oct, Nate: build it and turn it on with this update):
// an item a character has never made in that skill is worth `rate` times as much, in full for the first `fullFor`
// different items, then less and less; never on tempering; kept on the character. Stub records and a stub mp.
// Run from server/: node tests/first-craft-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const MODULE = path.join(SERVER, 'skillrates.js');
const CONFIG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
let fails = 0;
const ok = (label, cond, got) => { if (!cond) { fails++; console.log(`  FAIL ${label}${got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); } else console.log(`  ok   ${label}`); };
const near = (x, y) => Math.abs(x - y) < 1e-9;

// stub records: products 0x5000+n, recipes 0x100+n at a forge or a cook pot; two temper benches
const world = new Map();
const u8 = (fill) => { const b = new Uint8Array(4); fill(new DataView(b.buffer)); return b; };
const FORGE = 0x900, POT = 0x901, TABLE = 0x902;
world.set(FORGE, { record: { type: 'KYWD', editorId: 'CraftingSmithingForge', fields: [] } });
world.set(POT, { record: { type: 'KYWD', editorId: 'CraftingCookpot', fields: [] } });
world.set(TABLE, { record: { type: 'KYWD', editorId: 'CraftingSmithingArmorTable', fields: [] } });
const recipe = (id, product, bench) => {
  world.set(product, { record: { type: 'MISC', editorId: `P${product.toString(16)}`, fields: [] } });
  world.set(id, { record: { type: 'COBJ', editorId: `R${id.toString(16)}`, fields: [{ type: 'CNAM', data: u8((v) => v.setUint32(0, product, true)) }, { type: 'BNAM', data: u8((v) => v.setUint32(0, bench, true)) }] }, toGlobalRecordId: (l) => l });
};
for (let i = 0; i < 120; i++) recipe(0x100 + i, 0x5000 + i, i < 60 ? POT : FORGE);
recipe(0x300, 0x5000, TABLE); // tempering the first dish's product (a stand-in)
const recordOf = (id) => world.get(id >>> 0) || null;
const fieldsOf = (r, type) => ((r && r.record.fields) || []).filter((f) => f.type === type);
const props = new Map(), told = [];
const mp = { get: (a, k) => props.get(`${a}|${k}`), set: (a, k, v) => props.set(`${a}|${k}`, v), getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm` };
const load = (cfg) => { delete require.cache[MODULE]; require(MODULE)({ log: () => {}, cfg: { skillRates: cfg }, recordOf, fieldsOf, inBeastForm: () => false, mp, personal: (a, t) => told.push([a, t]) }); return globalThis.__dboSkillRate; };
const A = 0xff000101;
const craft = (rate, skill, recipeId) => rate(A, skill, 'craft', { recipeId });

// ---- what ships ----
const F = (CONFIG.skillRates || {}).firstCraft || {};
ok('config: firstCraft on (Nate, 10 Oct), x3 for the first 25, cooking, smithing, alchemy, tailoring', F.enabled === true && F.rate === 3 && F.fullFor === 25 && JSON.stringify(F.skills) === '["cook","blacksmith","alchemist","tailor"]', F);
ok('gamemode hands skillrates.js mp and personal', /require\(SKILLRATES_JS\)\(\{[^}]*mp, personal \}\)/.test(fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8')));

// ---- off ----
let rate = load({ enabled: true, rates: {} });
ok('off by default: a new dish is worth 1', craft(rate, 'cook', 0x100) === 1 && !props.get(`${A}|private.dboCraftedKinds`));

// ---- on ----
rate = load({ enabled: true, rates: { blacksmith: 2 }, firstCraft: { enabled: true, rate: 3, fullFor: 25, skills: ['cook', 'blacksmith', 'alchemist', 'tailor'] } });
told.length = 0;
ok('a dish never made before: x3, and the player is told', craft(rate, 'cook', 0x100) === 3 && told.length === 1 && /Something new/.test(told[0][1]));
ok('the same dish again: x1', craft(rate, 'cook', 0x100) === 1);
ok('kept on the character by desc', JSON.stringify(props.get(`${A}|private.dboCraftedKinds`)) === '{"cook":["5000:skyrim.esm"]}', props.get(`${A}|private.dboCraftedKinds`));
for (let i = 1; i < 25; i++) craft(rate, 'cook', 0x100 + i);
ok('the 25th different dish is still x3', props.get(`${A}|private.dboCraftedKinds`).cook.length === 25);
ok('the 26th: 1 + 2 x 25/26', near(craft(rate, 'cook', 0x100 + 25), 1 + 2 * 25 / 26));
for (let i = 26; i < 49; i++) craft(rate, 'cook', 0x100 + i);
ok('the 50th: 1 + 2 x 25/50 = 2', near(craft(rate, 'cook', 0x100 + 49), 2));
ok('tempering is never new', craft(rate, 'blacksmith', 0x300) === 2);
ok('a skill not listed (Blunt) gets nothing', rate(A, 'blunt', 'craft', { recipeId: 0x160 }) === 1);
ok('a new forge item for the smith: its rate x2, then the bonus x3 = 6', craft(rate, 'blacksmith', 0x160) === 6 && craft(rate, 'blacksmith', 0x160) === 2);
ok('each skill counts its own items (the smith\'s first is not the cook\'s 51st)', props.get(`${A}|private.dboCraftedKinds`).blacksmith.length === 1);
ok('not a craft (a hit): its rate only, never the bonus', rate(A, 'blacksmith', 'hit', { recipeId: 0x161 }) === 2 && props.get(`${A}|private.dboCraftedKinds`).blacksmith.length === 1);
// a reload or a relog: the list is on the character
rate = load({ enabled: true, rates: {}, firstCraft: { enabled: true, rate: 3, fullFor: 25, skills: ['cook'] } });
ok('after a reload the dishes made are remembered', craft(rate, 'cook', 0x100) === 1 && near(craft(rate, 'cook', 0x100 + 50), 1 + 2 * 25 / 51));
ok('a recipe the server cannot read gets nothing', craft(rate, 'cook', 0x7777) === 1);

// ---- with masterySystem's credit report (fork mastery-credited-hook): marked only when the craft credited something ----
globalThis.__dboMasteryCreditsHook = 1;
props.delete(`${A}|private.dboCraftedKinds`);
rate = load({ enabled: true, rates: {}, firstCraft: { enabled: true, rate: 3, fullFor: 25, skills: ['cook'] } });
told.length = 0;
ok('a new dish at a spent bucket: x3 offered, not yet marked, nobody told', craft(rate, 'cook', 0x100) === 3 && !props.get(`${A}|private.dboCraftedKinds`) && told.length === 0);
globalThis.__dboSkillRateCredited(A, 'cook', 'craft', { recipeId: 0x100 }, 0);
ok('...the meter kept nothing: still not marked', !props.get(`${A}|private.dboCraftedKinds`));
ok('so the next time it is still new: x3', craft(rate, 'cook', 0x100) === 3);
globalThis.__dboSkillRateCredited(A, 'cook', 'craft', { recipeId: 0x100 }, 1.5);
ok('...credited this time: marked, and the player told', JSON.stringify(props.get(`${A}|private.dboCraftedKinds`)) === '{"cook":["5000:skyrim.esm"]}' && told.length === 1);
ok('...and from then on x1', craft(rate, 'cook', 0x100) === 1);
globalThis.__dboSkillRateCredited(A, 'cook', 'craft', { recipeId: 0x100 }, 1);
ok('a credit with nothing pending changes nothing', props.get(`${A}|private.dboCraftedKinds`).cook.length === 1 && told.length === 1);

// ---- a brew: alchemy.js credits it as an award (kind "award", detail.key = the potion), as the lab has no recipe ----
// Live 11 Oct: 21 characters had first crafts marked by 19Z and none for the Alchemist; "alchemist { craft: 2 }" never
// applied either (skillrates.js craftAwards)
props.delete(`${A}|private.dboCraftedKinds`); told.length = 0;
const LIVE_RATES = (CONFIG.skillRates || {}).rates || {};
rate = load({ enabled: true, rates: LIVE_RATES, firstCraft: F });
const POTION = 0x3eb15, POTION2 = 0x3eb16;
const brew = (key) => rate(A, 'alchemist', 'award', { key });
ok('a brew of a potion never made before: the live craft rate x2, then the bonus x3 = 6', brew(POTION) === 6, brew(POTION));
globalThis.__dboSkillRateCredited(A, 'alchemist', 'award', { key: POTION }, 1);
ok('...credited: marked as made by the potion, and the player told', JSON.stringify((props.get(`${A}|private.dboCraftedKinds`) || {}).alchemist) === '["3eb15:skyrim.esm"]' && told.length === 1, props.get(`${A}|private.dboCraftedKinds`));
ok('...the same potion again: x2 only', brew(POTION) === 2);
ok('...another potion: x6 again', brew(POTION2) === 6);
globalThis.__dboSkillRateCredited(A, 'alchemist', 'award', { key: POTION2 }, 0);
ok('...a brew the meter kept nothing of stays new', brew(POTION2) === 6);
ok('an award of another skill (a smith\'s skill book) is no craft: no bonus', rate(A, 'blacksmith', 'award', { key: 0x1afce }) === ((typeof LIVE_RATES.blacksmith === 'number') ? LIVE_RATES.blacksmith : 1) && !(props.get(`${A}|private.dboCraftedKinds`) || {}).blacksmith);
const asrc = fs.readFileSync(path.join(SERVER, 'alchemy.js'), 'utf8');
ok('alchemy.js reports what a brew credited to skillrates.js', /__dboSkillRateCredited\(a, 'alchemist', 'award', \{ key: Number\(potionId\) >>> 0 \}, units\)/.test(asrc));
delete globalThis.__dboMasteryCreditsHook;

// ---- with the racial overhaul on (12 Oct): the race's boost first, then the first-craft bonus, both on the skill's rate ----
const RB = 0xff000202;
globalThis.__dboRaceSkillRate = (a, skill, kind) => ((a >>> 0) === RB && skill === 'blacksmith' && kind !== 'award' ? 1.15 : 1);
rate = load({ enabled: true, rates: { blacksmith: 2 }, firstCraft: { enabled: true, rate: 3, fullFor: 25, skills: ['blacksmith'] } });
ok('an Orc smith\'s new forge item: rate 2 x race 1.15 x first-craft 3 = 6.9; the same item again 2.3', near(rate(RB, 'blacksmith', 'craft', { recipeId: 0x170 }), 6.9) && near(rate(RB, 'blacksmith', 'craft', { recipeId: 0x170 }), 2.3));
ok('...another race on the same new item: 2 x 3 = 6', near(rate(A, 'blacksmith', 'craft', { recipeId: 0x171 }), 6));
delete globalThis.__dboRaceSkillRate;

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
