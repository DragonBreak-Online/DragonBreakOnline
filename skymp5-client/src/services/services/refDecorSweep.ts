// Which claimed refs RefDecorService visits on each update; no natives here, so a node harness can drive it

// Per update, whichever runs out first: Date.now() is whole milliseconds, so the visit cap is the hard limit
export const UPDATE_BUDGET_MS = 2;
export const UPDATE_MAX_VISITS = 48;
// Refs in loaded 3D are visited again at the old slow tick, so CHEST_SETTLE_TICKS keeps its rate
export const LIVE_EVERY_N_UPDATES = 30;
// Refs not known to be loaded are probed this many per slow tick, so one that loads without a cell event is still found
export const PROBE_TRICKLE = 32;
// A burst of cell loads (an exterior grid shift) starts one probe pass this many updates after the last of them
export const CELL_SETTLE_UPDATES = 10;

export type VisitKind = "dirty" | "live" | "probe";

// FIFO of unique ids
class IdQueue {
  push(id: number): void {
    if (this.has.has(id)) return;
    this.has.add(id);
    this.ids.push(id);
  }

  shift(): number | undefined {
    while (this.head < this.ids.length) {
      const id = this.ids[this.head++];
      if (this.has.delete(id)) return id;
    }
    this.clear();
    return undefined;
  }

  clear(): void {
    this.ids = [];
    this.head = 0;
    this.has.clear();
  }

  get size(): number {
    return this.has.size;
  }

  private ids: number[] = [];
  private head = 0;
  private has = new Set<number>();
}

// dirty: changed by the server or reset by a save load, applied wherever the ref is
// live: in loaded 3D last time it was looked at, applied at the slow tick
// probe: not known to be loaded; applied only if it is, so refs in unattached cells cost one lookup and no more
export class DecorWork {
  markDirty(id: number): void {
    this.dirty.push(id);
  }

  cellLoaded(): void {
    this.settle = CELL_SETTLE_UPDATES;
  }

  // What a visit found: in loaded 3D or not
  seen(id: number, loaded: boolean): void {
    if (loaded) this.liveIds.add(id);
    else this.liveIds.delete(id);
  }

  forget(id: number): void {
    this.liveIds.delete(id);
    this.appliedAt.delete(id);
  }

  // Outside server changes a ref is applied at most once per slow tick, so a chest settles no faster than it did
  mayApply(id: number, kind: VisitKind): boolean {
    const last = this.appliedAt.get(id);
    if (kind !== "dirty" && last !== undefined && this.updates - last < LIVE_EVERY_N_UPDATES) return false;
    this.appliedAt.set(id, this.updates);
    return true;
  }

  reset(): void {
    this.dirty.clear();
    this.live.clear();
    this.probe.clear();
    this.liveIds.clear();
    this.appliedAt.clear();
    this.settle = -1;
    this.cursor = 0;
  }

  // Once per update, before any work is taken
  tick(ids: () => number[]): void {
    this.updates++;
    if (this.settle >= 0 && this.settle-- === 0) {
      ids().forEach((id) => this.probe.push(id));
    }
    if (this.updates % LIVE_EVERY_N_UPDATES !== 0) return;
    this.liveIds.forEach((id) => this.live.push(id));
    if (this.probe.size === 0) this.trickle(ids());
  }

  next(): { id: number; kind: VisitKind } | null {
    let id = this.dirty.shift();
    if (id !== undefined) return { id, kind: "dirty" };
    id = this.live.shift();
    if (id !== undefined) return { id, kind: "live" };
    id = this.probe.shift();
    if (id !== undefined) return { id, kind: "probe" };
    return null;
  }

  get backlog(): number {
    return this.dirty.size + this.live.size + this.probe.size;
  }

  get liveCount(): number {
    return this.liveIds.size;
  }

  private trickle(all: number[]): void {
    const n = all.length;
    if (this.cursor >= n) this.cursor = 0;
    let added = 0;
    for (let examined = 0; examined < n && added < PROBE_TRICKLE; examined++) {
      const id = all[this.cursor];
      this.cursor = this.cursor + 1 >= n ? 0 : this.cursor + 1;
      if (this.liveIds.has(id)) continue;
      this.probe.push(id);
      added++;
    }
  }

  private dirty = new IdQueue();
  private live = new IdQueue();
  private probe = new IdQueue();
  private liveIds = new Set<number>();
  private appliedAt = new Map<number, number>();
  private updates = 0;
  private settle = -1;
  private cursor = 0;
}

// Visits queued refs until this update's budget is spent; returns how many it visited
export const runBudget = (
  work: DecorWork,
  visit: (id: number, kind: VisitKind) => void,
  now: () => number,
  budgetMs: number = UPDATE_BUDGET_MS,
  maxVisits: number = UPDATE_MAX_VISITS
): number => {
  const t0 = now();
  let n = 0;
  while (n < maxVisits && (n === 0 || now() - t0 < budgetMs)) {
    const w = work.next();
    if (!w) break;
    visit(w.id, w.kind);
    n++;
  }
  return n;
};
