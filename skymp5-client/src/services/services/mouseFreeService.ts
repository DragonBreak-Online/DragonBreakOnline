import { ClientListener, Sp, CombinedController } from "./clientListener";
import { logError } from "../../logging";
import { BrowserMessageEvent } from "skyrimPlatform";

// The mouse may leave the game window while chat or a DragonBreak panel has the browser focus, so a player on two
// monitors needs no alt-tab (Nat, 19 Oct). SkyrimPlatform's setMouseFree switches Skyrim's own mouse device between
// exclusive (held, as in play) and background mode, and while free puts the game's menu cursor under the Windows
// cursor. Applied whenever the wanted state differs, and again after every game load, so an INI left at
// bBackgroundMouse=1 can never free the mouse during play. A DLL without setMouseFree changes nothing.
// Off unless the player turns it on (F3, Settings, Mouse; ui.mouseLeavesWindow): always on in 0.3.105, it tabbed
// players with a second monitor out of the game when a click landed there (Discord, 19 Oct).
interface MouseSp {
  setMouseFree?: (free: boolean) => boolean;
  isMouseFree?: () => boolean;
}

const MOUSE_MESSAGE = "dbo:mouse";
const SETTINGS_PLUGIN = "chat-settings-no-load";

export class MouseFreeService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.enabled = this.readSaved();
    this.controller.on("update", () => this.onUpdate());
    this.controller.on("loadGame", () => { this.applied = null; });
    this.controller.on("browserMessage", (e) => this.onBrowserMessage(e));
  }

  // The F3 choice; the page writes the settings file itself
  private onBrowserMessage(e: BrowserMessageEvent): void {
    if (e.arguments[0] !== MOUSE_MESSAGE || e.arguments[1] !== "set") return;
    this.enabled = e.arguments[2] === "on";
  }

  private onUpdate() {
    const mouseSp = this.sp as unknown as MouseSp;
    if (typeof mouseSp.setMouseFree !== "function") {
      return;
    }
    let want = false;
    try { want = this.enabled && this.sp.browser.isFocused(); } catch { want = false; }
    if (want === this.applied) {
      return;
    }
    try {
      if (mouseSp.setMouseFree(want)) {
        this.applied = want;
      }
    } catch (e) {
      this.applied = want; // no retry every frame on a throwing DLL
      logError(this, `setMouseFree(${want}) threw: ${String(e).slice(0, 160)}`);
    }
  }

  // ui.mouseLeavesWindow from the F3 settings file
  private readSaved(): boolean {
    try {
      // @ts-expect-error (TODO: Remove in 2.10.0)
      const data = this.sp.getPluginSourceCode(SETTINGS_PLUGIN, "PluginsNoLoad");
      if (!data) return false;
      const parsed = JSON.parse(data.slice(2));
      return !!(parsed && parsed.ui && parsed.ui.mouseLeavesWindow === true);
    } catch (e) {
      return false;
    }
  }

  private enabled = false;

  private applied: boolean | null = null;
}
