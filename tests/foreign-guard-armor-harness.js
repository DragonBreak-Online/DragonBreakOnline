// Only Bruma's guard armour works in Cyrodiil (Nate, 12 Oct 2026: "the only guard armor should be bruma in cyrodiil, the
// rest dont work"). The 35 guard pieces of Anvil, Bravil, Cheydinhal, Chorrol, Kvatch, Leyawiin and Skingrad
// (BSHeartland.esm) show no model in game: Roland Ebonshield forged a Chorrol Guard's Armor and Helmet and looked
// invisible and bald in them. regions-overrides.json forgeNever refuses them at every bench (with their own line, not the
// "far stronger" one), loot-overrides.json never keeps them out of loot, and gearstrip.js (config gearStrip, shipped off)
// can take back the ones already made and refund their recipe. Bruma's five pieces stay forgeable.
// Loads the real regions.js, loottiers.js and gearstrip.js with the real data files against fake records.
//   node tests/foreign-guard-armor-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(SERVER, f), 'utf8'));

// The 35 pieces, from the shipping load order (12 Oct scan: winning ARMO records, none overridden)
const CITIES = {
  Anvil: { Cuirass: '723d6', Helmet: '723d7', Boots: '723d5', Gauntlets: 'ddbfe', Shield: '723d8' },
  Bravil: { Cuirass: '723de', Helmet: '723df', Boots: '723dd', Gauntlets: 'ddc0c', Shield: '723e0' },
  Cheydinhal: { Cuirass: 'ddc03', Helmet: 'ddc08', Boots: 'ddc05', Gauntlets: 'ddc07', Shield: 'ddc37' },
  Chorrol: { Cuirass: 'ddbf0', Helmet: 'ddbf8', Boots: 'ddbf2', Gauntlets: 'ddbf4', Shield: 'ddc38' },
  Kvatch: { Cuirass: 'ddbfa', Helmet: 'ddc2e', Boots: 'ddc2d', Gauntlets: 'ddc2c', Shield: 'ddc2f' },
  Leyawiin: { Cuirass: 'ddc12', Helmet: 'ddc17', Boots: 'ddc0e', Gauntlets: 'ddc10', Shield: 'ddc39' },
  Skingrad: { Cuirass: 'ddc00', Helmet: 'ddc01', Boots: 'ddc3b', Gauntlets: 'ddc3c', Shield: 'ddc3a' },
};
const BRUMA = { Cuirass: '723cd', Helmet: '723ce', Boots: '723d0', Gauntlets: 'cc21f', Shield: '723cf' };
const FOREIGN = [];
for (const [city, parts] of Object.entries(CITIES)) for (const [part, h] of Object.entries(parts)) FOREIGN.push({ city, part, h, desc: `${h}:BSHeartland.esm`, edid: `CYRArmorGuard${part}${city}` });
ok(FOREIGN.length === 35, '35 foreign guard pieces under test');

