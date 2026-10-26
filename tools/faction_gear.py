"""Builds server/faction-gear.json: which crafted items only a faction's own smiths and tailors may make (factiongear.js).

Nate, 2026-09-28: "legion armor can only be made by Imperial legion faction, hold armor per hold blacksmith, Orcish
Clan for the strongholds, etc", armor and weapons, and the unclear sets tied as he chose: Akaviri Samurai to the Blades,
Wolf and Skyforge to the Companions, vampire gear to the vampire clans, Penitus Oculatus to the Legion, and the modded
silver gear (not the base game's) to the Silver Hand.

Reads regions.json (ck-mcp/regions.py: every creation recipe with its product, name and bench) and matches each
recipe's product name, recipe editor id and plugin against the SETS below. Ammunition and anything not made at a forge,
the Skyforge, the Dawnguard forge, a loom or a tanning rack is left out. The result lists items, not recipes: some items
have recipes in several mods, and the gate is on what is made.
  python3 tools/faction_gear.py            (from server/, writes faction-gear.json)
  python3 tools/faction_gear.py --check    what it would change, writing nothing
  python3 tools/faction_gear.py --prune    also delete the entries the SETS no longer produce (177 of them today)
"""
import json, re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.dirname(HERE)
recipes = json.load(open(os.path.join(SERVER, 'regions.json')))['recipes']

HOLDS = {'Falkreath': 'hold-falkreath', 'Hjaalmarch': 'hold-morthal', 'Markarth': 'hold-markarth', 'Pale': 'hold-dawnstar',
         'Riften': 'hold-riften', 'Solitude': 'hold-solitude', 'Whiterun': 'hold-whiterun', 'Windhelm': 'hold-windhelm',
         'Winterhold': 'hold-winterhold'}
CLANS = ['clan-gol-kharzum', 'clan-mor-khazgur', 'clan-dushnikh-yal', 'clan-largashbur', 'clan-narzulbur', 'clan-cracked-tusk']
VAMPIRES = ['clan-volkihar', 'cyrodiil-vampyrum-order', 'crimson-scars', 'bloodmist-clan']

