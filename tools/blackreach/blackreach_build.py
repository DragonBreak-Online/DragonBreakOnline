#!/usr/bin/env python3
"""Blackreach, the open-world dungeon (Nate, 14 Oct: "super hard and the loot really worth it"). Reads the load order with
esplib and writes server/blackreach.json, which wildlife.js turns into permanent wild:br<kind>:b<local id>-<plugin> zones and
blackreach.js turns into the area's ten loot chests.

    python3 tools/blackreach/blackreach_build.py --placements <blackreach-placements.json>
        [--data /opt/skyrim-data] [--order <loadorder.txt>] [--plugins <dir of package plugins read instead>]
        [--out blackreach.json] [--report <checks.json>]

What it takes (blackreach-placements.json, Nate's PC census of the Blackreach world and its Zcells, 14 Oct):
- every living actor DragonBreak Online Edits places in the Blackreach world (Nate's 25), enabled or not: the server spawns
  them all (check 3 disables the plugin's own copies);
- every living vanilla actor placed in the Blackreach world itself (not the Zcells, which are dungeons.json's lease, and not
  corpses, the disabled dragon or anything Starts Dead);
- Nate's ten chests (containers DragonBreak Online Edits places there).
Every base is read from the plugins (record type, editor id, race and its keywords, leveled lists down to NPC_ records);
nothing is taken from the census but the list of refs. Anchors are REFRs no DragonBreak plugin places or overrides, as
tools/spawns/owned_spawns.py chooses them. It also reads the routes in (doors, lifts, mechanisms) and the Aetherium Forge's
lift for the report. Exit 1 when a ref or a base does not resolve.
"""
import argparse
import collections
import hashlib
import json
import math
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'spawns'))
from owned_spawns import LoadOrder, OK_TYPES, subs  # noqa: E402

DISABLED, STARTS_DEAD, DELETED, PERSISTENT = 0x800, 0x200, 0x20, 0x400
BLACKREACH = ('skyrim.esm', 0x01EE62)
DLE = 'dragonbreak online edits.esp'
CELL = 4096
# Kinds by race editor id (after templates): the middle of the zone name, so gamemode-config npcDamage.byKind and
# animalBody can tell Blackreach's spawns from the same creature anywhere else
KIND_BY_RACE = [(r'^Falmer', 'brfalmer'), (r'Dwarven|Dwemer|DrV_', 'brdwemer'), (r'Giant', 'brgiant'), (r'Wisp|Witchlight', 'brwisp'),
                (r'Chaurus', 'brchaurus'), (r'Spider', 'brspider'), (r'Troll', 'brtroll')]
BOSS = re.compile(r'Boss|^DD_StoneGiant$', re.I)
CHEST_REACH = 2500        # a spot this close to a chest guards it
AREA_REACH = 3500         # spots and chests this close share an area


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--placements', required=True)
    ap.add_argument('--data', default='/opt/skyrim-data')
    ap.add_argument('--order', default='/opt/alduinak/deploy/skyrim-data/loadorder.txt')
    ap.add_argument('--plugins', default='', help='a folder of plugins read instead of their --data copies (the package)')
    ap.add_argument('--out', default=os.path.join(HERE, '..', '..', 'blackreach.json'))
    ap.add_argument('--report', default='')
    a = ap.parse_args()
    replace = {}
    if a.plugins:
        for n in os.listdir(a.plugins):
            if re.search(r'\.es[mpl]$', n, re.I):
                replace[n.lower()] = os.path.join(a.plugins, n)
    order = a.order
    lo = LoadOrder(a.data, order, replace)
    rows = json.load(open(a.placements, encoding='utf-8'))
    out, report, bad = build(lo, rows)
    out['sources'] = {lo.proper[p.key]: hashlib.sha256(open(p.srcpath, 'rb').read()).hexdigest()[:16] for p in lo.plugins if p.key == DLE}
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write('\n')
    if a.report:
        with open(a.report, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=1, ensure_ascii=False)
    print(f"blackreach: {len(out['spots'])} spots ({sum(1 for s in out['spots'] if s['nate'])} Nate's), {len(out['chests'])} chests, "
          f"{len(out['areas'])} areas -> {a.out}")
    for line in bad:
        print('  BAD', line)
    return 1 if bad else 0


