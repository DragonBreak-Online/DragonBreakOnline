import { ClientListener, CombinedController, Sp } from "./clientListener";
import { logTrace } from "../../logging";
import { ButtonEvent, Menu } from "skyrimPlatform";
import { AFTER_LOAD_CHECKS_MS, MoveSample, MOVING_SPEED, DECAY_RATIO, isMinigameWidget, shouldClearAfterLoad, shouldClearAutoMove, stillPlausible } from "./autoMoveClear";

// Auto-move (auto-run) keeps the player walking with no key held. When a mini-game widget takes the keyboard the
// player cannot stop, so they drift through the round and often out of range of the station. This switches it off
// with the player's own Auto-Move key when such a widget opens focused. autoMoveClear.ts holds the decision and
// says why two samples are needed; this only gathers them and taps.
const SAMPLE_GAP_MS = 250;
// Three, not the two the rule needs: a player arrives at these games mid-stop, and a third reading over 500 ms gives a
// slow decay room to show itself (Worker D's review, 2026-09-30)
const SAMPLES = 3;
const LOG_NAME = "dbo-diag";
// Movement controls as controlmap.txt names them, so a player who remapped WASD is read by their own keys
const MOVE_CONTROLS = ["Forward", "Back", "Strafe Left", "Strafe Right"];
// Menus that mean the player is not walking under their own control (inputDiagService's list, less the HUD's)
const BUSY_MENUS: Menu[] = [Menu.Cursor, Menu.Loading, Menu.Fader, Menu.Main, Menu.Mist, Menu.Console, Menu.Tween,
  Menu.MessageBox, Menu.RaceSex, Menu.Dialogue, Menu.Journal, Menu.Inventory, Menu.Map];

