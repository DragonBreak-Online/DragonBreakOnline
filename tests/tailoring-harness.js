// The Tailor's ranks gate what a loom makes (tailoring.js; Nate, 12 Oct). Loads the real module against a stub mp with
// a loom recipe for each tier, and checks regions.js and gamemode.js call it. Run from server\:  node tests/tailoring-harness.js
'use strict';
const path = require('path');
const fs = require('fs');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, name, got) => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); };

const u32 = (x) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, x, true); return b; };
const recs = new Map();
const rec = (id, type, editorId, fields = []) => recs.set(id >>> 0, { record: { type, editorId, fields }, toGlobalRecordId: (x) => x >>> 0 });
const LOOM = 0xa001, FORGE = 0xa002;
rec(LOOM, 'KYWD', 'MCE_CraftingLoom'); rec(FORGE, 'KYWD', 'CraftingSmithingForge');
// Items by value: 2 (Common), 30 (Fine), 100 (Noble), 300 (Scaled), 2000 (Masterwork)
const ITEMS = { 2: 0xb001, 30: 0xb002, 100: 0xb003, 300: 0xb004, 2000: 0xb005 };
for (const [v, id] of Object.entries(ITEMS)) { rec(id, 'ARMO', `Item${v}`, [{ type: 'DATA', data: u32(Number(v)) }]); rec(id + 0x1000, 'COBJ', `Recipe${v}`, [{ type: 'CNAM', data: u32(id) }, { type: 'BNAM', data: u32(LOOM) }]); }
rec(0xc001, 'COBJ', 'ForgeRecipe', [{ type: 'CNAM', data: u32(ITEMS[2000]) }, { type: 'BNAM', data: u32(FORGE) }]);
const props = new Map();
const descs = new Map();           // item id -> "local:plugin.esp", for the named list
const mp = { get: (id, k) => props.get(`${id}|${k}`), lookupEspmRecordById: (id) => recs.get(id >>> 0) || { record: null },
  getDescFromId: (id) => descs.get(id >>> 0) || '' };
