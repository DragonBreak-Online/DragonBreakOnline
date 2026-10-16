"""Every creature base the wildlife spawners can place, with what its death item holds at level 1 (the server rolls death
items at player level 1, MpActor::EvaluateDeathItem). tests/skin-every-creature-harness.js runs gamemode.js's skinning rule
over this list and fails when a creature would have nothing to skin (Nate, 16 Oct: "all wild life needs to b able to be
skinned for pelts etc.").

    sudo python3 tools/skinning/skin_census.py [out.json]     (default tests/fixtures/wildlife-skin-census.json)

Reads the live plugins read only (/opt/skyrim-data and its loadorder.txt; DBO_DATA overrides the folder) and the spawn data in
this checkout: wildlife.json options, owned-spawns.json and blackreach.json bases. Only the top-level record groups it needs
are read (no cells), so it takes a few seconds and ~300 MB. Rerun after a plugin or wildlife.json change and commit the diff.

The death item follows the template chain while the NPC uses its template's traits (ACBS template flags 0x1, the flag the
server's EvaluateTemplate<UseTraits> reads; ACBS offset 18 as libespm NPC_.cpp reads it). Leveled entries above level 1
are left out, as the server leaves them out."""
import os, sys, json, re, struct, zlib
HERE = os.path.dirname(os.path.abspath(__file__)); SRV = os.path.dirname(os.path.dirname(HERE))
DATA = os.environ.get('DBO_DATA') or '/opt/skyrim-data'
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SRV, 'tests', 'fixtures', 'wildlife-skin-census.json')
TYPES = {t.encode() for t in ('NPC_', 'LVLN', 'LVLI', 'MISC', 'INGR', 'ALCH', 'ARMO', 'WEAP', 'AMMO', 'BOOK', 'SLGM', 'KEYM', 'SCRL', 'LIGH')}


def subs(data):
    pos, n, big = 0, len(data), None
    while pos + 6 <= n:
        sig = data[pos:pos+4]; sz = struct.unpack_from('<H', data, pos+4)[0]; pos += 6
        if big is not None: sz, big = big, None
        if sig == b'XXXX': big = struct.unpack_from('<I', data, pos)[0]; pos += sz; continue
        yield sig, data[pos:pos+sz]; pos += sz


plugins = [l.strip().lstrip('*') for l in open(os.path.join(DATA, 'loadorder.txt'), encoding='utf-8-sig')]
plugins = [p for p in plugins if p and not p.startswith('#') and os.path.exists(os.path.join(DATA, p))]
masters, rec = {}, {}


def canon(plugin, fid):
    m = masters[plugin]; mi = fid >> 24
    return '%x:%s' % (fid & 0xffffff, m[mi] if mi < len(m) else plugin)


for name in plugins:
    buf = open(os.path.join(DATA, name), 'rb').read()
    hsz = struct.unpack_from('<I', buf, 4)[0]
    masters[name] = [v.rstrip(b'\0').decode('cp1252') for s, v in subs(buf[24:24+hsz]) if s == b'MAST']
    pos = 24 + hsz
    while pos < len(buf):
        gsz = struct.unpack_from('<I', buf, pos+4)[0]
        if buf[pos+8:pos+12] in TYPES:
            p, end = pos + 24, pos + gsz
            while p < end:
                sig = buf[p:p+4]; sz, fl, fid = struct.unpack_from('<III', buf, p+4)
                if sig == b'GRUP': p += sz; continue
                body = buf[p+24:p+24+sz]
                if fl & 0x40000: body = zlib.decompress(body[4:])
                key = canon(name, fid).lower()
                if fl & 0x20: rec.pop(key, None)
                else: rec[key] = (sig.decode(), list(subs(body)), name)
                p += 24 + sz
        pos += gsz
    del buf


def get(c): return rec.get(c.lower()) if c else None
def edid(c):
    r = get(c)
    return next((v.rstrip(b'\0').decode('cp1252', 'replace') for s, v in r[1] if s == b'EDID'), '') if r else None
def ref(plugin, raw): return canon(plugin, raw)


def npcs(c, seen):
    """concrete NPC_ (and the death item its traits come from) for a base or a leveled list"""
    if not c or c.lower() in seen: return []
    seen.add(c.lower())
    r = get(c)
    if not r: return []
    t, f, p = r
    if t == 'LVLN':
        return [x for s, v in f if s == b'LVLO' for x in npcs(ref(p, struct.unpack_from('<I', v, 4)[0]), seen)]
    if t != 'NPC_': return []
    acbs = next((v for s, v in f if s == b'ACBS'), b'')
    traits = len(acbs) >= 20 and struct.unpack_from('<H', acbs, 18)[0] & 1
    tplt = next((ref(p, struct.unpack('<I', v[:4])[0]) for s, v in f if s == b'TPLT'), None)
    if tplt and traits:
        return [(c, d) for _, d in npcs(tplt, seen)]
    inam = next((ref(p, struct.unpack('<I', v[:4])[0]) for s, v in f if s == b'INAM'), None)
    return [(c, inam)]


def items(c, seen, depth=0):
    if not c or c.lower() in seen or depth > 12: return set()
    seen.add(c.lower())
    r = get(c)
    if not r: return set()
    t, f, p = r
    if t != 'LVLI': return {c}
    out = set()
    for s, v in f:
        if s == b'LVLO' and struct.unpack_from('<H', v, 0)[0] <= 1:
            out |= items(ref(p, struct.unpack_from('<I', v, 4)[0]), seen, depth + 1)
    return out


bases = {}
def add(desc, kind):
    if isinstance(desc, str) and re.match(r'^[0-9a-f]+:[^:]+\.es[mpl]$', desc, re.I) and get(desc) and get(desc)[0] in ('NPC_', 'LVLN'):
        bases.setdefault(desc, set()).add(kind)
for pl in json.load(open(os.path.join(SRV, 'wildlife.json')))['placements']:
    for o in pl.get('options') or []: add(o[1], 'wildlife:' + pl['kind'])
for fn in ('owned-spawns.json', 'blackreach.json'):
    path = os.path.join(SRV, fn)
    if not os.path.exists(path): continue
    def walk(x, kind):
        if isinstance(x, dict):
            k = str(x.get('kind') or kind)
            for v in x.values():
                if isinstance(v, str): add(v, fn.split('.')[0] + ':' + k)
                else: walk(v, k)
        elif isinstance(x, list):
            for v in x:
                if isinstance(v, str): add(v, fn.split('.')[0] + ':' + kind)
                else: walk(v, kind)
    walk(json.load(open(path)), '')

rows, done = [], set()
for b in sorted(bases):
    for npc, di in npcs(b, set()):
        if (npc.lower(), str(di).lower()) in done: continue
        done.add((npc.lower(), str(di).lower()))
        its = []
        for i in sorted(items(di, set())):
            r = get(i)
            its.append({'desc': i, 'edid': edid(i), 'type': r[0] if r else None})
        rows.append({'npc': npc, 'npcEdid': edid(npc), 'spawnedAs': sorted(bases[b]), 'deathItem': di and edid(di), 'items': its})
json.dump({'_comment': 'Generated by tools/skinning/skin_census.py from the live plugins: every creature the wildlife spawners place and its level-1 death item contents.', 'creatures': rows}, open(OUT, 'w'), indent=1)
print('%d creature bases from %d spawn bases -> %s' % (len(rows), len(bases), OUT))
