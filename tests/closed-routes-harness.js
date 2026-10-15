// Only Skyrim opens (Nate, 15 Oct: "Make sure the route to baan malur from windhelm is disabled too, just skyrim will be
// open"): every route from Windhelm to Solstheim and Baan Malur is refused with the closedMessage, a player carried into a
// closed land anyway is put back where they last stood in Skyrim, and the staff teleport to Baan Malur stays staff-only.
// Runs playtest.js on the shipped gamemode-config.   node tests/closed-routes-harness.js
'use strict';
const fs = require('fs'), path = require('path');
const SERVER = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
let fails = 0; const ok = (c, w, x) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${w}${!c && x !== undefined ? '   ' + JSON.stringify(x) : ''}`); if (!c) fails++; };
const PT = cfg.playtest;
// a unique id per desc, as the server's getIdFromDesc gives (800:Dragonborn.esm and 800:Journey ... Dunmeth Pass differ)
const ids = new Map(); const idOf = (d) => { const k = String(d).toLowerCase(); if (!ids.has(k)) ids.set(k, 0x01000000 + ids.size); return ids.get(k); };
const said = [], audits = []; let tick = null; const P = 0xff000200; let place = '3c:Skyrim.esm', pos = [141000, 34000, -13990]; const moves = [];
const admins = new Set();
require(path.join(SERVER, 'playtest.js'))({
  mp: { get: (a, k) => (k === 'worldOrCellDesc' ? place : k === 'locationalData' ? { cellOrWorldDesc: place, pos, rot: [0, 0, 0] } : k === 'pos' ? pos : undefined),
    set: (a, k, v) => { if (k === 'locationalData') moves.push(v); }, getIdFromDesc: idOf },
  log: () => {}, personal: (a, t) => said.push(t), system: (a, t) => said.push(t), registerChatCommand: () => {}, display: String, who: String,
  audit: (t) => audits.push(t), onlineActors: () => [P], isAdmin: (a) => admins.has(a), sendPacket: () => {}, cfg, hubDesc: '17482:DragonBreak Hub.esp',
  connectedAt: new Map([[P, 0]]), every: (n, ms, fn) => { tick = fn; },
});
// a different player each time: the lock says its line once per 1.5 s per player (it still refuses in between)
let asker = 0xff000300;
const refused = (desc) => { said.length = 0; const r = globalThis.__dboPlaytestActivate(idOf(desc), ++asker); return r === false && said[0] === PT.closedMessage; };
ok(PT.enabled === true && /only Skyrim and Bruma are open/.test(PT.closedMessage), 'the lock is on with the closed lands\' own message', PT.closedMessage);
const ROUTES = [
  ['16fe0:Dragonborn.esm', 'the Solstheim ship\'s hatch at the Windhelm docks'],
  ['182af:Dragonborn.esm', 'Gjalund Salt-Sage, the Northern Maiden\'s captain at the Windhelm docks (dialogue to Raven Rock)'],
  ['376f8:Dragonborn.esm', 'Sogrlaf, of the Northern Maiden\'s crew'],
  ['376f7:Dragonborn.esm', 'Lygrleid, of the Northern Maiden\'s crew'],
  ['1c8d60:Journey to Baan Malur.esp', 'Baan Malur\'s Dwemer door east of Windhelm'],
  ['800:Journey to Baan Malur - Dunmeth Pass.esp', 'the Dunmeth Pass gate to Solstheim'],
  ['3111:Update.esm', 'the Creation Club placeholder door to Solstheim (1)'],
  ['3117:Update.esm', 'the Creation Club placeholder door to Solstheim (2)'],
];
for (const [d, what] of ROUTES) ok(refused(d), `${what} (${d}) is refused with the closedMessage`, said);
ok(['1a4d:Gray Fox Cowl.esm', '30d90:Druadach.esm', '374e:Druadach.esm', '9a87dc:King of the Murkmire.esp'].every(refused), 'the other closed lands\' doors too (Hammerfell, Druadach, Murkmire)');
ok(globalThis.__dboPlaytestActivate(idOf('877c2:BSHeartland.esm'), P) === null && globalThis.__dboPlaytestActivate(idOf('656df:BSHeartland.esm'), P) === null, 'the Pale Pass road between Skyrim and Bruma is open');
ok(globalThis.__dboPlaytestActivate(idOf('1691d:Skyrim.esm'), P) === null, 'an ordinary ref is not ours to refuse');
// carried there anyway (dialogue travel runs in the game): put back where they last stood in Skyrim, told why
tick(); place = '800:Dragonborn.esm'; pos = [30883, 35049, 466]; said.length = 0; tick();
ok(moves.length === 1 && moves[0].cellOrWorldDesc === '3c:Skyrim.esm' && moves[0].pos[0] === 141000, 'a player found in Solstheim is put back at the Windhelm docks where they stood', moves);
ok(said[0] === `${PT.closedMessage} You have been brought back.`, '...told the land is closed', said);
place = '487595:Journey to Baan Malur.esp'; moves.length = 0; tick(); tick();
ok(moves.length === 0, 'a second return within 10 s waits (the throttle)');
// the staff teleport: Baan Malur is an admin location in a closed land; staff are never returned, players are
const locs = JSON.parse(fs.readFileSync(path.join(SERVER, 'admin-locations.json'), 'utf8'));
const list = Array.isArray(locs) ? locs : (locs.locations || Object.values(locs));
const baan = list.find((l) => l && l.name === 'Baan Malur');
ok(!!baan && PT.closedPlugins.map((p) => p.toLowerCase()).includes(String(baan.world).split(':')[1].toLowerCase()), 'the admin location "Baan Malur" lies in a closed land', baan);
const P2 = P; admins.add(P2); moves.length = 0; place = String(baan.world); pos = baan.pos;
const later = Date.now; Date.now = () => later() + 60000; tick(); Date.now = later;
ok(moves.length === 0, 'staff who teleport there are left alone (admins are exempt)');
admins.delete(P2); Date.now = () => later() + 120000; tick(); Date.now = later;
ok(moves.length === 1, 'a player there is returned');
// AdminSystem (fork) sends the location list and runs teleports only for admins and Trial GMs: checked when the fork is at hand
const forkDir = process.env.FORK_SERVER || path.resolve(SERVER, '..', 'fork');
const adminTs = path.join(forkDir, 'skymp5-server', 'ts', 'systems', 'adminSystem.ts');
if (fs.existsSync(adminTs)) {
  const t = fs.readFileSync(adminTs, 'utf8');
  ok(/type !== "adminLocationsRequest"\) return;/.test(t) && /if \(!myActorId \|\| \(!trial && !this\.isAdminActor\(mp, myActorId\)\)\)/.test(t), 'AdminSystem answers the location list and its teleports only for staff');
} else console.log('skip  AdminSystem source not found (set FORK_SERVER)');
console.log(fails ? `${fails} failure(s)` : 'all checks passed'); process.exit(fails ? 1 : 0);
