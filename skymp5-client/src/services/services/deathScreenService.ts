import { ClientListener, CombinedController, Sp } from "./clientListener";
import { sendCustomPacket, parseCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { showUi } from "./widgetMenuUtil";
import { TimersService } from "./timersService";
import { BrowserMessageEvent } from "skyrimPlatform";
import { logTrace, logError } from "../../logging";
import { ScaleformMenuService } from "./scaleformMenuService";
import { CLOSE_KEY, FAILED_KEY } from "./nativeWidgets";

// Failsafe: if the server's hide packet never arrives, dismiss this long after the countdown so input returns.
const FAILSAFE_GRACE_MS = 15000;

// Death screen UI.
//
// Server → client custom packets:
//   { "customPacketType": "deathScreen", "show": true, "seconds": 60 }
//   { "customPacketType": "deathScreen", "hide": true }
//
// Client → server (on a confirmed choice):
//   { "customPacketType": "deathChoice", "choice": "permadeath"|"resurrect"|"temple" }
//
// The native panel (swf/dbo_death) draws it, sending death:choice [key]; the `death` widget of skymp5-front draws it when
// the panel cannot be (switched off, or failed this session). This service shows and hides it and relays the choice.
export class DeathScreenService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.on("browserMessage", (e) => this.onBrowserMessage(e));
    // The hide UI key drops focus; the buttons must be clickable again once shown
    this.controller.emitter.on("uiHiddenChanged", (e) => {
      if (!e.hidden && this.failsafeTimer !== undefined && !this.native) this.sp.browser.setFocused(true);
    });
  }

  private onCustomPacketMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content) {
      return;
    }
    if (content["customPacketType"] !== "deathScreen") {
      return;
    }
    if (content["hide"] === true) {
      this.hide();
    } else {
      const seconds = typeof content["seconds"] === "number" ? content["seconds"] : 60;
      this.show(seconds);
    }
  }

  private show(seconds: number): void {
    logTrace(this, `show death screen (${seconds}s)`);
    const s = Math.max(0, Math.floor(seconds));
    this.nonce++;
    this.native = this.openNative(s);
    if (!this.native) this.showBrowser(s);
    this.armFailsafe(s);
  }

  private openNative(seconds: number): boolean {
    try {
      return this.controller.lookupListener(ScaleformMenuService).openNative({
        type: "death", widget: { type: "death", seconds, nonce: this.nonce }, onKey: (key, args) => this.onNativeKey(key, args),
      });
    } catch (e) {
      logError(this, `the native death screen could not open: ${e}`);
      return false;
    }
  }

  private onNativeKey(key: string, args: unknown[]): void {
    if (key === "death:choice") { this.choose(String(args[0] ?? "")); return; }
    // The panel could not be drawn: the browser screen, with the time that is left
    if (key === FAILED_KEY && this.native && this.failsafeTimer !== undefined) {
      this.native = false;
      this.showBrowser(Math.max(0, Math.round((this.endsAt - Date.now()) / 1000)));
      return;
    }
    if (key === CLOSE_KEY) this.native = false;
  }

  private showBrowser(seconds: number): void {
    const js =
      "(function(){" +
      "if(!window.skyrimPlatform||!window.skyrimPlatform.widgets)return;" +
      "var send=function(key){if(window.skyrimPlatform.sendMessage)window.skyrimPlatform.sendMessage('deathChoice',key);};" +
      "var others=(window.skyrimPlatform.widgets.get()||[]).filter(function(w){return w&&w.type!=='death';});" +
      `window.skyrimPlatform.widgets.set([{type:'death',seconds:${seconds},onChoice:send}].concat(others));` +
      "})();";
    try {
      this.sp.browser.executeJavaScript(js);
      showUi(this.controller);
      this.sp.browser.setVisible(true);
      this.sp.browser.setFocused(true); // let the player click the buttons
    } catch (e) {
      logError(this, `failed to show death screen: ${e}`);
    }
  }

  private armFailsafe(seconds: number): void {
    this.endsAt = Date.now() + seconds * 1000;
    const timers = this.controller.lookupListener(TimersService);
    if (this.failsafeTimer !== undefined) {
      timers.clearTimeout(this.failsafeTimer);
    }
    this.failsafeTimer = timers.setTimeout(() => {
      this.failsafeTimer = undefined;
      logTrace(this, "death screen failsafe dismiss");
      this.hide();
    }, seconds * 1000 + FAILSAFE_GRACE_MS);
  }

  private hide(): void {
    logTrace(this, "hide death screen");
    if (this.failsafeTimer !== undefined) {
      this.controller.lookupListener(TimersService).clearTimeout(this.failsafeTimer);
      this.failsafeTimer = undefined;
    }
    if (this.native) {
      this.native = false;
      try { this.controller.lookupListener(ScaleformMenuService).closeNative("death"); } catch (e) { logError(this, `failed to close the native death screen: ${e}`); }
    }
    const js =
      "(function(){" +
      "if(!window.skyrimPlatform||!window.skyrimPlatform.widgets)return;" +
      "window.skyrimPlatform.widgets.set((window.skyrimPlatform.widgets.get()||[]).filter(function(w){return w&&w.type!=='death';}));" +
      "})();";
    try {
      this.sp.browser.executeJavaScript(js);
      this.sp.browser.setFocused(false); // hand control back to the game
    } catch (e) {
      logError(this, `failed to hide death screen: ${e}`);
    }
  }

  private onBrowserMessage(e: BrowserMessageEvent): void {
    if (e.arguments[0] !== "deathChoice") {
      return;
    }
    this.choose(String(e.arguments[1] ?? ""));
  }

  private choose(choice: string): void {
    if (choice !== "permadeath" && choice !== "resurrect" && choice !== "temple") {
      return;
    }
    logTrace(this, `death choice: ${choice}`);
    sendCustomPacket(this.controller, { customPacketType: "deathChoice", choice });
  }

  private failsafeTimer?: number;
  private native = false;
  private nonce = 0;
  private endsAt = 0;
}
