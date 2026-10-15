// Blackreach, the open-world dungeon (Nate, 14 Oct: "super hard and the loot really worth it"; check 5 of the Skyrim
// release, 15 Oct). One harness per rule, against the real blackreach.json, wildlife.js, blackreach.js, dungeons.js,
// gamemode-config.json and loot.json:
//   1. the data: Nate's 25 actors at his spots, every base an NPC_ (or a leveled list down to them), lore-true kinds only
//      (Falmer, Dwemer automatons, chaurus, frostbite spiders, frost trolls, giants, wisps), no dragon, no people, nothing
//      from the Zcells (the BlackreachLocation lease); ten chests, each guarded; anchors no DragonBreak plugin touches;
//   2. the zones: permanent, hostile, the Master pick and count, a respawn per slot (bosses longer), ≤ 40 a zone, names
//      unique and ≤ 64, the other wild zones unchanged; vanilla false keeps Nate's 25 only;
//   3. the chests: guarded, earned (the boss when there is one; party and companions count), rested per account
//      (kept across a reload in blackreach-cooldowns.json), never a roll without dungeons.js;
//   4. the loot: the real dungeons.js roll at Master, 2,000 times: no artifact, no dragon bone or scales, no Ebony, Daedric,
//      Stalhrim, Orcish, dragon gear, no ingot above the cap; gear of tier 3-4 (a boss chest's Master row); Dwemer and
//      Falmer pieces only of Skyrim;
//   5. Blackreach's enemies never hurt each other; the Aetherium Forge is never leased; owned_spawns.py leaves Blackreach.
//   node tests/blackreach-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!c) fails++; };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

const BR = readJson('blackreach.json');
const CFG = readJson('gamemode-config.json');
const W = readJson('wildlife.json');
const O = readJson('owned-spawns.json');

// ---- 1. the data ---------------------------------------------------------------------------------------------------
const nate = BR.spots.filter((s) => s.nate);
const NATE_BASES = { DLC1EncFalmer02MeleeHeavy: 7, EncFalmer02Shaman: 2, EncFalmer04MeleeBoss: 2, DLC2EncDwarvenBallista01: 1, EncDwarvenCenturion01: 1,
  DrV_DwemerBurrower: 1, DLC1LD_EncDwarvenSphere03: 1, DrV_DwemerSentry: 1, EncWisp: 2, EncWispMother: 1, DLC1EncFalmer06SpellswordBoss: 1, DLC1EncFalmer06Shaman: 1,
  DD_StoneGiant: 3, DA06GiantBoss: 1 };
const count = {}; for (const s of nate) count[s.edid] = (count[s.edid] || 0) + 1;
ok(nate.length === 25 && JSON.stringify(Object.keys(NATE_BASES).sort().map((k) => [k, count[k]])) === JSON.stringify(Object.keys(NATE_BASES).sort().map((k) => [k, NATE_BASES[k]])),
  "Nate's 25 actors, base by base as the census lists them (DLE 1D1F4C-1D1F9B)", count);
ok(nate.every((s) => s.baseType === 'NPC_' && s.options.length === 1 && s.options[0][1] === s.base), "each of Nate's is its own NPC_ base, read from the plugins (no leveled stand-in)");
ok(nate.every((s) => /:DragonBreak Online Edits\.esp$/.test(s.src)) && nate.filter((s) => s.pluginDisabled).length === 12, "all placed by DragonBreak Online Edits; 12 Initially Disabled, 13 enabled (the server spawns both)");
const LORE = new Set(['brfalmer', 'brdwemer', 'brchaurus', 'brspider', 'brtroll', 'brgiant', 'brwisp']);
ok(BR.spots.every((s) => LORE.has(s.kind)), 'every kind is Blackreach\'s own: Falmer, Dwemer automatons, chaurus, frostbite spiders, frost trolls, giants, wisps', [...new Set(BR.spots.map((s) => s.kind))]);
const RACE_OF_KIND = { brfalmer: /^FalmerRace$/, brdwemer: /^(Dwarven(Sphere|Spider|Centurion)Race|DLC2DwarvenBallistaRace|DrV_Dwemer\w+Race)$/, brchaurus: /^(Chaurus|ChaurusReaper|DLC1ChaurusHunter)Race$/,
  brspider: /^FrostbiteSpiderRace(Large)?$/, brtroll: /^TrollFrostRace$/, brgiant: /^(Giant|DD_StoneGiant)Race$/, brwisp: /^(Wisp|Witchlight)Race$/ };
