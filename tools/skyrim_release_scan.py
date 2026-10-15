# Skyrim release scan, streamed one plugin at a time over the package load order (check 3, 15 Oct).
#  1. gate landings: terrain, navmesh under the point, boxes holding the point, and up to N spread spots on flat navmesh
#     near it that no object's box holds (feet, waist, head);
#  2. every winning ACHR: world/cell, base, flags (the living-actor census for the xEdit disable pass);
#  3. every load door (XTEL): where it stands and where it leads (doors from open places into closed lands).
# usage: python3 tools/skyrim_release_scan.py <gamemode-config.json> <outdir> [name=x,y,z ...]   (points override the GATES centres)
import sys, os, struct, math, json, re, zlib, collections
sys.path.insert(0, os.path.expanduser('~/dragonbreak/ck-mcp'))
import esplib
PKG = os.path.expanduser('~/inbox/2026-10-14-skyrim-release')
ORDER = [l.strip() for l in open(PKG + '/skyrim-data/loadorder.txt') if l.strip()]
def path_of(n):
    q = PKG + '/plugins/' + n
    return q if os.path.exists(q) else '/opt/skyrim-data/' + n
cfg = json.load(open(sys.argv[1])); OUT = sys.argv[2]
CLOSED = {p.lower() for p in cfg['playtest'].get('closedPlugins', [])}
TAM = '3c:skyrim.esm'
GATES = {'Whiterun': [18313, -10665, -4540], 'Riften': [173137, -90912, 11150], 'Solitude': [-74344, 96470, -11460],
         'Windhelm': [135039, 33143, -12525], 'Markarth': [-171097, 6922, -3890], 'Falkreath': [-30296, -86284, -3060],
         'Morthal': [-38640, 66734, -13200], 'Dawnstar': [30808, 106138, -13870], 'Winterhold': [109208, 102864, -8960]}
for a in sys.argv[3:]:
    k, v = a.split('='); GATES[k] = [float(x) for x in v.split(',')]
