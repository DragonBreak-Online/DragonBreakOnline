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
  ban is lifted, or until the marked account has not played for 30 days (`DEVICE_RETENTION_DAYS`; only plays with
  launcher 2.1.50 or later count). Then its entry, and the mark with it, are deleted under the 30-day rule, and if it
  plays on that PC again a new ALT CHECK is posted, worded exactly like the first.
- **A repeated lead.** Before acting on an ALT CHECK, search the staff audit channel for an earlier
  `NOT AN ALT <name> for ban B-...` line for the same name and ban. If there is one and nothing else has changed, it
  is the lapsed mark, not new evidence: mark it **Not an alt** again.
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
Every hour that counted anything, the backend logs one line of counts, without values, that starts
`[device-check] last hour:` and ends with `until <UTC minute>Z`: launch-checks with a code, unavailable or none,
malformed codes, session changes, codes dropped by the limits, flags by kind, not-an-alt marks, and raw hwids discarded
on the old routes. The counts are in memory only and start again after each line, so a restart loses at most the hour
since the last line. An hour with nothing counted prints nothing.

## Retention and erasure

- A code is deleted 30 days after the PC was last used to play (hourly prune, and once at start-up).
- A banned account's codes are kept while its bans.json entry exists; after an unban the 30-day rule applies.
- An account entry with no codes is deleted 30 days after its last day, unless the account is banned.
- Flags last 30 days. A Not an alt mark lasts until its ban is lifted, or until the marked account has not played
  for 30 days: then the account entry, and the mark with it, are deleted under the 30-day rule above, and a new ALT
  CHECK can be posted if the account plays on that PC again (see Reading a lead: search the audit channel for the
  earlier `NOT AN ALT <name> for ban B-...` line before acting on it). Session bindings are in memory only.
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
- Changing the key makes every stored code meaningless: use the full erase (Rollout, Undo), then set the new key.
  The full erase deletes `data/device-ids.json` and its `.tmp` files outright. That is a privacy erase and a
  deliberate exception to ops README rule 9 ("Never delete: archive"): never `ops archive` them or move them aside.
  The archive is kept until the owner prunes it, so archived codes would outlive the 30-day and erase promises in
  privacy.md. Jake's OK for this exception is asked together with his go for the deploy (step 1).

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

Who does what: claude-jake deploys and restarts the backend after Jake's go, and settles the backup tool; root on
CT 115 sets the key; the launcher lane releases the launcher; claude-jake watches the counts; Jake decides on enforce.
Commands below run as root; from the `nate` user, prefix them with `sudo` (step 3 says how for its redirect).

**Ledger, on every step that changes something** (CLAUDE.md rule 1, `ops readme`): `ops claim <resource> <you>
"<why>" <minutes>` before, `ops log <you> "<what changed>" "<how to undo it>"` after, then `ops release <resource>
<you>`. Back up a live file before editing it: `cp -a <file> <file>.bak-$(date +%Y%m%d-%H%M%S)`. Each step below gives
its own lines; `<you>` is your ledger operator name.

**Env override check**, before step 3 and before any undo that edits `backend.env`:

- `grep -c '^[[:space:]]*DEVICE_' /etc/dragonbreak/console.env` must print `0` (15 Oct: 0). That file is read after
  `backend.env` (the `console.conf` drop-in), so a `DEVICE_` line there would override `backend.env`.
- `/opt/alduinak/skymp5-backend/.env` must not exist (15 Oct: it does not). `config.js` loads it with dotenv for
  anything the two files leave unset, so a key there would survive the full erase.

