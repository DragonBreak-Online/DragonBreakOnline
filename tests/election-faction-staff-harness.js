// Scripted test for two election rules in server\citizenship.js (Nate, 23 Oct 2026; config citizenship.election.factionGuard
// and staffNotCounted): faction membership judged when registration opens, a vote voided when its character left a faction
// just before voting and joined one again just after (Mike Morethi left House Telvanni 6 s before voting, rejoined 2 min
// later), and staff characters left out of the citizen count that starts an election (and of rebellion.js's share).
// Loads the real module in a scratch folder against a mock world (Whiterun, no Jarl, a Steward seated); guilds.js's
// faction moves are played through globalThis.__dboCitizenFactionMove, as guilds.js calls it. The last block loads the real
// guilds.js setMember/removeMember path through its hook.
//
//   node tests/election-faction-staff-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE = path.resolve(__dirname, '..', 'citizenship.js');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-elfac-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
let now = Date.UTC(2026, 9, 23, 12, 0);
Date.now = () => now;
const HOUR = 3600000, DAY = 24 * HOUR;

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

// ---- the world ---------------------------------------------------------------------------------------------------------
const ZONES = [{ id: 'whiterun', name: 'Whiterun', treasury: 'y', officials: ['jarl', 'steward', 'commander', 'guard'] }];
const WR = ZONES[0];
const officials = {};
const snow = (t) => ((BigInt(t) - 1420070400000n) << 22n).toString();
const chars = new Map(), backend = new Map(), play = new Map();
const staffChars = new Set(), staffTier = new Set();
let n = 0;
const account = (pid, name) => {
  const actor = 0x1000 + (n++);
  chars.set(actor, { pid, name, race: 'NordRace', discord: snow(Date.UTC(2020, 0, 1) + pid * 1000) });
  backend.set(pid, { profileId: pid, discordId: snow(Date.UTC(2020, 0, 1) + pid * 1000) });
  play.set(pid, { ms: 20 * HOUR, days: 5 });
  return actor;
};
const writeBackend = () => fs.writeFileSync(path.join(dir, 'players.json'), JSON.stringify(Object.fromEntries([...backend.values()].map((r) => [r.discordId, r]))));
globalThis.__dboPlaytimeOf = (pid) => play.get(Number(pid)) || { ms: 0, days: 0 };
// Faction memberships: actor -> [{ id, name, kind }]
const member = new Map();
const FACTIONS = { telvanni: { id: 'telvanni', name: 'House Telvanni', kind: 'faction' }, companions: { id: 'companions', name: 'The Companions', kind: 'faction' } };
globalThis.__dboGuildsOf = (a) => (member.get(a >>> 0) || []).map((g) => Object.assign({ title: 'Member', role: 'member' }, g));
globalThis.__dboGuildInfo = (id) => FACTIONS[id] || null;
globalThis.__dboIsStaff = (a) => staffTier.has(a >>> 0);
// guilds.js order: a leave is told before the roster drops the character, a join after it is written
const joinF = (a, fid) => { member.set(a, (member.get(a) || []).concat([FACTIONS[fid]])); globalThis.__dboCitizenFactionMove('join', fid, a); };
const leaveF = (a, fid) => { globalThis.__dboCitizenFactionMove('leave', fid, a); member.set(a, (member.get(a) || []).filter((g) => g.id !== fid)); };

