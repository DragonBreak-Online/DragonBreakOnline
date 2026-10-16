#!/usr/bin/env python3
"""Dead and stale form ids in the gameplay data, against a plugin load order (Skyrim release leftovers, 16 Oct).

Reads every server/*.json and *.js for "hex:Plugin.esx" descs and reports each one whose record is MISSING from the
order, flagged Deleted, or names a plugin outside the order. Also checks every {"src"|"ref": desc, "loadId": hex} pair
(owned-spawns.json, blackreach.json): the loadId must be the desc's id in this order (full plugins index << 24, light
plugins 0xFE000000 | light index << 12 | local id).

Headers only (no decompression): ~11 s and ~1 GB for the 140-plugin order. Run it alone, under nice/ionice.

  python3 tools/dead_ids_check.py <data dir> <plugins dir or loadOrder .json> [--allow tools/dead_ids_allow.txt]
  e.g. python3 tools/dead_ids_check.py . /opt/skyrim-data            (order from plugins.server.txt in <data dir>)

Exit 1 when anything not on the allow list is found. The allow list names known, deliberate leftovers (one
'file<TAB>desc<TAB>why' per line).
"""
import json, os, re, struct, sys, collections

def order_from(data_dir, src):
    if src.endswith('.json'):
        return json.load(open(src))
    names = [l.strip().lstrip('*') for l in open(os.path.join(data_dir, 'plugins.server.txt'), encoding='utf-8')
             if l.strip() and not l.startswith('#')]
    return [os.path.join(src, n) for n in names]

def index(order):
    idx, slot = {}, {}
    full = light = 0
    for p in order:
        b = open(p, 'rb').read()
        me = os.path.basename(p).lower()
        hflags, = struct.unpack_from('<I', b, 8)
        if (hflags & 0x200) or me.endswith('.esl'):
            slot[me] = ('light', light); light += 1
        else:
            slot[me] = ('full', full); full += 1
        sz, = struct.unpack_from('<I', b, 4)
        d = b[24:24 + sz]; i = 0; masters = []
        while i < len(d):
            st = d[i:i + 4]; ss, = struct.unpack_from('<H', d, i + 4)
            if st == b'MAST': masters.append(d[i + 6:i + 6 + ss - 1].decode('latin1').lower())
            i += 6 + ss
        o = 24 + sz; n = len(b)
        while o < n:
            t = b[o:o + 4]; sz, = struct.unpack_from('<I', b, o + 4)
            if t == b'GRUP': o += 24; continue
            fl, fid = struct.unpack_from('<II', b, o + 8)
            mi = fid >> 24
            idx[(masters[mi] if mi < len(masters) else me, fid & 0xffffff)] = t.decode('latin1') + ('!' if fl & 0x20 else '')
            o += 24 + sz
    return idx, slot

DESC = re.compile(r'(?<![0-9A-Za-z])(?:0x)?([0-9a-fA-F]{1,8}):((?:[^"\'\\:,\[\]{}\n]|\\\')+?\.es[mpl])(?![A-Za-z])', re.I)

def load_id(slot, plugin, local):
    s = slot.get(plugin.lower())
    if not s: return None
    return (0xFE000000 | (s[1] << 12) | (local & 0xfff)) if s[0] == 'light' else ((s[1] << 24) | (local & 0xffffff))

def walk_loadids(o, out):
    if isinstance(o, dict):
        d = o.get('src') if isinstance(o.get('src'), str) else o.get('ref')
        if isinstance(o.get('loadId'), str) and isinstance(d, str) and ':' in d: out.append((d, o['loadId']))
        for v in o.values(): walk_loadids(v, out)
    elif isinstance(o, list):
        for v in o: walk_loadids(v, out)

def main():
    a = sys.argv[1:]
    allow_path = None
    if '--allow' in a:
        k = a.index('--allow'); allow_path = a[k + 1]; del a[k:k + 2]
    data_dir, src = a[0], a[1]
    allow = set()
    if allow_path:
        for l in open(allow_path, encoding='utf-8'):
            if l.strip() and not l.startswith('#'):
                f, d = l.split('\t')[:2]; allow.add((f.strip(), d.strip().lower()))
    order = order_from(data_dir, src)
    idx, slot = index(order)
    bad, allowed = collections.defaultdict(set), 0
    for f in sorted(os.listdir(data_dir)):
        p = os.path.join(data_dir, f)
        if not (f.endswith('.json') or f.endswith('.js')) or os.path.islink(p) or not os.path.isfile(p): continue
        if f in ('server-settings.json', 'package.json', 'package-lock.json'): continue
        s = open(p, encoding='utf-8', errors='replace').read()
        for m in DESC.finditer(s):
            h, pl = m.group(1), m.group(2).replace("\\'", "'").strip()
            desc = '%s:%s' % (h.lower(), pl)
            if pl.lower() not in slot: why = 'plugin not in the order'
            else:
                t = idx.get((pl.lower(), int(h, 16) & 0xffffff))
                if t is None: why = 'missing'
                elif t.endswith('!'): why = 'deleted ' + t[:-1]
                else: continue
            if (f, desc.lower()) in allow: allowed += 1; continue
            bad[f].add('%s (%s)' % (desc, why))
        if f.endswith('.json'):
            try: j = json.loads(s)
            except Exception: continue
            pairs = []; walk_loadids(j, pairs)
            for d, lid in pairs:
                h, pl = d.split(':', 1)
                want = load_id(slot, pl, int(h, 16))
                if want is not None and int(lid, 16) != want:
                    bad[f].add('%s loadId %s, in this order %08x' % (d, lid, want))
    for f in sorted(bad):
        print('%s: %d' % (f, len(bad[f])))
        for x in sorted(bad[f])[:40]: print('   ', x)
    print('plugins %d, records %d, allowed %d, problems %d' % (len(order), len(idx), allowed, sum(len(v) for v in bad.values())))
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
