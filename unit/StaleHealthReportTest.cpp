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
