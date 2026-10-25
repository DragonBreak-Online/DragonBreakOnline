#include "TestUtils.hpp"

using Catch::Matchers::ContainsSubstring;

TEST_CASE("CreateActor/DestroyActor", "[PartOne]")
{

  PartOne partOne;

  // Create:

  REQUIRE(!partOne.worldState.LookupFormById(0xff000ABC));
  partOne.CreateActor(0xff000ABC, { 1.f, 2.f, 3.f }, 180.f, 0x3c);

  auto form = partOne.worldState.LookupFormById(0xff000ABC).get();
  REQUIRE(form);
  REQUIRE(form->GetFormId() == 0xff000ABC);

  auto ac = dynamic_cast<MpActor*>(form);
  REQUIRE(ac);
  REQUIRE(ac->GetPos() == NiPoint3{ 1.f, 2.f, 3.f });
  REQUIRE(ac->GetAngle() == NiPoint3{ 0.f, 0.f, 180.f });
  REQUIRE(ac->GetCellOrWorld() == FormDesc::Tamriel());

  // Destroy:

  partOne.DestroyActor(0xff000ABC);
  REQUIRE(!partOne.worldState.LookupFormById(0xff000ABC));
}

TEST_CASE("SetUserActor", "[PartOne]")
{

  PartOne partOne;
  partOne.CreateActor(0xff000ABC, { 1.f, 2.f, 3.f }, 180.f, 0x3c);
  DoConnect(partOne, 0);

  REQUIRE(!partOne.GetUserActor(0));
  partOne.SetUserActor(0, 0xff000ABC);
  REQUIRE(partOne.GetUserActor(0) == 0xff000ABC);
  REQUIRE(partOne.Messages().size() == 1);
  REQUIRE(partOne.Messages().at(0).message);

  auto createActorMessage =
    dynamic_cast<CreateActorMessage*>(partOne.Messages().at(0).message.get());

  REQUIRE(createActorMessage);
  REQUIRE(createActorMessage->refrId == 0xff000ABC);
  REQUIRE(createActorMessage->idx == 0);
  REQUIRE(createActorMessage->customPropsJsonDumps.empty());
  REQUIRE(createActorMessage->isMe == true);
  REQUIRE(createActorMessage->props.healRate == 0.7f);
  REQUIRE(createActorMessage->props.healRateMult == 100.f);
  REQUIRE(createActorMessage->props.health == 100.f);
  REQUIRE(createActorMessage->props.isHostedByOther == true);
  REQUIRE(createActorMessage->props.learnedSpells == std::vector<uint32_t>());
  REQUIRE(createActorMessage->props.magicka == 100.f);
  REQUIRE(createActorMessage->props.magickaRate == 3.f);
  REQUIRE(createActorMessage->props.magickaRateMult == 100.f);
  REQUIRE(createActorMessage->props.stamina == 100.f);
  REQUIRE(createActorMessage->props.staminaRate == 5.f);
  REQUIRE(createActorMessage->props.staminaRateMult == 100.f);
  REQUIRE(createActorMessage->props.healthPercentage == 1.f);
  REQUIRE(createActorMessage->props.staminaPercentage == 1.f);
  REQUIRE(createActorMessage->props.magickaPercentage == 1.f);
  REQUIRE(createActorMessage->transform.pos ==
          std::array<float, 3>{ 1.f, 2.f, 3.f });
  REQUIRE(createActorMessage->transform.rot ==
          std::array<float, 3>{ 0.f, 0.f, 180.f });
  REQUIRE(createActorMessage->transform.worldOrCell == 0x3c);

  // Trying to destroy actor:
  partOne.DestroyActor(0xff000ABC);
  REQUIRE(!partOne.GetUserActor(0));

  // TODO: More manipulations with actor transfer
}

TEST_CASE("Use SetUserActor with 0 formId argument", "[PartOne]")
{

  PartOne partOne;
  DoConnect(partOne, 1);
  partOne.CreateActor(0xff000ABC, { 1.f, 2.f, 3.f }, 180.f, 0x3c);

  REQUIRE(partOne.GetUserActor(1) == 0);
  partOne.SetUserActor(1, 0xff000ABC);
  REQUIRE(partOne.GetUserActor(1) == 0xff000ABC);
  partOne.SetUserActor(1, 0);
  REQUIRE(partOne.GetUserActor(1) == 0);
}

