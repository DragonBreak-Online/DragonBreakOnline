#include "NavMesh.h"
#include <catch2/catch_all.hpp>
#include <cmath>

using namespace navmesh;

namespace {

constexpr float kS = 4096.f;

float Dist2D(const Vec3& a, const Vec3& b)
{
  return std::hypot(a.x - b.x, a.y - b.y);
}

// A flat square covering the whole cell at height z, two triangles
TileInput Square(int cx, int cy, float z = 0.f, bool reversed = false)
{
  TileInput t;
  t.cellX = cx;
  t.cellY = cy;
  const float x0 = cx * kS, y0 = cy * kS;
  t.vertices = { { x0, y0, z },
                 { x0 + kS, y0, z },
                 { x0 + kS, y0 + kS, z },
                 { x0, y0 + kS, z } };
  t.triangles = reversed
    ? std::vector<std::array<uint32_t, 3>>{ { 0, 2, 1 }, { 0, 3, 2 } }
    : std::vector<std::array<uint32_t, 3>>{ { 0, 1, 2 }, { 0, 2, 3 } };
  return t;
}

// An L corridor in cell 0,0: a strip along the south edge and one up the east edge, 512 wide
TileInput Corridor(bool reversed)
{
  TileInput t;
  t.vertices = { { 0, 0, 0 },       { kS, 0, 0 },         { kS, kS, 0 },
                 { kS - 512, kS, 0 }, { kS - 512, 512, 0 }, { 0, 512, 0 } };
  t.triangles = { { 0, 1, 4 }, { 0, 4, 5 }, { 1, 2, 3 }, { 1, 3, 4 } };
  if (reversed) {
    for (auto& tri : t.triangles) {
      std::swap(tri[1], tri[2]);
    }
  }
  return t;
}

std::vector<uint8_t> Built(const TileInput& t)
{
  std::vector<uint8_t> out;
  std::string error;
  INFO(error);
  REQUIRE(BuildTile(t, out, &error));
  return out;
}

}

TEST_CASE("NavMesh: a point above the floor finds the floor", "[NavMesh]")
{
  NavWorld world;
  REQUIRE(world.IsValid());
  REQUIRE(world.AddTile(Built(Square(0, 0, 100.f))));
  auto p = world.NearestWalkable({ 1000.f, 2000.f, 300.f });
  REQUIRE(p);
  REQUIRE(std::fabs(p->x - 1000.f) < 1.f);
  REQUIRE(std::fabs(p->y - 2000.f) < 1.f);
  REQUIRE(std::fabs(p->z - 100.f) < 1.f);
  REQUIRE_FALSE(world.NearestWalkable({ 1000.f, 2000.f, 5000.f }));
  REQUIRE_FALSE(world.NearestWalkable({ -9000.f, 2000.f, 100.f }));
}

TEST_CASE("NavMesh: an open floor gives a straight path", "[NavMesh]")
{
  NavWorld world;
  REQUIRE(world.AddTile(Built(Square(0, 0))));
  std::vector<Vec3> path;
  bool partial = true;
  REQUIRE(world.FindPath({ 100, 100, 0 }, { 3000, 3500, 0 }, path, &partial));
  REQUIRE_FALSE(partial);
  REQUIRE(path.size() == 2);
  REQUIRE(Dist2D(path.front(), { 100, 100, 0 }) < 1.f);
  REQUIRE(Dist2D(path.back(), { 3000, 3500, 0 }) < 1.f);
}

TEST_CASE("NavMesh: a corridor's path turns at the inner corner, in either winding",
          "[NavMesh]")
{
  for (bool reversed : { false, true }) {
    INFO("reversed " << reversed);
    NavWorld world;
    REQUIRE(world.AddTile(Built(Corridor(reversed))));
    std::vector<Vec3> path;
    bool partial = true;
    REQUIRE(world.FindPath({ 200, 250, 0 }, { 3840, 3800, 0 }, path, &partial));
    REQUIRE_FALSE(partial);
    REQUIRE(path.size() == 3);
    REQUIRE(Dist2D(path[1], { kS - 512, 512, 0 }) < 2.f);
    REQUIRE(Dist2D(path.back(), { 3840, 3800, 0 }) < 1.f);
  }
}