grids = {(math.floor(p[0] / 4096) + dx, math.floor(p[1] / 4096) + dy) for p in GATES.values() for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
BASETYPES = {'STAT', 'MSTT', 'FURN', 'DOOR', 'CONT', 'ACTI', 'TREE', 'FLOR', 'LIGH', 'MISC', 'SCOL', 'NPC_', 'TACT', 'MOVS', 'IDLM', 'LVLN', 'WEAP', 'ARMO', 'BOOK', 'ALCH', 'INGR', 'KEYM', 'AMMO', 'SLGM', 'HAZD', 'GRAS', 'TXST', 'SOUN', 'ADDN', 'SPEL'}
basesrc, cells, land, navm, refs, achr, doors, worlds = {}, {}, {}, {}, {}, {}, {}, {}
def first(d):
    o = {}
    for s, v in esplib.subrecords(d):
        if s not in o: o[s] = bytes(v)
    return o
for n in ORDER:
    path = path_of(n); size = os.path.getsize(path)
    p = esplib.Plugin(path)
    assert p._size == size, ('short read', n, p._size, size)
    fh = open(path, 'rb')
    def nm(fid):
        s, l = p.modindex_source(fid); return f'{l:x}:{s}'
    for (t, fid, fl, off, sz, ctx) in p.index:
        if t in BASETYPES:
            basesrc[nm(fid)] = (path, off, sz, fl, t)
        elif t == 'WRLD':
            worlds[nm(fid)] = first(p.data_at(fh, off, sz, fl)).get(b'EDID', b'').rstrip(b'\0').decode('cp1252', 'replace')
        elif t == 'CELL':
            sub = first(p.data_at(fh, off, sz, fl)); key = nm(fid)
            g = struct.unpack('<ii', sub[b'XCLC'][:8]) if len(sub.get(b'XCLC', b'')) >= 8 else None
            cells[key] = {'world': nm(ctx[0]) if ctx[0] else None, 'grid': g, 'edid': sub.get(b'EDID', b'').rstrip(b'\0').decode('cp1252', 'replace'),
                          'by': n, 'flags': fl}
        elif t == 'LAND' and ctx[0] and nm(ctx[0]) == TAM:
            c = cells.get(nm(ctx[1])) if ctx[1] else None
            if c and c['grid'] and tuple(c['grid']) in grids:
                v = first(p.data_at(fh, off, sz, fl)).get(b'VHGT')
                if v: land[tuple(c['grid'])] = (v[:1093], n)
        elif t == 'NAVM' and ctx[0] and nm(ctx[0]) == TAM:
            c = cells.get(nm(ctx[1])) if ctx[1] else None
            if c and c['grid'] and tuple(c['grid']) in grids:
                v = first(p.data_at(fh, off, sz, fl)).get(b'NVNM')
                navm[nm(fid)] = (tuple(c['grid']), fl, v, n)
        elif t in ('REFR', 'ACHR'):
            key = nm(fid); w = nm(ctx[0]) if ctx[0] else None; c = nm(ctx[1]) if ctx[1] else None
            d = p.data_at(fh, off, sz, fl); sub = first(d)
            pos = struct.unpack('<6f', sub[b'DATA'][:24]) if len(sub.get(b'DATA', b'')) >= 24 else None
            base = nm(struct.unpack('<I', sub[b'NAME'][:4])[0]) if b'NAME' in sub else None
            rec = {'base': base, 'pos': [round(x, 1) for x in pos[:3]] if pos else None, 'rz': pos[5] if pos else 0, 'flags': fl, 'by': n, 'world': w, 'cell': c,
                   'scale': struct.unpack('<f', sub[b'XSCL'][:4])[0] if b'XSCL' in sub else 1.0, 'xesp': b'XESP' in sub}
            if t == 'ACHR':
                if key in achr and not rec['pos']: achr[key].update(flags=fl, by=n)
                else: achr[key] = rec
                continue
            if len(sub.get(b'XTEL', b'')) >= 4:
                doors[key] = dict(rec, to=nm(struct.unpack('<I', sub[b'XTEL'][:4])[0]))
            elif key in doors:
                doors[key].update(flags=fl, by=n)
            if w == TAM and pos and (math.floor(pos[0] / 4096), math.floor(pos[1] / 4096)) in grids or key in refs:
                if key in refs and not pos: refs[key].update(flags=fl, by=n)
                else: refs[key] = rec
    fh.close(); del p
    print('scanned', n, file=sys.stderr, flush=True)
bases = {}
def base_info(b):
    if b in bases: return bases[b]
    s = basesrc.get(b); r = None
    if s:
        with open(s[0], 'rb') as f:
            f.seek(s[1]); d = f.read(s[2])
        if s[3] & esplib.CMP: d = zlib.decompress(d[4:])
        sub = first(d)
        r = {'type': s[4], 'edid': sub.get(b'EDID', b'').rstrip(b'\0').decode('cp1252', 'replace'),
             'obnd': list(struct.unpack('<6h', sub[b'OBND'][:12])) if len(sub.get(b'OBND', b'')) >= 12 else None}
    bases[b] = r; return r
# ---- terrain and navmesh ----
def heights(v):
    off = struct.unpack('<f', v[:4])[0]; dd = struct.unpack('<1089b', v[4:1093]); out = [[0.0] * 33 for _ in range(33)]; row = off
    for y in range(33):
        row += dd[y * 33]; col = row; out[y][0] = col * 8
        for x in range(1, 33): col += dd[y * 33 + x]; out[y][x] = col * 8
    return out
def terrain(x, y):
    g = (math.floor(x / 4096), math.floor(y / 4096))
    if g not in land: return None
    h = heights(land[g][0]); lx, ly = (x - g[0] * 4096) / 128, (y - g[1] * 4096) / 128
    i, j = min(int(lx), 31), min(int(ly), 31); fx, fy = lx - i, ly - j
    return h[j][i] * (1 - fx) * (1 - fy) + h[j][i + 1] * fx * (1 - fy) + h[j + 1][i] * (1 - fx) * fy + h[j + 1][i + 1] * fx * fy
def parse_nvnm(v):
    i = 16; nv = struct.unpack_from('<I', v, i)[0]; i += 4
    verts = [struct.unpack_from('<3f', v, i + 12 * k) for k in range(nv)]; i += 12 * nv
    nt = struct.unpack_from('<I', v, i)[0]; i += 4
    tris = [struct.unpack_from('<3h', v, i + 16 * k) for k in range(nt)]
    return verts, [t for t in tris if all(0 <= q < nv for q in t)]
mesh = []
for nid, (g, fl, v, n) in navm.items():
    if fl & 0x20 or not v: continue
    verts, tris = parse_nvnm(v)
    for a, b, c in tris: mesh.append((verts[a], verts[b], verts[c], nid))
def tri_z(P, A, B, C):
    den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1])
    if abs(den) < 1e-9: return None
    l1 = ((B[1] - C[1]) * (P[0] - C[0]) + (C[0] - B[0]) * (P[1] - C[1])) / den
    l2 = ((C[1] - A[1]) * (P[0] - C[0]) + (A[0] - C[0]) * (P[1] - C[1])) / den
    l3 = 1 - l1 - l2
    if min(l1, l2, l3) < -1e-6: return None
    return l1 * A[2] + l2 * B[2] + l3 * C[2]
