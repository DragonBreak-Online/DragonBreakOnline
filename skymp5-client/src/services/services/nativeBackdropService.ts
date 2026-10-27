import { ClientListener, CombinedController, Sp } from "./clientListener";
import { logError } from "../../logging";

// While a native panel (CustomMenu) is open, what is behind and over it is quietened (Nat, 26 Oct):
// - the browser is hidden, as browserService hides it for the vanilla menus. It draws over every Scaleform menu, so the
//   chat and the HUD's hourglass watermark sat on top of the panel (the map probe's screenshot). It comes back after,
//   if this hid it;
// - the HUD crosshair shows through the panel's translucent ground at the centre of the screen. It is faded to a faint
//   watermark and given back its own alpha after. The path is vanilla hudmenu.swf's (read only):
//   _root.HUDMovieBaseInstance.Crosshair.
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
      // Re-asserted while open: another service may show the browser meanwhile (a HUD refresh)
      if (open && this.sp.browser.isVisible()) {
        this.sp.browser.setVisible(false);
        this.hidBrowser = true;
      } else if (!open && this.hidBrowser) {
        this.hidBrowser = false;
        this.sp.browser.setVisible(true);
      }
    } catch (e) {
      logError(this, "native backdrop failed", e);
    }
  }

  private lastPoll = 0;
  private saved: number | null = null;
  private hidBrowser = false;
}
