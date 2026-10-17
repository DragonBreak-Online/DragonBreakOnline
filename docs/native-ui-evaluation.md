# Native UI evaluation

Asked 2026-10-16: can the DragonBreak UI be made native to Skyrim and shipped as a mod, so
DragonBreak streams only data to the local client instead of streaming the full UI?

**Answer: don't port — but almost none of the original reasons were right.**

A first pass concluded "do not port" and got the central technical claim backwards. A second,
adversarial pass overturned it. The recommendation survives; the argument behind it does not.
This document is the corrected version. The short form:

- The data-only streaming you asked for **already exists** and is live. That part was right.
- A Scaleform-to-game back-channel **does exist**, works today, needs no new C++ and no DLL
  redistribution. The first pass said it didn't. That was wrong, and it was the load-bearing claim.
- The four CEF defects that were the fallback case for porting are **none of them structural**.
  Total fix surface is roughly five lines plus a handful of small changes, in code we already own.
- A port would reclaim ~2.2 MB of code, while ~2.42 MB of **dead assets ship to players today**
  and can be deleted outright. The size case is negative.

So the port got *easier* and *less worthwhile* at the same time.

Everything below is measured against the live service and this PC's install, with file:line
citations. Where something is inferred rather than observed, it says so.

## 1. The UI is already local and already data-only

The overlay loads from `file:///Data/Platform/UI/index.html` - off the player's disk
(`MyChromiumApp.cpp:153`, `BrowserApiNirnLab.cpp:176`). Nothing fetches it over the network at
play time.

At runtime only data crosses. `widgetMenuUtil.ts:26` carries the comment "Data-only re-push for an
already open menu; never touches visibility or focus", and the server's `dboWidget`/`dboHud`/
`dboParty` packets are exactly the data protocol the request describes.

**"Stream data instead of the full UI" is not a change to make. It is the current design.**

## 2. What the bandwidth complaint actually was

A client update ships changed files individually, so a UI change streams as one ~2.2 MB `build.js`.

The expensive case was a fallback. `Data/DragonBreak Hub.esp` is listed in the *client* manifest but
owned by the *extra* manifest:

| Endpoint | Result |
|---|---|
| `/api/files/client/Data/DragonBreak%20Hub.esp?v=0.3.102` | 404 |
| `/api/files/extra/Data/DragonBreak%20Hub.esp` | 200, 20,765 B |

One unroutable path made the per-file updater abandon per-file mode and pull the whole 169.9 MB zip.
Fixed in `856f9cc9`. That single bug was the entire bandwidth problem.

## 3. The back-channel exists — correcting the main error

The first pass claimed: *"The read direction does not exist. There is no `GFxFunctionHandler`,
`FxDelegate`, `ExternalInterface` or `RegisterFunction` anywhere in `skyrim-platform` ... a button
press in a native menu has no way back into the game."*

**That conclusion is wrong.** The greps behind it were accurate; the inference from them was not,
because it searched the wrong binary. SKSE performs the Scaleform-side registration process-wide,
so `skyrim-platform` never needed its own.

### The route

```
AS2:  _global.skse.SendModEvent(name, strArg, numArg)
  ->  SKSE fires SKSE::ModCallbackEvent
  ->  SkyrimPlatform's existing sink
  ->  JS: on('modEvent', e => ...)   // {sender, eventName, strArg, numArg}
```

Every hop verified:

| Hop | Evidence |
|---|---|
| SKSE registers the handler | `skse64_1_6_1170.dll` contains RTTI `.?AVSKSEScaleform_SendModEvent@@`, beside `.?AVGFxFunctionHandler@@`, `.?AVFxDelegateHandler@@`, `_global`, `Hooks_Scaleform.cpp` |
| One ModCallbackEvent bus | Same DLL: `BSTEventSink<SKSEModCallbackEvent>`, `ModCallbackEventHandler`, `ModCallbackEventFunctor` — one sink, one handler, one functor |
| SkyrimPlatform sinks it | `EventHandler.h:77` declares `public RE::BSTEventSink<SKSE::ModCallbackEvent>`; `:617-637` registers `events = {"modEvent"}`; `EventHandler.cpp:1817-1847` packs the fields and calls `SendEvent("modEvent", obj)` |
| Exposed to JS | `skyrimPlatform.ts:414-419` (`interface ModEvent`), `:775-776` (`on('modEvent')`) |
| **In the shipped build** | `SkyrimPlatformImpl.dll` (15,810,560 B) contains `modEvent`; shipped typings at `Data/Platform/Modules/skyrimPlatform.ts` declare it identically |

