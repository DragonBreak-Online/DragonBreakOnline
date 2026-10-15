"""Creator data (skymp5-front charCreator/data) for the DLE's own races, read from the plugins (claude-nate, 15 Oct).

    python3 -I creator_races.py <data dir> <new plugins dir> <vanilla data dir> [--write]
(<new plugins dir> is read first: the release's changed plugins; the rest come from <vanilla data dir>, e.g. /opt/skyrim-data)

tints.json: each race's tint layers straight from its RACE record (per sex: TINT file, TINP type, the TINC colour forms'
CNAM bytes as presets, in record order). Checked first by rebuilding BretonRace and HighElfRace from the same records and
comparing them with what tints.json already holds.
headparts.json: a vanilla part (Skyrim.esm and the DLCs: the only ids the front can name, its ids are numeric) is valid for
a new race when the part's valid-race FormList (RNAM, winning override among the base masters, USSEP, the DLE and Nexus
Patches) lists that race, exactly as the engine's RaceMenu decides. raceDefaults: the RACE record's own HEAD parts when every
one is a vanilla id, otherwise left to the race's fallback.
The DLE's own head parts (Lost Races' DBO_LR_*) cannot be named in this numeric data; they are listed in the report.
"""
import sys, os, json, struct
# esplib.py from ck-mcp (CKMCP, default the server session's copy; on the PC E:\DragonBreak Online Dev files\ck-mcp)
sys.path.insert(0, os.environ.get('CKMCP', '/home/nate/dragonbreak/ck-mcp'))
import esplib

DATA, NEW, VAN = sys.argv[1], sys.argv[2], sys.argv[3]
WRITE = '--write' in sys.argv
DLE, NXP = 'dragonbreak online edits.esp', 'dragonbreak nexus patches.esp'
# the plugins whose HDPT / FLST / CLFM records are read, in load order (later wins)
ORDER = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'unofficial skyrim special edition patch.esp',
         'BSAssets.esm', 'DragonBreak Online Edits.esp', 'DragonBreak Nexus Patches.esp']
# the front's ids: Skyrim.esm 0x00, Dawnguard 0x02, HearthFires 0x03, Dragonborn 0x04 (races.js RIEKLING = 0x04017f44)
FRONT_INDEX = {'skyrim.esm': 0, 'update.esm': 1, 'dawnguard.esm': 2, 'hearthfires.esm': 3, 'dragonborn.esm': 4}
HDPT_KIND = {0: 'misc', 1: 'face', 2: 'eyes', 3: 'hair', 4: 'facialHair', 5: 'scars', 6: 'brows'}
DEFAULT_SLOT = {0: 'mouth', 1: 'head', 2: 'eyes', 3: 'hair', 6: 'brows'}

def path_of(name):
    for d in (NEW, VAN):
        p = os.path.join(d, name)
        if os.path.exists(p): return p
    raise FileNotFoundError(name)

recs = {}      # (plugin key, local id) -> (type, plugin, data) of the winning record
races = {}     # race edid -> (key, data) for the races we need
plugins = {}
for name in ORDER:
    p = esplib.Plugin(path_of(name)); plugins[p.key] = p
    fh = open(p.path, 'rb')
    for (t, fid, fl, off, sz, ctx) in p.index:
        if t not in ('HDPT', 'FLST', 'CLFM', 'RACE'): continue
        src, loc = p.modindex_source(fid)
        if src is None: continue
        d = p.data_at(fh, off, sz, fl)
        recs[(src, loc)] = (t, p, d)
    fh.close()
    print('read', name, len(p.index), 'records', file=sys.stderr)

def ref(p, raw):
    src, loc = p.modindex_source(raw); return (src, loc)
def edid(k):
    r = recs.get(k); return esplib.edid_of(r[2]) if r else None
def front_id(k):
    src, loc = k
    return (FRONT_INDEX[src] << 24 | loc) if src in FRONT_INDEX else None

def colour(k):
    r = recs.get(k)
    if not r or r[0] != 'CLFM': return None
    for s, v in esplib.subrecords(r[2]):
        if s == b'CNAM': return [v[0], v[1], v[2]]
    return None

def race_key(ed):
    for k, (t, p, d) in recs.items():
        if t == 'RACE' and esplib.edid_of(d) == ed: return k
    raise KeyError(ed)

