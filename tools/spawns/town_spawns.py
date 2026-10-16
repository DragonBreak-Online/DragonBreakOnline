#!/usr/bin/env python3
"""Town spawns: the people and tame animals of open Skyrim, spawned by the server (Nate, 16 Oct: "the npcs in skyrim needs
to work like how bruma is"). NPC pass 2 (tools/skyrim_actor_all.py, tooling/xedit-scripts/DBO_SkyrimActorsList2.txt)
disables every living plugin actor still enabled in open Skyrim; this turns the guards, townsfolk, merchants, children,
friendly NPCs and tame animals among them into server spawns of their own base, at their own spot and heading, as
owned_spawns.py does for the creatures our plugins place. townspawns.js turns each into a town:<kind>:<local id>-<plugin>
zone for NpcSpawnSystem, only once that ref is disabled in the plugins the server loaded (so never beside the plugin's own
copy), and only for the holds switched on in gamemode-config.json "townSpawns".

    python3 tools/spawns/town_spawns.py <list 2> [--data /opt/skyrim-data] [--order <loadorder.txt>]
        [--replace "<plugin>=<path>"] [--out town-spawns.json] [--check N --check-out <json>]

Left out (each counted under skipped): rows a dungeon lease, wildlife.json or Blackreach already spawns ("dungeons.json
spot", "wildlife.json src", "blackreach.json"), the hostile decision keeps (kept-decision, other), Starts Dead, deleted,
display stands and markers (Manakin, Invisible, Default races), creatures that are not tame animals, and anything within
LANDING_CLEAR units of a hold-gate landing spot, the creator landing, the Pale Pass arrival or a respawn temple spot.

A leveled actor (its base templates down to a LVLN) is resolved to one concrete NPC_ per spot, picked by the spot's own
id, so every client builds the same person. factions are the placed base's own (through its Use Factions template chain,
or the picked NPC's when the chain ends in a leveled list) without crime and service factions (STRIP_FACTION):
townspawns.js writes them into ff_factions with no crime faction, so a guard is ambience, not law (law is players' work, as
in Bruma), and a merchant offers no barter (the server runs none; trade is player to player).

Every spot is checked against the navmesh of its own cell (and the eight around it outdoors): one more than NAV_REACH
units over or under the nearest triangle under it has no floor and is left out (noNavmesh). Outdoors, a spot whose feet,
waist and head are all inside one object's box (OBND, as tools/skyrim_release_scan.py) is left out too (insideGeometry).

--check N: prints N kept spots spread over the holds and kinds with their height over the navmesh (the spot check).
Plugins are read in place; nothing is written but --out and --check-out.
"""
import argparse
import collections
import hashlib
import json
import math
import os
import re
import struct
import sys

sys.path.insert(0, os.path.expanduser('~nate/dragonbreak/ck-mcp'))
import esplib  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SRV = os.path.dirname(os.path.dirname(HERE))
DISABLED, STARTS_DEAD, DELETED = 0x800, 0x200, 0x20
OWNED = {n.lower() for n in ['DragonBreak.esp', 'DragonBreak Built.esp', 'DragonBreak Dungeons.esp', 'DragonBreak Harvest.esp',
         'DragonBreak Hub.esp', 'DragonBreak Whiterun.esp', 'DragonBreak Online Edits.esp', 'LostArk_Kamen.esp',
         '[Kirax] Lost Ark Reborn Paladin Legendary.esp', 'DragonBreak Nexus Patches.esp']}
# Anchor base types (owned_spawns.py, ck-mcp/wildlife.py): a loadable reference the server keeps, not a static
OK_TYPES = {'FURN', 'ACTI', 'DOOR', 'CONT', 'WEAP', 'ARMO', 'MISC', 'INGR', 'ALCH', 'BOOK', 'AMMO', 'KEYM', 'SLGM', 'SCRL', 'LIGH'}
KEEP_TYPES = {'NPC_', 'LVLN', 'RACE', 'KYWD', 'CELL', 'LCTN', 'FACT', 'WRLD', 'STAT', 'SCOL', 'MSTT', 'FURN', 'CONT', 'ACTI', 'TREE',
              'DOOR', 'FLOR', 'MISC', 'LIGH'}
# The nine holds as zones.json names them, by their vanilla hold location
HOLD_OF_LCTN = {'WhiterunHoldLocation': 'whiterun', 'RiftHoldLocation': 'riften', 'HaafingarHoldLocation': 'solitude',
                'EastmarchHoldLocation': 'windhelm', 'ReachHoldLocation': 'markarth', 'FalkreathHoldLocation': 'falkreath',
                'HjaalmarchHoldLocation': 'morthal', 'PaleHoldLocation': 'dawnstar', 'WinterholdHoldLocation': 'winterhold'}
