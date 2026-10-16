# Map marker icons for the Realm map

One transparent PNG per map marker type, named by the type number from the marker's REFR TNAM (for example `2.png` for
a town, `224.png` for Beyond Skyrim's castle). They are exported from the game's own `interface/map.swf` (the one that
wins in the load order: Beyond Skyrim's), so the Realm map shows the icons the game's map shows. Territories name their
type in server `territories.json` (`icon`); a type with no file here falls back to a coloured dot.

## What is here

| File | Marker type | Place | Source |
|---|---|---|---|
| `224.png` | 224 | Castle Bruma (County Bruma's capital) | export `BS224` |
| `102.png` | 102 | Bruma | export `BS102` |
| `2.png` | 2 | Applewatch (town) | `mapMarkerArt.swf` export `Town` |
| `3.png` | 3 | Greenwood (settlement) | `mapMarkerArt.swf` export `Settlement` |
| `6.png` | 6 | Pale Pass (fort) | `mapMarkerArt.swf` export `Fort` |
| `1.png` | 1 | City (generic city: the war map's hold capitals) | `mapMarkerArt.swf` export `City00` |
| `16.png` | 16 | Imperial Camp | `mapMarkerArt.swf` export `Imperial Camp` |
| `17.png` | 17 | Stormcloak Camp | `mapMarkerArt.swf` export `Stormcloak Camp` |
| `28.png` | 28 | Orc Stronghold | `mapMarkerArt.swf` export `Orc Stonghold` |
| `35.png` | 35 | Riften castle (Mistveil Keep) | `mapMarkerArt.swf` export `RiftenCastle` |
| `36.png` | 36 | Riften, the hold capital | `mapMarkerArt.swf` export `RiftenCapital` |
| `37.png` | 37 | Windhelm castle (Palace of the Kings) | `mapMarkerArt.swf` export `WindhelmCastle` |
| `38.png` | 38 | Windhelm, the hold capital | `mapMarkerArt.swf` export `WindhelmCapital` |
| `39.png` | 39 | Whiterun castle (Dragonsreach) | `mapMarkerArt.swf` export `WhiterunCastle` |
| `40.png` | 40 | Whiterun, the hold capital | `mapMarkerArt.swf` export `WhiterunCapital` |
| `41.png` | 41 | Solitude castle (Blue Palace) | `mapMarkerArt.swf` export `SolitudeCastle` |
| `42.png` | 42 | Solitude, the hold capital | `mapMarkerArt.swf` export `SolitudeCapital` |
| `43.png` | 43 | Markarth castle (Understone Keep) | `mapMarkerArt.swf` export `MarkathCastle` |
| `44.png` | 44 | Markarth, the hold capital | `mapMarkerArt.swf` export `MarkathCapital` |
| `45.png` | 45 | Winterhold castle (College of Winterhold) | `mapMarkerArt.swf` export `WinterholdCastle` |
| `46.png` | 46 | Winterhold, the hold capital | `mapMarkerArt.swf` export `WinterholdCapital` |
| `47.png` | 47 | Morthal castle (Highmoon Hall) | `mapMarkerArt.swf` export `MorthalCastle` |
| `48.png` | 48 | Morthal, the hold capital | `mapMarkerArt.swf` export `MorthalCapital` |
| `49.png` | 49 | Falkreath castle (Jarl's Longhouse) | `mapMarkerArt.swf` export `FalkreathCastle` |
| `50.png` | 50 | Falkreath, the hold capital | `mapMarkerArt.swf` export `FalkreathCapital` |
| `51.png` | 51 | Dawnstar castle (The White Hall) | `mapMarkerArt.swf` export `DawnstarCastle` |
| `52.png` | 52 | Dawnstar, the hold capital | `mapMarkerArt.swf` export `DawnstarCapital` |

Both come from Beyond Skyrim's marker art in `MapMarkers/Resources/bsresources01.swf` (the map marker framework files
the launcher already installs; Nate's PC sent the same bytes, 2026-09-27), exported with JPEXS FFDec 26.3.0:
`ffdec-cli.jar -selectid <sprite ids> -format sprite:png -zoom 1.2 -export sprite <out> bsresources01.swf` (48 x 48).
`bsresources01.swf` / `02.swf` hold Beyond Skyrim's types 67..511 only; the vanilla types (2 town, 3 settlement, 6 fort)
are placeholders there and come from `interface/SkyUI/mapMarkerArt.swf` (the same map marker framework mod, sha256
b30c61e2..., what the launcher installs). Its sprites run in marker type order (City00, Town, Settlement, Cave, Camp, Fort,
Nordic Ruin... as character ids 4, 6, 8, ...), so type N is character id 2N+2; exported the same way at zoom 1.2.
That rule holds up to type 46 (WinterholdCapital, character id 94). After that the ids skip (MorthalCastle 97, MorthalCapital 99,
FalkreathCastle 100, FalkreathCapital 102, DawnstarCastle 103, DawnstarCapital 105). **Type N is the Nth exported sprite in the swf's
export order**, and that is how every type here was numbered. It was checked against the TNAM of the placed vanilla markers: 16 = the
13 Imperial camps, 17 = the 13 Stormcloak camps, 28 = the 4 strongholds, 35..52 = each hold's castle and capital (Mistveil Keep 35,
Riften 36 ... Dawnstar 52), 53 Temple of Miraak, 54 Raven Rock. Vanilla has no generic castle marker, only one per hold; the Morthal,
Falkreath and Dawnstar castles (47, 49, 51) share one generic keep drawing. The vanilla exports keep their natural size (27..63 x 47..51),
like `2.png`/`3.png`/`6.png`; only the Beyond Skyrim art comes out at 48 x 48.
