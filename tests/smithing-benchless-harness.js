// smithing.js judges a creation recipe with no workbench keyword (no BNAM) as forge work (#bugs 1562992015346499634,
// 23 Oct). Sentinel.esp ships 238 such recipes. The fork offers them only at a smithing forge (CraftService.cpp
// ConsiderRecipeCandidate: bench keyword 0 counts as CraftingSmithingForge 0x88105, since 25 Sep), but isForgeRecipe
// judged only a recipe whose BNAM names a Forge or Dawnguard keyword, so __dboSmithCraft let every one of them on before
// the craft tier and the technique: Noble, Gilded and Gilded Noble Ebony were forged without the Ebony schematic.
// Part 1 (always): Sentinel.esp's 22 Noble and Gilded Ebony recipes as the plugin holds them (no BNAM), through the real
// regions.js craft hook and smithing.js with the real config, smithing.json, loot-materials.json and faction-gear.json;
// the F3 Blacksmith tab lists them under Ebony.
// Part 2 (when /opt/skyrim-data, or DBO_SKYRIM_DATA, is readable): every winning COBJ of the live load order, read-only
// (only the COBJ and KYWD groups are read): a benchless recipe of a classified item is judged as at a forge, one of an
// unclassified item (on 23 Oct 36: Sentinel's Stormcloak pieces, More Craftable Equipment's hoods, USSEP's Jarl gloves,
// Imperial Bow and Bone Hawk Ring, Dragonborn's two Cultist recipes) still passes, and recipes with a bench keyword are
// judged as before. LIST=1 prints every benchless recipe.
//   node tests/smithing-benchless-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 600)}`); if (!c) fails++; };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(SERVER, f), 'utf8'));
const CONFIG = readJson('gamemode-config.json');
const LM = readJson('loot-materials.json').items || {};
const TABLE = readJson('smithing.json');
const FAMS = new Map(TABLE.families.map((f) => [f.id, f]));
const FG = new Set(Object.keys(readJson('faction-gear.json').items || {}).map((k) => k.toLowerCase()));
const normDesc = (d) => { const s = String(d || '').toLowerCase(); const i = s.indexOf(':'); return i < 0 ? s : (parseInt(s.slice(0, i), 16) || 0).toString(16) + s.slice(i); };
const NAMES = new Map();   // display names (admin-items.json), for the F3 tab
for (const c of readJson('admin-items.json').categories || []) for (const it of c.items || []) if (Array.isArray(it) && it[0]) NAMES.set(normDesc(it[0]), String(it[1] || ''));
// As smithing.js familyOfItem: the product's family, none for a factionExempt family's faction gear
const familyOf = (desc) => { const k = normDesc(desc); const f = FAMS.get(LM[k]) || null; return f && f.factionExempt && FG.has(k) ? null : f; };

