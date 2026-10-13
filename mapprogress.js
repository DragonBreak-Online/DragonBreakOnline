// DragonBreak Online: the map locations a character has discovered, kept by the server (Nate, 12 Oct: "make sure map
// data in game with locations you discovered stays synced, because when you log out it doesn't save always or resets").
// The client kept them only in a file on the player's own PC (CharacterProgressService, character-progress-no-load),
// under the server's address and port: a new address, a repaired or reinstalled game or another PC started from nothing,
// and a discovery in the last seconds before a logout or crash could be lost. Loaded by gamemode.js.
//
//   Client -> Server: { customPacketType: "dboMapSync", markers: ["<hex>:<plugin>", ...], want?: true }
//     markers newly discovered (or, once a session, every marker the PC's own file holds, so nobody loses theirs);
//     want asks for the whole list back.
//   Server -> Client: { customPacketType: "dboMapMarkers", markers: [...] }  the character's whole list
//
// A marker is "<hex local id>:<plugin file>" as the client names it. Kept: well-formed and,
// when the server can read the reference, a REFR placed from the MapMarker STAT (Skyrim.esm 0x10); a reference the server
// cannot read (a light plugin's) is kept on its form. At most maxMarkers a character, at most perPacket a packet.
// State on the character: private.mapMarkers [desc...]. Config "mapProgress": { enabled, maxMarkers, perPacket }.
'use strict';

module.exports = (api) => {
  const { mp, log, sendPacket, cfg } = api;
  const C = Object.assign({ enabled: true, maxMarkers: 3000, perPacket: 500 }, (cfg && cfg.mapProgress) || {});
  const PROP = 'private.mapMarkers';
  const MAP_MARKER_STAT = 0x10;
  const DESC = /^[0-9a-f]{1,6}:[^:/\\]{1,120}\.(esm|esp|esl)$/i;
  const checked = globalThis.__dboMapMarkerChecked instanceof Map ? globalThis.__dboMapMarkerChecked : (globalThis.__dboMapMarkerChecked = new Map());

  const listOf = (a) => { try { const v = mp.get(a >>> 0, PROP); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch (e) { return []; } };
  const u32 = (f) => (f && f.data && f.data.byteLength >= 4 ? new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(0, true) : 0);
  // true: keep, false: refuse
  const markerOk = (desc) => {
    const key = desc.toLowerCase();
    if (checked.has(key)) return checked.get(key);
    let ok = DESC.test(desc);
    if (ok) {
      let id = 0;
      try { id = mp.getIdFromDesc(desc) >>> 0; } catch (e) { id = 0; }
      let res = null;
      try { res = id ? mp.lookupEspmRecordById(id) : null; } catch (e) { res = null; }
      if (res && res.record) {
        const name = (res.record.fields || []).find((f) => f && f.type === 'NAME');
        let base = 0; try { base = name ? res.toGlobalRecordId(u32(name)) >>> 0 : 0; } catch (e) { base = 0; }
        ok = String(res.record.type) === 'REFR' && base === MAP_MARKER_STAT;
      }
    }
    if (checked.size > 20000) checked.clear();
    checked.set(key, ok);
    return ok;
  };

  // Adds what is new; the number added
  const add = (a, markers) => {
    const have = listOf(a);
    const seen = new Set(have.map((d) => d.toLowerCase()));
    const max = Math.max(0, Number(C.maxMarkers) || 3000);
    let added = 0;
    const fresh = [];
    for (const raw of (Array.isArray(markers) ? markers.slice(0, Math.max(1, Number(C.perPacket) || 500)) : [])) {
      if (have.length >= max) break;
      const d = String(raw || '').trim();
      if (!d || seen.has(d.toLowerCase()) || !markerOk(d)) continue;
      seen.add(d.toLowerCase()); have.push(d); added++; fresh.push(d);
    }
    if (added) { try { mp.set(a >>> 0, PROP, have); } catch (e) { log('mapprogress: save failed', e.message); return 0; } }
    // the player log (playerlog.js): the places discovered (the markers, checked above)
    if (added) { try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('map', a >>> 0, fresh); } catch (e) { /* the player log is optional */ } }
    return added;
  };

  globalThis.__dboMapSync = (a, content) => {
    if (C.enabled === false || !a) return;
    const added = add(a, content && content.markers);
    if (content && content.want === true) {
      try { sendPacket(a >>> 0, { customPacketType: 'dboMapMarkers', markers: listOf(a) }); } catch (e) { /* offline */ }
    }
    return added;
  };
  globalThis.__dboMapMarkersOf = listOf;
  log(`mapprogress ${C.enabled === false ? 'off' : 'on'}: discovered map markers kept per character (max ${C.maxMarkers})`);
};
