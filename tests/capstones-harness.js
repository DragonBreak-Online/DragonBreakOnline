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
const FIND = {}, PROFILES = {}, DISCORDS = {}, DIST = new Map();
const FIELDS = {}, WSKILL = {}, ONLINE = [], SATED = [];
const level = (a, n) => put(a, 'private.mastery', { v: 2, order: ['blacksmith'], skills: { blacksmith: { level: n, xp: 0, rank: 4 } } });
const load = (cfg) => {
  delete require.cache[path.join(ROOT, 'capstones.js')];
  return require(path.join(ROOT, 'capstones.js'))({
    mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), who: (a) => `P${(a & 0xfff).toString(16)}`,
    cfg, registerChatCommand: (n, f) => cmds.set(n, f), realNameOf: (a) => (a === SMITH ? 'Eorlund Gray-Mane' : 'Novice Smith'),
    recordOf: (id) => (TYPES[id >>> 0] ? { record: { type: TYPES[id >>> 0], fields: FIELDS[id >>> 0] || [] } } : null), itemName: (d) => NAMES[parseInt(String(d).split(':')[0], 16)] || '?',
    weaponSkillOf: (id) => WSKILL[id >>> 0] || '', onlineActors: () => ONLINE.slice(), sate: (x) => SATED.push(x),
    findByName: (q) => FIND[String(q).trim().toLowerCase()] || 0, distanceMeters: (x, y) => (DIST.get(`${x}|${y}`) ?? 2),
    profileOf: (x) => (PROFILES[x] ?? -1), discordOf: (x) => DISCORDS[x] || '',
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

  // ---- branch 3: Blade, Sword-Master's School (Nat, 2 Nov) ----
  const SWORD_M = 0xff000201, APP1 = 0xff000202, APP2 = 0xff000203, APP3 = 0xff000204, ALT = 0xff000205;
  Object.assign(FIND, { app1: APP1, app2: APP2, app3: APP3, alt: ALT });
  Object.assign(PROFILES, { [SWORD_M]: 50, [APP1]: 51, [APP2]: 52, [APP3]: 53, [ALT]: 54 });
  Object.assign(DISCORDS, { [SWORD_M]: 'd-master', [ALT]: 'd-master', [APP1]: 'd1', [APP2]: 'd2', [APP3]: 'd3' });
  gm(SWORD_M, 'blade');
  C = load({ capstones: { enabled: true, blade: { enabled: true } } });
  const sc = (a, t) => cmds.get('swordschool')(a, t);
  sc(SWORD_M, 'take alt');
  ok(/your own apprentice/.test(last(SWORD_M)), 'a character of the master\'s own Discord cannot be their apprentice', last(SWORD_M));
  DIST.set(`${SWORD_M}|${APP1}`, 40); sc(SWORD_M, 'take app1');
  ok(/Stand beside them/.test(last(SWORD_M)), '...nor someone out of reach'); DIST.delete(`${SWORD_M}|${APP1}`);
  sc(APP1, 'take app2');
  ok(/Grandmaster of the Blade/.test(last(APP1)), 'only a Blade Grandmaster takes apprentices');
  audits.length = 0;
  sc(SWORD_M, 'take app1'); sc(APP1, 'accept');
  sc(SWORD_M, 'take app2'); sc(APP2, 'accept');
  ok(getp(SWORD_M, 'private.dboSwordSchool').apprentices.length === 2 && getp(APP1, 'private.dboSwordMaster').actor === SWORD_M, 'two apprentices taken, each accepting, both sides recorded');
  ok(audits.filter((t) => /^CAPSTONE P201 took P20[23] as a blade apprentice$/.test(t)).length === 2, '...and audited', audits);
  sc(SWORD_M, 'take app3');
  ok(/already teach 2 apprentices/.test(last(SWORD_M)), 'a third is refused');
  sc(APP2, 'accept');
  ok(/No sword-master has offered/.test(last(APP2)), 'an accept with no offer does nothing');
  const rate = (a, t, skill = 'blade', kind = 'hit') => globalThis.__dboCapstoneSkillRate(a, skill, kind, { targetId: t });
  let dueling = new Set([`${APP1}|${SWORD_M}`]);
  globalThis.__dboDuelPair = (x, y) => dueling.has(`${x}|${y}`) || dueling.has(`${y}|${x}`);
  ok(rate(APP1, SWORD_M) === 1.5, "an apprentice's Blade hit on their master in a duel is worth 1.5");
  ok(rate(APP2, SWORD_M) === 1, '...the other apprentice, not in that duel, gets nothing extra');
  ok(rate(SWORD_M, APP1) === 1 && rate(APP1, APP3) === 1, '...nor the master hitting them, nor the apprentice hitting someone else');
  ok(rate(APP1, SWORD_M, 'blunt') === 1 && rate(APP1, SWORD_M, 'blade', 'kill') === 1, '...nor another skill, nor another kind of work');
  dueling = new Set();
  ok(rate(APP1, SWORD_M) === 1, '...and outside a duel, nothing');
  dueling = new Set([`${APP1}|${SWORD_M}`]);
  level(SWORD_M, 99); put(SWORD_M, 'private.mastery', { v: 2, order: ['blade'], skills: { blade: { level: 99, xp: 0, rank: 4 } } });
  ok(rate(APP1, SWORD_M) === 1, 'a master fallen below 100 teaches at the usual rate');
  gm(SWORD_M, 'blade');
  sc(APP1, 'leave');
  ok(!getp(APP1, 'private.dboSwordMaster') && getp(SWORD_M, 'private.dboSwordSchool').apprentices.length === 1 && rate(APP1, SWORD_M) === 1, 'an apprentice who leaves is off both records and earns the usual rate', getp(SWORD_M, 'private.dboSwordSchool'));
  sc(SWORD_M, 'release app2');
  ok(!getp(APP2, 'private.dboSwordMaster') && !getp(SWORD_M, 'private.dboSwordSchool').apprentices.length && audits.some((t) => /^CAPSTONE P201 released P203 from blade$/.test(t)), 'the master releases one, audited');
  C = load({ capstones: { enabled: true, blade: { enabled: false } } });
  sc(SWORD_M, 'take app1'); sc(APP1, 'accept');
  ok(!getp(APP1, 'private.dboSwordMaster') && rate(APP1, SWORD_M) === 1, 'Blade switched off: no school and no boost');
  const RATES = fs.readFileSync(path.join(ROOT, 'skillrates.js'), 'utf8');
  ok(/__dboCapstoneSkillRate\(actorId >>> 0, skillId, kind, detail\)\); if \(Number\.isFinite\(r\) && r >= 1 && r <= 2\) rate \*= r;/.test(RATES), 'skillrates.js multiplies by the school rate after the meter, clamped to 1..2');

  // ---- step 4: once a day (Nat, 2 Nov) ----
  const BRUTE = 0xff000301, DIGGER = 0xff000302, CHEF = 0xff000303, WALL = 0xff000304, MONK = 0xff000305, FALLEN = 0xff000306, FOE = 0xff000307, G1 = 0xff000308, G2 = 0xff000309, FAR = 0xff00030a;
  const MACE = 0x00013982, IRONSWORD = 0x00012eb7, PLATE = 0x00013966, STAFF = 0x000a1001;
  TYPES[MACE] = 'WEAP'; TYPES[IRONSWORD] = 'WEAP'; TYPES[PLATE] = 'ARMO'; TYPES[STAFF] = 'WEAP';
  WSKILL[MACE] = 'blunt'; WSKILL[IRONSWORD] = 'blade'; WSKILL[STAFF] = 'unarmed';
  FIELDS[PLATE] = [{ type: 'BOD2', data: new Uint8Array([4, 0, 0, 0, 1, 0, 0, 0]) }];
  gm(BRUTE, 'blunt'); gm(DIGGER, 'miner'); gm(CHEF, 'cook'); gm(WALL, 'defense'); gm(MONK, 'unarmed');
  for (const a of [BRUTE, DIGGER, CHEF, WALL, MONK, FALLEN, FOE, G1, G2, FAR]) put(a, 'inventory', { entries: [] });
  const os = require('os');
  const VEINS = path.join(os.tmpdir(), `capstones-veins-${process.pid}.json`);
  fs.writeFileSync(VEINS, JSON.stringify({ veins: [
    { edid: 'MineOreIron01', world: '3c:Skyrim.esm', pos: [700, 0, 0] },
    { edid: 'MineOreEbony01', world: '3c:Skyrim.esm', pos: [0, 70000, 0] },
    { edid: 'MineOreMeteoricIron01', world: '3c:Skyrim.esm', pos: [0, 1400, 0] },
    { edid: 'MineOreEbony01', world: '1a2b:Skyrim.esm', pos: [0, 70, 0] },   // verify-formids: ignore - a made-up world, on purpose: a vein elsewhere
    { edid: 'MineOreEbony01', world: '3c:Skyrim.esm', pos: [0, -9999999, 0] },
  ] }));
  const ALL4 = { capstones: { enabled: true, blunt: { enabled: true }, miner: { enabled: true, meters: 3000, veinsFile: VEINS }, cook: { enabled: true, guests: 10, meters: 5, wellFedHours: 6 }, defense: { enabled: true, seconds: 60, meters: 2 }, unarmed: { enabled: true } } };
  C = load(ALL4);
  const cmd = (name, a, t) => { cmds.get(name)(a, t || ''); return last(a); };

  // Blunt, Breaker of Doors
  ok(!globalThis.__dboCapstoneBreak(BRUTE, 0x1234), 'no /breaker: the lock is picked as ever');
  cmd('breaker', BRUTE);
  ok(!globalThis.__dboCapstoneBreak(BRUTE, 0x1234) && /war axe, mace/.test(last(BRUTE)), 'armed but no blunt weapon in hand: refused, and told why');
  put(BRUTE, 'inventory', { entries: [{ baseId: MACE, count: 1, worn: true }] });
  ok(globalThis.__dboCapstoneBreak(BRUTE, 0x1234) && C.usedToday(BRUTE, 'breaker'), 'with a mace in hand the lock breaks, and today\'s use is spent');
  ok(/spent/.test(cmd('breaker', BRUTE)) && !globalThis.__dboCapstoneBreak(BRUTE, 0x1235), '...and no second today');
  globalThis.__dboCapstoneArmed.set(BRUTE, { kind: 'breaker', at: Date.now() });
  ok(!globalThis.__dboCapstoneBreak(BRUTE, 0x1236), '...even armed some other way, the break itself checks the day');
  globalThis.__dboCapstoneArmed.delete(BRUTE);

  // Miner, Prospector's Sense
  put(DIGGER, 'worldOrCellDesc', '3c:Skyrim.esm'); put(DIGGER, 'pos', [0, 0, 0]);
  let line = cmd('prospect', DIGGER);
  ok(/Ebony lies north of you, about 1000 m away/i.test(line) && C.usedToday(DIGGER, 'prospect'), 'the rarest ore near wins over a nearer iron vein, with its way and distance', line);
  put(DIGGER, 'private.dboCapstones', {});
  put(DIGGER, 'pos', [0, -150000, 0]);
  line = cmd('prospect', DIGGER);
  ok(/Meteoric lies north/i.test(line), 'beyond reach of the ebony, the next rarest (meteoric, not plain iron)', line);
  put(DIGGER, 'private.dboCapstones', {}); put(DIGGER, 'worldOrCellDesc', '9999:Skyrim.esm');
  line = cmd('prospect', DIGGER);
  ok(/nothing rare answers/.test(line) && !C.usedToday(DIGGER, 'prospect'), 'nothing in this cell or world: told, and the use is not spent', line);

  // Cook, The Feast
  put(CHEF, 'pos', [0, 0, 0]);
  ONLINE.length = 0; ONLINE.push(CHEF, G1, G2, FAR);
  DIST.set(`${CHEF}|${G1}`, 3); DIST.set(`${CHEF}|${G2}`, 4); DIST.set(`${CHEF}|${FAR}`, 30);
  SATED.length = 0;
  line = cmd('feast', CHEF);
  ok(/feast to 2 guests/.test(line) && SATED.includes(G1) && SATED.includes(G2) && !SATED.includes(FAR) && SATED.includes(CHEF), 'the feast feeds the cook and the two guests near, not the one far off', line);
  ok(Number((getp(G1, 'private.dboWellFed') || {}).until) > Date.now() + 5 * 3600000, '...each Well Fed for six hours (rest.js reads it)');
  ok(/spent/.test(cmd('feast', CHEF)), '...one feast a day');
  const CHEF2 = 0xff00030b; gm(CHEF2, 'cook'); ONLINE.push(CHEF2); DIST.set(`${CHEF2}|${G1}`, 1); DIST.set(`${CHEF2}|${G2}`, 1); DIST.set(`${CHEF2}|${FAR}`, 30); DIST.set(`${CHEF2}|${CHEF}`, 30);
  line = cmd('feast', CHEF2);
  ok(/Nobody is here to feast/.test(line) && !C.usedToday(CHEF2, 'feast'), 'guests who feasted today are not fed again, and a feast with nobody left is not spent', line);

  // Defense, Shield over the Fallen
  const downed = new Set([FALLEN]);
  globalThis.__dboIsDowned = (x) => downed.has(x >>> 0);
  globalThis.__dboCombat = new Map();
  ONLINE.length = 0; ONLINE.push(WALL, FALLEN, FOE);
  DIST.set(`${WALL}|${FALLEN}`, 1.5);
  line = cmd('shieldover', WALL);
  ok(/You stand over/.test(line) && C.usedToday(WALL, 'shieldover'), 'standing over the fallen player near, the guard begins', line);
  ok(globalThis.__dboCapstoneGuarded(FALLEN, FOE) === true && /stands over them/.test(last(FOE)), 'while it holds, a foe\'s finishing blow is refused, and the foe is told');
  globalThis.__dboCombat.set(WALL, { staggerAt: Date.now() + 1, guardBrokenUntil: 0 });
  ok(globalThis.__dboCapstoneGuarded(FALLEN, FOE) === false, 'a stagger on the guard ends it');
  ok(/spent/.test(cmd('shieldover', WALL)), '...and the day\'s use is gone');
  const WALL2 = 0xff00030c; gm(WALL2, 'defense'); DIST.set(`${WALL2}|${FALLEN}`, 1); globalThis.__dboCombat = new Map();
  cmd('shieldover', WALL2);
  DIST.set(`${WALL2}|${FALLEN}`, 5);
  ok(globalThis.__dboCapstoneGuarded(FALLEN, FOE) === false, 'stepping away ends it');
  DIST.set(`${WALL2}|${FALLEN}`, 1);
  const g = globalThis.__dboCapstoneGuards; g.set(FALLEN, { guard: WALL2, at: Date.now(), until: Date.now() - 1 });
  ok(globalThis.__dboCapstoneGuarded(FALLEN, FOE) === false, 'and so does the time running out');

  // Martial Arts, Second Wind
  ok(globalThis.__dboCapstoneSecondWind(MONK) === true && C.usedToday(MONK, 'secondwind'), 'a Martial Arts Grandmaster down with bare fists gets a second wind');
  ok(globalThis.__dboCapstoneSecondWind(MONK) === false, '...once a day');
  const MONK2 = 0xff00030d; gm(MONK2, 'unarmed');
  put(MONK2, 'inventory', { entries: [{ baseId: STAFF, count: 1, worn: true }] });
  ok(globalThis.__dboCapstoneSecondWind(MONK2) === true, 'with a staff in hand too');
  const MONK3 = 0xff00030e; gm(MONK3, 'unarmed');
  put(MONK3, 'inventory', { entries: [{ baseId: IRONSWORD, count: 1, worn: true }] });
  ok(globalThis.__dboCapstoneSecondWind(MONK3) === false && !C.usedToday(MONK3, 'secondwind'), 'not with a sword in hand, and the day is not spent');
  put(MONK3, 'inventory', { entries: [{ baseId: PLATE, count: 1, worn: true }] });
  ok(globalThis.__dboCapstoneSecondWind(MONK3) === false, 'not in heavy armour');
  ok(globalThis.__dboCapstoneSecondWind(FOE) === false, 'and nobody below 100');
  try { fs.unlinkSync(VEINS); } catch (e) { /* the OS clears it */ }
  C = load({ capstones: { enabled: true, miner: { enabled: true, veinsFile: VEINS } } });
  put(DIGGER, 'private.dboCapstones', {});
  ok(/No vein survey is loaded/.test(cmd('prospect', DIGGER)) && !C.usedToday(DIGGER, 'prospect'), 'without the private vein survey, the Miner is told and nothing is spent');

  // Their hooks in downed.js and dungeons.js
  const DOWNED = fs.readFileSync(path.join(ROOT, 'downed.js'), 'utf8');
  ok(/guarded = typeof globalThis\.__dboCapstoneGuarded === 'function' && !!globalThis\.__dboCapstoneGuarded\(tgt, agg\);[\s\S]{0,120}if \(!guarded && since >= C\.finishGraceSeconds/.test(DOWNED), 'downed.js refuses the finishing blow on a guarded player');
  ok(/S\.downed\.set\(a, d\);[\s\S]{0,300}__dboCapstoneSecondWind\(a\)[\s\S]{0,300}revive\(a, 0, 'a second wind', \{ at: C\.secondWindHealth \}\)/.test(DOWNED), 'downed.js raises a second wind through revive, as the down lands');
  const DUNG = fs.readFileSync(path.join(ROOT, 'dungeons.js'), 'utf8');
  ok(DUNG.indexOf('__dboCapstoneBreak(casterId, targetId)') > 0 && DUNG.indexOf('__dboCapstoneBreak(casterId, targetId)') < DUNG.indexOf('const tier = lockpickingTier(casterId);'), 'dungeons.js asks the Breaker before any pick rule');

  // ---- step 5b: Priest, Consecration (staff approve; a sidecar prayer.js re-reads) ----
  {
    const here0 = process.cwd();
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'capstones-consecrate-'));
    process.chdir(tmp);
    const PRIEST = 0xff000401, STAFFER = 0xff000402, CHAPEL = 0x0005d1;
    TYPES[CHAPEL] = 'CELL';
    gm(PRIEST, 'priest');
    put(PRIEST, 'private.dboDeity', { id: 'mara', name: 'Mara' });
    put(PRIEST, 'worldOrCellDesc', '3c:Skyrim.esm'); put(PRIEST, 'pos', [100, 200, 300]);
    const realGetId = mp.getIdFromDesc; mp.getIdFromDesc = (x) => parseInt(String(x).split(':')[0], 16);
    let reloaded = 0; globalThis.__dboPrayerConsecrated = { reload: () => { reloaded++; } };
    C = (() => { delete require.cache[path.join(ROOT, 'capstones.js')]; return require(path.join(ROOT, 'capstones.js'))({
      mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), who: (a) => `P${(a & 0xfff).toString(16)}`,
      cfg: { capstones: { enabled: true, priest: { enabled: true } } }, registerChatCommand: (n, f) => cmds.set(n, f), realNameOf: () => 'X',
      recordOf: (id) => (TYPES[id >>> 0] ? { record: { type: TYPES[id >>> 0], fields: [] } } : null), itemName: () => '?', isAdmin: (a) => a === STAFFER }); })();
    const file = () => JSON.parse(fs.readFileSync(path.join(tmp, 'consecrated-shrines.json'), 'utf8'));
    let line = cmd('consecrate', PRIEST);
    ok(/indoors/.test(line) && !fs.existsSync(path.join(tmp, 'consecrated-shrines.json')), 'outdoors: refused, nothing written', line);
    put(PRIEST, 'worldOrCellDesc', '5d1:Skyrim.esm');   // verify-formids: ignore - a made-up interior, on purpose
    line = cmd('consecrate', PRIEST);
    ok(/ask to consecrate this place to Mara \(c1\)/.test(line) && file().shrines[0].status === 'pending' && C.usedWithin(PRIEST, 'consecrate', 7), 'indoors: a request to staff, the week\'s use spent', line);
    ok(/a week after/.test(cmd('consecrate', PRIEST)), 'one a week');
    ok(/Only staff/.test(cmd('consecrate', PRIEST, 'approve c1')), 'a priest cannot approve their own');
    ok(/c1 Mara by P401/.test(cmd('consecrate', STAFFER, 'list')), 'staff see the waiting one');
    const r0 = reloaded, a0 = audits.length;
    ok(/approved/.test(cmd('consecrate', STAFFER, 'approve c1')) && file().shrines[0].status === 'approved' && reloaded === r0 + 1, 'staff approve it: written approved, and prayer.js told to re-read');
    ok(audits.slice(a0).some((t) => t === 'CAPSTONE P402 approved consecration c1'), '...audited', audits.slice(a0));
    put(PRIEST, 'private.dboCapstones', {});
    line = cmd('consecrate', PRIEST);
    ok(/already a shrine of Mara near here \(c1\)/.test(line), 'a second shrine of the same god close by is refused', line);
    put(PRIEST, 'pos', [100, 200 + 70 * 400, 300]);
    cmd('consecrate', PRIEST);
    ok(/denied/.test(cmd('consecrate', STAFFER, 'deny c2')) && !C.usedWithin(PRIEST, 'consecrate', 7), 'a denial gives the week\'s use back');
    ok(/removed/.test(cmd('consecrate', STAFFER, 'remove c1')) && file().shrines[0].status === 'removed', 'staff can take an approved shrine away');
    mp.getIdFromDesc = realGetId; delete globalThis.__dboPrayerConsecrated;
    process.chdir(here0);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* the OS clears it */ }
    C = load(ALL4 || CFG);
  }

  // ---- step 5c: Archery, Clean Kill ----
  {
    const ARCHER = 0xff000501, WOLF = 0xff000502, WOLF2 = 0xff000503, PLAYERX = 0xff000504, BOW = 0x00013985;
    TYPES[BOW] = 'WEAP'; WSKILL[BOW] = 'archery';
    gm(ARCHER, 'archery'); put(ARCHER, 'profileId', 60); put(PLAYERX, 'profileId', 61);
    C = load({ capstones: { enabled: true, archery: { enabled: true } } });
    globalThis.__dboCapstoneHit(ARCHER, WOLF, BOW);
    ok(globalThis.__dboCapstoneDeath(WOLF) === true && getp(WOLF, 'private.dboCleanKill').by === ARCHER, "a beast whose last blow was the Grandmaster's arrow is a clean kill");
    globalThis.__dboCapstoneHit(ARCHER, WOLF2, BOW); globalThis.__dboCapstoneHit(ARCHER, WOLF2, IRONSWORD);
    ok(globalThis.__dboCapstoneDeath(WOLF2) === false && !getp(WOLF2, 'private.dboCleanKill'), '...not when the last blow was a sword');
    globalThis.__dboCapstoneHit(ARCHER, PLAYERX, BOW);
    ok(!globalThis.__dboCapstoneLastHit.has(PLAYERX), 'a blow on a player is not even tracked');
    ok(globalThis.__dboCapstoneDeath(PLAYERX) === false && !getp(PLAYERX, 'private.dboCleanKill'), '...and never a player');
    globalThis.__dboCapstoneHit(FOE, WOLF2, BOW);
    ok(globalThis.__dboCapstoneDeath(WOLF2) === false, '...nor an archer below 100');
    const GM_SRC = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
    ok(/__dboCapstoneHit\(agg, tgt, Number\(sourceId\) >>> 0\)/.test(GM_SRC) && /__dboCapstoneDeath\(Number\(actorId\) >>> 0\)/.test(GM_SRC), 'gamemode.js reports every landed blow and every death');
    ok(/clean = !!mp\.get\(ses\.corpse, 'private\.dboCleanKill'\)[\s\S]{0,40}\n\s*const win = !v\.bad && \(cutsWin \|\| clean\)/.test(GM_SRC), "skinning a clean kill: a slipped cut no longer tears the hide (a refused report still loses)");
    ok(/__dboDecorTrophySkinned\(a, skinRaceEdid\(ses\.corpse\)\)/.test(GM_SRC), 'a won skinning offers decor.js the body for a trophy');
  }

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
