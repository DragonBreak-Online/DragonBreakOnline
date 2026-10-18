# The movement speed check is not safe to enforce, and the log already says why

PC load-test session, 2026-10-18. Read-only: the live log and `origin/main`. No C++ written; `MovementValidation`
belongs to claude-jake.

## What is switched on today

`movementValidation.enforce` is **false** on live. Across the whole previous week (`skymp-server.log.1.gz`,
11-18 Oct) and today there is **not one** `MovementValidation: refused` line; every line reads `would refuse`, which
is the string the code prints when enforcement is off (`limits.enforce ? "refused" : "would refuse"`). With it off
the code calls `accept()` and changes nothing.

One check **is** always enforced, whatever that flag says - the first one in `Validate`:

    constexpr float kSqrMaxDistance = 4096.f * 4096.f;
    if (currentCellOrWorld != newCellOrWorld ||
        (currentPos - newPos).SqrLength() >= kSqrMaxDistance) { if (isMe) sendSnapBack(); return false; }

A cell or worldspace change, or one jump of 4,096 units or more, is corrected for everybody. That is the only
snap-back real players get today.

## How much the advisory check would have refused

The log lines are rate-limited to one per player per 5 s and each carries a count of refusals since the last line,
so the line count understates the total by about two orders of magnitude:

| | log lines | actual refusals |
|---|---|---|
| 17 Oct | 128 | **11,350** |
| 18 Oct to 16:24 | 22 | 298 |

Lines per day across the week: 6, 29, 2, 5, 27, 48, 128 (11-17 Oct). Rising with the population.

**On 17 Oct those 11,350 refusals were spread across 36 distinct users** - about everyone who played that day
(38-40 were online). So this is not one suspicious player; with `enforce` on, the whole server would have been
rubber-banded, roughly 300 times per player over the day.

## Why legitimate movement is refused

The check judges speed from the gap between **accepted** updates. A real line from the week:

    would refuse actor ff0013ec (user 14) moved 67 u horizontally and +17 u vertically in 3 ms
                 (22100 u/s, budget 58), 1 refusal(s) since the last line

Sixty-seven units is a normal step. The gap was **3 ms**, so the computed speed is 22,100 u/s and the token bucket
refilled by 3 units. **A gap that short cannot tell bunched packets from speed**, and bunching is ordinary: the
client sends every 130 ms, the network delivers in pairs, and the server timestamps on arrival.

The routine telemetry shows how common over-limit readings are. Today's `peaked at` lines (one per player per
interval, 46,632 samples): **1,148 above the 1,000 u/s ceiling (2.5%)**, 65 above 2,000, peak **14,855 u/s**. Whether
that is bunching, horses, beast forms or teleport chains, 2.5% of all windows exceeding the limit is not a cheating
rate - it is a mis-set check.

Two populations appear in the refusals:

- **One-off bursts**, a single refusal per line: door and teleport transitions whose dt is tiny, and bunched pairs.
- **Sustained offenders**, 24 to 38 refusals per 5 s interval for minutes: a drained token bucket, meaning genuinely
  fast sustained movement. Yesterday's worst single actor accounted for about 900 refusals. One such player on 18 Oct
  (name and profile withheld: this repo is public) also reported `worstMs: 3183` in their own client diagnostic in the same window - a 3.2
  second frame stall - which is a client that freezes and then catches up, not a cheat.

## The smallest fix

Two parts, in order, and the first is small:

1. **Never judge speed over a window shorter than the client's send interval.** When `dt` is under about 130 ms,
   carry the distance forward and check it on the next accepted update rather than dividing by the gap. That turns
   the 22,100 u/s artifacts into a legal average and removes the one-off population entirely. Flooring the refill
   with `max(dt, kMinWindow)` would also work and is a one-line change, but carrying the distance is more correct
   because it keeps the total honest.
2. **Set the ceiling from observed legitimate movement before enforcing.** 1,000 u/s is below what this game
   produces: the `peaked at` telemetry already in the log is the right instrument, and the gate for switching
   `enforce` on should be that the over-limit fraction is near zero, not 2.5%.

Until both are done, `enforce` should stay off. Switching it on as it stands would rubber-band every player on the
server several hundred times a day, and the players it would hit hardest are the ones with slow computers.

## Method notes

- Two counting traps worth knowing. `zcat | grep` treats the rotated log as binary (it contains non-UTF-8 bytes) and
  silently stops printing matches after the first one, so every grep over an archive needs `-a`; and `dev-server.sh
  run` truncates long output, so aggregation has to happen on the box and only summaries come back.
- Dynamic `0xff...` actor ids are reassigned per server run, so counting refusals per actor across days means
  nothing. The per-day and per-user figures above are within a day.
