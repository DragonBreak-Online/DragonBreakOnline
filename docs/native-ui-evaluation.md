# Native UI evaluation

Asked 2026-10-16: can the DragonBreak UI be made native to Skyrim and shipped as a mod, so
DragonBreak streams only data to the local client instead of streaming the full UI?

Short answer: the data-only streaming already exists and is live. The bandwidth problem Jake
noticed was a one-path manifest routing bug, now fixed. Going native is still worth arguing
for, but on input and install size, not on streaming - and it is a months-long project.

Everything below was measured on 2026-10-16 against the live service and this PC's install,
not estimated.

## 1. The UI is already local and already data-only

The overlay loads from `file:///Data/Platform/UI/index.html` - off the player's disk
(`MyChromiumApp.cpp:153`, `BrowserApiNirnLab.cpp:176`). Nothing fetches it over the network at
play time.

At runtime only data crosses the wire. `widgetMenuUtil.ts:26` carries the comment
"Data-only re-push for an already open menu; never touches visibility or focus", and the
server's `dboWidget` / `dboHud` / `dboParty` packets are exactly the data protocol the request
describes. It is built, shipped and in production.

So "stop streaming the full UI, stream data instead" is not a change to make. It is the current
design.

## 2. What the bandwidth complaint actually was

A client update ships changed files individually. The UI is 168 files but only 20.1 MB, so a UI
change streams as one 2.11 MB `build.js` - verified HTTP 200 today at v0.3.102.

The expensive case was a fallback, not the UI. `Data/DragonBreak Hub.esp` is listed in the
*client* manifest but owned by the *extra* manifest:

| Endpoint | Result |
|---|---|
| `/api/files/client/Data/DragonBreak%20Hub.esp?v=0.3.102` | 404 |
| `/api/files/extra/Data/DragonBreak%20Hub.esp` | 200, 20,765 B |

One unroutable path made the per-file updater give up and pull the whole 169.9 MB zip. Fixed in
`856f9cc9` (`fix/per-file-404-no-full-zip`): a 404 now skips that file instead of abandoning
per-file mode. That recovers more bandwidth than any UI rearchitecture would.

## 3. Going native would reclaim 2.2 MB of UI, not 21 MB

The built UI is 21,093,080 B over 168 files. Only `build.js` (2,211,353 B, 10.5%) is code. The
other 89.5% is media a native port still has to ship:

| Kind | Files | Bytes |
|---|---|---|
| GIF (emote wheel previews) | 45 | 8,230,206 |
| PNG | 21 | 5,209,331 |
| WAV (skills menu sounds) | 6 | 2,892,692 |
| MP3 | 14 | 943,386 |
| JPG | 8 | 751,099 |
| TTF | 9 | 698,792 |
| SVG | 62 | 154,645 |
| **JS** | **1** | **2,211,353** |

Two classes get *worse* in Scaleform. GFx has no GIF decoder, so 45 animation loops become
embedded sprite sequences - typically larger than the GIF. The WAVs want `.xwm`/`.fuz`. There is
no transpiler for the 20,505 lines of TS/SCSS, and no reuse of it.

## 4. The real prize is CEF, not the UI

| Component | Files | Size | Share of 400 MB client |
|---|---|---|---|
| CEF runtime | 67 | 245.6 MB | 61.4% |
| `libnode.dll` | 1 | 104.0 MB | 26.0% |
| UI directory | 168 | 20.1 MB | 5.0% |

`libcef.dll` alone is 183 MB. The UI is most of the file *count* and almost none of the *bytes* -
which is precisely why a UI change streams cheaply today.

But `libnode.dll` does not go away: the whole `skymp5-client` TS layer runs on it. So the ceiling
on savings is ~246 MB of 400 MB, and only if CEF is removed entirely - which means porting all
36 widget types, not some.

## 5. What native would require, end to end

**The write direction already works and is in production.** `Ui.setFloat`/`setString` reach live
ActionScript members, and DragonBreak uses this today at frame rate -
`dboRelayService.ts:75` writes `_root.HUDMovieBaseInstance.{Health,Magica,Stamina}._alpha` on the
vanilla HUD, and `interactionPromptService.ts:23` writes `RolloverText._alpha`.

**The read direction does not exist.** There is no `GFxFunctionHandler`, `FxDelegate`,
`ExternalInterface` or `RegisterFunction` anywhere in `skyrim-platform`, and `Ui.invoke*` is
never called. A button press in a native menu has no way back into the game. The options are
polling AS members every frame via `Ui.getString`, or adding C++ to SkyrimPlatform - which means
redistributing `SkyrimPlatformImpl.dll` (15.8 MB).

**One menu slot, many panels.** SKSE's `UI.OpenCustomMenu` drives a single `CustomMenu` slot. The
overlay routinely stacks HUD (id 29), party (id 32), chat and a focused panel at once, each
pushed independently. One slot cannot host that; it needs either a mega-SWF multiplexing 36
widget types, or real `RE::IMenu` registration - again new C++.