// ---- the plugins, read-only -------------------------------------------------------------------------------------------
const DATA = process.env.DBO_SKYRIM_DATA || '/opt/skyrim-data';
const readable = (() => { try { fs.accessSync(path.join(DATA, 'loadorder.txt'), fs.constants.R_OK); return true; } catch (e) { return false; } })();
const subrecords = (buf) => {
  const out = []; let i = 0, big = null;
  while (i + 6 <= buf.length) {
    const type = buf.toString('latin1', i, i + 4); let size = buf.readUInt16LE(i + 4); i += 6;
    if (type === 'XXXX') { big = buf.readUInt32LE(i); i += size; continue; }
    if (big !== null) { size = big; big = null; }
    out.push({ type, data: buf.subarray(i, i + size) }); i += size;
  }
  return out;
};
const readAt = (fd, pos, n) => { const b = Buffer.alloc(n); const got = fs.readSync(fd, b, 0, n, pos); return got === n ? b : b.subarray(0, got); };
// A plugin's masters and the records of the wanted top groups (other groups are skipped by their size, never read)
const readPlugin = (file, want) => {
  const fd = fs.openSync(file, 'r');
  try {
    const end = fs.fstatSync(fd).size;
    const h = readAt(fd, 0, 24);
    if (h.toString('latin1', 0, 4) !== 'TES4') throw new Error(`${file}: not a plugin`);
    const hsize = h.readUInt32LE(4);
    const masters = subrecords(readAt(fd, 24, hsize)).filter((s) => s.type === 'MAST').map((s) => s.data.toString('latin1').replace(/\0[\s\S]*$/, ''));
    const recs = [];
    for (let pos = 24 + hsize; pos + 24 <= end;) {
      const g = readAt(fd, pos, 24);
      if (g.toString('latin1', 0, 4) !== 'GRUP') break;
      const gsize = g.readUInt32LE(4), label = g.toString('latin1', 8, 12);
      if (want.has(label)) {
        const body = readAt(fd, pos + 24, gsize - 24);
        for (let i = 0; i + 24 <= body.length;) {
          const type = body.toString('latin1', i, i + 4), size = body.readUInt32LE(i + 4);
          if (type === 'GRUP') { i += size; continue; }
          const flags = body.readUInt32LE(i + 8), fid = body.readUInt32LE(i + 12);
          let d = body.subarray(i + 24, i + 24 + size);
          if (flags & 0x40000) d = zlib.inflateSync(d.subarray(4));
          recs.push({ type, flags, fid, subs: flags & 0x20 ? [] : subrecords(d) });
          i += 24 + size;
        }
      }
      pos += gsize;
    }
    return { masters, recs };
  } finally { fs.closeSync(fd); }
};

