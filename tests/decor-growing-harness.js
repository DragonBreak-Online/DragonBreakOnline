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
const CABBAGE = 0x64b3f, DEATHBELL = 0x516c8;
const NOVEL = 0xb001, CHEAP = 0xb002, SKILLBOOK = 0xb003, TOME = 0xb004, NOTE = 0xb005;
const SHELF_D = 'd800:DragonBreak Online Edits.esp', PLANTER_D = 'd801:DragonBreak Online Edits.esp', SOIL_D = 'd802:DragonBreak Online Edits.esp'; // verify-formids: ignore (made-up DLE ids: the merged ids are filled in later)
const CAB_STATIC = 'd803:DragonBreak Online Edits.esp', BELL_STATIC = 'd804:DragonBreak Online Edits.esp'; // verify-formids: ignore (made-up DLE ids: the merged ids are filled in later)
const d = (id) => `${id.toString(16)}:Skyrim.esm`;
fs.writeFileSync('housing.json', JSON.stringify([DOOR]));
fs.writeFileSync('skills.json', JSON.stringify({ skills: SKILLS.skills.filter((k) => k.id === 'woodcutter' || k.id === 'harvesting') }));
fs.writeFileSync('doors-pos.json', JSON.stringify({ doors: {} }));
fs.writeFileSync('decor-catalog.json', JSON.stringify({ groups: [] }));
const G = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'decor-growing.json'), 'utf8'));
const tracked = JSON.parse(JSON.stringify(G));
G.pieces[0].desc = SHELF_D; G.pieces[1].desc = PLANTER_D; G.soil.desc = SOIL_D;
G.crops = [Object.assign({}, G.crops.find((c) => c.item === d(CABBAGE)), { desc: CAB_STATIC }), Object.assign({}, G.crops.find((c) => c.item === d(DEATHBELL)), { desc: BELL_STATIC }), Object.assign({}, G.crops[2], { desc: null })];
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
const NAMES_OF = { [d(CABBAGE).toLowerCase()]: 'Cabbage', [d(DEATHBELL).toLowerCase()]: 'Deathbell' };
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
ok(tracked.pieces.every((p) => p.desc === null) && tracked.crops.length === 32 && tracked.crops.every((c) => c.desc === null && /^DBOPlanted/.test(c.edid)), 'decor-growing.json as tracked: 2 pieces and 32 crops by editor id, no descs yet', tracked.crops.length);
ok(tracked.pieces.every((p) => p.costA && p.costB), 'both pieces carry costA (Hearthfire) and costB (today\'s resources) as the catalogue does');
ok((SKILLS.skills.find((k) => k.id === 'harvesting').counts.activatePrefixes || []).includes('DBOPlanter'), 'skills.json: Harvesting counts a planter pick (activatePrefixes DBOPlanter)');

// ---- the study bookshelf ------------------------------------------------------------------------------------------------
giveItem(OWNER, WOOD, 100); giveItem(OWNER, IRON, 20); giveItem(OWNER, SALT, 20); giveItem(OWNER, STONE, 40);
cmd(OWNER, 'find study');
ok(/1\. Study Bookshelf \[study\]/.test(last(OWNER)), '/decor find study lists the shelf', last(OWNER));
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
ok(use(shelf1, OWNER) === true && /needs 2 study bookshelves; this home has 1/.test(last(OWNER)), 'one shelf: decor.js takes the use and says a study needs two', last(OWNER));
giveItem(OWNER, CHEAP, 30);
placeAt(OWNER, 'study');
ok(use(shelf1, OWNER) === false, 'two shelves: the use falls through to schools.js (Study Magic / Priest Studies)');
placeAt(OWNER, 'study');
cmd(OWNER, 'find study'); cmd(OWNER, 'place 1');
ok(items().filter((i) => i.kind === 'study').length === 3 && /its 3 study bookshelves already/.test(last(OWNER)), 'maxPerHome 3: the fourth is refused', last(OWNER));
const cheap0 = held(OWNER, CHEAP);
cmd(OWNER, 'list'); cmd(OWNER, 'remove 3');
ok(held(OWNER, CHEAP) === cheap0 && items().filter((i) => i.kind === 'study').length === 2, 'booksKept false: deconstructing a shelf gives no books back', held(OWNER, CHEAP) - cheap0);

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
ok(held(OWNER, CABBAGE) === cab0 + 4 && !pl.crop && !pl.show && deleted.includes(cropShow), 'a Master picks 4 (baseYield 2 x 2, chance 1), the planter empties', { got: held(OWNER, CABBAGE) - cab0 });
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
ok(held(OWNER, CABBAGE) === cab2 + 1 && /You pick 1/.test(last(OWNER)), 'unskilled, the roll misses (0.3 over 0.25): missYield 1', last(OWNER));

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

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