SKIP = re.compile(r'(?i)marker|critter|fx|lightbeam|fog|mist|ambient|sound|lod|trigger|collision|snowdrift|navcut|road|perch|mountain|cliff|ice ?floe')
def solid(P, near=3000):
    hits = []
    for key, r in refs.items():
        if r['world'] != TAM or not r['pos'] or r['flags'] & 0x820 or r['pos'][2] < -20000: continue
        if abs(r['pos'][0] - P[0]) > near or abs(r['pos'][1] - P[1]) > near: continue
        b = base_info(r['base'])
        if not b or not b['obnd'] or b['type'] not in ('STAT', 'SCOL', 'MSTT', 'FURN', 'CONT', 'ACTI', 'TREE', 'DOOR', 'FLOR', 'MISC') or SKIP.search(b['edid']): continue
        x1, y1, z1, x2, y2, z2 = b['obnd']; s = r['scale'] or 1; c, sn = math.cos(r['rz']), math.sin(r['rz'])
        dx, dy = P[0] - r['pos'][0], P[1] - r['pos'][1]
        lx, ly = (dx * c - dy * sn) / s, (dx * sn + dy * c) / s
        if not (x1 - 24 <= lx <= x2 + 24 and y1 - 24 <= ly <= y2 + 24): continue
        for zz in (P[2] + 10, P[2] + 64, P[2] + 120):
            lz = (zz - r['pos'][2]) / s
            if z1 <= lz <= z2: hits.append((b['edid'], key, r['by'])); break
    return hits
def nav_under(P):
    zs = [tri_z(P, A, B, C) for A, B, C, _ in mesh if min(A[0], B[0], C[0]) <= P[0] <= max(A[0], B[0], C[0]) and min(A[1], B[1], C[1]) <= P[1] <= max(A[1], B[1], C[1])]
    return sorted(round(z, 1) for z in zs if z is not None)
