import { ClientListener, CombinedController, Sp } from "./clientListener";
import { parseCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { logTrace, logError } from "../../logging";
import { ARMOUR_WEAR_SETTINGS, ArmourWearOrder, armourWearSteps, readArmourWearOrder } from "./armourWearPlan";

// Applies the server's armour debuff on a frame; cleared on connect and disconnect until the server sends it again.
export class ArmourWearService extends ClientListener {
  private wanted: ArmourWearOrder = { speed: 0, cost: 1 };
  private held = { speed: 0 };
  private bases: Record<string, number> = {};
  private dirty = false;

  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onMessage(e));
    this.controller.emitter.on("connectionDisconnect", () => this.order({ speed: 0, cost: 1 }));
    this.controller.emitter.on("connectionAccepted", () => this.order({ speed: 0, cost: 1 }));
    this.controller.on("update", () => this.onUpdate());
  }

  private onMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const order = readArmourWearOrder(parseCustomPacket(event));
    if (!order) return;
    logTrace(this, "Armour wear", `speed ${order.speed}, stamina costs x${order.cost}`);
    this.order(order);
  }

  private order(order: ArmourWearOrder): void {
    this.wanted = order;
    this.dirty = true;
  }

  private onUpdate(): void {
    if (!this.dirty) return;
    const player = this.sp.Game.getPlayer();
    if (!player) return;
    try {
      for (const s of ARMOUR_WEAR_SETTINGS) {
        if (!(this.bases[s] > 0)) { const v = this.sp.Game.getGameSettingFloat(s); if (v > 0) this.bases[s] = v; }
      }
      const steps = armourWearSteps(this.held, this.wanted, this.bases);
      if (steps.speedDelta !== 0) {
        // The carry weight nudge makes the engine re-read movement speed
        player.modActorValue("SpeedMult", steps.speedDelta);
        player.modActorValue("CarryWeight", 0.1);
        player.modActorValue("CarryWeight", -0.1);
        this.held.speed = this.wanted.speed;
      }
      for (const { setting, value } of steps.settings) this.sp.Game.setGameSettingFloat(setting, value);
      this.dirty = false;
    } catch (e) { logError(this, "Armour wear could not be applied:", e); }
  }
}
