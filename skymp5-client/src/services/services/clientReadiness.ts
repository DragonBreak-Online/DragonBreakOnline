// What character select waits for before Play is allowed, so a player cannot start loading in while the client is still
// getting ready. Each part is named, the server log says how long each took, and a cap opens Play whatever is left.

// Play opens this long after the character list arrived even if a part never finished
export const READY_CAP_MS = 30000;

export interface ReadinessState {
  gate: number;
  ready: boolean;
  byCap: boolean;
  done: number;
  total: number;
  waiting: string[];
}

interface Part {
  name: string;
  check?: (now: number) => boolean;
  doneAt: number | null;
}

interface Gate {
  id: number;
  openedAt: number;
  parts: Part[];
  openAt: number | null;
  byCap: boolean;
  reported: boolean;
}

export class ClientReadiness {
  // report gets one line per login: when Play opened and what each part took, or what was missing when the screen closed
  constructor(private report: (line: string) => void = () => { }) { }

  // The character list arrived: a new login's wait starts, and parts added from now on belong to it
  begin(now: number): number {
    this.current = { id: ++this.lastId, openedAt: now, parts: [], openAt: null, byCap: false, reported: false };
    return this.current.id;
  }

  // A part this login waits for: done once check(now) is true on a poll, or once the returned function is called
  add(name: string, check?: (now: number) => boolean): (now: number) => void {
    const gate = this.current;
    if (!gate) return () => { };
    const part: Part = { name, check, doneAt: null };
    gate.parts.push(part);
    return (now: number) => {
      if (part.doneAt === null) part.doneAt = Math.max(0, now - gate.openedAt);
    };
  }

  poll(now: number): ReadinessState {
    const gate = this.current;
    if (!gate) return { gate: 0, ready: true, byCap: false, done: 0, total: 0, waiting: [] };
    if (gate.openAt === null) this.settle(gate, now);
    const waiting = gate.parts.filter((p) => p.doneAt === null).map((p) => p.name);
    return {
      gate: gate.id, ready: gate.openAt !== null, byCap: gate.byCap,
      done: gate.parts.length - waiting.length, total: gate.parts.length, waiting,
    };
  }

  // The screen closed (Play, the server, a lost connection): a login that never got ready still leaves its line
  end(now: number, why: string): void {
    const gate = this.current;
    if (!gate) return;
    this.current = null;
    if (gate.openAt !== null) return;
    this.reportOnce(gate, `never: the screen closed (${why}) after ${now - gate.openedAt} ms, still waiting for ${this.waitingFor(gate)} (parts: ${this.times(gate)})`);
  }

  get gate(): number {
    return this.current ? this.current.id : 0;
  }

  private settle(gate: Gate, now: number): void {
    for (const p of gate.parts) {
      if (p.doneAt === null && p.check && this.passes(p.check, now)) p.doneAt = Math.max(0, now - gate.openedAt);
    }
    const missing = gate.parts.some((p) => p.doneAt === null);
    if (missing && now - gate.openedAt < READY_CAP_MS) return;
    gate.openAt = now;
    gate.byCap = missing;
    this.reportOnce(gate, missing
      ? `by the cap after ${now - gate.openedAt} ms, still waiting for ${this.waitingFor(gate)} (parts: ${this.times(gate)})`
      : `after ${now - gate.openedAt} ms (parts: ${this.times(gate)})`);
  }

  private passes(check: (now: number) => boolean, now: number): boolean {
    try { return check(now); } catch { return false; }
  }

  private reportOnce(gate: Gate, line: string): void {
    if (gate.reported) return;
    gate.reported = true;
    try { this.report(line); } catch { /* diagnostics only */ }
  }

  private waitingFor(gate: Gate): string {
    return gate.parts.filter((p) => p.doneAt === null).map((p) => p.name).join(", ") || "nothing";
  }

  private times(gate: Gate): string {
    return gate.parts.map((p) => `${p.name} ${p.doneAt === null ? "-" : p.doneAt}`).join(", ");
  }

  private current: Gate | null = null;
  private lastId = 0;
}
