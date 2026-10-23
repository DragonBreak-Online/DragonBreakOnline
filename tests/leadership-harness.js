// One leadership seat per character (leadership.js; Nate, 21 Oct: "no leadership can have leadership in any other faction
// or hold"). Three parts: the check itself on stubs, the real guilds.js refusing at each of its four leader paths, and the
// two gamemode.js chokepoints pinned in its source (appointCheck for /appoint and the Court tab, seatOfficial for the
// court's accepted offer, its move inside a court, and citizenship.js's election).
//
//   node tests/leadership-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEADERSHIP = path.join(ROOT, 'leadership.js');
const GUILDS = path.join(ROOT, 'guilds.js');
if (!fs.existsSync(LEADERSHIP)) { require('./expect')('leadership', 'there is no leadership.js'); console.log('ok   skipped: no leadership.js'); process.exit(0); }

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!cond) fails++; };

// ---- part 1: the check ----------------------------------------------------------------------------------------------
const COUNT = 0xff000101, JARL = 0xff000102, MAGISTER = 0xff000103, PLAIN = 0xff000104, STEWARD = 0xff000105, LEAD = 0xff0001ff;
const NAMES = { [COUNT]: 'Aldemar', [JARL]: 'Uhtred', [MAGISTER]: 'Elion', [PLAIN]: 'Nobody', [STEWARD]: 'Reyla', [LEAD]: 'Lead GM' };
// guilds: the College of Whispers (a guild) and Bruma's own hold faction (a court kind)
const GUILD_SEATS = {
  [MAGISTER]: [{ id: 'college-of-whispers', name: 'College of Whispers', kind: 'guild', role: 'leader', shown: 'Master of Whispers' }],
  [COUNT]: [{ id: 'county-bruma', name: 'County of Bruma', kind: 'hold', role: 'leader', shown: 'Count' }],
  [JARL]: [{ id: 'hold-whiterun', name: 'Whiterun Hold', kind: 'hold', role: 'leader', shown: 'Jarl' }],
  [STEWARD]: [{ id: 'hold-whiterun', name: 'Whiterun Hold', kind: 'hold', role: 'officer', shown: 'Steward' }],
};
const ZONES = { bruma: { id: 'bruma', name: 'Bruma' }, whiterun: { id: 'whiterun', name: 'Whiterun' }, riften: { id: 'riften', name: 'Riften' } };
const SEATS = { [COUNT]: [{ zone: ZONES.bruma, rank: 'count' }], [JARL]: [{ zone: ZONES.whiterun, rank: 'jarl' }], [STEWARD]: [{ zone: ZONES.whiterun, rank: 'steward' }] };
globalThis.__dboGuildsOf = (a) => GUILD_SEATS[a >>> 0] || [];
const GUILD_OFFICERS = [];
globalThis.__dboGuildLeaders = (opts) => (opts && opts.roles ? GUILD_OFFICERS.filter((o) => opts.roles.includes(o.role)) : []).concat([
  // Aldemar's shape: the same character leads the College and rules Bruma
  { id: 'college-of-whispers', name: 'College of Whispers', kind: 'guild', title: 'Master of Whispers', actor: COUNT, pid: 35 },
  { id: 'county-bruma', name: 'County of Bruma', kind: 'hold', title: 'Count', actor: COUNT, pid: 35 },
  { id: 'fighters-guild', name: 'The Fighters Guild', kind: 'guild', title: 'Guildmaster', actor: PLAIN, pid: 99 },
]);
const told = [];
const commands = {};
const api = {
  log: () => {}, personal: (a, t) => told.push([a, t]), audit: () => {}, who: (a) => NAMES[a] || 'x',
  display: (a) => NAMES[a] || `actor ${a}`, nameOf: (a) => NAMES[a] || 'x', profileOf: (a) => (a === COUNT || a === MAGISTER ? 35 : 99),
  onlineActors: () => Object.keys(NAMES).map(Number), accountActors: () => [],
  registerChatCommand: (n, f, o) => { commands[n] = { f, o }; }, isAdmin: (a) => a === LEAD, isLeadStaff: (a) => a === LEAD,
  ranksOf: (pid, actor) => SEATS[actor >>> 0] || [], rankTitle: (r) => String(r).charAt(0).toUpperCase() + String(r).slice(1),
  rulerSeats: () => [{ zone: 'bruma', zoneName: 'Bruma', rank: 'count', pid: 35, actor: COUNT },
    { zone: 'whiterun', zoneName: 'Whiterun', rank: 'jarl', pid: 99, actor: JARL },
    { zone: 'riften', zoneName: 'Riften', rank: 'steward', pid: 99, actor: STEWARD }],
  cfg: {},
};
const load = (leadership) => { delete require.cache[LEADERSHIP]; return require(LEADERSHIP)(Object.assign({}, api, { leadershipSweep: false, cfg: { leadership } })); };
load({});

