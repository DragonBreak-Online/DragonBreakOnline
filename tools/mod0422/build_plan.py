#!/usr/bin/env python3
# mod-0422 restore plan generator (read-only on evidence and live state; writes only under mod0422/restore/).
# Usage: python3 -I build_plan.py [out_plan.json] [out_table.tsv]
#
# What the player is owed: the 21 Oct 00:01Z backup of strongbox 080680F9, chest 08002D18 and chest 08002D16 (5598 items,
# 2095 gold), ids moved to the live load order (0x48 -> 0x49 for DragonBreak Online Edits.esp).
# What the Steward took on 24 Oct 02:17:53Z: barrels 08002D26/27 in the 24 Oct 00:01Z backup (untouched 21-24 Oct). The
# player's part of a base is min(barrels, owed); the rest of the barrels (40 items) was the Count's and the Steward's own.
# What may be taken back from each Bruma Castle container C (0806E2D9, 0806FAA4, 0806EA2E; 0807284D is left alone), per
# plain base b:
#   cap_C(b)  = min(live_C(b) - pre_C(b), puts_C(b))          pre = 24 Oct 00:01Z backup (the Steward's own level, kept)
#                                                             puts = the Steward's puts of b into C after T0 (player log)
#   total(b)  = min(player_in_barrels(b), sum_C cap_C(b), live_S(b) - pre_S(b) - own_in(b))
#   own_in(b) = every unit of b that could be the Steward's (or anyone else's) and reached the three containers after
#               00:01Z: his pack at the barrel take (packBefore), his puts into them between 00:01Z and T0, what he took
#               from any other container, looted, bought, picked up, was granted or got in trade after T0, and every
#               other character's puts into them after 00:01Z
#   The three containers then keep at least pre_S(b) + own_in(b) of b, so none of his own goods can be taken.
# The 15 one-of-a-kind entries (charge, temper, enchantment) are matched by their exact extra data.
import sys, os, json, re, hashlib, datetime, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import M, LO, desc, id_of, desc_old21, entries, snap, c24, live, extras, sig, plain, counts, events

ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
OUT = ARGS[0] if len(ARGS) > 0 else os.path.join(M, 'restore', 'plan.json')
TSV = ARGS[1] if len(ARGS) > 1 else os.path.join(M, 'restore', 'plan-table.tsv')
GOLD = 0xf
HOUSE = [('680f9', 'strongbox 080680F9'), ('2d18', 'household chest 08002D18'), ('2d16', 'chest 08002D16 (assigned to Mike Morethi #5D8L)')]
BARRELS = ['2d26', '2d27']
S3 = [('6e2d9', 'Bruma Castle barrel 0806E2D9'), ('6faa4', 'Bruma Castle container 0806FAA4'), ('6ea2e', 'Bruma Castle cupboard 0806EA2E')]
S3R = {'80' + r for r, _ in S3}
LEAVE = '807284d'  # the Count's box: Stibbons' potions, received in good faith (left alone)
ACTORS = {
    'player': {'id': 'ff000729', 'tag': 'VKRS', 'profile': 101, 'name': 'The Plague Doctor'},
    'alt': {'id': 'ff003489', 'tag': 'EBZN', 'profile': 273, 'name': 'Winter'},
    'mike': {'id': 'ff001207', 'tag': '5D8L', 'profile': 171, 'name': 'Mike Morethi'},
    'count': {'id': 'ff000303', 'tag': '8HSY', 'profile': 35, 'name': 'Count Aldemar Vaulclaire'},
    'steward': {'id': 'ff0017ea', 'tag': 'A5V7', 'profile': 150, 'name': 'Steward Carloft Fhang'},
}
MIKE = {0x8300021: 'Colovian Steel Armor', 0x8300023: 'Colovian Steel Gauntlets', 0x80c7f19: 'Boots of Mishaxhi', 0xf6f24: 'Steel Horned Helmet'}
SILVER = {0x9171b: 'Silver Necklace', 0x87833: 'Silver Emerald Necklace', 0x80aeb00: 'Silver Mace', 0x10aa19: 'Silver Sword'}
CORUNDUM = 0x5ad93
GOLD_WANT = 2095
def count_treasury():
    # the Count's bank log entries from 24 Oct 03:00Z (amounts and kinds only)
    try:
        d = json.load(open('/opt/skymp-state/world/changeForms/303.json'))
        t = int(datetime.datetime(2026, 10, 24, 3, 0, tzinfo=datetime.UTC).timestamp() * 1000)
        return [{'at': datetime.datetime.fromtimestamp(e['at'] / 1000, datetime.UTC).strftime('%Y-%m-%dT%H:%M:%SZ'), 'kind': e.get('kind'), 'amount': e.get('amount')}
                for e in (d.get('dynamicFields') or {}).get('private.bankLog') or [] if e.get('at', 0) >= t][:40]
    except Exception as e:
        return 'unreadable: %s' % e

