#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>

#include "ActionListener.h"
#include "HitMessage.h"
#include "RawMessageData.h"

PartOne& GetPartOne();

TEST_CASE("A dragon's breath leaves burning ground that hits with its "
          "hazard's spell, for a caster whose spell list has the shout",
          "[Hit][DragonHazard]")
{
  PartOne& p = GetPartOne();
  constexpr uint32_t kPlayer = 0xff000000;
  constexpr uint32_t kFireDragon = 0xff000001;
  constexpr uint32_t kFrostDragon = 0xff000002;
  constexpr uint32_t kAtronach = 0xff000003;
  // EncDragon03FireNoScript: DragonFireBreathShout03, its word's impact set
  // MAGDragonFireImpactSet -> FireDragonHazard -> HazardFireDragonSpell
  constexpr uint32_t kFireDragonBase = 0x000fea9b;
  constexpr uint32_t kHazardFireDragon = 0x0002acd5;
  // EncDragon03FrostNoScript: DragonFrostIceStormShout03 -> IceHazard01
  constexpr uint32_t kFrostDragonBase = 0x000f8119;
  constexpr uint32_t kHazardIce = 0x0003e07d;
  constexpr uint32_t kFlameAtronach = 0x000204c0;

  DoConnect(p, 0);
  p.CreateActor(kPlayer, { 0, 0, 0 }, 0, 0x3c, 1);
  p.SetUserActor(0, kPlayer);
  p.worldState.GetFormAt<MpActor>(kPlayer).SetEquipment(Equipment());
  auto addNpc = [&](uint32_t id, uint32_t baseId) {
    const LocationalData location = { { 0, 100, 0 },
                                      { 0, 0, 0 },
                                      FormDesc::FromFormId(
                                        0x3c, p.worldState.espmFiles) };
    p.worldState.AddForm(
      std::make_unique<MpActor>(location, FormCallbacks::DoNothing(), baseId),
      id);
    p.worldState.GetFormAt<MpActor>(id).SetEquipment(Equipment());
    p.worldState.hosters[id] = kPlayer;
  };
  addNpc(kFireDragon, kFireDragonBase);
  addNpc(kFrostDragon, kFrostDragonBase);
  addNpc(kAtronach, kFlameAtronach);

  // Health one hit on the player takes, 0 when refused
  auto hit = [&](uint32_t aggressor, uint32_t source) {
    auto& actor = p.worldState.GetFormAt<MpActor>(kPlayer);
    actor.SetPercentages({ 1.f, 1.f, 1.f });
    RawMessageData rawMsgData;
    rawMsgData.userId = 0;
    HitMessage hitMsg;
    hitMsg.data.aggressor = aggressor;
    hitMsg.data.target = 0x14;
    hitMsg.data.source = source;
    p.GetActionListener().OnHit(rawMsgData, hitMsg);
    return 1.f - actor.GetChangeForm().actorValues.healthPercentage;
  };

  REQUIRE(hit(kFireDragon, kHazardFireDragon) > 0.f);
  REQUIRE(hit(kFrostDragon, kHazardIce) > 0.f);
  // Another dragon's ground, or a caster with no breath shout, stays refused
  REQUIRE(hit(kFrostDragon, kHazardFireDragon) == Catch::Approx(0.f));
  REQUIRE(hit(kAtronach, kHazardFireDragon) == Catch::Approx(0.f));

  for (uint32_t id : { kFireDragon, kFrostDragon, kAtronach }) {
    p.worldState.hosters.erase(id);
    p.DestroyActor(id);
  }
  p.DestroyActor(kPlayer);
  DoDisconnect(p, 0);
}
