"""Remap the numeric form ids in SkyMP change forms after a load-order change.

    py tools/loadorder-migrate.py <old server-settings.json> <new server-settings.json> <changeForms dir> [--id-key <name>]... [--hex-key-dict <name>]... [--write]
    py tools/loadorder-migrate.py <old> <new> [<changeForms dir>] --presets <racemenu-presets dir> [--presets-before <ISO time>] [--write]

Why: a change form keeps formDesc, baseDesc and worldOrCellDesc as "<hex>:<plugin>" strings, which survive any
load-order change, but inventory baseIds, equipment, learned spells, the appearance (race, head parts, head texture
set) and the gamemode's own dynamic fields (lastWorn, starterKitAt keys ...) are raw numeric ids whose top byte is
the plugin's load-order index (0xFE + 12 bits for a light plugin). A new full plugin loading before others shifts
every id of the plugins after it; 12 Oct 2026, adding four ESMs locally made the server skip a character with
"bad raceId in appearanceDump" (a DLE race 0x3D... now named another plugin).

What is remapped (15 Oct: by FIELD NAME only, never by value; a value-based pass would also rewrite any number that merely
looks like an id, such as nextRelootDatetime's Unix seconds, whose top byte 0x6A names slot 106 once an order has that many):
the leaf keys in ID_KEYS (baseId, raceId, headpartIds, headTextureSetId, learnedSpells, the equipped spell slots, lastWorn and
the housing ref fields partner, primary, memberOf, containers), and the all-digit dict keys directly under ID_KEY_DICTS (starterKitAt). Each id is mapped by plugin
NAME to its index in the new order. Every other integer that looks like a load-order id (top byte a plugin of the old order)
is LISTED under "not remapped" with its path and left alone: add its key with --id-key <name> after checking what it holds.
Not touched either: ids of plugins missing from the new order (reported), runtime ids (0xFF...), 0, and integers above
0xFFFFFFFF. Without --write it only reports what it would change.

--presets: the RaceMenu face files too (racemenupresets.js, <actor hex>.json), whose 'race' is such an id (window-1021: nine
faces kept 48xxxxxx after the DLE moved to 49). A file with 'raceDesc' ('<local hex>:<plugin>') gets its race from it in the
new order; any other is taken as saved in the old order and mapped by plugin name, unless it was saved ('at') at or after
--presets-before, which leaves its race as it is (saved in the new order already). Each face it maps or keeps gets the raceDesc
of its race. Stop the game server first: it keeps the faces it has read in memory and serves those until a restart.

DBO_DATA (default tools/../data) is the folder whose plugin headers say which .esp/.esm carry the light flag. A header it cannot
read is listed and taken as a full plugin; with --presets the run stops instead, as raceDesc would then name the wrong plugin.
"""
import json, os, re, sys, shutil, time
from collections import Counter
from datetime import datetime, timezone

ID_KEYS = {'baseId', 'raceId', 'headpartIds', 'headTextureSetId', 'learnedSpells', 'leftSpell', 'rightSpell', 'voiceSpell',
           'instantSpell', 'lastWorn', 'partner', 'primary', 'memberOf', 'containers',
           # CT 115, 15 Oct (integration B): the live dry run listed these as "not remapped"; each was read in the gameplay
           # code and holds form ids: mastery skills.*.granted[] (spell ids, masterySystem.ts removeSpell), maskItemId /
           # maskLost (playermenu.js mask items), housing.keyBase (the DLE house-key KEYM pool), dboKeyRing[].p (the property
           # ref a key opens), dboFavorites.items[].id / spells[].id, supernatural.look.prevEye (an eye head part),
           # dboEnchLearned[] (ENCH ids), dboBlessing.spell / .display (prayer.js abilities). In the live data these generic
           # names ('id', 'p', 'spell', 'display') occur only at those paths with load-order ids; the dry run lists every path
           # that would move, so read it before --write.
           'granted', 'maskItemId', 'maskLost', 'keyBase', 'p', 'id', 'prevEye', 'dboEnchLearned', 'spell', 'display',
           # PC, 25 Oct (Rigmor roll-out dry run on a copy of world-20261025T050205Z): four more "not remapped" paths, each
           # read in the gameplay code: inv.entries[].poisonId (the applied poison, e.g. a DLE id), private.dboSleep.bed (the
           # bed ref, rest.js), mastery skills.*.ring[].h (recent spell ids, schools.js) and supernatural.ownEye (an eye head
           # part, supernatural.js). With them only colour fields (skinColor, tints[].argb, blood.prev[].argb) stay unmapped.
           'poisonId', 'bed', 'h', 'ownEye'}