# ---- names and stage classes -------------------------------------------------------------------------------------
refund = json.load(open(os.path.join(M, 'items', 'refund-list-21oct0001.json')))
NAME = {}
for x in refund: NAME[id_of(x['desc'])] = x['name']
cat = {}
try:
    ai = json.load(open('/opt/alduinak/build/dist/server/admin-items.json'))
    for c in ai['categories']:
        for it in c['items']:
            try: b = id_of(it[0])
            except Exception: continue
            cat.setdefault(b, c['id']); NAME.setdefault(b, it[1])
except Exception as e:
    print('admin-items.json unreadable, stage classes by name only:', e, file=sys.stderr)
STAGE1_CATS = {'Weapons', 'Enchanted Weapons', 'Armor', 'Enchanted Armor', 'Clothing', 'Jewelry', 'Arrows', 'Soul Gems'}
GEM = re.compile(r'\b(amethyst|diamond|emerald|garnet|ruby|sapphire|jade|onyx|opal|pearl|topaz|jet)\b', re.I)
def stage_of(b, name):
    c = cat.get(b)
    if c in STAGE1_CATS: return 1, c
    if GEM.search(name or '') and not re.search(r'\b(dust|ore)\b', name or '', re.I): return 1, (c or '?') + '/gem'
    return 2, c or '?'
def nm(b): return NAME.get(b) or desc(b)

# ---- owed (21 Oct 00:01Z) -----------------------------------------------------------------------------------------
owed_plain = collections.Counter(); owed_by_house = collections.defaultdict(collections.Counter); house_uniques = []
gold21 = 0
for r, label in HOUSE:
    for e in snap('20261021T000153Z', r):
        b = id_of(desc_old21(e['baseId']))
        e2 = dict(e); e2['baseId'] = b
        if b == GOLD: gold21 += int(e['count']); continue
        if plain(e2): owed_plain[b] += int(e['count']); owed_by_house[r][b] += int(e['count'])
        else: house_uniques.append((r, e2))
assert gold21 == GOLD_WANT, gold21
# Mike's four pieces (PROVEN: ITEMGUARD put by Mike Morethi #5D8L on 11 Oct 22:04, still in 08002D16 on 21 Oct)
for b in MIKE: assert owed_by_house['2d16'][b] >= 1, (hex(b), 'not in 2d16')
owed = {'mike': collections.Counter({b: 1 for b in MIKE}), 'alt': collections.Counter(), 'player': collections.Counter()}
for b, n in owed_plain.items():
    n2 = n - owed['mike'].get(b, 0)
    if b in SILVER: owed['alt'][b] += n2; continue
    if n2 > 0: owed['player'][b] += n2

# ---- taken from the barrels (24 Oct 00:01Z = what the Steward took at 02:17:53Z) ------------------------------------
bar = []
for r in BARRELS: bar += snap('20261024T000114Z', r)
bar_plain = counts(bar, only_plain=True)
bar_uniq = [e for e in bar if not plain(e)]
player_in_barrels = {b: min(n, owed_plain.get(b, 0)) for b, n in bar_plain.items() if b != GOLD}
not_player = {b: n - player_in_barrels.get(b, 0) for b, n in bar_plain.items() if b != GOLD and n > player_in_barrels.get(b, 0)}
hs = collections.Counter(sig(e) for r, e in house_uniques); bs = collections.Counter(sig(e) for e in bar_uniq)
assert hs == bs, 'the one-of-a-kind entries in the barrels differ from the house'

