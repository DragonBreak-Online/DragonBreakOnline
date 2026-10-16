// DragonBreak Online: the door sync. Loaded by gamemode.js.
//
// "Bruma is revolving dooring people and keeping them in the interiors" (16 Oct, after the 01:51Z Skyrim restart). A
// character that logs in inside an interior (Castle Bruma's Great Hall 6c40f, the inns b5936 and 6ff7d) and walks out
// through its load door crosses on its own game only: the server never receives the door's activation (no doortrace line
// for any of them), so it keeps the character in the room. Every movement packet from the street is then refused for its
// cell and answered with a snap back (MovementValidation), which pulls the game back inside: the revolving door. A game
// that ignores the snap back (Lord Lewin Ashcroft #QD7X, 02:40:53 to 03:19 with a GM summon) walks on while the server holds
// it at the door and refuses every cast, hit and touch ("WorldSpace doesn't match: caster is in CYRBrumaCastleGreatHall").
// From 01:51 to 03:25, 7 of 11 first exits after a login inside were of this kind and ended with /unstuck, a GM summon or a
// relog; before the restart 169 of 180 went through the door. Characters that walk in through a door are not affected.
//
// The client's heartbeat (npcDrift kind heartbeat, every 30 s) says where its body is ("fr.at": "c<cell>" or
// "w<world>"). When that is not where the server holds the character, the server's position is next to a load door of the
// server's cell, and that door leads to the place the game reports, the door is activated on the server for the character:
// the activation the game never sent. It runs the whole activate chain (locks, jail, region, housing, doortrace), so a door
// the character may not use is still refused, and the engine's own door teleport sends them where the door leads.
//
// Not when the server put the character in this cell within settleSeconds (a door, summon or teleport the game has not
// landed from yet: its report still names the place it came from), nor within cooldownSeconds of the last assist, nor for a
// character in creation, dead, bound or carried. Config "doorSync": { enabled, radius, settleSeconds, cooldownSeconds }.
// enabled:false is the undo (on a reload).
'use strict';

module.exports = (api) => {
  const { mp, log } = api;
  const display = typeof api.display === 'function' ? api.display : (a) => (a >>> 0).toString(16);
  const skip = typeof api.skip === 'function' ? api.skip : () => false;
  const later = typeof api.setTimeout === 'function' ? api.setTimeout : setTimeout;
  const now = typeof api.now === 'function' ? api.now : () => Date.now();
  const C = Object.assign({ enabled: true, radius: 350, settleSeconds: 20, cooldownSeconds: 20 }, ((api.cfg || {}).doorSync) || {});

  // actorId -> { cell, since, assistAt }; kept across reloads
  const S = globalThis.__dboDoorSyncState instanceof Map ? globalThis.__dboDoorSyncState : (globalThis.__dboDoorSyncState = new Map());

  // Load doors by the cell they stand in (lower case), from doors-pos.json (tools/door-positions.py): no engine call
  const byCell = new Map();
  for (const [desc, p] of Object.entries((api.doors && api.doors.doors) || {})) {
    if (!Array.isArray(p) || p.length < 4 || !p.slice(0, 3).every(Number.isFinite) || typeof p[3] !== 'string') continue;
    const k = p[3].toLowerCase();
    if (!byCell.has(k)) byCell.set(k, []);
    byCell.get(k).push({ desc, pos: p.slice(0, 3) });
  }

  const idOf = (desc) => { try { return mp.getIdFromDesc(String(desc)) >>> 0; } catch (e) { return 0; } };
  // A door's teleport partner from its own record's XTEL, as playerlog-taps.js doorPartner reads it
  const partnerOf = (id) => {
    try {
      const r = mp.lookupEspmRecordById(id);
      for (const f of ((r && r.record && r.record.fields) || [])) {
        if (f.type !== 'XTEL' || !(f.data instanceof Uint8Array) || f.data.byteLength < 4) continue;
        const local = new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(0, true);
        return local && typeof r.toGlobalRecordId === 'function' ? r.toGlobalRecordId(local) >>> 0 : local >>> 0;
      }
    } catch (e) { /* not a placed record */ }
    return 0;
  };
  // "c806c40f" / "w80a764b" -> the cell or world id the client's body is in, else 0
  const reportedPlace = (r) => {
    const at = r && r.fr && typeof r.fr.at === 'string' ? r.fr.at : '';
    const m = /^[cw]([0-9a-fA-F]{1,8})$/.exec(at);
    return m ? parseInt(m[1], 16) >>> 0 : 0;
  };

  // The load door of the server's cell next to `pos` that leads to `target`, or null
  const doorTo = (cellDesc, pos, target) => {
    const R = Number(C.radius) || 350;
    let best = null;
    for (const d of byCell.get(String(cellDesc).toLowerCase()) || []) {
      const dist = Math.hypot(d.pos[0] - pos[0], d.pos[1] - pos[1], d.pos[2] - pos[2]);
      if (dist > R || (best && dist >= best.dist)) continue;
      const id = idOf(d.desc);
      const far = id ? partnerOf(id) : 0;
      if (!far) continue;
      let farCell = 0;
      try { farCell = idOf(mp.get(far, 'worldOrCellDesc')); } catch (e) { farCell = 0; }
      if (farCell && farCell === target) best = { id, desc: d.desc, dist, far };
    }
    return best;
  };

  const heartbeat = (a, r) => {
    a >>>= 0;
    if (C.enabled === false || !r || r.kind !== 'heartbeat') return null;
    const reported = reportedPlace(r);
    if (!reported) return null;
    let cellDesc = '', pos = null;
    try { cellDesc = String(mp.get(a, 'worldOrCellDesc') || ''); pos = mp.get(a, 'pos'); } catch (e) { return null; }
    if (!cellDesc || !Array.isArray(pos)) return null;
    const t = now();
    let s = S.get(a);
    if (!s || s.cell !== cellDesc) { s = { cell: cellDesc, since: t, assistAt: s ? s.assistAt : 0 }; S.set(a, s); }
    if (S.size > 2000) for (const [k, v] of S) if (t - v.since > 6 * 3600000) S.delete(k);
    const held = idOf(cellDesc);
    if (!held || held === reported) return null;
    // The server moved them here just now; the game's report may still name where it came from
    if (t - s.since < (Number(C.settleSeconds) || 0) * 1000) return null;
    if (t - (s.assistAt || 0) < (Number(C.cooldownSeconds) || 0) * 1000) return null;
    try { if (mp.get(a, 'isDead') === true) return null; } catch (e) { return null; }
    try { if (mp.get(a, 'private.restrained')) return null; } catch (e) { /* free */ }   // bound or carried: the capture system moves them
    if (skip(a)) return null;
    const door = doorTo(cellDesc, pos, reported);
    if (!door) return null;
    s.assistAt = t;
    log(`door sync: ${display(a)} is held in ${cellDesc} ${pos.map((v) => Math.round(Number(v))).join(',')} while the game reports ` +
      `${(r.fr.at || '').slice(0, 12)}; activating ${door.desc} (${Math.round(door.dist)} u away) for them`);
    // Outside the packet handler, as idles.js chestHold does; the activate chain runs, then the engine's door teleport
    later(() => {
      try {
        mp.callPapyrusFunction('method', 'ObjectReference', 'Activate', { type: 'form', desc: mp.getDescFromId(door.id) },
          [{ type: 'form', desc: mp.getDescFromId(a) }, false]);
      } catch (e) { log(`door sync: activating ${door.desc} for ${display(a)} failed: ${e.message}`); }
    }, 0);
    return door.desc;
  };

  return { heartbeat, C, partnerOf, reportedPlace };
};
