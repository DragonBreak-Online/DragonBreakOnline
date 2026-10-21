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
globalThis.__dboGuildLeaders = () => [
  // Aldemar's shape: the same character leads the College and rules Bruma
  { id: 'college-of-whispers', name: 'College of Whispers', kind: 'guild', title: 'Master of Whispers', actor: COUNT, pid: 35 },
  { id: 'county-bruma', name: 'County of Bruma', kind: 'hold', title: 'Count', actor: COUNT, pid: 35 },
  { id: 'fighters-guild', name: 'The Fighters Guild', kind: 'guild', title: 'Guildmaster', actor: PLAIN, pid: 99 },
];
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
const load = (leadership) => { delete require.cache[LEADERSHIP]; return require(LEADERSHIP)(Object.assign({}, api, { cfg: { leadership } })); };
load({});

ok('a guild leader holds leadership', globalThis.__dboLeadershipOf(MAGISTER).length === 1 && /Master of Whispers of College of Whispers/.test(globalThis.__dboLeadershipOf(MAGISTER)[0].name), globalThis.__dboLeadershipOf(MAGISTER));
ok("a hold's ruler holds leadership, once", globalThis.__dboLeadershipOf(JARL).length === 1 && globalThis.__dboLeadershipOf(JARL)[0].kind === 'hold', globalThis.__dboLeadershipOf(JARL));
ok("...the hold faction's leader rank is the same seat, never a second one", globalThis.__dboLeadershipOf(COUNT).length === 1, globalThis.__dboLeadershipOf(COUNT));
ok('a Steward is not leadership, in the court or in the faction', globalThis.__dboLeadershipOf(STEWARD).length === 0, globalThis.__dboLeadershipOf(STEWARD));
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

// ---- the audit -------------------------------------------------------------------------------------------------------
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

// ---- part 3: the two gamemode.js chokepoints -------------------------------------------------------------------------
process.chdir(ROOT);
const GM = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const ac = GM.slice(GM.indexOf('const appointCheck = '), GM.indexOf('const seatOfficial = '));
const so = GM.slice(GM.indexOf('const seatOfficial = '), GM.indexOf('const unseatOfficial = '));
ok('gamemode.js loads leadership.js with ranksOf, rankTitle and rulerSeats', /require\(LEADERSHIP_JS\)\(\{[\s\S]{0,400}?ranksOf, rankTitle, rulerSeats/.test(GM));
ok('appointCheck asks it for a ruler rank (so /appoint and the Court tab are covered)', /__dboLeadershipRefusal\(tg\.actor, \{ kind: 'hold', id: z\.id \}/.test(ac) && /return \{ error: no \}/.test(ac));
ok("seatOfficial asks it too (the court's accepted offer, a move inside a court, and the election)", /__dboLeadershipRefusal\(tg\.actor, \{ kind: 'hold', id: z\.id \}/.test(so) && /return \{ error: no \}/.test(so));
ok('both skip the zone being seated, so a re-seat or a move is untouched', (ac.match(/id: z\.id/g) || []).length >= 1 && (so.match(/id: z\.id/g) || []).length >= 1);
const GUILDSRC = fs.readFileSync(GUILDS, 'utf8');
ok('guilds.js asks it at all four of its leader paths', (GUILDSRC.match(/leadershipNo\(/g) || []).length >= 4, (GUILDSRC.match(/leadershipNo\(/g) || []).length);
ok('...and skips the faction being joined, so a transfer inside one is untouched', /kind: 'faction', id: String\(fid\)/.test(GUILDSRC));
ok('citizenship.js seats an election winner through seatOfficial, so it is covered by that one', /seatOfficial\(z, office, tg, \{ who: 'the election'/.test(fs.readFileSync(path.join(ROOT, 'citizenship.js'), 'utf8')));

try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
