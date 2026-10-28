#!/usr/bin/env python3
# mod-0422 restore plan generator (read-only on evidence and live state; writes only under mod0422/restore/).
# Usage: python3 -I build_plan.py [out_plan.json] [out_table.tsv] [--gold=treasury|count] [--no-fungible] [--stale-ok]
#   --gold=   Jake's choice of where the 2095 gold comes back from (plan.gold.choices); without it the plan has no gold order
#             and an apply is refused until the run file sets "goldOrder"
#   --no-fungible  only the strict trace (see Fungible below)
#
# What the player is owed: the 21 Oct 00:01Z backup of strongbox 080680F9, chest 08002D18 and chest 08002D16 (5598 items,
# 2095 gold), ids moved to the live load order (0x48 -> 0x49 for DragonBreak Online Edits.esp).
# What the Steward took on 24 Oct 02:17:53Z: barrels 08002D26/27 in the 24 Oct 00:01Z backup (untouched 21-24 Oct). The
# player's part of a base is min(barrels, owed); the rest of the barrels (40 items) was the Count's and the Steward's own.
# What may be taken back from each Bruma Castle container C (0806E2D9, 0806FAA4, 0806EA2E; 0807284D is left alone): a
# time-ordered, court-favourable trace of every plain unit, per base, through the Steward's pack and the three containers:
#   seeds     the player's units in the barrels at T0 (the 24 Oct 02:17:53Z take), and the player's units he took from the
#             house (or the barrels) straight into his pack from the 21 Oct 00:01Z backup on and still held at T0 (any of
#             that base leaving his pack in between is taken to be the player's first; a snapshot caps it)
#   level T0  each container's 24 Oct 00:01Z count plus every logged move into or out of it before T0: never the player's
#   his pack  own units at T0 = his pack before the barrel take (or before his first later move of the base, or his last
#             snapshot, whichever is more) less the player's units in it
#   his put into C: his own units first, then the player's; a unit of no known origin counts as his own
#   his take from C, anyone else's take from C, a loss no move explains: the player's units leave first
#   anything leaving his pack elsewhere (0807284D, a trade, a drop, eating, a sale): the player's units first
#   anything coming in (loot, trade, a grant, a take from another container, a snapshot or his live pack showing more than
#   the trace): his own. Anyone else's put into C: not the player's
#   a move a container summary (container:close) shows and no item.move logged: in the trace at the summary's time (24 Oct
#   10:53Z: 77 Torches into 0806E2D9; LIKELY, flagged). A rise still unexplained at the end is someone's own, or his put
#   when his traced pack still covers it (LIKELY, flagged)
#   take_C(b) = the player's units the trace leaves in C; keep_C(b) = the rest (level at T0 and every unit that may be his
#   or anyone's own); keep + take = the count seen. Nothing of his own can be taken under any order of units.
# Fungible (PROVEN by count, flagged): plain units of a base are alike. Where the trace leaves some of the player's units
# unrecovered and some of his own units of that base in C, more is taken when what he still holds of the base afterwards
# (his live pack, any extra data, his net puts into 0807284D, his own units left in C) is at least every unit he could ever
# have owned (his pack at T0 and every inflow). 28 Oct: the Katana, the Jade Ring, 2 Potions of Stamina, 1 Poison, 1 Torch.
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
# Where the gold comes back from: Jake's choice (28 Oct F1). With no --gold= the plan has no order and an apply is refused
# until the run file sets "goldOrder" to one of these.
GOLD_CHOICES = {
    'treasury': {'order': ['treasury:bruma'], 'note': 'the Bruma treasury, where the Count paid the 2099 on 24 Oct 03:22Z (PROVEN); the Count\'s pack and bank untouched; nothing minted while the treasury holds 2095'},
    'count': {'order': ['inventory', 'bank'], 'note': 'the Count\'s pack, then his bank account; the rest minted (he holds a few hundred, so about 1,600 new gold while the 2099 stays in the treasury)'},
}
GOLD_PICK = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--gold=')), None)
if GOLD_PICK is not None and GOLD_PICK not in GOLD_CHOICES: sys.exit('--gold= takes one of %s' % ', '.join(GOLD_CHOICES))
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
T21 = int(datetime.datetime(2026, 10, 21, 0, 1, 53, tzinfo=datetime.UTC).timestamp() * 1000)
name2desc = {}
for x in refund: name2desc.setdefault(x['name'], set()).add(x['desc'])
def base_of(it):
    if it.get('b'):
        try: return id_of(it['b'])
        except Exception: return None
    d = name2desc.get(it.get('i') or '')
    if d and len(d) == 1: return id_of(next(iter(d)))
    return None
