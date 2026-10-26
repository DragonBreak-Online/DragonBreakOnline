// The generic widget-to-SWF router (Worker 4 with Worker 1, 26 Oct).
//
// A service publishes a widget and does not care who draws it. If the widget's type has a native SWF and
// that type is switched on, the panel is drawn by Scaleform instead of the browser, and the SAME widget
// object the browser would have received is pushed to _root.dboData. Everything the panel sends back is
// replayed as the IDENTICAL packet the browser path produces, so no service needs native code and the relay
// keeps one wire:
//
//   { customPacketType: "dbo", event: <key without "dbo:">, args, widget }
//
// That one rule is the whole reason this design is cheap, and it is also the trap: dboRelayService drops any
// browser key that does not start "dbo:", SILENTLY. A native panel that sends an unprefixed key would do
// nothing at all and nothing would say why, which is how three separate faults presented today. So a key
// without the prefix is REPORTED here rather than dropped.
//
// The panel sends the widget's own event strings VERBATIM, out of the payload it was given
// (widget.events.close and friends). The client never invents or looks up a key: in the browser the front
// does the same thing, and a key invented here would be one no handler reads.
//
// No imports, so a harness loads it on its own (tests/native-widgets-harness.js).

// type, as the service publishes it in widget.type -> the SWF in Data\Interface
export const NATIVE_WIDGETS: Readonly<Record<string, string>> = {
  prayer: "dbo_prayer",
  decor: "dbo_decor",
  bountyBoard: "dbo_board",
  housing: "dbo_housing",
};

export const HANDOFF_KEY = "native:handoff";
export const CLOSE_KEY = "close";
export const DBO_PREFIX = "dbo:";

// Shares the nativePanels setting with the gamemode-driven panels, so one switch covers everything and a
// panel that misbehaves in a session goes back to the browser without a rebuild:
//   absent or true     every type native
//   false              none, so every panel is the browser one again
//   { housing: false } that one type browser, the rest native
export const swfFor = (type: unknown, setting: unknown): string => {
  const t = String(type || "");
  if (!t || !Object.prototype.hasOwnProperty.call(NATIVE_WIDGETS, t)) return "";
  if (setting === false) return "";
  if (setting && typeof setting === "object") {
    const off = setting as Record<string, unknown>;
    if (off[t] === false) return "";
  }
  return NATIVE_WIDGETS[t];
};

export const typeOf = (widget: unknown): string => {
  if (!widget || typeof widget !== "object") return "";
  const t = (widget as Record<string, unknown>)["type"];
  return typeof t === "string" ? t : "";
};

export interface Handoff {
  type: string;
  mode: string;
}

// "native:handoff" [type, mode]: the panel wants the browser to draw one typed-input control, then to come
// back. A hand-off with no mode is refused rather than treated as a close, because the two do opposite
// things and the wrong guess loses what the player typed.
export const handoffOf = (key: string, args: unknown[]): Handoff | null => {
  if (String(key || "") !== HANDOFF_KEY) return null;
  const type = args.length > 0 ? String(args[0] || "") : "";
  const mode = args.length > 1 ? String(args[1] || "") : "";
  if (!type || !mode) return null;
  return { type, mode };
};

export type Replay =
  | { do: "server"; event: string; args: unknown[] }
  | { do: "close" }
  | { do: "handoff"; type: string; mode: string }
  | { do: "report"; text: string };