1. **Deploy the backend with `DEVICE_ID_HMAC_KEY` unset**, with Phase 1 or after it. Who: claude-jake, after Jake's go.
   Ask for that go together with his OK for the full erase's exception to ops README rule 9 (Undo, Full erase).
   - Ledger first: `ops claim backend claude-jake "L3-01 backend deploy and restart" 60`. When the deploy goes through
     a push to main, also `ops claim github-main claude-jake "L3-01 deploy push to main" 30` and follow ops README
     rule 6: the updater resets `/opt/alduinak` to `origin/main` and restarts the game server, never the backend.
   - **Before that start**, the disk gate: at least 1 GB free on `/`, or stop. Check with `df -h /`, or
     `[ "$(df --output=avail -k / | tail -n 1)" -ge 1048576 ] && echo ok || echo STOP`. On 15 Oct `/` reached 0 MB
     free, `dbo-disk-check.service` failed and `dbo-monitor.service` logged "no space" errors. The first start rewrites
     `data/bans.json`, and the running backend writes players.json and sessions.json all the time.
   - **Before that start**, copy the ban list aside, keeping its 0600 mode, into a root-only folder (never `/tmp`):
     `install -d -m 700 /root/ban-list-backups && cp -p /opt/alduinak/skymp5-backend/data/bans.json /root/ban-list-backups/bans.json.before-L3-01`
   - If the deploy is on a day other than 2026-10-15: set that day in `data/legal/legal.json` (`version` and
     `effective`) and in `data/legal/privacy.md` (Effective date and Last updated), drop the unshipped `2026-10-15` key
     from `data/legal/hashes.json`, run `npm run legal-record` again, and commit that before deploying.
   - **Deploy tree:** the backend release tree, built on the live main head at deploy time (`git -C /opt/alduinak
     rev-parse HEAD`, the same as `origin/main`; on 15 Oct 18:44Z that is f985e98fe, which serves launcher 2.1.49 and
     client 0.3.98) from cherry-picks, never `git merge`. Phase 1 (`secfix-phase1-backend-1015`) and, once F1 is
     approved, F1 (`secfix2-F1-backend-1015`) go in as cherry-picks, as in `backend-release-1015-trial`. Then add this
     branch's own commits, and only those (1314e05ca is the Phase 1 head this branch is built on):

     ```
     git cherry-pick -x 1314e05ca..secfix3-L3-01-backend-1015
     git log --reverse --format='%h %s' -n "$(git rev-list --count 1314e05ca..secfix3-L3-01-backend-1015)" HEAD
     ```

     Never `git merge` this branch into a tree that already holds Phase 1 or F1 as cherry-picks: the tree has copies
     of Phase 1, not the commits this branch is built on, so a merge conflicts (15 Oct, onto backend-release-1015-trial:
     `routes/site-auth.js`, `sources/discord/bot.js` and `test/discordBanAudit.test.js`), while the cherry-pick range
     applies cleanly. `-x` adds `(cherry picked from commit <sha>)` to each message, which is how Undo finds them
     again. The `git log` line lists the L3-01 commits on the tree: note the first and the last sha for the ledger.
     Then, on the result, rerun the version.js gate below and the backend suite (`npm test` in `skymp5-backend`; a
     test that fails on a load timeout is rerun alone). Never deploy one of the branch heads on its own: Phase 1, F1
     and this branch all carry `routes/version.js` from c90ee09fd, which advertises launcher 2.1.48, its download link
     and client 0.3.97.
   - Before the tree reaches the live checkout, this must print `same`:
     `git diff --quiet <live head> <deploy tree> -- skymp5-backend/routes/version.js && echo same || echo STOP`.
     version.js is read from disk on every request, so a wrong one reaches every launcher as soon as it lands.
   - Restart: `systemctl restart dragonbreak-backend.service`. Then
     `grep -F '[device-check]' /var/log/dragonbreak-backend.log | tail -n 2` shows the check is off:
     `DEVICE_ID_HMAC_KEY is not set: the device check is off and nothing is stored`.
   - The first start rewrites `data/bans.json` once, even with the key unset: the start-up prune reads the ban list,
     which gives every entry without one a `B-` ref and saves it (15 Oct: 1 entry, none with a ref). The save is
     atomic and keeps the file 0600.
   - The policy bump asks every player to accept the updated Privacy Policy once in the launcher.
   - Ledger after: `ops log claude-jake "L3-01 backend live: main <first>..<last>, cherry-picks of
     1314e05ca..secfix3-L3-01-backend-1015, device check off (no key)" "Undo, Code: full erase first if the key was
     set; claim backend and github-main, rule 6 online check, git revert --no-edit <first>^..<last> on main, push,
     systemctl restart dragonbreak-backend.service. DEVICE_MATCH=off pauses the device check alone, no push"`, then
     `ops release backend claude-jake` (and `ops release github-main claude-jake`).
   - Rolling back to the old code is safe: it ignores the refs. A re-ban made under the old code gets a new ref when
     the new code next reads the list, and a Not an alt mark on the old ref then lapses.
