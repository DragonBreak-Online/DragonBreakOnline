'use strict';
// gamemode.js isPlacedGold / placedGoldRefused: plugin-placed gold (Gold001 or a gold-pile MISC) is refused, a dropped
// (dynamic) stack and other items are not. Run from the server folder: node tests/placed-gold-harness.js
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const GM = fs.readFileSync(path.join(__dirname, '..', 'gamemode.js'), 'utf8');
const code = GM.slice(GM.indexOf('const placedGoldBase = new Map();'), GM.indexOf('// Review of acf20eac'));
const bases = { 0x10a: 'f:Skyrim.esm', 0x10b: '1234:Riften Expansion.esp', 0x10c: '5678:Skyrim.esm', 0xff000010: 'f:Skyrim.esm',
  0x10d: 'd7b0d:Skyrim.esm', 0x10e: '9999:Summerset.esp', 0x10f: '7777:Baan.esp' };
const ids = { 'f:Skyrim.esm': 0xf, '1234:Riften Expansion.esp': 0x22001234, '5678:Skyrim.esm': 0x5678, 'd7b0d:Skyrim.esm': 0xd7b0d, '9999:Summerset.esp': 0x33009999, '7777:Baan.esp': 0x44007777 };
const modl = (p) => [{ type: 'MODL', data: new Uint8Array([...p].map((c) => c.charCodeAt(0)).concat([0])) }];
const recs = { 0x22001234: { record: { type: 'MISC', editorId: 'RFX_CoinPile01' } }, 0x5678: { record: { type: 'MISC', editorId: 'Lantern' } },
  // Nate, 18 Oct: coin purses are harvested again (flora with a coin bag model), gold piles stay refused
  0xd7b0d: { record: { type: 'FLOR', editorId: 'CoinPurseMedium', fields: modl('Clutter\\CoinPurse\\CoinBagMed.nif') } },
  0x33009999: { record: { type: 'FLOR', editorId: 'SummersetCoinStack', fields: modl('Clutter\\Coins\\CoinStack01.nif') } },
  0x44007777: { record: { type: 'FLOR', editorId: 'CoinPurseSmallScarab', fields: modl('Clutter\\CoinBagSmall.nif') } } };
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
t('a coin purse (flora, coin bag model) is not placed gold: it is harvested (__dboCoinPurse)', () => assert.strictEqual(g.isPlacedGold(0x10d), false));
t('...a mod purse by its coin bag model too', () => assert.strictEqual(g.isPlacedGold(0x10f), false));
t('a coin stack that is flora is still placed gold, refused', () => assert.strictEqual(g.isPlacedGold(0x10e), true));
t('placedGold.pickup true turns it off', () => assert.strictEqual(mk({ placedGold: { pickup: true } }).isPlacedGold(0x10a), false));
console.log(`${n}/9 passed`); process.exit(n === 9 ? 0 : 1);
