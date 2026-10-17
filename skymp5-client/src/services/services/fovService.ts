import { ClientListener, CombinedController, Sp } from "./clientListener";
import { logError, logTrace } from "../../logging";
import { FovCamera, FovPair, FovSp, describeFov, fovMatches, fovMoved, pickFovCamera } from "./fovCamera";

// Both halves of field of view. Skyrim keeps them apart and RaceMenu moves the first person one.
const WORLD_FOV = "fDefaultWorldFOV:Display";
const FIRST_FOV = "fDefault1stPersonFOV:Display";
// Anything outside this is not a field of view the player chose
const FOV_MIN = 50, FOV_MAX = 140;
// The character creator's close-up settles a moment after the menu closes; re-apply after it has
const AFTER_MENU_S = 0.5;
// A second pass once the spawned world has settled, in case anything set the camera again after the load
const AFTER_LOAD_S = 2;
// Checks after a load: a camera found off the player's value is set again and the server log says what it held
const GUARD_S = [5, 15, 30];

const note = (text: string): void => {
  const n = (globalThis as { __dboDiagNote?: (kind: string, text: string) => void }).__dboDiagNote;
  try { if (typeof n === "function") n("fov", text); } catch { /* diagnostics only */ }
};

const sane = (v: number): boolean => Number.isFinite(v) && v >= FOV_MIN && v <= FOV_MAX;

// The launcher writes the pair into the profile Skyrim.ini [Display], but the ini only seeds the camera at game start.
// Every spawn loads a save built from SkyrimPlatform's template.ess, whose camera holds 65/65, and RaceMenu leaves a close-up.
// So the pair is read once at startup and written into PlayerCamera itself through SkyrimPlatform's setCameraFov.
export class FovService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.once("update", () => this.readConfigured());
    // Native calls from an event handler can refuse to run in that context, so the load hands over to the next frame
    this.controller.on("loadGame", () => this.controller.once("update", () => {
      this.apply("the game loaded");
      this.later(AFTER_LOAD_S, "the world settled");
      for (const s of GUARD_S) this.sp.Utility.wait(s).then(() => this.controller.once("update", () => this.guard(s)));
    }));
    this.controller.on("menuClose", (e) => {
      if (e.name !== "RaceSex Menu") return;
      this.later(AFTER_MENU_S, "the creator closed");
    });
  }

  private later(seconds: number, why: string): void {
    this.sp.Utility.wait(seconds).then(() => this.controller.once("update", () => this.apply(why)));
  }

  // The launcher's value, or whatever the ini holds, captured before a menu can move it
  private readConfigured(): void {
    try {
      const world = this.sp.Utility.getINIFloat(WORLD_FOV);
      const first = this.sp.Utility.getINIFloat(FIRST_FOV);
      if (sane(world)) this.world = world;
      if (sane(first)) this.first = first;
      logTrace(this, "Field of view configured as", `world ${this.world ?? "unset"}`, `first person ${this.first ?? "unset"}`);
      note(`configured world ${this.world ?? "unset"} first ${this.first ?? "unset"} (ini read ${world} / ${first}), camera setter ${this.camera().kind}`);
    } catch (e) {
      logError(this, "could not read the configured field of view", e);
    }
  }

  private apply(why: string): void {
    if (this.world === null && this.first === null) return;
    // The creator's own close-up is left alone; its menuClose applies the pair
    if (this.creatorOpen()) return;
    try {
      if (this.world !== null) this.sp.Utility.setINIFloat(WORLD_FOV, this.world);
      if (this.first !== null) this.sp.Utility.setINIFloat(FIRST_FOV, this.first);
    } catch (e) {
      logError(this, "could not restore the field of view setting", e);
    }
    const cam = this.camera();
    let was: FovPair, now: FovPair;
    try {
      was = cam.read();
      cam.write(this.world, this.first);
      now = cam.read();
    } catch (e) {
      if (!this.cameraFailed) logError(this, "could not set the camera field of view", e);
      this.cameraFailed = true;
      note(`camera ${cam.kind} failed (${why}), ini only`);
      this.rebuildCamera();
      return;
    }
    const took = fovMatches(now, this.world, this.first);
    logTrace(this, "Field of view applied", why, cam.kind, `was ${describeFov(was)}`, `now ${describeFov(now)}`);
    note(`${took ? "applied" : "NOT applied"} via ${cam.kind} (${why}): camera was ${describeFov(was)}, now ${describeFov(now)}, wanted world ${this.world ?? "unset"} first ${this.first ?? "unset"}`);
  }

  // The camera set back to the player's value when anything moved it after the load
  private guard(seconds: number): void {
    if (this.world === null && this.first === null) return;
    if (this.creatorOpen()) return;
    let have: FovPair;
    try {
      have = this.camera().read();
    } catch (e) {
      return;
    }
    if (!fovMoved(have.world, this.world) && !fovMoved(have.first, this.first)) return;
    note(`moved after the load (+${seconds} s): camera ${describeFov(have)}, set back`);
    this.apply(`guard +${seconds} s`);
  }

  private creatorOpen(): boolean {
    try { return this.sp.Ui.isMenuOpen("RaceSex Menu"); } catch (e) { return false; }
  }

  private camera(): FovCamera {
    if (!this.cam) this.cam = pickFovCamera(this.sp as unknown as FovSp);
    return this.cam;
  }

  // Fallback when the camera write throws. Camera state 0 is first person; only a player already there is bounced.
  private rebuildCamera(): void {
    try {
      if (this.sp.Game.getCameraState() !== 0) return;
      this.sp.Game.forceThirdPerson();
      this.sp.Utility.wait(0.1).then(() => {
        try { this.sp.Game.forceFirstPerson(); } catch (e) { logError(this, "could not return to first person", e); }
      });
    } catch (e) {
      logError(this, "could not rebuild the camera", e);
    }
  }

  private world: number | null = null;
  private first: number | null = null;
  private cameraFailed = false;
  private cam: FovCamera | null = null;
}
