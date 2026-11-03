// decor.js's study bookshelf and planters (Nat via the Leader, 25 Oct; design _work\home-decorating\study-and-planters-design-1025.md
// on the PC) against a stub mp in a scratch directory, as tests/decor-harness.js runs decor.js:
//   the shelf takes books (never skill books or tomes, never notes), a home is a study from minForStudy shelves, maxPerHome;
//   a planter plants one crop the character carries, shows soil, ripens on the timer into the crop's static, and is picked
//   with one Harvesting roll on baseYield (missYield on a miss), crediting Harvesting through masterySystem's activate event.
// node tests/decor-growing-harness.js   (from server/; TMPDIR=/dev/shm/... on CT 115)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'decor.js');
const SKILLS = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'skills.json'), 'utf8'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-decor-growing-'));
process.chdir(scratch);

let clock = Date.parse('2026-10-25T18:00:00Z');
Date.now = () => clock;
const HOUR = 3600000;
let roll = 0.5;
Math.random = () => roll;

const CELL = 0x100, WORLD = 0x3c, DOOR = 0x200, OUTDOOR = 0x201;
const OWNER = 0xff000001, STRANGER = 0xff000003;
const PROFILE = { [OWNER]: 7, [STRANGER]: 9 };
const NAME = { [OWNER]: 'Olaf', [STRANGER]: 'Stray' };
const WOOD = 0x6f993, IRON = 0x5ace4, SALT = 0x34cdf, STONE = 0x71cf3;
const CABBAGE = 0x64b3f, DEATHBELL = 0x516c8, ASHYAM = 0x206e7, MOONSUGAR = 0xd8e3f;
const ASHYAM_D = '206e7:Dragonborn.esm', MOONSUGAR_D = 'd8e3f:Skyrim.esm';
// the fixture's third crop (Hearthfire's third, the Gourd) is given no static: the "not offered" case
const NOSTATIC = 0x10d666;
const NOVEL = 0xb001, CHEAP = 0xb002, SKILLBOOK = 0xb003, TOME = 0xb004, NOTE = 0xb005;
const SHELF_D = 'd800:DragonBreak Online Edits.esp', PLANTER_D = 'd801:DragonBreak Online Edits.esp', SOIL_D = 'd802:DragonBreak Online Edits.esp'; // verify-formids: ignore (made-up DLE ids: the merged ids are filled in later)
const CAB_STATIC = 'd803:DragonBreak Online Edits.esp', BELL_STATIC = 'd804:DragonBreak Online Edits.esp', ASHYAM_STATIC = 'd805:DragonBreak Online Edits.esp', MOONSUGAR_STATIC = 'd806:DragonBreak Online Edits.esp'; // verify-formids: ignore (made-up DLE ids: the merged ids are filled in later)
const d = (id) => `${id.toString(16)}:Skyrim.esm`;
fs.writeFileSync('housing.json', JSON.stringify([DOOR]));
fs.writeFileSync('skills.json', JSON.stringify({ skills: SKILLS.skills.filter((k) => k.id === 'woodcutter' || k.id === 'harvesting') }));
fs.writeFileSync('doors-pos.json', JSON.stringify({ doors: {} }));
fs.writeFileSync('decor-catalog.json', JSON.stringify({ groups: [] }));
const G = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'decor-growing.json'), 'utf8'));
const tracked = JSON.parse(JSON.stringify(G));
G.pieces[0].desc = SHELF_D; G.pieces[1].desc = PLANTER_D; G.soil.desc = SOIL_D;
G.crops = [Object.assign({}, G.crops.find((c) => c.item === d(CABBAGE)), { desc: CAB_STATIC }), Object.assign({}, G.crops.find((c) => c.item === d(DEATHBELL)), { desc: BELL_STATIC }), Object.assign({}, G.crops[2], { desc: null }),
  Object.assign({}, G.crops.find((c) => c.item === ASHYAM_D), { desc: ASHYAM_STATIC }), Object.assign({}, G.crops.find((c) => c.item === MOONSUGAR_D), { desc: MOONSUGAR_STATIC })];
fs.writeFileSync('decor-growing.json', JSON.stringify(G));

