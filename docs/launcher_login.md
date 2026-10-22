# Launcher and in-game Discord login

Fix F1 of the 15 Oct 2026 security audit. A Discord login's result now reaches only the launcher or game that
started it. The code is in `skymp5-backend/routes/skymp-compat.js` and `skymp5-backend/sources/launcherLogins.js`,
the launcher's half in `skymp5-launcher/src/discordLogin.js`, the game's half in
`skymp5-client/src/services/services/discordDeviceLogin.ts`.

## The three logins

| Who | How the result is tied to the device | What the player sees |
|---|---|---|
| Launcher with this change | The launcher listens on `127.0.0.1` on a random port and sends a PKCE challenge to `POST /api/users/login-discord/start`. After Discord, the backend sends the browser to `http://127.0.0.1:<port>/discord/callback` with a one-time code (30 s). Only the launcher holding the PKCE verifier can trade that code for a session (`POST /api/users/login-discord/token`), once. | Discord's Authorize page, then "Signed in as ..." in the tab. |
| Game (in-game sign-in, off until `GAME_LOGIN_DEVICE=on`) | `POST /start` with `client: game` returns a state, a secret device code and a short code like `BCDF-GHJK`. The game shows the short code. After Discord, our page asks for it; only the game's device code collects the result (`POST /api/users/login-discord/poll`), once. The device code is never in a URL. | The code in game, Discord's Authorize page, then our page asking for the code. |
| Launchers up to 2.1.49 (old flow) | The launcher makes its own state and polls `GET /status`. While `LAUNCHER_LOGIN_LEGACY=allow` this still works, but the result is released only after the player presses Continue on our own page. Continue wakes only after the tab has been in front (visible and focused) for a second with no presses on it, and, for the mouse, once the pointer has been on the page for half a second; a held key or a held button never counts. So a window swapped or uncovered under a double-click or a burst of clicks (double-clickjacking) cannot press it. While Continue sleeps, a Tab stays on the page, so a quick Tab and Enter cannot reach the address bar, where Enter would load the callback again and hold an old launcher for up to 5 minutes. Not covered: a player typing, or tapping a touch screen, blind into the page while a window that stays on top without taking focus hides it. If the page's script cannot run, Continue works as a plain button. | Discord's Authorize page, then "Finish signing in" with a Continue button and a warning. |

In every login:

- the backend issues the state; `/login-discord` refuses a state it did not issue (an old launcher's own 64-hex state
  only while the old flow is allowed, registered once, never extended, 5 minutes);
- our own links ask Discord with `prompt=consent`, so the Authorize page shows. A link made straight to Discord can
  leave that out, so no protection depends on it: the binding to the device (loopback), the code page (game) and the
  Continue page (old flow) do that;
- a state is taken by one Discord callback only, and the result is delivered once; a cancel on Discord, or a
  failure talking to Discord, is sent back to the launcher's listener too, so it stops waiting at once;
- the session is made only when the device collects the result, so no session token is ever kept in
  `data/auth-states.json` (0600). It holds no state, code, nonce or device code in the clear, only their hashes, plus the
  Discord id and name of a login that is past Discord and not yet collected (minutes). The pre-F1 file is overwritten
  when the backend starts;
- a new login ends the account's older sessions (`LAUNCHER_LOGIN_SINGLE_SESSION`), so a copied token stops working
  the next time its owner logs in;
- the login pages are `no-store`, cannot be framed, send no referrer, and send `Cross-Origin-Opener-Policy: same-origin`:
  the page that opened the login window loses its handle on it, and a sandboxed popup, which runs no script, cannot
  load them at all.

A player can end their own sessions: the launcher's Log out (the X next to the name) ends that launcher's session on
the server, and Troubleshooting > Sign Out Everywhere ends every session of the Discord account
(`POST /api/users/login-discord/logout`, body `{ "everywhere": true }`). It sits under `/api/users/login-discord`
because that is the prefix the public proxy forwards.

## Switches (backend env, read at start)

| Variable | Default | Values |
|---|---|---|
| `LAUNCHER_LOGIN_LEGACY` | `allow` | `allow` keeps the old flow working. `off` refuses new old-flow logins: the browser page says to update the launcher, and the old launcher stops after about 20 s with HTTP 426. Sessions it already made keep working. `revoke` is `off` plus: sessions the old flow made, and every session from before this change, are refused (not deleted) until the switch goes back. Any other value counts as `allow`. |
| `GAME_LOGIN_DEVICE` | off | `on` offers the in-game sign-in (the device code). The game has had no sign-in button since June, so nothing uses it today, and while it is off nobody can be talked into typing a code on its page. Turn it on in the release that brings the button back. |
| `LAUNCHER_LOGIN_SINGLE_SESSION` | on | `false` keeps older sessions when the same account logs in again. |
| `MASTER_SESSION_CHECK_TOKEN` | `optional` | `required`: the game server's session check (`GET /api/servers/:key/sessions/:session` and `/balance`) must carry `X-Auth-Token`. `optional` also takes a check without it and logs an hourly count. A wrong token is refused in both. |

