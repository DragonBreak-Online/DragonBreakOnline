"""Count numeric form ids (hex strings 0xXXXXXXXX and integers) in JSON files whose load-order index moves between
two orders. Read-only. Usage: py tools/scan-numeric-ids.py <old settings> <new settings> <file.json>...
Lists every path, including false positives (floats, byte counts, milliseconds that merely look like ids): read it, then
rewrite the real ones with fix-numeric-ids.py."""
import json, sys, os, re
import importlib.util
spec = importlib.util.spec_from_file_location('m', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'loadorder-migrate.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
HEX = re.compile(r'^0x[0-9A-Fa-f]{6,8}$')
HEX_KEY = re.compile(r'^[0-9a-f]{7,8}$')


def scan(d, mp):
    """(path, why) -> ['%08x', ...] for every id-like value or key whose plugin moves or is gone."""
    hits = {}
    def chk(v, path):
        nv, why = m.remap_id(v, mp)
        if why: hits.setdefault((path, why[0]), []).append('%08x' % v)
    def walk(o, path):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == 'loadOrder': continue
                if HEX.match(k) or (k.isdigit() and len(k) >= 7): chk(int(k, 16) if k.startswith('0x') else int(k), path + '.<key>')
                # keys written as (id >>> 0).toString(16) (tenancy listings, the rest dicts): an all-digit one is ambiguous
                # with a decimal key, so those are reported under both readings and the file's code decides
                if HEX_KEY.match(k): chk(int(k, 16), path + '.<hexkey>')
                walk(v, path + '.' + k)
        elif isinstance(o, list):
            for v in o: walk(v, path + '[]')
        elif isinstance(o, str) and HEX.match(o): chk(int(o, 16), path)
        elif isinstance(o, int) and not isinstance(o, bool) and o >= 0x01000000: chk(o, path)
    walk(d, '')
    return hits


if __name__ == '__main__':
    mp, names = m.index_map(m.order(sys.argv[1]), m.order(sys.argv[2]))
    for f in sys.argv[3:]:
        try: d = json.load(open(f, encoding='utf-8'))
        except Exception: continue
        for (p, w), vs in sorted(scan(d, mp).items()):
            print('%-34s %4d %-5s %-50s e.g. %s' % (os.path.basename(f)[:34], len(vs), w, p[:50], vs[:3]))
