// The Court tab's hunting-contract controls (court.js courtContractPrice/Budget/Standing and the court's `contracts`
// field, fed by contracts.js __dboContractTerms; 18 Oct). The officials functions cut from gamemode.js (as in
// tests/court-harness.js), the real guilds.js, contracts.js and court.js run against stubs in a temp folder under
// /dev/shm. Covers: the payload per viewer (fields, tier names, canSet for the Count / a Guard / staff, none where no
// treasury pays), each set action valid and refused (not an official, out of bounds, bad input, not your court, a stale
// nonce), the audit line and "last set by", spent/left after a standing contract is taken, and that the old fields stay.
//
//   node tests/court-contracts-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const start = src.indexOf('const APPOINT_RULES = ');
const end = src.indexOf('// ---- Scholar');
if (start < 0 || end < start) { console.log('FAIL the shared officials functions are not in gamemode.js'); process.exit(1); }
const section = src.slice(start, end) + '\nreturn { APPOINT_RULES, appointCap, appointCheck, appointFrom, seatOfficial, unseatOfficial, unseatOfficialBy, officialTarget, officialName, accountActors };';

const TMP = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
const dir = fs.mkdtempSync(path.join(TMP, 'claude-nate-court-contracts-'));
fs.copyFileSync(path.join(ROOT, 'guild-defs.json'), path.join(dir, 'guild-defs.json'));
process.chdir(dir);

// A clock: Wednesday 14 Oct 2026 12:00 UTC (the week resets Monday 19 Oct 00:00)
let NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
Date.now = () => NOW;

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

// ---- the world --------------------------------------------------------------------------------------------------------
const ADMIN = 0x10, COUNT = 0x14, GUARD = 0x15, HUNTER = 0x16, OUT = 0x17;
const chars = new Map([
  [ADMIN, { pid: 1, name: 'Admin', tag: 'AAAA', online: true, race: 'ImperialRace' }],
  [COUNT, { pid: 11, name: 'Narina Carvain', tag: 'CNT1', online: true, race: 'ImperialRace' }],
  [GUARD, { pid: 12, name: 'Aldo Varro', tag: 'ALD1', online: true, race: 'ImperialRace' }],
  [HUNTER, { pid: 13, name: 'Hilde', tag: 'HLD1', online: true, race: 'NordRace' }],
  [OUT, { pid: 15, name: 'Outsider', tag: 'OUT1', online: true, race: 'NordRace' }],
]);
const zones = [
  { id: 'bruma', name: 'Bruma', treasury: '79b22:BSHeartland.esm', officials: ['count', 'steward', 'captain', 'courtmage', 'guard'], worldspaces: ['BSHeartland.esm:BSHeartland'], capital: [0, 0] },
  { id: 'whiterun', name: 'Whiterun', capital: 'x', officials: ['jarl', 'steward', 'commander', 'courtmage', 'guardcaptain', 'guard'] },
];
const TITLES = { count: 'Count', steward: 'Steward', captain: 'Guard Captain', courtmage: 'Court Mage', guard: 'Guard', jarl: 'Jarl', commander: 'Hold Commander', guardcaptain: 'Guard Captain' };
let officials = { bruma: { count: [11], guard: [12] } };
const told = [], audits = [], props = new Map(), said = [];
const GOLD = 0xf, CHEST = 0x02079b22;
props.set(`${CHEST}|inventory`, { entries: [{ baseId: GOLD, count: 100000 }] });
const RACES = new Map([...chars.values()].map((c, i) => [100 + i, c.race]));
const raceIdOf = (a) => 100 + [...chars.keys()].indexOf(a);
const mp = {
  get: (id, k) => {
    if (k === 'appearance') return chars.has(id) ? { name: chars.get(id).name, raceId: raceIdOf(id) } : null;
    if (k === 'profileId') return chars.has(id) ? chars.get(id).pid : -1;
    return props.get(`${id}|${k}`);
  },
  set: (id, k, v) => props.set(`${id}|${k}`, v),
  getActorsByProfileId: (pid) => [...chars.entries()].filter(([, c]) => c.pid === pid).map(([id]) => id),
  lookupEspmRecordById: (id) => ({ record: RACES.has(id) ? { editorId: RACES.get(id) } : null }),
  getIdFromDesc: (d) => (d === '79b22:BSHeartland.esm' ? CHEST : 0),
};
for (const a of chars.keys()) { props.set(`${a}|inventory`, { entries: [] }); props.set(`${a}|worldOrCellDesc`, 'BSHeartland.esm:BSHeartland'); }
fs.writeFileSync('NPC-Spawns.json', JSON.stringify([
  { Name: 'wild:wolf:1', ID: 'BSHeartland.esm:BSHeartland', POS: [0, 0, 0] },
  { Name: 'wild:bear:1', ID: 'BSHeartland.esm:BSHeartland', POS: [0, 0, 0] },
  { Name: 'wild:troll:1', ID: 'BSHeartland.esm:BSHeartland', POS: [0, 0, 0] },
]));
const nameOf = (a) => (chars.has(a) ? chars.get(a).name : 'Stranger');
const tagOf = (a) => (chars.has(a) ? chars.get(a).tag : '????');
const profileOf = (a) => (chars.has(a) ? chars.get(a).pid : -1);
const display = (a) => `${nameOf(a)} #${tagOf(a)}`;
const who = (a) => `${display(a)} (profile ${profileOf(a)})`;
const TIERS = new Map([[ADMIN, 'developer']]);
const tierOf = (a) => TIERS.get(a) || null;
const isAdmin = (a) => tierOf(a) !== null;
const isLeadStaff = (a) => tierOf(a) !== null && tierOf(a) !== 'gm';
const zoneList = () => zones;
const zoneById = (id) => zones.find((z) => z.id === String(id).toLowerCase()) || null;
const ranksOf = (pid) => { const out = []; for (const z of zones) for (const r of Object.keys(officials[z.id] || {})) if ((officials[z.id][r] || []).map(Number).includes(pid)) out.push({ zone: z, rank: r }); return out; };
const handlers = {};
const onUi = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
const commands = new Map();
const base = {
  mp, log: () => {}, personal: (a, t) => said.push(t), system: (a, text) => told.push({ a, text }), audit: (t) => audits.push(t), cfg: {},
  isAdmin, isLeadStaff, tierOf, profileOf, nameOf, tagOf, display, who, onUi,
  findByName: () => 0, findAnyByName: () => 0,
  ownNameOf: nameOf, ownDisplay: display, publicNameOf: nameOf, publicDisplay: display, disguisedOf: () => false,
  onlineActors: () => [...chars.keys()], userOf: () => 1, seen: new Map(),
  zoneList, zoneById, ranksOf, rankTitle: (r) => TITLES[r] || r,
  readOfficials: () => JSON.parse(JSON.stringify(officials)), writeOfficials: (o) => { officials = JSON.parse(JSON.stringify(o)); },
  registerChatCommand: (n, f) => { commands.set(n, f); }, openWidget: () => {}, closeWidget: () => {},
};
// business.js: who sets a hold's tax (Jarl, Count, Steward of that hold, and staff)
globalThis.__dboCanSetHoldTax = (a, zid) => isAdmin(a) || ranksOf(profileOf(a)).some((r) => r.zone.id === zid && ['jarl', 'count', 'steward'].includes(r.rank));
globalThis.__dboHoldTax = () => 0.1;
globalThis.__dboHoldTaxMax = () => 0.3;
// citizenship.js: Bruma grants citizenship; nobody here is a citizen until the harness says so
const CITIZENS = new Set();
globalThis.__dboCitizenGates = (zid) => zid === 'bruma';
globalThis.__dboCitizenOf = (a, zid) => zid === 'bruma' && CITIZENS.has(a >>> 0);

