// The Skyrim release's crafting rules (check 4, 15 Oct; ~/claude-nate-release/specs/skyrim-recipes-check.md):
//  - regions.js raceCraft (config raceCraft): a people's own armoury is made only by that race (Nate 14 Oct: Gild crude
//    Goblins only, Pig Iron Orcs only; Nat's race-only list of 13 Oct), tempering open, staff pass, an unread race fails
//    closed, and the set's rule decides before the Orcish rule (a Yoku shield of Orcish metal is a Redguard's);
//  - the Adamantium Addon (DragonBreak Armory.esp) is every race's; the Dwemer Mantis armour is never forged (forgeNever);
//  - regions.json (140-plugin order, PC 15 Oct) lists the new plugins' creation recipes; regions-overrides.json makes the
//    peoples' recipes it tags too narrowly common (raceCraft decides who), recipePlugins is empty, tempering stays open;
//    the Black Bear light hoods are forgeable again (Armory v9), the bank-vault gold ingot recipe is refused;
//  - smithing.json's Yokudan, Black Bear and Apex Khajiit families (book 'race'): known by birth, never apprenticed, never
//    carried over; loot-materials.json files the new sets under them;
//  - faction-gear.json carries the Civil War battlemage and Dominion Thalmor sets.
// Loads the real regions.js and smithing.js against fake plugin records, and reads the real data files.
//   node tests/skyrim-crafting-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 400)}`); if (!c) fails++; };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(SERVER, f), 'utf8'));
const CONFIG = readJson('gamemode-config.json');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-skycraft-'));
process.on('exit', () => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
process.chdir(scratch);
for (const f of ['regions.json', 'regions-overrides.json', 'dragon-materials.json', 'artifacts.json', 'skills.json', 'spell-tomes.json', 'smithing.json', 'loot-materials.json', 'faction-gear.json']) {
  try { fs.copyFileSync(path.join(SERVER, f), f); } catch (e) { /* optional */ }
}

// ---- fake plugin records: each plugin its own top byte ---------------------------------------------------------------
const PLUGINS = ['Skyrim.esm', 'GildForgottenArmoryCrude.esp', 'PigIronSet.esl', 'YokuWeapons.esp', 'DragonBreak Armory.esp', 'Black Bear Ancient Nord Armor.esp',
  'LEITEUHTThalmor.esp', 'Skaal Heavy Armor SE.esp', 'DragonBreak Nexus Patches.esp', 'DragonBreak Online Edits.esp', 'Apex_Khajiit.esp'];
const id = (plugin, local) => ((PLUGINS.indexOf(plugin) << 24) | local) >>> 0;
const descOf = (x) => `${(x & 0xffffff).toString(16)}:${PLUGINS[x >>> 24]}`;
const recs = new Map();
const u32 = (...ids) => { const b = new Uint8Array(ids.length * 4); const dv = new DataView(b.buffer); ids.forEach((v, i) => dv.setUint32(i * 4, v >>> 0, true)); return b; };
const rec = (x, type, editorId, fields = []) => recs.set(x >>> 0, { record: { type, editorId, fields }, toGlobalRecordId: (v) => v >>> 0 });
const SKY = (h) => id('Skyrim.esm', parseInt(h, 16));
const KW_FORGE = SKY('88105'), KW_TABLE = SKY('adb78'), KW_WHEEL = SKY('88108'), KW_ORC_ARMOR = SKY('6bbe5');
rec(KW_FORGE, 'KYWD', 'CraftingSmithingForge'); rec(KW_TABLE, 'KYWD', 'CraftingSmithingArmorTable'); rec(KW_WHEEL, 'KYWD', 'CraftingSmithingSharpeningWheel');
rec(KW_ORC_ARMOR, 'KYWD', 'ArmorMaterialOrcish');
const RACES = { nord: ['13746', 'NordRace'], orc: ['13747', 'OrcRace'], orcVamp: ['a82b9', 'OrcRaceVampire'], redguard: ['13748', 'RedguardRace'],
  breton: ['13741', 'BretonRace'], khajiit: ['13745', 'KhajiitRace'] };
const raceId = {};
for (const [k, [h, e]] of Object.entries(RACES)) { raceId[k] = SKY(h); rec(raceId[k], 'RACE', e); }
raceId.goblin = id('DragonBreak Online Edits.esp', 0x1b0001); rec(raceId.goblin, 'RACE', 'DBOGoblinRace');
raceId.goblinVamp = id('DragonBreak Online Edits.esp', 0x1b0002); rec(raceId.goblinVamp, 'RACE', 'DBOGoblinRaceVampire');

const item = (plugin, local, type, edid, kws = []) => { const x = id(plugin, local); rec(x, type, edid, kws.length ? [{ type: 'KWDA', data: u32(...kws) }] : []); return x; };
const recipe = (plugin, local, edid, bench) => { const x = id(plugin, local); rec(x, 'COBJ', edid, [{ type: 'BNAM', data: u32(bench) }]); return x; };
const GILD_AXE = item('GildForgottenArmoryCrude.esp', 0xd68, 'WEAP', 'GildCrudeAxe');
const R_GILD = recipe('GildForgottenArmoryCrude.esp', 0x900, '01RecipeWeaponGildCrudeAxe', KW_FORGE);
const R_GILD_TEMPER = recipe('GildForgottenArmoryCrude.esp', 0x901, '01TemperWeaponGildCrudeAxe', KW_WHEEL);
const PIG_CUIRASS = item('PigIronSet.esl', 0x801, 'ARMO', 'ArmorPigIronCuirass', [KW_ORC_ARMOR]);
const R_PIG = recipe('PigIronSet.esl', 0x810, 'RecipeArmorPigIronCuirass', KW_FORGE);
const YOKU_SHIELD = item('YokuWeapons.esp', 0x8a0, 'ARMO', '0_RaidShield', [KW_ORC_ARMOR]);
const R_YOKU = recipe('YokuWeapons.esp', 0x9a0, '0_RecipeRaidShield', KW_FORGE);
const R_YOKU_TEMPER = recipe('YokuWeapons.esp', 0x9a1, '0_TemperRaidShield', KW_TABLE);
const ADAM = item('DragonBreak Armory.esp', 0x82a, 'ARMO', 'DBOArm_AdamArmorAdamantiumCuirass');
const R_ADAM = recipe('DragonBreak Armory.esp', 0x836, 'DBOArm_AdamRecipeArmorAdamantiumCuirass', KW_FORGE);
const MANTIS = item('DragonBreak Armory.esp', 0x81d, 'ARMO', 'DBOArm_MantisArmorDwarvenAngelChassis');
const GOBLIN_ARMOUR = item('DragonBreak Armory.esp', 0x80c, 'ARMO', 'DBOArm_GoblinFurArmor1');
const R_GOBLIN_ARMOUR = recipe('DragonBreak Armory.esp', 0x80d, 'DBOArm_RecipeGoblinFurArmor1', KW_FORGE);
const BEAR_HOOD = item('Black Bear Ancient Nord Armor.esp', 0xd8d, 'ARMO', 'BlackBearAncientNordHoodLight');
const R_BEAR_HOOD = recipe('Black Bear Ancient Nord Armor.esp', 0xd99, 'RecipeBlackBearAncientNordHoodLight', KW_FORGE);
const BEAR_CUIRASS = item('Black Bear Ancient Nord Armor.esp', 0xd69, 'ARMO', 'BlackBearAncientNordCuirass');
const R_BEAR = recipe('Black Bear Ancient Nord Armor.esp', 0xd6d, 'RecipeBlackBearAncientNordCuirass', KW_FORGE);
const YOKU_STONE = item('YokuWeapons.esp', 0x827, 'ARMO', '0_StoneShield');
const R_YOKU_STONE = recipe('YokuWeapons.esp', 0x85a, '0_RecipeStoneShield', KW_FORGE);
const THALMOR = item('LEITEUHTThalmor.esp', 0x801, 'ARMO', 'LEITEUHTArmorThalmorJusticiar');
const R_THALMOR = recipe('LEITEUHTThalmor.esp', 0x807, 'LEITEUHTRecipeThalmorArmor', KW_FORGE);
const SKAAL = item('Skaal Heavy Armor SE.esp', 0x811, 'ARMO', 'DLC2ClothesSkaalHCoat');
const R_SKAAL = recipe('Skaal Heavy Armor SE.esp', 0x812, 'RecipeArmorSkaalHOutfit', KW_FORGE);
const R_SKAAL_TEMPER = recipe('Skaal Heavy Armor SE.esp', 0x8813, 'TemperArmorSkaalHOutfit', KW_TABLE);
const GOLD = SKY('5ad9e'); rec(GOLD, 'MISC', 'IngotGold');
const R_GOLD = recipe('DragonBreak Nexus Patches.esp', 0xb75, 'DBOSM_Res_GoldIngotDB', KW_FORGE);
const APEX_SWORD = item('Apex_Khajiit.esp', 0x80a, 'WEAP', 'KhajiitiSword');

const props = new Map(), said = [], audits = [], chain = [];
const SKYRIM_WORLD = '3c:Skyrim.esm';
const mp = {
  getIdFromDesc: (d) => { const [h, p] = String(d).split(':'); const i = PLUGINS.findIndex((x) => x.toLowerCase() === String(p).toLowerCase()); return i < 0 ? 0 : id(PLUGINS[i], parseInt(h, 16)); },
  getDescFromId: descOf, get: (x, p) => props.get(x + '|' + p), set: (x, p, v) => props.set(x + '|' + p, v),
  lookupEspmRecordById: (x) => recs.get(x >>> 0) || null, callPapyrusFunction: () => null,
};
const ACT = {}; let n = 0x101;
for (const r of ['nord', 'orc', 'orcVamp', 'redguard', 'breton', 'khajiit', 'goblin', 'goblinVamp', 'staff', 'nobody']) {
  ACT[r] = (0xff000000 | n++) >>> 0;
  if (raceId[r] || r === 'staff') props.set(ACT[r] + '|appearance', { raceId: raceId[r] || raceId.nord });
  props.set(ACT[r] + '|worldOrCellDesc', SKYRIM_WORLD); props.set(ACT[r] + '|pos', [0, 0, 0]);
}
const load = (cfgOver) => {
  delete globalThis.__dboPrevCraft; delete globalThis.__dboFactionCraft; delete globalThis.__dboSmithCraft; delete globalThis.__dboTailorCraft;
  mp.onCraft = (a, it, k, r) => { chain.push(r); return undefined; };
  const cfg = Object.assign({ regions: Object.assign({}, CONFIG.regions, { craft: true }), raceCraft: CONFIG.raceCraft }, cfgOver || {});
  require(path.join(SERVER, 'regions.js'))({
    mp, log: () => {}, personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), who: (a) => `P${(a >>> 0).toString(16)}`, cfg,
    registerChatCommand: () => {}, isAdmin: (a) => a === ACT.staff, sendPacket: () => true, openWidget: () => true, closeWidget: () => true,
    onUi: () => {}, onlineActors: () => [], every: () => {}, distanceMeters: () => 0, takeGold: () => false, giveItem: () => true, depositToTreasury: (z, k) => k,
  });
};
try { load(); } catch (e) { ok(false, 'regions.js loads', e.stack); process.exit(1); }
const craft = (who, it, r) => { chain.length = 0; said.length = 0; const v = mp.onCraft(ACT[who], it, 1, r); return v !== false && chain.includes(r); };

