// When a copy's 3D is rebuilt for its face tints (formView.ts), import-free so a harness can drive it

export interface OnScreenRebuildState {
  isOnScreen: boolean;
  lastMs: number;
  // The rebuild has gone out for the copy's current 3D
  doneThisLoad: boolean;
}

// Once per 3D load, when the head first comes on screen: rebuilding on every return to the screen swapped heads under
// the face-morph job (SkyrimSE+04328E9). A copy whose 3D went away is due again when it comes back.
export const onScreenRebuildDue = (s: OnScreenRebuildState, onScreen: boolean, loaded: boolean, blocked: boolean, now: number, minIntervalMs: number): boolean => {
  if (!loaded) s.doneThisLoad = false;
  if (onScreen === s.isOnScreen) return false;
  s.isOnScreen = onScreen;
  if (!onScreen || blocked || s.doneThisLoad || now - s.lastMs < minIntervalMs) return false;
  s.lastMs = now;
  s.doneThisLoad = true;
  return true;
};
