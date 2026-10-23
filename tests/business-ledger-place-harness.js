// business.js: moving the business ledger like the F7 Place tool (placeMode, Nate 23 Oct), against a stub mp in a scratch
// directory (business.js reads housing.json and writes businesses.json in the working directory, so never run it from the
// live server folder). placement.js is loaded beside it to show its GM path leaves the ledger's ids alone.
// node tests/business-ledger-place-harness.js   (from server/; TMPDIR=/dev/shm/... on CT 115)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'business.js');
const PLACEMENT = path.resolve(__dirname, '..', 'placement.js');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-ledger-place-'));
process.chdir(scratch);

const CELL = 0x100, CELL2 = 0x101, OTHERCELL = 0x102, WORLD = 0x3c, DOOR = 0x200, OUTDOOR = 0x201, DOOR2 = 0x210, OUTDOOR2 = 0x211;
const OWNER = 0xff000001, STAFF = 0xff000002, STRANGER = 0xff000005, GMOWNER = 0xff000006;
const PROFILE = { [OWNER]: 7, [STAFF]: 8, [STRANGER]: 11, [GMOWNER]: 12 };
const NAME = { [OWNER]: 'Olaf', [STAFF]: 'Sigrid', [STRANGER]: 'Stray', [GMOWNER]: 'Gemma' };
fs.writeFileSync('housing.json', JSON.stringify([DOOR, DOOR2]));
fs.writeFileSync('admin-placeables.json', JSON.stringify({ categories: [] }));
const props = new Map();
const setp = (id, k, v) => props.set(`${id}|${k}`, v);
const getp = (id, k) => props.get(`${id}|${k}`);
const desc = (id) => `${id.toString(16)}:Skyrim.esm`;
setp(DOOR, 'private.housing', { owner: 7, ownerName: 'Olaf', partner: OUTDOOR });
setp(DOOR, 'worldOrCellDesc', desc(CELL)); setp(OUTDOOR, 'worldOrCellDesc', desc(WORLD));
// A second property next door, owned by the GM: its cell is another business
setp(DOOR2, 'private.housing', { owner: 12, ownerName: 'Gemma', partner: OUTDOOR2 });
setp(DOOR2, 'worldOrCellDesc', desc(OTHERCELL)); setp(OUTDOOR2, 'worldOrCellDesc', desc(WORLD));
for (const a of [OWNER, STAFF, STRANGER]) { setp(a, 'worldOrCellDesc', desc(CELL)); setp(a, 'pos', [1000, 2000, 50]); setp(a, 'angle', [0, 0, 90]); }
setp(GMOWNER, 'worldOrCellDesc', desc(OTHERCELL)); setp(GMOWNER, 'pos', [0, 0, 0]); setp(GMOWNER, 'angle', [0, 0, 0]);
// An inn's rooms share a group (rest.js): CELL2 is upstairs of CELL
globalThis.__dboInnGroupOf = (c) => (c === CELL2 ? CELL : c);
const TYPES = { [CELL]: 'CELL', [CELL2]: 'CELL', [OTHERCELL]: 'CELL', [WORLD]: 'WRLD' };
const said = [], cmds = {}, ui = {}, packets = [], panels = [], placed = [], deleted = [], logs = [];
const mp = {
  get: getp, set: setp,
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16),
  lookupEspmRecordById: (id) => (TYPES[id] ? { record: { type: TYPES[id] } } : null),
  getActorsByProfileId: (p) => Object.keys(PROFILE).filter((a) => PROFILE[a] === p).map(Number),
  getDescFromId: (id) => (id >>> 0).toString(16),
  callPapyrusFunction: (kind, cls, fn, self, args) => {
    const id = parseInt(self.desc, 16) >>> 0;
    if (fn === 'PlaceAtMe') { const n = 0xff0000a0 + placed.length; placed.push(n); setp(n, 'worldOrCellDesc', getp(id, 'worldOrCellDesc')); setp(n, 'baseDesc', args[0].desc); return { desc: n.toString(16) }; }
    if (fn === 'SetPosition') setp(id, 'pos', args.slice(0, 3));
    if (fn === 'SetAngle') setp(id, 'angle', args.slice(0, 3));
    if (fn === 'Delete') { deleted.push(id); props.delete(`${id}|private.dboBizLedger`); }
    return null;
  },
};
const ADMINS = new Set([GMOWNER]);
// Every handler is kept, as gamemode.js's onUi does
const onUi = (n, f) => { (ui[n] = ui[n] || []).push(f); };
const fire = (n, a, args) => (ui[n] || []).forEach((f) => f(a, args));
const api = {
  mp, log: (...x) => logs.push(x.join(' ')), audit: () => {}, who: (a) => NAME[a], display: (a) => NAME[a],
  personal: (a, t) => said.push([a, t]), cfg: { rest: { holdShare: 0.1 }, business: {} },
  openWidget: (a, w) => { if (w.type === 'businessLedger') panels.push([a, w]); },
  closeWidget: (a, id) => said.push([a, 'CLOSE ' + id]),
  onUi, registerChatCommand: (n, f) => { cmds[n] = f; },
  onlineActors: () => [OWNER, STAFF, STRANGER, GMOWNER], profileOf: (a) => PROFILE[a] ?? -1,
  findByName: (q) => Number(Object.keys(NAME).find((a) => NAME[a].toLowerCase() === String(q).toLowerCase())) || 0,
  takeGold: () => true, giveGold: () => true, depositToTreasury: (z, n) => n,
  zoneOfActor: () => 'bruma', zoneById: (id) => ({ id, name: 'Bruma' }), ranksOf: () => [],
  distanceMeters: () => 1, isAdmin: (a) => ADMINS.has(a),
  sendPacket: (a, p) => { packets.push([a, p]); return true; },
};
let fails = 0;
const ok = (c, what, detail) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!c) fails++; };
const last = (a) => { for (let i = said.length - 1; i >= 0; i--) if (said[i][0] === a) return said[i][1]; return ''; };
const panelOf = (a) => { for (let i = panels.length - 1; i >= 0; i--) if (panels[i][0] === a) return panels[i][1]; return null; };
const editsTo = (a) => packets.filter(([x, p]) => x === a && p.customPacketType === 'placeEdit').map(([, p]) => p);
const lastEdit = (a) => editsTo(a).pop() || null;
globalThis.__dboBusiness = undefined; globalThis.__dboBusinessPass = undefined; globalThis.__dboPlacement = undefined;
require(MODULE)(api);
const placementSaid = [];
require(PLACEMENT)({ mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => placementSaid.push([a, t]), audit: () => {}, who: (a) => NAME[a],
  onUi, sendPacket: api.sendPacket, isAdmin: api.isAdmin, tierOf: (a) => (ADMINS.has(a) ? 'senior' : null), registerChatCommand: () => {}, cfg: {}, every: () => {}, onlineActors: api.onlineActors });
