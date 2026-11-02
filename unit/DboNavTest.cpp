#include "DboNav.h"
#include <catch2/catch_all.hpp>
#include <cmath>
#include <cstring>
#include <fstream>
#include <iterator>

using namespace navmesh;

namespace {

constexpr float kS = 4096.f;
constexpr uint32_t kFileVersion = 2;
constexpr size_t kDesc = 96;

// A test-side DBONAV v2 writer, so the reader is checked against the layout and not against itself
class Writer
{
public:
  std::vector<uint8_t> bytes;

  void U32(uint32_t v)
  {
    for (int i = 0; i < 4; ++i) {
      bytes.push_back(static_cast<uint8_t>(v >> (8 * i)));
    }
  }
  void U16(uint16_t v)
  {
    bytes.push_back(static_cast<uint8_t>(v));
    bytes.push_back(static_cast<uint8_t>(v >> 8));
  }
  void F32(float f)
  {
    uint32_t u;
    std::memcpy(&u, &f, 4);
    U32(u);
  }
  void Text(const std::string& s, size_t n)
  {
    for (size_t i = 0; i < n; ++i) {
      bytes.push_back(i < s.size() ? static_cast<uint8_t>(s[i]) : 0);
    }
  }
};

struct SynthMesh
{
  std::string desc;
  std::vector<Vec3> verts;
  std::vector<std::array<uint16_t, 8>> tris;
  std::vector<DboNavLink> links;
};

struct SynthTile
{
  int x = 0, y = 0;
  std::string cellDesc;
  std::vector<SynthMesh> meshes;
};

std::vector<uint8_t> Write(const std::string& world,
                           const std::vector<SynthTile>& tiles,
                           int meshCountDelta = 0)
{
  Writer w;
  w.Text("DBONAV", 8);
  w.U32(kFileVersion);
  w.Text(world, kDesc);
  w.U32(static_cast<uint32_t>(tiles.size()));
  uint32_t meshes = 0;
  for (const auto& t : tiles) {
    meshes += static_cast<uint32_t>(t.meshes.size());
  }
  w.U32(meshes + meshCountDelta);
  w.U32(3);
  for (int i = 0; i < 4; ++i) {
    w.U32(0);
  }
  for (const auto& t : tiles) {
    w.U32(static_cast<uint32_t>(t.x));
    w.U32(static_cast<uint32_t>(t.y));
    w.Text(t.cellDesc, kDesc);
    for (int i = 0; i < 6; ++i) {
      w.F32(0.f);
    }
    w.U32(static_cast<uint32_t>(t.meshes.size()));
    for (const auto& m : t.meshes) {
      w.Text(m.desc, kDesc);
      w.U32(static_cast<uint32_t>(m.verts.size()));
      w.U32(static_cast<uint32_t>(m.tris.size()));
      w.U32(static_cast<uint32_t>(m.links.size()));
      for (const auto& v : m.verts) {
        w.F32(v.x);
        w.F32(v.y);
        w.F32(v.z);
      }
      for (const auto& tri : m.tris) {
        for (uint16_t u : tri) {
          w.U16(u);
        }
      }
      for (const auto& l : m.links) {
        w.U32(l.type);
        w.U32(l.targetMesh);
        w.U16(l.targetTri);
        w.U16(0);
      }
    }
  }
  return w.bytes;
}

// A whole-cell square as one mesh; westOff moves the west edge's vertices off the cell line
SynthMesh SquareMesh(int cx, int cy, const std::string& desc, float westOff = 0.f,
                     uint16_t flags0 = 0x0800, uint16_t flags1 = 0x0800)
{
  const float x0 = cx * kS, y0 = cy * kS;
  SynthMesh m;
  m.desc = desc;
  m.verts = { { x0 + westOff, y0, 0 },
              { x0 + kS, y0, 0 },
              { x0 + kS, y0 + kS, 0 },
              { x0 + westOff, y0 + kS, 0 } };
  m.tris = { { 0, 1, 2, 0xffff, 0xffff, 1, flags0, 0x43c0 },
             { 0, 2, 3, 0, 0xffff, 0xffff, flags1, 0x4000 } };
  return m;
}

SynthTile Tile(int x, int y, std::vector<SynthMesh> meshes)
{
  SynthTile t;
  t.x = x;
  t.y = y;
  t.meshes = std::move(meshes);
  return t;
}

}

