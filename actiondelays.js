// DragonBreak Online: searching takes a moment (Nat, 2026-11-02: "we need a delay for unequipping, equipping, taking
// items out of containers etc."; the plan is _work\action-delays-1102.md). Loaded by gamemode.js.
//
// Two beats, both the server's:
//   the search   opening someone else's container is refused for searchSeconds, then it opens. The player is told and a
//                bar runs. Activating again when the bar is full opens it, as a locked container does on a retry.
//                Within graceSeconds of a finished search the same container opens at once, so closing and reopening a
//                chest you are already standing in is free.
//   the take     a body has no activation to gate (the client blocks activating actors, and a body's items only reach
//                the server once searchSystem.ts has made the searcher its inventory occupant), so a body pays its beat
//                on its FIRST take instead: bodySeconds. Every take after that, from anything, is takeSeconds apart.
//
// Why the server and not the client: the engine moves an item before anything of ours hears about it, and no event in
// the SkyrimPlatform typings is cancellable, so a client-side bar is decoration a modified client ignores. A take is
// refusable though: PutItem/TakeItem only fire their event, and GameModeEvent::Fire runs OnFireSuccess only when no
// listener refused, so a false answer means the item never moves server-side. Equipment is NOT refusable (the attempt
// event fires after the change is applied), which is why armour is still paid for in armourswap.js and is not here.
//
// A refused take has already happened on the client, so it must be resynced or the player keeps seeing an item the
// server does not have. itemguards.js owns that: globalThis.__dboItemResync.
//
// Exempt: your own home and anywhere you hold a key (private.housing owner/keys), because a delay on your own chests is
// friction with nothing to stop. The bank needs no exemption: bank.js keeps gold as a balance and never as a container
// in the world.
//
// gamemode.js calls __dboActionDelaySearch from its activate chain and __dboActionDelayTake from its takeHook.
// Config "actionDelays"; enabled false takes the whole thing out.