const biz = () => globalThis.__dboBusiness.data.businesses[DOOR.toString(16)];

// ---- setting up: a business and its ledger -------------------------------------------------------------------------
cmds.business(OWNER, 'open The Silver Jug');
cmds.business(OWNER, 'staff add Sigrid');
for (const a of [OWNER, STAFF, STRANGER]) fire('uiCaps', a, ['businessLedger']);
const L = biz().ledger && parseInt(biz().ledger.ref, 16);
ok(!!L && getp(L, 'private.dboBizLedger'), 'the owner opens a business and its ledger is placed');
const L_HEX = L.toString(16);
const start = getp(L, 'pos').slice();

// ---- starting the mode: who may ------------------------------------------------------------------------------------
globalThis.__dboBusinessActivate(L, OWNER);
ok(panelOf(OWNER).placeMode === true, 'the owner\'s panel says the Place-tool move is available (the front shows its button)');
globalThis.__dboBusinessActivate(L, STAFF);
fire('bizLedger', STAFF, [panelOf(STAFF).nonce, 'placeMode']);
ok(!lastEdit(STAFF) && panelOf(STAFF).resultKind === 'refused', 'staff cannot start it (owner only, as the arrows)');
globalThis.__dboBusinessActivate(L, STRANGER);
fire('bizLedger', STRANGER, [panelOf(STRANGER).nonce, 'placeMode']);
ok(!lastEdit(STRANGER), 'a customer cannot start it');
fire('bizLedger', OWNER, ['not-the-nonce', 'placeMode']);
ok(!lastEdit(OWNER), 'a panel action with a stale panel nonce starts nothing');
fire('bizLedger', OWNER, [panelOf(OWNER).nonce, 'placeMode']);
let ed = lastEdit(OWNER);
ok(ed && /^bizledger:[0-9a-f]{16}$/.test(ed.id) && ed.base === '106a68:Skyrim.esm' && ed.kind === 'object' && ed.pos.join() === start.join() && ed.rot.length === 3,
  'the owner starts it: a placeEdit for the ledger, from where it stands, with a one-time id', ed);