ID_KEY_DICTS = {'starterKitAt'}
# Dicts whose keys are form ids written as lowercase hex without 0x (`(ref >>> 0).toString(16)`): the per-player rests and
# cooldowns (labour.js minedVeins / choppedBlocks, wildlife.js campLoot, prayer.js prayedShrines, gamemode.js scholarReads)
# and the housing record's assigned map. Left alone, a moved key names another plugin's record: the rest is lost early.
HEX_KEY_DICTS = {'minedVeins', 'choppedBlocks', 'campLoot', 'prayedShrines', 'scholarReads', 'assigned'}


def order(path):
    lo = json.load(open(path, encoding='utf-8'))['loadOrder']
    return [os.path.basename(p.replace('\\', '/')) for p in lo]


def data_dir():
    return os.path.abspath(os.environ.get('DBO_DATA', os.path.join(os.path.dirname(__file__), '..', 'data')))


def index_map(old, new, new_names=None, unread=None):
    """Old id top bits -> new top bits. Light plugins (.esl or the 0x200 flag) live at 0xFE in load order of lights.
    new_names: filled with the new order's slot -> plugin file name. fix-numeric-ids.py and scan-numeric-ids.py take (m, names).
    unread: gets each .esp/.esm whose header could not be read, taken as full (a light one missed shifts every later index)."""
    data = data_dir()
    def light(name):
        if name.lower().endswith('.esl'): return True
        try:
            with open(os.path.join(data, name), 'rb') as fh: head = fh.read(12)
        except OSError: head = b''
        if len(head) < 12 or head[:4] != b'TES4':
            if unread is not None: unread.add(name)
            return False
        return bool(int.from_bytes(head[8:12], 'little') & 0x200)
    def slots(lo):
        full, lite, out = 0, 0, {}
        for n in lo:
            if light(n): out[n.lower()] = ('L', lite); lite += 1
            else: out[n.lower()] = ('F', full); full += 1
        return out
    o, n = slots(old), slots(new)
    m = {}
    for name, slot in o.items():
        m[slot] = n.get(name)          # None: plugin gone
    names = {v: k for k, v in o.items()}
    if new_names is not None: new_names.update({n[x.lower()]: x for x in new})
    return m, names


def slot_of(v):
    """A load-order id's (slot, local id); None for 0, a runtime id (0xFF...), a non-integer or one past 32 bits."""
    if not isinstance(v, int) or isinstance(v, bool) or v <= 0 or v > 0xFFFFFFFF or v >> 24 == 0xFF: return None
    return (('L', (v >> 12) & 0xFFF), v & 0xFFF) if v >> 24 == 0xFE else (('F', v >> 24), v & 0xFFFFFF)


def id_at(slot, local):
    return (0xFE000000 | (slot[1] << 12) | local) if slot[0] == 'L' else ((slot[1] << 24) | local)


def remap_id(v, m):
    s = slot_of(v)
    if not s: return v, None
    slot, local = s
    if slot not in m: return v, None
    to = m[slot]
    if to is None: return v, ('gone', slot)
    nv = id_at(to, local)
    return nv, (('moved', slot) if nv != v else None)


PRESET_FILE = re.compile(r'^[0-9a-f]{8}\.json$')
DESC = re.compile(r'^([0-9a-fA-F]{1,8}):(.+)$')


