import { ClientListener, CombinedController, Sp } from "./clientListener";
import { ModEvent } from "skyrimPlatform";
import { logError, logTrace } from "../../logging";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { parseCustomPacket, sendCustomPacket } from "./customPacketUtil";
import {
  Action, MENU_NAME, MenuState, SWF_NAME, newState, parseMenuEvent, planClose, planOpen, planReady, planTick, summary,
} from "./scaleformMenu";

// A real Skyrim Scaleform panel driven from the server, instead of the CEF overlay (Nat, 25 Oct).
//
//   Server -> Client: { customPacketType: "dboScaleform", title, rows: [...] }   shows the panel
//                     { customPacketType: "dboScaleform", close: true }          closes it
//   Client -> Server: { customPacketType: "dboScaleform", kind: "ready"|"row"|"close", index }
//
// The loop needs no C++: Ui.openCustomMenu loads Data\Interface\dbo_testmenu.swf, Ui.invokeStringA pushes
// data in, and the SWF's skse.SendModEvent comes back as on('modEvent'). The decisions and the evidence are
// in _work\scaleform-ui-spike-1025.md; the pure half, with the SKSE constraints, is scaleformMenu.ts.
export class ScaleformMenuService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.on("modEvent", (e) => this.onModEvent(e));
    this.controller.on("update", () => this.onUpdate());
  }

  private onCustomPacketMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content || content["customPacketType"] !== "dboScaleform") return;
    try {
      if (content["close"]) {
        this.run(planClose(this.state));
        return;
      }
      this.run(planOpen(this.state, content["title"], content["rows"], Date.now()));
    } catch (e) {
      logError(this, "dboScaleform packet failed", e);
    }
  }

  // on('modEvent') hears every mod event in the game, from any installed mod, so most of what arrives here
  // is somebody else's and parseMenuEvent returns null for it.
  private onModEvent(e: ModEvent): void {
    try {
      const parsed = parseMenuEvent(e.eventName, e.strArg, e.numArg);
      if (!parsed) {
        if (this.state.phase !== "closed") this.state.foreignEvents++;
        return;
      }
      if (parsed.kind === "ready") {
        logTrace(this, "Scaleform panel reported ready");
        this.run(planReady(this.state, Date.now()));
        this.toServer("ready", 0);
        this.note(summary(this.state));
        return;
      }
      if (parsed.kind === "row") {
        this.state.clicks++;
        this.toServer("row", parsed.index);
        return;
      }
      // The SWF closes itself too, so this is the client catching up rather than the way out.
      this.run(planClose(this.state));
      this.toServer("close", -1);
      this.note(summary(this.state));
    } catch (err) {
      logError(this, "mod event handling failed", err);
    }
  }

  private onUpdate(): void {
    if (this.state.phase === "closed") return;
    const now = Date.now();
    if (now - this.lastTick < 250) return;
    this.lastTick = now;
    this.run(planTick(this.state, now));
  }

  private run(actions: Action[]): void {
    for (const a of actions) {
      try {
        if (a.do === "open") {
          // flags is read by nothing in SKSE, so 0. The SWF answers with "ready" when it has built itself,
          // because the open is queued as a UI message and is not done when this returns.
          this.sp.Ui.openCustomMenu(a.swf, 0);
          logTrace(this, "openCustomMenu", a.swf);
        } else if (a.do === "push") {
          this.sp.Ui.invokeString(MENU_NAME, "_root.dboSetTitle", a.title);
          this.sp.Ui.invokeStringA(MENU_NAME, "_root.dboSetRows", a.rows);
        } else if (a.do === "close") {
          this.sp.Ui.closeCustomMenu();
        } else {
          logTrace(this, "Scaleform panel", a.text);
          this.note(a.text);
        }
      } catch (e) {
        // A failure here is the finding, not noise: it is the first time anything has called openCustomMenu
        // from this client, so say which step died rather than swallowing it.
        logError(this, `Scaleform action '${a.do}' failed`, e);
        this.note(`action '${a.do}' threw: ${e}`);
        if (a.do === "open") this.state.phase = "closed";
      }
    }
  }

  // A second, pull-based check that the right SWF is loaded, independent of any mod event getting through.
  private readLoaded(): string {
    try {
      return String(this.sp.Ui.getString(MENU_NAME, "_root.dboVersion") || "");
    } catch {
      return "";
    }
  }

  private toServer(kind: string, index: number): void {
    sendCustomPacket(this.controller, {
      customPacketType: "dboScaleform", kind, index, swf: SWF_NAME, loaded: this.readLoaded(),
    });
  }

  private note(text: string): void {
    const n = (globalThis as { __dboDiagNote?: (kind: string, text: string) => void }).__dboDiagNote;
    try { if (typeof n === "function") n("scaleform", text); } catch { /* diagnostics only */ }
  }

  private state: MenuState = newState();
  private lastTick = 0;
}
