import { ClientListener, CombinedController, Sp } from "./clientListener";
import { ModEvent } from "skyrimPlatform";
import { logError, logTrace } from "../../logging";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { parseCustomPacket, sendCustomPacket } from "./customPacketUtil";
import {
  Action, CAPS_RETRY_MS, MENU_NAME, MenuState, NATIVE_CAPS, OUT_VAR, UiEvent, isNew, newState, parseOutbox,
  parseUiEvent, planClose, planOpen, planReady, planTick, readyFrameOf, serverEventName, summary,
} from "./scaleformMenu";

// A real Skyrim Scaleform panel driven from the server, instead of the CEF overlay (Nat, 25 Oct).
//
//   Server -> Client: { customPacketType: "dboScaleform", swf, payload, widget }   shows the panel
//                     { customPacketType: "dboScaleform", close: true }            closes it
//   Client -> Server: whatever the panel sends, as the SAME packet the browser widgets send:
//                     { customPacketType: "dbo", event, args, widget }
//
// The loop needs no C++: Ui.openCustomMenu loads Data\Interface\<swf>.swf, Ui.invokeString pushes the whole
// payload in as JSON, and the SWF's skse.SendModEvent comes back as on('modEvent'). The evidence and the
// panel-by-panel plan are in _work\scaleform-ui-spike-1025.md; the pure half is scaleformMenu.ts.
export class ScaleformMenuService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.on("modEvent", (e) => this.onModEvent(e));
    this.controller.on("update", () => this.onUpdate());
    this.controller.emitter.on("connectionAccepted", () => this.announce("connected"));
  }

  // The server gates each native panel on the client naming it, and falls back to the browser widget or to
  // chat otherwise. A cap that arrives late is therefore invisible: the player just gets the old UI with no
  // error anywhere, so it is announced on connect and once again a few seconds later.
  private announce(why: string): void {
    try {
      sendCustomPacket(this.controller, {
        customPacketType: "dbo", event: "nativeCaps", args: NATIVE_CAPS.slice(), widget: 0,
      });
      this.announcedAt = Date.now();
      this.announces++;
      logTrace(this, "native caps announced", why, NATIVE_CAPS.join(","));
    } catch (e) {
      logError(this, "could not announce the native caps", e);
    }
  }

  private onCustomPacketMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content || content["customPacketType"] !== "dboScaleform") return;
    try {
      if (content["close"]) {
        this.enqueue(planClose(this.state));
        return;
      }
      this.enqueue(planOpen(this.state, content["swf"], content["payload"], content["widget"], Date.now()));
    } catch (e) {
      logError(this, "dboScaleform packet failed", e);
    }
  }

  // on('modEvent') hears every mod event in the game, from any installed mod, so most of what arrives here
  // is somebody else's and parseUiEvent returns null for it.
  private onModEvent(e: ModEvent): void {
    try {
      const parsed = parseUiEvent(e.eventName, e.strArg, e.numArg);
      if (!parsed) {
        if (this.state.phase !== "closed") this.state.foreignEvents++;
        return;
      }
      if (!isNew(this.state, parsed)) return;
      this.state.viaModEvent++;
      this.handle(parsed);
    } catch (err) {
      logError(this, "mod event handling failed", err);
    }
  }

  // The proven channel. skse.Log works from the movie but SendModEvent has never been seen to arrive, and
  // nothing else in this client subscribes to modEvent, so the panel also appends every message to a string
  // and we read it here with Ui.getString, which is the same native family that already drives the vanilla
  // HUD. Whichever channel delivers first wins; the sequence number stops a message being handled twice.
  private drainOutbox(): void {
    let raw = "";
    try {
      raw = String(this.sp.Ui.getString(MENU_NAME, OUT_VAR) || "");
    } catch (e) {
      return;
    }
    if (!raw || raw.length <= this.state.outRead) return;
    const box = parseOutbox(raw, this.state.outRead);
    this.state.outRead = box.consumed;
    for (const m of box.messages) {
      if (!isNew(this.state, m)) continue;
      this.state.viaOutbox++;
      this.handle(m);
    }
  }

  private handle(parsed: UiEvent): void {
    try {
      if (parsed.key === "ready") {
        // The frame number is the measurement: _global.skse does not exist on frame 1, and until one
        // session reported this nobody knew which frame it does appear on.
        const frame = readyFrameOf(parsed);
        logTrace(this, "Scaleform panel ready on frame", String(frame));
        this.enqueue(planReady(this.state, frame, Date.now()));
        this.note(summary(this.state));
        return;
      }
      if (parsed.key === "close") {
        // The SWF closes itself too, so this is the client catching up rather than the way out.
        this.enqueue(planClose(this.state));
        this.note(summary(this.state));
        return;
      }
      const eventName = serverEventName(parsed.key);
      if (!eventName) {
        logTrace(this, "Scaleform panel sent an unknown key", parsed.key);
        return;
      }
      // Exactly what dboRelayService sends for a browser widget, so the server's onUi handlers are unchanged
      sendCustomPacket(this.controller, {
        customPacketType: "dbo", event: eventName, args: parsed.args, widget: this.state.widgetId,
      });
      this.state.sent++;
    } catch (err) {
      logError(this, "panel message handling failed", err);
    }
  }

  // Every native runs from here. SkyrimPlatform sets g_nativeCallRequirements.vm only inside OnUpdate
  // (main.cpp), so a Papyrus call from a packet handler throws "can't be called in this context" - which is
  // exactly what openCustomMenu did on 26 Oct at 03:26. It is also why customPacketUtil has notifyNextUpdate.
  private onUpdate(): void {
    if (this.queue.length) {
      const q = this.queue;
      this.queue = [];
      this.exec(q);
    }
    // One retry, because the first can land before the server has an actor for this user
    if (this.announces === 1 && this.announcedAt && Date.now() - this.announcedAt > CAPS_RETRY_MS) {
      this.announce("retry");
    }
    if (this.state.phase === "closed") return;
    // Every tick, not throttled: a click must not wait a quarter of a second to be noticed.
    if (this.state.phase === "ready") this.drainOutbox();
    const now = Date.now();
    if (now - this.lastTick < 250) return;
    this.lastTick = now;
    this.exec(planTick(this.state, now));
  }

  // Queued, not run: the caller may be outside the update tick, where no native can be called.
  private enqueue(actions: Action[]): void {
    for (const a of actions) this.queue.push(a);
  }

  private exec(actions: Action[]): void {
    for (const a of actions) {
      try {
        if (a.do === "open") {
          // flags is read by nothing in SKSE, so 0. The SWF answers with "ready" once _global.skse exists,
          // which is never on frame 1, so nothing may be invoked before then.
          this.sp.Ui.openCustomMenu(a.swf, 0);
          logTrace(this, "openCustomMenu", a.swf);
        } else if (a.do === "push") {
          this.sp.Ui.invokeString(MENU_NAME, "_root.dboData", a.json);
        } else if (a.do === "close") {
          this.sp.Ui.closeCustomMenu();
        } else {
          logTrace(this, "Scaleform panel", a.text);
          this.note(a.text);
        }
      } catch (e) {
        // A failure here is the finding, not noise: say which step died rather than swallowing it.
        logError(this, `Scaleform action '${a.do}' failed`, e);
        this.note(`action '${a.do}' threw: ${e}`);
        if (a.do === "open") this.state.phase = "closed";
      }
    }
  }

  private note(text: string): void {
    const n = (globalThis as { __dboDiagNote?: (kind: string, text: string) => void }).__dboDiagNote;
    try { if (typeof n === "function") n("scaleform", text); } catch { /* diagnostics only */ }
  }

  private state: MenuState = newState();
  private announces = 0;
  private announcedAt = 0;
  private lastTick = 0;
  private queue: Action[] = [];
}