TEST_CASE("DboNav: a file reads back with its tiles, meshes, flags and links",
          "[DboNav]")
{
  auto east = SquareMesh(1, 0, "test.esp:000002", 0.f, 0x0c00);
  east.links = { { 0, 0, 1 } };
  const auto bytes = Write("test.esp:00003c",
                           { Tile(0, 0, { SquareMesh(0, 0, "test.esp:000001") }),
                             Tile(1, 0, { east }) });
  DboNavFile file;
  std::string error;
  INFO(error);
  REQUIRE(ReadDboNav(bytes.data(), bytes.size(), file, &error));
  REQUIRE(file.worldspace == "test.esp:00003c");
  REQUIRE(file.meshCount == 2);
  REQUIRE(file.dropped == 3);
  REQUIRE(file.tiles.size() == 2);
  REQUIRE(file.tiles[1].cellX == 1);
  REQUIRE(file.tiles[1].meshes[0].desc == "test.esp:000002");
  REQUIRE(file.tiles[1].meshes[0].triangles[0][6] == 0x0c00);
  REQUIRE(file.tiles[1].meshes[0].triangles[1][7] == 0x4000);
  REQUIRE(file.tiles[1].meshes[0].links.size() == 1);
  REQUIRE(file.tiles[1].meshes[0].links[0].targetTri == 1);

  // Bit 10 is the door flag and nothing else is read from the flag word
  const auto in = ToTileInput(file.tiles[1], false);
  REQUIRE(in.flags == std::vector<uint16_t>{ kPolyWalk | kPolyDoor, kPolyWalk });
  REQUIRE(in.triangles.size() == 2);
}

TEST_CASE("DboNav: tiles from a file make a world a path crosses", "[DboNav]")
{
  // The east cell's west edge sits 6 units off the line, as the worst measured border vertex does
  const auto bytes = Write(
    "test.esp:00003c",
    { Tile(0, 0, { SquareMesh(0, 0, "a") }),
      Tile(1, 0, { SquareMesh(1, 0, "b", 6.f) }),
      Tile(0, 1, { SquareMesh(0, 1, "c"), [] {
                    // A second, separate mesh in the cell: an island, not joined
                    SynthMesh m;
                    m.desc = "d";
                    m.verts = { { 100, kS + 100, 900 }, { 300, kS + 100, 900 }, { 300, kS + 300, 900 } };
                    m.tris = { { 0, 1, 2, 0xffff, 0xffff, 0xffff, 0x0800, 0 } };
                    return m;
                  }() }) });
  DboNavFile file;
  REQUIRE(ReadDboNav(bytes.data(), bytes.size(), file));
  NavWorld world;
  for (const auto& t : file.tiles) {
    std::vector<uint8_t> built;
    std::string error;
    INFO(error);
    REQUIRE(BuildTile(ToTileInput(t, false), built, &error));
    REQUIRE(world.AddTile(built, &error));
  }
  std::vector<Vec3> path;
  bool partial = true;
  REQUIRE(world.FindPath({ 100, 100, 0 }, { kS + 2000, 300, 0 }, path, &partial));
  REQUIRE_FALSE(partial);
  REQUIRE(world.FindPath({ 100, 100, 0 }, { 2000, kS + 3000, 0 }, path, &partial));
  REQUIRE_FALSE(partial);
  // The island floats above with no edge to the floor: reaching it is partial
  REQUIRE(world.FindPath({ 100, 100, 0 }, { 250, kS + 150, 900 }, path, &partial,
                         { 64, 64, 64 }));
  REQUIRE(partial);
}

