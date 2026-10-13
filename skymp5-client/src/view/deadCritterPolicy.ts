// Which dead-hawk bodies to remove (services/deadCritterService.ts), import-free so a harness can drive it.
// A hawk's script places a lootable body (fcHawkGO, a CONT) with PlaceAtMe when it dies; the cell never resets while the
// player stays logged in, so they pile up (Nate, 14 Oct). A body goes once it is maxAgeMs old, or the oldest go once more
// than maxBodies are seen, never while the player stands within lootMeters of it.
export interface DeadBody { id: number; firstSeenMs: number; }
export interface DeadCritterRules { maxAgeMs: number; maxBodies: number; perPass: number; }
export const DEAD_CRITTER_RULES: DeadCritterRules = { maxAgeMs: 5 * 60000, maxBodies: 4, perPass: 4 };

// Ids to remove this pass, oldest first; `near` says whether the player is close enough to be looting it
export const deadBodiesToRemove = (bodies: DeadBody[], now: number, near: (id: number) => boolean, rules: DeadCritterRules = DEAD_CRITTER_RULES): number[] => {
  const sorted = bodies.slice().sort((a, b) => a.firstSeenMs - b.firstSeenMs);
  const over = Math.max(0, sorted.length - rules.maxBodies);
  const out: number[] = [];
  sorted.forEach((b, i) => {
    if (out.length >= rules.perPass) return;
    if ((i < over || now - b.firstSeenMs >= rules.maxAgeMs) && !near(b.id)) out.push(b.id);
  });
  return out;
};

// Only a body this session made: a placed ref (below 0xff000000) belongs to a plugin and is left alone
export const isSpawnedBody = (refId: number): boolean => (refId >>> 0) >= 0xff000000;
