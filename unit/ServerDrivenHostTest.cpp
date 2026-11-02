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
  // The player must be SUBSCRIBED to the NPC to be told anything about it, and
  // a test never subscribes anyone - RespawnTest.cpp carries the same line and
  // the same comment for the same reason. Without this, GetActorListeners() is
  // empty, UpdateHoster's loop has nobody to send to, and the assertions below
  // fail against working code (which is exactly what they did on W5's first
  // build, 2 Nov).
  Ref(p, kNpc).ForceSubscriptionsUpdate();

  p.Messages().clear();
  p.AssignHoster(kNpc, kPlayer);
  REQUIRE(HosterOf(p, kNpc) == kPlayer);

  // A hoster change tells every watching player whether the server drives it,
  // beside isHostedByOther and in the same loop, so the two can never disagree
  // - which is the whole reason the flag is a property and does not travel in
  // the movement data. Both messages must be there for this one hand-over.
  {
    // UpdatePropertyMessage carries the value as dataDump, a STRING holding
    // the JSON dump - not a bool field. So the server's `true` arrives as the
    // four characters "true", the spelling the change-form tag uses too.
    bool sawDriven = false, sawHosted = false;
    for (auto& m : p.Messages()) {
      const auto propName = m.j.value("propName", std::string());
      if (propName == "isServerDriven") {
        sawDriven = m.j.value("dataDump", std::string()) == "true";
      }
      if (propName == "isHostedByOther") {
        sawHosted = true;
      }
    }
    REQUIRE(sawDriven);
    REQUIRE(sawHosted);
  }
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

// PartOne::SendServerMovement is the primitive the gameplay layer calls to
// move an NPC the server drives. What must hold, and why each one is here
// rather than taken on trust:
//
//   - a subscribed player is sent the movement, with the NPC's own idx and the
//     position asked for. That is the whole point;
//   - the SERVER's copy moves too. Without it, zone membership, the director's
//     distances and reach checks on a blow landed against this NPC would all
//     still see it at its spawn point while clients watched it walk away;
//   - the cell on the wire is the ACTOR's. There is no cell parameter at all,
//     because an NPC's cell is not updated by movement and an update that
//     disagrees with it is dropped, after which every hit on it is refused;
//   - an NPC that is not tagged server-driven is refused. That guard is what
//     makes this safe to hand to hot-reloadable JS: a typo in a module must
//     not be able to drive an NPC a client is hosting;
//   - lastMovUpdateByIdx is NOT stamped. It is the "a client's movement was
//     accepted" clock and there is no client here. TickStaleHosts skips
//     server-driven NPCs outright, so nothing needs it - and stamping it would
//     quietly make the stale sweep's own exemption untestable.
TEST_CASE("The server moves an NPC it drives, and only one it drives",
          "[PartOne][Host][ServerDriven][ServerMovement][espm]")
{
  PartOne& p = GetPartOne();

  p.CreateActor(kNpc, { 100.f, 0.f, 0.f }, 0.f, 0x3c);
  p.CreateActor(kPlain, { 200.f, 0.f, 0.f }, 0.f, 0x3c);
  MarkServerDriven(p, kNpc, true);

  DoConnect(p, 0);
  p.CreateActor(kPlayer, { 0.f, 0.f, 0.f }, 0.f, 0x3c);
  p.SetUserActor(0, kPlayer);
  // Subscribed, or there is nobody to send to - see the note in the case above
  Ref(p, kNpc).ForceSubscriptionsUpdate();

  // An NPC that is not server-driven is refused, so a gameplay typo cannot
  // drive one a client is hosting
  UpdateMovementMessage::Data plain;
  plain.pos = { 201.f, 0.f, 0.f };
  REQUIRE_THROWS(p.SendServerMovement(kPlain, plain));

  const auto cellBefore = Ref(p, kNpc).GetCellOrWorld();
  const auto idx = Ref(p, kNpc).GetIdx();

  p.Messages().clear();
  UpdateMovementMessage::Data data;
  data.pos = { 150.f, 25.f, 8420.f };
  data.rot = { 0.f, 0.f, 90.f };
  data.speed = 80.f;
  data.runMode = "Walking";
  // Deliberately filled with a cell the caller would like: it must be ignored
  data.worldOrCell = 0xdeadbeef;
  p.SendServerMovement(kNpc, data);

  const UpdateMovementMessage* sent = nullptr;
  for (auto& m : p.Messages()) {
    if (auto* mv = dynamic_cast<UpdateMovementMessage*>(m.message.get())) {
      if (mv->idx == idx) {
        sent = mv;
      }
    }
  }
  REQUIRE(sent);
  REQUIRE(sent->data.pos[0] == 150.f);
  REQUIRE(sent->data.pos[1] == 25.f);
  REQUIRE(sent->data.pos[2] == 8420.f);
  REQUIRE(sent->data.rot[2] == 90.f);
  REQUIRE(sent->data.speed == 80.f);
  REQUIRE(sent->data.runMode == "Walking");
  // The caller's 0xdeadbeef is gone: the cell is the actor's own
  REQUIRE(sent->data.worldOrCell ==
          cellBefore.ToFormId(p.worldState.espmFiles));
  REQUIRE(sent->data.worldOrCell != 0xdeadbeef);

  // The server's own copy moved, and its cell did not
  REQUIRE(Ref(p, kNpc).GetPos() == NiPoint3{ 150.f, 25.f, 8420.f });
  REQUIRE(Ref(p, kNpc).GetAngle() == NiPoint3{ 0.f, 0.f, 90.f });
  REQUIRE(Ref(p, kNpc).GetCellOrWorld() == cellBefore);

  // Not stamped: there is no client movement here
  const auto i = static_cast<size_t>(idx);
  const bool stamped = p.worldState.lastMovUpdateByIdx.size() > i &&
    p.worldState.lastMovUpdateByIdx[i].has_value();
  REQUIRE_FALSE(stamped);

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

  // SetUserActor sends the player its OWN CreateActor and nothing else -
  // PartOne_ActorTest's "SetUserActor" asserts Messages().size() == 1. A
  // neighbour is described only once the player is subscribed to it, which a
  // test has to force (see RespawnTest.cpp). Clearing first so the messages
  // read below are the subscription's, not the player's own.
  p.Messages().clear();
  Ref(p, kNpc).ForceSubscriptionsUpdate();
  Ref(p, kPlain).ForceSubscriptionsUpdate();

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

  // isHostedByOther alone is not enough - a client that asks anyway is only
  // refused, and the client wants to know not to ask - so isServerDriven rides
  // as a custom prop. A client that arrives AFTER the flag was set hears it
  // only from CreateActor, which is what this half covers (W1, 2 Nov). It is a
  // custom prop and not a props field because the wire is positional.
  const auto hasDrivenProp = [](const CreateActorMessage& m) {
    for (auto& e : m.customPropsJsonDumps) {
      if (e.propName == "isServerDriven") {
        return e.propValueJsonDump == "true";
      }
    }
    return false;
  };
  REQUIRE(hasDrivenProp(driven.filteredMessages.back()));
  // ...and an ordinary NPC carries no such prop at all, rather than carrying
  // it as false: nothing should have to parse it to learn there is nothing
  REQUIRE_FALSE(hasDrivenProp(plain.filteredMessages.back()));

  p.DestroyActor(kPlain);
  p.DestroyActor(kNpc);
  p.DestroyActor(kPlayer);
  DoDisconnect(p, 0);
}
