import { FormType, storage } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { sendCustomPacket } from "./customPacketUtil";
import { DboGlowService } from "./dboGlowService";
import { FrameWindow, PERF_REPORT_MS, PERF_TOP_HANDLERS, perfDiagEnabled, updateTiming } from "./perfDiag";
import { RemoteServer } from "./remoteServer";
import { PlayerCharacterDataHolder } from "../../view/playerCharacterDataHolder";

/**
 * The player's real frame rate and what the client's own JS costs, so the server can see slow dungeons.
 * Every PERF_REPORT_MS one line, logged by the server as "npcDrift <name> perf: <json>":
 *
 *   Client -> Server: { customPacketType: "dbo", event: "npcDrift", args: [{ kind: "perf", fps, frames, windowMs, worstMs,
 *     over50, over100, jsMs, top: [[label, ms, calls]...], cell, world, interior, actors, hosted, glowing,
 *     forms, near }] }
 *
 * jsMs and top cover the update handlers registered through the controller (spApiInteractor.ts), labelled by the
 * listener that registered them. Set perfDiag: false in the skymp5-client settings block to turn it all off.
 */
export class PerfDiagService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    if (!perfDiagEnabled(this.sp.settings["skymp5-client"])) return;
    this.controller.on("update", () => this.onUpdate());
  }

  private onUpdate(): void {
    const now = Date.now();
    this.frames.frame(now);
    if (!this.nextReport) this.nextReport = now + PERF_REPORT_MS;
    if (now < this.nextReport) return;
    this.nextReport = now + PERF_REPORT_MS;
    try {
      const frames = this.frames.take(now);
      if (!frames) return;
      const { jsMs, top } = updateTiming.take(PERF_TOP_HANDLERS);
      sendCustomPacket(this.controller, {
        customPacketType: "dbo", event: "npcDrift", args: [{ kind: "perf", ...frames, jsMs, top, ...this.context() }],
      });
    } catch {
      // diagnostics only
    }
  }

  private context(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const hosted = storage["hosted"];
    out.hosted = Array.isArray(hosted) ? hosted.length : 0;
    try { out.glowing = this.controller.lookupListener(DboGlowService).getGlowingCount(); } catch { /* not set up */ }

    // WorldView costs (forms streamed to us) x (work per form), and neither term was reported, so
    // its cost had to be inferred server-side from co-located player counts. These are the real
    // scaling variables and they cost ZERO native calls - plain JS over a model already in hand.
    // "forms" is everything streamed to this client; "near" is the subset FormView does full work
    // for, the rest exiting early on the worldOrCell check.
    try {
      const forms = this.controller.lookupListener(RemoteServer).getWorldModel().forms;
      out.forms = forms.length;
      const woc = PlayerCharacterDataHolder.getWorldOrCell();
      let near = 0;
      if (woc) {
        for (const f of forms) {
          if (f && f.movement && f.movement.worldOrCell === woc) near++;
        }
      }
      out.near = near;
    } catch { /* diagnostics only */ }
    const player = this.sp.Game.getPlayer();
    const cell = player?.getParentCell();
    if (!player || !cell) return out;
    out.cell = cell.getFormID().toString(16);
    out.interior = cell.isInterior();
    if (out.interior) out.actors = cell.getNumRefs(FormType.Character);
    else out.world = (player.getWorldSpace()?.getFormID() ?? 0).toString(16);
    return out;
  }

  private frames = new FrameWindow();
  private nextReport = 0;
}
