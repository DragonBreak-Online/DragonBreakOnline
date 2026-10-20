"""Builds server/mines.json, every mine in the reachable world, for mines.js (Nate, 20 Oct: "allow all mines to be claimable.
orc mines belong to the strongholds").

A mine is a building of buildings.json (the interior cells behind a door from a worldspace) any of whose cells is a mine:
  - its location (CELL XLCN) carries the keyword LocTypeMine, or a parent of it does not but the location does, or
  - it holds an ore vein (the bases labour.js mines: MineOre*, CYRMineOre*, DLC2MineOre*, BSKMineOre*) and its editor id
    or its location's says Mine.
Only buildings whose way in stands in Tamriel (Skyrim) or BSHeartland (Bruma's land) are kept: the open lands.

Each mine lists its name (the location's FULL through the Strings tables, else the cell's, else the editor id), its hold (the
zones.json id: the location's parent chain to a hold location, else the nearest hold capital, Bruma by worldspace), the
location, its cells, its ways in (outside door and its far half), its ore veins with their ore, whether it is a lease dungeon
(dungeons.json) or kept out of the leases (gamemode-config dungeons.exclude), and, for an Orc stronghold's mine, the clan
faction (guild-defs.json) and how that was decided:
  parent    the location's parent chain reaches the stronghold's location (e.g. DushnikhMineLocation -> DushnikhYalLocation)
  radius    its way in stands within the stronghold's zones.json radius
  config    named in STRONGHOLD_MINES below (verified by hand)

    nice python3 tools/mines_build.py [--data DIR] [--order FILE] [--ck-mcp DIR] [--out FILE] [--check]
Read only on the plugins; reads every plugin once."""
import sys, os, json, struct, argparse, collections, hashlib, math, re

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.dirname(HERE)
ROOT = os.path.dirname(SERVER)
ap = argparse.ArgumentParser()
ap.add_argument('--data', default='/opt/skyrim-data' if os.path.isdir('/opt/skyrim-data') else os.path.join(ROOT, 'Skyrim Special Edition - dev', 'Data'))
ap.add_argument('--order', default=os.path.join(SERVER, 'plugins.server.txt'))
CKMCP = [os.path.join(ROOT, 'ck-mcp'), os.path.expanduser('~/dragonbreak/ck-mcp'), os.path.join(SERVER, 'tooling', 'ck-mcp')]
ap.add_argument('--ck-mcp', dest='ckmcp', default=next((d for d in CKMCP if os.path.isdir(d)), CKMCP[0]))
ap.add_argument('--zones', default='/opt/alduinak/build/dist/server/zones.json')
ap.add_argument('--out', default=os.path.join(SERVER, 'mines.json'))
ap.add_argument('--check', action='store_true')
args = ap.parse_args()
sys.path.insert(0, args.ckmcp)
import core
from bsastrings import Strings

DISABLED, DELETED, LOCALIZED = 0x800, 0x20, 0x80
# The open lands (gamemode-config playtest.closedPlugins closes Solstheim and the rest): Skyrim and Bruma's
WORLDS = {'Skyrim.esm:00003C': 'skyrim', 'BSHeartland.esm:0A764B': 'bruma'}
# Hold locations of Skyrim -> zones.json hold ids
HOLD_LOCS = {'WhiterunHoldLocation': 'whiterun', 'RiftHoldLocation': 'riften', 'HaafingarHoldLocation': 'solitude',
             'EastmarchHoldLocation': 'windhelm', 'ReachHoldLocation': 'markarth', 'FalkreathHoldLocation': 'falkreath',
             'HjaalmarchHoldLocation': 'morthal', 'PaleHoldLocation': 'dawnstar', 'WinterholdHoldLocation': 'winterhold'}
# Stronghold locations -> zones.json stronghold ids
STRONGHOLD_LOCS = {'DushnikhYalLocation': 'dushnikh-yal', 'MorKhazgurLocation': 'mor-khazgur', 'LargashburLocation': 'largashbur',
                   'NarzulburLocation': 'narzulbur', 'CrackedTuskKeepLocation': 'cracked-tusk'}
