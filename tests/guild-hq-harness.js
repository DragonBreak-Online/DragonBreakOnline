// Guild leaders hold their halls (Nate, 16 Oct: "make sure the guild leaders own their HQ"). server\guilds.js:
//  1. a leader holds the hall by the building's root too, not only by the doors guild-defs lists (Castle Bruma's root
//     6c473 is no listed door; its listed doors b46a8 and 726f2 are members of it), so a new Count takes it over;
//  2. a shared hall's leader (the Legion at Castle Bruma) uses it as its owner does but does not hold it (no hand-over);
//  3. a hall nobody owns is granted to its faction's leader (Fort Dawnguard), never one somebody owns, never a door the
//     registry lists but reads as unowned (boot), never a shared hall; a refused grant is said once; config can switch it off.
// Loads the real guilds.js and guild-defs.json against a stub api and a stub housing system, in a temp working directory.
//
//   node tests/guild-hq-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const GUILDS = path.resolve(__dirname, '..', 'guilds.js');
const DEFS = path.resolve(__dirname, '..', 'guild-defs.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guild-hq-'));
fs.copyFileSync(DEFS, path.join(dir, 'guild-defs.json'));
process.chdir(dir);

// Characters (actor ids) and their profiles
const COUNTESS = 0xff003385, KOJUS = 0xff0021dd, AYLIN = 0xff000ba2, STIBBONS = 0xff00027b, GUARD = 0xff000010, SOLDIER = 0xff000011, NEWCOUNT = 0xff000012;
const PROFILE = { [COUNTESS]: 70, [KOJUS]: 80, [AYLIN]: 81, [STIBBONS]: 33, [GUARD]: 90, [SOLDIER]: 91, [NEWCOUNT]: 92 };
// Load order index of the stub: BSHeartland 0x08, Dawnguard 0x02, everything else 0x30
const IDX = { 'bsheartland.esm': 0x08, 'dawnguard.esm': 0x02 };
const idOf = (desc) => { const [hex, ...p] = String(desc).toLowerCase().split(':'); const i = IDX[p.join(':')]; return (((i === undefined ? 0x30 : i) << 24) | parseInt(hex, 16)) >>> 0; };
// The engine matches a plugin's name exactly ("bsheartland.esm not found in loaded files"): the stub does too
const SPELLED = { 'bsheartland.esm': 'BSHeartland.esm', 'dawnguard.esm': 'Dawnguard.esm' };
const exactIdOf = (desc) => { const p = String(desc).split(':').slice(1).join(':'); const want = SPELLED[p.toLowerCase()]; if (want && p !== want) throw new Error(`${p} not found in loaded files`); return idOf(desc); };
const descOf = (id) => { id >>>= 0; const top = id >>> 24; const plug = Object.keys(IDX).find((k) => IDX[k] === top) || 'other.esp'; return `${(id & 0xffffff).toString(16)}:${SPELLED[plug] || plug}`; };

const CASTLE = idOf('6c473:BSHeartland.esm'), CASTLE_FAR = idOf('6c4d9:BSHeartland.esm');
const B46A8 = idOf('b46a8:BSHeartland.esm'), C726F2 = idOf('726f2:BSHeartland.esm');
const SPIRE = idOf('859ad:BSHeartland.esm'), FG = idOf('eeb:BSHeartland.esm'), FG_DOOR = idOf('ff0:BSHeartland.esm');
const DG1 = idOf('f359:Dawnguard.esm');
const hallDoors = (fid) => JSON.parse(fs.readFileSync(DEFS, 'utf8')).factions.find((f) => f.id === fid).hall.doors;

// The housing system's records: { ref: { owner, ownerChar, place } }; a door of a place answers primaryOf with the root
const recs = new Map();
const memberOf = new Map([[B46A8, CASTLE], [C726F2, CASTLE], [FG_DOOR, FG], [idOf('6caa7:BSHeartland.esm'), FG]]);
const DG_DOORS = hallDoors('dawnguard').map(idOf);
let unreadable = new Set();
const grants = [];
let grantErr = '';
const H = {
  primaryOf: (ref) => memberOf.get(Number(ref) >>> 0) || (Number(ref) >>> 0),
  recordOf: (ref) => (unreadable.has(Number(ref) >>> 0) ? null : recs.get(Number(ref) >>> 0) || null),
  grant: (ref, actor) => {
    if (grantErr) return grantErr;
    const p = H.primaryOf(ref);
    grants.push([p, actor >>> 0]);
    recs.set(p, { owner: PROFILE[actor >>> 0], ownerChar: actor >>> 0, place: { cells: ['x'] } });
    // Fort Dawnguard's other ways in join the place the first grant builds
    if (p === DG1) for (const d of DG_DOORS) if (d !== DG1) memberOf.set(d, DG1);
    return '';
  },
};
recs.set(CASTLE, { owner: 70, ownerChar: COUNTESS, place: { cells: ['6c40f:BSHeartland.esm'] } });
recs.set(SPIRE, { owner: 35, ownerChar: 0xff000303, place: { cells: ['a'] } });
recs.set(FG, { owner: 33, ownerChar: STIBBONS, place: { cells: ['b'] } });
fs.writeFileSync('housing.json', JSON.stringify([CASTLE, SPIRE, FG]));

