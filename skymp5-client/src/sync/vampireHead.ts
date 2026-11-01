// A remote copy on a vampire race: its look's face and eyes on the live head (vampire-eyes, 1 Nov; pk-0573).
// Rain saw vampire eyes on Kazimir #F7JV while the server's look for him held his own: the copy is built on his vampire race,
// and the race's own head parts (vampire eyes, the fangs) win on the live head, as they did on the owner's screen
// (appearance.ts, the 21 Oct note). So once a copy's 3D has settled, and again after each face rebuild, the look's face and
// eyes go on with changeHeadPart: SKSE's Actor.ChangeHeadPart, which has no player check and alters both the base's list
// and the loaded mesh (skse64 PapyrusActor.cpp). A beast copy (a Vampire Lord, a werewolf) is never touched.
import { Actor } from "skyrimPlatform";
import { Appearance, isVampireRaceId, putHeadPartsOn } from "./appearance";

// After the 3D loads or a rebuild, this long first: not mid-load, and after the queued NiNode update
export const VAMPIRE_HEAD_AFTER_MS = 1000;

export interface VampireHeadState {
  // when the copy's 3D was first seen loaded this time (0: not loaded)
  loadedAt: number;
  // when the face and eyes last went on (0: never this load)
  putAt: number;
}

export const newVampireHeadState = (): VampireHeadState => ({ loadedAt: 0, putAt: 0 });

// Whether the face and eyes are due now; keeps loadedAt. rebuildAt: the copy's last face rebuild (formView rebuild.lastMs)
export const vampireHeadDue = (s: VampireHeadState, now: number, loaded: boolean, raceId: number, beast: boolean, rebuildAt: number): boolean => {
  if (!loaded) { s.loadedAt = 0; s.putAt = 0; return false; }
  if (!s.loadedAt) s.loadedAt = now;
  if (beast || !isVampireRaceId(raceId >>> 0)) return false;
  if (now - s.loadedAt < VAMPIRE_HEAD_AFTER_MS) return false;
  if (!s.putAt) return true;
  return rebuildAt > s.putAt && now - rebuildAt >= VAMPIRE_HEAD_AFTER_MS;
};

// Puts them on and notes it; the number of parts put on
export const putVampireHead = (s: VampireHeadState, actor: Actor, appearance: Appearance, now: number): number => {
  s.putAt = now;
  return putHeadPartsOn(actor, appearance, "copy");
};
