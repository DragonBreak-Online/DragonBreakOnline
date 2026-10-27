// Native panels for CLIENT-SIDE services (Worker 4 with Worker 1 and Worker 2, 26 Oct).
//
// Two different kinds of panel reach the Scaleform layer, and confusing them wasted a commit:
//
//  1. Gamemode panels (prayer, decor, journal, deityPicker, rite, dungeonGate...). The SERVER decides, gated
//     on NATIVE_CAPS, and sends { customPacketType: "dboScaleform", swf, payload, widget }. Nothing here is
//     involved: add the cap to NATIVE_CAPS in scaleformMenu.ts and the swf to the gamemode's NATIVE_SWF.
//  2. Client-service panels (bountyBoard, housing, contextMenu...). The service owns the widget, receives its
//     own packets and calls openFormMenu itself, so the server never names them and no relay packet carries
//     them. Those are what this file is for: the service calls ScaleformMenuService.openNative instead of
//     openFormMenu and hands over a callback, and its existing key switch runs unchanged.
//
// An earlier version routed widgets out of dboRelayService's dboWidget packet. That was built on a premise
// Worker 1 corrected: bountyBoardService and housingService never go through the relay at all (they call
// openFormMenu directly), and contextMenu is BOTH a relay type the gamemode publishes and a client-service
// panel, so a registry shared by both paths would have opened it twice. The relay hook is gone.
//
// No imports, so a harness loads it on its own (tests/native-widgets-harness.js).

// The service's own panel name -> the SWF in Data\Interface. ONLY client-service panels belong here. A
// gamemode panel in this table would be drawn twice.
export const NATIVE_WIDGETS: Readonly<Record<string, string>> = {
  bountyBoard: "dbo_board",
  housing: "dbo_housing",
  contextMenu: "dbo_context",
  // The F7 admin panel (Worker 2). Client-service only: no server module publishes a widget of this type, so
  // it needs no SHARED_WITH_GAMEPLAY entry. adminMenuService keeps the catalogs in TS and answers the SWF
  // one paged tab at a time through admin::ui, because the whole catalogue is far over MAX_PAYLOAD_CHARS.
  adminPanel: "dbo_admin",
  // No emoteWheel entry, deliberately. The emote wheel stays on the CEF overlay: it is a hold-and-flick
  // wheel, and a CustomMenu is modal and pauses the game, which is the wrong shape for it (the Leader,
  // 26 Oct, agreeing with the original split). emoteService may keep its openNative call - with no entry here
  // swfFor returns "" and openNative answers false, so it draws its own panel exactly as before.
};

// Registered types that the GAMEPLAY layer also publishes under the same name. contextMenu is a generic list
// renderer shared by alchemy.js, business.js, charlevel.js and dungeons.js (each with its own widget id and
// its own dbo: events) as well as by playerActionService, so one dbo_context.swf serves both.
//
// Listing a type here is an acknowledgement, not a fix, and it is safe only because nothing routes gameplay
// widget packets to a native panel any more. Two things follow that the owning service must handle:
//  - a gameplay contextMenu arriving while the native one is up draws in the BROWSER beside it, because the
//    relay cannot close a panel it does not know about (the gamemode's panel-handoff rule only reaches
//    widgets the relay owns);
//  - the keys differ by caller: playerActionService uses pa:*, the gameplay callers use dbo:*. replayFor
//    sends each to the right place, so the SWF must pass whatever its payload gave it, verbatim.
export const SHARED_WITH_GAMEPLAY: ReadonlyArray<string> = ["contextMenu"];

export const HANDOFF_KEY = "native:handoff";
export const CLOSE_KEY = "close";
export const DBO_PREFIX = "dbo:";
// What the owning service is told when its native panel could not be drawn, so it can open its own browser
// menu instead. The service must treat this as "draw it yourself", not as a close.
export const FAILED_KEY = "native:failed";

// Shares the nativePanels setting with the gamemode panels, so one switch covers everything and a panel that
// misbehaves in a session goes back to the browser without a rebuild:
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
  | { do: "owner"; key: string; args: unknown[] }
  | { do: "close" }
  | { do: "handoff"; type: string; mode: string }
  | { do: "report"; text: string };

