// A player's damage-over-time spell (spelldot.js; Marcus, 18 Oct: Toxic Volley "doesn't even do damage"): the hit deals the
// magnitude once, the module deals the rest of the duration as ticks of the same size. Loads the real module with records
// shaped as BSAssets.esm's BSKToxicMissile (fire and forget, 6 for 10 s) and BSKToxicVolley (concentration, 10 for 10 s).
//   node tests/spelldot-harness.js   (from server/)
'use strict';
const path = require('path');
let fails = 0;
const ok = (l, c, g) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${l}${!c && g !== undefined ? `: got ${JSON.stringify(g)}` : ''}`); if (!c) fails++; };

const bytes = (n) => new Uint8Array(n);
const field = (type, fill) => { const b = bytes(fill.size); fill(new DataView(b.buffer)); return { type, data: b }; };
const efid = (id) => field('EFID', Object.assign((dv) => dv.setUint32(0, id, true), { size: 4 }));
const efit = (mag, dur) => field('EFIT', Object.assign((dv) => { dv.setFloat32(0, mag, true); dv.setUint32(8, dur, true); }, { size: 12 }));
const spit = (castType) => field('SPIT', Object.assign((dv) => dv.setUint32(16, castType, true), { size: 36 }));
const mgef = (flags, arch, av) => ({ record: { type: 'MGEF', editorId: 'm', fields: [field('DATA', Object.assign((dv) => { dv.setUint32(0, flags, true); dv.setUint32(64, arch, true); dv.setInt32(68, av, true); }, { size: 152 }))] } });
const POISON = 0x100, RESTORE = 0x101, SHOCK = 0x102;
const MISSILE = 0x200, VOLLEY = 0x201, SPARKS = 0x202, HEAL = 0x203, BITE = 0x204;
const records = new Map([
  [POISON, mgef(0x10201805, 0, 24)], [RESTORE, mgef(0x200a00, 0, 24)], [SHOCK, mgef(0x10200805, 0, 24)],
  [MISSILE, { record: { type: 'SPEL', editorId: 'BSKToxicMissile', fields: [spit(1), efid(POISON), efit(6, 10)] } }],
  [VOLLEY, { record: { type: 'SPEL', editorId: 'BSKToxicVolley', fields: [spit(2), efid(POISON), efit(10, 10)] } }],
  [SPARKS, { record: { type: 'SPEL', editorId: 'Sparks', fields: [spit(2), efid(SHOCK), efit(8, 0)] } }],
  [HEAL, { record: { type: 'SPEL', editorId: 'Heal', fields: [spit(2), efid(RESTORE), efit(10, 5)] } }],
  [BITE, { record: { type: 'SPEL', editorId: 'crChaurusPoisonSpit01', fields: [spit(1), efid(POISON), efit(5, 5)] } }],
]);
for (const r of records.values()) r.toGlobalRecordId = (x) => x;

let now = 1790000000000; Date.now = () => now;
const PLAYER = 0xff000010, NPC = 0xff100001, CHAURUS = 0xff100002;
const props = new Map([[NPC + '|percentages', { health: 1, magicka: 1, stamina: 1 }], [PLAYER + '|percentages', { health: 1, magicka: 1, stamina: 1 }]]);
const hp = (a) => props.get(a + '|percentages').health;
const setHp = (a, h) => props.set(a + '|percentages', { health: h, magicka: 1, stamina: 1 });
require(path.resolve(__dirname, '..', 'spelldot.js'))({
  mp: { get: (id, p) => props.get(id + '|' + p), set: (id, p, v) => props.set(id + '|' + p, v) },
  log: () => {}, cfg: {}, every: () => {}, recordOf: (id) => records.get(id >>> 0) || null,
  profileOf: (a) => (a === PLAYER ? 7 : -1), display: String,
});
const hit = (agg, tgt, src, pct) => { globalThis.__dboSpellDotAttempt(agg, tgt, src, hp(tgt)); setHp(tgt, hp(tgt) - pct); return globalThis.__dboSpellDotLanded(agg, tgt, src); };
const tick = (ms) => { for (let t = 0; t < ms; t += 250) { now += 250; globalThis.__dboSpellDotRun(); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;

ok('Toxic Missile reads as 10 s of damage over time', JSON.stringify(globalThis.__dboSpellDotOf(MISSILE)) === JSON.stringify({ seconds: 10, conc: false }));
ok('Toxic Volley is a concentration one', globalThis.__dboSpellDotOf(VOLLEY).conc === true);
ok('Sparks (no duration) and Heal (not hostile) are not', globalThis.__dboSpellDotOf(SPARKS) === null && globalThis.__dboSpellDotOf(HEAL) === null);

let d = hit(PLAYER, NPC, MISSILE, 0.04);
ok('a missile hit takes 4%; nine ticks of 4% are queued', d && near(d.per, 0.04) && d.left === 9);
tick(750);
ok('nothing more within the first second', near(hp(NPC), 0.96));
tick(9250);
ok('...then 4% a second for 9 s: 40% in all, as the spell says', near(hp(NPC), 0.60), hp(NPC));
tick(3000);
ok('and no more after', near(hp(NPC), 0.60));

setHp(NPC, 1);
hit(PLAYER, NPC, VOLLEY, 0.05); tick(1250); hit(PLAYER, NPC, VOLLEY, 0.05); tick(1250); hit(PLAYER, NPC, VOLLEY, 0.05);
ok('channelled Volley: only the hits while the beam holds (no ticks between them)', near(hp(NPC), 0.85), hp(NPC));
tick(10000);
ok('...then the lingering 9 s once it stops', near(hp(NPC), 0.40), hp(NPC));

setHp(NPC, 0.3);
hit(PLAYER, NPC, MISSILE, 0.04); tick(10000);
ok('a tick never kills: it stops at 1%', near(hp(NPC), 0.01), hp(NPC));

setHp(PLAYER, 1);
ok('a creature\'s poison spit is left alone', hit(CHAURUS, PLAYER, BITE, 0.05) === null);
tick(5000);
ok('...the player takes only the hit', near(hp(PLAYER), 0.95));

setHp(NPC, 1);
globalThis.__dboSpellDotAttempt(PLAYER, NPC, MISSILE, 1);
ok('a hit that took nothing (warded, blocked) starts no ticks', globalThis.__dboSpellDotLanded(PLAYER, NPC, MISSILE) === null);

console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
