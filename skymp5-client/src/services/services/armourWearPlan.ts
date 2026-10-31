// Server packet dboArmourWear { speedMult, staminaCostMult }: the armour debuff of gameplay armorWear debuff mode.

// Skyrim.esm GMSTs scaled by staminaCostMult (power attack 2.0 at 0001434E, sprint drain 7.0 at 0002DD35).
export const ARMOUR_WEAR_SETTINGS = ["fPowerAttackStaminaPenalty", "fSprintStaminaDrainMult"] as const;
export const ARMOUR_WEAR_LIMITS = { minSpeed: -90, maxCost: 3 };

export interface ArmourWearOrder { speed: number; cost: number }

export const readArmourWearOrder = (content: Record<string, unknown> | null | undefined): ArmourWearOrder | null => {
  if (!content || content["customPacketType"] !== "dboArmourWear") return null;
  const speed = Number(content["speedMult"]), cost = Number(content["staminaCostMult"]);
  return {
    speed: Number.isFinite(speed) ? Math.max(ARMOUR_WEAR_LIMITS.minSpeed, Math.min(0, Math.round(speed))) : 0,
    cost: Number.isFinite(cost) ? Math.max(1, Math.min(ARMOUR_WEAR_LIMITS.maxCost, cost)) : 1,
  };
};

// The SpeedMult delta joins the other slows instead of replacing them; settings scale from their remembered base.
export const armourWearSteps = (held: { speed: number }, order: ArmourWearOrder, bases: Record<string, number>) => ({
  speedDelta: order.speed - held.speed,
  settings: ARMOUR_WEAR_SETTINGS.filter((s) => bases[s] > 0).map((s) => ({ setting: s, value: bases[s] * order.cost })),
});
