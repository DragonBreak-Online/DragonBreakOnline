r"""decor-catalog.json: what players may place in their own homes, and what each piece costs (home decorating, Nat
approved 25 Oct; design _work\home-decorating-design-1025.md on the PC).

    py -I tools/decor/decor_catalog.py --data "<Skyrim Data>" --manifest <install-manifest.json> --extras <extras.txt> [--out decor-catalog.json]

--manifest and --extras are read-only copies of the live launcher lists (CT115: skymp5-backend/data/install-manifest.json
and `find client-files/extra -type f -printf "%P\n"`). A piece is listed only if its mesh, and every texture the mesh
names, is in what a player gets: the vanilla BSAs, the BSAs and loose files of those two lists.

Pieces: STAT / FURN / CONT / LIGH bases of Skyrim, Dawnguard, Hearthfire, Dragonborn, BSAssets and BSHeartland, picked
by group from the editor id; never MISC or MSTT (takeable or physics: a refund would duplicate), doors, markers or NPCs.
Lights: LIGH with a model, not carryable, no shadow flag. Workbenches: FURN carrying an indoor station keyword.

Cost:
  costA  Hearthfire's own bill of materials ({editor id: count}): the recipe of the Hearthfire interior piece of the
         same kind (bed, chair, chest ...), or the group default when Hearthfire has none. Workbenches add their extra.
  costB  the same converted to resources players gather today ({desc: count}), at RAW below; phase 1 pays this.
"""
import sys, os, re, json, struct, argparse, collections, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'tooling', 'ck-mcp')); sys.path.insert(0, HERE)
import esplib, bsa_index
from bsastrings import Strings