# A city worldspace belongs to its hold whatever its cells say
HOLD_OF_WORLD = {'WhiterunWorld': 'whiterun', 'RiftenWorld': 'riften', 'SolitudeWorld': 'solitude', 'WindhelmWorld': 'windhelm',
                 'MarkarthWorld': 'markarth'}
# Tame animals kept as town ambience (Bruma's wildlife has chickens, cows, dogs); horses are their own kind (off by default)
TAME_RACE = re.compile(r'^(Chicken|Cow|Goat|Dog|DogCompanion|DLC1Husky\w*|Deer|DLC1DeerGlow|Hare|Fox|Elk)Race$', re.I)
HORSE_RACE = re.compile(r'^(Horse|CartHorse)Race$', re.I)
NOT_ACTOR_RACE = re.compile(r'Manakin|Invisible|^DefaultRace$', re.I)
# Left out of ff_factions: crime factions (a guard is ambience, not law: law is players' work, as in Bruma) and the service
# factions that offer barter, training, following or marriage, none of which the server runs (trade is player to player)
STRIP_FACTION = re.compile(r'^Crime|IsGuard|Services|Vendor|JobMerchant|Merchant|Trainer|PotentialFollower|CurrentFollower|'
                           r'PotentialMarriage|PlayerHousecarl|PlayerFaction|DismissedFollower|Hireling|Steward(?!s)|Housecarl', re.I)
LANDING_CLEAR = 512
# A spot this far above or below the nearest navmesh triangle under it has no floor the actor can stand and path on
NAV_REACH = 128
TAM = ('skyrim.esm', 0x3C)


def subs(data):
    return list(esplib.subrecords(data))


def first(s):
    o = {}
    for k, v in s:
        o.setdefault(k, v)
    return o


class LoadOrder:
    """Every plugin indexed once; the winning record of each kept type, the wanted ACHRs, and the REFRs and NAVMs by place"""
    def __init__(self, data_dir, order_file, replace, wanted):
        names = [l.strip().lstrip('*') for l in open(order_file, encoding='utf-8-sig') if l.strip() and not l.startswith('#')]
        self.plugins, self.proper = [], {}
        for n in names:
            path = replace.get(n.lower()) or os.path.join(data_dir, n)
            if not os.path.exists(path):
                continue
            p = esplib.Plugin(path)
            p.key = n.lower()
            p.srcpath = path
            p.fh = open(path, 'rb')
            self.plugins.append(p)
            self.proper[n.lower()] = n
        self.types, self.win, self.achr, self.parents = {}, {}, {}, {}
        self.refrs = {}    # key -> (plugin, off, size, flags, ctx), winning REFR
        self.navms = {}    # key -> (plugin, off, size, flags, ctx), winning NAVM
        for p in self.plugins:
            for t, fid, fl, off, sz, ctx in p.index:
                k = self.source(p, fid)
                if k is None:
                    continue
                if t == 'ACHR':
                    if k in wanted:
                        self.achr[k] = (p, off, sz, fl, ctx)
                    else:
                        self.parents[k] = (p, off, sz, fl, ctx)   # an enable parent can be an actor
                    continue
                if t == 'REFR':
                    self.refrs[k] = (p, off, sz, fl, ctx)
                    continue
                if t == 'NAVM':
                    self.navms[k] = (p, off, sz, fl, ctx)
                    continue
                if t in ('GRUP', 'LAND', 'PGRE', 'PHZD', 'INFO', 'DIAL'):
                    continue
                self.types[k] = t
                if t in KEEP_TYPES:
                    self.win[k] = (p, t, off, sz, fl, ctx)
        self._data = {}

    def source(self, p, fid):
        src, loc = p.modindex_source(fid)
        return None if src is None else (src.lower(), loc & 0xFFFFFF)

    def ref(self, p, raw):
        return self.source(p, struct.unpack('<I', raw[:4])[0]) if len(raw) >= 4 else None

    def desc(self, k):
        return '%x:%s' % (k[1], self.proper.get(k[0], k[0]))

    def data(self, k):
        if k in self._data:
            return self._data[k]
        w = self.win.get(k)
        s = subs(w[0].data_at(w[0].fh, w[2], w[3], w[4])) if w else None
        if len(self._data) < 200000:
            self._data[k] = s
        return s

    def edid(self, k):
        s = self.data(k) if k else None
        return (first(s).get(b'EDID', b'') if s else b'').rstrip(b'\0').decode('cp1252', 'replace')

    def where(self, p, ctx):
        """(world key or None, cell key or None)"""
        w, c, g = ctx if ctx else (0, 0, 0)
        return (self.source(p, w) if w else None, self.source(p, c) if c else None)


