// loomweave.js (loom recipes the server weaves from loom-recipes.private.json) and its rows in salvage.js's loom panel,
// against a stub mp in a scratch directory. The recipes here are synthetic: no private mod's ids are in this file.
// node tests/loomweave-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const WEAVE = path.resolve(__dirname, '..', 'loomweave.js');
const SALVAGE = path.resolve(__dirname, '..', 'salvage.js');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-loomweave-'));
process.chdir(scratch);

const TUNIC = 0x7001, ROBE = 0x7002, LEATHER = 0xdb5d2, THREAD = 0x7003, SWORD = 0x12eb7;
const LOOM = 0x9004, LOOM_BASE = 0x9005, SMELTER = 0x9000, SMELTER_BASE = 0x9001;
const ORC = 0xff000001, ORC_VAMP = 0xff000002, NORD = 0xff000003, ORC_COOK = 0xff000004, STAFF_NORD = 0xff000005, STAFF_ORC = 0xff000006;
const desc = (id) => `${id.toString(16)}:Skyrim.esm`;
const fromDesc = (d) => parseInt(String(d).split(':')[0], 16) >>> 0;
const NAMES = { [TUNIC]: 'Plain Tunic', [ROBE]: 'Fine Robe', [LEATHER]: 'Leather', [THREAD]: 'Thread', [SWORD]: 'Iron Sword' };
const RACE = { [ORC]: 'OrcRace', [ORC_VAMP]: 'OrcRaceVampire', [NORD]: 'NordRace', [ORC_COOK]: 'OrcRace', [STAFF_NORD]: 'NordRace', [STAFF_ORC]: 'OrcRace' };
const STAFF = new Set([STAFF_NORD, STAFF_ORC]);
const kwda = (...ids) => { const d = new Uint8Array(ids.length * 4); ids.forEach((id, i) => new DataView(d.buffer).setUint32(i * 4, id, true)); return { type: 'KWDA', data: d }; };
const RECS = {
  [LOOM_BASE]: { type: 'FURN', fields: [kwda(0x8004, 0x8005)] }, [SMELTER_BASE]: { type: 'FURN', fields: [kwda(0x8001)] },
  0x8001: { type: 'KYWD', editorId: 'CraftingSmelter', fields: [] }, 0x8004: { type: 'KYWD', editorId: 'isTanning', fields: [] }, 0x8005: { type: 'KYWD', editorId: 'MCE_CraftingLoom', fields: [] },
};
const BASE = { [LOOM]: LOOM_BASE, [SMELTER]: SMELTER_BASE };
const RECIPES = { recipes: [
  { product: desc(TUNIC), materials: [[desc(LEATHER), 1], [desc(THREAD), 3]], races: ['OrcRace'], people: 'Orcish' },
  { product: desc(ROBE), materials: [[desc(THREAD), 2]], races: ['OrcRace'], people: 'Orcish', tier: 3 },
] };