TEST_CASE("SetUserActor failures", "[PartOne]")
{
  PartOne partOne;
  REQUIRE_THROWS_WITH(partOne.SetUserActor(9, 0xff000000),
                      ContainsSubstring("User with id 9 doesn't exist"));
  DoConnect(partOne, 9);

  REQUIRE_THROWS_WITH(
    partOne.SetUserActor(9, 0xff000000),
    ContainsSubstring("Form with id 0xff000000 doesn't exist"));

  partOne.worldState.AddForm(std::unique_ptr<MpForm>(new MpForm), 0xff000000);

  REQUIRE_THROWS_WITH(
    partOne.SetUserActor(9, 0xff000000),
    ContainsSubstring("Form with id 0xff000000 is not Actor"));
}

// A watcher's createActor must not carry the actor's learned spells. It used
// to: the array went out in every mode, so each neighbour paid a deep copy of
// the change form's std::set, a second copy into a vector and a linear find
// per base spell, and then received a list it had no use for - remoteServer.ts
// reads props.learnedSpells only under `msg.isMe`. A character given all 254
// spells from the admin panel was therefore a broadcast amplifier, and the
// server froze (17 Oct).
TEST_CASE("createActor sends learned spells to the owner only", "[PartOne]")
{
  PartOne partOne;

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000ABC, { 1.f, 2.f, 3.f }, 180.f, 0x3c);
  // learned before the actor is handed to the user, so it is in the
  // createActor that SetUserActor sends
  partOne.worldState.GetFormAt<MpActor>(0xff000ABC).AddSpell(0x0001a4cc);
  partOne.SetUserActor(0, 0xff000ABC);

  // the owner's own message still has it
  auto own = FindRefrMessageIdx<CreateActorMessage>(partOne, 0);
  REQUIRE(own.filteredMessages.size() == 1);
  REQUIRE(own.filteredMessages[0].isMe == true);
  REQUIRE(own.filteredMessages[0].props.learnedSpells.has_value());
  REQUIRE(*own.filteredMessages[0].props.learnedSpells ==
          std::vector<uint32_t>({ 0x0001a4cc }));

  partOne.Messages().clear();

  // a second player is told about the first one: a neighbour message, and it
  // must carry nothing
  DoConnect(partOne, 1);
  partOne.CreateActor(0xff000FFF, { 100.f, 200.f, 300.f }, 180.f, 0x3c);
  partOne.SetUserActor(1, 0xff000FFF);

  auto seen = FindRefrMessageIdx<CreateActorMessage>(partOne, 0);
  REQUIRE(seen.filteredMessages.size() == 1);
  REQUIRE(seen.filteredMessages[0].isMe == false);
  REQUIRE(!seen.filteredMessages[0].props.learnedSpells.has_value());
}

TEST_CASE("createActor message contains Appearance", "[PartOne]")
{

  PartOne partOne;

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000ABC, { 1.f, 2.f, 3.f }, 180.f, 0x3c);
  partOne.SetUserActor(0, 0xff000ABC);
  const Appearance appearance = Appearance::FromJson(jAppearance["data"]);
  partOne.worldState.GetFormAt<MpActor>(0xff000ABC).SetAppearance(&appearance);

  partOne.Messages().clear();

  DoConnect(partOne, 1);
  partOne.CreateActor(0xff000FFF, { 100.f, 200.f, 300.f }, 180.f, 0x3c);
  partOne.SetUserActor(1, 0xff000FFF);

  auto res = FindRefrMessageIdx<CreateActorMessage>(partOne, 0);
  REQUIRE(res.filteredMessages.size() == 1);
  REQUIRE(res.filteredMessages[0].appearance.has_value());
  REQUIRE(*res.filteredMessages[0].appearance == appearance);

  /*REQUIRE_THROWS_WITH(
    doAppearance(), ContainsSubstring("Unable to update appearance, RaceMenu is
  not open"));

  partOne.SetRaceMenuOpen(0xff000ABC, true);
  doAppearance();*/
}

TEST_CASE("GetUserActor", "[PartOne]")
{

  PartOne partOne;

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, { 0, 0, 0 }, 0, 0x3c);
  partOne.SetUserActor(0, 0xff000000);

  auto& ac = partOne.worldState.GetFormAt<MpActor>(0xff000000);

  REQUIRE(partOne.GetUserActor(0) == 0xff000000);
  REQUIRE(partOne.serverState.ActorByUser(0) != nullptr);
  REQUIRE(partOne.serverState.UserByActor(&ac) == 0);

  DoDisconnect(partOne, 0);

  REQUIRE(partOne.serverState.ActorByUser(0) == nullptr);
  REQUIRE(partOne.serverState.UserByActor(&ac) == Networking::InvalidUserId);
  REQUIRE_THROWS_WITH(partOne.GetUserActor(0),
                      ContainsSubstring("User with id 0 doesn't exist"));
}