ok(BR.spots.every((s) => s.races.length && s.races.every((r) => RACE_OF_KIND[s.kind].test(r))), 'each kind is what its race says (read through templates and leveled lists)', BR.spots.filter((s) => !s.races.every((r) => RACE_OF_KIND[s.kind].test(r))).map((s) => [s.src, s.races]));
ok(BR.spots.every((s) => !s.person && !s.races.some((r) => /Dragon/i.test(r))), 'no people and no dragon are spawned (the thralls wait on Nate; dragons are off)');
ok(BR.skipped.some((x) => /BlackreachDragon/.test(x[1])) && BR.skipped.filter((x) => /thralls/.test(x[2])).length === 7, 'the vanilla dragon and the 7 Falmer thralls are listed as left out');
ok(BR.spots.every((s) => s.world === '1ee62:Skyrim.esm') && BR.skipped.filter((x) => /lease/.test(x[2])).length === 32, 'all in the Blackreach world; the 32 Zcell and sewer placements stay the BlackreachLocation lease\'s');
const LEASED = JSON.stringify(readJson('dungeons.json').dungeons.find((d) => d.id === 'BlackreachLocation')).toLowerCase();
ok(BR.spots.every((s) => !LEASED.includes(s.src.toLowerCase())), 'no Blackreach spot is also a placement of the lease');
const OWNED_PLUGINS = /:(DragonBreak[^:]*|LostArk_Kamen|\[Kirax\][^:]*)\.esp$/i;
ok(BR.spots.every((s) => s.ref && !OWNED_PLUGINS.test(s.ref) && s.anchorDist <= 2500), 'every anchor is a ref no DragonBreak plugin places or overrides, within 2500 units',
  BR.spots.filter((s) => !(s.anchorDist <= 2500)).map((s) => [s.src, s.anchorDist]));
ok(BR.spots.filter((s) => s.anchorSameCell).length >= 70, 'nearly all in the spot\'s own exterior cell (PlaceAtMe puts the copy in the anchor\'s cell)', BR.spots.filter((s) => !s.anchorSameCell).map((s) => s.src));
ok(BR.chests.length === 10 && BR.chests.every((c) => /:DragonBreak Online Edits\.esp$/.test(c.ref) && c.guards.length >= 3), "Nate's ten chests, each with three or more guards within 2500 units", BR.chests.map((c) => [c.ref, c.guards.length]));
ok(BR.chests.filter((c) => c.guards.some((g) => BR.spots.find((s) => s.src === g).boss)).length >= 6, 'six or more chests have a boss among their guards');
ok(new Set(BR.spots.map((s) => s.zone)).size === BR.spots.length && BR.spots.every((s) => s.zone.length <= 64 && /^wild:br[a-z]+:b[0-9a-f]+-[a-z0-9]+$/.test(s.zone)), 'zone names unique, ≤ 64 characters, wild:br<kind>:b<id>-<plugin>');
ok(BR.sources && /^88e104b2/.test(BR.sources['DragonBreak Online Edits.esp']), 'generated from the release DLE 88e104b2', BR.sources);

