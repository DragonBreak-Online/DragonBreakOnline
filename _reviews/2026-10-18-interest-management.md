# Interest management for the movement relay

PC load-test session, 2026-10-18. Task 2 of the 1,000-player work (`CAPACITY_PLAN.md` step 1). Design only: no C++
was written, and the C++ owner is claude-jake (`NPC_REBUILD.md` phase 4).

Every line of code below was read with `git show origin/main:<file>` and, for the client, `origin/client-03103`,
which is what players run. Nothing was read from this PC's working trees (842 and 319 commits behind).

## 1. What the relay does today

**The listener set is a 3x3 block of 4,096-unit grid squares.** `GetGridPos` (`MpObjectReference.cpp:160`) is
`{int16(pos.x / 4096), int16(pos.y / 4096)}`. `GridImpl::MoveImpl` (`Grid.h`) inserts an object into all nine cells
around its own, so `GetNeighboursByPosition` returns everyone whose block covers that cell: about 12,288 units
across, a town and its outskirts.

**Subscription is recomputed on every move** (`MpObjectReference.cpp:760-800`): diff the previous listener set
against the new neighbour set, then `Subscribe`/`Unsubscribe` in both directions. Self-subscription is deliberate and
commented in place. `Subscribe` (`:1056`) appends to two containers:

- `listeners` - `std::set<MpObjectReference*>`, every listener;
- `actorListenerArray` - `std::vector<MpActor*>`, the actor subset, in **insertion order**, returned by
  `GetActorListeners()` (`:1185`).

**The send is a flat loop over that vector.** `ActionListener::SendToNeighbours` (`ActionListener.cpp:795-862`) walks
`GetActorListeners()` and calls `Send(targetuserId, data, length, reliable)` for each. One serialized buffer, N
sends. No distance test, no rate limit, no budget, no ordering.

`OnUpdateMovement` validates the sender's own move first and relays second, so a refused packet reaches nobody.

**Therefore traffic is quadratic in a crowd.** Each player sends 7.7 movements a second (130 ms). Everyone in the
block receives every one. Measured, with the bot harness driving the real client DLL:

| players (crowded) | per client in | total out | CPU |
|---|---|---|---|
| 10 | 33/s | 330/s | 3.1% |
| 25 | 130/s | 3,247/s | 4.0% |
| 50 | 290/s | 14,518/s | 9.6% |
| 100 | ~620/s | ~62,000/s | 20.6% of one core |

That is 3.3 microseconds of server time per message sent, and 8.8 KiB/s of real wire per client at 620 messages a
second (about 14.5 bytes a message on the wire; the JSON is 4.6x that before compression).

## 2. The design

### 2.1 Where it hooks in

One choke point, one new owner:

- **Keep** `SendToNeighbours` as the entry for everything that is **not** movement. Property updates, inventory,
  teleports, createActor/destroyActor, spell casts and animations are semantic, rare, and must stay unthrottled.
- **Divert `UpdateMovement` only.** In `OnUpdateMovement`, replace the two `SendToNeighbours(msg.idx, rawMsgData)`
  calls with `partOne.GetMovementRelay().Submit(emitter, rawMsgData)`.
- **New class `MovementRelay`**, owned by `PartOne` (it needs `serverState`, `worldState` and `GetSendTarget()`). It
  holds the per-user interest tables and is flushed once per server tick.

This keeps the policy out of `MpObjectReference`, which already has enough jobs, and leaves the subscription
machinery untouched: the 3x3 block stays the *candidate* set, and the relay decides who actually hears about a move.

### 2.2 Data structures

Per user, so memory is bounded by players rather than by pairs:

    struct InterestEntry {          // one per emitter this user is currently told about
      uint32_t emitterIdx;
      uint32_t lastSentMs;          // for the rate ladder
      uint8_t  tier;                // 0 full, 1 mid, 2 far
      uint8_t  flags;               // pinned (combat, party, hosted), dirty
      std::vector<uint8_t> pending; // the newest movement buffer, overwritten not queued
    };

    struct UserInterest {
      std::vector<InterestEntry> entries;                 // capped at kTrackedMax
      std::unordered_map<uint32_t, uint32_t> byEmitter;    // emitterIdx -> index into entries
      uint32_t nextFlushCursor;                           // round-robin fairness for the far tier
    };

`Submit` does no sending. It finds or creates the listener's entry for that emitter, **overwrites** `pending` with the
newest buffer, and sets `dirty`. That is the coalescing: a player who moves ten times before a far listener's next
slot costs that listener one message, not ten, and it is always the newest position rather than a stale queue.

`Flush` runs once per tick per user: walk `entries`, send the ones whose tier allows it, nearest first, stop at the
per-tick budget, and advance `nextFlushCursor` so the far tier is served round-robin instead of always the same names.

### 2.3 The ladder

Distance comes from positions the server already holds (`MpObjectReference::GetPos`), squared only, no square roots.

| tier | condition | rate |
|---|---|---|
| **full** | the nearest `kFullRateCount` (32) by distance, **or** within `kFullRateUnits` (2,000), **or** pinned | every packet (7.7/s) |
| **mid** | within one grid square (4,096) | 2/s |
| **far** | the rest of the 3x3 block | 0.5/s |
| **dropped** | beyond the block, as today | nothing |

A pinned pair is always full rate, whatever the distance. Pins come from three places and all three matter:

1. **Combat.** Any pair that has exchanged a hit in the last 10 s. The server already sees hits, so the damage path
   sets the pin.
2. **Hosting.** A hosted NPC in combat with the listener must never be throttled; its movement is what the listener
   is fighting.
