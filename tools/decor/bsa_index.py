"""List or extract files of SSE BSAs (v105). py -I bsa_list.py <bsa> [regex] ; import: names(bsa) -> {lowerpath: (offset,size,compressed)}, read(bsa, path)"""
import struct, sys, re
def names(p):
    f = open(p, 'rb'); h = f.read(36)
    magic, ver, off, aflags, nfold, nfile, ldir, lfile, fflags = struct.unpack('<4sIIIIIIII', h)
    assert magic == b'BSA\0' and ver == 105, (magic, ver)
    folders = [struct.unpack('<QIIQ', f.read(24)) for _ in range(nfold)]
    recs = []
    for _, cnt, _, _ in folders:
        n = f.read(1)[0]; d = f.read(n)[:-1].decode('cp1252')
        for _ in range(cnt):
            hsh, size, foff = struct.unpack('<QII', f.read(16)); recs.append((d, size, foff))
    blob = f.read(lfile).split(b'\0')
    out = {}
    for (d, size, foff), nm in zip(recs, blob):
        comp = bool(aflags & 4) ^ bool(size & 0x40000000)
        out[(d + chr(92) + nm.decode('cp1252')).lower()] = (foff, size & 0x3FFFFFFF, comp, bool(aflags & 0x100))
    return out
def read(p, path, idx=None):
    idx = idx or names(p); foff, size, comp, embed = idx[path.lower()]
    f = open(p, 'rb'); f.seek(foff); b = f.read(size)
    if embed: n = b[0]; b = b[1 + n:]
    if comp:
        import lz4.frame; b = lz4.frame.decompress(b[4:])
    return b
if __name__ == '__main__':
    rx = re.compile(sys.argv[2], re.I) if len(sys.argv) > 2 else None
    for k in names(sys.argv[1]):
        if not rx or rx.search(k): print(k)
