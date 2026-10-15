"""Remap the numeric form ids in SkyMP change forms after a load-order change.

    py tools/loadorder-migrate.py <old server-settings.json> <new server-settings.json> <changeForms dir> [--id-key <name>]... [--hex-key-dict <name>]... [--write]

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
"""
import json, os, sys, shutil, time
from collections import Counter

ID_KEYS = {'baseId', 'raceId', 'headpartIds', 'headTextureSetId', 'learnedSpells', 'leftSpell', 'rightSpell', 'voiceSpell',
           'instantSpell', 'lastWorn', 'partner', 'primary', 'memberOf', 'containers',
           # CT 115, 15 Oct (integration B): the live dry run listed these as "not remapped"; each was read in the gameplay
           # code and holds form ids: mastery skills.*.granted[] (spell ids, masterySystem.ts removeSpell), maskItemId /
           # maskLost (playermenu.js mask items), housing.keyBase (the DLE house-key KEYM pool), dboKeyRing[].p (the property
           # ref a key opens), dboFavorites.items[].id / spells[].id, supernatural.look.prevEye (an eye head part),
           # dboEnchLearned[] (ENCH ids), dboBlessing.spell / .display (prayer.js abilities). In the live data these generic
           # names ('id', 'p', 'spell', 'display') occur only at those paths with load-order ids; the dry run lists every path
           # that would move, so read it before --write.
           'granted', 'maskItemId', 'maskLost', 'keyBase', 'p', 'id', 'prevEye', 'dboEnchLearned', 'spell', 'display'}
ID_KEY_DICTS = {'starterKitAt'}
# Dicts whose keys are form ids written as lowercase hex without 0x (`(ref >>> 0).toString(16)`): the per-player rests and
# cooldowns (labour.js minedVeins / choppedBlocks, wildlife.js campLoot, prayer.js prayedShrines, gamemode.js scholarReads)
# and the housing record's assigned map. Left alone, a moved key names another plugin's record: the rest is lost early.
HEX_KEY_DICTS = {'minedVeins', 'choppedBlocks', 'campLoot', 'prayedShrines', 'scholarReads', 'assigned'}


def order(path):
    lo = json.load(open(path, encoding='utf-8'))['loadOrder']
    return [os.path.basename(p.replace('\\', '/')) for p in lo]


def index_map(old, new):
    """Old id top bits -> new top bits. Light plugins (.esl or the 0x200 flag) live at 0xFE in load order of lights."""
    data = os.environ.get('DBO_DATA', os.path.join(os.path.dirname(__file__), '..', 'data'))
    def light(name):
        if name.lower().endswith('.esl'): return True
        try:
            with open(os.path.join(data, name), 'rb') as fh: return bool(int.from_bytes(fh.read(12)[8:12], 'little') & 0x200)
        except OSError: return False
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
    return m, names


def remap_id(v, m):
    if not isinstance(v, int) or isinstance(v, bool) or v <= 0 or v > 0xFFFFFFFF: return v, None
    hi = v >> 24
    if hi == 0xFF: return v, None
    if hi == 0xFE:
        slot, local = ('L', (v >> 12) & 0xFFF), v & 0xFFF
    else:
        slot, local = ('F', hi), v & 0xFFFFFF
    if slot not in m: return v, None
    to = m[slot]
    if to is None: return v, ('gone', slot)
    nv = (0xFE000000 | (to[1] << 12) | local) if to[0] == 'L' else ((to[1] << 24) | local)
    return nv, (('moved', slot) if nv != v else None)


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
    old_p, new_p, cf = a
    m, names = index_map(order(old_p), order(new_p))
    moved = {names[k]: v for k, v in m.items() if v is None or v != k}
    print('plugins whose index changes:', len(moved), '| gone:', [n for n, v in moved.items() if v is None])
    stats = Counter(); changed = []
    for f in sorted(os.listdir(cf)):
        if not f.endswith('.json'): continue
        p = os.path.join(cf, f)
        d = json.load(open(p, encoding='utf-8'))
        s = Counter(); nd = walk(d, m, '', s)
        # the desc fields are names, never numbers; formDesc of a runtime form is plain hex and stays
        if nd != d: changed.append((p, nd))
        stats.update(s)
    for (path, why), n in sorted(stats.items()): print('%6d %-12s %s' % (n, why, path))
    print('files to change:', len(changed))
    if not write: print('dry run; add --write'); return
    bak = cf.rstrip('/\\') + '.bak-loadorder-' + time.strftime('%Y%m%d-%H%M%S')
    n = 1
    while os.path.exists(bak + ('' if n == 1 else '-%d' % n)): n += 1      # two runs in one second
    bak += '' if n == 1 else '-%d' % n
    shutil.copytree(cf, bak); print('backup', bak)
    for p, nd in changed: json.dump(nd, open(p, 'w', encoding='utf-8'), ensure_ascii=False)
    print('written', len(changed))


if __name__ == '__main__':
    main()