let INV, MAST, FAR, AWARDS;
const said = [], widgets = [], ui = {}, logs = [];
const tailor = (rank) => ({ order: ['tailor'], skills: { tailor: { rank } } });
const reset = () => {
  INV = { [ORC]: [], [ORC_VAMP]: [], [NORD]: [], [ORC_COOK]: [], [STAFF_NORD]: [], [STAFF_ORC]: [] };
  MAST = { [ORC]: tailor(0), [ORC_VAMP]: tailor(0), [NORD]: tailor(4), [ORC_COOK]: { order: ['cook'], skills: { cook: { rank: 2 } } }, [STAFF_NORD]: tailor(0), [STAFF_ORC]: tailor(0) };
  said.length = 0; widgets.length = 0; logs.length = 0; FAR = false; AWARDS = [];
  globalThis.__dboSalvage = undefined;
  globalThis.__dboTailorTierOf = (id) => (id === TUNIC ? 1 : 5);
  globalThis.__alduinakMasteryAward = (a, skill, w, key) => { AWARDS.push([a, skill, w, key]); return 2; };
};
const mp = {
  get: (id, k) => (k === 'inventory' ? { entries: INV[id] } : k === 'baseDesc' && BASE[id] ? desc(BASE[id]) : null),
  set: (id, k, v) => { if (k === 'inventory') INV[id] = v.entries; },
  getDescFromId: desc, getIdFromDesc: fromDesc,
};
const count = (a, id) => INV[a].filter((e) => e.baseId === id).reduce((n, e) => n + e.count, 0);
const api = {
  mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push([a, t]), who: String, cfg: {}, isAdmin: (a) => STAFF.has(a),
  openWidget: (a, w) => widgets.push([a, w]), closeWidget: (a) => widgets.push([a, null]),
  onUi: (n, f) => { (ui[n] = ui[n] || []).push(f); }, masteryOf: (a) => MAST[a] || null, raceEdidOf: (a) => RACE[a] || '',
  recordOf: (id) => (RECS[id] ? { record: RECS[id], toGlobalRecordId: (l) => l } : null),
  fieldsOf: (lr, t) => ((lr && lr.record.fields) || []).filter((f) => f.type === t),
  giveItem: (a, id, n) => { const e = INV[a].find((x) => x.baseId === id && !x.worn); if (e) e.count += n; else INV[a].push({ baseId: id, count: n }); return true; },
  itemName: (d) => NAMES[fromDesc(d)] || '', distanceMeters: () => (FAR ? 20 : 1),
};
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!c) fails++; };
const load = () => { for (const k of Object.keys(ui)) delete ui[k]; delete require.cache[WEAVE]; delete require.cache[SALVAGE]; const W = require(WEAVE)(api); require(SALVAGE)(api); return W; };
const choose = (a, id) => (ui.salvageChoose || []).forEach((f) => f(a, [id]));
const lastWidget = (a) => { for (let i = widgets.length - 1; i >= 0; i--) if (widgets[i][0] === a) return widgets[i][1]; return undefined; };
const ids = (rows) => rows.map((r) => r.id);
// Row ids carry the product's desc in lower case
const KEY_TUNIC = `weave:${desc(TUNIC).toLowerCase()}`, KEY_ROBE = `weave:${desc(ROBE).toLowerCase()}`;

// No sidecar: no rows, one line, and the loom works as usual
reset();
if (fs.existsSync('loom-recipes.private.json')) fs.unlinkSync('loom-recipes.private.json');
let W = load();
ok(W.rows(ORC).length === 0 && logs.filter((l) => /loom-recipes\.private\.json missing/.test(l)).length === 1, 'without the sidecar there are no rows, and one line says so', logs);
W.rows(ORC); W.rows(ORC);
ok(logs.filter((l) => /missing/.test(l)).length === 1, '...said once, not on every look');
ok(globalThis.__dboSalvageActivate(LOOM, ORC) === false, '...and an Orc tailor carrying nothing breakable just uses the loom');

fs.writeFileSync('loom-recipes.private.json', JSON.stringify(RECIPES));
reset(); W = load();
ok(logs.some((l) => /2 loom recipe\(s\)/.test(l)), 'the sidecar is read: two recipes', logs);

// Who sees what
ok(JSON.stringify(ids(W.rows(ORC))) === JSON.stringify([KEY_TUNIC]), 'a Novice Orc tailor sees the Common garment, not the Adept one', ids(W.rows(ORC)));
ok(ids(W.rows(ORC_VAMP)).includes(KEY_TUNIC), 'an Orc vampire counts as an Orc (race prefix)');
ok(W.rows(NORD).length === 0, 'a Master tailor of another race sees none');
ok(W.rows(ORC_COOK).length === 0, 'an Orc who has not taken up the Tailor sees none');
ok(W.rows(STAFF_NORD).length === 0, 'staff skip the tier but not the race, so a Nord staff member\'s loom opens as usual');
ok(JSON.stringify(ids(W.rows(STAFF_ORC))) === JSON.stringify([KEY_TUNIC, KEY_ROBE]), 'an Orc staff member sees both, tier skipped', ids(W.rows(STAFF_ORC)));
MAST[ORC] = tailor(2);
ok(ids(W.rows(ORC)).includes(KEY_ROBE), 'an Adept Orc tailor sees the Adept garment');
MAST[ORC] = tailor(0);
ok(/^Weave Plain Tunic: 1 Leather, 3 Thread \(missing materials\)$/.test(W.rows(ORC)[0].label), 'the row names the garment and its materials, and says when some are missing', W.rows(ORC)[0].label);

