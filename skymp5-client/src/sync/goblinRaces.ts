// The DLE's goblin races, whose head is the skin's slot 30 piece tinted like the body, not a FaceGen head (no imports, for tests/goblin-head-harness.js)
export const DLE = "DragonBreak Online Edits.esp";

// [plugin, local id, editor id], resolved by plugin and local id at runtime, never by a load-order slot
export const GOBLIN_RACES: ReadonlyArray<readonly [string, number, string]> = [
  [DLE, 0x1aca01, "DBOGoblinRace"],
  [DLE, 0x1aca09, "DBOGoblinSwampRace"],
  [DLE, 0x1aca11, "DBOGoblinAshRace"],
  [DLE, 0x1aca19, "DBOGoblinOchreRace"],
  [DLE, 0x1d1fa2, "DBOGoblinRaceVampire"],
];

// Load-order ids of the listed races that resolve; lookup gives a race's id, or 0 for a missing plugin, record or non-race
export const resolveRaceIds = (list: ReadonlyArray<readonly [string, number, string]>,
  lookup: (localId: number, file: string) => number): number[] => {
  const ids: number[] = [];
  for (const [file, localId] of list) {
    let id = 0;
    try { id = Number(lookup(localId, file)) >>> 0; } catch (e) { id = 0; }
    if (id) ids.push(id);
  }
  return ids;
};

// skee64 NiOverride.AddSkinOverrideInt(ref, isFemale, firstPerson, slotMask, key, index, value, persist) after the ref
// The mask picks the item worn on slot 30, else the skin; skee tints every skin-tint shape of that armour's addons, head and body
export const SLOT_30_MASK = 0x1;
export const KEY_TINT_COLOR = 7;
export const headTintArgs = (isFemale: boolean, skinColor: number): [boolean, boolean, number, number, number, number, boolean] =>
  [!!isFemale, false, SLOT_30_MASK, KEY_TINT_COLOR, -1, Number(skinColor) & 0xffffff, false];

// The skin colour the player's goblin head piece shows, and whether a look just put on must paint it again
export class GoblinHeadState {
  private shown: number | undefined = undefined;

  // A login's save carries the skin colour, so its 3D comes in with the head already that colour
  afterLook(event: string, goblin: boolean, skinColor: number): boolean {
    const skin = Number(skinColor) & 0xffffff;
    if (event === "load") { this.shown = skin; return false; }
    return goblin && this.shown !== skin;
  }

  painted(skinColor: number): void {
    this.shown = Number(skinColor) & 0xffffff;
  }
}
