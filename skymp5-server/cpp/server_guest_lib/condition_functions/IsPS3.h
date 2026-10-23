#pragma once
#include "ConditionFunction.h"

namespace ConditionFunctions {
// Inline so no new source file needs a CMake reconfigure
class IsPS3 : public ConditionFunction
{
public:
  const char* GetName() const override { return "IsPS3"; }

  uint16_t GetFunctionIndex() const override { return 520; }

  // The player's game runs on the PC, so 0 as there (BSAssets.esm holds unreleased recipes off with IsPS3 == 1)
  float Execute([[maybe_unused]] MpActor& actor,
                [[maybe_unused]] uint32_t parameter1,
                [[maybe_unused]] uint32_t parameter2,
                const ConditionEvaluatorContext&) override
  {
    return 0.f;
  }
};
}