def parse_list(path):
    rows = {}
    for line in open(path, encoding='utf-8'):
        f = line.rstrip('\n').split('|')
        if len(f) < 6 or f[0] != 'disable':
            continue
        k = (f[1].lower(), int(f[2], 16))
        reason, _, note = f[5].partition(':')
        rows[k] = {'plugin': f[1], 'baseEdid': f[3], 'reason': reason.strip(), 'note': note.strip()}
    return rows


def spots_from_gamemode(srv):
    """The hold-gate landing spots, respawn temples and arrivals players appear at: (world desc lower, x, y)"""
    out = []
    try:
        gm = open(os.path.join(srv, 'gamemode.js'), encoding='utf-8').read()
    except OSError:
        return out
    m = re.search(r'const GATE_DEFAULTS = \{(.*?)\n\};', gm, re.S)
    if m:
        for x, y, z in re.findall(r'\[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\]', m.group(1)):
            out.append(('3c:skyrim.esm', float(x), float(y), 'gate'))
    m = re.search(r'const TEMPLE_DEFAULTS = \{(.*?)\n\};', gm, re.S)
    if m:
        for w, x, y in re.findall(r"world: '([^']+)', pos: \[(-?[\d.]+), (-?[\d.]+),", m.group(1)):
            out.append((w.lower(), float(x), float(y), 'temple'))
    try:
        cfg = json.load(open(os.path.join(srv, 'gamemode-config.json'), encoding='utf-8'))
    except (OSError, ValueError):
        cfg = {}
    for g in (cfg.get('hubGates') or {}).values():
        if isinstance(g, dict):
            for q in g.get('spots') or []:
                out.append(('3c:skyrim.esm', float(q[0]), float(q[1]), 'gate'))
    for t in (cfg.get('respawnTemples') or {}).values():
        if isinstance(t, dict) and t.get('world') and t.get('pos'):
            out.append((str(t['world']).lower(), float(t['pos'][0]), float(t['pos'][1]), 'temple'))
    for t in (cfg.get('landing'), (cfg.get('playtest') or {}).get('arrival')):
        if isinstance(t, dict) and t.get('world') and t.get('pos'):
            out.append((str(t['world']).lower(), float(t['pos'][0]), float(t['pos'][1]), 'arrival'))
    return out


def pick_by_id(src, options):
    """One option per spot, fixed by the spot's own id"""
    if not options:
        return None
    h = int(hashlib.sha1(src.encode()).hexdigest()[:8], 16)
    return options[h % len(options)][1]