ok(said.some(([a, t]) => a === OWNER && t === 'CLOSE 64') && /Enter sets it down/.test(last(OWNER)), 'the panel closes so the game has the keys, and the keys are told');

// ---- confirms that are refused -------------------------------------------------------------------------------------
const goodPos = [1100, 2050, 140], goodRot = [0, 0, 200];
fire('placeMove', STAFF, [ed.id, goodPos, goodRot]);
ok(getp(L, 'pos').join() === start.join() && /out of date/.test(last(STAFF)), 'a confirm from a non-owner carrying the owner\'s id is refused');
fire('placeMove', OWNER, ['bizledger:0123456789abcdef', goodPos, goodRot]);
ok(getp(L, 'pos').join() === start.join() && /out of date/.test(last(OWNER)), 'a forged id is refused');
fire('placeMove', OWNER, [ed.id, [NaN, 1, 2], goodRot]);
ok(getp(L, 'pos').join() === start.join() && /bad position/.test(last(OWNER)), 'bad numbers are refused');
fire('placeMove', OWNER, [ed.id, goodPos, goodRot]);
ok(getp(L, 'pos').join() === start.join(), '...and spend the id');

// Out of reach, too high, too tilted: refused, and the owner keeps moving it (a fresh id from where it stands)
// The panel closed when the mode started, so its nonce is gone: open the book again, as a player would
const editsBefore = editsTo(OWNER).length;
globalThis.__dboBusinessActivate(L, OWNER);
fire('bizLedger', OWNER, [panelOf(OWNER).nonce, 'placeMode']); ed = lastEdit(OWNER);
fire('placeMove', OWNER, [ed.id, [1900, 2000, 60], goodRot]);
ok(getp(L, 'pos').join() === start.join() && /too far/.test(last(OWNER)), 'a spot out of reach is refused');
const retried = lastEdit(OWNER);
ok(editsTo(OWNER).length === editsBefore + 2 && retried.id !== ed.id, '...and the edit mode is started again with a new id');
fire('placeMove', OWNER, [ed.id, goodPos, goodRot]);
ok(getp(L, 'pos').join() === start.join(), '...the old id is spent');
fire('placeMove', OWNER, [retried.id, [1050, 2000, 400], goodRot]);
ok(getp(L, 'pos').join() === start.join() && /too high or too low/.test(last(OWNER)), 'a spot far above the owner is refused');
fire('placeMove', OWNER, [lastEdit(OWNER).id, goodPos, [80, 0, 200]]);
ok(getp(L, 'pos').join() === start.join() && /Tilt it no more/.test(last(OWNER)), 'a steep tilt is refused');

// ---- the confirm that goes through -----------------------------------------------------------------------------------
ed = lastEdit(OWNER);
fire('placeMove', OWNER, [ed.id, goodPos, [5, 355, 200]]);
ok(getp(L, 'pos').join() === goodPos.join() && getp(L, 'angle').join() === '5,355,200' && biz().ledger.pos.join() === goodPos.join(), 'the owner sets it down where the copy stood', [getp(L, 'pos'), getp(L, 'angle')]);
ok(/set down/.test(last(OWNER)), '...and is told how to move it again or finish');
fire('placeMove', OWNER, [ed.id, [1120, 2050, 140], goodRot]);
ok(getp(L, 'pos').join() === goodPos.join() && /out of date/.test(last(OWNER)), 'the same packet again (a replay) moves nothing');