// ---- race locks ------------------------------------------------------------------------------------------------------
ok(!craft('nord', GILD_AXE, R_GILD), 'Gild crude: a Nord cannot forge it');
ok(said.some(([, t]) => /Goblin work/.test(t) && /materials come back/.test(t)), '...told it is Goblin work and the materials come back', said);
ok(audits.some((t) => /RACECRAFT refused/.test(t) && /NordRace/.test(t) && /gild/.test(t)), '...and audited with the race and the rule', audits.slice(-2));
ok(craft('goblin', GILD_AXE, R_GILD), 'Gild crude: a Goblin forges it');
ok(craft('goblinVamp', GILD_AXE, R_GILD), '...and a vampire Goblin (race prefix)');
ok(craft('nord', GILD_AXE, R_GILD_TEMPER), '...and anyone may sharpen one');
ok(craft('staff', GILD_AXE, R_GILD), '...staff pass (adminBypass)');
ok(!craft('nobody', GILD_AXE, R_GILD), '...a race that cannot be read is refused (fails closed)');
ok(!craft('nord', PIG_CUIRASS, R_PIG) && craft('orc', PIG_CUIRASS, R_PIG) && craft('orcVamp', PIG_CUIRASS, R_PIG), 'Pig Iron: Orcs (and vampire Orcs) only');
ok(craft('redguard', YOKU_SHIELD, R_YOKU), 'Yoku Raid Shield (Orcish keyword): a Redguard forges it, the set rule deciding before the Orcish rule');
ok(!craft('orc', YOKU_SHIELD, R_YOKU) && !craft('nord', YOKU_SHIELD, R_YOKU), '...an Orc and a Nord cannot');
ok(craft('nord', YOKU_SHIELD, R_YOKU_TEMPER), '...tempering it is open (no province gate on tempering either)');
ok(craft('nord', ADAM, R_ADAM) && craft('breton', ADAM, R_ADAM) && craft('orc', ADAM, R_ADAM), 'the Adamantium Addon is every race\'s (README 14: the Orc pair removed)');
ok(!craft('goblin', MANTIS, R_ADAM) && !craft('staff', MANTIS, R_ADAM), 'the Dwemer Mantis armour is never forged, staff included (forgeNever)');
ok(said.some(([, t]) => /Game Masters/.test(t)), '...and the smith hears the GMs give it out', said);
ok(!craft('nord', GOBLIN_ARMOUR, R_GOBLIN_ARMOUR) && craft('goblin', GOBLIN_ARMOUR, R_GOBLIN_ARMOUR), 'Armory goblin armour: Goblins only (edid rule)');
ok(craft('nord', BEAR_CUIRASS, R_BEAR), 'Black Bear: a Nord forges it in Skyrim');
ok(!craft('breton', BEAR_CUIRASS, R_BEAR), '...a Breton cannot');
ok(craft('nord', BEAR_HOOD, R_BEAR_HOOD) && !craft('breton', BEAR_HOOD, R_BEAR_HOOD), 'the Black Bear light hood is forgeable again (Armory v9 fe2eb7dd fixed its input), by Nords');
ok(!Object.keys(readJson('regions-overrides.json').recipes).some((k) => /^d9[79]:Black Bear/i.test(k)), '...and regions-overrides.json no longer refuses d99 / d97');
ok(!craft('nord', GOLD, R_GOLD), 'the bank-vault gold ingot never smelts to gold');
load({ raceCraft: { enabled: false } });
ok(craft('nord', GILD_AXE, R_GILD), 'raceCraft.enabled false turns the race rule off');
ok(!craft('nord', PIG_CUIRASS, R_PIG) && craft('orc', PIG_CUIRASS, R_PIG), '...and Pig Iron is still an Orc\'s through the Orcish rule (its keyword)');
load();