report = {}
for name, P in GATES.items():
    under = nav_under(P)
    near_nav = min(under, key=lambda z: abs(z - P[2])) if under else None
    t = terrain(P[0], P[1])
    entry = {'pos': P, 'terrain': None if t is None else round(t, 1), 'navmeshUnder': under, 'navNearestZ': near_nav,
             'aboveNav': None if near_nav is None else round(P[2] - near_nav, 1), 'blockedBy': solid(P)}
    # spread spots: flat navmesh triangle centres near the point, clear of every box, 110 apart, close in height. The first
    # is the centre: the landing itself when it stands on navmesh and in no box, else the nearest good triangle
    def cands_near(Q, zref, radius):
        out = []
        for A, B, C, nid in mesh:
            cx, cy, cz = (A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3
            d = math.hypot(cx - Q[0], cy - Q[1])
            if d > radius: continue
            area = abs((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 2
            if area < 1500 or max(A[2], B[2], C[2]) - min(A[2], B[2], C[2]) > 60: continue
            if zref is not None and abs(cz - zref) > 150: continue
            out.append((d, round(cx, 1), round(cy, 1), round(cz, 1)))
        return sorted(out)
    ok_here = near_nav is not None and abs(P[2] - near_nav) <= 120 and not entry['blockedBy']
    if ok_here:
        center = [P[0], P[1], round(near_nav + 20, 1)]
    else:
        center = None
        for d, x, y, z in cands_near(P, None, 1500):
            if not solid([x, y, z], 1500): center = [x, y, round(z + 20, 1)]; break
    entry['centre'] = center; entry['centreMoved'] = None if not center else round(math.hypot(center[0] - P[0], center[1] - P[1]))
    spots = [center] if center else []
    if center:
        for d, x, y, z in cands_near(center, center[2] - 20, 500):
            if any(math.hypot(x - s[0], y - s[1]) < 110 for s in spots): continue
            if solid([x, y, z], 1500): continue
            spots.append([x, y, round(z + 20, 1)])
            if len(spots) >= 6: break
    entry['spots'] = spots
    report[name] = entry
    print(name, json.dumps({k: entry[k] for k in ('terrain', 'navNearestZ', 'aboveNav', 'centre', 'centreMoved')}), 'blocked', entry['blockedBy'][:3], 'spots', len(spots), file=sys.stderr)
json.dump(report, open(OUT + '/landings.json', 'w'), indent=1)
# ---- living ACHRs in open places ----
def place_of(r):
    if r['world']: return r['world'], worlds.get(r['world'], ''), False
    c = cells.get(r['cell'] or '', {}); return r['cell'], c.get('edid', ''), True
rows = []
for key, r in achr.items():
    if r['flags'] & 0x20 or r['flags'] & 0x800 or r['flags'] & 0x200: continue   # deleted, initially disabled, starts dead
    if r['pos'] and r['pos'][2] < -20000: continue
    where, wname, interior = place_of(r)
    origin = (where or ':').split(':', 1)[1]
    if origin in CLOSED or key.split(':', 1)[1] in CLOSED: continue
    if where == '17482:dragonbreak hub.esp': continue
    b = base_info(r['base']) or {}
    rows.append({'ref': key, 'by': r['by'], 'base': r['base'], 'baseEdid': b.get('edid', ''), 'baseType': b.get('type', ''),
                 'place': where, 'placeEdid': wname, 'interior': interior, 'pos': r['pos'], 'xesp': r['xesp']})
json.dump(rows, open(OUT + '/achr-living.json', 'w'))
print('living ACHRs in open places', len(rows), file=sys.stderr)
# ---- load doors from open places into closed lands ----
def origin_plugin(desc): return (desc or ':').split(':', 1)[1]
out = []
for key, d in doors.items():
    if d['flags'] & 0x20: continue
    here = d['world'] or (cells.get(d['cell'] or '', {}).get('world') if d['cell'] else None) or d['cell']
    tgt = doors.get(d['to'])
    there = None
    if tgt: there = tgt['world'] or (cells.get(tgt['cell'] or '', {}).get('world') if tgt['cell'] else None) or tgt['cell']
    if there and origin_plugin(there) in CLOSED and origin_plugin(here) not in CLOSED:
        out.append({'door': key, 'by': d['by'], 'at': here, 'atName': worlds.get(here, cells.get(here, {}).get('edid', '')), 'to': there,
                    'toName': worlds.get(there, cells.get(there, {}).get('edid', '')), 'disabled': bool(d['flags'] & 0x800), 'pos': d['pos'],
                    'base': (base_info(d['base']) or {}).get('edid', '')})
json.dump(out, open(OUT + '/closing-doors.json', 'w'), indent=1)
print('doors from open into closed', len(out), file=sys.stderr)