// ---- the select tool: Enter on the ledger starts another move -------------------------------------------------------
const n0 = editsTo(OWNER).length;
fire('placeSelect', OWNER, [L_HEX]);
ok(editsTo(OWNER).length === n0 + 1 && lastEdit(OWNER).pos.join() === goodPos.join(), 'the owner\'s select tool on the ledger starts another move from where it now stands');
fire('placeSelect', STRANGER, [L_HEX]);
ok(!lastEdit(STRANGER) && /Only the owner/.test(last(STRANGER)), 'someone else\'s select tool on it is refused');
fire('placeSelect', STRANGER, ['ff000777']);
ok(!/ledger/.test(last(STRANGER)) || /Only the owner/.test(last(STRANGER)), 'a select on anything else is left to placement.js');

// ---- the property and the room ---------------------------------------------------------------------------------------
ed = lastEdit(OWNER);
setp(OWNER, 'worldOrCellDesc', desc(WORLD));
fire('placeMove', OWNER, [ed.id, goodPos, goodRot]);
ok(getp(L, 'pos').join() === goodPos.join() && /inside the business/.test(last(OWNER)), 'a confirm from outside the business is refused');
setp(OWNER, 'worldOrCellDesc', desc(CELL2));
fire('placeSelect', OWNER, [L_HEX]);
ok(/same room/.test(last(OWNER)), 'upstairs in the same inn (same business, another cell): it cannot be started');
setp(OWNER, 'worldOrCellDesc', desc(CELL));
fire('placeSelect', OWNER, [L_HEX]); ed = lastEdit(OWNER);
setp(OWNER, 'worldOrCellDesc', desc(CELL2));
fire('placeMove', OWNER, [ed.id, goodPos, goodRot]);
ok(/same room/.test(last(OWNER)), '...nor confirmed from there');
setp(OWNER, 'worldOrCellDesc', desc(OTHERCELL));
fire('placeSelect', OWNER, [L_HEX]);
ok(/inside the business/.test(last(OWNER)), 'from inside another property it cannot be started');
setp(OWNER, 'worldOrCellDesc', desc(CELL));

// ---- time, the claim, a new book --------------------------------------------------------------------------------------
fire('placeSelect', OWNER, [L_HEX]); ed = lastEdit(OWNER);
globalThis.__dboBusiness.placing.get(OWNER).until = Date.now() - 1;
fire('placeMove', OWNER, [ed.id, [1110, 2050, 140], goodRot]);
ok(getp(L, 'pos').join() === goodPos.join() && /too long/.test(last(OWNER)), 'an expired start is refused');
fire('placeSelect', OWNER, [L_HEX]); ed = lastEdit(OWNER);
setp(DOOR, 'private.housing', { owner: 11, ownerName: 'Stray', partner: OUTDOOR });
fire('placeMove', OWNER, [ed.id, [1110, 2050, 140], goodRot]);
ok(getp(L, 'pos').join() === goodPos.join() && /closed/.test(last(OWNER)), 'once the claim has changed hands the confirm is refused');
setp(DOOR, 'private.housing', { owner: 7, ownerName: 'Olaf', partner: OUTDOOR });
fire('placeSelect', OWNER, [L_HEX]); ed = lastEdit(OWNER);
cmds.business(OWNER, 'ledger');
const L2 = parseInt(biz().ledger.ref, 16);
fire('placeMove', OWNER, [ed.id, [1110, 2050, 140], goodRot]);
ok(L2 !== L && getp(L2, 'pos')[0] !== 1110 && /changed since/.test(last(OWNER)), 'a start for a ledger since replaced is refused');

