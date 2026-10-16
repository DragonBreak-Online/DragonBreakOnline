# Census check for the DLE / Nexus Patches the PC returns after DBO_SkyrimActors.pas (Skyrim release, narrowed pass, 15 Oct).
# 1. put the returned plugins in a copy of the release package's plugins/ and judge it with the same rule that made the list:
#      DBO_PACKAGE=<that package> python3 tools/skyrim_actor_narrow.py gamemode-config.json gamemode.js <scan outdir>
#    (writes <scan>/achr-judged.json);
# 2. python3 tools/skyrim_actor_check.py <scan outdir> <new DLE esp>
# PASS needs: 0 troublesome living plugin actors left enabled (none within 4000 units of a hold-gate landing or the creator
# landing / arrival, no hostile actor or creature in a town or city, no actor whose faction or AI attacks players, the
# closed routes' crew); the guards, townsfolk, merchants and children the list leaves alone still enabled, as many as the
# baseline (tooling/xedit-scripts/DBO_SkyrimActorsBaseline.json, from the package the list was made from); wildlife.json
# still covers its Tamriel placements; the DLE ship gate passes (the CT 115 patches a PC build has dropped before: border,
# markers, server-spawned flags; memory pc-dle-builds-drop-server-side-patches).
#
# --pass2 (Skyrim NPC pass 2, 16 Oct, "server spawns only"): python3 tools/skyrim_actor_check.py --pass2 <scan outdir> <new DLE esp>
# PASS needs: 0 living plugin actors left enabled in open Skyrim (the census of skyrim_actor_narrow.py, Cyrodiil left to
# the Bruma pass) except the listed exclusions (tooling/xedit-scripts/DBO_SkyrimActors2Exclusions.json), every exclusion
# still enabled, wildlife.json, the DLE ship gate. The pass 1 keep baseline does not apply: pass 2 disables those.
import sys, os, json, collections, subprocess
here = os.path.dirname(os.path.abspath(__file__)); srv = os.path.dirname(here)
PASS2 = '--pass2' in sys.argv
argv = [x for x in sys.argv[1:] if x != '--pass2']
scan, dle = argv[0], argv[1]
fails = 0
def ok(c, what):
    global fails
    print(('ok    ' if c else 'FAIL  ') + what)
    if not c: fails += 1
rows = json.load(open(os.path.join(scan, 'achr-judged.json')))
if PASS2:
    sys.path.insert(0, here)
    import skyrim_actor_all as AA
    left, kept, by = AA.check(scan)
    ok(not left, '%d living plugin actors still enabled in open Skyrim outside the exclusions %s%s' % (len(left), dict(by), (': ' + ', '.join(r['ref'] + ' ' + r['baseEdid'] for r in left[:15])) if left else ''))
    excl = AA.exclusions()
    ok(len(kept) == len(excl), 'the %d listed exclusions still enabled: %d' % (len(excl), len(kept)))
bad = [] if PASS2 else [r for r in rows if r['reason']]
by = collections.Counter('near landing' if r['near'] else 'hostile in town' if r['town'] and r['hostile'] else 'hostile' if r['hostile'] else r['reason'].split(':')[0] for r in bad)
ok(not bad, '%d troublesome living plugin actors still enabled %s%s' % (len(bad), dict(by), (': ' + ', '.join(r['ref'] + ' ' + r['baseEdid'] + ' (' + r['reason'] + ')' for r in bad[:15])) if bad else ''))
near = collections.Counter(r['near'] for r in bad if r['near'])
ok(not near, 'no hostile actor or creature within 4000 units of a landing (guards, townsfolk, merchants, children stay)%s' % (' ' + json.dumps(near) if near else ''))
base_path = os.path.join(srv, 'tooling', 'xedit-scripts', 'DBO_SkyrimActorsBaseline.json')
base = json.load(open(base_path))['keep']
keep = collections.Counter(r['kind'] for r in rows if not r['reason'])
for kind in ('guard', 'townsfolk', 'merchant', 'child') if not PASS2 else ():
    ok(keep[kind] >= base.get(kind, 0), '%s still enabled: %d (baseline %d)' % (kind, keep[kind], base.get(kind, 0)))
if not PASS2:
    ok(keep['hostile'] >= base.get('hostile', 0), 'kept by decision (Ysgramor ghosts, Vaermina devotees, giants) still enabled: %d (baseline %d)' % (keep['hostile'], base.get('hostile', 0)))
w = json.load(open(os.path.join(srv, 'wildlife.json')))['placements']
tam = [p for p in w if str(p.get('world', '')).lower() == '3c:skyrim.esm']
ok(len(tam) >= 2612, 'wildlife.json still places %d creatures in Tamriel (2612 on 15 Oct)' % len(tam))
gate = os.path.join(here, 'alpha', 'dle_ship_gate.py')
if os.path.exists(gate):
    r = subprocess.run([sys.executable, gate, dle], capture_output=True, text=True)
    print(r.stdout[-3000:])
    ok(r.returncode == 0, 'the DLE ship gate (tools/alpha/dle_ship_gate.py) passes (the border WNAM is read by name since 471c88bb)')
else:
    ok(False, 'tools/alpha/dle_ship_gate.py not found')
print('FAILED %d' % fails if fails else 'PASS'); sys.exit(1 if fails else 0)
