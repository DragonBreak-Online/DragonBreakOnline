// Scripted test for server\contracts.js, Nat's 25 Oct contracts work (ticket 0414, Bruma's treasurer: "add Ogres ... there is
// only a single bear within the county"): every creature a hold's spots put down is work, undead and goblins included,
// at least minSpots spots each and at most tierLimit tier-3 notices; an official's post is capped by the hold's own pay and
// paid out of a weekly posting budget, a few posts a day each; commissions buy plain goods at up to 1.5x their worth, handed
// in at the board, the goods into the treasury chest; a poster takes a notice down and its gold goes back. A mock gamemode
// api whose records carry the real editor ids. No server and no game. Run it from this folder's parent with
//
//   node tests/contracts-fauna-commissions-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONTRACTS = path.resolve(__dirname, '..', 'contracts.js');
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'contracts-fauna-commissions-harness-')));

const GOLD = 0xf;
const CHEST = 0x02079b22;
const WORLD = 'BSHeartland.esm:BSHeartland';
// The Count (an official who sets the tax), the treasurer (an official who does not) and a hunter with no rank
const COUNT = 0x21, TREASURER = 0x22, HUNTER = 0x23;
const PROFILE = { [COUNT]: 11, [TREASURER]: 12, [HUNTER]: 13 };
const RANKS = { 11: [{ zone: { id: 'bruma' }, rank: 'count' }], 12: [{ zone: { id: 'bruma' }, rank: 'treasurer' }], 13: [] };
globalThis.__dboCanSetHoldTax = (a, zid) => a === COUNT && zid === 'bruma';

// Editor ids as the masters have them (read with ck-mcp esplib, 25 Oct)
const RECORDS = {
  '5f056:BSHeartland.esm': [0x0205f056, 'CYREncOgre01'],
  '60242a:BSAssets.esm': [0x0160242a, 'BSKEncRat'],
  '60242e:BSAssets.esm': [0x0160242e, 'BSKEncBoar01'],
  '5bc2e:BSHeartland.esm': [0x0205bc2e, 'CYREncSkeleton01Melee1H'],
  '6025f5:BSAssets.esm': [0x016025f5, 'BSKEncGoblin00Template'],
  '5f055:BSHeartland.esm': [0x0205f055, 'CYREncMountainLion'],
  '4932a:BSHeartland.esm': [0x0204932a, 'CYREncTroll'],
  '8b600:BSHeartland.esm': [0x0208b600, 'CYREncMinotaur'],
  '23ab3:Skyrim.esm': [0x00023ab3, 'EncIceWraith'],
  '4932b:BSHeartland.esm': [0x0204932b, 'CYREncBearBrown'],
};
// Goods for commissions: a pelt worth 10, firewood worth 2
const PELT = 0x0003ad6e, WOOD = 0x0006f993;
const ITEMS = { '3ad6e:Skyrim.esm': PELT, '6f993:Skyrim.esm': WOOD };
const VALUE = { [PELT]: 10, [WOOD]: 2 };
globalThis.__dboBaseValue = (id) => VALUE[id >>> 0] || 0;
const BY_ID = new Map(Object.values(RECORDS).map(([id, edid]) => [id, edid]));
const getIdFromDesc = (d) => (d === '79b22:BSHeartland.esm' ? CHEST : RECORDS[d] ? RECORDS[d][0] : ITEMS[d] || 0);
const lookupEspmRecordById = (id) => (BY_ID.has(id) ? { record: { editorId: BY_ID.get(id), type: 'NPC_' } } : null);

const props = new Map();
const get = (id, p) => props.get(id + '|' + p);
const set = (id, p, v) => props.set(id + '|' + p, v);
const entries = (id) => ((get(id, 'inventory') || {}).entries || []);
const count = (id, base) => entries(id).filter((e) => e.baseId === base).reduce((n, e) => n + e.count, 0);
const give = (id, base, n, extra) => set(id, 'inventory', { entries: entries(id).concat([Object.assign({ baseId: base, count: n }, extra || {})]) });
for (const a of [COUNT, TREASURER, HUNTER]) { set(a, 'inventory', { entries: [] }); set(a, 'worldOrCellDesc', WORLD); }
set(CHEST, 'inventory', { entries: [{ baseId: GOLD, count: 100000 }] });