const O = new Function(...Object.keys(base), section)(...Object.values(base));
require(path.join(ROOT, 'guilds.js'))(base);
require(path.join(ROOT, 'contracts.js'))(Object.assign({}, base, {
  cfg: { contracts: { enabled: true, perZone: 3, treasuryFloor: { gold: 0, share: 0 }, weeklyBudget: 1000, budgetMax: 100000 } },
  giveItem: () => true, zones: { holds: zones.filter((z) => z.treasury), strongholds: [], regions: [] }, zoneOfActor: () => 'bruma',
  saveSoon: (file, fn) => fs.writeFileSync(file, fn()), saveNow: (file, fn) => fs.writeFileSync(file, fn()), discordOf: (a) => `acc-${profileOf(a)}`,
  personal: (a, t) => said.push(t),
}));
const answers = [];
globalThis.__dboJournalFresh = (a, n) => n === 'N';
globalThis.__dboJournalLimited = (a, fn) => { answers.push(Object.assign({ a }, fn())); };
require(path.join(ROOT, 'court.js'))(Object.assign({}, base, O));
const sec = globalThis.__dboJournalSections.court;
const ev = (name, a, ...args) => { answers.length = 0; for (const f of handlers[name] || []) f(a, args); return answers[answers.length - 1] || null; };
const courtOf = (a, id) => sec.view(a).courts.find((c) => c.id === id) || null;
const terms = (a) => (courtOf(a, 'bruma') || {}).contracts;
const lastAudit = () => audits[audits.length - 1] || '';