const props = new Map();
const setp = (id, k, v) => props.set(`${id}|${k}`, v);
const getp = (id, k) => props.get(`${id}|${k}`);
setp(DOOR, 'private.housing', { owner: 7, ownerChar: OWNER, ownerName: 'Olaf', partner: OUTDOOR, place: { cells: [d(CELL)], builtAt: 1 } });
setp(DOOR, 'worldOrCellDesc', d(CELL)); setp(OUTDOOR, 'worldOrCellDesc', d(WORLD));
for (const a of [OWNER, STRANGER]) { setp(a, 'worldOrCellDesc', d(CELL)); setp(a, 'pos', [1000, 1000, 50]); setp(a, 'angle', [0, 0, 0]); setp(a, 'profileId', PROFILE[a]); setp(a, 'inventory', { entries: [] }); }
// BOOK DATA: flags u8 (0x1 teaches a skill, 0x4 teaches a spell), type u8, u16, teaches u32, value u32, weight f32
const book = (flags, value) => { const b = new Uint8Array(16); const v = new DataView(b.buffer); v.setUint8(0, flags); v.setUint32(8, value, true); return { type: 'BOOK', editorId: 'B', fields: [{ type: 'DATA', data: b }] }; };
const RECORDS = { [CELL]: { type: 'CELL' }, [WORLD]: { type: 'WRLD' }, [NOVEL]: book(0, 25), [CHEAP]: book(0, 6), [SKILLBOOK]: book(1, 50), [TOME]: book(4, 80), [NOTE]: book(0, 0) };
const idOf = (x) => { const [h, p] = String(x).split(':'); return (parseInt(h, 16) | (/DragonBreak Online Edits/.test(p || '') ? 0x60000000 : 0)) >>> 0; };
const said = [], ui = {}, packets = [], placed = [], deleted = [], logs = [], audits = [], events = [];
const mp = {
  get: getp, set: setp,
  getIdFromDesc: idOf,
  getDescFromId: (id) => (id >>> 0).toString(16),
  lookupEspmRecordById: (id) => (RECORDS[id] ? { record: RECORDS[id] } : null),
  callPapyrusFunction: (kind, cls, fn, self, args) => {
    const id = parseInt(self.desc, 16) >>> 0;
    if (fn === 'PlaceAtMe') { const n = 0xff0000a0 + placed.length; placed.push(n); setp(n, 'worldOrCellDesc', getp(id, 'worldOrCellDesc')); setp(n, 'baseDesc', args[0].desc); return { desc: n.toString(16) }; }
    if (fn === 'SetPosition') setp(id, 'pos', args.slice(0, 3));
    if (fn === 'SetAngle') setp(id, 'angle', args.slice(0, 3));
    if (fn === 'Delete') deleted.push(id);
    return null;
  },
};
globalThis.__alduinakMasteryEvent = (kind, a, detail) => events.push({ kind, a, detail });
const onUi = (n, f) => { (ui[n] = ui[n] || []).push(f); };
const fire = (n, a, args) => (ui[n] || []).forEach((f) => f(a, args));
const cmds = {};
const giveItem = (a, baseId, count) => { const inv = getp(a, 'inventory') || { entries: [] }; const e = inv.entries.map((x) => Object.assign({}, x)); const h = e.find((x) => x.baseId === baseId); if (h) h.count += count; else e.push({ baseId, count }); setp(a, 'inventory', { entries: e }); return true; };
const held = (a, id) => (getp(a, 'inventory').entries.find((e) => e.baseId === id) || { count: 0 }).count;
const timers = {};
const NAMES_OF = { [d(CABBAGE).toLowerCase()]: 'Cabbage', [d(DEATHBELL).toLowerCase()]: 'Deathbell', [ASHYAM_D.toLowerCase()]: 'Ash Yam', [MOONSUGAR_D.toLowerCase()]: 'Moon Sugar' };
const cfg = { decor: { enabled: true, perSecond: 0, perHour: 1000, budgets: [{ pieces: 20, lights: 1, stations: 1, containers: 1 }] } };
const api = {
  mp, log: (...x) => logs.push(x.join(' ')), audit: (t) => audits.push(t), who: (a) => NAME[a], personal: (a, t) => said.push([a, t]),
  onUi, sendPacket: (a, p) => { packets.push([a, p]); return true; }, registerChatCommand: (n, f) => { cmds[n] = f; },
  onlineActors: () => [OWNER, STRANGER], isAdmin: () => false, tierOf: () => null, giveItem,
  findByName: (q) => Number(Object.keys(NAME).find((a) => NAME[a].toLowerCase() === String(q).toLowerCase())) || 0,
  every: (name, ms, fn) => { timers[name] = fn; }, cfg, itemName: (x) => NAMES_OF[String(x).toLowerCase()] || '',
};
let fails = 0;
const ok = (c, what, detail) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!c) fails++; };
const last = (a) => { for (let i = said.length - 1; i >= 0; i--) if (said[i][0] === a) return said[i][1]; return ''; };
const lastEdit = (a) => { for (let i = packets.length - 1; i >= 0; i--) if (packets[i][0] === a && packets[i][1].customPacketType === 'placeEdit') return packets[i][1]; return null; };
globalThis.__dboDecor = undefined; globalThis.__dboDecorActivate = undefined;
let T = require(MODULE)(api)._test;
const items = () => (T.reg().places[DOOR.toString(16)] || { items: [] }).items;
const cmd = (a, s) => cmds.decor(a, s);
let spot = 0;
const placeAt = (a, n) => { cmd(a, 'find ' + n); cmd(a, 'place 1'); const e = lastEdit(a); if (e) fire('placeMove', a, [e.id, [1080 + 40 * (spot++ % 4), 1000 + 80 * Math.floor(spot / 4), 50], [0, 0, 90]]); return e; };
const use = (ref, a) => globalThis.__dboDecorActivate(parseInt(ref, 16) >>> 0, a);