## Rollout, in this order

1. **Backend.** Deploy and restart the backend. Nothing changes for players yet, except that old launchers show the
   Continue page after Discord. Check: an old launcher still logs in, and `data/login-flows.json` appears with a
   `legacy` count.
   - Before the restart, check that the public proxy passes POSTs under `/api/users/login-discord/` on. From
     outside, `curl -si -X POST https://dragonbreakonline.com/api/users/login-discord/confirm` must get the
     backend's own answer (today Express's `Cannot POST /api/users/login-discord/confirm`), not an nginx 404 or 405.
     The old launchers' Continue button and the new launcher's `/start`, `/token` and `/logout` are all POSTs under
     that prefix. If nginx answers, have the whole prefix forwarded first, or every old-launcher login stops at
     Continue.
   - Before the restart, and again after any change to CT 107's nginx headers or Cloudflare rules while the old flow
     is allowed, check the login pages' Content-Security-Policy from outside:
     `curl -s -o /dev/null -D - "https://dragonbreakonline.com/api/users/login-discord?state=$(openssl rand -hex 32)"`
     (a throwaway login that expires on its own). The answer is a 302, and nginx `add_header` covers a 302 even
     without `always`. After the restart it must show exactly one `Content-Security-Policy`, the backend's own
     (`frame-ancestors 'none'; form-action 'self'; base-uri 'none'; script-src 'sha256-fZ0t…' 'sha256-Lp1J…'`, the
     hashes of the autoClose and Continue scripts, pinned in `test/launcherLoginRoutes.test.js`); before it, the live
     backend sends the same policy without `script-src`, so any other policy seen comes from nginx or Cloudflare. A
     second policy with `script-src` or `default-src` blocks the Continue page's script: Continue then works as a
     plain button and its guard is silently off. Then check again that an old launcher still logs in.
   - Tokens taken before the fix stay valid until their owner logs in again or `revoke` is set. Staff accounts can be
     cleared at once after the deploy with `DELETE /api/servers/:key/sessions-by-discord/:discordId`
     (`X-Auth-Token`); each of them then presses Discord Login once.
2. **Game server (fork).** The build that sends `X-Auth-Token` on session and balance checks. After its restart the
   backend's hourly line `session check(s) without X-Auth-Token` stops appearing in
   `/var/log/dragonbreak-backend.log`.
   - Before the restart, `grep -c 'checkConnectionAllowed: HTTP 403' /var/log/skymp-server.log` must be 0. That
     warning means the game server's `masterApiAuthToken` is not the backend's; the old build lets that pass (the ban
     check fails open), but the new build's session check would then be refused for every player.
3. **Launcher.** Release the launcher with this change and announce it in `/api/version`. Old launchers keep logging
   in with the old flow. The new launcher falls back to the old flow only when the backend has no `/start` (a
   backend rollback), so rolling the backend back never locks new launchers out.
4. **Client.** Any later client release. The in-game sign-in has had no button since June ("Removed in-game sign
   in"), so no player depends on it; with the old flow off, an old client's in-game sign-in is refused.
   `GAME_LOGIN_DEVICE` stays off until a client brings the button back.
5. **Switches.**
   - `MASTER_SESSION_CHECK_TOKEN=required` once the log has shown no check without the token for 24 hours after the
     fork restart.
   - `LAUNCHER_LOGIN_LEGACY=off` when `data/login-flows.json` shows `legacy: 0` for 3 days in a row, with `loopback`
     above 0 on each of those days, and not before 7 days after the new launcher went live. The launcher's Play
     button installs a waiting update, so old launchers fade out as players press Play.
   - After `off`, and again after `revoke`, read `legacyRefused` each day. Above 0 on two days in a row means players
     whose launcher cannot update itself (a failed self-update) are stuck on the old flow: switch one step back
     (`revoke` to `off`, or `off` to `allow`) and have staff help them install the new launcher by hand.
   - `LAUNCHER_LOGIN_LEGACY=revoke` together with `off`, or right after, in a quiet hour. It ends every login made
     before this change, including any token taken before the fix. Those players press Discord Login once in the new
     launcher. To count them first (a count only):
     `jq '[.[] | .[1] | select(.flow == null or .flow == "legacy")] | length' data/sessions.json`.

## Measuring

`data/login-flows.json` (counts only, no names), per UTC day: `loopback`, `device` and `legacy` are delivered logins
by flow; `legacyRefused` counts old-flow attempts refused while the switch is off. The backend log has one line per
login: `[launcher-login] <flow> login delivered for profile <id>`.

## Undo

Every switch goes back with a backend restart. `revoke` back to `allow` restores the refused sessions that have not
expired (24 hours after their last use). A backend rollback: new launchers use the old flow, and the game's in-game
sign-in says it is unavailable.
