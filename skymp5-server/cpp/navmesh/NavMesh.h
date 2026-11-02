#pragma once
#include <array>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <vector>

class dtNavMesh;
class dtNavMeshQuery;

namespace navmesh {

// Skyrim units, Z up
struct Vec3
{
  float x = 0.f, y = 0.f, z = 0.f;
};

// A cell's navmeshes (NVNM records) as triangles, the input of BuildTile
struct TileInput
{
  int cellX = 0;
  int cellY = 0;
  int layer = 0;
  float tileSize = 4096.f;
  // An interior cell is one tile bounded by its own vertices, for a NavWorld made with interior true
  bool interior = false;
  std::vector<Vec3> vertices;
  std::vector<std::array<uint32_t, 3>> triangles;
  // Per triangle, Detour poly flags; empty means 1 for every triangle
  std::vector<uint16_t> flags;
};

// Adds one navmesh to a cell's input, its vertex indices rebased
void AppendMesh(TileInput& input, const std::vector<Vec3>& vertices,
                const std::vector<std::array<uint32_t, 3>>& triangles,
                const std::vector<uint16_t>& flags = {});

// Builds a Detour tile: vertices at one spot are welded, so meshes sharing an edge connect, and edges on the cell
// border become portals to the neighbour tile
bool BuildTile(const TileInput& input, std::vector<uint8_t>& out,
               std::string* error = nullptr);

// The standard Detour "MSET" file (RecastDemo's format), from built tiles
std::vector<uint8_t> WriteTileSet(const std::vector<std::vector<uint8_t>>& tiles,
                                  float tileSize = 4096.f, int maxTiles = 512,
                                  int maxPolys = 8192);

class NavWorld
{
public:
  // maxTiles is how many tiles may be loaded at once; tileBits + polyBits must stay within 22
  explicit NavWorld(float tileSize = 4096.f, int maxTiles = 512,
                    int maxPolys = 8192, bool interior = false);
  ~NavWorld();
  NavWorld(const NavWorld&) = delete;
  NavWorld& operator=(const NavWorld&) = delete;

  bool IsValid() const;
  bool AddTile(const std::vector<uint8_t>& data, std::string* error = nullptr);
  bool RemoveTile(int cellX, int cellY, int layer = 0);
  bool LoadTileSet(const std::vector<uint8_t>& mset,
                   std::string* error = nullptr);
  int TileCount() const;

  std::optional<Vec3> NearestWalkable(const Vec3& point,
                                      const Vec3& extents = { 256.f, 256.f,
                                                              512.f });

  // Corner points from start to end; partial is set when the end could not be reached and the path stops short
  bool FindPath(const Vec3& from, const Vec3& to, std::vector<Vec3>& out,
                bool* partial = nullptr,
                const Vec3& extents = { 256.f, 256.f, 512.f });

private:
  dtNavMeshQuery* Query();

  float tileSize;
  bool interior;
  dtNavMesh* mesh = nullptr;
  dtNavMeshQuery* lazyQuery = nullptr;
};

}