def when(s):
    """An ISO time as an aware datetime (no zone: UTC), or None."""
    try:
        t = datetime.fromisoformat(str(s).strip().replace('Z', '+00:00'))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def presets(pdir, m, new_names, before):
    """The RaceMenu face files whose race or raceDesc changes: [(path, doc)]. A race is listed per file when it moves."""
    by_name = {nm.lower(): s for s, nm in new_names.items()}
    stats, changed = Counter(), []
    for f in sorted(os.listdir(pdir)):
        if not PRESET_FILE.match(f): continue
        p = os.path.join(pdir, f)
        try:
            d = json.load(open(p, encoding='utf-8'))
        except ValueError:
            stats['unreadable, left alone'] += 1; continue
        race = d.get('race') if isinstance(d, dict) else None
        if not isinstance(race, int) or isinstance(race, bool):
            stats['no race, left alone'] += 1; continue
        desc = d.get('raceDesc')
        saved = when(d.get('at'))
        if isinstance(desc, str):
            md = DESC.match(desc)
            slot, local = (by_name.get(md.group(2).lower()), int(md.group(1), 16)) if md else (None, 0)
            if slot is None or local > (0xFFF if slot[0] == 'L' else 0xFFFFFF):
                stats['raceDesc not in the new order, left alone'] += 1; print('  %s raceDesc %s is not in the new order' % (f, desc)); continue
            to, why = id_at(slot, local), 'race from raceDesc'
        elif before and saved and saved >= before:
            to, why = race, 'saved in the new order'
        else:
            to, w = remap_id(race, m)
            if w and w[0] == 'gone':
                stats['plugin gone, left alone'] += 1; print('  %s race %x: its plugin is not in the new order' % (f, race)); continue
            why = 'race moved' if w else 'race not moved'
        nd = dict(d, race=to)
        add = desc_of(to, new_names) if not isinstance(desc, str) else None
        if add: nd['raceDesc'] = add; stats['raceDesc added'] += 1
        stats[why] += 1
        if to != race: print('  %s race %x -> %x (%s)' % (f, race, to, why))
        if nd != d: changed.append((p, nd))
    for why, n in sorted(stats.items()): print('%6d face files: %s' % (n, why))
    print('face files to change:', len(changed))
    return changed


def desc_of(v, new_names):
    """An id of the new order as mp.getDescFromId writes it ('<local hex>:<plugin>'), or None."""
    s = slot_of(v)
    return '%x:%s' % (s[1], new_names[s[0]]) if s and s[0] in new_names else None


def backup(d):
    bak = d.rstrip('/\\') + '.bak-loadorder-' + time.strftime('%Y%m%d-%H%M%S')
    n = 1
    while os.path.exists(bak + ('' if n == 1 else '-%d' % n)): n += 1      # two runs in one second
    bak += '' if n == 1 else '-%d' % n
    shutil.copytree(d, bak); print('backup', bak)


