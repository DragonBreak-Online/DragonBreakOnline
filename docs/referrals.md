# Referral links

Approved by Nate on 16 Oct 2026 ("Go for it"). Built on branches and tested. Not deployed; switched off in config.
Changed after claude-jake's review of 16 Oct (internal: `/opt/dragonbreak-handover/reviews-1016/`).

## The rules

- **Links.** Every account (profile) gets a code of 8 characters (`BCDFGHJKLMNPQRSTVWXZ23456789`: no vowels, no 0/O or 1/I) and a link,
  `https://dragonbreakonline.com/api/users/login-discord/join/<code>` (under the prefix the public proxy already forwards
  to the backend; `/api/join/` is not forwarded). `/referral` shows it, and so does the Status list (`/status`, Profile tab
  of the journal).
- **A referral is recorded** for a brand-new account only, with one referrer per account and no own code:
  - **through the link** (the main route): the backend binds a Discord login that *creates* the profile. An account that
    existed before the login is never bound.
  - **through `/referral <code>`** (the fallback): only in the first 24 hours of the account's lifetime play (the larger of
    `playtime.js`'s count and this module's), and only for an account made after referrals went live. Go-live is the
    first load with `enabled: true`; nothing is recorded or written while off. The accounts known to the play-time
    records at go-live, and every profile id up to the highest of them, are refused.
- **A referral counts** once the new account has played 5 hours on at least 2 different UTC days, and only if its Discord
  account was at least 90 days old when it was referred (Nate, 16 Oct). The age comes from the Discord id (snowflake). A
  younger, or unknown, account is recorded as "cannot count". It still gets the welcome (Nate: "the welcome stays either way").
  The referrer's friends list shows every referral that does not count (too young or unknown, refused after review,
  revoked by staff or by a ban) as exactly "Friend N: cannot count", with no reason (Jake, 17 Oct); the reason is kept
  in the record for staff only (`/referral profile`, `/referral held`, the audit).
  A day counts only for a **session that began on it** (a break of more than 60 minutes, `sessionGapMinutes`, begins a new
  one) with at least 30 minutes of play (`qualifyDayMinutes`), so one evening session from 22:00 to 03:01 UTC is one day.
- **No alts** (Nate, 16 Oct), within what the Privacy Policy allows:
  - **No address check.** `players.json` `lastIp` is the relay's internal address for every player
    (`docs/ban_device_check.md` in the backend), so it says nothing; the earlier shared-address hold is removed.
  - **The PC check is OFF** (`deviceCheck: false`) until the Privacy Policy names the PC code for this use (Jake, 16 Oct).
    The code stays, dormant. When on, a referral that reaches the thresholds is checked against the backend's
    `data/device-ids.json` (keyed HMACs of the Windows machine id, launcher 2.1.50+): a PC shared with **its referrer**,
    or with **another live referral (pending, checking, held or counted) of the same referrer**, **holds** it for staff;
    it never refuses alone. Referrals of different referrers never affect each other (a household). `/referral held`
    lists the held ones for staff, and a Lead GM types `/referral approve <id>` (it counts now) or `/referral refuse <id>
    [why]` (it never counts; the welcome stays). The PC code comes from the player's own PC, so a modified launcher
    defeats it: a filter, not proof.
  - What a player sees of a check is only "being checked by staff", then "counted" or "cannot count". The match itself is
    written only to the staff audit (`REFERRAL held for review ... shares a PC with ...`); the record keeps `reason: 'PC
    check'`, which only staff see. No PC code or address is stored by the gameplay.
