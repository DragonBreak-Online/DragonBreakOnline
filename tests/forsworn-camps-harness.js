// The Forsworn camps, wave 1 (Nat, 25 Oct: "make the Reach's Forsworn camps work like our giant camps"). Against the real
// wildlife.js, contracts.js's kind words and forsworn-camps.json (tools/forsworn/forsworn_camps_build.py):
//   1. the data: four camps, every spot a hostile-able Forsworn or hagraven with options, nothing at Karthspire or Sky Haven
//      Temple, nothing within the 8000-unit guard and town buffer;
//   2. wildlife.js writes one hostile wild:fw* zone per spot, with the role's respawn and the boss's 'high' pick, and none
//      when forswornCamps.enabled is false (the rollback);
//   3. the camp chests are loot nodes for players (once per player per chest per hour), a boss chest rolls the boss schematic;
//   4. every Forsworn spawn gets ForswornFaction and HagravenFaction (camp-mates allied, a Briarheart spared);
//   5. contracts.js reads a Forsworn spawn as 'forsworn' (tier 2) and a hagraven as 'hagraven' (tier 3).
//   node tests/forsworn-camps-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!c) fails++; };
const FW = JSON.parse(fs.readFileSync(path.join(ROOT, 'forsworn-camps.json'), 'utf8'));
const KARTHSPIRE = [-132337, 6656];

// ---- 1. the data ----
const spots = FW.camps.flatMap((c) => c.spots.map((s) => Object.assign({ camp: c.id }, s)));
ok(FW.camps.map((c) => c.id).join() === 'lostvalley,redeagle,bleakwind,cradlestone', 'wave 1: Lost Valley (with Bard\'s Leap), Red Eagle, Bleakwind Bluff, Cradle Stone Tower', FW.camps.map((c) => c.id));
ok(spots.length >= 25 && spots.every((s) => /^wild:fw(melee|archer|magic|boss|hagraven):[a-z]+-[0-9a-f]+-[a-z0-9]+$/.test(s.zone) && s.options.length && s.ref && ['3c:Skyrim.esm', '2b101:Skyrim.esm'].includes(s.world)),
  `${spots.length} spots, each named wild:fw<role>:<camp>-<id>-<plugin>, with options and an anchor in Tamriel (or Red Eagle'''s own RedEagleRedoubtWorld)`, spots.slice(0, 2));
ok(spots.every((s) => /Forsworn|Hagraven/.test(s.options.map((o) => o[2]).join(' '))), 'every spot puts down a Forsworn or a hagraven');
ok(spots.filter((s) => s.role === 'boss').length >= 3 && spots.filter((s) => s.role === 'boss').every((s) => s.options.some((o) => /Boss/.test(o[2]))), 'the camps\' bosses resolve to the Forsworn boss line (the Briarheart templates)');
ok(spots.filter((s) => s.role === 'hagraven').length === 4, 'four hagravens: Lost Valley\'s two, Bleakwind Bluff\'s and Cradle Stone Tower\'s');
ok(spots.every((s) => Math.hypot(s.pos[0] - KARTHSPIRE[0], s.pos[1] - KARTHSPIRE[1]) > 12000), 'nothing within 12,000 units of Karthspire and Sky Haven Temple (the Blades\' base)');
ok(FW.camps.find((c) => c.id === 'redeagle').excluded.filter((e) => /Karthspire/.test(e.why)).length === 2, '...two of Red Eagle\'s Forsworn stood inside that circle and are left out');
ok(FW.buffer === 8000 && spots.every((s) => s.anchorDist < 2500), 'the guard and town buffer is 8000 units, and every anchor is within 2500 units of its spot');

