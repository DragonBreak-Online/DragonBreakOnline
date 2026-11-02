// DragonBreak Online: pinning an NPC's host, the zero-C++ first experiment for server-driven NPC movement
// (_work\server-npc-movement-1102.md, Option B phase 1). Loaded by gamemode.js, config "serverHostPin".
//
// WHAT THIS IS FOR. Option B wants the server to drive non-combat NPC movement itself. Before any C++ is
// written, one question decides the shape of the work: if nobody is allowed to take an NPC, does it stay
// where it was put? There are five separate mechanisms that can move a host, and only two of them can be
// reached from here:
//
//   1. the client claims any actor not marked isHostedByOther, on sight, with no clock (formView.ts ~485);
//   2. the client re-asks after rehostAfterMs of silence, every 2 s (formView.ts ~497);
//   3. the server grants any asker when the last movement is over 2 s old (ActionListener::OnHostAttempt);
//   4. TickStaleHosts frees a silent NPC after 5 s (W5's stale-host-exempt-1102 adds an exemption);
//   5. npcdirector.js hands managed NPCs to the nearest reporting player on its 1 s pass.
//
// This module can refuse (3) through the gamemode's onHostAttempt chain and take the NPC out of (5) by
// tagging it. It CANNOT reach (1), (2) or (4), which live in client TypeScript and server C++. So the
// expected result is not "the NPC stays put for ever" - it is a measurement of WHICH mechanism wins first,
// and how fast. That is the finding the C++ work needs, and it costs a gameplay deploy rather than a DLL.
//
// Config: "serverHostPin": { mode: "off" | "observe" | "pin", zone: "guard:bruma:8", logEveryMs: 10000 }
//   off      the default. Nothing is tagged, nothing is refused, no logging. Deployable with no effect.
//   observe  tag the NPC and log every host change, refusing nothing. Establishes the baseline: how often
//            does an ordinary NPC change hands, and to whom.
//   pin      as observe, plus refuse every host attempt for it and keep it out of the director.
// `npc: <form id>` still works for a hand-placed actor, but prefer the zone - see below.
//
// WHY A ZONE AND NOT AN ID. A spawned actor's id is dynamic (0xff...) and reassigned every run, and the
// 08:00/20:00 shift change swaps guard:bruma:8's NPC outright, so any id written into config is wrong within
// the day. npcSpawnSystem.ts:710 sets private.npcSpawner to the ZONE NAME on every actor it spawns, which
// survives a restart, a respawn and the shift change. So the zone is the identity.
//
// THE COST OF THAT CHOICE, stated rather than hidden: there is no zone -> id map reachable from here.
// zone.spawned is in-memory in the TS system and zone-spawns.json is a flat id list with no zone names. So
// this module cannot enumerate its NPCs; it LEARNS their ids from the callbacks it is given. The director
// considers every NPC in a player's sight report once a second, so an id is learnt within about a second of
// any player seeing the guard - and an NPC nobody can see is not a measurement anyway.
//
// Nothing here moves an NPC. Movement is the C++ step, and this module exists to tell us what that step has
// to defend against.
// Loaded the way npcdirector.js is - a destructured bag, so `every` and `log` come from gamemode.js rather
// than being reinvented here, and the harness can pass stand-ins for all of them.
module.exports = ({ mp, log, every, cfg, state } = {}) => {
  const C = Object.assign({ mode: 'off', zone: '', npc: 0, logEveryMs: 10000 }, (cfg && cfg.serverHostPin) || {});
  const S = state || {};
  const say = typeof log === 'function' ? log : () => {};
  if (!S.seen) S.seen = new Map(); // npc id -> last hoster we logged
  if (!S.ids) S.ids = new Set();   // ids learnt to be in the watched zone, in sight order
  if (!S.refused) S.refused = 0;
  if (!S.changes) S.changes = 0;

  const npc = Number(C.npc) >>> 0;
  const zone = String(C.zone || '');
  const on = (C.mode === 'observe' || C.mode === 'pin') && (!!zone || !!npc);
  const pinning = C.mode === 'pin';
  // npcSpawnSystem's own tag, read-only here: the zone name it spawned this actor for
  const SPAWNER = 'private.npcSpawner';

  // The tag is a change-form property, like ff_companionOf and private.dboCompanion, so it survives a hot
  // reload, is visible to the director and the host hook alike, and can be read from C++ later. A dynamic id
  // is reassigned every run (memory: dynamic ids are reassigned), so the tag is the identity, not the id.
  const TAG = 'private.dboServerHost';

  const tagged = (id) => {
    try { return mp.get(id, TAG) === true; } catch (e) { return false; }
  };

  const tag = (id, value) => {
    try { mp.set(id, TAG, value === true ? true : undefined); return true; }
    catch (e) { return false; }
  };

  const hosterOf = (id) => {
    try { return typeof mp.getHoster === 'function' ? mp.getHoster(id) >>> 0 : 0; }
    catch (e) { return 0; }
  };

  const spawnerOf = (id) => {
    try { const v = mp.get(id, SPAWNER); return typeof v === 'string' ? v : ''; }
    catch (e) { return ''; }
  };

  // Is this the actor we are watching? The zone decides; the id is an override for a hand-placed actor. An id
  // that matches is remembered and tagged here, which is the only way this module ever learns one.
  const isTarget = (id) => {
    const f = id >>> 0;
    if (!on || !f) return false;
    const mine = (zone && spawnerOf(f) === zone) || (npc && f === npc);
    if (!mine) return false;
    if (!S.ids.has(f)) { S.ids.add(f); say(`serverHostPin: watching ${f.toString(16)} (${zone || 'id ' + npc.toString(16)})`); }
    // ONLY pin tags. This cost Nat an evening on 2 Nov: the tag means "measure this one" to this module and
    // "the server drives this, refuse everybody" to the C++ sentinel (PartOne::IsServerDriven), which refuses
    // every host attempt, skips the stale sweep and tells clients isHostedByOther. Observe used to tag too, so
    // on a server carrying the sentinel it stranded the guard - refused to every client, asked for by none, and
    // driven by nothing, because the mover does not exist. It spun on the spot with no owner.
    // Observe exists to watch WITHOUT changing anything, and tagging is the most consequential change there is.
    if (pinning && !tagged(f)) tag(f, true);
    return true;
  };

  // The state the stranding was: tagged, so no client may host it, and nothing driving it. Only pin may create
  // it, and only because a mover is meant to follow. Anyone adding a mode must answer this question for it.
  const stranded = (id) => tagged(id >>> 0) && !pinning;

  // Refuse every attempt on the watched NPC. Returns true to refuse, matching __dboNpcDirectorRefuses' sense,
  // so gamemode.js's chain reads the same way for both.
  const refuses = (requester, id) => pinning && isTarget(id);

  // PIN only, for the same reason the tag is pin only. The director's managed() must step aside for an NPC the
  // server drives, or its 1 s pass hands it to the nearest player and beats the refusal (W5, 2 Nov). But in
  // observe that would be a second way for "just watching" to change what the server does - and the baseline
  // we want from observe IS the ordinary behaviour, the director included. A mode that alters the thing it is
  // measuring is not a baseline.
  //
  // isTarget is still called from here in every mode, and that is deliberate: the director considers every
  // NPC in a sight report once a second, so this is how the module learns an id without enumerating anything.
  const directorSkips = (id) => {
    const t = isTarget(id);
    return pinning && t;
  };

  // Kept for the harness and for an id given in config: there is nothing to enumerate, so this only touches
  // what we already know about.
  const apply = () => {
    if (!on) return { tagged: false };
    if (npc) isTarget(npc);
    // pin only, the same rule as isTarget. This line was the second half of the 2 Nov stranding and the new
    // test above caught it after isTarget alone had been fixed: one place that tags is not the same as no
    // place that tags, and a timed pass runs every second whether anyone is looking or not.
    if (pinning) for (const id of S.ids) if (!tagged(id)) tag(id, true);
    const first = S.ids.values().next();
    return { tagged: !first.done && tagged(first.value), hoster: first.done ? 0 : hosterOf(first.value), ids: S.ids.size };
  };

  // One host change on one learnt NPC, and a summary. The point of the experiment is the sequence of changes
  // and their timing, so each change is logged with the gap since the last one FOR THAT NPC - a per-npc gap,
  // not a global one, or a zone with two guards would report each one's gap as the time since the other moved.
  const pollOne = (id, now) => {
    const f = id >>> 0;
    const h = hosterOf(f);
    const prev = S.seen.has(f) ? S.seen.get(f) : null;
    if (prev === null) { S.seen.set(f, h); S.at = S.at || {}; S.at[f] = now; return { first: true, npc: f, hoster: h }; }
    if (h !== prev) {
      S.at = S.at || {};
      const gap = S.at[f] ? now - S.at[f] : 0;
      S.seen.set(f, h);
      S.at[f] = now;
      S.changes++;
      return { changed: true, npc: f, from: prev, to: h, afterMs: gap, changes: S.changes, refused: S.refused };
    }
    return null;
  };

  // Every learnt NPC, one pass. Returns the first event there is, so a caller that logs one line per tick
  // still sees them: at one guard per zone there is never more than one.
  const poll = (now) => {
    if (!on) return null;
    for (const id of S.ids) { const ev = pollOne(id, now); if (ev) return ev; }
    return null;
  };

  const noteRefusal = () => { S.refused++; };

  // The globals gamemode.js and npcdirector.js consult, named and shaped like the director's
  // __dboNpcDirectorRefuses so the chain in hostAttemptHook reads the same for both. Set even when off, as
  // functions that answer false, so neither caller has to care whether this module loaded.
  globalThis.__dboServerHostRefuses = (requester, id) => {
    const no = refuses(requester, id);
    if (no) noteRefusal();
    return no;
  };
  globalThis.__dboServerHostSkips = (id) => directorSkips(id);

  // Its own passes, like the director's. Nothing here moves an NPC: it tags, watches and logs.
  //
  // REGISTERED IN EVERY MODE, off included, and the body returns early instead. This was the third hole in the
  // 2 Nov stranding and W5 found it live: gamemode.js's every() calls stopTimer(name) first, so re-registering
  // replaces the previous generation's timer - but `if (on && ...)` meant that in mode off we never called
  // every() at all, so we never stopped anything either. The timers from the load BEFORE the reload kept
  // firing, with their old closure and their old mode, and kept re-tagging through apply(). Heartbeats still
  // said "observe" after the config said "off". W5 had to stop them by name on the live box.
  //
  // A pass that costs nothing is worse than a pass that does nothing, when its absence leaves the previous
  // generation's pass running. Two timers doing a boolean check cost less than one orphan tagging NPCs.
  if (typeof every === 'function') {
    every('serverHostPin', 1000, () => {
      if (!on) return;
      const now = Date.now();
      apply();
      const ev = poll(now);
      if (ev && ev.changed) {
        say(`serverHostPin: ${ev.npc.toString(16)} host ${ev.from.toString(16)} -> ${ev.to.toString(16)} after ${ev.afterMs} ms (change ${ev.changes}, ${ev.refused} refused)`);
      } else if (ev && ev.first) {
        say(`serverHostPin: ${ev.npc.toString(16)} in mode ${C.mode}, host ${ev.hoster.toString(16)}`);
      }
    });
    every('serverHostPinSummary', C.logEveryMs, () => {
      if (!on) return;
      const s = { mode: C.mode, zone: zone || undefined, npc: npc ? npc.toString(16) : undefined, watching: S.ids.size, changes: S.changes, refused: S.refused };
      say(`serverHostPin: ${JSON.stringify(s)}`);
      // The watchdog for the 2 Nov stranding. In pin the NPC is refused to every client, so if nothing is
      // driving it, it stands with no owner and only a player notices. guardmover.js stamps
      // __dboGuardMoverBeat on every packet it sends, so a stale or missing beat while pinning is the bad
      // state, and it says so in the log rather than waiting to be seen in game.
      if (!pinning || !S.ids.size) return;
      const beat = Number(globalThis.__dboGuardMoverBeat) || 0;
      const age = beat ? Date.now() - beat : Infinity;
      if (age > 5000) {
        say(`serverHostPin: WARNING ${S.ids.size} NPC(s) pinned in ${zone || 'id ' + npc.toString(16)} and ` +
          `nothing has driven them for ${beat ? age + ' ms' : 'ever'}: no client may host them, so they are ` +
          'standing with no owner. Start guardmover, or set mode to observe and clearTag them.');
      }
    });
  }

  return {
    mode: C.mode,
    zone,
    npc,
    TAG,
    SPAWNER,
    tagged,
    tag,
    isTarget,
    stranded,
    clearTag: (id) => tag(id, false),
    refuses,
    directorSkips,
    apply,
    poll,
    pollOne,
    noteRefusal,
    watching: () => Array.from(S.ids),
    stats: () => ({ mode: C.mode, zone, npc, watching: S.ids.size, changes: S.changes, refused: S.refused }),
  };
};
