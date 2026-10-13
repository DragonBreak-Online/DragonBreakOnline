// DragonBreak Online: the per-player activity log for reports (Jake, 13 Oct 2026: "I want to know everything"; "Dont cover
// chat"; one staff forum post per Discord user). Loaded LAST by gamemode.js, so its engine slot wrappers are the outermost.
// Never chat: no hook sits on a chat path, and the schema (playerlog-rules.js) has no field that can hold what a player
// wrote. The game only appends JSONL to local disk; a separate forwarder service (CT 115) turns the files into Discord
// posts, so Discord can never slow the main loop.
//
//   disk      <playerLog.dir>/YYYY-MM-DD.jsonl (UTC day of the event; 512 MB rolls to .1.jsonl ...), 0600 in a 0700 folder
//   switches  gamemode-config.json "playerLog" (enabled, types{}, caps, polls ...); quick undo: touch <stopFile> (capture
//             off within 30 s, no deploy), or enabled false + hot reload (everything unhooked)
//   safety    every entry point runs inside guard(): an error is counted, logged once a minute per site, and 20 in 60 s
//             turn capture off until the next load; every map is capped; every fs call goes through fsq() (one per
//             kind, two at most in flight, none new while one has hung for 5 s); the flush is time-boxed to 4 ms.
//
// This file: state (globalThis.__dboPlayerLog, kept over reloads), config, emit(), the identity cache, the writer, the
// error guard and breaker, install and uninstall (globalThis.__dboPlogUninstall), the SIGTERM chain, and the dispatcher
// globalThis.__dboPlogHook(name, ...args) that the one-line hooks in gamemode.js and the modules call. The taps, polls and
// aggregators are in playerlog-taps.js; the schema and the audit registry in playerlog-rules.js.
'use strict';
const path = require('path');

const CORE_VERSION = 'plog-1.0';
const STATE_V = 1;

// Defaults (DESIGN.md Appendix B); gamemode-config.json "playerLog" overrides any of them
const DEFAULTS = {
  enabled: true,
  dir: '/var/lib/playerlog/events',
  stopFile: '/var/lib/playerlog/STOP',
  flushMs: 2000,
  flushBudgetMs: 4,
  auditBudgetMs: 2,
  maxPerFlush: 2000,
  rollBytes: 536870912,
  exitFlushBytes: 5242880,
  caps: { soft: 10000, mid: 15000, hard: 20000, audit: 2000 },
  fs: { maxInFlight: 2, stallMs: 5000, writeStallMs: 60000 },
  errors: { breakerCount: 20, breakerWindowMs: 60000, logEveryMs: 60000 },
  diskFreeGb: { dropP2: 10, dropP1: 5, stop: 2 },
  diskCheckMs: 600000,
  stopCheckMs: 30000,
  windowMs: 5000,
  fightIdleMs: 15000,
  fightLinkMs: 120000,
  containerIdleMs: 60000,
  accessDedupeMs: 60000,
  equipFoldMs: 3000,
  loginEquipSkipMs: 20000,
  nearUnits: 3000,
  nearMax: 10,
  healthLoss: { minPct: 5, noHitMs: 2500, suppressMs: 5000, mergeMs: 30000, discord: false },
  polls: { fastMs: 2000, locationMs: 5000, zoneMoveUnits: 1000, slowMs: 5000, slowSlices: 12, minuteMs: 60000, afkMs: 30000, afkMinutes: 10, teleportUnits: 3000, fallDz: 500 },
  snapshots: { logout: true, down: true },
  nameHash: false,
  inventoryDiff: false,
  types: { 'combat.hit': false, 'cmd.info': true, 'social.player_menu': true },
};
const merge = (base, over) => {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const [k, v] of Object.entries(over || {})) {
    if (k.startsWith('_')) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
};

// Every Map and Set on the state, with its cap and (for the minute trim) the age after which an entry goes. The core
// harness walks the state and fails on a Map or Set not listed here (DESIGN.md 3.2).
const CAPS = {
  ids: { cap: 2000 }, online: { cap: 500 }, loc: { cap: 500 }, fights: { cap: 1000 }, windows: { cap: 2000 }, refusedPair: { cap: 2000, ttl: 60000 },
  pendingHits: { cap: 2000, ttl: 3000 }, lastHits: { cap: 500, ttl: 30000 }, containers: { cap: 500 }, drops: { cap: 2000, ttl: 120000 },
  worn: { cap: 500 }, equipFold: { cap: 500 }, castFold: { cap: 500 }, harvestFold: { cap: 500 }, foodFold: { cap: 500 },
  healChannels: { cap: 500, ttl: 10000 }, vitals: { cap: 500 }, hpLossMerge: { cap: 500, ttl: 30000 }, suppress: { cap: 500, ttl: 5000 },
  clientByUser: { cap: 500, ttl: 21600000 }, connectByUser: { cap: 500, ttl: 21600000 }, menuLeft: { cap: 200, ttl: 30000 },
  travel: { cap: 500, ttl: 10000 }, pendingLeave: { cap: 500, ttl: 60000 }, afk: { cap: 500 }, slotMap: { cap: 2000 },
  housingCache: { cap: 2000, ttl: 60000 }, factionStore: { cap: 500 }, recordCache: { cap: 5000 }, npcInfo: { cap: 2000, ttl: 60000 },
  ownedNpcs: { cap: 2000 }, recentPair: { cap: 1000, ttl: 120000 }, accessDedupe: { cap: 2000 }, searches: { cap: 200, ttl: 60000 },
  cmdInfoFold: { cap: 2000 }, errs: { cap: 100 }, sessions: { cap: 500 }, fsPending: { cap: 16 }, dropCounts: { cap: 400 },
  schemaDrops: { cap: 400 }, unknownTypes: { cap: 100 }, auditUnknown: { cap: 200 }, slots: { cap: 64 }, lockPicks: { cap: 1000, ttl: 600000 },
  doorDedupe: { cap: 2000, ttl: 60000 }, panelPending: { cap: 200, ttl: 10000 }, mastery: { cap: 500 }, companions: { cap: 500 },
  restrained: { cap: 500 }, pickupWatch: { cap: 500, ttl: 5000 }, deaths: { cap: 500, ttl: 60000 }, deathSeen: { cap: 2000, ttl: 120000 },
  invSnap: { cap: 500 }, invTouched: { cap: 500 },
};
const newState = () => {
  const S = { v: STATE_V, q: [], auditQ: [], errTimes: [], cmdStack: [], seq: 0, gen: '', on: false, enabled: false, stopped: false, broken: false,
    file: null, writing: null, inflight: null, needNewline: false, dirReady: false, enospc: false, diskLevel: 'ok', lastWriteLog: 0,
    slowCursor: 0, invCursor: 0, minuteAt: 0, generations: 0, writeLogAt: 0 };
  return S;
};
const backfill = (S) => {
  for (const [k, def] of Object.entries(newState())) if (S[k] === undefined) S[k] = def;
  for (const k of Object.keys(CAPS)) {
    const isSet = k === 'online' || k === 'ownedNpcs' || k === 'slots';
    if (isSet ? !(S[k] instanceof Set) : !(S[k] instanceof Map)) S[k] = isSet ? new Set() : new Map();
  }
  if (!Array.isArray(S.q)) S.q = [];
  if (!Array.isArray(S.auditQ)) S.auditQ = [];
  if (!Array.isArray(S.errTimes)) S.errTimes = [];
  if (!Array.isArray(S.cmdStack)) S.cmdStack = [];
  return S;
};

