// Spell study, the spellbook and prepared spells, teaching and the Synod tome shop, loaded by gamemode.js like jail.js.
//
// Reading a spell tome is refused unless the reader has taken up the school's skill (arcane: Destruction,
// Conjuration, Illusion; priest: Restoration, Alteration), the tome's rank fits their tier, they stand at a spell
// study point (skills.json spellStudyPoints) and a slot of that skill is free. A Novice tome read at a study point
// takes the skill up for one pool point when the reader has not (masterySystem's __alduinakMasteryFirstTouch). A refused read keeps the tome and the
// engine takes the spell back off the client (ReadBookEvent::OnFireBlocked sends Actor.RemoveSpell).
// Prepared spells (Nate, 2026-09-28: "a panel to set what 3 spells you want active/prepared at a time instead of
// unlearning/forgetting a spell"): every spell studied or taught stays in the character's spellbook, with no limit, and
// at most `prepared` (3) of them, whatever their school, are on the character at a time (Actor.AddSpell / RemoveSpell).
// The spellbook panel (/spells, front widget "spellbook") shows them all; the prepared ones are changed only at a magic
// college (prepareCells: the Synod Conclave, the College of Winterhold) or beside a Scholars' Ledger. The College of
// Whispers' hall, Frostcrag Spire, is not a prepareCells college: its mages change them at its ledger (Nate, 4 Oct).
// Spells the engine holds outside the book (granted outright, never studied) take no place. /forget is retired.
// /teach passes a spell to a nearby player. The college tome shop inside the Synod enclave opens from a button on the
// Scholars' Ledger there (salvage.js; Nate, 10 Oct: "replace /Tomes with a button in Scholar ledger"); /tomes still opens
// it for now and says to use the ledger (tomesCommand). A tome's price is split by ledgersale.js between the building's
// owner, the hold's tax and a sink (shopSplit), not paid whole into shopTreasury. Tomes are classified from spell-tomes.json (ck-mcp/readables.py), and any
// tome missing from it is read from its records at runtime. The shop stocks only the tomes regions.js sells in
// shopProvince; /teach carries a spell anywhere.
// By college rank (Elion and Aldemar's proposal, Nate 11 Oct): plain members above Initiate buy up to Apprentice tomes,
// Senior ranks and above up to Expert (shopRankByRole), one in any 3 days for a Senior, one a week for the rest; the restricted arts
// (seniorOnlyTomes: raising the dead, the Daedra lords, banishing Daedra) only from Senior up. A Senior at their own
// college's Scholars' Ledger or Class Lectern teaches a spell to a member standing by (collegeTeach), spending a tome of
// it they carry or their tome purchase of the window; audited TEACH.
// When a Class Lectern class ends, its spell is offered to each student paid for it (__dboSpellsClassOffer), under the
// same student rules. The class costs its teacher one lesson credit (a tome of the spell, else the day's tome purchase),
// spent when the first student accepts; the rest of that class learn it on the same credit (Nate, 11 Oct: "fix the hole").
//
// A Master Scholar writes spell tomes and scrolls at a Scholars' Ledger: scribing.js (Nate, 16 Oct; Swag's rules, 17 Oct). This
// file only names the tome of each spell for it (__dboSpellsTomeOf).
//
// State, on the character:
//   private.dboStudied       { arcane: [spell desc...], priest: [...] }  the spellbook: every spell learned through this system
//   private.dboPrepared      [spell desc...]                           the prepared ones, at most `prepared`
//   private.dboTomeBoughtAt  ms of the last shop purchase
//   private.dboTomeWrites    { rank: ms } the last tome written of each rank, before 17 Oct (scribing.js reads it once)
//   private.dboSpellTrims    { id: { at, by, why, removed, ... } } the staff trims applied to the character (staffTrims below)

