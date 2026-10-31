// A judged poison blow spends its charge on the server's copy at once (sweep 31 Oct: "poisons apply only sometimes and
// unequip the weapon"). The client spends the charge on the blow but reports it up to 10 s later, and re-applies the
// server's inventory every 5 s: a server copy still coated put the spent coat back, unequipped, and it struck for nothing.
// The client is modelled as the re-apply sees it (remoteServer.ts applyInventory with ignoreWorn): any difference in
// extras replaces the local copy with the server's, which is not worn. Run from the server folder:
//
//   node tests/poison-spend-harness.js
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
const POISON = 0x49000a30, WEAPON = 0x50000200, GOLD = 0xf;
const enit = bytes(20); new DataView(enit.buffer).setUint32(4, 0x20000, true);
const RECORDS = {
  [POISON]: { type: 'ALCH', editorId: 'DBO_AlchPoisonHealthT1', fields: [{ type: 'ENIT', data: enit }, { type: 'EFID', data: u32(DAMAGE_HEALTH) }, { type: 'EFIT', data: efit(30, 0) }] },
  [WEAPON]: { type: 'WEAP', editorId: 'MockSword', fields: [] },
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
const logged = [];
const load = (poisons) => {
  const api = { mp, cfg: {}, log: (...x) => logged.push(x.join(' ')), personal: () => {}, audit: () => {}, who: () => 'P', display: () => 'P', openWidget: () => {}, closeWidget: () => {},
    every: () => {}, itemName: () => '', onUi: () => {}, sendPacket: () => {} };
  if (poisons) {
    const fs = require('fs');
    const real = JSON.parse(fs.readFileSync(path.resolve('alchemy-rework.json'), 'utf8'));
    real.poisons = Object.assign({}, real.poisons, poisons);
    api.cfg = { alchemyRework: real };
  }
  mp.onEatItem = (actorId, baseId) => (RECORDS[baseId >>> 0] && RECORDS[baseId >>> 0].type === 'ALCH' ? false : true);
  require(path.resolve('alchemy.js'))(api);
};
load();
const hit = () => globalThis.__dboPoisonHit(A, B, WEAPON, {});
const server = () => (mp.get(A, 'inventory') || { entries: [] }).entries;
const extrasKey = (e) => JSON.stringify({ baseId: e.baseId, poisonId: e.poisonId || 0, poisonCount: e.poisonCount || 0 });
const bag = (entries) => { const m = new Map(); for (const e of entries) m.set(extrasKey(e), (m.get(extrasKey(e)) || 0) + (Number(e.count) || 0)); return m; };
// The client: its own copies, the drawn one worn. reapply() is the 5 s re-apply: a copy that differs comes back unworn
let local = [];
const reapply = () => {
  const want = bag(server()), have = bag(local);
  const same = want.size === have.size && [...want].every(([k, n]) => have.get(k) === n);
  if (same) return false;
  local = server().map((e) => Object.assign({}, e, { worn: false }));
  return true;
};
const strike = () => { const got = hit(); const w = local.find((e) => e.baseId === WEAPON && e.worn); if (w && w.poisonId) { w.poisonCount = (w.poisonCount || 1) - 1; if (w.poisonCount <= 0) { delete w.poisonId; delete w.poisonCount; } } return got; };
const coat = (count) => {
  globalThis.__dboPoisonLedger.clear();
  put(B, 'percentages', { health: 1, magicka: 1, stamina: 1 });
  put(A, 'equipment', { inv: { entries: [{ baseId: WEAPON, count: 1, worn: true }] } });
  mp.onEatItem(A, POISON);
  put(A, 'inventory', { entries: [{ baseId: GOLD, count: 50 }, { baseId: WEAPON, count: 1, poisonId: POISON, poisonCount: count }] });
  local = [{ baseId: GOLD, count: 50 }, { baseId: WEAPON, count: 1, poisonId: POISON, poisonCount: count, worn: true }];
};
const wornWeapon = () => local.find((e) => e.baseId === WEAPON && e.worn);

// One charge: the blow lands, the server's copy is clean at once, and the re-apply before the client's report changes nothing
coat(1);
check('a coated blow lands', !!strike());
const w1 = server().find((e) => e.baseId === WEAPON);
check("the server's copy is clean right after the blow", w1 && !w1.poisonId && !w1.poisonCount, server());
check('the 5 s re-apply before the late report changes nothing: the weapon stays drawn and clean', reapply() === false && !!wornWeapon() && !wornWeapon().poisonId, local);
check('...and the next blow carries no poison', strike() === null);
check('the gold and the rest are kept', server().some((e) => e.baseId === GOLD && e.count === 50), server());

// Two charges (Concentrated Poison): the server counts down with the client
coat(2);
strike();
const w2 = server().find((e) => e.baseId === WEAPON);
check('two charges: one left on the server copy after the first blow', w2 && w2.poisonId === POISON && w2.poisonCount === 1, server());
check('...the re-apply finds nothing to change', reapply() === false && !!wornWeapon());
check('...the second blow lands', !!strike());
check('...then the copy is clean and nothing is re-applied', !server().find((e) => e.baseId === WEAPON).poisonId && reapply() === false);
check('...and a third blow carries none', strike() === null);

// A stack of two coated swords: one is spent, the other keeps its coat
globalThis.__dboPoisonLedger.clear();
put(A, 'inventory', { entries: [{ baseId: WEAPON, count: 2, poisonId: POISON, poisonCount: 1 }] });
hit();
const inv = server().filter((e) => e.baseId === WEAPON);
check('a stack of two: one copy spent, one still coated', inv.length === 2 && inv.some((e) => e.count === 1 && e.poisonId === POISON) && inv.some((e) => e.count === 1 && !e.poisonId), inv);

// A spent copy joins a clean one of the same sword rather than making a second entry
globalThis.__dboPoisonLedger.clear();
put(A, 'inventory', { entries: [{ baseId: WEAPON, count: 1 }, { baseId: WEAPON, count: 1, poisonId: POISON, poisonCount: 1 }] });
hit();
const merged = server().filter((e) => e.baseId === WEAPON);
check('the spent copy joins the clean one', merged.length === 1 && merged[0].count === 2 && !merged[0].poisonId, merged);

// spendOnServer false: the old behaviour, the copy stays coated until the client reports
load({ spendOnServer: false });
coat(1);
strike();
check('spendOnServer false: the copy keeps its coat until the report', server().find((e) => e.baseId === WEAPON).poisonId === POISON, server());
check('...which is the bug: the re-apply puts the coat back, unequipped', reapply() === true && !wornWeapon() && local.some((e) => e.baseId === WEAPON && e.poisonId === POISON), local);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
