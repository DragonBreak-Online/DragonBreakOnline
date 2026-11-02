#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>
#include <chrono>
#include <thread>

PartOne& GetPartOne();

// An NPC the SERVER drives itself (Option B phase 1,
// _work\server-npc-movement-1102.md). The gameplay layer tags it with
// private.dboServerHost - serverhostpin.js today, the mover later - and three
// things must follow:
//
//   1. a host attempt for it is refused, however long it has been silent. The
//      ordinary rule grants any asker after 2 s without movement, and a
//      server-driven NPC is silent by that measure for ever, because its
//      movement never comes from a client at all;
//   2. the stale sweep leaves it alone. Releasing it would set its host to 0
//      and have every nearby client ask for it at once, which is the churn the
//      sweep's own cooldown exists to stop;
//   3. clients are told isHostedByOther, so they do not claim it on sight.
//      formView.ts's first re-host trigger has no clock: an actor not marked
//      hosted-by-other is asked for the moment it is seen. Without this the
//      refusal still holds, but every watcher asks and is refused, for each of
//      them, for as long as it is in view.
//
// And the NPC next to it, untagged, must behave exactly as before - which is
// the half that would make this a regression rather than a feature if it were
// wrong.
//
// Uses the shared GetPartOne(): a bare PartOne has no espm attached and
// CreateActor throws "No espm attached". Timings are PartOne members, set to
// milliseconds here and restored in the destructor so a REQUIRE that aborts
// cannot leave the shared instance in test timings for everything after it.
// staleHostSweepEvery is 0, not 1 ms, for the reason StaleHostCooldownTest.cpp
// gives at length: a 1 ms interval can swallow the first Tick of a pair, and
// the sweep then only stamps hostSeenSince without ever seeing an age.

namespace {

uint32_t HosterOf(PartOne& p, uint32_t npc)
{
  auto it = p.worldState.hosters.find(npc);
  return it == p.worldState.hosters.end() ? 0xffffffff : it->second;
}

nlohmann::json HostAttempt(uint32_t remoteId)
{
  return nlohmann::json{ { "t", MsgType::Host }, { "remoteId", remoteId } };
}

constexpr uint32_t kPlayer = 0xff000000;
constexpr uint32_t kNpc = 0xff000001;
constexpr uint32_t kPlain = 0xff000002;

struct Timings
{
  PartOne& p;
  std::chrono::milliseconds after, cooldown, sweep, exemptFor;
  float exemptRange;
  explicit Timings(PartOne& p_)
    : p(p_)
    , after(p_.staleHostAfter)
    , cooldown(p_.staleReleaseCooldown)
    , sweep(p_.staleHostSweepEvery)
    , exemptFor(p_.staleExemptFor)
    , exemptRange(p_.staleExemptRange)
  {
    p.staleHostAfter = std::chrono::milliseconds(40);
    p.staleHostSweepEvery = std::chrono::milliseconds(0); // every Tick sweeps
    p.staleReleaseCooldown = std::chrono::milliseconds(0);
    // The hoster-in-reach exemption is off, or it would keep the plain NPC too
    // and the contrast would prove nothing: this test is about the
    // server-driven skip, not about W5's reach rule
    p.staleExemptRange = 0.f;
  }
  ~Timings()
  {
    p.staleHostAfter = after;
    p.staleReleaseCooldown = cooldown;
    p.staleHostSweepEvery = sweep;
    p.staleExemptRange = exemptRange;
    p.staleExemptFor = exemptFor;
  }
};

MpObjectReference& Ref(PartOne& p, uint32_t id)
{
  return p.worldState.GetFormAt<MpObjectReference>(id);
}

// The tag as the gameplay layer writes it: mp.set(id, "private.dboServerHost",
// true) arrives as the JSON dump "true". Clearing it writes an empty dump,
// which is how the property API spells "no value".
void MarkServerDriven(PartOne& p, uint32_t id, bool on)
{
  Ref(p, id).SetPropertyValueDump(PartOne::GetServerDrivenProperty(),
                                  on ? "true" : "", false, false);
}

// Two sweeps far enough apart that an unmoving NPC is old enough on the second
void SweepPastStale(PartOne& p)
{
  p.Tick();
  std::this_thread::sleep_for(p.staleHostAfter +
                              std::chrono::milliseconds(25));
  p.Tick();
}

}