def walk(o, m, path, stats, idkey=False, numkeys=False, hexkeys=False):
    """idkey: o sits under a key of ID_KEYS (a list's items inherit it). numkeys: o's all-digit keys are ids.
    hexkeys: o's keys are ids in lowercase hex (HEX_KEY_DICTS)."""
    if isinstance(o, str) and o[:1] in '{[':
        try:
            inner = json.loads(o)
        except ValueError:
            return o
        res = walk(inner, m, path + '(json)', stats, idkey, numkeys, hexkeys)
        return json.dumps(res, separators=(',', ':')) if res != inner else o
    if isinstance(o, dict):
        out = {}
        for k, v in o.items():
            nk = k
            if hexkeys and 1 <= len(k) <= 8 and all(c in '0123456789abcdef' for c in k):
                nkv, why = remap_id(int(k, 16), m)
                if why:
                    stats[(path + '.<hexkey>', why[0])] += 1
                    if why[0] == 'moved': nk = '%x' % nkv
            elif k.isdigit():
                nkv, why = remap_id(int(k), m)
                if why and numkeys:
                    stats[(path + '.<key>', why[0])] += 1
                    if why[0] == 'moved': nk = str(nkv)
                elif why and why[0] == 'moved': stats[(path + '.<key>', 'not remapped')] += 1
            leaf = k.rsplit('.', 1)[-1]        # dynamicFields keys are dotted: "private.lastWorn"
            out[nk] = walk(v, m, path + '.' + ('<k>' if hexkeys else '<n>' if k.isdigit() else k), stats, leaf in ID_KEYS and not hexkeys,
                           leaf in ID_KEY_DICTS and not hexkeys, leaf in HEX_KEY_DICTS and not hexkeys)
        if len(out) != len(o): raise SystemExit('key collision after remapping at %s' % path)
        return out
    if isinstance(o, list):
        return [walk(v, m, path + '[]', stats, idkey) for v in o]
    nv, why = remap_id(o, m)
    if not why: return o
    if not idkey:
        if why[0] == 'moved': stats[(path, 'not remapped')] += 1
        return o
    stats[(path, why[0])] += 1
    return nv if why[0] == 'moved' else o


def main():
    a = sys.argv[1:]
    write = '--write' in a; a = [x for x in a if x != '--write']
    while '--id-key' in a:
        i = a.index('--id-key'); ID_KEYS.add(a[i + 1]); del a[i:i + 2]
    while '--hex-key-dict' in a:
        i = a.index('--hex-key-dict'); HEX_KEY_DICTS.add(a[i + 1]); del a[i:i + 2]
    pdir = before = None
    if '--presets' in a:
        i = a.index('--presets'); pdir = a[i + 1]; del a[i:i + 2]
    if '--presets-before' in a:
        i = a.index('--presets-before'); before = when(a[i + 1]); del a[i:i + 2]
        if not before or not pdir: raise SystemExit('--presets-before takes an ISO time, and --presets with it')
    if not (len(a) == 3 or (pdir and len(a) == 2)): raise SystemExit(__doc__)
    old_p, new_p, cf = (a + [None])[:3]
    new_names, unread = {}, set()
    m, names = index_map(order(old_p), order(new_p), new_names, unread)
    print('plugin headers from', data_dir(), '(DBO_DATA)')
    if unread:
        print('%d plugin header(s) could not be read, taken as full plugins: %s' % (len(unread), ', '.join(sorted(unread))))
        if pdir: raise SystemExit('--presets needs every plugin header: set DBO_DATA to the folder that holds the plugins')
    moved = {names[k]: v for k, v in m.items() if v is None or v != k}
    print('plugins whose index changes:', len(moved), '| gone:', [n for n, v in moved.items() if v is None])
    stats = Counter(); changed = []
    for f in sorted(os.listdir(cf)) if cf else []:
        if not f.endswith('.json'): continue
        p = os.path.join(cf, f)
        d = json.load(open(p, encoding='utf-8'))
        s = Counter(); nd = walk(d, m, '', s)
        # the desc fields are names, never numbers; formDesc of a runtime form is plain hex and stays
        if nd != d: changed.append((p, nd))
        stats.update(s)
    for (path, why), n in sorted(stats.items()): print('%6d %-12s %s' % (n, why, path))
    if cf: print('files to change:', len(changed))
    faces = presets(pdir, m, new_names, before) if pdir else []
    if not write: print('dry run; add --write'); return
    if cf:
        backup(cf)
        for p, nd in changed: json.dump(nd, open(p, 'w', encoding='utf-8'), ensure_ascii=False)
        print('written', len(changed))
    if faces:
        backup(pdir)
        # Compact as the server writes them; ASCII escapes keep any face text exactly, so its hash still matches
        for p, nd in faces:
            with open(p + '.migrate.tmp', 'w', encoding='utf-8') as fh: fh.write(json.dumps(nd, separators=(',', ':')))
            os.replace(p + '.migrate.tmp', p)
        print('face files written', len(faces))


if __name__ == '__main__':
    main()
