// Seconds of live game since login, counted in JS from 'update' frames, so a save load cannot drop it as it can a Utility.wait
// Only frames with the player's 3D loaded count, each at most FRAME_CAP_MS; after NOT_LIVE_GIVE_UP_MS of other frames it counts anyway

// Seconds after spawn at which the server's spell list is re-imposed, because the engine grants the race defaults late
export const SPELL_ENFORCE_PASSES = [1, 3, 6, 10, 15, 20];

export const FRAME_CAP_MS = 250;
export const NOT_LIVE_GIVE_UP_MS = 30000;

interface Timer {
  at: number;
  seq: number;
  fn: () => void;
}

export class LoginClock {
  private elapsedMs = 0;
  private lastFrameAt: number | null = null;
  private notLiveMs = 0;
  private lastNotLiveAt: number | null = null;
  private timers: Timer[] = [];
  private seq = 0;

  public onError: (err: unknown) => void = () => { };

  // One 'update' frame. live: the player is in the world with its 3D loaded
  public frame(nowMs: number, live: boolean): void {
    if (live) {
      this.notLiveMs = 0;
      this.lastNotLiveAt = null;
    } else {
      if (this.lastNotLiveAt !== null) this.notLiveMs += this.step(nowMs - this.lastNotLiveAt);
      this.lastNotLiveAt = nowMs;
      if (this.notLiveMs < NOT_LIVE_GIVE_UP_MS) {
        this.lastFrameAt = null;
        return;
      }
    }
    if (this.lastFrameAt !== null) this.elapsedMs += this.step(nowMs - this.lastFrameAt);
    this.lastFrameAt = nowMs;
    this.runDue();
  }

  public now(): number {
    return this.elapsedMs;
  }

  // Calls fn once `seconds` of live game have gone by; returns a function that cancels it
  public after(seconds: number, fn: () => void): () => void {
    const timer: Timer = { at: this.elapsedMs + Math.max(0, Number(seconds) || 0) * 1000, seq: this.seq++, fn };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((t) => t !== timer);
    };
  }

  public pending(): number {
    return this.timers.length;
  }

  private step(deltaMs: number): number {
    return Math.max(0, Math.min(FRAME_CAP_MS, deltaMs));
  }

  // Due timers in the order they fall due (then the order they were set); one that throws does not stop the rest
  private runDue(): void {
    for (; ;) {
      let next = -1;
      for (let i = 0; i < this.timers.length; i++) {
        const t = this.timers[i];
        if (t.at > this.elapsedMs) continue;
        if (next < 0 || t.at < this.timers[next].at || (t.at === this.timers[next].at && t.seq < this.timers[next].seq)) next = i;
      }
      if (next < 0) return;
      const [timer] = this.timers.splice(next, 1);
      try {
        timer.fn();
      } catch (e) {
        try { this.onError(e); } catch { /* logging only */ }
      }
    }
  }
}

// The one clock the login steps share, so the favourites restore always runs after the last spell pass
export const loginClock = new LoginClock();
