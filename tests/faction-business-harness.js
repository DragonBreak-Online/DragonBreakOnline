// Faction businesses (business.js /business faction, Nate 18-19 Oct): a faction's leader or officers register a business for
// the faction (one its owner offered, one the leader owns, or one in the faction's hall); its takings (bed rent through
// rest.js's hook, rented chests, ledger sales through ledgersale.js) then go to the faction's treasury instead of the owner;
// the faction names members as staff; the leader or the owner hand it back; every step is audited; one faction at a time.
// Loads the real business.js and ledgersale.js against a stub mp in a scratch directory.
//   node tests/faction-business-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-factionbiz-'));
process.chdir(scratch);

const CELL = 0x100, WORLD = 0x3c, DOOR = 0x200, OUTDOOR = 0x201, CHEST = 0x300, CHEST_BASE = 0x301, SHELF = 0x302;
const HALLCELL = 0x110, HALLDOOR = 0x210, HALLOUT = 0x211;
const OWNER = 0xff000001, LEAD = 0xff000002, OFFICER = 0xff000003, MEMBER = 0xff000004, RENTER = 0xff000005, STRAY = 0xff000006, COMP = 0xff000007, HALLOWNER = 0xff000008;
const PROFILE = { [OWNER]: 7, [LEAD]: 8, [OFFICER]: 9, [MEMBER]: 10, [RENTER]: 11, [STRAY]: 12, [COMP]: 13, [HALLOWNER]: 14 };
const NAME = { [OWNER]: 'Olaf', [LEAD]: 'Eadric', [OFFICER]: 'Ofelia', [MEMBER]: 'Mirri', [RENTER]: 'Rena', [STRAY]: 'Stray', [COMP]: 'Kodlak', [HALLOWNER]: 'Hal' };
const FG = { id: 'fighters-guild', name: 'Fighters Guild' };
const MEMBERS = {
  [OWNER]: [[FG, 'member'], [{ id: 'companions', name: 'Companions' }, 'member']],
  [LEAD]: [[FG, 'leader']], [OFFICER]: [[FG, 'officer']], [MEMBER]: [[FG, 'member']],
  [COMP]: [[{ id: 'companions', name: 'Companions' }, 'leader']],
};
let FG_EXISTS = true;
globalThis.__dboGuildsOf = (a) => (MEMBERS[a] || []).map(([f, role]) => ({ id: f.id, name: f.name, role, title: role }));
globalThis.__dboGuildInfo = (id) => (id === FG.id && !FG_EXISTS ? null : ['fighters-guild', 'companions'].includes(id) ? { id, name: id === FG.id ? FG.name : 'Companions' } : null);
globalThis.__dboHallOf = (refs) => (refs.includes(HALLDOOR) ? ['companions'] : []);
const deposits = []; let REFUSE = false;
globalThis.__dboTreasury = { deposit: (fid, n, why, o) => { if (REFUSE) return false; deposits.push({ fid, n, why, income: o && o.income }); return true; } };
const factionGold = (fid) => deposits.filter((d) => d.fid === fid).reduce((n, d) => n + d.n, 0);

