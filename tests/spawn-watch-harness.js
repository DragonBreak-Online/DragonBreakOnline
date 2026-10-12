// "Losing gear" (#bugs, hi josue, 11 Oct; tracker 1558656800041996288): a character woke in Riverwood's Sleeping Giant Inn,
// and after a relog the gear was "all gone". The server log replayed here is Roland Ebonshield #CEWQ (ff002a82), 10 Oct:
//   21:10:06.559 Loading character ff002a82; 21:10:11.790 the game loaded in cell 133c6 (the inn), 21:10:48 Riverwood (3c),
//   21:17-21:18 Dragonsreach; the server kept him at a764b:BSHeartland.esm 59359,202644,7486 throughout (/unstuck at 21:16:40
//   moved nothing on his screen). 21:10:13.606 first equipment report; 21:11:31-33 he put on the Imperial light set there;
//   21:20:35 relog, 21:20:47 re-dressed with the Riverwood set instead of his TH_Plate0Cuirass and steel plate.
// Part 1 runs spawnwatch.js against a stub mp on that timeline; part 2 lifts gamemode.js's real equipment hook, redress,
// login seeding and favourites handler and checks that a game which never showed arriving cannot overwrite the outfit or
// the favourites, and that the next login dresses the character in what they wore before Riverwood. It also replays Barush
// Highhammer #C9TM's slow load (11 Oct 18:56, 171 s to a live game): a game still loading is never moved or told to restart.
// Item ids are stand-ins (the names are the log's); the world id is BSHeartland's.
//   node tests/spawn-watch-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fail++; };

// ---- a clock and timers that only move when told ----
let now = Date.UTC(2026, 9, 10, 21, 10, 6, 559);
const realNow = Date.now;
Date.now = () => now;
let timers = [];
const later = (fn, ms) => { timers.push({ at: now + ms, fn }); };
const advanceTo = (t) => {
  for (;;) {
    timers.sort((x, y) => x.at - y.at);
    const next = timers[0];
    if (!next || next.at > t) break;
    timers.shift();
    now = next.at;
    next.fn();
  }
  now = t;
};
const at = (hh, mm, ss, ms = 0) => Date.UTC(2026, 9, 10, hh, mm, ss, ms);

// ---- the world as the server holds it ----
const ROLAND = 0xff002a82, PAX = 0xff000e0b, NEWBIE = 0xff004572, QUITTER = 0xff0022a3, BARUSH = 0xff00043c;
const BSHEARTLAND = 'a764b:BSHeartland.esm', BSHEARTLAND_ID = 0x080a764b, INN = 0x000133c6;
const TH_PLATE_CUIRASS = 0x2a000d62, STEEL_HELMET = 0x0001395d, STEEL_GAUNTLETS = 0x0001395c, STEEL_BOOTS = 0x0001395b;
const IMP_SWORD = 0x000c3dfb, IMP_CUIRASS = 0x00013ed9, IMP_GAUNTLETS = 0x00013eda, IMP_BOOTS = 0x00013ed8, IMP_HELMET = 0x00013edb, IMP_SHIELD = 0x00013ab2;
const REAL_OUTFIT = [TH_PLATE_CUIRASS, STEEL_HELMET, STEEL_GAUNTLETS, STEEL_BOOTS, IMP_SWORD];
const INN_OUTFIT = [IMP_CUIRASS, IMP_GAUNTLETS, IMP_BOOTS, IMP_HELMET, IMP_SHIELD, IMP_SWORD];
const ALL = [...new Set([...REAL_OUTFIT, ...INN_OUTFIT])];

