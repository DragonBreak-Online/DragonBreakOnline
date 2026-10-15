#!/usr/bin/env python3
# Skyrim opens: the narrowed actor pass (Nate, 15 Oct: "disable only the troublesome plugin-placed living actors").
# One streamed pass over the release package's load order (each plugin from <package>/plugins, else /opt/skyrim-data), the
# same census as tools/skyrim_release_scan.py (every winning ACHR that is not deleted, not Initially Disabled, not Starts
# Dead, not sunk below -20000, outside the hub and the closed lands), then each living actor is judged:
#   near     within NEAR units (2D, same worldspace) of a hold-gate landing spot (gamemode.js GATES + config hubGates) or of
#            the creator landing / Pale Pass arrival (config landing, playtest.arrival): hostile actors and creatures only
#            (15 Oct: guards, townsfolk, merchants, children and friendly NPCs at the gates stay);
#   town     a hostile actor or creature inside a city or town: a city worldspace (Whiterun, Solitude, Markarth, Riften,
#            Windhelm) or a cell whose location (XLCN, up its parents) carries LocTypeCity or LocTypeTown;
#   hostile  anywhere else: an actor whose factions or AI make it attack players (bandits, Forsworn, vampires,
#            necromancers and warlocks, draugr, Falmer, hagravens, spriggans, the Silver Hand, daedra and the like by
#            faction; aggression Very Aggressive or Frenzied, which attack on sight; Aggressive creatures). An Aggressive
#            person attacks only enemies, so is not hostile by aggression alone. A leveled actor is hostile when any NPC
#            its list can give is. Prey and Friend factions (SprigganPreyFaction: goats, cows, deer; BanditFriendFaction: carriage horses) are not hostile.
# Kept: guards, townsfolk, merchants, children and every other friendly NPC or creature (Unaggressive, or Aggressive
# with none of the hostile factions).
# Base rules: an NPC_ with ACBS template flags Use Factions / Use AI Data takes those from its TPLT (followed through
# leveled lists, any hostile wins). AIDT byte 0 is aggression (0 Unaggressive, 1 Aggressive, 2 Very Aggressive, 3 Frenzied).
#   python3 tools/skyrim_actor_narrow.py <gamemode-config.json> <gamemode.js> <outdir> [--list <xedit list>]
# writes <outdir>/achr-judged.json (every living actor with its verdict and reason), prints the counts, and with --list
# writes the xEdit list for DBO_SkyrimActors.pas: disable|plugin|localId|baseEdid|targetPlugin|reason
# tools/skyrim_actor_check.py runs the same judge over the PC's returned plugins.
import sys, os, struct, math, json, re, collections
sys.path.insert(0, os.path.expanduser('~/dragonbreak/ck-mcp'))
import esplib

PKG = os.environ.get('DBO_PACKAGE', os.path.expanduser('~/inbox/2026-10-14-skyrim-release'))
DATA = os.environ.get('DBO_DATA', '/opt/skyrim-data')
NEAR = float(os.environ.get('DBO_NEAR', '4000'))
TAM = '3c:skyrim.esm'
CITY_WORLDS = re.compile(r'^(WhiterunWorld|SolitudeWorld|MarkarthWorld|RiftenWorld|WindhelmWorld)$', re.I)
TOWN_KW = {'LocTypeCity', 'LocTypeTown'}
HOSTILE_FACTION = re.compile(r'(?!.*(?:Prey|Friend))(?:Bandit|Forsworn|Vampire(?!Hunter)|Necromancer|Warlock|Draugr|Falmer|Hagraven|Spriggan|SilverHand|DragonPriest|'
                             r'Dremora|Daedra|Atronach|Skeleton|Riekling|Ashspawn|Reaver|Predator|WEBandit|WENecromancer|Thieves(?:Guild)?Enemy|'
                             r'DLC1VampireFaction|DLC2Ash|BlackreachFalmer|Wispmother|Undead|Rogue)', re.I)
