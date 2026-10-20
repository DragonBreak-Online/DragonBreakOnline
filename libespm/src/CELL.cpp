#include "libespm/CELL.h"
#include "libespm/RecordHeaderAccess.h"

namespace espm {

CELL::Data CELL::GetData(CompressedFieldsCache& cache) const noexcept
{
  Data result;
  RecordHeaderAccess::IterateFields(
    this,
    [&](const char* type, uint32_t size, const char* data) {
      if (!std::memcmp(type, "DATA", 4)) {
        // TODO: support size == 1, docs says it is possible in vanila skyrim
        result.flags = *reinterpret_cast<const uint16_t*>(data);
      } else if (!std::memcmp(type, "XLCN", 4)) {
        result.locationId = *reinterpret_cast<const formId*>(data);
      }
    },
    cache);
  return result;
}

}