TEST_CASE("Destroying actor in disconnect event handler", "[PartOne]")
{

  static PartOne partOne;

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000ABC, { 1.f, 2.f, 3.f }, 180.f, 0x3c);
  partOne.SetUserActor(0, 0xff000ABC);
  DoMessage(partOne, 0, jMovement);

  static auto& ac = partOne.worldState.GetFormAt<MpActor>(0xff000ABC);

  class Listener : public PartOne::Listener
  {
  public:
    void OnConnect(Networking::UserId userId) override {}
    void OnDisconnect(Networking::UserId userId) override
    {
      REQUIRE(partOne.serverState.UserByActor(&ac) == 0);
      partOne.DestroyActor(0xff000ABC);
    }
    void OnCustomPacket(Networking::UserId userId,
                        const simdjson::dom::element& content) override
    {
    }
    bool OnMpApiEvent(const GameModeEvent&) override { return true; }
  };

  partOne.AddListener(std::shared_ptr<PartOne::Listener>(new Listener));

  REQUIRE(partOne.serverState.UserByActor(&ac) == 0);
  DoDisconnect(partOne, 1);
  REQUIRE(partOne.serverState.UserByActor(&ac) == Networking::InvalidUserId);
}

TEST_CASE("Bug with subscription", "[PartOne]")
{

  PartOne partOne;
  DoConnect(partOne, 0);

  partOne.CreateActor(0xff000000, { 1, 1, 1 }, 3, 0x3c);
  partOne.SetEnabled(0xff000000, true);
  partOne.SetEnabled(0xff000000, false);
  partOne.SetEnabled(0xff000000, true);
  partOne.SetEnabled(0xff000000, false);
  partOne.SetEnabled(0xff000000, true);
  partOne.SetUserActor(0, 0xff000000);

  REQUIRE(partOne.Messages().size() == 1);
  REQUIRE(partOne.Messages()[0].j["t"] == MsgType::CreateActor);
}

TEST_CASE("SetUserActor doesn't work with disabled actors", "[PartOne]")
{
  PartOne partOne;

  REQUIRE_THROWS_WITH(partOne.GetUserActor(Networking::InvalidUserId),
                      ContainsSubstring("User with id 65535 doesn't exist"));

  REQUIRE_THROWS_WITH(partOne.SetUserActor(Networking::InvalidUserId, 0),
                      ContainsSubstring("User with id 65535 doesn't exist"));
}

TEST_CASE("Actor should see its inventory in 'createActor' message",
          "[PartOne]")
{

  PartOne partOne;
  DoConnect(partOne, 0);

  partOne.CreateActor(0xff000000, { 1, 1, 1 }, 3, 0x3c);
  partOne.worldState.GetFormAt<MpActor>(0xff000000).AddItem(0x12eb7, 3);
  partOne.SetUserActor(0, 0xff000000);

  REQUIRE(partOne.Messages().size() == 1);
  REQUIRE(partOne.Messages()[0].j["t"] == MsgType::CreateActor);
  REQUIRE(partOne.Messages()[0].j["props"]["inventory"] ==
          Inventory().AddItem(0x12eb7, 3).ToJson());
}

TEST_CASE("'isRaceMenuOpen' property should present in 'createActor'",
          "[PartOne]")
{

  PartOne partOne;
  DoConnect(partOne, 0);

  partOne.CreateActor(0xff000000, { 1, 1, 1 }, 3, 0x3c);
  partOne.worldState.GetFormAt<MpActor>(0xff000000).SetRaceMenuOpen(true);
  partOne.SetUserActor(0, 0xff000000);

  REQUIRE(partOne.Messages().size() == 1);
  REQUIRE(partOne.Messages()[0].j["t"] == MsgType::CreateActor);
  REQUIRE(partOne.Messages()[0].j["props"]["isRaceMenuOpen"] == true);
}

