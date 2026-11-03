#pragma once
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <vector>

// Timed restore effects a player's own client runs, as points a second
namespace TimedRestore {

using Clock = std::chrono::steady_clock;

// Room for late reports and perks that raise the healing
constexpr float kSlack = 1.5f;
constexpr std::chrono::seconds kGrace{ 2 };

struct Entry
{
  uint32_t spellId = 0;
  uint32_t av = 0;
  float pointsPerSecond = 0.f;
  Clock::time_point start{};
  Clock::time_point end{};
};

class Memory
{
public:
  // A recast of the same spell refreshes its effect, as in the game
  void Note(uint32_t spellId, uint32_t av, float pointsPerSecond,
            float seconds, Clock::time_point now)
  {
    std::erase_if(entries, [&](const Entry& e) {
      return e.end <= now || (e.spellId == spellId && e.av == av);
    });
    if (!(pointsPerSecond > 0.f) || !(seconds > 0.f)) {
      return;
    }
    const auto length = std::chrono::duration_cast<Clock::duration>(
                          std::chrono::duration<float>(seconds)) +
      kGrace;
    entries.push_back(
      Entry{ spellId, av, pointsPerSecond * kSlack, now, now + length });
  }

  // Points the client may add to av between from and to
  float Points(uint32_t av, Clock::time_point from, Clock::time_point to) const
  {
    float points = 0.f;
    for (const auto& e : entries) {
      const auto a = std::max(from, e.start);
      const auto b = std::min(to, e.end);
      if (e.av == av && b > a) {
        points +=
          e.pointsPerSecond * std::chrono::duration<float>(b - a).count();
      }
    }
    return points;
  }

private:
  std::vector<Entry> entries;
};

}
