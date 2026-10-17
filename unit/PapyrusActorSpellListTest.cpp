#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>

#include "libespm/Loader.h"
#include "script_classes/PapyrusActor.h"
#include "script_objects/EspmGameObject.h"
#include <algorithm>
#include <chrono>
#include <iostream>
#include <set>

PartOne& GetPartOne();

// Reading a character's spell list (Actor.GetSpellCount, then GetNthSpell for
// each index) evaluated the base spells once per learned spell per call, so a
// character given every spell (331) froze the server for ~4.5 s per read
// (17 Oct). These tests pin the list's contents and its cost.

namespace {
constexpr uint32_t kBretonRace = 0x00013741;
constexpr uint32_t kNordRace = 0x00013746;
constexpr uint32_t kPlayerBase = 0x00000007;

void SetRace(MpActor& actor, uint32_t raceId)
{
  Appearance appearance;
  appearance.raceId = raceId;
  actor.SetAppearance(&appearance);
}

std::set<uint32_t> RaceSpells(WorldState& worldState, uint32_t raceId)
{
  const auto race = worldState.GetEspm().GetBrowser().LookupById(raceId);
  REQUIRE(race.rec);
  std::set<uint32_t> res;
  for (uint32_t raw : espm::GetData<espm::RACE>(raceId, &worldState).spells) {
    res.insert(race.ToGlobalId(raw));
  }
  return res;
}

// The Player NPC_ record's castable spells (Flames, Healing)
std::vector<uint32_t> PlayerCastableSpells(WorldState& worldState)
{
  auto& browser = worldState.GetEspm().GetBrowser();
  const auto npc = browser.LookupById(kPlayerBase);
  REQUIRE(npc.rec);
  std::vector<uint32_t> res;
  for (uint32_t raw :
       espm::GetData<espm::NPC_>(kPlayerBase, &worldState).spells) {
    const uint32_t spellId = npc.ToGlobalId(raw);
    const auto spell = browser.LookupById(spellId);
    if (!spell.rec || spell.rec->GetType() != espm::SPEL::kType) {
      continue;
    }
    const auto data = espm::GetData<espm::SPEL>(spellId, &worldState);
    if (data.spellItem &&
        data.spellItem->type == espm::SPEL::SpellType::Spell) {
      res.push_back(spellId);
    }
  }
  return res;
}

// The first n Skyrim.esm SPEL records the actor does not get from its records
std::vector<uint32_t> NonBaseSpells(WorldState& worldState,
                                    const MpActor& actor, size_t n)
{
  auto& browser = worldState.GetEspm().GetBrowser();
  const auto base = actor.GetBaseSpells();
  std::vector<uint32_t> res;
  for (uint32_t id = 0x800; id < 0x01000000 && res.size() < n; ++id) {
    const auto lookup = browser.LookupById(id);
    if (lookup.rec && lookup.rec->GetType() == espm::SPEL::kType &&
        std::find(base.begin(), base.end(), id) == base.end()) {
      res.push_back(id);
    }
  }
  REQUIRE(res.size() == n);
  return res;
}

// What the gamemode's learnedIds does
std::vector<uint32_t> ReadSpellList(MpActor& actor)
{
  PapyrusActor papyrusActor;
  const int count =
    static_cast<int>(papyrusActor.GetSpellCount(actor.ToVarValue(), {}));
  std::vector<uint32_t> res;
  for (int i = 0; i < count; ++i) {
    const VarValue spell =
      papyrusActor.GetNthSpell(actor.ToVarValue(), { VarValue(i) });
    REQUIRE(spell != VarValue::None());
    const auto& record = GetRecordPtr(spell);
    REQUIRE(record.rec);
    res.push_back(record.ToGlobalId(record.rec->GetId()));
  }
  return res;
}

int SpellCount(MpActor& actor)
{
  return static_cast<int>(
    PapyrusActor().GetSpellCount(actor.ToVarValue(), {}));
}
}

TEST_CASE("GetSpellCount and GetNthSpell list only the spells learned "
          "during gameplay",
          "[Papyrus][Actor][espm]")
{
  PartOne& p = GetPartOne();
  const uint32_t formId = p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  auto& actor = p.worldState.GetFormAt<MpActor>(formId);
  SetRace(actor, kBretonRace);

  const auto base = actor.GetBaseSpells();
  REQUIRE(!base.empty());
  for (uint32_t raceSpell : RaceSpells(p.worldState, kBretonRace)) {
    REQUIRE(actor.IsSpellLearnedFromBase(raceSpell));
  }

  // A base spell saved in the learned list too stays out of the list
  const auto learned = NonBaseSpells(p.worldState, actor, 3);
  actor.AddSpell(base.front());
  for (uint32_t spellId : learned) {
    actor.AddSpell(spellId);
  }

  REQUIRE(SpellCount(actor) == 3);
  REQUIRE(ReadSpellList(actor) == learned); // ascending form id order
  PapyrusActor papyrusActor;
  REQUIRE(papyrusActor.GetNthSpell(actor.ToVarValue(), { VarValue(3) }) ==
          VarValue::None());
  REQUIRE(papyrusActor.GetNthSpell(actor.ToVarValue(), { VarValue(-1) }) ==
          VarValue::None());

  // A spell learned or forgotten later shows at once
  actor.RemoveSpell(learned[1]);
  REQUIRE(ReadSpellList(actor) ==
          std::vector<uint32_t>{ learned[0], learned[2] });

  p.DestroyActor(formId);
}

