// mod-0577: what a smith is told when a schematic is above their craft tier.
//
//   node tests/manual-craft-tier-harness.js     (from server/)
//
// Its own harness rather than a block in manuals-harness.js, because with smithing ON manuals.js builds its
// manual list from smithing.json's families instead of manuals.json - so the shared harness's book ids are not
// manuals at all on this path, and nothing is ever said. That is why this branch had no coverage: it is only
// reachable with smithing enabled, and the one harness that reads manuals.js runs it off.
//
// xmonokiinx (1 Nov 2026) read the Ancient Imperial schematic twice at craft tier 1 against its tier 2, kept the
// book both times, and opened a ticket saying the recipe had never been set up. The recipes exist and are
// ungated: seven forge COBJs for that armour in 1AncientImperial.esp, ten more for the family's weapons in
// DragonBreak Nexus Patches.esp. He was refused correctly and told nothing he could act on.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-craft-tier-'));
const here = path.resolve(__dirname, '..');
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

// smithing.json as manuals.js reads it on this path: one tier-2 family with a schematic, which is the shape of
// Ancient Imperial (tier 2, held, its own bookId, no technique and not free - the four things that put a family
// in the manual list).
const BOOK_DESC = '192e60:DragonBreak Online Edits.esp';
fs.writeFileSync('smithing.json', JSON.stringify({
  tierNames: ['Novice', 'Apprentice', 'Journeyman', 'Adept', 'Expert', 'Master', 'Grandmaster'],
  families: [{ id: 'ancient_imperial', name: 'Ancient Imperial', tier: 2, held: true, bookId: BOOK_DESC }],
}));

const BOOK_ID = 0x40192e60;
const props = new Map();
const said = [];
const audits = [];
const noop = () => {};
const mp = {
  get: (id, p) => props.get(id + '|' + p),
  set: (id, p, v) => { props.set(id + '|' + p, v); },
  getIdFromDesc: (d) => (String(d) === BOOK_DESC ? BOOK_ID : 0),
  getDescFromId: (id) => (id === BOOK_ID ? BOOK_DESC : ''),
  lookupEspmRecordById: (id) => (id === BOOK_ID
    ? { record: { type: 'BOOK', editorId: 'DBOSchematicAncientImperial', fields: [] } }
    : null),
};
const api = {
  mp, log: noop, personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t),
  who: (a) => `P${a.toString(16)}`, display: () => 'Smith', giveItem: () => true, takeGold: () => true,
  depositToTreasury: noop, registerChatCommand: noop, onlineActors: () => [A], every: noop,
  findByName: () => null, notify: noop,
  cfg: { manuals: { enabled: true }, smithing: { enabled: true } },
};

const A = 0x21;
props.set(A + '|profileId', 1);
// A Blacksmith at rank 1, which is craft tier 1 against the family's tier 2
props.set(A + '|private.mastery', { v: 2, order: ['blacksmith'], skills: { blacksmith: { level: 1, xp: 0, rank: 0 } } });
globalThis.__dboSmithCraftTier = () => 1;
globalThis.__dboSmithPointsForTier = (tier) => [0, 15, 30, 45, 60, 76, 91][Math.max(0, Math.floor(Number(tier) || 1) - 1)] || 0;

require(path.join(here, 'manuals.js'))(api);

let failures = 0;
let checks = 0;
const check = (name, ok, detail) => {
  checks++;
  if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); }
  else console.log(`ok   ${name}`);
};

const told = () => said.filter((p) => p[0] === A).map((p) => p[1]).join(' | ');

// The read a tier-1 smith makes of a tier-2 schematic
const verdict = globalThis.__dboManualsRead(A, BOOK_ID);
const lines = told();

check('the read is refused, so the book is not spent', verdict === false, verdict);
check('the schematic is not learned', !(props.get(A + '|private.dboManuals') || {}).ancient_imperial,
  props.get(A + '|private.dboManuals'));
check('the smith is told the work is above their craft tier, and what theirs is',
  /craft tier 2 work/.test(lines) && /your Blacksmith craft tier is 1/.test(lines), lines);
// The point of mod-0577: a refusal that names no way forward reads as "this does not exist"
check('...and the Blacksmith points that reach that tier, so there is something to do about it',
  /Craft tier 2 comes at Blacksmith 15\./.test(lines), lines);
check('...and that the book will still teach them, so keeping it does not read as success',
  /will teach you once you are there/.test(lines), lines);
check('the refusal is audited with both tiers, so staff need not reproduce it',
  audits.some((t) => /could not follow Ancient Imperial \(craft tier 2\) at craft tier 1/.test(t)), audits);

// A smith who reaches the tier learns it, so the gate is a gate and not a wall
said.length = 0;
globalThis.__dboSmithCraftTier = () => 2;
const ok2 = globalThis.__dboManualsRead(A, BOOK_ID);
check('at craft tier 2 the same schematic is read and the technique learned',
  ok2 !== false && !!(props.get(A + '|private.dboManuals') || {}).ancient_imperial,
  [ok2, props.get(A + '|private.dboManuals'), told()]);

console.log(`\n${checks - failures}/${checks} passed`);
process.chdir(os.tmpdir());
process.exit(failures ? 1 : 0);
