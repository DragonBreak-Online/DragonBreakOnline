// Scripted test for the hold's terms on standing hunting contracts (server\contracts.js; Nate, 17 Oct, from Ohoom's
// suggestion after Bruma paid ~17,100 gold a week to standing contracts). Checked: a hold's standing contracts are
// taken only by its citizens where citizenship.js gates the hold, and by anyone where it does not; the hold's
// tax-setters (business.js __dboCanSetHoldTax) set the pay per kill per tier within bounds and nobody else does; a
// weekly budget (UTC Monday) caps what standing copies commit, refuses takes once spent, gives back what a given-up or
// run-out copy held, and renews on Monday; work an official posts by hand is open to all and outside the budget; the
// treasury floor still applies; standing off takes notices down. Mock gamemode api, no server. Run from server\ as
//
//   node tests/contracts-citizens-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONTRACTS = path.resolve(__dirname, '..', 'contracts.js');
const TMP = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
process.chdir(fs.mkdtempSync(path.join(TMP, 'contracts-citizens-harness-')));

// A clock the harness moves: Wednesday 14 Oct 2026 12:00 UTC
const realNow = Date.now;
let NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
Date.now = () => NOW;
const HOUR = 3600000;

const GOLD = 0xf;
const CHEST = 0x02079b22;
// The Count of Bruma (sets its tax), a Guard of Bruma (an official who does not), two citizen hunters, an outsider
const COUNT = 0x21, GUARD = 0x22, CIT = 0x23, CIT2 = 0x25, OUT = 0x24;
const PROFILE = { [COUNT]: 11, [GUARD]: 12, [CIT]: 13, [OUT]: 14, [CIT2]: 15 };
const ACCOUNT = { 11: 'acc-count', 12: 'acc-guard', 13: 'acc-cit', 14: 'acc-out', 15: 'acc-cit2' };
const RANKS = { 11: [{ zone: { id: 'bruma' }, rank: 'count' }], 12: [{ zone: { id: 'bruma' }, rank: 'guard' }] };

const props = new Map();
const get = (id, p) => props.get(id + '|' + p);
const set = (id, p, v) => props.set(id + '|' + p, v);
const inv = (id, gold) => set(id, 'inventory', { entries: gold ? [{ baseId: GOLD, count: gold }] : [] });
const goldOf = (id) => ((get(id, 'inventory') || {}).entries || []).filter((e) => e.baseId === GOLD).reduce((s, e) => s + e.count, 0);
for (const a of [COUNT, GUARD, CIT, CIT2, OUT]) { inv(a, 0); set(a, 'worldOrCellDesc', 'BSHeartland.esm:BSHeartland'); }

fs.writeFileSync('NPC-Spawns.json', JSON.stringify([
  { Name: 'wild:wolf:1', ID: 'BSHeartland.esm:BSHeartland', POS: [0, 0, 0] },
  { Name: 'wild:bear:1', ID: 'BSHeartland.esm:BSHeartland', POS: [0, 0, 0] },
  { Name: 'wild:troll:1', ID: 'BSHeartland.esm:BSHeartland', POS: [0, 0, 0] },
]));
const zones = { holds: [
  { id: 'bruma', name: 'Bruma', treasury: '79b22:BSHeartland.esm', worldspaces: ['BSHeartland.esm:BSHeartland'], capital: [0, 0] },
], strongholds: [], regions: [] };

// citizenship.js and business.js, as their globalThis hooks
let GATES = true;
const CITIZENS = new Set([CIT, CIT2, COUNT]);
globalThis.__dboCitizenGates = (zid) => GATES && zid === 'bruma';
globalThis.__dboCitizenOf = (a, zid) => (GATES ? zid === 'bruma' && CITIZENS.has(a >>> 0) : true);
globalThis.__dboCanSetHoldTax = (a, zid) => zid === 'bruma' && (RANKS[PROFILE[a]] || []).some((r) => r.zone.id === zid && ['jarl', 'count', 'steward'].includes(r.rank));

