"""Rebuilds server\\spell-tomes.json (spells.js: the tome table for the study gate and the shop) from the LIVE load order
(Leader for Nat, 26 Oct: the file was last generated on the stale 105-plugin plugins.server.txt and missed 125 tomes).

A tome is a winning, undeleted BOOK with the teaches-spell flag (DATA flags 0x04) whose spell is a Spell (SPIT type 0) in a
magic school. The school is the spell's dominant effect:
  1. the half-cost perk's school word (SPIT perk, e.g. DestructionNovice00 or AlterationAdept50), when it names one;
  2. else the costliest effect, ranked by MGEF base cost x max(magnitude, 1)^1.1 x max(duration / 10, 1)^1.1 (EFIT);
     only the order matters here, so the max(.., 1) floors are a ranking choice, not the game's spell cost.
Rank is the perk's rank word, else the dominant effect's minimum skill (0-24 Novice ... 100 Master), as readables.py did.
Every EFID is read in order (core.subrecords is a dict and keeps only the last one, the 1 Oct Spectral Arrow bug).

Merge, never overwrite: a row already in the file keeps every field it has beyond the generated ones (rankWhy, dataRank,
hand ranks), and a row whose tome still exists in the order is never dropped. Rows whose tome no longer exists are
dropped and listed. Differences between the file and the records (school, rank) are listed, not applied, unless --apply-schools.

usage: py spell_tomes.py <Data dir> <loadorder.txt> <spell-tomes.json in> <spell-tomes.json out> <report.json> [--apply-schools]
       [--strings <Data dir with the vanilla strings tables>] (a staging folder of plugins alone has no Skyrim.esm strings:
       26 Oct, Flame Cloak and Ice Storm came out nameless; the dev install's Data has them)"""
import sys, json, struct, re
sys.path.insert(0, r"E:\DragonBreak Online Dev files\ck-mcp")
import core, esplib
from bsastrings import Strings

DATA, ORDER, IN, OUT, REPORT = sys.argv[1:6]
APPLY = "--apply-schools" in sys.argv
lo = core.LoadOrder(DATA, ORDER)
if lo.missing_plugins: sys.exit("missing plugins: %s" % lo.missing_plugins)
STRINGS = Strings(DATA)
STRINGS2 = Strings(sys.argv[sys.argv.index("--strings") + 1]) if "--strings" in sys.argv else None
def text(plugin, sid): return STRINGS.text(plugin, sid) or (STRINGS2.text(plugin, sid) if STRINGS2 else None)
AVI = {18: "Alteration", 19: "Conjuration", 20: "Destruction", 21: "Illusion", 22: "Restoration"}
SCHOOLS = list(AVI.values())
WORDS = ["Novice", "Apprentice", "Adept", "Expert", "Master"]
DEL = 0x20


def subs(p, off, sz, fl): return [(k, bytes(v)) for k, v in esplib.subrecords(lo.body(p, off, sz, fl))]
def first(sb, sig): return next((v for k, v in sb if k == sig), b"")
def edid(sb): return first(sb, b"EDID").rstrip(b"\0").decode("cp1252", "replace")
def full(p, sb):
    v = first(sb, b"FULL")
    if not v: return ""
    if p.hflags & 0x80: return (text(p.name, struct.unpack("<I", v)[0]) or "").strip() if len(v) == 4 else ""
    return v.rstrip(b"\0").decode("cp1252", "replace").strip()
def rank_of(level, perk=""):
    for i, w in enumerate(WORDS):
        if w.lower() in perk.lower(): return i
    return 0 if level < 25 else 1 if level < 50 else 2 if level < 75 else 3 if level < 100 else 4


spel, mgef, perk, book = {}, {}, {}, {}
for p in lo.plugins:
    for ri, t, fid, fl, off, sz, ctx in lo.records(p, ("SPEL", "MGEF", "PERK", "BOOK")):
        c = lo.canon(p, fid)
        if lo.winner(c) != p.name or fl & DEL: continue
        sb = subs(p, off, sz, fl)
        if t == "SPEL":
            spit = first(sb, b"SPIT")
            effects, cur = [], None
            for k, v in sb:
                if k == b"EFID" and len(v) >= 4: cur = {"mgef": lo.canon(p, struct.unpack("<I", v[:4])[0]), "mag": 0.0, "dur": 0}; effects.append(cur)
                elif k == b"EFIT" and cur is not None and len(v) >= 12: cur["mag"], _, cur["dur"] = struct.unpack("<fII", v[:12])
            pk = struct.unpack_from("<I", spit, 32)[0] if len(spit) >= 36 else 0
            spel[c] = {"edid": edid(sb), "full": full(p, sb), "type": struct.unpack_from("<I", spit, 8)[0] if len(spit) >= 12 else -1,
                       "effects": effects, "perk": lo.canon(p, pk) if pk else None}
        elif t == "MGEF":
            d = first(sb, b"DATA")
            if len(d) >= 44: mgef[c] = {"cost": struct.unpack_from("<f", d, 4)[0], "skill": struct.unpack_from("<i", d, 12)[0], "min": struct.unpack_from("<I", d, 40)[0]}
        elif t == "PERK":
            perk[c] = edid(sb)
        else:
            d = first(sb, b"DATA")
            if len(d) >= 16 and d[0] & 0x04:
                book[c] = {"edid": edid(sb), "full": full(p, sb), "spell": lo.canon(p, struct.unpack_from("<I", d, 4)[0]),
                           "value": struct.unpack_from("<I", d, 8)[0], "plugin": c.rsplit(":", 1)[0]}


