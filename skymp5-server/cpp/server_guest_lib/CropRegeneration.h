#pragma once
#include "WorldState.h"
// Headroom on the magicka ceiling for boosts the client applies natively and the server does not model (perks, worn
// enchantments): live clients regenerated 1.3 to 3 times the server's rate (31 Oct). A 0 rate mult stays a freeze
constexpr float kMagickaRegenSlack = 3.f;

float CropRegeneration(float newAttributeValue, float secondsAfterLastRegen,
                       float attributeRate, float attributeRateMult,
                       float oldAttributeValue, bool hasActiveMagicEffects);

float CropHealthRegeneration(float newAttributeValue,
                             float secondsAfterLastRegen, MpActor* actor);

float CropMagickaRegeneration(float newAttributeValue,
                              float secondsAfterLastRegen, MpActor* actor);

float CropStaminaRegeneration(float newAttributeValue,
                              float secondsAfterLastRegen, MpActor* actor);

// Clients report vitals about every second, so longer gaps are capped
float CropPeriodAfterLastRegen(float secondsAfterLastRegen,
                               float maxValidPeriod = 5.0f);

float CropValue(float value, float min = 0.f, float max = 1.0f);
