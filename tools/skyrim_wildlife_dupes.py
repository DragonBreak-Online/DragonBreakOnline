"""Plugin creatures still enabled where wildlife.json also spawns the server's copy (Purr #7DJT, 16 Oct: "when looting a
corpse it opens up the inventory and chickens drop ..."). The narrowed Skyrim actor pass (eea9898b, Nate 15 Oct) kept the
harmless plugin creatures enabled, while wildlife.json places a server creature on the same spot: a player sees two
chickens, and the plugin's one is the player's own engine copy, whose body opens the vanilla inventory. Writes the xEdit list
for DBO_SkyrimActors.pas (same line format; set its LIST_FILE), giants and mammoths apart (Nate kept the giants on 15 Oct).

    sudo python3 tools/skyrim_wildlife_dupes.py [outdir]     (default tooling/xedit-scripts)

Reads /opt/skyrim-data and its loadorder.txt read only (DBO_DATA overrides) and wildlife.json beside this folder. A ref is
counted when its winning record is not deleted, not Initially Disabled, not Starts Dead, not sunk below -20000, and its
enable parent chain (XESP, the opposite flag honoured) is enabled. Two passes over the plugins, a few seconds, ~300 MB."""
import os, sys, json, struct, zlib
HERE = os.path.dirname(os.path.abspath(__file__)); SRV = os.path.dirname(HERE)
DATA = os.environ.get('DBO_DATA') or '/opt/skyrim-data'
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SRV, 'tooling', 'xedit-scripts')


def subs(data):
    pos, n, big = 0, len(data), None
    while pos + 6 <= n:
        sig = data[pos:pos+4]; sz = struct.unpack_from('<H', data, pos+4)[0]; pos += 6
        if big is not None: sz, big = big, None
        if sig == b'XXXX': big = struct.unpack_from('<I', data, pos)[0]; pos += sz; continue
        yield sig, data[pos:pos+sz]; pos += sz


order = [l.strip().lstrip('*') for l in open(os.path.join(DATA, 'loadorder.txt'), encoding='utf-8-sig')]
order = [p for p in order if p and not p.startswith('#') and os.path.exists(os.path.join(DATA, p))]
masters, edids = {}, {}


def canon(plugin, fid):
    m = masters[plugin]; mi = fid >> 24
    return '%x:%s' % (fid & 0xffffff, m[mi] if mi < len(m) else plugin)


def scan(want):
    """winning REFR/ACHR records whose canonical id is in want"""
    out = {}
    for name in order:
        buf = open(os.path.join(DATA, name), 'rb').read()
        hsz = struct.unpack_from('<I', buf, 4)[0]
        masters[name] = [v.rstrip(b'\0').decode('cp1252') for s, v in subs(buf[24:24+hsz]) if s == b'MAST']

        def walk(pos, end, world):
            while pos < end:
                sig = buf[pos:pos+4]; sz = struct.unpack_from('<I', buf, pos+4)[0]
                if sig == b'GRUP':
                    label, gt = struct.unpack_from('<II', buf, pos+8)
                    walk(pos+24, pos+sz, canon(name, label) if gt == 1 else world); pos += sz; continue
                if sig in (b'NPC_', b'LVLN'):
                    body = buf[pos+24:pos+24+sz]
                    if struct.unpack_from('<I', buf, pos+8)[0] & 0x40000: body = zlib.decompress(body[4:])
                    e = next((v for s, v in subs(body) if s == b'EDID'), b'')
                    edids[canon(name, struct.unpack_from('<I', buf, pos+12)[0]).lower()] = e.rstrip(b'\0').decode('cp1252', 'replace')
                elif sig in (b'ACHR', b'REFR'):
                    fl, fid = struct.unpack_from('<II', buf, pos+8)
                    c = canon(name, fid)
                    if c.lower() in want:
                        body = buf[pos+24:pos+24+sz]
                        if fl & 0x40000: body = zlib.decompress(body[4:])
                        d = dict(subs(body))
                        p = struct.unpack('<3f', d[b'DATA'][:12]) if b'DATA' in d else (0, 0, 0)
                        out[c.lower()] = dict(ref=c, base=canon(name, struct.unpack('<I', d[b'NAME'][:4])[0]) if b'NAME' in d else None,
                                              winner=name, off=bool(fl & 0x820) or (sig == b'ACHR' and bool(fl & 0x200)) or p[2] < -20000,
                                              parent=(canon(name, struct.unpack('<I', d[b'XESP'][:4])[0]).lower(), d[b'XESP'][4] & 1) if b'XESP' in d else None,
                                              world=world)
                pos += 24 + sz
        walk(24 + hsz, len(buf), None)
        del buf
    return out


src = {p['src'].lower() for p in json.load(open(os.path.join(SRV, 'wildlife.json')))['placements'] if p.get('src')}
refs = scan(src)
parents = {r['parent'][0] for r in refs.values() if r['parent']}
for _ in range(4):
    more = scan(parents - set(refs))
    if not more: break
    refs.update(more); parents = {r['parent'][0] for r in refs.values() if r['parent']}


def enabled(r, depth=0):
    if r['off']: return False
    if not r['parent'] or depth > 6: return True
    p = refs.get(r['parent'][0])
    if p is None: return True
    return (not enabled(p, depth + 1)) if r['parent'][1] else enabled(p, depth + 1)


idx = {n.lower(): i for i, n in enumerate(order)}; name = {n.lower(): n for n in order}
NEX = idx['dragonbreak nexus patches.esp']
VANILLA = {'skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm', 'dragonbreak.esp', 'dragonbreak online edits.esp', 'dragonbreak hub.esp', 'dragonbreak whiterun.esp'}
main, giants = [], []
for k in sorted(src):
    r = refs.get(k)
    if not r or not enabled(r) or (r['world'] or '').lower() != '3c:skyrim.esm': continue
    loc, plug = r['ref'].split(':', 1)
    w = idx.get(r['winner'].lower(), 0)
    tgt = 'DragonBreak Nexus Patches.esp' if (plug.lower() not in VANILLA and not plug.lower().startswith('cc')) or w >= NEX else 'DragonBreak Online Edits.esp'
    base = edids.get((r['base'] or '').lower()) or '*'
    line = 'disable|%s|%06X|%s|%s|duplicate: wildlife.json spawns the server copy of this creature at this spot (winner %s)' % (name.get(plug.lower(), plug), int(loc, 16), base, tgt, r['winner'])
    (giants if 'Giant' in base or 'Mammoth' in base else main).append((base, line))
for fn, rows in (('DBO_SkyrimWildlifeDupesList.txt', main), ('DBO_SkyrimWildlifeDupesGiantsList.txt', giants)):
    open(os.path.join(OUT, fn), 'w', newline='\r\n').write('\n'.join(l for _, l in sorted(rows)) + '\n')
    print('%s: %d lines' % (fn, len(rows)))
