# What the NPC live budget costs, and a dungeon claim that said nothing

PC session (load test), 2026-10-17. Follows `2026-09-20-load-test-harness.md`; same harness
(`server\tools\loadtest`), same sandbox, 20 Sep's numbers re-measured where they moved.

Two jobs: report the dungeon claim that pre-spawns nothing, and measure what `npcLiveBudget` costs now
that it is **600** and not the 150 the September sweep ran against.

## 1. A claim that pre-spawns nothing now says so

`dungeons.js` claim path, `moveIn(placed)`. `placed` is three-valued and only one value was unreported:

| `placed` | meaning | before |
|---|---|---|
| `-1` | the 6 s timeout or a missing hook: enemies spawn as players arrive | audited as "placed on entry" |
| `0` | the spawn pass ran and placed **no enemy at all** | logged as "0 prespawned", nothing else |
| `> 0` | a real count | logged |

At `0` the party walked into an empty ruin and nothing in the log said why. The fix logs the count
against the zone total and tells the players who went in that the ruin is still filling. It does **not**
name a cause as fact: the cause is not readable from the gameplay layer (the spawn system exposes only
`__alduinakNpcSpawnNow` and a poll timer, no live/budget getter), so the line points at `npcLiveBudget`
as the thing to check. The budget is what the 20 Sep run reproduced; a slot not ready or a spot that has
dropped its quota into the void can do it too.

**Enemies arrive late rather than never.** `npcSpawnSystem.ts:672` sets `slotReadyAt[slot] = now +
BUDGET_RETRY_MS` (10 s), so a zone that waits for room fills as other leases release actors. The
September write-up said "pre-spawn zero enemies" without that qualification; this is the correction.

Verified in the sandbox with `npcLiveBudget: 1`, one bot claiming Serpents Trail:

```
dungeon CYRSerpentsTrailLocation claimed by Bjorn Snow-Walker #H8DK: normal, ... 21 enemies, 0 prespawned, 88 containers
dungeon CYRSerpentsTrailLocation prespawned none of its 21 enemies: the spawn pass placed nothing, so they
  arrive as npcSpawnSystem retries its spots. Check the npc budget (npcLiveBudget) against the live count
NpcSpawnSystem: 1 npcs alive, at the budget of 1; 'dungeon:CYRSerpentsTrailLocation:3' waits for room
```

The third line is the retry, confirming the claim the second line makes.

**Not deployed.** It is a gameplay change: it needs a push of the `server` branch and
`dev-server.sh deploy-gameplay`, which is the server session's. On this PC it is inert until something
touches `gamemode.js` (modules reload only on that), so it cannot disturb the Phase 1 testing in progress.

## 2. What the budget costs: 150 against 600, measured

Method: one sandbox, 1000 seeded one-NPC zones (`--seed-wildlife 1000`) in a 4000-unit radius around the
bots, `--host-npcs`, `--dungeons none`, 180 s per arm. Only `npcLiveBudget` differs. **Both arms were
confirmed binding** - `N npcs alive, at the budget of N` appears in each - which the first attempt was
not: 300 seeded zones hold 300 NPCs, so a 600 budget could never bind and that pair of runs measured
nothing. The numbers below are the second attempt.

| At 50 players | budget 150 | budget 600 | change |
|---|---|---|---|
| NPCs alive | 150 (at the cap) | 600 (at the cap) | 4x |
| messages in to the bots | 43,269/s | 46,297/s | **+7.0%** |
| `createActor` in 180 s | 11,007 | 19,008 | **+73%** |
| actors the bots hosted | 94 | 115 | +22% |
| CPU (one core) | 20.6% | 25.6% | +24% |
| tick p99 | 19.9 ms | 24.67 ms | +24% |
| loop lag p99 / max | 27.3 / 60.8 ms | 30.03 / 159.9 ms | +10% / +163% |

| At 100 players | budget 150 | budget 600 | change |
|---|---|---|---|
| messages in to the bots | 154,905/s | 180,138/s | **+16.3%** |
| JSON in over 180 s | 7.84 GB | 9.11 GB | +16.2% |
| `UpdateMovement` | 154,295/s | 179,212/s | +16.1% |
| `createActor` / `DestroyActor` | 125.6 / 125.5 per s | 209.7 / 212.2 per s | **+67% / +69%** |
| actors the bots hosted | 143 | 210 | +47% |
| CPU (one core) | 42.3% | 52.5% | +24% |
| tick p99 | 27.08 ms | 39.83 ms | **+47%** |
| loop lag p99 / max | 32.36 / 142.9 ms | 48.79 / **389.8 ms** | +51% / +173% |

**Four times the NPCs is not four times the cost, and the cost is not bandwidth.** Only actors near a
player are streamed, so traffic grows 7-16%. What grows is per-actor work and churn: `createActor` and
`DestroyActor` rise by about two thirds, because NPCs stream in and out as 100 players move through a
dense population, and each one is a create and a destroy to every player in the 3x3 grid block. That
lands on the event loop: at 100 players the worst stall goes from 143 ms to **390 ms**.

