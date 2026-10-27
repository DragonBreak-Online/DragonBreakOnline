#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>
#include <chrono>
#include <limits>

#include "CropRegeneration.h"
#include "GetBaseActorValues.h"
#include "libespm/Loader.h"

PartOne& GetPartOne();
extern espm::Loader l;

TEST_CASE("CropRegeneration function is working correctly",
          "[CropRegeneration]")
{
  float secondsAfterLastRegen = 1.0f;
  float attributeRate = 0.7f;
  float attributeRateMult = 100.0f;
  float oldAttributeValue = 0.6f;

  float validAttributeValueRegeneration = attributeRate / 100.0f *
    attributeRateMult / 100.0f * secondsAfterLastRegen;

  float newAttributeValue =
    oldAttributeValue + validAttributeValueRegeneration;

  REQUIRE(CropRegeneration(newAttributeValue, 1.0f, 0.7f, 100.0f, 0.6f,
                           false) == newAttributeValue);
}

TEST_CASE(
  "CropRegeneration returns oldAttributeValue if regeneration is not positive",
  "[CropRegeneration]")
{
  float oldAttributeValue = 0.6f;

  float newAttributeValue = oldAttributeValue + 0.007f;

  REQUIRE(CropRegeneration(newAttributeValue, 1.0f, 0.7f, -100.0f,
                           oldAttributeValue, false) == oldAttributeValue);
}

TEST_CASE(
  "CropRegeneration returns 1 if regeneration is enough to restore attribute",
  "[CropRegeneration]")
{
  REQUIRE(CropRegeneration(1.0f, 1.0f, 5.0f, 100.0f, 0.97f, false) == 1.0f);
}

TEST_CASE("CropRegeneration returns 1 if newAttributeValue is more then 1 "
          "when oldAttributeValue = 1",
          "[CropRegeneration]")
{
  REQUIRE(CropRegeneration(1.05f, 1.0f, 5.0f, 100.0f, 1.0f, false) == 1.0f);
}

TEST_CASE("CropRegeneration returns the correct value if newAttributeValue is "
          "too large but oldAttributeValue is equal to zero",
          "[CropRegeneration]")
{
  REQUIRE(CropRegeneration(1.0f, 1.0f, 5.0f, 100.0f, 0.0f, false) == 0.05f);
}

TEST_CASE("CropPeriodAfterLastRegen returns 0 if period < 0",
          "[CropRegeneration]")
{
  REQUIRE(CropPeriodAfterLastRegen(-1.0f) == 0.0f);
}

TEST_CASE("CropPeriodAfterLastRegen returns 0 if period is NaN",
          "[CropRegeneration]")
{
  REQUIRE(CropPeriodAfterLastRegen(std::numeric_limits<float>::quiet_NaN()) ==
          0.0f);
}

TEST_CASE(
  "CropPeriodAfterLastRegen caps the period at maxValidPeriod if it is longer",
  "[CropRegeneration]")
{
  float maxValidPeriod = 5.0f;
  REQUIRE(CropPeriodAfterLastRegen(7.5f, maxValidPeriod) == 5.0f);
  REQUIRE(CropPeriodAfterLastRegen(60.0f) == 5.0f);
}

TEST_CASE("CropPeriodAfterLastRegen keeps a report gap just over two seconds",
          "[CropRegeneration]")
{
  REQUIRE(CropPeriodAfterLastRegen(2.1f) == 2.1f);
}

TEST_CASE("CropPeriodAfterLastRegen returns correct value if period is in "
          "0...maxValidPeriod interval",
          "[CropRegeneration]")
{
  float maxValidPeriod = 5.0f;
  REQUIRE(CropPeriodAfterLastRegen(1.3f, maxValidPeriod) == 1.3f);
}

TEST_CASE("CropHealthRegeneration, CropMagickaRegeneration and "
          "CropStaminaRegeneration are working correctly, regeneration is not "
          "too fast",
          "[CropRegeneration]")
{

  using namespace std::chrono_literals;

  PartOne& p = GetPartOne();
  DoConnect(p, 0);
  p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  p.SetUserActor(0, 0xff000000);
  auto& ac = p.worldState.GetFormAt<MpActor>(0xff000000);

  uint32_t baseId = ac.GetBaseId();
  auto appearance = ac.GetAppearance();
  uint32_t raceId = appearance ? appearance->raceId : 0;
  BaseActorValues baseValues =
    GetBaseActorValues(&p.worldState, baseId, raceId, {});

  ac.SetPercentages({ 0.0f, 0.0f, 0.0f });

  auto past = std::chrono::steady_clock::now();
  auto now = past + 1s;
  ac.SetLastAttributesPercentagesUpdate(past);
  std::chrono::duration<float> timeDuration = now - past;
  float time = timeDuration.count();

  float expectedHealth =
    baseValues.healRate * baseValues.healRateMult * time / 10000.0f;
  float expectedMagicka =
    baseValues.magickaRate * baseValues.magickaRateMult * time / 10000.0f;
  float expectedStamina =
    baseValues.staminaRate * baseValues.staminaRateMult * time / 10000.0f;

  REQUIRE_THAT(CropHealthRegeneration(1.0f, time, &ac),
               Catch::Matchers::WithinAbs(expectedHealth, 0.000001f));
  REQUIRE_THAT(CropMagickaRegeneration(1.0f, time, &ac),
               Catch::Matchers::WithinAbs(expectedMagicka, 0.000001f));
  REQUIRE_THAT(CropStaminaRegeneration(1.0f, time, &ac),
               Catch::Matchers::WithinAbs(expectedStamina, 0.000001f));

  p.DestroyActor(0xff000000);
  DoDisconnect(p, 0);
}