ok('a guild leader holds leadership', globalThis.__dboLeadershipOf(MAGISTER).length === 1 && /Master of Whispers of College of Whispers/.test(globalThis.__dboLeadershipOf(MAGISTER)[0].name), globalThis.__dboLeadershipOf(MAGISTER));
ok("a hold's ruler holds leadership, once", globalThis.__dboLeadershipOf(JARL).length === 1 && globalThis.__dboLeadershipOf(JARL)[0].kind === 'hold', globalThis.__dboLeadershipOf(JARL));
ok("...the hold faction's leader rank is the same seat, never a second one", globalThis.__dboLeadershipOf(COUNT).length === 1, globalThis.__dboLeadershipOf(COUNT));
ok('a Steward is a court officer seat now, counted once (the office, not the hold faction rank)', globalThis.__dboLeadershipOf(STEWARD).length === 1 && globalThis.__dboLeadershipOf(STEWARD)[0].kind === 'hold', globalThis.__dboLeadershipOf(STEWARD));
load({ officers: false });
ok('...and with leadership.officers false a Steward is not leadership, as before 23 Oct', globalThis.__dboLeadershipOf(STEWARD).length === 0, globalThis.__dboLeadershipOf(STEWARD));
load({});
ok('someone with nothing holds none', globalThis.__dboLeadershipOf(PLAIN).length === 0);

ok('the refusal names the seat they already hold', /Elion already holds Master of Whispers of College of Whispers\. One leadership seat per character/.test(globalThis.__dboLeadershipRefusal(MAGISTER)), globalThis.__dboLeadershipRefusal(MAGISTER));
ok('a ruler is refused another faction', /Uhtred already holds Jarl of Whiterun/.test(globalThis.__dboLeadershipRefusal(JARL, { kind: 'faction', id: 'fighters-guild' })), globalThis.__dboLeadershipRefusal(JARL, { kind: 'faction', id: 'fighters-guild' }));
ok('a free character is refused nothing', globalThis.__dboLeadershipRefusal(PLAIN, { kind: 'faction', id: 'fighters-guild' }) === '');
ok('the seat being replaced is skipped: a ruler may be re-seated in their own hold', globalThis.__dboLeadershipRefusal(JARL, { kind: 'hold', id: 'whiterun' }) === '');
ok("...and a leader may be re-seated in their own faction", globalThis.__dboLeadershipRefusal(MAGISTER, { kind: 'faction', id: 'college-of-whispers' }) === '');
ok('a ruler taking another hold is still refused', /Jarl of Whiterun/.test(globalThis.__dboLeadershipRefusal(JARL, { kind: 'hold', id: 'riften' })), globalThis.__dboLeadershipRefusal(JARL, { kind: 'hold', id: 'riften' }));
ok('the Count of Bruma is refused the College: the case Nate named', /Aldemar already holds Count of Bruma/.test(globalThis.__dboLeadershipRefusal(COUNT, { kind: 'faction', id: 'college-of-whispers' })), globalThis.__dboLeadershipRefusal(COUNT, { kind: 'faction', id: 'college-of-whispers' }));

ok('staff are bound by it too, by default', globalThis.__dboLeadershipRefusal(MAGISTER, null, LEAD) !== '');
load({ staffOverride: true });
ok('leadership.staffOverride lets a Lead GM through, and nobody else', globalThis.__dboLeadershipRefusal(MAGISTER, null, LEAD) === '' && globalThis.__dboLeadershipRefusal(MAGISTER, null, COUNT) !== '');
load({ enabled: false });
ok('enabled false: nothing is leadership and nothing is refused', globalThis.__dboLeadershipOf(COUNT).length === 0 && globalThis.__dboLeadershipRefusal(MAGISTER) === '');
load({});
ok('rulerRanks is config: a rank left out of it is not leadership', (load({ rulerRanks: ['jarl'] }), globalThis.__dboLeadershipOf(COUNT).length === 0 && globalThis.__dboLeadershipOf(JARL).length === 1), globalThis.__dboLeadershipOf(COUNT));
load({});

