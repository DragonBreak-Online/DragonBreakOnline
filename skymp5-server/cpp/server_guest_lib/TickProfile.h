#pragma once
#include <chrono>
#include <cstddef>
#include <cstdint>

// Where the native tick spends its time (CAPACITY_PLAN.md: at 500 crowded bots the loop's p99 stayed at 246 ms after
// the gamemode timers were fixed, so the tail is in here or in GC). Off unless the environment sets
// SKYMP_TICK_PROFILE=1; then every 10 s one "tickProfile" line goes to the log: each section's count, total and worst,
// inbound messages by type, and the section breakdown of the slowest tick in the window, which is what attributes the
// tail. Sections nest (a relay Send runs inside relaySubmit, which runs inside an UpdateMovement message, inside net),
// so their totals overlap; the worst-tick breakdown names the innermost ones. Main thread only.
namespace TickProfile {

enum Section : uint8_t
{
  kNet,          // networking Tick: receive and dispatch of every queued packet
  kRelaySubmit,  // MovementRelay::Submit
  kRelayFlush,   // MovementRelay::Flush
  kSend,         // PartOneSendTargetWrapper::Send (every packet out)
  kPlaybacks,    // PartOne::TickPacketHistoryPlaybacks
  kDeferred,     // PartOne::TickDeferredMessages
  kHostReleases, // PartOne::TickHostReleases
  kStaleHosts,   // PartOne::TickStaleHosts
  kWorld,        // WorldState::Tick
  kSectionCount
};

bool Enabled();

uint64_t NowNs();

void Add(Section section, uint64_t ns);

// One inbound message, deserialisation included
void AddMessage(uint8_t msgType, uint64_t ns);

void AddSendBytes(size_t bytes);

// The whole native tick; logs the window when 10 s have passed
void EndTick(uint64_t tickNs);

class Scope
{
public:
  explicit Scope(Section section_)
    : section(section_)
    , start(Enabled() ? NowNs() : 0)
  {
  }
  ~Scope()
  {
    if (start) {
      Add(section, NowNs() - start);
    }
  }
  Scope(const Scope&) = delete;
  Scope& operator=(const Scope&) = delete;

private:
  Section section;
  uint64_t start;
};

}
