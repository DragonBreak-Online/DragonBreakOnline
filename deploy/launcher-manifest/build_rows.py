r"""Build install-manifest rows for the 12 mods of window-1102: the 11 Mihail creature mods + Flesh
Colossus. Supersedes mihail_fragment.py, which did the 11 only - one implementation for all 12, so the
size+CRC32 `from` matching cannot drift between them.

Row shapes follow what live's manifest already contains for the Minotaurs row W7 staged for 1101:
`mods[].name` is the Vortex folder name, `mods[].modId` is the real Nexus id, `to` keeps the source's
case, and the archive carries `source: {type: nexus, modId, fileId}` so nothing is re-hosted.

TWO RULES THAT ARE NOT OBVIOUS

1. **Ship every staging file** - except where `exclude` says otherwise. The pipeline normally ships only
   each mod's files that win in the dev Data folder, but these 12 were never deployed (their assets live
   only in Vortex staging), so there is no install to read. Staging is what Vortex would deploy for a mod
   at the bottom of the priority list, which is right for the newest additions. Conflicts are reported
   by conflicts.py instead of being resolved silently.

2. **Flesh Colossus must not ship its .esl.** The archive and staging both carry
   `1FleshColossus.esl`, an ESL-flagged copy of the same plugin, and **skymp upstream has no ESL
   support** - and an ESL-flagged plugin takes no regular load-order index, so shipping both would shift
   every later index on the client only. That is the AlternateHighPolyHead bug that put every player in
   Riverwood. The exclusion is asserted to match exactly one file, so a renamed archive cannot quietly
   drop it from the exclusion and ship it.

    py -I build_rows.py <out.json>        ONLY=<n> restricts to one mod
"""
import hashlib
import io
import json
import os
import subprocess
import sys
import zlib

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = r"E:\DragonBreak Online Dev files"
STAGING = r"E:\Vortex Mods\skyrimse"
DOWNLOADS = os.path.join(os.environ["APPDATA"], "Vortex", "downloads", "skyrimse")
SEVEN = os.path.join(ROOT, "fork", "skymp5-launcher", "assets", "7zip", "7z.exe")
OUT = sys.argv[1]

# display names for modlist.json. The generated convention is the folder name, but the three rows added
# by hand most recently (Divine and Daedric Robes, Magical Blackreach, Minotaurs SSE) all use a readable
# name, and the folder names are timestamped slugs. Following the recent precedent.
SPEC = [
    ("daedra pack (se-ae)-159364-1-1758040199", "mihaildeadrapack.esp", "Daedra Pack", []),
    ("elemental golems (se-ae) 1.1-106477-1-1-1704112485", "mihailelementalgolems.esp",
     "Elemental Golems", []),
    ("flesh atronachs (se-ae)-77868-1-1667084565", "mihailfleshatronach.esp", "Flesh Atronachs", []),
    ("Giants Overhaul (se-ae)-98581-1-1692362791", "mihailgiantfamily.esp", "Giants Overhaul", []),
    ("Grahls and Frost Giants (se-ae)-100013-1-1693935896", "mihailgrahlsandfrostgiants.esp",
     "Grahls and Frost Giants", []),
    ("hive guardians (se-ae)-117001-1-1713376299", "mihailhiveguardians.esp", "Hive Guardians", []),
    ("sea giants and ice titans (se-ae)-103285-1-1698168502", "mihailicetitansandseagiants.esp",
     "Sea Giants and Ice Titans", []),
    ("ancient nordic sentinel (se-ae) v3.2-24549-3-2-1709129054", "mihailnordicsentinel.esp",
     "Ancient Nordic Sentinel", []),
    ("skeletal revenants (SE-AE)-102415-1-1697136253", "mihailskeletalrevenants.esp",
     "Skeletal Revenants", []),
    ("Undead Snow Elves (se-ae)-87023-1-1678811650", "mihailundeadsnowelf.esp", "Undead Snow Elves", []),
    ("vampire lords and beasts (se-ae)-79281-1-1669211940", "mihailvampirelordsandbeasts.esp",
     "Vampire Lords and Beasts", []),
    # see rule 2 in the docstring: the .esl is an ESL-flagged copy of the same plugin and must not ship
    # plugin named by its DATA-relative path, which for this one is the remapped name (see REMAP)
    ("1FleshColossusSE-55719-1-1631893972", "1FleshColossus.esp", "Flesh Colossus",
     ["1FleshColossus.esl"]),
]
# Staging paths that are NOT Data-relative, mapped to where the file actually belongs in Data.
# Flesh Colossus is the only one: its archive keeps the plugin in an `esp/` folder, so Vortex staged it
# as `esp/1FleshColossus.esp`, and shipping that path verbatim would install the plugin to `Data\esp\`
# where the game would never load it. The dev Data folder has it at the top level, and the colossus
# entry staged on 1 Nov maps it the same way. The 11 Mihail folders are Data-relative as they stand,
# which verify_fragment.py's "each plugin sits at the top level of its mod" check holds them to.
REMAP = {"1FleshColossusSE-55719-1-1631893972": {"esp/1FleshColossus.esp": "1FleshColossus.esp"}}
IDS = json.load(io.open(os.path.join(HERE, "mihail-ids.json"), encoding="utf-8"))
IDS.setdefault("1FleshColossusSE-55719-1-1631893972",
               {"modId": 55719, "fileId": 228976,
                "fileName": "1FleshColossusSE-55719-1-1631893972.7z"})