fs.writeFileSync('housing.json', JSON.stringify([DOOR, HALLDOOR]));
const props = new Map();
const setp = (id, k, v) => props.set(`${id}|${k}`, v);
const desc = (id) => `${id.toString(16)}:Skyrim.esm`;
setp(DOOR, 'private.housing', { owner: 7, ownerName: 'Olaf', partner: OUTDOOR });
setp(HALLDOOR, 'private.housing', { owner: 14, ownerName: 'Hal', partner: HALLOUT });
for (const [d, c] of [[DOOR, CELL], [OUTDOOR, WORLD], [HALLDOOR, HALLCELL], [HALLOUT, WORLD], [CHEST, CELL], [SHELF, CELL]]) setp(d, 'worldOrCellDesc', desc(c));
setp(CHEST, 'baseDesc', desc(CHEST_BASE));
for (const a of Object.keys(PROFILE).map(Number)) { setp(a, 'worldOrCellDesc', desc(CELL)); setp(a, 'type', 'MpActor'); }
setp(HALLOWNER, 'worldOrCellDesc', desc(HALLCELL)); setp(COMP, 'worldOrCellDesc', desc(HALLCELL));
const TYPES = { [CELL]: 'CELL', [HALLCELL]: 'CELL', [WORLD]: 'WRLD', [CHEST_BASE]: 'CONT' };
const gold = Object.fromEntries(Object.keys(PROFILE).map((a) => [a, 0])); gold[RENTER] = 500;
const treasury = {}, said = [], cmds = {}, ui = {}, audits = [];
const mp = {
  get: (id, k) => props.get(`${id}|${k}`), set: setp,
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16),
  lookupEspmRecordById: (id) => (TYPES[id] ? { record: { type: TYPES[id] } } : null),
  getActorsByProfileId: (p) => Object.keys(PROFILE).filter((a) => PROFILE[a] === p).map(Number),
  getDescFromId: (id) => (id >>> 0).toString(16),
  callPapyrusFunction: (kind, cls, fn) => (fn === 'PlaceAtMe' ? null : null),
};
const api = {
  mp, log: () => {}, audit: (t) => audits.push(t), who: (a) => NAME[a], display: (a) => NAME[a],
  personal: (a, t) => said.push([a, t]), cfg: { rest: { holdShare: 0.1 }, business: { chestRentPaused: false }, ledgerSale: { hallCells: {} } },
  openWidget: (a, w) => said.push([a, w.type === 'businessLedger' ? 'PANEL ' + w.ownerName : 'MENU ' + w.targetName]), closeWidget: () => {},
  onUi: (n, f) => { ui[n] = f; }, registerChatCommand: (n, f) => { cmds[n] = f; },
  onlineActors: () => Object.keys(PROFILE).map(Number), profileOf: (a) => PROFILE[a] ?? -1,
  findByName: (q) => Number(Object.keys(NAME).find((a) => NAME[a].toLowerCase() === String(q).toLowerCase())) || 0,
  takeGold: (a, n) => { if (gold[a] < n) return false; gold[a] -= n; return true; },
  giveGold: (a, n) => { gold[a] += n; return true; },
  depositToTreasury: (z, n) => { treasury[z] = (treasury[z] || 0) + n; return n; },
  zoneOfActor: () => 'bruma', zoneById: (id) => ({ id, name: 'Bruma' }),
  ranksOf: () => [], distanceMeters: () => 1, isAdmin: () => false,
};
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); if (!c) fails++; };
const last = (a) => { for (let i = said.length - 1; i >= 0; i--) if (said[i][0] === a) return said[i][1]; return ''; };
globalThis.__dboBusiness = undefined; globalThis.__dboBusinessPass = undefined;
require(path.resolve(__dirname, '..', 'business.js'))(api);
require(path.resolve(__dirname, '..', 'ledgersale.js'))(api);
const all = () => JSON.parse(fs.readFileSync('businesses.json', 'utf8')).businesses;
const biz = () => all()[DOOR.toString(16)];
const run = (a, args) => { cmds.business(a, args); return last(a); };