### The precedent, in this install

SkyUI ships the complete loop inside `SkyUI_SE.bsa`:

- At offset 747933, inside an **uncompressed AS2 SWF** (header `FWS` at 747496), the constant pool
  holds `SendModEvent` alongside pure AS2 markers (`_global`, `MovieClip`, `prototype`, `onLoad`,
  `Stage`, `globalToLocal`, `_root`, `_alpha`) and the source string
  `"WidgetLoader.as: setRootPath(a_path = "`. Zero Papyrus markers — this is ActionScript.
- `SKIWF_widgetLoaded` and `SKIWF_widgetError` each appear **twice**: at 748175/748121 in that AS2
  SWF next to `SendModEvent`, and at 383323/383343 in a Papyrus `.pex` region next to
  `RegisterForModEvent`.

Both ends of the loop, in one shipping mod, on the same bus SkyrimPlatform is sinked to.

### Consequences

- **The "redistribute `SkyrimPlatformImpl.dll` (15.8 MB)" cost is void.** The relay is already in
  the deployed DLL.
- The `Ui` API the first pass called missing is also present and declared
  (`skyrimPlatform.ts:3336-3359`): `invoke*`/`invoke*A`, `get*`/`set*`, `openCustomMenu`,
  `closeCustomMenu`, `isMenuOpen`. `CallNative` resolves by name against the live Papyrus VM
  (`VmProvider.cpp` `FindType`/`FindFunction`), and `Ui.setFloat` already works in production
  (`dboRelayService.ts:75`) — so the same path works for the rest.
- Polling was never needed. A non-latent `CallNative` ends in
  `SkyrimPlatform::PushToWorkerAndWait` (`SkyrimPlatform.cpp:452-466`) — a cross-thread round trip
  with a blocking wait, per call. The push route avoids it entirely.

**One link not stepped through:** that SKSE's movie-init hook also covers its own `CustomMenu` (not
just vanilla movies like SkyUI's HUD widget) is a strong inference — `CustomMenu` is itself an
`FxDelegateHandler` in the same DLL — but was not observed live. That is a one-hour check, not an
unknown. Fallbacks if it ever failed: a 3-line Papyrus stub re-emitting via `ModEvent.psc`,
`Ui.getString` polling, or `skse.plugins.<Name>.<Func>` against the already-shipped
`MpClientPlugin.dll`.

## 4. The single-menu-slot problem was also overstated

The first pass said one `CustomMenu` slot cannot host the stacked overlay, needing new C++.

Two installed, enabled mods already do this (`modlist.txt:83`, `:103`):

- **TrueHUD** registers its own `RE::IMenu` (`Scaleform::TrueHUDMenu::Register`) and hosts unlimited
  concurrent panels inside it from a 4,774-byte host SWF plus runtime-loaded children, exposing
  `RegisterNewWidgetType`/`LoadCustomWidgets`/`AddCustomWidget` — which **TrueDirectionalMovement**
  uses, registering no menu of its own.
- **SkyrimSoulsRE** registers `CombatAlertOverlayMenu`.

And the "stack" is less stacked than it looked: it is one `widgets` array rendered by one React tree
(`App.js:93-100`) with a single scalar `focusedId` (`dboRelayService.ts:252`) — so concurrency is N
passive panels plus **at most one** focused panel.

## 5. The four defects are not structural — this is the decisive finding

The fallback case for porting was that four CEF defects are structural and native "fixes all four by
construction." **Wrong on all four.**

