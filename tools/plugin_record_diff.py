"""Record-by-record diff of two copies of one plugin (before and after an xEdit or CK save).

xEdit re-serialises every record it saves and fills in "required" elements, so a one-record script once changed 93
records of DragonBreak Online Edits (21 Sep: empty effects added to all 90 DBO_Skill_* marker spells). This compares
the two files record by record, decompressed, subrecord by subrecord, and prints every record added, removed or
changed, with its editor id. Ship a save only when that list is exactly what the script meant to change.

usage: py tools/plugin_record_diff.py <before.esp> <after.esp> [--allow-edid-prefix DBO_Alch,DBO_Harvest] [--allow-changed EDID,...]
Exit code 0 when nothing outside the allowed sets changed, 1 otherwise. Standalone (no ck-mcp import), Python 3.
"""
import struct, sys, zlib

def records(path):
    buf = open(path, 'rb').read()
    out = {}
    def walk(pos, end):
        while pos < end:
            sig = buf[pos:pos + 4]
            size = struct.unpack_from('<I', buf, pos + 4)[0]
            if sig == b'GRUP':
                walk(pos + 24, pos + size)
                pos += size
                continue
            flags, fid = struct.unpack_from('<II', buf, pos + 8)
            data = buf[pos + 24:pos + 24 + size]
            if flags & 0x00040000:
                data = zlib.decompress(data[4:])
            subs, edid, i, big = [], '', 0, None
            while i + 6 <= len(data):
                s = data[i:i + 4]; n = struct.unpack_from('<H', data, i + 4)[0]; i += 6
                if s == b'XXXX': big = struct.unpack_from('<I', data, i)[0]; i += n; continue
                if big is not None: n, big = big, None
                v = data[i:i + n]; i += n
                if s == b'EDID': edid = v.rstrip(b'\0').decode('cp1252', 'replace')
                subs.append((s, v))
            out[fid] = (sig.decode('ascii', 'replace'), flags & ~0x00040000, edid, subs)
            pos += 24 + size
    hsize = struct.unpack_from('<I', buf, 4)[0]
    walk(24 + hsize, len(buf))
    return out

def main(argv):
    if len(argv) < 3:
        print(__doc__); return 2
    before, after = records(argv[1]), records(argv[2])
    prefixes, allowed = [], set()
    for i, a in enumerate(argv):
        if a == '--allow-edid-prefix' and i + 1 < len(argv): prefixes = [p for p in argv[i + 1].split(',') if p]
        if a == '--allow-changed' and i + 1 < len(argv): allowed = set(p for p in argv[i + 1].split(',') if p)
    ok = lambda e: any(e.startswith(p) for p in prefixes)
    added = [(f, after[f]) for f in after if f not in before]
    removed = [(f, before[f]) for f in before if f not in after]
    changed = []
    for f in before:
        if f in after and before[f] != after[f]:
            b, a = before[f], after[f]
            subs = sorted(set(s.decode() for s, _ in b[3]) ^ set(s.decode() for s, _ in a[3]) | set(s.decode() for (s, v), (t, w) in zip(b[3], a[3]) if s != t or v != w))
            changed.append((f, a, subs if len(b[3]) == len(a[3]) else subs + ['(subrecord count %d -> %d)' % (len(b[3]), len(a[3]))]))
    bad = 0
    print('added %d, removed %d, changed %d' % (len(added), len(removed), len(changed)))
    for f, r in added:
        mark = '' if ok(r[2]) else '   <-- not expected'; bad += 0 if ok(r[2]) else 1
        print('ADDED   %08X %s %s%s' % (f, r[0], r[2], mark))
    for f, r in removed:
        bad += 1; print('REMOVED %08X %s %s   <-- not expected' % (f, r[0], r[2]))
    for f, r, subs in changed:
        good = r[2] in allowed or ok(r[2])
        bad += 0 if good else 1
        print('CHANGED %08X %s %s: %s%s' % (f, r[0], r[2], ', '.join(subs), '' if good else '   <-- not expected'))
    print('OK: only the expected records differ' if not bad else 'NOT OK: %d unexpected difference(s); do not ship this save' % bad)
    return 0 if not bad else 1

if __name__ == '__main__':
    sys.exit(main(sys.argv))
