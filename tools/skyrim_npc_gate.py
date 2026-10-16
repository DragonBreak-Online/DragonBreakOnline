#!/usr/bin/env python3
# The gate for the PC's Skyrim NPC pass (DBO_SkyrimActors.pas, DRY_RUN False) before the Skyrim window ships its plugins.
#   python3 tools/skyrim_npc_gate.py <package dir> <returned DLE> <returned Nexus Patches> <scratch dir> [--allow-match SIG:plugin:ID,...]
# 1. record diff, the package build -> the returned one, for each of the two plugins (keyed by (sig, source plugin, local id),
#    master indices remapped): no master dropped (added ones must load before the target), nothing removed, and every changed or added record is an ACHR
#    whose only differences are the Initially Disabled flag (0x800) set and XESP (Enable Parent) gone. Anything else is an
#    xEdit re-save side effect (memory xedit-resave-mutates-unrelated-records) and FAILS. A CELL/WRLD the pass ADDS (xEdit
#    copies a ref's parent with it) and an --allow-match record must equal the version it overrides (the last plugin before
#    it in the order with that record, master indices mapped, subrecord order and the region list order ignored): an older
#    copy would revert a later mod's edit of that cell or world. A localized source's FULL (a string id) is compared as the
#    text its Strings table gives (the DLE is not localized, so xEdit writes the text inline); a WRLD copy may lack OFST
#    and RNAM, which xEdit drops on every world copy. A record whose only change is a master index moved by the masters
#    xEdit appended (Nexus Patches' own 0x24 -> 0x32), at form id positions, counts as unchanged.
# 2. the count of newly disabled actors per plugin against tooling/xedit-scripts/DBO_SkyrimActorsList.txt (targets).
# 3. the package with the two returned plugins (a link farm in <scratch>/pkg) judged by tools/skyrim_actor_narrow.py, then
#    tools/skyrim_actor_check.py on the result (0 troublesome actors left, the keep baseline, wildlife, the DLE ship gate).
# Exit 0 = PASS. Reads only; writes only under <scratch>.
#
# --pass2 (Skyrim NPC pass 2, 16 Oct, "server spawns only": DBO_SkyrimActors2.pas with DBO_SkyrimActorsList2.txt):
#   python3 tools/skyrim_npc_gate.py --pass2 live <returned DLE> <returned Nexus Patches> <scratch dir>
# 'live' = before is the LIVE pair in /opt/skyrim-data (DLE 4bb30e63, Nexus Patches 94cd9935; checked by sha256) in the live
# 140 order (a link farm in <scratch>/live). Same record diff and parent CELL/WRLD rule; the newly disabled counts must
# equal list 2's targets exactly; then skyrim_actor_narrow.py + skyrim_actor_check.py --pass2 (0 living plugin actors
# left in open Skyrim except DBO_SkyrimActors2Exclusions.json, wildlife, the DLE ship gate).
import sys, os, json, struct, subprocess, collections, zlib, hashlib
here = os.path.dirname(os.path.abspath(__file__)); srv = os.path.dirname(here)
sys.path.insert(0, os.path.expanduser('~nate/dragonbreak/ck-mcp'))
import esplib
from bsastrings import Strings

DISABLED, DELETED, COMPRESSED = 0x800, 0x20, 0x40000
fails = 0


def ok(c, what):
    global fails
    print(('ok    ' if c else 'FAIL  ') + what)
    if not c: fails += 1


def load(path):
    p = esplib.Plugin(path); selfi = len(p.masters)
    src = lambda fid: (p.masters[fid >> 24].lower() if (fid >> 24) < selfi else 'self', fid & 0xFFFFFF)
    recs = {}
    with open(path, 'rb') as fh:
        for sig, fid, flags, off, size, ctx in p.index:
            if sig == 'GRUP': continue
            recs[(sig, src(fid))] = (flags, [(s, bytes(v)) for s, v in esplib.subrecords(p.data_at(fh, off, size, flags))])
    return p, recs


