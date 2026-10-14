import { ButtonEvent, InputDeviceType, ThumbstickEvent } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { GamepadButton, gamepadControlsOn, isGamepadModifierHeld, trackGamepadModifier } from "./gamepadKeys";
import { DPAD_SCROLL, SEND_EVERY_MS, pageCall, pointerStep, scrollStep } from "./gamepadPointer";

// Drives the page's gamepad pointer (gamepadPointer.ts) while a panel has the browser focus
export class GamepadPointerService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    if (!gamepadControlsOn(this.sp)) return;
    this.controller.on("thumbstickEvent", (e) => this.onThumbstick(e));
    this.controller.on("buttonEvent", (e) => this.onButtonEvent(e));
    this.controller.on("update", () => this.onUpdate());
  }

  private onThumbstick(e: ThumbstickEvent): void {
    if (e.device !== InputDeviceType.Gamepad) return;
    if (e.isRight) { this.rx = e.inputX; this.ry = e.inputY; }
    if (e.isLeft) this.ly = e.inputY;
  }

  private onButtonEvent(e: ButtonEvent): void {
    if (e.device !== InputDeviceType.Gamepad) return;
    trackGamepadModifier(this.sp, e);
    if (!e.isDown || isGamepadModifierHeld() || !this.focused()) return;
    if (e.code === GamepadButton.A) this.send(0, 0, 0, "click");
    else if (e.code === GamepadButton.B) this.send(0, 0, 0, "back");
    else if (e.code === GamepadButton.DPadUp) this.send(0, 0, -DPAD_SCROLL, "");
    else if (e.code === GamepadButton.DPadDown) this.send(0, 0, DPAD_SCROLL, "");
  }

  private onUpdate(): void {
    const now = Date.now();
    const ms = Math.min(100, now - this.lastSend);
    if (ms < SEND_EVERY_MS) return;
    this.lastSend = now;
    if (!this.rx && !this.ry && !this.ly) return;
    if (!this.focused()) return;
    const { dx, dy } = pointerStep(this.rx, this.ry, ms);
    this.send(dx, dy, scrollStep(this.ly, ms), "");
  }

  private focused(): boolean {
    try { return this.sp.browser.isFocused(); } catch { return false; }
  }

  private send(dx: number, dy: number, scroll: number, action: "" | "click" | "back"): void {
    const js = pageCall(dx, dy, scroll, action);
    if (js) this.sp.browser.executeJavaScript(js);
  }

  private rx = 0;
  private ry = 0;
  private ly = 0;
  private lastSend = 0;
}