TEST_CASE("NavMesh: a path crosses into the next cell through its portal",
          "[NavMesh]")
{
  NavWorld world;
  REQUIRE(world.AddTile(Built(Square(0, 0))));
  std::vector<Vec3> path;
  bool partial = false;

  // With only one cell loaded the goal is off the mesh
  REQUIRE_FALSE(world.FindPath({ 100, 100, 0 }, { kS + 2000, 100, 0 }, path));

  // The east neighbour, built in the other winding, and the north one
  REQUIRE(world.AddTile(Built(Square(1, 0, 0.f, true))));
  REQUIRE(world.AddTile(Built(Square(0, 1))));
  REQUIRE(world.TileCount() == 3);
  REQUIRE(world.FindPath({ 100, 100, 0 }, { kS + 2000, 200, 0 }, path, &partial));
  REQUIRE_FALSE(partial);
  REQUIRE(Dist2D(path.back(), { kS + 2000, 200, 0 }) < 1.f);
  REQUIRE(world.FindPath({ 100, 100, 0 }, { 300, kS + 3000, 0 }, path, &partial));
  REQUIRE_FALSE(partial);
  REQUIRE(Dist2D(path.back(), { 300, kS + 3000, 0 }) < 1.f);

  // Removing the east cell cuts the link again
  REQUIRE(world.RemoveTile(1, 0));
  REQUIRE(world.TileCount() == 2);
  REQUIRE_FALSE(world.FindPath({ 100, 100, 0 }, { kS + 2000, 200, 0 }, path));

  // A neighbour whose edge vertices sit a little off the cell line still joins: they are snapped onto it
  auto loose = Square(1, 0);
  loose.vertices[0].x += 0.3f;
  loose.vertices[3].x += 0.4f;
  REQUIRE(world.AddTile(Built(loose)));
  REQUIRE(world.FindPath({ 100, 100, 0 }, { kS + 2000, 200, 0 }, path, &partial));
  REQUIRE_FALSE(partial);
}

TEST_CASE("NavMesh: an island out of reach gives a partial path", "[NavMesh]")
{
  TileInput t;
  t.vertices = { { 0, 0, 0 },       { 1000, 0, 0 },    { 1000, 1000, 0 },
                 { 0, 1000, 0 },    { 3000, 3000, 0 }, { 4000, 3000, 0 },
                 { 4000, 4000, 0 } };
  t.triangles = { { 0, 1, 2 }, { 0, 2, 3 }, { 4, 5, 6 } };
  NavWorld world;
  REQUIRE(world.AddTile(Built(t)));
  std::vector<Vec3> path;
  bool partial = false;
  REQUIRE(world.FindPath({ 100, 100, 0 }, { 3800, 3200, 0 }, path, &partial));
  REQUIRE(partial);
  REQUIRE(path.back().x <= 1000.5f);
  REQUIRE(path.back().y <= 1000.5f);
}

TEST_CASE("NavMesh: two navmeshes in one cell take two layers", "[NavMesh]")
{
  NavWorld world;
  auto upper = Square(0, 0, 500.f);
  upper.layer = 1;
  REQUIRE(world.AddTile(Built(Square(0, 0))));
  REQUIRE(world.AddTile(Built(upper)));
  std::string error;
  REQUIRE_FALSE(world.AddTile(Built(upper), &error));
  REQUIRE(error.find("already") != std::string::npos);
  auto p = world.NearestWalkable({ 2000, 2000, 450 });
  REQUIRE(p);
  REQUIRE(std::fabs(p->z - 500.f) < 1.f);
}

