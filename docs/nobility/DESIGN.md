# Nobility: fiefs, titles and the fief treasury

Nate's decisions of 10 October 2026, built behind `gamemode-config.json` `nobility.enabled` (off).

| Layer | Branch | What it carries |
|---|---|---|
| Gameplay | server `nobility` | `nobility.js`, `nobility-fiefs.json` (+ `tools/nobility_fiefs.py`), the tax share in `economy.js`, the fief treasury in `bank.js`, config, harnesses, pending patch note |
| Server systems | fork `fork-nobility` (off `main`) | `housingSystem.ts`: a fief holder's powers and cap exemption |
| Front | fork `client-nobility-front` (off client line `26a4c137e`) | `features/nobility`: the F3 Nobility tab |

The fork branch is `fork-nobility`, not `nobility`, because the two repos share one remote and its branch names.

## 1. Titles

| Realm | Ruler (grants) | Landed title | Unlanded titles |
|---|---|---|---|
| Cyrodiil (a County) | Count / Countess | Baron / Baroness: holds a fief (a town) | Lord / Lady: an estate, no town. Knight / Dame: an honour |
| Skyrim (a Hold) | Jarl | Lord / Lady: holds a fief (a holding) | Thane: an honour |

- A zone's realm is `nobility.realms` (`{ "bruma": "cyrodiil" }`); any zone not listed is a Skyrim hold.
- Words follow the character's sex (`appearance.isFemale`): Baroness, Lady, Dame, Countess. Thane and Jarl do not change.
- Canon. A Count or Countess ruling each Cyrodiil county comes from Oblivion. So does the Thane, from Skyrim, where the Jarl
  grants it and a Housecarl comes with it. Baron as a landed Imperial title is canon in the Iliac Bay (Daggerfall's
  baronies), not in Cyrodiil's games; Nate approved it here. Knights in Cyrodiil come from the orders (Knights of the Thorn
  in Cheydinhal, Knights of the White Stallion in Leyawiin). A Knight/Dame rank granted by a Count is our own rule. Skyrim's
  games show no landed Lord under a Jarl, so the holding is ours too.
- The Thane's Housecarl is not built. Phase 1 records the title only; a Housecarl could later be a household rank (see §9).
- `court.js` already maps an office called `baron` to the hold faction's leader, and the fork's `MANAGER_RANKS` lists
  `baron` as a hold-wide manager. Both are old names for a hold's ruler. No zone has a `baron` office, and nobility
  titles are not offices, so neither ever applies to a nobility Baron. Never add a `baron` office to `zones.json`: it
  would make its holder a manager of the whole hold.

## 2. Data model

**Fiefs** (`nobility-fiefs.json`, tracked). `tools/nobility_fiefs.py` generates the file from the load order,
`buildings.json` and `doors-pos.json`. Never edit it by hand: change the tool's `FIEFS` table.

```
{ id, name, hold,                         // "mountain-watch", "Mountain Watch", "bruma" (Nate's choice)
  location, edid, county,                 // the town's LCTN: "6df40:BSHeartland.esm", CYRMountainwatchLocation, its plugin parent
  world, center, grid: [[x, y], ...],     // its exterior cells (XLCN = the town), 4096-unit cells
  cells: [desc, ...],                     // interior cells of its buildings
  buildings: [{ id, name, doors }] }      // the buildings.json entries whose way in stands in grid
```

**Titles** (`nobility.json`, runtime, gitignored). The file lives beside the gameplay and is written through a temp file.

```
{ nobles: [{ actor, profile, name, female, hold, title, fief?, estate?, at, by }],
  seeded: { "<seed key>": { at, actor, result } } }
```

