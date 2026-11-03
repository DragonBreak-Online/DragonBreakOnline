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
    autoOpen: true,        // the server opens it when the bar fills; false goes back to a second click
    reopenGuardMs: 800,    // after an auto-open, the player's own click is swallowed for this long
                           // (a SkyMP container takes a second, closing activation)
    exemptOwnHome: true,
    // Nat, 3 Nov: the beat belongs to dungeons and to theft, not to every container. false goes
    // back to delaying every container that is not the player's own home.
    onlyDungeonsAndTheft: true,
    widget: true,
    tellSeconds: 8,        // at most one "you are searching" line this often per player
  }, cfg.actionDelays || {});
  const WIDGET_ID = 170;
  const MS = (n) => Math.max(0, Number(n) || 0) * 1000;

  // Reload-safe: the beats in flight outlive a hot reload, so a player mid-search is not sent back to the start
  const S = globalThis.__dboActionDelayState || (globalThis.__dboActionDelayState = {
    beat: new Map(), done: new Map(), nextTake: new Map(), told: new Map(), shown: new Map(),
    opened: new Map(), timers: new Map(),
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
  // The cell key, normalised exactly as gamemode.js does before testing __dboDungeonCells and as
  // dungeons.js's normDesc builds that Set. Copied rather than rewritten: a key shaped differently
  // would never match, and the beat would vanish in dungeons with nothing to show it had.
  const cellKeyOf = (ref) => {
    try {
      const d = String(mp.get(ref, 'worldOrCellDesc') || '');
      const i = d.indexOf(':');
      if (i < 0) return d.toLowerCase();
      const n = parseInt(d.slice(0, i), 16);
      return (Number.isFinite(n) ? n.toString(16) : d.slice(0, i).toLowerCase()) + ':' + d.slice(i + 1).toLowerCase();
    } catch (e) { return ''; }
  };
  const inDungeon = (ref) => {
    const set = globalThis.__dboDungeonCells;
    return !!set && typeof set.has === 'function' && set.has(cellKeyOf(ref));
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
      openWidget(a, { type: 'progress', id: WIDGET_ID, title: label, ms, startedAt: Date.now(), kind: 'search' }, false);
      S.shown.set(a, Date.now());
    } catch (e) { /* the bar is a courtesy, never a gate */ }
  };
  const hide = (a) => {
    if (!S.shown.has(a) || typeof closeWidget !== 'function') return;
    S.shown.delete(a);
    try { closeWidget(a, WIDGET_ID); } catch (e) { /* gone */ }
  };
  // Rate limited per kind, not per player: one bucket meant a body line swallowed the next container line, and
  // until the bar ships the line is the only sign a chest was refused rather than broken.
  const tell = (a, kind, text) => {
    const now = Date.now();
    const key = `${a}:${kind}`;
    if (now - (S.told.get(key) || 0) < MS(C.tellSeconds)) return;
    S.told.set(key, now);
    try { personal(a, text); } catch (e) { /* offline */ }
  };
  const resync = (a) => {
    try { if (typeof globalThis.__dboItemResync === 'function') globalThis.__dboItemResync(a); } catch (e) { log('action delays: resync failed', e.message); }
  };

  // Opens the container as if the player had activated it again. Activate is registered server-side and
  // runs MpObjectReference::Activate, not an SpSnippet, so this is the real activation and the container
  // opens through SendOpenContainer. It re-enters our own chain, which is why done is set first.
  const openFor = (a, t) => {
    try {
      mp.callPapyrusFunction('method', 'ObjectReference', 'Activate', { type: 'form', desc: mp.getDescFromId(t) },
        [{ type: 'form', desc: mp.getDescFromId(a) }, false]);
      return true;
    } catch (e) {
      // out of range, dead, gone: CheckInteractionAbility throws and the player can still click again
      log(`action delays: opening ${mp.getDescFromId(t)} for ${mp.getDescFromId(a)} failed: ${e.message}`);
      return false;
    }
  };
  // Fired when the bar fills. Everything is re-checked, because the player has had searchSeconds to move,
  // log out, or open something else.
  const finishSearch = (a, t, key, startedAt) => {
    S.timers.delete(key);
    if (S.beat.get(key) !== startedAt) return;        // a newer beat, or it was already finished by a click
    const now = Date.now();
    S.beat.delete(key);
    S.done.set(key, now);
    S.nextTake.set(a, now + MS(C.takeSeconds));
    hide(a);
    const searched = () => { try { personal(a, 'You have searched it. Open it again.'); } catch (e) { /* offline */ } };
    if (C.autoOpen === false) { searched(); return; }
    const opened = openFor(a, t);
    log(`actiondelays: search done, profile ${profileOf(a)} on ${t.toString(16)}: elapsed ${now - startedAt}ms, auto-open ${opened ? 'ok' : 'FAILED'}`);
    if (!opened) { searched(); return; }
    S.opened.set(key, now);
  };

  // Does the beat apply at all? A container in a dungeon, or one the player has no right to. Their
  // own, a shared or faction one, and a public or unowned chest outside a dungeon all open at once.
  //
  // A vanilla NPC-owned chest is NOT caught here. The ownership this module can see is our own
  // housing claims (private.housing); the engine's XOWN on a vanilla ref is not on anything it
  // reads. So stealing from an NPC's chest outside a dungeon stays instant, which is a known gap
  // rather than an oversight.
  const delayApplies = (t, a) => {
    if (C.onlyDungeonsAndTheft === false) return 'all';
    if (inDungeon(t)) return 'dungeon';
    const rec = claimOf(t);
    if (rec && !ownHome(t, a)) return 'theft';
    return '';
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
    const why = delayApplies(t, a);
    if (!why) return undefined;
    const now = Date.now();
    const key = `${a}:${t}`;
    // The server has just opened this for them: swallow their own click, or the container's second
    // activation would close the window they waited for
    if (now - (S.opened.get(key) || 0) < Math.max(0, Number(C.reopenGuardMs) || 0)) return false;
    if (now - (S.done.get(key) || 0) < MS(C.graceSeconds)) return undefined;
    const started = S.beat.get(key) || 0;
    // A beat older than its own time plus the grace is stale (the player wandered off and came back)
    if (!started || now - started > ms + MS(C.graceSeconds)) {
      S.beat.set(key, now);
      sweep();
      log(`actiondelays: search begins, profile ${profileOf(a)} on ${t.toString(16)}, ${why}, bar ${ms}ms`);
      show(a, ms, 'Searching');
      tell(a, 'search', C.autoOpen === false
        ? 'You search it. Give it a moment, then open it again.'
        : 'You search it. It opens in a moment.');
      const prev = S.timers.get(key);
      if (prev) { try { clearTimeout(prev); } catch (e) { /* gone */ } }
      S.timers.set(key, setTimeout(() => {
        try { finishSearch(a, t, key, now); } catch (e) { log('action delays: finishing the search failed', e.message); }
      }, ms + 50));
      return false;
    }
    if (now - started < ms) return false;
    const pending = S.timers.get(key);
    if (pending) { try { clearTimeout(pending); } catch (e) { /* gone */ } S.timers.delete(key); }
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
          tell(a, 'body', 'You are still searching. Wait a moment.');
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
      tell(a, 'gap', 'Your hands are full for a moment.');
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
  return { _test: { delayApplies, inDungeon, searchGate, takeGate, S, C, ownHome, recordType } };
};