const ORDER = readable
  ? fs.readFileSync(path.join(DATA, 'loadorder.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim().replace(/^\*/, '')).filter((l) => l && !l.startsWith('#'))
  : ['Skyrim.esm', 'Sentinel.esp'];
const INDEX = new Map(ORDER.map((p, i) => [p.toLowerCase(), i]));
const gid = (plugin, local) => { const i = INDEX.get(String(plugin).toLowerCase()); return i === undefined ? 0 : (i * 0x1000000 + (local & 0xffffff)) >>> 0; };
const descOfId = (id) => `${((id >>> 0) & 0xffffff).toString(16)}:${ORDER[(id >>> 0) >>> 24]}`;
const records = new Map();   // global id -> { record: { type, editorId, fields }, toGlobalRecordId }, the winning version
const put = (id, type, editorId, fields, toGlobal) => records.set(id >>> 0, { record: { type, editorId, fields }, toGlobalRecordId: toGlobal || ((v) => v >>> 0) });
const u32le = (b) => (b && b.length >= 4 ? b.readUInt32LE(0) : 0);
const buf32 = (...v) => { const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeUInt32LE(x >>> 0, i * 4)); return b; };
const cnto = (id, n) => { const b = Buffer.alloc(8); b.writeUInt32LE(id >>> 0, 0); b.writeInt32LE(n, 4); return b; };

// Sentinel.esp's Noble, Gilded and Gilded Noble Ebony recipes (read from /opt/skyrim-data/Sentinel.esp on 23 Oct): recipe,
// editor id, product, inputs (Skyrim.esm: 5ad9d Ebony Ingot, 5ad9e Gold Ingot, 800e4 Leather Strips). No BNAM; each also
// carries a HasPerk EbonySmithing condition (the fork's craftPerkTiers), which smithing.js does not read
const EBONY_FIXTURE = [
  ['c25', 'RecipeArmorTH_Ebony1Boots', '889', [['5ad9d',3],['800e4',2]]],   // Noble Ebony Boots
  ['c26', 'RecipeArmorTH_Ebony1Cuirass', '88a', [['5ad9d',5],['800e4',3]]],   // Noble Ebony Armor
  ['c27', 'RecipeArmorTH_Ebony1Gauntlets', '88b', [['5ad9d',2],['800e4',2]]],   // Noble Ebony Gauntlets
  ['c28', 'RecipeArmorTH_Ebony1Helmet', '88c', [['5ad9d',3],['800e4',2]]],   // Noble Ebony Helmet
  ['c29', 'RecipeArmorTH_Ebony1Shield', '88d', [['5ad9d',4],['800e4',1]]],   // Noble Ebony Shield
  ['c2a', 'RecipeArmorTH_Ebony2Boots', '88e', [['5ad9d',3],['5ad9e',1],['800e4',2]]],   // Gilded Ebony Boots
  ['c2b', 'RecipeArmorTH_Ebony2Cuirass', '88f', [['5ad9d',5],['5ad9e',1],['800e4',3]]],   // Gilded Ebony Armor
  ['c2c', 'RecipeArmorTH_Ebony2Gauntlets', '890', [['5ad9d',2],['5ad9e',1],['800e4',2]]],   // Gilded Ebony Gauntlets
  ['c2d', 'RecipeArmorTH_Ebony2Helmet', '891', [['5ad9d',3],['5ad9e',1],['800e4',2]]],   // Gilded Ebony Helmet
  ['c2e', 'RecipeArmorTH_Ebony2Shield', '892', [['5ad9d',4],['5ad9e',1],['800e4',1]]],   // Gilded Ebony Shield
  ['c2f', 'RecipeArmorTH_Ebony3Boots', '893', [['5ad9d',3],['5ad9e',1],['800e4',2]]],   // Gilded Noble Ebony Boots
  ['c30', 'RecipeArmorTH_Ebony3Cuirass', '894', [['5ad9d',5],['5ad9e',1],['800e4',3]]],   // Gilded Noble Ebony Armor
  ['c31', 'RecipeArmorTH_Ebony3Gauntlets', '895', [['5ad9d',2],['5ad9e',1],['800e4',2]]],   // Gilded Noble Ebony Gauntlets
  ['c32', 'RecipeArmorTH_Ebony3Helmet', '896', [['5ad9d',3],['5ad9e',1],['800e4',2]]],   // Gilded Noble Ebony Helmet
  ['c33', 'RecipeArmorTH_Ebony3Shield', '897', [['5ad9d',4],['5ad9e',1],['800e4',1]]],   // Gilded Noble Ebony Shield
  ['c4e', 'RecipeWeaponTH_Ebony2Sword', 'b19', [['5ad9d',2],['5ad9e',1],['800e4',1]]],   // Gilded Ebony Sword
  ['c4f', 'RecipeWeaponTH_Ebony2WarAxe', 'b1a', [['5ad9d',2],['5ad9e',1],['800e4',2]]],   // Gilded Ebony War Axe
  ['c50', 'RecipeWeaponTH_Ebony2Mace', 'b1b', [['5ad9d',3],['5ad9e',1],['800e4',1]]],   // Gilded Ebony Mace
  ['c51', 'RecipeWeaponTH_Ebony2Dagger', 'b1c', [['5ad9d',1],['5ad9e',1],['800e4',1]]],   // Gilded Ebony Dagger
  ['c52', 'RecipeWeaponTH_Ebony2GreatSword', 'b1d', [['5ad9d',5],['5ad9e',1],['800e4',3]]],   // Gilded Ebony Greatsword
  ['c53', 'RecipeWeaponTH_Ebony2BattleAxe', 'b1e', [['5ad9d',5],['5ad9e',1],['800e4',2]]],   // Gilded Ebony Battleaxe
  ['c54', 'RecipeWeaponTH_Ebony2Warhammer', 'b1f', [['5ad9d',5],['5ad9e',1],['800e4',3]]],   // Gilded Ebony Warhammer
];

let loaded = 0;
if (readable) {
  const t0 = Date.now();
  for (const name of ORDER) {
    const file = path.join(DATA, name);
    const { masters, recs } = readPlugin(file, new Set(['COBJ', 'KYWD']));
    const toGlobal = (v) => { v >>>= 0; const i = v >>> 24; return gid(i < masters.length ? masters[i] : name, v & 0xffffff); };
    for (const r of recs) {
      const id = toGlobal(r.fid);
      if (!id) continue;
      if (r.flags & 0x20) { records.delete(id); continue; }
      const edid = (r.subs.find((s) => s.type === 'EDID') || { data: Buffer.alloc(0) }).data.toString('latin1').replace(/\0[\s\S]*$/, '');
      put(id, r.type, edid, r.subs, toGlobal);
    }
    loaded++;
  }
  console.log(`read the COBJ and KYWD groups of ${loaded} plugins in ${Date.now() - t0} ms`);
}
if (!readable) {
  console.log(`SKIP  re-reading the plugins: ${DATA} is not readable here; part 1 runs on the fixture`);
  const S_ = 'Sentinel.esp';
  for (const [r, edid, p, inputs] of EBONY_FIXTURE) {
    put(gid(S_, parseInt(r, 16)), 'COBJ', edid, [{ type: 'EDID', data: Buffer.from(edid + '\0', 'latin1') }, ...inputs.map(([i, n]) => ({ type: 'CNTO', data: cnto(gid('Skyrim.esm', parseInt(i, 16)), n) })),
      { type: 'CNAM', data: buf32(gid(S_, parseInt(p, 16))) }]);
  }
}
if (!records.has(gid('Skyrim.esm', 0x88105))) put(gid('Skyrim.esm', 0x88105), 'KYWD', 'CraftingSmithingForge', []);

// The creation recipes the fork can match (CraftService RecipeItemsMatch: a product, and not a temper at the armour table
// or the grindstone), each with its raw bench keyword
const fieldOf = (r, type) => (r.record.fields || []).find((s) => s && s.type === type);
const CREATION = [];
for (const [id, r] of records) {
  if (r.record.type !== 'COBJ') continue;
  const cn = u32le((fieldOf(r, 'CNAM') || {}).data); if (!cn) continue;
  const product = r.toGlobalRecordId(cn) >>> 0; if (!product) continue;
  const raw = u32le((fieldOf(r, 'BNAM') || {}).data);
  const bench = raw ? r.toGlobalRecordId(raw) >>> 0 : 0;
  if (bench === gid('Skyrim.esm', 0xadb78) || bench === gid('Skyrim.esm', 0x88108)) continue;
  const kw = bench ? records.get(bench) : null;
  const desc = descOfId(product);
  CREATION.push({ id, edid: r.record.editorId, plugin: ORDER[id >>> 24], product, desc, name: NAMES.get(normDesc(desc)) || '', bench, benchEdid: kw ? String(kw.record.editorId || '') : '', fam: familyOf(desc) });
}
const BENCHLESS = CREATION.filter((c) => !c.bench);
const CLASSIFIED = BENCHLESS.filter((c) => c.fam), UNCLASSIFIED = BENCHLESS.filter((c) => !c.fam);
const FORGE_RX = /Forge|Dawnguard/i;
const NOBLE = /^(Noble|Gilded|Gilded Noble) Ebony /;
const EBONY_SET = CLASSIFIED.filter((c) => c.plugin === 'Sentinel.esp' && /^Recipe(Armor|Weapon)TH_Ebony/.test(c.edid));
if (process.env.LIST) {
  const by = new Map();
  for (const c of CLASSIFIED) by.set(c.fam.id, (by.get(c.fam.id) || []).concat([c]));
  for (const [f, list] of [...by].sort((x, y) => FAMS.get(x[0]).tier - FAMS.get(y[0]).tier || x[0].localeCompare(y[0]))) {
    const fam = FAMS.get(f);
    console.log(`LIST  ${f} (T${fam.tier}${fam.held ? ', held' : ''}${fam.free ? ', free' : ''}${fam.technique ? ', technique ' + fam.technique : ''}${fam.book ? ', book ' + fam.book : ''}): ${list.length}`);
    for (const c of list) console.log(`LIST      ${c.plugin} ${(c.id & 0xffffff).toString(16)} ${c.edid} -> ${c.desc} ${c.name}`);
  }
  const up = new Map(); for (const c of UNCLASSIFIED) up.set(c.plugin, (up.get(c.plugin) || 0) + 1);
  console.log(`LIST  unclassified benchless by plugin: ${JSON.stringify([...up])}`);
  for (const c of UNCLASSIFIED) console.log(`LIST      unclassified ${c.plugin} ${(c.id & 0xffffff).toString(16)} ${c.edid} -> ${c.desc} ${c.name}`);
  for (const c of EBONY_SET) {
    const r = records.get(c.id);
    const ins = (r.record.fields || []).filter((s) => s.type === 'CNTO').map((s) => [descOfId(r.toGlobalRecordId(s.data.readUInt32LE(0))), s.data.readInt32LE(4)]);
    console.log(`FIXTURE  ['${(c.id & 0xffffff).toString(16)}', '${c.edid}', '${(c.product & 0xffffff).toString(16)}', ${JSON.stringify(ins.map(([d, n]) => [d.split(':')[0], n])).replace(/"/g, "'")}],   // ${c.name}`);
  }
}
console.log(`benchless creation recipes: ${BENCHLESS.length} (${CLASSIFIED.length} of a classified item, ${UNCLASSIFIED.length} not); Sentinel.esp ${BENCHLESS.filter((c) => c.plugin === 'Sentinel.esp').length}`);
{ const by = new Map(); for (const c of CLASSIFIED) by.set(c.fam.id, (by.get(c.fam.id) || 0) + 1); console.log(`  by family: ${[...by].sort((x, y) => FAMS.get(x[0]).tier - FAMS.get(y[0]).tier || y[1] - x[1]).map(([f, k]) => `${f} T${FAMS.get(f).tier} ${k}`).join(', ')}`); }

// ---- the real modules -------------------------------------------------------------------------------------------------
const RACES = { NordRace: 0x13746, OrcRace: 0x13747, DarkElfRace: 0x13742, RedguardRace: 0x13748, KhajiitRace: 0x13745 };
for (const [e, h] of Object.entries(RACES)) put(gid('Skyrim.esm', h), 'RACE', e, []);
const props = new Map(), said = [], audits = [], chain = [];
const mp = {
  get: (a, k) => props.get(`${a >>> 0}|${k}`), set: (a, k, v) => props.set(`${a >>> 0}|${k}`, v),
  getDescFromId: descOfId,
  getIdFromDesc: (d) => { const s = String(d); const i = s.indexOf(':'); return i < 0 ? 0 : gid(s.slice(i + 1), parseInt(s.slice(0, i), 16)); },
  lookupEspmRecordById: (id) => records.get(id >>> 0) || null,
  getEspmRecordIdsByType: (t) => { const out = []; for (const [id, r] of records) if (r.record.type === t) out.push(id); return out; },
  callPapyrusFunction: () => null,
};
const ALL = Object.fromEntries(TABLE.families.map((f) => [f.id, { at: 1, how: 'staff' }]));
const NO_EBONY = Object.assign({}, ALL); delete NO_EBONY.EBONY;
const ACT = {}; let next = 0x101;
const actor = (key, points, knows) => {
  const a = ACT[key] = (0xff000000 | next++) >>> 0;
  if (points !== null) props.set(`${a}|private.mastery`, { order: ['blacksmith'], skills: { blacksmith: { level: points, rank: 0 } } });
  props.set(`${a}|private.dboManuals`, knows); props.set(`${a}|private.dboSmithCarried`, { at: 1 });
  props.set(`${a}|appearance`, { raceId: gid('Skyrim.esm', RACES.NordRace) }); props.set(`${a}|profileId`, next);
  props.set(`${a}|worldOrCellDesc`, 'a764b:BSHeartland.esm'); props.set(`${a}|pos`, [next * 100000, 0, 0]); props.set(`${a}|inventory`, { entries: [] });
};
actor('novice', null, {});              // no Blacksmith skill: craft tier 0
actor('master', 100, ALL);              // craft tier 7, every technique
actor('noEbony', 100, NO_EBONY);        // craft tier 7, every technique but Ebony
actor('ebony6', 76, { EBONY: { at: 1, how: 'book' } });   // craft tier 6, has read Schematics: Ebony
actor('ebony5', 60, { EBONY: { at: 1, how: 'book' } });   // craft tier 5, has read it too
const api = {
  mp, log: () => {}, personal: (a, t) => said.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `P${(a >>> 0).toString(16)}`, display: (a) => `P${(a >>> 0).toString(16)}`,
  cfg: { smithing: Object.assign({}, CONFIG.smithing, { enabled: true }), regions: Object.assign({}, CONFIG.regions, { craft: true }), raceCraft: CONFIG.raceCraft, orcishCraft: CONFIG.orcishCraft },
  registerChatCommand: () => {}, isAdmin: () => false, sendPacket: () => true, onlineActors: () => Object.values(ACT), findByName: () => 0,
  itemName: (d) => NAMES.get(normDesc(d)) || '',
};
for (const k of Object.keys(globalThis)) if (/^__dbo(Smith|TemperCap|PrevCraft|FactionCraft|FactionGear|TailorCraft|Regions)/.test(k)) delete globalThis[k];
process.chdir(SERVER);   // both modules only read their tables
mp.onCraft = (a, it, k, r) => { chain.push(r); return undefined; };
require(path.join(SERVER, 'smithing.js'))(api);
require(path.join(SERVER, 'regions.js'))(api);
clearInterval(globalThis.__dboSmithCarryTimer);
// The gate alone, and the whole craft hook as the fork calls it (true: the craft reached the rest of the chain)
const gate = (who, c) => { globalThis.__dboSmithState.told.clear(); return globalThis.__dboSmithCraft(ACT[who], c.product, c.id) !== false; };
const craft = (who, c) => { chain.length = 0; said.length = 0; globalThis.__dboSmithState.told.clear(); const v = mp.onCraft(ACT[who], c.product, 1, c.id); return v !== false && chain.includes(c.id); };
const lastSaid = (who) => { const s = said.filter(([a]) => a === ACT[who]); return s.length ? s[s.length - 1][1] : ''; };
const show = (list) => list.slice(0, 8).map((c) => [c.edid, c.desc, c.name, c.fam && c.fam.id]);

// ---- part 1: Noble, Gilded and Gilded Noble Ebony ---------------------------------------------------------------------
ok(EBONY_SET.length === 22 && EBONY_SET.every((c) => c.fam && c.fam.id === 'EBONY' && NOBLE.test(c.name)),
  `data: Sentinel.esp's 22 Noble, Gilded and Gilded Noble Ebony recipes have no bench keyword and make EBONY items (${EBONY_SET.length})`, show(EBONY_SET.filter((c) => !(c.fam && c.fam.id === 'EBONY' && NOBLE.test(c.name)))));
if (readable) {
  const drift = EBONY_FIXTURE.filter(([r, edid, p, inputs]) => {
    const c = EBONY_SET.find((x) => (x.id & 0xffffff) === parseInt(r, 16));
    if (!c || c.edid !== edid || (c.product & 0xffffff) !== parseInt(p, 16)) return true;
    const rec = records.get(c.id);
    const ins = (rec.record.fields || []).filter((s) => s.type === 'CNTO').map((s) => `${descOfId(rec.toGlobalRecordId(s.data.readUInt32LE(0)))}x${s.data.readInt32LE(4)}`).join(',');
    return ins !== inputs.map(([i, n]) => `${i}:Skyrim.esmx${n}`).join(',');
  });
  ok(EBONY_FIXTURE.length === EBONY_SET.length && !drift.length, 'the fixture is what the live Sentinel.esp holds (recipe, editor id, product, inputs)', drift);
}
const EB = FAMS.get('EBONY') || {};
ok(EB.tier === 6 && EB.held === true, 'smithing.json: Ebony is craft tier 6 and held (its schematic is the only way to learn it)', EB);
{
  const out = EBONY_SET.filter((c) => craft('noEbony', c) || !/Schematics: Ebony/.test(lastSaid('noEbony')) || !/materials come back/.test(lastSaid('noEbony')));
  ok(!out.length, 'a craft tier 7 smith without the Ebony schematic is refused all 22 at the forge, told the schematic is the way, materials kept', show(out));
  ok(audits.some((t) => /^SMITH refused P[0-9a-f]+ Ebony \(tier 6, crafter tier 7\): technique unknown$/.test(t)), '...and each refusal is audited as SMITH refused, with none of the notice', audits.slice(-3));
}
{
  const out = EBONY_SET.filter((c) => craft('ebony5', c) || !/Ebony is craft tier 6/.test(lastSaid('ebony5')));
  ok(!out.length, 'a craft tier 5 smith who has read the schematic is refused them: Ebony is craft tier 6 work', show(out));
}
ok(EBONY_SET.every((c) => !craft('novice', c)), 'a character without the Blacksmith skill is refused them, as at any forge');
{
  const out = EBONY_SET.filter((c) => !craft('ebony6', c));
  ok(EBONY_SET.length && !out.length, 'a craft tier 6 smith with the Ebony schematic still forges all 22 through the whole craft hook', show(out));
  ok(EBONY_SET.every((c) => craft('master', c)), '...as does a master smith who knows every technique');
}
{
  const view = globalThis.__dboSmithView(ACT.ebony6);
  const eb = view && view.families.find((f) => f.id === 'EBONY');
  const listed = new Set(eb ? eb.recipes : []);
  const out = EBONY_SET.filter((c) => !listed.has(c.name));
  ok(!!eb && EBONY_SET.length && !out.length, 'the F3 Blacksmith tab lists the 22 under Ebony', show(out));
}

// ---- part 2: every recipe of the live load order ----------------------------------------------------------------------
if (readable) {
  const sentinel = BENCHLESS.filter((c) => c.plugin === 'Sentinel.esp');
  ok(sentinel.length === 238, `data: Sentinel.esp has 238 benchless creation recipes the fork can match (${sentinel.length})`);
  {
    const out = BENCHLESS.filter((c) => gate('novice', c) !== !c.fam);
    ok(!out.length, `every benchless recipe of a classified item (${CLASSIFIED.length}) is refused to a character without the Blacksmith skill, as at a forge; every one of an unclassified item (${UNCLASSIFIED.length}) still passes`, show(out));
  }
  {
    const techOf = (f) => (f.technique && FAMS.get(f.technique)) || f;
    const out = BENCHLESS.filter((c) => gate('noEbony', c) !== !(c.fam && techOf(c.fam).id === 'EBONY'));
    ok(!out.length, 'a craft tier 7 smith without the Ebony schematic is refused exactly the benchless Ebony recipes and makes every other one', show(out));
  }
  {
    const out = BENCHLESS.filter((c) => !gate('master', c));
    ok(!out.length, `a master smith who knows every technique makes every one of the ${BENCHLESS.length} benchless recipes`, show(out));
  }
  {
    const benched = CREATION.filter((c) => c.bench);
    const atForge = (c) => FORGE_RX.test(c.benchEdid);
    const out = benched.filter((c) => gate('novice', c) !== !(atForge(c) && c.fam));
    const n = benched.filter(atForge).length;
    ok(benched.length && !out.length, `recipes with a bench keyword are judged as before: ${n} at a forge by their family, ${benched.length - n} at other benches (smelter, tanning rack, loom, cookpot...) pass`, show(out));
  }
  {
    const plain = UNCLASSIFIED.filter((c) => c.plugin === 'Sentinel.esp');
    const out = plain.filter((c) => !craft('novice', c));
    ok(!out.length, `Sentinel.esp's ${plain.length} benchless recipes of unclassified items still craft through the whole hook for anyone`, show(out));
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
