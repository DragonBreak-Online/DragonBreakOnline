#!/usr/bin/env python3
# Harness fixtures for tests/mod0422-restore-harness.js: the plan, and the castle containers before (24 Oct 00:01Z backup)
# and at plan time (live change forms). No player ids beyond the actor form ids and #TAGs already in the plan.
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import M, c24, live
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(M, 'restore', 'wt', 'tests', 'fixtures', 'mod0422')
def count_now():
    # the Count's pack gold and bank balance in his live change form (only these two numbers are kept)
    d = json.load(open('/opt/skymp-state/world/changeForms/303.json'))
    es = (d.get('inv') or {}).get('entries') or []
    return {'gold': sum(int(e['count']) for e in es if e['baseId'] == 15 and not e.get('worn')), 'bank': int((d.get('dynamicFields') or {}).get('private.bankGold') or 0)}
plan = json.load(open(os.path.join(M, 'restore', 'plan.json')))
refs = [c['ref'][3:] for c in plan['containers']]
world = {'note': 'mod-0422 fixtures: castle containers in the 24 Oct 00:01Z backup (c24) and in the live change forms when the plan was made (live)',
         'planHash': plan['hash'],
         'c24': {('080' + r): c24(r) for r in refs}, 'live': {('080' + r): live(r) for r in refs},
         'count': count_now()}
os.makedirs(OUT, exist_ok=True)
json.dump(plan, open(os.path.join(OUT, 'plan.json'), 'w'), separators=(',', ':'))
json.dump(world, open(os.path.join(OUT, 'world.json'), 'w'), separators=(',', ':'))
print({f: os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)})
