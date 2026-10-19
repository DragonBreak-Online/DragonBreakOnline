// Linked with -Wl,--wrap=open,--wrap=fdatasync,--wrap=fsync,--wrap=sync_file_range: counts the save path's sync calls
// and emulates an HDD journal instead of syncing, so a run puts almost no flush load on the real disk
#include "sync_counter.h"
#include <chrono>
#include <cstdarg>
#include <cstdlib>
#include <fcntl.h>
#include <mutex>
#include <thread>
#include <unordered_map>

extern "C" {
int __real_open(const char* path, int flags, ...);
int __real_fdatasync(int fd);
int __real_fsync(int fd);
int __real_sync_file_range(int fd, off64_t offset, off64_t nbytes,
                           unsigned int flags);
}

namespace {
std::mutex g_m;
uint64_t g_opSeq = 0;
uint64_t g_lastCommitSeq = 0;
uint64_t g_filesSinceCommit = 0;
std::unordered_map<int, uint64_t> g_openSeqByFd;

bool RealSync()
{
  static const bool real = std::getenv("SAVE_HARNESS_REAL_SYNC") != nullptr;
  return real;
}

void Sleep(double ms)
{
  std::this_thread::sleep_for(std::chrono::microseconds(int64_t(ms * 1000)));
}

// One journal commit carries every file written since the previous one; the caller holds g_m
double TakeCommitLocked()
{
  double cost = SyncCounter::kCommitBaseMs +
    SyncCounter::kCommitPerFileMs * double(g_filesSinceCommit);
  g_filesSinceCommit = 0;
  g_lastCommitSeq = g_opSeq;
  SyncCounter::commits++;
  return cost;
}
}

namespace SyncCounter {
std::atomic<uint64_t> fdatasyncCalls = 0;
std::atomic<uint64_t> fsyncCalls = 0;
std::atomic<uint64_t> syncFileRangeCalls = 0;
std::atomic<uint64_t> commits = 0;

void Reset()
{
  fdatasyncCalls = fsyncCalls = syncFileRangeCalls = commits = 0;
}
}

extern "C" {
int __wrap_open(const char* path, int flags, ...)
{
  mode_t mode = 0;
  if (flags & O_CREAT) {
    va_list ap;
    va_start(ap, flags);
    mode = va_arg(ap, int);
    va_end(ap);
  }
  int fd = __real_open(path, flags, mode);
  if (fd >= 0 && (flags & (O_WRONLY | O_RDWR))) {
    std::lock_guard l(g_m);
    g_openSeqByFd[fd] = ++g_opSeq;
    ++g_filesSinceCommit;
  }
  return fd;
}

// fdatasync commits the journal only when the file was written after the last commit; else it is a cache flush
int __wrap_fdatasync(int fd)
{
  SyncCounter::fdatasyncCalls++;
  if (RealSync()) {
    return __real_fdatasync(fd);
  }
  double cost = SyncCounter::kCheapSyncMs;
  {
    std::lock_guard l(g_m);
    auto it = g_openSeqByFd.find(fd);
    if (it == g_openSeqByFd.end() || it->second > g_lastCommitSeq) {
      cost = TakeCommitLocked();
    }
  }
  Sleep(cost);
  return 0;
}

// The folder fsync follows the renames, which are new metadata: always a commit
int __wrap_fsync(int fd)
{
  SyncCounter::fsyncCalls++;
  if (RealSync()) {
    return __real_fsync(fd);
  }
  double cost;
  {
    std::lock_guard l(g_m);
    cost = TakeCommitLocked();
  }
  Sleep(cost);
  return 0;
}

int __wrap_sync_file_range(int fd, off64_t offset, off64_t nbytes,
                           unsigned int flags)
{
  SyncCounter::syncFileRangeCalls++;
  if (RealSync()) {
    return __real_sync_file_range(fd, offset, nbytes, flags);
  }
  return 0;
}
}