TEST_CASE("A server-driven NPC is never handed to a client, and its neighbour "
          "still is",
          "[PartOne][Host][ServerDriven][espm]")
{
  PartOne& p = GetPartOne();
  Timings timings(p);

  DoConnect(p, 0);
  p.CreateActor(kPlayer, { 0.f, 0.f, 0.f }, 0.f, 0x3c);
  p.SetUserActor(0, kPlayer);
  p.CreateActor(kNpc, { 100.f, 0.f, 0.f }, 0.f, 0x3c);
  p.CreateActor(kPlain, { 200.f, 0.f, 0.f }, 0.f, 0x3c);

  REQUIRE_FALSE(PartOne::IsServerDriven(Ref(p, kNpc)));
  MarkServerDriven(p, kNpc, true);
  REQUIRE(PartOne::IsServerDriven(Ref(p, kNpc)));
  REQUIRE_FALSE(PartOne::IsServerDriven(Ref(p, kPlain)));

  // (1) the attempt is refused. A fresh NPC has no movement stamp, which is
  // the case the ordinary rule grants on - so this is an attempt that would
  // otherwise have succeeded
  DoMessage(p, 0, HostAttempt(kNpc));
  // no entry at all: nobody was ever assigned
  REQUIRE(HosterOf(p, kNpc) == 0xffffffff);

  // the untagged one is granted, on the same silence, by the same ask
  DoMessage(p, 0, HostAttempt(kPlain));
  REQUIRE(HosterOf(p, kPlain) == kPlayer);

  // (2) the stale sweep takes the plain NPC and leaves the tagged one. Give
  // the tagged NPC a hoster the way the gamemode can (mp.setHoster), so there
  // is something for the sweep to take if it fails to skip it
  p.AssignHoster(kNpc, kPlayer);
  REQUIRE(HosterOf(p, kNpc) == kPlayer);
  SweepPastStale(p);
  REQUIRE(HosterOf(p, kNpc) == kPlayer); // still held: skipped, not released
  REQUIRE(HosterOf(p, kPlain) == 0);     // released for silence, as before

  // and it stays held however many sweeps pass, because it is silent for ever
  // by this measure
  SweepPastStale(p);
  SweepPastStale(p);
  REQUIRE(HosterOf(p, kNpc) == kPlayer);

  // (3) clearing the tag puts it back under the ordinary rules, so the tag is
  // the whole of the behaviour and nothing has been latched on the side
  MarkServerDriven(p, kNpc, false);
  REQUIRE_FALSE(PartOne::IsServerDriven(Ref(p, kNpc)));
  SweepPastStale(p);
  REQUIRE(HosterOf(p, kNpc) == 0);

  p.DestroyActor(kPlain);
  p.DestroyActor(kNpc);
  p.DestroyActor(kPlayer);
  DoDisconnect(p, 0);
}

TEST_CASE("A watcher is told a server-driven NPC is hosted by someone else",
          "[PartOne][Host][ServerDriven][espm]")
{
  PartOne& p = GetPartOne();

  // Both NPCs exist and the tag is set BEFORE the player's actor does, so the
  // CreateActor messages the player is sent on SetUserActor describe them with
  // the tag already in place. That is the moment the client learns
  // isHostedByOther, and the moment formView.ts decides whether to claim the
  // actor on sight.
  p.CreateActor(kNpc, { 100.f, 0.f, 0.f }, 0.f, 0x3c);
  p.CreateActor(kPlain, { 200.f, 0.f, 0.f }, 0.f, 0x3c);
  MarkServerDriven(p, kNpc, true);
  REQUIRE(PartOne::IsServerDriven(Ref(p, kNpc)));

  DoConnect(p, 0);
  p.CreateActor(kPlayer, { 0.f, 0.f, 0.f }, 0.f, 0x3c);
  p.SetUserActor(0, kPlayer);

  auto driven = FindRefrMessage<CreateActorMessage>(p, kNpc);
  auto plain = FindRefrMessage<CreateActorMessage>(p, kPlain);
  // If neither NPC was described to this player the case proves nothing, so
  // say so rather than pass
  REQUIRE(driven.filteredMessages.size() >= 1);
  REQUIRE(plain.filteredMessages.size() >= 1);

  // The point of this case: the server-driven one arrives marked hosted, so
  // the client never asks for it
  REQUIRE(driven.filteredMessages.back().props.isHostedByOther == true);
  // ...and the plain one does not, so an ordinary NPC is still free to be
  // claimed
  REQUIRE_FALSE(plain.filteredMessages.back().props.isHostedByOther == true);

  p.DestroyActor(kPlain);
  p.DestroyActor(kNpc);
  p.DestroyActor(kPlayer);
  DoDisconnect(p, 0);
}
