#!/usr/bin/env python3
# The gate for the PC's Skyrim NPC pass (DBO_SkyrimActors.pas, DRY_RUN False) before the Skyrim window ships its plugins.
#   python3 tools/skyrim_npc_gate.py <package dir> <returned DLE> <returned Nexus Patches> <scratch dir> [--allow-match SIG:plugin:ID,...]
# 1. record diff, the package build -> the returned one, for each of the two plugins (keyed by (sig, source plugin, local id),
#    master indices remapped): no master dropped (added ones must load before the target), nothing removed, and every changed or added record is an ACHR
#    whose only differences are the Initially Disabled flag (0x800) set and XESP (Enable Parent) gone. Anything else is an
#    xEdit re-save side effect (memory xedit-resave-mutates-unrelated-records) and FAILS. A CELL/WRLD the pass ADDS (xEdit
#    copies a ref's parent with it) and an --allow-match record must equal the version it overrides (the last plugin before
#    it in the order with that record, master indices mapped, subrecord order and the region list order ignored): an older
#    copy would revert a later mod's edit of that cell or world.
# 2. the count of newly disabled actors per plugin against tooling/xedit-scripts/DBO_SkyrimActorsList.txt (targets).
# 3. the package with the two returned plugins (a link farm in <scratch>/pkg) judged by tools/skyrim_actor_narrow.py, then
#    tools/skyrim_actor_check.py on the result (0 troublesome actors left, the keep baseline, wildlife, the DLE ship gate).
# Exit 0 = PASS. Reads only; writes only under <scratch>.
import sys, os, json, struct, subprocess, collections
here = os.path.dirname(os.path.abspath(__file__)); srv = os.path.dirname(here)
sys.path.insert(0, os.path.expanduser('~nate/dragonbreak/ck-mcp'))
import esplib

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
    bad, disabled, containers = [], 0, []
    for k, (fl, subs) in a.items():
        if k in b and (b[k][0] & ~COMPRESSED, b[k][1]) == (fl & ~COMPRESSED, subs): continue
        tag = '%s %s:%06X' % (k[0], k[1][0], k[1][1])
        if k[0] in ('CELL', 'WRLD') and k not in b: containers.append(k); continue      # the parent xEdit copies with a ref
        if k in ALLOW_MATCH: containers.append(k); continue                              # may change, to what it overrides
        if k[0] != 'ACHR': bad.append(tag + ' (not an actor)'); continue
        if not fl & DISABLED or fl & DELETED: bad.append('%s flags %X' % (tag, fl)); continue
        if any(x[0] == b'XESP' for x in subs): bad.append(tag + ' keeps an Enable Parent'); continue
        if k in b:
            ofl, osubs = b[k]
            if (fl & ~COMPRESSED & ~DISABLED) != (ofl & ~COMPRESSED & ~DISABLED): bad.append('%s other flags changed %X -> %X' % (tag, ofl, fl)); continue
            if [x for x in subs if x[0] != b'XESP'] != [x for x in osubs if x[0] != b'XESP']: bad.append(tag + ' subrecords changed'); continue
            if ofl & DISABLED: continue          # it was disabled already; only its Enable Parent went
        disabled += 1
    ok(not bad, '%s: every changed or added record is an actor made Initially Disabled with its Enable Parent removed%s' % (name, (': ' + '; '.join(bad[:10])) if bad else ''))
    print('      %s: %d actors newly disabled, %d parent CELL/WRLD overrides added' % (name, disabled, len(containers)))
    return disabled, containers, ap, a


# --allow-match SIG:plugin:LOCALID,...: records the pass may also change, provided they then equal the version they override
# (the window passes the two WRLD overrides of Nexus Patches that must take the DLE's world map: Tamriel and Solstheim)
ALLOW_MATCH = set()
NOISE = {b'MODT', b'MO2T', b'MO3T', b'MO4T', b'MO5T', b'XRGD', b'DMDT'}


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
    for k in keys:
        if k not in found: out.append('%s %s:%06X (overrides nothing before it)' % (k[0], k[1][0], k[1][1])); continue
        path, off, sz, fl = found[k]; p = esplib.Plugin(path)
        names = [m.lower() for m in p.masters] + [os.path.basename(path).lower()]
        remap = {i: tmast[nm] for i, nm in enumerate(names) if nm in tmast}
        def mapb(v, step):
            a = bytearray(v)
            for o in range(0, len(v) - 3, step):
                if v[o + 3] in remap: a[o + 3] = remap[v[o + 3]]
            return bytes(a)
        with open(path, 'rb') as fh: src = [(sg, bytes(v)) for sg, v in esplib.subrecords(p.data_at(fh, off, sz, fl)) if sg not in NOISE]
        dst = [(sg, norm(sg, v)) for sg, v in trecs[k][1] if sg not in NOISE]
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
    pkg, dle, nex, scratch = a[:4]
    os.makedirs(scratch, exist_ok=True)
    order = [l.strip().lstrip('*') for l in open(os.path.join(pkg, 'skyrim-data', 'loadorder.txt'), encoding='utf-8-sig') if l.strip() and not l.startswith('#')]
    ORDER[:] = order
    nd, cd, dp, dr = diff(os.path.join(pkg, 'plugins', 'DragonBreak Online Edits.esp'), dle, 'DLE')
    nn, cn, np_, nr = diff(os.path.join(pkg, 'plugins', 'DragonBreak Nexus Patches.esp'), nex, 'Nexus Patches')
    for nm, tp, trecs, keys in (('DragonBreak Online Edits.esp', dp, dr, cd), ('DragonBreak Nexus Patches.esp', np_, nr, cn)):
        bad = containers_check(pkg, order, nm, tp, trecs, keys)
        ok(not bad, '%s: the %d parent CELL/WRLD overrides it added are the versions they override%s' % (nm, len(keys), (': ' + '; '.join(bad[:10])) if bad else ''))
    lst = [l.split('|') for l in open(os.path.join(srv, 'tooling', 'xedit-scripts', 'DBO_SkyrimActorsList.txt'), encoding='utf-8').read().splitlines() if l.startswith('disable|')]
    want = collections.Counter(x[4] for x in lst)
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
    r = subprocess.run([sys.executable, os.path.join(here, 'skyrim_actor_check.py'), scan, dle], capture_output=True, text=True)
    print('\n'.join('      ' + l for l in r.stdout.splitlines()[-30:]))
    ok(r.returncode == 0, 'skyrim_actor_check.py PASS')
    print('FAILED %d' % fails if fails else 'PASS'); sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