- A title belongs to a **character**: `actor` is its actor id, the same key the property-per-character work uses for owners
  (`housingOwners.ts`: a player character's form id survives restarts, and a replacement in the same slot is a new actor).
  `profile` is kept for the cap comparison while property is still per account.
- Each character holds at most one title per hold, and each fief has one holder. A new grant to the same character replaces
  their title, and the decree says what it was.
- A deleted character's title lapses: `mp.get(actor, 'type')` throws, and the entry is left out of every view and lookup.

**Treasuries** live in `bank.json` under `fiefs: { "<fief id>": gold }`, beside the zone and faction balances. bank.js
exposes `__dboFiefTreasury` with only `balance(id)` and `deposit(id, n, why)`, and every deposit is audited. Nobody
can withdraw: no API, no bank action. The game may get a spend later.

## 3. Which fief a building is in

1. **Generated, by LCTN.** A town's exterior cells are the worldspace cells whose `XLCN` is the town's location. Its
   buildings are the `buildings.json` buildings with a way in (an entrance door, by `doors-pos.json`) in one of those
   cells. Every interior cell of those buildings is a fief cell. Two kinds are left out:
   - dungeon-flagged buildings: Fort Caractacus (Aleswell), Frostiron Mine (Mountain Watch);
   - buildings whose LCTN names the town but whose door stands elsewhere: Bleak Frost Mine names Mountain Watch, yet its
     door is near Applewatch.
2. **At runtime** (`nobility.js` `fiefOf(refs)`), each reference is checked as follows, and the first one that answers
   wins:
   - its `worldOrCellDesc` is a fief cell;
   - or it stands in the fief's world, and `floor(pos / 4096)` is one of the fief's grid cells.

   The fork passes the property itself, its teleport partner and its place's root, so a chest or a room door inside a house
   answers with the house's fief. Answers are cached per reference, and the cache is rebuilt on every hot reload.

| Fief | County (plugin) | Buildings |
|---|---|---|
| Applewatch | CYRBrumaCountyLocation | Aebond's, Benuni Alfenas's, Gergus Malumeas's houses |
| Aleswell | CYRHeartlandsLocation | Crextus Residence, Falegus Residence, the Inn, Mathias Endieri's, Umog dar-Seel's |
| Mountain Watch | CYRCheydinhalCountyLocation | Aubert's, Avring and Ervig's, the Bunkhouse, Zurikki's |

**Towns inside the Bruma lock.** The lock covers the whole BSHeartland worldspace. Every LCTN in it with a town-like
keyword (LocTypeTown, LocTypeCity, LocTypeSettlement, LocTypeHabitation), plus the parents of its dwellings, gives this
list:
- **Greenwood** (`CYRGreenwoodLocation`, LocTypeCity + Habitation, in CYRBrumaCountyLocation; the Meadery and Afer's
  house; one cell at grid [18, 42]) is the only real town that is not a fief. It is already a realm.js territory (a
  "village"). **For Nate:** add it with one line in the tool's `FIEFS`, or leave it.
- Bruma itself is the county seat. Jerall Hunter Shack (Habitation, no cells), Pale Pass (fort), Frostcrag Spire
  (guild) and Pell's Gate (in the plugin's Heartlands, with no exterior cells built) are not towns.
- **Canon note for Nate.** Beyond Skyrim places Aleswell in the Heartlands and Mountain Watch in Cheydinhal County, not in
  Bruma County. The plugin shows no LocType keywords for either. In Oblivion, Aleswell stands on the road north of the
  Imperial City. Both are Bruma's fiefs here because that is Nate's decision. The file records the plugin's county, in
  case he wants them to answer to another county once one opens.
- Mountain Watch has no realm.js territory. Its tax goes to the nearest territory marker's owner (Greenwood, the
  County's own today). A `mountain-watch` territory in `territories.json` would make that explicit.

## 4. Powers, and where each is enforced

