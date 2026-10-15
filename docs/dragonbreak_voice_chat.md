# Voice chat (VOIP): current state and realistic path

## IMPLEMENTED 2026-07-28 - proximity voice is now in this fork

The integration described as "future work" below has been built:

- **SkyrimPlatform (C++)**: CEF media switches unlock mic capture
  (`MyChromiumApp.cpp` / `MyBrowserProcessHandler.cpp`). **Needs a CI flatrim
  rebuild**; until the new `SkyrimPlatform.dll` ships, players can hear but not
  speak.
- **Server**: `skymp5-server/ts/systems/voiceSystem.ts` mints LiveKit HS256
  tokens (identity = the player's actor id in hex, unspoofable). Config =
  `voiceChat` object in `server-settings.json` (enabled/url/apiKey/apiSecret/
  room/rangeUnits; range falls back to `chatRanges.say`). Already built into
  `dist_back` on the box.
- **Front (CEF)**: `skymp5-front/src/utils/VoiceManager.js` + `livekit-client`.
  Joins the room, attaches remote audio, per-participant volume falloff by
  distance, unsubscribes tracks beyond ~1.15x range.
- **Client**: `skymp5-client/src/services/services/voiceService.ts`. Push-to-
  talk on `voicePushToTalkKeyCode` (default V, DX 47), suppressed while chat is
  focused; requests a token per actor assignment; pushes peer distances
  (same world only) every 400ms.
- **Talk range**: V + mousewheel picks the speaker's audible range between
  chatRanges.whisper (150u) and chatRanges.shout (10000u), default say (2000u).
  The range is published to the room over LiveKit's data channel, so LISTENERS
  attenuate by the speaker's chosen loudness (whisperers audible at ~2m,
  shouters at ~143m). A bottom-center meter (chat-tier label + log-scale bar)
  shows while PTT is held or the wheel moves; the choice persists across
  relaunches via `voice-settings-no-load`.
- **Launcher**: "Voice Push-to-Talk" picker in Server Hotkeys; the hotkey-wipe
  bug in `writeClientSettings` is fixed so rebinds survive launches.

Rollout order: (1) CI flatrim rebuild -> new SkyrimPlatform.dll into the client
dist, (2) server manager "Build Client" (front + client logic + repackage),
(3) launcher rebuild/redistribute, (4) players re-download via launcher.
LiveKit server + firewall are already live on the box (`DragonBreakLiveKit`).

### Trust model and accepted limitations

- **Who can hear whom is decided by the server (15 Oct 2026, security audit
  F2, L2-3, L4-4).** Before this, every token could subscribe to every voice
  in the one room and range lived only in the listener's page, so a modified
  client heard the whole server. LiveKit cannot be told per pair from the
  server side (a token's canSubscribe is all or nothing, UpdateSubscriptions
  is refused without it and MoveParticipant is not in the open-source server;
  all tested on a scratch livekit-server 1.13.7). What LiveKit does enforce
  against every listener is a speaker's own track subscription permissions.
  So:
  - A client that sends `caps.hearingLists` gets, with its token and in a
    `voiceHearers` packet whenever they change, one list per voice mode of
    the identities close enough to hear it, worked out every
    `voiceChat.hearingTickMs` (500) from the server's own actor positions:
    same cell or worldspace, within the mode's range x 1.15 plus
    `hearingPadUnits` (350 units, 5 m), kept on until 1.2 x that. An
    Invisible staff member's lists hold only viewers who may see them (the
    client's rule: mirror rank, else isAdmin staff = 1). Banned and
    suspended accounts are on no list.
  - Its page sets the list for its current mode as its LiveKit permissions
    before it joins, and again on every list or mode change (a mode change
    needs no server round trip: all three lists are on hand). LiveKit then
    refuses that voice, and its active-speaker events, to every other
    listener, whatever their client does; allowing takes about 30 ms. The
    mode range on the data channel goes only to allowed listeners, and a
    listener page ignores a range that is not one of the server's modes.
  - Cost at 30 players (tests/voice-hearing-harness.js, 10 simulated
    minutes): no extra LiveKit API call (the 15 s sweep stays the only one,
    about 0.09/s); in a crowded town, 27 list packets/s server-wide (about
    8 KB/s, under one per client per second) and about 13 permission updates
    a second to LiveKit, against about 15 subscribe flips a second the
    listener pages make today for the same moves; spread out, about 1 packet
    and 0.3 updates a second. A list tick costs about 0.3 ms.
  - Limits: an old client's voice stays open until `allowOldClients` is
    turned off (below). A cheater still hears what their character's
    position allows: the server's movement checks bound how fast the
    character gets there, but it can be parked out of sight (under the
    ground or behind a wall) within range. Still room-wide: the participant
    list (actor ids, joins and leaves) and each microphone's mute and
    unmute, so a far client can tell when each actor id presses the talk
    key, though not what is said (checked on a scratch livekit-server
    1.13.7, 15 Oct). Invisible staff near a player are on that player's own
    lists, as they must be to hear them; the server half of Invisible
    (L2-4) has to allow for that.
