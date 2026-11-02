#pragma once
#include "NavMesh.h"

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace navmesh {

// Detour poly flags set from a navmesh triangle
constexpr uint16_t kPolyWalk = 0x01;
constexpr uint16_t kPolyDoor = 0x02;

// DBONAV v2 (W3's navmesh extraction, _work/navmesh-1102/FORMAT.md): one file per worldspace, little-endian
struct DboNavLink
{
  uint32_t type = 0;
  // Index into the file's flat mesh table: tiles in order, meshes within each tile in order
  uint32_t targetMesh = 0;
  uint16_t targetTri = 0;
};

struct DboNavMesh
{
  std::string desc;
  std::vector<Vec3> vertices;
  // Verbatim NVNM triangles: 0..2 vertices, 3..5 neighbours (0xffff none), 6 flags, 7 unidentified
  std::vector<std::array<uint16_t, 8>> triangles;
  std::vector<DboNavLink> links;
};

struct DboNavTile
{
  int cellX = 0;
  int cellY = 0;
  // An interior cell's form, empty for an exterior
  std::string cellDesc;
  Vec3 bmin, bmax;
  std::vector<DboNavMesh> meshes;
};

struct DboNavFile
{
  std::string worldspace;
  uint32_t meshCount = 0;
  uint32_t dropped = 0;
  std::vector<DboNavTile> tiles;
};

bool ReadDboNav(const uint8_t* data, size_t size, DboNavFile& out,
                std::string* error = nullptr);

// The tile's meshes as BuildTile input, door triangles flagged; meshes stay separate islands
TileInput ToTileInput(const DboNavTile& tile, bool interior);

}
