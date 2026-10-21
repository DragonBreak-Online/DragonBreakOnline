#pragma once
#include "ConditionFunction.h"
#include "MpActor.h"
#include "WorldState.h"
#include "libespm/Loader.h"
#include <exception>

namespace ConditionFunctions {
// Inline so no new source file needs a CMake reconfigure
class GetInCurrentLoc : public ConditionFunction
{
public:
  const char* GetName() const override { return "GetInCurrentLoc"; }

  uint16_t GetFunctionIndex() const override { return 359; }

  // parameter1 is the LCTN's global form id; 1 when the actor's location is it or lies inside it
  float Execute(MpActor& actor, uint32_t parameter1,
                [[maybe_unused]] uint32_t parameter2,
                const ConditionEvaluatorContext&) override
  {
    WorldState* worldState = actor.GetParent();
    if (!worldState || !parameter1 || !worldState->HasEspm()) {
      return 0.f;
    }
    try {
      auto& browser = worldState->GetEspm().GetBrowser();
      auto& cache = worldState->GetEspmCache();

      // Only an interior cell names its location (XLCN): in a worldspace the answer stays 0
      const auto cellLookup = browser.LookupById(
        actor.GetCellOrWorld().ToFormId(worldState->espmFiles));
      const auto* cell = espm::Convert<espm::CELL>(cellLookup.rec);
      if (!cell) {
        return 0.f;
      }
      const uint32_t rawLocation = cell->GetData(cache).locationId;
      uint32_t location = rawLocation ? cellLookup.ToGlobalId(rawLocation) : 0;

      // A chain is a few levels deep (shop, district, city, hold, Tamriel); the cap ends a looped one
      for (int depth = 0; location && depth < 16; ++depth) {
        if (location == parameter1) {
          return 1.f;
        }
        const auto lookup = browser.LookupById(location);
        const auto* lctn = espm::Convert<espm::LCTN>(lookup.rec);
        if (!lctn) {
          break;
        }
        const uint32_t rawParent = lctn->GetData(cache).parentLocationId;
        location = rawParent ? lookup.ToGlobalId(rawParent) : 0;
      }
    } catch (const std::exception&) {
      return 0.f;
    }
    return 0.f;
  }
};
}
