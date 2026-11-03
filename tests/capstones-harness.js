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

  // ---- the hooks in the other modules ----
  const REG = fs.readFileSync(path.join(ROOT, 'regions.js'), 'utf8');
  const smithAt = REG.indexOf('globalThis.__dboSmithCrafted(a)'), capAt = REG.indexOf('globalThis.__dboCapstoneCrafted(a,');
  ok(capAt > 0 && capAt > smithAt && /verdict !== false && typeof globalThis\.__dboCapstoneCrafted === 'function'/.test(REG), "regions.js marks only after the whole craft chain let the craft on");
  ok(/globalThis\.__dboSmithIsForge = isForgeRecipe;/.test(fs.readFileSync(path.join(ROOT, 'smithing.js'), 'utf8')), 'smithing.js exposes its forge test');
  const GM = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
  ok(GM.indexOf("path.resolve('capstones.js')") > GM.indexOf("path.resolve('smithing.js')"), 'gamemode.js loads capstones.js after smithing.js');
  const CONF = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8')).capstones;
  ok(CONF && CONF.enabled === true && CONF.blacksmith && CONF.blacksmith.enabled === false, 'the tracked config has its own switch, Maker\'s Mark off until Nat has tried it on dev', CONF);

  console.log(fails ? `${fails} FAILED` : 'all checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL threw', e.stack); process.exit(1); });
