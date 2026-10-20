# Writes spell-scrolls.json for scribing.js (Nate + Swag, 17 Oct: Master Scholars write scrolls of the spells they know).
#   sudo python3 -I tools/scribing/spell_scrolls.py /opt/skyrim-data /opt/alduinak/deploy/skyrim-data/loadorder.txt spell-scrolls.json
# Reads the live plugins read-only. A scroll (SCRL) belongs to the spell (SPEL, type 0: a cast spell) whose editor id is the
# scroll's less "Scroll" (FireboltScroll -> Firebolt, the vanilla and Beyond Skyrim convention), else to a spell
# spell-tomes.json teaches that carries every effect of the scroll (effects resolved to global form ids across masters). An
# exact effect list matched only 51 of 120 scrolls: a spell also carries its perk riders (Firebolt has
# PerkImpactStaggerPushFFAimed and PerkIntenseFlames...; FireboltScroll only FireDamageFFAimed), and the thrall scrolls
# cast Ench* effects of their own. Among several, the named one wins, then the one sharing most effects, then the earliest
# record. "match" says which rule picked it: name (and shares an effect), name-only (shares none: the thralls), tome. A
# scroll matched by neither (the Solstheim spider scrolls, the College quest scrolls) is left out. Light plugins (.esl, or
# the ESL flag) are skipped: the server form index counts full plugins only, so nothing in them has a server id. Rank and school come from spell-tomes.json when the
# spell is there, else from the first effect (MGEF DATA magic skill, minimum level; the half-cost perk's editor id first,
# as spells.js rankFrom does). Also lists every scroll with its value (the Apprentice to Expert tomes spend any scroll)
# and every soul gem with its soul, so the filled gem ids in config are checked against the plugins, not guessed.
import struct, zlib, sys, json, os
DATA, ORDER, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
TOMES = sys.argv[4] if len(sys.argv) > 4 else os.path.join(os.path.dirname(os.path.abspath(OUT)), 'spell-tomes.json')
WANT = {b'SPEL', b'SCRL', b'MGEF', b'PERK', b'SLGM'}
RANKS = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']
AV_SCHOOL = {18: 'Alteration', 19: 'Conjuration', 20: 'Destruction', 21: 'Illusion', 22: 'Restoration'}

def fields(buf):
    i = 0
    while i + 6 <= len(buf):
        t = buf[i:i+4]; n = struct.unpack_from('<H', buf, i+4)[0]
        if t == b'XXXX':  # a field longer than 64 KiB: its size comes first
            n = struct.unpack_from('<I', buf, i+6)[0]; t = buf[i+10:i+14]; yield t, buf[i+16:i+16+n]; i += 16+n; continue
        yield t, buf[i+6:i+6+n]; i += 6+n
def header(data):
    size, flags = struct.unpack_from('<II', data, 4)
    masters = [v[:-1].decode('latin1') for k, v in fields(data[24:24+size]) if k == b'MAST']
    return flags, masters, 24 + size
def walk(data, off, end, out):
    while off < end:
        t = data[off:off+4]
        if t == b'GRUP':
            size = struct.unpack_from('<I', data, off+4)[0]; label = data[off+8:off+12]; gtype = struct.unpack_from('<I', data, off+12)[0]
            if gtype != 0 or label in WANT: walk(data, off+24, off+size, out)
            off += size; continue
        size, flags, fid = struct.unpack_from('<III', data, off+4)
        if t in WANT and not flags & 0x20:  # 0x20: deleted
            body = data[off+24:off+24+size]
            if flags & 0x40000: body = zlib.decompress(body[4:])
            out.append((t.decode(), fid, list(fields(body))))
        off += 24 + size

order = [l.strip() for l in open(ORDER, encoding='utf-8-sig') if l.strip() and not l.startswith('#')]
index, names, recs = {}, [], {}  # recs: global id -> (type, plugin, fields); a later plugin overrides
for name in order:
    data = open(os.path.join(DATA, name), 'rb').read()
    flags, masters, start = header(data)
    if flags & 0x200 or name.lower().endswith('.esl'): continue
    index[name.lower()] = len(names); own = len(names); names.append(name)
    def glob(fid, masters=masters, own=own):
        b = fid >> 24
        if b < len(masters):
            i = index.get(masters[b].lower())
            return None if i is None else (i << 24) | (fid & 0xffffff)
        return (own << 24) | (fid & 0xffffff)
    found = []
    walk(data, start, len(data), found)
    for t, fid, f in found:
        g = glob(fid)
        if g is None: continue
        efids = [glob(struct.unpack_from('<I', v)[0]) for k, v in f if k == b'EFID']
        recs[g] = {'type': t, 'f': f, 'efids': efids, 'glob': glob}

def desc(g): return f'{g & 0xffffff:x}:{names[g >> 24]}'
def edid(r): return next((v[:-1].decode('latin1') for k, v in r['f'] if k == b'EDID'), '')
def fld(r, k): return next((v for kk, v in r['f'] if kk == k), b'')
def u32(b, o): return struct.unpack_from('<I', b, o)[0] if len(b) >= o + 4 else 0

