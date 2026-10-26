"""Builds the Give all spells list for server\\admin-powers.json (Leader for Nat, 26 Oct): the spells a player can learn
from a spell tome in the live load order, and nothing else.

A spell is on the list when:
  - a winning, undeleted BOOK with the teaches-spell flag (DATA flags 0x04) teaches it;
  - it is a spell, power or lesser power (SPIT type 0, 2 or 3): a tome teaches all three; never an ability or disease;
  - its editor id carries no test/debug/dummy/cut word and is not a mod internal (editor id starting "0_");
  - gamemode-config spells.removedSpells and spells.suspendedSpells do not hold it (a held spell is not given).

usage: py give_all_spells.py <Data dir> <loadorder.txt> <gamemode-config.json> <out.json>
Its school (first effect in a magic school, '' for none; a label only) rides along.
Writes [[desc, editorId, school, plugin], ...] sorted by plugin then editor id, plus what was left out and why.
The live loadorder.txt (143 plugins on 26 Oct) is /opt/skyrim-data/loadorder.txt; server\\plugins.server.txt is stale."""
import sys, json, struct, re
sys.path.insert(0, r"E:\DragonBreak Online Dev files\ck-mcp")
import core, esplib

DATA, ORDER, CONFIG, OUT = sys.argv[1:5]
lo = core.LoadOrder(DATA, ORDER)
if lo.missing_plugins:
    sys.exit("missing plugins: %s" % lo.missing_plugins)
AVI = {18: "Alteration", 19: "Conjuration", 20: "Destruction", 21: "Illusion", 22: "Restoration"}
SKIP = re.compile(r"test|debug|dummy|unused|delete|^cut|cut$|^qa", re.I)
DEL = 0x20


def edid(p, off, sz, fl): return esplib.edid_of(lo.body(p, off, sz, fl)) or ""
def desc(canon): src, loc = canon.rsplit(":", 1); return "%x:%s" % (int(loc, 16), src)
def norm(d): h, p = d.split(":", 1); return "%x:%s" % (int(h, 16), p.lower())


# winning records only: a later plugin's override (or deletion) replaces an earlier one
spel, mgef, book = {}, {}, {}
for p in lo.plugins:
    for ri, t, fid, fl, off, sz, ctx in lo.records(p, ("SPEL", "MGEF", "BOOK")):
        c = lo.canon(p, fid)
        if lo.winner(c) != p.name: continue
        if fl & DEL: continue
        sub = lo.subrecords(p, off, sz, fl)
        if t == "SPEL":
            spit = sub.get(b"SPIT", b"")
            efids = [lo.canon(p, struct.unpack("<I", bytes(v[:4]))[0]) for k, v in esplib.subrecords(lo.body(p, off, sz, fl)) if k == b"EFID" and len(v) >= 4]
            spel[c] = {"edid": edid(p, off, sz, fl), "type": struct.unpack("<I", spit[8:12])[0] if len(spit) >= 12 else -1, "mgefs": efids}
        elif t == "MGEF":
            d = sub.get(b"DATA", b"")
            if len(d) >= 16: mgef[c] = struct.unpack("<i", d[12:16])[0]
        else:
            d = sub.get(b"DATA", b"")
            if len(d) >= 8 and d[0] & 0x04:
                book[c] = {"edid": edid(p, off, sz, fl), "spell": lo.canon(p, struct.unpack("<I", d[4:8])[0])}

cfg = json.load(open(CONFIG, encoding="utf-8")).get("spells", {})
held = {norm(x): "removed" for x in cfg.get("removedSpells", [])}
held.update({norm(x): "suspended" for x in cfg.get("suspendedSpells", [])})

keep, out = {}, {}
for b, x in sorted(book.items()):
    c = x["spell"]
    s = spel.get(c)
    d = desc(c)
    why = None
    if not s: why = "no such spell"
    elif s["type"] not in (0, 2, 3): why = "an ability or disease (type %d)" % s["type"]
    elif SKIP.search(s["edid"]): why = "test/cut editor id"
    elif s["edid"].startswith("0_"): why = "mod internal"
    elif norm(d) in held: why = held[norm(d)]
    if why: out[d] = [s["edid"] if s else "", why, x["edid"]]
    else: keep[d] = [d, s["edid"], next((AVI[mgef[m]] for m in s["mgefs"] if mgef.get(m) in AVI), ""), c.rsplit(":", 1)[0]]

rows = sorted(keep.values(), key=lambda r: (r[3].lower(), r[1].lower()))
json.dump({"spells": rows, "left_out": out}, open(OUT, "w", encoding="utf-8"), indent=1)
print("tomes", len(book), "kept", len(rows), "left out", len(out))
