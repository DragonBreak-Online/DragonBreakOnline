"""Rewrite moved numeric form ids in the gamemode's JSON files after a load-order change. Dry run unless --write; with
--write each changed file is backed up first as <file>.bak-loadorder-<stamp>.
    py tools/fix-numeric-ids.py <old settings> <new settings> [--write] [--int-path <file>:<regex>]... <file.json>...

Two passes:
1. Tokens, kept in the file's own format: every quoted "0x..." hex string and quoted 7-10 digit string (values and keys:
   startPoints[].worldOrCell, economy.json overdue keys, name-table.json races keys, tenancy.json listing keys).
2. Bare integers and hex keys, only at the paths in INT_PATHS / HEX_KEY_PATHS (by file name). A bare integer is too often
   not an id (milliseconds, byte counts, prices), so a path is listed here only after reading the code that writes it:
     housing.json  []                  the housing registry: property ref ids (housingSystem.ts REGISTRY_FILE)
     tenancy.json  .listings.*.door    the listed house's door ref (tenancy.js)
     tenancy.json  .listings keys      the same door as (id >>> 0).toString(16) (tenancy.js hex())
     item-snapshots.json, restitution-cases.json: hex base-id / container keys (see HEX_KEY_PATHS)
   This pass re-serialises the file with its detected indent.
Not for name-table.json: nameTable.ts rebuilds it from the load order at every boot, and its race keys are decimal.
Run scan-numeric-ids.py first: it lists every candidate path, false positives included, and this tool touches only the two
kinds above. Plugins must be in DBO_DATA (default ../data) so light flags are read (loadorder-migrate.py index_map)."""
import json, os, re, sys, shutil, time
import importlib.util
spec = importlib.util.spec_from_file_location('m', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'loadorder-migrate.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

# PC, 25 Oct (Rigmor roll-out dry run on the live server dir): the scanner found 104 moved ids in housing.json and 26
# tenancy door values that the token pass cannot see because they are bare integers.
INT_PATHS = {'housing.json': [r'^\[\]$'], 'tenancy.json': [r'^\.listings\.[^.]+\.door$']}
# Dicts keyed by (id >>> 0).toString(16), by file: tenancy.js keys each listing by its door (hex(primary)), so the key must
# move with the door or the listing is orphaned. An all-digit hex key ('14029203') reads as decimal to the token pass, which
# is why these are declared by path, never guessed.
HEX_KEY_PATHS = {'tenancy.json': [r'^\.listings$'],
                 # itemguards.js relog check: per player (a runtime ff... key, never moved) the pack's and the session's
                 # containers' counts by hex base id, and the containers by hex ref. Unmigrated, every first login after
                 # the change would log the moved bases as grown.
                 'item-snapshots.json': [r'^\.[0-9a-f]+\.pack$', r'^\.[0-9a-f]+\.containers$', r'^\.[0-9a-f]+\.containers\.[0-9a-f]+$'],
                 # restitution.js: a case's items as { "<hex base id>": count }
                 'restitution-cases.json': [r'^\.[^.]+\.items$']}


def token_pass(t, mp):
    n = 0
    def sub_hex(mo):
        nonlocal n
        s = mo.group(1); nv, why = m.remap_id(int(s, 16), mp)
        if not why or why[0] != 'moved': return mo.group(0)
        n += 1; h = '%0*X' % (len(s) - 2, nv) if s[2:].upper() == s[2:] else '%0*x' % (len(s) - 2, nv)
        return '"' + s[:2] + h + '"'
    def sub_dec(mo):
        nonlocal n
        nv, why = m.remap_id(int(mo.group(1)), mp)
        if not why or why[0] != 'moved': return mo.group(0)
        n += 1; return '"%d"' % nv
    t = re.sub(r'"(0x[0-9A-Fa-f]{6,8})"', sub_hex, t)
    t = re.sub(r'"(\d{7,10})"', sub_dec, t)
    return t, n


def int_pass(t, mp, patterns, key_patterns=()):
    """Remap bare integers whose path matches one of patterns, and the hex keys of dicts whose path matches one of
    key_patterns; returns (text, count). Text unchanged when count is 0."""
    if not patterns and not key_patterns: return t, 0
    rx = [re.compile(p) for p in patterns]; krx = [re.compile(p) for p in key_patterns]; n = 0
    def walk(o, path):
        nonlocal n
        if isinstance(o, dict):
            for k in list(o): o[k] = walk(o[k], path + '.' + k)
            if any(r.match(path) for r in krx):
                out = {}
                for k, v in o.items():
                    nk = k
                    if re.match(r'^[0-9a-f]{1,8}$', k):
                        nv, why = m.remap_id(int(k, 16), mp)
                        if why and why[0] == 'moved': n += 1; nk = '%x' % nv
                    if nk in out: raise ValueError('%s: remapped key %s collides' % (path, nk))
                    out[nk] = v
                return out
        elif isinstance(o, list):
            for i, v in enumerate(o): o[i] = walk(v, path + '[]')
        elif isinstance(o, int) and not isinstance(o, bool) and any(r.match(path) for r in rx):
            nv, why = m.remap_id(o, mp)
            if why and why[0] == 'moved': n += 1; return nv
        return o
    d = walk(json.loads(t), '')
    if not n: return t, 0
    mo = re.match(r'[\[{]\r?\n([ \t]+)', t)
    indent = mo.group(1) if mo else None
    out = json.dumps(d, indent=indent, ensure_ascii=False) if indent else json.dumps(d, ensure_ascii=False, separators=(',', ':'))
    return out + ('\n' if t.endswith('\n') else ''), n


def main():
    a = sys.argv[1:]; write = '--write' in a; a = [x for x in a if x != '--write']
    extra = {}
    while '--int-path' in a:
        i = a.index('--int-path'); f, rx = a[i + 1].split(':', 1); extra.setdefault(f, []).append(rx); del a[i:i + 2]
    mp, names = m.index_map(m.order(a[0]), m.order(a[1]))
    for f in a[2:]:
        t = open(f, encoding='utf-8').read()
        t2, n1 = token_pass(t, mp)
        b = os.path.basename(f)
        t3, n2 = int_pass(t2, mp, INT_PATHS.get(b, []) + extra.get(b, []), HEX_KEY_PATHS.get(b, []))
        print('%s: %d quoted, %d bare remapped' % (f, n1, n2))
        if write and (n1 or n2):
            shutil.copy2(f, f + '.bak-loadorder-' + time.strftime('%Y%m%d-%H%M%S'))
            open(f, 'w', encoding='utf-8', newline='').write(t3)
    if not write: print('dry run; add --write')


if __name__ == '__main__':
    main()
