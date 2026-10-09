#pragma once
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <vector>

// Whether a weapon hit may land, judged from the aggressor's recent landed hits (ActionListener::OnWeaponHit).
// Kept free of engine types so a unit test can drive it with any timeline. Times are seconds on one steady clock.
namespace WeaponHitGate {

// Non-vanilla splash detection: other targets hit within this time of a swing's first hit belong to that swing
constexpr double kSplashTimeWindow = 0.3;
constexpr size_t kMaxSplashTargets = 4;

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

// One aggressor's current swing: when its first hit landed and which targets it reached
class Memory
{
public:
  // swingInterval(): SwingInterval of the hit's weapon, asked only when needed (it throws for a source with no speed)
  template <class SwingIntervalFn>
  Verdict Judge(uint32_t target, double now,
                SwingIntervalFn&& swingInterval) const
  {
    if (InSplashWindow(now)) {
      if (std::find(targets.begin(), targets.end(), target) !=
          targets.end()) {
        return Verdict::Duplicate;
      }
      if (targets.size() >= kMaxSplashTargets) {
        return Verdict::TooManyTargets;
      }
      return Verdict::Splash;
    }
    return now - swingStart >= swingInterval() ? Verdict::Land
                                               : Verdict::TooFast;
  }

  bool InSplashWindow(double now) const
  {
    return now - swingStart < kSplashTimeWindow;
  }

  // Call for a hit that landed, with the verdict Judge gave it
  void Record(uint32_t target, double now, Verdict verdict)
  {
    if (verdict == Verdict::Land) {
      swingStart = now;
      targets.clear();
    }
    targets.push_back(target);
    lastRecorded = now;
  }

  // Restarts the memory from a last hit recorded elsewhere (the actor's own record): a swing that started then, on target if known
  void Seed(double lastHit, std::optional<uint32_t> target)
  {
    swingStart = lastHit;
    targets.clear();
    if (target) {
      targets.push_back(*target);
    }
    lastRecorded = lastHit;
  }

  // When the last hit this memory saw landed, to tell whether the actor's record moved without it
  double LastRecorded() const { return lastRecorded; }

  // When the current swing started, for the log and pruning
  double LastHitTime() const { return swingStart; }

private:
  double swingStart = -std::numeric_limits<double>::infinity();
  double lastRecorded = -std::numeric_limits<double>::infinity();
  std::vector<uint32_t> targets;
};

}