# ---- castle containers: before (24 Oct 00:01Z) and now -------------------------------------------------------------
pre = {r: c24(r) for r, _ in S3}; now = {r: live(r) for r, _ in S3}
pre_c = {r: counts(pre[r], True) for r in pre}; now_c = {r: counts(now[r], True) for r in now}
live_mtime = {r: datetime.datetime.fromtimestamp(os.path.getmtime(os.path.join('/opt/skymp-state/world/changeForms', '%s_BSHeartland.esm.json' % r)), datetime.UTC).strftime('%Y-%m-%dT%H:%M:%SZ') for r, _ in S3}

# ---- events ---------------------------------------------------------------------------------------------------------
T0001 = int(datetime.datetime(2026, 10, 24, 0, 1, 14, tzinfo=datetime.UTC).timestamp() * 1000)
name2desc = {}
for x in refund: name2desc.setdefault(x['name'], set()).add(x['desc'])
def base_of(it):
    if it.get('b'):
        try: return id_of(it['b'])
        except Exception: return None
    d = name2desc.get(it.get('i') or '')
    if d and len(d) == 1: return id_of(next(iter(d)))
    return None
_ev = os.path.join(M, 'restore', 'ev')
EV = os.environ.get('M0422_EV') or (os.path.join(_ev, 'castle.jsonl') if os.path.exists(os.path.join(_ev, 'castle.jsonl')) else os.path.join(M, 'skeptic', 'ev.jsonl'))  # moves on the castle refs (refresh_events.py: ev/castle.jsonl)
STW = os.environ.get('M0422_STW') or (os.path.join(_ev, 'steward.jsonl') if os.path.exists(os.path.join(_ev, 'steward.jsonl')) else os.path.join(M, 'items', 'plog-steward-count-items-24-27.jsonl'))  # the Steward's and the Count's item events
stw = sorted(events(STW), key=lambda d: (d['t'], d.get('s', 0)))
T0 = next(d['t'] for d in stw if d['ev'] == 'item.move' and d.get('c') == 'A5V7' and (d.get('f') or {}).get('ref') in ('8002d26', '8002d27') and d['f']['kind'] == 'take')
LAST_EVENT = max(d['t'] for d in stw)
LAST_EVENT = max([LAST_EVENT] + [d['t'] for d in events(EV) if (d.get('f') or {}).get('ref') in S3R])
for r, _ in S3:  # a container written after the last event read: some move is missing, the plan would guess
    mt = os.path.getmtime(os.path.join('/opt/skymp-state/world/changeForms', '%s_BSHeartland.esm.json' % r)) * 1000
    if mt > LAST_EVENT + 120000 and '--stale-ok' not in sys.argv:
        sys.exit('080%s was written at %s, after the last event read (%s): run refresh_events.py and set M0422_EV/M0422_STW' % (
            r, datetime.datetime.fromtimestamp(mt / 1000, datetime.UTC).isoformat(), datetime.datetime.fromtimestamp(LAST_EVENT / 1000, datetime.UTC).isoformat()))
pack_t0 = {}; puts_after = collections.defaultdict(collections.Counter); puts_pre_t0 = collections.Counter()
own_in_src = collections.defaultdict(collections.Counter)
for d in stw:
    if d.get('c') != 'A5V7' or d['t'] < T0001: continue
    f = d.get('f') or {}; ev = d['ev']
    if ev == 'item.move':
        it = f.get('item') or {}; b = base_of(it); k = int(it.get('k') or 0); ref = f.get('ref')
        if b is None: continue
        if ref in ('8002d26', '8002d27') and f['kind'] == 'take':
            pack_t0[b] = min(pack_t0.get(b, 10 ** 9), int(f.get('packBefore') or 0)); continue
        if ref in S3R and f['kind'] == 'put':
            if d['t'] >= T0: puts_after[ref[2:]][b] += k
            else: puts_pre_t0[b] += k
        elif f['kind'] == 'take' and ref not in S3R and d['t'] >= T0:
            own_in_src[b]['take ' + ref] += k
    elif d['t'] >= T0 and ev in ('item.loot', 'item.pickup', 'item.buy', 'item.grant', 'item.harvest', 'item.trade', 'item.theft'):
        lst = (f.get('items') or []) + (f.get('got') or []) + ([f['item']] if isinstance(f.get('item'), dict) and ev != 'item.trade' else [])
        for it in lst:
            b = base_of(it)
            if b is not None: own_in_src[b][ev] += int(it.get('k') or 1)