GUARD_FACTION = re.compile(r'Guard', re.I)
TOWN_FACTION = re.compile(r'^Crime|Town|Citizen|Jarl|Housecarl|Steward|Merchant|Vendor|Innkeeper|Farmer|Miner|Blacksmith|Fisher|Lumber|Beggar|Bard|Priest|Temple|Servant', re.I)
MERCHANT_FACTION = re.compile(r'JobMerchant|Merchant|Vendor|Innkeeper|Blacksmith|Apothecary|Spell', re.I)
PLAYABLE_RACE = re.compile(r'^(Nord|Imperial|Breton|Redguard|HighElf|DarkElf|WoodElf|Orc|Khajiit|Argonian|Elder|DBO\w+|Maormer|SnowElf|Reach\w*|Dremora|DA13AfflictedRace)', re.I)
CHILD_RACE = re.compile(r'Child', re.I)
# Aggressive by record but only towards enemies, and kept: dogs and huskies, tame mammoths
TAME_NAME = re.compile(r'Dog|Husky|Mammoth')
# The kinds that attack players on sight whatever their record's own aggression says (an ambush variant keeps 0 until its
# package wakes it; mudcrabs and skeevers have only CreatureFaction and PreyFaction), by the editor id of the actor or of
# any NPC its template chain or leveled list gives. Giants and mammoths are left: they warn before they fight.
HOSTILE_NAME = re.compile(r'(?<!No)(?:Mudcrab|Skeever|Spider|Chaurus|Troll(?![a-z])|Wolf(?![a-z]|Cub)|Bear(?![a-z]|Cub)|SabreCat|Sabrecat|Slaughterfish|IceWraith|'
                          r'DwarvenSphere|DwarvenCenturion|DwarvenSpider|DwarvenBallista|Draugr|Skeleton|Falmer|Spriggan|Hagraven|Horker|Wisp|'
                          r'Bandit|Forsworn|Necromancer|Warlock|Netch|Riekling|Lurker|Seeker|Gargoyle|DeathHound|BoneWolf|Afflicted|'
                          r'Werewolf|Vampire(?!Hunter)|Dragon(?![a-z]|Bridge|Fly)|Atronach|Dremora|Goblin(?!Race)|Ogre|Minotaur|Imp(?![a-z]))')


def main():
    a = sys.argv[1:]
    out_list = None
    if '--list' in a:
        i = a.index('--list'); out_list = a[i + 1]; a = a[:i] + a[i + 2:]
    cfg_path, gm_path, OUT = a
    cfg = json.load(open(cfg_path))
    os.makedirs(OUT, exist_ok=True)
    order = [l.strip().lstrip('*') for l in open(os.path.join(PKG, 'skyrim-data', 'loadorder.txt'), encoding='utf-8-sig') if l.strip() and not l.startswith('#')]
    closed = {p.lower() for p in cfg.get('playtest', {}).get('closedPlugins', [])}
    if os.environ.get('DBO_FROM_JUDGED'):   # re-judge the closed-route rule only, from an earlier pass's achr-judged.json
        rows = json.load(open(os.environ['DBO_FROM_JUDGED']))
        for r in rows: r['reason'] = reason_of(r)
    else:
        rows = judge(cfg, gm_path, order, closed)
    closed_routes(rows, closed)
    json.dump(rows, open(os.path.join(OUT, 'achr-judged.json'), 'w'))
    report(rows)
    if out_list:
        write_list(rows, order, out_list)


def path_of(n):
    q = os.path.join(PKG, 'plugins', n)
    return q if os.path.exists(q) else os.path.join(DATA, n)


def first(d):
    o = {}
    for s, v in esplib.subrecords(d):
        if s not in o: o[s] = bytes(v)
    return o


def edid_of(sub):
    return sub.get(b'EDID', b'').rstrip(b'\0').decode('cp1252', 'replace')