def key_of(text):
    """(plugin, local id) from "Plugin.esm:0ABCDE" (the census) or "abcde:Plugin.esm" (a desc)"""
    a, b = text.split(':', 1)
    if re.search(r'\.es[mpl]$', a, re.I):
        return (a.lower(), int(b, 16))
    return (b.lower(), int(a, 16))


def build(lo, rows):
    bad = []
    wanted = {key_of(r['ref']) for r in rows}
    # The census's refs: their winning records (the LoadOrder keeps only owned ACHRs, so the vanilla ones are added here)
    for p in lo.plugins:
        for t, fid, fl, off, sz, ctx in p.index:
            if t not in ('ACHR', 'REFR'):
                continue
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
        tflags = struct.unpack('<H', acbs[18:20])[0] if len(acbs) >= 20 else 0   # ACBS template flags
        p = lo.win[k][0]
        return {'edid': lo.edid(k), 'level': 0 if flags & 0x80 else lvl, 'pcLevelMult': bool(flags & 0x80),
                'tplt': lo.ref(p, d[b'TPLT']) if len(d.get(b'TPLT', b'')) >= 4 else None,
                'race': lo.ref(p, d[b'RNAM']) if len(d.get(b'RNAM', b'')) >= 4 else None, 'tflags': tflags}

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
        """[(level, NPC_ key)] a placement of k can become, as owned_spawns.py and ck-mcp/wildlife.py resolve it"""
        if depth > 8:
            return []
        t = lo.types.get(k)
        if t == 'NPC_':
            n = npc(k)
            if n and n['tplt'] and lo.types.get(n['tplt']) == 'LVLN':
                return resolve(n['tplt'], depth + 1)
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

    race_cache = {}

    def race_of(k, depth=0):
        n = npc(k)
        if not n:
            return None
        if n['race'] and not (n['tflags'] & 0x01 and n['tplt']):      # template flag 0x01: Use Traits (the race)
            return n['race']
        if n['tplt'] and depth < 8:
            t = lo.types.get(n['tplt'])
            if t == 'NPC_':
                return race_of(n['tplt'], depth + 1)
            if t == 'LVLN':
                opts = resolve(n['tplt'])
                return race_of(opts[-1][1], depth + 1) if opts else n['race']
        return n['race']

    def race_info(r):
        if r not in race_cache:
            s = dict(lo.data(r) or [])
            kw = s.get(b'KWDA', b'')
            p = lo.win[r][0]
            race_cache[r] = {'edid': lo.edid(r), 'keywords': sorted({lo.edid(lo.source(p, struct.unpack_from('<I', kw, i)[0])) for i in range(0, len(kw) - 3, 4)})}
        return race_cache[r]

    def kind_of(race_edid):
        for rx, kind in KIND_BY_RACE:
            if re.search(rx, race_edid or '', re.I):
                return kind
        return ''

    def ref_record(k):
        w = lo.win.get(k)
        if not w:
            return None
        p, t, off, sz, fl, ctx = w
        s = subs(p.data_at(p.fh, off, sz, fl))
        d = dict(s)
        base = lo.ref(p, d[b'NAME']) if len(d.get(b'NAME', b'')) >= 4 else None
        pos = struct.unpack('<6f', d[b'DATA'][:24]) if len(d.get(b'DATA', b'')) >= 24 else None
        world = lo.source(p, ctx[0]) if ctx and ctx[0] else None
        cell = lo.source(p, ctx[1]) if ctx and ctx[1] else None
        xesp = lo.ref(p, d[b'XESP']) if len(d.get(b'XESP', b'')) >= 4 else None
        xesp_flags = d[b'XESP'][4] if len(d.get(b'XESP', b'')) >= 5 else 0
        xtel = None
        if len(d.get(b'XTEL', b'')) >= 28:
            xtel = {'door': lo.ref(p, d[b'XTEL']), 'pos': [round(v, 1) for v in struct.unpack('<3f', d[b'XTEL'][4:16])]}
        lock = None
        if len(d.get(b'XLOC', b'')) >= 1:
            lock = {'level': d[b'XLOC'][0], 'key': lo.ref(p, d[b'XLOC'][4:8]) if len(d[b'XLOC']) >= 8 and struct.unpack('<I', d[b'XLOC'][4:8])[0] else None}
        return {'type': t, 'by': lo.proper.get(p.key, p.key), 'flags': fl, 'base': base, 'pos': pos, 'world': world, 'cell': cell,
                'xesp': xesp, 'xespOpposite': bool(xesp_flags & 1), 'xtel': xtel, 'lock': lock}

    # ---- actors ----------------------------------------------------------------------------------------------------
    spots, skipped = [], []
    for r in rows:
        if r['kind'] != 'actor':
            continue
        k = key_of(r['ref'])
        rec = ref_record(k)
        if not rec or not rec['base']:
            bad.append(f"{r['ref']}: no winning record in this load order")
            continue
        nate = k[0] == DLE
        if not rec['world'] or rec['world'] != BLACKREACH:
            # The Zcells and the sewer are BlackreachLocation's interiors: dungeons.js leases them
            skipped.append([r['ref'], r['editorId'], 'interior (a dungeons.json lease)' if not rec['world'] else 'another world'])
            if nate:
                bad.append(f"{r['ref']}: Nate's actor is not in the Blackreach world")
            continue
        if rec['flags'] & (STARTS_DEAD | DELETED):
            skipped.append([r['ref'], r['editorId'], 'starts dead (a corpse stays a corpse)' if rec['flags'] & STARTS_DEAD else 'deleted'])
            continue
        if rec['flags'] & DISABLED and not nate:
            skipped.append([r['ref'], r['editorId'], 'disabled in vanilla'])
            continue
        base = rec['base']
        btype = lo.types.get(base)
        if btype not in ('NPC_', 'LVLN'):
            bad.append(f"{r['ref']}: base {lo.desc(base)} is {btype}, not NPC_ or LVLN")
            continue
        options = resolve(base)
        if not options:
            bad.append(f"{r['ref']}: base {lo.desc(base)} ({lo.edid(base)}) resolves to no NPC_")
            continue
        races = sorted({race_info(race_of(c))['edid'] for _, c in options if race_of(c)})
        kws = sorted({kw for _, c in options if race_of(c) for kw in race_info(race_of(c))['keywords']})
        if any(re.search(r'Corpse|Skeleton', lo.edid(base), re.I) for _ in [0]):
            skipped.append([r['ref'], lo.edid(base), 'a corpse base'])
            continue
        if 'DragonRace' in races or any('Dragon' in x for x in races):
            skipped.append([r['ref'], lo.edid(base), 'a dragon (crashyCreatures: dragons are off)'])
            continue
        if 'ActorTypeNPC' in kws and not nate:
            # dunBlackreachLVLFalmerServant: the Falmer's human and mer thralls (Imperial, Khajiit, Nord, Orc, Redguard); whether
            # they fight is their faction's and package's business, which a server copy does not carry, so they wait on Nate
            skipped.append([r['ref'], lo.edid(base), 'people (the Falmer\'s thralls), not spawned: ' + ', '.join(races)])
            continue
        kind = kind_of(races[-1] if races else '')
        if not kind:
            bad.append(f"{r['ref']}: {lo.edid(base)} races {races} have no Blackreach kind")
            continue
        pos = rec['pos']
        # The zone's name: wild:<kind>:b<local id>-<plugin>, as wildlife.js ownedZoneName names an owned spawn's with 'p'
        zone = 'wild:%s:b%x-%s' % (kind, k[1], re.sub(r'[^a-z0-9]', '', re.sub(r'\.es[mpl]$', '', k[0])))
        spots.append({'zone': zone, 'src': lo.desc(k), 'loadId': '%08x' % lo.load_id(k), 'nate': nate, 'kind': kind, 'boss': bool(BOSS.search(lo.edid(base))),
                      'base': lo.desc(base), 'baseType': btype, 'edid': lo.edid(base), 'races': races, 'raceKeywords': kws,
                      'person': 'ActorTypeNPC' in kws, 'world': lo.desc(BLACKREACH), 'pos': [round(v, 2) for v in pos[:3]],
                      'heading': round(math.degrees(pos[5]) % 360, 1), 'pluginDisabled': bool(rec['flags'] & DISABLED),
                      'cell': lo.edid(rec['cell']) if rec['cell'] else '',
                      'options': [[lvl, lo.desc(c), lo.edid(c)] for lvl, c in options]})

    # ---- Nate's chests --------------------------------------------------------------------------------------------
    chests = []
    for r in rows:
        if r['kind'] != 'container' or key_of(r['ref'])[0] != DLE:
            continue
        k = key_of(r['ref'])
        rec = ref_record(k)
        if not rec or lo.types.get(rec['base']) != 'CONT':
            bad.append(f"{r['ref']}: not a container in this load order")
            continue
        if rec['world'] != BLACKREACH or rec['flags'] & (DISABLED | DELETED):
            bad.append(f"{r['ref']}: chest not enabled in the Blackreach world")
            continue
        chests.append({'ref': lo.desc(k), 'loadId': '%08x' % lo.load_id(k), 'edid': lo.edid(rec['base']), 'base': lo.desc(rec['base']),
                       'pos': [round(v, 2) for v in rec['pos'][:3]], 'locked': rec['lock'], 'boss': bool(re.search(r'Boss', lo.edid(rec['base'])))})

    # ---- anchors: REFRs of a loadable type no DragonBreak plugin places or overrides ------------------------------------
    anchors = []
    for k, (p, off, sz, fl, ctx) in lo.refs_in({BLACKREACH}).items():
        if fl & (DELETED | DISABLED) or k[0] in lo.owned or p.key in lo.owned:
            continue
        d = dict(subs(p.data_at(p.fh, off, sz, fl)))
        if len(d.get(b'NAME', b'')) < 4 or len(d.get(b'DATA', b'')) < 12 or b'XESP' in d:
            continue
        if lo.types.get(lo.ref(p, d[b'NAME'])) not in OK_TYPES:
            continue
        anchors.append((k, struct.unpack('<3f', d[b'DATA'][:12])))
    grid = lambda pos: (int(pos[0] // CELL), int(pos[1] // CELL))
    for sp in spots:
        # The nearest in the spot's own exterior cell, else the nearest anywhere (PlaceAtMe puts the copy in the anchor's cell)
        own = [a for a in anchors if grid(a[1]) == grid(sp['pos'])]
        best = min(own or anchors, key=lambda a: math.dist(a[1], sp['pos']), default=None)
        if not best:
            bad.append(f"{sp['src']}: no anchor in the Blackreach world")
            continue
        sp['ref'] = lo.desc(best[0])
        sp['anchorDist'] = round(math.dist(best[1], sp['pos']))
        sp['anchorSameCell'] = bool(own)

    # ---- areas: spots and chests that stand together; a chest's guards are the spots within CHEST_REACH ---------------------
    pts = [('s', i, sp['pos']) for i, sp in enumerate(spots)] + [('c', i, ch['pos']) for i, ch in enumerate(chests)]
    parent = list(range(len(pts)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            if math.dist(pts[i][2], pts[j][2]) <= AREA_REACH:
                parent[find(i)] = find(j)
    groups = collections.defaultdict(list)
    for i, pt in enumerate(pts):
        groups[find(i)].append(pt)
    areas = []
    for n, members in enumerate(sorted(groups.values(), key=lambda m: (min(p[2][0] for p in m), min(p[2][1] for p in m)))):
        aid = 'a%02d' % (n + 1)
        cells = collections.Counter(spots[i]['cell'] for t, i, _ in members if t == 's' and spots[i]['cell'])
        for t, i, _ in members:
            (spots if t == 's' else chests)[i]['area'] = aid
        cx = sum(p[2][0] for p in members) / len(members)
        cy = sum(p[2][1] for p in members) / len(members)
        areas.append({'id': aid, 'name': cells.most_common(1)[0][0] if cells else '', 'centre': [round(cx), round(cy)],
                      'spots': sum(1 for t, _, _ in members if t == 's'), 'chests': sum(1 for t, _, _ in members if t == 'c')})
    for ch in chests:
        ch['guards'] = [sp['src'] for sp in spots if math.dist(sp['pos'], ch['pos']) <= CHEST_REACH]
        if not ch['guards']:
            bad.append(f"{ch['ref']}: no spot within {CHEST_REACH} units guards this chest")

    # ---- routes in, for the report ----------------------------------------------------------------------------------
    def door(desc):
        k = key_of(desc)
        if k not in lo.win:
            for p in lo.plugins:
                for t, fid, fl, off, sz, ctx in p.index:
                    if t == 'REFR' and lo.source(p, fid) == k:
                        lo.win[k] = (p, t, off, sz, fl, ctx)
        rec = ref_record(k)
        if not rec:
            return {'ref': desc, 'missing': True}
        return {'ref': desc, 'base': lo.edid(rec['base']), 'by': rec['by'], 'disabled': bool(rec['flags'] & DISABLED), 'deleted': bool(rec['flags'] & DELETED),
                'persistent': bool(rec['flags'] & PERSISTENT), 'pos': [round(v, 1) for v in rec['pos'][:3]] if rec['pos'] else None,
                'where': lo.edid(rec['world'] or rec['cell']) if (rec['world'] or rec['cell']) else '', 'whereDesc': lo.desc(rec['world'] or rec['cell']) if (rec['world'] or rec['cell']) else '',
                'to': lo.desc(rec['xtel']['door']) if rec['xtel'] else None, 'lock': rec['lock'] and {'level': rec['lock']['level'], 'key': lo.desc(rec['lock']['key']) if rec['lock']['key'] else None},
                'enableParent': lo.desc(rec['xesp']) if rec['xesp'] else None, 'opposite': rec['xespOpposite']}
    routes = {}
    for name, ref in [('Mzinchaleft Depths door', 'Skyrim.esm:058E22'), ('Alftand Cathedral door', 'Skyrim.esm:06998D'),
                      ('Raldbthar Deep Market door', 'Skyrim.esm:07829A'), ('Tower of Mzark lift', 'Skyrim.esm:0A0338'),
                      ('Great Lift 0EF79B', 'Skyrim.esm:0EF79B'), ('Great Lift 0EF7AA', 'Skyrim.esm:0EF7AA'), ('Great Lift 0EF933', 'Skyrim.esm:0EF933'),
                      ('Windhelm sewer tunnel door', 'DragonBreak.esp:043A82'),
                      ('Mechanism Mzinchaleft', 'Skyrim.esm:035321'), ('Mechanism Raldbthar', 'Skyrim.esm:0B56A7'),
                      ('Mechanism Alftand', 'Skyrim.esm:0A9FDA'), ('Mechanism Windhelm tunnel', 'DragonBreak.esp:04A53A'),
                      ('Return Mzinchaleft', 'Skyrim.esm:058E24'), ('Return Raldbthar', 'Skyrim.esm:04E505'), ('Return Alftand', 'Skyrim.esm:04E504'),
                      ('Return Windhelm tunnel', 'DragonBreak.esp:043AAA'), ('Raldbthar Falmer gate', 'Skyrim.esm:10D0DD'),
                      ('Aetherium Forge lift', 'Dawnguard.esm:0057ED'), ('Forge lift enable parent', 'Dawnguard.esm:0146C5')]:
        try:
            routes[name] = door(ref)
        except Exception as e:  # noqa: BLE001 - a report line, never a crash
            routes[name] = {'ref': ref, 'error': str(e)}
        d = routes[name]
        if d.get('to'):
            try:
                back = door(d['to'])
                d['toInfo'] = {k2: back.get(k2) for k2 in ('where', 'whereDesc', 'disabled', 'pos', 'to', 'base')}
            except Exception as e:  # noqa: BLE001
                d['toInfo'] = {'error': str(e)}

    out = {
        '_comment': 'Generated by tools/blackreach/blackreach_build.py from the plugins and Nate\'s Blackreach census (14 Oct). spots: '
                    'every living actor of the Blackreach world (Nate\'s DragonBreak Online Edits placements, enabled or not, and '
                    'the vanilla ones), spawned by wildlife.js as wild:<kind>:b<local id>-<plugin> zones; chests: Nate\'s ten, '
                    'looted through blackreach.js; areas: spots and chests within 3500 units of each other. The Zcells stay '
                    'dungeons.json\'s BlackreachLocation lease. Do not edit by hand; rerun the generator after a plugin changes.',
        'world': lo.desc(BLACKREACH),
        'spots': spots,
        'chests': chests,
        'areas': areas,
        'skipped': skipped,
    }
    # Every load door of Raldbthar02 (the Deep Market): where the Falmer gate 10D0DD stands against the way to the mechanism
    deep = key_of('Skyrim.esm:078124')
    raldbthar = []
    for k, (p, off, sz, fl, ctx) in lo.refs_in({deep}).items():
        d = dict(subs(p.data_at(p.fh, off, sz, fl)))
        if b'XTEL' in d and len(d.get(b'DATA', b'')) >= 12:
            raldbthar.append({'ref': lo.desc(k), 'pos': [round(v) for v in struct.unpack('<3f', d[b'DATA'][:12])],
                              'to': lo.desc(lo.ref(p, d[b'XTEL'])), 'disabled': bool(fl & DISABLED)})
    report = {'raldbtharDoors': raldbthar, 'routes': routes, 'anchors': len(anchors), 'skipped': skipped}
    return out, report, bad


if __name__ == '__main__':
    sys.exit(main())