module.exports = (api) => {
  const { mp, log, personal, cfg, profileOf, openWidget, closeWidget } = api;
  const C = Object.assign({
    enabled: true,
    searchSeconds: 2,      // opening someone else's container
    bodySeconds: 3,        // the first take from a body, which has no activation to gate
    takeSeconds: 0.4,      // between takes
    graceSeconds: 30,      // a searched container reopens freely for this long
    exemptOwnHome: true,
    widget: true,
    tellSeconds: 8,        // at most one "you are searching" line this often per player
  }, cfg.actionDelays || {});
  const WIDGET_ID = 170;
  const MS = (n) => Math.max(0, Number(n) || 0) * 1000;

  // Reload-safe: the beats in flight outlive a hot reload, so a player mid-search is not sent back to the start
  const S = globalThis.__dboActionDelayState || (globalThis.__dboActionDelayState = {
    beat: new Map(), done: new Map(), nextTake: new Map(), told: new Map(), shown: new Map(),
  });
  const sweep = () => {
    const now = Date.now(), keep = MS(C.graceSeconds) + 600000;
    for (const m of [S.beat, S.done, S.told, S.shown]) {
      if (m.size < 4000) continue;
      for (const [k, at] of m) if (now - at > keep) m.delete(k);
      if (m.size > 20000) m.clear();
    }
    if (S.nextTake.size > 20000) S.nextTake.clear();
  };

  const isPlayer = (a) => { try { return profileOf(a) >= 0; } catch (e) { return false; } };
  const recordType = (ref) => {
    try {
      const desc = String(mp.get(ref, 'baseDesc') || '');
      const r = desc && mp.lookupEspmRecordById(mp.getIdFromDesc(desc));
      return r && r.record ? String(r.record.type) : '';
    } catch (e) { return ''; }
  };
  // private.housing as gamemode.js's lockedClaim reads it: on the ref, or on the primary it points to
  const claimOf = (ref) => {
    try {
      const raw = mp.get(ref, 'private.housing');
      if (!raw || typeof raw !== 'object') return null;
      const primary = Number(raw.primary) ? Number(raw.primary) >>> 0 : ref;
      const rec = primary === ref ? raw : mp.get(primary, 'private.housing');
      return rec && typeof rec === 'object' && !Number(rec.primary) ? rec : null;
    } catch (e) { return null; }
  };
  const ownHome = (ref, a) => {
    if (!C.exemptOwnHome) return false;
    const rec = claimOf(ref);
    if (!rec) return false;
    const p = profileOf(a);
    if (!(p >= 0)) return false;
    if (Number(rec.owner) === p) return true;
    const keys = rec.keys;
    if (Array.isArray(keys) && keys.some((k) => Number(k) === p || Number((k || {}).profile) === p)) return true;
    return false;
  };

  const show = (a, ms, label) => {
    if (!C.widget || typeof openWidget !== 'function' || ms <= 0) return;
    try {
      openWidget(a, { type: 'progress', id: WIDGET_ID, title: label, ms, startedAt: Date.now(), kind: 'search' }, true);
      S.shown.set(a, Date.now());
    } catch (e) { /* the bar is a courtesy, never a gate */ }
  };
  const hide = (a) => {
    if (!S.shown.has(a) || typeof closeWidget !== 'function') return;
    S.shown.delete(a);
    try { closeWidget(a, WIDGET_ID); } catch (e) { /* gone */ }
  };
  const tell = (a, text) => {
    const now = Date.now();
    if (now - (S.told.get(a) || 0) < MS(C.tellSeconds)) return;
    S.told.set(a, now);
    try { personal(a, text); } catch (e) { /* offline */ }
  };
  const resync = (a) => {
    try { if (typeof globalThis.__dboItemResync === 'function') globalThis.__dboItemResync(a); } catch (e) { log('action delays: resync failed', e.message); }
  };

  // ---- the search beat on a container's activation --------------------------------------------------------------------
  // undefined: no opinion, the activation stands. false: refused, the container does not open.
  const searchGate = (targetId, casterId) => {
    if (!C.enabled) return undefined;
    const t = Number(targetId) >>> 0, a = Number(casterId) >>> 0;
    const ms = MS(C.searchSeconds);
    if (ms <= 0 || !isPlayer(a)) return undefined;
    if (recordType(t) !== 'CONT') return undefined;
    if (ownHome(t, a)) return undefined;
    const now = Date.now();
    const key = `${a}:${t}`;
    if (now - (S.done.get(key) || 0) < MS(C.graceSeconds)) return undefined;
    const started = S.beat.get(key) || 0;
    // A beat older than its own time plus the grace is stale (the player wandered off and came back)
    if (!started || now - started > ms + MS(C.graceSeconds)) {
      S.beat.set(key, now);
      sweep();
      show(a, ms, 'Searching');
      tell(a, 'You search it. Give it a moment, then open it again.');
      return false;
    }
    if (now - started < ms) return false;
    S.beat.delete(key);
    S.done.set(key, now);
    // the search paid for the first take; the next one still waits takeSeconds
    S.nextTake.set(a, now + MS(C.takeSeconds));
    hide(a);
    return undefined;
  };

  // ---- the take beat -------------------------------------------------------------------------------------------------
  // false refuses the take: the item never moves server-side. Anything else lets it through.
  const takeGate = (sourceId, actorId) => {
    if (!C.enabled) return undefined;
    const src = Number(sourceId) >>> 0, a = Number(actorId) >>> 0;
    if (!isPlayer(a)) return undefined;
    if (ownHome(src, a)) return undefined;
    const now = Date.now();
    const key = `${a}:${src}`;
    // A source this player has not searched pays the body beat on its first take. A container has already paid it on
    // its activation (searchGate wrote S.done), so only bodies and anything that opens without an activation land here.
    const first = !(now - (S.done.get(key) || 0) < MS(C.graceSeconds));
    if (first) {
      const ms = MS(C.bodySeconds);
      const started = S.beat.get(key) || 0;
      if (ms > 0) {
        if (!started || now - started > ms + MS(C.graceSeconds)) {
          S.beat.set(key, now);
          sweep();
          show(a, ms, 'Searching');
          tell(a, 'You are still searching. Wait a moment.');
          resync(a);
          return false;
        }
        if (now - started < ms) { resync(a); return false; }
      }
      S.beat.delete(key);
      S.done.set(key, now);
      hide(a);
      S.nextTake.set(a, now + MS(C.takeSeconds));
      return undefined;
    }
    const next = S.nextTake.get(a) || 0;
    if (now < next) {
      tell(a, 'Your hands are full for a moment.');
      resync(a);
      return false;
    }
    S.nextTake.set(a, now + MS(C.takeSeconds));
    return undefined;
  };

  globalThis.__dboActionDelaySearch = (targetId, casterId) => {
    try { return searchGate(targetId, casterId); } catch (e) { log('action delays: search gate failed', e.stack || e.message); return undefined; }
  };
  globalThis.__dboActionDelayTake = (sourceId, actorId) => {
    try { return takeGate(sourceId, actorId); } catch (e) { log('action delays: take gate failed', e.stack || e.message); return undefined; }
  };

  log(`actiondelays: ${C.enabled ? 'on' : 'off'} (search ${C.searchSeconds}s, body ${C.bodySeconds}s, take ${C.takeSeconds}s, grace ${C.graceSeconds}s)`);
  return { _test: { searchGate, takeGate, S, C, ownHome, recordType } };
};
