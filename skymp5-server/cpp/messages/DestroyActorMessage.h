#pragma once
#include "MessageBase.h"
#include "MsgType.h"
#include <type_traits>

struct DestroyActorMessage : public MessageBase<DestroyActorMessage>
{
  static constexpr auto kMsgType =
    std::integral_constant<char, static_cast<char>(MsgType::DestroyActor)>{};

  template <class Archive>
  void Serialize(Archive& archive)
  {
    archive.Serialize("t", kMsgType)
      .Serialize("idx", idx)
      .Serialize("formId", formId);
  }

  uint32_t idx = 0;
  // The form this destroy is about. idx alone is unattributable once it reaches the client: on
  // 2026-10-13 a GM was ejected to Skyrim's own main menu by a destroy that resolved to his player
  // slot, and neither end could say which form it named. Additive, so an older client ignores it.
  uint32_t formId = 0;
};