// ---- the tracked file: nothing offered until the merged DLE's ids are filled in -------------------------------------------
ok(tracked.pieces.every((p) => /^[0-9a-f]+:DragonBreak Online Edits\.esp$/.test(p.desc)) && tracked.crops.length === 34 && tracked.crops.every((c) => /^[0-9a-f]+:DragonBreak Online Edits\.esp$/.test(c.desc) && /^DBOPlanted/.test(c.edid)), 'decor-growing.json as tracked: 2 pieces and 34 crops (Hearthfire\'s 32, Ash Yam, Moon Sugar), descs filled from the merged DLE (fill_growing_ids.py)', tracked.crops.length);
const ash = tracked.crops.find((c) => c.item === ASHYAM_D), moon = tracked.crops.find((c) => c.item === MOONSUGAR_D);
ok(ash && moon && ash.edid === 'DBOPlantedDLC2AshYam' && moon.edid === 'DBOPlantedMoonSugar' && ash.rare === false && moon.rare === true
  && ash.desc === '1d2474:DragonBreak Online Edits.esp' && moon.desc === '1d2475:DragonBreak Online Edits.esp', 'Ash Yam (Dragonborn\'s, 24 h) and Moon Sugar (48 h) on their DLE statics (8a8035be: 1d2474, 1d2475)', { ash, moon });
ok(tracked.pieces.every((p) => p.costA && p.costB), 'both pieces carry costA (Hearthfire) and costB (today\'s resources) as the catalogue does');
ok((SKILLS.skills.find((k) => k.id === 'harvesting').counts.activatePrefixes || []).includes('DBOPlanter'), 'skills.json: Harvesting counts a planter pick (activatePrefixes DBOPlanter)');

// ---- the study bookshelf ------------------------------------------------------------------------------------------------
giveItem(OWNER, WOOD, 100); giveItem(OWNER, IRON, 20); giveItem(OWNER, SALT, 20); giveItem(OWNER, STONE, 40);
cmd(OWNER, 'find study');
ok(/1\. Arcane Study Bookshelf \[study\]/.test(last(OWNER)) && /2\. Priest Study Bookshelf \[study\]/.test(last(OWNER)), '/decor find study lists the shelf twice, arcane and priest (Nat, 26 Oct)', last(OWNER));
giveItem(OWNER, NOVEL, 5); giveItem(OWNER, SKILLBOOK, 3); giveItem(OWNER, TOME, 2); giveItem(OWNER, NOTE, 6);
cmd(OWNER, 'place 1');
ok(/needs 10 books .* you have 5/.test(last(OWNER)) && !lastEdit(OWNER), 'skill books, tomes and notes do not count: 5 of 10, refused before the preview', last(OWNER));
giveItem(OWNER, CHEAP, 7);
const wood0 = held(OWNER, WOOD);
placeAt(OWNER, 'study');
ok(items().length === 1 && items()[0].kind === 'study', 'with 12 books: placed, recorded as a study shelf', items());
ok(held(OWNER, CHEAP) === 0 && held(OWNER, NOVEL) === 2 && held(OWNER, SKILLBOOK) === 3 && held(OWNER, TOME) === 2 && held(OWNER, NOTE) === 6, 'the 10 cheapest books went (7 at 6 gold, 3 at 25); skill books, tomes and notes stay', { cheap: held(OWNER, CHEAP), novel: held(OWNER, NOVEL) });
ok(wood0 - held(OWNER, WOOD) === 12 && JSON.stringify(items()[0].books) === JSON.stringify({ [mp.getDescFromId(CHEAP)]: 7, [mp.getDescFromId(NOVEL)]: 3 }), 'paid the shelf\'s 12 firewood, the books recorded on the piece', items()[0].books);
const shelf1 = items()[0].ref;
ok(items()[0].studyKind === 'arcane', 'the first is placed as an arcane shelf', items()[0].studyKind);
ok(use(shelf1, OWNER) === true && /arcane study needs 2 arcane study bookshelves; this home has 1/.test(last(OWNER)), 'one shelf: decor.js takes the use and says a study needs two of its kind', last(OWNER));
giveItem(OWNER, CHEAP, 30);
placeAt(OWNER, 'study');
ok(use(shelf1, OWNER) === false, 'two shelves: the use falls through to schools.js (Study Magic / Priest Studies)');
placeAt(OWNER, 'study');
cmd(OWNER, 'find study'); cmd(OWNER, 'place 1');
ok(items().filter((i) => i.kind === 'study').length === 3 && /its 3 arcane study bookshelves already/.test(last(OWNER)), 'maxPerHome 3 of a kind: the fourth arcane is refused', last(OWNER));
const cheap0 = held(OWNER, CHEAP);
cmd(OWNER, 'list'); cmd(OWNER, 'remove 3');
ok(held(OWNER, CHEAP) === cheap0 && items().filter((i) => i.kind === 'study').length === 2, 'booksKept false: deconstructing a shelf gives no books back', held(OWNER, CHEAP) - cheap0);

