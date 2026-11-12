#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>

PartOne& GetPartOne();

// MpObjectReference::ForceSubscriptionsUpdate keeps the hoster of a World
// Director event's hostile subscribed once the grid stops calling them
// neighbours, so a fast flyer stops losing its hoster every few seconds.
//
// Why it has to be the subscription and not the host entry: Unsubscribe runs
// the unsubscribe callback, which sends that client DestroyActor, and a client
// that has destroyed the actor cannot drive it - keeping the host entry while
// letting the subscription go is what leaves an NPC frozen for everyone until
// the stale sweep. So these tests are about who is still a LISTENER, and the
// host entry is checked after a Tick as the consequence of that.
//
// Nat's dragon changed hoster 6 times in 61 s and T-posed throughout (11 Nov,
// ev=d62): at ~850 units/s it crossed a 4096-unit grid cell about every five
// seconds, the holder was unsubscribed, PartOne::TickHostReleases freed the
// host, and the next claim started over.
//
// Shares GetPartOne() with every other case here, so it creates its own ids
// well away from the 0xff0000xx range the other tests use, and destroys them
// again. It asserts about the player ref specifically and never about the size
// of the listener set, which other cases' leftovers can change.

namespace {

constexpr uint32_t kPlayer = 0xff00e000;
constexpr uint32_t kNpc = 0xff00e001;

// The grid is 4096-unit cells and the neighbourhood is the 3x3 block around
// one (MpObjectReference::GridPosOf, Grid::IsNeighbours), so two cells out is
// past it and the ordinary rules drop the listener.
constexpr float kCell = 4096.f;

uint32_t HosterOf(PartOne& p, uint32_t npc)
{
  auto it = p.worldState.hosters.find(npc);
  return it == p.worldState.hosters.end() ? 0xffffffff : it->second;
}

bool HosterStillListens(PartOne& p)
{
  auto& npc = p.worldState.GetFormAt<MpObjectReference>(kNpc);
  auto& player = p.worldState.GetFormAt<MpObjectReference>(kPlayer);
  return npc.GetListeners().count(&player) > 0;
}

nlohmann::json HostAttempt(uint32_t remoteId)
{
  return nlohmann::json{ { "t", MsgType::Host }, { "remoteId", remoteId } };
}

void MoveNpcTo(PartOne& p, float x)
{
  p.worldState.GetFormAt<MpObjectReference>(kNpc).SetPos({ x, 0.f, 0.f });
}

// A connected player at the origin hosting an NPC that starts beside it, both
// in the same cell of the same worldspace
void Setup(PartOne& p, bool markAsEventHostile)
{
  DoConnect(p, 0);
  p.CreateActor(kPlayer, { 0.f, 0.f, 0.f }, 0.f, 0x3c);
  p.SetUserActor(0, kPlayer);
  // CreateActor does not put an actor on the grid, and nothing is subscribed
  // to anything until both sides are on it. The user's first movement update
  // does that for its own actor; the NPC needs a SetPos of its own, which
  // registers it through the !everSubscribedOrListened branch in SetPos -
  // the same reason ObjectReferenceTest writes ref.SetPos(ref.GetPos()).
  // Player first, so that by the time the NPC's update runs it finds the
  // player as a neighbour and subscribes the pair in both directions.
  DoUpdateMovement(p, kPlayer, 0);
  p.CreateActor(kNpc, { 100.f, 0.f, 0.f }, 0.f, 0x3c);
  MoveNpcTo(p, 100.f);
  if (markAsEventHostile) {
    auto& npc = p.worldState.GetFormAt<MpActor>(kNpc);
    npc.SetPropertyValueDump("private.dboEventHoster", "true", false, false);
  }
  DoMessage(p, 0, HostAttempt(kNpc));
  REQUIRE(HosterOf(p, kNpc) == kPlayer);
  REQUIRE(HosterStillListens(p));
}

void Teardown(PartOne& p)
{
  p.DestroyActor(kNpc);
  p.DestroyActor(kPlayer);
  DoDisconnect(p, 0);
}

}

TEST_CASE("An unmarked NPC loses its hoster when it leaves the grid block",
          "[PartOne][Host][EventHoster][espm]")
{
  auto& p = GetPartOne();
  Setup(p, false);

  // Two cells out: past the 3x3, so the ordinary rules unsubscribe the hoster
  MoveNpcTo(p, 2.f * kCell);
  REQUIRE_FALSE(HosterStillListens(p));

  // and the queued release then frees the host, which is the churn Nat saw
  p.Tick();
  REQUIRE(HosterOf(p, kNpc) == 0);

  Teardown(p);
}

