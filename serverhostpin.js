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
// Config: "serverHostPin": { mode: "off" | "observe" | "pin", npc: <form id>, logEveryMs: 10000 }
//   off      the default. Nothing is tagged, nothing is refused, no logging. Deployable with no effect.
//   observe  tag the NPC and log every host change, refusing nothing. Establishes the baseline: how often
//            does an ordinary NPC change hands, and to whom.
//   pin      as observe, plus refuse every host attempt for it and keep it out of the director.
//
// Nothing here moves an NPC. Movement is the C++ step, and this module exists to tell us what that step has
// to defend against.
// Loaded the way npcdirector.js is - a destructured bag, so `every` and `log` come from gamemode.js rather
// than being reinvented here, and the harness can pass stand-ins for all of them.
module.exports = ({ mp, log, every, cfg, state } = {}) => {
  const C = Object.assign({ mode: 'off', npc: 0, logEveryMs: 10000 }, (cfg && cfg.serverHostPin) || {});
  const S = state || {};
  const say = typeof log === 'function' ? log : () => {};
  if (!S.seen) S.seen = new Map(); // npc -> last hoster we logged
  if (!S.refused) S.refused = 0;
  if (!S.changes) S.changes = 0;

  const npc = Number(C.npc) >>> 0;
  const on = C.mode === 'observe' || C.mode === 'pin';
  const pinning = C.mode === 'pin';

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

  // Refuse every attempt on a tagged NPC. Returns true to refuse, matching __dboNpcDirectorRefuses' sense,
  // so gamemode.js's chain reads the same way for both.
  const refuses = (requester, id) => pinning && !!id && tagged(id >>> 0);

  // The director's managed() must skip a tagged NPC or its 1 s pass hands it to the nearest player, which
  // would beat any refusal here (W5, 2 Nov).
  const directorSkips = (id) => on && !!id && tagged(id >>> 0);

  const apply = () => {
    if (!on || !npc) return { tagged: false };
    if (!tagged(npc)) tag(npc, true);
    return { tagged: tagged(npc), hoster: hosterOf(npc) };
  };

  // One line per host change on the watched NPC, and a summary. The point of the experiment is the sequence
  // of changes and their timing, so each change is logged with the gap since the last one.
  const poll = (now) => {
    if (!on || !npc) return null;
    const h = hosterOf(npc);
    const prev = S.seen.has(npc) ? S.seen.get(npc) : null;
    if (prev === null) { S.seen.set(npc, h); S.lastChangeAt = now; return { first: true, hoster: h }; }
    if (h !== prev) {
      const gap = S.lastChangeAt ? now - S.lastChangeAt : 0;
      S.seen.set(npc, h);
      S.lastChangeAt = now;
      S.changes++;
      return { changed: true, from: prev, to: h, afterMs: gap, changes: S.changes, refused: S.refused };
    }
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

  // Its own pass, like the director's. Nothing here moves an NPC: it tags, watches and logs.
  if (on && npc && typeof every === 'function') {
    every('serverHostPin', 1000, () => {
      const now = Date.now();
      apply();
      const ev = poll(now);
      if (ev && ev.changed) {
        say(`serverHostPin: ${npc.toString(16)} host ${ev.from.toString(16)} -> ${ev.to.toString(16)} after ${ev.afterMs} ms (change ${ev.changes}, ${ev.refused} refused)`);
      } else if (ev && ev.first) {
        say(`serverHostPin: watching ${npc.toString(16)} in mode ${C.mode}, host ${ev.hoster.toString(16)}`);
      }
    });
    every('serverHostPinSummary', C.logEveryMs, () => {
      const s = { mode: C.mode, npc: npc.toString(16), changes: S.changes, refused: S.refused };
      say(`serverHostPin: ${JSON.stringify(s)}`);
    });
  }

  return {
    mode: C.mode,
    npc,
    TAG,
    tagged,
    tag,
    refuses,
    directorSkips,
    apply,
    poll,
    noteRefusal,
    stats: () => ({ mode: C.mode, npc, changes: S.changes, refused: S.refused }),
  };
};
