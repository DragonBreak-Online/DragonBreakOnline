// Loot, 31 Oct (Nat: "nerf armour and weapon drops a little in Blackreach, and add more stuff based on boss. Too much glass and
// amber drops? Make sure it's balanced with PvP in mind"). Checks:
//   1. Blackreach's chests (blackreach.js gearThin): of the Glass and Amber pieces a chest rolls about half stay, of the Dwarven
//      and honed Falmer three in four, other gear and every non-gear entry all; a thinned piece becomes a gem of the province
//      or Dwemer scrap, never an ingot or ore above steel; the config changes the shares; the real loot-materials.json families;
//   2. the boss tables (Worker 2's _work/boss-loot-1027.md): every boss pays 100-150 gold and its signature material, two picks
//      of a themed pool of five to seven, two uncommon rolls of 12% or less, its schematic, a named trophy at 2% (skipped until
//      its record exists); no weapon, armour or artifact, and no ingot or ore above steel (loottiers.js LOOT_ONLY_METALS,
//      gear-swap.json metals) anywhere in a boss's drops; the Heart Stone (Solstheim) is Karstaag's only.
//   node tests/loot-1031-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const norm = (d) => { const [h, p] = String(d).split(':'); return `${parseInt(h, 16).toString(16)}:${String(p).toLowerCase()}`; };

