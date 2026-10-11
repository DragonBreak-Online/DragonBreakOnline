#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>
#include <algorithm>
#include <chrono>

#include "HitMessage.h"
#include "libespm/Loader.h"

PartOne& GetPartOne();
using namespace std::chrono_literals;

namespace {
// A caster (user 0) and a player (user 1) hosting an NPC beside them
struct SpellSyncScene
{
  static constexpr uint32_t kCaster = 0xff000000;
  static constexpr uint32_t kHost = 0xff000001;
  static constexpr uint32_t kNpc = 0xff000002;

  explicit SpellSyncScene(PartOne& p_)
    : p(p_)
  {
    DoConnect(p, 0);
    DoConnect(p, 1);
    p.CreateActor(kCaster, { 0, 0, 0 }, 0, 0x3c);
    p.CreateActor(kHost, { 0, 100, 0 }, 0, 0x3c);
    p.CreateActor(kNpc, { 100, 0, 0 }, 0, 0x3c);
    p.SetUserActor(0, kCaster);
    p.SetUserActor(1, kHost);
  }
  ~SpellSyncScene()
  {
    p.worldState.hosters.erase(kNpc);
    p.DestroyActor(kCaster);
    p.DestroyActor(kHost);
    p.DestroyActor(kNpc);
    DoDisconnect(p, 0);
    DoDisconnect(p, 1);
  }

  MpActor& Actor(uint32_t formId)
  {
    return p.worldState.GetFormAt<MpActor>(formId);
  }

  // Casts spellId at target from full health and returns the snippets user 1 was sent, by function name
  std::vector<std::string> Hit(uint32_t spellId, uint32_t target)
  {
    p.worldState.hosters[kNpc] = kHost;
    Equipment equipment;
    equipment.leftSpell = spellId;
    Actor(kCaster).SetEquipment(equipment);
    Actor(target).SetPercentages({ 1.f, 1.f, 1.f });
    Actor(kCaster).SetPercentages({ 1.f, 1.f, 1.f });

    RawMessageData rawMsgData;
    rawMsgData.userId = 0;
    HitMessage hit;
    hit.data.aggressor = 0x14;
    hit.data.target = target;
    hit.data.source = spellId;
    p.Messages().clear();
    p.GetActionListener().OnHit(rawMsgData, hit);
    p.Tick();

    std::vector<std::string> functions;
    for (auto& m : p.Messages()) {
      if (m.userId == 1 && m.j["t"] == MsgType::SpSnippet) {
        functions.push_back(m.j["function"].get<std::string>());
      }
    }
    return functions;
  }

  PartOne& p;
};

bool Has(const std::vector<std::string>& functions, const char* function)
{
  return std::find(functions.begin(), functions.end(), function) !=
    functions.end();
}
}

TEST_CASE("An AI spell is replayed on the game hosting the NPC it hit",
          "[SpellSync][espm]")
{
  PartOne& p = GetPartOne();
  constexpr uint32_t kCalm = 0x0004dee9;
  SpellSyncScene scene(p);

  REQUIRE(Has(scene.Hit(kCalm, SpellSyncScene::kNpc), "DoCombatSpellApply"));

  // A player's game would ignore it
  REQUIRE(scene.Hit(kCalm, SpellSyncScene::kHost).empty());

  p.worldState.spellSync.riders = false;
  REQUIRE(scene.Hit(kCalm, SpellSyncScene::kNpc).empty());
  p.worldState.spellSync.riders = true;
}

TEST_CASE("A damaging spell's slow and stagger reach the NPC's host without "
          "the spell, so its damage does not land twice",
          "[SpellSync][espm]")
{
  PartOne& p = GetPartOne();
  // Ice Spike: frost damage, an unconditional slow, perk riders with conditions
  constexpr uint32_t kIceSpike = 0x0002b96c;
  // Spectral Arrow: damage and an unconditional stagger
  constexpr uint32_t kSpectralArrow = 0x000ab23d;
  SpellSyncScene scene(p);

  auto iceSpike = scene.Hit(kIceSpike, SpellSyncScene::kNpc);
  REQUIRE(!Has(iceSpike, "DoCombatSpellApply"));
  REQUIRE(!Has(iceSpike, "SendAnimationEvent"));
  REQUIRE(std::count(iceSpike.begin(), iceSpike.end(), "ModActorValue") == 3);
  REQUIRE(scene.Actor(SpellSyncScene::kNpc)
            .GetChangeForm()
            .actorValues.healthPercentage < 1.f);

  // A second hit while slowed only extends the slow
  REQUIRE(!Has(scene.Hit(kIceSpike, SpellSyncScene::kNpc), "ModActorValue"));

  auto arrow = scene.Hit(kSpectralArrow, SpellSyncScene::kNpc);
  REQUIRE(Has(arrow, "SendAnimationEvent"));
  REQUIRE(!Has(arrow, "DoCombatSpellApply"));

  // Players get these through the clone replay
  REQUIRE(scene.Hit(kSpectralArrow, SpellSyncScene::kHost).empty());
}