const props = new Map(), equips = [], teleports = [], told = [], logs = [];
const online = new Set();
const mp = {
  get: (id, k) => props.get(`${id >>> 0}|${k}`),
  set: (id, k, v) => { props.set(`${id >>> 0}|${k}`, v); if (k === 'locationalData') teleports.push([id >>> 0, v]); },
  getUserByActor: (id) => (online.has(id >>> 0) ? 7 : 65535),
  getDescFromId: (id) => (id >>> 0).toString(16),
  getIdFromDesc: (d) => (String(d) === BSHEARTLAND ? BSHEARTLAND_ID : 0),
  callPapyrusFunction: (kind, cls, fn, self, args) => { if (fn === 'EquipItem') equips.push(parseInt(args[0].desc, 16)); },
};
const log = (...a) => logs.push(a.join(' '));
const display = (a) => ({ [ROLAND]: 'Roland Ebonshield #CEWQ', [PAX]: 'Pax #ZUAY', [NEWBIE]: 'Stranger #4572', [QUITTER]: 'Raven #VYKW', [BARUSH]: 'Barush Highhammer #C9TM' }[a >>> 0] || (a >>> 0).toString(16));
const userOf = (a) => (online.has(a >>> 0) ? 7 : -1);
const creating = new Set();
const worldIdOf = (desc) => { try { return mp.getIdFromDesc(String(desc)) >>> 0; } catch (e) { return 0; } };
const place = (a) => { mp.set(a, 'worldOrCellDesc', BSHEARTLAND); mp.set(a, 'pos', [59359.2, 202644.1, 7486.3]); props.set(`${a}|locationalData`, { cellOrWorldDesc: BSHEARTLAND, pos: [59359.2, 202644.1, 7486.3], rot: [0, 0, 90] }); };
const inv = (ids) => ({ entries: ids.map((baseId) => ({ baseId, count: 1 })) });
const report = (worn) => ({ inv: { entries: ALL.map((baseId) => ({ baseId, count: 1, worn: worn.includes(baseId) })) }, numChanges: 1 });

// ---- spawnwatch.js, if this line has it ----
const SW_PATH = path.resolve(__dirname, '..', 'spawnwatch.js');
let makeWatch = null;
try { makeWatch = require(SW_PATH); } catch (e) { console.log(`(spawnwatch.js not loadable here: ${e.code || e.message})`); }
const newWatch = (cfg) => {
  if (!makeWatch) return null;
  timers = [];   // each case starts with no checks pending from the one before
  delete globalThis.__dboSpawnWatchState; delete globalThis.__dboSpawnWatchSeq;
  return makeWatch({ mp, log, personal: (a, t) => told.push([a >>> 0, t]), display, userOf, creationPending: (a) => creating.has(a >>> 0), worldIdOf, cfg: cfg || {}, setTimeout: later });
};

// ---- the gamemode.js code the watch is wired into ----
const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const cut = (from, to) => { const i = src.indexOf(from); const j = src.indexOf(to, i); if (i < 0 || j < 0) throw new Error(`gamemode.js: ${from} not found`); return src.slice(i, j + to.length); };
const redressSrc = cut('const redress = (a) => {', '\n};\n');
const equipSrc = cut('const wornOf = (equipment) =>', '\nequipHook.__dbo = true;').replace(/\nequipHook\.__dbo = true;$/, '');
const seedSrc = cut('  // Seed the remembered outfit from the save', '/* nothing saved */ }');
const favSrc = cut("onUi('favorites', (a, args) => {", '\n});\n');
const arrivedSrc = cut("onUi('arrived', (a, args) => {", '\n});\n');
const G = {};
const gm = new Function('globalThis', 'mp', 'log', 'display', 'recordOf', 'cfg', 'armourSwap', 'creationPending', 'setTimeout', 'onUi', 'cleanFavorites',
  `${equipSrc}\n${redressSrc}\nconst seed = (a) => {\n${seedSrc}\n};\n${favSrc}\nreturn { equipHook, connectedAt, seed };`);
const uiHandlers = new Map();
const H = gm(G, mp, log, display, () => null, {}, null, (a) => creating.has(a >>> 0), later, (ev, fn) => uiHandlers.set(ev, fn),
  (list) => (Array.isArray(list) ? list : []).map((f) => ({ id: Number(f && f.id) >>> 0, hotkey: -1 })).filter((f) => f.id > 0));
// gamemode.js onCharacterReady: the connect stamp, then the outfit seeding (which arms the watch on the fixed line)
const characterReady = (a) => { H.connectedAt.set(a, now); H.seed(a); };
const lastWorn = (a) => (mp.get(a, 'private.lastWorn') || []).map((w) => w[0]);
const same = (x, y) => JSON.stringify([...x].sort()) === JSON.stringify([...y].sort());
const arrive = (a, world) => { if (G.__dboSpawnWatch) G.__dboSpawnWatch.arrived(a, world); };

