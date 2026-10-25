// discipline.js, a suspension decided outside the game (ticket rep-0305, Jake 21 Oct 2026: a 38 hour temporary ban on an
// account and both of its owner's Discord accounts, one of which has never played). The config record takes
// { key, profile and/or tag, kind: 'suspend', from, until or length, reason, by }, added once by key with its end fixed
// whenever the reload runs, and { key, kind: 'lift', of } to end it early. Discord accounts listed under the key in the
// root-only discipline-discord.json are refused too, a Discord account with no profile included. Every Discord id here is
// a fake, and the harness checks that none of them reaches a log, an audit line, a player message or discipline.json.
// Loads the real module against a fake api.
//   node tests/discipline-record-suspend-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const MOD = path.join(SERVER, 'discipline.js');
const CFG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
const H = 3600000;
const iso = (ms) => new Date(ms).toISOString();

// ---- the end time, pure ----------------------------------------------------------------------------------------------
const { configWindow } = require(MOD);
const cw = typeof configWindow === 'function' ? configWindow : () => ({ error: 'configWindow is not exported' });
const T0 = Date.parse('2026-10-21T15:00:00Z');
let w = cw({ from: '2026-10-21T15:00:00Z', until: '2026-10-23T05:00:00Z' }, 30, T0 + 5 * H);
ok(w.from === T0 && w.until === T0 + 38 * H, 'from + until: a fixed 38 hour window, whatever the time it is read', w);
w = cw({ from: '2026-10-21T15:00:00Z', length: '38h' }, 30, T0 + 7 * H);
ok(w.until === T0 + 38 * H, 'from + length: the end counts from "from", not from the reload', w);
ok(cw({ from: '2026-10-21T15:00:00Z', length: '38h', until: '2026-10-23T05:00:00Z' }, 30, T0).until === T0 + 38 * H, 'from + length + until that agree');
ok(/disagree/.test(cw({ from: '2026-10-21T15:00:00Z', length: '38h', until: '2026-10-23T09:00:00Z' }, 30, T0).error || ''), 'from + length + until that disagree are refused');
ok(/needs its from/.test(cw({ length: '38h' }, 30, T0).error || ''), 'a length without its from is refused (its end would move with the reload)');
ok(/not 1h to 30d/.test(cw({ from: '2026-10-21T15:00:00Z', length: '31d' }, 30, T0).error || ''), 'a length over maxSuspendDays is refused');
ok(/longer than 30 days/.test(cw({ from: '2026-10-01T00:00:00Z', until: '2026-11-15T00:00:00Z' }, 30, T0).error || ''), 'an until over maxSuspendDays after from is refused');
ok(/longer than 30 days/.test(cw({ until: iso(T0 + 31 * 24 * H) }, 30, T0).error || ''), 'an until alone counts from now, and over the cap is refused');
ok(cw({ until: iso(T0 + 38 * H) }, 30, T0).until === T0 + 38 * H, 'an until alone is accepted');
ok(/not after from/.test(cw({ from: '2026-10-23T05:00:00Z', until: '2026-10-21T15:00:00Z' }, 30, T0).error || ''), 'an until before from is refused');
ok(/not a date/.test(cw({ from: 'tomorrow', until: '2026-10-23T05:00:00Z' }, 30, T0).error || '') && /give until/.test(cw({ from: '2026-10-21T15:00:00Z' }, 30, T0).error || ''), 'nonsense and a missing end are refused');

