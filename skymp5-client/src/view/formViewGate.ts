// When WorldView may run its FormViews again, counted on update events so a Papyrus wait that never returns cannot hold it shut

// A long gap between two updates (a load screen, a pause) counts as this much play at most
export const GATE_MAX_STEP_MS = 100;
// A gate closed with no count of its own (the showracemenu snippet) still opens after this much play
export const GATE_FALLBACK_SECONDS = 10;

export class FormViewGate {
  arm(seconds: number, now: number): void {
    this.armed = true;
    this.remainingMs = Math.max(0, seconds) * 1000;
    this.lastAt = 0;
    this.armedAt = now;
  }

  disarm(): void {
    this.armed = false;
  }

  isArmed(): boolean {
    return this.armed;
  }

  ageMs(now: number): number {
    return this.armedAt ? Math.max(0, now - this.armedAt) : 0;
  }

  // One update event: true once, when the count runs out; paused time (the creator or a load screen open) is not counted
  tick(now: number, paused: boolean): boolean {
    if (!this.armed) return false;
    const step = this.lastAt ? Math.min(Math.max(now - this.lastAt, 0), GATE_MAX_STEP_MS) : 0;
    this.lastAt = now;
    if (!paused) this.remainingMs -= step;
    if (this.remainingMs > 0) return false;
    this.armed = false;
    return true;
  }

  private armed = false;
  private remainingMs = 0;
  private lastAt = 0;
  private armedAt = 0;
}