def plain_it(it): return not it.get('x')
_ev = os.path.join(M, 'restore', 'ev')
EV = os.environ.get('M0422_EV') or (os.path.join(_ev, 'castle.jsonl') if os.path.exists(os.path.join(_ev, 'castle.jsonl')) else os.path.join(M, 'skeptic', 'ev.jsonl'))  # moves on the castle refs (refresh_events.py: ev/castle.jsonl)
STW = os.environ.get('M0422_STW') or (os.path.join(_ev, 'steward.jsonl') if os.path.exists(os.path.join(_ev, 'steward.jsonl')) else os.path.join(M, 'items', 'plog-steward-count-items-24-27.jsonl'))  # the Steward's and the Count's item events
STWPRE = os.environ.get('M0422_STW_PRE') or os.path.join(_ev, 'steward-pre.jsonl')  # the Steward's item events 21 Oct 00:01:53Z - 24 Oct 00:00Z
if not os.path.exists(STWPRE): sys.exit('no %s: run refresh_events.py (the 21-24 Oct events of the Steward)' % STWPRE)
stw = sorted(events(STW), key=lambda d: (d['t'], d.get('s', 0)))
T0 = next(d['t'] for d in stw if d['ev'] == 'item.move' and d.get('c') == 'A5V7' and (d.get('f') or {}).get('ref') in ('8002d26', '8002d27') and d['f']['kind'] == 'take')
LAST_EVENT = max(d['t'] for d in stw)
LAST_EVENT = max([LAST_EVENT] + [d['t'] for d in events(EV) if (d.get('f') or {}).get('ref') in S3R])
for r, _ in S3:  # a container written after the last event read: some move is missing, the plan would guess
    mt = os.path.getmtime(os.path.join('/opt/skymp-state/world/changeForms', '%s_BSHeartland.esm.json' % r)) * 1000
    if mt > LAST_EVENT + 120000 and '--stale-ok' not in sys.argv:
        sys.exit('080%s was written at %s, after the last event read (%s): run refresh_events.py and set M0422_EV/M0422_STW' % (
            r, datetime.datetime.fromtimestamp(mt / 1000, datetime.UTC).isoformat(), datetime.datetime.fromtimestamp(LAST_EVENT / 1000, datetime.UTC).isoformat()))
# every event once (the extracts overlap), in order
_seen = set(); ALL = []
for path_ in (STWPRE, EV, STW):
    for d in events(path_):
        key = (d['t'], d.get('s'), d.get('g'), d.get('c'), d['ev'])
        if key in _seen: continue
        _seen.add(key); ALL.append(d)
ALL.sort(key=lambda d: (d['t'], d.get('s', 0)))
IN_EV = ('item.loot', 'item.pickup', 'item.buy', 'item.grant', 'item.harvest', 'item.theft', 'item.income')
OUT_EV = ('item.drop', 'item.consume', 'item.sell')
def flows(d):
    # the non-move item events of one character: [(base, k, +1 into the pack | -1 out of it)], plain units only
    f = d.get('f') or {}; ev = d['ev']; lst = []
    if ev == 'item.trade': lst = [(x, 1) for x in f.get('got') or []] + [(x, -1) for x in f.get('gave') or []]
    elif ev in IN_EV or ev in OUT_EV:
        sg = 1 if ev in IN_EV else -1
        lst = [(x, sg) for x in (f.get('items') or []) + ([f['item']] if isinstance(f.get('item'), dict) else [])]
    elif ev == 'item.relog':  # the pack grew at a relog with no logged move
        for x in f.get('grew') or []:
            pk = x.get('pack') or [0, 0]
            if len(pk) == 2 and int(pk[1]) > int(pk[0]): lst.append((dict(x, k=int(pk[1]) - int(pk[0])), 1))
    out = []
    for it, sg in lst:
        if not plain_it(it): continue
        b = base_of(it)
        if b is not None: out.append((b, int(it.get('k') or 1), sg))
    return out
