#!/usr/bin/env python3
"""The Forsworn camps as overworld dungeons (Nat, 25 Oct: "make the Reach's Forsworn camps work like our giant camps"). Reads
the load order with esplib and writes server/forsworn-camps.json, which wildlife.js turns into permanent hostile
wild:fw<role>:<camp>-<local id>-<plugin> zones and whose chests become camp loot nodes.

    python3 tools/forsworn/forsworn_camps_build.py [--placements tools/forsworn/forsworn-camps-placements.json]
        [--data <Skyrim Data>] [--order plugins.server.txt] [--guard-posts guard-posts.json] [--out forsworn-camps.json]

What it takes (forsworn-camps-placements.json): each camp's placed Forsworn and hagravens and its chests, from the PC census.
Every placed actor there is disabled (the server spawns all actors), so each becomes a spot of its own base at its own place
and heading. Bases are resolved through templates and leveled lists to NPC_ options [level, desc]. Anchors are REFRs no
DragonBreak plugin places or overrides (tools/spawns/owned_spawns.py's rule), the nearest in the spot's own cell. A spot is
left out (listed under excluded) when it stands inside an exclusion circle (Karthspire and Sky Haven Temple), within
--buffer units of a guard post or a town (Nat's Solitude crash of 23 Oct: a spawned guard perceiving an enemy NPC), or when
its base resolves to nothing. Exit 1 when a ref or a base does not resolve.
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

DISABLED, STARTS_DEAD, DELETED = 0x800, 0x200, 0x20
CELL = 4096


def key_of(text):
    """(plugin, local id) from "abcde:Plugin.esm" """
    a, b = text.split(':', 1)
    return (b.lower(), int(a, 16))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--placements', default=os.path.join(HERE, 'forsworn-camps-placements.json'))
    ap.add_argument('--data', default='/opt/skyrim-data')
    ap.add_argument('--order', default=os.path.join(HERE, '..', '..', 'plugins.server.txt'))
    ap.add_argument('--guard-posts', default='', help="the server's guard-posts.json (guards.js), for the buffer")
    ap.add_argument('--buffer', type=float, default=8000)
    ap.add_argument('--out', default=os.path.join(HERE, '..', '..', 'forsworn-camps.json'))
    a = ap.parse_args()
    lo = LoadOrder(a.data, a.order, {})
    src = json.load(open(a.placements, encoding='utf-8'))
    posts = []
    if a.guard_posts:
        posts = [p for p in json.load(open(a.guard_posts, encoding='utf-8')).get('posts', []) if isinstance(p.get('pos'), list)]
    out, bad = build(lo, src, posts, a.buffer)
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write('\n')
    n = sum(len(c['spots']) for c in out['camps'])
    print(f"forsworn camps: {len(out['camps'])} camps, {n} spots, {sum(len(c['chests']) for c in out['camps'])} chests, "
          f"{sum(len(c['excluded']) for c in out['camps'])} excluded -> {a.out}")
    for line in bad:
        print('  BAD', line)
    return 1 if bad else 0


def build(lo, src, posts, buffer):
    bad = []
    wanted = {key_of(x['ref']) for c in src['camps'] for x in c['actors'] + c['chests']}
    for p in lo.plugins:
        for t, fid, fl, off, sz, ctx in p.index:
            if t in ('ACHR', 'REFR'):
                k = lo.source(p, fid)
                if k in wanted:
                    lo.win[k] = (p, t, off, sz, fl, ctx)

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
        """[(level, NPC_ key)] a placement of k can become, as blackreach_build.py and ck-mcp/wildlife.py resolve it"""
        if depth > 8:
            return []
        t = lo.types.get(k)
        if t == 'NPC_':
            n = npc(k)
            if n and n['tplt'] and lo.types.get(n['tplt']) == 'LVLN':
                return resolve(n['tplt'], depth + 1)
            # A quest's copy templated on another NPC_ (dunRedEagle_LvlForswornMeleeBerserkerAmbushRush on LvlForswornMelee...):
            # the chain's leveled list where it reaches one, so the server picks the level, not each client
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

    def ref_record(k):
        w = lo.win.get(k)
        if not w:
            return None
        p, t, off, sz, fl, ctx = w
        d = dict(subs(p.data_at(p.fh, off, sz, fl)))
        return {'type': t, 'flags': fl, 'base': lo.ref(p, d[b'NAME']) if len(d.get(b'NAME', b'')) >= 4 else None,
                'pos': struct.unpack('<6f', d[b'DATA'][:24]) if len(d.get(b'DATA', b'')) >= 24 else None,
                'world': lo.source(p, ctx[0]) if ctx and ctx[0] else None}

    worlds = {key_of(x['world']) for c in src['camps'] for x in c['actors']}
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
    tamriel = key_of('3c:Skyrim.esm')
    towns = [(n, t['pos']) for n, t in (src.get('towns') or {}).items() if isinstance(t.get('pos'), list)]
    tam_posts = [p for p in posts if key_of(p['world']) == tamriel]

    def too_near(world, pos):
        """Why a spot here is left out, or ''"""
        for e in src.get('exclude', []):
            if key_of(e['world']) == world and math.dist(pos[:2], e['pos'][:2]) <= e['radius']:
                return 'inside the exclusion of ' + e['name'].split(' (')[0]
        if world == tamriel:
            for p in tam_posts:
                if math.dist(pos[:2], p['pos'][:2]) <= buffer:
                    return f"within {round(math.dist(pos[:2], p['pos'][:2]))} units of guard post {p['hold']} {p['n']}"
            for n, tp in towns:
                if math.dist(pos[:2], tp[:2]) <= buffer:
                    return f"within {round(math.dist(pos[:2], tp[:2]))} units of {n}"
        return ''

    camps = []
    for c in src['camps']:
        spots, excluded, chests = [], [], []
        for x in c['actors']:
            k = key_of(x['ref'])
            rec = ref_record(k)
            if not rec or not rec['base'] or not rec['pos']:
                bad.append(f"{x['ref']}: no winning record in this load order")
                continue
            if rec['flags'] & (STARTS_DEAD | DELETED):
                excluded.append({'src': x['ref'], 'why': 'starts dead or deleted'})
                continue
            base = rec['base']
            options = resolve(base)
            if not options:
                bad.append(f"{x['ref']}: base {lo.desc(base)} ({lo.edid(base)}) resolves to no NPC_")
                continue
            why = too_near(rec['world'], rec['pos'])
            if why:
                excluded.append({'src': x['ref'], 'role': x['role'], 'why': why})
                continue
            pool = anchors.get(rec['world'], [])
            own = [an for an in pool if grid(an[1]) == grid(rec['pos'])]
            best = min(own or pool, key=lambda an: math.dist(an[1], rec['pos'][:3]), default=None)
            if not best:
                bad.append(f"{x['ref']}: no anchor in its world")
                continue
            zone = 'wild:fw%s:%s-%x-%s' % (x['role'], c['id'], k[1], re.sub(r'[^a-z0-9]', '', re.sub(r'\.es[mpl]$', '', k[0])))
            spots.append({'zone': zone, 'src': lo.desc(k), 'role': x['role'], 'boss': x['role'] == 'boss',
                          'base': lo.desc(base), 'edid': lo.edid(base), 'world': lo.desc(rec['world']),
                          'pos': [round(v, 2) for v in rec['pos'][:3]], 'heading': round(math.degrees(rec['pos'][5]) % 360, 1),
                          'ref': lo.desc(best[0]), 'anchorDist': round(math.dist(best[1], rec['pos'][:3])), 'anchorSameCell': bool(own),
                          'options': [[lvl, lo.desc(o), lo.edid(o)] for lvl, o in options]})
        for x in c['chests']:
            k = key_of(x['ref'])
            rec = ref_record(k)
            if not rec or lo.types.get(rec['base']) != 'CONT':
                bad.append(f"{x['ref']}: not a container in this load order")
                continue
            if rec['flags'] & (DISABLED | DELETED):
                excluded.append({'src': x['ref'], 'why': 'chest disabled or deleted'})
                continue
            why = too_near(rec['world'], rec['pos'])
            if why:
                excluded.append({'src': x['ref'], 'why': 'chest ' + why})
                continue
            edid = lo.edid(rec['base'])
            chests.append({'ref': lo.desc(k), 'edid': edid, 'boss': bool(re.search(r'Boss', edid)), 'pos': [round(v, 1) for v in rec['pos'][:3]]})
        camps.append({'id': c['id'], 'name': c['name'], 'areas': c['areas'], 'spots': spots, 'chests': chests, 'excluded': excluded})
    out = {
        '_comment': 'Generated by tools/forsworn/forsworn_camps_build.py from the plugins and tools/forsworn/forsworn-camps-placements.json. '
                    'Wave 1 of the Forsworn camps (Nat, 25 Oct). spots: the placed Forsworn and hagravens, spawned by wildlife.js as '
                    'hostile wild:fw<role>:<camp>-<local id>-<plugin> zones; chests: camp loot nodes (once per player per chest per '
                    'hour); excluded: what the Karthspire/Sky Haven circle or the guard-post and town buffer left out. Do not edit by '
                    'hand; rerun the generator after a plugin changes.',
        'buffer': buffer,
        'camps': camps,
    }
    return out, bad


if __name__ == '__main__':
    sys.exit(main())
