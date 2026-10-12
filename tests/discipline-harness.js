// discipline.js (Nate, 12 Oct 2026): /discipline warn, strike, suspend and lift on an account's record, who may do which,
// the login refusal of a suspended account and the strike review notice. Loads the real module against a fake api.
//   node tests/discipline-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const MOD = path.join(SERVER, 'discipline.js');
const { lengthMs, activeSuspension } = require(MOD);
const CFG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
ok(CFG.discipline && CFG.discipline.enabled === true && CFG.discipline.strikesForReview === 3, 'gamemode-config discipline on, review at 3 strikes');
ok(/__dboRestitutionLogin\(a\);[^\n]*\n\s*try \{ if \(globalThis\.__dboDisciplineLogin\)/.test(gm), 'gamemode.js: login hook, after restitution');
ok(/require\(DISCIPLINE_JS\)/.test(gm) && gm.includes("items: ['kick', 'discipline',"), 'gamemode.js loads it; /adminhelp lists it');
ok(fs.readFileSync(path.join(SERVER, '.gitignore'), 'utf8').includes('discipline.json'), 'records are gitignored');
ok(lengthMs('12h', 30) === 43200000 && lengthMs('3d', 30) === 259200000 && lengthMs('31d', 30) === 0 && lengthMs('x', 30) === 0, 'lengths: 12h, 3d; over the cap or nonsense refused');

const tmp = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-discipline-'));
const FILE = path.join(tmp, 'discipline.json');
// actors: 1 GM (profile 10), 2 Lead GM (11), 3 player (20), 4 the player's alt (20), 5 another GM (12), 6 offline player (21)
const prof = { 1: 10, 2: 11, 3: 20, 4: 20, 5: 12, 6: 21 }, tier = { 1: 'gm', 2: 'leadgm', 5: 'gm' }, tags = { '#AAAA': 3, '#BBBB': 4, '#GMGM': 5, '#OFFL': 6, '#LEAD': 2 };
let online = [1, 2, 3, 5];
const said = [], audits = [], packets = [], kicked = [];
let cmd = null, tick = null;
const realTimeout = global.setTimeout; global.setTimeout = (fn) => fn();
const load = () => {
  delete require.cache[MOD];
  require(MOD)({
    mp: { kick: (u) => kicked.push(u) }, log: () => {}, personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t),
    who: (a) => `w${a}`, display: (a) => `c${a}`, profileOf: (a) => prof[a], onlineActors: () => online.slice(),
    registerChatCommand: (n, fn) => { if (n === 'discipline') cmd = fn; }, isAdmin: (a) => !!tier[a], isLeadStaff: (a) => !!tier[a] && tier[a] !== 'gm',
    findAnyByName: (q) => tags[q] || 0, sendPacket: (a, p) => packets.push([a, p]), userOf: (a) => a + 100, every: (n, ms, fn) => { tick = fn; },
    cfg: { discipline: Object.assign({}, CFG.discipline, { file: FILE }) }
  });
};
load();
const last = (a) => (said.filter((s) => s[0] === a).pop() || [])[1] || '';
cmd(3, '#AAAA warn spamming'); ok(/Only staff/.test(last(3)), 'a player cannot use it');
cmd(1, '#AAAA warn hi'); ok(/Give a reason/.test(last(1)), 'a reason is required');
cmd(1, '#AAAA warn spamming the market chat'); ok(/Recorded: warn #1/.test(last(1)) && /A warning from staff: spamming/.test(last(3)), 'a GM warns; the player is told at once');
cmd(1, '#GMGM strike abuse'); ok(/Only a Lead GM/.test(last(1)), 'a GM cannot discipline another GM');
cmd(1, '#AAAA suspend 3d theft'); ok(/Suspensions are for Lead GMs/.test(last(1)), 'a GM cannot suspend');
cmd(1, '#AAAA strike griefing one'); cmd(1, '#AAAA strike griefing two'); cmd(1, '#AAAA strike griefing three');
ok(/3 strikes in 90 days/.test(last(1)) && audits.some((l) => /a Lead GM should review/.test(l)), 'the third strike asks for a Lead GM review');
cmd(2, '#BBBB suspend 2d stole from a barrel'); 
ok(kicked.includes(103) && packets.some(([a, p]) => a === 3 && p.customPacketType === 'kicked' && /suspended until/.test(p.reason)), 'a Lead GM suspends the alt: the same account (online on another character) is logged out with the reason');
ok(audits.some((l) => /^DISCIPLINE suspend #5 on w4 \(profile 20\) until .* by w2: stole from a barrel$/.test(l)), 'the suspension is audited with who and why', audits);
kicked.length = 0; globalThis.__dboDisciplineLogin(4); ok(kicked.includes(104), 'a suspended account is refused at login');
cmd(6 - 4, '#OFFL warn rude in OOC chat'); ok(/told at their next login/.test(last(2)), 'an offline player is told later');
online.push(6); globalThis.__dboDisciplineLogin(6); ok(/A warning from staff: rude/.test(last(6)), 'and is shown it at login');
said.length = 0; globalThis.__dboDisciplineLogin(6); ok(!said.length, 'once only');
cmd(1, '#AAAA'); ok(said.some(([a, t]) => a === 1 && /5 entries, 3 strike\(s\) in 90 days, suspended until/.test(t)), 'staff read the record');
cmd(1, 'list'); ok(/profile 20 c4: until/.test(last(1)), 'list shows the running suspension');
cmd(2, '#AAAA lift appeal accepted'); kicked.length = 0; globalThis.__dboDisciplineLogin(3);
ok(!kicked.length && /suspension was lifted/.test(last(3)), 'lift ends it; the player is told');
cmd(2, '#LEAD warn myself'); ok(/your own account/.test(last(2)), 'nobody disciplines their own account');
// reload keeps the records
load(); cmd(1, '#AAAA'); ok(said.some(([a, t]) => a === 1 && /6 entries/.test(t)), 'records survive a reload');
const rec = JSON.parse(fs.readFileSync(FILE, 'utf8')).profiles['20'];
ok(rec.length === 6 && rec[4].lifted === true && rec[4].by === 'c2', 'the file holds the account record', rec.map((e) => e.kind));
// a strike decided outside the game, from config, added once by key
said.length = 0; audits.length = 0;
const cfgRecord = [{ key: 'k1', tag: 'OFFL', kind: 'strike', by: 'Nate', reason: 'took goods from a barrel' }];
const loadWith = (record) => { delete require.cache[MOD]; const realCfg = CFG.discipline; CFG.discipline = Object.assign({}, realCfg, { record }); require(MOD)({
  mp: { kick: () => {} }, log: () => {}, personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), who: (a) => `w${a}`, display: (a) => `c${a}`,
  profileOf: (a) => prof[a], onlineActors: () => online.slice(), registerChatCommand: () => {}, isAdmin: (a) => !!tier[a], isLeadStaff: () => false,
  findAnyByName: (q) => tags[q] || 0, sendPacket: () => {}, userOf: () => -1, every: () => {}, cfg: { discipline: Object.assign({}, CFG.discipline, { file: FILE }) } }); CFG.discipline = realCfg; };
loadWith(cfgRecord); loadWith(cfgRecord);
const r21 = JSON.parse(fs.readFileSync(FILE, 'utf8')).profiles['21'];
ok(r21.filter((e) => e.key === 'k1').length === 1 && r21.find((e) => e.key === 'k1').by === 'Nate' && r21.find((e) => e.key === 'k1').kind === 'strike', 'a config strike is added once, by Nate, across reloads', r21);
ok(audits.filter((l) => /config k1/.test(l)).length === 1 && said.some(([a, t]) => a === 6 && /A strike from staff: took goods/.test(t)), 'audited once; the player, online, is told');
// Ticket #0141 (12 Oct): Lady Dyer's 0138 strike is taken off; a listed record is re-given at load, so it must stay unlisted
const shipped = (CFG.discipline.record || []).find((r) => r.key === '0138-dyer');
ok(!shipped, 'shipped: no 0138-dyer record (overturned by ticket #0141)');
global.setTimeout = realTimeout;
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
