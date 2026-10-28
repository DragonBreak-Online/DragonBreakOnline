#!/usr/bin/env python3
# Harness fixtures for tests/mod0422-restore-harness.js: the plan, and the castle containers before (24 Oct 00:01Z backup)
# and at plan time (the change forms copied before stage 1). No player ids beyond the actor form ids and #TAGs already in the plan.
# Rebuilds the gitignored fixtures byte for byte: plan.json sha256 86e7f710..., world.json sha256 49274f8b...
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import M, c24, entries
# 'live' = the castle change forms when the plan was made, copied before stage 1 (restore/pre-apply); the live ones changed with stage 1
live = lambda r: entries(os.path.join(M, 'restore', 'pre-apply', '%s_BSHeartland.esm.json' % r))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(M, 'restore', 'wt', 'tests', 'fixtures', 'mod0422')
def count_now():
    # the Count's pack gold and bank balance when the plan was made (fixed: his live ones move; the harness checks against these)
    return {'gold': 62, 'bank': 0}
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