def snapshot_of(d):
    c = collections.Counter()
    for it in (d.get('f') or {}).get('items') or []:
        if not plain_it(it): continue
        b = base_of(it)
        if b is not None: c[b] += int(it.get('k') or 0)
    return c
PLAYER_REFS = ('80680f9', '8002d18', '8002d16', '8002d26', '8002d27')

# ---- the player's units he took straight into his pack before T0 (21 Oct 00:01Z on) --------------------------------
direct = collections.Counter(); direct_took = collections.Counter(); last_snap_pre = collections.Counter()
for d in ALL:
    if d['t'] < T21 or d['t'] >= T0 or d.get('c') != 'A5V7': continue
    f = d.get('f') or {}; ev = d['ev']
    if ev == 'item.move':
        it = f.get('item') or {}; b = base_of(it); k = int(it.get('k') or 0)
        if b is None or k <= 0 or not plain_it(it): continue
        if f['kind'] == 'take' and f.get('ref') in PLAYER_REFS: direct[b] += k; direct_took[b] += k
        elif f['kind'] == 'put': direct[b] -= min(direct[b], k)  # into the barrels, 0807284D or anywhere: the player's first
    elif ev == 'item.snapshot':
        sn = snapshot_of(d); last_snap_pre = sn
        for b in list(direct): direct[b] = min(direct[b], sn.get(b, 0))
    else:
        for b, k, sg in flows(d):
            if sg < 0: direct[b] -= min(direct[b], k)
direct = {b: min(n, max(0, owed_plain.get(b, 0) - player_in_barrels.get(b, 0))) for b, n in direct.items() if n > 0}
direct = {b: n for b, n in direct.items() if n > 0}

# ---- the containers at T0, his pack at T0 ---------------------------------------------------------------------------
level_t0 = {r: collections.Counter(pre_c[r]) for r, _ in S3}
pack_bar = {}; pack_first = {}
for d in ALL:
    if d['ev'] != 'item.move' or d['t'] < T0001: continue
    f = d.get('f') or {}; it = f.get('item') or {}; b = base_of(it); k = int(it.get('k') or 0)
    if b is None or k <= 0 or not plain_it(it): continue
    if d['t'] < T0 and f.get('ref') in S3R: level_t0[f['ref'][2:]][b] += k if f['kind'] == 'put' else -k
    if d.get('c') == 'A5V7' and d['t'] >= T0 and f.get('packBefore') is not None:
        if f.get('ref') in ('8002d26', '8002d27') and f['kind'] == 'take': pack_bar[b] = min(pack_bar.get(b, 10 ** 9), int(f['packBefore']))
        elif b not in pack_first: pack_first[b] = int(f['packBefore'])
for r, _ in S3:
    for b in list(level_t0[r]): level_t0[r][b] = max(0, level_t0[r][b])
BIG = 10 ** 6
def pack_at_t0(b):
    if b in pack_bar: return pack_bar[b]
    if b in pack_first: return max(pack_first[b], last_snap_pre.get(b, 0))
    return BIG  # never moved by him after T0: whatever it is, his own
# Moves a container summary (container:close, inferred) shows and no item.move logged: one at the summary's time. 24 Oct
# 10:53Z: 77 Torches into 0806E2D9 (with no move, while 77 left his pack); a few potions into and out of 0807284D.
synthetic = []; syn_notes = []
_mv = collections.defaultdict(list)
for d in ALL:
    f = d.get('f') or {}
    if d['ev'] == 'item.move' and d['t'] >= T0 and d.get('c') == 'A5V7': _mv[f.get('ref')].append(d)