| Power | Who | Enforced in |
|---|---|---|
| Grant, change, revoke a title or fief | The hold's ruler only: the leader of the hold faction (the character, guilds.js), or the account in the court's first office (`count`, `jarl`; officials.json). Never staff, a Steward, a conqueror, or a character of the ruler's own account. | `nobility.js` `rules()`, events `nobilityGrant` / `nobilityRevoke` |
| Audit and announcement | Every change | `nobility.js`: `audit("NOBILITY ...")`; `broadcast` of "By decree of the Countess of Bruma, Lord Elion is named Baron of Mountain Watch."; the noble is told in private |
| Manage property in the fief as a Steward does: claim to hand on, revoke, hand over, rename, cut and revoke keys, assign and share rooms and chests, open its locked doors | The fief's holder (that character), inside that fief only | fork `housingSystem.ts`: `isManager` adds `isFiefHolder`; `hasAccessWith` and `ownsOrManages` too. The gameplay's `__dboNobility.holdsFiefAt(actor, refs)` decides |
| Own any number of buildings in the fief | The holder's own claims there | fork `overCap(..., primary)` passes `fiefExempt`; `countPlaces` and `countClaims` skip buildings in a fief the owner's account holds. Another character of the account is capped as before. Loose chests and rooms stay under `housingMaxClaims` |
| No court power: tax rate, wages, assessments, arrests, posts, renting | Unchanged: court officials only | `__dboHousing.isManager` (economy.js `econValue`, tenancy.js) is now explicitly the hold-wide managers only. A new `__dboHousing.isFiefHolder` reports a fief holder separately. Taxes, appointments and arrests never ask about fiefs |
| Admin log | A holder's action on someone else's property | fork: `HOUSING fief holder: actor ...`, kept apart from `HOUSING staff override` |

With the switch off, `__dboNobility` answers no fief and no holder, so the fork behaves exactly as `main`.

## 5. The economy split

In `economy.js`'s weekly reckoning, for each taxed building:

- the tax is computed as today: the land owner's rate × the assessed value;
- if the building stands in a fief (`__dboNobilityFiefCut(ref, rec, tax)`), **`fiefShare` (25%), floored,** goes to the
  fief's treasury, and the faction gets the rest;
- if the fief treasury refuses the deposit, the faction takes the whole tax; if that fails too, the owner gets the share
  back;
- the faction's report carries `fiefShares`, and the leader's weekly line says "(and N gold to its fiefs' treasuries)";
- **Imperial tithe:** the rule is unchanged. `titheRate` applies to the tax *the faction collected* on Cyrodiil land,
  which is now what it kept after the fief's share. See §9 for the other reading.

Example (harness): two houses at 1000 gold, 20% tax. The Mountain Watch house gives 150 to the County and 50 to Mountain
Watch's treasury. The Bruma city house gives 200 to the County. The tithe is 35 (10% of 350).

## 6. The F3 Nobility tab

The journal section is `nobility`, labelled "Nobility". It is visible to everyone while the switch is on, and only to a
front whose caps list `journalTab:nobility`. The front adds that automatically by registering the tab. The section
lands at `payload.nobility`:

```
{ enabled, fiefShare: 25, selected: "bruma",
  holds: [{ id, name, realm, ruler: { name, style: "Countess of Bruma" } | null, isRuler,
            fiefs: [{ id, name, buildings, holder: Noble | null, treasury: number | null }],   // treasury: ruler, or that fief's holder
            roll: [Noble],
            titles: [{ id, label: "Baron / Baroness", needs: "fief" | "estate" | "" }] }],      // the ruler only
  mine: [{ hold, label, since, fief: { id, name, treasury, properties: [{ ref, name, owner }] } | null }] }
Noble = { actor: hex, name, tag, online, title, label: "Baron of Mountain Watch", fief, estate, since }
```

- Holds shown: those with fiefs or titles, and any the viewer rules.
- Events, with the journal nonce first, answer through `__dboJournalLimited`, and the result goes to the footer:
  - `dbo:nobilityGrant [nonce, holdId, nameOrTag, titleId, fiefId | estateName]`
  - `dbo:nobilityRevoke [nonce, holdId, actorHex]`
- An estate name is 2-40 letters, spaces, hyphens or apostrophes, and is checked against the journal's prose filter.
- `/nobility` in chat opens the tab, or prints the rolls for a client without it.
- No client change: the journal widget (id 50) carries the section as it carries `court`. The tab reaches players only in a
  client package built from a client line with the front commit.

## 7. Migration: Lord Elion

The interim workaround lifts Elion's one-building cap. Either `housingPlaces.staffProfiles` holds 49 (on `server`
today), or the unmerged `housingPlaces.uncappedProfiles [49]` does (server `housing-uncapped` 8345d283 with fork
`housing-uncapped-profiles` 83e6436e9).

Nobility replaces it:

