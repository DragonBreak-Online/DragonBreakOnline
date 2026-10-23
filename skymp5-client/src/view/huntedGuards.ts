// Guards set on a known beast (server exposure.js, bundle 1023), import-free so a harness can drive it. The server sends
// ff_huntedIn (the hold id) on a player while that player walks in a hold that saw them change into a werewolf or a Vampire
// Lord and still has a bounty on them; otherwise null. The client that hosts a guard NPC near such a player starts its fight
// with them: the player's own character when it is this client's, else their copy. FormViewArray fills huntedPlayers.

export const HUNT_CHECK_MS = 1000;
export const HUNT_RANGE = 2500;

export type HuntVec = [number, number, number];
// own: this client's own character. localRefrId: the copy's id in this game (0 for the own character)
export interface HuntedSpot { pos: HuntVec; cell: number; own: boolean; localRefrId: number }
export const huntedPlayers: { spots: HuntedSpot[] } = { spots: [] };

/** The hold id a form's ff_huntedIn names, or "" */
export const huntedHold = (form: Record<string, unknown>): string => {
  const v = form["ff_huntedIn"];
  return typeof v === "string" ? v : "";
};

/** The nearest hunted player within range of a guard at pos in cell (0 = unknown, compared loosely), or null */
export const huntTarget = (pos: HuntVec, cell: number, spots: HuntedSpot[], range: number = HUNT_RANGE): HuntedSpot | null => {
  let best: HuntedSpot | null = null; let bestD = Infinity;
  for (const s of spots) {
    if (cell && s.cell && s.cell !== cell) continue;
    const d = Math.hypot(pos[0] - s.pos[0], pos[1] - s.pos[1], pos[2] - s.pos[2]);
    if (d <= range && d < bestD) { best = s; bestD = d; }
  }
  return best;
};
