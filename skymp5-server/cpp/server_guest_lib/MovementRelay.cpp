#include "MovementRelay.h"
#include "MpActor.h"
#include "PartOne.h"
#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstring>

namespace {
constexpr float kFullRateUnits = 2000.f;
constexpr float kMinFullRateUnits = 300.f;
constexpr float kGridSquareUnits = 4096.f;
constexpr uint32_t kMidIntervalMs = 500;   // 2/s within one grid square
constexpr uint32_t kFarIntervalMs = 2000;  // 0.5/s in the rest of the block
constexpr uint64_t kCombatPinMs = 10000;
constexpr uint64_t kFlushEveryMs = 50;
constexpr uint64_t kWindowMs = 1000;
constexpr uint64_t kForgetMs = 10000;
// About 32 movers at the clients' 130 ms send rate
constexpr uint32_t kFullSendsPerSecond = 250;
constexpr uint32_t kCoalescedSendsPerSecond = 200;

uint64_t PairKey(uint32_t a, uint32_t b)
{
  return (static_cast<uint64_t>(std::min(a, b)) << 32) | std::max(a, b);
}
}

bool MovementRelay::EnabledFromEnv()
{
  const char* v = std::getenv("SKYMP_MOVEMENT_RELAY");
  return v && std::strcmp(v, "1") == 0;
}

MovementRelay::MovementRelay(PartOne& partOne_)
  : partOne(partOne_)
{
}

uint64_t MovementRelay::NowMs()
{
  return static_cast<uint64_t>(
    std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now().time_since_epoch())
      .count());
}

void MovementRelay::NoteCombat(uint32_t formIdA, uint32_t formIdB)
{
  combat[PairKey(formIdA, formIdB)] = NowMs();
}

bool MovementRelay::InCombat(uint32_t a, uint32_t b, uint64_t now) const
{
  auto it = combat.find(PairKey(a, b));
  return it != combat.end() && now - it->second < kCombatPinMs;
}

void MovementRelay::Send(Networking::UserId userId, const unsigned char* data,
                         size_t length)
{
  partOne.GetSendTarget().Send(userId, data, length, false);
}

void MovementRelay::Submit(MpActor& emitter, Networking::UserId senderUserId,
                           bool skipSender, Networking::PacketData data,
                           size_t length)
{
  const uint64_t now = NowMs();
  const uint32_t emitterId = emitter.GetFormId();
  const auto& emitterPos = emitter.GetPos();

  for (auto listener : emitter.GetActorListeners()) {
    const auto userId = partOne.serverState.UserByActor(listener);
    if (userId == Networking::InvalidUserId ||
        (skipSender && userId == senderUserId)) {
      continue;
    }

    auto& ls = listeners[userId];
    if (ls.fullRadius2 <= 0.f) {
      ls.fullRadius2 = kFullRateUnits * kFullRateUnits;
    }

    const float dist2 = (listener->GetPos() - emitterPos).SqrLength();
    const bool full = listener == &emitter || dist2 <= ls.fullRadius2 ||
      InCombat(listener->GetFormId(), emitterId, now);

    const uint64_t key = (static_cast<uint64_t>(userId) << 32) | emitterId;
    if (full) {
      Send(userId, data, length);
      ++ls.fullThisWindow;
      auto it = pending.find(key);
      if (it != pending.end()) {
        it->second.dirty = false;
        it->second.lastSentMs = now;
        it->second.lastTouchedMs = now;
      }
      continue;
    }

    auto& p = pending[key];
    p.userId = userId;
    p.lastTouchedMs = now;
    p.intervalMs = dist2 <= kGridSquareUnits * kGridSquareUnits
      ? kMidIntervalMs
      : kFarIntervalMs;
    if (now - p.lastSentMs >= p.intervalMs &&
        ls.coalescedSentThisSecond < kCoalescedSendsPerSecond) {
      Send(userId, data, length);
      ++ls.coalescedSentThisSecond;
      p.lastSentMs = now;
      p.dirty = false;
    } else {
      // Coalesced: only the newest position waits, overwriting the last
      p.data.assign(data, data + length);
      p.dirty = true;
    }
  }
}

void MovementRelay::RetuneWindow(uint64_t now)
{
  for (auto& [userId, ls] : listeners) {
    const float max2 = kFullRateUnits * kFullRateUnits;
    const float min2 = kMinFullRateUnits * kMinFullRateUnits;
    if (ls.fullThisWindow > kFullSendsPerSecond) {
      ls.fullRadius2 = std::max(min2, ls.fullRadius2 * 0.7f);
    } else if (ls.fullThisWindow < kFullSendsPerSecond * 6 / 10) {
      ls.fullRadius2 = std::min(max2, ls.fullRadius2 * 1.3f);
    }
    ls.fullThisWindow = 0;
    ls.coalescedSentThisSecond = 0;
  }
  for (auto it = pending.begin(); it != pending.end();) {
    if (now - it->second.lastTouchedMs > kForgetMs) {
      it = pending.erase(it);
    } else {
      ++it;
    }
  }
  for (auto it = combat.begin(); it != combat.end();) {
    if (now - it->second > kCombatPinMs) {
      it = combat.erase(it);
    } else {
      ++it;
    }
  }
}

void MovementRelay::Flush()
{
  const uint64_t now = NowMs();
  if (now - lastFlushMs < kFlushEveryMs) {
    return;
  }
  lastFlushMs = now;
  if (now - windowStartMs >= kWindowMs) {
    windowStartMs = now;
    RetuneWindow(now);
  }
  for (auto& [key, p] : pending) {
    if (!p.dirty || now - p.lastSentMs < p.intervalMs) {
      continue;
    }
    auto& ls = listeners[p.userId];
    if (ls.coalescedSentThisSecond >= kCoalescedSendsPerSecond) {
      continue;
    }
    Send(p.userId, p.data.data(), p.data.size());
    ++ls.coalescedSentThisSecond;
    p.lastSentMs = now;
    p.dirty = false;
  }
}
