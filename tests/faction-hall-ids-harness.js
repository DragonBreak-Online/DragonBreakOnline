// Every faction's lore seat (guild-defs.json "hall"), checked as data: Nate, 16 Oct, after Skyrim opened: "did you make
// sure all factions own their usual places, like the vigilant of stendarr". Each hall named below has a name, a zone, its
// doors (the ways in, standing outside it) and its cells (its interior rooms); every door and cell id is one the
// faction-halls-1016 worker found in the live load order, not deleted (tests/fixtures/faction-hall-ids.json, with the
// plugin whose record wins); no door belongs to two halls unless all of them but one are marked shared (Bruma Castle,
// the Palace of the Kings); and the Thalmor sit in their Bruma embassy, not in Bruma Castle.
//
//   node tests/faction-hall-ids-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');

const DEFS = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'guild-defs.json'), 'utf8'));
const FIX = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'faction-hall-ids.json'), 'utf8'));

let fail = 0, n = 0;
const ok = (c, what, extra) => { n++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || extra === undefined ? '' : ': ' + JSON.stringify(extra)}`); if (!c) fail++; };
const byId = new Map(DEFS.factions.map((f) => [f.id, f]));

// The factions Nate asked to seat, with the zone each hall stands in
const EXPECT = {
  'hold-whiterun': 'whiterun', 'hold-riften': 'riften', 'hold-solitude': 'solitude', 'hold-windhelm': 'windhelm',
  'hold-markarth': 'markarth', 'hold-falkreath': 'falkreath', 'hold-morthal': 'morthal', 'hold-dawnstar': 'dawnstar',
  'hold-winterhold': 'winterhold',
  'clan-largashbur': 'largashbur', 'clan-narzulbur': 'narzulbur', 'clan-dushnikh-yal': 'dushnikh-yal',
  'clan-mor-khazgur': 'mor-khazgur', 'clan-cracked-tusk': 'cracked-tusk', 'clan-gol-kharzum': 'gol-kharzum',
  'vigil-of-stendarr': 'dawnstar', 'college-of-winterhold': 'winterhold', 'companions': 'whiterun',
  'bards-college': 'solitude', 'stormcloaks': 'windhelm', 'dawnguard': 'riften', 'clan-volkihar': 'solitude',
  'silver-hand': 'dawnstar', 'thalmor': 'bruma', 'cult-nocturnal': 'falkreath',
};
const NAMES = {
  'vigil-of-stendarr': /Hall of the Vigilant/, 'college-of-winterhold': /College of Winterhold/, companions: /^Jorrvaskr$/,
  'bards-college': /Bards College/, stormcloaks: /Palace of the Kings/, 'hold-windhelm': /Palace of the Kings/,
  dawnguard: /^Fort Dawnguard$/, 'clan-volkihar': /^Castle Volkihar$/, 'silver-hand': /^Driftshade Refuge$/,
  'cult-nocturnal': /Twilight Sepulcher/, 'hold-whiterun': /^Dragonsreach$/, 'hold-riften': /^Mistveil Keep$/,
  'hold-solitude': /Blue Palace/, 'hold-markarth': /^Understone Keep$/, 'hold-morthal': /^Highmoon Hall$/,
  'hold-dawnstar': /White Hall/, 'hold-falkreath': /Jarl's Longhouse/, 'hold-winterhold': /Jarl's Longhouse/,
  'clan-cracked-tusk': /^Cracked Tusk Keep$/,
};

// ---- 1. every faction in the table has a whole hall ----
for (const [fid, zone] of Object.entries(EXPECT)) {
  const f = byId.get(fid), h = f && f.hall;
  ok(!!h && typeof h.name === 'string' && h.name.length > 0, `${fid} has a hall with a name`, h);
  if (!h) continue;
  ok(h.zone === zone, `${fid}'s hall stands in zone ${zone}`, h.zone);
  ok(Array.isArray(h.doors) && h.doors.length > 0, `${fid}'s hall lists its doors`, h.doors);
  ok(Array.isArray(h.cells) && h.cells.length > 0, `${fid}'s hall lists its cells`, h.cells);
  ok(typeof h.note === 'string' && h.note.length > 0 && !/Bruma lock|not reachable/.test(h.note), `${fid}'s hall says where it is`, h.note);
  if (NAMES[fid]) ok(NAMES[fid].test(h.name), `${fid} sits in ${NAMES[fid]}`, h.name);
}

