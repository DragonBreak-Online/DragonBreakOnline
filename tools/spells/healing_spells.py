#!/usr/bin/env python3
"""Restoration's healing spells in the server's load order, for the vampire rule (supernatural.js vampireRestoration):
a vampire cannot cast them and healing magic does nothing for a vampire (Nate, 11 Oct; a house rule).

A healing spell is a winning SPEL record of type Spell (SPIT+0x08 = 0) with at least one effect whose winning MGEF
  - has the Value Modifier (0) or Peak Value Modifier (34) archetype (DATA+0x40),
  - acts on Health (actor value 24, DATA+0x44),
  - has Restoration as its magic skill (actor value 22, DATA+0x0C),
  - and is neither Hostile (0x1) nor Detrimental (0x4) (DATA+0x00): the C++ restores only those (ActionListener
    GetRestorativeEffects), and Restoration's anti-undead effects (Turn Undead, Sun Fire, Vampire's Bane, Stendarr's
    Aura, Bane of the Undead) are hostile, so they stay out.
  - and has a magnitude above 0 in the spell's EFIT (teleport and quest effects carry a zero Restore Health).
Wards (the Ward archetype on Ward Strength) and anti-undead spells are not healing. Dawnguard's Necromantic Healing and Heal
Undead (effects DLC1RestoreHealthUndead*) heal only the undead, so they are not the light of Arkay and stay out.

    python3 tools/spells/healing_spells.py [--data /opt/skyrim-data] [--order <loadorder.txt>] [--out <json>]
"""
import argparse, json, os, struct, sys

ap = argparse.ArgumentParser()
ap.add_argument('--data', default='/opt/skyrim-data')
ap.add_argument('--order', default='')
ap.add_argument('--out', default='')
ap.add_argument('--esplib', default=os.path.expanduser('~nate/dragonbreak/ck-mcp'))
a = ap.parse_args()
sys.path.insert(0, a.esplib)
import esplib  # noqa: E402

order_file = a.order or next((f for f in [os.path.join(os.environ.get('FORK', ''), 'deploy', 'skyrim-data', 'loadorder.txt'),
    os.path.expanduser('~nate/dragonbreak/fork/deploy/skyrim-data/loadorder.txt')] if os.path.isfile(f)), '')
if not order_file: sys.exit('no loadorder.txt (give --order)')
order = [l.strip() for l in open(order_file) if l.strip() and not l.startswith('#')]

AV_HEALTH, AV_RESTORATION = 24, 22
VALUE_MOD, PEAK_VALUE_MOD = 0, 34
HOSTILE, DETRIMENTAL = 0x1, 0x4

plugins, win = {}, {}
for name in order:
    p = esplib.Plugin(os.path.join(a.data, name)); plugins[name] = p
    for sig, fid, flags, off, size, ctx in p.index:
        if sig in ('SPEL', 'MGEF'):
            src, loc = p.modindex_source(fid)
            win[(sig, ((src or name).lower(), loc & 0xFFFFFF))] = (name, flags, off, size)
case = {n.lower(): n for n in order}
fhs = {}
def subs(k):
    name, flags, off, size = k
    return list(esplib.subrecords(plugins[name].data_at(fhs.setdefault(name, open(os.path.join(a.data, name), 'rb')), off, size, flags)))
def canon_in(name, fid):
    src, loc = plugins[name].modindex_source(fid); return ((src or name).lower(), loc & 0xFFFFFF)
def edid(sb): return next((v.rstrip(b'\0').decode('cp1252', 'replace') for s, v in sb if s == b'EDID'), '')

TURN_UNDEAD, CLOAK, DAMAGE = 24, 35, 0
def mgef_data(holder, fid):
    mk = win.get(('MGEF', canon_in(holder, fid)))
    d = next((x for t, x in subs(mk) if t == b'DATA'), b'') if mk else b''
    return (mk, d) if len(d) >= 0x48 else (None, b'')
def hostile_health(d):
    return struct.unpack_from('<I', d, 0x40)[0] == DAMAGE and struct.unpack_from('<i', d, 0x44)[0] == AV_HEALTH \
        and bool(struct.unpack_from('<I', d, 0)[0] & HOSTILE)
