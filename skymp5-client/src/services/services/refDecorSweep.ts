// Which claimed refs RefDecorService looks at on a given slow tick. No engine here, so a node harness can
// drive it.
//
// Measured on the live dev server, 31 Oct, 1,381 client perf windows: RefDecorService is the second most
// expensive update handler in EVERY window, 1.39 ms per frame averaged. That average hides the shape of it:
// the sweep runs once every APPLY_EVERY_N_UPDATES frames and then resolves the WHOLE decor set, about 1,700
// refs (873 claims plus partners), each costing a remoteIdToLocalId and a Game.getFormEx before it can even be
// rejected as not loaded. So one frame in thirty does ~3,400 native calls and the other twenty-nine do none.
//
// Nearly all of that work is wasted every time: a player stands near a handful of claimed doors, and the rest
// of the 1,700 are in cells that are not loaded, so they resolve to nothing and are thrown away. The cost is
// in asking, not in doing.
//
// This splits the set in two:
//   - HOT refs, the ones that resolved to a real reference last time they were looked at. They are visited on
//     every sweep, which keeps CHEST_SETTLE_TICKS counting at exactly the rate it does now - a chest still
//     settles in about three seconds, and nothing about naming or locking changes for anything on screen.
//   - everything else, visited through a rolling cursor, at most `budget` per sweep. These are the refs that
//     are not loaded; delaying the discovery of one only delays noticing that it came into range.
// and forces a full pass when the player's surroundings change (a cell load), so walking into an area
// resolves everything at once - during a load, where a spike costs nothing - rather than discovering it a
// cursor-step at a time.

export const SWEEP_BUDGET = 120;

export interface SweepState {
  // refIds that resolved to a real reference on their last visit
  hot: ReadonlySet<number>;
  // where the rolling cursor reached in the id list
  cursor: number;
  // a cell load, a save load or fresh decor from the server: look at everything once
  full: boolean;
}

export interface SweepPick {
  ids: number[];
  cursor: number;
  // true when this pass covered every id, so the caller can clear its full-pass flag
  covered: boolean;
}

// `ids` is the decor set's keys in a stable order. The cursor walks that order, so over successive sweeps
// every ref is visited even though no single sweep visits them all.
export const pickSweep = (
  ids: ReadonlyArray<number>,
  state: SweepState,
  budget: number = SWEEP_BUDGET
): SweepPick => {
  const n = ids.length;
  if (n === 0) {
    return { ids: [], cursor: 0, covered: true };
  }
  // A full pass is the current behaviour, kept for the cases that need it
  if (state.full || budget <= 0 || n <= budget) {
    return { ids: ids.slice(), cursor: 0, covered: true };
  }

  const out: number[] = [];
  const taken = new Set<number>();
  // the hot ones first, and they do not consume the budget: there are only ever a handful loaded at once, and
  // skipping one would change how fast a chest in front of the player settles
  // forEach, not for..of: this target has no downlevelIteration
  state.hot.forEach((id) => {
    if (!taken.has(id)) {
      taken.add(id);
      out.push(id);
    }
  });

  // then a budget's worth from wherever the cursor left off, wrapping once
  let cursor = state.cursor >= 0 && state.cursor < n ? state.cursor : 0;
  let examined = 0;
  let added = 0;
  while (examined < n && added < budget) {
    const id = ids[cursor];
    cursor = cursor + 1 >= n ? 0 : cursor + 1;
    examined++;
    if (taken.has(id)) {
      continue;
    }
    taken.add(id);
    out.push(id);
    added++;
  }

  return { ids: out, cursor, covered: false };
};
