// DragonBreak Online: editing what the plugins placed (Nate, 16 Oct: "a tool so we can edit already placed stuff in the
// world that the placer didn't place"). Loaded by placement.js, which hands it the F7 Place tab's select tool, list and
// Undo, so it has no panel or packets of its own for staff.
//
// What the server can do with a plugin reference (an id below 0xff000000) decides what an edit can be:
//   - It holds a form only for the kinds it syncs: furniture, activators, doors, containers, loose items, harvestable
//     flora and trees (WorldState::AttachEspmRecord). Statics, movable statics, lights that cannot be carried and the
//     rest have no form at all: mp.get throws "Form doesn't exist" on them. Plugin actors (ACHR) are the NPC spawner's
//     business and never edited here.
//   - Papyrus Disable/Enable on such a form keeps isDisabled in its change form (it survives a restart) and runs the
//     same call on every client that has the reference in view (PapyrusObjectReference::Disable, an SpSnippet).
//   - A client that streams the reference in later is NOT told: the server sends the flag as props.isDisabled and
//     client 0.3.101 reads props.disabled (remoteServer.ts, the skipFormViewCreation branch), so it enables the
//     reference again. Until the client reads the right key, the hide is sent again every resendMs to whoever is near.
//   - The server never sends a plugin reference's position (remoteServer.ts applies no transform below 0xff000000), so a
//     move, and anything about a static, needs the client's WorldEditService (0.3.102). config placement.worldEdit.client
//     switches those on once that client is the one offered.
//
// world-edits.json, beside the world state like placements.json: { edits: { refHex: entry }, log: [ ... ] }
//   entry: { ref, base, name, type, where, orig: { pos, rot }, hidden, moved: { pos, rot } | null, serverForm, by, at }
//   log:   { at, by, who, ref, name, action }   action: hide | show | move | unmove | undo   (the newest LOG_MAX kept)
// Rotations are degrees, as the Place tab uses them. A reference back as the plugin has it has no entry.
//
//   Client -> Server (players too): dbo worldEditsRequest []                   the list a 0.3.102 client applies
//   Server -> Client:               { customPacketType: "worldEdits", edits: [{ ref, hide, pos?, rot? }] }   (client: true only)
'use strict';
const fs = require('fs');
const path = require('path');