module.exports = (api) => {
  const { mp } = api;
  const log = typeof api.log === 'function' ? api.log : () => {};
  const fs = api.fs || require('fs');
  const C = merge(DEFAULTS, ((api.cfg || {}).playerLog) || {});
  const now = () => (api.clock ? api.clock.now() : Date.now());
  const perf = () => (api.clock ? api.clock.perf() : performance.now());

  // Fresh rules and taps on every load: a deploy never keeps old rules
  const RULES_JS = path.join(__dirname, 'playerlog-rules.js');
  const TAPS_JS = path.join(__dirname, 'playerlog-taps.js');
  delete require.cache[RULES_JS];
  delete require.cache[TAPS_JS];
  const R = require(RULES_JS);

  // The previous generation goes fully off before anything of this one is installed
  if (typeof globalThis.__dboPlogUninstall === 'function') { try { globalThis.__dboPlogUninstall('reload'); } catch (e) { log('player log: the previous generation did not uninstall:', e.message); } }
  globalThis.__dboPlogHook = null;

  const prior = globalThis.__dboPlayerLog;
  const S = backfill(prior && typeof prior === 'object' && prior.v === STATE_V ? prior : newState());
  globalThis.__dboPlayerLog = S;
  S.gen = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  S.seq = 0;
  S.generations++;
  S.dir = String(C.dir);
  S.broken = false;
  S.enabled = C.enabled !== false;
  // The STOP file's last known answer stays over a reload until the next check
  const stacked = new Set(); // sites whose first stack this load has logged
  const G = { timers: new Set(), hooks: {}, gen: S.gen };

  // ---- the error guard and breaker (DESIGN.md 3.1) ---------------------------------------------------------------------
  const setOn = () => { S.on = S.enabled && !S.stopped && !S.broken; };
  const trimMap = (name) => { const m = S[name]; const cap = CAPS[name].cap; while (m.size > cap) { const k = m.keys().next().value; m.delete(k); } };
  const err = (site, e) => {
    try {
      const t = now();
      const s = String(site).slice(0, 40);
      let r = S.errs.get(s);
      if (!r) { r = { n: 0, at: 0, cls: '', reported: 0 }; S.errs.set(s, r); trimMap('errs'); }
      r.n++;
      if (!r.cls) r.cls = String((e && (e.code || e.name)) || 'Error').slice(0, 40);
      S.errTimes.push(t);
      while (S.errTimes.length && t - S.errTimes[0] > C.errors.breakerWindowMs) S.errTimes.shift();
      if (S.errTimes.length > 500) S.errTimes.splice(0, S.errTimes.length - 500);
      const msg = String((e && e.message) || e).slice(0, 300);
      if (!stacked.has(s)) { stacked.add(s); r.at = t; log(`player log error at ${s} (first this load): ${String((e && e.stack) || msg).slice(0, 1500)}`); }
      else if (t - r.at >= C.errors.logEveryMs) { r.at = t; log(`player log error at ${s}: ${msg}`); }
      if (S.on && S.errTimes.length >= C.errors.breakerCount) {
        S.broken = true; setOn();
        let worst = s, most = 0; for (const [k, v] of S.errs) if (v.n > most) { most = v.n; worst = k; }
        log(`player log: off after ${S.errTimes.length} errors in ${Math.round(C.errors.breakerWindowMs / 1000)} s, mostly ${worst}`);
        sysEvent('sys.stop', { reason: 'errors' });
      }
    } catch (x) { /* the guard itself never throws */ }
  };
  const guard = (site, fn) => function guarded(...args) { try { return fn.apply(this, args); } catch (e) { err(site, e); return undefined; } };

  // ---- maps: capped puts ---------------------------------------------------------------------------------------------------
  const put = (name, k, v) => { const m = S[name]; if (!m.has(k) && m.size >= CAPS[name].cap) m.delete(m.keys().next().value); m.set(k, v); return v; };
  const add = (name, v) => { const m = S[name]; if (!m.has(v) && m.size >= CAPS[name].cap) m.delete(m.values().next().value); m.add(v); };
  const trimAged = (t) => {
    for (const [name, def] of Object.entries(CAPS)) {
      const m = S[name];
      if (def.ttl && m instanceof Map) for (const [k, v] of m) { const at = v && typeof v === 'object' ? (v.t || v.at || 0) : Number(v) || 0; if (t - at > def.ttl) m.delete(k); }
      if (m.size > def.cap) { if (m instanceof Map) trimMap(name); else while (m.size > def.cap) m.delete(m.values().next().value); }
    }
  };

  // ---- types and switches ------------------------------------------------------------------------------------------------
  const typeOn = (ev) => {
    const spec = R.typeOf(ev);
    if (!spec) return false;
    const sw = C.types || {};
    if (Object.prototype.hasOwnProperty.call(sw, ev)) return sw[ev] === true;
    if (ev.startsWith('act.') && Object.prototype.hasOwnProperty.call(sw, 'act.*')) return sw['act.*'] === true;
    return spec.on !== false;
  };
  const TYPE_ON = new Map();
  const isOn = (ev) => { let v = TYPE_ON.get(ev); if (v === undefined) { v = typeOn(ev); if (TYPE_ON.size < 400) TYPE_ON.set(ev, v); } return v; };

  // ---- the queue and its caps (DESIGN.md 3.2) --------------------------------------------------------------------------------
  const countDrop = (ev, reason) => {
    const k = `${reason}|${ev}`;
    if (!S.dropCounts.has(k) && S.dropCounts.size >= CAPS.dropCounts.cap) return;
    S.dropCounts.set(k, (S.dropCounts.get(k) || 0) + 1);
  };
  const DISK_BLOCK = { ok: 3, p2: 2, p1: 1, stop: 0 };
  const enqueue = (rec, pri) => {
    const n = S.q.length;
    if (n >= C.caps.hard || (pri >= 1 && n >= C.caps.mid) || (pri >= 2 && n >= C.caps.soft)) { countDrop(rec.ev, 'cap'); return false; }
    if (pri >= DISK_BLOCK[S.diskLevel]) { countDrop(rec.ev, 'disk_low'); return false; }
    rec.g = S.gen; rec.s = ++S.seq;
    S.q.push(rec);
    return true;
  };
  // sys.* records: written whatever the switches say (they are the record's own health)
  const sysEvent = (ev, f) => { const rec = { v: R.VERSION, t: now(), ev, p: -1, f, src: 'sys' }; rec.g = S.gen; rec.s = ++S.seq; if (S.q.length < C.caps.hard + 100) S.q.push(rec); };

  // ---- identity (DESIGN.md 1.2): never tagOf() or display(), which write a tag on whatever they touch -----------------------
  const get = (id, k) => { try { return mp.get(id, k); } catch (e) { return undefined; } };
  const profileOf = (a) => { const p = Number(get(a, 'profileId')); return Number.isFinite(p) ? p : -1; };
  const tagRead = (a) => { const t = get(a, 'private.charTag'); return typeof t === 'string' && t.length === 4 ? t : ''; };
  const shownName = (a) => { const v = get(a, 'appearance'); return (v && typeof v.name === 'string' && v.name) || 'Stranger'; };
  const discordRead = (a) => { if (typeof api.discordOf === 'function') { try { return String(api.discordOf(a) || ''); } catch (e) { return ''; } } return ''; };
  const readId = (a, prev, full) => {
    const p = profileOf(a);
    const c = tagRead(a) || (prev && prev.c) || '';
    const shown = shownName(a);
    let own = prev ? prev.n : '';
    let disguised = false;
    try { const f = globalThis.__dboDisguised; disguised = typeof f === 'function' && f(a) === true; } catch (e) { disguised = false; }
    if (!disguised && shown !== 'Stranger') own = shown;
    else {
      // Behind a mask or a beast: the own name, unless playermenu.js has lost it ("Stranger" never replaces the cached one)
      try { const f = globalThis.__dboOwnName; const n = typeof f === 'function' ? String(f(a) || '') : ''; if (n && n !== 'Stranger') own = n; } catch (e) { /* keep */ }
    }
    if (!own) own = shown;
    const r = { p, c, n: own, sn: shown !== own ? shown : undefined, d: discordRead(a), t: now(), staff: prev ? prev.staff : null };
    if (full) { try { r.staff = typeof api.staffTierOf === 'function' ? api.staffTierOf(a) || null : null; } catch (e) { r.staff = null; } }
    return r;
  };
  const idOf = (a) => {
    const id = Number(a) >>> 0;
    const r = S.ids.get(id);
    if (r) return r;
    // Only players: an NPC is never read for a name or a tag
    if (!S.online.has(id) && profileOf(id) < 0) return null;
    return put('ids', id, readId(id, null, false));
  };
  const refreshId = (a, full) => { const id = Number(a) >>> 0; return put('ids', id, readId(id, S.ids.get(id), full)); };
  const isPlayer = (a) => S.online.has(Number(a) >>> 0) || profileOf(a) >= 0;

  // ---- record names (the catalog name, else the editor id in words; never an entry's own name) ------------------------------
  const words = (s) => String(s || '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/_/g, ' ').trim();
  const descOf = (id) => { try { return String(mp.getDescFromId(Number(id) >>> 0) || ''); } catch (e) { return ''; } };
  const recordName = (baseId) => {
    const id = Number(baseId) >>> 0;
    if (!id) return '';
    const hit = S.recordCache.get(id);
    if (hit !== undefined) return hit;
    let n = '';
    const desc = descOf(id);
    try { if (desc && typeof api.adminItemName === 'function') n = String(api.adminItemName(desc) || ''); } catch (e) { n = ''; }
    if (!n) { try { const r = typeof api.recordOf === 'function' ? api.recordOf(id) : mp.lookupEspmRecordById(id); n = words(r && r.record && r.record.editorId); } catch (e) { n = ''; } }
    if (!n) n = id.toString(16);
    return put('recordCache', id, n.slice(0, 48));
  };
  const recordType = (baseId) => {
    const id = Number(baseId) >>> 0;
    const key = `t:${id}`;
    const hit = S.recordCache.get(key);
    if (hit !== undefined) return hit;
    let t = '';
    try { const r = typeof api.recordOf === 'function' ? api.recordOf(id) : mp.lookupEspmRecordById(id); t = r && r.record ? String(r.record.type) : ''; } catch (e) { t = ''; }
    return put('recordCache', key, t);
  };
  // An inventory entry -> an item: the record's name, the structured extras, and named:1 for a custom name (never the name)
  const itemOf = (baseId, k, e) => {
    const id = Number(baseId) >>> 0;
    const it = { b: descOf(id) || undefined, i: recordName(id), k: Number(k) || 0 };
    if (e && typeof e === 'object') {
      let x = false;
      if (typeof e.name === 'string' && e.name) { it.named = 1; x = true; }
      if (Number.isFinite(Number(e.health)) && Number(e.health) !== 1 && e.health !== undefined && e.health !== null) { it.tmp = Math.round(Number(e.health) * 100) / 100; x = true; }
      if (Number(e.enchantmentId)) { it.ench = recordName(e.enchantmentId); x = true; }
      else if (Array.isArray(e.enchantmentEffects) && e.enchantmentEffects.length) {
        it.ench = e.enchantmentEffects.slice(0, 3).map((f) => `${recordName(f.effectId)} ${Math.round(Number(f.magnitude) || 0)}`).join(', ').slice(0, 64); x = true;
      }
      if (Number.isFinite(Number(e.chargePercent)) && e.chargePercent !== undefined && e.chargePercent !== null) { it.chg = Math.round(Number(e.chargePercent)); x = true; }
      if (Number(e.soul) > 0) { it.soul = Number(e.soul); x = true; }
      if (Number(e.poisonId)) { it.poi = recordName(e.poisonId); it.poiN = Number(e.poisonCount) || undefined; x = true; }
      if (x) it.x = 1;
    }
    return it;
  };

  // ---- place (DESIGN.md 1.3): from the location poll's cache; only the pos types read pos fresh -------------------------------
  const cellName = (w) => {
    const key = `w:${w}`;
    const hit = S.recordCache.get(key);
    if (hit !== undefined) return hit;
    let n = '';
    try { const id = mp.getIdFromDesc(String(w)) >>> 0; const r = typeof api.recordOf === 'function' ? api.recordOf(id) : null; n = words(r && r.record && r.record.editorId); } catch (e) { n = ''; }
    return put('recordCache', key, (n || String(w)).slice(0, 64));
  };
  const placeOf = (a, withPos) => {
    const id = Number(a) >>> 0;
    const l = S.loc.get(id);
    let w = l ? l.w : '', pos = l ? l.pos : null, zone = l ? l.zone : undefined;
    if (withPos || !w) {
      const w2 = get(id, 'worldOrCellDesc'); const p2 = get(id, 'pos');
      if (w2) w = String(w2);
      if (Array.isArray(p2)) pos = p2;
    }
    if (!w) return undefined;
    const at = { w, cell: cellName(w), zone: zone || undefined };
    if (withPos && Array.isArray(pos)) { at.x = Math.round(pos[0]); at.y = Math.round(pos[1]); at.z = Math.round(pos[2]); }
    return at;
  };

  // ---- parties ----------------------------------------------------------------------------------------------------------------
  const hex = (a) => (Number(a) >>> 0).toString(16);
  const playerParty = (a, role) => {
    const r = idOf(a);
    if (!r) return null;
    const out = { r: role, p: r.p, c: r.c || undefined, n: r.n, a: hex(a), d: r.d || undefined };
    if (r.sn) out.sn = r.sn;
    return out;
  };
  const npcParty = (a, role) => {
    const id = Number(a) >>> 0;
    let info = S.npcInfo.get(id);
    if (!info) {
      const desc = String(get(id, 'baseDesc') || '');
      let base = 0; try { base = desc ? mp.getIdFromDesc(desc) >>> 0 : 0; } catch (e) { base = 0; }
      let edid = ''; try { const r = base && typeof api.recordOf === 'function' ? api.recordOf(base) : null; edid = String((r && r.record && r.record.editorId) || ''); } catch (e) { edid = ''; }
      const spawner = get(id, 'private.npcSpawner');
      info = { t: now(), npc: edid.slice(0, 48) || hex(id), base: base ? recordName(base) : '', kind: typeof spawner === 'string' ? spawner.replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 40) : undefined,
        champion: !!get(id, 'private.dboChampion'), owner: null };
      info.owner = ownerOfNpc(id);
      put('npcInfo', id, info);
      if (info.owner) add('ownedNpcs', id);
    }
    const out = { r: role, npc: info.npc, base: info.base || undefined, kind: info.kind };
    if (info.owner) out.owner = info.owner;
    return out;
  };
  // A companion or summon (ff_companionOf), or a GM's warband NPC (warband.js owners): the owner, as a party
  const ownerOfNpc = (id) => {
    const comp = Number(get(id, 'ff_companionOf')) >>> 0;
    if (comp && isPlayer(comp)) { const r = idOf(comp); if (r) return { p: r.p, c: r.c || undefined, n: r.n, d: r.d || undefined, why: 'companion' }; }
    try {
      const wb = globalThis.__dboWarband && globalThis.__dboWarband.owners;
      const o = wb instanceof Map ? wb.get(id) : null;
      if (o && o.gm) { const r = idOf(o.gm); if (r) return { p: r.p, c: r.c || undefined, n: r.n, d: r.d || undefined, why: 'warband' }; if (Number.isFinite(Number(o.profile))) return { p: Number(o.profile), why: 'warband' }; }
    } catch (e) { /* no warband */ }
    return null;
  };
  const partyOf = (a, role) => { const id = Number(a) >>> 0; if (!id) return null; return isPlayer(id) ? playerParty(id, role) : npcParty(id, role); };

  // ---- near lists (DESIGN.md 2.2.10): from the location poll's cache, no native get --------------------------------------
  const nearOf = (a) => {
    const id = Number(a) >>> 0;
    const me = S.loc.get(id);
    if (!me || !Array.isArray(me.pos)) return undefined;
    const reach = Number(C.nearUnits) || 3000;
    const out = [];
    for (const [b, l] of S.loc) {
      if (b === id || l.w !== me.w || !Array.isArray(l.pos) || !S.online.has(b)) continue;
      const d = Math.hypot(l.pos[0] - me.pos[0], l.pos[1] - me.pos[1], l.pos[2] - me.pos[2]);
      if (d > reach) continue;
      const r = S.ids.get(b);
      if (!r) continue;
      out.push({ p: r.p, c: r.c || undefined, n: r.n, sn: r.sn, dist: Math.round(d), staff: r.staff || undefined });
    }
    out.sort((x, y) => x.dist - y.dist);
    return out.length ? out.slice(0, Number(C.nearMax) || 10) : undefined;
  };

  // ---- emit (the hot path: Map and Set lookups, one small object, no JSON, no fs, no log) ------------------------------------
  // emit(ev, actor, f, opts): opts.o parties, opts.src, opts.q, opts.t, opts.at (a place, or true for a fresh pos), opts.ids
  // (identity given for an actor no longer readable), opts.nr false to skip the near list
  const emit = (ev, actor, f, opts) => {
    if (!S.on || !isOn(ev)) return false;
    const spec = R.typeOf(ev);
    const o = opts || {};
    const a = Number(actor) >>> 0;
    const rec = { v: R.VERSION, t: o.t || now(), ev, p: -1 };
    if (a) {
      const r = o.ids || idOf(a);
      if (r) { rec.p = r.p; if (r.c) rec.c = r.c; rec.n = r.n; if (r.sn) rec.sn = r.sn; if (r.d) rec.d = r.d; }
      rec.a = hex(a);
    } else if (o.ids) { const r = o.ids; rec.p = r.p; if (r.c) rec.c = r.c; if (r.n) rec.n = r.n; if (r.d) rec.d = r.d; }
    if (spec.place && a) { const at = o.at && typeof o.at === 'object' ? o.at : placeOf(a, spec.place === 'pos'); if (at) rec.at = at; }
    if (spec.near && a && o.nr !== false) { const nr = nearOf(a); if (nr) rec.nr = nr; }
    if (o.o && o.o.length) rec.o = o.o.filter(Boolean);
    rec.f = f || {};
    if (o.src) rec.src = o.src;
    if (o.q) rec.q = o.q;
    let pri = spec.p;
    if (typeof o.p === 'number') pri = o.p;
    const ok = enqueue(rec, pri);
    // the optional inventory diff (playerLog.inventoryDiff, off by default) notes which items an event explained
    if (ok && G.touch && a) G.touch(a, rec.f);
    return ok;
  };

  // ---- the writer (DESIGN.md 3.3): fsq, time box, writeAll, never a partial line ------------------------------------------
  const fsq = (kind, fn) => {
    const t = now();
    if (S.fsPending.has(kind)) return null;
    if (S.fsPending.size >= (Number(C.fs.maxInFlight) || 2)) return null;
    for (const at of S.fsPending.values()) if (t - at > C.fs.stallMs) return null;
    put('fsPending', kind, t);
    let p;
    try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
    return p.finally(() => { S.fsPending.delete(kind); });
  };
  const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
  const fileName = (day, roll) => path.join(S.dir, roll ? `${day}.${roll}.jsonl` : `${day}.jsonl`);
  const writeAll = async (fh, buf) => {
    let off = 0;
    while (off < buf.length) {
      let r;
      try { r = await fh.write(buf, off, buf.length - off); } catch (e) { e.written = off; throw e; }
      const n = Number(r && r.bytesWritten);
      if (!(n > 0)) { const e = new Error('a write took no bytes'); e.code = 'ESHORT'; e.written = off; throw e; }
      off += n;
    }
    return off;
  };
  // Opens the day file through fsq; resolves when S.file is ready. A day's file over rollBytes rolls to the next number.
  const openDay = (day) => fsq('open', async () => {
    let roll = S.file && S.file.day === day ? S.file.roll : 0;
    for (let i = 0; i < 64; i++) {
      const fh = await fs.promises.open(fileName(day, roll), 'a', 0o600);
      let size = 0; try { size = Number((await fh.stat()).size) || 0; } catch (e) { size = 0; }
      if (size < C.rollBytes) { S.file = { day, roll, fh, bytes: size }; return; }
      try { await fh.close(); } catch (e) { /* next */ }
      roll++;
    }
    throw new Error('no day file under the roll size');
  });
  const closeFile = () => {
    const f = S.file;
    if (!f || !f.fh) { S.file = null; return true; }
    const p = fsq('close', () => f.fh.close());
    if (!p) return false;
    S.file = null;
    p.catch((e) => err('fs.close', e));
    return true;
  };
  const ensureDir = () => {
    if (S.dirReady) return true;
    const p = fsq('mkdir', () => fs.promises.mkdir(S.dir, { recursive: true, mode: 0o700 }));
    if (p) p.then(() => { S.dirReady = true; }, (e) => err('fs.mkdir', e));
    return false;
  };
  // Drops counted since the last sys.dropped, per reason
  const dropRecords = () => {
    if (!S.dropCounts.size) return;
    const by = new Map();
    for (const [k, n] of S.dropCounts) { const i = k.indexOf('|'); const reason = k.slice(0, i), ev = k.slice(i + 1); const m = by.get(reason) || {}; m[ev] = n; by.set(reason, m); }
    S.dropCounts.clear();
    for (const [reason, counts] of by) sysEvent('sys.dropped', { reason, counts });
  };
  // Records already validated (a batch put back after a failed write) are not validated again
  const VALID = new WeakSet();
  const validated = (rec) => {
    if (VALID.has(rec)) return rec;
    const v = R.validate(rec, S.schemaDrops, S.unknownTypes);
    if (S.schemaDrops.size > CAPS.schemaDrops.cap) trimMap('schemaDrops');
    if (S.unknownTypes.size > CAPS.unknownTypes.cap) trimMap('unknownTypes');
    if (v) VALID.add(v);
    return v;
  };
  // A batch: validated lines of one day, until the time box or maxPerFlush
  const takeBatch = (t0, budget) => {
    const recs = [], parts = [], ends = [];
    let size = 0, day = null, taken = 0;
    while (taken < S.q.length && recs.length < C.maxPerFlush) {
      if (perf() - t0 > budget) break;
      const rec = S.q[taken];
      const d = dayOf(Number(rec.t) || now());
      // An event older than the open file's day goes into the open file; a newer day waits for the file to turn over
      if (day === null) day = S.file && d < S.file.day ? S.file.day : d;
      else if (d > day) break;
      taken++;
      let v = null, line = '';
      try { v = validated(rec); if (v) line = JSON.stringify(v) + '\n'; } catch (e) { err('flush.validate', e); v = null; }
      if (!v) continue;
      recs.push(v); parts.push(line); size += Buffer.byteLength(line); ends.push(size);
      // a batch never takes a day file far past its roll size, nor holds more than 4 MB
      if (size > 4 * 1024 * 1024 || (S.file ? S.file.bytes : 0) + size >= C.rollBytes) break;
    }
    return { recs, parts, ends, size, day, taken };
  };
  const requeue = (recs) => { if (recs.length) S.q.unshift(...recs); };
  const writeBatch = (b) => {
    const lead = S.needNewline ? '\n' : '';
    const buf = Buffer.from(lead + b.parts.join(''), 'utf8');
    const off0 = lead.length;
    const f = S.file;
    S.writing = { t: now(), n: b.recs.length };
    S.inflight = b.recs;
    const p = fsq('write', () => writeAll(f.fh, buf));
    if (!p) { S.writing = null; S.inflight = null; requeue(b.recs); return false; }
    S.needNewline = false;
    p.then((n) => {
      f.bytes += n;
      S.writing = null; S.inflight = null;
      if (S.dropCounts.size) dropRecords();
    }, (e) => {
      const w = Number(e && e.written) || 0;
      f.bytes += w;
      // Events wholly written are done; the rest go back to the front of the queue. A cut line gets a newline of its own.
      const done = b.ends.filter((end) => end + off0 <= w).length;
      requeue(b.recs.slice(done));
      if (w > 0 && buf[w - 1] !== 0x0a) S.needNewline = true;
      if (w === 0 && off0) S.needNewline = true;
      S.writing = null; S.inflight = null;
      const code = e && e.code;
      if (code === 'ENOSPC' || code === 'EDQUOT') { S.enospc = true; log(`player log: the disk is full (${code}); counting only until space is back`); }
      err('fs.write', e);
    });
    return true;
  };
  // The flush tick: audit lines first (up to auditBudgetMs), then validate and write until flushBudgetMs (DESIGN.md 3.3)
  let tickN = 0;
  const flushTick = (force) => {
    tickN++;
    const backlog = S.q.length >= 0.7 * C.caps.soft || S.auditQ.length >= 0.7 * C.caps.audit;
    if (!force && !backlog && tickN % Math.max(1, Math.round(C.flushMs / 1000)) !== 0) return;
    const t0 = perf();
    if (S.auditQ.length && G.parseAudits) G.parseAudits(t0 + Number(C.auditBudgetMs));
    if (!S.q.length) return;
    const t = now();
    if (S.writing) {
      if (t - S.writing.t > C.fs.writeStallMs && t - S.writeLogAt >= 60000) { S.writeLogAt = t; log(`player log: a write has been pending ${Math.round((t - S.writing.t) / 1000)} s; ${S.q.length} events wait`); }
      return;
    }
    // Counting mode (disk full or below the stop level): nothing is written, each event is counted
    if (S.enospc || S.diskLevel === 'stop') {
      const reason = S.enospc ? 'enospc' : 'disk_low';
      const n = Math.min(S.q.length, 5000);
      for (const rec of S.q.splice(0, n)) if (!String(rec.ev).startsWith('sys.')) countDrop(rec.ev, reason);
      return;
    }
    if (!ensureDir()) return;
    const want = dayOf(Math.min(Number(S.q[0].t) || t, t));
    if (!S.file || !S.file.fh || (S.file.day < want) || S.file.bytes >= C.rollBytes) {
      if (S.file && S.file.fh) {
        if (S.file.bytes >= C.rollBytes && S.file.day === want) { const roll = S.file.roll + 1; if (closeFile()) S.file = { day: want, roll, fh: null, bytes: 0 }; return; }
        closeFile();
        return;
      }
      const p = openDay(want);
      if (p) p.catch((e) => { if (e && e.code === 'ENOENT') S.dirReady = false; err('fs.open', e); });
      return;
    }
    // the events stop a millisecond early: the join, the buffer and the write call fit in the rest of the 4 ms
    const b = takeBatch(t0, Math.max(0.5, Number(C.flushBudgetMs) - 1));
    S.q.splice(0, b.taken);
    if (b.recs.length) writeBatch(b);
    if (S.schemaDrops.size || S.unknownTypes.size) S.schemaPending = true;
  };
  // Disk guard (DESIGN.md 3.5): statfs every 10 min; skipped while one is pending
  const diskCheck = () => {
    if (typeof fs.promises.statfs !== 'function') return;
    const p = fsq('statfs', () => fs.promises.statfs(path.dirname(S.dir)));
    if (!p) return;
    p.then((st) => {
      const free = Number(st.bavail) * Number(st.bsize) / 1e9;
      const g = C.diskFreeGb;
      const level = free < g.stop ? 'stop' : free < g.dropP1 ? 'p1' : free < g.dropP2 ? 'p2' : 'ok';
      if (level !== S.diskLevel) log(`player log: disk free ${free.toFixed(1)} GB, level ${level}`);
      S.diskLevel = level;
      if (S.enospc && free >= g.stop) { S.enospc = false; log('player log: disk space is back, writing again'); }
    }, (e) => err('fs.statfs', e));
  };
  // The STOP file (DESIGN.md 3.9): touch it and capture stops within 30 s; remove it and capture resumes. Skipped while busy.
  const stopCheck = () => {
    const p = fsq('access', () => fs.promises.access(C.stopFile));
    if (!p) return;
    p.then(() => true, () => false).then((present) => {
      if (present === S.stopped) return;
      S.stopped = present; setOn();
      log(`player log: ${present ? 'STOP file present, capture off' : 'STOP file gone, capture on'}`);
      if (present) sysEvent('sys.stop', { reason: 'stopfile' });
      else sysEvent('sys.start', { gen: S.gen, ver: CORE_VERSION, cfg: R.siteHash(JSON.stringify(C)), hooks: Object.keys(G.hooks).length, why: 'resume' });
    }).catch((e) => err('fs.access', e));
  };
  // The minute: sys.error and sys.schema summaries, the aged-entry trim
  const minuteTick = () => {
    const t = now();
    for (const [site, r] of S.errs) if (r.n > r.reported) { sysEvent('sys.error', { site, n: r.n - r.reported, cls: r.cls }); r.reported = r.n; }
    if (S.schemaDrops.size || S.unknownTypes.size) {
      sysEvent('sys.schema', { keys: Object.fromEntries([...S.schemaDrops].slice(0, 40)), types: Object.fromEntries([...S.unknownTypes].slice(0, 40)) });
      S.schemaDrops.clear(); S.unknownTypes.clear();
    }
    if (S.auditUnknown.size) { sysEvent('sys.audit_unknown', { verbs: Object.fromEntries([...S.auditUnknown].slice(0, 40)) }); S.auditUnknown.clear(); }
    if (typeof G.onMinute === 'function') { try { G.onMinute(t); } catch (e) { err('timer:minute.taps', e); } }
    trimAged(t);
  };

  // ---- the exit flush (DESIGN.md 3.10): the only sync IO; after the game's own saves --------------------------------------
  const plogFlushSync = () => {
    const St = globalThis.__dboPlayerLog;
    if (!St || !St.dir) return;
    try {
      const sfs = require('fs');
      try { if (St === S && G.parseAudits) G.parseAudits(Infinity); } catch (e) { /* the queue as it is */ }
      const stop = { v: R.VERSION, t: Date.now(), ev: 'sys.stop', p: -1, f: { reason: 'sigterm' }, src: 'sys', g: St.gen, s: ++St.seq };
      const recs = [...(St.inflight || []), ...St.q, stop];
      const parts = [St.needNewline || St.writing ? '\n' : ''];
      let size = 0;
      for (const rec of recs) {
        let v = null; try { v = R.validate(rec, null, null); } catch (e) { v = null; }
        if (!v) continue;
        const line = JSON.stringify(v) + '\n';
        size += line.length;
        if (size > C.exitFlushBytes) break;
        parts.push(line);
      }
      const day = new Date().toISOString().slice(0, 10);
      const file = St.file && St.file.day === day ? fileName(day, St.file.roll) : fileName(day, 0);
      try { sfs.mkdirSync(St.dir, { recursive: true, mode: 0o700 }); } catch (e) { /* it is there */ }
      sfs.appendFileSync(file, parts.join(''), { mode: 0o600 });
      St.q.length = 0;
    } catch (e) { try { log('player log: the exit flush failed', e.message); } catch (x) { /* exiting */ } }
  };
  const chainExit = () => {
    const base = globalThis.__dboFlushOnExit;
    if (typeof base === 'function' && base.__dboPlogFlush) return;
    const chained = () => { try { if (typeof base === 'function') base(); } finally { plogFlushSync(); } };
    chained.__dboPlogFlush = true;
    // The markers of the chains already on it (appearanceextras.js, racemenupresets.js), so they do not chain twice
    if (typeof base === 'function') for (const k of Object.keys(base)) if (k.startsWith('__dbo') && k !== '__dboPlogFlush') chained[k] = base[k];
    globalThis.__dboFlushOnExit = chained;
  };

  // ---- slots: the marker rule (DESIGN.md 2.2.4, 3.7) --------------------------------------------------------------------------
  // wrapSlot(holder, key, make): make(inner) returns the wrapper. A current value that is one of ours (any generation) is
  // never wrapped again: its inner is wrapped instead, so a module that failed to reload never leads to a double wrap.
  const HOLDERS = { mp: () => mp, g: () => globalThis };
  const wrapSlot = (holderName, key, make) => {
    const holder = HOLDERS[holderName]();
    const cur = holder[key];
    const inner = cur && cur.__dboPlog ? cur.__dboPlogInner : cur;
    const w = make(typeof inner === 'function' ? inner : null);
    w.__dboPlog = true;
    w.__dboPlogInner = inner;
    // the markers other modules test on what they wrap (gamemode's __dbo, itemguards' __dboGuard ...) stay visible
    if (typeof inner === 'function') for (const k of Object.keys(inner)) if (k.startsWith('__dbo') && !k.startsWith('__dboPlog')) w[k] = inner[k];
    holder[key] = w;
    add('slots', `${holderName}:${key}`);
    return w;
  };
  const unwrapAll = () => {
    for (const s of S.slots) {
      const i = s.indexOf(':');
      const holder = (HOLDERS[s.slice(0, i)] || HOLDERS.g)();
      const key = s.slice(i + 1);
      try {
        let cur = holder[key];
        // our wrapper, of whatever generation: put back what it wrapped
        let n = 0;
        while (cur && cur.__dboPlog && n++ < 8) cur = cur.__dboPlogInner;
        if (holder[key] && holder[key].__dboPlog) holder[key] = cur === undefined ? undefined : cur;
      } catch (e) { /* a slot we cannot touch */ }
    }
    S.slots.clear();
  };
  const stopTimers = () => {
    const stop = typeof api.stopTimer === 'function' ? api.stopTimer : null;
    const names = new Set(G.timers);
    try { const T = globalThis.__dboTimers; if (T instanceof Map) for (const k of T.keys()) if (String(k).startsWith('playerlog')) names.add(k); } catch (e) { /* none */ }
    for (const n of names) { try { if (stop) stop(n); } catch (e) { /* gone */ } }
    G.timers.clear();
  };
  const every = (name, ms, fn) => {
    if (typeof api.every !== 'function') return;
    G.timers.add(name);
    api.every(name, Math.max(250, Number(ms) || 1000), guard(`timer:${name}`, fn));
  };

  // ---- uninstall: every generation sets it; the next one, gamemode's catch and enabled false call it ------------------------
  const uninstall = (reason) => {
    try {
      unwrapAll();
      stopTimers();
      if (globalThis.__dboPlogHook && globalThis.__dboPlogHook.__gen === G.gen) globalThis.__dboPlogHook = null;
      if (reason === 'disabled' || reason === 'load_failed') { sysEvent('sys.stop', { reason }); S.enabled = false; }
      S.on = false;
      if (globalThis.__dboPlogUninstall === uninstall) globalThis.__dboPlogUninstall = null;
    } catch (e) { log('player log: uninstall failed', e.message); }
  };
  globalThis.__dboPlogUninstall = uninstall;

  // ---- disabled: write what is queued once, close the file, install nothing ---------------------------------------------------
  if (!S.enabled) {
    S.on = false;
    sysEvent('sys.stop', { reason: 'disabled' });
    const drain = () => {
      if (S.writing || !S.q.length) { closeFile(); return; }
      if (!S.dirReady) { ensureDir(); setTimeout(guard('disabled.drain', drain), 1000); return; }
      if (!S.file || !S.file.fh) { const p = openDay(dayOf(now())); if (p) p.then(() => setTimeout(guard('disabled.drain', drain), 0), (e) => err('fs.open', e)); else setTimeout(guard('disabled.drain', drain), 1000); return; }
      const b = takeBatch(perf(), Infinity);
      S.q.splice(0, b.taken);
      if (b.recs.length && writeBatch(b)) setTimeout(guard('disabled.drain', drain), 1000); else closeFile();
    };
    setTimeout(guard('disabled.drain', drain), 0);
    globalThis.__dboPlogUninstall = null;
    log('player log: disabled (playerLog.enabled false); hooks off, the queue written once');
    return { S, C, R, disabled: true };
  }

  // ---- the core API for the taps ------------------------------------------------------------------------------------------------
  const K = { api, mp, log, C, R, S, G, CAPS, now, perf, err, guard, put, add, emit, sysEvent, isOn, idOf, refreshId, readId, isPlayer, profileOf, partyOf,
    playerParty, npcParty, ownerOfNpc, placeOf, nearOf, recordName, recordType, itemOf, descOf, cellName, hex, get, wrapSlot, every, words, flushTick };
  let installed = 0;
  try {
    const taps = require(TAPS_JS);
    installed = taps(K) || 0;
  } catch (e) {
    // the taps did not load: nothing of this generation may stay half installed
    // gamemode.js's catch calls __dboPlogUninstall('load_failed'), which writes sys.stop
    unwrapAll(); stopTimers();
    throw e;
  }
  every('playerlogFlush', 1000, () => flushTick(false));
  every('playerlogStop', C.stopCheckMs, stopCheck);
  every('playerlogDisk', C.diskCheckMs, diskCheck);
  every('playerlogMinute', C.polls.minuteMs, minuteTick);
  chainExit();

  // ---- the dispatcher (DESIGN.md 2.0): never throws, never returns a verdict, except the command wrapper ---------------------
  const hook = (name, ...args) => {
    // The command wrapper runs the handler exactly once and returns its result, capture on or off (playerlog-taps.js)
    if (name === 'command') {
      if (typeof G.runCommand === 'function') return G.runCommand(...args);
      const [, fn, self, a, cmdArgs, userId] = args;
      return fn.call(self, a, cmdArgs, userId);
    }
    try {
      if (!S.on) return undefined;
      const h = G.hooks[name];
      if (typeof h === 'function') h(...args);
    } catch (e) { err(`hook:${String(name).slice(0, 24)}`, e); }
    return undefined;
  };
  hook.__gen = G.gen;
  setOn();
  globalThis.__dboPlogHook = hook;
  sysEvent('sys.start', { gen: S.gen, ver: CORE_VERSION, cfg: R.siteHash(JSON.stringify(C)), hooks: installed + Object.keys(G.hooks).length, why: 'load' });
  // A first check of the STOP file and the disk at once, not after the first interval
  setTimeout(guard('playerlogStop', stopCheck), 0);
  setTimeout(guard('playerlogDisk', diskCheck), 0);
  log(`player log: generation ${S.gen} on (${S.slots.size} slots, ${Object.keys(G.hooks).length} hooks, ${S.online.size} online), writing ${S.dir}${S.stopped ? '; STOP file present, capture off' : ''}`);
  return K;
};
module.exports.DEFAULTS = DEFAULTS;
module.exports.CAPS = CAPS;