const out = { personal: [], audits: [] };
const commands = new Map();
const ui = new Map();
const clear = () => { try { fs.unlinkSync(path.resolve('contracts.json')); } catch (e) { /* none yet */ } };
const load = (contracts) => {
  ui.clear(); commands.clear();
  out.personal.length = 0; out.audits.length = 0;
  delete require.cache[require.resolve(CONTRACTS)];
  require(CONTRACTS)({
    mp: { get, set, getIdFromDesc: (d) => (d === '79b22:BSHeartland.esm' ? CHEST : 0) },
    log: () => {},
    personal: (a, t) => out.personal.push({ a, t }),
    audit: (t) => out.audits.push(t),
    display: (a) => `P${a.toString(16)}`,
    who: (a) => `P${a.toString(16)}`,
    cfg: { contracts: Object.assign({ minSpots: 1, postsPerDay: 99 }, contracts) },
    giveItem: (a, base, n) => { inv(a, goldOf(a) + n); return true; },
    registerChatCommand: (n, fn) => commands.set(n, fn),
    zones,
    onUi: (n, fn) => { const l = ui.get(n) || []; l.push(fn); ui.set(n, l); },
    zoneOfActor: () => null,
    ranksOf: (pid) => RANKS[pid] || [],
    profileOf: (a) => PROFILE[a],
    saveSoon: (file, fn) => fs.writeFileSync(file, fn()),
    saveNow: (file, fn) => fs.writeFileSync(file, fn()),
    discordOf: (a) => ACCOUNT[PROFILE[a]] || '',
  });
};

