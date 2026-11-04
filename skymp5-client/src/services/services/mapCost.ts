// What one map opening costs, for the npcDrift mapCost line; no natives here, so a node harness can drive it

export const SLOW_FRAME_MS = 100;

// Sent to Scaleform in a frame: the layer's scale or turn, its position, the owners drawing, the legend rows, a marker filter
export type MapAction = "scale" | "move" | "owners" | "legend" | "filter";

export class MapCost {
  constructor(now: number) {
    this.start = now;
  }

  time<T>(step: string, fn: () => T): T {
    const t0 = Date.now();
    try {
      return fn();
    } finally {
      const d = Date.now() - t0;
      const s = this.steps[step] || (this.steps[step] = [0, 0, 0]);
      s[0] += d;
      if (d > s[1]) s[1] = d;
      s[2]++;
    }
  }

  act(a: MapAction): void {
    if (this.cur.indexOf(a) < 0) this.cur.push(a);
    this.acts[a] = (this.acts[a] || 0) + 1;
  }

  count(what: string): void {
    this.counts[what] = (this.counts[what] || 0) + 1;
  }

  // Called at the start of each update: a slow gap is put down to what the update before sent
  frame(now: number): void {
    if (this.last) {
      const dt = now - this.last;
      if (dt > this.worst) this.worst = dt;
      if (dt > SLOW_FRAME_MS) {
        this.slow++;
        for (const a of this.cur.length ? this.cur : ["none"]) this.slowAfter[a] = (this.slowAfter[a] || 0) + 1;
      }
    }
    this.last = now;
    this.frames++;
    this.cur = [];
  }

  report(now: number): Record<string, unknown> {
    const steps: Record<string, [number, number, number]> = {};
    for (const k of Object.keys(this.steps)) steps[k] = this.steps[k].slice() as [number, number, number];
    return {
      kind: "mapCost", frames: this.frames, seconds: Math.round((now - this.start) / 100) / 10, slow: this.slow, worstMs: this.worst,
      steps, acts: Object.assign({}, this.acts), slowAfter: Object.assign({}, this.slowAfter), counts: Object.assign({}, this.counts),
    };
  }

  private start = 0;
  private last = 0;
  private frames = 0;
  private slow = 0;
  private worst = 0;
  // step -> [ms, worst ms, calls]
  private steps: Record<string, [number, number, number]> = {};
  private acts: Record<string, number> = {};
  private slowAfter: Record<string, number> = {};
  private counts: Record<string, number> = {};
  private cur: string[] = [];
}
