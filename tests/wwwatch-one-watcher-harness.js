// One watcher's drops count once toward the beast body breaker (server\beastform.js). 16 Oct: Hides-In-Plain-Sight #65ZZ
// dropped near Purr #7DJT's werewolf at 23:55:52 (5677 units away, 20 s near) and again at 00:00:47 (5958 units, back for one
// tick), and those two drops alone tripped the breaker: her body was off for every watcher until 00:10:47, so everyone saw
// a naked Khajiit ("im seen as a naked khajit again", 00:05:14; GMCALL #112 00:05:53). This replays it on a fake clock: the
// same watcher twice does not trip, a second watcher then does, and the trip names both.
//   node tests/wwwatch-one-watcher-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const BEASTFORM = path.resolve(__dirname, '..', 'beastform.js');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wwwatch-one-'));
process.chdir(scratch);
process.on('exit', () => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

const PURR = 0x20, HIDES = 0x21, OTHER = 0x22;
const KHAJIIT = 0x13745, WEREWOLF_RACE = 0xcdd84;
const CELL = 'a764b:BSHeartland.esm';
let clock = Date.UTC(2026, 9, 15, 23, 42, 29);
Date.now = () => clock;
const props = new Map(), timers = new Map(), commands = new Map();
const online = new Set([PURR, HIDES, OTHER]);
const logs = [], packets = [];
require(BEASTFORM)({
  mp: {
    getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
    getDescFromId: (id) => `${id.toString(16)}:x`,
    get: (id, p) => props.get(id + '|' + p),
    set: (id, p, v) => props.set(id + '|' + p, v),
    callPapyrusFunction: () => undefined,
    lookupEspmRecordById: () => null,
  },
  log: (...a) => logs.push(a.join(' ')), personal: () => {}, audit: () => {},
  display: (a) => `P${a.toString(16)}`, who: (a) => `P${a.toString(16)}`, sendPacket: (a, p) => { packets.push({ a, p }); return true; },
  registerChatCommand: (n, fn) => commands.set(n, fn), onlineActors: () => [...online],
  every: (n, ms, fn) => timers.set(n, fn), findByName: () => 0, redress: () => undefined,
  isAdmin: () => false, cfg: { beastform: { werewolfRemoteRace: true } }, hasUiCap: (a, c) => c === 'beastBody',
});

let fail = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fail++; };
const place = (a, pos) => { props.set(a + '|worldOrCellDesc', CELL); props.set(a + '|pos', pos); };
const step = (n, f) => { for (let i = 0; i < n; i++) { clock += 1000; if (f) f(i); timers.get('beastForms')(); } };
const wwwatch = () => logs.filter((l) => /^wwwatch:/.test(l));
const lastWw = () => wwwatch().slice(-1)[0] || '';
const drop = (a) => { const r = globalThis.__dboVlBreakerDrop(a, false); online.delete(a); return r; };
const listedTo = (v) => { const l = packets.filter((x) => x.a === v && x.p.customPacketType === 'dboBeastBody').pop(); return !!l && l.p.bodies.some((b) => b.id === PURR && b.race === WEREWOLF_RACE); };
const tripped = () => !!props.get(PURR + '|private.wwBodyOff');

const POS = [48336, 216854, 7333];
place(PURR, POS);
place(HIDES, [POS[0] + 5677, POS[1], POS[2]]);
place(OTHER, [POS[0] + 900, POS[1], POS[2]]);
props.set(PURR + '|isDead', false);
props.set(PURR + '|inventory', { entries: [] });
props.set(PURR + '|appearance', { raceId: KHAJIIT, name: 'Purr', headpartIds: [1], tints: [], options: [], presets: [] });
ok(globalThis.__dboBeastTransform(PURR, 'werewolf', true) === true, 'Purr takes the werewolf form');
ok(listedTo(HIDES) && listedTo(OTHER), 'both watchers are sent her werewolf body');

// 23:55:52: the first drop, 20 s near, shown the body
step(20);
drop(HIDES);
ok(/^wwwatch: P21 dropped near P20, drop 1 of 2 in 600 s/.test(lastWw()), 'the first drop is drop 1 of 2', lastWw());

// back after a few minutes, near for one tick at 5958 units, then the second drop (00:00:47)
step(60);
online.add(HIDES); place(HIDES, [POS[0] + 5958, POS[1], POS[2]]);
step(1);
drop(HIDES);
ok(!tripped(), 'the same watcher\'s second drop inside the window does not turn her body off', lastWw());
ok(/^wwwatch: P21 dropped near P20, drop 1 of 2 in 600 s \(the same watcher again, counted once\): /.test(lastWw()), '...and is logged as the same watcher counted once', lastWw());
ok(globalThis.__dboBeastBodyShown(PURR) && listedTo(OTHER), 'every other watcher keeps seeing the werewolf (no naked Khajiit)');

// a different watcher dropping beside her inside the window is the second piece of evidence
step(15);
drop(OTHER);
ok(tripped() && /^wwwatch: tripped for P20 at a764b:BSHeartland\.esm by 2 drops \(P21, P22\)/.test(lastWw()), 'a second watcher\'s drop trips it, naming both', lastWw());
const off = props.get(PURR + '|private.wwBodyOff');
ok(off && off.drops.join() === 'P21,P22', 'the trip records the two different watchers', off);

console.log(fail ? `\n${fail} FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