// ---- the priest shelf: the same base, its own kind and its own count ----
giveItem(OWNER, CHEAP, 30); giveItem(OWNER, WOOD, 60); giveItem(OWNER, IRON, 10);
placeAt(OWNER, 'priest');
const priest1 = items().find((i) => i.studyKind === 'priest');
ok(priest1 && priest1.base === items()[0].base && priest1.name === 'Priest Study Bookshelf', 'a priest shelf: the same base record, kind priest', priest1);
ok(use(priest1.ref, OWNER) === true && /priest study needs 2 priest study bookshelves; this home has 1/.test(last(OWNER)), 'two arcane shelves do not make a priest study: counted per kind', last(OWNER));
ok(use(items().find((i) => i.studyKind === 'arcane').ref, OWNER) === false, 'the two arcane shelves are still an arcane study');
placeAt(OWNER, 'priest');
ok(use(priest1.ref, OWNER) === false, 'two priest shelves: a priest study, the use goes to schools.js');
ok(globalThis.__dboDecorStudyKind(parseInt(priest1.ref, 16)) === 'priest' && globalThis.__dboDecorStudyKind(parseInt(shelf1, 16)) === 'arcane' && globalThis.__dboDecorStudyKind(0x12345) === '',
  'schools.js is told each shelf\'s kind, and nothing for a ref that is no decor shelf');
const old = items().find((i) => i.studyKind === 'arcane'); delete old.studyKind;
ok(globalThis.__dboDecorStudyKind(parseInt(old.ref, 16)) === 'arcane', 'a shelf placed before the kinds is arcane');

// ---- the planter: who, what, planting ------------------------------------------------------------------------------------
placeAt(OWNER, 'planter');
const pl = items().find((i) => i.kind === 'planter');
ok(!!pl, 'a planter is placed', items().map((i) => i.name));
ok(use(pl.ref, STRANGER) === true && /Only the owner/.test(last(STRANGER)), 'a stranger cannot tend it', last(STRANGER));
ok(use(pl.ref, OWNER) === true && /Nothing to plant/.test(last(OWNER)), 'nothing to plant: says what grows there', last(OWNER));
giveItem(OWNER, CABBAGE, 2);
const placed0 = placed.length;
use(pl.ref, OWNER);
ok(held(OWNER, CABBAGE) === 1 && pl.crop && pl.crop.item === d(CABBAGE) && /ripens in 24 hours/.test(last(OWNER)), 'one crop carried: planted at once, one cabbage taken', last(OWNER));
ok(placed.length === placed0 + 1 && getp(parseInt(pl.show, 16), 'baseDesc') === SOIL_D && getp(parseInt(pl.show, 16), 'pos')[2] === getp(parseInt(pl.ref, 16), 'pos')[2] + 30, 'the soil shows, showZ above the planter', pl.show);
ok(use(pl.ref, OWNER) === true && /growing; ready in 24 hours/.test(last(OWNER)), 'used while growing: the time left', last(OWNER));
clock += 23 * HOUR; timers['decor-grow']();
ok(!pl.crop.ripe && getp(parseInt(pl.show, 16), 'baseDesc') === SOIL_D, 'the timer before growHours: still soil');