// ---- provinces: regions.json on the 140 order, the peoples' recipes it tags narrowly made common --------------------------
const R = globalThis.__dboRegions;
const where = (r, it) => R.recipeWhere(r, it);
const rp = readJson('regions-overrides.json').recipePlugins;
ok(Object.keys(rp).filter((k) => k[0] !== '_').length === 0, 'recipePlugins is empty: regions.json lists every Skyrim-release plugin', Object.keys(rp));
const ys = where(R_YOKU_STONE, YOKU_STONE);
ok(ys && ys.why === 'override' && ys.p.length === 3, 'Yoku Stone Shield (tagged Skyrim/Solstheim dwarven by its shape) is common by override', ys);
const yr = R.recipeOk(ACT.redguard, YOKU_STONE, R_YOKU_STONE);
props.set(ACT.redguard + '|worldOrCellDesc', 'a764b:BSHeartland.esm');
ok(yr.ok && R.recipeOk(ACT.redguard, YOKU_STONE, R_YOKU_STONE).ok, '...a Redguard makes it in Skyrim and in Bruma', yr);
props.set(ACT.redguard + '|worldOrCellDesc', SKYRIM_WORLD);
ok(where(R_YOKU_TEMPER, YOKU_SHIELD) === null, 'a tempering recipe with no regions entry has no province rule');
ok(where(R_BEAR, BEAR_CUIRASS).entry.bench === 'CraftingSmithingForge', 'the regions entry carries the bench');
ok(JSON.stringify(where(R_THALMOR, THALMOR).p) === '["cyrodiil","skyrim"]' && where(R_THALMOR, THALMOR).entry.c === 'summerset', 'Dominion Thalmor: summerset, made in Cyrodiil and Skyrim', where(R_THALMOR, THALMOR));
const ok1 = R.recipeOk(ACT.nord, SKAAL, R_SKAAL), ok2 = R.recipeOk(ACT.breton, SKAAL, R_SKAAL);
ok(ok1.ok && /race:nord/.test(ok1.why), 'Skaal heavy armour in Skyrim: a Nord makes it (raceStyles nord: skaal)', ok1);
ok(!ok2.ok, '...a Breton cannot (Solstheim work, Solstheim closed)', ok2);
ok(R.recipeOk(ACT.breton, SKAAL, R_SKAAL_TEMPER).why === 'unknown', '...its tempering is not gated');
const bb = R.recipeOk(ACT.nord, BEAR_CUIRASS, R_BEAR);
ok(bb.ok && bb.why === 'common', 'Black Bear (tagged Skyrim) is common by override: raceCraft keeps it to Nords', bb);
props.set(ACT.nord + '|worldOrCellDesc', 'a764b:BSHeartland.esm');
ok(craft('nord', BEAR_CUIRASS, R_BEAR) && craft('nord', BEAR_HOOD, R_BEAR_HOOD), '...and a Nord forges it in Bruma too');
ok(craft('nord', ADAM, R_ADAM) && craft('breton', ADAM, R_ADAM), 'the Adamantium Addon (tagged Skyrim) is forged anywhere by every race', R.recipeOk(ACT.breton, ADAM, R_ADAM));
props.set(ACT.goblin + '|worldOrCellDesc', SKYRIM_WORLD);
ok(craft('goblin', GOBLIN_ARMOUR, R_GOBLIN_ARMOUR), 'Armory goblin armour (tagged Cyrodiil) is forged by a Goblin in Skyrim');
props.set(ACT.nord + '|worldOrCellDesc', SKYRIM_WORLD);