// Nat, 27 Oct: hunger and cold must really slow regeneration. The ceiling used to take
// std::max(base, current), so anything below the race's base was ignored and both the needs system's hunger
// and the chill system's StaminaRateMult 0 did nothing at all. The assertion that catches a regression here
// is "slowed < atBase" - under std::max those two are equal.
TEST_CASE("The regeneration ceiling follows the actor's rate mult in both directions",
          "[CropRegeneration]")
{
  PartOne& p = GetPartOne();
  DoConnect(p, 0);
  p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  p.SetUserActor(0, 0xff000000);
  auto& ac = p.worldState.GetFormAt<MpActor>(0xff000000);

  ActorValues half;
  half.healthPercentage = .5f;
  half.magickaPercentage = .5f;
  half.staminaPercentage = .5f;
  ac.SetPercentages(half);

  auto appearance = ac.GetAppearance();
  const BaseActorValues base = GetBaseActorValues(
    &p.worldState, ac.GetBaseId(), appearance ? appearance->raceId : 0, {});

  // Without a positive base there is nothing to be above or below, and every case below collapses together.
  REQUIRE(base.staminaRateMult > 0.f);

  const float kOld = .5f;
  auto ceilingWith = [&](float mult) {
    ac.SetActorValue(espm::ActorValue::StaminaRateMult, mult);
    return CropStaminaRegeneration(1.0f, 1.0f, &ac); // the client claims a full bar
  };

  const float atBase = ceilingWith(base.staminaRateMult);
  const float slowed = ceilingWith(base.staminaRateMult * .25f); // hungry
  const float frozen = ceilingWith(0.f);                         // chilled to a standstill
  const float hastened = ceilingWith(base.staminaRateMult * 4.f); // blessed

  REQUIRE(atBase > kOld);       // a plain actor still regenerates
  REQUIRE(slowed < atBase);     // hunger bites. Equal to atBase under the old std::max
  REQUIRE(slowed > kOld);       // but is a slowdown, not a stop
  REQUIRE(frozen == kOld);      // a chill freeze means exactly no regeneration
  REQUIRE(hastened > atBase);   // and a blessing still helps

  p.DestroyActor(0xff000000);
  DoDisconnect(p, 0);
}

// The guard Nat asked for: a value nothing has written must read as the race's base, never as a freeze.
// Zero is deliberately NOT treated as unset - zero is the chill.
TEST_CASE("An unusable rate mult falls back to the race's base, not to zero",
          "[CropRegeneration]")
{
  PartOne& p = GetPartOne();
  DoConnect(p, 0);
  p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  p.SetUserActor(0, 0xff000000);
  auto& ac = p.worldState.GetFormAt<MpActor>(0xff000000);

  ActorValues half;
  half.healthPercentage = .5f;
  half.magickaPercentage = .5f;
  half.staminaPercentage = .5f;
  ac.SetPercentages(half);

  auto appearance = ac.GetAppearance();
  const BaseActorValues base = GetBaseActorValues(
    &p.worldState, ac.GetBaseId(), appearance ? appearance->raceId : 0, {});
  REQUIRE(base.staminaRateMult > 0.f);

  ac.SetActorValue(espm::ActorValue::StaminaRateMult, base.staminaRateMult);
  const float atBase = CropStaminaRegeneration(1.0f, 1.0f, &ac);

  ac.SetActorValue(espm::ActorValue::StaminaRateMult, -1.f);
  REQUIRE(CropStaminaRegeneration(1.0f, 1.0f, &ac) == atBase);

  ac.SetActorValue(espm::ActorValue::StaminaRateMult,
                   std::numeric_limits<float>::quiet_NaN());
  REQUIRE(CropStaminaRegeneration(1.0f, 1.0f, &ac) == atBase);

  p.DestroyActor(0xff000000);
  DoDisconnect(p, 0);
}
