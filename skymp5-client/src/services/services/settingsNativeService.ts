import { ClientListener, ClientListenerConstructor, CombinedController, Sp } from "./clientListener";
import { BrowserMessageEvent, ButtonEvent } from "skyrimPlatform";
import { logError, logTrace } from "../../logging";
import { buttonKeyCode } from "./mouseKeys";
import { ScaleformMenuService } from "./scaleformMenuService";
import { ChatService } from "./chatService";
import { KeybindsService } from "./keybindsService";
import { FovService } from "./fovService";
import { MouseFreeService } from "./mouseFreeService";
import {
  Json, PAGE_MESSAGE, PEER_OPS, SCALES, captureOf, cleanChat, cleanUi, cleanVoice, keyNamesFor, micLevelJs, pageActJs, pageQueryJs,
  pageSyncJs, readChat, readUi, withChat, withUi,
} from "./settingsLocal";

// F3, Settings: Interface, Keys, Camera, Mouse and Voice in the native journal (swf/dbo_journal tabs/settings.as), which
// never reopens the browser journal for them. The panel sends set:* keys (nativeWidgets LOCAL_PREFIX) and is answered in
// _root.dboLocal with what the five sections show. Every change goes the browser page's way: the chat-settings file through
// chatService's writer (the page's copy follows), the menu keys through keybindsService, the field of view through
// fovService, the mouse through MouseFreeService; the interface size and voice stay the page's (UiScale.js, VoiceManager),
// reached through the hidden page, which stays loaded for the chat and voice.
const SWF = "dbo_journal";
const LOCAL_TARGET = "_root.dboLocal";
const LEVEL_TARGET = "_root.dboLocalLevel";
const LEVEL_MS = 200;

interface Capturing { row: string; names: string[]; optional: boolean }

