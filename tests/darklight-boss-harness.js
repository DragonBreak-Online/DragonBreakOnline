// Darklight Tower's boss gives boss loot (in-game /bug 1563109248869859368, 23 Oct: "Hagraven boss doesn't drop boss
// loot"). The hagraven at the top (placement 304f1, one option 23ab0, kind EncHagraven) was no boss: her body took the
// creature path (one Hagraven Feathers), and the party count skipped her on Expert solo 12% of the time (Novice 58%) or
// doubled her on Master. She is now in dungeons.js BOSS_REFS: one of her in every claim, and her body gives the master's roll.
// Loads the real dungeons.js with the real Darklight Tower entry, dungeon-pools.json and the dungeons config.
//   node tests/darklight-boss-harness.js   (from server/)
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

const DID = 'DarklightTowerLocation', REF = '304f1:skyrim.esm', BASE = '23ab0:skyrim.esm';
const cfg = read('gamemode-config.json');
const D = read('dungeons.json').dungeons.find((d) => d.id === DID);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'darklight-boss-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
for (const f of ['loot.json', 'ayleid-loot.json', 'dungeon-pools.json', 'artifacts.json', 'dragon-materials.json']) { try { fs.copyFileSync(path.join(ROOT, f), f); } catch (e) { /* optional */ } }
fs.writeFileSync('dungeons.json', JSON.stringify({ dungeons: [D] }));
fs.writeFileSync('expeditions.json', JSON.stringify({ expeditions: [] }));
global.setTimeout = () => 0;

const ids = new Map(), descs = new Map(); let nextId = 0x100;
const idOf = (d) => { const k = String(d).toLowerCase(); if (!ids.has(k)) { ids.set(k, nextId); descs.set(nextId, k); nextId++; } return ids.get(k); };
const ACTORS = [0x14, 0x15, 0x16, 0x17, 0x18, 0x19];
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
// coin: the gold base, or its desc when the mock id stands in for it
const isGold = (x) => x === 0xf || x === 'f:skyrim.esm';
const hagravens = (lease) => (lease ? lease.zones : []).filter((z) => String(z.Placed || '').toLowerCase() === REF);

// 1. One hagraven at the top, never skipped or doubled: every difficulty, one to six players, 40 claims each
const bad = [];
for (const diff of ['story', 'normal', 'hard', 'nightmare']) {
  for (const n of [1, 2, 4, 6]) {
    rng = 13 * n + diff.length;
    for (let i = 0; i < 40; i++) {
      const l = claim(diff, n);
      if (!l) { bad.push(`${diff} x${n}: no claim`); break; }
      const h = hagravens(l);
      if (h.length !== 1 || h[0].NPC[0].count !== 1 || h[0].NPC[0].id.toLowerCase() !== BASE) bad.push(`${diff} x${n}: ${h.length} zone(s), count ${h.map((z) => z.NPC[0].count).join('+') || 0}`);
      else if (!l.bossZones.has(h[0].Name)) bad.push(`${diff} x${n}: her zone is not a boss zone`);
      end();
    }
  }
}
ok(!bad.length, 'the hagraven is in every claim exactly once, as herself, a boss zone (4 difficulties x 1, 2, 4, 6 players x 40)', [...new Set(bad)].slice(0, 8));

// 2. Her body: the master's roll by E, on every difficulty (was: null here, then the creature path's feathers)
let body = 0xff000200;
for (const diff of ['story', 'normal', 'hard', 'nightmare']) {
  rng = 5;
  const l = claim(diff, 1);
  const h = hagravens(l)[0];
  if (!h) { ok(false, `${diff}: a claim with the hagraven`); end(); continue; }
  const id = body++;
  props.set(`${id}|private.npcSpawner`, h.Name); props.set(`${id}|isDead`, true);
  gifts.length = 0;
  const r = globalThis.__dboCorpseLoot(id, A);
  const got = gifts.map((g) => g[1]);
  ok(r === false && got.some(isGold) && got.length > 1, `${diff}: her body gives the master's roll (coin and more), not the creature path`, { r, got });
  ok(!got.includes('2e4ff:skyrim.esm') && !got.includes('1c1fe:skyrim.esm'), `${diff}: ...and no dragon priest trophies (she is none)`, got);
  ok(r === false && globalThis.__dboCorpseLoot(id, A) === false && gifts.length === got.length, `${diff}: ...once`);
  end();
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
