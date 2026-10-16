// The game's pointer ("Cursor Menu") has two owners: SkyrimPlatform's focus (BrowserApiTilted.cpp SetFocused) and the game's own menus.
// Kept free of imports so a harness can drive it (tests/cursor-keeper-harness.js).

/** A panel's pointer closed this long under focus is put back */
export const RESHOW_AFTER_MS = 250;
/** At most one repair in this window */
export const RESHOW_GAP_MS = 2000;
/** Repairs that did not take this many times in a row stop until the pointer is seen up under focus again */
export const MAX_FAILED_RESHOWS = 3;
/** A vanilla menu open this long without the pointer is reported */
export const VANILLA_REPORT_MS = 1500;

/** Vanilla menus that show the pointer for a mouse player */
export const POINTER_MENUS = [
  "InventoryMenu", "ContainerMenu", "BarterMenu", "GiftMenu", "Journal Menu", "MapMenu", "TweenMenu",
  "Crafting Menu", "RaceSex Menu", "Console",
];

export const CONTROLLER_NOTICE = "Skyrim is in controller mode, which hides the mouse in the inventory, containers " +
  "and other game menus. To get the mouse back, set Controller to Off in Settings, Gameplay, or unplug the controller.";

export interface PanelCursorInput {
  focused: boolean;
  visible: boolean;
  cursorMenuOpen: boolean;
  /** A vanilla menu that takes the keyboard (browserService's live list) is open */
  blockingMenuOpen: boolean;
  now: number;
}

export interface PanelCursorState {
  /** When the pointer was first seen closed under focus, 0 while it is up */
  missingSince: number;
  lastReshow: number;
  failedReshows: number;
}

export function initialPanelCursorState(): PanelCursorState {
  return { missingSince: 0, lastReshow: 0, failedReshows: 0 };
}

/** "reshow": drop the focus and take it again in one frame, so SkyrimPlatform opens the pointer again */
export function keepPanelCursor(i: PanelCursorInput, s: PanelCursorState): { action: "reshow" | "none"; state: PanelCursorState } {
  // Under a vanilla menu the pointer is that menu's: owning it would close it on the next release
  if (!i.focused || !i.visible || i.blockingMenuOpen) return { action: "none", state: { ...s, missingSince: 0 } };
  if (i.cursorMenuOpen) return { action: "none", state: { ...s, missingSince: 0, failedReshows: 0 } };
  const since = s.missingSince > 0 ? s.missingSince : i.now;
  const state = { ...s, missingSince: since };
  // The frames between a focus and the game opening the pointer
  if (i.now - since < RESHOW_AFTER_MS) return { action: "none", state };
  if (state.failedReshows >= MAX_FAILED_RESHOWS) return { action: "none", state };
  if (state.lastReshow > 0 && i.now - state.lastReshow < RESHOW_GAP_MS) return { action: "none", state };
  // Closed since before the last repair: that one did not take
  if (state.lastReshow > 0 && since <= state.lastReshow) {
    state.failedReshows++;
    if (state.failedReshows >= MAX_FAILED_RESHOWS) return { action: "none", state };
  }
  state.lastReshow = i.now;
  return { action: "reshow", state };
}

/** One vanilla menu that shows the pointer, from its menuOpen */
export interface VanillaMenuWatch {
  name: string;
  openedAt: number;
  /** The browser had focus when it opened, so the release that followed closed the pointer under it */
  focusedAtOpen: boolean;
  /** When the pointer was first seen closed, 0 while it is up */
  missingSince: number;
  reported: boolean;
}

export function watchVanillaMenu(name: string, now: number, focusedAtOpen: boolean): VanillaMenuWatch | null {
  if (!POINTER_MENUS.includes(name)) return null;
  return { name, openedAt: now, focusedAtOpen, missingSince: 0, reported: false };
}

/** "report" once, when the menu has gone VANILLA_REPORT_MS without the pointer */
export function checkVanillaMenu(w: VanillaMenuWatch, cursorMenuOpen: boolean, now: number): "report" | "none" {
  if (cursorMenuOpen) {
    w.missingSince = 0;
    return "none";
  }
  if (!w.missingSince) w.missingSince = now;
  if (w.reported || now - w.missingSince < VANILLA_REPORT_MS) return "none";
  w.reported = true;
  return "report";
}

export function vanillaMenuPointerless(w: VanillaMenuWatch | null, now: number): boolean {
  return !!w && w.missingSince > 0 && now - w.missingSince >= VANILLA_REPORT_MS;
}

/** A mouse press in a pointerless vanilla menu in controller mode, not one our own release emptied: tell the player once */
export function controllerNoticeDue(w: VanillaMenuWatch | null, now: number, gamepadEnabled: boolean | null,
                                    alreadyShown: boolean): boolean {
  return !alreadyShown && gamepadEnabled === true && !!w && !w.focusedAtOpen && vanillaMenuPointerless(w, now);
}
