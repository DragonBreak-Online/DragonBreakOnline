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

## 6. Lead 1: why a claim pre-spawns nothing, and a feature that cannot work (18 Oct)

The question: Dustman's Cairn is 46 of 64 in ambush, so 18 enemies stand in the open, and the 03:44 claim
pre-spawned **0**. Ambush does not explain that dungeon. What skipped the 18?

### Eliminated, each from the live log

| Candidate | Evidence against |
|---|---|
| The npc budget | Not one `at the budget of` line in the whole log. Live budget is 600 and was never reached |
| A zone-file load race | `3359/3359 zone(s) loaded (gamemode), carried 3295` at 03:44:52.839, two ms before the claim. 3359-3295 = 64, exactly the new zones, so they were loaded and fresh |
| Slot cooldowns (`NEVER_READY` carried from an earlier lease) | Those 64 zones were **not** carried, so `slotReadyAt` was `0` for every slot |
| Fallen spots | `npc-fallen-spots.json` holds **no** `dungeon:` records at all (`MAX_SPOT_FALLS` 2, and one fall is enough to need a player within 2500 units) |
| A spawn failure | `spawnOne` logs `failed to spawn` on any throw. **Zero** such lines anywhere in the log |

So `spawnOne` was never reached and nothing logged: one of `fillSlots`'s five silent `continue`/`break`
paths took all 18. By elimination only `if (anchor === undefined) break` is left, which needs both
`zone.anchorId` falsy and the `online[0]` fallback undefined. The first half is now proven (below); the
second cannot be observed, because nothing records it.

### The feature that cannot work

`dungeons.js` means to anchor each spawn to Bethesda's own disabled actor on the spot: *"Anchor = Bethesda's
own (disabled) actor ref on that spot: the spawn appears there, not at a player."* It never does.

- **0 of 6** live dungeon zones carry an `Anchor` key. **0 of 5** in the sandbox. They carry `Placed`, not `Anchor`.
- **621** `dungeon anchor <ref> is not in the server's world` lines on live in a five-hour window.
- The cause is structural, not data drift. `anchorExists` requires `mp.get(id, "baseDesc")` to succeed on a
  **disabled vanilla ACHR**, and those are exactly the plugin-placed actors this project disables on purpose so
  the server owns every spawn. The anchor it wants can never be in the server's world, so the test can never pass.

Every dungeon enemy therefore takes the fallback: `PlaceAtMe` at an arbitrary online player (`online[0]`, who may
be in another hold), then a move to the spot. That is the documented desync path - a spawn placed at a player and
then teleported never reaches watchers correctly - which is a mechanism that produces exactly what players report:
enemies that are not where the server believes, or not drawn at all. It also explains why `0 prespawned` is
possible at all: with no anchor of its own, a dungeon's whole pre-spawn hangs on one unrelated player resolving.

### What it needs next

1. **An instrument, before any more theorising.** The pre-spawn pass should report why it placed nothing:
   `{zones, ambush, notReady, fallen, budget, noAnchor, failed, placed}`. Five silent skips and no counter is why
   this took a log archaeology session instead of reading one line. Server-TS change, so it belongs to whoever
   builds `skymp5-server`.
2. **Decide what a spawn anchors to.** The honest options are to drop the `Anchor` path as dead code and own the
   player-anchor behaviour, or to give the server a real anchor (a kept, server-side marker per spot) so the
   `PlaceAtMe`-then-move desync stops being the normal case for every dungeon enemy.
3. The 621 log lines a night are a symptom of 1 and 2, not a problem of their own.

Not changed: nothing here touches code. The anchor question is a design call, and the instrument needs a server
build and a deploy, neither of which is this session's.

## 7. Lead 2: the crypt was unexplored, and the log cannot be trusted to prove the rest (18 Oct)

The question: only 21 of Dustman's Cairn's 64 slots ever spawned. Had the player explored a third of it, or
did two thirds of the ambushes never fire? The spawn system logs zone entry, so the two separate cleanly.

**Answered: exploration.** For that lease, 21 slots were entered, 21 spawned and 21 despawned. Every zone the
player walked into produced its enemy. The other 43 were never entered. The ambush mechanism is not at fault,
and nothing in that dungeon failed.

### Generalising it found a residue, and then undermined itself

Across every dungeon in the window: 671 distinct zones entered, 696 spawned, and **20 entered but never**
**spawned** (the 45 spawned-without-entry are the pre-spawned ones).

Eleven of the 20 are log-rotation artefacts: ShimmermistCave's zones were entered at 00:01-00:02 against a log
that starts at 00:00:49, and its lease was claimed at 23:41 the night before. That leaves **9 zones in three**
**dungeons whose leases were claimed inside the window** - CYRFingerbowlCave (claimed 00:28:23, zones entered
00:28:24), Forelhost (claimed 00:59:40, zones entered the same second and later at 01:06 and 01:22) and Mzulft
(claimed 04:01:10, zone entered 04:02:47). A player stood inside each and the log shows no spawn.

**But the measurement is not sound, and the reason is a second observability hole.** `fillSlots` logs a spawn
only when the zone was empty when it started:

```ts
if (!changed) return;
if (!before) {                       // before = zone.spawned.length on entry
  this.log(`... spawned ${zone.spawned.length}/${zone.total} npc(s) ...`);
}
```

So filling a second slot in a zone that already holds an NPC logs nothing at all. The hole is narrow - 3 of 37
live dungeon zones are multi-slot, 34 of 3270 wild ones, and the death-refill path logs separately (121
`respawned` lines) - so most of the 9 are probably real silent non-spawns. It cannot be proven per zone, because
those leases' rosters have rotated out of the log.

### Why this stops here

Every candidate for the 9 is eliminated the same way as in section 6: the player was inside, so `anchorIn`
returns them and the anchor gate cannot fire; `spawnOne` logs every throw and there are none; no budget lines; no
fallen-spot records. And the carry theory - a re-claimed dungeon inheriting `NEVER_READY` through
`replaceZones` - does not survive its own test: Forelhost slots 3 and 7 were **despawned** at 20:26:49 the night
before, and `despawn` maps `at < 0` back to `0`, so they were ready.

Two observability defects, both worth fixing before anyone theorises further:

1. `fillSlots` has five silent `continue`/`break` paths and no counter. It should report
   `{zones, ambush, notReady, fallen, budget, noAnchor, failed, placed}` per pass.
2. The spawn line is suppressed whenever `before > 0`. A zone that fills its second slot should say so, or the
   log cannot be used to ask "did this zone ever produce its enemy".

Both are server-TS, so neither is this session's to deploy.
