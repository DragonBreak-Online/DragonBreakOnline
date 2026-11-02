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

// DBONAV v3, one file per worldspace (_work/navmesh-1102/FORMAT.md)
struct DboNavLink
{
  uint32_t type = 0;
  // Index into the flat mesh table (tiles in order, then their meshes)
  uint32_t targetMesh = 0;
  uint16_t targetTri = 0;
};

// A door triangle and its door; not one to one, and XTEL says where it goes
struct DboNavDoorLink
{
  uint16_t triangle = 0;
  // NVNM's u32 between the two, carried verbatim, meaning not established
  uint32_t unknown = 0;
  std::string doorDesc;
};

struct DboNavMesh
{
  std::string desc;
  std::vector<Vec3> vertices;
  // NVNM triangle: 0-2 verts, 3-5 neighbours, 6 flags, 7 unidentified
  std::vector<std::array<uint16_t, 8>> triangles;
  std::vector<DboNavLink> links;
  std::vector<DboNavDoorLink> doorLinks;
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

// A tile's meshes as BuildTile input, door triangles flagged
TileInput ToTileInput(const DboNavTile& tile, bool interior);

}
