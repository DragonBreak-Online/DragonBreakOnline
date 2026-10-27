r"""decor-fixtures.json: the furniture and clutter a plugin put in a home, which its owner may move or store (decor.js; design
_work\decor-preexisting-1027.md on the PC).

    python3 tools/decor/decor_fixtures.py [--data /opt/skyrim-data] [--order plugins.server.txt] [--out decor-fixtures.json]

Cells: the interiors behind every housing.json door and those their load doors lead to (DEPTH steps). The server also
requires the cell to be one of the place's own, so this may over-include. A reference is listed when its base is a
decor-catalog.json piece that is not a light, and it is plain: not deleted, not initially disabled, not persistent, no
script (VMAD) on it or its base, no enable parent (XESP), and not a bed with an owner (XOWN).
    { cells: { cellDesc: [[refDesc, baseDesc], ...] } }
"""
import argparse, json, os, struct, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
sys.path.insert(0, os.path.join(ROOT, 'tooling', 'ck-mcp'))
import esplib  # noqa: E402

DEPTH = 4
DELETED, PERSISTENT, DISABLED = 0x20, 0x400, 0x800


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default='/opt/skyrim-data')
    ap.add_argument('--order', default=os.path.join(ROOT, 'plugins.server.txt'))
    ap.add_argument('--housing', default=os.path.join(ROOT, 'housing.json'))
    ap.add_argument('--catalog', default=os.path.join(ROOT, 'decor-catalog.json'))
    ap.add_argument('--out', default=os.path.join(ROOT, 'decor-fixtures.json'))
    a = ap.parse_args()

    names = [l.strip().lstrip('*') for l in open(a.order, encoding='utf-8-sig') if l.strip() and not l.startswith('#')]
    plugins, proper, byindex, light = [], {}, {}, 0
    for n in names:
        path = os.path.join(a.data, n)
        if not os.path.exists(path):
            continue
        p = esplib.Plugin(path)
        p.key = n.lower(); p.fh = open(path, 'rb')
        proper[p.key] = n
        if p.esl:
            byindex[0xFE000 | light] = p.key; light += 1
        else:
            byindex[len([q for q in plugins if not q.esl])] = p.key
        plugins.append(p)

    def source(p, fid):
        src, loc = p.modindex_source(fid)
        return None if src is None else (src.lower(), loc & 0xFFFFFF)

    def desc(k):
        return '%x:%s' % (k[1], proper.get(k[0], k[0]))

    def key_of_load_id(n):
        n &= 0xFFFFFFFF
        if n >> 24 == 0xFE:
            return (byindex.get(n >> 12), n & 0xFFF)
        return (byindex.get(n >> 24), n & 0xFFFFFF)

    # Every winning record we may need: REFRs in interiors (by cell), the claimed doors wherever they stand, base types
    doors = {key_of_load_id(int(n)) for n in json.load(open(a.housing, encoding='utf-8'))}
    refs, cell_refs, base_type, base_rec, door_refs = {}, {}, {}, {}, {}
    for p in plugins:
        for t, fid, fl, off, sz, ctx in p.index:
            k = source(p, fid)
            if k is None:
                continue
            if t == 'REFR':
                w, c, g = ctx
                if k in doors:
                    door_refs[k] = (p, off, sz, fl, None)
                if w or not c:
                    continue
                ck = source(p, c)
                old = refs.get(k)
                if old:
                    cell_refs.get(old[4], set()).discard(k)
                refs[k] = (p, off, sz, fl, ck)
                cell_refs.setdefault(ck, set()).add(k)
            elif t not in ('GRUP', 'NAVM', 'LAND', 'INFO', 'DIAL', 'ACHR'):
                base_type[k] = t
                base_rec[k] = (p, off, sz, fl)

    def subs(rec):
        p, off, sz, fl = rec[:4]
        return list(esplib.subrecords(p.data_at(p.fh, off, sz, fl)))

    def field(s, sig):
        return next((v for t, v in s if t == sig), None)

    def base_of(p, s):
        nm = field(s, b'NAME')
        return source(p, struct.unpack('<I', nm[:4])[0]) if nm and len(nm) >= 4 else None

    # The cells: behind each housing door, then through load doors to further interiors
    start = set()
    for k in doors:
        r = refs.get(k)
        if r:
            start.add(r[4])
        # a claimed door usually stands outside: its XTEL's destination door names the interior
        rr = door_refs.get(k)
        if rr:
            s = subs(rr)
            x = field(s, b'XTEL')
            if x and len(x) >= 4:
                d = refs.get(source(rr[0], struct.unpack('<I', x[:4])[0]))
                if d:
                    start.add(d[4])
    seen, frontier = set(start), set(start)
    for _ in range(DEPTH):
        nxt = set()
        for c in frontier:
            for k in cell_refs.get(c, ()):
                r = refs[k]
                s = subs(r)
                b = base_of(r[0], s)
                if base_type.get(b) != 'DOOR':
                    continue
                x = field(s, b'XTEL')
                if x and len(x) >= 4:
                    d = refs.get(source(r[0], struct.unpack('<I', x[:4])[0]))
                    if d and d[4] not in seen:
                        seen.add(d[4]); nxt.add(d[4])
        frontier = nxt

    cat = json.load(open(a.catalog, encoding='utf-8'))
    pieces = {}
    for g in cat.get('groups', []):
        for pc in g.get('pieces', []):
            pieces[str(pc['desc']).lower()] = g.get('id')
    out, n, why = {}, 0, {}
    for c in sorted(seen):
        rows = []
        for k in sorted(cell_refs.get(c, ())):
            r = refs[k]
            fl = r[3]
            s = subs(r)
            b = base_of(r[0], s)
            if not b:
                continue
            group = pieces.get(desc(b).lower())
            reason = None
            if group is None:
                continue
            if group == 'lights' or base_type.get(b) == 'LIGH':
                reason = 'light'
            elif fl & (DELETED | DISABLED):
                reason = 'deleted or disabled'
            elif fl & PERSISTENT:
                reason = 'persistent'
            elif field(s, b'VMAD') is not None:
                reason = 'script'
            elif field(s, b'XESP') is not None:
                reason = 'enable parent'
            elif group == 'beds' and field(s, b'XOWN') is not None:
                reason = 'owned bed'
            elif b in base_rec and field(subs(base_rec[b]), b'VMAD') is not None:
                reason = 'scripted base'
            if reason:
                why[reason] = why.get(reason, 0) + 1
                continue
            rows.append([desc(k), desc(b)])
        if rows:
            out[desc(c)] = rows; n += len(rows)
    doc = {'_comment': 'Generated by tools/decor/decor_fixtures.py: a home\'s own furniture and clutter its owner may move or store '
                       '(decor.js). Do not edit by hand.', 'cells': out}
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=0, ensure_ascii=False)
        f.write('\n')
    print(f'decor fixtures: {n} references in {len(out)} of {len(seen)} cells -> {a.out}; left out: {why}')



if __name__ == '__main__':
    main()
