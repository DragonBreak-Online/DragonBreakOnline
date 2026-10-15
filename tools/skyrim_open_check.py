"""Opening Skyrim (check 3, 15 Oct): the hub gate landings, the Realm's creator spots, the hub's own form id, and the load
doors from open places into closed lands, all read from the NEW load order (the Skyrim release package).

Reads each plugin from the package's plugins/ when it is there (new or changed), else from /opt/skyrim-data, read-only,
through ck-mcp/esplib.py, in the order of the package's skyrim-data/loadorder.txt.

For each GATES landing (gamemode.js, Tamriel) and each startPoints creator spot (the Realm):
  - the cell (grid) and whether a CELL exists for it, the winning LAND's terrain height under the point;
  - navmesh: the winning NAVM records of that cell and its 8 neighbours; whether a triangle lies under the point, how far
    the nearest triangle is, and the navmesh height there;
  - geometry: every enabled reference whose base's OBND box (scaled, turned by its Z rotation) holds the point;
  - living actors: enabled ACHRs within 12288 units (the grid a load brings in; memory login-hang-is-vanilla-creature-
    pathing), not deleted, not initially disabled, not "starts dead".
Then every load door (XTEL) in a closed land whose other side stands in an open place: the doors the lock should refuse.
Memory: ~2 GB, a few minutes. Run under ionice -c3 nice -n19.
  python3 tools/skyrim_open_check.py <package dir> <gamemode-config.json> <out.json>
"""
import sys, os, struct, math, json, re, collections

sys.path.insert(0, os.path.expanduser('~/dragonbreak/ck-mcp'))
from esplib import Plugin, subrecords, edid_of

PKG, CFG, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
DATA = '/opt/skyrim-data'
order = [l.strip() for l in open(os.path.join(PKG, 'skyrim-data', 'loadorder.txt')) if l.strip() and not l.startswith('#')]
cfg = json.load(open(CFG))
closed = set(p.lower() for p in cfg['playtest'].get('closedPlugins', []))

plugins = []
for name in order:
    p = os.path.join(PKG, 'plugins', name)
    if not os.path.exists(p):
        p = os.path.join(DATA, name)
    plugins.append(Plugin(p))
    print('read', name, len(plugins[-1].index), file=sys.stderr)
by_key = {p.key: p for p in plugins}

# ---- load-order indices (full plugins count up, ESL-flagged ones share FE) ----
full = 0; light = 0; slot = {}
for p in plugins:
    if p.esl:
        slot[p.key] = 0xFE000 | light; light += 1
    else:
        slot[p.key] = full; full += 1
hub_index = slot['dragonbreak hub.esp']

def local_to(p, key, local):
    ms = [m.lower() for m in p.masters]
    if key == p.key:
        return (len(ms) << 24) | local
    if key in ms:
        return (ms.index(key) << 24) | local
    return None

def res(p, fid):
    src, loc = p.modindex_source(fid)
    return (src, loc)

# ---- points ----
src = open(os.path.join(os.path.dirname(CFG), 'gamemode.js'), encoding='utf8').read()
gates = re.findall(r"^\s+(a00\d): \['(\w+)', \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\], (-?\d+)\]", src, re.M)
POINTS = [('gate ' + g[1], 'skyrim.esm', 0x3C, (float(g[2]), float(g[3]), float(g[4]))) for g in gates]
spots = json.load(open(sys.argv[4])) if len(sys.argv) > 4 else []
for i, s in enumerate(spots):
    POINTS.append(('creator spot %d' % i, 'dragonbreak hub.esp', 0x17482, tuple(s['pos'])))
WORLDS = set((k, w) for _, k, w, _ in POINTS)

# per world: cell fid (resolved) -> grid; collect grids of interest
want_grids = collections.defaultdict(set)
for _, k, w, pos in POINTS:
    gx, gy = math.floor(pos[0] / 4096), math.floor(pos[1] / 4096)
    for dx in range(-3, 4):
        for dy in range(-3, 4):
            want_grids[(k, w)].add((gx + dx, gy + dy))

