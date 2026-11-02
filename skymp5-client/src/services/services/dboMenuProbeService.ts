import { ClientListener, CombinedController, Sp } from "./clientListener";
import { logError, logTrace } from "../../logging";

// The tick-safe menu spike's probe (skyrim-platform DboMenuApi): off unless skymp5-client settings dboMenuProbe is true.
// From "tick", so at the main menu too, it opens Data\Interface\dbo_menuprobe.swf, waits for its "ready", pings it and
// logs the round trip, then closes it: proof that a Scaleform menu can open, be invoked and answer before the world
// loads. A DLL without the API logs that once and stops.
interface DboMenuSp {
  dboMenuOpen?: (swf: string, flags?: number, depth?: number) => void;
  dboMenuClose?: () => void;
  dboMenuIsOpen?: () => boolean;
  dboMenuInvoke?: (target: string, arg?: string) => void;
  dboMenuPoll?: () => string[];
}

const SEP = "\u0001";
// UsesCursor | UsesMenuContext (CommonLib UI_MENU_FLAGS), never PausesGame
const FLAGS = 4 | 8;
const GIVE_UP_MS = 15000;

export class DboMenuProbeService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    if (!this.wanted()) return;
    this.controller.on("tick", () => this.onTick());
  }

  private onTick(): void {
    if (this.done) return;
    const m = this.sp as unknown as DboMenuSp;
    try {
      if (!this.openedAt) {
        if (typeof m.dboMenuOpen !== "function" || typeof m.dboMenuPoll !== "function") {
          this.finish("this SkyrimPlatform has no dboMenu API");
          return;
        }
        m.dboMenuOpen("dbo_menuprobe", FLAGS, 3);
        this.openedAt = Date.now();
        logTrace(this, "dboMenu probe: opened from tick");
        return;
      }
      for (const line of m.dboMenuPoll ? m.dboMenuPoll() : []) {
        const [key, arg] = line.split(SEP);
        logTrace(this, `dboMenu probe: the movie said ${key} ${arg ?? ""} after ${Date.now() - this.openedAt} ms (open: ${m.dboMenuIsOpen ? m.dboMenuIsOpen() : "?"})`);
        if (key === "ready" && m.dboMenuInvoke) m.dboMenuInvoke("_root.ping", "hello");
        if (key === "pong") {
          this.finish(`round trip done, pong "${arg}" in ${Date.now() - this.openedAt} ms`);
          return;
        }
      }
      if (Date.now() - this.openedAt > GIVE_UP_MS) this.finish(`no answer in ${GIVE_UP_MS} ms (open: ${m.dboMenuIsOpen ? m.dboMenuIsOpen() : "?"})`);
    } catch (e) {
      logError(this, "dboMenu probe failed", e);
      this.done = true;
    }
  }

  private finish(why: string): void {
    this.done = true;
    logTrace(this, `dboMenu probe: ${why}`);
    try { (this.sp as unknown as DboMenuSp).dboMenuClose?.(); } catch { /* the API may be missing */ }
  }

  private wanted(): boolean {
    try {
      const s = this.sp.settings["skymp5-client"] as Record<string, unknown> | undefined;
      return !!s && s["dboMenuProbe"] === true;
    } catch {
      return false;
    }
  }

  private openedAt = 0;
  private done = false;
}
