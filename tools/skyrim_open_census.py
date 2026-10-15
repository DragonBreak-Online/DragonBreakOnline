"""Opening Skyrim (check 3, 15 Oct), census over the NEW load order (the Skyrim release package):
  1. living actors: every ACHR whose winning record is enabled (not deleted, not initially disabled, not starts-dead, not
     sunk), grouped by the place it stands in (worldspace, or interior cell's plugin), split open / closed by the config's
     closedPlugins (memory server-spawns-all-actors: Bruma's were all disabled in the DLE; Skyrim's never were);
  2. load doors: every door (REFR with XTEL) standing in a closed land whose other side is in an open place: the doors the
     lock refuses (config playtest.blockedDoors), compared with the config.
Reads plugins from <package>/plugins when there, else /opt/skyrim-data, read-only. Run under ionice -c3 nice -n19.
  python3 tools/skyrim_open_census.py <package dir> <gamemode-config.json> <out.json>
"""
import sys, os, struct, json, collections
sys.path.insert(0, os.path.expanduser('~/dragonbreak/ck-mcp'))
from esplib import Plugin, subrecords, edid_of

PKG, CFG, OUT = sys.argv[1:4]
DATA = '/opt/skyrim-data'
order = [l.strip() for l in open(os.path.join(PKG, 'skyrim-data', 'loadorder.txt')) if l.strip() and not l.startswith('#')]
pt = json.load(open(CFG))['playtest']
closed = set(p.lower() for p in pt.get('closedPlugins', []))

def res(p, fid):
    return p.modindex_source(fid)

# pass 1: index only. place of every ref (resolved), world of every exterior cell, origin of worlds/cells
place_of = {}       # resolved ref -> ('W', world) | ('C', cell)
winner = {}         # resolved ACHR/door -> (plugin index, sig, flags, off, size)
plugins = []
for name in order:
    p = os.path.join(PKG, 'plugins', name)
    if not os.path.exists(p):
        p = os.path.join(DATA, name)
    pl = Plugin(p); plugins.append(pl)
    pi = len(plugins) - 1
    for sig, fid, flags, off, size, ctx in pl.index:
        if sig not in ('REFR', 'ACHR'):
            continue
        k = res(pl, fid)
        if ctx[0]:
            place_of[k] = ('W', res(pl, ctx[0]))
        elif ctx[1]:
            place_of[k] = ('C', res(pl, ctx[1]))
        winner[k] = (pi, sig, flags, off, size)
    print('indexed', name, file=sys.stderr)

def place_plugin(pl):
    return (pl[1][0] or '?')

def place_desc(pl):
    return '%s %x:%s' % ('world' if pl[0] == 'W' else 'cell', pl[1][1], pl[1][0])

actors = collections.Counter(); actors_closed = 0; actor_bases = collections.defaultdict(collections.Counter)
dle_disabled = 0; doors = []
handles = {}
def data(pi, off, size, flags):
    pl = plugins[pi]
    fh = handles.get(pi) or handles.setdefault(pi, open(pl.path, 'rb'))
    return pl.data_at(fh, off, size, flags)

base_edid = {}
need_bases = set()
for k, (pi, sig, flags, off, size) in winner.items():
    pl = place_of.get(k)
    if not pl:
        continue
    src = place_plugin(pl)
    if sig == 'ACHR':
        if flags & 0x20 or flags & 0x200:
            continue
        if flags & 0x800:
            if plugins[pi].key == 'dragonbreak online edits.esp' and src not in closed:
                dle_disabled += 1
            continue
        d = data(pi, off, size, flags); z = 0; base = None
        for s, v in subrecords(d):
            if s == b'DATA' and len(v) >= 12: z = struct.unpack_from('<3f', v)[2]
            elif s == b'NAME': base = res(plugins[pi], struct.unpack('<I', v[:4])[0])
        if z < -20000:
            continue
        if src in closed:
            actors_closed += 1; continue
        key = place_desc(pl) if pl[0] == 'W' else 'interiors of ' + src
        actors[key] += 1
        actor_bases[key][base] += 1; need_bases.add(base)
    elif src in closed and not (flags & 0x20):
        d = data(pi, off, size, flags)
        for s, v in subrecords(d):
            if s == b'XTEL':
                tgt = res(plugins[pi], struct.unpack('<I', v[:4])[0])
                tp = place_of.get(tgt)
                if tp and place_plugin(tp) not in closed:
                    doors.append({'door': '%x:%s' % (tgt[1], tgt[0]), 'in': place_desc(tp), 'leadsTo': place_desc(pl),
                                  'enabled': not (winner.get(tgt, (0, 0, 0))[2] & 0x800)})
for pl in plugins:
    with open(pl.path, 'rb') as fh:
        for sig, fid, flags, off, size, ctx in pl.index:
            k = res(pl, fid)
            if k in need_bases and sig in ('NPC_', 'LVLN'):
                base_edid[k] = edid_of(pl.data_at(fh, off, size, flags)) or '?'

cfg_doors = set(d.lower().lstrip('0') for d in pt.get('blockedDoors', []))
found = set(d['door'].lower() for d in doors)
out = {
    'livingActorsOpenTotal': sum(actors.values()), 'livingActorsClosedLands': actors_closed,
    'actorsAlreadyDisabledByDLE_open': dle_disabled,
    'livingActorsByPlace': actors.most_common(),
    'topBasesTamriel': [(base_edid.get(b, '?'), n) for b, n in actor_bases.get('world 3c:skyrim.esm', collections.Counter()).most_common(25)],
    'closedLandDoors': doors,
    'doorsMissingFromConfig': sorted(found - cfg_doors),
    'configDoorsNotFound': sorted(cfg_doors - found),
}
json.dump(out, open(OUT, 'w'), indent=1)
print('wrote', OUT, file=sys.stderr)
