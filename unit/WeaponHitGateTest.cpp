#include "WeaponHitGate.h"
#include <catch2/catch_all.hpp>

using WeaponHitGate::Verdict;

namespace {
constexpr double kSword = 0.77; // SwingInterval(1.0)
constexpr uint32_t kA = 0xff000a01, kB = 0xff000a02, kC = 0xff000a03,
                   kD = 0xff000a04, kE = 0xff000a05;

// Sends one hit at `t` seconds and records it the way OnWeaponHit does when it lands
Verdict Hit(WeaponHitGate::Memory& m, uint32_t target, double t)
{
  const Verdict v = m.Judge(target, t, [] { return kSword; });
  if (WeaponHitGate::Lands(v)) {
    m.Record(target, t, v);
  }
  return v;
}
}

TEST_CASE("One swing reaching two targets in the same frame hits both",
          "[WeaponHitGate]")
{
  WeaponHitGate::Memory m;
  REQUIRE(Hit(m, kA, 100.0) == Verdict::Land);
  REQUIRE(WeaponHitGate::Lands(Hit(m, kB, 100.0)));
}

TEST_CASE("One swing whose second target arrives a few frames later hits both",
          "[WeaponHitGate]")
{
  WeaponHitGate::Memory m;
  REQUIRE(Hit(m, kA, 100.0) == Verdict::Land);
  REQUIRE(WeaponHitGate::Lands(Hit(m, kB, 100.15)));
  REQUIRE(WeaponHitGate::Lands(Hit(m, kC, 100.25)));
}

TEST_CASE("The next swing after a multi-target swing is timed from its start",
          "[WeaponHitGate]")
{
  WeaponHitGate::Memory m;
  REQUIRE(Hit(m, kA, 100.0) == Verdict::Land);
  REQUIRE(WeaponHitGate::Lands(Hit(m, kB, 100.09)));
  REQUIRE(Hit(m, kA, 100.0 + kSword + 0.01) == Verdict::Land);
}

TEST_CASE("A swing hits each target once", "[WeaponHitGate]")
{
  WeaponHitGate::Memory m;
  REQUIRE(Hit(m, kA, 100.0) == Verdict::Land);
  REQUIRE(Hit(m, kA, 100.05) == Verdict::Duplicate);
  REQUIRE(WeaponHitGate::Lands(Hit(m, kB, 100.06)));
  REQUIRE_FALSE(WeaponHitGate::Lands(Hit(m, kA, 100.12)));
}

TEST_CASE("A swing reaches at most four targets", "[WeaponHitGate]")
{
  WeaponHitGate::Memory m;
  REQUIRE(Hit(m, kA, 100.0) == Verdict::Land);
  REQUIRE(WeaponHitGate::Lands(Hit(m, kB, 100.01)));
  REQUIRE(WeaponHitGate::Lands(Hit(m, kC, 100.02)));
  REQUIRE(WeaponHitGate::Lands(Hit(m, kD, 100.03)));
  REQUIRE(Hit(m, kE, 100.04) == Verdict::TooManyTargets);
}

TEST_CASE("Hits faster than the weapon swings are refused", "[WeaponHitGate]")
{
  WeaponHitGate::Memory m;
  REQUIRE(Hit(m, kA, 100.0) == Verdict::Land);
  REQUIRE(Hit(m, kA, 100.5) == Verdict::TooFast);
  REQUIRE(Hit(m, kB, 100.5) == Verdict::TooFast);
  REQUIRE(Hit(m, kA, 100.0 + kSword + 0.001) == Verdict::Land);
}

TEST_CASE("Targets in a row cannot chain one swing past the weapon's speed",
          "[WeaponHitGate]")
{
  WeaponHitGate::Memory m;
  REQUIRE(Hit(m, kA, 100.0) == Verdict::Land);
  REQUIRE(WeaponHitGate::Lands(Hit(m, kB, 100.25)));
  REQUIRE(Hit(m, kC, 100.5) == Verdict::TooFast);
  REQUIRE(Hit(m, kD, 100.7) == Verdict::TooFast);
}

TEST_CASE("The splash window is shorter than the fastest vanilla swing",
          "[WeaponHitGate]")
{
  REQUIRE(WeaponHitGate::kSplashTimeWindow <
          WeaponHitGate::SwingInterval(1.3f)); // daggers
}