- **Rewards:**
  - **The referrer's first counted referral:** +15% skill progress for 8 hours of play, and +50 carry weight for good
    (the DLE ability `1D1FA7:DragonBreak Online Edits.esp`, magnitude 50). The first boost is given **once**: a revoke
    does not re-arm it (`firstAt` on the referrer's record), so the next counted referral earns the later boost. The
    carry weight follows "at least one counted referral".
  - **Each later counted referral:** +5% for 8 hours of play.
  - **The new player:** +5% for their first 8 hours of play (the welcome), as soon as the referral is recorded. It
    needs no qualification, but it still needs a brand-new account, a known code and a code that is not their own.
- **Boosts never stack.** They queue and run one at a time, 10 at most waiting; a boost past the cap is not queued and is
  audited, but the referral still counts. A boost runs down only while a character of the account is in the world. It
  waits (no progress, no time used) while a playtester or staff boost (`private.xpBoost`) runs on the character. Boosts
  apply to normal play only, never to an award (staff awards, alchemy brews, a class's first-spell award).
- **Staff:** `/referral profile <id>` shows an account; `/referral revoke <id> [why]` (Lead GM and above) takes back
  the referral of the new account `<id>`. That removes its welcome, the referrer's boost from it, and the carry weight if
  no other counted referral remains. Boost time already used is not taken back.
- **Bans.** A Discord ban (`gamemode.js` `__dboDiscordBan`, op `ban`) revokes the referral of every profile of the banned
  Discord account as a referee (reason `banned`). A **banned referrer keeps** what it already earned (its boosts run
  only while it plays, so nothing runs while banned); when the ban was for referral abuse, a Lead GM revokes its
  friends' referrals by hand (`/referral profile <id>` lists them).
- **Deleted accounts.** The backend's `players.deleteByProfileId` drops the profile's rows from `data/referrals.jsonl`;
  then a Lead GM types `/referral forget <id>` to erase its gameplay record and code. The backend also drops rows older
  than 30 days from `referrals.jsonl` (the gameplay reads it every minute, so they were read long before); a rewritten
  file is read again from the start, and a binding already recorded is skipped silently.
- **Audit:** every step is a `REFERRAL` line: recorded, refused, qualified, queue full, ran out, carry given or taken back,
  held for review, approved, refused after review, revoked, erased.
- **Records.** `referrals.json` (runtime, gitignored). The store in memory wins: hand edits or restores take effect only
  with the server **stopped**. A `referrals.json` that exists but cannot be read is copied aside
  (`referrals.json.unreadable-<time>`) and left in place; referrals pause (no write, no new go-live snapshot, no carry
  removal, `/referral` says so) until staff restore it with the server stopped.

## How it works

| Piece | Where | What |
|---|---|---|
| The switch | backend env `REFERRAL_LINKS` | `on` or off (the default). Off: the link only redirects to the website (no cookie, no record) and the login hooks return at once. The undo is one environment value plus a backend restart |
| The link | fork `skymp5-backend/routes/referrals.js`, `sources/referrals.js` | `GET /api/users/login-discord/join/<code>` (also `/api/join/<code>`) sets the `dbo_ref` cookie (HttpOnly, Lax, 30 days, path `/api/users/login-discord`), only on a top-level navigation (no cookie when `Sec-Fetch-Dest` is present and is not `document`). Then it redirects to the website (`REFERRAL_LANDING_URL`, default `WEBSITE_URL/`, with `?ref=<code>`). No address or browser is recorded |
| The binding | same, called from `routes/skymp-compat.js` | The launcher opens `/api/users/login-discord?state=` in the player's default browser (`skymp5-launcher` `config.apiUrl` = `https://dragonbreakonline.com`), so that browser's cookie reaches the backend. Inside that route, after its rate limit and only for an issued, live state (or a registered old-launcher state), the cookie's code is noted against `sha256(state)` (never the state itself). When the login's result (`POST token`, `POST poll` or the old launcher's `GET status`) has made a session for a profile whose `players.json` `createdAt` is no earlier than that browser step, it appends `{kind:'bind', at, code, profileId, accountCreatedAt, via:'cookie'}` to `data/referrals.jsonl` (0600) |
| Everything else | server `referrals.js` | Reads `referrals.jsonl` every minute (byte offset), owns the codes, counts play time (30 s samples, as `playtime.js` does), qualifies, queues and runs the boosts, gives the carry weight ability, and handles `/referral`. Records: `referrals.json` (runtime, gitignored) |
| The boost | server `skillrates.js` | `rateFor` multiplies by `globalThis.__dboReferralSkillRate(actor)` (the running boost's mult, else 1) for every kind except `award`. It does not use `private.xpBoost`, whose `until` is wall clock and which `playtesterboost.js` owns |
| Carry weight | DLE (PC) + `referrals.carrySpell` | A constant-effect ability (+50, `1D1FA7:DragonBreak Online Edits.esp`), given once a session on every character of the account through Papyrus `AddSpell` (as `racial.js` does), and marked in `private.dboReferralCarry`. Empty config = nothing new given (what is held stays). A different record: the held one is removed first. `remove` = taken back from everyone while referrals are on. Referrals off = it stays. claude-nate sets `carrySpell` after the restart that ships the DLE |
| The panel | journal section `referrals` | Registered in `__dboJournalSections`; shown only to a front that lists `journalTab:referrals` in its caps (fork branch `client-referrals-front`). It shows the link, the friends, the queue and the carry weight, and a code box (`referralCode [nonce, code]`) while the player may still enter one. Until that front ships: `/referral` and the Status line |

**Why the cookie route.** The launcher's Discord login always runs through the player's default browser on our own
domain, and that is the browser a shared link opens in. The cookie therefore reaches the login with no launcher change
and no code to type. An "enter a code" field in the launcher would need a launcher release, and every player would
have to type it. Reading the code from the installer's download URL would need the website and a signed installer per
code. `/referral <code>` (and the journal's code box) covers a browser that drops the cookie, a link opened in another
browser or on a phone. There is no address-and-browser fallback: a hidden image on another site could claim other
people's sign-ups with it (review, 16 Oct).

## Config (`gamemode-config.json` → `referrals`)

`enabled` (false), `linkBase`, `bindingsFile` (`/opt/alduinak/skymp5-backend/data/referrals.jsonl`), `qualifyHours` 5,
`qualifyDays` 2, `qualifyDayMinutes` 30, `sessionGapMinutes` 60, `accountAgeDays` 90, `firstMult` 1.15, `laterMult` 1.05,
`welcomeMult` 1.05, `boostHours` 8, `queueCap` 10, `commandWindowHours` 24, `deviceCheck` (false), `playersFile` and
`devicesFile` (the backend's `players.json` and `device-ids.json`, read only by the PC check), `carrySpell` (''),
`carryWeight` 50 (the number the texts show).

## Before switching on

- Backend: `REFERRAL_LINKS=on` only after the Privacy Policy update (cookie, referral record, retention) is through the
  legal gate, `WEBSITE_URL`/`REFERRAL_LANDING_URL` is confirmed as the public https site, and `dbo_backup.py` classifies
  `referrals.jsonl` (backend files) and `referral-pending.json` (deny list).
- Gameplay: `enabled: true` after the backend is live; `carrySpell` after the DLE with the +50 ability is on server and clients.

## Tests

- `node tests/referrals-harness.js` (server, 106 checks).
- `node --test test/referrals.test.js` (fork `skymp5-backend`) and `test/launcherLoginRoutes.test.js` (the hardened login).
