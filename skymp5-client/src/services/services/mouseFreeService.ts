import { ClientListener, Sp, CombinedController } from "./clientListener";
import { logError } from "../../logging";

// The mouse may leave the game window while chat or a DragonBreak panel has the browser focus, so a player on two
// monitors needs no alt-tab (Nat, 19 Oct). SkyrimPlatform's setMouseFree switches Skyrim's own mouse device between
// exclusive (held, as in play) and background mode, and while free puts the game's menu cursor under the Windows
// cursor. Applied whenever the wanted state differs, and again after every game load, so an INI left at
// bBackgroundMouse=1 can never free the mouse during play. A DLL without setMouseFree changes nothing
interface MouseSp {
  setMouseFree?: (free: boolean) => boolean;
  isMouseFree?: () => boolean;
}

export class MouseFreeService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("update", () => this.onUpdate());
    this.controller.on("loadGame", () => { this.applied = null; });
  }

  private onUpdate() {
    const mouseSp = this.sp as unknown as MouseSp;
    if (typeof mouseSp.setMouseFree !== "function") {
      return;
    }
    let want = false;
    try { want = this.sp.browser.isFocused(); } catch { want = false; }
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

  private applied: boolean | null = null;
}