// Base record types never edited: a hidden or moved load door can shut players in or out
const REFUSED_BASE = { DOOR: 'Doors are left alone: a hidden load door can shut players in.' };
const LOG_MAX = 2000;
const deg = (rad) => Math.round(((rad * 180) / Math.PI) * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;

module.exports = (api) => {
  const { mp, log, audit, who, personal, sendPacket, can, needs, profile, papyrus, sameWhere } = api;
  const W = Object.assign({ client: false, resendMs: 4000, resendRange: 12288, maxReach: 4096, resendMax: 300 }, api.cfg || {});
  const FILE = path.join(api.stateDir, 'world-edits.json');
  const S = globalThis.__dboWorldEdit || (globalThis.__dboWorldEdit = { data: null, asked: new Map() });
  const hex = (id) => (Number(id) >>> 0).toString(16);

  const data = () => {
    if (S.data) return S.data;
    try { S.data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { S.data = null; }
    if (!S.data || typeof S.data !== 'object') S.data = {};
    if (!S.data.edits || typeof S.data.edits !== 'object') S.data.edits = {};
    if (!Array.isArray(S.data.log)) S.data.log = [];
    // keyed by load-order id: an entry whose desc (local id and plugin) now resolves to another id follows it
    for (const [k, e] of Object.entries(S.data.edits)) {
      if (!e || !e.desc) continue;
      let id = 0;
      try { id = mp.getIdFromDesc(String(e.desc)) >>> 0; } catch (err) { id = 0; }
      if (id && hex(id) !== k && !S.data.edits[hex(id)]) { delete S.data.edits[k]; e.ref = hex(id); S.data.edits[e.ref] = e; log(`worldedit: ${e.name} re-keyed ${k} -> ${e.ref} (load order)`); }
    }
    return S.data;
  };
  const save = () => {
    try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(data(), null, 1)); fs.renameSync(FILE + '.tmp', FILE); }
    catch (e) { log('worldedit: saving world-edits.json failed', e.message); }
  };
  const note = (a, ref, name, action) => {
    const l = data().log;
    l.push({ at: new Date().toISOString(), by: profile(a), who: who(a), ref, name, action });
    if (l.length > LOG_MAX) l.splice(0, l.length - LOG_MAX);
  };

  // A world key in the Place tab's list: 'w' and the reference id ('w' is not a hex digit, as placement's 'n' keys)
  const isKey = (s) => /^w[0-9a-f]+$/.test(String(s || '').toLowerCase());
  const refOfKey = (s) => String(s || '').toLowerCase().replace(/^w/, '');
  const isPluginRef = (s) => { const t = String(s || '').toLowerCase(); if (!/^[0-9a-f]{1,8}$/.test(t)) return false; const n = parseInt(t, 16) >>> 0; return n > 0 && n < 0xff000000; };

  // What the plugins and the server know about a reference: { ok, ref, base, name, type, serverForm, where, pos, rot }
  const inspect = (refHex) => {
    const id = parseInt(refHex, 16) >>> 0;
    if (!id || id >= 0xff000000) return { ok: false, text: 'That is not something a plugin placed.' };
    let rec = null;
    try { rec = mp.lookupEspmRecordById(id); } catch (e) { rec = null; }
    const r = rec && rec.record;
    if (!r) return { ok: false, text: `No plugin has a reference ${hex(id)}.` };
    if (r.type === 'ACHR') return { ok: false, text: 'NPCs from the plugins are spawned by the server; edit their spawn zone instead.' };
    if (r.type !== 'REFR') return { ok: false, text: `${hex(id)} is a ${r.type} record, not a placed object.` };
    const field = (t) => (r.fields || []).find((f) => f.type === t);
    const bytes = (f) => (f && f.data ? Buffer.from(f.data.buffer ? new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength) : f.data) : null);
    const nameF = bytes(field('NAME'));
    let baseId = 0;
    if (nameF && nameF.length >= 4) {
      const local = nameF.readUInt32LE(0);
      try { baseId = typeof rec.toGlobalRecordId === 'function' ? rec.toGlobalRecordId(local) >>> 0 : local; } catch (e) { baseId = local; }
    }
    let baseType = '', editorId = '';
    try { const b = baseId ? mp.lookupEspmRecordById(baseId) : null; if (b && b.record) { baseType = String(b.record.type); editorId = String(b.record.editorId || ''); } } catch (e) { /* unknown base */ }
    if (REFUSED_BASE[baseType]) return { ok: false, text: REFUSED_BASE[baseType] };
    const dataF = bytes(field('DATA'));
    let pos = null, rot = [0, 0, 0];
    if (dataF && dataF.length >= 24) {
      pos = [0, 4, 8].map((o) => round1(dataF.readFloatLE(o)));
      rot = [12, 16, 20].map((o) => deg(dataF.readFloatLE(o)));
    }
    // A form exists only for what the server syncs; mp.get throws on the rest
    let serverForm = false, where = '', type = '';
    try { type = String(mp.get(id, 'type') || ''); serverForm = true; } catch (e) { serverForm = false; }
    if (type === 'MpActor') return { ok: false, text: 'Actors are not edited this way.' };
    if (serverForm) {
      try { where = String(mp.get(id, 'worldOrCellDesc') || ''); } catch (e) { /* unknown */ }
      try { const p = mp.get(id, 'pos'); if (Array.isArray(p)) pos = p.map(round1); } catch (e) { /* the plugin's */ }
    }
    let base = '';
    try { base = baseId ? String(mp.getDescFromId(baseId)) : ''; } catch (e) { base = ''; }
    return { ok: true, ref: hex(id), id, base, name: editorId || base || hex(id), type: baseType, serverForm, where, pos, rot };
  };

  // The GM must stand in the reference's cell or world, near it: an id typed or aimed elsewhere is refused
  const nearGm = (a, info) => {
    const where = String(mp.get(a, 'worldOrCellDesc') || '');
    const me = mp.get(a, 'pos');
    if (!where || !Array.isArray(me)) return { ok: false, text: 'Your position is not known yet.' };
    if (info.where && !sameWhere(info.where, where)) return { ok: false, text: `${info.name} is in another cell or world; go to it first.` };
    if (info.pos && Math.hypot(info.pos[0] - me[0], info.pos[1] - me[1], info.pos[2] - me[2]) > W.maxReach) return { ok: false, text: `${info.name} is too far away; go nearer.` };
    if (!info.pos) return { ok: false, text: `${info.name} has no position in its plugin.` };
    return { ok: true, where };
  };
  const mayEdit = (a, entry) => {
    if (!can(a, 'world')) return { ok: false, text: `Editing what the plugins placed is ${needs('world')}.` };
    if (entry && entry.by !== profile(a) && !can(a, 'others')) return { ok: false, text: `Another GM edited that; changing their edits is ${needs('others')}.` };
    return { ok: true };
  };

  const clone = (e) => (e ? JSON.parse(JSON.stringify(e)) : null);
  // Puts the reference into state next (an entry, or null for the plugin's own) on the server and on clients in view
  const apply = (ref, prev, next) => {
    const id = parseInt(ref, 16) >>> 0;
    const any = next || prev;
    if (!any || !any.serverForm) return;
    const wasHidden = !!(prev && prev.hidden), isHidden = !!(next && next.hidden);
    if (wasHidden !== isHidden) papyrus(isHidden ? 'Disable' : 'Enable', id, [false]);
    const pose = (e) => (e && e.moved ? e.moved : any.orig);
    const p0 = pose(prev), p1 = pose(next);
    if (JSON.stringify(p0) !== JSON.stringify(p1) && p1 && p1.pos) {
      papyrus('SetPosition', id, p1.pos.slice(0, 3));
      papyrus('SetAngle', id, (p1.rot || [0, 0, 0]).slice(0, 3));
    }
  };
  // Sets the reference to next (null: back as the plugin has it) and keeps the step for Undo
  const change = (a, ref, next, action, name) => {
    const edits = data().edits;
    const prev = clone(edits[ref] || null);
    const keep = next && (next.hidden || next.moved);
    if (keep) edits[ref] = next; else delete edits[ref];
    apply(ref, prev, keep ? next : null);
    note(a, ref, name, action);
    save();
    broadcast();
    audit(`WORLDEDIT ${who(a)} ${action} ${name}, ref ${ref}`);
    return { op: 'world', ref, before: prev, name };
  };

  const fresh = (a, info) => ({
    ref: info.ref, desc: (() => { try { return String(mp.getDescFromId(info.id)); } catch (e) { return ''; } })(), base: info.base, name: info.name, type: info.type, where: info.where || String(mp.get(a, 'worldOrCellDesc') || ''),
    orig: { pos: info.pos, rot: info.rot }, hidden: false, moved: null, serverForm: info.serverForm, by: profile(a), at: new Date().toISOString(),
  });
  const needsClient = (info) => `${info.name} (${info.type || 'object'}) is not kept by the server, so only the 0.3.102 client can hide or move it.`;

  // The select tool's Enter on a plugin reference: what it is and what can be done with it
  const describe = (a, refHex) => {
    const info = inspect(refHex);
    if (!info.ok) return info;
    const e = data().edits[info.ref];
    const state = e ? (e.hidden ? 'hidden' : 'moved') : 'as its plugin has it';
    if (!info.serverForm && !W.client) return { ok: false, text: needsClient(info) };
    const can2 = mayEdit(a, e);
    if (!can2.ok) return { ok: true, text: `${info.name} (${info.type}, ref ${info.ref}), ${state}. ${can2.text}`, info };
    return { ok: true, text: `${info.name} (${info.type}, ref ${info.ref}), ${state}. Delete hides it; End undoes; the Placed near me list brings it back.`, info };
  };

  const hide = (a, refHex) => {
    const info = inspect(refHex);
    if (!info.ok) return info;
    const e = data().edits[info.ref];
    const ok = mayEdit(a, e); if (!ok.ok) return ok;
    if (!info.serverForm && !W.client) return { ok: false, text: needsClient(info) };
    const near = nearGm(a, info); if (!near.ok) return near;
    if (e && e.hidden) return { ok: false, text: `${info.name} is already hidden.` };
    const next = e ? clone(e) : fresh(a, info);
    next.hidden = true; next.by = profile(a); next.at = new Date().toISOString();
    const step = change(a, info.ref, next, 'hide', info.name);
    return { ok: true, text: `Hid ${info.name} for everyone. End undoes it; the Placed near me list brings it back.`, step };
  };

  // Back as the plugin has it (shown and in its own place): the list's Remove on a world row
  const reset = (a, key) => {
    const ref = refOfKey(key);
    const e = data().edits[ref];
    if (!e) return { ok: false, text: 'That object is already as its plugin has it.' };
    const ok = mayEdit(a, e); if (!ok.ok) return ok;
    const step = change(a, ref, null, e.hidden ? 'show' : 'unmove', e.name);
    return { ok: true, text: `${e.name} is back as its plugin has it.`, step };
  };

  const move = (a, refHex, pos, rot) => {
    if (!W.client) return { ok: false, text: 'Moving what the plugins placed needs the 0.3.102 client.' };
    const info = inspect(refHex);
    if (!info.ok) return info;
    const e = data().edits[info.ref];
    const ok = mayEdit(a, e); if (!ok.ok) return ok;
    const near = nearGm(a, info); if (!near.ok) return near;
    const me = mp.get(a, 'pos');
    if (Math.hypot(pos[0] - me[0], pos[1] - me[1], pos[2] - me[2]) > W.maxReach) return { ok: false, text: 'Too far away to move it there.' };
    const next = e ? clone(e) : fresh(a, info);
    next.moved = { pos: pos.map(round1), rot: rot.map((n) => ((n % 360) + 360) % 360) };
    next.by = profile(a); next.at = new Date().toISOString();
    const step = change(a, info.ref, next, 'move', info.name);
    return { ok: true, text: `Moved ${info.name} for everyone.`, step };
  };

  // Undo of a world step: the reference goes back to the state it had before it
  const undo = (a, step) => {
    const now = data().edits[step.ref] || null;
    const ok = mayEdit(a, now); if (!ok.ok) return ok;
    change(a, step.ref, clone(step.before), 'undo', step.name);
    const b = step.before;
    return { ok: true, text: b ? `${step.name} is ${b.hidden ? 'hidden' : 'moved'} again.` : `${step.name} is back as its plugin has it.` };
  };

  // placeEdit for the select tool's Enter (client: true), so the existing edit mode moves a plugin reference
  const editPacket = (info) => {
    const e = data().edits[info.ref];
    const pose = e && e.moved ? e.moved : { pos: info.pos, rot: info.rot };
    return { customPacketType: 'placeEdit', id: info.ref, base: info.base, name: info.name, kind: 'object', hostile: false, pos: pose.pos, rot: pose.rot || [0, 0, 0] };
  };

  // Rows for the Place tab's "Placed near me" list: no base, so Edit and Place another stay off; Remove resets it
  const rows = (a) => {
    const here = String(mp.get(a, 'worldOrCellDesc') || '');
    const me = mp.get(a, 'pos') || [0, 0, 0];
    return Object.values(data().edits).filter((e) => sameWhere(e.where, here)).map((e) => {
      const p = (e.moved || e.orig || {}).pos || [0, 0, 0];
      const d = Math.hypot(p[0] - me[0], p[1] - me[1], p[2] - me[2]);
      return { d, row: { id: 'w' + e.ref, name: `${e.hidden ? 'Hidden' : 'Moved'}: ${e.name} (Remove puts it back)`, kind: 'object', dist: Math.round(d / 70), by: e.by, at: e.at, pos: p, rot: (e.moved || e.orig || {}).rot || [0, 0, 0], mine: e.by === profile(a), group: '' } };
    });
  };
  const goTo = (a, key) => {
    const e = data().edits[refOfKey(key)];
    if (!e) return { ok: false, text: 'That world edit is not on the list.' };
    const p = (e.moved || e.orig).pos;
    mp.set(a, 'locationalData', { cellOrWorldDesc: e.where, pos: [p[0], p[1] - 140, p[2]], rot: [0, 0, 0] });
    return { ok: true, text: `Moved you next to ${e.name}.` };
  };

  const packet = () => ({ customPacketType: 'worldEdits', edits: Object.values(data().edits).map((e) => {
    const o = { ref: parseInt(e.ref, 16) >>> 0, hide: !!e.hidden };
    if (e.moved) { o.pos = e.moved.pos; o.rot = e.moved.rot; if (e.orig) o.orig = e.orig; }
    return o;
  }) });
  // Only a client with WorldEditService does anything with the list
  const broadcast = () => {
    if (!W.client || typeof api.onlineActors !== 'function') return;
    const p = packet();
    for (const a of api.onlineActors()) { try { sendPacket(a, p); } catch (e) { /* gone */ } }
  };
  const answerRequest = (a) => {
    if (!W.client) return;
    const last = S.asked.get(a) || 0;
    if (Date.now() - last < 5000) return;
    S.asked.set(a, Date.now());
    sendPacket(a, packet());
  };

  // Hidden server forms near a player get the hide again (see the header: a later arrival enables them otherwise), and the
  // server's own flag is put back if something else enabled it
  const resend = () => {
    const hidden = Object.values(data().edits).filter((e) => e.hidden && e.serverForm);
    if (!hidden.length || typeof api.onlineActors !== 'function') return 0;
    const players = [];
    for (const a of api.onlineActors()) {
      try { const w = String(mp.get(a, 'worldOrCellDesc') || ''), p = mp.get(a, 'pos'); if (w && Array.isArray(p)) players.push({ w, p }); } catch (e) { /* gone */ }
    }
    let n = 0;
    for (const e of hidden) {
      if (n >= W.resendMax) break;
      const p = e.orig && e.orig.pos;
      if (!p || !players.some((x) => sameWhere(x.w, e.where) && Math.hypot(x.p[0] - p[0], x.p[1] - p[1]) <= W.resendRange)) continue;
      try { papyrus('Disable', parseInt(e.ref, 16) >>> 0, [false]); n++; } catch (err) { /* the form went away */ }
    }
    return n;
  };
  if (typeof api.every === 'function') {
    if (W.resendMs > 0) api.every('worldEditResend', W.resendMs, resend);
    else api.every('worldEditResend', 3600000, () => {});
  }

  return { isKey, isPluginRef, inspect, describe, hide, reset, move, undo, editPacket, rows, goTo, answerRequest, resend, data, packet, client: !!W.client,
    // decor.js (the home's own pieces): its own checks stand in for the GM's rights
    change, fresh, clone };
};
