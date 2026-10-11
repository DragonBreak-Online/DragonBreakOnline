# Client 0.3.93

Source branch `client-0393-release` (fork, local, not pushed), on `client-0392-release` a02a6e8d (0.3.92). Client JS and
front only: no C++, no plugins. The courier tab and the hand-over panel show nothing until the gameplay module
`couriers.js` is live with `couriers.enabled` on; the Boneman's sword does nothing until the server part (C++
`ActionListener::OnHit` and `companionSystem.ts` `SUMMON_SIDEARMS`, `~/inbox/2026-10-11-boneman-sword/server-main`) ships
on fork `main`.

`skymp5-backend/routes/version.js` here reads `CLIENT_VERSION = '0.3.93'` (the same one-line change as 406ae551).

## What is in it

| From | What |
|---|---|
| client-couriers abce226d (9ca682e7, abce226d) | Front: a Couriers tab in the pigeon coop window (post, carry, deliver, break open, take down), the courier hand-over panel (`features/courierHandover`, widget 81), `courierHandover` in the HUD's uiCaps; the rob panel says a courier's parcel may be taken |
| emote-wheel-freeze-1011 08a683ec | Front: the emote wheel's stage has no drop-shadow (raster cost per second 623 -> 112 ms at 1080p, 2968 -> 396 ms at 4K) |
| emote-wheel-freeze-1011 30902620 | Client: `emoteWheelWatch.ts`; the wheel closes when drawn without the cursor for 1.5 s, B closes it again, `emoteNote` open/closed lines reach the log |
| scan-1011-craft-keys 36b0c98d | Client: craft reporting ignores property keys (the seated 5 s key rebuild was sent as a craft: 10,500 "Recipe not found" lines 8-11 Oct); an `invKeys` diagnostic for the first three key rebuilds of a session |
| boneman-sword client patch (inbox 2026-10-11, PC 293f3980) | Client: a Conjure Boneman copy carries an Ancient Nord Sword unworn, and `ensureWeapon` leaves it in hand. Inert until the server side ships |
| d6c15206 | Front: the F3 key settings hint says Mouse 4 and Mouse 5 are set in the launcher's settings; F3 takes keyboard keys and the middle button |
| 1674bef5, 9134df16 | Client tests: mousekeys checks the new hint; beastbody accepts `beastBody` anywhere in UI_CAPS |

Not in it: claude-jake's appearance build (`client-face-diag`). No branch of it is pushed to origin; the only copy is the
local ref `refs/claude-nate/jake-client-face-diag` 7863afdd, based on 26a4c137 (0.3.90's source), not on 0.3.92.

## Patch notes for players

- Couriers: the pigeon coop has a Couriers tab. Post a delivery job with pay, carry someone else's parcel, and deliver it
  at the destination or to the recipient in person, who chooses to take it or send it to their mailbox.
- A courier's parcel can be robbed, like any other goods.
- The emote wheel (B) no longer freezes the screen, closes itself if it is left on screen without a cursor, and B closes
  it again.
- Sitting on a chair or bench while holding a house key no longer makes the game report a failed craft every few seconds.
- The key settings in the journal (F3) now say it plainly: Mouse 4 and Mouse 5 are set in the launcher's settings; F3
  takes keyboard keys and the middle mouse button.
- (Only when the server part ships) A Conjured Boneman draws an Ancient Nord Sword up close, and its blows land.

## In-game tests needed

1. **Login:** log in, character select shows your characters, enter the world (required for every client release).
2. **Courier tab:** at a coop with `couriers.js` live, post a job (goods, destination, pay); on a second character take
   it, carry it and deliver it at the destination board; take one of your own jobs down.
3. **Hand-over prompt:** a courier delivering to the recipient in person: the recipient sees Take it / To my mailbox and
   both choices work; a drop-point hand-in completes. The server log shows the panel (widget 81) opening.
4. **Emote wheel:** B opens it, play an emote, B closes it. Open it, then release the cursor or let another panel take
   focus: the wheel closes within ~1.5 s. The log shows `emoteNote ... wheel open` / `wheel closed after N ms by X`.
   No UI freeze while hovering the ring.
5. **Key holder on a bench:** a character holding a property key sits on a bench for a minute: no new
   `Recipe not found ... resultObjectId=0xdb0e2` lines in `/var/log/skymp-server.log`; an `invKeys` diagnostic line may
   appear (up to three per session).
6. **F3 settings:** the key hint reads the new text; rebinding to a keyboard key and the middle button still works.
7. **Boneman sword (only after the server part is on `main`):** summon a Boneman near a wolf: it shoots at range, draws the
   sword up close and its blows land (companion hit lines with source `2c66f`); with the old server, it keeps the bow and
   nothing changes.

Build the client with `npm run build` (development mode) and run `check-client-bundle.js` before shipping; build the
front with its production build.