def head_data(k):
    t, p, d = recs[k]
    out = {'male': {'heads': [], 'tints': []}, 'female': {'heads': [], 'tints': []}}
    sex = None; started = False; cur = None
    for s, v in esplib.subrecords(d):
        s = s.decode('ascii', 'replace')
        if s == 'NAM0': started = True; continue
        if not started: continue
        if s == 'MNAM': sex = 'male'; continue
        if s == 'FNAM': sex = 'female'; continue
        if s in ('NAM8', 'RNAM'): break
        if not sex: continue
        if s == 'HEAD': out[sex]['heads'].append(ref(p, struct.unpack('<I', v)[0]))
        elif s == 'TINI': cur = {'file': None, 'type': None, 'presets': []}; out[sex]['tints'].append(cur)
        elif s == 'TINT' and cur is not None: cur['file'] = v.rstrip(b'\0').decode('cp1252')
        elif s == 'TINP' and cur is not None: cur['type'] = struct.unpack('<H', v)[0]
        elif s == 'TINC' and cur is not None:
            c = colour(ref(p, struct.unpack('<I', v)[0]))
            if c is not None: cur['presets'].append(c)
    return out

def tints_of(k):
    h = head_data(k)
    return {sex: [{'file': l['file'], 'type': l['type'], 'presets': l['presets']} for l in h[sex]['tints']] for sex in ('male', 'female')}

tp, hp = os.path.join(DATA, 'tints.json'), os.path.join(DATA, 'headparts.json')
T = json.load(open(tp, encoding='utf-8')); H = json.load(open(hp, encoding='utf-8'))
assert json.dumps(T, separators=(',', ':'), ensure_ascii=False) == open(tp, encoding='utf-8').read().strip()
assert json.dumps(H, separators=(',', ':'), ensure_ascii=False) == open(hp, encoding='utf-8').read().strip()

report = []
# 1. the method, proved on two races the front already has
for ed in ('BretonRace', 'HighElfRace', 'NordRace'):
    got = tints_of(race_key(ed)); want = T[ed]
    same = got == want
    report.append(f'check: {ed} tints rebuilt from the records {"MATCH" if same else "DIFFER"} tints.json')
    if not same:
        for sex in ('male', 'female'):
            a, b = got[sex], want[sex]
            report.append(f'  {sex}: {len(a)} layers rebuilt, {len(b)} in tints.json')
            for i, (x, y) in enumerate(zip(a, b)):
                if x != y: report.append(f'    layer {i} {x["file"].split(chr(92))[-1]}: type {x["type"]}/{y["type"]} presets {len(x["presets"])}/{len(y["presets"])}' + ('' if x['presets'] == y['presets'] else ' (colours differ)'))

# 2. the head parts' valid-race lists
def flst_members(k):
    r = recs.get(k)
    if not r or r[0] != 'FLST': return set()
    t, p, d = r
    return {ref(p, struct.unpack('<I', v)[0]) for s, v in esplib.subrecords(d) if s == b'LNAM'}
def part_info(k):
    r = recs.get(k)
    if not r or r[0] != 'HDPT': return None
    t, p, d = r; ptype = None; flags = 0; rnam = None
    for s, v in esplib.subrecords(d):
        if s == b'PNAM': ptype = struct.unpack('<I', v)[0]
        elif s == b'DATA': flags = v[0]
        elif s == b'RNAM': rnam = ref(p, struct.unpack('<I', v)[0])
    return {'type': ptype, 'flags': flags, 'rnam': rnam, 'edid': esplib.edid_of(d)}

NEW_RACES = {'DBOSnowElfRace': (DLE, 0x1ac9ff), 'MaormerRace': (DLE, 0x192ede), 'DBOReachmanRace': (DLE, 0x1c8981)}
front_parts = {p['id']: p for p in H['parts']}
gave = {r: 0 for r in NEW_RACES}; took = {r: 0 for r in NEW_RACES}
for pid, part in front_parts.items():
    k = (next(n for n, i in FRONT_INDEX.items() if i == pid >> 24), pid & 0xffffff)
    info = part_info(k)
    members = flst_members(info['rnam']) if info and info['rnam'] else set()
    for r, rk in NEW_RACES.items():
        valid = rk in members
        if valid and r not in part['races']: part['races'].append(r); part['races'].sort(); gave[r] += 1
        if not valid and r in part['races']: part['races'].remove(r); took[r] += 1
# The Reachman is in no head-part list yet (the PC adds it where BretonRace stands; until then RaceMenu offers it nothing).
# The front applies parts without the engine's list check, so it is given the Breton's parts now, as the fix will make them
MIRROR = {'DBOReachmanRace': 'BretonRace'}
for r, like in MIRROR.items():
    if sum(1 for p in H['parts'] if r in p['races']) == 0:
        for p in H['parts']:
            if like in p['races'] and r not in p['races']: p['races'].append(r); p['races'].sort(); gave[r] += 1
        report.append(f'headparts: {r} is in no valid-race list in the DLE: given every {like} part (the PC fix to come)')
for r in NEW_RACES:
    n = sum(1 for p in H['parts'] if r in p['races'])
    report.append(f'headparts: {r} valid for {n} vanilla parts (added {gave[r]}, removed {took[r]})')

