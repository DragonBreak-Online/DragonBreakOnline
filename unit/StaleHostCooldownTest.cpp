#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>
#include <chrono>
#include <thread>

PartOne& GetPartOne();

// PartOne::TickStaleHosts takes an NPC from its hoster after staleHostAfter with no movement, so a client that
// unloaded an NPC stops holding it frozen for everyone. An NPC that is deliberately standing still never moves
// either, so before the cooldown below it was taken away again every staleHostAfter for as long as it stood
// there, and each release set its host to 0 and made every nearby client ask for it at once: 4.7 releases a
// minute at Nat's Bruma event against 0.1 quiet, which with 65-92 clients is the 441.8 host attempts and 306.9
// "not a hoster" errors a minute in _work\perf-1031\NOTE.md.
//
// The first release of an NPC stays immediate, so the frozen-NPC case this sweep exists for is still rescued at
// once. Only the second and later releases of the SAME NPC wait staleReleaseCooldown.
//
// Uses the shared GetPartOne(): a bare PartOne has no espm attached and CreateActor throws "No espm attached".
// The timings are PartOne members so this runs in milliseconds, and Timings restores them in its destructor so
// a REQUIRE that aborts a test cannot leave the shared instance set to milliseconds for everything after it.
// The sweep needs two passes to release: the first stamps hostSeenSince for a hoster with no movement stamp
// yet, the second sees the age.

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

struct Timings
{
  PartOne& p;
  std::chrono::milliseconds after, cooldown, sweep;
  Timings(PartOne& p_, std::chrono::milliseconds cool)
    : p(p_)
    , after(p_.staleHostAfter)
    , cooldown(p_.staleReleaseCooldown)
    , sweep(p_.staleHostSweepEvery)
  {
    p.staleHostAfter = std::chrono::milliseconds(40);
    p.staleHostSweepEvery = std::chrono::milliseconds(1);
    p.staleReleaseCooldown = cool;
  }
  ~Timings()
  {
    p.staleHostAfter = after;
    p.staleReleaseCooldown = cooldown;
    p.staleHostSweepEvery = sweep;
  }
};

// A player hosting an NPC beside it
void Setup(PartOne& p)
{
  DoConnect(p, 0);
  p.CreateActor(kPlayer, { 0.f, 0.f, 0.f }, 0.f, 0x3c);
  p.SetUserActor(0, kPlayer);
  p.CreateActor(kNpc, { 100.f, 0.f, 0.f }, 0.f, 0x3c);
  DoMessage(p, 0, HostAttempt(kNpc));
  REQUIRE(HosterOf(p, kNpc) == kPlayer);
}

void Teardown(PartOne& p)
{
  p.DestroyActor(kNpc);
  p.DestroyActor(kPlayer);
  DoDisconnect(p, 0);
}

// Two sweeps far enough apart that an unmoving NPC is old enough on the second
void SweepPastStale(PartOne& p)
{
  p.Tick();
  std::this_thread::sleep_for(p.staleHostAfter + std::chrono::milliseconds(25));
  p.Tick();
}

}

TEST_CASE("A standing NPC is taken from its hoster once, not every few seconds",
          "[PartOne][Host][StaleHost][espm]")
{
  PartOne& p = GetPartOne();
  Timings t(p, std::chrono::milliseconds(600));
  Setup(p);

  // first time: released at once, exactly as before the cooldown existed
  SweepPastStale(p);
  REQUIRE(HosterOf(p, kNpc) == 0);

  // the same client takes it again and it goes on standing still
  DoMessage(p, 0, HostAttempt(kNpc));
  REQUIRE(HosterOf(p, kNpc) == kPlayer);

  // old enough to release again, but inside the cooldown: it must KEEP its hoster.
  // This is the assertion that fails without the cooldown, where it would be 0 again.
  SweepPastStale(p);
  REQUIRE(HosterOf(p, kNpc) == kPlayer);

  // ...and again, so the loop really is stopped rather than merely delayed by one pass
  SweepPastStale(p);
  REQUIRE(HosterOf(p, kNpc) == kPlayer);

  // once the cooldown is over it may be released again
  std::this_thread::sleep_for(p.staleReleaseCooldown);
  SweepPastStale(p);
  REQUIRE(HosterOf(p, kNpc) == 0);

  Teardown(p);
}

TEST_CASE("The first release is immediate however long the cooldown is",
          "[PartOne][Host][StaleHost][espm]")
{
  PartOne& p = GetPartOne();
  // an hour: if the cooldown were applied to the first release, this would never free the NPC and the
  // frozen-NPC case the sweep exists for would be broken
  Timings t(p, std::chrono::hours(1));
  Setup(p);

  SweepPastStale(p);
  REQUIRE(HosterOf(p, kNpc) == 0);

  Teardown(p);
}

// NOT covered here: that a MOVING NPC is never taken from its hoster. It is true and it matters, but it is the
// sweep's pre-existing behaviour rather than anything this change touches, it passes without the cooldown
// either way, and driving it needs a hand-built UpdateMovement message that no other unit test sends, so a
// wrong field set would fail for a reason that has nothing to do with the cooldown. The movement path is
// covered live by the npcDrift "moved" field instead.

TEST_CASE("Destroying an NPC forgets its stale-release record",
          "[PartOne][Host][StaleHost][espm]")
{
  PartOne& p = GetPartOne();
  Timings t(p, std::chrono::hours(1));
  Setup(p);

  SweepPastStale(p);
  REQUIRE(HosterOf(p, kNpc) == 0);

  // the record would otherwise outlive the NPC and silence the first release of whatever reuses its id
  p.DestroyActor(kNpc);
  p.CreateActor(kNpc, { 100.f, 0.f, 0.f }, 0.f, 0x3c);
  DoMessage(p, 0, HostAttempt(kNpc));
  REQUIRE(HosterOf(p, kNpc) == kPlayer);

  SweepPastStale(p);
  REQUIRE(HosterOf(p, kNpc) == 0);

  Teardown(p);
}
