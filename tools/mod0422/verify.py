#!/usr/bin/env python3
# After a mod-0422 apply: compare the ledger with the live change forms (read-only).
# Usage: python3 -I verify.py [plan.json] [ledger.json]   (defaults: restore/plan.json, /opt/skymp-state/mod0422-restore-ledger.json)
# Each mailbox letter is matched by id and its parcel compared with the ledger's letter (gold and every entry), so a letter
# of another ledger, or one changed since, shows as PARCEL MISMATCH rather than as a normal delivery.
# The change forms on disk can lag the server by a few seconds; run it a minute after the apply.
import json, os, sys, collections
M = '/root/dragonbreak-jake/mod0422'
CF = '/opt/skymp-state/world/changeForms'
plan = json.load(open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(M, 'restore', 'plan.json')))
LP = sys.argv[2] if len(sys.argv) > 2 else '/opt/skymp-state/mod0422-restore-ledger.json'
if not os.path.exists(LP): sys.exit('no ledger at %s: nothing was applied' % LP)
L = json.load(open(LP))
print('ledger plan', L.get('planHash'), 'plan', plan['hash'], 'OK' if L.get('planHash') == plan['hash'] else 'MISMATCH', '| gold order', (L.get('gold') or {}).get('order'),
      '| CLOSED by an undo at %s' % L['closed'] if L.get('closed') else '')
for k in sorted(L['steps']):
    if k.startswith('undo:') or L['steps'][k].get('status') in ('started', 'failed', 'skipped'): print('step', k, L['steps'][k].get('status'), L['steps'][k].get('error') or '')
def plain(es, b): return sum(int(e['count']) for e in es if (e['baseId'] & 0xffffffff) == b and set(e) <= {'baseId', 'count'})
def tally(items):
    c = collections.Counter()
    for e in items or []:
        x = {k: v for k, v in e.items() if k not in ('baseId', 'count', 'worn', 'wornLeft') and v is not None}
        c[(int(e['baseId']) & 0xffffffff, json.dumps(x, sort_keys=True))] += int(e.get('count') or 0)
    return c
def ents(path):
    d = json.load(open(path)); return ((d.get('inv') or {}).get('entries') or []), (d.get('dynamicFields') or {})
for c in plan['containers']:
    st = L['steps'].get('take:' + c['ref'], {})
    es, _ = ents(os.path.join(CF, '%s_BSHeartland.esm.json' % c['ref'][3:]))
    refused = {x.get('base') or x.get('uid') for x in st.get('refused', [])}
    bad = [(t['name'], plain(es, int(t['base'], 16)), t['seen'] - t['count']) for t in c['take'] if t['base'] not in refused and st.get('status') == 'done' and plain(es, int(t['base'], 16)) != t['seen'] - t['count']]
    left_u = [u['uid'] for u in c['uniques'] if any((e['baseId'] & 0xffffffff) == int(u['base'], 16) and all(e.get(k) == v for k, v in u['match'].items()) for e in es)]
    below = [(t['name'], plain(es, int(t['base'], 16)), t['keep']) for t in c['take'] if plain(es, int(t['base'], 16)) < t['keep']]
    print('%s %s: step %s; %d entries differ from seen-count (moved since?) %s; one-of-a-kind still there %s; below the kept level %s; refused %d'
          % (c['ref'], c['label'], st.get('status'), len(bad), bad[:5], left_u, below[:5], len(st.get('refused', []))))
for k in sorted(L['steps']):
    if k.startswith('gold:'): print('gold step', k, L['steps'][k].get('status'), 'n', L['steps'][k].get('n'))
es, df = ents(os.path.join(CF, '303.json'))
print('Count now: pack gold', sum(int(e['count']) for e in es if e['baseId'] == 15), 'bank', df.get('private.bankGold'))
files = {plan['actors'][k]['id']: k for k in plan['actors']}
by = collections.defaultdict(list)
for lid, lt in L['letters'].items(): by[lt['to']].append(lt)
for who, lts in by.items():
    aid = plan['actors'][who]['id'][2:].lstrip('0') or '0'
    _, df = ents(os.path.join(CF, '%s.json' % aid))
    box = {str(m.get('id')): m for m in (df.get('private.pigeons') or [])}
    for lt in sorted(lts, key=lambda x: x['id']):
        m = box.get(lt['id'])
        state = 'not in the mailbox' if not m else ('collected' if m.get('collected') or not m.get('parcel') else ('unread' if not m.get('read') else 'read, waiting'))
        # the parcel in the mailbox against the ledger's letter (gold, and every entry with its extra data)
        if m and m.get('parcel'):
            same = int(m['parcel'].get('gold') or 0) == int(lt.get('gold') or 0) and tally(m['parcel'].get('items')) == tally(lt.get('items'))
            state += ', parcel as in the ledger' if same else ', PARCEL MISMATCH (not this ledger\'s letter, or changed since)'
        if lt['status'] in ('conflict', 'failed', 'started'): state += ', LEDGER ' + lt['status'].upper() + (': ' + lt.get('note', '') if lt.get('note') else '')
        print('%-8s %-28s ledger %-8s mailbox %s; %d gold, %d items' % (who, lt['id'], lt['status'], state, lt.get('gold') or 0, sum(int(e['count']) for e in lt['items'])))
pool = L.get('pool', {})
print('queued in the ledger (stage 2 and anything held):', sum(pool.get('plain', {}).values()), 'items,', len(pool.get('uniques', {})), 'one-of-a-kind,', pool.get('gold', 0), 'gold; held', len(L.get('held', [])), 'shortfall', len(L.get('shortfall', [])))
