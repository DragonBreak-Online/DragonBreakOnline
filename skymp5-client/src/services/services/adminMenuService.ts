import { ClientListener, CombinedController, Sp } from "./clientListener";
import { sendCustomPacket, parseCustomPacket, notifyNextUpdate } from "./customPacketUtil";
import { openFormMenu, refreshFormMenu, closeFormMenu, readMenuKeyCode, isMenuKeyPressBlocked } from "./widgetMenuUtil";
import { buttonKeyCode } from "./mouseKeys";
import { RemoteServer } from "./remoteServer";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { AuthGameData, authGameDataStorageKey } from "../../features/authModel";
import { weekdayOf } from "./calendar";
import { ActiveEffectApplyRemoveEvent, BrowserMessageEvent, ButtonEvent, DxScanCode, InputDeviceType } from "skyrimPlatform";
import { ScaleformMenuService } from "./scaleformMenuService";
import { PlacementService } from "./placementService";
import { CLOSE_KEY, FAILED_KEY } from "./nativeWidgets";
import { AdminCatalogs, AdminUi, STAFF_WIDGETS, adminNativeView } from "./adminNativeView";

declare const window: any;

// Tabbed admin panel (default F7, launcher-configurable via adminMenuKeyCode).
// Every player gets the Debug tab at once; the admin tabs appear only when the server answers adminMenuRequest (Discord roles / profile ids).
// Renders as the dedicated 'adminPanel' widget (skymp5-front features/adminPanel), trade-style: pure data in, sendMessage events out.
// The Players tab also grants mastery hours (admin::masterygrant target amount / admin::masteryreset target -> adminAction masteryGrant / masteryReset).

const WIDGET_ID = 23;
// The native panel's own key: what it shows ([JSON of AdminUi]), answered with that page (adminNativeView.ts)
const NATIVE_UI_KEY = "admin::ui";
const STAFF_IDS = [STAFF_WIDGETS.gmcalls, STAFF_WIDGETS.enchantCatalog, STAFF_WIDGETS.enchantItems, STAFF_WIDGETS.thievery];
const PLAYER_FORM_ID = 0x14;
const DEBUG_REFRESH_MS = 5000;
const EFFECTS_STORAGE_KEY = "adminDebugEffects";
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const GLOBAL_HOUR = 0x38;
const GLOBAL_DAY = 0x37;
const GLOBAL_MONTH = 0x36;
const GLOBAL_YEAR = 0x35;
const GLOBAL_DAYS_PASSED = 0x39;

const events = {
  tp: "admin::tp",
  summon: "admin::summon",
  kick: "admin::kick",
  ban: "admin::ban",
  tpLoc: "admin::tploc",
  mode: "admin::mode",
  refresh: "admin::refresh",
  debugRefresh: "admin::debugrefresh",
  close: "admin::close",
  npcList: "admin::npclist",
  npcAdd: "admin::npcadd",
  npcTp: "admin::npctp",
  npcReset: "admin::npcreset",
  npcDelete: "admin::npcdelete",
  masteryGrant: "admin::masterygrant",
  masteryReset: "admin::masteryreset",
  // F7 panel tabs: any adminAction (action + fields) and the two data requests
  action: "admin::action",
  request: "admin::request",
};

// Requests the front may send through admin::request; everything else is refused here
const PANEL_REQUESTS = new Set(["adminItemsRequest", "adminMasteryRequest", "adminLocationsRequest", "adminPlaceablesRequest",
  "adminPlacementsRequest", "adminPlacementRemove", "adminPlacementGoto", "adminPlaceMeta", "adminPlaceSearch", "adminPlaceUndo",
  "adminPlaceSets", "adminPlaceSetSave", "adminPlaceSetPlace", "adminPlaceSetDelete", "adminPlaceGroupClear", "adminWarband", "adminRaid", "adminWarbandView"]);

interface DebugServer {
  name: string;
  offsetMs: number;
  tzOffsetMin: number;
}

