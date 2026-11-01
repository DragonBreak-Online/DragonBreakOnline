// DragonBreak Online: /clearcorpses [radius] [all], staff (Nat, 31 Oct: "we need a clear corpse command"). Loaded by gamemode.js.
//
// Takes away the dead NPC bodies around the staff member who runs it: radius in metres (default radiusMeters, at most
// maxRadiusMeters), the GM's own cell or worldspace only. Plain, it leaves the dead of players' summons and companions
// and of GM warbands (their owners clear those, and /raid clear does the warband's); "all" takes them too. It never touches
// a living actor, a player's body (downed or dead), or a record placed by a plugin (an id below 0xff000000: a disabled
// vanilla NPC would stay gone from the saved world for good).
//
// How: a body is disabled, not destroyed. The spawn system (npcSpawnSystem.ts), the warband and the companion system each
// hold the ids of their dead and destroy them on their own timers; the engine gives a destroyed id to the next form it
// creates, so a destroy from here would leave them a stale id that a later sweep or respawn could act on with a new actor
// behind it (a player's, even). A disabled form keeps its id; MpObjectReference::Disable removes it from the grid and every
// client drops its copy at once, the same as on a destroy, and the owner's own timer still removes it later. A body nothing
// owns stays a disabled form, out of every game. Each run is audited.
'use strict';

const UNITS_PER_METER = 70;

module.exports = (api) => {
  const { mp, log, audit, personal, who, profileOf, userOf, registerChatCommand, cfg } = api;
  const C = Object.assign({ radiusMeters: 30, maxRadiusMeters: 100 }, (cfg && cfg.clearCorpses) || {});
  const get = (id, k) => { try { return mp.get(id, k); } catch (e) { return undefined; } };
  const isPlayer = (id) => profileOf(id) >= 0 || userOf(id) >= 0;
  const isWarband = (id) => {
    const S = globalThis.__dboWarband;
    if (!S || !Array.isArray(S.released)) return false;
    return S.released.some((r) => (r.id >>> 0) === id) || (S.owners instanceof Map && S.owners.has(id));
  };
  // Whose it is when it is not a plain NPC: a player's summon or companion, a GM's warband
  const ownedBy = (id) => {
    if (isWarband(id)) return 'warband';
    const owner = Number(get(id, 'ff_companionOf')) >>> 0;
    return owner ? 'companion' : '';
  };

  // The bodies in reach of `a`, with why each other dead actor was left: { take: [id], left: { reason: n } }
  const survey = (a, radiusM, all) => {
    const out = { take: [], left: {} };
    const leave = (why) => { out.left[why] = (out.left[why] || 0) + 1; };
    const where = String(get(a, 'worldOrCellDesc') || '');
    const from = get(a, 'pos');
    if (!where || !Array.isArray(from)) return null;
    const reach = radiusM * UNITS_PER_METER;
    let near = [];
    try { near = mp.getNeighborsByPosition(where, from) || []; } catch (e) { return null; }
    for (const raw of near) {
      const id = Number(raw) >>> 0;
      if (id === (a >>> 0)) continue;
      if (get(id, 'isDead') !== true) continue;
      if (get(id, 'isDisabled') === true) continue;
      const p = get(id, 'pos');
      if (!Array.isArray(p) || String(get(id, 'worldOrCellDesc') || '') !== where) continue;
      if (Math.hypot(p[0] - from[0], p[1] - from[1], p[2] - from[2]) > reach) continue;
      if (isPlayer(id)) { leave('a player'); continue; }
      if (id < 0xff000000) { leave('placed by a plugin'); continue; }
      const own = ownedBy(id);
      if (own && !all) { leave(own === 'warband' ? 'a warband\'s' : 'a summon or companion'); continue; }
      out.take.push(id);
    }
    return out;
  };

  const clear = (a, args) => {
    const words = String(args || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const all = words.includes('all');
    const num = words.find((w) => /^\d+(\.\d+)?$/.test(w));
    if (words.some((w) => w !== 'all' && !/^\d+(\.\d+)?$/.test(w))) return personal(a, `Usage: /clearcorpses [metres, default ${C.radiusMeters}, at most ${C.maxRadiusMeters}] [all: summons, companions and warbands too]`);
    const radiusM = Math.min(Number(C.maxRadiusMeters), Math.max(1, num ? Number(num) : Number(C.radiusMeters)));
    const s = survey(a, radiusM, all);
    if (!s) return personal(a, 'Your position cannot be read just now.');
    let n = 0;
    const bases = new Map();
    for (const id of s.take) {
      try {
        mp.set(id, 'isDisabled', true);
        n++;
        const b = String(get(id, 'baseDesc') || '?');
        bases.set(b, (bases.get(b) || 0) + 1);
      } catch (e) { log(`clearcorpses: could not disable ${id.toString(16)}: ${e.message}`); }
    }
    const left = Object.entries(s.left).map(([why, k]) => `${k} ${why}`).join(', ');
    const where = String(get(a, 'worldOrCellDesc') || '?');
    audit(`CLEARCORPSES ${who(a)} cleared ${n} body(ies) within ${radiusM} m in ${where}${all ? ' (all)' : ''}: ${[...bases].map(([b, k]) => `${k}x ${b}`).join(', ') || 'none'}${left ? `; left ${left}` : ''}`);
    personal(a, `${n ? `Cleared ${n} bod${n === 1 ? 'y' : 'ies'}` : 'No bodies to clear'} within ${radiusM} m.${left ? ` Left: ${left}${all ? '' : ' (/clearcorpses ' + radiusM + ' all takes summons, companions and warbands too)'}.` : ''}`);
    return n;
  };

  // A plain string: tests/menu-coverage-harness.js reads the help from the source (the defaults are config clearCorpses)
  registerChatCommand('clearcorpses', clear, { admin: true, help: '[metres] [all]: take away the dead NPC bodies around you (30 m unless you say, at most 100); all takes the dead of summons, companions and warbands too. Never the living, never a player\'s body' });
  return { survey, clear };
};