# Verified by hand where the plugins do not join a mine to its stronghold: name -> stronghold id
STRONGHOLD_MINES = {'Gol Kharzum Mine': 'gol-kharzum'}   # DragonBreak.esp's; its way in stands 7,200 units from the stronghold's centre
VEIN = re.compile(r'^(?:CYR|DLC2|BSK)?MineOre([A-Za-z]+?)(?:\d|_|$)')

lo = core.LoadOrder(args.data, args.order)
if lo.missing_plugins: print("missing plugins:", lo.missing_plugins)
S = Strings(args.data)

def desc(canon):
    src, loc = canon.rsplit(':', 1)
    return "%x:%s" % (int(loc, 16), src)
def canon_of_desc(d):
    loc, src = d.split(':', 1)
    return "%s:%06X" % (src, int(loc, 16))
def u32(b): return struct.unpack('<I', b[:4])[0]

def full_of(p, sub):
    v = sub.get(b'FULL')
    if not v: return ''
    if p.hflags & LOCALIZED and len(v) == 4:
        t = S.text(p.name, u32(v))
        return t or ''
    return v.rstrip(b'\0').decode('cp1252', 'replace')

# --- keywords, locations, cells, vein bases (winning versions) ---
kywd = {}
for p in lo.plugins:
    for ri, t, fid, fl, off, sz, ctx in lo.records(p, ('KYWD',)):
        e = core.esplib.edid_of(lo.body(p, off, sz, fl))
        if e: kywd[lo.canon(p, fid)] = e
loc = {}
for p in lo.plugins:
    for ri, t, fid, fl, off, sz, ctx in lo.records(p, ('LCTN',)):
        sub = lo.subrecords(p, off, sz, fl)
        kw = []
        k = sub.get(b'KWDA', b'')
        for i in range(0, len(k) - 3, 4): kw.append(kywd.get(lo.canon(p, u32(k[i:i + 4])), ''))
        name = full_of(p, sub) or (loc.get(lo.canon(p, fid)) or {}).get('name', '')
        loc[lo.canon(p, fid)] = {'edid': core.esplib.edid_of(lo.body(p, off, sz, fl)) or '', 'name': name, 'kw': kw,
                                 'parent': lo.canon(p, u32(sub[b'PNAM'])) if len(sub.get(b'PNAM', b'')) >= 4 else None}
cells = {}
for p in lo.plugins:
    for ri, t, fid, fl, off, sz, ctx in lo.records(p, ('CELL',)):
        sub = lo.subrecords(p, off, sz, fl)
        c = lo.canon(p, fid)
        prev = cells.get(c) or {}
        cells[c] = {'edid': core.esplib.edid_of(lo.body(p, off, sz, fl)) or prev.get('edid', ''), 'name': full_of(p, sub) or prev.get('name', ''),
                    'loc': lo.canon(p, u32(sub[b'XLCN'])) if len(sub.get(b'XLCN', b'')) >= 4 else prev.get('loc')}
acti = {}
for p in lo.plugins:
    for ri, t, fid, fl, off, sz, ctx in lo.records(p, ('ACTI',)):
        e = core.esplib.edid_of(lo.body(p, off, sz, fl)) or ''
        c = lo.canon(p, fid)
        m = VEIN.match(e)
        if m: acti[c] = 'geode' if m.group(1).lower() == 'blackreach' else m.group(1).lower()
        elif re.match(r'^(?:CYR|BSK)MineGem([A-Za-z]+?)\d', e, re.I): acti[c] = re.match(r'^(?:CYR|BSK)MineGem([A-Za-z]+?)\d', e, re.I).group(1).lower()
        else: acti.pop(c, None)