_prev = {}
for d in ALL:
    f = d.get('f') or {}
    if d['ev'] != 'item.container' or d['t'] < T0 or d.get('c') != 'A5V7' or f.get('ref') not in S3R | {'807284d'}: continue
    # the session's moves: after his previous summary of that container, up to 3 s after this one (the summary's own
    # duration is too tight: 24 Oct 02:26:32 moves fall 1 s outside a 380 s session closed at 02:32:55)
    w0 = _prev.get(f['ref'], T0 - 1) + 1; w1 = d['t'] + 3000; _prev[f['ref']] = w1
    logged = collections.Counter()
    for m in _mv[f['ref']]:
        it = m['f'].get('item') or {}; bb = base_of(it)
        if w0 <= m['t'] <= w1 and bb is not None and plain_it(it): logged[(m['f']['kind'], bb)] += int(it.get('k') or 0)
    summ = collections.Counter()
    for kind, key in (('put', 'put'), ('take', 'took')):
        for it in f.get(key) or []:
            bb = base_of(it)
            if bb is not None and plain_it(it): summ[(kind, bb)] += int(it.get('k') or 0)
    for (kind, bb), n in summ.items():
        if n > logged[(kind, bb)]:
            synthetic.append({'t': d['t'], 's': d.get('s', 0), 'ev': 'item.move', 'c': 'A5V7', 'syn': True, 'f': {'kind': kind, 'ref': f['ref'], 'item': {'b': desc(bb), 'k': n - logged[(kind, bb)]}}})
            syn_notes.append({'at': datetime.datetime.fromtimestamp(d['t'] / 1000, datetime.UTC).strftime('%Y-%m-%dT%H:%M:%SZ'), 'ref': '0' + f['ref'], 'kind': kind, 'base': '%x' % bb, 'name': nm(bb), 'count': n - logged[(kind, bb)]})
TRACE = sorted([d for d in ALL if d['t'] >= T0] + synthetic, key=lambda d: (d['t'], d.get('s', 0)))

SEEDED = {bb for bb in set(player_in_barrels) | set(direct) if bb != GOLD and player_in_barrels.get(bb, 0) + direct.get(bb, 0) > 0}
Pp = collections.Counter(); Po = collections.Counter(); own_total = collections.Counter(); own_src = collections.defaultdict(collections.Counter)
def own_in_(b, k, why):
    Po[b] += k; own_total[b] += k; own_src[b][why] += k
def out_pack(b, k):  # leaving his pack anywhere but the three containers: the player's first
    a = min(Pp[b], k); Pp[b] -= a; Po[b] -= min(Po[b], k - a)
def sync_pack(sn, why):  # a count of his pack: more than the trace is his own; less, the player's left first
    for b in SEEDED:
        have = Pp[b] + Po[b]; n = sn.get(b, 0)
        if n > have: own_in_(b, n - have, why)
        elif n < have: out_pack(b, have - n)
Cp = {r: collections.Counter() for r, _ in S3}; Co = {r: collections.Counter(level_t0[r]) for r, _ in S3}
Ch = {r: collections.Counter() for r, _ in S3}  # his own units put into C after T0 (part of Co)
reconstructed = collections.defaultdict(collections.Counter)
s3_take_after = collections.Counter(); put7 = collections.Counter(); take7 = collections.Counter()
# T0: everything in the barrels goes into his pack (PROVEN), beside what he already held
for bb in SEEDED:
    o0 = max(0, pack_at_t0(bb) - direct.get(bb, 0))
    if o0: own_in_(bb, o0, 'his pack at T0')
    Pp[bb] += player_in_barrels.get(bb, 0) + direct.get(bb, 0)
    if not_player.get(bb): own_in_(bb, not_player[bb], "not the player's, from the barrels")
