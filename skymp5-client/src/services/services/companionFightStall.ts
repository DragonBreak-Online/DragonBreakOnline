// Whether a companion's ordered fight is going anywhere (#bugs 2 Oct "Raise Zombie, not working at all": the NPC simply
// stands still). On 4 Oct a raised wolf held its order in combat for 25 s without moving a step, its target untouched,
// until the owner walked out of the leash. A fight counts as stalled when, for stallMs, the companion is out of reach of
// its target, has not closed on it and the target's health has not dropped; a ranged caster that lands its hits never
// stalls. On 2 Nov a summon shuffled 16-63 units per 5 s at 1169 from its target: moving alone is not progress.
// The first stall restarts the fight, the next one gives the order up (companionService.ts).

export interface FightStall {
  // The target this window watches, when the window began, and the companion's place, distance and the target's health then
  target: number;
  since: number;
  pos: number[];
  dist: number;
  health: number;
  // Restarts already tried on this order without progress
  kicks: number;
}

export type StallAction = "none" | "restart" | "drop";

export const STALL_MS = 6000;
// Closer than this to its target it is fighting, whatever it does
export const STALL_REACH = 256;
// Closing more than this on its target in a window is getting somewhere
export const STALL_MOVE = 64;

export const fightStallStep = (prev: FightStall | null, now: number, target: number, pos: number[], health: number,
  toTarget: number, isCasting = false): { stall: FightStall; action: StallAction } => {
  const fresh = (kicks: number): FightStall => ({ target, since: now, pos: pos.slice(), dist: toTarget, health, kicks });
  if (!prev || prev.target !== target) return { stall: fresh(0), action: "none" };
  if (isCasting || toTarget <= STALL_REACH || health < prev.health - 0.001 || prev.dist - toTarget > STALL_MOVE) return { stall: fresh(0), action: "none" };
  if (now - prev.since < STALL_MS) return { stall: prev, action: "none" };
  return { stall: fresh(prev.kicks + 1), action: prev.kicks === 0 ? "restart" : "drop" };
};
