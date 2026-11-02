r"""Verify the launcher-1102 package against 1101's base and against the real archives.

Independent of merge_1102.py on purpose: it re-reads the package from disk and re-derives everything,
so a bug in the merge cannot vouch for itself. The claims that matter:

  - nothing that window-1101 staged has moved by a byte (the whole point: this is 1101 plus rows);
  - every one of the 12 new mods' files is really in its Nexus archive at the `from` path, with the size
    the row claims - all rows, not a sample, since mod.hash covers only to+sha256;
  - a sample per new mod is extracted and hashed, which is what turns a 32-bit CRC match into a fact;
  - no .esl is delivered anywhere in the new rows (skymp upstream has no ESL support, and an
    ESL-flagged plugin takes no regular load-order index - the AlternateHighPolyHead/Riverwood bug).

    py -I verify_1102.py <package dir> [samples-per-mod]
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
PKG = sys.argv[1]
NSAMPLE = int(sys.argv[2]) if len(sys.argv) > 2 else 2
BASE_MANIFEST = "62871f7462f1ed418b20d1b1ae56f88a1a661cfd8512a5b52bea4f6f152133dc"
BASE_MODLIST = "a35742ec06520961db77df232732efb08009af6ee361cf31aaf410e1a1ea6f27"
NEW = 12
IDS = json.load(io.open(os.path.join(HERE, "mihail-ids.json"), encoding="utf-8"))
IDS.setdefault("1FleshColossusSE-55719-1-1631893972",
               {"modId": 55719, "fileId": 228976,
                "fileName": "1FleshColossusSE-55719-1-1631893972.7z"})
fails = []


def check(label, ok, got=None):
    print("%s %s%s" % ("ok  " if ok else "FAIL", label, "" if ok or got is None else "   %r" % (got,)))
    if not ok:
        fails.append(label)


def sha_bytes(b):
    return hashlib.sha256(b).hexdigest()


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
    """{archive path: size} for every file entry, flushing on the next Path and once at the end."""
    out = subprocess.run([SEVEN, "l", "-slt", "-ba", "-sccUTF-8", path],
                         capture_output=True, timeout=900).stdout.decode("utf-8", "replace")
    sizes = {}
    cur = [None]

    def flush():
        c = cur[0]
        if c and c["path"] and not c["folder"]:
            sizes.setdefault(c["path"].replace("\\", "/"), c["size"])
        cur[0] = None

    for l in out.splitlines():
        if l.startswith("Path = "):
            flush()
            cur[0] = {"path": l[7:], "size": 0, "folder": False}
        elif cur[0] is None:
            continue
        elif l.startswith("Size = "):
            cur[0]["size"] = int(l[7:] or 0)
        elif l.startswith("Folder = "):
            cur[0]["folder"] = l[9:].strip() == "+"
    flush()
    return sizes


# ---- the package ---------------------------------------------------------------------------------
pm = os.path.join(PKG, "backend-data", "install-manifest.json")
pl = os.path.join(PKG, "backend-data", "modlist.json")
check("the package has backend-data/install-manifest.json and modlist.json",
      os.path.isfile(pm) and os.path.isfile(pl))
sums = {}
for line in io.open(os.path.join(PKG, "SHA256SUMS"), encoding="utf-8"):
    if line.strip():
        h, n = line.split()
        sums[n.lstrip("*")] = h       # '*' is sha256sum's binary-mode marker, not part of the name
bad = [n for n, h in sums.items() if sha_bytes(io.open(os.path.join(PKG, n), "rb").read()) != h]
check("SHA256SUMS matches both files in the package", not bad and len(sums) == 2, bad or len(sums))

man = json.loads(io.open(pm, encoding="utf-8").read())
mod_list = json.loads(io.open(pl, encoding="utf-8").read())
base = json.loads(io.open(os.path.join(HERE, "base1101-install-manifest.json"), encoding="utf-8").read())
bml = json.loads(io.open(os.path.join(HERE, "base1101-modlist.json"), encoding="utf-8").read())
check("the local 1101 base copies still hash to 1101's staged files",
      sha_bytes(io.open(os.path.join(HERE, "base1101-install-manifest.json"), "rb").read()) == BASE_MANIFEST
      and sha_bytes(io.open(os.path.join(HERE, "base1101-modlist.json"), "rb").read()) == BASE_MODLIST)

# ---- counts -------------------------------------------------------------------------------------
check("mods %d -> %d (+%d)" % (len(base["mods"]), len(man["mods"]), NEW),
      len(man["mods"]) == len(base["mods"]) + NEW, len(man["mods"]))
check("archives %d -> %d (+%d)" % (len(base["archives"]), len(man["archives"]), NEW),
      len(man["archives"]) == len(base["archives"]) + NEW, len(man["archives"]))
check("plugins %d -> %d (+%d)" % (len(base["plugins"]), len(man["plugins"]), NEW),
      len(man["plugins"]) == len(base["plugins"]) + NEW, len(man["plugins"]))
check("order %d -> %d (+%d)" % (len(base["order"]), len(man["order"]), NEW),
      len(man["order"]) == len(base["order"]) + NEW, len(man["order"]))
check("modlist %d -> %d (+%d)" % (len(bml), len(mod_list), NEW), len(mod_list) == len(bml) + NEW,
      len(mod_list))
# NOT "one row per mod plus SkyMP Client": live's modlist is already one short of that, because
# "Orc Strongholds - All In One" has no modlist row at all (159 mods, 157 mod rows + 3 display-named
# rows + SkyMP Client). That gap predates this window - it means the mod never shows in the launcher's
# Modlist panel - and is reported rather than silently papered over. What must hold is that the list
# grew by exactly our 12 and nothing else moved.
gap = {m["name"] for m in base["mods"]} - {r["name"] for r in bml}
print("note: %d of 1101's mods have no same-named modlist row (%s); 3 use display names, so the real "
      "gap is any that remain" % (len(gap), ", ".join(sorted(gap))[:80]))
check("schema and game are untouched",
      man["schema"] == base["schema"] and man["game"] == base["game"])

# ---- nothing 1101 staged has moved --------------------------------------------------------------
check("every archive 1101 had is byte-identical and in the same order",
      json.dumps(man["archives"][:len(base["archives"])], sort_keys=True)
      == json.dumps(base["archives"], sort_keys=True))
check("every mod 1101 had is byte-identical and in the same order",
      json.dumps(man["mods"][:len(base["mods"])], sort_keys=True)
      == json.dumps(base["mods"], sort_keys=True))
check("the plugin list 1101 had is unchanged, in order",
      man["plugins"][:len(base["plugins"])] == base["plugins"])
check("the order list 1101 had is unchanged", man["order"][:len(base["order"])] == base["order"])
check("the modlist 1101 had is unchanged, in order",
      json.dumps(mod_list[:len(bml)], sort_keys=True) == json.dumps(bml, sort_keys=True))
check("root and rootHash are untouched",
      json.dumps(man["root"], sort_keys=True) == json.dumps(base["root"], sort_keys=True)
      and man["rootHash"] == base["rootHash"])

# ---- global consistency -------------------------------------------------------------------------
aid = [a["id"] for a in man["archives"]]
check("archive ids are unique across the whole manifest", len(set(aid)) == len(aid),
      len(aid) - len(set(aid)))
# `.get`, because live's manifest legitimately contains 76 INLINED files (BodySlide language files and
# the like) that carry `inline` instead of `archive`. A bare f["archive"] crashed here, which is why
# this is scoped rather than global.
check("every file that names an archive resolves to one",
      all(f.get("archive") in set(aid) for m in man["mods"] for f in m["files"] if "archive" in f))
check("the plugin list has no duplicates",
      len({p.lower() for p in man["plugins"]}) == len(man["plugins"]))
check("the order list has no duplicates", len(set(man["order"])) == len(man["order"]))
check("every mod name appears in order", {m["name"] for m in man["mods"]} <= set(man["order"]))
base_inl = sum(1 for m in base["mods"] for f in m["files"] if "inline" in f)
check("no NEW row is inlined (1101's base has %d inlined files, unchanged)" % base_inl,
      not any("inline" in f for m in man["mods"][len(base["mods"]):] for f in m["files"])
      and sum(1 for m in man["mods"] for f in m["files"] if "inline" in f) == base_inl)

# ---- the 12 new rows ----------------------------------------------------------------------------
new_mods = man["mods"][len(base["mods"]):]
new_arch = man["archives"][len(base["archives"]):]
new_plug = man["plugins"][len(base["plugins"]):]
new_ml = mod_list[len(bml):]
by_id = {a["id"]: a for a in man["archives"]}
allnew = [f for m in new_mods for f in m["files"]]
check("the 12 new archive ids continue past the old maximum",
      all(int(a["id"][1:]) > max(int(x["id"][1:]) for x in base["archives"]) for a in new_arch),
      [a["id"] for a in new_arch])
check("every new archive is nexus with ids matching Vortex's state",
      all(a["source"]["type"] == "nexus"
          and (int(IDS[os.path.splitext(a["name"])[0]]["modId"]),
               int(IDS[os.path.splitext(a["name"])[0]]["fileId"]))
          == (a["source"]["modId"], a["source"]["fileId"]) for a in new_arch))
check("nothing new is re-hosted (no url or manual source)",
      not any("url" in json.dumps(a["source"]) or a["source"].get("type") == "manual"
              for a in new_arch))
bad_h, bad_s = [], []
for a in new_arch:
    p = os.path.join(DOWNLOADS, a["name"])
    if not os.path.isfile(p):
        bad_h.append(a["name"])
        continue
    s, n = sha_size(p)
    if s != a["hash"]:
        bad_h.append(a["name"])
    if n != a["size"]:
        bad_s.append(a["name"])
check("every new archive's hash matches the download on disk", not bad_h, bad_h[:3])
check("every new archive's size matches the download on disk", not bad_s, bad_s[:3])
check("each new mod's files all point at one archive, and no two share one",
      len({tuple(sorted({f["archive"] for f in m["files"]})) for m in new_mods}) == NEW
      and all(len({f["archive"] for f in m["files"]}) == 1 for m in new_mods))
check("every new mod's fingerprint recomputes",
      all(m["hash"] == sha_bytes("\n".join(sorted("%s:%s" % (f["to"], f["sha256"])
                                                  for f in m["files"])).encode("utf-8"))
          for m in new_mods))
bad = [f["to"] for f in allnew
       if f["to"].startswith(("/", "\\")) or ".." in f["to"].split("/") or "\\" in f["to"]
       or re.match(r"^[A-Za-z]:", f["to"])]
check("every new 'to' is a relative forward-slash path with no '..'", not bad, bad[:4])
check("every new 'to' is unique within its mod",
      all(len({f["to"].lower() for f in m["files"]}) == len(m["files"]) for m in new_mods))

# plugins, and the ESL rule
plug_files = sorted(f["to"].lower() for f in allnew
                    if f["to"].lower().endswith((".esp", ".esm", ".esl")))
check("the 12 new mods deliver exactly 12 plugins, one each", len(plug_files) == NEW, plug_files)
check("NO .esl is delivered by any new row",
      not [p for p in plug_files if p.endswith(".esl")], [p for p in plug_files if p.endswith(".esl")])
check("every new plugin sits at the top level of Data", all("/" not in p for p in plug_files))
check("the 12 appended plugin entries are exactly those files",
      sorted(p.lstrip("*").lower() for p in new_plug) == plug_files,
      sorted(set(p.lstrip("*").lower() for p in new_plug) ^ set(plug_files))[:4])
# The sequence, not just the set. `plugins` becomes the client's Plugins.txt, and form ids are
# `plugin index << 24 | local id`, so an order that disagrees with the server's shifts every id in the
# later plugins on one side only. The first build appended them in folder-name order, which is not the
# order they load in; this is the dev box's measured loadorder.txt 158-168, Colossus last.
WANT_ORDER = ["*mihaildeadrapack.esp", "*mihailicetitansandseagiants.esp",
              "*mihailskeletalrevenants.esp", "*mihailgrahlsandfrostgiants.esp",
              "*mihailgiantfamily.esp", "*mihailundeadsnowelf.esp",
              "*mihailvampirelordsandbeasts.esp", "*mihailfleshatronach.esp",
              "*mihailnordicsentinel.esp", "*mihailhiveguardians.esp",
              "*mihailelementalgolems.esp", "*1FleshColossus.esp"]
check("the 12 plugins are appended in the dev box's measured load order", new_plug == WANT_ORDER,
      [(a, b) for a, b in zip(new_plug, WANT_ORDER) if a != b][:3])
# each new mod, in sequence, must be the one delivering the plugin at the same position - so the mods
# list, the order list and the plugin list all tell the same story
seq_ok, seq_bad = True, []
for i, want in enumerate(WANT_ORDER):
    plug = [f["to"] for f in new_mods[i]["files"]
            if f["to"].lower().endswith((".esp", ".esm", ".esl"))]
    if plug != [want.lstrip("*")]:
        seq_ok = False
        seq_bad.append((i, want, plug))
check("mod i delivers plugin i, so mods, order and plugins agree", seq_ok, seq_bad[:3])
check("the order list's new entries are the new mods' names, in the same sequence",
      [m["name"] for m in new_mods] == man["order"][len(base["order"]):],
      list(zip([m["name"] for m in new_mods], man["order"][len(base["order"]):]))[:2])
check("the Minotaur plugin is still the last of 1101's and ours follow it",
      base["plugins"][-1] == "*mihailmmaminotaur.esp"
      and man["plugins"][len(base["plugins"]) - 1] == "*mihailmmaminotaur.esp")
check("Flesh Colossus's plugin is delivered from the archive's esp/ folder",
      any(f["to"] == "1FleshColossus.esp" and f["from"].lower().endswith("esp/1fleshcolossus.esp")
          for f in allnew))
check("every new modlist row is nexus with the mod's own id, required and enabled",
      all(r["source"] == "nexus" and r["required"] and r["enabled"] for r in new_ml)
      and sorted(r["nexusId"] for r in new_ml) == sorted(m["modId"] for m in new_mods))
check("no new modlist name collides with an existing one",
      not ({r["name"] for r in new_ml} & {r["name"] for r in bml}))

# ---- every new 'from' is in its archive, at the size claimed ------------------------------------
missing, wrong = [], []
for m in new_mods:
    a = by_id[m["files"][0]["archive"]]
    sizes = listing(os.path.join(DOWNLOADS, a["name"]))
    for f in m["files"]:
        if f["from"] not in sizes:
            missing.append((a["name"][:30], f["from"]))
        elif sizes[f["from"]] != f["size"]:
            wrong.append((f["to"], sizes[f["from"]], f["size"]))
check("every new 'from' exists in its archive's listing", not missing, missing[:3])
check("every new row's size equals its archive entry's size (all %d rows)" % len(allnew),
      not wrong, wrong[:3])

# ---- extract and hash ---------------------------------------------------------------------------
print()
print("extracting up to %d file(s) per new mod and hashing them out of the real archive:" % NSAMPLE)
bad_x, n_x = [], 0
for m in new_mods:
    fs = sorted(m["files"], key=lambda f: -f["size"])
    a = by_id[fs[0]["archive"]]
    pick, seen = [], set()
    for f in [fs[0]] + [x for x in fs if x["to"].lower().endswith((".esp", ".esm", ".esl"))] + [fs[-1]]:
        if f["to"] not in seen:
            seen.add(f["to"])
            pick.append(f)
    tmp = tempfile.mkdtemp(prefix="v1102-")
    try:
        for f in pick[:NSAMPLE]:
            subprocess.run([SEVEN, "e", os.path.join(DOWNLOADS, a["name"]), "-o" + tmp, "-y",
                            "-sccUTF-8", f["from"]], capture_output=True, timeout=900)
            got = os.path.join(tmp, os.path.basename(f["from"]))
            if not os.path.isfile(got):
                bad_x.append((m["name"][:26], f["from"], "not extracted"))
                continue
            s, nn = sha_size(got)
            n_x += 1
            ok = (s, nn) == (f["sha256"], f["size"])
            if not ok:
                bad_x.append((m["name"][:26], f["to"], "sha/size differ"))
            os.remove(got)
            print("     %-28s %-44s %s" % (m["name"][:28], f["to"][-44:], "ok" if ok else "MISMATCH"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
check("every extracted sample matches its sha256 and size (%d files)" % n_x, not bad_x, bad_x[:3])

print()
print("=" * 78)
print("%d mods, %d archives, %d plugins, modlist %d; %d new directives, %.2f GB"
      % (len(man["mods"]), len(man["archives"]), len(man["plugins"]), len(mod_list), len(allnew),
         sum(f["size"] for f in allnew) / 1073741824.0))
print("%d checks failed" % len(fails) if fails else "every check passed")
sys.exit(1 if fails else 0)