const logs = [], audits = [];
const noop = () => {};
const api = {
  mp: { get: () => undefined, set: noop, getDescFromId: (id) => descOf(id), getIdFromDesc: (d) => exactIdOf(d) },
  log: (...a) => logs.push(a.join(' ')), personal: noop, system: noop, audit: (t) => audits.push(t),
  registerChatCommand: noop, onUi: noop, openWidget: noop, closeWidget: noop,
  display: (a) => `P${(a >>> 0).toString(16)}`, who: (a) => `P${(a >>> 0).toString(16)}`, nameOf: (a) => `P${(a >>> 0).toString(16)}`,
  tagOf: () => 'TAG', onlineActors: () => [], isAdmin: () => false, findByName: () => 0, cfg: {}, isLeadStaff: () => false,
  profileOf: (a) => PROFILE[a >>> 0] || 0,
};
globalThis.__dboHousing = H;
const st = { 'county-bruma': {}, 'imperial-legion': {}, dawnguard: {}, 'fighters-guild': {} };
st['county-bruma'][String(COUNTESS)] = { rank: 0, name: 'Countess Frigga Hux', tag: 'A', since: 1 };
st['county-bruma'][String(GUARD)] = { rank: 4, name: 'Guard', tag: 'B', since: 1 };
st['imperial-legion'][String(KOJUS)] = { rank: 0, name: 'Magister Kojus Animus', tag: 'C', since: 1 };
st['imperial-legion'][String(SOLDIER)] = { rank: 3, name: 'Soldier', tag: 'D', since: 1 };
st.dawnguard[String(AYLIN)] = { rank: 0, name: 'Aylin Jes', tag: 'E', since: 1 };
st['fighters-guild'][String(STIBBONS)] = { rank: 0, name: 'Stibbons', tag: 'F', since: 1 };
fs.writeFileSync('guilds.json', JSON.stringify(st));
require(GUILDS)(api);
if (globalThis.__dboHallSyncTimer) clearTimeout(globalThis.__dboHallSyncTimer);

