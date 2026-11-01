#include "MovementRelay.h"
#include "MpActor.h"
#include "PartOne.h"
#include "TickProfile.h"
#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <iterator>

namespace {
constexpr float kFullRateUnits = 2000.f;
constexpr float kMinFullRateUnits = 300.f;
constexpr float kGridSquareUnits = 4096.f;
constexpr uint32_t kMidIntervalMs = 500;   // 2/s within one grid square
constexpr uint32_t kFarIntervalMs = 2000;  // 0.5/s in the rest of the block
constexpr uint64_t kCombatPinMs = 10000;
constexpr uint64_t kFlushEveryMs = 100;
constexpr uint64_t kWindowMs = 1000;
// About one tier decision per four client packets (130 ms each)
constexpr uint64_t kClassifyMs = 500;
// An entry no classification renewed this long is dropped (the mover stopped or left)
constexpr uint64_t kEntryStaleMs = 3000;
// Much longer than kEntryStaleMs, so no entry still points at a forgotten mover
constexpr uint64_t kEmitterForgetMs = 10000;
// About 32 movers at the clients' 130 ms send rate
constexpr uint32_t kFullSendsPerSecond = 250;
constexpr uint32_t kCoalescedSendsPerSecond = 200;
// Each flush spends an even slice of the per-second budget, so one flush can't take a whole second's worth
constexpr uint32_t kCoalescedPerFlush =
  (kCoalescedSendsPerSecond * kFlushEveryMs + kWindowMs - 1) / kWindowMs;

uint64_t (*g_clockForTest)() = nullptr;

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

void MovementRelay::SetClockForTest(uint64_t (*clock)())
{
  g_clockForTest = clock;
}

uint64_t MovementRelay::NowMs()
{
  if (g_clockForTest) {
    return g_clockForTest();
  }
  return static_cast<uint64_t>(
    std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now().time_since_epoch())
      .count());
}

