#!/usr/bin/env python3
# Rebuild the two event extracts build_plan.py reads, from the player log (/var/lib/playerlog), so a plan made right before
# the run sees every move up to now. Read-only on the player log; writes restore/ev/castle.jsonl and restore/ev/steward.jsonl.
# Run with the IO gate: nice -n 19 ionice -c3 python3 -I refresh_events.py
# Then: M0422_EV=<dir>/castle.jsonl M0422_STW=<dir>/steward.jsonl python3 -I build_plan.py
import gzip, json, os, sys, glob, datetime
M = '/root/dragonbreak-jake/mod0422'
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(M, 'restore', 'ev')
PL = '/var/lib/playerlog'
REFS = ('806e2d9', '806faa4', '806ea2e', '807284d', '8002d26', '8002d27')
T0001 = int(datetime.datetime(2026, 10, 24, 0, 0, 0, tzinfo=datetime.UTC).timestamp() * 1000)
files = sorted(f for f in glob.glob(os.path.join(PL, 'archive', '2026-1*.jsonl.gz')) if '.fwd.' not in f and os.path.basename(f)[:10] >= '2026-10-24')
files += sorted(f for f in glob.glob(os.path.join(PL, 'events', '*.jsonl')) if '.fwd.' not in f)
os.makedirs(OUT, exist_ok=True)
castle = open(os.path.join(OUT, 'castle.jsonl.tmp'), 'w'); steward = open(os.path.join(OUT, 'steward.jsonl.tmp'), 'w')
nc = ns = 0
for fn in files:
    op = gzip.open if fn.endswith('.gz') else open
    with op(fn, 'rt', errors='replace') as fh:
        for line in fh:
            hit_ref = any(r in line for r in REFS)
            hit_p = '"p": 150,' in line or '"p":150,' in line or '"p": 35,' in line or '"p":35,' in line
            if not hit_ref and not hit_p: continue
            try: d = json.loads(line)
            except Exception: continue
            if d.get('t', 0) < T0001 or not str(d.get('ev', '')).startswith('item.'): continue
            for k in ('ip', 'hw', 'did', 'discord', 'd'): d.pop(k, None)
            f = d.get('f') or {}
            if d['ev'] == 'item.move' and f.get('ref') in REFS: castle.write(json.dumps(d) + '\n'); nc += 1
            if d.get('p') in (150, 35): steward.write(json.dumps(d) + '\n'); ns += 1
castle.close(); steward.close()
os.replace(os.path.join(OUT, 'castle.jsonl.tmp'), os.path.join(OUT, 'castle.jsonl'))
os.replace(os.path.join(OUT, 'steward.jsonl.tmp'), os.path.join(OUT, 'steward.jsonl'))
print('files', len(files), 'castle moves', nc, 'steward/count item events', ns, '->', OUT)