const scratch = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-guardarmor-'));
process.on('exit', () => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
process.chdir(scratch);
for (const f of ['regions.json', 'regions-overrides.json', 'dragon-materials.json', 'artifacts.json', 'skills.json', 'spell-tomes.json']) {
  try { fs.copyFileSync(path.join(SERVER, f), f); } catch (e) { /* optional */ }
}

// ---- data: every piece in forgeNever and loot never; Bruma in neither ------------------------------------------------
const OVR = readJson('regions-overrides.json').forgeNever || {};
const LNEVER = readJson('loot-overrides.json').never || {};
const missingForge = FOREIGN.filter((p) => !OVR[p.desc]).map((p) => p.edid);
ok(!missingForge.length, 'regions-overrides.json forgeNever lists all 35', missingForge);
const missingLoot = FOREIGN.filter((p) => !LNEVER[p.desc]).map((p) => p.edid);
ok(!missingLoot.length, 'loot-overrides.json never lists all 35', missingLoot);
ok(FOREIGN.every((p) => OVR[p.desc] && /only Bruma's guard armor works in Cyrodiil for now/.test(OVR[p.desc].why) && /only Bruma's guard armou?r/.test(OVR[p.desc].told || '')), 'each forgeNever entry gives the reason and its own told line');
ok(FOREIGN.every((p) => LNEVER[p.desc] && /only Bruma's guard armor works in Cyrodiil for now/.test(LNEVER[p.desc])), 'each loot never entry gives the reason');
const brumaListed = Object.values(BRUMA).filter((h) => OVR[`${h}:BSHeartland.esm`] || LNEVER[`${h}:BSHeartland.esm`]);
ok(!brumaListed.length, "Bruma's set is in neither list", brumaListed);
// Every forge recipe regions.json knows for a non-Bruma guard piece is covered (the product is what is refused)
const regionsRecipes = Object.values(readJson('regions.json').recipes || {});
const uncovered = regionsRecipes.filter((r) => r && /^(DBOSM_|DBOSM_Bronze_)?CYRArmorGuard/.test(String(r.edid || '').replace(/^DBOSM_Bronze_/, '').replace(/^DBOSM_/, '')) && !/Bruma/.test(r.edid) && !OVR[r.item]).map((r) => r.edid);
ok(!uncovered.length, 'every non-Bruma guard recipe in regions.json makes a forgeNever product', uncovered);
for (const f of ['faction-gear.json', 'smithing.json']) {
  let txt = ''; try { txt = fs.readFileSync(path.join(SERVER, f), 'utf8'); } catch (e) { /* absent */ }
  const named = FOREIGN.filter((p) => txt.toLowerCase().includes(p.desc.toLowerCase())).map((p) => p.edid);
  ok(!named.length, `${f} names none of them`, named);
}

// ---- the forge: refused to everyone, staff too, tempering too; Bruma forges ---------------------------------------------
const PLUG = { 0x00: 'Skyrim.esm', 0x08: 'BSHeartland.esm', 0x6a: 'DragonBreak Nexus Patches.esp' };
const desc = (id) => `${(id & 0xffffff).toString(16)}:${PLUG[id >>> 24] || 'Skyrim.esm'}`;
const idOfDesc = (d) => { const [h, p] = String(d).split(':'); const ix = Object.keys(PLUG).find((k) => PLUG[k].toLowerCase() === String(p).toLowerCase()); return ((Number(ix || 0) << 24) | parseInt(h, 16)) >>> 0; };
const recs = new Map();
const u32 = (...ids) => { const b = new Uint8Array(ids.length * 4); const dv = new DataView(b.buffer); ids.forEach((v, i) => dv.setUint32(i * 4, v >>> 0, true)); return b; };
const rec = (id, type, editorId, fields = []) => recs.set(id >>> 0, { record: { type, editorId, fields } });
const KW_FORGE = 0x88105, KW_TABLE = 0x88107;
rec(KW_FORGE, 'KYWD', 'CraftingSmithingForge'); rec(KW_TABLE, 'KYWD', 'CraftingSmithingArmorTable');
const idOf = (h) => (0x08000000 | parseInt(h, 16)) >>> 0;
for (const p of FOREIGN) rec(idOf(p.h), 'ARMO', p.edid);
for (const [part, h] of Object.entries(BRUMA)) rec(idOf(h), 'ARMO', `CYRArmorGuard${part}Bruma`);
const R_FORGE = 0x6a00097b, R_TABLE = 0x080ed4a9;
rec(R_FORGE, 'COBJ', 'DBOSM_CYRArmorGuardCuirassChorrol', [{ type: 'BNAM', data: u32(KW_FORGE) }]);
rec(R_TABLE, 'COBJ', 'CYRTemperArmorGuardShieldChorrol', [{ type: 'BNAM', data: u32(KW_TABLE) }]);

const props = new Map(), said = [], audits = [], chain = [];
const mp = {
  getIdFromDesc: idOfDesc, getDescFromId: desc, get: (id, p) => props.get(id + '|' + p), set: (id, p, v) => props.set(id + '|' + p, v),
  lookupEspmRecordById: (id) => recs.get(id >>> 0) || null, callPapyrusFunction: () => null,
};
const PLAYER = 0xff002a82, STAFF = 0xff000202;
for (const a of [PLAYER, STAFF]) { props.set(a + '|worldOrCellDesc', 'a764b:BSHeartland.esm'); props.set(a + '|pos', [0, 0, 0]); props.set(a + '|appearance', { raceId: 0x13746 }); }
globalThis.__dboFactionGearMember = () => false;
globalThis.__dboFactionCraft = () => true;
delete globalThis.__dboSmithCraft; delete globalThis.__dboSmithCrafted; delete globalThis.__dboPrevCraft;
mp.onCraft = (a, item, n, recipe) => { chain.push(recipe); return undefined; };
try {
  require(path.join(SERVER, 'regions.js'))({
    mp, log: () => {}, personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), who: (a) => `P${a.toString(16)}`,
    cfg: { regions: { craft: true, failOpen: true, defaultPlace: 'cyrodiil', adminBypass: true } },
    registerChatCommand: () => {}, isAdmin: (a) => a === STAFF, sendPacket: () => true, openWidget: () => true, closeWidget: () => true,
    onUi: () => {}, onlineActors: () => [], every: () => {}, distanceMeters: () => 0, takeGold: () => false, giveItem: () => true,
    depositToTreasury: (z, n) => n,
  });
} catch (e) { ok(false, 'regions.js loads', e.stack); process.exit(1); }
let t0 = 0;
const craft = (a, item, recipe) => { chain.length = 0; said.length = 0; t0 += 1; return mp.onCraft(a, item, 1, recipe); };
const freshActor = (n) => { const a = (0xff003000 + n) >>> 0; props.set(a + '|worldOrCellDesc', 'a764b:BSHeartland.esm'); props.set(a + '|pos', [0, 0, 0]); props.set(a + '|appearance', { raceId: 0x13746 }); return a; };

const CHORROL_ARMOR = idOf('ddbf0'), CHORROL_HELM = idOf('ddbf8');
ok(craft(PLAYER, CHORROL_ARMOR, R_FORGE) === false, "a player cannot forge the Chorrol Guard's Armor");
ok(!chain.includes(R_FORGE), '...the refused craft never reaches the chain (materials kept, no credit)');
ok(said.some(([a, t]) => a === PLAYER && /Chorrol Guard's Armor/.test(t) && /only Bruma's guard armour/.test(t) && /materials come back/.test(t) && !/stronger than intended/.test(t)), "...and is told the guard-armour reason, not the 'far stronger' one", said);
ok(audits.some((t) => /FORGENEVER craft refused Pff002a82/.test(t) && /ddbf0:bsheartland\.esm/.test(t)), '...and it is audited', audits);
ok(craft(freshActor(1), CHORROL_HELM, R_FORGE) === false && !chain.length, "the Chorrol Guard's Helmet is refused too");
ok(craft(STAFF, CHORROL_ARMOR, R_FORGE) === false && !chain.length, 'staff are refused too');
ok(craft(freshActor(2), idOf('ddc38'), R_TABLE) === false && !chain.length, 'tempering a foreign guard shield at the armour table is refused');
const open = FOREIGN.filter((p, i) => { const a = freshActor(10 + i); return craft(a, idOf(p.h), R_FORGE) !== false || chain.length; }).map((p) => p.edid);
ok(!open.length, 'all 35 are refused at the forge', open);
const brumaRefused = Object.entries(BRUMA).filter(([, h], i) => !(craft(freshActor(100 + i), idOf(h), R_FORGE) !== false && chain.includes(R_FORGE))).map(([p]) => p);
ok(!brumaRefused.length, "Bruma's five pieces still forge", brumaRefused);

// ---- loot: never on any path, even without faction-gear.json --------------------------------------------------------
const tiersOf = (factionGear) => { delete require.cache[path.join(SERVER, 'loottiers.js')]; return require(path.join(SERVER, 'loottiers.js'))({ materials: readJson('loot-materials.json'), factionGear, overrides: readJson('loot-overrides.json'), swap: readJson('gear-swap.json'), cfg: {} }); };
for (const [label, fg] of [['with faction-gear.json', readJson('faction-gear.json')], ['without faction-gear.json', { items: {} }]]) {
  const T = tiersOf(fg);
  const loot = FOREIGN.filter((p) => { const c = T.classOf(p.desc); return c.kind !== 'never' || T.lootable(p.desc); }).map((p) => p.edid);
  ok(!loot.length, `all 35 are never loot ${label}`, loot);
  const brumaNever = Object.values(BRUMA).filter((h) => T.classOf(`${h}:BSHeartland.esm`).why);
  ok(!brumaNever.length, `Bruma's set has no hand-written never ${label}`, brumaNever);
}
const pools = ['loot.json', 'dungeon-pools.json', 'expeditions.json', 'ayleid-loot.json', 'weapon-racks.json', 'starter-grants.json', 'depths.json', 'owned-spawns.json', 'vendors.json', 'gear-swap.json'];
const named = pools.filter((f) => { try { const s = fs.readFileSync(path.join(SERVER, f), 'utf8').toLowerCase(); return FOREIGN.some((p) => s.includes(p.desc.toLowerCase()) || s.includes(p.edid.toLowerCase())); } catch (e) { return false; } });
ok(!named.length, `no loot pool, grant or vendor file names them (${pools.length} files)`, named);

// ---- gearstrip.js: shipped on (12 Oct); on, it strips the 35 and refunds the iron recipe --------------------------------------
const CFG = readJson('gamemode-config.json');
const G = CFG.gearStrip || { items: [] };
// The guard pieces: the items that are taken back (the Giant's Club, swapTo, is exchanged instead)
const GUARD = G.items.filter((it) => !it.swapTo);
ok(G && G.enabled === true, 'gamemode-config gearStrip ships enabled true (Nate, 12 Oct: "yes strip and refund")');
ok(G && GUARD.length === 35 && FOREIGN.every((p) => GUARD.some((it) => it.item === p.desc)) && !G.items.some((it) => Object.values(BRUMA).some((h) => it.item === `${h}:BSHeartland.esm`)), 'gearStrip lists the 35, never Bruma');
const refundOf = (h) => JSON.stringify(((G.items.find((it) => it.item === `${h}:BSHeartland.esm`) || {}).refund || []).map((r) => [r[0], r[1]]));
ok(refundOf('ddbf0') === JSON.stringify([['800e4:Skyrim.esm', 3], ['db5d2:Skyrim.esm', 4]]), "the Chorrol Armor's refund is DBOSM_CYRArmorGuardCuirassChorrol: 3 Leather Strips, 4 Leather", refundOf('ddbf0'));
ok(refundOf('ddbf8') === JSON.stringify([['5ace4:Skyrim.esm', 2], ['800e4:Skyrim.esm', 1]]), "the Chorrol Helmet's refund is DBOSM_CYRArmorGuardHelmetChorrol: 2 Iron Ingots, 1 Leather Strips", refundOf('ddbf8'));
ok(refundOf('ddbf2') === '[]' && refundOf('ddc2c') === '[]', 'boots and gauntlets (no recipe) refund nothing');
ok(GUARD.filter((it) => it.refund.length).length === 14, '14 pieces have a forge recipe to refund');
const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
ok(/__dboSprStripLogin\(a\);[^\n]*\n\s*try \{ if \(globalThis\.__dboGearStripLogin\) globalThis\.__dboGearStripLogin\(a\)/.test(gm), 'gamemode.js: login hook after the SPR strip');
ok(/__dboSprStripContainer\(targetId >>> 0\);[^\n]*\n\s*try \{ if \(globalThis\.__dboGearStripContainer\) globalThis\.__dboGearStripContainer\(targetId >>> 0\)/.test(gm), 'gamemode.js: container hook in the activate chain');
ok(/require\(GEARSTRIP_JS\)\(\{[^}]*giveItem[^}]*\}\)/.test(gm), 'gamemode.js loads gearstrip.js with giveItem');
ok(fs.readFileSync(path.join(SERVER, '.gitignore'), 'utf8').includes('gearstrip-state.json'), 'its state file is gitignored');

const MOD = path.join(SERVER, 'gearstrip.js');
if (!fs.existsSync(MOD)) { ok(false, 'gearstrip.js exists'); console.log(`${fails} failed`); process.exit(1); }
const IRON = 0x5ace4, STRIPS = 0x800e4, LEATHER = 0xdb5d2, OTHER = 0x12eb7, BRUMA_ARMOR = idOf('723cd');
const DESC = { '5ace4:Skyrim.esm': IRON, '800e4:Skyrim.esm': STRIPS, 'db5d2:Skyrim.esm': LEATHER, '601c51:BSAssets.esm': 0x07601c51, '118c:BSHeartland.esm': 0x0800118c };
for (const p of FOREIGN) DESC[p.desc] = idOf(p.h);
const world = () => {
  const P = new Map(); const papyrus = []; const audit = []; const told = [];
  const set = (id, k, v) => { if (!P.has(id)) P.set(id, {}); P.get(id)[k] = JSON.parse(JSON.stringify(v)); };
  const get = (id, k) => { const p = P.get(id); if (!p || !(k in p)) { if (k === 'inventory') throw new Error('not loaded'); return undefined; } return JSON.parse(JSON.stringify(p[k])); };
  return { P, papyrus, audit, told, set, get };
};
const stateFile = path.join(scratch, 'gearstrip-state.json');
const load = (W, online, over) => {
  delete require.cache[MOD];
  let timer = null;
  const giveItem = (a, id, n) => { const inv = W.get(a, 'inventory') || { entries: [] }; const e = inv.entries.find((x) => x.baseId === id); if (e) e.count += n; else inv.entries.push({ baseId: id, count: n }); W.set(a, 'inventory', inv); return true; };
  require(MOD)({
    mp: { get: W.get, set: W.set, getIdFromDesc: (d) => { if (!(d in DESC)) throw new Error('no ' + d); return DESC[d]; }, getDescFromId: (id) => id.toString(16), callPapyrusFunction: (...a) => W.papyrus.push(a) },
    log: () => {}, personal: (a, t) => W.told.push([a, t]), audit: (t) => W.audit.push(t), who: (a) => a.toString(16),
    onlineActors: () => online.slice(), every: (n, ms, fn) => { timer = fn; }, stopTimer: () => { timer = null; }, giveItem,
    cfg: { gearStrip: Object.assign({}, G, { stateFile }, over || {}) }
  });
  return () => timer && timer();
};
const count = (W, id, base) => ((W.get(id, 'inventory') || { entries: [] }).entries.filter((e) => e.baseId === base).reduce((n, e) => n + e.count, 0));

let W = world();
load(W, [], { enabled: false });
ok(globalThis.__dboGearStripLogin === null && globalThis.__dboGearStripContainer === null, 'off (the rollback) it installs no hooks');

// Roland's case: worn Chorrol Armor + Helmet, a Bruma cuirass and an iron ingot of his own
const ROLAND = 0xff002a82, OTHERP = 0xff000601, BOX = 0x0800118c;
W.set(ROLAND, 'profileId', 25); W.set(ROLAND, 'inventory', { entries: [{ baseId: CHORROL_ARMOR, count: 1, worn: true }, { baseId: CHORROL_HELM, count: 1, worn: true }, { baseId: BRUMA_ARMOR, count: 1 }, { baseId: IRON, count: 1 }, { baseId: OTHER, count: 2 }] });
W.set(ROLAND, 'private.lastWorn', [CHORROL_ARMOR, CHORROL_HELM, OTHER]);
W.set(OTHERP, 'profileId', 131); W.set(OTHERP, 'inventory', { entries: [{ baseId: idOf('ddc2d'), count: 1 }] });
W.set(BOX, 'inventory', { entries: [{ baseId: idOf('723d8'), count: 2 }, { baseId: OTHER, count: 1 }] });
let sweep = load(W, [ROLAND, OTHERP], { enabled: true, containers: ['118c:BSHeartland.esm'] });
sweep();
ok(count(W, ROLAND, CHORROL_ARMOR) === 0 && count(W, ROLAND, CHORROL_HELM) === 0, "Roland's Chorrol Armor and Helmet are taken back");
ok(count(W, ROLAND, BRUMA_ARMOR) === 1 && count(W, ROLAND, OTHER) === 2, "his Bruma armour and everything else stay");
ok(count(W, ROLAND, STRIPS) === 4 && count(W, ROLAND, LEATHER) === 4 && count(W, ROLAND, IRON) === 3, 'refund: 4 Leather Strips, 4 Leather, 2 Iron Ingots (on top of his own 1)', [count(W, ROLAND, STRIPS), count(W, ROLAND, LEATHER), count(W, ROLAND, IRON)]);
ok(W.papyrus.filter((c) => c[2] === 'UnequipItem' && c[3].desc === ROLAND.toString(16)).length === 2, 'both worn pieces are unequipped first');
ok(JSON.stringify(W.get(ROLAND, 'private.lastWorn')) === JSON.stringify([OTHER]), 'the remembered outfit drops them');
ok(W.told.some(([a, t]) => a === ROLAND && /Chorrol Guard's Armor/.test(t) && /only Bruma's guard armour/.test(t) && /4 Leather Strips/.test(t)), 'he is told why and what came back', W.told);
ok(count(W, OTHERP, idOf('ddc2d')) === 0 && count(W, OTHERP, IRON) === 0 && count(W, OTHERP, STRIPS) === 0, 'Kvatch boots (no recipe) are taken with no refund');
ok(count(W, BOX, idOf('723d8')) === 0 && count(W, BOX, OTHER) === 1, 'a listed container loses its Anvil shields, nothing else');
let st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
ok(st.removed['ddbf0:BSHeartland.esm'] === 1 && st.removed['723d8:BSHeartland.esm'] === 2 && st.refunded === 2, 'state: removals per item, 2 copies refunded (container copies never)', st);
sweep = load(W, [ROLAND, OTHERP], { enabled: true, containers: ['118c:BSHeartland.esm'] }); sweep(); globalThis.__dboGearStripLogin(ROLAND);
st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
ok(st.refunded === 2 && count(W, ROLAND, IRON) === 3, 'a reload, a second sweep and a login pay nothing twice', st);

// opened container; crafters filter; cap
const BOX2 = 0x08002222; W.set(BOX2, 'inventory', { entries: [{ baseId: CHORROL_HELM, count: 1 }] });
globalThis.__dboGearStripContainer(BOX2);
ok(count(W, BOX2, CHORROL_HELM) === 0, 'an opened container is stripped');
const P3 = 0xff000700; W.set(P3, 'profileId', 77); W.set(P3, 'inventory', { entries: [{ baseId: CHORROL_HELM, count: 1 }] });
load(W, [], { enabled: true, crafters: [25] }); globalThis.__dboGearStripLogin(P3);
ok(count(W, P3, CHORROL_HELM) === 0 && count(W, P3, IRON) === 0, 'with crafters [25], another holder loses the piece with no refund');
W.set(ROLAND, 'inventory', { entries: [{ baseId: CHORROL_HELM, count: 20 }] });
load(W, [], { enabled: true, maxRefunds: 5 }); globalThis.__dboGearStripLogin(ROLAND);
st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
ok(st.refunded === 5 && count(W, ROLAND, IRON) === 6, 'refunds stop at maxRefunds copies in all (5: 3 more helmets, 6 Iron Ingots)', [st.refunded, count(W, ROLAND, IRON)]);
load(W, [], { enabled: true, refundTo: 'none' });
W.set(OTHERP, 'inventory', { entries: [{ baseId: CHORROL_ARMOR, count: 1 }] }); globalThis.__dboGearStripLogin(OTHERP);
ok(count(W, OTHERP, CHORROL_ARMOR) === 0 && count(W, OTHERP, LEATHER) === 0, "refundTo 'none' removes with no refund");
// Nate, 12 Oct: "swap the clubs for steel": the Giant's Club (swapTo) is exchanged one for one for a Steel Warhammer, for any
// holder and in containers, outside crafters and maxRefunds
const CLUB = 0x162f7067, WARHAMMER = 0x1398a;
DESC['2f7067:SurWR.esp'] = CLUB; DESC['1398a:Skyrim.esm'] = WARHAMMER;
ok(G.items.some((it) => it.item === '2f7067:SurWR.esp' && it.swapTo === '1398a:Skyrim.esm'), 'the config lists the Giant\'s Club with swapTo the Steel Warhammer');
const P4 = 0xff000800; W.set(P4, 'profileId', 171); W.set(P4, 'inventory', { entries: [{ baseId: CLUB, count: 1, worn: true }, { baseId: OTHER, count: 1 }] });
W.told.length = 0;
const before = JSON.parse(fs.readFileSync(stateFile, 'utf8')).refunded;
load(W, [], { enabled: true, crafters: [25], maxRefunds: 0 }); globalThis.__dboGearStripLogin(P4);
ok(count(W, P4, CLUB) === 0 && count(W, P4, WARHAMMER) === 1 && count(W, P4, OTHER) === 1, 'a club is exchanged for one Steel Warhammer, crafters and maxRefunds notwithstanding', W.get(P4, 'inventory'));
ok(W.papyrus.some((c) => c[2] === 'UnequipItem' && c[3].desc === P4.toString(16)), 'the worn club is unequipped first');
ok(W.told.some(([a, t]) => a === P4 && /Your Giant's Club has been exchanged for a Steel Warhammer: a giant's club was far stronger/.test(t)), 'the holder is told', W.told);
ok(JSON.parse(fs.readFileSync(stateFile, 'utf8')).refunded === before, 'a swap is no refund');
const BOX3 = 0x08068155; W.set(BOX3, 'inventory', { entries: [{ baseId: CLUB, count: 1 }, { baseId: 0x80aeb00, count: 1 }] });
globalThis.__dboGearStripContainer(BOX3);
ok(count(W, BOX3, CLUB) === 0 && count(W, BOX3, WARHAMMER) === 1 && count(W, BOX3, 0x80aeb00) === 1, 'a container\'s club becomes a Steel Warhammer in the container; the rest stays', W.get(BOX3, 'inventory'));
ok(W.audit.some((t) => /GEARSTRIP removed 1 x Giant's Club from container 8068155; swapped for 1 Steel Warhammer/.test(t)), 'audited');
const { without } = require(MOD);
const w = without([{ baseId: 1, count: 2, wornLeft: true }, { baseId: 2, count: 1 }, { baseId: 3, count: 1 }], new Set([1, 3]));
ok(w.removed.get(1) === 2 && w.removed.get(3) === 1 && w.worn.has(1) && w.entries.length === 1, 'without(): several ids, a left-hand worn copy, the rest kept');
load(W, [], { enabled: false });

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