# every move on the three containers after 00:01Z (both extracts, de-duplicated), and the Steward's pack sequence per base
seen = set(); cmoves = collections.defaultdict(list); pmoves = collections.defaultdict(list); others_put = collections.Counter()
for path_ in (EV, STW):
    for d in events(path_):
        if d['ev'] != 'item.move' or d['t'] < T0001: continue
        key = (d['t'], d.get('s'), d.get('g'), d.get('c'))
        if key in seen: continue
        seen.add(key)
        f = d.get('f') or {}; it = f.get('item') or {}; b = base_of(it); k = int(it.get('k') or 0)
        if b is None: continue
        if f.get('ref') in S3R:
            cmoves[(f['ref'][2:], b)].append((d['t'], f.get('contBefore'), f.get('contAfter'), f['kind'], k, d.get('c')))
            if d.get('c') != 'A5V7' and f['kind'] == 'put': others_put[b] += k
        if d.get('c') == 'A5V7' and f.get('packBefore') is not None:
            pmoves[b].append((d['t'], int(f['packBefore']), int(f.get('packAfter') if f.get('packAfter') is not None else f['packBefore'])))
# Unlogged changes. The pack and container figures on a move (packBefore, contBefore...) are not reliable inside a burst of
# moves (24 Oct 02:35:52: four puts of one soup in one second with crossed figures), so a container's unlogged change is
# live - pre - (every logged put - every logged take) instead. 24-28 Oct: one such rise, 77 Torches into 0806E2D9 between
# 24 Oct 02:53Z and 25 Oct 03:39Z, while 77 left the Steward's pack with no logged move. A rise is counted as his put when
# his logged balance of that base (in minus out since 00:01Z) covers it; any other rise counts as maybe someone's own.
net_logged = collections.defaultdict(collections.Counter)
for (r, b), lst in cmoves.items():
    for t, cb, ca, kind, k, c in lst: net_logged[r][b] += k if kind == 'put' else -k
bal = collections.Counter()
for d in stw:
    if d.get('c') != 'A5V7' or d['t'] < T0001: continue
    f = d.get('f') or {}; ev = d['ev']
    if ev == 'item.move':
        b = base_of(f.get('item') or {})
        if b is not None: bal[b] += (1 if f['kind'] == 'take' else -1) * int(f['item'].get('k') or 0)
    elif ev in ('item.loot', 'item.pickup', 'item.buy', 'item.grant', 'item.harvest', 'item.theft', 'item.trade', 'item.drop', 'item.consume', 'item.sell'):
        sign = -1 if ev in ('item.drop', 'item.consume', 'item.sell') else 1
        lst = (f.get('items') or []) + ([f['item']] if isinstance(f.get('item'), dict) else [])
        if ev == 'item.trade': lst = [(x, 1) for x in (f.get('got') or [])] + [(x, -1) for x in (f.get('gave') or [])]
        else: lst = [(x, sign) for x in lst]
        for it, sg in lst:
            b = base_of(it)
            if b is not None: bal[b] += sg * int(it.get('k') or 1)
reconstructed = collections.defaultdict(collections.Counter)
for r, _ in S3:
    for b in set(now_c[r]) | set(pre_c[r]) | set(net_logged[r]):
        rise = now_c[r].get(b, 0) - pre_c[r].get(b, 0) - net_logged[r].get(b, 0)
        if rise <= 0: continue
        mine_ = max(0, min(rise, bal.get(b, 0) + pack_t0.get(b, 0)))
        if mine_: reconstructed[r][b] += mine_; puts_after[r][b] += mine_; bal[b] -= mine_
        if rise - mine_ > 0: own_in_src[b]['unlogged rise in 080' + r] += rise - mine_
for b, n in not_player.items(): own_in_src[b]['not the player\'s, from the barrels'] += n
for b, n in pack_t0.items():
    if n: own_in_src[b]['pack at the barrel take'] += n
for b, n in puts_pre_t0.items(): own_in_src[b]['his puts 00:01Z-T0'] += n
for b, n in others_put.items(): own_in_src[b]['puts by others'] += n
own_in ={b: sum(c.values()) for b, c in own_in_src.items()}

