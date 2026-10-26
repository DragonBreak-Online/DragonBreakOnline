# DragonBreak native UI: style guide (Worker 1, 26 Oct)

Every DragonBreak Scaleform panel (`swf/<menu>/`) is drawn to this guide, so it reads as part of Skyrim and not as a web page.

**Where the numbers come from:**
- The vanilla and SkyUI menus on the player's own install, measured read-only on 26 Oct:
  - `Skyrim - Interface.bsa`: messagebox, trainingmenu, tweenmenu, sleepwaitmenu, statsmenu, quest_journal, sharedcomponents;
  - `SkyUI_SE.bsa`: inventorymenu, inventorylists, itemcard, configpanel (MCM), bottombar, messagebox.
- How they were measured: extracted to a scratch folder, then read with FFDec `-swf2xml` / `-export script`.
- Nothing from those files is copied into ours: no shapes, bitmaps, scripts or text. We take only sizes, colours, timings and sound names.
- Fonts are resolved by name from the player's own `gfxfontlib.swf`, so we ship no font data.

Each value is marked **measured** (with its source) or **DBO** (our choice, where vanilla uses bitmap art we cannot use).

## 1. Stage

- **measured:** every reference menu has a 1280 x 720 stage. SKSE's CustomMenu loads the movie with `kNoBorder` scaling (CustomMenu.cpp).
- **DBO:**
  - Lay panels out on 1280 x 720.
  - Keep everything inside a 40 px safe margin.
  - Centre a panel horizontally. Put its top edge at about a fifth of the height (y 140 for a 440 px panel).

## 2. Fonts

**Measured** in the reference menus' text fields. Text is always set through `TextFormat.font` / HTML `face`, never embedded.

| role | font | size | letter spacing | seen in |
|---|---|---|---|---|
| Panel title | `$EverywhereFont` | 30 | 1.0 | sleepwaitmenu ("Rest how long?"), sharedcomponents |
| Big header, item name | `$EverywhereBoldFont` | 30 | 0 | SkyUI itemcard (53 fields) |
| Section header | `$EverywhereBoldFont` | 20-24 | 0-0.8 | statsmenu, quest_journal, tweenmenu |
| Spaced caps title (TWEEN style) | `$EverywhereFont` | 26 | **6.5** | tweenmenu |
| List row | `$EverywhereMediumFont` | 22-26 | 0.8 | messagebox 22, trainingmenu 26 |
| List row, journal style | `$EverywhereFont` | 22 | 1.0 | quest_journal topics |
| Body text | `$EverywhereMediumFont` | 20-22 | 0.8 | messagebox body 22, configpanel 20 |
| Secondary / label | `$EverywhereMediumFont` | 16-20 | 0.8 | `#999999`, bottombar labels 16, itemcard 16-20 |
| Key hint value | `$EverywhereBoldFont` | 20 | 0 | bottombar (16 fields) |
| Small print | `$EverywhereMediumFont` | 12-14 | 0.8 | inventorylists |

The rule that follows from it:
- **Medium is the workhorse** at 0.8 letter spacing.
- **Bold** marks headers and values.
- Plain **Everywhere** is for titles and the journal's lists.
- Never more than three sizes in one panel.

The other names `gfxfontlib.swf` exports are `$DragonFont`, `$SkyrimBooks`, `$HandwrittenFont` and `$DaedricFont`. They are for flavour lines only, like a deity's name or a note, and never for a control.

## 3. Colour

**Measured.** Skyrim's UI is white on black, with grey and alpha doing all the work. No vanilla menu tints its text.

| use | value | source |
|---|---|---|
| Text | `#FFFFFF` | everywhere |
| Secondary text | `#999999` | statsmenu, trainingmenu, bottombar, itemcard |
| Tiers of emphasis | `#DDDDDD`, `#CCCCCC`, `#AAAAAA`, `#666666` | quest_journal |
| Disabled text | `#606060` (vanilla) / `#505050` (SkyUI) | BSScrollingList.SetEntryText, ButtonListEntry |
| Shapes | `#000000`, `#BBBDBF`, `#A6A8AB` | trainingmenu, tweenmenu fills |

**DBO:**
- The panel background is `#000000` at 80 % alpha. Vanilla backgrounds are bitmaps we cannot reuse, so this flat dark stands in.
- Separators are 1 px `#FFFFFF` at 25 %.
- Colour is used only for meaning:
  - `#C9A86A` for a daedric prayer's accent;
  - `#B23A3A` for a failure line;
  - `#8FBF7F` for a success line.
  - Each is used on one line of text, never on a whole row.

## 4. The selection highlight: brightness, not a bar

**Measured:** this is the most Skyrim-like thing in the guide, and the one a web page gets wrong.

- **Vanilla lists:** an entry's text is white at **alpha 76 (30 %)** in its `Normal` frame and **alpha 255** in its `Selected` frame. The selector shape sits at alpha 0 in Normal (quest_journal entry sprite 514: text 512 at a76, text 513 at a255).
- **Vanilla buttons** (messagebox): white at **alpha 204 (80 %)** at rest, full on focus.
- **SkyUI options:** `ALPHA_SELECTED 100`, `ALPHA_ACTIVE 75`, `ALPHA_DISABLED 50` (configpanel OptionsListEntry).

