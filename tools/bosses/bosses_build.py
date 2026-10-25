#!/usr/bin/env python3
"""The bosses (Nat, 25 Oct; _work/boss-roster-design-1025.md on the PC). Reads tools/bosses/boss-defs.json and the load order
with esplib and writes server/bosses.json for bosses.js: every boss's, guardian's and add's editor id resolved to its record
and, through templates and leveled lists, to NPC_ options [level, desc, edid]; every drop desc checked to exist; each spot's
anchor (the nearest REFR no DragonBreak plugin places or overrides, tools/spawns/owned_spawns.py's rule).

    python3 tools/bosses/bosses_build.py [--defs tools/bosses/boss-defs.json] [--data <Skyrim Data>]
        [--order plugins.server.txt] [--out bosses.json]

Exit 1 when an editor id, a desc or an anchor does not resolve.
"""
import argparse
import json
import math
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'spawns'))
from owned_spawns import LoadOrder, OK_TYPES, subs  # noqa: E402

DISABLED, DELETED = 0x800, 0x20
CELL = 4096


def key_of(text):
    a, b = text.split(':', 1)
    return (b.lower(), int(a, 16))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--defs', default=os.path.join(HERE, 'boss-defs.json'))
    ap.add_argument('--data', default='/opt/skyrim-data')
    ap.add_argument('--order', default=os.path.join(HERE, '..', '..', 'plugins.server.txt'))
    ap.add_argument('--out', default=os.path.join(HERE, '..', '..', 'bosses.json'))
    a = ap.parse_args()
    lo = LoadOrder(a.data, a.order, {})
    defs = json.load(open(a.defs, encoding='utf-8'))
    out, bad = build(lo, defs)
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f"bosses: {len(out['bosses'])} bosses ({sum(1 for b in out['bosses'] if b['enabled'])} on) -> {a.out}")
    for line in bad:
        print('  BAD', line)
    return 1 if bad else 0