for d in TRACE:
    f = d.get('f') or {}; ev = d['ev']; me = d.get('c') == 'A5V7'
    if ev == 'item.move':
        it = f.get('item') or {}; b = base_of(it); k = int(it.get('k') or 0); ref = f.get('ref'); kind = f.get('kind')
        if b is None or k <= 0 or not plain_it(it): continue
        if ref == '807284d':
            if me and kind == 'put': put7[b] += k
            elif kind == 'take': take7[b] += k
        if me and ref in ('8002d26', '8002d27') and kind == 'take': continue  # the T0 take, seeded above
        if ref in S3R:
            r = ref[2:]
            if me and kind == 'put':
                o = min(Po[b], k) if b in SEEDED else k; p_ = min(Pp[b], k - o) if b in SEEDED else 0; u = k - o - p_
                if b in SEEDED:
                    Po[b] -= o; Pp[b] -= p_
                    if u: own_total[b] += u; own_src[b]['unknown origin'] += u
                Co[r][b] += o + u; Ch[r][b] += o + u; Cp[r][b] += p_
                if d.get('syn') and p_: reconstructed[r][b] += p_
            elif kind == 'take':
                s3_take_after[b] += k
                a = min(Cp[r][b], k); Cp[r][b] -= a; rest = k - a
                Ch[r][b] -= min(Ch[r][b], rest); Co[r][b] -= min(Co[r][b], rest)
                if me and b in SEEDED: Pp[b] += a; Po[b] += rest
            else:  # someone else's put
                Co[r][b] += k
        elif me and b in SEEDED:
            if kind == 'put': out_pack(b, k)
            else: own_in_(b, k, 'take ' + str(ref))
    elif me and ev == 'item.snapshot':
        sync_pack(snapshot_of(d), 'snapshot shows more')
    elif me:
        for b, k, sg in flows(d):
            if b not in SEEDED: continue
            if sg > 0: own_in_(b, k, ev)
            else: out_pack(b, k)
# against the live containers: a loss no move explains takes the player's units first; a rise no move explains is his put
# when his traced pack still covers it (LIKELY, flagged), else someone's own
recon_notes = []
for r, _ in S3:
    for b in set(now_c[r]) | set(Cp[r]) | set(Co[r]):
        sim = Cp[r][b] + Co[r][b]; lv = now_c[r].get(b, 0)
        if lv < sim:
            loss = sim - lv; a = min(Cp[r][b], loss); Cp[r][b] -= a; Ch[r][b] -= min(Ch[r][b], loss - a); Co[r][b] -= min(Co[r][b], loss - a)
            recon_notes.append({'ref': '080' + r, 'base': '%x' % b, 'name': nm(b), 'loss': loss, 'playerUnitsDropped': a})
        elif lv > sim:
            rise = lv - sim; mine_ = min(rise, Pp[b] + Po[b]) if b in SEEDED else 0
            if mine_:
                o = min(Po[b], mine_); Po[b] -= o; p_ = mine_ - o; Pp[b] -= p_
                Co[r][b] += o; Ch[r][b] += o; Cp[r][b] += p_
                if p_: reconstructed[r][b] += p_
            if rise - mine_: Co[r][b] += rise - mine_; own_src[b]['unlogged rise in 080' + r] += rise - mine_
            recon_notes.append({'ref': '080' + r, 'base': '%x' % b, 'name': nm(b), 'rise': rise, 'countedAsHisPut': mine_})
# his live pack (the change form) last
try:
    _sp = json.load(open('/opt/skymp-state/world/changeForms/17ea.json'))
    stw_live = [dict(e) for e in ((_sp.get('inv') or {}).get('entries') or [])]
except Exception as e:
    sys.exit('the Steward\'s live change form is unreadable: %s' % e)
stw_live_plain = counts(stw_live, True); stw_live_any = counts(stw_live)
sync_pack(stw_live_plain, 'live pack shows more')
# ---- fungible: the court still holds every unit it could ever have owned ---------------------------------------------
try:
    live7 = counts(live('7284d'))
except Exception:
    live7 = collections.Counter()