TEST_CASE("NavMesh: a cell's navmeshes that share an edge are one walkable floor",
          "[NavMesh]")
{
  // Two navmesh records split the cell at x 2048, each with its own copy of the shared vertices
  TileInput t;
  AppendMesh(t, { { 0, 0, 0 }, { 2048, 0, 0 }, { 2048, kS, 0 }, { 0, kS, 0 } },
             { { 0, 1, 2 }, { 0, 2, 3 } });
  AppendMesh(t,
             { { 2048, 0, 0.2f }, { kS, 0, 0 }, { kS, kS, 0 }, { 2048, kS, 0.2f } },
             { { 0, 1, 2 }, { 0, 2, 3 } }, { 1, 1 });
  REQUIRE(t.triangles.size() == 4);
  REQUIRE(t.triangles[2][0] == 4);
  REQUIRE(t.flags.size() == 4);
  NavWorld world;
  REQUIRE(world.AddTile(Built(t)));
  std::vector<Vec3> path;
  bool partial = true;
  REQUIRE(world.FindPath({ 100, 100, 0 }, { 4000, 4000, 0 }, path, &partial));
  REQUIRE_FALSE(partial);
  REQUIRE(Dist2D(path.back(), { 4000, 4000, 0 }) < 1.f);
}

TEST_CASE("NavMesh: an interior is one tile wherever its coordinates lie",
          "[NavMesh]")
{
  TileInput t;
  t.interior = true;
  t.cellX = 7;
  t.cellY = -3;
  t.vertices = { { -20000, -9000, -500 },
                 { 30000, -9000, -500 },
                 { 30000, 25000, -500 },
                 { -20000, 25000, -500 } };
  t.triangles = { { 0, 1, 2 }, { 0, 2, 3 } };
  NavWorld world(4096.f, 4, 8192, true);
  REQUIRE(world.AddTile(Built(t)));
  std::vector<Vec3> path;
  bool partial = true;
  REQUIRE(world.FindPath({ -19000, -8000, -500 }, { 29000, 24000, -500 }, path,
                         &partial));
  REQUIRE_FALSE(partial);
  REQUIRE(Dist2D(path.back(), { 29000, 24000, -500 }) < 2.f);
  auto p = world.NearestWalkable({ 0, 0, -400 });
  REQUIRE(p);
  REQUIRE(std::fabs(p->z + 500.f) < 1.f);
  REQUIRE(world.RemoveTile(0, 0));
  REQUIRE(world.TileCount() == 0);
}

TEST_CASE("NavMesh: an MSET tile set loads back", "[NavMesh]")
{
  const auto set = WriteTileSet({ Built(Square(0, 0)), Built(Square(1, 0)) });
  NavWorld world;
  std::string error;
  REQUIRE(world.LoadTileSet(set, &error));
  REQUIRE(world.TileCount() == 2);
  std::vector<Vec3> path;
  REQUIRE(world.FindPath({ 100, 100, 0 }, { kS + 100, 100, 0 }, path));

  auto truncated = set;
  truncated.resize(truncated.size() - 10);
  NavWorld other;
  REQUIRE_FALSE(other.LoadTileSet(truncated, &error));
  REQUIRE_FALSE(other.LoadTileSet({ 1, 2, 3 }, &error));
}

TEST_CASE("NavMesh: bad input is refused with a reason", "[NavMesh]")
{
  std::vector<uint8_t> out;
  std::string error;

  auto outside = Square(0, 0);
  outside.vertices[2].x = kS + 50.f;
  REQUIRE_FALSE(BuildTile(outside, out, &error));
  REQUIRE(error.find("outside") != std::string::npos);

  auto missing = Square(0, 0);
  missing.triangles[1][2] = 9;
  REQUIRE_FALSE(BuildTile(missing, out, &error));
  REQUIRE(error.find("missing") != std::string::npos);

  auto flags = Square(0, 0);
  flags.flags = { 1 };
  REQUIRE_FALSE(BuildTile(flags, out, &error));

  NavWorld world;
  REQUIRE_FALSE(world.AddTile({ 1, 2, 3 }, &error));
}
