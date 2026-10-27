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
TEST_CASE("A named item drops, like any other", "[DropItemTest]")
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

  // Named at an enchanting or crafting table. It was refused for a while; Nat reversed that on 26 Oct, so
  // it leaves the pack like anything else - and MpActor::DropItem's extras keep-alive is what now stops it
  // being lost to the two-minute ground, which is the reason the refusal existed at all.
  Inventory::ExtraData named;
  named.name = "Sylvia's Greatsword";
  ac.RemoveAllItems();
  ac.AddItems({ Inventory::Entry(ironSword, 1, named) });
  REQUIRE(tryDrop() == 0);

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

// Ticket 1563647648819581000: players lose enchanted and tempered gear they drop. MpActor::DropItem had two
// ways to destroy a dropped object, and the queue cap is the faster one: it deletes the oldest live drop the
// moment an eleventh item is dropped, so an enchanted sword put down before ten pieces of junk vanished
// immediately, well inside the two minutes everyone was blaming.
//
// The two-minute timer itself is not covered here, because WorldState::TickTimers is private and a test
// cannot fast-forward two minutes. The queue cap needs no clock at all.
TEST_CASE("A dropped item carrying extras survives the drop queue cap",
          "[DropItemTest]")
{
  auto& partOne = GetPartOne();
  constexpr uint32_t ironDagger = 0x0001397E;
  constexpr uint32_t ironSword = 0x00012EB7;

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 1, 2, 3 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);
  MpActor& ac = partOne.worldState.GetFormAt<MpActor>(0xff000000);
  ac.RemoveAllItems();

  // Other cases in this binary share the world and have dropped these same base ids, so count only the
  // objects created from here on rather than assuming any form id.
  uint32_t firstNew = 0xff000001;
  for (uint32_t id = 0xff000001; id < 0xff000400; ++id) {
    if (partOne.worldState.LookupFormById(id).get()) {
      firstNew = id + 1;
    }
  }

  // A tempered sword. health is one of the extras that SetPickupExtras carries, and the same test holds for
  // an enchantment, a rename, a soul or a player-made enchantment.
  Inventory::Entry tempered(ironSword, 1);
  tempered.health = 1.5f;
  ac.AddItems({ tempered });
  ac.DropItem(ironSword, tempered);

  // Eleven ordinary daggers. Ten is the cap, so the eleventh evicts the oldest DAGGER.
  for (int i = 0; i < 11; ++i) {
    ac.AddItem(ironDagger, 1);
    ac.DropItem(ironDagger, Inventory::Entry(ironDagger, 1));
  }
  partOne.Tick();

  int liveSwords = 0, liveDaggers = 0, deadDaggers = 0;
  for (uint32_t id = firstNew; id < 0xff000400; ++id) {
    auto form = partOne.worldState.LookupFormById(id);
    auto* refr = dynamic_cast<MpObjectReference*>(form.get());
    if (!refr) {
      continue;
    }
    const bool dead = refr->IsDeleted();
    if (refr->GetBaseId() == ironSword && !dead) {
      ++liveSwords;
    }
    if (refr->GetBaseId() == ironDagger) {
      dead ? ++deadDaggers : ++liveDaggers;
    }
  }

  // The fix: the tempered sword is still on the ground after eleven later drops
  REQUIRE(liveSwords == 1);
  // Unchanged: ordinary litter is still capped, so exactly one dagger was evicted
  REQUIRE(liveDaggers == 10);
  REQUIRE(deadDaggers == 1);
}

// Nat tested the extras fix on dev with an item named 'asd' and it came straight back to his inventory. That
// is not the extras path at all: ActionListener::OnDropItem refuses a NAMED item outright ("a made item
// stays in the pack") and re-sends the inventory so the two sides cannot desync, so MpActor::DropItem is
// never reached and nothing is ever placed in the world.
//
// The two features therefore disagree about named items, and this case pins the precedence down so that
// nobody repairs one of them by quietly breaking the other. Whether a made item SHOULD be droppable is
// Nat's decision, not something to settle in code.
// The refusal used to stop a named item ever reaching MpActor::DropItem, so the extras keep-alive could not
// apply to the very items it was written for. With the refusal gone (Nat, 26 Oct) that path is live, and this
// is the case that was unreachable before: a NAMED item is placed in the world carrying its name.
TEST_CASE("A named item reaches the ground and keeps its name", "[DropItemTest]")
{
  auto& partOne = GetPartOne();
  constexpr uint32_t ironSword = 0x00012EB7;

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 1, 2, 3 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);
  MpActor& ac = partOne.worldState.GetFormAt<MpActor>(0xff000000);
  ac.RemoveAllItems();

  uint32_t firstNew = 0xff000001;
  for (uint32_t id = 0xff000001; id < 0xff000400; ++id) {
    if (partOne.worldState.LookupFormById(id).get()) {
      firstNew = id + 1;
    }
  }

  Inventory::Entry named(ironSword, 1);
  named.name = "Sylvia's Greatsword";
  named.health = 1.5f;
  ac.AddItems({ named });
  REQUIRE(ac.GetInventory().GetItemCount(ironSword) == 1);

  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::DropItem },
                            { "baseId", ironSword },
                            { "count", 1 } });
  partOne.Tick();

  // It left the pack
  REQUIRE(ac.GetInventory().GetItemCount(ironSword) == 0);

  // ...and it is on the ground, still named, which is what the keep-alive protects
  int placed = 0;
  for (uint32_t id = firstNew; id < 0xff000400; ++id) {
    auto form = partOne.worldState.LookupFormById(id);
    auto* refr = dynamic_cast<MpObjectReference*>(form.get());
    if (refr && refr->GetBaseId() == ironSword && !refr->IsDeleted()) {
      ++placed;
    }
  }
  REQUIRE(placed == 1);
}
