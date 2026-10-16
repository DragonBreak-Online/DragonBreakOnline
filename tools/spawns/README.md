# Owned spawns

Every living creature a DragonBreak-owned plugin places **Initially Disabled** becomes a server spawn of its own base,
at its own spot and heading. Nate, 30 Sep: "those living actors should be used as spawns for their respective npc",
creatures only.

- `owned_spawns.py` reads the load order with esplib and writes `server/owned-spawns.json`: spawns, groups (by the
  nearest map marker within 3000 units, else the cell) and camps (a group with a `Treas...Chest` of ours). It skips
  people (race with ActorTypeNPC), Starts Dead corpses, interiors and anything `dungeons.json` places.
  - Anchors come only from plugins that are not ours, so no release of ours can move them.
  - `--replace "<plugin>=<path>"` reads a copy that has not shipped yet.
  - It takes a few seconds on CT 115: `sudo`, since it reads `/opt/skyrim-data`.
- `wildlife.js` turns each spawn into a `wild:<kind>:p<local id>-<plugin>` zone and adds the camps' chests to the
  camp chest roll. `gamemode-config.json` `animalBody` decides what the bodies give (goblins keep their gear).
- `spawns_gate.py` is the release gate. Every creature in the list must be in the shipping plugin, Initially Disabled,
  and every camp chest present; an empty list passes. Exit 0 prints `ok`; exit 1 gives a one-line reason.
- `test_owned_spawns.py`: `sudo python3 tools/spawns/test_owned_spawns.py` runs both against the live order and DLE v5.

Release: regenerate with the shipping copy, commit `owned-spawns.json`, run the gate, then ship the plugin and the
gameplay together. See `CHECKLIST.md` (30 Sep, "placing creatures in our plugins").

# Town spawns (the people of open Skyrim)

Nate, 16 Oct: "the npcs in skyrim needs to work like how bruma is". NPC pass 2 (`tools/skyrim_actor_all.py`,
`tooling/xedit-scripts/DBO_SkyrimActorsList2.txt` on `skyrim-npc-all-1016`) disables every living plugin actor still
enabled in open Skyrim. Bruma's people were disabled the same way and never replaced (Bruma has only its 377 wild zones);
these are the replacements for Skyrim.

- `town_spawns.py <list 2>` reads the load order in place (`/opt/skyrim-data`, `--replace` for a copy not shipped yet) and
  writes `town-spawns.json`: each guard, townsperson, merchant, child, friendly NPC and tame animal of the list, with its
  base (a leveled one picked once per spot), spot, heading, hold (its location's hold, else the nearest capital), town,
  anchor and factions (no crime or service factions). Left out and listed under `skipped`: what a dungeon lease, wildlife
  or Blackreach already spawns, the hostile decision keeps, anything behind an enable parent that is off at game start
  (Civil War camps and garrisons, quest people), holding and template cells (no hold), spots with no navmesh within 128
  units under them, spots inside an object's box outdoors, and spots within 512 units of a gate landing, respawn temple
  or the arrival. About 25 s, ~2 GB; run it under `ionice -c3 nice -n19`.
- `townspawns.js` writes the `town:<kind>:<id>-<plugin>` zones, each only once its plugin actor is Initially Disabled in
  the plugins the server loaded, so they appear with the restart that ships pass 2 and never beside the plugin's copy.
  Config `gamemode-config.json` "townSpawns" (holds, kinds, lore exclusions, caps); hot reload.
- `tests/townspawns-harness.js` checks the data, the plugin gate, the caps, the lore exclusions, the factions and bodies.

Release step: rerun `town_spawns.py` on the final list 2 with `--replace` for the DLE and Nexus Patches that ship, commit
the diff, run the harness. The gameplay can go out before or with the restart; nothing stands until the plugins load.
