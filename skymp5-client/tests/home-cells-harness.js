// Home containers are not theft (Nat, 31 Oct: players get "stolen" items out of their own home barrels).
// Skyrim's crime system sees the plugin's containers as NPC-owned, so the server's housingSystem sends
// { customPacketType: "homeCells", cells: [...] } - the cells that player owns outright, at login and after
// any ownership change - and HomeCellsService makes the player the cell's owner so vanilla stops calling
// their own storage theft.
//
// Runs homeCellsPlan.ts (transpiled with the client's own TypeScript) and checks the service's wiring in its
// source. Run it from skymp5-client with node_modules present:
//
//   node tests/home-cells-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const client = path.resolve(__dirname, '..');
const svc = path.join(client, 'src', 'services', 'services');
const ts = require(path.join(client, 'node_modules', 'typescript'));
let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

const load = (src) => {
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const mod = {};
  new Function('exports', js)(mod);
  return mod;
};

const planSrc = fs.readFileSync(path.join(svc, 'homeCellsPlan.ts'), 'utf8');
const plan = load(planSrc);

// ---- parseHomeCells: whatever arrives on the wire ----
check('the server\'s list becomes a set of ids',
  (() => { const s = plan.parseHomeCells({ customPacketType: 'homeCells', cells: [0x1a2b3c, 0x4d5e6f] });
    return s.size === 2 && s.has(0x1a2b3c) && s.has(0x4d5e6f); })());
check('an empty list is a set with nothing in it, not a refusal',
  plan.parseHomeCells({ cells: [] }).size === 0);
check('a missing list, a wrong type, null and junk all mean no home cells',
  plan.parseHomeCells({}).size === 0 && plan.parseHomeCells({ cells: 'nope' }).size === 0 &&
  plan.parseHomeCells(null).size === 0 && plan.parseHomeCells(undefined).size === 0 &&
  plan.parseHomeCells('junk').size === 0 && plan.parseHomeCells(7).size === 0);
check('0, negatives, NaN, null and non-numbers are dropped',
  (() => { const s = plan.parseHomeCells({ cells: [0, -1, NaN, null, undefined, 'x', {}, [], 0x10] });
    return s.size === 1 && s.has(0x10); })(), [...plan.parseHomeCells({ cells: [0, -1, NaN, null, 'x', 0x10] })]);
check('a numeric string from JSON is accepted, since the wire is JSON',
  plan.parseHomeCells({ cells: ['16'] }).has(16));
check('a duplicate id appears once',
  plan.parseHomeCells({ cells: [0x20, 0x20, 0x20] }).size === 1);
check('an id above 0x7fffffff survives as unsigned (an ff.. dynamic cell)',
  plan.parseHomeCells({ cells: [0xff000123] }).has(0xff000123));

// ---- decideHomeCell ----
const PLAYER = 0x7;
const CELL = 0x1a2b3c;
const owned = new Set([CELL]);
const none = new Map();
const d = (o, t, cell, interior, ownerId, factionId, player) =>
  plan.decideHomeCell(o, t, cell, interior, ownerId, factionId, player === undefined ? PLAYER : player);

check('an owned interior owned by an NPC is taken', d(owned, none, CELL, true, 0x13477, 0, PLAYER) === 'take');
check('an owned interior owned by nobody is still taken (the refs carry XOWN)',
  d(owned, none, CELL, true, 0, 0, PLAYER) === 'take');
check('an owned interior already ours is left alone, so walking in and out costs no native write',
  d(owned, none, CELL, true, PLAYER, 0, PLAYER) === 'none');
check('...but ours WITH a faction owner left on it is taken again: a faction owner is theft on its own',
  d(owned, none, CELL, true, PLAYER, 0x2bf9c, PLAYER) === 'take');
check('an owned EXTERIOR is refused - the server sends both halves of the door pair',
  d(owned, none, CELL, false, 0x13477, 0, PLAYER) === 'none');
check('a cell we do not own and never touched is left alone',
  d(owned, none, 0x999, true, 0x13477, 0, PLAYER) === 'none');
check('a cell we took and no longer own is restored',
  d(owned, new Map([[0x999, { owner: 0x13477, faction: 0 }]]), 0x999, true, PLAYER, 0, PLAYER) === 'restore');
check('...restored even if it is an exterior, because we are undoing our own change',
  d(owned, new Map([[0x999, { owner: 0x13477, faction: 0 }]]), 0x999, false, PLAYER, 0, PLAYER) === 'restore');