TEST_CASE("An event hostile keeps the hoster that is driving it",
          "[PartOne][Host][EventHoster][espm]")
{
  auto& p = GetPartOne();
  Setup(p, true);

  // The same move that drops an unmarked NPC's hoster above
  MoveNpcTo(p, 2.f * kCell);
  REQUIRE(HosterStillListens(p));

  // so nothing is queued to release, and it still has its hoster after a Tick
  p.Tick();
  REQUIRE(HosterOf(p, kNpc) == kPlayer);

  // and it survives crossing cell after cell, which is the case that churned:
  // every crossing re-runs subscription
  for (int cells = 3; cells >= 1; --cells) {
    MoveNpcTo(p, static_cast<float>(cells) * kCell);
    p.Tick();
    REQUIRE(HosterStillListens(p));
    REQUIRE(HosterOf(p, kNpc) == kPlayer);
  }

  Teardown(p);
}

TEST_CASE("The hoster may be the one that moved, and still keeps it",
          "[PartOne][Host][EventHoster][espm]")
{
  auto& p = GetPartOne();
  Setup(p, true);

  // The other side of the same geometry: the player flies out and the NPC
  // stands still, so it is the PLAYER's ForceSubscriptionsUpdate that runs,
  // with the NPC in its toRemove. Unsubscribe(emitter, listener) erases
  // listener from emitter->listeners, so the pass the loop makes as
  // Unsubscribe(npc, player) is the one that takes the hoster out of the
  // NPC's listeners, queues a pendingHostRelease and sends that client
  // DestroyActor. Guarding only the marked actor's own update leaves this
  // half of the cases - and a flying player is most of them.
  p.worldState.GetFormAt<MpObjectReference>(kPlayer).SetPos(
    { 2.f * kCell, 0.f, 0.f });
  REQUIRE(HosterStillListens(p));
  p.Tick();
  REQUIRE(HosterOf(p, kNpc) == kPlayer);

  Teardown(p);
}

TEST_CASE("The keep-alive is bounded: far enough out it still hands off",
          "[PartOne][Host][EventHoster][espm]")
{
  auto& p = GetPartOne();
  Setup(p, true);

  // Inside kEventHosterKeepCells (3) it is held
  MoveNpcTo(p, 3.f * kCell);
  REQUIRE(HosterStillListens(p));

  // Past it the hoster goes, so a player who leaves the fight is not held to
  // an actor for ever
  MoveNpcTo(p, 5.f * kCell);
  REQUIRE_FALSE(HosterStillListens(p));
  p.Tick();
  REQUIRE(HosterOf(p, kNpc) == 0);

  Teardown(p);
}

TEST_CASE("An event hostile with no hoster keeps nobody",
          "[PartOne][Host][EventHoster][espm]")
{
  auto& p = GetPartOne();
  DoConnect(p, 0);
  p.CreateActor(kPlayer, { 0.f, 0.f, 0.f }, 0.f, 0x3c);
  p.SetUserActor(0, kPlayer);
  DoUpdateMovement(p, kPlayer, 0);
  p.CreateActor(kNpc, { 100.f, 0.f, 0.f }, 0.f, 0x3c);
  MoveNpcTo(p, 100.f);
  auto& npc = p.worldState.GetFormAt<MpActor>(kNpc);
  npc.SetPropertyValueDump("private.dboEventHoster", "true", false, false);
  // deliberately no Host message: nothing hosts it
  REQUIRE(HosterStillListens(p));

  MoveNpcTo(p, 2.f * kCell);
  REQUIRE_FALSE(HosterStillListens(p));

  Teardown(p);
}

TEST_CASE("The marker is read as a value, so \"false\" and null keep nobody",
          "[PartOne][Host][EventHoster][espm]")
{
  auto& p = GetPartOne();

  for (const char* dump : { "false", "null", "\"true\"" }) {
    Setup(p, false);
    auto& npc = p.worldState.GetFormAt<MpActor>(kNpc);
    npc.SetPropertyValueDump("private.dboEventHoster", dump, false, false);

    // Only the JSON true marks an event hostile; a string "true" is not it
    MoveNpcTo(p, 2.f * kCell);
    REQUIRE_FALSE(HosterStillListens(p));

    Teardown(p);
  }
}
