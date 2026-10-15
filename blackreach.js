// DragonBreak Online: Blackreach, the open-world dungeon. Loaded by gamemode.js on every hot reload, after wildlife.js.
//
// Nate, 14 Oct: "Black reach is done, it is going to be an open world dungeon, so we need to make sure it's super hard and
// the loot is really worth it". blackreach.json (tools/blackreach/blackreach_build.py) lists every living actor of the
// Blackreach world and Nate's ten chests. wildlife.js spawns the actors as permanent wild:br<kind>:b<id>-<plugin> zones (no
// lease: every group meets the same camps, which stay cleared for respawnSeconds after a kill). This module owns the rest:
//   - the chests: a chest never opens; using one hands the player a Master boss roll straight into the pack (dungeons.js
//     __dboOpenWorldLoot: artifacts, dragon materials, Ebony, Daedric, Stalhrim, Orcish and the ingot cap are never in
//     it), plus a piece of Dwemer or Falmer gear now and then. Three gates keep it from being farmed:
//       1. guarded: while a guard of the chest (a spot within its reach) stands alive near it, it refuses;
//       2. earned: the player, or someone of their party, must have fought a guard that died, within creditMinutes, and
//          the chest's boss when it has one (a hit on it, or the kill; a companion's or summon's counts for its owner);
//       3. rested: once looted, that chest gives the account nothing for chestHours (blackreach-cooldowns.json, so a
//          restart or another character does not reset it).
//   - enemies of Blackreach never hurt each other (gamemode.js dungeonAllies asks __dboBlackreachAllies), as the
//     enemies of one dungeon do not: a Falmer shaman's chain lightning no longer burns its own camp.
//   - a ready chest glows for a player in Blackreach, as the camp chests do.
// gamemode-config.json "blackreach": { enabled, chestHours, creditMinutes, guardReach, difficulty, province, dungeonId,
//   themeChance, allBoss, ... } (wildlife.js reads the same block for the zones). Hooks: __dboBlackreachChest (activate chain),
//   __dboBlackreachHit (hit chain), __dboBlackreachDeath (death chain), __dboBlackreachAllies (hit refusal).
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, registerChatCommand, giveItem, profileOf, display, who, audit, isAdmin, cfg, onlineActors, sendPacket } = api;
  const C = Object.assign({ enabled: true, chestHours: 20, creditMinutes: 60, guardReach: 4000, difficulty: 'nightmare', province: 'skyrim', dungeonId: 'BlackreachLocation', themeChance: 0.5, allBoss: true, glowSeconds: 30 }, cfg.blackreach || {});
  const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); } catch (e) { return fallback; } };
  const DATA = readJson('blackreach.json', { spots: [], chests: [] });
  const SPAWNED_IDS_FILE = path.resolve('zone-spawns.json');
  const CD_PATH = path.resolve('blackreach-cooldowns.json');
  const GOLD_BASE = 0x0000000f;
  const idOf = (desc) => { try { return mp.getIdFromDesc(desc) >>> 0; } catch (e) { return 0; } };
  const normDesc = (d) => { const s = String(d || ''); const i = s.indexOf(':'); if (i < 0) return s.toLowerCase(); const n = parseInt(s.slice(0, i), 16); return (Number.isFinite(n) ? n.toString(16) : s.slice(0, i).toLowerCase()) + ':' + s.slice(i + 1).toLowerCase(); };
  const WORLD = normDesc(DATA.world || '1ee62:Skyrim.esm');
  const ZONE_RX = /^wild:br[a-z]+:b[0-9a-f]+-[a-z0-9]+$/;

  // ---- the data --------------------------------------------------------------------------------
  const spotByZone = new Map();
  for (const sp of DATA.spots || []) if (sp && ZONE_RX.test(String(sp.zone || ''))) spotByZone.set(sp.zone, sp);
  const chests = new Map(); // ref id -> { chest, guards: Set(zone), bosses: Set(zone) }
  for (const ch of DATA.chests || []) {
    const id = idOf(ch.ref);
    if (!id) continue;
    const guards = new Set(), bosses = new Set();
    for (const src of ch.guards || []) {
      const sp = (DATA.spots || []).find((s) => s.src === src);
      if (!sp || !spotByZone.has(sp.zone)) continue;
      guards.add(sp.zone);
      if (sp.boss) bosses.add(sp.zone);
    }
    chests.set(id, { chest: ch, guards, bosses });
  }
  const isBrTag = (tag) => ZONE_RX.test(tag);
  const tagOf = (id) => { try { return String(mp.get(id >>> 0, 'private.npcSpawner') || ''); } catch (e) { return ''; } };

  // ---- kill credit -----------------------------------------------------------------------------
  // actor id -> Set of profiles who hit it while it lived; zone -> profile -> when one of its guards they fought died
  const hitters = globalThis.__dboBlackreachHitters instanceof Map ? globalThis.__dboBlackreachHitters : (globalThis.__dboBlackreachHitters = new Map());
  const credit = globalThis.__dboBlackreachCredit instanceof Map ? globalThis.__dboBlackreachCredit : (globalThis.__dboBlackreachCredit = new Map());
  // A companion's or a summon's blow counts for the player it fights for (ff_companionOf names the owner)
  const creditedProfile = (a) => {
    let pid = -1; try { pid = Number(profileOf(a >>> 0)); } catch (e) { pid = -1; }
    if (pid >= 0) return pid;
    try { const owner = Number(mp.get(a >>> 0, 'ff_companionOf')) >>> 0; if (owner) { const p = Number(profileOf(owner)); if (p >= 0) return p; } } catch (e) { /* not an actor */ }
    return -1;
  };
  globalThis.__dboBlackreachHit = (agg, tgt) => {
    if (!C.enabled || (tgt >>> 0) < 0xff000000) return;
    const tag = tagOf(tgt);
    if (!isBrTag(tag)) return;
    const pid = creditedProfile(agg);
    if (pid < 0) return;
    let set = hitters.get(tgt >>> 0);
    if (!set) { set = new Set(); hitters.set(tgt >>> 0, set); }
    set.add(pid);
    if (hitters.size > 2048) for (const k of hitters.keys()) { hitters.delete(k); if (hitters.size <= 1024) break; }
  };
  globalThis.__dboBlackreachDeath = (actorId, killerId) => {
    const id = actorId >>> 0;
    const fought = hitters.get(id);
    hitters.delete(id);
    if (!C.enabled || id < 0xff000000) return;
    const tag = tagOf(id);
    if (!isBrTag(tag)) return;
    const who_ = new Set(fought || []);
    const k = creditedProfile(killerId);
    if (k >= 0) who_.add(k);
    if (!who_.size) return;
    let m = credit.get(tag);
    if (!m) { m = new Map(); credit.set(tag, m); }
    const now = Date.now();
    for (const pid of who_) m.set(pid, now);
  };
  // The party a profile is in (dungeons.js parties), the profile alone without one
  const partyOf = (pid) => {
    try {
      const st = globalThis.__dboDungeons;
      const leader = st && st.memberOf instanceof Map ? st.memberOf.get(pid) : undefined;
      const p = leader !== undefined ? st.parties.get(leader) : null;
      return p && p.members instanceof Set ? [...p.members] : [pid];
    } catch (e) { return [pid]; }
  };
  const earned = (pid, zones) => {
    const since = Date.now() - C.creditMinutes * 60000;
    const party = partyOf(pid);
    for (const z of zones) { const m = credit.get(z); if (m && party.some((p) => Number(m.get(p)) >= since)) return true; }
    return false;
  };

  // ---- guards still standing ----------------------------------------------------------------------
  const readSpawned = () => { try { const ids = JSON.parse(fs.readFileSync(SPAWNED_IDS_FILE, 'utf8')); return Array.isArray(ids) ? ids : []; } catch (e) { return []; } };
  const guardsAlive = (entry, chestId) => {
    let q = null; try { q = mp.get(chestId, 'pos'); } catch (e) { q = null; }
    const out = [];
    for (const raw of readSpawned()) {
      const id = Number(raw) >>> 0;
      const tag = tagOf(id);
      if (!entry.guards.has(tag)) continue;
      try { if (mp.get(id, 'isDead') === true) continue; } catch (e) { continue; }
      if (Array.isArray(q)) { try { const p = mp.get(id, 'pos'); if (Array.isArray(p) && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > C.guardReach) continue; } catch (e) { continue; } }
      out.push(id);
    }
    return out;
  };

  // ---- cooldowns, per account and chest, kept across restarts ----------------------------------------
  const rest = globalThis.__dboBlackreachRest instanceof Map ? globalThis.__dboBlackreachRest : (globalThis.__dboBlackreachRest = (() => {
    const m = new Map();
    try { const raw = JSON.parse(fs.readFileSync(CD_PATH, 'utf8')); for (const [k, v] of Object.entries(raw || {})) if (Number(v) > Date.now()) m.set(k, Number(v)); } catch (e) { if (e.code !== 'ENOENT') log('blackreach-cooldowns.json unreadable', e.message); }
    return m;
  })());
  // Off the game loop, temp file then rename, one write at a time (a sync write stalls the live server: 4 Oct)
  const saveState = globalThis.__dboBlackreachSave || (globalThis.__dboBlackreachSave = { writing: false, dirty: false });
  const saveRest = () => {
    saveState.dirty = true;
    if (saveState.writing) return;
    saveState.writing = true;
    saveState.dirty = false;
    const now = Date.now();
    for (const [k, v] of rest) if (v < now) rest.delete(k);
    fs.promises.writeFile(CD_PATH + '.tmp', JSON.stringify(Object.fromEntries(rest)))
      .then(() => fs.promises.rename(CD_PATH + '.tmp', CD_PATH))
      .catch((e) => log('blackreach-cooldowns.json save failed', e.message))
      .finally(() => { saveState.writing = false; if (saveState.dirty) saveRest(); });
  };
  const restKey = (pid, chestId) => `${pid}:${chestId.toString(16)}`;

  // ---- the roll ------------------------------------------------------------------------------------
  // The theme: one piece of Dwemer or Falmer gear (loot.json), lootable and of the province, as dungeons.js's own checks say
  const LOOT = (readJson('loot.json', { pools: {} }).pools) || {};
  const THEME = /^(?:DLC1)?(?:Armor)?(?:Dwarven|Falmer)/;
  const themePiece = () => {
    const banned = globalThis.__dboBannedLoot instanceof RegExp ? globalThis.__dboBannedLoot : null;
    const lootable = typeof globalThis.__dboLootable === 'function' ? globalThis.__dboLootable : null;
    const inProvince = typeof globalThis.__dboLootInProvince === 'function' ? globalThis.__dboLootInProvince : null;
    if (!banned || !lootable || !inProvince) return null;
    const list = [].concat(LOOT.armor || [], LOOT.weapons || []).filter((it) => THEME.test(String(it.name || '')) && !banned.test(String(it.name || '')) && lootable(it.id) && inProvince(it, C.province));
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  };
  const roll = (entry) => {
    if (typeof globalThis.__dboOpenWorldLoot !== 'function') return null;
    // Every chest rolls as a boss chest (allBoss, Nate: the loot really worth it); allBoss false leaves TreasFalmerChest a plain one
    const entries = globalThis.__dboOpenWorldLoot(C.difficulty, C.allBoss !== false || !!entry.chest.boss, C.province, C.dungeonId);
    if (!Array.isArray(entries)) return null;
    const out = entries.map((e) => ({ baseId: Number(e.baseId) >>> 0, count: Number(e.count) || 0 })).filter((e) => e.baseId && e.count > 0);
    if (Math.random() < C.themeChance) { const it = themePiece(); const id = it ? idOf(it.id) : 0; if (id) out.push({ baseId: id, count: 1, name: it.name }); }
    return out;
  };

  // ---- the chest ---------------------------------------------------------------------------------
  const denyAt = new Map();
  const refuse = (a, text) => { if (Date.now() - (denyAt.get(a) || 0) > 1500) { denyAt.set(a, Date.now()); personal(a, text); } return false; };
  const nameOf = (baseId, fallback) => {
    if (fallback) return String(fallback).replace(/([a-z])([A-Z])/g, '$1 $2');
    try { const r = mp.lookupEspmRecordById(baseId); const e = r && r.record ? String(r.record.editorId || '') : ''; return e ? e.replace(/([a-z])([A-Z])/g, '$1 $2') : baseId.toString(16); } catch (e) { return baseId.toString(16); }
  };
  // null: not a Blackreach chest; false: handled (the chest never opens)
  globalThis.__dboBlackreachChest = (targetId, casterId) => {
    const entry = chests.get(targetId >>> 0);
    if (!entry) return null;
    if (!C.enabled) return false;
    let pid = -1; try { pid = Number(profileOf(casterId >>> 0)); } catch (e) { pid = -1; }
    if (!(pid >= 0)) return false;   // a creature's AI opening the chest takes nothing
    const key = restKey(pid, targetId >>> 0);
    const until = Number(rest.get(key)) || 0;
    if (until > Date.now()) return refuse(casterId, `You have emptied this chest already. It holds nothing for you for ${Math.ceil((until - Date.now()) / 3600000)} more hours.`);
    const alive = guardsAlive(entry, targetId >>> 0);
    if (alive.length) return refuse(casterId, `Its guardians still stand (${alive.length}). Bring them down first.`);
    if (!earned(pid, entry.bosses.size ? entry.bosses : entry.guards)) {
      return refuse(casterId, entry.bosses.size ? 'The chest will not yield to you: fight its guardian and see it fall first.' : 'The chest will not yield to you: fight its guards and see them fall first.');
    }
    const got = roll(entry);
    // No loot module: refused, and the chest's rest is not spent
    if (!got) { log('blackreach: dungeons.js __dboOpenWorldLoot missing; chest refused'); return refuse(casterId, 'The lock is jammed. Try again later.'); }
    rest.set(key, Date.now() + C.chestHours * 3600000);
    saveRest();
    const given = got.filter((e) => giveItem(casterId, e.baseId, e.count));
    for (const e of given) if (e.baseId === GOLD_BASE) { try { if (typeof globalThis.__dboRaceGold === 'function') globalThis.__dboRaceGold(casterId, e.count, 'a Blackreach chest'); } catch (err) { log('racial gold failed', err.message); } }
    try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('loot', 'blackreach_chest', casterId, targetId, given, 0); } catch (e) { /* the player log is optional */ }
    personal(casterId, given.length ? `You force the chest open: ${given.map((e) => `${e.count > 1 ? e.count + ' ' : ''}${nameOf(e.baseId, e.baseId === GOLD_BASE ? 'Gold' : e.name)}`).join(', ')}.` : 'The chest is empty.');
    audit(`BLACKREACH ${who(casterId)} looted ${entry.chest.edid} ${entry.chest.ref}: ${given.map((e) => `${e.count}x ${e.baseId.toString(16)}`).join(', ')}`);
    glow(casterId);
    return false;
  };

  // ---- Blackreach's enemies never hurt each other -----------------------------------------------------
  globalThis.__dboBlackreachAllies = (a, b) => C.enabled && isBrTag(tagOf(a)) && isBrTag(tagOf(b));

  // ---- glow: a chest with a roll for the player lights up while they are in Blackreach ------------------------------
  const inBlackreach = (a) => { try { return normDesc(mp.get(a, 'worldOrCellDesc')) === WORLD; } catch (e) { return false; } };
  const glow = (a) => {
    if (typeof sendPacket !== 'function' || !chests.size || !inBlackreach(a)) return;
    let pid = -1; try { pid = Number(profileOf(a)); } catch (e) { return; }
    if (!(pid >= 0)) return;
    const now = Date.now(), ready = [], spent = [];
    for (const id of chests.keys()) (C.enabled && !(Number(rest.get(restKey(pid, id))) > now) ? ready : spent).push(id);
    try {
      if (spent.length) sendPacket(a, { customPacketType: 'dboGlow', refs: spent, on: false, kind: 'loot' });
      if (ready.length) sendPacket(a, { customPacketType: 'dboGlow', refs: ready, on: true, kind: 'loot' });
    } catch (e) { /* offline */ }
  };
  globalThis.__dboBlackreachGlow = glow;
  if (globalThis.__dboBlackreachGlowTimer) clearInterval(globalThis.__dboBlackreachGlowTimer);
  globalThis.__dboBlackreachGlowTimer = setInterval(() => {
    let online = []; try { online = typeof onlineActors === 'function' ? onlineActors() : []; } catch (e) { return; }
    for (const a of online) { try { globalThis.__dboBlackreachGlow(a); } catch (e) { log('blackreach glow failed', e.message); } }
  }, Math.max(5, Number(C.glowSeconds) || 30) * 1000);

  registerChatCommand('blackreach', (a) => {
    let pid = -1; try { pid = Number(profileOf(a)); } catch (e) { pid = -1; }
    const now = Date.now();
    const resting = pid >= 0 ? [...chests.keys()].filter((id) => Number(rest.get(restKey(pid, id))) > now).length : 0;
    personal(a, `Blackreach: ${spotByZone.size} enemy spots, ${chests.size} chests, ${resting} of them emptied by you in the last ${C.chestHours} hours. A chest yields once its guardians fall to you or your party.${isAdmin(a) ? ' Config: gamemode-config.json "blackreach".' : ''}`);
  }, { help: 'the open-world dungeon beneath Skyrim' });

  log(`blackreach ${C.enabled ? 'on' : 'off'}: ${spotByZone.size} spots, ${chests.size} chests (${[...chests.values()].filter((c) => c.bosses.size).length} with a boss), ${C.difficulty} loot, ${C.chestHours} h per account and chest, credit ${C.creditMinutes} min`);
};