// Bruma's spots, in the proportions measured on 25 Oct (41 ogres, 13 boars, 9 rats, ...), trimmed; one ice wraith
const spots = [];
const add = (desc, n, kind) => { for (let i = 0; i < n; i++) spots.push({ Name: `wild:${kind}:${spots.length}`, ID: WORLD, POS: [0, 0, 0], NPC: [{ id: desc, count: 1 }] }); };
add('5f056:BSHeartland.esm', 6, 'wolf'); add('60242a:BSAssets.esm', 4, 'wolf'); add('60242e:BSAssets.esm', 4, 'boar');
add('5bc2e:BSHeartland.esm', 3, 'skeleton'); add('6025f5:BSAssets.esm', 3, 'goblin'); add('5f055:BSHeartland.esm', 3, 'wolf');
add('4932a:BSHeartland.esm', 5, 'wolf'); add('8b600:BSHeartland.esm', 3, 'wolf'); add('23ab3:Skyrim.esm', 1, 'wolf');
add('4932b:BSHeartland.esm', 2, 'wolf');
fs.writeFileSync('NPC-Spawns.json', JSON.stringify({ zones: spots }));
fs.writeFileSync('admin-items.json', JSON.stringify({ categories: [
  { id: 'Misc', items: [['3ad6e:Skyrim.esm', 'Wolf Pelt', 'Skyrim.esm'], ['6f993:Skyrim.esm', 'Firewood', 'Skyrim.esm']] },
  { id: 'Keys', items: [['f:Skyrim.esm', 'Firewood Key', 'Skyrim.esm']] },
] }));

const out = { personal: [] };
const commands = new Map();
const ui = new Map();
const zones = { holds: [{ id: 'bruma', name: 'Bruma', treasury: '79b22:BSHeartland.esm', worldspaces: [WORLD], capital: [0, 0] }], strongholds: [], regions: [] };
const load = (extra) => {
  commands.clear();
  delete require.cache[require.resolve(CONTRACTS)];
  require(CONTRACTS)({
    mp: { get, set, getIdFromDesc, lookupEspmRecordById },
    log: () => {},
    personal: (a, t) => out.personal.push({ a, t }),
    audit: () => {},
    display: (a) => `P${a.toString(16)}`,
    who: (a) => `P${a.toString(16)}`,
    cfg: { contracts: Object.assign({ enabled: true, perZone: 0, treasuryFloor: { gold: 0, share: 0 } }, extra || {}) },
    giveItem: (a, base, n) => { give(a, base, n); return true; },
    registerChatCommand: (n, fn) => commands.set(n, fn),
    zones,
    onUi: (n, fn) => ui.set(n, fn),
    zoneOfActor: () => 'bruma',
    ranksOf: (pid) => RANKS[pid] || [],
    profileOf: (a) => PROFILE[a],
    saveSoon: (file, fn) => fs.writeFileSync(file, fn()),
    saveNow: (file, fn) => fs.writeFileSync(file, fn()),
    discordOf: (a) => `acc-${PROFILE[a]}`,
  });
};

