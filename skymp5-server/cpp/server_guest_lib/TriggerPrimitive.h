#pragma once
#include "NiPoint3.h"
#include <cmath>
#include <cstdint>

// Point tests for a reference's XPRM primitive (trigger box or sphere)
namespace TriggerPrimitive {

// XPRM type values
enum Shape : uint32_t
{
  kNone = 0,
  kBox = 1,
  kSphere = 2,
  kPortalBox = 3,
  kPlane = 4
};

// The point in the primitive's own axes; Skyrim turns a ref clockwise about X, then Y, then Z
inline NiPoint3 ToLocal(const NiPoint3& point, const NiPoint3& center,
                        const NiPoint3& angleDegrees)
{
  constexpr float kDegToRad = 3.14159265358979f / 180.f;
  NiPoint3 d = point - center;

  float c = std::cos(angleDegrees.z * kDegToRad);
  float s = std::sin(angleDegrees.z * kDegToRad);
  d = NiPoint3(d.x * c - d.y * s, d.x * s + d.y * c, d.z);

  c = std::cos(angleDegrees.y * kDegToRad);
  s = std::sin(angleDegrees.y * kDegToRad);
  d = NiPoint3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c);

  c = std::cos(angleDegrees.x * kDegToRad);
  s = std::sin(angleDegrees.x * kDegToRad);
  return NiPoint3(d.x, d.y * c - d.z * s, d.y * s + d.z * c);
}

// Every shape but a sphere is a box of half-extents boundsDiv2; a sphere's radius is boundsDiv2.x
inline bool IsInside(const NiPoint3& point, const NiPoint3& center,
                     const NiPoint3& angleDegrees, const NiPoint3& boundsDiv2,
                     uint32_t shape)
{
  if (shape == kSphere) {
    return (point - center).SqrLength() <= boundsDiv2.x * boundsDiv2.x;
  }
  NiPoint3 local = ToLocal(point, center, angleDegrees);
  return std::abs(local.x) <= boundsDiv2.x &&
    std::abs(local.y) <= boundsDiv2.y && std::abs(local.z) <= boundsDiv2.z;
}
}