def spots_of(cfg, gm_path):
    """[(name, world, x, y)]: the nine gates' landing spots and the creator landing / arrival."""
    src = open(gm_path, encoding='utf8').read()
    gates = {}
    for m in re.finditer(r"^  (a00\d): \['(\w+)', (\[\[.*?\]\]), -?\d+\],$", src, re.M):
        gates[m.group(1)] = (m.group(2), json.loads(m.group(3)))
    for gid, g in (cfg.get('hubGates') or {}).items():
        if isinstance(g, dict) and isinstance(g.get('spots'), list) and gid in gates:
            gates[gid] = (gates[gid][0], g['spots'])
    if len(gates) != 9:
        raise SystemExit('read %d gates, not 9' % len(gates))
    out = [(name, TAM, s[0], s[1]) for name, spots in gates.values() for s in spots]
    for key, label in (('landing', 'creator landing'), ):
        L = cfg.get(key) or {}
        if L.get('world') and L.get('pos'): out.append((label, canon(L['world']), L['pos'][0], L['pos'][1]))
    arr = (cfg.get('playtest') or {}).get('arrival') or {}
    if arr.get('world') and arr.get('pos'): out.append(('Pale Pass arrival', canon(arr['world']), arr['pos'][0], arr['pos'][1]))
    return out


def canon(desc):
    h, p = str(desc).split(':', 1)
    return '%x:%s' % (int(h, 16), p.lower())


