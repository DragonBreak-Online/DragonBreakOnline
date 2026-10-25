"""Resolve the live DLE a check should compare against, and refuse to guess.

A gate is only as good as its baseline. On 25 Oct a run of the ship gate was pointed at the PC's dev
Data copy, which by then held an unshipped build, so it compared a candidate against an already-newer
file and reported 8 added / 0 changed instead of the real 33 / 13. Nothing was wrong with the tools:
the baseline was chosen by hand and assumed. This module removes the choice.

It resolves a baseline and then VERIFIES it, refusing on any mismatch rather than carrying on:

  * the path from $DBO_LIVE_DLE, if set;
  * else /opt/skyrim-data, the installed copy on the game server;
  * else the newest _release/live-DLE-<date>-<prefix> reference copy kept on the PC.

The expected hash comes from the SHA256SUMS beside the file when there is one, and otherwise from the
prefix in the reference copy's folder name. **A file that disagrees with the manifest beside it is a
refusal, not a warning**: on 25 Oct the dev server's copy was replaced without its SHA256SUMS being
updated, so the two disagreed, and a check that trusted the manifest there would have been measuring
one file against another file's hash.

    from live_baseline import resolve
    path, sha, note = resolve()                 # or resolve('/some/explicit/path.esp')
"""
import glob
import hashlib
import os

DLE = "DragonBreak Online Edits.esp"
INSTALLED = "/opt/skyrim-data"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _manifest_hash(path):
    """The hash SHA256SUMS beside `path` records for it, or None when there is no manifest."""
    manifest = os.path.join(os.path.dirname(path), "SHA256SUMS")
    if not os.path.isfile(manifest):
        return None
    want = os.path.basename(path).lower()
    with open(manifest, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            parts = line.split(None, 1)
            if len(parts) == 2 and parts[1].strip().lstrip("*").lower() == want:
                return parts[0].strip().lower()
    return None


def _reference_copies(start):
    """_release/live-DLE-<date>-<prefix>/ copies, newest folder name first."""
    root = os.path.abspath(start)
    for _ in range(5):
        found = sorted(glob.glob(os.path.join(root, "_release", "live-DLE-*", DLE)), reverse=True)
        if found:
            return found
        parent = os.path.dirname(root)
        if parent == root:
            break
        root = parent
    return []


def _expected_for(path):
    """(expected hash, where it came from). The manifest wins; else the folder name's prefix."""
    recorded = _manifest_hash(path)
    if recorded:
        return recorded, "the SHA256SUMS beside it"
    folder = os.path.basename(os.path.dirname(path))
    prefix = folder.rsplit("-", 1)[-1].lower()
    if folder.lower().startswith("live-dle-") and len(prefix) >= 8 and all(c in "0123456789abcdef" for c in prefix):
        return prefix, "the prefix in the folder name %s" % folder
    return None, "nothing: no manifest and no hash in the folder name"


def resolve(explicit=None, start=None):
    """-> (path, sha256, note). Raises SystemExit naming both hashes when a baseline cannot be trusted."""
    start = start or os.path.dirname(os.path.abspath(__file__))
    candidates = []
    if explicit:
        candidates.append(explicit)
    else:
        env = os.environ.get("DBO_LIVE_DLE")
        if env:
            candidates.append(env)
        candidates.append(os.path.join(INSTALLED, DLE))
        # From the module's own location and from where the tool was run: a git worktree puts the
        # former somewhere with no _release beside it, and the latter is usually the repo root.
        for root in (start, os.getcwd()):
            for found in _reference_copies(root):
                if found not in candidates:
                    candidates.append(found)

    for path in candidates:
        if not os.path.isfile(path):
            continue
        actual = sha256(path)
        expected, source = _expected_for(path)
        if expected is None:
            raise SystemExit(
                "live baseline cannot be trusted: %s\n"
                "  its sha256 is %s and there is %s to check it against.\n"
                "  Pass the baseline explicitly, or set DBO_LIVE_DLE, once you know which build it is."
                % (path, actual, source))
        if not actual.startswith(expected) and not expected.startswith(actual):
            raise SystemExit(
                "live baseline does not match what is recorded for it, so this check would measure\n"
                "a candidate against the wrong file. Refusing.\n"
                "  file     %s\n"
                "  sha256   %s\n"
                "  recorded %s  (from %s)\n"
                "  Either that file is not the build it claims to be, or the record is stale."
                % (path, actual, expected, source))
        return path, actual, "%s, verified against %s" % (path, source)

    raise SystemExit(
        "no live DLE baseline found. Looked for $DBO_LIVE_DLE, %s, and _release/live-DLE-*/ above %s.\n"
        "Pass one explicitly rather than letting a check pick a file."
        % (os.path.join(INSTALLED, DLE), start))
