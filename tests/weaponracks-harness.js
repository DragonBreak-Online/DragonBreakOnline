// Scripted test for server\weaponracks.js against a stub mp: Bruma's Northern Arms (BSHeartland cell 1093) as the plugin
// has it, plus one empty fixture rack in the same cell, and a fixture pose table (the real one comes from Nat's PC).
//   node tests/weaponracks-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'weaponracks.js');
const GAMEMODE = path.resolve(__dirname, '..', 'gamemode.js');
const scratchRoot = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'claude-nate-weaponracks-'));
process.chdir(scratch);

let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined && !ok ? '   ' + JSON.stringify(detail) : ''}`); if (!ok) failures++; };

// ---- the world ------------------------------------------------------------------------------------------------------------
const BSH = 0x08000000;
const bsh = (x) => (BSH | x) >>> 0;
const descOf = (id) => (id >= 0xff000000 ? id.toString(16) : (id >>> 24) === 0x08 ? `${(id & 0xffffff).toString(16)}:BSHeartland.esm` : `${id.toString(16)}:Skyrim.esm`);
const idOf = (d) => { d = String(d); if (/^ff[0-9a-f]{6}$/i.test(d)) return parseInt(d, 16) >>> 0; const [h, p] = d.split(':'); return /bsheartland/i.test(p || '') ? bsh(parseInt(h, 16)) : (parseInt(h, 16) >>> 0); };
const kwda = (...ids) => ({ type: 'KWDA', data: new Uint8Array(new Uint32Array(ids).buffer) });
const xlkr = (kw, ref) => ({ type: 'XLKR', data: new Uint8Array(new Uint32Array([kw, ref]).buffer) });
const records = new Map();
const rec = (id, type, editorId, fields = []) => records.set(id >>> 0, { record: { type, editorId, fields }, toGlobalRecordId: (x) => x >>> 0 });
const NA_CELL = bsh(0x1093), TAMRIEL_WORLD = bsh(0xa764b);
rec(NA_CELL, 'CELL', 'CYRBrumaNorthernArms'); rec(TAMRIEL_WORLD, 'WRLD', 'Tamriel');
// Skyrim.esm bases
rec(0x8af59, 'ACTI', 'WeaponRackMidACTIVATOR'); rec(0x8af5b, 'ACTI', 'WeaponRackMid');
rec(0x7400c, 'ACTI', 'WeaponRackCOAMidACTIVATOR'); rec(0x7400d, 'ACTI', 'WeaponRackCOAMid');
rec(0xd5081, 'ACTI', 'WeaponRackDaggerDisplayACTIVATORPlayerHouse'); rec(0xd505b, 'ACTI', 'WeaponRackDaggerDisplayPlayerHouse');
const MACE = 0x13982;
const SWORD = 0x12eb7, DAGGER = 0x1397e, BOW = 0x3b562, SHIELD = 0x12eb6, TORCH = 0x1d4ec, KEY = 0xdb0e2, ODD = 0x99999;
rec(SWORD, 'WEAP', 'IronSword', [kwda(0x1e711, 0x1e718)]); rec(DAGGER, 'WEAP', 'IronDagger', [kwda(0x1e713)]);
rec(BOW, 'WEAP', 'LongBow', [kwda(0x1e715)]); rec(SHIELD, 'ARMO', 'IronShield', [kwda(0x965b2)]); rec(TORCH, 'LIGH', 'Torch01');
rec(ODD, 'WEAP', 'OddThing', [kwda(0x12345)]); rec(MACE, 'WEAP', 'IronMace', [kwda(0x1e714)]); rec(KEY, 'KEYM', 'HouseKey');
// Northern Arms, as BSHeartland.esm places it (dumped 10 Oct): three WeaponRackMid with a mace, a sword and a war axe, and a
// COA set (shield, two swords) at one spot
const refs = new Map();
const ref = (id, base, cell, pos, angle, fields = []) => { refs.set(id >>> 0, { baseDesc: descOf(base), worldOrCellDesc: descOf(cell), pos, angle, isDisabled: false }); rec(id, 'REFR', '', fields); };
const NA_RACKS = [[0x109c, 0x1096, 0x109a], [0x109d, 0x1099, 0x109b], [0x1097, 0x1098, 0x1095]];
for (const [act, mesh, start] of NA_RACKS) {
  ref(bsh(act), 0x8af59, NA_CELL, [-326.3, -64.3, -336.5], [0, 0, 89.9], [xlkr(0x6d95e, bsh(mesh)), xlkr(0, bsh(start))]);
  ref(bsh(mesh), 0x8af5b, NA_CELL, [-326.3, -64.3, -336.5], [0, 0, 89.9], [xlkr(0x6d95f, bsh(act))]);
  ref(bsh(start), SWORD, NA_CELL, [-297.1, -64.3, -265.3], [91.2, 90, 181]);
}
ref(bsh(0x7bb5f), 0x7400c, NA_CELL, [-289.7, -239.1, -178.3], [0, 360, 89.9], [xlkr(0x6d95e, bsh(0x7bb60)), xlkr(0, bsh(0x7bb5a))]);
ref(bsh(0x7bb60), 0x7400d, NA_CELL, [-289.7, -239.1, -178.3], [0, 360, 89.9], [xlkr(0x6d95f, bsh(0x7bb5f))]);
ref(bsh(0x7bb5a), SHIELD, NA_CELL, [-272.9, -233.9, -325.9], [185, 7.6, 167.6]);
// Fixture racks with no starting weapon, in the same cell: a weapon rack, a shield rack and a dagger display
const EMPTY = bsh(0xf001), EMPTY_MESH = bsh(0xf002), SHIELD_RACK = bsh(0xf003), SHIELD_MESH = bsh(0xf004), DAGGER_RACK = bsh(0xf005), DAGGER_MESH = bsh(0xf006);
ref(EMPTY, 0x8af59, NA_CELL, [100, 200, 300], [0, 0, 90], [xlkr(0x6d95e, EMPTY_MESH)]);
ref(EMPTY_MESH, 0x8af5b, NA_CELL, [100, 200, 300], [0, 0, 90], [xlkr(0x6d95f, EMPTY)]);
ref(SHIELD_RACK, 0x7400c, NA_CELL, [0, 0, 0], [0, 0, 0], [xlkr(0x6d95e, SHIELD_MESH)]);
ref(SHIELD_MESH, 0x7400d, NA_CELL, [0, 0, 0], [0, 0, 0], [xlkr(0x6d95f, SHIELD_RACK)]);
ref(DAGGER_RACK, 0xd5081, NA_CELL, [0, 0, 0], [0, 0, 0], [xlkr(0x6d95e, DAGGER_MESH)]);
ref(DAGGER_MESH, 0xd505b, NA_CELL, [0, 0, 0], [0, 0, 0], [xlkr(0x6d95f, DAGGER_RACK)]);
// The shop's door pair: efc outside in Tamriel, 10a0 inside
const DOOR = bsh(0xefc), INNER = bsh(0x10a0);
ref(DOOR, 0x31897, TAMRIEL_WORLD, [0, 0, 0], [0, 0, 0]); ref(INNER, 0x31897, NA_CELL, [0, 0, 0], [0, 0, 0]);
fs.writeFileSync('housing.json', JSON.stringify([DOOR]));
const home = { owner: 1, ownerName: 'Brunhild', name: 'Northern Arms', locked: false, serial: 1, partner: INNER, containers: [bsh(0x2000)], issued: ['Key to the Northern Arms'] };
let housingReadable = true;
globalThis.__dboHousing = { holdOf: (r) => ((r >>> 0) === DOOR || (r >>> 0) === INNER ? 'bruma' : ''), primaryOf: (r) => ((r >>> 0) === DOOR || (r >>> 0) === INNER ? DOOR : 0), recordOf: (r) => { if (!housingReadable) throw new Error('not loaded'); return (r >>> 0) === DOOR || (r >>> 0) === INNER ? Object.assign({}, home) : null; } };

// Players: 1 the owner, 2 a key holder, 3 a stranger (a raider), an NPC
const OWNER = 0xff000014, KEYHOLDER = 0xff000015, STRANGER = 0xff000016, NPC = 0xff000099;
const ENCHANTED = { baseId: SWORD, count: 1, worn: true, health: 1.4, enchantmentId: 0x4b27f, maxCharge: 1000, chargePercent: 80, name: 'Brunhild\'s Bite' };
const player = (id, profile, inv) => { refs.set(id, { baseDesc: '7:Skyrim.esm', worldOrCellDesc: descOf(NA_CELL), pos: [0, 0, 0], angle: [0, 0, 0], profileId: profile, inventory: { entries: inv }, user: profile }); };
player(OWNER, 1, [Object.assign({}, ENCHANTED), { baseId: DAGGER, count: 2 }, { baseId: 0xf, count: 50 }]);
player(KEYHOLDER, 2, [{ baseId: BOW, count: 1, worn: true }, { baseId: KEY, count: 1, name: 'Key to the Northern Arms' }]);
player(STRANGER, 3, [{ baseId: SWORD, count: 1, worn: true }]);
refs.set(NPC, { baseDesc: '1:Skyrim.esm', worldOrCellDesc: descOf(NA_CELL), pos: [0, 0, 0], angle: [0, 0, 0], inventory: { entries: [] } });
const equipFrom = (a) => ({ inv: { entries: refs.get(a).inventory.entries.filter((e) => e.worn || e.wornLeft).map((e) => ({ baseId: e.baseId, count: 1, worn: !!e.worn, wornLeft: !!e.wornLeft })) } });

let nextDyn = 0xff100000;
const papyrusCalls = [];
let onInventorySet = null;
let inventoryFails = false;
const mp = {
  getIdFromDesc: idOf,
  getDescFromId: (id) => descOf(id >>> 0),
  getUserByActor: (a) => { const r = refs.get(a >>> 0); return r && r.user !== undefined ? r.user : 65535; },
  lookupEspmRecordById: (id) => records.get(id >>> 0) || null,
  get: (id, prop) => {
    const r = refs.get(id >>> 0); if (!r) throw new Error(`no form ${(id >>> 0).toString(16)}`);
    if (prop === 'equipment') return equipFrom(id >>> 0);
    if (prop === 'inventory') return { entries: r.inventory.entries.map((e) => Object.assign({}, e)) };
    return r[prop];
  },
  set: (id, prop, v) => {
    const r = refs.get(id >>> 0); if (!r) throw new Error(`no form ${(id >>> 0).toString(16)}`);
    if (prop === 'inventory') { if (inventoryFails) throw new Error('inventory refused'); if (onInventorySet) onInventorySet(id >>> 0, v); r.inventory = { entries: v.entries.map((e) => Object.assign({}, e)) }; return; }
    r[prop] = v;
  },
  callPapyrusFunction: (kind, cls, fn, self, args) => {
    const id = idOf(self.desc);
    papyrusCalls.push({ cls, fn, id, args });
    if (fn === 'PlaceAtMe') { const at = refs.get(id); const nid = nextDyn++; refs.set(nid, { baseDesc: args[0].desc, worldOrCellDesc: at.worldOrCellDesc, pos: at.pos.slice(), angle: [0, 0, 0], isDisabled: false }); return { desc: descOf(nid) }; }
    if (fn === 'SetPosition') { refs.get(id).pos = args.slice(0, 3); return null; }
    if (fn === 'SetAngle') { refs.get(id).angle = args.slice(0, 3); return null; }
    if (fn === 'Delete') { refs.delete(id); return null; }
    return null;
  },
};
const said = [], logs = [], audits = [];
let clock = 1_800_000_000_000;
let online = [OWNER, KEYHOLDER, STRANGER];
const POSES = { _comment: 'fixture', WeaponRackMid: { SwordPivot01: { pos: [10, 0, 20], rot: [0, 90, 0] }, BowPivot01: { pos: [0, 5, 30], rot: [0, 0, 0] } }, WeaponRackCOAMid: { ShieldPivot01: { pos: [0, 0, 0], rot: [0, 0, 0] } } };
const STATE = path.join(scratch, 'weapon-racks-state.json');
const load = (fresh) => {
  if (fresh) delete globalThis.__dboWeaponRacks;
  delete require.cache[MODULE];
  require(MODULE)({ mp, log: (...a) => logs.push(a.join(' ')), personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), who: (a) => `actor ${(a >>> 0).toString(16)}`, cfg: { weaponRacks: { bootGraceMs: 0 } }, onlineActors: () => online.slice(), now: () => clock });
  globalThis.__dboWeaponRacks.bootAt = clock - 1e9;
};
const use = (target, caster) => globalThis.__dboWeaponRack(target >>> 0, caster >>> 0);
const lastSaid = (a) => { const l = said.filter((s) => s[0] === a); return l.length ? l[l.length - 1][1] : ''; };
const inv = (a) => refs.get(a).inventory.entries;
const has = (a, base) => inv(a).filter((e) => e.baseId === base).reduce((n, e) => n + e.count, 0);
const st = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const tick = () => { clock += 2000; }; // past the repeat-notice window

// ---- the activate chain in gamemode.js ------------------------------------------------------------------------------------
{
  const src = fs.readFileSync(GAMEMODE, 'utf8');
  const body = src.slice(src.indexOf('mp.onActivate = (targetId, casterId) => {\n  const caster = Number(casterId) >>> 0;'));
  const at = (s) => body.indexOf(s);
  check('gamemode.js: the rack hook is in the main activate chain', at('globalThis.__dboWeaponRack(target, caster)) return false;') > 0);
  check('gamemode.js: it runs before the raid hook and before blockPlacedPickup', at('__dboWeaponRack(') < at('__dboRaidActivate(') && at('__dboWeaponRack(') < at('blockPlacedPickup(targetId'));
  check('gamemode.js: it runs after bound hands and the reach check', at('__dboWeaponRack(') > at('boundHands') && at('__dboWeaponRack(') > at('distanceMeters(caster, target) > 6.5'));
  check('gamemode.js loads weaponracks.js with a fresh require', /delete require\.cache\[WEAPONRACKS_JS\];\s*require\(WEAPONRACKS_JS\)/.test(src));
  const mod = fs.readFileSync(MODULE, 'utf8');
  check('weaponracks.js registers no mp.on listener (hot reload safe)', !/mp\.on\(/.test(mod) && !/mp\.onActivate\s*=/.test(mod));
}

// ---- no pose table yet -------------------------------------------------------------------------------------------------------
load(true);
check('the module loads and says the pose table is missing', logs.some((l) => /weaponracks on: 0 racked, .*pose table missing/.test(l)), logs);
check('activating a rack is ours: the chain ends, so the vanilla tutorial box never comes', use(EMPTY, OWNER) === true);
check('without weapon-racks.json the rack refuses to take a weapon', lastSaid(OWNER) === 'This rack is not ready yet.' && has(OWNER, SWORD) === 1 && !fs.existsSync(STATE), lastSaid(OWNER));
check('an unrelated reference is not ours', use(DOOR, OWNER) === false && use(bsh(0x7bb5a), OWNER) === false);

// ---- Northern Arms as the plugin has it: every slot holds decoration --------------------------------------------------------
tick();
for (const [act, mesh] of NA_RACKS) {
  check(`Northern Arms rack ${act.toString(16)}: its starting weapon makes it full, decoration only`, use(bsh(act), OWNER) === true && lastSaid(OWNER) === "This rack's weapon is only for show." && has(OWNER, SWORD) === 1);
  tick();
  check(`and its mesh ${mesh.toString(16)} answers as the same rack`, use(bsh(mesh), OWNER) === true && lastSaid(OWNER) === "This rack's weapon is only for show.");
  tick();
}
check('the COA shield rack 7bb5f is decoration too (its hide shield)', use(bsh(0x7bb5f), OWNER) === true && lastSaid(OWNER) === "This rack's weapon is only for show.");

// ---- with the table ------------------------------------------------------------------------------------------------------------
fs.writeFileSync('weapon-racks.json', JSON.stringify(POSES));
tick();
check('a stranger may not use the household\'s rack', use(EMPTY, STRANGER) === true && lastSaid(STRANGER) === 'Only the household can use this rack.' && has(STRANGER, SWORD) === 1);
check('an NPC activating a rack is refused and changes nothing', use(EMPTY, NPC) === true && !fs.existsSync(STATE));
tick();
let stateAtInventoryWrite = null;
onInventorySet = (a) => { if (a === OWNER) stateAtInventoryWrite = fs.existsSync(STATE) ? st() : null; };
papyrusCalls.length = 0;
check('the owner racks the sword in their hand', use(EMPTY, OWNER) === true && lastSaid(OWNER) === "You set your Brunhild's Bite on the rack.", lastSaid(OWNER));
onInventorySet = null;
check('the sword left their inventory', has(OWNER, SWORD) === 0 && has(OWNER, DAGGER) === 2 && has(OWNER, 0xf) === 50, inv(OWNER));
check('the rack was written to the state file BEFORE the inventory changed', !!(stateAtInventoryWrite && stateAtInventoryWrite.racks[EMPTY.toString(16)]), stateAtInventoryWrite);
const slot = st().racks[EMPTY.toString(16)];
check('the stored entry keeps every extra (enchantment, charge, temper, name), count 1, not worn', slot && slot.entry.enchantmentId === 0x4b27f && slot.entry.health === 1.4 && slot.entry.chargePercent === 80 && slot.entry.name === "Brunhild's Bite" && slot.entry.count === 1 && slot.entry.worn === undefined, slot);
check('the slot records its home, owner and who racked it', slot && slot.home === DOOR.toString(16) && slot.owner === 1 && slot.by === 1 && slot.node === 'SwordPivot01');
check('the sword was unequipped through Actor.UnequipItem', papyrusCalls.some((c) => c.cls === 'Actor' && c.fn === 'UnequipItem' && c.id === OWNER));
const disp = parseInt(slot.display, 16) >>> 0;
const d = refs.get(disp);
check('a display copy hangs on the rack, tagged to it', !!d && d.baseDesc === descOf(SWORD) && d['private.dboRackDisplay'] && d['private.dboRackDisplay'].rack === EMPTY.toString(16));
// heading 90: local (10, 0, 20) -> (+10 cos 90 + 0, -10 sin 90 + 0, +20) = (0, -10, +20) from the mesh at (100, 200, 300)
check('at the slot\'s pivot, turned with the rack (heading 90)', d && Math.abs(d.pos[0] - 100) < 1e-6 && Math.abs(d.pos[1] - 190) < 1e-6 && d.pos[2] === 320 && d.angle[0] === 0 && d.angle[1] === 90 && d.angle[2] === 90, d && [d.pos, d.angle]);
check('and re-sent with a disable/enable, like a placement', d && d.isDisabled === false);
check('it is audited', /^WEAPONRACK actor ff000014 racked Brunhild's Bite \(12eb7\) on 800f001 in home 8000efc \(owner 1\)$/.test(audits[audits.length - 1]), audits[audits.length - 1]);

// ---- refusals on a full slot ---------------------------------------------------------------------------------------------------
tick();
check('a stranger cannot take the racked sword from the rack', use(EMPTY, STRANGER) === true && lastSaid(STRANGER) === 'That is not yours to take.' && has(STRANGER, SWORD) === 1);
tick();
check('nor from the display copy itself (no pickup)', use(disp, STRANGER) === true && lastSaid(STRANGER) === 'That is not yours to take.' && refs.has(disp) && has(STRANGER, SWORD) === 1);
let raidAsked = false;
globalThis.__dboRaidActivate = () => { raidAsked = true; return true; };
tick();
check('a raider during a raid is refused the same way, and nothing is taken', use(disp, STRANGER) === true && has(STRANGER, SWORD) === 1 && refs.has(disp) && !!st().racks[EMPTY.toString(16)]);
check('the racked weapon is in no container a raid could open (raids.js takes only rec.containers)', !home.containers.includes(disp) && !home.containers.includes(EMPTY));
delete globalThis.__dboRaidActivate;
check('(the raid hook was never reached: the rack hook comes first)', raidAsked === false);
tick();
check('an NPC touching the display is refused', use(disp, NPC) === true && refs.has(disp));

const SECOND = bsh(0xf011), SECOND_MESH = bsh(0xf012);
ref(SECOND, 0x8af59, NA_CELL, [0, 0, 0], [0, 0, 0], [xlkr(0x6d95e, SECOND_MESH)]);
ref(SECOND_MESH, 0x8af5b, NA_CELL, [0, 0, 0], [0, 0, 0], [xlkr(0x6d95f, SECOND)]);
// ---- wrong kinds ----------------------------------------------------------------------------------------------------------------
tick();
check('a shield rack refuses a bow', use(SHIELD_RACK, KEYHOLDER) === true && lastSaid(KEYHOLDER) === 'Hold a shield to hang it on the rack.' && has(KEYHOLDER, BOW) === 1, lastSaid(KEYHOLDER));
tick();
check('a dagger display refuses a bow', use(DAGGER_RACK, KEYHOLDER) === true && lastSaid(KEYHOLDER) === 'Only a dagger sits on this display.' && has(KEYHOLDER, BOW) === 1);
// ---- the key holder ---------------------------------------------------------------------------------------------------------
// A weapon with no weapon-type keyword, and a mace on a rack mesh the table has no MacePivot01 for
const holdOnly = (a, base) => { for (const e of refs.get(a).inventory.entries) e.worn = e.baseId === base; };
refs.get(KEYHOLDER).inventory.entries.push({ baseId: ODD, count: 1 }, { baseId: MACE, count: 1 });
holdOnly(KEYHOLDER, ODD); tick();
check('a weapon with no weapon-type keyword is refused', use(SECOND, KEYHOLDER) === true && lastSaid(KEYHOLDER) === 'That will not sit on a weapon rack.' && has(KEYHOLDER, ODD) === 1, lastSaid(KEYHOLDER));
holdOnly(KEYHOLDER, MACE); tick();
check('a slot node missing from the table is refused, not guessed', use(SECOND, KEYHOLDER) === true && lastSaid(KEYHOLDER) === 'A mace will not fit on this rack.' && has(KEYHOLDER, MACE) === 1, lastSaid(KEYHOLDER));
holdOnly(OWNER, DAGGER); tick();
check('a rack mesh missing from the table is not ready', use(DAGGER_RACK, OWNER) === true && lastSaid(OWNER) === 'This rack is not ready yet.' && has(OWNER, DAGGER) === 2, lastSaid(OWNER));
for (const e of refs.get(OWNER).inventory.entries) e.worn = false;
holdOnly(KEYHOLDER, BOW);
tick();
check('a key holder racks their bow', use(SECOND, KEYHOLDER) === true && lastSaid(KEYHOLDER) === 'You set your LongBow on the rack.' && has(KEYHOLDER, BOW) === 0, lastSaid(KEYHOLDER));
check('the bow slot belongs to the home\'s owner (profile 1), racked by the key holder (2)', st().racks[SECOND.toString(16)].owner === 1 && st().racks[SECOND.toString(16)].by === 2);
tick();
// ---- hot reload and restart -------------------------------------------------------------------------------------------------
const before = [...refs.keys()].filter((k) => k >= 0xff100000).length;
load(false);
globalThis.__dboWeaponRackSweep();
check('a hot reload keeps the racks and makes no second display', Object.keys(st().racks).length === 2 && [...refs.keys()].filter((k) => k >= 0xff100000).length === before && logs.some((l) => /weaponracks on: 2 racked/.test(l)));
// A restart where the display's id did not come back: the sweep puts a new copy up, tagged, and the state file is the truth
refs.delete(disp);
load(true);
globalThis.__dboWeaponRackSweep();
const slot2 = st().racks[EMPTY.toString(16)];
const disp2 = parseInt(slot2.display, 16) >>> 0;
check('after a restart a lost display is put back from the state file', disp2 !== disp && refs.has(disp2) && refs.get(disp2)['private.dboRackDisplay'].rack === EMPTY.toString(16) && slot2.entry.name === "Brunhild's Bite");
check('the new copy stands at the same pivot', Math.abs(refs.get(disp2).pos[1] - 190) < 1e-6 && refs.get(disp2).angle[2] === 90);
// A display that a crash left behind (its rack points elsewhere) is removed when touched, never given
const STRAY = nextDyn++;
refs.set(STRAY, { baseDesc: descOf(SWORD), worldOrCellDesc: descOf(NA_CELL), pos: [0, 0, 0], angle: [0, 0, 0], 'private.dboRackDisplay': { rack: EMPTY.toString(16) } });
tick();
check('a stray display copy is deleted when touched and gives nothing', use(STRAY, STRANGER) === true && !refs.has(STRAY) && has(STRANGER, SWORD) === 1 && use(STRAY, OWNER) === false && has(OWNER, SWORD) === 0);

// ---- take back, and no dupe -------------------------------------------------------------------------------------------------
tick();
let stateAtGive = null;
onInventorySet = (a) => { if (a === OWNER) stateAtGive = st(); };
check('the owner takes the sword back from its display', use(disp2, OWNER) === true && lastSaid(OWNER) === "You take your Brunhild's Bite from the rack.", lastSaid(OWNER));
onInventorySet = null;
const back = inv(OWNER).find((e) => e.baseId === SWORD);
check('it comes back with its extras', back && back.enchantmentId === 0x4b27f && back.name === "Brunhild's Bite" && back.health === 1.4 && back.count === 1 && has(OWNER, SWORD) === 1, back);
check('the slot was cleared in the state file before the sword was given', stateAtGive && !stateAtGive.racks[EMPTY.toString(16)] && !stateAtGive.pending['1']);
check('the display is gone', !refs.has(disp2));
tick();
check('a second activation of the rack gives nothing more: it is empty, and the owner is not holding a weapon', use(EMPTY, OWNER) === true && has(OWNER, SWORD) === 1 && lastSaid(OWNER) === 'Hold the weapon you want to put on the rack.', lastSaid(OWNER));
check('the deleted display cannot be used again', use(disp2, OWNER) === false && has(OWNER, SWORD) === 1);

// ---- a failed write refuses and changes nothing ------------------------------------------------------------------------------
refs.get(OWNER).inventory.entries.find((e) => e.baseId === SWORD).worn = true;
const realWrite = fs.writeFileSync;
fs.writeFileSync = (f, ...r) => { if (String(f).startsWith(STATE)) throw new Error('disk full'); return realWrite(f, ...r); };
tick();
check('when the state file cannot be written the rack refuses and the sword stays', use(EMPTY, OWNER) === true && lastSaid(OWNER) === 'Something went wrong there. Try again in a moment.' && has(OWNER, SWORD) === 1 && !st().racks[EMPTY.toString(16)]);
fs.writeFileSync = realWrite;
inventoryFails = true;
tick();
check('when the inventory change fails the slot is undone', use(EMPTY, OWNER) === true && has(OWNER, SWORD) === 1 && !st().racks[EMPTY.toString(16)]);
inventoryFails = false;
tick();
check('racking works again after both', use(EMPTY, OWNER) === true && has(OWNER, SWORD) === 0 && !!st().racks[EMPTY.toString(16)]);

// ---- the home changes hands --------------------------------------------------------------------------------------------------
home.owner = 0; // read as unowned for a moment (boot, a write in flight) and back again
globalThis.__dboWeaponRackSweep();
home.owner = 1; clock += 61000;
globalThis.__dboWeaponRackSweep();
check('a single sweep reading the home as unowned returns nothing', Object.keys(st().racks).length === 2 && has(OWNER, SWORD) === 0);
housingReadable = false; clock += 61000; globalThis.__dboWeaponRackSweep(); housingReadable = true;
check('nor does a sweep that cannot read housing', Object.keys(st().racks).length === 2);
// Transferred to profile 9, the owner offline
online = [KEYHOLDER, STRANGER];
home.owner = 9; home.ownerName = 'Someone else';
globalThis.__dboWeaponRackSweep();
check('the first sweep after a transfer only notes it', Object.keys(st().racks).length === 2);
clock += 61000;
const dispNow = Object.values(st().racks).map((s) => parseInt(s.display, 16) >>> 0);
globalThis.__dboWeaponRackSweep();
check('a minute later both racked weapons are taken down for the previous owner', Object.keys(st().racks).length === 0 && dispNow.every((x) => !refs.has(x)));
check('the owner is offline: both wait in their pending list, extras kept', (st().pending['1'] || []).length === 2 && st().pending['1'].some((p) => p.entry.name === "Brunhild's Bite") && st().pending['1'].some((p) => p.entry.baseId === BOW));
check('the key holder who racked the bow does not get it (it goes to the previous owner)', has(KEYHOLDER, BOW) === 0);
check('the hand-over is audited', audits.some((a) => /home 8000efc changed hands \(1 -> 9\)/.test(a)));
tick();
check('the racks are empty now: a stranger finds no weapon to take, only the household rule', use(EMPTY, STRANGER) === true && lastSaid(STRANGER) === 'Only the household can use this rack.' && has(STRANGER, SWORD) === 1);
online = [OWNER, KEYHOLDER, STRANGER];
said.length = 0;
globalThis.__dboWeaponRackSweep();
check('when the previous owner logs in, the next sweep gives both back', has(OWNER, SWORD) === 1 && has(OWNER, BOW) === 1 && inv(OWNER).find((e) => e.baseId === SWORD).enchantmentId === 0x4b27f && !st().pending['1']);
check('and tells them', /2 weapons were taken down from weapon racks and given back to you/.test(lastSaid(OWNER)), lastSaid(OWNER));
globalThis.__dboWeaponRackSweep();
check('a further sweep gives nothing twice', has(OWNER, SWORD) === 1 && has(OWNER, BOW) === 1);
// Given up while the owner is online: straight back
home.owner = 1;
refs.get(OWNER).inventory.entries.find((e) => e.baseId === BOW).worn = true;
refs.get(OWNER).inventory.entries.find((e) => e.baseId === SWORD).worn = false;
tick();
use(SECOND, OWNER);
check('(the owner racks the bow again)', !!st().racks[SECOND.toString(16)] && has(OWNER, BOW) === 0);
home.owner = 0;
globalThis.__dboWeaponRackSweep(); clock += 61000; globalThis.__dboWeaponRackSweep();
check('given up with the owner online: the bow is back in their hands at once', has(OWNER, BOW) === 1 && !st().racks[SECOND.toString(16)] && !st().pending['1']);
home.owner = 1;

// ---- hold managers -------------------------------------------------------------------------------------------------------------
// Bruma's Count (5), a Steward by the backend's faction row (8), Cheydinhal's Count (6), Bruma's Captain (7, not a managing rank)
fs.writeFileSync('officials.json', JSON.stringify({ bruma: { count: [5], captain: [7] }, cheydinhal: { count: [6] } }));
const COUNT = 0xff000021, STEWARD = 0xff000022, OTHER_COUNT = 0xff000023, CAPTAIN = 0xff000024;
player(COUNT, 5, []); player(OTHER_COUNT, 6, []); player(CAPTAIN, 7, []); player(STEWARD, 8, []);
refs.get(STEWARD)['private.skympAccess'] = { factions: [{ requirementId: 'hold:bruma:steward' }] };
refs.get(CAPTAIN)['private.skympAccess'] = { factions: [{ requirementId: 'hold:cheydinhal:steward' }] };
online = [OWNER, KEYHOLDER, STRANGER, COUNT, OTHER_COUNT, CAPTAIN, STEWARD];
holdOnly(OWNER, BOW); tick();
check('(the owner racks the bow for the managers\' turn)', use(SECOND, OWNER) === true && !!st().racks[SECOND.toString(16)] && has(OWNER, BOW) === 0);
tick();
check('a Count of another hold may not take it down', use(SECOND, OTHER_COUNT) === true && lastSaid(OTHER_COUNT) === 'That is not yours to take.' && has(OTHER_COUNT, BOW) === 0 && !!st().racks[SECOND.toString(16)]);
tick();
check('a Captain of the hold (not a managing rank, and a Steward elsewhere) may not', use(SECOND, CAPTAIN) === true && lastSaid(CAPTAIN) === 'That is not yours to take.' && has(CAPTAIN, BOW) === 0);
tick();
check('a hold manager cannot rack in a home that is not theirs', (() => { refs.get(COUNT).inventory.entries.push({ baseId: SWORD, count: 1, worn: true }); const r = use(EMPTY, COUNT); return r === true && lastSaid(COUNT) === 'Only the household can use this rack.' && has(COUNT, SWORD) === 1; })());
tick();
const dispBow = parseInt(st().racks[SECOND.toString(16)].display, 16) >>> 0;
audits.length = 0;
check('Bruma\'s Count takes the bow down, from its display', use(dispBow, COUNT) === true && lastSaid(COUNT) === 'As count of the hold, you take the LongBow down from the rack.', lastSaid(COUNT));
check('it goes to the Count\'s own inventory, and the slot and display are gone', has(COUNT, BOW) === 1 && has(OWNER, BOW) === 0 && !st().racks[SECOND.toString(16)] && !refs.has(dispBow) && !st().pending['5']);
check('the take is audited with who, rank, hold and whose it was', /^WEAPONRACK hold manager actor ff000021 took LongBow \(3b562\) down from 800f011 in home 8000efc \(owner profile 1, racked by 1\): as count of bruma$/.test(audits[audits.length - 1]), audits);
holdOnly(OWNER, SWORD); tick(); use(EMPTY, OWNER);
check('(the owner racks the sword)', !!st().racks[EMPTY.toString(16)]);
tick();
check('a Steward by the backend\'s hold row takes it down too', use(EMPTY, STEWARD) === true && has(STEWARD, SWORD) === 1 && inv(STEWARD).find((e) => e.baseId === SWORD).enchantmentId === 0x4b27f && !st().racks[EMPTY.toString(16)]);
check('and that take is audited as steward of bruma', /as steward of bruma$/.test(audits[audits.length - 1]), audits[audits.length - 1]);
check('weaponracks.js gives staff no override (no admin or tier check in it)', !/isAdmin|tierOf|adminTier/.test(fs.readFileSync(MODULE, 'utf8')));

// ---- an unreadable state file is never overwritten ------------------------------------------------------------------------------
fs.writeFileSync(STATE, '{ broken');
load(true);
refs.get(OWNER).inventory.entries.push({ baseId: BOW, count: 1 }); holdOnly(OWNER, BOW);
tick();
check('a corrupt state file: racking is refused and the file is kept for repair', use(SECOND, OWNER) === true && has(OWNER, BOW) === 1 && fs.readFileSync(STATE, 'utf8') === '{ broken');

fs.rmSync(scratch, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
