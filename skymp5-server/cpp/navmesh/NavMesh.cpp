#include "NavMesh.h"

#include <DetourAlloc.h>
#include <DetourNavMesh.h>
#include <DetourNavMeshBuilder.h>
#include <DetourNavMeshQuery.h>
#include <DetourStatus.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <map>
#include <tuple>
#include <utility>

namespace navmesh {
namespace {

// Detour is Y up: Skyrim (x, y, z) is Detour (x, z, -y), a rotation, so winding is kept
void ToDetour(const Vec3& v, float* out)
{
  out[0] = v.x;
  out[1] = v.z;
  out[2] = -v.y;
}

Vec3 FromDetour(const float* v)
{
  return { v[0], -v[2], v[1] };
}

constexpr float kCellSize = 0.5f;
// Measured: border vertices sit up to 6.86 units off the cell line
constexpr float kBorderEpsilon = 8.f;
constexpr float kInteriorTileSize = 1000000.f;
constexpr int kMaxPathPolys = 2048;
constexpr int kMaxStraight = 256;
constexpr int kMsetMagic = 'M' << 24 | 'S' << 16 | 'E' << 8 | 'T';
constexpr int kMsetVersion = 1;

struct MsetHeader
{
  int magic;
  int version;
  int numTiles;
  dtNavMeshParams params;
};

struct MsetTileHeader
{
  dtTileRef tileRef;
  int dataSize;
};

void SetError(std::string* error, const std::string& text)
{
  if (error) {
    *error = text;
  }
}

dtQueryFilter AllFilter()
{
  dtQueryFilter filter;
  filter.setIncludeFlags(0xffff);
  filter.setExcludeFlags(0);
  return filter;
}

// Detour clamps the search box to each tile, so a hit far outside it comes back too; this keeps only hits inside
dtPolyRef Snap(const dtNavMeshQuery* query, const float* p, const float* ext,
               float* nearest)
{
  const dtQueryFilter filter = AllFilter();
  dtPolyRef ref = 0;
  if (dtStatusFailed(query->findNearestPoly(p, ext, &filter, &ref, nearest)) ||
      !ref) {
    return 0;
  }
  for (int i = 0; i < 3; ++i) {
    if (std::fabs(nearest[i] - p[i]) > ext[i]) {
      return 0;
    }
  }
  return ref;
}

}

void AppendMesh(TileInput& input, const std::vector<Vec3>& vertices,
                const std::vector<std::array<uint32_t, 3>>& triangles,
                const std::vector<uint16_t>& flags)
{
  const auto base = static_cast<uint32_t>(input.vertices.size());
  // Flags stay per triangle across meshes: a mesh without them fills 1s once another has some
  if (!flags.empty() && input.flags.empty()) {
    input.flags.assign(input.triangles.size(), 1);
  }
  input.vertices.insert(input.vertices.end(), vertices.begin(), vertices.end());
  for (const auto& t : triangles) {
    input.triangles.push_back({ t[0] + base, t[1] + base, t[2] + base });
  }
  if (!flags.empty()) {
    input.flags.insert(input.flags.end(), flags.begin(), flags.end());
  } else if (!input.flags.empty()) {
    input.flags.resize(input.triangles.size(), 1);
  }
}

bool BuildTile(const TileInput& input, std::vector<uint8_t>& out,
               std::string* error)
{
  const size_t nVerts = input.vertices.size();
  if (nVerts < 3 || input.triangles.empty()) {
    SetError(error, "no triangles");
    return false;
  }
  if (!input.flags.empty() && input.flags.size() != input.triangles.size()) {
    SetError(error, "flags must have one entry per triangle");
    return false;
  }
  for (const auto& t : input.triangles) {
    for (uint32_t v : t) {
      if (v >= nVerts) {
        SetError(error, "a triangle names a missing vertex");
        return false;
      }
    }
  }

  std::vector<std::array<float, 3>> dv(nVerts);
  for (size_t i = 0; i < nVerts; ++i) {
    ToDetour(input.vertices[i], dv[i].data());
  }

  // An exterior tile is its cell: x from the west edge, z from the north edge (Skyrim's larger y)
  float minX, maxX, minZ, maxZ, cs = kCellSize;
  if (input.interior) {
    minX = minZ = 1e30f;
    maxX = maxZ = -1e30f;
    for (const auto& v : dv) {
      minX = std::min(minX, v[0]);
      maxX = std::max(maxX, v[0]);
      minZ = std::min(minZ, v[2]);
      maxZ = std::max(maxZ, v[2]);
    }
    if (std::max(std::fabs(minX), std::fabs(maxX)) >= kInteriorTileSize / 2 ||
        std::max(std::fabs(minZ), std::fabs(maxZ)) >= kInteriorTileSize / 2) {
      SetError(error, "an interior vertex lies too far from the origin");
      return false;
    }
    cs = std::max(kCellSize, std::max(maxX - minX, maxZ - minZ) / 65000.f);
  } else {
    const float s = input.tileSize;
    minX = input.cellX * s;
    maxX = minX + s;
    minZ = -(input.cellY + 1) * s;
    maxZ = minZ + s;
    for (auto& v : dv) {
      // A vertex on the cell edge is snapped to it, so the neighbour tile's portal matches exactly
      for (auto [axis, lo, hi] :
           { std::tuple{ 0, minX, maxX }, std::tuple{ 2, minZ, maxZ } }) {
        float& c = v[axis];
        if (std::fabs(c - lo) < kBorderEpsilon) {
          c = lo;
        } else if (std::fabs(c - hi) < kBorderEpsilon) {
          c = hi;
        }
        if (c < lo || c > hi) {
          SetError(error, "a vertex lies outside its cell");
          return false;
        }
      }
    }
  }
  float minY = 1e30f, maxY = -1e30f;
  for (const auto& v : dv) {
    minY = std::min(minY, v[1]);
    maxY = std::max(maxY, v[1]);
  }
  const float ch = std::max(kCellSize, (maxY - minY) / 65000.f);

  // Vertices at one quantised spot become one, which joins navmeshes that share an edge
  std::map<std::array<unsigned short, 3>, uint16_t> weld;
  std::vector<unsigned short> qverts;
  std::vector<uint16_t> remap(nVerts);
  for (size_t i = 0; i < nVerts; ++i) {
    const std::array<unsigned short, 3> q = {
      static_cast<unsigned short>(std::lround((dv[i][0] - minX) / cs)),
      static_cast<unsigned short>(std::lround((dv[i][1] - minY) / ch)),
      static_cast<unsigned short>(std::lround((dv[i][2] - minZ) / cs))
    };
    auto [it, fresh] =
      weld.emplace(q, static_cast<uint16_t>(qverts.size() / 3));
    if (fresh) {
      if (qverts.size() / 3 >= 0xfffe) {
        SetError(error, "too many vertices for one tile");
        return false;
      }
      qverts.insert(qverts.end(), q.begin(), q.end());
    }
    remap[i] = it->second;
  }
  const auto qv = [&](uint16_t i) { return &qverts[i * 3]; };

  // Each triangle goes in one winding seen from above, whatever order the record had; welded-flat ones drop
  std::vector<std::array<uint16_t, 3>> tris;
  std::vector<unsigned short> flags;
  for (size_t i = 0; i < input.triangles.size(); ++i) {
    std::array<uint16_t, 3> t = { remap[input.triangles[i][0]],
                                  remap[input.triangles[i][1]],
                                  remap[input.triangles[i][2]] };
    if (t[0] == t[1] || t[1] == t[2] || t[0] == t[2]) {
      continue;
    }
    const auto* a = qv(t[0]);
    const auto* b = qv(t[1]);
    const auto* c = qv(t[2]);
    const long long area =
      (static_cast<long long>(c[0]) - a[0]) * (static_cast<long long>(b[2]) - a[2]) -
      (static_cast<long long>(b[0]) - a[0]) * (static_cast<long long>(c[2]) - a[2]);
    if (area < 0) {
      std::swap(t[1], t[2]);
    }
    tris.push_back(t);
    flags.push_back(input.flags.empty() ? 1 : input.flags[i]);
  }
  const size_t nTris = tris.size();
  if (nTris == 0) {
    SetError(error, "no triangles");
    return false;
  }

  // Shared edges give the neighbours; an edge on the cell border with none is a portal
  std::map<std::pair<uint16_t, uint16_t>, int> edgeOwner;
  std::vector<unsigned short> polys(nTris * 6, 0xffff);
  for (size_t i = 0; i < nTris; ++i) {
    for (int j = 0; j < 3; ++j) {
      polys[i * 6 + j] = tris[i][j];
    }
  }
  for (size_t i = 0; i < nTris; ++i) {
    for (int j = 0; j < 3; ++j) {
      auto key = std::minmax(tris[i][j], tris[i][(j + 1) % 3]);
      auto [it, fresh] = edgeOwner.emplace(key, static_cast<int>(i * 3 + j));
      if (!fresh && it->second >= 0) {
        const int other = it->second;
        polys[i * 6 + 3 + j] = static_cast<unsigned short>(other / 3);
        polys[(other / 3) * 6 + 3 + other % 3] =
          static_cast<unsigned short>(i);
        it->second = -1;
      }
    }
  }
  const unsigned short qMaxX =
    static_cast<unsigned short>(std::lround((maxX - minX) / cs));
  const unsigned short qMaxZ =
    static_cast<unsigned short>(std::lround((maxZ - minZ) / cs));
  for (size_t i = 0; i < nTris; ++i) {
    for (int j = 0; j < 3; ++j) {
      unsigned short& nei = polys[i * 6 + 3 + j];
      if (nei != 0xffff) {
        continue;
      }
      const auto* a = qv(tris[i][j]);
      const auto* b = qv(tris[i][(j + 1) % 3]);
      // Detour's border codes: 0 x-, 1 z+, 2 x+, 3 z-, 0xf a plain border; an interior has no portals
      unsigned short dir = 0xf;
      if (!input.interior) {
        if (a[0] == 0 && b[0] == 0) {
          dir = 0;
        } else if (a[2] == qMaxZ && b[2] == qMaxZ) {
          dir = 1;
        } else if (a[0] == qMaxX && b[0] == qMaxX) {
          dir = 2;
        } else if (a[2] == 0 && b[2] == 0) {
          dir = 3;
        }
      }
      nei = static_cast<unsigned short>(0x8000 | dir);
    }
  }

  std::vector<unsigned char> areas(nTris, 0);
  dtNavMeshCreateParams params;
  std::memset(&params, 0, sizeof(params));
  params.verts = qverts.data();
  params.vertCount = static_cast<int>(qverts.size() / 3);
  params.polys = polys.data();
  params.polyFlags = flags.data();
  params.polyAreas = areas.data();
  params.polyCount = static_cast<int>(nTris);
  params.nvp = 3;
  params.tileX = input.interior ? 0 : input.cellX;
  params.tileY = input.interior ? 0 : -(input.cellY + 1);
  params.tileLayer = input.layer;
  params.bmin[0] = minX;
  params.bmin[1] = minY;
  params.bmin[2] = minZ;
  params.bmax[0] = maxX;
  params.bmax[1] = maxY;
  params.bmax[2] = maxZ;
  params.walkableHeight = 128.f;
  params.walkableRadius = 32.f;
  params.walkableClimb = 64.f;
  params.cs = cs;
  params.ch = ch;
  params.buildBvTree = true;

  unsigned char* data = nullptr;
  int dataSize = 0;
  if (!dtCreateNavMeshData(&params, &data, &dataSize)) {
    SetError(error, "dtCreateNavMeshData failed");
    return false;
  }
  out.assign(data, data + dataSize);
  dtFree(data);
  return true;
}

std::vector<uint8_t> WriteTileSet(
  const std::vector<std::vector<uint8_t>>& tiles, float tileSize, int maxTiles,
  int maxPolys)
{
  MsetHeader header;
  std::memset(&header, 0, sizeof(header));
  header.magic = kMsetMagic;
  header.version = kMsetVersion;
  header.numTiles = static_cast<int>(tiles.size());
  header.params.tileWidth = tileSize;
  header.params.tileHeight = tileSize;
  header.params.maxTiles = maxTiles;
  header.params.maxPolys = maxPolys;

  std::vector<uint8_t> out(sizeof(header));
  std::memcpy(out.data(), &header, sizeof(header));
  for (const auto& tile : tiles) {
    MsetTileHeader th{ 0, static_cast<int>(tile.size()) };
    const size_t at = out.size();
    out.resize(at + sizeof(th) + tile.size());
    std::memcpy(out.data() + at, &th, sizeof(th));
    std::memcpy(out.data() + at + sizeof(th), tile.data(), tile.size());
  }
  return out;
}

NavWorld::NavWorld(float tileSize_, int maxTiles, int maxPolys, bool interior_)
  : tileSize(interior_ ? kInteriorTileSize : tileSize_)
  , interior(interior_)
{
  dtNavMeshParams params;
  std::memset(&params, 0, sizeof(params));
  // An interior's one tile is centred on the origin, so any coordinate it holds falls in tile 0,0
  if (interior) {
    params.orig[0] = params.orig[2] = -kInteriorTileSize / 2;
  }
  params.tileWidth = tileSize;
  params.tileHeight = tileSize;
  params.maxTiles = maxTiles;
  params.maxPolys = maxPolys;
  mesh = dtAllocNavMesh();
  if (!mesh || dtStatusFailed(mesh->init(&params))) {
    dtFreeNavMesh(mesh);
    mesh = nullptr;
  }
}

NavWorld::~NavWorld()
{
  dtFreeNavMeshQuery(query);
  dtFreeNavMesh(mesh);
}

bool NavWorld::IsValid() const
{
  return mesh != nullptr;
}

// The query's node pool is made on first use, so a thousand loaded interiors cost nothing until one is searched
dtNavMeshQuery* NavWorld::Query()
{
  if (!query && mesh) {
    query = dtAllocNavMeshQuery();
    if (query && dtStatusFailed(query->init(mesh, 4096))) {
      dtFreeNavMeshQuery(query);
      query = nullptr;
    }
  }
  return query;
}

bool NavWorld::AddTile(const std::vector<uint8_t>& data, std::string* error)
{
  if (!IsValid()) {
    SetError(error, "the nav world failed to initialise");
    return false;
  }
  if (data.size() < sizeof(dtMeshHeader)) {
    SetError(error, "tile data is too short");
    return false;
  }
  auto* copy = static_cast<unsigned char*>(dtAlloc(data.size(), DT_ALLOC_PERM));
  if (!copy) {
    SetError(error, "out of memory");
    return false;
  }
  std::memcpy(copy, data.data(), data.size());
  const dtStatus status = mesh->addTile(copy, static_cast<int>(data.size()),
                                        DT_TILE_FREE_DATA, 0, nullptr);
  if (dtStatusFailed(status)) {
    dtFree(copy);
    SetError(error,
             dtStatusDetail(status, DT_ALREADY_OCCUPIED)
               ? "a tile is already loaded at that cell and layer"
               : dtStatusDetail(status, DT_OUT_OF_MEMORY)
               ? "no free tile slot"
               : "the tile was refused (wrong magic, version or poly count)");
    return false;
  }
  return true;
}

bool NavWorld::RemoveTile(int cellX, int cellY, int layer)
{
  if (!IsValid()) {
    return false;
  }
  const dtTileRef ref = interior
    ? mesh->getTileRefAt(0, 0, layer)
    : mesh->getTileRefAt(cellX, -(cellY + 1), layer);
  return ref && dtStatusSucceed(mesh->removeTile(ref, nullptr, nullptr));
}

bool NavWorld::LoadTileSet(const std::vector<uint8_t>& mset,
                           std::string* error)
{
  MsetHeader header;
  if (mset.size() < sizeof(header)) {
    SetError(error, "tile set is too short");
    return false;
  }
  std::memcpy(&header, mset.data(), sizeof(header));
  if (header.magic != kMsetMagic || header.version != kMsetVersion) {
    SetError(error, "not an MSET tile set");
    return false;
  }
  size_t at = sizeof(header);
  for (int i = 0; i < header.numTiles; ++i) {
    MsetTileHeader th;
    if (at + sizeof(th) > mset.size()) {
      SetError(error, "tile set is truncated");
      return false;
    }
    std::memcpy(&th, mset.data() + at, sizeof(th));
    at += sizeof(th);
    if (th.dataSize <= 0 || at + th.dataSize > mset.size()) {
      SetError(error, "tile set is truncated");
      return false;
    }
    std::vector<uint8_t> tile(mset.begin() + at,
                              mset.begin() + at + th.dataSize);
    at += th.dataSize;
    if (!AddTile(tile, error)) {
      return false;
    }
  }
  return true;
}

int NavWorld::TileCount() const
{
  if (!mesh) {
    return 0;
  }
  int n = 0;
  const dtNavMesh* m = mesh;
  for (int i = 0; i < m->getMaxTiles(); ++i) {
    const dtMeshTile* tile = m->getTile(i);
    if (tile && tile->header) {
      ++n;
    }
  }
  return n;
}

std::optional<Vec3> NavWorld::NearestWalkable(const Vec3& point,
                                              const Vec3& extents)
{
  dtNavMeshQuery* query = Query();
  if (!query) {
    return std::nullopt;
  }
  float p[3], ext[3] = { extents.x, extents.z, extents.y }, nearest[3];
  ToDetour(point, p);
  if (!Snap(query, p, ext, nearest)) {
    return std::nullopt;
  }
  return FromDetour(nearest);
}

bool NavWorld::FindPath(const Vec3& from, const Vec3& to,
                        std::vector<Vec3>& out, bool* partial,
                        const Vec3& extents)
{
  out.clear();
  if (partial) {
    *partial = false;
  }
  dtNavMeshQuery* query = Query();
  if (!query) {
    return false;
  }
  float a[3], b[3], ext[3] = { extents.x, extents.z, extents.y };
  ToDetour(from, a);
  ToDetour(to, b);
  const dtQueryFilter filter = AllFilter();
  float start[3], end[3];
  const dtPolyRef startRef = Snap(query, a, ext, start);
  const dtPolyRef endRef = Snap(query, b, ext, end);
  if (!startRef || !endRef) {
    return false;
  }

  std::vector<dtPolyRef> path(kMaxPathPolys);
  int pathCount = 0;
  const dtStatus status =
    query->findPath(startRef, endRef, start, end, &filter, path.data(),
                    &pathCount, kMaxPathPolys);
  if (dtStatusFailed(status) || pathCount == 0) {
    return false;
  }
  // A partial path ends on the polygon nearest the goal, at the closest point on it
  const bool isPartial = path[pathCount - 1] != endRef;
  if (isPartial) {
    query->closestPointOnPoly(path[pathCount - 1], end, end, nullptr);
  }

  float straight[kMaxStraight * 3];
  int straightCount = 0;
  if (dtStatusFailed(query->findStraightPath(start, end, path.data(),
                                             pathCount, straight, nullptr,
                                             nullptr, &straightCount,
                                             kMaxStraight))) {
    return false;
  }
  for (int i = 0; i < straightCount; ++i) {
    out.push_back(FromDetour(straight + i * 3));
  }
  if (partial) {
    *partial = isPartial;
  }
  return !out.empty();
}

}