// ---- registering ---------------------------------------------------------------------------------------------------
run(OWNER, 'open The Iron Fist');
ok(biz() && !biz().faction, 'a business keeps its own books at first');
ok(/not a member of a faction called/.test(run(OWNER, 'faction thieves-guild')), 'the owner cannot offer it to a faction they are not in');
ok(/Only Fighters Guild's leader or officers/.test(run(MEMBER, 'faction fighters-guild')) && !biz().faction && !biz().factionOffer, 'a plain member who is not the owner can do nothing');
ok(/has to offer it to Fighters Guild first/.test(run(LEAD, 'faction fighters-guild')) && !biz().faction, 'the leader cannot take a member\'s business without the owner\'s offer');
ok(/is offered to Fighters Guild/.test(run(OWNER, 'faction Fighters Guild')) && biz().factionOffer.id === 'fighters-guild', 'the owner (a member) offers it, by the faction\'s name');
ok(said.some(([a, t]) => a === LEAD && /offers The Iron Fist to Fighters Guild/.test(t)) && said.some(([a, t]) => a === OFFICER && /offers/.test(t)), '...and the leader and officers online are told');
ok(/keeps its books for Fighters Guild now/.test(run(OFFICER, 'faction fighters-guild')) && biz().faction.id === 'fighters-guild' && !biz().factionOffer, 'an officer accepts it inside the business');
ok(audits.some((t) => /BUSINESS Olaf offered The Iron Fist .* to faction fighters-guild/.test(t)) && audits.some((t) => /BUSINESS Ofelia registered The Iron Fist .* for faction fighters-guild \(offered by its owner\)/.test(t)), 'offer and registration are audited');
ok(biz().log.some((e) => /registered The Iron Fist for Fighters Guild/.test(e.text)), '...and written in the ledger');
ok(/one faction at a time/.test(run(OWNER, 'faction companions')) && biz().faction.id === 'fighters-guild', 'one faction at a time');
ok(/already keeps its books for Fighters Guild/.test(run(LEAD, 'faction fighters-guild')), 'registering twice says so');

// ---- the takings -----------------------------------------------------------------------------------------------------
// bed rent: rest.js hands the owner's share to the hook
ok(/18 to the treasury of Fighters Guild/.test(globalThis.__dboBusinessPayFaction(CELL, 18, 'bed rent')) && factionGold('fighters-guild') === 18 && gold[OWNER] === 0, 'bed rent: the owner\'s share goes to the faction\'s treasury, not the owner');
ok(deposits[0].income === 'business', '...marked as business income (bank.js counts it only for a hold faction)');
ok(globalThis.__dboBusinessFactionAt(CELL).id === 'fighters-guild' && globalThis.__dboBusinessFactionAt(HALLCELL) === null, 'the faction is known by the business\'s cell');
// a rented chest
cmds.business(OWNER, 'chest 10');
globalThis.__dboBusinessActivate(CHEST, OWNER);
globalThis.__dboBusinessActivate(CHEST, RENTER);
ui.bizChoose(RENTER, ['rent3']);
ok(gold[RENTER] === 470 && factionGold('fighters-guild') === 18 + 27 && treasury.bruma === 3 && gold[OWNER] === 0, 'a rented chest: 30 gold, 3 tax to the hold, 27 to the faction', [gold[RENTER], factionGold('fighters-guild'), treasury, gold[OWNER]]);
// a ledger sale in the business (ledgersale.js): 100 gold, 10 tax, 10 sink, 80 to the faction
const sale = globalThis.__dboLedgerSale({ buyer: RENTER, place: SHELF, price: 100, what: 'a sword' });
ok(sale.owner.kind === 'faction' && sale.owner.paid === 80 && factionGold('fighters-guild') === 125, 'a ledger sale: the owner\'s share goes to the faction', sale.owner);
// the panel and the public page name the faction
cmds.business(RENTER, '');
ok(/kept by Olaf for Fighters Guild/.test(last(RENTER)), 'the public page names the faction');

// ---- staff ---------------------------------------------------------------------------------------------------------
ok(/Mirri is staff/.test(run(LEAD, 'staff add Mirri')) && biz().staff.some((s) => s.profile === 10 && s.faction === 'fighters-guild'), 'the leader names a member as staff for the faction');
ok(/is not a member of Fighters Guild/.test(run(LEAD, 'staff add Rena')) && !biz().staff.some((s) => s.profile === 11), 'the leader cannot name a non-member');
ok(/Only the owner/.test(run(MEMBER, 'staff add Stray')), 'faction staff cannot name staff');
ok(/is staff/.test(run(OWNER, 'staff add Rena')) && biz().staff.some((s) => s.profile === 11 && !s.faction), 'the owner still names anyone');
ok(/not staff named for Fighters Guild/.test(run(OFFICER, 'staff remove Rena')) && biz().staff.some((s) => s.profile === 11), 'an officer cannot let go the owner\'s own staff');
ok(/no longer keeps/.test(run(OFFICER, 'staff remove Mirri')) && !biz().staff.some((s) => s.profile === 10), 'an officer lets go faction staff');
ok(audits.some((t) => /took on Mirri .* for fighters-guild/.test(t)) && audits.some((t) => /let Mirri .* go as staff .* for fighters-guild/.test(t)), 'staff changes are audited');
run(LEAD, 'staff add Mirri');
ok(/Written/.test(run(MEMBER, 'note Ten swords in stock')), 'faction staff keep the logbook');
ok(/Written/.test(run(LEAD, 'note The guild audits Fredas')), 'the leader keeps the ledger as staff do');
ok(/Only the owner/.test(run(LEAD, 'close')) && /Only the owner/.test(run(LEAD, 'collect')), '...but cannot close it or collect the owner\'s takings');

// ---- handing it back ------------------------------------------------------------------------------------------------
ok(/Only the owner or Fighters Guild's leader/.test(run(STRAY, 'faction off')) && biz().faction, 'a stranger cannot hand it back');
ok(/keeps its own books again/.test(run(LEAD, 'faction off')) && !biz().faction, 'the leader hands it back to the owner');
ok(!biz().staff.some((s) => s.profile === 10) && biz().staff.some((s) => s.profile === 11), '...the faction\'s staff go, the owner\'s stay');
ok(audits.some((t) => /unregistered The Iron Fist .* from faction fighters-guild/.test(t)), '...audited');
const before = factionGold('fighters-guild');
ok(globalThis.__dboBusinessPayFaction(CELL, 18, 'bed rent') === '' && factionGold('fighters-guild') === before, 'after that, rest.js pays the owner again (the hook declines)');
const sale2 = globalThis.__dboLedgerSale({ buyer: RENTER, place: SHELF, price: 100, what: 'a shield' });
ok(sale2.owner.kind === 'bank' && sale2.owner.paid === 80, '...and ledger sales the owner\'s bank', sale2.owner);

// The owner offers and then withdraws; the owner may also hand it back
run(OWNER, 'faction fighters-guild');
ok(/withdrawn/.test(run(OWNER, 'faction off')) && !biz().factionOffer, 'the owner withdraws an offer');
// ---- a leader who owns it registers at once; a dissolved faction pays the owner ----------------------------------------
MEMBERS[OWNER] = [[FG, 'leader']];
ok(/keeps its books for Fighters Guild now/.test(run(OWNER, 'faction fighters-guild')), 'a leader who owns it registers it at once');
FG_EXISTS = false;
const ownerHad = gold[OWNER];
ok(globalThis.__dboBusinessPayFaction(CELL, 9) === '', 'a faction that no longer exists takes nothing');
FG_EXISTS = true;
REFUSE = true;
ok(globalThis.__dboBusinessPayFaction(CELL, 9) === '', 'a treasury that refuses: the hook declines, so the owner is paid');
REFUSE = false;
ok(gold[OWNER] === ownerHad, '(the hook itself never pays the owner)');
ok(/keeps its own books again/.test(run(OWNER, 'faction off')), 'the owner hands it back');

// ---- the faction's hall ------------------------------------------------------------------------------------------------
cmds.business(HALLOWNER, 'open Jorrvaskr Mead');
const hall = () => all()[HALLDOOR.toString(16)];
ok(hall() && /keeps its books for Companions now/.test(run(COMP, 'faction companions')) && hall().faction.id === 'companions', 'in the faction\'s hall its leader registers it without an offer (the owner is not a member)');
ok(audits.some((t) => /for faction companions \(its hall\)/.test(t)), '...audited as the hall');

try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* temp */ }
console.log(fails ? `${fails} FAILED` : 'all checks passed'); process.exit(fails ? 1 : 0);
