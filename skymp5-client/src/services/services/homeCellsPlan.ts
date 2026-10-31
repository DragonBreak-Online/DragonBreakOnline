// The decisions behind HomeCellsService, with no engine in them, so they can be run without a game.
//
// Nat, 31 Oct: players get "stolen" items out of their own home barrels, because Skyrim's crime system sees
// the plugin's containers as NPC-owned. The server's housingSystem sends { customPacketType: "homeCells",
// cells: [...] } at login and after any ownership change, listing the cells that player owns outright, and the
// client makes the player the cell's owner so vanilla stops calling their own storage theft.

export type HomeCellAction = "take" | "restore" | "none";

// What this service displaced in a cell, so it can be put back exactly. Form ids, never native handles: a
// native object kept across frames is invalid after the next Papyrus update.
export interface DisplacedOwner {
  owner: number;
  faction: number;
}

// Cell ids out of a homeCells packet. Tolerant of anything, because this runs on whatever arrives on the wire:
// a wrong type must mean "no home cells", never a throw in the packet context.
export const parseHomeCells = (content: unknown): Set<number> => {
  const out = new Set<number>();
  if (!content || typeof content !== "object") {
    return out;
  }
  const cells = (content as Record<string, unknown>)["cells"];
  if (!Array.isArray(cells)) {
    return out;
  }
  for (const raw of cells) {
    // Checked BEFORE the unsigned cast, not after: `-1 >>> 0` is 4294967295, so a negative arriving on the
    // wire would otherwise pass an `id > 0` test as a plausible-looking form id. Number("") and Number(null)
    // are 0 and Number("x") is NaN, so junk falls out here too.
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      continue;
    }
    out.add(n >>> 0);
  }
  return out;
};

export const decideHomeCell = (
  owned: ReadonlySet<number>,
  taken: ReadonlyMap<number, DisplacedOwner>,
  cellId: number,
  isInterior: boolean,
  currentOwnerId: number,
  currentFactionId: number,
  playerBaseId: number
): HomeCellAction => {
  if (!cellId || !playerBaseId) {
    return "none";
  }
  if (owned.has(cellId)) {
    // The server offers both halves of each door pair, because either side can be the interior and it cannot
    // always tell which. An exterior id in the list is therefore expected, and refused here: owning an
    // exterior cell would hand the player a whole stretch of the world.
    if (!isInterior) {
      return "none";
    }
    // Already ours, and nothing else owns it. A faction owner has to be cleared as well as the actor owner:
    // Skyrim resolves ownership to an NPC OR a faction, so a cell left owned by a faction the player is not in
    // is still theft however the actor owner reads - "the actor owner is me" alone is not finished. Checked so
    // that a cell the player walks in and out of does not cost a native write per load.
    if (currentOwnerId === playerBaseId && !currentFactionId) {
      return "none";
    }
    return "take";
  }
  // Not owned any more, but we changed it: give the plugin's owner back. Without this, abandoning or losing a
  // house would leave its contents free to take for ever for the player who used to live there.
  if (taken.has(cellId)) {
    return "restore";
  }
  return "none";
};
