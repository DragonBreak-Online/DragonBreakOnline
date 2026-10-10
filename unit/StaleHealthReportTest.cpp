#include "StaleHealthReport.h"
#include <catch2/catch_all.hpp>

using namespace std::chrono_literals;
using StaleHealthReport::Clock;

namespace {
// A boar's power bite on a 209-health character: the engine takes 93.4, the gamemode gives 75.6 back (x0.19)
constexpr float kBefore = 1.f, kRawAfter = 0.553f, kScaledAfter = 0.909f;
const Clock::time_point kT0 = Clock::time_point{} + 1000s;
}

TEST_CASE("A report written between the hit and its give-back does not take the give-back away",
          "[StaleHealthReport]")
{
  StaleHealthReport::Memory m;
  m.Note(kRawAfter, kScaledAfter, kT0);
  REQUIRE(m.IsStale(kRawAfter, kScaledAfter, kT0 + 150ms));
  REQUIRE(m.IsStale(kRawAfter + 0.004f, kScaledAfter, kT0 + 900ms));
}

TEST_CASE("Two bites in a row: a report predating either give-back is stale",
          "[StaleHealthReport]")
{
  StaleHealthReport::Memory m;
  m.Note(kRawAfter, kScaledAfter, kT0);
  m.Note(0.462f, 0.818f, kT0 + 400ms);
  REQUIRE(m.IsStale(kRawAfter, 0.818f, kT0 + 500ms));
  REQUIRE(m.IsStale(0.462f, 0.818f, kT0 + 500ms));
}

TEST_CASE("The client's own damage still counts", "[StaleHealthReport]")
{
  StaleHealthReport::Memory m;
  m.Note(kRawAfter, kScaledAfter, kT0);
  // a fall well below where the give-back started
  REQUIRE_FALSE(m.IsStale(0.3f, kScaledAfter, kT0 + 200ms));
  // a small decrease from the given-back value
  REQUIRE_FALSE(m.IsStale(0.88f, kScaledAfter, kT0 + 200ms));
}

TEST_CASE("Only for a moment after the raise", "[StaleHealthReport]")
{
  StaleHealthReport::Memory m;
  m.Note(kRawAfter, kScaledAfter, kT0);
  REQUIRE_FALSE(m.IsStale(kRawAfter, kScaledAfter, kT0 + 1600ms));
  REQUIRE_FALSE(m.IsStale(kRawAfter, kScaledAfter, kT0 - 10ms));
}

TEST_CASE("Never without a raise, never for a report at or above the server's value",
          "[StaleHealthReport]")
{
  StaleHealthReport::Memory m;
  REQUIRE_FALSE(m.IsStale(kRawAfter, kScaledAfter, kT0));
  m.Note(kScaledAfter, kRawAfter, kT0); // a decrease is not a raise
  REQUIRE_FALSE(m.IsStale(kScaledAfter, kBefore, kT0 + 100ms));
  m.Note(kRawAfter, kScaledAfter, kT0);
  REQUIRE_FALSE(m.IsStale(kScaledAfter, kScaledAfter, kT0 + 100ms));
  REQUIRE_FALSE(m.IsStale(kBefore, kScaledAfter, kT0 + 100ms));
}

TEST_CASE("A small raise (a regen tick or a racial gift) is not remembered, so damage over time during it counts",
          "[StaleHealthReport]")
{
  StaleHealthReport::Memory m;
  // an Argonian's gift payment of about 1.2% of the bar, then a poison tick of 1% reported 300 ms later
  m.Note(0.300f, 0.312f, kT0);
  REQUIRE_FALSE(m.IsStale(0.302f, 0.312f, kT0 + 300ms));
  // a blessing tick of 3%: still below the 4% a give-back must exceed
  m.Note(0.500f, 0.530f, kT0);
  REQUIRE_FALSE(m.IsStale(0.505f, 0.530f, kT0 + 300ms));
}

TEST_CASE("A stale report must sit nearer the raise's start than its end", "[StaleHealthReport]")
{
  StaleHealthReport::Memory m;
  m.Note(0.40f, 0.45f, kT0); // a 5% give-back
  REQUIRE(m.IsStale(0.41f, 0.45f, kT0 + 200ms));        // near where it started: written before the give-back
  REQUIRE_FALSE(m.IsStale(0.43f, 0.45f, kT0 + 200ms));  // nearer where it ended: the client's own small damage after it
}
