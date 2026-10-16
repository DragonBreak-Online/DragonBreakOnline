// Ancient Imperial armour is schematic learning only (Nate, 16 Oct). 1AncientImperial.esp's pieces were the Imperials'
// own (config raceCraft, Nat's race-only list of 13 Oct); now any smith of craft tier 2 who has read Schematics: Ancient
// Imperial (DragonBreak Online Edits.esp 192E60, smithing.json family ancient_imperial) forges them, and nobody else:
// the family is held, so no Blacksmith teaches it at the forge, and an Imperial needs the book like everyone. The book is
// found as before: reading in Cyrodiil's forts, or very rarely in their chests (config smithing.discovery / drops, fort).
// Loads the real regions.js, manuals.js and smithing.js with the real config, smithing.json and loot-materials.json,
// against fake plugin records shaped like 1AncientImperial.esp's (8 forge recipes, light to heavy and back; tempering at
// the armour table).
//   node tests/ancient-imperial-schematic-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 400)}`); if (!c) fails++; };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(SERVER, f), 'utf8'));
const CONFIG = readJson('gamemode-config.json');

const scratch = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-ancimp-'));
process.on('exit', () => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
process.chdir(scratch);
for (const f of ['regions.json', 'regions-overrides.json', 'dragon-materials.json', 'artifacts.json', 'skills.json', 'smithing.json', 'loot-materials.json', 'faction-gear.json']) {
  try { fs.copyFileSync(path.join(SERVER, f), f); } catch (e) { /* optional */ }
}
fs.writeFileSync('manuals.json', JSON.stringify({ manuals: [] }));

// ---- the data ---------------------------------------------------------------------------------------------------------
const FAM = readJson('smithing.json').families.find((f) => f.id === 'ancient_imperial') || {};
ok(FAM.tier === 2 && FAM.held === true && !FAM.raceFree && !FAM.book && FAM.bookId === '192e60:DragonBreak Online Edits.esp',
  'smithing.json: Ancient Imperial is a held craft tier 2 technique with its own schematic (192E60), no people knows it by birth', FAM);
const rules = (CONFIG.raceCraft || {}).rules || [];
ok(!rules.some((r) => (r.plugins || []).some((p) => /^1AncientImperial\.esp$/i.test(p)) || /ancientImperial/i.test(r.id || '')), 'config raceCraft: no rule for 1AncientImperial.esp');
const LM = readJson('loot-materials.json').items;
const AI_ITEMS = Object.keys(LM).filter((k) => k.endsWith(':1ancientimperial.esp'));
ok(AI_ITEMS.length === 10 && AI_ITEMS.every((k) => LM[k] === 'ancient_imperial'), 'loot-materials: the 10 pieces of 1AncientImperial.esp (9 armour, the sword) are all ancient_imperial', AI_ITEMS.map((k) => [k, LM[k]]));
const SM = CONFIG.smithing || {};
const fortDrops = Object.values((SM.drops || {}).fort || {}).flat();
ok(fortDrops.length === 4 && fortDrops.every((r) => (r.families || []).includes('ancient_imperial') && r.chance > 0), 'config: every fort difficulty can drop the schematic', fortDrops);
const fortRead = ((SM.discovery || {}).rows || []).find((r) => r.where === 'fort');
ok(!!fortRead && fortRead.families.includes('ancient_imperial') && fortRead.chance > 0, 'config: reading in a fort can find it', fortRead);
const shop = ((CONFIG.manuals || {}).smithShop || {}).families || ['steel'];
ok(!shop.includes('ancient_imperial'), 'no blacksmith\'s ledger sells it (found in forts, as before)', shop);
const regionsJson = readJson('regions.json');
const forgeRecipes = Object.entries(regionsJson.recipes || regionsJson).filter(([k, v]) => /:1AncientImperial\.esp$/.test(k) && v && v.bench === 'CraftingSmithingForge');
ok(forgeRecipes.length === 8 && forgeRecipes.every(([, v]) => v.p === 'common'), 'regions.json: the 8 forge recipes are common (no province gate)', forgeRecipes.map(([k, v]) => [k, v.p]));

// ---- fake plugin records ----------------------------------------------------------------------------------------------
const PLUGINS = ['Skyrim.esm', '1AncientImperial.esp', 'DragonBreak Online Edits.esp'];
const id = (plugin, local) => ((PLUGINS.indexOf(plugin) << 24) | local) >>> 0;
const descOf = (x) => `${(x & 0xffffff).toString(16)}:${PLUGINS[x >>> 24]}`;
const recs = new Map();
const u32 = (...ids) => { const b = new Uint8Array(ids.length * 4); const dv = new DataView(b.buffer); ids.forEach((v, i) => dv.setUint32(i * 4, v >>> 0, true)); return b; };
const rec = (x, type, editorId, fields = []) => recs.set(x >>> 0, { record: { type, editorId, fields }, toGlobalRecordId: (v) => v >>> 0 });
const SKY = (h) => id('Skyrim.esm', parseInt(h, 16));
const KW_FORGE = SKY('88105'), KW_TABLE = SKY('adb78');
rec(KW_FORGE, 'KYWD', 'CraftingSmithingForge'); rec(KW_TABLE, 'KYWD', 'CraftingSmithingArmorTable');
const RACES = { imperial: ['13744', 'ImperialRace'], nord: ['13746', 'NordRace'], breton: ['13741', 'BretonRace'] };
const raceId = {};
for (const [k, [h, e]] of Object.entries(RACES)) { raceId[k] = SKY(h); rec(raceId[k], 'RACE', e); }
const AI = (h) => id('1AncientImperial.esp', parseInt(h, 16));
const item = (x, edid) => { rec(x, 'ARMO', edid); return x; };
const recipe = (x, edid, bench, product) => { rec(x, 'COBJ', edid, [{ type: 'CNAM', data: u32(product) }, { type: 'BNAM', data: u32(bench) }]); return x; };
const HEAVY = item(AI('3'), '1AnImCuirassHeavy'), LIGHT = item(AI('7'), '1AnImCuirassLight');
const R_HEAVY = recipe(AI('16'), '1AnImRecipeArmorIronCuirassHeavy', KW_FORGE, HEAVY);
const R_LIGHT = recipe(AI('17'), '1AnImRecipeArmorIronCuirassLight', KW_FORGE, LIGHT);
const R_TEMPER = recipe(AI('d'), '1AnImTemperCuirassHeavy', KW_TABLE, HEAVY);
const BOOK = id('DragonBreak Online Edits.esp', 0x192e60);
{ const d = new Uint8Array(16); new DataView(d.buffer).setUint32(8, 300, true); rec(BOOK, 'BOOK', 'DBO_Schematics_ancient_imperial', [{ type: 'DATA', data: d }]); }

const props = new Map(), said = [], audits = [], chain = [];
const BRUMA = 'a764b:BSHeartland.esm';
const mp = {
  getIdFromDesc: (d) => { const [h, p] = String(d).split(':'); const i = PLUGINS.findIndex((x) => x.toLowerCase() === String(p).toLowerCase()); return i < 0 ? 0 : id(PLUGINS[i], parseInt(h, 16)); },
  getDescFromId: descOf, get: (x, p) => props.get((x >>> 0) + '|' + p), set: (x, p, v) => props.set((x >>> 0) + '|' + p, v),
  lookupEspmRecordById: (x) => recs.get(x >>> 0) || null, callPapyrusFunction: () => null,
};
const ACT = {}; let n = 0x101;
const smith = (a, points) => props.set(a + '|private.mastery', { order: ['blacksmith'], skills: { blacksmith: { level: points, rank: 0 } } });
for (const [who, race] of [['imperial', 'imperial'], ['nord', 'nord'], ['breton', 'breton'], ['sup', 'imperial'], ['novice', 'nord']]) {
  ACT[who] = (0xff000000 | n++) >>> 0;
  props.set(ACT[who] + '|appearance', { raceId: raceId[race] }); props.set(ACT[who] + '|profileId', n);
  props.set(ACT[who] + '|worldOrCellDesc', BRUMA); props.set(ACT[who] + '|pos', [0, 0, 0]);
  props.set(ACT[who] + '|inventory', { entries: [] }); props.set(ACT[who] + '|private.dboManuals', {});
  smith(ACT[who], 35);
}
smith(ACT.novice, 5);
smith(ACT.sup, 90); props.set(ACT.sup + '|private.dboManuals', { ancient_imperial: { at: 1, how: 'book' } });
global.setTimeout = () => 0;
const api = {
  mp, log: () => {}, personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), who: (a) => `P${(a >>> 0).toString(16)}`, display: (a) => `P${(a >>> 0).toString(16)}`,
  cfg: { smithing: Object.assign({}, CONFIG.smithing, { enabled: true }), manuals: CONFIG.manuals, regions: Object.assign({}, CONFIG.regions, { craft: true }), raceCraft: CONFIG.raceCraft },
  registerChatCommand: () => {}, isAdmin: () => false, sendPacket: () => true, openWidget: () => true, closeWidget: () => true, onUi: () => {},
  onlineActors: () => Object.values(ACT), every: () => {}, distanceMeters: () => 0, takeGold: () => true, giveItem: () => true, depositToTreasury: (z, k) => k,
  findByName: () => 0, itemName: () => '', notify: () => {},
};
for (const k of Object.keys(globalThis)) if (/^__dbo(Smith|Manuals|TemperCap|TechniqueDrop|PrevCraft|FactionCraft|TailorCraft|Regions)/.test(k)) delete globalThis[k];
mp.onCraft = (a, it, k, r) => { chain.push(r); return undefined; };
require(path.join(SERVER, 'manuals.js'))(api);
require(path.join(SERVER, 'smithing.js'))(api);
require(path.join(SERVER, 'regions.js'))(api);
const craft = (who, it, r) => { chain.length = 0; said.length = 0; if (globalThis.__dboSmithState) globalThis.__dboSmithState.told.clear(); const v = mp.onCraft(ACT[who], it, 1, r); return v !== false && chain.includes(r); };
const lastSaid = (who) => { const s = said.filter(([a]) => a === ACT[who]); return s.length ? s[s.length - 1][1] : ''; };

