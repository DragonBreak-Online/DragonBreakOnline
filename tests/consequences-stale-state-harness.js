// consequences.js loaded over a state an older version of it cached (live, 1 Nov: phase 2 was hot-deployed into a process
// whose state phase 1 had read, with no p2): the notice boards, the phase 2 sample and the court's stamps must work, not
// throw "Cannot read properties of undefined (reading 'writs' / 'court')" 818 and 137 times a day, and a court stamp that
// fails anyway must never throw into the action that called it (an appointment, a dismissal, a wage). Mutants of a copy
// of consequences.js are run through this same file and must fail.
//   node tests/consequences-stale-state-harness.js [consequences.js to test]   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const MODULE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'consequences.js'));
const scratch = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-conseq-stale-'));
process.chdir(scratch);
process.on('exit', () => { process.chdir(os.tmpdir()); try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* the OS */ } });

const WR = 'whiterun';
const HUNTER = 0xff000001, JARL = 0xff000004;
fs.writeFileSync('zones.json', JSON.stringify({ holds: [{ id: WR, name: 'Whiterun', officials: ['jarl', 'steward'] }], regions: [] }));
fs.writeFileSync('housing.json', '[]');
const mp = { get: () => undefined, getIdFromDesc: (d) => parseInt(String(d), 16) >>> 0, lookupEspmRecordById: () => null };
const logs = [], said = [], cmds = {}, timers = {};
const api = {
  mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push([a, t]), registerChatCommand: (n, f) => { cmds[n] = f; },
  onlineActors: () => [HUNTER], every: (name, ms, fn) => { timers[name] = fn; }, profileOf: (a) => (a === JARL ? 4 : 1),
  zoneOfActor: () => WR, isAdmin: () => true, cfg: { consequences: {} }, audit: () => {}, giveItem: () => {}, readOfficials: () => ({ [WR]: { jarl: [4] } }),
};
globalThis.__dboGuildsOf = (a) => (a === HUNTER ? [{ id: 'dawnguard' }] : []);
globalThis.__dboGuildInfo = (id) => ({ id, name: id });
globalThis.__dboHoldFactionOf = (z) => (z === WR ? 'hold-whiterun' : null);
globalThis.__dboSeatHolder = () => 0;
globalThis.__dboCitizenCourtNotice = () => {};
globalThis.__dboCitizenNoConfidence = () => ({ error: 'no election' });

let fails = 0;
const ok = (c, what, detail) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && detail !== undefined ? '   ' + JSON.stringify(detail).slice(0, 300) : ''}`); if (!c) fails++; };
const threw = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

// The state as phase 1 left it in the live process: holds and kills, no p2, cached on globalThis before this file loads
globalThis.__dboConsequences = { data: { holds: { [WR]: { blight: { p: 70, stage: 2, feed: 0, oppose: 0 } } }, kills: { day: '', by: {} } }, homes: null, homesAt: 0, edid: new Map(), deeds: new Map() };
delete require.cache[MODULE];
require(MODULE)(api);

let e = threw(() => globalThis.__dboConsequenceBoardLines(WR));
ok(e === null, 'the notice boards read a stale state without throwing', e);
e = threw(() => timers.consequences());
ok(e === null && !logs.some((l) => /failed this sample/.test(l)), 'the phase 2 sample runs over a stale state', logs.filter((l) => /failed/.test(l)));
ok(globalThis.__dboConsequences.data.p2 && globalThis.__dboConsequences.data.p2.writs[WR] && globalThis.__dboConsequences.data.p2.writs[WR].blight > 0,
  '...and does its work: the Blight at 70 opens a writ in Whiterun', globalThis.__dboConsequences.data.p2);
ok(globalThis.__dboConsequenceBoardLines(WR).some((t) => /open writ in Whiterun against the vampires/.test(t)), '...which the boards then carry', globalThis.__dboConsequenceBoardLines(WR));
e = threw(() => globalThis.__dboCourtBusiness(WR, 'appointment'));
ok(e === null && globalThis.__dboConsequences.data.p2.court[WR] > 0, 'an appointment stamps the court\'s business over a stale state', e);
e = threw(() => globalThis.__dboCourtBusinessFaction('hold-whiterun', 'wage'));
ok(e === null, 'a wage set by the hold\'s faction stamps without throwing', e);

// A stamp that fails for any other reason is logged, never thrown into the court action that already succeeded
Object.freeze(globalThis.__dboConsequences.data.p2.court);
e = threw(() => globalThis.__dboCourtBusiness(WR, 'dismissal'));
ok(e === null && logs.some((l) => /consequences: court stamp failed/.test(l)), 'a failing court stamp is logged, not thrown into the caller', e);

// ---- mutants: altered copies run through this file, each must print a FAIL or stop ----
if (!process.env.DBO_MUTANT_RUN) {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'consequences.js'), 'utf8').replace(/\r\n/g, '\n');
  const MUTANTS = [
    ['the shape is made good only on a fresh read (the live bug)', '    if (!S.data) {\n      try {', '    if (S.data) return S.data;\n    if (!S.data) {\n      try {'],
    ['a failing stamp throws into the caller', "    } catch (e) { log('consequences: court stamp failed', e.message); }", "    } catch (e) { throw e; }"],
  ];
  for (const [name, from, to] of MUTANTS) {
    if (!SRC.includes(from)) { ok(false, `mutant "${name}": its line is still in consequences.js`, from); continue; }
    const f = path.join(path.dirname(MODULE) === path.resolve(__dirname, '..') ? scratch : scratch, 'consequences-mutant.js');
    fs.writeFileSync(f, SRC.replace(from, to));
    let out = '';
    try { out = execFileSync(process.execPath, [__filename, f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { DBO_MUTANT_RUN: '1' }) }); } catch (x) { out = String(x.stdout || '') + 'FAIL crashed'; }
    ok(/^FAIL/m.test(out), `mutant caught: ${name}`);
  }
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
