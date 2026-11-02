# Staged: launcher install-manifest rows for the 11 Mihail mods

Worker 3, 2 Nov. **A fragment, not a merge** — the Leader's call, because the local copy of live's
manifest is not known current. W5 merges this against live's real manifest during the window.
**Nothing is deployed and no live file was written.**

| | |
|---|---|
| fragment | `mihail-manifest-fragment.json` |
| sha256 | `14be928eaa654531387b309bc140313fc830eed6151370b0711bfc1bf21138c6` |
| size | 735,816 bytes |
| contents | 11 archive rows, 11 mod rows, **2,358 file directives, 10.97 GB** |
| branch | `feature/mihail-launcher-manifest` (fork, off `origin/main` 5b8ad735) |

Shapes match what `compile-manifest.local.js` emits, so `merge_manifest.py` consumes it unchanged:
it reads only `archives` and `mods`. `orderAppend`, `pluginsAppend` and `loadOrderPositions` are extra
and inert to it — see "The load order" below.

## The table

| mod (Vortex / Nexus name) | modId | fileId | plugin | sha |
|---|---|---|---|---|
| daedra pack (se-ae) | 159364 | 666399 | `mihaildeadrapack.esp` | **Y** |
| elemental golems (se-ae) 1.1 | 106477 | 456922 | `mihailelementalgolems.esp` | **Y** |
| flesh atronachs (se-ae) | 77868 | 327468 | `mihailfleshatronach.esp` | **Y** |
| Giants Overhaul (se-ae) | 98581 | 418218 | `mihailgiantfamily.esp` | **Y** |
| Grahls and Frost Giants (se-ae) | 100013 | 423556 | `mihailgrahlsandfrostgiants.esp` | **Y** |
| hive guardians (se-ae) | 117001 | 491894 | `mihailhiveguardians.esp` | **Y** |
| sea giants and ice titans (se-ae) | 103285 | 436710 | `mihailicetitansandseagiants.esp` | **Y** |
| ancient nordic sentinel (se-ae) v3.2 | 24549 | 475357 | `mihailnordicsentinel.esp` | **Y** |
| skeletal revenants (SE-AE) | 102415 | 433370 | `mihailskeletalrevenants.esp` | **Y** |
| Undead Snow Elves (se-ae) | 87023 | 368464 | `mihailundeadsnowelf.esp` | **Y** |
| vampire lords and beasts (se-ae) | 79281 | 333903 | `mihailvampirelordsandbeasts.esp` | **Y** |

All 11 shas agree across **four independent sources**: Vortex staging, this PC's dev Data folder, the
fragment itself, and the **dev box's** `/opt/skyrim-data/SHA256SUMS`. Nothing is re-hosted — every
archive row carries its Nexus `modId`/`fileId` and the launcher downloads from Nexus.

Plugin → mod was matched **by content, not by name**. Mihail's pages are not called "mihail": the
giant-family plugin comes from *Giants Overhaul*, the ice-titan one from *sea giants and ice titans*.
Matching on which staging folder actually contains the plugin file; a name match would have
mis-assigned at least two.

## A correction to my first message, which named the wrong host

I told the Leader these matched "dev's `/opt/skyrim-data/SHA256SUMS`" and quoted 172 sums with 12
mihail. The numbers are right but the host was not. There are two boxes and `dev-server.sh` goes to the
wrong one for this purpose:

| | sums | mihail in sums | loadorder | mihail in order | mihail files |
|---|---|---|---|---|---|
| **dev box** (`homeserver`, WSL Ubuntu-24.04 — where Nat tests) | 172 | **12** | 171 | **12** | 23 |
| **CT115** (`ssh dragonbreak-dev`, 50.116.28.194:2222) — **production** | 149 | **0** | 148 | **0** | **0** |
| fork tracked `deploy/skyrim-data/SHA256SUMS` | 149 | **0** | 148 | 0 | — |

So the 11 are deployed only on the dev box. CT115 and the fork's tracked manifest have no trace of
them, which matches the Leader's own reading of `origin/main` and `rc-1102`. **That is Gap 1 and it is
W5's**; the manifest rows alone will not close it.

## Where this deviates from the pipeline, and why

`compile-manifest.local.js` normally runs over an MO2 tree built from `classify.json`'s `newmod_files`
— only the files of each mod that **win in the dev Data folder** — so the manifest delivers exactly
what the reference install runs. **That ground truth does not exist for these 11.** Their plugins were
hand-placed into the dev Data folder for xEdit/CK, but no Data folder on this PC and no path on either
server holds their assets. Checked: the dev Data folder, the Steam Data folder, `server\data`,
`server\client-dist`, CT115's `/opt/skyrim-data` (plugins only, no asset dirs) and the launcher's
`client-files/extra`.

A pilot run on the smallest mod is what made this visible: **1 of 34 files "installed"** — the plugin.
Had I not piloted, the build would have emitted 11 mods of one file each and looked successful.