// ---- ripening and picking --------------------------------------------------------------------------------------------------
clock += HOUR + 1000; timers['decor-grow']();
const soilRef = parseInt(placed[placed0].toString(16), 16);
ok(pl.crop.ripe && deleted.includes(soilRef) && getp(parseInt(pl.show, 16), 'baseDesc') === CAB_STATIC, 'ripe: the soil goes, the cabbage static stands', { show: pl.show });
setp(OWNER, 'private.mastery', { order: ['harvesting'], skills: { harvesting: { rank: 4 } } });
roll = 0.99;
const cab0 = held(OWNER, CABBAGE), cropShow = parseInt(pl.show, 16);
use(pl.ref, OWNER);
ok(held(OWNER, CABBAGE) === cab0 + 4 && !pl.crop && !pl.show && deleted.includes(cropShow), 'a Master picks 4, the top of a common crop\'s 2-4 (chance 1), the planter empties', { got: held(OWNER, CABBAGE) - cab0 });
ok(events.some((e) => e.kind === 'activate' && e.a === OWNER && e.detail.refrId === parseInt(pl.ref, 16)), 'the pick sends Harvesting\'s activate event for the planter', events);
ok(audits.some((t) => /^DECOR pick Olaf 64b3f:Skyrim.esm x4 from planter/.test(t)) && audits.some((t) => /^DECOR plant Olaf/.test(t)), 'audit lines for plant and pick');
const cab1 = held(OWNER, CABBAGE);
use(pl.ref, OWNER);
ok(held(OWNER, CABBAGE) === cab1 - 1 && pl.crop, 'used again it plants again (the same crop is replanted from the pack)');
pl.crop.ripeAt = clock - 1; timers['decor-grow']();
setp(OWNER, 'private.mastery', { order: [], skills: {} });
roll = 0.3;
const cab2 = held(OWNER, CABBAGE);
use(pl.ref, OWNER);
ok(held(OWNER, CABBAGE) === cab2 + 2 && /You pick 2/.test(last(OWNER)), 'unskilled, the roll misses (0.3 over 0.25): the floor of a common crop, 2 (Nat, 31 Oct: never 1 a day)', last(OWNER));
// The ranges directly (yield 2-4 common, 1-2 rare): a Novice's hit is 3 of a common crop, 2 of a rare one; a miss the floor
{
  const R = T.yieldRange || null;
  const pickWith = (crop, rank, r) => {
    setp(OWNER, 'private.mastery', rank === null ? { order: [], skills: {} } : { order: ['harvesting'], skills: { harvesting: { rank } } });
    const p = items().find((i) => i.kind === 'planter'); p.crop = { item: crop.item, at: clock, ripeAt: clock - 1, ripe: true, by: 7 };
    const before = held(OWNER, crop.id); roll = r; use(p.ref, OWNER); return held(OWNER, crop.id) - before;
  };
  const common = { item: d(CABBAGE), id: CABBAGE }, rare = { item: d(DEATHBELL), id: DEATHBELL };
  ok(pickWith(common, 0, 0.1) === 3, 'a Novice\'s hit on a common crop: 3', R);
  ok(pickWith(rare, 0, 0.1) === 2 && pickWith(rare, 4, 0.1) === 2, 'a rare crop (Deathbell): a hit is 2, never more, a Master\'s too');
  ok(pickWith(rare, null, 0.9) === 1, '...and a miss on a rare crop is 1');
  // The Master Gardener (capstones.js, Harvesting at 100): the top of the range whatever the roll; capstones.js stubbed
  globalThis.__dboCapstones = { on: (s) => s === 'harvesting', isGrandmaster: (a, s) => a === OWNER && s === 'harvesting' };
  ok(pickWith(common, 0, 0.99) === 4 && pickWith(rare, 0, 0.99) === 2, 'a Master Gardener picks the top of a crop\'s range even on a missed roll');
  const p2 = items().find((i) => i.kind === 'planter'); delete p2.crop;
  setp(OWNER, 'inventory', { entries: getp(OWNER, 'inventory').entries.filter((e) => e.baseId !== DEATHBELL) });
  giveItem(OWNER, CABBAGE, 1); use(p2.ref, OWNER);
  ok(p2.crop && p2.crop.pace === 0.5 && Math.abs((p2.crop.ripeAt - clock) - 12 * HOUR) < 1000 && /ripens in 12 hours/.test(last(OWNER)), '...and a crop they plant ripens in half the time', [p2.crop, last(OWNER)]);
  delete p2.crop;
  globalThis.__dboCapstones = { on: () => false, isGrandmaster: () => true };
  ok(pickWith(rare, null, 0.9) === 1, 'with the capstone switched off, the roll decides again');
  delete globalThis.__dboCapstones;
  setp(OWNER, 'private.mastery', { order: [], skills: {} });
  // the Deathbells picked here are eaten, so the sections below start from the pack they expect
  setp(OWNER, 'inventory', { entries: getp(OWNER, 'inventory').entries.filter((e) => e.baseId !== DEATHBELL) });
}