namespace {

// W3's fixtures (unit/navmesh_fixtures, synthetic), written by its Python writer; the numbers are its manifest's
bool ReadFixture(const std::string& name, DboNavFile& file, std::string* error)
{
  std::ifstream f(std::string(NAVMESH_FIXTURE_DIR) + "/" + name, std::ios::binary);
  REQUIRE(f);
  std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(f)), {});
  return ReadDboNav(bytes.data(), bytes.size(), file, error);
}

}

TEST_CASE("DboNav: W3's fixtures read as its manifest says", "[DboNav]")
{
  DboNavFile f;
  std::string error;
  INFO(error);

  REQUIRE(ReadFixture("one-tile.dbonav", f, &error));
  REQUIRE(f.worldspace == "test.esm:00003c");
  REQUIRE((f.tiles.size() == 1 && f.meshCount == 1 && f.dropped == 0));
  REQUIRE((f.tiles[0].cellX == 13 && f.tiles[0].cellY == 49 && f.tiles[0].cellDesc.empty()));
  REQUIRE((f.tiles[0].bmin.z == 10.f && f.tiles[0].bmax.x == 100.f && f.tiles[0].bmax.y == 100.f));
  REQUIRE(f.tiles[0].meshes[0].desc == "test.esm:000001");
  REQUIRE((f.tiles[0].meshes[0].vertices.size() == 4 && f.tiles[0].meshes[0].triangles.size() == 2));

  REQUIRE(ReadFixture("multi-mesh-tile.dbonav", f, &error));
  REQUIRE((f.tiles[0].cellX == -7 && f.tiles[0].cellY == 3 && f.tiles[0].meshes.size() == 3));
  REQUIRE((f.tiles[0].bmin.x == -500.f && f.tiles[0].bmin.z == -32.5f && f.tiles[0].bmax.z == 64.f));
  // No two meshes share a vertex, so the weld joins nothing: walking from one mesh to another is partial
  auto in = ToTileInput(f.tiles[0], true);
  std::vector<uint8_t> built;
  REQUIRE(BuildTile(in, built, &error));
  NavWorld islands(4096.f, 4, 8192, true);
  REQUIRE(islands.AddTile(built, &error));
  const auto centre = [](const DboNavMesh& m) {
    const auto& t = m.triangles[0];
    Vec3 c;
    for (int k = 0; k < 3; ++k) {
      c.x += m.vertices[t[k]].x / 3;
      c.y += m.vertices[t[k]].y / 3;
      c.z += m.vertices[t[k]].z / 3;
    }
    return c;
  };
  std::vector<Vec3> path;
  bool partial = false;
  REQUIRE(islands.FindPath(centre(f.tiles[0].meshes[0]), centre(f.tiles[0].meshes[1]),
                           path, &partial, { 8, 8, 8 }));
  REQUIRE(partial);

  REQUIRE(ReadFixture("interior.dbonav", f, &error));
  REQUIRE(f.worldspace == "interiors");
  REQUIRE((f.tiles[0].cellX == 0 && f.tiles[0].cellY == 0 && f.tiles[0].cellDesc == "test.esm:000025"));
  REQUIRE((f.tiles[0].bmin.x == 1.f && f.tiles[0].bmax.y == 52.f));

  REQUIRE(ReadFixture("doors.dbonav", f, &error));
  in = ToTileInput(f.tiles[0], false);
  REQUIRE(in.flags == std::vector<uint16_t>{ kPolyWalk, kPolyWalk | kPolyDoor });

  REQUIRE(ReadFixture("linked-pair.dbonav", f, &error));
  REQUIRE((f.tiles.size() == 2 && f.meshCount == 2 && f.dropped == 3));
  const auto& l0 = f.tiles[0].meshes[0].links;
  const auto& l1 = f.tiles[1].meshes[0].links;
  REQUIRE((l0.size() == 1 && l0[0].type == 1 && l0[0].targetMesh == 1 && l0[0].targetTri == 0));
  REQUIRE((l1.size() == 1 && l1[0].type == 1 && l1[0].targetMesh == 0 && l1[0].targetTri == 1));
  REQUIRE(f.tiles[1].meshes[0].desc == "test.esm:000041");

  REQUIRE(ReadFixture("empty-mesh.dbonav", f, &error));
  REQUIRE((f.tiles[0].meshes[0].vertices.empty() && f.tiles[0].meshes[0].triangles.empty()));
  REQUIRE(f.tiles[0].meshes[0].desc == "test.esm:000050");
  // An empty cell builds nothing, with a reason, and does not crash
  REQUIRE_FALSE(BuildTile(ToTileInput(f.tiles[0], false), built, &error));

  REQUIRE(ReadFixture("extreme-cells.dbonav", f, &error));
  REQUIRE((f.tiles[0].cellX == -48 && f.tiles[0].cellY == -34));
  REQUIRE((f.tiles[1].cellX == 52 && f.tiles[1].cellY == 45));

  for (const char* bad : { "bad-magic.dbonav", "bad-version.dbonav", "truncated.dbonav",
                           "trailing-bytes.dbonav", "vertex-out-of-range.dbonav" }) {
    INFO(bad);
    error.clear();
    REQUIRE_FALSE(ReadFixture(bad, f, &error));
    REQUIRE_FALSE(error.empty());
  }
}