ORDER = []
ALT_TEX = {b'MODS', b'MO2S', b'MO3S', b'MO4S', b'MO5S'}


def fid_tops(sg, v):
    # the offsets of form id top bytes in a subrecord: an alternate-texture list (count; per entry a u32-length name, the
    # TXST id, the 3D index) holds them unaligned; elsewhere only the aligned u32 slots are taken as form ids
    if sg in ALT_TEX:
        out = set(); n = struct.unpack_from('<I', v, 0)[0]; o = 4
        for _ in range(n):
            o += 4 + struct.unpack_from('<I', v, o)[0]; out.add(o + 3); o += 8
        return out if o == len(v) else set()
    return set(range(3, len(v), 4))


def moved_only(osubs, nsubs, mv):
    # same subrecords in the same order, every differing byte an old master index -> its new index at a form id top byte
    if not mv or len(osubs) != len(nsubs): return False
    for (s1, v1), (s2, v2) in zip(osubs, nsubs):
        if s1 != s2 or len(v1) != len(v2): return False
        if v1 == v2: continue
        try: tops = fid_tops(s1, v1)
        except struct.error: return False
        if any(v1[i] != v2[i] and (i not in tops or mv.get(v1[i]) != v2[i]) for i in range(len(v1))): return False
    return True


STATS = collections.defaultdict(list)


def diff(before, after, name):
    before_name = before
    bp, b = load(before); ap, a = load(after)
    bm, am = [m.lower() for m in bp.masters], [m.lower() for m in ap.masters]
    before = [n.lower() for n in ORDER[:[n.lower() for n in ORDER].index(os.path.basename(before_name).lower())]] if ORDER else am
    extra = [m for m in am if m not in bm]
    # xEdit adds the masters a copied actor needs (its plugin, its base's): allowed when they load before the target
    ok(all(m in am for m in bm) and all(m in before for m in extra), '%s: masters %d -> %d, none dropped%s' % (name, len(bm), len(am), (', added (all load before it): ' + ', '.join(extra)) if extra else ''))
    removed = [k for k in b if k not in a]
    ok(not removed, '%s: no record removed%s' % (name, (': ' + ', '.join('%s %s:%06X' % (k[0], k[1][0], k[1][1]) for k in removed[:8])) if removed else ''))
    # masters only grow, so an old index can still move (Nexus Patches' own 0x24 -> 0x32 when xEdit appended 14 masters):
    # a record whose only differences are such moves, each at a form id's top byte, is unchanged
    me = os.path.basename(before_name).lower(); nb, na = bm + [me], am + [me]
    mv = {i: na.index(n) for i, n in enumerate(nb) if n in na and na.index(n) != i}
    same = lambda o, n: o == n or moved_only(o, n, mv)
    bad, disabled, containers, moved = [], 0, [], collections.Counter()
    for k, (fl, subs) in a.items():
        if k in b and (b[k][0] & ~COMPRESSED, b[k][1]) == (fl & ~COMPRESSED, subs): continue
        if k in b and b[k][0] & ~COMPRESSED == fl & ~COMPRESSED and same(b[k][1], subs): moved[k[0]] += 1; continue
        tag = '%s %s:%06X' % (k[0], k[1][0], k[1][1])
        if k[0] in ('CELL', 'WRLD') and k not in b: containers.append(k); continue      # the parent xEdit copies with a ref
        if k in ALLOW_MATCH: containers.append(k); continue                              # may change, to what it overrides
        if k[0] != 'ACHR': bad.append(tag + ' (not an actor)'); continue
        if not fl & DISABLED or fl & DELETED: bad.append('%s flags %X' % (tag, fl)); continue
        if any(x[0] == b'XESP' for x in subs): bad.append(tag + ' keeps an Enable Parent'); continue
        if k in b:
            ofl, osubs = b[k]
            if (fl & ~COMPRESSED & ~DISABLED) != (ofl & ~COMPRESSED & ~DISABLED): bad.append('%s other flags changed %X -> %X' % (tag, ofl, fl)); continue
            ns, os_ = [x for x in subs if x[0] != b'XESP'], [x for x in osubs if x[0] != b'XESP']
            if not same(os_, ns):
                d = collections.Counter(ns), collections.Counter(os_)
                bad.append('%s subrecords changed (%s)' % (tag, ','.join(sorted({x[0].decode() for x in (d[0] - d[1]) + (d[1] - d[0])})) or 'order')); continue
            if ofl & DISABLED: continue          # it was disabled already; only its Enable Parent went
        disabled += 1
    ok(not bad, '%s: every changed or added record is an actor made Initially Disabled with its Enable Parent removed%s' % (name, (' (%d not): ' % len(bad) + '; '.join(bad[:10])) if bad else ''))
    print('      %s: %d actors newly disabled, %d parent CELL/WRLD overrides added' % (name, disabled, len(containers)))
    if moved: print('      %s: changed only by moved master indices %s (%s): %s' % (name, ' '.join('%02X->%02X' % x for x in sorted(mv.items())), ','.join(sorted({nb[i] for i in mv})), dict(sorted(moved.items()))))
    return disabled, containers, ap, a