def canon_to_desc(c):
    p, h = c.rsplit(':', 1); return f'{int(h, 16):x}:{p}'.lower()
tomes = {}
for t in json.load(open(TOMES))['tomes']:
    tomes.setdefault(canon_to_desc(t['spellId']), t)

def rank_school(g):
    r = recs[g]; spit = fld(r, b'SPIT')
    first = r['efids'][0] if r['efids'] else None
    m = recs.get(first) if first else None
    data = fld(m, b'DATA') if m else b''
    school = AV_SCHOOL.get(u32(data, 0x0c)) if len(data) >= 0x2c else None
    level = u32(data, 0x28) if len(data) >= 0x2c else 0
    perk = recs.get(r['glob'](u32(spit, 0x20))) if u32(spit, 0x20) else None
    pe = edid(perk).lower() if perk else ''
    rank = next((i for i, w in enumerate(RANKS) if w.lower() in pe), None)
    if rank is None: rank = 0 if level < 25 else 1 if level < 50 else 2 if level < 75 else 3 if level < 100 else 4
    return rank, school

spells_by_fx, spells_by_edid = {}, {}
for g, r in recs.items():
    if r['type'] != 'SPEL' or not r['efids'] or None in r['efids']: continue
    spit = fld(r, b'SPIT')
    if len(spit) < 36 or u32(spit, 8) != 0: continue  # type 0: a spell (not an ability, power, disease, ...)
    for e in set(r['efids']): spells_by_fx.setdefault(e, set()).add(g)
    spells_by_edid.setdefault(edid(r).lower(), g)

scrolls, by_spell, unmatched, ambiguous = [], {}, [], 0
for g, r in sorted(recs.items()):
    if r['type'] != 'SCRL': continue
    data = fld(r, b'DATA')
    scrolls.append({'id': desc(g), 'edid': edid(r), 'value': u32(data, 0)})
    fx = set(e for e in r['efids'] if e is not None)
    named = spells_by_edid.get(edid(r).lower().replace('scroll', ''))
    cands = set().union(*[spells_by_fx.get(e, set()) for e in fx]) if fx else set()
    tome_ok = [s for s in cands if desc(s).lower() in tomes and fx <= set(recs[s]['efids'])]
    if named is not None: sp, how = named, ('name' if fx & set(recs[named]['efids']) else 'name-only')
    elif tome_ok:
        tome_ok.sort(key=lambda s: (-len(fx & set(recs[s]['efids'])), s))
        if len(tome_ok) > 1: ambiguous += 1
        sp, how = tome_ok[0], 'tome'
    else: unmatched.append(edid(r)); continue
    sd = desc(sp)
    t = tomes.get(sd.lower())
    rank, school = (int(t['rank']), t['school']) if t else rank_school(sp)
    entry = by_spell.get(sd)
    # One scroll per spell: the cheaper-named match (edid match first) is kept, the rest listed as alternates
    if entry: entry['alsoScrolls'].append(desc(g)); continue
    by_spell[sd] = {'spellId': sd, 'spell': edid(recs[sp]), 'name': (t or {}).get('spellName') or '', 'scrollId': desc(g), 'scroll': edid(r),
                    'rank': rank, 'school': school, 'tome': bool(t), 'match': how, 'alsoScrolls': []}

gems = []
for g, r in sorted(recs.items()):
    if r['type'] != 'SLGM': continue
    soul = fld(r, b'SOUL'); cap = fld(r, b'SLCP'); link = u32(fld(r, b'NAM0'), 0)
    gems.append({'id': desc(g), 'edid': edid(r), 'soul': soul[0] if soul else 0, 'capacity': cap[0] if cap else 0,
                 'filledBase': desc(r['glob'](link)) if link and r['glob'](link) is not None else ''})

out = {'_comment': 'Scrolls by the spell they cast, from the live plugins (tools/scribing/spell_scrolls.py; scribing.js). '
       'spells: one entry per spell with a scroll (rank 0-4 Novice..Master, school). scrolls: every scroll in the full plugins, '
       'with its value. soulGems: every soul gem with the soul it holds (1 Petty .. 5 Grand; a black gem holds 5 as a Grand) '
       'and the base it fills into (NAM0). Rerun after a plugin that adds scrolls or spells.',
       'spells': sorted(by_spell.values(), key=lambda e: (e['school'] or '', e['rank'], e['spell'])),
       'scrolls': scrolls, 'soulGems': gems}
json.dump(out, open(OUT, 'w'), indent=1)
from collections import Counter
print(len(scrolls), 'scrolls;', len(by_spell), 'spells with a scroll;', len(unmatched), 'scrolls match no spell;', ambiguous, 'matched by tome with several candidates')
print('by rank:', dict(sorted(Counter(e['rank'] for e in by_spell.values()).items())), 'with a tome:', sum(e['tome'] for e in by_spell.values()))
print('by rule:', dict(Counter(e['match'] for e in by_spell.values())))
print('unmatched:', ', '.join(unmatched[:40]))
