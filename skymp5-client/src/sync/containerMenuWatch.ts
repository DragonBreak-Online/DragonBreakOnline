// Items the game still shows in the pack while a container window is open although the server took them away (no imports)

export type Totals = Map<number, number>;

export interface ContainerGhost {
  baseId: number;
  // How many the game shows beyond the server, over what it showed beyond it before
  excess: number;
}

export interface ContainerMenuWatchOptions {
  // No item moved for this long, and a server pack came after the last move: the server's pack is the truth
  moveSettleMs: number;
  // A close the game did not act on is tried again after this long
  closeRetryMs: number;
  // Closes tried for one opening of the window
  maxCloses: number;
}

export const CONTAINER_WATCH_DEFAULTS: ContainerMenuWatchOptions = { moveSettleMs: 2500, closeRetryMs: 1500, maxCloses: 2 };

// Count per base form whatever the extras, as the apply leaves each base at the server's count
export const totalsOf = (entries: { baseId: number; count: number }[] | undefined): Totals => {
  const out: Totals = new Map();
  for (const e of entries || []) {
    const id = Number(e.baseId) >>> 0;
    const n = Number(e.count) || 0;
    if (id && n) out.set(id, (out.get(id) || 0) + n);
  }
  return out;
};

export class ContainerMenuWatch {
  constructor(private readonly opts: ContainerMenuWatchOptions = CONTAINER_WATCH_DEFAULTS) {}

  // Each server pack the client stores (SetInventory)
  serverInventory(now: number, totals: Totals): void {
    if (this.open) {
      this.server?.forEach((n, id) => {
        if ((totals.get(id) || 0) < n) this.candidates.add(id);
      });
      this.dirty = true;
    }
    this.server = totals;
    this.serverAt = now;
  }

  // Each item the player moves in or out of the window (ContainersService)
  moveSent(now: number, baseId: number, kind: "put" | "take"): void {
    this.moveAt = now;
    if (kind === "take") this.candidates.add(Number(baseId) >>> 0);
    this.dirty = true;
  }

  // Every frame: the items to set right when a close is due, else null; readLocal is called only when a check is due
  frame(now: number, menuOpen: boolean, readLocal: () => Totals, ignore: (baseId: number) => boolean): ContainerGhost[] | null {
    if (!menuOpen) {
      this.open = false;
      return null;
    }
    if (!this.open) {
      this.opened(readLocal());
      return null;
    }
    const server = this.server;
    if (!this.dirty || !server || (!this.candidates.size && !this.base.size)) return null;
    // The player's own moves have not all come back from the server yet
    if (now - this.moveAt < this.opts.moveSettleMs || this.serverAt <= this.moveAt) return null;
    if (this.closes >= this.opts.maxCloses || now - this.closeAt < this.opts.closeRetryMs) return null;

    const local = readLocal();
    const excessOf = (id: number) => Math.max(0, (local.get(id) || 0) - (server.get(id) || 0));
    const ghosts: ContainerGhost[] = [];
    this.candidates.forEach((id) => {
      if (ignore(id)) return;
      const excess = excessOf(id);
      const base = this.base.get(id) || 0;
      if (excess > base) ghosts.push({ baseId: id, excess: excess - base });
    });
    // A settled count replaces the one read at the opening, which may have been mid-move
    this.base.forEach((n, id) => {
      if (ghosts.some((g) => g.baseId === id)) return;
      const excess = excessOf(id);
      if (excess < n) {
        if (excess > 0) this.base.set(id, excess);
        else this.base.delete(id);
      }
    });
    if (!ghosts.length) {
      this.dirty = false;
      return null;
    }
    this.closes++;
    this.closeAt = now;
    return ghosts;
  }

  get closesTried(): number {
    return this.closes;
  }

  // What the game shows beyond the server before anything happens in the window, such as a copy the apply cannot remove
  private opened(local: Totals): void {
    this.open = true;
    this.base.clear();
    local.forEach((n, id) => {
      const excess = n - (this.server?.get(id) || 0);
      if (excess > 0) this.base.set(id, excess);
    });
    this.candidates.clear();
    this.dirty = false;
    this.closes = 0;
    this.closeAt = -Infinity;
  }

  private open = false;
  private server: Totals | undefined;
  private serverAt = -Infinity;
  private moveAt = -Infinity;
  private base = new Map<number, number>();
  // Taken in this window, or lowered by the server while it was open
  private candidates = new Set<number>();
  private dirty = false;
  private closes = 0;
  private closeAt = -Infinity;
}

// remoteServer.ts feeds it the server's packs and acts on it, ContainersService feeds it the moves
export const containerMenuWatch = new ContainerMenuWatch();
