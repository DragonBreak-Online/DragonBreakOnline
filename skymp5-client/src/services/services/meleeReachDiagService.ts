import { EquipEvent, HitEvent } from "skyrimPlatform";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { trace } from "../../lib/clientDiag";
import { isMeleeType, MeleeReachTrace, PrecisionState } from "./meleeReachDiag";

const PLAYER_FORM_ID = 0x14;

// The melee reach trace (meleeReachDiag.ts): observe only, it never changes a hit or an equip
export class MeleeReachDiagService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("equip", (e) => this.onEquip(e));
    this.controller.on("hit", (e) => this.onHit(e));
    this.controller.on("tick", () => this.send(this.reach.due(Date.now())));
  }

  private onEquip(e: EquipEvent): void {
    try {
      if (e.actor.getFormID() !== PLAYER_FORM_ID) return;
      const weapon = this.sp.Weapon.from(e.baseObj);
      if (!weapon) return;
      const type = weapon.getWeaponType();
      if (!isMeleeType(type)) return;
      this.send(this.reach.onEquip(weapon.getFormID(), type, this.precisionState()));
    } catch (err) { /* stale event object */ }
  }

  private onHit(e: HitEvent): void {
    try {
      if (e.aggressor.getFormID() !== PLAYER_FORM_ID || !e.source || e.projectile || e.isBashAttack) return;
      const weapon = this.sp.Weapon.from(e.source);
      if (!weapon || !this.sp.Actor.from(e.target)) return;
      const type = weapon.getWeaponType();
      if (!isMeleeType(type)) return;
      const a = e.aggressor, t = e.target;
      const d = Math.hypot(a.getPositionX() - t.getPositionX(), a.getPositionY() - t.getPositionY(), a.getPositionZ() - t.getPositionZ());
      this.send(this.reach.onHit(weapon.getFormID(), type, d, !!e.isPowerAttack, Date.now()));
    } catch (err) { /* stale event object */ }
  }

  // Precision_Utility.IsActorActive is Precision's own Papyrus native; without Precision the call throws, and is not tried again
  private precisionState(): PrecisionState {
    if (this.noPrecision) return "-";
    try {
      const player = this.sp.Game.getPlayer();
      return this.sp.callNative("Precision_Utility", "IsActorActive", undefined, player) === true ? "1" : "0";
    } catch (err) {
      this.noPrecision = true;
      return "-";
    }
  }

  private send(lines: string[]): void {
    for (const line of lines) trace(line);
  }

  private reach = new MeleeReachTrace();
  private noPrecision = false;
}