def judge(cfg, gm_path, order, closed):
    npc, lvln, fact, race, lctn, kywd, cells, worlds, achr = {}, {}, {}, {}, {}, {}, {}, {}, {}
    for n in order:
        path = path_of(n)
        if not os.path.exists(path):
            print('missing', n, file=sys.stderr); continue
        p = esplib.Plugin(path)
        fh = open(path, 'rb')

        def nm(fid):
            s, l = p.modindex_source(fid); return '%x:%s' % (l, s)
        for (t, fid, fl, off, sz, ctx) in p.index:
            if t not in ('NPC_', 'LVLN', 'FACT', 'RACE', 'LCTN', 'KYWD', 'CELL', 'WRLD', 'ACHR'):
                continue
            key = nm(fid)
            d = p.data_at(fh, off, sz, fl)
            if t == 'ACHR':
                sub = first(d)
                pos = struct.unpack('<6f', sub[b'DATA'][:24]) if len(sub.get(b'DATA', b'')) >= 24 else None
                base = nm(struct.unpack('<I', sub[b'NAME'][:4])[0]) if b'NAME' in sub else None
                rec = {'base': base, 'pos': [round(x, 1) for x in pos[:3]] if pos else None, 'flags': fl, 'by': n,
                       'world': nm(ctx[0]) if ctx[0] else None, 'cell': nm(ctx[1]) if ctx[1] else None, 'xesp': b'XESP' in sub}
                if key in achr and not rec['pos']: achr[key].update(flags=fl, by=n)
                else: achr[key] = rec
                continue
            subs = list(esplib.subrecords(d))
            sub = {}
            for s, v in subs:
                if s not in sub: sub[s] = bytes(v)
            if t == 'NPC_':
                acbs = sub.get(b'ACBS', b'')
                tflags = struct.unpack_from('<H', acbs, 18)[0] if len(acbs) >= 20 else 0   # ACBS: flags u32, 7 x u16, template flags at 18
                aidt = sub.get(b'AIDT', b'')
                npc[key] = {'edid': edid_of(sub), 'aggr': aidt[0] if aidt else 0,
                            'factions': [nm(struct.unpack_from('<I', v)[0]) for s, v in subs if s == b'SNAM' and len(v) >= 4],
                            'race': nm(struct.unpack('<I', sub[b'RNAM'][:4])[0]) if len(sub.get(b'RNAM', b'')) >= 4 else None,
                            'tplt': nm(struct.unpack('<I', sub[b'TPLT'][:4])[0]) if len(sub.get(b'TPLT', b'')) >= 4 and struct.unpack('<I', sub[b'TPLT'][:4])[0] else None,
                            'tflags': tflags}
            elif t == 'LVLN':
                lvln[key] = {'edid': edid_of(sub), 'entries': [nm(struct.unpack_from('<I', v, 4)[0]) for s, v in subs if s == b'LVLO' and len(v) >= 8]}
            elif t == 'FACT':
                fact[key] = edid_of(sub)
            elif t == 'RACE':
                race[key] = edid_of(sub)
            elif t == 'KYWD':
                kywd[key] = edid_of(sub)
            elif t == 'LCTN':
                kw = []
                for s, v in subs:
                    if s == b'KWDA': kw += [nm(struct.unpack_from('<I', v, i)[0]) for i in range(0, len(v) - 3, 4)]
                lctn[key] = {'edid': edid_of(sub), 'parent': nm(struct.unpack('<I', sub[b'PNAM'][:4])[0]) if len(sub.get(b'PNAM', b'')) >= 4 else None, 'kw': kw}
            elif t == 'CELL':
                c = cells.get(key, {})
                c.update({'edid': edid_of(sub) or c.get('edid', ''), 'world': nm(ctx[0]) if ctx[0] else None,
                          'loc': nm(struct.unpack('<I', sub[b'XLCN'][:4])[0]) if len(sub.get(b'XLCN', b'')) >= 4 else c.get('loc')})
                cells[key] = c
            elif t == 'WRLD':
                worlds[key] = edid_of(sub)
        fh.close(); del p
        print('scanned', n, file=sys.stderr, flush=True)

    # ---- the judge ----
    def town_loc(loc, depth=0):
        if not loc or depth > 6 or loc not in lctn: return ''
        L = lctn[loc]
        if any(kywd.get(k, '') in TOWN_KW for k in L['kw']): return L['edid']
        return town_loc(L['parent'], depth + 1)

    memo = {}

    def npc_traits(key, depth=0):
        """[(aggression, [faction edids], race edid)] of every NPC this base can be."""
        if depth > 8 or not key: return []
        if key in memo: return memo[key]
        memo[key] = []
        if key in lvln:
            out = [x for e in lvln[key]['entries'] for x in npc_traits(e, depth + 1)]
        elif key in npc:
            r = npc[key]
            facs = [fact.get(f, '') for f in r['factions']]
            out = [(r['aggr'], facs, race.get(r['race'], ''), [r['edid']])]
            # Use Factions (0x04) or Use AI Data (0x10) take those from the template; a template that is a leveled list
            # (the placed Lvl* actors, e.g. LvlBanditMissile -> LCharBanditMissile) gives the whole actor
            if r['tplt'] and (r['tflags'] & 0x15 or r['tplt'] in lvln):   # 0x01 Traits carries the race
                tt = npc_traits(r['tplt'], depth + 1)
                if tt and r['tplt'] in lvln and not (r['tflags'] & 0x15):
                    out = [(t[0], t[1], t[2], [r['edid']] + t[3]) for t in tt]
                elif tt:
                    out = [((t[0] if r['tflags'] & 0x10 else r['aggr']), (t[1] if r['tflags'] & 0x04 else facs), (t[2] if r['tflags'] & 0x01 else race.get(r['race'], '') or t[2]), [r['edid']] + t[3]) for t in tt]
        else:
            out = []
        memo[key] = out
        return out

    def hostile_of(traits):
        why = ''
        for aggr, facs, rc, eds in traits:
            hf = [f for f in facs if HOSTILE_FACTION.search(f) and not GUARD_FACTION.search(f)]
            if hf: return 'faction ' + hf[0]
            hn = [e for e in eds if HOSTILE_NAME.search(e or '') and not CHILD_RACE.search(rc or '')] if not any(GUARD_FACTION.search(f) or TOWN_FACTION.search(f) for f in facs) else []
            if hn: why = why or 'kind %s' % HOSTILE_NAME.search(hn[0]).group(0)
            if aggr >= 2: why = why or 'aggression %d' % aggr
            elif aggr == 1 and not any(GUARD_FACTION.search(f) or TOWN_FACTION.search(f) for f in facs):   # guards are Aggressive towards enemies only
                creature = not PLAYABLE_RACE.search(rc or '') and not CHILD_RACE.search(rc or '')
                if creature and not any(TAME_NAME.search(e or '') for e in eds): why = why or 'aggressive creature (%s)' % rc
        return why

    def kind_of(traits):
        if not traits: return 'unknown'
        if any(CHILD_RACE.search(t[2] or '') for t in traits): return 'child'
        facs = [f for t in traits for f in t[1]]
        if any(GUARD_FACTION.search(f) for f in facs): return 'guard'
        if any(MERCHANT_FACTION.search(f) for f in facs): return 'merchant'
        if any(TOWN_FACTION.search(f) for f in facs): return 'townsfolk'
        if all(not PLAYABLE_RACE.search(t[2] or '') for t in traits): return 'creature'
        return 'friendly'

    spots = spots_of(cfg, gm_path)
    rows = []
    for key, r in achr.items():
        if r['flags'] & 0x20 or r['flags'] & 0x800 or r['flags'] & 0x200: continue
        if r['pos'] and r['pos'][2] < -20000: continue
        if r['world']:
            where, wname, interior, loc = r['world'], worlds.get(r['world'], ''), False, (cells.get(r['cell'] or '', {}) or {}).get('loc')
        else:
            c = cells.get(r['cell'] or '', {}); where, wname, interior, loc = r['cell'], c.get('edid', ''), True, c.get('loc')
        origin = (where or ':').split(':', 1)[1]
        if origin in closed: continue
        if where == '17482:dragonbreak hub.esp': continue
        cyrodiil = origin in ('bsheartland.esm', 'bsassets.esm')   # Cyrodiil is the Bruma pass's (DBO_DisableBrumaActors.pas): only its arrival counts here
        traits = npc_traits(r['base'])
        bedid = (npc.get(r['base']) or lvln.get(r['base']) or {}).get('edid', '')
        host = hostile_of(traits)
        kind = 'hostile' if host else kind_of(traits)
        near = ''
        if not interior and r['pos']:
            for (sname, sw, x, y) in spots:
                if sw == where and math.hypot(r['pos'][0] - x, r['pos'][1] - y) <= NEAR:
                    near = sname; break
        if cyrodiil and not near: continue
        town = ''
        if CITY_WORLDS.match(wname or ''): town = wname
        else: town = town_loc(loc)
        row = {'ref': key, 'by': r['by'], 'base': r['base'], 'baseEdid': bedid, 'place': where, 'placeEdid': wname, 'interior': interior,
               'pos': r['pos'], 'xesp': r['xesp'], 'kind': kind, 'town': town, 'near': near, 'hostile': host,
               'races': sorted({t[2] for t in traits if t[2]})}
        row['reason'] = reason_of(row)
        rows.append(row)
    return rows