fungible = collections.defaultdict(collections.Counter); fungible_notes = {}
FUNGIBLE = '--no-fungible' not in sys.argv  # --no-fungible: the strict trace only (the court-favourable minimum)
for b in sorted(set(player_in_barrels) | set(direct)) if FUNGIBLE else []:
    seeded = player_in_barrels.get(b, 0) + direct.get(b, 0)
    left = seeded - sum(Cp[r][b] for r, _ in S3)
    his_c = sum(Ch[r][b] for r, _ in S3)
    if left <= 0 or his_c <= 0 or s3_take_after.get(b) or any(x['base'] == '%x' % b for x in recon_notes): continue
    net7 = max(0, min(put7.get(b, 0) - take7.get(b, 0), live7.get(b, 0)))
    holds = stw_live_any.get(b, 0) + net7 + his_c
    spare = holds - own_total.get(b, 0)
    n = max(0, min(left, his_c, spare))
    if not n: continue
    fungible_notes['%x' % b] = {'name': nm(b), 'ownedAtMost': own_total.get(b, 0), 'holdsNow': {'pack': stw_live_any.get(b, 0), 'netPutInto0807284D': net7, 'hisInCastleContainers': his_c}, 'taken': n}
    for r, _ in sorted(S3, key=lambda x: -Ch[x[0]][b]):
        g = min(n, Ch[r][b])
        if g: Ch[r][b] -= g; Co[r][b] -= g; Cp[r][b] += g; fungible[r][b] += g; n -= g

# ---- plain take-back per container ----------------------------------------------------------------------------------
rows = []; take = {r: {} for r, _ in S3}; total = {}
for b in sorted(set(player_in_barrels) | set(direct)):
    for r, _ in S3:
        n = Cp[r][b]
        if n > 0: take[r][b] = n
    total[b] = sum(take[r].get(b, 0) for r, _ in S3)
    assert total[b] <= owed_plain.get(b, 0), (hex(b), total[b])
    rows.append((b, player_in_barrels.get(b, 0), direct.get(b, 0), {r: now_c[r].get(b, 0) for r, _ in S3}, {r: level_t0[r].get(b, 0) for r, _ in S3},
                 own_total.get(b, 0), {r: take[r].get(b, 0) for r, _ in S3}, total[b]))
own_in_src = own_src
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
    ts = [{'base': '%x' % b, 'desc': desc(b), 'name': nm(b), 'count': n, 'keep': now_c[r].get(b, 0) - n, 'seen': now_c[r].get(b, 0),
           'pre24': pre_c[r].get(b, 0), 't0': level_t0[r].get(b, 0), 'stage': stage_of(b, nm(b))[0],
           'likely': bool(reconstructed[r].get(b)), 'basis': 'fungible' if fungible[r].get(b) else ('direct' if direct.get(b) and not player_in_barrels.get(b) else 'trace')}
          for b, n in sorted(take[r].items())]
    for t in ts: assert t['keep'] >= t['t0'] and t['keep'] + t['count'] == t['seen'], t
    us = [dict(u) for u in uniques if u['container'] == '080' + r]
    for u in us: u.pop('container')
    containers.append({'ref': '080' + r, 'desc': '%s:BSHeartland.esm' % r, 'label': label, 'liveFileWritten': live_mtime[r],
                       'liveItemsAtPlan': sum(int(e['count']) for e in now[r]), 'preItems24Oct': sum(int(e['count']) for e in pre[r]),
                       'take': ts, 'uniques': us, 'totalPlain': sum(x['count'] for x in ts), 'totalUniques': sum(u['count'] for u in us)})

