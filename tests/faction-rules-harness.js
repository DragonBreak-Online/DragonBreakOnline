// No double dipping (Nat, 31 Oct; guilds.js factions.rules, leadership.js cooldownDays): no two characters of one account
// in one faction, a hold's leader joins only a college or a church besides the hold, a secret faction's member is in that
// one only (a college or a church apart), the classes, nobody removed, enabled false, and the two-week wait after losing an
// office. The real guilds.js, guild-defs.json and gamemode-config.json and the real leadership.js, stub api, temp folder.
//
//   node tests/faction-rules-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GUILDS = path.join(ROOT, 'guilds.js');
const LEADERSHIP = path.join(ROOT, 'leadership.js');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-faction-rules-'));
fs.copyFileSync(path.join(ROOT, 'guild-defs.json'), path.join(dir, 'guild-defs.json'));
const home = process.cwd();
process.chdir(dir);

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

// ---- the classes ---------------------------------------------------------------------------------------------------
const R = (CFG.factions || {}).rules || {};
ok('factions.rules is on, with a college and a church alongside', R.enabled === true && (R.alongside || []).join() === 'college,church');
ok('the Knights of the Nine are militant, not a church (Nat)', R.classes['knights-of-the-nine'] === 'militant' && R.classes['imperial-cult'] === 'church');

// ---- the stub server -----------------------------------------------------------------------------------------------
const LEAD = 0x10, ALT1 = 0x20, ALT2 = 0x21, OTHER = 0x22, JARL = 0x23, THIEF = 0x24, FIGHTER = 0x25, MAGE = 0x26, PRIMATE = 0x27, KNIGHT = 0x28, VIG = 0x29;
const names = { [LEAD]: 'Lead', [ALT1]: 'Alt One', [ALT2]: 'Alt Two', [OTHER]: 'Other', [JARL]: 'Jarl', [THIEF]: 'Thief', [FIGHTER]: 'Fighter',
  [MAGE]: 'Mage', [PRIMATE]: 'Primate', [KNIGHT]: 'Knight', [VIG]: 'Vigilant' };
const PROFILE = { [ALT1]: 7, [ALT2]: 7 };   // two characters of one account; everyone else their own
const chars = new Map(Object.entries(names).map(([k, v]) => [Number(k), v]));
const said = [], commands = {}, handlers = {}, props = new Map();
const api = {
  mp: { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v) },
  log: () => {}, personal: (a, t) => said.push({ a, t }), system: () => {}, audit: () => {},
  registerChatCommand: (n, f) => { commands[n] = f; }, onUi: (e, f) => { (handlers[e] = handlers[e] || []).push(f); },
  openWidget: () => {}, closeWidget: () => {},
  display: (a) => `${chars.get(a)} #T${a.toString(16)}`, nameOf: (a) => chars.get(a) || 'Stranger', tagOf: (a) => `T${a.toString(16)}`,
  onlineActors: () => [...chars.keys()], isAdmin: (a) => a === LEAD, isLeadStaff: (a) => a === LEAD,
  findByName: (q) => [...chars.entries()].find(([, n]) => n.toLowerCase() === String(q).toLowerCase())?.[0] || 0,
  who: (a) => `${chars.get(a)} (profile ${PROFILE[a] || a})`, cfg: CFG, profileOf: (a) => PROFILE[a] || a,
  accountActors: (pid) => [...chars.keys()].filter((a) => (PROFILE[a] || a) === pid),
};
// The Jarl rules Whiterun (leadership.js's view of court offices)
globalThis.__dboLeadershipOf = (a) => (a === JARL ? [{ kind: 'hold', id: 'whiterun', name: 'Jarl of Whiterun', actor: JARL }] : []);
for (const a of [PRIMATE, KNIGHT, FIGHTER, MAGE, JARL, THIEF]) props.set(`${a}|private.dboDeity`, { id: 'akatosh', kind: 'divine' });
const load = (cfg, members) => {
  fs.writeFileSync(path.join(dir, 'guilds.json'), JSON.stringify(members || {}));
  delete require.cache[GUILDS]; delete globalThis.__dboGuildState; api.cfg = cfg || CFG; require(GUILDS)(api);
};
const M = () => globalThis.__dboGuildState.members;
const inF = (fid, a) => !!(M()[fid] || {})[String(a)];
const put = (fid, a, rank) => { const f = globalThis.__dboGuildRankList(fid); M()[fid] = M()[fid] || {}; M()[fid][String(a)] = { rank: rank === undefined ? f.length - 1 : rank, name: names[a], tag: `T${a.toString(16)}`, since: 1 }; };
const chat = (a, line) => { said.length = 0; commands.faction(a, line); return (said[said.length - 1] || {}).t || ''; };
const invite = (a, t, fid) => globalThis.__dboGuildInvite(a, t, fid);
const accept = (t, fid) => chat(t, `accept ${fid}`);
const leaderOf = (fid, a) => put(fid, a, 0);

