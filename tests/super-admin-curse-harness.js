// The F7 panel's Curse row (supernatural.js __dboSuperAdminCurse, adminSystem.ts giveCurse; Nate, 18 Oct) and /curse ... stage:
// staff make a vampire, a pure-blood, a werewolf or a Hircine-blessed one, cure, or set a vampire's thirst stage 1-4, which
// the slow tick then keeps. Real supernatural.js on a stub api.
//   node tests/super-admin-curse-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(process.env.SUPER_SERVER || path.join(__dirname, '..'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-admincurse-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left */ } });
fs.copyFileSync(path.join(SERVER, 'skills.json'), 'skills.json');
fs.writeFileSync('supernatural.json', JSON.stringify({ crown: null, revoke: [] }));

const GM = 0xff000014, B = 0xff000015;
const store = new Map(), said = [], audits = [], cmds = {};
let admin = true;
globalThis.__dboClock = { gameDays: () => 100, sendTo: () => {}, summary: () => ({ timeScale: 6 }) };
global.setTimeout = () => 0;
const mp = {
  get: (id, p) => (p === 'type' ? 'MpActor' : store.get(`${id >>> 0}|${p}`)), set: (id, p, v) => store.set(`${id >>> 0}|${p}`, v),
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:x`, getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) || 0x123,
  callPapyrusFunction: () => null, lookupEspmRecordById: () => null,
};
delete globalThis.__dboSuperState;
require(path.join(SERVER, 'supernatural.js'))({
  mp, log: () => {}, audit: (t) => audits.push(t), personal: (a, t) => said.push([a, t]), registerChatCommand: (n, fn, o) => { cmds[n] = { fn, o }; },
  onUi: () => {}, openWidget: () => {}, closeWidget: () => {}, sendPacket: () => {}, display: (a) => (a === GM ? 'Nate' : 'Bob'), who: (a) => (a === GM ? 'Nate' : 'Bob'),
  isAdmin: (a) => admin && a === GM, findByName: (n) => (/^bob$/i.test(n) ? B : 0), onlineActors: () => [GM, B], every: () => {}, profileOf: () => 1, nameOf: String,
  isWorldspace: () => true, needsFeed: () => {}, hungerOf: () => 0, cfg: {},
});
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const st = (a) => store.get(`${a}|private.supernatural`) || {};
const curse = globalThis.__dboSuperAdminCurse;
ok(typeof curse === 'function', 'the panel hook is there');
let r = curse(B, 'purevampire', 0, 'Nate');
ok(st(B).kind === 'vampire' && st(B).pure === true && st(B).stage === 1 && /pure-blood vampire/.test(r), 'a pure-blood vampire', r);
ok(audits.some((t) => /SUPERNATURAL GM Nate made Bob purevampire/.test(t)), '...audited');
r = curse(B, 'stage', 3, 'Nate');
ok(st(B).stage === 3 && !st(B).unfed && /stage 3 vampire/.test(r), 'set to stage 3', r);
// The slow tick reads the stage back from lastFed: same day, same stage (the game clock stub stays at day 100)
const day = 100, rate = 1;
ok(Math.min(4, 1 + Math.floor(Math.max(0, day - st(B).lastFed) * rate)) === 3, '...and the thirst clock agrees, so the next tick keeps it', st(B).lastFed);
r = curse(B, 'stage', 1, 'Nate');
ok(st(B).stage === 1 && Math.min(4, 1 + Math.floor((day - st(B).lastFed) * rate)) === 1, 'back to stage 1', r);
ok(/stage is 1 to 4/.test(curse(B, 'stage', 5, 'Nate')) && st(B).stage === 1, 'a stage outside 1-4 is refused');
r = curse(B, 'cure', 0, 'Nate');
ok(!st(B).kind && /mortal again/.test(r), 'cure', r);
ok(/is not a vampire/.test(curse(B, 'stage', 2, 'Nate')), 'a stage on a mortal is refused');
r = curse(B, 'blessedwerewolf', 0, 'Nate');
ok(st(B).kind === 'werewolf' && st(B).blessed === true && /Hircine-blessed werewolf/.test(r), 'a Hircine-blessed werewolf', r);
r = curse(B, 'werewolf', 0, 'Nate');
ok(st(B).kind === 'werewolf' && !st(B).blessed, 'a plain werewolf (replacing the blessed one)', st(B));
r = curse(B, 'vampire', 0, 'Nate');
ok(st(B).kind === 'vampire' && !st(B).pure && st(B).unfed, 'a vampire from the fever path (unfed until the first meal)', st(B));
ok(/no ghoul curse/.test(curse(B, 'ghoul', 0, 'Nate')), 'an unknown curse is refused');
said.length = 0; cmds.curse.fn(GM, 'bob stage 4');
ok(st(B).stage === 4 && said.some(([, t]) => /stage 4 vampire/.test(t)), '/curse bob stage 4 does the same in chat', said);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
