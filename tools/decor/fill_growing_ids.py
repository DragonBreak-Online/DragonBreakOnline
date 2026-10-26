r"""Fills decor-growing.json's descs (the study bookshelf, the planter, its soil and the 32 crop statics) from the merged DLE,
by editor id. Until this runs, decor.js offers neither piece (a piece without a desc is skipped).

    py -I tools/decor/fill_growing_ids.py --dle "<Data>\DragonBreak Online Edits.esp" [--json decor-growing.json] [--check]

The records come from DBO_StudyPlanters.esp (Worker 1, 25 Oct), merged by Worker 3 AFTER the children already in the
assembly; their ids are whatever the merge gave them, so they are read here, never assumed. A desc is the local id in the
DLE's own file ('1d2240:DragonBreak Online Edits.esp'). The two pieces are activators, not items, so their staff rows go in
admin-placeables.json's Activators (the F7 Place tab), not admin-items.json; added once, beside the descs. --check only
reports and writes nothing. Exits 1 if any editor id is missing from the plugin.
"""
import sys, os, json, argparse
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'tooling', 'ck-mcp'))
import esplib

ap = argparse.ArgumentParser(); ap.add_argument('--dle', required=True)
ap.add_argument('--json', default=os.path.join(HERE, '..', '..', 'decor-growing.json')); ap.add_argument('--check', action='store_true')
ap.add_argument('--placeables', default=os.path.join(HERE, '..', '..', 'admin-placeables.json'))
A = ap.parse_args()
P = esplib.Plugin(A.dle); own = len(P.masters); name = os.path.basename(A.dle)
want = {'ACTI': set(), 'STAT': set()}
G = json.load(open(A.json, encoding='utf8'))
for p in G.get('pieces', []): want['ACTI'].add(p['edid'].lower())
want['STAT'].add(G['soil']['edid'].lower())
for c in G.get('crops', []): want['STAT'].add(c['edid'].lower())
found = {}
with open(P.path, 'rb') as fh:
    for t, f, fl, o, sz, cx in P.index:
        if t not in want or f >> 24 != own: continue                 # only the DLE's own new records, never an override
        for k, v in esplib.subrecords(P.data_at(fh, o, sz, fl)):
            if k == b'EDID':
                e = bytes(v).rstrip(b'\0').decode('cp1252').lower()
                if e in want[t]: found[e] = '%x:%s' % (f & 0xFFFFFF, name)
                break
rows = [p for p in G.get('pieces', [])] + [G['soil']] + list(G.get('crops', []))
missing = [r['edid'] for r in rows if r['edid'].lower() not in found]
changed = 0
for r in rows:
    d = found.get(r['edid'].lower())
    if d and r.get('desc') != d: r['desc'] = d; changed += 1
print('%d of %d found in %s; %d changed%s' % (len(rows) - len(missing), len(rows), name, changed, '; missing: ' + ', '.join(missing) if missing else ''))
if not A.check and changed:
    with open(A.json, 'w', encoding='utf8', newline='\n') as f: f.write(json.dumps(G, indent=1) + '\n')
# admin-placeables.json is ck-mcp/admin_placeables.py's, which leaves the DLE out; DLE pieces staff place are hand additions
# named in its _comment, so these two are added the same way (compact, as the generator writes it)
PL = json.load(open(A.placeables, encoding='utf8'))
acts = next(c for c in PL['categories'] if c.get('id') == 'Activators')
have = {str(r[0]).lower() for r in acts['items']}
new = [[p['desc'], p['name'], name] for p in G.get('pieces', []) if p.get('desc') and p['desc'].lower() not in have]
print('admin-placeables Activators: %d to add%s' % (len(new), ' (' + ', '.join(r[1] for r in new) + ')' if new else ''))
if not A.check and new:
    acts['items'] += new
    note = ' Hand addition (Nat via the Leader, 25 Oct): the Study Bookshelf and the Planter (ACTI DBOStudyBookshelf, DBOPlanter; decor.js), added by tools/decor/fill_growing_ids.py.'
    if note not in PL['_comment']: PL['_comment'] += note
    with open(A.placeables, 'w', encoding='utf8', newline='\n') as f: f.write(json.dumps(PL, separators=(',', ':'), ensure_ascii=False))
sys.exit(1 if missing else 0)
