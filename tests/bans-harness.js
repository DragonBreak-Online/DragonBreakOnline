// Staff bans (Nat, 25 Oct 2026: "allow Lead GMs to ban, temp ban etc in game. Also create discord commands that correlate so
// lead GMs can use it. Let regular GMs temp ban up to 3 days only"). Part D loads the real discipline.js against a fake api:
// a GM suspends (/tempban) for up to gmMaxSuspendDays, a ban is a Lead GM's suspension with no end ("permanently" wherever an
// end is named), /ban /tempban /unban /bans run /discipline's own code, and the rank rule decides as for every other kind.
// Part P loads the real staffguard.js: the F7 panel's ban, tempBan and ipBan go through the same rank rule (fork AdminSystem
// asks __dboAdminGate), and a GM's panel temp ban is held to 72 hours. The console's side runs as root in
// tests/console-punish-harness.js (R7, E9).
//   node tests/bans-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 600)}`); if (!c) fails++; };
const MOD = path.join(SERVER, 'discipline.js');
const D = require(MOD);
const CFG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));

// ==== D. discipline.js =====================================================================================================
ok(D.stamp(Infinity) === 'permanently' && D.stamp(8.64e15 + 1) === 'permanently' && /^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/.test(D.stamp(Date.now())), 'stamp: a date that cannot be one reads "permanently", never throws');
ok(D.endText({ kind: 'ban' }) === 'permanently' && /^until \d{4}/.test(D.endText({ kind: 'suspend', until: Date.now() + 1000 })), 'endText: a ban is permanently, a suspension until its date');
const now0 = Date.now();
ok(D.activeSuspension([{ kind: 'ban', n: 1 }], now0).n === 1 && !D.activeSuspension([{ kind: 'ban', n: 1, lifted: true }], now0) && !D.activeSuspension([{ kind: 'ban', n: 1, overturned: {} }], now0),
  'activeSuspension: a ban holds until lifted or overturned');
ok(D.activeSuspension([{ kind: 'suspend', n: 1, until: now0 + 9e9 }, { kind: 'ban', n: 2 }, { kind: 'suspend', n: 3, until: now0 + 1000 }], now0).n === 2, '...and a ban outranks any suspension running beside it');

