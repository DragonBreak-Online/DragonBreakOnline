#include "libespm/EXPL.h"
#include "libespm/RecordHeaderAccess.h"
#include <cstring>

namespace espm {

EXPL::Data EXPL::GetData(
  CompressedFieldsCache& compressedFieldsCache) const noexcept
{
  Data result;
  RecordHeaderAccess::IterateFields(
    this,
    [&](const char* type, uint32_t size, const char* data) {
      if (!std::memcmp(type, "EITM", 4) && size >= 4) {
        result.enchantment = *reinterpret_cast<const uint32_t*>(data);
      }
    },
    compressedFieldsCache);

  return result;
}

}
