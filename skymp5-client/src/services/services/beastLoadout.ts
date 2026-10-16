// Beast form loadout choices for beastFormService.ts, import-free so a harness can drive it

export interface LoadoutEntry { id: number; shout?: number }

// The slot's new index: a form spell held there other than ourId (the service's last equip) was picked by the player
export function adoptHeld(list: LoadoutEntry[], chosen: number, heldId: number | null | undefined, ourId: number): number {
  if (!list.length || !heldId || (heldId >>> 0) === (ourId >>> 0)) return chosen;
  const i = list.findIndex((e) => !e.shout && (e.id >>> 0) === (heldId >>> 0));
  return i >= 0 ? i : chosen;
}

// Gear a beast form never wears but its own outfit (SkyrimPlatform FormType: Armor 26, Light 31, Weapon 41, Ammo 42)
export const BEAST_GEAR_TYPES: readonly number[] = [26, 31, 41, 42];

// True for an equip the form should undo: armour, a light, a weapon or ammo that is not in the server's outfit for it
export function isForeignBeastGear(type: number, id: number, wear: ReadonlySet<number>): boolean {
  return BEAST_GEAR_TYPES.indexOf(type) >= 0 && !wear.has(id >>> 0);
}
