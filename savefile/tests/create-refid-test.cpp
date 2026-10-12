// RefID::CreateRefId must keep every existing FormIDArray entry: the login save (LoadGame.cpp) adds the spawn cell to
// template.ess, whose array holds 10562 ids, and a lost entry turns the change forms that use it into garbage form ids.
//   g++ -std=c++17 -Isavefile/include savefile/src/SFStructure.cpp savefile/tests/create-refid-test.cpp -o /tmp/x && /tmp/x
#include "savefile/SFStructure.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>

int main()
{
  int fails = 0;
  auto check = [&](bool ok, const char* what) {
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok) ++fails;
  };

  // Dirty the heap so an uninitialised copy shows up as wrong ids, not zeros
  for (int i = 0; i < 64; ++i) {
    auto* junk = static_cast<uint32_t*>(std::malloc(42252));
    std::memset(junk, 0xAB, 42252);
    std::free(junk);
  }

  SaveFile_::SaveFile save;
  const uint32_t count = 10562;
  for (uint32_t i = 0; i < count; ++i) save.formIDArray.push_back(0x02000000 + i);
  save.formIDArrayCount = count;
  save.fileLocationTable.unknownTable3Offset = 1000;

  auto ref = SaveFile_::RefID::CreateRefId(save, 0x3c);

  bool kept = save.formIDArray.size() == count + 1;
  for (uint32_t i = 0; kept && i < count; ++i) kept = save.formIDArray[i] == 0x02000000 + i;
  check(kept, "every existing FormIDArray entry is kept");
  check(save.formIDArray.back() == 0x3c && save.formIDArrayCount == count + 1, "the new id is appended and counted");
  const uint32_t index = (uint32_t(ref.byte0) << 16) | (uint32_t(ref.byte1) << 8) | ref.byte2;
  check(index == count + 1 && (ref.byte0 >> 6) == 0, "the RefID is a 1-based index into the array");
  check(save.fileLocationTable.unknownTable3Offset == 1004, "the following table moves by 4 bytes");

  std::printf("%s\n", fails ? "failed" : "all passed");
  return fails ? 1 : 0;
}
