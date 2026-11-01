#pragma once
#include "NetworkingInterface.h"
#include <cstdint>
#include <unordered_map>
#include <vector>

class PartOne;
class MpActor;

// Interest management for UpdateMovement (server/_reviews/2026-10-18-interest-management.md, CAPACITY_PLAN.md step 1).
// The old relay sent every movement packet to every listener in the 3x3 grid block, so a crowd cost players squared
// (the bot gate failed at 250 on a 35 GB send backlog). Here a listener gets every packet only from the movers that
// matter most to it: inside its full-rate radius (2,000 units, shrunk per listener to keep about 32 movers inside) or
// in combat with it in the last 10 s. Farther movers are coalesced to their newest position and sent at 2/s within one
// grid square and 0.5/s beyond it. Other messages (properties, inventory, casts, animations) never come through here.
// Off unless the environment sets SKYMP_MOVEMENT_RELAY=1, so the default build behaves as before.
// Tiers are decided per mover every kClassifyMs, not per packet: a packet costs one send per full-rate listener.
class MovementRelay
{
public:
  static bool EnabledFromEnv();

  explicit MovementRelay(PartOne& partOne);

  // Relays the emitter's movement packet to its listeners. skipSender: the sending user is not told (hosted NPCs)
  void Submit(MpActor& emitter, Networking::UserId senderUserId,
              bool skipSender, Networking::PacketData data, size_t length);

  // Two actors that just fought see each other at full rate for kCombatPinMs
  void NoteCombat(uint32_t formIdA, uint32_t formIdB);

  // Sends coalesced positions that are due. Called every tick: each listener is flushed every kFlushEveryMs on its own
  // staggered slot, so the work is spread across ticks instead of landing in one
  void Flush();

  // Unit tests drive time with this; nullptr restores the steady clock
  static void SetClockForTest(uint64_t (*clock)());

  // Listener visits made while classifying movers
  uint64_t ClassifyVisits() const { return classifyVisits; }

private:
  struct Emitter
  {
    std::vector<unsigned char> data; // newest packet, stored once
    uint32_t seq = 0;                // a listener is owed a position while its sentSeq differs
    uint64_t touchedMs = 0;
    uint64_t nextClassifyMs = 0;
    size_t listenerCount = 0; // GetActorListeners().size() at the last classification
    struct Full
    {
      Networking::UserId userId;
      uint32_t listenerFormId; // checked at send time, the user may have left since
    };
    std::vector<Full> full;
  };

  struct Entry
  {
    Emitter* emitter = nullptr; // unordered_map nodes never move; freed only after kEmitterForgetMs
    uint32_t emitterId = 0;
    uint32_t sentSeq = 0;
    uint32_t intervalMs = 0;
    uint64_t lastSentMs = 0;
    uint64_t seenMs = 0; // last classification that put the emitter in this tier
  };

  struct ListenerState
  {
    Networking::UserId userId = Networking::InvalidUserId;
    float fullRadius2 = 0.f;
    uint32_t fullThisWindow = 0;
    uint32_t coalescedSentThisSecond = 0;
    uint64_t nextFlushMs = 0;
    std::vector<Entry> coalesced;
    std::unordered_map<uint32_t, uint32_t> index; // emitter form id -> position in coalesced
  };

  static uint64_t NowMs();
  bool InCombat(uint32_t a, uint32_t b, uint64_t now) const;
  void Send(Networking::UserId userId, const unsigned char* data,
            size_t length);
  ListenerState& Listener(Networking::UserId userId, uint64_t now);
  void Classify(Emitter& es, MpActor& emitter, uint64_t now);
  static void RemoveEntry(ListenerState& ls, uint32_t emitterId);
  void RetuneWindow(uint64_t now);
  void FlushListener(ListenerState& ls, uint64_t now);

  PartOne& partOne;
  std::unordered_map<uint32_t, Emitter> emitters;   // emitter form id
  std::unordered_map<uint64_t, uint64_t> combat;    // (min form id << 32) | max form id -> last hit ms
  std::unordered_map<uint32_t, uint64_t> combatAt;  // form id -> its last hit ms, so most classifications skip pairs
  std::unordered_map<Networking::UserId, ListenerState> listeners;
  std::vector<Entry*> dueScratch; // reused by FlushListener
  uint64_t windowStartMs = 0;
  uint64_t classifyVisits = 0;
};
