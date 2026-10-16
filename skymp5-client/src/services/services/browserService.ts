
import { QueryKeyCodeBindings } from "../events/queryKeyCodeBindings";

import { ClientListener, CombinedController, Sp } from "./clientListener";
import { FormView } from "../../view/formView";
import { showSystemNotification } from "./systemNotification";
import { forgetDeferredFocus, isConsoleOpen, keybindOverride, readMenuKeyCode, takeDeferredFocus } from "./widgetMenuUtil";
import { badMenuAction } from "./badMenuPolicy";
import { logTrace } from "../../logging";
import { PlacementService } from "./placementService";
import { BrowserMessageEvent, ButtonEvent, DxScanCode, InputDeviceType, Menu, MenuCloseEvent, MenuOpenEvent } from "skyrimPlatform";
import { CONTROLLER_NOTICE, MAX_FAILED_RESHOWS, VanillaMenuWatch, checkVanillaMenu, controllerNoticeDue, initialPanelCursorState, keepPanelCursor, watchVanillaMenu } from "./cursorKeeper";

const MAX_CURSOR_NOTES = 8;

export const unfocusEventString = `window.dispatchEvent(new CustomEvent('skymp5-client:browserUnfocused', {}))`;
export const focusEventString = `window.dispatchEvent(new CustomEvent('skymp5-client:browserFocused', {}))`;
const chatKeyFocusEventString = `window.dispatchEvent(new CustomEvent('skymp5-client:chatKeyFocused', {}))`;