const mp = { get: (id, p) => {
  const c = chars.get(id >>> 0); if (!c) throw new Error('no such form');
  if (p === 'type') return 'MpActor'; if (p === 'profileId') return c.pid; if (p === 'private.dboStaffChar') return staffChars.has(id >>> 0) ? true : undefined;
  return undefined;
} };
const said = [], audits = [], logs = [];
let timer = null;
let online = [];
let extra = {};
const api = () => ({
  mp, log: (...x) => logs.push(x.join(' ')), audit: (t) => audits.push(t),
  who: (a) => { const c = chars.get(a >>> 0); return c ? `${c.name} (profile ${c.pid})` : `actor ${a}`; },
  display: (a) => (chars.get(a >>> 0) || {}).name,
  personal: (a, t) => said.push([a >>> 0, t]), nameOf: (a) => chars.get(a >>> 0).name, ownNameOf: (a) => chars.get(a >>> 0).name, tagOf: (a) => `T${(a >>> 0).toString(16)}`,
  onUi: () => {}, onlineActors: () => online.slice(), isAdmin: () => false, isLeadStaff: () => false,
  profileOf: (a) => { const c = chars.get(a >>> 0); return c ? c.pid : -1; },
  discordOf: (a) => (chars.get(a >>> 0) || {}).discord || '',
  cfg: { citizenship: { election: Object.assign({ unopposedWins: false, voterRules: { playersFile: path.join(dir, 'players.json'), deviceFile: path.join(dir, 'none.json'), cacheMinutes: 0 } }, extra) } },
  every: (nm, ms, f) => { timer = f; },
  zoneList: () => ZONES, zoneById: (id) => ZONES.find((z) => z.id === String(id)) || null, readOfficials: () => officials,
  rankTitle: (r) => ({ jarl: 'Jarl', steward: 'Steward', commander: 'Lord Commander' })[r] || r,
  officialTarget: (q) => {
    const s = String(q).toLowerCase();
    const hit = [...chars.entries()].find(([, c]) => c.name.toLowerCase() === s);
    return hit ? { pid: hit[1].pid, actor: hit[0], online: 0, label: hit[1].name, who: hit[1].name } : { error: `No character called ${q}.` };
  },
  accountActors: (pid) => [...chars.entries()].filter(([, c]) => c.pid === pid).map(([id]) => id),
  seatOfficial: () => ({ text: 'seated' }), unseatOfficialBy: () => ({ text: 'unseated' }),
  takeGold: () => true, depositToTreasury: (z, x) => x, openWidget: () => true, closeWidget: () => true, boardZoneNear: () => null,
  raceEdidOf: (a) => chars.get(a >>> 0).race,
});
const load = () => { delete require.cache[MODULE]; delete globalThis.__dboCitizen; return require(MODULE)(api()); };
writeBackend();
let M = load();
const nm = (a) => chars.get(a).name;
const join = (a) => { const r = M.join(a, 'whiterun'); if (r.error) throw new Error(r.error); };

// ---- 4b: staff characters do not count -------------------------------------------------------------------------------------
now -= 30 * DAY;
const good = [];
for (let i = 0; i < 14; i++) good.push(account(100 + i, `Citizen ${i}`));
const STAFFCHAR = account(300, 'Trial Slot');        // a staff character (private.dboStaffChar)
const STAFFMAIN = account(301, 'Staff Main');         // a player character of an account whose other character has a staff tier
const STAFFTIER = account(301, 'Staff Alt');
staffChars.add(STAFFCHAR); staffTier.add(STAFFTIER);
writeBackend();
for (const a of good.concat([STAFFCHAR, STAFFMAIN])) join(a);
now += 30 * DAY;
ok(M.citizenAccounts(WR) === 15, '(4b) 16 citizen accounts, the staff character left out: 15', M.citizenAccounts(WR));
ok(globalThis.__dboCitizenAccountCount('whiterun') === 15, "(4b) rebellion.js's citizen count leaves it out the same way", globalThis.__dboCitizenAccountCount('whiterun'));
globalThis.__dboIsStaffCharacter = (a) => (a >>> 0) === good[0];
ok(M.citizenAccounts(WR) === 15 && !M.countedPids(WR).has(100) && M.countedPids(WR).has(300), '(4b) __dboIsStaffCharacter (staffpowers) is asked first when it exists', [...M.countedPids(WR).keys()]);
delete globalThis.__dboIsStaffCharacter;
extra = { staffNotCounted: { enabled: true, staffProfiles: true } }; M = load();
ok(M.citizenAccounts(WR) === 14, '(4b) staffProfiles on: an account with a staff tier on any character is left out too', M.citizenAccounts(WR));
extra = { staffNotCounted: { enabled: false } }; M = load();
ok(M.citizenAccounts(WR) === 16 && globalThis.__dboCitizenAccountCount('whiterun') === 16, '(4b) switched off: every account counts again (rollback)', M.citizenAccounts(WR));
extra = {}; M = load();
// 15 counted: the election starts (threshold 15). Without the rule 16 would; with the staff character it is 15, just enough
M.data().elections = {};
staffChars.add(STAFFMAIN); M = load();
ok(M.citizenAccounts(WR) === 14, '(4b) a second staff character: 14');
timer();
ok(!M.data().elections.whiterun, '(4b) 14 counted accounts start no election, though 16 hold citizenship');
staffChars.delete(STAFFMAIN);

