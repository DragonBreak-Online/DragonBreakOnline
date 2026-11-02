r"""Merge window-1102's 12 rows onto window-1101's staged manifest and write the launcher-1102 package.

**The base is NOT live.** Live's `install-manifest.json` is still `7b6ab814` / 158 mods / 128 plugins -
exactly `hook-1101`'s `BASE_MANIFEST` - so **window-1101's launcher step has not been applied yet**.
Building on live would make the two steps collide: each hook checks its base sha, so whichever ran
second would refuse. So this merges onto W7's staged output,
`~/claude-nate-release/w1101/launcher-1101/backend-data/`:

    install-manifest.json  62871f74…  159 mods, 160 archives, 129 plugins, order 159
    modlist.json           a35742ec…  159 entries

and hook-1102 must therefore assert those two shas as its base, which chains cleanly after 1101.
If 1101 is abandoned or re-staged, this has to be rebuilt on whatever it produces.

Rows follow the precedent of W7's Minotaurs row: archive ids continue after the highest live id, mod
`name` is the Vortex folder, `modId` is the real Nexus id, the plugin is appended to `plugins` (live's
list already ends with `*mihailmmaminotaur.esp`, and W5 asked for these after it), and `modlist.json`
gets a readable display name, as the three most recent hand-added rows do.

    py -I merge_1102.py <rows.json> <out package dir>
"""
import hashlib
import io
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
ROWS = sys.argv[1]
PKG = sys.argv[2]
BASE_MANIFEST = "62871f7462f1ed418b20d1b1ae56f88a1a661cfd8512a5b52bea4f6f152133dc"
BASE_MODLIST = "a35742ec06520961db77df232732efb08009af6ee361cf31aaf410e1a1ea6f27"


def sha(b):
    return hashlib.sha256(b).hexdigest()


mraw = io.open(os.path.join(HERE, "base1101-install-manifest.json"), "rb").read()
lraw = io.open(os.path.join(HERE, "base1101-modlist.json"), "rb").read()
if sha(mraw) != BASE_MANIFEST or sha(lraw) != BASE_MODLIST:
    raise SystemExit("the local base copies are not 1101's staged files; re-fetch them")
man = json.loads(mraw.decode("utf-8"))
mod_list = json.loads(lraw.decode("utf-8"))
rows = json.load(io.open(ROWS, encoding="utf-8"))

base_mods, base_arch = len(man["mods"]), len(man["archives"])
base_plug, base_order, base_ml = len(man["plugins"]), len(man["order"]), len(mod_list)
print("base 1101: %d mods, %d archives, %d plugins, order %d, modlist %d"
      % (base_mods, base_arch, base_plug, base_order, base_ml))
if (base_mods, base_arch, base_plug, base_order, base_ml) != (159, 160, 129, 159, 159):
    raise SystemExit("1101's base is not the 159/160/129/159/159 shape this was written for")
if man["plugins"][-1] != "*mihailmmaminotaur.esp":
    raise SystemExit("1101's plugin list does not end with the Minotaur plugin: %r"
                     % man["plugins"][-1])

# keep a copy of every pre-existing row so the verifier can prove none of them moved
before = {"archives": json.dumps(man["archives"], sort_keys=True),
          "mods": json.dumps(man["mods"], sort_keys=True),
          "plugins": list(man["plugins"]), "order": list(man["order"]),
          "modlist": json.dumps(mod_list, sort_keys=True),
          "root": json.dumps(man["root"], sort_keys=True), "rootHash": man["rootHash"]}

# THE APPEND SEQUENCE IS THE LOAD ORDER, and it is not the build order.
# `plugins` is what the client's Plugins.txt becomes, and form ids are `plugin index << 24 | local id`,
# so if this list disagrees with the server's own order every id in the later plugins shifts on one side
# only - the AlternateHighPolyHead bug that spawned every player in Riverwood. build_rows.py emits the
# 12 sorted by folder name, which is NOT the order they load in; these are the dev box's measured
# loadorder.txt lines 158-168, with Flesh Colossus last as W5 asked.
LOAD_ORDER = ["mihaildeadrapack.esp", "mihailicetitansandseagiants.esp", "mihailskeletalrevenants.esp",
              "mihailgrahlsandfrostgiants.esp", "mihailgiantfamily.esp", "mihailundeadsnowelf.esp",
              "mihailvampirelordsandbeasts.esp", "mihailfleshatronach.esp", "mihailnordicsentinel.esp",
              "mihailhiveguardians.esp", "mihailelementalgolems.esp", "1FleshColossus.esp"]
by_plugin = {m["_plugin"]: m for m in rows["mods"]}
if sorted(by_plugin) != sorted(LOAD_ORDER):
    raise SystemExit("the rows and the load order name different plugins: %r"
                     % sorted(set(by_plugin) ^ set(LOAD_ORDER)))
ordered = [by_plugin[p] for p in LOAD_ORDER]

