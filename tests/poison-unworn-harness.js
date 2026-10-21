// Weapon poisons on the copy the fork writes back (#bugs "Poisons Not Working", 21 Oct). The fork's crafted-extras report
// stores a coated weapon as a new entry without its worn flag (skymp5-server inventoryExtras withCount deletes worn), and the
// judge only looked at worn copies, so no blow ever carried a poison (0 "alchemy: poison" lines 18-21 Oct). Checks: the
// unworn coated copy is judged when no worn copy of that weapon is left; a worn clean copy beside a coated spare still
// carries nothing; a worn coated copy works as before; charges still count. Run from the server folder:
//
//   node tests/poison-unworn-harness.js
'use strict';
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
process.chdir(SERVER);
let failures = 0;
const check = (name, ok, detail) => { if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); } else console.log(`ok   ${name}`); };
const near = (x, y) => Math.abs(x - y) < 1e-6;

const bytes = (n) => new Uint8Array(n);
const u32 = (n) => { const b = bytes(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const efit = (mag, dur) => { const b = bytes(12); const v = new DataView(b.buffer); v.setFloat32(0, mag, true); v.setUint32(8, dur, true); return b; };
const DAMAGE_HEALTH = 0x3eb42;
const POISON = 0x49000a30, WEAPON = 0x50000200, OTHER = 0x50000201;
const enit = bytes(20); new DataView(enit.buffer).setUint32(4, 0x20000, true);
const RECORDS = {
  [POISON]: { type: 'ALCH', editorId: 'DBO_AlchPoisonHealthT1', fields: [{ type: 'ENIT', data: enit }, { type: 'EFID', data: u32(DAMAGE_HEALTH) }, { type: 'EFIT', data: efit(30, 0) }] },
  [WEAPON]: { type: 'WEAP', editorId: 'MockSword', fields: [] },
  [OTHER]: { type: 'WEAP', editorId: 'MockAxe', fields: [] },
};
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
const logs = [];
const api = { mp, cfg: { alchemyRework: { poisons: { judge: true, anchorPool: 200, minHealth: 0.01, ledgerMinutes: 5 } } }, log: (...x) => logs.push(x.join(' ')),
  personal: () => {}, audit: () => {}, who: () => 'P', display: () => 'P', openWidget: () => {}, closeWidget: () => {}, every: () => {}, itemName: () => '',
  onUi: () => {}, sendPacket: () => {} };
mp.onEatItem = () => true;
require(path.resolve('alchemy.js'))(api);
const tick = () => new Promise((r) => setImmediate(r));
const fresh = () => { globalThis.__dboPoisonLedger.clear(); put(B, 'percentages', { health: 1, magicka: 1, stamina: 1 }); };

(async () => {
  // What the fork leaves after a coat on the drawn sword: the coated copy, no worn flag, no other sword
  fresh();
  put(A, 'inventory', { entries: [{ baseId: WEAPON, count: 1, poisonId: POISON, poisonCount: 1 }, { baseId: OTHER, count: 1 }] });
  const got = globalThis.__dboPoisonHit(A, B, WEAPON, {});
  await tick();
  check('the coated copy the fork wrote back (no worn flag) is judged', !!got && near(mp.get(B, 'percentages').health, 0.85), { got, pct: mp.get(B, 'percentages') });
  check('...and logged', logs.some((l) => /alchemy: poison DBO_AlchPoisonHealthT1/.test(l)), logs.filter((l) => /alchemy: poison /.test(l)));
  check('...one charge: the next blow carries none', globalThis.__dboPoisonHit(A, B, WEAPON, {}) === null);

  // A worn clean sword beside a coated spare of the same sword: the blow is the clean one's
  fresh();
  put(A, 'inventory', { entries: [{ baseId: WEAPON, count: 1, worn: true }, { baseId: WEAPON, count: 1, poisonId: POISON, poisonCount: 1 }] });
  check('a worn clean copy beside a coated spare carries no poison', globalThis.__dboPoisonHit(A, B, WEAPON, {}) === null);

  // A worn coated copy, as before
  fresh();
  put(A, 'inventory', { entries: [{ baseId: WEAPON, count: 1, worn: true, poisonId: POISON, poisonCount: 1 }] });
  const worn = globalThis.__dboPoisonHit(A, B, WEAPON, {});
  await tick();
  check('a worn coated copy is judged as before', !!worn && near(mp.get(B, 'percentages').health, 0.85), mp.get(B, 'percentages'));

  // Another weapon's blow never takes the coat
  fresh();
  put(A, 'inventory', { entries: [{ baseId: WEAPON, count: 1, poisonId: POISON, poisonCount: 1 }, { baseId: OTHER, count: 1, worn: true }] });
  check('a blow from another weapon carries no poison', globalThis.__dboPoisonHit(A, B, OTHER, {}) === null);

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
