// Scripted test for server\thievery.js with a mock gamemode api: nobody burgles while it is off or without an approved
// faction; a non-thief, a standing thief and anyone with access fall through to the housing locks; a break-in needs the
// owner online, warns the people near and the owner, stops on a blow, a step away or someone else at the door, and ends in
// the lockpick game at lockLevel; a won lock takes the thief through the door and back out; the steal panel never lists
// keys, artifacts, worn things or gold, and two kinds per 12 hours is the cap; the stolen ledger, the Fence Chest (shut to
// everyone else, fence, take back, gold after 14 days, collect), a guard raid (report, approve, freeze, warning, ruling,
// return to the owner), a lapsed freeze, a guard's seizure, hall permits and a failed write putting the chest back.
//   node tests/thievery-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MOD = path.resolve(__dirname, '..', 'thievery.js');
process.chdir(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'thievery-harness-')));
fs.writeFileSync('artifacts.json', JSON.stringify({ patterns: ['^DBO_Artifact'] }));

let now = Date.UTC(2026, 9, 20, 20, 0);
Date.now = () => now;
let fails = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined && !ok ? `   ${detail}` : ''}`); if (!ok) fails++; };

const factory = require(MOD);
const P = factory.pure;
// ---- pure helpers
check('a plain stack and an enchanted copy are different kinds', P.kindKey({ baseId: 0x10, count: 3 }) !== P.kindKey({ baseId: 0x10, count: 1, enchantment: { id: 5 } }) && P.kindKey({ baseId: 0x10, count: 3 }) === P.kindKey({ baseId: 0x10, count: 1, worn: true }));
check('two kinds per window', P.quotaLeft([now - 1000], now, P.DEFAULTS) === 1 && P.quotaLeft([now - 1000, now - 2000], now, P.DEFAULTS) === 0 && P.quotaLeft([now - 13 * 3600000, now - 1000], now, P.DEFAULTS) === 1);
const tk = P.takeKind([{ baseId: 1, count: 5 }, { baseId: 2, count: 1 }], P.kindKey({ baseId: 1 }), 0);
check('a whole stack is taken', tk.taken && tk.taken.count === 5 && tk.left.length === 1 && tk.left[0].baseId === 2);
check('a capped take leaves the rest', P.takeKind([{ baseId: 1, count: 5 }], P.kindKey({ baseId: 1 }), 2).left[0].count === 3);
check('a worn copy is never taken', P.takeKind([{ baseId: 1, count: 1, worn: true }], P.kindKey({ baseId: 1 }), 0).taken === null);
check('a plain entry stacks, an enchanted one keeps its own', P.addEntry([{ baseId: 1, count: 2 }], { baseId: 1, count: 3 })[0].count === 5 && P.addEntry([{ baseId: 1, count: 2 }], { baseId: 1, count: 1, name: 'x' }).length === 2);
const xb = new Uint8Array(32); const xv = new DataView(xb.buffer); xv.setUint32(0, 0x501, true); [10, 20, 30, 0, 0, Math.PI].forEach((f, i) => xv.setFloat32(4 + i * 4, f, true));
const px = P.parseXtel(xb);
check('XTEL: the far door, the spot and its rotation', px.door === 0x501 && px.pos[1] === 20 && Math.abs(px.rot[2] - Math.PI) < 1e-6);
check('the fence pays a share of the base value', P.lotGold(100, 3, P.DEFAULTS) === 90);

// ---- the world
const GOLD = 0xf, PICK = 0xa, SWORD = 0x1397e, BREAD = 0x65c9f, KEY = 0x2000, ART = 0x3000, BOOK = 0x1b0e1;
const items = { [GOLD]: ['MISC', 'Gold001'], [PICK]: ['MISC', 'Lockpick'], [SWORD]: ['WEAP', 'IronSword'], [BREAD]: ['ALCH', 'Bread'], [KEY]: ['KEYM', 'HouseKey'], [ART]: ['WEAP', 'DBO_ArtifactBlade'], [BOOK]: ['BOOK', 'Book'],
  0x9001: ['DOOR', 'DoorBase'], 0x9002: ['CONT', 'ChestBase'] };
// Lydia's home: door 0x500 outside (Tamriel) <-> 0x501 inside (cell "lydiahouse"), chest 0x510 inside; the hall chest 0x700
const DOOR = 0x500, INNER = 0x501, CHEST = 0x510, HALLCHEST = 0x700, HALLDOOR = 0x600, HALLINNER = 0x601;
const THIEF = 101, THIEF2 = 102, OWNER = 11, WITNESS = 50, GUARD = 60, LEAD = 70, GM = 71, PEASANT = 51;
const props = new Map();
const get = (id, p) => props.get(`${id}|${p}`);
const set = (id, p, v) => props.set(`${id}|${p}`, v);
const pos = (a, p, cell) => { set(a, 'pos', p); set(a, 'worldOrCellDesc', cell); };
pos(DOOR, [0, 0, 0], 'tamriel'); set(DOOR, 'baseDesc', 'door'); pos(INNER, [5, 5, 0], 'lydiahouse'); set(INNER, 'baseDesc', 'door');
pos(CHEST, [10, 10, 0], 'lydiahouse'); set(CHEST, 'baseDesc', 'chest'); pos(HALLCHEST, [0, 0, 0], 'cistern'); set(HALLCHEST, 'baseDesc', 'chest');
pos(HALLDOOR, [900, 900, 0], 'tamriel'); set(HALLDOOR, 'baseDesc', 'door'); pos(HALLINNER, [0, 0, 0], 'hallinside'); set(HALLINNER, 'baseDesc', 'door');
const fillChest = () => set(CHEST, 'inventory', { entries: [{ baseId: GOLD, count: 500 }, { baseId: SWORD, count: 1 }, { baseId: BREAD, count: 4 }, { baseId: KEY, count: 1 }, { baseId: ART, count: 1 }, { baseId: BOOK, count: 1 }] });
fillChest();
for (const a of [THIEF, THIEF2, OWNER, WITNESS, GUARD, LEAD, GM, PEASANT]) { pos(a, [100, 0, 0], 'tamriel'); set(a, 'inventory', { entries: [{ baseId: PICK, count: 3 }] }); }
pos(OWNER, [5000, 0, 0], 'tamriel');
set(HALLCHEST, 'inventory', { entries: [] });
set(GUARD, 'private.dboLawful', true);
const xtel = (far, p) => { const b = new Uint8Array(32); const v = new DataView(b.buffer); v.setUint32(0, far, true); p.forEach((f, i) => v.setFloat32(4 + i * 4, f, true)); return { type: 'XTEL', data: b }; };
const refs = { [DOOR]: [xtel(INNER, [6, 6, 0])], [INNER]: [xtel(DOOR, [1, 1, 0])], [HALLDOOR]: [xtel(HALLINNER, [1, 2, 3])], [HALLINNER]: [xtel(HALLDOOR, [901, 901, 0])] };
const recs = {
  [DOOR]: { owner: 11, ownerChar: OWNER, ownerName: 'Lydia', name: 'Lydia\'s house', locked: true, partner: INNER },
  [HALLDOOR]: { owner: 33, ownerChar: 0, ownerName: 'Brynjolf', name: 'the Flagon', locked: true, partner: HALLINNER },
};
const primary = { [DOOR]: DOOR, [INNER]: DOOR, [CHEST]: DOOR, [HALLDOOR]: HALLDOOR, [HALLINNER]: HALLDOOR };
const profiles = { [OWNER]: 11, [THIEF]: 21, [THIEF2]: 22 };
const sneak = new Set();
let failWriteFor = 0;
const mp = {
  get: (id, p) => get(id, p),
  set: (id, p, v) => { if (id === failWriteFor && p === 'inventory') throw new Error('write failed'); if (p === 'locationalData') pos(id, v.pos, v.cellOrWorldDesc); else set(id, p, v); },
  getDescFromId: (id) => `${id.toString(16)}:Skyrim.esm`,
  getIdFromDesc: (d) => (d === 'door' ? 0x9001 : d === 'chest' ? 0x9002 : parseInt(d, 16)),
  lookupEspmRecordById: (id) => (refs[id] ? { record: { type: 'REFR', fields: refs[id] }, toGlobalRecordId: (x) => x } : null),
  callPapyrusFunction: (kind, cls, name, self) => name === 'GetAnimationVariableBool' && sneak.has(parseInt(self.desc, 16)),
};
let lockLevel = -1, lockWin = null;
globalThis.__dboLockpick = { begin: (a, o) => { lockLevel = o.level; lockWin = o.onSuccess; return true; }, busy: () => false };
globalThis.__dboHousing = {
  primaryOf: (r) => primary[r] || 0, recordOf: (r) => recs[primary[r]] || null,
  ownsRecord: (rec, a) => rec && rec.ownerChar === a, keyOpens: () => false, isManager: (a) => a === LEAD, isFiefHolder: () => false,
  ownerActorsOf: (rec) => (rec.owner === 11 ? [OWNER] : []),
};
const members = { 'thieves-guild': [THIEF, THIEF2] };
globalThis.__dboGuildsOf = (a) => Object.entries(members).filter(([, l]) => l.includes(a)).map(([id]) => ({ id }));
globalThis.__dboGuildExists = (id) => id === 'thieves-guild' || id === 'companions';
globalThis.__dboGuildInfo = (id) => ({ name: id === 'thieves-guild' ? 'Thieves Guild' : id });
globalThis.__dboGuildHall = () => ({ name: 'the Cistern', cells: ['cistern'] });
globalThis.__dboHallOf = (r) => (r.includes(HALLDOOR) ? ['thieves-guild'] : []);
globalThis.__dboBaseValue = (id) => ({ [SWORD]: 25, [BREAD]: 2 }[id] || 0);
const pvpAt = globalThis.__dboPvpAt = new Map();
const idles = []; globalThis.__dboHoldIdle = (a, k) => { idles.push(['hold', a, k]); return { anim: k }; }; globalThis.__dboStopIdle = (a, h) => idles.push(['stop', a, h.anim]);

let online = [THIEF, THIEF2, WITNESS, GUARD, LEAD, GM, PEASANT];
const out = { personal: [], system: [], audits: [], widgets: [], forum: [], packets: [] };
const ui = new Map(); const timers = new Map(); const cmds = new Map();
const api = {
  mp, log: () => {}, personal: (a, t) => out.personal.push({ a, t }), system: (a, t) => out.system.push({ a, t }), audit: (t) => out.audits.push(t),
  who: (a) => `P${a}`, display: (a) => `P${a}`, displayFor: (v, a) => `P${a}`, cfg: {}, onUi: (e, f) => ui.set(e, f),
  openWidget: (a, w) => { out.widgets.push({ a, w }); return true; }, closeWidget: () => true, onlineActors: () => online.slice(), every: (n, ms, f) => timers.set(n, f),
  recordOf: (id) => (items[id] ? { record: { type: items[id][0], editorId: items[id][1] } } : null), adminItemName: () => '',
  registerChatCommand: (n, f) => cmds.set(n, f), isAdmin: (a) => a === LEAD || a === GM, isLeadStaff: (a) => a === LEAD,
  findByName: (q) => ({ thief: THIEF, thief2: THIEF2, owner: OWNER }[String(q).toLowerCase()] || null), profileOf: (a) => profiles[a] || a,
  sendPacket: (a, p) => { out.packets.push({ a, p }); return true; }, distanceMeters: () => 2, approvalForum: (op) => out.forum.push(op),
};
const load = (cfg) => { api.cfg = { thievery: cfg }; delete require.cache[MOD]; return require(MOD)(api); };
const act = (t, a) => globalThis.__dboBurglaryActivate(t, a);
const said = (a, rx) => out.personal.concat(out.system).some((x) => x.a === a && rx.test(x.t));
const clear = () => { for (const k of Object.keys(out)) out[k].length = 0; };
const count = (a, id) => ((get(a, 'inventory') || {}).entries || []).filter((e) => e.baseId === id).reduce((s, e) => s + e.count, 0);
const tick = () => timers.get('thievery')();
const slow = () => timers.get('thieveryTick')();
const lastMenu = (a) => { const w = out.widgets.filter((x) => x.a === a).pop(); return w ? w.w : null; };
const choose = (a, id) => ui.get('thiefChoose')(a, [id]);
const cmd = (a, name, args) => cmds.get(name)(a, args);

// ---- off, and no thief faction
load({ enabled: false, factions: ['thieves-guild'] });
sneak.add(THIEF);
check('off: a thief at a locked door falls through to the housing lock', act(DOOR, THIEF) === false);
load({ enabled: true });
check('on, but no faction approved: still falls through', act(DOOR, THIEF) === false);
cmd(GM, 'burglary', 'approve thieves-guild');
check('a GM below Lead cannot approve a thief faction', said(GM, /Lead GMs/));
cmd(LEAD, 'burglary', 'approve thieves-guild');
check('a Lead GM approves the Thieves Guild', said(LEAD, /now a thief faction/));
sneak.add(PEASANT);
check('a crouched non-thief at a locked door falls through', act(DOOR, PEASANT) === false && act(CHEST, PEASANT) === false);
sneak.delete(THIEF);
check('a thief standing up falls through', act(DOOR, THIEF) === false);
sneak.add(THIEF);
check('someone with access (a manager) falls through', act(DOOR, LEAD) === false);

// ---- break-in
clear();
check('owner offline: refused, and the activation ends', act(DOOR, THIEF) === true && said(THIEF, /only broken into while its owner is in the land/));
online.push(OWNER);
set(THIEF, 'inventory', { entries: [] });
clear(); act(DOOR, THIEF);
check('no lockpick: refused before any work', said(THIEF, /need a lockpick/) && !said(WITNESS, /forcing the lock/));
set(THIEF, 'inventory', { entries: [{ baseId: PICK, count: 3 }] });
clear();
check('owner online: the break-in begins', act(DOOR, THIEF) === true && said(THIEF, /set to work on the lock of Lydia's house/));
check('a witness near the door is told', said(WITNESS, /P101 is forcing the lock of Lydia's house/));
check('the thief works the lock visibly (the held skinning crouch)', idles.some((x) => x[0] === 'hold' && x[1] === THIEF && x[2] === 'skin'));
check('the owner is told, with a banner', said(OWNER, /breaking into Lydia's house/) && out.packets.some((x) => x.a === OWNER && x.p.customPacketType === 'dboBanner'));
check('anyone else at the door, another thief too, disturbs the work', act(DOOR, THIEF2) === false && said(THIEF2, /disturb someone/) && said(THIEF, /disturbs you/));
clear(); now += 20000; act(DOOR, THIEF);
act(INNER, OWNER);
check('the owner using the door disturbs the burglar', said(THIEF, /disturbs you at the lock/));
clear(); act(DOOR, THIEF); pvpAt.set(THIEF, now + 1); now += 2000; tick();
check('a blow stops the work, and the idle', said(THIEF, /A blow breaks your work/) && idles.some((x) => x[0] === 'stop' && x[1] === THIEF));
pvpAt.clear();
clear(); now += 20000; act(DOOR, THIEF); pos(THIEF, [400, 0, 0], 'tamriel'); now += 1000; tick();
check('a step away stops the work', said(THIEF, /stepped away/));
pos(THIEF, [100, 0, 0], 'tamriel');
clear(); act(DOOR, THIEF); now += 10000; tick();
check('the lock is not offered before forceSeconds', lockWin === null);
now += 21000; tick();
check('after forceSeconds, the lockpick game at Expert', lockLevel === 3 && typeof lockWin === 'function');
lockWin(THIEF);
check('a won lock takes the thief through the door, the lock untouched', get(THIEF, 'worldOrCellDesc') === 'lydiahouse' && get(THIEF, 'pos')[0] === 6 && recs[DOOR].locked === true);
check('the break-in is audited', out.audits.some((t) => /broke into Lydia's house/.test(t)));
pos(THIEF, [10, 10, 0], 'lydiahouse');

// ---- stealing
clear();
check('a chest of the breached home opens the steal panel', act(CHEST, THIEF) === true && lastMenu(THIEF).type === 'contextMenu');
const labels = lastMenu(THIEF).actions.map((x) => x.label).join('|');
check('the panel lists the sword, the bread and the book', /Iron Sword/.test(labels) && /Bread x4/.test(labels) && /Book/.test(labels), labels);
check('never the key, the artifact or the gold', !/House Key|Artifact|Gold/.test(labels), labels);
const idOf = (rx) => { const x = lastMenu(THIEF).actions.find((y) => rx.test(y.label)); return x ? x.id : ''; };
failWriteFor = THIEF; choose(THIEF, idOf(/Bread/)); failWriteFor = 0;
check('a failed write puts the chest back', count(CHEST, BREAD) === 4 && count(THIEF, BREAD) === 0);
act(CHEST, THIEF); choose(THIEF, idOf(/Bread/));
check('a whole stack is one take', count(THIEF, BREAD) === 4 && count(CHEST, BREAD) === 0);
check('the owner is told something has gone', said(OWNER, /Something has gone from a chest/));
choose(THIEF, idOf(/Iron Sword/));
check('a second kind', count(THIEF, SWORD) === 1 && count(CHEST, SWORD) === 0);
check('then the panel offers nothing more', lastMenu(THIEF).actions.length === 0 && /taken all you can carry/.test(lastMenu(THIEF).targetName));
const ledger = () => JSON.parse(fs.readFileSync('thievery.json', 'utf8'));
check('both takes are in the stolen ledger with their owner', ledger().stolen.filter((s) => s.state === 'carried' && s.owner === 11 && s.thief === THIEF).length === 2);
check('a non-thief at the chest falls through', act(CHEST, PEASANT) === false);
globalThis.__dboBusiness = { data: { businesses: { 500: { shop: { chest: '510' } } } } };
check('a shop chest is never rifled', act(CHEST, THIEF) === false);
delete globalThis.__dboBusiness;
check('the owner at the chest falls through', act(CHEST, OWNER) === false);
clear(); now += 11 * 60000;
sneak.delete(THIEF);
check('the breach lapses: the chest falls through for a standing thief', act(CHEST, THIEF) === false);
sneak.add(THIEF);
act(CHEST, THIEF);
check('and a new break-in waits for the home cooldown', said(THIEF, /broken into lately/));
clear();
check('the thief can always leave through the door', act(INNER, THIEF) === true && get(THIEF, 'worldOrCellDesc') === 'tamriel');
check('but not walk back in once the breach lapsed', act(DOOR, THIEF) === true && get(THIEF, 'worldOrCellDesc') === 'tamriel' && said(THIEF, /broken into lately/));

// ---- the Fence Chest
clear(); cmd(THIEF, 'fence', 'mark thieves-guild');
check('only a Lead GM marks a fence', said(THIEF, /Lead GMs/));
set(HALLCHEST, 'inventory', { entries: [{ baseId: BOOK, count: 1 }] });
cmd(LEAD, 'fence', 'mark thieves-guild'); act(HALLCHEST, LEAD);
check('a container holding things cannot become a fence', said(LEAD, /Empty that container/));
set(HALLCHEST, 'inventory', { entries: [] });
cmd(LEAD, 'fence', 'mark thieves-guild'); act(HALLCHEST, LEAD);
check('the empty hall chest becomes the Fence Chest', said(LEAD, /now the Fence Chest of Thieves Guild/));
clear();
check('to anyone else it is locked tight', act(HALLCHEST, PEASANT) === true && said(PEASANT, /locked tight/));
pos(THIEF, [10, 0, 0], 'cistern');
act(HALLCHEST, THIEF);
const fenceIds = () => lastMenu(THIEF).actions.map((x) => x.id);
check('a member sees what they can fence', lastMenu(THIEF).actions.filter((x) => /^Fence/.test(x.label)).length === 2);
const breadLot = lastMenu(THIEF).actions.find((x) => /Bread/.test(x.label)).id;
choose(THIEF, breadLot);
check('fencing takes it out of the pack into a lot', count(THIEF, BREAD) === 0 && ledger().lots.filter((l) => l.state === 'held').length === 1);
const back = fenceIds().find((x) => x[0] === 'b');
choose(THIEF, back);
check('it can be taken back before the days are out', count(THIEF, BREAD) === 4 && ledger().lots.filter((l) => l.state === 'held').length === 0);
choose(THIEF, lastMenu(THIEF).actions.find((x) => /Fence Bread/.test(x.label)).id);
choose(THIEF, lastMenu(THIEF).actions.find((x) => /Fence Iron Sword/.test(x.label)).id);
check('two lots held', ledger().lots.filter((l) => l.state === 'held').length === 2);
now += 13 * 86400000; slow();
check('nothing turns to gold before 14 days', !ledger().owed[THIEF.toString(16)]);

// ---- a guard raid
clear(); cmd(PEASANT, 'fence', 'report thieves-guild they keep it in the Cistern, I saw it myself');
check('only the guard asks for a raid', said(PEASANT, /Only the guard/));
cmd(GUARD, 'fence', 'report thieves-guild short');
check('evidence must say something', said(GUARD, /Say what your evidence is/));
cmd(GUARD, 'fence', 'report thieves-guild Lydia\'s bread and sword were seen carried into the Ratway by P101');
check('the request goes to the GMs and the approval forum', said(GUARD, /request \(#1\) is with the GMs/) && out.forum.some((o) => o.kind === 'open' && o.key === 'fence-raid:1') && said(GM, /Fence raid #1/));
cmd(GM, 'fence', 'approve 1');
check('approved: the fence freezes', ledger().fences['thieves-guild'].frozen === 1);
check('the thieves online are warned', said(THIEF, /leave to raid the fence/) && said(THIEF2, /leave to raid the fence/));
online = online.filter((a) => a !== THIEF2); members['thieves-guild'].push(PEASANT); slow();
check('a member who comes online later is warned too', said(PEASANT, /leave to raid the fence/));
members['thieves-guild'].pop();
clear(); act(HALLCHEST, THIEF);
check('the frozen fence offers nothing', lastMenu(THIEF).actions.length === 0 && /frozen/.test(lastMenu(THIEF).targetName));
now += 2 * 86400000; slow();
check('a frozen fence never sells, even past 14 days', !ledger().owed[THIEF.toString(16)] && ledger().lots.filter((l) => l.state === 'held').length === 2);
// approved at day 13, ruled now (day 15): past noticeHours
pos(OWNER, [5000, 0, 0], 'tamriel');
cmd(GM, 'fence', 'won 1');
check('won: the lots go back to their online owner', count(OWNER, BREAD) === 4 && count(OWNER, SWORD) === 1 && said(OWNER, /back in your pack/));
check('and the fence is free again', !ledger().fences['thieves-guild'].frozen && ledger().raids[0].state === 'won' && out.forum.some((o) => o.kind === 'close'));

// ---- gold after 14 days, and a lapsed freeze
fillChest(); now += 13 * 3600000; pos(THIEF, [100, 0, 0], 'tamriel');
clear(); act(DOOR, THIEF); now += 31000; tick(); lockWin(THIEF);
pos(THIEF, [10, 10, 0], 'lydiahouse'); act(CHEST, THIEF);
choose(THIEF, lastMenu(THIEF).actions.find((x) => /Iron Sword/.test(x.label)).id);
check('a new breach after the cooldown, a new take', count(THIEF, SWORD) === 1);
pos(THIEF, [10, 0, 0], 'cistern'); act(HALLCHEST, THIEF);
choose(THIEF, lastMenu(THIEF).actions.find((x) => /Fence Iron Sword/.test(x.label)).id);
cmd(GUARD, 'fence', 'report thieves-guild The sword from Lydia\'s house went down into the Cistern again');
cmd(GM, 'fence', 'approve 2');
cmd(GM, 'fence', 'won 2');
check('a GM cannot rule before the notice is out', said(GM, /thieves have until/) && ledger().raids[1].state === 'approved');
now += 73 * 3600000; slow();
check('an unruled freeze lifts after freezeMaxHours', ledger().raids[1].state === 'expired' && !ledger().fences['thieves-guild'].frozen);
now += 14 * 86400000; slow();
check('after 14 days the lot is sold for 30% of its value', ledger().owed[THIEF.toString(16)] === 7);
clear(); act(HALLCHEST, THIEF);
const goldBefore = count(THIEF, GOLD);
choose(THIEF, 'collect');
check('the thief collects the gold at the fence', count(THIEF, GOLD) === goldBefore + 7 && !ledger().owed[THIEF.toString(16)]);

// ---- a guard's seizure
fillChest(); now += 13 * 3600000; pos(THIEF, [100, 0, 0], 'tamriel');
act(DOOR, THIEF); now += 31000; tick(); lockWin(THIEF);
pos(THIEF, [10, 10, 0], 'lydiahouse'); act(CHEST, THIEF);
choose(THIEF, lastMenu(THIEF).actions.find((x) => /Book/.test(x.label)).id);
clear(); cmd(GUARD, 'stolen', 'thief');
check('a guard cannot search a free thief', said(GUARD, /bound, downed or jailed/));
set(THIEF, 'private.restrained', { boundHands: true });
cmd(GUARD, 'stolen', 'thief');
check('a bound thief is searched', said(GUARD, /carries stolen goods/) && said(GUARD, /Book, from Lydia's house/));
const ownerBooks = count(OWNER, BOOK);
cmd(GUARD, 'stolen', 'seize thief');
check('seized goods go back to the owner', count(THIEF, BOOK) === 0 && count(OWNER, BOOK) === ownerBooks + 1);
set(THIEF, 'private.restrained', null);

// ---- halls, permits and the owner's own account
clear(); pos(THIEF, [900, 890, 0], 'tamriel'); now += 13 * 3600000;
act(HALLDOOR, THIEF);
check('a faction hall needs a GM\'s approval', said(THIEF, /needs a GM's approval/));
recs[HALLDOOR].owner = 11;
cmd(GM, 'burglary', 'permit thief 2'); act(HALLDOOR, GM);
check('a GM permits it at the door', said(GM, /may break into the Flagon for 2 hours/) && said(THIEF, /approved your break-in/));
clear(); act(HALLDOOR, THIEF);
check('with the permit, the break-in begins', said(THIEF, /set to work on the lock of the Flagon/));
timers.get('thievery'); now += 31000; pos(THIEF, [0, 0, 0], 'elsewhere'); tick();
profiles[THIEF2] = 11; online.push(THIEF2); sneak.add(THIEF2); pos(THIEF2, [100, 0, 0], 'tamriel'); now += 13 * 3600000;
clear();
check('a home of the thief\'s own account falls through to the housing menu', act(DOOR, THIEF2) === false && !said(THIEF2, /set to work/));

// ---- hot reload keeps the state
load({ enabled: true });
check('a reload keeps the ledger, the fence and the approval', ledger().stolen.length >= 4 && !!ledger().fences['thieves-guild'] && ledger().approved.includes('thieves-guild') && act(HALLCHEST, PEASANT) === true);
cmd(LEAD, 'burglary', 'revoke thieves-guild');
clear(); pos(THIEF, [100, 0, 0], 'tamriel'); now += 13 * 3600000;
check('revoked: the thief falls through again', act(DOOR, THIEF) === false);

console.log(fails ? `${fails} failure(s)` : 'all checks passed');
process.exit(fails ? 1 : 0);
