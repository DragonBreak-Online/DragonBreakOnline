#pragma once

#include "IDamageFormula.h"
#include "libespm/MGEF.h"
#include "libespm/SPEL.h"

class WorldState;

// A fire-and-forget damage over time counts whole (magnitude x duration) against target: an NPC only, a player
// victim takes the ticks through the clone replay on their own client (cloneSpellGuardService)
bool CountsWholeDamageOverTime(WorldState* worldState,
                               const espm::SPEL::SPITData* spellItem,
                               const MpActor& target);

// An effect's magnitude as damage, times its duration when wholeDamageOverTime and it ticks each second
float EffectDamageMagnitude(const espm::SPEL::EFIT& effectItem,
                            const espm::MGEF::DATA& data,
                            bool wholeDamageOverTime);

// Share of the damage a blocked hit keeps, for shields and wards alike (none)
inline constexpr float kBlockedHitDamageMult = 0.f;

// Implements vanilla Skyrim damage formula.
// Some parts may be missing. If they are, there should be a TODO regarding it.
// If there's no corresponding TODO, consider adding it and/or filing an issue.

class TES5DamageFormula : public IDamageFormula
{
public:
  [[nodiscard]] float CalculateDamage(const MpActor& aggressor,
                                      const MpActor& target,
                                      const HitData& hitData) const override;

  [[nodiscard]] float CalculateDamage(
    const MpActor& aggressor, const MpActor& target,
    const SpellCastData& spellCastData) const override;
};