// ---- 2. every door and cell in every hall is one found in the live plugins ----
const halls = DEFS.factions.filter((f) => f.hall);
for (const f of halls) {
  const h = f.hall;
  const badDoors = (h.doors || []).filter((d) => !FIX.doors[d]);
  const badCells = (h.cells || []).filter((c) => !FIX.cells[c]);
  ok(!badDoors.length, `${f.id}: every door is a verified door`, badDoors);
  ok(!badCells.length, `${f.id}: every cell is a verified cell`, badCells);
  ok(new Set(h.doors || []).size === (h.doors || []).length && new Set(h.cells || []).size === (h.cells || []).length, `${f.id}: no id listed twice`);
  // A door of a new hall stands outside it: it is never one of the hall's own cells' doors (the Synod's two basement
  // doors are the one older exception, kept as they were)
  if (f.id !== 'synod') ok((h.doors || []).every((d) => !(h.cells || []).includes(d)), `${f.id}: no door is listed as a cell`);
}
// Only the Thieves Guild's graveyard way in starts disabled in the plugins (a quest opens it), and it was there before
const disabled = Object.entries(FIX.doors).filter(([, v]) => v.initiallyDisabled).map(([k]) => k);
ok(disabled.length === 1 && disabled[0] === '2d2dd:Skyrim.esm' && byId.get('thieves-guild').hall.doors.includes('2d2dd:Skyrim.esm'),
  'no new hall door starts disabled (the Thieves Guild graveyard door is the known one)', disabled);
// The fixture holds nothing the halls do not use, so it cannot hide a removed id
const used = new Set(halls.flatMap((f) => (f.hall.doors || []).concat(f.hall.cells || [])));
const spare = Object.keys(FIX.doors).concat(Object.keys(FIX.cells)).filter((k) => !used.has(k));
ok(!spare.length, 'the fixture lists only ids the halls use', spare);

// ---- 3. no door is two halls' unless they share it ----
const owners = new Map();
for (const f of halls) for (const d of f.hall.doors || []) owners.set(d.toLowerCase(), (owners.get(d.toLowerCase()) || []).concat([f]));
const clashes = [];
for (const [d, fs2] of owners) if (fs2.length > 1 && fs2.filter((f) => !f.hall.shared).length > 1) clashes.push([d, fs2.map((f) => f.id)]);
ok(!clashes.length, 'no door of one hall is a door of another, except on halls marked shared', clashes);
const palace = byId.get('stormcloaks').hall, seat = byId.get('hold-windhelm').hall;
ok(palace.shared === true && !seat.shared && palace.doors.join() === seat.doors.join() && palace.cells.join() === seat.cells.join(),
  'the Stormcloaks share the Palace of the Kings, the seat of Windhelm\'s hold');
// Castle Dour stays out of it: the Legion keeps Bruma Castle
const legion = byId.get('imperial-legion').hall;
ok(legion.name === 'Bruma Castle' && legion.zone === 'bruma' && legion.doors.join() === 'b46a8:BSHeartland.esm' && legion.shared === true,
  'the Imperial Legion keeps Bruma Castle as it was', legion);

// ---- 4. the Thalmor are in their Bruma embassy ----
const th = byId.get('thalmor').hall;
ok(th.name === 'the Thalmor Embassy, Bruma' && th.zone === 'bruma', 'the Thalmor sit in the Thalmor Embassy, Bruma', th);
ok(th.doors.join() === '1784b8:DragonBreak Online Edits.esp', '...entered by its door by Fort Caractus', th.doors);
ok(th.cells.join() === '17826b:DragonBreak Online Edits.esp,1780c8:DragonBreak Online Edits.esp', '...its embassy and barracks are the hall', th.cells);
ok(!th.shared && !th.doors.includes('b46a8:BSHeartland.esm') && !/Legion|Bruma Castle/.test(th.note || ''), '...no longer shared with Bruma Castle', th);

// ---- 5. the old "outside the Bruma lock" notes are gone (Skyrim opened on 16 Oct) ----
const stale = halls.filter((f) => /Bruma lock|not reachable/.test(f.hall.note || '')).map((f) => f.id);
ok(!stale.length, 'no hall note says it is outside the Bruma lock', stale);

console.log(fail ? `${fail} of ${n} checks FAILED` : `all ${n} checks passed`);
process.exit(fail ? 1 : 0);
