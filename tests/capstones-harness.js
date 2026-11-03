// capstones.js, the Grandmaster core and the Blacksmith's Maker's Mark (Nat, 2 Nov; _work/grandmaster-capstones.md).
// Loads the real module against a fake mp and checks that
//   - a Grandmaster is the Wheel's level at 100, and nothing below it;
//   - a once-a-day use is kept per real UTC day on the character, and audited;
//   - a forge craft by the Blacksmith Grandmaster names exactly the copies the engine hands over ("..., forged by <own
//     name>"), never a tempered copy already carried, and stacks with the earlier marked ones;
//   - nobody else is marked: a smith below 100, a recipe that is not forge work, an item that is not a weapon or armour,
//     the switch off; and a craft that never reaches the pack leaves the pack alone;
//   - regions.js calls the mark after every other check let the craft on, and smithing.js exposes its forge test.
//   node tests/capstones-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

const SMITH = 0xff000101, NOVICE = 0xff000102;
const SWORD = 0x0001397e, CUIRASS = 0x00013951, INGOT = 0x0005ace4;
const FORGE_RECIPE = 0x000a1, TEMPER_RECIPE = 0x000a2;
const TYPES = { [SWORD]: 'WEAP', [CUIRASS]: 'ARMO', [INGOT]: 'MISC' };
const NAMES = { [SWORD]: 'Steel Sword', [CUIRASS]: 'Steel Armor', [INGOT]: 'Steel Ingot' };
const props = new Map();
const put = (a, k, v) => props.set(`${a}|${k}`, v === undefined ? v : JSON.parse(JSON.stringify(v)));
const getp = (a, k) => props.get(`${a}|${k}`);
const mp = {
  get: (a, k) => getp(a, k),
  set: (a, k, v) => put(a, k, v),
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
};
const audits = [], said = [], logs = [], cmds = new Map();
const level = (a, n) => put(a, 'private.mastery', { v: 2, order: ['blacksmith'], skills: { blacksmith: { level: n, xp: 0, rank: 4 } } });
const load = (cfg) => {
  delete require.cache[path.join(ROOT, 'capstones.js')];
  return require(path.join(ROOT, 'capstones.js'))({
    mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), who: (a) => `P${(a & 0xfff).toString(16)}`,
    cfg, registerChatCommand: (n, f) => cmds.set(n, f), realNameOf: (a) => (a === SMITH ? 'Eorlund Gray-Mane' : 'Novice Smith'),
    recordOf: (id) => (TYPES[id >>> 0] ? { record: { type: TYPES[id >>> 0] } } : null), itemName: (d) => NAMES[parseInt(String(d).split(':')[0], 16)] || '?',
  });
};
globalThis.__dboSmithIsForge = (r) => (r >>> 0) === FORGE_RECIPE;
const CFG = { capstones: { enabled: true, blacksmith: { enabled: true } } };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const inv = (a) => (getp(a, 'inventory') || {}).entries || [];
const give = (a, e) => put(a, 'inventory', { entries: inv(a).concat([e]) });
// The engine hands a crafted item over after the hook returns: the craft as regions.js reports it, then the item
const forge = async (a, id, recipe, count = 1, arrives = true) => {
  const r = globalThis.__dboCapstoneCrafted(a, id, count, recipe);
  if (arrives) give(a, { baseId: id, count });
  await tick(5);
  return r;
};
const named = (a, id) => inv(a).filter((e) => e.baseId === id && e.name);

