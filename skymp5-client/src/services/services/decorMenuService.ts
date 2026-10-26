import { ClientListener, CombinedController, Sp } from "./clientListener";
import { sendCustomPacket } from "./customPacketUtil";
import { readMenuKeyCode, isMenuKeyPressBlocked } from "./widgetMenuUtil";
import { buttonKeyCode } from "./mouseKeys";
import { ButtonEvent, DxScanCode } from "skyrimPlatform";
import { logTrace } from "../../logging";

/**
 * The home decorating panel (default G). The panel is the server's (decor.js): this asks for it, and the server opens
 * the decor widget inside a home the player may decorate, or says in chat why not.
 *
 *   Client -> Server: dbo "decorOpen"  (the server answers with the decor widget, id 171)
 */
export class DecorMenuService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("buttonEvent", (e) => this.onButtonEvent(e));
    this.menuKey = readMenuKeyCode(this.sp, "decorMenuKeyCode", DxScanCode.G);
  }

  private onButtonEvent(e: ButtonEvent): void {
    const code = buttonKeyCode(e);
    if (code === null || code !== this.menuKey || !e.isDown) return;
    if (isMenuKeyPressBlocked(this.sp, this.controller, e)) return;
    logTrace(this, `Requesting the decorating panel`);
    sendCustomPacket(this.controller, { customPacketType: "dbo", event: "decorOpen", args: [], widget: 0 });
  }

  private menuKey: number = DxScanCode.G;
}
