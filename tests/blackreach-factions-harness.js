// Blackreach's spawns are allies (wildlife.js ownedFactionTick; Nate, 16 Oct: "IN BLACKREACH GIANTS ARE KILLING EACHOTHER").
// Druadach's DD_StoneGiant has only DD_StoneSentinelFaction, which has no relation to GiantFaction (DA06GiantBoss, EncGiant0x),
// and the client raises every hostile spawn to Aggression 2, which attacks neutrals: the three Stone Giants of POIBlackreach05
// fought the giant boss on the hoster's client. The server refused the hits (gamemode.js dungeonAllies) but the fight ran on.
// Every Blackreach spawn, any kind, now gets the same ff_factions (CreatureFaction + FalmerFaction, allied to itself).
// Runs the real wildlife.js in a scratch folder.
//   node tests/blackreach-factions-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-brfac-'));
const cwd = process.cwd();
const PLUGINS = { 'skyrim.esm': 0x00, 'bsheartland.esm': 0x08, 'bsassets.esm': 0x07 };
const idOf = (d) => { const [h, p] = String(d).split(':'); const i = PLUGINS[String(p || '').toLowerCase()]; if (i === undefined) return 0; return ((i << 24) | parseInt(h, 16)) >>> 0; };
const props = new Map(), sets = [];
const mp = { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => { props.set(`${id}|${k}`, v); sets.push([id, k, v]); }, getIdFromDesc: idOf };
const tag = (id, t) => props.set(`${id}|private.npcSpawner`, t);
const br = JSON.parse(fs.readFileSync(path.join(ROOT, 'blackreach.json'), 'utf8'));
// One live actor per Blackreach spot, every kind: the three Stone Giants and the giant boss of POIBlackreach05 among them
const live = br.spots.map((sp, i) => { const id = (0xff000400 + i) >>> 0; tag(id, sp.zone); return { id, sp }; });
const WOLF = 0xff000070, GOB = 0xff000050;
tag(WOLF, 'wild:wolf:12'); tag(GOB, 'wild:goblin:p154071-dragonbreakonlineedits');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
const load = (c) => {
  process.chdir(dir);
  try {
    delete require.cache[path.join(ROOT, 'wildlife.js')];
    global.setInterval = () => ({ unref() {} }); global.clearInterval = () => {};
    globalThis.__dboWildFactionAudit = ' (skipped)';
    require(path.join(ROOT, 'wildlife.js'))({ mp, log: () => {}, personal: () => {}, system: () => {}, registerChatCommand: () => {}, giveItem: () => true,
      profileOf: () => 1, display: String, who: String, audit: () => {}, isAdmin: () => false, cfg: c, onlineActors: () => [], sendPacket: () => {} });
  } finally { process.chdir(cwd); }
};
const tick = () => { process.chdir(dir); try { globalThis.__dboOwnedFactionTick(); } finally { process.chdir(cwd); } };
const fac = (id) => sets.filter(([i, k]) => i === id && k === 'ff_factions').map((x) => x[2]);
try {
  for (const f of ['wildlife.json', 'loot.json', 'artifacts.json']) fs.writeFileSync(path.join(dir, f), f === 'wildlife.json' ? JSON.stringify({ placements: [], giantCamps: [] }) : f === 'loot.json' ? '{"pools":{}}' : '{"patterns":[]}');
  fs.writeFileSync(path.join(dir, 'zone-spawns.json'), JSON.stringify([...live.map((x) => x.id), WOLF, GOB]));

  // Reload over old state: the previous wildlife.js marked every live Blackreach spawn as done with no factions
  globalThis.__dboOwnedFactioned = new Map(live.map((x) => [x.id, ''])); globalThis.__dboOwnedFactionState = { mtime: Date.now() + 1e9, retry: false };
  globalThis.__dboOwnedFactionedVersion = undefined;
  load({ ownedSpawns: cfg.ownedSpawns });
  tick();
  const WANT = JSON.stringify([{ f: [[0x13, 0], [0x2997e, 0]], c: 0 }]);
  const kinds = new Set(live.map((x) => x.sp.kind));
  ok(kinds.size >= 7 && ['brgiant', 'brfalmer', 'brdwemer', 'brchaurus', 'brspider', 'brtroll', 'brwisp'].every((k) => kinds.has(k)), 'blackreach.json has all seven kinds', [...kinds]);
  const wrong = live.filter((x) => JSON.stringify(fac(x.id)) !== WANT);
  ok(!wrong.length, `every one of the ${live.length} Blackreach spawns gets CreatureFaction + FalmerFaction, even after a reload over the old marks`, wrong.slice(0, 3).map((x) => [x.sp.zone, fac(x.id)]));
  const stone = live.filter((x) => x.sp.edid === 'DD_StoneGiant'), boss = live.filter((x) => x.sp.edid === 'DA06GiantBoss');
  ok(stone.length === 3 && boss.length === 1 && [...stone, ...boss].every((x) => JSON.stringify(fac(x.id)) === WANT), 'the three Stone Giants (Druadach) and DA06GiantBoss share one faction list', [stone.length, boss.length]);
  ok(fac(WOLF).length === 0, 'a wildlife.json wolf is left alone');
  ok(JSON.stringify(fac(GOB)) === JSON.stringify([{ f: [[0x13, 0], [0x080877f5, 0]], c: 0 }]), 'an owned-plugin goblin keeps its own camp factions');
  sets.length = 0; tick();
  ok(sets.length === 0, 'each live actor is given its factions once');
  ok(JSON.stringify(cfg.ownedSpawns.factions.blackreach) === JSON.stringify(['13:Skyrim.esm', '2997e:Skyrim.esm']), 'gamemode-config.json carries the Blackreach factions', cfg.ownedSpawns.factions.blackreach);
  // the default holds without the config key
  sets.length = 0; globalThis.__dboOwnedFactioned = undefined; globalThis.__dboOwnedFactionState = undefined;
  load({ ownedSpawns: {} }); tick();
  ok(live.every((x) => JSON.stringify(fac(x.id)) === WANT), 'the Blackreach list is wildlife.js\'s default too');

  // The hit judge still refuses their hits on each other (all hit paths reach onHitDamageAttempt, ActionListener.cpp)
  const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
  ok(/if \(dmg > 0 && agg !== tgt && dungeonAllies\(agg, tgt\)\) return false;/.test(gm) && /__dboBlackreachAllies\(a, b\)\) return true;/.test(gm), 'gamemode.js refuses one Blackreach spawn\'s hit on another');
  const rx = /^wild:br[a-z]+:b[0-9a-f]+-[a-z0-9]+$/;
  ok(fs.readFileSync(path.join(ROOT, 'blackreach.js'), 'utf8').includes(String(rx)) && br.spots.every((sp) => rx.test(sp.zone)), 'blackreach.js\'s ally rule matches every Blackreach zone, giants included');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
