#pragma once
#include "RecordHeader.h"

#pragma pack(push, 1)

namespace espm {

// A projectile; a rune carries its explosion here rather than on the effect
class PROJ final : public RecordHeader
{
public:
  static constexpr auto kType = "PROJ";

  struct Data
  {
    // Raw (file-local) EXPL id
    uint32_t explosion = 0;
  };

  Data GetData(CompressedFieldsCache& compressedFieldsCache) const noexcept;
};

static_assert(sizeof(PROJ) == sizeof(RecordHeader));

}

#pragma pack(pop)
