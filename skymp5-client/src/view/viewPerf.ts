// Measure-only instrumentation for the per-tick view update, for the Bruma event lag (65-92 clients, the
// periodic 6-7 s freezes). It changes no behaviour: it reads Date.now() around work that already happens and
// prints a summary every REPORT_MS through the existing __dboDiagNote relay.
//
// The question it exists to answer is NOT "how long does the form loop take" but "is the stall inside this
// update at all". `gap` is the time from one onUpdate entry to the next, so:
//   gap max ~6-7 s with total max small  -> the event loop is blocked somewhere else, and the view is a victim
//   gap max ~6-7 s with total max ~6-7 s -> the stall is in here, and the phase lines say which part
// Without that pair every other number is unreadable, because a tick that never ran looks identical to a tick
// that ran fast.
//
// Date.now() has millisecond resolution, so a single form's update is usually 0 or 1. The loop as a whole is
// therefore timed in one measurement (accurate), and per-form timing is kept only to catch a pathological
// form - one taking tens or hundreds of milliseconds, which is what a freeze would look like.

import { printConsole } from "@skyrim-platform/skyrim-platform";

const REPORT_MS = 5000;
// A tick slower than this is counted separately: 60 fps is 16 ms, so this is "the player felt it"
const SLOW_TICK_MS = 100;
// A gap this long is worth one native call to ask whether a menu explains it
const GAP_EXPLAIN_MS = 250;

class Stat {
  n = 0;
  sum = 0;
  max = 0;

  add(ms: number): void {
    this.n += 1;
    this.sum += ms;
    if (ms > this.max) {
      this.max = ms;
    }
  }

  reset(): void {
    this.n = 0;
    this.sum = 0;
    this.max = 0;
  }

  // "avg/max", avg to one decimal because most phases are under a millisecond
  render(): string {
    const avg = this.n ? this.sum / this.n : 0;
    return `${avg.toFixed(1)}/${this.max}`;
  }
}

// A gap only means "the loop was blocked" when the game was ticking. A loading screen or an open menu stops
// SkyrimPlatform's update event while timers and rAF carry on, which looks identical in `gap` alone and is a
// completely different finding - see the header. gapPaused holds the gaps a menu explains; gapBlocked holds
// the ones nothing explains, and those are the only ones worth chasing.
const phases = {
  gap: new Stat(),
  gapPaused: new Stat(),
  gapBlocked: new Stat(),
  total: new Stat(),
  gate: new Stat(),
  worldcell: new Stat(),
  model: new Stat(),
  pcdata: new Stat(),
  forms: new Stat(),
  clones: new Stat(),
  // per FORM, not per tick: n is how many forms were gated/drawn in the window
  nickgate: new Stat(),
  nicknode: new Stat(),
};

export type PhaseName = keyof typeof phases;

// The form loop's own counters, reset with the phases
const forms = {
  // the last update's counts, not totals. slots is model.forms.length, which INCLUDES freed slots that cost
  // nothing; live is the ones actually there; named is the ones carrying an appearance name, which is what the
  // nametag path runs for, so named=0 means that path was never exercised rather than that it is cheap.
  lastSlots: 0,
  lastLive: 0,
  lastNamed: 0,
  // the slowest single updateForm in the window, and which form it was
  worstMs: 0,
  worstIdx: -1,
  worstRefrId: 0,
  created: 0,
  destroyed: 0,
  // views thrown away because the server reused the index for a different id
  replaced: 0,
};

let slowTicks = 0;
let lastEntry = 0;
let windowStart = 0;

// printConsole is the only sink that actually works. The __dboDiagNote hook the rest of this file's
// neighbours use is read in five places in the client and assigned in none of them, so every existing
// diagNote call - including worldView's own "fv:gate" notes - has always been a no-op. It is still called
// here in case someone wires it later, but the report does not depend on it.
const report = (kind: string, text: string): void => {
  try {
    printConsole(`[dbo ${kind}] ${text}`);
  } catch {
    /* diagnostics only */
  }
  try {
    const note = (globalThis as { __dboDiagNote?: (k: string, t: string) => void }).__dboDiagNote;
    if (typeof note === "function") {
      note(kind, text);
    }
  } catch {
    /* diagnostics only */
  }
};

