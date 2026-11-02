#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>

#include "GetBaseActorValues.h"

PartOne& GetPartOne();

// private.dboAvBonus raises the maximum hits and restores are measured
// against, up to 10000 a vital (an event boss's pool, gameplay bossvitals.js)
TEST_CASE("private.dboAvBonus raises the maximum up to 10000 a vital",
          "[LevelBonus]")
{
  PartOne& p = GetPartOne();
  DoConnect(p, 0);
  p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  p.SetUserActor(0, 0xff000000);
  auto& ac = p.worldState.GetFormAt<MpActor>(0xff000000);

  const BaseActorValues base = ac.GetBaseValues();
  REQUIRE(ac.GetMaximumValues().health == base.health);

  ac.SetPropertyValueDump("private.dboAvBonus",
                          R"({"health":9000,"magicka":25,"stamina":0})", false,
                          false);
  REQUIRE(ac.GetMaximumValues().health == base.health + 9000.f);
  REQUIRE(ac.GetMaximumValues().magicka == base.magicka + 25.f);
  REQUIRE(ac.GetMaximumValues().stamina == base.stamina);

  ac.SetPropertyValueDump("private.dboAvBonus",
                          R"({"health":50000,"magicka":-30})", false, false);
  REQUIRE(ac.GetMaximumValues().health == base.health + 10000.f);
  REQUIRE(ac.GetMaximumValues().magicka == base.magicka);

  p.DestroyActor(0xff000000);
  DoDisconnect(p, 0);
}
