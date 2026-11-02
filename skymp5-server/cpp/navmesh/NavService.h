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
  // Unreachable goal: stops short, and must not be walked as arriving
  bool partial = false;
};

// Loaded worlds, keyed by worldspace desc or interior cell desc
class NavService
{
public:
  // Builds every tile of a file; slow, so boot only, never in a tick
  bool Load(const std::vector<uint8_t>& dbonav,
            std::vector<std::string>* loaded = nullptr,
            std::string* error = nullptr);

  std::vector<std::string> Worlds() const;
  bool HasWorld(const std::string& key) const;

  // Each returns nothing for an unloaded world; nothing loads on demand
  std::optional<PathResult> FindPath(const std::string& key, const Vec3& from,
                                     const Vec3& to);
  // Nearest walkable point within radius (twice that vertically)
  std::optional<Vec3> Nearest(const std::string& key, const Vec3& pos,
                              float radius);
  // Floor height every step along from..to, both ends; none if no floor
  std::vector<std::optional<float>> FloorAlong(const std::string& key,
                                               const Vec3& from,
                                               const Vec3& to, float step);

  // Plugins whose authors forbid AI: their navmeshes are never loaded
  static bool IsExcluded(const std::string& desc);

private:
  NavWorld* Find(const std::string& key);

  std::map<std::string, std::unique_ptr<NavWorld>> worlds;
};

}
