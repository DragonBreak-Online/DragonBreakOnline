# Punishments panel actions: API for the staff dashboard

Backend: `skymp5-backend/routes/site-punish-actions.js` and `sources/punish/actions.js`, mounted at
`/api/site/staff/punishments/actions`, before the read-only panel. Off until `PUNISH_ACTIONS` is set (below). Every answer
is JSON with `Cache-Control: no-store, private`. No answer carries a Discord id, an address or a hwid.

## Who may do what

| Action | Owner | Dragon Break Dev | Lead GM | GM |
|---|---|---|---|---|
| `send` (`/discipline …`, `/kick #TAG`) | yes | yes | yes | no (copy the command) |
| `ban`, `unban` (the game ban list, permanent) | yes | yes | no | no |
| `discord-timeout`, `discord-timeout-end` | yes | yes | yes | no |
| `discord-ban`, `discord-unban` | yes | yes | no | no |

Each POST also needs:
- the caller's Discord id in the console pin (`CONSOLE_DISCORD_IDS`);
- a Discord sign-in at most 4 hours old (`CONSOLE_FRESH_SIGNIN_HOURS`);
- the rank above, from roles asked of Discord at that moment.

It never acts on:
- the caller's own account (by profile or by Discord id);
- a staff member of the caller's rank or higher (Owner 4, Dev 3, Lead GM 2, GM and any other staff role 1). So a Lead GM
  can act on a GM, nobody on a peer, and an Owner on a Dev but not on another Owner.

For `send`, the game applies each command's own rank rules on top (suspend, lift and overturn are Lead GM and above).

## GET `/api/site/staff/punishments/actions`

Any panel rank (owner, dev, leadgm, gm). Errors: 401 `signedOut`, 403 `notStaff`, 404 `notFound` (panel off), 429 `tooMany`, 503 `unavailable`.

```json
{
  "v": 1, "tier": "leadgm", "fresh": true, "signInUrl": "/api/site/login/fresh", "pinned": true,
  "switch": { "bans": "on", "discord": "on", "send": "dry-run" },
  "send": { "setting": "on", "ready": true, "commands": ["discipline", "kick"] },
  "bot": { "ready": true, "banMembers": true, "moderateMembers": false, "viewAuditLog": true },
  "can": { "send": true, "ban": false, "unban": false, "discordTimeout": false, "discordBan": false },
  "reason": { "min": 5, "max": 300 },
  "timeout": { "maxMinutes": 40320, "presets": [10, 60, 360, 1440, 4320, 10080, 40320] }
}
```

- `can.*`: show a button only when it is true. When it is false, keep Copy and the in-game or in-Discord hint.
  - A GM gets all false. So does anyone not pinned, and every area the switch has off.
  - `discordTimeout` also needs `bot.moderateMembers`, and `discordBan` needs `bot.banMembers`.
  - `send` also needs the console's own web setting (`send.setting`, not `off`) and `send.ready`.
- `send.commands`: `discipline` appears only once the game publishes its console rule. Until then, offer only `/kick` to send.
- `fresh` false: a POST answers `signInAgain`. Offer "Sign in again" (`signInUrl`).

## POST `/api/site/staff/punishments/actions/<action>`