TEST_CASE("The base spells follow a race change", "[Papyrus][Actor][espm]")
{
  PartOne& p = GetPartOne();
  const uint32_t formId = p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  auto& actor = p.worldState.GetFormAt<MpActor>(formId);

  const auto breton = RaceSpells(p.worldState, kBretonRace);
  const auto nord = RaceSpells(p.worldState, kNordRace);
  std::vector<uint32_t> bretonOnly, nordOnly;
  std::set_difference(breton.begin(), breton.end(), nord.begin(), nord.end(),
                      std::back_inserter(bretonOnly));
  std::set_difference(nord.begin(), nord.end(), breton.begin(), breton.end(),
                      std::back_inserter(nordOnly));
  REQUIRE(!bretonOnly.empty());
  REQUIRE(!nordOnly.empty());

  // Both races' spells saved as learned: only the other race's count
  for (uint32_t spellId : bretonOnly) {
    actor.AddSpell(spellId);
  }
  for (uint32_t spellId : nordOnly) {
    actor.AddSpell(spellId);
  }

  SetRace(actor, kBretonRace);
  REQUIRE(actor.IsSpellLearnedFromBase(bretonOnly[0]));
  REQUIRE(!actor.IsSpellLearnedFromBase(nordOnly[0]));
  REQUIRE(SpellCount(actor) == static_cast<int>(nordOnly.size()));

  SetRace(actor, kNordRace);
  REQUIRE(!actor.IsSpellLearnedFromBase(bretonOnly[0]));
  REQUIRE(actor.IsSpellLearnedFromBase(nordOnly[0]));
  REQUIRE(SpellCount(actor) == static_cast<int>(bretonOnly.size()));
  auto base = actor.GetBaseSpells();
  REQUIRE(std::find(base.begin(), base.end(), nordOnly[0]) != base.end());
  REQUIRE(std::find(base.begin(), base.end(), bretonOnly[0]) == base.end());

  SetRace(actor, kBretonRace);
  REQUIRE(SpellCount(actor) == static_cast<int>(nordOnly.size()));

  p.DestroyActor(formId);
}

TEST_CASE("The base spells follow playersInheritBaseSpells",
          "[Papyrus][Actor][espm]")
{
  PartOne& p = GetPartOne();
  const uint32_t formId =
    p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c, /*profileId*/ 1);
  auto& actor = p.worldState.GetFormAt<MpActor>(formId);
  SetRace(actor, kBretonRace);

  const auto castable = PlayerCastableSpells(p.worldState);
  REQUIRE(!castable.empty());
  actor.AddSpell(castable[0]);

  p.worldState.SetPlayersInheritBaseSpells(true);
  REQUIRE(actor.IsSpellLearnedFromBase(castable[0]));
  const int inherited = SpellCount(actor);

  // Players stop inheriting castable spells: the saved one is theirs now
  p.worldState.SetPlayersInheritBaseSpells(false);
  REQUIRE(!actor.IsSpellLearnedFromBase(castable[0]));
  REQUIRE(SpellCount(actor) == inherited + 1);

  p.worldState.SetPlayersInheritBaseSpells(true);
  REQUIRE(SpellCount(actor) == inherited);

  p.DestroyActor(formId);
}

TEST_CASE("Reading a list of 331 learned spells stays fast",
          "[Papyrus][Actor][espm]")
{
  PartOne& p = GetPartOne();
  const uint32_t formId = p.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  auto& actor = p.worldState.GetFormAt<MpActor>(formId);
  SetRace(actor, kBretonRace);

  constexpr size_t kSpells = 331;
  const auto learned = NonBaseSpells(p.worldState, actor, kSpells);
  for (uint32_t spellId : learned) {
    actor.AddSpell(spellId);
  }

  const auto start = std::chrono::steady_clock::now();
  const auto list = ReadSpellList(actor);
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::steady_clock::now() - start)
                    .count();
  std::cout << "Spell list read of " << kSpells << " spells took " << ms
            << " ms" << std::endl;

  REQUIRE(list == learned);
  // Evaluating the base spells per spell took seconds here
  REQUIRE(ms < 500);

  p.DestroyActor(formId);
}
