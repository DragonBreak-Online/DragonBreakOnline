#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>

#include "papyrus-vm/VirtualMachine.h"
#include "script_classes/PapyrusSound.h"

TEST_CASE("Sound instance natives are registered stubs", "[Papyrus][Sound]")
{
  VirtualMachine vm(std::vector<std::shared_ptr<PexScript>>{});
  PapyrusSound sound;
  sound.Register(vm, nullptr);

  auto statics = vm.ListStaticFunctions("Sound");
  REQUIRE(statics.count("StopInstance") == 1);
  REQUIRE(statics.count("SetInstanceVolume") == 1);

  std::vector<VarValue> args = { VarValue(1), VarValue(0.5f) };
  REQUIRE(vm.CallStatic("Sound", "SetInstanceVolume", args) ==
          VarValue::None());
}
