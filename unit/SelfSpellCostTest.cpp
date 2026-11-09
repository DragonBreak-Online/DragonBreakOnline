#include "ActionListener.h"
#include "SpellCastMessage.h"
#include "TestUtils.hpp"
#include "libespm/Loader.h"
#include <array>
#include <catch2/catch_all.hpp>
#include <chrono>
#include <cstring>
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

// The player's own self cast of a concentration spell held in the right hand,
// then its stop a moment later
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

  // dunLabyrinthianSpellReward (Equilibrium): restores Magicka, detrimental
  // Health damage, concentration, self
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

  // Healing: RestoreHealthConcSelf, concentration, self; its stop owes the
  // part of a second channelled
  ChannelBriefly(p, 0x012FCC);

  REQUIRE(ac.GetChangeForm().actorValues.healthPercentage > 0.5f);
  REQUIRE(ac.ShouldSkipRestoration(espm::ActorValue::Health));

  Disconnect(p);
}

TEST_CASE(
  "Healing's Respite stamina rider needs the perk, the server skips it",
  "[Restoration]")
{
  PartOne& p = GetPartOne();
  auto& ac = Connect(p);
  ac.SetPercentage(espm::ActorValue::Health, 0.5f);
  ac.SetPercentage(espm::ActorValue::Stamina, 0.25f);

  // Healing: PerkRestoreStaminaConcSelf runs only with HasPerk Respite
  ChannelBriefly(p, 0x012FCC);

  REQUIRE(ac.GetChangeForm().actorValues.healthPercentage > 0.5f);
  REQUIRE(ac.GetChangeForm().actorValues.staminaPercentage ==
          Catch::Approx(0.25f));
  REQUIRE_FALSE(ac.ShouldSkipRestoration(espm::ActorValue::Stamina));

  Disconnect(p);
}

TEST_CASE("A HasPerk == 1 CTDA gates its effect, an OR chain does not",
          "[Restoration]")
{
  // CTDA: operator and flags, value, function 448 (HasPerk)
  auto ctda = [](uint8_t opFlags, float value) {
    std::array<char, 32> d{};
    d[0] = static_cast<char>(opFlags);
    std::memcpy(d.data() + 4, &value, 4);
    const uint16_t fn = 448;
    std::memcpy(d.data() + 8, &fn, 2);
    return d;
  };
  espm::SPEL::Effect held;
  held.NoteCondition(ctda(0x00, 1.f).data(), 32);
  REQUIRE(held.PerkGated());

  espm::SPEL::Effect lacking;
  lacking.NoteCondition(ctda(0x00, 0.f).data(), 32);
  REQUIRE_FALSE(lacking.PerkGated());
  REQUIRE(lacking.hasConditions);

  espm::SPEL::Effect either;
  either.NoteCondition(ctda(0x01, 1.f).data(), 32);
  either.NoteCondition(ctda(0x00, 1.f).data(), 32);
  REQUIRE_FALSE(either.PerkGated());
}