# archive ids continue after the highest id already present, not after len(archives): live has gaps
# where merge_manifest dropped unreferenced archives, so counting would collide with an existing id.
nxt = max(int(a["id"][1:]) for a in man["archives"]) + 1
by_hash = {a["hash"]: a["id"] for a in man["archives"]}
remap, added_arch = {}, []
# archives are appended in the same sequence as the mods below, so a164 is the first plugin to load and
# a175 the last. Purely for legibility on review - the id is a key, not an order - but a reviewer should
# not have to cross-reference to see that the two lists agree.
arch_pos = {m["files"][0]["archive"]: i for i, m in enumerate(ordered)}
for a in sorted(rows["archives"], key=lambda x: arch_pos.get(x["id"], 99)):
    if a["hash"] in by_hash:             # the same download is already delivered: reuse its id
        remap[a["id"]] = by_hash[a["hash"]]
        print("  archive %s reuses existing %s (same hash)" % (a["name"][:40], remap[a["id"]]))
        continue
    remap[a["id"]] = "a%d" % nxt
    nxt += 1
    new = {"id": remap[a["id"]], "hash": a["hash"], "size": a["size"], "name": a["name"],
           "source": a["source"]}
    man["archives"].append(new)
    added_arch.append(new)

added_mods, added_plug, added_ml = [], [], []
for m in ordered:
    mod = {"name": m["name"], "modId": m["modId"],
           "files": [{"to": f["to"], "archive": remap[f["archive"]], "from": f["from"],
                      "sha256": f["sha256"], "size": f["size"]} for f in m["files"]],
           "hash": m["hash"]}
    man["mods"].append(mod)
    man["order"].append(m["name"])
    man["plugins"].append("*" + m["_plugin"])
    mod_list.append({"name": m["_display"], "required": True, "enabled": True,
                     "source": "nexus", "nexusId": m["modId"]})
    added_mods.append(mod)
    added_plug.append("*" + m["_plugin"])
    added_ml.append(mod_list[-1])

# the fingerprint must survive the archive-id remap: it covers to+sha256 only, so it should be
# unchanged from the rows file. Asserted rather than recomputed, so a remap bug cannot hide.
for m, src in zip(added_mods, ordered):   # `ordered`, not rows: added_mods is in load order now
    fp = sha("\n".join(sorted("%s:%s" % (f["to"], f["sha256"]) for f in m["files"])).encode("utf-8"))
    if fp != src["hash"]:
        raise SystemExit("%s: fingerprint changed in the merge" % m["name"])

n = len(rows["mods"])
print("added %d mods, %d archives (%d reused), %d plugins, %d modlist rows"
      % (n, len(added_arch), n - len(added_arch), len(added_plug), len(added_ml)))

# nothing pre-existing may have moved
if (json.dumps(man["archives"][:base_arch], sort_keys=True) != before["archives"]
        or json.dumps(man["mods"][:base_mods], sort_keys=True) != before["mods"]
        or man["plugins"][:base_plug] != before["plugins"]
        or man["order"][:base_order] != before["order"]
        or json.dumps(mod_list[:base_ml], sort_keys=True) != before["modlist"]
        or json.dumps(man["root"], sort_keys=True) != before["root"]
        or man["rootHash"] != before["rootHash"]):
    raise SystemExit("a pre-existing row changed during the merge")
print("every pre-existing row is unchanged (%d archives, %d mods, %d plugins, %d order, %d modlist)"
      % (base_arch, base_mods, base_plug, base_order, base_ml))

# `builtAt` is left as 1101's on purpose: this is 1101's manifest plus rows, and changing it would
# make the diff against 1101's package look bigger than it is. The launcher does not read it.
os.makedirs(os.path.join(PKG, "backend-data"), exist_ok=True)
out_m = os.path.join(PKG, "backend-data", "install-manifest.json")
out_l = os.path.join(PKG, "backend-data", "modlist.json")
io.open(out_m, "w", encoding="utf-8", newline="").write(json.dumps(man))
io.open(out_l, "w", encoding="utf-8", newline="").write(json.dumps(mod_list, indent=2) + "\n")

sums = []
for p in (out_m, out_l):
    h = sha(io.open(p, "rb").read())
    sums.append("%s *backend-data/%s" % (h, os.path.basename(p)))
    print("  %s  %s (%d bytes)" % (h[:16], os.path.basename(p), os.path.getsize(p)))
io.open(os.path.join(PKG, "SHA256SUMS"), "w", encoding="utf-8", newline="\n").write(
    "\n".join(sums) + "\n")

print()
print("new totals: %d mods, %d archives, %d plugins, order %d, modlist %d"
      % (len(man["mods"]), len(man["archives"]), len(man["plugins"]), len(man["order"]),
         len(mod_list)))
print("last plugin: %r" % man["plugins"][-1])
json.dump({"baseManifest": BASE_MANIFEST, "baseModlist": BASE_MODLIST,
           "newManifest": sha(io.open(out_m, "rb").read()),
           "newModlist": sha(io.open(out_l, "rb").read()),
           "mods": len(man["mods"]), "archives": len(man["archives"]),
           "plugins": len(man["plugins"]), "order": len(man["order"]), "modlist": len(mod_list),
           "addedPlugins": added_plug,
           "addedArchiveIds": [a["id"] for a in added_arch]},
          io.open(os.path.join(PKG, "assertions.json"), "w", encoding="utf-8", newline="\n"), indent=1)
print("wrote %s" % PKG)