# notes: player goods left by rule (not in the barrels on 24 Oct, so not the Steward's 24 Oct puts)
missing_from_barrels = {b: n - bar_plain.get(b, 0) for b, n in owed_plain.items() if n > bar_plain.get(b, 0)}
pre_in_castle = {('%x' % b): {('080' + r): pre_c[r][b] for r, _ in S3 if pre_c[r].get(b)} for b in missing_from_barrels if any(pre_c[r].get(b) for r, _ in S3)}
plan = {
    'ticket': 'mod-0422', 'version': 2, 'fungible': FUNGIBLE,
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
    'gold': {'from': 'count', 'want': GOLD_WANT, 'order': GOLD_CHOICES[GOLD_PICK]['order'] if GOLD_PICK else None, 'choice': GOLD_PICK,
             'shortfall': 'mint', 'to': 'player', 'delivery': 's1', 'choices': GOLD_CHOICES,
             'note': 'The Steward traded 2099 to the Count on 24 Oct 03:22:14Z (2095 the player\'s) and the Count paid 2099 into the Bruma treasury the same minute (his bankLog and the player log item.bank, PROVEN; untagged, so never tithed). "order" is where the module takes it: inventory (his pack), bank (his account), treasury:bruma (the hold treasury, where the gold went). With no order in the plan (choice null) an apply is refused until the run file sets "goldOrder" to one of the choices: Jake picks. Fixed by the first gold step that is done. shortfall "mint" pays the player the part not found; "report" pays only what was taken.',
             'countBankLog24Oct': count_treasury()},
    'leftAlone': {'0807284d': 'the Count\'s box: the potions Stibbons #HQX4 took in good faith (he took, base for base, the 99 the Steward put there); not touched'},
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
        'directToPack': {'%x' % b: {'name': nm(b), 'tookFromHouse': direct_took.get(b, 0), 'stillHisAtT0': n} for b, n in sorted(direct.items())},
        'directToPackNote': 'the player\'s units the Steward took from the house (or the barrels) straight into his pack from 21 Oct 00:01Z on and still held at T0 (any of the base leaving his pack in between counted as the player\'s first); they follow the same trace from T0',
        'fungible': fungible_notes,
        'fungibleNote': 'taken although the trace counts them as his own put: plain units are alike, and what he still holds of the base afterwards is at least every unit he could ever have owned (PROVEN by count)',
        'unloggedMoves': syn_notes,
        'unloggedMovesNote': 'moves a container summary shows and no item.move logged, put into the trace at the summary time',
        'liveMismatches': recon_notes,
        'liveMismatchesNote': 'live counts that differ from the trace after every logged move: a loss takes the player\'s units first; a rise is someone\'s own, or his put when his traced pack covers it (flagged likely)',
        'stewardPackLikely': {'%x' % b: {'name': nm(b), 'plainInPackNow': stw_live_plain.get(b, 0), 'playersUnitsTheTraceLeavesThere': Pp[b] - sum(fungible[r].get(b, 0) for r, _ in S3)}
                              for b in sorted(SEEDED) if Pp[b] - sum(fungible[r].get(b, 0) for r, _ in S3) > 0 and stw_live_plain.get(b, 0) > 0},
        'stewardPackLikelyNote': 'player units the trace leaves in the Steward\'s own pack (LIKELY his to hold under the order of units the trace assumes; some are LIKELY the player\'s). Jake\'s decisions cover the castle containers and the Count\'s gold only: not taken, gifted instead; taking from his pack needs the owner\'s word',
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
    f.write('base\tname\tstage\tplayer_in_barrels\tdirect_to_pack\tlive_6e2d9\tlive_6faa4\tlive_6ea2e\tt0_6e2d9\tt0_6faa4\tt0_6ea2e\town_at_most\ttake_6e2d9\ttake_6faa4\ttake_6ea2e\ttake\town_sources\n')
    for b, P, D, lv, t0, oi, tk, t in rows:
        f.write('%x\t%s\t%d\t%d\t%d\t%s\t%s\t%d\t%s\t%d\t%s\n' % (b, nm(b), stage_of(b, nm(b))[0], P, D, '\t'.join(str(lv[r]) for r, _ in S3), '\t'.join(str(t0[r]) for r, _ in S3), oi,
                                                 '\t'.join(str(tk[r]) for r, _ in S3), t, '; '.join('%s %d' % kv for kv in own_in_src.get(b, {}).items())))
print(json.dumps(plan['totals'], indent=1))
print('uniques found', sum(1 for u in uniques if u['container']), 'of', len(uniques), [u['container'] for u in uniques])
print('hash', plan['hash'], 'confirm', plan['confirm'], 'bytes', os.path.getsize(OUT))
