#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>
#include <algorithm>
#include <chrono>
#include <thread>

#include "ActionListener.h"
#include "HitMessage.h"
#include "formulas/TES5DamageFormula.h"
#include "libespm/Loader.h"
#include "script_storages/DirectoryScriptStorage.h"
#include <optional>

PartOne& GetPartOne();
espm::Loader& GetEspmLoader();
using namespace std::chrono_literals;

namespace {
nlohmann::json MakeCast(uint32_t spell)
{
  return nlohmann::json{
    { "t", MsgType::SpellCast },
    { "data",
      { { "caster", 0x14 },
        { "target", 0x14 },
        { "spell", spell },
        { "isDualCasting", false },
        { "interruptCast", false },
        { "castingSource", 0 },
        { "aimAngle", 0.f },
        { "aimHeading", 0.f },
        { "actorAnimationVariables",
          { { "booleans", nlohmann::json::array() },
            { "floats", nlohmann::json::array() },
            { "integers", nlohmann::json::array() } } },
        { "keepAlive", false } } }
  };
}

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

  // Holds staffId and hits target with its enchantment, after the staff's volley interval; returns user 1's snippets
  std::vector<nlohmann::json> StaffHit(uint32_t staffId,
                                       uint32_t enchantmentId, uint32_t target)
  {
    std::this_thread::sleep_for(ActionListener::kStaffVolleyInterval + 50ms);
    p.worldState.hosters[kNpc] = kHost;
    Inventory::ExtraData worn;
    worn.worn_ = true;
    Actor(kCaster).AddItem(staffId, 1);
    Equipment equipment;
    equipment.inv.entries.push_back(Inventory::Entry(staffId, 1, worn));
    Actor(kCaster).SetEquipment(equipment);
    Actor(target).SetPercentages({ 1.f, 1.f, 1.f });

    RawMessageData rawMsgData;
    rawMsgData.userId = 0;
    HitMessage hit;
    hit.data.aggressor = 0x14;
    hit.data.target = target;
    hit.data.source = enchantmentId;
    // Host effects of earlier hits on these ids end first
    p.Tick();
    p.Messages().clear();
    p.GetActionListener().OnHit(rawMsgData, hit);
    p.Tick();

    std::vector<nlohmann::json> snippets;
    for (auto& m : p.Messages()) {
      if (m.userId == 1 && m.j["t"] == MsgType::SpSnippet) {
        snippets.push_back(m.j);
      }
    }
    return snippets;
  }

