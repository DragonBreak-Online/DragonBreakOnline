import sys, struct, os, json, collections
sys.path.insert(0, os.path.expanduser('~/dragonbreak/ck-mcp'))
from esplib import Plugin, subrecords, edid_of
order=[l.strip() for l in open(os.path.expanduser('~/dragonbreak/fork/deploy/skyrim-data/loadorder.txt')) if l.strip() and not l.startswith('#')]
ench={}; mgef={}; users=collections.defaultdict(list)
def gkey(p,fid):
    top=fid>>24; m=p.masters
    return (m[top] if top<len(m) else p.name_, fid&0xffffff)
for name in order:
    path='/opt/skyrim-data/'+name
    if not os.path.exists(path): continue
    try: p=Plugin(path)
    except Exception as e: print('skip',name,e,file=sys.stderr); continue
    p.name_=name; fh=open(path,'rb')
    for (sig,fid,flags,off,size,ctx) in p.index:
        s=sig.decode() if isinstance(sig,bytes) else sig
        if s not in ('ENCH','MGEF','ARMO','WEAP'): continue
        d=p.data_at(fh,off,size,flags); k=gkey(p,fid); e=edid_of(d) or ''
        if s=='MGEF':
            for t,v in subrecords(d):
                if t==b'DATA' and len(v)>=0x48: mgef[k]={'edid':e,'flags':struct.unpack('<I',v[:4])[0],'arch':struct.unpack('<I',v[0x40:0x44])[0],'av':struct.unpack('<i',v[0x44:0x48])[0]}
        elif s=='ENCH':
            fx=[]; cur=None; enit=None
            for t,v in subrecords(d):
                if t==b'ENIT': enit=v
                if t==b'EFID': cur=gkey(p,struct.unpack('<I',v)[0])
                if t==b'EFIT' and cur: fx.append({'mgef':cur,'mag':round(struct.unpack('<f',v[:4])[0],3),'area':struct.unpack('<I',v[4:8])[0],'dur':struct.unpack('<I',v[8:12])[0]}); cur=None
            ench[k]={'edid':e,'plugin':name,'type':struct.unpack('<I',enit[0x14:0x18])[0] if enit and len(enit)>=0x18 else None,'fx':fx}
        else:
            for t,v in subrecords(d):
                if t==b'EITM': users[gkey(p,struct.unpack('<I',v)[0])].append((s,e,name))
out=[]
for k,v in ench.items():
    fx=[dict(f,mgef_edid=mgef.get(f['mgef'],{}).get('edid','?'),arch=mgef.get(f['mgef'],{}).get('arch'),av=mgef.get(f['mgef'],{}).get('av'),mgef=f'{f["mgef"][1]:06x}:{f["mgef"][0]}') for f in v['fx']]
    u=users.get(k,[])
    out.append({'id':f'{k[1]:06x}:{k[0]}','edid':v['edid'],'winner':v['plugin'],'type':v['type'],'effects':fx,'items':len(u),'itemPlugins':sorted(set(x[2] for x in u)),'sample':[x[1] for x in u[:3]]})
json.dump(out,open('./ench.json','w'),indent=1)
print(len(out),'ENCH;',sum(1 for o in out if o['items']),'used by items')
