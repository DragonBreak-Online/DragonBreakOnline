import { ModEvent } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { parseCustomPacket, sendCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { logTrace } from "../../logging";
import { ProbeState, newProbe, notePong, probeResults, probeStep } from "./hudProbe";

// One-shot test of route H (_work/native-everything-1031.md), armed by /testmenu hud: T1 our own clip drawn in the HUD
// Menu, T2 our own swf loaded into it. The steps are hudProbe.ts.
export class HudProbeService extends ClientListener {
  private probe: ProbeState | null = null;

  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onMessage(e));
    this.controller.on("modEvent", (e) => this.onModEvent(e));
    this.controller.on("update", () => this.onUpdate());
  }

  private onMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content || content["customPacketType"] !== "dboHudTest") return;
    this.probe = newProbe();
    logTrace(this, "HUD overlay test armed");
  }

  private onModEvent(e: ModEvent): void {
    if (this.probe) notePong(this.probe, e.eventName, e.strArg);
  }

  private onUpdate(): void {
    if (!this.probe) return;
    probeStep(this.probe, this.sp.Ui);
    if (!this.probe.done) return;
    const results = probeResults(this.probe);
    this.probe = null;
    sendCustomPacket(this.controller, { customPacketType: "dbo", event: "hudTest", args: [results], widget: 0 });
    logTrace(this, "HUD overlay test", JSON.stringify(results));
  }
}