# (set name, factions, name regex, extra test on (name, recipe edid, plugin))
SETS = [
    # Not 'Steel Imperial': those gauntlets are plain steel (ArmorSteelGauntletsB), not Legion work (faction parity, 6 Oct)
    ('Imperial Legion', ['imperial-legion'], r"^(Imperial (?!City Stew)|Heroic Imperial|General Tullius)", None),
    # Nate 9 Oct: the Penitus Oculatus is its own faction; the Legion keeps the set (his 28 Sep tie) and the Oculatus wears it
    ('Penitus Oculatus', ['imperial-legion', 'penitus-oculatus'], r"^Penitus Oculatus", None),
    ('Stormcloaks', ['stormcloaks'], r"^(Stormcloak|Heroic Stormcloak|Ulfric's)", None),
    ('Dawnguard', ['dawnguard'], r"^Dawng(ua|au)rd", None),
    ('Blades', ['blades'], r"^(Blades |Akaviri Samurai|Dragonguard)", None),
    ('Companions', ['companions'], r"^(Wolf (Armor|Boots|Gauntlets|Helmet|Shield)|(Heavy|Light) Skyforge Shield)$", None),
    ('Thieves Guild', ['thieves-guild'], r"^(Thieves Guild|Guild Master's)", None),
    ('Nightingales', ['cult-nocturnal'], r"^(Nightingale|Karliah's)", None),
    ('Dark Brotherhood', ['dark-brotherhood'], r"^(Shrouded|Ancient Shrouded|Dark Brotherhood)", None),
    ('Thalmor', ['thalmor'], r"^(Hooded )?Thalmor", None),
    # The College of Whispers' Witchplate with red runes (DLE 9c82f09f, PC 12 Oct): DBO_RecipeWhispers* at the forge, the Artificer's work
    ('College of Whispers', ['college-of-whispers'], r"^College of Whispers (Hood|Cuirass|Gauntlets|Greaves)$", None),
    ('College of Winterhold', ['college-of-winterhold'], r"^((Hooded )?Arch-Mage's|College Boots|College of Winterhold)", None),
    ('Vampire clans (royal)', ['clan-volkihar'], r"^Vampire Royal Armor$", None),
    ('Vampire clans', VAMPIRES, r"^Vampire (Armor|Boots|Gauntlets|Gloves|Hood|Robes)$", None),
    # The base Orcish set is not here (Nate, 17 Oct): any Orc forges it, wherever they live (regions.js orcishCraft keeps
    # it to Orcs); only the Orcish Clan pieces are the strongholds' own
    # The Vigil's own kit from Sentinel (Nate, 12 Oct, Roland EbonShield: any tier 5 smith could make these, which left
    # the faction nothing to recruit with). Four of the fifteen were listed by hand on 28 Sep; the rest were not, so the
    # mail, plate, coif, shield and the two Vigilant weapons were open to anyone. Sentinel.esp only: "Vigilant" also
    # names unrelated gear in other mods.
    ('Vigilants of Stendarr', ['vigil-of-stendarr'], r"^Vigil(ant)? ", lambda n, e, p: '_TH_' in e),
    # The Tribunal Temple's robes, mantles, hoods and masks (Immersive Armors; Nate, 18 Oct: "locked behind faction"):
    # House Indoril is the Temple's own house, its Ordinators drawn from it
    ('Tribunal Temple', ['house-indoril'], r"^Tribunal ", lambda n, e, p: p == 'Hothtrooper44_ArmorCompilation.esp'),
    # The Knights of the Nine's kit (Nat, 25 Oct: a lore faction on the live server): no Knights of the Nine or Crusader
    # gear is in the load order, so the order wears the Knight-Errant set (knighterrant.esp), which no faction held
    ('Knights of the Nine', ['knights-of-the-nine'], r"^Knight-Errant ", lambda n, e, p: p == 'knighterrant.esp'),
    # Modded silver only: Immersive Weapons' silver weapons and Immersive Armors' mantles, not the base game's
    ('Silver Hand', ['silver-hand'], r"(Silver (Longsword|Battle Staff|War Axe|Battleaxe|Scimitar|Nodachi|Katana|Wakizashi|Tanto|Hawk Bow|Sword)|Mantle of the Silver Hand)$",
     lambda n, e, p: p in ('Immersive Weapons.esp', 'Hothtrooper44_ArmorCompilation.esp')),
]
HOLD_RX = re.compile(r"^(%s) Guard('s (Armor|Helmet|Shield)| Cloak)$" % '|'.join(HOLDS))
# War uniforms that are not crafted, for factions whose uniform no recipe makes (Nate, 2026-09-28: "with wars, people
# have to wear the faction uniforms"): worn, never gated. Found in the Beyond Skyrim plugins by editor id.
UNIFORM_EXTRA = {
    'county-bruma': ['723cd:BSHeartland.esm'],                          # CYRArmorGuardCuirassBruma
    'synod': ['602972:BSAssets.esm', '82c2f:BSHeartland.esm'],          # CYRSynodRobes, CYRClothesSynodRobes
    # Windhelm's own guard kit from Sentinel - City Guards (the base game dresses them in Stormcloak cuirasses and has
    # only an Eastmarch helmet and shield): the two cuirasses are the uniform, the three helmets go with it (Nate)
    'hold-windhelm': ['815:Sentinel - City Guards.esp', '816:Sentinel - City Guards.esp', '819:Sentinel - City Guards.esp',
                      '81a:Sentinel - City Guards.esp', '81b:Sentinel - City Guards.esp'],
}
BENCHES = {'CraftingSmithingForge': 'blacksmith', 'CraftingSmithingSkyforge': 'blacksmith', 'DLC1CraftingDawnguard': 'blacksmith',
           'MCE_CraftingLoom': 'tailor', 'CraftingTanningRack': 'tailor'}

items = {}
for desc, r in recipes.items():
    name, edid, bench = r.get('name', ''), r.get('edid', ''), r.get('bench', '')
    plugin = desc.split(':', 1)[1] if ':' in desc else ''
    if bench not in BENCHES or not r.get('item') or re.search(r'Temper', edid): continue
    hit = None
    m = HOLD_RX.match(name)
    if m: hit = ('%s Guard' % m.group(1), [HOLDS[m.group(1)]])
    else:
        for set_name, factions, rx, extra in SETS:
            if re.search(rx, name) and (extra is None or extra(name, edid, plugin)):
                hit = (set_name, factions); break
    if not hit: continue
    item = r['item']
    role = BENCHES[bench]
    cur = items.get(item)
    if cur:
        cur['recipes'].append(desc)
        if role != cur['role']: cur['role'] = 'blacksmith'   # made at a forge anywhere: the smith's work
        continue
    items[item] = {'name': name, 'set': hit[0], 'factions': hit[1], 'role': role, 'recipes': [desc]}

