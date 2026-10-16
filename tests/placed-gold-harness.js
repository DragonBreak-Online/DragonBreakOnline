'use strict';
// gamemode.js isPlacedGold / placedGoldRefused: plugin-placed gold (Gold001 or a gold-pile MISC) is refused, a dropped
// (dynamic) stack and other items are not. Run from the server folder: node tests/placed-gold-harness.js
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const GM = fs.readFileSync(path.join(__dirname, '..', 'gamemode.js'), 'utf8');
const code = GM.slice(GM.indexOf('const placedGoldBase = new Map();'), GM.indexOf('// Review of acf20eac'));
const bases = { 0x10a: 'f:Skyrim.esm', 0x10b: '1234:Riften Expansion.esp', 0x10c: '5678:Skyrim.esm', 0xff000010: 'f:Skyrim.esm' };
const ids = { 'f:Skyrim.esm': 0xf, '1234:Riften Expansion.esp': 0x22001234, '5678:Skyrim.esm': 0x5678 };
const recs = { 0x22001234: { record: { type: 'MISC', editorId: 'RFX_CoinPile01' } }, 0x5678: { record: { type: 'MISC', editorId: 'Lantern' } } };
const told = []; const audits = [];
const mk = (cfg) => new Function('mp', 'cfg', 'recordOf', 'lastPickupDeny', 'personal', 'audit', 'who', code + '; return { isPlacedGold, placedGoldRefused };')(
  { get: (id, p) => bases[id], getIdFromDesc: (d) => ids[d] || 0 }, cfg, (id) => recs[id] || null, new Map(), (a, t) => told.push(t), (t) => audits.push(t), (a) => `p${a}`);
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const g = mk({});
t('vanilla gold placed in a plugin is refused', () => assert.strictEqual(g.placedGoldRefused(0x14, 0x10a), true));
t('a mod coin pile MISC is refused', () => assert.strictEqual(g.isPlacedGold(0x10b), true));
t('other MISC is not', () => assert.strictEqual(g.isPlacedGold(0x10c), false));
t('dropped gold (dynamic ref) is not', () => assert.strictEqual(g.isPlacedGold(0xff000010), false));
t('the player is told and it is audited', () => { assert.ok(told[0].includes('not yours')); assert.ok(audits[0].startsWith('GOLD ')); });
t('placedGold.pickup true turns it off', () => assert.strictEqual(mk({ placedGold: { pickup: true } }).isPlacedGold(0x10a), false));
console.log(`${n}/6 passed`); process.exit(n === 6 ? 0 : 1);