| Defect | Actual root cause | Fix |
|---|---|---|
| Cursor desync | Hardcoded `1920` plus an unscaled two-element hotspot, `DX11RenderHandler.cpp:102-108` (`cursor.png` 102x102). Error is **exactly zero at 1920 wide** — which is why nobody caught it | ~5 lines; plus implement the unimplemented `CefRenderHandler::OnCursorChange` |
| Keyboard deafness | One `if` block in our own hook (`*outDataLen = 0` under `ChromeFocus`), with correct focus-independent state already in `g_pressedWas[256]` one line above (`DInputHook.cpp:830-833`) | Narrow the block, or add a getter |
| ForegroundGuard | Visible steal is a 9-line self-inflicted workaround (`main.cpp:1152-1160`). Its **root** — foreground window required for DirectInput — is a Windows/engine property **a port inherits** | Delete or re-gate path C |
| Controller | Feature gap, currently *masked*: launcher force-writes `bGamepadEnable=0` (`skyrimprefs.ini:72`). Expensive part is a navigation model over 226 `onClick` sites with one `tabIndex` in the whole app — which must be written in ActionScript too | `Game.disablePlayerControls` in `openFormMenu`; nav model either way |

On ForegroundGuard the port is **counter-evidence**: it would inherit the root cause.

Note for anyone planning to test the cursor in game: a "move toward the screen edge" test **misses
this bug**. The offset is constant across the screen and varies with *resolution* — zero at 1920,
about -8 px at 1280, +8 at 2560, +24 at 3840. Change resolution, not position. (There is no DPI
awareness anywhere — zero hits for `dpiAware`/`GetDpiForWindow`/`device_scale_factor`,
`GetScreenInfo` unimplemented — so the page is self-consistent at 1:1; only the cursor sprite is not.)

## 6. Size: the port is a net negative

Measured on this install (a rebuild landed 2026-10-16 16:49, so earlier figures are stale):

| | Files | Bytes |
|---|---|---|
| UI directory | 189 | 22,058,593 |
| of which `build.js` | 1 | 2,219,858 |

| Component | Size | Share of 400 MB client |
|---|---|---|
| CEF runtime | 245.6 MB | 61.4% |
| `libnode.dll` | 104.0 MB | 26.0% |
| UI directory | 22.1 MB | 5.5% |

`libnode.dll` stays regardless — the whole `skymp5-client` TS layer runs on it. So a *complete*
port removes at most ~246 MB of 400 MB, and only if every widget goes.

Two corrections that make the size case negative:

- **~2.42 MB is already dead weight** — more than `build.js` itself. 41-42 webpack-hashed orphans
  from earlier builds (~1.33-1.39 MB: all 8 masteryMenu JPGs, 31 SVGs that are line-ending twins of
  live ones, 2-3 PNGs), plus all 14 MP3s and `state0`/`state1.wav` (1,026,736 B) reachable only
  through `window.playSound`, which has **zero callers** on either branch. `populate-files.js`
  `copyTree` ships them to players anyway. **Deleting this beats porting.**
- **The WAV claim was backwards.** The 4 live `skillsMenu` WAVs are 44.1 kHz / 24-bit / *stereo*
  uncompressed PCM — 2,809,342 B for ~10.6 s of click blips. Any native or compressed format is a
  **10x-33x reduction**, not an increase. (Two of the six WAVs are dead anyway.)
- The GIF claim holds and is now quantified: 45 GIFs, 113x200, 3,063 frames, 0.951 bits/pixel —
  **2.35x larger** as a PNG sprite sheet, **8.4-9.2x** as BC3/BC7.

## 7. Scope is smaller than it looked

37 names mapped; **live scope is ~31 widgets — 5 trivial / 15 moderate / 10 hard / 1 blocked (chat).**

Six are form *child elements*, not dispatchable widget types (`text`, `icon`, `button`, `checkBox`,
`inputText`, `inputPass`). Six more are dead or out of the live path and should be **deleted rather
than ported**: `death` (no producer on `origin/server`), `skillsMenu` (nothing dispatches
`updateSkillMenu`), `checkBox`/`inputText`/`inputPass` (no producer anywhere), and `charCreator`.

**The heaviest "blocked" widget is already native.** Live character creation opens the vanilla
Scaleform RaceSexMenu via `mp.setRaceMenuOpen` (`gamemode.js:999`, `:2329-2330`,
`appearance.js:242`, `patrons.js:83`); `charCreatorOpen` has no producer outside a loadtest bot, and
`spawn.ts:78` documents the setting as "disabled keeps the vanilla race menu."

