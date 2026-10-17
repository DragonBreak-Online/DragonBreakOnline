#include "FileDatabase.h"
#include <filesystem>
#include <fstream>
#include <save_storages/AsyncSaveStorage.h>
#include <unordered_set>
#include <utility>

#ifndef _WIN32
#  include <cerrno>
#  include <cstring>
#  include <fcntl.h>
#  include <unistd.h>
#endif

struct FileDatabase::Impl
{
  const std::filesystem::path changeFormsDirectory;
  const std::shared_ptr<spdlog::logger> logger;
  const bool batchedSync;
};

FileDatabase::FileDatabase(std::string directory_,
                           std::shared_ptr<spdlog::logger> logger_,
                           bool batchedSync_)
{
  std::filesystem::path p = directory_;
  p /= "changeForms";

  pImpl.reset(new Impl{ p, logger_, batchedSync_ });
  std::filesystem::create_directories(p);
}

namespace {
#ifndef _WIN32
int OpenAndWrite(const std::filesystem::path& path, const std::string& data)
{
  int fd =
    ::open(path.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
  if (fd < 0) {
    throw std::runtime_error(fmt::format("Unable to open file {}: {}",
                                         path.string(), std::strerror(errno)));
  }
  size_t written = 0;
  while (written < data.size()) {
    ssize_t n = ::write(fd, data.data() + written, data.size() - written);
    if (n < 0 && errno == EINTR) {
      continue;
    }
    if (n <= 0) {
      int err = errno;
      ::close(fd);
      throw std::runtime_error(fmt::format(
        "Unable to write file {}: {}", path.string(), std::strerror(err)));
    }
    written += static_cast<size_t>(n);
  }
  return fd;
}

// Closes fd in every case
void SyncAndClose(int fd, const std::filesystem::path& path)
{
  if (::fdatasync(fd) != 0) {
    int err = errno;
    ::close(fd);
    throw std::runtime_error(fmt::format(
      "Unable to flush file {}: {}", path.string(), std::strerror(err)));
  }
  if (::close(fd) != 0) {
    throw std::runtime_error(fmt::format(
      "Unable to close file {}: {}", path.string(), std::strerror(errno)));
  }
}
#endif

// Data reaches the disk before the rename, so a host crash never leaves a zero-filled file; runs on the saver thread
void WriteDurably(const std::filesystem::path& path, const std::string& data)
{
#ifdef _WIN32
  std::ofstream f(path, std::ios::binary | std::ios::trunc);
  if (!f) {
    throw std::runtime_error(
      fmt::format("Unable to open file {}", path.string()));
  }
  f << data;
  f.flush();
  if (!f) {
    throw std::runtime_error(
      fmt::format("Unknown error while writing file {}", path.string()));
  }
#else
  SyncAndClose(OpenAndWrite(path, data), path);
#endif
}

#ifndef _WIN32
// Bounds the descriptors a batch holds open at once
constexpr size_t kMaxFilesPerSyncChunk = 128;

struct OpenTempFile
{
  std::filesystem::path path;
  int fd = -1;
};

// Same guarantee as WriteDurably for each file, with one journal commit for the chunk instead of one per file
class SyncChunk
{
public:
  SyncChunk() = default;
  SyncChunk(const SyncChunk&) = delete;
  SyncChunk& operator=(const SyncChunk&) = delete;

  ~SyncChunk()
  {
    for (auto& file : files) {
      if (file.fd >= 0) {
        ::close(file.fd);
      }
    }
  }

  void Add(std::filesystem::path path, const std::string& data)
  {
    auto& file = files.emplace_back(OpenTempFile{ std::move(path) });
    file.fd = OpenAndWrite(file.path, data);
  }

  bool IsFull() const { return files.size() >= kMaxFilesPerSyncChunk; }

  void SyncAll()
  {
#  ifdef __linux__
    // Starts writeback of every file at once, so all their blocks land in the transaction the first fdatasync commits
    for (auto& file : files) {
      ::sync_file_range(file.fd, 0, 0, SYNC_FILE_RANGE_WRITE);
    }
#  endif
    for (auto& file : files) {
      int fd = std::exchange(file.fd, -1);
      SyncAndClose(fd, file.path);
    }
    files.clear();
  }

private:
  std::vector<OpenTempFile> files;
};
#endif

// Logged, not thrown: every file is whole already and a re-save would change nothing
void SyncDirectory(const std::filesystem::path& dir,
                   const std::shared_ptr<spdlog::logger>& logger)
{
#ifndef _WIN32
  int fd = ::open(dir.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (fd < 0) {
    if (logger) {
      logger->warn("FileDatabase: unable to open {} to flush it: {}",
                   dir.string(), std::strerror(errno));
    }
    return;
  }
  if (::fsync(fd) != 0 && logger) {
    logger->warn("FileDatabase: unable to flush {}: {}", dir.string(),
                 std::strerror(errno));
  }
  ::close(fd);
#endif
}
}

std::vector<std::optional<MpChangeForm>>&& FileDatabase::UpsertImpl(
  std::vector<std::optional<MpChangeForm>>&& changeForms,
  size_t& outNumUpserted)
{
  try {
    std::filesystem::path p = pImpl->changeFormsDirectory;

    // All files are flushed before the first rename: a crash mid-batch leaves each one old or new, never empty
    std::vector<std::pair<std::filesystem::path, std::filesystem::path>>
      renames;

#ifndef _WIN32
    std::optional<SyncChunk> chunk;
    if (pImpl->batchedSync) {
      chunk.emplace();
    }
#endif

    for (auto& changeForm : changeForms) {
      if (changeForm == std::nullopt) {
        continue;
      }

      std::string fileName = changeForm->formDesc.ToString('_') + ".json";
      auto tempFilePath = p / (fileName + ".tmp"), filePath = p / fileName;
      auto data = MpChangeForm::ToJson(*changeForm).dump(2);

#ifndef _WIN32
      if (chunk) {
        chunk->Add(tempFilePath, data);
        if (chunk->IsFull()) {
          chunk->SyncAll();
        }
      } else {
        WriteDurably(tempFilePath, data);
      }
#else
      WriteDurably(tempFilePath, data);
#endif
      renames.emplace_back(std::move(tempFilePath), std::move(filePath));
    }

#ifndef _WIN32
    if (chunk) {
      chunk->SyncAll();
    }
#endif

    for (auto& [tempFilePath, filePath] : renames) {
      std::error_code errorCode;
      std::filesystem::rename(tempFilePath, filePath, errorCode);
      if (errorCode) {
        throw std::runtime_error(
          fmt::format("Unable to rename {} to {}: {}", tempFilePath.string(),
                      filePath.string(), errorCode.message()));
      }
    }

    if (!renames.empty()) {
      SyncDirectory(p, pImpl->logger);
    }

    outNumUpserted = renames.size();
    return std::move(changeForms);
  } catch (std::exception& e) {
    throw Viet::AsyncSaveStorage<
      MpChangeForm, FormDesc,
      std::vector<FormDesc>>::UpsertFailedException(std::move(changeForms),
                                                    e.what());
  }
}

void FileDatabase::Iterate(const IterateCallback& iterateCallback,
                           std::optional<std::vector<FormDesc>> filter)
{
  try {

    auto p = pImpl->changeFormsDirectory;

    simdjson::dom::parser parser;

    if (!std::filesystem::exists(p)) {
      return;
    }

    std::optional<std::unordered_set<std::string>> filterSet;
    if (filter) {
      std::unordered_set<std::string>& value = filterSet.emplace();
      for (const auto& desc : *filter) {
        value.insert(desc.ToString());
      }
    }

    for (auto& entry : std::filesystem::directory_iterator(p)) {
      try {
        if (entry.path().extension() != ".json") {
          continue;
        }

        std::ifstream t(entry.path());
        std::string jsonDump((std::istreambuf_iterator<char>(t)),
                             std::istreambuf_iterator<char>());

        auto result = parser.parse(jsonDump).value();
        auto changeForm = MpChangeForm::JsonToChangeForm(result);

        if (filterSet) {
          if (filterSet->find(changeForm.formDesc.ToString()) ==
              filterSet->end()) {
            continue;
          }
        }

        iterateCallback(changeForm);
      } catch (std::exception& e) {
        pImpl->logger->error("Parsing of {} failed with {}",
                             entry.path().string(), e.what());
      }
    }

  } catch (std::exception& e) {
    throw Viet::AsyncSaveStorage<
      MpChangeForm, FormDesc,
      std::vector<FormDesc>>::IterateFailedException(std::move(filter),
                                                     e.what());
  }
}