ap = argparse.ArgumentParser(); ap.add_argument('--data', required=True); ap.add_argument('--manifest', required=True)
ap.add_argument('--extras', required=True); ap.add_argument('--out', default=os.path.join(HERE, '..', '..', 'decor-catalog.json'))
A = ap.parse_args()
SOURCES = ['Skyrim.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'BSAssets.esm', 'BSHeartland.esm', 'MoreCraftableEquipment.esp']

GROUPS = [   # id, label, record types, editor-id pattern
    ('beds', 'Beds', ('FURN',), r'bed'),
    ('seating', 'Seating', ('FURN',), r'chair|bench|stool|throne'),
    ('tables', 'Tables', ('FURN', 'STAT'), r'table|desk'),
    ('storage', 'Storage', ('CONT',), r'chest|wardrobe|cupboard|dresser|drawers|endtable|nighttable|strongbox|barrel|sack|cabinet|crate|footlocker'),
    ('shelves', 'Shelves and display', ('STAT', 'FURN', 'CONT'), r'shelf|bookcase|displaycase|mannequin'),
    ('decor', 'Decor', ('STAT',), r'rug|tapestr|banner|planter|trophy|mountedhead|painting'),
    ('lights', 'Lights', ('LIGH', 'STAT'), r'candle|candelabra|lantern|chandelier|sconce'),
]
# LIGH DATA flags at byte 12, read from BSHeartland's own pairs (CYRCandleOrangeTint 0x1009 vs its NS twin 0x9): 0x1000 omni
# shadow, 0x800 hemisphere shadow, 0x400 spot shadow; 0x2 carryable. A light static gets this vanilla no-shadow candle light.
RADIUS = {'beds': 120, 'seating': 50, 'tables': 90, 'storage': 60, 'shelves': 70, 'decor': 60, 'lights': 20, 'workbenches': 100}
PAIR_LIGHT = {'base': '88238:Skyrim.esm', 'edid': 'DefaultCandleLight01NS', 'radius': 256}
EXCLUDE = re.compile(r'marker|dummy|placeholder|test|player|ruin|dwe|ayl|akavir|snow|exterior|broken|destroy|vampire|coffin|treas|merchant|norespawn|'
                     r'nocoll|collision|apiary|fishery|buoy|fishnet|vendor|child|invisible|notcrafting|poison|hav|'
                     r'kvatch|skingrad|anvil|leyawiin|chorrol|cheydinhal|bravil|^ic|imperialcity|dunmer.*ruin|^dlc1|^dlc2(?!craftingstaff)|'
                     r'orc.*stronghold|^mq|^dun|^tg|^db|^cw|^da\d|^ms\d|^c0|^c00|bandit|forsworn|giant|nordic|draugr|sovngarde|'
                     r'_off$|off$|wall$|frame|broken|'
                     # Hearthfire's building benches carry isBlacksmithWorkbench / isEnchanting for their animation: never a station
                     r'carpenter|drafting|trophybase|interiorworkbench|'
                     # structural, quest or location kit pieces rather than furniture
                     r'balcony|stable|civilwar|nightingale|^sov|anim|anchor|minec|cave|^nor[A-Z]|ice|ship|floor|static|nopick|^hh|post\d*$|'
                     r'rock|confiscat|mournful|thalmor|bannered|jorrvaskr|market|'
                     r'corpse|desecrat|e3demo|^ff|boss|unowned|septimus|vald|companions|kodlak|gemchest', re.I)
# containers: generic household furniture only (quest, guild and boss chests share the words)
GENERIC_CONT = re.compile(r'^(BYOHHouse)?(CYR)?(Common|Noble|Upper|Lower|Middle|Orc|DarkElf|Misc|Barrel|Sack|Knapsack|Cupboard|Dresser|EndTable|NightTable|Wardrobe|ChestOfDrawers)', re.I)
NEVER_STATION = re.compile(r'carpenter|drafting|trophybase|interiorworkbench|invisible|notcrafting|poison|player|test|aetherium|console|^dun|^dwe', re.I)
STATIONS = {   # keyword editor id -> rules (design section 6; D8/D9 approved at the recommended values)
    # specific keywords first: MCE's loom also carries isTanning, Hearthfire's oven and the staff bench their own
    'DLC2StaffEnchanter': {'skill': 'enchanter', 'tier': 3, 'minCells': 3, 'extra': {'SoulGemGreaterFilled': 1, 'IngotIMoonstone': 1, 'IngotQuicksilver': 1}},
    'MCE_CraftingLoom': {'skill': 'tailor', 'tier': 0, 'minCells': 1, 'extra': {'BYOHMaterialLog': 4, 'BYOHMaterialNails': 10, 'RuinsLinenPile01': 4}},
    'BYOHCraftingOven': {'skill': 'cook', 'tier': 0, 'minCells': 1, 'extra': {'BYOHMaterialStoneBlock': 6, 'BYOHMaterialClay': 2, 'BYOHMaterialFittingsIron': 1}},
    'isAlchemy': {'skill': 'alchemist', 'tier': 1, 'minCells': 1, 'extra': {'BYOHMaterialGlass': 2, 'ingotSilver': 1, 'BYOHMaterialLog': 2}},
    'isEnchanting': {'skill': 'enchanter', 'tier': 1, 'minCells': 2, 'extra': {'SoulGemPettyFilled': 1, 'BYOHMaterialStoneBlock': 2, 'IngotGold': 1, 'GemAmethyst': 1, 'GemGarnet': 1}},
    'isTanning': {'skill': 'skinner', 'tier': 0, 'minCells': 1, 'extra': {'BYOHMaterialLog': 3, 'LeatherStrips': 2}},
    'isBlacksmithWorkbench': {'skill': 'blacksmith', 'tier': 1, 'minCells': 2, 'extra': {'BYOHMaterialLog': 3, 'IngotIron': 2}},
    'CraftingSmithingSharpeningWheel': {'skill': 'blacksmith', 'tier': 1, 'minCells': 2, 'extra': {'BYOHMaterialStoneBlock': 1, 'IngotIron': 1}},
    'isCookingSpit': None, 'isSmallCookingPot': {'skill': None, 'tier': 0, 'minCells': 1, 'needsHearth': 300, 'extra': {'IngotIron': 1}},
}
# Hearthfire material -> what players gather today, per unit (design 5, Option B). Fractions sum per piece and round up.
RAW = {'BYOHMaterialLog': {'Firewood01': 4}, 'BYOHMaterialNails': {'IngotIron': 0.1}, 'BYOHMaterialHinge': {'IngotIron': 0.5},
       'BYOHMaterialFittingsIron': {'IngotIron': 1}, 'BYOHMaterialLock': {'IngotIron': 1, 'IngotCorundum': 1},
       'BYOHMaterialStoneBlock': {'OreIron': 2}, 'BYOHMaterialClay': {'SaltPile': 1}, 'BYOHMaterialGlass': {'SaltPile': 1, 'Firewood01': 2},
       'BYOHMaterialStraw': {'Wheat': 1}}
DEFAULT = {   # group -> Hearthfire-style cost when no Hearthfire recipe of the same kind exists
    'beds': {'BYOHMaterialLog': 1, 'BYOHMaterialNails': 1, 'LeatherStrips': 2, 'BYOHMaterialStraw': 1},
    'seating': {'BYOHMaterialLog': 1, 'BYOHMaterialNails': 1}, 'tables': {'BYOHMaterialLog': 2, 'BYOHMaterialNails': 4},
    'storage': {'BYOHMaterialLog': 1, 'BYOHMaterialNails': 2, 'BYOHMaterialFittingsIron': 1},
    'shelves': {'BYOHMaterialLog': 2, 'BYOHMaterialNails': 4}, 'decor': {'RuinsLinenPile01': 3},
    'lights': {'BYOHMaterialFittingsIron': 1, 'BYOHMaterialGlass': 1}, 'workbenches': {'BYOHMaterialLog': 2, 'BYOHMaterialNails': 4}}
KINDS = [  # editor-id word -> recipe kind; first match wins (doubles before singles)
    ('beddouble', r'bed.*double|double.*bed'), ('bed', r'bed'), ('bench', r'bench'), ('chair', r'chair|stool|throne'),
    ('displaycase', r'displaycase'), ('mannequin', r'mannequin'), ('bookshelf', r'bookshelf|bookcase'), ('wallshelf', r'wallshel'),
    ('shelf', r'shelf'), ('wardrobe', r'wardrobe'), ('cupboard', r'cupboard'), ('dresser', r'dresser|drawers'),
    ('nighttable', r'nighttable|endtable'), ('strongbox', r'strongbox'), ('chest', r'chest'), ('barrel', r'barrel'),
    ('table', r'table|desk'), ('planter', r'planter'), ('rug', r'rug'), ('tapestry', r'tapestr|banner')]

def kind_of(e):
    for k, rx in KINDS:
        if re.search(rx, e, re.I): return k
    return None

def masters(path):
    b = open(path, 'rb').read(24 + struct.unpack('<I', open(path, 'rb').read(8)[4:8])[0]); h, i, m = b[24:], 0, []
    while i < len(h):
        k, s = h[i:i + 4], struct.unpack('<H', h[i + 4:i + 6])[0]
        if k == b'MAST': m.append(h[i + 6:i + 6 + s - 1].decode())
        i += 6 + s
    return m

STR = Strings(A.data)
plugins = {}
for pn in SOURCES:
    p = os.path.join(A.data, pn)
    if not os.path.exists(p): print('not in Data, skipped:', pn); continue
    P = esplib.Plugin(p); hflags = struct.unpack('<I', open(p, 'rb').read(12)[8:12])[0]
    plugins[pn] = (P, open(p, 'rb'), len(masters(p)), hflags, masters(p))
def recs(pn):
    P, fh, selfi, hf, ms = plugins[pn]
    for t, f, fl, o, z, cx in P.index:
        t = t if isinstance(t, str) else t.decode()
        yield t, f, fl, [(k.decode(), bytes(v)) for k, v in esplib.subrecords(P.data_at(fh, o, z, fl))] if t in ('STAT', 'FURN', 'CONT', 'LIGH', 'KYWD', 'MISC', 'INGR', 'COBJ', 'SLGM', 'ALCH', 'AMMO', 'WEAP', 'ARMO') else None
edid_of = lambda sub: dict(sub).get('EDID', b'').rstrip(b'\0').decode(errors='replace')

# editor id -> desc for items and keywords, first plugin that owns it (vanilla first)
by_edid, kw_edid = {}, {}
for pn in plugins:
    selfi = plugins[pn][2]
    for t, f, fl, sub in recs(pn):
        if sub is None or (f >> 24) != selfi: continue
        e = edid_of(sub)
        if t == 'KYWD': kw_edid[(pn, f & 0xFFFFFF)] = e
        elif t in ('MISC', 'INGR', 'SLGM', 'ALCH', 'AMMO', 'WEAP', 'ARMO'): by_edid.setdefault(e, '%x:%s' % (f & 0xFFFFFF, pn))

# Hearthfire recipes of interior pieces -> kind -> most common bill of materials
def item_edid(fid, owner_masters, owner):
    hi = fid >> 24; pn = owner_masters[hi] if hi < len(owner_masters) else owner
    return lookup.get((pn, fid & 0xFFFFFF))
lookup = {}
for pn in plugins:
    ms_ = plugins[pn][4]; selfi = plugins[pn][2]
    for t, f, fl, sub in recs(pn):
        if sub is None or t in ('COBJ',): continue
        owner = ms_[f >> 24] if (f >> 24) < selfi else pn
        lookup.setdefault((owner, f & 0xFFFFFF), edid_of(sub))
recipes = collections.defaultdict(collections.Counter)
for t, f, fl, sub in recs('HearthFires.esm'):
    if t != 'COBJ': continue
    d = dict(sub)
    if 'CNAM' not in d: continue
    prod = item_edid(struct.unpack('<I', d['CNAM'])[0], plugins['HearthFires.esm'][4], 'HearthFires.esm') or ''
    if 'Interior' not in prod and 'Furniture' not in prod: continue
    k = kind_of(re.sub(r'^BYOHHouseInteriorPart\d+', '', prod))
    if not k: continue
    cost = collections.Counter()
    for kk, v in sub:
        if kk == 'CNTO':
            it, n = struct.unpack('<Ii', v[:8]); cost[item_edid(it, plugins['HearthFires.esm'][4], 'HearthFires.esm')] += n
    recipes[k][json.dumps(dict(sorted(cost.items())))] += 1
TEMPLATE = {k: json.loads(c.most_common(1)[0][0]) for k, c in recipes.items()}

# what players get
man = json.load(open(A.manifest, encoding='utf-8')); loose, bsas = set(), set()
for m in man['mods']:
    for fi in m['files']:
        to = fi['to'].replace('/', '\\').lower(); (bsas if to.endswith('.bsa') else loose).add(to)
for l in open(A.extras, encoding='utf-8'):
    p = l.strip().replace('/', '\\')
    if p.lower().startswith('data\\'): p = p[5:].lower(); (bsas if p.endswith('.bsa') else loose).add(p)
bsas |= {f.lower() for f in os.listdir(A.data) if f.lower().startswith('skyrim - ') and f.lower().endswith('.bsa')}
have = {}
for b in sorted(bsas):
    if os.path.exists(os.path.join(A.data, b)):
        for k in bsa_index.names(os.path.join(A.data, b)): have.setdefault(k, b)
def where(p): p = p.lower(); return have.get(p) or ('loose' if p in loose else None)
def asset_ok(model):
    m = ('meshes\\' + model).lower().replace('/', '\\'); w = where(m)
    if not w: return False, 'mesh ' + m
    blob = bsa_index.read(os.path.join(A.data, w), m) if w.endswith('.bsa') else (open(os.path.join(A.data, m), 'rb').read() if os.path.exists(os.path.join(A.data, m)) else b'')
    for tx in set(re.findall(rb'[\w\\/ .\'-]+\.dds', blob, re.I)):
        t = tx.decode(errors='replace').strip().lstrip('\\').replace('/', '\\').lower(); k = t.rfind('data\\textures\\')
        t = t[k + 5:] if k >= 0 else t; t = t if t.startswith('textures\\') else 'textures\\' + t
        if not where(t) and not re.search(r'material\.|placeholder', t): return False, 'texture ' + t
    return True, None

def name_of(pn, sub):
    v = dict(sub).get('FULL', b'')
    if not v: return ''
    if plugins[pn][3] & 0x80: return (STR.text(pn, struct.unpack('<I', v[:4])[0]) or '').strip() if len(v) == 4 else ''
    return v.rstrip(b'\0').decode('cp1252', 'replace').strip()
def human(e):
    """A readable name for a static (statics have no FULL): kit prefixes and numbering dropped, words split."""
    s = re.sub(r'^(BYOHHouse|BYOH|BSHDLC2|BSH|CYR|cyr|BSK|BSM|DLC2|RTM|rtm|WR|SOV|Imp|Sil|Apo)', '', e)
    s = re.sub(r'(\d+[A-Za-z]?|NEW|SN|NS|Static|Heavy)$', '', re.sub(r'(\d+[A-Za-z]?|NEW|SN|NS)$', '', s))
    s = re.sub(r'([a-z])([A-Z])', r'\1 \2', s); s = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1 \2', s)
    s = re.sub(r'(?<=[A-Za-z])(\d)', r' \1', s).replace('_', ' ')
    return ' '.join(w.capitalize() if w.islower() else w for w in s.split()) or e
def to_raw(costA):
    raw = collections.defaultdict(float)
    for k, n in costA.items():
        for r, q in RAW.get(k, {k: 1}).items(): raw[r] += q * n
    out = {}
    for r, q in raw.items():
        d = by_edid.get(r)
        if not d: raise SystemExit('cost item not found by editor id: ' + r)
        out[d] = int(math.ceil(q - 1e-9))
    return out

items, dropped, seen_models = [], collections.Counter(), set()
for pn in plugins:
    P, fh, selfi, hf, ms_ = plugins[pn]
    for t, f, fl, sub in recs(pn):
        if sub is None or t not in ('STAT', 'FURN', 'CONT', 'LIGH') or (f >> 24) != selfi or fl & 0x20: continue
        d = dict(sub); e = edid_of(sub)
        if not e or 'MODL' not in d: continue
        kws = set()
        if 'KWDA' in d:
            for (kid,) in struct.iter_unpack('<I', d['KWDA']):
                kpn = ms_[kid >> 24] if (kid >> 24) < selfi else pn
                kws.add(lookup.get((kpn, kid & 0xFFFFFF), ''))
        station = next((k for k in STATIONS if k in kws or k == e), None)
        if e == 'DLC2CraftingStaffWorkbench': station = 'DLC2StaffEnchanter'
        # the real tanning rack, loom and oven are named ...Marker, so a station answers only to NEVER_STATION
        if (NEVER_STATION if station and t == 'FURN' else EXCLUDE).search(e): continue
        if t == 'CONT' and not GENERIC_CONT.search(e): continue
        group = None
        if station:
            if STATIONS.get(station) is None or t != 'FURN': continue
            group = 'workbenches'
        else:
            for gid, label, types, rx in GROUPS:
                if t in types and re.search(rx, e, re.I): group = gid; break
        if not group: continue
        light = None
        if t == 'LIGH':
            data = d.get('DATA', b'')
            if len(data) < 16: continue
            lf = struct.unpack('<I', data[12:16])[0]
            if lf & 0x2 or lf & (0x400 | 0x800 | 0x1000): dropped['light carryable or shadowed'] += 1; continue
            light = {'radius': struct.unpack('<I', data[4:8])[0]}
        elif group == 'lights':
            light = dict(PAIR_LIGHT)                                  # a candle or lantern static lit by a separate light ref
        model = d['MODL'].rstrip(b'\0').decode(errors='replace')
        if (group, model.lower()) in seen_models: dropped['same mesh as another piece'] += 1; continue
        ok, why = asset_ok(model)
        if not ok: dropped['asset missing'] += 1; continue
        seen_models.add((group, model.lower()))
        k = kind_of(e)
        costA = dict(TEMPLATE.get(k) or DEFAULT[group])
        rule = None
        if station:
            rule = dict(STATIONS[station]); extra = rule.pop('extra')
            for m, n in extra.items(): costA[m] = costA.get(m, 0) + n
            rule['keyword'] = station
        ob = list(struct.unpack('<6h', d.get('OBND', b'\0' * 12)[:12]))
        row = {'desc': '%x:%s' % (f & 0xFFFFFF, pn), 'edid': e, 'name': name_of(pn, sub) or human(e), 'group': group, 'type': t,
               'costA': costA, 'costB': to_raw(costA)}
        if any(ob):
            row['bounds'] = ob; row['radius'] = int(math.hypot(ob[3] - ob[0], ob[4] - ob[1]) / 2)
        else:                                                         # Bethesda left OBND empty: a footprint by group, marked
            row['radius'] = RADIUS[group]; row['radiusEstimated'] = True
        if t == 'CONT': row['container'] = True
        if light: row['light'] = light
        if rule: row['station'] = rule
        items.append(row)

labels = dict((g[0], g[1]) for g in GROUPS); labels['workbenches'] = 'Workbenches'
cats = collections.OrderedDict((g, []) for g in list(labels))
dup = collections.Counter((r['group'], r['name']) for r in items)
for r in items:                                                       # eighteen pieces are just "Bed" in game: say which
    if dup[(r['group'], r['name'])] > 1 and human(r['edid']).lower() != r['name'].lower(): r['name'] = '%s (%s)' % (r['name'], human(r['edid']))
for r in sorted(items, key=lambda r: (r['name'].lower(), r['desc'])): cats[r['group']].append(r)
mats = sorted({m for r in items for m in r['costA']})
out = {'_comment': 'Generated by tools/decor/decor_catalog.py (home decorating, Nat 25 Oct). costA: Hearthfire materials by editor id; '
                   'costB: what players gather today, by desc (phase 1 pays costB). Pieces are checked against the launcher lists: mesh and textures.',
       'version': 1, 'raw': RAW, 'materials': {m: by_edid.get(m) for m in mats},
       'groups': [{'id': g, 'label': labels[g], 'pieces': v} for g, v in cats.items() if v]}   # not 'items': the id check reads that as inventory
json.dump(out, open(A.out, 'w', encoding='utf-8'), indent=1)
print('pieces', len(items), {g: len(v) for g, v in cats.items()}, '| dropped', dict(dropped))
print('Hearthfire recipe kinds', sorted(TEMPLATE)); print('materials without a desc', [m for m in mats if not by_edid.get(m)])