// ---- 2-4. wildlife.js ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-fwcamps-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
for (const f of ['forsworn-camps.json', 'loot.json', 'artifacts.json', 'dragon-materials.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
fs.writeFileSync(path.join(dir, 'wildlife.json'), JSON.stringify({ placements: [], giantCamps: [] }));
const cwd = process.cwd();
const savedInterval = global.setInterval, savedClear = global.clearInterval;
const PLAYER = 0xff000014, NPC = 0xff0002f3;
const props = new Map(), said = [], audits = [], given = [], sets = [];
const PLUGINS = { 'Skyrim.esm': 0 };
const idOf = (d) => { const [h, p] = String(d).split(':'); if (!(p in PLUGINS)) throw new Error('no plugin ' + p); return ((PLUGINS[p] << 24) | parseInt(h, 16)) >>> 0; };
const mp = { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => { sets.push([id, k, v]); props.set(`${id}|${k}`, v); }, getIdFromDesc: idOf };
let drops = [];
globalThis.__dboTechniqueDrop = (...a) => { drops.push(a); return null; };
globalThis.__dboWildFactionAudit = ' (skipped in the harness)';
const load = (cfg) => {
  try { fs.unlinkSync(path.join(dir, 'NPC-Spawns.json')); } catch (e) { /* first load */ }
  process.chdir(dir);
  global.setInterval = () => ({ unref() {} }); global.clearInterval = () => {};
  globalThis.__dboWildSig = undefined;
  try {
    delete require.cache[path.join(ROOT, 'wildlife.js')];
    require(path.join(ROOT, 'wildlife.js'))({ mp, log: () => {}, personal: (a, t) => said.push([a, t]), system: () => {}, registerChatCommand: () => {},
      giveItem: (a, id, n) => { given.push([a, id, n]); return true; }, profileOf: (a) => ((a >>> 0) === PLAYER ? 2 : -1), display: String, who: (a) => `P${(a >>> 0).toString(16)}`,
      audit: (t) => audits.push(t), isAdmin: () => false, cfg, onlineActors: () => [], sendPacket: () => {} });
    return JSON.parse(fs.readFileSync(path.join(dir, 'NPC-Spawns.json'), 'utf8')).zones.filter((z) => /^wild:fw/.test(z.Name));
  } finally { process.chdir(cwd); global.setInterval = savedInterval; global.clearInterval = savedClear; }
};
const zones = load({});
ok(zones.length === spots.length && zones.every((z) => z.Hostile === true && z.NPC.length === 1 && z.NPC[0].count === 1), `wildlife.js writes ${zones.length} hostile wild:fw zones, one actor each`, zones.length);
const zoneOf = (role) => zones.filter((z) => z.Name.startsWith(`wild:fw${role}:`));
ok(zoneOf('melee').every((z) => z.Respawn === 1200) && zoneOf('boss').every((z) => z.Respawn === 2700) && zoneOf('hagraven').every((z) => z.Respawn === 3600),
  'respawns: Forsworn 20 min, the Briarheart boss 45, a hagraven 60');
const bossSpot = spots.find((s) => s.role === 'boss' && s.options.length > 1);
const bossZone = zones.find((z) => z.Name === bossSpot.zone);
ok(bossZone.NPC[0].id === bossSpot.options.slice().sort((a, b) => a[0] - b[0]).pop()[1], 'a boss takes the strongest of its line (pick high)', [bossZone.NPC[0].id, bossSpot.options.slice(-1)[0]]);
ok(load({ forswornCamps: { enabled: false } }).length === 0, 'forswornCamps.enabled false writes no Forsworn zone (the rollback)');
load({});

// camp chests
const camp = FW.camps.find((c) => c.id === 'lostvalley');
const plain = camp.chests.find((c) => !c.boss), boss = camp.chests.find((c) => c.boss);
const chestId = (c) => idOf(c.ref);
given.length = 0; said.length = 0;
ok(globalThis.__dboCampChest(chestId(plain), PLAYER) === false && given.length > 0 && /Forsworn' chest/.test(said.map((s) => s[1]).join()), 'a player rummages through the Forsworn chest: the roll goes into the pack', said);
ok(audits.some((t) => /^CAMP P ?ff000014 looted Lost Valley Redoubt:/.test(t.replace('Pff', 'P ff'))), '...audited with the camp\'s name', audits.slice(-1));
given.length = 0; said.length = 0;
globalThis.__dboCampChest(chestId(plain), PLAYER);
ok(given.length === 0 && /Come back in 60 minutes/.test(said.map((s) => s[1]).join()), 'once per player per chest per hour', said);
given.length = 0;
ok(globalThis.__dboCampChest(chestId(plain), NPC) === false && given.length === 0, 'an NPC opening the chest takes nothing');
drops = [];
globalThis.__dboCampChest(chestId(boss), PLAYER);
ok(drops.length === 1 && drops[0][0] === 'boss' && drops[0][1] === 'normal', 'the boss chest rolls the boss chests\' schematics at Adept', drops);
drops = [];
globalThis.__dboCampChest(chestId(FW.camps.find((c) => c.id === 'redeagle').chests.find((c) => !c.boss)), PLAYER);
ok(drops.length === 0, 'an ordinary Forsworn chest rolls no schematic');

// factions
const live = zones.slice(0, 3).map((z, i) => 0xff100000 + i);
zones.slice(0, 3).forEach((z, i) => props.set(`${live[i]}|private.npcSpawner`, z.Name));
fs.writeFileSync(path.join(dir, 'zone-spawns.json'), JSON.stringify(live));
process.chdir(dir); try { globalThis.__dboOwnedFactionTick(); } finally { process.chdir(cwd); }
const fac = (id) => sets.filter(([i, k]) => i === id && k === 'ff_factions').map(([, , v]) => v.f.map((x) => x[0]));
ok(live.every((id) => JSON.stringify(fac(id)[0]) === JSON.stringify([0x43599, 0x4359e])), 'every Forsworn spawn gets ForswornFaction and HagravenFaction', live.map(fac));

// ---- 5. contracts.js kinds ----
const csrc = fs.readFileSync(path.join(ROOT, 'contracts.js'), 'utf8');
const word = new RegExp(/const CREATURE_WORD = \/(.+)\/;/.exec(csrc)[1]);
const kindOf = (e) => { const m = word.exec(e); return m ? m[1].toLowerCase() : ''; };
ok(kindOf('EncForsworn02BossMagicBretonM01') === 'forsworn' && kindOf('EncForsworn01MissileBretonF01') === 'forsworn' && kindOf('dunLostValleyRedoubtHagraven') === 'hagraven' && kindOf('EncHagravenHoldPosition256') === 'hagraven',
  'contracts read a Forsworn (the Briarheart boss too) as forsworn and a hagraven as hagraven');
ok(/forsworn: 2, hagraven: 3,/.test(csrc) && /forsworn: 'Forsworn', hagraven: 'hagravens'/.test(csrc), '...at danger tiers 2 and 3, named Forsworn and hagravens on the board');
ok(kindOf('EncWolf') === 'wolf' && kindOf('EncFrostbiteSpiderGiant') === 'frostbitespider', 'the other creatures read as before');

console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