// ---- several crops: the list and /decor plant -----------------------------------------------------------------------------
giveItem(OWNER, DEATHBELL, 1);
use(pl.ref, OWNER);
ok(/Plant what\? 1\. Cabbage, 2\. Deathbell \(slow\)/.test(last(OWNER)) && !pl.crop, 'two crops carried: a numbered list, nothing planted yet', last(OWNER));
cmd(STRANGER, 'plant 2');
ok(!pl.crop && /Use an empty planter first/.test(last(STRANGER)), 'someone else\'s list is not theirs');
cmd(OWNER, 'plant 2');
ok(pl.crop && pl.crop.item === d(DEATHBELL) && /ripens in 48 hours/.test(last(OWNER)) && held(OWNER, DEATHBELL) === 0, 'plant 2: Deathbell, a rare crop, 48 hours', last(OWNER));
cmd(OWNER, 'plant 1');
ok(/Use an empty planter first/.test(last(OWNER)), 'the list is used up once planted', last(OWNER));

// ---- a hot reload keeps the crop; the timer still ripens it ------------------------------------------------------------------
globalThis.__dboDecor.reg = null;
T = require(MODULE)(api)._test;
const pl2 = items().find((i) => i.kind === 'planter');
ok(pl2 && pl2.crop && pl2.crop.item === d(DEATHBELL), 'after a reload (registry read again from decor.json) the crop is still there');
clock += 48 * HOUR; timers['decor-grow']();
ok(pl2.crop.ripe && getp(parseInt(pl2.show, 16), 'baseDesc') === BELL_STATIC, '...and ripens into the Deathbell static');

// ---- taking the planter down takes its model too ----------------------------------------------------------------------------
const show2 = parseInt(pl2.show, 16);
cmd(OWNER, 'list'); cmd(OWNER, `remove ${items().indexOf(pl2) + 1}`);
ok(!items().includes(pl2) && deleted.includes(show2) && deleted.includes(parseInt(pl2.ref, 16)), 'remove: the planter and its crop model are deleted', { deleted });
ok(use(pl2.ref, OWNER) === false, 'a removed planter is no longer decor.js\'s');

// ---- Solstheim crops (Nat via the Leader, 27 Oct): both offered now their statics are in the DLE ------------------------------
giveItem(OWNER, WOOD, 60); giveItem(OWNER, IRON, 10); giveItem(OWNER, SALT, 10); giveItem(OWNER, STONE, 20);
placeAt(OWNER, 'planter');
const pl3 = items().find((i) => i.kind === 'planter');
// the earlier crops eaten; the third crop of the fixture has no static (desc null), so it is the "not offered" case
setp(OWNER, 'inventory', { entries: getp(OWNER, 'inventory').entries.filter((e) => e.baseId !== CABBAGE && e.baseId !== DEATHBELL) });
giveItem(OWNER, ASHYAM, 3); giveItem(OWNER, MOONSUGAR, 2); giveItem(OWNER, NOSTATIC, 4);
use(pl3.ref, OWNER);
ok(pl3 && !pl3.crop && /Plant what\? 1\. Ash Yam, 2\. Moon Sugar \(slow\)\. Say/.test(last(OWNER)) && held(OWNER, NOSTATIC) === 4, 'both offered, Moon Sugar as a slow crop; a crop with no static is not offered and none of it taken', last(OWNER));
cmd(OWNER, 'plant 2');
ok(pl3.crop && pl3.crop.item === MOONSUGAR_D && /You plant Moon Sugar\. It ripens in 48 hours/.test(last(OWNER)) && held(OWNER, MOONSUGAR) === 1, 'plant 2: Moon Sugar, 48 hours, one taken', last(OWNER));
clock += 48 * HOUR; timers['decor-grow']();
ok(pl3.crop.ripe && getp(parseInt(pl3.show, 16), 'baseDesc') === MOONSUGAR_STATIC, '...ripens into the Moon Sugar static');
roll = 0.01; use(pl3.ref, OWNER);
ok(!pl3.crop && held(OWNER, MOONSUGAR) > 1 && /You pick \d+ Moon Sugar/.test(last(OWNER)), '...and the pick gives Moon Sugar back', last(OWNER));
use(pl3.ref, OWNER); cmd(OWNER, 'plant 1');
ok(pl3.crop && pl3.crop.item === ASHYAM_D && /You plant Ash Yam\. It ripens in 24 hours/.test(last(OWNER)) && held(OWNER, ASHYAM) === 2, 'plant 1: the Dragonborn Ash Yam, 24 hours, one taken', last(OWNER));
clock += 24 * HOUR; timers['decor-grow']();
ok(pl3.crop.ripe && getp(parseInt(pl3.show, 16), 'baseDesc') === ASHYAM_STATIC, '...ripens into the Ash Yam static');
use(pl3.ref, OWNER);
ok(!pl3.crop && held(OWNER, ASHYAM) > 2 && /You pick \d+ Ash Yam/.test(last(OWNER)), '...and the pick gives Ash Yams back', last(OWNER));