3. **The gamemode.** Party members, an arrest target, a duel, an escort. Expose one API,
   `PinInterest(userId, formId, ms)`, so `dungeons.js`, `captureSystem` and the party code can say "this one matters
   to that player" without knowing anything about the relay.

### 2.4 The budget

Two caps, both per user:

- `kTrackedMax` = 200 emitters. Beyond that the furthest is evicted and not streamed. This is also the hook for
  `CAPACITY_PLAN.md` step 3 (cap how many copies a client draws): the relay and the copy cap should use the same
  number, or a client will be told about actors it is not drawing.
- `kPerTickSends` = budget divided by ticks a second. The flush stops when it is reached and the cursor resumes there
  next tick, so a crowd degrades by **rate** and never by dropping the same players permanently.

## 3. What it is worth

Once a crowd is larger than the tracked cap, per-client inbound is a constant:

    32 x 7.7  = 246     full
    64 x 2    = 128     mid
    104 x 0.5 =  52     far
                ----
                426 messages a second, whatever the player count

| players | crowded today | crowded with the ladder | spread today | spread with the ladder |
|---|---|---|---|---|
| 250 | 1,925/client, 481k/s | 426/client, **106k/s** | ~154/client, 39k/s | ~86/client, 22k/s |
| 500 | 3,850/client, 1.93M/s | 426/client, **213k/s** | ~154/client, 77k/s | ~86/client, 43k/s |
| 1,000 | 7,700/client, 7.7M/s | 426/client, **426k/s** | ~154/client, 154k/s | ~86/client, 86k/s |

Spread assumes about 20 players inside the block and 8 within 2,000 units, which is what the 10-bot step measured
(33 messages a second per client).

**Bandwidth.** At the measured 14.5 bytes a message on the wire, 426/s is about 6.2 KiB/s per client: **6.2 MB/s, or
50 Mbit/s, at 1,000 players crowded.** `CAPACITY_PLAN.md` assumed 25 KB/s per client and 200 Mbit/s, so the measured
figure is four times kinder - but it is still more sustained upload than a home connection gives, so the hosting
question in the plan stands unchanged.

**The CPU ceiling, which is the uncomfortable finding.** At the measured 3.3 microseconds per send:

| players | sends/s with the ladder | event-loop cost |
|---|---|---|
| 250 | 106k | 0.35 core |
| 500 | 213k | 0.70 core |
| 1,000 | 426k | **1.4 cores** |

The relay runs on one event loop, so 1,000 players at a 426/s budget does not fit. Two options, not exclusive: drop
the budget to about 256/s at 1,000 (0.85 core, ladder becomes 32 full + 48 mid + 120 at 0.25 Hz), or move
serialization and sending to worker threads (`CAPACITY_PLAN.md` step 5). **Measure at 250 and 500 before choosing**:
3.3 microseconds is one measurement on one machine, and a different per-send cost on CT 115 moves the ceiling.

## 4. The client consequence, which the server change cannot avoid

`translateTo` (`skymp5-client/src/sync/movementApply.ts`, live branch) interpolates a player over a fixed **0.2 s**
window, extrapolating ahead by `speed * 0.2` clamped to 128 units. That constant is tuned to the 130 ms send rate.

Feed it at 2/s and the copy reaches its target in 200 ms then stands still for 300; at 0.5/s it stands still for
1,800 ms and then slides. Distant players would move in visible steps.

So the ladder needs a paired client change: **scale the interpolation window per form from the observed gap between
updates.** The client already stores `movementAt` per form (`remoteServer.onUpdateMovementMessage`), so the window can
be `clamp(now - movementAt, 0.2, 2.0)` instead of a constant, with the extrapolation clamp raised to match. It is a
small change in one function, backwards compatible with a full-rate server, and without it the ladder will be
reported as a visual regression on the first playtest.

## 5. What must not be throttled

- Everything that is not `UpdateMovement`: appearance, equipment, properties, inventory, teleports, spell casts,
  createActor/destroyActor, animations. Semantic and rare.
- A pinned pair (combat, hosting, gamemode) at any distance.
- The sender's own movement, which is a separate question answered in `2026-10-18-self-echo.md`: it can stop
  entirely, and should, once the client populates its own form locally.
- `TeleportMessage2` from `MovementValidation`, the anti-cheat snap-back, which already goes straight to the one user
  who needs it.

## 6. How to prove it

Pass criteria, per `CAPACITY_PLAN.md`, measured by the bot harness (task 3 covers getting it past 100):

1. Per-client inbound at or under the budget at 250, 500 and 1,000, spread and crowded.
2. Event-loop lag p99 under 50 ms, and the per-send cost re-measured rather than assumed.
3. No disconnects, memory flat across steps.
4. A full-rate control: the nearest 32 must still receive every packet. The harness can check this per bot by
   counting `UpdateMovement` per emitter against distance.
5. In game, with a real client: a crowd at 2,000+ units must not step visibly once the interpolation change is in.

## 7. Questions for the C++ owner (claude-jake)

1. Is `PartOne` the right owner for `MovementRelay`, or should it live on `WorldState` beside the grids?
2. Ordering: coalescing means a listener can see emitter A's newest position before emitter B's older one. Movement
   carries no sequence number today. Is per-emitter ordering enough - it is preserved by overwriting in place - or
   does anything depend on cross-emitter order?
3. Reliability: movement is sent unreliable (`reliable = false` in `OnUpdateMovement`). The far tier at 0.5/s makes
   each packet matter more. Should the far tier be reliable, given it is only 52 messages a second per client?
4. Does `NPC_REBUILD` phase 4 already plan a per-listener structure? If so this should fold into it rather than
   introduce a second one.
