// The first load of an interior cell (WorldState::GetNeighborsByPosition, 33x33 squares) under a load order of many files.
// The chunk-load loop is taken verbatim from the tree's WorldState.cpp (interior_load_cost.sh extracts it) and runs on that
// tree's libespm, so the same test measures the code before and after a change. It checks the loaded references are
// exactly the generated ones within reach, and that the load fits a budget: on 22 Oct the live load order (143 files)
// spent about 0.37 s a cell, and the housing place plan touches over 100 interiors on its first tick.
#include "libespm/Loader.h"
#include "libespm/Utils.h"
#include <algorithm>
#include <cassert>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>

namespace fs = std::filesystem;

namespace {

constexpr uint32_t kCell = 0x00000D62;
constexpr int16_t kInteriorChunkReach = 16;

struct Bytes
{
  std::vector<char> v;
  void Raw(const void* p, size_t n) { v.insert(v.end(), (const char*)p, (const char*)p + n); }
  void U32(uint32_t x) { Raw(&x, 4); }
  void U16(uint16_t x) { Raw(&x, 2); }
  void Tag(const char* t) { Raw(t, 4); }
  void Field(const char* t, const void* p, uint16_t n) { Tag(t); U16(n); Raw(p, n); }
};

// A record: type, data size, flags, id, revision, version, unknown, then its fields
Bytes Record(const char* type, uint32_t flags, uint32_t id, const Bytes& fields)
{
  Bytes b;
  b.Tag(type); b.U32((uint32_t)fields.v.size()); b.U32(flags); b.U32(id); b.U32(0); b.U16(44); b.U16(0);
  b.Raw(fields.v.data(), fields.v.size());
  return b;
}

// A group: "GRUP", size with its 24 byte header, label, type, stamp and unknown
Bytes Group(uint32_t label, uint32_t type, const Bytes& content)
{
  Bytes b;
  b.Tag("GRUP"); b.U32((uint32_t)content.v.size() + 24); b.U32(label); b.U32(type); b.U32(0); b.U32(0);
  b.Raw(content.v.data(), content.v.size());
  return b;
}

Bytes Tes4(bool master, const char* masterName)
{
  Bytes f;
  struct { float version; int32_t numRecords; uint32_t nextId; } hedr{ 1.7f, 0, 0x800 };
  f.Field("HEDR", &hedr, sizeof(hedr));
  if (masterName) {
    f.Field("MAST", masterName, (uint16_t)(std::strlen(masterName) + 1));
    uint64_t data = 0;
    f.Field("DATA", &data, 8);
  }
  return Record("TES4", master ? 1 : 0, 0, f);
}

Bytes Refr(uint32_t id, float x, float y)
{
  Bytes f;
  uint32_t base = 0x00000007;
  f.Field("NAME", &base, 4);
  float data[6] = { x, y, 0, 0, 0, 0 };
  f.Field("DATA", data, sizeof(data));
  return Record("REFR", 0, id, f);
}

// The cell (an interior: DATA flag 1) with its temporary references, under the CELL top group's block and sub-block
Bytes CellWithRefs(const std::vector<Bytes>& refs)
{
  Bytes cf;
  cf.Field("EDID", "TestRoom", 9);
  uint16_t cellFlags = 1;
  cf.Field("DATA", &cellFlags, 2);
  Bytes temp;
  for (auto& r : refs) temp.Raw(r.v.data(), r.v.size());
  Bytes cell = Record("CELL", 0, kCell, cf);
  Bytes children = Group(kCell, 6, Group(kCell, 9, temp));
  cell.Raw(children.v.data(), children.v.size());
  uint32_t top;
  std::memcpy(&top, "CELL", 4);
  return Group(top, 0, Group(0, 2, Group(0, 3, cell)));
}

void Write(const fs::path& p, const std::vector<Bytes>& parts)
{
  std::ofstream f(p, std::ios::binary);
  for (auto& b : parts) f.write(b.v.data(), b.v.size());
}

// The tree's GetNeighborsByPosition chunk loading, around the extracted loop
struct WorldStateLoop
{
  struct GridInfo
  {
    std::map<int16_t, std::map<int16_t, bool>> loadedChunks;
  };
  espm::Loader* espm = nullptr;
  std::vector<std::string> espmFiles;
  std::unordered_map<uint32_t, GridInfo> grids;
  struct
  {
    bool chunkLoadingInProgress = false;
  } impl, *pImpl = &impl;
  std::vector<uint32_t> loaded;

  void LoadForm(uint32_t formId) { loaded.push_back(formId); }

  void Load(uint32_t cellOrWorld, int16_t cellX, int16_t cellY)
  {
    const int16_t chunkReach = kInteriorChunkReach;
#include "chunk-load-loop.inc"
  }
};

}

int main(int argc, char** argv)
{
  if (argc < 3) {
    std::fprintf(stderr, "usage: %s <empty dir for the plugins> <files> [budget ms]\n", argv[0]);
    return 2;
  }
  const fs::path dir = argv[1];
  const int numFiles = std::max(2, std::atoi(argv[2]));
  const double budgetMs = argc > 3 ? std::atof(argv[3]) : 30.0;

  // Base.esm: the cell, references inside the reach (squares -5, 0 and 14) and one beyond it (square 17)
  std::vector<uint32_t> expected;
  std::vector<Bytes> baseRefs;
  const float xs[] = { -20000.f, 100.f, 60000.f, 70000.f };
  for (int k = 0; k < 4; ++k) {
    const uint32_t id = 0x00000D70 + k;
    baseRefs.push_back(Refr(id, xs[k], 500.f));
    if (std::abs((int)(xs[k] / 4096)) <= kInteriorChunkReach) expected.push_back(id);
  }
  std::vector<fs::path> names{ "Base.esm" };
  Write(dir / "Base.esm", { Tes4(true, nullptr), CellWithRefs(baseRefs) });

  // Every tenth plugin adds a reference of its own to the cell; the rest are headers alone, as most patches are here
  for (int i = 1; i < numFiles; ++i) {
    char name[32];
    std::snprintf(name, sizeof(name), "P%03d.esp", i);
    names.push_back(name);
    if (i % 10 == 0) {
      Write(dir / name, { Tes4(false, "Base.esm"), CellWithRefs({ Refr(0x01000800, 4096.f * (i % 30 - 15), 0.f) }) });
      expected.push_back(((uint32_t)i << 24) | 0x800);
    } else {
      Write(dir / name, { Tes4(false, "Base.esm") });
    }
  }

  espm::Loader loader(dir, names);
  WorldStateLoop ws;
  ws.espm = &loader;
  ws.espmFiles = loader.GetFileNames();

  const auto t0 = std::chrono::steady_clock::now();
  ws.Load(kCell, 0, 0);
  const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();

  std::sort(ws.loaded.begin(), ws.loaded.end());
  std::sort(expected.begin(), expected.end());
  const bool sameRefs = ws.loaded == expected;
  const bool inBudget = ms <= budgetMs;
  std::printf("%d files: first interior load %.1f ms (budget %.1f ms), %zu references loaded, %zu expected: %s\n",
              numFiles, ms, budgetMs, ws.loaded.size(), expected.size(),
              sameRefs ? "the same" : "DIFFERENT");
  std::printf("%s\n", sameRefs && inBudget ? "PASS" : "FAIL");
  return sameRefs && inBudget ? 0 : 1;
}