const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, system, audit, display, who, cfg, openWidget, closeWidget, onUi, registerChatCommand,
    onlineActors, distanceMeters, takeGold, giveItem, depositToTreasury } = api;

  const CFG = Object.assign({
    enabled: true,
    // How many studied spells are on the character at once, and where they are changed (the magic colleges)
    prepared: 3,
    // Spells taken out of the game (Nate, 11 Oct: Transmute Mineral Ore "breaks economies", turning iron into silver and gold):
    // never sold, read, taught or given, and taken from anyone who knows them at their next login
    removedSpells: ['109111:Skyrim.esm'],
    // Spells held back for a while (staff, for a fix): they stay in the spellbook but are taken off the prepared list and out
    // of the engine at login and at the next check, cannot be prepared, and are not read, taught, given or passed on. Taking
    // one off this list changes nothing on the characters: it is prepared again at a college as usual.
    suspendedSpells: [],
    prepareCells: ['20ff:BSHeartland.esm', '6c152:BSHeartland.esm',                             // the Synod Conclave, Bruma
      '12cb:BSHeartland.esm', '5f78c:BSHeartland.esm', '5f78d:BSHeartland.esm',                 // the Cathedral of St Martin, Bruma
      '1380e:Skyrim.esm', '1380f:Skyrim.esm', 'cab91:Skyrim.esm', '13810:Skyrim.esm', 'cab92:Skyrim.esm'], // College of Winterhold halls
    teachMeters: 5,
    // Only a Master teaches, and only spells of Adept rank and above (Nate, 2026-10-06); the student must be able to learn
    // the spell now by the checks a tome read applies (slotRefusal: the tier for the rank, the study of the school)
    teacherMinTier: 4,
    teachMinRank: 2,
    studentMinTier: 1,
    teachAtStudyPoint: false,
    offerSeconds: 60,
    // How long a class's spell stays offered to its students after the class (schools.js classes.offerSpell)
    classOfferSeconds: 180,
    shopCells: ['20ff:BSHeartland.esm', '6c152:BSHeartland.esm'],
    shopFactions: ['synod', 'college-of-winterhold', 'college-of-whispers', 'great-faiths'],
    // A faith's temple or a college's own hall sells like the Synod's ledger (Nate, 11 Oct: "Priests in the temples ... the
    // same/similar abilities as the Colleges"; the College of Whispers at its own Frostcrag Spire). schools: what it stocks
    // and teaches (none: every school); exclusive: its factions buy only there, not at the Synod. A cell not listed in a
    // place is the Synod's: every shop faction no exclusive place holds, every school.
    shopPlaces: [
      { name: 'The Great Faiths', cells: ['12cb:BSHeartland.esm', '5f78c:BSHeartland.esm', '5f78d:BSHeartland.esm'], factions: ['great-faiths'], schools: ['Restoration', 'Alteration'], exclusive: true },  // the Cathedral of St Martin, Bruma
      { name: 'The College of Whispers', cells: ['781ad:BSHeartland.esm', '6ff7d:BSHeartland.esm'], factions: ['college-of-whispers'] },  // Frostcrag Spire
    ],
    shopMinTier: 1,
    shopMaxRank: 3,
    shopPriceMultiplier: 1,
    shopCooldownDays: 7,
    // Tomes by college rank (Elion and Aldemar's proposal for the College of Whispers, Nate 11 Oct): the highest tome rank
    // each guild role buys (guild-defs.json roles; the crafting posts and the joining rank, Initiate, buy none). Plain
    // members above Initiate (Mage of the Synod, Whisperer, Wizard, Associate, Scholar, Novice, Apprentice) buy up to
    // Apprentice (1); Senior ranks (sergeant) and above up to Expert (3, never above shopMaxRank). A role not listed buys
    // as `member`.
    shopRankByRole: { leader: 3, officer: 3, sergeant: 3, mage: 1, member: 1 },
    seniorRoles: ['sergeant', 'officer', 'leader'],
    // A Senior rank or above has shopSeniorPerWindow tomes in any rolling shopSeniorWindowDays, bought or taught with (below,
    // a class's spell too); everyone else one in shopCooldownDays (Nate, 11 Oct: one a day for Seniors, so a college with
    // several students can be taught, while every spell taught still costs a tome; later on 11 Oct: one in any 3 days,
    // was two in 7)
    shopSeniorPerWindow: 1,
    shopSeniorWindowDays: 3,
    // Spell tomes from a Scholar's reading (gamemode.js scholarTomePick), by college rank (Nate, 11 Oct: "RP gate-keep the
    // high tiers"): a reader gets tomes up to the rank their college rank buys (shopRankByRole, or byRole when set, for
    // reading only), never below floorRank (Adept since Nate 14 Oct: no college, an Initiate or a smith still reads up to Adept
    // tomes) and never above maxRank (Expert; a Master tome only from gamemode.js's rare roll at Scholar 100, for Senior ranks). The
    // Scholar tier's own cap (reading.tomeRankByTier) still applies on top. restricted: the restricted arts
    // (seniorOnlyTomes) come from reading only to Senior ranks and above, as at the shop. enabled false: the Scholar
    // tier alone decides, as before.
    readGate: { enabled: true, floorRank: 2, maxRank: 3, byRole: null, restricted: true },
    // Restricted arts, sold (and taught) only to Senior ranks and above: raising the dead and calling the Daedra lords, and
    // the spells that banish or command Daedra. Tome editor ids from spell-tomes.json; the shop's own filters (shopMaxRank,
    // the province, shopExcludePattern) still apply on top, so some are listed only so that they stay restricted.
    seniorOnlyTomes: [
      // raising the dead
      'SpellTomeRaiseZombie', 'SpellTomeReanimateCorpse', 'SpellTomeRevenant', 'SpellTomeDreadZombie', 'SpellTomeDeadThrall',
      'CYRSpellTomeSummonZombie', 'CYRBrumaFF03SpellTome',
      // the dead of the Soul Cairn (Nate, 11 Oct: necromancy)
      'DLC1SpellTomeConjureBoneman', 'DLC1SpellTomeConjureMistman', 'DLC1SpellTomeConjureWrathman',
      // intelligent Daedra: the Dremora lord, Golden Saints and Dark Seducers, Staada
      'SpellTomeConjureDremoraLord', 'ccBGSSSE025_SpellTomeConjureGoldenSaintArcher', 'ccBGSSSE025_SpellTomeConjureGoldenSaintWarrior',
      'ccBGSSSE025_SpellTomeConjureDarkSeducerArcher', 'ccBGSSSE025_SpellTomeConjureDarkSeducerWarrior', 'ccBGSSSE025_SpellTomeConjureStaada',
      // banishing and commanding Daedra
      'SpellTomeBanishDaedra', 'SpellTomeExpelDaedra', 'SpellTomeCommandDaedra',
    ],
    // Teaching at a college (Nate, 11 Oct): a Senior rank or above, at their own college's Scholars' Ledger or Class
    // Lectern, spends one of their tome purchases (or a tome of the spell they carry) to teach a spell to a member of the same college
    // within radiusMeters of it. The student learns as a lesson does; a member is taught up to the rank they may buy, and
    // never below studentMinCap (Apprentice), so an Initiate or a smith can still be taught their first spells.
    collegeTeach: { enabled: true, radiusMeters: 15, studentMinCap: 1 },
    // Tomes the Synod sells to Senior ranks although the province does not stock them (Elion and Aldemar: Banish Daedra
    // is a Skyrim tome, so the conjuration teacher could never buy it). Tome editor ids.
    shopSeniorTomes: ['SpellTomeBanishDaedra'],
    // The shelf: shopStock tomes the buyer can learn now, chosen by a seed of the UTC week (Monday 00:00) and the shop, so
    // everyone at the shop sees the same rotation that week (Nate, 2026-10-06: "only 3-4 at a time ... so Scholar is still
    // worth it")
    shopStock: 4,
    shopTreasury: 'bruma',
    // ledgersale.js splits each tome's price (owner, tax, sink); off, or without ledgersale.js, it all goes to shopTreasury
    shopSplit: true,
    // The Scholars' Ledger in shopCells shows a "Buy spell tomes" button (salvage.js); /tomes keeps working and points to it
    shopAtLedger: true,
    tomesCommand: true,
    shopPreferPlugins: ['BSHeartland.esm', 'BSAssets.esm'],
    shopExcludePlugins: ['Gray Fox Cowl.esm', 'SurWR.esp'],
    // WillotheWisp: the summon crashes the game (gamemode.js castBlocks)
    shopExcludePattern: '^(dun|MGR)|quest|FF\\d\\d|WillotheWisp',
    shopProvince: 'cyrodiil',
    // Workshops the guilds keep for their own (a ref's CYRBlockedFactionWorkshop script, which the server never runs)
    guildWorkshops: ['651cb:BSHeartland.esm'],
  }, cfg.spells || {});

  const SHOP_ID = 44;
  const MENU_ID = 45;
  const BOOK_ID = 58;
  const GOLD = 0xf;
  const DAY = 86400000;
  const MAX_ROWS = 12;
  const RANKS = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'];
  const AV_SCHOOL = { 18: 'Alteration', 19: 'Conjuration', 20: 'Destruction', 21: 'Illusion', 22: 'Restoration' };
  const STUDIED = 'private.dboStudied';
  const PREPARED = 'private.dboPrepared';
  const BOUGHT = 'private.dboTomeBoughtAt';
  const BUYS = 'private.dboTomeBuys'; // ms of each purchase (or lesson taught with one) within the window, newest last

  const readJson = (file) => { try { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); } catch (e) { log(`spells: ${file} unreadable`, e.message); return null; } };
  const get = (id, prop, dflt) => { try { const v = mp.get(id, prop); return v === undefined || v === null ? dflt : v; } catch (e) { return dflt; } };
  const set = (id, prop, v) => { try { mp.set(id, prop, v); return true; } catch (e) { log(`spells: set ${prop} failed`, e.message); return false; } };
  const idOf = (desc) => { try { return mp.getIdFromDesc(String(desc)) >>> 0; } catch (e) { return 0; } };
  const descOf = (id) => { try { return String(mp.getDescFromId(id >>> 0)); } catch (e) { return ''; } };
  const norm = (d) => { const s = String(d || ''); const i = s.indexOf(':'); if (i < 0) return s.toLowerCase(); const n = parseInt(s.slice(0, i), 16); return (Number.isFinite(n) ? n.toString(16) : s.slice(0, i).toLowerCase()) + ':' + s.slice(i + 1).toLowerCase(); };
  // 'Skyrim.esm:09E2A7' -> '9e2a7:Skyrim.esm'
  const canonToDesc = (c) => { const i = String(c).lastIndexOf(':'); return i < 0 ? '' : `${parseInt(c.slice(i + 1), 16).toString(16)}:${c.slice(0, i)}`; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const humanize = (edid) => String(edid || 'a spell')
    .replace(/^(ccBGSSSE\d+_|manny_GF_Spell_|ISS_|CYR|BSK|DLC\d)/, '').replace(/^(SpellTome)/, '')
    .replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim() || 'a spell';

  // ---- skills and tiers ------------------------------------------------------------------------------
  const SKILLS_JSON = readJson('skills.json') || {};
  const TIER_NAMES = Array.isArray(SKILLS_JSON.tierNames) ? SKILLS_JSON.tierNames : ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'];
  const SPELL_SKILLS = (Array.isArray(SKILLS_JSON.skills) ? SKILLS_JSON.skills : []).filter((s) => s && s.studyAt === 'spellStudyPoints');
  const SKILL_OF_SCHOOL = {};
  for (const s of SPELL_SKILLS) for (const school of s.vanillaSkills || []) SKILL_OF_SCHOOL[school] = s;
  const skillDef = (id) => SPELL_SKILLS.find((s) => s.id === id) || null;
  // Tier index 0..4 of a taken-up skill, -1 when not taken up
  const tierOf = (a, skillId) => {
    const r = get(a, 'private.mastery', null);
    if (!r || !Array.isArray(r.order) || !r.order.includes(skillId)) return -1;
    return Math.max(0, Math.min(4, Number(((r.skills || {})[skillId] || {}).rank) || 0));
  };
  const maxRankFor = (skillId, tier) => {
    if (tier < 0) return -1;
    const by = (skillDef(skillId) || {}).spellRankByTier;
    const i = Array.isArray(by) ? RANKS.indexOf(by[tier]) : -1;
    return i >= 0 ? i : tier;
  };

  // ---- study points ----------------------------------------------------------------------------------
  // An entry of skills.json spellStudyPoints is `cells` (or `cell`) alone: anywhere in them; `cell` + `refr`: within
  // radiusMeters of that reference; or `cell` + `places` [{ refr, pos }]: within radiusMeters of any of them, measured
  // from the plugin position (tools/spells/study_points.py writes these for the Study Magic activators, so a reference
  // nobody has loaded still counts). `requires` (a record desc): the entry counts only when that record is in the load
  // order; `until`: only while it is not. The Study Magic activators replace the older points that way (Nate,
  // 2026-09-30: "make StudyMagic activators the study points"), and the older ones hold until the plugin with them is live.
  const UNITS_PER_METER = 70; // as gamemode.js
  const inLoadOrder = (desc) => { try { const id = idOf(desc); const r = id ? mp.lookupEspmRecordById(id) : null; return !!(r && r.record); } catch (e) { return false; } };
  const STUDY_POINTS = (Array.isArray(SKILLS_JSON.spellStudyPoints) ? SKILLS_JSON.spellStudyPoints : [])
    .filter((p) => p && (!p.requires || inLoadOrder(p.requires)) && (!p.until || !inLoadOrder(p.until))).map((p) => ({
      name: String(p.name || 'a spell study point'),
      cells: new Set([].concat(p.cells || [], p.cell ? [p.cell] : []).map(norm)),
      refr: p.refr ? String(p.refr) : null,
      places: Array.isArray(p.places) ? p.places.filter((q) => q && Array.isArray(q.pos) && q.pos.length === 3).map((q) => q.pos.map(Number)) : null,
      radius: Number(p.radiusMeters) || 6,
      schools: Array.isArray(p.schools) ? p.schools : Object.keys(AV_SCHOOL).map((k) => AV_SCHOOL[k]),
    }));
  const nearPlace = (a, p) => {
    const pos = get(a, 'pos', null);
    return Array.isArray(pos) && p.places.some((q) => Math.hypot(pos[0] - q[0], pos[1] - q[1], pos[2] - q[2]) / UNITS_PER_METER <= p.radius);
  };
  const studyPointAt = (a, school) => {
    const cell = norm(get(a, 'worldOrCellDesc', ''));
    return STUDY_POINTS.find((p) => p.cells.has(cell) && (!school || p.schools.includes(school))
      && (p.places ? nearPlace(a, p) : !p.refr || distanceMeters(a, idOf(p.refr)) <= p.radius)) || null;
  };
  // The nearest study spot of the school in the reader's own cell, { meters, radius } (its place's radiusMeters), or null
  // when the cell has none: a reader inside Frost Crag Spire or the Synod was told only the places' names, which named
  // the place they stood in. Places differ in radius (Frost Crag Spire 8 m, the others 4), so the hint says which.
  const nearestHere = (a, school) => {
    const cell = norm(get(a, 'worldOrCellDesc', ''));
    const pos = get(a, 'pos', null);
    let best = null;
    if (Array.isArray(pos)) {
      for (const p of STUDY_POINTS) {
        if (!p.places || !p.cells.has(cell) || !p.schools.includes(school)) continue;
        for (const q of p.places) {
          const meters = Math.hypot(pos[0] - q[0], pos[1] - q[1], pos[2] - q[2]) / UNITS_PER_METER;
          if (!best || meters < best.meters) best = { meters, radius: p.radius };
        }
      }
    }
    return best;
  };
  const studyPointNames = (school) => [...new Set(STUDY_POINTS.filter((p) => p.schools.includes(school)).map((p) => (p.places ? `Study Magic in ${p.name.replace(/^The /, 'the ')}` : p.name)))].join(', ');

  // ---- spells and tomes ------------------------------------------------------------------------------
  const lookup = (id) => { try { const r = id ? mp.lookupEspmRecordById(id >>> 0) : null; return r && r.record ? r : null; } catch (e) { return null; } };
  const field = (rec, type) => { const f = ((rec && rec.record && rec.record.fields) || []).find((x) => x && x.type === type && x.data); return f ? f.data : null; };
  const u32 = (data, off) => (data && data.byteLength >= off + 4 ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(off, true) : 0);
  const toGlobal = (rec, local) => { try { return local && rec && typeof rec.toGlobalRecordId === 'function' ? rec.toGlobalRecordId(local) >>> 0 : 0; } catch (e) { return 0; } };

  // Rank from the half-cost perk's editor id (DestructionAdept50), else the first effect's minimum skill level
  const rankFrom = (level, perkEdid) => {
    const i = RANKS.findIndex((w) => String(perkEdid || '').toLowerCase().includes(w.toLowerCase()));
    if (i >= 0) return i;
    return level < 25 ? 0 : level < 50 ? 1 : level < 75 ? 2 : level < 100 ? 3 : 4;
  };
  const spellCache = new Map();
  // { id, desc, school, rank, name } of a castable school spell, or null
  const classifySpell = (spellId) => {
    spellId >>>= 0;
    if (spellCache.has(spellId)) return spellCache.get(spellId);
    let out = null;
    const spel = lookup(spellId);
    if (spel && String(spel.record.type) === 'SPEL') {
      const spit = field(spel, 'SPIT');
      const efid = field(spel, 'EFID');
      const mgef = lookup(toGlobal(spel, u32(efid, 0)));
      const data = field(mgef, 'DATA');
      // SPIT: type at 0x08 (0 = spell), perk at 0x20; MGEF DATA: magic skill at 0x0C, minimum skill level at 0x28
      if (spit && spit.byteLength >= 36 && u32(spit, 8) === 0 && data && data.byteLength >= 0x2c) {
        const school = AV_SCHOOL[u32(data, 0x0c)];
        const perk = lookup(toGlobal(spel, u32(spit, 0x20)));
        if (school) out = { id: spellId, desc: descOf(spellId), school, rank: rankFrom(u32(data, 0x28), perk && perk.record.editorId), name: humanize(spel.record.editorId) };
      }
    }
    spellCache.set(spellId, out);
    return out;
  };

  const TOMES = new Map(); // book id -> { bookId, spellId, school, rank, name, value, plugin, edid }
  const TOME_LIST = (readJson('spell-tomes.json') || {}).tomes || [];
  for (const t of TOME_LIST) {
    const bookId = idOf(canonToDesc(t.id)); const spellId = idOf(canonToDesc(t.spellId));
    if (!bookId || !spellId || !(Number(t.rank) >= 0)) continue;
    const name = String(t.spellName || '') || humanize(t.spell);
    TOMES.set(bookId, { bookId, spellId, school: String(t.school), rank: Number(t.rank), name, title: String(t.fullName || '') || `Spell Tome: ${name}`, value: Math.max(0, Number(t.value) || 0), plugin: String(t.id).split(':')[0], edid: String(t.name || '') });
    if (!spellCache.has(spellId)) spellCache.set(spellId, { id: spellId, desc: descOf(spellId), school: String(t.school), rank: Number(t.rank), name });
  }
  const tomeCache = new Map();
  // null: not a spell tome; { unknown: true }: teaches a spell nobody could classify
  const tomeOf = (bookId) => {
    bookId >>>= 0;
    if (TOMES.has(bookId)) return TOMES.get(bookId);
    if (tomeCache.has(bookId)) return tomeCache.get(bookId);
    let out = null;
    const book = lookup(bookId);
    if (book && String(book.record.type) === 'BOOK') {
      // BOOK DATA: flags at 0x00 (0x04 teaches a spell), spell at 0x04, value at 0x08
      const data = field(book, 'DATA');
      if (data && data.byteLength >= 12 && (data[0] & 0x04)) {
        const sp = classifySpell(toGlobal(book, u32(data, 4)));
        out = sp ? { bookId, spellId: sp.id, school: sp.school, rank: sp.rank, name: sp.name, title: `Spell Tome: ${sp.name}`, value: u32(data, 8), plugin: '', edid: String(book.record.editorId || '') } : { unknown: true, edid: String(book.record.editorId || '') };
      }
    }
    tomeCache.set(bookId, out);
    return out;
  };

  // Spells the server has learned for the actor (not race or base spells), or null when it cannot tell.
  // One read serves the rest of the server tick, and never more than LEARNED_KEEP_MS (17 Oct): the fork's GetNthSpell
  // walks the whole list and re-reads the actor's base records for every index, so N spells cost about N x N record reads
  // (331 spells: about 4.5 s a read), and one Magic tab draw read the list three times. A kept list is used only while
  // GetSpellCount (one walk, about 1/N of a read) still gives the count it was read at, and an AddSpell or RemoveSpell
  // through this file's papyrus(), manuals.js's or schools.js's forgets it at once (__dboSpellsLearnedChanged; only a
  // RemoveSpell the engine confirms here takes just that spell off instead, see papyrus), so a swap that keeps the count is
  // never missed. manuals.js reads through here (__dboSpellsLearned).
  const LEARNED_KEEP_MS = 1000;
  const learnedKept = new Map(); // actor -> { n, ids, at (performance.now) }
  let learnedSweep = false;
  const forgetLearned = (a) => { learnedKept.delete(Number(a) >>> 0); };
  const keepLearned = (a, n, ids) => {
    learnedKept.set(Number(a) >>> 0, { n, ids: ids.slice(), at: performance.now() });
    if (learnedSweep) return;
    learnedSweep = true;
    // The end of this tick: the server's loop (and the timers due with it) gives way before an immediate runs
    const later = typeof setImmediate === 'function' ? setImmediate : (f) => setTimeout(f, 0);
    later(() => { learnedSweep = false; learnedKept.clear(); });
  };
  const learnedIds = (a) => {
    try {
      const self = { type: 'form', desc: descOf(a) };
      const n = Number(mp.callPapyrusFunction('method', 'Actor', 'GetSpellCount', self, [])) || 0;
      const kept = learnedKept.get(Number(a) >>> 0);
      if (kept && kept.n === n && performance.now() - kept.at <= LEARNED_KEEP_MS) return kept.ids.slice();
      const out = [];
      for (let i = 0; i < n; i++) {
        const s = mp.callPapyrusFunction('method', 'Actor', 'GetNthSpell', self, [i]);
        if (s && s.desc) out.push(idOf(s.desc));
      }
      keepLearned(a, n, out);
      return out;
    } catch (e) { log('spells: learned list failed', e.message); return null; }
  };
  globalThis.__dboSpellsLearned = learnedIds;
  globalThis.__dboSpellsLearnedChanged = forgetLearned;
  const knows = (a, spellId) => { const l = learnedIds(a); return !!l && l.includes(spellId >>> 0); };
  // A spell an apprentice holds on loan from their teacher (schools.js apprenticeship) is not theirs to pass on
  const onLoan = (a, spellId) => { try { return typeof globalThis.__dboSchoolsOnLoan === 'function' && !!globalThis.__dboSchoolsOnLoan(a, spellId >>> 0); } catch (e) { return false; } };
  const ownLearned = (a) => (learnedIds(a) || []).filter((id) => !onLoan(a, id));
  // A RemoveSpell the engine confirms (true only when it held that spell, learned in play: PapyrusActor::RemoveSpell) leaves
  // the kept list less that one spell, so a login that holds back a spell and then strips a removed one reads the list once.
  // Anything else forgets it.
  const papyrus = (a, fn, spellId, extra) => {
    let ok = false;
    try { ok = mp.callPapyrusFunction('method', 'Actor', fn, { type: 'form', desc: descOf(a) }, [{ type: 'espm', desc: descOf(spellId) }].concat(extra || [])) === true; return ok; }
    catch (e) { log(`spells: ${fn} ${descOf(spellId)} failed`, e.message); return false; }
    finally {
      const kept = learnedKept.get(Number(a) >>> 0), id = Number(spellId) >>> 0;
      if (ok && fn === 'RemoveSpell' && kept && kept.ids.filter((x) => x === id).length === 1) { kept.ids = kept.ids.filter((x) => x !== id); kept.n -= 1; }
      else forgetLearned(a);
    }
  };

  const REMOVED = new Set((CFG.removedSpells || []).map(idOf).filter(Boolean));
  const removed = (spellId) => REMOVED.has(Number(spellId) >>> 0);
  const SUSPENDED = new Set((CFG.suspendedSpells || []).map(idOf).filter(Boolean));
  const suspended = (spellId) => SUSPENDED.has(Number(spellId) >>> 0);
  const nameOf = (spellId) => { const sp = classifySpell(spellId); return sp ? sp.name : 'That spell'; };
  // suspendedReasons { desc: why } says why a spell is held, in the line its caster reads (Nate, 17 Oct: the mount summons)
  const HELD_WHY = new Map(Object.entries(CFG.suspendedReasons && typeof CFG.suspendedReasons === 'object' ? CFG.suspendedReasons : {})
    .filter(([k]) => !k.startsWith('_')).map(([k, v]) => [idOf(k), String(v || '').trim()]).filter(([k, v]) => k && v));
  const heldLine = (spellId) => { const why = HELD_WHY.get(Number(spellId) >>> 0); return `${nameOf(spellId)} is held back for a short while${why ? ` (${why})` : ''}; it stays in your spellbook.`; };
  // A held spell the engine had but the spellbook does not (known before study began, or given outside it) is listed here,
  // so it goes back into the engine once it is no longer held
  const HELD = 'private.dboHeldSpells';

  // ---- the spellbook (studied spells, per skill) ----------------------------------------------------------------
  const studiedOf = (a) => { const s = get(a, STUDIED, null); return s && typeof s === 'object' ? s : {}; };
  const studiedIds = (a, skillId) => (Array.isArray(studiedOf(a)[skillId]) ? studiedOf(a)[skillId] : []).map(idOf).filter(Boolean);
  const writeStudied = (a, skillId, ids) => set(a, STUDIED, Object.assign({}, studiedOf(a), { [skillId]: ids.map(descOf).filter(Boolean) }));
  const spellLabel = (sp) => `${sp.name} (${sp.school}, ${RANKS[sp.rank]})`;
  // ---- the spellbook and the prepared spells -------------------------------------------------------------------------
  const MAXP = () => Math.max(0, Number(CFG.prepared) || 0);
  const knownIds = (a) => [].concat(...SPELL_SKILLS.map((s) => studiedIds(a, s.id)));
  const inBook = (a, spellId) => knownIds(a).includes(spellId >>> 0);
  // null until the character has been brought over to prepared spells (migrate below)
  const preparedOf = (a) => { const p = get(a, PREPARED, null); return Array.isArray(p) ? p.map(idOf).filter(Boolean) : null; };
  const preparedIds = (a) => preparedOf(a) || [];
  const writePrepared = (a, ids) => set(a, PREPARED, ids.map(descOf).filter(Boolean));
  const preparedLine = (a) => `Prepared: ${preparedIds(a).length} of ${MAXP()}`;
  const COLLEGE_CELLS = new Set((CFG.prepareCells || []).map(norm));
  // The Scholars' Ledger (salvage.js) is a college of its own (Nate, 2026-09-28: "use the breakdown ledger to access
  // both the book breakdown panel and spells"). The ledger a player opened the book from is kept, and every change is
  // checked against it again: still within reach of it, as a prepare cell is checked by where they stand.
  const LEDGER_REACH_M = 6.5;
  const bookLedger = globalThis.__dboSpellbookLedger instanceof Map ? globalThis.__dboSpellbookLedger : (globalThis.__dboSpellbookLedger = new Map());
  const atLedger = (a) => {
    const ref = bookLedger.get(a >>> 0);
    if (!ref) return false;
    try { return distanceMeters(a, ref) <= LEDGER_REACH_M; } catch (e) { return false; }
  };
  const atCollege = (a) => COLLEGE_CELLS.has(norm(get(a, 'worldOrCellDesc', ''))) || atLedger(a);
  const COLLEGE_HINT = "Prepared spells are changed at a magic college (the Synod Conclave in Bruma, or the College of Winterhold) or at a Scholars' Ledger.";
  // A spell newly in the book: prepared at once while there is room (the engine already holds it after a read; a lesson
  // adds it), else it waits in the book and the engine's copy is taken back. Returns the line to tell the player.
  const settleNew = (a, sp, engineHasIt) => {
    const id = (sp.spellId || sp.id) >>> 0;   // a tome carries its spell as spellId, a classified spell as id
    const prep = preparedIds(a);
    if (prep.length < MAXP()) {
      if (!engineHasIt && !papyrus(a, 'AddSpell', id, [false])) return `${sp.name} is in your spellbook.`;
      writePrepared(a, prep.concat([id]));
      return `It is prepared. ${preparedLine(a)}.`;
    }
    if (engineHasIt) papyrus(a, 'RemoveSpell', id);
    return `Your ${MAXP()} prepared spells are full, so it waits in your spellbook. ${COLLEGE_HINT}`;
  };

  // The skills whose path may take a spell of this school for this character, skills.json's owner first. Alteration is
  // Priest's and, by the schools of magic's rule (schools.js, config schools.alteration; Nate 2026-09-30: "both for priest
  // and arcane"), also Arcane Arts' ('both'), or Arcane Arts' alone ('arcane'). Arcane Arts' path is the school's too.
  const pathsOf = (a, school) => {
    const own = SKILL_OF_SCHOOL[school];
    let rule = 'priest';
    try { rule = typeof globalThis.__dboSchoolsAlteration === 'function' ? String(globalThis.__dboSchoolsAlteration(a) || 'priest') : 'priest'; } catch (e) { rule = 'priest'; }
    const arcane = school === 'Alteration' && rule !== 'priest' ? skillDef('arcane') : null;
    if (!arcane || arcane === own) return own ? [own] : [];
    if (rule === 'arcane') return [arcane];
    return own ? [own, arcane] : [arcane];
  };
  // Why this path cannot take the spell, or null; Arcane Arts' path also asks the schools of magic
  const pathRefusal = (a, sp, whose, skill) => {
    const tier = tierOf(a, skill.id);
    if (tier < 0) return `${whose} not taken up ${skill.label}, the skill that studies ${sp.school}. Reading a Novice ${sp.school} tome at a spell study point takes it up.`;
    const max = maxRankFor(skill.id, tier);
    if (sp.rank > max) return `${sp.name} is ${/^[AEIOU]/.test(RANKS[sp.rank]) ? 'an' : 'a'} ${RANKS[sp.rank]} spell. ${skill.label} at ${TIER_NAMES[tier]} allows up to ${RANKS[max]} spells.`;
    return skill.id === 'arcane' ? schoolRefusal(a, sp, whose === 'You have' ? 'You' : display(a)) : null;
  };
  // The skill whose book a spell goes into: the first path that takes it, or null
  const bookSkillFor = (a, sp) => pathsOf(a, sp.school).find((skill) => !pathRefusal(a, sp, 'You have', skill)) || null;
  // Why this actor cannot hold this spell in a slot, or null. With two paths either will do; the refusal told is the one of
  // the path the character is on (the first whose skill is taken up)
  const slotRefusal = (a, sp, whose) => {
    const paths = pathsOf(a, sp.school);
    if (!paths.length) return `${sp.school} is not studied here.`;
    const whys = paths.map((skill) => pathRefusal(a, sp, whose, skill));
    if (whys.some((w) => !w)) return null;
    const held = paths.findIndex((skill) => tierOf(a, skill.id) >= 0);
    return whys[held >= 0 ? held : 0];
  };
  // The schools of magic (schools.js): a spell of Destruction, Illusion, Conjuration or Alteration is taken only in a school
  // the character has chosen, and no higher than their study of it. null when schools.js has no objection or is not loaded.
  const schoolRefusal = (a, sp, whose) => {
    try { if (typeof globalThis.__dboSchoolsGrandfathered === 'function' && globalThis.__dboSchoolsGrandfathered(a, (sp.spellId || sp.id) >>> 0)) return null; } catch (e) { /* no schools */ }
    try { return typeof globalThis.__dboSchoolsRefusal === 'function' ? (globalThis.__dboSchoolsRefusal(a, sp.school, Number(sp.rank) || 0, whose) || null) : null; }
    catch (e) { log('spells: school check failed', e.message); return null; }
  };

  // A vampire takes no Restoration healing spell (supernatural.js vampireRestoration; Nate, 11 Oct): not from a tome, the
  // shop or a lesson. One already in the spellbook stays there; casting it is refused. The lore line, or null
  const undeadRefusal = (a, spellId) => {
    try { return typeof globalThis.__dboVampHealRefusal === 'function' ? globalThis.__dboVampHealRefusal(a >>> 0, spellId >>> 0) || null : null; }
    catch (e) { log('spells: undead check failed', e.message); return null; }
  };

  // ---- reading a tome --------------------------------------------------------------------------------
  // { refuse } or { commit } for the read, or null to leave it to the engine
  const judgeRead = (a, bookId) => {
    if (!CFG.enabled || !onlineActors().includes(a)) return null;
    const tome = tomeOf(bookId);
    if (!tome) return null;
    const refuse = (why) => {
      personal(a, `The words will not settle: ${why} You keep the tome.`);
      audit(`SPELL ${who(a)} refused tome ${descOf(bookId)} (${tome.edid || tome.name}): ${why}`);
      return { refuse: true };
    };
    if (tome.unknown) { log(`spells: tome ${descOf(bookId)} ${tome.edid} teaches a spell that could not be classified`); return refuse('this tome belongs to no school we know.'); }
    if (removed(tome.spellId)) return refuse('this spell is no longer taught anywhere in the realm.');
    if (suspended(tome.spellId)) return refuse(`${tome.name} is held back for a short while.`);
    if (knows(a, tome.spellId)) return null; // the engine keeps the tome and changes nothing
    if (inBook(a, tome.spellId)) {
      personal(a, `${tome.name} is already in your spellbook. You keep the tome. ${COLLEGE_HINT}`);
      return { refuse: true };
    }
    const undead = undeadRefusal(a, tome.spellId);
    if (undead) return refuse(undead);
    // A school tome is refused before it can take a skill up: no pool point is spent on a read the school would refuse
    const paths = pathsOf(a, tome.school);
    if (paths.length === 1 && paths[0].id === 'arcane') { const noSchool = schoolRefusal(a, tome, 'You'); if (noSchool) return refuse(noSchool); }
    // A Novice tome read at a spell study point takes up its school's skill, for one pool point, the way a trade is
    // started at its bench (Nate, 2026-09-25): a new character has no spell to cast, so Arcane Arts had no way in.
    // Not when another path already takes it (an Alteration mage of the schools needs no Priest).
    const opens = slotRefusal(a, tome, 'You have') ? paths[0] : null;
    if (opens && tierOf(a, opens.id) < 0 && Number(tome.rank) === 0 && studyPointAt(a, tome.school)
      && typeof globalThis.__alduinakMasteryFirstTouch === 'function') {
      let took = 'unknown';
      try { took = String(globalThis.__alduinakMasteryFirstTouch(a, opens.id)); } catch (e) { log('spells: first touch failed', e.message); }
      if (took === 'full') return refuse(`taking up ${opens.label} needs a free skill point. Mark a skill to fall (K) first.`);
      if (took === 'ok') audit(`SPELL ${who(a)} took up ${opens.id} by reading ${descOf(bookId)} (${tome.edid || tome.name}) at a study point`);
    }
    const why = slotRefusal(a, tome, 'You have');
    if (why) return refuse(why);
    if (!studyPointAt(a, tome.school)) {
      const near = nearestHere(a, tome.school);
      return refuse(`a tome is studied at a spell study point: ${studyPointNames(tome.school) || 'none is set'}.${near === null ? '' : ` The nearest one here is ${Math.max(1, Math.round(near.meters))} m away; read within ${near.radius} m of it.`}`);
    }
    const skill = bookSkillFor(a, tome);
    return {
      // Runs after the engine's OnFireSuccess, which skips spells the actor's race or base already grants
      commit: () => {
        migrate(a); // a character not yet brought over is, before the new spell joins the book
        if (!knows(a, tome.spellId) || studiedIds(a, skill.id).includes(tome.spellId)) return log(`spells: ${descOf(a)} read ${descOf(bookId)} but the engine did not learn ${descOf(tome.spellId)}`);
        writeStudied(a, skill.id, studiedIds(a, skill.id).concat([tome.spellId]));
        const line = settleNew(a, tome, true);
        personal(a, `You study ${spellLabel(tome)}. ${line}`);
        audit(`SPELL ${who(a)} learned ${descOf(tome.spellId)} ${tome.name} from tome ${descOf(bookId)} (book ${knownIds(a).length}, prepared ${preparedIds(a).length}/${MAXP()})`);
      },
    };
  };

  // Wrapped around whatever handler was there before; a reload unwraps its own previous wrapper first
  const prevRead = typeof mp.onReadBook === 'function' ? ('__dboSpellsInner' in mp.onReadBook ? mp.onReadBook.__dboSpellsInner : mp.onReadBook) : null;
  const readHook = function (actorId, baseId, ...rest) {
    // Smithing manuals and skill books (manuals.js) are asked first: a manual beyond the reader's tier is refused and kept
    try { if (typeof globalThis.__dboManualsRead === 'function' && globalThis.__dboManualsRead(Number(actorId) >>> 0, Number(baseId) >>> 0) === false) return false; } catch (e) { log('spells: manuals check failed', e.message); }
    let verdict = null;
    try { verdict = judgeRead(Number(actorId) >>> 0, Number(baseId) >>> 0); } catch (e) { log('spells: read check failed', e.stack || e.message); }
    if (verdict && verdict.refuse) return false;
    const r = prevRead ? prevRead.call(this, actorId, baseId, ...rest) : undefined;
    if (r === false) return false;
    if (verdict && verdict.commit) setTimeout(() => { try { verdict.commit(); } catch (e) { log('spells: commit failed', e.message); } }, 0);
    return r;
  };
  readHook.__dboSpellsInner = prevRead;
  mp.onReadBook = readHook;

  // ---- menus -----------------------------------------------------------------------------------------
  const pending = new Map(); // actorId -> { kind, ... }
  const menu = (a, id, title, actions, state) => {
    pending.set(a >>> 0, state);
    openWidget(a, { type: 'contextMenu', id, mode: 'menu', targetName: title, actions, events: { action: 'dbo:spellsChoose', close: 'dbo:spellsClose' } }, true);
  };
  const closeMenu = (a) => { pending.delete(a >>> 0); closeWidget(a, MENU_ID); };

  // ---- /spells and /forget ---------------------------------------------------------------------------
  const bookNonces = globalThis.__dboSpellbookNonces instanceof Map ? globalThis.__dboSpellbookNonces : (globalThis.__dboSpellbookNonces = new Map());
  const entryOf = (id, prepared) => { const sp = classifySpell(id) || { name: descOf(id), school: '?', rank: 0 }; return { id: descOf(id), name: sp.name, school: sp.school, rank: sp.rank, rankName: RANKS[sp.rank] || '', prepared }; };
  const openBook = (a, result, resultKind) => {
    const nonce = `${(a >>> 0).toString(16)}-${Date.now().toString(36)}`;
    bookNonces.set(a >>> 0, nonce);
    const prep = preparedIds(a);
    const college = atCollege(a);
    openWidget(a, {
      type: 'spellbook', id: BOOK_ID, nonce, max: MAXP(), atCollege: college, hint: college ? '' : COLLEGE_HINT,
      prepared: prep.map((id) => entryOf(id, true)),
      known: knownIds(a).map((id) => entryOf(id, prep.includes(id))).sort((x, y) => x.school.localeCompare(y.school) || x.rank - y.rank || x.name.localeCompare(y.name)),
      result: result || '', resultKind: resultKind || '',
      events: { prepare: 'dbo:spellbookPrepare', unprepare: 'dbo:spellbookUnprepare', close: 'dbo:spellbookClose' },
    }, true);
  };
  // Nothing is forgotten now (Nate, 2026-09-28): /spells forget and the hidden /forget (Worker B's aliases) open the book
  const RETIRED = 'Spells are no longer forgotten: put one away in your spellbook instead, at a magic college.';
  // The panel opens only for a client whose UI said it draws it (dbo:uiCaps 'spellbook' from the HUD): an unknown
  // widget opened with focus would leave an invisible panel holding the keys. An older client gets the book in chat.
  const caps = globalThis.__dboSpellbookCaps instanceof Map ? globalThis.__dboSpellbookCaps : (globalThis.__dboSpellbookCaps = new Map());
  onUi('uiCaps', (a, args) => { caps.set(a >>> 0, new Set((args || []).map(String))); });
  const hasPanel = (a) => (caps.get(a >>> 0) || new Set()).has('spellbook');
  const bookInChat = (a, result) => {
    const name = (id) => (classifySpell(id) || { name: descOf(id) }).name;
    const prep = preparedIds(a);
    const rest = knownIds(a).filter((id) => !prep.includes(id));
    personal(a, `${result ? result + ' ' : ''}Prepared (${prep.length} of ${MAXP()}): ${prep.map(name).join(', ') || 'none'}. In your spellbook: ${rest.map(name).join(', ') || 'nothing else'}. Update the game (restart the launcher) for the spellbook panel, where prepared spells are changed.`);
  };
  const openFromCommand = (a, result) => {
    if (!CFG.enabled) return personal(a, 'Spell study is closed.');
    migrate(a);
    if (!hasPanel(a)) return bookInChat(a, result);
    openBook(a, result || '', result ? 'refused' : '');
  };
  registerChatCommand('spells', (a, args) => {
    bookLedger.delete(a >>> 0);
    const first = String(Array.isArray(args) ? args[0] : args || '').trim();
    openFromCommand(a, /^forget\b/i.test(first) ? RETIRED : '');
  }, { help: 'your spellbook: every spell you have studied, and the prepared ones (changed at a Scholars\' Ledger or a magic college)' });
  registerChatCommand('forget', (a) => openFromCommand(a, RETIRED), { hidden: true, help: 'retired; /spells opens your spellbook' });

  // { ok, text } of preparing or putting away one spell
  const changePrepared = (a, spellId, want) => {
    if (!atCollege(a)) return { ok: false, text: COLLEGE_HINT };
    if (!inBook(a, spellId)) return { ok: false, text: 'That spell is not in your spellbook.' };
    if (want && typeof globalThis.__dboCastBlocked === 'function' && globalThis.__dboCastBlocked(spellId)) return { ok: false, text: 'That spell is disabled for now.' };
    if (want && suspended(spellId)) return { ok: false, text: heldLine(spellId) };
    const sp = classifySpell(spellId) || { id: spellId, name: descOf(spellId) };
    const prep = preparedIds(a);
    if (want) {
      if (prep.includes(spellId)) return { ok: true, text: `${sp.name} is already prepared.` };
      if (prep.length >= MAXP()) return { ok: false, text: `All ${MAXP()} prepared places are taken. Put one away first.` };
      if (!knows(a, spellId) && !papyrus(a, 'AddSpell', spellId, [false])) return { ok: false, text: `${sp.name} would not settle. Try again.` };
      writePrepared(a, prep.concat([spellId]));
      audit(`SPELL ${who(a)} prepared ${descOf(spellId)} ${sp.name} (${preparedIds(a).length}/${MAXP()})`);
      return { ok: true, text: `${sp.name} is prepared. ${preparedLine(a)}.` };
    }
    if (!prep.includes(spellId)) return { ok: true, text: `${sp.name} is not prepared.` };
    papyrus(a, 'RemoveSpell', spellId);
    writePrepared(a, prep.filter((id) => id !== spellId));
    audit(`SPELL ${who(a)} put away ${descOf(spellId)} ${sp.name} (${preparedIds(a).length}/${MAXP()})`);
    return { ok: true, text: `${sp.name} goes back into your spellbook. ${preparedLine(a)}.` };
  };
  const freshBook = (a, args) => bookNonces.get(a >>> 0) === String(args[0] || '');
  onUi('spellbookPrepare', (a, args) => { if (!freshBook(a, args)) return; const r = changePrepared(a, idOf(String(args[1] || '')), true); openBook(a, r.text, r.ok ? 'ok' : 'refused'); });
  onUi('spellbookUnprepare', (a, args) => { if (!freshBook(a, args)) return; const r = changePrepared(a, idOf(String(args[1] || '')), false); openBook(a, r.text, r.ok ? 'ok' : 'refused'); });
  onUi('spellbookClose', (a) => { bookNonces.delete(a >>> 0); bookLedger.delete(a >>> 0); closeWidget(a, BOOK_ID); });
  // salvage.js's ledger menu opens the book here; { ledger } is the ledger's ref, which lets spells be prepared beside it.
  // Opened any other way (/spells), the book forgets a ledger from before.
  globalThis.__dboOpenSpellbook = (a, opts) => {
    const ledger = opts && Number(opts.ledger) >>> 0;
    if (ledger) bookLedger.set(a >>> 0, ledger); else bookLedger.delete(a >>> 0);
    const panel = !!CFG.enabled && hasPanel(a);
    openFromCommand(a, '');
    return panel;
  };

  // For schools.js: the spellbook (every spell studied or taught), every school spell the character knows (the engine's
  // list and the book), and one spell's school and rank; each entry { id, desc, school, rank, name }
  globalThis.__dboSpellsBook = (a) => [].concat(...SPELL_SKILLS.map((s) => studiedIds(a, s.id).map((id) => { const sp = classifySpell(id); return sp ? Object.assign({ book: s.id }, sp) : null; }))).filter(Boolean);
  globalThis.__dboSpellsKnown = (a) => { const ids = new Set(learnedIds(a) || []); for (const id of knownIds(a)) ids.add(id); return [...ids].map(classifySpell).filter(Boolean); };
  globalThis.__dboSpellsClassify = (id) => classifySpell(Number(id) >>> 0);
  // The spell a tome teaches (0 when it is not a spell tome): the reading's tome pick skips tomes the reader already knows
  globalThis.__dboSpellsTomeSpell = (bookId) => { try { const t = tomeOf(Number(bookId) >>> 0); return t && t.spellId ? t.spellId >>> 0 : 0; } catch (e) { return 0; } };
  // A held spell (suspendedSpells) leaves the prepared list and the engine; the spellbook keeps it. One the spellbook does
  // not hold is noted on the character and given back to the engine once it is no longer held. Returns how many were held.
  const heldOf = (a) => { const h = get(a, HELD, null); return Array.isArray(h) ? h.map(idOf).filter(Boolean) : []; };
  const holdSuspended = (a) => {
    a >>>= 0;
    const back = heldOf(a).filter((id) => !suspended(id));
    if (!SUSPENDED.size && !back.length) return 0;
    const engine = learnedIds(a);
    if (!engine) return 0; // the engine could not say; the next check tries again
    let held = heldOf(a), n = 0;
    for (const id of back) {
      if (!engine.includes(id)) papyrus(a, 'AddSpell', id, [false]);
      held = held.filter((x) => x !== id);
      audit(`SPELL ${who(a)} had ${descOf(id)} ${nameOf(id)} given back (no longer held)`);
    }
    for (const id of SUSPENDED) {
      const inEngine = engine.includes(id), prepped = preparedIds(a).includes(id);
      if (!inEngine && !prepped) continue;
      if (prepped) writePrepared(a, preparedIds(a).filter((x) => x !== id));
      if (inEngine) papyrus(a, 'RemoveSpell', id);
      if (inEngine && !inBook(a, id) && !held.includes(id)) held.push(id);
      personal(a, heldLine(id));
      audit(`SPELL ${who(a)} had ${descOf(id)} ${nameOf(id)} held back (suspended; engine ${inEngine}, prepared ${prepped}, book ${inBook(a, id)})`);
      n++;
    }
    if (back.length || n) set(a, HELD, held.map(descOf).filter(Boolean));
    return n;
  };
  globalThis.__dboSpellsHoldSuspended = holdSuspended;
  // Each online character once per session, at most HOLD_PER_TICK a run: reading the engine's spell list is the cost, and
  // checking everyone every 15 s stalled the main loop (2.7 s a run with 32 online, 16 Oct); logins are held at login
  const holdChecked = globalThis.__dboSpellsHoldChecked instanceof Set ? globalThis.__dboSpellsHoldChecked : (globalThis.__dboSpellsHoldChecked = new Set());
  const HOLD_PER_TICK = 2;
  if (typeof api.every === 'function') api.every('spells.hold', 15000, () => {
    const online = onlineActors().map((a) => a >>> 0);
    const here = new Set(online);
    for (const k of holdChecked) if (!here.has(k)) holdChecked.delete(k);
    let n = 0;
    for (const a of online) {
      if (holdChecked.has(a)) continue;
      if (n++ >= HOLD_PER_TICK) break;
      try { if (!SUSPENDED.size && !heldOf(a).length) { holdChecked.add(a); continue; } holdSuspended(a); holdChecked.add(a); } catch (e) { log('spells: hold failed', e.message); }
    }
  });

  // A spell given outright into one skill's book, as a lesson adds it (schools.js: a new mage's first spell). No tier or
  // school check: the giver has decided. { ok, name, line }, or null when the spell is unknown here.
  // At login (gamemode.js): a removed spell leaves the engine, the spellbook and the prepared list
  globalThis.__dboSpellsStripRemoved = (a) => {
    // Held here, so spells.hold does not read the whole list again a few seconds after the login (it marks a character
    // the same way once it has held them; 17 Oct: a read is about 4.5 s for a character with 331 spells)
    try { holdSuspended(a); holdChecked.add(a >>> 0); } catch (e) { log('spells: hold failed', e.message); }
    if (!REMOVED.size) return 0;
    let n = 0;
    for (const id of REMOVED) {
      const inEngine = knows(a, id), book = inBook(a, id);
      if (!inEngine && !book) continue;
      if (inEngine) papyrus(a, 'RemoveSpell', id);
      for (const s of SPELL_SKILLS) { const ids = studiedIds(a, s.id); if (ids.includes(id)) writeStudied(a, s.id, ids.filter((x) => x !== id)); }
      if (preparedIds(a).includes(id)) writePrepared(a, preparedIds(a).filter((x) => x !== id));
      const sp = classifySpell(id);
      personal(a, `${sp ? sp.name : 'A spell you knew'} is no longer part of the realm's magic and has left your spellbook.`);
      audit(`SPELL ${who(a)} lost removed spell ${descOf(id)}${sp ? ` ${sp.name}` : ''} (engine ${inEngine}, book ${book})`);
      n++;
    }
    return n;
  };
  globalThis.__dboSpellsGrant = (a, spellId, skillId) => {
    const sp = classifySpell(Number(spellId) >>> 0);
    const skill = skillDef(String(skillId || 'arcane'));
    if (!sp || !skill) return null;
    if (removed(sp.id)) return { ok: false, name: sp.name, line: `${sp.name} is no longer taught.` };
    if (suspended(sp.id)) return { ok: false, name: sp.name, line: heldLine(sp.id) };
    if (inBook(a, sp.id)) return { ok: false, name: sp.name, line: `${sp.name} is already in your spellbook.` };
    migrate(a);
    writeStudied(a, skill.id, studiedIds(a, skill.id).concat([sp.id]));
    const line = settleNew(a, sp, knows(a, sp.id));
    audit(`SPELL ${who(a)} was given ${descOf(sp.id)} ${sp.name} into ${skill.id} (book ${knownIds(a).length}, prepared ${preparedIds(a).length}/${MAXP()})`);
    return { ok: true, name: sp.name, line };
  };

  // Bringing a character over: the first time the server sees them after this change, the spells of their book the
  // engine holds become prepared, up to the limit in the order they were learned; any beyond it are taken back into
  // the book, and they are told once. A character with no studied spells just starts with none prepared.
  const migrate = (a) => {
    if (preparedOf(a) !== null) return;
    const book = knownIds(a);
    if (!book.length) { writePrepared(a, []); return; }
    const held = learnedIds(a);
    if (!held) return; // the engine could not say; try again later
    const on = book.filter((id) => held.includes(id));
    const keep = on.slice(0, MAXP()), away = on.slice(MAXP());
    for (const id of away) papyrus(a, 'RemoveSpell', id);
    writePrepared(a, keep);
    if (away.length) {
      personal(a, `Spells are now prepared, ${MAXP()} at a time. Prepared: ${keep.map((id) => (classifySpell(id) || { name: '?' }).name).join(', ')}. In your spellbook: ${away.map((id) => (classifySpell(id) || { name: '?' }).name).join(', ')}. /spells opens it. ${COLLEGE_HINT}`);
    }
    audit(`SPELL ${who(a)} brought over to prepared spells: ${keep.length} prepared, ${away.length} put away, book ${book.length}`);
  };
  if (typeof api.every === 'function') api.every('spells.migrate', 20000, () => { if (!CFG.enabled) return; for (const a of onlineActors()) { try { migrate(a); } catch (e) { log('spells: migrate failed', e.message); } } });

  // ---- /teach ----------------------------------------------------------------------------------------
  // Spells this teacher may pass on: school spells the server has learned for them (studied or known before) in skills at teacher tier
  const teachable = (a) => {
    const skills = SPELL_SKILLS.filter((s) => tierOf(a, s.id) >= CFG.teacherMinTier);
    if (!skills.length) return [];
    const ids = new Set(ownLearned(a));
    for (const s of skills) for (const id of studiedIds(a, s.id)) ids.add(id);
    return [...ids].map(classifySpell).filter((sp) => sp && !removed(sp.id) && !suspended(sp.id) && Number(sp.rank) >= CFG.teachMinRank && pathsOf(a, sp.school).some((skill) => skills.includes(skill)));
  };
  const near = (a, b) => distanceMeters(a, b) <= CFG.teachMeters;
  const rankWord = (r) => RANKS[Math.max(0, Math.min(RANKS.length - 1, Number(r) || 0))];
  // Why the student cannot take this spell from this teacher now, or null. The student's checks are a tome read's
  // (slotRefusal: the tier for the rank, the study of the school), without the study point: the teacher stands in for it.
  const teachRefusal = (teacher, student, sp) => {
    if (suspended(sp.id)) return `${sp.name} is held back for a short while and is not taught.`;
    if (Number(sp.rank) < CFG.teachMinRank) return `Only spells of ${rankWord(CFG.teachMinRank)} rank and above may be taught; ${sp.name} is ${/^[AEIOU]/.test(rankWord(sp.rank)) ? 'an' : 'a'} ${rankWord(sp.rank)} spell.`;
    if (!onlineActors().includes(student)) return `${display(student)} is not here.`;
    if (!near(teacher, student)) return `${display(student)} must stand within ${CFG.teachMeters} m.`;
    if (CFG.teachAtStudyPoint && !(studyPointAt(teacher, sp.school) && studyPointAt(student, sp.school))) return 'Teaching happens at a spell study point.';
    const taught = pathsOf(teacher, sp.school), learning = pathsOf(student, sp.school);
    if (!taught.some((skill) => tierOf(teacher, skill.id) >= CFG.teacherMinTier)) return `Teaching ${sp.school} takes ${taught.map((skill) => skill.label).join(' or ')} at ${TIER_NAMES[CFG.teacherMinTier]}.`;
    if (!learning.some((skill) => tierOf(student, skill.id) >= CFG.studentMinTier)) return `${display(student)} needs ${learning.map((skill) => skill.label).join(' or ')} at ${TIER_NAMES[CFG.studentMinTier]} or higher to be taught.`;
    if (knows(student, sp.id) || inBook(student, sp.id)) return `${display(student)} already knows ${sp.name}.`;
    if (undeadRefusal(student, sp.id)) return `${sp.name} will not take in ${display(student)}: the light of Arkay and Stendarr will not pass into undead hands.`;
    return slotRefusal(student, sp, `${display(student)} has`);
  };
  const offers = globalThis.__dboSpellOffers instanceof Map ? globalThis.__dboSpellOffers : (globalThis.__dboSpellOffers = new Map()); // student -> offer
  registerChatCommand('teach', (a) => {
    if (!CFG.enabled) return personal(a, 'Spell teaching is closed.');
    if (!SPELL_SKILLS.some((s) => tierOf(a, s.id) >= CFG.teacherMinTier)) return personal(a, `Teaching takes ${SPELL_SKILLS.map((s) => s.label).join(' or ')} at ${TIER_NAMES[CFG.teacherMinTier]} or higher.`);
    if (!teachable(a).length) return personal(a, `You know no spell of ${rankWord(CFG.teachMinRank)} rank or higher in your schools to teach. Only spells of ${rankWord(CFG.teachMinRank)} rank and above may be taught.`);
    const students = onlineActors().filter((p) => p !== (a >>> 0) && near(a, p)).slice(0, MAX_ROWS);
    if (!students.length) return personal(a, `Nobody stands within ${CFG.teachMeters} m to teach.`);
    menu(a, MENU_ID, 'Teach whom?', students.map((p) => ({ id: `student:${p.toString(16)}`, label: display(p) })), { kind: 'teach' });
  }, { help: `Teach a spell of ${rankWord(CFG.teachMinRank)} rank or higher to a player beside you (Arcane Arts or Priest at ${TIER_NAMES[CFG.teacherMinTier]})` });

  const offerTeach = (teacher, student, spellId) => {
    const sp = teachable(teacher).find((x) => x.id === spellId);
    if (!sp) return personal(teacher, 'You cannot teach that spell.');
    const why = teachRefusal(teacher, student, sp);
    if (why) return personal(teacher, why);
    offers.set(student >>> 0, { teacher: teacher >>> 0, spellId, at: Date.now() });
    openWidget(student, { type: 'contextMenu', id: MENU_ID, mode: 'menu', targetName: `${display(teacher)} offers to teach you ${spellLabel(sp)}`,
      actions: [{ id: 'accept', label: 'Learn it (it goes into your spellbook)' }, { id: 'decline', label: 'Decline' }],
      events: { action: 'dbo:spellsOffer', close: 'dbo:spellsOfferClose' } }, true);
    personal(teacher, `You offer to teach ${display(student)} ${sp.name}.`);
  };
  const answerOffer = (student, accept) => {
    const o = offers.get(student >>> 0);
    offers.delete(student >>> 0);
    closeWidget(student, MENU_ID);
    if (!o) return;
    if (Date.now() - o.at > (o.cls ? CFG.classOfferSeconds : CFG.offerSeconds) * 1000) return personal(student, 'The offer has lapsed.');
    if (!accept) { personal(o.teacher, `${display(student)} declines the lesson.`); return; }
    if (o.college) return answerCollege(student, o);
    if (o.cls) return answerClass(student, o);
    const sp = teachable(o.teacher).find((x) => x.id === o.spellId);
    if (!sp) { personal(student, 'Your teacher can no longer teach that spell.'); return; }
    const why = teachRefusal(o.teacher, student, sp);
    if (why) { personal(student, why); personal(o.teacher, why); return; }
    const skill = bookSkillFor(student, sp);
    migrate(student);
    writeStudied(student, skill.id, studiedIds(student, skill.id).concat([sp.id]));
    const line = settleNew(student, sp, false);
    personal(student, `${display(o.teacher)} teaches you ${spellLabel(sp)}. ${line}`);
    personal(o.teacher, `You teach ${display(student)} ${sp.name}.`);
    audit(`SPELL ${who(o.teacher)} taught ${who(student)} ${descOf(sp.id)} ${sp.name} (book ${knownIds(student).length}, prepared ${preparedIds(student).length}/${MAXP()})`);
  };
  onUi('spellsOffer', (a, args) => answerOffer(a, String(args[0] || '') === 'accept'));
  onUi('spellsOfferClose', (a) => answerOffer(a, false));

  // ---- /tomes: the college shop panel in the Synod enclave -------------------------------------------
  const SHOP_CELLS = new Set((CFG.shopCells || []).map(norm));
  const excluded = (() => { try { return new RegExp(CFG.shopExcludePattern, 'i'); } catch (e) { return null; } })();
  const SHOP = (() => {
    const pref = (t) => { const i = (CFG.shopPreferPlugins || []).indexOf(t.plugin); return i < 0 ? 99 : i; };
    const seen = new Set();
    return [...TOMES.values()]
      .filter((t) => t.rank <= Number(CFG.shopMaxRank) && !removed(t.spellId) && !(CFG.shopExcludePlugins || []).includes(t.plugin) && !(excluded && excluded.test(t.edid)))
      .sort((x, y) => x.school.localeCompare(y.school) || x.rank - y.rank || pref(x) - pref(y) || x.name.localeCompare(y.name))
      .filter((t) => (seen.has(t.spellId) ? false : seen.add(t.spellId)));
  })();
  const priceOf = (t) => Math.max(1, Math.round(t.value * (Number(CFG.shopPriceMultiplier) || 1)));
  // The province filter from regions.js, or null when it is not loaded or switched off
  const regions = () => { const R = globalThis.__dboRegions; return R && R.tomesOn() ? R : null; };
  const soldHere = (R, t) => !R || R.tomeOk(t.bookId, CFG.shopProvince);
  const soldIn = (R, t) => { const w = R ? R.tomeWhere(t.bookId) : null; return w && w.length ? R.listNames(w) : ''; };
  const PLACES = (CFG.shopPlaces || []).map((p) => ({ name: String(p.name || ''), cells: new Set((p.cells || []).map(norm)), factions: (p.factions || []).map(String), schools: Array.isArray(p.schools) && p.schools.length ? p.schools.map(String) : null, exclusive: p.exclusive === true }));
  const PLACE_FACTIONS = new Set([].concat(...PLACES.filter((p) => p.exclusive).map((p) => p.factions)));
  // The shop the buyer stands in: a listed place (a temple), else the Synod's for every faction no place claims
  const placeOf = (a) => {
    const cell = norm(get(a, 'worldOrCellDesc', ''));
    const p = PLACES.find((x) => x.cells.has(cell));
    if (p) return p;
    return SHOP_CELLS.has(cell) ? { name: '', factions: (CFG.shopFactions || []).filter((f) => !PLACE_FACTIONS.has(f)), schools: null } : null;
  };
  // A school a faction teaches: a temple's own schools, every school for a college
  const factionSchools = (fid) => { const p = PLACES.find((x) => x.schools && x.factions.includes(String(fid))); return p ? p.schools : null; };
  const inShop = (a) => !!placeOf(a);
  const isMember = (a) => { const g = get(a, 'private.dboGuilds', []); const p = placeOf(a); const fs = p ? p.factions : (CFG.shopFactions || []); return Array.isArray(g) && g.some((m) => m && fs.includes(String(m.id))); };
  const placeStocks = (a, t) => { const p = placeOf(a); return !p || !p.schools || p.schools.includes(t.school); };
  // A mage of a college above its joining rank (Nate, 10 Oct: buying tomes is earned by roleplay, from the second rank up; the
  // lowest rank, Initiate, and the crafting posts buy none). guilds.js: the member's title, its index in the rank list
  const CRAFT_ROLES = new Set(['blacksmith', 'tailor']);
  // The buyer's places in the shop factions, [{ id, name, title, role }], or null when guilds.js is not loaded
  const collegesOf = (a) => {
    let mine = null;
    try { mine = typeof globalThis.__dboGuildsOf === 'function' ? globalThis.__dboGuildsOf(a) : null; } catch (e) { mine = null; }
    return Array.isArray(mine) ? mine.filter((m) => m && (CFG.shopFactions || []).includes(String(m.id))) : null;
  };
  // The joining rank: the last title of the faction's rank list (Initiate)
  const isInitiate = (m) => {
    let list = []; try { list = typeof globalThis.__dboGuildRankList === 'function' ? globalThis.__dboGuildRankList(m.id) || [] : []; } catch (e) { list = []; }
    const at = list.findIndex((r) => r && r.title === m.title);
    return !(at >= 0 && at < list.length - 1);
  };
  const aboveInitiate = (a) => {
    const mine = collegesOf(a);
    if (!mine) return isMember(a);
    return mine.some((m) => !CRAFT_ROLES.has(String(m.role || '')) && !isInitiate(m));
  };
  const SENIOR_ROLES = new Set((CFG.seniorRoles || []).map(String));
  const isSeniorIn = (m) => !!m && SENIOR_ROLES.has(String(m.role || ''));
  // A Senior rank or above in a college (Senior Magister, Senior Whisperer, Senior Wizard and up)
  const isSenior = (a) => { const mine = collegesOf(a); return !!mine && mine.some(isSeniorIn); };
  const SENIOR_TOMES = new Set((CFG.shopSeniorTomes || []).map((e) => String(e).toLowerCase()));
  const soldFor = (a, R, t) => soldHere(R, t) || (SENIOR_TOMES.has(String(t.edid || '').toLowerCase()) && isSenior(a));
  // The highest tome rank one place in a college buys: -1 for the crafting posts and the joining rank (shopRankByRole)
  const rankCapIn = (m) => {
    if (!m || CRAFT_ROLES.has(String(m.role || '')) || isInitiate(m)) return -1;
    const by = CFG.shopRankByRole || {};
    const v = Number(by[String(m.role || '')] !== undefined ? by[String(m.role || '')] : by.member);
    return Math.min(Number(CFG.shopMaxRank), Number.isFinite(v) ? v : -1);
  };
  // The highest tome rank the buyer may buy, over all their colleges; without guilds.js, shopMaxRank for any member
  const shopRankCap = (a) => {
    const mine = collegesOf(a);
    if (!mine) return isMember(a) ? Number(CFG.shopMaxRank) : -1;
    return mine.reduce((n, m) => Math.max(n, rankCapIn(m)), -1);
  };
  // The restricted arts (seniorOnlyTomes): by the tome's editor id, and every spell such a tome teaches
  const SENIOR_ONLY = new Set((CFG.seniorOnlyTomes || []).map((e) => String(e).toLowerCase()));
  const restrictedTome = (t) => !!t && SENIOR_ONLY.has(String(t.edid || '').toLowerCase());
  const RESTRICTED_SPELLS = new Set([...TOMES.values()].filter(restrictedTome).map((t) => t.spellId >>> 0));
  const restrictedSpell = (spellId) => RESTRICTED_SPELLS.has(spellId >>> 0);
  const RESTRICTED_LINE = 'Raising the dead and calling or banishing the Daedra are restricted arts, taught and sold only to Senior ranks and above';
  // Why the buyer's college rank does not reach this tome, or ''
  const rankBlock = (a, t) => {
    if (restrictedTome(t) && !isSenior(a)) return RESTRICTED_LINE;
    const cap = shopRankCap(a);
    if (t.rank > cap) return cap < 0 ? 'Your college does not sell you tomes at your rank' : `At your rank the college sells tomes up to ${RANKS[cap]}; ${RANKS[t.rank]} tomes are for Senior ranks and above`;
    return '';
  };
  // The Synod Conclave's enchanting table is the Synod's (its CYRBlockedFactionWorkshop script, whose faction is the Synod,
  // never runs on the server): only members of the Synod or a College use it, as with the tome shop (Nate, 2026-09-30).
  // gamemode.js asks before the skills' own station gate, so a refused touch takes up nothing.
  const WORKSHOPS = new Set((CFG.guildWorkshops || []).map(idOf).filter(Boolean));
  const workshopDeny = globalThis.__dboGuildWorkshopDeny instanceof Map ? globalThis.__dboGuildWorkshopDeny : (globalThis.__dboGuildWorkshopDeny = new Map());
  globalThis.__dboGuildWorkshop = (targetId, casterId) => {
    if (!CFG.enabled || !WORKSHOPS.has(targetId >>> 0) || isMember(casterId)) return false;
    if (Date.now() - (workshopDeny.get(casterId >>> 0) || 0) > 1500) {
      workshopDeny.set(casterId >>> 0, Date.now());
      personal(casterId, "This is the Synod's own enchanting table. Only members of the Synod or a College may use it.");
    }
    return true;
  };
  const goldOf = (a) => { const inv = get(a, 'inventory', { entries: [] }); return (Array.isArray(inv.entries) ? inv.entries : []).reduce((n, e) => n + ((Number(e.baseId) >>> 0) === GOLD && !e.worn ? Number(e.count) || 0 : 0), 0); };
  // The lowest tier of the skill whose spell rank reaches this tome, never below shopMinTier
  const tierFor = (skillId, rank) => { for (let t = 0; t < 5; t++) if (maxRankFor(skillId, t) >= rank) return Math.max(t, CFG.shopMinTier); return 4; };
  // Why this tome is out of the buyer's reach, or ''
  // An Arcane Arts tome also needs the buyer's study of its school, as reading it does (slotRefusal): the shop sold an
  // Adept Conjuration tome to an Apprentice of Conjuration, who could not learn it (ticket #0059, 5 Oct)
  const tomeBlock = (a, t) => {
    if (undeadRefusal(a, t.spellId)) return 'The light of Arkay and Stendarr will not pass into undead hands';
    const paths = pathsOf(a, t.school);
    const tierOk = (skill) => tierOf(a, skill.id) >= tierFor(skill.id, t.rank);
    if (paths.some((skill) => tierOk(skill) && (skill.id !== 'arcane' || !schoolRefusal(a, t, 'You')))) return '';
    if (paths.some((skill) => tierOk(skill))) return String(schoolRefusal(a, t, 'You')).replace(/\.$/, '');
    return `Needs ${paths.map((skill) => `${skill.label} ${TIER_NAMES[tierFor(skill.id, t.rank)]}`).join(' or ')}`;
  };
  // ---- the weekly shelf ----
  const WEEK = 7 * DAY;
  const weekNo = (ms) => Math.floor((ms - 4 * DAY) / WEEK); // weeks from Monday 00:00 UTC (1 Jan 1970 was a Thursday)
  const SHOP_KEY = `${CFG.shopTreasury}:${CFG.shopProvince}`;
  const seedOf = (text) => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  // SHOP in this week's order (mulberry32 over a Fisher-Yates shuffle), the same for every buyer at this shop
  let shelfCache = { week: NaN, order: [] };
  const shelfOrder = (week) => {
    if (shelfCache.week === week) return shelfCache.order;
    let x = seedOf(`${SHOP_KEY}:${week}`) | 0;
    const rnd = () => { x = (x + 0x6d2b79f5) | 0; let t = Math.imul(x ^ (x >>> 15), 1 | x); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const order = SHOP.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const k = order[i]; order[i] = order[j]; order[j] = k; }
    shelfCache = { week, order };
    return order;
  };
  // A college's leaders and officers see shopLeaderExtra more tomes on the weekly shelf (Nate, 10 Oct: a 5th), by their role
  // in a shop faction (guilds.js __dboGuildsOf)
  const leadsACollege = (a) => {
    let mine = null; try { mine = typeof globalThis.__dboGuildsOf === 'function' ? globalThis.__dboGuildsOf(a) : null; } catch (e) { mine = null; }
    return Array.isArray(mine) && mine.some((m) => m && (CFG.shopFactions || []).includes(String(m.id)) && (m.role === 'leader' || m.role === 'officer'));
  };
  const stockSize = (a) => Math.max(1, Math.round(Number(CFG.shopStock) || 4)) + (a && leadsACollege(a) ? Math.max(0, Math.round(Number(CFG.shopLeaderExtra === undefined ? 1 : CFG.shopLeaderExtra) || 0)) : 0);
  // The tomes on the shelf for this buyer this week: the first shopStock of the week's order that are sold here (or any,
  // for an admin) and that the buyer can learn now (tomeBlock, as at reading, and not a spell they hold). Listed in SHOP order.
  // The buyer's own schools come first (Nate, 11 Oct): primary, then secondary, then the rest, each in the week's order;
  // the primary takes at most all but one place while anything else they can learn is in stock
  const schoolsOf = (a) => { try { return typeof globalThis.__dboSchoolsActive === 'function' ? globalThis.__dboSchoolsActive(a) : null; } catch (e) { return null; } };
  const stockFor = (a, R, admin) => {
    const learned = new Set(learnedIds(a) || []), book = new Set(knownIds(a));
    const mine = schoolsOf(a);
    const rankOf = (t) => (mine && t.school === mine.primary ? 0 : mine && t.school === mine.secondary ? 1 : 2);
    const open = shelfOrder(weekNo(Date.now())).filter((t) => placeStocks(a, t) && (soldFor(a, R, t) || admin) && !learned.has(t.spellId >>> 0) && !book.has(t.spellId >>> 0) && !tomeBlock(a, t) && !rankBlock(a, t));
    const sorted = open.map((t, i) => [t, i]).sort((x, y) => rankOf(x[0]) - rankOf(y[0]) || x[1] - y[1]).map(([t]) => t);
    const size = stockSize(a);
    const first = sorted.filter((t) => rankOf(t) === 0), rest = sorted.filter((t) => rankOf(t) !== 0);
    const lead = first.slice(0, rest.length ? Math.max(1, size - 1) : size);
    return lead.concat(rest, first.slice(lead.length)).slice(0, size);
  };
  // One tome in any rolling shopCooldownDays, or shopSeniorPerWindow in shopSeniorWindowDays for a Senior rank or above; a lesson taught at a college
  // with a purchase counts as one. BOUGHT stays the latest purchase: 0 (or none) clears the record, and an older character
  // with only BOUGHT counts that one.
  const seniorWindow = (a) => !!a && isSenior(a) && Number(CFG.shopSeniorWindowDays) > 0;
  const windowMs = (a) => (seniorWindow(a) ? Number(CFG.shopSeniorWindowDays) : Number(CFG.shopCooldownDays) || 0) * DAY;
  const quotaOf = (a) => Math.max(1, Math.floor(isSenior(a) ? Number(CFG.shopSeniorPerWindow) || 1 : 1));
  // "today", "this week" or "these 3 days", by the buyer's window
  const windowDays = (a) => Math.max(1, Math.round(windowMs(a) / DAY));
  const period = (a) => (windowMs(a) <= DAY ? 'today' : windowDays(a) === 7 ? 'this week' : `these ${windowDays(a)} days`);
  const buysOf = (a) => {
    const last = Number(get(a, BOUGHT, 0)) || 0;
    if (!last) return [];
    const list = (Array.isArray(get(a, BUYS, null)) ? get(a, BUYS, []) : []).map(Number).filter((t) => t > 0 && t <= last);
    if (!list.includes(last)) list.push(last);
    return list.filter((t) => t > Date.now() - windowMs(a)).sort((x, y) => x - y);
  };
  const recordBuy = (a) => { const now = Date.now(); set(a, BUYS, buysOf(a).concat([now]).slice(-8)); set(a, BOUGHT, now); };
  const buysLeft = (a) => Math.max(0, quotaOf(a) - buysOf(a).length);
  const nextBuyAt = (a) => { const b = buysOf(a), q = quotaOf(a); if (b.length < q) return 0; const at = b[b.length - q] + windowMs(a); return at > Date.now() ? at : 0; };
  const usedLine = (a) => (quotaOf(a) > 1 ? `You have had your ${quotaOf(a)} tomes ${period(a)} (bought, or taught with).` : isSenior(a) ? `You have had your tome ${period(a)} (bought, or taught with).` : `You bought a tome ${period(a)}.`);
  const waitText = (ms) => { const h = Math.ceil(ms / 3600000); return h >= 24 ? `${plural(Math.floor(h / 24), 'day')}${h % 24 ? ' ' + plural(h % 24, 'hour') : ''}` : plural(h, 'hour'); };
  // Why this actor cannot buy now, or ''
  const shopRefusal = (a) => {
    if (!CFG.enabled) return 'The tome shop is closed.';
    if (!inShop(a)) return 'Tomes are sold inside the Synod Conclave in Bruma.';
    if (!isMember(a)) return placeOf(a) && placeOf(a).name ? `${placeOf(a).name} sells its tomes only to its own.` : 'The court mage sells tomes only to members of the Synod or a College.';
    if (CFG.shopAboveInitiate !== false && !aboveInitiate(a)) return 'The court mage sells tomes to mages of the Synod or a College above Initiate, and not to its smiths or robe-makers. Ask your college\'s leaders about promotion.';
    if (!SPELL_SKILLS.some((s) => tierOf(a, s.id) >= CFG.shopMinTier)) return `Tomes are sold to those with ${SPELL_SKILLS.map((s) => s.label).join(' or ')} at ${TIER_NAMES[CFG.shopMinTier]} or higher.`;
    const next = nextBuyAt(a);
    if (next) return `${usedLine(a)} The next is yours in ${waitText(next - Date.now())}.`;
    return '';
  };

  const shopNonces = globalThis.__dboTomeNonces instanceof Map ? globalThis.__dboTomeNonces : (globalThis.__dboTomeNonces = new Map());
  // The ledger each open shop came from (its building is paid for the sale); outlives a reload like the nonces
  const shopLedger = globalThis.__dboTomeLedger instanceof Map ? globalThis.__dboTomeLedger : (globalThis.__dboTomeLedger = new Map());
  // The name players read for the seller: the faction whose hall this is (guilds.js), else the Synod as before
  // The shop's own place first (shopPlaces: the cathedral is the Great Faiths'), as its refusals already name it (#bugs 12 Oct:
  // the cathedral's ledger was titled "The Synod" while saying "The Great Faiths sells its tomes only to its own")
  const sellerName = (a) => {
    const p = placeOf(a);
    if (p && p.name) return p.name;
    try { const n = typeof globalThis.__dboLedgerPlaceName === 'function' ? globalThis.__dboLedgerPlaceName(shopLedger.get(a >>> 0) || a) : ''; return n || 'The Synod'; } catch (e) { return 'The Synod'; }
  };
  const openShop = (a, result, resultKind) => {
    const nonce = `${(a >>> 0).toString(16)}-${Date.now().toString(36)}`;
    shopNonces.set(a >>> 0, nonce);
    const held = SPELL_SKILLS.map((s) => ({ s, tier: tierOf(a, s.id) })).filter((x) => x.tier >= 0);
    const schools = new Set([].concat(...held.map((x) => x.s.vanillaSkills || [])).concat(Object.keys(SKILL_OF_SCHOOL).filter((school) => pathsOf(a, school).some((skill) => tierOf(a, skill.id) >= 0))));
    const gold = goldOf(a);
    const whyNot = shopRefusal(a);
    const R = regions();
    const admin = !!R && R.bypass(a);
    const shelfLine = `The shelf changes each Monday. This week ${stockFor(a, R, admin).length ? 'it holds tomes chosen for your study' : 'it holds no tome your study can take'}.`;
    openWidget(a, {
      type: 'tomeShop', id: SHOP_ID, nonce, seller: sellerName(a), title: R ? `${sellerName(a)}: Spell Tomes of ${R.provinceName(CFG.shopProvince)}` : `${sellerName(a)}: Spell Tomes`, gold,
      canBuy: !whyNot, nextPurchaseAt: nextBuyAt(a), whyNot,
      skills: held.map((x) => ({ id: x.s.id, label: x.s.label, tier: x.tier, tierName: TIER_NAMES[x.tier], schools: (x.s.vanillaSkills || []).slice() })),
      tomes: stockFor(a, R, admin).filter((t) => schools.has(t.school)).map((t) => {
        const foreign = !soldFor(a, R, t);
        return {
          id: descOf(t.bookId), name: foreign && admin ? `${t.title} (${soldIn(R, t) || 'sold nowhere'})` : t.title, spell: t.name, school: t.school, rank: t.rank, rankName: RANKS[t.rank],
          price: priceOf(t), canAfford: gold >= priceOf(t), blocked: foreign && !admin ? (soldIn(R, t) ? `Sold in ${soldIn(R, t)}` : 'Not sold anywhere') : tomeBlock(a, t),
        };
      }),
      result: result || shelfLine, resultKind: result ? (resultKind || '') : '',
    }, true);
  };
  // The Scholars' Ledger's "Buy spell tomes" button (salvage.js): shown where the shop is; opens it for that ledger
  globalThis.__dboTomeShopHere = (a) => !!(CFG.enabled && CFG.shopAtLedger && inShop(a));
  globalThis.__dboTomeShopOpen = (a, ledger) => {
    if (!globalThis.__dboTomeShopHere(a)) return false;
    if (ledger) shopLedger.set(a >>> 0, ledger >>> 0); else shopLedger.delete(a >>> 0);
    openShop(a);
    return true;
  };
  const LEDGER_HINT = "Spell tomes are bought at the Scholars' Ledger now: use the ledger and choose Buy spell tomes.";
  registerChatCommand('tomes', (a) => {
    if (!CFG.enabled) return personal(a, 'The tome shop is closed.');
    if (!inShop(a)) return personal(a, CFG.shopAtLedger ? LEDGER_HINT : 'The court mage sells spell tomes inside the Synod Conclave in Bruma.');
    if (!CFG.tomesCommand) return personal(a, LEDGER_HINT);
    if (CFG.shopAtLedger) personal(a, `${LEDGER_HINT} /tomes still opens the shop for a while.`);
    shopLedger.delete(a >>> 0);
    openShop(a);
  }, { help: "The tome shop (now a button on the Scholars' Ledger in the Synod Conclave; college members, one tome a week)" });
  // The tome's price: split by ledgersale.js (the building's owner, the hold's tax, a sink), else all to shopTreasury
  const payForTome = (a, t, price) => {
    if (CFG.shopSplit && typeof globalThis.__dboLedgerSale === 'function') {
      try { const r = globalThis.__dboLedgerSale({ buyer: a, place: shopLedger.get(a >>> 0) || a, price, what: t.title }); return `split: ${r.text}`; }
      catch (e) { log('spells: tome sale payout failed', e.message); return 'the payout failed'; }
    }
    return `${depositToTreasury(CFG.shopTreasury, price)} to ${CFG.shopTreasury} treasury`;
  };

  // { ok, text } of a purchase
  const buy = (a, bookId) => {
    const why = shopRefusal(a);
    if (why) return { ok: false, text: why };
    const t = SHOP.find((x) => x.bookId === bookId);
    if (!t || !pathsOf(a, t.school).some((skill) => tierOf(a, skill.id) >= 0)) return { ok: false, text: 'The court mage will not sell you that tome.' };
    const R = regions();
    if (!soldFor(a, R, t) && !R.bypass(a)) return { ok: false, text: `${sellerName(a)} does not stock ${t.name}; ${soldIn(R, t) ? `it is sold in ${soldIn(R, t)}` : 'it is not sold anywhere'}.` };
    const block = tomeBlock(a, t) || rankBlock(a, t);
    if (block) return { ok: false, text: `${t.title}: ${block}.` };
    if (knows(a, t.spellId) || inBook(a, t.spellId)) return { ok: false, text: `You already know ${t.name}.` };
    if (!stockFor(a, R, !!R && R.bypass(a)).includes(t)) return { ok: false, text: `${t.title} is not on the Synod's shelf this week.` };
    const price = priceOf(t);
    if (!takeGold(a, price)) return { ok: false, text: `${t.title} costs ${price} gold, and you do not have it.` };
    if (!giveItem(a, t.bookId, 1)) { giveItem(a, GOLD, price); return { ok: false, text: 'The court mage could not hand you the tome. Your gold is returned.' }; }
    const paid = payForTome(a, t, price);
    recordBuy(a);
    audit(`SPELL ${who(a)} bought tome ${descOf(t.bookId)} ${t.title} for ${price} gold (${paid})`);
    return { ok: true, text: `You buy ${t.title} for ${price} gold. Read it at a spell study point. ${buysLeft(a) > 0 ? `You may have ${plural(buysLeft(a), 'more tome')} ${period(a)}, bought or taught with.` : nextBuyAt(a) ? `Your next tome is ${waitText(nextBuyAt(a) - Date.now())} away.` : `Your next tome is ${period(a) === 'today' ? 'a day' : period(a) === 'this week' ? 'a week' : `${windowDays(a)} days`} away.`}` };
  };
  const freshShop = (a, args) => shopNonces.get(a >>> 0) === String(args[0] || '');
  onUi('tomeBuy', (a, args) => {
    if (!freshShop(a, args)) return;
    const r = buy(a, idOf(String(args[1] || '')));
    openShop(a, r.text, r.ok ? 'ok' : 'refused');
  });
  onUi('tomeClose', (a) => { shopNonces.delete(a >>> 0); shopLedger.delete(a >>> 0); closeWidget(a, SHOP_ID); });

  // ---- teaching at a college (Elion and Aldemar's proposal, Nate 11 Oct) ---------------------------------------------
  // A Senior rank or above, at their own college's Scholars' Ledger or Class Lectern (the hall guilds.js names for its
  // cell), teaches a spell they know to a member of the same college within radiusMeters of it. One credit per lesson:
  // a tome of the spell the teacher carries (it is used up), else one of the teacher's tome purchases (it counts against the shop's quota, as
  // a purchase spends it). The student is asked first; the lesson is checked again when they accept. No book changes hands.
  const TEACH = Object.assign({ enabled: true, radiusMeters: 15, studentMinCap: 1 }, CFG.collegeTeach || {});
  // The faction whose hall `place` stands in: { id, name }, null for none, undefined when guilds.js cannot say
  const hallAt = (place) => {
    if (typeof globalThis.__dboHallFactionAt !== 'function') return undefined;
    try { return globalThis.__dboHallFactionAt(get(place, 'worldOrCellDesc', '')) || null; } catch (e) { return null; }
  };
  // { m, name } of the college `a` teaches for at `place`, or { why }
  const teachCollege = (a, place) => {
    const mine = collegesOf(a);
    if (!TEACH.enabled || !CFG.enabled || !mine) return { why: 'Spells are not taught here just now.' };
    const senior = mine.filter(isSeniorIn);
    if (!senior.length) return { why: 'Teaching a spell at your college takes Senior rank or above.' };
    const h = hallAt(place);
    const m = h === undefined ? senior[0] : h ? senior.find((x) => String(x.id) === String(h.id)) : null;
    if (!m) return { why: "A spell is taught at your own college's ledger or lectern." };
    return { m, name: String((h && h.name) || m.name || m.id) };
  };
  // Spells the teacher may teach: school spells they hold (book or engine), never above shopMaxRank (no Master spells)
  const collegeTeachable = (a) => {
    const ids = new Set([].concat(ownLearned(a), knownIds(a)));
    return [...ids].map(classifySpell).filter((sp) => sp && Number(sp.rank) <= Number(CFG.shopMaxRank))
      .sort((x, y) => x.school.localeCompare(y.school) || x.rank - y.rank || x.name.localeCompare(y.name));
  };
  const inventoryOf = (a) => { const inv = get(a, 'inventory', { entries: [] }); return Array.isArray(inv && inv.entries) ? inv.entries : []; };
  // A tome of this spell the teacher carries (not worn), its book id, or 0
  const heldTomeOf = (a, spellId) => {
    for (const e of inventoryOf(a)) {
      if (!e || e.worn || !(Number(e.count) > 0)) continue;
      const t = tomeOf(Number(e.baseId) >>> 0);
      if (t && !t.unknown && (t.spellId >>> 0) === (spellId >>> 0)) return Number(e.baseId) >>> 0;
    }
    return 0;
  };
  const takeOneItem = (a, baseId) => {
    const entries = inventoryOf(a).map((e) => Object.assign({}, e));
    const i = entries.findIndex((e) => (Number(e.baseId) >>> 0) === (baseId >>> 0) && !e.worn && Number(e.count) > 0);
    if (i < 0) return false;
    entries[i].count = Number(entries[i].count) - 1;
    if (entries[i].count <= 0) entries.splice(i, 1);
    return set(a, 'inventory', { entries });
  };
  // The credit a lesson of this spell would spend: { tome } or { day: true }, or { why }
  const creditFor = (a, spellId) => {
    const tome = heldTomeOf(a, spellId);
    if (tome) return { tome };
    const next = nextBuyAt(a);
    if (next) return { why: `${usedLine(a)} The next lesson is yours in ${waitText(next - Date.now())}, or teach from a tome of the spell you carry.` };
    return { day: true };
  };
  const inRoomOf = (place, b) => { try { return onlineActors().includes(b >>> 0) && distanceMeters(b, place) <= Number(TEACH.radiusMeters); } catch (e) { return false; } };
  // The highest rank this student may be taught at their place in the college: what they may buy, never below studentMinCap
  const studentCap = (student, fid) => {
    const mine = collegesOf(student) || [];
    const m = mine.find((x) => String(x.id) === String(fid));
    return m ? Math.min(Number(CFG.shopMaxRank), Math.max(rankCapIn(m), Number(TEACH.studentMinCap) || 0)) : -1;
  };
  // Why this lesson cannot happen now, or ''
  const collegeTeachRefusal = (teacher, student, sp, place, fid) => {
    if (suspended(sp.id)) return `${sp.name} is held back for a short while and is not taught.`;
    const c = teachCollege(teacher, place);
    if (c.why) return c.why;
    if (String(c.m.id) !== String(fid)) return "A spell is taught at your own college's ledger or lectern.";
    if (!inRoomOf(place, teacher)) return `${display(teacher)} must stay within ${TEACH.radiusMeters} m of the ledger or lectern.`;
    if (!collegeTeachable(teacher).some((x) => x.id === sp.id)) return `${display(teacher)} cannot teach ${sp.name}.`;
    if (factionSchools(fid) && !factionSchools(fid).includes(sp.school)) return `${c.name} teaches ${factionSchools(fid).join(' and ')}, not ${sp.school}.`;
    if ((student >>> 0) === (teacher >>> 0)) return 'You cannot teach yourself.';
    if (!inRoomOf(place, student)) return `${display(student)} must stand within ${TEACH.radiusMeters} m of the ledger or lectern.`;
    const cap = studentCap(student, fid);
    if (cap < 0) return `${display(student)} is not a member of ${c.name}.`;
    if (restrictedSpell(sp.id) && !isSenior(student)) return `${RESTRICTED_LINE}; ${display(student)} is not.`;
    if (Number(sp.rank) > cap) return `At ${display(student)}'s rank they may be taught spells up to ${RANKS[cap]}; ${sp.name} is ${/^[AEIOU]/.test(rankWord(sp.rank)) ? 'an' : 'a'} ${rankWord(sp.rank)} spell.`;
    if (knows(student, sp.id) || inBook(student, sp.id)) return `${display(student)} already knows ${sp.name}.`;
    const why = slotRefusal(student, sp, `${display(student)} has`);
    if (why) return `${display(student)} is not ready for ${sp.name}: ${why}`;
    return '';
  };
  // Shown on a ledger or lectern to a Senior rank of the college whose hall it is
  globalThis.__dboTeachHere = (a, place) => { try { return !teachCollege(a, place).why && collegeTeachable(a).length > 0; } catch (e) { return false; } };
  globalThis.__dboTeachLedgerActions = (a, place) => (globalThis.__dboTeachHere(a, place) ? [{ id: 'teach', label: 'Teach a spell to a student' }] : []);
  // The students the teacher may pick: online members of the college in the room
  const studentsAt = (a, place, fid) => onlineActors().filter((b) => b !== (a >>> 0) && inRoomOf(place, b) && studentCap(b, fid) >= 0).slice(0, MAX_ROWS);
  // Opens the "Teach whom?" menu (widget 45) for the teacher at `place`; false when they may not teach there
  const openCollegeTeach = (a, place, note) => {
    const c = teachCollege(a, place);
    if (c.why) { personal(a, c.why); return false; }
    const students = studentsAt(a, place, c.m.id);
    const title = note || (students.length ? `Teach a spell: which student of ${c.name}?` : `No member of ${c.name} stands within ${TEACH.radiusMeters} m to be taught.`);
    menu(a, MENU_ID, title, students.map((b) => ({ id: `cstudent:${b.toString(16)}`, label: display(b) })).concat([{ id: 'cancel', label: 'Close' }]), { kind: 'college', place: place >>> 0, fid: String(c.m.id) });
    return true;
  };
  globalThis.__dboTeachOpen = (a, place) => openCollegeTeach(a, Number(place) >>> 0);
  // A Class Lectern opened by a Senior rank of its college asks first: a class, or teaching a spell (schools.js)
  globalThis.__dboTeachLecternMenu = (a, place) => {
    if (!globalThis.__dboTeachHere(a, place)) return false;
    menu(a, MENU_ID, 'Class Lectern', [{ id: 'lectern', label: 'Hold or join a class' }, { id: 'teach', label: 'Teach a spell to a student' }, { id: 'cancel', label: 'Close' }], { kind: 'lecternRoot', place: place >>> 0 });
    return true;
  };
  const spellsMenuFor = (a, student, p, note) => {
    const rows = collegeTeachable(a).filter((sp) => !factionSchools(p.fid) || factionSchools(p.fid).includes(sp.school)).map((sp) => {
      const tome = heldTomeOf(a, sp.id);
      return { id: `clesson:${student.toString(16)}:${descOf(sp.id)}`, label: `${spellLabel(sp)}${tome ? ' (uses your tome of it)' : ''}` };
    });
    menu(a, MENU_ID, note || `Teach ${display(student)} which spell? A lesson uses a tome of the spell you carry, or your tome purchase ${period(a)}.`, rows.slice(0, MAX_ROWS - 1).concat([{ id: 'cback', label: 'Back' }]), Object.assign({}, p, { student }));
  };
  const offerCollege = (a, student, spellId, p) => {
    const sp = classifySpell(spellId);
    if (!sp) return spellsMenuFor(a, student, p, 'That spell cannot be taught.');
    const why = collegeTeachRefusal(a, student, sp, p.place, p.fid);
    if (why) return spellsMenuFor(a, student, p, why);
    const credit = creditFor(a, sp.id);
    if (credit.why) return spellsMenuFor(a, student, p, credit.why);
    closeMenu(a);
    offers.set(student >>> 0, { teacher: a >>> 0, spellId: sp.id, at: Date.now(), college: { place: p.place, fid: p.fid } });
    openWidget(student, { type: 'contextMenu', id: MENU_ID, mode: 'menu', targetName: `${display(a)} offers to teach you ${spellLabel(sp)}`,
      actions: [{ id: 'accept', label: 'Learn it (it goes into your spellbook)' }, { id: 'decline', label: 'Decline' }],
      events: { action: 'dbo:spellsOffer', close: 'dbo:spellsOfferClose' } }, true);
    personal(a, `You offer to teach ${display(student)} ${sp.name}. ${credit.tome ? 'Your tome of it is used when they accept.' : `Your tome purchase ${period(a)} is used when they accept.`}`);
  };
  // The student's answer to a college lesson: everything is checked again, then the credit is spent and the spell learned
  const answerCollege = (student, o) => {
    const sp = classifySpell(o.spellId);
    const teacher = o.teacher;
    const why = sp ? collegeTeachRefusal(teacher, student, sp, o.college.place, o.college.fid) : 'That spell cannot be taught.';
    if (why) { personal(student, why); personal(teacher, why); return; }
    const credit = creditFor(teacher, sp.id);
    if (credit.why) { personal(student, `${display(teacher)} cannot teach another lesson today.`); personal(teacher, credit.why); return; }
    if (credit.tome && !takeOneItem(teacher, credit.tome)) { personal(teacher, 'Your tome could not be used. Try again.'); return; }
    if (credit.day) recordBuy(teacher);
    const skill = bookSkillFor(student, sp);
    migrate(student);
    writeStudied(student, skill.id, studiedIds(student, skill.id).concat([sp.id]));
    const line = settleNew(student, sp, false);
    personal(student, `${display(teacher)} teaches you ${spellLabel(sp)}. ${line}`);
    personal(teacher, `You teach ${display(student)} ${sp.name}. ${credit.tome ? 'Your tome of it is used up.' : (buysLeft(teacher) > 0 ? `That used one of your tome purchases; ${buysLeft(teacher)} left ${period(teacher)}.` : `That used your tome purchase ${period(teacher)}; the next is yours in ${waitText(nextBuyAt(teacher) - Date.now())}.`)}`);
    audit(`TEACH ${who(teacher)} taught ${descOf(sp.id)} ${sp.name} to ${who(student)} at ${descOf(o.college.place)} for ${o.college.fid} (${credit.tome ? `tome ${descOf(credit.tome)}` : 'a tome purchase'}; book ${knownIds(student).length}, prepared ${preparedIds(student).length}/${MAXP()})`);
  };

  // ---- a class's spell, offered when the class ends (Worker E's idea, Nate 11 Oct) -----------------------------------------
  // schools.js calls this for each student paid for a Class Lectern class. The student's checks are a college lesson's:
  // their own skill and school gates (slotRefusal), the rank they may buy in any college (never below studentMinCap, also
  // for a student of no college), and the restricted arts for Senior ranks only. One credit per class (creditFor, as a
  // lesson): a spell is never handed out for nothing, and a class of twelve still costs one tome.
  const paidClasses = globalThis.__dboPaidClasses instanceof Map ? globalThis.__dboPaidClasses : (globalThis.__dboPaidClasses = new Map()); // class key -> ms paid
  const classPaid = (key) => { for (const [k, at] of paidClasses) if (Date.now() - at > 2 * 3600000) paidClasses.delete(k); return !!key && paidClasses.has(key); };
  const classStudentCap = (student) => {
    const mine = collegesOf(student) || [];
    return Math.min(Number(CFG.shopMaxRank), Math.max(Number(TEACH.studentMinCap) || 0, ...mine.map(rankCapIn)));
  };
  const classRefusal = (teacher, student, sp) => {
    if (suspended(sp.id)) return `${sp.name} is held back for a short while and is not taught.`;
    if (!onlineActors().includes(student >>> 0)) return `${display(student)} is not here.`;
    if (!((knows(teacher, sp.id) && !onLoan(teacher, sp.id)) || inBook(teacher, sp.id))) return `${display(teacher)} can no longer teach ${sp.name}.`;
    if (restrictedSpell(sp.id) && !isSenior(student)) return `${RESTRICTED_LINE}.`;
    const cap = classStudentCap(student);
    if (Number(sp.rank) > cap) return `At your rank you may be taught spells up to ${RANKS[cap]}; ${sp.name} is ${/^[AEIOU]/.test(rankWord(sp.rank)) ? 'an' : 'a'} ${rankWord(sp.rank)} spell.`;
    if (knows(student, sp.id) || inBook(student, sp.id)) return 'known';
    return slotRefusal(student, sp, 'You have') || '';
  };
  globalThis.__dboSpellsClassOffer = (teacher, student, spellId, classKey) => {
    try {
      if (!CFG.enabled) return false;
      const sp = classifySpell(Number(spellId) >>> 0);
      if (!sp) return false;
      const why = classRefusal(teacher >>> 0, student >>> 0, sp);
      if (why === 'known') return false;
      if (why) { personal(student, `${display(teacher)} would teach you ${sp.name}, but: ${why}`); return false; }
      const key = String(classKey || `${teacher >>> 0}:${sp.id}:${Math.floor(Date.now() / 60000)}`);
      if (!classPaid(key) && creditFor(teacher >>> 0, sp.id).why) {
        personal(student, `${display(teacher)} has no tome of ${sp.name} and no tome purchase left today, so the class's spell is not handed out.`);
        return false;
      }
      offers.set(student >>> 0, { teacher: teacher >>> 0, spellId: sp.id, at: Date.now(), cls: true, classKey: key });
      openWidget(student, { type: 'contextMenu', id: MENU_ID, mode: 'menu', targetName: `${display(teacher)} offers to teach you ${spellLabel(sp)}, the spell of the class`,
        actions: [{ id: 'accept', label: 'Learn it (it goes into your spellbook)' }, { id: 'decline', label: 'Decline' }],
        events: { action: 'dbo:spellsOffer', close: 'dbo:spellsOfferClose' } }, true);
      return true;
    } catch (e) { log('spells: class offer failed', e.message); return false; }
  };
  const answerClass = (student, o) => {
    const sp = classifySpell(o.spellId);
    const why = sp ? classRefusal(o.teacher, student, sp) : 'That spell cannot be taught.';
    if (why) { personal(student, why === 'known' ? `You already know ${sp.name}.` : why); return; }
    // The class's one credit: the first student to accept spends it, the rest learn on it
    let paidWith = 'the class\'s tome';
    if (!classPaid(o.classKey)) {
      const credit = creditFor(o.teacher, sp.id);
      if (credit.why) { personal(student, `${display(o.teacher)} has no tome of ${sp.name} and no tome purchase left today, so the spell cannot be taught.`); return; }
      if (credit.tome && !takeOneItem(o.teacher, credit.tome)) { personal(student, 'The lesson could not be completed. Ask your teacher.'); return; }
      if (credit.day) recordBuy(o.teacher);
      paidClasses.set(o.classKey, Date.now());
      paidWith = credit.tome ? `tome ${descOf(credit.tome)}` : 'a tome purchase';
      if (onlineActors().includes(o.teacher)) personal(o.teacher, credit.tome ? `Your class's spell is taught: your tome of ${sp.name} is used up, once for the whole class.` : `Your class's spell is taught: it used your tome purchase today, once for the whole class.`);
    }
    const skill = bookSkillFor(student, sp);
    migrate(student);
    writeStudied(student, skill.id, studiedIds(student, skill.id).concat([sp.id]));
    const line = settleNew(student, sp, false);
    personal(student, `${display(o.teacher)} teaches you ${spellLabel(sp)}. ${line}`);
    if (onlineActors().includes(o.teacher)) personal(o.teacher, `${display(student)} learned ${sp.name} from your class.`);
    audit(`TEACH ${who(o.teacher)} taught ${descOf(sp.id)} ${sp.name} to ${who(student)} at a class (${paidWith}; book ${knownIds(student).length}, prepared ${preparedIds(student).length}/${MAXP()})`);
  };

  // ---- the tome that teaches a spell (scribing.js writes it; Nate, 16 Oct, moved there with Swag's rules on 17 Oct) ----------
  // spell id -> a tome that teaches it. The ordinary SpellTome* book wins over a quest reward copy (MGRDestructionFinal is
  // also Fire Storm)
  const TOME_OF_SPELL = new Map();
  for (const t of TOMES.values()) { const had = TOME_OF_SPELL.get(t.spellId >>> 0); if (!had || (!/^SpellTome/i.test(had.edid) && /^SpellTome/i.test(t.edid))) TOME_OF_SPELL.set(t.spellId >>> 0, t); }
  globalThis.__dboSpellsTomeOf = (spellId) => { const t = TOME_OF_SPELL.get(Number(spellId) >>> 0); return t ? { bookId: t.bookId, spellId: t.spellId, title: t.title, edid: t.edid, school: t.school, rank: t.rank, name: t.name } : null; };
  // Every spell some tome teaches, for scribing.js's list of Master tomes (the writer of one need not know the spell)
  globalThis.__dboSpellsTomeSpells = () => [...TOME_OF_SPELL.keys()];

  // ---- menu answers ----------------------------------------------------------------------------------
  onUi('spellsChoose', (a, args) => {
    const p = pending.get(a >>> 0); const choice = String(args[0] || '');
    // Picking a spell to forget or a student reopens this widget id as the next menu; closing it first in the same tick
    // loses the cursor (the inn prompt, 2026-09-25), so those paths reopen with no close in between.
    const reopening = !!p && ((p.kind === 'teach' && choice.startsWith('student:')) || p.kind === 'college' || (p.kind === 'lecternRoot' && choice !== 'cancel'));
    if (reopening) pending.delete(a >>> 0); else closeMenu(a);
    if (!p || choice === 'cancel') return;
    // A Class Lectern's first question: the class panel opens before this menu closes (panel handoff), or teaching
    if (p.kind === 'lecternRoot') {
      if (choice === 'teach') { if (!openCollegeTeach(a, p.place)) closeWidget(a, MENU_ID); return; }
      const done = choice === 'lectern' && typeof globalThis.__dboSchoolsOpenLectern === 'function' && globalThis.__dboSchoolsOpenLectern(a, p.place);
      closeWidget(a, MENU_ID);
      if (!done) personal(a, 'The lectern cannot be used just now.');
      return;
    }
    if (p.kind === 'college') {
      // The teacher must still be at the ledger or lectern to choose; a lesson is offered from there
      if (!inRoomOf(p.place, a)) { closeWidget(a, MENU_ID); return personal(a, 'You walked away from the ledger.'); }
      if (choice.startsWith('cstudent:')) return spellsMenuFor(a, parseInt(choice.slice(9), 16) >>> 0, p);
      if (choice === 'cback') return openCollegeTeach(a, p.place);
      if (choice.startsWith('clesson:')) { const [, s16, ...d] = choice.split(':'); return offerCollege(a, parseInt(s16, 16) >>> 0, idOf(d.join(':')), p); }
      closeWidget(a, MENU_ID);
      return;
    }
    if (p.kind === 'teach') {
      if (choice.startsWith('student:')) {
        const student = parseInt(choice.slice(8), 16) >>> 0;
        const list = teachable(a).map((sp) => ({ id: `lesson:${student.toString(16)}:${descOf(sp.id)}`, label: spellLabel(sp) }));
        return menu(a, MENU_ID, `Teach ${display(student)} which spell?`, list.slice(0, MAX_ROWS), { kind: 'teach' });
      }
      if (choice.startsWith('lesson:')) { const [, s16, ...d] = choice.split(':'); return offerTeach(a, parseInt(s16, 16) >>> 0, idOf(d.join(':'))); }
      return;
    }
  });
  onUi('spellsClose', (a) => closeMenu(a));
  onUi('close', (a, args, widgetId) => { if (widgetId === MENU_ID) { pending.delete(a >>> 0); offers.delete(a >>> 0); } if (widgetId === SHOP_ID) { shopNonces.delete(a >>> 0); shopLedger.delete(a >>> 0); } if (widgetId === BOOK_ID) { bookNonces.delete(a >>> 0); bookLedger.delete(a >>> 0); } });

  // For the F3 Magic tab (schools.js __dboMagicTab): the book, the prepared spells and the spells held outside the book
  // (granted outright, never studied: they take no prepared place), and whether they may be changed where `a` stands
  globalThis.__dboSpellsTab = (a) => {
    const prep = preparedIds(a);
    const book = knownIds(a);
    const outside = (learnedIds(a) || []).filter((id) => !book.includes(id)).map(classifySpell).filter(Boolean)
      .map((sp) => ({ id: descOf(sp.id), name: sp.name, school: sp.school, rank: sp.rank, rankName: RANKS[sp.rank] || '' }));
    const college = atCollege(a);
    return {
      max: MAXP(), canPrepare: college, hint: college ? '' : COLLEGE_HINT,
      prepared: prep.map((id) => entryOf(id, true)),
      known: book.map((id) => entryOf(id, prep.includes(id))).sort((x, y) => x.school.localeCompare(y.school) || x.rank - y.rank || x.name.localeCompare(y.name)),
      outside,
    };
  };
  // The highest tome rank a Scholar's reading may give `a` (readGate, above): the college rank's, between floorRank and
  // maxRank; 4 (no gate) when readGate is off. Without guilds.js no college rank is known, so the floor.
  const READ_GATE = Object.assign({ enabled: true, floorRank: 2, maxRank: 3, byRole: null, restricted: true }, CFG.readGate || {});
  const readCapIn = (m) => {
    const by = READ_GATE.byRole && typeof READ_GATE.byRole === 'object' ? READ_GATE.byRole : null;
    if (!by) return rankCapIn(m);
    if (!m || CRAFT_ROLES.has(String(m.role || '')) || isInitiate(m)) return -1;
    const v = Number(by[String(m.role || '')] !== undefined ? by[String(m.role || '')] : by.member);
    return Number.isFinite(v) ? v : -1;
  };
  globalThis.__dboSpellsReadRankCap = (a) => {
    if (!READ_GATE.enabled) return 4;
    const floor = Number(READ_GATE.floorRank) || 0, top = Number.isFinite(Number(READ_GATE.maxRank)) ? Number(READ_GATE.maxRank) : 3;
    const mine = collegesOf(a);
    const rank = mine ? mine.reduce((n, m) => Math.max(n, readCapIn(m)), -1) : -1;
    return Math.min(top, Math.max(floor, rank));
  };
  // Whether a Scholar's reading must pass over this tome for `a`: a spell taken out of the game (removedSpells) for everyone,
  // whatever the gate (#bugs 1559198426200150027, 15 Oct: a Transmute tome pressed between the pages that nobody can read);
  // a restricted art (seniorOnlyTomes) for one below Senior
  globalThis.__dboSpellsReadRestricted = (a, bookId) => {
    let t = null; try { t = tomeOf(Number(bookId) >>> 0); } catch (e) { t = null; }
    if (t && removed(t.spellId)) return true;
    if (!READ_GATE.enabled || READ_GATE.restricted === false) return false;
    return !!t && restrictedTome(t) && !isSenior(a);
  };
  // The highest spell rank `skillId`'s tier lets `a` learn, -1 when the skill is not taken up
  globalThis.__dboSpellsRankCap = (a, skillId) => maxRankFor(String(skillId), tierOf(a, String(skillId)));
  // The Magic tab's prepare and put-away (the spellbook's rule: at a college or beside a Scholars' Ledger); { ok, text }
  globalThis.__dboSpellsChangePrepared = (a, spellDesc, want) => {
    if (!CFG.enabled) return { ok: false, text: 'Spell study is closed.' };
    migrate(a);
    const r = changePrepared(a, idOf(String(spellDesc || '')), !!want);
    return { ok: !!r.ok, text: r.text };
  };
  // Tomes of `school` up to the rank `skillId`'s tier allows (and `maxRank`), whose spell `a` does not know, lowest rank
  // first, with where they are sold: [{ spell, school, rank, rankName, where }]
  // Every spell of `school` at exactly `rank` that a tome teaches, minus the shop's excluded plugins and editor ids: the
  // Apprentice and Adept choices of the Arcane Mastery picks (schools.js rankPicks). Spell ids, one each, vanilla first.
  // Removed spells never; the restricted arts (seniorOnlyTomes) only when `a` is given and is a Senior rank, as at the shop.
  globalThis.__dboSpellsRankOptions = (school, rank, a) => {
    const seen = new Set();
    const senior = !!a && isSenior(a);
    return [...TOMES.values()]
      .filter((t) => t.school === String(school) && t.rank === Number(rank) && !(CFG.shopExcludePlugins || []).includes(t.plugin) && !(excluded && excluded.test(t.edid))
        && !removed(t.spellId) && (senior || !restrictedTome(t)))
      .sort((x, y) => (x.plugin === 'Skyrim.esm' ? 0 : 1) - (y.plugin === 'Skyrim.esm' ? 0 : 1) || x.name.localeCompare(y.name))
      .filter((t) => (seen.has(t.spellId) ? false : seen.add(t.spellId)))
      .map((t) => t.spellId >>> 0);
  };
  // Why a spell may not pass to `a` by an apprenticeship (schools.js), or '': a removed spell, one no tome teaches (a beast
  // form's, a power, a quest's), a restricted art below Senior rank, or one switched off
  const TOME_SPELLS = new Set([...TOMES.values()].map((t) => t.spellId >>> 0));
  globalThis.__dboSpellsOpenTo = (a, spellId) => {
    const id = Number(spellId) >>> 0;
    if (removed(id)) return 'no longer taught';
    if (suspended(id)) return 'held back for a short while';
    if (!TOME_SPELLS.has(id)) return 'not a spell of the tomes';
    if (restrictedSpell(id) && !isSenior(a)) return RESTRICTED_LINE;
    try { if (typeof globalThis.__dboCastBlocked === 'function' && globalThis.__dboCastBlocked(id)) return 'switched off'; } catch (e) { /* no gate */ }
    return '';
  };
  globalThis.__dboSpellsTomesFor = (a, school, skillId, maxRank, limit) => {
    const cap = Math.min(maxRankFor(String(skillId), tierOf(a, String(skillId))), Number.isFinite(Number(maxRank)) ? Number(maxRank) : 4);
    if (cap < 0) return [];
    const have = new Set([].concat(learnedIds(a) || [], knownIds(a)));
    const R = regions();
    const seen = new Set();
    const pref = (t) => { const i = (CFG.shopPreferPlugins || []).indexOf(t.plugin); return i < 0 ? 99 : i; };
    const shop = new Set(SHOP.map((t) => t.bookId));
    return [...TOMES.values()]
      .filter((t) => t.school === school && t.rank <= cap && !have.has(t.spellId) && !(CFG.shopExcludePlugins || []).includes(t.plugin) && !(excluded && excluded.test(t.edid)))
      .sort((x, y) => x.rank - y.rank || (shop.has(y.bookId) && soldHere(R, y) ? 1 : 0) - (shop.has(x.bookId) && soldHere(R, x) ? 1 : 0) || pref(x) - pref(y) || x.name.localeCompare(y.name))
      .filter((t) => (seen.has(t.spellId) ? false : seen.add(t.spellId)))
      .slice(0, Math.max(1, Number(limit) || 6))
      .map((t) => ({ spell: t.name, school: t.school, rank: t.rank, rankName: RANKS[t.rank],
        where: shop.has(t.bookId) && soldHere(R, t) ? 'Sold by the Synod in Bruma (members of the Synod or a College)' : soldIn(R, t) ? `Sold in ${soldIn(R, t)}` : 'Found, not sold' }));
  };

  // ---- staff trims (Jake, 17 Oct 2026): a staff removal of learned spells written in config, applied once per id ----------
  // Why: the admin panel's Give all spells (adminSystem.ts) adds every tome spell, and reading a learned list costs the fork
  // N squared (PapyrusActor GetSpellCount and GetNthSpell run IsSpellLearnedFromBase on every spell, and MpActor reads the
  // base spells again each time). A character with 331 spells froze the main loop about 4.5 s a read (17 Oct).
  // spells.staffTrims = [{ id, actor: 'ff001473', profile, keepSpells: [desc...], removeSpells: [desc...], keepShouts?: [],
  // by, why }]. At load, and so at every hot reload, each entry not yet applied to its character removes every spell of
  // removeSpells (computed offline from the character's saved form and a backup from before the grant) that is not in
  // keepSpells, the spellbook (private.dboStudied), the prepared list or on loan from a teacher. It uses Actor.RemoveSpell,
  // the engine's own path, which also tells the client when the character is online, trimBatch (20) spells a run every
  // trimEveryMs (1000), so the removal never holds the loop. The learned list is never read. A character who is offline is
  // trimmed on the saved form (the engine keeps every saved character loaded and drops the client message while nobody
  // plays it), so the next login reads the short list; offline: 'wait' waits instead until they have been online for
  // trimSettleMs. The removed spells also leave private.dboHeldSpells, so the end of a suspension does not give them back.
  // keepShouts [] takes off the all-shouts grant (private.dboAllShouts, the only shout state the server keeps: the client is
  // taught them at login); the grant cannot be kept in part, so a non-empty list leaves it on; no keepShouts leaves shouts
  // alone. One audit line per batch and a summary. The result is kept on the character (private.dboSpellTrims[id]), so the
  // entry never applies again (a new trim needs a new id). A bad entry (no id, an actor that is not a player character, a
  // profile that does not match it, a desc this load order cannot resolve or that is not a spell) is skipped with a log
  // line and stays unapplied. Only the named character is touched.
  const TRIMS = 'private.dboSpellTrims';
  const ALL_SHOUTS = 'private.dboAllShouts';
  const TRIM_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
  const TRIM_BATCH = Math.max(1, Math.min(50, Math.floor(Number(CFG.trimBatch) || 20)));
  const TRIM_EVERY_MS = Math.max(250, Number(CFG.trimEveryMs) || 1000);
  const TRIM_SETTLE_MS = Math.max(0, Number(CFG.trimSettleMs) || 20000);
  const trimText = (s, n) => String(s == null ? '' : s).replace(/<[@#][!&]?\d+>/g, '').replace(/\d{15,22}/g, '').replace(/\s+/g, ' ').trim().slice(0, n || 80);
  // id -> the run in progress; kept over a reload, so a reload mid-run goes on where it was. One timer for every run
  const trimRuns = globalThis.__dboSpellTrimRuns instanceof Map ? globalThis.__dboSpellTrimRuns : (globalThis.__dboSpellTrimRuns = new Map());
  const trimSeen = globalThis.__dboSpellTrimSeen instanceof Map ? globalThis.__dboSpellTrimSeen : (globalThis.__dboSpellTrimSeen = new Map()); // actor -> first seen online
  if (globalThis.__dboSpellTrimTimer) { clearInterval(globalThis.__dboSpellTrimTimer); globalThis.__dboSpellTrimTimer = null; }
  // A saved character: reading a form that does not exist throws
  const trimExists = (a) => { try { mp.get(a, 'profileId'); return true; } catch (e) { return false; } };
  const trimsOf = (a) => { const r = get(a, TRIMS, null); return r && typeof r === 'object' && !Array.isArray(r) ? r : {}; };
  const isSpellRec = (id) => { const r = lookup(id); return !!r && String(r.record.type) === 'SPEL'; };
  const trimCheck = (x) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return { error: 'not an object' };
    const id = typeof x.id === 'string' ? x.id.trim() : '';
    if (!TRIM_ID.test(id)) return { error: id ? 'a bad id (letters, digits and . _ : - only, at most 64)' : 'no id' };
    const hexStr = String(x.actor == null ? '' : x.actor).trim().toLowerCase().replace(/^0x/, '');
    const actor = /^[0-9a-f]{1,8}$/.test(hexStr) ? parseInt(hexStr, 16) >>> 0 : 0;
    if (actor < 0xff000000) return { id, error: 'actor is not a player character id (ff......)' };
    const profile = typeof x.profile === 'number' || (typeof x.profile === 'string' && /^\d+$/.test(x.profile)) ? Number(x.profile) : NaN;
    if (!Number.isInteger(profile) || profile < 0) return { id, error: 'no profile' };
    if (!Array.isArray(x.keepSpells)) return { id, error: 'keepSpells is not a list' };
    if (!Array.isArray(x.removeSpells) || !x.removeSpells.length) return { id, error: 'removeSpells is not a list of spells' };
    if (x.keepShouts !== undefined && !Array.isArray(x.keepShouts)) return { id, error: 'keepShouts is not a list' };
    if (x.offline !== undefined && x.offline !== 'apply' && x.offline !== 'wait') return { id, error: "offline is neither 'apply' nor 'wait'" };
    const keep = new Set();
    for (const d of x.keepSpells) { const s = idOf(d); if (!s) return { id, error: `keep spell ${trimText(d, 60)} is not in this load order` }; keep.add(s); }
    const remove = [];
    for (const d of x.removeSpells) {
      const s = idOf(d);
      if (!s) return { id, error: `spell ${trimText(d, 60)} is not in this load order` };
      if (!remove.includes(s)) remove.push(s);
    }
    return { id, actor, profile, keep, remove, keepShouts: x.keepShouts, wait: x.offline === 'wait', by: trimText(x.by), why: trimText(x.why, 160) };
  };
  // A run: the spells to take off, decided once from the config and the saved character, never from the learned list
  const trimStart = (r) => {
    const a = r.actor;
    if (!trimExists(a)) return { error: `character ${a.toString(16)} not found` };
    const pid = Number(get(a, 'profileId', NaN));
    if (pid !== r.profile) return { error: `character ${a.toString(16)} is of profile ${Number.isFinite(pid) ? pid : 'unknown'}, not ${r.profile}` };
    // Each listed form must be a spell in this load order (a record read each, only while the entry is unapplied)
    const notSpell = r.remove.find((s) => !isSpellRec(s));
    if (notSpell !== undefined) return { error: `${descOf(notSpell) || notSpell.toString(16)} is not a spell` };
    const book = new Set([].concat(knownIds(a), preparedIds(a)).map((s) => s >>> 0));
    const list = [], spared = [];
    for (const s of r.remove) {
      if (r.keep.has(s)) continue;
      if (book.has(s) || onLoan(a, s)) { spared.push(s); continue; }
      list.push(s);
    }
    const old = trimRuns.get(r.id);
    const carry = old && old.actor === a ? old : null;
    const run = { id: r.id, entry: r, actor: a, list, spared, i: 0, batch: 0, removed: carry ? carry.removed : [], absent: carry ? carry.absent : [],
      failed: [], stuck: 0, startedAt: carry ? carry.startedAt : Date.now(), wait: r.wait };
    if (carry) { const done = new Set([].concat(run.removed, run.absent)); run.list = list.filter((s) => !done.has(s)); }
    trimRuns.set(r.id, run);
    return { run };
  };
  const trimFinish = (run) => {
    trimRuns.delete(run.id);
    const a = run.actor, r = run.entry;
    if (run.failed.length) {
      log(`spells: staff trim ${run.id}: ${run.failed.length} spell(s) could not be removed (${run.lastError || 'no reason'}); it stays unapplied and runs again at the next load`);
      audit(`SPELL TRIM ${run.id} ${who(a)} stopped: ${run.removed.length} removed, ${run.failed.length} failed; runs again at the next load`);
      return;
    }
    // The held list: a removed spell is not given back when its suspension ends
    const gone = new Set(r.remove.filter((s) => !r.keep.has(s) && !run.spared.includes(s)));
    const held = heldOf(a);
    const heldDropped = held.filter((s) => gone.has(s));
    if (heldDropped.length) set(a, HELD, held.filter((s) => !gone.has(s)).map(descOf).filter(Boolean));
    let shouts = 'untouched';
    if (Array.isArray(r.keepShouts)) {
      const granted = get(a, ALL_SHOUTS, null) === true;
      if (!granted) shouts = 'none granted';
      else if (r.keepShouts.length) { shouts = 'grant kept (it cannot be kept in part)'; log(`spells: staff trim ${run.id}: keepShouts lists shouts, so the all-shouts grant stays on`); }
      else shouts = set(a, ALL_SHOUTS, null) ? 'grant taken off' : 'grant could not be taken off';
    }
    const rec = { at: Date.now(), by: r.by, why: r.why, removed: run.removed.map(descOf), notLearned: run.absent.length, spared: run.spared.map(descOf),
      heldDropped: heldDropped.map(descOf), shouts, ms: Date.now() - run.startedAt };
    set(a, TRIMS, Object.assign({}, trimsOf(a), { [run.id]: rec }));
    audit(`SPELL TRIM ${run.id} ${who(a)} done: ${run.removed.length} spell(s) removed, ${run.absent.length} not learned, ${run.spared.length} kept as spellbook, prepared or on loan${heldDropped.length ? `, ${heldDropped.length} off the held list (${rec.heldDropped.join(', ')})` : ''}, shouts: ${shouts}; by ${r.by || 'staff'}${r.why ? `: ${r.why}` : ''}`);
    log(`spells: staff trim ${run.id} applied to ${a.toString(16)}: ${run.removed.length} removed, ${run.absent.length} not learned, ${run.spared.length} spared, ${heldDropped.length} held dropped, shouts ${shouts}, ${run.batch} batch(es)`);
    if (run.removed.length && onlineActors().map((x) => x >>> 0).includes(a)) {
      personal(a, `The staff have taken ${plural(run.removed.length, 'spell')} given by the admin panel's Give all spells off this character: a spell list that long slowed the whole server. The spells you had before are kept.`);
    }
  };
  // One batch a run, of the first run that can go: RemoveSpell costs one base-spell read, not a read of the list
  const trimTick = () => {
    const online = new Set(onlineActors().map((x) => x >>> 0));
    for (const k of trimSeen.keys()) if (!online.has(k)) trimSeen.delete(k);
    for (const k of online) if (!trimSeen.has(k)) trimSeen.set(k, Date.now());
    for (const run of trimRuns.values()) {
      if (run.wait && !(online.has(run.actor) && Date.now() - trimSeen.get(run.actor) >= TRIM_SETTLE_MS)) continue;
      if (run.i >= run.list.length) { trimFinish(run); break; }
      const ids = run.list.slice(run.i, run.i + TRIM_BATCH);
      const t0 = Date.now();
      const self = { type: 'form', desc: descOf(run.actor) };
      const gone = [], absent = [], failed = [];
      for (const s of ids) {
        let ok;
        try { ok = mp.callPapyrusFunction('method', 'Actor', 'RemoveSpell', self, [{ type: 'espm', desc: descOf(s) }]) === true; }
        catch (e) { failed.push(s); run.lastError = e.message; continue; }
        (ok ? gone : absent).push(s);
      }
      // Nothing went through: the character is not there right now. The same batch again next run, then give up for this load
      if (failed.length === ids.length) {
        if (++run.stuck >= 3) { run.failed = failed; trimFinish(run); }
        break;
      }
      run.stuck = 0; run.i += ids.length; run.batch++;
      run.removed.push(...gone); run.absent.push(...absent); run.failed.push(...failed);
      const total = Math.ceil(run.list.length / TRIM_BATCH);
      audit(`SPELL TRIM ${run.id} ${who(run.actor)} batch ${run.batch}/${total} (${Date.now() - t0} ms): ${gone.length} removed${gone.length ? ` (${gone.map(descOf).join(', ')})` : ''}${absent.length ? `, ${absent.length} not learned` : ''}${failed.length ? `, ${failed.length} failed` : ''}`);
      if (run.i >= run.list.length) trimFinish(run);
      break;
    }
    if (!trimRuns.size && globalThis.__dboSpellTrimTimer) { clearInterval(globalThis.__dboSpellTrimTimer); globalThis.__dboSpellTrimTimer = null; }
  };
  // Starts every new entry of the config. Never throws: a load must not fail over a staff entry
  const staffTrims = () => {
    const out = { started: [], before: 0, skipped: [] };
    const list = CFG.staffTrims;
    if (list === undefined || list === null) return out;
    if (!Array.isArray(list)) { log('spells: config staffTrims is not a list; nothing trimmed'); return out; }
    const seenIds = new Set();
    list.forEach((x, i) => {
      try {
        const r = trimCheck(x);
        if (r.error) { out.skipped.push({ at: i, id: r.id || '', error: r.error }); log(`spells: staff trim ${r.id ? `${r.id} ` : ''}(entry ${i + 1}) skipped: ${r.error}`); return; }
        if (seenIds.has(r.id)) { out.skipped.push({ at: i, id: r.id, error: 'a second entry with this id' }); log(`spells: staff trim ${r.id} (entry ${i + 1}) skipped: a second entry with this id`); return; }
        seenIds.add(r.id);
        if (trimExists(r.actor) && trimsOf(r.actor)[r.id]) { trimRuns.delete(r.id); out.before++; return; }
        const s = trimStart(r);
        if (s.error) { trimRuns.delete(r.id); out.skipped.push({ at: i, id: r.id, error: s.error }); log(`spells: staff trim ${r.id} (entry ${i + 1}) skipped: ${s.error}`); return; }
        out.started.push(s.run);
      } catch (e) { out.skipped.push({ at: i, id: '', error: e.message }); log(`spells: staff trim (entry ${i + 1}) failed`, e.stack || e.message); }
    });
    // A run whose entry left the config stops
    for (const id of [...trimRuns.keys()]) if (!seenIds.has(id)) trimRuns.delete(id);
    if (trimRuns.size) globalThis.__dboSpellTrimTimer = setInterval(() => { try { trimTick(); } catch (e) { log('spells: staff trim tick failed', e.stack || e.message); } }, TRIM_EVERY_MS);
    if (out.started.length || out.skipped.length) {
      log(`spells: staff trims: ${out.started.length} started (${out.started.map((run) => `${run.id}: ${run.list.length} to remove from ${run.actor.toString(16)}, ${run.spared.length} spared${run.wait ? ', waits for login' : ''}`).join('; ') || 'none'}), ${out.before} applied before, ${out.skipped.length} skipped`);
    }
    return out;
  };
  globalThis.__dboSpellsStaffTrims = () => [...trimRuns.values()].map((run) => ({ id: run.id, actor: run.actor, left: run.list.length - run.i, removed: run.removed.length, wait: run.wait }));
  try { staffTrims(); } catch (e) { log('spells: staff trims failed', e.stack || e.message); }

  const R0 = regions();
  log(`spells ${CFG.enabled ? 'on' : 'off'}: ${TOMES.size} tomes known, ${STUDY_POINTS.length} study point(s), ${SHOP.length} tomes in the Synod shop, ${MAXP()} prepared, changed in ${COLLEGE_CELLS.size} college cell(s)${R0 ? `, ${SHOP.filter((t) => soldHere(R0, t)).length} stocked for ${R0.provinceName(CFG.shopProvince)}` : ''}`);
};
