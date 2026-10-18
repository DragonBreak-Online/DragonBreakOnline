# Recipes for faction gear (faction-gear.json) that carry quest conditions the multiplayer game never meets
import sys,os,struct,json,csv,collections
sys.path.insert(0,os.path.expanduser('~/dragonbreak/ck-mcp'))
from esplib import Plugin, edid_of, subrecords
ORDER='/opt/alduinak/deploy/skyrim-data/loadorder.txt'
FG=sys.argv[1]; OUT=sys.argv[2]
order=[l.strip() for l in open(ORDER) if l.strip() and not l.startswith('#')]
FUNCS={58:'GetStage',59:'GetStageDone',543:'GetQuestCompleted',56:'GetQuestRunning'}
fg={k.lower():v for k,v in json.load(open(FG))['items'].items()}
qn={}; P={}
for n in order:
    pth='/opt/skyrim-data/'+n
    if not os.path.exists(pth): continue
    try: p=Plugin(pth)
    except Exception: continue
    P[n]=p; fh=open(pth,'rb')
    for (s,f,fl,o,z,c) in p.index:
        if (s.decode() if isinstance(s,bytes) else s)=='QUST':
            t=f>>24; qn[((p.masters[t] if t<len(p.masters) else n),f&0xffffff)]=edid_of(p.data_at(fh,o,z,fl))
win={}
for n,p in P.items():
    fh=open(p.path,'rb')
    for (s,f,fl,o,z,c) in p.index:
        if (s.decode() if isinstance(s,bytes) else s)!='COBJ': continue
        t=f>>24; key=((p.masters[t] if t<len(p.masters) else n),f&0xffffff)
        d=p.data_at(fh,o,z,fl); conds=[]; item=None
        for tt,v in subrecords(d):
            if tt==b'CNAM': b=struct.unpack('<I',v)[0]; tb=b>>24; item=((p.masters[tb] if tb<len(p.masters) else n),b&0xffffff)
            if tt==b'CTDA' and len(v)>=24:
                func=struct.unpack('<H',v[8:10])[0]
                if func in FUNCS:
                    p1=struct.unpack('<I',v[12:16])[0]; tp=p1>>24; q=((p.masters[tp] if tp<len(p.masters) else n),p1&0xffffff)
                    conds.append(f"{FUNCS[func]}({qn.get(q,hex(p1))}{','+str(struct.unpack('<I',v[16:20])[0]) if func in (58,59) else ''})")
        win[key]=(n,edid_of(d) or '',item,conds)
rows=[]
BASE={'Skyrim.esm','Update.esm','Dawnguard.esm','HearthFires.esm','Dragonborn.esm'}
for k,(n,e,item,conds) in win.items():
    if not conds or not item: continue
    ik=f'{item[1]:x}:{item[0]}'.lower()
    if ik not in fg: continue
    src=k[0]
    edit='DragonBreak Online Edits.esp (override)' if src in BASE else (f'{n} (in place)' if n.startswith('DragonBreak') else 'DragonBreak Nexus Patches.esp (override)')
    rows.append({'recipe':f'{k[1]:x}:{k[0]}','recipe_edid':e,'winner':n,'item':fg[ik]['name'],'item_id':ik,'factions':' '.join(fg[ik]['factions']),'conditions':'; '.join(conds),'edit_in':edit})
rows.sort(key=lambda r:(r['factions'],r['item']))
with open(OUT,'w',newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
print(len(rows),'recipes'); print(collections.Counter(r['factions'].split()[0] for r in rows).most_common()); print(collections.Counter(c.split('(')[1].split(',')[0].rstrip(')') for r in rows for c in r['conditions'].split('; ')).most_common(20))