TEST_CASE("private.* properties are never sent to any client", "[PartOne]")
{
  // Discord ids, roles, masked names and house keys stay on the server
  PartOne partOne;
  partOne.worldState.espmFiles = std::vector<std::string>{ "Skyrim.esm" };

  // Registered owner-only and public props keep working as before
  GamemodeApi::State state;
  GamemodeApi::PropertyInfo ownerOnly;
  ownerOnly.isVisibleByOwner = true;
  ownerOnly.isVisibleByNeighbors = false;
  GamemodeApi::PropertyInfo everyone;
  everyone.isVisibleByOwner = true;
  everyone.isVisibleByNeighbors = true;
  state.createdProperties["ctlOwnerOnly"] = ownerOnly;
  state.createdProperties["ctlPublic"] = everyone;
  partOne.NotifyGamemodeApiStateChanged(state);

  const uint32_t owner = 0xff000A01, neighbour = 0xff000A02, door = 0xff000A03,
                 doorBase = 0xabcd;
  partOne.CreateActor(owner, { 0.f, 0.f, 0.f }, 0.f, 0x3c);
  partOne.CreateActor(neighbour, { 300.f, 0.f, 0.f }, 0.f, 0x3c);

  // Saved props load through ApplyChangeForm, as from the database
  auto& ac = partOne.worldState.GetFormAt<MpActor>(owner);
  MpChangeForm changeForm = ac.GetChangeForm();
  changeForm.formDesc =
    FormDesc::FromFormId(owner, partOne.worldState.espmFiles);
  changeForm.baseDesc =
    FormDesc::FromFormId(ac.GetBaseId(), partOne.worldState.espmFiles);
  changeForm.dynamicFields = DynamicFields::FromJson(
    nlohmann::json{ { "private.skympDiscordId", "dummy-id" },
                    { "private.discordRoles", { "dummy-role" } },
                    { "ctlOwnerOnly", 1 },
                    { "ctlPublic", 2 } });
  ac.ApplyChangeForm(changeForm);
  // Indexed private props go through the same call mp.set() makes
  ac.RegisterPrivateIndexedProperty("private.indexed.charName",
                                    "\"dummy name\"");

  // A house door between them with its private.housing record
  LocationalData doorLocation;
  doorLocation.pos = { 200.f, 0.f, 0.f };
  doorLocation.rot = { 0.f, 0.f, 0.f };
  doorLocation.cellOrWorldDesc = FormDesc::Tamriel();
  partOne.worldState.AddForm(
    std::make_unique<MpObjectReference>(
      doorLocation, partOne.CreateFormCallbacks(), doorBase, "DOOR"),
    door);
  auto& doorRef = partOne.worldState.GetFormAt<MpObjectReference>(door);
  MpChangeForm doorForm = doorRef.GetChangeForm();
  doorForm.formDesc = FormDesc::FromFormId(door, partOne.worldState.espmFiles);
  doorForm.baseDesc =
    FormDesc::FromFormId(doorBase, partOne.worldState.espmFiles);
  doorForm.dynamicFields = DynamicFields::FromJson(
    nlohmann::json{ { "private.housing", { { "ownerName", "dummy owner" } } },
                    { "ctlPublic", 3 } });
  doorRef.ApplyChangeForm(doorForm);
  doorRef.SetPos(doorLocation.pos);

  DoConnect(partOne, 0);
  DoConnect(partOne, 1);
  partOne.Messages().clear();
  partOne.SetUserActor(0, owner);
  partOne.SetUserActor(1, neighbour);

  // The custom prop names one user got in the createActor of one form
  auto propsSent = [&](Networking::UserId userId, uint32_t refrId) {
    std::set<std::string> names;
    int createActors = 0;
    for (auto& m : partOne.Messages()) {
      auto createActor = dynamic_cast<CreateActorMessage*>(m.message.get());
      if (!createActor || m.userId != userId ||
          createActor->refrId.value_or(0) % 0x100000000 != refrId) {
        continue;
      }
      ++createActors;
      for (auto& entry : createActor->customPropsJsonDumps) {
        names.insert(entry.propName);
      }
    }
    REQUIRE(createActors == 1);
    return names;
  };

  using Names = std::set<std::string>;
  CHECK(propsSent(0, owner) == Names{ "ctlOwnerOnly", "ctlPublic" });
  CHECK(propsSent(1, owner) == Names{ "ctlPublic" });
  CHECK(propsSent(0, door) == Names{ "ctlPublic" });
  CHECK(propsSent(1, door) == Names{ "ctlPublic" });

  // The server still has every value, for mp.get and the index
  REQUIRE(ac.GetDynamicFields().GetValueDump("private.skympDiscordId") ==
          "\"dummy-id\"");
  REQUIRE(ac.GetDynamicFields().GetValueDump("private.indexed.charName") ==
          "\"dummy name\"");
  REQUIRE(doorRef.GetDynamicFields().GetValueDump("private.housing") ==
          "{\"ownerName\":\"dummy owner\"}");
  REQUIRE(partOne.worldState
            .GetActorsByPrivateIndexedProperty(
              partOne.worldState.MakePrivateIndexedPropertyMapKey(
                "private.indexed.charName", "\"dummy name\""))
            .count(owner) == 1);
}