def build(lo, rows, landings):
    def npc_info(k):
        s = lo.data(k)
        if not s:
            return None
        d = first(s)
        acbs = d.get(b'ACBS', b'')
        p = lo.win[k][0]
        return {'edid': d.get(b'EDID', b'').rstrip(b'\0').decode('cp1252', 'replace'),
                'level': 0 if (len(acbs) >= 4 and struct.unpack('<I', acbs[:4])[0] & 0x80) else (struct.unpack('<H', acbs[8:10])[0] if len(acbs) >= 10 else 1),
                'tflags': struct.unpack('<H', acbs[18:20])[0] if len(acbs) >= 20 else 0,
                'tplt': lo.ref(p, d.get(b'TPLT', b'')), 'race': lo.ref(p, d.get(b'RNAM', b'')),
                'factions': [(lo.ref(p, v[:4]), struct.unpack('<b', v[4:5])[0]) for sig, v in s if sig == b'SNAM' and len(v) >= 5]}

    def lvln_entries(k):
        p = lo.win[k][0]
        out = []
        for sig, v in lo.data(k) or []:
            if sig == b'LVLO' and len(v) >= 8:
                lvl, _, r = struct.unpack('<HHI', bytes(v[:8]))
                rk = lo.source(p, r)
                if rk:
                    out.append((lvl, rk))
        return out

    def resolve(k, depth=0):
        """[(level, concrete NPC_)] as owned_spawns.py resolve()"""
        if depth > 8:
            return []
        t = lo.types.get(k)
        if t == 'NPC_':
            n = npc_info(k)
            if not n:
                return []
            if n['tplt'] and lo.types.get(n['tplt']) == 'LVLN':
                return resolve(n['tplt'], depth + 1)
            if n['tplt'] and lo.types.get(n['tplt']) == 'NPC_' and n['tplt'] != k:
                deeper = resolve(n['tplt'], depth + 1)
                if len(deeper) > 1:
                    return deeper
            return [(n['level'], k)]
        if t == 'LVLN':
            best = {}
            for lvl, r in lvln_entries(k):
                for l2, c2 in resolve(r, depth + 1):
                    v = lvl if lo.types.get(r) == 'NPC_' else max(lvl, l2)
                    if c2 not in best or v < best[c2]:
                        best[c2] = v
            return sorted((v, c) for c, v in best.items())
        return []

    def race_of(k, depth=0):
        n = npc_info(k) if lo.types.get(k) == 'NPC_' else None
        if not n:
            return None
        if n['tplt'] and n['tflags'] & 0x01 and depth < 8 and lo.types.get(n['tplt']) == 'NPC_':   # Use Traits
            return race_of(n['tplt'], depth + 1) or n['race']
        return n['race']

    def factions_of(k, depth=0):
        """The factions an actor of base k is in: Use Factions (0x04) follows the template"""
        n = npc_info(k) if lo.types.get(k) == 'NPC_' else None
        if not n:
            return None
        if n['tplt'] and n['tflags'] & 0x04 and depth < 8:
            if lo.types.get(n['tplt']) == 'NPC_':
                return factions_of(n['tplt'], depth + 1)
            return None   # a leveled list decides: the picked NPC's own
        return n['factions']

    loc_cache = {}

    def loc_chain(lk):
        out, seen = [], set()
        while lk and lk not in seen and len(out) < 12:
            seen.add(lk)
            out.append(lk)
            s = lo.data(lk)
            p = lo.win[lk][0] if lk in lo.win else None
            lk = lo.ref(p, first(s).get(b'PNAM', b'')) if s and p else None
        return out

    def cell_loc(ck):
        if ck in loc_cache:
            return loc_cache[ck]
        s = lo.data(ck) if ck in lo.win else None
        p = lo.win[ck][0] if ck in lo.win else None
        v = lo.ref(p, first(s).get(b'XLCN', b'')) if s and p else None
        loc_cache[ck] = v
        return v

    capitals = {'whiterun': (18313, -10665), 'riften': (173137, -90912), 'solitude': (-74344, 96470), 'windhelm': (135039, 33143),
                'markarth': (-171097, 6922), 'falkreath': (-30296, -86284), 'morthal': (-38640, 66734), 'dawnstar': (30808, 106138),
                'winterhold': (109208, 102864)}

    def hold_and_town(world, cell, pos, note_town):
        chain = []
        lk = cell_loc(cell) if cell else None
        if lk:
            chain = loc_chain(lk)
        elif note_town:
            lk = next((k for k, w in lo.win.items() if w[1] == 'LCTN' and lo.edid(k) == note_town), None) if note_town not in town_by_name else town_by_name[note_town]
            town_by_name[note_town] = lk
            chain = loc_chain(lk) if lk else []
        names = [lo.edid(k) for k in chain]
        hold = next((HOLD_OF_LCTN[n] for n in names if n in HOLD_OF_LCTN), None)
        town = None
        for i, n in enumerate(names):
            if n in HOLD_OF_LCTN:
                town = names[i - 1] if i > 0 else None
                break
        wname = lo.edid(world) if world else ''
        if wname in HOLD_OF_WORLD:
            hold = hold or HOLD_OF_WORLD[wname]
            town = town or wname.replace('World', 'Location')
        if not hold and world == TAM:
            hold = min(capitals, key=lambda h: math.dist(capitals[h], pos[:2]))
        return hold or 'unknown', town or ('%s-wilds' % (hold or 'unknown'))

    def ref_state(k):
        """(flags, parent key, opposite) of a placed reference, from its winning record"""
        e = lo.refrs.get(k) or lo.achr.get(k) or lo.parents.get(k)
        if not e:
            return None
        p, off, sz, fl, ctx = e
        x = first(subs(p.data_at(p.fh, off, sz, fl))).get(b'XESP', b'')
        return (fl, lo.ref(p, x) if len(x) >= 4 else None, len(x) >= 8 and bool(struct.unpack('<I', x[4:8])[0] & 1))

    def enabled_at_start(k, own=None, depth=0):
        """As ck-mcp/wildlife.py: a parent's state when the game starts, through its own parent, else its own flag"""
        if own:
            p, fl, s = own
            x = s.get(b'XESP', b'')
            st = (fl, lo.ref(p, x) if len(x) >= 4 else None, len(x) >= 8 and bool(struct.unpack('<I', x[4:8])[0] & 1))
        else:
            st = ref_state(k)
        if st is None:
            return True   # the player (14:Skyrim.esm) or a missing ref: no opinion
        fl, parent, opposite = st
        if fl & DELETED:
            return False
        if parent and depth < 16:
            return enabled_at_start(parent, None, depth + 1) != opposite
        return not fl & DISABLED

    town_by_name = {}
    skipped = collections.defaultdict(list)
    spawns = []
    needed = collections.defaultdict(set)   # where -> {(gx, gy)} (exteriors) / {None} (interiors)
    for k, row in sorted(rows.items()):
        src = lo.desc(k)
        reason, note = row['reason'], row['note']
        if 'dungeons.json' in note or 'wildlife.json' in note or 'blackreach.json' in note:
            skipped['spawnedElsewhere'].append(src)
            continue
        if reason not in ('guard', 'townsfolk', 'merchant', 'child', 'friendly', 'creature'):
            skipped['notOurs:' + reason].append(src)
            continue
        a = lo.achr.get(k)
        if not a:
            skipped['missing'].append(src)
            continue
        p, off, sz, fl, ctx = a
        if fl & DELETED:
            skipped['deleted'].append(src)
            continue
        if fl & STARTS_DEAD:
            skipped['startsDead'].append(src)
            continue
        s = first(subs(p.data_at(p.fh, off, sz, fl)))
        if len(s.get(b'NAME', b'')) < 4 or len(s.get(b'DATA', b'')) < 24:
            skipped['noData'].append(src)
            continue
        # Behind an enable parent that is off when the game starts (Civil War camps and fort garrisons, quest people): never
        # seen in this world, so not spawned either
        if not enabled_at_start(k, (p, fl, s)):
            skipped['enableParentOff'].append(f'{src} ({row["baseEdid"]})')
            continue
        base = lo.ref(p, s[b'NAME'])
        pos = [round(v, 2) for v in struct.unpack('<3f', s[b'DATA'][:12])]
        rz = struct.unpack('<3f', s[b'DATA'][12:24])[2]
        world, cell = lo.where(p, ctx)
        if lo.types.get(base) != 'NPC_':
            skipped['baseNotNpc'].append(f'{src} ({lo.edid(base)})')
            continue
        options = resolve(base)
        if not options:
            skipped['unresolved'].append(f'{src} ({lo.edid(base)})')
            continue
        npc = pick_by_id(src, options)
        # The race of what is spawned: a leveled wrapper's own RNAM is a placeholder (LvlHorseSaddled says FoxRace)
        race = race_of(npc) or race_of(base)
        rname = lo.edid(race) if race else ''
        kind = reason
        if NOT_ACTOR_RACE.search(rname):
            skipped['notAnActor'].append(f'{src} ({lo.edid(base)}, {rname})')
            continue
        if reason == 'creature':
            if HORSE_RACE.match(rname):
                kind = 'horse'
            elif TAME_RACE.match(rname):
                kind = 'animal'
            else:
                skipped['creatureNotTame'].append(f'{src} ({lo.edid(base)}, {rname})')
                continue
        facs = factions_of(base)
        if facs is None:
            facs = factions_of(npc) or []
        facs = [(f, r) for f, r in facs if f and lo.types.get(f) == 'FACT' and not STRIP_FACTION.search(lo.edid(f))]
        wdesc = lo.desc(world) if world else lo.desc(cell)
        near = [l for l in landings if world and l[0] == wdesc.lower() and math.hypot(l[1] - pos[0], l[2] - pos[1]) < LANDING_CLEAR]
        if near:
            skipped['nearLanding'].append(f'{src} ({lo.edid(base)}, {near[0][3]} {round(math.hypot(near[0][1] - pos[0], near[0][2] - pos[1]))} u)')
            continue
        hold, town = hold_and_town(world, cell, pos, note if note.endswith('Location') else '')
        sp = {'k': k, 'src': src, 'kind': kind, 'hold': hold, 'town': town, 'base': lo.desc(base), 'edid': lo.edid(base),
              'npc': lo.desc(npc), 'npcEdid': lo.edid(npc), 'race': rname, 'world': wdesc, 'interior': not world,
              'cell': lo.desc(cell) if cell else None, 'cellEdid': lo.edid(cell) if cell else '', 'pos': pos,
              'heading': round(math.degrees(rz) % 360, 1), 'factions': [[lo.desc(f), r] for f, r in facs],
              'leveled': len(options) > 1, 'where': world or cell}
        spawns.append(sp)
        needed[world or cell].add((int(pos[0] // 4096), int(pos[1] // 4096)) if world else None)

    # ---- anchors: a loadable REFR near each spot that no plugin of ours placed or carries ----------------------------
    anchors = collections.defaultdict(list)
    for k, (p, off, sz, fl, ctx) in lo.refrs.items():
        if fl & (DELETED | DISABLED) or k[0] in OWNED or p.key in OWNED:
            continue
        world, cell = lo.where(p, ctx)
        where = world or cell
        if where not in needed:
            continue
        s = first(subs(p.data_at(p.fh, off, sz, fl)))
        if len(s.get(b'NAME', b'')) < 4 or len(s.get(b'DATA', b'')) < 12 or b'XESP' in s:
            continue
        if lo.types.get(lo.ref(p, s[b'NAME'])) not in OK_TYPES:
            continue
        pos = struct.unpack('<3f', s[b'DATA'][:12])
        if world and not any(abs(int(pos[0] // 4096) - gx) <= 1 and abs(int(pos[1] // 4096) - gy) <= 1 for gx, gy in needed[where]):
            continue
        anchors[where].append((k, pos))
    out = []
    for sp in spawns:
        best = min(anchors.get(sp['where'], []), key=lambda a: math.dist(a[1], sp['pos']), default=None)
        if best is None or (not sp['interior'] and math.dist(best[1], sp['pos']) > 8192):
            if not sp['interior']:
                skipped['noAnchor'].append(sp['src'])
                continue
            sp['ref'], sp['anchorDist'] = None, None   # NpcSpawnSystem anchors an interior zone on a player in the cell
        else:
            sp['ref'], sp['anchorDist'] = lo.desc(best[0]), round(math.dist(best[1], sp['pos']))
        out.append(sp)
    return out, skipped


# ---- navmesh and box check (as tools/skyrim_release_scan.py) -------------------------------------------------------
def parse_nvnm(v):
    i = 16
    nv = struct.unpack_from('<I', v, i)[0]; i += 4
    verts = [struct.unpack_from('<3f', v, i + 12 * k) for k in range(nv)]; i += 12 * nv
    nt = struct.unpack_from('<I', v, i)[0]; i += 4
    tris = [struct.unpack_from('<3h', v, i + 16 * k) for k in range(nt)]
    return verts, [t for t in tris if all(0 <= q < nv for q in t)]


def tri_z(P, A, B, C):
    den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1])
    if abs(den) < 1e-9:
        return None
    l1 = ((B[1] - C[1]) * (P[0] - C[0]) + (C[0] - B[0]) * (P[1] - C[1])) / den
    l2 = ((C[1] - A[1]) * (P[0] - C[0]) + (A[0] - C[0]) * (P[1] - C[1])) / den
    l3 = 1 - l1 - l2
    if min(l1, l2, l3) < -1e-6:
        return None
    return l1 * A[2] + l2 * B[2] + l3 * C[2]


# Hollow or walk-on pieces whose boxes hold a standing actor by design (stables, towers, steps, sheds, campfires, Civil War
# rubble that an enable parent keeps off), and markers
SOLID_SKIP = re.compile(r'(?i)stable|tower|steps|campfire|scaf|shed|rubble|well\d|posts|trig|enabledisable|marker|critter|fx|lightbeam|fog|mist|ambient|sound|lod|trigger|collision|snowdrift|navcut|road|perch|mountain|cliff|rug|carpet|floor|plank|stair|bridge|dock|platform|walkway|ground|terrain')


def check_spots(lo, spawns):
    """Each spot against the navmesh of its own cell (and the eight around it outdoors) and, outdoors, the boxes (OBND) of
    the objects around it at feet, waist and head. Sets sp['nav'] (height over the nearest navmesh triangle under it, None
    when there is none) and sp['inside'] (boxes holding it); returns how many spots were checked."""
    cell_of = {}
    for k, w in lo.win.items():
        if w[1] != 'CELL' or not w[5] or not w[5][0]:
            continue
        x = first(lo.data(k) or []).get(b'XCLC', b'')
        if len(x) >= 8:
            cell_of[(lo.source(w[0], w[5][0]), struct.unpack('<ii', x[:8]))] = k
    want = {}
    for sp in spawns:
        if sp['interior']:
            want[sp['src']] = {sp['where']}
        else:
            gx, gy = math.floor(sp['pos'][0] / 4096), math.floor(sp['pos'][1] / 4096)
            want[sp['src']] = {cell_of.get((sp['where'], (gx + dx, gy + dy))) for dx in (-1, 0, 1) for dy in (-1, 0, 1)} - {None}
    cells = set().union(*want.values()) if want else set()
    mesh = collections.defaultdict(list)
    for k, (p, off, sz, fl, ctx) in lo.navms.items():
        if fl & DELETED:
            continue
        c = lo.source(p, ctx[1]) if ctx and ctx[1] else None
        if c not in cells:
            continue
        v = first(subs(p.data_at(p.fh, off, sz, fl))).get(b'NVNM')
        if not v:
            continue
        try:
            verts, tris = parse_nvnm(v)
        except struct.error:
            continue
        for a, b, c2 in tris:
            A, B, C = verts[a], verts[b], verts[c2]
            mesh[c].append((min(A[0], B[0], C[0]), max(A[0], B[0], C[0]), min(A[1], B[1], C[1]), max(A[1], B[1], C[1]), A, B, C))
    worlds = {sp['where'] for sp in spawns if not sp['interior']}
    grids = {(sp['where'], math.floor(sp['pos'][0] / 4096), math.floor(sp['pos'][1] / 4096)) for sp in spawns if not sp['interior']}
    boxes = collections.defaultdict(list)
    for k, (p, off, sz, fl, ctx) in lo.refrs.items():
        if fl & (DELETED | DISABLED):
            continue
        w = lo.source(p, ctx[0]) if ctx and ctx[0] else None
        if w not in worlds:
            continue
        s = first(subs(p.data_at(p.fh, off, sz, fl)))
        if len(s.get(b'NAME', b'')) < 4 or len(s.get(b'DATA', b'')) < 24:
            continue
        dat = struct.unpack('<6f', s[b'DATA'][:24])
        g = (w, math.floor(dat[0] / 4096), math.floor(dat[1] / 4096))
        if not any((w, g[1] + dx, g[2] + dy) in grids for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
            continue
        b = lo.ref(p, s[b'NAME'])
        t = lo.types.get(b)
        # Trees' boxes hold the crown, so they are left to the navmesh, which is cut around the trunk; furniture is used
        if t not in ('STAT', 'SCOL', 'MSTT', 'CONT', 'ACTI', 'DOOR', 'FLOR', 'MISC'):
            continue
        ob = first(lo.data(b) or []).get(b'OBND', b'')
        if len(ob) < 12 or SOLID_SKIP.search(lo.edid(b)):
            continue
        obnd = struct.unpack('<6h', ob[:12])
        # A box wider than a house is a hollow piece (a stable, a wall run, a dock) the navmesh already answers for
        if obnd[3] - obnd[0] > 1024 or obnd[4] - obnd[1] > 1024:
            continue
        sc = struct.unpack('<f', s[b'XSCL'][:4])[0] if len(s.get(b'XSCL', b'')) >= 4 else 1.0
        boxes[g].append((dat, sc or 1.0, obnd, lo.edid(b), lo.desc(k)))
    for sp in spawns:
        P = sp['pos']
        zs = []
        for c in want[sp['src']]:
            for x1, x2, y1, y2, A, B, C in mesh.get(c, ()):
                if x1 <= P[0] <= x2 and y1 <= P[1] <= y2:
                    z = tri_z(P, A, B, C)
                    if z is not None:
                        zs.append(z)
        nz = min(zs, key=lambda z: abs(z - P[2])) if zs else None
        sp['nav'] = None if nz is None else round(P[2] - nz, 1)
        inside = []
        if not sp['interior']:
            gx, gy = math.floor(P[0] / 4096), math.floor(P[1] / 4096)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dat, sc, (x1, y1, z1, x2, y2, z2), e, rk in boxes.get((sp['where'], gx + dx, gy + dy), ()):
                        c, sn = math.cos(dat[5]), math.sin(dat[5])
                        ddx, ddy = P[0] - dat[0], P[1] - dat[1]
                        lx, ly = (ddx * c - ddy * sn) / sc, (ddx * sn + ddy * c) / sc
                        if not (x1 + 8 <= lx <= x2 - 8 and y1 + 8 <= ly <= y2 - 8):
                            continue
                        if all(z1 <= (zz - dat[2]) / sc <= z2 for zz in (P[2] + 10, P[2] + 64, P[2] + 120)):
                            inside.append(f'{e} {rk}')
        sp['inside'] = inside[:3]
    return len(spawns)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('list', help='DBO_SkyrimActorsList2.txt (NPC pass 2)')
    ap.add_argument('--data', default='/opt/skyrim-data')
    ap.add_argument('--order', default=None, help='default: <data>/loadorder.txt')
    ap.add_argument('--replace', action='append', default=[])
    ap.add_argument('--out', default=os.path.join(SRV, 'town-spawns.json'))
    ap.add_argument('--check', type=int, default=0)
    ap.add_argument('--check-out', default=None)
    a = ap.parse_args()
    replace = {}
    for r in a.replace:
        name, _, path = r.partition('=')
        replace[name.strip().lower()] = path.strip()
    rows = parse_list(a.list)
    lo = LoadOrder(a.data, a.order or os.path.join(a.data, 'loadorder.txt'), replace, set(rows))
    landings = spots_from_gamemode(SRV)
    spawns, skipped = build(lo, rows, landings)
    # No hold: holding and template cells (CWGuardTemplates, BYOHHouseUtilityCell, Sovngarde, the Soul Cairn, test cells)
    for sp in [sp for sp in spawns if sp['hold'] == 'unknown']:
        skipped['noHold'].append(f"{sp['src']} ({sp['edid']}, {sp['cellEdid'] or sp['world']})")
    spawns = [sp for sp in spawns if sp['hold'] != 'unknown']
    check_spots(lo, spawns)
    kept = []
    for sp in spawns:
        if sp['nav'] is None or abs(sp['nav']) > NAV_REACH:
            skipped['noNavmesh'].append(f"{sp['src']} ({sp['edid']}, {sp['cellEdid'] or sp['world']}, {sp['nav']})")
        elif sp['inside']:
            skipped['insideGeometry'].append(f"{sp['src']} ({sp['edid']}, {sp['inside'][0]})")
        else:
            kept.append(sp)
    spawns = kept
    by = collections.Counter((s['hold'], s['kind']) for s in spawns)
    result = {
        '_comment': 'Generated by tools/spawns/town_spawns.py from NPC pass 2 (DBO_SkyrimActorsList2.txt): the guards, townsfolk, '
                    'merchants, children, friendly NPCs and tame animals of open Skyrim, each spawned by the server on its own '
                    'spot as a town:<kind>:<local id>-<plugin> zone (townspawns.js), only once its plugin actor is disabled in the '
                    'loaded plugins. Do not edit by hand; rerun the generator after the list or a plugin changes.',
        'list': os.path.basename(a.list),
        'listSha': hashlib.sha256(open(a.list, 'rb').read()).hexdigest()[:16],
        'counts': {h: dict(sorted((k, n) for (hh, k), n in by.items() if hh == h)) for h in sorted({h for h, _ in by})},
        'spawns': [{k: v for k, v in s.items() if k not in ('k', 'where', 'inside')} for s in sorted(spawns, key=lambda s: (s['hold'], s['town'], s['src']))],
        'skipped': {k: v for k, v in sorted(skipped.items())},
    }
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f"town spawns: {len(spawns)} of {len(rows)} rows -> {a.out}; skipped " + ', '.join(f'{k} {len(v)}' for k, v in sorted(skipped.items())))
    for h, c in result['counts'].items():
        print(f'  {h:11s} {sum(c.values()):5d}  ' + ' '.join(f'{k} {n}' for k, n in c.items()))
    if a.check:
        # The spot check: N spots spread over hold x kind x indoors/outdoors, as kept (each already passed the navmesh and
        # box test above; this prints the evidence for a reader)
        by = collections.defaultdict(list)
        for sp in spawns:
            by[(sp['hold'], sp['kind'], sp['interior'])].append(sp)
        for v in by.values():
            v.sort(key=lambda s: hashlib.sha1(s['src'].encode()).hexdigest())
        keys = sorted(by, key=lambda k: hashlib.sha1(repr(k).encode()).hexdigest())
        chosen, i = [], 0
        while len(chosen) < a.check and any(by.values()):
            v = by[keys[i % len(keys)]]
            if v:
                chosen.append(v.pop(0))
            i += 1
        rep = [{'src': c['src'], 'edid': c['edid'], 'kind': c['kind'], 'hold': c['hold'], 'where': c['cellEdid'] or c['world'],
                'pos': c['pos'], 'aboveNavmesh': c['nav'], 'insideBoxes': c['inside']} for c in chosen]
        if a.check_out:
            json.dump(rep, open(a.check_out, 'w'), indent=1)
        for r in rep:
            print(f"  check {r['hold']:10s} {r['kind']:9s} {r['where'][:30]:30s} {r['edid'][:28]:28s} {r['aboveNavmesh']:+7.1f} over navmesh, in {len(r['insideBoxes'])} boxes")
    return 0


if __name__ == '__main__':
    sys.exit(main())