2. **Keep the store out of backups**, before the key is set. Who: claude-jake, the backup tool's owner (per its
   README). Add `device-ids\.json` to `DENY` in `/opt/dragonbreak-tools/backups/dbo_backup.py`, so `verify` refuses it
   in any archive, or at least to `BACKEND_KNOWN_OUT`. The reason: it has its own 30-day retention class (privacy.md
   section 5) and is never archived. Go on to step 3 only once that is in.
   - Ledger: no ledger resource covers `/opt/dragonbreak-tools` (`ops claim` accepts only its fixed list), so there is
     no claim. Back the file up, edit it, then `ops log claude-jake "dbo_backup.py: device-ids.json added to DENY"
     "restore dbo_backup.py.bak-<stamp>"`.
3. **Set the key**, in a restart window. Who: root on CT 115.
   - Ledger first: `ops claim backend <you> "L3-01: add DEVICE_ID_HMAC_KEY, restart backend" 30`.
   - The env override check (above), then back up `backend.env` (it holds no key yet):
     `cp -a /opt/dragonbreak/backend.env /opt/dragonbreak/backend.env.bak-$(date +%Y%m%d-%H%M%S)`
   - Add the key without printing it. It must be added once only: a second run would silently rotate the key (the
     last assignment in the EnvironmentFile wins) while the store stays, which must never happen. As root:

   ```
   grep -q '^DEVICE_ID_HMAC_KEY=' /opt/dragonbreak/backend.env || { umask 077; printf '\nDEVICE_ID_HMAC_KEY=%s\n' "$(openssl rand -hex 32)" >> /opt/dragonbreak/backend.env; }
   grep -c '^DEVICE_ID_HMAC_KEY=' /opt/dragonbreak/backend.env
   ```

   From the `nate` user the whole first line goes in `sudo sh -c`, because a `>>` after `sudo` runs as `nate` and fails:

   ```
   sudo sh -c 'grep -q "^DEVICE_ID_HMAC_KEY=" /opt/dragonbreak/backend.env || { umask 077; printf "\nDEVICE_ID_HMAC_KEY=%s\n" "$(openssl rand -hex 32)" >> /opt/dragonbreak/backend.env; }'
   sudo grep -c '^DEVICE_ID_HMAC_KEY=' /opt/dragonbreak/backend.env
   ```

   - The count must print `1` (a count, never the value); anything else, do not restart. Before the restart, the disk
     gate again (step 1): at least 1 GB free on `/`, or stop. Then `systemctl restart dragonbreak-backend.service`.
     The log says `on, report only`.
   - If it says `is not set`, the file already held an empty `DEVICE_ID_HMAC_KEY=` line, so the guarded add did
     nothing. Delete that line with `sed -i '/^DEVICE_ID_HMAC_KEY=$/d' /opt/dragonbreak/backend.env`, run the guarded
     add and the count again, then restart. That never puts the key in a process argument list (`printf` is a shell
     builtin, and `sed` deletes by pattern). Never add a second line.
   - If it says `is not 64 or more hex characters`, an older value is in the file: stop, never print it, and ask Jake.
   - Ledger after: `ops log <you> "DEVICE_ID_HMAC_KEY added to backend.env (value not logged), backend restarted:
     device check on, report only" "pause, or the full erase (see Undo)"`, then `ops release backend <you>`.