def hash_file(path):
    """sha256 + CRC32 + size in one pass, streaming - these trees hold multi-hundred-MB BSAs."""
    h = hashlib.sha256()
    crc = 0
    size = 0
    with io.open(path, "rb") as fh:
        while True:
            b = fh.read(1 << 20)
            if not b:
                break
            h.update(b)
            crc = zlib.crc32(b, crc)
            size += len(b)
    return h.hexdigest(), "%08X" % (crc & 0xFFFFFFFF), size


def walk(base):
    out = []
    for d, dirs, files in os.walk(base):
        dirs.sort()
        for n in sorted(files):
            out.append(os.path.relpath(os.path.join(d, n), base).replace(os.sep, "/"))
    return out


def archive_index(path):
    """{"size:CRC": from} over every file entry, first occurrence winning.

    Empty files are excluded on purpose: they share one size+crc key and would otherwise make an
    arbitrary entry the source for every empty file. compile-manifest.local.js does the same.
    """
    out = subprocess.run([SEVEN, "l", "-slt", "-ba", "-sccUTF-8", path],
                         capture_output=True, timeout=900).stdout.decode("utf-8", "replace")
    idx = {}
    seen = [0]
    cur = [None]

    def flush():
        """Flushed on the NEXT 'Path =' and once at the end - not on a blank line, which would drop the
        archive's last entry whenever the listing has no trailing blank."""
        c = cur[0]
        if c and c["path"] and c["crc"] and not c["folder"] and c["size"]:
            seen[0] += 1
            idx.setdefault("%d:%s" % (c["size"], c["crc"]), c["path"].replace("\\", "/"))
        cur[0] = None

    for line in out.splitlines():
        if line.startswith("Path = "):
            flush()
            cur[0] = {"path": line[7:], "size": 0, "crc": "", "folder": False}
        elif cur[0] is None:
            continue
        elif line.startswith("Size = "):
            cur[0]["size"] = int(line[7:] or 0)
        elif line.startswith("CRC = "):
            cur[0]["crc"] = line[6:].strip()
        elif line.startswith("Folder = "):
            cur[0]["folder"] = line[9:].strip() == "+"
    flush()
    return idx, seen[0]