// =====================================================================================================================
// Part 1: Roland, 10 Oct 21:10, the game that woke in the inn
// =====================================================================================================================
G.__dboSpawnWatch = newWatch();
ok(!!G.__dboSpawnWatch, 'spawnwatch.js loads and builds a watch');
place(ROLAND);
online.add(ROLAND);
mp.set(ROLAND, 'inventory', inv(ALL));
// What he wore when he last left (10 Oct 04:52-04:54), remembered then
mp.set(ROLAND, 'private.lastWorn', REAL_OUTFIT.map((b) => [b, 0]));
mp.set(ROLAND, 'equipment', report(REAL_OUTFIT));
characterReady(ROLAND);                                                    // 21:10:06.559 Loading character ff002a82
ok(G.__dboSpawnWatch ? G.__dboSpawnWatch.holding(ROLAND) : false, 'a login is held until its game shows arriving');
ok(mp.get(ROLAND, 'private.spawnUnconfirmed') === true, 'and that is written on the character, so it outlives a logout');

advanceTo(at(21, 10, 13, 606));                                            // the game loaded in the inn, first report: naked
mp.set(ROLAND, 'equipment', report([]));
H.equipHook(ROLAND, report([]), true);
advanceTo(at(21, 10, 14, 246));                                            // the re-dress lands (Skyrim.esm pieces only)
const innLogin = [STEEL_HELMET, STEEL_GAUNTLETS, STEEL_BOOTS, IMP_SWORD];
mp.set(ROLAND, 'equipment', report(innLogin));
H.equipHook(ROLAND, report(innLogin), true);
// no 'arrived' ever comes: his game cannot find a764b:BSHeartland.esm
advanceTo(at(21, 10, 43, 606) + 1);
ok(teleports.length === 1 && teleports[0][0] === ROLAND && teleports[0][1].cellOrWorldDesc === BSHEARTLAND,
  '30 s after his game loaded with no arrival, his position is sent to the game again', teleports.map((t) => t[1].cellOrWorldDesc));
