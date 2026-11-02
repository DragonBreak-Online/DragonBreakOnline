#pragma once
#include "NavMesh.h"

#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace navmesh {

struct PathResult
{
  // Corner points from start to end (Detour's straightened path), Skyrim units
  std::vector<Vec3> points;
  // Length along the points
  float length = 0.f;
  // The goal is unreachable and the points stop at the nearest reachable spot; a caller must not walk it as if
  // it arrives
  bool partial = false;
};

// Every world loaded from DBONAV files, keyed by worldspace desc for an exterior and cell desc for an interior
class NavService
{
public:
  // Builds every tile of one file; slow (a second for all interiors), so it belongs at boot, never in a tick
  bool Load(const std::vector<uint8_t>& dbonav,
            std::vector<std::string>* loaded = nullptr,
            std::string* error = nullptr);

  std::vector<std::string> Worlds() const;
  bool HasWorld(const std::string& key) const;

  // Each returns nothing for a world that was never loaded; nothing is built on demand
  std::optional<PathResult> FindPath(const std::string& key, const Vec3& from,
                                     const Vec3& to);
  // The nearest walkable point within radius horizontally (and twice that vertically), or nothing
  std::optional<Vec3> Nearest(const std::string& key, const Vec3& pos,
                              float radius);
  // Floor height under each point every step along from..to, both ends included; nothing where there is no floor
  std::vector<std::optional<float>> FloorAlong(const std::string& key,
                                               const Vec3& from, const Vec3& to,
                                               float step);

  // Plugins whose authors forbid AI in derivative work: their navmeshes are never loaded
  static bool IsExcluded(const std::string& desc);

private:
  NavWorld* Find(const std::string& key);

  std::map<std::string, std::unique_ptr<NavWorld>> worlds;
};

}
