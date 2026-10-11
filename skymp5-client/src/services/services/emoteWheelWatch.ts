// What the emote wheel (B, widget 24) does while it is open, kept free of imports so a harness can drive it
// (tests/emote-wheel-watch-harness.js).
//
// karta.gina, 10 Oct: "every time I click on B the UI freezes so hard I have that in my face for the next 5 minutes ...
// I've literally never used a gesture on the server because I couldn't even click on it". Two ways the wheel can stay on
// screen with nothing to click:
// - The browser loses the cursor while the wheel is still drawn. Anything that calls closeFormMenu or setFocused(false)
//   does it: a server panel that opened over the wheel and then closed (dboRelayService), the release-cursor key, a
//   panel handing focus back. The wheel's own close never runs, so its overlay covers the screen, no cursor, and B does
//   nothing because the service still thinks the wheel is open.
// - B pressed again while it is open was ignored, so the key that opened it could not take it away.
// The front's own cost was the other half (skymp5-front tests/emote-wheel-cost-harness.js).

/** Grace after opening before a missing cursor counts: setFocused lands on the next frames */
export const OPEN_GRACE_MS = 1000;
/** How long the wheel may be drawn without the cursor before it is taken down */
export const UNFOCUSED_CLOSE_MS = 1500;

export interface WheelWatchState {
  menuOpen: boolean;
  focused: boolean;
  openedAt: number;
  /** When the browser was first seen without the cursor while open, 0 while it has it */
  unfocusedSince: number;
  now: number;
}

/** What to do on a tick: "close" takes the wheel down; "keep" leaves it. unfocusedSince is the value to store. */
export function wheelWatch(s: WheelWatchState): { action: "close" | "keep"; unfocusedSince: number } {
  if (!s.menuOpen) return { action: "keep", unfocusedSince: 0 };
  if (s.focused) return { action: "keep", unfocusedSince: 0 };
  if (s.now - s.openedAt < OPEN_GRACE_MS) return { action: "keep", unfocusedSince: 0 };
  const since = s.unfocusedSince > 0 ? s.unfocusedSince : s.now;
  return { action: s.now - since >= UNFOCUSED_CLOSE_MS ? "close" : "keep", unfocusedSince: since };
}

/** The wheel's key pressed: open it when closed, close it when open (it used to be ignored while open) */
export function wheelKeyAction(menuOpen: boolean): "open" | "close" {
  return menuOpen ? "close" : "open";
}
