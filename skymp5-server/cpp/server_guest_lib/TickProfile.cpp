#include "TickProfile.h"
#include "MsgType.h"
#include <algorithm>
#include <array>
#include <cstdlib>
#include <cstring>
#include <fmt/format.h>
#include <spdlog/spdlog.h>
#include <string>
#include <vector>

namespace {
constexpr uint64_t kWindowNs = 10'000'000'000ull;
constexpr size_t kMsgTypes = static_cast<size_t>(MsgType::Max);

const char* const kSectionNames[TickProfile::kSectionCount] = {
  "net",        "relaySubmit",  "relayFlush", "send",  "playbacks",
  "deferred",   "hostReleases", "staleHosts", "world",
  "moveValidate", "moveSetPos",
};

const char* MsgName(size_t t)
{
  static const char* const kNames[kMsgTypes] = {
    "Invalid",         "CustomPacket",
    "UpdateMovement",  "UpdateAnimation",
    "UpdateAppearance", "UpdateEquipment",
    "Activate",        "UpdateProperty",
    "PutItem",         "TakeItem",
    "FinishSpSnippet", "OnEquip",
    "ConsoleCommand",  "CraftItem",
    "Host",            "CustomEvent",
    "ChangeValues",    "OnHit",
    "DeathStateContainer", "DropItem",
    "Teleport",        "OpenContainer",
    "PlayerBowShot",   "SpellCast",
    "UpdateAnimVariables", "DestroyActor",
    "HostStart",       "HostStop",
    "SetInventory",    "SetRaceMenuOpen",
    "SpSnippet",       "Teleport2",
    "UpdateGamemodeData", "CreateActor",
  };
  return t < kMsgTypes ? kNames[t] : "?";
}

struct Stat
{
  uint64_t count = 0;
  uint64_t totalNs = 0;
  uint64_t maxNs = 0;

  void Add(uint64_t ns)
  {
    ++count;
    totalNs += ns;
    maxNs = std::max(maxNs, ns);
  }
};

struct Window
{
  uint64_t startNs = 0;
  Stat tick;
  uint64_t ticksOver50 = 0;
  uint64_t ticksOver100 = 0;
  std::array<Stat, TickProfile::kSectionCount> sections;
  std::array<Stat, kMsgTypes> messages;
  uint64_t sendBytes = 0;

  // The slowest tick of the window, section by section
  uint64_t worstNs = 0;
  std::array<uint64_t, TickProfile::kSectionCount> worstSections{};
  std::array<uint64_t, kMsgTypes> worstMessagesNs{};
  std::array<uint32_t, kMsgTypes> worstMessagesCount{};
};

// The tick in progress
std::array<uint64_t, TickProfile::kSectionCount> curSections{};
std::array<uint64_t, kMsgTypes> curMessagesNs{};
std::array<uint32_t, kMsgTypes> curMessagesCount{};

Window w;

double Ms(uint64_t ns)
{
  return static_cast<double>(ns) / 1e6;
}

void LogWindow(uint64_t now)
{
  const double secs = static_cast<double>(now - w.startNs) / 1e9;
  std::string line = fmt::format(
    "tickProfile {:.0f}s: {} ticks, total {:.1f} ms, worst {:.2f} ms, over 50 ms {}, over 100 ms {}", secs,
    w.tick.count, Ms(w.tick.totalNs), Ms(w.tick.maxNs), w.ticksOver50,
    w.ticksOver100);

  for (size_t i = 0; i < TickProfile::kSectionCount; ++i) {
    const auto& s = w.sections[i];
    if (!s.count) {
      continue;
    }
    line += fmt::format(" | {} {}x {:.1f} ms max {:.2f}", kSectionNames[i],
                        s.count, Ms(s.totalNs), Ms(s.maxNs));
    if (i == TickProfile::kSend) {
      line += fmt::format(" {:.1f} MiB", static_cast<double>(w.sendBytes) /
                            (1024.0 * 1024.0));
    }
  }

  // Inbound messages, costliest first, the top 6
  std::vector<size_t> order;
  for (size_t t = 0; t < kMsgTypes; ++t) {
    if (w.messages[t].count) {
      order.push_back(t);
    }
  }
  std::sort(order.begin(), order.end(), [](size_t a, size_t b) {
    return w.messages[a].totalNs > w.messages[b].totalNs;
  });
  line += " | in:";
  for (size_t k = 0; k < order.size() && k < 6; ++k) {
    const auto& s = w.messages[order[k]];
    line += fmt::format(" {} {}x {:.1f} ms max {:.2f};", MsgName(order[k]),
                        s.count, Ms(s.totalNs), Ms(s.maxNs));
  }

  line += fmt::format(" | worst tick {:.2f} ms:", Ms(w.worstNs));
  for (size_t i = 0; i < TickProfile::kSectionCount; ++i) {
    if (w.worstSections[i] >= 500'000) {
      line += fmt::format(" {} {:.2f}", kSectionNames[i],
                          Ms(w.worstSections[i]));
    }
  }
  for (size_t t = 0; t < kMsgTypes; ++t) {
    if (w.worstMessagesNs[t] >= 500'000) {
      line += fmt::format(" in {} {}x {:.2f}", MsgName(t),
                          w.worstMessagesCount[t], Ms(w.worstMessagesNs[t]));
    }
  }
  spdlog::info("{}", line);
}
}

bool TickProfile::Enabled()
{
  static const bool enabled = [] {
    const char* v = std::getenv("SKYMP_TICK_PROFILE");
    const bool on = v && std::strcmp(v, "1") == 0;
    if (on) {
      spdlog::info("tickProfile: on (SKYMP_TICK_PROFILE=1)");
    }
    return on;
  }();
  return enabled;
}

uint64_t TickProfile::NowNs()
{
  return static_cast<uint64_t>(
    std::chrono::duration_cast<std::chrono::nanoseconds>(
      std::chrono::steady_clock::now().time_since_epoch())
      .count());
}

void TickProfile::Add(Section section, uint64_t ns)
{
  w.sections[section].Add(ns);
  curSections[section] += ns;
}

void TickProfile::AddMessage(uint8_t msgType, uint64_t ns)
{
  if (!Enabled() || msgType >= kMsgTypes) {
    return;
  }
  w.messages[msgType].Add(ns);
  curMessagesNs[msgType] += ns;
  ++curMessagesCount[msgType];
}

void TickProfile::AddSendBytes(size_t bytes)
{
  w.sendBytes += bytes;
}

void TickProfile::EndTick(uint64_t tickNs)
{
  if (!Enabled()) {
    return;
  }
  const uint64_t now = NowNs();
  if (!w.startNs) {
    w.startNs = now;
  }
  w.tick.Add(tickNs);
  w.ticksOver50 += tickNs > 50000000ull ? 1 : 0;
  w.ticksOver100 += tickNs > 100000000ull ? 1 : 0;
  if (tickNs > w.worstNs) {
    w.worstNs = tickNs;
    w.worstSections = curSections;
    w.worstMessagesNs = curMessagesNs;
    w.worstMessagesCount = curMessagesCount;
  }
  curSections.fill(0);
  curMessagesNs.fill(0);
  curMessagesCount.fill(0);

  if (now - w.startNs >= kWindowNs) {
    LogWindow(now);
    w = Window();
    w.startNs = now;
  }
}
