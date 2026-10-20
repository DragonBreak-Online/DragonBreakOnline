"""Read-only survey: the magic effects that damage the undead like the sun, and what carries them.

Reads the live plugins in /opt/skyrim-data through ck-mcp/esplib.py, in load order, and prints every MGEF whose
editor id mentions the sun, with its DATA resist actor value (41 fire, 42 shock, 43 frost, 0 none) and its
archetype, plus every SPEL/ENCH/SCRL that names one in an EFID. Writes nothing.
  python3 -I find_sun.py
"""
import sys, os, struct, collections
sys.path.insert(0, os.path.expanduser('~/dragonbreak/ck-mcp'))
from esplib import Plugin, subrecords, edid_of

DATA = '/opt/skyrim-data'
LOADORDER = os.path.expanduser('~/dragonbreak/fork/deploy/skyrim-data/loadorder.txt')
names = [l.strip().lstrip('*') for l in open(LOADORDER, encoding='utf-8-sig') if l.strip() and not l.startswith('#')]

sun_global = {}          # global id -> (plugin, edid, resist)
by_plugin = {}

def global_of(p, fid):
    """The id this plugin's fid has in the game's space, using its own load order position."""
    key, loc = p.modindex_source(fid)
    if key is None:
        return None
    idx = order.get(key)
    return None if idx is None else ((idx << 24) | loc)

order = {n.lower(): i for i, n in enumerate(names)}
plugins = []
for name in names:
    path = os.path.join(DATA, name)
    if not os.path.exists(path):
        continue
    try:
        plugins.append(Plugin(path))
    except Exception as e:
        print(f'  (skipped {name}: {e})')

# 1. the sun effects
for p in plugins:
    with open(p.path, 'rb') as fh:
        for typ, fid, flags, off, size, ctx in p.index:
            if typ != 'MGEF':
                continue
            body = p.data_at(fh, off, size, flags)
            e = edid_of(body) or ''
            if 'sun' not in e.lower():
                continue
            resist = None
            for t, d in subrecords(body):
                if t == b'DATA' and len(d) >= 20:
                    resist = struct.unpack_from('<i', d, 16)[0]
            g = global_of(p, fid)
            if g is not None:
                sun_global[g] = (p.name, e, resist)

print(f'{len(sun_global)} magic effect(s) whose editor id mentions the sun:')
for g, (plug, e, resist) in sorted(sun_global.items(), key=lambda kv: kv[1][1]):
    print(f'  {e:38} {g:08x}  resistAV={resist}  [{plug}]')

# 2. what carries them
print('\nspells, enchantments and scrolls that carry one:')
carriers = []
for p in plugins:
    with open(p.path, 'rb') as fh:
        for typ, fid, flags, off, size, ctx in p.index:
            if typ not in ('SPEL', 'ENCH', 'SCRL'):
                continue
            body = p.data_at(fh, off, size, flags)
            used = []
            for t, d in subrecords(body):
                if t == b'EFID' and len(d) >= 4:
                    g = global_of(p, struct.unpack_from('<I', d, 0)[0])
                    if g in sun_global:
                        used.append(sun_global[g][1])
            if used:
                g = global_of(p, fid)
                carriers.append((typ, edid_of(body) or '', g, sorted(set(used)), p.name))
for typ, e, g, used, plug in sorted(carriers, key=lambda c: (c[0], c[1])):
    print(f'  {typ} {e:38} {g and format(g, "08x")}  <- {", ".join(used)}  [{plug}]')
print(f'\n{len(carriers)} carrier(s)')
