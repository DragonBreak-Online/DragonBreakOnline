# DBO_AlchemyRecords.pas: the Alchemy Rework's records, in one headless xEdit run

For the PC (xEdit lives there). Builds everything in `specs/alchemy-pc-records.md` (claude-nate-release) for the one
release of server branch `alchemy-rework-1014`:
- in **DragonBreak Online Edits.esp**: 10 MGEF, 129 ALCH and 2 FLOR, each a copy (as new record) of a vanilla template;
- in **DragonBreak Nexus Patches.esp**: the BNAM of 29 recipes that sat on the cooking pot (CraftTypeCookpot), set to the
  loom (MCE_CraftingLoom) or the forge (CraftingSmithingForge).

The data block inside the script is generated from the spec; edit the spec's generator, never the block by hand.

## Run

1. Close Vortex; stop the creation-kit MCP server (or be ready for the .save rename to fail, step 5).
2. Back up both plugins: `copy "Data\DragonBreak Online Edits.esp" "ckmcp-backups\DLE-before-alchemy.esp"`, the same for
   `DragonBreak Nexus Patches.esp`.
3. Copy `DBO_AlchemyRecords.pas` into the dev install's `Edit Scripts\` and run, from the dev game folder:

   ```
   SSEEdit.exe -D:"<dev Data>" -P:"<server\plugins.server.txt>" -autoload -script:DBO_AlchemyRecords.pas -autoexit
   ```

   Both `-D` and `-P` are needed: `-D` alone still reads Vortex's Plugins.txt and loads the wrong list. The first headless
   run sometimes stops at "Loading active plugin list" without running the script: run it again.
4. Read `Edit Scripts\DBO_AlchemyRecords_result.txt`:
   - `"status": "DONE created 141, existing 0, benches fixed 29"` on a first run, `existing 141` on a rerun (a rerun is
     safe: every EDID already in DLE is skipped and still reported);
   - `"status": "FATAL: nothing changed"`: a template, magic effect or recipe was missing or carried another editor id,
     or a template points outside DLE's masters. `Edit Scripts\DBO_AlchemyRecords_log.txt` lists each one. Nothing was
     changed; fix the load order and run again;
   - `"status": "FATAL: build failed and was rolled back"`: a field did not take; the log names it; what the run made was
     removed again. Do not keep that save (restore the backups) and send the log.
   Errors of the script engine land in `SSEEditException.log` beside the exe.
5. The save: with `-autoexit` xEdit saves on exit. Look in Data for a leftover `DragonBreak Online Edits.esp.save.<stamp>`
   (and the same for Nexus Patches): if the rename failed (ck-mcp holds the files open), the plugin on disk is unchanged
   (`fc /b` it against the backup), so copy the `.save` file over the plugin, delete the `.save`, and `reload` ck-mcp.

## Check the save record by record before shipping

xEdit re-serialises every record it saves and fills in "required" elements: on 21 Sep a one-field script changed 93 records
of DLE. So compare each plugin with its backup, record by record:

```
py tools\plugin_record_diff.py "ckmcp-backups\DLE-before-alchemy.esp" "Data\DragonBreak Online Edits.esp" --allow-edid-prefix DBO_Alch,DBO_Harvest
py tools\plugin_record_diff.py "ckmcp-backups\NP-before-alchemy.esp" "Data\DragonBreak Nexus Patches.esp" --allow-changed <the 29 EDIDs of the result log's BENCH lines>
```

Ship only on "OK: only the expected records differ": DLE shows 141 ADDED (DBO_Alch*, DBO_Harvest*) and nothing else
(the plugin header may count as changed, that is fine); Nexus Patches shows exactly the 29 recipes CHANGED, each in BNAM
only. Anything else (a DBO_Skill_* spell, a SCEN, a record that lost a subrecord) means the save is rejected: restore the
backup and send the diff.

## After

1. `bash dev-server.sh deploy-plugins`, commit the SHA256SUMS it updates, and the client package with the new DLE.
2. Send claude-nate the result file. On CT 115: `node tools/alchemy-records-apply.js <result file>` fills
   `alchemy-rework.json` `records` and moves `_combosPlanned` into `combos` (it refuses, writing nothing, a FATAL result, a
   foreign id or an unknown key). Then `node tests/alchemy-rework-harness.js`, `tests/alchemy-rework-stage2-harness.js`,
   `tests/alchemy-records-apply-harness.js`, and the release.
3. By hand, the placements of the spec's section G (a churn, the milk jug and the flour sack in CYRBrumaSilverPlowHouse, a
   grain mill in CYRBrumaWildeyeStables), then diff again.

## Weapon poisons stay off (poisons.judge false): the in-game test that switches them on

Two players, A and B, both in Bruma, the server log open (`bash dev-server.sh logs skymp`).
1. With Nate in the session, set `poisons.judge: true` in alchemy-rework.json (hot reload).
2. A coats a sword with a Poison of Damage Health (DBO_AlchPoisonHealthT1, 30 points). Within a second the log shows the
   craftedExtras line "poisoned with ...".
3. A hits B once, unblocked: `alchemy: poison DBO_AlchPoisonHealthT1 from A on B: health -15%`, B 15% lower on top of the blow.
4. A hits again: no second poison line (one charge). About 10 s later the craftedExtras "poison used up" report arrives.
5. Coat again; B blocks the blow: no poison line. A Potent poison: 20% at once, then 1.5% a second for 10 s.
6. B at 5% health, poisoned: B stops at 1% (poison never lands the killing blow).
If any line is missing or late, set judge back to false and send the log lines.
