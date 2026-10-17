"""Read-only: the ore veins of the Mountainwatch mine, for labour.js oreByRef."""
import sys, os, struct, re
sys.path.insert(0, os.path.expanduser('~/dragonbreak/ck-mcp'))
from esplib import Plugin, subrecords, edid_of
DATA='/opt/skyrim-data'; LO=os.path.expanduser('~/dragonbreak/fork/deploy/skyrim-data/loadorder.txt')
names=[l.strip().lstrip('*') for l in open(LO,encoding='utf-8-sig') if l.strip() and not l.startswith('#')]
# 1. cells whose editor id mentions Mountainwatch
cells={}
for name in names:
    path=os.path.join(DATA,name)
    if not os.path.exists(path): continue
    try: p=Plugin(path)
    except Exception: continue
    with open(path,'rb') as fh:
        for typ,fid,flags,off,size,ctx in p.index:
            if typ!='CELL': continue
            e=edid_of(p.data_at(fh,off,size,flags)) or ''
            if 'mountainwatch' in e.lower():
                key,loc=p.modindex_source(fid)
                cells.setdefault((key,loc),e)
for (k,l),e in sorted(cells.items(), key=lambda kv: kv[1]):
    print(f'CELL {e:<36} {l:06x} of {k}')
print()
# 2. ore veins placed in those cells (REFR whose cell ctx matches, base editor id MineOre*)
targets={l for (k,l) in cells}
basename={}
for name in names:
    path=os.path.join(DATA,name)
    if not os.path.exists(path): continue
    try: p=Plugin(path)
    except Exception: continue
    with open(path,'rb') as fh:
        for typ,fid,flags,off,size,ctx in p.index:
            if typ not in ('ACTI','STAT','MSTT','FURN'): continue
            e=edid_of(p.data_at(fh,off,size,flags)) or ''
            if e.lower().startswith('mineore'):
                key,loc=p.modindex_source(fid); basename[(key,loc)]=e
for name in names:
    path=os.path.join(DATA,name)
    if not os.path.exists(path): continue
    try: p=Plugin(path)
    except Exception: continue
    with open(path,'rb') as fh:
        for typ,fid,flags,off,size,ctx in p.index:
            if typ!='REFR': continue
            w,c,g = ctx if ctx else (0,0,0)
            ckey,cloc=p.modindex_source(c) if c else (None,None)
            if cloc not in targets: continue
            body=p.data_at(fh,off,size,flags); base=None; pos=None
            for t,d in subrecords(body):
                if t==b'NAME' and len(d)>=4: base=struct.unpack_from('<I',d,0)[0]
                if t==b'DATA' and len(d)>=12: pos=struct.unpack_from('<3f',d,0)
            if base is None: continue
            bkey,bloc=p.modindex_source(base)
            bn=basename.get((bkey,bloc))
            if not bn: continue
            rkey,rloc=p.modindex_source(fid)
            print(f"  '{rloc:x}:{(rkey or '?').replace('bsheartland.esm','BSHeartland.esm')}': 'adamantium',   // {bn}, cell {cells[(ckey,cloc)]}, pos {tuple(round(x) for x in (pos or (0,0,0)))} [{name}]")