// ---- 1. Blackreach ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-loot1031-'));
const home = process.cwd(); process.chdir(dir);
for (const f of ['loot.json', 'loot-materials.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
fs.writeFileSync('blackreach.json', JSON.stringify({ spots: [], chests: [] }));
const ids = new Map(), descs = new Map(); let next = 0x1000;
const idOf = (d) => { const k = norm(d); if (!ids.has(k)) { ids.set(k, next); descs.set(next, k); next++; } return ids.get(k); };
const GLASS = idOf('139a9:Skyrim.esm'), AMBER = idOf('bc4:ccBGSSSE025-AdvDSGS.esm'), STEEL = idOf('13952:Skyrim.esm');
const DWARVEN = idOf(Object.entries(readJson('loot-materials.json').items).find(([, f]) => f === 'dwarven')[0]);
const GOLD = 0xf;
globalThis.__dboLootInProvince = (it, prov) => prov === 'skyrim' && !/^601c8c:/i.test(it.id);   // a Cyrodiil-only gem stays out
const load = (cfg) => {
  delete require.cache[path.join(ROOT, 'blackreach.js')];
  require(path.join(ROOT, 'blackreach.js'))({ mp: { get: () => undefined, set: () => {}, getIdFromDesc: idOf, getDescFromId: (i) => descs.get(i >>> 0) || '' },
    log: () => {}, personal: () => {}, registerChatCommand: () => {}, giveItem: () => true, profileOf: () => -1, display: String, who: String, audit: () => {},
    isAdmin: () => false, cfg: cfg || {}, onlineActors: () => [], sendPacket: () => {} });
};
load({});
const thin = globalThis.__dboBlackreachThin;
ok(typeof thin === 'function', 'blackreach.js exposes its thinning');
const N = 6000; const kept = { glass: 0, amber: 0, steel: 0, dwarven: 0, gold: 0 }; const swaps = new Map();
for (let i = 0; i < N; i++) {
  const out = thin([{ baseId: GOLD, count: 40 }, { baseId: GLASS, count: 1 }, { baseId: AMBER, count: 1 }, { baseId: STEEL, count: 1 }, { baseId: DWARVEN, count: 1 }]);
  for (const e of out) {
    if (e.baseId === GOLD) kept.gold++; else if (e.baseId === GLASS) kept.glass++; else if (e.baseId === AMBER) kept.amber++; else if (e.baseId === STEEL) kept.steel++; else if (e.baseId === DWARVEN) kept.dwarven++;
    else swaps.set(descs.get(e.baseId), (swaps.get(descs.get(e.baseId)) || 0) + e.count);
  }
}
const near = (x, want, tol) => Math.abs(x / N - want) <= tol;
ok(near(kept.glass, 0.5, 0.03) && near(kept.amber, 0.5, 0.03), `about half the Glass and Amber stays (${(kept.glass / N).toFixed(3)}, ${(kept.amber / N).toFixed(3)})`, kept);
ok(near(kept.dwarven, 0.75, 0.03), `about three in four Dwarven pieces stay (${(kept.dwarven / N).toFixed(3)})`, kept);
ok(kept.steel === N && kept.gold === N, 'steel gear and the gold always stay', kept);
const L = readJson('loot.json').pools;
const GEMS = new Set(L.gems.filter((g) => !/^601c8c:/i.test(g.id)).map((g) => norm(g.id)));
const SCRAP = new Set(['c886a:skyrim.esm', 'c886c:skyrim.esm', 'c886e:skyrim.esm', 'c8870:skyrim.esm', 'c8868:skyrim.esm', 'aebf1:skyrim.esm']);
const swapped = [...swaps.keys()];
ok(swapped.length && swapped.every((d) => GEMS.has(d) || SCRAP.has(d)), 'a thinned piece becomes a Skyrim gem or Dwemer scrap, nothing else', swapped.filter((d) => !GEMS.has(d) && !SCRAP.has(d)));
const gemN = swapped.filter((d) => GEMS.has(d)).reduce((n, d) => n + swaps.get(d), 0), scrapLines = swapped.filter((d) => SCRAP.has(d)).length;
ok(gemN > 0 && scrapLines >= 4, 'both kinds come up: gems and several kinds of scrap', [gemN, scrapLines]);
ok(!swapped.includes('601c8c:bsassets.esm'), 'no gem from another province');
const swapsTotal = N * 4 - kept.glass - kept.amber - kept.steel - kept.dwarven;
const thinnedPieces = N * 2 - kept.glass - kept.amber + N - kept.dwarven;
ok(swapsTotal === thinnedPieces, 'every thinned piece is replaced by exactly one entry (none lost, none doubled)', [swapsTotal, thinnedPieces]);
load({ blackreach: { gearThin: { glass: 1, amber: 0 }, gemShare: 1 } });
const t2 = globalThis.__dboBlackreachThin;
let g2 = 0, a2 = 0, gemOnly = true;
for (let i = 0; i < 500; i++) for (const e of t2([{ baseId: GLASS, count: 1 }, { baseId: AMBER, count: 1 }])) { if (e.baseId === GLASS) g2++; else if (e.baseId === AMBER) a2++; else if (!GEMS.has(descs.get(e.baseId))) gemOnly = false; }
ok(g2 === 500 && a2 === 0 && gemOnly, 'config: glass 1 keeps every Glass piece, amber 0 none, gemShare 1 swaps to gems only', [g2, a2, gemOnly]);
const CFG = readJson('gamemode-config.json');
const brc = CFG.blackreach || {};
ok(!brc.gearThin || (brc.gearThin.glass <= 0.6 && brc.gearThin.amber <= 0.6), 'gamemode-config does not undo the nerf', brc.gearThin);
const brsrc = fs.readFileSync(path.join(ROOT, 'blackreach.js'), 'utf8');
ok(/return thin\(out\);/.test(brsrc) && /if \(Math\.random\(\) < C\.themeChance\)[^\n]*\n\s*return thin\(out\);/.test(brsrc.replace(/\r\n/g, '\n')), 'the chest roll passes through it, the theme piece included');
process.chdir(home);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Windows may hold it */ }

// ---- 2. the boss tables ----
const B = readJson('bosses.json').bosses;
const metals = new Set(Object.keys(require(path.join(ROOT, 'loottiers.js')).LOOT_ONLY_METALS));
const SWAP = readJson('gear-swap.json');
for (const m of Object.keys(SWAP.metals || {})) metals.add(norm(m));
const GEAR = new Set([].concat(L.weapons, L.armor, L.ench_weapons, L.ench_armor).map((x) => norm(x.id)));
const ART = (() => { try { return new Set(JSON.stringify(readJson('artifacts.json')).match(/[0-9a-f]{1,8}:[^"]+?\.es[mpl]/gi).map(norm)); } catch (e) { return new Set(); } })();
const allDescs = (b) => { const d = b.drops; return [].concat(d.always.map((x) => x[0]), d.pool.items.map((x) => x[0]), (d.extra || []).map((x) => x[0]), d.trophy && d.trophy.desc ? [d.trophy.desc] : []).map(norm); };
const live = B.filter((b) => b.id !== 'minotaurtest1');
ok(live.length === 13, 'thirteen bosses');
ok(live.every((b) => { const g = b.drops.always.find((x) => norm(x[0]) === 'f:skyrim.esm'); return g && g[1] >= 100 && g[1] <= 150; }), 'every boss pays 100-150 gold', live.map((b) => [b.id, (b.drops.always.find((x) => norm(x[0]) === 'f:skyrim.esm') || [])[1]]));
ok(live.every((b) => b.drops.always.length >= 2), '...and its signature material');
ok(live.every((b) => b.drops.pool.picks === 2 && b.drops.pool.items.length >= 5 && b.drops.pool.items.length <= 7 && b.drops.pool.items.every((x) => x[1] > 0 && x[2] > 0)), 'two picks of a themed pool of five to seven', live.map((b) => [b.id, b.drops.pool.items.length]));
ok(live.every((b) => (b.drops.extra || []).length === 2 && b.drops.extra.every((x) => x[1] > 0 && x[1] <= 0.12)), 'two uncommon rolls, each 12% or less', live.map((b) => [b.id, b.drops.extra]));
ok(live.every((b) => b.drops.schematic && b.drops.schematic.family && b.drops.schematic.chance >= 0.03 && b.drops.schematic.chance <= 0.08), 'a schematic each, 3-8%');
ok(live.every((b) => b.drops.trophy && b.drops.trophy.name && b.drops.trophy.chance === 0.02 && b.drops.trophy.desc === ''), 'a named trophy each at 2%, inert until its DLE record exists', live.map((b) => [b.id, b.drops.trophy]));
ok(new Set(live.map((b) => b.drops.trophy.name)).size === 13, '...every trophy its own');
const bad = live.flatMap((b) => allDescs(b).filter((d) => metals.has(d)).map((d) => `${b.id} ${d}`));
ok(!bad.length && metals.size >= 13, `no ingot or ore above steel in any boss drop (${metals.size} metals checked)`, bad);
const gear = live.flatMap((b) => allDescs(b).filter((d) => GEAR.has(d) || ART.has(d)).map((d) => `${b.id} ${d}`));
ok(!gear.length, 'no weapon, armour or artifact in any boss drop', gear);
ok(live.filter((b) => allDescs(b).includes('17749:dragonborn.esm')).map((b) => b.id).join() === 'karstaag', 'the Heart Stone (Solstheim) is Karstaag\'s only');
ok(B.find((b) => b.id === 'centurion').drops.pool.items.some((x) => norm(x[0]) === 'c886a:skyrim.esm'), 'the Centurion gives Dwemer scrap (the Leader, 31 Oct)');
const bsrc = fs.readFileSync(path.join(ROOT, 'bosses.js'), 'utf8');
ok(/if \(dr\.trophy && dr\.trophy\.desc && Math\.random\(\) < \(Number\(dr\.trophy\.chance\) \|\| 0\) && giveDesc\(p, dr\.trophy\.desc, 1\)\)/.test(bsrc), 'bosses.js gives the trophy only once it has a record');
const defs = readJson('tools/bosses/boss-defs.json');
const dl = defs.bosses || defs;
ok(live.every((b) => JSON.stringify(dl.find((x) => x.id === b.id).drops.pool.items) === JSON.stringify(b.drops.pool.items.map((x) => x.slice(0, 3)))), 'boss-defs.json carries the same pools, so a regeneration keeps them');
const gen = fs.readFileSync(path.join(ROOT, 'tools/bosses/bosses_build.py'), 'utf8');
ok(/for d, wgt, n in dr\['pool'\]\.get\('items', \[\]\)/.test(gen) && /for d, chance, n in dr\.get\('extra', \[\]\)/.test(gen) && /for key in \('trophy', '_loot1031'\)/.test(gen), 'bosses_build.py reads the desc-form pools, rolls and trophy');

console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);   // blackreach.js leaves its timers running
