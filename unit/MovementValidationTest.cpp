#include <catch2/catch_all.hpp>

#include "MovementValidation.h"
#include "MsgType.h"
#include "NiPoint3.h"
#include "TestUtils.hpp"
#include <limits>
#include <vector>

extern PartOne& GetPartOne();

TEST_CASE("Returns true and sends nothing for normal movement",
          "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);

  auto& actor = partOne.worldState.GetFormAt<MpActor>(0xff000000);

  partOne.Messages().clear();
  bool res = MovementValidation::Validate(
    partOne, { 0, 0, 0 }, { 0, 0, 0 }, FormDesc::Tamriel(), { 1, 1, 1 },
    FormDesc::Tamriel(), 0, &actor, { "Skyrim.esm" });
  REQUIRE(res);
  REQUIRE(partOne.Messages().empty());
}

TEST_CASE("Returns false and sends teleport packet when moving too fast",
          "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);

  auto& actor = partOne.worldState.GetFormAt<MpActor>(0xff000000);

  partOne.Messages().clear();
  float maxLegalMove = 4096.f;
  bool res = MovementValidation::Validate(
    partOne, { 1, -1, 1 }, { 123, 111, 123 }, FormDesc::Tamriel(),
    NiPoint3{ 1, -1, 1 } + NiPoint3{ maxLegalMove + 1.f, 0, 0 },
    FormDesc::Tamriel(), 0, &actor, { "Skyrim.esm" });
  REQUIRE(!res);
  REQUIRE(partOne.Messages().size() == 1);
  REQUIRE(partOne.Messages()[0].j ==
          nlohmann::json{ { "t", static_cast<int>(MsgType::Teleport2) },
                          { "pos", { 1, -1, 1 } },
                          { "rot", { 123, 111, 123 } },
                          { "worldOrCell", 0x3c } });
  REQUIRE(partOne.Messages()[0].userId == 0);
}

TEST_CASE("Refuses a jump that is under the single packet cap but too fast",
          "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);

  auto& actor = partOne.worldState.GetFormAt<MpActor>(0xff000000);
  MovementValidation::Tracker tracker;

  partOne.Messages().clear();
  bool seeding = MovementValidation::Validate(
    partOne, { 0, 0, 0 }, { 0, 0, 0 }, FormDesc::Tamriel(), { 100, 0, 0 },
    FormDesc::Tamriel(), 0, &actor, { "Skyrim.esm" }, &tracker);
  REQUIRE(seeding);
  REQUIRE(partOne.Messages().empty());

  bool res = MovementValidation::Validate(
    partOne, { 100, 0, 0 }, { 0, 0, 0 }, FormDesc::Tamriel(), { 3000, 0, 0 },
    FormDesc::Tamriel(), 0, &actor, { "Skyrim.esm" }, &tracker);
  REQUIRE(!res);
  REQUIRE(partOne.Messages().size() == 1);
  REQUIRE(partOne.Messages()[0].j["t"] ==
          static_cast<int>(MsgType::Teleport2));
}

TEST_CASE("Accepts walking speed steps in a row", "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);

  auto& actor = partOne.worldState.GetFormAt<MpActor>(0xff000000);
  MovementValidation::Tracker tracker;

  partOne.Messages().clear();
  for (int i = 0; i < 8; ++i) {
    NiPoint3 from = { static_cast<float>(i * 60), 0, 0 };
    NiPoint3 to = { static_cast<float>((i + 1) * 60), 0, 0 };
    REQUIRE(MovementValidation::Validate(partOne, from, { 0, 0, 0 },
                                         FormDesc::Tamriel(), to,
                                         FormDesc::Tamriel(), 0, &actor,
                                         { "Skyrim.esm" }, &tracker));
  }
  REQUIRE(partOne.Messages().empty());
}