// ---- no people's own any more -----------------------------------------------------------------------------------------
ok(globalThis.__dboRegions.raceCraftVerdict(ACT.breton, HEAVY, R_HEAVY) === null, 'regions.js: no race rule decides 1AncientImperial.esp pieces');
ok(!craft('imperial', HEAVY, R_HEAVY), 'an Imperial smith without the schematic cannot forge it (no longer known by birth)');
const told = lastSaid('imperial');
ok(/Ancient Imperial/.test(told) && /Schematics: Ancient Imperial/.test(told) && /No smith teaches it at the forge/.test(told) && !/Imperial work/.test(told) && /materials come back/.test(told),
  '...told the schematic is the way, no smith teaches it, the materials come back', told);
ok(!craft('breton', LIGHT, R_LIGHT) && !/Imperial work/.test(lastSaid('breton')) && /Schematics: Ancient Imperial/.test(lastSaid('breton')), 'a Breton without it: refused with the same hint, not the old "Imperial work" line', lastSaid('breton'));

// ---- the held technique: no apprenticeship ----------------------------------------------------------------------------
ok(!craft('nord', HEAVY, R_HEAVY), 'a Nord beside an Imperial Blacksmith 90 who knows it is still refused: held, no apprenticeship');
ok(!props.get(ACT.nord + '|private.dboSmithApprentice'), '...and no apprenticeship count starts');

