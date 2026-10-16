// Scripted test for the election's voter rules in server\citizenship.js (Nate, 16 Oct 2026: "make sure people can't make
// multiple Discord accounts just to vote"; config citizenship.election.voterRules). Loads the real module in a scratch
// folder against a mock world (Whiterun, no Jarl yet), fake backend files (players.json, device-ids.json) in that folder,
// and a mock playtime.js. Covers each rule, the 15-account threshold, the one-vote-per-PC rule, the shared-address review
// list and /strikevote.
//
//   node tests/election-antialt-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE = path.resolve(__dirname, '..', 'citizenship.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-antialt-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
let now = Date.UTC(2026, 9, 16, 12, 0);
Date.now = () => now;
const HOUR = 3600000, DAY = 24 * HOUR;

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

// ---- the world ---------------------------------------------------------------------------------------------------------
const ZONES = [{ id: 'whiterun', name: 'Whiterun', treasury: 'y', officials: ['jarl', 'steward', 'commander', 'courtmage', 'guardcaptain', 'guard'] }];
const WR = ZONES[0];
const officials = {};
// A Discord id made at time t (a snowflake: milliseconds since the Discord epoch, shifted 22 bits)
const snow = (t) => ((BigInt(t) - 1420070400000n) << 22n).toString();
const OLD = snow(Date.UTC(2020, 0, 1));
// actor -> { pid, name, race, discord (on the character), }; pid -> backend record and play time
const chars = new Map(), backend = new Map(), play = new Map();
let n = 0;
const account = (pid, name, o = {}) => {
  const actor = 0x1000 + (n++);
  chars.set(actor, { pid, name, race: o.race || 'NordRace', discord: o.noCharDiscord ? '' : (o.discord || snow(Date.UTC(2020, 0, 1) + pid * 1000)) });
  backend.set(pid, { profileId: pid, discordId: o.discord || snow(Date.UTC(2020, 0, 1) + pid * 1000), lastIp: o.ip || `10.0.0.${pid}` });
  if (!o.noPlay) play.set(pid, o.play || { ms: 20 * HOUR, days: 5 });
  return actor;
};
let online = [];
const STAFF = account(1, 'Lead Staff'), GM = account(2, 'Plain GM');
const writeBackend = () => {
  fs.writeFileSync(path.join(dir, 'players.json'), JSON.stringify(Object.fromEntries([...backend.values()].map((r) => [r.discordId, r]))));
};
let deviceAccounts = {};
const writeDevices = () => fs.writeFileSync(path.join(dir, 'device-ids.json'), JSON.stringify({ v: 1, accounts: deviceAccounts }));
globalThis.__dboPlaytimeOf = (pid) => play.get(Number(pid)) || { ms: 0, days: 0 };
globalThis.__dboGuildsOf = () => [];