TEST_CASE("Drops a stale packet after a server teleport without snapping back",
          "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);

  auto& actor = partOne.worldState.GetFormAt<MpActor>(0xff000000);
  MovementValidation::Tracker tracker;

  partOne.Messages().clear();
  REQUIRE(MovementValidation::Validate(
    partOne, { 0, 0, 0 }, { 0, 0, 0 }, FormDesc::Tamriel(), { 100, 0, 0 },
    FormDesc::Tamriel(), 0, &actor, { "Skyrim.esm" }, &tracker));

  // The server moved the actor to 2000, the client is still sending from 100
  bool stale = MovementValidation::Validate(
    partOne, { 2000, 0, 0 }, { 0, 0, 0 }, FormDesc::Tamriel(), { 150, 0, 0 },
    FormDesc::Tamriel(), 0, &actor, { "Skyrim.esm" }, &tracker);
  REQUIRE(!stale);
  REQUIRE(partOne.Messages().empty());

  // The client has arrived and reports from the destination
  REQUIRE(MovementValidation::Validate(
    partOne, { 2000, 0, 0 }, { 0, 0, 0 }, FormDesc::Tamriel(), { 2050, 0, 0 },
    FormDesc::Tamriel(), 0, &actor, { "Skyrim.esm" }, &tracker));
  REQUIRE(partOne.Messages().empty());
}

TEST_CASE("Leaves hosted NPC movement to the existing checks",
          "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);
  partOne.CreateActor(0xff000001, { 0, 0, 0 }, 0, 0x3c);

  auto& npc = partOne.worldState.GetFormAt<MpActor>(0xff000001);
  MovementValidation::Tracker tracker;

  partOne.Messages().clear();
  REQUIRE(MovementValidation::Validate(
    partOne, { 0, 0, 0 }, { 0, 0, 0 }, FormDesc::Tamriel(), { 3000, 0, 0 },
    FormDesc::Tamriel(), 0, &npc, { "Skyrim.esm" }, &tracker));
  REQUIRE(partOne.Messages().empty());
}

TEST_CASE(
  "Returns false and sends teleport packet when moving between locations",
  "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);

  auto& actor = partOne.worldState.GetFormAt<MpActor>(0xff000000);

  partOne.Messages().clear();
  bool res = MovementValidation::Validate(
    partOne, { 1, -1, 1 }, { 123, 111, 123 }, FormDesc::Tamriel(),
    { 1, -1, 1 }, FormDesc::FromString("ffffff:Skyrim.esm"), 0, &actor,
    { "Skyrim.esm" });
  REQUIRE(!res);
  REQUIRE(partOne.Messages().size() == 1);
  REQUIRE(partOne.Messages()[0].j ==
          nlohmann::json{ { "t", static_cast<int>(MsgType::Teleport2) },
                          { "pos", { 1, -1, 1 } },
                          { "rot", { 123, 111, 123 } },
                          { "worldOrCell", 0x3c } });
  REQUIRE(partOne.Messages()[0].userId == 0);
}

// A refused packet latches for a hosted actor, which freezes it and makes it unkillable

TEST_CASE("Accepts a hosted NPC walking into the next cell of its dungeon",
          "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);
  partOne.CreateActor(0xff000001, { 0, 0, 0 }, 0, 0x3c);

  auto& npc = partOne.worldState.GetFormAt<MpActor>(0xff000001);
  MovementValidation::Tracker tracker;

  // Bthardamz02a and Bthardamz02, both in location 00019152
  // Its load door 00059266 puts an actor at 8892 4799 -3143 in Bthardamz02, far past the guard from where it stood
  partOne.Messages().clear();
  REQUIRE(MovementValidation::Validate(
    partOne, { 704, 576, 768 }, { 0, 0, 0 },
    FormDesc::FromString("5912d:Skyrim.esm"), { 8950, 4700, -3143 },
    FormDesc::FromString("361f9:Skyrim.esm"), 0, &npc, { "Skyrim.esm" },
    &tracker));
  // Nothing is sent to the hosting client: it was right, the server was stale
  REQUIRE(partOne.Messages().empty());
}

TEST_CASE("Refuses a hosted NPC's move into the next cell far from its load "
          "doors",
          "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);
  partOne.CreateActor(0xff000001, { 0, 0, 0 }, 0, 0x3c);

  auto& npc = partOne.worldState.GetFormAt<MpActor>(0xff000001);
  MovementValidation::Tracker tracker;

  // Bthardamz02a's doors into Bthardamz02 put an actor at 8892 4799 -3143 and 7368 5326 -4167
  for (const NiPoint3& to :
       { NiPoint3{ 9000, 0, 0 }, NiPoint3{ 1e9f, 1e9f, 1e9f },
         NiPoint3{ 8892 + 4200, 4799, -3143 } }) {
    partOne.Messages().clear();
    REQUIRE(!MovementValidation::Validate(
      partOne, { 704, 576, 768 }, { 0, 0, 0 },
      FormDesc::FromString("5912d:Skyrim.esm"), to,
      FormDesc::FromString("361f9:Skyrim.esm"), 0, &npc, { "Skyrim.esm" },
      &tracker));
    REQUIRE(partOne.Messages().empty());
  }
}

