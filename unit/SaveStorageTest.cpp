#include "TestUtils.hpp"

#include "FormDesc.h"
#include "MpChangeForms.h"
#include "database_drivers/DatabaseFactory.h"
#include "database_drivers/FileDatabase.h"
#include "database_drivers/ZipDatabase.h"
#include "save_storages/AsyncSaveStorage.h"
#include <atomic>
#include <filesystem>
#include <map>

std::shared_ptr<
  Viet::ISaveStorage<MpChangeForm, FormDesc, std::vector<FormDesc>>>
MakeSaveStorageFile()
{
  auto directory = "unit/data";

  if (std::filesystem::exists(directory)) {
    std::filesystem::remove_all(directory);
  }

  return std::make_shared<
    Viet::AsyncSaveStorage<MpChangeForm, FormDesc, std::vector<FormDesc>>>(
    std::make_shared<FileDatabase>(directory, spdlog::default_logger()),
    spdlog::default_logger(), "file");
}

std::shared_ptr<
  Viet::ISaveStorage<MpChangeForm, FormDesc, std::vector<FormDesc>>>
MakeSaveStorageZip()
{
  auto archivePath = "world.zip";

  if (std::filesystem::exists(archivePath)) {
    std::filesystem::remove(archivePath);
  }

  return std::make_shared<
    Viet::AsyncSaveStorage<MpChangeForm, FormDesc, std::vector<FormDesc>>>(
    std::make_shared<ZipDatabase>(archivePath, spdlog::default_logger()),
    spdlog::default_logger(), "zip");
}

std::vector<std::shared_ptr<
  Viet::ISaveStorage<MpChangeForm, FormDesc, std::vector<FormDesc>>>>
MakeSaveStorages()
{
  return { MakeSaveStorageFile(), MakeSaveStorageZip() };
}

MpChangeForm CreateChangeForm(const char* descStr)
{
  MpChangeForm res;
  res.formDesc = FormDesc::FromString(descStr);
  return res;
}

void UpsertSync(
  Viet::ISaveStorage<MpChangeForm, FormDesc, std::vector<FormDesc>>& st,
  std::vector<std::optional<MpChangeForm>> changeForms)
{
  bool finished = false;
  st.Upsert(std::move(changeForms), [&] { finished = true; });

  int i = 0;
  while (!finished) {
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
    st.Tick();
    ++i;
    if (i > 2000)
      throw std::runtime_error("Timeout exceeded");
  }
}

void WaitForNextUpsert(
  Viet::ISaveStorage<MpChangeForm, FormDesc, std::vector<FormDesc>>& st,
  WorldState& wst)
{
  uint32_t n = st.GetNumFinishedUpserts();

  int i = 0;
  while (n == st.GetNumFinishedUpserts()) {
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
    wst.Tick(); // should include st.Tick()

    ++i;
    if (i > 2000)
      throw std::runtime_error("Timeout exceeded");
  }
}

TEST_CASE("ChangeForm with spaces is saved correctly", "[save]")
{
  auto storagesToTest = MakeSaveStorages();

  for (const auto& st : storagesToTest) {
    SECTION("Testing with " + st->GetName())
    {
      MpChangeForm f1;
      f1.formDesc = { 1, "" };

      Appearance appearance;
      appearance.name = "La La La";
      appearance.weight = 0.1;

      f1.appearanceDump = appearance.ToJson();

      UpsertSync(*st, { f1 });

      auto res = Viet::ISaveStorageUtils::FindAllSync(*st);
      REQUIRE(res.size() == 1);
      REQUIRE(res[{ 1, "" }].appearanceDump == appearance.ToJson());
    }
  }
}