def classify(s):
    perk_edid = perk.get(s["perk"], "") if s["perk"] else ""
    effs = [(e, mgef.get(e["mgef"])) for e in s["effects"]]
    effs = [(e, m) for e, m in effs if m]
    if not effs: return None
    first_e = effs[0][1]
    cost = lambda em: em[1]["cost"] * max(em[0]["mag"], 1.0) ** 1.1 * max(em[0]["dur"] / 10.0, 1.0) ** 1.1
    top = max(effs, key=cost)[1]
    by_perk = next((w for w in SCHOOLS if perk_edid.lower().startswith(w.lower()) or w.lower() in perk_edid.lower()), None)
    school = by_perk or AVI.get(top["skill"])
    if school is None: return None
    dom = top if not by_perk else next((m for e, m in sorted(effs, key=cost, reverse=True) if AVI.get(m["skill"]) == by_perk), top)
    return {"school": school, "rank": rank_of(dom["min"], perk_edid), "how": "perk" if by_perk else "cost",
            "firstSchool": AVI.get(first_e["skill"])}


gen, skipped = {}, {}
for b, x in book.items():
    s = spel.get(x["spell"])
    if not s: skipped[b] = "no such spell"; continue
    if s["type"] != 0: skipped[b] = "not a spell (type %d)" % s["type"]; continue
    k = classify(s)
    if not k: skipped[b] = "no magic school"; continue
    gen[b] = {"id": b, "name": x["edid"], "school": k["school"], "rank": k["rank"], "spell": s["edid"], "value": x["value"],
              "spellId": x["spell"], "plugin": x["plugin"], "fullName": x["full"], "spellName": s["full"], "_k": k}

src = json.load(open(IN, encoding="utf-8"))
old = {r["id"].upper(): r for r in src["tomes"]}
rows, report = [], {"added": [], "dropped": [], "school": [], "rank": [], "firstVsDominant": [], "kept_unclassified": [], "skipped": skipped}
for cid, g in gen.items():
    k = g.pop("_k")
    if k["firstSchool"] != k["school"]: report["firstVsDominant"].append([cid, g["spell"], k["firstSchool"], k["school"], k["how"]])
    o = old.pop(cid.upper(), None)
    if o is None:
        rows.append(g); report["added"].append([cid, g["spell"], g["school"], g["rank"], g["plugin"]]); continue
    r = dict(o)
    for f in ("name", "spell", "value", "spellId", "plugin", "fullName", "spellName"):
        if g[f] not in ("", None): r[f] = g[f]
    if o.get("school") != g["school"]:
        report["school"].append([cid, g["spell"], o.get("school"), g["school"], k["how"]])
        if APPLY: r["school"] = g["school"]
    hand_rank = "dataRank" in o
    if (o.get("dataRank") if hand_rank else o.get("rank")) != g["rank"]:
        report["rank"].append([cid, g["spell"], o.get("dataRank") if hand_rank else o.get("rank"), g["rank"], "hand rank kept" if hand_rank else ""])
        if hand_rank: r["dataRank"] = g["rank"]
        elif APPLY: r["rank"] = g["rank"]
    rows.append(r)
for cid, o in old.items():
    if cid in {b.upper() for b in book}: rows.append(o); report["kept_unclassified"].append([o["id"], o.get("spell"), skipped.get(next(b for b in book if b.upper() == cid))])
    else: report["dropped"].append([o["id"], o.get("spell")])
rows.sort(key=lambda x: (x["school"], x["rank"], x["name"]))
out = dict(src)
out["tomes"] = rows
json.dump(out, open(OUT, "w", encoding="utf-8", newline="\n"), indent=1, ensure_ascii=False)
json.dump(report, open(REPORT, "w", encoding="utf-8"), indent=1)
print("books", len(book), "tomes", len(gen), "rows", len(rows), {k: len(v) for k, v in report.items()})
