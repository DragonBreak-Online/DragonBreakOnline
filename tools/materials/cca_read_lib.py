import struct, zlib
def records(buf, want=None):
    """Yield (sig, flags, formid, data) for every record in a plugin buffer, descending into groups."""
    off = 0
    n = len(buf)
    stack = [(0, n)]
    while off < n:
        sig = buf[off:off + 4].decode('latin1')
        size = struct.unpack_from('<I', buf, off + 4)[0]
        if sig == 'GRUP':
            label = buf[off + 8:off + 12]
            gtype = struct.unpack_from('<i', buf, off + 12)[0]
            if want is not None and gtype == 0 and label.decode('latin1') not in want:
                off += size
                continue
            off += 24
            continue
        flags, fid = struct.unpack_from('<II', buf, off + 8)
        data = buf[off + 24: off + 24 + size]
        off += 24 + size
        if want is not None and sig not in want and sig != 'TES4':
            continue
        if flags & 0x40000:
            try:
                data = zlib.decompress(data[4:])
            except Exception:
                data = b''
        yield sig, flags, fid, data

def fields(data):
    off, out, big = 0, [], None
    while off + 6 <= len(data):
        t = data[off:off + 4].decode('latin1')
        sz = struct.unpack_from('<H', data, off + 4)[0]
        off += 6
        if t == 'XXXX':
            big = struct.unpack_from('<I', data, off)[0]
            off += sz
            continue
        if big is not None:
            sz, big = big, None
        out.append((t, data[off:off + sz]))
        off += sz
    return out

def zstr(b):
    return b.split(b'\0')[0].decode('cp1252', 'replace')

