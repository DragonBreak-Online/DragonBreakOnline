// Whether a watcher keeps a local copy of a player hidden by ff_adminModes.invis (an Invisible admin, character creation).
// A copy at alpha 0 still ran its animation graph, so its foot events played footstep sounds, and it still had a body.
// The copy returns only after REVEAL_HOLD_MS un-hidden, so a mirror rewritten for a moment does not spawn and delete one.
// No imports, so tests/invisquiet-harness.js can transpile and drive it.

export type AdminView = "visible" | "hidden" | "ghost";

export const REVEAL_HOLD_MS = 1500;

// Invisible is hidden from every watcher, staff included (any copy is an actor that makes sounds); Ghost is a ghost to all
export function adminViewOfModes(modes: unknown): AdminView {
  if (!modes || typeof modes !== "object") return "visible";
  const m = modes as Record<string, unknown>;
  if (m["invis"]) return "hidden";
  return m["ghost"] ? "ghost" : "visible";
}

/** The moment the player was last seen hidden: now while hidden, otherwise unchanged. */
export function nextHiddenAt(view: AdminView, lastHiddenAt: number, now: number): number {
  return view === "hidden" ? now : lastHiddenAt;
}

/** True while the watcher should keep no copy: hidden now, or un-hidden for less than REVEAL_HOLD_MS. */
export function keepNoCopy(view: AdminView, lastHiddenAt: number, now: number): boolean {
  if (view === "hidden") return true;
  return lastHiddenAt > 0 && now - lastHiddenAt < REVEAL_HOLD_MS;
}

/** A viewer's staff rank: the number their own mirror carries, else 1 for staff (isAdmin) and 0 for a player. */
export function staffRankOf(rank: unknown, isAdmin: boolean): number {
  const n = Number(rank);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return isAdmin ? 1 : 0;
}

/** Whether a viewer of `viewerRank` sees an Invisible staff member of `invisRank` as a ghost: staff of the same or a higher rank. */
export function seesInvisible(viewerRank: number, invisRank: unknown): boolean {
  if (!(viewerRank > 0)) return false;
  const r = Number(invisRank);
  return viewerRank >= (Number.isFinite(r) && r > 0 ? r : 1);
}
