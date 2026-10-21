// High Gate Ruins' lever puzzle (leverpuzzles.js, Nate 21 Oct: the puzzle door blocked the way to Vokun). Loads the real
// module with a fake mp: the vanilla rules (Eagle first; Whale after Eagle; Fox before Snake; Snake opens), a wrong pull
// springs back, the last sign opens the trapdoor copy, the lease end resets it, and the engine is kept from the levers.
//   node tests/leverpuzzles-harness.js   (from server/)
'use strict';
const path = require('path');
let fails = 0;
const ok = (c, t, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${t}${c || g === undefined ? '' : '   ' + JSON.stringify(g)}`); if (!c) fails++; };
const timers = []; global.setTimeout = (fn) => { timers.push(fn); return 0; };
const flush = () => { while (timers.length) timers.shift()(); };
const ID = { '50f7b:Skyrim.esm': 0x50f7b, '50f72:Skyrim.esm': 0x50f72, '41c97:Skyrim.esm': 0x41c97, '41c95:Skyrim.esm': 0x41c95, '1d201d:DragonBreak Online Edits.esp': 0x491d201d };
const EAGLE = 0x50f7b, FOX = 0x50f72, WHALE = 0x41c97, SNAKE = 0x41c95, DOOR = 0x491d201d, P = 0xff000010, GM = 0xff000001;
const props = new Map(), anims = [], said = [], audits = [], cmds = {};
const mp = {
  getIdFromDesc: (d) => { if (!(d in ID)) throw new Error('no form'); return ID[d]; },
  set: (id, k, v) => props.set(`${id}|${k}`, v),
  callPapyrusFunction: (kind, cls, fn, self, args) => anims.push([self.desc.split(':')[0], args[0]]),
};
globalThis.__dboIsStaff = (a) => a === GM;
delete globalThis.__dboLeverPuzzles;
require(path.resolve(__dirname, '..', 'leverpuzzles.js'))({ mp, log: () => {}, cfg: {}, personal: (a, t) => said.push(t), audit: (t) => audits.push(t), who: String,
  registerChatCommand: (n, f, o) => { cmds[n] = { f, o }; } });
const pull = (id) => globalThis.__dboLeverPuzzle(id, P);
const open = () => props.get(`${DOOR}|isOpen`) === true;

ok(pull(0x12345) === false, 'another activator is not ours');
ok(pull(SNAKE) === true && !open(), 'Snake first: wrong (Fox is not lit); the engine is kept off the lever');
flush(); ok(anims.slice(-2).join() === '41c95,FullPush,41c95,FullPull', 'a wrong pull goes down and springs back up', anims);
pull(WHALE); ok(/springs back/.test(said.at(-1)), 'Whale before Eagle: wrong');
pull(EAGLE); ok(/locks down/.test(said.at(-1)), 'Eagle with nothing lit: right');
pull(EAGLE); ok(said.at(-1) === 'The lever is locked down.', 'a lit lever stays down');
pull(WHALE); ok(/locks down/.test(said.at(-1)), 'Whale after Eagle: right');
flush(); anims.length = 0; pull(FOX); flush(); ok(/locks down/.test(said.at(-1)) && !anims.some((x) => x[1] === 'FullPull'), 'Fox: right, and it stays down');
pull(SNAKE); ok(open() && /floor gives way/.test(said.at(-1)) && /solved High Gate Ruins/.test(audits.at(-1)), 'Snake after Fox: the trapdoor opens (players\' order on 21 Oct: Eagle, Whale, Fox, Snake)');
anims.length = 0; globalThis.__dboLeverPuzzleLeaseEnded('SomewhereElse'); ok(open() && !anims.length, 'another dungeon\'s lease ending changes nothing');
globalThis.__dboLeverPuzzleLeaseEnded('HighGateRuinsLocation');
ok(!open() && anims.filter((x) => x[1] === 'FullPull').length === 4, 'the lease ending shuts the trapdoor and brings the four levers up');
// Vanilla also allows Fox before Eagle, and leaves Whale out
pull(FOX); pull(EAGLE); pull(SNAKE); ok(open(), 'Fox, Eagle, Snake also opens it, as the vanilla script allows');
globalThis.__dboLeverPuzzleLeaseEnded('HighGateRuinsLocation');
pull(FOX); pull(SNAKE); ok(open(), 'Fox then Snake opens it too: the vanilla Snake lever checks only the Fox flame');
// /leverpuzzle, staff only
globalThis.__dboLeverPuzzleLeaseEnded('HighGateRuinsLocation');
ok(cmds.leverpuzzle && cmds.leverpuzzle.o.admin === true, '/leverpuzzle is an admin command');
cmds.leverpuzzle.f(P, 'open HighGateRuins'); ok(!open() && said.at(-1) === 'Staff only.', 'a player cannot use it');
cmds.leverpuzzle.f(GM, 'open highgateruins'); ok(open() && /door is open/.test(said.at(-1)), 'staff open the trapdoor');
pull(SNAKE); ok(said.at(-1) === 'The lever is locked down.', '...and the levers count as pulled');
cmds.leverpuzzle.f(GM, 'reset HighGateRuins'); ok(!open(), 'staff reset it');
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
