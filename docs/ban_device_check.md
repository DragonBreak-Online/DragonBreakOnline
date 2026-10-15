# Ban enforcement check (report only)

Fix L3-01 / L4-1 of the 15 Oct 2026 security audit. Bans matched only the Discord id, so a banned player could come
back on a new Discord account. This check links accounts that play on the same PC as a banned account and tells staff.
It **never refuses anyone**: a match is a lead in the staff audit channel, and staff ban a confirmed alt with the
existing Add Ban button.

The code is in `skymp5-backend/sources/deviceChecks.js` (called from `routes/launch-check.js`), the launcher's half in
`skymp5-launcher/src/deviceId.js`. Address matching in `skymp5-backend/sources/bans.js` was hardened at the same time.

## What it is, and what it is not

- It raises the cost of ban evasion. It is not proof.
- A modified launcher, a virtual machine, a Windows reinstall or a machine id changer gets past it. A missing code is
  never held against anyone.
- An ALT CHECK lead is posted only when all three of these hold:
  1. the ban is in bans.json: a dashboard ban, an in-game permanent ban, or a Discord ban recorded while the backend
     was running;
  2. the banned account's PC was seen with launcher 2.1.50 or later while the key was set, in the 30 days before the
     ban (`DEVICE_RETENTION_DAYS`) or any time after it;
  3. the alt plays with launcher 2.1.50 or later.
- **Not covered.** These cases produce no line at all, so silence never means "not an alt":
  - in-game temp bans and IP bans: they are kept only on the game server (`skymp5-server/ts/systems/adminBans.ts`),
    never in bans.json;
  - Discord bans made while the backend was down: the bot records a ban only as it happens (`sources/discord/bot.js`
    has no start-up reconciliation);
  - bans made before the key was set, until the banned account presses PLAY again with 2.1.50 or later;
  - a banned account idle for more than 30 days before its ban: its PCs were already deleted under the 30-day rule.
- The code comes from the player's own PC, so the server never trusts it: it never allows, verifies, clears, lifts or
  whitelists anything, and nothing reads it except this check and the staff view.
- Until the F1 login fix is live with `LAUNCHER_LOGIN_LEGACY=revoke`, a stolen old-flow session could attach the thief's
  PC to the victim's account. Report-only, the "Older launcher login" wording, the limits below and Not an alt cover that.

## How it works

1. Launchers from 2.1.50 read the Windows `MachineGuid` once per run and send
   `device: "v1." + sha256("DragonBreak device v1\n" + guid)` in the body of `POST /api/launch-check` on every PLAY.
   The machine id itself never leaves the PC and is never logged. When it cannot be read the launcher sends
   `deviceStatus: "unavailable"`. Older launchers send neither; their launch-check works as before.
2. The backend answers launch-check first, exactly as before, then hands the body to the check. The answer is the same
   bytes with or without a code and with or without a match.
3. The check keeps only `HMAC-SHA256(DEVICE_ID_HMAC_KEY, "device:v1:" + code)`, cut to 32 hex characters, per account,
   in `data/device-ids.json` (0600, git-ignored). Nothing else stores it: not players.json, sessions.json, bans.json,
   ban.log, Discord, the dashboard or the game server.
4. Limits, because a modified launcher can send any value: one code per launcher session (a different one later is
   ignored), at most 3 new PCs a day and 5 in all per account. The extra ones are dropped, never the first ones, so a
   stolen session cannot push the owner's real PC out.
5. Every ban has a reference, `B-` and 6 characters (for example `B-7KQ2MX`). Banned means the account has an entry in
   bans.json (a dashboard ban, an in-game permanent ban, or a Discord ban recorded while the backend was running; see
   Not covered above).

## What staff see

Lines in the staff audit channel. Players are named only by up to 3 characters and their #TAG, never by Discord id,
profile number, code or address. Each lead is posted once per account and ban in 30 days.

