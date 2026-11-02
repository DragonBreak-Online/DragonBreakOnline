// decor.js's study bookshelf, ticket mod-0584 (1 Nov): a player built two shelves, took both down a minute later to move
// them, and lost the 20 books in them (booksKept false: the books stay in a shelf for good). Then the GM's refund, a
// misc item named "Books" (a clutter pile, not a BOOK record), did not count, and the refusal never said why. The rule
// stays; this harness checks that it is said, that a take-down which loses books is asked twice, and that a build that
// fails takes nothing. Stub mp in a scratch directory, synthetic records only (setup from tests/decor-growing-harness.js).
//   node tests/decor-study-remove-harness.js [decor.js to test]   (from server/)
// Without an argument it also runs in-file mutants of decor.js; each must make at least one check fail.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const MODULE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'decor.js'));
const SKILLS = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'skills.json'), 'utf8'));
const G = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'decor-growing.json'), 'utf8'));
const scratch = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-decor-study-remove-'));
process.chdir(scratch);
process.on('exit', () => { process.chdir(os.tmpdir()); try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* the OS */ } });

let clock = Date.parse('2026-11-01T09:38:00Z');
Date.now = () => clock;
Math.random = () => 0.5;

const CELL = 0x100, WORLD = 0x3c, DOOR = 0x200, OUTDOOR = 0x201;
const OWNER = 0xff000001;
const WOOD = 0x6f993, IRON = 0x5ace4, SALT = 0x34cdf, STONE = 0x71cf3;
// made-up ids: a readable book worth 14, a cheap one worth 6, a misc "Books" pile worth 500, a skill book, a note
const NOVEL = 0xb001, CHEAP = 0xb002, PILE = 0xb003, SKILLBOOK = 0xb004, NOTE = 0xb005;
const SHELF_D = 'd800:DragonBreak Online Edits.esp', PLANTER_D = 'd801:DragonBreak Online Edits.esp', SOIL_D = 'd802:DragonBreak Online Edits.esp'; // verify-formids: ignore (made-up ids for a stub)
const d = (id) => `${id.toString(16)}:Skyrim.esm`;
fs.writeFileSync('housing.json', JSON.stringify([DOOR]));
fs.writeFileSync('skills.json', JSON.stringify({ skills: SKILLS.skills.filter((k) => k.id === 'woodcutter' || k.id === 'harvesting') }));
fs.writeFileSync('doors-pos.json', JSON.stringify({ doors: {} }));
fs.writeFileSync('decor-catalog.json', JSON.stringify({ groups: [] }));
G.pieces[0].desc = SHELF_D; G.pieces[1].desc = PLANTER_D; G.soil.desc = SOIL_D; G.crops = [];
fs.writeFileSync('decor-growing.json', JSON.stringify(G));

