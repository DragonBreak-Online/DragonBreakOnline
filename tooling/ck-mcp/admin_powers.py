"""Builds server\\admin-powers.json for the admin panel's Powers tab:
  spells: every spell a spell tome teaches (BOOK with the teaches-spell flag), with its editor id
  shouts: every SHOU with its three words of power (WOOP), with editor ids
Plugin FULL names are localized string ids, so names come from editor ids."""
import sys, os, json, struct, re, collections
sys.path.insert(0, r"E:\DragonBreak Online Dev files\ck-mcp")
import core, esplib
# DBO_PLUGINS: point at the LIVE order (/opt/skyrim-data/loadorder.txt) so the descs match the server that reads this file;
# DBO_DATA: a Data folder holding every plugin in it (a staging folder of hardlinks when the dev copy lags the live DLE)
lo = core.LoadOrder(os.environ.get("DBO_DATA", r"E:\DragonBreak Online Dev files\Skyrim Special Edition - dev\Data"), os.environ.get("DBO_PLUGINS", r"E:\DragonBreak Online Dev files\server\plugins.server.txt"))
if lo.missing_plugins: sys.exit("missing plugins: %s" % lo.missing_plugins)
# DBO_CONFIG: gamemode-config.json, whose spells.removedSpells and suspendedSpells are left out (a held spell is not given)
_cfg = json.load(open(os.environ.get("DBO_CONFIG", r"E:\DragonBreak Online Dev files\server\gamemode-config.json"), encoding="utf-8")).get("spells", {})
def _norm(d): h, p = d.split(":", 1); return "%x:%s" % (int(h, 16), p.lower())
HELD = {_norm(x) for x in _cfg.get("removedSpells", []) + _cfg.get("suspendedSpells", [])}
def edid(p, off, sz, fl): return esplib.edid_of(lo.body(p, off, sz, fl)) or ""
def desc(canon): src, loc = canon.rsplit(":", 1); return "%x:%s" % (int(loc, 16), src)
SKIP = ("test", "dummy", "cut", "unused", "delete", "qa", "debug")
# A mod's internals can be genuinely tome-taught and so pass every check above: YokuWeapons ships tomes
# for 0_ConjureSkeleSpell and 0_PuppetManConjurePLAYER. Matched by shape, not by plugin, so the next mod
# that names things this way is caught too.
SKIP_RE = re.compile(r"^0_|PLAYER$|^AA[A-Z_]|^zz", re.ASCII)

spel, book, shou, woop = {}, {}, {}, {}
for p in lo.plugins:
    for ri, t, fid, fl, off, sz, ctx in lo.records(p, ("SPEL", "BOOK", "SHOU", "WOOP")):
        c = lo.canon(p, fid)
        if fl & 0x20:
            for d in (spel, book, shou, woop): d.pop(c, None)
            continue
        e = edid(p, off, sz, fl)
        sub = lo.subrecords(p, off, sz, fl)
        if t == "SPEL":
            spit = sub.get(b"SPIT", b"")
            stype = struct.unpack("<I", spit[8:12])[0] if len(spit) >= 12 else -1
            spel[c] = {"edid": e, "type": stype}
        elif t == "BOOK":
            data = sub.get(b"DATA", b"")
            if len(data) >= 8:
                flags = data[0]
                if flags & 0x04:
                    book[c] = {"edid": e, "spell": lo.canon(p, struct.unpack("<I", data[4:8])[0])}
        elif t == "SHOU":
            words = []
            for s, v in esplib.subrecords(lo.body(p, off, sz, fl)):
                if s == b"SNAM" and len(v) >= 4:
                    w = struct.unpack("<I", bytes(v[:4]))[0]
                    if w: words.append(lo.canon(p, w))
            shou[c] = {"edid": e, "words": words}
        else:
            woop[c] = e

spells = {}
for b in book.values():
    s = spel.get(b["spell"])
    if not s or s["type"] not in (0, 2, 3): continue  # a tome teaches spells (0), powers (2) and lesser powers (3); never an ability or disease
    if _norm(desc(b["spell"])) in HELD: continue
    if any(x in s["edid"].lower() for x in SKIP): continue
    if SKIP_RE.search(s["edid"]): continue
    spells[b["spell"]] = s["edid"]
# Give all Shouts gives the Dragonborn's own shouts only, the ones a player learns (Nate, 2026-09-28): the base game's
# twenty, Dawnguard's three and Dragonborn's four. Dragon, draugr, Greybeard, Miraak and quest variants are left out.
DRAGONBORN_SHOUTS = {"UnrelentingForceShout", "FireBreathShout", "FrostBreathShout", "WhirlwindSprintShout", "BecomeEtherealShout", "DisarmShout", "Dismay", "ElementalFuryShout", "IceFormShout", "KynesPeaceShout", "MarkedforDeathShout", "AuraWhisperShout", "animalAllegianceShout", "SlowTimeShout", "StormCallShout", "ThrowVoiceShout", "ClearSkiesShout", "CallDragonShout", "CallofValorShout", "DragonrendShout", "DLC1DrainVitalityShout", "DLC1SoulTearShout", "DLC1SummonDragonShout", "DLC2BattleFuryShout", "DLC2BendWillShout", "DLC2CycloneShout", "DLC2DragonAspectShout"}
shouts = []
for c, s in shou.items():
    if not s["words"] or s["edid"] not in DRAGONBORN_SHOUTS: continue
    shouts.append({"shout": desc(c), "name": s["edid"], "words": [desc(w) for w in s["words"] if w in woop]})