| Line | When |
|---|---|
| `ALT CHECK (report only) ...: plays on a PC linked to banned account ... (ban B-..., banned 14 Oct).` | An account plays on a PC a banned account used, or a newly banned account used a PC this account plays on (checked within 5 minutes of the ban). The line goes on with whether the account first appeared before or after the ban, the Discord account's age, how many other active accounts play on that PC, and whether both logins were PC-bound or an older launcher login. |
| `BANNED ACCOUNT BACK ... (ban B-...)` | A banned account pressed Play from a PC not seen before. That PC is now on its ban, so an alt that later plays from it is flagged. |
| `NEW ACCOUNT ...: Discord account N days old at first launch.` | A Discord account younger than `NEW_ACCOUNT_FLAG_DAYS` launches for the first time and has never joined the game. Older launchers too. |
| `DEVICE CHURN ...` | An account sent more new PCs than the limits allow. A modified launcher is one possible cause. |
| `NOT AN ALT ... for ban B-..., marked by ...` | A staff member marked a link not an alt, or took the mark back. |
| `BAN ... added to the game ban list as B-...` | The Discord ban line now names the ban reference. |

The dashboard (players.view) shows a Device column: `linked to ban B-...`, `not an alt (B-...)` or `-`. Searching a ban
reference lists the banned account and every account linked to it. The player detail lists each link with how many other
accounts share the PC, the login type and when the account first appeared; with players.manage it has **Not an alt**
and **Undo**.

### Reading a lead

- **A family or shared PC** usually looks like: the account existed before the ban, several active accounts play on
  the PC, and the Discord account is old. Mark it **Not an alt** once you are satisfied. The mark lasts until that
  ban is lifted.
- **An alt** usually looks like: the account is new since the ban, the Discord account is days old, and the banned
  account was seen on that PC recently (BANNED ACCOUNT BACK is a strong sign).
- "Older launcher login, so this could be someone else's PC" means the evidence came from a launcher session that is
  not bound to the PC it started on. Weigh it less.
- Some modified Windows images and VM templates share one `MachineGuid`, so one code held by several unrelated accounts
  can look like a shared PC. A "Shared PC" count can be strangers, not a family.
- An account made before the ban reads like a family member, and so does an alt made in advance. "Existed before the
  ban" lowers the weight of a lead; it does not clear it.
- A confirmed alt gets the existing **Add Ban** on the dashboard (or a Discord ban). Never ban on a lead alone.

## Switches (backend env, read at start)

| Variable | Default | Values |
|---|---|---|
| `DEVICE_ID_HMAC_KEY` | empty | The server's secret for the stored codes: 64 or more hex characters. Empty, short or not hex: the check is off, stores nothing, and says so once in the log. Never printed or logged. |
| `DEVICE_MATCH` | `report` | `report` collects and flags to staff. `off` collects and flags nothing (launch-check is unaffected). `enforce` is not built: it logs that and reports. Any other value is `report`. |
| `DEVICE_RETENTION_DAYS` | `30` | Days a code is kept after the PC was last used to play, 7 to 90. Above 30 needs the Privacy Policy changed first. |
| `NEW_ACCOUNT_FLAG_DAYS` | `30` | NEW ACCOUNT for Discord accounts younger than this at first launch, 0 to 365. 0 turns it off. The age is read from the Discord id itself; no API call. |

The check is also off, and leaves the file as it is, when `data/device-ids.json` cannot be read; one log line names it.
Once a day the backend logs one line of counts, without values: launch-checks with a code, unavailable or none,
malformed codes, session changes, codes dropped by the limits, flags by kind, not-an-alt marks, and raw hwids discarded
on the old routes.

## Retention and erasure

- A code is deleted 30 days after the PC was last used to play (hourly prune, and once at start-up).
- A banned account's codes are kept while its bans.json entry exists; after an unban the 30-day rule applies.
- An account entry with no codes is deleted 30 days after its last day, unless the account is banned.
- Flags last 30 days. A not-an-alt mark lasts until its ban is gone. Session bindings are in memory only.
- Deleting a player (`players.deleteByProfileId`) erases its entry, except a banned account's (Privacy Policy section 6).
- **Privacy request:** run this **before** the player's profile or characters are deleted. With the player's profile
  number, run `node scripts/forget-device.js --profile <N>` in `skymp5-backend`. It prints only `removed`,
  `nothing stored` or `kept: account is banned`, or `no such profile: nothing was checked` (exit code 3) for a
  profile number profiles.json does not hold. Run it twice to confirm. It takes a profile number, never a Discord id,
  and is safe while the backend runs.
