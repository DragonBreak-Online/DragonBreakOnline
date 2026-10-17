#pragma once
#include "MpChangeForms.h"
#include <database_drivers/IDatabase.h>
#include <memory>
#include <spdlog/spdlog.h>

class DatabaseFactory
{
public:
  static std::shared_ptr<
    Viet::IDatabase<MpChangeForm, FormDesc, std::vector<FormDesc>>>
  Create(nlohmann::json settings, std::shared_ptr<spdlog::logger> logger);

  // server-settings saveIntervalMs: changed records go to the saver at most this often; 0 is the save path before 17 Oct 2026
  static constexpr uint32_t kDefaultSaveIntervalMs = 5000;
  static constexpr uint32_t kMaxSaveIntervalMs = 60000;

  // Sets outWarning when the setting is ignored or capped
  static uint32_t GetSaveIntervalMs(const nlohmann::json& settings,
                                    std::string* outWarning = nullptr);
};