// ---- the module against a fake api -----------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-jake-tempban-0305-'));
const FILE = path.join(tmp, 'discipline.json');
const DFILE = path.join(tmp, 'discipline-discord.json');
// Fake Discord ids (never real ones): A plays on profile 20, B is a second Discord account that made profile 40 on its
// first login, C is someone else (profile 41)
const ID_A = '111111111111111111', ID_B = '222222222222222222', ID_C = '333333333333333333';
const FAKE_IDS = [ID_A, ID_B, ID_C];
// actors: 2 Lead GM (profile 11), 3 player (20, Discord A), 4 their alt character (20), 6 offline player (21),
// 8 B's first character (40, Discord B), 9 another player (41, Discord C)
const prof = { 2: 11, 3: 20, 4: 20, 6: 21, 8: 40, 9: 41 }, tier = { 2: 'leadgm' }, tags = { '#AAAA': 3, '#BBBB': 4, '#OFFL': 6, '#NEWB': 8, '#LEAD': 2 };
const discord = { 3: ID_A, 4: ID_A, 8: ID_B, 9: ID_C };
let online = [2, 3, 9];
const said = [], audits = [], packets = [], kicked = [], logs = [];
const ever = []; // everything a person could read, never reset
let cmd = null, tick = null;
const realTimeout = global.setTimeout; global.setTimeout = (fn) => fn();
const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;
const load = (record, extra) => {
  delete require.cache[MOD];
  cmd = null; tick = null;
  require(MOD)({
    mp: { kick: (u) => kicked.push(u), get: (a, k) => (k === 'private.skympDiscordId' || k === 'private.indexed.discordId' ? discord[a] : undefined) },
    log: (...a) => { logs.push(a.join(' ')); ever.push(a.join(' ')); }, personal: (a, t) => { said.push([a, t]); ever.push(t); }, audit: (t) => { audits.push(t); ever.push(t); },
    who: (a) => `w${a}`, display: (a) => `c${a}`, profileOf: (a) => prof[a], onlineActors: () => online.slice(),
    registerChatCommand: (n, fn) => { if (n === 'discipline') cmd = fn; }, isAdmin: (a) => !!tier[a], isLeadStaff: (a) => !!tier[a] && tier[a] !== 'gm',
    findAnyByName: (q) => tags[q] || 0, sendPacket: (a, p) => { packets.push([a, p]); ever.push(JSON.stringify(p)); }, userOf: (a) => a + 100, every: (n, ms, fn) => { tick = fn; },
    cfg: { discipline: Object.assign({}, CFG.discipline, { file: FILE, record }, extra) }
  });
};
const fileText = () => (fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '{}');
const recOf = (p) => ((JSON.parse(fileText()).profiles || {})[p] || []);
const reset = () => { said.length = 0; audits.length = 0; packets.length = 0; kicked.length = 0; logs.length = 0; };
const login = (a) => globalThis.__dboDisciplineLogin(a) === true;
const voice = (a) => (typeof globalThis.__dboVoiceRefused === 'function' ? globalThis.__dboVoiceRefused(a) : 'no hook');

const from = iso(clock - H), until = iso(clock + 37 * H);
const SUSP = { key: 'rep-test', profile: 20, tag: 'AAAA', kind: 'suspend', from, until, reason: 'Temporary ban, report rep-test', by: 'Jake' };

