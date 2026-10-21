// DragonBreak Online: thievery and burglary, phase 1 (#staff-suggestions "Thievery & Burglary", mestreugway; Nate, 20 Oct).
// Loaded by gamemode.js after raids.js. Off unless thievery.enabled is true, and nobody is a thief until staff approve a faction.
//
// Who: only a member of an approved thief faction (config factions, plus /burglary approve by a Lead GM) burgles. Nobody
// else is ever offered anything here: their activation falls through to housingSystem.ts, which keeps its locks.
// Breaking in: crouched, a thief uses the locked door of a player's home, or a chest of it they have no access to. They work
// the lock for forceSeconds, seen working (idleKey, an idles.js crouch); players near the door and the owner are told, and a
// hit, a step away or anyone else using the door stops it. Then they pick it (lockpick.js) at lockLevel. A won lock is a breach of that home for breachMinutes: its load doors
// take the thief through (a teleport; the lock itself never opens) and its chests open the steal panel. Its doors always let
// that thief back out. One breach of a home per homeCooldownHours.
// Never a rented chest, a shop chest or a faction's storage.
// Stealing: the steal panel lists the chest's things; a whole stack is one kind, and a thief takes at most takeTypes kinds
// per takeWindowHours. Never keys, artifacts (artifacts.json), worn things, or gold unless goldStealable. Each take is kept in
// the stolen ledger with its owner.
// The Fence Chest: a Lead GM marks one container per approved faction (/fence mark <faction>, then open it). It never opens
// as a container: members get a panel to fence the stolen things they carry. A lot turns into gold (payShare of its base
// value) after fenceDays, collected there by whoever fenced it, and can be taken back before then.
// Guard raids: a guard (private.dboLawful) files /fence report <faction> <evidence>; it goes to #gm-approval-requests. A GM
// approves (/fence approve <n>): the fence freezes at once (nothing in or out, nothing turns to gold) and the faction's
// members are told; the raid may be ruled noticeHours later: /fence won <n> sends every lot back to its owner, /fence lost
// <n> lifts the freeze. A freeze nobody rules lifts after freezeMaxHours. Guards also seize stolen things from a bound,
// downed or jailed thief (/stolen <name>, /stolen seize <name>), which go back to their owners.
// A faction hall, or a ref in protectedRefs, needs a GM's permit for that thief (/burglary permit <name>, then use the door).
// Staff: the F7 admin panel's Thievery tab (staffData widget 162, dbo:staffThievery) shows the factions, fences, raids, the
// stolen ledger, permits and live breaches, and its buttons run the same actions as /burglary, /fence and /stolen return.
//
// State: thievery.json beside the server (runtime, gitignored). Item moves save at once; the rest through saveSoon.
'use strict';
const fs = require('fs');
const path = require('path');

const GOLD = 0xf;
const LOCKPICK = 0xa;
const STEALABLE = new Set(['WEAP', 'ARMO', 'AMMO', 'MISC', 'ALCH', 'INGR', 'BOOK', 'SLGM', 'SCRL', 'LIGH']);
const HOUR = 3600000, DAY = 86400000;
const DEFAULTS = {
  enabled: false, factions: [], requireSneak: true, requireOwnerOnline: true,
  forceSeconds: 30, moveTolerance: 150, idleKey: 'skin', noticeRadius: 2000, tellOwner: true, lockLevel: 3,
  breachMinutes: 10, homeCooldownHours: 12,
  takeTypes: 2, takeWindowHours: 12, goldStealable: false, listMax: 30,
  fenceDays: 14, payShare: 0.3, noticeHours: 24, freezeMaxHours: 72, maxEvidence: 600,
  seizeMeters: 5, stolenKeepDays: 60, hallsNeedPermit: true, protectedRefs: [], permitHours: 24, armSeconds: 60,
};

// ---- pure helpers (tests/thievery-harness.js) -------------------------------------------------------------------------
// Fields of an inventory entry that are not part of what the item is (shops.js keeps the same list)
const NOT_EXTRA = new Set(['baseId', 'count', 'worn', 'wornLeft']);
const kindKey = (e) => {
  const extra = {};
  for (const k of Object.keys(e || {}).sort()) { if (NOT_EXTRA.has(k)) continue; const v = e[k]; if (v === undefined || v === null || v === false) continue; extra[k] = v; }
  return `${(Number(e && e.baseId) >>> 0).toString(16)}${Object.keys(extra).length ? `|${JSON.stringify(extra)}` : ''}`;
};
// Kinds still allowed in this window, from the times of a thief's earlier takes
const quotaLeft = (times, now, C) => Math.max(0, C.takeTypes - (times || []).filter((t) => now - t < C.takeWindowHours * HOUR).length);
// The entries a thief may take: { key, baseId, count, entry }, never gold (unless allowed), worn things or other types
const pickable = (entries, typeOf, isArtifact, C) => {
  const out = [];
  for (const e of entries || []) {
    if (!e || !(Number(e.count) > 0) || e.worn || e.wornLeft) continue;
    const id = Number(e.baseId) >>> 0;
    if (id === GOLD) { if (C.goldStealable) out.push({ key: kindKey(e), baseId: id, count: Number(e.count), entry: e }); continue; }
    if (!STEALABLE.has(typeOf(id)) || isArtifact(id)) continue;
    out.push({ key: kindKey(e), baseId: id, count: Number(e.count), entry: e });
  }
  return out;
};
// Takes the first entry of this kind out of entries: { left, taken } (taken null when there is none); count caps a take
const takeKind = (entries, key, count) => {
  const left = (entries || []).map((e) => Object.assign({}, e));
  const i = left.findIndex((e) => e && !e.worn && !e.wornLeft && Number(e.count) > 0 && kindKey(e) === key);
  if (i < 0) return { left, taken: null };
  const n = Math.min(Number(left[i].count), count > 0 ? count : Number(left[i].count));
  const taken = Object.assign({}, left[i], { count: n });
  delete taken.worn; delete taken.wornLeft;
  left[i].count = Number(left[i].count) - n;
  return { left: left.filter((e) => Number(e.count) > 0), taken };
};
// An entry joins a pack: a plain one stacks on a plain one of its base, anything with extras keeps its own entry
const addEntry = (entries, entry) => {
  const out = (entries || []).map((e) => Object.assign({}, e));
  const plain = (e) => Object.keys(e).every((k) => k === 'baseId' || k === 'count');
  const into = plain(entry) ? out.find((m) => (Number(m.baseId) >>> 0) === (Number(entry.baseId) >>> 0) && plain(m)) : null;
  if (into) into.count = (Number(into.count) || 0) + Number(entry.count); else out.push(Object.assign({}, entry));
  return out;
};
// A door's XTEL: the far door (record-local), the arrival spot and its rotation in radians
const parseXtel = (data) => {
  if (!(data instanceof Uint8Array) || data.byteLength < 28) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { door: v.getUint32(0, true), pos: [v.getFloat32(4, true), v.getFloat32(8, true), v.getFloat32(12, true)], rot: [v.getFloat32(16, true), v.getFloat32(20, true), v.getFloat32(24, true)] };
};
const lotGold = (value, count, C) => Math.max(0, Math.floor((Number(value) || 0) * (Number(count) || 0) * C.payShare));

