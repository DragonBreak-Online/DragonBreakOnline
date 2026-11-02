#include "DboNav.h"

#include <cstring>

namespace navmesh {
namespace {

constexpr char kMagic[8] = { 'D', 'B', 'O', 'N', 'A', 'V', 0, 0 };
constexpr uint32_t kVersion = 3;
constexpr size_t kDescLen = 96;
constexpr uint16_t kDoorBit = 0x0400;

// Bounds-checked little-endian reads over the file
class Reader
{
public:
  Reader(const uint8_t* data_, size_t size_)
    : data(data_)
    , size(size_)
  {
  }

  bool Bytes(void* out, size_t n)
  {
    if (n > size - at) {
      return false;
    }
    std::memcpy(out, data + at, n);
    at += n;
    return true;
  }

  bool U32(uint32_t& v)
  {
    uint8_t b[4];
    if (!Bytes(b, 4)) {
      return false;
    }
    v = b[0] | b[1] << 8 | b[2] << 16 | static_cast<uint32_t>(b[3]) << 24;
    return true;
  }

  bool U16(uint16_t& v)
  {
    uint8_t b[2];
    if (!Bytes(b, 2)) {
      return false;
    }
    v = static_cast<uint16_t>(b[0] | b[1] << 8);
    return true;
  }

  bool I32(int& v)
  {
    uint32_t u;
    if (!U32(u)) {
      return false;
    }
    std::memcpy(&v, &u, 4);
    return true;
  }

  bool F32(float& v)
  {
    uint32_t u;
    if (!U32(u)) {
      return false;
    }
    std::memcpy(&v, &u, 4);
    return true;
  }

  bool Vec(Vec3& v) { return F32(v.x) && F32(v.y) && F32(v.z); }

  bool Text(std::string& s, size_t n)
  {
    std::string raw(n, '\0');
    if (!Bytes(raw.data(), n)) {
      return false;
    }
    s = raw.substr(0, raw.find('\0'));
    return true;
  }

  // Refuse a count whose smallest records cannot fit in what is left
  bool Fits(uint64_t count, size_t each) const
  {
    return count * each <= size - at;
  }

  bool AtEnd() const { return at == size; }

private:
  const uint8_t* data;
  size_t size;
  size_t at = 0;
};

bool Fail(std::string* error, const std::string& text)
{
  if (error) {
    *error = text;
  }
  return false;
}

}

bool ReadDboNav(const uint8_t* data, size_t size, DboNavFile& out,
                std::string* error)
{
  out = DboNavFile();
  Reader r(data, size);
  char magic[8];
  uint32_t version = 0, tiles = 0, reserved = 0;
  if (!r.Bytes(magic, 8) || std::memcmp(magic, kMagic, 8) != 0) {
    return Fail(error, "not a DBONAV file");
  }
  if (!r.U32(version) || version != kVersion) {
    return Fail(error, "unsupported DBONAV version");
  }
  if (!r.Text(out.worldspace, kDescLen) || !r.U32(tiles) ||
      !r.U32(out.meshCount) || !r.U32(out.dropped)) {
    return Fail(error, "DBONAV header is truncated");
  }
  for (int i = 0; i < 4; ++i) {
    if (!r.U32(reserved)) {
      return Fail(error, "DBONAV header is truncated");
    }
  }

  uint32_t meshesSeen = 0;
  constexpr size_t kTileHeader = 4 + 4 + kDescLen + 24 + 4;
  constexpr size_t kMeshHeader = kDescLen + 16;
  if (!r.Fits(tiles, kTileHeader)) {
    return Fail(error, "DBONAV tile count is larger than the file");
  }
  out.tiles.resize(tiles);
  for (auto& tile : out.tiles) {
    uint32_t meshes = 0;
    if (!r.I32(tile.cellX) || !r.I32(tile.cellY) ||
        !r.Text(tile.cellDesc, kDescLen) || !r.Vec(tile.bmin) ||
        !r.Vec(tile.bmax) || !r.U32(meshes)) {
      return Fail(error, "DBONAV tile is truncated");
    }
    if (!r.Fits(meshes, kMeshHeader)) {
      return Fail(error, "DBONAV mesh count is larger than the file");
    }
    tile.meshes.resize(meshes);
    for (auto& mesh : tile.meshes) {
      uint32_t verts = 0, tris = 0, links = 0, doors = 0;
      if (!r.Text(mesh.desc, kDescLen) || !r.U32(verts) || !r.U32(tris) ||
          !r.U32(links) || !r.U32(doors)) {
        return Fail(error, "DBONAV mesh is truncated");
      }
      if (!r.Fits(static_cast<uint64_t>(verts) * 12 + tris * 16ull +
                    links * 12ull + doors * (8ull + kDescLen),
                  1)) {
        return Fail(error, "DBONAV mesh is truncated");
      }
      mesh.vertices.resize(verts);
      for (auto& v : mesh.vertices) {
        r.Vec(v);
      }
      mesh.triangles.resize(tris);
      for (auto& t : mesh.triangles) {
        for (auto& w : t) {
          r.U16(w);
        }
        for (int k = 0; k < 3; ++k) {
          if (t[k] >= verts) {
            return Fail(error,
                        "a triangle names a missing vertex in " + mesh.desc);
          }
        }
      }
      mesh.links.resize(links);
      for (auto& l : mesh.links) {
        uint16_t pad = 0;
        r.U32(l.type);
        r.U32(l.targetMesh);
        r.U16(l.targetTri);
        r.U16(pad);
      }
      mesh.doorLinks.resize(doors);
      for (auto& d : mesh.doorLinks) {
        uint16_t pad = 0;
        r.U16(d.triangle);
        r.U16(pad);
        r.U32(d.unknown);
        r.Text(d.doorDesc, kDescLen);
        if (d.triangle >= tris) {
          return Fail(error,
                      "a door link names a missing triangle in " + mesh.desc);
        }
      }
      ++meshesSeen;
    }
  }
  if (meshesSeen != out.meshCount) {
    return Fail(error, "DBONAV header's mesh count does not match its tiles");
  }
  if (!r.AtEnd()) {
    return Fail(error, "DBONAV has bytes after its last tile");
  }
  for (const auto& tile : out.tiles) {
    for (const auto& mesh : tile.meshes) {
      for (const auto& l : mesh.links) {
        if (l.targetMesh >= out.meshCount) {
          return Fail(error,
                      "an edge link names a missing mesh in " + mesh.desc);
        }
      }
    }
  }
  return true;
}

TileInput ToTileInput(const DboNavTile& tile, bool interior)
{
  TileInput in;
  in.cellX = tile.cellX;
  in.cellY = tile.cellY;
  in.interior = interior;
  for (const auto& mesh : tile.meshes) {
    std::vector<std::array<uint32_t, 3>> tris;
    std::vector<uint16_t> flags;
    tris.reserve(mesh.triangles.size());
    flags.reserve(mesh.triangles.size());
    for (const auto& t : mesh.triangles) {
      tris.push_back({ t[0], t[1], t[2] });
      flags.push_back(static_cast<uint16_t>(
        kPolyWalk | ((t[6] & kDoorBit) ? kPolyDoor : 0)));
    }
    AppendMesh(in, mesh.vertices, tris, flags);
  }
  return in;
}

}
