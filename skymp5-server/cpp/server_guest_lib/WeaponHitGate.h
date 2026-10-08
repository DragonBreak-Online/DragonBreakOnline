#pragma once
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <utility>
#include <vector>

// Whether a weapon hit may land, judged from the aggressor's recent landed hits (ActionListener::OnWeaponHit).
// Kept free of engine types so a unit test can drive it with any timeline. Times are seconds on one steady clock.
namespace WeaponHitGate {

// Non-vanilla splash detection: hits this close together are one swing reaching several targets
constexpr double kSplashTimeWindow = 0.1;
constexpr size_t kMaxSplashTargets = 4;
constexpr size_t kMaxHitMemory = 16;

enum class Verdict
{
  Land,           // a new swing
  Splash,         // another target of the current swing
  Duplicate,      // the same target again within the swing: one hit event sent twice
  TooManyTargets, // the swing already reached kMaxSplashTargets targets
  TooFast         // faster than the weapon swings
};

inline bool Lands(Verdict v)
{
  return v == Verdict::Land || v == Verdict::Splash;
}

// The shortest time between two swings of a weapon with this WEAP DNAM speed, in seconds
inline double SwingInterval(float speed)
{
  return (1.1 * (1 / speed)) -
    (1.1 * (1 / speed) * (speed <= 0.75 ? 0.45 : 0.3));
}

// One aggressor's landed weapon hits
class Memory
{
public:
  // swingInterval(): SwingInterval of the hit's weapon, asked only when needed (it throws for a source with no speed)
  template <class SwingIntervalFn>
  Verdict Judge(uint32_t target, double now,
                SwingIntervalFn&& swingInterval) const
  {
    const double sinceAnyTarget = now - LastAny();
    if (sinceAnyTarget < kSplashTimeWindow) {
      if (now - LastOn(target) < kSplashTimeWindow) {
        return Verdict::Duplicate;
      }
      if (CountSince(now - kSplashTimeWindow) >= kMaxSplashTargets) {
        return Verdict::TooManyTargets;
      }
      return Verdict::Splash;
    }
    return sinceAnyTarget >= swingInterval() ? Verdict::Land
                                             : Verdict::TooFast;
  }

  // True when the hit falls in the splash window of the last landed hit, for the log
  bool InSplashWindow(double now) const
  {
    return now - LastAny() < kSplashTimeWindow;
  }

  // Call for a hit that landed, with the verdict Judge gave it
  void Record(uint32_t target, double now, Verdict)
  {
    auto it = std::find_if(hits.begin(), hits.end(),
                           [&](const auto& e) { return e.first == target; });
    if (it != hits.end()) {
      it->second = now;
      std::rotate(it, it + 1, hits.end());
      return;
    }
    if (hits.size() >= kMaxHitMemory) {
      hits.erase(hits.begin());
    }
    hits.push_back({ target, now });
  }

  // When the last hit landed, for pruning
  double LastHitTime() const { return LastAny(); }

private:
  static constexpr double kNever = -std::numeric_limits<double>::infinity();

  double LastAny() const
  {
    return hits.empty() ? kNever : hits.back().second;
  }

  double LastOn(uint32_t target) const
  {
    for (const auto& e : hits) {
      if (e.first == target) {
        return e.second;
      }
    }
    return kNever;
  }

  size_t CountSince(double from) const
  {
    return std::count_if(hits.begin(), hits.end(),
                         [&](const auto& e) { return e.second > from; });
  }

  std::vector<std::pair<uint32_t, double>> hits; // least recent first
};

}