const mp = { get: (id, p) => { const c = chars.get(id >>> 0); if (!c) throw new Error('no such form'); if (p === 'type') return 'MpActor'; if (p === 'profileId') return c.pid; return undefined; } };
const said = [], audits = [], logs = [];
const cmds = {};
let timer = null;
let rules = {};
const api = () => ({
  mp, log: (...x) => logs.push(x.join(' ')), audit: (t) => audits.push(t), who: (a) => (chars.get(a >>> 0) || {}).name || `actor ${a}`,
  personal: (a, t) => said.push([a >>> 0, t]), nameOf: (a) => chars.get(a >>> 0).name, ownNameOf: (a) => chars.get(a >>> 0).name, tagOf: (a) => `T${(a >>> 0).toString(16)}`,
  onUi: () => {}, onlineActors: () => online.slice(), isAdmin: (a) => a === STAFF || a === GM, isLeadStaff: (a) => a === STAFF,
  profileOf: (a) => { const c = chars.get(a >>> 0); return c ? c.pid : -1; },
  discordOf: (a) => (chars.get(a >>> 0) || {}).discord || '',
  registerChatCommand: (name, fn, o) => { cmds[name] = { fn, o }; },
  cfg: { citizenship: { election: { voterRules: Object.assign({ playersFile: path.join(dir, 'players.json'), deviceFile: path.join(dir, 'device-ids.json'), cacheMinutes: 0 }, rules) } } },
  every: (nm, ms, f) => { timer = f; },
  zoneList: () => ZONES, zoneById: (id) => ZONES.find((z) => z.id === String(id)) || null, readOfficials: () => officials,
  rankTitle: (r) => ({ jarl: 'Jarl', steward: 'Steward', commander: 'Lord Commander' })[r] || r,
  officialTarget: (q) => {
    const s = String(q).replace(/^#/, '').toLowerCase();
    const hit = [...chars.entries()].filter(([id, c]) => c.name.toLowerCase() === s || `t${id.toString(16)}` === s);
    if (!hit.length) return { error: `No character called ${q}.` };
    const [actor, c] = hit[0];
    return { pid: c.pid, actor, online: online.includes(actor) ? actor : 0, label: c.name, who: c.name };
  },
  accountActors: (pid) => [...chars.entries()].filter(([, c]) => c.pid === pid).map(([id]) => id),
  seatOfficial: (z, rank, tg) => { officials[z.id] = officials[z.id] || {}; officials[z.id][rank] = [tg.pid]; return { text: 'seated' }; },
  unseatOfficialBy: () => ({ text: 'unseated' }),
  takeGold: () => true, depositToTreasury: (z, x) => x, openWidget: () => true, closeWidget: () => true, boardZoneNear: () => null,
  raceEdidOf: (a) => chars.get(a >>> 0).race,
});
const load = () => { delete require.cache[MODULE]; delete globalThis.__dboCitizen; return require(MODULE)(api()); };
writeBackend();
let M = load();
const last = (a) => { for (let i = said.length - 1; i >= 0; i--) if (said[i][0] === (a >>> 0)) return said[i][1]; return ''; };
const nm = (a) => chars.get(a).name;
const join = (a) => { online.push(a); const r = M.join(a, 'whiterun'); if (r.error) throw new Error(r.error); };
const pidOf = (a) => chars.get(a).pid;

// ---- citizens, 30 days ago -----------------------------------------------------------------------------------------------
const T0 = now;
now = T0 - 30 * DAY;
const good = [];
for (let i = 0; i < 13; i++) good.push(account(100 + i, `Citizen ${i}`, { race: i % 2 ? 'NordRace' : 'ImperialRace' }));
// two of them share a household's address
backend.get(101).lastIp = backend.get(102).lastIp = '192.0.2.7';
const YOUNG = account(200, 'Young Discord', { discord: snow(T0 - 10 * DAY) });
const SHORT = account(201, 'Few Hours', { play: { ms: 5 * HOUR, days: 4 } });
const FEWDAYS = account(202, 'Few Days', { play: { ms: 30 * HOUR, days: 2 } });
const NOPLAY = account(207, 'Never Counted', { noPlay: true });
const PCALT = account(204, 'Same PC'); // shares a PC with Citizen 0
const FALLBACK = account(206, 'Discord From Backend', { noCharDiscord: true });
writeBackend();
for (const a of good.concat([YOUNG, SHORT, FEWDAYS, NOPLAY, PCALT, FALLBACK])) join(a);
now = T0 - 2 * DAY;
const NEWCIT = account(203, 'New Citizen');
writeBackend();
join(NEWCIT);
now = T0;
deviceAccounts = { [backend.get(100).discordId]: { d: [{ h: 'aaaa' }] }, [backend.get(204).discordId]: { d: [{ h: 'bbbb' }, { h: 'aaaa' }] } };
writeDevices();

// ---- each rule, as the player reads it -----------------------------------------------------------------------------------
const why = (a) => M.canVote(a, WR, M.data().elections.whiterun || null);
ok(why(good[0]) === '', 'an old Discord account with 20 h on 5 days, a citizen for 30 days, may vote', why(good[0]));
ok(/Discord accounts at least 90 days old/.test(why(YOUNG)) && /will be 90 days old on 2027-01-04/.test(why(YOUNG)), '(a) a 10-day-old Discord account is refused, and told when it may', why(YOUNG));
ok(/10 hours of play, on at least 3 different days/.test(why(SHORT)) && /5 h 0 m on 4 days/.test(why(SHORT)), '(b) 5 hours of play is refused, with the hours shown', why(SHORT));
ok(/on 2 days/.test(why(FEWDAYS)), '(b) 30 hours on only 2 days is refused', why(FEWDAYS));
ok(/0 h 0 m on 0 days/.test(why(NOPLAY)), '(b) an account with no play time counted is refused', why(NOPLAY));
ok(/citizens of Whiterun for 7 days/.test(why(NEWCIT)) && /became one on 2026-10-14/.test(why(NEWCIT)), '(c) a citizen of 2 days is refused, with the date', why(NEWCIT));
ok(why(FALLBACK) === '', "a character without its Discord id is judged by the backend's players.json", why(FALLBACK));
ok(why(PCALT) === '', '(d) before anyone votes, an account on a shared PC may vote');

// ---- the threshold counts eligible accounts, a PC once ---------------------------------------------------------------------
// 13 good + FALLBACK = 14; PCALT shares Citizen 0's PC: still 14; the refused five do not count
ok(M.citizenAccounts(WR) === 14, '(threshold) 21 citizen accounts, 14 count: the refused ones out, the shared PC once', M.citizenAccounts(WR));
timer();
ok(!M.data().elections.whiterun, '(threshold) 14 eligible accounts start no election');
// Without the device file the PC rule cannot see the link: PCALT counts, and the log says why
fs.unlinkSync(path.join(dir, 'device-ids.json'));
M = load();
ok(M.citizenAccounts(WR) === 15 && logs.some((l) => /no device codes/.test(l)), '(d) with no device codes the rule is inert, and logged', M.citizenAccounts(WR));
writeDevices(); M = load();
ok(M.citizenAccounts(WR) === 14, 'the device file back: 14 again');
// The young account comes of age: 15, the election starts
backend.get(200).discordId = OLD;
writeBackend(); M = load();
ok(M.citizenAccounts(WR) === 14, "the character's own Discord id comes first: the young account still does not count");
chars.get(YOUNG).discord = snow(Date.UTC(2021, 0, 1)); M = load();
ok(M.citizenAccounts(WR) === 15, 'an old enough Discord account makes 15', M.citizenAccounts(WR));
timer();
let E = M.data().elections.whiterun;
ok(E && E.phase === 'registration', '(threshold) 15 eligible accounts start registration', E && E.phase);
ok(audits.some((t) => /registration opened/.test(t)), 'audited');
chars.get(YOUNG).discord = snow(T0 - 10 * DAY); // young again for the vote below

// ---- a court, then the vote ----------------------------------------------------------------------------------------------
const [J, S, C, H] = good.slice(9, 13);
let r = M.register(J, 'whiterun', [nm(S), nm(C), nm(H)]);
ok(!r.error, 'a court is entered', r);
for (const a of [S, C, H]) M.answerInvite(a, 'whiterun', M.data().elections.whiterun.courts[0].id, true);
now += 25 * HOUR; timer();
E = M.data().elections.whiterun;
ok(E.phase === 'voting' && E.voteOpenedAt === E.phaseStartedAt && E.voterPlay && E.voterPlay['201'][0] === 5 * HOUR, 'the vote opens; the play time of each citizen account is kept as it was', E.voterPlay && E.voterPlay['201']);
const K = E.ballot[0];
r = M.vote(good[0], 'whiterun', K);
ok(!r.error, 'an eligible citizen votes', r);
r = M.vote(PCALT, 'whiterun', K);
ok(r.error && /from the computer you play on/.test(r.error) && !/Citizen 0/.test(r.error), '(d) the other account on that PC is refused, without naming the account', r);
r = M.vote(YOUNG, 'whiterun', K);
ok(r.error && /when the vote opened/.test(r.error), '(a) the young account is refused at the vote', r);
play.set(201, { ms: 50 * HOUR, days: 9 });
r = M.vote(SHORT, 'whiterun', K);
ok(r.error && /5 h 0 m on 4 days when it opened/.test(r.error), '(b) hours played after the vote opened do not count', r);
r = M.vote(NEWCIT, 'whiterun', K);
ok(r.error && /7 days/.test(r.error), '(c) the new citizen is refused at the vote', r);
// Discord age at the opening, not now: an account that turns 90 during the vote stays out
chars.get(YOUNG).discord = snow(E.voteOpenedAt - 89.9 * DAY);
now += 2 * HOUR;
r = M.vote(YOUNG, 'whiterun', K);
ok(r.error && /90 days/.test(r.error), '(a) an account that turns 90 days old during the vote is still refused', r);

// ---- shared address: never refused, listed for staff ---------------------------------------------------------------------
r = M.vote(good[1], 'whiterun', K);
ok(!r.error, '(e) the first of a household votes', r);
r = M.vote(good[2], 'whiterun', K);
ok(!r.error, '(e) the second, from the same address, is not refused', r);
ok(audits.some((t) => /^ELECTION Whiterun: shared address: Citizen 2 #T\w+, Citizen 1 #T\w+ voted from one address/.test(t)), '(e) the audit names both for review', audits.filter((t) => /shared/.test(t)));
ok(!audits.some((t) => /192\.0\.2\.7/.test(t)) && !JSON.stringify(M.data()).includes('192.0.2.7'), '(e) the address itself is in no audit line and not stored');
ok(!/address/.test(last(good[2])), '(e) the player is told nothing about it');
r = M.reviewText(GM, 'whiterun');
ok(r.error && /Lead GM/.test(r.error), 'a GM below Lead sees no review list', r);
r = M.reviewText(STAFF, 'whiterun');
ok(/one address: Citizen 1 #T\w+, Citizen 2 #T\w+/.test(r.text), 'the review list shows the household', r);
cmds.electionreview.fn(STAFF, 'whiterun');
ok(/one address/.test(last(STAFF)) && cmds.electionreview.o.admin && cmds.strikevote.o.admin, '/electionreview answers in chat; both commands are staff-only');

// ---- striking a vote -----------------------------------------------------------------------------------------------------
r = M.strikeVote(GM, 'whiterun', nm(good[2]));
ok(r.error && /Lead GM/.test(r.error), 'a GM cannot strike a vote', r);
r = M.strikeVote(STAFF, 'whiterun', nm(good[5]));
ok(r.error && /no vote/.test(r.error), 'striking an account that has not voted says so', r);
cmds.strikevote.fn(STAFF, `whiterun ${nm(good[2])}`);
E = M.data().elections.whiterun;
ok(E.votes['102'] === undefined && E.struckVotes['102'] && /is struck/.test(last(STAFF)), 'a Lead GM strikes the vote with /strikevote', last(STAFF));
ok(/struck by the staff/.test(last(good[2])), 'the voter is told, plainly');
ok(audits.some((t) => /^ELECTION STAFF Lead Staff struck the vote of Citizen 2/.test(t)), 'audited');
const ALT2 = 0x1fff; chars.set(ALT2, { pid: 102, name: 'Citizen 2 Again', race: 'NordRace', discord: backend.get(102).discordId }); online.push(ALT2); M.join(ALT2, 'whiterun');
ok(/struck by the staff/.test(M.canVote(good[2], WR, E)) && /struck by the staff/.test(M.canVote(ALT2, WR, E)), 'that account cannot vote again, with any character');
ok(/struck Citizen 2/.test(M.reviewText(STAFF, 'whiterun').text), 'the review list shows the struck vote');
cmds.strikevote.fn(STAFF, 'whiterun');
ok(/Use \/strikevote <hold>/.test(last(STAFF)), '/strikevote without a name explains its use');

// ---- the vote closes; counts are the votes left ----------------------------------------------------------------------------
now += 24 * HOUR; timer();
E = M.data().elections.whiterun;
ok(E.phase === 'seated' && E.result.counts[K] === 2, 'one court with 2 votes (the struck one gone) takes office', E.result);

// ---- the rules can be switched off -------------------------------------------------------------------------------------------
rules = { enabled: false }; M = load();
ok(M.canVote(YOUNG, WR, null) === '' && M.canVote(NEWCIT, WR, null) === '', 'voterRules.enabled false: every citizen votes again');
rules = { discordAgeDays: 0, playHours: 0, playDays: 0 }; M = load();
ok(M.canVote(YOUNG, WR, null) === '' && /7 days/.test(M.canVote(NEWCIT, WR, null)), 'each rule has its own number (0 turns it off): the Discord and play rules off, the citizenship rule still on', M.canVote(NEWCIT, WR, null));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exitCode = fails ? 1 : 0;