// ---- 2. the zones (the real wildlife.js) ----------------------------------------------------------------------------
const PLUGINS = { 'skyrim.esm': 0x00, 'dawnguard.esm': 0x02, 'dragonborn.esm': 0x04, 'bsheartland.esm': 0x08, 'bsassets.esm': 0x07, 'druadach.esm': 0x0f, 'dragonbreak online edits.esp': 0x3c, 'dragonbreak.esp': 0x3b };
const idOf = (d) => { const [h, p] = String(d).split(':'); const i = PLUGINS[String(p || '').toLowerCase()]; return i === undefined ? (0x7f000000 | (parseInt(h, 16) & 0xffffff)) >>> 0 : ((i << 24) | (parseInt(h, 16) & 0xffffff)) >>> 0; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-blackreach-'));
const cwd = process.cwd();
const savedInterval = global.setInterval, savedClear = global.clearInterval, savedTimeout = global.setTimeout;
const main = async () => {
  for (const f of ['wildlife.json', 'owned-spawns.json', 'loot.json', 'artifacts.json', 'blackreach.json', 'dragon-materials.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  process.chdir(dir);
  global.setInterval = () => ({ unref() {} }); global.clearInterval = () => {};
  globalThis.__dboWildFactionAudit = ' (skipped in the harness)';
  const props = new Map();
  const loadWild = (cfg) => {
    delete require.cache[path.join(ROOT, 'wildlife.js')];
    globalThis.__dboWildSig = undefined;
    require(path.join(ROOT, 'wildlife.js'))({ mp: { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v), getIdFromDesc: idOf },
      log: () => {}, personal: () => {}, system: () => {}, registerChatCommand: () => {}, giveItem: () => true, profileOf: () => 1,
      display: String, who: String, audit: () => {}, isAdmin: () => false, cfg, onlineActors: () => [], sendPacket: () => {} });
    return JSON.parse(fs.readFileSync(path.join(dir, 'NPC-Spawns.json'), 'utf8')).zones;
  };
  const zones = loadWild({ wildlife: CFG.wildlife, ownedSpawns: CFG.ownedSpawns, blackreach: CFG.blackreach });
  const br = zones.filter((z) => /^wild:br/.test(z.Name));
  const B = CFG.blackreach;
  ok(br.length === 75 && br.every((z) => BR.spots.some((s) => s.zone === z.Name)), 'wildlife.js writes the 75 Blackreach zones', br.length);
  ok(zones.filter((z) => /^wild:[^:]+:p[0-9a-f]+-/.test(z.Name)).length === O.spawns.length && zones.filter((z) => /^wild:[^:]+:\d+$/.test(z.Name)).length > 3000, 'the owned and generated wild zones are all still there');
  ok(br.every((z) => z.Hostile === true && z.ID === '1ee62:Skyrim.esm' && z.Size === B.radius && z.Despawn === B.despawnSeconds), 'each attacks on sight, in the Blackreach world, fills within radius and goes after despawnSeconds');
  const spotOf = (z) => BR.spots.find((s) => s.zone === z.Name);
  ok(br.every((z) => z.Respawn === (spotOf(z).boss ? B.bossRespawnSeconds : B.respawnSeconds)) && B.bossRespawnSeconds > B.respawnSeconds && B.respawnSeconds >= 900,
    `a kill comes back after ${B.respawnSeconds / 60} min, a boss after ${B.bossRespawnSeconds / 60} (per slot, kept across a despawn by NpcSpawnSystem)`);
  ok(br.every((z) => { const s = spotOf(z); const top = s.options.slice().sort((x, y) => x[0] - y[0]).pop()[1]; return z.NPC[0].id === top; }), 'each spawns the strongest option of its leveled list (pick high, a Master lease\'s)');
  ok(br.every((z) => z.Anchor === spotOf(z).ref && z.Heading === spotOf(z).heading && JSON.stringify(z.POS) === JSON.stringify(spotOf(z).pos)), 'each stands on its own spot and heading, placed from its anchor');
  const n = (pred) => br.filter((z) => pred(spotOf(z))).reduce((a, z) => a + z.NPC[0].count, 0);
  const nateOrdinary = nate.filter((s) => !s.boss).length;
  ok(br.filter((z) => spotOf(z).boss).every((z) => z.NPC[0].count === 1), 'a boss is always alone');
  ok(br.filter((z) => !spotOf(z).nate).every((z) => z.NPC[0].count === 1), 'a vanilla spot spawns one (vanillaCountMult 1)');
  const deep = n((s) => s.nate && !s.boss);
  ok(deep >= nateOrdinary * 1.4 && deep <= nateOrdinary * 1.8 && br.every((z) => z.NPC[0].count <= 2), `Nate's ${nateOrdinary} ordinary spots spawn ${deep} (Master's 1.6, by each spot's own id)`);
  const total = br.reduce((a, z) => a + z.NPC[0].count, 0);
  console.log(`      Blackreach holds ${total} enemies when every zone is full (live budget npcLiveBudget 150 for the whole server; zones fill within ${B.radius} units)`);
  ok(total <= 110, 'all of Blackreach at once stays under 110 actors', total);
  const only = loadWild({ wildlife: CFG.wildlife, ownedSpawns: CFG.ownedSpawns, blackreach: Object.assign({}, B, { vanilla: false }) }).filter((z) => /^wild:br/.test(z.Name));
  ok(only.length === 25 && only.every((z) => spotOf(z).nate), 'vanilla false keeps Nate\'s 25 only');
  const off = loadWild({ wildlife: CFG.wildlife, ownedSpawns: CFG.ownedSpawns, blackreach: Object.assign({}, B, { enabled: false }) }).filter((z) => /^wild:br/.test(z.Name));
  ok(off.length === 0, 'enabled false spawns nothing in Blackreach');

  // ---- 3. the chests (the real blackreach.js) ------------------------------------------------------------------------
  const P1 = 0x14, P2 = 0x15, P3 = 0x16, COMPANION = 0xff00a001;
  const profiles = { [P1]: 101, [P2]: 102, [P3]: 103 };
  const said = [], given = [], audits = [];
  props.set(`${COMPANION}|ff_companionOf`, P2);
  const chest = BR.chests.find((c) => c.guards.some((g) => BR.spots.find((s) => s.src === g).boss));
  const plain = BR.chests.find((c) => !c.guards.some((g) => BR.spots.find((s) => s.src === g).boss));
  const CH = idOf(chest.ref), PL = plain ? idOf(plain.ref) : 0;
  props.set(`${CH}|pos`, chest.pos);
  if (PL) props.set(`${PL}|pos`, plain.pos);
  const guardZones = chest.guards.map((g) => BR.spots.find((s) => s.src === g));
  const bossZone = guardZones.find((s) => s.boss).zone, minionZone = (guardZones.find((s) => !s.boss) || guardZones[1]).zone;
  let nextNpc = 0xff000100;
  const spawn = (zone, pos, dead = false) => { const id = nextNpc++; props.set(`${id}|private.npcSpawner`, zone); props.set(`${id}|isDead`, dead); props.set(`${id}|pos`, pos); return id; };
  const writeSpawned = (ids) => fs.writeFileSync(path.join(dir, 'zone-spawns.json'), JSON.stringify(ids));
  let lootCalls = [];
  const loadBr = (cfg) => {
    delete require.cache[path.join(ROOT, 'blackreach.js')];
    require(path.join(ROOT, 'blackreach.js'))({ mp: { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v), getIdFromDesc: idOf, lookupEspmRecordById: () => null },
      log: () => {}, personal: (a, t) => said.push([a, t]), registerChatCommand: () => {}, giveItem: (a, b, c) => { given.push([a, b, c]); return true; }, profileOf: (a) => (profiles[a] !== undefined ? profiles[a] : -1),
      display: String, who: String, audit: (t) => audits.push(t), isAdmin: () => false, cfg, onlineActors: () => [], sendPacket: () => {} });
  };
  // A refusal repeats its line at most every 1.5 s; the chest is used here 2 s apart on a clock of the harness's own
  const realNow = Date.now; let clock = realNow();
  Date.now = () => clock;
  const use = (ch, a) => { clock += 2000; return globalThis.__dboBlackreachChest(ch, a); };
  globalThis.__dboOpenWorldLoot = (...args) => { lootCalls.push(args); return [{ baseId: 0xf, count: 40 }, { baseId: idOf('a:Skyrim.esm'), count: 1 }]; };
  globalThis.__dboDungeons = { memberOf: new Map([[101, 101], [103, 101]]), parties: new Map([[101, { leader: 101, members: new Set([101, 103]) }]]) };
  loadBr({ blackreach: B });
  const last = () => (said[said.length - 1] || [])[1] || '';
  ok(use(0x12345, P1) === null, 'any other container is not Blackreach\'s (null, the chain goes on)');
  ok(use(CH, 0xff000900) === false && !given.length, 'a creature opening the chest takes nothing');
  const boss = spawn(bossZone, chest.pos), minion = spawn(minionZone, chest.pos);
  writeSpawned([boss, minion]);
  ok(use(CH, P1) === false && /guardians still stand \(2\)/.test(last()) && !given.length, 'guarded: while its guards stand near it, the chest refuses', last());
  props.set(`${minion}|isDead`, true);
  globalThis.__dboBlackreachHit(P1, minion); globalThis.__dboBlackreachDeath(minion, P1);
  ok(use(CH, P1) === false && /still stand \(1\)/.test(last()), 'one guard down, the boss still up: refused');
  props.set(`${boss}|isDead`, true);
  globalThis.__dboBlackreachDeath(boss, 0);   // the boss fell to no one (a fall, another group's fight, a despawn)
  ok(use(CH, P1) === false && /fight its guardian/.test(last()) && !given.length, 'earned: a minion\'s kill is not enough for a boss chest; its boss must fall to you', last());
  ok(use(CH, P2) === false && /fight its guardian/.test(last()), '...nor does a passer-by who fought nothing get it');
  const boss2 = spawn(bossZone, chest.pos, false);
  globalThis.__dboBlackreachHit(COMPANION, boss2);       // P2's companion fights the next boss
  props.set(`${boss2}|isDead`, true); globalThis.__dboBlackreachDeath(boss2, P1);   // P1 lands the kill
  writeSpawned([boss2]);
  lootCalls = [];
  ok(use(CH, P1) === false && given.length === 2 && /force the chest open/.test(last()), 'P1, who landed the boss kill, gets the roll straight into the pack', last());
  ok(lootCalls.length === 1 && JSON.stringify(lootCalls[0]) === JSON.stringify(['nightmare', true, 'skyrim', 'BlackreachLocation']), 'the roll is dungeons.js\'s Master boss roll from Skyrim\'s gear', lootCalls);
  ok(audits.some((t) => /^BLACKREACH /.test(t)), 'the loot is audited');
  given.length = 0;
  ok(use(CH, P1) === false && /emptied this chest already/.test(last()) && !given.length, `rested: the same account gets nothing more for ${B.chestHours} hours`, last());
  ok(use(CH, P2) === false && given.length === 2, 'P2, whose companion fought the boss, gets their own roll');
  given.length = 0;
  ok(use(CH, P3) === false && given.length === 2, 'P3, in P1\'s party, shares the party\'s credit');
  // Kept across a hot reload and a restart: the state file (written off the game loop)
  // (written in the same tick as the roll, before the pay: save-before-pay-harness.js)
  {
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'blackreach-cooldowns.json'), 'utf8'));
    ok([101, 102, 103].every((p) => Number(saved[`${p}:${CH.toString(16)}`]) > Date.now() + (B.chestHours - 1) * 3600000), 'blackreach-cooldowns.json keeps each account\'s rest', saved);
    globalThis.__dboBlackreachRest = undefined;
    loadBr({ blackreach: B });
    given.length = 0;
    ok(use(CH, P1) === false && !given.length && /emptied/.test(last()), '...so a restart does not reset it');
    // credit runs out
    const credit = globalThis.__dboBlackreachCredit.get(bossZone);
    for (const k of credit.keys()) credit.set(k, Date.now() - (B.creditMinutes + 1) * 60000);
    globalThis.__dboBlackreachRest = new Map();
    loadBr({ blackreach: B });
    ok(use(CH, P2) === false && /fight its guardian/.test(last()), `credit lasts ${B.creditMinutes} minutes`);
    if (PL) {
      const g = spawn(BR.spots.find((s) => s.src === plain.guards[0]).zone, plain.pos, true);
      globalThis.__dboBlackreachHit(P1, g); globalThis.__dboBlackreachDeath(g, 0);
      writeSpawned([g]);
      given.length = 0;
      ok(use(PL, P1) === false && given.length === 2, 'a chest without a boss yields to whoever fought any of its guards');
    }
    // No dungeons.js: refused, and the rest is not spent
    globalThis.__dboBlackreachRest = new Map();
    for (const k of credit.keys()) credit.set(k, Date.now());
    const keep = globalThis.__dboOpenWorldLoot; globalThis.__dboOpenWorldLoot = undefined;
    given.length = 0;
    ok(use(CH, P2) === false && !given.length && /jammed/.test(last()) && !globalThis.__dboBlackreachRest.size, 'without dungeons.js the chest refuses and the rest is not spent');
    globalThis.__dboOpenWorldLoot = keep;
    // ---- 5. allies ----
    const a = spawn(bossZone, [0, 0, 0]), b = spawn(minionZone, [0, 0, 0]), wolf = nextNpc++;
    props.set(`${wolf}|private.npcSpawner`, 'wild:wolf:12');
    ok(globalThis.__dboBlackreachAllies(a, b) === true && globalThis.__dboBlackreachAllies(a, wolf) === false && globalThis.__dboBlackreachAllies(a, P1) === false, 'two Blackreach spawns are allies; a wolf or a player is not');
  }
  Date.now = realNow;
  const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
  ok(/const dungeonAllies = [\s\S]{0,400}__dboBlackreachAllies\(a, b\)\) return true;/.test(gm), 'gamemode.js dungeonAllies refuses a Blackreach spawn\'s hit on another');
  ok(/__dboBlackreachChest\(targetId >>> 0, casterId >>> 0\)[\s\S]{0,200}\n  if \(globalThis\.__dboCampChest\)/.test(gm) && /__dboBlackreachDeath\(Number\(actorId\)/.test(gm) && /__dboBlackreachHit\(agg, tgt\)/.test(gm) && /require\(BLACKREACH_JS\)/.test(gm),
    'gamemode.js wires the chest (before the camp chests), the hit, the death and the module');
  ok(!/mp\.on\(/.test(fs.readFileSync(path.join(ROOT, 'blackreach.js'), 'utf8')), 'blackreach.js registers no mp.on listener (hot reload stacks them)');
  ok(!/__dboRaceGold\(/.test(fs.readFileSync(path.join(ROOT, 'blackreach.js'), 'utf8')), 'a Blackreach chest\'s coin is no Imperial Luck (racial-harness: only dungeons, camps and contracts pay it)');

  // ---- 4. the loot (the real dungeons.js) ------------------------------------------------------------------------------
  {
    const descs = new Map(); const ids2 = new Map(); let next = 0x100;
    const id2 = (d) => { const k = String(d).toLowerCase(); if (!ids2.has(k)) { ids2.set(k, next); descs.set(next, k); next++; } return ids2.get(k); };
    for (const f of ['ayleid-loot.json', 'expeditions.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, 'dungeons.json'), JSON.stringify({ dungeons: [] }));
    global.setTimeout = () => 0;
    globalThis.__dboDungeons = undefined; globalThis.__dboOpenWorldLoot = undefined;
    delete require.cache[path.join(ROOT, 'dungeons.js')];
    require(path.join(ROOT, 'dungeons.js'))({
      mp: { get: () => undefined, set: () => {}, getIdFromDesc: id2, getDescFromId: (i) => descs.get(i) || '', lookupEspmRecordById: () => ({ record: null }) },
      log: () => {}, personal: () => {}, system: () => {}, audit: () => {}, registerChatCommand: () => {}, onUi: () => {}, openWidget: () => true, closeWidget: () => true,
      sendPacket: () => true, findByName: () => 0, display: String, who: String, profileOf: () => -1, nameOf: () => 'P', onlineActors: () => [], isAdmin: () => false,
      giveItem: () => true, cfg: { dungeons: CFG.dungeons }, every: () => {},
    });
    global.setTimeout = savedTimeout;
    ok(typeof globalThis.__dboOpenWorldLoot === 'function', 'dungeons.js exports __dboOpenWorldLoot');
    const LOOT = readJson('loot.json').pools;
    const nameOf = new Map(); for (const items of Object.values(LOOT)) for (const it of items) nameOf.set(String(it.id).toLowerCase(), it.name);
    const MAT = readJson('loot-materials.json').items;
    const TIER = (fam) => ({ iron: 1, hide: 1, leather: 1, studded: 1, wood: 1, goblin: 1, ancient_nord: 1, falmer: 1, forsworn: 1, bronze: 1, copper: 1, steel: 2, imperial: 2, brass: 2, dwarven: 2, elven: 2, bonemold: 2, chitin: 2, mithril: 2, silver: 2, vampire: 2, ancient_nord_honed: 2, falmer_honed: 2, ancient_imperial: 2, ayleid: 2 })[fam];
    const art = readJson('artifacts.json').patterns; const ART = new RegExp(art.map((x) => `(?:${x})`).join('|'), 'i');
    const DRAGON = new RegExp(`^(?:${readJson('dragon-materials.json').editorIds.join('|')})$`, 'i');
    const BANNED = /Ebony|Daedric|Dragon(?:plate|scale|bone)|DLC1Keeper|DragonHide|Dragonsteel|DragonPriestDagger|Orcish|Orichalcum|Stalhrim/i;
    const bad = [], low = [], tiers = { 3: 0, 4: 0, other: 0 }, fams = {};
    let rolls = 0, gold = 0;
    for (let i = 0; i < 2000; i++) {
      const got = globalThis.__dboOpenWorldLoot('nightmare', true, 'skyrim', 'BlackreachLocation');
      rolls++;
      for (const e of got) {
        const d = descs.get(e.baseId) || ''; const nm = nameOf.get(d) || d;
        if (d === 'f:skyrim.esm') { gold++; continue; }
        if (ART.test(nm) || DRAGON.test(nm) || BANNED.test(nm) || globalThis.__dboLootAboveCap(d, 'metal')) bad.push(nm);
        const fam = MAT[d];
        if (fam && !['clothing', 'staff', 'misc', 'tool'].includes(fam)) {
          if (!globalThis.__dboLootable(d)) { bad.push(`${nm} (not lootable: ${fam})`); continue; }
          const t = TIER(fam) || ({ steelplate: 3, scaled: 3, elven_gilded: 3, nordic: 3, glass: 4, amber: 4 })[fam];
          if (t === 3 || t === 4) tiers[t]++; else { tiers.other++; low.push(`${nm}:${fam}`); }
          fams[fam] = (fams[fam] || 0) + 1;
        }
      }
    }
    ok(gold === rolls, `every Blackreach roll holds coin (${gold}/${rolls})`);
    ok(!bad.length, 'no artifact, no dragon bone or scales, no Ebony, Daedric, Stalhrim, Orcish or dragon gear, no ingot above the cap, no capped gear in 2,000 rolls', [...new Set(bad)].slice(0, 20));
    const cap = globalThis.__dboLootCap;
    console.log(`      loot cap '${cap}'; gear in 2,000 rolls: tier 3 ${tiers[3]}, tier 4 ${tiers[4]}, below ${tiers.other}; families ${JSON.stringify(fams)}`);
    const pieces = tiers[3] + tiers[4] + tiers.other;
    ok(pieces >= 2000, 'every roll holds a piece of gear (a boss chest\'s certain piece)', pieces);
    // Under the 1 Oct ceiling (lootTiers.cap 'steel', Jake and Nate) no tier above it is loot anywhere, Blackreach included;
    // with the cap lifted the Master boss row's tiers 3-4 come through, glass and amber (4) ahead of tier 3
    if (cap === 'none') ok(tiers[3] + tiers[4] >= pieces * 0.9 && tiers[4] > tiers[3], 'cap lifted: the gear is the Master boss row, tier 4 ahead of tier 3', tiers);
    else ok(tiers[3] + tiers[4] === 0 && Object.keys(fams).every((f) => ['steel', 'iron', 'hide', 'leather', 'studded', 'wood', 'falmer', 'forsworn', 'bronze', 'copper', 'ancient_nord', 'goblin', 'silver', 'imperial', 'trinket'].includes(f) || TIER(f) <= 2), `cap '${cap}': nothing above it, as at every other loot path`, fams);
    // the theme piece, as blackreach.js draws it: Dwemer and Falmer gear of Skyrim, lootable
    const theme = [].concat(LOOT.armor || [], LOOT.weapons || []).filter((it) => /^(?:DLC1)?(?:Armor)?(?:Dwarven|Falmer)/.test(it.name) && globalThis.__dboLootable(it.id) && globalThis.__dboLootInProvince(it, 'skyrim') && !globalThis.__dboBannedLoot.test(it.name));
    ok(theme.length >= 8 && theme.every((it) => /^(dwarven|falmer|falmer_honed)$/.test(MAT[String(it.id).toLowerCase()] || '')), `the Dwemer and Falmer pieces a chest adds come from ${theme.length} lootable Skyrim items of those two families`, theme.map((it) => it.name).slice(0, 8));
  }

  // ---- 5. the Forge, and owned_spawns.py ------------------------------------------------------------------------------
  ok((CFG.dungeons.exclude || []).includes('DLC1BthalftAetheriumForgeLocation') && readJson('dungeons.json').dungeons.some((d) => d.id === 'DLC1BthalftAetheriumForgeLocation'), 'the Aetherium Forge stays closed: dungeons.exclude names its lease, which dungeons.json has');
  const os_ = fs.readFileSync(path.join(ROOT, 'tools/spawns/owned_spawns.py'), 'utf8');
  ok(/skipped\['blackreach'\]\.append\(src\)/.test(os_) && /'--blackreach'/.test(os_), 'owned_spawns.py leaves Blackreach\'s actors to blackreach.json (no second copy as an owned spawn)');
  ok(!O.spawns.some((s) => BR.spots.some((b) => b.src.toLowerCase() === s.src.toLowerCase())), 'owned-spawns.json holds none of them today');
  const nd = CFG.npcDamage.takenByKind || {};
  ok([...LORE].every((k) => nd[k] > 0 && nd[k] < 1), 'players deal less to every Blackreach kind (npcDamage.takenByKind, super hard)', nd);
  ok(readJson('patch-notes.json').length >= 0, 'patch-notes.json readable');
};
main().catch((e) => ok(false, 'harness ran', e.stack)).finally(() => {
  global.setInterval = savedInterval; global.clearInterval = savedClear; global.setTimeout = savedTimeout;
  process.chdir(cwd);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(fails ? `${fails} FAILED` : 'all checks passed');
  process.exit(fails ? 1 : 0);
});
