#!/usr/bin/env python3
"""Do the recipes the Skyrim release brings work in open Skyrim? (Nate, 14 Oct: "check the new recipes for weapons etc
added, just have it make sure everything works for skyrim"; check 4 of the Skyrim release, 15 Oct.)

    ionice -c3 nice -n19 python3 tools/crafting/skyrim_recipes_check.py <package dir> <config with playtest.closedPlugins> \
        --list <package>/crafting/new-recipes-since-13oct.txt --json out.json [--scan scan.json]

Reads the NEW load order (the package's skyrim-data/loadorder.txt; each plugin from <package>/plugins when there, else
/opt/skyrim-data), read-only, with ck-mcp's esplib, and the server data beside this tool (labour.js, skills.json,
pelt-values.json, wildlife.json, dungeon-pools.json, loot.json, loottiers.js, gear-swap.json, dragon-materials.json,
salvage.json, regions.json, regions-overrides.json, smithing.json, gamemode-config.json craftPerkTiers).

The open lands are the Skyrim release's lock (playtest.closedPlugins, Nate 12-15 Oct): a place whose world or interior cell
comes from a plugin NOT in closedPlugins is open; Tamriel of BS Heartland only inside the Bruma border. Each place is then
"skyrim" (open Skyrim), "bruma" (open Cyrodiil), "hub" (the Realm) or "closed".

For every listed recipe (else every winning COBJ of the plugins named with --plugins):
  bench    the bench keyword, and the enabled placed FURN carrying it per kind of place
  inputs   each input's best source, as tools/crafting/obtainability.py counts them (labour.js veins and nodes, chopping,
           skinning, the bodies of spawned creatures, flora, loot.json as loottiers.js lets it drop, salvage, another
           recipe): SKYRIM (a source in open Skyrim), BRUMA (only in open Cyrodiil), CLOSED (only in a closed land),
           NONE; dragon materials only from a slain dragon (Nate, 30 Sep); there are no NPC vendors (player trade only)
  region   regions.js's verdict (regions.json entry or regions-overrides.json recipes, else failOpen)
  family   the product's smithing family (tools/loot/loot_materials.py's classifier on the new order) and its tier,
           technique and schematic source (smithing.json, config smithing.drops / discovery)
  perks    each HasPerk against config craftPerkTiers (a perk not listed never opens)
  race     the GetIsRace OR-groups, as the fork's CraftService evaluates them
  other    any condition function the fork does not implement (a crafting condition it cannot evaluate is false)
Read only. Memory about 2 GB, a few minutes."""
import argparse, collections, json, os, re, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.environ.get('ESPLIB_DIR', os.path.expanduser('~nate/dragonbreak/ck-mcp')))
sys.path.insert(0, os.path.join(SERVER, 'tools', 'loot'))
import esplib  # noqa: E402

DELETED, DISABLED = 0x20, 0x800
ITEM_T = ('MISC', 'INGR', 'SLGM', 'ALCH', 'WEAP', 'ARMO', 'AMMO', 'BOOK', 'KEYM', 'LIGH', 'SCRL')
RANK = {'SKYRIM': 3, 'BRUMA': 2, 'CLOSED': 1, 'NONE': 0}
NAME = {v: k for k, v in RANK.items()}
# Condition functions the fork implements (ConditionFunctionFactory.cpp, origin/main 15 Oct), by index; HasPerk (448)
# goes to the gamemode's craftPerkTiers; GetBaseActorValue (277) is let through for crafts
FUNCS = {47: 'GetItemCount', 69: 'GetIsRace', 74: 'GetGlobalValue', 101: 'IsWeaponMagicOut', 130: 'GetPCIsRace', 182: 'GetEquipped',
         254: 'GetIsPlayableRace', 263: 'IsWeaponOut', 264: 'HasSpell', 300: 'IsInInterior', 569: 'IsBlocking', 596: 'SpellHasKeyword',
         597: 'GetEquippedItemType', 640: 'GetActorValuePercent', 682: 'WornHasKeyword', 722: 'WornApparelHasKeywordCount',
         448: 'HasPerk', 277: 'GetBaseActorValue', 58: 'GetStage', 59: 'GetStageDone', 659: 'EPTemperingItemIsEnchanted'}