B = json.load(open(os.path.join(SERVER, 'buildings.json')))['buildings']
want = {canon_of_desc(e['door']) for b in B for e in b['entrances']}
door_pos = {}
veins = {}
for p in lo.plugins:
    for ri, t, fid, fl, off, sz, ctx in lo.records(p, ('REFR',)):
        sub = lo.subrecords(p, off, sz, fl)
        c = lo.canon(p, fid)
        base = lo.canon(p, u32(sub[b'NAME'])) if len(sub.get(b'NAME', b'')) >= 4 else None
        w, cell, g = ctx
        if c in want and len(sub.get(b'DATA', b'')) >= 12: door_pos[c] = list(struct.unpack('<3f', sub[b'DATA'][:12]))
        if base in acti and not (fl & (DELETED | DISABLED)) and cell and not w:
            veins[c] = {'ore': acti[base], 'cell': lo.canon(p, cell)}
        else: veins.pop(c, None)

def chain(l):
    out, seen = [], set()
    while l and l not in seen and l in loc:
        seen.add(l); out.append(l); l = loc[l]['parent']
    return out
def is_mine_loc(l): return bool(l) and 'LocTypeMine' in loc.get(l, {}).get('kw', [])

# --- dungeons, zones, factions ---
lease_cells, lease_of = set(), {}
for d in json.load(open(os.path.join(SERVER, 'dungeons.json')))['dungeons']:
    for cl in d['cells']: lease_cells.add(canon_of_desc(cl['desc'])); lease_of[canon_of_desc(cl['desc'])] = d['id']
cfg = json.load(open(os.path.join(SERVER, 'gamemode-config.json')))
excluded = set((cfg.get('dungeons') or {}).get('exclude') or [])
Z = json.load(open(args.zones))
defs = json.load(open(os.path.join(SERVER, 'guild-defs.json')))
clan_of = {f['zone']: f['id'] for f in defs.get('factions', defs if isinstance(defs, list) else []) if isinstance(f, dict) and f.get('kind') == 'stronghold'}
vein_by_cell = collections.defaultdict(list)
for r, v in veins.items(): vein_by_cell[v['cell']].append((r, v['ore']))

def nearest_hold(pos):
    best, bd = None, 1e18
    for h in Z['holds']:
        if not h.get('capital'): continue
        d = math.hypot(pos[0] - h['capital'][0], pos[1] - h['capital'][1])
        if d < bd: bd, best = d, h['id']
    return best

mines = []
for b in B:
    world = WORLDS.get(canon_of_desc(b['world']))
    if not world: continue
    cs = [canon_of_desc(x) for x in b['cells']]
    mine_cells = [c for c in cs if is_mine_loc((cells.get(c) or {}).get('loc'))
                  or (vein_by_cell.get(c) and re.search(r'mine', (cells.get(c) or {}).get('edid', '') + ' ' + loc.get((cells.get(c) or {}).get('loc'), {}).get('edid', ''), re.I))]
    if not mine_cells: continue
    l = next((cells[c]['loc'] for c in mine_cells if is_mine_loc(cells[c].get('loc'))), None) or (cells.get(mine_cells[0]) or {}).get('loc')
    ch = chain(l)
    first = next(c for c in cs if c in mine_cells)
    name = (is_mine_loc(l) and (loc.get(l) or {}).get('name')) or (cells.get(first) or {}).get('name') or (loc.get(l) or {}).get('name') or (cells.get(first) or {}).get('edid', '')
    p = door_pos.get(canon_of_desc(b['entrances'][0]['door']))
    hold, how_hold = None, ''
    if world == 'bruma': hold, how_hold = 'bruma', 'worldspace'
    else:
        for x in ch:
            if loc[x]['edid'] in HOLD_LOCS: hold, how_hold = HOLD_LOCS[loc[x]['edid']], 'parent'; break
        if not hold and p: hold, how_hold = nearest_hold(p), 'nearest capital'
    sh, how = None, ''
    for x in ch:
        if loc[x]['edid'] in STRONGHOLD_LOCS: sh, how = STRONGHOLD_LOCS[loc[x]['edid']], 'parent:' + loc[x]['edid']; break
    if not sh and name in STRONGHOLD_MINES: sh, how = STRONGHOLD_MINES[name], 'config'
    if not sh and p and world == 'skyrim':
        for s in Z['strongholds']:
            if math.hypot(p[0] - s['center'][0], p[1] - s['center'][1]) <= s.get('radius', 6000): sh, how = s['id'], 'radius'; break
    vs = sorted((r, o) for c in mine_cells for r, o in vein_by_cell.get(c, []))
    leases = sorted({lease_of[c] for c in mine_cells if c in lease_of})
    mines.append({
        'id': (cells.get(first) or {}).get('edid') or desc(canon_of_desc(b['id'])), '_loc': l if l and (is_mine_loc(l) or 'mine' in loc.get(l, {}).get('edid', '').lower()) else None,
        'name': name, 'hold': hold, 'holdBy': how_hold, 'world': world,
        'location': desc(l) if l else None, 'locationEdid': (loc.get(l) or {}).get('edid', ''),
        'cells': [desc(c) for c in mine_cells], **({'buildingCells': len(cs)} if len(cs) != len(mine_cells) else {}), 'entrances': [{'door': e['door'], 'inside': e['inside']} for e in b['entrances'] if canon_of_desc(e['cell']) in mine_cells] or [{'door': e['door'], 'inside': e['inside']} for e in b['entrances']],
        'veins': [{'ref': desc(r), 'ore': o} for r, o in vs],
        **({'lease': leases} if leases else {}),
        **({'leaseExcluded': True} if leases and all(x in excluded for x in leases) else {}),
        **({'stronghold': sh, 'clan': clan_of.get(sh), 'strongholdBy': how} if sh else {}),
        **({'disabled': True} if 'disabled' in b.get('flags', []) else {}),
    })