const factory = (api) => {
  const { mp, log, personal, system, audit, who, display, cfg, onUi, openWidget, closeWidget, onlineActors, every, recordOf, adminItemName,
    registerChatCommand, isAdmin, isLeadStaff, findByName, profileOf } = api;
  const fn = (f, d) => (typeof f === 'function' ? f : d);
  const sendPacket = fn(api.sendPacket, () => false);
  const staffSay = fn(api.staffSay, personal);
  const displayFor = fn(api.displayFor, (viewer, t) => display(t));
  const distanceMeters = fn(api.distanceMeters, () => Infinity);
  const approvalForum = fn(api.approvalForum, () => {});
  const staffNote = fn(api.staffNote, null);
  const saveSoon = fn(api.saveSoon, null), saveNow = fn(api.saveNow, null);
  const C = Object.assign({}, DEFAULTS, cfg.thievery || {});
  const FILE = path.resolve(C.file || 'thievery.json');
  const WIDGET_ID = 161;
  // Kept across hot reloads: break-ins under way (thief -> channel), open panels, armed staff, the loaded state
  const S = globalThis.__dboThievery || (globalThis.__dboThievery = { channels: new Map(), pending: new Map(), arm: new Map(), data: null });
  // Staff with the F7 Thievery tab open (actor -> the last state sent) and the last answer each was shown
  if (!(S.watch instanceof Map)) S.watch = new Map();
  if (!(S.panelResult instanceof Map)) S.panelResult = new Map();
  // A data-only widget the F7 Thievery tab reads (front staffData); never drawn on its own
  const THIEVERY_DATA_WIDGET_ID = 162;
  let pushWatchers = () => {};
  let armedDone = (a, r) => personal(a, r.text);

  // ---- state ----------------------------------------------------------------------------------------------------------
  const data = () => {
    if (!S.data) { try { S.data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { S.data = {}; } }
    const d = S.data;
    for (const k of ['approved', 'stolen', 'lots', 'raids', 'returns']) if (!Array.isArray(d[k])) d[k] = [];
    for (const k of ['takes', 'fences', 'owed', 'homes', 'breaches', 'permits']) if (!d[k] || typeof d[k] !== 'object') d[k] = {};
    for (const k of ['nextStolen', 'nextLot', 'nextRaid']) if (!(Number(d[k]) >= 1)) d[k] = 1;
    return d;
  };
  const snapshot = () => JSON.stringify(data(), null, 1);
  const writeSync = () => { try { const tmp = `${FILE}.tmp`; fs.writeFileSync(tmp, snapshot()); fs.renameSync(tmp, FILE); } catch (e) { log('thievery: saving failed', e.message); } };
  // Every change is saved, so the open F7 tabs hear of it here
  const changed = () => setImmediate(() => { try { pushWatchers(); } catch (e) { log('thievery: panel update failed', e.message); } });
  const save = () => { changed(); return saveSoon ? saveSoon(FILE, snapshot) : writeSync(); };
  // Item moves: the ledger is written with the inventories
  const saveMove = () => { changed(); return saveNow ? saveNow(FILE, snapshot) : writeSync(); };

  // ---- small readers --------------------------------------------------------------------------------------------------
  const get = (a, prop, fallback) => { try { const v = mp.get(a, prop); return v === undefined || v === null ? fallback : v; } catch (e) { return fallback; } };
  const hex = (n) => (Number(n) >>> 0).toString(16);
  const H = () => globalThis.__dboHousing || null;
  const typeOf = (id) => { try { const r = recordOf(id >>> 0); return r && r.record ? String(r.record.type) : ''; } catch (e) { return ''; } };
  const baseType = (ref) => { try { const d = String(mp.get(ref, 'baseDesc') || ''); return d ? typeOf(mp.getIdFromDesc(d) >>> 0) : ''; } catch (e) { return ''; } };
  const itemName = (e) => {
    if (e && typeof e.name === 'string' && e.name.trim()) return e.name.trim().slice(0, 48);
    const id = Number(e && e.baseId) >>> 0;
    if (id === GOLD) return 'Gold';
    try { const n = adminItemName(mp.getDescFromId(id)); if (n) return String(n); } catch (e2) { /* not in the catalog */ }
    const r = recordOf(id);
    return String((r && r.record && r.record.editorId) || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\d+$/, '').trim() || 'something';
  };
  const countText = (e) => `${itemName(e)}${Number(e.count) > 1 ? ` x${e.count}` : ''}`;
  const artifactRx = (() => {
    try {
      const list = (JSON.parse(fs.readFileSync(path.resolve('artifacts.json'), 'utf8')).patterns || []).filter((p) => typeof p === 'string' && p);
      return list.length ? new RegExp(list.map((p) => `(?:${p})`).join('|'), 'i') : null;
    } catch (e) { return undefined; }
  })();
  // An unreadable artifacts.json holds back everything with an editor id, so no artifact is ever taken (fail closed)
  const isArtifact = (id) => {
    if (artifactRx === null) return false;
    const r = recordOf(id >>> 0); const ed = String((r && r.record && r.record.editorId) || '');
    return artifactRx === undefined ? true : artifactRx.test(ed);
  };
  const baseValue = (id) => { try { const f = globalThis.__dboBaseValue; return typeof f === 'function' ? Math.max(0, Number(f(id >>> 0)) || 0) : 0; } catch (e) { return 0; } };
  const online = (a) => onlineActors().includes(a >>> 0);
  const guildsOf = (a) => { try { return typeof globalThis.__dboGuildsOf === 'function' ? globalThis.__dboGuildsOf(a >>> 0) || [] : []; } catch (e) { return []; } };
  const factionName = (fid) => { try { const i = typeof globalThis.__dboGuildInfo === 'function' ? globalThis.__dboGuildInfo(fid) : null; return (i && i.name) || fid; } catch (e) { return fid; } };
  const factionExists = (fid) => { try { return typeof globalThis.__dboGuildExists === 'function' ? !!globalThis.__dboGuildExists(fid) : false; } catch (e) { return false; } };
  const approvedFactions = () => new Set([...(Array.isArray(C.factions) ? C.factions : []), ...data().approved].map(String));
  // The approved faction a thief steals for: the first approved one they belong to, or ''
  const thiefFaction = (a) => { const ok = approvedFactions(); const g = guildsOf(a).find((x) => ok.has(String(x.id))); return g ? String(g.id) : ''; };
  const memberOf = (a, fid) => guildsOf(a).some((g) => String(g.id) === String(fid));
  const sneaking = (a) => { try { return !!mp.callPapyrusFunction('method', 'ObjectReference', 'GetAnimationVariableBool', { type: 'form', desc: mp.getDescFromId(a >>> 0) }, ['IsSneaking']); } catch (e) { return false; } };
  const downed = (a) => { try { return typeof globalThis.__dboIsDowned === 'function' && !!globalThis.__dboIsDowned(a); } catch (e) { return false; } };
  const restrained = (a) => { const r = get(a, 'private.restrained', null) || {}; return !!(r.boundHands || r.carried); };
  const inBeastForm = (a) => { const s = get(a, 'private.beast', null); return !!(s && s.form); };
  const jailed = (a) => { const s = get(a, 'private.dboSentence', null); return !!(s && Number(s.totalMs) > (Number(s.servedMs) || 0)); };
  const lawful = (a) => get(a, 'private.dboLawful', false) === true;
  const hitSince = (a, t) => { const m = globalThis.__dboPvpAt; return m instanceof Map && (Number(m.get(a >>> 0)) || 0) > t; };
  const posOf = (a) => { const p = get(a, 'pos', null); return Array.isArray(p) ? p : null; };
  const cellOf = (a) => String(get(a, 'worldOrCellDesc', '') || '').toLowerCase();
  const units = (p, q) => (p && q ? Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) : Infinity);

  // ---- homes ----------------------------------------------------------------------------------------------------------
  // The claim a door or chest belongs to: { p (the home's primary), rec, kind 'door'|'chest' }, or null for anything else
  const homeOf = (ref) => {
    const h = H(); if (!h || typeof h.primaryOf !== 'function') return null;
    let p = 0, rec = null;
    try { p = Number(h.primaryOf(ref)) >>> 0; rec = p ? h.recordOf(ref) : null; } catch (e) { return null; }
    if (!p || !rec || !(Number(rec.owner) > 0)) return null;
    const t = baseType(ref);
    if (t !== 'DOOR' && t !== 'CONT') return null;
    // A faction's storage, a rented chest or a weapon rack is no home's: their own modules keep them
    try { if (typeof globalThis.__dboGuildStorageAt === 'function' && globalThis.__dboGuildStorageAt(ref)) return null; } catch (e) { return null; }
    try { if (typeof globalThis.__dboBusinessChestOf === 'function' && globalThis.__dboBusinessChestOf(ref)) return null; } catch (e) { return null; }
    // A shop chest (shops.js) is sold from at its ledger, never rifled
    try { const B = globalThis.__dboBusiness; if (B && B.data && Object.values(B.data.businesses || {}).some((b) => b && b.shop && b.shop.chest === hex(ref))) return null; } catch (e) { return null; }
    return { p, rec, kind: t === 'DOOR' ? 'door' : 'chest' };
  };
  const homeLabel = (rec) => (rec && typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : 'a home');
  const ownerActors = (rec) => { try { const h = H(); return (h && typeof h.ownerActorsOf === 'function' ? h.ownerActorsOf(rec) : []).map((x) => Number(x) >>> 0); } catch (e) { return []; } };
  // Anyone the lock would let in is no burglar here: they fall through to the housing menu as before
  const hasAccess = (a, ref, rec) => {
    const h = H(); if (!h) return true;
    try {
      if (typeof h.ownsRecord === 'function' && h.ownsRecord(rec, a)) return true;
      if (typeof h.keyOpens === 'function' && h.keyOpens(ref, a)) return true;
      if (typeof h.isManager === 'function' && h.isManager(a, ref)) return true;
      if (typeof h.isFiefHolder === 'function' && h.isFiefHolder(a, ref)) return true;
      const pid = Number(profileOf(a));
      if (Number(rec.owner) === pid) return true;
      for (const x of Object.values(rec.assigned || {})) if (x && (Number(x.char) >>> 0 === (a >>> 0) || (!x.char && Number(x.profile) === pid))) return true;
    } catch (e) { return true; }
    return false;
  };
  const hallOf = (p, rec) => { try { return typeof globalThis.__dboHallOf === 'function' ? globalThis.__dboHallOf([p, Number(rec.partner) >>> 0].filter(Boolean)) || [] : []; } catch (e) { return []; } };
  const isLoadDoor = (ref) => !!xtelOf(ref);
  const xtelOf = (ref) => {
    try {
      const r = mp.lookupEspmRecordById(ref >>> 0);
      const f = ((r && r.record && r.record.fields) || []).find((x) => x && x.type === 'XTEL');
      const x = f ? parseXtel(f.data) : null;
      if (!x || !x.door) return null;
      x.door = typeof r.toGlobalRecordId === 'function' ? r.toGlobalRecordId(x.door) >>> 0 : x.door >>> 0;
      return x;
    } catch (e) { return null; }
  };
  const doorsPos = (() => { try { return JSON.parse(fs.readFileSync(path.resolve('doors-pos.json'), 'utf8')).doors || {}; } catch (e) { return {}; } })();
  // Where a door's far side stands: the engine's own word, else doors-pos.json spelled as the far door's plugin is
  const farPlace = (door) => {
    const w = String(get(door, 'worldOrCellDesc', '') || '');
    if (w) return w;
    let desc = ''; try { desc = String(mp.getDescFromId(door >>> 0)); } catch (e) { return ''; }
    const row = doorsPos[desc] || Object.entries(doorsPos).find(([k]) => k.toLowerCase() === desc.toLowerCase())?.[1];
    if (!Array.isArray(row) || typeof row[3] !== 'string') return '';
    const cell = row[3], i = cell.indexOf(':'), j = desc.indexOf(':');
    return i > 0 && j > 0 && cell.slice(i + 1).toLowerCase() === desc.slice(j + 1).toLowerCase() ? `${cell.slice(0, i)}:${desc.slice(j + 1)}` : cell;
  };
  // Through a load door without opening its lock
  const goThrough = (a, door) => {
    const x = xtelOf(door); if (!x) return false;
    const where = farPlace(x.door); if (!where) return false;
    try { mp.set(a, 'locationalData', { cellOrWorldDesc: where, pos: x.pos, rot: x.rot.map((r) => (Number(r) || 0) * 180 / Math.PI) }); return true; }
    catch (e) { log('thievery: going through a door failed', e.message); return false; }
  };

  // ---- breaches ---------------------------------------------------------------------------------------------------------
  // One per home and thief, kept a week so a thief inside can always leave
  const breachKey = (a, p) => `${hex(p)}:${hex(a)}`;
  const breachOf = (a, p) => data().breaches[breachKey(a, p)] || null;
  const breachLive = (b, now) => !!b && now < Number(b.until);
  // Leaving: at a door away from where the lock was forced (a door's breach), or where the forced chest stands (a chest's)
  const leaving = (a, b) => !!b && (b.outsideCell ? cellOf(a) !== b.outsideCell : !!b.innerCell && cellOf(a) === b.innerCell);
  const tellNear = (thief, door, text) => {
    const at = posOf(door) || posOf(thief), cell = String(get(door, 'worldOrCellDesc', '') || '').toLowerCase();
    for (const o of onlineActors()) {
      if (o === (thief >>> 0) || cellOf(o) !== cell || units(posOf(o), at) > C.noticeRadius) continue;
      try { personal(o, text(o)); } catch (e) { /* gone */ }
    }
  };
  // The visible work at the lock: an interaction idle (idles.js) held while it lasts, which other players see through the
  // animation sync; idleKey '' plays none
  const holdIdle = (a) => { try { return C.idleKey && typeof globalThis.__dboHoldIdle === 'function' ? globalThis.__dboHoldIdle(a, C.idleKey) : null; } catch (e) { return null; } };
  const endChannel = (ch) => { S.channels.delete(ch.a); changed(); try { if (ch.idle && typeof globalThis.__dboStopIdle === 'function') globalThis.__dboStopIdle(ch.a, ch.idle); } catch (e) { /* offline */ } };
  const interrupt = (a, why) => {
    const ch = S.channels.get(a >>> 0); if (!ch) return;
    endChannel(ch);
    personal(a, why);
    audit(`BURGLARY ${who(a)} stopped at ${homeLabel(ch.rec)} (${hex(ch.p)}): ${why}`);
  };

  const refuseBreakIn = (a, ref, home) => {
    const now = Date.now();
    if (inBeastForm(a)) return 'Not in a beast form.';
    if (restrained(a) || downed(a) || get(a, 'isDead', false) === true) return 'Not now.';
    if (hitSince(a, now - 15000)) return 'Not in the middle of a fight.';
    if (S.channels.has(a >>> 0)) return 'You are already at work on a lock.';
    if ([...S.channels.values()].some((c) => c.p === home.p)) return 'Someone is already at work on that lock.';
    const rec = home.rec;
    if (Number(rec.owner) === Number(profileOf(a))) return 'That home is your own account\'s.';
    const permit = data().permits[hex(home.p)];
    const permitted = permit && (Number(permit.thief) >>> 0) === (a >>> 0) && now < Number(permit.until);
    const protectedRef = (C.protectedRefs || []).map((x) => String(x).toLowerCase()).includes(hex(home.p));
    if (!permitted && (protectedRef || (C.hallsNeedPermit && hallOf(home.p, rec).length))) return 'A faction\'s hall or a great house is no common burglary: it needs a GM\'s approval first (/gm, and say what you mean to steal).';
    if (C.requireOwnerOnline && !ownerActors(rec).some(online)) return `Nobody of ${homeLabel(rec)} is about. For now a home is only broken into while its owner is in the land.`;
    const last = Number(data().homes[hex(home.p)]) || 0;
    if (now - last < C.homeCooldownHours * HOUR) return `${homeLabel(rec)} was broken into lately. Its owner is on guard; try again in ${Math.ceil((last + C.homeCooldownHours * HOUR - now) / HOUR)} hours.`;
    const lock = globalThis.__dboLockpick;
    if (!lock || typeof lock.begin !== 'function') return 'You cannot work that lock right now.';
    if (lock.busy(a)) return 'You are already picking a lock.';
    const picks = (get(a, 'inventory', { entries: [] }).entries || []).reduce((n, e) => n + (e && (Number(e.baseId) >>> 0) === LOCKPICK && !e.worn ? Number(e.count) || 0 : 0), 0);
    if (!picks) return 'You would need a lockpick.';
    return '';
  };

  const beginBreakIn = (a, ref, home) => {
    const why = refuseBreakIn(a, ref, home);
    if (why) { personal(a, why); return; }
    const now = Date.now();
    const ch = { a: a >>> 0, ref: ref >>> 0, p: home.p, rec: home.rec, kind: home.kind, at: now, until: now + C.forceSeconds * 1000, pos: posOf(a), cell: cellOf(a) };
    S.channels.set(a >>> 0, ch);
    changed();
    ch.idle = holdIdle(a);
    const label = homeLabel(home.rec);
    personal(a, `You set to work on the lock of ${label}. Hold still for ${C.forceSeconds} seconds; anyone near can see you, and a blow or a step away stops you.`);
    tellNear(a, ref, (o) => `${displayFor(o, a)} is forcing the lock of ${label}. Use the ${home.kind === 'door' ? 'door' : 'chest'} or strike them to stop it.`);
    if (C.tellOwner) for (const o of ownerActors(home.rec)) if (online(o)) { personal(o, `Someone is breaking into ${label}!`); try { sendPacket(o, { customPacketType: 'dboBanner', text: `Someone is breaking into ${label}`, seconds: 6 }); } catch (e) { /* old client */ } }
    audit(`BURGLARY ${who(a)} begins forcing ${home.kind} ${hex(ref)} of ${label} (${hex(home.p)}, owner ${home.rec.ownerName || home.rec.owner})`);
  };

  // The forcing is over: the lock itself, at lockLevel; a win is the breach
  const forced = (ch) => {
    const a = ch.a;
    const lock = globalThis.__dboLockpick;
    if (!lock) { personal(a, 'You cannot work that lock right now.'); return; }
    lock.begin(a, {
      target: ch.ref, level: C.lockLevel, label: `Lock of ${homeLabel(ch.rec)}`,
      onSuccess: () => {
        if (hitSince(a, ch.at)) { personal(a, 'The lock gives, but you were seen to: the moment is lost.'); return; }
        const now = Date.now();
        const d = data();
        d.breaches[breachKey(a, ch.p)] = { thief: a, name: display(a), at: now, until: now + C.breachMinutes * 60000, faction: thiefFaction(a),
          [ch.kind === 'door' ? 'outsideCell' : 'innerCell']: ch.cell };
        d.homes[hex(ch.p)] = now;
        save();
        audit(`BURGLARY ${who(a)} broke into ${homeLabel(ch.rec)} (${hex(ch.p)}) through ${ch.kind} ${hex(ch.ref)}`);
        if (ch.kind === 'door' && goThrough(a, ch.ref)) system(a, `You are in, with ${C.breachMinutes} minutes at this home's chests. Its doors let you out.`);
        else system(a, `The lock gives. You have ${C.breachMinutes} minutes at this home's chests.`);
        if (ch.kind === 'chest') stealPanel(a, ch.ref, { p: ch.p, rec: ch.rec });
      },
    });
  };

  every('thievery', 1000, () => {
    const now = Date.now();
    for (const ch of [...S.channels.values()]) {
      const a = ch.a;
      if (!online(a)) { endChannel(ch); continue; }
      if (hitSince(a, ch.at)) { interrupt(a, 'A blow breaks your work on the lock.'); continue; }
      if (downed(a) || restrained(a) || get(a, 'isDead', false) === true) { interrupt(a, 'Your work on the lock is over.'); continue; }
      if (cellOf(a) !== ch.cell || units(posOf(a), ch.pos) > C.moveTolerance) { interrupt(a, 'You stepped away from the lock.'); continue; }
      if (now >= ch.until) { endChannel(ch); forced(ch); }
    }
    return S.channels.size;
  });

  // ---- stealing -----------------------------------------------------------------------------------------------------
  const takesOf = (a) => { const d = data(); const k = hex(a); d.takes[k] = (d.takes[k] || []).filter((t) => Date.now() - t < C.takeWindowHours * HOUR); return d.takes[k]; };
  const stealPanel = (a, chest, home) => {
    const left = quotaLeft(takesOf(a), Date.now(), C);
    const inv = get(chest, 'inventory', null);
    const list = pickable(inv && inv.entries, typeOf, isArtifact, C).slice(0, C.listMax);
    const actions = left > 0 ? list.map((x, i) => ({ id: `t${i}`, label: `Take ${countText(x.entry)}` })) : [];
    S.pending.set(a >>> 0, { kind: 'steal', chest: chest >>> 0, p: home.p, keys: list.map((x) => x.key) });
    const head = left > 0 ? `${homeLabel(home.rec)}: take ${left} more kind${left === 1 ? '' : 's'} of thing today (a stack is one)` : `${homeLabel(home.rec)}: you have taken all you can carry off for now`;
    openWidget(a, { type: 'contextMenu', id: WIDGET_ID, mode: 'menu', targetName: list.length ? head : `${homeLabel(home.rec)}: nothing here worth taking`, actions, events: { action: 'dbo:thiefChoose', close: 'dbo:thiefClose' } }, true);
  };
  const steal = (a, pend, idx) => {
    const now = Date.now();
    const home = homeOf(pend.chest);
    if (!home || home.p !== pend.p || !breachLive(breachOf(a, home.p), now)) return personal(a, 'Your moment in this home has passed.');
    if (!thiefFaction(a)) return personal(a, 'You are no thief of an approved faction.');
    if (hasAccess(a, pend.chest, home.rec)) return personal(a, 'That is a chest you may open anyway.');
    if (units(posOf(a), posOf(pend.chest)) > 400 || cellOf(a) !== String(get(pend.chest, 'worldOrCellDesc', '') || '').toLowerCase()) return personal(a, 'You are too far from the chest.');
    if (quotaLeft(takesOf(a), now, C) <= 0) return personal(a, 'You have taken all you can carry off for now.');
    const key = pend.keys[idx]; if (!key) return;
    const inv = get(pend.chest, 'inventory', null);
    if (!pickable(inv && inv.entries, typeOf, isArtifact, C).some((x) => x.key === key)) return personal(a, 'That is no longer there.');
    const from = takeKind(inv.entries, key, 0);
    if (!from.taken) return personal(a, 'That is no longer there.');
    const mine = get(a, 'inventory', { entries: [] });
    const before = inv.entries.map((e) => Object.assign({}, e));
    try { mp.set(pend.chest, 'inventory', { entries: from.left }); } catch (e) { log('thievery: taking from a chest failed', e.message); return personal(a, 'It will not come loose.'); }
    try { mp.set(a, 'inventory', { entries: addEntry(mine.entries, from.taken) }); } catch (e) {
      try { mp.set(pend.chest, 'inventory', { entries: before }); } catch (x) { log('thievery: could not put a chest back', x.message); }
      log('thievery: giving a theft failed', e.message); return personal(a, 'It will not come loose.');
    }
    const d = data();
    takesOf(a).push(now);
    const rec = home.rec;
    d.stolen.push({ n: d.nextStolen++, entry: from.taken, owner: Number(rec.owner) || 0, ownerChar: Number(rec.ownerChar) >>> 0, ownerName: String(rec.ownerName || ''),
      home: hex(home.p), homeName: homeLabel(rec), chest: hex(pend.chest), thief: a >>> 0, thiefName: display(a), faction: thiefFaction(a), at: now, state: 'carried' });
    saveMove();
    personal(a, `You take ${countText(from.taken)}.`);
    for (const o of ownerActors(rec)) if (online(o)) system(o, `Something has gone from a chest in ${homeLabel(rec)}.`);
    audit(`BURGLARY ${who(a)} stole ${countText(from.taken)} [${hex(from.taken.baseId)}] from chest ${hex(pend.chest)} of ${homeLabel(rec)} (${hex(home.p)}, owner ${rec.ownerName || rec.owner})`);
    stealPanel(a, pend.chest, home);
  };

  // ---- returns to owners ----------------------------------------------------------------------------------------------
  const returnToOwner = (s, why) => { data().returns.push({ owner: s.owner, ownerChar: s.ownerChar, entry: s.entry, why, at: Date.now(), from: s.homeName }); };
  const deliverReturns = () => {
    const d = data(); if (!d.returns.length) return;
    const on = onlineActors();
    let changed = false;
    d.returns = d.returns.filter((r) => {
      const to = on.find((o) => (r.ownerChar ? o === (r.ownerChar >>> 0) : Number(profileOf(o)) === Number(r.owner)));
      if (!to) return true;
      try { const inv = get(to, 'inventory', { entries: [] }); mp.set(to, 'inventory', { entries: addEntry(inv.entries, r.entry) }); }
      catch (e) { log('thievery: a return failed', e.message); return true; }
      changed = true;
      system(to, `${r.why}: ${countText(r.entry)}, taken from ${r.from}, is back in your pack.`);
      audit(`BURGLARY returned ${countText(r.entry)} [${hex(r.entry.baseId)}] to ${who(to)} (${r.why})`);
      return false;
    });
    if (changed) saveMove();
  };

  // ---- the Fence Chest --------------------------------------------------------------------------------------------------
  const fenceAt = (ref) => Object.entries(data().fences).find(([, f]) => f && f.chest === hex(ref)) || null;
  const lotsOf = (fid) => data().lots.filter((l) => l.fid === fid && l.state === 'held');
  const carriedBy = (a) => {
    const inv = get(a, 'inventory', { entries: [] });
    return data().stolen.filter((s) => s.state === 'carried' && (Number(s.thief) >>> 0) === (a >>> 0))
      .filter((s) => (inv.entries || []).some((e) => !e.worn && !e.wornLeft && kindKey(e) === kindKey(s.entry) && Number(e.count) > 0));
  };
  const daysLeft = (ms) => { const h = Math.max(0, Math.ceil(ms / HOUR)); return h >= 48 ? `${Math.ceil(h / 24)} days` : `${h} hours`; };
  const fencePanel = (a, fid, chest, note) => {
    const f = data().fences[fid];
    const frozen = f && f.frozen ? data().raids.find((r) => r.n === f.frozen) : null;
    const actions = [];
    const ids = [];
    if (!frozen) {
      for (const s of carriedBy(a).slice(0, 12)) { actions.push({ id: `f${s.n}`, label: `Fence ${countText(s.entry)} (from ${s.homeName})` }); ids.push(`f${s.n}`); }
      for (const l of lotsOf(fid).filter((x) => (Number(x.by) >>> 0) === (a >>> 0)).slice(0, 12)) { actions.push({ id: `b${l.n}`, label: `Take back ${countText(l.entry)} (gold in ${daysLeft(l.matureAt - Date.now())})` }); ids.push(`b${l.n}`); }
      const owed = Number(data().owed[hex(a)]) || 0;
      if (owed > 0) { actions.push({ id: 'collect', label: `Collect ${owed} gold` }); ids.push('collect'); }
    }
    S.pending.set(a >>> 0, { kind: 'fence', fid, chest: chest >>> 0, ids });
    const held = lotsOf(fid).length;
    const title = frozen ? `Fence Chest of ${factionName(fid)}: frozen. The guards have leave to raid (from ${new Date(frozen.raidAt).toUTCString().slice(5, 22)} UTC); nothing goes in or out`
      : `${note ? `${note} ` : ''}Fence Chest of ${factionName(fid)}: ${held} lot${held === 1 ? '' : 's'} waiting. Stolen goods turn to gold after ${C.fenceDays} days`;
    openWidget(a, { type: 'contextMenu', id: WIDGET_ID, mode: 'menu', targetName: title, actions, events: { action: 'dbo:thiefChoose', close: 'dbo:thiefClose' } }, true);
  };
  const fenceAct = (a, pend, id) => {
    const d = data(); const f = d.fences[pend.fid];
    if (!f || f.chest !== hex(pend.chest)) return personal(a, 'That is no fence any more.');
    if (!memberOf(a, pend.fid) || !approvedFactions().has(pend.fid)) return personal(a, 'That chest is not yours to use.');
    if (units(posOf(a), posOf(pend.chest)) > 400) return personal(a, 'You are too far from the chest.');
    if (f.frozen) return fencePanel(a, pend.fid, pend.chest);
    const now = Date.now();
    if (id === 'collect') {
      const owed = Number(d.owed[hex(a)]) || 0; if (!(owed > 0)) return fencePanel(a, pend.fid, pend.chest);
      const inv = get(a, 'inventory', { entries: [] });
      try { mp.set(a, 'inventory', { entries: addEntry(inv.entries, { baseId: GOLD, count: owed }) }); } catch (e) { log('thievery: paying out failed', e.message); return personal(a, 'The fence cannot pay you right now.'); }
      delete d.owed[hex(a)]; saveMove();
      audit(`FENCE ${who(a)} collected ${owed} gold at the fence of ${factionName(pend.fid)}`);
      return fencePanel(a, pend.fid, pend.chest, `You collect ${owed} gold.`);
    }
    const n = Number(id.slice(1));
    if (id[0] === 'f') {
      const s = d.stolen.find((x) => x.n === n && x.state === 'carried' && (Number(x.thief) >>> 0) === (a >>> 0));
      if (!s) return fencePanel(a, pend.fid, pend.chest);
      const inv = get(a, 'inventory', { entries: [] });
      const out = takeKind(inv.entries, kindKey(s.entry), Number(s.entry.count));
      if (!out.taken) return fencePanel(a, pend.fid, pend.chest, 'You no longer carry it.');
      try { mp.set(a, 'inventory', { entries: out.left }); } catch (e) { log('thievery: fencing failed', e.message); return personal(a, 'The fence will not take it right now.'); }
      // What was not there (sold, dropped, used) stays carried on the ledger for what remains
      const rest = Number(s.entry.count) - Number(out.taken.count);
      if (rest > 0) d.stolen.push(Object.assign({}, s, { n: d.nextStolen++, entry: Object.assign({}, s.entry, { count: rest }) }));
      s.entry = out.taken; s.state = 'fenced';
      const lot = { n: d.nextLot++, fid: pend.fid, stolen: s.n, entry: out.taken, by: a >>> 0, byName: display(a), at: now, matureAt: now + C.fenceDays * DAY, state: 'held',
        owner: s.owner, ownerChar: s.ownerChar, ownerName: s.ownerName, homeName: s.homeName };
      s.lot = lot.n; d.lots.push(lot); saveMove();
      audit(`FENCE ${who(a)} fenced ${countText(out.taken)} [${hex(out.taken.baseId)}] (stolen #${s.n} from ${s.homeName}) at ${factionName(pend.fid)}; gold on ${new Date(lot.matureAt).toISOString()}`);
      return fencePanel(a, pend.fid, pend.chest, `${countText(out.taken)} is with the fence.`);
    }
    if (id[0] === 'b') {
      const l = d.lots.find((x) => x.n === n && x.state === 'held' && x.fid === pend.fid && (Number(x.by) >>> 0) === (a >>> 0));
      if (!l) return fencePanel(a, pend.fid, pend.chest);
      const inv = get(a, 'inventory', { entries: [] });
      try { mp.set(a, 'inventory', { entries: addEntry(inv.entries, l.entry) }); } catch (e) { log('thievery: taking back failed', e.message); return personal(a, 'The fence cannot find it right now.'); }
      l.state = 'taken back';
      const s = d.stolen.find((x) => x.n === l.stolen); if (s) { s.state = 'carried'; delete s.lot; }
      saveMove();
      audit(`FENCE ${who(a)} took back ${countText(l.entry)} (lot ${l.n}) from the fence of ${factionName(pend.fid)}`);
      return fencePanel(a, pend.fid, pend.chest, `You take back ${countText(l.entry)}.`);
    }
    return undefined;
  };
  // Lots past their days turn into gold for whoever fenced them, unless the fence is frozen
  const mature = () => {
    const d = data(); const now = Date.now(); let n = 0;
    for (const l of d.lots) {
      if (l.state !== 'held' || now < Number(l.matureAt)) continue;
      const f = d.fences[l.fid]; if (f && f.frozen) continue;
      const gold = lotGold(baseValue(Number(l.entry.baseId) >>> 0), l.entry.count, C);
      d.owed[hex(l.by)] = (Number(d.owed[hex(l.by)]) || 0) + gold;
      l.state = 'sold'; l.gold = gold; l.soldAt = now;
      const s = d.stolen.find((x) => x.n === l.stolen); if (s) s.state = 'sold';
      audit(`FENCE lot ${l.n} (${countText(l.entry)} [${hex(l.entry.baseId)}], stolen from ${l.homeName}) of ${factionName(l.fid)} sold for ${gold} gold to ${l.byName}`);
      if (online(l.by)) system(l.by, `The fence has sold ${countText(l.entry)}: ${gold} gold waits for you at the Fence Chest.`);
      n++;
    }
    // Finished records go after stolenKeepDays
    const cut = now - C.stolenKeepDays * DAY;
    const before = d.stolen.length + d.lots.length;
    d.stolen = d.stolen.filter((s) => s.state === 'carried' || s.state === 'fenced' || Number(s.at) > cut);
    d.lots = d.lots.filter((l) => l.state === 'held' || Number(l.at) > cut);
    let gone = 0;
    for (const [k, b] of Object.entries(d.breaches)) if (now - Number(b.at) > 7 * DAY) { delete d.breaches[k]; gone++; }
    if (n || gone || before !== d.stolen.length + d.lots.length) saveMove();
  };

  // ---- guard raids on a fence -------------------------------------------------------------------------------------------
  const raidKey = (r) => `fence-raid:${r.n}`;
  const forum = (op) => { try { approvalForum(op); } catch (e) { log('thievery: approval forum failed', e.message); } };
  const openRaid = (fid) => data().raids.find((r) => r.fid === fid && (r.state === 'pending' || r.state === 'approved'));
  const unfreeze = (r) => { const f = data().fences[r.fid]; if (f && f.frozen === r.n) delete f.frozen; };
  const raidLine = (r) => `#${r.n} ${factionName(r.fid)} ${r.state}${r.state === 'approved' ? `, may be ruled from ${new Date(r.raidAt).toISOString().slice(0, 16)}Z` : ''}, by ${r.byName}: ${r.evidence}`;
  const tellRaid = () => {
    const now = Date.now(); let changed = false;
    for (const r of data().raids) {
      if (r.state !== 'approved') continue;
      if (now > Number(r.approvedAt) + C.freezeMaxHours * HOUR) {
        r.state = 'expired'; unfreeze(r); changed = true;
        audit(`FENCE raid #${r.n} on ${factionName(r.fid)} expired unruled; the fence is free again`);
        forum({ kind: 'close', key: raidKey(r), text: `No ruling within ${C.freezeMaxHours} hours: the freeze is lifted.` });
        continue;
      }
      r.told = Array.isArray(r.told) ? r.told : [];
      for (const o of onlineActors()) {
        if (r.told.includes(o) || !memberOf(o, r.fid)) continue;
        r.told.push(o); changed = true;
        personal(o, `Word from the street: the guards have leave to raid the fence of ${factionName(r.fid)} from ${new Date(r.raidAt).toUTCString().slice(5, 22)} UTC. The Fence Chest is frozen until then; nothing goes in or out.`);
        try { sendPacket(o, { customPacketType: 'dboBanner', text: 'The guards are coming for the fence', seconds: 6 }); } catch (e) { /* old client */ }
      }
    }
    if (changed) save();
  };
  every('thieveryTick', 30000, () => { deliverReturns(); tellRaid(); mature(); pushWatchers(); return 0; });

  // ---- the activation hook ------------------------------------------------------------------------------------------
  // gamemode.js asks this before housing's locks; true ends the activation here (nothing opens). Anyone not handled here
  // falls through untouched, so the locks hold for everyone but the moves this module makes itself.
  globalThis.__dboBurglaryActivate = (target, caster) => {
    target >>>= 0; caster >>>= 0;
    // Staff arming a fence or a permit, whether or not thievery is on
    const armed = S.arm.get(caster);
    if (armed && Date.now() < armed.until) {
      S.arm.delete(caster);
      armedDone(caster, armed.kind === 'fence' ? markFence(caster, target, armed.fid) : permitAt(caster, target, armed));
      return true;
    }
    const fence = fenceAt(target);
    if (fence) {
      if (C.enabled && memberOf(caster, fence[0]) && approvedFactions().has(fence[0])) fencePanel(caster, fence[0], target);
      else personal(caster, 'It is locked tight.');
      return true;
    }
    if (!C.enabled) return false;
    // Someone else at a door or chest being forced stops the burglar
    const at = S.channels.size ? homeOf(target) : null;
    for (const ch of S.channels.values()) {
      if (ch.a === caster) continue;
      if (at && at.p === ch.p) { interrupt(ch.a, `${displayFor(ch.a, caster)} disturbs you at the lock.`); personal(caster, 'You disturb someone at the lock.'); return false; }
    }
    if (!thiefFaction(caster)) return false;
    const home = homeOf(target);
    if (!home || hasAccess(caster, target, home.rec)) return false;
    const now = Date.now();
    const b = breachOf(caster, home.p);
    if (home.kind === 'door') {
      if (!isLoadDoor(target) || home.rec.locked !== true) return false;
      if ((breachLive(b, now) || leaving(caster, b)) && goThrough(caster, target)) { system(caster, 'You slip through; the lock stays as it was.'); return true; }
      if (C.requireSneak && !sneaking(caster)) return false;
      beginBreakIn(caster, target, home);
      return true;
    }
    if (breachLive(b, now)) { stealPanel(caster, target, home); return true; }
    if (C.requireSneak && !sneaking(caster)) return false;
    beginBreakIn(caster, target, home);
    return true;
  };

  onUi('thiefChoose', (a, args) => {
    const pend = S.pending.get(a >>> 0); S.pending.delete(a >>> 0);
    closeWidget(a, WIDGET_ID);
    if (!pend) return;
    const choice = String((args || [])[0] || '');
    if (pend.kind === 'steal') { const m = /^t(\d+)$/.exec(choice); if (m) steal(a, pend, Number(m[1])); return; }
    if (pend.kind === 'fence' && pend.ids.includes(choice)) fenceAct(a, pend, choice);
  });
  onUi('thiefClose', (a) => { S.pending.delete(a >>> 0); closeWidget(a, WIDGET_ID); });

  // ---- staff actions: one path for the commands and the F7 Thievery tab ---------------------------------------------------
  // Each returns { ok, text }; the commands say the text, the tab shows it. Tiers: Lead GM for factions and fences, any GM for
  // raids, permits and sending stolen goods back (a raid ruled before its notice is out: Lead GM).
  const res = (ok, text) => ({ ok: !!ok, text: String(text) });
  const setFaction = (a, fid, on) => {
    if (!isLeadStaff(a)) return res(false, 'Lead GMs and above approve thief factions.');
    if (!factionExists(fid)) return res(false, `No faction "${fid}". Use its id, as /burglary factions lists them.`);
    const d = data();
    d.approved = d.approved.filter((x) => x !== fid);
    if (on) d.approved.push(fid);
    save();
    audit(`BURGLARY ${who(a)} ${on ? 'approved' : 'revoked'} ${fid} as a thief faction`);
    return res(true, `${factionName(fid)} is ${on ? 'now' : 'no longer'} a thief faction${!on && (C.factions || []).includes(fid) ? ' here, but the config still lists it' : ''}.`);
  };
  const armFence = (a, fid) => {
    if (!isLeadStaff(a)) return res(false, 'Lead GMs and above place a Fence Chest.');
    if (!approvedFactions().has(fid)) return res(false, `${fid || 'That'} is no approved thief faction (/burglary factions).`);
    S.arm.set(a >>> 0, { kind: 'fence', fid, until: Date.now() + C.armSeconds * 1000 });
    return res(true, `Now open the container in ${factionName(fid)}'s hall that is to be its Fence Chest (within ${C.armSeconds} s).`);
  };
  const unmarkFence = (a, fid) => {
    if (!isLeadStaff(a)) return res(false, 'Lead GMs and above place a Fence Chest.');
    const d = data();
    if (!d.fences[fid]) return res(false, 'It has no fence.');
    if (lotsOf(fid).length || d.fences[fid].frozen) return res(false, 'Its fence still holds lots or is frozen; mark another chest instead, and the lots move with it.');
    delete d.fences[fid]; save(); audit(`FENCE ${who(a)} removed the Fence Chest of ${factionName(fid)}`);
    return res(true, `The Fence Chest of ${factionName(fid)} is a plain container again.`);
  };
  // The armed staff member's next activation (the hook above)
  const markFence = (a, ref, fid) => {
    if (!isLeadStaff(a)) return res(false, 'Lead GMs and above place a Fence Chest.');
    if (baseType(ref) !== 'CONT') return res(false, 'That is no container. Mark again.');
    const hall = (() => { try { return typeof globalThis.__dboGuildHall === 'function' ? globalThis.__dboGuildHall(fid) : null; } catch (e) { return null; } })();
    const cells = hall && Array.isArray(hall.cells) ? hall.cells.map((c) => String(c).toLowerCase()) : [];
    if (cells.length && !cells.includes(String(get(ref, 'worldOrCellDesc', '') || '').toLowerCase())) return res(false, `That container is not in ${factionName(fid)}'s hall (${hall.name}).`);
    const d = data();
    if (fenceAt(ref)) return res(false, 'That container is a fence already.');
    // Its own contents could never be reached again: an empty one only
    const inv = get(ref, 'inventory', null);
    if (inv && (inv.entries || []).some((e) => Number(e && e.count) > 0)) return res(false, 'Empty that container first: a Fence Chest never opens as a container again.');
    if (homeOf(ref)) return res(false, 'That is a player\'s storage, not a hall\'s chest.');
    const old = d.fences[fid];
    d.fences[fid] = Object.assign({}, old || {}, { chest: hex(ref), by: display(a), at: Date.now() });
    save();
    audit(`FENCE ${who(a)} made ${hex(ref)} the Fence Chest of ${factionName(fid)}${old ? ` (was ${old.chest}; its lots stay)` : ''}`);
    return res(true, `That chest is now the Fence Chest of ${factionName(fid)}. It no longer opens as a container.`);
  };
  const armPermit = (a, name, hoursRaw) => {
    if (!isAdmin(a)) return res(false, 'GMs grant permits.');
    const t = name ? findByName(name) : null;
    if (!t) return res(false, 'Name a thief who is online: /burglary permit <name> [hours], then use the home\'s door or chest.');
    const hours = Math.max(1, Math.min(168, Number(hoursRaw) || C.permitHours));
    S.arm.set(a >>> 0, { kind: 'permit', thief: t >>> 0, name: display(t), hours, until: Date.now() + C.armSeconds * 1000 });
    return res(true, `Now use the door or chest of the home ${display(t)} may break into (within ${C.armSeconds} s).`);
  };
  const permitAt = (a, ref, armed) => {
    if (!isAdmin(a)) return res(false, 'GMs grant permits.');
    const home = homeOf(ref);
    if (!home) return res(false, 'That is no player\'s home. Grant the permit again.');
    data().permits[hex(home.p)] = { thief: armed.thief, name: armed.name, until: Date.now() + armed.hours * HOUR, by: display(a), home: homeLabel(home.rec) };
    save();
    audit(`BURGLARY ${who(a)} permits ${armed.name} to break into ${homeLabel(home.rec)} (${hex(home.p)}) for ${armed.hours} h`);
    if (online(armed.thief)) personal(armed.thief, `A GM has approved your break-in at ${homeLabel(home.rec)} for the next ${armed.hours} hours.`);
    return res(true, `${armed.name} may break into ${homeLabel(home.rec)} for ${armed.hours} hours.`);
  };
  const revokePermit = (a, homeHex) => {
    if (!isAdmin(a)) return res(false, 'GMs grant permits.');
    const k = String(homeHex || '').toLowerCase(); const p = data().permits[k];
    if (!p) return res(false, 'There is no permit for that home.');
    delete data().permits[k]; save();
    audit(`BURGLARY ${who(a)} revoked ${p.name}'s permit for ${p.home || k}`);
    return res(true, `${p.name} may no longer break into ${p.home || k}.`);
  };
  const decideRaid = (a, n, verb, reason) => {
    if (!isAdmin(a)) return res(false, 'GMs decide raids.');
    const d = data();
    const r = d.raids.find((x) => x.n === Number(n));
    if (!r) return res(false, 'No such raid. /fence raids');
    if (verb === 'approve' || verb === 'deny') {
      if (r.state !== 'pending') return res(false, `Raid #${r.n} is ${r.state}.`);
      if (verb === 'deny') {
        if (!reason) return res(false, 'Give a reason: /fence deny <n> <reason>');
        r.state = 'denied'; r.decidedBy = display(a); r.reason = reason; save();
        audit(`FENCE raid #${r.n} denied by ${who(a)}: ${reason}`);
        forum({ kind: 'close', key: raidKey(r), by: a, text: `denied it: ${reason}` });
        if (online(r.by)) personal(r.by, `Your raid request #${r.n} was denied: ${reason}`);
        return res(true, `Raid #${r.n} denied.`);
      }
      const now = Date.now();
      Object.assign(r, { state: 'approved', decidedBy: display(a), approvedAt: now, raidAt: now + C.noticeHours * HOUR, told: [] });
      const f = d.fences[r.fid]; if (f) f.frozen = r.n;
      save();
      audit(`FENCE raid #${r.n} on ${factionName(r.fid)} approved by ${who(a)}; the fence is frozen, the raid from ${new Date(r.raidAt).toISOString()}`);
      forum({ kind: 'reply', key: raidKey(r), by: a, text: `approved it. The fence is frozen; the raid may be ruled from ${new Date(r.raidAt).toISOString().slice(0, 16)}Z.` });
      if (online(r.by)) personal(r.by, `Your raid on the fence of ${factionName(r.fid)} is approved. The thieves are warned; the raid is on from ${new Date(r.raidAt).toUTCString().slice(5, 22)} UTC.`);
      tellRaid();
      return res(true, `Raid #${r.n} approved; the fence is frozen.`);
    }
    if (verb !== 'won' && verb !== 'lost') return res(false, 'Approve, deny, won or lost.');
    if (r.state !== 'approved') return res(false, `Raid #${r.n} is ${r.state}.`);
    if (Date.now() < Number(r.raidAt) && !isLeadStaff(a)) return res(false, `The thieves have until ${new Date(r.raidAt).toISOString().slice(0, 16)}Z.`);
    r.state = verb; r.ruledBy = display(a); r.ruledAt = Date.now();
    let k = 0;
    if (verb === 'won') {
      for (const l of lotsOf(r.fid)) {
        l.state = 'recovered';
        const st = d.stolen.find((x) => x.n === l.stolen); if (st) st.state = 'recovered';
        returnToOwner(l, 'The guard recovered it from a fence'); k++;
      }
    }
    unfreeze(r); saveMove();
    audit(`FENCE raid #${r.n} on ${factionName(r.fid)} ruled ${verb} by ${who(a)}${verb === 'won' ? `: ${k} lot(s) go back to their owners` : ''}`);
    forum({ kind: 'close', key: raidKey(r), by: a, text: verb === 'won' ? `ruled the raid won by the guard: ${k} lot(s) go back to their owners.` : 'ruled the raid lost by the guard: the fence is free again.' });
    for (const o of onlineActors()) if (memberOf(o, r.fid) || o === (r.by >>> 0)) personal(o, verb === 'won' ? `The guard raided the fence of ${factionName(r.fid)} and recovered what it held.` : `The raid on the fence of ${factionName(r.fid)} failed; the fence is free again.`);
    deliverReturns();
    return res(true, `Raid #${r.n} ruled ${verb}.`);
  };
  // Out of a thief's pack into the owner's returns: true when it moved (what was not there stays on the ledger as lost)
  const takeOff = (t, s, why) => {
    const d = data();
    const inv = get(t, 'inventory', { entries: [] });
    const out = takeKind(inv.entries, kindKey(s.entry), Number(s.entry.count));
    if (!out.taken) return false;
    try { mp.set(t, 'inventory', { entries: out.left }); } catch (e) { log('thievery: a seizure failed', e.message); return false; }
    const rest = Number(s.entry.count) - Number(out.taken.count);
    if (rest > 0) d.stolen.push(Object.assign({}, s, { n: d.nextStolen++, entry: Object.assign({}, s.entry, { count: rest }), state: 'lost' }));
    s.entry = out.taken; s.state = 'recovered';
    returnToOwner(s, why);
    return true;
  };
  const seize = (a, t) => {
    if (!lawful(a) && !isAdmin(a)) return res(false, 'Only the guard searches for stolen goods.');
    if (!isAdmin(a) && (distanceMeters(a, t) > C.seizeMeters || !(restrained(t) || downed(t) || jailed(t)))) return res(false, 'Search only someone bound, downed or jailed, within reach.');
    let n = 0;
    for (const s of carriedBy(t)) if (takeOff(t, s, 'The guard recovered it from the thief')) n++;
    saveMove();
    audit(`BURGLARY ${who(a)} seized ${n} stolen lot(s) from ${who(t)}`);
    personal(t, `The guard takes back what you stole (${n}).`);
    deliverReturns();
    return res(true, `${n} stolen lot(s) taken; they go back to their owners.`);
  };
  // One ledger entry back to its owner: off the fence, or out of the thief's pack while they are online
  const sendBack = (a, n) => {
    if (!isAdmin(a)) return res(false, 'GMs send stolen goods back.');
    const d = data();
    const s = d.stolen.find((x) => x.n === Number(n));
    if (!s) return res(false, 'No such entry in the stolen ledger.');
    if (s.state === 'fenced') {
      const l = d.lots.find((x) => x.n === s.lot && x.state === 'held');
      if (!l) return res(false, `Entry #${s.n} is not on the fence any more.`);
      const f = d.fences[l.fid];
      if (f && f.frozen) return res(false, 'That fence is frozen for a raid: rule the raid instead.');
      l.state = 'recovered'; s.state = 'recovered';
      returnToOwner(l, 'Staff recovered it from a fence');
    } else if (s.state === 'carried') {
      const t = Number(s.thief) >>> 0;
      if (!online(t)) return res(false, `${s.thiefName} is offline; send it back while they are in the game.`);
      if (!takeOff(t, s, 'Staff recovered it from the thief')) return res(false, `${s.thiefName} no longer carries it.`);
      personal(t, `Staff take back ${countText(s.entry)}, stolen from ${s.homeName}.`);
    } else return res(false, `Entry #${s.n} is ${s.state}.`);
    saveMove();
    audit(`BURGLARY ${who(a)} sent stolen #${s.n} (${countText(s.entry)} [${hex(s.entry.baseId)}]) back to ${s.ownerName || s.owner}`);
    deliverReturns();
    return res(true, `${countText(s.entry)} goes back to ${s.ownerName || 'its owner'}.`);
  };
  const say = (a, lines) => (Array.isArray(lines) ? lines : [lines]).forEach((l) => personal(a, l));
  const tell = (a, r) => personal(a, r.text);

  registerChatCommand('burglary', (a, args) => {
    const [sub, ...rest] = String(args || '').trim().split(/\s+/);
    const arg = rest.join(' ').trim();
    const s = String(sub || '').toLowerCase();
    if (s === 'approve' || s === 'revoke') return tell(a, setFaction(a, arg, s === 'approve'));
    if (s === 'factions') {
      if (!isAdmin(a)) return personal(a, 'For staff.');
      return say(a, [`Thievery is ${C.enabled ? 'on' : 'off'}. Thief factions: ${[...approvedFactions()].map(factionName).join(', ') || 'none'}.`,
        ...Object.entries(data().fences).map(([fid, f]) => `Fence of ${factionName(fid)}: chest ${f.chest}${f.frozen ? `, frozen by raid #${f.frozen}` : ''}, ${lotsOf(fid).length} lot(s)`)]);
    }
    if (s === 'permit') { const m = /^(.*?)(?:\s+(\d+))?$/.exec(arg); return tell(a, armPermit(a, m && m[1], m && m[2])); }
    if (s === 'unpermit') return tell(a, revokePermit(a, arg));
    if (s === 'log') {
      if (!isAdmin(a)) return personal(a, 'For staff.');
      const rows = data().stolen.slice(-15).map((x) => `#${x.n} ${new Date(x.at).toISOString().slice(5, 16)} ${x.thiefName} took ${countText(x.entry)} from ${x.homeName} (${x.ownerName}): ${x.state}`);
      return say(a, rows.length ? rows : ['Nothing has been stolen.']);
    }
    const f = thiefFaction(a);
    if (!C.enabled) return personal(a, 'Burglary is not open yet.');
    if (!f) return personal(a, 'Burglary is for members of a thief faction the staff have approved.');
    const left = quotaLeft(takesOf(a), Date.now(), C);
    say(a, [`You steal for ${factionName(f)}. Crouch and use a locked door of a player's home, or one of its chests, to break in: ${C.forceSeconds} s at the lock, seen by anyone near, then the lock itself.`,
      `You may carry off ${left} more kind${left === 1 ? '' : 's'} of thing in this ${C.takeWindowHours}-hour window (a stack is one). Fence it at your faction's Fence Chest: it turns to gold after ${C.fenceDays} days.`]);
    return undefined;
  }, { help: 'how burglary works for you; staff: approve|revoke <faction> | factions | permit <name> [hours] | unpermit <home> | log' });

  registerChatCommand('fence', (a, args) => {
    const [sub, nRaw, ...rest] = String(args || '').trim().split(/\s+/);
    const s = String(sub || '').toLowerCase();
    const d = data();
    if (s === 'mark') return tell(a, armFence(a, String(nRaw || '')));
    if (s === 'unmark') return tell(a, unmarkFence(a, String(nRaw || '')));
    if (s === 'report') {
      if (!lawful(a) && !isAdmin(a)) return personal(a, 'Only the guard asks leave to raid a fence.');
      const fid = String(nRaw || ''); const evidence = rest.join(' ').trim().slice(0, C.maxEvidence);
      if (!d.fences[fid]) return personal(a, 'That faction has no fence to raid. Usage: /fence report <faction id> <your evidence>');
      if (evidence.length < 20) return personal(a, 'Say what your evidence is (at least a sentence): what was taken, who saw what, where.');
      if (openRaid(fid)) return personal(a, 'A raid on that fence is already before the GMs.');
      const r = { n: d.nextRaid++, fid, by: a >>> 0, byName: display(a), evidence, at: Date.now(), state: 'pending' };
      d.raids.push(r); save();
      audit(`FENCE raid #${r.n} asked by ${who(a)} on ${factionName(fid)}: ${evidence}`);
      forum({ kind: 'open', key: raidKey(r), title: `Fence raid #${r.n}: ${factionName(fid)}`, by: a,
        text: `**Guard raid on the fence of ${factionName(fid)}**\nEvidence: ${evidence}\nDecide in game (F7, Thievery tab): /fence approve ${r.n}, or /fence deny ${r.n} <reason>. Approval freezes the Fence Chest at once and warns the faction; the raid can be ruled ${C.noticeHours} hours later with /fence won ${r.n} or /fence lost ${r.n}.` });
      for (const o of onlineActors()) if (isAdmin(o)) staffSay(o, `Fence raid #${r.n} asked by ${display(a)} on ${factionName(fid)}. F7 Thievery, or /fence raids`);
      return personal(a, `Your request (#${r.n}) is with the GMs.`);
    }
    if (s === 'raids') {
      if (!isAdmin(a)) return personal(a, 'For staff.');
      const rows = d.raids.filter((r) => r.state === 'pending' || r.state === 'approved' || nRaw === 'all').slice(-10).map(raidLine);
      return say(a, rows.length ? rows : ['No raids are open.']);
    }
    if (['approve', 'deny', 'won', 'lost'].includes(s)) return tell(a, decideRaid(a, nRaw, s, rest.join(' ').trim()));
    return personal(a, 'Usage: /fence report <faction id> <evidence> (guards); staff: raids [all] | approve <n> | deny <n> <reason> | won <n> | lost <n> | mark|unmark <faction id>');
  }, { help: 'guards: report <faction> <evidence>; staff: raids, approve/deny/won/lost <n>, mark <faction>' });

  // ---- guards: stolen goods on a captured thief -------------------------------------------------------------------------
  registerChatCommand('stolen', (a, args) => {
    const raw = String(args || '').trim();
    const ret = /^return\s+#?(\d+)$/i.exec(raw);
    if (ret) return tell(a, sendBack(a, ret[1]));
    if (!lawful(a) && !isAdmin(a)) return personal(a, 'Only the guard searches for stolen goods.');
    const isSeize = /^seize\s+/i.test(raw);
    const t = findByName(raw.replace(/^seize\s+/i, ''));
    if (!t) return personal(a, 'Usage: /stolen <name> to search, /stolen seize <name> to take it back; staff: /stolen return <n>.');
    if (!isAdmin(a) && (distanceMeters(a, t) > C.seizeMeters || !(restrained(t) || downed(t) || jailed(t)))) return personal(a, 'Search only someone bound, downed or jailed, within reach.');
    const found = carriedBy(t);
    if (!isSeize) return say(a, found.length ? [`${display(t)} carries stolen goods:`, ...found.map((s) => `${countText(s.entry)}, from ${s.homeName}`)] : [`${display(t)} carries nothing known to be stolen.`]);
    return tell(a, seize(a, t));
  }, { help: '<name> | seize <name>: stolen goods on a bound, downed or jailed thief (guards); return <n>: staff' });

  // ---- the F7 Thievery tab ------------------------------------------------------------------------------------------
  // The tab asks with dbo:staffThievery watch|unwatch|approve|revoke|mark|unmark|raid|permit|unpermit|sendback ...; while it is
  // open the state comes as a staffData widget each time it changes. GMs and above see it; the buttons run the actions above,
  // which check the tier themselves.
  const FACTION_FILES = ['guild-defs.json', 'player-factions.json'];
  const knownFactions = () => {
    const out = new Map();
    for (const f of FACTION_FILES) {
      try { for (const x of (JSON.parse(fs.readFileSync(path.resolve(f), 'utf8')).factions || [])) if (x && x.id && !out.has(String(x.id))) out.set(String(x.id), String(x.name || x.id)); } catch (e) { /* not there */ }
    }
    for (const id of approvedFactions()) if (!out.has(id)) out.set(id, factionName(id));
    return [...out].map(([id, name]) => ({ id, name }));
  };
  const STOLEN_SHOWN = 300;
  const view = (a) => {
    const d = data(); const now = Date.now();
    const approved = approvedFactions(); const fromConfig = new Set((C.factions || []).map(String));
    const fenceRow = (fid) => { const f = d.fences[fid]; return f ? { chest: f.chest, by: f.by || '', at: Number(f.at) || 0, frozen: Number(f.frozen) || 0, lots: lotsOf(fid).length } : null; };
    return {
      enabled: !!C.enabled, lead: !!isLeadStaff(a), gm: !!isAdmin(a),
      armed: (() => { const x = S.arm.get(a >>> 0); return x && now < x.until ? { kind: x.kind, fid: x.fid || '', name: x.name || '', until: x.until } : null; })(),
      factions: [...approved].map((id) => ({ id, name: factionName(id), config: fromConfig.has(id), fence: fenceRow(id) })),
      candidates: knownFactions().filter((f) => !approved.has(f.id)),
      raids: d.raids.filter((r) => r.state === 'pending' || r.state === 'approved').concat(d.raids.filter((r) => r.state !== 'pending' && r.state !== 'approved').slice(-8).reverse())
        .map((r) => ({ n: r.n, fid: r.fid, faction: factionName(r.fid), state: r.state, by: r.byName, evidence: r.evidence, at: r.at, raidAt: Number(r.raidAt) || 0, decidedBy: r.decidedBy || r.ruledBy || '', reason: r.reason || '' })),
      stolen: d.stolen.slice(-STOLEN_SHOWN).reverse().map((s) => ({ n: s.n, at: s.at, item: countText(s.entry), owner: s.ownerName || String(s.owner), thief: s.thiefName, home: s.homeName, state: s.state,
        canSendBack: s.state === 'fenced' || (s.state === 'carried' && online(s.thief)) })),
      stolenTotal: d.stolen.length,
      permits: Object.entries(d.permits).filter(([, p]) => now < Number(p.until)).map(([home, p]) => ({ home, homeName: p.home || home, thief: p.name, until: p.until, by: p.by || '' })),
      breaches: Object.values(d.breaches).filter((b) => now < Number(b.until)).map((b) => ({ thief: b.name, faction: factionName(b.faction || ''), until: b.until, at: b.at })),
      working: [...S.channels.values()].map((ch) => ({ thief: display(ch.a), home: homeLabel(ch.rec), kind: ch.kind, until: ch.until })),
      result: (S.panelResult && S.panelResult.get(a >>> 0)) || null,
    };
  };
  const pushTo = (a, force) => {
    const v = view(a);
    const key = JSON.stringify(v);
    if (!force && S.watch.get(a >>> 0) === key) return;
    S.watch.set(a >>> 0, key);
    openWidget(a, Object.assign({ type: 'staffData', id: THIEVERY_DATA_WIDGET_ID, kind: 'thievery', now: Date.now() }, v), false);
  };
  pushWatchers = () => {
    if (!S.watch.size) return;
    const on = new Set(onlineActors().map((x) => x >>> 0));
    for (const k of [...S.watch.keys()]) { if (!on.has(k) || !isAdmin(k)) { S.watch.delete(k); continue; } pushTo(k, false); }
  };
  const shown = (a, r) => { S.panelResult.set(a >>> 0, Object.assign({ at: Date.now() }, r)); if (S.watch.has(a >>> 0)) pushTo(a, false); return r; };
  armedDone = (a, r) => { personal(a, r.text); shown(a, r); };
  const panelOp = (a, op, x, y, z) => {
    if (!isAdmin(a)) return null;
    const arg = String(x == null ? '' : x).trim();
    if (op === 'watch') { S.watch.set(a >>> 0, ''); return pushTo(a, true); }
    if (op === 'unwatch') { S.watch.delete(a >>> 0); S.panelResult.delete(a >>> 0); return closeWidget(a, THIEVERY_DATA_WIDGET_ID); }
    let r = null;
    if (op === 'approve' || op === 'revoke') r = setFaction(a, arg, op === 'approve');
    else if (op === 'mark') r = armFence(a, arg);
    else if (op === 'unmark') r = unmarkFence(a, arg);
    else if (op === 'raid') r = decideRaid(a, arg, String(y || ''), String(z || '').trim().slice(0, 300));
    else if (op === 'permit') r = armPermit(a, arg, y);
    else if (op === 'unpermit') r = revokePermit(a, arg);
    else if (op === 'sendback') r = sendBack(a, arg);
    else if (op === 'cancel') { S.arm.delete(a >>> 0); r = res(true, 'Nothing is armed.'); }
    if (!r) return null;
    try { if (typeof staffNote === 'function' && r.ok) staffNote(a, 'F7 Thievery', `${op} ${arg} ${y || ''}: ${r.text}`); } catch (e) { /* the note is optional */ }
    return shown(a, r);
  };
  onUi('staffThievery', (a, args) => panelOp(a, String((args || [])[0] || ''), (args || [])[1], (args || [])[2], (args || [])[3]));
  globalThis.__dboThieveryView = (a) => (isAdmin(a) ? view(a) : null);
  globalThis.__dboThieveryAct = panelOp;

  log(`thievery ${C.enabled ? 'on' : 'off'}: ${approvedFactions().size} thief faction(s), ${Object.keys(data().fences).length} fence(s), ${data().lots.filter((l) => l.state === 'held').length} lot(s) held, ${S.channels.size} break-in(s) under way`);
  return { data, homeOf, hasAccess, steal, mature, deliverReturns };
};

factory.pure = { kindKey, quotaLeft, pickable, takeKind, addEntry, parseXtel, lotGold, DEFAULTS };
module.exports = factory;
