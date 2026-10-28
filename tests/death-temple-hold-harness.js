// #bugs 23 Oct: died near Ivarstead, woke at the Whiterun temple. The death temple and /unstuck took zoneOfActor, whose
// outdoor rule is the nearest hold capital in a straight line, so Ivarstead (Whiterun 79,018 away, Riften 100,365) was
// Whiterun's. They now take the hold the watch reads there (guards.js holdHere: a hold-jails.json cell, else the realm.js
// territory of the place or of the last place outside, else zoneOfActor), between Skyrim's holds that have a temple.
// Runs the real zone, /unstuck and death temple code cut from gamemode.js with the real realm.js, guards.js,
// territories.json, zones.json, hold-jails.json and zone-cells.json, on stubs.
//   node tests/death-temple-hold-harness.js   (from server/; GAMEMODE_JS=<path> runs it against another gamemode.js)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const src = fs.readFileSync(process.env.GAMEMODE_JS || path.join(SERVER, 'gamemode.js'), 'utf8');
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'death-temple-hold-'));
for (const f of ['territories.json', 'hold-jails.json', 'zone-cells.json']) fs.copyFileSync(path.join(SERVER, f), path.join(dir, f));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS */ } });
global.setTimeout = () => 0;

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const ZONES = JSON.parse(fs.readFileSync(path.join(SERVER, 'zones.json'), 'utf8'));
const zoneList = () => [].concat(ZONES.holds || [], ZONES.strongholds || [], ZONES.regions || []);
const zoneById = (id) => zoneList().find((z) => z.id === String(id).toLowerCase()) || null;
// Only the respawn temples of the server's own config (the Bruma cathedral, the Pale, Hjaalmarch and Winterhold spots)
const cfg = { respawnTemples: JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8')).respawnTemples || {} };

const PLUGINS = { 'Skyrim.esm': 0x00, 'Dragonborn.esm': 0x04, 'BSHeartland.esm': 0x08, 'DragonBreak.esp': 0x40, 'DragonBreak Online Edits.esp': 0x41 };
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const TAMRIEL = '3c:Skyrim.esm', WHITERUN_W = '1a26f:Skyrim.esm', SOLITUDE_W = '37edf:Skyrim.esm', RIFTEN_W = '16bb4:Skyrim.esm';
const BLACKREACH = '1ee62:Skyrim.esm', HEARTLAND = 'a764b:BSHeartland.esm', SOLSTHEIM = '800:Dragonborn.esm';
const WRLD = new Set([TAMRIEL, WHITERUN_W, SOLITUDE_W, RIFTEN_W, '1691d:Skyrim.esm', '16d71:Skyrim.esm', BLACKREACH, HEARTLAND, SOLSTHEIM]);
const WRLD_IDS = new Set([...WRLD].map(idOf));
const recordOf = (id) => (WRLD_IDS.has(id >>> 0) ? { record: { type: 'WRLD' } } : { record: { type: 'CELL' } });

const A = 0xff000c5f;
const props = new Map();
const put = (a, k, v) => props.set(`${a >>> 0}|${k}`, v);
put(A, 'profileId', 77);
const audits = [], told = [], toldTo = [];
// Staff /unstuck of an offline character (Jake, 28 Oct): the staff member, the offline character and who the lookup finds
const STAFF = 0xff000a02, O = 0xff001715, OFFLINE = new Set([O]), TARGETS = { 'Neem #LBRF': O, 'Bear Bait': A };
const mp = {
  get: (a, k) => props.get(`${a >>> 0}|${k}`),
  set: (a, k, v) => { if (k === 'locationalData') { put(a, 'worldOrCellDesc', v.cellOrWorldDesc); put(a, 'pos', v.pos); } put(a, k, v); },
  getIdFromDesc: idOf,
  onDeath: () => true,
};
const stubs = {
  cfg, mp, recordOf, ZONES, fs, path,
  every: (n, ms, fn) => { if (n === 'outside') stubs.outside = fn; }, onlineActors: () => [A], log: () => {}, display: () => 'Bear Bait #4ZRT',
  profileOf: (a) => Number(mp.get(a, 'profileId')), userOf: (a) => (OFFLINE.has(a >>> 0) ? -1 : 1), personal: (a, t) => { told.push(t); toldTo.push([a >>> 0, t]); },
  staffCan: (a) => (a >>> 0) === STAFF, staffTargetOf: (by, q) => TARGETS[q] || 0,
  creationPending: () => false, GATE_CREATION_LINE: 'unfinished', findByName: () => 0, audit: (t) => audits.push(t), who: () => 'Bear Bait #4ZRT',
  registerChatCommand: (n, fn) => { if (n === 'unstuck') stubs.unstuck = fn; },
};

// gamemode.js: the temples, the zone code, /unstuck and the death temple, as one cut; and the chopping block's move
const i0 = src.indexOf('const TEMPLE_DEFAULTS = {'), i1 = src.indexOf('\n\n// ---- deaths', i0);
const ex = /toTemple: (\(a\) => \{ const t = templeFor\(.*?return true; \}) \}\);/.exec(src);
ok(i0 > 0 && i1 > i0 && !!ex, 'the temple, zone, /unstuck and chopping block code is in gamemode.js');
if (!(i0 > 0 && i1 > i0 && ex)) process.exit(1);
const names = ['cfg', 'mp', 'recordOf', 'ZONES', 'fs', 'path', 'every', 'onlineActors', 'log', 'display', 'profileOf', 'userOf', 'personal', 'staffCan',
  'creationPending', 'GATE_CREATION_LINE', 'findByName', 'audit', 'who', 'registerChatCommand', 'staffTargetOf'];