# ---- plain take-back per container ----------------------------------------------------------------------------------
rows = []; take = {r: {} for r, _ in S3}; total = {}
for b in sorted(player_in_barrels):
    P = player_in_barrels[b]
    if P <= 0: continue
    caps = {r: max(0, min(now_c[r].get(b, 0) - pre_c[r].get(b, 0), puts_after[r].get(b, 0))) for r, _ in S3}
    liveS = sum(now_c[r].get(b, 0) for r, _ in S3); preS = sum(pre_c[r].get(b, 0) for r, _ in S3)
    L = liveS - preS - own_in.get(b, 0)
    t = max(0, min(P, sum(caps.values()), L))
    total[b] = t; left = t
    for r, _ in sorted(S3, key=lambda x: -caps[x[0]]):
        n = min(left, caps[r])
        if n > 0: take[r][b] = n; left -= n
    rows.append((b, P, liveS, preS, own_in.get(b, 0), caps, t))

# ---- one-of-a-kind entries ------------------------------------------------------------------------------------------
uniques = []
for i, e in enumerate(sorted(bar_uniq, key=lambda e: (e['baseId'], sig(e)))):
    s = sig(e); where = None
    for r, _ in S3:
        if any(sig(x) == s and int(x['count']) >= int(e['count']) for x in now[r]): where = r; break
    in_pre = any(sig(x) == s for r, _ in S3 for x in pre[r])
    uniques.append({'uid': 'u%02d' % (i + 1), 'base': '%x' % e['baseId'], 'desc': desc(e['baseId']), 'name': nm(e['baseId']), 'count': int(e['count']),
                    'match': extras(e), 'container': ('080' + where) if where and not in_pre else None})
assert sum(u['count'] for u in uniques) == 15

# ---- route what comes back; the rest is gifted (minted) ----------------------------------------------------------
pool = collections.Counter(total)
routed = {k: collections.Counter() for k in owed}; minted = {k: collections.Counter() for k in owed}
for who in ('mike', 'alt', 'player'):  # Mike's pieces first, then the silver, then the player's own
    for b, n in sorted(owed[who].items()):
        g = min(n, pool[b]); pool[b] -= g
        if g: routed[who][b] += g
        if n - g: minted[who][b] += n - g
assert not +pool, ('recovered more than owed', dict(+pool))
uniq_missing = [u for u in uniques if not u['container']]
for u in uniq_missing: minted['player'][int(u['base'], 16)] += u['count']

def item(b, n, src):
    st, c = stage_of(b, nm(b))
    return {'base': '%x' % b, 'desc': desc(b), 'name': nm(b), 'count': n, 'src': src, 'class': c, 'stage': st}
deliveries = []
def add(key, to, stage, items, uids=(), gold=False, minted_=False, text='', maxWeight=None, maxStacks=None):
    if not items and not uids and not gold: return
    deliveries.append({'key': key, 'to': to, 'stage': stage, 'gold': gold, 'minted': minted_, 'maxWeight': maxWeight, 'maxStacks': maxStacks,
                       'text': text, 'uniques': list(uids), 'items': sorted(items, key=lambda x: (x['class'], x['name'], x['base']))})
mk = [item(b, n, 'recovered') for b, n in routed['mike'].items()] + [item(b, n, 'minted') for b, n in minted['mike'].items()]
add('mike', 'mike', 1, mk, text='Returned by staff: your armour from the chest of drawers you were given in the Bruma house you held a key to. The Bruma court moved it out on 21-24 Oct.')
al = [item(b, n, 'recovered') for b, n in routed['alt'].items()] + [item(b, n, 'minted') for b, n in minted['alt'].items()]
add('alt', 'alt', 1, al, text='Returned by staff: 4 silver pieces from The Plague Doctor\'s house in Bruma. They come to you because a vampire cannot carry silver.')
p1 = [item(b, n, 'recovered') for b, n in routed['player'].items() if stage_of(b, nm(b))[0] == 1]
p2 = [item(b, n, 'recovered') for b, n in routed['player'].items() if stage_of(b, nm(b))[0] == 2]
m1 = [item(b, n, 'minted') for b, n in minted['player'].items() if stage_of(b, nm(b))[0] == 1]
m2 = [item(b, n, 'minted') for b, n in minted['player'].items() if stage_of(b, nm(b))[0] == 2]
recovered_uids = [u['uid'] for u in uniques if u['container']]
add('s1', 'player', 1, p1, uids=recovered_uids, gold=True, maxWeight=100,
    text='Returned by staff: your gold and valuables from your house in Bruma, taken on 21-24 Oct.')
