// A player's own home is not theft, server half (fork housingSystem.ts; Nat, 31 Oct: players get "stolen"
// items out of their own home barrels, because Skyrim's crime system sees the plugin's containers as
// NPC-owned). The server tells each client which cells that player owns outright - at login and after any
// ownership change - and the client half owns those cells so vanilla crime stops firing there.
//
// Cell-level and for the SOLE OWNER only, nothing for decorate rights (Nat via the Leader): owning a cell
// makes everything in it un-stealable, which is right for your own house and wrong for a shared one.
//
//   node tests/home-cells-server-harness.js <bundled housingSystem.js>
'use strict';
const fs = require('fs');
const path = require('path');
const bundle = process.argv[2];
if (!bundle) { console.error('usage: node tests/home-cells-server-harness.js <bundled housingSystem.js>'); process.exit(2); }
const { HousingSystem } = require(path.resolve(bundle));
if (typeof HousingSystem.prototype.homeCellsOf !== 'function') {
  require('./expect')('home-cells', 'this housingSystem has no home cells');
  console.log('ok   skipped: this housingSystem does not send home cells');
  process.exit(0);
}
let fails = 0;
const ok = (c, what, got) => {
  console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`);
  if (!c) fails++;
};

const H = (n) => (0x08000000 | n) >>> 0;
// a house: its street door and its inside door, in two different cells
const DOOR = H(0x100), DOOR_IN = H(0x101);
// a second property of the same owner, a loose chest with no partner
const CHEST = H(0x110);
// somebody else's house
const OTHER = H(0x120), OTHER_IN = H(0x121);
// a property whose record has gone, with the index entry left behind
const STALE = H(0x130);
// a property that was given up: the record is there, the owner is 0
const GIVEN_UP = H(0x140);
const EXTERIOR = H(0x900);

const CELL_OUT = H(0x001), CELL_IN = H(0x002), CELL_CHEST = H(0x003), CELL_OTHER = H(0x004);
const CELLS = {
  [DOOR]: CELL_OUT, [DOOR_IN]: CELL_IN, [CHEST]: CELL_CHEST,
  [OTHER]: CELL_OUT, [OTHER_IN]: CELL_OTHER, [GIVEN_UP]: CELL_CHEST, [EXTERIOR]: 0,
};
const PARTNER = { [DOOR]: DOOR_IN, [DOOR_IN]: DOOR, [OTHER]: OTHER_IN, [OTHER_IN]: OTHER };

const ME = 60, THEM = 62;
const MY_ACTOR = 0xff000060, THEIR_ACTOR = 0xff000062;
const PROFILE = { [MY_ACTOR]: ME, [THEIR_ACTOR]: THEM };
const MY_USER = 1, THEIR_USER = 2;
const ACTOR_OF = { [MY_USER]: MY_ACTOR, [THEIR_USER]: THEIR_ACTOR };

const records = new Map();
const reset = () => {
  records.clear();
  records.set(DOOR, { owner: ME, partner: DOOR_IN });
  records.set(CHEST, { owner: ME });
  records.set(OTHER, { owner: THEM, partner: OTHER_IN });
  records.set(GIVEN_UP, { owner: 0 });
  // STALE deliberately has no record
};

let indexed = [];
let indexThrows = false;
const asked = [];
const mp = {
  // What the lookup was asked is recorded and checked once, below. Asserting inside the stub printed the same
  // two lines on every call and buried everything else.
  findFormsByPropertyValue: (prop, value) => {
    asked.push({ prop, value });
    if (indexThrows) throw new Error('index unavailable');
    return indexed.filter((e) => String(e.owner) === String(value)).map((e) => e.id);
  },
};
const ctx = { svr: mp };

const sent = [];
const sys = new HousingSystem(() => {});
sys.read = (c, id) => records.get(id >>> 0) || null;
sys.cellOf = (c, id) => CELLS[id >>> 0] || 0;
sys.partnerOf = (c, id) => PARTNER[id >>> 0] || 0;
sys.actorOf = (c, userId) => ACTOR_OF[userId] || 0;
sys.profileOf = (c, actorId) => PROFILE[actorId >>> 0] || 0;
sys.onlineUsers = () => [MY_USER, THEIR_USER];
sys.send = (c, userId, payload) => sent.push({ userId, payload });

reset();
indexed = [{ id: DOOR, owner: ME }, { id: CHEST, owner: ME }, { id: OTHER, owner: THEM }];

// ---- homeCellsOf ------------------------------------------------------------------------------------------
let cells = sys.homeCellsOf(ctx, ME).map(Number).sort();
ok(asked.length === 1 && asked[0].prop === 'private.indexed.housingOwner',
  'the lookup goes through the owner index, not a scan of every form', asked);
ok(asked.every((a) => typeof a.value === 'string'),
  'the index is queried with a STRING, as its C++ helper requires', asked.map((a) => typeof a.value));
ok(JSON.stringify(cells) === JSON.stringify([CELL_OUT, CELL_IN, CELL_CHEST].sort()),
  'both halves of the door pair are offered, plus the loose chest\'s cell', cells);
ok(!cells.includes(CELL_OTHER), 'another player\'s house is not in the list', cells);
ok(JSON.stringify(sys.homeCellsOf(ctx, THEM).map(Number).sort()) === JSON.stringify([CELL_OUT, CELL_OTHER].sort()),
  'the other player gets their own, and the shared exterior cell', sys.homeCellsOf(ctx, THEM));
ok(JSON.stringify(sys.homeCellsOf(ctx, 0)) === '[]', 'no profile means no cells, and no lookup at all');

// a stale index entry: the record has gone
indexed.push({ id: STALE, owner: ME });
ok(JSON.stringify(sys.homeCellsOf(ctx, ME).map(Number).sort()) === JSON.stringify([CELL_OUT, CELL_IN, CELL_CHEST].sort()),
  'an index entry whose record has gone is skipped, not sent as a cell of 0', sys.homeCellsOf(ctx, ME));

// an index entry for a property that was given up keeps its stub with owner 0
indexed.push({ id: GIVEN_UP, owner: ME });
ok(!sys.homeCellsOf(ctx, ME).map(Number).includes(CELL_CHEST) === false &&
   sys.homeCellsOf(ctx, ME).filter((c) => Number(c) === CELL_CHEST).length === 1,
  'a given-up property adds nothing: only a live owner counts, and its cell appears once from the chest',
  sys.homeCellsOf(ctx, ME));

// an index entry naming a different owner than the record
records.set(CHEST, { owner: THEM });
ok(!sys.homeCellsOf(ctx, ME).map(Number).includes(CELL_CHEST),
  'an index entry whose record names a different owner is skipped', sys.homeCellsOf(ctx, ME));
records.set(CHEST, { owner: ME });

// a cell of 0 is never added
indexed.push({ id: EXTERIOR, owner: ME });
records.set(EXTERIOR, { owner: ME });
ok(!sys.homeCellsOf(ctx, ME).map(Number).includes(0), 'a ref with no cell adds nothing', sys.homeCellsOf(ctx, ME));

// the index being unavailable must not throw out of a login
indexThrows = true;
let threw = false;
try { cells = sys.homeCellsOf(ctx, ME); } catch { threw = true; }
ok(!threw && JSON.stringify(cells) === '[]', 'the index throwing gives no cells and does not throw out of a login');
indexThrows = false;

// ---- sendHomeCells ----------------------------------------------------------------------------------------
reset();
indexed = [{ id: DOOR, owner: ME }];
sent.length = 0;
sys.sendHomeCells(ctx, MY_USER);
ok(sent.length === 1 && sent[0].userId === MY_USER, 'the owner is sent exactly one packet', sent);
ok(sent[0].payload.customPacketType === 'homeCells', 'the packet type is homeCells', sent[0].payload);
ok(Array.isArray(sent[0].payload.cells) && sent[0].payload.cells.map(Number).sort().join() === [CELL_OUT, CELL_IN].sort().join(),
  'it carries both cells of the pair', sent[0].payload.cells);
sent.length = 0;
sys.sendHomeCells(ctx, 99);
ok(sent.length === 0, 'a user with no actor is sent nothing');

// ---- markHomeCells and flushHomeCells ---------------------------------------------------------------------
sent.length = 0;
sys.flushHomeCells(ctx);
ok(sent.length === 0, 'a flush with nothing marked sends nothing, so an idle update costs no packet');

sys.markHomeCells(ME);
sys.flushHomeCells(ctx);
ok(sent.length === 1 && sent[0].userId === MY_USER,
  'a marked profile is sent its cells on the next flush, and only that profile', sent.map((s) => s.userId));

sent.length = 0;
sys.flushHomeCells(ctx);
ok(sent.length === 0, 'the mark is cleared by the flush, so it does not resend every update');

sent.length = 0;
sys.markHomeCells(ME);
sys.markHomeCells(ME);
sys.markHomeCells(ME);
sys.flushHomeCells(ctx);
ok(sent.length === 1, 'three changes in one tick cost one packet');

sent.length = 0;
sys.markHomeCells(0);
sys.flushHomeCells(ctx);
ok(sent.length === 0, 'marking profile 0 marks nothing');

sent.length = 0;
sys.markHomeCells(ME);
sys.markHomeCells(THEM);
sys.flushHomeCells(ctx);
ok(sent.length === 2 && sent.map((s) => s.userId).sort().join() === [MY_USER, THEIR_USER].sort().join(),
  'both sides of a hand-over are sent in the same flush', sent.map((s) => s.userId));

sent.length = 0;
sys.markHomeCells(999);
sys.flushHomeCells(ctx);
ok(sent.length === 0, 'a marked profile with nobody online is sent nothing and is not left marked');
sent.length = 0;
sys.flushHomeCells(ctx);
ok(sent.length === 0, '...and it is not still pending afterwards');

// ---- the wiring, read out of the system's own source -------------------------------------------------------
const tsPath = process.argv[3] ||
  path.resolve(__dirname, '..', '..', 'fork', 'skymp5-server', 'ts', 'systems', 'housingSystem.ts');
if (fs.existsSync(tsPath)) {
  const src = fs.readFileSync(tsPath, 'utf8').split('\r\n').join('\n');
  const fn = (name) => {
    const i = src.indexOf(`private ${name}(`);
    if (i < 0) return '';
    const j = src.indexOf('\n  }', i);
    return j < 0 ? src.slice(i) : src.slice(i, j);
  };
  ok(/this\.sendHomeCells\(ctx, userId\)/.test(fn('onActorAssigned')),
    'the login send hangs off onActorAssigned, which is already wired to userAssignActor');
  ok(/this\.flushHomeCells\(ctx\)/.test(fn('updateAsync')) || /flushHomeCells\(ctx\)/.test(src),
    'the flush runs on update, so no packet goes out in the middle of a claim');
  const setOwner = fn('setOwner');
  ok(/markHomeCells\(rec\.owner\)[\s\S]*rec\.owner = profileId[\s\S]*markHomeCells\(profileId\)/.test(setOwner),
    'setOwner marks the OLD owner before overwriting it and the new one after, so a hand-over covers both');
  ok(/markHomeCells\(rec\.owner\)/.test(fn('release')),
    'release marks the owner losing the property (abandon and revoke both come through it)');
  // There is no owner-inheritance function to point at - a member's owner is resolved by reading its root -
  // so the decision is pinned by the COUNT of mark sites instead, which fails if anyone adds one. Three:
  // release, and setOwner twice (old owner then new).
  const markSites = (src.match(/this\.markHomeCells\(/g) || []).length;
  ok(markSites === 3,
    'exactly three places mark: release, and setOwner for each side. Place members are deliberately not ' +
    'marked, since a member sits in the same cells as its root, so inheriting an owner cannot change the list',
    markSites);
} else {
  console.log(`ok   skipped the source-wiring checks: ${tsPath} not found`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