let fail = 0, n = 0;
const ok = (c, what, extra) => { n++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || extra === undefined ? '' : ': ' + JSON.stringify(extra)}`); if (!c) fail++; };
const members = globalThis.__dboGuildState.members;

// ---- 0: the defs say what the fix assumes ----
const defs = JSON.parse(fs.readFileSync('guild-defs.json', 'utf8'));
const hallOf = (id) => (defs.factions.find((f) => f.id === id) || {}).hall || {};
ok(!hallOf('county-bruma').shared && hallOf('county-bruma').doors.includes('b46a8:BSHeartland.esm'), 'guild-defs: Bruma Castle is the County\'s, by door b46a8');
ok(hallOf('imperial-legion').shared === true && hallOf('imperial-legion').doors.includes('b46a8:BSHeartland.esm'), '...and the Legion only shares it');
ok(!hallOf('county-bruma').doors.map((d) => d.toLowerCase()).includes('6c473:bsheartland.esm'), '...whose root door 6c473 guild-defs does not list (why the root lookup is needed)');

// ---- 1: a leader holds the hall by its root ----
const castleRefs = [CASTLE, CASTLE_FAR];
ok(globalThis.__dboHallLeader(castleRefs, COUNTESS) === true, 'the Countess holds Castle Bruma by its root (6c473), through its listed doors');
ok(globalThis.__dboHallLeader([SPIRE, 0], 0xff000303) === false, 'the College of Whispers has no leader in this roster, so no one holds the Spire');
ok(globalThis.__dboHallLeader([FG, 0], STIBBONS) === true, 'Stibbons holds the Fighters Guild (root eeb is a listed door, as before)');
// ---- 2: a shared hall's leader shares it, never holds it ----
ok(globalThis.__dboHallLeader(castleRefs, KOJUS) === false, 'the Legion\'s leader does not hold Castle Bruma (no hand-over, rename, giving it up)');
ok(globalThis.__dboHallMember(castleRefs, 70, KOJUS, COUNTESS) === true, '...but uses it as its owner does (opens, locks)');
ok(globalThis.__dboHallLeader([B46A8], KOJUS) === false, '...also at the listed door itself, which the Legion shares');
ok(globalThis.__dboHallMember(castleRefs, 70, SOLDIER, COUNTESS) === false && globalThis.__dboHallMember(castleRefs, 70, GUARD, COUNTESS) === false,
  'rank-and-file members of the County and the Legion are not given the castle by its root (unchanged: members match listed doors only)');
// ---- the hall follows the leader ----
members['county-bruma'][String(COUNTESS)].rank = 4;
members['county-bruma'][String(NEWCOUNT)] = { rank: 0, name: 'New Count', tag: 'G', since: 2 };
ok(globalThis.__dboHallLeader(castleRefs, NEWCOUNT) === true && globalThis.__dboHallLeader(castleRefs, COUNTESS) === false,
  'a new Count holds Castle Bruma at once; the old one no longer holds it through the hall (she still owns the record)');
members['county-bruma'][String(COUNTESS)].rank = 0; delete members['county-bruma'][String(NEWCOUNT)];

// ---- 3: unowned halls go to their leader ----
logs.length = 0; audits.length = 0;
unreadable = new Set();
let done = globalThis.__dboGuildHallSync();
ok(done.length === 1 && done[0].fid === 'dawnguard' && done[0].leader === AYLIN, 'Fort Dawnguard, unowned, is granted to Aylin Jes, the Dawnguard\'s leader', done);
ok(grants.length === 1 && grants[0][0] === DG1, '...once: its other ways in joined the place the first grant built', grants);
ok(!grants.some((g) => g[0] === CASTLE || g[0] === SPIRE || g[0] === FG), 'owned halls (Castle Bruma, Frostcrag Spire, the Fighters Guild) are never granted');
ok(audits.some((t) => /Fort Dawnguard/.test(t) && /dawnguard|Dawnguard/.test(t)), '...and the grant is audited', audits);
ok(globalThis.__dboHallLeader([DG1, 0], AYLIN) === true, 'Aylin Jes now holds Fort Dawnguard');
ok(globalThis.__dboGuildHallSync().length === 0 && grants.length === 1, 'a second run changes nothing');

// a leader change: the hall stays its owner's, the new leader holds it
members.dawnguard[String(AYLIN)].rank = 3;
members.dawnguard[String(GUARD)] = { rank: 0, name: 'Next', tag: 'H', since: 3 };
ok(globalThis.__dboGuildHallSync().length === 0, 'a new Dawnguard leader does not re-grant an owned fort');
ok(globalThis.__dboHallLeader([DG1, 0], GUARD) === true && globalThis.__dboHallLeader([DG1, 0], AYLIN) === false, '...but holds it through the hall at once');
members.dawnguard[String(AYLIN)].rank = 0; delete members.dawnguard[String(GUARD)];

// a door the registry lists but that reads as nothing (just after a boot) is never granted
recs.delete(DG1); for (const d of DG_DOORS) memberOf.delete(d);
fs.writeFileSync('housing.json', JSON.stringify([CASTLE, SPIRE, FG, ...DG_DOORS]));
logs.length = 0;
ok(globalThis.__dboGuildHallSync().length === 0 && grants.length === 1, 'a registered door that reads unowned is left alone (records unreadable at boot)');
ok(logs.some((l) => /in the registry but reads unowned/.test(l)), '...and says so', logs);
const before = logs.length; globalThis.__dboGuildHallSync();
ok(logs.length === before, '...once, not on every run');
fs.writeFileSync('housing.json', 'not json');
ok(globalThis.__dboGuildHallSync().length === 0 && grants.length === 1, 'an unreadable registry grants nothing');

// a refused grant (the leader already holds a property) is said once
fs.writeFileSync('housing.json', JSON.stringify([CASTLE, SPIRE, FG]));
grantErr = 'They already hold a property; one each.'; logs.length = 0;
globalThis.__dboGuildHallSync(); globalThis.__dboGuildHallSync();
const refused = logs.filter((l) => /not granted/.test(l) && /already hold a property/.test(l));
ok(refused.length === DG_DOORS.length && grants.length === 1, 'a refused grant is logged once per door, not on every run', logs);
grantErr = '';

// shared halls are never granted: the Legion would be given Castle Bruma if it were unowned
recs.delete(CASTLE); unreadable = new Set();
fs.writeFileSync('housing.json', JSON.stringify([SPIRE, FG]));
globalThis.__dboGuildHallSync();
ok(grants.filter((g) => g[0] === CASTLE).length === 1 && grants.find((g) => g[0] === CASTLE)[1] === COUNTESS, 'an unowned Castle Bruma goes to the Countess (the County\'s seat), never to the Legion\'s leader', grants);

// config off
recs.delete(DG1); for (const d of DG_DOORS) memberOf.delete(d); const g0 = grants.length;
api.cfg.guildHalls = { grantToLeader: false };
ok(globalThis.__dboGuildHallSync().length === 0 && grants.length === g0, 'guildHalls.grantToLeader false grants nothing');
delete api.cfg.guildHalls;

// a faction with no leader gets nothing
delete members.dawnguard[String(AYLIN)];
ok(globalThis.__dboGuildHallSync().length === 0 && grants.length === g0, 'a hall whose faction has no leader is not granted');


console.log(`\n${n - fail}/${n} passed`);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp */ }
process.exit(fail ? 1 : 0);