export const now = (): number => Date.now();

export const addPhase = (name: PhaseName, ms: number): void => {
  phases[name].add(ms);
};

export const noteForms = (slots: number, live: number, named: number): void => {
  forms.lastSlots = slots;
  forms.lastLive = live;
  forms.lastNamed = named;
};

export const noteFormMs = (ms: number, idx: number, refrId: number): void => {
  if (ms > forms.worstMs) {
    forms.worstMs = ms;
    forms.worstIdx = idx;
    forms.worstRefrId = refrId >>> 0;
  }
};

export const noteCreated = (): void => {
  forms.created += 1;
};

export const noteDestroyed = (): void => {
  forms.destroyed += 1;
};

export const noteReplaced = (): void => {
  forms.replaced += 1;
};

// Called at the top of onUpdate. Returns the entry time so the caller can measure `total` without a second
// clock read, and records the gap since the previous entry.
// Returns true when a menu or loading screen was open, so the caller's one native call stays in worldView
export type MenuProbe = () => boolean;

export const beginTick = (menuOpen?: MenuProbe): number => {
  const t = Date.now();
  if (lastEntry) {
    const gap = t - lastEntry;
    phases.gap.add(gap);
    if (gap >= GAP_EXPLAIN_MS) {
      // one native call, only on a hitch
      let paused = false;
      try {
        paused = menuOpen ? menuOpen() : false;
      } catch {
        paused = false;
      }
      (paused ? phases.gapPaused : phases.gapBlocked).add(gap);
    }
  }
  lastEntry = t;
  if (!windowStart) {
    windowStart = t;
  }
  return t;
};

// Called at the bottom of onUpdate with the value beginTick returned.
export const endTick = (entry: number): void => {
  const t = Date.now();
  const total = t - entry;
  phases.total.add(total);
  if (total >= SLOW_TICK_MS) {
    slowTicks += 1;
  }
  if (t - windowStart < REPORT_MS) {
    return;
  }

  const worst =
    forms.worstIdx < 0
      ? "none"
      : `${forms.worstMs}ms idx=${forms.worstIdx} refr=${forms.worstRefrId.toString(16)}`;
  report(
    "fv:perf",
    `ticks=${phases.total.n} over ${t - windowStart}ms slow>=${SLOW_TICK_MS}ms=${slowTicks} | ` +
      `gap ${phases.gap.render()} ` +
      `paused n=${phases.gapPaused.n} ${phases.gapPaused.render()} ` +
      `BLOCKED n=${phases.gapBlocked.n} ${phases.gapBlocked.render()} ` +
      `total ${phases.total.render()} | ` +
      `gate ${phases.gate.render()} worldcell ${phases.worldcell.render()} ` +
      `model ${phases.model.render()} pcdata ${phases.pcdata.render()} ` +
      `forms ${phases.forms.render()} clones ${phases.clones.render()} | ` +
      `nickgate n=${phases.nickgate.n} ${phases.nickgate.render()} nicknode n=${phases.nicknode.n} ${phases.nicknode.render()} | ` +
      `live=${forms.lastLive} named=${forms.lastNamed} slots=${forms.lastSlots} worstform ${worst} ` +
      `new=${forms.created} gone=${forms.destroyed} reindexed=${forms.replaced}`
  );

  for (const key of Object.keys(phases) as PhaseName[]) {
    phases[key].reset();
  }
  forms.worstMs = 0;
  forms.worstIdx = -1;
  forms.worstRefrId = 0;
  forms.created = 0;
  forms.destroyed = 0;
  forms.replaced = 0;
  slowTicks = 0;
  windowStart = t;
};