**Text rendering is coupled to the browser.** `TextApi` (floating nameplates) draws through the
same Tilted D3D11 overlay and its visibility default is literally `kInheritBrowser`. Removing CEF
is wider than the 36 panels.

### Effort

- **One day** - a read-only native panel. Hand-build a small AS2 SWF, drop it in
  `Data/Interface`, open with `Ui.openCustomMenu`, push values with `Ui.setFloat`. Every API is
  confirmed present, and `Data/Interface/startmenu.swf` (a hand-authored 30-byte empty SWF that
  blanks the vanilla start menu) proves SWFs already ship through our own channel.
- **Weeks** - the input back-channel, plus solving the single-slot problem, plus one or two real
  interactive menus.
- **Months** - the other 34 widget types, re-authoring the art, and unwinding CEF from 56
  `executeJavaScript` sites, 44 focus sites and 23 `browserMessage` handlers, plus `TextApi`.

## 6. Shipping as a mod is a non-issue

A `.swf` in `Data/Interface` would ride `/api/files/extra`, which already serves 1,591 files /
1,872 MB, sha256-verified per file, with no player action and no Vortex. It needs no Nexus
collection revision.

Routing it through the collection instead would be strictly worse, and the project already
decided against that for its own files: `COLLECTION_NOTES.md` records DBO plugins and BSAs as
"launcher only (decision 2026-09-14)", because FOMOD re-installs resurrect dropped plugins and
break the client's plugin check.

## 7. The honest case for native, and a cheaper option

Native is not justified by streaming. It is justified - if at all - by four defects that are
structural consequences of a CEF window imitating a game menu:

1. the overlay cursor does not track the OS cursor,
2. `Input.isKeyPressed` goes deaf once the browser takes focus,
3. `ForegroundGuard` fights over focus,
4. no frames render while another window is in front.

A real Scaleform menu receives real game input and renders in-process, which fixes all four by
construction. That is a genuine argument - it is just a different argument, and a months-long one.

**There is a middle option already in progress.** `skymp5-front/src/skyrim-native.scss`
("Skyrim Native Design System (1:1 Vanilla & SkyUI Exact Specification)") makes the CEF UI *look*
vanilla - Septim gold `#c8a858`, Futura Condensed, the smoke-gradient panel frame. If the goal is
"the UI should feel native", that buys most of the perceived benefit at a fraction of the cost,
keeps React, keeps the localhost `widgets.set()` review loop, and keeps instant UI updates with
no mod release.

## Recommendation

Do not port the UI to Scaleform as a streaming optimisation - the premise does not hold.

1. The routing bug is fixed (`856f9cc9`); that was the actual bandwidth problem.
2. Continue `skyrim-native.scss` if the goal is native *feel*. Cheapest path by a wide margin.
3. If the cursor and hotkey defects are the real pain, spend one day on a read-only native HUD
   prototype to get hard numbers. Every API needed is already present.
4. Only if that prototype proves native input fixes those defects should a full port be
   considered - and then argued on the 246 MB of CEF and the input model, funded as a
   months-long project.

## Status of the in-game pass

Everything above is measured from code, the live endpoints and the installed files. The in-game
observation pass - watching the overlay behave while playing - was attempted on 2026-10-16 and is
still outstanding.

The launcher (v2.1.49) is up and signed in, but it gates Play behind a completed update, and the
update needs two mods this PC does not have:

| Mod | Nexus | Size |
|---|---|---|
| King of the Murkmire - Main | 190459 | 717 MB |
| Murkmire Official Housing Pack | 194072 | 145 KB |

Both are in the server's 154-entry install manifest, so the client cannot connect without them.
The Nexus account is non-Premium (`"Premium": false`), so each needs a manual "Slow download"
click; with no click the installer waited and aborted cleanly after its 15-minute idle timeout
("Timed out waiting to download"). Nothing was left half-written.

Checked and ruled out: this is *not* the Vortex-mismatch bug. Neither mod is in
`Vortex\downloads\skyrimse` (146 files, no match), the launcher's own downloads folder, or
Downloads. They genuinely are not on the machine.

What the in-game pass is still needed for - none of it affects the recommendation above, which
rests on measured sizes and code facts:

1. whether the overlay cursor visibly lags or desyncs from the OS cursor,
2. whether `Input.isKeyPressed` goes deaf once a panel takes focus,
3. how the panels behave when a second panel opens over one that already has focus,
4. whether controller input reaches the overlay at all.

Those four are the entire honest case for going native, so they are worth measuring before any
native work is funded - but they change the *justification*, not the conclusion that this is not
a streaming problem.

## How the numbers were taken

- Install sizes: `find`/`du -sb` under `C:\DragonBreak\skyrim\Data\Platform`.
- Endpoint behaviour: `HEAD` against `dragonbreakonline.com` at v0.3.102, 2026-10-16.
- Code facts: `git grep` over `origin/main` and `origin/server`.
- Scaleform format limits (no GIF/SVG/MP3 decoder in GFx) are general knowledge about
  Scaleform 3.x, not measured here.