cells = {}          # (world key) -> {resolved cell -> grid}
land = {}           # (world, grid) -> VHGT
navm = {}           # resolved navm -> (world, grid, flags, NVNM bytes)
refs = {}           # resolved ref -> (sig, world, grid, base resolved, pos, scale, flags, xesp, plugin)
pers = {}
for p in plugins:
    with open(p.path, 'rb') as fh:
        Wmap = {}
        for wk in WORLDS:
            W = local_to(p, wk[0], wk[1])
            if W is not None:
                Wmap[W] = wk
        if not Wmap:
            continue
        grid_of = {}
        for sig, fid, flags, off, size, ctx in p.index:
            if sig == 'CELL' and ctx[0] in Wmap:
                g = None
                for s, v in subrecords(p.data_at(fh, off, size, flags)):
                    if s == b'XCLC':
                        g = struct.unpack_from('<ii', v)
                grid_of[fid] = g
                cells.setdefault(Wmap[ctx[0]], {})[res(p, fid)] = g
        for sig, fid, flags, off, size, ctx in p.index:
            if ctx[0] not in Wmap or sig not in ('LAND', 'NAVM', 'REFR', 'ACHR'):
                continue
            wk = Wmap[ctx[0]]
            g = grid_of.get(ctx[1])
            if g is None:
                g = cells.get(wk, {}).get(res(p, ctx[1]))
            if g is not None and tuple(g) not in want_grids[wk] and sig != 'ACHR':
                continue
            d = p.data_at(fh, off, size, flags)
            if sig == 'LAND':
                if g is None:
                    continue
                for s, v in subrecords(d):
                    if s == b'VHGT':
                        land[(wk, tuple(g))] = v
            elif sig == 'NAVM':
                for s, v in subrecords(d):
                    if s == b'NVNM':
                        navm[res(p, fid)] = (wk, tuple(g) if g else None, flags, v, p.name)
            else:
                base = None; pos = None; scale = 1.0; xesp = None
                for s, v in subrecords(d):
                    if s == b'NAME': base = struct.unpack('<I', v[:4])[0]
                    elif s == b'DATA' and len(v) >= 24: pos = struct.unpack_from('<6f', v)
                    elif s == b'XSCL': scale = struct.unpack('<f', v[:4])[0]
                    elif s == b'XESP': xesp = struct.unpack('<II', v[:8])
                if pos is None:
                    continue
                refs[res(p, fid)] = (sig, wk, g, res(p, base) if base is not None else None, pos, scale, flags, xesp, p.name)
print('cells', {str(k): len(v) for k, v in cells.items()}, 'land', len(land), 'navm', len(navm), 'refs', len(refs), file=sys.stderr)

# ---- bases: type, editor id and OBND of every base a nearby ref uses ----
need = set(r[3] for r in refs.values() if r[3])
bases = {}
for p in plugins:
    with open(p.path, 'rb') as fh:
        for sig, fid, flags, off, size, ctx in p.index:
            if sig in ('REFR', 'ACHR', 'CELL', 'LAND', 'NAVM', 'WRLD', 'DIAL', 'INFO'):
                continue
            k = res(p, fid)
            if k not in need:
                continue
            d = p.data_at(fh, off, size, flags)
            ob = None
            for s, v in subrecords(d):
                if s == b'OBND' and len(v) >= 12:
                    ob = struct.unpack('<6h', v[:12])
            bases[k] = (sig, edid_of(d) or '', ob, p.name)

def heights(v):
    off = struct.unpack('<f', v[:4])[0]
    d = struct.unpack('<1089b', v[4:4 + 1089])
    out = [[0.0] * 33 for _ in range(33)]
    row = off
    for y in range(33):
        row += d[y * 33]; col = row; out[y][0] = col * 8
        for x in range(1, 33):
            col += d[y * 33 + x]; out[y][x] = col * 8
    return out

def terrain(wk, x, y):
    g = (math.floor(x / 4096), math.floor(y / 4096))
    v = land.get((wk, g))
    if v is None:
        return None
    t = heights(v)
    lx = (x - g[0] * 4096) / 128.0; ly = (y - g[1] * 4096) / 128.0
    c0, r0 = min(int(lx), 31), min(int(ly), 31)
    fx, fy = lx - c0, ly - r0
    return (t[r0][c0] * (1 - fx) * (1 - fy) + t[r0][c0 + 1] * fx * (1 - fy) + t[r0 + 1][c0] * (1 - fx) * fy + t[r0 + 1][c0 + 1] * fx * fy)

def parse_nvnm(v):
    """vertices, triangles (SSE NVNM: version, magic, parent world + grid or cell, verts, tris of 16 bytes)."""
    ver, magic, parent = struct.unpack_from('<III', v, 0)
    i = 12 + 4                          # world -> int16 gridY, gridX; interior -> cell fid: 4 bytes either way
    nv = struct.unpack_from('<I', v, i)[0]; i += 4
    verts = [struct.unpack_from('<3f', v, i + 12 * k) for k in range(nv)]; i += 12 * nv
    nt = struct.unpack_from('<I', v, i)[0]; i += 4
    tris = [struct.unpack_from('<3h', v, i + 16 * k) for k in range(nt)]
    ok = all(0 <= a < nv and 0 <= b < nv and 0 <= c < nv for a, b, c in tris)
    return verts, tris, ok