ok(logs.some((l) => /spawn watch: Roland Ebonshield #CEWQ has not shown arriving at a764b:BSHeartland\.esm 59359,202644,7486; sending the position again/.test(l)),
  'and the log says where the server holds him', logs.filter((l) => /spawn/i.test(l)));
ok(told.length === 0, 'nobody is told anything yet');
advanceTo(at(21, 11, 13, 606) + 1);
ok(logs.some((l) => /^SPAWN MISS Roland Ebonshield #CEWQ: the game never showed arriving at a764b:BSHeartland\.esm 59359,202644,7486/.test(l)),
  'still nothing 30 s later: one SPAWN MISS line', logs.filter((l) => /SPAWN/.test(l)));
ok(told.length === 1 && told[0][0] === ROLAND && /Sleeping Giant Inn in Riverwood/.test(told[0][1]) && /nothing you pick up, wear or do there is saved/.test(told[0][1]),
  'and the player is told, once, that Riverwood is not the shared world and to restart from the launcher', told.map((t) => t[1]));
// 21:11:31-33: he swaps into the Imperial light set in Riverwood (reports well after the login burst)
for (const [s, ms] of [[31, 986], [32, 371], [32, 697], [33, 35], [33, 346]]) {
  advanceTo(at(21, 11, s, ms));
  mp.set(ROLAND, 'equipment', report(INN_OUTFIT));
  H.equipHook(ROLAND, report(INN_OUTFIT), true);
}
ok(same(lastWorn(ROLAND), REAL_OUTFIT), 'the outfit he put on in Riverwood does not replace the one he wore before', lastWorn(ROLAND).map((x) => x.toString(16)));
// 21:15-21:18 nothing else changes; the stage-2 message is not repeated
advanceTo(at(21, 19, 40, 836));
ok(told.length === 1 && teleports.length === 1, 'no repeats while he stays there', [told.length, teleports.length]);
// 21:20:29 a new connection (the game restarted); the engine still stores the Riverwood outfit as his equipment
online.delete(ROLAND); online.add(ROLAND);
advanceTo(at(21, 20, 35, 370));
logs.length = 0;
characterReady(ROLAND);
ok(same(lastWorn(ROLAND), REAL_OUTFIT), 'the next login does not take the outfit from what the Riverwood game left stored', lastWorn(ROLAND).map((x) => x.toString(16)));
ok(logs.some((l) => /last session never showed arriving/.test(l)), 'and says why', logs);
// 21:20:46.862 the first report is naked and the re-dress runs (this time the game is in Cyrodiil)
advanceTo(at(21, 20, 46, 862));
mp.set(ROLAND, 'equipment', report([]));
equips.length = 0;
H.equipHook(ROLAND, report([]), true);
advanceTo(at(21, 20, 47, 113));
ok(same(equips, REAL_OUTFIT), 'the re-dress puts back TH_Plate0Cuirass and the steel plate, not the Riverwood set', equips.map((x) => x.toString(16)));
arrive(ROLAND, BSHEARTLAND_ID);                                            // his game reports arriving
ok(G.__dboSpawnWatch ? !G.__dboSpawnWatch.holding(ROLAND) && mp.get(ROLAND, 'private.spawnUnconfirmed') === false : false,
  'an arrival in the world the server holds him in ends the hold and clears the flag');
advanceTo(at(21, 25, 35, 845));
mp.set(ROLAND, 'equipment', report(INN_OUTFIT));
H.equipHook(ROLAND, report(INN_OUTFIT), true);
ok(same(lastWorn(ROLAND), INN_OUTFIT), 'from then on a change of clothes is remembered as before', lastWorn(ROLAND).map((x) => x.toString(16)));
advanceTo(at(21, 23, 0) + 600000);
ok(told.length === 1 && teleports.length === 1, 'a confirmed login is never re-sent or warned', [told.length, teleports.length]);

// =====================================================================================================================
// Shyra Veyne #AUD4, 9 Oct: left at 03:36 in [ArmorSteelBootsA, TH_Steel3CuirassA, CYRArmorNibeneseSteelGauntlets,
// BSKGoblinStaffSparks, IARedguardKnightCape]; 03:40:05 JOIN, 03:40:08 the inn, 03:40:10 "re-dressed with 5 item(s)" and only
// ArmorSteelBootsA went on (her game could not see the plugin pieces); 03:41:09 Riverwood; 03:42:34 relog, "re-dressed with
// 1 item(s)": the login took her outfit from the boots-only equipment the inn game left stored. She put the rest back by hand.
// =====================================================================================================================
G.__dboSpawnWatch = newWatch(); teleports.length = 0; told.length = 0; logs.length = 0;
const SHYRA = 0xff0017a1, BOOTS_A = 0x0001394d, TH_STEEL3 = 0x2a00a3c1, NIB_GAUNTLETS = 0x0812f0a2, GOBLIN_STAFF = 0x2b0045d0, RG_CAPE = 0x3100c8d4;
const SHYRA_OUTFIT = [BOOTS_A, TH_STEEL3, NIB_GAUNTLETS, GOBLIN_STAFF, RG_CAPE];
const shyraReport = (worn) => ({ inv: { entries: SHYRA_OUTFIT.map((baseId) => ({ baseId, count: 1, worn: worn.includes(baseId) })) }, numChanges: 1 });
place(SHYRA); online.add(SHYRA); mp.set(SHYRA, 'inventory', inv(SHYRA_OUTFIT));
mp.set(SHYRA, 'private.lastWorn', SHYRA_OUTFIT.map((b) => [b, 0]));
mp.set(SHYRA, 'equipment', shyraReport(SHYRA_OUTFIT));
now = Date.UTC(2026, 9, 9, 3, 39, 57, 0);
characterReady(SHYRA);
now = Date.UTC(2026, 9, 9, 3, 40, 10, 319); mp.set(SHYRA, 'equipment', shyraReport([])); H.equipHook(SHYRA, shyraReport([]), true);
now = Date.UTC(2026, 9, 9, 3, 40, 10, 535); mp.set(SHYRA, 'equipment', shyraReport([])); H.equipHook(SHYRA, shyraReport([]), true);
now = Date.UTC(2026, 9, 9, 3, 40, 11, 85); mp.set(SHYRA, 'equipment', shyraReport([BOOTS_A])); H.equipHook(SHYRA, shyraReport([BOOTS_A]), true);
// 03:41:09 she walks out into Riverwood; 03:42:34 she logs in again (her new game finds Cyrodiil)
online.delete(SHYRA); timers = []; online.add(SHYRA);
now = Date.UTC(2026, 9, 9, 3, 42, 34, 696);
characterReady(SHYRA);
now = Date.UTC(2026, 9, 9, 3, 42, 46, 361); mp.set(SHYRA, 'equipment', shyraReport([])); equips.length = 0; H.equipHook(SHYRA, shyraReport([]), true);
advanceTo(now + 300);
ok(same(equips, SHYRA_OUTFIT), 'Shyra comes back from the inn dressed in all five pieces, not the boots alone', equips.map((x) => x.toString(16)));

// =====================================================================================================================
// Part 2: the other ways a login goes
// =====================================================================================================================
// A normal login: the arrival comes a second after the load; nothing is sent, nothing is said, nothing is held
G.__dboSpawnWatch = newWatch(); teleports.length = 0; told.length = 0; logs.length = 0;
place(PAX); online.add(PAX); mp.set(PAX, 'inventory', inv(ALL));
characterReady(PAX);
advanceTo(now + 7000); mp.set(PAX, 'equipment', report([])); H.equipHook(PAX, report([]), true);
advanceTo(now + 900); arrive(PAX, BSHEARTLAND_ID);
advanceTo(now + 300000);
ok(teleports.length === 0 && told.length === 0 && !logs.some((l) => /spawn watch|SPAWN MISS/.test(l)), 'a login that arrives is left alone', logs);
ok(mp.get(PAX, 'private.spawnUnconfirmed') === false, 'and its flag is cleared');

// A report for an older place does not count; the current one does
G.__dboSpawnWatch = newWatch(); teleports.length = 0; told.length = 0;
characterReady(PAX);
arrive(PAX, INN);
ok(G.__dboSpawnWatch ? G.__dboSpawnWatch.holding(PAX) : false, 'an arrival somewhere other than where the server holds them does not count');
arrive(PAX, BSHEARTLAND_ID);
ok(G.__dboSpawnWatch ? !G.__dboSpawnWatch.holding(PAX) : false, 'the current world does');

// A missed spawn whose teleports still work (Stranger #6HNU, 11 Oct 09:12: the landing teleport arrived 11 s later)
G.__dboSpawnWatch = newWatch(); teleports.length = 0; told.length = 0; logs.length = 0;
place(NEWBIE); online.add(NEWBIE); mp.set(NEWBIE, 'inventory', inv(ALL));
characterReady(NEWBIE);
advanceTo(now + 9000); H.equipHook(NEWBIE, report([]), true);
advanceTo(now + 30001);
ok(teleports.length === 1, 'a missed spawn gets its position sent again', teleports.length);
advanceTo(now + 11000); arrive(NEWBIE, BSHEARTLAND_ID);
advanceTo(now + 60000);
ok(told.length === 0 && logs.some((l) => /Stranger #4572 arrived once the position was sent again/.test(l)), 'and once that lands, the player is never warned', logs);

// No equipment report at all: the game has not finished loading, so it cannot have arrived yet. Nothing is sent and
// nobody is told, however long it takes; the login stays held. Once the game does report, the usual check follows.
const spawnLines = () => logs.filter((l) => /SPAWN MISS|sending the position/.test(l));
G.__dboSpawnWatch = newWatch(); teleports.length = 0; told.length = 0; logs.length = 0;
characterReady(NEWBIE);
advanceTo(now + 300000);
ok(teleports.length === 0 && told.length === 0 && spawnLines().length === 0,
  'with no equipment report, no position is sent and nobody is told, even 300 s after the login', [teleports.length, told.length, spawnLines()]);
ok(G.__dboSpawnWatch ? G.__dboSpawnWatch.holding(NEWBIE) : false, 'and the login is still held');
H.equipHook(NEWBIE, report([]), true);                                     // the game loads at last, but never arrives
advanceTo(now + 30001);
ok(teleports.length === 1 && told.length === 0, 'when that game does report, its position is sent again 30 s later', [teleports.length, told.length]);
advanceTo(now + 30000);
ok(told.length === 1 && spawnLines().some((l) => /^SPAWN MISS Stranger #4572/.test(l)), 'and 30 s after that it gets the SPAWN MISS line and the word', [told.length, spawnLines()]);

// Barush Highhammer #C9TM (ff00043c), 11 Oct, from /var/log/skymp-server.log: a slow load, not a missed spawn.
//   18:56:21.590 Loading character ff00043c; npcGround held him at a764b:BSHeartland.esm 57395,202250,7875 while it loaded;
//   18:59:13.708 the game's first live input sample (t=171440: 171 s after the login began);
//   18:59:20.840 first equipment report; 18:59:23.439 the naked report; 18:59:23.690 "re-dressed with 7 item(s) after login".
// The client's 'arrived' report is not logged; it follows the game going live within a poll or two (here 18:59:14.500).
// With the 120 s login fallback unconditional, 18:58:21.6 sent him a teleport mid-load and 18:58:51.6 wrote SPAWN MISS and
// told him to restart his game, before it could possibly have arrived.
const at11 = (hh, mm, ss, ms = 0) => Date.UTC(2026, 9, 11, hh, mm, ss, ms);
G.__dboSpawnWatch = newWatch(); teleports.length = 0; told.length = 0; logs.length = 0;
mp.set(BARUSH, 'worldOrCellDesc', BSHEARTLAND); mp.set(BARUSH, 'pos', [57395.4, 202250.2, 7875.1]);
props.set(`${BARUSH}|locationalData`, { cellOrWorldDesc: BSHEARTLAND, pos: [57395.4, 202250.2, 7875.1], rot: [0, 0, 0] });
online.add(BARUSH); mp.set(BARUSH, 'inventory', inv(ALL)); mp.set(BARUSH, 'private.lastWorn', REAL_OUTFIT.map((b) => [b, 0]));
now = at11(18, 56, 21, 590);
characterReady(BARUSH);                                                    // 18:56:21.590 Loading character ff00043c
advanceTo(at11(18, 59, 13, 708));                                          // the game is live
ok(teleports.length === 0 && told.length === 0 && spawnLines().length === 0,
  "Barush's game, still loading 171 s after the login, is neither moved nor told to restart", [teleports.length, told.map((t) => t[1].slice(0, 40)), spawnLines()]);
advanceTo(at11(18, 59, 14, 500)); arrive(BARUSH, BSHEARTLAND_ID);
advanceTo(at11(18, 59, 20, 840)); mp.set(BARUSH, 'equipment', report(REAL_OUTFIT)); H.equipHook(BARUSH, report(REAL_OUTFIT), true);
advanceTo(at11(18, 59, 23, 439)); mp.set(BARUSH, 'equipment', report([])); H.equipHook(BARUSH, report([]), true);
advanceTo(at11(19, 5, 0));
ok(teleports.length === 0 && told.length === 0 && spawnLines().length === 0 && (G.__dboSpawnWatch ? !G.__dboSpawnWatch.holding(BARUSH) : false)
  && mp.get(BARUSH, 'private.spawnUnconfirmed') === false,
  'and once it loads and arrives the hold ends with nothing ever sent or said', [teleports.length, told.length, spawnLines()]);

// A new character: the creation flow has its own arrival steps
G.__dboSpawnWatch = newWatch(); teleports.length = 0; told.length = 0;
creating.add(NEWBIE); mp.set(NEWBIE, 'private.spawnUnconfirmed', false);
characterReady(NEWBIE);
advanceTo(now + 300000);
ok(G.__dboSpawnWatch ? !G.__dboSpawnWatch.holding(NEWBIE) && teleports.length === 0 : false, 'a character in creation is not watched');
creating.delete(NEWBIE);

// Logged out before the check: nothing is sent to nobody, and the flag decides the next login
G.__dboSpawnWatch = newWatch(); teleports.length = 0; told.length = 0;
place(QUITTER); online.add(QUITTER); mp.set(QUITTER, 'inventory', inv(ALL));
mp.set(QUITTER, 'private.lastWorn', REAL_OUTFIT.map((b) => [b, 0]));
characterReady(QUITTER);
advanceTo(now + 7000); H.equipHook(QUITTER, report([]), true);
online.delete(QUITTER);
advanceTo(now + 200000);
ok(teleports.length === 0 && told.length === 0, 'a player who left before the check gets nothing sent');
online.add(QUITTER);
mp.set(QUITTER, 'equipment', report(INN_OUTFIT));
characterReady(QUITTER);
ok(same(lastWorn(QUITTER), REAL_OUTFIT), 'and their next login keeps the outfit from before that session', lastWorn(QUITTER).map((x) => x.toString(16)));

// The undo: spawnWatch.enabled false is the old behaviour
G.__dboSpawnWatch = newWatch({ spawnWatch: { enabled: false } }); teleports.length = 0; told.length = 0;
mp.set(QUITTER, 'private.spawnUnconfirmed', true);
mp.set(QUITTER, 'equipment', report(INN_OUTFIT));
characterReady(QUITTER);
advanceTo(now + 300000);
ok(G.__dboSpawnWatch ? !G.__dboSpawnWatch.holding(QUITTER) && teleports.length === 0 && same(lastWorn(QUITTER), INN_OUTFIT) : false,
  'with spawnWatch.enabled false nothing is held, sent or kept back', [teleports.length, lastWorn(QUITTER).map((x) => x.toString(16))]);

// The undo on a reload: a login the earlier copy was holding is let go, and its queued check does nothing
G.__dboSpawnWatch = newWatch(); teleports.length = 0; told.length = 0;
characterReady(PAX);
advanceTo(now + 7000); H.equipHook(PAX, report([]), true);
G.__dboSpawnWatch = makeWatch ? makeWatch({ mp, log, personal: (a, t) => told.push([a >>> 0, t]), display, userOf, creationPending: () => false, worldIdOf, cfg: { spawnWatch: { enabled: false } }, setTimeout: later }) : null;
advanceTo(now + 300000);
ok(G.__dboSpawnWatch ? !G.__dboSpawnWatch.holding(PAX) && teleports.length === 0 && told.length === 0 : false,
  'reloading with enabled false lets go of a held login and stops its queued checks', [teleports.length, told.length]);

// Favourites: Pax, 9 Oct 03:40, in the inn: "favorites restored ... 4 of 5", then saved 3 items. Not kept while held.
G.__dboSpawnWatch = newWatch(); logs.length = 0;
const fav = uiHandlers.get('favorites');
const FULL_FAVS = { items: [{ id: 0x2700fe2b, hotkey: 1 }, { id: 0x13ed9, hotkey: 2 }, { id: 0x13eda, hotkey: 3 }, { id: 0x3eae0, hotkey: 4 }], spells: [{ id: 0x12fcd, hotkey: 0 }] };
mp.set(PAX, 'private.dboFavorites', FULL_FAVS);
characterReady(PAX);
fav(PAX, [{ items: [{ id: 0x13ed9 }, { id: 0x13eda }, { id: 0x3eae0 }], spells: [{ id: 0x12fcd }] }]);
ok(JSON.stringify(mp.get(PAX, 'private.dboFavorites')) === JSON.stringify(FULL_FAVS), 'a held game cannot save its shorter favourites list', mp.get(PAX, 'private.dboFavorites'));
arrive(PAX, BSHEARTLAND_ID);
fav(PAX, [{ items: [{ id: 0x13ed9 }], spells: [] }]);
ok((mp.get(PAX, 'private.dboFavorites').items || []).length === 1, 'once it has arrived, favourites save as before');

// The 'arrived' handler hands every report to the watch before anything else
ok(/onUi\('arrived', \(a, args\) => \{\s*const world = Number\(args\[0\]\) >>> 0;\s*if \(globalThis\.__dboSpawnWatch\) globalThis\.__dboSpawnWatch\.arrived\(a, world\);/.test(arrivedSrc),
  "gamemode.js passes every 'arrived' report to the watch");
ok(/require\(SPAWNWATCH_JS\)\(\{[^}]*creationPending[^}]*worldIdOf/.test(src), 'gamemode.js loads spawnwatch.js with the creation check and world ids');

Date.now = realNow;
console.log('');
console.log(fail ? `${fail} FAILURES` : 'all checks passed');
process.exit(fail ? 1 : 0);