// ---- 4a: faction membership judged when registration opens -------------------------------------------------------------------
const [MIKE, WAS, FAR, LATE, BAND, CLEAN] = good.slice(0, 6);
member.set(WAS, [FACTIONS.companions]);          // in a faction when registration opens
const STEW = good[13];
officials.whiterun = { steward: [chars.get(STEW).pid] };
timer();
let E = M.data().elections.whiterun;
ok(E && E.phase === 'registration', '(4a) 15 counted accounts open registration', E && E.phase);
ok(E.factioned && Array.isArray(E.factioned[WAS.toString(16)]) && E.factioned[WAS.toString(16)][0] === 'The Companions' && Object.keys(E.factioned).length === 1,
  '(4a) the snapshot at registration keeps who served a faction then', E.factioned);
// Mike joins House Telvanni during registration; WAS leaves the Companions
joinF(MIKE, 'telvanni');
leaveF(WAS, 'companions');
// Four more for a court (they serve nothing)
const court = good.slice(8, 12);
let r = M.register(court[0], 'whiterun', court.slice(1).map(nm));
ok(!r.error, 'a court is entered', r);
for (const a of court.slice(1)) M.answerInvite(a, 'whiterun', E.courts[0].id, true);
// a second court so the vote runs
const STAND = account(400, 'Second Jarl'); const s2 = [account(401, 'S2 Steward'), account(402, 'S2 Commander'), account(403, 'S2 Housecarl')];
writeBackend();
for (const a of [STAND, ...s2]) join(a);
r = M.register(STAND, 'whiterun', s2.map(nm));
for (const a of s2) M.answerInvite(a, 'whiterun', E.courts[1].id, true);
now += 25 * HOUR; timer();
E = M.data().elections.whiterun;
ok(E.phase === 'voting' && E.ballot.length === 2, 'the vote opens with two courts', E.phase);
const K = E.ballot[0];
r = M.vote(WAS, 'whiterun', K);
ok(r.error && /served The Companions when the call for courts went out/.test(r.error), '(4a) one who served a faction when registration opened cannot vote, though they left since', r);
r = M.vote(MIKE, 'whiterun', K);
ok(r.error && /serve a faction/.test(r.error), '(4a) one who serves a faction now cannot vote (unchanged)', r);

// ---- 4a: Mike's case: left 6 s before voting, rejoined 2 min after -------------------------------------------------------------
leaveF(MIKE, 'telvanni');
now += 6000;
r = M.vote(MIKE, 'whiterun', K);
ok(!r.error && E.votes['100'] === K, 'he may vote once he has left', r);
ok(E.watch && E.watch['100'] && E.watch['100'].leftName === 'House Telvanni', 'the vote is watched: he left a faction within 24 h', E.watch);
online = [STEW, MIKE];
const before = said.length;
now += 2 * 60000;
joinF(MIKE, 'telvanni');
ok(E.votes['100'] === undefined, '(4a) rejoining 2 min later voids the vote', E.votes);
ok(E.struckVotes && E.struckVotes['100'] && /automatic/.test(E.struckVotes['100'].by) && /left House Telvanni 0 h 0 m before voting and joined House Telvanni 0 h 2 m after/.test(E.struckVotes['100'].reason),
  '(4a) recorded as a struck vote with the reason', E.struckVotes);
ok(audits.some((t) => /ELECTION Whiterun: the vote of Citizen 0 \(profile 100, round 1\) is void: left House Telvanni/.test(t)), '(4a) audited', audits.slice(-2));
ok(said.slice(before).some(([a, t]) => a === STEW && /vote of Citizen 0 in the election of Whiterun is void/.test(t)), "(4a) the hold's court (its Steward, online) is told", said.slice(before));
ok(said.slice(before).some(([a, t]) => a === MIKE && /Your vote in the election of Whiterun is void/.test(t)), '(4a) the voter is told');
leaveF(MIKE, 'telvanni');
r = M.vote(MIKE, 'whiterun', K);
ok(r.error && /struck/.test(r.error), '(4a) he cannot vote again in this election', r);