4. **Release launcher 2.1.50 with the device code**, ideally together with F1's launcher half. Who: the launcher lane.
   Launcher only: no CLIENT_VERSION bump. 2.1.50 here means the first launcher release that carries this branch's
   launcher commits; if another release takes 2.1.50 first, use the next number throughout.
   1. Bump `skymp5-launcher/package.json` to 2.1.50, and its two lines in `package-lock.json`, as 122f8e8bf did for
      2.1.49.
   2. Build with the manager's **Build launcher**.
   3. Upload the installer to `files.dragonbreakonline.com/launcher/2.1.50/DragonBreakLauncher.exe`. Go on only once
      `curl -sI https://files.dragonbreakonline.com/launcher/2.1.50/DragonBreakLauncher.exe | head -n 1` says 200.
   4. Then set `LATEST_VERSION` to `'2.1.50'` and `DOWNLOAD_URL` to
      `'https://files.dragonbreakonline.com/launcher/2.1.50/DragonBreakLauncher.exe'` in `routes/version.js`, in a commit
      on the live main head that changes only those two lines, the way a6837b06c did for 2.1.49. No backend restart is
      needed: version.js is read from disk on every `GET /api/version`, so it is served as soon as the live checkout
      has it (a restart does no harm).

   - Until version.js says 2.1.50, no launcher sends a code: the self-update offers only the advertised version, so
     report mode collects nothing.
   - Ledger: no resource covers the launcher build or the file host, so the upload gets only
     `ops log <you> "launcher 2.1.50 installer uploaded" "delete launcher/2.1.50/ while version.js does not advertise it"`.
     For the version.js push, `ops claim github-main <you> "version.js: launcher 2.1.50" 30` first (the push restarts
     the game server through the updater, ops README rule 6), then `ops log <you> "version.js advertises launcher
     2.1.50" "set LATEST_VERSION and DOWNLOAD_URL back to 2.1.49 the same way"` and `ops release github-main <you>`.
   - **Undo:** set version.js back to 2.1.49 the same way. A 2.1.50 launcher works against either backend: it offers
     an update only when the advertised version is higher (`compareVersions(latest, current) > 0` in `src/main.js`),
     and launch-check before this branch reads only `filesVersion` and `plugins` from the body.
5. **Watch the counts** for at least 2 weeks. Who: claude-jake. The hourly lines (see Switches) are summed over the
   last 14 days. The log rotates weekly (`/etc/logrotate.d/dragonbreak`: weekly, rotate 8, compressed), so read the
   rotated files too; `zgrep` reads the plain and the `.gz` ones:

   ```
   zgrep -h -F '[device-check] last hour:' /var/log/dragonbreak-backend.log* | awk -v from="$(date -u -d '14 days ago' +%Y-%m-%dT%H:%M)" '$NF >= from { n++; for (i = 1; i < NF; i++) { if ($i == "code") d += $(i + 1); if ($i == "unavailable") u += $(i + 1) } } END { printf "%d hourly lines: with a device code %d, unavailable %d (%.1f%%)\n", n, d, u, (d + u) ? 100 * u / (d + u) : 0 }'
   ```

   It prints only totals. If more than 5% of the launch-checks from new launchers say unavailable (`unavailable` out of
   `with a device code` plus `unavailable`), look at a server-issued install token. Ledger: none, because reading
   changes nothing (ops README: claims are for changes).
6. **Enforce.** Who: Jake decides whether enforcement is ever built. Today `DEVICE_MATCH=enforce` only reports. Building
   it is a separate change, with its own review, claim and log (see Enforcement below).

**Undo.** Who: claude-jake, as root, after the env override check. Each one: `ops claim backend claude-jake "<why>" 15`
first, back up `backend.env` (`cp -a`, as in step 3), then `ops log claude-jake "<what changed>" "<how to undo it>"`
and `ops release backend claude-jake`.

- **Pause.** Nothing new is collected or flagged; codes already stored are kept and still deleted after 30 days.

  ```
  grep -q '^DEVICE_MATCH=' /opt/dragonbreak/backend.env && sed -i 's/^DEVICE_MATCH=.*/DEVICE_MATCH=off/' /opt/dragonbreak/backend.env || printf '\nDEVICE_MATCH=off\n' >> /opt/dragonbreak/backend.env
  systemctl restart dragonbreak-backend.service
  ```

  The log says `DEVICE_MATCH=off: no device codes are collected and nothing is flagged`. To resume, set
  `DEVICE_MATCH=report` the same way and restart.
