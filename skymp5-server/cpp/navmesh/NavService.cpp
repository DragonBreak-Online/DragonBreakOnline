#include "NavService.h"
#include "DboNav.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <set>

namespace navmesh {
namespace {

// Detour's 32-bit poly refs: tile bits and poly bits share 22
constexpr int kRefBits = 22;

std::string Lower(std::string s)
{
  std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) {
    return static_cast<char>(std::tolower(c));
  });
  return s;
}

int BitsFor(size_t n)
{
  int bits = 0;
  while ((size_t(1) << bits) < n) {
    ++bits;
  }
  return bits;
}

bool Fail(std::string* error, const std::string& text)
{
  if (error) {
    *error = text;
  }
  return false;
}

}

bool NavService::IsExcluded(const std::string& desc)
{
  static const std::set<std::string> kExcluded = {
    "baan malur landscape updates.esp",
    "baanmalurmapmarker.esp",
    "druadach.esm",
    "druadach0.esp",
    "druadach1.esp",
    "journey to baan malur - dunmeth pass.esp",
    "journey to baan malur.esp",
    "king of the murkmire - ancient argonian armor.esp",
    "king of the murkmire.esp",
    "morrowind map fix.esp",
    "murkmire official housing pack.esp",
    "summersetfixes.esp",
    "summersetisles.esp",
  };
  const std::string d = Lower(desc);
  return kExcluded.count(d.substr(0, d.rfind(':'))) > 0;
}

bool NavService::Load(const std::vector<uint8_t>& dbonav,
                      std::vector<std::string>* loaded, std::string* error)
{
  DboNavFile file;
  if (!ReadDboNav(dbonav.data(), dbonav.size(), file, error)) {
    return false;
  }
  const bool interiors = file.worldspace == "interiors";
  if (!interiors && IsExcluded(file.worldspace)) {
    return Fail(error,
                "refused: " + file.worldspace +
                  " is from a plugin whose author forbids AI");
  }

  if (interiors) {
    std::map<std::string, std::unique_ptr<NavWorld>> built;
    for (const auto& tile : file.tiles) {
      const std::string key = Lower(tile.cellDesc);
      if (IsExcluded(key)) {
        continue;
      }
      const TileInput in = ToTileInput(tile, true);
      std::vector<uint8_t> data;
      std::string why;
      if (!BuildTile(in, data, &why)) {
        return Fail(error, key + ": " + why);
      }
      const int maxPolys = 1 << std::max(6, BitsFor(in.triangles.size()));
      auto world = std::make_unique<NavWorld>(4096.f, 1, maxPolys, true);
      if (!world->AddTile(data, &why)) {
        return Fail(error, key + ": " + why);
      }
      built[key] = std::move(world);
    }
    for (auto& [key, world] : built) {
      if (loaded) {
        loaded->push_back(key);
      }
      worlds[key] = std::move(world);
    }
    return true;
  }

  // One world per worldspace, sized to fit Detour's 22 ref bits
  size_t maxTris = 1;
  std::vector<std::vector<uint8_t>> tiles;
  for (const auto& tile : file.tiles) {
    const TileInput in = ToTileInput(tile, false);
    maxTris = std::max(maxTris, in.triangles.size());
    std::vector<uint8_t> data;
    std::string why;
    if (!BuildTile(in, data, &why)) {
      return Fail(error,
                  file.worldspace + " cell " + std::to_string(tile.cellX) +
                    "," + std::to_string(tile.cellY) + ": " + why);
    }
    tiles.push_back(std::move(data));
  }
  const int tileBits = BitsFor(std::max<size_t>(tiles.size(), 1));
  const int polyBits = std::max(6, BitsFor(maxTris));
  if (tileBits + polyBits > kRefBits) {
    return Fail(error,
                file.worldspace + " is too large for one world: " +
                  std::to_string(tiles.size()) + " tiles with up to " +
                  std::to_string(maxTris) + " triangles each need " +
                  std::to_string(tileBits + polyBits) + " ref bits of 22");
  }
  auto world =
    std::make_unique<NavWorld>(4096.f, 1 << tileBits, 1 << polyBits);
  for (const auto& data : tiles) {
    std::string why;
    if (!world->AddTile(data, &why)) {
      return Fail(error, file.worldspace + ": " + why);
    }
  }
  const std::string key = Lower(file.worldspace);
  worlds[key] = std::move(world);
  if (loaded) {
    loaded->push_back(key);
  }
  return true;
}

std::vector<std::string> NavService::Worlds() const
{
  std::vector<std::string> out;
  for (const auto& [key, world] : worlds) {
    out.push_back(key);
  }
  return out;
}

bool NavService::HasWorld(const std::string& key) const
{
  return worlds.count(Lower(key)) > 0;
}

NavWorld* NavService::Find(const std::string& key)
{
  auto it = worlds.find(Lower(key));
  return it == worlds.end() ? nullptr : it->second.get();
}

std::optional<PathResult> NavService::FindPath(const std::string& key,
                                               const Vec3& from,
                                               const Vec3& to)
{
  NavWorld* world = Find(key);
  if (!world) {
    return std::nullopt;
  }
  PathResult r;
  if (!world->FindPath(from, to, r.points, &r.partial)) {
    return std::nullopt;
  }
  for (size_t i = 1; i < r.points.size(); ++i) {
    const Vec3& a = r.points[i - 1];
    const Vec3& b = r.points[i];
    r.length +=
      std::sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y) +
                (b.z - a.z) * (b.z - a.z));
  }
  return r;
}

std::optional<Vec3> NavService::Nearest(const std::string& key,
                                        const Vec3& pos, float radius)
{
  NavWorld* world = Find(key);
  if (!world || !(radius > 0.f)) {
    return std::nullopt;
  }
  return world->NearestWalkable(pos, { radius, radius, radius * 2 });
}

std::vector<std::optional<float>> NavService::FloorAlong(
  const std::string& key, const Vec3& from, const Vec3& to, float step)
{
  std::vector<std::optional<float>> out;
  NavWorld* world = Find(key);
  if (!world || !(step > 0.f)) {
    return out;
  }
  const float len = std::hypot(to.x - from.x, to.y - from.y);
  const int n = std::max(1, static_cast<int>(std::ceil(len / step)));
  if (n > 10000) {
    return out;
  }
  const float climb = std::max(512.f, std::fabs(to.z - from.z) + 512.f);
  for (int i = 0; i <= n; ++i) {
    const float t = static_cast<float>(i) / n;
    const Vec3 p{ from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t,
                  from.z + (to.z - from.z) * t };
    // Only a floor straight under the point counts, not one beside it
    auto hit = world->NearestWalkable(p, { 1.f, 1.f, climb });
    if (hit && std::hypot(hit->x - p.x, hit->y - p.y) < 1.f) {
      out.push_back(hit->z);
    } else {
      out.push_back(std::nullopt);
    }
  }
  return out;
}

}