const props = new Map();
const setp = (id, k, v) => props.set(`${id}|${k}`, v);
const getp = (id, k) => props.get(`${id}|${k}`);
setp(DOOR, 'private.housing', { owner: 7, ownerChar: OWNER, ownerName: 'Olaf', partner: OUTDOOR, place: { cells: [d(CELL)], builtAt: 1 } });
setp(DOOR, 'worldOrCellDesc', d(CELL)); setp(OUTDOOR, 'worldOrCellDesc', d(WORLD));
setp(OWNER, 'worldOrCellDesc', d(CELL)); setp(OWNER, 'pos', [1000, 1000, 50]); setp(OWNER, 'angle', [0, 0, 0]); setp(OWNER, 'profileId', 7); setp(OWNER, 'inventory', { entries: [] });
// BOOK DATA: flags u8 (0x1 skill, 0x4 spell), type u8, u16, teaches u32, value u32, weight f32; MISC DATA: value u32, weight f32
const book = (flags, value) => { const b = new Uint8Array(16); const v = new DataView(b.buffer); v.setUint8(0, flags); v.setUint32(8, value, true); return { type: 'BOOK', editorId: 'B', fields: [{ type: 'DATA', data: b }] }; };
const misc = (value) => { const b = new Uint8Array(8); new DataView(b.buffer).setUint32(0, value, true); return { type: 'MISC', editorId: 'M', fields: [{ type: 'DATA', data: b }] }; };
const RECORDS = { [CELL]: { type: 'CELL' }, [WORLD]: { type: 'WRLD' }, [NOVEL]: book(0, 14), [CHEAP]: book(0, 6), [PILE]: misc(500), [SKILLBOOK]: book(1, 50), [NOTE]: book(0, 0) };
const idOf = (x) => { const [h, p] = String(x).split(':'); return (parseInt(h, 16) | (/DragonBreak Online Edits/.test(p || '') ? 0x60000000 : 0)) >>> 0; };
const said = [], ui = {}, packets = [], placed = [], audits = [], logs = [];
let failCreate = false;
const mp = {
  get: getp, set: setp, getIdFromDesc: idOf, getDescFromId: (id) => (id >>> 0).toString(16),
  lookupEspmRecordById: (id) => (RECORDS[id] ? { record: RECORDS[id] } : null),
  callPapyrusFunction: (kind, cls, fn, self, args) => {
    const id = parseInt(self.desc, 16) >>> 0;
    if (fn === 'PlaceAtMe') { if (failCreate) return null; const n = 0xff0000a0 + placed.length; placed.push(n); setp(n, 'worldOrCellDesc', getp(id, 'worldOrCellDesc')); setp(n, 'baseDesc', args[0].desc); return { desc: n.toString(16) }; }
    if (fn === 'SetPosition') setp(id, 'pos', args.slice(0, 3));
    return null;
  },
};
const onUi = (n, f) => { (ui[n] = ui[n] || []).push(f); };
const fire = (n, a, args) => (ui[n] || []).forEach((f) => f(a, args));
const cmds = {};
const giveItem = (a, baseId, count) => { const e = (getp(a, 'inventory') || { entries: [] }).entries.map((x) => Object.assign({}, x)); const h = e.find((x) => x.baseId === baseId); if (h) h.count += count; else e.push({ baseId, count }); setp(a, 'inventory', { entries: e }); return true; };
const held = (a, id) => getp(a, 'inventory').entries.filter((e) => e.baseId === id).reduce((n, e) => n + e.count, 0);
const cfg = { decor: { enabled: true, perSecond: 0, perHour: 1000, budgets: [{ pieces: 20, lights: 1, stations: 1, containers: 1 }] } };
const api = {
  mp, log: (...x) => logs.push(x.join(' ')), audit: (t) => audits.push(t), who: () => 'Olaf', personal: (a, t) => said.push([a, t]),
  onUi, sendPacket: (a, p) => { packets.push([a, p]); return true; }, registerChatCommand: (n, f) => { cmds[n] = f; },
  onlineActors: () => [OWNER], isAdmin: () => false, tierOf: () => null, giveItem, findByName: () => 0, every: () => {}, cfg, itemName: () => '',
};
let fails = 0;
const ok = (c, what, detail) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!c) fails++; };
const last = () => (said.length ? said[said.length - 1][1] : '');
const lastEdit = () => { for (let i = packets.length - 1; i >= 0; i--) if (packets[i][1].customPacketType === 'placeEdit') return packets[i][1]; return null; };
const load = () => { globalThis.__dboDecor = undefined; globalThis.__dboDecorActivate = undefined; delete require.cache[MODULE]; for (const k of Object.keys(ui)) delete ui[k]; return require(MODULE)(api)._test; };
let T = load();
const items = () => (T.reg().places[DOOR.toString(16)] || { items: [] }).items;
const shelves = () => items().filter((i) => i.kind === 'study');
const cmd = (s) => cmds.decor(OWNER, s);
let spot = 0;
const placeAt = (n) => { cmd('find ' + n); cmd('place 1'); const e = lastEdit(); packets.length = 0; if (e) fire('placeMove', OWNER, [e.id, [1080 + 40 * (spot++ % 4), 1000 + 80 * Math.floor(spot / 4), 50], [0, 0, 90]]); return e; };
const removeNo = (it) => { cmd('list'); cmd(`remove ${items().indexOf(it) + 1}`); };
const materials = () => [WOOD, IRON, SALT, STONE].map((id) => held(OWNER, id)).join(',');
giveItem(OWNER, WOOD, 200); giveItem(OWNER, IRON, 40); giveItem(OWNER, SALT, 20); giveItem(OWNER, STONE, 40);