# Sets whose recipes regions.json may not list yet (it is regenerated on the PC by ck-mcp/regions.py): kept by hand so a
# rerun before that regeneration does not drop them; a recipe regions.json does list is merged as above
WHISPERS = ('College of Whispers', ['college-of-whispers'], 'blacksmith')
# The Great House capes (Dunmer Great House Capes, merged into the DLE 26 Oct; Worker 2's fits, the Leader's yes): each house's
# cape, and its colour variant, only for that house's tailors (tanning-rack work). Dagoth and New Temple have no faction and
# stay open; regions-overrides locks those two to Solstheim
HAND_ITEMS = {
    '1ac968:DragonBreak Online Edits.esp': ('College of Whispers Hood', '1ac96c:DragonBreak Online Edits.esp', WHISPERS),
    '1ac969:DragonBreak Online Edits.esp': ('College of Whispers Cuirass', '1ac96e:DragonBreak Online Edits.esp', WHISPERS),
    '1ac96a:DragonBreak Online Edits.esp': ('College of Whispers Gauntlets', '1ac970:DragonBreak Online Edits.esp', WHISPERS),
    '1ac96b:DragonBreak Online Edits.esp': ('College of Whispers Greaves', '1ac972:DragonBreak Online Edits.esp', WHISPERS),
    '1d2266:DragonBreak Online Edits.esp': ('House Redoran Cape', '1d226f:DragonBreak Online Edits.esp', ('House Redoran', ['house-redoran'], 'tailor')),
    '1d226e:DragonBreak Online Edits.esp': ('House Hlaalu Cape', '1d2277:DragonBreak Online Edits.esp', ('House Hlaalu', ['house-hlaalu'], 'tailor')),
    '1d2267:DragonBreak Online Edits.esp': ('House Telvanni Cape', '1d2270:DragonBreak Online Edits.esp', ('House Telvanni', ['house-telvanni'], 'tailor')),
    '1d226c:DragonBreak Online Edits.esp': ('House Telvanni Cape (Purple)', '1d2276:DragonBreak Online Edits.esp', ('House Telvanni', ['house-telvanni'], 'tailor')),
    '1d226a:DragonBreak Online Edits.esp': ('House Indoril Cape', '1d2272:DragonBreak Online Edits.esp', ('House Indoril', ['house-indoril'], 'tailor')),
    '1d226d:DragonBreak Online Edits.esp': ('House Indoril Cape (White and Gold)', '1d2275:DragonBreak Online Edits.esp', ('House Indoril', ['house-indoril'], 'tailor')),
    '1d2269:DragonBreak Online Edits.esp': ('House Dres Cape', '1d2271:DragonBreak Online Edits.esp', ('House Dres', ['house-dres'], 'tailor')),
}
for item, (name, recipe, (st, factions, role)) in HAND_ITEMS.items():
    cur = items.setdefault(item, {'name': name, 'set': st, 'factions': factions, 'role': role, 'recipes': []})
    if recipe not in cur['recipes']: cur['recipes'].append(recipe)

# Merge, never overwrite. Most of faction-gear.json is no longer reproducible from the SETS above: 177 of its items are
# there by hand, among them every Morrowind house guard, the Orcish Clan (no recipe at all; staff hand it out), Bruma
# Guard and the Synod, and some whose recipe regions.json no longer lists. Overwriting the file dropped all of them
# silently, which is how a rerun could have quietly opened 17 sets to any smith. An entry it does not produce is kept and
# counted; --prune is the only way to delete.
# An entry already in the file keeps its name, set, factions and role, and gains only the recipes this run finds (26 Oct,
# the Leader): the file carries decisions the SETS do not, and a rerun used to undo them (the Dawnguard's Silver Hand silver,
# House Ravenwatch's vampire gear, the Windhelm guard cloak). Where the rules disagree with the file the run says so; to let
# the rules win for an entry, change it by hand or pass --rules-win. tests/faction-gear-rerun-harness.js holds this.
PRUNE = '--prune' in sys.argv
CHECK = '--check' in sys.argv
RULES_WIN = '--rules-win' in sys.argv
KEEP_FIELDS = ('name', 'set', 'factions', 'role')
try:
    was = json.load(open(os.path.join(SERVER, 'faction-gear.json')))['items']
