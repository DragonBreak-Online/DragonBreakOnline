import { ClientListener, CombinedController, Sp } from "./clientListener";
import { Menu } from "skyrimPlatform";
import { logError, logTrace } from "../../logging";
import { LegendLoad, legendReset, legendStep, newLegendLoad } from "./mapRealm";

// A list the server shows beside a game menu, drawn inside that menu (route M) instead of over it in the browser: the
// alchemy lab's "You can brew" list (alchemy.js: an inspect contextMenu sent without focus while the lab's own Crafting Menu
// opens). DboRelayService offers it here; swf/dbo_menulist is loaded into a clip of the Crafting Menu, as MapRealmService
// loads dbo_maplegend into the map, with the same loader (one try an opening, alive within a second, else the browser for the
// session). A list with no Crafting Menu to sit in within WAIT_MS goes to the browser, as before.
const MENU = Menu.Crafting;
const HOST = "_root.dboMenuList";
const SWF = "dbo_menulist.swf";
const WAIT_MS = 3000;

interface Offered { id: number; title: string; lines: string[]; at: number; browser: () => void; inBrowser: boolean; sent: boolean }

export class NativeMenuListService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("update", () => this.onUpdate());
    this.controller.on("menuClose", (e) => { if (e.name === MENU) { legendReset(this.load); if (this.list) this.list.sent = false; } });
  }

  // The relay's offer: true when this service takes the list (it draws it in the menu, or hands it to the browser itself)
  public offer(w: Record<string, unknown>, id: number, browser: () => void): boolean {
    if (w["type"] !== "contextMenu" || w["mode"] !== "inspect" || this.load.phase === "off") return false;
    const lines = Array.isArray(w["lines"]) ? (w["lines"] as unknown[]).map(String) : [];
    // A list already in the browser stays there when the server sends it again (a new ingredient): the browser redraws it
    const wasBrowser = !!this.list && this.list.id === id && this.list.inBrowser;
    this.list = { id, title: String(w["targetName"] || ""), lines, at: Date.now(), browser, inBrowser: wasBrowser, sent: false };
    if (wasBrowser) browser();
    return true;
  }

  // The server closed the widget: the list goes, from the menu or the browser
  public close(id: number): void {
    if (!this.list || this.list.id !== id) return;
    this.list = null;
    try { if (this.load.phase === "up") this.sp.Ui.invokeString(MENU, `${HOST}.dboData`, JSON.stringify({ hide: true })); } catch { /* the menu is gone */ }
  }

  private onUpdate(): void {
    const l = this.list;
    if (!l || l.inBrowser) return;
    try {
      const ui = this.sp.Ui;
      if (!ui.isMenuOpen(MENU)) {
        if (this.load.phase !== "up" && Date.now() - l.at > WAIT_MS) this.toBrowser(l, "no crafting menu to sit in");
        return;
      }
      let alive = false;
      try { alive = this.load.phase === "loading" && ui.getString(MENU, `${HOST}.dboAlive`) === "yes"; } catch { alive = false; }
      const step = legendStep(this.load, alive);
      if (step === "inject") {
        ui.invokeStringA(MENU, "_root.createEmptyMovieClip", ["dboMenuList", "9992"]);
        ui.invokeString(MENU, `${HOST}.loadMovie`, SWF);
      } else if (step === "fail") {
        this.toBrowser(l, "it never came alive in the crafting menu: the browser draws it this session");
        return;
      }
      if (this.load.phase === "up" && !l.sent) {
        ui.invokeString(MENU, `${HOST}.dboData`, JSON.stringify({ title: l.title, lines: l.lines }));
        l.sent = true;
        logTrace(this, "side list drawn in the crafting menu", l.title);
      }
    } catch (e) {
      logError(this, "side list frame failed", e);
    }
  }

  private toBrowser(l: Offered, why: string): void {
    l.inBrowser = true;
    logTrace(this, "side list in the browser:", why);
    l.browser();
  }

  private list: Offered | null = null;
  private load: LegendLoad = newLegendLoad();
}
