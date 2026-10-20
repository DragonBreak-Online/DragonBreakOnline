# Minimal TES5 plugin reader for tools/traps_scan.py: records (type, form id, data, record flags) and their subrecords
import struct, zlib

def records(path):
    d = open(path, 'rb').read()
    def walk(off, end):
        while off < end:
            t = d[off:off + 4]; sz = struct.unpack_from('<I', d, off + 4)[0]
            if t == b'GRUP':
                yield from walk(off + 24, off + sz); off += sz; continue
            fl, fid = struct.unpack_from('<II', d, off + 8)
            data = d[off + 24:off + 24 + sz]
            if fl & 0x40000: data = zlib.decompress(data[4:])
            yield t.decode('latin1'), fid, data, fl
            off += 24 + sz
    yield from walk(0, len(d))

def fields(data):
    o = 0; out = []
    while o + 6 <= len(data):
        t = data[o:o + 4].decode('latin1'); n = struct.unpack_from('<H', data, o + 4)[0]
        out.append((t, data[o + 6:o + 6 + n])); o += 6 + n
    return out

def edid(fs):
    for t, v in fs:
        if t == 'EDID': return v.rstrip(b'\0').decode('latin1')
