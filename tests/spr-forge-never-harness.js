// JK's Fort Dawnguard's SPR war axe (f0d, base damage 111) and Enhanced Crossbow (f0e, 119) are neither forged nor loot
// (audit, 11 Oct 2026; the plugin fix to 13 / 19 is a PC job). regions-overrides.json forgeNever makes regions.js craftHook
// refuse them to everyone, staff and Dawnguard smiths included, tempering too, before the chain (materials kept, no
// credit); loot-overrides.json never keeps them out of every loot path even if faction-gear.json stops listing them.
// Loads the real regions.js and loottiers.js with the real data files against fake records.
//   node tests/spr-forge-never-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(SERVER, f), 'utf8'));

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-sprforge-'));
process.on('exit', () => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
process.chdir(scratch);
for (const f of ['regions.json', 'regions-overrides.json', 'dragon-materials.json', 'artifacts.json', 'skills.json', 'spell-tomes.json']) {
  try { fs.copyFileSync(path.join(SERVER, f), f); } catch (e) { /* optional */ }
}

// Fake ids: Skyrim.esm plain, Dawnguard.esm 0x02, JK's Fort Dawnguard.esp 0x3d (any index will do: descs carry the plugin)
const PLUG = { 0x00: 'Skyrim.esm', 0x02: 'Dawnguard.esm', 0x3d: "JK's Fort Dawnguard.esp" };
const desc = (id) => `${(id & 0xffffff).toString(16)}:${PLUG[id >>> 24] || 'Skyrim.esm'}`;
const idOfDesc = (d) => { const [h, p] = String(d).split(':'); const ix = Object.keys(PLUG).find((k) => PLUG[k].toLowerCase() === String(p).toLowerCase()); return ((Number(ix || 0) << 24) | parseInt(h, 16)) >>> 0; };
const recs = new Map();
const u32 = (...ids) => { const b = new Uint8Array(ids.length * 4); const dv = new DataView(b.buffer); ids.forEach((v, i) => dv.setUint32(i * 4, v >>> 0, true)); return b; };
const rec = (id, type, editorId, fields = []) => recs.set(id >>> 0, { record: { type, editorId, fields } });
const KW_FORGE = 0x88105, KW_WHEEL = 0x88108, KW_DG = 0x02000000 | 0xf7fc;
rec(KW_FORGE, 'KYWD', 'CraftingSmithingForge'); rec(KW_WHEEL, 'KYWD', 'CraftingSmithingSharpeningWheel'); rec(KW_DG, 'KYWD', 'DLC1CraftingDawnguard');
const SPR_AXE = 0x3d000f0d, SPR_XBOW = 0x3d000f0e, DG_AXE = 0x0200d098;
rec(SPR_AXE, 'WEAP', 'XJKFDDLC1DawnguardAxe'); rec(SPR_XBOW, 'WEAP', 'XJKFDDLC1CrossBowEnhanced'); rec(DG_AXE, 'WEAP', 'DLC1DawnguardAxe');
const R_FORGE = 0xa1001, R_WHEEL = 0xa1002, R_DG = 0xa1003;
rec(R_FORGE, 'COBJ', 'DBOSM_XJKFDDLC1DawnguardAxe', [{ type: 'BNAM', data: u32(KW_FORGE) }]);
rec(R_WHEEL, 'COBJ', 'TemperXJKFDDLC1DawnguardAxe', [{ type: 'BNAM', data: u32(KW_WHEEL) }]);
rec(R_DG, 'COBJ', 'RecipeXJKFDDLC1CrossBowEnhanced', [{ type: 'BNAM', data: u32(KW_DG) }]);

const props = new Map(), said = [], audits = [], chain = [];
const mp = {
  getIdFromDesc: idOfDesc, getDescFromId: desc, get: (id, p) => props.get(id + '|' + p), set: (id, p, v) => props.set(id + '|' + p, v),
  lookupEspmRecordById: (id) => recs.get(id >>> 0) || null, callPapyrusFunction: () => null,
};
const PLAYER = 0xff000201, STAFF = 0xff000202, DAWNGUARD_SMITH = 0xff000203, DAWNGUARD_SMITH2 = 0xff000204;
for (const a of [PLAYER, STAFF, DAWNGUARD_SMITH, DAWNGUARD_SMITH2]) { props.set(a + '|worldOrCellDesc', 'a764b:BSHeartland.esm'); props.set(a + '|pos', [0, 0, 0]); props.set(a + '|appearance', { raceId: 0x13746 }); }
// The faction rule's answers: the Dawnguard smith is a member of the right rank, and the faction rule lets them on
globalThis.__dboFactionGearMember = (a) => (a >>> 0) === DAWNGUARD_SMITH || (a >>> 0) === DAWNGUARD_SMITH2;
globalThis.__dboFactionCraft = () => true;
delete globalThis.__dboSmithCraft; delete globalThis.__dboSmithCrafted;
delete globalThis.__dboPrevCraft;
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
const craft = (a, item, recipe) => { chain.length = 0; said.length = 0; return mp.onCraft(a, item, 1, recipe); };

ok(craft(PLAYER, SPR_AXE, R_FORGE) === false, 'a player cannot forge the SPR war axe');
ok(!chain.includes(R_FORGE), '...and the refused craft never reaches the chain (materials kept, no credit)');
ok(said.some(([a, t]) => a === PLAYER && /Dawnguard War Axe SPR/.test(t) && /stronger than intended/.test(t) && /materials come back/.test(t)), '...and is told why, and that the materials come back', said);
ok(audits.some((t) => /FORGENEVER craft refused Pff000201/.test(t) && /f0d:jk's fort dawnguard\.esp/.test(t)), '...and it is audited', audits);
ok(craft(DAWNGUARD_SMITH, SPR_AXE, R_FORGE) === false && !chain.length, "a Dawnguard Blacksmith (the faction's own smith) is refused too");
ok(craft(STAFF, SPR_AXE, R_FORGE) === false && !chain.length, 'staff are refused too (no admin bypass)');
ok(craft(PLAYER, SPR_AXE, R_WHEEL) === false && !chain.length, 'tempering one already held is refused (it would raise 111 further)');
ok(craft(DAWNGUARD_SMITH2, SPR_XBOW, R_DG) === false && !chain.length, 'the SPR Enhanced Crossbow is refused at the Dawnguard bench');
ok(said.some(([, t]) => /Enhanced Crossbow SPR/.test(t)), '...naming the crossbow', said);
ok(craft(DAWNGUARD_SMITH, DG_AXE, R_FORGE) !== false && chain.includes(R_FORGE), "the Dawnguard's own War Axe (Dawnguard.esm d098, damage 13) is untouched");

// ---- loot: never on any path, even if faction-gear.json stops naming them --------------------------------------------
const tiersOf = (factionGear) => { delete require.cache[path.join(SERVER, 'loottiers.js')]; return require(path.join(SERVER, 'loottiers.js'))({ materials: readJson('loot-materials.json'), factionGear, overrides: readJson('loot-overrides.json'), swap: readJson('gear-swap.json'), cfg: {} }); };
for (const [label, fg] of [['with faction-gear.json', readJson('faction-gear.json')], ['without faction-gear.json', { items: {} }]]) {
  const T = tiersOf(fg);
  for (const d of ["f0d:JK's Fort Dawnguard.esp", "f0e:JK's Fort Dawnguard.esp"]) {
    const c = T.classOf(d);
    ok(c.kind === 'never' && !T.lootable(d), `${d} is never loot ${label}`, c);
  }
}
// No hand-written pool names them either
const pools = ['loot.json', 'dungeon-pools.json', 'expeditions.json', 'ayleid-loot.json', 'weapon-racks.json', 'starter-grants.json', 'depths.json', 'owned-spawns.json'];
const named = pools.filter((f) => { try { return /f0[de]:jk's fort dawnguard\.esp|XJKFDDLC1(DawnguardAxe|CrossBowEnhanced)/i.test(fs.readFileSync(path.join(SERVER, f), 'utf8')); } catch (e) { return false; } });
ok(!named.length, `no loot pool or grant file names them (${pools.length} files)`, named);

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
