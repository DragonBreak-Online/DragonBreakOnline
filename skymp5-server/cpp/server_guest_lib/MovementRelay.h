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

private:
  struct Pending
  {
    uint64_t lastSentMs = 0;
    uint64_t lastTouchedMs = 0;
    uint32_t intervalMs = 0;
    uint32_t emitterId = 0; // Flush sends this emitter's newest packet (latest)
    Networking::UserId userId = Networking::InvalidUserId;
    bool dirty = false;
    bool queued = false; // in its listener's waiting list
  };

  // An emitter's newest movement packet, stored once and shared by every listener waiting for it. Copying it into each
  // listener's entry was a 100-byte copy per listener per packet (relaySubmit 136 ms/s at 500 crowded, TickProfile)
  struct Latest
  {
    std::vector<unsigned char> data;
    uint64_t touchedMs = 0;
  };

  struct ListenerState
  {
    float fullRadius2 = 0.f;
    uint32_t fullThisWindow = 0;
    uint32_t coalescedSentThisSecond = 0;
    uint64_t nextFlushMs = 0;
    uint32_t pendingCount = 0; // pending entries keyed to this listener
    // The pending entries that may be waiting for this listener. Flush visits only these, not the whole pending map
    // (TickProfile, 500 crowded: scanning the map cost 150-185 ms a second, 50-66 ms per flush). Pointers stay valid
    // because unordered_map never moves its nodes, and an entry is only erased while it is in no list.
    std::vector<Pending*> waiting;
  };

  static uint64_t NowMs();
  bool InCombat(uint32_t a, uint32_t b, uint64_t now) const;
  void Send(Networking::UserId userId, const unsigned char* data,
            size_t length);
  void RetuneWindow(uint64_t now);
  void FlushListener(ListenerState& ls, uint64_t now);
  void PrunePendingSlice(uint64_t now);

  PartOne& partOne;
  std::unordered_map<uint64_t, Pending> pending;      // (listener user << 32) | emitter form id
  std::unordered_map<uint64_t, uint64_t> combat;      // (min form id << 32) | max form id -> last hit ms
  std::unordered_map<uint32_t, uint64_t> combatAt;    // form id -> its last hit ms, so most packets skip the pair lookups
  std::unordered_map<uint32_t, Latest> latest;        // emitter form id -> newest packet
  std::unordered_map<Networking::UserId, ListenerState> listeners;
  std::vector<Pending*> dueScratch;  // reused by FlushListener
  std::vector<uint64_t> pruneScratch; // reused by PrunePendingSlice
  size_t pruneCursor = 0;
  uint64_t windowStartMs = 0;
};
