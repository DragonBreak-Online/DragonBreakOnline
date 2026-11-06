// The Bruma region lock lets players stay in every interior of ours that is listed in gamemode-config.json playtest
// allowedCells (the Bank of Bruma, and DLE v13's Bleak-Frost Mine 177fb6), and still returns them from any other
// interior of our plugin. Loads the real playtest.js with the real config block.
//   node tests/playtest-cells-harness.js   (from server/)
'use strict';
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const shipped = require(path.join(SERVER, 'gamemode-config.json'));
// Skyrim is open with the Skyrim release (the shipped lock lists only closedPlugins); the Bruma lock itself is what this tests,
// so it runs on the old Bruma-only block rebuilt over the shipped config
const cfg = require('./playtest-bruma-lock.js')(shipped);
let P = 0xff000014;
let place = '', moved = 0, tick = null;
const connected = new Map();
const mp = { get: (a, k) => (k === 'worldOrCellDesc' ? place : undefined), set: (a, k) => { if (k === 'locationalData') moved++; }, getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) };
require(path.join(SERVER, 'playtest.js'))({
  mp, log: () => {}, personal: () => {}, system: () => {}, registerChatCommand: () => {}, display: String, who: String, audit: () => {},
  onlineActors: () => [P], isAdmin: () => false, sendPacket: () => {}, cfg, hubDesc: 'hub:x', connectedAt: connected,
  every: (name, ms, fn) => { tick = fn; },
});
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
// a fresh player each time (connected long ago), so the lock's 10 s bounce throttle never hides an answer
const after = (desc) => { P += 1; connected.set(P, 0); place = desc; moved = 0; tick(); return moved; };
ok(shipped.playtest.enabled === true && shipped.playtest.closedPlugins.length > 0 && shipped.playtest.gatesToArrival === false, 'the shipped lock opens Skyrim: on, with closedPlugins, hub gates to the holds');
ok(cfg.playtest.enabled === true && typeof tick === 'function', 'locked, it checks on a timer');
ok(after('177fb6:DragonBreak Online Edits.esp') === 0, 'a player in the Bleak-Frost Mine (177fb6) stays');
ok(after('130040:DragonBreak Online Edits.esp') === 0, 'so does one in the Bank of Bruma (130040)');
ok(after('d9595:BSHeartland.esm') === 0, 'and in a Beyond Skyrim interior such as CYRFrostironmine01');
ok(after('a764b:BSHeartland.esm') === 0, 'and in the Cyrodiil worldspace');
ok(after('177fb7:DragonBreak Online Edits.esp') === 1, 'another interior of our plugin is still returned');
ok(after('3c:Skyrim.esm') === 1, 'and so is Skyrim');
// The shipped config (the Skyrim release): Skyrim, Bruma and our interiors are open; the closed lands return a player, and
// their doors refuse; the Pale Pass doors are open both ways
{
  let t2 = null; const pk = []; let P2 = 0xff000100; let at2 = '3c:Skyrim.esm', moved2 = 0; const said = [];
  const cn = new Map();
  const mp2 = { get: (a, k) => (k === 'worldOrCellDesc' ? at2 : undefined), set: (a, k) => { if (k === 'locationalData') moved2++; }, getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) };
  require(path.join(SERVER, 'playtest.js'))({
    mp: mp2, log: () => {}, personal: (a, t) => said.push(t), system: (a, t) => said.push(t), registerChatCommand: () => {}, display: String, who: String, audit: () => {},
    onlineActors: () => [P2], isAdmin: () => false, sendPacket: (a, p) => pk.push(p), cfg: shipped, hubDesc: '17482:DragonBreak Hub.esp', connectedAt: cn,
    every: (name, ms, fn) => { t2 = fn; },
  });
  const at = (desc) => { P2 += 1; cn.set(P2, 0); at2 = desc; moved2 = 0; t2(); return moved2; };
  ok(at('3c:Skyrim.esm') === 0, 'Skyrim open: a player in Tamriel stays');
  ok(at('1a26f:Skyrim.esm') === 0 && at('16bb4:Skyrim.esm') === 0, '...and in Whiterun and Riften (city worldspaces)');
  ok(at('16d71:Skyrim.esm') === 0 && at('1caa7:Skyrim.esm') === 0, '...and in any Skyrim interior');
  ok(at('177fb7:DragonBreak Online Edits.esp') === 0 && at('1102f4:Helgen Reborn.esp') === 0, '...and in our own interiors and Helgen Reborn');
  ok(at('a764b:BSHeartland.esm') === 0 && at('17482:DragonBreak Hub.esp') === 0, '...and in Cyrodiil and the Realm');
  ok(at('800:Dragonborn.esm') === 1, 'Solstheim is closed: returned');
  ok(at('d63:Druadach.esm') === 1 && at('22b4:arnima.esm') === 1 && at('1d2d:summersetisles.esp') === 1 && at('d62:King of the Murkmire.esp') === 1, 'Druadach, Beyond Reach, Summerset and Murkmire are closed');
  ok(at('a4d:Gray Fox Cowl.esm') === 1 && at('5fe:MoreToDoHammerfell.esp') === 1, 'Hammerfell (Gray Cowl, More To Do) is closed');
  ok(said.some((t) => /only Skyrim and Bruma are open/.test(t)), 'the return says what is open', said.slice(-1)[0]);
  ok(pk.length >= 1 && pk[0].customPacketType === 'dboBlockedDoors' && pk[0].refs.length === shipped.playtest.blockedDoors.length, 'clients are sent the closed lands\' doors');
  ok(globalThis.__dboPlaytestGate(P2) === false, 'the hub gates go to gamemode.js (the Skyrim holds), not the arrival');
  ok(globalThis.__dboPlaytestActivate(0x877c2, P2) === null && globalThis.__dboPlaytestActivate(0x656df, P2) === null, 'the Pale Pass doors are open both ways');
  ok(globalThis.__dboPlaytestActivate(0x16fe0, P2) === false, 'the ship to Solstheim refuses');
  ok(pk[0].refs.includes(0x5eb06), 'the Helgen escape cave door is among the doors the client blocks itself (its load hung, 18 Oct)');
  P2 += 1; said.length = 0;
  ok(globalThis.__dboPlaytestActivate(0x5eb06, P2) === false && /tunnel has collapsed/.test(said[0] || '') && !/only Skyrim and Bruma/.test(said[0] || ''), '...the server refuses it with its own line, not the closed lands\'', said[0]);
}
// 5eb06 is an automatic door (AutoLoadDoor01 31897, FNAM 0x02) whose DLE override has no XTEL: walking into its trigger froze the
// player until /unstuck, and a relog landed them in it again (#bugs 1568129701808185435). Every walk-in is now stepped back onto
// doorReturns' trail spot 300 ms later, Lead staff included; the read is the base's FNAM, so a door with a return spot that is
// not automatic is only refused
{
  const DOOR = 0x5eb06, HATCH = 0x16fe0, CAVE = [12772.0, -72186.1, 6067.1];
  const spot = (shipped.playtest.doorReturns || {})['5eb06:Skyrim.esm'];
  ok(!!spot && spot.world === '3c:Skyrim.esm' && Array.isArray(spot.pos) && spot.pos.length === 3, 'the shipped config gives 5eb06 a return spot in Tamriel', spot);
  // AutoLoadDoor01's bounds are 1200 x 1200, so a spot 850 out from the centre is outside its trigger however the door is turned
  ok(!!spot && Math.hypot(spot.pos[0] - CAVE[0], spot.pos[1] - CAVE[1]) >= 850, '...at least 850 units from the door\'s centre', spot && Math.round(Math.hypot(spot.pos[0] - CAVE[0], spot.pos[1] - CAVE[1])));
  // The ship's hatch gets a return spot here only to show that a door whose base is not automatic is never stepped back from
  const cfg3 = JSON.parse(JSON.stringify(shipped));
  cfg3.playtest.doorReturns['16fe0:Dragonborn.esm'] = { world: '3c:Skyrim.esm', pos: [0, 0, 0], rotZ: 0 };
  const recs = new Map([
    [DOOR, { record: { type: 'REFR', fields: [{ type: 'NAME', data: [0x97, 0x18, 0x03, 0x00] }] }, toGlobalRecordId: (x) => x }],
    [0x31897, { record: { type: 'DOOR', fields: [{ type: 'FNAM', data: [0x02] }] } }],
    [HATCH, { record: { type: 'REFR', fields: [{ type: 'NAME', data: [0x01, 0xfe, 0x01, 0x00] }] }, toGlobalRecordId: (x) => x }],
    [0x1fe01, { record: { type: 'DOOR', fields: [{ type: 'FNAM', data: [0x00] }] } }],
  ]);
  const PL = 0xff000200, LEAD = 0xff000201;
  const at = new Map([[DOOR, { w: '3c:Skyrim.esm', p: CAVE }], [HATCH, { w: '3c:Skyrim.esm', p: [0, 0, 0] }]]);
  const moves = [], said3 = [], logs = [], timers = [];
  const mp3 = {
    get: (id, k) => { const o = at.get(id >>> 0); if (k === 'worldOrCellDesc') return o ? o.w : ''; if (k === 'pos') return o ? o.p : undefined; if (k === 'isDead') return false; return undefined; },
    set: (id, k, v) => { if (k === 'locationalData') { moves.push([id, v]); at.set(id >>> 0, { w: v.cellOrWorldDesc, p: v.pos }); } },
    getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16),
    getDescFromId: (id) => (id === DOOR ? '5eb06:Skyrim.esm' : (id >>> 0).toString(16)),
    lookupEspmRecordById: (id) => { if (!recs.has(id >>> 0)) throw new Error('no record'); return recs.get(id >>> 0); },
  };
  const realTimeout = global.setTimeout, realNow = Date.now;
  let clock = 1_800_000_000_000;
  global.setTimeout = (fn, ms) => { timers.push([fn, ms]); return 0; };
  Date.now = () => clock;
  require(path.join(SERVER, 'playtest.js'))({
    mp: mp3, log: (...t) => logs.push(t.join(' ')), personal: (a, t) => said3.push(t), system: () => {}, registerChatCommand: () => {}, display: String, who: String, audit: () => {},
    onlineActors: () => [PL, LEAD], isAdmin: (a) => a === LEAD, isLeadStaff: (a) => a === LEAD, sendPacket: () => {}, cfg: cfg3, hubDesc: '17482:DragonBreak Hub.esp', connectedAt: new Map(), every: () => {},
  });
  const flush = () => { const t = timers.splice(0); t.forEach(([fn]) => fn()); return t; };
  // Walks in from the trail side: the trigger's edge is 600 units out, so 300 out along the trail is inside it
  const walkIn = (a, wait, out = 300) => { clock += wait; moves.length = 0; said3.length = 0; const f = out / Math.hypot(spot.pos[0] - CAVE[0], spot.pos[1] - CAVE[1]); at.set(a, { w: '3c:Skyrim.esm', p: [CAVE[0] + (spot.pos[0] - CAVE[0]) * f, CAVE[1] + (spot.pos[1] - CAVE[1]) * f, CAVE[2]] }); return globalThis.__dboPlaytestActivate(DOOR, a); };
  let r = walkIn(PL, 5000);
  const t1 = flush();
  ok(r === false && t1.length === 1 && t1[0][1] === 300, 'a player walks into the cave mouth: refused, and the step back is due 300 ms later', { r, timers: t1.map((t) => t[1]) });
  ok(moves.length === 1 && moves[0][0] === PL && moves[0][1].cellOrWorldDesc === spot.world && JSON.stringify(moves[0][1].pos) === JSON.stringify(spot.pos) && moves[0][1].rot[2] === spot.rotZ, '...then set back on the trail spot, not sent to the Cyrodiil arrival', moves);
  ok(/tunnel has collapsed/.test(said3[0] || ''), '...and told the tunnel has collapsed', said3);
  ok(logs.some((t) => /5eb06/.test(t) && /stepped back/.test(t)), '...and the server log says so', logs.slice(-1));
  r = walkIn(PL, 500);
  flush();
  ok(r === false && moves.length === 1 && said3.length === 0, 'walking straight back in half a second later: stepped back again, the line not repeated', { r, moves, said3 });
  walkIn(PL, 5000); clock += 100; globalThis.__dboPlaytestActivate(DOOR, PL); clock += 100; globalThis.__dboPlaytestActivate(DOOR, PL);
  ok(timers.length === 1, 'the engine firing the door three times inside 300 ms: one step back pending', timers.length);
  flush();
  ok(moves.length === 1, '...and one move', moves);
  r = walkIn(LEAD, 5000);
  flush();
  ok(r === false && moves.length === 1 && moves[0][0] === LEAD && /tunnel has collapsed/.test(said3[0] || '') && !said3.some((t) => /open to you/.test(t)), 'a Lead GM walks in: refused and stepped back too, no "open to you"', { r, moves, said3 });
  r = walkIn(PL, 5000, 3000);
  flush();
  ok(r === false && moves.length === 0, 'the door "activated" from 3000 units down the trail: refused, nobody moved', { r, moves });
  clock += 5000; moves.length = 0; at.set(PL, { w: '3c:Skyrim.esm', p: [100, 0, 0] });
  r = globalThis.__dboPlaytestActivate(HATCH, PL);
  flush();
  ok(r === false && moves.length === 0 && logs.some((t) => /16fe0/.test(t) && /not read as an automatic door/.test(t)), 'a door with a return spot whose base is not automatic: refused, not moved, and the log says why', { r, moves, log: logs.slice(-1) });
  global.setTimeout = realTimeout; Date.now = realNow;
}
console.log(fails ? `${fails} failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