**The latency penalty grows with the player count** - +24% tick p99 at 50 players, +47% at 100 - so the
budget cannot be judged at one player count. At 50 players (the alpha gate) 600 is comfortable. At 100
it is the largest single latency cost measured so far.

### A correction to the September numbers

20 Sep reported 67,454 msg/s out at 100 players on live. That was a nearly empty world. With 600 NPCs
alive around the players it is 180,138 msg/s - **2.7x** - and 154,905 at the old 150. Any capacity
number from that sweep is a floor, not an expectation; the world's population is the bigger term.

Caveat: 1000 one-NPC zones inside a 4000-unit radius is denser than Bruma is today, so these are stress
figures for a populated city, not a forecast of tonight. Bots run no AI, so nothing they host fights
back; real combat adds actor-value and SpSnippet traffic this does not.

## 3. What to do with it

- **Decide the budget against the player cap, not the current crowd.** 600 is affordable at 50. If the
  alpha is to hold 100 in one city, 390 ms stalls want either a lower budget (300-400) or a budget that
  scales with the connected count.
- **The churn is the mechanism worth attacking**, not the headcount: `createActor`/`DestroyActor` at
  +67% is the stream-in/stream-out of a dense population through the 3x3 grid neighbourhood. That is the
  same C++ interest-management work as the fan-out finding (`NPC_REBUILD.md` phase 4, claude-jake's), and
  a distance test instead of a grid-block test would cut both.
- **Give the gameplay layer a way to read the budget.** A `__alduinakNpcLive` hook returning
  `{live, budget}` would let the claim line name the cause instead of pointing at it, and would let
  `dungeons.js` refuse or defer a claim it cannot populate. Server-TS change, so it needs a build.

## 4. Log noise found on the way

Every claim logs 11 C++ `[error] resolved context ... (reason=exception)` blocks for `baseDesc` reads,
and `doorsStartOpen` logs one every 30 s forever in any world where
`1b5fc4:DragonBreak Online Edits.esp` does not resolve. Both are **caught** on the JS side (`baseDesc`
reads are wrapped everywhere; `gamemode.js:1685` is inside a try whose own line is capped at 2), but the
addon logs the exception context at error level uncapped. Harmless, except that the harness's classifier
counts them, so "errors: 6-11" in every report above is this noise and not a fault.

## 5. What the live log says, and why the budget is NOT what players hit (18 Oct)

Players reported empty dungeons, so I read the live log rather than assuming this finding explained it.

- **Zero budget exhaustion.** Not one `at the budget of` line in the window (00:00-03:46, the log has rotated).
  `npcLiveBudget` on live is 600 and was never reached. Section 2 measures what the setting costs; it is not
  what anybody is hitting today.
- **Dungeon zones do spawn**: 1230 spawn lines, including in the dungeon that logged `0 prespawned`.
- **`0 prespawned` is usually correct.** `npcSpawnSystem` skips an ambush zone until somebody stands inside its
  radius (`zone.ambush && zone.inside.size === 0`), and `isAmbusher` marks every enemy that lay in a coffin or
  pod in vanilla. The audit counts 1024 such placements across 99 dungeons: Dustman's Cairn 46 of 64, Forelhost
  24 of 46, Potema's 21 of 30, Ansilvund 15 of 25. A Nordic crypt pre-spawning nothing is the design.

So the claim now says which it is. `waiting` counts `zone.Ambush`; an all-ambush dungeon gets its own wording
("every one of the N enemies here lies in wait"), a partial one is told the count, and only a genuinely starved
spawn gets "still taking their places". The first version of this fix would have told a Dustman's Cairn party
their dungeon was still filling, which is false.

### Two things this does not explain, and one it cannot

- **Dustman's Cairn: 46 of 64 wait in ambush, so 18 stand in the open - and the claim pre-spawned 0.** Ambush
  does not account for that dungeon. The likeliest candidate is the anchor: `fillSlots` breaks out of its loop
  when no anchor resolves, and at claim time the party is still outside the interior cell, so the pass falls back
  to the first online player, who may be anywhere. Unmeasured.
- **21 of that lease's 64 slots ever spawned.** Either the player explored a third of the crypt, or two thirds of
  the ambushes never fired. Counts alone cannot tell the two apart.
- **A server spawn count does not prove the client drew the actor.** "No NPCs" cannot be closed from the server
  log at all: spawn-then-move desync is a known failure mode here and `STATE.md` already lists enemies separating
  from their positions. The `npcDrift` diagnostic should report how many actors the client has near the player
  against what the server believes. That is the instrument this class of report actually needs.

### What was verified, and what was not

Verified in the sandbox, with `isAmbusher` forced so the case was deterministic (a throwaway copy; `sandbox init`
restores it): CYRAngaLocation, 16 of 16 forced to ambush, generator and claim agreeing independently -
`16 enemies, 0 prespawned`, then `16 of 16 enemies lie in wait within 1200 units of their spot`, with the
"still filling" message correctly suppressed. So `zone.Ambush` reads correctly at claim time and the branch
selection works.
NOT verified in game: the partial-count wording (the same correct `waiting` choosing the other template), and
that the chat line reaches a player - the bots count chat messages but do not keep their text. It uses the same
`system()` helper as the claim messages beside it.
