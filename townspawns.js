// DragonBreak Online: the people of open Skyrim, spawned by the server. Loaded by gamemode.js on every hot reload.
//
// Nate, 16 Oct: "the npcs in skyrim needs to work like how bruma is": the server spawns every living actor, the plugins
// place none. NPC pass 2 (tools/skyrim_actor_all.py, DBO_SkyrimActorsList2.txt) disables the guards, townsfolk,
// merchants, children, friendly NPCs and tame animals still enabled in open Skyrim; town-spawns.json
// (tools/spawns/town_spawns.py) lists each one the server stands back up: its own base (a leveled one picked once per spot,
// so every client builds the same person), its own spot and heading, its hold and town. This writes them as permanent
// town:<kind>:<local id>-<plugin> zones for NpcSpawnSystem, which fills a zone when a player comes within its radius and
// empties it once nobody has been near for despawnSeconds; a killed one returns after respawnSeconds.
//
// Never beside the plugin's own copy: a zone is written only once its source actor is Initially Disabled in the plugins the
// server loaded (lookupEspmRecordById, the winning record), so the zones go live with the restart that ships pass 2's
// plugins and not a moment before; a ref pass 2 missed stays the plugin's and is never doubled. Checked once per process
// (plugins only change with a restart). requirePluginDisabled false skips the check (a test server only).
//
// What they are: ambience. Never hostile on sight (Hostile false). Lawless: their ff_factions are their own without crime
// and service factions (tools/spawns/town_spawns.py STRIP_FACTION), with no crime faction, so a guard never arrests,
// fines or attacks for a crime (law is players' work, as in Bruma: officials, jail.js, captureSystem) and a merchant
// offers no barter (trade is player to player). A body is emptied when it dies, so guards' and townsfolk's gear and coin
// never become loot (emptyBodies).
//
// Limits, all hot-reloadable: kinds on or off (children and horses off, as in Bruma, where neither is spawned), holds on
// or off one by one, excludeTowns and excludeBases (patterns; the config's defaults keep 4E 211 canon: no Legion or
// Stormcloak camps, no Helgen intro, no Thalmor prison fort), and caps per town outdoors (maxPerTown), per interior cell (maxPerCell) and per exterior
// cell (maxPerGrid, 4096 units): a capped place keeps a spread of kinds (merchants, then townsfolk, guards, friendly
// NPCs, children, animals, horses, round robin), the same spots every load. NpcSpawnSystem's npcLiveBudget
// (server-settings.json, 600 live) is over all zones together.
//
// gamemode-config.json "townSpawns": { enabled, holds: { <hold>: bool }, kinds: { <kind>: bool }, excludeTowns: [],
//   excludeBases, radius, interiorRadius, despawnSeconds, respawnSeconds, maxPerTown, maxPerCell, maxPerGrid, lawless, emptyBodies,
//   requirePluginDisabled }
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOLDS = ['whiterun', 'riften', 'solitude', 'windhelm', 'markarth', 'falkreath', 'morthal', 'dawnstar', 'winterhold'];
const KIND_ORDER = ['merchant', 'townsfolk', 'guard', 'friendly', 'child', 'animal', 'horse'];
const PEOPLE = new Set(['merchant', 'townsfolk', 'guard', 'friendly', 'child']);
const PREFIX = 'town:';
const INITIALLY_DISABLED = 0x800;

const defaults = () => ({
  enabled: true,
  holds: Object.fromEntries(HOLDS.map((h) => [h, true])),
  kinds: { merchant: true, townsfolk: true, guard: true, friendly: true, child: false, animal: true, horse: false },
  excludeTowns: [], excludeBases: [],
  radius: 4096, interiorRadius: 4096, despawnSeconds: 120, respawnSeconds: 900,
  maxPerTown: 24, maxPerCell: 10, maxPerGrid: 12,
  lawless: true, emptyBodies: true, requirePluginDisabled: true,
});