# --allow-match SIG:plugin:LOCALID,...: records the pass may also change, provided they then equal the version they override
# (the window passes the two WRLD overrides of Nexus Patches that must take the DLE's world map: Tamriel and Solstheim)
ALLOW_MATCH = set()
NOISE = {b'MODT', b'MO2T', b'MO3T', b'MO4T', b'MO5T', b'XRGD', b'DMDT'}
LOCALIZED = 0x80
# xEdit drops these on every WRLD copy: OFST is the source file's own table of cell offsets, RNAM its large-reference LOD
# list; the engine rebuilds both. A copy that keeps them must still match.
WRLD_DROPPABLE = {b'OFST', b'RNAM'}
_strings = {}


def lstring(order, upto, plugin, sig, key, sid):
    # A localized plugin (header flag 0x80) stores FULL as a uint32 id into its own Strings/<plugin>_english.*STRINGS;
    # xEdit writes the text inline into a non-localized copy. Resolve the id through the plugin's own tables; when this
    # box has none for it (the Creation Club masters' tables live in their BSAs, which are not here) take the newest earlier
    # localized plugin in the order that has the same record with the SAME id and a table for it. Returns (text, via).
    data = os.environ.get('DBO_DATA', '/opt/skyrim-data')
    S = _strings.setdefault(data, Strings(data))
    t = S.text(plugin, sid)
    if t is not None or S.count(plugin): return t, plugin
    for n in reversed(order[:upto]):
        if n.lower() == plugin.lower() or not S.count(n): continue
        v = _same_id(n, sig, key)
        if v == sid: return S.text(n, sid), n
    return None, None


_idcache = {}


def _same_id(n, sig, key):
    # the FULL id plugin n gives record key, or None
    path = os.path.join(os.environ.get('DBO_DATA', '/opt/skyrim-data'), n)
    if n not in _idcache:
        _idcache[n] = {}
        if os.path.exists(path):
            p = esplib.Plugin(path); selfi = len(p.masters)
            with open(path, 'rb') as fh:
                for sg, fid, fl, off, sz, ctx in p.index:
                    if sg not in ('CELL', 'WRLD'): continue
                    k = (sg, ((p.masters[fid >> 24].lower() if (fid >> 24) < selfi else n.lower()), fid & 0xFFFFFF))
                    _idcache[n][k] = (off, sz, fl)
    hit = _idcache[n].get((sig, key))
    if not hit: return None
    off, sz, fl = hit
    with open(path, 'rb') as fh:
        fh.seek(off); d = fh.read(sz)
    if fl & COMPRESSED: d = zlib.decompress(d[4:])
    for sg, v in esplib.subrecords(d):
        if sg == b'FULL' and len(v) == 4: return struct.unpack('<I', bytes(v))[0]
    return None