TEST_CASE("Refuses a hosted NPC's position that is not finite on every axis",
          "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);
  partOne.CreateActor(0xff000001, { 0, 0, 0 }, 0, 0x3c);

  auto& npc = partOne.worldState.GetFormAt<MpActor>(0xff000001);
  MovementValidation::Tracker tracker;
  const float nan = std::numeric_limits<float>::quiet_NaN();

  // Into the next cell at its load door's arrival, with a NaN height
  partOne.Messages().clear();
  REQUIRE(!MovementValidation::Validate(
    partOne, { 704, 576, 768 }, { 0, 0, 0 },
    FormDesc::FromString("5912d:Skyrim.esm"), { 8892, nan, nan },
    FormDesc::FromString("361f9:Skyrim.esm"), 0, &npc, { "Skyrim.esm" },
    &tracker));
  // Inside one cell, where a NaN distance never trips the guard
  REQUIRE(!MovementValidation::Validate(
    partOne, { 0, 0, 0 }, { 0, 0, 0 }, FormDesc::Tamriel(), { 10, nan, 0 },
    FormDesc::Tamriel(), 0, &npc, { "Skyrim.esm" }, &tracker));
  REQUIRE(partOne.Messages().empty());

  REQUIRE(MovementValidation::Validate(
    partOne, { 0, 0, 0 }, { 0, 0, 0 }, FormDesc::Tamriel(), { 10, 10, 0 },
    FormDesc::Tamriel(), 0, &npc, { "Skyrim.esm" }, &tracker));
}

TEST_CASE("Accepts a hosted NPC walking back through the other cell's door",
          "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);
  partOne.CreateActor(0xff000001, { 0, 0, 0 }, 0, 0x3c);

  auto& npc = partOne.worldState.GetFormAt<MpActor>(0xff000001);
  MovementValidation::Tracker tracker;

  // Bthardamz02's door 0003e40a puts an actor at -611 1856 0 in Bthardamz02a
  partOne.Messages().clear();
  REQUIRE(MovementValidation::Validate(
    partOne, { 7468, 5321, -4169 }, { 0, 0, 0 },
    FormDesc::FromString("361f9:Skyrim.esm"), { -560, 1900, 0 },
    FormDesc::FromString("5912d:Skyrim.esm"), 0, &npc, { "Skyrim.esm" },
    &tracker));
  REQUIRE(partOne.Messages().empty());
}

TEST_CASE("Refuses a player's position that is not finite on every axis",
          "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);

  auto& actor = partOne.worldState.GetFormAt<MpActor>(0xff000000);
  MovementValidation::Tracker tracker;
  const float nan = std::numeric_limits<float>::quiet_NaN();

  // A NaN height adds nothing to the up or down budget
  partOne.Messages().clear();
  REQUIRE(!MovementValidation::Validate(
    partOne, { 0, 0, 0 }, { 0, 0, 0 }, FormDesc::Tamriel(), { 10, 10, nan },
    FormDesc::Tamriel(), 0, &actor, { "Skyrim.esm" }, &tracker));
  REQUIRE(partOne.Messages().size() == 1);
  REQUIRE(partOne.Messages()[0].j["t"] ==
          static_cast<int>(MsgType::Teleport2));

  // With the rate check off nothing else looks at the position
  partOne.worldState.movementLimits.enabled = false;
  partOne.Messages().clear();
  REQUIRE(!MovementValidation::Validate(
    partOne, { 0, 0, 0 }, { 0, 0, 0 }, FormDesc::Tamriel(), { 10, nan, 0 },
    FormDesc::Tamriel(), 0, &actor, { "Skyrim.esm" }, &tracker));
  REQUIRE(partOne.Messages().size() == 1);

  partOne.Messages().clear();
  REQUIRE(MovementValidation::Validate(
    partOne, { 0, 0, 0 }, { 0, 0, 0 }, FormDesc::Tamriel(), { 10, 10, 0 },
    FormDesc::Tamriel(), 0, &actor, { "Skyrim.esm" }, &tracker));
  REQUIRE(partOne.Messages().empty());
}

