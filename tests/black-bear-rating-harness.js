// Black Bear Ancient Nord armour rebalanced to its craft tier (Nate, 16 Oct: "Black Bear armour is stronger than the other
// racial sets"). Black Bear is craft tier 3 (smithing.json black_bear); its light pieces (35/10/10/20, the hood helmet 18)
// beat Scaled, the tier 3 light ladder (32/9/9/14), and the tier 4 Apex Khajiit light set (32/9/9/14), close to Glass
// (38/11/11/16); its heavy cuirass (43) sits above the approved Nordic 41 (tools/materials/ladder.tsv). Config
// armorMaterials.ratingByEditorId counts those pieces at the ladder's numbers (gamemode.js armorPieceOf, lifted and run
// against stub records carrying the plugin's own ratings, read from Black Bear Ancient Nord Armor.esp on CT 115, 16 Oct),
// and the hit counts them so (defenseDamageMult, lifted). The PC patches the same numbers into Nexus Patches.
//   node tests/black-bear-rating-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');

// The plugin's pieces: editor id, rating in the record, heavy, slot mask, the rating the server should count
const BEAR = [
  ['BlackBearAncientNordCuirass', 43, true, 0x4, 41], ['BlackBearAncientNordGauntlets', 15, true, 0x8, 15], ['BlackBearAncientNordBoots', 15, true, 0x80, 15],
  ['BlackBearAncientNordHelmet', 20, true, 0xb002, 20], ['BlackBearAncientNordHood', 18, true, 0xb002, 18], ['BlackBearAncientNordLoweredHood', 15, true, 0x8000, 15],
  ['BlackBearAncientNordShield', 27, true, 0x200, 27],
  ['BlackBearAncientNordCuirassLight', 35, false, 0x4, 32], ['BlackBearAncientNordCuirassBerserker', 35, false, 0x4, 32],
  ['BlackBearAncientNordGauntletsLight', 10, false, 0x8, 9], ['BlackBearAncientNordGauntletsBerserker', 10, false, 0x8, 9],
  ['BlackBearAncientNordBootsLight', 10, false, 0x80, 9], ['BlackBearAncientNordBootsBerserker', 10, false, 0x80, 9],
  ['BlackBearAncientNordHelmetBerserker', 20, false, 0xb002, 14], ['BlackBearAncientNordHelemtHoodLight', 18, false, 0xb002, 14],
  ['BlackBearAncientNordHoodLight', 10, false, 0xb002, 10], ['BlackBearAncientNordLoweredHoodLight', 10, false, 0x8000, 10],
];
// Peers, as the live records give them (16 Oct): Scaled (T3 light), Apex Khajiit (T4), Glass (T5 light), Orcish (T3 heavy)
const PEERS = [['ArmorScaledCuirass', 32, false, 0x4], ['ArmorScaledGauntlets', 9, false, 0x8], ['ArmorScaledBoots', 9, false, 0x80], ['ArmorScaledHelmet', 14, false, 0x1002],
  ['KhajiitiApexCuirass', 32, false, 0x4], ['KhajiitiApexGauntlets', 9, false, 0x8], ['KhajiitiApexBoots', 9, false, 0x80], ['KhajiitiApexHelmet', 14, false, 0x3003],
  ['ArmorGlassCuirass', 38, false, 0x4], ['ArmorGlassGauntlets', 11, false, 0x8], ['ArmorGlassBoots', 11, false, 0x80], ['ArmorGlassHelmet', 16, false, 0x1002],
  ['ArmorOrcishCuirass', 40, true, 0x4], ['KhajiitiApexCuirassHeavy', 40, true, 0x4]];

const table = (cfg.armorMaterials || {}).ratingByEditorId || {};
const named = Object.keys(table).filter((k) => k[0] !== '_');
ok(named.length === 9 && named.every((k) => BEAR.some(([e, r, , , want]) => e === k && want !== r && table[k] === want)), 'config names the 9 Black Bear pieces that change, each at its new rating', table);
ok(named.every((k) => /^BlackBearAncientNord/.test(k)), '...and nothing else');