IMPLEMENTED = {47, 69, 74, 101, 130, 182, 254, 263, 264, 300, 569, 596, 597, 640, 682, 722, 448, 277}
OPS = ['==', '!=', '>', '>=', '<', '<=']


def jl(name, dflt):
    try:
        return json.load(open(os.path.join(SERVER, name)))
    except Exception:
        return dflt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('package')
    ap.add_argument('config')
    ap.add_argument('--data', default='/opt/skyrim-data')
    ap.add_argument('--list', help='new-recipes-since-13oct.txt: recipe | origin -> winner | ...')
    ap.add_argument('--plugins', default='', help='comma list: check every winning COBJ that comes from these plugins')
    ap.add_argument('--json', required=True)
    ap.add_argument('--scan', help='also write a loot_materials.py scan of the new order here')
    a = ap.parse_args()
    cfg = json.load(open(a.config))
    pt = cfg.get('playtest', {})
    closed = {x.lower() for x in pt.get('closedPlugins', [])}
    order = [l.strip().lstrip('*') for l in open(os.path.join(a.package, 'skyrim-data', 'loadorder.txt'), encoding='utf-8-sig') if l.strip() and not l.startswith('#')]
    plugins, proper, missing = [], {}, []
    for n in order:
        path = os.path.join(a.package, 'plugins', n)
        if not os.path.exists(path):
            path = os.path.join(a.data, n)
        if not os.path.exists(path):
            missing.append(n)
            continue
        p = esplib.Plugin(path)
        p.fh = open(path, 'rb')
        p.key = n.lower()
        p.src_dir = 'package' if path.startswith(a.package) else 'data'
        plugins.append(p)
        proper[n.lower()] = n
        print('read', n, file=sys.stderr)

    def src(p, fid):
        s, loc = p.modindex_source(fid)
        return (s.lower(), loc & 0xFFFFFF) if s else None

    def desc(k):
        return '%x:%s' % (k[1], proper.get(k[0], k[0])) if k else ''

    def u32(v, i=0):
        return struct.unpack_from('<I', v, i)[0]

    # ---- the winning records ---------------------------------------------------------------------------------
    rec = {}
    chain = collections.defaultdict(list)
    want = set(ITEM_T) | {'KYWD', 'COBJ', 'LVLI', 'NPC_', 'FLOR', 'TREE', 'ACTI', 'LVLN', 'FURN', 'RACE', 'PERK', 'QUST', 'WRLD', 'CELL', 'GLOB', 'FLST'}
    raw_bad = {}   # COBJ key -> [(sig, raw form id, master count)] for references outside the plugin's masters
    for p in plugins:
        for t, fid, fl, off, sz, ctx in p.index:
            if t not in want:
                continue
            k = src(p, fid)
            if not k:
                continue
            chain[k].append(p.key)
            if fl & DELETED:
                rec.pop(k, None)
                continue
            d = p.data_at(p.fh, off, sz, fl)
            if t in ('CELL', 'WRLD'):
                rec[k] = (t, esplib.edid_of(d) or '', [], p)
                continue
            rec[k] = (t, esplib.edid_of(d) or '', list(esplib.subrecords(d)), p)
    edid = {k: v[1] for k, v in rec.items()}

    def ref(p, v, i=0):
        return src(p, u32(v, i))

    # ---- recipes ------------------------------------------------------------------------------------------------
    def parse_cobj(k):
        t, e, subs, p = rec[k]
        r = {'id': desc(k), 'key': k, 'edid': e, 'origin': chain[k][0], 'winner': p.key, 'product': None, 'count': 1, 'bench': None, 'inputs': [], 'conds': [], 'unresolved': []}
        for s, v in subs:
            if s == b'CNAM' and len(v) >= 4:
                r['product'] = ref(p, v)
            elif s == b'BNAM' and len(v) >= 4:
                r['bench'] = ref(p, v)
            elif s == b'NAM1' and len(v) >= 2:
                r['count'] = struct.unpack_from('<H', v)[0]
            elif s == b'CNTO' and len(v) >= 8:
                ik = ref(p, v)
                n = struct.unpack_from('<i', v, 4)[0]
                if not ik or ik not in rec:
                    r['unresolved'].append({'raw': '%08X' % u32(v), 'resolved': desc(ik) if ik else None, 'masters': len(p.masters), 'count': n,
                                            'why': 'index past the masters' if not ik else 'no such record in the order' if ik not in chain else 'deleted'})
                r['inputs'].append((ik, n))
            elif s == b'CTDA' and len(v) >= 24:
                typ = v[0]
                fn = struct.unpack_from('<H', v, 8)[0]
                p1, p2 = u32(v, 12), u32(v, 16)
                val = struct.unpack_from('<f', v, 4)[0]
                c = {'fn': fn, 'name': FUNCS.get(fn, '#%d' % fn), 'op': OPS[(typ >> 5) & 7] if (typ >> 5) < 6 else '?', 'value': round(val, 3), 'or': bool(typ & 1)}
                if fn in (448, 69, 47, 59, 58, 74, 182, 264, 130):
                    pk = src(p, p1)
                    c['param'] = edid.get(pk) or desc(pk)
                    c['paramKey'] = desc(pk)
                if fn in (59, 58):
                    c['stage'] = p2
                r['conds'].append(c)
        return r

    wanted = []
    if a.list:
        rows = []
        for line in open(a.list, encoding='utf-8'):
            f = line.split(' | ')
            if len(f) > 3 and '->' in f[1] and '.es' in f[1]:
                rows.append((f[0].strip(), f[1].split('->')[0].strip().lower()))
        by = collections.defaultdict(list)
        for k, v in rec.items():
            if v[0] == 'COBJ':
                by[(v[1], chain[k][0])].append(k)
        for e, o in rows:
            ks = by.get((e, o), [])
            if len(ks) != 1:
                print('recipe not found once:', e, o, len(ks), file=sys.stderr)
            wanted += ks[:1]
    for pl in [x.strip().lower() for x in a.plugins.split(',') if x.strip()]:
        wanted += [k for k, v in rec.items() if v[0] == 'COBJ' and chain[k][0] == pl and k not in wanted]
    all_recipes = {k: parse_cobj(k) for k, v in rec.items() if v[0] == 'COBJ'}

    # ---- places ---------------------------------------------------------------------------------------------------
    regions = jl('regions.json', {})
    rplaces = regions.get('places', {})
    def nd(d):
        h, pl = d.split(':', 1)
        return '%x:%s' % (int(h, 16), pl.lower())
    rcells = {nd(k): v for k, v in (rplaces.get('cells') or {}).items()}
    rworlds = {nd(k): v for k, v in (rplaces.get('worlds') or {}).items()}
    rplug = {k.lower(): v for k, v in (rplaces.get('plugins') or {}).items()}
    border = pt.get('border') or {}
    poly = border.get('points') or []
    bworld = nd(border['world']) if border.get('world') else ''

    def inside(x, y):
        c = False
        for i in range(len(poly)):
            (x1, y1), (x2, y2) = poly[i], poly[i - 1]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                c = not c
        return c

    def prov_of(dsc, plugin):
        e = rcells.get(dsc) or rworlds.get(dsc)
        v = e.get('p') if e else rplug.get(plugin)
        v = v[0] if isinstance(v, list) and v else v
        return v or 'skyrim'

    place_memo = {}
    def place(world, cell, pos):
        """'skyrim' | 'bruma' | 'hub' | 'closed'"""
        k = world or cell
        if not k:
            return 'closed'
        if world:
            key = ('W', world, None if desc(world).lower() != bworld else (pos and inside(pos[0] / 4096, pos[1] / 4096)))
        else:
            key = ('C', cell, None)
        if key in place_memo:
            return place_memo[key]
        dsc = desc(k).lower()
        plugin = k[0]
        if plugin in closed:
            r = 'closed'
        elif plugin == 'dragonbreak hub.esp':
            r = 'hub'
        elif world and dsc == bworld:
            r = 'bruma' if key[2] else 'closed'
        else:
            pv = prov_of(dsc, plugin)
            r = 'bruma' if pv == 'cyrodiil' else 'hub' if pv == 'none' else 'closed' if pv == 'solstheim' else 'skyrim'
        place_memo[key] = r
        return r

    # ---- labour, flora, benches: the placed references ------------------------------------------------------------
    skills = jl('skills.json', {})
    def find(o, key):
        if isinstance(o, dict):
            if key in o:
                return o[key]
            for v in o.values():
                r = find(v, key)
                if r is not None:
                    return r
        if isinstance(o, list):
            for v in o:
                r = find(v, key)
                if r is not None:
                    return r
        return None
    ore_by_tier = find(skills, 'oreByTier') or []
    gcfg = jl('gamemode-config.json', {})
    lab = gcfg.get('labour', {})
    labsrc = open(os.path.join(SERVER, 'labour.js')).read()
    extra = dict(re.findall(r'(\w+): (\d)', re.search(r'extraOreTier: \{([^}]*)\}', labsrc).group(1)))
    extra.update(lab.get('extraOreTier') or {})
    mineable = {o.lower() for t in ore_by_tier for o in t} | {o.lower() for o in extra}
    items_js = dict(re.findall(r"^\s+(\w+): '([0-9a-f]+:[^']+)'", labsrc[labsrc.index('const ITEMS'):labsrc.index('CFG.gemOre || {}, CFG.items')], re.M))
    gem_ore = dict(re.findall(r"(\w+): '([0-9a-f]+:[^']+)'", re.search(r'gemOre: \{([^}]*)\}', labsrc).group(1)))
    items_js.update(lab.get('items') or {})
    gem_ore.update(lab.get('gemOre') or {})

    def key_of(d):
        i = d.index(':')
        return (d[i + 1:].lower(), int(d[:i], 16) & 0xFFFFFF)

    def ore_of(e):
        m = re.match(r'^(CYR|DLC2|BSK|BSBM)?MineOre([A-Za-z]+?)(?:\d|_|$)', e)
        if not m:
            return ''
        o = m.group(2).lower()
        o = 'geode' if o == 'blackreach' else o
        return o if m.group(1) != 'BSBM' else o + '(BSBM, not labour.js)'

    def node_of(e):
        if re.search('SeaSalt', e, re.I):
            return 'salt'
        m = re.match(r'^(?:CYR|BSK)MineGem([A-Za-z]+?)\d', e, re.I)
        return m.group(1).lower() if m and m.group(1).lower() in gem_ore else ''

    node_base, flora_base, furn_kw = {}, {}, {}
    for k, (t, e, subs, p) in rec.items():
        if t == 'ACTI':
            o = ore_of(e) or node_of(e)
            if o:
                node_base[k] = o
        elif t in ('FLOR', 'TREE'):
            for s, v in subs:
                if s == b'PFIG' and len(v) >= 4:
                    flora_base[k] = ref(p, v)
        elif t == 'FURN':
            kws = []
            for s, v in subs:
                if s == b'KWDA':
                    kws = [ref(p, v, i) for i in range(0, len(v) - 3, 4)]
            kws = [x for x in kws if x and edid.get(x, '').startswith(('Crafting', 'MCE_', 'isGrain', 'BYOH', 'CYRCrafting', 'DLC1', 'DLC2', 'Camping', 'CraftType', 'isBlacksmith', 'isSmelter', 'isTanning'))]
            if kws:
                furn_kw[k] = kws
    nodes = collections.defaultdict(collections.Counter)
    flora = collections.defaultdict(collections.Counter)
    benches = collections.defaultdict(collections.Counter)      # bench keyword key -> place kind -> placed
    bench_where = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))   # kw -> kind -> cell/world edid
    seen = {}
    for p in plugins:
        for t, fid, fl, off, sz, ctx in p.index:
            if t != 'REFR':
                continue
            k = src(p, fid)
            d = p.data_at(p.fh, off, sz, fl)
            base = pos = None
            for s, v in esplib.subrecords(d):
                if s == b'NAME' and len(v) >= 4:
                    base = ref(p, v)
                elif s == b'DATA' and len(v) >= 12:
                    pos = struct.unpack_from('<3f', v)
            if base not in node_base and base not in flora_base and base not in furn_kw:
                seen.pop(k, None)
                continue
            if fl & (DELETED | DISABLED):
                seen.pop(k, None)
                continue
            w, c, g = ctx
            seen[k] = (base, src(p, w) if w else None, src(p, c) if c else None, pos)
    by_ref = {key_of(d): o for d, o in (lab.get('oreByRef') or dict(re.findall(r"'([0-9a-f]+:[^']+)': '(\w+)'", labsrc[labsrc.index('oreByRef: {'):labsrc.index('\n    },', labsrc.index('oreByRef: {'))]))).items()}
    for k, (base, w, c, pos) in seen.items():
        kind = place(w, None, pos) if w else place(None, c, pos)
        if k in by_ref:
            nodes[by_ref[k]][kind] += 1
        elif base in node_base:
            nodes[node_base[base]][kind] += 1
        elif base in flora_base:
            flora[flora_base[base]][kind] += 1
        if base in furn_kw:
            for kw in furn_kw[base]:
                benches[kw][kind] += 1
                bench_where[kw][kind][edid.get(c if (c and not w) else w, '?')] += 1

    # ---- sources --------------------------------------------------------------------------------------------------
    sources = collections.defaultdict(list)

    def add(k, kind, detail, st):
        if k:
            sources[k].append((kind, detail, st))

    def best_of(counter):
        return 'SKYRIM' if counter.get('skyrim') else 'BRUMA' if counter.get('bruma') else 'CLOSED' if counter.get('closed') else 'NONE'

    for ore, d in list(items_js.items()) + list(gem_ore.items()):
        k = key_of(d)
        if ore == 'firewood':
            add(k, 'wood', 'chopping blocks', 'SKYRIM')
            continue
        if ore == 'charcoal':
            continue
        cnt = nodes.get(ore, collections.Counter())
        if ore in gem_ore or ore == 'salt' or ore in mineable:
            add(k, 'mine', '%s: %d in open Skyrim, %d in Bruma, %d closed' % (ore, cnt['skyrim'], cnt['bruma'], cnt['closed']), best_of(cnt))
        elif sum(cnt.values()):
            add(k, 'mine', '%s: %d nodes but not in oreByTier, so not mineable' % (ore, sum(cnt.values())), 'NONE')
    for ing, cnt in flora.items():
        add(ing, 'flora', '%d placed in open Skyrim, %d in Bruma' % (cnt['skyrim'], cnt['bruma']), best_of(cnt))
    for d in jl('pelt-values.json', {}):
        if ':' in d:
            plug, loc = d.split(':', 1)
            add((plug.lower(), int(loc, 16) & 0xFFFFFF), 'skin', 'skinning', 'SKYRIM')
    lt = open(os.path.join(SERVER, 'loottiers.js')).read()
    loot_only = {key_of(d) for d in re.findall(r"'([0-9a-f]+:[^']+\.es[mp])'", lt[lt.index('LOOT_ONLY_METALS'):lt.index('LOOT_ONLY_METALS') + 4000])}
    swap = jl('gear-swap.json', {})
    never = {key_of(d) for d in (swap.get('metals') or {}) if ':' in d} | loot_only
    DESC = re.compile(r'"([0-9a-fA-F]{1,8}:[^"]+?\.es[mpl])"')
    dm = jl('dragon-materials.json', {})
    dragon = {key_of(d) for d in DESC.findall(json.dumps(dm.get('materials', [])))}
    never |= dragon

    def lvl_items(k, depth=0, acc=None):
        acc = set() if acc is None else acc
        r = rec.get(k)
        if not r or depth > 8:
            return acc
        t, e, subs, p = r
        if t in ITEM_T:
            acc.add(k)
        elif t == 'LVLI':
            for s, v in subs:
                if s == b'LVLO' and len(v) >= 8:
                    lvl_items(ref(p, v, 4), depth + 1, acc)
        return acc

    def npc_drops(k, depth=0):
        r = rec.get(k)
        out = set()
        if not r or depth > 6:
            return out
        t, e, subs, p = r
        if t == 'LVLN':
            for s, v in subs:
                if s == b'LVLO' and len(v) >= 8:
                    out |= npc_drops(ref(p, v, 4), depth + 1)
            return out
        if t != 'NPC_':
            return out
        for s, v in subs:
            if s == b'CNTO' and len(v) >= 8:
                out |= lvl_items(ref(p, v))
            elif s == b'INAM' and len(v) >= 4:
                out |= lvl_items(ref(p, v))
        return out

    for pl in jl('wildlife.json', {}).get('placements', []):
        world = pl.get('world', '')
        pos = pl.get('pos') or [0, 0]
        wk = key_of(world) if ':' in world else None
        kind = place(wk, None, pos) if wk else 'closed'
        st = {'skyrim': 'SKYRIM', 'bruma': 'BRUMA'}.get(kind, 'CLOSED')
        for d in set(DESC.findall(json.dumps(pl))):
            for it in npc_drops(key_of(d)) - never:
                add(it, 'body', '%s (%s)' % (pl.get('kind', 'creature'), edid.get(key_of(d), d)), st)
    for fam_name, fam in ((jl('dungeon-pools.json', {}).get('families')) or {}).items():
        st = 'SKYRIM' if fam_name.startswith('skyrim') else 'BRUMA' if fam_name.startswith('cyrodiil') else 'CLOSED'
        for d in set(DESC.findall(json.dumps(fam))):
            for it in npc_drops(key_of(d)) - never:
                add(it, 'body', 'dungeon %s (%s)' % (fam_name, edid.get(key_of(d), d)), st)
    for pool, its in (jl('loot.json', {}).get('pools') or {}).items():
        for it in its:
            k = key_of(it['id'])
            if k in never:
                continue
            pv = it.get('p') or ['skyrim', 'cyrodiil']
            add(k, 'loot', 'loot.json ' + pool, 'SKYRIM' if 'skyrim' in pv else 'BRUMA' if 'cyrodiil' in pv else 'CLOSED')
    for k in dragon:
        add(k, 'dragon', "a slain dragon's body only (Nate, 30 Sep); no dragon spawns yet", 'NONE')
    salvage_from = collections.defaultdict(set)
    for gear, (station, tier, mats) in (jl('salvage.json', {}).get('items') or {}).items():
        for m, n in mats:
            if key_of(m) not in never:
                salvage_from[key_of(m)].add(key_of(gear))

    def is_source(r):
        b = edid.get(r['bench'], '') if r['bench'] else ''
        if re.match(r'CraftingSmithing(ArmorTable|SharpeningWheel)$', b):
            return False
        return not (b == 'CraftingSmelter' and any(rec.get(i, ('',))[0] in ('WEAP', 'ARMO') for i, n in r['inputs']))
    by_product = collections.defaultdict(list)
    for r in all_recipes.values():
        if r['product'] and is_source(r) and all(i for i, n in r['inputs']):
            by_product[r['product']].append(r)

    def base_status(k):
        st = [RANK[s] for kind, d, s in sources.get(k, [])]
        return max(st) if st else 0
    status = {}
    for _ in range(14):
        changed = False
        for k in set(sources) | set(by_product) | set(salvage_from):
            best = base_status(k)
            for g in salvage_from.get(k, ()):
                best = max(best, status.get(g, base_status(g)))
            for r in by_product.get(k, []):
                if r['inputs']:
                    best = max(best, min(status.get(i, base_status(i)) for i, n in r['inputs']))
            if status.get(k) != best:
                status[k] = best
                changed = True
        if not changed:
            break

    def st_of(k):
        return NAME[status.get(k, base_status(k))] if k else 'NONE'

    def how(k):
        out = ['%s: %s' % (kind, d) for kind, d, s in sources.get(k, []) if RANK[s] == status.get(k, base_status(k))][:3]
        if not out:
            out = ['made at %s (%s)' % (edid.get(r['bench'], '?'), r['edid']) for r in by_product.get(k, [])
                   if r['inputs'] and min(status.get(i, base_status(i)) for i, n in r['inputs']) == status.get(k, base_status(k))][:2]
        if not out and salvage_from.get(k):
            out = ['salvage']
        return out

    # ---- smithing families on the new order ----------------------------------------------------------------------
    scan = {'kywd': {}, 'items': {}, 'misc': {}, 'recipes': {}}
    for k, (t, e, subs, p) in rec.items():
        if t == 'KYWD':
            scan['kywd'][desc(k)] = e
        elif t == 'MISC':
            scan['misc'][desc(k)] = e
        elif t in ('WEAP', 'ARMO'):
            kw, tmpl = [], None
            for s, v in subs:
                if s == b'KWDA':
                    kw = [desc(ref(p, v, i)) for i in range(0, len(v) - 3, 4) if ref(p, v, i)]
                elif (s == b'CNAM' and t == 'WEAP') or (s == b'TNAM' and t == 'ARMO'):
                    tmpl = desc(ref(p, v)) or None
            scan['items'][desc(k)] = {'sig': t, 'edid': e, 'kw': kw, 'tmpl': tmpl}
    for k, r in all_recipes.items():
        scan['recipes'][desc(k)] = {'product': desc(r['product']) or None, 'bench': desc(r['bench']) or None, 'inputs': [[desc(i) or None, n] for i, n in r['inputs']]}
    if a.scan:
        json.dump(scan, open(a.scan, 'w'))
    import loot_materials
    I, classify = loot_materials.classifier(scan)
    smithing = jl('smithing.json', {}).get('families', [])
    fam_by = {f['id']: f for f in smithing}
    sm_cfg = gcfg.get('smithing', {})
    drop_fams = collections.defaultdict(set)
    for where, rule in (sm_cfg.get('drops') or {}).items():
        for fam in re.findall(r'"families": \[([^\]]*)\]', json.dumps(rule)):
            for f in re.findall(r'"(\w+)"', fam):
                drop_fams[f].add(where)
    for row in (sm_cfg.get('discovery') or {}).get('rows', []):
        for f in row.get('families', []):
            drop_fams[f].add('reading:' + row.get('id', '?') + (('@' + row['where']) if row.get('where') else ''))
    perk_tiers = (gcfg.get('craftPerkTiers') or {}).get('perks') or {}

    # ---- regions.js's verdict ------------------------------------------------------------------------------------
    ovr = jl('regions-overrides.json', {})
    ovr_rec = {(nd(k) if ':' in k else k.lower()): v for k, v in (ovr.get('recipes') or {}).items() if not k.startswith('_')}
    ovr_never = {(nd(k) if ':' in k else k.lower()): v for k, v in (ovr.get('forgeNever') or {}).items() if not k.startswith('_')}
    rrec = {nd(k): v for k, v in (regions.get('recipes') or {}).items()}
    ovr_plug = {k.lower(): v for k, v in (ovr.get('recipePlugins') or {}).items() if not k.startswith('_')}

    def region_of(r):
        d = desc(r['key']).lower()
        e = rrec.get(d)
        o = ovr_rec.get(d)
        if o is None and e:
            o = ovr_rec.get(r['edid'].lower())
        if o is not None:
            return {'p': o if not isinstance(o, dict) else o.get('p'), 'why': 'override', 'c': (o.get('c') if isinstance(o, dict) else None) or (e or {}).get('c')}
        if e:
            return {'p': e.get('p'), 'why': e.get('why'), 'c': e.get('c')}
        rule = ovr_plug.get(r['key'][0])
        if rule is not None and not re.match(r'CraftingSmithing(ArmorTable|SharpeningWheel)$', edid.get(r['bench'], '')):
            for x in (rule if isinstance(rule, list) else [rule]):
                if (x.get('edid') and not re.search(x['edid'], r['edid'], re.I)) or (x.get('notEdid') and re.search(x['notEdid'], r['edid'], re.I)):
                    continue
                return {'p': x.get('p'), 'c': x.get('c'), 'why': 'recipePlugins'}
        return {'p': None, 'why': 'no entry: failOpen allows it everywhere' if not re.match(r'CraftingSmithing(ArmorTable|SharpeningWheel)$', edid.get(r['bench'], '')) else 'tempering: no province rule'}

    race_rules = (gcfg.get('raceCraft') or {}).get('rules') or []
    def race_rule(prod):
        if not prod:
            return None
        e = edid.get(prod, '')
        for x in race_rules:
            pl = [y.lower() for y in x.get('plugins') or []]
            if pl and prod[0] not in pl:
                continue
            if x.get('edid') and not re.search(x['edid'], e):
                continue
            if pl or x.get('edid'):
                return {'id': x.get('id'), 'races': x.get('races')}
        return None

    # ---- the rows ------------------------------------------------------------------------------------------------
    out = []
    for k in wanted:
        r = all_recipes[k]
        bench = edid.get(r['bench'], '(none: forge)') if r['bench'] else '(none: forge)'
        bk = r['bench']
        if not bk:
            bk = next((x for x, e in edid.items() if e == 'CraftingSmithingForge'), None)
        bcount = dict(benches.get(bk, {}))
        ins = []
        for i, n in r['inputs']:
            ins.append({'item': desc(i) if i else None, 'edid': edid.get(i, '?') if i else '?', 'type': rec.get(i, ('?',))[0] if i else '?', 'count': n,
                        'status': st_of(i), 'how': how(i) if i else []})
        prod = r['product']
        fam = classify(loot_materials.canon(desc(prod))) if prod and rec.get(prod, ('',))[0] in ('WEAP', 'ARMO') else None
        sf = fam_by.get(fam) if fam else None
        races = [c for c in r['conds'] if c['fn'] == 69]
        perks = [c for c in r['conds'] if c['fn'] == 448]
        unknown = [c for c in r['conds'] if c['fn'] not in IMPLEMENTED]
        out.append({
            'recipe': r['edid'], 'id': r['id'], 'origin': proper.get(r['origin'], r['origin']), 'winner': proper.get(r['winner'], r['winner']),
            'bench': bench, 'benches': bcount, 'benchWhere': {kk: dict(v.most_common(4)) for kk, v in bench_where.get(bk, {}).items()},
            'product': {'id': desc(prod), 'edid': edid.get(prod, '?'), 'type': rec.get(prod, ('?',))[0] if prod else '?'}, 'count': r['count'],
            'inputs': ins, 'unresolved': r['unresolved'], 'conditions': r['conds'],
            'race': [('%s %s' % (c['param'], 'OR' if c['or'] else 'AND')) for c in races],
            'perks': [{'perk': c['param'], 'tier': perk_tiers.get(c['param'])} for c in perks],
            'unknownConditions': [{'fn': c['name'], 'param': c.get('param'), 'stage': c.get('stage'), 'op': c['op'], 'value': c['value']} for c in unknown],
            'family': fam, 'smithing': ({'tier': sf.get('tier'), 'free': bool(sf.get('free')), 'technique': sf.get('technique'), 'raceFree': sf.get('raceFree'),
                                         'book': sf.get('book'), 'bookId': sf.get('bookId'), 'drops': sorted(drop_fams.get((sf.get('technique') or fam), set()))} if sf else None),
            'region': region_of(r), 'raceCraft': race_rule(prod), 'forgeNever': ovr_never.get(desc(prod).lower()) or ovr_never.get(edid.get(prod, '').lower()),
        })
    bench_summary = {edid.get(kw, desc(kw)): {'placed': dict(c), 'where': {kk: dict(v.most_common(6)) for kk, v in bench_where[kw].items()}} for kw, c in benches.items()}
    json.dump({'order': len(order), 'missing': missing, 'closed': sorted(closed), 'recipes': out, 'benches': bench_summary,
               'nodes': {o: dict(c) for o, c in nodes.items()}}, open(a.json, 'w'), indent=1)
    print('%d recipes -> %s; %d plugins (%d missing)' % (len(out), a.json, len(plugins), len(missing)), file=sys.stderr)


if __name__ == '__main__':
    main()
