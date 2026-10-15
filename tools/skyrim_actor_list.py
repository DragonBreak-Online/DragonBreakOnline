# The xEdit list for DBO_SkyrimActors.pas from tools/skyrim_release_scan.py's achr-living.json (check 3, 15 Oct).
# usage: python3 tools/skyrim_actor_list.py <scan outdir> <package loadorder.txt> <out list> <out tsv>
import sys, json, collections
rows = json.load(open(sys.argv[1] + '/achr-living.json'))
ORDER = [l.strip() for l in open(sys.argv[2]) if l.strip()]
idx = {n.lower(): i for i, n in enumerate(ORDER)}; name = {n.lower(): n for n in ORDER}
NEX = idx['dragonbreak nexus patches.esp']
# vanilla, DLC, Creation Club and our own plugins: overrides in the DLE (the conflict layer); a Nexus mod's refs: Nexus Patches
VANILLA = {'skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm', 'dragonbreak.esp', 'dragonbreak online edits.esp', 'dragonbreak hub.esp', 'dragonbreak whiterun.esp'}
keep = [r for r in rows if r['place'] and r['place'].split(':', 1)[1] not in ('bsheartland.esm', 'bsassets.esm')]   # Cyrodiil: the Bruma pass
lines, tsv, tc = [], ['plugin\tref\tbase\tbaseEdid\tplace\tplaceEdid\tinterior\tx\ty\tz\twinner\ttarget\tenableParent'], collections.Counter()
for r in sorted(keep, key=lambda r: (r['interior'], r['placeEdid'], r['ref'])):
    loc, plug = r['ref'].split(':', 1)
    origin = name.get(plug, plug)
    w = idx.get(r['by'].lower(), 0)
    if w > NEX: raise SystemExit('winner after Nexus Patches: %s %s' % (r['ref'], r['by']))
    tgt = 'DragonBreak Nexus Patches.esp' if (plug not in VANILLA and not plug.startswith('cc')) or w >= NEX else 'DragonBreak Online Edits.esp'
    tc[tgt] += 1
    lines.append(f"disable|{origin}|{int(loc, 16):06X}|{r['baseEdid'] or '*'}|{tgt}")
    p = r['pos'] or [0, 0, 0]
    tsv.append('\t'.join(map(str, [origin, f"{int(loc, 16):06X}", r['base'], r['baseEdid'], r['place'], r['placeEdid'], int(r['interior']), *p, r['by'], tgt, int(r['xesp'])])))
open(sys.argv[3], 'w', newline='\r\n').write('\n'.join(lines) + '\n')
open(sys.argv[4], 'w').write('\n'.join(tsv) + '\n')
print(len(keep), dict(tc), 'exterior', sum(not r['interior'] for r in keep), 'interior', sum(r['interior'] for r in keep))