// ---- growth counts IN-GAME days off the world clock (Nat via the Leader, 2 Nov) ---------------------------------------------
// decor.js reads globalThis.__dboClock per call, so installing the stub here takes effect at once, with no reload. timeScale is
// game minutes per real minute, so an in-game day is 24/timeScale real hours: 4 at the live 6, making a common crop 4 real
// hours instead of 24. Everything above ran with no clock, which is the real-hour fallback, so both paths are covered.
let scale = 6, epochReal = clock, epochDays = 100;
const gameDaysOf = () => epochDays + ((clock - epochReal) * scale) / 86400000;
globalThis.__dboClock = { gameDays: gameDaysOf, summary: () => ({ timeScale: scale }) };
// as /timescale does it: bank the game days elapsed so far, then change the rate
const setScale = (s) => { epochDays = gameDaysOf(); epochReal = clock; scale = s; };
// hold exactly one kind of crop, so `use` plants it rather than asking which; the planter is emptied the same way a pick
// leaves it, without rolling for yield
const only = (base, n) => setp(OWNER, 'inventory', { entries: [{ baseId: base, count: n }] });
const empty = (it) => { it.crop = null; it.show = null; };

ok(Math.round(T.msPerGameDay()) === 4 * HOUR, 'timeScale 6: an in-game day is 4 real hours', T.msPerGameDay());
ok(T.daysOf({ rare: false }) === 1 && T.daysOf({ rare: true }) === 2, 'growGameDays 1 for a common crop, rareGameDays 2 for a rare one', [T.daysOf({ rare: false }), T.daysOf({ rare: true })]);

empty(pl3); only(CABBAGE, 2); use(pl3.ref, OWNER);
ok(pl3.crop && pl3.crop.item === d(CABBAGE) && /ripens in one in-game day/.test(last(OWNER)), 'with the clock up: a common crop ripens in one in-game day', last(OWNER));
ok(Math.abs(Number(pl3.crop.ripeDay) - (gameDaysOf() + 1)) < 1e-9, '...the target is stored as a point on the world clock (ripeDay), not a real-time stamp', pl3.crop.ripeDay);
ok(use(pl3.ref, OWNER) === true && /growing; ready in 24 in-game hours/.test(last(OWNER)), '...and the time left is shown in in-game hours, not real ones', last(OWNER));
ok(/^growing, 24 in-game hours left$/.test(T.planterState(pl3)), '...as is the panel row', T.planterState(pl3));
clock += 3 * HOUR; timers['decor-grow']();
ok(!pl3.crop.ripe, '3 real hours in (18 in-game hours): still growing');
use(pl3.ref, OWNER);
ok(/growing; ready in 6 in-game hours/.test(last(OWNER)), '...with 6 in-game hours left', last(OWNER));
clock += HOUR + 1000; timers['decor-grow']();
ok(pl3.crop.ripe, '4 real hours: one in-game day has passed, so it is ripe - it was 24 real hours before this change');

// a rare crop is two in-game days, so 8 real hours at timeScale 6
empty(pl3); only(MOONSUGAR, 2); use(pl3.ref, OWNER);
ok(pl3.crop && pl3.crop.item === MOONSUGAR_D && /ripens in 2 in-game days/.test(last(OWNER)), 'a rare crop: two in-game days', last(OWNER));
clock += 7 * HOUR; timers['decor-grow']();
ok(!pl3.crop.ripe, '...not ripe at 7 real hours');
clock += HOUR + 1000; timers['decor-grow']();
ok(pl3.crop.ripe, '...ripe at 8 real hours');

