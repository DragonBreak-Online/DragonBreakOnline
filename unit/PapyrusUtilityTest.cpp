#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>

#include "script_classes/PapyrusUtility.h"
#include "script_compatibility_policies/HeuristicPolicy.h"

TEST_CASE("Wait", "[Papyrus][Utility]")
{
  WorldState wst;
  PapyrusUtility utility;
  std::shared_ptr<spdlog::logger> logger;
  utility.compatibilityPolicy.reset(new HeuristicPolicy(&wst));

  bool waitFinished = false;

  utility.Wait(VarValue::None(), { VarValue(0.03f) }).Then([&](VarValue) {
    waitFinished = true;
  });
  REQUIRE(!waitFinished);

  wst.Tick();
  REQUIRE(!waitFinished);

  std::this_thread::sleep_for(std::chrono::milliseconds(50));
  wst.Tick();
  REQUIRE(waitFinished);
}

TEST_CASE("RandomInt", "[Papyrus][Utility]")
{
  WorldState wst;
  PapyrusUtility utility;
  int32_t low = 253, high = 666;
  auto res = static_cast<int32_t>(
    utility.RandomInt(VarValue::None(), { VarValue(low), VarValue(high) }));
  bool good = low <= res && res <= high;
  REQUIRE(good);
}

// A reversed range used to recurse inside std::uniform_int_distribution
// until the stack was gone: that is how the live server died at
// 2026-11-10 01:55:12Z. Without the guard in PapyrusUtility::RandomInt
// this case does not fail an assertion, it takes this whole binary down
// with SIGSEGV about 105,000 frames deep - undefined behaviour cannot be
// observed politely, so returning at all is the proof.
TEST_CASE("RandomInt with the range the wrong way round",
          "[Papyrus][Utility]")
{
  WorldState wst;
  PapyrusUtility utility;
  const int32_t low = 253, high = 666;
  auto res = static_cast<int32_t>(utility.RandomInt(
    VarValue::None(), { VarValue(high), VarValue(low) }));
  REQUIRE(low <= res);
  REQUIRE(res <= high);
}

// min == max is the boundary either side of the swap: it must answer that
// one number and not be treated as a reversed range
TEST_CASE("RandomInt with one number", "[Papyrus][Utility]")
{
  WorldState wst;
  PapyrusUtility utility;
  auto res = static_cast<int32_t>(utility.RandomInt(
    VarValue::None(), { VarValue(7), VarValue(7) }));
  REQUIRE(res == 7);
}

// Too few arguments read past the end of the vector before the guard
TEST_CASE("RandomInt with too few arguments", "[Papyrus][Utility]")
{
  WorldState wst;
  PapyrusUtility utility;
  REQUIRE(static_cast<int32_t>(
            utility.RandomInt(VarValue::None(), {})) == 0);
  REQUIRE(static_cast<int32_t>(utility.RandomInt(
            VarValue::None(), { VarValue(5) })) == 0);
}

// RandomFloat carried the same two faults and is fixed the same way
TEST_CASE("RandomFloat with the range the wrong way round",
          "[Papyrus][Utility]")
{
  WorldState wst;
  PapyrusUtility utility;
  auto res = static_cast<double>(utility.RandomFloat(
    VarValue::None(), { VarValue(9.5f), VarValue(1.5f) }));
  REQUIRE(res >= 1.5);
  REQUIRE(res <= 9.5);
}

TEST_CASE("RandomFloat with too few arguments", "[Papyrus][Utility]")
{
  WorldState wst;
  PapyrusUtility utility;
  REQUIRE(static_cast<double>(
            utility.RandomFloat(VarValue::None(), {})) == 0.0);
}
