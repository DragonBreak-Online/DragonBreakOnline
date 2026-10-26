import { ClientListener, CombinedController, Sp } from "./clientListener";
import { logError } from "../../logging";

// While a native panel is open, the HUD's crosshair shows through its translucent ground at the centre of the screen, and
// reads as a logo behind the panel (Nat, 26 Oct). It is faded to a faint watermark for as long as the panel is up and
// given back its own alpha after. The path is vanilla hudmenu.swf's (read only): _root.HUDMovieBaseInstance.Crosshair.
export const HUD_MENU = "HUD Menu";
export const CROSSHAIR_ALPHA = "_root.HUDMovieBaseInstance.Crosshair._alpha";
export const PANEL_MENU = "CustomMenu";
export const FADED_ALPHA = 12;
const POLL_MS = 150;

export class NativeBackdropService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("update", () => this.onUpdate());
  }

  private onUpdate(): void {
    const now = Date.now();
    if (now - this.lastPoll < POLL_MS) return;
    this.lastPoll = now;
    try {
      const open = this.sp.Ui.isMenuOpen(PANEL_MENU);
      if (open && this.saved === null) {
        const a = this.sp.Ui.getFloat(HUD_MENU, CROSSHAIR_ALPHA);
        this.saved = a > FADED_ALPHA ? a : 100;
        this.sp.Ui.setFloat(HUD_MENU, CROSSHAIR_ALPHA, FADED_ALPHA);
      } else if (!open && this.saved !== null) {
        this.sp.Ui.setFloat(HUD_MENU, CROSSHAIR_ALPHA, this.saved);
        this.saved = null;
      }
    } catch (e) {
      logError(this, "crosshair fade failed", e);
    }
  }

  private lastPoll = 0;
  private saved: number | null = null;
}
