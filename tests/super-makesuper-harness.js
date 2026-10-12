// /makesuper (supernatural.js, Nate 12 Oct): staff give the whole curse at once, a vampire or a werewolf (optionally
// pure-blood or Hircine-blessed), on themselves by default or on a named player; never over another curse or a fever, and
// never for a player who is not staff. Real supernatural.js on a stub api.
//   node tests/super-makesuper-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(process.env.SUPER_SERVER || path.join(__dirname, '..'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-makesuper-'));
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
const run = (a, args) => { said.length = 0; cmds.makesuper.fn(a, args); return said.map((x) => x[1]).join(' | '); };

ok(cmds.makesuper && cmds.makesuper.o.admin === true, '/makesuper is registered as a staff command');
let r = run(GM, 'vampire');
ok(st(GM).kind === 'vampire' && !st(GM).disease && st(GM).stage === 1 && !st(GM).pure && /Nate is now a vampire/.test(r), 'on yourself: a vampire at stage 1, no fever in between', r);
ok(audits.some((t) => /SUPERNATURAL Nate made a vampire by GM Nate/.test(t)), '...audited with the GM');
r = run(GM, 'werewolf');
ok(st(GM).kind === 'vampire' && /Lift that curse first/.test(r), 'the other curse is refused while one is held', r);
r = run(GM, 'vampire');
ok(/already a vampire/.test(r), 'the same curse again says so', r);
r = run(GM, 'werewolf blessed bob');
ok(st(B).kind === 'werewolf' && st(B).blessed === true && /Bob is now a Hircine-blessed werewolf/.test(r), 'on a named player, Hircine-blessed', r);
store.set(`${B}|private.supernatural`, { kind: null, disease: { kind: 'vampire', at: 1 } });
r = run(GM, 'vampire bob');
ok(!st(B).kind && /carries a fever/.test(r), 'a player with a fever is refused', r);
r = run(GM, 'vampire nobody here');
ok(/No player online called nobody here/.test(r), 'an unknown name is said so', r);
r = run(GM, 'ghoul');
ok(/Usage/.test(r), 'anything but vampire or werewolf shows the usage', r);
admin = false;
store.delete(`${B}|private.supernatural`);
r = run(B, 'vampire');
ok(!st(B).kind && r === '', 'a player who is not staff gets nothing', r);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