// What a key coming out of a native panel means. ONE table for both kinds of panel, so a gamemode panel and
// a client-service panel cannot disagree about what a key does.
//
// hasOwner is true when a client service registered a callback for the panel that is open. With an owner, a
// key the service namespaced for itself ("bountyBoard:post", "pa:trade") is delivered to it verbatim, which
// is what makes option 2 cost the service nothing but a call site. Without one, such a key is REPORTED: the
// browser path drops an unprefixed key silently, and a panel wired that way looks like a server that never
// answers, which is how three faults presented on 26 Oct.
//
// The order matters: a hand-off and a close do opposite things, so neither may fall through to the other.
export const replayFor = (key: string, args: unknown[], hasOwner?: boolean): Replay[] => {
  const k = String(key || "");
  if (!k) return [{ do: "report", text: "a native panel sent an empty key" }];

  const handoff = handoffOf(k, args);
  if (handoff) return [{ do: "handoff", type: handoff.type, mode: handoff.mode }];
  if (k === HANDOFF_KEY) {
    return [{ do: "report", text: `${HANDOFF_KEY} needs a type and a mode, got ${JSON.stringify(args)}` }];
  }

  // A bare "close" is the panel saying it has gone, which is the Scaleform equivalent of Escape in the
  // browser. dboRelayService.closeFocused answers Escape with { event: "close", args: [why] }, and THREE live
  // gamemode handlers hang off that packet: the player panel's nonces, the pigeon nonces, and abandoning a
  // half-finished read (dbo-gamemode.js 4224, 4609, 5400). A panel that closed without it would leak all
  // three, so this is parity, not politeness. The packet goes first, so a close that throws has still told
  // the server; the owner is told last, because its handler usually calls back in to close the menu.
  //
  // A Close button that should run the server's OWN close handler sends the widget's events.close string
  // instead - dbo: for a gamemode panel, the service's own prefix for a client-service one. Either way it is
  // just another key below, and the panel stays up until whoever owns it takes it down.
  if (k === CLOSE_KEY) {
    const why = args.length && args[0] ? String(args[0]) : "native";
    const out: Replay[] = [{ do: "server", event: "close", args: [why] }, { do: "close" }];
    if (hasOwner) out.push({ do: "owner", key: CLOSE_KEY, args: [why] });
    return out;
  }

  if (k.indexOf(DBO_PREFIX) === 0) {
    return [{ do: "server", event: k.slice(DBO_PREFIX.length), args }];
  }

  // The service's own namespaced key, handed back to it untouched.
  if (hasOwner) return [{ do: "owner", key: k, args }];

  return [{
    do: "report",
    text: `a native panel sent '${k}', which has no ${DBO_PREFIX} prefix and no service owns it: the browser path drops such a key silently, so this would do nothing`,
  }];
};

// ---- delivering a hand-off only once the panel has really gone ---------------------------------------------

export const HANDOFF_CLOSE_TIMEOUT_MS = 1000;

export interface PendingHandoff {
  type: string;
  mode: string;
  at: number;
}

// Ui.closeCustomMenu QUEUES a UI message, so the menu is still open for a frame or two after the call
// returns. NativeBackdropService hides the browser while a CustomMenu is open, so a hand-off delivered in the
// same pass as the close makes the owning service draw its composer into a hidden browser, and the player
// waits for the next 150 ms poll to see it. So the hand-off waits for the menu to actually go.
//
// "late" rather than waiting for ever: if the menu never closes, a hand-off that never arrives loses what the
// player was about to type, which is worse than a flicker. The caller should say so in the log.
export const handoffDue = (
  p: PendingHandoff | null, menuOpen: boolean, now: number,
): "wait" | "deliver" | "late" => {
  if (!p) return "wait";
  if (!menuOpen) return "deliver";
  return now - p.at >= HANDOFF_CLOSE_TIMEOUT_MS ? "late" : "wait";
};