def tri_z(p, a, b, c):
    (x1, y1, z1), (x2, y2, z2), (x3, y3, z3) = a, b, c
    den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
    if abs(den) < 1e-9:
        return None
    l1 = ((y2 - y3) * (p[0] - x3) + (x3 - x2) * (p[1] - y3)) / den
    l2 = ((y3 - y1) * (p[0] - x3) + (x1 - x3) * (p[1] - y3)) / den
    l3 = 1 - l1 - l2
    if min(l1, l2, l3) < -1e-6:
        return None
    return l1 * z1 + l2 * z2 + l3 * z3

def seg_dist(px, py, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy))

report = {'hubIndex': '0x%02X' % hub_index, 'hubWorldId': '0x%08X' % ((hub_index << 24) | 0x17482), 'points': []}
nav_cache = {}
for label, k, w, pos in POINTS:
    wk = (k, w)
    gx, gy = math.floor(pos[0] / 4096), math.floor(pos[1] / 4096)
    has_cell = any(g is not None and tuple(g) == (gx, gy) for g in cells.get(wk, {}).values())
    t = terrain(wk, pos[0], pos[1])
    # navmesh
    under = []; nearest = None
    for nid, (nwk, ng, nflags, v, pname) in navm.items():
        if nwk != wk or ng is None or abs(ng[0] - gx) > 1 or abs(ng[1] - gy) > 1 or nflags & 0x20:
            continue
        if nid not in nav_cache:
            nav_cache[nid] = parse_nvnm(v)
        verts, tris, ok = nav_cache[nid]
        if not ok:
            report.setdefault('navmParseErrors', []).append(str(nid)); continue
        for a, b, c in tris:
            A, B, C = verts[a], verts[b], verts[c]
            z = tri_z(pos, A, B, C)
            if z is not None:
                under.append({'navm': '%06X:%s' % (nid[1], nid[0]), 'z': round(z, 1), 'by': pname})
            dd = min(seg_dist(pos[0], pos[1], A, B), seg_dist(pos[0], pos[1], B, C), seg_dist(pos[0], pos[1], C, A)) if z is None else 0
            if nearest is None or dd < nearest[0]:
                nearest = (round(dd, 1), round((A[2] + B[2] + C[2]) / 3, 1))
    # geometry holding the point; living actors in the load grid
    inside = []; actors = collections.Counter(); actors_xesp = 0; near = []
    for rid, (sig, rwk, g, base, rpos, scale, flags, xesp, pname) in refs.items():
        if rwk != wk:
            continue
        dist = math.hypot(rpos[0] - pos[0], rpos[1] - pos[1])
        if flags & 0x20 or flags & 0x800 or rpos[2] < -20000:
            continue
        if sig == 'ACHR':
            if dist <= 12288 and not flags & 0x200:
                b = bases.get(base)
                actors[(b[1] if b else '?')] += 1
                if xesp: actors_xesp += 1
            continue
        if dist > 3000:
            continue
        b = bases.get(base)
        if not b or not b[2]:
            continue
        x1, y1, z1, x2, y2, z2 = b[2]
        rz = rpos[5]
        dx, dy = pos[0] - rpos[0], pos[1] - rpos[1]
        lx = (dx * math.cos(rz) - dy * math.sin(rz)) / (scale or 1)
        ly = (dx * math.sin(rz) + dy * math.cos(rz)) / (scale or 1)
        lz = (pos[2] - rpos[2]) / (scale or 1)
        if x1 <= lx <= x2 and y1 <= ly <= y2 and z1 - 10 <= lz <= z2:
            inside.append({'ref': '%06X:%s' % (rid[1], rid[0]), 'base': b[1], 'type': b[0], 'dist': round(dist), 'by': pname,
                           'aboveBase': round(pos[2] - (rpos[2] + z1 * scale)), 'belowTop': round(rpos[2] + z2 * scale - pos[2])})
        if dist < 400 and b[0] in ('STAT', 'MSTT', 'FURN', 'CONT', 'DOOR', 'ACTI', 'TREE', 'FLOR'):
            near.append((round(dist), b[1], pname))
    report['points'].append({
        'label': label, 'world': '%x:%s' % (w, k), 'pos': pos, 'grid': [gx, gy], 'cellExists': has_cell,
        'terrainZ': None if t is None else round(t, 1), 'aboveTerrain': None if t is None else round(pos[2] - t, 1),
        'navmeshUnder': under, 'nearestNavmesh': nearest, 'insideBounds': inside,
        'nearObjects': sorted(near)[:8],
        'livingActorsInGrid': sum(actors.values()), 'livingActorsWithEnableParent': actors_xesp, 'actorBases': actors.most_common(12),
    })