- **Switches** (server-settings.json `voiceChat`, read at start):
  - `hearingLists` (default true): false sends no lists, so every voice is
    open to the room exactly as before (the fallback).
  - `allowOldClients` (default true, used while hearingLists is on): true
    keeps old clients on open voice; `"listen"` gives them a token with no
    publish or data rights (they still hear nearby updated speakers, their
    talk key shows "Voice: microphone unavailable"); false gives them no
    voice at all. The game itself is never refused.
  - Every 15 minutes while voice is used the server log has
    `VoiceSystem: online players with a voice token: N on updated clients,
    M on old clients (...)`. Turn `allowOldClients` to `"listen"` once M is
    0 or 1 in every line for 48 hours (and the client release with hearing
    lists has been out at least 3 days), and to false a week later if no
    one is still listed as listen only. Each change needs a game server
    restart; putting `true` back undoes it.
- **Revocation (15 Oct 2026, security audit F3).** A token cannot be revoked,
  and LiveKit re-signs one for a connected session every few minutes, so the
  game server removes sessions itself through LiveKit's RoomService API
  (RemoveParticipant, signed with a 60 s admin token for the room):
  - when a player's game connection ends; every kick and ban ends in one;
  - in a sweep at random gaps of half to all of `voiceChat.sweepSeconds`
    (default 15, 0 = off) that removes any identity that is not an online
    character allowed voice, so a kicked or banned player who rejoins with a
    kept token is out again; the gaps are random so a script cannot step out
    of the room just before each check;
  - LiveKit gives every join a fresh token at once, so a script could rejoin
    forever. A session removed twice that comes back a third time moves voice
    to a new room (`<room>-<suffix>`, kept in `voice-room.json` beside the
    server): online voice users get a token for it at once, the old room is
    emptied for two minutes after a 10 s grace, and the replayed tokens open
    only the empty old room. `voiceChat.moveRoomOnReplay: false` turns the
    move off. Staff tools that list the room should read `voice-room.json`.
  A panel-banned account (admin-bans.json) gets no token, nor one the
  gamemode refuses through `globalThis.__dboVoiceRefused(actorId)` (a
  suspension). Tokens live 10 minutes. The API base is `voiceChat.apiUrl`,
  or `url` with ws(s) turned into http(s). After a restart the server log
  shows "VoiceSystem: the LiveKit server API answers" once the first sweep
  reaches it; "LiveKit server API call ... failed" or "answered HTTP" means
  sessions are not being removed (a 404 that is not LiveKit's own not_found
  counts as a failure).
- **Voice is inherently identifying.** Nothing in the UI ties a LiveKit
  identity to a character name (identities are actor ids, never rendered), but
  a recognizable voice defeats /mask on its own - an RP-rules matter. The
  front emits `voice::speaking` (`[{id, level}]` of actor ids, own id
  included while the mic is live, every 150 ms while anyone talks); the
  client's `LipSyncService` turns it into face phonemes on those actors, and
  any future speaking-indicator UI built on it must gate names through
  ff_knownIds or it will leak masks.
- **Dead players can talk and hear.** No isDead gate on PTT or listening yet.
- **~200 concurrent voice users max**: the UDP media range is 50000-50200 (one
  port per participant). Widen the range or switch LiveKit to single-port UDP
  mux before the server approaches that.

The historical analysis below is kept for context.

## TL;DR

