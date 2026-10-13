import { ClientListener, CombinedController, Sp } from "./clientListener";
import { parseCustomPacket } from "./customPacketUtil";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { logTrace, logError } from "../../logging";
import { NIGHT_EYE, NightEyePlan, NightEyeStep, readNightEyeOrder } from "./nightEyePlan";

// The Khajiit's Night Eye on this player's own screen, by the server's dboNightEye orders (nightEyePlan.ts says what they
// are and which records). Every step runs on a frame (controller "update"), never in the packet's callback.
// Riddle'Thar's blessing casts the vanilla NightEyeEffect, whose own script holds the same NightEyeImod: while it is on,
// the power neither applies the look a second time nor takes it off, so the blessing's look stays its own.
export class NightEyeService extends ClientListener {
  private plan = new NightEyePlan();
  private pending: Array<{ step: NightEyeStep; quiet: boolean }> = [];
  private shown = false; // this service applied the look (the blessing was not already showing it)

  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.emitter.on("customPacketMessage", (e) => this.onMessage(e));
    this.controller.emitter.on("connectionDisconnect", () => this.queue(this.plan.reset(), true));
    this.controller.emitter.on("connectionAccepted", () => this.queue(this.plan.reset(), true));
    this.controller.on("update", () => this.onUpdate());
  }

  private onMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const order = readNightEyeOrder(parseCustomPacket(event));
    if (!order) return;
    logTrace(this, "Night Eye", order.on ? `on for ${order.seconds} s` : "off");
    this.queue(this.plan.receive(order, Date.now()), false);
  }

  private queue(steps: NightEyeStep[], quiet: boolean): void {
    for (const step of steps) this.pending.push({ step, quiet });
  }

  private onUpdate(): void {
    this.queue(this.plan.tick(Date.now()), false);
    if (!this.pending.length) return;
    const steps = this.pending.splice(0);
    for (const { step, quiet } of steps) {
      try { this.run(step, quiet); } catch (e) { logError(this, "Night Eye step failed:", step, e); }
    }
  }

  private imod(id: number) { return this.sp.ImageSpaceModifier.from(this.sp.Game.getFormEx(id)); }

  private blessingOn(): boolean {
    const player = this.sp.Game.getPlayer();
    const effect = this.sp.MagicEffect.from(this.sp.Game.getFormEx(NIGHT_EYE.effect));
    return !!player && !!effect && player.hasMagicEffect(effect);
  }

  private sound(id: number): void {
    const player = this.sp.Game.getPlayer();
    const s = this.sp.Sound.from(this.sp.Game.getFormEx(id));
    if (player && s) s.play(player);
  }

  private run(step: NightEyeStep, quiet: boolean): void {
    if (step === "start") {
      if (this.blessingOn()) { this.shown = false; return; }
      const intro = this.imod(NIGHT_EYE.intro);
      if (intro) intro.apply(1.0);
      this.sound(NIGHT_EYE.soundOn);
      this.shown = true;
      return;
    }
    if (step === "main") {
      if (!this.shown) return;
      const intro = this.imod(NIGHT_EYE.intro);
      const main = this.imod(NIGHT_EYE.main);
      if (intro) intro.remove();
      if (main) main.apply(1.0);
      return;
    }
    // end
    if (!this.shown) return;
    this.shown = false;
    const intro = this.imod(NIGHT_EYE.intro);
    if (intro) intro.remove();
    if (this.blessingOn()) return; // the blessing came on meanwhile: its script holds the look and ends it
    const main = this.imod(NIGHT_EYE.main);
    if (main) main.remove();
    if (quiet) return;
    const outro = this.imod(NIGHT_EYE.outro);
    if (outro) outro.apply(1.0);
    this.sound(NIGHT_EYE.soundOff);
  }
}