def norm(sg, v):
    if sg == b'XCLC': return v[:9]
    if sg == b'XCLR': return b''.join(sorted(v[i:i + 4] for i in range(0, len(v) - 3, 4)))   # the region list is a set
    return v


def containers_check(pkg, order, target_name, tp, trecs, keys):
    # every CELL/WRLD the pass added must be the version it overrides (the last plugin before the target that has it),
    # compared after mapping that plugin's master and self indices to the target's: a copy of an older version would revert
    # a later mod's edit of the cell (lighting, water, location, music)
    if not keys: return []
    want = set(keys); found = {}
    tmast = {m.lower(): i for i, m in enumerate(tp.masters)}
    for n in order:
        if n.lower() == target_name.lower(): break
        path = os.path.join(pkg, 'plugins', n)
        if not os.path.exists(path): path = os.path.join(os.environ.get('DBO_DATA', '/opt/skyrim-data'), n)
        p = esplib.Plugin(path); selfi = len(p.masters)
        for sig, fid, fl, off, sz, ctx in p.index:
            if sig not in ('CELL', 'WRLD'): continue
            k = (sig, ((p.masters[fid >> 24].lower() if (fid >> 24) < selfi else n.lower()), fid & 0xFFFFFF))
            if k in want: found[k] = (path, off, sz, fl)
    out = []
    tloc = bool(tp.hflags & LOCALIZED); pos = {n.lower(): i for i, n in enumerate(order)}; plugs = {}
    for k in keys:
        if k not in found: out.append('%s %s:%06X (overrides nothing before it)' % (k[0], k[1][0], k[1][1])); continue
        path, off, sz, fl = found[k]
        p = plugs.get(path) or plugs.setdefault(path, esplib.Plugin(path))
        names = [m.lower() for m in p.masters] + [os.path.basename(path).lower()]
        remap = {i: tmast[nm] for i, nm in enumerate(names) if nm in tmast}
        def mapb(v, step):
            a = bytearray(v)
            for o in range(0, len(v) - 3, step):
                if v[o + 3] in remap: a[o + 3] = remap[v[o + 3]]
            return bytes(a)
        with open(path, 'rb') as fh: src = [(sg, bytes(v)) for sg, v in esplib.subrecords(p.data_at(fh, off, sz, fl)) if sg not in NOISE]
        dst = [(sg, norm(sg, v)) for sg, v in trecs[k][1] if sg not in NOISE]
        if k[0] == 'WRLD':      # dropped by xEdit on the copy: allowed absent, compared when present
            have = {sg for sg, _ in dst}
            gone = sorted({sg.decode() for sg, _ in src if sg in WRLD_DROPPABLE and sg not in have})
            if gone: STATS['wrld dropped'].append('%s %s:%06X %s' % (k[0], k[1][0], k[1][1], '+'.join(gone)))
            src = [x for x in src if not (x[0] in WRLD_DROPPABLE and x[0] not in have)]
        if p.hflags & LOCALIZED and not tloc:   # lstring id against inline text
            tfull = [v for sg, v in dst if sg == b'FULL']
            for i, (sg, v) in enumerate(src):
                if sg != b'FULL' or len(v) != 4: continue
                sid = struct.unpack('<I', v)[0]
                txt, via = lstring(order, pos[os.path.basename(path).lower()], os.path.basename(path), k[0], k[1], sid)
                if txt is None:
                    out.append('%s %s:%06X FULL id %08X of %s resolves through no Strings table here' % (k[0], k[1][0], k[1][1], sid, os.path.basename(path)))
                    continue
                cand = [txt.encode(e, 'replace') + b'\0' for e in ('cp1252', 'utf-8')]
                src[i] = (sg, next((c for c in cand if c in tfull), cand[0]))
                STATS['FULL resolved' if via.lower() == os.path.basename(path).lower() else 'FULL resolved via ' + via].append(k)
        # xEdit writes the subrecords in its own order, so they are compared as a multiset
        left = collections.Counter(dst); mapped = []
        for sg, v in src:
            c = [norm(sg, x) for x in (v, mapb(v, 4), mapb(v, 1), mapb(v, 2))]
            pick = next((x for x in c if left[(sg, x)] > 0), c[1]); left[(sg, pick)] -= 1; mapped.append((sg, pick))
        if collections.Counter(mapped) != collections.Counter(dst) or (fl & ~COMPRESSED) != (trecs[k][0] & ~COMPRESSED):
            md, dd = collections.Counter(mapped), collections.Counter(dst)
            diffs = sorted({x.decode() for x, _ in (md - dd) + (dd - md)}) or ['flags %X -> %X' % (fl & ~COMPRESSED, trecs[k][0] & ~COMPRESSED)]
            out.append('%s %s:%06X differs from %s in %s' % (k[0], k[1][0], k[1][1], os.path.basename(path), ','.join(diffs)))
    return out