// ---- the schematic teaches anyone ----------------------------------------------------------------------------------
ok(globalThis.__dboManualsRead(ACT.novice, BOOK) === false && !(props.get(ACT.novice + '|private.dboManuals') || {}).ancient_imperial, 'a craft tier 1 smith cannot follow the schematic yet and keeps it', lastSaid('novice'));
ok(globalThis.__dboManualsRead(ACT.nord, BOOK) !== false && !!(props.get(ACT.nord + '|private.dboManuals') || {}).ancient_imperial, 'a Nord smith at craft tier 3 reads it and learns Ancient Imperial', props.get(ACT.nord + '|private.dboManuals'));
ok(craft('nord', HEAVY, R_HEAVY) && craft('nord', LIGHT, R_LIGHT), '...and forges both the heavy and the light cuirass');
ok(globalThis.__dboManualsRead(ACT.imperial, BOOK) !== false && craft('imperial', HEAVY, R_HEAVY), 'an Imperial who reads it forges it too');
ok(audits.some((t) => /MANUAL .* learned Ancient Imperial/.test(t)), '...each learning audited', audits.filter((t) => /MANUAL/.test(t)));
ok(craft('breton', HEAVY, R_TEMPER), 'tempering at the armour table stays open to anyone');
// A Scholar cannot copy a held schematic at the ledger, like Glass and Mithril (its rarity is the point)
props.set(ACT.nord + '|private.mastery', { order: ['blacksmith', 'scholar'], skills: { blacksmith: { level: 35, rank: 0 }, scholar: { level: 100, rank: 4 } } });
ok(typeof globalThis.__dboManualsCopyList === 'function' && !globalThis.__dboManualsCopyList(ACT.nord).some((m) => m.bookId === BOOK), 'a Master Scholar who learned it cannot copy it (held)');
// The F3 Blacksmith tab says the same
const view = globalThis.__dboSmithView(ACT.breton).families.find((f) => f.id === 'ancient_imperial');
ok(view && !view.known && /Schematics: Ancient Imperial/.test(view.learnHint) && /No smith teaches it/.test(view.learnHint), 'the F3 Blacksmith tab: not known, learned from the schematic only', view);

// Control: the same table without held lets the supervised Breton on (the apprenticeship the held flag closes)
{
  const t = JSON.parse(fs.readFileSync('smithing.json', 'utf8')); t.families.forEach((f) => { if (f.id === 'ancient_imperial') delete f.held; }); fs.writeFileSync('smithing.json', JSON.stringify(t));
  for (const k of Object.keys(globalThis)) if (/^__dbo(Smith|Manuals|TemperCap|TechniqueDrop)/.test(k)) delete globalThis[k];
  delete require.cache[path.join(SERVER, 'manuals.js')]; delete require.cache[path.join(SERVER, 'smithing.js')];
  require(path.join(SERVER, 'manuals.js'))(api); require(path.join(SERVER, 'smithing.js'))(api);
  ok(craft('breton', HEAVY, R_HEAVY) && /Apprenticed in Ancient Imperial/.test(lastSaid('breton')), 'control: without held, a Breton beside a Blacksmith who knows it forges as an apprentice', lastSaid('breton'));
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