- The script finds the entry only through profiles.json. If the profile is already gone it cannot find it, and the
  entry is deleted under the 30-day rule: within 30 days of the player's last PLAY, unless the account is banned.
- **Never move or delete `data/bans.json` while the backend runs**, and never start the backend with it moved aside. A
  missing file counts as no bans, so the hourly prune (and the one at start-up) deletes banned accounts' PCs older
  than 30 days, and putting the file back does not restore them.
- Never copy `data/device-ids.json` into `/opt/skymp-backups` or any other backup or archive: it has its own 30-day
  retention class (Privacy Policy section 5), and it rebuilds itself as players launch. The hourly backup tool
  `/opt/dragonbreak-tools/backups/dbo_backup.py` copies only its allowlist from `data/`, so it does not take the file,
  but it logs every unclassified `data/` name on each run and its cloud push WARNs "so somebody decides allow or deny".
  Rollout step 2 settles that before the key is set.
- Changing the key makes every stored code meaningless: delete the file at the same time.

## The old raw hwid

Launchers 2.1.30 to 2.1.49 post the raw `MachineGuid` to `POST /api/users/me/hwid` after login. The public proxy has
never forwarded that path, and the backend now stores nothing from it or from `/me/play` (it only counts it). bans.js
no longer keeps or matches an hwid. **Do not add a proxy location for `/api/users/me/hwid`**: old launchers would start
sending the raw machine id. No proxy change is needed for this check, because `/api/launch-check` is already forwarded.

## Addresses in bans

`sources/bans.js` puts every address in one form first (brackets, `%zone`, a trailing dot and an IPv4 port removed,
IPv4-mapped IPv6 turned into IPv4) and uses only what Node accepts as an address. Special-purpose ranges are never
stored in a ban or matched (private, loopback, link-local, carrier-grade NAT, `192.0.0.0/24`, `198.18.0.0/15`,
multicast, reserved, NAT64, Teredo, 6to4, unique local). A public address that is the last address of 3 or more players
is never stored or matched either; a players.json that cannot be read turns address matching off.

**An address match still refuses.** It is the only refusal path besides the Discord id: the game server's connection
check (`POST /api/servers/:key/connection-check`) refuses a connection whose address matches a ban's. Today it is
dormant only because every stored address is the one internal relay value (15 Oct: 1 ban, holding no address; 184 of
184 stored addresses are the one internal value). Once the server sees real player addresses:

- banning one player refuses every other account behind the same public address while fewer than 3 player records
  share it (a household of 2, a CGNAT pair);
- if the relay itself became a public address, a ban made in the first minutes can refuse the next player to connect,
  until a third player has connected through it.

**Gate:** before any change that lets the server see real addresses (L3-02, a port forward that keeps source addresses,
a server move), address matches must become report-only leads or be removed.

Follow-ups: stop storing the internal last ip (L3-02), and give the game server's `adminBans.ts` and `adminSystem.ts`
the same checks (its private-address test lacks `100.64.0.0/10`).

## Rollout

Commands below run as root; from the `nate` user, prefix them with `sudo` (step 3 says how for its redirect).

