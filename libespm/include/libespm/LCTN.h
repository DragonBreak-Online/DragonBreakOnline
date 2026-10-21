#pragma once
#include "RecordHeader.h"
#include "RecordHeaderAccess.h"
#include <cstring>

#pragma pack(push, 1)

namespace espm {

// Location; only its parent is read, for GetInCurrentLoc
class LCTN final : public RecordHeader
{
public:
  static constexpr auto kType = "LCTN";

  struct Data
  {
    // Parent location (LCTN), file local: convert with LookupResult::ToGlobalId
    formId parentLocationId = 0;
  };

  // Inline so no new source file needs a CMake reconfigure
  Data GetData(CompressedFieldsCache& compressedFieldsCache) const noexcept
  {
    Data result;
    RecordHeaderAccess::IterateFields(
      this,
      [&](const char* type, uint32_t size, const char* data) {
        if (!std::memcmp(type, "PNAM", 4) && size >= 4) {
          std::memcpy(&result.parentLocationId, data, sizeof(formId));
        }
      },
      compressedFieldsCache);
    return result;
  }
};

static_assert(sizeof(LCTN) == sizeof(RecordHeader));

}

#pragma pack(pop)
