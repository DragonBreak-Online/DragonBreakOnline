#include "ActionListener.h"
#include "SpellCastMessage.h"
#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>
#include <chrono>
#include <thread>

PartOne& GetPartOne();

namespace {
constexpr uint32_t kActor = 0xff000000;

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

// The player's own self cast of a concentration spell held in the right hand, then its stop a moment later
void ChannelBriefly(PartOne& p, uint32_t spellId)
{
  auto& ac = p.worldState.GetFormAt<MpActor>(kActor);
  Equipment eq;
  eq.rightSpell = spellId;
  ac.SetEquipment(eq);

  RawMessageData rawMsgData;
  rawMsgData.userId = 0;
  SpellCastMessage msg;
  msg.data.caster = 0x14;
  msg.data.target = 0x14;
  msg.data.spell = spellId;
  p.GetActionListener().OnSpellCast(rawMsgData, msg);

  std::this_thread::sleep_for(std::chrono::milliseconds(50));

  msg.data.interruptCast = true;
  p.GetActionListener().OnSpellCast(rawMsgData, msg);
}
}

TEST_CASE("A self spell with a cost on its caster is left to the client",
          "[Restoration]")
{
  PartOne& p = GetPartOne();
  auto& ac = Connect(p);
  ac.SetPercentage(espm::ActorValue::Health, 1.f);
  ac.SetPercentage(espm::ActorValue::Magicka, 0.5f);

  // dunLabyrinthianSpellReward (Equilibrium): restores Magicka, detrimental Health damage, concentration, self
  ChannelBriefly(p, 0x0DA746);

  REQUIRE(ac.GetChangeForm().actorValues.magickaPercentage ==
          Catch::Approx(0.5f));
  REQUIRE_FALSE(ac.ShouldSkipRestoration(espm::ActorValue::Magicka));

  Disconnect(p);
}

TEST_CASE("A self heal still restores on the server", "[Restoration]")
{
  PartOne& p = GetPartOne();
  auto& ac = Connect(p);
  ac.SetPercentage(espm::ActorValue::Health, 0.5f);

  // Healing: RestoreHealthConcSelf, concentration, self; its stop owes the part of a second channelled
  ChannelBriefly(p, 0x012FCC);

  REQUIRE(ac.GetChangeForm().actorValues.healthPercentage > 0.5f);
  REQUIRE(ac.ShouldSkipRestoration(espm::ActorValue::Health));

  Disconnect(p);
}