1. `nobility.seed` already holds `{ fief: "mountain-watch", title: "baron", profile: 49, name: "Elion" }`. On the first
   minute tick with the switch on, the seed finds the one character of account 49 whose name carries "Elion" (whole
   words, so "Lord Elion" matches). If Mountain Watch is vacant, it names him Baron of Mountain Watch, audits it as the
   migration and proclaims the decree. It records the seed in `nobility.json`, so it never runs twice, even after a
   revocation. If no single character matches, it waits and logs once.
2. In the same release, take 49 out of `housingPlaces.staffProfiles`, and do not ship `uncappedProfiles`. Without that,
   his claims stay out of the place plan. If `housing-uncapped` has already shipped, remove `uncappedProfiles` instead.
   His Mountain Watch buildings then join the place plan as ordinary claims, and the cap leaves them alone because they
   stand in his fief.
3. Check his buildings outside Mountain Watch, if he has any. They count normally, and the cap keeps what he holds
   ("nobody loses anything") but refuses him a new one.

## 8. Compatibility with property-per-character

That branch is uncommitted in `/tmp/claude-nate-wt-propchar*`: `ownerChar` on records, `ownsAs`, `housingOwners.ts`.

- Titles are already per character, by actor id. `holderOf` returns `{ actor, profile }`.
- The fork compares `holder.profile === rec.owner` (account ownership, today) and, for a character-precise question
  (`overCap`), `holder.actor === actorId`. Once `ownerChar` lands, `fiefExempt` should become "holder.actor ===
  (rec.ownerChar || the record's account's actor)". That is a one-line change in `fiefExempt` and `countPlaces`.
- The merge conflicts are small: the two branches touch neighbouring lines in `overCap`, `countPlaces` and
  `countClaims`.

## 9. Open questions for Nate

1. **Greenwood**: a fourth fief of Bruma? It is a real (small) town in Bruma County by the plugin.
2. **Aleswell and Mountain Watch** are in the Heartlands and Cheydinhal County in Beyond Skyrim's data. Keep them Bruma's,
   as decided?
3. **Tithe base**: built as 10% of what the County kept, so a fief's share pays no tithe. The other reading is 10% of
   the whole tax, with the County paying the fief's part too.
4. **On revocation**, the Baron keeps the buildings he owns in the fief (no one loses property); he is capped for new
   ones. Should the fief's buildings instead go back to the County?
5. **Renting** (tenancy.js) and **assessing** values stay with the court. Should a Baron also list his town's houses
   for rent, and where would the rent go?
6. **Staff**: by Nate's rule, only the ruler grants. With no ruler seated, nobody can name or revoke a noble. Should a
   Lead GM be able to revoke in an emergency?
7. **Thane's Housecarl**: a household rank, a companion, or only roleplay?
8. **Spending the fief treasury**: what for (town upkeep, guards, building repairs), and on whose word?

## 10. Shipping

| Piece | What it needs |
|---|---|
| Gameplay (`nobility.js`, economy.js, bank.js, data, config) | Push `server`, then `deploy-gameplay` (a hot reload). Safe with the switch off: no tab, no fief power, no tax change |
| Fork `fork-nobility` | Push `main` (the updater builds and restarts). Inert while the gameplay switch is off or absent |
| Front `client-nobility-front` | Cherry-pick 127a96727 onto the client line, then a client package and a launcher download. Until then a journal without the tab simply is not offered it |
| Switching on | `nobility.enabled: true` in the live `gamemode-config.json` (hot reload, Nate in session). In the same release, take 49 out of `housingPlaces.staffProfiles` (see §7). Move `docs/patch-notes-pending/nobility.json` to the top of `patch-notes.json`, dated that day, and `deploy-news` |
| Backups | `nobility.json` is new runtime state, and `bank.json` gains `fiefs`. Add `nobility.json` to the state backups (`backups-journal` / dragonbreak-tools) |

Tests: `tests/nobility-harness.js` (gameplay, economy, bank),
`tests/housing-fief-harness.js <housingSystem bundle>` and
`tests/nobility-front-harness.js <front bundle>`. The last two are registered in `run-all.sh`.
