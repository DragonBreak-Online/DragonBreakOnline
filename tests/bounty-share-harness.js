// Bounty hunting shares (server\outlaws.js, Nate 18-19 Oct): of a bounty paid at the hold's jail, outlaws.hunterShare
// (0.25) goes to the treasury of the faction of whoever brought the outlaw in and the guard who locks the door keeps the
// rest; the hold takes no cut. Time served pays no share; staff, the hold's own officials, members of no faction, the
// hold's own faction, the outlaw's own faction and a refused deposit leave it all with the jailer. /bounty pay is unchanged. Run from server/ with a temp state folder:
//   node tests/bounty-share-harness.js
'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'outlaws.js');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-bountyshare-'));
process.chdir(dir);
let fails = 0; const ok = (l, c, g) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${l}${!c && g !== undefined ? `: got ${JSON.stringify(g)}` : ''}`); if (!c) fails++; };
const COUNTESS = 0x10, GUARD = 0x12, OUTLAW = 0x13, LEGIONARY = 0x14, LONER = 0x15, STAFFER = 0x16, MULTI = 0x17, FG_LEAD = 0x18, CULTIST = 0x19, SWORD = 0x1a;
const chars = { [COUNTESS]: [70, 'Frigga'], [GUARD]: [191, 'Dreams'], [OUTLAW]: [99, 'Rogue'], [LEGIONARY]: [55, 'Pell'], [LONER]: [56, 'Lone'],
  [STAFFER]: [2, 'Nate'], [MULTI]: [57, 'Multi'], [FG_LEAD]: [58, 'Eadric'], [CULTIST]: [59, 'Cult'], [SWORD]: [60, 'Blade'] };
// Memberships as guilds.js __dboGuildsOf gives them
const GUILDS = {
  [LEGIONARY]: [{ id: 'imperial-legion', name: 'Imperial Legion', title: 'Legionary', role: 'member' }, { id: 'bards-college', name: 'Bards College', title: 'Bard', role: 'member' }],
  [MULTI]: [{ id: 'bards-college', name: 'Bards College', title: 'Bard', role: 'member' }, { id: 'companions', name: 'Companions', title: 'Harbinger', role: 'leader' }],
  [FG_LEAD]: [{ id: 'fighters-guild', name: 'Fighters Guild', title: 'Guildmaster', role: 'leader' }],
  [CULTIST]: [{ id: 'cult-namira', name: 'Cult of Namira', title: 'Devotee', role: 'member' }],
  [OUTLAW]: [{ id: 'cult-namira', name: 'Cult of Namira', title: 'Devotee', role: 'member' }],
  [SWORD]: [{ id: 'county-bruma', name: 'County of Bruma', title: 'Citizen', role: 'member' }],
  [STAFFER]: [{ id: 'fighters-guild', name: 'Fighters Guild', title: 'Member', role: 'member' }],
};
const RANKS = { 'bards-college': ['Master', 'Bard', 'Student'], companions: ['Harbinger', 'Circle', 'Whelp'], 'fighters-guild': ['Guildmaster', 'Member'] };
globalThis.__dboGuildsOf = (a) => GUILDS[a] || [];
globalThis.__dboGuildRankList = (id) => (RANKS[id] || []).map((title, i) => ({ title, role: i === 0 ? 'leader' : 'member' }));
globalThis.__dboHoldFactionOf = (z) => (z === 'bruma' ? 'county-bruma' : null);
globalThis.__dboIsStaff = (a) => a === STAFFER;
const props = new Map(); const said = []; const sys = []; const audits = []; const holdIn = []; const facIn = [];
const gold = (a) => { const inv = props.get(`${a}|inventory`); const g = ((inv && inv.entries) || []).find((e) => e.baseId === 0xf); return g ? g.count : 0; };
const setGold = (a, n) => props.set(`${a}|inventory`, { entries: n > 0 ? [{ baseId: 0xf, count: n }] : [] });
const mp = { get: (a, k) => props.get(`${a}|${k}`), set: (a, k, v) => props.set(`${a}|${k}`, v) };
globalThis.__dboBankTake = (a, n) => { const b = Number(props.get(`${a}|private.bankGold`)) || 0; const t = Math.min(b, n); props.set(`${a}|private.bankGold`, b - t); return t; };
globalThis.__dboTreasuryZone = { deposit: (z, n, o) => { holdIn.push({ z, n, income: o && o.income }); return n; } };
let refuse = false;
globalThis.__dboTreasury = { deposit: (fid, n, why, o) => { if (refuse) return false; facIn.push({ fid, n, why, income: o && o.income }); return true; } };
var cmd;
require(MODULE)({
  mp, log: () => {}, personal: (a, t) => said.push([a, t]), system: (a, t) => sys.push([a, t]), audit: (t) => audits.push(t),
  who: (a) => chars[a][1], display: (a) => chars[a][1], cfg: {}, registerChatCommand: (n, f) => { cmd = f; },
  zoneOfActor: () => 'bruma', zoneById: (id) => ({ bruma: { id: 'bruma', name: 'Bruma', officials: ['count', 'steward', 'guard'] } })[id] || null,
  readOfficials: () => ({ bruma: { count: [70], guard: [191] } }), profileOf: (a) => (chars[a] ? chars[a][0] : -1),
  officialTarget: (q) => { const e = Object.entries(chars).find(([, c]) => c[1].toLowerCase() === String(q).toLowerCase()); return e ? { pid: e[1][0], actor: Number(e[0]), online: Number(e[0]), label: e[1][1], who: e[1][1] } : { error: 'none' }; },
  onlineActors: () => Object.keys(chars).map(Number), giveItem: (a, b, n) => setGold(a, gold(a) + n), isLeadStaff: (a) => a === STAFFER, onUi: () => {},
});
const reset = () => { holdIn.length = 0; facIn.length = 0; said.length = 0; audits.length = 0; };
// The Countess puts a bounty on Rogue; Rogue carries `carry` gold; jailed by GUARD, brought in by `by`
const jailWith = (amount, carry, by) => {
  cmd(COUNTESS, `set Rogue ${amount} theft`); setGold(OUTLAW, carry); props.set(`${OUTLAW}|private.bankGold`, 0); setGold(GUARD, 0); reset();
  return globalThis.__dboOutlawJailed(GUARD, OUTLAW, by);
};

// A legionary brings Rogue in: 400 paid, 100 to the Legion (a hunter faction, picked over the Bards), 300 to the jailer
let extra = jailWith(400, 400, LEGIONARY);
ok('legionary: 25% of the paid bounty to the Imperial Legion\'s treasury', facIn.length === 1 && facIn[0].fid === 'imperial-legion' && facIn[0].n === 100 && facIn[0].income === 'bounty share', facIn);
ok('...the guard who locked the door keeps the other 300, personally', gold(GUARD) === 300, gold(GUARD));
ok('...the hold gets no cut, and no gold is printed (100 + 300 = 400)', holdIn.length === 0 && gold(OUTLAW) === 0 && extra === 0, holdIn);
ok('...the share is audited', audits.some((t) => /BOUNTY share: 100 gold .* imperial-legion, brought in by Pell .*jailer Dreams kept 300/.test(t)), audits);
ok('...the claim audit names who brought them in', audits.some((t) => /BOUNTY claimed: .*by Dreams, brought in by Pell: 400 gold, 400 paid \(300 paid to the jailer, 100 share to imperial-legion\)/.test(t)), audits);
ok('...the jailer is told', said.some(([a, t]) => a === GUARD && /You collect 300 gold of the bounty; 100 went to the treasury of Imperial Legion/.test(t)));
ok('...and the arrester hears where the share went', said.some(([a, t]) => a === LEGIONARY && /100 gold of the bounty went to the treasury of Imperial Legion/.test(t)));

// Partly paid: 200 of 400, the rest served. Share only of what was paid
extra = jailWith(400, 200, FG_LEAD);
ok('partly paid: 50 (25% of the 200 paid) to the Fighters Guild, 150 to the jailer', facIn[0] && facIn[0].fid === 'fighters-guild' && facIn[0].n === 50 && gold(GUARD) === 150 && !holdIn.length, [facIn, gold(GUARD)]);
ok('...the unpaid 200 is 20 minutes', extra === 20, extra);
ok('...the Fighters Guild\'s leader (online) is told', said.some(([a, t]) => a === FG_LEAD && /50 gold of the bounty went to the treasury of Fighters Guild/.test(t)));

// Nothing paid: served as time, no share
extra = jailWith(300, 0, LEGIONARY);
ok('served as time: no share, nothing to anyone', facIn.length === 0 && holdIn.length === 0 && gold(GUARD) === 0 && extra === 30, [facIn, holdIn, extra]);

// No hunter faction, several memberships: the highest ranked (Harbinger, the Companions' leader, over a Bard)
jailWith(100, 100, MULTI);
ok('several factions, none a hunter faction: the one they rank highest in', facIn[0] && facIn[0].fid === 'companions' && facIn[0].n === 25 && gold(GUARD) === 75, facIn);

// Exactly one faction
jailWith(100, 100, FG_LEAD);
ok('one faction: that one', facIn[0] && facIn[0].fid === 'fighters-guild' && gold(GUARD) === 75);

// No share: the jailer keeps all of it, the hold nothing
const allToJailer = (label, by, re) => { jailWith(100, 100, by); ok(label, facIn.length === 0 && holdIn.length === 0 && gold(GUARD) === 100 && (!re || audits.some((t) => re.test(t))), [facIn, holdIn, gold(GUARD), audits]); };
allToJailer('no faction: all 100 to the jailer, nothing to the arrester', LONER, /100 paid to the jailer, no share \(Lone belongs to no faction\)/);
ok('...the arrester gets nothing personally', gold(LONER) === 0);
allToJailer('a guard of the hold brought them in: all to the jailer', GUARD, /serves Bruma itself/);
allToJailer('the hold\'s own faction: all to the jailer', SWORD, /County of Bruma is Bruma's own/);
allToJailer('staff arrest: no share, all to the jailer', STAFFER, /staff arrests earn no share/);
allToJailer('the outlaw\'s own faction: no share, all to the jailer', CULTIST, /the outlaw shares their factions/);
allToJailer('no arrester given (an older jail.js): the guard at the door counts, all to the jailer', undefined);
refuse = true; allToJailer('a refused share: all 100 to the jailer', LEGIONARY, /would not take it/); refuse = false;

// Self-paid (/bounty pay): as live, all to the hold's treasury, no share
cmd(COUNTESS, 'set Rogue 80 again'); setGold(OUTLAW, 80); reset(); cmd(OUTLAW, 'pay');
ok('/bounty pay: all to the hold\'s treasury as before, no share', facIn.length === 0 && holdIn.length === 1 && holdIn[0].n === 80 && holdIn[0].income === 'bounties');

// Rounding: 7 gold paid, 25% = 1 (rounded down), the jailer 6
jailWith(7, 7, LEGIONARY);
ok('rounding: share rounded down, the two add up to the paid', facIn[0].n === 1 && gold(GUARD) === 6);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp */ }
console.log(fails ? `${fails} FAILED` : 'all checks passed'); process.exit(fails ? 1 : 0);