// 1. Added from config while the player is online: logged out at once, audited, told why
load([SUSP]);
let r20 = recOf(20);
const s = r20.find((e) => e.key === 'rep-test');
ok(s && s.kind === 'suspend' && s.until === Date.parse(until) && s.from === Date.parse(from) && s.by === 'Jake' && s.char === 'c3', 'a config suspension is on the account record with its fixed window', s);
ok(kicked.includes(103) && packets.some(([a, p]) => a === 3 && p.customPacketType === 'kicked' && /suspended until .* Reason: Temporary ban, report rep-test/.test(p.reason)), 'the player, online, is logged out at once with the reason', packets);
ok(audits.some((l) => /^DISCIPLINE suspend #1 on w3 \(profile 20\) from .* until .* by Jake \(config rep-test\): Temporary ban, report rep-test$/.test(l)), 'the usual audit line, with who decided it and the key', audits);
ok(!kicked.includes(109) && !kicked.includes(102), 'nobody else is logged out', kicked);

// 2. Added once, and the end stays where it was, whatever the reload time
clock += 2 * H; reset();
load([SUSP]); load([SUSP]);
r20 = recOf(20);
ok(r20.filter((e) => e.key === 'rep-test').length === 1 && r20.find((e) => e.key === 'rep-test').until === Date.parse(until), 'added once by key across reloads; the end does not move', r20.map((e) => [e.key, e.until]));
ok(!audits.some((l) => /config rep-test/.test(l)), 'a reload audits nothing new', audits);

// 3. Refused at login on every character of the account, no voice; the 30 s check catches an online one
reset();
ok(login(4) && kicked.includes(104), 'refused at login on another character of the account');
ok(audits.some((l) => /^DISCIPLINE refused w4: suspended until .* \(#1\)$/.test(l)), 'the refusal is audited', audits);
ok(voice(3) === 'suspended' && voice(4) === 'suspended' && voice(9) === '', 'no voice for the account, voice for others', [voice(3), voice(4), voice(9)]);
online = [2, 3, 9]; kicked.length = 0; tick && tick();
ok(kicked.includes(103) && !kicked.includes(109), 'the 30 s check logs out a character of the account that slipped in', kicked);

// 4. The end: free at until, not a minute before
reset(); clock = Date.parse(until) - 60000;
ok(login(3), 'a minute before the end: still refused');
clock = Date.parse(until) + 1; kicked.length = 0;
ok(!login(3) && !kicked.length && voice(3) === '', 'after the end: logs in, voice back');
clock = Date.parse(until) - 36 * H;

// 5. Entries that must be refused, with a reason in the log and nothing on record
fs.rmSync(FILE, { force: true }); reset();
load([
  Object.assign({}, SUSP, { key: 'too-long', length: '31d', until: undefined }),
  Object.assign({}, SUSP, { key: 'too-long-until', from: iso(clock - H), until: iso(clock + 31 * 24 * H) }),
  Object.assign({}, SUSP, { key: 'no-from', from: undefined, until: undefined, length: '38h' }),
  Object.assign({}, SUSP, { key: 'mismatch', profile: 21 }),
  Object.assign({}, SUSP, { key: 'over', from: iso(clock - 50 * H), until: iso(clock - H) }),
  Object.assign({}, SUSP, { key: 'bad-profile', profile: 'x' }),
  Object.assign({}, SUSP, { key: 'short', reason: 'x' }),
]);
ok(!Object.values(JSON.parse(fileText()).profiles || {}).some((l) => l.length), 'none of them is put on record', JSON.parse(fileText()));
ok(logs.some((l) => /record too-long refused: length "31d" is not 1h to 30d/.test(l)) && logs.some((l) => /record too-long-until refused: longer than 30 days/.test(l)), 'over maxSuspendDays is refused, by length or by until', logs);
ok(logs.some((l) => /record no-from refused: a length needs its from/.test(l)), 'a length with no from is refused', logs);
ok(logs.some((l) => /record mismatch: #AAAA is on profile 20, not 21; refused/.test(l)), 'a tag on another profile than the one named is refused', logs);
ok(logs.some((l) => /record over: it ended .*; not added/.test(l)), 'one already over is not added', logs);
ok(logs.some((l) => /record bad-profile: profile x is not a profile number/.test(l)) && logs.some((l) => /record entry short refused/.test(l)), 'a bad profile and a short reason are refused', logs);
ok(!kicked.length && !audits.length, 'and nobody is logged out or audited for them', [kicked, audits]);

// 6. A profile alone, nobody online on it; a tag alone; a start still to come
reset(); online = [2, 9];
load([{ key: 'by-profile', profile: 21, kind: 'suspend', from: iso(clock - H), length: '38h', reason: 'Temporary ban by profile', by: 'Jake' },
  { key: 'later', tag: 'NEWB', kind: 'suspend', from: iso(clock + 2 * H), until: iso(clock + 10 * H), reason: 'Starts in two hours', by: 'Jake' }]);
const r21 = recOf(21).find((e) => e.key === 'by-profile');
ok(r21 && r21.char === 'profile 21' && r21.until === clock - H + 38 * H, 'a profile alone, offline: on record with the account named, end from "from"', r21);
ok(audits.some((l) => /^DISCIPLINE suspend #1 on profile 21 \(profile 21\) from .* by Jake \(config by-profile\)/.test(l)), 'audited with the profile', audits);
online = [2, 6, 9]; kicked.length = 0;
ok(login(6) && kicked.includes(106), 'its owner is refused at their next login');
ok(!login(8), 'a suspension that starts later refuses nothing yet');
clock += 3 * H;
ok(login(8), '...and refuses once it has started');
clock -= 3 * H;

// 7. Discord accounts held out under the key: B has never played under a suspended profile, C is someone else
fs.rmSync(FILE, { force: true }); reset();
fs.writeFileSync(DFILE, JSON.stringify({ 'rep-test': [ID_A, ID_B] }), { mode: 0o600 }); fs.chmodSync(DFILE, 0o600);
online = [2, 3, 8, 9];
load([SUSP]);
const loadLogs = logs.slice();
ok(kicked.includes(103) && kicked.includes(108) && !kicked.includes(109), 'at once: the account and the other Discord account, online, are logged out; nobody else', kicked);
ok(audits.some((l) => /^DISCIPLINE suspend #1 on w3 \(profile 20\) from .* until .* \(\+2 Discord accounts\) by Jake \(config rep-test\)/.test(l)), 'the audit line counts the Discord accounts, never their ids', audits);
reset();
ok(login(8) && kicked.includes(108), 'B, on a profile with no record of its own, is refused at login by its Discord account');
ok(audits.some((l) => /^DISCIPLINE refused w8: suspended until .* \(config rep-test, held out by Discord account\)$/.test(l)), 'that refusal is audited without the id', audits);
ok(packets.some(([a, p]) => a === 8 && /Your account is suspended until/.test(p.reason)), 'and B is told why');
ok(voice(8) === 'suspended' && voice(9) === '', 'B gets no voice; C does', [voice(8), voice(9)]);
ok(!login(9), 'C, not listed, logs in');
kicked.length = 0; tick && tick();
ok(kicked.includes(108) && kicked.includes(103) && !kicked.includes(109), 'the 30 s check holds both out', kicked);
ok(loadLogs.some((l) => /2 Discord account\(s\) listed under 1 key\(s\)/.test(l)) && !loadLogs.some((l) => /can be read by other users/.test(l)), 'the load line counts them; a 0600 file draws no warning', loadLogs);
cmd(2, 'list'); ok(said.some(([a, t]) => a === 2 && /profile 20 c3: until .* \(\+2 Discord accounts\) by Jake/.test(t)), 'staff see it in /discipline list, ids withheld', said.filter(([a]) => a === 2));
cmd(2, '#AAAA'); ok(said.some(([a, t]) => a === 2 && /#1 .* suspend from .* until .* \(\+2 Discord accounts\) by Jake/.test(t)), 'and on the record', said.filter(([a]) => a === 2));
ok(!fileText().includes(ID_A) && !fileText().includes(ID_B), 'discipline.json never holds the ids');
// After the end, B is free too
clock = Date.parse(until) + 1; kicked.length = 0;
ok(!login(8) && !kicked.length && voice(8) === '', 'after the end B logs in');
clock = Date.parse(until) - 30 * H;

// 8. Undo from config: lift by key frees the account and every Discord account under it, once
reset();
const LIFT = { key: 'rep-test-lift', kind: 'lift', of: 'rep-test', reason: 'Ended early by Jake', by: 'Jake' };
online = [2, 9];
load([SUSP, LIFT]); load([SUSP, LIFT]);
r20 = recOf(20);
ok((r20.find((e) => e.key === 'rep-test') || {}).lifted === true && r20.filter((e) => e.key === 'rep-test-lift').length === 1, 'a config lift marks the suspension lifted, once across reloads', r20);
ok(audits.filter((l) => /^DISCIPLINE lift #2 on c3 \(profile 20\) of #1 \(config rep-test\) \(\+2 Discord accounts\) by Jake \(config rep-test-lift\): Ended early by Jake$/.test(l)).length === 1, 'audited once, with what it lifted', audits);
kicked.length = 0; online = [2, 3, 8, 9];
ok(!login(8) && !kicked.length, 'B logs in again');
ok(!login(3) && said.some(([a, t]) => a === 3 && /Your suspension was lifted: Ended early by Jake/.test(t)), 'the account logs in and is told it was lifted');
reset(); load([{ key: 'lift-nothing', kind: 'lift', of: 'no-such', reason: 'nothing to lift', by: 'Jake' }]);
ok(logs.some((l) => /record lift-nothing: no suspension or ban no-such on record to lift/.test(l)), 'a lift of an unknown key is refused', logs); // "or ban": a config lift ends a ban too (25 Oct)

// 9. The ids file: world readable warned; a key with no record named; broken JSON never quoted
reset(); fs.chmodSync(DFILE, 0o644); fs.writeFileSync(DFILE, JSON.stringify({ 'rep-test': [ID_A], 'no-record': [ID_C], [ID_C]: [ID_C] }));
load([]);
ok(logs.some((l) => /discipline-discord\.json can be read by other users: chmod 600 it/.test(l)), 'a file others can read is warned about', logs);
ok(logs.some((l) => /lists no-record, which is not on record: it holds no one out/.test(l)) && logs.some((l) => /lists \[digits\], which is not on record/.test(l)), 'a key with no record is named; an id typed as a key is not', logs);
reset(); fs.writeFileSync(DFILE, `{ "rep-test": [${ID_A}, ${ID_B}`); load([]);
ok(logs.some((l) => /discipline-discord\.json unreadable \(not valid JSON\); no Discord account is held out/.test(l)), 'broken JSON: refused, nobody held out', logs);
reset(); fs.writeFileSync(DFILE, JSON.stringify({ 'rep-x': [ID_A, 'not-an-id', 12] })); load([]);
ok(logs.some((l) => /rep-x holds something that is not a list of Discord ids; only the ids are used/.test(l)), 'entries that are not Discord ids are dropped', logs);
// No id anywhere a person reads
const everything = JSON.stringify(ever) + fileText();
ok(!FAKE_IDS.some((d) => everything.includes(d)), 'no Discord id in a log, an audit line, a message, a packet or discipline.json');

// 10. Off switch: no hold at all
fs.writeFileSync(DFILE, JSON.stringify({ 'rep-test': [ID_A, ID_B] }), { mode: 0o600 });
fs.rmSync(FILE, { force: true }); load([SUSP]);
load([SUSP], { enabled: false });
ok(globalThis.__dboDisciplineLogin === null && globalThis.__dboVoiceRefused === null, 'enabled false: the hooks are cleared (the emergency off switch)');

// 11. What is shipped
const shipped = (CFG.discipline.record || []).find((r) => r.key === 'rep-0305');
if (shipped) {
  const sw = cw(shipped, CFG.discipline.maxSuspendDays, Date.parse('2026-10-21T15:30:00Z'));
  ok(shipped.kind === 'suspend' && shipped.profile === 101 && String(shipped.tag).replace(/^#/, '') === 'VKRS' && shipped.by === 'Jake', 'shipped rep-0305: a suspension of profile 101 (#VKRS), decided by Jake', shipped);
  ok(sw.from === Date.parse('2026-10-21T15:00:00Z') && sw.until === Date.parse('2026-10-23T05:00:00Z') && sw.until - sw.from === 38 * H, 'shipped rep-0305: 21 Oct 15:00 UTC to 23 Oct 05:00 UTC, 38 hours', sw);
  ok(!/\d{15,}/.test(JSON.stringify(CFG.discipline)), 'shipped config: no Discord id in it');
} else console.log('--    no rep-0305 record shipped in gamemode-config.json');
ok(fs.readFileSync(path.join(SERVER, '.gitignore'), 'utf8').split('\n').includes('discipline-discord.json'), 'the ids file is gitignored');

Date.now = realNow;
global.setTimeout = realTimeout;
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