add('s1m', 'player', 1, m1, minted_=True, maxWeight=100,
    text='From staff: new copies of valuables from your house in Bruma that could not be found.')
add('s2', 'player', 2, p2, maxWeight=150, maxStacks=40,
    text='Returned by staff: the rest of the goods from your house in Bruma, taken on 21-24 Oct.')
add('s2m', 'player', 2, m2, minted_=True, maxWeight=150, maxStacks=40,
    text='From staff: new copies of goods from your house in Bruma that are gone (drunk, traded or given away).')

containers = []
for r, label in S3:
    ts = [{'base': '%x' % b, 'desc': desc(b), 'name': nm(b), 'count': n, 'keep': pre_c[r].get(b, 0), 'seen': now_c[r].get(b, 0),
           'stage': stage_of(b, nm(b))[0], 'likely': bool(reconstructed[r].get(b))}
          for b, n in sorted(take[r].items())]
    for t in ts: assert t['keep'] + t['count'] <= t['seen'], t
    us = [dict(u) for u in uniques if u['container'] == '080' + r]
    for u in us: u.pop('container')
    containers.append({'ref': '080' + r, 'desc': '%s:BSHeartland.esm' % r, 'label': label, 'liveFileWritten': live_mtime[r],
                       'liveItemsAtPlan': sum(int(e['count']) for e in now[r]), 'preItems24Oct': sum(int(e['count']) for e in pre[r]),
                       'take': ts, 'uniques': us, 'totalPlain': sum(x['count'] for x in ts), 'totalUniques': sum(u['count'] for u in us)})