// ---- the data -------------------------------------------------------------------------------------------------------
const rules = (CONFIG.raceCraft || {}).rules || [];
const rule = (rid) => rules.find((r) => r.id === rid) || {};
ok(JSON.stringify(rule('gild').races) === '["DBOGoblin"]' && JSON.stringify(rule('pigIron').races) === '["OrcRace"]', 'config: Gild crude Goblins, Pig Iron Orcs (Nate, 14 Oct)');
ok(!rules.some((r) => /Adam/i.test(JSON.stringify(r))), 'config: no rule names the Adamantium Addon (every race)');
for (const [rid, race] of [['yoku', 'RedguardRace'], ['apex', 'KhajiitRace'], ['lunarGuard', 'KhajiitRace'], ['blackBear', 'NordRace'], ['steelheart', 'NordRace'], ['ancientImperial', 'ImperialRace'],
  ['gryphonKnight', 'BretonRace'], ['knightErrant', 'BretonRace'], ['floraDruid', 'BretonRace'], ['seascale', 'MaormerRace']]) {
  ok((rule(rid).races || []).includes(race), `config: ${rid} is ${race}'s (Nat, 13 Oct)`);
}
const ovr = readJson('regions-overrides.json');
const mantis = Object.keys(ovr.forgeNever).filter((k) => /:DragonBreak Armory\.esp$/.test(k) && /^8(1d|1e|1f|20|21|22|23|24):/.test(k));
ok(mantis.length === 8, 'forgeNever lists the 8 Dwemer Mantis pieces (Armory 81D-824)', mantis);
const lm = readJson('loot-materials.json').items;
for (const [d, f] of [['8a0:yokuweapons.esp', null], ['823:yokuweapons.esp', 'EBONY'], ['80a:apex_khajiit.esp', 'apex_khajiit'], ['802:black bear ancient nord armor.esp', 'black_bear'],
  ['d68:gildforgottenarmorycrude.esp', 'goblin'], ['3:1ancientimperial.esp', 'ancient_imperial'], ['82a:dragonbreak armory.esp', 'adamantium'], ['801:pigironset.esl', 'orcish']]) {
  if (f) ok(lm[d] === f, `loot-materials: ${d} is ${f}`, lm[d]);
}
ok(Object.entries(lm).filter(([k, v]) => k.endsWith(':yokuweapons.esp') && v === 'orcish').length === 0, 'loot-materials: no Yoku piece is Orcish (the set wins over a borrowed keyword)');
const fams = new Map(readJson('smithing.json').families.map((f) => [f.id, f]));
for (const [f, race, tier] of [['yoku', 'RedguardRace', 3], ['black_bear', 'NordRace', 3], ['apex_khajiit', 'KhajiitRace', 4]]) {
  const x = fams.get(f) || {};
  ok(x.book === 'race' && (x.raceFree || []).includes(race) && x.tier === tier && !x.bookId, `smithing.json: ${f} T${tier}, known to ${race}, no book`, x);
}
const fg = readJson('faction-gear.json').items;
ok(['800:Civil War Battlemage Armors.esp', '804:Civil War Battlemage Armors.esp', '808:Civil War Battlemage Armors.esp'].map((k) => (fg[k] || {}).factions + '').join('|') === 'imperial-legion|stormcloaks|thalmor',
  'faction-gear: the Civil War battlemages are the Legion\'s, the Stormcloaks\' and the Thalmor\'s');
