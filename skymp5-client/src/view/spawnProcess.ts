import { ObjectReference, Game, Actor, MotionType, TESModPlatform, Cell, WorldSpace } from "skyrimPlatform";
import { Appearance, applyTints } from "../sync/appearance";
import { NiPoint3 } from "../sync/movement";
import { ObjectReferenceEx } from "../extensions/objectReferenceEx";
import { setRefrCollision } from "../sync/animation";
import { FLYER_NO_RESURRECT, guardOn } from "./flyerGuard";
import { noteFlyer, takeSpawnGuard } from "./flyerRuntime";
import { reportError } from "../lib/clientDiag";

// "moveTo" seats the new copy at its spot natively before its first load, so a reload cannot put it back at the player
export type SpawnPlaceMode = "moveTo" | "setPosition";

export class SpawnProcess {
  static placeMode: SpawnPlaceMode = "moveTo";

  constructor(
    appearance: Appearance | null,
    pos: NiPoint3,
    refrId: number,
    private callback: () => void,
    // Created by createCopy at its spot and enabled (view/nativeCreate.ts): nothing to seat, move or enable
    placedNatively: boolean = false,
  ) {
    const refr = ObjectReference.from(Game.getFormEx(refrId));
    if (!refr || refr.getFormID() !== refrId) {
      return;
    }

    // A dragon's copy (flyerGuard.ts): a line before every step, and the switches a staff test turned on
    this.flyer = takeSpawnGuard(refrId);
    if (placedNatively) {
      this.note("placed-natively", refrId, `at ${pos.map(Math.round).join(",")}`);
      try { this.afterEnable(appearance, refrId); } catch (e) { reportError("spawn", e); }
      return;
    }
    this.note("pre-seat", refrId, `at ${pos.map(Math.round).join(",")}`);
    if (SpawnProcess.placeMode === "moveTo") SpawnProcess.seat(refr, pos);
    this.note("pre-setPosition", refrId);
    // A step that throws ends this spawn; left unhandled, its rejection would close the game
    refr.setPosition(...pos).then(() => this.enable(appearance, refrId)).catch((e) => reportError("spawn", e));
  }

  private flyer: { bits: number; remoteId: number; bornAt: number } | undefined;

  private note(kind: string, refrId: number, extra?: string) {
    if (this.flyer) noteFlyer(kind, refrId, this.flyer.remoteId, this.flyer.bornAt, extra);
  }

  private static seat(refr: ObjectReference, pos: NiPoint3) {
    const player = Game.getPlayer();
    if (!player) return;
    const world = player.getWorldSpace();
    const cell = world ? null : player.getParentCell();
    if (!world && !cell) return;
    TESModPlatform.moveRefrToPosition(refr, cell as Cell | null, world as WorldSpace | null, pos[0], pos[1], pos[2], 0, 0, 0);
  }

  private enable(appearance: Appearance | null, refrId: number) {
    const refr = ObjectReference.from(Game.getFormEx(refrId));
    if (!refr || refr.getFormID() !== refrId) {
      return;
    }

    const ac = Actor.from(refr);
    if (ac && appearance) {
      // A copy without its tints still beats one that is never enabled
      try { applyTints(ac, appearance); } catch (e) { reportError("spawn:tints", e); }
    }
    this.note("pre-enable", refrId);
    return refr.enable(false).then(() => this.resurrect(refrId));
  }

  // The native path: tints, then the same resurrect step; the copy is already where it belongs and enabled
  private afterEnable(appearance: Appearance | null, refrId: number) {
    const refr = ObjectReference.from(Game.getFormEx(refrId));
    if (!refr || refr.getFormID() !== refrId) {
      return;
    }
    const ac = Actor.from(refr);
    if (ac && appearance) {
      try { applyTints(ac, appearance); } catch (e) { reportError("spawn:tints", e); }
    }
    const done = this.resurrect(refrId);
    if (done && typeof (done as Promise<void>).catch === "function") (done as Promise<void>).catch((e) => reportError("spawn", e));
  }

  private resurrect(refrId: number) {
    const refr = ObjectReference.from(Game.getFormEx(refrId));
    if (!refr || refr.getFormID() !== refrId) {
      return;
    }

    const ac = Actor.from(refr);
    if (ac && this.flyer && guardOn(this.flyer.bits, FLYER_NO_RESURRECT)) {
      this.note("skip-resurrect", refrId);
      setRefrCollision(refrId, true);
      this.callback();
      return;
    }
    if (ac) {
      this.note("pre-resurrect", refrId);
      return ac.resurrect().then(() => {
        // A copy deleted while it was being resurrected is gone, and setCollision throws on a missing ref
        const resurrected = ObjectReference.from(Game.getFormEx(refrId));
        if (!resurrected || resurrected.getFormID() !== refrId) {
          return;
        }
        setRefrCollision(refrId, true);
        this.callback();
      });
    }

    ObjectReferenceEx.dealWithRef(refr, refr.getBaseObject()!);

    return refr.setMotionType(MotionType.Keyframed, true).then(this.callback);
  }
}