def main():
    a = sys.argv[1:]
    if '--allow-match' in a:
        i = a.index('--allow-match')
        for x in a[i + 1].split(','):
            sig, plug, loc = x.split(':'); ALLOW_MATCH.add((sig, (plug.lower(), int(loc, 16))))
        del a[i:i + 2]
    pass2 = '--pass2' in a
    a = [x for x in a if x != '--pass2']
    pkg, dle, nex, scratch = a[:4]
    os.makedirs(scratch, exist_ok=True)
    if pass2 and pkg == 'live':
        data = os.environ.get('DBO_DATA', '/opt/skyrim-data')
        pkg = os.path.join(scratch, 'live'); os.makedirs(os.path.join(pkg, 'skyrim-data'), exist_ok=True); os.makedirs(os.path.join(pkg, 'plugins'), exist_ok=True)
        for src, dst in ((os.path.join(data, 'loadorder.txt'), os.path.join(pkg, 'skyrim-data', 'loadorder.txt')),
                         (os.path.join(data, 'DragonBreak Online Edits.esp'), os.path.join(pkg, 'plugins', 'DragonBreak Online Edits.esp')),
                         (os.path.join(data, 'DragonBreak Nexus Patches.esp'), os.path.join(pkg, 'plugins', 'DragonBreak Nexus Patches.esp'))):
            if os.path.lexists(dst): os.remove(dst)
            os.symlink(src, dst)
    if pass2:
        want_sha = {'DragonBreak Online Edits.esp': os.environ.get('DBO_PASS2_DLE', '4bb30e63'), 'DragonBreak Nexus Patches.esp': os.environ.get('DBO_PASS2_NEXUS', '94cd9935')}
        for n, pre in want_sha.items():
            h = hashlib.sha256(open(os.path.join(pkg, 'plugins', n), 'rb').read()).hexdigest()
            ok(h.startswith(pre), 'before %s is the build list 2 was made from: sha256 %s (want %s)' % (n, h[:8], pre))
    order = [l.strip().lstrip('*') for l in open(os.path.join(pkg, 'skyrim-data', 'loadorder.txt'), encoding='utf-8-sig') if l.strip() and not l.startswith('#')]
    ORDER[:] = order
    nd, cd, dp, dr = diff(os.path.join(pkg, 'plugins', 'DragonBreak Online Edits.esp'), dle, 'DLE')
    nn, cn, np_, nr = diff(os.path.join(pkg, 'plugins', 'DragonBreak Nexus Patches.esp'), nex, 'Nexus Patches')
    for nm, tp, trecs, keys in (('DragonBreak Online Edits.esp', dp, dr, cd), ('DragonBreak Nexus Patches.esp', np_, nr, cn)):
        STATS.clear(); bad = containers_check(pkg, order, nm, tp, trecs, keys)
        for what, xs in sorted(STATS.items()):
            print('      %s: %s %d%s' % (nm, what, len(xs), (': ' + '; '.join(xs)) if what == 'wrld dropped' else ''))
        ok(not bad, '%s: the %d parent CELL/WRLD overrides it added are the versions they override%s' % (nm, len(keys), (': ' + '; '.join(bad[:10])) if bad else ''))
    lst = [l.split('|') for l in open(os.path.join(srv, 'tooling', 'xedit-scripts', 'DBO_SkyrimActorsList2.txt' if pass2 else 'DBO_SkyrimActorsList.txt'), encoding='utf-8').read().splitlines() if l.startswith('disable|')]
    want = collections.Counter(x[4] for x in lst)
    if pass2:   # list 2 holds only actors enabled in the live pair, so every line is one newly disabled actor
        print('      list 2 by reason: %s' % dict(collections.Counter(x[5].split(':')[0] for x in lst)))
        ok(nd == want['DragonBreak Online Edits.esp'], 'DLE: %d newly disabled, list 2 targets %d' % (nd, want['DragonBreak Online Edits.esp']))
        ok(nn == want['DragonBreak Nexus Patches.esp'], 'Nexus Patches: %d newly disabled, list 2 targets %d' % (nn, want['DragonBreak Nexus Patches.esp']))
    else:
        # a listed actor that the plugin already had disabled is not "newly" disabled, so the counts may sit a little under the list
        ok(nd <= want['DragonBreak Online Edits.esp'] and nd >= want['DragonBreak Online Edits.esp'] * 0.95, 'DLE: %d newly disabled, the list targets %d' % (nd, want['DragonBreak Online Edits.esp']))
        ok(nn <= want['DragonBreak Nexus Patches.esp'] and nn >= want['DragonBreak Nexus Patches.esp'] * 0.95, 'Nexus Patches: %d newly disabled, the list targets %d' % (nn, want['DragonBreak Nexus Patches.esp']))
    # the package with the two returned plugins, judged by the same rule that made the list
    farm = os.path.join(scratch, 'pkg'); pl = os.path.join(farm, 'plugins'); os.makedirs(pl, exist_ok=True)
    os.path.lexists(os.path.join(farm, 'skyrim-data')) or os.symlink(os.path.join(pkg, 'skyrim-data'), os.path.join(farm, 'skyrim-data'))
    for n in os.listdir(os.path.join(pkg, 'plugins')):
        t = os.path.join(pl, n)
        if os.path.lexists(t): os.remove(t)
        os.symlink({'DragonBreak Online Edits.esp': os.path.abspath(dle), 'DragonBreak Nexus Patches.esp': os.path.abspath(nex)}.get(n, os.path.join(pkg, 'plugins', n)), t)
    env = dict(os.environ, DBO_PACKAGE=farm)
    scan = os.path.join(scratch, 'scan')
    r = subprocess.run(['nice', '-n', '19', sys.executable, os.path.join(here, 'skyrim_actor_narrow.py'), os.path.join(srv, 'gamemode-config.json'), os.path.join(srv, 'gamemode.js'), scan], env=env, capture_output=True, text=True)
    print('\n'.join('      ' + l for l in r.stdout.splitlines()))
    ok(r.returncode == 0, 'skyrim_actor_narrow.py judged the returned plugins')
    r = subprocess.run([sys.executable, os.path.join(here, 'skyrim_actor_check.py')] + (['--pass2'] if pass2 else []) + [scan, dle], capture_output=True, text=True)
    print('\n'.join('      ' + l for l in r.stdout.splitlines()[-30:]))
    ok(r.returncode == 0, 'skyrim_actor_check.py PASS')
    print('FAILED %d' % fails if fails else 'PASS'); sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
