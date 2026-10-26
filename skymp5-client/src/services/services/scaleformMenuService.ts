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
import {
  CLOSE_KEY, FAILED_KEY, HANDOFF_KEY, PendingHandoff, Replay, handoffDue, replayFor, swfFor,
} from "./nativeWidgets";

// What a client-side service passes to openNative. onKey receives the panel's own namespaced keys verbatim,
// plus FAILED_KEY if the panel could not be drawn and CLOSE_KEY when it reports that it has gone.
export interface NativeOpen {
  type: string;
  widget: unknown;
  widgetId?: number;
  onKey: (key: string, args: unknown[]) => void;
}
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
        // The owner is NOT cleared here: it receives keys for the whole life of the panel. It is cleared on
        // close, on closeNative and on failover - and failover can only fire before ready, because planTick
        // acts only while the phase is "opening".
        this.enqueue(planReady(this.state, frame, Date.now()));
        this.note(summary(this.state));
        return;
      }
      // One decision table for every panel, whether the gamemode opened it with a dboScaleform packet or a
      // client service called openNative. nativeWidgets.replayFor owns it so the two cannot disagree.
      for (const r of replayFor(parsed.key, parsed.args, !!this.owner)) this.replay(r);
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
    if (r.do === "owner") {
      // The owning service's own key, handed back untouched. Its switch runs exactly as it does for the
      // browser panel, which is the whole point of option 2.
      const o = this.owner;
      if (!o) {
        logTrace(this, "a panel key arrived with no owning service", r.key);
        return;
      }
      if (r.key === CLOSE_KEY) this.owner = null;
      try {
        o.onKey(r.key, r.args);
      } catch (e) {
        logError(this, `the service owning '${o.type}' threw on key '${r.key}'`, e);
      }
      return;
    }
    if (r.do === "handoff") {
      // One typed-input control goes back to the browser: the board's compose box, housing's rename. The
      // CustomMenu is opened with kFlag_Modal | kFlag_PausesGame (SKSE CustomMenu.cpp), so the page cannot be
      // seen or typed into while it is up - the panel comes down FIRST and the owner then draws its own
      // browser widget with the mode set. The owner is deliberately NOT cleared: it reopens the native panel
      // when the input is done, and openNative will set it again.
      this.enqueue(planClose(this.state));
      if (!this.owner) {
        // A gamemode dboScaleform panel has no client-side owner, so there is nobody to draw the browser
        // widget: that needs the SERVER to publish it, which is not wired. Said out loud rather than dropped,
        // because a rename button that does nothing is the failure that wastes a session.
        const text = `a gamemode panel asked for '${r.type}' in '${r.mode}' mode, but only a client-service panel can hand off`;
        logTrace(this, "Scaleform hand-off", text);
        this.note(text);
        return;
      }
      // NOT delivered here. closeCustomMenu above only queues a UI message, so the menu is still open for a
      // frame or two; NativeBackdropService hides the browser while it is, so a composer drawn now would be
      // invisible until its next 150 ms poll. onUpdate delivers once the menu has really gone.
      logTrace(this, "hand-off held until the panel closes", r.type, r.mode);
      this.pendingHandoff = { type: r.type, mode: r.mode, at: Date.now() };
      return;
    }
    logTrace(this, "Scaleform panel", r.text);
    this.note(r.text);
  }

  // A client-side service drawing its own panel natively instead of calling openFormMenu. The service keeps
  // its widget, its packets and its key switch; all it changes is the call site and a callback.
  //
  //   if (!this.controller.lookupListener(ScaleformMenuService).openNative({
  //         type: "contextMenu", widgetId: WIDGET_ID,
  //         widget: { type, id, targetName, actions, lines, mode, events },
  //         onKey: (key, args) => this.handleKey(key, args),
  //       })) {
  //     openFormMenu(...);   // as before
  //   }
  //
  // widget is passed through to _root.dboData untouched, so it must be the WIDGET object the SWF reads - the
  // same one the browser would have received - and not the injected-vars object openFormMenu takes for its
  // stringified setter. Nothing here inspects it, so the wrong shape reaches the panel silently and the panel
  // draws blank.
  //
  // false means "not native, draw it yourself" - an unknown type, or the nativePanels setting turning it off -
  // so the service needs no knowledge of which panels have an SWF. Keys the service namespaced for itself
  // ("bountyBoard:post") come back to onKey verbatim; dbo: keys still go straight to the server.
  //
  // onKey is also called with FAILED_KEY if the panel cannot be drawn, so the service can open its browser
  // menu after all, and with CLOSE_KEY when the panel reports it has gone.
  //
  // Reopening from inside FAILED_KEY is SAFE: openNative returns false for a type that failed this session,
  // so the plainest possible handler - call openNative, and openFormMenu when it says false - cannot loop.
  // No service needs a flag of its own for that.
  public openNative(opts: NativeOpen): boolean {
    try {
      const type = String(opts.type || "");
      // A type whose panel already failed this session stays on the browser. Without this, a service that
      // simply reopens on FAILED_KEY calls openNative, gets true because the type is still registered, and
      // loops straight back into the panel that cannot be drawn (Worker 1, 26 Oct). Guarding it in each
      // service would put the burden back where this design exists to take it away from.
      //
      // Session-long rather than retried: the cause is a missing or broken Data\Interface\<swf>.swf, which
      // does not heal, and retrying costs the player the 5s ready timeout on every open. resetNative clears
      // it for a service that has reason to try again.
      if (this.failedTypes.indexOf(type) >= 0) return false;
      const swf = swfFor(type, this.nativePanelsSetting());
      if (!swf) return false;
      const id = Math.max(0, Math.round(Number(opts.widgetId) || 0));
      this.owner = { type, onKey: opts.onKey };
      logTrace(this, "opening a native panel for a client service", type, swf);
      this.enqueue(planOpen(this.state, swf, opts.widget, id, Date.now()));
      return true;
    } catch (e) {
      // Never leave the service believing the panel is up when it is not.
      logError(this, `openNative('${opts && opts.type}') failed, so the service should draw its own`, e);
      this.owner = null;
      return false;
    }
  }

  // The owning service's closeMenu. Safe to call when nothing is open.
  public closeNative(type?: string): void {
    const t = String(type || "");
    if (t && this.owner && this.owner.type !== t) return;
    // A hand-off still waiting is dropped: the service has closed the panel itself, so delivering it would
    // reopen a composer for a panel nobody is looking at any more.
    this.pendingHandoff = null;
    this.owner = null;
    this.enqueue(planClose(this.state));
  }

  public isNativeOpen(type?: string): boolean {
    if (this.state.phase === "closed") return false;
    const t = String(type || "");
    return !t || (!!this.owner && this.owner.type === t);
  }

  // New contents for a panel already on screen, for a service whose state changed.
  public refreshNative(widget: unknown, widgetId?: number): void {
    if (this.state.phase === "closed") return;
    this.enqueue(planRefresh(this.state, widget, widgetId === undefined ? this.state.widgetId : widgetId));
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
    // Before the closed-phase return, exactly like the queue above: by the time a hand-off is deliverable
    // the panel IS closed, so anything after this line would never run.
    if (this.pendingHandoff) {
      const due = handoffDue(this.pendingHandoff, this.menuIsOpen(), Date.now());
      if (due !== "wait") {
        const h = this.pendingHandoff;
        this.pendingHandoff = null;
        if (due === "late") {
          // Delivered anyway: a hand-off that never arrives loses what the player was about to type.
          logError(this, "the panel did not close in time, handing off anyway", `${h.type}/${h.mode}`);
          this.note(`${h.type}: the panel did not close in time, so the browser was asked anyway`);
        }
        const o = this.owner;
        if (o) {
          logTrace(this, "handing off to the browser", h.type, h.mode);
          try {
            o.onKey(HANDOFF_KEY, [h.type, h.mode]);
          } catch (e) {
            logError(this, `the service owning '${o.type}' threw on the hand-off`, e);
          }
        }
      }
    }
    if (this.state.phase === "closed") return;
    // Every tick, not throttled: a click must not wait a quarter of a second to be noticed.
    if (this.state.phase === "ready") this.drainOutbox();
    const now = Date.now();
    if (now - this.lastTick < 250) return;
    this.lastTick = now;
    // The SWF can take itself down (Worker 1's panels close themselves on their Close button), and nothing
    // reports that. Left unnoticed the phase stays "ready" over a dead menu, drainOutbox polls a menu that
    // is gone and the next open thinks the same panel is still up. Ui.isMenuOpen is in the local typings
    // (index.d.ts:3300); checked on the 250ms tick rather than every frame, because a quarter second of
    // lateness is invisible and this is cleanup.
    if (this.state.phase === "ready" && !this.menuIsOpen()) {
      logTrace(this, "the panel closed itself, catching up");
      for (const r of replayFor(CLOSE_KEY, ["selfClosed"], !!this.owner)) this.replay(r);
      return;
    }
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

  // A native panel that never came up. Whether a missing Data\\Interface\\<swf>.swf makes openCustomMenu throw
  // or quietly do nothing is NOT established, so both are covered: exec calls this when the open throws, and
  // planTick's 5s timeout calls it when nothing arrives. Either way the owning service is told to draw its
  // own browser menu, so the player gets a panel rather than an empty screen.
  //
  // Only a client-service panel has somewhere to fall back to. A gamemode dboScaleform panel has no owner, so
  // this does nothing for one of those and its failure is reported by planTick alone.
  // A service may re-arm a type that failed, if it has reason to think the panel can be drawn now. Rarely
  // needed: a missing SWF stays missing for the session.
  public resetNative(type: string): void {
    const i = this.failedTypes.indexOf(String(type || ""));
    if (i >= 0) this.failedTypes.splice(i, 1);
  }

  private failover(why: string): void {
    const o = this.owner;
    this.owner = null;
    if (!o) return;
    // Recorded BEFORE the callback, so a service that reopens from inside it gets false rather than looping
    if (this.failedTypes.indexOf(o.type) < 0) this.failedTypes.push(o.type);
    const text = `a native panel for '${o.type}' did not come up (${why}), so the service draws its own`;
    logError(this, "native panel failover", text);
    this.note(text);
    // The service opens its browser menu instead. Told once, and the owner is cleared first so a callback
    // that calls back in here cannot loop.
    try {
      o.onKey(FAILED_KEY, [why]);
    } catch (e) {
      logError(this, "the owning service could not draw its own panel either, so this panel is lost", e);
    }
  }

  // Only ever called from onUpdate, where a native is callable. A throw here must not be read as "closed":
  // that would tear down a live panel, so it reports open and the ready timeout stays the real net.
  private menuIsOpen(): boolean {
    try {
      return this.sp.Ui.isMenuOpen(MENU_NAME);
    } catch (e) {
      return true;
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

  private owner: { type: string; onKey: (key: string, args: unknown[]) => void } | null = null;
  // A hand-off waiting for the panel to actually close (handoffDue decides when)
  private pendingHandoff: PendingHandoff | null = null;
  // Types whose panel could not be drawn this session. An array, not a Set: the client targets es2019 but the
  // rest of this file stays to the plainest shapes, and this list is never longer than the registry.
  private failedTypes: string[] = [];
  private state: MenuState = newState();
  private announces = 0;
  private announcedAt = 0;
  private lastTick = 0;
  private queue: Action[] = [];
}
