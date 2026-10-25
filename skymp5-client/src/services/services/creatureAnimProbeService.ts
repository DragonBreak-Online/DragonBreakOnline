import { ClientListener, CombinedController, Sp } from "./clientListener";
import { Game } from "skyrimPlatform";
import { logTrace } from "../../logging";
import { isPolymorphRaceId } from "../../sync/beastRaceIds";
import { AnimProbe } from "./creatureAnimProbe";

const PLAYER_ID = 0x14;
// The race is read here, not in the hook: natives throw in a hook context
const CHECK_EVERY_MS = 500;
// A long session in one body still reports, rather than losing everything if the game ends while polymorphed
const REPORT_EVERY = 300;

// Records which animation events the player emits while in a polymorph body, and whether the graph reacted
// (SendAnimationEventHook's animationSucceeded). It summarises; see creatureAnimProbe.ts for why it must never
// note per event. Always on, because the measurement has to happen in an ordinary session rather than a special one.
export class CreatureAnimProbeService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    // Only the player's own events, and only pure bookkeeping inside the hook
    this.sp.hooks.sendAnimationEvent.add({
      enter: () => { },
      leave: (ctx) => {
        if (!this.inBody) return;
        try {
          this.probe.add(ctx.animEventName, !!ctx.animationSucceeded);
          if (this.probe.events - this.reportedAt >= REPORT_EVERY) { this.reportedAt = this.probe.events; this.pending = true; }
        } catch { /* a probe must never break the animation it is watching */ }
      },
    }, PLAYER_ID, PLAYER_ID);
    this.controller.on("update", () => this.check());
  }

  private check(): void {
    // A report queued by the hook is sent from update, where the diagnostic channel is safe to touch
    if (this.pending) { this.pending = false; this.report("still in the body"); }
    const now = Date.now();
    if (now - this.checkedAt < CHECK_EVERY_MS) return;
    this.checkedAt = now;
    let raceId = 0;
    try {
      const player = Game.getPlayer();
      const race = player ? player.getRace() : null;
      raceId = race ? race.getFormID() >>> 0 : 0;
    } catch (e) {
      return;
    }
    const inBody = isPolymorphRaceId(raceId);
    if (inBody && this.bodyRace !== raceId) {
      this.bodyRace = raceId;
      this.inBody = true;
      this.probe.reset();
      this.reportedAt = 0;
    } else if (!inBody && this.inBody) {
      this.report("left the body");
      this.inBody = false;
      this.bodyRace = 0;
    }
  }

  private report(why: string): void {
    if (!this.probe.events) {
      this.note(`${this.bodyRace.toString(16)}: no animation events at all while in the body (${why})`);
      return;
    }
    const line = `${this.probe.summary(this.bodyRace.toString(16))} | ${why}`;
    logTrace(this, "Creature animation probe", line);
    this.note(line);
  }

  private note(text: string): void {
    const n = (globalThis as { __dboDiagNote?: (kind: string, text: string) => void }).__dboDiagNote;
    try { if (typeof n === "function") n("creatureAnim", text); } catch { /* diagnostics only */ }
  }

  private probe = new AnimProbe();
  private inBody = false;
  private bodyRace = 0;
  private checkedAt = 0;
  private reportedAt = 0;
  private pending = false;
}
