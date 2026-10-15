// Giant's clubs withdrawn (Nate, 12 Oct 2026: "remove all giants clubs from being made and from peoples inventories"; a
// player was two-tapped in Bruma by a club someone had). regions-overrides.json forgeNever refuses the four club bases at
// every bench, staff too; gearstrip.js takes them from players and containers. SurWR's Giant Club, the only one a recipe
// makes (DBOSM_CrGiantClubWR in DragonBreak Nexus Patches: 1 Iron Ingot, 2 Steel Ingots, 1 Leather Strips), refunds that
// recipe; the others refund nothing. Each club carries its own reason, and the guard armour keeps its line.
// Loads the real regions.js and gearstrip.js with the real data files against fake records.
//   node tests/giant-club-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(SERVER, f), 'utf8'));

const PLUG = { 0x00: 'Skyrim.esm', 0x02: 'Dawnguard.esm', 0x08: 'BSHeartland.esm', 0x16: 'SurWR.esp', 0x6a: 'DragonBreak Nexus Patches.esp' };
const desc = (id) => `${(id & 0xffffff).toString(16)}:${PLUG[id >>> 24] || 'Skyrim.esm'}`;
const idOfDesc = (d) => { const [h, p] = String(d).split(':'); const ix = Object.keys(PLUG).find((k) => PLUG[k].toLowerCase() === String(p).toLowerCase()); if (ix === undefined) throw new Error('no ' + d); return ((Number(ix) << 24) | parseInt(h, 16)) >>> 0; };
const CLUBS = { '2f7067:SurWR.esp': 'Giant Club', '461da:Skyrim.esm': 'Giant Club', 'c334f:Skyrim.esm': 'Giant Club', '12d14:Dawnguard.esm': 'Frost Giant Club' };
const SURWR = idOfDesc('2f7067:SurWR.esp'), VAN = idOfDesc('c334f:Skyrim.esm');