# notes: player goods left by rule (not in the barrels on 24 Oct, so not the Steward's 24 Oct puts)
missing_from_barrels = {b: n - bar_plain.get(b, 0) for b, n in owed_plain.items() if n > bar_plain.get(b, 0)}
pre_in_castle = {('%x' % b): {('080' + r): pre_c[r][b] for r, _ in S3 if pre_c[r].get(b)} for b in missing_from_barrels if any(pre_c[r].get(b) for r, _ in S3)}
plan = {
    'ticket': 'mod-0422', 'version': 1,
    'generated': datetime.datetime.now(datetime.UTC).strftime('%Y-%m-%dT%H:%M:%SZ'), 'generator': 'mod0422/restore/scripts/build_plan.py',
    'decisions': 'Jake 28 Oct: originals back from the Bruma Castle containers and 2095 gold back from the Count, gift only what is gone; staged delivery (gold + valuables first, bulk later); 4 silver pieces to Winter #EBZN; Mike Morethi #5D8L gets his 4 armour pieces; the house stays in character.',
    'sources': {'owed': 'world-20261021T000153Z 080680F9 + 08002D18 + 08002D16 (load order remapped 0x48+ -> +1)',
                'barrels': 'world-20261024T000114Z 08002D26 + 08002D27', 'pre': 'world-20261024T000114Z castle containers (skeptic/c24)',
                'live': '/opt/skymp-state/world/changeForms (read at generation)', 'events': 'player log: %s + %s' % (EV, STW),
                'T0': datetime.datetime.fromtimestamp(T0 / 1000, datetime.UTC).strftime('%Y-%m-%dT%H:%M:%S.%fZ')[:-4] + 'Z',
                'lastStewardEvent': datetime.datetime.fromtimestamp(LAST_EVENT / 1000, datetime.UTC).strftime('%Y-%m-%dT%H:%M:%SZ'),
                'loadOrder': {'full': len(LO['full']), 'light': len(LO['light'])}},
    'actors': ACTORS,
    'containers': containers,
    'leftAlone': {'0807284d': 'the Count\'s box: the potions Stibbons #HQX4 took in good faith; not touched'},
    'gold': {'from': 'count', 'want': GOLD_WANT, 'order': ['inventory', 'bank'], 'shortfall': 'mint', 'to': 'player', 'delivery': 's1',
             'note': 'The Steward traded 2099 to the Count on 24 Oct 03:22:14Z (2095 the player\'s) and the Count paid 2099 into the Bruma treasury the same minute (his bankLog, PROVEN). "order" is where the module takes it: inventory (his pack), bank (his account), treasury:bruma (the hold treasury, where the gold went); the run file can set "goldOrder" until the first gold step is done. shortfall "mint" pays the player the part not found; "report" pays only what was taken.',
             'countBankLog24Oct': count_treasury()},
    'deliveries': deliveries,
    'uniques': [{k: v for k, v in u.items()} for u in uniques],
    'gifts': [dict(x, to=d['to'], delivery=d['key']) for d in deliveries if d['minted'] for x in d['items']] +
             [dict(x, to=d['to'], delivery=d['key']) for d in deliveries if not d['minted'] for x in d['items'] if x['src'] == 'minted'],
    'notes': {
        'corundumIngots': {'base': '%x' % CORUNDUM, 'in08002D18': owed_by_house['2d18'].get(CORUNDUM, 0),
                           'note': 'LIKELY partly Mike Morethi #5D8L\'s (he put Corundum Ingots in 08002D18 on 11 Oct; 21 on 13 Oct, 24 on 21 Oct). Left with #VKRS as the household goods; ask Mike.'},
        'notThePlayers': {'%x' % b: n for b, n in sorted(not_player.items())},
        'notThePlayersNote': 'in the barrels on 24 Oct but not in the house on 21 Oct: the Count\'s 37 and the Steward\'s 3 (plus 1 gold); never taken',
        'playerGoodsInCastleBefore24Oct': pre_in_castle,
        'playerGoodsInCastleBefore24OctNote': 'bases of the 112 items that left the house on 21 Oct without passing the barrels and that the castle containers already held on 24 Oct 00:01Z: by the rule (only the Steward\'s 24 Oct puts) they are not taken and are gifted instead',
        'silverAlreadyInMailbox': '#VKRS has 5 older silver parcels (18 and 24 Oct) it cannot carry; separate copies, not part of this plan',
    },
}
plan['totals'] = {
    'owedItems': sum(owed_plain.values()) + 15, 'owedGold': GOLD_WANT,
    'takePlain': sum(c['totalPlain'] for c in containers), 'takeUniques': sum(c['totalUniques'] for c in containers),
    'perContainer': {c['ref']: c['totalPlain'] + c['totalUniques'] for c in containers},
    'minted': sum(x['count'] for x in plan['gifts']),
    'byDelivery': {d['key']: {'to': d['to'], 'stage': d['stage'], 'items': sum(x['count'] for x in d['items']) + sum(u['count'] for u in uniques if u['uid'] in d['uniques']),
                              'stacks': len(d['items']) + len(d['uniques']), 'minted': sum(x['count'] for x in d['items'] if x['src'] == 'minted')} for d in deliveries},
}
body = json.dumps({k: v for k, v in plan.items() if k not in ('generated',)}, sort_keys=True)
plan['hash'] = hashlib.sha256(body.encode()).hexdigest()[:16]
plan['confirm'] = 'mod-0422-%s' % plan['hash'][:8]
json.dump(plan, open(OUT, 'w'), indent=1)
with open(TSV, 'w') as f:
    f.write('base\tname\tstage\tplayer_in_barrels\tlive_S3\tpre_S3\town_in\tcap_6e2d9\tcap_6faa4\tcap_6ea2e\ttake\town_in_sources\n')
    for b, P, liveS, preS, oi, caps, t in rows:
        f.write('%x\t%s\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%s\n' % (b, nm(b), stage_of(b, nm(b))[0], P, liveS, preS, oi, caps['6e2d9'], caps['6faa4'], caps['6ea2e'], t,
                                                       '; '.join('%s %d' % kv for kv in own_in_src.get(b, {}).items())))
print(json.dumps(plan['totals'], indent=1))
print('uniques found', sum(1 for u in uniques if u['container']), 'of', len(uniques), [u['container'] for u in uniques])
print('hash', plan['hash'], 'confirm', plan['confirm'], 'bytes', os.path.getsize(OUT))