# The id: the mine location's editor id when no other mine shares it, else the first mine cell's (Bleak-Frost and Frost-Iron
# share CYRMountainwatchFrostironmine); unique either way
per_loc = collections.Counter(m['_loc'] for m in mines if m['_loc'])
for m in mines:
    l = m.pop('_loc')
    if l and per_loc[l] == 1: m['id'] = re.sub(r'location$', '', loc[l]['edid'], flags=re.I)
seen = collections.Counter()
for m in mines:
    seen[m['id']] += 1
    if seen[m['id']] > 1: m['id'] = '%s-%d' % (m['id'], seen[m['id']])
# Mine locations with no building kept above, for the record (another worldspace, no way in from a world, or no cell)
kept = {canon_of_desc(m['location']) for m in mines if m['location']}
unlisted = sorted('%s (%s)' % (v['edid'], v['name']) for k, v in loc.items() if 'LocTypeMine' in v['kw'] and k not in kept)
mines.sort(key=lambda m: (m['world'] != 'bruma', m['hold'] or '', m['name']))
order = open(args.order, 'rb').read() if os.path.isfile(args.order) else b''
out = {
    "_comment": "Generated by server/tools/mines_build.py from the load order and buildings.json (--check tells whether it is current). Every mine of Skyrim and Bruma's land: its hold (zones.json id), location, cells, ways in, ore veins, lease dungeon ids, and for an Orc stronghold's mine the clan faction and how that was decided. mines.js owns them as property.",
    "loadOrderSha1": hashlib.sha1(order).hexdigest(),
    "counts": {"mines": len(mines), "byWorld": dict(collections.Counter(m['world'] for m in mines)), "stronghold": sum(1 for m in mines if m.get('stronghold')),
               "lease": sum(1 for m in mines if m.get('lease')), "veins": sum(len(m['veins']) for m in mines), "noVeins": sum(1 for m in mines if not m['veins'])},
    "mines": mines,
    "notListed": unlisted,
}
text = json.dumps(out, indent=1) + "\n"
if args.check:
    try: same = open(args.out).read() == text
    except Exception: same = False
    print("mines.json is", "current" if same else "OUT OF DATE: run tools/mines_build.py")
    sys.exit(0 if same else 1)
open(args.out, 'w').write(text)
print(json.dumps(out["counts"]))