archives, mods, report = [], [], []
unmatched_total = 0
ONLY = os.environ.get("ONLY")
rows = [(int(ONLY), SPEC[int(ONLY) - 1])] if ONLY else list(enumerate(SPEC, 1))
for i, (folder, plugin, display, exclude) in rows:
    ids = IDS[folder]
    arch_name = ids["fileName"]
    arch_path = os.path.join(DOWNLOADS, arch_name)
    aid = "m%d" % i                      # local ids; renumbered after live's at merge
    print("[%2d/%d] %s" % (i, len(SPEC), folder))

    idx, entries = archive_index(arch_path)
    a_sha, _, a_size = hash_file(arch_path)
    archives.append({"id": aid, "hash": a_sha, "size": a_size, "name": arch_name,
                     "source": {"type": "nexus", "modId": int(ids["modId"]),
                                "fileId": int(ids["fileId"])}})
    print("        archive %s, %d entries, %.0f MB" % (a_sha[:12], entries, a_size / 1048576.0))

    files, unmatched, dropped, remapped = [], [], [], []
    low = {x.lower() for x in exclude}
    remap = REMAP.get(folder, {})
    for rel in walk(os.path.join(STAGING, folder)):
        if rel.lower() in low:
            dropped.append(rel)
            continue
        s_sha, s_crc, s_size = hash_file(os.path.join(STAGING, folder, rel.replace("/", os.sep)))
        frm = idx.get("%d:%s" % (s_size, s_crc))
        if frm is None:
            unmatched.append(rel)
            continue
        to = remap.get(rel, rel)
        if to != rel:
            remapped.append("%s -> %s" % (rel, to))
        files.append({"to": to, "archive": aid, "from": frm, "sha256": s_sha, "size": s_size})
    if sorted(remap) != sorted(x.split(" -> ")[0] for x in remapped):
        raise SystemExit("%s: remap %r matched %r" % (folder, remap, remapped))
    # an exclusion that matches nothing means the archive changed and the file would now ship
    if sorted(x.lower() for x in dropped) != sorted(low):
        raise SystemExit("%s: exclude %r matched %r" % (folder, exclude, dropped))
    if not any(f["to"] == plugin for f in files):
        raise SystemExit("%s: the plugin %r is not among the shipped files" % (folder, plugin))

    # the launcher's per-mod fingerprint, so a rebuild reinstalls only mods whose content moved
    fp = hashlib.sha256("\n".join(sorted("%s:%s" % (f["to"], f["sha256"]) for f in files))
                        .encode("utf-8")).hexdigest()
    mods.append({"name": folder, "modId": int(ids["modId"]), "files": files, "hash": fp,
                 "_display": display, "_plugin": plugin})
    unmatched_total += len(unmatched)
    report.append({"folder": folder, "plugin": plugin, "display": display,
                   "modId": ids["modId"], "fileId": ids["fileId"], "archive": arch_name,
                   "archiveSha": a_sha, "archiveSize": a_size, "entries": entries,
                   "ships": len(files), "excluded": dropped, "remapped": remapped, "unmatched": len(unmatched),
                   "unmatchedSample": unmatched[:10], "bytes": sum(f["size"] for f in files),
                   "hash": fp})
    print("        ships %d | excluded %d | UNMATCHED %d | %.0f MB"
          % (len(files), len(dropped), len(unmatched), sum(f["size"] for f in files) / 1048576.0))

frag = {"schema": 2, "note": "window-1102 rows: 11 Mihail creature mods + Flesh Colossus",
        "archives": archives, "mods": mods}
io.open(OUT, "w", encoding="utf-8", newline="\n").write(json.dumps(frag) + "\n")
io.open(os.path.splitext(OUT)[0] + "-report.json", "w", encoding="utf-8", newline="\n").write(
    json.dumps(report, indent=1) + "\n")
print()
print("=" * 78)
print("archives %d | mods %d | directives %d | %.2f GB | unmatched %d"
      % (len(archives), len(mods), sum(len(m["files"]) for m in mods),
         sum(f["size"] for m in mods for f in m["files"]) / 1073741824.0, unmatched_total))
print("wrote %s (%d bytes)" % (OUT, os.path.getsize(OUT)))
if unmatched_total:
    print("UNMATCHED files would have to be base64-inlined - NOT usable as is")
sys.exit(1 if unmatched_total else 0)