except (OSError, ValueError, KeyError):
    was = {}
kept = {k: v for k, v in was.items() if k not in items}
added = sorted(k for k in items if k not in was)
disagree = sorted(k for k in items if k in was and any(was[k].get(f) != items[k].get(f) for f in KEEP_FIELDS))
if not RULES_WIN:
    for k in items:
        if k in was:
            e = dict(was[k])
            e['recipes'] = list(was[k].get('recipes', [])) + [r for r in items[k]['recipes'] if r not in was[k].get('recipes', [])]
            items[k] = e
changed = sorted(k for k in items if k in was and was[k] != items[k])
merged = dict(items) if PRUNE else {**kept, **items}

out = {
    '_comment': 'Faction gear (server/factiongear.js; built by tools/faction_gear.py from regions.json, edit the SETS there '
                'and re-run, or edit an entry here by hand). An item listed here may be crafted only by a member of one of '
                'its factions whose rank role is its role (blacksmith for forge work, tailor for the loom and tanning rack) '
                'or leader. Nate, 2026-09-28: faction armor and weapons. Most of this file is no longer reproducible from the '
                "script's SETS: a rerun keeps every entry it does not produce and only --prune deletes them, so a hand-added "
                'set (the Orcish Clan, the Morrowind house guards, Bruma Guard, the Synod) survives a rerun.',
    'items': dict(sorted(merged.items(), key=lambda kv: (kv[1]['set'], kv[1]['name']))),
    '_uniformsComment': 'War uniforms (realm.js, config war.uniforms): in a battle only fighters wearing a body piece of their '
                        "faction's uniform count at a standard. A faction's uniform is its items above plus these worn-only "
                        'extras; a faction with neither (the Fighters Guild today) is not held to it.',
    'uniforms': UNIFORM_EXTRA,
}
if not CHECK:
    # the file's own line endings (CRLF as committed), on Windows and Linux alike
    try: eol = '\r\n' if b'\r\n' in open(os.path.join(SERVER, 'faction-gear.json'), 'rb').read(4096) else '\n'
    except OSError: eol = '\n'
    json.dump(out, open(os.path.join(SERVER, 'faction-gear.json'), 'w', encoding='utf-8', newline=eol), indent=1, ensure_ascii=False)
from collections import Counter
print('%d items: %d from the rules, %d kept%s' % (len(merged), len(items), len(kept), ' (DELETED by --prune)' if PRUNE else ''))
if kept:
    label = 'deleted' if PRUNE else 'kept, not reproducible from the SETS above'
    print(' %d %s:' % (len(kept), label))
    for st, n in sorted(Counter(v['set'] for v in kept.values()).items()): print('   %-26s %d' % (st, n))
# A rerun gates items that were not gated before, which is a decision, not housekeeping: say so rather than do it quietly.
if added: print(' %d item(s) this run ADDS to the gate: %s' % (len(added), ', '.join(items[k]['name'] for k in added[:8]) + (' ...' if len(added) > 8 else '')))
if changed: print(' %d item(s) this run CHANGES: %s' % (len(changed), ', '.join(items[k]['name'] for k in changed[:8]) + (' ...' if len(changed) > 8 else '')))
if disagree: print(' %d item(s) where the SETS disagree with the file (%s): %s' % (len(disagree), 'the rules won: --rules-win' if RULES_WIN else 'the file is kept',
    ', '.join(was[k]['name'] for k in disagree[:8]) + (' ...' if len(disagree) > 8 else '')))
print(' %s; --prune would delete the %d kept entr%s' % ('--check: nothing was written' if CHECK else 'written; --check shows this without writing',
                                                         len(kept), 'y' if len(kept) == 1 else 'ies'))
for st, n in sorted(Counter(v['set'] for v in merged.values()).items()): print(' %-26s %d' % (st, n))