// ---- (b) which books count: a misc "Books" pile does not, and the refusal says so --------------------------------------
giveItem(OWNER, PILE, 30); giveItem(OWNER, SKILLBOOK, 2); giveItem(OWNER, NOTE, 4);
cmd('find study'); cmd('place 1');
ok(!lastEdit() && /needs 10 books .*you have 0 that count/.test(last()), '30 clutter "Books" piles, skill books and notes: none count, refused before the preview', last());
ok(/clutter book piles do not count/.test(last()) && /readable books worth 5 gold or more/.test(last()), '...and the refusal names the rule: readable books worth 5 or more, no clutter piles, tomes, skill books or notes', last());

// ---- placing: books recorded and audited, and the message says they stay -----------------------------------------------
// two inventory entries of one book (the pack can hold a book twice): 6 + 6 carried, 10 taken, 2 left
setp(OWNER, 'inventory', { entries: getp(OWNER, 'inventory').entries.concat([{ baseId: NOVEL, count: 6 }, { baseId: NOVEL, count: 6 }]) });
const wood0 = held(OWNER, WOOD);
placeAt('study');
ok(shelves().length === 1, 'with 12 readable books: the shelf is placed', items());
ok(held(OWNER, NOVEL) === 2 && JSON.stringify(shelves()[0].books) === JSON.stringify({ [NOVEL.toString(16)]: 10 }), 'a book held as two entries: 10 taken and 10 recorded on the shelf, 2 left', { held: held(OWNER, NOVEL), books: shelves()[0].books });
ok(held(OWNER, PILE) === 30 && held(OWNER, SKILLBOOK) === 2 && held(OWNER, NOTE) === 4, 'the piles, skill books and notes are untouched');
ok(wood0 > held(OWNER, WOOD), 'the materials were paid');
ok(/books stay in the shelf for good/.test(last()) && /\/decor move/.test(last()) && /\/decor undo within 60 seconds gives everything back/.test(last()), 'the place message says the books stay and points at /decor move and undo', last());
ok(audits.some((t) => /^DECOR place Olaf .*Study Bookshelf .* books \{"b001":10\}$/.test(t)), 'the place audit line names the books taken', audits[audits.length - 1]);

// ---- (a) taking a shelf down that keeps its books is asked twice ---------------------------------------------------------
clock += 120000; // past the undo window, as on 1 Nov (placed 09:38, removed 09:40)
const s1 = shelves()[0], m1 = materials(), n1 = held(OWNER, NOVEL);
removeNo(s1);
ok(shelves().includes(s1) && materials() === m1 && held(OWNER, NOVEL) === n1, 'the first /decor remove takes nothing down and gives nothing', { shelves: shelves().length, m1, now: materials() });
ok(/loses the 10 books in it for good/.test(last()) && /use \/decor move instead/.test(last()) && /again within 30 seconds/.test(last()), '...it warns: the 10 books are lost, use /decor move, repeat within 30 seconds', last());
clock += 5000;
removeNo(s1);
ok(!shelves().includes(s1) && held(OWNER, NOVEL) === n1, 'repeated within the window: taken down, and (booksKept false, by design) no books back', { shelves: shelves().length, novels: held(OWNER, NOVEL) });
ok(audits.some((t) => /^DECOR deconstruct Olaf .* books lost with it \{"b001":10\}$/.test(t)), 'the deconstruct audit line names the books lost', audits[audits.length - 1]);

// the select tool's Delete key asks twice too; a warning for one shelf does not confirm another; the warning expires
giveItem(OWNER, CHEAP, 40);
placeAt('study'); placeAt('study');
const [a1, a2] = shelves();
clock += 120000;
fire('placeDelete', OWNER, [a1.ref]);
ok(shelves().includes(a1) && /loses the 10 books/.test(last()), 'select-tool Delete: the first press warns, nothing taken down', last());
fire('placeDelete', OWNER, [a2.ref]);
ok(shelves().includes(a2) && /loses the 10 books/.test(last()), 'a warning for one shelf does not take down another: the second shelf warns for itself', last());
clock += 31000;
fire('placeDelete', OWNER, [a2.ref]);
ok(shelves().includes(a2) && /loses the 10 books/.test(last()), 'past removeConfirmSeconds the warning has lapsed: it warns again, nothing taken down', last());
fire('placeDelete', OWNER, [a2.ref]);
ok(!shelves().includes(a2) && shelves().includes(a1), 'Delete pressed again in time takes that shelf down, and only that one');