ok(Object.keys(fg).filter((k) => k.endsWith(':LEITEUHTThalmor.esp') && fg[k].factions.includes('thalmor')).length === 14, 'faction-gear: the 14 Dominion Thalmor pieces are the Thalmor\'s');

// ---- smithing.js: a people's own family -----------------------------------------------------------------------------
fs.writeFileSync('loot-materials.json', JSON.stringify({ items: { '800:black bear ancient nord armor.esp': 'black_bear' } }));
fs.writeFileSync('faction-gear.json', JSON.stringify({ items: {} }));
const told = [], timers = [];
const realSetInterval = global.setInterval;
global.setInterval = (fn) => { timers.push(fn); return 0; };
props.set(ACT.nord + '|private.mastery', { order: ['blacksmith'], skills: { blacksmith: { level: 50 } } });
props.set(ACT.breton + '|private.mastery', { order: ['blacksmith'], skills: { blacksmith: { level: 100 } } });
mp.getEspmRecordIdsByType = () => [];
require(path.join(SERVER, 'smithing.js'))({ mp, log: () => {}, personal: (a, t) => told.push([a, t]), audit: () => {}, who: (a) => `P${a}`, cfg: { smithing: { enabled: true } },
  registerChatCommand: () => {}, onlineActors: () => [ACT.nord, ACT.breton], findByName: () => 0, isAdmin: () => false, sendPacket: () => true, itemName: () => '' });
global.setInterval = realSetInterval;
const bearId = mp.getIdFromDesc('800:Black Bear Ancient Nord Armor.esp');
ok(globalThis.__dboSmithCraft(ACT.nord, bearId, R_BEAR) === true, 'smithing: a Nord at craft tier 4 works Black Bear (known by birth)');
ok(globalThis.__dboSmithCraft(ACT.breton, bearId, R_BEAR) === false, 'smithing: a Breton is not taught it, not even beside a Nord smith (no apprenticeship)');
ok(told.some(([, t]) => /Nord craft/.test(t)), '...and hears whose craft it is', told);
globalThis.__dboSmithCarryOver(ACT.breton);
ok(!((props.get(ACT.breton + '|private.dboManuals') || {}).black_bear), 'smithing carry-over never hands out a people\'s own family');
const view = globalThis.__dboSmithView(ACT.breton);
const vb = view && view.families.find((f) => f.id === 'black_bear');
ok(vb && !vb.known && /Nord craft/.test(vb.learnHint), 'the F3 Blacksmith tab says whose craft it is', vb);

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
