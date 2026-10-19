// Staff enchanting (staffenchant.js: /enchant and the F7 Enchant tab) against a stub mp holding the records. Checks the
// catalog read from ENCH/MGEF bytes, the strength and its cap, one copy of a stack enchanted as a player-made enchantment
// (the inventoryExtras.ts validEffects shape), the refusals (worn, own EITM, wrong kind, Alchemy/Enchanting effects),
// who may do it, and the panel's data widgets.
//
//   node tests/staffenchant-harness.js
'use strict';
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'staffenchant.js');
delete globalThis.__dboStaffEnchantCatalog; delete globalThis.__dboStaffEnchantLists;

let fails = 0;
const ok = (c, what, detail) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && detail !== undefined ? '   ' + detail : ''}`); if (!c) fails++; };

const bytes = (n, writer) => { const b = new Uint8Array(n); writer(new DataView(b.buffer)); return b; };
const u32 = (n) => bytes(4, (v) => v.setUint32(0, n >>> 0, true));
const enit = (cast, delivery, type) => bytes(36, (v) => { v.setUint32(8, cast, true); v.setUint32(16, delivery, true); v.setUint32(20, type, true); });
const efit = (mag, area, dur) => bytes(12, (v) => { v.setFloat32(0, mag, true); v.setUint32(4, area, true); v.setUint32(8, dur, true); });
const mgefData = (cost, av) => bytes(152, (v) => { v.setFloat32(4, cost, true); v.setInt32(68, av, true); });

// Ids: an ENCH in a mod at index 0x08 names its effect record-locally as 0x01xxxxxx (its one master is Skyrim.esm)
const FIRE_FX = 0x0004605a, FROST_FX = 0x0004605b, STAMINA_FX = 0x0004605c, HEALTH_FX = 0x0004605d, ENCHFX = 0x0007a0f2, STAFFFX = 0x00046060;
const FIRE = 0x00045c35, ROBES = 0x0010ead1, STAFF = 0x00045c40, FORT_ENCH = 0x0007a0f3, MODFIRE = 0x08001234, BIG = 0x00045c50;
const SWORD = 0x00012eb7, CUIRASS = 0x00012e49, RING = 0x0008b5ab, OWNED = 0x000be190, ARROW = 0x0001397d;
const recs = {
  [FIRE_FX]: { type: 'MGEF', editorId: 'EnchFireDamageFFContact', fields: [{ type: 'DATA', data: mgefData(0.9, -1) }] },
  [FROST_FX]: { type: 'MGEF', editorId: 'EnchFrostDamageFFContact', fields: [{ type: 'DATA', data: mgefData(0.0, -1) }] },
  [STAMINA_FX]: { type: 'MGEF', editorId: 'EnchFortifyStaminaConstantSelf', fields: [{ type: 'DATA', data: mgefData(0.5, 26) }] },
  [HEALTH_FX]: { type: 'MGEF', editorId: 'EnchFortifyHealthConstantSelf', fields: [{ type: 'DATA', data: mgefData(0.7, 24) }] },
  [ENCHFX]: { type: 'MGEF', editorId: 'EnchFortifyEnchantingConstantSelf', fields: [{ type: 'DATA', data: mgefData(1, 23) }] },
  [STAFFFX]: { type: 'MGEF', editorId: 'StaffFire', fields: [{ type: 'DATA', data: mgefData(1, -1) }] },
  // A weapon enchantment: fire 10 for 1 s, with a free frost rider 5
  [FIRE]: { type: 'ENCH', editorId: 'EnchWeaponFireDamage02', fields: [{ type: 'ENIT', data: enit(1, 1, 6) },
    { type: 'EFID', data: u32(FROST_FX) }, { type: 'EFIT', data: efit(5, 0, 0) }, { type: 'EFID', data: u32(FIRE_FX) }, { type: 'EFIT', data: efit(10, 0, 1) }] },
  [ROBES]: { type: 'ENCH', editorId: 'EnchArmorFortifyStamina02', fields: [{ type: 'ENIT', data: enit(0, 0, 6) }, { type: 'EFID', data: u32(STAMINA_FX) }, { type: 'EFIT', data: efit(30, 0, 0) },
    { type: 'EFID', data: u32(HEALTH_FX) }, { type: 'EFIT', data: efit(15, 0, 0) }] },
  [STAFF]: { type: 'ENCH', editorId: 'StaffEnchFireball', fields: [{ type: 'ENIT', data: enit(1, 2, 12) }, { type: 'EFID', data: u32(STAFFFX) }, { type: 'EFIT', data: efit(40, 15, 0) }] },
  [FORT_ENCH]: { type: 'ENCH', editorId: 'EnchArmorFortifyEnchanting03', fields: [{ type: 'ENIT', data: enit(0, 0, 6) }, { type: 'EFID', data: u32(ENCHFX) }, { type: 'EFIT', data: efit(15, 0, 0) }] },
  [MODFIRE]: { type: 'ENCH', editorId: 'CYREnchAyleidFire', local: { 0x0104605a: FIRE_FX }, fields: [{ type: 'ENIT', data: enit(1, 1, 6) }, { type: 'EFID', data: u32(0x0104605a) }, { type: 'EFIT', data: efit(20, 0, 2) }] },
  [BIG]: { type: 'ENCH', editorId: 'EnchArmorEverything', fields: [{ type: 'ENIT', data: enit(0, 0, 6) }].concat(...Array.from({ length: 9 }, () => [{ type: 'EFID', data: u32(HEALTH_FX) }, { type: 'EFIT', data: efit(1, 0, 0) }])) },
  [SWORD]: { type: 'WEAP', editorId: 'IronSword', fields: [] },
  [CUIRASS]: { type: 'ARMO', editorId: 'ArmorIronCuirass', fields: [] },
  [RING]: { type: 'ARMO', editorId: 'JewelryRingGold', fields: [] },
  [OWNED]: { type: 'WEAP', editorId: 'EnchElvenDaggerFire05', fields: [{ type: 'EITM', data: u32(0x00045c36) }] },
  [ARROW]: { type: 'AMMO', editorId: 'IronArrow', fields: [] },
};
const PLUGIN = (id) => ((id >>> 24) === 8 ? 'BSHeartland.esm' : 'Skyrim.esm');

const STAFFER = 0xff000201, PLAYER = 0xff000101, GM = 0xff000202, TRIAL = 0xff000203, LEAD = 0xff000204;
const TIERS = { [STAFFER]: 'senior', [GM]: 'gm', [TRIAL]: 'trialgm', [LEAD]: 'leadgm', [PLAYER]: null };
const NAMES = { [STAFFER]: 'Nate', [PLAYER]: 'Argosh', [GM]: 'Aussie', [TRIAL]: 'Newbie', [LEAD]: 'Lead' };
const inv = {
  [PLAYER]: { entries: [{ baseId: SWORD, count: 3, health: 1.2 }, { baseId: CUIRASS, count: 1, worn: true }, { baseId: RING, count: 1 }, { baseId: OWNED, count: 1 }, { baseId: ARROW, count: 50 }] },
  [STAFFER]: { entries: [{ baseId: RING, count: 2, name: 'Old Ring', enchantmentEffects: [{ effectId: HEALTH_FX, magnitude: 5, area: 0, duration: 0, cost: 3 }] }] },
  [GM]: { entries: [{ baseId: SWORD, count: 1 }] }, [TRIAL]: { entries: [{ baseId: SWORD, count: 1 }] }, [LEAD]: { entries: [{ baseId: SWORD, count: 1 }] },
};
const sets = [];
const mp = {
  getEspmRecordIdsByType: (t) => Object.keys(recs).map(Number).filter((id) => recs[id].type === t),
  lookupEspmRecordById: (id) => { const r = recs[id >>> 0]; if (!r) throw new Error('no record'); return { record: r, toGlobalRecordId: (l) => (r.local && r.local[l >>> 0]) || (l >>> 0) }; },
  getDescFromId: (id) => `${(id & 0xffffff).toString(16)}:${PLUGIN(id)}`,
  get: (a, k) => { if (k === 'inventory') return JSON.parse(JSON.stringify(inv[a] || { entries: [] })); return undefined; },
  set: (a, k, v) => { if (k === 'inventory') { inv[a] = JSON.parse(JSON.stringify(v)); sets.push(a); } },
};
const said = [], audits = [], notes = [], widgets = [], closed = [], packets = [];
const ui = new Map();
const commands = {};
const api = (cfg) => ({
  mp, log: () => {}, personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), staffNote: (a, w, d) => notes.push([a, w, d]),
  who: (a) => NAMES[a], display: (a) => NAMES[a], onlineActors: () => [STAFFER, PLAYER, GM, TRIAL, LEAD], registerChatCommand: (n, f, o) => { commands[n] = { f, o }; },
  staffTierOf: (a) => TIERS[a] || null, findByName: (q) => Number(Object.keys(NAMES).find((k) => NAMES[k].toLowerCase() === q.toLowerCase())) || 0,
  onUi: (e, f) => { const l = ui.get(e) || []; l.push(f); ui.set(e, l); }, openWidget: (a, w, f) => widgets.push([a, w, f]), closeWidget: (a, id) => closed.push([a, id]),
  sendPacket: (a, p) => packets.push([a, p]), itemName: (id) => ({ [SWORD]: 'Iron Sword', [RING]: 'Gold Ring', [CUIRASS]: 'Iron Armor' })[id] || '',
  cfg: { staffEnchant: cfg || {} },
});
const load = (cfg) => { ui.clear(); delete require.cache[MODULE]; return require(MODULE)(api(cfg)); };
const E = load();
const tab = (a, ...args) => (ui.get('staffEnchant') || []).forEach((f) => f(a, args));
const validEffects = (raw) => Array.isArray(raw) && raw.length > 0 && raw.length <= 8 && raw.every((x) => x
  && Number.isInteger(x.effectId) && x.effectId > 0 && [x.magnitude, x.cost].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
  && [x.area, x.duration].every((v) => Number.isInteger(v) && v >= 0));

// ---- the catalog --------------------------------------------------------------------------------------------------
const cat = E.catalog();
const ids = cat.map((e) => e.id);
ok(ids.includes(FIRE) && ids.includes(ROBES) && ids.includes(MODFIRE), 'weapon and apparel enchantments are listed, a mod\'s too', ids.map((x) => x.toString(16)).join(' '));
ok(!ids.includes(STAFF), 'a staff\'s enchantment (ENIT type 12) is not listed');
ok(!ids.includes(FORT_ENCH), 'an enchantment on the Enchanting skill (MGEF actor value 23) is not listed');
ok(!ids.includes(BIG), 'an enchantment of more than 8 effects is not listed');
const fire = cat.find((e) => e.id === FIRE), robes = cat.find((e) => e.id === ROBES), mod = cat.find((e) => e.id === MODFIRE);
ok(fire.kind === 'w' && robes.kind === 'a', 'contact enchantments are for weapons, constant self ones for apparel');
ok(mod.effects[0].effectId === FIRE_FX, 'a mod\'s record-local EFID is read through its toGlobalRecordId', mod.effects[0].effectId.toString(16));
ok(fire.main === 1, 'the strength belongs to the costliest effect, not the first (a free rider sits first)', fire.main);
ok(fire.effects[1].magnitude === 10 && fire.effects[1].duration === 1 && Math.abs(fire.effects[1].baseCost - 0.9) < 1e-6, 'EFIT magnitude and duration and the MGEF base cost are read');
ok(fire.name === 'Fire Damage 02' && fire.plugin === 'Skyrim.esm', 'names are the editor id in words, with the plugin', `${fire.name} ${fire.plugin}`);
ok(E.words('DLC2EnchArmorFortifyStamina02') === 'Fortify Stamina 02', 'a DLC prefix and the Armor family word are dropped', E.words('DLC2EnchArmorFortifyStamina02'));

// ---- strength -----------------------------------------------------------------------------------------------------
let b = E.effectsFor(fire, 20, 3);
ok(b.effects && b.effects[1].magnitude === 20 && b.effects[0].magnitude === 10, 'a strength doubles the main effect and its rider keeps its share', JSON.stringify(b));
ok(validEffects(b.effects), 'what is built is the shape inventoryExtras.ts validEffects keeps');
ok(b.effects[1].cost > 0 && Math.abs(b.effects[1].cost - Math.round(0.9 * Math.pow(20, 1.1) * 100) / 100) < 0.011, 'each cost is the Creation Kit formula', b.effects[1].cost);
ok(E.effectsFor(fire, undefined, 3).effects[1].magnitude === 10, 'no strength keeps the record\'s own');
ok(/At most 30/.test(E.effectsFor(fire, 31, 3).refused || ''), 'more than maxScale times its own is refused');
ok(/above 0/.test(E.effectsFor(fire, -1, 3).refused || '') && /above 0/.test(E.effectsFor(fire, 'x', 3).refused || ''), 'a strength that is not a positive number is refused');

// ---- who may ------------------------------------------------------------------------------------------------------
const pieces = E.piecesOf(PLAYER);
const swordKey = pieces.find((p) => p.name === 'Iron Sword').key;
ok(pieces.length === 4 && !pieces.some((p) => p.name.includes('Arrow')), 'weapons and apparel are listed, ammunition is not', pieces.map((p) => p.name).join(', '));
ok(/higher rank/.test(E.apply(GM, PLAYER, swordKey, FIRE, 10, '')), 'a GM is refused by default (minTier leadgm, as the panel\'s item grants)');
ok(/higher rank/.test(E.apply(TRIAL, PLAYER, swordKey, FIRE, 10, '')), 'a Trial GM is refused');
ok(/higher rank/.test(E.apply(PLAYER, PLAYER, swordKey, FIRE, 10, '')), 'a player is refused');
ok(E.apply(LEAD, LEAD, E.piecesOf(LEAD)[0].key, FIRE, 10, '') === '', 'a Lead GM may');
const G = load({ minTier: 'gm' });
ok(G.apply(GM, GM, G.piecesOf(GM)[0].key, FIRE, 10, '') === '', 'with minTier gm a GM may');
ok(/higher rank/.test(G.apply(TRIAL, TRIAL, G.piecesOf(TRIAL)[0].key, FIRE, 10, '')), 'and a Trial GM still may not');
const OFF = load({ enabled: false });
ok(/higher rank/.test(OFF.apply(STAFFER, PLAYER, swordKey, FIRE, 10, '')), 'switched off, nobody may');
const S = load();

// ---- doing it ------------------------------------------------------------------------------------------------------
audits.length = 0; said.length = 0;
let why = S.apply(STAFFER, PLAYER, swordKey, FIRE, 20, 'Emberfang');
ok(why === '', 'a Senior enchants one of a player\'s swords', why);
const swords = inv[PLAYER].entries.filter((e) => e.baseId === SWORD);
const made = swords.find((e) => e.enchantmentEffects);
ok(swords.length === 2 && swords.find((e) => !e.enchantmentEffects).count === 2 && made.count === 1, 'one copy is taken off the stack of three; two stay plain', JSON.stringify(swords));
ok(made.health === 1.2 && made.name === 'Emberfang', 'the copy keeps its tempering and takes the name given');
ok(validEffects(made.enchantmentEffects) && made.enchantmentEffects.length === 2 && made.enchantmentEffects[1].magnitude === 20, 'it carries the effects as a player-made enchantment');
ok(made.maxCharge === 3000 && made.chargePercent === undefined && made.enchantmentId === undefined, 'a weapon gets a full charge (weaponCharge) and no record enchantment');
ok(audits.some((t) => /STAFF ENCHANT Nate enchanted Argosh's Iron Sword/.test(t) && /45c35/.test(t)), 'the audit names who, whose, what and the record', audits.join(' | '));
ok(notes.some((n) => n[1] === '/enchant'), 'a #staff-commands note is made');
ok(said.some((x) => x[0] === PLAYER && /Nate enchanted your Iron Sword/.test(x[1])), 'the owner is told');

ok(/Take that piece off first|cannot take an enchantment: worn/.test(S.apply(STAFFER, PLAYER, S.piecesOf(PLAYER).find((p) => p.name === 'Iron Armor').key, ROBES, 30, '')), 'a worn piece is refused');
ok(/own record is enchanted/.test(S.apply(STAFFER, PLAYER, S.piecesOf(PLAYER).find((p) => p.name === 'Elven Dagger Fire 05' || /Elven/.test(p.name)).key, FIRE, 10, '')), 'a piece whose record carries an enchantment (EITM) is refused');
ok(/weapon enchantment; pick a weapon/.test(S.apply(STAFFER, PLAYER, S.piecesOf(PLAYER).find((p) => p.name === 'Gold Ring').key, FIRE, 10, '')), 'a weapon enchantment on a ring is refused');
ok(/no longer in the pack/.test(S.apply(STAFFER, PLAYER, '{"baseId":1}', FIRE, 10, '')), 'a piece that is gone is refused');
ok(/No such enchantment/.test(S.apply(STAFFER, PLAYER, swordKey, FORT_ENCH, 10, '')), 'a refused enchantment cannot be named directly');
const before = JSON.stringify(inv[PLAYER]);
ok(/At most/.test(S.apply(STAFFER, PLAYER, swordKey, FIRE, 1000, '')) && JSON.stringify(inv[PLAYER]) === before, 'a refusal leaves the pack as it was');

// A piece already enchanted gets the new enchantment in place of its old one
const ringKey = S.piecesOf(STAFFER)[0].key;
ok(S.apply(STAFFER, STAFFER, ringKey, ROBES, 45, '') === '', 'a player-made ring is enchanted again');
const rings = inv[STAFFER].entries;
const newRing = rings.find((e) => e.enchantmentEffects && e.enchantmentEffects[0].effectId === STAMINA_FX);
ok(rings.length === 2 && newRing && newRing.count === 1 && newRing.enchantmentEffects.length === 2 && newRing.name === 'Old Ring' && newRing.maxCharge === undefined, 'the old effects go, its name stays, apparel has no charge', JSON.stringify(rings));
ok(newRing.enchantmentEffects[0].magnitude === 45 && newRing.enchantmentEffects[1].magnitude === 22.5, 'the second effect keeps its share (15 of 30 -> 22.5 of 45)');

// ---- the panel ------------------------------------------------------------------------------------------------------
widgets.length = 0; packets.length = 0;
tab(PLAYER, 'catalog');
ok(!widgets.length && packets.some((p) => p[0] === PLAYER && /higher rank/.test(p[1].text)), 'the tab sends nothing to a player');
tab(STAFFER, 'catalog');
let w = widgets.pop();
ok(w && w[1].type === 'staffData' && w[1].id === 141 && w[1].kind === 'enchantCatalog' && w[2] === false, 'the catalog goes as data widget 141, unfocused');
const row = w[1].list.find((x) => x.id === FIRE.toString(16));
ok(row && row.k === 'w' && row.m === 1 && row.fx[1][0] === 'Fire Damage' && row.fx[1][1] === 10 && w[1].maxScale === 3, 'each row carries its kind, main effect and effects', JSON.stringify(row));
tab(STAFFER, 'items', PLAYER.toString(16));
w = widgets.pop();
ok(w && w[1].id === 142 && w[1].kind === 'enchantItems' && w[1].target === PLAYER.toString(16) && w[1].targetName === 'Argosh' && w[1].items.some((i) => i.now && /made/.test(i.now)), 'a player\'s pieces go as data widget 142, with what they carry now');
tab(STAFFER, 'items', '');
ok(widgets.pop()[1].target === '', 'no target is the staff member');
packets.length = 0;
const key2 = S.piecesOf(PLAYER).find((p) => p.name === 'Iron Sword' && !p.now).key;
tab(STAFFER, 'apply', JSON.stringify({ target: PLAYER.toString(16), key: key2, ench: MODFIRE.toString(16), strength: 25 }));
ok(packets.some((p) => p[1].customPacketType === 'adminActionResult' && p[1].ok && p[1].text === 'Enchanted.'), 'Apply answers with the panel\'s toast');
ok(widgets.pop()[1].kind === 'enchantItems' && inv[PLAYER].entries.filter((e) => e.baseId === SWORD).length === 3, 'and sends the pack again, now with a second enchanted sword');
tab(STAFFER, 'apply', JSON.stringify({ target: 'deadbeef', key: key2, ench: FIRE.toString(16) }));
ok(packets.some((p) => /not in the game/.test(p[1].text)), 'an offline target is refused');
tab(STAFFER, 'close');
ok(closed.some((c) => c[1] === 141) && closed.some((c) => c[1] === 142), 'closing the tab removes both data widgets');

// ---- chat ----------------------------------------------------------------------------------------------------------
said.length = 0;
const chat = (a, t) => commands.enchant.f(a, t);
ok(commands.enchant.o.admin === true, '/enchant is an admin command (the chat gate refuses everyone else first)');
chat(STAFFER, 'find fire');
ok(said.some((x) => /45c35 Fire Damage 02 \(w, Skyrim.esm\)/.test(x[1])), '/enchant find lists matches with their ids', said.map((x) => x[1]).join(' | '));
said.length = 0;
chat(STAFFER, 'items Argosh');
const listText = said.map((x) => x[1]).join('\n');
ok(/1\. Gold Ring/.test(listText) || /Gold Ring/.test(listText), '/enchant items lists a player\'s pieces, numbered', listText);
const ringNo = listText.split('\n').find((l) => /Gold Ring/.test(l)).trim().split('.')[0];
said.length = 0;
chat(STAFFER, `apply ${ringNo} EnchArmorFortifyStamina02 40 Ring of the Hunt`);
const ring = inv[PLAYER].entries.find((e) => e.baseId === RING);
ok(ring.enchantmentEffects && ring.enchantmentEffects[0].magnitude === 40 && ring.name === 'Ring of the Hunt', '/enchant apply <n> <editor id> <strength> <name> enchants it', JSON.stringify(ring));
said.length = 0;
chat(GM, 'find fire');
ok(said.some((x) => /higher rank/.test(x[1])), 'a GM is refused in chat too by default');

const src = require('fs').readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
ok(/require\(STAFFENCHANT_JS\)\(\{[^}]*staffTierOf, findByName/.test(src), 'gamemode.js loads staffenchant.js with the staff tier and the name lookup');
const conf = JSON.parse(require('fs').readFileSync(path.resolve(__dirname, '..', 'gamemode-config.json'), 'utf8')).staffEnchant;
ok(conf && conf.enabled === true && conf.minTier === 'leadgm' && conf._comment, 'gamemode-config.json has staffEnchant, on, Lead GM and above');

console.log(fails ? `${fails} failure(s)` : 'all checks passed');
process.exit(fails ? 1 : 0);
