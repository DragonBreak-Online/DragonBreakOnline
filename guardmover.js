// DragonBreak Online: the server walks a guard its own route (_work\server-npc-movement-1102.md, Option B
// phase 1 step 4). Loaded by gamemode.js, config "guardMover". OFF by default.
//
// WHAT DRIVES WHAT, because getting this wrong stranded a guard in Nat's game on 2 Nov:
//   - serverhostpin.js in mode "pin" TAGS the NPC private.dboServerHost. The C++ then refuses every client
//     that asks to host it, skips the stale sweep, and tells clients isHostedByOther;
//   - THIS module moves it, by calling mp.sendServerMovement, and NEVER tags anything;
//   - the C++ primitive sends one UpdateMovement to each watcher and moves the server's own copy.
// A tag with nothing driving it is the stranding: refused to every client, asked for by none, moved by
// nobody. So this module REFUSES TO RUN unless the NPC is already tagged and the sender exists, and it
// publishes a heartbeat the pin module watches, so "tagged but nothing driving it" is a logged warning
// instead of a guard turning on the spot for eleven minutes.
//
// Config: "guardMover": { mode: "off" | "on", zone: "guard:bruma:8", hz: 4, floorStep: 64, logEveryMs: 10000 }
//   hz         packets a second per watcher. W1 measured the client's playback: under about 8 Hz a copy walks
//              and stops unless their gap-following playback is in, so 4 and 10 are the two worth trying.
//   floorStep  units between floor samples along a leg. W6 measured the error against an 8-unit profile:
//              step 64 gives p95 1.1 and p99 3.0 units, and 32 buys 1.7 units for four times the sampling.
//
// Nothing here pathfinds. The route comes from W2's timeline and the floor from W6's navmesh; this module is
// the clock and the safety rails.
module.exports = ({ mp, log, every, cfg, state } = {}) => {
  const C = Object.assign(
    { mode: 'off', zone: '', hz: 4, floorStep: 64, logEveryMs: 10000 },
    (cfg && cfg.guardMover) || {}
  );
  const S = state || {};
  const say = typeof log === 'function' ? log : () => {};

  const zone = String(C.zone || '');
  const on = C.mode === 'on' && !!zone;
  const hz = Math.max(1, Math.min(30, Number(C.hz) || 4));
  const stepMs = Math.round(1000 / hz);
  const floorStep = Math.max(8, Number(C.floorStep) || 64);

  const TAG = 'private.dboServerHost';
  const SPAWNER = 'private.npcSpawner';
  const CELL_UNITS = 4096;

  if (!S.stats) {
    S.stats = { sent: 0, legs: 0, floorNull: 0, cellChanges: 0, refusals: 0, lastWhy: '' };
  }
  if (!S.ids) S.ids = new Set();

  const get = (id, key) => {
    try { return mp.get(id, key); } catch (e) { return undefined; }
  };

  // The one NPC this zone spawned, found the way serverhostpin.js finds it: by npcSpawner, never by a form id,
  // because a spawned id is reassigned every run and the 08:00/20:00 shift change swaps the actor outright.
  const isMine = (id) => {
    const f = id >>> 0;
    if (!f) return false;
    return get(f, SPAWNER) === zone;
  };

  const tagged = (id) => get(id >>> 0, TAG) === true;

  // Everything that must be true before a single packet is sent. Each refusal says which one failed, because
  // "the guard is not moving" with no reason is the message that cost an evening.
  const why = () => {
    if (!on) return 'mode is off';
    if (typeof mp.sendServerMovement !== 'function') {
      return 'this server has no mp.sendServerMovement (the C++ sender is not in this build)';
    }
    if (typeof globalThis.__dboGuardRouteAt !== 'function') {
      return 'no __dboGuardRouteAt (guards.js behaviour layer is not loaded)';
    }
    if (!S.ids.size) return `no actor found for ${zone} yet (nobody has seen it)`;
    for (const id of S.ids) {
      if (!tagged(id)) {
        return `${id.toString(16)} is not tagged ${TAG}: set serverHostPin mode to pin first, or a client ` +
          'will fight the server for it';
      }
    }
    return '';
  };

  // The cell a position falls in, as the exterior grid. The server never updates an NPC's cell by movement and
  // an update that disagrees is dropped, after which every hit on it is refused - so a leg that would leave
  // the cell is refused here rather than discovered on Nat's screen. Cell 13,49's five waypoints are all
  // interior to it and a cell is convex, so this should never fire; it fires if the mover is wrong.
  const cellOf = (pos) => `${Math.floor(pos[0] / CELL_UNITS)},${Math.floor(pos[1] / CELL_UNITS)}`;

  // The floor under a position, from W6's navmesh, or null. Never guesses: a null is counted and the previous
  // z is kept, because the markers' own z is up to 36.5 units (about 52 cm) off the real floor and sliding
  // visibly is worse than holding the last good height for one tick.
  const floorAt = (world, pos) => {
    if (typeof mp.navFloor !== 'function' || !world) return null;
    try {
      const got = mp.navFloor(world, pos, pos, floorStep);
      const z = Array.isArray(got) ? got[0] : got;
      return typeof z === 'number' && isFinite(z) ? z : null;
    } catch (e) {
      return null;
    }
  };

  const worldKey = (id) => {
    try { return typeof mp.getWorldOrCellDesc === 'function' ? mp.getWorldOrCellDesc(id) : ''; }
    catch (e) { return ''; }
  };

  // One tick: where should this guard be now, and send it there.
  //
  // The rails are enforced HERE and not only in the timed pass. The harness caught that: a public step() that
  // trusts its caller will one day be called by something that has not checked, and the two things it must
  // never do - drive an untagged NPC, or keep going after a halt - are exactly the two that are invisible
  // until a player sees them. Costs two property reads a tick.
  const step = (id, now) => {
    if (!on || S.halted) return null;
    if (typeof mp.sendServerMovement !== 'function') return null;
    if (!tagged(id)) return null;
    if (typeof globalThis.__dboGuardRouteAt !== 'function') return null;
    const at = globalThis.__dboGuardRouteAt(zone, now);
    if (!at || !at.pos) return null;

    const pos = [Number(at.pos[0]), Number(at.pos[1]), Number(at.pos[2])];
    const cell = cellOf(pos);
    if (S.cell && S.cell !== cell) {
      S.stats.cellChanges++;
      S.stats.lastWhy = `refused a leg leaving cell ${S.cell} for ${cell}`;
      say(`guardMover: ${S.stats.lastWhy} - stopping, this is the one thing the slice must not do`);
      S.halted = true;
      return null;
    }
    S.cell = cell;

    const z = floorAt(worldKey(id), pos);
    if (z === null) S.stats.floorNull++; else pos[2] = z;

    const data = {
      pos,
      // DEGREES, passed through unconverted: the client compares rot[2] against getAngleZ and TranslateTo
      // takes degrees, and W2 reports the heading in the same unit (0 = +y, 90 = +x). Do not add a conversion here
      rot: [0, 0, Number(at.heading) || 0],
      speed: at.moving ? Number(at.speed) || 0 : 0,
      runMode: at.moving ? 'Walking' : 'Standing',
    };
    try {
      mp.sendServerMovement(id, data);
      S.stats.sent++;
      if (at.point !== S.point) { S.stats.legs++; S.point = at.point; }
      // The heartbeat serverhostpin.js watches: a tagged NPC with a stale beat is the stranding, and a
      // warning in the log beats a player noticing
      globalThis.__dboGuardMoverBeat = now;
      return data;
    } catch (e) {
      S.stats.refusals++;
      S.stats.lastWhy = `sendServerMovement refused: ${e && e.message ? e.message : e}`;
      say(`guardMover: ${S.stats.lastWhy}`);
      S.halted = true;
      return null;
    }
  };

  // The director's own pass teaches us the id, exactly as the pin module learns it: there is no zone -> id map
  // reachable from gameplay JS.
  globalThis.__dboGuardMoverSees = (id) => {
    if (!on || !isMine(id)) return;
    const f = id >>> 0;
    if (!S.ids.has(f)) { S.ids.add(f); say(`guardMover: ${zone} is actor ${f.toString(16)}`); }
  };

  if (typeof every === 'function') {
    every('guardMover', stepMs, () => {
      if (!on || S.halted) return;
      const blocked = why();
      if (blocked) {
        if (blocked !== S.said) { S.said = blocked; say(`guardMover: not moving ${zone}: ${blocked}`); }
        return;
      }
      if (S.said) { say(`guardMover: moving ${zone} again (${S.said} is resolved)`); S.said = ''; }
      const now = Date.now();
      for (const id of S.ids) step(id, now);
    });

    every('guardMoverSummary', C.logEveryMs, () => {
      if (!on) return;
      const s = Object.assign({ mode: C.mode, zone, hz, floorStep, halted: !!S.halted }, S.stats);
      say(`guardMover: ${JSON.stringify(s)}`);
    });
  }

  return {
    mode: C.mode,
    zone,
    hz,
    stepMs,
    floorStep,
    why,
    cellOf,
    floorAt,
    step,
    sees: (id) => globalThis.__dboGuardMoverSees(id),
    halted: () => !!S.halted,
    stats: () => Object.assign({}, S.stats),
    watching: () => Array.from(S.ids),
  };
};
