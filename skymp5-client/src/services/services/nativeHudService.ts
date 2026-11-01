import { BrowserMessageEvent, ButtonEvent, Menu } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { logError, logTrace } from "../../logging";
import { KEY_NO, KEY_YES, handBack, hudPrompt, pressKey, promptView } from "./nativePrompt";
import { buttonKeyCode } from "./mouseKeys";
import { ALIVE_FRAMES, HudClock, mailOf, LoadState, UiChoice, changedJson, hudShared, loadStep, newClock, newLoad, payloadOf, uiFromFile } from "./nativeHud";

// The native HUD (route H, _work/native-everything-1031.md; the /testmenu hud probe showed our own swf loads and runs in
// the HUD Menu): the vitals, the racial power, gold, hunger and the voice range, drawn by Data\Interface\dbo_hud.swf loaded
// into a clip of the HUD Menu, no menu opened. What it shows is nativeHud.ts's, from the state the relay and voice services
// leave in hudShared, with the player's F3 Interface choice read from the chat-settings file as the browser reads it.
// While it is up the browser HUD leaves out its corner and bars (DboRelayService puts native: true in the hud widget); a
// swf that never comes alive, after MAX_TRIES, leaves the browser HUD to do it all, as before.
export const HUD_MENU = "HUD Menu";
const HOST = "_root.dboNativeHud";
const SWF = "dbo_hud.swf";
const SETTINGS_PLUGIN = "chat-settings-no-load";
// The swf is fed at most this often (the power's clock and the fades move each second; the vitals more often)
const PUSH_MS = 100;

export class NativeHudService extends ClientListener {
  private load: LoadState = newLoad();
  private clock: HudClock = newClock(Date.now());
  private ui: UiChoice = uiFromFile(null);
  private last = "";
  private pushedAt = 0;

  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.ui = this.readUi();
    this.controller.on("update", () => this.onUpdate());
    this.controller.on("browserMessage", (e) => this.onBrowserMessage(e));
    this.controller.on("buttonEvent", (e) => this.onButtonEvent(e));
  }

  // Y and N answer the prompt up (nativePrompt.ts), and only while one is: never while the chat or a browser panel has the
  // keys, the console is open, or a native panel is up (it may be taking typed text)
  private onButtonEvent(e: ButtonEvent): void {
    if (!e.isDown || !hudShared.nativeUp || !hudPrompt.current) return;
    const code = buttonKeyCode(e);
    if (code !== KEY_YES && code !== KEY_NO) return;
    try {
      if (this.sp.browser.isFocused() || this.sp.Ui.isMenuOpen(Menu.Console) || this.sp.Ui.isMenuOpen("CustomMenu" as Menu)) return;
    } catch { return; }
    try {
      if (pressKey(code, Date.now())) { this.last = ""; logTrace(this, "HUD prompt answered with", code === KEY_YES ? "Y" : "N"); }
    } catch (err) { logError(this, "HUD prompt answer failed", err); }
  }

  private onBrowserMessage(e: BrowserMessageEvent): void {
    const key = e.arguments[0];
    // The page saved the F3 settings: read the Interface choice again
    if (key === "cef::chat:saveSettings") {
      try { this.ui = uiFromFile(JSON.parse(String(e.arguments[1] ?? ""))); } catch { /* the file read next time */ }
      this.last = "";
      return;
    }
    // The browser's voice manager: V held or let go (features/hud forwards its dbo:voicePtt)
    if (key === "dbo:voicePtt") { hudShared.talking = !!e.arguments[1]; return; }
  }

  private readUi(): UiChoice {
    try {
      // @ts-expect-error (TODO: Remove in 2.10.0)
      const data = this.sp.getPluginSourceCode(SETTINGS_PLUGIN, "PluginsNoLoad");
      return uiFromFile(data ? JSON.parse(data.slice(2)) : null);
    } catch {
      return uiFromFile(null);
    }
  }

  private onUpdate(): void {
    let ui;
    try { ui = this.sp.Ui; } catch { return; }
    let hudOpen = false, alive = false;
    try { hudOpen = ui.isMenuOpen(HUD_MENU); alive = hudOpen && ui.getString(HUD_MENU, `${HOST}.dboAlive`) === "yes"; } catch { return; }
    const step = loadStep(this.load, hudOpen, alive);
    if (step === "inject") {
      try {
        ui.invokeStringA(HUD_MENU, "_root.createEmptyMovieClip", ["dboNativeHud", "9993"]);
        ui.invokeString(HUD_MENU, `${HOST}.loadMovie`, SWF);
        logTrace(this, "native HUD loading, try", String(this.load.tries));
      } catch (e) { logError(this, "native HUD could not be loaded", e); }
    } else if (step === "up") {
      this.setUp(true, `alive (try ${this.load.tries || 1})`);
    } else if (step === "lost") {
      this.setUp(false, "the HUD's clip was lost; loading it again");
    } else if (step === "fail") {
      this.setUp(false, `never came alive in ${ALIVE_FRAMES} frames, after every try: the browser HUD keeps it`);
    }
    if (this.load.phase !== "up") return;
    const now = Date.now();
    if (now - this.pushedAt < PUSH_MS) return;
    const p = payloadOf(hudShared.server, hudShared.vitals, hudShared.voiceMode, hudShared.talking, this.ui, this.clock, now, hudShared.party);
    if (p) { p.prompt = promptView(hudPrompt.current, now); p.interact = hudShared.interact; p.mail = mailOf(hudShared.mail); }
    const json = changedJson(p, this.last);
    if (json === null) return;
    try {
      ui.invokeString(HUD_MENU, `${HOST}.dboData`, json);
      this.last = json; this.pushedAt = now;
    } catch (e) { logError(this, "native HUD data failed", e); }
  }

  private setUp(up: boolean, why: string): void {
    if (hudShared.nativeUp !== up) logTrace(this, `native HUD ${up ? "up" : "down"}:`, why);
    hudShared.nativeUp = up;
    this.last = "";
    if (!up) handBack();
  }
}