// ---- officers (Nate, 23 Oct: "cant be leadership in more than one faction regardless if it's secret, college, or
// hold/allegiance") ------------------------------------------------------------------------------------------------------
const OFF = 0xff000110, SGT = 0xff000111, ALPHA = 0xff000112, BANDOFF = 0xff000113, ALT1 = 0xff000114, ALT2 = 0xff000115;
Object.assign(NAMES, { [OFF]: 'Verrik', [SGT]: 'Sergeant', [ALPHA]: 'Fenrig', [BANDOFF]: 'Bandy', [ALT1]: 'Altone', [ALT2]: 'Alttwo' });
ok('officerRoles: the officer role is leadership; leader too; sergeant, mage, member are not', globalThis.__dboLeadershipRole('officer') && globalThis.__dboLeadershipRole('leader')
  && !globalThis.__dboLeadershipRole('sergeant') && !globalThis.__dboLeadershipRole('mage') && !globalThis.__dboLeadershipRole('member'));
ok('courtSeats: steward, guard captain (both ids), hold commander, bane, stronghold guard commander and the rulers are leadership',
  ['jarl', 'count', 'chieftain', 'steward', 'captain', 'guardcaptain', 'commander', 'bane', 'strongholdcommander'].every((r) => globalThis.__dboLeadershipOffice(r)));
ok('...guards, court mages, shamans, wise-women and stronghold guards are not', ['guard', 'courtmage', 'shaman', 'wisewoman', 'strongholdguard'].every((r) => !globalThis.__dboLeadershipOffice(r)));
// An officer of each kind, plus a Steward's office elsewhere: refused, the seat named
for (const kind of ['guild', 'cult', 'pack', 'rebellion', 'secret']) {
  GUILD_SEATS[OFF] = [{ id: `x-${kind}`, name: `The ${kind}`, kind: kind === 'secret' ? 'guild' : kind, secret: kind === 'secret', role: 'officer', shown: 'Keeper of Secrets' }];
  SEATS[OFF] = [];
  const no = globalThis.__dboLeadershipRefusal(OFF, { kind: 'faction', id: 'imperial-legion' });
  ok(`an officer of a ${kind} is refused another faction's officer rank, the seat named`, new RegExp(`Verrik already holds Keeper of Secrets of The ${kind}\\. One leadership seat per character, leader or officer`).test(no), no);
  ok(`...and refused a Steward's office`, /already holds Keeper of Secrets/.test(globalThis.__dboLeadershipRefusal(OFF, { kind: 'hold', id: 'riften' })));
  ok(`...but promoted inside the same ${kind} freely`, globalThis.__dboLeadershipRefusal(OFF, { kind: 'faction', id: `x-${kind}` }) === '');
}
GUILD_SEATS[OFF] = [];
SEATS[OFF] = [{ zone: ZONES.riften, rank: 'commander' }];
ok('a Hold Commander is refused a faction officer rank', /Verrik already holds Commander of Riften/.test(globalThis.__dboLeadershipRefusal(OFF, { kind: 'faction', id: 'college-of-whispers' })), globalThis.__dboLeadershipRefusal(OFF, { kind: 'faction', id: 'college-of-whispers' }));
ok('...and moves inside the same court freely (Commander to Jarl of Riften)', globalThis.__dboLeadershipRefusal(OFF, { kind: 'hold', id: 'riften' }) === '');
SEATS[OFF] = [{ zone: ZONES.riften, rank: 'guard' }];
GUILD_SEATS[SGT] = [{ id: 'college-of-whispers', name: 'College of Whispers', kind: 'guild', role: 'sergeant', shown: 'Senior Whisperer' }];
ok('a Guard and a sergeant hold nothing', globalThis.__dboLeadershipOf(OFF).length === 0 && globalThis.__dboLeadershipOf(SGT).length === 0);
GUILD_SEATS[BANDOFF] = [{ id: 'band-x', name: 'The Lads', kind: 'band', role: 'officer', shown: 'Officer' }, { id: 'band-y', name: 'The Others', kind: 'band', role: 'leader', shown: 'Guildmaster' }];
ok("a player guild's Guildmaster and Officer are no seat (Nate, 21 Oct)", globalThis.__dboLeadershipOf(BANDOFF).length === 0);
GUILD_SEATS[ALPHA] = [{ id: 'pack-of-the-jerall', name: 'Pack of the Jerall', kind: 'pack', role: 'leader', shown: 'Pack Leader' }];
ok("a pack's Alpha is one leader seat, exactly as before", globalThis.__dboLeadershipOf(ALPHA).length === 1 && /Pack Leader of Pack of the Jerall/.test(globalThis.__dboLeadershipOf(ALPHA)[0].name));
load({ officers: false });
ok('...and still one with officers off (the Alpha never depended on it)', globalThis.__dboLeadershipOf(ALPHA).length === 1);
load({});