// ---- 4a: not voided ------------------------------------------------------------------------------------------------------------
// Left 30 h before the vote: outside the 24 h
member.set(FAR, [FACTIONS.companions]); leaveF(FAR, 'companions');
M.data().factionMoves[FAR.toString(16)].at = now - 30 * HOUR;
r = M.vote(FAR, 'whiterun', K);
joinF(FAR, 'companions');
ok(!r.error && E.votes['102'] === K, '(4a) a leave 30 h before the vote is no rejoin: the vote stands', E.votes['102']);
// Left 1 h before, rejoined 25 h after: outside the 24 h (the vote runs long here)
member.set(LATE, [FACTIONS.telvanni]); leaveF(LATE, 'telvanni');
now += HOUR;
r = M.vote(LATE, 'whiterun', K);
ok(!r.error && E.watch['103'], 'a vote one hour after a leave is watched');
E.phaseEndsAt = now + 48 * HOUR;
now += 25 * HOUR; timer();
ok(!E.watch['103'], 'the watch ends after 24 h');
joinF(LATE, 'telvanni');
ok(E.votes['103'] === K, '(4a) a rejoin 25 h after the vote leaves it standing');
// Never left anything: joining after voting is not a rejoin
r = M.vote(CLEAN, 'whiterun', K);
joinF(CLEAN, 'companions');
ok(!r.error && E.votes['105'] === K, '(4a) one who never left a faction and joins one after voting keeps the vote');
// A player guild (band) is no faction for the vote: guildsOf leaves bands out, so its moves are not watched
globalThis.__dboCitizenFactionMove('leave', 'some-band', BAND);
ok(!M.data().factionMoves[BAND.toString(16)], '(4a) a move in a guild the vote ignores is not kept');

// ---- 4a: a rejoin after the round was counted, the court offline: kept for the Steward's login -------------------------------
const AFTER = good[6];
member.set(AFTER, [FACTIONS.telvanni]); leaveF(AFTER, 'telvanni');
r = M.vote(AFTER, 'whiterun', K);
E.phaseEndsAt = now; timer();
E = M.data().elections.whiterun;
online = [];
joinF(AFTER, 'telvanni');
ok(audits.some((t) => /vote of Citizen 6 .*was already counted; staff review it/.test(t)), '(4a) after the count: audited for the staff instead', audits.slice(-3));
ok(Array.isArray(M.data().courtNotices.whiterun) && M.data().courtNotices.whiterun.length === 1, '(4a) the court is offline: the notice is kept');
const b2 = said.length;
M.noticeLogin(STEW);
ok(said.slice(b2).some(([a, t]) => a === STEW && /Citizen 6 left House Telvanni just before voting/.test(t)) && !M.data().courtNotices.whiterun, '(4a) told to the Steward at login, once');

// ---- 4a: switched off ------------------------------------------------------------------------------------------------------------
extra = { factionGuard: { enabled: false } }; M = load();
delete M.data().elections.whiterun;
member.set(WAS, [FACTIONS.companions]);
timer();
E = M.data().elections.whiterun;
ok(E && E.phase === 'registration' && !E.factioned, '(4a) factionGuard off: no snapshot at registration (rollback)', E && E.factioned);
leaveF(good[7], 'telvanni');
ok(!M.data().factionMoves[good[7].toString(16)], '(4a) factionGuard off: no moves kept');
extra = {}; M = load();

// ---- the real guilds.js tells citizenship.js its joins and leaves -----------------------------------------------------------------
{
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'guilds.js'), 'utf8');
  ok(/if \(!had\) factionMoved\('join', fid, a\);/.test(src) && /const removeMember = \(fid, a\) => \{ if \(entryOf\(fid, a\)\) factionMoved\('leave', fid, a\); delete/.test(src),
    'guilds.js: setMember tells a new join after the write, removeMember a leave before the delete');
}

// ---- the shipped config ----------------------------------------------------------------------------------------------------------
{
  const shipped = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'gamemode-config.json'), 'utf8')).citizenship.election;
  ok(shipped.factionGuard && shipped.factionGuard.enabled === true && shipped.factionGuard.leftHours === 24 && shipped.factionGuard.rejoinHours === 24 && shipped.factionGuard.snapshotAtRegistration === true,
    'gamemode-config.json ships factionGuard on, 24 h each way, the snapshot on', shipped.factionGuard);
  ok(shipped.staffNotCounted && shipped.staffNotCounted.enabled === true && shipped.staffNotCounted.staffProfiles === false, 'gamemode-config.json ships staffNotCounted on, staffProfiles off', shipped.staffNotCounted);
  ok(shipped.voterRules.oneVotePerDevice === false, 'one vote per PC stays off');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exitCode = fails ? 1 : 0;
