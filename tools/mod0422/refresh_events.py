#!/usr/bin/env python3
# Rebuild the event extracts build_plan.py reads, from the player log (/var/lib/playerlog), so a plan made right before
# the run sees every move up to now. Read-only on the player log; writes restore/ev/castle.jsonl, restore/ev/steward.jsonl
# (the Steward's and the Count's item events from 24 Oct 00:00Z) and restore/ev/steward-pre.jsonl (the Steward's item events
# from the 21 Oct 00:01:53Z backup to 24 Oct 00:00Z: what he took from the house straight into his pack, and where it went).
# Who-was-near, owner and place fields (and every Discord, IP and hardware field) are dropped.
# Run with the IO gate: nice -n 19 ionice -c3 python3 -I refresh_events.py
# Then: M0422_EV=<dir>/castle.jsonl M0422_STW=<dir>/steward.jsonl python3 -I build_plan.py
import gzip, json, os, sys, glob, datetime
M = '/root/dragonbreak-jake/mod0422'
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(M, 'restore', 'ev')
PL = '/var/lib/playerlog'
REFS = ('806e2d9', '806faa4', '806ea2e', '807284d', '8002d26', '8002d27')
T0001 = int(datetime.datetime(2026, 10, 24, 0, 0, 0, tzinfo=datetime.UTC).timestamp() * 1000)
T21 = int(datetime.datetime(2026, 10, 21, 0, 1, 53, tzinfo=datetime.UTC).timestamp() * 1000)  # the 21 Oct backup
files = sorted(f for f in glob.glob(os.path.join(PL, 'archive', '2026-1*.jsonl.gz')) if '.fwd.' not in f and os.path.basename(f)[:10] >= '2026-10-21')
files += sorted(f for f in glob.glob(os.path.join(PL, 'events', '*.jsonl')) if '.fwd.' not in f)
os.makedirs(OUT, exist_ok=True)
castle = open(os.path.join(OUT, 'castle.jsonl.tmp'), 'w'); steward = open(os.path.join(OUT, 'steward.jsonl.tmp'), 'w')
pre = open(os.path.join(OUT, 'steward-pre.jsonl.tmp'), 'w')
nc = ns = npre = 0
for fn in files:
    op = gzip.open if fn.endswith('.gz') else open
    with op(fn, 'rt', errors='replace') as fh:
        for line in fh:
            hit_ref = any(r in line for r in REFS)
            hit_p = '"p": 150,' in line or '"p":150,' in line or '"p": 35,' in line or '"p":35,' in line
            if not hit_ref and not hit_p: continue
            try: d = json.loads(line)
            except Exception: continue
            if d.get('t', 0) < T21 or not str(d.get('ev', '')).startswith('item.'): continue
            for k in ('ip', 'hw', 'did', 'discord', 'd', 'o', 'nr', 'at', 'sn'): d.pop(k, None)
            f = d.get('f') or {}
            if d['t'] < T0001:
                if d.get('p') == 150: pre.write(json.dumps(d) + '\n'); npre += 1
                continue
            if d['ev'] == 'item.move' and f.get('ref') in REFS: castle.write(json.dumps(d) + '\n'); nc += 1
            if d.get('p') in (150, 35): steward.write(json.dumps(d) + '\n'); ns += 1
castle.close(); steward.close(); pre.close()
os.replace(os.path.join(OUT, 'castle.jsonl.tmp'), os.path.join(OUT, 'castle.jsonl'))
os.replace(os.path.join(OUT, 'steward.jsonl.tmp'), os.path.join(OUT, 'steward.jsonl'))
os.replace(os.path.join(OUT, 'steward-pre.jsonl.tmp'), os.path.join(OUT, 'steward-pre.jsonl'))
print('files', len(files), 'castle moves', nc, 'steward/count item events', ns, 'steward 21-24 Oct item events', npre, '->', OUT)
