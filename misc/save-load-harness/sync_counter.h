#pragma once
#include <atomic>
#include <cstdint>

namespace SyncCounter {
// Emulated HDD, from the 17 Oct CT 115 measurements: per-file write plus fdatasync median 42 ms, 27 files batched 0.24 s
constexpr double kCommitBaseMs = 35.0;
constexpr double kCommitPerFileMs = 7.0;
constexpr double kCheapSyncMs = 3.0;

extern std::atomic<uint64_t> fdatasyncCalls;
extern std::atomic<uint64_t> fsyncCalls;
extern std::atomic<uint64_t> syncFileRangeCalls;
extern std::atomic<uint64_t> commits;

void Reset();
}