# the DLE's own playable parts the numeric data cannot carry
own = {}
for (src, loc), (t, p, d) in recs.items():
    if t != 'HDPT' or src != DLE: continue
    info = part_info((src, loc))
    if not info or not (info['flags'] & 1): continue
    rs = sorted(edid(m) or f'{m[1]:06x}' for m in flst_members(info['rnam'])) if info['rnam'] else []
    for r in NEW_RACES:
        if r in rs: own.setdefault(r, []).append(f'{loc:06x}:DragonBreak Online Edits.esp {info["edid"]} ({HDPT_KIND.get(info["type"], info["type"])}, {"m" if info["flags"] & 2 else ""}{"f" if info["flags"] & 4 else ""})')
for r in NEW_RACES:
    report.append(f'DLE-own playable parts for {r}: {len(own.get(r, []))} (not representable by numeric id)')
    for line in own.get(r, []): report.append('  ' + line)

# 3. tints and raceDefaults for the new races, from their own records
# Skin tone presets the front cannot express: Lost Races' Snow Elf skin is five WHITE colour forms told apart only by their
# intensity (TINV 1.0, 0.75, 0.5, 0.25, 0), and the front sends every skin preset at full strength. Each is blended here from
# white toward the palest skin the PC chose for the Snow Elf on 13 Oct (196,204,214, Nat-reviewed) by that intensity
def tinv_presets(k):
    t, p, d = recs[k]; started = False; out = {'male': [], 'female': []}; sex = None; skin = False; cur = None
    for s, v in esplib.subrecords(d):
        if s == b'NAM0': started = True; continue
        if not started: continue
        if s == b'MNAM': sex = 'male'; continue
        if s == b'FNAM': sex = 'female'; continue
        if s in (b'NAM8', b'RNAM'): break
        if s == b'TINP': skin = struct.unpack('<H', v)[0] == 6
        elif skin and s == b'TINC': cur = colour(ref(p, struct.unpack('<I', v)[0]))
        elif skin and s == b'TINV' and cur is not None: out[sex].append((cur, struct.unpack('<f', v)[0])); cur = None
    return out
PALE = [196, 204, 214]
for r, rk in NEW_RACES.items():
    T[r] = tints_of(rk)
    tv = tinv_presets(rk)
    for sex in ('male', 'female'):
        cols = [c for c, _ in tv[sex]]
        if len(cols) > 1 and all(c == cols[0] for c in cols):
            blended = [[round(c[i] * w + PALE[i] * (1 - w)) for i in range(3)] for c, w in tv[sex]]
            for l in T[r][sex]:
                if l['type'] == 6: l['presets'] = blended
            report.append(f'tints: {r} {sex} skin presets are one colour at {[round(w, 2) for _, w in tv[sex]]} intensity: blended toward {PALE} -> {blended}')
    paints = {sex: [l['file'].split('\\')[-1] for l in T[r][sex] if l['type'] == 7] for sex in ('male', 'female')}
    forsworn = {sex: [f for f in paints[sex] if 'Forsworn' in f] for sex in paints}
    skin = {sex: next((l['presets'] for l in T[r][sex] if l['type'] == 6), []) for sex in ('male', 'female')}
    report.append(f'tints: {r} male {len(T[r]["male"])} layers ({len(paints["male"])} war paints, Forsworn {forsworn["male"]}), female {len(T[r]["female"])} layers ({len(paints["female"])} war paints, Forsworn {forsworn["female"]}); skin presets m{skin["male"]} f{skin["female"]}')
    hd = head_data(rk); dflt = {}; ok = True
    for sex in ('male', 'female'):
        slots = {}
        for hk in hd[sex]['heads']:
            info = part_info(hk); fid = front_id(hk)
            if fid is None or not info: ok = False; continue
            slot = DEFAULT_SLOT.get(info['type'])
            if slot and slot not in slots: slots[slot] = fid
        dflt[sex] = slots
    if ok and all(len(dflt[s]) >= 4 for s in dflt):
        H['raceDefaults'][r] = dflt; report.append(f'raceDefaults: {r} from its own HEAD parts {dflt}')
    elif r not in H['raceDefaults'] and r == 'DBOSnowElfRace':
        H['raceDefaults'][r] = json.loads(json.dumps(H['raceDefaults']['HighElfRace']))
        report.append(f'raceDefaults: {r} has DLE-own default heads (Lost Races); given the High Elf defaults, as the PC did on 13 Oct')
    else:
        report.append(f'raceDefaults: {r} has DLE-own default heads; left to its fallback ({"kept " + json.dumps(H["raceDefaults"].get(r)) if r in H["raceDefaults"] else "none"})')

print('\n'.join(report))
if WRITE:
    open(tp, 'w', encoding='utf-8', newline='').write(json.dumps(T, separators=(',', ':'), ensure_ascii=False))
    open(hp, 'w', encoding='utf-8', newline='').write(json.dumps(H, separators=(',', ':'), ensure_ascii=False))
    print('written', tp, hp)