// perAccount: two characters of one account, an officer and a Steward
const P_ACC = 77;
const accApi = Object.assign({}, api, { profileOf: (a) => ([ALT1, ALT2].includes(a >>> 0) ? P_ACC : api.profileOf(a)), accountActors: (pid) => (pid === P_ACC ? [ALT1, ALT2] : []) });
SEATS[ALT2] = [{ zone: ZONES.riften, rank: 'steward' }];
const loadAcc = (l) => { delete require.cache[LEADERSHIP]; return require(LEADERSHIP)(Object.assign({}, accApi, { leadershipSweep: false, cfg: { leadership: l } })); };
loadAcc({});
ok("per character (the default): Altone may become a Legate though Alttwo is a Steward", globalThis.__dboLeadershipRefusal(ALT1, { kind: 'faction', id: 'imperial-legion' }) === '');
loadAcc({ perAccount: true });
const accNo = globalThis.__dboLeadershipRefusal(ALT1, { kind: 'faction', id: 'imperial-legion' });
ok('perAccount: the account already holds Steward of Riften on its other character, named', /Altone's account already holds Steward of Riften \(as Alttwo\)\. One leadership seat per account/.test(accNo), accNo);
ok('...a move inside the same court is still skipped', globalThis.__dboLeadershipRefusal(ALT1, { kind: 'hold', id: 'riften' }) === '');
GUILD_SEATS[ALT1] = []; SEATS[ALT2] = [];
load({});

// ---- the audit -------------------------------------------------------------------------------------------------------
// Today's shapes (guilds.json, 23 Oct): Aldemar is Count of Bruma, Keeper of Secrets and Bushi; Elion is Master of
// Whispers and Legate. Officers come from __dboGuildLeaders({ roles })
GUILD_OFFICERS.push(
  { id: 'blades', name: 'The Blades', kind: 'guild', title: 'Bushi', role: 'officer', actor: COUNT, pid: 35 },
  { id: 'imperial-legion', name: 'Imperial Legion', kind: 'guild', title: 'Legate', role: 'officer', actor: MAGISTER, pid: 35 },
  { id: 'synod', name: 'Synod', kind: 'guild', title: 'Chancellor of the Synod', role: 'leader', actor: MAGISTER, pid: 35 },
  { id: 'band-x', name: 'The Lads', kind: 'band', title: 'Officer', role: 'officer', actor: PLAIN, pid: 99 },
  { id: 'synod', name: 'Synod', kind: 'guild', title: 'Magister', role: 'officer', actor: ALT1, pid: 77 },
  { id: 'synod', name: 'Synod', kind: 'guild', title: 'Senior Magister', role: 'sergeant', actor: ALT2, pid: 77 });
{
  const d = globalThis.__dboLeadershipDoubles();
  const ald = d.find((x) => x.actor === COUNT), eli = d.find((x) => x.actor === MAGISTER);
  ok('the audit lists Aldemar with the College, the Blades and Bruma', !!ald && ald.seats.length === 3 && ald.seats.some((x) => /Bushi of The Blades/.test(x.name)) && ald.seats.some((x) => /Count of Bruma/.test(x.name)), d);
  ok('...and Elion with the Synod and the Legion', !!eli && eli.seats.length === 2 && eli.seats.some((x) => /Legate/.test(x.name)), d);
  ok('...not a band officer, nor a sergeant', !d.some((x) => x.actor === PLAIN || x.actor === ALT2), d.map((x) => x.actor));
  const acc = globalThis.__dboLeadershipAccountDoubles();
  ok('the account audit joins characters of one account (Aldemar and Elion share account 35 here)', acc.some((x) => x.pid === 35 && x.seats.length === 5), acc.map((x) => [x.pid, x.seats.length]));
  told.length = 0; commands.leadership.f(LEAD, 'audit');
  ok('/leadership audit prints what perAccount would add', told.some(([, t]) => /With perAccount on, 2 more accounts would be over the limit/.test(t)) && told.some(([, t]) => /account 35: /.test(t)), told.map(([, t]) => t));
}

// ---- notices: a double is told to step down, staff after staffAfterDays; nothing is removed -----------------------------
{
  const STATE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-leadership-st-')), 'leadership-doubles.json');
  const notes = []; const audits = [];
  delete require.cache[LEADERSHIP];
  const L = require(LEADERSHIP)(Object.assign({}, api, { leadershipStatePath: STATE, leadershipSweep: false, onlineActors: () => [COUNT],
    staffNote: (a, what, text) => notes.push([a, what, text]), audit: (t) => audits.push(t), cfg: { leadership: { doublesNotice: { staffAfterDays: 7 } } } }));
  const t0 = Date.parse('2026-10-23T12:00:00Z');
  told.length = 0;
  let r = L.sweep(t0);
  ok('the sweep tells an online double to step down, naming their seats', r.told === 1 && told.some(([a, t]) => a === COUNT && /You hold more than one seat of leadership: .*Count of Bruma/.test(t) && /Step down from all but one/.test(t)), told);
  ok('...and not an offline one (Elion is told when next online)', !told.some(([a]) => a === MAGISTER));
  told.length = 0; r = L.sweep(t0 + 3600000);
  ok('...once a day, not every sweep', r.told === 0 && told.length === 0);
  r = L.sweep(t0 + 25 * 3600000);
  ok('...again the next day', r.told === 1);
  r = L.sweep(t0 + 6 * 86400000);
  ok('staff are not told before staffAfterDays', r.staff === 0 && notes.length === 0);
  r = L.sweep(t0 + 7 * 86400000 + 1000);
  ok('after 7 days the staff are told, once, through the staff log and the audit', r.staff === 1 && notes.length === 1 && /Count Aldemar|Aldemar \(account 35\) still holds 3 leadership seats/.test(notes[0][2]) && audits.some((t) => /^LEADERSHIP /.test(t)), [notes, audits]);
  r = L.sweep(t0 + 8 * 86400000);
  ok('...and only once', r.staff === 0 && notes.length === 1);
  ok('nothing is taken away by any of it', globalThis.__dboLeadershipOf(COUNT).length >= 1 && globalThis.__dboLeadershipDoubles().some((x) => x.actor === COUNT));
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  ok('the record is kept per character', !!st[`a:${COUNT}`] && st[`a:${COUNT}`].staffAt > 0 && !!st[`a:${MAGISTER}`] && !st[`a:${MAGISTER}`].firstToldAt, st);
  GUILD_OFFICERS.splice(0, 2);   // Aldemar leaves the Blades, Elion the Legion (Elion keeps the Synod alone)
  const keepLeaders = globalThis.__dboGuildLeaders;
  L.sweep(t0 + 9 * 86400000);
  const st2 = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  ok('a double who stepped down is dropped from the record (Elion, down to one seat)', !st2[`a:${MAGISTER}`] && !!st2[`a:${COUNT}`], Object.keys(st2));
  globalThis.__dboGuildLeaders = () => [];
  L.sweep(t0 + 10 * 86400000);
  ok('a sweep with guilds.js not loaded never clears the record', Object.keys(JSON.parse(fs.readFileSync(STATE, 'utf8'))).length === Object.keys(st2).length);
  globalThis.__dboGuildLeaders = keepLeaders;
  delete require.cache[LEADERSHIP];
  const L2 = require(LEADERSHIP)(Object.assign({}, api, { leadershipStatePath: STATE + '.off', leadershipSweep: false, onlineActors: () => [COUNT], cfg: { leadership: { doublesNotice: { enabled: false } } } }));
  told.length = 0;
  ok('doublesNotice.enabled false: nobody is told', L2.sweep(t0).told === 0 && told.length === 0);
  try { fs.rmSync(path.dirname(STATE), { recursive: true, force: true }); } catch (e) { /* tmp */ }
}
GUILD_OFFICERS.length = 0;
load({});

// ---- the audit (leaders and rulers only, as before) --------------------------------------------------------------------
const doubles = globalThis.__dboLeadershipDoubles();
ok('the audit finds the one double: a guild leader who also rules a hold', doubles.length === 1 && doubles[0].actor === COUNT
  && doubles[0].seats.length === 2 && doubles[0].seats.some((s) => s.kind === 'hold') && doubles[0].seats.some((s) => s.kind === 'faction'), doubles);
ok('...and not the Jarl, whose hold faction is the same seat', !doubles.some((d) => d.actor === JARL), doubles.map((d) => d.actor));
told.length = 0; commands.leadership.f(LEAD, 'audit');
ok('/leadership audit is staff only and lists them with the account', commands.leadership.o.admin === true
  && told.some(([, t]) => /1 character holds two or more leadership seats/.test(t))
  && told.some(([, t]) => /Aldemar \(account 35\): .*College of Whispers.*Count of Bruma|Aldemar \(account 35\): .*Count of Bruma.*College of Whispers/.test(t)), told.map(([, t]) => t));
told.length = 0; commands.leadership.f(COUNT, 'audit');
ok('a player is refused the command', told.length === 1 && /Staff only/.test(told[0][1]));
told.length = 0; commands.leadership.f(LEAD, 'nonsense');
ok('an unknown subcommand gets the usage', told.some(([, t]) => /Usage: \/leadership audit/.test(t)));

// ---- part 2: the real guilds.js refuses at each of its four leader paths ---------------------------------------------
const { HousingSystem } = { };   // not used; keeps the shape of the other harnesses
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-leadership-'));
fs.copyFileSync(path.join(ROOT, 'guild-defs.json'), path.join(dir, 'guild-defs.json'));
const DEFS = JSON.parse(fs.readFileSync(path.join(ROOT, 'guild-defs.json'), 'utf8'));
process.chdir(dir);
const G_LEAD = 0x10, G_FREE = 0x14, G_BOUND = 0x15;
const gChars = new Map([[G_LEAD, 'Lead'], [G_FREE, 'Freeone'], [G_BOUND, 'Boundone']]);
const gTold = [], gHandlers = {}, gDrawn = [];
let refusalFor = G_BOUND;
globalThis.__dboLeadershipRefusal = (t) => ((t >>> 0) === refusalFor ? 'Boundone already holds Jarl of Whiterun. One leadership seat per character: they step down from that first.' : '');
const gApi = {
  mp: { get: () => undefined, set: () => {} }, log: () => {}, personal: (a, t) => gTold.push([a, t]), system: () => {}, audit: () => {},
  registerChatCommand: (n, f) => { gHandlers[n] = f; }, onUi: (e, f) => { (gHandlers[e] = gHandlers[e] || []).push(f); },
  openWidget: (a, p) => gDrawn.push({ a, p }), closeWidget: () => {},
  display: (a) => gChars.get(a) || 'x', nameOf: (a) => gChars.get(a) || 'x', tagOf: () => 'T', onlineActors: () => [...gChars.keys()],
  isAdmin: (a) => a === G_LEAD, isLeadStaff: (a) => a === G_LEAD, findByName: (q) => [...gChars.entries()].find(([, n]) => n.toLowerCase() === String(q).toLowerCase())?.[0] || 0,
  findAnyByName: (q) => [...gChars.entries()].find(([, n]) => n.toLowerCase() === String(q).toLowerCase())?.[0] || 0,
  who: (a) => `${gChars.get(a)} (profile ${a})`, cfg: {}, profileOf: (a) => a,
};
delete require.cache[GUILDS]; delete globalThis.__dboGuildState;
require(GUILDS)(gApi);
const FID = 'fighters-guild';
const nonce = (a) => globalThis.__dboGuildState.nonces.get(a >>> 0);
const payload = (a) => globalThis.__dboFactionPayload(a, false);
const send = (ev, a, ...args) => { for (const f of gHandlers[ev] || []) f(a, [nonce(a)].concat(args)); };
const roster = () => globalThis.__dboGuildState.members[FID] || {};
const rankOf = (a) => (roster()[String(a)] || {}).rank;
payload(G_LEAD);
send('factionAdd', G_LEAD, FID, 'Freeone');
send('factionAdd', G_LEAD, FID, 'Boundone');
let r = globalThis.__dboGuildSetRank(G_LEAD, FID, G_BOUND, 0, false);
ok('setRankOf (the panel, the Court tab and the staff view) refuses a leader rank to someone who already leads', !!r.error && /already holds Jarl of Whiterun/.test(r.error) && rankOf(G_BOUND) !== 0, r);
r = globalThis.__dboGuildSetRank(G_LEAD, FID, G_FREE, 0, false);
ok('...and seats someone free', !r.error && rankOf(G_FREE) === 0, r);
gTold.length = 0;
gHandlers.faction(G_LEAD, `leader Boundone ${FID}`);
ok('/faction leader refuses them as well', gTold.some(([, t]) => /already holds Jarl of Whiterun/.test(t)) && rankOf(G_BOUND) !== 0, gTold.map(([, t]) => t));
const def = { id: 'bound-company', name: 'The Bound Company', kind: 'guild', template: 'cult', ranks: DEFS.templates.cult };
r = globalThis.__dboGuildFoundPlayer(def, G_BOUND, []);
ok("an approved charter refuses a Founder who already leads, and the faction is not half-made", typeof r === 'string' && /already holds Jarl of Whiterun/.test(r)
  && !globalThis.__dboGuildState.members['bound-company'], [r, Object.keys(globalThis.__dboGuildState.members)]);
refusalFor = 0;
r = globalThis.__dboGuildFoundPlayer(def, G_BOUND, []);
ok('...and founds it once they hold nothing', !r || typeof r !== 'string' ? true : !/already holds/.test(r), r);

// A newly seated ruler takes their own hold faction's leader rank: seatOfficial writes the seat before court.js syncs
// the rank, so the seat skipped must be the hold's (a faction skip refused every new Jarl their rank)
{
  const court = [...Object.values(DEFS.factions || {})].find((f) => f && (f.kind === 'hold' || f.kind === 'stronghold') && f.zone)
    || (Array.isArray(DEFS.factions) ? DEFS.factions.find((f) => f && (f.kind === 'hold' || f.kind === 'stronghold') && f.zone) : null);
  const seen = [];
  const keep = globalThis.__dboLeadershipRefusal;
  globalThis.__dboLeadershipRefusal = (t, skip) => { seen.push(skip); return skip && skip.kind === 'hold' && skip.id === String(court.zone) ? '' : 'Freeone already holds Jarl of somewhere.'; };
  const out = court ? globalThis.__dboCourtSync(court.zone, G_FREE, ['@leader'], true) : 'no court faction in guild-defs.json';
  const got = court ? (globalThis.__dboGuildsOf(G_FREE) || []).find((m) => m.id === court.id) : undefined;
  ok("a new ruler's court sync skips their own hold seat and gives them the leader rank", !!court && !!got && got.role === 'leader' && seen.some((k) => k && k.kind === 'hold' && k.id === String(court.zone)), [court && court.id, out, got, seen]);
  globalThis.__dboLeadershipRefusal = keep;
}

// ---- part 2b: officer ranks in the real guilds.js (23 Oct) ------------------------------------------------------------
{
  const role = (r) => r === 'leader' || r === 'officer';
  globalThis.__dboLeadershipRole = role;
  const refuse = new Set([G_BOUND]);
  const asked = [];
  globalThis.__dboLeadershipRefusal = (t, skip) => { asked.push(skip); return refuse.has(t >>> 0) ? 'Boundone already holds Steward of Whiterun. One leadership seat per character, leader or officer, in any faction or court: they step down from that first.' : ''; };
  const f = globalThis.__dboGuildState && DEFS.factions.find((x) => x.id === FID);
  const officerRank = f.ranks.findIndex((x) => x.role === 'officer');
  const sergeantRank = f.ranks.findIndex((x) => x.role === 'sergeant');
  r = globalThis.__dboGuildSetRank(G_LEAD, FID, G_BOUND, officerRank, false);
  ok('setRankOf refuses an officer rank to someone who holds a seat elsewhere, naming it', !!r.error && /already holds Steward of Whiterun/.test(r.error) && rankOf(G_BOUND) !== officerRank, r);
  ok('...asking with this faction skipped, so a promotion inside it is never counted', asked.some((k) => k && k.kind === 'faction' && k.id === FID));
  r = globalThis.__dboGuildSetRank(G_LEAD, FID, G_BOUND, sergeantRank, false);
  ok('...a sergeant rank is no seat and goes ahead', !r.error && rankOf(G_BOUND) === sergeantRank, r);
  // An existing double is never stripped: re-setting an officer who already is one in this faction is not asked again
  globalThis.__dboGuildState.members[FID][String(G_BOUND)].rank = officerRank;
  asked.length = 0;
  r = globalThis.__dboGuildSetRank(G_LEAD, FID, G_BOUND, officerRank, false);
  ok('an officer already seated (an existing double) keeps the rank; nothing is taken away', rankOf(G_BOUND) === officerRank, r);
  globalThis.__dboGuildState.members[FID][String(G_BOUND)].rank = sergeantRank;
  // A rank edit that turns the sergeant role into officer would make Boundone an officer: refused, nothing changed
  const before = JSON.stringify(globalThis.__dboGuildRankList(FID));
  const list = globalThis.__dboGuildRankList(FID).map((x, i) => ({ title: x.title, role: i === sergeantRank ? 'officer' : x.role, from: i }));
  gTold.length = 0;
  payload(G_LEAD);
  send('factionRanksEdit', G_LEAD, FID, list);
  ok('a rank edit that makes holders officers asks for each of them, and is refused whole', JSON.stringify(globalThis.__dboGuildRankList(FID)) === before
    && gTold.concat(gDrawn.map((d) => [d.a, JSON.stringify(d.p)])).some(([, t]) => /already holds Steward of Whiterun/.test(String(t))), gTold.map(([, t]) => t));
  // A charter whose Officer co-founder holds a seat elsewhere is refused before anything is made
  const def2 = { id: 'officer-company', name: 'The Officer Company', kind: 'guild', ranks: DEFS.templates.cult };
  const no = globalThis.__dboGuildFoundPlayer(def2, G_FREE + 100, [{ actor: G_BOUND, role: 'officer' }]);
  ok("an approved charter refuses an Officer co-founder who holds a seat, and the faction is not half-made", typeof no === 'string' && /already holds Steward/.test(no) && !globalThis.__dboGuildState.members['officer-company'], no);
  const ok2 = globalThis.__dboGuildFoundPlayer(Object.assign({}, def2, { id: 'officer-company-2' }), G_FREE + 101, [{ actor: G_BOUND, role: 'sergeant' }]);
  ok('...as a Sergeant the same co-founder is fine', !ok2, ok2);
  // A pack challenge seats the Alpha as it always has: the rule is not asked (Nate: "Keep pack alphas the same")
  const PACK = 'pack-of-the-jerall'; const pk = DEFS.factions.find((x) => x.id === PACK);
  const lead = pk.ranks.findIndex((x) => x.role === 'leader');
  const ALPHA_OLD = 0x30, KILLER = 0x31; gChars.set(ALPHA_OLD, 'Oldalpha'); gChars.set(KILLER, 'Killer');
  globalThis.__dboGuildState.members[PACK] = { [ALPHA_OLD]: { rank: lead, name: 'Oldalpha', tag: 'T', since: 1 }, [KILLER]: { rank: pk.ranks.length - 1, name: 'Killer', tag: 'T', since: 1 } };
  refuse.add(KILLER);
  globalThis.__dboGuildPackChallenge(ALPHA_OLD, KILLER);
  ok('a pack challenge still makes the killer Alpha, seat elsewhere or not (Alpha unchanged)', globalThis.__dboGuildState.members[PACK][String(KILLER)].rank === lead
    && globalThis.__dboGuildState.members[PACK][String(ALPHA_OLD)].rank === lead + 1, globalThis.__dboGuildState.members[PACK]);
  // A player guild officer is no seat: the rule is not asked inside a band
  const BAND_FOUNDER = 0x40; gChars.set(BAND_FOUNDER, 'Founder');
  refuse.add(BAND_FOUNDER);
  const made = globalThis.__dboBandCreate ? globalThis.__dboBandCreate(BAND_FOUNDER, 'The Lads') : { error: 'no bands' };
  ok("a player guild's Guildmaster is never asked (Nate, 21 Oct)", !made.error, made);
  refuse.clear();
  globalThis.__dboLeadershipRole = undefined;
}

// ---- part 3: the two gamemode.js chokepoints -------------------------------------------------------------------------
process.chdir(ROOT);
const GM = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const ac = GM.slice(GM.indexOf('const appointCheck = '), GM.indexOf('const seatOfficial = '));
const so = GM.slice(GM.indexOf('const seatOfficial = '), GM.indexOf('const unseatOfficial = '));
ok('gamemode.js loads leadership.js with ranksOf, rankTitle and rulerSeats', /require\(LEADERSHIP_JS\)\(\{[\s\S]{0,400}?ranksOf, rankTitle, rulerSeats/.test(GM));
ok('appointCheck asks it for a ruler rank (so /appoint and the Court tab are covered)', /__dboLeadershipRefusal\(tg\.actor, \{ kind: 'hold', id: z\.id \}/.test(ac) && /return \{ error: no \}/.test(ac));
ok("seatOfficial asks it too (the court's accepted offer, a move inside a court, and the election)", /__dboLeadershipRefusal\(tg\.actor, \{ kind: 'hold', id: z\.id \}/.test(so) && /return \{ error: no \}/.test(so));
ok('both skip the zone being seated, so a re-seat or a move is untouched', (ac.match(/id: z\.id/g) || []).length >= 1 && (so.match(/id: z\.id/g) || []).length >= 1);
ok('both ask leadership.js which offices are leadership (rulers and court officers)', /if \(leadershipOffice\(rank\)\)/.test(ac) && /if \(leadershipOffice\(rank\)\)/.test(so) && /__dboLeadershipOffice/.test(GM));
ok('gamemode.js gives leadership.js the staff log for the step-down notice', /rulerSeats, staffNote, cfg \}\)/.test(GM));
ok("charters.js refuses an Officer co-founder's confirm when they hold a seat", /__dboLeadershipRole\(role\)[\s\S]{0,160}__dboLeadershipRefusal\(a >>> 0, null\)/.test(fs.readFileSync(path.join(ROOT, 'charters.js'), 'utf8')));
const GUILDSRC = fs.readFileSync(GUILDS, 'utf8');
ok('setMember asks it for any newly held leader or officer rank, never for a pack challenge', /!\(opts && opts\.alpha\) && f && leadRole\(role\)/.test(GUILDSRC) && /setMember\(f\.id, killer, lead, undefined, \{ alpha: true \}\)/.test(GUILDSRC));
ok('guilds.js asks it at all four of its leader paths', (GUILDSRC.match(/leadershipNo\(/g) || []).length >= 4, (GUILDSRC.match(/leadershipNo\(/g) || []).length);
ok('...and skips the faction being joined, so a transfer inside one is untouched', /kind: 'faction', id: String\(fid\)/.test(GUILDSRC));
ok('citizenship.js seats an election winner through seatOfficial, so it is covered by that one', /seatOfficial\(z, office, tg, \{ who: 'the election'/.test(fs.readFileSync(path.join(ROOT, 'citizenship.js'), 'utf8')));

try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