export class AutoMoveService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    // A loading screen or the fader (the temple wake after a death, a fast travel, a door) can lose a key release
    this.controller.on("menuClose", (e) => { if (e.name === Menu.Loading || e.name === Menu.Fader) this.onLoaded(); });
    this.controller.on("buttonEvent", (e) => this.onButtonEvent(e));
    this.controller.on("thumbstickEvent", (e) => { if (e.isLeft && Math.hypot(e.inputX, e.inputY) > 0.2) this.stickAt = Date.now(); });
  }

  private onButtonEvent(e: ButtonEvent): void {
    if (!e.isDown) return;
    try { if (e.code === this.sp.Input.getMappedKey("Auto-Move", e.device)) this.autoMoveKeyAt = Date.now(); } catch (e2) { /* unmapped */ }
  }

  // Looks three times after each load; a newer load restarts the schedule
  private onLoaded(): void {
    const load = ++this.loadSeq;
    this.loadedAt = Date.now();
    for (const ms of AFTER_LOAD_CHECKS_MS) this.wait(this.loadedAt + ms, () => { if (load === this.loadSeq) this.checkAfterLoad(load, ms); });
  }

  private checkAfterLoad(load: number, ms: number): void {
    if (this.busy) return;
    this.busy = true;
    this.samples = [];
    const step = (): void => {
      if (load !== this.loadSeq) { this.busy = false; return; }
      const s = this.sample();
      if (!s) { this.busy = false; return; }
      this.samples.push(s);
      if (!stillPlausible(this.samples)) { this.busy = false; return; }
      if (this.samples.length < SAMPLES) { this.wait(Date.now() + SAMPLE_GAP_MS, step); return; }
      const tap = shouldClearAfterLoad(this.samples, this.afterLoadState());
      if (tap) this.tapForward();
      this.report(`after load +${ms / 1000}s`, tap ? "tapped Forward" : "no tap");
      this.busy = false;
    };
    step();
  }

  private afterLoadState() {
    const sp = this.sp;
    let menuOpen = false, mounted = false, controlsLocked = false;
    try { menuOpen = sp.browser.isFocused() || BUSY_MENUS.some((m) => sp.Ui.isMenuOpen(m)); } catch (e) { menuOpen = true; }
    try { mounted = !!sp.Game.getPlayer()?.isOnMount(); } catch (e) { mounted = true; }
    try { controlsLocked = !sp.Game.isMovementControlsEnabled(); } catch (e) { controlsLocked = true; }
    return { autoMoveKeySinceLoad: this.autoMoveKeyAt >= this.loadedAt, menuOpen, mounted, controlsLocked, stickMoving: Date.now() - this.stickAt < 1000 };
  }

  // Forward ends auto-move and releases a movement the game still thinks is held; it never starts anything
  private tapForward(): void {
    try {
      const code = this.sp.Input.getMappedKey("Forward", 0);
      if (code > 0) this.sp.Input.tapKey(code);
      else logTrace(this, "Forward is not mapped, nothing to tap");
    } catch (e) {
      logTrace(this, `tapping Forward failed: ${e}`);
    }
  }

  // Called by dboRelayService when a widget opens with focus
  public onFocusedWidget(widgetType: unknown): void {
    if (this.busy || !isMinigameWidget(widgetType)) return;
    this.busy = true;
    this.samples = [];
    this.take(String(widgetType));
  }

  private take(widgetType: string): void {
    const s = this.sample();
    if (!s) { this.busy = false; return; }
    this.samples.push(s);
    // The moment the run cannot end in a tap, stop: no need to wait on a player standing still, holding a key or slowing
    if (!stillPlausible(this.samples)) { this.finish(widgetType, false); return; }
    if (this.samples.length >= SAMPLES) {
      this.finish(widgetType, shouldClearAutoMove(widgetType, this.samples));
      return;
    }
    this.wait(Date.now() + SAMPLE_GAP_MS, () => this.take(widgetType));
  }

  private finish(widgetType: string, tap: boolean): void {
    if (tap) this.tap();
    this.report(widgetType, tap ? "tapped Auto-Move" : "no tap");
    this.busy = false;
  }

  private wait(until: number, then: () => void): void {
    this.controller.once("update", () => {
      if (Date.now() >= until) { then(); return; }
      this.wait(until, then);
    });
  }

  private sample(): MoveSample | null {
    try {
      const pc = this.sp.Game.getPlayer();
      if (!pc) return null;
      return {
        speed: Number(pc.getAnimationVariableFloat("SpeedSampled")) || 0,
        movementKeyHeld: this.anyMoveKeyHeld(),
        airborne: pc.getAnimationVariableBool("bInJumpState") === true,
      };
    } catch (e) {
      logTrace(this, `reading the player failed: ${e}`);
      return null;
    }
  }

  private anyMoveKeyHeld(): boolean {
    for (const control of MOVE_CONTROLS) {
      try {
        const code = this.sp.Input.getMappedKey(control, 0);
        if (code > 0 && this.sp.Input.isKeyPressed(code)) return true;
      } catch (e) { /* an unmapped control is not a held key */ }
    }
    return false;
  }

  private tap(): void {
    try {
      const code = this.sp.Input.getMappedKey("Auto-Move", 0);
      if (code > 0) this.sp.Input.tapKey(code);
      else logTrace(this, "Auto-Move is not mapped, nothing to tap");
    } catch (e) {
      logTrace(this, `tapping Auto-Move failed: ${e}`);
    }
  }

  // Every decision is logged, tap or not, so the in-game check can tell a working clear from one that never fired
  private report(widgetType: string, what: string): void {
    const seen = this.samples
      .map((s) => `[spd ${Math.round(s.speed)} key ${s.movementKeyHeld ? "Y" : "n"} air ${s.airborne ? "Y" : "n"}]`)
      .join(" ");
    const line = `autoMove ${widgetType}: ${what} (over ${MOVING_SPEED}, holding ${DECAY_RATIO}) ${seen}`;
    logTrace(this, line);
    try { const note = (globalThis as { __dboDiagNote?: (k: string, t: string) => void }).__dboDiagNote; if (typeof note === "function" && what !== "no tap") note("autoMove", line); } catch (e) { /* diagnostics only */ }
    try {
      (this.sp as unknown as { writeLogs: (plugin: string, ...rest: unknown[]) => void }).writeLogs(LOG_NAME, line);
    } catch (e) {
      // An older SkyrimPlatform without writeLogs: the console still has it
    }
  }

  private busy = false;
  private samples: MoveSample[] = [];
  private loadSeq = 0;
  private loadedAt = 0;
  private autoMoveKeyAt = 0;
  private stickAt = 0;
}
