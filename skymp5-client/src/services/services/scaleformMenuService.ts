import { ClientListener, CombinedController, Sp } from "./clientListener";
import { ModEvent } from "skyrimPlatform";
import { logError, logTrace } from "../../logging";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { parseCustomPacket, sendCustomPacket } from "./customPacketUtil";
import {
  Action, CAPS_RETRY_MS, MENU_NAME, MenuState, OUT_VAR, UiEvent, capsFor, isNew, newState, parseOutbox,
  parseUiEvent, planClose, planOpen, planReady, planRefresh, planTick, readyFrameOf, summary,
} from "./scaleformMenu";
import { Replay, replayFor, routeWidget } from "./nativeWidgets";

// How the relay draws a widget in the browser, handed over per packet so this service never imports the
// relay: dboRelayService already imports this file, and the pair would be a cycle.
export type Failover = (widget: unknown, id: number) => void;
import { withClientUiCaps } from "../../lib/clientUiCaps";

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
      const caps = capsFor(this.nativePanelsSetting());
      sendCustomPacket(this.controller, {
        customPacketType: "dbo", event: "nativeCaps", args: caps, widget: 0,
      });
      this.announcedAt = Date.now();
      this.announces++;
      // Logged even when empty, because "no native panels" is a choice someone made and the session should
      // show it rather than leave us wondering why the browser widget came up.
      logTrace(this, "native caps announced", why, caps.length ? caps.join(",") : "(none: CEF fallback)");
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
        this.pending = null;
        this.enqueue(planReady(this.state, frame, Date.now()));
        this.note(summary(this.state));
        return;
      }
      // One decision table for every panel, whether the gamemode opened it with a dboScaleform packet or the
      // relay routed a widget here. nativeWidgets.replayFor owns it so that both arrive on the same wire.
      for (const r of replayFor(parsed.key, parsed.args)) this.replay(r);
    } catch (err) {
      logError(this, "panel message handling failed", err);
    }
  }

  private replay(r: Replay): void {
    if (r.do === "server") {
      // Byte for byte what dboRelayService.onBrowserMessage sends, withClientUiCaps included, so the
      // server's onUi handlers cannot tell which UI drew the panel. That is the whole design.
      sendCustomPacket(this.controller, {
        customPacketType: "dbo", event: r.event, args: withClientUiCaps(r.event, r.args),
        widget: this.state.widgetId,
      });
      this.state.sent++;
      return;
    }
    if (r.do === "close") {
      this.enqueue(planClose(this.state));
      this.note(summary(this.state));
      return;
    }
    if (r.do === "handoff") {
      // Parsed and reported, not yet routed: handing one typed-input control back to the browser needs the
      // relay to open a browser widget over a paused game, which is not built. Said out loud rather than
      // dropped, because a panel whose rename button does nothing is the failure that wastes a session.
      const text = "a panel asked the browser to take over '" + r.type + "' in '" + r.mode + "' mode, which is not wired yet";
      logTrace(this, "Scaleform hand-off", text);
      this.note(text);
      return;
    }
    logTrace(this, "Scaleform panel", r.text);
    this.note(r.text);
  }

  // Called by dboRelayService before it draws a widget in the browser; true means the native path has taken
  // this packet and the browser must not also see it. Every native call is queued, never made here: this
  // runs inside a packet handler, where g_nativeCallRequirements.vm is unset.
  public takeWidgetPacket(content: Record<string, unknown>, drawInBrowser: Failover): boolean {
    try {
      const nativeId = this.state.phase === "closed" ? 0 : this.state.widgetId;
      const route = routeWidget(
        { close: content["close"], widget: content["widget"], focus: content["focus"] },
        nativeId, this.nativePanelsSetting());
      if (route.to === "browser") return false;
      if (route.to === "ignore") {
        // The browser path rejects these too, with its own guards. Reported once, here, and then left to it.
        logTrace(this, "widget packet not routed", route.why);
        return false;
      }
      if (route.action === "close") {
        logTrace(this, "server closed the native panel", String(route.id));
        this.enqueue(planClose(this.state));
        this.note(summary(this.state));
        return true;
      }
      if (route.action === "open") {
        logTrace(this, "routing widget to a native panel", route.swf, String(route.id));
        // Held until the SWF says it is up. If it never does, this is what the widget falls back to.
        this.pending = { widget: route.widget, id: route.id, swf: route.swf, draw: drawInBrowser };
        this.enqueue(planOpen(this.state, route.swf, route.widget, route.id, Date.now()));
        return true;
      }
      this.enqueue(planRefresh(this.state, route.widget, route.id));
      return true;
    } catch (e) {
      // The browser is the safe fallback: the player gets a panel either way, which beats getting none.
      logError(this, "routing a widget packet failed, leaving it to the browser", e);
      return false;
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
    const tick = planTick(this.state, now);
    if (!tick.length) return;
    this.exec(tick);
    this.failover("the panel never reported ready");
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
        if (a.do === "open") {
          this.state.phase = "closed";
          this.failover(`openCustomMenu threw: ${e}`);
        }
      }
    }
  }

  // A widget routed natively whose panel never came up. Whether a missing Data\\Interface\\<swf>.swf makes
  // openCustomMenu throw or quietly do nothing is NOT established - so both are covered: exec calls this when
  // the open throws, and planTick's 5s timeout calls it when nothing arrives. Either way the player ends up
  // with the browser panel rather than an empty screen, which is what happened before this existed.
  //
  // Only relay-routed panels have a fallback. A gamemode-driven dboScaleform panel has no browser widget to
  // fall back to, so pending stays null for those and this does nothing.
  private failover(why: string): void {
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    const text = `${p.swf} did not come up (${why}), so widget ${p.id} goes to the browser instead`;
    logError(this, "native panel failover", text);
    this.note(text);
    try {
      p.draw(p.widget, p.id);
    } catch (e) {
      logError(this, "the browser failover ALSO failed, so this widget is lost", e);
    }
  }

  private nativePanelsSetting(): unknown {
    try {
      const all = this.sp.settings["skymp5-client"] as Record<string, unknown> | undefined;
      return all ? all["nativePanels"] : undefined;
    } catch {
      return undefined;
    }
  }

  private note(text: string): void {
    const n = (globalThis as { __dboDiagNote?: (kind: string, text: string) => void }).__dboDiagNote;
    try { if (typeof n === "function") n("scaleform", text); } catch { /* diagnostics only */ }
  }

  private pending: { widget: unknown; id: number; swf: string; draw: Failover } | null = null;
  private state: MenuState = newState();
  private announces = 0;
  private announcedAt = 0;
  private lastTick = 0;
  private queue: Action[] = [];
}