// ---- nobody removed: an account already twice in a faction keeps both -------------------------------------------------
load(CFG, { 'fighters-guild': { [ALT1]: { rank: 3, name: 'Alt One', tag: 'T20', since: 1 }, [ALT2]: { rank: 3, name: 'Alt Two', tag: 'T21', since: 1 } } });
ok('two characters of one account already in one faction both keep their place at load', inF('fighters-guild', ALT1) && inF('fighters-guild', ALT2));

// ---- one character per account in a faction ---------------------------------------------------------------------------
load(CFG, {});
leaderOf('fighters-guild', FIGHTER); leaderOf('companions', OTHER); leaderOf('college-of-winterhold', MAGE); leaderOf('imperial-cult', PRIMATE);
leaderOf('thieves-guild', LEAD); leaderOf('knights-of-the-nine', KNIGHT); leaderOf('vigil-of-stendarr', VIG);
put('fighters-guild', ALT1);
let r = invite(FIGHTER, ALT2, 'fighters-guild');
ok('a second character of the same account is refused, told why, the other character not named to a player', r.error && /another character of the same account is in it\. One character per account/.test(r.error) && !/Alt One/.test(r.error), r);
r = invite(LEAD, ALT2, 'fighters-guild');
ok('...staff are told which character', r.error && /\(Alt One/.test(r.error), r);
r = invite(OTHER, ALT2, 'companions');
ok('...another faction is fine', !r.error, r);
put('hold-whiterun', ALT1);   // a citizen, role member
r = invite(LEAD, ALT2, 'hold-whiterun');
ok("a hold's citizens are not counted: both characters may live in Whiterun", !r.error || !/same account/.test(r.error), r);

// ---- a hold's leader: the hold, and a college or a church ---------------------------------------------------------------
r = invite(FIGHTER, JARL, 'fighters-guild');
ok("the Jarl is refused the Fighters Guild, told the hold comes first", r.error && /Jarl of Whiterun\. A hold's leader puts the hold first: besides it, only a college or a church/.test(r.error), r);
r = invite(MAGE, JARL, 'college-of-winterhold');
ok('...a college is fine', !r.error, r);
r = invite(PRIMATE, JARL, 'imperial-cult');
ok('...a church is fine', !r.error, r);
r = invite(KNIGHT, JARL, 'knights-of-the-nine');
ok('...the Knights of the Nine are militant, not a church: refused', r.error && /hold first/.test(r.error), r);
r = invite(VIG, JARL, 'vigil-of-stendarr');
ok('...the Vigil too', r.error && /hold first/.test(r.error), r);
ok("the court's own check refuses an office to a Fighter", /serves the Fighters Guild\. A hold's leader puts the hold first/.test(globalThis.__dboFactionRulesHoldSeat(FIGHTER, 'whiterun')));
ok('...and lets a Mage of the College take one', globalThis.__dboFactionRulesHoldSeat(MAGE, 'whiterun') === '');

// ---- a secret faction is the only one ----------------------------------------------------------------------------------
put('thieves-guild', THIEF);
r = invite(FIGHTER, THIEF, 'fighters-guild');
ok("a Thief's invitation to the Fighters Guild goes out (the inviter is not told of the Thieves Guild)", !r.error, r);
const ta = accept(THIEF, 'fighters-guild');
ok('...and the Thief is refused at accept, in their own words', /You serve the Thieves Guild, and a secret faction is its members' only one/.test(ta) && !inF('fighters-guild', THIEF), ta);
r = invite(MAGE, THIEF, 'college-of-winterhold');
ok('...a college is fine beside a secret faction', !r.error, r);
r = invite(LEAD, FIGHTER, 'thieves-guild');
ok('a Fighter is refused the Thieves Guild openly (the Fighters Guild is no secret)', r.error && /serves the Fighters Guild, and the Thieves Guild takes no one who serves another faction/.test(r.error), r);
put('dark-brotherhood', OTHER, 0);
r = invite(LEAD, THIEF, 'dark-brotherhood');
ok('...and one secret faction to another', !!r.error, r);

// ---- off ---------------------------------------------------------------------------------------------------------------
const off = JSON.parse(JSON.stringify(CFG)); off.factions.rules.enabled = false; off.factions.limits.enabled = false;
const keep = JSON.parse(JSON.stringify(M()));
load(off, keep);
r = invite(FIGHTER, ALT2, 'fighters-guild');
ok('enabled false: the account rule is off', !r.error || !/same account/.test(r.error), r);
r = invite(FIGHTER, JARL, 'fighters-guild');
ok('...and the hold rule', !r.error || !/hold first/.test(r.error), r);

// ---- the wait after losing an office (leadership.js) ----------------------------------------------------------------
const COOL = path.join(dir, 'leadership-cooldowns.json');
const seats = new Map([[0xff000301, 'fighters-guild'], [0xff000302, 'companions']]);
globalThis.__dboGuildsOf = (a) => (seats.has(a >>> 0) ? [{ id: seats.get(a >>> 0), name: seats.get(a >>> 0), kind: 'guild', role: 'leader', shown: 'Leader' }] : []);
globalThis.__dboGuildLeaders = () => [...seats.entries()].map(([actor, id]) => ({ id, name: id, kind: 'guild', title: 'Leader', actor, pid: actor & 0xff }));
let now = Date.now(); const realNow = Date.now; Date.now = () => now;
delete require.cache[LEADERSHIP];
require(LEADERSHIP)({ log: () => {}, personal: () => {}, audit: () => {}, who: String, display: (a) => `Leader ${(a >>> 0).toString(16)}`, nameOf: String,
  profileOf: (a) => a & 0xff, onlineActors: () => [], accountActors: () => [], registerChatCommand: () => {}, isAdmin: () => false, isLeadStaff: () => false,
  ranksOf: () => [], rankTitle: String, rulerSeats: () => [], leadershipSweep: false, cooldownStatePath: COOL, cfg: { leadership: {} } });
const refuse = (a) => globalThis.__dboLeadershipRefusal(a, { kind: 'faction', id: 'dawnguard' });
ok('the first look records who holds a seat; nobody is waiting', refuse(0xff000303) === '' && JSON.parse(fs.readFileSync(COOL, 'utf8')).held.length === 2);
seats.delete(0xff000301);   // dethroned
now += 3600000;
const w = refuse(0xff000301);
ok('a leader who lost their seat is refused another, told how long', /After losing an office, a character waits 14 days before taking another: 14 more day/.test(w), w);
ok('...someone who never held one is not', refuse(0xff000303) === '');
now += 13 * 86400000;
ok('...still refused on day 13', /1 more day/.test(refuse(0xff000301)), refuse(0xff000301));
now += 86400000 + 1000;
ok('...free after 14 days', refuse(0xff000301) === '', refuse(0xff000301));
seats.set(0xff000304, 'dawnguard'); refuse(0xff000303);   // a new leader, seen
seats.delete(0xff000304); seats.set(0xff000304, 'companions'); seats.delete(0xff000302);
now += 60000;
ok('moving from one seat to another is no loss', /waits 14 days/.test(refuse(0xff000302)) && refuse(0xff000305) === '' && !/waits/.test(globalThis.__dboLeadershipRefusal(0xff000304, { kind: 'faction', id: 'companions' })));
Date.now = realNow;

process.chdir(home);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ }
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