const told = [], audits = [], cmds = new Map();
const A = 0x14, STAFF = 0x15;
const tailor = (a, rank) => props.set(`${a}|private.mastery`, rank === null ? { order: ['blacksmith'], skills: {} } : { order: ['tailor'], skills: { tailor: { rank, level: rank * 25 } } });
const load = (cfg) => {
  for (const k of Object.keys(globalThis)) if (/^__dboTailor/.test(k)) delete globalThis[k];
  delete require.cache[path.join(SERVER, 'tailoring.js')];
  require(path.join(SERVER, 'tailoring.js'))({ mp, log: () => {}, personal: (a, t) => told.push([a, t]), audit: (t) => audits.push(t), who: (a) => `#${a}`, cfg: cfg || {}, isAdmin: (a) => a === STAFF, sendPacket: () => true, registerChatCommand: (n, fn) => cmds.set(n, fn) });
};
const craft = (a, v, recipe) => globalThis.__dboTailorCraft(a, ITEMS[v], recipe || ITEMS[v] + 0x1000);
const last = () => (told.length ? told[told.length - 1][1] : '');
load();
const cfgLive = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8')).tailoring;
ok(cfgLive && cfgLive.enabled === true && cfgLive.tierValueCap.join() === '15,50,150,400,1000000000', 'gamemode-config: tailoring on, caps 15/50/150/400', cfgLive);
load({ tailoring: cfgLive });
tailor(A, 0);
ok(craft(A, 2) === true, 'a Novice Tailor makes Common clothes');
ok(craft(A, 30) === false && /Fine clothes are Apprentice Tailor's work; you are a Novice Tailor/.test(last()), 'a Novice is refused Fine clothes, and told', last());
ok(craft(A, 100) === false && audits.some((t) => /TAILOR craft refused #20 at Tailor tier 1: recipe b003/.test(t) || /TAILOR craft refused/.test(t)), '...and Noble, audited');
tailor(A, 1); told.length = 0;
ok(craft(A, 30) === true && craft(A, 100) === false, 'an Apprentice makes Fine, not Noble');
tailor(A, 2);
ok(craft(A, 100) === true && craft(A, 300) === false, 'an Adept makes Noble, not Scaled');
tailor(A, 3);
ok(craft(A, 300) === true && craft(A, 2000) === false, 'an Expert makes Scaled, not Masterwork');
tailor(A, 4);
ok(craft(A, 2000) === true, 'a Master makes Masterwork');
tailor(A, null); globalThis.__dboTailorState.told.clear();
ok(craft(A, 30) === false && /you have not taken up the Tailor/.test(last()), 'no Tailor skill: Fine refused', last());
ok(globalThis.__dboTailorCraft(A, ITEMS[2000], 0xc001) === true, 'a forge recipe is not the loom\'s business');
ok(globalThis.__dboTailorCraft(STAFF, ITEMS[2000], ITEMS[2000] + 0x1000) === true, 'staff pass');
cmds.get('tailoring')(STAFF, 'test');
ok(globalThis.__dboTailorCraft(STAFF, ITEMS[2000], ITEMS[2000] + 0x1000) === false, '...unless /tailoring test');
globalThis.__dboFactionGearMember = (a, item) => a === A && item === ITEMS[2000];
ok(craft(A, 2000) === true, 'a faction\'s own tailor makes its gear (factiongear.js decides)');
delete globalThis.__dboFactionGearMember;
load({ tailoring: Object.assign({}, cfgLive, { enabled: false }) });
ok(craft(A, 2000) === true, 'enabled false: every loom recipe as before');
const regions = fs.readFileSync(path.join(SERVER, 'regions.js'), 'utf8'), gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
ok(/__dboSmithCraft\(actorId, itemId, recipeId\) === false\) return false;\n[^\n]*\n\s+if \(typeof globalThis\.__dboTailorCraft === 'function' && globalThis\.__dboTailorCraft\(actorId, itemId, recipeId\) === false\) return false;/.test(regions), 'regions.js asks the tailor gate right after the smithing gate');
ok(/require\(TAILORING_JS\)\(\{ mp, log, personal, audit, who, cfg, isAdmin, sendPacket, registerChatCommand \}\)/.test(gm), 'gamemode.js loads tailoring.js');

// ---- the curated list (Nate, 14 Oct: the tailoring spec) --------------------------------------------------------
// The whole point: a name beats the price. Emperor's Robes are tier 5 whatever the stub says they are worth.
load({ tailoring: cfgLive });
const NAMED = 0xb900;
rec(NAMED, 'ARMO', 'NamedItem', [{ type: 'DATA', data: u32(2) }]);                     // value 2 = tier 1 by price
rec(NAMED + 0x1000, 'COBJ', 'NamedRecipe', [{ type: 'CNAM', data: u32(NAMED) }, { type: 'BNAM', data: u32(LOOM) }]);
descs.set(NAMED, "15516:Skyrim.esm");                                                  // Emperor's Robes
tailor(A, 0);                                                                          // a Novice Tailor
ok(globalThis.__dboTailorCraft(A, NAMED, NAMED + 0x1000) === false, 'a Master robe is Master work even at a beggar\'s price');
ok(/by name/.test(audits[audits.length - 1] || ''), '...and the audit says the name decided it', audits[audits.length - 1]);
tailor(A, 4);                                                                          // a Master Tailor
ok(globalThis.__dboTailorCraft(A, NAMED, NAMED + 0x1000) === true, '...and a Master Tailor makes it');

// An item the list does not name keeps the old rule, so a partial list never opens the loom
descs.set(ITEMS[2000], 'ffffff:NotInTheList.esp');
tailor(A, 0);
ok(craft(A, 2000) === false, 'an unlisted item is still placed by its value');
ok(/by value 2000/.test(audits[audits.length - 1] || ''), '...and the audit says so', audits[audits.length - 1]);

// The shipped list itself
const LIST = JSON.parse(fs.readFileSync(path.join(SERVER, 'tailoring-tiers.json'), 'utf8'));
const byName = (n) => Object.values(LIST.items).filter((v) => v.name === n).map((v) => v.tier);
ok(Object.keys(LIST.items).length > 200, 'the list covers most of the loom', Object.keys(LIST.items).length);
ok(byName("Emperor's Robes").every((t) => t === 5), "Emperor's Robes are Master work", byName("Emperor's Robes"));
ok(byName('Ragged Robes').every((t) => t === 1), 'rags are Novice work');
ok(byName('Sturdy Pouch (Left)').every((t) => t === 2), 'a pouch is Apprentice work');
ok(byName('Patchwork Satchel').every((t) => t === 3), 'a satchel is Adept work');
ok(byName('Reinforced Backpack').every((t) => t === 4), 'a backpack is Expert work');
ok(Object.values(LIST.items).every((v) => v.tier >= 1 && v.tier <= 5 && v.name), 'every entry has a tier of 1..5 and a name');
ok(Object.keys(LIST.items).every((d) => d === d.toLowerCase()), 'every key is lowercase, as descOf gives it');

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
