// Pure logic for a real Skyrim Scaleform panel driven from the server (Worker 4, 26 Oct).
// See _work\scaleform-ui-spike-1025.md. SWF sources are swf\<name>\, built by swf\build-swf.js.
//
// The wire is shared with the native panels (agreed with Worker 1, 26 Oct), and is deliberately the SAME
// contract the CEF widgets already use, so a panel's payload is the object the browser widget would get and
// the server's onUi handlers do not change:
//
//   data in   Ui.invokeString("CustomMenu", "_root.dboData", JSON.stringify(payload))   the whole payload, once
//   data out  skse.SendModEvent("dboUi", key + "\u0001" + JSON(args), frame)
//             key "ready" means the movie is up; "dbo:*" maps 1:1 onto the browser's
//             sendCustomPacket({ customPacketType: "dbo", event: key.slice(4), args, widget })
//
// Three constraints come from SKSE and from measurement, and they shape everything here:
//   the menu is ALWAYS named "CustomMenu", only ONE can be open at a time, OpenCustomMenu reads its flags
//   argument not at all, and _global.skse DOES NOT EXIST on the movie's first frame - so nothing may be
//   invoked until the SWF has said ready, and ready cannot come from frame 1.
//
// No imports, so a harness loads it on its own (tests/scaleform-menu-harness.js).

export const MENU_NAME = "CustomMenu";
export const SWF_NAME = "dbo_testmenu";

// Every panel sends under this one event name. on('modEvent') hears EVERY mod event in the game, from any
// installed mod, so the name is the only thing separating ours from somebody else's.
export const DBO_UI_EVENT = "dboUi";
// key and JSON args are joined by this, because a key cannot contain it and a separator that can appear in
// JSON would split the wrong payload.
export const UI_SEP = "\u0001";
// The browser's own prefix. dboRelayService strips exactly these four characters, and so do we.
export const DBO_PREFIX = "dbo:";

export const MAX_PAYLOAD_CHARS = 60000;
// openCustomMenu queues a UI message, so the menu is not there when the call returns. If ready never
// arrives within this, the open failed and saying so is the result.
export const READY_TIMEOUT_MS = 5000;

export interface UiEvent {
  key: string;
  args: unknown[];
  // the frame the SWF saw _global.skse appear on, which is the number nobody had written down
  frame: number;
}

// null means "not ours, leave it alone".
export const parseUiEvent = (eventName: string, strArg: string, numArg: number): UiEvent | null => {
  if (String(eventName || "") !== DBO_UI_EVENT) return null;
  const s = String(strArg || "");
  if (!s) return null;
  const at = s.indexOf(UI_SEP);
  const key = at < 0 ? s : s.slice(0, at);
  if (!key) return null;
  let args: unknown[] = [];
  if (at >= 0) {
    const rest = s.slice(at + 1);
    if (rest) {
      try {
        const parsed = JSON.parse(rest);
        // A panel that sends a non-array is a panel bug, not a reason to drop the event on the floor
        args = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return null;
      }
    }
  }
  const frame = Math.max(0, Math.round(Number(numArg) || 0));
  return { key, args, frame };
};

// What a "dbo:*" key becomes on the wire. Returns "" for a key that is not one, so the caller can tell.
export const serverEventName = (key: string): string =>
  String(key || "").indexOf(DBO_PREFIX) === 0 ? String(key).slice(DBO_PREFIX.length) : "";

export const payloadJson = (payload: unknown): string => {
  let s = "";
  try {
    s = JSON.stringify(payload === undefined ? null : payload);
  } catch {
    s = "null";
  }
  return s.length > MAX_PAYLOAD_CHARS ? "null" : s;
};

export type Phase = "closed" | "opening" | "ready";

export interface MenuState {
  phase: Phase;
  swf: string;
  json: string;
  widgetId: number;
  openedAt: number;
  readyAt: number;
  readyFrame: number;
  sent: number;
  foreignEvents: number;
}

export const newState = (): MenuState => ({
  phase: "closed", swf: "", json: "null", widgetId: 0,
  openedAt: 0, readyAt: 0, readyFrame: 0, sent: 0, foreignEvents: 0,
});

export type Action =
  | { do: "open"; swf: string }
  | { do: "push"; json: string }
  | { do: "close" }
  | { do: "report"; text: string };

export const planOpen = (s: MenuState, swf: unknown, payload: unknown, widgetId: unknown, now: number): Action[] => {
  s.swf = String(swf || SWF_NAME);
  s.json = payloadJson(payload);
  s.widgetId = Math.max(0, Math.round(Number(widgetId) || 0));
  if (s.phase === "ready") {
    // Already on screen: replace the contents, since only one custom menu can exist at a time. A re-sent
    // payload with the same nonce (the server's verdict) comes through here too.
    return [{ do: "push", json: s.json }];
  }
  s.phase = "opening";
  s.openedAt = now;
  s.readyAt = 0;
  return [{ do: "open", swf: s.swf }];
};

// The SWF said it is up. Only now can anything be invoked on it: before ready, _global.skse does not exist
// and the movie may not be built.
export const planReady = (s: MenuState, frame: number, now: number): Action[] => {
  if (s.phase === "closed") return [];
  s.phase = "ready";
  s.readyAt = now;
  s.readyFrame = Math.max(0, Math.round(Number(frame) || 0));
  return [{ do: "push", json: s.json }];
};

export const planClose = (s: MenuState): Action[] => {
  if (s.phase === "closed") return [];
  s.phase = "closed";
  return [{ do: "close" }];
};

// Called every update. Catches the open that never arrived, which is the failure this exists to find, and
// is what closed the menu by itself on 26 Oct when the SWF could not answer.
export const planTick = (s: MenuState, now: number): Action[] => {
  if (s.phase !== "opening" || !s.openedAt) return [];
  if (now - s.openedAt < READY_TIMEOUT_MS) return [];
  s.phase = "closed";
  return [
    { do: "report", text: `openCustomMenu(${s.swf}) never reported ready within ${READY_TIMEOUT_MS}ms` },
    { do: "close" },
  ];
};

export const summary = (s: MenuState): string => {
  // readyAt, not openedAt: testing a timestamp for truthiness makes the line claim "never became ready"
  // about a panel that did, and a diagnostic that lies is worse than none.
  const opened = s.readyAt > 0
    ? `${s.readyAt - s.openedAt}ms to ready on frame ${s.readyFrame}`
    : "never became ready";
  return `swf=${s.swf} phase=${s.phase} ${opened} payload=${s.json.length}ch sent=${s.sent}` +
    (s.foreignEvents ? ` (ignored ${s.foreignEvents} mod events from elsewhere)` : "");
};
