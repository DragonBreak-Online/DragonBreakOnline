# Census check for the DLE / Nexus Patches the PC returns after DBO_SkyrimActors.pas (check 3, 15 Oct).
# 1. run tools/skyrim_release_scan.py over the package with the returned plugins in plugins/ (writes <scan>/achr-living.json);
# 2. python3 tools/skyrim_actor_check.py <scan outdir> <new DLE esp>
# PASS needs: 0 enabled living plugin ACHRs in the open Skyrim lands (Cyrodiil is the Bruma pass's), 0 within the 12288-unit
# load grid of any hub gate spot; wildlife.json still covers its Tamriel placements; the DLE ship gate passes (the CT 115
# patches a PC build has dropped before: border, markers, server-spawned flags; memory pc-dle-builds-drop-server-side-patches).
import sys, os, json, math, re, subprocess
here = os.path.dirname(os.path.abspath(__file__)); srv = os.path.dirname(here)
scan, dle = sys.argv[1], sys.argv[2]
fails = 0
def ok(c, what):
    global fails
    print(('ok    ' if c else 'FAIL  ') + what)
    if not c: fails += 1
rows = json.load(open(os.path.join(scan, 'achr-living.json')))
sky = [r for r in rows if r['place'] and r['place'].split(':', 1)[1] not in ('bsheartland.esm', 'bsassets.esm')]
ok(len(sky) == 0, '%d enabled living plugin actors left in the open Skyrim lands%s' % (len(sky), (': ' + ', '.join(r['ref'] + ' ' + r['baseEdid'] for r in sky[:15])) if sky else ''))
src = open(os.path.join(srv, 'gamemode.js'), encoding='utf8').read()
cfg = json.load(open(os.path.join(srv, 'gamemode-config.json')))
gates = {}
for m in re.finditer(r"^  (a00\d): \['(\w+)', (\[\[.*?\]\]), -?\d+\],$", src, re.M): gates[m.group(1)] = (m.group(2), json.loads(m.group(3)))
for gid, g in (cfg.get('hubGates') or {}).items():
    if isinstance(g, dict) and isinstance(g.get('spots'), list) and gid in gates: gates[gid] = (gates[gid][0], g['spots'])
ok(len(gates) == 9, 'read the nine gates\' spots (%d)' % len(gates))
for gid, (name, spots) in sorted(gates.items()):
    near = [r for r in sky if r['place'] == '3c:skyrim.esm' and r['pos'] and min(math.hypot(r['pos'][0] - s[0], r['pos'][1] - s[1]) for s in spots) <= 12288]
    ok(not near, '%s: %d living plugin actors in the landing\'s load grid' % (name, len(near)))
w = json.load(open(os.path.join(srv, 'wildlife.json')))['placements']
tam = [p for p in w if str(p.get('world', '')).lower() == '3c:skyrim.esm']
ok(len(tam) >= 2612, 'wildlife.json still places %d creatures in Tamriel (2612 on 15 Oct)' % len(tam))
gate = os.path.join(here, 'alpha', 'dle_ship_gate.py')
if os.path.exists(gate):
    r = subprocess.run([sys.executable, gate, dle], capture_output=True, text=True)
    print(r.stdout[-3000:])
    ok(r.returncode == 0, 'the DLE ship gate (tools/alpha/dle_ship_gate.py) passes (known false positive: the border WNAM, skyrim-check-1.md)')
else:
    ok(False, 'tools/alpha/dle_ship_gate.py not found')
print('FAILED %d' % fails if fails else 'PASS'); sys.exit(1 if fails else 0)