TEST_CASE("ChangeForm is saved correctly", "[save]")
{
  auto storagesToTest = MakeSaveStorages();

  for (const auto& st : storagesToTest) {
    SECTION("Testing with " + st->GetName())
    {
      MpChangeForm f1, f2;
      f1.formDesc = { 1, "" };
      f1.position = { 1, 2, 3 };
      f1.appearanceDump = "{}";
      f1.inv.AddItem(0xf, 1000);
      f1.equipment = Equipment();
      f1.actorValues.healthPercentage = 0.25f;
      f1.actorValues.magickaPercentage = 0.3f;
      f1.actorValues.staminaPercentage = 1.0f;
      f2.formDesc = { 2, "" };
      f2.position = { 2, 4, 6 };
      f2.isDisabled = true;
      f2.profileId = 10;
      f2.actorValues.healthPercentage = 0;
      f2.actorValues.magickaPercentage = 0;
      f2.actorValues.staminaPercentage = 0;
      UpsertSync(*st, { f1, f2 });
      Faction faction = Faction();
      faction.formDesc = FormDesc(13, "Skyrim.esm");
      faction.rank = 10;
      f2.factions = std::vector<Faction>();
      f2.factions.value().push_back(faction);
      UpsertSync(*st, { f1, f2 });

      auto res = Viet::ISaveStorageUtils::FindAllSync(*st);
      REQUIRE(res.size() == 2);
      REQUIRE(res[{ 1, "" }].position == NiPoint3(1, 2, 3));
      REQUIRE(res[{ 1, "" }].appearanceDump == "{}");
      REQUIRE(res[{ 1, "" }].equipment == Equipment());
      REQUIRE(res[{ 1, "" }].inv == Inventory().AddItem(0xf, 1000));
      REQUIRE(res[{ 1, "" }].isDisabled == false);
      REQUIRE(res[{ 1, "" }].profileId == -1);
      REQUIRE(res[{ 1, "" }].actorValues.healthPercentage == 0.25f);
      REQUIRE(res[{ 1, "" }].actorValues.magickaPercentage == 0.3f);
      REQUIRE(res[{ 1, "" }].actorValues.staminaPercentage == 1.0f);
      REQUIRE(res[{ 2, "" }].position == NiPoint3(2, 4, 6));
      REQUIRE(res[{ 2, "" }].isDisabled == true);
      REQUIRE(res[{ 2, "" }].profileId == 10);
      REQUIRE(res[{ 2, "" }].actorValues.healthPercentage == 0);
      REQUIRE(res[{ 2, "" }].actorValues.magickaPercentage == 0);
      REQUIRE(res[{ 2, "" }].actorValues.staminaPercentage == 0);
      REQUIRE(res[{ 2, "" }].factions.has_value());
      REQUIRE(res[{ 2, "" }].factions.value().size() == 1);
      REQUIRE(res[{ 2, "" }].factions.value()[0].formDesc.shortFormId == 13);
      REQUIRE(res[{ 2, "" }].factions.value()[0].formDesc.file ==
              "Skyrim.esm");
      REQUIRE(res[{ 2, "" }].factions.value()[0].rank == 10);
    }
  }
}

TEST_CASE("Upsert affects the number of change forms in the database in the "
          "correct way",
          "[save]")
{
  auto storagesToTest = MakeSaveStorages();

  for (const auto& st : storagesToTest) {
    SECTION("Testing with " + st->GetName())
    {
      REQUIRE(Viet::ISaveStorageUtils::CountSync(*st) == 0);

      UpsertSync(*st,
                 { CreateChangeForm("0"), CreateChangeForm("1"),
                   CreateChangeForm("2") });

      REQUIRE(Viet::ISaveStorageUtils::CountSync(*st) == 3);

      UpsertSync(*st,
                 { CreateChangeForm("0"), CreateChangeForm("1"),
                   CreateChangeForm("2"), CreateChangeForm("3") });

      REQUIRE(Viet::ISaveStorageUtils::CountSync(*st) == 4);
    }
  }
}