check('an owned cell we have already taken is not restored',
  d(owned, new Map([[CELL, { owner: 0x13477, faction: 0 }]]), CELL, true, PLAYER, 0, PLAYER) === 'none');
check('cell id 0 does nothing', d(owned, none, 0, true, 0, 0, PLAYER) === 'none');
check('no player base means do nothing, never set an owner of 0',
  d(owned, none, CELL, true, 0x13477, 0, 0) === 'none');
check('an empty owned set restores everything we hold and claims nothing',
  d(new Set(), new Map([[CELL, { owner: 0x13477, faction: 0 }]]), CELL, true, PLAYER, 0, PLAYER) === 'restore' &&
  d(new Set(), none, CELL, true, 0x13477, 0, PLAYER) === 'none');

// ---- the service's wiring, read out of its source ----
const srcPath = path.join(svc, 'homeCellsService.ts');
const src = fs.readFileSync(srcPath, 'utf8');
check('registered for cellFullyLoaded', /controller\.on\("cellFullyLoaded"/.test(src));
check('listens for the custom packet', /customPacketMessage/.test(src) && /"homeCells"/.test(src));
check('covers the spawn race through createActorMessage isMe', /createActorMessage/.test(src) && /isMe/.test(src));
check('the packet handler defers its native work to an update (natives throw in the packet context)',
  /controller\.once\("update"/.test(src));
check('no native handle is stored across frames: the map holds numbers',
  /taken = new Map<number, DisplacedOwner>/.test(src) && !/Map<number, (Cell|ActorBase)>/.test(src));
check('both owners are written when taking, and both put back when restoring',
  /setActorOwner\(playerBase\)/.test(src) && /setFactionOwner\(null\)/.test(src) &&
  /setActorOwner\(previous\.owner/.test(src) && /setFactionOwner\(Faction\.from/.test(src));
check('the displaced owner is recorded before it is overwritten, and only once per cell',
  /if \(!this\.taken\.has\(cellId\)\)/.test(src));
check('it is registered in index.ts',
  /new HomeCellsService\(sp, controller\)/.test(fs.readFileSync(path.join(client, 'src', 'index.ts'), 'utf8')));

// ---- mutants: the harness has to be able to fail ----
const mutants = [
  ['the exterior refusal removed', (s) => s.replace('if (!isInterior) {\n      return "none";\n    }', 'if (false) {\n      return "none";\n    }')],
  ['the already-ours shortcut ignores the faction owner', (s) => s.replace('if (currentOwnerId === playerBaseId && !currentFactionId) {', 'if (currentOwnerId === playerBaseId) {')],
  ['restore dropped', (s) => s.replace('if (taken.has(cellId)) {\n    return "restore";\n  }', 'if (false) {\n    return "restore";\n  }')],
  ['the player-base guard dropped', (s) => s.replace('if (!cellId || !playerBaseId) {', 'if (!cellId) {')],
  ['parseHomeCells keeps 0 and negatives', (s) => s.replace('if (!Number.isFinite(n) || n <= 0) {', 'if (false) {')],
  // Not 'return early on an empty array': that is semantically identical to looping zero times, so no
  // test can tell it apart. An equivalent mutant surviving says nothing about the tests.
  ['parseHomeCells reads the wrong key', (s) => s.replace('["cells"]', '["cell"]')],
];
let killed = 0;
for (const [name, mutate] of mutants) {
  const mutated = mutate(planSrc);
  if (mutated === planSrc) { console.log(`FAIL mutant "${name}" did not apply`); failures++; continue; }
  let survived = true;
  try {
    const m = load(mutated);
    const md = (o, t, c, i, ow, f, p) => m.decideHomeCell(o, t, c, i, ow, f, p);
    const broke =
      md(owned, none, CELL, false, 0x13477, 0, PLAYER) !== 'none' ||
      md(owned, none, CELL, true, PLAYER, 0x2bf9c, PLAYER) !== 'take' ||
      md(owned, new Map([[0x999, { owner: 1, faction: 0 }]]), 0x999, true, PLAYER, 0, PLAYER) !== 'restore' ||
      md(owned, none, CELL, true, 0x13477, 0, 0) !== 'none' ||
      m.parseHomeCells({ cells: [0, -1, 0x10] }).size !== 1 ||
      !m.parseHomeCells({ cells: [0x10] }).has(0x10) ||
      m.parseHomeCells({ cells: [] }).size !== 0;
    survived = !broke;
  } catch {
    survived = false;
  }
  if (survived) { console.log(`FAIL mutant survived: ${name}`); failures++; } else { killed++; }
}
console.log(`ok   ${killed}/${mutants.length} mutants killed`);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
