import { Game } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { sendCustomPacket } from "./customPacketUtil";
import { reportDue } from "../../view/spellInvisPolicy";
import { logTrace } from "../../logging";

const CHECK_MS = 250;

/**
 * The owner's side of the invisibility fix (Nate, 23 Oct; spellInvisPolicy.ts has the whole rule). Reports this player's
 * own Invisibility state to the server, which mirrors it for neighbours in ff_spellInvis (server spellinvis.js); every
 * watcher then hides its copy of this player only while this report says on. The local actor value is the truth here:
 * an attack or an activation ends the effect on this screen, and only here.
 *
 *   Client -> Server: { customPacketType: "dbo", event: "spellInvis", args: [on] }  on a change, and every
 *                     REPORT_HEARTBEAT_MS while invisible
 */
export class SpellInvisReportService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("update", () => this.onUpdate());
    // A new session reports its state again, so a stale "on" from the last one is replaced at once
    this.controller.emitter.on("connectionAccepted", () => { this.lastSent = null; });
  }

  private onUpdate(): void {
    const now = Date.now();
    if (now - this.lastCheck < CHECK_MS) return;
    this.lastCheck = now;
    const player = Game.getPlayer();
    if (!player) return;
    let on = false;
    try { on = player.getActorValue("Invisibility") > 0; } catch { return; }
    if (!reportDue(this.lastSent, this.lastSentAt, on, now)) return;
    if (this.lastSent !== on) logTrace(this, "spellInvis", on);
    this.lastSent = on;
    this.lastSentAt = now;
    sendCustomPacket(this.controller, { customPacketType: "dbo", event: "spellInvis", args: [on] });
  }

  private lastCheck = 0;
  private lastSent: boolean | null = null;
  private lastSentAt = 0;
}