TEST_CASE("AttachSaveStorage forces loading", "[save]")
{
  auto storagesToTest = MakeSaveStorages();

  for (const auto& st : storagesToTest) {
    SECTION("Testing with " + st->GetName())
    {
      PartOne p;
      p.worldState.espmFiles = std::vector<std::string>{ "AaAaAa.esm" };
      p.worldState.AddForm(
        std::unique_ptr<MpObjectReference>(new MpObjectReference(
          LocationalData(), FormCallbacks::DoNothing(), 0xaaaa, "STAT")),
        0xee);

      auto& refr = p.worldState.GetFormAt<MpObjectReference>(0xee);
      REQUIRE(refr.GetPos() == NiPoint3(0, 0, 0));

      auto f = CreateChangeForm("ee:AaAaAa.esm");
      f.position = { 1, 1, 1 };
      f.baseDesc = FormDesc::FromString("aaaa:AaAaAa.esm");
      UpsertSync(*st, { f });
      p.AttachSaveStorage(st);

      REQUIRE(refr.GetPos() == NiPoint3(1, 1, 1));
    }
  }
}

TEST_CASE("Changes are transferred to SaveStorage", "[save]")
{
  auto storagesToTest = MakeSaveStorages();

  for (const auto& st : storagesToTest) {
    SECTION("Testing with " + st->GetName())
    {
      PartOne p;
      p.AttachSaveStorage(st);

      REQUIRE(Viet::ISaveStorageUtils::CountSync(*st) == 0);
      p.CreateActor(0xffaaaeee, { 1, 1, 1 }, 1, 0x3c);

      WaitForNextUpsert(*st, p.worldState);
      REQUIRE(Viet::ISaveStorageUtils::CountSync(*st) == 1);
    }
  }
}

TEST_CASE("FileDatabase writes a batch whole and leaves no temp files",
          "[save]")
{
  const bool batchedSync = GENERATE(true, false);
  auto directory = "unit/data";
  if (std::filesystem::exists(directory)) {
    std::filesystem::remove_all(directory);
  }
  FileDatabase db(directory, spdlog::default_logger(), batchedSync);

  auto makeBatch = [](float x) {
    std::vector<std::optional<MpChangeForm>> forms;
    forms.push_back(std::nullopt);
    for (const char* desc : { "0:Skyrim.esm", "1:Skyrim.esm", "ff000729" }) {
      MpChangeForm cf = CreateChangeForm(desc);
      cf.position = { x, 2.f, 3.f };
      forms.push_back(cf);
    }
    return forms;
  };

  REQUIRE(db.Upsert(makeBatch(1.f)) == 3);
  REQUIRE(db.Upsert(makeBatch(7.f)) == 3);

  const std::filesystem::path dir =
    std::filesystem::path(directory) / "changeForms";
  size_t numJson = 0;
  for (auto& entry : std::filesystem::directory_iterator(dir)) {
    REQUIRE(entry.path().extension() == ".json");
    REQUIRE(std::filesystem::file_size(entry.path()) > 0);
    ++numJson;
  }
  REQUIRE(numJson == 3);

  std::vector<MpChangeForm> loaded;
  db.Iterate([&](const MpChangeForm& cf) { loaded.push_back(cf); },
             std::nullopt);
  REQUIRE(loaded.size() == 3);
  for (auto& cf : loaded) {
    REQUIRE(cf.position.x == 7.f);
  }
}

