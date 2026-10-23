// A named boss of an ordinary dungeon is a boss (#bugs 1563013068529864804, "TWO VOKUNS": a Master solo claim of High
// Gate Ruins on 23 Oct spawned two of him, and his bodies gave Bone Meal). Vokun's placement (ref 327c1, one option 327c2,
// kind Ianusu) had no boss mark, so the party count doubled him on Master and could skip him below it, and his body took
// the creature path. Now he is in dungeons.js BOSS_REFS: one of him on every difficulty and party size, his body gives the
// master's roll with the dragon priest trophies, and the expedition's boss-down trip home stays expedition-only.
// Loads the real dungeons.js with the real High Gate Ruins entry, dungeon-pools.json and the dungeons config.
//   node tests/dungeon-named-boss-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 600)}`); if (!c) fails++; };
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

let rng = 1;
Math.random = () => { rng = (rng + 0x6d2b79f5) >>> 0; let t = Math.imul(rng ^ (rng >>> 15), rng | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const DID = 'HighGateRuinsLocation', REF = '327c1:skyrim.esm', BASE = '327c2:skyrim.esm';
const cfg = read('gamemode-config.json');
const D = read('dungeons.json').dungeons.find((d) => d.id === DID);
const placements = D.zones.reduce((n, z) => n + z.npcs.length, 0);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dungeon-named-boss-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
for (const f of ['loot.json', 'ayleid-loot.json', 'dungeon-pools.json', 'artifacts.json', 'dragon-materials.json']) { try { fs.copyFileSync(path.join(ROOT, f), f); } catch (e) { /* optional */ } }
fs.writeFileSync('dungeons.json', JSON.stringify({ dungeons: [D] }));
fs.writeFileSync('expeditions.json', JSON.stringify({ expeditions: [] }));
global.setTimeout = () => 0;

const ids = new Map(), descs = new Map(); let nextId = 0x100;
const idOf = (d) => { const k = String(d).toLowerCase(); if (!ids.has(k)) { ids.set(k, nextId); descs.set(nextId, k); nextId++; } return ids.get(k); };
// Six players: actor 0x14 + i has profile i + 1; actor 0x14 is the leader
const ACTORS = [0x14, 0x15, 0x16, 0x17, 0x18, 0x19];
const A = ACTORS[0];
const pidOf = (a) => (ACTORS.includes(a) ? ACTORS.indexOf(a) + 1 : -1);
let online = [A];
globalThis.__dboCharLevel = () => 3;
globalThis.__dboDungeons = undefined;
const props = new Map();
const ui = new Map(), cmds = new Map(), timers = new Map(), said = [], gifts = [];
require(path.join(ROOT, 'dungeons.js'))({
  mp: { get: (id, p) => (p === 'profileId' ? pidOf(id) : props.get(`${id}|${p}`)), set: (id, p, v) => props.set(`${id}|${p}`, v),
    getIdFromDesc: idOf, getDescFromId: (id) => descs.get(id), lookupEspmRecordById: () => ({ record: null }) },
  log: () => {}, personal: (a, t) => said.push(t), system: (a, t) => said.push(t), audit: () => {}, registerChatCommand: (n, fn) => cmds.set(n, fn), onUi: (n, fn) => { const l = ui.get(n) || []; l.push(fn); ui.set(n, l); },
  openWidget: () => true, closeWidget: () => true, sendPacket: () => true, findByName: () => 0, display: String, who: String, profileOf: pidOf, nameOf: () => 'P',
  onlineActors: () => online, isAdmin: () => true, giveItem: (a, id, n) => { gifts.push([a, descs.get(id) || id, n]); return true; },
  cfg: { dungeons: Object.assign({}, cfg.dungeons || {}, { exclude: [] }) }, every: (name, ms, fn) => timers.set(name, fn),
});
const ST = globalThis.__dboDungeons;
const fire = (n, a, args) => (ui.get(n) || []).forEach((f) => f(a, args, 0));
// A party of n stands at the door; the leader claims
const claim = (diff, n = 1) => {
  const e = D.entrances[0];
  online = ACTORS.slice(0, n);
  ST.parties.clear(); ST.memberOf.clear();
  if (n > 1) { const members = new Set(online.map(pidOf)); ST.parties.set(1, { leader: 1, leaderName: 'P', members }); for (const m of members) ST.memberOf.set(m, 1); }
  for (const a of online) { props.set(`${a}|worldOrCellDesc`, e.world || e.cell); props.set(`${a}|pos`, (e.doorPos || e.pos).slice()); props.delete(`${a}|private.dungeonCooldowns`); }
  if (globalThis.__dboDungeonAccountRest) globalThis.__dboDungeonAccountRest.clear();
  globalThis.__dboDungeonActivate(idOf(e.outsideDesc), A);
  const pend = ST.pending.get(A);
  if (pend) fire('dungeonClaim', A, [pend.nonce, diff]);
  return ST.leases.get(DID);
};
const end = () => { if (ST.leases.get(DID)) cmds.get('dungeon')(A, `end ${DID.toLowerCase()}`); };
const vokuns = (lease) => (lease ? lease.zones : []).filter((z) => String(z.Placed || '').toLowerCase() === REF);

// 1. One Vokun, never skipped or doubled: every difficulty, one to six players, 40 claims each
const bad = [];
let thinned = false, doubled = false;
for (const diff of ['story', 'normal', 'hard', 'nightmare']) {
  for (const n of [1, 2, 4, 6]) {
    rng = 11 * n + diff.length;
    for (let i = 0; i < 40; i++) {
      const l = claim(diff, n);
      if (!l) { bad.push(`${diff} x${n}: no claim`); break; }
      const v = vokuns(l);
      if (v.length !== 1 || v[0].NPC[0].count !== 1 || v[0].NPC[0].id.toLowerCase() !== BASE) bad.push(`${diff} x${n}: ${v.length} zone(s), count ${v.map((z) => z.NPC[0].count).join('+') || 0}`);
      else if (!l.bossZones.has(v[0].Name)) bad.push(`${diff} x${n}: his zone is not a boss zone`);
      if (l.zones.length < placements) thinned = true;
      if (l.zones.some((z) => z.NPC[0].count > 1)) doubled = true;
      end();
    }
  }
}
ok(!bad.length, 'Vokun is in every claim exactly once, as himself, a boss zone (4 difficulties x 1, 2, 4, 6 players x 40)', [...new Set(bad)].slice(0, 8));
ok(thinned && doubled, '...while the other enemies are still thinned on Novice and doubled for a bigger party', { thinned, doubled });

// 2. His body: the master's roll and the dragon priest trophies, on every difficulty
const GEM = { story: '2e4f3:skyrim.esm', normal: '2e4fb:skyrim.esm', hard: '2e4ff:skyrim.esm', nightmare: '2e4ff:skyrim.esm' };
let body = 0xff000200;
for (const diff of ['story', 'normal', 'hard', 'nightmare']) {
  rng = 5;
  const l = claim(diff, 1);
  const v = vokuns(l)[0];
  if (!v) { ok(false, `${diff}: a claim with Vokun`); end(); continue; }
  const id = body++;
  props.set(`${id}|private.npcSpawner`, v.Name); props.set(`${id}|isDead`, true);
  gifts.length = 0;
  const r = globalThis.__dboCorpseLoot(id, A);
  const got = gifts.map((g) => g[1]);
  ok(r === false && got.length > 1, `${diff}: his body gives the master's roll by E (not the creature path)`, { r, got });
  ok(got.includes(GEM[diff]), `${diff}: ...with the dragon priest's soul gem (${GEM[diff]})`, got);
  end();
}

// 3. The boss-down trip home is an expedition's only: an ordinary dungeon's claim goes on after Vokun falls
rng = 3;
const l = claim('nightmare', 1);
const v = vokuns(l)[0];
const VOKUN = 0xff000300;
props.set(`${VOKUN}|private.npcSpawner`, v ? v.Name : ''); props.set(`${VOKUN}|isDead`, true);
fs.writeFileSync('zone-spawns.json', JSON.stringify([VOKUN]));
said.length = 0;
timers.get('dungeons.tick')();
ok(!!l && ST.leases.get(DID) === l && !l.bossDownAt && !said.some((t) => /has fallen/.test(t)), 'Vokun dead: no ten-minute trip home in an ordinary dungeon, the claim goes on', { bossDownAt: l && l.bossDownAt, said });
end();

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
