// The one measurement the Hagraven's attacks and casts both wait on: in a creature body, which animation events does
// the player's own input actually emit, and did the graph react to them?
//
// SendAnimationEventHook's LeaveContext carries animationSucceeded, which is exactly "the graph reacted". That makes
// the question answerable rather than arguable: my earlier finding was only that the creature graph names no event a
// player's melee input emits, and that chicken and hare have no attack data at all. Whether the input reaches the
// graph, and whether a cast fares differently from a swing, was never measured.
//
// This records and SUMMARISES. It must never note per event: a second of combat emits dozens, and Report a Problem
// carries only the last 60 KB of the diagnostic file, so a chatty probe would push out the thing it was measuring.
//
// No imports, so a harness can load it on its own (tests/creature-anim-probe-harness.js).

// Plenty for a body's worth of distinct events; past this the count still rises but no new name is kept
export const MAX_NAMES = 40;

// The events worth calling out in the summary, so a reader does not have to know the animation vocabulary.
// Deliberately broad: "attackStart", "attackPowerStart", "AttackStartH2HLeft", "bashStart", "MagicCast" and the like
// all match one of these, and anything unmatched is still counted, just not highlighted.
const INTERESTING = /attack|bash|magic|cast|shout|power|swing|claw/i;

export interface EventTally {
  name: string;
  ok: number;      // the graph reacted
  failed: number;  // it did not: this is the "fallback should fire" case
}

export class AnimProbe {
  // name -> tally. Insertion order is kept, so the summary reads in the order the body produced them.
  private tally = new Map<string, EventTally>();
  private dropped = 0;
  private total = 0;

  // Called from the hook. Pure bookkeeping: no natives, nothing that can throw into the hook's context.
  add(name: string, succeeded: boolean): void {
    const n = String(name || "");
    if (!n) return;
    this.total++;
    let t = this.tally.get(n);
    if (!t) {
      if (this.tally.size >= MAX_NAMES) { this.dropped++; return; }
      t = { name: n, ok: 0, failed: 0 };
      this.tally.set(n, t);
    }
    if (succeeded) t.ok++; else t.failed++;
  }

  get events(): number { return this.total; }
  get names(): number { return this.tally.size; }

  // forEach rather than spreading the iterator: this tsconfig targets below es2015
  list(): EventTally[] { const out: EventTally[] = []; this.tally.forEach((t) => out.push(t)); return out; }

  // The events that look like a swing, a bash or a cast, which are the ones the question is about
  interesting(): EventTally[] { return this.list().filter((t) => INTERESTING.test(t.name)); }

  // Did anything the player did reach the graph and get accepted?
  anyAccepted(): boolean { return this.list().some((t) => t.ok > 0); }

  // One line, compact enough to sit in the diagnostic file next to everything else.
  // "<race>: 143 events, 11 names | attackStart 4/0 bashStart 0/2 | other: idleChairEnter 1/0"
  summary(raceHex: string): string {
    const fmt = (t: EventTally) => `${t.name} ${t.ok}/${t.failed}`;
    const hot = this.interesting();
    const rest = this.list().filter((t) => !hot.includes(t));
    const parts = [`${raceHex}: ${this.total} events, ${this.tally.size} names`];
    parts.push(hot.length ? `attack/cast: ${hot.map(fmt).join(" ")}` : "attack/cast: NONE EMITTED");
    if (rest.length) parts.push(`other: ${rest.slice(0, 12).map(fmt).join(" ")}`);
    if (this.dropped) parts.push(`(${this.dropped} past the ${MAX_NAMES}-name cap)`);
    // ok/failed is "the graph reacted / it did not", which is the whole point of the measurement
    return parts.join(" | ");
  }

  reset(): void { this.tally.clear(); this.dropped = 0; this.total = 0; }
}
