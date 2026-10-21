// DragonBreak Online: world statistics for the launcher's Server Stats window. Loaded by gamemode.js on every hot reload.
//
// Every minute writes server-stats.json beside the server: players online, characters per race and the gold players
// hold, carried plus whatever sits in containers of the housing properties their profile owns, plus their bank balances,
// plus the gold the server holds for them until it is paid out (commission rewards, deposits, takings, refunds owed).
// The backend (routes/metrics.js) serves it as /api/metrics `world`.
//
// The same minute also writes staff-stats.json beside it: how many characters are vampires, werewolves, fever carriers,
// hold a staff beast power or belong to a vampire house or a pack (Jake, 21 Oct: "the total amount of Vampires,
// Werewolfs, ect"). Counts only, never a name or an id. It is a file of its own so that nothing public can pick it up:
// /api/metrics and the launcher's Server Stats read server-stats.json, and only the staff dashboard's sign-in-and-role
// route (routes/site-staff.js GET /api/site/staff/world) reads this one.
'use strict';

module.exports = (api) => {
  const fs = require('fs');
  const path = require('path');
  const { mp, log, every, onlineActors, profileOf, personal, registerChatCommand } = api;

  const OUT = path.resolve('server-stats.json');
  const GOLD = 0x0000000f;
  const HOUSING_OWNER_PROP = 'private.indexed.housingOwner';

  // Character ids are learned at login and kept in the stats file, so a restart does not probe every dynamic
  // form (getAllForms lists destroyed ids too, and each probe logs an engine error)
  const ST = globalThis.__dboWorldStats || (globalThis.__dboWorldStats = { chars: new Set(), seeded: false, peak: { day: '', online: 0 } });
  if (!ST.seeded) {
    ST.seeded = true;
    let prev = null; try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* first run */ }
    if (prev && Array.isArray(prev.ids)) { for (const id of prev.ids) ST.chars.add(Number(id) >>> 0); if (prev.peak) ST.peak = prev.peak; }
    else { try { for (const id of mp.getAllForms(0xff) || []) { const a = Number(id) >>> 0; if (profileOf(a) >= 0) ST.chars.add(a); } log('worldstats: first run, seeded from every dynamic form once'); } catch (e) { log('worldstats seed failed', e.message); } }
  }
  globalThis.__dboWorldStatsSeen = (a) => ST.chars.add(Number(a) >>> 0);

  const goldIn = (id) => {
    try {
      const inv = mp.get(id, 'inventory') || {};
      return (Array.isArray(inv.entries) ? inv.entries : []).reduce((n, e) => n + ((Number(e.baseId) >>> 0) === GOLD ? Math.max(0, Number(e.count) || 0) : 0), 0);
    } catch (e) { return 0; }
  };
  // A record lookup copies every subrecord (a RACE has 1,300-4,000), and race editor ids never change while the process runs
  // v2 (20 Oct, names without DBO): a new key so a hot reload drops the names the old code cached, and the offline rows with them
  const RACE_NAMES = globalThis.__dboRaceNamesV2 instanceof Map ? globalThis.__dboRaceNamesV2 : (globalThis.__dboRaceNamesV2 = new Map());
  if (globalThis.__dboRaceNames instanceof Map) { delete globalThis.__dboRaceNames; ST.offline = new Map(); }
  const raceName = (raceId) => {
    const id = Number(raceId) >>> 0;
    if (RACE_NAMES.has(id)) return RACE_NAMES.get(id);
    let name = 'Unknown';
    try {
      const rec = mp.lookupEspmRecordById(id); const edid = rec && rec.record && rec.record.editorId;
      // DragonBreak's own races drop their DBO prefix; the goblin colours count as one Goblin (Nate 20 Oct)
      if (edid) name = String(edid).replace(/Race(Vampire)?$/, '').replace(/^DBO/, '').replace(/^Goblin\w+$/, 'Goblin')
        .replace(/^HalfGiant$/, 'Half-Giant').replace(/([a-z])([A-Z])/g, '$1 $2');
    } catch (e) { /* unknown race */ }
    RACE_NAMES.set(id, name);
    return name;
  };
  // Every container of every property the profile owns, counted once per profile
  // bank.js keeps each character's balance on the character (private.bankGold)
  const bankedOf = (a) => { try { const v = Number(mp.get(a, 'private.bankGold')); return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0; } catch (e) { return 0; } };
  const storedGold = (profileId) => {
    let total = 0;
    try {
      for (const p of mp.findFormsByPropertyValue(HOUSING_OWNER_PROP, String(profileId)) || []) {
        const rec = mp.get(Number(p) >>> 0, 'private.housing') || {};
        const ids = new Set((Array.isArray(rec.containers) ? rec.containers : []).map((c) => Number(c) >>> 0));
        ids.add(Number(p) >>> 0);
        for (const c of ids) total += goldIn(c);
      }
    } catch (e) { /* no properties */ }
    return total;
  };

  // Gold that has left a player's purse but is still theirs, held by the server until it is paid out or comes back. Each
  // module keeps it in its own file (they save on every change, so the minute's snapshot is at most one save behind):
  //   commissions.json  a live commission's reward (open, taken, refused) and gold owed to someone offline
  //   tenancy.json      a tenant's deposit and gold owed
  //   businesses.json   an owner's takings, and takings held for a former owner
  //   charters.json     a pending charter's fee and gold owed (a refund, a disbanded faction's treasury)
  // Treasuries (bank.json) are left out: nobody may take gold out of one, so it is no longer a player's.
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.resolve(f), 'utf8')); } catch (e) { return null; } };
  const vals = (o) => (o && typeof o === 'object' ? Object.values(o) : []);
  const gold0 = (v) => { const g = Math.floor(Number(v) || 0); return g > 0 ? g : 0; };
  const heldGold = () => {
    const c = readJson('commissions.json') || {}, t = readJson('tenancy.json') || {};
    const b = readJson('businesses.json') || {}, ch = readJson('charters.json') || {};
    const LIVE = new Set(['open', 'taken', 'refused']);
    return [
      ...vals(c.list).filter((x) => x && LIVE.has(x.state)).map((x) => x.reward),
      ...vals(c.owed).map((x) => x && x.gold),
      ...vals(t.listings).map((x) => x && x.depositHeld),
      ...vals(t.owed).map((x) => x && x.gold),
      ...vals(b.businesses).map((x) => x && x.owed),
      ...vals(b.owedTo),
      ...vals(ch.charters).filter((x) => x && x.status === 'pending' && x.fee).map((x) => x.fee.held),
      ...vals(ch.owed),
    ].reduce((n, v) => n + gold0(v), 0);
  };

  // A played character: owned by a profile's slot list, creation finished, not perma-dead. Deleted ones are destroyed and drop out.
  const isCharacter = (a, profileId) => {
    try {
      if (!(profileId >= 0)) return false;
      const own = mp.getActorsByProfileId(profileId);
      if (!Array.isArray(own) || !own.map((x) => Number(x) >>> 0).includes(a)) return false;
      return mp.get(a, 'private.charCreatorPending') !== true && mp.get(a, 'private.permaDead') !== true;
    } catch (e) { return false; }
  };

  // ---- the staff dashboard's supernatural counts (staff-stats.json) -------------------------------------------------
  // Read from what the game already holds, in the same pass as the races: each character's digest rides on its row, so an
  // offline character's is reused for OFFLINE_MS like its gold. Online characters cost about five property reads a minute.
  // supernatural.js, bloodranks.js, greathunt.js and beastform.js load after this file, so a boot's first snapshot has no
  // curses to read: it writes no staff-stats.json and leaves every digest unread (undefined), and the next minute reads
  // them. A row cached by the code before this one has no digest either, so a hot reload reads them the same way.
  const STAFF_OUT = path.resolve('staff-stats.json');
  const hook = (name) => (typeof globalThis[name] === 'function' ? globalThis[name] : null);
  const superReady = () => !!hook('__dboSuperKind');
  const isTrue = (a, p) => { try { return mp.get(a, p) === true; } catch (e) { return false; } };
  const CURSES = new Set(['vampire', 'werewolf']);
  // The rank names as bloodranks.js and greathunt.js are configured, kept from the last view read (they never differ by
  // character); their defaults until one is read
  const RANKS = ST.rankNames || (ST.rankNames = {
    blood: ['Fledgling', 'Vampire', 'Nightstalker', 'Mistwalker', 'Master Vampire'],
    hunt: ['Fledgling', 'Prowler', 'Hunter', 'Blood-Howler', 'Elder'],
  });
  const rankFrom = (name, key, a) => {
    try {
      const view = hook(name) ? hook(name)(a) : null;
      if (!view || !Number.isInteger(view.rank)) return null;
      if (Array.isArray(view.ranks) && view.ranks.length) RANKS[key] = view.ranks.map((r) => String((r && r.name) || ''));
      return view.rank;
    } catch (e) { return null; }
  };
  // The thirst rate as supernatural.js's bloodRate reads it: 1 when bloodranks.js is not loaded or answers nonsense
  const thirstRate = (a) => { try { const f = hook('__dboBloodThirstRate'); const m = f ? Number(f(a)) : 1; return Number.isFinite(m) && m >= 0 ? m : 1; } catch (e) { return 1; } };
  // null for a character with nothing to count (most of them)
  const digestOf = (a, isOnline) => {
    let s = null; try { s = mp.get(a, 'private.supernatural') || null; } catch (e) { s = null; }
    const kind = s && CURSES.has(s.kind) ? s.kind : null;
    const fever = s && s.disease && CURSES.has(s.disease.kind) ? s.disease.kind : null;
    const wg = isTrue(a, 'private.werewolfGrant'), vg = isTrue(a, 'private.vampireLordGrant');
    // A beast form always reverts at death, logout and login (beastform.js), so only an online character is in one
    let form = null;
    if (isOnline) { try { const b = mp.get(a, 'private.beast'); form = b && (b.form === 'werewolf' || b.form === 'vampirelord') ? b.form : null; } catch (e) { form = null; } }
    if (!kind && !fever && !wg && !vg && !form) return null;
    const d = { kind, fever, wg, vg, form };
    if (kind === 'vampire') Object.assign(d, { pure: s.pure === true, unfed: !!s.unfed, lastFed: Number(s.lastFed) || 0, rate: thirstRate(a), rank: rankFrom('__dboBloodView', 'blood', a) });
    if (kind === 'werewolf') Object.assign(d, { blessed: s.blessed === true, rank: rankFrom('__dboHuntView', 'hunt', a) });
    return d;
  };
  // The vampire houses and the packs: every faction whose circle (guilds.js: guild-defs "requires", or Clan Volkihar's
  // lore) is a curse, in the defs' order, vampires first. The defs list is read once a load; a chartered faction counts
  // once it has a roster.
  let DEF_IDS = null;
  const houses = () => {
    const info = hook('__dboGuildInfo'); if (!info) return [];
    if (!DEF_IDS) { const d = readJson('guild-defs.json'); DEF_IDS = (d && Array.isArray(d.factions) ? d.factions : []).map((f) => String((f && f.id) || '')).filter(Boolean); }
    const G = globalThis.__dboGuildState;
    const out = [];
    for (const id of new Set([...DEF_IDS, ...Object.keys((G && G.members) || {})])) {
      let f = null; try { f = info(id); } catch (e) { f = null; }
      if (f && CURSES.has(f.circle) && f.kind !== 'band') out.push(f);
    }
    return out.filter((f) => f.circle === 'vampire').concat(out.filter((f) => f.circle === 'werewolf'));
  };
  const crownState = () => {
    try { const h = hook('__dboSuperCrownHolder'); if (h) return h() ? 'held' : 'unclaimed'; } catch (e) { /* the state below */ }
    const G = globalThis.__dboSuperState;
    return G && typeof G === 'object' ? (G.crown ? 'held' : 'unclaimed') : null;
  };
  // counted: actor -> { profileId, online, sup } for every character the public count holds
  const staffSummary = (counted, base) => {
    const tally = () => ({ total: 0, online: 0, accounts: new Set() });
    const add = (t, r) => { t.total++; if (r.online) t.online++; t.accounts.add(r.profileId); };
    const out = (t) => ({ total: t.total, online: t.online, accounts: t.accounts.size });
    const vamp = tally(), wolf = tally(), feverV = tally(), feverW = tally(), grantW = tally(), grantV = tally();
    const v = { pure: 0, unfed: 0, thirst: [0, 0, 0, 0], ranks: new Array(RANKS.blood.length).fill(0), lordForm: 0 };
    const w = { blessed: 0, inPack: 0, ranks: new Array(RANKS.hunt.length).fill(0), beastForm: 0 };
    let day = null;
    // The thirst stage as supernatural.js's superSlow tick works it out, from the world clock: the stage it saves moves only
    // while its vampire is online, and thirst keeps climbing while they are away (the saved stage said 1 for most on 21 Oct)
    const today = () => { if (day === null) { try { day = globalThis.__dboClock ? Number(globalThis.__dboClock.gameDays()) : NaN; } catch (e) { day = NaN; } if (!Number.isFinite(day)) day = Date.now() / 86400000 * 6; } return day; };
    for (const r of counted.values()) {
      const d = r.sup; if (!d) continue;
      if (d.kind === 'vampire') {
        add(vamp, r);
        if (d.pure) v.pure++;
        if (d.unfed) v.unfed++;
        const t = today();
        const stage = Math.min(4, 1 + Math.floor(Math.max(0, t - (d.lastFed || t)) * d.rate));
        v.thirst[Math.max(1, stage) - 1]++;
        if (Number.isInteger(d.rank) && d.rank >= 0 && d.rank < v.ranks.length) v.ranks[d.rank]++;
      }
      if (d.kind === 'werewolf') {
        add(wolf, r);
        if (d.blessed) w.blessed++;
        if (Number.isInteger(d.rank) && d.rank >= 0 && d.rank < w.ranks.length) w.ranks[d.rank]++;
      }
      if (d.fever === 'vampire') add(feverV, r);
      if (d.fever === 'werewolf') add(feverW, r);
      if (d.wg) add(grantW, r);
      if (d.vg) add(grantV, r);
      if (d.form === 'vampirelord') v.lordForm++;
      if (d.form === 'werewolf') w.beastForm++;
    }
    const members = hook('__dboGuildMembers');
    const inPack = new Set();
    const rows = houses().map((f) => {
      let ids = []; try { ids = members ? members(f.id) || [] : []; } catch (e) { ids = []; }
      const h = { name: String(f.name || f.id), circle: f.circle, pack: f.kind === 'pack', members: 0, cursed: 0, online: 0 };
      for (const x of new Set(ids.map((i) => Number(i) >>> 0))) {
        const r = counted.get(x); if (!r) continue;
        h.members++;
        if (r.online) h.online++;
        if (r.sup && r.sup.kind === f.circle) { h.cursed++; if (h.pack) inPack.add(x); }
      }
      return h;
    });
    w.inPack = inPack.size;
    const named = (names, counts) => counts.map((count, i) => ({ name: names[i] || `Rank ${i + 1}`, count }));
    return {
      v: 1, updatedAt: base.updatedAt, characters: base.characters, accounts: base.players, online: base.online,
      vampire: Object.assign(out(vamp), { pure: v.pure, unfed: v.unfed, thirst: v.thirst, ranks: named(RANKS.blood, v.ranks), crown: crownState(), lordForm: v.lordForm }),
      werewolf: Object.assign(out(wolf), { blessed: w.blessed, inPack: w.inPack, lone: wolf.total - w.inPack, ranks: named(RANKS.hunt, w.ranks), beastForm: w.beastForm }),
      fever: { vampire: out(feverV), werewolf: out(feverW) },
      grant: { werewolf: out(grantW), vampireLord: out(grantV) },
      houses: rows,
    };
  };
  let staffSnap = null;

  const OFFLINE_MS = 10 * 60000;
  const snapshot = () => {
    const online = onlineActors();
    for (const a of online) ST.chars.add(a >>> 0);
    const races = new Map(); const profiles = new Set();
    let carried = 0, stored = 0, banked = 0;
    ST.counted = [];
    // An offline character does not change, so its numbers are reused for OFFLINE_MS: reading every character ever seen
    // each minute cost 30-70 ms on the main thread (ticks report, 9 Oct). Online characters and their owners are fresh.
    if (!(ST.offline instanceof Map)) ST.offline = new Map();
    const now = Date.now();
    const onlineSet = new Set(online.map((x) => x >>> 0));
    const onlineProfiles = new Set(online.map((x) => profileOf(x)));
    const ready = superReady();
    const counted = new Map();
    for (const a of [...ST.chars]) {
      const hit = !onlineSet.has(a) && ST.offline.get(a);
      let row = hit && now - hit.at < OFFLINE_MS && !onlineProfiles.has(hit.profileId) ? hit : null;
      if (!row) {
        const profileId = profileOf(a);
        if (!isCharacter(a, profileId)) { ST.chars.delete(a); ST.offline.delete(a); continue; }
        let app = null; try { app = mp.get(a, 'appearance'); } catch (e) { ST.chars.delete(a); ST.offline.delete(a); continue; }
        const realRace = (globalThis.__dboBeastOriginalRace && globalThis.__dboBeastOriginalRace(a)) || (app && app.raceId);
        row = { at: now, profileId, race: realRace ? raceName(realRace) : 'Unknown', name: (app && app.name) || 'Stranger', carried: goldIn(a), banked: bankedOf(a), stored: null };
        if (!onlineSet.has(a)) ST.offline.set(a, row); else ST.offline.delete(a);
      }
      // The staff counts must never cost the public Server Stats its write: a digest that throws counts as nothing
      if (ready && row.sup === undefined) { try { row.sup = digestOf(a, onlineSet.has(a)); } catch (e) { row.sup = null; } }
      counted.set(a, { profileId: row.profileId, online: onlineSet.has(a), sup: row.sup || null });
      ST.counted.push(`${row.name} (${row.race})`);
      races.set(row.race, (races.get(row.race) || 0) + 1);
      carried += row.carried;
      banked += row.banked;
      if (!profiles.has(row.profileId)) {
        profiles.add(row.profileId);
        if (row.stored === null || onlineProfiles.has(row.profileId)) row.stored = storedGold(row.profileId);
        stored += row.stored;
      }
    }
    const held = heldGold();
    const day = new Date().toISOString().slice(0, 10);
    if (ST.peak.day !== day) ST.peak = { day, online: 0 };
    ST.peak.online = Math.max(ST.peak.online, online.length);
    const pub = {
      updatedAt: new Date().toISOString(),
      online: online.length, peakToday: ST.peak.online,
      characters: [...races.values()].reduce((n, c) => n + c, 0), players: profiles.size,
      // The launcher shows "carried" and "in storage": the bank is storage too (athny, #bugs "Very Minor", 2 Oct)
      // Held gold is storage too, so carried + stored is always the total the launcher shows
      gold: { total: carried + stored + banked + held, carried, stored: stored + banked + held, banked, held },
      ids: [...ST.chars], peak: ST.peak,
      clock: (() => { try { return globalThis.__dboClock ? globalThis.__dboClock.summary() : null; } catch (e) { return null; } })(),
      // A character never finished in the creator has no appearance and no race: counted above, not listed as a race
      races: [...races.entries()].filter(([race]) => race !== 'Unknown').map(([race, count]) => ({ race, count })).sort((x, y) => y.count - x.count || x.race.localeCompare(y.race)),
    };
    staffSnap = null;
    if (ready) { try { staffSnap = staffSummary(counted, pub); } catch (e) { log('worldstats: staff counts failed', e.message); } }
    return pub;
  };

  // Each write has its own temp file: a reload's first write, the minute timer and /stats can be in flight together,
  // and with one shared name the first rename took the file from under the others (ENOENT in the log, 2026-09-27).
  // One write is in flight at a time, and a snapshot taken meanwhile waits and goes next (only the newest waits): writes
  // in flight together landed in any order, and a slow older one renamed its snapshot over a newer one (online 0 after
  // online 1, in the harness, 2026-09-30). So the file only ever moves forward. The state lives on globalThis, so a hot
  // reload joins the write in flight instead of racing it; one that never answers frees the writer after a minute.
  // staff-stats.json has a writer of its own (its own state and temp names), so neither file waits on the other.
  const writerFor = (key, out) => {
    const W = globalThis[key] || (globalThis[key] = { seq: 0 });
    if (!('queued' in W)) Object.assign(W, { queued: null, writing: false, startedAt: 0 });
    const label = path.basename(out);
    const flush = () => {
      const s = W.queued; W.queued = null;
      if (!s) { W.writing = false; return; }
      W.writing = true; W.startedAt = Date.now();
      const tmp = `${out}.${++W.seq}.tmp`;
      fs.writeFile(tmp, JSON.stringify(s, null, 1), (e) => {
        if (e) { fs.unlink(tmp, () => {}); log(`${label} write failed`, e.message); return flush(); }
        fs.rename(tmp, out, (e2) => {
          if (e2) { fs.unlink(tmp, () => {}); log(`${label} rename failed`, e2.message); }
          flush();
        });
      });
    };
    return (s) => { W.queued = s; if (!W.writing || Date.now() - W.startedAt > 60000) flush(); };
  };
  const pushPublic = writerFor('__dboWorldStatsWrites', OUT);
  const pushStaff = writerFor('__dboStaffStatsWrites', STAFF_OUT);
  const write = () => {
    const s = snapshot();
    pushPublic(s);
    if (staffSnap) pushStaff(staffSnap);
    return s;
  };
  every('worldStats', 60000, write);
  const first = write();
  log(`worldstats on: ${first.characters} characters (${first.players} players), ${first.online} online, ${first.gold.total} gold held, ${first.races.length} races: ${ST.counted.join(', ')}`);

  registerChatCommand('stats', (a) => {
    const s = write();
    personal(a, `Server Stats counts ${s.characters} characters (${s.players} players): ${ST.counted.join(', ') || 'none'}. Gold held ${s.gold.total}.`);
  }, { admin: true, help: 'who the launcher Server Stats counts, refreshed now' });
};
