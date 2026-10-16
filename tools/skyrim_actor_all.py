#!/usr/bin/env python3
# Skyrim NPC pass 2 (Nate, 16 Oct: "Server spawns only, like normal", as in Bruma): every plugin-placed living actor still
# enabled in open Skyrim is disabled - guards, townsfolk, merchants, children, friendly NPCs, harmless creatures and the
# 71 decision keeps of pass 1 (Ysgramor's ghosts, Vaermina's devotees, giants). Enemies and wildlife come only from the
# server's own spawns (wildlife.json, dungeon leases, Blackreach); towns stay empty until server spawns are built.
#
# The census is tools/skyrim_actor_narrow.py's (its achr-judged.json): every winning ACHR in the given 140 order that is
# not deleted, not Initially Disabled, not Starts Dead, not sunk, outside the hub and the closed lands (closedPlugins:
# judged by the cell's or world's own plugin, so a closed plugin's actor standing in an open cell is in). Cyrodiil is
# the Bruma pass's and is left out here.
#
#   build:  python3 tools/skyrim_actor_all.py build <scan dir> <list out> [--report <json out>] [--parents <txt out>]
#           every census row becomes a list line, except the exclusions (tooling/xedit-scripts/DBO_SkyrimActors2Exclusions.json);
#           line: disable|plugin|localId|baseEdid|targetPlugin|reason[ / note]
#           reason: guard, townsfolk, merchant, child, friendly, creature, kept-decision or other
#   check:  python3 tools/skyrim_actor_all.py check <scan dir>
#           0 rows left except the exclusions (used by skyrim_actor_check.py --pass2)
# Plugins are read in place: <DBO_PACKAGE>/plugins/<name>, else <DBO_DATA>/<name> (/opt/skyrim-data).
import sys, os, re, json, collections
sys.path.insert(0, os.path.expanduser('~nate/dragonbreak/ck-mcp'))
import esplib

here = os.path.dirname(os.path.abspath(__file__)); srv = os.path.dirname(here)
PKG = os.environ.get('DBO_PACKAGE', '')
DATA = os.environ.get('DBO_DATA', '/opt/skyrim-data')
EXCL = os.path.join(srv, 'tooling', 'xedit-scripts', 'DBO_SkyrimActors2Exclusions.json')
DLE, NEXUS = 'DragonBreak Online Edits.esp', 'DragonBreak Nexus Patches.esp'
VANILLA = {'skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm', 'dragonbreak.esp', 'dragonbreak online edits.esp', 'dragonbreak hub.esp', 'dragonbreak whiterun.esp'}
CYRODIIL = ('bsheartland.esm', 'bsassets.esm')
REASONS = ('guard', 'townsfolk', 'merchant', 'child', 'friendly', 'creature', 'kept-decision', 'other')
KEEP_BASE = re.compile(r'^(?:DunYsgramorsTomb_LvlGhost|DA16LvlVaerminaDevotee)')
MANNEQUIN = re.compile(r'Mannequin', re.I)
# server data that names plugin refs: which field, and why a disabled ref is fine there (checked 16 Oct)
NAMED_WHY = {
    'wildlife.json .placements[].src': 'the plugin creature wildlife.js mirrors; the zone spawns on its own anchor (.ref), never on src',
    'dungeons.json .dungeons[].zones[].npcs[].ref': "a lease's enemy spot; dungeons.js anchors on it only if the server loads it, else spawns at the baked pos (a disabled ACHR is not loaded, as for the 2,342 pass 1 disabled)",
    'blackreach.json .spots[].src': 'the plugin actor a wild:br* zone mirrors; spawned on its own anchor',
    'blackreach.json .chests[].guards[]': 'mapped to the guards\' wild:br* zones (blackreach.js), never to the plugin actor',
}


def order_of():
    lo = os.path.join(PKG, 'skyrim-data', 'loadorder.txt') if PKG else os.path.join(DATA, 'loadorder.txt')
    return [l.strip().lstrip('*') for l in open(lo, encoding='utf-8-sig') if l.strip() and not l.startswith('#')]


def path_of(n):
    q = os.path.join(PKG, 'plugins', n) if PKG else ''
    return q if q and os.path.exists(q) else os.path.join(DATA, n)


def exclusions():
    if not os.path.exists(EXCL): return {}
    return {k.lower(): v for k, v in json.load(open(EXCL)).get('refs', {}).items()}


def in_scope(r):
    return (r['place'] or ':').split(':', 1)[1] not in CYRODIIL


def reason_of(r):
    if KEEP_BASE.match(r.get('baseEdid') or ''): return 'kept-decision'
    races = set(r.get('races') or [])
    if races and races <= {'GiantRace'}: return 'kept-decision'
    if r['hostile']: return 'other'          # pass 1 disabled every hostile actor; one left is listed, not kept
    if MANNEQUIN.search(r.get('baseEdid') or ''): return 'other'
    return r['kind'] if r['kind'] in REASONS else 'other'


def named_refs():
    """{ref key: ['file field', ...]} for every hex:plugin desc in the gameplay json (tests and admin catalogues left out)."""
    out = collections.defaultdict(set)
    pat = re.compile(r'^(?:0x)?([0-9a-fA-F]{1,8}):(.+\.(?:esm|esp|esl))$', re.I)

    def walk(o, path, f):
        if isinstance(o, dict):
            for a, b in o.items(): walk(b, path + '.' + a, f)
        elif isinstance(o, list):
            for b in o: walk(b, path + '[]', f)
        elif isinstance(o, str):
            m = pat.match(o.strip())
            if m: out['%x:%s' % (int(m.group(1), 16) & 0xFFFFFF, m.group(2).lower())].add('%s %s' % (f, path))
    for f in sorted(os.listdir(srv)):
        if not f.endswith('.json') or f.startswith(('admin-', 'package')): continue
        try: walk(json.load(open(os.path.join(srv, f))), '', f)
        except Exception: pass
    return out


