// Pure logic for a real Skyrim Scaleform panel, driven from the server (Worker 4, 25 Oct).
// See _work\scaleform-ui-spike-1025.md. The SWF source is swf\dbo_testmenu\, built by swf\build-swf.js.
//
// Three constraints come from SKSE's own source and shape everything here:
//   the menu is ALWAYS named "CustomMenu", only ONE can be open at a time, and it is modal and PAUSES the game.
//   The flags argument of OpenCustomMenu is read by nothing, so we pass 0.
//
// No imports, so a harness loads it on its own (tests/scaleform-menu-harness.js).

export const MENU_NAME = "CustomMenu";
export const SWF_NAME = "dbo_testmenu";
// The AS2 sends this as the mod event name. on('modEvent') hears EVERY mod event in the game, from any
// installed mod, so the name is the only thing separating ours from somebody else's.
export const DBO_EVENT = "dboTestMenu";

// The panel draws nine rows; more would need scrolling, which this test does not have.
export const MAX_ROWS = 9;
export const MAX_ROW_CHARS = 90;
export const MAX_TITLE_CHARS = 60;
// openCustomMenu queues a UI message, so the menu is not there when the call returns. If "ready" never
// arrives within this, the open failed and saying so is the result.
export const READY_TIMEOUT_MS = 5000;

export type MenuEventKind = "ready" | "row" | "close";

export interface MenuEvent {
  kind: MenuEventKind;
  index: number;
}

// null means "not ours, leave it alone".
export const parseMenuEvent = (eventName: string, strArg: string, numArg: number): MenuEvent | null => {
  if (String(eventName || "") !== DBO_EVENT) return null;
  const s = String(strArg || "");
  if (s === "ready") return { kind: "ready", index: 0 };
  if (s === "close") return { kind: "close", index: -1 };
  if (s.indexOf("row:") === 0) {
    // The AS2 puts the index in both fields; prefer the string and fall back to the number, because they
    // travel as separate fields and this test is partly about finding out whether both survive.
    const fromStr = parseInt(s.slice(4), 10);
    const i = isFinite(fromStr) && !isNaN(fromStr) ? fromStr : Math.round(Number(numArg));
    if (!isFinite(i) || isNaN(i) || i < 0 || i >= MAX_ROWS) return null;
    return { kind: "row", index: i };
  }
  return null;
};

export const sanitiseTitle = (title: unknown): string =>
  String(title === undefined || title === null ? "" : title).slice(0, MAX_TITLE_CHARS);

// Ui.invokeStringA takes a string array and the AS2 function receives the elements as separate arguments.
export const sanitiseRows = (rows: unknown): string[] => {
  if (!Array.isArray(rows)) return [];
  const out: string[] = [];
  for (let i = 0; i < rows.length && out.length < MAX_ROWS; i++) {
    const r = rows[i];
    if (r === undefined || r === null) continue;
    const s = String(r).slice(0, MAX_ROW_CHARS);
    if (s.length) out.push(s);
  }
  return out;
};

export type Phase = "closed" | "opening" | "ready";

export interface MenuState {
  phase: Phase;
  title: string;
  rows: string[];
  openedAt: number;
  // what the session needs to report: did it open, did the graph answer, was anything clicked
  readyAt: number;
  clicks: number;
  foreignEvents: number;
}

export const newState = (): MenuState => ({
  phase: "closed", title: "", rows: [], openedAt: 0, readyAt: 0, clicks: 0, foreignEvents: 0,
});

export type Action =
  | { do: "open"; swf: string }
  | { do: "push"; title: string; rows: string[] }
  | { do: "close" }
  | { do: "report"; text: string };

// A request from the server to show the panel.
export const planOpen = (s: MenuState, title: unknown, rows: unknown, now: number): Action[] => {
  const t = sanitiseTitle(title);
  const r = sanitiseRows(rows);
  s.title = t;
  s.rows = r;
  if (s.phase === "ready") {
    // Already on screen: just replace the contents, since only one custom menu can exist.
    return [{ do: "push", title: t, rows: r }];
  }
  s.phase = "opening";
  s.openedAt = now;
  s.readyAt = 0;
  return [{ do: "open", swf: SWF_NAME }];
};

// The SWF said it had built itself. Only now can anything be invoked on it.
export const planReady = (s: MenuState, now: number): Action[] => {
  if (s.phase === "closed") return [];
  s.phase = "ready";
  s.readyAt = now;
  return [{ do: "push", title: s.title, rows: s.rows }];
};

export const planClose = (s: MenuState): Action[] => {
  if (s.phase === "closed") return [];
  s.phase = "closed";
  return [{ do: "close" }];
};

// Called every update. Catches the open that never arrived, which is the failure this test exists to find.
export const planTick = (s: MenuState, now: number): Action[] => {
  if (s.phase !== "opening" || !s.openedAt) return [];
  if (now - s.openedAt < READY_TIMEOUT_MS) return [];
  s.phase = "closed";
  return [
    { do: "report", text: `openCustomMenu(${SWF_NAME}) never reported ready within ${READY_TIMEOUT_MS}ms` },
    { do: "close" },
  ];
};

export const summary = (s: MenuState): string => {
  // readyAt, not openedAt: testing a timestamp for truthiness makes the line claim "never became ready"
  // about a panel that did, and a diagnostic that lies is worse than none.
  const opened = s.readyAt > 0 ? `${s.readyAt - s.openedAt}ms to ready` : "never became ready";
  return `swf=${SWF_NAME} phase=${s.phase} ${opened} rows=${s.rows.length} clicks=${s.clicks}` +
    (s.foreignEvents ? ` (ignored ${s.foreignEvents} mod events from elsewhere)` : "");
};