1. Deploy the backend after the Phase 1 restart with `DEVICE_ID_HMAC_KEY` unset.
   - **Before that start**, check free space on CT 115's root filesystem (`df -h /`). On 15 Oct it was at 100% (about
     370 MB free) and `dbo-disk-check.service` had failed: free space first.
   - **Before that start**, copy the ban list aside, keeping its 0600 mode, into a root-only folder (never `/tmp`):
     `install -d -m 700 /root/ban-list-backups && cp -p /opt/alduinak/skymp5-backend/data/bans.json /root/ban-list-backups/bans.json.before-L3-01`
   - If the deploy is on a day other than 2026-10-15: set that day in `data/legal/legal.json` (`version` and
     `effective`) and in `data/legal/privacy.md` (Effective date and Last updated), drop the unshipped `2026-10-15` key
     from `data/legal/hashes.json`, run `npm run legal-record` again, and commit that before deploying.
   - The first start rewrites `data/bans.json` once, even with the key unset: the start-up prune reads the ban list,
     which gives every entry without one a `B-` ref and saves it (15 Oct: 1 entry, none with a ref). The save is
     atomic and keeps the file 0600.
   - The check is off (one log line), and the policy bump asks every player to accept the updated Privacy Policy once
     in the launcher.
   - Rolling back to the old code is safe: it ignores the refs. A re-ban made under the old code gets a new ref when
     the new code next reads the list, and a Not an alt mark on the old ref then lapses.
2. **Before the key is set, hand this to the backup tool's owner** (claude-jake, per its README; this lane cannot change
   `/opt`): add `device-ids\.json` to `DENY` in `/opt/dragonbreak-tools/backups/dbo_backup.py`, so `verify` refuses it
   in any archive, or at least to `BACKEND_KNOWN_OUT`. The reason: it has its own 30-day retention class
   (privacy.md section 5) and is never archived. Go on to step 3 only once that is in.
3. In a restart window, set the key without printing it. It must be added once only: a second run would silently
   rotate the key (the last assignment in the EnvironmentFile wins) while the store stays, which must never happen.
   As root:

   ```
   grep -q '^DEVICE_ID_HMAC_KEY=' /opt/dragonbreak/backend.env || { umask 077; printf '\nDEVICE_ID_HMAC_KEY=%s\n' "$(openssl rand -hex 32)" >> /opt/dragonbreak/backend.env; }
   grep -c '^DEVICE_ID_HMAC_KEY=' /opt/dragonbreak/backend.env
   ```

   From the `nate` user the whole first line goes in `sudo sh -c`, because a `>>` after `sudo` runs as `nate` and fails:

   ```
   sudo sh -c 'grep -q "^DEVICE_ID_HMAC_KEY=" /opt/dragonbreak/backend.env || { umask 077; printf "\nDEVICE_ID_HMAC_KEY=%s\n" "$(openssl rand -hex 32)" >> /opt/dragonbreak/backend.env; }'
   sudo grep -c '^DEVICE_ID_HMAC_KEY=' /opt/dragonbreak/backend.env
   ```

   The count must print `1` (a count, never the value); anything else, do not restart. Then restart. The log says
   `on, report only`. If it says `is not set`, the file holds an empty `DEVICE_ID_HMAC_KEY=` line: replace that line
   by hand without printing the file, never add a second one.
4. Release launcher 2.1.50 with the device code (launcher only, no CLIENT_VERSION bump), ideally with F1's launcher
   release.
5. Watch at least 2 weeks of the daily count line. If more than 5% of launch-checks from new launchers say
   unavailable, look at a server-issued install token.
6. Jake decides whether enforcement is ever built.

**Undo:** `DEVICE_MATCH=off` and restart. Full erase: stop the backend, delete `data/device-ids.json`, unset the key.
Old launchers keep working throughout, and a new launcher works against an old backend (it ignores the field).

## Enforcement (not built)

A separate change, at the earliest after 2 weeks of report data, with F1 live and `LAUNCHER_LOGIN_LEGACY=revoke`. It would
refuse a session (never add a ban) only when the evidence came from a PC-bound session, the PC is not shared, the
account first appeared after the ban or its Discord account is younger than the threshold, there is no not-an-alt mark,
and the ban still stands; with the same generic 403 `banned`, launch-check unchanged, a breaker that pauses refusals
after 10 in an hour and alerts staff, a ticket message for the player and a one-click clear for staff. A sibling who
first plays after a ban on the same PC meets every one of these conditions, so it needs staff review either way.