TEST_CASE("Refuses a hosted NPC's move between cells of different locations",
          "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);
  partOne.CreateActor(0xff000001, { 0, 0, 0 }, 0, 0x3c);

  auto& npc = partOne.worldState.GetFormAt<MpActor>(0xff000001);
  MovementValidation::Tracker tracker;

  // Bthardamz02a (location 00019152) to WhiterunBanneredMare (location 0001F86D)
  partOne.Messages().clear();
  REQUIRE(!MovementValidation::Validate(
    partOne, { 0, 0, 0 }, { 0, 0, 0 }, FormDesc::FromString("5912d:Skyrim.esm"),
    { 10, 0, 0 }, FormDesc::FromString("1605e:Skyrim.esm"), 0, &npc,
    { "Skyrim.esm" }, &tracker));
  REQUIRE(partOne.Messages().empty());
}

TEST_CASE("Refuses a hosted NPC's move when a cell carries no location",
          "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);
  partOne.CreateActor(0xff000001, { 0, 0, 0 }, 0, 0x3c);

  auto& npc = partOne.worldState.GetFormAt<MpActor>(0xff000001);
  MovementValidation::Tracker tracker;

  // QASmoke carries no XLCN, so it never qualifies
  partOne.Messages().clear();
  REQUIRE(!MovementValidation::Validate(
    partOne, { 0, 0, 0 }, { 0, 0, 0 }, FormDesc::FromString("32ae7:Skyrim.esm"),
    { 10, 0, 0 }, FormDesc::FromString("5912d:Skyrim.esm"), 0, &npc,
    { "Skyrim.esm" }, &tracker));
  REQUIRE(partOne.Messages().empty());
}

TEST_CASE("Still refuses a hosted NPC's jump inside one cell",
          "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);
  partOne.CreateActor(0xff000001, { 0, 0, 0 }, 0, 0x3c);

  auto& npc = partOne.worldState.GetFormAt<MpActor>(0xff000001);
  MovementValidation::Tracker tracker;

  // Refusing this cannot latch: the cell still agrees, so the next honest
  // packet is accepted
  partOne.Messages().clear();
  REQUIRE(!MovementValidation::Validate(
    partOne, { 0, 0, 0 }, { 0, 0, 0 }, FormDesc::Tamriel(), { 5000, 0, 0 },
    FormDesc::Tamriel(), 0, &npc, { "Skyrim.esm" }, &tracker));
  REQUIRE(partOne.Messages().empty());

  REQUIRE(MovementValidation::Validate(
    partOne, { 0, 0, 0 }, { 0, 0, 0 }, FormDesc::Tamriel(), { 100, 0, 0 },
    FormDesc::Tamriel(), 0, &npc, { "Skyrim.esm" }, &tracker));
  REQUIRE(partOne.Messages().empty());
}

TEST_CASE("Drops a hosted NPC's in-flight packet after a server teleport",
          "[MovementValidation]")
{
  PartOne& partOne = GetPartOne();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);
  partOne.CreateActor(0xff000001, { 0, 0, 0 }, 0, 0x3c);

  auto& npc = partOne.worldState.GetFormAt<MpActor>(0xff000001);
  MovementValidation::Tracker tracker;

  // The caller passes an infinite position for a packet sent before the hoster
  // saw a server teleport. Accepting a cell change must not let that through,
  // or the stale packet would overwrite the destination just set.
  const float inf = std::numeric_limits<float>::infinity();

  partOne.Messages().clear();
  REQUIRE(!MovementValidation::Validate(
    partOne, { 0, 0, 0 }, { 0, 0, 0 }, FormDesc::Tamriel(), { inf, inf, inf },
    FormDesc::FromString("ffffff:Skyrim.esm"), 0, &npc, { "Skyrim.esm" },
    &tracker));
  REQUIRE(partOne.Messages().empty());
}
