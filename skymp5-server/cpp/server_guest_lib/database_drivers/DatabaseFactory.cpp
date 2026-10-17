#include "DatabaseFactory.h"

#include <memory>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include "FileDatabase.h"
#include "MigrationDatabase.h"
#include "ZipDatabase.h"
#include <database_drivers/MongoDatabase.h>

std::shared_ptr<Viet::IDatabase<MpChangeForm, FormDesc, std::vector<FormDesc>>>
DatabaseFactory::Create(nlohmann::json settings,
                        std::shared_ptr<spdlog::logger> logger)
{
  auto databaseDriver = settings.count("databaseDriver")
    ? settings["databaseDriver"].get<std::string>()
    : std::string("file");

  if (databaseDriver == "file") {
    auto databaseName = settings.count("databaseName")
      ? settings["databaseName"].get<std::string>()
      : std::string("world");

    bool batchedSync = GetSaveIntervalMs(settings) != 0;
    logger->info("Using file with name '{}', {} sync", databaseName,
                 batchedSync ? "batched" : "per-file");
    return std::make_shared<FileDatabase>(databaseName, logger, batchedSync);
  }

  if (databaseDriver == "mongodb") {
    auto databaseName = settings.count("databaseName")
      ? settings["databaseName"].get<std::string>()
      : std::string("db");

    auto databaseUri = settings["databaseUri"].get<std::string>();
    logger->info("Using mongodb with name '" + databaseName + "'");
    return std::make_shared<MongoDatabase>(databaseUri, databaseName);
  }

  if (databaseDriver == "migration") {
    auto from = settings.at("databaseOld");
    auto to = settings.at("databaseNew");
    auto oldDatabase = Create(from, logger);
    auto newDatabase = Create(to, logger);
    return std::make_shared<MigrationDatabase>(newDatabase, oldDatabase);
  }

  if (databaseDriver == "zip") {
    auto databaseName = settings.count("databaseName")
      ? settings["databaseName"].get<std::string>()
      : std::string("world");

    logger->info("Using zip with name '" + databaseName + "'");
    return std::make_shared<ZipDatabase>(databaseName, logger);
  }

  throw std::runtime_error("Unrecognized databaseDriver: " + databaseDriver);
}

uint32_t DatabaseFactory::GetSaveIntervalMs(const nlohmann::json& settings,
                                            std::string* outWarning)
{
  auto it = settings.find("saveIntervalMs");
  if (it == settings.end()) {
    return kDefaultSaveIntervalMs;
  }

  if (!it->is_number_integer() || it->get<int64_t>() < 0) {
    if (outWarning) {
      *outWarning = fmt::format("saveIntervalMs must be a whole number of "
                                "milliseconds, 0 or more, not {}; using {}",
                                it->dump(), kDefaultSaveIntervalMs);
    }
    return kDefaultSaveIntervalMs;
  }

  auto value = it->get<int64_t>();
  if (value > kMaxSaveIntervalMs) {
    if (outWarning) {
      *outWarning = fmt::format("saveIntervalMs {} is above the cap; using {}",
                                value, kMaxSaveIntervalMs);
    }
    return kMaxSaveIntervalMs;
  }
  return static_cast<uint32_t>(value);
}