# Near a landing (Nate, 15 Oct, decision 1 of integration B): only hostile actors and creatures are disabled there. Guards,
# townsfolk, merchants, children and other friendly NPCs at the gates stay. 'near' is still recorded on a kept row.
NEAR_DISABLE = {'hostile', 'creature'}


# Kept enabled whatever the judge says (Nate, 15 Oct, decision 5 of integration B): the Companions' ghosts in Ysgramor's Tomb,
# Vaermina's devotees in Nightcaller Temple (both quest set pieces), and giants (they warn before they fight).
KEEP_BASE = re.compile(r'^(?:DunYsgramorsTomb_LvlGhost|DA16LvlVaerminaDevotee)')
KEEP_RACE = {'GiantRace'}


def kept_by_decision(r):
    if KEEP_BASE.match(r.get('baseEdid') or ''): return True
    races = set(r.get('races') or [])
    return bool(races) and races <= KEEP_RACE


def reason_of(r):
    if kept_by_decision(r): return ''
    if r['near'] and r['kind'] in NEAR_DISABLE: return 'near ' + r['near']
    if r['hostile'] and r['town']: return 'hostile in town %s: %s' % (r['town'], r['hostile'])
    if r['hostile']: return 'hostile: ' + r['hostile']
    return ''


# Kept from the 9,620 list (Nate 15 Oct, "just skyrim will be open"): the Northern Maiden's crew at the Windhelm docks, whose
# dialogue sails to Raven Rock (playtest.js also refuses talking to them), and any actor of a closed plugin standing in an
# open cell (its refs: the ref's own plugin is closed)
CLOSED_ROUTE_REFS = {'182af:dragonborn.esm': 'Gjalund Salt-Sage', '376f8:dragonborn.esm': 'Sogrlaf', '376f7:dragonborn.esm': 'Lygrleid'}