const G = new Function(...names, `${src.slice(i0, i1)}\nconst chopToTemple = ${ex[1]};\nreturn { templeFor, zoneOfActor, setDeathTemple, chopToTemple, combatAt };`)(...names.map((k) => stubs[k]));

// realm.js and guards.js, loaded after gamemode.js's own code as on the server
require(path.join(SERVER, 'realm.js'))({ mp, log: () => {}, personal: () => {}, system: () => {}, audit: () => {}, who: () => '', display: () => '', cfg: {},
  onUi: () => {}, registerChatCommand: () => {}, isAdmin: () => false, onlineActors: () => [A], every: () => {}, sendPacket: () => true,
  ranksOf: () => [], profileOf: (a) => a, zoneById, readOfficials: () => ({}), writeOfficials: () => {} });
delete globalThis.__dboGuardsDeathWrapped;
require(path.join(SERVER, 'guards.js'))({ mp, log: () => {}, personal: () => {}, audit: () => {}, who: () => '', display: () => '', cfg: {},
  registerChatCommand: () => {}, zoneOfActor: G.zoneOfActor, zoneById });
ok(typeof globalThis.__dboRealmTerritoryAt === 'function', 'realm.js publishes its territory lookup');
ok(typeof globalThis.__dboHoldHere === 'function', 'guards.js publishes the hold it reads (holdHere) for the temple code');

const T = (z) => G.templeFor(z);
const same = (loc, t) => !!loc && !!t && loc.cellOrWorldDesc === t.world && JSON.stringify(loc.pos) === JSON.stringify(t.pos);
const nameOf = (loc) => { if (!loc) return null; for (const z of zoneList()) { const t = T(z.id); if (same(loc, t)) return z.id; } return loc.cellOrWorldDesc; };
// Stand somewhere outdoors for a tick of the 'outside' timer (the last place outside), then go where the test is
const stand = (world, pos) => { put(A, 'worldOrCellDesc', world); put(A, 'pos', pos); stubs.outside(); };
const at = (world, pos) => { put(A, 'worldOrCellDesc', world); put(A, 'pos', pos); };
const die = () => { put(A, 'spawnPoint', { cellOrWorldDesc: 'x', pos: [0, 0, 0] }); G.setDeathTemple(A); return mp.get(A, 'spawnPoint'); };
const unstick = () => {
  const from = [mp.get(A, 'worldOrCellDesc'), mp.get(A, 'pos')];
  put(A, 'private.unstuckAt', 0); put(A, 'locationalData', null); audits.length = 0;
  stubs.unstuck(A, '');
  const loc = mp.get(A, 'locationalData'); at(from[0], from[1]);
  return { loc, audit: audits[0] || '' };
};
const chop = () => { const from = [mp.get(A, 'worldOrCellDesc'), mp.get(A, 'pos')]; put(A, 'locationalData', null); G.chopToTemple(A); const loc = mp.get(A, 'locationalData'); at(from[0], from[1]); return loc; };
const today = () => T(G.zoneOfActor(A));

