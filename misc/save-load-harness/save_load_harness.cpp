// Drives the real save path (PartOne, WorldState, AsyncSaveStorage, FileDatabase) with a load shaped like the
// 17 Oct 2026 live trace; prints sync calls per second, how much a crash would lose, and what a clean stop leaves
// Usage: save_load_harness <empty work dir> <seconds> [saveIntervalMs]; build with HARNESS_LEGACY for origin/main
#include "Appearance.h"
#include "MpActor.h"
#include "PartOne.h"
#include "database_drivers/FileDatabase.h"
#include "sync_counter.h"
#include <algorithm>
#include <cmath>
#include <filesystem>
#include <random>
#include <save_storages/SaveStorageFactory.h>
#include <unistd.h>
#ifndef HARNESS_LEGACY
#  include "database_drivers/DatabaseFactory.h"
#endif

namespace {
using Clock = std::chrono::steady_clock;

struct Kind
{
  const char* name;
  int count;
  double periodSec;
  size_t payloadBytes;
};

// 120 s live trace, 33 online: players 86% of saves across 34 records of 42-91 KB, NPCs 167 saves across 92 records
constexpr Kind kKinds[] = {
  { "hot player", 13, 0.7, 20000 },
  { "player", 21, 3.0, 20000 },
  { "npc", 92, 60.0, 1500 },
  { "reference", 53, 200.0, 1000 },
};

struct Record
{
  uint32_t formId = 0;
  std::string key;
  double periodSec = 0;
  double nextEdit = 0;
  int version = 0;
  std::vector<double> editTime;
};

float Marker(int version)
{
  return 0.25f + static_cast<float>(version) / 1024.f;
}

int VersionOf(float magicka)
{
  return static_cast<int>(std::lround((magicka - 0.25f) * 1024.f));
}

std::unordered_map<std::string, int> ReadDiskVersions(const std::string& dir)
{
  std::unordered_map<std::string, int> res;
  FileDatabase db(dir, spdlog::default_logger());
  db.Iterate(
    [&](const MpChangeForm& cf) {
      res[cf.formDesc.ToString()] =
        VersionOf(cf.actorValues.magickaPercentage);
    },
    std::nullopt);
  return res;
}

struct LossSample
{
  int recordsBehind = 0;
  double maxLostSec = 0;
};

// What a crash right now would lose: per record, the age of its oldest change not yet on disk
LossSample SampleLoss(const std::vector<Record>& records,
                      const std::string& dir, double now)
{
  auto disk = ReadDiskVersions(dir);
  LossSample s;
  for (auto& r : records) {
    auto it = disk.find(r.key);
    int onDisk = it == disk.end() ? -1 : it->second;
    if (onDisk < r.version) {
      ++s.recordsBehind;
      s.maxLostSec = std::max(s.maxLostSec, now - r.editTime[onDisk + 1]);
    }
  }
  return s;
}

size_t CountTempFiles(const std::string& dir)
{
  size_t n = 0;
  for (auto& e : std::filesystem::directory_iterator(
         std::filesystem::path(dir) / "changeForms")) {
    n += e.path().extension() == ".tmp";
  }
  return n;
}
}