// a crop planted BEFORE this change has no ripeDay: it keeps its planted time and simply ripens sooner
empty(pl3); only(CABBAGE, 2); use(pl3.ref, OWNER);
const plantedAt = clock;
delete pl3.crop.ripeDay; pl3.crop.ripeAt = clock + 24 * HOUR;   // exactly what the old code stored
clock += 3 * HOUR; timers['decor-grow']();
ok(!pl3.crop.ripe, 'a crop planted before the change: not ripe at 3 real hours');
clock += HOUR + 1000; timers['decor-grow']();
ok(pl3.crop.ripe && pl3.crop.at === plantedAt && pl3.crop.ripeDay === undefined, '...ripe at 4 real hours, counted from its own unchanged planted time, and nothing rewrote the stored crop', { at: pl3.crop.at, plantedAt, ripeDay: pl3.crop.ripeDay });

// /timescale moves a standing crop, because its target is a point on the clock rather than a stretch of real time
empty(pl3); only(CABBAGE, 2); use(pl3.ref, OWNER);
clock += 2 * HOUR;                      // half an in-game day at timeScale 6
setScale(12);                           // a game day is now 2 real hours, so the half left is 1 real hour
timers['decor-grow']();
ok(!pl3.crop.ripe, 'after /timescale 12 a standing crop is not ripe at once');
ok(/growing, 12 in-game hours left/.test(T.planterState(pl3)), '...it still has half an in-game day to go', T.planterState(pl3));
clock += HOUR - 2000; timers['decor-grow']();
ok(!pl3.crop.ripe, '...still growing just short of the real hour');
clock += 4000; timers['decor-grow']();
ok(pl3.crop.ripe, '...and ripe one real hour later, since half an in-game day was left and a day is now 2 real hours');
setScale(6);

// no world clock: the real-hour fallback, unchanged
empty(pl3); const savedClock = globalThis.__dboClock; globalThis.__dboClock = null;
only(CABBAGE, 2); use(pl3.ref, OWNER);
ok(/ripens in 24 hours/.test(last(OWNER)), 'with no world clock: the growHours fallback, said in real hours', last(OWNER));
ok(/growing, \d+ (minutes|hours) left/.test(T.planterState(pl3)), '...and the time left is real, not labelled in-game', T.planterState(pl3));
clock += 23 * HOUR; timers['decor-grow']();
ok(!pl3.crop.ripe, '...not ripe at 23 real hours');
clock += HOUR + 1000; timers['decor-grow']();
ok(pl3.crop.ripe, '...ripe at 24 real hours');
globalThis.__dboClock = savedClock;

// ---- mutants on the conversion ---------------------------------------------------------------------------------------------
// Each must break at least one of the three checks below, so the arithmetic above is known to be load-bearing rather than
// incidentally right. If a mutation no longer applies the conversion has moved, and the mutant says so instead of passing.
const SRC = fs.readFileSync(MODULE, 'utf8');
const MUTANTS = [
  ['the game day converted the wrong way up (s/24 for 24/s)', (s) => s.replace('(24 / s) * 3600000', '(s / 24) * 3600000')],
  ['timeScale ignored, so an in-game day is a real day', (s) => s.replace('(24 / s) * 3600000', '24 * 3600000')],
  ['a rare crop given the common crop\'s days', (s) => s.replace('Number(crop && crop.rare ? C.planter.rareGameDays : C.planter.growGameDays)', 'Number(C.planter.growGameDays)')],
  ['the time left counted in game days but labelled hours', (s) => s.replace('Math.ceil((ms / per) * 24)', 'Math.ceil(ms / per)')],
];
const mutantResults = (src) => {
  const p = path.join(scratch, `decor-mutant-${Math.random().toString(16).slice(2)}.js`);
  fs.writeFileSync(p, src);
  const M = require(p)(api)._test;
  return [
    Math.round(M.msPerGameDay()) === 4 * HOUR,
    M.daysOf({ rare: false }) === 1 && M.daysOf({ rare: true }) === 2,
    /^24 in-game hours$/.test(M.growWords(M.msPerGameDay())),
  ];
};
for (const [what, mutate] of MUTANTS) {
  const m = mutate(SRC);
  ok(m !== SRC && mutantResults(m).some((r) => !r), `mutant caught: ${what}`,
    m === SRC ? 'the mutation no longer applies (the conversion moved): update this mutant' : 'every check still passed');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
