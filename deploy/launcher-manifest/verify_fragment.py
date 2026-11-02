r"""Verify the Mihail manifest fragment, including by extracting files out of the real archives.

The claim the fragment makes is that a launcher downloading each Nexus archive and extracting `from` to
`to` lands exactly `sha256` at exactly `size`. Most checks here are structure; the ones that support that
claim are:

  - every `from` exists in its archive's listing, and its entry's SIZE equals the row's `size` - checked
    for all 2,358 rows, not a sample, because `mod.hash` covers only to+sha256 and would not notice a
    wrong size;
  - a sample per mod is really extracted and hashed.

`from` was resolved by size + CRC32, and CRC32 is 32 bits, so the extraction is what turns strong
evidence into a verified fact for the sampled files.

Every row is also read defensively (`.get`), because a malformed row must come out as a FAIL, not a
traceback - a crash is indistinguishable from a different failure to whoever reads the log.

    py -I verify_fragment.py <fragment.json> [samples-per-mod]      EXPECT=<n> for a one-mod fragment

Exit 1 on any failure. mutate_fragment.py proves each check can fail.
"""
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = r"E:\DragonBreak Online Dev files"
DOWNLOADS = os.path.join(os.environ["APPDATA"], "Vortex", "downloads", "skyrimse")
SEVEN = os.path.join(ROOT, "fork", "skymp5-launcher", "assets", "7zip", "7z.exe")
FRAG = sys.argv[1]
NSAMPLE = int(sys.argv[2]) if len(sys.argv) > 2 else 3
EXPECT = int(os.environ.get("EXPECT", "11"))
IDS = json.load(io.open(os.path.join(HERE, "mihail-ids.json"), encoding="utf-8"))
SUMS = {}
for line in io.open(os.path.join(HERE, "dev-mihail-sums.txt"), encoding="utf-8"):
    if line.strip():
        h, n = line.split()
        SUMS[n.lower()] = h
PLUGINS = [
    "mihaildeadrapack.esp", "mihailelementalgolems.esp", "mihailfleshatronach.esp",
    "mihailgiantfamily.esp", "mihailgrahlsandfrostgiants.esp", "mihailhiveguardians.esp",
    "mihailicetitansandseagiants.esp", "mihailnordicsentinel.esp", "mihailskeletalrevenants.esp",
    "mihailundeadsnowelf.esp", "mihailvampirelordsandbeasts.esp",
]
fails = []


def check(label, ok, got=None):
    print("%s %s%s" % ("ok  " if ok else "FAIL", label, "" if ok or got is None else "   %r" % (got,)))
    if not ok:
        fails.append(label)


def sha_size(path):
    h = hashlib.sha256()
    n = 0
    with io.open(path, "rb") as fh:
        while True:
            b = fh.read(1 << 20)
            if not b:
                break
            h.update(b)
            n += len(b)
    return h.hexdigest(), n


def listing(path):
    """{archive path: size} for every entry, so `from` and `size` can both be cross-checked."""
    out = subprocess.run([SEVEN, "l", "-slt", "-ba", "-sccUTF-8", path],
                         capture_output=True, timeout=900).stdout.decode("utf-8", "replace")
    sizes = {}
    cur = None
    for l in out.splitlines():
        if l.startswith("Path = "):
            cur = l[7:].replace("\\", "/")
        elif cur and l.startswith("Size = "):
            sizes.setdefault(cur, int(l[7:] or 0))
    return sizes


frag = json.load(io.open(FRAG, encoding="utf-8"))
archives = frag.get("archives") or []
mods = frag.get("mods") or []
allf = [f for m in mods for f in (m.get("files") or [])]

# ---- row shape, first, so later checks can read rows without crashing ----------------------------
check("schema is 2", frag.get("schema") == 2, frag.get("schema"))
check("%d archives and %d mods" % (EXPECT, EXPECT),
      len(archives) == EXPECT and len(mods) == EXPECT, (len(archives), len(mods)))
check("every file row has exactly the five expected keys",
      all(set(f) == {"to", "archive", "from", "sha256", "size"} for f in allf),
      [sorted(set(f) ^ {"to", "archive", "from", "sha256", "size"}) for f in allf
       if set(f) != {"to", "archive", "from", "sha256", "size"}][:3])