// The settings with the config laid over the defaults (holds and kinds merge key by key)
const settingsOf = (cfg) => {
  const d = defaults();
  const c = (cfg && cfg.townSpawns) || {};
  return Object.assign(d, c, { holds: Object.assign(d.holds, c.holds || {}), kinds: Object.assign(d.kinds, c.kinds || {}) });
};

const zoneName = (sp) => {
  const [loc, plugin] = String(sp.src).split(':');
  return `${PREFIX}${sp.kind}:${loc}-${String(plugin || '').toLowerCase().replace(/\.es[mpl]$/, '').replace(/[^a-z0-9]/g, '')}`.slice(0, 64);
};
const rank = (src) => parseInt(crypto.createHash('sha1').update(String(src)).digest('hex').slice(0, 8), 16);

// The spots that stand, after holds, kinds, towns and the caps. pluginDisabled(sp) -> true when the source actor is off in
// the loaded plugins (or the check is off). Returns { spots, held: { reason: n } }.
const select = (data, S, pluginDisabled) => {
  const held = {};
  const hold = (why) => { held[why] = (held[why] || 0) + 1; };
  // excludeTowns / excludeBases: patterns (case-insensitive) on the location editor id, and on the placed or picked base
  const rx = (list) => (Array.isArray(list) ? list : []).map((p) => { try { return new RegExp(String(p), 'i'); } catch (e) { return null; } }).filter(Boolean);
  const exTowns = rx(S.excludeTowns), exBases = rx(S.excludeBases);
  const pool = [];
  for (const sp of (data && data.spawns) || []) {
    if (!sp || !sp.src || !sp.kind || !sp.npc || !sp.world || !Array.isArray(sp.pos) || sp.pos.length !== 3) { hold('malformed'); continue; }
    if (!S.enabled) { hold('off'); continue; }
    if (S.holds[sp.hold] !== true) { hold(`hold ${sp.hold} off`); continue; }
    if (S.kinds[sp.kind] !== true) { hold(`kind ${sp.kind} off`); continue; }
    if (exTowns.some((r) => r.test(String(sp.town || '')))) { hold('town excluded'); continue; }
    if (exBases.some((r) => r.test(String(sp.edid || '')) || r.test(String(sp.npcEdid || '')))) { hold('base excluded'); continue; }
    if (!sp.interior && !sp.ref) { hold('no anchor'); continue; }
    if (!pluginDisabled(sp)) { hold('plugin actor still enabled'); continue; }
    pool.push(sp);
  }
  // Per place (a town outdoors, an interior cell), round robin over the kinds in KIND_ORDER, each kind's spots in a fixed
  // order (the spot's own id), into the caps: a capped place keeps a spread of kinds, the same spots every load
  const places = new Map();
  for (const sp of pool) {
    const key = sp.interior ? `c|${sp.world}` : `t|${sp.hold}|${sp.town}`;
    if (!places.has(key)) places.set(key, new Map(KIND_ORDER.map((k) => [k, []])));
    const kinds = places.get(key);
    if (!kinds.has(sp.kind)) kinds.set(sp.kind, []);
    kinds.get(sp.kind).push(sp);
  }
  const grid = new Map();
  const spots = [];
  for (const [key, kinds] of [...places.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    // The wilds of a hold (no town location) are not one place: only the exterior-cell cap applies there
    const cap = key.startsWith('c|') ? S.maxPerCell : /-wilds$/.test(key) ? Infinity : S.maxPerTown;
    const queues = [...kinds.values()].filter((l) => l.length).map((l) => l.sort((a, b) => rank(a.src) - rank(b.src) || (a.src < b.src ? -1 : 1)));
    let taken = 0;
    while (queues.some((q) => q.length)) {
      for (const q of queues) {
        const sp = q.shift();
        if (!sp) continue;
        if (taken >= cap) { hold(key.startsWith('c|') ? 'cell cap' : 'town cap'); continue; }
        const g = sp.interior ? null : `${sp.world}|${Math.floor(sp.pos[0] / 4096)}|${Math.floor(sp.pos[1] / 4096)}`;
        if (g && (grid.get(g) || 0) >= S.maxPerGrid) { hold('grid cap'); continue; }
        if (g) grid.set(g, (grid.get(g) || 0) + 1);
        taken++;
        spots.push(sp);
      }
    }
  }
  return { spots, held };
};

const zoneOf = (sp, S) => {
  const z = { Name: zoneName(sp), ID: sp.world, POS: sp.pos, Size: sp.interior ? S.interiorRadius : S.radius, Heading: Number(sp.heading) || 0,
    NPC: [{ id: sp.npc, count: 1 }], Despawn: S.despawnSeconds, Respawn: S.respawnSeconds, Hostile: false };
  if (sp.ref) z.Anchor = sp.ref;
  return z;
};

module.exports = (api) => {
  const { mp, log, cfg } = api;
  const S = settingsOf(cfg);
  const SPAWNS_FILE = path.resolve('NPC-Spawns.json');
  const SPAWNED_IDS_FILE = path.resolve('zone-spawns.json');
  let DATA = { spawns: [] };
  try { DATA = JSON.parse(fs.readFileSync(path.resolve('town-spawns.json'), 'utf8')); } catch (e) { log('townspawns: town-spawns.json unreadable, no town spawns', e.message); }
  const idOf = (desc) => { try { return mp.getIdFromDesc(String(desc)) >>> 0; } catch (e) { return 0; } };

  // ---- pass 2's plugins: is the source actor off in what the server loaded? Once per process -------------------------
  const disabledCache = globalThis.__dboTownDisabled instanceof Map ? globalThis.__dboTownDisabled : (globalThis.__dboTownDisabled = new Map());
  const pluginDisabled = (sp) => {
    if (S.requirePluginDisabled === false) return true;
    const key = String(sp.src).toLowerCase();
    if (disabledCache.has(key)) return disabledCache.get(key);
    let off = false;
    try {
      const id = idOf(sp.src);
      const r = id && typeof mp.lookupEspmRecordById === 'function' ? mp.lookupEspmRecordById(id) : null;
      off = !!(r && r.record && String(r.record.type) === 'ACHR' && (Number(r.record.flags) & INITIALLY_DISABLED));
    } catch (e) { off = false; }
    disabledCache.set(key, off);
    return off;
  };

  const t0 = Date.now();
  const { spots, held } = select(DATA, S, pluginDisabled);
  const lookupMs = Date.now() - t0;
  const zones = spots.map((sp) => zoneOf(sp, S));

  // ---- NPC-Spawns.json: our town:* entries, everyone else's kept -------------------------------------------------------
  const writeZones = () => {
    let root = null, list = [], key = 'zones';
    try {
      const parsed = JSON.parse(fs.readFileSync(SPAWNS_FILE, 'utf8'));
      if (Array.isArray(parsed)) list = parsed; else if (parsed && typeof parsed === 'object') { root = parsed; key = Object.keys(parsed).find((k) => k.toLowerCase() === 'zones') || 'zones'; list = Array.isArray(parsed[key]) ? parsed[key] : []; }
    } catch (e) { /* no file yet */ }
    const mineBefore = list.filter((z) => String((z && (z.Name || z.name)) || '').startsWith(PREFIX));
    const signature = crypto.createHash('sha1').update(JSON.stringify(zones)).digest('hex');
    if (mineBefore.length === zones.length && crypto.createHash('sha1').update(JSON.stringify(mineBefore)).digest('hex') === signature) return false;
    const kept = list.filter((z) => !String((z && (z.Name || z.name)) || '').startsWith(PREFIX));
    const payload = root ? Object.assign({}, root, { [key]: kept.concat(zones) }) : { _comment: 'NPC spawn zones. dungeon:* entries belong to dungeons.js, wild:* to wildlife.js, town:* to townspawns.js; all are rewritten by the server. Other entries are kept.', zones: kept.concat(zones) };
    try { fs.writeFileSync(SPAWNS_FILE + '.tmp', JSON.stringify(payload, null, 1)); fs.renameSync(SPAWNS_FILE + '.tmp', SPAWNS_FILE); return true; }
    catch (e) { log('NPC-Spawns.json write failed (townspawns)', e.message); return false; }
  };
  const wrote = writeZones();

  // ---- lawless: their own factions, no crime faction ------------------------------------------------------------------
  // Checked every 2 s against the spawner's sidecar of live ids, as wildlife.js does for the owned spawns' factions. The
  // client (formView.applyFactions) removes the copy from every faction, adds these, and sets its crime faction to none.
  const factionsByZone = new Map();
  for (const sp of spots) {
    if (!PEOPLE.has(sp.kind)) continue;
    const f = (sp.factions || []).map(([d, r]) => [idOf(d), Number(r) || 0]).filter(([id]) => id);
    factionsByZone.set(zoneName(sp).toLowerCase(), f);
  }
  const done = globalThis.__dboTownFactioned instanceof Map ? globalThis.__dboTownFactioned : (globalThis.__dboTownFactioned = new Map());
  const state = globalThis.__dboTownFactionState || (globalThis.__dboTownFactionState = { mtime: 0, retry: false });
  state.mtime = 0;   // a reload may change the lists: look at every live one again
  done.clear();
  globalThis.__dboTownFactionTick = () => {
    if (!S.lawless) return;
    let mtime = 0; try { mtime = fs.statSync(SPAWNED_IDS_FILE).mtimeMs; } catch (e) { return; }
    if (mtime === state.mtime && !state.retry) return;
    let ids = null;
    try { ids = JSON.parse(fs.readFileSync(SPAWNED_IDS_FILE, 'utf8')); } catch (e) { return; }
    if (!Array.isArray(ids)) return;
    state.mtime = mtime; state.retry = false;
    const live = new Set(ids.map((x) => Number(x) >>> 0));
    for (const id of done.keys()) if (!live.has(id)) done.delete(id);
    for (const id of live) {
      if (done.has(id)) continue;
      let tag = ''; try { tag = String(mp.get(id, 'private.npcSpawner') || ''); } catch (e) { continue; }
      if (!tag.startsWith(PREFIX)) { done.set(id, false); continue; }
      const f = factionsByZone.get(tag.toLowerCase());
      if (!f) { done.set(id, false); continue; }
      try { mp.set(id, 'ff_factions', { f, c: 0 }); done.set(id, true); }
      catch (e) { state.retry = true; log('town spawn factions failed, will retry', id.toString(16), e.message); }
    }
  };
  if (globalThis.__dboTownFactionTimer) clearInterval(globalThis.__dboTownFactionTimer);
  globalThis.__dboTownFactionTimer = setInterval(() => { try { globalThis.__dboTownFactionTick(); } catch (e) { log('town spawn factions tick failed', e.message); } }, 2000);

  // ---- bodies: nothing to loot (gamemode.js deathHook) ----------------------------------------------------------------
  globalThis.__dboTownDeath = (actorId) => {
    if (!S.emptyBodies) return;
    let tag = ''; try { tag = String(mp.get(actorId >>> 0, 'private.npcSpawner') || ''); } catch (e) { return; }
    if (!tag.startsWith(PREFIX)) return;
    try { mp.set(actorId >>> 0, 'inventory', { entries: [] }); } catch (e) { log('town spawn body empty failed', e.message); }
  };

  const perHold = {};
  for (const sp of spots) perHold[sp.hold] = (perHold[sp.hold] || 0) + 1;
  const heldText = Object.entries(held).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ');
  log(`townspawns ${S.enabled ? 'on' : 'off'}: ${(DATA.spawns || []).length} spots -> ${zones.length} town zones${wrote ? ' (NPC-Spawns.json written)' : ''}; ${HOLDS.map((h) => `${h} ${perHold[h] || 0}`).join(' ')}; held back: ${heldText || 'none'}; plugin check ${S.requirePluginDisabled === false ? 'off' : `${disabledCache.size} refs, ${lookupMs} ms`}`);
  globalThis.__dboTownSpawnsSummary = { zones: zones.length, perHold, held };

};
module.exports.select = select;
module.exports.settingsOf = settingsOf;
module.exports.zoneName = zoneName;
module.exports.zoneOf = zoneOf;
module.exports.HOLDS = HOLDS;
