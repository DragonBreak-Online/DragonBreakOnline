#pragma once
#include "MpChangeForms.h"
#include <database_drivers/IDatabase.h>
#include <spdlog/spdlog.h>

class FileDatabase
  : public Viet::IDatabase<MpChangeForm, FormDesc, std::vector<FormDesc>>
{
public:
  // batchedSync false: each file is written and synced on its own (the save path before 17 Oct 2026)
  FileDatabase(std::string directory_, std::shared_ptr<spdlog::logger> logger_,
               bool batchedSync_ = true);

  void Iterate(const IterateCallback& iterateCallback,
               std::optional<std::vector<FormDesc>> filter) override;

private:
  std::vector<std::optional<MpChangeForm>>&& UpsertImpl(
    std::vector<std::optional<MpChangeForm>>&& changeForms,
    size_t& outNumUpserted) override;

  struct Impl;
  std::shared_ptr<Impl> pImpl;
};