interface DebugData {
  account: string;
  character: string;
  formId: string;
  actorId: string;
  profileId: number;
  server: DebugServer | null;
  pos: number[];
  cell: { id: string; name: string; interior: boolean; world: string; location: string } | null;
  heading: { deg: number; compass: string };
  target: { name: string; id: string; dist: number } | null;
  av: { health: number[]; magicka: number[]; stamina: number[] };
  gameTime: { hour: number; day: number; month: number; year: number; weekday: number } | null;
  hoursOffset: number;
  localTime: number;
  effects: Array<{ id: string; name: string; elapsedSec: number }>;
  updatedAt: number;
}

type EffectMap = Map<number, { name: string; since: number }>;

// Injected into the browser-side widget setter (module scope, not this.*)
let panelData: any = { admin: false, debug: null as DebugData | null, players: [], locations: [], modes: [], npcZones: [], npcZonesAt: 0, caps: { ban: true }, tier: "", mastery: null, events };

function hex(id: number): string {
  return id.toString(16);
}

function safe<T>(fn: () => T | null | undefined, fallback: T): T {
  try {
    const v = fn();
    return v === undefined || v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export class AdminMenuService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.menuKey = readMenuKeyCode(sp, "adminMenuKeyCode", DxScanCode.F7);
    this.controller.on("buttonEvent", (e) => this.onButtonEvent(e));
    this.controller.on("browserMessage", (e) => this.onBrowserMessage(e));
    this.controller.on("update", () => this.onUpdate());
    this.controller.on("effectStart", (e) => this.onEffect(e, true));
    this.controller.on("effectFinish", (e) => this.onEffect(e, false));
    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.emitter.on("uiHiddenChanged", (e) => { if (e.hidden && this.menuOpen) this.closeMenu(); });
  }

  private onButtonEvent(e: ButtonEvent) {
    // A key, or a bindable mouse button as 256 + the button (mouseKeys.ts); never the gamepad
    const code = buttonKeyCode(e);
    if (code === null || !e.isDown) return;
    // The native panel takes Escape itself: it cancels typing, a picker or an armed button before it closes
    if (code === DxScanCode.Escape && this.menuOpen) {
      if (!this.native) this.closeMenu();
      return;
    }
    if (code !== this.menuKey) return;
    if (this.menuOpen) {
      // Never under the typing: the menu would go with the game still taking keys as text
      if (this.native && this.ui.typing) return;
      this.closeMenu();
      return;
    }
    if (isMenuKeyPressBlocked(this.sp, this.controller, e)) return;
    this.openMenu();
  }

  // Admin data is cleared on every open so a demoted admin never sees stale tabs
  private openMenu(): void {
    this.ui = { tab: this.ui.tab };
    panelData.admin = false;
    panelData.players = [];
    panelData.locations = [];
    panelData.modes = [];
    panelData.npcZones = [];
    panelData.mastery = null;
    panelData.bans = [];
    panelData.masteryTarget = null;
    this.refreshDebug();
    this.showMenu();
    sendCustomPacket(this.controller, { customPacketType: "debugInfoRequest" });
    sendCustomPacket(this.controller, { customPacketType: "adminMenuRequest" });
  }

  private onUpdate(): void {
    if (!this.menuOpen || Date.now() - this.lastDebugAt < DEBUG_REFRESH_MS) return;
    this.refreshDebug();
    // The native panel is sent the debug block on its Debug tab only, so another tab is not redrawn under the typing
    if (!this.native || !this.ui.tab || this.ui.tab === "debug") this.pushData();
  }

  private onCustomPacketMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content) return;
    if (content["customPacketType"] === "dboWidget") {
      const w = content["widget"] as Record<string, unknown> | undefined;
      const id = w ? Number(w["id"]) : NaN;
      if (w && w["type"] === "staffData" && STAFF_IDS.indexOf(id) !== -1) {
        this.staff[id] = w;
        this.staffAt[id] = Date.now();
        if (this.native) this.pushData();
      }
      return;
    }
    if (content["customPacketType"] === "adminMenu") {
      const caps = content["caps"];
      panelData = {
        admin: true,
        debug: panelData.debug,
        players: Array.isArray(content["players"]) ? content["players"] : [],
        locations: Array.isArray(content["locations"]) ? content["locations"] : [],
        modes: Array.isArray(content["modes"]) ? content["modes"] : [],
        npcZones: Array.isArray(content["npcZones"]) ? content["npcZones"] : [],
        // The front counts readyInSec down from the moment the list arrived
        npcZonesAt: Date.now(),
        // Older servers send no tier/caps (server and client deploy independently); the server still refuses bans
        caps: caps && typeof caps === "object" ? caps : { ban: true },
        tier: String(content["tier"] ?? ""),
        // The admin's own standing; absent on older servers
        mastery: content["mastery"] && typeof content["mastery"] === "object" ? content["mastery"] : null,
        bans: Array.isArray(content["bans"]) ? content["bans"] : [],
        // The admin's own row, which the roster leaves out: the front reads it for the target list's "You" and for
        // the shape you are in yourself. This mirror keeps only the keys it names, and it did not name this one, so
        // every panel saw data.me as undefined: acting on yourself showed "Refresh to read their state" and a staff
        // member who had polymorphed themselves was offered no Revert. Absent on an older server, which the front allows
        me: content["me"] && typeof content["me"] === "object" ? content["me"] : null,
        // Panel-wide polymorph state (server beastform.js __dboPolymorphPanel): the Owners' switch and the animals
        // that may be taken right now. The front offers these and never a list of its own, or it would offer an
        // animal the server refuses. Null on a server without the hook, and the front then hides the picker
        polymorph: content["polymorph"] && typeof content["polymorph"] === "object" ? content["polymorph"] : null,
        // The big catalogs live in the browser (window.__dboAdminItems / __dboAdminLocations); only their version travels here
        itemsVersion: panelData.itemsVersion || 0,
        locationsVersion: panelData.locationsVersion || 0,
        placeablesVersion: panelData.placeablesVersion || 0,
        placements: panelData.placements || null,
        placeMeta: panelData.placeMeta || null,
        placeResults: panelData.placeResults || null,
        placeSets: panelData.placeSets || null,
        warband: panelData.warband || null,
        masteryTarget: panelData.masteryTarget || null,
        events,
      };
      this.pushData();
    } else if (content["customPacketType"] === "debugInfo") {
      // Natives throw in the packet-handler context; only data is stored here and the update loop reads the game
      const serverTime = Number(content["serverTime"]);
      this.server = {
        name: String(content["serverName"] ?? ""),
        offsetMs: Number.isFinite(serverTime) ? serverTime - Date.now() : 0,
        tzOffsetMin: Number(content["serverTzOffsetMin"]) || 0,
      };
      this.serverActorId = String(content["actorId"] ?? "");
      this.serverProfileId = Number(content["profileId"]) || 0;
      if (panelData.debug) {
        panelData.debug.server = this.server;
        panelData.debug.actorId = this.serverActorId;
        panelData.debug.profileId = this.serverProfileId;
        this.pushData();
      }
    } else if (content["customPacketType"] === "npcZones") {
      panelData.npcZones = Array.isArray(content["zones"]) ? content["zones"] : [];
      panelData.npcZonesAt = Date.now();
      this.pushData();
    } else if (content["customPacketType"] === "adminMode") {
      // Keep the Modes tab highlight in sync without a full roster refresh
      const mode = String(content["mode"] ?? "");
      const on = !!content["on"];
      for (const m of Array.isArray(panelData.modes) ? panelData.modes : []) {
        if (m && m.id === mode) m.active = on;
      }
      this.pushData();
    } else if (content["customPacketType"] === "adminItems" || content["customPacketType"] === "adminLocations") {
      // Handed to the browser once: re-sending thousands of rows with every panel refresh made the panel lag
      const isItems = content["customPacketType"] === "adminItems";
      const list = isItems ? content["categories"] : content["locations"];
      const json = JSON.stringify(Array.isArray(list) ? list : []);
      if (isItems) this.catalogs.items = Array.isArray(list) ? list : []; else this.catalogs.locations = Array.isArray(list) ? list : [];
      this.sp.browser.executeJavaScript(`window.${isItems ? "__dboAdminItems" : "__dboAdminLocations"} = ${json};`);
      if (isItems) panelData.itemsVersion = Date.now(); else panelData.locationsVersion = Date.now();
      this.pushData();
    } else if (content["customPacketType"] === "adminPlaceables") {
      const list = content["categories"];
      this.sp.browser.executeJavaScript(`window.__dboAdminPlaceables = ${JSON.stringify(Array.isArray(list) ? list : [])};`);
      panelData.placeablesVersion = Date.now();
      this.pushData();
    } else if (content["customPacketType"] === "adminPlacements") {
      // The Place tab's "Placed near me" list (server placement.js placeList): small, so it travels in panelData
      panelData.placements = {
        items: Array.isArray(content["items"]) ? content["items"] : [],
        here: Number(content["here"]) || 0,
        total: Number(content["total"]) || 0,
        at: Date.now(),
      };
      this.pushData();
    } else if (content["customPacketType"] === "adminPlaceSets") {
      panelData.placeSets = Array.isArray(content["sets"]) ? content["sets"] : [];
      this.pushData();
    } else if (content["customPacketType"] === "adminWarbandView") {
      // The Place tab's Warband view (server warband.js viewOf): small, so it travels in panelData; lists stay lists
      const list = (k: string) => (Array.isArray(content[k]) ? content[k] : []);
      const plan = content["plan"] && typeof content["plan"] === "object" ? content["plan"] : { calm: 0, kept: "", unread: "" };
      const last = content["last"] && typeof content["last"] === "object" ? content["last"] : null;
      // Step 1 of the rework (Nat, 25 Oct): the GM's target, the foes near, the last NPC preview (warband.js targetOf, foesOf, infoOf)
      const obj = (k: string) => (content[k] && typeof content[k] === "object" && !Array.isArray(content[k]) ? content[k] : null);
      panelData.warband = {
        members: list("members"), counts: list("counts"), placed: list("placed"), players: list("players"), npcs: list("npcs"),
        stance: String(content["stance"] ?? "follow"), side: String(content["side"] ?? ""), enemies: list("enemies"),
        plan, presets: list("presets"), onLogout: String(content["onLogout"] ?? "dismiss"),
        maxBand: Number(content["maxBand"]) || 25, maxRaise: Number(content["maxRaise"]) || 10, last, at: Date.now(),
        target: obj("target"), foes: list("foes"), info: obj("info"),
      };
      this.pushData();
    } else if (content["customPacketType"] === "adminPlaceMeta") {
      panelData.placeMeta = {
        categories: Array.isArray(content["categories"]) ? content["categories"] : [],
        plugins: Array.isArray(content["plugins"]) ? content["plugins"] : [],
        rights: content["rights"] && typeof content["rights"] === "object" ? content["rights"] : null,
      };
      this.pushData();
    } else if (content["customPacketType"] === "adminPlaceResults") {
      // One page of the server-side catalog search; a later page of the same search is appended to what is shown
      const page = {
        query: String(content["query"] ?? ""),
        category: String(content["category"] ?? ""),
        plugin: String(content["plugin"] ?? ""),
        offset: Number(content["offset"]) || 0,
        total: Number(content["total"]) || 0,
        items: Array.isArray(content["items"]) ? content["items"] : [],
      };
      const prev = panelData.placeResults;
      const same = prev && prev.query === page.query && prev.category === page.category && prev.plugin === page.plugin;
      panelData.placeResults = same && page.offset > 0 && page.offset === prev.items.length
        ? Object.assign({}, page, { offset: 0, items: prev.items.concat(page.items) })
        : page;
      this.pushData();
    } else if (content["customPacketType"] === "adminMastery") {
      panelData.masteryTarget = { name: String(content["targetName"] ?? ""), target: String(content["target"] ?? ""), detail: content["detail"] || null };
      this.pushData();
    } else if (content["customPacketType"] === "adminActionResult") {
      notifyNextUpdate(this.controller, this.sp, String(content["text"] ?? ""));
    }
  }

  private showMenu(): void {
    this.menuOpen = true;
    this.native = this.openNativeMenu();
    if (!this.native) this.openBrowserMenu();
  }

  private openBrowserMenu(): void {
    openFormMenu(this.sp, this.browsersideWidgetSetter, { panelData, WIDGET_ID }, this.controller);
  }

  // The native dbo_admin panel (ScaleformMenuService.openNative); false when this client has it off, and the browser draws it
  private openNativeMenu(): boolean {
    try {
      return this.controller.lookupListener(ScaleformMenuService).openNative({
        type: "adminPanel", widget: this.nativeView(), widgetId: WIDGET_ID, onKey: (key, args) => this.onNativeKey(key, args),
      });
    } catch {
      return false;
    }
  }

  // The gamemode-fed tabs stop their updates when the panel goes, as the browser tabs do when they unmount
  private leaveStaffTab(): void {
    const leave: Record<string, [string, string]> = { gmcalls: ["staffGmCalls", "unwatch"], thievery: ["staffThievery", "unwatch"], enchant: ["staffEnchant", "close"] };
    const l = leave[String(this.ui.tab || "")];
    if (l) sendCustomPacket(this.controller, { customPacketType: "dbo", event: l[0], args: [l[1]] });
  }

  private nativeView(): unknown {
    return adminNativeView(panelData, this.catalogs, this.staff, this.staffAt, this.ui, WIDGET_ID);
  }

  private onNativeKey(key: string, args: unknown[]): void {
    if (!this.native || !this.menuOpen) return;
    // The SWF could not be drawn: the browser panel after all
    if (key === FAILED_KEY) {
      this.native = false;
      this.openBrowserMenu();
      return;
    }
    // The panel has gone (it closed itself, or the game closed it)
    if (key === CLOSE_KEY) {
      this.menuOpen = false;
      this.native = false;
      this.leaveStaffTab();
      return;
    }
    // What the panel shows: its tab, search and page, answered with that page
    if (key === NATIVE_UI_KEY) {
      try { this.ui = JSON.parse(String(args[0] ?? "{}")) || {}; } catch { this.ui = {}; }
      this.pushData();
      return;
    }
    const a = ([key] as unknown[]).concat(args);
    // The browser's Place keys reach PlacementService as browser messages; the native panel's are handed to it
    if (key === "admin::place" || key === "admin::placeedit" || key === "admin::placeselect") {
      try { this.controller.lookupListener(PlacementService).fromPanel(a); } catch { /* no placement service */ }
    }
    this.handleKey(a);
  }

  // Re-pushes data while open without re-taking focus or re-showing a browser a vanilla menu hid
  private pushData(): void {
    if (!this.menuOpen) return;
    if (this.native) {
      this.controller.lookupListener(ScaleformMenuService).refreshNative(this.nativeView(), WIDGET_ID);
      return;
    }
    refreshFormMenu(this.sp, this.browsersideWidgetSetter, { panelData, WIDGET_ID });
  }

  private closeMenu(): void {
    this.menuOpen = false;
    if (this.native) {
      this.native = false;
      this.leaveStaffTab();
      this.controller.lookupListener(ScaleformMenuService).closeNative("adminPanel");
      return;
    }
    closeFormMenu(this.sp, WIDGET_ID);
  }

  // SP has no active-effect enumeration, so only effects seen starting on the player after this script loaded are tracked
  private get effects(): EffectMap {
    let m = this.sp.storage[EFFECTS_STORAGE_KEY] as EffectMap | undefined;
    if (!(m instanceof Map)) {
      m = new Map();
      this.sp.storage[EFFECTS_STORAGE_KEY] = m;
    }
    return m;
  }

  private onEffect(e: ActiveEffectApplyRemoveEvent, started: boolean): void {
    try {
      if (!e.effect || !e.target || e.target.getFormID() !== PLAYER_FORM_ID) return;
      const id = e.effect.getFormID();
      if (started) this.effects.set(id, { name: e.effect.getName(), since: Date.now() });
      else this.effects.delete(id);
    } catch { }
  }

  // Update context only; every native is guarded so one missing form never blanks the whole tab
  private refreshDebug(): void {
    const sp = this.sp;
    const now = Date.now();
    this.lastDebugAt = now;
    const player = safe(() => sp.Game.getPlayer(), null);
    const auth = sp.storage[authGameDataStorageKey] as AuthGameData | undefined;
    const hoursOffset = safe(() => sp.settings["skymp5-client"]["hoursOffset"], 0);
    const d: DebugData = {
      account: auth?.remote?.discordUsername || (auth?.remote ? `id ${auth.remote.masterApiId}` : auth?.local ? `profile ${auth.local.profileId}` : ""),
      character: "",
      formId: safe(() => hex(this.controller.lookupListener(RemoteServer).getMyRemoteRefrId()), ""),
      actorId: this.serverActorId,
      profileId: this.serverProfileId,
      server: this.server,
      pos: [0, 0, 0],
      cell: null,
      heading: { deg: 0, compass: COMPASS[0] },
      target: null,
      av: { health: [0, 0], magicka: [0, 0], stamina: [0, 0] },
      gameTime: null,
      hoursOffset: typeof hoursOffset === "number" ? hoursOffset : 0,
      localTime: now,
      effects: [],
      updatedAt: now,
    };
    if (player) {
      d.character = safe(() => player.getBaseObject()?.getName(), "");
      d.pos = [safe(() => player.getPositionX(), 0), safe(() => player.getPositionY(), 0), safe(() => player.getPositionZ(), 0)].map(Math.round);
      const cell = safe(() => player.getParentCell(), null);
      if (cell) {
        d.cell = {
          id: hex(safe(() => cell.getFormID(), 0)),
          name: safe(() => cell.getName(), ""),
          interior: safe(() => cell.isInterior(), false),
          world: safe(() => player.getWorldSpace()?.getName(), ""),
          location: safe(() => player.getCurrentLocation()?.getName(), ""),
        };
      }
      const deg = Math.round(((safe(() => player.getAngleZ(), 0) % 360) + 360) % 360) % 360;
      d.heading = { deg, compass: COMPASS[Math.round(deg / 45) % 8] };
      const ref = safe(() => sp.Game.getCurrentCrosshairRef(), null);
      if (ref) {
        d.target = {
          name: safe(() => ref.getDisplayName(), "") || safe(() => ref.getBaseObject()?.getName(), ""),
          id: hex(safe(() => ref.getFormID(), 0)),
          dist: Math.round(safe(() => player.getDistance(ref), 0)),
        };
      }
      const av = (name: string) => [Math.round(safe(() => player.getActorValue(name), 0)), Math.round(safe(() => player.getActorValueMax(name), 0))];
      d.av = { health: av("Health"), magicka: av("Magicka"), stamina: av("Stamina") };
      // Pruned on every refresh so finished effects missed by effectFinish drop out
      const effects = this.effects;
      effects.forEach((info, id) => {
        if (!safe(() => player.hasMagicEffect(sp.MagicEffect.from(sp.Game.getFormEx(id))), true)) {
          effects.delete(id);
          return;
        }
        d.effects.push({ id: hex(id), name: info.name, elapsedSec: Math.round((now - info.since) / 1000) });
      });
    }
    // timeService writes the server's clock into these globals; the weekday comes from GameDaysPassed as the engine's does, not the real date
    const global = (id: number) => safe(() => sp.GlobalVariable.from(sp.Game.getFormEx(id))?.getValue(), NaN);
    const hour = global(GLOBAL_HOUR), day = global(GLOBAL_DAY), month = global(GLOBAL_MONTH), year = global(GLOBAL_YEAR), daysPassed = global(GLOBAL_DAYS_PASSED);
    if ([hour, day, month, year, daysPassed].every(Number.isFinite)) {
      d.gameTime = { hour, day, month, year, weekday: weekdayOf(daysPassed) };
    }
    panelData.debug = d;
  }

  private onBrowserMessage(e: BrowserMessageEvent) {
    this.handleKey(e.arguments);
  }

  // The panel's keys: [key, ...args], from the browser widget or the native panel
  private handleKey(a: unknown[]): void {
    const kind = a[0];
    // PlacementService takes over the screen; the panel would hold the mouse and the crosshair
    if ((kind === "admin::place" || kind === "admin::placedelete" || kind === "admin::placeselect" || kind === "admin::placeedit") && this.menuOpen) {
      this.closeMenu();
      return;
    }
    if (kind === events.close || (kind === "menu:escape" && this.menuOpen)) {
      this.closeMenu();
      return;
    }
    if (kind === events.refresh) {
      sendCustomPacket(this.controller, { customPacketType: "adminMenuRequest" });
      return;
    }
    if (kind === events.debugRefresh) {
      this.controller.once("update", () => {
        this.refreshDebug();
        this.pushData();
      });
      sendCustomPacket(this.controller, { customPacketType: "debugInfoRequest" });
      return;
    }
    if (kind === events.tpLoc) {
      this.remember("teleport", String(a[1] ?? ""));
      sendCustomPacket(this.controller, { customPacketType: "adminAction", action: "teleportLoc", target: String(a[1] ?? "") });
      return;
    }
    if (kind === events.mode) {
      sendCustomPacket(this.controller, { customPacketType: "adminAction", action: "toggleMode", mode: String(a[1] ?? "") });
      return;
    }
    if (kind === events.action) {
      // admin::action <action> <JSON of extra fields>; the server checks rank and target for every one
      let fields: Record<string, unknown> = {};
      try { fields = JSON.parse(String(a[2] ?? "{}")) || {}; } catch { fields = {}; }
      const action = String(a[1] ?? "");
      sendCustomPacket(this.controller, Object.assign({}, fields, { customPacketType: "adminAction", action }));
      if (action === "giveItem") this.remember("items", String(fields["item"] ?? ""));
      if (["kill", "deleteCharacter", "ipBan", "tempBan", "unban"].indexOf(action) !== -1) {
        sendCustomPacket(this.controller, { customPacketType: "adminMenuRequest" });
      }
      return;
    }
    if (kind === events.request) {
      const type = String(a[1] ?? "");
      if (!PANEL_REQUESTS.has(type)) return;
      // The Place tab's catalog is served by the gamemode (placement.js), not by AdminSystem
      if (type === "adminPlaceablesRequest") {
        sendCustomPacket(this.controller, { customPacketType: "dbo", event: "placeCatalog", args: [] });
        return;
      }
      // The Place tab's Sets and Warband views: each request is one dbo event with its fields as arguments
      const PLACE_EVENTS: Record<string, [string, string[]]> = {
        adminPlaceSets: ["placeSets", []],
        adminPlaceSetSave: ["placeSetSave", ["name", "radius"]],
        adminPlaceSetPlace: ["placeSetPlace", ["name"]],
        adminPlaceSetDelete: ["placeSetDelete", ["name"]],
        adminPlaceGroupClear: ["placeGroupClear", ["id"]],
        adminWarband: ["warband", ["text"]],
        adminRaid: ["raid", ["text"]],
        adminWarbandView: ["warbandView", []],
      };
      if (PLACE_EVENTS[type]) {
        let f: Record<string, unknown> = {};
        try { f = JSON.parse(String(a[2] ?? "{}")) || {}; } catch { f = {}; }
        const [event, keys] = PLACE_EVENTS[type];
        sendCustomPacket(this.controller, { customPacketType: "dbo", event, args: keys.map((k) => f[k] ?? "") });
        return;
      }
      if (type === "adminPlaceUndo") {
        // 'list': the server sends the list again afterwards
        sendCustomPacket(this.controller, { customPacketType: "dbo", event: "placeUndo", args: ["list"] });
        return;
      }
      if (type === "adminPlaceMeta") {
        sendCustomPacket(this.controller, { customPacketType: "dbo", event: "placeMeta", args: [] });
        return;
      }
      if (type === "adminPlaceSearch") {
        let f: Record<string, unknown> = {};
        try { f = JSON.parse(String(a[2] ?? "{}")) || {}; } catch { f = {}; }
        sendCustomPacket(this.controller, { customPacketType: "dbo", event: "placeSearch", args: [String(f.query ?? ""), String(f.category ?? ""), String(f.plugin ?? ""), Number(f.offset) || 0] });
        return;
      }
      if (type === "adminPlacementsRequest" || type === "adminPlacementRemove" || type === "adminPlacementGoto") {
        let id = "";
        try { id = String((JSON.parse(String(a[2] ?? "{}")) || {}).id ?? ""); } catch { id = ""; }
        if (type === "adminPlacementsRequest") {
          sendCustomPacket(this.controller, { customPacketType: "dbo", event: "placeList", args: [] });
        } else if (type === "adminPlacementRemove") {
          // 'list': the server sends the list again once it is removed
          sendCustomPacket(this.controller, { customPacketType: "dbo", event: "placeDelete", args: [id, "list"] });
        } else {
          sendCustomPacket(this.controller, { customPacketType: "dbo", event: "placeGoto", args: [id] });
        }
        return;
      }
      let fields: Record<string, unknown> = {};
      try { fields = JSON.parse(String(a[2] ?? "{}")) || {}; } catch { fields = {}; }
      sendCustomPacket(this.controller, Object.assign({}, fields, { customPacketType: type }));
      return;
    }
    if (kind === events.npcList) {
      sendCustomPacket(this.controller, { customPacketType: "npcZonesRequest" });
      return;
    }
    if (kind === events.npcAdd) {
      // The front sends one NPC-Spawns.json entry as a JSON string; the server pushes npcZones after every mutation
      sendCustomPacket(this.controller, { customPacketType: "adminAction", action: "npcZoneAdd", zone: typeof a[1] === "string" ? a[1] : "" });
      return;
    }
    if (kind === events.masteryGrant || kind === events.masteryReset) {
      const target = String(a[1] ?? "");
      if (kind === events.masteryGrant) {
        sendCustomPacket(this.controller, { customPacketType: "adminAction", action: "masteryGrant", target, amount: Number(a[2]) });
      } else {
        sendCustomPacket(this.controller, { customPacketType: "adminAction", action: "masteryReset", target });
      }
      // The roster carries the standing; ask for a fresh one
      sendCustomPacket(this.controller, { customPacketType: "adminMenuRequest" });
      return;
    }
    if (kind === events.npcTp || kind === events.npcReset || kind === events.npcDelete) {
      const zoneAction = kind === events.npcTp ? "npcZoneTp" : kind === events.npcReset ? "npcZoneReset" : "npcZoneDelete";
      sendCustomPacket(this.controller, { customPacketType: "adminAction", action: zoneAction, target: String(a[1] ?? "") });
      return;
    }
    if (kind !== events.tp && kind !== events.summon && kind !== events.kick && kind !== events.ban) return;
    const target = String(a[1] ?? "");
    const action =
      kind === events.tp ? "teleportTo" :
      kind === events.summon ? "summon" :
      kind === events.kick ? "kick" : "ban";
    sendCustomPacket(this.controller, { customPacketType: "adminAction", action, target });
    // Kick/ban changes the roster; ask for a fresh one
    if (action === "kick" || action === "ban") {
      sendCustomPacket(this.controller, { customPacketType: "adminMenuRequest" });
    }
  }

  // Runs inside the CEF browser; only the injected variables and window are available here.
  // No spread syntax: it breaks after FunctionInfo stringification.
  private browsersideWidgetSetter = () => {
    const widget: any = Object.assign({ type: "adminPanel", id: WIDGET_ID }, panelData);
    // Replaced in place: moving to the end makes React move the node, which resets every scroll inside it
    const list = (window.skyrimPlatform.widgets.get() || []).slice();
    let at = -1;
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].id === WIDGET_ID) at = i;
    if (at === -1) list.push(widget);
    else list[at] = widget;
    window.skyrimPlatform.widgets.set(list);
  };

  private menuKey: DxScanCode;
  private menuOpen = false;
  private native = false;
  // For the native panel: the catalogs, the gamemode's staff widgets, and what the panel shows
  private catalogs: AdminCatalogs = { items: null, locations: null, recent: { items: [], teleport: [] } };

  // The native panel's Recent lists (the browser keeps its own in its storage): this game session only, newest first
  private remember(list: "items" | "teleport", id: string): void {
    if (!id || !this.catalogs.recent) return;
    const l = this.catalogs.recent[list].filter((x) => x !== id);
    l.unshift(id);
    this.catalogs.recent[list] = l.slice(0, 8);
  }
  private staff: Record<number, unknown> = {};
  private staffAt: Record<number, number> = {};
  private ui: AdminUi = {};
  private lastDebugAt = 0;
  private server: DebugServer | null = null;
  private serverActorId = "";
  private serverProfileId = 0;
}
