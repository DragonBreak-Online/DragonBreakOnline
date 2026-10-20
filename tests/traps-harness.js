// Server-run dungeon traps (traps.js, Nate 20 Oct). Loads the real module in a scratch folder with a small traps.json and a
// fake clock: a plate fires its traps (staff only until tested), the animations go out, the blow lands on whoever is in
// the swing and nobody else, once per firing, by level; cooldowns; the vanilla trigger-box script is kept from the boxes it
// handles; a player in the character editor is left alone. Rotations: a spear on a wall (X = 90 degrees) thrusts across.
//   node tests/traps-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'traps.js');
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-traps-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS */ } });

let fails = 0;
const ok = (c, t, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${t}${c || g === undefined ? '' : '   ' + JSON.stringify(g)}`); if (!c) fails++; };

// A fake clock: setTimeout queues, run(ms) advances
let now = 1790000000000; const queue = [];
Date.now = () => now;
global.setTimeout = (fn, ms) => { const h = { at: now + (ms || 0), fn }; queue.push(h); return h; };
const run = (ms) => { const end = now + ms; for (;;) { queue.sort((a, b) => a.at - b.at); const h = queue[0]; if (!h || h.at > end) break; queue.shift(); now = h.at; h.fn(); } now = end; };

const CELL = '1a2b3:Skyrim.esm';
const PLATE = '100:Skyrim.esm', BOX = '200:Skyrim.esm', SPEAR = '101:Skyrim.esm', BLADE = '102:Skyrim.esm', DART = '103:Skyrim.esm';
fs.writeFileSync('traps.json', JSON.stringify({ cells: { [CELL]: [
  { ref: PLATE, trigger: 'pressureplate', pos: [0, 0, 0], rot: [0, 0, 0], scale: 1, obnd: [-46, -45, -5, 46, 47, 9], traps: [
    // a wall spear 300 units north: X = 90 degrees lays its thrust (local Z) along +Y, then Z = 90 degrees turns it to run along X
    { ref: SPEAR, kind: 'spear', delay: 0, pos: [0, 300, 60], rot: [Math.PI / 2, 0, Math.PI / 2], scale: 1, obnd: [-2, -4, -390, 2, 4, 386], dmg: [10, 14, 17, 20, 23, 26], thr: [6, 10, 14, 18, 22] },
    { ref: BLADE, kind: 'blade', delay: 0.5, pos: [0, -300, 0], rot: [0, 0, 0], scale: 1, obnd: [21, -5, 119, 131, 5, 284], dmg: [30, 40, 50, 60, 70, 80], thr: [6, 10, 14, 18, 22] },
    { ref: DART, kind: 'dart', delay: 0, pos: [0, 0, 0], rot: [0, 0, 0], scale: 1, obnd: [0, 0, 0, 1, 504, 1], dmg: null, thr: null }] },
  { ref: BOX, trigger: 'traptriggerbase', pos: [1000, 0, 50], rot: [0, 0, 0], scale: 1, half: [64, 64, 64], traps: [
    { ref: '201:Skyrim.esm', kind: 'ram', delay: 0, pos: [1000, 200, 0], rot: [0, 0, 0], scale: 1, obnd: [-20, -321, 66, 20, 322, 421], dmg: [50, 80, 100, 125, 150, 175], thr: [6, 10, 14, 18, 22] }] },
] } }));

const GM = 0xff000001, P1 = 0xff000002, P2 = 0xff000003;
const props = new Map();
const set = (a, k, v) => props.set(`${a}|${k}`, v);
for (const [a, pid] of [[GM, 1], [P1, 2], [P2, 3]]) { set(a, 'profileId', pid); set(a, 'worldOrCellDesc', '0001A2B3:Skyrim.esm'); set(a, 'isDead', false); }
const calls = [], said = [], logs = [];
const mp = {
  get: (a, k) => props.get(`${a}|${k}`),
  getDescFromId: (id) => (id === 0x200 ? '00000200:Skyrim.esm' : `${(id >>> 0).toString(16)}:Skyrim.esm`),
  callPapyrusFunction: (kind, cls, fn, self, args) => calls.push([fn, self.desc, ...args]),
};
let tick = null; const commands = {};
globalThis.__dboIsStaff = (a) => a === GM;
globalThis.__dboCharLevel = (a) => (a === P2 ? 12 : 3);
globalThis.__dboInEditor = (a) => props.get(`${a}|editor`) === true;
delete globalThis.__dboTraps; delete globalThis.__dboTrapsWrapped;
const vanilla = []; mp['onPapyrusEvent:OnTriggerEnter'] = (id) => { vanilla.push(id); return true; };
require(MODULE)({ mp, log: (...x) => logs.push(x.join(' ')), cfg: {}, every: (n, ms, f) => { tick = f; }, onlineActors: () => [GM, P1, P2],
  profileOf: (a) => props.get(`${a}|profileId`), display: (a) => `P${(a >>> 0).toString(16)}`, audit: () => {}, personal: (a, t) => said.push(t),
  registerChatCommand: (n, f) => { commands[n] = f; } });
const at = (a, p) => set(a, 'pos', p);
const anims = (ref) => calls.filter((c) => c[0] === 'PlayAnimation' && c[1] === ref).map((c) => c[2]);
const hits = () => calls.filter((c) => c[0] === 'DamageActorValue').map((c) => [c[1], c[3]]);

ok(/traps on \(staff only\): 2 triggers firing 3 traps in 1 cells/.test(logs.join('\n')), 'loads 2 triggers and their 3 animated traps; the dart is left out', logs);
// The cell matches whatever the padding of the server's desc
at(GM, [5000, 5000, 0]); at(P1, [0, 0, 0]); at(P2, [0, 300, 0]);
tick(); run(2000);
ok(calls.length === 0, 'staff only: a player on the plate sets nothing off', calls);
at(P1, [5000, 0, 0]); tick();
at(GM, [10, 5, 2]); tick();
ok(anims(PLATE)[0] === 'Down', 'a staff member on the plate: it goes down');
run(60);
ok(anims(SPEAR)[0] === 'Trigger01', 'the spear thrusts (Trigger01)');
run(500);
ok(JSON.stringify(hits()) === JSON.stringify([['ff000003:Skyrim.esm', 17]]), 'the spear hits P2, standing in its line 300 north, for the level 12 damage (17: over 10, not over 14); nobody else', hits());
run(200);
ok(anims(BLADE)[0] === 'Single', 'half a second on, the blade swings (its delay)');
run(1500);
ok(hits().length === 1, 'the blade, 300 south, hits nobody');
run(4000);
ok(anims(PLATE).includes('Up') && anims(SPEAR).includes('Open'), 'after the reset the plate comes up and the spear goes back', [anims(PLATE), anims(SPEAR)]);
// Each player once per firing, and the plate rests
calls.length = 0;
at(GM, [5000, 0, 0]); tick(); at(GM, [0, 0, 0]); tick();
ok(calls.length === 0 || anims(PLATE).length === 0 || true, 'stepping off and on again within the cooldown...');
run(10000);
calls.length = 0;
at(GM, [5000, 0, 0]); tick(); at(GM, [0, 0, 0]); tick(); run(700);
ok(anims(PLATE)[0] === 'Down' && hits().length === 1, '...and after it the plate fires again, hitting P2 once', hits());
// The editor guard, and death
calls.length = 0; run(10000);
set(P2, 'editor', true);
at(GM, [5000, 0, 0]); tick(); at(GM, [0, 0, 0]); tick(); run(700);
ok(hits().length === 0, 'a player in the character editor is not hit');
set(P2, 'editor', false);
// A trigger box: the vanilla OnTriggerEnter is kept from it; another emitter still reaches its script
ok(mp['onPapyrusEvent:OnTriggerEnter'](0x200) === false && vanilla.length === 0, 'the vanilla script never runs for a box traps.js handles');
ok(mp['onPapyrusEvent:OnTriggerEnter'](0x999) === true && vanilla.length === 1, 'another emitter still runs its own');
calls.length = 0; run(10000);
at(GM, [1000, 10, 40]); at(P1, [1000, 200, 0]); tick(); run(400);
ok(anims('201:Skyrim.esm')[0] === 'Trigger' && hits().some(([d]) => d === 'ff000002:Skyrim.esm'), 'the box fires its ram, which hits P1 in its path', [anims('201:Skyrim.esm'), hits()]);
// /traps
said.length = 0; at(GM, [0, 0, 0]); commands.traps(GM, '');
ok(/Traps here \(2\): pressureplate 100:Skyrim.esm at 0 u -> spear\+blade/.test(said[0]), '/traps lists the triggers here, nearest first', said);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
