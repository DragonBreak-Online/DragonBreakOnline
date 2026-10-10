#include "NpcSelfHeal.h"
#include <catch2/catch_all.hpp>
#include <cmath>
#include <limits>
#include <vector>

namespace {
struct Effect
{
  int av = 0; // 0 Health, 1 Magicka, 2 Stamina, 3 a regen rate boost
  float magnitude = 0.f;
};

bool Near(float a, float b)
{
  return std::abs(a - b) < 1e-4f;
}

bool IsRestore(const Effect& e)
{
  return e.av <= 2;
}

// What OnSpellCast does to a cast's restorative effects
std::vector<Effect> Cast(std::vector<Effect> effects,
                         bool casterIsSendersActor, bool targetIsCaster,
                         float mult)
{
  if (NpcSelfHeal::Applies(casterIsSendersActor, targetIsCaster)) {
    NpcSelfHeal::ScaleRestores(effects, mult, IsRestore);
  }
  return effects;
}
}

TEST_CASE("A hosted NPC's self heal is scaled by the setting", "[NpcSelfHeal]")
{
  // Grand Healing: 200 Health on the caster
  const auto out = Cast({ { 0, 200.f } }, false, true, 0.35f);
  REQUIRE(Near(out[0].magnitude, 70.f));
}

TEST_CASE("A player's own heal is untouched", "[NpcSelfHeal]")
{
  REQUIRE(Cast({ { 0, 200.f } }, true, true, 0.35f)[0].magnitude == 200.f);
}

TEST_CASE("An NPC heal on someone else is untouched", "[NpcSelfHeal]")
{
  REQUIRE(Cast({ { 0, 200.f } }, false, false, 0.35f)[0].magnitude == 200.f);
}

TEST_CASE("A player's heal on someone else is untouched", "[NpcSelfHeal]")
{
  REQUIRE(Cast({ { 0, 200.f } }, true, false, 0.35f)[0].magnitude == 200.f);
}

TEST_CASE("Only restore effects are scaled, rate boosts keep their size",
          "[NpcSelfHeal]")
{
  std::vector<Effect> effects{ { 0, 100.f }, { 2, 50.f }, { 3, 40.f } };
  REQUIRE(NpcSelfHeal::ScaleRestores(effects, 0.5f, IsRestore) == 2);
  REQUIRE(Near(effects[0].magnitude, 50.f));
  REQUIRE(Near(effects[1].magnitude, 25.f));
  REQUIRE(effects[2].magnitude == 40.f);
}

TEST_CASE("The setting is clamped to 0..1 and falls back on bad values",
          "[NpcSelfHeal]")
{
  REQUIRE(Near(NpcSelfHeal::SanitizeMult(0.35), 0.35f));
  REQUIRE(NpcSelfHeal::SanitizeMult(0.0) == 0.f);
  REQUIRE(NpcSelfHeal::SanitizeMult(1.0) == 1.f);
  REQUIRE(NpcSelfHeal::SanitizeMult(-2.0) == 0.f);
  REQUIRE(NpcSelfHeal::SanitizeMult(5.0) == 1.f);
  REQUIRE(
    NpcSelfHeal::SanitizeMult(std::numeric_limits<double>::quiet_NaN()) ==
    NpcSelfHeal::kDefaultMult);
  REQUIRE(NpcSelfHeal::SanitizeMult(std::numeric_limits<double>::infinity()) ==
          NpcSelfHeal::kDefaultMult);
}

TEST_CASE("A setting of 0 stops NPC self heals, 1 keeps them as before",
          "[NpcSelfHeal]")
{
  REQUIRE(Cast({ { 0, 200.f } }, false, true, 0.f)[0].magnitude == 0.f);
  REQUIRE(Cast({ { 0, 200.f } }, false, true, 1.f)[0].magnitude == 200.f);
}
