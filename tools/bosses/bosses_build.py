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
ITEM_TYPES = {'MISC', 'INGR', 'ALCH', 'WEAP', 'ARMO', 'AMMO', 'BOOK', 'SLGM', 'SCRL', 'KEYM'}


def key_of(text):
    a, b = text.split(':', 1)
    return (b.lower(), int(a, 16))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--defs', default=os.path.join(HERE, 'boss-defs.json'))
    ap.add_argument('--data', default='/opt/skyrim-data')
    ap.add_argument('--order', default=os.path.join(HERE, '..', '..', 'plugins.server.txt'))
    ap.add_argument('--out', default=os.path.join(HERE, '..', '..', 'bosses.json'))
    ap.add_argument('--locations', default=os.path.join(HERE, '..', '..', 'admin-locations.json'),
                    help="the F7 teleport list: every boss spot as 'Boss: <name> ...', rewritten each run ('' leaves it)")
    a = ap.parse_args()
    lo = LoadOrder(a.data, a.order, {})
    defs = json.load(open(a.defs, encoding='utf-8'))
    out, bad = build(lo, defs)
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f"bosses: {len(out['bosses'])} bosses ({sum(1 for b in out['bosses'] if b['enabled'])} on) -> {a.out}")
    if a.locations:
        print(f"admin-locations: {teleports(out, a.locations)} boss spots -> {a.locations}")
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

    warn = []

    def item(desc, who, confirmed=''):
        if not desc:
            return None
        k = key_of(desc)
        if k not in lo.types:
            # An item another worker built and read back from a plugin this machine does not have yet: kept, and said
            if confirmed:
                warn.append(f"{who}: item {desc} is not in this load order; kept on its confirmation ({confirmed[:80]})")
                return desc
            bad.append(f"{who}: item {desc} is not in this load order")
            return None
        return lo.desc(k)

    # Drops named by editor id (drops.alwaysEdid): one pass over the item records of every plugin, the last one winning
    wanted = {str(e).lower() for b in defs['bosses'] for e, _ in (b.get('drops') or {}).get('alwaysEdid', [])}
    wanted |= {str(x[0]).lower() for b in defs['bosses'] for x in (b.get('drops') or {}).get('extraEdid', [])}
    wanted |= {str(b[k]).lower() for b in defs['bosses'] for k in ('rearmEdid', 'rearmAddsEdid') if b.get(k)}
    item_by_edid = {}
    if wanted:
        for p in lo.plugins:
            for t, fid, fl, off, sz, ctx in p.index:
                if t not in ITEM_TYPES:
                    continue
                d = dict(subs(p.data_at(p.fh, off, sz, fl)))
                e = d.get(b'EDID', b'').rstrip(b'\0').decode('cp1252', 'replace')
                if e.lower() in wanted:
                    k = lo.source(p, fid)
                    if k:
                        item_by_edid[e.lower()] = (k, t, e)

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
        o = {k: v for k, v in b.items() if k not in ('bossEdid', 'addEdids', 'guardian', 'drops', 'spots', 'rearmEdid', 'rearmAddsEdid',
                                                     'bossDesc', 'bossLevel', 'bossConfirmedBy')}
        for src, dst in (('rearmEdid', 'rearm'), ('rearmAddsEdid', 'rearmAdds')):
            if not b.get(src):
                continue
            hit = item_by_edid.get(str(b[src]).lower())
            if hit and hit[1] == 'WEAP':
                o[dst] = lo.desc(hit[0])
            else:
                bad.append(f"{who}: no weapon '{b[src]}' to rearm with")
        o['world'] = lo.desc(w)
        if b.get('bossDesc'):
            # A boss NPC another worker merged and read back from a plugin this machine does not have yet (the Behemoth, DLE
            # 1D2207): its own record when this load order has it under that editor id, else the confirmed desc as it stands
            k = key_of(b['bossDesc'])
            if k in lo.types and str(lo.edid(k)).lower() == str(b['bossEdid']).lower():
                o['boss'] = actor(b['bossEdid'], who)
            elif b.get('bossConfirmedBy'):
                o['boss'] = {'edid': b['bossEdid'], 'desc': b['bossDesc'], 'options': [[int(b.get('bossLevel') or 1), b['bossDesc'], b['bossEdid']]]}
                warn.append(f"{who}: boss {b['bossDesc']} ({b['bossEdid']}) is not in this load order; kept on its confirmation ({b['bossConfirmedBy'][:80]})")
            else:
                bad.append(f"{who}: boss {b['bossDesc']} is not {b['bossEdid']} in this load order and has no bossConfirmedBy")
                o['boss'] = None
        else:
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
        for e, n in dr.get('alwaysEdid', []):
            hit = item_by_edid.get(str(e).lower())
            if not hit:
                bad.append(f"{who}: no item '{e}' in this load order")
                continue
            drops['always'].append([lo.desc(hit[0]), n, hit[2]])
        for e, chance, n in dr.get('extraEdid', []):
            hit = item_by_edid.get(str(e).lower())
            if not hit:
                bad.append(f"{who}: no item '{e}' in this load order")
                continue
            drops.setdefault('extra', []).append([lo.desc(hit[0]), chance, n, hit[2]])
        if 'shards' in dr:
            drops['shards'] = dict(dr['shards'], desc=item(dr['shards'].get('desc'), who, dr['shards'].get('confirmedBy', '')) or '')
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
    for line in warn:
        print('  NOTE', line)
    return out, bad


# Every boss teleport sits in one F7 group (Nat 26 Oct: "Where is the TP for all of the bosses?"); the panel lists a region it
# does not know as its own chip (extraTabs.tsx regions), so no client change is needed
BOSS_REGION = 'Bosses'


def teleports(out, path):
    """Nat's standing rule (25 Oct: "always make sure Location teleports and all items are always updated"): every boss spot is an
    F7 teleport, named 'Boss: <name>, <spot> (<hold>)' in the Bosses group, 64 units above the spot as admin_catalog.py places
    a marker's. A dev-only boss gets one too, marked '(dev test)' (Nat 26 Oct: "I don't see the werewolf one either"). Earlier
    'Boss: ' entries are replaced; nothing else in the file changes."""
    loc = json.load(open(path, encoding='utf-8'))
    rows = [r for r in loc['locations'] if not str(r.get('name', '')).startswith('Boss: ')]
    world_names = {str(r['world']).lower(): r.get('worldName', '') for r in loc['locations']}
    n = 0
    for b in out['bosses']:
        for sp in b['spots']:
            where = ', '.join(x for x in [sp['id'] if len(b['spots']) > 1 else '', (sp.get('note') or '').split(',')[0] if len(b['spots']) == 1 else ''] if x)
            hold = b.get('hold') or ''
            name = f"Boss: {b['name']}{', ' + where if where else ''}{' (' + hold.capitalize() + ')' if hold else ''}{' (dev test)' if b.get('devOnly') else ''}"
            rows.append({'name': name, 'region': BOSS_REGION, 'world': b['world'],
                         'worldName': world_names.get(b['world'].lower(), ''), 'pos': [sp['pos'][0], sp['pos'][1], sp['pos'][2] + 64],
                         'rot': [0, 0, float(sp.get('heading', 0))]})
            n += 1
    loc['locations'] = rows
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(loc, f, indent=1, ensure_ascii=False)
    return n


if __name__ == '__main__':
    sys.exit(main())