Only **5 of 37** are passive (`hud`, `interactPrompt`, `mailMarkers`, `text`, `icon`) — so 32 are
interactive. That is why the back-channel finding was load-bearing for the entire port, not one line
item.

What stays genuinely expensive, unchanged by any of the above: free-text entry (chat's
contenteditable with caret handling and history; housing rename; bountyBoard's 500-char composer;
faction invite), art re-authoring, AS2 having no canvas for faction's per-pixel realm map and no
dropdown/scroller primitives, the dispatcher, and `TextApi`'s `kInheritBrowser` coupling. There is
also **no SWF toolchain in the repo** — one third-party `.swf`, zero `.fla`/`.as`/swfmill/mtasc/haxe
— so every panel is hand-authored with no CI.

## 8. Shipping as a mod is a non-issue

A `.swf` in `Data/Interface` rides `/api/files/extra`, which already serves 1,591 files / 1,872 MB,
sha256-verified per file, with no player action and no Vortex. No Nexus collection revision needed —
and `COLLECTION_NOTES.md` records DBO-owned files as "launcher only (decision 2026-09-14)" precisely
to avoid collection drift. DBO already ships loose SWFs this way (`startmenu.swf`, 30 bytes;
`CombatAlertOverlayMenu.swf`, 1045 bytes).

## Recommendation

**Do not port the UI to Scaleform.** The conclusion is unchanged from the first pass; every
supporting argument is different.

The streaming case never existed. The size case is negative. The input/defect case — the only
remaining argument — dissolves under measurement into a handful of in-place fixes in code we own.
The port is now clearly *possible*; it is just not *worth it*.

Cheapest first, none of it requiring a port:

1. Fix the cursor hotspot and implement `OnCursorChange`.
2. Add `m_width`/`m_height` to the existing `InputDiag` line, so the one unmeasured cursor mechanism
   closes from a single player log with no game session.
3. Expose focus-independent key state as `browser.isRawKeyPressed`; retire the per-feature
   Escape/PTT duplication.
4. Delete or re-gate ForegroundGuard's path C.
5. Add `disablePlayerControls` to `openFormMenu`.
6. Delete the ~2.42 MB of orphaned assets and the six dead widgets; re-encode the four 24-bit stereo
   WAVs.
7. Continue `skyrim-native.scss` if the goal is native *feel*. Still the best value, and unaffected
   by any of this.

If a native prototype is still wanted, spend one day on **hud + party + interactPrompt in one SWF
with one real `modEvent` button** — that is what a day now buys — and treat it as a feel/input
experiment, not a step toward removing CEF.

## Status of the in-game pass

Still outstanding, and now largely superseded. Attempted 2026-10-16: the launcher gates Play behind
a completed update, and the update needs two mods this PC lacks (King of the Murkmire - Main,
717 MB, Nexus 190459; Murkmire Official Housing Pack, 145 KB, Nexus 194072), both required by the
live 140-entry server load order. The Main archive was downloaded and verified; the 145 KB Housing
Pack was not, and the installer aborted twice on its 15-minute idle timeout. Non-Premium Nexus needs
a manual "Slow download" click per file.

Of the four behaviours the pass was meant to measure, **three are now answered from code** (sections
5 and 6): the cursor mechanism is identified to the line, the keyboard gate is identified to the
`if` block, and controller is both absent in `skymp5-front` and masked by `bGamepadEnable=0`. What a
live session would add is confirmation, plus panel-over-panel focus behaviour — worth doing, no
longer decisive.

## How the numbers were taken

- Install sizes: `find`/`du -sb` under `C:\DragonBreak\skyrim\Data\Platform`.
- Endpoint behaviour: `HEAD` against `dragonbreakonline.com` at v0.3.102, 2026-10-16.
- Server load order: read from `/opt/alduinak/build/dist/server/server-settings.json` over SSH.
- Binary facts: `grep -a` over `skse64_1_6_1170.dll`, `SkyrimPlatformImpl.dll`, `SkyUI_SE.bsa`.
- Code facts: `git grep` over `origin/main` and `origin/server`.
- Scaleform format limits (no GIF/SVG decoder in GFx) are general knowledge about Scaleform 3.x.
