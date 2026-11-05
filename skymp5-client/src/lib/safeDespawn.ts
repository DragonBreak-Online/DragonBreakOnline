import { Actor, Game, ObjectReference, once, TESModPlatform } from "skyrimPlatform";
import { forgetLocalCopy } from "../sync/movementApply";
import { SpApiInteractor } from "../services/spApiInteractor";
import { WorldCleanerService } from "../services/services/worldCleanerService";

/**
 * Safely despawns and deletes an actor or reference without crashing the Skyrim engine.
 * 
 * Prevents:
 * 1. Havok Animation & Behavior Graph access violations (SkyrimSE.exe+0B0540D / hkbBehaviorGraph_Update)
 *    by isolating the reference before deletion, giving worker threads (BSJobs) time to finish.
 * 2. AI Detection races (VCRUNTIME140.dll memcpy overflow / SkyrimSE.exe+07AF954)
 *    by calling stopCombat() and disableNoWait(false) to immediately unlink from StandardDetectionListener.
 * 3. Havok Physics / Ragdoll constraint crashes (hkpWorld::RemoveEntity / VTABLE_hkpLimitedHingeConstraintData)
 *    by calling forceRemoveRagdollFromWorld() before the reference is freed.
 * 4. Papyrus VM native latent dereference crashes (SkyrimSE.exe+14247A5 / 104287 / 104651)
 *    by deferring physical deletion across frame boundary and checking !isDeleted().
 */
export const safeDespawnActor = (refrId: number): void => {
  if (!refrId || refrId < 0xff000000) return;

  const refr = ObjectReference.from(Game.getFormEx(refrId));
  if (!refr || refr.isDeleted()) {
    forgetLocalCopy(refrId);
    return;
  }

  const ac = Actor.from(refr);
  if (ac) {
    try {
      ac.stopCombat();
    } catch { /* ignore */ }
    try {
      ac.clearKeepOffsetFromActor();
    } catch { /* ignore */ }
    try {
      TESModPlatform.setWeaponDrawnMode(ac, -1);
    } catch { /* ignore */ }
    try {
      // Detach ragdoll constraints cleanly from hkpWorld
      ac.forceRemoveRagdollFromWorld();
    } catch { /* ignore */ }
  }

  // 1. Immediately disable reference to remove from AI detection lists & physics islands
  try {
    refr.disableNoWait(false);
  } catch { /* ignore */ }

  // 2. Move far away so raycasts and cell updates cannot encounter it
  try {
    refr.setPosition(0, 0, -30000);
  } catch { /* ignore */ }

  // 3. Clear local movement tracking
  forgetLocalCopy(refrId);

  // 4. Defer deletion to next update tick so any concurrent Havok tasklets finish cleanly
  once("update", () => {
    try {
      const dying = ObjectReference.from(Game.getFormEx(refrId));
      if (dying && !dying.isDeleted()) {
        dying.delete();
      }
    } catch { /* ignore */ }
    try {
      SpApiInteractor.getControllerInstance().lookupListener(WorldCleanerService).modWcProtection(refrId, -1);
    } catch { /* ignore */ }
  });
};
