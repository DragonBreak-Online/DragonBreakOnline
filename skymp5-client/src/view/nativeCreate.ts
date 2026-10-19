// LIFECYCLE_PLAN.md phase 2b: SkyrimPlatform's createCopy makes an NPC copy at its final spot, not disabled.
// placeAtMe(..., initiallyDisabled) queued a Disable task at every copy's birth (a copy destroyed at once had it run on a
// deleted actor, SkyrimSE 41702) and the copy then had to be moved, which other players missed. Used when the platform has
// it and the server's drift switch nativeCreate, or skymp5-client-settings.txt "nativeCopyCreate": true (a dev install's
// own override), asks for it; otherwise placeAtMe as before
import { Form, Game, ObjectReference } from "skyrimPlatform";
import * as sp from "skyrimPlatform";
import { driftConfig } from "../sync/driftConfig";
import { noteActorCall } from "./npcLifetimeRuntime";

interface CreateSp {
  createCopy?: (baseId: number, x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number, worldOrCellId: number) => number;
}
const createSp = sp as unknown as CreateSp;

const localOverride: boolean = (() => {
  try { return (sp.settings["skymp5-client"] as Record<string, unknown> | undefined)?.["nativeCopyCreate"] === true; } catch (e) { return false; }
})();

export const nativeCreateOn = (): boolean =>
  typeof createSp.createCopy === "function" && (localOverride || driftConfig.nativeCreate);

// The new copy, or null when native creation is off or fails (the caller then uses placeAtMe)
export const nativeCreateCopy = (base: Form, pos: number[], rot: number[], worldOrCell: number): ObjectReference | null => {
  if (!nativeCreateOn() || !worldOrCell) return null;
  try {
    const id = createSp.createCopy!(base.getFormID(), pos[0], pos[1], pos[2], rot[0] || 0, rot[1] || 0, rot[2] || 0, worldOrCell);
    const ref = id ? ObjectReference.from(Game.getFormEx(id)) : null;
    if (ref) noteActorCall("create-native", id);
    return ref;
  } catch (e) {
    return null;
  }
};