// ---- the payload --------------------------------------------------------------------------------------------------------
ok('the three onUi handlers are registered', ['courtContractPrice', 'courtContractBudget', 'courtContractStanding'].every((n) => (handlers[n] || []).length === 1));
let t = terms(COUNT);
ok('the Count sees Bruma\'s contract terms', !!t, sec.view(COUNT).courts.map((c) => c.id));
ok('...with canSet true', t && t.canSet === true, t && t.canSet);
ok('...the three tiers with names, prices and creatures', t && t.tiers.length === 3 && t.tiers.map((x) => x.name).join('|') === 'pests|dangerous beasts|deadly beasts'
  && t.tiers.map((x) => x.price).join(',') === '12,25,60' && t.tiers[2].kinds.includes('trolls') && t.tiers[0].kinds.includes('wolves'), t && t.tiers);
ok('...prices keyed by tier as before', t && t.prices[1] === 12 && t.prices[2] === 25 && t.prices[3] === 60, t && t.prices);
ok('...bounds and the budget\'s ceiling', t && t.bounds.min === 1 && t.bounds.max === 200 && t.budgetMax === 100000, t && [t.bounds, t.budgetMax]);
ok('...the weekly budget, spent 0, left 1000', t && t.budget === 1000 && t.spent === 0 && t.left === 1000, t && [t.budget, t.spent, t.left]);
ok('...the reset at Monday 19 Oct 00:00 UTC', t && t.resetsAt === Date.UTC(2026, 9, 19), t && new Date(t.resetsAt).toISOString());
ok('...standing on, citizens only, never set by anyone', t && t.standing === true && t.citizensOnly === true && t.by === '' && t.at === 0 && t.enabled === true, t);
const tg = terms(GUARD);
ok('a Guard of Bruma sees the terms read-only (canSet false)', tg && tg.canSet === false && tg.budget === 1000, tg);
const ta = terms(ADMIN);
ok('staff see them with canSet true', ta && ta.canSet === true);
ok('a court with no treasury carries contracts null', courtOf(ADMIN, 'whiterun') && courtOf(ADMIN, 'whiterun').contracts === null, courtOf(ADMIN, 'whiterun'));
const cv = courtOf(COUNT, 'bruma');
ok('the old fields are all still there (additive)', cv && cv.tax && cv.tax.pct === 10 && cv.tax.canSet === true && Array.isArray(cv.offices) && 'treasury' in cv && 'keepsBooks' in cv, cv && Object.keys(cv));
ok('an outsider has no Court tab and no court', sec.visible(OUT) === false && !courtOf(OUT, 'bruma'));

