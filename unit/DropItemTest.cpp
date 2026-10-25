#include "MpChangeForms.h"
#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>

#include "MpObjectReference.h"
#include "PartOne.h"

PartOne& GetPartOne();

TEST_CASE("Dropping an item", "[DropItemTest]")
{
  auto& partOne = GetPartOne();
  // an iron dagger
  constexpr uint32_t ironDagger = 0x0001397E;
  constexpr uint32_t ironSword = 0x00012EB7;
  DoConnect(partOne, 0);

  partOne.CreateActor(0xff000000, { 1, 2, 3 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);

  MpActor& ac = partOne.worldState.GetFormAt<MpActor>(0xff000000);

  ac.RemoveAllItems();
  REQUIRE(ac.GetInventory().GetTotalItemCount() == 0);
  ac.AddItem(ironDagger, 1);
  REQUIRE(ac.GetInventory().GetTotalItemCount() == 1);
  partOne.Messages().clear();
  REQUIRE(partOne.Messages().size() == 0);
  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::DropItem },
                            { "baseId", ironDagger },
                            { "count", 1 } });
  // 1 message from here and another 1 is comming from actionListener
  partOne.Tick();
  REQUIRE(partOne.Messages().size() == 2);
  REQUIRE(ac.GetInventory().GetItemCount(ironDagger) == 0);
  MpObjectReference& refr =
    partOne.worldState.GetFormAt<MpObjectReference>(0xff000001);
  REQUIRE(refr.GetBaseId() == ironDagger);
  REQUIRE(refr.GetPos().x == 1.f);
  REQUIRE(refr.GetPos().y == 2.f);
  REQUIRE(refr.GetPos().z == 3.f);
  ac.AddItem(ironSword, 5);
  partOne.Messages().clear();
  REQUIRE(partOne.Messages().size() == 0);
  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::DropItem },
                            { "baseId", ironSword },
                            { "count", 5 } });
  partOne.Tick();
  REQUIRE(partOne.Messages().size() == 2);
  REQUIRE(ac.GetInventory().GetItemCount(ironSword) == 0);
}

// The ground deletes a dropped item after two minutes, so a made item is
// refused (Nat, 25 Oct). A NAME is the test: temper, charge, soul and poison
// describe an item's condition, and ordinary enchanted loot carries
// enchantmentId and maxCharge, so testing "any extras" made every looted sword
// of flames undroppable. The case below this one is what caught that.
TEST_CASE("A named item is not dropped, an unnamed one is", "[DropItemTest]")
{
  auto& partOne = GetPartOne();
  constexpr uint32_t ironSword = 0x00012EB7;
  DoConnect(partOne, 6);
  partOne.CreateActor(0xff0b0000, { 1, 2, 3 }, 0, 0x3c);
  partOne.SetUserActor(6, 0xff0b0000);
  MpActor& ac = partOne.worldState.GetFormAt<MpActor>(0xff0b0000);

  auto tryDrop = [&]() {
    DoMessage(partOne, 6,
              nlohmann::json{ { "t", MsgType::DropItem },
                              { "baseId", ironSword },
                              { "count", 1 } });
    partOne.Tick();
    return ac.GetInventory().GetItemCount(ironSword);
  };

  // named at an enchanting or crafting table: it stays in the pack
  Inventory::ExtraData named;
  named.name = "Sylvia's Greatsword";
  ac.RemoveAllItems();
  ac.AddItems({ Inventory::Entry(ironSword, 1, named) });
  REQUIRE(tryDrop() == 1);

  // tempered and enchanted but unnamed: ordinary gear, and it drops
  Inventory::ExtraData gear;
  gear.health = 1.3f;
  gear.enchantmentId = 0x0004605A;
  gear.maxCharge = 500.f;
  ac.RemoveAllItems();
  ac.AddItems({ Inventory::Entry(ironSword, 1, gear) });
  REQUIRE(tryDrop() == 0);
}

TEST_CASE("A dropped enchanted weapon keeps the charge it was dropped with",
          "[DropItemTest]")
{
  auto& partOne = GetPartOne();
  constexpr uint32_t ironSword = 0x00012EB7;
  constexpr uint32_t anyEnchantment = 0x0004605A;
  DoConnect(partOne, 5);
  partOne.CreateActor(0xff0a0000, { 1, 2, 3 }, 0, 0x3c);
  partOne.SetUserActor(5, 0xff0a0000);
  MpActor& ac = partOne.worldState.GetFormAt<MpActor>(0xff0a0000);

  auto charged = [&](float charge) {
    Inventory::ExtraData extras;
    extras.enchantmentId = anyEnchantment;
    extras.maxCharge = 500.f;
    extras.chargePercent = charge;
    return Inventory::Entry(ironSword, 1, extras);
  };
  auto dropAndPickUp = [&](float reported) {
    ac.RemoveAllItems();
    ac.AddItems({ charged(300.f) });
    DoMessage(partOne, 5,
              nlohmann::json{ { "t", MsgType::DropItem },
                              { "baseId", ironSword },
                              { "count", 1 },
                              { "enchantmentId", anyEnchantment },
                              { "maxCharge", 500.f },
                              { "chargePercent", reported } });
    partOne.Tick();
    REQUIRE(ac.GetInventory().GetItemCount(ironSword) == 0);
    MpObjectReference* dropped = nullptr;
    for (uint32_t id = 0xff000000; id < 0xff100000; ++id) {
      auto& form = partOne.worldState.LookupFormById(id);
      auto refr = form ? form->AsObjectReference() : nullptr;
      if (refr && !refr->AsActor() && refr->GetBaseId() == ironSword &&
          !refr->IsDeleted() && !refr->IsHarvested()) {
        dropped = refr;
      }
    }
    REQUIRE(dropped != nullptr);
    dropped->Activate(ac);
    REQUIRE(ac.GetInventory().entries.size() == 1);
    return ac.GetInventory().entries[0].chargePercent.value_or(-1.f);
  };

  REQUIRE(dropAndPickUp(120.f) == 120.f);
  REQUIRE(dropAndPickUp(450.f) == 300.f);

  DoDisconnect(partOne, 5);
  partOne.DestroyActor(0xff0a0000);
}
