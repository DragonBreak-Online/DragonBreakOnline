import { Actor, ActorBase, Game, Race, Ui, Utility, callNative, once } from "skyrimPlatform";
import { GOBLIN_RACES, GoblinHeadState, headTintArgs, resolveRaceIds } from "./goblinRaces";
import { isGuardedActor } from "./beastRaces";
import { hex, trace } from "../lib/clientDiag";

// After the NiNode update went out, and again in case the 3D reset put the head piece back later
const PAINT_AFTER_S = [1, 4];

export interface SkinLook {
  raceId: number;
  skinColor: number;
  isFemale: boolean;
}

const state = new GoblinHeadState();
let raceIds: Set<number> | null = null;
let gen = 0;

// In update; an empty result (no DLE, or one without these races) is asked again on the next look
const goblinRaceIds = (): Set<number> => {
  if (raceIds) return raceIds;
  const ids = resolveRaceIds(GOBLIN_RACES, (localId, file) => {
    const race = Race.from(Game.getFormFromFile(localId, file));
    return race ? race.getFormID() : 0;
  });
  if (ids.length) raceIds = new Set(ids);
  return raceIds || new Set<number>();
};

const liveRaceOf = (player: Actor): number => {
  try { return (player.getRace()?.getFormID() ?? 0) >>> 0; } catch (e) { return 0; }
};

const isGoblin = (ids: Set<number>, player: Actor, look: SkinLook): boolean =>
  ids.has(liveRaceOf(player)) || ids.has(Number(look.raceId) >>> 0);

// In update: the base's skin colour on the head piece, as the login's fresh 3D draws it
const paint = (look: SkinLook, tag: string): void => {
  const skin = Number(look.skinColor) & 0xffffff;
  try {
    const player = Game.getPlayer();
    if (!player) return;
    let why = "";
    if (Ui.isMenuOpen("RaceSex Menu")) why = "menu";
    else if (!player.is3DLoaded()) why = "3d";
    else if (isGuardedActor(player)) why = "guarded";
    else if (!isGoblin(goblinRaceIds(), player, look)) why = "race";
    if (why) { trace(`goblin head skip=${why} ${tag}`); return; }
    const base = ActorBase.from(player.getBaseObject());
    const female = base ? base.getSex() === 1 : !!look.isFemale;
    callNative("NiOverride", "AddSkinOverrideInt", undefined, player, ...headTintArgs(female, skin));
    state.painted(skin);
    trace(`goblin head tint=${hex(skin)} ${tag}`);
  } catch (e) {
    trace(`goblin head err ${tag} ${String(e).slice(0, 80)}`);
  }
};

// In update, after a look went on the player: a goblin whose skin colour changed gets its head piece painted; a newer look cancels
export const goblinHeadAfterLook = (look: SkinLook, event: string): void => {
  try {
    const my = ++gen;
    if (event === "load") { state.afterLook(event, false, look.skinColor); return; }
    const player = Game.getPlayer();
    if (!player) return;
    const ids = goblinRaceIds();
    if (!ids.size || !state.afterLook(event, isGoblin(ids, player, look), look.skinColor)) return;
    for (const s of PAINT_AFTER_S) Utility.wait(s).then(() => once("update", () => { if (my === gen) paint(look, `${event}+${s}s`); }));
  } catch (e) { /* the rest of the look is on; an unpainted head is drawn right at the next login */ }
};