(async () => {
  let C = load(CFG);
  // ---- the core ----
  level(SMITH, 100); level(NOVICE, 99);
  ok(C.isGrandmaster(SMITH, 'blacksmith') && !C.isGrandmaster(NOVICE, 'blacksmith'), 'a Grandmaster is the Wheel at 100; 99 is not');
  ok(C.grandmasterOf(SMITH) === 'blacksmith' && C.grandmasterOf(NOVICE) === null, '...and grandmasterOf names the skill');
  const day = Date.UTC(2026, 10, 2, 23, 59);
  ok(!C.usedToday(SMITH, 'feast', day) && C.markUsed(SMITH, 'feast', 'cook', day) && C.usedToday(SMITH, 'feast', day), 'a use is kept for the UTC day');
  ok(!C.usedToday(SMITH, 'feast', day + 2 * 60000), '...and is spent no longer after midnight UTC');
  ok(getp(SMITH, 'private.dboCapstones').feast === '2026-11-02', '...kept on the character, so a relog keeps it', getp(SMITH, 'private.dboCapstones'));
  ok(audits.some((t) => t === 'CAPSTONE P101 used cook feast on 2026-11-02'), '...and audited with ids and the date only', audits);

  // ---- Maker's Mark ----
  put(SMITH, 'inventory', { entries: [{ baseId: SWORD, count: 1, health: 1.3 }, { baseId: INGOT, count: 5 }] });
  ok(await forge(SMITH, SWORD, FORGE_RECIPE), 'a forge craft by the Grandmaster is taken up');
  let n = named(SMITH, SWORD);
  ok(n.length === 1 && n[0].name === 'Steel Sword, forged by Eorlund Gray-Mane' && n[0].count === 1 && n[0].health === undefined, 'the new sword carries the mark', inv(SMITH));
  ok(inv(SMITH).some((e) => e.baseId === SWORD && !e.name && e.health === 1.3 && e.count === 1), '...the tempered sword already carried keeps its own name', inv(SMITH));
  await forge(SMITH, SWORD, FORGE_RECIPE, 2);
  n = named(SMITH, SWORD);
  ok(n.length === 1 && n[0].count === 3, 'two more forged at once join the marked stack', n);
  await forge(SMITH, CUIRASS, FORGE_RECIPE);
  ok(named(SMITH, CUIRASS).length === 1 && named(SMITH, CUIRASS)[0].name === 'Steel Armor, forged by Eorlund Gray-Mane', 'armour is marked too');
  await forge(SMITH, INGOT, FORGE_RECIPE);
  ok(!named(SMITH, INGOT).length, 'an ingot (not a weapon or armour) is not marked');
  await forge(SMITH, SWORD, TEMPER_RECIPE, 1);
  ok(named(SMITH, SWORD)[0].count === 3, 'a recipe that is not forge work marks nothing', named(SMITH, SWORD));
  put(NOVICE, 'inventory', { entries: [] });
  ok(!(await forge(NOVICE, SWORD, FORGE_RECIPE)) && !named(NOVICE, SWORD).length, 'a smith at 99 forges plain swords');
  const before = JSON.stringify(inv(SMITH));
  await forge(SMITH, SWORD, FORGE_RECIPE, 1, false);
  await tick(2500);
  ok(JSON.stringify(inv(SMITH)) === before && logs.some((l) => /never reached the pack/.test(l)), 'a craft that never reaches the pack leaves the pack alone, and says so', logs.slice(-2));

  // ---- the switches ----
  C = load({ capstones: { enabled: true, blacksmith: { enabled: false } } });
  await forge(SMITH, CUIRASS, FORGE_RECIPE);
  ok(named(SMITH, CUIRASS)[0].count === 1 && inv(SMITH).some((e) => e.baseId === CUIRASS && !e.name), "blacksmith's own switch off: forged plain");
  C = load({ capstones: { enabled: false, blacksmith: { enabled: true } } });
  ok(!(await forge(SMITH, SWORD, FORGE_RECIPE)), 'the top switch off: nothing marked');

  // ---- /capstone ----
  C = load(CFG);
  said.length = 0;
  cmds.get('capstone')(SMITH, '');
  ok(/Grandmaster: Maker's Mark/.test(said.pop()[1]), "/capstone names a Grandmaster's reward");
  cmds.get('capstone')(NOVICE, '');
  ok(/None of yours is there yet/.test(said.pop()[1]), '...and tells anyone else none is reached');

  // ---- branch 2: Tailor, Alchemist, Enchanter (Nat, 2 Nov) ----
  const TAILOR = 0xff000103, BREWER = 0xff000104, ENCHANTER = 0xff000105;
  const ROBE = 0x0001be1a, POTION = 0x0003eadd, RING = 0x0001cb34, LOOM_RECIPE = 0x000a3;
  TYPES[ROBE] = 'ARMO'; TYPES[POTION] = 'ALCH'; TYPES[RING] = 'ARMO';
  NAMES[ROBE] = 'Fine Clothes'; NAMES[POTION] = 'Potion of Healing'; NAMES[RING] = 'Gold Ring';
  const gm = (a, skill) => put(a, 'private.mastery', { v: 2, order: [skill], skills: { [skill]: { level: 100, xp: 0, rank: 4 } } });
  gm(TAILOR, 'tailor'); gm(BREWER, 'alchemist'); gm(ENCHANTER, 'enchanter');
  for (const a of [TAILOR, BREWER, ENCHANTER]) put(a, 'inventory', { entries: [] });
  globalThis.__dboTailorIsLoom = (r) => (r >>> 0) === LOOM_RECIPE;
  globalThis.__dboProseProblem = (t) => (/slurword/i.test(t) ? 'slurword' : null);
  globalThis.__dboCapstoneArmed.clear();
  C = load({ capstones: { enabled: true, blacksmith: { enabled: true }, tailor: { enabled: true }, alchemist: { enabled: true }, enchanter: { enabled: true } } });
  const last = (a) => { const l = said.filter((x) => x[0] === a); return l.length ? l[l.length - 1][1] : ''; };

  // Tailor
  await forge(TAILOR, ROBE, LOOM_RECIPE);
  ok(named(TAILOR, ROBE).length === 1 && named(TAILOR, ROBE)[0].name === 'Fine Clothes, sewn by Novice Smith', 'a Grandmaster Tailor\'s loom garment is sewn by them', inv(TAILOR));
  ok(!(await forge(TAILOR, SWORD, FORGE_RECIPE)), "...a Tailor's forge work is no tailor's mark (and no smith's: Blacksmith is not theirs)");
  cmds.get('bespoke')(TAILOR, 'the Jarl, of Whiterun');
  ok(/simple marks only/.test(last(TAILOR)), 'a bespoke name cannot carry a comma (it would fake a mark)', last(TAILOR));
  cmds.get('bespoke')(TAILOR, 'slurword robe');
  ok(/will not do/.test(last(TAILOR)), '...nor pass the prose filter', last(TAILOR));
  cmds.get('bespoke')(TAILOR, "the Jarl's Winter Robe");
  await forge(TAILOR, ROBE, LOOM_RECIPE, 2);
  ok(inv(TAILOR).some((e) => e.name === "the Jarl's Winter Robe, sewn by Novice Smith" && e.count === 1), 'a bespoke name goes on one garment only', inv(TAILOR));
  ok(named(TAILOR, ROBE).find((e) => e.name === 'Fine Clothes, sewn by Novice Smith').count === 1, '...the rest of the batch stays plain until marked, the bespoke spent', inv(TAILOR));
  await forge(TAILOR, ROBE, LOOM_RECIPE);
  ok(named(TAILOR, ROBE).find((e) => e.name === 'Fine Clothes, sewn by Novice Smith').count === 2, '...and the next garment carries the plain mark again', inv(TAILOR));
  globalThis.__dboCapstoneWoven(TAILOR, ROBE, 1); give(TAILOR, { baseId: ROBE, count: 1 }); await tick(5);
  ok(named(TAILOR, ROBE).find((e) => e.name === 'Fine Clothes, sewn by Novice Smith').count === 3, 'a garment the server weaves is marked too');

  // Alchemist
  ok(!globalThis.__dboCapstoneBrewing(BREWER, POTION), 'a brew without /signature is not a signature draught');
  cmds.get('signature')(BREWER, '');
  ok(globalThis.__dboCapstoneBrewing(BREWER, POTION), '/signature arms the next brew');
  give(BREWER, { baseId: POTION, count: 1 }); await tick(5);
  ok(named(BREWER, POTION).length === 1 && named(BREWER, POTION)[0].name === 'Potion of Healing, brewed by Novice Smith' && C.usedToday(BREWER, 'signature'), "the draught carries the brewer's name and today's use is spent", inv(BREWER));
  cmds.get('signature')(BREWER, '');
  ok(/today's signature draught/.test(last(BREWER)) && !globalThis.__dboCapstoneBrewing(BREWER, POTION), 'a second one the same UTC day is refused', last(BREWER));
  globalThis.__dboCapstoneArmed.set(BREWER, { kind: 'signature', at: Date.now() });
  ok(!globalThis.__dboCapstoneBrewing(BREWER, POTION), '...even armed some other way, the brew itself checks the day');
  globalThis.__dboCapstoneArmed.delete(BREWER);

  // Enchanter
  put(ENCHANTER, 'inventory', { entries: [{ baseId: RING, count: 1, enchantmentEffects: [{ id: 1, magnitude: 5 }] }] });
  cmds.get('enchantname')(ENCHANTER, 'Frostbite of the Pale');
  ok(globalThis.__dboCapstoneEnchanting(ENCHANTER), '/enchantname arms the next enchantment');
  give(ENCHANTER, { baseId: RING, count: 1, enchantmentEffects: [{ id: 2, magnitude: 9 }] }); await tick(5);
  const rings = inv(ENCHANTER).filter((e) => e.baseId === RING);
  ok(rings.some((e) => e.name === 'Frostbite of the Pale, enchanted by Novice Smith' && e.enchantmentEffects[0].id === 2) && rings.some((e) => !e.name && e.enchantmentEffects[0].id === 1), 'the newly enchanted copy is named; the one already carried is not', rings);
  cmds.get('enchantname')(ENCHANTER, 'Another');
  ok(/a week after/.test(last(ENCHANTER)) && !globalThis.__dboCapstoneEnchanting(ENCHANTER), 'the next named enchantment waits a week', last(ENCHANTER));
  const wk = Date.UTC(2026, 10, 2);
  put(ENCHANTER, 'private.dboCapstones', { enchantname: '2026-11-02' });
  ok(C.usedWithin(ENCHANTER, 'enchantname', 7, wk + 6 * 86400000) && !C.usedWithin(ENCHANTER, 'enchantname', 7, wk + 7 * 86400000), '...seven UTC days to the day');

  // ---- the hooks in the other modules ----
  const ALC = fs.readFileSync(path.join(ROOT, 'alchemy.js'), 'utf8');
  ok((ALC.match(/globalThis\.__dboCapstoneBrewing\(a, (draught\.potion|rec\.id|potion\.id)\);[^\n]*\n\s*give\(entries, \1, 1\);/g) || []).length === 3, 'alchemy.js reports every brew path (the draught, a specialty, a potion) before it gives the potion');
  ok(/__dboCapstoneWoven\(a, r\.productId, r\.count\);[^\n]*\n\s*giveItem\(a, r\.productId, r\.count\);/.test(fs.readFileSync(path.join(ROOT, 'loomweave.js'), 'utf8')), 'loomweave.js reports a woven garment before it hands it over');
  ok(/__dboEnchantScale = \(actorId, info\) => \{\n[^\n]*\n\s*try \{ if \(typeof globalThis\.__dboCapstoneEnchanting === 'function'\)/.test(fs.readFileSync(path.join(ROOT, 'enchanting.js'), 'utf8')), 'enchanting.js reports an enchantment first, even with its own scaling off');
  ok(/globalThis\.__dboTailorIsLoom = isLoomRecipe;/.test(fs.readFileSync(path.join(ROOT, 'tailoring.js'), 'utf8')), 'tailoring.js exposes its loom test');
  const REG = fs.readFileSync(path.join(ROOT, 'regions.js'), 'utf8');
  const smithAt = REG.indexOf('globalThis.__dboSmithCrafted(a)'), capAt = REG.indexOf('globalThis.__dboCapstoneCrafted(a,');
  ok(capAt > 0 && capAt > smithAt && /verdict !== false && typeof globalThis\.__dboCapstoneCrafted === 'function'/.test(REG), "regions.js marks only after the whole craft chain let the craft on");
  ok(/globalThis\.__dboSmithIsForge = isForgeRecipe;/.test(fs.readFileSync(path.join(ROOT, 'smithing.js'), 'utf8')), 'smithing.js exposes its forge test');
  const GM = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
  ok(GM.indexOf("path.resolve('capstones.js')") > GM.indexOf("path.resolve('smithing.js')"), 'gamemode.js loads capstones.js after smithing.js');
  const CONF = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8')).capstones;
  ok(CONF && CONF.enabled === true && CONF.blacksmith && CONF.blacksmith.enabled === true, 'the tracked config has its own switch, Maker\'s Mark on', CONF);

  console.log(fails ? `${fails} FAILED` : 'all checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL threw', e.stack); process.exit(1); });
