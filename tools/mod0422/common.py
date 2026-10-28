# Shared loaders for the mod-0422 restore plan (read-only on evidence and live state).
import json, os, collections
M = '/root/dragonbreak-jake/mod0422'
LIVE_CF = '/opt/skymp-state/world/changeForms'
LO = json.load(open(os.path.join(M, 'items', 'loadorder.json')))
def desc(i):
    i &= 0xffffffff; hi = i >> 24
    if hi == 0xfe: return '%x:%s' % (i & 0xfff, LO['light'][(i >> 12) & 0xfff])
    if hi == 0xff: return 'ff%06x:(runtime)' % (i & 0xffffff)
    return '%x:%s' % (i & 0xffffff, LO['full'][hi])
FULL = {n.lower(): k for k, n in enumerate(LO['full'])}
LIGHT = {n.lower(): k for k, n in enumerate(LO['light'])}
def id_of(d):
    loc, plug = d.split(':', 1); loc = int(loc, 16); p = plug.lower()
    if p in FULL: return (FULL[p] << 24) | (loc & 0xffffff)
    if p in LIGHT: return 0xfe000000 | (LIGHT[p] << 12) | (loc & 0xfff)
    raise KeyError(d)
def desc_old21(i):
    # the 21 Oct 00:01 backup predates the 21 Oct 03:28 load-order change (one plugin inserted at 0x48): old 0x48+ = now +1
    i &= 0xffffffff; hi = i >> 24
    if 0x48 <= hi < 0xfe: return '%x:%s' % (i & 0xffffff, LO['full'][hi + 1])
    return desc(i)
def entries(path):
    o = json.load(open(path))
    return [dict(e) for e in ((o.get('inv') or {}).get('entries') or [])]
def snap(name, ref):
    return entries(os.path.join(M, 'items', 'extract', name, 'state__world__changeForms__%s_BSHeartland.esm.json' % ref))
def c24(ref):
    return entries(os.path.join(M, 'skeptic', 'c24', 'state', 'world', 'changeForms', '%s_BSHeartland.esm.json' % ref))
def live(ref):
    return entries(os.path.join(LIVE_CF, '%s_BSHeartland.esm.json' % ref))
EXTRA_SKIP = ('baseId', 'count', 'worn', 'wornLeft')
def extras(e):
    return {k: v for k, v in e.items() if k not in EXTRA_SKIP and v is not None}
def sig(e):
    # exact signature of an entry with extra data (floats rounded to 4 places to survive JSON round trips)
    def r(v):
        if isinstance(v, float): return round(v, 4)
        if isinstance(v, list): return [r(x) for x in v]
        if isinstance(v, dict): return {k: r(x) for k, x in sorted(v.items())}
        return v
    return json.dumps({'baseId': e['baseId'] & 0xffffffff, **r(extras(e))}, sort_keys=True)
def plain(e):
    return not extras(e)
def counts(es, only_plain=False):
    c = collections.Counter()
    for e in es:
        if only_plain and not plain(e): continue
        c[e['baseId'] & 0xffffffff] += int(e['count'])
    return c
def events(path):
    for l in open(path):
        try: yield json.loads(l)
        except Exception: continue