def plugin_keys(name, sigs):
    p = esplib.Plugin(path_of(name)); selfi = len(p.masters)
    src = lambda fid: '%x:%s' % (fid & 0xFFFFFF, (p.masters[fid >> 24] if (fid >> 24) < selfi else name).lower())
    return {(t, src(fid)) for (t, fid, fl, off, sz, ctx) in p.index if t in sigs}


def build(scan, out_list, report_path, parents_path):
    rows = [r for r in json.load(open(os.path.join(scan, 'achr-judged.json'))) if in_scope(r)]
    order = order_of(); idx = {n.lower(): i for i, n in enumerate(order)}; name = {n.lower(): n for n in order}
    NEX = idx[NEXUS.lower()]
    excl = exclusions(); named = named_refs()
    have = {DLE: plugin_keys(DLE, ('ACHR', 'CELL', 'WRLD')), NEXUS: plugin_keys(NEXUS, ('ACHR', 'CELL', 'WRLD'))}
    lines, rep, parents = [], collections.defaultdict(collections.Counter), collections.defaultdict(set)
    excluded, notes = [], collections.Counter()
    for r in sorted(rows, key=lambda r: (r['interior'], r['placeEdid'], r['ref'])):
        if 'cell' not in r: raise SystemExit('achr-judged.json predates pass 2 (no cell/ovr): rerun tools/skyrim_actor_narrow.py')
        if r['ref'] in excl:
            excluded.append({'ref': r['ref'], 'baseEdid': r['baseEdid'], 'place': r['placeEdid'], 'why': excl[r['ref']]}); continue
        loc, plug = r['ref'].split(':', 1)
        w = idx.get(r['by'].lower(), 0)
        if w > NEX: raise SystemExit('winner after Nexus Patches: %s %s' % (r['ref'], r['by']))
        tgt = NEXUS if (plug not in VANILLA and not plug.startswith('cc')) or w >= NEX else DLE
        why = reason_of(r)
        note = []
        if MANNEQUIN.search(r['baseEdid'] or ''): note.append('mannequin')
        if r['hostile']: note.append('hostile ' + r['hostile'])
        for x in sorted(named.get(r['ref'], ())):
            f = x.split(' ', 1)[0]; note.append(f + (' src' if x.endswith('.src') else ' guard' if 'guards' in x else ' spot' if x.endswith('.ref') else ''))
            notes[x] += 1
        if r['town']: note.append(r['town'])
        own = (tgt.lower() in [o.lower() for o in r.get('ovr', [])])
        if not own:   # xEdit will copy the ref, and with it the parent CELL (and WRLD) the target does not have yet
            if r['cell'] and ('CELL', r['cell']) not in have[tgt]: parents[tgt].add(('CELL', r['cell'], r['placeEdid'] if r['interior'] else ''))
            if r['world'] and ('WRLD', r['world']) not in have[tgt]: parents[tgt].add(('WRLD', r['world'], r['placeEdid']))
        rep['byReason'][why] += 1; rep['byTarget'][tgt] += 1; rep['byReasonTarget'][why + ' -> ' + ('DLE' if tgt == DLE else 'Nexus Patches')] += 1
        rep['ownRecord' if own else 'copied'][tgt] += 1
        rep['exterior' if not r['interior'] else 'interior'][why] += 1
        lines.append('disable|%s|%06X|%s|%s|%s' % (name.get(plug, plug), int(loc, 16), r['baseEdid'] or '*', tgt, (why + (': ' + ', '.join(note) if note else '')).replace('|', '/')))
    open(out_list, 'w', newline='\r\n').write('\n'.join(lines) + '\n')
    report = {'listed': len(lines), 'excluded': len(excluded), **{k: dict(v) for k, v in rep.items()},
              'excludedRefs': excluded, 'namedInServerData': {k: [v, NAMED_WHY.get(k, '?')] for k, v in sorted(notes.items())},
              'parentsToCopy': {t: len(v) for t, v in parents.items()}}
    print(json.dumps({k: v for k, v in report.items() if k != 'excludedRefs'}, indent=1))
    print('excluded:', len(excluded)); [print('  ', e) for e in excluded]
    print('wrote', len(lines), 'lines to', out_list)
    if report_path: json.dump(report, open(report_path, 'w'), indent=1)
    if parents_path:
        open(parents_path, 'w', newline='\r\n').write('\n'.join('%s|%s|%s|%s' % (t, s, k, e) for t in sorted(parents) for (s, k, e) in sorted(parents[t])) + '\n')
        print('parents', {t: len(v) for t, v in parents.items()}, '->', parents_path)


def check(scan):
    rows = [r for r in json.load(open(os.path.join(scan, 'achr-judged.json'))) if in_scope(r)]
    excl = exclusions()
    left = [r for r in rows if r['ref'] not in excl]
    kept = [r for r in rows if r['ref'] in excl]
    by = collections.Counter(reason_of(r) for r in left)
    print('living plugin actors enabled in open Skyrim: %d (%d of them listed exclusions, %d not)' % (len(rows), len(kept), len(left)))
    for r in left[:20]: print('   left', r['ref'], r['baseEdid'], r['placeEdid'], reason_of(r))
    return left, kept, by


if __name__ == '__main__':
    a = sys.argv[1:]
    opt = lambda k: (a[a.index(k) + 1] if k in a else None)
    if a[0] == 'build':
        build(a[1], a[2], opt('--report'), opt('--parents'))
    elif a[0] == 'check':
        left, kept, by = check(a[1]); sys.exit(1 if left else 0)
    else:
        raise SystemExit(__doc__)