Voice chat does **not** exist in this codebase, and it does not exist in
mainline skymp either. It exists only as **unmerged, low-maturity pull
requests** on the upstream skymp project. The build flags in the circulating
"SkyMP Build Instructions" note are **fictional** and one of them actively
breaks the build:

- `-DSKYMP_VOICE_CHAT=ON` - there is no such CMake option; nothing reads it, so
  it is silently ignored.
- `-DVCPKG_MANIFEST_FEATURES=voice-chat` - there is no `voice-chat` feature in
  `vcpkg.json` (only `skyrim-flatrim`, `skyrim-vr`, `build-nodejs`,
  `prebuilt-nodejs`). Passing this makes vcpkg **abort** the configure step with
  an unknown-feature error.

Do not pass either flag. Enabling voice is a port-plus-new-infrastructure
project, not a configuration change.

## What voice chat actually is in the skymp ecosystem

It is **browser-based WebRTC** running inside the game's embedded CEF/Chromium
UI, with a **LiveKit** SFU (media server) relaying audio - **not** a native C++
opus codec. Audio capture, opus encoding, and transport all happen inside the
in-game browser via `getUserMedia` + WebRTC; the repo carries no audio library.

The relevant upstream work (all CLOSED / UNMERGED):

- skymp PR #2423 "feat: Add Voice Chat" (branch `skyrim-roleplay:feat/voice-chat`).
  Enables the media stream by injecting Chromium command-line switches in
  `MyChromiumApp.cpp` / `MyBrowserProcessHandler.cpp`, and bundles a server API
  + Discord OAuth login. Its front-end voice UI/signaling client is largely
  **absent** from the diff.
- skymp PRs #2778 / #2779 / #2780 "feat(cef): release mic for in-game voice chat
  (WebRTC)" - the isolated ~28-line CEF mic-enable patch (the clean part).

## What it would take to enable it here

This fork descends from an older skymp via SkyrimRoleplay/skyrp and has its own
auth/roleplay stack, so a blind port would collide with our authentication.
Realistic pieces:

1. **CEF mic enable (small, clean).** Apply the ~28-line switch injection into
   `skyrim-platform/src/tilted/ui/MyChromiumApp.cpp`
   (`OnBeforeCommandLineProcessing`, currently an empty stub) and
   `MyBrowserProcessHandler.cpp`. Our files match the pre-patch upstream base, so
   this cherry-picks cleanly. Note the switches include `disable-web-security`
   and `allow-file-access-from-files` - a real relaxation of the in-game
   browser, acceptable only for a trusted first-party UI. Requires a CI rebuild.
2. **Front-end voice module (large).** Author/port the LiveKit WebRTC client
   (mic capture, room join, proximity attenuation) and an in-game voice UI into
   `skymp5-front`. This is the biggest gap - it is not in the upstream PR diff
   and would have to be written or sourced from a LiveKit-based fork.
3. **Server signaling (medium).** A small server-info / token endpoint plus
   settings keys, and npm deps (LiveKit server SDK). Cherry-pick ONLY the voice
   parts of PR #2423 - drop its Discord/auth churn, which conflicts with ours.
4. **A separate media server.** Stand up a standalone **LiveKit** SFU (or coturn
   TURN) - external to this repo entirely.

## Infrastructure / ports

Voice needs its own transport, independent of the game's UDP 7777:

- LiveKit defaults: TCP 7880 (signaling/WS), TCP 7881 (TURN/TLS), a UDP media
  range (e.g. 50000-60000), optional UDP 3478 STUN/TURN.
- Windows Firewall: inbound rules for the signaling TCP port and the UDP media
  range.
- nginx (`setup_nginx.bat`) is TCP/443 only and cannot carry the UDP media; it
  could optionally reverse-proxy the LiveKit WSS signaling, but media must reach
  LiveKit/TURN directly over UDP.

## Recommendation

Treat voice chat as its own project: (i) cherry-pick the CEF mic patch, (ii)
port/author the LiveKit front-end voice module, (iii) add the server signaling
endpoint + settings + deps, (iv) deploy a LiveKit media server with its own
ports/firewall rules. It is a multi-day effort with a new always-on service to
operate, not something to flip on before launch. When you want to commit to it,
that is a good candidate for its own focused work session.