# ---- a better landing where a gate's lands badly: navmesh triangle centres near it, clear of every object's box ----
SKIP = re.compile(r'(?i)mountain|cliff|snowdrift|rockpile|fx|marker|critter|lightbeam|fog|mist|ambient|sound|water|lod|xmarker')
def blocked_at(wk, x, y, z):
    for rid, (sig, rwk, g, base, rpos, scale, flags, xesp, pname) in refs.items():
        if rwk != wk or sig != 'REFR' or flags & 0x20 or flags & 0x800 or rpos[2] < -20000:
            continue
        if abs(rpos[0] - x) > 3000 or abs(rpos[1] - y) > 3000:
            continue
        b = bases.get(base)
        if not b or not b[2] or SKIP.search(b[1]) or b[0] not in ('STAT', 'MSTT', 'FURN', 'CONT', 'ACTI', 'TREE', 'DOOR', 'MISC', 'FLOR'):
            continue
        x1, y1, z1, x2, y2, z2 = b[2]; rz = rpos[5]; sc = scale or 1
        dx, dy = x - rpos[0], y - rpos[1]
        lx = (dx * math.cos(rz) - dy * math.sin(rz)) / sc; ly = (dx * math.sin(rz) + dy * math.cos(rz)) / sc
        for zz in (z + 10, z + 64, z + 120):          # feet, waist, head
            lz = (zz - rpos[2]) / sc
            if x1 - 24 <= lx <= x2 + 24 and y1 - 24 <= ly <= y2 + 24 and z1 <= lz <= z2:
                return b[1]
    return None
for pt in report['points']:
    if not pt['label'].startswith('gate'):
        continue
    wk = ('skyrim.esm', 0x3C); x0, y0, z0 = pt['pos']
    gx, gy = pt['grid']
    cands = []
    for nid, (nwk, ng, nflags, v, pname) in navm.items():
        if nwk != wk or ng is None or abs(ng[0] - gx) > 1 or abs(ng[1] - gy) > 1 or nflags & 0x20:
            continue
        verts, tris, ok = nav_cache.get(nid) or parse_nvnm(v)
        for a, b, c in tris:
            A, B, C = verts[a], verts[b], verts[c]
            cx, cy, cz = (A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3
            d = math.hypot(cx - x0, cy - y0)
            area = abs((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 2
            if d > 900 or area < 4000 or max(A[2], B[2], C[2]) - min(A[2], B[2], C[2]) > 40:
                continue
            cands.append((d, cx, cy, cz))
    cands.sort()
    pt['blockedAtLanding'] = blocked_at(wk, x0, y0, z0)
    pt['suggest'] = None
    for d, cx, cy, cz in cands[:400]:
        if not blocked_at(wk, cx, cy, cz):
            pt['suggest'] = {'pos': [round(cx, 1), round(cy, 1), round(cz + 30, 1)], 'fromLanding': round(d)}
            break

# ---- the hub's gate doors ----
hub = by_key['dragonbreak hub.esp']
gate_info = []
with open(hub.path, 'rb') as fh:
    for sig, fid, flags, off, size, ctx in hub.index:
        if (fid >> 24) == len(hub.masters) and 0xA000 <= (fid & 0xFFFFFF) <= 0xA008:
            d = hub.data_at(fh, off, size, flags)
            gate_info.append({'id': '%x' % (fid & 0xFFFFFF), 'type': sig, 'edid': edid_of(d)})
    gbase = {(hub.key, 0xA000 + i) for i in range(9)}
    for sig, fid, flags, off, size, ctx in hub.index:
        if sig != 'REFR':
            continue
        d = hub.data_at(fh, off, size, flags)
        base = None; xtel = False; pos = None
        for s, v in subrecords(d):
            if s == b'NAME': base = res(hub, struct.unpack('<I', v[:4])[0])
            elif s == b'XTEL': xtel = True
            elif s == b'DATA': pos = struct.unpack_from('<3f', v)
        if base in gbase:
            gate_info.append({'ref': '%x' % (fid & 0xFFFFFF), 'base': '%x' % base[1], 'xtel': xtel, 'disabled': bool(flags & 0x800), 'pos': [round(c) for c in pos]})
report['hubGates'] = gate_info
json.dump(report, open(OUT, 'w'), indent=1)
print('wrote', OUT, file=sys.stderr)
