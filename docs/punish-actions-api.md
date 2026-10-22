# Punishments: the final API for the staff dashboard

Branch `punish-backend-final`. It is backend A, the console allowlist and its hardening (898340e2f), merged with
backend B, the ban, unban and Discord routes and the punish-only send (b472e8501 plus the authz and correctness reviews).
On top of those, it gates the bot's ban-list guard and sends the page's account on `/actions/send` as `/console/run` does.
Branch `punish-decisions-1022-backend` adds Jake's three decisions of 22 Oct:
- "Punishments only": a Lead GM sends only `/discipline` and `/kick` through any console path (below);
- "Yes, like in-game /ban": a dashboard game ban keeps the account's last address, as the in-game `/ban` does;
- "Yes, follow role order": the Discord actions follow Discord's role order, and nobody Discord-bans an Administrator.

The page has two ways to send. Both reach the same console function (`runStaffCommand`) and the same game checks.

| Path | Who | What |
|---|---|---|
| `POST /api/site/staff/console/run` (Console panel) | Owners and Dragon Break Dev (`requireStaff`) | any allowlisted command; `/discipline` and `/kick` carry `targetProfileId` |
| `POST /api/site/staff/punishments/actions/send` (Punishments panel) | Owners, Dev and Lead GMs | `/discipline` and `/kick` only, always with the account (`profileId`) |
| `POST /api/site/staff/punishments/actions/<ban…>` | see the table below | game ban and unban, Discord timeout, ban and unban |

GMs get Copy only, everywhere.

A Lead GM is a console caller with no Owners or Dragon Break Dev role (`SITE_OWNER_ROLE_IDS`, `SITE_STAFF_ROLE_IDS`, as
Discord answers at that moment). On `/console/run`, `/actions/send` and Discord `/console` alike, a Lead GM gets only
`/discipline` and `/kick`. Anything else is 422 `notRemote{why:'punishOnly'}` and nothing is sent. The game holds the same
rule on its own (its effective tier, the lower of the fresh and stamped ones, must be Developer or above for anything
else) and refuses with a `refused` job, `why: 'punishOnly'`.

Every answer is JSON with `Cache-Control: no-store, private`. No answer carries a Discord id, an address or a hwid.

## What deploying changes, with every switch at its default

`PUNISH_ACTIONS` unset, `/etc/dragonbreak/punish-actions` absent, and the console switch unchanged.

- Unchanged: the bot's Discord ban and unban handling, the panel's records, audit posting and the Console panel's
  two-key body. The only visible change is backend A's allowlist pre-check. The tests and differential checks behind
  this are listed in the hand-off.
- On at once, whatever the switches: a pinned Lead GM's Discord `/console` takes only `/discipline` and `/kick`. Every
  other line is answered "A Lead GM can run only /discipline and /kick from the console. Run anything else in game." and
  nothing is sent. Owners and Dev keep the whole console.
- New routes under `/api/site/staff/punishments/actions` answer, but no page calls them yet:
  - GET shows every `can.*` as false;
  - every POST answers 503 `actionsOff`, after the rank check.

## Ship order: backend, then the website, then the game

1. This backend, one restart.
2. The website's `dashboard.html` from `dashboard-decisions-1022`.
3. The game's hot reload of `punish-decisions-1022`.

The `dashboard-1021-final` page (74e20c94e) offers Send on Add strike and Add warning as soon as GET `/console` lists
`/discipline`. It sends the two-key `/run` body, without the account. With the new game, that Send works for Owners and
Dev whatever `PUNISH_ACTIONS` says. So that page must never be live with the new game:
- install the new page before the game reload;
- to undo the page while the new game runs, put back 779feb8b4's `dashboard.html`, never 74e20c94e's;
- to stop it with no deploy, write `on web=off` to `/etc/dragonbreak/console` (the Console panel stops too); or set
  `remoteConsole.deny ["discipline"]` in the game and hot reload.

Every other mix of old and new pages, backends and games is Copy only, and the new three send only once `PUNISH_ACTIONS` is on.

## The Console panel's command list: GET `/api/site/staff/console`

`{ v, setting, ready, fresh, signInUrl, commands, maxLength }`.

Each entry in `commands[]` is `{ name, usage, help }`, plus these fields when the game sets them:
- `kinds` (`/discipline`): the record kinds the game takes now, among `warn`, `strike`, `suspend`, `lift` and
  `overturn`. Offer only these.