let failures = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? '   ' + detail : ''}`); if (!ok) failures++; };
const run = (a, args) => { out.personal.length = 0; commands.get('contract')(a, args); return out.personal.map((p) => p.t); };
const said = (lines, re) => lines.some((l) => re.test(l));
const stored = () => { try { return JSON.parse(fs.readFileSync(path.resolve('contracts.json'), 'utf8')); } catch (e) { return { contracts: [], taken: {}, holds: {} }; } };
const live = () => stored().contracts.filter((c) => c.expiresAt > Date.now());
const standingIdx = (pred = () => true) => { const l = live(); for (let i = 0; i < l.length; i++) if (l[i].standing === true && pred(l[i])) return i + 1; return 0; };
const copies = (pid) => [].concat(stored().taken[pid] || []);
const hold = () => (stored().holds || {}).bruma || {};
const board = (a) => globalThis.__dboContractsBoard.view(a);
const BASE = { enabled: true, perZone: 3, rewardPerKill: { 1: 12, 2: 25, 3: 60 }, treasuryFloor: { gold: 0, share: 0 }, weeklyBudget: 100000, budgetMax: 100000 };

// ---- citizens only -------------------------------------------------------------------------------------------------
clear(); inv(CHEST, 100000);
load(BASE);
check('standing notices go up', standingIdx() > 0, `${live().length} posted`);
const outsider = run(OUT, `take ${standingIdx()}`);
check('a non-citizen cannot take a standing contract', said(outsider, /citizens of Bruma only/) && !copies('14').length, outsider.join(' | '));
const cit = run(CIT, `take ${standingIdx()}`);
check('a citizen takes it', said(cit, /^Taken/) && copies('13').length === 1, cit.join(' | '));
check('...and the copy is charged to the week\'s budget', hold().spent === copies('13')[0].held && copies('13')[0].charged > 0, JSON.stringify(hold()));
const bv = board(OUT);
const sv = bv.list.find((c) => c.standing);
check('the board shows the outsider "Citizens only" as the stamp (no Take button: state is not open)', sv && sv.state === 'Citizens only', JSON.stringify(sv));
check('...and names the hold in the notice', sv && /\(citizens of Bruma only\)$/.test(sv.what), sv && sv.what);
check('...and the payload carries citizensOnly and the budget', bv.citizensOnly === true && bv.citizen === false && bv.budget && bv.budget.total === 100000, JSON.stringify(bv.budget));
const bc = board(CIT2).list.find((c) => c.standing);
check('a citizen sees the same notice open', bc && bc.state === 'open', JSON.stringify(bc));
check('/contract status tells the outsider the rule', said(run(OUT, 'status'), /Only citizens of Bruma take its standing contracts \(you are not one\)/), run(OUT, 'status').join(' | '));

GATES = false;
check('a hold without citizenship keeps its standing work open: the outsider takes it', said(run(OUT, `take ${standingIdx()}`), /^Taken/), out.personal.map((p) => p.t).join(' | '));
check('...and the board shows it open with no citizens mark', board(OUT).list.filter((c) => c.standing && c.state !== 'yours').every((c) => c.state === 'open' && !/citizens/.test(c.what)));
check('...and status says open to every hunter', said(run(OUT, 'status'), /open to every hunter/));
GATES = true;

// ---- posted by hand: open to all, outside the budget ------------------------------------------------------------------
clear(); inv(CHEST, 100000);
load(Object.assign({}, BASE, { perZone: 0, weeklyBudget: 0 }));
check('budget 0: no standing notice goes up', live().length === 0, `${live().length}`);
check('an official posts by hand', said(run(COUNT, 'post wolf 5 60'), /^Posted/), out.personal.map((p) => p.t).join(' | '));
const posted = run(OUT, 'take 1');
check('a non-citizen takes a posted notice, budget 0 or not', said(posted, /^Taken/), posted.join(' | '));
check('...and it is not charged to the standing budget', !(hold().spent > 0), JSON.stringify(hold()));
check('...but to the week\'s posting budget (Nat, 25 Oct)', hold().postSpent === 60 && copies('14')[0].pool === 'posted', JSON.stringify(hold()));
check('the board shows a posted notice open to the outsider', board(GUARD).list[0].state === 'open' && !/citizens/.test(board(GUARD).list[0].what));

// ---- prices --------------------------------------------------------------------------------------------------------
clear(); inv(CHEST, 100000);
load(BASE);
const before = live().length;
check('a guard (no tax rights) cannot set the price', said(run(GUARD, 'price 1 30'), /Only those who set Bruma's tax/) && !(hold().prices), out.personal.map((p) => p.t).join(' | '));
check('nor can a hunter', said(run(CIT, 'budget 10'), /Only those who set Bruma's tax/));
check('the Count cannot go under the bounds', said(run(COUNT, 'price 1 0'), /from 1 to 200/) && !(hold().prices));
check('...nor over them', said(run(COUNT, 'price 3 201'), /from 1 to 200/) && !(hold().prices));
check('...nor name a tier that is not 1, 2 or 3', said(run(COUNT, 'price 4 20'), /Use: \/contract price/));
const p1 = run(COUNT, 'price 1 5');
check('the Count sets tier 1 to 5 gold a kill', said(p1, /now pays 5 gold a kill for pests \(tier 1; was 12\)/) && hold().prices['1'] === 5, p1.join(' | '));
check('...audited', out.audits.some((t) => /CONTRACT P21 set Bruma price 1 5/.test(t)), out.audits.join(' | '));
const wolves = live().filter((c) => c.kind === 'wolf' && c.standing);
check('...and the wolf notices are reposted at 5 a kill', wolves.length > 0 && wolves.every((c) => c.reward === c.count * 5), JSON.stringify(wolves.map((c) => [c.count, c.reward])));
check('the bounds come from config', (() => { load(Object.assign({}, BASE, { priceBounds: { min: 2, max: 50 } })); return said(run(COUNT, 'price 2 60'), /from 2 to 50/) && said(run(COUNT, 'price 2 50'), /now pays 50/); })());
check('a status line shows the prices to anyone', said(run(OUT, 'status'), /tier 1 \(pests\) 5 gold, tier 2 \(dangerous beasts\) 50 gold, tier 3 \(deadly beasts\) 50 gold/), run(OUT, 'status').join(' | '));
// (tier 3 was set to 60 under the old bounds: a price outside new bounds is held to them)
void before;

// ---- the weekly budget ---------------------------------------------------------------------------------------------
clear(); inv(CHEST, 100000);
NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
load(Object.assign({}, BASE, { perZone: 6, countRange: [4, 4] }));
run(COUNT, 'price 1 10'); run(COUNT, 'price 2 10'); run(COUNT, 'price 3 10');
const cheapest = live().filter((c) => c.standing).reduce((m, c) => Math.min(m, c.reward), Infinity);
check('a guard cannot set the budget', said(run(GUARD, 'budget 50'), /Only those who set Bruma's tax/));
check('the budget refuses a negative or too large sum', said(run(COUNT, 'budget -1'), /from 0 to 100000/) && said(run(COUNT, 'budget 100001'), /from 0 to 100000/));
const firstReward = live().find((c) => c.standing).reward;
check('the Count sets a budget of one notice', said(run(COUNT, `budget ${firstReward}`), new RegExp(`may now commit ${firstReward} gold a week`)), out.personal.map((p) => p.t).join(' | '));
const t1 = run(CIT, `take ${standingIdx((c) => c.reward === firstReward)}`);
check('a citizen takes work up to the budget', said(t1, /^Taken/), t1.join(' | '));
check('...spent this week = its reward', hold().spent === firstReward, JSON.stringify(hold()));
const t2 = run(CIT2, `take ${standingIdx()}`);
check('the next take is refused, naming the reset', said(t2, /spent this week's budget .* resets Monday 00:00 UTC \(in 4d 12h\)/) && !copies('15').length, t2.join(' | '));
check('the board stamps budget-spent notices for a citizen', board(CIT2).list.filter((c) => c.standing).every((c) => c.state === 'Budget spent'), JSON.stringify(board(CIT2).list.map((c) => c.state)));
// The citizen finishes the work: paid, so the week's budget stays spent
const mine = copies('13')[0];
let body = 0x6000;
for (let i = 0; i < mine.count; i++) { const b = body++; set(b, 'private.npcSpawner', `wild:${mine.kind}:1`); set(b, 'worldOrCellDesc', 'BSHeartland.esm:BSHeartland'); globalThis.__dboContractKill(b, CIT); }
check('the citizen is paid for finishing', goldOf(CIT) === firstReward && !copies('13').length, `${goldOf(CIT)} gold`);
check('...and the budget stays spent', hold().spent === firstReward, JSON.stringify(hold()));
// Notices that expire are not replaced while the budget is spent
NOW += 13 * HOUR;
board(CIT2);
check('no new standing notice goes up with the budget spent', live().filter((c) => c.standing).length === 0, `${live().length} live`);
check('...and the board says why, with the budget left', /budget for standing work spent\. Standing work this week: 0 of \d+ gold left, renewed Monday 00:00 UTC/.test(board(CIT2).note), board(CIT2).note);
NOW = Date.UTC(2026, 9, 19, 0, 0, 1); // Monday
check('on Monday 00:00 UTC the budget renews', said(run(OUT, 'status'), new RegExp(`This week's budget: ${firstReward} of ${firstReward} gold left`)), run(OUT, 'status').join(' | '));
check('...and standing notices go up again', (board(CIT2), live().filter((c) => c.standing).length > 0), `${live().length}`);
const t3 = run(CIT, `take ${standingIdx((c) => c.reward <= firstReward)}`);
check('a citizen takes in the new week', said(t3, /^Taken/) && hold().spent > 0, t3.join(' | '));
const chestBefore = goldOf(CHEST);
const ab = run(CIT, 'abandon');
check('giving it up returns its budget', said(ab, /given up/) && hold().spent === 0, `${hold().spent} spent`);
check('...and its gold to the treasury', goldOf(CHEST) > chestBefore, `${chestBefore} -> ${goldOf(CHEST)}`);
run(CIT, `take ${standingIdx((c) => c.reward <= firstReward)}`);
check('taken again', hold().spent > 0, JSON.stringify(hold()));
NOW += 13 * HOUR;
board(CIT);
check('a copy that runs out gives its budget back', hold().spent === 0, JSON.stringify(hold()));
// A copy charged last week that is given up this week does not inflate this week's budget
NOW = Date.UTC(2026, 9, 25, 23, 0, 0);
run(COUNT, 'budget 1000');
board(CIT);
run(CIT, `take ${standingIdx()}`);
const lastWeek = hold().spent;
NOW = Date.UTC(2026, 9, 26, 0, 30, 0);
run(CIT, 'abandon');
check('a copy taken last week and given up now does not add to this week', lastWeek > 0 && hold().spent === 0 && hold().week === '2026-10-26' && said(run(OUT, 'status'), /1000 of 1000 gold left/), JSON.stringify(hold()));
check('the cheapest notice was priced by the hold (10 a kill)', cheapest >= 20 && cheapest % 10 === 0, `${cheapest}`);

