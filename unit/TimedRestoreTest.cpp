#include "TimedRestore.h"
#include "ActionListener.h"
#include "ChangeValuesMessage.h"
#include "SpellCastMessage.h"
#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>
#include <chrono>
#include <thread>

PartOne& GetPartOne();

using namespace std::chrono_literals;

namespace {
constexpr uint32_t kActor = 0xff000000;
constexpr uint32_t kHealth = static_cast<uint32_t>(espm::ActorValue::Health);

// MGTimeFreezeSpell: self, fire and forget, restore health 10 a second, 10 s
constexpr uint32_t kTimedSelfHeal = 0xEC352;

MpActor& Connect(PartOne& p)
{
  DoConnect(p, 0);
  p.CreateActor(kActor, { 0, 0, 0 }, 0, 0x3c);
  p.SetUserActor(0, kActor);
  return p.worldState.GetFormAt<MpActor>(kActor);
}

void Disconnect(PartOne& p)
{
  p.DestroyActor(kActor);
  DoDisconnect(p, 0);
}

void CastOwn(PartOne& p, uint32_t spellId)
{
  auto& ac = p.worldState.GetFormAt<MpActor>(kActor);
  Equipment eq;
  eq.voiceSpell = spellId;
  ac.SetEquipment(eq);

  RawMessageData rawMsgData;
  rawMsgData.userId = 0;
  SpellCastMessage msg;
  msg.data.caster = 0x14;
  msg.data.target = 0x14;
  msg.data.spell = spellId;
  p.GetActionListener().OnSpellCast(rawMsgData, msg);
}

void ReportHealth(PartOne& p, float health)
{
  RawMessageData rawMsgData;
  rawMsgData.userId = 0;
  ChangeValuesMessage msg;
  msg.idx = std::nullopt;
  msg.data.health = health;
  p.GetActionListener().OnChangeValues(rawMsgData, msg);
}

void SetHealth(MpActor& ac, float health)
{
  ActorValues values = ac.GetActorValues();
  values.healthPercentage = health;
  values.magickaPercentage = 1.f;
  values.staminaPercentage = 1.f;
  ac.SetPercentages(values);
}
}

TEST_CASE("A timed restore allows its points only while it runs",
          "[TimedRestore]")
{
  const auto t0 = TimedRestore::Clock::now();
  TimedRestore::Memory memory;
  memory.Note(1, kHealth, 10.f, 10.f, t0);

  const float slack = TimedRestore::kSlack;
  REQUIRE(memory.Points(kHealth, t0, t0 + 2s) == Catch::Approx(20.f * slack));
  REQUIRE(memory.Points(kHealth + 1, t0, t0 + 2s) == 0.f);
  REQUIRE(memory.Points(kHealth, t0 + 10s + TimedRestore::kGrace, t0 + 20s) ==
          0.f);

  // A recast refreshes, another spell stacks
  memory.Note(1, kHealth, 10.f, 10.f, t0);
  REQUIRE(memory.Points(kHealth, t0, t0 + 1s) == Catch::Approx(10.f * slack));
  memory.Note(2, kHealth, 5.f, 10.f, t0);
  REQUIRE(memory.Points(kHealth, t0, t0 + 1s) == Catch::Approx(15.f * slack));
}

// Remedy Self was applied once and the ceiling took the rest back (31 Oct)
TEST_CASE("The ceiling keeps a timed self heal the client runs",
          "[TimedRestore]")
{
  PartOne& p = GetPartOne();
  auto& ac = Connect(p);
  SetHealth(ac, 0.2f);

  CastOwn(p, kTimedSelfHeal);
  REQUIRE(ac.GetActorValues().healthPercentage == Catch::Approx(0.2f));

  std::this_thread::sleep_for(2s);
  const float maximum =
    ac.GetMaximumValues().GetValue(espm::ActorValue::Health);
  REQUIRE(maximum > 0.f);

  const float twoTicks = 0.2f + 20.f / maximum;
  ReportHealth(p, twoTicks);
  REQUIRE(ac.GetActorValues().healthPercentage ==
          Catch::Approx(twoTicks).margin(0.001));

  // More than the effect gives is still cropped
  SetHealth(ac, 0.2f);
  std::this_thread::sleep_for(1s);
  const float tooMuch = 0.2f + 40.f / maximum;
  ReportHealth(p, tooMuch);
  REQUIRE(ac.GetActorValues().healthPercentage < tooMuch - 0.01f);

  Disconnect(p);
}
