// DragonBreak Online: an NPC stays with its client host for a few seconds after it changes hands or fights.
// Moving a fighting NPC between two live hosts, or back and forth, left a copy being driven by two clients at once
// (crash map 1-3 Oct: crash-wave ANALYSIS.md section 7, server half). Pure: gamemode.js hostAttemptHook and
// npcdirector.js ask it, and the harness drives it with its own clock.
// A hand-over is held back only while the current host can still drive the NPC (online, same world, in reach, by the
// caller's own host policy); an NPC without a host, or whose host left or is out of reach, is never held.
// A fight holds its NPC fightMs after the last blow. fightMaxMs can cap that at so long from the fight's first blow (or from
// a hand-over during it); it is off by default (Infinity), because a cap at or under fightMs stops blows extending the hold
// at all and brought back the mid-fight host swap (Nate's minotaur, 9 Oct). A cap must be well above fightMs; 1e12 = off,
// and so is anything that is not a positive number (null, 0, -1, a word): it never switches the fight hold off.
// Config "hostCooldown": { enabled, handoverMs, fightMs, fightMaxMs }.
'use strict';

// state: kept by the caller across a hot reload ({ handedAt, foughtAt, fightSince })
module.exports = (cfg, now = () => Date.now(), state = {}) => {
  const C = Object.assign({ enabled: true, handoverMs: 5000, fightMs: 5000, fightMaxMs: Infinity }, cfg || {});
  // A fightMaxMs that is not a positive number (null, 0, a word) means off; it must never turn the fight hold itself off
  if (!(typeof C.fightMaxMs === 'number' && C.fightMaxMs > 0)) C.fightMaxMs = Infinity;
  const S = state;
  if (!(S.handedAt instanceof Map)) S.handedAt = new Map();
  if (!(S.foughtAt instanceof Map)) S.foughtAt = new Map();
  if (!(S.fightSince instanceof Map)) S.fightSince = new Map();
  const prune = (m, ms) => { if (m.size > 4096) { const t = now(); for (const [k, v] of m) if (t - v > ms) m.delete(k); } };
  return {
    config: C,
    // A hand-over during a fight starts the new host's fightMaxMs, so a long fight changes hands at most once per fightMaxMs
    noteHandover: (npc) => {
      npc = npc >>> 0;
      const t = now();
      S.handedAt.set(npc, t);
      if (t - (S.foughtAt.get(npc) || -Infinity) < C.fightMs) S.fightSince.set(npc, t);
      prune(S.handedAt, C.handoverMs);
    },
    noteFight: (npc) => {
      npc = npc >>> 0;
      const t = now();
      // a new fight, or one whose start was lost (state from before fightSince existed)
      if (!(t - (S.foughtAt.get(npc) || -Infinity) < C.fightMs) || !S.fightSince.has(npc)) S.fightSince.set(npc, t);
      S.foughtAt.set(npc, t);
      prune(S.foughtAt, C.fightMs);
      // a fight's start goes with its last blow
      if (S.fightSince.size > 4096) for (const k of S.fightSince.keys()) if (!(t - (S.foughtAt.get(k) || -Infinity) < C.fightMs)) S.fightSince.delete(k);
    },
    // null when the hand-over may go ahead, else the reason it waits
    //   current: the NPC's host now (0 = none); requester: who would take it; hostCanDrive: current is online and in reach
    holds: (npc, requester, current, hostCanDrive) => {
      if (!C.enabled) return null;
      current = current >>> 0; requester = requester >>> 0; npc = npc >>> 0;
      if (!current || current === requester || !hostCanDrive) return null;
      const t = now();
      if (t - (S.handedAt.get(npc) || -Infinity) < C.handoverMs) return 'changed hands';
      if (t - (S.foughtAt.get(npc) || -Infinity) < C.fightMs && t - (S.fightSince.get(npc) || t) < C.fightMaxMs) return 'in a fight';
      return null;
    },
  };
};