- **Full erase.** Deletes every stored code and the key. It is also the only way to change the key: erase, then step 3.

  ```
  systemctl stop dragonbreak-backend.service; rm -f /opt/alduinak/skymp5-backend/data/device-ids.json /opt/alduinak/skymp5-backend/data/device-ids.json.*.tmp; sed -i '/^DEVICE_ID_HMAC_KEY=/d' /opt/dragonbreak/backend.env; systemctl start dragonbreak-backend.service
  ```

  This `rm` is a privacy erase and a deliberate exception to ops README rule 9 ("Never delete: archive"), which Jake
  OKs with his go for the deploy (step 1). Never `ops archive` the store or its `.tmp` files and never move them
  aside: the archive is kept until the owner prunes it, so the codes would outlive the 30-day and erase promises in
  privacy.md. The `ops log` line says so, for example `ops log claude-jake "device check full erase: device-ids.json
  and its .tmp files deleted (privacy erase, ops README rule 9 exception), key line removed" "none by design: set a
  new key (step 3); the store rebuilds as players launch"`.

  The `*.tmp` names are unfinished saves that a crash can leave behind. The log then says `is not set`. Backups of
  `backend.env` made after step 3 still hold the key. With the store gone it links nothing, but restoring one turns the
  check back on, so run the count from step 3 after any restore.
- **Code.** The release lands on main as cherry-picks (step 1), never as a merge, so the code undo is a `git revert`
  of L3-01's own commits on main, which leaves Phase 1 and F1 in place. For the device check alone the undo is the
  Pause (`DEVICE_MATCH=off`): no push and no game-server restart. The revert also takes back the bans.js address
  changes and the ban refs (the old code ignores the refs, step 1).
  1. If the key was ever set (step 3), run the full erase first: the old code never reads or prunes
     `data/device-ids.json`, so codes left on disk would be kept for ever.
  2. Find the range. The step 1 ledger line names it (`<first>..<last>`). To find it from git, using the
     `cherry picked from commit` line that `-x` wrote:

     ```
     git fetch origin main
     for c in $(git rev-list --reverse 1314e05ca..secfix3-L3-01-backend-1015); do git log -F --grep="cherry picked from commit $c" --format='%h %s' origin/main; done
     ```

     It prints the main commits oldest first. The number of lines must equal
     `git rev-list --count 1314e05ca..secfix3-L3-01-backend-1015`, and `git log --oneline <first>^..<last>` must list
     exactly those commits. If something else landed between them, revert the listed commits one at a time instead,
     newest first (`git revert --no-edit <sha>`).
  3. Ledger: `ops claim backend claude-jake "revert L3-01 on main" 30` and
     `ops claim github-main claude-jake "revert L3-01 on main" 30`. Then ops README rule 6: the push restarts the
     game server, so `curl -s https://dragonbreakonline.com/api/servers` must show `"online":0` first.
  4. On a clean checkout of `origin/main`: `git revert --no-edit <first>^..<last>` (one revert commit each, newest
     first). Before the push, the version.js gate
     (`git diff --quiet origin/main HEAD -- skymp5-backend/routes/version.js && echo same || echo STOP`) and the
     backend suite. Push, wait until `git -C /opt/alduinak rev-parse HEAD` shows the pushed sha (the updater, within
     5 minutes), then `systemctl restart dragonbreak-backend.service`.
  5. `ops log claude-jake "L3-01 reverted on main (<first>..<last>), backend restarted" "cherry-pick
     1314e05ca..secfix3-L3-01-backend-1015 again (step 1)"`, then `ops release github-main claude-jake` and
     `ops release backend claude-jake`.

  The revert puts the policy back to the version before it (2026-10-11 on 15 Oct), so a player who accepted only
  2026-10-15 is asked once to accept that one.
- **Launcher:** version.js back to 2.1.49 (step 4).
- Old launchers keep working throughout, and a new launcher works against an old backend (it ignores the field).

## Enforcement (not built)

A separate change, at the earliest after 2 weeks of report data, with F1 live and `LAUNCHER_LOGIN_LEGACY=revoke`. It would
refuse a session (never add a ban) only when the evidence came from a PC-bound session, the PC is not shared, the
account first appeared after the ban or its Discord account is younger than the threshold, there is no not-an-alt mark,
and the ban still stands; with the same generic 403 `banned`, launch-check unchanged, a breaker that pauses refusals
after 10 in an hour and alerts staff, a ticket message for the player and a one-click clear for staff. A sibling who
first plays after a ban on the same PC meets every one of these conditions, so it needs staff review either way.
