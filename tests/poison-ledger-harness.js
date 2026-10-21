// Weapon poison charges as the live server stores a player (review of fix/b1021-poison-unworn, 21 Oct). A player's
// server inventory never carries worn flags (they live in the equipment property), so the judge takes any coated copy
// of the weapon. Checks: a coat lands once; a fresh coat of the same poison lands again right after the last one was
// used up; a coated spare that never strikes cannot re-arm itself as time passes; two charges stay two; a fresh coat of
// another poison on a second copy is not hidden by a spent coat on the first. Run from the server folder:
//
//   node tests/poison-ledger-harness.js
'use strict';
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
process.chdir(SERVER);
let failures = 0;
const check = (name, ok, detail) => { if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); } else console.log(`ok   ${name}`); };

const bytes = (n) => new Uint8Array(n);
const u32 = (n) => { const b = bytes(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const efit = (mag, dur) => { const b = bytes(12); const v = new DataView(b.buffer); v.setFloat32(0, mag, true); v.setUint32(8, dur, true); return b; };
const DAMAGE_HEALTH = 0x3eb42;
const POISON = 0x49000a30, POISON2 = 0x49000a31, WEAPON = 0x50000200;
const enit = bytes(20); new DataView(enit.buffer).setUint32(4, 0x20000, true);
const poisonRec = (edid) => ({ type: 'ALCH', editorId: edid, fields: [{ type: 'ENIT', data: enit }, { type: 'EFID', data: u32(DAMAGE_HEALTH) }, { type: 'EFIT', data: efit(30, 0) }] });
const RECORDS = { [POISON]: poisonRec('DBO_AlchPoisonHealthT1'), [POISON2]: poisonRec('DBO_AlchPoisonHealthT1b'), [WEAPON]: { type: 'WEAP', editorId: 'MockSword', fields: [] } };
const props = new Map();
const put = (id, p, v) => props.set(id + '|' + p, JSON.parse(JSON.stringify(v)));
const A = 0x14, B = 0x15;
const mp = {
  getIdFromDesc: (d) => { const [hex, plugin] = String(d).split(':'); return ((plugin === 'Skyrim.esm' ? 0 : 0x49) << 24 | parseInt(hex, 16)) >>> 0; },
  getDescFromId: (id) => `${(id & 0xffffff).toString(16)}:Mock.esp`,
  get: (id, p) => props.get(id + '|' + p),
  set: (id, p, v) => put(id, p, v),
  lookupEspmRecordById: (id) => (RECORDS[id] ? { record: RECORDS[id], toGlobalRecordId: (local) => local } : null),
  callPapyrusFunction: () => false,
};
// alchemy-rework.json as shipped (poisons.judge true since 18 Oct)
const api = { mp, cfg: {}, log: () => {},
  personal: () => {}, audit: () => {}, who: () => 'P', display: () => 'P', openWidget: () => {}, closeWidget: () => {}, every: () => {}, itemName: () => '',
  onUi: () => {}, sendPacket: () => {} };
// The fork's eat chain answers false for a poison (craftedExtrasSystem: OnEquip removes it, no effects)
mp.onEatItem = (actorId, baseId) => (RECORDS[baseId >>> 0] && RECORDS[baseId >>> 0].type === 'ALCH' ? false : true);
require(path.resolve('alchemy.js'))(api);
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
const minutes = (n) => { offset += n * 60000; };
const hit = () => globalThis.__dboPoisonHit(A, B, WEAPON, {});
// Applying a poison: OnEquip reaches onEatItem first, the craft report writes the coated copy after
const apply = (poison, entries) => { mp.onEatItem(A, poison); put(A, 'inventory', { entries }); };
const fresh = () => { globalThis.__dboPoisonLedger.clear(); offset = 0; put(B, 'percentages', { health: 1, magicka: 1, stamina: 1 }); };
// What the live server holds: no worn flag in the inventory, the drawn sword worn in the equipment only
const equipped = () => put(A, 'equipment', { inv: { entries: [{ baseId: WEAPON, count: 1, worn: true }] } });

// One sword, coated, used up, coated again with the same poison seconds later (no blow in between): both coats land
fresh(); equipped();
apply(POISON, [{ baseId: WEAPON, count: 1, poisonId: POISON, poisonCount: 1 }]);
check('a coat lands', !!hit());
check('...once', hit() === null);
put(A, 'inventory', { entries: [{ baseId: WEAPON, count: 1 }] }); // the client's "poison used up"
minutes(0.2);
apply(POISON, [{ baseId: WEAPON, count: 1, poisonId: POISON, poisonCount: 1 }]);
check('a fresh coat of the same poison right after lands too', !!hit());
check('...once', hit() === null);

// A coated spare in the pack and a clean copy of the same sword drawn: the spare never strikes, so the client never
// reports it used up; the coat may land once, but never again just because time passes
fresh(); equipped();
apply(POISON, [{ baseId: WEAPON, count: 1 }, { baseId: WEAPON, count: 1, poisonId: POISON, poisonCount: 1 }]);
const first = hit();
minutes(6);
const again = hit();
minutes(60);
const later = hit();
check('a coated spare that never strikes does not re-arm after 6 or 66 minutes', again === null && later === null, { first: !!first, again: !!again, later: !!later });

// Two charges (Concentrated Poison): two landings, then none, even after a pause
fresh(); equipped();
apply(POISON, [{ baseId: WEAPON, count: 1, poisonId: POISON, poisonCount: 2 }]);
const c1 = !!hit();
minutes(6);
const c2 = !!hit();
minutes(6);
const c3 = !!hit();
check('two charges land twice and no more, pauses included', c1 && c2 && !c3, { c1, c2, c3 });

// The client says one charge is left: the ledger never counts more than the copy holds
fresh(); equipped();
apply(POISON, [{ baseId: WEAPON, count: 1, poisonId: POISON, poisonCount: 2 }]);
hit();
put(A, 'inventory', { entries: [{ baseId: WEAPON, count: 1, poisonId: POISON, poisonCount: 1 }] }); // "poison down to 1"
const d1 = !!hit(), d2 = !!hit();
check('"down to 1" leaves one more landing', d1 && !d2, { d1, d2 });

// A spent coat on the spare does not hide a fresh coat of another poison on the drawn copy
fresh(); equipped();
apply(POISON, [{ baseId: WEAPON, count: 1 }, { baseId: WEAPON, count: 1, poisonId: POISON, poisonCount: 1 }]);
hit();
apply(POISON2, [{ baseId: WEAPON, count: 1, poisonId: POISON, poisonCount: 1 }, { baseId: WEAPON, count: 1, poisonId: POISON2, poisonCount: 1 }]);
const other = hit();
check('a fresh coat of another poison lands past a spent one', !!other && other.poison === POISON2, other);

Date.now = realNow;
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