**DBO rule:**
- Rows rest at 30 % (lists) or 80 % (a few big buttons), and the focused row goes to 100 %.
- Disabled rows sit at 50 % in `#606060`.
- No filled bar and no colour change. At most a 1 px underline at 25 % on the focused row.

## 5. List rows, headers, separators

- **measured:**
  - Single-line row fields are 27-29 px tall for 20 px text (sleepwaitmenu, trainingmenu, bottombar: 150 x 29).
  - The messagebox button field is 55 px tall for 22 px text.
- **DBO:**
  - A list row is **34 px** for a 22-26 px font: text inset 10 px, 4 px between rows.
  - The header sits 16 px from the top, with a separator 8 px below it.
  - Rows are left-aligned. Only messagebox-style buttons are centred.
  - A number key hint (`1`, `2`, `3`) goes left of the row in `$EverywhereBoldFont` 20 at `#999999`.
- **DBO:** at most 9 rows on screen. Longer lists scroll by a page (PAGE_UP/PAGE_DOWN) and by the wheel, as BSScrollingList does.

## 6. Motion

**Measured** from the timeline labels and tween calls:

| what | duration | source |
|---|---|---|
| Menu fade in | 0.27-0.33 s | quest_journal `fadeIn` 8-10 frames at 30 fps |
| Menu fade out | 0.30 s | quest_journal `fadeOut` 9 frames |
| Sub-panel in/out | 0.15-0.17 s | SkyUI configpanel 9-10 frames at 60 fps |
| List item fade | 0.07-0.08 s | SkyUI inventorymenu 4-5 frames at 60 fps |
| Tween/blade expand | 0.30 s | tweenmenu `startExpand` / `endExpand` |
| Alpha tween | 0.4 s linear | `mx.transitions.Tween(..., "_alpha", None.easeNone, 0, 100, 0.4)` |
| Content dim | 0.5 s linear, 100 to 75 | SkyUI contentHolder |

**DBO:**
- Fade a panel in over **0.3 s** and out over **0.3 s**, linear on `_alpha`.
- Fade a row's focus change in **0.08 s**.
- No slides, bounces or easing curves on a panel.
- A panel fully works during its fade-in; input is never blocked by an animation.

## 7. Sound

**Measured:** sound names and use counts from `GameDelegate.call("PlaySound", [...])` across the reference scripts.

| sound | uses | when |
|---|---|---|
| `UIMenuFocus` | 34 | the focused row changes (mouse over or arrow key) |
| `UIMenuOK` | 33 | a row is chosen |
| `UIMenuCancel` | 27 | back, close, Escape |
| `UIMenuPrevNext` | 6 | tab or page change |
| `UIMenuBladeOpenSD` / `UIMenuBladeCloseSD` | 6 / 4 | a sub-panel opens or closes |

**How our menu plays them:**
- SKSE's `CustomMenu::Accept` registers a `PlaySound` callback (CustomMenu.cpp:58).
- `GameDelegate.call` is `ExternalInterface.call(name, uid, ...args)` (gfx/io/GameDelegate.as), so ours calls `flash.external.ExternalInterface.call("PlaySound", 0, "UIMenuOK")`. We use no Bethesda class.
- **Unverified in game**, so `swf/lib/dbo.as` wraps it and the prayer panel is the probe.

**DBO:** focus plays only when the row actually changes, never on every mouse move.

## 8. Navigation

**Measured:**
- Codes used: `gfx.ui.NavigationCode` UP/DOWN 60, LEFT/RIGHT 68, ENTER 58, TAB 41, PAGE_UP/PAGE_DOWN 28, HOME/END 24, ESCAPE 18, GAMEPAD_A/B/X/Y, GAMEPAD_L/R 48-50, BACK 14.
- BSScrollingList behaviour:
  - UP/DOWN moves the selection;
  - ENTER chooses it;
  - the wheel scrolls;
  - mouse-over selects a row and a click chooses it;
  - nothing happens while `bDisableInput` is set.

**DBO, for every panel:**
- UP/DOWN (and W/S) move the focus. ENTER/E choose. Escape closes (or backs out one layer). Tab does nothing: it is Skyrim's menu key, and a reflex press must never cost the player a round or a panel.
- Number keys take the numpad too (codes 97-105 as 49-57).
- Number keys 1-9 choose a row directly.
- The mouse always works: hover focuses, click chooses.
- On a gamepad: the D-pad, A to choose, B to close.

**Unverified:** whether a CustomMenu movie receives key events at all. Worker 4's test menu was mouse-only. Until it is proven:
- every panel must be fully usable with the mouse alone;
- every panel must have a visible **Close** row, because the menu is modal.

## 9. Live world

Skyrim Souls RE unpauses CustomMenu on our pack, with movement allowed and auto-close at 400 units (Worker 4's spike, section 1b). So:
- a panel never assumes the world stopped;
- the server's re-send with the same nonce updates it in place;
- a close from the client side, which may come from Souls RE, is never treated as an error.

## 10. What a panel never does

- No Bethesda or mod shapes, bitmaps, scripts or class files, even "just the list component". We write our own.
- No embedded fonts.
- No text input. Chat stays CEF.
- No rules in the SWF: the server decides, as with the CEF widgets.
