# Staged: launcher-1102 package — 12 mods for the install manifest

Worker 3, 2 Nov, for W5 to put into w1102's hook and dry-run. **Nothing is deployed**; no file on CT115
was written. The 11 Mihail creature mods + Flesh Colossus, as W5 asked.

| | |
|---|---|
| **base** `install-manifest.json` | `62871f7462f1ed418b20d1b1ae56f88a1a661cfd8512a5b52bea4f6f152133dc` |
| **base** `modlist.json` | `a35742ec06520961db77df232732efb08009af6ee361cf31aaf410e1a1ea6f27` |
| **new** `install-manifest.json` | `a9ad60df36bf56e4a3ede56a052cfb38ba5a2f13be8354613fec6e0ab437a8da` (9,592,122 B) |
| **new** `modlist.json` | `fe87b5e83d890448f56c0385c4d42cd78d385fa4032c43ac4af99d23e23ce13f` (25,845 B) |
| totals | **171 mods, 172 archives, 141 plugins, order 171, modlist 171** |
| new rows | 12 mods, archives `a164`–`a175`, **2,362 directives, 11.00 GB, 0 inlined** |

Layout matches `launcher-1101`: `backend-data/{install-manifest.json,modlist.json}` + `SHA256SUMS`
(binary-mode `*`, as W7's), so `cd "$PKG" && sha256sum -c --quiet SHA256SUMS` works unchanged.
`assertions.json` holds the numbers for the hook's python block.

## Read this first: the base is 1101, not live

**Live's `install-manifest.json` is still `7b6ab814` — 158 mods, 128 plugins, no mihail at all.** That is
exactly `hook-1101`'s `BASE_MANIFEST`, so **window-1101's launcher step has not been applied yet.**

Building on live would have made the two steps collide: each hook checks its base sha, so whichever ran
second would refuse. This package therefore merges onto **W7's staged 1101 output**
(`~/claude-nate-release/w1101/launcher-1101/backend-data/`, 159 mods / 160 archives / 129 plugins), and
`hook-1102` must assert `62871f74` / `a35742ec` as its base. **1101 must be applied first.** If 1101 is
abandoned or re-staged, this has to be rebuilt on whatever it produces — `merge_1102.py` refuses to run
against anything else, so that cannot happen silently.

## The load order is the part that could have broken players

`plugins` becomes the client's `Plugins.txt`, and form ids are `plugin index << 24 | local id`. If this
list disagrees with the server's own order, every id in the later plugins shifts **on one side only** —
the `AlternateHighPolyHead_SE.esp` bug that spawned every player in Riverwood.

The first build appended the 12 in **folder-name order**, which is not the order they load in. Corrected
to the dev box's measured `loadorder.txt` lines 158–168, with Flesh Colossus last as W5 asked (line 156
is `mihailmmaminotaur.esp`, which 1101 adds):

1 `mihaildeadrapack` · 2 `mihailicetitansandseagiants` · 3 `mihailskeletalrevenants` ·
4 `mihailgrahlsandfrostgiants` · 5 `mihailgiantfamily` · 6 `mihailundeadsnowelf` ·
7 `mihailvampirelordsandbeasts` · 8 `mihailfleshatronach` · 9 `mihailnordicsentinel` ·
10 `mihailhiveguardians` · 11 `mihailelementalgolems` · 12 `1FleshColossus`

W5's own list has the same sequence, which is the independent corroboration. `mods`, `order` and
`archives` are appended in that sequence too, so `a164` is the first to load and `a175` the last.
**Confirm the server's `server-settings.json` `loadOrder` matches before this ships** — the manifest only
sets the client's half.

## Flesh Colossus: two traps, both already in the rows

1. **Its `.esl` must not ship.** The archive and staging both carry `1FleshColossus.esl`, an ESL-flagged
   copy of the same plugin (same 56,831 bytes, different CRC). skymp upstream has no ESL support, and an
   ESL-flagged plugin takes no regular load-order index — shipping both is the index-shift bug above. The
   exclusion is asserted to match exactly one file, and the verifier asserts **no `.esl` is delivered by
   any new row**.