const scratch = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-giantclub-'));
process.on('exit', () => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
process.chdir(scratch);
for (const f of ['regions.json', 'regions-overrides.json', 'dragon-materials.json', 'artifacts.json', 'skills.json', 'spell-tomes.json']) {
  try { fs.copyFileSync(path.join(SERVER, f), f); } catch (e) { /* optional */ }
}

// ---- data ----------------------------------------------------------------------------------------------------------
const OVR = readJson('regions-overrides.json').forgeNever || {};
const missing = Object.keys(CLUBS).filter((d) => !OVR[d]);
ok(!missing.length, 'forgeNever lists all four club bases', missing);
const recipe = Object.entries(readJson('regions.json').recipes || {}).filter(([, r]) => r && /giant/i.test(r.name || '') && /club/i.test(r.name || ''));
// The 140-order regions.json (PC, 15 Oct) has none: the release's Nexus Patches 995433b2 no longer carries DBOSM_CrGiantClubWR
ok(recipe.length <= 1 && recipe.every(([, r]) => r.item === '2f7067:SurWR.esp' && OVR[r.item]), 'the club recipe (DBOSM_CrGiantClubWR), where the plugins still have it, makes a forgeNever product', recipe);
const G = readJson('gamemode-config.json').gearStrip || { items: [] };
ok(G.enabled === true, 'gearStrip is on');
const listed = Object.keys(CLUBS).filter((d) => G.items.some((it) => it.item === d && /giant's club/.test(it.reason || '')));
ok(listed.length === 4, 'gearStrip lists all four, each with the club reason', listed);
const rf = JSON.stringify((G.items.find((it) => it.item === '2f7067:SurWR.esp') || {}).refund.map((r) => [r[0], r[1]]));
ok(rf === JSON.stringify([['5ace4:Skyrim.esm', 1], ['5ace5:Skyrim.esm', 2], ['800e4:Skyrim.esm', 1]]), "SurWR's club refunds its recipe: 1 Iron, 2 Steel, 1 Leather Strips", rf);
ok(['461da:Skyrim.esm', 'c334f:Skyrim.esm', '12d14:Dawnguard.esm'].every((d) => !G.items.find((it) => it.item === d).refund.length), 'the clubs no recipe makes refund nothing');
ok(/only Bruma's guard armour/.test(G.reason), "the list's own reason is still the guard armour's");

// ---- the forge ------------------------------------------------------------------------------------------------------
const recs = new Map();
const u32 = (...ids) => { const b = new Uint8Array(ids.length * 4); const dv = new DataView(b.buffer); ids.forEach((v, i) => dv.setUint32(i * 4, v >>> 0, true)); return b; };
const rec = (id, type, editorId, fields = []) => recs.set(id >>> 0, { record: { type, editorId, fields } });
const KW_FORGE = 0x88105, KW_GRIND = 0x88108;
rec(KW_FORGE, 'KYWD', 'CraftingSmithingForge'); rec(KW_GRIND, 'KYWD', 'CraftingSmithingSharpeningWheel');
rec(SURWR, 'WEAP', 'WRGiantClub'); rec(VAN, 'WEAP', 'GiantClub');
const R_FORGE = 0x6a000ae3, R_GRIND = 0x6a000ae4;
rec(R_FORGE, 'COBJ', 'DBOSM_CrGiantClubWR', [{ type: 'BNAM', data: u32(KW_FORGE) }]);
rec(R_GRIND, 'COBJ', 'TemperGiantClub', [{ type: 'BNAM', data: u32(KW_GRIND) }]);
const props = new Map(), said = [], chain = [];
const mp = {
  getIdFromDesc: idOfDesc, getDescFromId: desc, get: (id, p) => props.get(id + '|' + p), set: (id, p, v) => props.set(id + '|' + p, v),
  lookupEspmRecordById: (id) => recs.get(id >>> 0) || null, callPapyrusFunction: () => null,
};
const PLAYER = 0xff002a82, STAFF = 0xff000202;
for (const a of [PLAYER, STAFF]) { props.set(a + '|worldOrCellDesc', 'a764b:BSHeartland.esm'); props.set(a + '|pos', [0, 0, 0]); props.set(a + '|appearance', { raceId: 0x13746 }); }
globalThis.__dboFactionGearMember = () => false;
globalThis.__dboFactionCraft = () => true;
delete globalThis.__dboSmithCraft; delete globalThis.__dboSmithCrafted; delete globalThis.__dboPrevCraft;
mp.onCraft = (a, item, n, r) => { chain.push(r); return undefined; };
try {
  require(path.join(SERVER, 'regions.js'))({
    mp, log: () => {}, personal: (a, t) => said.push([a, t]), audit: () => {}, who: (a) => `P${a.toString(16)}`,
    cfg: { regions: { craft: true, failOpen: true, defaultPlace: 'cyrodiil', adminBypass: true } },
    registerChatCommand: () => {}, isAdmin: (a) => a === STAFF, sendPacket: () => true, openWidget: () => true, closeWidget: () => true,
    onUi: () => {}, onlineActors: () => [], every: () => {}, distanceMeters: () => 0, takeGold: () => false, giveItem: () => true,
    depositToTreasury: (z, n) => n,
  });
} catch (e) { ok(false, 'regions.js loads', e.stack); process.exit(1); }
const craft = (a, item, r) => { chain.length = 0; said.length = 0; return mp.onCraft(a, item, 1, r); };
ok(craft(PLAYER, SURWR, R_FORGE) === false && !chain.length, "a player cannot forge SurWR's Giant Club (materials kept)");
ok(said.some(([a, t]) => a === PLAYER && /giant's club cannot be forged/.test(t) && /materials come back/.test(t)), '...and is told why', said);
ok(craft(STAFF, SURWR, R_FORGE) === false && !chain.length, 'staff are refused too');
ok(craft(PLAYER, VAN, R_GRIND) === false && !chain.length, 'tempering a giant club is refused');

// ---- gearstrip ------------------------------------------------------------------------------------------------------
const MOD = path.join(SERVER, 'gearstrip.js');
const IRON = 0x5ace4, STEEL = 0x5ace5, STRIPS = 0x800e4, OTHER = 0x12eb7, CHORROL_HELM = 0x080ddbf8;
const WARHAMMER = 0x1398a;
const DESC = { '5ace4:Skyrim.esm': IRON, '5ace5:Skyrim.esm': STEEL, '800e4:Skyrim.esm': STRIPS, 'db5d2:Skyrim.esm': 0xdb5d2, '1398a:Skyrim.esm': WARHAMMER };
for (const it of G.items) { try { DESC[it.item] = idOfDesc(it.item); } catch (e) { /* not in the fake order */ } }
const P = new Map(), told = [];
const set = (id, k, v) => { if (!P.has(id)) P.set(id, {}); P.get(id)[k] = JSON.parse(JSON.stringify(v)); };
const get = (id, k) => { const p = P.get(id); if (!p || !(k in p)) { if (k === 'inventory') throw new Error('not loaded'); return undefined; } return JSON.parse(JSON.stringify(p[k])); };
const giveItem = (a, id, n) => { const inv = get(a, 'inventory') || { entries: [] }; const e = inv.entries.find((x) => x.baseId === id); if (e) e.count += n; else inv.entries.push({ baseId: id, count: n }); set(a, 'inventory', inv); return true; };
const count = (id, base) => ((get(id, 'inventory') || { entries: [] }).entries.filter((e) => e.baseId === base).reduce((n, e) => n + e.count, 0));
delete require.cache[MOD];
require(MOD)({
  mp: { get, set, getIdFromDesc: (d) => { if (!(d in DESC)) throw new Error('no ' + d); return DESC[d]; }, getDescFromId: (id) => id.toString(16), callPapyrusFunction: () => null },
  log: () => {}, personal: (a, t) => told.push([a, t]), audit: () => {}, who: (a) => a.toString(16),
  onlineActors: () => [], every: () => {}, stopTimer: () => {}, giveItem,
  cfg: { gearStrip: Object.assign({}, G, { stateFile: path.join(scratch, 'gearstrip-state.json') }) }
});
const A = 0xff000601, B = 0xff000602, C = 0xff000603, BOX = 0x0800118c;
set(A, 'profileId', 1); set(A, 'inventory', { entries: [{ baseId: SURWR, count: 2, worn: true }, { baseId: OTHER, count: 1 }] });
set(B, 'profileId', 2); set(B, 'inventory', { entries: [{ baseId: VAN, count: 1 }] });
set(C, 'profileId', 3); set(C, 'inventory', { entries: [{ baseId: SURWR, count: 1 }, { baseId: CHORROL_HELM, count: 1 }] });
set(BOX, 'inventory', { entries: [{ baseId: SURWR, count: 1 }, { baseId: OTHER, count: 3 }] });
globalThis.__dboGearStripLogin(A); globalThis.__dboGearStripLogin(B); globalThis.__dboGearStripLogin(C); globalThis.__dboGearStripContainer(BOX);
// Nate, 12 Oct: "swap the clubs for steel": each club becomes a Steel Warhammer (swapTo), no materials
ok(count(A, SURWR) === 0 && count(A, OTHER) === 1, 'a holder loses both clubs, nothing else');
ok(count(A, WARHAMMER) === 2 && count(A, IRON) === 0 && count(A, STEEL) === 0, '...and gets 2 Steel Warhammers, no materials', [count(A, WARHAMMER), count(A, IRON), count(A, STEEL)]);
ok(told.some(([a, t]) => a === A && /Your 2 Giant Clubs have been exchanged for 2 Steel Warhammers: a giant's club was far too strong/.test(t) && !/Bruma/.test(t)), '...and is told the swap and the club reason', told);
ok(count(B, VAN) === 0 && count(B, WARHAMMER) === 1 && count(B, IRON) === 0, 'a vanilla club becomes a Steel Warhammer too');
ok(told.some(([a, t]) => a === C && /far too strong/.test(t) === false && /it has been withdrawn|Bruma/.test(t)) || told.some(([a, t]) => a === C), 'a holder of a club and a guard piece is told one line');
ok(count(C, SURWR) === 0 && count(C, CHORROL_HELM) === 0 && count(C, WARHAMMER) === 1, '...loses both, and the club comes back as a Steel Warhammer');
ok(count(BOX, SURWR) === 0 && count(BOX, OTHER) === 3 && count(BOX, WARHAMMER) === 1, 'a container\'s club becomes a Steel Warhammer in it; the rest stays');
// owed: the 4 characters and the sack stripped at 16:15Z with a materials refund get a Steel Warhammer, once
ok(Array.isArray(G.owed) && G.owed.length === 5 && G.owed.every((o) => o.give === '1398a:Skyrim.esm'), 'the config owes 5 Steel Warhammers', G.owed);
const OWED_A = 0xff00215e, SACK = 0x08068155;
set(OWED_A, 'profileId', 88); set(OWED_A, 'inventory', { entries: [{ baseId: IRON, count: 1 }] });
told.length = 0;
globalThis.__dboGearStripLogin(OWED_A); globalThis.__dboGearStripLogin(OWED_A);
ok(count(OWED_A, WARHAMMER) === 1 && count(OWED_A, IRON) === 1, 'an owed character gets one Steel Warhammer, once, and keeps the materials', [count(OWED_A, WARHAMMER)]);
ok(told.some(([a, t]) => a === OWED_A && /given a Steel Warhammer for the giant's club taken from you/.test(t)), '...and is told', told);
set(SACK, 'inventory', { entries: [{ baseId: 0x80aeb00, count: 1 }] });
globalThis.__dboGearStripContainer(SACK); globalThis.__dboGearStripContainer(SACK);
ok(count(SACK, WARHAMMER) === 1 && count(SACK, 0x80aeb00) === 1, 'the sack gets one Steel Warhammer back, once');

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