const IVARSTEAD = [76375, -64263, -2300], FELL = [80089, -75384, -1500];
console.log('-- the Rift: Ivarstead and the triage\'s point');
stand(TAMRIEL, IVARSTEAD);
ok(G.zoneOfActor(A) === 'whiterun', 'zoneOfActor itself still says whiterun at Ivarstead (guards, courts, taxes and weather unchanged)', G.zoneOfActor(A));
ok(same(die(), T('riften')), 'a death at Ivarstead wakes at the Riften temple', nameOf(mp.get(A, 'spawnPoint')));
let u = unstick();
ok(same(u.loc, T('riften')) && /to the riften respawn/.test(u.audit), '/unstuck at Ivarstead goes to the Riften respawn', { to: nameOf(u.loc), audit: u.audit });
ok(same(chop(), T('riften')), 'the chopping block\'s move (the /unstuck move) from Ivarstead goes to Riften too', nameOf(mp.get(A, 'locationalData')));
stand(TAMRIEL, FELL);
ok(same(die(), T('riften')), 'a death at the triage\'s point (80089, -75384, by Honeystrand Cave) wakes at the Riften temple', nameOf(mp.get(A, 'spawnPoint')));
u = unstick();
ok(same(u.loc, T('riften')), '/unstuck there goes to Riften', nameOf(u.loc));

console.log('-- indoors: the last place outside');
stand(TAMRIEL, IVARSTEAD); at('13a5c:Skyrim.esm', [0, 0, 0]);
ok(same(die(), T('riften')), 'a death in the Vilemyr Inn after Ivarstead wakes at Riften', nameOf(mp.get(A, 'spawnPoint')));
stand(TAMRIEL, [79476, -62330, -2000]); at('6ccbb:Skyrim.esm', [100, 200, -300]);
ok(same(die(), T('riften')), 'a death in Shroud Hearth Barrow wakes at Riften', nameOf(mp.get(A, 'spawnPoint')));
u = unstick();
ok(same(u.loc, T('riften')), '/unstuck in Shroud Hearth Barrow goes to Riften', nameOf(u.loc));
stand(TAMRIEL, IVARSTEAD); at(BLACKREACH, [10000, 20000, -3000]);
ok(same(die(), T('riften')), 'a death in Blackreach (no zone) after Ivarstead wakes at Riften', nameOf(mp.get(A, 'spawnPoint')));
stand(WHITERUN_W, [22000, -4000, -3000]); at('165a7:Skyrim.esm', [0, 0, 0]);
ok(same(die(), T('whiterun')), 'a death indoors after Whiterun wakes at Whiterun', nameOf(mp.get(A, 'spawnPoint')));
stand(TAMRIEL, IVARSTEAD); at('1114:BSHeartland.esm', [0, 0, 0]);
ok(same(die(), T('bruma')), 'a Beyond Skyrim interior (Jerall View Inn) still counts as Bruma, even after Ivarstead', nameOf(mp.get(A, 'spawnPoint')));
stand(WHITERUN_W, [22000, -4000, -3000]); at('a8b23:Skyrim.esm', [0, 0, 0]);
ok(same(die(), T('riften')), 'a death in Riften\'s jail (hold-jails.json) is Riften\'s, wherever they last stood outside', nameOf(mp.get(A, 'spawnPoint')));