// ---- the lifted armorPieceOf --------------------------------------------------------------------------------------
const i = gm.indexOf('const ARMOR_MATERIALS = '), j = gm.indexOf('  armorPieceCache.set(baseId, piece);\n  return piece;\n};', i);
ok(i > 0 && j > i, 'gamemode.js has the armor material table');
const src = gm.slice(i, j) + '  armorPieceCache.set(baseId, piece);\n  return piece;\n};';
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const bytes = (...ns) => { const b = new Uint8Array(4 * ns.length); ns.forEach((n, k) => new DataView(b.buffer).setUint32(4 * k, n, true)); return b; };
const RECS = {}, ID = {};
let next = 0x1000;
for (const [edid, rating, heavy, mask] of BEAR.concat(PEERS)) {
  ID[edid] = ++next;
  RECS[next] = { record: { type: 'ARMO', editorId: edid, fields: [{ type: 'DNAM', data: u32(rating * 100) }, { type: 'BOD2', data: bytes(mask, heavy ? 1 : 0) }] }, toGlobalRecordId: (l) => l };
}
const fieldsOf = (lr, t) => ((lr && lr.record.fields) || []).filter((f) => f.type === t);
const u32At = (f, off) => (f && f.data.byteLength >= off + 4 ? new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(off, true) : 0);
const globalAt = (lr, local) => (local ? lr.toGlobalRecordId(local) >>> 0 : 0);
const lift = (c) => new Function('cfg', 'recordOf', 'fieldsOf', 'u32At', 'globalAt', `${src}\nreturn armorPieceOf;`)(c, (x) => RECS[x] || null, fieldsOf, u32At, globalAt);
delete globalThis.__dboArmorPiece4; delete globalThis.__dboArmorPiece4Key;
const piece = lift(cfg);
for (const [edid, rating, , , want] of BEAR) {
  const p = piece(ID[edid]);
  ok(p && p.rating === rating && p.counted === want, `${edid}: the record's ${rating} counts as ${want}`, p);
}
for (const [edid, rating] of PEERS) ok(piece(ID[edid]).counted === rating, `${edid} unchanged (${rating})`, piece(ID[edid]));
const sum = (names) => names.reduce((n, e) => n + piece(ID[e]).counted, 0);
const bearLight = sum(['BlackBearAncientNordCuirassLight', 'BlackBearAncientNordGauntletsLight', 'BlackBearAncientNordBootsLight', 'BlackBearAncientNordHelmetBerserker']);
const scaled = sum(['ArmorScaledCuirass', 'ArmorScaledGauntlets', 'ArmorScaledBoots', 'ArmorScaledHelmet']);
const apex = sum(['KhajiitiApexCuirass', 'KhajiitiApexGauntlets', 'KhajiitiApexBoots', 'KhajiitiApexHelmet']);
const glass = sum(['ArmorGlassCuirass', 'ArmorGlassGauntlets', 'ArmorGlassBoots', 'ArmorGlassHelmet']);
ok(bearLight === scaled && bearLight <= apex && bearLight < glass, `a full light Black Bear set counts ${bearLight}: Scaled's ${scaled}, no more than Apex Khajiit's ${apex}, below Glass's ${glass} (was 75)`);
ok(piece(ID.BlackBearAncientNordCuirass).counted > piece(ID.ArmorOrcishCuirass).counted && piece(ID.BlackBearAncientNordCuirass).counted === 41, 'the heavy cuirass counts 41: the approved Nordic number, one above Orcish and Apex heavy (40)');

// ---- the hit counts it ----------------------------------------------------------------------------------------------
{
  const a = gm.indexOf('const defenseDamageMult = '), b = gm.indexOf('\n};', a);
  const dsrc = gm.slice(a, b + 3);
  const mult = (worn) => new Function('defensePieceMult', 'wornWithHealth', 'armorPieceOf', 'temperBonus', 'potionBonus', 'gmstFloat', `${dsrc}\nreturn defenseDamageMult;`)(
    () => ({ heavy: 1, light: 1 }), () => worn.map((e) => ({ baseId: ID[e], health: 1 })), piece, () => 0, () => 0, (id, d) => d)(0x14);
  const m = mult(['BlackBearAncientNordCuirassLight', 'BlackBearAncientNordGauntletsLight', 'BlackBearAncientNordBootsLight', 'BlackBearAncientNordHelmetBerserker']);
  // the engine took 75 x 0.12 = 9% off; the server counts 64 (7.68%): 0.9232 / 0.91 = 1.0145 of the engine's hit
  ok(Math.abs(m - (1 - 64 * 0.12 / 100) / (1 - 75 * 0.12 / 100)) < 1e-9 && m > 1, `a hit on a full light set lands ${m.toFixed(4)}x the engine's (64 counted, not 75)`, m);
  ok(mult(['ArmorScaledCuirass', 'ArmorScaledHelmet']) === 1, '...and a Scaled set is untouched (1)');
}

// ---- hot reload: the cache follows the config -----------------------------------------------------------------------
{
  const c2 = JSON.parse(JSON.stringify(cfg)); c2.armorMaterials.ratingByEditorId.BlackBearAncientNordCuirass = 40;
  ok(lift(c2)(ID.BlackBearAncientNordCuirass).counted === 40, 'a changed rating counts at the next reload (the cache is emptied when armorMaterials changes)');
  const c3 = JSON.parse(JSON.stringify(cfg)); delete c3.armorMaterials.ratingByEditorId;
  ok(lift(c3)(ID.BlackBearAncientNordCuirass).counted === 43 && lift(c3)(ID.BlackBearAncientNordHelmetBerserker).counted === 20, 'without the table the records count as before (rollback)');
  const c4 = JSON.parse(JSON.stringify(cfg)); c4.armorMaterials.enabled = false;
  ok(lift(c4)(ID.BlackBearAncientNordCuirassLight).counted === 35, 'armorMaterials.enabled false turns it off with the rest');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