2. **Its staging folder is not Data-relative.** The plugin sits at `esp/1FleshColossus.esp`; shipped
   verbatim it would install to `Data\esp\` where the game never loads it. Remapped to the top level,
   as the dev Data folder and the 1 Nov colossus entry both have it.

### A defect in the 1 Nov colossus entry

`_notes-to-server\staged-20261101-colossus-v3\colossus-manifest-entry.json` — which W5 pointed me at as
the source for this row — has **the wrong `from` path for all four files**. It says
`1FleshColossusSE/esp/1FleshColossus.esp` etc.; **no path in the archive contains `1FleshColossusSE`**
(checked: `7z l` returns 0 matches). The real prefix is `data/`. The launcher would have failed to
extract every file of that mod. The rows here are measured from the archive by size+CRC32, and 2 of them
were extracted and hashed to prove it.

## Where this deviates from the pipeline

`compile-manifest.local.js` ships only each mod's files that **win in the dev Data folder**, so the
manifest delivers the install that runs. **These 12 were never deployed** — plugins hand-placed for
xEdit/CK, assets only in Vortex staging (checked: dev Data, Steam's Data, `server\data`,
`server\client-dist`, CT115's `/opt/skyrim-data`, `client-files/extra`). A pilot on the smallest mod
reported **1 of 34 files "installed"** — the plugin — which is how this was caught; the full run would
have emitted 12 mods of one file each and looked successful.

So the rule is **ship every staging file** (minus the colossus `.esl`), which is what Vortex deploys for a
mod at the bottom of the priority list — correct for the newest additions. The Leader approved this and
keeping `temp.wav` below. Conflicts are reported, not silently resolved:

- **within the 12:** 91 paths delivered more than once, **90 byte-identical**; one differs —
  `sound/voice/temp.wav`, shipped with different bytes by 5 of them. Not a valid voice-file path, so it
  is packaging debris and the last in `order` wins harmlessly. Left in: dropping a file changes
  `mod.hash` and stops the row describing the archive.
- **against live:** 16 overlapping paths, **all 16 byte-identical**.

## The `.rar` trap was live and was avoided

`LAUNCHER_FILES_GUIDE.md` records that `.rar` mods need a full 7-Zip or the bundled `7za` "silently
inlines the extracted files as base64 — that turned a 5 MB manifest into 1 GB on 2026-09-20". All 11
Mihail mods are `.rar`. Built with `fork\skymp5-launcher\assets\7zip\7z.exe` + its `7z.dll`; **0 of 2,362
new directives are inlined**, asserted, and the 76 inlined files already in live's manifest are unchanged.

## Verified — 44 checks, `verify_1102.py`, independent of the merge

It re-reads the package from disk and re-derives everything, so a merge bug cannot vouch for itself.

- `SHA256SUMS` matches both files; counts +12 on every list
- **every archive, mod, plugin, order and modlist row that 1101 staged is byte-identical and in the same
  position**; `root`, `rootHash`, `schema`, `game` untouched
- archive ids unique manifest-wide, every file's archive resolves, no duplicate plugin or order entry
- the 12 appended plugins are **in the measured load order**, and mod *i* delivers plugin *i*, so mods,
  order and plugins tell the same story
- every new archive's sha256 and size re-measured against the download; ids match Vortex's state; no
  `url` or `manual` source anywhere
- no `.esl` delivered; every new plugin at Data top level; the colossus plugin comes from `esp/`
- **every one of the 2,362 new `from` paths exists in its archive's listing with the entry size the row
  claims** — all rows, because `mod.hash` covers only `to`+`sha256` and cannot see a wrong size
- **24 files extracted from the real archives and hashed** (2 per mod: largest + plugin)

Earlier passes of this verifier found 3 real holes in itself and one real defect in the package (the load
order). Two of the holes were crashes where a malformed row should have been reported; every row is now
read with `.get`. `mutate_fragment.py` (staged with the 11-mod fragment) breaks the row-level checks 19
ways and requires each to be caught.

## Two pre-existing things in live's manifest, neither mine

- **76 files are base64-inlined** (BodySlide language files and similar) — carried through untouched.
- **`modlist.json` has no row for "Orc Strongholds - All In One"**, so that mod never appears in the
  launcher's Modlist panel. 159 mods but 157 folder-named rows + 3 display-named + `SkyMP Client`.

## modlist naming

The generated convention is the mod's folder name, but the three most recently hand-added rows (Divine
and Daedric Robes, Magical Blackreach, Minotaurs SSE) all use a readable name, and the folder names are
timestamped slugs. Following the recent precedent: "Daedra Pack", "Elemental Golems", "Flesh Atronachs",
"Giants Overhaul", "Grahls and Frost Giants", "Hive Guardians", "Sea Giants and Ice Titans", "Ancient
Nordic Sentinel", "Skeletal Revenants", "Undead Snow Elves", "Vampire Lords and Beasts", "Flesh
Colossus". Say if you would rather have folder names.

## What I did not do

- **Did not apply anything.** The Leader applies; `/opt/alduinak/skymp5-backend/data` is read-only for us
  and I only read it.
- **Did not write the hook.** W5 asked to put these into w1102's own hook; `assertions.json` has the
  numbers its python block needs.
- **Did not touch the SHA256SUMS / loadorder gap.** CT115 has 0 mihail files, 0 in `SHA256SUMS`, 0 in
  `loadorder.txt`; only the dev box has them (172/171/12). That is W5's T2 item and the manifest alone
  will not close it.
