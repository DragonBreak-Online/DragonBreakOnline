// When FormView runs a world object the server streams without movement (a door, a container), import-free so a harness can drive it

// applyAll acts on such a ref only on its own clocks (open state over 133 ms, harvest over 666 ms) or under the crosshair; a run this long after the last finds the open check due
export const STILL_TICK_MS = 134;
// Refs that ran on one frame drift apart by up to this much a run
export const STILL_JITTER_MS = 20;

export interface StillGateState {
  nextAt: number;
  // Learnt when the ref resolves: an actor is never skipped
  actor: boolean | undefined;
}

export const newStillGate = (): StillGateState => ({ nextAt: 0, actor: undefined });

// True when this update can be skipped. The next run is a tick on from the frame this one ran in, so a slow frame never brings it sooner; the first run spreads the second over a whole tick
export const skipStill = (s: StillGateState, now: number, targeted: boolean, animChanged: boolean, random: () => number = Math.random): boolean => {
  if (s.actor) return false;
  if (now >= s.nextAt) {
    s.nextAt = now + STILL_TICK_MS + Math.floor(random() * (s.nextAt ? STILL_JITTER_MS : STILL_TICK_MS));
    return false;
  }
  return !targeted && !animChanged;
};
