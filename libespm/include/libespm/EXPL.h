#pragma once
#include "RecordHeader.h"

#pragma pack(push, 1)

namespace espm {

// An explosion; its enchantment applies to what it hits (Ash Rune's paralysis)
class EXPL final : public RecordHeader
{
public:
  static constexpr auto kType = "EXPL";

  struct Data
  {
    // Raw (file-local) ENCH or SPEL id
    uint32_t enchantment = 0;
  };

  Data GetData(CompressedFieldsCache& compressedFieldsCache) const noexcept;
};

static_assert(sizeof(EXPL) == sizeof(RecordHeader));

}

#pragma pack(pop)
