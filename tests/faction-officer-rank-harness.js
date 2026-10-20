// A rank below the leader that carries setRank (the officer role) promotes only beneath itself (guilds.js setRankOf;
// fabled_is_me, #suggestions 19 Oct: "if a faction leader isn't online no one can promote"). An officer may raise and
// lower anyone below their own rank, never to the leader's rank, never someone of their own rank or above, and never
// above themselves; the leader and a Lead GM are bound by none of it. In a hold or a stronghold the ranks follow the
// court's offices, so only the Jarl or Count sets them and the panel does not offer the control.
// Real guilds.js and guild-defs.json, stub api, in a temp folder.
//
//   node tests/faction-officer-rank-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GUILDS = path.join(ROOT, 'guilds.js');
if (!/You can promote only below your own rank/.test(fs.readFileSync(GUILDS, 'utf8'))) {
  require('./expect')('faction-officer-rank', 'guilds.js has no officer rank guard');
  console.log('ok   skipped: guilds.js has no officer rank guard'); process.exit(0);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-officer-rank-'));
fs.copyFileSync(path.join(ROOT, 'guild-defs.json'), path.join(dir, 'guild-defs.json'));
const DEFS = JSON.parse(fs.readFileSync(path.join(ROOT, 'guild-defs.json'), 'utf8'));
process.chdir(dir);

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

const LEAD = 0x10, BOSS = 0x14, OFFICER = 0x15, MATE = 0x16, OTHER = 0x17, JARL = 0x18, STEWARD = 0x19, CITIZEN = 0x1a;
const chars = new Map([[LEAD, 'Lead'], [BOSS, 'Boss'], [OFFICER, 'Officer'], [MATE, 'Mate'], [OTHER, 'Other'],
  [JARL, 'Jarl'], [STEWARD, 'Steward'], [CITIZEN, 'Citizen']]);
const onlineSet = new Set(chars.keys());
const told = [], audits = [], drawn = [];
const handlers = {};
const props = new Map();
const api = {
  mp: { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v) },
  log: () => {}, personal: () => {}, system: (a, t) => told.push({ a, t }), audit: (t) => audits.push(t),
  registerChatCommand: () => {}, onUi: (e, f) => { (handlers[e] = handlers[e] || []).push(f); },
  openWidget: (a, p) => drawn.push({ a, p }), closeWidget: () => {},
  display: (a) => `${chars.get(a)} #T${a.toString(16)}`, nameOf: (a) => chars.get(a) || 'Stranger', tagOf: (a) => `T${a.toString(16)}`,
  onlineActors: () => [...onlineSet], isAdmin: (a) => a === LEAD, isLeadStaff: (a) => a === LEAD,
  findByName: (q) => [...chars.entries()].find(([id, n]) => onlineSet.has(id) && n.toLowerCase() === String(q).toLowerCase())?.[0] || 0,
  findAnyByName: (q) => [...chars.entries()].find(([, n]) => n.toLowerCase() === String(q).toLowerCase().replace(/^#/, ''))?.[0] || 0,
  who: (a) => `${chars.get(a)} (profile ${a})`, cfg: {}, profileOf: (a) => a,
};
delete require.cache[GUILDS]; delete globalThis.__dboGuildState; require(GUILDS)(api);

const GUILD = 'fighters-guild', HOLD = 'hold-whiterun';
const nonce = (a) => globalThis.__dboGuildState.nonces.get(a >>> 0);
const payload = (a) => globalThis.__dboFactionPayload(a, false);
const send = (ev, a, ...args) => { drawn.length = 0; for (const f of handlers[ev] || []) f(a, [nonce(a)].concat(args)); const d = drawn[drawn.length - 1]; return d ? d.p : null; };
const rosterOf = (fid) => globalThis.__dboGuildState.members[fid] || {};
const rankOf = (fid, a) => (rosterOf(fid)[String(a)] || {}).rank;
const setRank = (a, fid, t, rank) => globalThis.__dboGuildSetRank(a, fid, t, rank, false);
const titles = (fid) => { const f = DEFS.factions.find((x) => x.id === fid); return (f.ranks || DEFS.templates[f.template]).map((r) => r.title); };

// ---- a guild: leader, an officer (Champion, 1) and two below ---------------------------------------------------------
payload(LEAD);
for (const [who, name] of [[BOSS, 'Boss'], [OFFICER, 'Officer'], [MATE, 'Mate'], [OTHER, 'Other']]) send('factionAdd', LEAD, GUILD, name);
setRank(LEAD, GUILD, BOSS, 0);
setRank(LEAD, GUILD, OFFICER, 1);
const LOW = titles(GUILD).length - 1;
ok('setup: a Guildmaster at 0, a Champion at 1, two members at the bottom',
  rankOf(GUILD, BOSS) === 0 && rankOf(GUILD, OFFICER) === 1 && rankOf(GUILD, MATE) === LOW && rankOf(GUILD, OTHER) === LOW,
  [rankOf(GUILD, BOSS), rankOf(GUILD, OFFICER), rankOf(GUILD, MATE), rankOf(GUILD, OTHER)]);
ok('the officer role carries setRank in the defs', DEFS.roles.officer.setRank === true, DEFS.roles.officer);

// ---- what the officer may do ----------------------------------------------------------------------------------------
let r = setRank(OFFICER, GUILD, MATE, 6);
ok('an officer promotes a member below itself', !r.error && rankOf(GUILD, MATE) === 6, r);
ok('the promoted member is told', told.some((t) => t.a === MATE && /You are now Swordsman of/.test(t.t)), told.slice(-1));
ok('the audit names the officer', audits.some((t) => /FACTION Officer \(profile 21\) made Mate Swordsman of/.test(t)), audits.slice(-1));
r = setRank(OFFICER, GUILD, MATE, LOW);
ok('and can lower them again', !r.error && rankOf(GUILD, MATE) === LOW, r);
r = setRank(OFFICER, GUILD, MATE, 2);
ok('up to the rank just below its own', !r.error && rankOf(GUILD, MATE) === 2, r);

// ---- what it may not --------------------------------------------------------------------------------------------
r = setRank(OFFICER, GUILD, OTHER, 1);
ok('an officer cannot make another officer of its own rank', !!r.error && /only below your own rank of Champion/.test(r.error) && rankOf(GUILD, OTHER) === LOW, r);
r = setRank(OFFICER, GUILD, OTHER, 0);
ok('an officer cannot name a leader', !!r.error && /Only the Guildmaster names a new Guildmaster/.test(r.error) && rankOf(GUILD, BOSS) === 0, r);
r = setRank(OFFICER, GUILD, BOSS, 4);
ok('an officer cannot touch the leader', !!r.error && /equal or higher rank/.test(r.error) && rankOf(GUILD, BOSS) === 0, r);
r = setRank(OFFICER, GUILD, MATE, 1);
ok('nor raise someone it already promoted to its own rank', !!r.error && rankOf(GUILD, MATE) === 2, r);
setRank(LEAD, GUILD, OTHER, 1);
r = setRank(OFFICER, GUILD, OTHER, 5);
ok('an officer cannot demote an equal', !!r.error && /equal or higher rank/.test(r.error) && rankOf(GUILD, OTHER) === 1, r);
r = setRank(MATE, GUILD, OTHER, 6);
ok('a rank without setRank is refused outright', !!r.error && /does not set ranks/.test(r.error), r);

// ---- the leader and staff are unbound ------------------------------------------------------------------------------
r = setRank(BOSS, GUILD, OTHER, 1);
ok('the leader still sets any rank', !r.error && rankOf(GUILD, OTHER) === 1, r);
r = setRank(BOSS, GUILD, MATE, 0);
ok('the leader can hand leadership over, stepping down one rank', !r.error && rankOf(GUILD, MATE) === 0 && rankOf(GUILD, BOSS) === 1, [rankOf(GUILD, MATE), rankOf(GUILD, BOSS)]);
r = setRank(LEAD, GUILD, OTHER, 0);
ok('a Lead GM sets the leader rank too', !r.error && rankOf(GUILD, OTHER) === 0, r);

// ---- a hold: the ranks follow the court ----------------------------------------------------------------------------
payload(LEAD);
for (const [, name] of [[JARL, 'Jarl'], [STEWARD, 'Steward'], [CITIZEN, 'Citizen']]) send('factionAdd', LEAD, HOLD, name);
setRank(LEAD, HOLD, JARL, 0);
setRank(LEAD, HOLD, STEWARD, 1);
const HOLD_LOW = titles(HOLD).length - 1;
ok('setup: a Jarl at 0, a Steward at 1, a Citizen at the bottom',
  rankOf(HOLD, JARL) === 0 && rankOf(HOLD, STEWARD) === 1 && rankOf(HOLD, CITIZEN) === HOLD_LOW,
  [rankOf(HOLD, JARL), rankOf(HOLD, STEWARD), rankOf(HOLD, CITIZEN)]);
r = setRank(STEWARD, HOLD, CITIZEN, 8);
ok("a hold's Steward does not set ranks: they follow the court's offices",
  !!r.error && /follow the court's offices: the Jarl appoints them/.test(r.error) && rankOf(HOLD, CITIZEN) === HOLD_LOW, r);
r = setRank(JARL, HOLD, CITIZEN, 8);
ok('the Jarl still does', !r.error && rankOf(HOLD, CITIZEN) === 8, r);

// ---- the panel flag matches the refusal -----------------------------------------------------------------------------
const flagOf = (a, fid) => (payload(a).factions.find((f) => f.id === fid) || {}).canSetRank;
ok('the panel offers the control to a guild officer', flagOf(OFFICER, GUILD) === true, flagOf(OFFICER, GUILD));
ok("but not to a hold's Steward", flagOf(STEWARD, HOLD) === false, flagOf(STEWARD, HOLD));
ok('the Jarl keeps it', flagOf(JARL, HOLD) === true, flagOf(JARL, HOLD));
ok('a plain member never had it', flagOf(CITIZEN, HOLD) !== true, flagOf(CITIZEN, HOLD));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
