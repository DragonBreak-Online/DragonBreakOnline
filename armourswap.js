// DragonBreak Online: changing armour in a fight takes time (suggestions forum, "Clothing Usage / Weight"; Nat, 2026-09-24:
// only in combat). Loaded by gamemode.js.
//
// The engine takes an equipment change before the gamemode hears of it (a blocked onUpdateEquipmentAttempt only logs a
// warning), so a swap cannot be refused. It is paid for instead: a character who puts on or takes off armour or clothing
// within combatSeconds of a blow dealt or taken is slowed and lands no blows while the straps are done. Each piece adds its
// time (heavy, light, clothing and jewellery), so stripping a full heavy set to run down a fleeing civilian costs half a
// minute at a walk. Weapons, spells and shields are free to change, as in any fight.
//
// gamemode.js calls onEquip from its equipment hook, onHit from its hit hook for every landed blow, and busy(a) to refuse
// the blows of someone still dressing. Server-made changes (the login re-dress, beast forms, jail) are left alone.

module.exports = (api) => {
  const { mp, log, personal, sendPacket, display, profileOf, armorPieceOf, recordOf, fieldsOf, cfg, openWidget, closeWidget } = api;
  // Its own widget id, not actiondelays.js's 170: one slot per bar, so a search and a swap cannot overwrite each other
  const BAR_ID = 171;
  const C = Object.assign({ enabled: true, combatSeconds: 20, heavySeconds: 5, lightSeconds: 3, clothingSeconds: 2, maxSeconds: 30, speedMult: -50, blockAttacks: true },
    cfg.armourSwap || {});
  // actorId -> { worn: Set of armour ids, combatAt, busyUntil, toldAt, beastAt }
  const S = globalThis.__dboArmourSwap || (globalThis.__dboArmourSwap = new Map());
  const st = (a) => { let s = S.get(a); if (!s) { s = { worn: null, combatAt: 0, busyUntil: 0, toldAt: 0, beastAt: 0 }; S.set(a, s); } return s; };

  // Seconds for one piece, or 0 for what is free to change (not armour, or a shield: slot 39 is bit 9 of BOD2's slot mask)
  const kindCache = new Map();
  const secondsFor = (baseId) => {
    if (kindCache.has(baseId)) return kindCache.get(baseId);
    let s = 0;
    try {
      const piece = armorPieceOf(baseId);
      const r = recordOf(baseId);
      const bod2 = r && String(r.record.type) === 'ARMO' ? fieldsOf(r, 'BOD2')[0] : null;
      if (bod2 && bod2.data.byteLength >= 8) {
        const dv = new DataView(bod2.data.buffer, bod2.data.byteOffset, bod2.data.byteLength);
        const slots = dv.getUint32(0, true), type = dv.getUint32(4, true);
        if (!(slots & (1 << 9))) s = type === 1 ? C.heavySeconds : type === 0 ? C.lightSeconds : C.clothingSeconds;
      } else if (piece) s = piece.heavy ? C.heavySeconds : C.lightSeconds;
    } catch (e) { s = 0; }
    s = Math.max(0, Number(s) || 0);
    kindCache.set(baseId, s);
    return s;
  };

  const inCombat = (a, now) => now - st(a).combatAt < C.combatSeconds * 1000;

  // The bar that shows the straps being done (skymp5-front features/progressBar). The packet above already carries the
  // seconds and the slow; this is only the picture, and the server stays the judge of busyUntil.
  const showBar = (a, s, left) => {
    if (C.bar === false || typeof openWidget !== 'function' || !(left > 0)) return;
    try {
      openWidget(a, { type: 'progress', id: BAR_ID, title: 'Armour', ms: left * 1000, startedAt: Date.now(), kind: 'armour' }, true);
    } catch (e) { return; }
    if (s.barTimer) { try { clearTimeout(s.barTimer); } catch (e) { /* gone */ } }
    s.barTimer = setTimeout(() => {
      s.barTimer = null;
      if (Date.now() < s.busyUntil) return;
      try { if (typeof closeWidget === 'function') closeWidget(a, BAR_ID); } catch (e) { /* offline */ }
    }, left * 1000 + 250);
  };

  // Every landed blow marks both sides that are players
  const onHit = (agg, tgt) => {
    const now = Date.now();
    if (profileOf(agg) >= 0) st(agg).combatAt = now;
    if (profileOf(tgt) >= 0) st(tgt).combatAt = now;
  };

  // worn: [{ baseId }] from the report; serverMade: the gamemode's own dressing (login, beast forms)
  const onEquip = (a, worn, serverMade) => {
    const s = st(a);
    const now = Date.now();
    const next = new Set(worn.map((w) => Number(w.baseId) >>> 0).filter((id) => secondsFor(id) > 0));
    const prev = s.worn;
    s.worn = next;
    let beast = null; try { beast = mp.get(a, 'private.beast'); } catch (e) { /* not an actor */ }
    if (beast && beast.form) s.beastAt = now;
    if (!C.enabled || !prev || serverMade || now - s.beastAt < 15000 || !inCombat(a, now)) return 0;
    try { if (mp.get(a, 'isDead')) return 0; } catch (e) { return 0; }
    let seconds = 0;
    for (const id of next) if (!prev.has(id)) seconds += secondsFor(id);
    for (const id of prev) if (!next.has(id)) seconds += secondsFor(id);
    if (!seconds) return 0;
    // The time adds up: a ring put on halfway through cannot cut short the heavy cuirass before it
    const from = Math.max(now, s.busyUntil);
    s.busyUntil = Math.min(now + C.maxSeconds * 1000, from + seconds * 1000);
    const left = Math.ceil((s.busyUntil - now) / 1000);
    sendPacket(a, { customPacketType: 'dboStatus', kind: 'armour', seconds: left, speedMult: Math.max(-90, Math.min(0, Number(C.speedMult) || 0)),
      text: `Changing armour in a fight: ${left} seconds of buckles and straps.` });
    showBar(a, s, left);
    log(`armour swap in combat: ${display(a)} busy ${left} s`);
    return left;
  };

  // True while a character is still dressing: their blows are refused
  const busy = (a) => {
    if (!C.enabled || !C.blockAttacks) return false;
    const s = S.get(a); const now = Date.now();
    if (!s || s.busyUntil <= now) return false;
    if (now - s.toldAt > 3000) { s.toldAt = now; personal(a, `You are still fastening your armour (${Math.ceil((s.busyUntil - now) / 1000)} s).`); }
    return true;
  };

  const forget = (a) => S.delete(a);

  return { onEquip, onHit, busy, forget, secondsFor };
};
