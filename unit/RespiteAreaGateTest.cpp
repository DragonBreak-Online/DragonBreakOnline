#include "ActionListener.h"
#include "HitMessage.h"
#include "TestUtils.hpp"
#include "libespm/Loader.h"
#include <catch2/catch_all.hpp>

PartOne& GetPartOne();

// Grand Healing is a self-delivery area spell, so its restorative effects
// spread from the caster to everyone the area reaches (ActionListener's
// OnSpellHit calls GetRestorativeEffects with areaOnly = selfDelivery). Two of
// its four effects are Stamina riders the vanilla record gates on
// HasPerk Respite, and those must not spread: DragonBreak grants no vanilla
// perks, so no caster holds Respite and the riders should never land on
// anyone.
//
// SelfSpellCostTest already covers the single-target version of this for
// Healing. What was untested is the AREA path, which is the one that reaches
// other players, and the record data the gate depends on - the gate is only as
// good as the CTDA surviving a USSEP update or a DragonBreak patch touching
// Grand Healing. Measured on the live load order: effects 0b62ed (Health,
// area 15, no conditions) and 0b62f2 (Stamina, area 15, requiresPerk) plus the
// non-area pair 0dd642 (Health) and 1031d5 (Stamina, requiresPerk).

namespace {

constexpr uint32_t kGrandHealing = 0x0b62ee;
constexpr uint32_t kCaster = 0xff00e100;
constexpr uint32_t kBystander = 0xff00e101;

MpActor& Actor(PartOne& p, uint32_t id)
{
  return p.worldState.GetFormAt<MpActor>(id);
}

// The caster and one bystander a few units away, in the same worldspace, with
// the spell in the caster's right hand so CanHitWithSpell lets the hit through
void Setup(PartOne& p)
{
  DoConnect(p, 0);
  p.CreateActor(kCaster, { 0.f, 0.f, 0.f }, 0.f, 0x3c);
  p.SetUserActor(0, kCaster);
  p.CreateActor(kBystander, { 100.f, 0.f, 0.f }, 0.f, 0x3c);

  Equipment eq;
  eq.rightSpell = kGrandHealing;
  Actor(p, kCaster).SetEquipment(eq);
}

void Teardown(PartOne& p)
{
  p.DestroyActor(kBystander);
  p.DestroyActor(kCaster);
  DoDisconnect(p, 0);
}

// The caster's area spell landing on the bystander
void HitBystander(PartOne& p)
{
  RawMessageData rawMsgData;
  rawMsgData.userId = 0;
  HitMessage hit;
  hit.data.aggressor = 0x14;
  hit.data.target = kBystander;
  hit.data.source = kGrandHealing;
  p.GetActionListener().OnHit(rawMsgData, hit);
}

}

TEST_CASE("Grand Healing heals a bystander but does not give them the "
          "Respite stamina rider",
          "[Restoration][Respite][espm]")
{
  PartOne& p = GetPartOne();
  Setup(p);

  auto& bystander = Actor(p, kBystander);
  bystander.SetPercentage(espm::ActorValue::Health, 0.5f);
  bystander.SetPercentage(espm::ActorValue::Stamina, 0.25f);

  HitBystander(p);

  // The ungated area effect reaches them: this is what proves the hit landed
  // at all, so the stamina assertion below cannot pass by the spell being
  // refused for some unrelated reason
  REQUIRE(bystander.GetChangeForm().actorValues.healthPercentage > 0.5f);

  // and the perk-gated one does not
  REQUIRE(bystander.GetChangeForm().actorValues.staminaPercentage ==
          Catch::Approx(0.25f));

  Teardown(p);
}

TEST_CASE("Grand Healing's stamina riders are still perk-gated in the load "
          "order",
          "[Restoration][Respite][espm]")
{
  PartOne& p = GetPartOne();
  const auto lookup =
    p.worldState.GetEspm().GetBrowser().LookupById(kGrandHealing);
  REQUIRE(espm::IsSpellItem(lookup.rec));
  const auto spellData =
    espm::GetSpellItemData(lookup.rec, p.worldState.GetEspmCache());

  size_t gatedStamina = 0, openHealth = 0;
  for (const auto& effect : spellData.effects) {
    REQUIRE(effect.effectItem);
    REQUIRE(effect.effectFormId != 0);
    const uint32_t effectId = lookup.ToGlobalId(effect.effectFormId);
    const auto magicEffect =
      espm::GetData<espm::MGEF>(effectId, &p.worldState);
    const auto av = magicEffect.data.primaryAV;

    if (av == espm::ActorValue::Stamina) {
      // The whole gate rests on this: requiresPerk, and no OR in the chain,
      // because an OR chain means the effect can run without the perk and
      // PerkGated() deliberately reports false for it. If a patch ever
      // rewrites these conditions, the riders start landing on every player in
      // the area and this is the check that says so.
      REQUIRE(effect.hasConditions);
      REQUIRE(effect.requiresPerk);
      REQUIRE_FALSE(effect.orConditions);
      REQUIRE(effect.PerkGated());
      ++gatedStamina;
    } else if (av == espm::ActorValue::Health) {
      REQUIRE_FALSE(effect.PerkGated());
      ++openHealth;
    }
  }

  // Two of each, one area and one not, as measured on the live order
  REQUIRE(gatedStamina == 2);
  REQUIRE(openHealth == 2);
}