Headers, exactly:
- `Content-Type: application/json`
- `X-DBO-Control: 1`
- same-origin (the browser's own Origin and Sec-Fetch-Site)

The body has exactly the listed keys, at most 2 kB. Common fields:
- `requestId`: a v4 UUID. The dialog keeps one while it is open. "Send again" reuses it; a changed field gets a new one.
- `profileId`: the account (an integer).
- `reason`: one line of 5 to 300 characters: letters, digits, spaces and `. , ; : ! ? ' " ( ) - / & + %`.
  - It may hold no emoji, markup, mentions, `#`, `@`, `<>`, `[]`, `|`, `\`, `*`, `_` or `~`.
  - It may hold no Discord id, address, email or secret.
  - A refusal is 400 `badReason` with `why`: `reasonShort`, `reasonLong`, `reasonChars` or `reasonPrivate`.
- `confirm`: the action's word, exactly, as written in the table below.

| action | body | confirm |
|---|---|---|
| `send` | `{requestId, profileId, command, confirm}` | `SEND` |
| `ban` | `{requestId, profileId, reason, confirm}` | `BAN` |
| `unban` | `{requestId, profileId, reason, confirm}` | `UNBAN` |
| `discord-timeout` | `{requestId, profileId, minutes, reason, confirm}` (minutes: an integer, 1 to 40320) | `TIMEOUT` |
| `discord-timeout-end` | `{requestId, profileId, reason, confirm}` | `END TIMEOUT` |
| `discord-ban` | `{requestId, profileId, reason, confirm}` | `DISCORD BAN` |
| `discord-unban` | `{requestId, profileId, reason, confirm}` | `DISCORD UNBAN` |

### Answers for `ban`, `unban` and the four Discord actions

200 `{ v, job }`. The same `requestId` again returns the same job and never acts twice.

```json
{ "id": "<requestId>", "action": "ban", "state": "done", "error": "",
  "target": { "profileId": 10, "name": "Bob", "tag": "BOB1", "discordName": "Bobby" },
  "ref": "B-7K2Q9M", "reason": "Griefing at the bank", "minutes": null, "until": null, "banRoleHeld": null,
  "by": "jake", "at": "2026-10-21T22:40:00.000Z", "summary": "Banned from the game as B-7K2Q9M. …" }
```

- `state`:
  - `done`
  - `dry-run`: every check passed and nothing was written.
  - `unknown`: Discord did not answer within 10 s. Show `summary` ("check Discord and #staff-commands before trying
    again"). A late answer still updates the job, so poll the jobs route.
  - `failed`: comes with an error status, below.
- `ref`: the game ban list's `B-XXXXXX`, for `ban` and `unban`.
- `until`: the timeout's end, ISO UTC, whole seconds.
- `banRoleHeld` (unban): true when the account still holds the Discord ban role. Say "remove the ban role in Discord".
- After `done`, reload History and Running now after 2.5 s. The panel reads the ban list within 2 s and the journal
  within 30 s.

Errors, as `{ v, error, … }`:

| status | error | when |
|---|---|---|
| 400 | `badRequest`, `badProfile`, `badConfirm`, `badReason{why}`, `badMinutes`, `badCommand` | the body |
| 401 | `signedOut`, `signInAgain{signInUrl}` | no session, or a sign-in older than 4 h |
| 403 | `badOrigin`, `badHeader`, `notStaff`, `notAllowed`, `ownAccount`, `staffTarget` | sender checks, no panel rank, rank or pin, target |
| 404 | `notFound`, `noDiscordAccount` | no such account, or it has no Discord account |
| 409 | `conflict` | the requestId was used by another account or with other fields |
| 409 | `alreadyBanned{ref, kind}` (`kind` is `ban` or `discord_ban`), or `alreadyBanned{kind:'discord'}` | `ban`, or `discord-ban` |
| 409 | `notBanned` | `unban`, `discord-unban` |
| 409 | `discordBan` | `unban` of a Discord ban's copy while Discord still bans them: use Discord unban |
| 409 | `notInGuild`, `targetIsAdmin`, `botBelowTarget`, `notTimedOut` | Discord actions |
| 413, 415 | (a sentence), `badContentType` | too large, not JSON |
| 429 | `tooMany` | limits, below |
| 502 | `discordRefused{code}` (`missingPermission` or Discord's code), with `job` | Discord refused |
| 503 | `actionsOff`, `unavailable`, `storeUnreadable`, `discordUnavailable`, `botNotReady`, `botLacksPermission{permission}` | off, or cannot be checked |

### Answers for `send`

- `send` runs `/discipline #TAG …` or `/kick #TAG` in game as the caller, through the remote console. The checks:
  - the console's switch and limits;
  - the game's own rules;
  - the `#TAG` must be one of `profileId`'s characters that is not deleted, else 409 `wrongTarget`.
- 200 `{ v, job }`: the console's job.
  - `state` is `ran`, `refused`, `failed`, `dry-run`, `notRun` or `unknown`.
  - It also has `lines`, `target`, `as` and `summary`.
  - Read the game's reply as the Console panel does (`Recorded: warn #n on Name #TAG.`).
- 202 `{ v, job }`: the same requestId is still running.
- Refusals:
  - 422 `notPunish`: not `/discipline` or `/kick`.
  - 422 `notRemote{why, reason}`: the game's allowlist (for example `notYet` until `/discipline` is published).
  - 409 `wrongTarget`, `conflict`.
  - 503 `consoleOff`: the console's `web=` switch.
  - All the shared codes above.

### Limits

Before any Discord lookup:
- 120 requests a minute per session or visitor;
- 20 tries in 10 minutes per account, refusals included.

Accepted actions only (a repeated requestId is not counted):
- 5 a minute and 30 an hour per account;
- site-wide each hour: 10 game bans and unbans, 10 Discord bans and unbans, 30 Discord timeouts.

`send` keeps the console's own limits.

## GET `/api/site/staff/punishments/actions/jobs/<requestId>`

The caller's own jobs only. A `send` job comes from the console, any other from this store. 200 `{ v, job }`, or 404 `notFound`.

## Confirmation wording (the page)

- Ban: "Ban <Name #TAG> (profile N) from the game for good? They cannot log in again until unbanned." Optional "Kick them
  now": after `done`, a second `send` with `/kick #TAG` and a new requestId.
- Discord ban: "Ban <Discord name> from the Discord? The game ban list gets a copy until they are unbanned on Discord."
- Timeout: "Time out <Discord name> on Discord until <UTC>? Discord only; no effect in game."
- Every Yes button sends the action's `confirm` word.

## Switches and deploy keys

- `PUNISH_ACTIONS`: `off | dry-run | on`, optionally followed by `bans=`, `discord=` and `send=`, which can only narrow it.
  Unset is `off`, so deploying the code changes nothing until it is set. It is read at start.
- `PUNISH_ACTIONS_SWITCH_FILE` (default `/etc/dragonbreak/punish-actions`): read on every action, in the same format, and
  it can only narrow the env key. Missing narrows nothing; malformed, a symlink or more than 64 bytes is `off`. Write
  `off` to it to stop every action at once without a restart.
- `STAFF_COMMANDS_CHANNEL_ID`: the game's #staff-commands channel. Bans and Discord actions are posted there in the game's
  form. If it is unset, the audit channel only.
- Bot permissions: Ban Members (bans), Moderate Members (timeouts), View Audit Log (optional). The backend log line at
  gateway ready reads `[discord-bot] moderation: Ban Members yes|no, Moderate Members yes|no, View Audit Log yes|no`.
