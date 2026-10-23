// Lu'ah Al-Skaven attacks on sight (in-game /bug 1563132160985010210, 23 Oct: she stood neutral in Ansilvund until shot).
// Her record (NPC_ 2333a) is Unaggressive with no aggro radius; in vanilla her quest turns her hostile, and it does not run
// here. A lease zone had no Hostile key, so the spawn system took her base AI (not hostile) and the client never raised her.
// Now she is in dungeons.js BOSS_REFS (placement 2335a) and every named boss's zone is written with Hostile: true, as
// wildlife.js writes Blackreach's and the hostile kinds' zones; other dungeon zones keep their bases' own AI (no Hostile key).
// Loads the real dungeons.js with the real Ansilvund, High Gate Ruins and Darklight Tower entries and the dungeons config.
//   node tests/luah-hostile-harness.js   (from server/)
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

const LUAH = { id: 'AnsilvundLocation', ref: '2335a:skyrim.esm', base: '2333a:skyrim.esm' };
const OTHERS = [{ id: 'HighGateRuinsLocation', ref: '327c1:skyrim.esm' }, { id: 'DarklightTowerLocation', ref: '304f1:skyrim.esm' }];
const cfg = read('gamemode-config.json');
const ALL = read('dungeons.json').dungeons;
const DS = [LUAH, ...OTHERS].map((x) => ALL.find((d) => d.id === x.id));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luah-hostile-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
for (const f of ['loot.json', 'ayleid-loot.json', 'dungeon-pools.json', 'artifacts.json', 'dragon-materials.json']) { try { fs.copyFileSync(path.join(ROOT, f), f); } catch (e) { /* optional */ } }
fs.writeFileSync('dungeons.json', JSON.stringify({ dungeons: DS }));
fs.writeFileSync('expeditions.json', JSON.stringify({ expeditions: [] }));
global.setTimeout = () => 0;

const ids = new Map(), descs = new Map(); let nextId = 0x100;
const idOf = (d) => { const k = String(d).toLowerCase(); if (!ids.has(k)) { ids.set(k, nextId); descs.set(nextId, k); nextId++; } return ids.get(k); };
const ACTORS = [0x14, 0x15, 0x16, 0x17];
const A = ACTORS[0];
const pidOf = (a) => (ACTORS.includes(a) ? ACTORS.indexOf(a) + 1 : -1);
let online = [A];
globalThis.__dboCharLevel = () => 3;
globalThis.__dboDungeons = undefined;
const props = new Map();
const ui = new Map(), cmds = new Map(), gifts = [];
require(path.join(ROOT, 'dungeons.js'))({
  mp: { get: (id, p) => (p === 'profileId' ? pidOf(id) : props.get(`${id}|${p}`)), set: (id, p, v) => props.set(`${id}|${p}`, v),
    getIdFromDesc: idOf, getDescFromId: (id) => descs.get(id), lookupEspmRecordById: () => ({ record: null }) },
  log: () => {}, personal: () => {}, system: () => {}, audit: () => {}, registerChatCommand: (n, fn) => cmds.set(n, fn), onUi: (n, fn) => { const l = ui.get(n) || []; l.push(fn); ui.set(n, l); },
  openWidget: () => true, closeWidget: () => true, sendPacket: () => true, findByName: () => 0, display: String, who: String, profileOf: pidOf, nameOf: () => 'P',
  onlineActors: () => online, isAdmin: () => true, giveItem: (a, id, n) => { gifts.push([a, descs.get(id) || id, n]); return true; },
  cfg: { dungeons: Object.assign({}, cfg.dungeons || {}, { exclude: [] }) }, every: () => {},
});
const ST = globalThis.__dboDungeons;
const fire = (n, a, args) => (ui.get(n) || []).forEach((f) => f(a, args, 0));
const claim = (D, diff, n = 1) => {
  const e = D.entrances[0];
  online = ACTORS.slice(0, n);
  ST.parties.clear(); ST.memberOf.clear();
  if (n > 1) { const members = new Set(online.map(pidOf)); ST.parties.set(1, { leader: 1, leaderName: 'P', members }); for (const m of members) ST.memberOf.set(m, 1); }
  for (const a of online) { props.set(`${a}|worldOrCellDesc`, e.world || e.cell); props.set(`${a}|pos`, (e.doorPos || e.pos).slice()); props.delete(`${a}|private.dungeonCooldowns`); }
  if (globalThis.__dboDungeonAccountRest) globalThis.__dboDungeonAccountRest.clear();
  globalThis.__dboDungeonActivate(idOf(e.outsideDesc), A);
  const pend = ST.pending.get(A);
  if (pend) fire('dungeonClaim', A, [pend.nonce, diff]);
  return ST.leases.get(D.id);
};
const end = (D) => { if (ST.leases.get(D.id)) cmds.get('dungeon')(A, `end ${D.id.toLowerCase()}`); };
const at = (lease, ref) => (lease ? lease.zones : []).filter((z) => String(z.Placed || '').toLowerCase() === ref);
const written = () => { try { const j = JSON.parse(fs.readFileSync('NPC-Spawns.json', 'utf8')); return Array.isArray(j) ? j : j.zones || []; } catch (e) { return []; } };