- `maxSuspendDays` (`/discipline`): the longest suspension.
- `targetProfile: true`: the game checks the page's account for this command.
  - The hardened game sets it on `kick`, `fixloc`, `rename`, `chars`, `chargen` and `discipline`.
  - Send `/discipline` or `/kick` from the dialog only when its entry has `targetProfile === true`. Otherwise show Copy.
- `rank: true` (`discipline`, `kick`): the game refuses a target on a staff account at the caller's rank or higher.

## Console panel send: POST `/api/site/staff/console/run`

Headers, exactly:
- `Content-Type: application/json`
- `X-DBO-Control: 1`
- same-origin (the browser's own `Origin`, and `Sec-Fetch-Site: same-origin` when sent)

Body:
- From the Punishments dialog: exactly `{"requestId":"<v4 uuid>","command":"<line>","targetProfileId":<profile id>}`.
  - `targetProfileId` is the opened account's profile id, as a JSON integer of 0 or more, never a string.
  - Send it on every `/discipline` line (warn, strike, `suspend <len>`, lift, `overturn <n>`) and every `/kick` line.
- From the plain console box: `{requestId, command}` is still accepted.
- Keep the same `requestId` on a resend.
- Any other key, or a bad `targetProfileId`, is 400 `badRequest`.

Answers:
- 200 `{ v, job }`. The job:
  - `{ id: 'w-<uuid>', state, command, setting, ranAs, online, tier, tierLabel, target, why, lines: [{to, text}], at, summary, as }`.
  - `state`: `ran`, `refused`, `failed`, `dry-run`, `notRun` (nothing ran, safe to resend), `unknown` (check #staff-commands
    first), `expired`, `busy`, `bad` or `off`.
- 202 `{ v, job }`: the same `requestId` is still running.
- 400 `badRequest`, `badCommand`.
- 401 `signedOut`, `signInAgain{signInUrl}`.
- 403 `badOrigin`, `badHeader`, `notStaff`, `notAllowed`.
- 409 `conflict` (the `requestId` belongs to another account), `noProfile` (the caller has no game character).
- 415 `badContentType`.
- 422 `notRemote{why, reason}`: refused before anything was sent. Show `reason`. The `why` codes are below.
- 429 `tooMany`.
- 503 `consoleOff`, `unavailable`.

## The Punishments panel actions

Base `/api/site/staff/punishments/actions`. It is mounted before the read-only panel and answers 404 when
`PUNISH_PANEL=off`.

### Who may do what

| Action | Owner | Dragon Break Dev | Lead GM | GM |
|---|---|---|---|---|
| `send` (`/discipline …`, `/kick #TAG`) | yes | yes | yes | no (Copy) |
| `ban`, `unban` (the game ban list, permanent) | yes | yes | no | no |
| `discord-timeout`, `discord-timeout-end` | yes | yes | yes | no |
| `discord-ban`, `discord-unban` | yes | yes | no | no |

Every POST also needs:
- a panel rank (otherwise 403 `notStaff` before anything else);
- the caller's Discord id in the console pin (`CONSOLE_DISCORD_IDS`). The pin is the console's own: a Lead GM pinned here
  (and in the game's pin, which `send` also needs) can also use Discord `/console`, for `/discipline` and `/kick` only
  (Jake, 22 Oct: "Punishments only"). The backend and the game both hold that limit, on every console path;
- a Discord sign-in at most 4 hours old;
- the tier above, from roles asked of Discord at that moment.

Never:
- the caller's own account, by profile or by Discord id (`ownAccount`);
- a staff member of the caller's rank or higher (`staffTarget`). Ranks: Owner 4, Dev 3, Lead GM 2, GM and any other staff
  role 1, player 0. So a Lead GM may act on a GM.

For `send`, the game applies its own checks on top: account, rank, shared tag, the suspend cap, and `discipline.js`'s rules.

### GET `/actions`: what the viewer may do

Any panel rank. Errors: 401 `signedOut`, 403 `notStaff`, 404 `notFound` (panel off), 429 `tooMany`, 503 `unavailable`.

```json
{
  "v": 1, "tier": "leadgm", "fresh": true, "signInUrl": "/api/site/login/fresh", "pinned": true,
  "switch": { "bans": "on", "discord": "on", "send": "on" },
  "send": { "setting": "on", "ready": true, "commands": ["discipline", "kick"] },
  "bot": { "ready": true, "banMembers": true, "moderateMembers": false, "viewAuditLog": true },
  "can": { "send": true, "ban": false, "unban": false, "discordTimeout": false, "discordBan": false },
  "reason": { "min": 5, "max": 300 },
  "timeout": { "maxMinutes": 40320, "presets": [10, 60, 360, 1440, 4320, 10080, 40320] }
}
```

The `can.*` flags. Show a button only when its flag is true, and keep Copy and the in-game or in-Discord hint otherwise.
`may(action)` below means three things together: the tier is allowed (table above), `pinned` is true, and that action's
`switch` area is not `off`.

| flag | true when |
|---|---|
| `can.send` | `may(send)`, `send.setting` is not `off`, `send.ready`, and `send.commands` is not empty |
| `can.ban` | `may(ban)` (also used for `unban`; `unban` has the same tiers and area) |
| `can.unban` | `may(unban)` |
| `can.discordTimeout` | `may(discord-timeout)`, `bot.ready` and `bot.moderateMembers` (also for `discord-timeout-end`) |
| `can.discordBan` | `may(discord-ban)`, `bot.ready` and `bot.banMembers` (also for `discord-unban`) |

- `send.commands`: the subset of `discipline` and `kick` whose allow.json entry has `targetProfile: true`.
  - Offer Send for a line only when its command is listed.
  - With today's game the list is empty, so the dialog stays Copy only.
- `switch.<area>` `dry-run`: every check runs and nothing is done. The job state is `dry-run`.
- `fresh` false: every POST answers `signInAgain`. Offer "Sign in again" (`signInUrl`).
- A GM, anyone not pinned, and every area that is `off` get the flag false.

### POST `/actions/<action>`

Headers are as for `/console/run`. The body has exactly the listed keys and is at most 2 kB.
- `requestId`: a v4 UUID, one per open dialog.
  - "Send again" reuses it, and a changed field gets a new one.
  - After a `failed` job, take a new one: a replay returns the first error again.
- `profileId`: the account, an integer of 0 or more.
- `reason`: the console's own reason rule (`allowlist.js` `reasonWhy`):
  - one line, after NFC, folding whitespace and turning unsafe characters into spaces;
  - 5 to 300 UTF-16 units;
  - letters, digits, spaces and `. , ; : ! ? ' " ( ) - / & + %` only;
  - nothing outside the BMP (no emoji), and no Hangul filler (U+115F, U+1160, U+3164, U+FFA0);
  - no Discord id, address, email or secret.
  - A refusal is 400 `badReason{why}`, where `why` is `reasonShort`, `reasonLong`, `reasonChars` or `reasonPrivate`.
- `confirm`: the action's confirm word, exactly as in this table:

| action | body | confirm word |
|---|---|---|
| `send` | `{requestId, profileId, command, confirm}` | `SEND` |
| `ban` | `{requestId, profileId, reason, confirm}` | `BAN` |
| `unban` | `{requestId, profileId, reason, confirm}` | `UNBAN` |
| `discord-timeout` | `{requestId, profileId, minutes, reason, confirm}` (minutes: an integer, 1 to 40320) | `TIMEOUT` |
| `discord-timeout-end` | `{requestId, profileId, reason, confirm}` | `END TIMEOUT` |
| `discord-ban` | `{requestId, profileId, reason, confirm}` | `DISCORD BAN` |
| `discord-unban` | `{requestId, profileId, reason, confirm}` | `DISCORD UNBAN` |

The checks run in this order. The first refusal answers.
1. The route:
   - 404 `notFound` (an unknown action);
   - 400 `badRequest` (a body some earlier parser already read);
   - 403 `badOrigin`, 415 `badContentType`, 403 `badHeader`, 401 `signedOut`;
   - 403 `notStaff` (no panel rank).
2. Before the body is read:
   - 503 `actionsOff` (the area is off);
   - 503 `unavailable` (the console config or pins);
   - 429 `tooMany` (20 tries in 10 min);
   - 401 `signInAgain{signInUrl}`;
   - 403 `notAllowed` (not pinned, wrong tier, or Discord did not answer within 8 s).
3. The body: 400 `badRequest`, `badProfile`, `badMinutes`, `badReason{why}`, `badCommand`, `badConfirm`.
4. The target: 404 `notFound`, 403 `ownAccount`, 503 `discordUnavailable` (the target's roles are unknown), 403
   `staffTarget`.
5. For the Discord actions, the bot and the member, before Discord is written to:
   - 503 `botNotReady`, `botLacksPermission{permission}`;
   - timeouts: 409 `notInGuild`, 409 `targetIsAdmin`, 403 `roleOrder`, 409 `botBelowTarget`, 409 `notTimedOut` (end);
   - `discord-ban`: a member who is an Administrator is 409 `targetIsAdmin` for every tier; then 403 `roleOrder`, 409
     `botBelowTarget`, and Discord's own ban list (409 `alreadyBanned{kind:'discord'}`, 503 `discordUnavailable`);
   - `discord-unban`: 403 `roleOrder` for a member, then Discord's ban list (409 `notBanned`).

   `roleOrder` (Jake, 22 Oct: "Yes, follow role order"): the target's highest Discord role is at or above the caller's,
   in Discord's own order (the higher position; at the same position the older role). It holds for Owners and Dev too,
   because the bot does the action and Discord checks only the bot's place. As in Discord, the server's owner may act on
   anyone, and nobody acts on the server's owner. An account that is not in the server has no roles, so a ban by id or an
   unban passes it. A role of the caller or the target that the bot's role cache does not hold (or no `@everyone` there)
   is 503 `discordUnavailable`, never skipped. A dry run checks all of this too.

### `send`: `/discipline` and `/kick` from the dialog

The backend:
1. cleans the line, and refuses anything but `/discipline` and `/kick` with 422 `notPunish`;
2. needs `#TAG` as the first word, else 422 `notRemote{why:'needTag'}`;
3. runs the target checks: the `#TAG` must be one of `profileId`'s characters that is not deleted, else 409
   `wrongTarget`; then `ownAccount` and `staffTarget`;
4. calls the console's `runStaffCommand` with `targetProfileId = profileId`, exactly as `/console/run` passes it, plus
   `only: discipline|kick` (a second `notPunish`), the area's setting as a cap (`send=dry-run` makes a dry run) and
   `via punish` for the audit line.

From there it is the Console panel's path:
- the console's web switch (503 `consoleOff`), limits and pin;
- the allowlist pre-check (422 `notRemote{why, reason}`);
- 422 `notRemote{why:'noProfileCheck'}` when the game's entry has no `targetProfile`, and nothing is sent;
- the account's fresh Discord roles, sent as `targetRoles` for `rank` commands;
- one run per `requestId`. The same id with another line is 409 `conflict`. The same id again answers its first job and
  sends nothing, whatever `profileId` the body names.

The game receives the same signed request from both paths: `targetProfileId`, then `targetRoles` or null.

Answers:
- 200 or 202 `{ v, job }`: the console's job. It is read back through GET `/actions/jobs/<id>`, because a Lead GM cannot
  read `/console/jobs`.
- On `ran`, check the reply against `Name #TAG`. `discipline.js` answers:
  - `Recorded: warn|strike #n on Name #TAG.`
  - `Recorded: suspend #n on Name #TAG until YYYY-MM-DD HH:MM UTC.`
  - `Recorded: lift #n on Name #TAG.`
  - `Recorded: overturn #n on Name #TAG of #m (kind by Who).`
  - Each may end with ` They are told at their next login.`
- A `dry-run` job also ran the rank, account, tag and cap checks. `discipline.js`'s own checks did not run, so the dry-run
  wording must not say "your rank over theirs" was tried.

### Answers for `ban`, `unban` and the four Discord actions

200 `{ v, job }`. The same `requestId` again returns the same job and never acts twice. A `failed` job comes back with
its first error status, `{ v, error, code?, job }`.

```json
{ "id": "<requestId>", "action": "ban", "state": "done", "error": "",
  "target": { "profileId": 10, "name": "Bob", "tag": "BOB1", "discordName": "Bobby" },
  "ref": "B-7K2Q9M", "reason": "Griefing at the bank", "minutes": null, "until": null, "banRoleHeld": null,
  "by": "jake", "at": "2026-10-21T22:40:00.000Z", "summary": "Banned from the game as B-7K2Q9M. …" }
```

- `state`:
  - `done`;
  - `dry-run`;
  - `unknown`: Discord did not answer within 10 s. Show `summary`. A late answer still fills the job, so poll the jobs
    route;
  - `failed`: comes with its error status;
  - `notRun`: a backend restart came before the job ran.
- `ref`: the game ban list's `B-XXXXXX` (`ban`, `unban`).
- A game ban keeps the account's last address on the server, as the in-game `/ban` does (Jake, 22 Oct: "Yes, like
  in-game /ban"): the player record's `lastIp`, through `bans.js` `publicIp`. An internal, relay or carrier-grade NAT
  address, one shared by 3 or more player records, or none is not kept; a player store that cannot be read bans by
  Discord id only. Another account that connects from a kept address is refused at login. The address is never in an
  answer, a job, the audit file, an audit or #staff-commands line, the journal, ban.log or the panel. `unban` takes it
  off with the entry.
- `until`: the timeout's end, ISO UTC, in whole seconds. The 28-day timeout ends a minute short of 28 days.
- `banRoleHeld` (`unban`): the account still holds the Discord ban role. Say "remove the ban role in Discord".
- A game ban stops the next login only. Offer "Kick now" as a second `send` with `/kick #TAG` and a new `requestId`.
- After `done`, reload History and Running 2.5 s later. The ban list shows within 2 s, the journal within 30 s.

### Every error code

| status | error | when |
|---|---|---|
| 400 | `badRequest`, `badProfile`, `badConfirm`, `badReason{why}`, `badMinutes`, `badCommand` | the body (`badMinutes` also comes from Discord's 50035) |
| 401 | `signedOut`, `signInAgain{signInUrl}` | no session, or a sign-in older than 4 h |
| 403 | `badOrigin`, `badHeader`, `notStaff`, `notAllowed`, `ownAccount`, `staffTarget`, `roleOrder` | sender checks, no panel rank, tier or pin, the target (`roleOrder`: the Discord actions) |
| 404 | `notFound`, `noDiscordAccount` | an unknown action or account, or an account with no Discord id (Discord's 10013 is `notFound` too) |
| 409 | `conflict` | the `requestId` was used by another account or with other fields (for `send`, another line) |
| 409 | `alreadyBanned{ref, kind}` (`kind` is `ban` or `discord_ban`), or `alreadyBanned{kind:'discord'}` | `ban`, or `discord-ban` |
| 409 | `notBanned` | `unban`, `discord-unban` (also Discord's 10026) |
| 409 | `discordBan` | `unban` of a Discord ban's copy while Discord still bans them: use Discord unban |
| 409 | `notInGuild`, `targetIsAdmin`, `botBelowTarget`, `notTimedOut` | the Discord actions (`notInGuild` also from Discord's 10007; `targetIsAdmin` for timeouts and Discord bans) |
| 409 | `wrongTarget`, `noProfile` | `send`: the `#TAG` is not on that account; the caller has no character |
| 413, 415 | (a sentence), `badContentType` | too large, not JSON |
| 422 | `notPunish`, `notRemote{why, reason}` | `send` only |
| 429 | `tooMany` | the limits |
| 502 | `discordRefused{code}` (`missingPermission` for 50013, or Discord's code), with `job` | Discord refused |
| 503 | `actionsOff`, `consoleOff`, `unavailable`, `storeUnreadable`, `discordUnavailable`, `botNotReady`, `botLacksPermission{permission}` | switched off, or cannot be checked |

### GET `/actions/jobs/<requestId>`

The caller's own jobs only. A `send` job comes from the console, any other from the actions store. Case does not
matter. 200 `{ v, job }`, or 404 `notFound`.

### Limits

Before any Discord lookup:
- 120 requests a minute per session or visitor;
- 20 tries in 10 minutes per account, refusals included.

Accepted actions only (a repeated `requestId` is not counted):
- 5 a minute and 30 an hour per account;
- site-wide each hour: 10 game bans and unbans, 10 Discord bans and unbans, 30 timeouts.

`send` keeps the console's own limits, shared with `/run` and Discord `/console`: 6 a minute, 60 an hour, 30 a minute
site-wide.

## The `why` codes

### `notRemote` (422): the backend pre-check, nothing was sent

Show `reason`. The backend writes it, in the game's own words.

| why | when |
|---|---|
| `needTag` | no `#TAG`, or not one |
| `notYet`, `inWorld`, `self`, `later`, `notChat` | the command is not on the console |
| `denied` | that `/discipline` kind is switched off in the game's config |
| `badKind`, `badLength`, `badRecord`, `badArgs`, `badName` | the line's shape |
| `oneLine` | a line break in the typed text |
| `reasonShort`, `reasonLong`, `reasonChars` | the reason |
| `noProfileCheck` | the game does not check this command against the opened account yet; copy it and run it in game |
| `punishOnly` | a Lead GM, any command but `/discipline` and `/kick` (also on `/console/run` and Discord `/console`) |

### A `refused` job (200, `job.state: 'refused'`, `job.why`): the game did not run it, and a resend is safe

| why | the game's words |
|---|---|
| `targetProfile` | "#TAG is not a character of the account you opened, so nothing was done. Open the player again and pick the character from their list." |
| `profileNoTag` | the command names no #TAG to check against the account |
| `tagShared` | "More than one character carries #TAG, so the console will not guess which one you mean. Run it in game on the player you mean." |
| `tagIndex` | the game could not check the tag; try again |
| `rank` | "#TAG is on a staff account of your rank or higher, so the console will not act on it. Take it to someone above that rank, or to the Owners." |
| `ownAccount` | "#TAG is on your own account. The console does not act on your own account." |
| `rankUnknown` | the game could not read the account's rank |
| `suspendCap` | "#TAG's account has had 3 suspensions from the console in the last hour, the most the console takes. Wait, or do it in game." |
| `suspended` | the caller's own account is suspended |
| `punishOnly` | "A Lead GM can run only /discipline and /kick from the console. Run anything else in game." |
| `target`, `targetAny` | the tag is not online, or there is no such tag |
| `tier`, `rolesChanged`, `notPinned`, `noChar` | the caller, as the game sees them (a new Lead GM logs in once) |
| `tooMany`, `gate`, `unknown` | the game's own limit, or its command gate |
| the pre-check codes above | the game's own pre-check, the same as the backend's |

The game's switch, a late request, a full queue and an unreadable request are not `refused`. They come back as their own
`state` (`off`, `expired`, `busy`, `bad`), and nothing ran.

## Confirmation wording (the page)

- Send: show the exact line and the account ("<Name #TAG> (profile N)"). Every Yes button sends the action's confirm word.
- Ban: "Ban <Name #TAG> (profile N) from the game for good? They cannot log in again until unbanned." Say that, as with
  an in-game `/ban`, their last address is kept (never shown) and refuses other accounts from it. Optionally "Kick them
  now", sent after `done`.
- Discord ban: "Ban <Discord name> from the Discord? The game ban list gets a copy until they are unbanned on Discord."
- Timeout: "Time out <Discord name> on Discord until <UTC>? Discord only; no effect in game."

## Switches and deploy keys

- `PUNISH_ACTIONS`: `off | dry-run | on`, optionally followed by `bans=`, `discord=` and `send=`, which can only narrow it.
  - Unset is `off`. It is read at start, so changing it needs a restart.
- `PUNISH_ACTIONS_SWITCH_FILE` (default `/etc/dragonbreak/punish-actions`): the same format, read on every action. It can
  only narrow the env key.
  - Missing narrows nothing.
  - Malformed, a symlink, or more than 64 bytes reads as `off`.
  - Writing `off` to it stops every action at once, and turns the bot's guard off, with no restart. It is read again just
    before an action is recorded, so it also stops a request already past its sign-in and rank checks (`dry-run` there
    makes it a dry run). An action already recorded runs to its end.
- The bot's guard of the game ban list is on only while the bans area is `on` (env narrowed by the file, read at each
  Discord event). The guard means:
  - a Discord ban never replaces an existing game ban; a kept one that has no address takes the Discord ban's (the
    player record's `lastIp` through `publicIp`), so a Discord ban still catches the same connection;
  - a Discord unban lifts only the bot's own `discord ban` copy;
  - the list is read fail-closed.

  Otherwise the bot does exactly what 779feb8b4 did, and a Discord unban lifts any game ban. So turning bans on is the
  moment to tell staff that game bans are lifted on the Punishments panel, and no longer by a Discord unban.
- `STAFF_COMMANDS_CHANNEL_ID`: the game's #staff-commands channel. Bans and Discord actions are posted there in the game's
  form. Unset: the audit channel only.
- Bot permissions: Ban Members (bans), Moderate Members (timeouts), View Audit Log (optional). Look for this backend log
  line at gateway ready: `[discord-bot] moderation: Ban Members yes|no, Moderate Members yes|no, View Audit Log yes|no`.
- The console's own switch (`/etc/dragonbreak/console`, `web=`) also gates `send` and `/run`.
