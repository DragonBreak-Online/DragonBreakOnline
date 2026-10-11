#include "libespm/PROJ.h"
#include "libespm/RecordHeaderAccess.h"
#include <cstring>

namespace espm {

PROJ::Data PROJ::GetData(
  CompressedFieldsCache& compressedFieldsCache) const noexcept
{
  Data result;
  RecordHeaderAccess::IterateFields(
    this,
    [&](const char* type, uint32_t size, const char* data) {
      if (!std::memcmp(type, "DATA", 4) && size >= 0x28) {
        result.explosion = *reinterpret_cast<const uint32_t*>(data + 0x24);
      }
    },
    compressedFieldsCache);

  return result;
}

}
