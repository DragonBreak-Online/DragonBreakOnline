r"""Break the fragment on purpose, one defect at a time, and require verify_fragment.py to catch each.

A verifier that has only ever seen a good input proves nothing. Each mutant below introduces exactly one
realistic defect - the kinds a hand-built manifest actually ships with - and must make the verifier exit
non-zero, with the named check among the failures. A mutant the verifier passes is a hole, and is printed
as HOLE.

Mutants run against the one-mod pilot fragment (EXPECT=1), so each full run - archive rehash, listing and
extraction included - costs seconds rather than minutes. The same code paths execute.

    py -I mutate_fragment.py <pilot fragment.json>
"""
import copy
import io
import json
import os
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
BASE = json.load(io.open(sys.argv[1], encoding="utf-8"))


def flip_hex(s):
    """Change one hex digit, keeping the string a valid 64-char sha - a wrong hash, not a malformed one,
    so the structural shape checks cannot catch it and the content checks have to."""
    c = "f" if s[0] != "f" else "0"
    return c + s[1:]


def biggest(f):
    """The largest file, which is always in the extraction sample - so a content mutant here really
    exercises the extract-and-hash check rather than only the cheap structural ones."""
    return max(f["mods"][0]["files"], key=lambda x: x["size"])


def nested(f):
    """A file whose 'to' has a directory in it. The first file in the list is the plugin, at the top
    level, so mutating its separators was a silent no-op - the first version of this mutant tested
    nothing and reported a verifier hole that did not exist."""
    return next(x for x in f["mods"][0]["files"] if "/" in x["to"])


def m_sha(f):
    biggest(f)["sha256"] = flip_hex(biggest(f)["sha256"])


def m_size(f):
    biggest(f)["size"] += 1


def m_size_unsampled(f):
    """A wrong size on a file the sample will not reach: only the all-rows archive-size cross-check
    can see this one, and mod.hash cannot (it covers to+sha256 only)."""
    nested(f)["size"] += 1


def m_from(f):
    f["mods"][0]["files"][0]["from"] = "Nowhere/in/the/archive.dds"


def m_archive_hash(f):
    f["archives"][0]["hash"] = flip_hex(f["archives"][0]["hash"])


def m_archive_size(f):
    f["archives"][0]["size"] += 4096


def m_mod_hash(f):
    f["mods"][0]["hash"] = flip_hex(f["mods"][0]["hash"])


def m_to_absolute(f):
    f["mods"][0]["files"][0]["to"] = "C:/Windows/System32/evil.dll"


def m_to_traversal(f):
    f["mods"][0]["files"][0]["to"] = "../../../outside.dds"


def m_to_backslash(f):
    x = nested(f)
    x["to"] = x["to"].replace("/", "\\")


def m_to_duplicate(f):
    f["mods"][0]["files"][1]["to"] = f["mods"][0]["files"][0]["to"]


def m_modid(f):
    f["archives"][0]["source"]["modId"] += 1


def m_fileid(f):
    f["archives"][0]["source"]["fileId"] += 1


def m_rehost(f):
    f["archives"][0]["source"] = {"type": "url", "url": "https://example.invalid/mod.rar"}


def m_inline(f):
    f["mods"][0]["files"][0] = {"to": f["mods"][0]["files"][0]["to"], "inline": "QUJD",
                                "sha256": f["mods"][0]["files"][0]["sha256"],
                                "size": f["mods"][0]["files"][0]["size"]}


def m_dangling_archive(f):
    f["mods"][0]["files"][0]["archive"] = "m99"


def m_plugin_sha(f):
    for x in f["mods"][0]["files"]:
        if x["to"].lower().endswith(".esp"):
            x["sha256"] = flip_hex(x["sha256"])
            break


def m_plugin_dropped(f):
    f["mods"][0]["files"] = [x for x in f["mods"][0]["files"]
                             if not x["to"].lower().endswith(".esp")]


def m_schema(f):
    f["schema"] = 1


MUTANTS = [
    ("a file's sha256 is wrong", m_sha, "extracted sample"),
    ("a file's size is wrong", m_size, "extracted sample"),
    ("a size is wrong on an unsampled file", m_size_unsampled, "archive entry's size"),
    ("a 'from' path is not in the archive", m_from, "exists in its archive"),
    ("an archive hash is wrong", m_archive_hash, "archive hash matches"),
    ("an archive size is wrong", m_archive_size, "archive size matches"),
    ("a mod's fingerprint does not match its files", m_mod_hash, "mod hash recomputes"),
    ("a 'to' is an absolute Windows path", m_to_absolute, "relative forward-slash"),
    ("a 'to' escapes the Data folder with ..", m_to_traversal, "relative forward-slash"),
    ("a 'to' uses backslashes", m_to_backslash, "relative forward-slash"),
    ("two files in one mod share a 'to'", m_to_duplicate, "unique within every mod"),
    ("a modId does not match Vortex's state", m_modid, "matches Vortex's own state"),
    ("a fileId does not match Vortex's state", m_fileid, "matches Vortex's own state"),
    ("an archive is re-hosted at a url", m_rehost, "nothing re-hosted"),
    ("a file is base64-inlined", m_inline, "no file is inlined"),
    ("a file points at an archive that does not exist", m_dangling_archive, "archive id exists"),
    ("a plugin's sha does not match dev's SHA256SUMS", m_plugin_sha, "SHA256SUMS"),
    ("a mod delivers no plugin at all", m_plugin_dropped, "plugin"),
    ("the schema is not 2", m_schema, "schema is 2"),
]

tmp = os.path.join(HERE, "mutants")
os.makedirs(tmp, exist_ok=True)
env = dict(os.environ, EXPECT=str(len(BASE["mods"])))
holes = []
print("%d mutants, each must make the verifier fail\n" % len(MUTANTS))
for name, fn, want in MUTANTS:
    f = copy.deepcopy(BASE)
    fn(f)
    p = os.path.join(tmp, "mutant.json")
    io.open(p, "w", encoding="utf-8", newline="\n").write(json.dumps(f) + "\n")
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "verify_fragment.py"), p, "1"],
                       capture_output=True, env=env, timeout=1800)
    out = r.stdout.decode("utf-8", "replace")
    caught = [l for l in out.splitlines() if l.startswith("FAIL")]
    hit = any(want.lower() in l.lower() for l in caught)
    if r.returncode != 0 and hit:
        status = "caught"
    elif r.returncode != 0:
        status = "caught by the WRONG check"
        holes.append((name, "expected %r, got %s" % (want, [l[5:] for l in caught][:2])))
    else:
        status = "HOLE - verifier passed it"
        holes.append((name, "not caught at all"))
    print("  %-46s %-26s %s" % (name[:46], status, ([l[5:].strip()[:40] for l in caught][:1] or [""])[0]))

print()
print("=" * 78)
if holes:
    print("%d hole(s):" % len(holes))
    for n, why in holes:
        print("   %-46s %s" % (n[:46], why))
else:
    print("every mutant was caught by the check meant to catch it")
sys.exit(1 if holes else 0)
