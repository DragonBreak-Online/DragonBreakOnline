#pragma once
#include <array>
#include <chrono>

// Recognises a client health report written before the client saw a raise the server just made (a hit's give-back)
namespace StaleHealthReport {

using Clock = std::chrono::steady_clock;

// A report in flight when the raise went out arrives within a round trip
constexpr std::chrono::milliseconds kWindow{ 1500 };
// The client's own regeneration between the two messages, as a fraction of full health
constexpr float kTolerance = 0.02f;

struct Raise
{
  float from = 0.f;
  float to = 0.f;
  Clock::time_point at{};
  bool set = false;
};

class Memory
{
public:
  // The server raised the player's health from `from` to `to` (fractions of full health)
  void Note(float from, float to, Clock::time_point now) noexcept
  {
    if (!(to > from)) {
      return;
    }
    raises[next] = Raise{ from, to, now, true };
    next = (next + 1) % raises.size();
  }

  // Lower than the server's health and equal to where a recent raise started: a lower report is the client's own
  bool IsStale(float reported, float current, Clock::time_point now) const
  {
    if (!(reported < current)) {
      return false;
    }
    for (const auto& r : raises) {
      if (!r.set || now - r.at > kWindow || now < r.at) {
        continue;
      }
      if (reported >= r.from - kTolerance && reported <= r.from + kTolerance) {
        return true;
      }
    }
    return false;
  }

private:
  std::array<Raise, 4> raises{};
  size_t next = 0;
};

}