console.log('-- elsewhere: unchanged');
stand(WHITERUN_W, [22000, -4000, -3000]);
ok(same(die(), T('whiterun')), 'a death in Whiterun wakes at Whiterun', nameOf(mp.get(A, 'spawnPoint')));
stand(TAMRIEL, [17000, -12000, -3000]);
ok(same(die(), T('whiterun')), 'a death on the plains outside Whiterun wakes at Whiterun', nameOf(mp.get(A, 'spawnPoint')));
stand(TAMRIEL, [21941, -44792, 0]);
ok(same(die(), T('whiterun')), 'a death in Riverwood wakes at Whiterun', nameOf(mp.get(A, 'spawnPoint')));
stand(SOLITUDE_W, [-60000, 108000, -8000]);
ok(same(die(), T('solitude')), 'a death in Solitude wakes at Solitude', nameOf(mp.get(A, 'spawnPoint')));
stand(HEARTLAND, [54211, 204105, 7500]);
ok(same(die(), T('bruma')), 'a death in Bruma (Cyrodiil) wakes at the Bruma temple', nameOf(mp.get(A, 'spawnPoint')));
u = unstick();
ok(same(u.loc, T('bruma')), '/unstuck in Bruma goes to Bruma', nameOf(u.loc));
stand(SOLSTHEIM, [30000, 60000, 0]);
ok(same(die(), T('solstheim')), 'a death on Solstheim wakes at its temple (Windhelm\'s)', nameOf(mp.get(A, 'spawnPoint')));
stand(TAMRIEL, [135308, -110597, 0]);
ok(same(die(), T('riften')), 'Largashbur (an orc stronghold, no temple) keeps Riften', nameOf(mp.get(A, 'spawnPoint')));

