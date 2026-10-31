// Warband load (Nat, 31 Oct: "the warband, raise and unleash tool caused lag at the Bruma event"): a raise is capped by the
// live warband NPCs of every GM (maxLive), and a big raise spawns spawnBatch at a time, spawnStepMs apart. Loads the real
// warband.js against a mock companion system and captured timers.
//   node tests/warband-load-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE = path.resolve(__dirname, '..', 'warband.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-warband-load-'));
const home = process.cwd();
process.chdir(dir);
fs.writeFileSync('admin-placeables.json', JSON.stringify({ categories: [{ id: 'npc', label: 'NPCs', kind: 'npc', items: [['1e7e2:Skyrim.esm', 'Bandit Melee 1H Nord', 'Skyrim.esm']] }] })); // verify-formids: ignore - harness fixture: a mock Place catalog row, read as an NPC to raise

const GM = 0x14, GM2 = 0x15;
const props = new Map();
const put = (id, k, v) => props.set(`${id >>> 0}|${k}`, v);
let next = 0xff000100;
const companions = new Map();
globalThis.__dboCompanions = {
  spawn: (owner, baseId, opts) => { const id = next++; companions.set(id, { id, ownerId: owner, baseId, kind: opts.kind, staying: false, targetId: 0 }); put(id, 'pos', opts.pos.slice()); return id; },
  list: (owner) => [...companions.values()].filter((c) => c.ownerId === owner && !c.released).map((c) => Object.assign({}, c)),
  follow: () => true, stay: () => true, attack: () => true,
  dismiss: (id) => companions.delete(id),
  release: (id, hostile) => { const c = companions.get(id); c.released = true; c.hostile = hostile; return true; },
};
const timers = [];
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
const said = [], commands = {};
for (const g of [GM, GM2]) { put(g, 'pos', [0, 0, 0]); put(g, 'angle', [0, 0, 0]); }
require(MODULE)({
  mp: {
    get: (id, k) => props.get(`${id >>> 0}|${k}`),
    set: (id, k, v) => put(id, k, v),
    getIdFromDesc: (d) => parseInt(d, 16),
    lookupEspmRecordById: () => ({ record: { type: 'NPC_', fields: [{ type: 'AIDT', data: new Uint8Array([0]) }] }, toGlobalRecordId: (x) => x }),
  },
  log: () => {}, personal: (a, t) => said.push([a, t]), audit: () => {}, who: (a) => `#${a.toString(16)}`, isAdmin: () => true,
  registerChatCommand: (n, fn) => { commands[n] = fn; }, findByName: () => 0, onUi: () => {},
  cfg: { warband: { maxRaise: 25, maxBand: 25, maxLive: 18, spawnBatch: 5, spawnStepMs: 500 } },
  onlineActors: () => [GM, GM2], every: () => {}, profileOf: (a) => (a === GM ? 1 : a === GM2 ? 2 : -1),
});

let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? '   ' + JSON.stringify(detail).slice(0, 300) : ''}`); if (!ok) failures++; };
const run = (a, args) => { said.length = 0; commands.warband(a, args); return said.map((x) => x[1]).join(' | '); };
const mine = (g) => [...companions.values()].filter((c) => c.ownerId === g).length;
const flush = () => { while (timers.length) timers.shift().fn(); };

// ---- a big raise comes in batches -----------------------------------------------------------------------------------------
let r = run(GM, 'raise bandit 12');
check('a raise of 12 spawns its first batch of 5 at once', mine(GM) === 5, mine(GM));
check('...and schedules the rest 500 ms apart (two more batches)', timers.length === 2 && timers[0].ms === 500 && timers[1].ms === 1000, timers.map((t) => t.ms));
check('...saying so', /5 Bandit Melee 1H Nord follow you, 7 more over the next/.test(r), r);
flush();
check('when the timers run the band is 12', mine(GM) === 12, mine(GM));

// ---- the server-wide cap -------------------------------------------------------------------------------------------------
r = run(GM2, 'raise bandit 10');
flush();
check('another GM is held to the 18 the whole server may have: 6 of 10', mine(GM2) === 6, mine(GM2));
check('...told why', /the server holds 18 warband NPCs at most/.test(r), r);
r = run(GM, 'raise bandit 3');
check('with 18 standing, a raise is refused outright', mine(GM) === 12 && /The server holds 18 warband NPCs already/.test(r), r);
// The dead free their places
for (const c of [...companions.values()].filter((x) => x.ownerId === GM).slice(0, 4)) put(c.id, 'isDead', true);
run(GM, 'raise bandit 3');
flush();
check('4 dead free 4 places: a raise of 3 is granted', mine(GM) === 15, mine(GM));

// ---- a staggered raise stops when the cap fills meanwhile ------------------------------------------------------------------
for (const c of [...companions.values()]) put(c.id, 'isDead', true);
companions.clear();
run(GM, 'raise bandit 15');      // 5 now, 10 to come
run(GM2, 'raise bandit 13');     // 5 now, 8 to come; together 28 asked against 18
flush();
const total = mine(GM) + mine(GM2);
check('two staggered raises together never pass the server cap (18)', total === 18, [mine(GM), mine(GM2)]);

process.chdir(home);
global.setTimeout = realSetTimeout;
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ }
console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