void MovementRelay::NoteCombat(uint32_t formIdA, uint32_t formIdB)
{
  const uint64_t now = NowMs();
  combat[PairKey(formIdA, formIdB)] = now;
  combatAt[formIdA] = now;
  combatAt[formIdB] = now;
  // Both sides re-sort on their next packet
  for (uint32_t id : { formIdA, formIdB }) {
    auto it = emitters.find(id);
    if (it != emitters.end()) {
      it->second.nextClassifyMs = 0;
    }
  }
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

MovementRelay::ListenerState& MovementRelay::Listener(
  Networking::UserId userId, uint64_t now)
{
  auto& ls = listeners[userId];
  if (ls.fullRadius2 <= 0.f) {
    ls.userId = userId;
    ls.fullRadius2 = kFullRateUnits * kFullRateUnits;
    // Listeners flush on staggered slots, so one tick doesn't carry them all
    ls.nextFlushMs =
      now + (static_cast<uint64_t>(userId) * 37) % kFlushEveryMs;
  }
  return ls;
}

void MovementRelay::RemoveEntry(ListenerState& ls, uint32_t emitterId)
{
  auto it = ls.index.find(emitterId);
  if (it == ls.index.end()) {
    return;
  }
  const uint32_t i = it->second;
  ls.index.erase(it);
  if (i + 1 != ls.coalesced.size()) {
    ls.coalesced[i] = ls.coalesced.back();
    ls.index[ls.coalesced[i].emitterId] = i;
  }
  ls.coalesced.pop_back();
}

void MovementRelay::Submit(MpActor& emitter, Networking::UserId senderUserId,
                           bool skipSender, Networking::PacketData data,
                           size_t length)
{
  TickProfile::Scope profile(TickProfile::kRelaySubmit);
  const uint64_t now = NowMs();
  const uint32_t emitterId = emitter.GetFormId();
  auto& es = emitters[emitterId];
  es.data.assign(data, data + length);
  ++es.seq;
  es.touchedMs = now;

  // A listener set that changed size means someone streamed in or out
  if (now >= es.nextClassifyMs ||
      emitter.GetActorListeners().size() != es.listenerCount) {
    Classify(es, emitter, now);
  }

  for (const auto& f : es.full) {
    if (skipSender && f.userId == senderUserId) {
      continue;
    }
    MpActor* listener = partOne.serverState.ActorByUser(f.userId);
    if (!listener || listener->GetFormId() != f.listenerFormId) {
      continue;
    }
    Send(f.userId, data, length);
    ++Listener(f.userId, now).fullThisWindow;
  }
}

void MovementRelay::Classify(Emitter& es, MpActor& emitter, uint64_t now)
{
  TickProfile::Scope profile(TickProfile::kRelayClassify);
  const uint32_t emitterId = emitter.GetFormId();
  const auto& emitterPos = emitter.GetPos();
  auto combatIt = combatAt.find(emitterId);
  const bool emitterFought =
    combatIt != combatAt.end() && now - combatIt->second < kCombatPinMs;

  const auto& actorListeners = emitter.GetActorListeners();
  es.full.clear();
  es.listenerCount = actorListeners.size();
  // Staggered, so a crowd that arrived together does not re-sort together
  es.nextClassifyMs = now + kClassifyMs - (emitterId * 7) % 50;

  for (auto listener : actorListeners) {
    ++classifyVisits;
    const auto userId = partOne.serverState.UserByActor(listener);
    if (userId == Networking::InvalidUserId) {
      continue;
    }
    auto& ls = Listener(userId, now);
    const float dist2 = (listener->GetPos() - emitterPos).SqrLength();
    const bool full = listener == &emitter || dist2 <= ls.fullRadius2 ||
      (emitterFought && InCombat(listener->GetFormId(), emitterId, now));

    if (full) {
      es.full.push_back({ userId, listener->GetFormId() });
      // A waiting coalesced position would only repeat an older one
      RemoveEntry(ls, emitterId);
      continue;
    }

    const uint32_t interval = dist2 <= kGridSquareUnits * kGridSquareUnits
      ? kMidIntervalMs
      : kFarIntervalMs;
    auto [it, created] = ls.index.try_emplace(
      emitterId, static_cast<uint32_t>(ls.coalesced.size()));
    if (created) {
      Entry e;
      e.emitter = &es;
      e.emitterId = emitterId;
      // Owed the current packet, since a live seq is never 0
      e.sentSeq = 0;
      ls.coalesced.push_back(e);
    }
    auto& e = ls.coalesced[it->second];
    e.emitter = &es;
    e.intervalMs = interval;
    e.seenMs = now;
  }
}

void MovementRelay::RetuneWindow(uint64_t now)
{
  for (auto it = listeners.begin(); it != listeners.end();) {
    auto& ls = it->second;
    // Kept while it hears full-rate movers, or its radius would reset every second in a crowd
    if (ls.coalesced.empty() && ls.fullThisWindow == 0) {
      it = listeners.erase(it);
      continue;
    }
    const float max2 = kFullRateUnits * kFullRateUnits;
    const float min2 = kMinFullRateUnits * kMinFullRateUnits;
    // Shrink fast when over the full-rate allowance, regrow gently while clearly under it. Regrowing only below 60%
    // left a crowd's full tier at ~160 of 250 sends a second (Worker B, 500 crowded): a dense crowd's movers scale with
    // radius squared, so the radius settled at the bottom of the band
    if (ls.fullThisWindow > kFullSendsPerSecond) {
      ls.fullRadius2 = std::max(min2, ls.fullRadius2 * 0.8f);
    } else if (ls.fullThisWindow < kFullSendsPerSecond * 85 / 100) {
      ls.fullRadius2 = std::min(max2, ls.fullRadius2 * 1.1f);
    }
    ls.fullThisWindow = 0;
    ls.coalescedSentThisSecond = 0;
    ++it;
  }
  for (auto it = combat.begin(); it != combat.end();) {
    it = now - it->second > kCombatPinMs ? combat.erase(it) : std::next(it);
  }
  for (auto it = combatAt.begin(); it != combatAt.end();) {
    it = now - it->second > kCombatPinMs ? combatAt.erase(it) : std::next(it);
  }
  // Safe: entries naming these went stale at kEntryStaleMs and were dropped by their listener's flush
  for (auto it = emitters.begin(); it != emitters.end();) {
    it = now - it->second.touchedMs > kEmitterForgetMs ? emitters.erase(it)
                                                       : std::next(it);
  }
}

void MovementRelay::Flush()
{
  TickProfile::Scope profile(TickProfile::kRelayFlush);
  const uint64_t now = NowMs();
  if (now - windowStartMs >= kWindowMs) {
    windowStartMs = now;
    RetuneWindow(now);
  }
  for (auto& [userId, ls] : listeners) {
    if (now < ls.nextFlushMs) {
      continue;
    }
    // Keep the listener's slot; one that fell a whole period behind starts again from now
    ls.nextFlushMs = now - ls.nextFlushMs >= kFlushEveryMs
      ? now + kFlushEveryMs
      : ls.nextFlushMs + kFlushEveryMs;
    FlushListener(ls, now);
  }
}

void MovementRelay::FlushListener(ListenerState& ls, uint64_t now)
{
  // Stale entries go first: removal moves entries, and the due list holds pointers into the vector
  for (size_t i = 0; i < ls.coalesced.size();) {
    if (now - ls.coalesced[i].seenMs > kEntryStaleMs) {
      RemoveEntry(ls, ls.coalesced[i].emitterId); // the last entry moves into i
    } else {
      ++i;
    }
  }

  // Due positions for this listener; when there are more than the budget allows, the ones that waited longest go
  // first, and each one sent goes to the back of the line: round-robin, so a crowd slows everyone instead of freezing
  // a fixed tail
  auto& due = dueScratch;
  due.clear();
  for (auto& e : ls.coalesced) {
    if (e.sentSeq != e.emitter->seq && now - e.lastSentMs >= e.intervalMs) {
      due.push_back(&e);
    }
  }
  if (due.empty()) {
    return;
  }

  const uint32_t left = ls.coalescedSentThisSecond >= kCoalescedSendsPerSecond
    ? 0
    : std::min<uint32_t>(kCoalescedPerFlush,
                         kCoalescedSendsPerSecond - ls.coalescedSentThisSecond);
  if (due.size() > left) {
    std::nth_element(due.begin(), due.begin() + left, due.end(),
                     [](const Entry* a, const Entry* b) {
                       return a->lastSentMs < b->lastSentMs;
                     });
  }
  const size_t sendCount = std::min<size_t>(due.size(), left);
  for (size_t i = 0; i < sendCount; ++i) {
    Entry* e = due[i];
    Send(ls.userId, e->emitter->data.data(), e->emitter->data.size());
    ++ls.coalescedSentThisSecond;
    e->lastSentMs = now;
    e->sentSeq = e->emitter->seq;
  }
}
