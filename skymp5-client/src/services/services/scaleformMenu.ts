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

// The panels this client can render natively. The server gates on these and falls back to the browser
// widget or to chat for a client that does not name them, so an old client keeps working untouched.
export const NATIVE_CAPS = ["native:prayer", "native:decor"];
export const CAPS_RETRY_MS = 5000;

export const MAX_PAYLOAD_CHARS = 60000;
// openCustomMenu queues a UI message, so the menu is not there when the call returns. If ready never
// arrives within this, the open failed and saying so is the result.
export const READY_TIMEOUT_MS = 5000;

export interface UiEvent {
  key: string;
  args: unknown[];
  // the frame the SWF saw _global.skse appear on, which is the number nobody had written down
  frame: number;
  // the SWF's own counter, so the same message arriving on both channels is handled once
  seq: number;
}

// MEASURED 26 Oct: skse.Log works from the movie (its line is in skse64.log) but SendModEvent never reached
// on('modEvent') - and nothing else in this client has ever subscribed to that event, so the path may simply
// not work in our build. The PULL direction is proven: Ui.setFloat already drives the vanilla HUD today.
// So the SWF also appends every message to a string the client reads with Ui.getString, and the client takes
// whichever channel arrives first. A record is seq + US + key + US + json, records joined by RS.
export const OUT_VAR = "_root.dboOut";
export const REC_SEP = "";
export const UNIT_SEP = "";

export interface Outbox {
  messages: UiEvent[];
  consumed: number;
}

// The SWF only ever APPENDS and the client never writes back, so there is no window in which a message
// written between a read and a clear is lost. The cursor is the client's alone.
export const parseOutbox = (raw: unknown, consumed: number): Outbox => {
  const s = String(raw === undefined || raw === null ? "" : raw);
  const from = Math.max(0, Math.min(consumed, s.length));
  const out: UiEvent[] = [];
  if (s.length <= from) return { messages: out, consumed: from };
  const tail = s.slice(from);
  // A trailing partial record (the SWF appends the separator last) is left for the next read
  const parts = tail.split(REC_SEP);
  const whole = parts.slice(0, parts.length - 1);
  let used = from;
  for (const rec of whole) {
    used += rec.length + REC_SEP.length;
    if (!rec) continue;
    const a = rec.indexOf(UNIT_SEP);
    const b = a < 0 ? -1 : rec.indexOf(UNIT_SEP, a + 1);
    if (a < 0 || b < 0) continue;
    const seq = Math.round(Number(rec.slice(0, a)) || 0);
    const key = rec.slice(a + 1, b);
    if (!key) continue;
    let args: unknown[] = [];
    const json = rec.slice(b + 1);
    if (json) {
      try {
        const parsed = JSON.parse(json);
        args = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        continue;
      }
    }
    out.push({ key, args, frame: 0, seq });
  }
  return { messages: out, consumed: used };
};

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
  // A mod event carries no sequence, so it can only be de-duplicated by key; the outbox is the numbered one.
  return { key, args, frame, seq: 0 };
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
  // how much of the SWF's outbox string this client has already handled
  outRead: number;
  lastSeq: number;
  viaOutbox: number;
  viaModEvent: number;
  foreignEvents: number;
}

export const newState = (): MenuState => ({
  phase: "closed", swf: "", json: "null", widgetId: 0,
  openedAt: 0, readyAt: 0, readyFrame: 0, sent: 0, foreignEvents: 0,
  outRead: 0, lastSeq: 0, viaOutbox: 0, viaModEvent: 0,
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
  s.outRead = 0;
  s.lastSeq = 0;
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

// True when this message has not been handled yet. The same message can arrive twice, once per channel.
export const isNew = (s: MenuState, m: UiEvent): boolean => {
  if (m.seq > 0) {
    if (m.seq <= s.lastSeq) return false;
    s.lastSeq = m.seq;
    return true;
  }
  // No sequence means it came by mod event. If the outbox has already delivered past this point, the
  // outbox copy wins and this is the duplicate.
  return s.lastSeq === 0;
};

export const summary = (s: MenuState): string => {
  // readyAt, not openedAt: testing a timestamp for truthiness makes the line claim "never became ready"
  // about a panel that did, and a diagnostic that lies is worse than none.
  const opened = s.readyAt > 0
    ? `${s.readyAt - s.openedAt}ms to ready on frame ${s.readyFrame}`
    : "never became ready";
  return `swf=${s.swf} phase=${s.phase} ${opened} payload=${s.json.length}ch sent=${s.sent} ` +
    `in=${s.viaOutbox}outbox/${s.viaModEvent}modevent` +
    (s.foreignEvents ? ` (ignored ${s.foreignEvents} mod events from elsewhere)` : "");
};
