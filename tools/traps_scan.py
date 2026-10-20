#!/usr/bin/env python3
# Builds traps.json for traps.js: every pressure plate, tripwire and trigger box in an interior cell of the load order, and
# the traps it fires through activate parents (XAPR), relays (TrapLinker) included. Last override wins; disabled, deleted
# and sunk refs are left out. Damage and thresholds are the scripts' own properties (VMAD on the ref, then its base).
#   python3 -I tools/traps_scan.py <loadorder.txt> <data dir> <out traps.json>
import sys, os, struct, json, collections, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import traps_esm as esm

TRIGGERS = ('pressureplate', 'tripwire', 'traptriggerbase')
KINDS = {'speartrap': 'spear', 'bladetrap': 'blade', 'batteringtrap': 'ram', 'trapswingingwall': 'wall', 'darttrap': 'dart', 'trapflamethrower': 'flame'}

def ws(b, i):
    n = struct.unpack_from('<H', b, i)[0]
    return b[i + 2:i + 2 + n].decode('latin1'), i + 2 + n

def vmad(b):
    try:
        ver, ofmt, n = struct.unpack_from('<hhH', b, 0); i = 6; out = {}
        for _ in range(n):
            name, i = ws(b, i)
            if ver >= 4: i += 1
            np_ = struct.unpack_from('<H', b, i)[0]; i += 2; props = {}
            for _ in range(np_):
                pn, i = ws(b, i); t = b[i]; i += 1
                if ver >= 4: i += 1
                def one(t, i):
                    if t == 1: return (struct.unpack_from('<I', b, i + 4 if ofmt == 2 else i)[0], i + 8)
                    if t == 2: return ws(b, i)
                    if t == 3: return struct.unpack_from('<i', b, i)[0], i + 4
                    if t == 4: return struct.unpack_from('<f', b, i)[0], i + 4
                    if t == 5: return bool(b[i]), i + 1
                    raise ValueError(t)
                if t >= 11:
                    c = struct.unpack_from('<I', b, i)[0]; i += 4; v = []
                    for _ in range(c):
                        x, i = one(t - 10, i); v.append(x)
                else:
                    v, i = one(t, i)
                props[pn.lower()] = v
            out[name.lower()] = props
        return out
    except Exception:
        return {}

