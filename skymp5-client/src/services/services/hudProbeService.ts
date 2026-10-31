import { ClientListener, CombinedController, Sp } from "./clientListener";
import { parseCustomPacket, sendCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { logTrace } from "../../logging";

// One-shot test of route H (_work/native-everything-1031.md): our own clip drawn in the HUD Menu, armed by /testmenu hud.
export const HUD_MENU = "HUD Menu";
const CLIP = "_root.dboHudProbe";
const HOLD_TICKS = 300;

export class HudProbeService extends ClientListener {
  private armed = false;
  private tick = 0;
  private results: Record<string, unknown> = {};

  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onMessage(e));
    this.controller.on("update", () => this.onUpdate());
  }

  private onMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const content = parseCustomPacket(event);
    if (!content || content["customPacketType"] !== "dboHudTest") return;
    this.armed = true;
    this.tick = 0;
    this.results = {};
    logTrace(this, "HUD overlay test armed");
  }

  private onUpdate(): void {
    if (!this.armed) return;
    const ui = this.sp.Ui;
    if (!ui.isMenuOpen(HUD_MENU)) { if (this.tick) this.finish("the HUD menu closed"); return; }
    this.tick++;
    if (this.tick === 1) {
      ui.invokeStringA(HUD_MENU, "_root.createEmptyMovieClip", ["dboHudProbe", "9991"]);
    }
    if (this.tick === 2) {
      this.results.created = ui.getString(HUD_MENU, `${CLIP}._name`);
      // An aqua bar, 200 x 40, left of centre: Nat should see it on the HUD for about five seconds
      ui.invokeFloatA(HUD_MENU, `${CLIP}.beginFill`, [0x8fd3d0, 70]);
      ui.invokeFloatA(HUD_MENU, `${CLIP}.moveTo`, [40, 300]);
      ui.invokeFloatA(HUD_MENU, `${CLIP}.lineTo`, [240, 300]);
      ui.invokeFloatA(HUD_MENU, `${CLIP}.lineTo`, [240, 340]);
      ui.invokeFloatA(HUD_MENU, `${CLIP}.lineTo`, [40, 340]);
      ui.invokeFloatA(HUD_MENU, `${CLIP}.lineTo`, [40, 300]);
      ui.invokeFloatA(HUD_MENU, `${CLIP}.endFill`, []);
    }
    if (this.tick === 3) Object.assign(this.results, { width: ui.getFloat(HUD_MENU, `${CLIP}._width`), height: ui.getFloat(HUD_MENU, `${CLIP}._height`) });
    if (this.tick === HOLD_TICKS) {
      Object.assign(this.results, { stillThere: ui.getString(HUD_MENU, `${CLIP}._name`), widthLater: ui.getFloat(HUD_MENU, `${CLIP}._width`) });
      ui.invokeStringA(HUD_MENU, `${CLIP}.removeMovieClip`, []);
    }
    if (this.tick === HOLD_TICKS + 2) {
      this.results.afterRemove = ui.getString(HUD_MENU, `${CLIP}._name`);
      this.finish("done");
    }
  }

  private finish(why: string): void {
    this.armed = false;
    this.tick = 0;
    this.results.end = why;
    sendCustomPacket(this.controller, { customPacketType: "dbo", event: "hudTest", args: [this.results], widget: 0 });
    logTrace(this, "HUD overlay test", JSON.stringify(this.results));
  }
}