export class SettingsNativeService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("update", () => this.onUpdate());
    this.controller.on("browserMessage", (e) => this.onBrowserMessage(e));
    this.controller.on("buttonEvent", (e) => this.onButtonEvent(e));
  }

  private onUpdate(): void {
    if (!this.registered) {
      try {
        this.controller.lookupListener(ScaleformMenuService).onLocalKeys((key, args) => this.onKey(key, args));
        this.registered = true;
      } catch (e) {
        logError(this, "no Scaleform service for the native settings", e);
        this.registered = true;
      }
    }
    if (this.levelOn && Date.now() - this.levelAt >= LEVEL_MS) {
      this.levelAt = Date.now();
      this.page(micLevelJs());
    }
  }

  private onKey(key: string, args: unknown[]): void {
    const a = args || [];
    switch (key) {
      case "set:get":
        this.peers = Array.isArray(a[0]) ? (a[0] as unknown[]).map(String).slice(0, 64) : [];
        this.note = "";
        this.panelsReset = false;
        this.push();
        this.page(pageQueryJs(this.peers));
        return;
      case "set:ui":
        this.saveFile((f) => { const p = cleanUi(a[0]); return Object.keys(p).length ? { file: withUi(f, p), chat: null } : null; });
        return;
      case "set:chat":
        this.saveFile((f) => { const p = cleanChat(a[0]); return Object.keys(p).length ? { file: withChat(f, p), chat: p } : null; });
        return;
      case "set:scale": {
        const v = Number(a[0]);
        if (SCALES.indexOf(v) < 0) return;
        this.page(pageActJs("scale", [v]));
        this.page(pageQueryJs(this.peers));
        return;
      }
      case "set:panelReset":
        this.page(pageActJs("panelReset", [Date.now()]));
        this.panelsReset = true;
        this.push();
        return;
      case "set:fov":
        this.onFov(String(a[0] || ""), Number(a[1]));
        return;
      case "set:mouse": {
        const on = a[0] === "on";
        this.saveFile((f) => ({ file: withUi(f, { mouseLeavesWindow: on }), chat: null }));
        this.service(MouseFreeService, (m) => m.fromNative(["dbo:mouse", "set", on ? "on" : "off"]));
        return;
      }
      case "set:keyCapture": {
        const names = Array.isArray(a[1]) ? (a[1] as unknown[]).map(String) : [];
        this.capture = names.length ? { row: String(a[0] || ""), names, optional: a[2] === true } : null;
        this.note = "";
        this.push();
        return;
      }
      case "set:keyCancel":
        this.capture = null;
        this.push();
        return;
      case "set:keyClear": {
        const names = Array.isArray(a[0]) ? (a[0] as unknown[]).map(String) : [];
        if (names.length) this.saveKeys(names, a[1] === true ? 0 : null);
        return;
      }
      case "set:voice": {
        const p = cleanVoice(a[0]);
        if (!Object.keys(p).length) return;
        this.page(pageActJs("voice", [p]));
        this.page(pageQueryJs(this.peers));
        return;
      }
      case "set:peer": {
        const op = String(a[1] || "");
        const v = Number(a[3]);
        if (PEER_OPS.indexOf(op) < 0 || (op === "set" && !(v >= 0 && v <= 4))) return;
        this.page(pageActJs("peer", [String(a[0] || ""), op, String(a[2] || ""), v]));
        this.page(pageQueryJs(this.peers));
        return;
      }
      case "set:level":
        this.levelOn = a[0] === "on";
        return;
      default:
        logTrace(this, "unknown native settings key", key);
    }
  }

  // Each step applies at once (fovService, on its next update), and the choice is kept as the page keeps it: ui.fov with
  // the launcher's value it was made against, or none after Reset
  private onFov(what: string, v: number): void {
    const fov = this.fov();
    if (!fov) return;
    if (what === "set") {
      if (!(v >= fov.min && v <= fov.max)) return;
      this.service(FovService, (f) => f.fromNative(["dbo:fov", "set", Math.round(v)]));
      this.saveFile((f) => ({ file: withUi(f, { fov: { value: Math.round(v), launcher: fov.launcher } }), chat: null }));
    } else if (what === "reset") {
      this.service(FovService, (f) => f.fromNative(["dbo:fov", "reset"]));
      this.saveFile((f) => ({ file: withUi(f, { fov: null }), chat: null }));
    }
    this.controller.once("update", () => this.push());
  }

  // Never writes over a file it could not read: the chat's values and every other block would be lost
  private saveFile(change: (file: Json) => { file: Json; chat: Json | null } | null): void {
    const chat = this.chat();
    const file = chat ? chat.readSettingsFile() : null;
    if (!chat || !file) {
      this.note = "Your settings file could not be read, so nothing was saved.";
      this.push();
      return;
    }
    const next = change(file);
    if (!next) return;
    chat.saveSettingsFile(next.file);
    this.page(pageSyncJs(next.file, next.chat));
    this.push();
  }

  private onButtonEvent(e: ButtonEvent): void {
    if (!this.capture || !e.isDown) return;
    const code = buttonKeyCode(e);
    if (code === null) return;
    const c = captureOf(code, this.capture.optional);
    if (!c) return;
    if ("cancel" in c) {
      this.capture = null;
      this.push();
    } else if ("refuse" in c) {
      this.note = c.refuse;
      this.push();
    } else {
      this.saveKeys(this.capture.names, c.save);
    }
  }

  private saveKeys(names: string[], code: number | null): void {
    const keys: Record<string, number | null> = {};
    for (const n of names) keys[n] = code;
    this.capture = null;
    this.note = "";
    this.service(KeybindsService, (k) => k.fromNative(["cef::keybinds:save", JSON.stringify({ keys })]));
    this.push();
  }

  private onBrowserMessage(e: BrowserMessageEvent): void {
    if (e.arguments[0] !== PAGE_MESSAGE) return;
    try {
      const o = JSON.parse(String(e.arguments[1] ?? ""));
      if (!o || typeof o !== "object") return;
      if (typeof o.level === "number") {
        if (this.levelOn) this.scaleform((s) => s.invokeOnPanel(SWF, LEVEL_TARGET, String(o.level)));
        return;
      }
      this.pageState = { scale: o.scale || null, voice: o.voice || null };
      this.push();
    } catch (err) {
      logTrace(this, `settings page answer unreadable: ${err}`);
    }
  }

  private push(): void {
    const chat = this.chat();
    const file = chat ? chat.readSettingsFile() : null;
    const f = file || {};
    const ui = f.ui && typeof f.ui === "object" ? f.ui as Json : {};
    let keys: { live: Record<string, number>; next: Record<string, number> } | null = null;
    this.service(KeybindsService, (k) => { keys = k.state(); });
    const codes: number[] = keys ? Object.values((keys as { next: Record<string, number> }).next).concat(Object.values((keys as { live: Record<string, number> }).live)) : [];
    const snapshot = {
      file: !!file, ui: readUi(f), chat: readChat(f), mouse: ui.mouseLeavesWindow === true, fov: this.fov(),
      keys: keys ? Object.assign({}, keys as Json, { names: keyNamesFor(codes) }) : null,
      capture: this.capture ? this.capture.row : "", note: this.note, panelsReset: this.panelsReset,
      scale: this.pageState.scale, voice: this.pageState.voice,
    };
    this.scaleform((s) => s.invokeOnPanel(SWF, LOCAL_TARGET, JSON.stringify(snapshot)));
  }

  private page(js: string): void {
    if (!js) return;
    try {
      this.sp.browser.executeJavaScript(js);
    } catch (e) {
      logError(this, "the settings page call failed", e);
    }
  }

  private fov(): { value: number | null; launcher: number | null; min: number; max: number } | null {
    let out: { value: number | null; launcher: number | null; min: number; max: number } | null = null;
    this.service(FovService, (f) => { out = f.state(); });
    return out;
  }

  private chat(): ChatService | null {
    try { return this.controller.lookupListener(ChatService); } catch { return null; }
  }

  private scaleform(f: (s: ScaleformMenuService) => void): void {
    this.service(ScaleformMenuService, f);
  }

  private service<T extends ClientListener>(cls: ClientListenerConstructor<T>, f: (s: T) => void): void {
    try {
      f(this.controller.lookupListener(cls));
    } catch (e) {
      logError(this, `native settings: ${cls.name} call failed`, e);
    }
  }

  private registered = false;
  private capture: Capturing | null = null;
  private note = "";
  private panelsReset = false;
  private peers: string[] = [];
  private pageState: { scale: unknown; voice: unknown } = { scale: null, voice: null };
  private levelOn = false;
  private levelAt = 0;
}
