#include "TestUtils.hpp"

#include "ActionListener.h"
#include "MovementRelay.h"
#include <cstdlib>

// MovementRelay (interest management for UpdateMovement), driven through PartOne with a fake clock. Each test turns the
// relay on for itself and off again, so the rest of the suite keeps the default SendToNeighbours path.
namespace {
uint64_t g_nowMs = 1'000'000;
uint64_t FakeNow()
{
  return g_nowMs;
}

struct RelayOn
{
  RelayOn()
  {
#ifdef _WIN32
    _putenv_s("SKYMP_MOVEMENT_RELAY", "1");
#else
    setenv("SKYMP_MOVEMENT_RELAY", "1", 1);
#endif
    g_nowMs = 1'000'000;
    MovementRelay::SetClockForTest(&FakeNow);
  }
  ~RelayOn()
  {
#ifdef _WIN32
    _putenv_s("SKYMP_MOVEMENT_RELAY", "");
#else
    unsetenv("SKYMP_MOVEMENT_RELAY");
#endif
    MovementRelay::SetClockForTest(nullptr);
  }
};

constexpr uint32_t kEmitter = 0xff000100;

// A player actor for user `user` standing at pos
void AddPlayer(PartOne& partOne, Networking::UserId user, uint32_t formId,
               NiPoint3 pos)
{
  DoConnect(partOne, user);
  partOne.CreateActor(formId, pos, 0.f, 0x3c);
  partOne.SetUserActor(user, formId);
}

// The emitter (user 0) moves to x along the x axis
void Move(PartOne& partOne, float x)
{
  auto m = jMovement;
  m["idx"] = dynamic_cast<MpActor*>(
               partOne.worldState.LookupFormById(kEmitter).get())
               ->GetIdx();
  m["data"]["pos"] = { x, 0.f, 0.f };
  DoMessage(partOne, 0, m);
}

// UpdateMovement packets user `user` received
std::vector<nlohmann::json> MovementsTo(PartOne& partOne,
                                        Networking::UserId user)
{
  std::vector<nlohmann::json> res;
  for (auto& m : partOne.Messages()) {
    if (m.userId == user && m.j.is_object() &&
        m.j.value("t", -1) == static_cast<int>(MsgType::UpdateMovement)) {
      res.push_back(m.j);
    }
  }
  return res;
}

void Tick(PartOne& partOne, uint64_t ms)
{
  for (uint64_t t = 0; t < ms; t += 10) {
    g_nowMs += 10;
    partOne.GetActionListener().TickMovementRelay();
  }
}
}

TEST_CASE("MovementRelay: a near listener hears every packet, and the mover "
          "hears its own",
          "[MovementRelay]")
{
  RelayOn on;
  PartOne partOne;
  AddPlayer(partOne, 0, kEmitter, { 0, 0, 0 });
  AddPlayer(partOne, 1, 0xff000101, { 500, 0, 0 });
  partOne.Messages().clear();

  for (int i = 0; i < 10; ++i) {
    Move(partOne, static_cast<float>(i));
    g_nowMs += 130;
  }
  REQUIRE(MovementsTo(partOne, 1).size() == 10);
  REQUIRE(MovementsTo(partOne, 0).size() == 10);
}

TEST_CASE("MovementRelay: a far listener gets only the newest position, at "
          "its tier's rate",
          "[MovementRelay]")
{
  RelayOn on;
  PartOne partOne;
  AddPlayer(partOne, 0, kEmitter, { 0, 0, 0 });
  AddPlayer(partOne, 1, 0xff000101, { 3000, 0, 0 }); // beyond 2,000, inside one grid square: 2/s
  partOne.Messages().clear();

  // 2 s of movement at the clients' 130 ms rate, ticking the relay in between
  for (int i = 0; i < 16; ++i) {
    Move(partOne, static_cast<float>(i));
    Tick(partOne, 130);
  }
  auto got = MovementsTo(partOne, 1);
  REQUIRE(got.size() >= 3);
  REQUIRE(got.size() <= 5);
  // Never a stale position: every packet sent was the emitter's newest at the time, and the positions only grow
  for (size_t i = 1; i < got.size(); ++i) {
    REQUIRE(got[i]["data"]["pos"][0].get<float>() >
            got[i - 1]["data"]["pos"][0].get<float>());
  }

  // Once the mover stops, the listener is owed nothing more
  const auto before = MovementsTo(partOne, 1).size();
  Tick(partOne, 3000);
  const auto after = MovementsTo(partOne, 1).size();
  REQUIRE(after - before <= 1); // at most the last position, if it was still waiting
}

