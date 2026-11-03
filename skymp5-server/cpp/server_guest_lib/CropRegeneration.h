#pragma once
#include "WorldState.h"
float CropRegeneration(float newAttributeValue, float secondsAfterLastRegen,
                       float attributeRate, float attributeRateMult,
                       float oldAttributeValue, bool hasActiveMagicEffects,
                       float extraPercentage = 0.f);

float CropHealthRegeneration(float newAttributeValue,
                             float secondsAfterLastRegen, MpActor* actor);

float CropMagickaRegeneration(float newAttributeValue,
                              float secondsAfterLastRegen, MpActor* actor);

float CropStaminaRegeneration(float newAttributeValue,
                              float secondsAfterLastRegen, MpActor* actor);

// The share of the magicka bar a second the server's own numbers allow, before
// magickaRegenSlack
float MagickaRegenPerSecond(MpActor* actor);

// Clients report vitals about every second, so longer gaps are capped
float CropPeriodAfterLastRegen(float secondsAfterLastRegen,
                               float maxValidPeriod = 5.0f);

float CropValue(float value, float min = 0.f, float max = 1.0f);
