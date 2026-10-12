import { Actor, ActorBase, Game, HeadPart, on } from "skyrimPlatform";
import { due, FaceProbe } from "./faceSyncDiag";
import { sendCustomPacket } from "../services/services/customPacketUtil";
import { SpApiInteractor } from "../services/spApiInteractor";

// Sends faceSyncDiag's lines as npcDrift once a second; the head is read when the line goes out
const HEADPART_EYES = 2;
let installed = false;

const probe = (localId: number): FaceProbe => {
  try {
    const actor = Actor.from(Game.getFormEx(localId >>> 0));
    if (!actor) return { exists: false };
    const base = ActorBase.from(actor.getBaseObject());
    let eyes = false;
    const n = base ? base.getNumHeadParts() : -1;
    for (let i = 0; base && i < n; i++) {
      const part: HeadPart | null = base.getNthHeadPart(i);
      if (part && !part.isExtraPart() && part.getType() === HEADPART_EYES) eyes = true;
    }
    return { exists: true, loaded: actor.is3DLoaded(), headParts: n, eyes, faceTexture: !!(base && base.getFaceTextureSet()) };
  } catch {
    return { exists: false };
  }
};

export const installFaceSyncReport = (): void => {
  if (installed) return;
  installed = true;
  let last = 0;
  on("update", () => {
    const now = Date.now();
    if (now - last < 1000) return;
    last = now;
    for (const line of due(now, probe)) {
      try { sendCustomPacket(SpApiInteractor.getControllerInstance(), { customPacketType: "dbo", event: "npcDrift", args: [line] }); } catch { /* not connected */ }
    }
  });
};