check("no file is inlined (an 'inline' key anywhere)", not any("inline" in f for f in allf))
check("every archive row has an id, hash, size, name and source",
      all({"id", "hash", "size", "name", "source"} <= set(a) for a in archives))

# ---- structure -----------------------------------------------------------------------------------
aid = [a.get("id") for a in archives]
check("archive ids are unique", len(set(aid)) == len(aid))
by_id = {a.get("id"): a for a in archives}
used = {f.get("archive") for f in allf}
check("every referenced archive id exists", used <= set(aid), sorted(used - set(aid), key=str)[:4])
check("every archive is referenced by some file", set(aid) <= used, sorted(set(aid) - used, key=str)[:4])
# mod -> archive must be injective: a shared id would make one mod's files extract from another's
# download. Built from each mod's whole file list, so an empty mod cannot hide.
mod_arch = [sorted({f.get("archive") for f in (m.get("files") or [])}, key=str) for m in mods]
check("each mod's files all point at a single archive", all(len(x) == 1 for x in mod_arch), mod_arch[:3])
check("no two mods share an archive", len({tuple(x) for x in mod_arch}) == len(mod_arch), mod_arch[:3])

# ---- paths ---------------------------------------------------------------------------------------
bad = [f.get("to") for f in allf
       if not isinstance(f.get("to"), str) or f["to"].startswith(("/", "\\"))
       or ".." in f["to"].split("/") or "\\" in f["to"] or re.match(r"^[A-Za-z]:", f["to"])]
check("every 'to' is a relative forward-slash path with no '..'", not bad, bad[:4])
check("'to' paths are unique within every mod",
      all(len({str(f.get("to")).lower() for f in (m.get("files") or [])}) == len(m.get("files") or [])
          for m in mods),
      [m.get("name") for m in mods
       if len({str(f.get("to")).lower() for f in (m.get("files") or [])}) != len(m.get("files") or [])][:3])
check("every size is a non-negative int",
      all(isinstance(f.get("size"), int) and f["size"] >= 0 for f in allf))