namespace {
size_t CountFilesWithExtension(const std::filesystem::path& dir,
                               const std::string& extension)
{
  size_t n = 0;
  for (auto& entry : std::filesystem::directory_iterator(dir)) {
    if (entry.path().extension() == extension) {
      ++n;
    }
  }
  return n;
}

std::map<FormDesc, MpChangeForm> ReadFromDisk(const std::string& directory)
{
  std::map<FormDesc, MpChangeForm> res;
  FileDatabase db(directory, spdlog::default_logger());
  db.Iterate([&](const MpChangeForm& cf) { res[cf.formDesc] = cf; },
             std::nullopt);
  return res;
}

void TickFor(WorldState& wst, std::chrono::milliseconds duration)
{
  auto end = std::chrono::steady_clock::now() + duration;
  while (std::chrono::steady_clock::now() < end) {
    wst.Tick();
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
}

// Records the order of writes; the first Upsert is slow, so a batch is still being written when FlushSync starts
class RecordingDatabase
  : public Viet::IDatabase<MpChangeForm, FormDesc, std::vector<FormDesc>>
{
public:
  std::atomic<int> numUpserts = 0;
  std::vector<float> writes;
  std::map<FormDesc, MpChangeForm> stored;

  void Iterate(const IterateCallback& cb,
               std::optional<std::vector<FormDesc>>) override
  {
    for (auto& [desc, cf] : stored) {
      cb(cf);
    }
  }

private:
  std::vector<std::optional<MpChangeForm>>&& UpsertImpl(
    std::vector<std::optional<MpChangeForm>>&& changeForms,
    size_t& outNumUpserted) override
  {
    if (numUpserts++ == 0) {
      std::this_thread::sleep_for(std::chrono::milliseconds(300));
    }
    for (auto& cf : changeForms) {
      if (cf) {
        writes.push_back(cf->position.x);
        stored[cf->formDesc] = *cf;
        ++outNumUpserted;
      }
    }
    return std::move(changeForms);
  }
};
}

TEST_CASE("FileDatabase syncs a batch bigger than one chunk", "[save]")
{
  const bool batchedSync = GENERATE(true, false);
  auto directory = "unit/data";
  if (std::filesystem::exists(directory)) {
    std::filesystem::remove_all(directory);
  }
  FileDatabase db(directory, spdlog::default_logger(), batchedSync);

  std::vector<std::optional<MpChangeForm>> forms;
  for (int i = 0; i < 130; ++i) {
    MpChangeForm cf =
      CreateChangeForm(fmt::format("{:x}", 0xff000000 + i).data());
    cf.position = { static_cast<float>(i), 0.f, 0.f };
    forms.push_back(cf);
  }
  REQUIRE(db.Upsert(std::move(forms)) == 130);

  auto dir = std::filesystem::path(directory) / "changeForms";
  REQUIRE(CountFilesWithExtension(dir, ".json") == 130);
  REQUIRE(CountFilesWithExtension(dir, ".tmp") == 0);
  auto res = ReadFromDisk(directory);
  REQUIRE(res.size() == 130);
  REQUIRE(res[FormDesc::FromString("ff000081")].position.x == 129.f);
}

TEST_CASE("saveIntervalMs is read from the server settings", "[save]")
{
  using J = nlohmann::json;
  std::string warning;
  REQUIRE(DatabaseFactory::GetSaveIntervalMs(J::object(), &warning) == 5000);
  REQUIRE(DatabaseFactory::GetSaveIntervalMs(J{ { "saveIntervalMs", 0 } },
                                             &warning) == 0);
  REQUIRE(DatabaseFactory::GetSaveIntervalMs(J{ { "saveIntervalMs", 2500 } },
                                             &warning) == 2500);
  REQUIRE(warning.empty());

  for (J bad : { J(-1), J("5000"), J(1.5), J(nullptr) }) {
    warning.clear();
    REQUIRE(DatabaseFactory::GetSaveIntervalMs(J{ { "saveIntervalMs", bad } },
                                               &warning) == 5000);
    REQUIRE(!warning.empty());
  }

  warning.clear();
  REQUIRE(DatabaseFactory::GetSaveIntervalMs(
            J{ { "saveIntervalMs", 3600000 } }, &warning) == 60000);
  REQUIRE(!warning.empty());
}

TEST_CASE("Changes inside the save interval reach the saver in one batch",
          "[save]")
{
  auto st = MakeSaveStorageFile();
  PartOne p;
  p.AttachSaveStorage(st);
  p.worldState.SetSaveInterval(std::chrono::minutes(1));

  // The first change after a quiet spell goes at once
  p.CreateActor(0xff000a01, { 1, 1, 1 }, 1, 0x3c);
  WaitForNextUpsert(*st, p.worldState);
  REQUIRE(Viet::ISaveStorageUtils::CountSync(*st) == 1);

  p.CreateActor(0xff000a02, { 1, 1, 1 }, 1, 0x3c);
  p.CreateActor(0xff000a03, { 1, 1, 1 }, 1, 0x3c);
  auto numUpserts = st->GetNumFinishedUpserts();
  TickFor(p.worldState, std::chrono::milliseconds(300));
  REQUIRE(st->GetNumFinishedUpserts() == numUpserts);
  REQUIRE(Viet::ISaveStorageUtils::CountSync(*st) == 1);

  p.worldState.RequestSaveNow();
  WaitForNextUpsert(*st, p.worldState);
  REQUIRE(st->GetNumFinishedUpserts() == numUpserts + 1);
  REQUIRE(Viet::ISaveStorageUtils::CountSync(*st) == 3);
}

TEST_CASE("A record changed on every tick is saved at most once per interval",
          "[save]")
{
  auto st = MakeSaveStorageFile();
  PartOne p;
  p.AttachSaveStorage(st);
  p.CreateActor(0xff000a01, { 1, 1, 1 }, 1, 0x3c);
  auto& actor = p.worldState.GetFormAt<MpActor>(0xff000a01);
  WaitForNextUpsert(*st, p.worldState);

  constexpr auto kInterval = std::chrono::milliseconds(250);
  p.worldState.SetSaveInterval(kInterval);
  auto numUpserts = st->GetNumFinishedUpserts();
  auto start = std::chrono::steady_clock::now();
  for (int i = 0; std::chrono::steady_clock::now() - start <
       std::chrono::milliseconds(1500);
       ++i) {
    actor.SetPercentages({ 1.f, (i % 100 + 1) / 128.f, 1.f });
    p.worldState.Tick();
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
  }
  auto elapsed = std::chrono::steady_clock::now() - start;

  // The batch handed over at the start may finish late, hence one extra
  auto maxBatches = static_cast<uint32_t>(elapsed / kInterval) + 2;
  REQUIRE(st->GetNumFinishedUpserts() - numUpserts <= maxBatches);
}

TEST_CASE("FlushSaveStorageSync writes the changes still waiting for the "
          "interval",
          "[save]")
{
  auto st = MakeSaveStorageFile();
  PartOne p;
  p.AttachSaveStorage(st);
  p.worldState.SetSaveInterval(std::chrono::minutes(1));

  p.CreateActor(0xff000a01, { 1, 1, 1 }, 1, 0x3c);
  WaitForNextUpsert(*st, p.worldState);

  auto& actor = p.worldState.GetFormAt<MpActor>(0xff000a01);
  actor.SetPercentages({ 1.f, 0.5f, 1.f });
  p.CreateActor(0xff000a02, { 1, 1, 1 }, 1, 0x3c);
  p.worldState.Tick();
  REQUIRE(ReadFromDisk("unit/data").size() == 1);

  p.worldState.FlushSaveStorageSync();

  auto res = ReadFromDisk("unit/data");
  REQUIRE(res.size() == 2);
  REQUIRE(
    res[FormDesc::FromString("ff000a01")].actorValues.magickaPercentage ==
    0.5f);
  REQUIRE(CountFilesWithExtension("unit/data/changeForms", ".tmp") == 0);
}

TEST_CASE("FlushSync writes the batches already handed over first, so the "
          "newest copy wins",
          "[save]")
{
  auto db = std::make_shared<RecordingDatabase>();
  Viet::AsyncSaveStorage<MpChangeForm, FormDesc, std::vector<FormDesc>> st(
    db, spdlog::default_logger(), "recording", 1);

  auto version = [](float x) {
    MpChangeForm cf = CreateChangeForm("1");
    cf.position = { x, 0.f, 0.f };
    return std::vector<std::optional<MpChangeForm>>{ cf };
  };

  st.Upsert(version(1.f), [] {});
  for (int i = 0; db->numUpserts == 0; ++i) {
    REQUIRE(i < 2000);
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  st.Upsert(version(2.f), [] {});
  st.FlushSync(version(3.f));

  REQUIRE(db->writes == std::vector<float>{ 1.f, 2.f, 3.f });
  REQUIRE(db->stored[FormDesc::FromString("1")].position.x == 3.f);

  // Saves after the flush are written before Upsert returns
  st.Upsert(version(4.f), [] {});
  REQUIRE(db->writes.back() == 4.f);
}
