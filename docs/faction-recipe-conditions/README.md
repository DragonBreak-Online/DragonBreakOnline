# Faction gear recipes hidden behind single-player quests (18 Oct 2026)

**Report:** #bugs "Haafingar Armor missing" (zeedus, Aravanya, 18 Oct). Haafingar's smith could not find the Solitude
guard armour at the forge. The other holds' armour seemed fine.

**Who does what:** the server session found it from the live load order (140 plugins). The PC session makes the edits in
xEdit.

## Cause

The recipes that make faction gear come mostly from More Craftable Equipment (MCE). MCE shows each recipe only once the
player has done the matching single-player quest. Examples:

| Gear | Condition |
|---|---|
| Haafingar guard armour | `GetStageDone(Favor252, 25)`, Thane of Haafingar |
| Dark Brotherhood | `DB02` |
| Dawnguard | `DLC1VQ02` / `DLC1VQ08` |
| Stormcloaks | `CW` |
| Thieves Guild | `TG02B` / `TGLeadership` |
| Blades | `MQ203` |
| College | `MG08` |
| Every other hold's guard armour | that hold's own thane quest |

Nobody does those quests on this server, so the game never lists the recipes. Nothing reaches the server either: the
18 Oct log has no craft attempt from the Haafingar smiths.

Whiterun's guard armour shows because its condition is `GetQuestCompleted(MQ104)` (Dragon Rising), which clients evidently
count as done.

The server already decides who may forge faction gear: `factiongear.js` checks the faction and its smith or tailor rank,
and `regions.js` refuses everyone else. The quest conditions add nothing and hide the gear from the factions it belongs to.

## The list

`recipe-quest-conditions.csv`: **114 recipes** whose product is in `faction-gear.json`, with their quest conditions. The
columns are the recipe, its winning plugin, the item, its factions, the conditions, and where to edit.
- 110 are overrides in **DragonBreak Nexus Patches.esp** (MCE and other mods' recipes; never edit the mod's own file).
- 4 are edited in place in **DragonBreak.esp**.

By faction:

| Faction | Recipes |
|---|---|
| Dark Brotherhood | 24 |
| Thieves Guild | 17 |
| Dawnguard | 13 |
| Stormcloaks | 11 |
| Blades | 6 |
| Thalmor | 5 |
| College of Winterhold, Companions, Nightingales | 4 each |
| Each hold | 3 (Windhelm 1) |
| Clan Volkihar | 1 |

## The edit

In each listed COBJ, remove only the CTDA conditions on quest functions:
- `GetStage`, `GetStageDone`, `GetQuestCompleted`, `GetQuestRunning`.

Keep everything else:
- other conditions (perks, for example; the server ignores them, but they are the mod's own gating);
- the components, the bench keyword and the output.

The `MQ104` rows already work. Lifting them is harmless and keeps the set consistent.

Check each recipe against its winning record before writing: the table was read from CT 115's `/opt/skyrim-data` on 18 Oct.
To regenerate after any plugin change, run on CT 115 from `server/`:

```
python3 tools/recipes/faction_recipe_conditions.py faction-gear.json docs/faction-recipe-conditions/recipe-quest-conditions.csv
```

Release as usual: `deploy-plugins`, SHA256SUMS, the launcher sync. The fix reaches players with the plugin release.

## Not in this list

These have quest conditions too but are not faction gear, so who may make them is not ours to judge from here:
- recipes on `DLC2Init`, `DLC2SV02` and `RelationshipMarriage`;
- the Jarl's clothes (`Favor*`).

Ask Nate before lifting those.
