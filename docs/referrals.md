# Referral links

Approved by Nate on 16 Oct 2026 ("Go for it"). Built on branches and tested. Not deployed; switched off in config.

## The rules

- **Links.** Every account (profile) gets a code of 8 characters (`BCDFGHJKLMNPQRSTVWXZ23456789`: no vowels, no 0/O or 1/I) and a link,
  `https://dragonbreakonline.com/api/join/<code>`. `/referral` shows it, and so does the Status list (`/status`, Profile tab
  of the journal).
- **A referral is recorded** for a brand-new account only, with one referrer per account and no own code:
  - **through the link** (the main route): the backend binds a Discord login that *creates* the profile. An account that
    existed before the login is never bound.
  - **through `/referral <code>`** (the fallback): only in the first 24 hours of play, and only for an account made after
    referrals went live. The accounts known to the play-time records at go-live, and every profile id up to the highest
    of them, are refused.
- **A referral counts** once the new account has played 5 hours on at least 2 different UTC days, and only if its Discord
  account was at least 30 days old when it was referred. The age comes from the Discord id (snowflake). A younger, or
  unknown, account is recorded as "cannot count".
- **Rewards:**
  - **The referrer's first counted referral:** +15% skill progress for 8 hours of play, and +100 carry weight for good.
  - **Each later counted referral:** +5% for 8 hours of play.
  - **The new player:** +5% for their first 8 hours of play (the welcome), as soon as the referral is recorded. It
    needs no qualification, but it still needs a brand-new account, a known code and a code that is not their own.
- **Boosts never stack.** They queue and run one at a time, 10 at most waiting; a boost past the cap is not queued and is
  audited, but the referral still counts. A boost runs down only while a character of the account is in the world. It
  waits (no progress, no time used) while a playtester or staff boost (`private.xpBoost`) runs on the character.
- **Staff:** `/referral profile <id>` shows an account; `/referral revoke <id> [why]` (Lead GM and above) takes back
  the referral of the new account `<id>`. That removes its welcome, the referrer's boost from it, and the carry weight if
  no other counted referral remains.
- **Audit:** every step is a `REFERRAL` line: recorded, refused, qualified, queue full, ran out, carry given or taken back,
  revoked.

## How it works

| Piece | Where | What |
|---|---|---|
| The link | fork `skymp5-backend/routes/referrals.js`, `sources/referrals.js` | `GET /api/join/<code>` sets the `dbo_ref` cookie (HttpOnly, Lax, 30 days, path `/api/users/login-discord`). It also keeps the visit as a salted hash of address + browser for 7 days, for a browser that drops the cookie. Then it redirects to the website (`REFERRAL_LANDING_URL`, default `WEBSITE_URL/`, with `?ref=<code>`) |
| The binding | same | The launcher opens `/api/users/login-discord?state=` in the player's default browser (`skymp5-launcher` `config.apiUrl` = `https://dragonbreakonline.com`), so that browser's cookie reaches the backend. The tap notes the code against the state. When the login's result (`POST token`, `POST poll` or the old launcher's `GET status`) hands out a session for a profile whose `players.json` `createdAt` is no earlier than that browser step, it appends `{kind:'bind', at, code, profileId, accountCreatedAt, via}` to `data/referrals.jsonl` (0600) |
| Everything else | server `referrals.js` | Reads `referrals.jsonl` every minute (byte offset), owns the codes, counts play time (30 s samples, as `playtime.js` does), qualifies, queues and runs the boosts, gives the carry weight ability, and handles `/referral`. Records: `referrals.json` (runtime, gitignored) |
| The boost | server `skillrates.js` | `rateFor` multiplies by `globalThis.__dboReferralSkillRate(actor)`: the running boost's mult, else 1. It does not use `private.xpBoost`, whose `until` is wall clock and which `playtesterboost.js` owns |
| Carry weight | DLE (PC) + `referrals.carrySpell` | A constant-effect ability, given once a session on every character of the account through Papyrus `AddSpell` (as `racial.js` does), and marked in `private.dboReferralCarry`. Empty config = nothing given and nothing promised |
| The panel | journal section `referrals` | Registered in `__dboJournalSections`; shown only to a front that lists `journalTab:referrals` in its caps (fork branch `client-referrals-front`). It shows the link, the friends, the queue and the carry weight, and a code box (`referralCode [nonce, code]`) while the player may still enter one. Until that front ships: `/referral` and the Status line |

**Why the cookie route.** The launcher's Discord login always runs through the player's default browser on our own
domain, and that is the browser a shared link opens in. The cookie therefore reaches the login with no launcher change
and no code to type. An "enter a code" field in the launcher would need a launcher release, and every player would
have to type it. Reading the code from the installer's download URL would need the website and a signed installer per
code. The hashed visit covers browsers that block the cookie. `/referral <code>` covers a link opened in another browser or
on a phone.

## Config (`gamemode-config.json` → `referrals`)

`enabled` (false), `linkBase`, `bindingsFile` (`/opt/alduinak/skymp5-backend/data/referrals.jsonl`), `qualifyHours` 5,
`qualifyDays` 2, `accountAgeDays` 30, `firstMult` 1.15, `laterMult` 1.05, `welcomeMult` 1.05, `boostHours` 8, `queueCap` 10,
`commandWindowHours` 24, `carrySpell` ('').

## Tests

- `node tests/referrals-harness.js` (server, 68 checks).
- `node --test test/referrals.test.js` (fork `skymp5-backend`, 8 tests).
