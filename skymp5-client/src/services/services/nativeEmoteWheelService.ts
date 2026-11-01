import { ClientListener, CombinedController, Sp } from "./clientListener";
import { logError, logTrace } from "../../logging";
import { LoadState, loadStep, newLoad } from "./nativeHud";

// Loads Data\Interface\dbo_emotewheel.swf into a clip of the HUD Menu (as NativeHudService loads dbo_hud) and keeps it
// hidden until EmoteService opens the wheel; EmoteService decides what it shows (nativeEmoteWheel.ts). Until the swf says
// it is alive, or after it never does, EmoteService opens the browser wheel instead, as before.
export const HUD_MENU = "HUD Menu";
const HOST = "_root.dboEmoteWheel";
const SWF = "dbo_emotewheel.swf";

export class NativeEmoteWheelService extends ClientListener {
  private load: LoadState = newLoad();
  private last = "";
  private shown = false;

  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("update", () => this.onUpdate());
  }

  // Whether the native wheel can be opened now
  ready(): boolean { return this.load.phase === "up"; }

  show(json: string): void {
    this.draw(json);
    this.call("dboShow", "1");
    this.shown = true;
  }

  hide(): void {
    if (!this.shown) return;
    this.call("dboShow", "0");
    this.shown = false;
  }

  // The wheel's payload, sent only when it changed
  draw(json: string): void {
    if (json === this.last) return;
    if (this.call("dboData", json)) this.last = json;
  }

  private call(fn: string, arg: string): boolean {
    try { this.sp.Ui.invokeString(HUD_MENU, `${HOST}.${fn}`, arg); return true; } catch (e) { logError(this, `native emote wheel ${fn} failed`, e); return false; }
  }

  private onUpdate(): void {
    let hudOpen = false, alive = false;
    try { hudOpen = this.sp.Ui.isMenuOpen(HUD_MENU); alive = hudOpen && this.sp.Ui.getString(HUD_MENU, `${HOST}.dboAlive`) === "yes"; } catch { return; }
    const step = loadStep(this.load, hudOpen, alive);
    if (step === "inject") {
      try {
        this.sp.Ui.invokeStringA(HUD_MENU, "_root.createEmptyMovieClip", ["dboEmoteWheel", "9994"]);
        this.sp.Ui.invokeString(HUD_MENU, `${HOST}.loadMovie`, SWF);
        logTrace(this, "native emote wheel loading, try", String(this.load.tries));
      } catch (e) { logError(this, "native emote wheel could not be loaded", e); }
    } else if (step === "up") {
      this.last = ""; this.shown = false;
      logTrace(this, "native emote wheel up");
    } else if (step === "lost") {
      this.last = ""; this.shown = false;
      logTrace(this, "native emote wheel lost its clip; loading it again");
    } else if (step === "fail") {
      logTrace(this, "native emote wheel never came alive: the browser wheel keeps the job");
    }
  }
}