# Restoration's spells that harm (against the undead, and Beyond Skyrim's toxic ones), listed so the harness can prove they
# keep harming: a Restoration effect that is Turn Undead, harms Health, or is a cloak whose spell harms Health (Stendarr's Aura)
def anti_undead(k, sb):
    for s_, v in sb:
        if s_ != b'EFID' or len(v) != 4: continue
        mk, d = mgef_data(k[0], struct.unpack('<I', v)[0])
        if not mk or struct.unpack_from('<i', d, 0x0C)[0] != AV_RESTORATION: continue
        arch = struct.unpack_from('<I', d, 0x40)[0]
        if arch == TURN_UNDEAD or hostile_health(d): return True
        if arch == CLOAK:
            ck = win.get(('SPEL', canon_in(mk[0], struct.unpack_from('<I', d, 0x08)[0])))
            for t, x in (subs(ck) if ck else []):
                if t == b'EFID' and len(x) == 4:
                    m2, d2 = mgef_data(ck[0], struct.unpack('<I', x)[0])
                    if m2 and hostile_health(d2): return True
    return False

out, undead = [], []
for (sig, canon), k in sorted(win.items(), key=lambda kv: (kv[0][1][0], kv[0][1][1])):
    if sig != 'SPEL': continue
    sb = subs(k)
    spit = next((v for s, v in sb if s == b'SPIT'), b'')
    if len(spit) < 36 or struct.unpack_from('<I', spit, 8)[0] != 0: continue
    heals = []
    effects, cur = [], None
    for s, v in sb:
        if s == b'EFID' and len(v) == 4: cur = [v, b'']; effects.append(cur)
        elif s == b'EFIT' and cur is not None and not cur[1]: cur[1] = v
    for v, efit in effects:
        if len(efit) < 4 or struct.unpack_from('<f', efit, 0)[0] <= 0: continue
        mk = win.get(('MGEF', canon_in(k[0], struct.unpack('<I', v)[0])))
        if not mk: continue
        msb = subs(mk)
        d = next((x for t, x in msb if t == b'DATA'), b'')
        if len(d) < 0x48: continue
        flags, skill = struct.unpack_from('<I', d, 0)[0], struct.unpack_from('<i', d, 0x0C)[0]
        arch, av = struct.unpack_from('<I', d, 0x40)[0], struct.unpack_from('<i', d, 0x44)[0]
        if arch in (VALUE_MOD, PEAK_VALUE_MOD) and av == AV_HEALTH and skill == AV_RESTORATION and not (flags & (HOSTILE | DETRIMENTAL)) \
                and not edid(msb).startswith('DLC1RestoreHealthUndead'):
            heals.append(edid(msb))
    if anti_undead(k, sb): undead.append({'id': f'{case.get(canon[0], canon[0])}:{canon[1]:06X}', 'name': edid(sb), 'plugin': k[0]})
    if not heals: continue
    cast_type, delivery = struct.unpack_from('<I', spit, 16)[0], struct.unpack_from('<I', spit, 20)[0]
    out.append({
        'id': f'{case.get(canon[0], canon[0])}:{canon[1]:06X}', 'name': edid(sb), 'plugin': k[0],
        'castType': ['constant', 'fireAndForget', 'concentration', 'scroll'][cast_type] if cast_type < 4 else cast_type,
        'delivery': ['self', 'touch', 'aimed', 'targetActor', 'targetLocation'][delivery] if delivery < 5 else delivery,
        'effects': sorted(set(heals)),
    })

doc = {'_comment': 'Generated by tools/spells/healing_spells.py from the winning SPEL/MGEF records: Restoration spells with a '
       'non-hostile Value Modifier or Peak Value Modifier effect on Health. Read by supernatural.js (vampireRestoration) and spells.js.',
       'spells': out,
       '_harmful': 'Restoration spells that harm: Turn Undead, hostile Health damage (Sun Fire, Vampire\'s Bane, Bane of the Undead, '
       'Beyond Skyrim\'s toxic spells), or a cloak that deals it (Stendarr\'s Aura). They keep burning a vampire; the Guardian Circle hazard '
       'is in both lists (it heals the living and turns the undead). Listed for tests/vampire-restoration-harness.js.',
       'harmful': undead}
text = json.dumps(doc, indent=1) + '\n'
if a.out: open(a.out, 'w').write(text)
else: sys.stdout.write(text)
print(f'{len(out)} healing spells, {len(undead)} that harm', file=sys.stderr)