def main(lo_path, data, out):
    lo = [l.strip() for l in open(lo_path) if l.strip() and not l.startswith('#')]
    bases, refs, cells = {}, {}, {}
    for plugin in lo:
        path = os.path.join(data, plugin)
        if not os.path.exists(path): continue
        masters = []; cur = None
        def key(fid):
            idx = fid >> 24
            return ((masters[idx] if idx < len(masters) else plugin).lower(), fid & 0xffffff)
        for t, fid, raw, fl in esm.records(path):
            if t == 'TES4':
                masters = [v.rstrip(b'\0').decode('latin1') for n, v in esm.fields(raw) if n == 'MAST']; continue
            if t == 'CELL':
                fs = esm.fields(raw); d = [v for n, v in fs if n == 'DATA']
                cur = key(fid); cells[cur] = {'interior': bool(d and d[0][0] & 1), 'edid': esm.edid(fs)}; continue
            if t == 'ACTI':
                fs = esm.fields(raw); b = {'edid': esm.edid(fs), 'scripts': {}}
                for n, v in fs:
                    if n == 'OBND': b['obnd'] = list(struct.unpack('<6h', v))
                    elif n == 'VMAD': b['scripts'] = vmad(v)
                bases[key(fid)] = b; continue
            if t == 'REFR':
                k = key(fid)
                fs = esm.fields(raw)
                r = {'cell': cur, 'flags': fl, 'xapr': [], 'xlkr': [], 'scripts': {}}
                for n, v in fs:
                    if n == 'NAME': r['base'] = key(struct.unpack('<I', v)[0])
                    elif n == 'DATA': r['pos'] = list(struct.unpack('<6f', v))
                    elif n == 'XSCL': r['scale'] = struct.unpack('<f', v)[0]
                    elif n == 'XPRM': r['half'] = list(struct.unpack_from('<3f', v)); r['ptype'] = struct.unpack_from('<I', v, 28)[0] if len(v) >= 32 else 1
                    elif n == 'XAPR': p, d = struct.unpack('<If', v); r['xapr'].append((key(p), d))
                    elif n == 'XLKR' and len(v) >= 8: r['xlkr'].append(key(struct.unpack('<II', v)[1]))
                    elif n == 'XESP': r['xesp'] = True
                    elif n == 'VMAD': r['scripts'] = vmad(v)
                refs[k] = r
                continue
    def scripts(r):
        s = dict((bases.get(r.get('base')) or {}).get('scripts') or {})
        for name, props in (r.get('scripts') or {}).items(): s[name] = dict(s.get(name, {}), **props)
        return s
    def live(k, r):
        fl = r.get('flags', 0)
        if fl & 0x20 or fl & 0x800: return False
        p = r.get('pos'); return bool(p) and p[2] > -20000 and 'base' in r
    children = collections.defaultdict(list)
    for k, r in refs.items():
        for p, d in r['xapr']: children[p].append((k, d))
    def desc(k): return f"{k[1]:x}:{next(p for p in lo if p.lower() == k[0])}"
    def prop(s, script, name, default=None):
        return (s.get(script) or {}).get(name.lower(), default)
    out_cells = collections.defaultdict(list); counts = collections.Counter()
    for k, r in refs.items():
        if not live(k, r): continue
        cell = cells.get(r['cell']) or {}
        if not cell.get('interior'): continue
        s = scripts(r)
        trig = next((t for t in TRIGGERS if t in s), None)
        if not trig: continue
        if trig == 'traptriggerbase' and 'half' not in r: continue   # a relay (TrapLinker), reached through its parent
        traps = []
        def walk(pk, delay, depth):
            for ck, d in children.get(pk, []):
                cr = refs.get(ck)
                if not cr or not live(ck, cr): continue
                cs = scripts(cr)
                kind = next((v for s_, v in KINDS.items() if s_ in cs), None)
                if kind:
                    sname = next(s_ for s_ in KINDS if s_ in cs)
                    b = bases.get(cr['base']) or {}
                    dmg = [prop(cs, sname, f'LvlDamage{i}') for i in range(1, 7)]
                    thr = [prop(cs, sname, f'LvlThreshold{i}') for i in range(1, 6)]
                    traps.append({'ref': desc(ck), 'kind': kind, 'delay': round(delay + d, 3), 'pos': [round(x, 3) for x in cr['pos'][:3]],
                                  'rot': [round(x, 5) for x in cr['pos'][3:]], 'scale': round(cr.get('scale', 1.0), 3), 'obnd': b.get('obnd'),
                                  'dmg': dmg if all(isinstance(x, int) for x in dmg) else None, 'thr': thr if all(isinstance(x, int) for x in thr) else None,
                                  'rotation': prop(cs, 'trapswingingwall', 'rotation', 0) if kind == 'wall' else None})
                    counts[kind] += 1
                elif 'traptriggerbase' in cs and depth < 4:
                    walk(ck, delay + d, depth + 1)
        walk(k, 0.0, 0)
        if not traps: continue
        b = bases.get(r['base']) or {}
        out_cells[desc(r['cell'])].append({'ref': desc(k), 'trigger': trig, 'pos': [round(x, 3) for x in r['pos'][:3]], 'rot': [round(x, 5) for x in r['pos'][3:]],
                                           'scale': round(r.get('scale', 1.0), 3), 'obnd': b.get('obnd'), 'half': r.get('half'), 'traps': traps})
        counts['trigger:' + trig] += 1
    json.dump({'_comment': 'Generated by tools/traps_scan.py from the load order: interior pressure plates, tripwires and trigger boxes, and the traps they fire (traps.js).', 'cells': out_cells}, open(out, 'w'), indent=0)
    print(json.dumps(dict(counts), indent=1), len(out_cells), 'cells')

if __name__ == '__main__':
    main(*sys.argv[1:4])