let failures = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? '   ' + detail : ''}`); if (!ok) failures++; };
const run = (a, args) => { out.personal.length = 0; commands.get('contract')(a, args); return out.personal.map((p) => p.t); };
const said = (lines, re) => lines.some((l) => re.test(l));
const stored = () => JSON.parse(fs.readFileSync(path.resolve('contracts.json'), 'utf8'));
const hold = () => stored().holds.bruma || {};
const chestGold = () => count(CHEST, GOLD);
const T = () => globalThis.__dboContractTerms;

// ---- C1, C2: the kinds Bruma's spots really put down ----
load({ minSpots: 3 });
const view = T().view(COUNT, 'bruma');
const kinds = view.fauna.map((f) => f.kind);
check('ogres are work in Bruma (the ticket)', kinds.includes('ogre'), kinds.join(','));
check('...and boars, rats, skeletons, goblins, mountain lions, trolls and minotaurs', ['boar', 'rat', 'skeleton', 'goblin', 'mountainlion', 'troll', 'minotaur'].every((k) => kinds.includes(k)), kinds.join(','));
const standingKinds = () => { load({ minSpots: 3, perZone: 30, weeklyBudget: 100000 }); T().set(COUNT, 'bruma', 'budget', ['100000']); return stored().contracts.filter((c) => c.standing).map((c) => c.kind); };
const sk = standingKinds();
check('a lone ice wraith (1 spot) and the 2 bears get no standing work (minSpots 3)', !sk.includes('icewraith') && !sk.includes('bear') && sk.includes('ogre'), sk.join(','));
load({ minSpots: 3 });
check('...but an official may still post for them by hand, and the Court tab lists them', kinds.includes('bear') && kinds.includes('icewraith'), kinds.join(','));
check('an ogre is tier 3, a boar tier 1, a mountain lion tier 2', view.fauna.find((f) => f.kind === 'ogre').tier === 3 && view.fauna.find((f) => f.kind === 'boar').tier === 1 && view.fauna.find((f) => f.kind === 'mountainlion').tier === 2);
check('the court view names them for people ("mountain lions")', view.fauna.some((f) => f.name === 'mountain lions'));

// ---- C8: standing work, at most 2 tier-3 notices ----
{ const raw = stored(); raw.contracts = raw.contracts.filter((c) => !c.standing); fs.writeFileSync('contracts.json', JSON.stringify(raw)); }
load({ minSpots: 3, tierLimit: { 3: 2 }, perZone: 12, weeklyBudget: 100000 });
T().set(COUNT, 'bruma', 'budget', ['100000']);
const up = stored().contracts.filter((c) => c.standing);
const tier3 = up.filter((c) => ['ogre', 'troll', 'minotaur'].includes(c.kind));
check('the board fills with the real fauna', up.length >= 5, up.map((c) => c.kind).join(','));
check('at most 2 tier-3 notices (tierLimit)', tier3.length <= 2, tier3.map((c) => c.kind).join(','));

// ---- C4: posting by hand ----
load({ minSpots: 3, postBudget: 300, postsPerDay: 2 });
let r = run(TREASURER, 'post ogre 3 999');
check('a post is capped by the hold\'s own pay per kill (3 x 60)', said(r, /worth at most 180 gold at Bruma's pay of 60/), r.join(' | '));
T().set(COUNT, 'bruma', 'price', ['3', '80']);
r = run(TREASURER, 'post ogres 3 240');
check('...which its tax-setter raised to 80: the treasurer posts 3 ogres for 240 ("ogres" is understood)', said(r, /^Posted: 3 ogres in Bruma for 240 gold/), r.join(' | '));
r = run(TREASURER, 'post mountain lion 2 50');
check('"mountain lion" in two words is understood', said(r, /^Posted: 2 mountain lions/), r.join(' | '));
r = run(TREASURER, 'post boar 2 24');
check('a third post the same day is refused (postsPerDay 2)', said(r, /posted 2 notices in the last day/), r.join(' | '));
r = run(HUNTER, 'post boar 2 24');
check('someone with no rank cannot post', said(r, /Only an official of Bruma/), r.join(' | '));
const before = chestGold();
const ogreAt = stored().contracts.filter((c) => c.zone === 'bruma' && c.expiresAt > Date.now()).findIndex((c) => c.kind === 'ogre' && !c.standing) + 1;
r = run(HUNTER, `take ${ogreAt}`);
check('a hunter takes the ogre notice', said(r, /^Taken/), r.join(' | '));
check('...charged to the posting budget, not the standing one', hold().postSpent === 240 && !(hold().spent > 0), JSON.stringify(hold()));
check('...and the notice\'s held share paid for it (no new escrow)', chestGold() === before, `${before} -> ${chestGold()}`);
r = run(COUNT, 'post ogre 2 160');
check('the posting budget (300) refuses what would pass it', said(r, /budget for posted work: 60 of 300/), r.join(' | '));
r = run(COUNT, 'postbudget 2000');
check('the Count raises the posting budget', said(r, /may now commit 2000 gold a week \(was 300\)/), r.join(' | '));
r = run(TREASURER, 'postbudget 9000');
check('...a treasurer cannot', said(r, /Only those who set Bruma's tax/), r.join(' | '));

// ---- C5: commissions ----
load({ minSpots: 3, postBudget: 2000, postsPerDay: 9 });
r = run(TREASURER, 'commission wolf pelt 10 20');
check('a commission is capped at 1.5x the goods\' worth (pelt 10 -> 15)', said(r, /pays at most 15 gold each for Wolf Pelt/), r.join(' | '));
const chest0 = chestGold();
r = run(TREASURER, 'commission wolf pelt 10 15');
check('the treasurer commissions 10 wolf pelts at 15', said(r, /^Commission posted: 10 Wolf Pelt at 15/), r.join(' | '));
check('...150 gold held from the treasury and charged to the posting budget', chestGold() === chest0 - 150 && hold().postSpent >= 150, `${chest0 - chestGold()} held, postSpent ${hold().postSpent}`);
r = run(TREASURER, 'commission firewood key 1 1');
check('keys are not among the goods a hold buys', said(r, /No goods a hold buys match/), r.join(' | '));
const board = globalThis.__dboContractsBoard.view(HUNTER);
const row = board.list.find((x) => x.type === 'commission');
check('the board lists it as a commission, with what the hunter carries', !!row && row.have === 0 && row.price === 15 && row.count === 10, JSON.stringify(row));
give(HUNTER, PELT, 4);
give(HUNTER, PELT, 1, { name: 'Lucky Pelt' });
const n = stored().contracts.findIndex((c) => c.type === 'commission') + 1;
r = run(HUNTER, `deliver ${n}`);
check('handing in takes the 4 plain pelts, not the named one, and pays 60', said(r, /Handed in 4 Wolf Pelt: 60 gold/), r.join(' | '));
check('...the named pelt stays in the pack', count(HUNTER, PELT) === 1 && entries(HUNTER).some((e) => e.name === 'Lucky Pelt'));
check('...the 4 pelts are in the treasury chest', count(CHEST, PELT) === 4, `${count(CHEST, PELT)}`);
check('...the commission wants 6 more', stored().contracts.find((c) => c.type === 'commission').delivered === 4);
r = run(TREASURER, `deliver ${n}`);
check('the poster cannot fill his own commission', said(r, /posted that commission yourself/), r.join(' | '));
// the Court tab: the same rules
const cview = T().view(TREASURER, 'bruma');
check('the court view lists what is posted, the treasurer may take his own down', cview.posted.some((p) => p.type === 'commission' && p.mine && p.canWithdraw) && cview.canPost, JSON.stringify(cview.posted));
T().search(TREASURER, 'bruma', 'pelt');
check('the commission search answers in the next view', (T().view(TREASURER, 'bruma').search || {}).items.some((i) => i.name === 'Wolf Pelt' && i.maxPrice === 15));
const spentBefore = hold().postSpent, chestBefore = chestGold();
const cid = stored().contracts.find((c) => c.type === 'commission').id;
r = T().withdraw(TREASURER, 'bruma', cid);
check('withdrawing gives the 90 still held back to the treasury', !!r.text && chestGold() === chestBefore + 90, `${r.text || r.error}; ${chestBefore} -> ${chestGold()}`);
check('...and to the week\'s posting budget', hold().postSpent === spentBefore - 90, `${spentBefore} -> ${hold().postSpent}`);
r = T().post(TREASURER, 'bruma', 'troll', 2, 120);
check('the Court tab posts hunting work too', !!r.text && /^Posted: 2 trolls/.test(r.text), r.text || r.error);
// an unfilled commission that runs out
run(TREASURER, 'commission firewood 5 3');
const c = stored().contracts.find((x) => x.type === 'commission');
const raw = stored(); raw.contracts.find((x) => x.id === c.id).expiresAt = Date.now() - 1; fs.writeFileSync('contracts.json', JSON.stringify(raw));
const chestPre = chestGold();
load({ minSpots: 3, postBudget: 2000, postsPerDay: 9 });
run(HUNTER, '');
check('a commission that runs out gives its 15 back', chestGold() === chestPre + 15 && !stored().contracts.some((x) => x.id === c.id), `${chestPre} -> ${chestGold()}`);

console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