// Weaving
let r = W.weave(ORC, desc(TUNIC));
ok(!r.ok && /short of Leather and Thread/.test(r.text) && INV[ORC].length === 0, 'with no materials it refuses and takes nothing', r);
INV[ORC] = [{ baseId: LEATHER, count: 1, worn: true }, { baseId: THREAD, count: 3 }];
r = W.weave(ORC, desc(TUNIC));
ok(!r.ok && /short of Leather\.$/.test(r.text) && count(ORC, THREAD) === 3 && count(ORC, LEATHER) === 1, 'a worn stack does not count, and nothing is taken when short', r);
INV[ORC] = [{ baseId: LEATHER, count: 1 }, { baseId: THREAD, count: 2 }, { baseId: THREAD, count: 5, name: 'Golden Thread' }];
r = W.weave(ORC, desc(TUNIC));
ok(!r.ok && /short of Thread\.$/.test(r.text) && count(ORC, THREAD) === 7, 'nor a named one', r);
INV[ORC] = [{ baseId: LEATHER, count: 1, enchantmentEffects: [{ effectId: 1, magnitude: 5 }] }, { baseId: THREAD, count: 3 }];
r = W.weave(ORC, desc(TUNIC));
ok(!r.ok && /short of Leather\.$/.test(r.text) && count(ORC, LEATHER) === 1, 'nor one carrying a player\'s enchantment', r);
INV[ORC] = [{ baseId: LEATHER, count: 2 }, { baseId: THREAD, count: 2 }, { baseId: THREAD, count: 2 }];
r = W.weave(ORC, desc(TUNIC));
ok(r.ok && r.text === 'You weave Plain Tunic.', 'with the materials it weaves', r);
ok(count(ORC, LEATHER) === 1 && count(ORC, THREAD) === 1 && count(ORC, TUNIC) === 1, 'it takes exactly 1 leather and 3 thread across two stacks, and gives one tunic', INV[ORC]);
ok(AWARDS.length === 1 && AWARDS[0][0] === ORC && AWARDS[0][1] === 'tailor' && AWARDS[0][3] === TUNIC, 'it is Tailor work, keyed on the garment', AWARDS);
ok(logs.some((l) => /loomweave: .* wove Plain Tunic \(7001:Skyrim\.esm\) from 1 Leather, 3 Thread; Tailor \+2/.test(l)), 'the weave is logged');
INV[NORD] = [{ baseId: LEATHER, count: 5 }, { baseId: THREAD, count: 9 }];
r = W.weave(NORD, desc(TUNIC));
ok(!r.ok && /Orcish work: only Orcish tailors/.test(r.text) && count(NORD, THREAD) === 9 && count(NORD, TUNIC) === 0, 'another race is refused by name, even asking directly', r);
INV[ORC] = [{ baseId: THREAD, count: 9 }];
r = W.weave(ORC, desc(ROBE));
ok(!r.ok && /Noble clothes are Adept Tailor's work; you are a Novice Tailor/.test(r.text) && count(ORC, THREAD) === 9, 'a Novice asking for the Adept garment directly is refused', r);
INV[STAFF_ORC] = [{ baseId: THREAD, count: 2 }];
ok(W.weave(STAFF_ORC, desc(ROBE)).ok && count(STAFF_ORC, ROBE) === 1, 'Orc staff weave past the tier');
ok(!W.weave(ORC, desc(0x7fff)).ok, 'an unknown recipe weaves nothing');

// In salvage.js's loom panel
reset(); W = load();
INV[ORC] = [{ baseId: LEATHER, count: 1 }, { baseId: THREAD, count: 3 }];
ok(globalThis.__dboSalvageActivate(LOOM, ORC) === true, 'an Orc tailor with nothing to break down gets the loom panel for the weave alone');
let w = lastWidget(ORC);
ok(w && w.actions[0].id === 'use' && (w.actions[1] || {}).id === KEY_TUNIC && /^Weave at the loom \(Novice\)$/.test(w.targetName), 'its first row works the loom, the next weaves; the title says weave', w);
choose(ORC, KEY_TUNIC);
ok(count(ORC, TUNIC) === 1 && count(ORC, THREAD) === 0 && /You weave Plain Tunic/.test(lastWidget(ORC).targetName), 'choosing the row weaves and the panel says so', lastWidget(ORC));
choose(ORC, KEY_TUNIC);
ok(count(ORC, TUNIC) === 1 && /short of/.test(lastWidget(ORC).targetName), 'again without materials: the panel says what is short', lastWidget(ORC).targetName);
FAR = true;
choose(ORC, KEY_TUNIC);
ok(lastWidget(ORC) === null && said.some(([, t]) => /walked away from the loom/.test(t)), 'walked away: the panel closes');
FAR = false;
ok(globalThis.__dboSalvageActivate(LOOM, NORD) === false, 'a tailor of another race with nothing to break down just uses the loom');
INV[ORC] = [{ baseId: SWORD, count: 1 }];
MAST[ORC] = { order: ['tailor', 'blacksmith'], skills: { tailor: { rank: 0 }, blacksmith: { rank: 4 } } };
ok(globalThis.__dboSalvageActivate(SMELTER, ORC) === false || !lastWidget(ORC).actions.some((x) => /^weave:/.test(x.id)), 'no weave rows at any other station');

// The file is re-read when it changes; a recipe's own name wins over the catalog's
fs.writeFileSync('loom-recipes.private.json', JSON.stringify({ recipes: [Object.assign({ name: 'Woven Smock' }, RECIPES.recipes[0]), { product: 'zz:Nowhere.esp', materials: [[desc(THREAD), 1]] }] }));
const t = Date.now() / 1000 + 5; fs.utimesSync('loom-recipes.private.json', t, t);
ok(W.rows(STAFF_ORC).length === 1 && logs.some((l) => /recipe for zz:Nowhere\.esp skipped/.test(l)), 'a change is picked up, and a recipe naming a missing id is skipped with a line', logs.slice(-3));
ok(/^Weave Woven Smock: /.test(W.rows(STAFF_ORC)[0].label), 'the recipe\'s own name is shown', W.rows(STAFF_ORC)[0].label);
INV[STAFF_ORC] = [{ baseId: LEATHER, count: 1 }, { baseId: THREAD, count: 3 }];
ok(W.weave(STAFF_ORC, desc(TUNIC)).text === 'You weave Woven Smock.', '...and said when woven');
fs.writeFileSync('loom-recipes.private.json', '{ broken');
fs.utimesSync('loom-recipes.private.json', t + 5, t + 5);
ok(W.rows(STAFF_ORC).length === 0 && logs.some((l) => /unreadable/.test(l)), 'a broken file gives no rows and a line');

// No private mod's ids may sit in this file or the module
const PRIV = /druadach|summerset|murkmire|baan ?malur|DrV_/i;
ok(!PRIV.test(fs.readFileSync(__filename, 'utf8').replace(/^\/\/.*$/gm, '').replace(/const PRIV = .*$/m, '')) && !PRIV.test(fs.readFileSync(WEAVE, 'utf8').replace(/^\/\/.*$/gm, '')), 'no private mod is named outside comments here or in loomweave.js');

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