int main(int argc, char** argv)
{
  if (argc < 3) {
    fprintf(stderr, "usage: %s <work dir> <seconds> [saveIntervalMs]\n",
            argv[0]);
    return 2;
  }
  const std::string dir = argv[1];
  const double seconds = std::stod(argv[2]);
  const uint32_t intervalMs = argc > 3 ? std::stoul(argv[3]) : 0;
  spdlog::set_level(spdlog::level::warn);

  std::filesystem::remove_all(dir);
  auto logger = spdlog::default_logger();
  std::shared_ptr<
    Viet::IDatabase<MpChangeForm, FormDesc, std::vector<FormDesc>>>
    db;
#ifdef HARNESS_LEGACY
  const char* mode = "origin/main (live code)";
  db = std::make_shared<FileDatabase>(dir, logger);
#else
  const char* mode = "branch";
  db = DatabaseFactory::Create({ { "databaseDriver", "file" },
                                 { "databaseName", dir },
                                 { "saveIntervalMs", intervalMs } },
                               logger);
#endif
  auto st =
    Viet::SaveStorageFactory::Create<MpChangeForm, FormDesc>(db, logger);
  PartOne p;
  p.AttachSaveStorage(st);
#ifndef HARNESS_LEGACY
  p.worldState.SetSaveInterval(std::chrono::milliseconds(intervalMs));
#endif

  std::mt19937 rng(17);
  std::uniform_real_distribution<double> unit(0.0, 1.0);
  std::vector<Record> records;
  uint32_t nextFormId = 0xff100000;
  for (auto& kind : kKinds) {
    Appearance appearance;
    appearance.name = std::string(kind.payloadBytes, 'x');
    for (int i = 0; i < kind.count; ++i) {
      Record r;
      r.formId = nextFormId++;
      p.CreateActor(r.formId, { 0, 0, 0 }, 0, 0x3c);
      auto& actor = p.worldState.GetFormAt<MpActor>(r.formId);
      actor.SetAppearance(&appearance);
      actor.SetPercentages({ 1.f, Marker(0), 1.f });
      r.key = actor.GetChangeForm().formDesc.ToString();
      r.periodSec = kind.periodSec;
      r.nextEdit = unit(rng) * kind.periodSec;
      r.editTime.push_back(0);
      records.push_back(std::move(r));
    }
  }

  // The first save writes every record; measure only once it has drained
  auto warmStart = Clock::now(), lastSyncSeen = Clock::now();
  uint64_t lastCount = 0;
  while (Clock::now() - warmStart < std::chrono::seconds(60)) {
    p.Tick();
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
    uint64_t n = SyncCounter::fdatasyncCalls + SyncCounter::fsyncCalls;
    if (n != lastCount) {
      lastCount = n;
      lastSyncSeen = Clock::now();
    }
    if (n > 0 && Clock::now() - lastSyncSeen > std::chrono::seconds(1)) {
      break;
    }
  }
  SyncCounter::Reset();

  const auto t0 = Clock::now();
  auto since = [&] {
    return std::chrono::duration<double>(Clock::now() - t0).count();
  };
  for (auto& r : records) {
    r.editTime.assign(1, -1.0);
  }

  uint64_t edits = 0;
  double nextSample = 1.0;
  std::vector<LossSample> samples;
  while (since() < seconds) {
    double now = since();
    for (auto& r : records) {
      if (now < r.nextEdit) {
        continue;
      }
      ++r.version;
      r.editTime.push_back(now);
      ++edits;
      p.worldState.GetFormAt<MpActor>(r.formId).SetPercentages(
        { 1.f, Marker(r.version), 1.f });
      r.nextEdit += r.periodSec * (0.8 + 0.4 * unit(rng));
    }
    p.Tick();
    if (now >= nextSample) {
      samples.push_back(SampleLoss(records, dir, since()));
      nextSample += 1.0;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  const double elapsed = since();
  const uint64_t fdatasyncs = SyncCounter::fdatasyncCalls,
                 fsyncs = SyncCounter::fsyncCalls,
                 ranges = SyncCounter::syncFileRangeCalls,
                 commits = SyncCounter::commits;

  // Clean stop: what SIGTERM does in this build, then the disk is read at once, as the process would exit
  auto stopStart = Clock::now();
#ifndef HARNESS_LEGACY
  p.worldState.FlushSaveStorageSync();
#endif
  double stopMs =
    std::chrono::duration<double, std::milli>(Clock::now() - stopStart)
      .count();
  auto atStop = SampleLoss(records, dir, since());
  size_t tempFiles = CountTempFiles(dir);

  double maxLost = 0, sumLost = 0;
  for (auto& s : samples) {
    maxLost = std::max(maxLost, s.maxLostSec);
    sumLost += s.maxLostSec;
  }
  printf(
    "mode=%s saveIntervalMs=%u records=%zu seconds=%.1f edits_per_s=%.1f\n",
    mode, intervalMs, records.size(), elapsed, edits / elapsed);
  printf("files_synced_per_s=%.2f (fdatasync) batches_per_s=%.2f (folder "
         "fsync) sync_calls_per_s=%.2f sync_file_range_per_s=%.2f "
         "emulated_commits_per_s=%.2f files_per_batch=%.1f\n",
         fdatasyncs / elapsed, fsyncs / elapsed,
         (fdatasyncs + fsyncs) / elapsed, ranges / elapsed, commits / elapsed,
         fsyncs ? double(fdatasyncs) / fsyncs : 0.0);
  printf("crash_loss_sampled_every_1s: samples=%zu max_s=%.2f mean_s=%.2f\n",
         samples.size(), maxLost,
         samples.empty() ? 0 : sumLost / samples.size());
  printf("clean_stop: flush_ms=%.0f records_behind=%d max_lost_s=%.2f "
         "tmp_files_left=%zu\n",
         stopMs, atStop.recordsBehind, atStop.maxLostSec, tempFiles);
  fflush(stdout);

  // Like process.exit: no destructors, so a saver thread still writing is cut off
  _exit(0);
}
