import { ClientListener, CombinedController, Sp } from "./clientListener";
import { logError, logTrace } from "../../logging";
import { BrowserMessageEvent } from "skyrimPlatform";
import { FOV_MAX, FOV_MIN, FovCamera, FovPair, FovSp, SavedFov, chooseFov, describeFov, fovMatches, fovMoved, pickFovCamera, readSavedFov, saneFov } from "./fovCamera";

// Both halves of field of view. Skyrim keeps them apart and RaceMenu moves the first person one.
const WORLD_FOV = "fDefaultWorldFOV:Display";
const FIRST_FOV = "fDefault1stPersonFOV:Display";
// The character creator's close-up settles a moment after the menu closes; re-apply after it has
const AFTER_MENU_S = 0.5;
// A second pass once the spawned world has settled, in case anything set the camera again after the load
const AFTER_LOAD_S = 2;
// Checks after a load: a camera found off the player's value is set again and the server log says what it held
const GUARD_S = [5, 15, 30];
// F3, Settings, Camera: the page sends "dbo:fov" with "set" <value>, "reset" or "query", and is answered in window.__dboFov
const FOV_MESSAGE = "dbo:fov";
// The slider writes the camera on every step; the person bounce and the log line wait until it has rested this long
const SLIDER_REST_S = 0.5;
// The SKSE route cannot read the camera back, so it bounces between persons to rebuild it; at most once in this long
const BOUNCE_EVERY_MS = 3000;
// Where chatService keeps the F3 settings
const SETTINGS_PLUGIN = "chat-settings-no-load";

const note = (text: string): void => {
  const n = (globalThis as { __dboDiagNote?: (kind: string, text: string) => void }).__dboDiagNote;
  try { if (typeof n === "function") n("fov", text); } catch { /* diagnostics only */ }
};


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
    this.controller.on("browserMessage", (e) => this.onBrowserMessage(e));
  }

  // The F3 slider: each step goes to the camera at once; the saved file is the page's to write (ui.fov)
  private onBrowserMessage(e: BrowserMessageEvent): void {
    if (e.arguments[0] !== FOV_MESSAGE) return;
    const what = String(e.arguments[1] ?? "");
    if (what === "set") {
      const v = Number(e.arguments[2]);
      if (!saneFov(v)) return;
      this.world = this.first = Math.round(v);
      this.apply("the slider", false);
      const token = ++this.sliderToken;
      this.later(SLIDER_REST_S, "the slider rested", () => token === this.sliderToken);
    } else if (what === "reset") {
      this.world = this.launcherWorld;
      this.first = this.launcherFirst;
      ++this.sliderToken;
      this.apply("reset to the launcher's value");
      this.tellPage();
    } else if (what === "query") {
      this.tellPage();
    }
  }

  private tellPage(): void {
    const state = { value: this.world, launcher: this.launcherWorld, camera: this.camera().kind, min: FOV_MIN, max: FOV_MAX };
    try {
      this.sp.browser.executeJavaScript(`window.__dboFov = ${JSON.stringify(state)}; window.dispatchEvent(new CustomEvent('dbo:fov'));`);
    } catch (e) {
      logError(this, "could not tell the page the field of view", e);
    }
  }

  // ui.fov from the F3 settings file, or null
  private readSaved(): SavedFov | null {
    try {
      // @ts-expect-error (TODO: Remove in 2.10.0)
      const data = this.sp.getPluginSourceCode(SETTINGS_PLUGIN, "PluginsNoLoad");
      if (!data) return null;
      const parsed = JSON.parse(data.slice(2));
      return readSavedFov(parsed && parsed.ui ? parsed.ui.fov : null);
    } catch (e) {
      return null;
    }
  }

  private later(seconds: number, why: string, still: () => boolean = () => true): void {
    this.sp.Utility.wait(seconds).then(() => this.controller.once("update", () => { if (still()) this.apply(why); }));
  }

  // The launcher's value, or whatever the ini holds, captured before a menu can move it; a choice saved in F3 wins
  private readConfigured(): void {
    try {
      const world = this.sp.Utility.getINIFloat(WORLD_FOV);
      const first = this.sp.Utility.getINIFloat(FIRST_FOV);
      if (saneFov(world)) this.launcherWorld = this.world = world;
      if (saneFov(first)) this.launcherFirst = this.first = first;
      const saved = this.readSaved();
      const pick = chooseFov(this.launcherWorld, saved);
      // The slider sets both halves to one value, as the launcher does
      if (pick.from === "saved") this.world = this.first = pick.value;
      logTrace(this, "Field of view configured as", `world ${this.world ?? "unset"}`, `first person ${this.first ?? "unset"}`, `from ${pick.from}`);
      note(`configured world ${this.world ?? "unset"} first ${this.first ?? "unset"} from ${pick.from} (ini read ${world} / ${first}, saved ${saved ? saved.value : "none"}), camera setter ${this.camera().kind}`);
    } catch (e) {
      logError(this, "could not read the configured field of view", e);
    }
  }

  // bounce: allow the SKSE route's person bounce (not on every slider step)
  private apply(why: string, bounce = true): void {
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
    // Only the SkyrimPlatform route reads back. The SKSE natives return nothing on every client (16-17 Oct logs), so
    // there the setting is also picked up the way the 26 Sep build did: a first person camera rebuilt by a bounce
    if (!took && cam.kind === "skse" && bounce && Date.now() - this.lastBounce > BOUNCE_EVERY_MS) {
      this.lastBounce = Date.now();
      this.rebuildCamera();
    }
    if (!bounce) return;
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

  private launcherWorld: number | null = null;
  private launcherFirst: number | null = null;
  private sliderToken = 0;
  private lastBounce = 0;
  private world: number | null = null;
  private first: number | null = null;
  private cameraFailed = false;
  private cam: FovCamera | null = null;
}