# DRAGONBORN_SHOUTS is a list of names, so a renamed vanilla shout or a mod-added player shout would be
# dropped in silence. This says so instead. The rule: a shout a player learns has three DISTINCT real
# words, where the dragons' own WordDragonFire* words and placeholders like MQFakeWord do not count. On
# 25 Oct the two agreed exactly on all 27, which is what makes the named list safe to rely on.
DRAGON_WORDS = {c for c, e in woop.items() if e.lower().startswith("worddragon")}
PLACEHOLDER = ("fakeword", "dummy", "unused", "test")


def looks_learnable(s):
    ws = s["words"]
    if len(ws) != 3 or len(set(ws)) != 3:
        return False
    if any(w not in woop for w in ws):
        return False
    if any(any(h in woop[w].lower() for h in PLACEHOLDER) for w in ws):
        return False
    return not any(w in DRAGON_WORDS for w in ws)


by_shape = {s["edid"] for s in shou.values() if looks_learnable(s)}
named = {s["name"] for s in shouts}
# the werewolf howl is beast form's (server\beastform.js grants it) and Durnehviir's summon is the dragon's
EXPECTED_SHAPE_ONLY = {"HowlWerewolfCallOfTheWild", "DLC1DragonUndeadSummonShout"}
unexpected = (by_shape - named) - EXPECTED_SHAPE_ONLY
missing_shape = named - by_shape
spell_rows = sorted(([desc(c), n] for c, n in spells.items()), key=lambda x: x[1])
sources = collections.Counter(r[0].split(":", 1)[1] for r in spell_rows)
# The gated layout, and regenerating must preserve it. `spells` and `shouts` stay EMPTY: adminSystem.ts
# reads this file at every press, so an empty list gives nothing at once with no restart, which is the
# second switch beside GIVE_ALL_OFF in code (spells emptied 17 Oct after Jake's freeze, shouts the same
# day on Nate's call). The real lists live beside them - `spellsMeasureFirst`, which nothing reads, and
# `shoutsGate`, which combat.js reads to decide which shouts a player may use. Writing the catalogue into
# `spells` here would re-enable give-all in data the moment it deployed and take the shout gate's key
# away, which is exactly what an earlier regenerate did. Repopulating `spells` is a deliberate edit to go
# with the batched action, not something this script decides. Not `spellsGiveAllOff` either (26 Oct, the Leader): the
# batched action (rc-1026-fork 68d0b736 giveAllSpells) falls back to it when spells is empty, so a list there is given.
out = {"_comment": "Generated by ck-mcp/admin_powers.py for the admin panel Powers tab. Names are editor ids. "
                   "spells is EMPTY on purpose (17 Oct: Give all spells froze the server, an N squared spell-list "
                   "read fixed by fork d780bb9a). The catalogue (every spell, power and lesser power a winning spell "
                   "tome teaches in the live order, without mod internals or the removed and suspended spells) waits in "
                   "spellsMeasureFirst, which nothing reads: the batched action (rc-1026-fork 68d0b736) reads spells "
                   "and falls back to spellsGiveAllOff, so the list stays out of both until give-all is measured on dev "
                   "(the Leader, 26 Oct); renaming spellsMeasureFirst to spells turns it on. spellSources counts it by "
                   "plugin (gamemode-config giveAll.spellSources narrows it). shouts is EMPTY too; the 27 a player learns are in "
                   "shoutsGate, which combat.js reads for the player shout gate. Rename a list back into "
                   "spells or shouts to re-enable the old unbatched path - deliberately, with the code change.",
       "spells": [],
       "spellsMeasureFirst": spell_rows,
       "spellSources": dict(sorted(sources.items(), key=lambda x: (-x[1], x[0]))),
       "shouts": [],
       "shoutsGate": sorted(shouts, key=lambda x: x["name"]),
       "werewolf": "92c48:Skyrim.esm", "vampirelord": "283b:Dawnguard.esm"}
# DBO_POWERS_OUT: where to write. The path was hardcoded, so running this from a worktree still wrote into
# the shared checkout, which is a quiet way to leave a loose change in somebody else's tree.
OUT = os.environ.get("DBO_POWERS_OUT", r"E:\DragonBreak Online Dev files\server\admin-powers.json")
# the file's own line endings (CRLF as committed), on Windows and Linux alike
try: _eol = "\r\n" if b"\r\n" in open(OUT, "rb").read(4096) else "\n"
except OSError: _eol = "\n"
json.dump(out, open(OUT, "w", encoding="utf-8", newline=_eol), indent=1)
print("written to", OUT)
print("spellsMeasureFirst", len(out["spellsMeasureFirst"]), "shoutsGate", len(out["shoutsGate"]),
      "words", sum(len(s["words"]) for s in shouts), "| spells and shouts are empty by design")
print("spell sources:", ", ".join("%s %d" % (k, v) for k, v in out["spellSources"].items()))
if unexpected:
    print("CROSS-CHECK: these look learnable but are not in DRAGONBORN_SHOUTS, so give-all leaves them out:")
    for e in sorted(unexpected): print("   ", e)
if missing_shape:
    print("CROSS-CHECK: these are named in DRAGONBORN_SHOUTS but no longer look learnable (renamed? words changed?):")
    for e in sorted(missing_shape): print("   ", e)
if not unexpected and not missing_shape:
    print("cross-check: the named list and the three-distinct-words rule agree on all %d" % len(shouts))
