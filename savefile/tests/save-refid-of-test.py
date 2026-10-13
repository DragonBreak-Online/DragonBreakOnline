# Compiles SaveRefIdOf from LoadGameApi.cpp against a stub RE::TESForm and checks how the login save names forms:
# Skyrim.esm ids directly, plugin forms by FormIDArray index (reused or appended), missing/wrong-typed/light forms left out.
#   python3 savefile/tests/save-refid-of-test.py   (from the fork root, needs g++)
import os, re, subprocess, sys, tempfile
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
src = open(os.path.join(root, 'skyrim-platform/src/platform_se/skyrim_platform/LoadGameApi.cpp')).read()
m = re.search(r'template <class T>\nstd::optional<SaveFile_::RefID> SaveRefIdOf\(.*?\n}\n', src, re.S)
if not m: sys.exit('FAIL SaveRefIdOf is gone from LoadGameApi.cpp')
tu = r'''
#include "savefile/SFStructure.h"
#include <cstdio>
#include <map>
#include <optional>
namespace RE {
struct BGSHeadPart {}; struct TESRace {}; struct BGSTextureSet {};
std::map<uint32_t, int> g_forms; // id -> 1 head part, 2 race, 3 texture set
template <class T> constexpr int kindOf() { return std::is_same_v<T, BGSHeadPart> ? 1 : std::is_same_v<T, TESRace> ? 2 : 3; }
struct TESForm { template <class T> static T* LookupByID(uint32_t id) { static T t; auto it = g_forms.find(id); return it != g_forms.end() && it->second == kindOf<T>() ? &t : nullptr; } };
}
''' + m.group(0) + r'''
static int fails = 0;
static void check(bool ok, const char* what) { std::printf("%s %s\n", ok ? "ok  " : "FAIL", what); if (!ok) ++fails; }
static uint32_t raw(const SaveFile_::RefID& r) { return (uint32_t(r.byte0) << 16) | (uint32_t(r.byte1) << 8) | r.byte2; }
int main() {
  RE::g_forms = { { 0x000e9f6f, 1 }, { 0x14001234, 1 }, { 0x0a0bcdef, 1 }, { 0x00013746, 2 }, { 0x09001000, 2 }, { 0x14000800, 3 }, { 0xfe001001, 1 } };
  SaveFile_::SaveFile save;
  save.formIDArray = { 0x02000800, 0x0a0bcdef, 0x03000001 };
  save.formIDArrayCount = 3;
  auto a = SaveRefIdOf<RE::BGSHeadPart>(save, 0x000e9f6f);
  check(a && raw(*a) == (0x400000 | 0x0e9f6f), "a Skyrim.esm head part is a Default RefID (type 1)");
  auto b = SaveRefIdOf<RE::BGSHeadPart>(save, 0x0a0bcdef);
  check(b && raw(*b) == 2 && save.formIDArray.size() == 3, "a plugin head part already in the array reuses its 1-based index");
  auto c = SaveRefIdOf<RE::BGSHeadPart>(save, 0x14001234);
  check(c && raw(*c) == 4 && save.formIDArray.back() == 0x14001234 && save.formIDArrayCount == 4, "a new plugin head part is appended and indexed");
  check(!c || (c->byte0 >> 6) == 0, "...as an array index (type 0), never a Created 0xFF form (type 2)");
  auto r = SaveRefIdOf<RE::TESRace>(save, 0x09001000);
  check(r && raw(*r) == 5, "a plugin race is indexed the same way");
  check(!SaveRefIdOf<RE::BGSHeadPart>(save, 0x09001000), "a form of another type is left out");
  check(!SaveRefIdOf<RE::BGSHeadPart>(save, 0x14009999), "a form the game does not have is left out");
  check(!SaveRefIdOf<RE::BGSHeadPart>(save, 0xfe001001), "a light-plugin form is left out");
  auto t = SaveRefIdOf<RE::BGSTextureSet>(save, 0x14000800);
  check(t && raw(*t) == 6 && save.formIDArrayCount == 6, "a plugin head texture set is indexed");
  std::printf("%s\n", fails ? "failed" : "all passed");
  return fails ? 1 : 0;
}
'''
d = tempfile.mkdtemp(prefix='claude-nate-refid-')
open(os.path.join(d, 't.cpp'), 'w').write(tu)
exe = os.path.join(d, 't')
subprocess.run(['g++', '-std=c++17', '-Wall', '-I' + os.path.join(root, 'savefile/include'), os.path.join(root, 'savefile/src/SFStructure.cpp'), os.path.join(d, 't.cpp'), '-o', exe], check=True)
sys.exit(subprocess.run([exe]).returncode)
