// Server packet dboArmourWear { speedMult }: the armour debuff's slow (gameplay armorWear debuff mode).
// Stamina costs stay off: a GMST is global, so scaling one would change every NPC this client hosts too.

export const ARMOUR_WEAR_LIMITS = { minSpeed: -90 };

export interface ArmourWearOrder { speed: number }

export const readArmourWearOrder = (content: Record<string, unknown> | null | undefined): ArmourWearOrder | null => {
  if (!content || content["customPacketType"] !== "dboArmourWear") return null;
  const speed = Number(content["speedMult"]);
  return { speed: Number.isFinite(speed) ? Math.max(ARMOUR_WEAR_LIMITS.minSpeed, Math.min(0, Math.round(speed))) : 0 };
};

// The SpeedMult delta joins the other slows instead of replacing them.
export const armourWearSteps = (held: { speed: number }, order: ArmourWearOrder) => ({ speedDelta: order.speed - held.speed });