check("every sha256 is 64 hex chars",
      all(isinstance(f.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", f["sha256"]) for f in allf))

# ---- the per-mod fingerprint recomputes ----------------------------------------------------------
bad = [m.get("name") for m in mods
       if hashlib.sha256("\n".join(sorted("%s:%s" % (f.get("to"), f.get("sha256"))
                                          for f in (m.get("files") or []))).encode("utf-8")).hexdigest()
       != m.get("hash")]
check("every mod hash recomputes from its own files", not bad, bad[:3])

# ---- the archives on disk ------------------------------------------------------------------------
bad_h, bad_s, bad_n = [], [], []
for a in archives:
    p = os.path.join(DOWNLOADS, str(a.get("name")))
    if not os.path.isfile(p):
        bad_n.append(a.get("name"))
        continue
    s, n = sha_size(p)
    if s != a.get("hash"):
        bad_h.append(a.get("name"))
    if n != a.get("size"):
        bad_s.append(a.get("name"))
check("every archive named exists in the Vortex download cache", not bad_n, bad_n[:3])
check("every archive hash matches the file on disk", not bad_h, bad_h[:3])
check("every archive size matches the file on disk", not bad_s, bad_s[:3])
src = [a.get("source") or {} for a in archives]
check("every archive source is nexus with a modId and fileId",
      all(s.get("type") == "nexus" and s.get("modId") and s.get("fileId") for s in src))
check("no archive carries a url or manual source (nothing re-hosted)",
      not any("url" in json.dumps(s) or s.get("type") == "manual" for s in src),
      [s for s in src if s.get("type") != "nexus"][:2])
bad = []
for a in archives:
    k = os.path.splitext(str(a.get("name")))[0]
    s = a.get("source") or {}
    if k not in IDS or (int(IDS[k]["modId"]), int(IDS[k]["fileId"])) != (s.get("modId"), s.get("fileId")):
        bad.append(a.get("name"))
check("every modId/fileId matches Vortex's own state for that archive", not bad, bad[:3])

# ---- the plugins ---------------------------------------------------------------------------------
plug = {}
for m in mods:
    for f in (m.get("files") or []):
        if str(f.get("to")).lower().endswith((".esp", ".esm", ".esl")):
            plug.setdefault(str(f["to"]).lower(), []).append((m.get("name"), f.get("sha256")))
check("every mod delivers exactly one plugin, and no plugin twice",
      len(plug) == len(mods) and all(len(v) == 1 for v in plug.values()),
      {k: len(v) for k, v in plug.items() if len(v) != 1} or len(plug))
check("every plugin delivered is one of the 11 expected", set(plug) <= set(PLUGINS),
      sorted(set(plug) - set(PLUGINS))[:4])
if EXPECT == 11:
    check("all 11 plugins are present", sorted(plug) == sorted(PLUGINS),
          sorted(set(PLUGINS) - set(plug))[:4])
bad = [p for p in plug if plug[p][0][1] != SUMS.get(p)]
check("every plugin sha matches dev's /opt/skyrim-data/SHA256SUMS", not bad, bad[:4])
check("each plugin sits at the top level of its mod (Data-relative, not nested)",
      all("/" not in p for p in plug))

# ---- every 'from' is in its archive, with the size the row claims --------------------------------
missing, wrong_size = [], []
for m in mods:
    fs = m.get("files") or []
    if not fs:
        continue
    a = by_id.get(fs[0].get("archive"))
    if not a:
        continue
    sizes = listing(os.path.join(DOWNLOADS, str(a.get("name"))))
    for f in fs:
        if f.get("from") not in sizes:
            missing.append((a.get("name"), f.get("from")))
        elif sizes[f["from"]] != f.get("size"):
            wrong_size.append((f.get("to"), sizes[f["from"]], f.get("size")))
check("every 'from' path exists in its archive's listing", not missing, missing[:3])
check("every row's size equals its archive entry's size (all %d rows)" % len(allf),
      not wrong_size, wrong_size[:3])

# ---- extract and hash, the check that makes the claim real ---------------------------------------
print()
print("extracting up to %d file(s) per mod and hashing them out of the real archive:" % NSAMPLE)
bad_x, n_x = [], 0
for m in mods:
    fs = sorted([f for f in (m.get("files") or []) if f.get("from")], key=lambda f: -(f.get("size") or 0))
    if not fs:
        continue
    a = by_id.get(fs[0].get("archive"))
    if not a:
        continue
    # the biggest, the plugin, and the smallest: the extremes plus the file that has to be right
    pick = [fs[0]] + [f for f in fs if str(f.get("to")).lower().endswith((".esp", ".esm", ".esl"))] + [fs[-1]]
    seen, sample = set(), []
    for f in pick:
        if f["to"] not in seen:
            seen.add(f["to"])
            sample.append(f)
    tmp = tempfile.mkdtemp(prefix="mihailx-")
    try:
        for f in sample[:NSAMPLE]:
            subprocess.run([SEVEN, "e", os.path.join(DOWNLOADS, str(a.get("name"))),
                            "-o" + tmp, "-y", "-sccUTF-8", f["from"]],
                           capture_output=True, timeout=900)
            got = os.path.join(tmp, os.path.basename(f["from"]))
            if not os.path.isfile(got):
                bad_x.append((str(m.get("name"))[:28], f.get("from"), "not extracted"))
                continue
            s, n = sha_size(got)
            n_x += 1
            ok = (s, n) == (f.get("sha256"), f.get("size"))
            if not ok:
                bad_x.append((str(m.get("name"))[:28], f.get("to"), "sha/size differ"))
            os.remove(got)
            print("     %-30s %-46s %s" % (str(m.get("name"))[:30], str(f.get("to"))[-46:],
                                           "ok" if ok else "MISMATCH"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
check("every extracted sample matches its sha256 and size (%d files)" % n_x, not bad_x, bad_x[:3])

print()
print("=" * 78)
print("%d directives over %d mods, %.2f GB"
      % (len(allf), len(mods), sum(f.get("size") or 0 for f in allf) / 1073741824.0))
print("%d checks failed" % len(fails) if fails else "every check passed")
sys.exit(1 if fails else 0)
