#include "libespm/SPEL.h"
#include "libespm/CTDA.h"
#include "libespm/RecordHeaderAccess.h"
#include <cstring>

namespace espm {

SPEL::Data SPEL::GetData(
  CompressedFieldsCache& compressedFieldsCache) const noexcept
{
  Data result;
  RecordHeaderAccess::IterateFields(
    this,
    [&](const char* type, uint32_t dataSize, const char* data) {
      // Short subrecords are skipped rather than read past their end (review
      // SCH1-R5)
      if (!std::memcmp(type, "SPIT", 4) && dataSize >= sizeof(SPITData)) {
        result.spellItem = reinterpret_cast<const SPITData*>(data);
      } else if (!std::memcmp(type, "EFID", 4) &&
                 dataSize >= sizeof(uint32_t)) {
        result.effects.emplace_back(
          Effect{ *reinterpret_cast<const uint32_t*>(data), nullptr });
      } else if (!std::memcmp(type, "EFIT", 4) && !result.effects.empty() &&
                 dataSize >= sizeof(EFIT)) {
        result.effects.back().effectItem = reinterpret_cast<const EFIT*>(data);
      } else if (!std::memcmp(type, "CTDA", 4) && !result.effects.empty()) {
        result.effects.back().NoteCondition(data, dataSize);
      }
    },
    compressedFieldsCache);
  return result;
}

void SPEL::Effect::NoteCondition(const char* data, uint32_t size)
{
  hasConditions = true;
  // CTDA: operator and flags u8 at 0, value f32 at 4, function u16 at 8
  if (size < 12) {
    return;
  }
  const auto ctda = reinterpret_cast<const CTDA*>(data);
  if (static_cast<uint8_t>(ctda->GetFlags()) &
      static_cast<uint8_t>(CTDA::Flags::OR)) {
    orConditions = true;
  }
  constexpr uint16_t kHasPerk = 448;
  if (ctda->functionIndex != kHasPerk) {
    return;
  }
  const float value = ctda->comparisonValue;
  switch (ctda->GetOperator()) {
    case CTDA::Operator::EqualTo:
      requiresPerk = requiresPerk || value == 1.f;
      break;
    case CTDA::Operator::NotEqualTo:
      requiresPerk = requiresPerk || value == 0.f;
      break;
    case CTDA::Operator::GreaterThen:
      requiresPerk = requiresPerk || (value >= 0.f && value < 1.f);
      break;
    case CTDA::Operator::GreaterThenOrEqualTo:
      requiresPerk = requiresPerk || (value > 0.f && value <= 1.f);
      break;
    default:
      break;
  }
}

}