TEST_CASE("MovementRelay: a mover's listeners are not walked on every packet",
          "[MovementRelay]")
{
  RelayOn on;
  PartOne partOne;
  AddPlayer(partOne, 0, kEmitter, { 0, 0, 0 });
  // 30 listeners, all in the coalesced tier
  for (Networking::UserId u = 1; u <= 30; ++u) {
    AddPlayer(partOne, u, 0xff000200 + u, { 3000.f, 10.f * u, 0 });
  }
  Move(partOne, 0);
  const auto* relay = partOne.GetActionListener().GetMovementRelay();
  REQUIRE(relay);
  const uint64_t afterFirst = relay->ClassifyVisits();
  REQUIRE(afterFirst >= 30);

  // Three more packets inside one classification period: no listener walk
  for (int i = 1; i <= 3; ++i) {
    g_nowMs += 100;
    Move(partOne, static_cast<float>(i));
  }
  REQUIRE(relay->ClassifyVisits() == afterFirst);

  // After the period, one walk
  g_nowMs += 600;
  Move(partOne, 5);
  REQUIRE(relay->ClassifyVisits() > afterFirst);
  REQUIRE(relay->ClassifyVisits() <= afterFirst * 2 + 2);
}

TEST_CASE("MovementRelay: a listener that streams in hears the next packet",
          "[MovementRelay]")
{
  RelayOn on;
  PartOne partOne;
  AddPlayer(partOne, 0, kEmitter, { 0, 0, 0 });
  AddPlayer(partOne, 1, 0xff000101, { 500, 0, 0 });
  Move(partOne, 0);
  g_nowMs += 50;

  // Inside the classification period a newcomer arrives next to the mover
  AddPlayer(partOne, 2, 0xff000102, { 400, 0, 0 });
  partOne.Messages().clear();
  g_nowMs += 50;
  Move(partOne, 1);
  REQUIRE(MovementsTo(partOne, 2).size() == 1);
}

TEST_CASE("MovementRelay: a disconnected listener is not sent to",
          "[MovementRelay]")
{
  RelayOn on;
  PartOne partOne;
  AddPlayer(partOne, 0, kEmitter, { 0, 0, 0 });
  AddPlayer(partOne, 1, 0xff000101, { 500, 0, 0 });
  AddPlayer(partOne, 2, 0xff000102, { 600, 0, 0 });
  Move(partOne, 0);
  g_nowMs += 50;

  DoDisconnect(partOne, 1);
  partOne.Messages().clear();
  g_nowMs += 50;
  Move(partOne, 1);
  Tick(partOne, 1000);
  REQUIRE(MovementsTo(partOne, 1).empty());
  REQUIRE(MovementsTo(partOne, 2).size() == 1);
}

TEST_CASE("MovementRelay: two actors that fought hear each other at full "
          "rate, however far",
          "[MovementRelay]")
{
  RelayOn on;
  PartOne partOne;
  AddPlayer(partOne, 0, kEmitter, { 0, 0, 0 });
  AddPlayer(partOne, 1, 0xff000101, { 3000, 0, 0 });
  Move(partOne, 0);

  auto* relay = const_cast<MovementRelay*>(
    partOne.GetActionListener().GetMovementRelay());
  REQUIRE(relay);
  relay->NoteCombat(kEmitter, 0xff000101);
  partOne.Messages().clear();

  for (int i = 1; i <= 8; ++i) {
    g_nowMs += 130;
    Move(partOne, static_cast<float>(i));
  }
  REQUIRE(MovementsTo(partOne, 1).size() == 8);
}

TEST_CASE("MovementRelay: off unless SKYMP_MOVEMENT_RELAY=1",
          "[MovementRelay]")
{
  PartOne partOne;
  AddPlayer(partOne, 0, kEmitter, { 0, 0, 0 });
  AddPlayer(partOne, 1, 0xff000101, { 3000, 0, 0 });
  Move(partOne, 0);
  REQUIRE(partOne.GetActionListener().GetMovementRelay() == nullptr);
}
