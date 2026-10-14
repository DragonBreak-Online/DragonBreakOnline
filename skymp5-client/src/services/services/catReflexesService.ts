import { ClientListener, CombinedController, Sp } from "./clientListener";
import { parseCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { logTrace, logError } from "../../logging";
import { CAT_REFLEXES, CatReflexesPlan, CatReflexesStep, readCatReflexesOrder } from "./catReflexesPlan";

// The Khajiit's Cat-like Reflexes on this player's own game, by the server's dboCatReflexes orders (catReflexesPlan.ts
// says what they are and why the jump is a game setting). Every step runs on a frame (controller "update"), never in the
// packet's callback.
// The speed is the player's SpeedMult with the carry weight nudge after it, because the engine re-reads movement speed
// only when the carried weight changes - the same way ParalysisService slows a howled-at player and MealService a
// player at a meal. It adds to theirs rather than replacing it, so a Khajiit slowed by a meal is still slowed.
// What is given is always taken off again: on the server's "off", on a lost "off" (the plan's grace), on a disconnect
// and on a login. A step that found no player leaves the record standing and the next frame takes it off, so nothing
// stays on this game once the power is over.
export class CatReflexesService extends ClientListener {
  private plan = new CatReflexesPlan();
  private pending: CatReflexesStep[] = [];
  private speedOn = 0;    // the SpeedMult this service added and has not taken off yet
  private jumpBase = 0;   // fJumpHeightMin as it was before this service raised it; 0 while it has not

  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onMessage(e));
    this.controller.emitter.on("connectionDisconnect", () => this.queue(this.plan.reset()));
    this.controller.emitter.on("connectionAccepted", () => this.queue(this.plan.reset()));
    this.controller.on("update", () => this.onUpdate());
  }

  private onMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const order = readCatReflexesOrder(parseCustomPacket(event));
    if (!order) return;
    logTrace(this, "Cat-like Reflexes", order.on
      ? `on for ${order.seconds} s (speed ${order.speed}, jump ${order.jump})` : "off");
    this.queue(this.plan.receive(order, Date.now()));
  }

  private queue(steps: CatReflexesStep[]): void {
    for (const step of steps) this.pending.push(step);
  }

  private onUpdate(): void {
    this.queue(this.plan.tick(Date.now()));
    if (this.pending.length) {
      const steps = this.pending.splice(0);
      for (const step of steps) {
        try { step.kind === "start" ? this.give(step.speed, step.jump) : this.take(); }
        catch (e) { logError(this, "Cat-like Reflexes step failed:", step, e); }
      }
    }
    // It is over and something is still on this game (a step that found no player, or a write that threw): take it off
    if (!this.plan.isOn() && (this.speedOn !== 0 || this.jumpBase > 0)) {
      try { this.take(); } catch (e) { logError(this, "Cat-like Reflexes could not be taken off:", e); }
    }
  }

  private give(speed: number, jump: number): void {
    this.take(); // never twice over
    if (speed > 0 && this.setSpeed(speed)) this.speedOn = speed;
    if (jump > 0) {
      const base = this.sp.Game.getGameSettingFloat(CAT_REFLEXES.jumpSetting);
      if (base > 0) {
        this.sp.Game.setGameSettingFloat(CAT_REFLEXES.jumpSetting, base * (1 + jump));
        this.jumpBase = base;
      }
    }
  }

  private take(): void {
    if (this.jumpBase > 0) {
      this.sp.Game.setGameSettingFloat(CAT_REFLEXES.jumpSetting, this.jumpBase);
      this.jumpBase = 0;
    }
    if (this.speedOn !== 0 && this.setSpeed(-this.speedOn)) this.speedOn = 0;
  }

  /** The player's SpeedMult by `delta`, and the nudge that makes the engine re-read movement speed. False: no player */
  private setSpeed(delta: number): boolean {
    const player = this.sp.Game.getPlayer();
    if (!player) return false;
    try {
      player.modActorValue("SpeedMult", delta);
      player.modActorValue("CarryWeight", 0.1);
      player.modActorValue("CarryWeight", -0.1);
      return true;
    } catch { return false; }
  }
}
