# Record-level diff of two versions of a plugin. Read-only.
#
#   py -I server/tooling/plugdiff.py <old.esp> <new.esp>
#
# Use this before installing any xEdit save, and before shipping a Creation Kit pass.
#
# Why it exists: an xEdit or CK save re-serialises the whole file, so a byte compare proves nothing,
# and `comparesave.py` - the other tool for this - compares records by EDITOR ID and references only
# as counts per base object. That makes it blind to the exact change our passes make most often: a
# reference that was moved, disabled or re-pointed without any record being added or removed. An
# xEdit re-save of the DLE has previously rewritten 93 unrelated records (one DESC edit, 90 empty
# effects on DBO_Skill markers) and a CK save has silently dropped 29 of 122 LAND overrides. Both
# would show here and neither shows there. Run both: this one for what changed, comparesave.py for
# what was added or lost by name.
#
# It hashes each record's payload and keys on the FULL raw form id, never `fid & 0xFFFFFF` - two
# records in one plugin can share a local id under different masters (the DLE holds arnima 0E085EA1
# and BSAssets 06085EA1), and keying on the local id silently keeps only one of them.
#
# A changed master list is reported first and is a stop sign: it renumbers every record's master
# index, so every id below becomes incomparable and the whole diff is noise.
import sys, os, hashlib

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "ck-mcp"))
from esplib import Plugin

INTENDED = 8  # a hand-made pass touches a handful of records; more than this wants explaining


def load(path):
    p = Plugin(path)
    out = {}
    with open(path, "rb") as fh:
        for sig, fid, fl, off, sz, ctx in p.index:
            out[(sig, fid)] = (hashlib.md5(p.data_at(fh, off, sz, fl)).hexdigest()[:12], fl, sz)
    return p, out


def main(oldpath, newpath):
    op, old = load(oldpath)
    np_, new = load(newpath)
    print("old: %-52s %6d records" % (os.path.basename(oldpath)[:52], len(old)))
    print("new: %-52s %6d records" % (os.path.basename(newpath)[:52], len(new)))

    same_masters = [m.lower() for m in op.masters] == [m.lower() for m in np_.masters]
    print("masters: old %d, new %d  ->  %s"
          % (len(op.masters), len(np_.masters), "same" if same_masters else "DIFFERENT"))
    if not same_masters:
        for m in np_.masters:
            if m.lower() not in [x.lower() for x in op.masters]:
                print("    new ADDS master:  %s" % m)
        for m in op.masters:
            if m.lower() not in [x.lower() for x in np_.masters]:
                print("    new DROPS master: %s" % m)
        print("\n  STOP. A different master list renumbers the master index of every form id, so the\n"
              "  record ids below do not line up and the counts mean nothing. Compare against a copy\n"
              "  with the same masters, or diff canonically instead.")

    added = sorted(set(new) - set(old))
    removed = sorted(set(old) - set(new))
    changed = sorted(k for k in set(old) & set(new) if old[k][0] != new[k][0])

    print("\nadded   %d" % len(added))
    for sig, fid in added[:30]:
        print("   + %-5s %08X  flags %d" % (sig, fid, new[(sig, fid)][1]))
    if len(added) > 30:
        print("   ... and %d more" % (len(added) - 30))
    print("removed %d" % len(removed))
    for sig, fid in removed[:30]:
        print("   - %-5s %08X" % (sig, fid))
    if len(removed) > 30:
        print("   ... and %d more" % (len(removed) - 30))
    print("changed %d" % len(changed))
    for sig, fid in changed[:40]:
        print("   ~ %-5s %08X  flags %d -> %d  size %d -> %d"
              % (sig, fid, old[(sig, fid)][1], new[(sig, fid)][1], old[(sig, fid)][2], new[(sig, fid)][2]))
    if len(changed) > 40:
        print("   ... and %d more" % (len(changed) - 40))

    total = len(added) + len(removed) + len(changed)
    print("\n%d records differ." % total)
    if not same_masters:
        print("VERDICT: masters differ - this diff is not meaningful. See the stop note above.")
    elif total == 0:
        print("VERDICT: identical at record level.")
    elif total <= INTENDED:
        print("VERDICT: a small, reviewable set. Check every id above is one you meant to touch.")
    else:
        print("VERDICT: %d is more than a hand-made pass should touch. Account for every record\n"
              "         before installing, or rebuild the change numerically instead of shipping\n"
              "         the editor's file." % total)
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__ or "usage: plugdiff.py <old.esp> <new.esp>")
    sys.exit(main(sys.argv[1], sys.argv[2]))
