#include "TriggerPrimitive.h"
#include <catch2/catch_all.hpp>

using TriggerPrimitive::IsInside;
using TriggerPrimitive::kBox;
using TriggerPrimitive::kSphere;

namespace {
// A 200 x 40 x 100 plate, long along its own X
const NiPoint3 kCenter(1000.f, -2000.f, 50.f);
const NiPoint3 kHalf(100.f, 20.f, 50.f);

bool InPlate(float x, float y, float z, NiPoint3 angle)
{
  return IsInside(NiPoint3(x, y, z), kCenter, angle, kHalf, kBox);
}
}

TEST_CASE("TriggerPrimitive: an unrotated box keeps X along world X",
          "[primitive]")
{
  const NiPoint3 none(0.f, 0.f, 0.f);
  REQUIRE(InPlate(1000.f, -2000.f, 50.f, none));
  REQUIRE(InPlate(1099.f, -1981.f, 1.f, none));
  REQUIRE(InPlate(1100.f, -2020.f, 100.f, none));
  REQUIRE_FALSE(InPlate(1101.f, -2000.f, 50.f, none));
  REQUIRE_FALSE(InPlate(1000.f, -1979.f, 50.f, none));
  REQUIRE_FALSE(InPlate(1000.f, -2000.f, 101.f, none));
  REQUIRE_FALSE(InPlate(1000.f, -2000.f, -1.f, none));
}

TEST_CASE("TriggerPrimitive: Z angle turns the box clockwise seen from above",
          "[primitive]")
{
  // At 90 degrees local +Y faces east and the long X side runs north-south
  const NiPoint3 east(0.f, 0.f, 90.f);
  REQUIRE(InPlate(1000.f, -2090.f, 50.f, east));
  REQUIRE(InPlate(1000.f, -1910.f, 50.f, east));
  REQUIRE(InPlate(1019.f, -2000.f, 50.f, east));
  REQUIRE_FALSE(InPlate(1090.f, -2000.f, 50.f, east));
  REQUIRE_FALSE(InPlate(1021.f, -2000.f, 50.f, east));

  // At 30 degrees the long side runs along (cos 30, -sin 30)
  const NiPoint3 thirty(0.f, 0.f, 30.f);
  REQUIRE(InPlate(1000.f + 90.f * 0.8660254f, -2000.f - 90.f * 0.5f, 50.f,
                  thirty));
  REQUIRE_FALSE(InPlate(1000.f + 90.f * 0.8660254f,
                        -2000.f + 90.f * 0.5f, 50.f, thirty));
  // Local +Y is the heading (sin 30, cos 30)
  REQUIRE(InPlate(1000.f + 19.f * 0.5f, -2000.f + 19.f * 0.8660254f, 50.f,
                  thirty));
  REQUIRE_FALSE(InPlate(1000.f + 25.f * 0.5f, -2000.f + 25.f * 0.8660254f,
                        50.f, thirty));
}

TEST_CASE("TriggerPrimitive: X angle pitches the box nose down", "[primitive]")
{
  // A 10 x 100 x 10 rod along local Y, pitched 90 degrees, stands along -Z
  const NiPoint3 half(5.f, 100.f, 5.f);
  const NiPoint3 pitch(90.f, 0.f, 0.f);
  const NiPoint3 c(0.f, 0.f, 0.f);
  REQUIRE(IsInside(NiPoint3(0.f, 0.f, -90.f), c, pitch, half, kBox));
  REQUIRE(IsInside(NiPoint3(0.f, 0.f, 90.f), c, pitch, half, kBox));
  REQUIRE_FALSE(IsInside(NiPoint3(0.f, 90.f, 0.f), c, pitch, half, kBox));

  // Y angle rolls it: a rod along local X stands along Z
  const NiPoint3 wide(100.f, 5.f, 5.f);
  const NiPoint3 roll(0.f, 90.f, 0.f);
  REQUIRE(IsInside(NiPoint3(0.f, 0.f, 90.f), c, roll, wide, kBox));
  REQUIRE_FALSE(IsInside(NiPoint3(90.f, 0.f, 0.f), c, roll, wide, kBox));
}

TEST_CASE("TriggerPrimitive: a sphere uses x as its radius and ignores angle",
          "[primitive]")
{
  const NiPoint3 r(64.f, 64.f, 64.f);
  const NiPoint3 c(10.f, 20.f, 30.f);
  const NiPoint3 angle(45.f, 10.f, 270.f);
  REQUIRE(IsInside(NiPoint3(10.f, 20.f, 30.f), c, angle, r, kSphere));
  REQUIRE(IsInside(NiPoint3(10.f + 64.f, 20.f, 30.f), c, angle, r, kSphere));
  REQUIRE(IsInside(NiPoint3(40.f, 50.f, 30.f), c, angle, r, kSphere));
  // The box corner (63, 63, 63) is outside the sphere
  REQUIRE_FALSE(
    IsInside(NiPoint3(73.f, 83.f, 93.f), c, angle, r, kSphere));
  REQUIRE(IsInside(NiPoint3(73.f, 83.f, 93.f), c, NiPoint3(0, 0, 0), r,
                   kBox));
}

TEST_CASE("TriggerPrimitive: other shapes are boxes", "[primitive]")
{
  const NiPoint3 c(0.f, 0.f, 0.f);
  const NiPoint3 none(0.f, 0.f, 0.f);
  const NiPoint3 half(50.f, 1.f, 50.f);
  for (uint32_t shape : { 0u, 1u, 3u, 4u }) {
    REQUIRE(IsInside(NiPoint3(49.f, 0.f, -49.f), c, none, half, shape));
    REQUIRE_FALSE(IsInside(NiPoint3(0.f, 2.f, 0.f), c, none, half, shape));
  }
}
