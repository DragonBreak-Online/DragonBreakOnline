r"""Report every path the fragment delivers that something else also delivers.

The pipeline normally resolves conflicts by observation: it ships only each mod's files that win in the
dev Data folder. These 11 were never deployed, so there is nothing to observe, and the conflicts have to
be listed for a human instead of silently resolved. Two kinds:

  within   two or more of the 11 deliver the same path. The launcher installs them in `order`, so the
           later mod wins. Identical content makes it moot; differing content is a real decision.
  vs live  live's manifest already delivers the path. The 11 are appended last, so the 11 would win -
           which is right for mods added at the bottom of the priority list, but it must be seen.

The live side is read from the LOCAL copy of live's manifest (_work\skyrim-release\live-install-manifest
.json, taken 14 Oct), which is NOT known current - that is exactly why the Leader asked for a fragment
rather than a merge. So the live overlap is indicative; W5 re-checks it against live's real manifest at
merge time. The within-the-11 half does not depend on that copy and is exact.

    py -I conflicts.py <fragment.json>
"""
import collections
import io
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.join(r"E:\DragonBreak Online Dev files", "_work", "skyrim-release",
                    "live-install-manifest.json")
frag = json.load(io.open(sys.argv[1], encoding="utf-8"))
mods = frag["mods"]
short = {m["name"]: m["name"].split("-")[0].strip() for m in mods}

# ---- within the 11 -------------------------------------------------------------------------------
own = collections.defaultdict(list)
for m in mods:
    for f in m["files"]:
        own[f["to"].lower()].append((short[m["name"]], f["sha256"], f["size"]))
within = {k: v for k, v in own.items() if len(v) > 1}
same = {k: v for k, v in within.items() if len({x[1] for x in v}) == 1}
diff = {k: v for k, v in within.items() if len({x[1] for x in v}) > 1}
print("WITHIN THE 11")
print("  %d paths delivered by more than one of the 11" % len(within))
print("  %d of those are byte-identical (harmless - whichever wins installs the same bytes)" % len(same))
print("  %d differ, so the later mod in `order` decides:" % len(diff))
for k in sorted(diff)[:40]:
    print("    %s" % k)
    for name, sha, size in sorted(diff[k]):
        print("        %-34s %s %9d" % (name[:34], sha[:12], size))
if len(diff) > 40:
    print("    ... and %d more (full list in the json)" % (len(diff) - 40))
by_pair = collections.Counter()
for v in same.values():
    for a in range(len(v)):
        for b in range(a + 1, len(v)):
            by_pair[tuple(sorted((v[a][0], v[b][0])))] += 1
if by_pair:
    print("  identical-file overlap by pair (top 10):")
    for (a, b), n in by_pair.most_common(10):
        print("    %5d  %s  <->  %s" % (n, a[:30], b[:30]))

# ---- against live --------------------------------------------------------------------------------
print()
print("AGAINST LIVE (local copy, 14 Oct - indicative only, W5 re-checks at merge)")
if not os.path.isfile(LIVE):
    print("  live manifest copy not found: %s" % LIVE)
    live_hit = {}
else:
    live = json.load(io.open(LIVE, encoding="utf-8"))
    live_by = {}
    for m in live["mods"]:
        for f in m["files"]:
            live_by.setdefault(f["to"].lower(), []).append((m["name"], f.get("sha256")))
    live_hit = {k: v for k, v in own.items() if k in live_by}
    ident = [k for k in live_hit if {x[1] for x in own[k]} <= {s for _, s in live_by[k]}]
    print("  live manifest: %d mods, %d directives" % (len(live["mods"]),
                                                       sum(len(m["files"]) for m in live["mods"])))
    print("  %d of the fragment's %d paths are also delivered by live"
          % (len(live_hit), len(own)))
    print("  %d of those are byte-identical to live's copy" % len(ident))
    real = sorted(set(live_hit) - set(ident))
    print("  %d differ from live, so adding the 11 last would change what is installed:" % len(real))
    for k in real[:40]:
        print("    %s" % k)
        for name, sha in live_by[k][:2]:
            print("        live  %-30s %s" % (name[:30], (sha or "?")[:12]))
        for name, sha, _ in sorted(own[k]):
            print("        ours  %-30s %s" % (name[:30], sha[:12]))
    if len(real) > 40:
        print("    ... and %d more (full list in the json)" % (len(real) - 40))

out = os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), "mihail-conflicts.json")
io.open(out, "w", encoding="utf-8", newline="\n").write(json.dumps(
    {"withinIdentical": {k: v for k, v in sorted(same.items())},
     "withinDiffering": {k: v for k, v in sorted(diff.items())},
     "alsoInLiveLocalCopy": {k: v for k, v in sorted(live_hit.items())}}, indent=1) + "\n")
print()
print("wrote %s" % out)
