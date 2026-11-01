# Every winning WEAP in the load order: damage, type (WeapType keyword), family (loot-materials.json by desc), tier
# (smithing.json). Usage: py tools/materials/weapon_census.py <Data> <plugins.txt> <server dir> <census.csv>. The ceiling of a tier for a type is the highest vanilla damage of any family at that tier or below;
# a weapon above it by more than 1 is an outlier. Writes weapons.csv and prints the summary. Reads plugins only.
import sys, os, re, json, struct, collections, importlib.util
spec = importlib.util.spec_from_file_location('r', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cca_read_lib.py'))
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
DATA, ORDER, SERVER, OUT = sys.argv[1:5]
order = [l.strip().lstrip('*') for l in open(ORDER, encoding='utf-8-sig') if l.strip() and not l.startswith('#')]
fam = json.load(open(os.path.join(SERVER, 'loot-materials.json'), encoding='utf-8'))['items']
tiers = {f['id']: f['tier'] for f in json.load(open(os.path.join(SERVER, 'smithing.json'), encoding='utf-8'))['families']}
TYPES = {'WeapTypeSword': 'sword', 'WeapTypeDagger': 'dagger', 'WeapTypeWarAxe': 'waraxe', 'WeapTypeMace': 'mace', 'WeapTypeGreatsword': 'greatsword',
         'WeapTypeBattleaxe': 'battleaxe', 'WeapTypeWarhammer': 'warhammer', 'WeapTypeBow': 'bow'}
VANILLA = {'iron': 'Iron', 'steel': 'Steel', 'orcish': 'Orcish', 'dwarven': 'Dwarven', 'elven': 'Elven', 'glass': 'Glass', 'EBONY': 'Ebony', 'DAEDRIC': 'Daedric'}
kw, win, low = {}, {}, {o.lower(): o for o in order}
for p in order:
    b = open(os.path.join(DATA, p), 'rb').read()
    ms = []
    for sig, fl, fid, data in r.records(b, {'KYWD', 'WEAP'}):
        if sig == 'TES4': ms = [r.zstr(v) for t, v in r.fields(data) if t == 'MAST']; continue
        origin = (ms[fid >> 24] if (fid >> 24) < len(ms) else p)
        key = (origin.lower(), fid & 0xffffff)
        fs = r.fields(data); ed = next((r.zstr(v) for t, v in fs if t == 'EDID'), '')
        if sig == 'KYWD': kw[key] = ed; continue
        d = next((v for t, v in fs if t == 'DATA'), b''); k = next((v for t, v in fs if t == 'KWDA'), b'')
        ks = []
        for i in range(0, len(k) - 3, 4):
            x = struct.unpack_from('<I', k, i)[0]
            ks.append(((ms[x >> 24] if (x >> 24) < len(ms) else p).lower(), x & 0xffffff))
        flags = next((v for t, v in fs if t == 'DNAM'), b'')
        win[key] = {'edid': ed, 'origin': origin, 'winner': p, 'dmg': struct.unpack_from('<H', d, 8)[0] if len(d) >= 10 else 0, 'kws': ks}
rows = []
for (o, lid), w in win.items():
    names = [kw.get(x, '') for x in w['kws']]
    t = next((TYPES[n] for n in names if n in TYPES), '')
    desc = '%x:%s' % (lid, o)
    f = fam.get(desc, '')
    if not t or not f or f not in tiers or w['dmg'] <= 0: continue
    rows.append({'desc': desc, 'edid': w['edid'], 'winner': w['winner'], 'type': t, 'family': f, 'tier': tiers[f], 'dmg': w['dmg'], 'vanilla': w['edid']})
# Ceilings from vanilla: the vanilla piece of each family by edid, e.g. IronSword, DaedricWarAxe, ElvenBow
vd = {}
for r_ in rows:
    for f, name in VANILLA.items():
        if r_['family'] == f and re.fullmatch(name + r'(Sword|Dagger|WarAxe|Mace|Greatsword|Battleaxe|Warhammer|Bow)', r_['edid']):
            vd[(f, r_['type'])] = r_['dmg']
ceil = {}
for t in TYPES.values():
    for tier in range(1, 8):
        vals = [d for (f, tt), d in vd.items() if tt == t and tiers[f] <= tier]
        if vals: ceil[(t, tier)] = max(vals)
out = []
for r_ in rows:
    c = ceil.get((r_['type'], r_['tier']))
    r_['ceiling'] = c
    r_['over'] = (c is not None and r_['dmg'] > c + 1)
    out.append(r_)
import csv
with open(OUT, 'w', newline='', encoding='utf-8') as fh:
    w = csv.DictWriter(fh, fieldnames=['desc', 'edid', 'winner', 'type', 'family', 'tier', 'dmg', 'ceiling', 'over', 'vanilla'])
    w.writeheader(); [w.writerow(x) for x in out]
print('weapons with a type and a tiered family:', len(out), '; vanilla ceilings found:', len(vd))
print('ceilings (sword):', {k[1]: v for k, v in ceil.items() if k[0] == 'sword'})
over = [x for x in out if x['over']]
print('over their tier ceiling by more than 1:', len(over))
print('by tier:', dict(collections.Counter(x['tier'] for x in over)))
print('by winning plugin:', collections.Counter(x['winner'] for x in over).most_common(10))
for x in sorted(over, key=lambda x: x['dmg'] - (x['ceiling'] or 0), reverse=True)[:12]:
    print('  %s %s T%d %s %s dmg %d ceiling %s' % (x['edid'], x['family'], x['tier'], x['type'], x['winner'], x['dmg'], x['ceiling']))