export class BrowserService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();

    this.sp.browser.setVisible(false);

    // Key bindings are configurable from the launcher's client settings
    // DragonBreak bindings: F1 nametags, F2 hide the HUD, F6 focus chat (also T / Enter), F8 free cursor (F7 opens the admin panel)
    this.nametagKey = readMenuKeyCode(this.sp, "nametagKeyCode", DxScanCode.F1);
    this.hideUiKey = readMenuKeyCode(this.sp, "hideUiKeyCode", DxScanCode.F2);
    this.freeCursorKey = readMenuKeyCode(this.sp, "freeCursorKeyCode", DxScanCode.F8);
    try {
      const settings = this.sp.settings["skymp5-client"] as any;
      if (settings && Array.isArray(settings["chatFocusKeyCodes"])) {
        const codes = settings["chatFocusKeyCodes"].filter((c: unknown) => typeof c === "number");
        if (codes.length > 0) {
          this.chatFocusKeys = codes as DxScanCode[];
        }
      }
    } catch {
      // fall back to defaults
    }
    // F3, Settings, General rebinds the chat key (T), keeping Enter and F6
    const chatKey = keybindOverride(this.sp, "chatKeyCode");
    if (chatKey !== null) this.chatFocusKeys = [DxScanCode.Enter, chatKey as DxScanCode, DxScanCode.F6].filter((k) => k > 0);

    this.controller.emitter.on("queryKeyCodeBindings", (e) => this.onQueryKeyCodeBindings(e));
    // A front reload must never leave the player with a hidden interface
    this.controller.emitter.on("browserWindowLoaded", () => this.setUiHidden(false));
    // A middle-button release-mouse key: while a window has the browser focus the game hears no mouse button, and the
    // page receives the middle one only, so the page hands the cursor back itself (front utils/mouseMenuKeys.js)
    this.controller.emitter.on("browserWindowLoaded", () => this.sp.browser.executeJavaScript(`window.__dboFreeCursorKey = ${Number(this.freeCursorKey) || 0}`));
    this.controller.once("update", () => this.onceUpdate());
    this.controller.on("browserMessage", (e) => this.onBrowserMessage(e));
    this.controller.on("menuOpen", (e) => this.onMenuOpen(e));
    this.controller.on("menuClose", (e) => this.onMenuClose(e));
    this.controller.emitter.on("connectionDisconnect", () => this.dropDeferredFocus("disconnected"));
    this.controller.on("update", () => this.onUpdateCursor());
    this.controller.on("buttonEvent", (e) => this.onButtonEventCursor(e));
  }

  private onQueryKeyCodeBindings(e: QueryKeyCodeBindings) {
    // Same gate as the menu hotkeys: never fires from typed chat text or the console
    if (e.isDown([this.hideUiKey]) && !this.sp.browser.isFocused() && !isConsoleOpen(this.sp)) {
      this.setUiHidden(!this.uiHidden);
    }
    if (e.isDown([this.nametagKey]) && !this.sp.browser.isFocused() && !isConsoleOpen(this.sp)) {
      FormView.isDisplayingNicknames = !FormView.isDisplayingNicknames;
      showSystemNotification(this.sp, FormView.isDisplayingNicknames ? "Nametags shown" : "Nametags hidden");
    }
    // A hidden page must not take keyboard focus away from the game
    const canFocus = !this.uiHidden && this.badMenusOpen.size === 0;
    if (canFocus && e.isDown([this.freeCursorKey])) {
      const newState = !this.sp.browser.isFocused();
      this.sp.browser.setFocused(newState);
      if (newState) {
        this.sp.browser.executeJavaScript(focusEventString);
      } else {
        this.sp.browser.executeJavaScript(unfocusEventString);
      }
    }
    // Enter also confirms dialogue lines and message boxes; taking chat focus there left the keyboard locked.
    // It is also the F7 Place tool's "place" key: focusing the chat on it took the keyboard away from the game, so
    // no placement was ever sent (2026-09-28). While placing, only the other chat keys (T, F6) open the chat.
    const focusKeys = this.isPlacing() ? this.chatFocusKeys.filter((key) => key !== DxScanCode.Enter) : this.chatFocusKeys;
    if (canFocus && !this.sp.browser.isFocused() && !this.sp.Utility.isInMenuMode() &&
        focusKeys.some((key) => e.isDown([key]))) {
      this.sp.browser.setFocused(true);
      this.sp.browser.executeJavaScript(focusEventString);
      // The dedicated chat key (default T, never Enter) also jumps to Local
      const chatKeyOnly = this.chatFocusKeys.filter((key) => key !== DxScanCode.Enter);
      if (chatKeyOnly.some((key) => e.isDown([key]))) {
        this.sp.browser.executeJavaScript(chatKeyFocusEventString);
      }
    }
    if (e.isDown([DxScanCode.Escape])) {
      this.unfocus();
    }
  }

  private onceUpdate() {
    if (!this.uiHidden) {
      this.sp.browser.setVisible(true);
    }
  }

  private onBrowserMessage(e: BrowserMessageEvent) {
    const onFrontLoadedEventKey = "front-loaded";

    if (e.arguments[0] === onFrontLoadedEventKey) {
      this.controller.emitter.emit("browserWindowLoaded", {});
    }

    // After hitting enter, unfocuses the chat
    if (e.arguments[0] === "cef::browser:unfocus") {
      this.unfocus();
    }

    // The page opened the chat on an Enter the game never saw: something left the browser holding the keyboard
    if (e.arguments[0] === "chat:enterUnfocused") {
      const note = (globalThis as any).__dboDiagNote;
      if (typeof note === "function") note("chatfocus", `Enter reached the page with nothing focused; widgets ${String(e.arguments[1] ?? "").slice(0, 200)}`);
    }
  }

  // Character select sets this while it holds the screen (characterSelectService)
  private ownPanelHasScreen(): boolean {
    return (globalThis as any).__dboCharacterSelectOpen === true;
  }

  private mainMenuOpenNow(): boolean | undefined {
    try {
      return this.sp.Ui.isMenuOpen(Menu.Main);
    } catch (err) {
      return undefined;
    }
  }

  // badMenuPolicy.ts holds the decision and says why a late "Main Menu" is the one that has to be ignored
  // The wish for focus is per session but lives in module scope, so it outlives a disconnect and a quit to the main
  // menu. Left standing, the next session's first menu close would hand focus to a browser holding no panel - the very
  // dead-input symptom the deferral exists to remove. forgetDeferredFocus also bumps the generation, so a handover
  // already scheduled for this frame is cancelled with it.
  private dropDeferredFocus(why: string) {
    forgetDeferredFocus();
    logTrace("browserService", `deferred focus dropped: ${why}`);
  }

  private onMenuOpen(e: MenuOpenEvent) {
    // Before the main-menu exemption below: quitting to the main menu ends the session whether or not a disconnect
    // event follows, and nothing of ours should still be waiting to take the keyboard afterwards.
    if (e.name === Menu.Main) this.dropDeferredFocus("main menu");
    if (this.isBadMenu(e.name)) {
      const isMain = e.name === Menu.Main;
      const action = badMenuAction({
        isBadMenu: true,
        isMainMenu: isMain,
        openNow: isMain ? this.mainMenuOpenNow() : true,
        ownPanelHasScreen: this.ownPanelHasScreen(),
      });
      if (action === 'ignore') return;   // nothing recorded either, so canFocus stays true
      this.vanillaWatch = watchVanillaMenu(e.name, Date.now(), this.sp.browser.isFocused()) ?? this.vanillaWatch;
      // A hidden browser that keeps focus swallows every key with no cursor to show it
      this.unfocus();
      this.sp.browser.setVisible(false);
      this.badMenusOpen.add(e.name);
    } else if (e.name === Menu.HUD && !this.uiHidden) {
      this.sp.browser.setVisible(true);
    }
  }

  private onMenuClose(e: MenuCloseEvent) {
    if (this.vanillaWatch && this.vanillaWatch.name === e.name) this.vanillaWatch = null;
    if (this.badMenusOpen.delete(e.name)) {
      // Asked of the engine, not of the record: a menu whose close never arrived must not hold the cursor for ever
      const live = this.liveBlockingMenus();
      if (live.length === 0 && !this.uiHidden) {
        this.sp.browser.setVisible(true);
        // A panel opened while that menu held the keyboard deferred its focus rather than stealing it; it gets it now
        takeDeferredFocus(this.sp, this.controller, e.name);
      }
    }

    if (e.name === Menu.HUD) {
      this.sp.browser.setVisible(false);
    }
  }

  private unfocus() {
    if (this.sp.browser.isFocused()) {
      this.sp.browser.setFocused(false);
      this.sp.browser.executeJavaScript(unfocusEventString);
    }
  }

  // Hands the keyboard back to the game the way Escape does (widgetMenuUtil releaseFocusBeforeVanillaMenu)
  releaseFocus(): void {
    this.unfocus();
  }

  private cursorMenuOpen(): boolean {
    try {
      return this.sp.Ui.isMenuOpen(Menu.Cursor);
    } catch (e) {
      return true;   // unreadable: never act on a guess
    }
  }

  // The launcher writes it off; the game turns it back on when it sees a controller
  private gamepadEnabled(): boolean | null {
    try {
      return this.sp.Utility.getINIBool("bGamepadEnable:MAIN") || this.sp.Utility.getINIBool("bGamepadEnable:Main");
    } catch (e) {
      return null;
    }
  }

  // SKSE Game.UsingGamepad: whether the game reads a gamepad now, which the setting alone does not say
  private gamepadInUse(): boolean | null {
    try {
      return this.sp.Game.usingGamepad();
    } catch (e) {
      return null;
    }
  }

  // Capped: the relay's per-session line budget is shared with every other diagnostic
  private diagNote(kind: string, text: string): void {
    if (this.cursorNotes >= MAX_CURSOR_NOTES) return;
    this.cursorNotes++;
    const note = (globalThis as any).__dboDiagNote;
    if (typeof note === "function") note(kind, text);
  }

  // cursorKeeper.ts: a vanilla menu closing under a focused panel takes the panel's pointer, which SkyrimPlatform never reopens
  private onUpdateCursor(): void {
    const now = Date.now();
    if (this.vanillaWatch) this.watchVanillaCursor(now);
    let focused = false;
    try {
      focused = this.sp.browser.isFocused();
    } catch (e) {
      return;
    }
    if (!focused && this.panelCursor.missingSince === 0) return;
    const input = focused
      ? { focused, visible: this.sp.browser.isVisible(), cursorMenuOpen: this.cursorMenuOpen(), blockingMenuOpen: this.liveBlockingMenus().length > 0, now }
      : { focused, visible: false, cursorMenuOpen: false, blockingMenuOpen: false, now };
    const failedBefore = this.panelCursor.failedReshows;
    const { action, state } = keepPanelCursor(input, this.panelCursor);
    const since = state.missingSince;
    this.panelCursor = state;
    if (state.failedReshows >= MAX_FAILED_RESHOWS && failedBefore < MAX_FAILED_RESHOWS) {
      this.diagNote("cursor", `panel pointer did not come back ${MAX_FAILED_RESHOWS} times, no more repairs until it is up again`);
    }
    if (action !== "reshow") return;
    this.panelReshows++;
    this.sp.browser.setFocused(false);
    this.sp.browser.setFocused(true);
    this.diagNote("cursor", `panel pointer put back after ${now - since} ms closed under focus (${this.panelReshows} this session)`);
  }

  private watchVanillaCursor(now: number): void {
    const w = this.vanillaWatch as VanillaMenuWatch;
    let open = true;
    try {
      open = this.sp.Ui.isMenuOpen(w.name);
    } catch (e) { /* unreadable: keep watching */ }
    if (!open) {
      this.vanillaWatch = null;
      return;
    }
    if (checkVanillaMenu(w, this.cursorMenuOpen(), now) !== "report") return;
    this.diagNote("cursor", `${w.name} open ${now - w.openedAt} ms, no pointer for ${now - w.missingSince} ms; ` +
      `browser had focus when it opened ${w.focusedAtOpen}; controller mode ${this.gamepadEnabled()}; gamepad in use ${this.gamepadInUse()}`);
  }

  // A mouse press in a vanilla menu that has no pointer
  private onButtonEventCursor(e: ButtonEvent): void {
    if (this.controllerNoticeShown || !this.vanillaWatch || !e.isDown || e.device !== InputDeviceType.Mouse) return;
    if (!controllerNoticeDue(this.vanillaWatch, Date.now(), this.gamepadEnabled(), this.controllerNoticeShown)) return;
    this.controllerNoticeShown = true;
    showSystemNotification(this.sp, CONTROLLER_NOTICE);
    this.diagNote("cursor", `controller notice shown in ${this.vanillaWatch.name}`);
  }

  private isBadMenu(menu: string) {
    return this.badMenus.includes(menu as Menu);
  }

  isUiHidden(): boolean {
    return this.uiHidden;
  }

  // Menus close via uiHiddenChanged; showing under a blocking vanilla menu is finished by onMenuClose
  setUiHidden(hidden: boolean): void {
    if (this.uiHidden === hidden) return;
    this.uiHidden = hidden;
    if (hidden) this.unfocus();
    this.controller.emitter.emit("uiHiddenChanged", { hidden });
    if (hidden) {
      this.sp.browser.setVisible(false);
    } else if (this.badMenusOpen.size === 0) {
      this.sp.browser.setVisible(true);
    }
  }

  // Typing in the console must not reach menu hotkeys or push-to-talk
  isConsoleOpen(): boolean {
    return this.badMenusOpen.has(Menu.Console);
  }

  // Any menu that swallows gameplay input (inventory, map, console, ...)
  isBlockingMenuOpen(): boolean {
    return this.badMenusOpen.size > 0;
  }

  // Which recorded menus are STILL open, asked of the engine rather than trusted from the record. A close event that
  // never arrives would otherwise leave an entry behind for ever, and since panels now decide focus on this, a stale
  // entry would leave every panel unfocusable until the player alt-tabbed. Anything no longer open is pruned here.
  //
  // Main Menu is never counted: 0.3.67 ships a blank startmenu.swf, so the main menu can sit open underneath our own
  // screen, and a panel that deferred to it would never get the cursor. Character select is exactly that case.
  liveBlockingMenus(): string[] {
    const live: string[] = [];
    const recorded: string[] = [];
    this.badMenusOpen.forEach((name) => recorded.push(name));
    for (const name of recorded) {
      let open = true;
      try {
        open = this.sp.Ui.isMenuOpen(name);
      } catch (e) {
        open = true;   // unreadable: leave the record alone rather than prune on a guess
      }
      if (!open) {
        this.badMenusOpen.delete(name);
        continue;
      }
      if (name !== Menu.Main) live.push(name);
    }
    return live;
  }

  // The recorded menus as they stand, the engine not asked and nothing pruned (diagnostic lines)
  recordedBlockingMenus(): string[] {
    const recorded: string[] = [];
    this.badMenusOpen.forEach((name) => recorded.push(name));
    return recorded;
  }

  private badMenusOpen = new Set<string>();
  private uiHidden = false;
  private panelCursor = initialPanelCursorState();
  private panelReshows = 0;
  private vanillaWatch: VanillaMenuWatch | null = null;
  private controllerNoticeShown = false;
  private cursorNotes = 0;

  private nametagKey: DxScanCode = DxScanCode.F1;
  private hideUiKey: DxScanCode = DxScanCode.F2;
  private freeCursorKey: DxScanCode = DxScanCode.F8;
  private chatFocusKeys: DxScanCode[] = [DxScanCode.Enter, DxScanCode.T, DxScanCode.F6];

  // A lookup that throws must never stop the chat keys from working
  private isPlacing(): boolean {
    try {
      return this.controller.lookupListener(PlacementService).isActive();
    } catch {
      return false;
    }
  }

  private readonly badMenus: Menu[] = [
    Menu.Barter,
    Menu.Book,
    Menu.Container,
    Menu.Crafting,
    Menu.Gift,
    Menu.Inventory,
    Menu.Journal,
    Menu.Lockpicking,
    Menu.Loading,
    Menu.Map,
    Menu.RaceSex,
    Menu.Stats,
    Menu.Tween,
    Menu.Console,
    Menu.Main,
  ];
}
