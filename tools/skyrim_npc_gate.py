#!/usr/bin/env python3
# The gate for the PC's Skyrim NPC pass (DBO_SkyrimActors.pas, DRY_RUN False) before the Skyrim window ships its plugins.
#   python3 tools/skyrim_npc_gate.py <package dir> <returned DLE> <returned Nexus Patches> <scratch dir>
# 1. record diff, the package build -> the returned one, for each of the two plugins (keyed by (sig, source plugin, local id),
#    master indices remapped): the master list is the same, nothing removed, and every changed or added record is an ACHR
#    whose only differences are the Initially Disabled flag (0x800) set and XESP (Enable Parent) gone. Anything else is an
#    xEdit re-save side effect (memory xedit-resave-mutates-unrelated-records) and FAILS.
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


def diff(before, after, name):
    bp, b = load(before); ap, a = load(after)
    ok([m.lower() for m in bp.masters] == [m.lower() for m in ap.masters], '%s: the master list is unchanged (%d)' % (name, len(ap.masters)))
    removed = [k for k in b if k not in a]
    ok(not removed, '%s: no record removed%s' % (name, (': ' + ', '.join('%s %s:%06X' % (k[0], k[1][0], k[1][1]) for k in removed[:8])) if removed else ''))
    bad, disabled, xesp_gone = [], 0, 0
    for k, (fl, subs) in a.items():
        if k in b and (b[k][0] & ~COMPRESSED, b[k][1]) == (fl & ~COMPRESSED, subs): continue
        tag = '%s %s:%06X' % (k[0], k[1][0], k[1][1])
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
    print('      %s: %d actors newly disabled' % (name, disabled))
    return disabled


def main():
    pkg, dle, nex, scratch = sys.argv[1:5]
    os.makedirs(scratch, exist_ok=True)
    nd = diff(os.path.join(pkg, 'plugins', 'DragonBreak Online Edits.esp'), dle, 'DLE')
    nn = diff(os.path.join(pkg, 'plugins', 'DragonBreak Nexus Patches.esp'), nex, 'Nexus Patches')
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
