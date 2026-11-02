r"""Build the launcher install-manifest fragment for the 11 Mihail mods: 11 archive rows + 11 mod rows.

A FRAGMENT, not a merge (the Leader's call, 2 Nov): the local live-install-manifest copy is not known
current, so W5 merges this against live's manifest during the window. Shapes match what
compile-manifest.local.js emits, so merge_manifest.py consumes it unchanged:

    archives[]  {id, hash, size, name, source:{type:"nexus", modId, fileId}}
    mods[]      {name, modId, files:[{to, archive, from, sha256, size}], hash}

WHERE THIS DEVIATES FROM THE PIPELINE, AND WHY
----------------------------------------------
compile-manifest.local.js runs over an MO2 tree built from classify.json's `newmod_files`, i.e. only the
files of each mod that WIN in the dev Data folder - the manifest then delivers exactly what the reference
install runs. **That is not available here.** These 11 mods were never deployed: their plugins were
hand-placed into the dev Data folder for xEdit/CK, but no Data folder on this PC, and no path on the dev
server, holds their assets (checked: dev Data, the Steam Data folder, server\data, server\client-dist,
/opt/skyrim-data - which is 160 plugins and no asset dirs - and the launcher's client-files/extra).
A pilot run on the smallest mod made this visible: 1 of 34 files "installed", the plugin.

So the rule here is **ship every file in the Vortex staging folder**, which is what Vortex would deploy
for a mod at the bottom of the priority list - and these 11 are the newest additions, so bottom priority
is correct. What the Data cross-check would have caught instead comes out as an explicit conflict report:
overlaps among the 11, and overlaps with what live's manifest already delivers. Those are the rows a
human has to look at, and they are listed rather than silently resolved.

Two things are kept from the pipeline exactly:

- **`from` is matched by size + CRC32, never by path.** These archives are FOMOD-shaped
  ("Hive Guardians (SE)\Data\Meshes\..."), so no archive path equals a Data-relative one. An unmatched
  file would be base64-inlined by the real compiler; at 11 GB that is impossible, so unmatched is a hard
  gate, not a warning.
- **Empty files are left out of the index**, since they all share one size+crc key and would otherwise
  make an arbitrary entry the source for every empty file.

Nothing is re-hosted: every archive row points at its Nexus modId/fileId, and the launcher downloads from
Nexus.

    py -I mihail_fragment.py <out.json>        ONLY=<n> restricts to one mod
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
MAP = json.load(io.open(os.path.join(HERE, "mihail-map.json"), encoding="utf-8"))
IDS = json.load(io.open(os.path.join(HERE, "mihail-ids.json"), encoding="utf-8"))


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
    """{"size:CRC": from} over every file entry, first occurrence winning."""
    out = subprocess.run([SEVEN, "l", "-slt", "-ba", "-sccUTF-8", path],
                         capture_output=True, timeout=900).stdout.decode("utf-8", "replace")
    idx = {}
    seen = [0]
    cur = [None]

    def flush():
        """Flushed on the NEXT 'Path =' and once at the end - not on a blank line, which would drop
        the archive's last entry whenever the listing has no trailing blank."""
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
rows = [(int(ONLY), MAP[int(ONLY) - 1])] if ONLY else list(enumerate(MAP, 1))
for i, row in rows:
    folder = row["folder"]
    arch_name = row["archives"][0]
    arch_path = os.path.join(DOWNLOADS, arch_name)
    aid = "m%d" % i                      # local ids; merge_manifest renumbers them after live's
    ids = IDS[folder]                    # mihail-ids.json is keyed by Vortex folder, not by plugin
    if ids["fileName"] != arch_name:
        raise SystemExit("%s: ids say archive %r, map says %r" % (folder, ids["fileName"], arch_name))
    print("[%2d/11] %s" % (i, folder))

    idx, entries = archive_index(arch_path)
    a_sha, _, a_size = hash_file(arch_path)
    archives.append({"id": aid, "hash": a_sha, "size": a_size, "name": arch_name,
                     "source": {"type": "nexus", "modId": int(ids["modId"]),
                                "fileId": int(ids["fileId"])}})
    print("        archive %s, %d entries, %.0f MB" % (a_sha[:12], entries, a_size / 1048576.0))

    files, unmatched = [], []
    for rel in walk(os.path.join(STAGING, folder)):
        s_sha, s_crc, s_size = hash_file(os.path.join(STAGING, folder, rel.replace("/", os.sep)))
        frm = idx.get("%d:%s" % (s_size, s_crc))
        if frm is None:
            unmatched.append(rel)
            continue
        files.append({"to": rel, "archive": aid, "from": frm, "sha256": s_sha, "size": s_size})

    # the launcher's per-mod fingerprint, so a rebuild reinstalls only mods whose content moved
    fp = hashlib.sha256("\n".join(sorted("%s:%s" % (f["to"], f["sha256"]) for f in files))
                        .encode("utf-8")).hexdigest()
    mods.append({"name": folder, "modId": int(ids["modId"]), "files": files, "hash": fp})
    unmatched_total += len(unmatched)
    report.append({"folder": folder, "plugin": row["plugin"], "modId": ids["modId"],
                   "fileId": ids["fileId"], "archive": arch_name, "archiveSha": a_sha,
                   "archiveSize": a_size, "entries": entries, "ships": len(files),
                   "unmatched": len(unmatched), "unmatchedSample": unmatched[:10],
                   "bytes": sum(f["size"] for f in files), "hash": fp})
    print("        ships %d | UNMATCHED %d | %.0f MB"
          % (len(files), len(unmatched), sum(f["size"] for f in files) / 1048576.0))

frag = {"schema": 2, "note": "fragment: 11 Mihail mods, for merging into live's install manifest",
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
    print("UNMATCHED files would have to be base64-inlined - the fragment is NOT usable as is")
sys.exit(1 if unmatched_total else 0)