// ---- the chat command, and the old buttons --------------------------------------------------------------------------
const n1 = editsTo(OWNER).length;
cmds.business(OWNER, 'ledger move');
ok(editsTo(OWNER).length === n1 + 1 && lastEdit(OWNER).pos.join() === getp(L2, 'pos').join(), '/business ledger move starts it (no panel button needed)');
cmds.business(STAFF, 'ledger move');
ok(!lastEdit(STAFF) && /Only the owner/.test(last(STAFF)), '...for the owner only');
globalThis.__dboBusinessActivate(L2, OWNER);
const p0 = getp(L2, 'pos').slice(), a0 = getp(L2, 'angle')[2];
fire('bizLedger', OWNER, [panelOf(OWNER).nonce, 'nudge', 'up', 10]);
fire('bizLedger', OWNER, [panelOf(OWNER).nonce, 'nudge', 'turnRight']);
ok(getp(L2, 'pos')[2] === p0[2] + 10 && getp(L2, 'angle')[2] === (a0 + 15) % 360, 'the arrows still raise and turn it', [p0, getp(L2, 'pos'), a0, getp(L2, 'angle')]);
fire('bizLedger', OWNER, [panelOf(OWNER).nonce, 'place']);
ok(parseInt(biz().ledger.ref, 16) !== L2 && deleted.includes(L2), '"Move it in front of me" still places it afresh');
// The arrows then the Place tool: the copy starts where the arrows left it
const L3 = parseInt(biz().ledger.ref, 16);
fire('bizLedger', OWNER, [panelOf(OWNER).nonce, 'nudge', 'down', 5]);
fire('bizLedger', OWNER, [panelOf(OWNER).nonce, 'placeMode']);
ok(lastEdit(OWNER).pos.join() === getp(L3, 'pos').join(), 'after the arrows, the Place-tool copy starts where they left it');

// ---- placement.js leaves the ledger's ids alone ----------------------------------------------------------------------
// The GM owns the business next door: their confirm reaches both handlers; only business.js answers
setp(DOOR, 'private.housing', { owner: 12, ownerName: 'Gemma', partner: OUTDOOR });
globalThis.__dboBusiness.data.businesses[DOOR.toString(16)].owner = 12;
globalThis.__dboBusiness.data.businesses[DOOR.toString(16)].ownerChar = 0;
setp(GMOWNER, 'worldOrCellDesc', desc(CELL)); setp(GMOWNER, 'pos', [1000, 2000, 50]);
placementSaid.length = 0;
cmds.business(GMOWNER, 'ledger move'); ed = lastEdit(GMOWNER);
fire('placeMove', GMOWNER, [ed.id, goodPos, goodRot]);
ok(getp(L3, 'pos').join() === goodPos.join() && placementSaid.length === 0, 'a GM owner\'s ledger move goes through business.js, placement.js says nothing', placementSaid);
const n2 = editsTo(GMOWNER).length;
fire('placeSelect', GMOWNER, [L3.toString(16)]);
ok(editsTo(GMOWNER).length === n2 + 1 && placementSaid.length === 0, '...and its select tool on the ledger is answered by business.js alone', placementSaid);
ok(!logs.some((l) => /placement: placeMove bizledger/.test(l)), 'placement.js does not log the ledger\'s confirms as refusals');

// ---- placeMode off --------------------------------------------------------------------------------------------------
delete require.cache[require.resolve(MODULE)];
for (const k of Object.keys(ui)) delete ui[k];
require(MODULE)(Object.assign({}, api, { cfg: { rest: { holdShare: 0.1 }, business: { placeMode: false } } }));
fire('uiCaps', GMOWNER, ['businessLedger']);
const n3 = editsTo(GMOWNER).length;
cmds.business(GMOWNER, 'ledger move');
ok(editsTo(GMOWNER).length === n3 && /use the arrows/.test(last(GMOWNER)), 'with placeMode off it is refused and the arrows are named');
globalThis.__dboBusinessActivate(L3, GMOWNER);
ok(panelOf(GMOWNER).placeMode === false, '...and the panel hides the button');

console.log(fails ? `${fails} FAILED` : 'all checks passed');
fs.rmSync(scratch, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
