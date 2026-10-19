// Scripted test for Arcane Asylum in gamemode.js (asylumCast, asylumHit). No server and no game: run it from this folder's
// parent with `node tests/arcane-asylum-harness.js`. BSAssets' BSKArcaneAsylum (d64) carries EFIT magnitude 4, duration 10.
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'gamemode.js'), 'utf8');
const from = src.indexOf('// Arcane Asylum (Beyond Skyrim'), to = src.indexOf('const castHook = (casterId, spellId, ...rest) => {');
if (from < 0 || to < 0) { console.error('asylum block markers not found in gamemode.js'); process.exit(1); }
let fails = 0; const ok = (c, m, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${m}${c ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const SPELL = 0x1000d64, OTHER = 0x12fcd, A = 0xff000001, B = 0xff000002;
const efit = () => { const b = new DataView(new ArrayBuffer(12)); b.setFloat32(0, 4, true); b.setUint32(8, 10, true); return new Uint8Array(b.buffer); };
const recordOf = (id) => (id === SPELL ? { record: { type: 'SPEL', fields: [{ type: 'EFIT', data: efit() }] } } : null);
const fieldsOf = (lr, type) => ((lr && lr.record && lr.record.fields) || []).filter((f) => f.type === type && f.data instanceof Uint8Array);
const u32At = (f, off) => (f && f.data.byteLength >= off + 4 ? new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(off, true) : 0);
const load = (cfg) => { delete globalThis.__dboAsylumUntil; return new Function('mp', 'cfg', 'log', 'display', 'recordOf', 'fieldsOf', 'u32At', `${src.slice(from, to)}; return { asylumCast, asylumHit };`)(
  { getIdFromDesc: (d) => (d === 'd64:BSAssets.esm' ? SPELL : 0) }, cfg, () => {}, String, recordOf, fieldsOf, u32At); };
let m = load({});
const realNow = Date.now; let now = 1e12; Date.now = () => now;
m.asylumCast(B, OTHER);
ok(m.asylumHit(A, B) === false, 'another spell gives no Asylum');
m.asylumCast(B, SPELL);
ok(m.asylumHit(A, B) === true, 'after casting Arcane Asylum, a blow on the caster is refused');
now += 9000; ok(m.asylumHit(A, B) === true, '...for the spell\'s 10 seconds');
now += 2000; ok(m.asylumHit(A, B) === false, '...and lands after them');
m.asylumCast(B, SPELL);
ok(m.asylumHit(B, A) === false && m.asylumHit(A, B) === false, 'the caster\'s own blow lands, and ends the Asylum');
m.asylumCast(B, SPELL);
ok(m.asylumHit(B, B) === false && m.asylumHit(A, B) === true, 'a self hit neither lands as protection nor ends it');
m = load({ arcaneAsylum: { enabled: false } }); m.asylumCast(B, SPELL);
ok(m.asylumHit(A, B) === false, 'enabled false: no Asylum');
ok(/globalThis\.__dboHitRefusal = 'asylum';\n  if \(asylumHit\(agg, tgt\)\) return false;/.test(src) && /asylumCast\(Number\(casterId\) >>> 0, Number\(spellId\) >>> 0\)/.test(src), 'the hit judge and the cast hook call it');
Date.now = realNow;
console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
