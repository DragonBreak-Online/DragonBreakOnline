// No Sun-Hallowed or Blood-Cursed Elven Arrows in loot (Nate, 16 Oct). Both are Dawnguard quest ammunition
// (DLC1ElvenArrowBlessed 98a1, DLC1ElvenArrowBlood 98a0) that loot.json's arrows pool carries at value 0 for Skyrim, so a
// Novice chest drew them once Skyrim opened. The gear swap's ammo list skips quest ammo (tools/loot/steel_swap_map.py), so
// the ceiling never took them out, and loot-overrides.json's never list was read for the gear pools only. Now it is read
// for every pool. Loads the real dungeons.js against the real loot.json and loot-overrides.json and rolls chests.
//   node tests/quest-arrows-loot-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-questarrows-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
global.setTimeout = () => 0;
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

for (const f of ['loot.json', 'artifacts.json', 'dragon-materials.json', 'ayleid-loot.json']) { try { fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)); } catch (e) { /* optional */ } }
fs.writeFileSync('dungeons.json', JSON.stringify({ dungeons: [] }));
const LOOT = JSON.parse(fs.readFileSync('loot.json', 'utf8')).pools;
const NEVER = JSON.parse(fs.readFileSync(path.join(ROOT, 'loot-overrides.json'), 'utf8')).never;
const QUEST = { '98a1:Dawnguard.esm': 'DLC1ElvenArrowBlessed', '98a0:Dawnguard.esm': 'DLC1ElvenArrowBlood' };

// ---- the data ----
for (const [d, edid] of Object.entries(QUEST)) {
  const it = LOOT.arrows.find((a) => a.id === d);
  ok(!!it && it.name === edid && Number(it.value) === 0, `loot.json's arrows pool carries ${edid} at value 0 (why the Novice band reached it)`, it);
  ok(typeof NEVER[d] === 'string' && NEVER[d].startsWith(edid), `loot-overrides.json names ${edid} never loot`, NEVER[d]);
}

// ---- the real module ----
const ids = new Map(); let next = 0x01000000;
const idOf = (d) => { const k = String(d).toLowerCase(); if (!ids.has(k)) ids.set(k, next++); return ids.get(k); };
const nameOfId = new Map();
for (const items of Object.values(LOOT)) for (const it of items) if (it && it.id) nameOfId.set(idOf(it.id), String(it.name || ''));
const props = new Map();
const mp = { get: (id, p) => (p === 'profileId' ? 1 : props.get(`${id}|${p}`)), set: (id, p, v) => props.set(`${id}|${p}`, v), getIdFromDesc: idOf };
const api = {
  mp, log: () => {}, personal: () => {}, system: () => {}, audit: () => {}, registerChatCommand: () => {}, onUi: () => {}, openWidget: () => true,
  closeWidget: () => true, sendPacket: () => true, findByName: () => 0, display: String, who: String, profileOf: () => 1, nameOf: String,
  onlineActors: () => [], isAdmin: () => false, giveItem: () => true, cfg: {}, every: () => {},
};
globalThis.__dboDungeonsBooted = true;
const load = () => { delete globalThis.__dboOpenWorldLoot; require(path.join(ROOT, 'dungeons.js'))(api); return globalThis.__dboOpenWorldLoot; };
const ARROWS = new Set(LOOT.arrows.map((a) => a.name));
const roll = (fn, diff, n) => { const out = []; for (let i = 0; i < n; i++) for (const e of fn(diff, false, 'skyrim', '') || []) out.push(nameOfId.get(e.baseId) || ''); return out; };

const openWorld = load();
ok(typeof openWorld === 'function', 'dungeons.js publishes its chest roll (__dboOpenWorldLoot)');
const story = roll(openWorld, 'story', 6000).filter((n) => ARROWS.has(n));
const hard = roll(openWorld, 'hard', 3000).filter((n) => ARROWS.has(n));
const quest = story.concat(hard).filter((n) => Object.values(QUEST).includes(n));
ok(story.length > 200 && hard.length > 100 && !quest.length, `${story.length} Novice and ${hard.length} Expert chest arrow draws in Skyrim: no Sun-Hallowed or Blood-Cursed arrow`, [...new Set(quest)]);
ok(story.includes('IronArrow') && story.includes('SteelArrow'), '...iron and steel arrows still drop', [...new Set(story)].slice(0, 10));

// The fix is the hand list: without it the same rolls hand the two arrows out (the bug as it was)
{
  const real = fs.readFileSync(path.join(ROOT, 'loot-overrides.json'), 'utf8');
  const stripped = JSON.parse(real); for (const d of Object.keys(QUEST)) delete stripped.never[d];
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-questarrows-root-'));
  process.on('exit', () => { try { fs.rmSync(dir2, { recursive: true, force: true }); } catch (e) { /* left */ } });
  for (const f of ['dungeons.js', 'loottiers.js', 'loot-materials.json', 'faction-gear.json', 'gear-swap.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir2, f));
  fs.writeFileSync(path.join(dir2, 'loot-overrides.json'), JSON.stringify(stripped));
  delete globalThis.__dboOpenWorldLoot;
  require(path.join(dir2, 'dungeons.js'))(api);
  const before = roll(globalThis.__dboOpenWorldLoot, 'story', 6000).filter((n) => Object.values(QUEST).includes(n));
  ok(before.length > 0, `control: without the two never entries ${before.length} quest arrow draws come out of the same Novice rolls`);
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
