// The third-person camera attaches to a node named "Camera3rd [Cam3]" in the skeleton. Measured 25 Oct: of the
// 43 loose skeletons in the pack, the only creature-ish ones carrying it are werewolfbeast and vampirelord -
// exactly the two forms Bethesda made playable. hagraven, bear, wolf and the rest have none, so for them the
// camera falls back to the root and sits in the ground.
//
// That also explains why the fOverShoulder* ini values do nothing in a creature body (Nat, 25 Oct): they are
// offsets FROM that node, so with no node there is nothing to offset. They work again the moment a skeleton
// gains one, which is why this module applies them only when the node is really there.
//
// No imports, so a harness can load it on its own (tests/creature-camera-harness.js).

export const CAM3_NODE = "Camera3rd [Cam3]";

// The four ini values a form may move. Named here so the service and the harness cannot drift apart.
export const OVER_SHOULDER_INI = {
  x: "fOverShoulderPosX:Camera",
  z: "fOverShoulderPosZ:Camera",
  combatX: "fOverShoulderCombatPosX:Camera",
  combatZ: "fOverShoulderCombatPosZ:Camera",
} as const;

export type OverShoulderKey = keyof typeof OVER_SHOULDER_INI;

export interface CameraOffsets {
  x?: number;
  z?: number;
  combatX?: number;
  combatZ?: number;
}

// What the client should do on entering a body, or on leaving one
export interface CameraPlan {
  // "third": the node is there, so third person works. "first": it is not, so third person would be in the ground.
  person: "first" | "third";
  // The ini values to write, or null to leave the ini alone. Never set without the node: the values would be
  // inherited by the next body whose camera re-initialises, which is how Nat's human camera ended up raised.
  offsets: CameraOffsets | null;
  why: string;
}

const FINITE = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Only the four known keys, and only finite numbers; anything else is dropped rather than written to an ini
export const readOffsets = (raw: unknown): CameraOffsets | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: CameraOffsets = {};
  let any = false;
  for (const k of Object.keys(OVER_SHOULDER_INI) as OverShoulderKey[]) {
    const v = Number(r[k]);
    if (r[k] !== undefined && r[k] !== null && FINITE(v)) { out[k] = v; any = true; }
  }
  return any ? out : null;
};

// hasNode is what NetImmerse.hasNode(player, CAM3_NODE, false) answered; offsets are what the server sent for
// this form, or null when it sent none
export const planForBody = (hasNode: boolean, offsets: CameraOffsets | null): CameraPlan => {
  if (!hasNode) {
    return {
      person: "first",
      offsets: null,
      why: "this body has no camera node, so third person would sit in the ground",
    };
  }
  return {
    person: "third",
    offsets,
    why: offsets ? "this body has a camera node and the server sent offsets" : "this body has a camera node",
  };
};

// Leaving the body: the remembered person, and the remembered ini values when we wrote any
export const planForLeaving = (wasFirstPerson: boolean, wrote: CameraOffsets | null, saved: CameraOffsets | null): CameraPlan => ({
  person: wasFirstPerson ? "first" : "third",
  offsets: wrote ? saved : null,
  why: wrote ? "restoring the camera this body moved" : "restoring the view",
});