So the rule here is **ship every file in the Vortex staging folder**, which is what Vortex deploys for a
mod at the bottom of the priority list — and these 11 are the newest additions, so bottom is correct.
What the Data cross-check would have decided silently comes out instead as an explicit conflict report
(`mihail-conflicts.json`).

Two things are kept from the pipeline exactly:

- **`from` is matched by size + CRC32, never by path.** The archives are FOMOD-shaped
  (`Hive Guardians (SE)\Data\Meshes\…`), so no archive path equals a Data-relative one.
- **Empty files are left out of the index**, since they share one size+crc key and would otherwise make
  an arbitrary entry the source for every empty file.

## The `.rar` trap in the guide was live, and was avoided

`LAUNCHER_FILES_GUIDE.md` records that `.rar` mods need a full 7-Zip or "the bundled `7za` silently
inlines the extracted files as base64 — that turned a 5 MB manifest into 1 GB on 2026-09-20".
**All 11 of these are `.rar`.** Built with `fork\skymp5-launcher\assets\7zip\7z.exe` plus its `7z.dll`
(the full codec set; no system 7-Zip is installed). **0 of 2,358 directives are inlined**, asserted
rather than assumed — an unmatched file is a hard gate in the builder, not a warning.

## Conflicts — the one decision left

- **Within the 11:** 91 paths are delivered by more than one mod. **90 are byte-identical** (whichever
  wins installs the same bytes). **1 differs:** `sound/voice/temp.wav`, shipped with different content
  by 5 of the 11 (daedra pack, flesh atronachs, Giants Overhaul, Grahls, sea giants). That path is not a
  valid voice-file location — `sound/voice/` is organised per plugin and voice type — so it is packaging
  debris and whichever mod sorts last wins harmlessly. Flagged rather than resolved, because dropping a
  file would change `mod.hash` and deviate from delivering the archive's content.
- **Against live:** 16 of the fragment's paths are also delivered by live's manifest, and **all 16 are
  byte-identical**. Zero real conflicts. Read from the **local 14 Oct copy**, which is why this is
  indicative only — W5 re-checks at merge. The within-the-11 half does not depend on that copy.

## The load order

The merge must place the 11 plugins at their **load-order positions**, not merely append them. Measured
on the dev box: `loadorder.txt` lines **158–168**, in this sequence (line 156 is
`mihailmmaminotaur.esp`, already live):

`deadrapack, icetitansandseagiants, skeletalrevenants, grahlsandfrostgiants, giantfamily,
undeadsnowelf, vampirelordsandbeasts, fleshatronach, nordicsentinel, hiveguardians, elementalgolems`

`pluginsAppend` and `orderAppend` in the fragment carry that sequence.

## Verified — 29 checks, `verify_fragment.py`, re-run against the staged bytes

- structure: 11 archives / 11 mods, ids unique, mod→archive injective, every row exactly five keys,
  nothing inlined
- paths: every `to` relative, forward-slash, no `..`, unique within its mod
- every archive's **sha256 and size re-measured against the file on disk**; every `modId`/`fileId`
  matches Vortex's own state; no `url` or `manual` source anywhere
- every mod's fingerprint recomputes from its own files
- every plugin delivered once, at top level, sha matching the dev box's `SHA256SUMS`
- **every one of the 2,358 `from` paths exists in its archive's listing, with the entry size the row
  claims** — all rows, not a sample, because `mod.hash` covers only `to`+`sha256` and would not notice a
  wrong size
- **33 files really extracted from the real archives and hashed**, 3 per mod (largest, plugin, smallest)
  — the check that turns a 32-bit CRC match into a verified fact

### The verifier is known to be able to fail

`mutate_fragment.py` runs **19 mutants** against a one-mod fragment and requires each to be caught by
the check meant to catch it. The first pass reported 5 holes; 3 were real and are fixed:

- **a wrong `size` on a file outside the extraction sample was invisible** — `mod.hash` covers only
  `to`+`sha256`. Fixed by cross-checking every row's size against its archive entry.
- **two mutants crashed the verifier instead of reporting** (a re-hosted `source`, an inlined row), so a
  defect was indistinguishable from a bug. Every row is now read with `.get`.
- the remaining 2 were my own mutants being wrong: one mutated the plugin's `to`, which has no `/`, so
  replacing separators was a no-op that "found" a hole that did not exist.

All 19 are caught now, and the clean fragment still passes.

## What I did not do

- **Did not merge.** `merge_manifest.py` would have run against `_work\skyrim-release\live-install-
  manifest.json`, taken 14 Oct and not known current — the same stale-base trap as the DLE.
- **Did not touch the shared fork checkout.** It has an uncommitted change to
  `deploy/skyrim-data/SHA256SUMS` (a DLE sha, unrelated to mihail) on
  `feature/spidermancy-explosion-summons`. This went on its own branch via a worktree.
- **Did not deploy, restart or sync anything.** `deploy-plugins` and the launcher publish are the
  Leader's.