// 1. Lu'ah: one of her, a boss zone written with Hostile: true, on every difficulty and party size
const bad = [];
let others = 0, otherHostile = 0;
for (const diff of ['story', 'normal', 'hard', 'nightmare']) {
  for (const n of [1, 2, 4]) {
    rng = 17 * n + diff.length;
    for (let i = 0; i < 20; i++) {
      const l = claim(DS[0], diff, n);
      if (!l) { bad.push(`${diff} x${n}: no claim`); break; }
      const z = at(l, LUAH.ref);
      const w = written().filter((x) => String(x.Placed || '').toLowerCase() === LUAH.ref);
      if (z.length !== 1 || z[0].NPC[0].count !== 1 || z[0].NPC[0].id.toLowerCase() !== LUAH.base || !l.bossZones.has(z[0].Name)) bad.push(`${diff} x${n}: ${z.length} zone(s), count ${z.map((x) => x.NPC[0].count).join('+') || 0}`);
      else if (z[0].Hostile !== true || w.length !== 1 || w[0].Hostile !== true) bad.push(`${diff} x${n}: Hostile ${z[0].Hostile}, in NPC-Spawns.json ${w.map((x) => x.Hostile)}`);
      for (const x of l.zones) if (String(x.Placed || '').toLowerCase() !== LUAH.ref) { others++; if (Object.prototype.hasOwnProperty.call(x, 'Hostile')) otherHostile++; }
      end(DS[0]);
    }
  }
}
ok(!bad.length, "Lu'ah is in every claim once, a boss zone with Hostile: true, also in NPC-Spawns.json (4 difficulties x 1, 2, 4 players x 20)", [...new Set(bad)].slice(0, 8));
ok(others > 0 && otherHostile === 0, `...and the other ${others} Ansilvund zones carry no Hostile key: their bases' own AI decides, as before`, { others, otherHostile });

// 2. The other named bosses' zones are written hostile too
for (let k = 0; k < OTHERS.length; k++) {
  rng = 3;
  const l = claim(DS[k + 1], 'normal', 1);
  const z = at(l, OTHERS[k].ref);
  ok(z.length === 1 && z[0].Hostile === true && l.zones.filter((x) => x.Hostile === true).length === 1, `${OTHERS[k].id}: its named boss's zone (and only it) is Hostile: true`, z.map((x) => x.Hostile));
  end(DS[k + 1]);
}

// 3. Her body gives the master's roll (her kind matched neither humanoid, undead nor boss: it took the creature path)
rng = 9;
const l = claim(DS[0], 'hard', 1);
const z = at(l, LUAH.ref)[0];
const id = 0xff000400;
props.set(`${id}|private.npcSpawner`, z ? z.Name : ''); props.set(`${id}|isDead`, true);
gifts.length = 0;
const r = globalThis.__dboCorpseLoot(id, A);
ok(r === false && gifts.some((g) => g[1] === 0xf || g[1] === 'f:skyrim.esm') && gifts.length > 1, "her body gives the master's roll by E", { r, gifts: gifts.map((g) => g[1]) });
end(DS[0]);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