console.log('-- staff /unstuck of an OFFLINE character: the temple of where it was saved (Jake, 28 Oct)');
put(STAFF, 'profileId', 1); put(O, 'profileId', 97);
const unstickOffline = (world, pos, last) => {
  put(O, 'worldOrCellDesc', world); put(O, 'pos', pos); put(O, 'private.lastOutside', last ? { world: last[0], pos: last[1] } : null);
  put(O, 'locationalData', null); audits.length = 0; toldTo.length = 0;
  stubs.unstuck(STAFF, 'Neem #LBRF');
  return { loc: mp.get(O, 'locationalData'), audit: audits[0] || '', toStaff: toldTo.filter(([a]) => a === STAFF).map(([, t]) => t).join(' | '), toTarget: toldTo.filter(([a]) => a === O).length };
};
let o = unstickOffline('6ca03:BSHeartland.esm', [77.4, -12.2, -65.9]);
ok(same(o.loc, T('bruma')), "Neem #LBRF offline in Aubert's House (a Beyond Skyrim interior) goes to the Bruma temple", nameOf(o.loc));
ok(/\(offline, was in "6ca03:BSHeartland\.esm" at 77,-12,-66\) will wake at the bruma respawn at their next login\.$/.test(o.toStaff), 'staff are told it was offline, where it was and the temple it wakes at', o.toStaff);
ok(o.toTarget === 0, 'nothing is written to the offline character');
ok(/^UNSTUCK .* from "6ca03:BSHeartland\.esm" at 77,-12,-66 to the bruma respawn by staff .*, offline$/.test(o.audit), 'the UNSTUCK audit line has the cell, position, temple and offline', o.audit);
o = unstickOffline(TAMRIEL, IVARSTEAD);
ok(same(o.loc, T('riften')) && /riften respawn/.test(o.toStaff), 'offline at Ivarstead: the Riften temple, as a death there', nameOf(o.loc));
o = unstickOffline('13a5c:Skyrim.esm', [0, 0, 0], [TAMRIEL, IVARSTEAD]);
ok(same(o.loc, T('riften')), "offline in the Vilemyr Inn, saved last outside at Ivarstead: Riften's, from the saved last place outside", nameOf(o.loc));
o = unstickOffline('a8b23:Skyrim.esm', [0, 0, 0], [WHITERUN_W, [22000, -4000, -3000]]);
ok(same(o.loc, T('riften')), "offline in Riften's jail (hold-jails.json): Riften's, whatever its last place outside", nameOf(o.loc));
o = unstickOffline(SOLSTHEIM, [30000, 60000, 0]);
ok(same(o.loc, T('solstheim')), "offline on Solstheim: its temple (Windhelm's)", nameOf(o.loc));
o = unstickOffline(HEARTLAND, [54211, 204105, 7500]);
ok(same(o.loc, T('bruma')), 'offline in Bruma (Cyrodiil): the Bruma temple', nameOf(o.loc));
o = unstickOffline(TAMRIEL, [135308, -110597, 0]);
ok(same(o.loc, T('riften')), 'offline in Largashbur (an orc stronghold): Riften, as online', nameOf(o.loc));
o = unstickOffline(BLACKREACH, [10000, 20000, -3000], null);
ok(same(o.loc, T('bruma')) && /resolves to no temple of its own, so Bruma's/.test(o.toStaff), "offline in Blackreach with no saved last place outside: Bruma's, as online /unstuck does, and staff are told why", { to: nameOf(o.loc), told: o.toStaff });
// An online character: as before
stand(TAMRIEL, IVARSTEAD); put(A, 'locationalData', null); toldTo.length = 0; audits.length = 0;
stubs.unstuck(STAFF, 'Bear Bait');
ok(same(mp.get(A, 'locationalData'), T('riften')) && toldTo.some(([a, t]) => a === STAFF && /is back at the riften respawn\.$/.test(t)) && toldTo.some(([a, t]) => a === A && /brings you back to safety/.test(t)),
  'staff /unstuck of an online character is as before: Riften, and both are told', toldTo);
ok(/by staff [^,]*$/.test(audits[0] || ''), '...and its audit line has no offline mark', audits[0]);

// Today's behaviour when a module is missing: every case above against templeFor(zoneOfActor)
const CASES = [[TAMRIEL, IVARSTEAD], [TAMRIEL, FELL], [WHITERUN_W, [22000, -4000, -3000]], [SOLITUDE_W, [-60000, 108000, -8000]], [HEARTLAND, [54211, 204105, 7500]],
  [[TAMRIEL, IVARSTEAD], '13a5c:Skyrim.esm'], [[TAMRIEL, IVARSTEAD], BLACKREACH], [[TAMRIEL, IVARSTEAD], '1114:BSHeartland.esm']];
const asToday = () => CASES.every((c) => {
  if (Array.isArray(c[0])) { stand(c[0][0], c[0][1]); at(c[1], [0, 0, 0]); } else stand(c[0], c[1]);
  const want = today(); const d = die(); const v = unstick().loc; const k = chop();
  return same(d, want) && same(v, want) && same(k, want);
});
console.log('-- without realm.js or guards.js: as before');
const realmAt = globalThis.__dboRealmTerritoryAt, holdHere = globalThis.__dboHoldHere;
globalThis.__dboRealmTerritoryAt = undefined;
stand(TAMRIEL, IVARSTEAD);
ok(same(die(), T('whiterun')), 'with realm.js not loaded a death at Ivarstead wakes at Whiterun as before', nameOf(mp.get(A, 'spawnPoint')));
ok(asToday(), 'with realm.js not loaded every case dies, /unstucks and is moved as zoneOfActor says');
globalThis.__dboRealmTerritoryAt = realmAt; globalThis.__dboHoldHere = null;
ok(asToday(), 'with guards.js not loaded (its global cleared) every case is as zoneOfActor says');
globalThis.__dboHoldHere = () => { throw new Error('boom'); };
ok(asToday(), 'a guards.js that throws changes nothing either');
globalThis.__dboHoldHere = holdHere;
stand(TAMRIEL, IVARSTEAD);
ok(same(die(), T('riften')), 'with both back, Ivarstead is the Rift\'s again', nameOf(mp.get(A, 'spawnPoint')));

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