TEST_CASE("DboNav: a damaged file is refused with a reason", "[DboNav]")
{
  DboNavFile file;
  std::string error;
  const auto good = Write("w", { Tile(0, 0, { SquareMesh(0, 0, "a") }) });
  REQUIRE(ReadDboNav(good.data(), good.size(), file, &error));

  auto magic = good;
  magic[0] = 'X';
  REQUIRE_FALSE(ReadDboNav(magic.data(), magic.size(), file, &error));
  REQUIRE(error.find("not a DBONAV") != std::string::npos);

  auto version = good;
  version[8] = static_cast<uint8_t>(kFileVersion + 1);
  REQUIRE_FALSE(ReadDboNav(version.data(), version.size(), file, &error));
  REQUIRE(error.find("version") != std::string::npos);

  for (size_t cut : { size_t(10), size_t(100), good.size() - 1 }) {
    REQUIRE_FALSE(ReadDboNav(good.data(), cut, file, &error));
  }

  auto extra = good;
  extra.push_back(0);
  REQUIRE_FALSE(ReadDboNav(extra.data(), extra.size(), file, &error));
  REQUIRE(error.find("after") != std::string::npos);

  const auto count = Write("w", { Tile(0, 0, { SquareMesh(0, 0, "a") }) }, 1);
  REQUIRE_FALSE(ReadDboNav(count.data(), count.size(), file, &error));
  REQUIRE(error.find("mesh count") != std::string::npos);

  auto badLink = SquareMesh(0, 0, "a");
  badLink.links = { { 0, 5, 0 } };
  const auto link = Write("w", { Tile(0, 0, { badLink }) });
  REQUIRE_FALSE(ReadDboNav(link.data(), link.size(), file, &error));
  REQUIRE(error.find("missing mesh") != std::string::npos);

  auto badVert = SquareMesh(0, 0, "a");
  badVert.tris[0][2] = 9;
  const auto vert = Write("w", { Tile(0, 0, { badVert }) });
  REQUIRE_FALSE(ReadDboNav(vert.data(), vert.size(), file, &error));
  REQUIRE(error.find("missing vertex") != std::string::npos);

  // A huge count in a short file is refused before anything is allocated for it
  auto huge = good;
  const size_t tilesAt = 8 + 4 + kDesc;
  huge[tilesAt + 3] = 0x7f;
  REQUIRE_FALSE(ReadDboNav(huge.data(), huge.size(), file, &error));
}