// ---- the treasury floor still applies -----------------------------------------------------------------------------
clear(); inv(CHEST, 100000);
NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
load(BASE);
const idx = standingIdx();
run(CIT, `take ${idx}`);
// A second hunter needs gold set aside from the treasury itself, above its floor
load(Object.assign({}, BASE, { treasuryFloor: { gold: 10000000, share: 0 } }));
const spentBefore = hold().spent;
const fl = run(CIT2, `take ${idx}`);
check('the floor still refuses a take the budget would allow', said(fl, /cannot spare more bounties/) && !copies('15').length, fl.join(' | '));
check('...and charges nothing to the budget', hold().spent === spentBefore, `${spentBefore} -> ${hold().spent}`);

// ---- standing off --------------------------------------------------------------------------------------------------
clear(); inv(CHEST, 100000);
load(BASE);
run(COUNT, 'post bear 2 40');
const heldInNotices = live().reduce((s, c) => s + (Number(c.held) || 0), 0);
const c0 = goldOf(CHEST);
check('a guard cannot stop standing work', said(run(GUARD, 'standing off'), /Only those who set/));
const off = run(COUNT, 'standing off');
check('the Count stops standing work', said(off, /posts no standing contracts/), off.join(' | '));
check('...standing notices come down, the posted one stays', live().length === 1 && live()[0].standing === false, JSON.stringify(live().map((c) => c.kind)));
check('...and their gold goes back to the treasury', goldOf(CHEST) === c0 + heldInNotices - 40, `${c0} -> ${goldOf(CHEST)} (${heldInNotices} held)`);
check('...and no new one goes up', (board(CIT), live().filter((c) => c.standing).length === 0));
run(COUNT, 'standing on');
check('on again: standing notices return', (board(CIT), live().filter((c) => c.standing).length > 0));
check('state survives a reload', (load(BASE), hold().standing === true && hold().by === 'P21'), JSON.stringify(hold()));

Date.now = realNow;
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