  // Casts spellId (unless cast is false) and hits target from full health; returns the snippets user 1 was sent
  std::vector<std::string> Hit(uint32_t spellId, uint32_t target,
                               float casterHealth = 1.f, bool cast = true)
  {
    p.worldState.hosters[kNpc] = kHost;
    Equipment equipment;
    equipment.leftSpell = spellId;
    Actor(kCaster).SetEquipment(equipment);
    Actor(target).SetPercentages({ 1.f, 1.f, 1.f });
    Actor(kCaster).SetPercentages({ casterHealth, 1.f, 1.f });

    RawMessageData rawMsgData;
    rawMsgData.userId = 0;
    HitMessage hit;
    hit.data.aggressor = 0x14;
    hit.data.target = target;
    hit.data.source = spellId;
    if (cast) {
      DoMessage(p, 0, MakeCast(spellId));
    }
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

// The snippet of function in snippets, or null
const nlohmann::json* Find(const std::vector<nlohmann::json>& snippets,
                           const char* function)
{
  for (const auto& snippet : snippets) {
    if (snippet["function"] == function) {
      return &snippet;
    }
  }
  return nullptr;
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
  REQUIRE(std::count(iceSpike.begin(), iceSpike.end(), "DamageActorValue") ==
          1);
  REQUIRE(std::count(iceSpike.begin(), iceSpike.end(), "ModActorValue") == 2);
  REQUIRE(scene.Actor(SpellSyncScene::kNpc)
            .GetChangeForm()
            .actorValues.healthPercentage < 1.f);

  // A second hit this soon sends nothing
  REQUIRE(!Has(scene.Hit(kIceSpike, SpellSyncScene::kNpc), "DamageActorValue"));

  // A new host takes the running slow
  p.Messages().clear();
  p.AssignHoster(SpellSyncScene::kNpc, SpellSyncScene::kCaster);
  p.Tick();
  REQUIRE(std::any_of(
    p.Messages().begin(), p.Messages().end(), [](PartOne::Message& m) {
      return m.userId == 0 && m.j["t"] == MsgType::SpSnippet &&
        m.j["function"] == "DamageActorValue";
    }));

  auto arrow = scene.Hit(kSpectralArrow, SpellSyncScene::kNpc);
  REQUIRE(Has(arrow, "SendAnimationEvent"));
  REQUIRE(!Has(arrow, "DoCombatSpellApply"));

  // Players get these through the clone replay
  REQUIRE(scene.Hit(kSpectralArrow, SpellSyncScene::kHost).empty());
}

TEST_CASE("Absorb Health restores the caster by what the target lost",
          "[SpellSync][espm]")
{
  PartOne& p = GetPartOne();
  // CrVampireDrain01: crVampireAbsorbHealthConcAimed 5
  constexpr uint32_t kVampireDrain = 0x000f5b58;
  SpellSyncScene scene(p);
  auto health = [&](uint32_t formId) {
    return scene.Actor(formId).GetChangeForm().actorValues.healthPercentage;
  };

  scene.Hit(kVampireDrain, SpellSyncScene::kNpc, 0.5f);
  const float lost = 1.f - health(SpellSyncScene::kNpc);
  REQUIRE(lost > 0.f);
  // Both actors share a base, so the same share of health moves across
  REQUIRE_THAT(health(SpellSyncScene::kCaster),
               Catch::Matchers::WithinAbs(0.5f + lost, 0.0001f));

  // A full caster stays full
  scene.Hit(kVampireDrain, SpellSyncScene::kNpc, 1.f);
  REQUIRE(health(SpellSyncScene::kCaster) == 1.f);

  p.worldState.spellSync.absorb = false;
  scene.Hit(kVampireDrain, SpellSyncScene::kNpc, 0.5f);
  REQUIRE(health(SpellSyncScene::kCaster) == 0.5f);
  p.worldState.spellSync.absorb = true;
}

TEST_CASE("A rune explosion's paralysis holds an NPC on the server and its "
          "host",
          "[SpellSync][espm]")
{
  PartOne& p = GetPartOne();
  // Dragonborn.esm Ash Rune: its paralysis is on the projectile's explosion's enchantment
  constexpr uint32_t kAshRune = 0x040177af;
  SpellSyncScene scene(p);

  p.worldState.spellSync.explosionRiders = false;
  REQUIRE(scene.Hit(kAshRune, SpellSyncScene::kNpc).empty());
  p.worldState.spellSync.explosionRiders = true;

  // The gamemode's dboParalyse holds a player
  REQUIRE(scene.Hit(kAshRune, SpellSyncScene::kHost).empty());

  auto functions = scene.Hit(kAshRune, SpellSyncScene::kNpc);
  REQUIRE(Has(functions, "SetDontMove"));
  REQUIRE(!Has(functions, "DoCombatSpellApply"));

  // Held: a second rune while it lasts sends nothing
  REQUIRE(scene.Hit(kAshRune, SpellSyncScene::kNpc).empty());
}

TEST_CASE("Spell riders need a recent cast of the spell and land once a "
          "second per target",
          "[SpellSync][espm]")
{
  PartOne& p = GetPartOne();
  constexpr uint32_t kCalm = 0x0004dee9;
  SpellSyncScene scene(p);

  // A hit packet with no cast behind it
  REQUIRE(scene.Hit(kCalm, SpellSyncScene::kNpc, 1.f, false).empty());

  REQUIRE(Has(scene.Hit(kCalm, SpellSyncScene::kNpc), "DoCombatSpellApply"));
  // Replayed hit packets within the interval
  REQUIRE(scene.Hit(kCalm, SpellSyncScene::kNpc, 1.f, false).empty());
  REQUIRE(scene.Hit(kCalm, SpellSyncScene::kNpc).empty());
}

TEST_CASE("A player gets a spell's stagger from the clone replay, not a "
          "second time from the server",
          "[SpellSync][espm]")
{
  PartOne& p = GetPartOne();
  // Turn Lesser Undead: Turn Undead and a stagger push, no damage
  constexpr uint32_t kTurnLesserUndead = 0x0004b146;
  SpellSyncScene scene(p);

  REQUIRE(scene.Hit(kTurnLesserUndead, SpellSyncScene::kHost).empty());
  REQUIRE(Has(scene.Hit(kTurnLesserUndead, SpellSyncScene::kNpc),
              "DoCombatSpellApply"));
}

TEST_CASE("A staff's paralysis holds an NPC on the server and its host, and "
          "leaves players to the gamemode",
          "[SpellSync][espm]")
{
  PartOne& p = GetPartOne();
  constexpr uint32_t kStaffOfParalysis = 0x00029b73;
  // StaffEnchParalyze: ParalysisFFAimed 10 s, StaggerPushFFAimed
  constexpr uint32_t kParalyzeEnchantment = 0x00029b4a;
  SpellSyncScene scene(p);

  // The gamemode's dboParalyse holds a player
  REQUIRE(
    scene
      .StaffHit(kStaffOfParalysis, kParalyzeEnchantment, SpellSyncScene::kHost)
      .empty());

  auto snippets = scene.StaffHit(kStaffOfParalysis, kParalyzeEnchantment,
                                 SpellSyncScene::kNpc);
  REQUIRE(Find(snippets, "SetDontMove"));
  REQUIRE(!Find(snippets, "DoCombatSpellApply"));

  // Held: a second hit while it lasts sends nothing
  std::this_thread::sleep_for(ActionListener::kRiderHitInterval);
  REQUIRE(
    scene
      .StaffHit(kStaffOfParalysis, kParalyzeEnchantment, SpellSyncScene::kNpc)
      .empty());
}

TEST_CASE("A staff's AI riders replay on the NPC's host as a spell carrying "
          "the same effects",
          "[SpellSync][espm]")
{
  PartOne& p = GetPartOne();
  constexpr uint32_t kStaffOfCalm = 0x00029b8b;
  // StaffEnchCalm: InfluenceAggDownFFAimed 8, which VampireCharm carries at 8
  constexpr uint32_t kCalmEnchantment = 0x000b62e1;
  constexpr uint32_t kVampireCharm = 0x000c4de2;
  constexpr uint32_t kStaffOfTurnUndead = 0x00029b95;
  constexpr uint32_t kTurnUndeadEnchantment = 0x00029b96;
  // StaffEnchTurnUndead: TurnUndeadFFAimed50 8; TurnUndead carries it at 13, RepelLesserUndead Turn Undead at 8
  constexpr uint32_t kRepelLesserUndead = 0x0004d3f8;
  // StaffEnchFrenzy: Frenzy 8; the Frenzy spell is 14, Fury 6
  constexpr uint32_t kStaffOfFrenzy = 0x00029b8f;
  constexpr uint32_t kFrenzyEnchantment = 0x00029b65;
  constexpr uint32_t kFury = 0x0004deeb;
  SpellSyncScene scene(p);

  auto replayedAs = [&](uint32_t staff, uint32_t enchantment) -> uint32_t {
    const auto snippets =
      scene.StaffHit(staff, enchantment, SpellSyncScene::kNpc);
    const auto* replay = Find(snippets, "DoCombatSpellApply");
    return replay ? (*replay)["arguments"][0]["formId"].get<uint32_t>() : 0;
  };
  REQUIRE(replayedAs(kStaffOfCalm, kCalmEnchantment) == kVampireCharm);
  // The closest at or below the staff's magnitude
  REQUIRE(replayedAs(kStaffOfTurnUndead, kTurnUndeadEnchantment) ==
          kRepelLesserUndead);
  REQUIRE(replayedAs(kStaffOfFrenzy, kFrenzyEnchantment) == kFury);

  // A player's game would ignore it
  std::this_thread::sleep_for(ActionListener::kRiderHitInterval);
  REQUIRE(scene.StaffHit(kStaffOfCalm, kCalmEnchantment, SpellSyncScene::kHost)
            .empty());

  p.worldState.spellSync.riders = false;
  REQUIRE(scene.StaffHit(kStaffOfCalm, kCalmEnchantment, SpellSyncScene::kNpc)
            .empty());
  p.worldState.spellSync.riders = true;

  // Without the staff the hit and its riders are refused
  std::this_thread::sleep_for(ActionListener::kRiderHitInterval);
  scene.Actor(SpellSyncScene::kCaster).SetEquipment(Equipment());
  RawMessageData rawMsgData;
  rawMsgData.userId = 0;
  HitMessage hit;
  hit.data.aggressor = 0x14;
  hit.data.target = SpellSyncScene::kNpc;
  hit.data.source = kCalmEnchantment;
  p.Messages().clear();
  p.GetActionListener().OnHit(rawMsgData, hit);
  REQUIRE(std::none_of(p.Messages().begin(), p.Messages().end(),
                       [](PartOne::Message& m) {
                         return m.j["t"] == MsgType::SpSnippet &&
                           m.j["function"] == "DoCombatSpellApply";
                       }));
}

TEST_CASE("A damaging staff's slow reaches the NPC's host on its own",
          "[SpellSync][espm]")
{
  PartOne& p = GetPartOne();
  constexpr uint32_t kStaffOfIceStorm = 0x00029b83;
  // StaffEnchIceStorm: frost damage 40, FrostSlowFFAimed 50 for 5 s
  constexpr uint32_t kIceStormEnchantment = 0x00029b5a;
  SpellSyncScene scene(p);

  auto snippets = scene.StaffHit(kStaffOfIceStorm, kIceStormEnchantment,
                                 SpellSyncScene::kNpc);
  REQUIRE(Find(snippets, "DamageActorValue"));
  REQUIRE(!Find(snippets, "DoCombatSpellApply"));
  REQUIRE(scene.Actor(SpellSyncScene::kNpc)
            .GetChangeForm()
            .actorValues.healthPercentage < 1.f);
}

// A static keyed by WorldState* gave the next WorldState at that address the first one's index, into a freed espm
TEST_CASE("A WorldState at a reused address builds its own staff stand-in "
          "index",
          "[SpellSync][espm]")
{
  constexpr uint32_t kStaffOfCalm = 0x00029b8b;
  constexpr uint32_t kCalmEnchantment = 0x000b62e1;
  constexpr uint32_t kVampireCharm = 0x000c4de2;
  constexpr uint32_t kStaffOfFrenzy = 0x00029b8f;
  constexpr uint32_t kFrenzyEnchantment = 0x00029b65;
  constexpr uint32_t kFury = 0x0004deeb;

  auto replayedAs = [](PartOne& p, uint32_t staff,
                       uint32_t enchantment) -> uint32_t {
    SpellSyncScene scene(p);
    const auto snippets =
      scene.StaffHit(staff, enchantment, SpellSyncScene::kNpc);
    const auto* replay = Find(snippets, "DoCombatSpellApply");
    return replay ? (*replay)["arguments"][0]["formId"].get<uint32_t>() : 0;
  };
  auto attach = [](PartOne& p, espm::Loader& loader) {
    p.SetDamageFormula(std::make_unique<TES5DamageFormula>());
    p.worldState.AttachScriptStorage(
      std::make_shared<DirectoryScriptStorage>(TEST_PEX_DIR));
    p.AttachEspm(&loader);
    p.worldState.bannedEspmCharacterRaceIds.clear();
  };

  // One storage, so both WorldStates live at the same address
  std::optional<PartOne> partOne;
  {
    espm::Loader skyrimOnly(GetDataDir(), { "Skyrim.esm" });
    partOne.emplace();
    attach(*partOne, skyrimOnly);
    REQUIRE(replayedAs(*partOne, kStaffOfCalm, kCalmEnchantment) ==
            kVampireCharm);
    partOne.reset();
  }

  partOne.emplace();
  attach(*partOne, GetEspmLoader());
  REQUIRE(replayedAs(*partOne, kStaffOfFrenzy, kFrenzyEnchantment) == kFury);
  partOne.reset();
}