// a piece holding no books is taken down at once, as before
placeAt('planter');
const pl = items().find((i) => i.kind === 'planter');
clock += 120000;
removeNo(pl);
ok(!items().includes(pl), 'a planter (no books) is taken down on the first /decor remove');

// /decor undo inside the window gives everything back, books too, with no question
const m2 = materials(), c2 = held(OWNER, CHEAP);
placeAt('study');
cmd('undo');
ok(materials() === m2 && held(OWNER, CHEAP) === c2 && shelves().length === 1, '/decor undo within the window: shelf gone, materials and books all back, no confirm', { m2, now: materials(), c2, cheap: held(OWNER, CHEAP) });

// ---- a build that fails takes nothing -----------------------------------------------------------------------------------
const m3 = materials(), c3 = held(OWNER, CHEAP), n3 = shelves().length;
failCreate = true; placeAt('study'); failCreate = false;
ok(shelves().length === n3 && materials() === m3 && held(OWNER, CHEAP) === c3 && /could not be placed; your materials are back/.test(last()), 'the placement fails: no shelf, every material and book back', { m3, now: materials(), c3, cheap: held(OWNER, CHEAP), said: last() });
// books gone between the preview and Enter (put in a chest): refused at Enter with nothing taken
cmd('find study'); cmd('place 1');
const e = lastEdit(); packets.length = 0;
const keep = getp(OWNER, 'inventory'); setp(OWNER, 'inventory', { entries: keep.entries.filter((x) => x.baseId !== CHEAP && x.baseId !== NOVEL) });
const m4 = materials();
fire('placeMove', OWNER, [e.id, [1300, 1300, 50], [0, 0, 90]]);
ok(shelves().length === n3 && materials() === m4 && /Nothing was taken/.test(last()), 'books gone by the time Enter is pressed: refused, nothing taken, and the player is told so', last());
setp(OWNER, 'inventory', keep);

// ---- booksKept true: no question, the books come back ---------------------------------------------------------------------
cfg.decor.study = { booksKept: true };
T = load();
const k1 = shelves()[0], c5 = held(OWNER, CHEAP);
clock += 120000;
removeNo(k1);
ok(!shelves().includes(k1) && held(OWNER, CHEAP) === c5 + 10, 'booksKept true: taken down on the first remove, its 10 books back', { cheap: held(OWNER, CHEAP) - c5 });
delete cfg.decor.study;

// ---- mutants -------------------------------------------------------------------------------------------------------------
if (!process.env.DBO_MUTANT_RUN) {
  const SRC = fs.readFileSync(MODULE, 'utf8');
  const MUTANTS = [
    ['no confirm before a take-down that loses books', "if (share === 'deconstruct' && it.books && !C.study.booksKept", "if (false && share === 'deconstruct' && it.books && !C.study.booksKept"],
    ['a warning for any shelf confirms every shelf', '!ask || ask.ref !== it.ref ||', '!ask ||'],
    ['the warning never lapses', ' || Date.now() > ask.until)', ')'],
    ['takeBooks keeps only the last entry of a book', 'out[dd] = (out[dd] || 0) + k', 'out[dd] = k'],
    ['the place message no longer says the books stay', 'const kept = books && !C.study.booksKept ?', 'const kept = false ?'],
    ['a failed placement keeps the books', 'if (books) giveAll(a, books, 1); return refuse(', 'return refuse('],
    ['the refusal no longer names the rule', '(${bookRule()}); you have ${booksHeld(a)} that count.`);', '; you have ${booksHeld(a)} that count.`);'],
  ];
  for (const [name, from, to] of MUTANTS) {
    if (!SRC.includes(from)) { ok(false, `mutant "${name}": its text is still in decor.js`, from); continue; }
    const f = path.join(scratch, 'decor-mutant.js');
    fs.writeFileSync(f, SRC.replace(from, to));
    let out = '';
    try { out = execFileSync(process.execPath, [__filename, f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { DBO_MUTANT_RUN: '1' }) }); } catch (x) { out = String(x.stdout || '') + '\nFAIL crashed'; }
    ok(/^FAIL/m.test(out), `mutant caught: ${name}`);
  }
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
