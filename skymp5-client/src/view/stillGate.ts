// When FormView runs a world object the server streams without movement (a door, a container), import-free so a harness can drive it

// applyAll acts on such a ref only on its own clocks (open state 133 ms, harvest 666 ms) or under the crosshair
export const STILL_TICK_MS = 134;

export const STILL_SKIP = 0;
export const STILL_RUN = 1;
// The ref's own tick: FormView runs the open-state check on it
export const STILL_TICK = 2;

export interface StillGateState {
  nextAt: number;
  // Learnt when the ref resolves: an actor is never skipped
  actor: boolean | undefined;
}

export const newStillGate = (): StillGateState => ({ nextAt: 0, actor: undefined });

// Ticks keep their phase, so refs that ran on one frame do not stay together; the first tick lands at a random point of the second
export const stillStep = (s: StillGateState, now: number, targeted: boolean, animChanged: boolean, random: () => number = Math.random): number => {
  if (s.actor) return STILL_RUN;
  if (!s.nextAt) {
    s.nextAt = now + STILL_TICK_MS + Math.floor(random() * STILL_TICK_MS);
    return STILL_RUN;
  }
  if (now >= s.nextAt) {
    s.nextAt += STILL_TICK_MS * (Math.floor((now - s.nextAt) / STILL_TICK_MS) + 1);
    return STILL_TICK;
  }
  return targeted || animChanged ? STILL_RUN : STILL_SKIP;
};
