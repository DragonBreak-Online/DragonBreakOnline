import { ClientListener, CombinedController, Sp } from "./clientListener";
import { Game, HitEvent } from "skyrimPlatform";
import { logError, logTrace } from "../../logging";
import { isPolymorphRaceId } from "../../sync/beastRaceIds";
import { GuardLog, GuardTally, HIT_WINDOW_MS, planFor } from "./creatureCombat";

const PLAYER_ID = 0x14;
// The race is read here, not in the hook: natives throw in a hook context
const CHECK_EVERY_MS = 500;
// A long session in one body still reports rather than losing everything
const REPORT_EVERY = 60;

// TEST-CLIENT guard for the 25 Oct crash: a draw in a creature body ran the humanoid weapon path and killed the
// game. This rewrites the event before the engine's handler sees it and records whether that worked, because the
// measurement and the guard cannot be separated - pressing the button is the crash. See creatureCombat.ts.
export class CreatureInputGuardService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.sp.hooks.sendAnimationEvent.add({
      // enter: the rewrite has to happen BEFORE the engine's handler runs
      enter: (ctx) => {
        if (!this.inBody) return;
        try {
          const plan = planFor(this.bodyRace, ctx.animEventName);
          if (!plan) return;
          const from = ctx.animEventName;
          const t = this.guard.record(plan, from);
          ctx.animEventName = plan.to;
          // leave() needs the tally this event belongs to, to credit animationSucceeded to it
          this.lastTally = t;
          this.pendingAttack = t && plan.kind === "attack" ? { tally: t, at: Date.now() } : null;
          this.touched++;
        } catch { /* a guard must never throw into the animation it is guarding */ }
      },
      // leave: did the graph accept what we put there
      leave: (ctx) => {
        if (!this.inBody || !this.lastTally) return;
        try {
          if (ctx.animationSucceeded) this.lastTally.ok++; else this.lastTally.failed++;
          this.lastTally = null;
          if (this.touched - this.reportedAt >= REPORT_EVERY) { this.reportedAt = this.touched; this.pending = true; }
        } catch { /* diagnostics only */ }
      },
    }, PLAYER_ID, PLAYER_ID);
    // A hit soon after a rewritten attack is the answer to "does her own event actually strike"
    this.controller.on("hit", (e) => this.onHit(e));
    this.controller.on("update", () => this.check());
  }

  private onHit(e: HitEvent): void {
    if (!this.inBody || !this.pendingAttack) return;
    try {
      const agg = e.aggressor ? e.aggressor.getFormID() >>> 0 : 0;
      if (agg !== PLAYER_ID) return;
      if (Date.now() - this.pendingAttack.at > HIT_WINDOW_MS) { this.pendingAttack = null; return; }
      this.pendingAttack.tally.hits++;
      this.pendingAttack = null;
    } catch { /* diagnostics only */ }
  }

  private check(): void {
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
      this.guard.reset();
      this.touched = 0;
      this.reportedAt = 0;
      this.onEnter();
    } else if (!inBody && this.inBody) {
      this.report("left the body");
      this.inBody = false;
      this.bodyRace = 0;
      this.onLeave();
    }
  }

  // Sheathe so the player never starts drawn, and the config fallback if the rewrite turns out not to be enough
  private onEnter(): void {
    try {
      const player = Game.getPlayer();
      if (player) player.sheatheWeapon();
    } catch (e) {
      logError(this, "could not sheathe on entering a creature body", e);
    }
    if (!this.fallback()) return;
    try {
      // fighting only: movement, looking and activate are left alone. It costs the claws, which is why it is a
      // flag rather than the default - but a permanent body that crashes on a keypress is worse.
      Game.disablePlayerControls(false, true, false, false, false, false, false, false, 0);
      this.disabled = true;
      this.note("fallback: fighting controls disabled by config");
    } catch (e) {
      logError(this, "could not disable fighting controls", e);
    }
  }

  private onLeave(): void {
    if (!this.disabled) return;
    this.disabled = false;
    try {
      Game.enablePlayerControls(false, true, false, false, false, false, false, false, 0);
    } catch (e) {
      logError(this, "could not restore fighting controls", e);
    }
  }

  // sp.settings["skymp5-client"]["creatureGuard"].fallbackDisableFighting - flipped without a rebuild
  private fallback(): boolean {
    try {
      const all = this.sp.settings["skymp5-client"] as Record<string, unknown> | undefined;
      const cfg = all ? (all["creatureGuard"] as Record<string, unknown> | undefined) : undefined;
      return !!(cfg && cfg["fallbackDisableFighting"]);
    } catch (e) {
      return false;
    }
  }

  private report(why: string): void {
    const line = `${this.guard.summary(this.bodyRace.toString(16))} | ${why}`;
    logTrace(this, "Creature input guard", line);
    this.note(line);
  }

  private note(text: string): void {
    const n = (globalThis as { __dboDiagNote?: (kind: string, text: string) => void }).__dboDiagNote;
    try { if (typeof n === "function") n("creatureGuard", text); } catch { /* diagnostics only */ }
  }

  private guard = new GuardLog();
  private inBody = false;
  private bodyRace = 0;
  private checkedAt = 0;
  private touched = 0;
  private reportedAt = 0;
  private pending = false;
  private disabled = false;
  private lastTally: GuardTally | null = null;
  private pendingAttack: { tally: GuardTally; at: number } | null = null;
}
