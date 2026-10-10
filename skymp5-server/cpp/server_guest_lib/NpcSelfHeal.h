#pragma once
#include <algorithm>
#include <cmath>
#include <cstddef>

// How strongly a hosted NPC's restoration spell heals the NPC itself (ActionListener::OnSpellCast).
// Kept free of engine types so a unit test can drive it. Players' heals and heals on others are never scaled.
namespace NpcSelfHeal {

// The npcSelfHealMult server setting when it is missing or unusable
constexpr float kDefaultMult = 0.35f;

// A configured npcSelfHealMult clamped to 0..1; a non-finite value falls back to the default
inline float SanitizeMult(double value)
{
  if (!std::isfinite(value)) {
    return kDefaultMult;
  }
  return static_cast<float>(std::clamp(value, 0.0, 1.0));
}

// A self heal of an NPC: the caster is hosted (not the sender's own actor) and the restore lands on the caster
inline bool Applies(bool casterIsSendersActor, bool targetIsCaster)
{
  return !casterIsSendersActor && targetIsCaster;
}

// Scales in place the magnitude of each effect isRestore accepts (Health, Magicka, Stamina), returns how many it scaled
template <class Effects, class IsRestoreFn>
size_t ScaleRestores(Effects& effects, float mult, IsRestoreFn&& isRestore)
{
  size_t scaled = 0;
  for (auto& effect : effects) {
    if (isRestore(effect)) {
      effect.magnitude *= mult;
      ++scaled;
    }
  }
  return scaled;
}

}