const tmp = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-bans-'));
const FILE = path.join(tmp, 'discipline.json');
// 1 GM (profile 10), 2 Lead GM (11), 3 player (20), 4 the player's alt (20), 5 another GM (12), 6 offline player (21),
// 7 another Lead GM (13), 8 a Developer (14), 9 the Lead GM's own alt with no roles (11), 10 a second player (22)
const prof = { 1: 10, 2: 11, 3: 20, 4: 20, 5: 12, 6: 21, 7: 13, 8: 14, 9: 11, 10: 22 };
const tier = { 1: 'gm', 2: 'leadgm', 5: 'gm', 7: 'leadgm', 8: 'developer' };
const tags = { '#AAAA': 3, '#BBBB': 4, '#GMGM': 5, '#OFFL': 6, '#LEA2': 7, '#DEVV': 8, '#LALT': 9, '#CCCC': 10 };
let online = [1, 2, 3, 5, 7, 8, 10];
// gamemode.js rankRefusalOf over this world (tests/staff-rank-harness.js runs the real one)
const RANKS = { developer: 3, leadgm: 2, gm: 1 };
const accountRank = (p) => Math.max(0, ...Object.keys(prof).filter((x) => prof[x] === p).map((x) => RANKS[tier[x]] || 0));
const rankRefusal = (a, t) => (prof[t] === undefined ? 'unknown' : prof[t] === prof[a] ? 'own' : accountRank(prof[t]) >= (RANKS[tier[a]] || 0) ? 'rank' : null);
const authorRefusal = (a, by) => { const theirs = by === 0 ? 4 : Number.isSafeInteger(by) && by > 0 ? accountRank(by) : -1; return theirs < 0 ? 'unknown' : theirs > (RANKS[tier[a]] || 0) ? 'rank' : null; };
const said = [], audits = [], packets = [], kicked = [];
const cmds = new Map();
const realTimeout = global.setTimeout; global.setTimeout = (fn) => fn();
const load = (record) => {
  delete require.cache[MOD]; cmds.clear();
  require(MOD)({
    mp: { kick: (u) => kicked.push(u), get: () => '' }, log: () => {}, personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t),
    who: (a) => `w${a}`, display: (a) => `c${a}`, profileOf: (a) => prof[a], onlineActors: () => online.slice(),
    registerChatCommand: (n, fn, opts) => cmds.set(n, { fn, opts }), isAdmin: (a) => !!tier[a], isLeadStaff: (a) => !!tier[a] && tier[a] !== 'gm',
    findAnyByName: (q) => tags[q] || 0, sendPacket: (a, p) => packets.push([a, p]), userOf: (a) => a + 100, every: () => {}, rankRefusal, authorRefusal,
    cfg: { discipline: Object.assign({}, CFG.discipline, { file: FILE, discordFile: path.join(tmp, 'none.json'), record: record || [] }) },
  });
};
load();
const run = (a, typed) => { const line = typed.replace(/^\//, ''); const i = line.indexOf(' '); const n = i < 0 ? line : line.slice(0, i); said.length = 0; cmds.get(n).fn(a, i < 0 ? '' : line.slice(i + 1)); return said.filter((s) => s[0] === a).map((s) => s[1]); };
const rec = (p) => (JSON.parse(fs.readFileSync(FILE, 'utf8')).profiles[p] || []);
const n = (p) => { try { return rec(p).length; } catch (e) { return 0; } };
const reset = () => { said.length = 0; audits.length = 0; packets.length = 0; kicked.length = 0; };

// ---- the aliases are registered as staff commands, with help ----------------------------------------------------------------
ok(['ban', 'tempban', 'unban', 'bans'].every((x) => cmds.has(x) && cmds.get(x).opts.admin === true && cmds.get(x).opts.help), 'registered: /ban, /tempban, /unban, /bans, admin, each with help', [...cmds.keys()]);
ok(/\|ban\|/.test(cmds.get('discipline').opts.help), '/discipline help names ban');

// ---- a GM: temp ban up to 3 days, never a ban, no lift ------------------------------------------------------------------
reset();
let t = run(1, '/tempban #AAAA 4d stole from a barrel');
ok(t[0] === 'A GM can suspend for at most 3 days (3d or 72h). For longer, or a ban, ask a Lead GM.' && n(20) === 0, 'GM /tempban 4d: refused, naming the 3-day limit; nothing recorded', t);
t = run(1, '/tempban #AAAA 73h stole from a barrel');
ok(/^A GM can suspend for at most 3 days/.test(t[0]) && n(20) === 0, 'GM /tempban 73h: refused too', t);
t = run(1, '/discipline #AAAA suspend 4d stole from a barrel');
ok(/^A GM can suspend for at most 3 days/.test(t[0]) && n(20) === 0, 'GM /discipline suspend 4d: the same refusal (one code path)', t);
t = run(1, '/ban #AAAA threats against players');
ok(/^Bans are for Lead GMs and above\. A GM can suspend \(\/tempban\) for up to 3 days/.test(t[0]) && n(20) === 0, 'GM /ban: refused', t);
t = run(1, '/discipline #AAAA ban threats against players');
ok(/^Bans are for Lead GMs and above/.test(t[0]) && n(20) === 0, 'GM /discipline ban: refused alike', t);
reset();
t = run(1, '/tempban #AAAA 3d stole from a barrel');
ok(/^Recorded: suspend #1 on c3 until \d{4}-\d\d-\d\d \d\d:\d\d UTC\.$/.test(t[0]) && rec(20)[0].kind === 'suspend' && Math.abs(rec(20)[0].until - Date.now() - 3 * 86400000) < 60000,
  'GM /tempban 3d: recorded as a 3-day suspension', t);
ok(kicked.includes(103) && kicked.includes(104) === false && packets.some(([a, p]) => a === 3 && /^Your account is suspended until .* Reason: stole from a barrel$/.test(p.reason)), '...the online character of the account is logged out with the reason', packets);
ok(audits.some((l) => /^DISCIPLINE suspend #1 on w3 \(profile 20\) until .* UTC by w1: stole from a barrel$/.test(l)), '...audited as a suspension, by the GM', audits);
t = run(1, '/unban #AAAA it was a mistake');
ok(t[0] === 'Only a Lead GM or above can lift a suspension or a ban. Ask one, with what you found.' && !rec(20)[0].lifted, 'GM /unban: refused (lift stays Lead GM+)', t);
reset();
t = run(1, '/tempban #CCCC 72h spamming the market');
ok(/^Recorded: suspend #1 on c10 until /.test(t[0]), 'GM /tempban 72h: exactly the cap is allowed', t);
t = run(2, '/unban #CCCC a Lead GM lifts a GM temp ban');
ok(/^Recorded: lift #2 on c10\./.test(t[0]) && rec(22)[0].lifted === true, '...and a Lead GM lifts it (/unban = lift)', t);

// ---- a Lead GM: ban, permanently -----------------------------------------------------------------------------------------
reset();
const before = n(20);
t = run(2, '/ban #BBBB threats against players, ticket 0200');
const b = rec(20)[before];
ok(t[0] === `Recorded: ban #${before + 1} on c4 permanently.` && b.kind === 'ban' && b.until === undefined && b.by === 'c2' && b.byProfile === 11, 'Lead GM /ban on the alt: a ban record with no end', [t, b]);
ok(kicked.includes(103) && packets.some(([a, p]) => a === 3 && p.reason === 'Your account is banned permanently. Reason: threats against players, ticket 0200'), '...every online character of the account is logged out: "banned permanently"', packets);
ok(audits.some((l) => l === `DISCIPLINE ban #${before + 1} on w4 (profile 20) permanently by w2: threats against players, ticket 0200`), '...audited: DISCIPLINE ban #n on <target> (profile N) permanently by <staff>: <reason>', audits);
reset();
ok(globalThis.__dboDisciplineLogin(3) === true && kicked.includes(103), 'refused at login, on either character');
ok(audits.some((l) => l === `DISCIPLINE refused w3: banned permanently (#${before + 1})`), '...the login refusal is audited "banned permanently (#n)"', audits);
ok(globalThis.__dboVoiceRefused(4) === 'suspended', '...and no voice token (the console holds a banned caller out by the same test)');
t = run(5, '/discipline #AAAA');
ok(t.some((l) => /^c3 \(profile 20\): \d+ entries, .*, banned permanently\.$/.test(l)) && t.some((l) => new RegExp(`^#${before + 1} \\d{4}-\\d\\d-\\d\\d ban permanently by c2: threats`).test(l)), 'the record view says banned permanently, and the entry permanently', t);
t = run(5, '/bans');
const listLines = t;
ok(t.some((l) => /^profile 20 c4: banned permanently by c2: threats against players/.test(l)), '/bans lists it: banned permanently', t);
ok(JSON.stringify(run(5, '/discipline list')) === JSON.stringify(listLines), '/bans is /discipline list');
// a temp ban beside a ban: the ban still holds when the suspension ends
reset();
t = run(2, '/tempban #AAAA 1h a shorter hold beside the ban');
ok(/^Recorded: suspend/.test(t[0]) && D.activeSuspension(rec(20), Date.now() + 2 * 3600000).kind === 'ban', 'a temp ban beside a ban: the ban still holds after it ends', t);

// ---- /unban lifts a ban --------------------------------------------------------------------------------------------------
reset();
t = run(2, '/unban #AAAA appeal accepted on ticket 0201');
const lift = rec(20).slice(-1)[0];
ok(/^Recorded: lift #\d+ on c3\.$/.test(t[0]) && rec(20)[before].lifted === true && lift.kind === 'lift' && lift.lifts === before + 1 && lift.liftsKind === 'ban', '/unban lifts the ban (the record marked, a lift entry naming it)', [t, lift]);
ok(said.some(([a, x]) => a === 3 && x === 'Your ban was lifted: appeal accepted on ticket 0201'), '...the player, online, reads "Your ban was lifted"');
// the GM's 3-day temp ban and the 1h one still run: one /unban lifts one hold, the one ending last first
t = run(2, '/unban #AAAA the three days too');
ok(/^Recorded: lift/.test(t[0]) && D.activeSuspension(rec(20), Date.now()).until < Date.now() + 2 * 3600000, '...a second /unban lifts the next hold (the 3-day one)', t);
t = run(2, '/unban #AAAA and the hour');
reset();
ok(globalThis.__dboDisciplineLogin(3) !== true && !kicked.length, '...and the account logs in again');
t = run(2, '/unban #AAAA nothing left to lift');
ok(t[0] === 'c3 is not suspended or banned.', '/unban with nothing running', t);

// ---- the rank rule and one's own account ----------------------------------------------------------------------------------
reset();
const n13 = n(13), n14 = n(14), n11 = n(11);
t = run(2, '/ban #LEA2 a Lead GM bans a Lead GM');
ok(/^c7 is on a staff account of your rank or higher, so you cannot discipline it\./.test(t[0]) && n(13) === n13, 'Lead GM /ban another Lead GM: refused (equal rank)', t);
t = run(2, '/ban #DEVV a Lead GM bans a Developer');
ok(/^c8 is on a staff account of your rank or higher/.test(t[0]) && n(14) === n14, 'Lead GM /ban a Developer: refused (higher rank)', t);
t = run(2, '/tempban #DEVV 1d a Lead GM temp bans a Developer');
ok(/^c8 is on a staff account of your rank or higher/.test(t[0]) && n(14) === n14, '...and /tempban alike', t);
t = run(2, '/ban #LALT my own alt');
ok(t[0] === 'You cannot discipline your own account.' && n(11) === n11, 'Lead GM /ban on her own alt: refused (own account)', t);
t = run(1, '/tempban #GMGM 1d a GM temp bans a GM');
ok(/^c5 is on a staff account of your rank or higher/.test(t[0]) && n(12) === 0, 'GM /tempban another GM: refused', t);
t = run(8, '/ban #LEA2 a Developer bans a Lead GM');
ok(/^Recorded: ban #\d+ on c7 permanently\.$/.test(t[0]), 'a Developer bans a Lead GM (below her rank)', t);
reset();
t = run(2, '/unban #LEA2 a Lead GM lifts a Developer ban');
ok(/^c7 is on a staff account of your rank or higher/.test(t[0]), '...which a Lead GM cannot lift (her rank on that account)', t);

// ---- usage and words ------------------------------------------------------------------------------------------------------
ok(run(2, '/ban')[0] === 'Use: /ban #TAG <reason>' && run(2, '/tempban')[0] === 'Use: /tempban #TAG <12h|3d> <reason>' && run(2, '/unban list')[0] === 'Use: /unban #TAG <reason>', 'bare aliases print their usage');
ok(run(3, '/ban #AAAA nope nope nope')[0] === 'Only staff can use /ban.' && run(3, '/bans')[0] === 'Only staff can use /bans.', 'a player cannot use them');
t = run(2, '/ban #CCCC hi');
ok(t[0] === 'Give a reason; the player is shown it.', '/ban needs a reason', t);
t = run(2, '/tempban #CCCC soon stole goods');
ok(/^Give a length from 1h to 30d/.test(t[0]), '/tempban needs a length (a Lead GM: up to maxSuspendDays 30)', t);
t = run(2, '/tempban #CCCC 31d stole goods');
ok(/^Give a length from 1h to 30d/.test(t[0]), '...and not over it', t);

// ---- the same records: /discipline #TAG ban and /ban write one record set --------------------------------------------------
reset();
const k22 = n(22);
run(2, '/discipline #CCCC ban same record either way');
run(2, '/unban #CCCC lifted through the alias');
run(2, '/ban #CCCC banned through the alias');
run(2, '/discipline #CCCC lift lifted through discipline');
const r22 = rec(22).slice(k22);
ok(r22.map((e) => e.kind).join() === 'ban,lift,ban,lift' && r22[0].lifted && r22[2].lifted && r22.every((e, i) => e.n === k22 + i + 1), 'the aliases and /discipline write the one record set, numbered in order', r22);

// ---- a ban decided outside the game (config record), and its config lift -------------------------------------------------
reset();
load([{ key: 'ban-cfg', tag: 'CCCC', kind: 'ban', reason: 'decided by the Owners on ticket 0300', by: 'Jake' }]);
const cfgBan = rec(22).find((e) => e.key === 'ban-cfg');
ok(cfgBan && cfgBan.kind === 'ban' && cfgBan.until === undefined && cfgBan.by === 'Jake' && cfgBan.byProfile === 0, 'a config ban is recorded once, by the Owners', cfgBan);
ok(audits.some((l) => /^DISCIPLINE ban #\d+ on w10 \(profile 22\) permanently by Jake \(config ban-cfg\): decided by the Owners/.test(l)) && kicked.includes(110), '...audited permanently, and the player logged out', audits);
t = run(2, '/unban #CCCC a Lead GM tries an Owner ban');
ok(/decided outside the game by the Owners, so only an Owner can lift it/.test(t[0]), '...which a Lead GM cannot lift (the record-author rule)', t);
reset();
load([{ key: 'ban-cfg', tag: 'CCCC', kind: 'ban', reason: 'decided by the Owners on ticket 0300', by: 'Jake' },
  { key: 'ban-cfg-lift', kind: 'lift', of: 'ban-cfg', reason: 'appeal granted on ticket 0301', by: 'Jake' }]);
ok(rec(22).find((e) => e.key === 'ban-cfg').lifted === true && rec(22).find((e) => e.key === 'ban-cfg-lift').liftsKind === 'ban' && globalThis.__dboDisciplineLogin(10) !== true, 'a config lift of the config ban ends it');

// ---- a ban's record survives a reload and stays permanent ------------------------------------------------------------------
load();
ok(rec(13).some((e) => e.kind === 'ban' && !e.lifted) && globalThis.__dboDisciplineLogin(7) === true, 'after a reload the Developer\'s ban on the Lead GM still holds');
global.setTimeout = realTimeout;
fs.rmSync(tmp, { recursive: true, force: true });

// ==== P. the F7 panel's bans (staffguard.js adminGate, asked by the fork's AdminSystem) =======================================
const SG = require('./lib/staffguard-fakes');
const { LEAD, LEAD_RP, LEAD2, GM, OWNER, MIRA, BOB } = Object.fromEntries(Object.entries(SG.CAST).map(([k, v]) => [k, v.id]));
const f = SG.load({});
const gate = globalThis.__dboAdminGate;
const DEV = 0x70;
f.byId.set(DEV, { id: DEV, name: 'Nate', tag: 'NNAT', profile: 70, tier: 'developer', online: true, staff: true });
ok(['ban', 'tempBan', 'ipBan'].every((x) => gate(LEAD, x, { target: MIRA, hours: 24 }) === ''), 'P. a Lead GM bans, temp bans and IP bans a player from the panel');
ok(gate(LEAD_RP, 'ban', { target: MIRA }) === '', '...from her RP character too (moderation works there)');
ok(['ban', 'tempBan', 'ipBan'].every((x) => /^Nate #NNAT is on a staff account of your rank or higher, so you cannot ban it\./.test(gate(LEAD, x, { target: DEV, hours: 24 }))), 'P. a Lead GM is refused a ban on a Developer\'s account', gate(LEAD, 'ban', { target: DEV }));
ok(/^GM Lars #LAR2 is on a staff account of your rank or higher/.test(gate(LEAD, 'ban', { target: LEAD2 })), '...and on another Lead GM\'s');
ok(gate(LEAD, 'ban', { target: LEAD_RP }) === 'You cannot ban your own account.' && gate(LEAD_RP, 'tempBan', { target: LEAD, hours: 2 }) === 'You cannot ban your own account.', 'P. her own account is refused, from either character');
ok(gate(OWNER, 'ban', { target: LEAD }) === '' && /rank or higher/.test(gate(OWNER, 'ban', { target: 0x11 }) || '') === false, 'P. an Owner bans a Lead GM (below), the rule as typed');
const UNREAD = 'The staff rank of that account could not be read, so nothing was banned. Try again, or ask an Owner.';
const rr = f.api.rankRefusal;
f.api.rankRefusal = () => 'unknown';
ok(gate(LEAD, 'ban', { target: MIRA }) === UNREAD, 'P. an unreadable rank is refused');
f.api.rankRefusal = () => { throw new Error('index gone'); };
ok(gate(LEAD, 'ban', { target: MIRA }) === UNREAD, '...a rank rule that throws is refused (the fork lets a throw through, so the gate never throws)');
f.api.rankRefusal = undefined;
ok(gate(LEAD, 'ban', { target: MIRA }) === UNREAD, '...and without gamemode.js\'s rule every panel ban is refused (fails closed)');
f.api.rankRefusal = rr;
ok(gate(LEAD, 'ban', { target: 0 }) === UNREAD && gate(LEAD, 'ban', {}) === UNREAD, 'P. a ban naming no character is refused');
ok(gate(GM, 'tempBan', { target: MIRA, hours: 72 }) === '' && gate(GM, 'tempBan', { target: BOB, hours: 1 }) === '', 'P. a GM\'s panel temp ban of up to 72 hours passes the gate');
ok(gate(GM, 'tempBan', { target: MIRA, hours: 73 }) === 'A GM can temp ban for at most 72 hours (3 days). For longer, ask a Lead GM.', 'P. ...73 hours is refused', gate(GM, 'tempBan', { target: MIRA, hours: 73 }));
ok(/^The panel did not say how long/.test(gate(GM, 'tempBan', { target: MIRA })), 'P. ...and a GM temp ban that carries no hours is refused (the fork sends none today)');
ok(/^Bans are for Lead GMs and above\./.test(gate(GM, 'ban', { target: MIRA })) && /^Bans are for Lead GMs and above\./.test(gate(GM, 'ipBan', { target: MIRA })), 'P. a GM never bans for good from the panel');
ok(gate(LEAD, 'tempBan', { target: MIRA, hours: 24 * 300 }) === '', 'P. a Lead GM\'s temp ban length is the fork\'s to check');
ok(gate(LEAD, 'unban', { target: 'b-123' }) === '' && gate(LEAD, 'kick', { target: LEAD2 }) === '', 'P. unban (a ban id) and kick are not ban actions here');
const off = SG.load({ enabled: false });
void off;
ok(/rank or higher/.test(globalThis.__dboAdminGate(LEAD, 'ban', { target: LEAD2 })), 'P. the rank rule holds with staffPowers switched off (a punishment rule, not a staff power)');
const gsrc = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
ok(/require\(STAFFGUARD_JS\)\(\{[^}]*rankRefusal: rankRefusalOf,/.test(gsrc), 'gamemode.js hands staffguard.js its rank rule (rankRefusalOf, the one /discipline gets)');
ok(/items: \['players', 'kick', 'discipline', 'ban', 'tempban', 'unban', 'bans',/.test(gsrc), 'gamemode.js: /help admin players lists the aliases beside /discipline');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
