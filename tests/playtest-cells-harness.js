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
const ok = (c, what) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}`); if (!c) fails++; };
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
console.log(fails ? `${fails} failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