// ---- set price -----------------------------------------------------------------------------------------------------------
let r = ev('courtContractPrice', COUNT, 'N', 'bruma', 2, 40);
ok('the Count sets tier 2 to 40 gold', r && r.kind === 'ok' && /now pays 40 gold a kill for dangerous beasts \(tier 2; was 25\)/.test(r.text) && r.tab === 'court', r);
ok('...the view shows it', terms(COUNT).tiers[1].price === 40 && terms(COUNT).prices[2] === 40);
ok('...audited like /contract price', /^CONTRACT Narina Carvain #CNT1 \(profile 11\) set Bruma price 2 40: /.test(lastAudit()), lastAudit());
ok('...and "last set by" names the Count, with the time', terms(GUARD).by === 'Narina Carvain #CNT1' && terms(GUARD).at === NOW, [terms(GUARD).by, terms(GUARD).at]);
let n = audits.length;
r = ev('courtContractPrice', COUNT, 'N', 'bruma', 3, 201);
ok('over the bounds is refused', r.kind === 'refused' && /from 1 to 200/.test(r.text) && terms(COUNT).prices[3] === 60 && audits.length === n, r);
r = ev('courtContractPrice', COUNT, 'N', 'bruma', 1, 0);
ok('under the bounds is refused', r.kind === 'refused' && /from 1 to 200/.test(r.text) && terms(COUNT).prices[1] === 12, r);
r = ev('courtContractPrice', COUNT, 'N', 'bruma', 4, 20);
ok('a tier that is not 1, 2 or 3 is refused', r.kind === 'refused' && audits.length === n, r);
r = ev('courtContractPrice', COUNT, 'N', 'bruma', 1, 'lots');
ok('a price that is not a whole number is refused', r.kind === 'refused' && terms(COUNT).prices[1] === 12, r);
r = ev('courtContractPrice', GUARD, 'N', 'bruma', 1, 30);
ok('a Guard (an official who does not set the tax) is refused', r.kind === 'refused' && /Only those who set Bruma's tax/.test(r.text) && terms(COUNT).prices[1] === 12 && audits.length === n, r);
r = ev('courtContractPrice', OUT, 'N', 'bruma', 1, 30);
ok('someone who serves no court there is refused', r.kind === 'refused' && /not a court you serve/.test(r.text) && terms(COUNT).prices[1] === 12, r);
r = ev('courtContractPrice', COUNT, 'stale', 'bruma', 1, 30);
ok('a stale nonce does nothing', r === null && terms(COUNT).prices[1] === 12);
r = ev('courtContractPrice', ADMIN, 'N', 'whiterun', 1, 30);
ok('a court with no treasury posts no contracts', r.kind === 'refused' && /posts no hunting contracts/.test(r.text), r);
r = ev('courtContractPrice', ADMIN, 'N', 'bruma', 1, 15);
ok('staff set a price', r.kind === 'ok' && terms(COUNT).prices[1] === 15 && /^CONTRACT Admin #AAAA \(profile 1\) set Bruma price 1 15/.test(lastAudit()), [r, lastAudit()]);

// ---- set budget ----------------------------------------------------------------------------------------------------------
NOW += 60000;
r = ev('courtContractBudget', COUNT, 'N', 'bruma', 2500);
ok('the Count sets the weekly budget to 2500', r.kind === 'ok' && /may now commit 2500 gold a week \(was 1000\)/.test(r.text) && terms(COUNT).budget === 2500 && terms(COUNT).left === 2500, r);
ok('...audited', /^CONTRACT Narina Carvain #CNT1 \(profile 11\) set Bruma budget 2500: /.test(lastAudit()), lastAudit());
ok('...last set by the Count again, a minute later', terms(COUNT).by === 'Narina Carvain #CNT1' && terms(COUNT).at === NOW);
n = audits.length;
r = ev('courtContractBudget', COUNT, 'N', 'bruma', 100001);
ok('over the ceiling is refused', r.kind === 'refused' && /from 0 to 100000/.test(r.text) && terms(COUNT).budget === 2500 && audits.length === n, r);
r = ev('courtContractBudget', COUNT, 'N', 'bruma', -5);
ok('a negative budget is refused', r.kind === 'refused' && terms(COUNT).budget === 2500, r);
r = ev('courtContractBudget', COUNT, 'N', 'bruma', 12.5);
ok('a fraction is refused', r.kind === 'refused' && terms(COUNT).budget === 2500, r);
r = ev('courtContractBudget', GUARD, 'N', 'bruma', 10);
ok('a Guard cannot set the budget', r.kind === 'refused' && /Only those who set Bruma's tax/.test(r.text) && terms(COUNT).budget === 2500, r);
r = ev('courtContractBudget', COUNT, 'N', 'bruma', 0);
ok('0 is allowed (no standing contract is paid)', r.kind === 'ok' && terms(COUNT).budget === 0 && terms(COUNT).left === 0, r);
ev('courtContractBudget', COUNT, 'N', 'bruma', 2500);

// ---- spent and left after a standing contract is taken -----------------------------------------------------------------
CITIZENS.add(HUNTER);
said.length = 0;
commands.get('contract')(HUNTER, '');
const listed = said.findIndex((l) => /standing/.test(l) && /^\s+\d+\./.test(l));
said.length = 0;
commands.get('contract')(HUNTER, `take ${listed > 0 ? listed : 1}`);
const st = terms(COUNT);
ok('a citizen takes a standing contract: spent goes up, left goes down', said.some((l) => /^Taken/.test(l)) && st.spent > 0 && st.left === 2500 - st.spent, [said, st.spent, st.left]);

// ---- standing on and off -------------------------------------------------------------------------------------------------
r = ev('courtContractStanding', COUNT, 'N', 'bruma', 'off');
ok('the Count stops standing contracts', r.kind === 'ok' && /posts no standing contracts/.test(r.text) && terms(COUNT).standing === false, r);
ok('...audited', /^CONTRACT Narina Carvain #CNT1 \(profile 11\) set Bruma standing off: /.test(lastAudit()), lastAudit());
r = ev('courtContractStanding', COUNT, 'N', 'bruma', true);
ok('...and starts them again (true reads as on)', r.kind === 'ok' && /posts standing contracts again/.test(r.text) && terms(COUNT).standing === true, r);
n = audits.length;
r = ev('courtContractStanding', COUNT, 'N', 'bruma', 'maybe');
ok('anything but on or off is refused', r.kind === 'refused' && /on\|off/.test(r.text) && terms(COUNT).standing === true && audits.length === n, r);
r = ev('courtContractStanding', GUARD, 'N', 'bruma', 'off');
ok('a Guard cannot stop them', r.kind === 'refused' && terms(COUNT).standing === true && audits.length === n, r);

// ---- the chat and the tab share one rule set -----------------------------------------------------------------------------
said.length = 0;
commands.get('contract')(COUNT, 'price 3 75');
ok('/contract price still works and the tab shows its result', terms(GUARD).prices[3] === 75 && terms(GUARD).tiers[2].price === 75, said);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left behind */ }
process.exit(fails ? 1 : 0);