// What a key coming out of a native panel means. The order matters: a hand-off and a close do opposite
// things, so neither may fall through to the other.
export const replayFor = (key: string, args: unknown[]): Replay[] => {
  const k = String(key || "");
  if (!k) return [{ do: "report", text: "a native panel sent an empty key" }];

  const handoff = handoffOf(k, args);
  if (handoff) return [{ do: "handoff", type: handoff.type, mode: handoff.mode }];
  if (k === HANDOFF_KEY) {
    return [{ do: "report", text: `${HANDOFF_KEY} needs a type and a mode, got ${JSON.stringify(args)}` }];
  }

  // A bare "close" is the panel saying it has gone, which is the Scaleform equivalent of Escape in the
  // browser. dboRelayService.closeFocused answers that with { event: "close", args: [why] }, and THREE live
  // gamemode handlers hang off that packet: the player panel's nonces, the pigeon nonces, and abandoning a
  // half-finished read (dbo-gamemode.js 4224, 4609, 5400). A native panel that closed without it would leak
  // all three, so this is parity, not politeness. The packet goes first, so that a close which throws has
  // still told the server.
  //
  // A panel whose Close button should run the server's OWN close handler sends the widget's events.close
  // string instead. That is dbo:-prefixed and needs none of this.
  if (k === CLOSE_KEY) {
    const why = args.length && args[0] ? String(args[0]) : "native";
    return [{ do: "server", event: "close", args: [why] }, { do: "close" }];
  }

  if (k.indexOf(DBO_PREFIX) === 0) {
    return [{ do: "server", event: k.slice(DBO_PREFIX.length), args }];
  }

  // The silent-drop trap, made loud. dboRelayService.onBrowserMessage refuses a key without the prefix and
  // says nothing, so a panel wired this way looks like a server that never answers.
  return [{
    do: "report",
    text: `a native panel sent '${k}', which has no ${DBO_PREFIX} prefix: the browser path drops such a key silently, so this would do nothing`,
  }];
};

// ---- the inbound half: which UI draws a dboWidget packet ---------------------------------------------------

export interface WidgetPacket {
  close?: unknown;
  widget?: unknown;
  focus?: unknown;
}

export type Route =
  | { to: "native"; action: "open"; swf: string; id: number; widget: unknown }
  | { to: "native"; action: "refresh"; id: number; widget: unknown }
  | { to: "native"; action: "close"; id: number }
  | { to: "browser" }
  | { to: "ignore"; why: string };

// nativeId is the widget the CustomMenu is currently drawing, or 0. The rules that matter:
//
//  - a server close for the widget that is open NATIVELY takes the CustomMenu down. It must never reach
//    closeFormMenu/closeWidget, which talk to a browser widget that was never opened and which, through
//    takeDeferredFocus, would hand focus back to the page (Worker 1 asked for this explicitly).
//  - a refresh goes native only for the widget we actually opened natively. A refresh for any other is the
//    browser's, even when its type is a native one, because that widget is drawn by the page.
//  - once a widget is open natively it STAYS native even if the setting says otherwise, so a setting edited
//    mid-session cannot split one panel across both UIs.
export const routeWidget = (packet: WidgetPacket, nativeId: number, setting: unknown): Route => {
  const open = Number(nativeId) > 0 ? Number(nativeId) : 0;

  const closeId = Number(packet.close);
  if (isFinite(closeId) && closeId > 0) {
    return open && closeId === open ? { to: "native", action: "close", id: closeId } : { to: "browser" };
  }

  const w = packet.widget;
  if (!w || typeof w !== "object") return { to: "ignore", why: "the packet carries no widget object" };
  const raw = (w as Record<string, unknown>)["id"];
  const id = Number(raw);
  if (!isFinite(id) || id <= 0) return { to: "ignore", why: `widget id '${String(raw)}' is not a positive number` };

  const mine = open === id;
  const swf = swfFor(typeOf(w), setting);
  if (!swf && !mine) return { to: "browser" };

  if (packet.focus) {
    // Reopening the one already open would restart the SWF and lose whatever the player had typed into it,
    // so that is a refresh. Scaleform allows one CustomMenu at a time in any case.
    if (mine) return { to: "native", action: "refresh", id, widget: w };
    return { to: "native", action: "open", swf, id, widget: w };
  }
  return mine ? { to: "native", action: "refresh", id, widget: w } : { to: "browser" };
};