def closed_routes(rows, closed):
    for r in rows:
        if r['reason']: continue
        if r['ref'] in CLOSED_ROUTE_REFS:
            r['reason'] = 'closed route: %s sails to Raven Rock' % CLOSED_ROUTE_REFS[r['ref']]
        elif r['ref'].split(':', 1)[1] in closed:
            r['reason'] = 'closed land: an actor of %s in an open cell' % r['ref'].split(':', 1)[1]


def report(rows):
    dis = [r for r in rows if r['reason']]
    keep = [r for r in rows if not r['reason']]
    print('kept near a landing, by kind:', dict(collections.Counter(r['kind'] for r in keep if r['near'])))
    by = collections.Counter('near landing' if r['reason'].startswith('near') else 'hostile in town' if r['reason'].startswith('hostile in town') else r['reason'].split(':')[0] for r in dis)
    print('living actors judged %d: disable %d, keep %d' % (len(rows), len(dis), len(keep)))
    print('disable by reason:', dict(by))
    print('disable, near a landing, by spot:', dict(collections.Counter(r['near'] for r in dis if r['near'])))
    print('disable, near a landing, by kind:', dict(collections.Counter(r['kind'] for r in dis if r['near'])))
    print('disable, hostile, by cause:', dict(collections.Counter(re.sub(r' \(.*\)|faction ', '', r['hostile']) for r in dis if r['hostile'] and not r['near']).most_common(25)))
    print('keep by kind:', dict(collections.Counter(r['kind'] for r in keep)))
    print('kept by decision (Ysgramor ghosts, Vaermina devotees, giants):', dict(collections.Counter(
        'giant' if set(r.get('races') or []) <= KEEP_RACE and r.get('races') else (r['baseEdid'] or '')[:16] for r in keep if kept_by_decision(r))))


def write_list(rows, order, out_list):
    idx = {n.lower(): i for i, n in enumerate(order)}; name = {n.lower(): n for n in order}
    NEX = idx['dragonbreak nexus patches.esp']
    VANILLA = {'skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm', 'dragonbreak.esp', 'dragonbreak online edits.esp', 'dragonbreak hub.esp', 'dragonbreak whiterun.esp'}
    lines = []
    for r in sorted((r for r in rows if r['reason']), key=lambda r: (r['interior'], r['placeEdid'], r['ref'])):
        loc, plug = r['ref'].split(':', 1)
        w = idx.get(r['by'].lower(), 0)
        if w > NEX: raise SystemExit('winner after Nexus Patches: %s %s' % (r['ref'], r['by']))
        tgt = 'DragonBreak Nexus Patches.esp' if (plug not in VANILLA and not plug.startswith('cc')) or w >= NEX else 'DragonBreak Online Edits.esp'
        lines.append('disable|%s|%06X|%s|%s|%s' % (name.get(plug, plug), int(loc, 16), r['baseEdid'] or '*', tgt, r['reason'].replace('|', '/')))
    open(out_list, 'w', newline='\r\n').write('\n'.join(lines) + '\n')
    print('wrote', len(lines), 'lines to', out_list)


if __name__ == '__main__':
    main()
