// worldstats.js's staff counts (Jake, 21 Oct: "the total amount of Vampires, Werewolfs, ect"): staff-stats.json beside
// server-stats.json, counts only, for the staff dashboard. Fake characters on fake hooks, no server and no game:
//   node tests/worldstats-supernatural-harness.js
// Checked: the totals, online now and accounts for vampires, werewolves, both fevers and the staff beast powers; the
// thirst stage worked out from the world clock (not the stage saved at the last online tick); blood and Hunt ranks;
// pure-bloods, the not-yet-fed, Hircine's blessed, Lone Wolves; beast forms counted online only; the Blood Crown as held
// or unclaimed; the houses and packs by member counts. Only the characters the public count holds: perma-dead, unfinished
// and deleted ones stay out. No name and no id in the file, nothing new in server-stats.json. A boot's first snapshot
// (the curse modules load after worldstats.js) writes no staff file, and rows cached at boot or by the code before this
// change get their digest the next minute; an offline character's digest is then reused like its gold.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const WORLDSTATS = path.resolve(__dirname, '..', 'worldstats.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worldstats-super-'));
process.chdir(dir);
let failures = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail !== undefined ? '   ' + detail : ''}`); if (!ok) failures++; };

// ---- the world ---------------------------------------------------------------------------------------------------
let now = Date.UTC(2026, 9, 21, 23, 0), day = 1000;
const realNow = Date.now; Date.now = () => now;
const ID = {}; let next = 0xff0a0001;
const props = new Map(), reads = new Map(), profiles = new Map(), owner = new Map();
const NAMES = [];
const char = (key, pid, name, p = {}, { slot = true } = {}) => {
  const a = next++; ID[key] = a; owner.set(a, pid); NAMES.push(name);
  if (slot) { if (!profiles.has(pid)) profiles.set(pid, []); profiles.get(pid).push(a); }
  props.set(`${a}|appearance`, { name, raceId: 0x13746 });
  for (const [k, v] of Object.entries(p)) props.set(`${a}|${k}`, v);
  return a;
};
const vamp = (o = {}) => ({ kind: 'vampire', stage: 1, lastFed: 0, pure: false, blessed: false, beastDay: -1, ...o });
const wolf = (o = {}) => ({ kind: 'werewolf', stage: 0, lastFed: 0, pure: false, blessed: false, beastDay: -1, ...o });
const S = 'private.supernatural', B = 'private.bloodRanks', H = 'private.greatHunt';
// Profile ids and names nobody would mistake for a count
const P1 = 7001, P2 = 7002, P3 = 7003, P4 = 7004, P5 = 7005, P6 = 7006;
char('V1', P1, 'Valerica Bloodmoon', { [S]: vamp({ pure: true, lastFed: 998 }), [B]: { blood: 1600 } });
char('V2', P1, 'Unfed Ulric', { [S]: vamp({ unfed: { played: 0.1 }, lastFed: 996 }), [B]: { blood: 0 } });
char('V3', P2, 'Saved Stage Sela', { [S]: vamp({ stage: 1, lastFed: 999.5 }), [B]: { blood: 50 }, 'private.beast': { form: 'vampirelord', original: { raceId: 0x13746 } } });
char('W1', P2, '<b>Elder Wolf</b>', { [S]: wolf({ blessed: true }), [H]: { renown: 1500 }, 'private.werewolfGrant': true });
char('W2', P3, 'Prowling Pell', { [S]: wolf(), [H]: { renown: 120 }, 'private.beast': { form: 'werewolf', original: { raceId: 0x13746 } } });
char('M1', P3, 'Feverish Fenna', { [S]: { kind: null, disease: { kind: 'vampire', played: 1.2, since: 990 } } });
char('M2', P4, 'Lupine Lars', { [S]: { kind: null, disease: { kind: 'werewolf', played: 2.5, since: 995 } } });
char('G1', P4, 'Granted Greta', { 'private.werewolfGrant': true, 'private.beast': { form: 'werewolf', original: { raceId: 0x13746 } } });
char('N1', P5, 'Plain Nils', {});
char('D1', P5, 'Perma Dead Dagny', { [S]: vamp({ pure: true }), 'private.permaDead': true });
char('U1', P5, 'Unfinished Una', { [S]: vamp(), 'private.charCreatorPending': true });
char('X1', P5, 'Deleted Xander', { [S]: vamp() }, { slot: false });
char('T1', P6, 'Thrall Tova', {});
char('V4', P6, 'Lordly Lucan', { [S]: vamp({ lastFed: 0 }), [B]: { blood: 150 }, 'private.vampireLordGrant': true, 'private.beast': { form: 'vampirelord', original: { raceId: 0x13746 } } });
const ALL = Object.values(ID);
let online = [ID.V1, ID.V4, ID.W2, ID.M1, ID.G1];

// The curse modules' hooks, as supernatural.js, bloodranks.js, greathunt.js and guilds.js set them
const BLOOD = ['Fledgling', 'Vampire', 'Nightstalker', 'Mistwalker', 'Master Vampire'];
const HUNT = ['Fledgling', 'Prowler', 'Hunter', 'Blood-Howler', 'Elder'];
const AT = [0, 100, 300, 700, 1500];
const rankFor = (n) => { let r = 0; AT.forEach((t, i) => { if (n >= t) r = i; }); return r; };
const get = (id, p) => { reads.set(`${id}|${p}`, (reads.get(`${id}|${p}`) || 0) + 1); return props.get(`${id}|${p}`); };
const DEFS = [
  { id: 'dawnguard', name: 'Dawnguard', kind: 'guild' },
  { id: 'clan-volkihar', name: 'Clan Volkihar', kind: 'guild', secret: true },
  { id: 'house-ravenwatch', name: 'House Ravenwatch', kind: 'guild', requires: 'vampire', secret: true },
  { id: 'pack-of-the-jerall', name: "Hircine's Pack of the Jerall", kind: 'pack', requires: 'werewolf', secret: true },
  { id: 'pack-of-falkreath', name: "Hircine's Pack of Falkreath", kind: 'pack', requires: 'werewolf', secret: true },
  { id: 'cult-hircine', name: "Hircine's Hunters", kind: 'cult', secret: true },
];
fs.writeFileSync('guild-defs.json', JSON.stringify({ roles: {}, templates: {}, factions: DEFS }));
const CIRCLES = { 'clan-volkihar': 'vampire' };
const members = {
  dawnguard: [ID.N1, ID.T1],
  'clan-volkihar': [ID.T1, ID.V1],                  // a thrall and a vampire: Volkihar takes both
  'house-ravenwatch': [ID.V4, ID.D1],               // the perma-dead member is not counted
  'pack-of-the-jerall': [ID.W1],
  'cult-hircine': [ID.W2],
};
let crownHolder = ID.V1;
const hooks = {
  __dboSuperKind: (a) => { const s = props.get(`${a}|${S}`); return (s && s.kind) || null; },
  __dboBloodView: (a) => { const s = get(a, B) || {}; return { name: 'The Blood', value: s.blood || 0, rank: rankFor(Number(s.blood) || 0), ranks: BLOOD.map((name, i) => ({ name, at: AT[i] })) }; },
  __dboBloodThirstRate: (a) => [1, 0.9, 0.8, 0.7, 0.6][rankFor(Number((get(a, B) || {}).blood) || 0)],
  __dboHuntView: (a) => { const s = get(a, H) || {}; return { name: 'The Great Hunt', value: s.renown || 0, rank: rankFor(Number(s.renown) || 0), ranks: HUNT.map((name, i) => ({ name, at: AT[i] })) }; },
  __dboSuperCrownHolder: () => crownHolder,
  __dboGuildInfo: (id) => { const f = DEFS.find((x) => x.id === id); return f ? { id: f.id, name: f.name, kind: f.kind, secret: !!f.secret, circle: CIRCLES[f.id] || f.requires || '' } : null; },
  __dboGuildMembers: (id) => (members[id] || []).slice(),
};
const install = () => { Object.assign(globalThis, hooks); globalThis.__dboGuildState = { members: Object.fromEntries(Object.entries(members).map(([k, v]) => [k, Object.fromEntries(v.map((a) => [String(a), { rank: 0 }]))])) }; };
const uninstall = () => { for (const k of [...Object.keys(hooks), '__dboGuildState', '__dboSuperState']) delete globalThis[k]; };
globalThis.__dboClock = { gameDays: () => day, summary: () => null };

const logs = [], commands = new Map();
let tick = null;
const load = () => {
  delete require.cache[require.resolve(WORLDSTATS)];
  require(WORLDSTATS)({
    mp: { get, getAllForms: () => [], getActorsByProfileId: (pid) => (profiles.get(pid) || []).slice() },
    log: (...a) => logs.push(a.join(' ')), every: (n, ms, f) => { if (n === 'worldStats') tick = f; }, onlineActors: () => online.slice(),
    profileOf: (a) => (owner.has(a >>> 0) ? owner.get(a >>> 0) : -1), nameOf: (a) => `P${a}`, personal: () => {}, registerChatCommand: (n, fn) => commands.set(n, fn),
  });
};
const W = () => [globalThis.__dboWorldStatsWrites, globalThis.__dboStaffStatsWrites].filter(Boolean);
const settle = async () => { for (let i = 0; i < 2000 && W().some((w) => w.writing || w.queued); i++) await new Promise((r) => setTimeout(r, 5)); };
const readFile = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } };
const minute = async () => { reads.clear(); now += 60000; const s = tick(); await settle(); return s; };
const supReads = (key) => reads.get(`${ID[key]}|${S}`) || 0;

(async () => {
  delete globalThis.__dboWorldStats; delete globalThis.__dboWorldStatsWrites; delete globalThis.__dboStaffStatsWrites;
  // ---- a boot: worldstats.js loads before the curse modules ---------------------------------------------------------
  uninstall();
  load();
  for (const a of ALL) globalThis.__dboWorldStatsSeen(a);   // as each logs in
  commands.get('stats')(ID.V1);   // a write before the curse modules have loaded
  await settle();
  check('a boot\'s first snapshot, before the curse modules load, writes server-stats.json', !!readFile('server-stats.json'));
  check('...and no staff-stats.json', readFile('staff-stats.json') === null);
  install();
  let pub = await minute();
  let text = readFile('staff-stats.json');
  let st = null; try { st = JSON.parse(text); } catch (e) { st = null; }
  check('the next minute, with the modules loaded, writes staff-stats.json', !!st, text);
  if (!st) { console.log(`${failures} failure(s)`); process.exit(1); }
  check('rows cached at boot without a digest are read for it once', supReads('V3') === 1 && supReads('W1') === 1 && supReads('N1') === 1, JSON.stringify({ V3: supReads('V3'), W1: supReads('W1'), N1: supReads('N1') }));

  // ---- the counts ---------------------------------------------------------------------------------------------------
  check('the footnote figures are the public ones: 11 characters on 6 accounts, 5 online', st.characters === 11 && st.accounts === 6 && st.online === 5 && pub.characters === 11 && pub.players === 6, JSON.stringify([st.characters, st.accounts, st.online]));
  const tot = (o) => o && [o.total, o.online, o.accounts].join('/');
  check('vampires: 4 characters, 2 online, 3 accounts (perma-dead, unfinished and deleted ones left out)', tot(st.vampire) === '4/2/3', tot(st.vampire));
  check('...1 pure-blood, 1 turned but not yet fed', st.vampire.pure === 1 && st.vampire.unfed === 1, JSON.stringify(st.vampire));
  check('...thirst from the clock: stage 1: 2, stage 2: 1, stage 3: 0, stage 4: 1', JSON.stringify(st.vampire.thirst) === '[2,1,0,1]', JSON.stringify(st.vampire.thirst));
  check('...blood ranks Fledgling 2, Vampire 1, Master Vampire 1', JSON.stringify(st.vampire.ranks) === JSON.stringify(BLOOD.map((name, i) => ({ name, count: [2, 1, 0, 0, 1][i] }))), JSON.stringify(st.vampire.ranks));
  check('...the Blood Crown is held, and in Vampire Lord form now: 1 (a saved form of someone offline is not counted)', st.vampire.crown === 'held' && st.vampire.lordForm === 1, JSON.stringify([st.vampire.crown, st.vampire.lordForm]));
  check('werewolves: 2 characters, 1 online, 2 accounts', tot(st.werewolf) === '2/1/2', tot(st.werewolf));
  check('...1 Hircine-blessed, 1 in a pack, 1 Lone Wolf (a cult is no pack)', st.werewolf.blessed === 1 && st.werewolf.inPack === 1 && st.werewolf.lone === 1, JSON.stringify(st.werewolf));
  check('...Hunt ranks Prowler 1, Elder 1', JSON.stringify(st.werewolf.ranks) === JSON.stringify(HUNT.map((name, i) => ({ name, count: [0, 1, 0, 0, 1][i] }))), JSON.stringify(st.werewolf.ranks));
  check('...in beast form now: 2 (a werewolf and a staff grant holder, both online)', st.werewolf.beastForm === 2, st.werewolf.beastForm);
  check('fevers apart from the curses: Sanguinare 1 (online), Sanies Lupinus 1', tot(st.fever.vampire) === '1/1/1' && tot(st.fever.werewolf) === '1/0/1', JSON.stringify(st.fever));
  check('staff beast powers apart: Beast Form 2 (one also a werewolf), Vampire Lord 1', tot(st.grant.werewolf) === '2/1/2' && tot(st.grant.vampireLord) === '1/1/1', JSON.stringify(st.grant));
  const house = (name) => (st.houses || []).find((h) => h.name === name);
  check('houses and packs: the curse circles only, vampires first, in the defs order', JSON.stringify((st.houses || []).map((h) => h.name)) === JSON.stringify(['Clan Volkihar', 'House Ravenwatch', "Hircine's Pack of the Jerall", "Hircine's Pack of Falkreath"]), JSON.stringify((st.houses || []).map((h) => h.name)));
  check('...Clan Volkihar: 2 members, 1 a vampire, 1 online (its thrall counts as a member)', JSON.stringify(house('Clan Volkihar')) === JSON.stringify({ name: 'Clan Volkihar', circle: 'vampire', pack: false, members: 2, cursed: 1, online: 1 }), JSON.stringify(house('Clan Volkihar')));
  check('...House Ravenwatch: its perma-dead member is not counted', house('House Ravenwatch') && house('House Ravenwatch').members === 1 && house('House Ravenwatch').cursed === 1, JSON.stringify(house('House Ravenwatch')));
  check('...the packs: Jerall 1 werewolf, Falkreath empty', house("Hircine's Pack of the Jerall").cursed === 1 && house("Hircine's Pack of Falkreath").members === 0, JSON.stringify(st.houses));

  // ---- privacy --------------------------------------------------------------------------------------------------------
  const leaks = [...NAMES, 'Bloodmoon', 'Elder Wolf', ...ALL.map(String), ...ALL.map((a) => a.toString(16)), ...[P1, P2, P3, P4, P5, P6].map(String)].filter((x) => text.includes(x));
  check('no name, actor id (decimal or hex) or profile id in staff-stats.json', leaks.length === 0, leaks.join(', '));
  check('...and no holder of the crown, only held or unclaimed', !/holder|since/.test(text));
  const pubText = readFile('server-stats.json');
  const keys = Object.keys(JSON.parse(pubText)).sort().join(',');
  check('server-stats.json, which /api/metrics and the launcher read, gains nothing', keys === 'characters,clock,gold,ids,online,peak,peakToday,players,races,updatedAt' && !/vampire|werewolf|fever|grant|houses/i.test(pubText), keys);

  // ---- the next minutes: offline digests reused, thirst still climbing ------------------------------------------------
  day += 1.5;
  await minute();
  st = JSON.parse(readFile('staff-stats.json'));
  check('an offline character\'s digest is reused (no read of its curse)', supReads('V3') === 0 && supReads('W1') === 0, JSON.stringify({ V3: supReads('V3'), W1: supReads('W1') }));
  check('...an online one is read every minute', supReads('V1') === 1 && supReads('W2') === 1, JSON.stringify({ V1: supReads('V1'), W2: supReads('W2') }));
  check('...and its thirst still climbs with the clock: stage 1: 1, stage 3: 2, stage 4: 1 (Sela saved stage 1, is at 3)', JSON.stringify(st.vampire.thirst) === '[1,0,2,1]', JSON.stringify(st.vampire.thirst));

  // An online vampire feeds; a werewolf leaves beast form and logs out; the crown falls vacant
  props.set(`${ID.V1}|${S}`, vamp({ pure: true, lastFed: day }));
  props.set(`${ID.W2}|private.beast`, null);
  online = online.filter((a) => a !== ID.W2);
  crownHolder = 0;
  await minute();
  st = JSON.parse(readFile('staff-stats.json'));
  check('an online vampire who fed is at stage 1 the next minute', JSON.stringify(st.vampire.thirst) === '[2,0,1,1]', JSON.stringify(st.vampire.thirst));
  check('a werewolf who logged out: online 0, beast form 1 (the grant holder)', st.werewolf.online === 0 && st.werewolf.beastForm === 1, JSON.stringify(st.werewolf));
  check('a vacant crown reads unclaimed', st.vampire.crown === 'unclaimed', st.vampire.crown);

  // ---- a hot reload over rows the code before this change cached (no digest on them) ---------------------------------
  for (const row of globalThis.__dboWorldStats.offline.values()) delete row.sup;
  load();
  await settle();
  st = JSON.parse(readFile('staff-stats.json'));
  check('a hot reload over rows with no digest still counts every offline curse', tot(st.vampire) === '4/2/3' && tot(st.werewolf) === '2/0/2' && st.werewolf.blessed === 1, JSON.stringify([tot(st.vampire), tot(st.werewolf)]));

  // ---- a hook that throws costs its own figure, never the public stats or the file ----------------------------------
  globalThis.__dboGuildMembers = () => { throw new Error('boom'); };
  globalThis.__dboBloodView = () => { throw new Error('boom'); };
  props.set(`${ID.V1}|${S}`, vamp({ pure: true, lastFed: day }));
  const before = readFile('staff-stats.json');
  pub = await minute();
  st = JSON.parse(readFile('staff-stats.json'));
  check('a throwing hook: the public stats and the staff file are still written', pub.characters === 11 && readFile('staff-stats.json') !== before && tot(st.vampire) === '4/2/3', tot(st.vampire));
  check('...the houses count 0 members; the vampires read this minute have no rank, the cached one keeps its', st.houses.every((h) => h.members === 0) && st.vampire.ranks.reduce((n, r) => n + r.count, 0) === 1, JSON.stringify(st.vampire.ranks));
  install();

  // ---- without supernatural.js nothing is written, and an older staff file is left as it was ---------------------------
  uninstall();
  const last = readFile('staff-stats.json');
  await minute();
  check('with supernatural.js not loaded no staff file is written (the backend marks the old one stale)', readFile('staff-stats.json') === last);
  install();

  // ---- the writes ----------------------------------------------------------------------------------------------------
  for (let i = 0; i < 3; i++) commands.get('stats')(ID.V1);
  await settle();
  const failed = logs.filter((l) => /(server|staff)-stats\.json (write|rename) failed/.test(l));
  check('writes in flight together all land, for both files', failed.length === 0, failed.join(' | '));
  check('the staff writer is its own: its own state on globalThis', !!globalThis.__dboStaffStatsWrites && globalThis.__dboStaffStatsWrites !== globalThis.__dboWorldStatsWrites);
  const left = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  check('no temp file is left behind', left.length === 0, left.join(', '));
  check('/stats still answers from the public figures', JSON.parse(readFile('server-stats.json')).characters === 11);

  Date.now = realNow;
  console.log(failures ? `${failures} failure(s)` : 'all passed');
  process.exit(failures ? 1 : 0);
})();