def build(lo, defs):
    bad = []
    by_edid = {}
    for k, w in lo.win.items():
        if w[1] in ('NPC_', 'LVLN'):
            by_edid.setdefault(lo.edid(k).lower(), k)

    def npc(k):
        s = lo.data(k)
        if not s:
            return None
        d = dict(s)
        acbs = d.get(b'ACBS', b'')
        flags = struct.unpack('<I', acbs[:4])[0] if len(acbs) >= 4 else 0
        lvl = struct.unpack('<H', acbs[8:10])[0] if len(acbs) >= 10 else 1
        p = lo.win[k][0]
        return {'level': 0 if flags & 0x80 else lvl, 'tplt': lo.ref(p, d[b'TPLT']) if len(d.get(b'TPLT', b'')) >= 4 else None}

    def lvln(k):
        p = lo.win[k][0]
        out = []
        for sig, v in lo.data(k) or []:
            if sig == b'LVLO' and len(v) >= 8:
                lvl, _, r = struct.unpack('<HHI', bytes(v[:8]))
                rk = lo.source(p, r)
                if rk:
                    out.append((lvl, rk))
        return out

    def resolve(k, depth=0):
        """[(level, NPC_ key)], as tools/forsworn/forsworn_camps_build.py resolves a placement"""
        if depth > 8:
            return []
        t = lo.types.get(k)
        if t == 'NPC_':
            n = npc(k)
            if n and n['tplt'] and lo.types.get(n['tplt']) == 'LVLN':
                return resolve(n['tplt'], depth + 1)
            t2, d2 = n['tplt'] if n else None, depth
            while t2 and lo.types.get(t2) == 'NPC_' and d2 < 8:
                n2 = npc(t2)
                if n2 and n2['tplt'] and lo.types.get(n2['tplt']) == 'LVLN':
                    return resolve(n2['tplt'], d2 + 1)
                t2, d2 = (n2['tplt'] if n2 else None), d2 + 1
            return [(n['level'] if n else 0, k)]
        if t == 'LVLN':
            best = {}
            for lvl, r in lvln(k):
                for l2, c in resolve(r, depth + 1):
                    v = lvl if lo.types.get(r) == 'NPC_' else max(lvl, l2)
                    if c not in best or v < best[c]:
                        best[c] = v
            return sorted((v, c) for c, v in best.items())
        return []

    def actor(edid, who):
        k = by_edid.get(str(edid).lower())
        if not k:
            bad.append(f"{who}: no NPC_ or LVLN '{edid}' in this load order")
            return None
        opts = resolve(k)
        if not opts:
            bad.append(f"{who}: '{edid}' resolves to no NPC_")
            return None
        return {'edid': lo.edid(k), 'desc': lo.desc(k), 'options': [[lvl, lo.desc(o), lo.edid(o)] for lvl, o in opts]}

    def item(desc, who):
        if not desc:
            return None
        k = key_of(desc)
        if k not in lo.types:
            bad.append(f"{who}: item {desc} is not in this load order")
            return None
        return lo.desc(k)

    worlds = {key_of(b['world']) for b in defs['bosses']}
    anchors = {}
    for k, (p, off, sz, fl, ctx) in lo.refs_in(worlds).items():
        if fl & (DELETED | DISABLED) or k[0] in lo.owned or p.key in lo.owned:
            continue
        d = dict(subs(p.data_at(p.fh, off, sz, fl)))
        if len(d.get(b'NAME', b'')) < 4 or len(d.get(b'DATA', b'')) < 12 or b'XESP' in d:
            continue
        if lo.types.get(lo.ref(p, d[b'NAME'])) not in OK_TYPES:
            continue
        anchors.setdefault(lo.source(p, ctx[0]), []).append((k, struct.unpack('<3f', d[b'DATA'][:12])))
    grid = lambda pos: (int(pos[0] // CELL), int(pos[1] // CELL))

    bosses = []
    for b in defs['bosses']:
        who = b['id']
        w = key_of(b['world'])
        o = {k: v for k, v in b.items() if k not in ('bossEdid', 'addEdids', 'guardian', 'drops', 'spots')}
        o['world'] = lo.desc(w)
        o['boss'] = actor(b['bossEdid'], who)
        o['adds'] = [x for x in (actor(e, who + ' add') for e in b.get('addEdids', [])) if x]
        if b.get('guardian'):
            g = actor(b['guardian']['edid'], who + ' guardian')
            o['guardian'] = dict(b['guardian'], **({'options': g['options'], 'desc': g['desc']} if g else {}))
        spots = []
        pool = anchors.get(w, [])
        for sp in b['spots']:
            own = [an for an in pool if grid(an[1]) == grid(sp['pos'])]
            best = min(own or pool, key=lambda an: math.dist(an[1], sp['pos'][:3]), default=None)
            if not best:
                bad.append(f"{who} {sp['id']}: no anchor in {b['world']}")
                continue
            spots.append(dict(sp, ref=lo.desc(best[0]), anchorDist=round(math.dist(best[1], sp['pos'][:3])), anchorSameCell=bool(own)))
        o['spots'] = spots
        dr = b.get('drops', {})
        drops = {'always': [[item(d, who), n] for d, n in dr.get('always', []) if item(d, who)]}
        if 'shards' in dr:
            drops['shards'] = dict(dr['shards'], desc=item(dr['shards'].get('desc'), who) or '')
        for key in ('schematic', 'extraSchematic'):
            if key in dr:
                drops[key] = dr[key]
        o['drops'] = drops
        if o.get('enabled') and b.get('drops', {}).get('shards') and not drops['shards']['desc']:
            bad.append(f"{who}: enabled with no shard item")
        bosses.append(o)
    out = {
        '_comment': 'Generated by tools/bosses/bosses_build.py from tools/bosses/boss-defs.json and the plugins. Read by bosses.js. '
                    'Do not edit by hand: change boss-defs.json and rerun the generator.',
        'bosses': bosses,
    }
    return out, bad


if __name__ == '__main__':
    sys.exit(main())
