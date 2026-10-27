#include "CropRegeneration.h"
#include "GetBaseActorValues.h"
#include "MathUtils.h"
#include "MpActor.h"
#include "MpChangeForms.h"
#include "WorldState.h"
#include <cmath>

namespace {

BaseActorValues GetValues(MpActor* actor)
{
  uint32_t baseId = actor->GetBaseId();
  auto appearance = actor->GetAppearance();
  uint32_t raceId = appearance ? appearance->raceId : 0;
  auto worldState = actor->GetParent();
  return GetBaseActorValues(worldState, baseId, raceId,
                            actor->GetTemplateChain());
}

float GetServerRegenMultiplier(MpActor* actor)
{
  auto worldState = actor->GetParent();
  return worldState ? worldState->regenerationMultiplier : 1.f;
}

// The rate mult the ceiling should use.
//
// This was std::max(base, current), which floored the ceiling at the race's base and so made every debuff
// inert: the needs system's hunger, and the chill system writing StaminaRateMult 0 to freeze stamina, both
// changed nothing. Nat asked on 27 Oct for them to really slow regeneration, a freeze to 0 included, so the
// actor's own value wins in both directions.
//
// Base is the answer only when nothing has written a usable value. ApplyChangeForm seeds the change form
// from the race's base whenever espm is loaded, so in a running server there is always one; this guards the
// case where there is not. It deliberately does NOT treat 0 as unset - a 0 is the chill freeze, and reading
// it as "unset" would be the one thing Nat asked for that silently did not work.
float ResolveRateMult(float current, float base)
{
  if (!std::isfinite(current) || current < 0.f) {
    return base;
  }
  return current;
}

}

float CropRegeneration(float newAttributeValue, float secondsAfterLastRegen,
                       float attributeRate, float attributeRateMult,
                       float oldAttributeValue, bool hasActiveMagicEffects)
{
  spdlog::trace(
    "[crop]: args=(newAttributeValue={}, secondsAfterLastRegen={}, "
    "attributerate={}, attributeRateMult={}, oldAttributeValue={}, "
    "hasActiveMagicEffects={})",
    newAttributeValue, secondsAfterLastRegen, attributeRate, attributeRateMult,
    oldAttributeValue, hasActiveMagicEffects);

  float validRegenerationPercentage =
    MathUtils::PercentToFloat(attributeRate) *
    MathUtils::PercentToFloat(attributeRateMult) * secondsAfterLastRegen;

  spdlog::trace("[crop]: validRegenerationPercentage={}",
                validRegenerationPercentage);

  validRegenerationPercentage =
    validRegenerationPercentage < 0.0f ? 0.0f : validRegenerationPercentage;
  float validAttributePercentage =
    oldAttributeValue + validRegenerationPercentage;

  spdlog::trace("[crop]: validAttributePercentage={}",
                validAttributePercentage);

  validAttributePercentage =
    validAttributePercentage > 1.0f ? 1.0f : validAttributePercentage;
  constexpr float kMaxOldPercentage = 1.f;

  spdlog::trace("[crop]: comparing received attribute value and valid one: "
                "newAttributeValue={}, validAttributePercentage={}",
                newAttributeValue, validAttributePercentage);

  if (newAttributeValue > validAttributePercentage) {
    return validAttributePercentage;
  }
  if (newAttributeValue < 0.0f) {
    return 0.0f;
  }
  // if (hasActiveMagicEffects &&
  //    !MathUtils::IsNearlyEqual(oldAttributeValue, kMaxOldPercentage)) {
  //  return validAttributePercentage;
  // }
  return newAttributeValue;
}

float CropHealthRegeneration(float newAttributeValue,
                             float secondsAfterLastRegen, MpActor* actor)
{
  const BaseActorValues baseValues = GetValues(actor);
  const ActorValues& actorValues = actor->GetActorValues();
  const float rate = std::max(baseValues.healRate, actorValues.healRate) *
    GetServerRegenMultiplier(actor);
  const float rateMult =
    ResolveRateMult(actorValues.healRateMult, baseValues.healRateMult);
  const float oldPercentage = actorValues.healthPercentage;
  const bool hasActiveMagicEffects = !actor->GetActiveMagicEffects().Empty();
  return CropRegeneration(newAttributeValue, secondsAfterLastRegen, rate,
                          rateMult, oldPercentage, hasActiveMagicEffects);
}

float CropMagickaRegeneration(float newAttributeValue,
                              float secondsAfterLastRegen, MpActor* actor)
{
  const BaseActorValues baseValues = GetValues(actor);
  const ActorValues& actorValues = actor->GetActorValues();
  const float rate =
    std::max(baseValues.magickaRate, actorValues.magickaRate) *
    GetServerRegenMultiplier(actor);
  const float rateMult =
    ResolveRateMult(actorValues.magickaRateMult, baseValues.magickaRateMult);
  const float oldPercentage = actorValues.magickaPercentage;
  const bool hasActiveMagicEffects = !actor->GetActiveMagicEffects().Empty();
  return CropRegeneration(newAttributeValue, secondsAfterLastRegen, rate,
                          rateMult, oldPercentage, hasActiveMagicEffects);
}

float CropStaminaRegeneration(float newAttributeValue,
                              float secondsAfterLastRegen, MpActor* actor)
{
  const BaseActorValues baseValues = GetValues(actor);
  const ActorValues& actorValues = actor->GetActorValues();
  const float rate = (actor->IsBlockActive()
    ? actorValues.staminaRate
    : std::max(baseValues.staminaRate, actorValues.staminaRate)) *
    GetServerRegenMultiplier(actor);
  const float rateMult =
    ResolveRateMult(actorValues.staminaRateMult, baseValues.staminaRateMult);
  const float oldPercentage = actorValues.staminaPercentage;
  const bool hasActiveMagicEffects = !actor->GetActiveMagicEffects().Empty();
  return CropRegeneration(newAttributeValue, secondsAfterLastRegen, rate,
                          rateMult, oldPercentage, hasActiveMagicEffects);
}

float CropPeriodAfterLastRegen(float secondsAfterLastRegen,
                               float maxValidPeriod)
{
  // Also catches NaN
  if (!(secondsAfterLastRegen > 0.0f)) {
    return 0.0f;
  }
  return std::min(secondsAfterLastRegen, maxValidPeriod);
}

float CropValue(float value, float min, float max)
{
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
