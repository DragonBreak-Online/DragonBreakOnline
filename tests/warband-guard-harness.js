// /warband defend (guard) (Nat, 28 Oct, necromancer events, "or defend an area"): a band defends the area around where its
// GM stood, attacks any non-staff player inside, never staff and never its own GM, drops a target that leaves, gives up past
// the leash, goes back to its posts, and follow or stay ends it.
// Loads the real warband.js against a mock companion system and world.
//   node tests/warband-guard-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE = path.resolve(__dirname, '..', 'warband.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-warband-guard-'));
const home = process.cwd();
process.chdir(dir);
fs.writeFileSync('admin-placeables.json', JSON.stringify({ categories: [{ id: 'npc', label: 'NPCs', kind: 'npc', items: [['1e7e2:Skyrim.esm', 'Bandit Melee 1H Nord', 'Skyrim.esm']] }] })); // verify-formids: ignore - harness fixture: a mock Place catalog row, read as an NPC to raise

const GM = 0x14, STAFF = 0x15, NEAR = 0x16, FAR = 0x17, GMALT = 0x18, DOWNED = 0x19, ELSEWHERE = 0x1a;
const WORLD = '3c:Skyrim.esm';
const PROFILE = { [GM]: 1, [STAFF]: 2, [NEAR]: 3, [FAR]: 4, [GMALT]: 1, [DOWNED]: 5, [ELSEWHERE]: 6 };
const props = new Map();
const put = (id, k, v) => props.set(`${id >>> 0}|${k}`, v);
let next = 0xff000100;
const companions = new Map();
const moves = [];
globalThis.__dboCompanions = {
  spawn: (owner, baseId, opts) => { const id = next++; companions.set(id, { id, ownerId: owner, baseId, kind: opts.kind, staying: false, targetId: 0 }); put(id, 'pos', opts.pos.slice()); put(id, 'worldOrCellDesc', WORLD); put(id, 'private.dboCompanion', 'companion'); put(id, 'ff_companionOf', owner); return id; },
  list: (owner) => [...companions.values()].filter((c) => c.ownerId === owner && !c.released).map((c) => Object.assign({}, c)),
  follow: (id) => { const c = companions.get(id); c.staying = false; c.targetId = 0; return true; },
  stay: (id) => { const c = companions.get(id); c.staying = true; c.targetId = 0; return true; },
  attack: (id, t) => { companions.get(id).targetId = t; return true; },
  dismiss: (id) => companions.delete(id),
  release: (id, hostile) => { const c = companions.get(id); c.released = true; c.hostile = hostile; return true; },
};
globalThis.__dboIsDowned = (a) => a === DOWNED;
const timers = new Map();
const said = [], commands = {};
let online = [GM, STAFF, NEAR, FAR, GMALT, DOWNED, ELSEWHERE];
require(MODULE)({
  mp: {
    get: (id, k) => props.get(`${id >>> 0}|${k}`),
    set: (id, k, v) => { if (k === 'locationalData') { moves.push([id >>> 0, v]); put(id, 'pos', v.pos.slice()); } else put(id, k, v); },
    getIdFromDesc: (d) => parseInt(d, 16),
    lookupEspmRecordById: () => ({ record: { type: 'NPC_', fields: [{ type: 'AIDT', data: new Uint8Array([0]) }] }, toGlobalRecordId: (x) => x }),
  },
  log: () => {}, personal: (a, t) => said.push([a, t]), audit: () => {}, who: (a) => `#${a.toString(16)}`, isAdmin: (a) => a === GM || a === STAFF,
  registerChatCommand: (n, fn) => { commands[n] = fn; }, findByName: () => 0, cfg: {}, onUi: () => {},
  onlineActors: () => online.slice(), every: (n, ms, fn) => timers.set(n, fn), profileOf: (a) => (PROFILE[a >>> 0] !== undefined ? PROFILE[a >>> 0] : -1),
});

let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? '   ' + JSON.stringify(detail).slice(0, 300) : ''}`); if (!ok) failures++; };
const run = (args) => { said.length = 0; commands.warband(GM, args); return said.map((x) => x[1]).join(' | '); };
const at = (id, x, y) => { put(id, 'pos', [x, y, 0]); put(id, 'worldOrCellDesc', WORLD); };
const tick = () => timers.get('warbandGuard')();
const band = () => [...companions.values()];
const all = (f) => band().length === 3 && band().every(f);

// The GM and the band at the origin; players around them
at(GM, 0, 0);
at(STAFF, 300, 0); at(GMALT, 0, 300); at(DOWNED, -300, 0); at(FAR, 5000, 0); at(NEAR, 1200, 0); at(ELSEWHERE, 100, 100); put(ELSEWHERE, 'worldOrCellDesc', '1a26f:Skyrim.esm');
run('raise bandit melee 3');
check('three raised for the test', band().length === 3, band().length);

// ---- defend: an area centred on the GM; the nearest non-staff player inside is attacked, staff and the rest are not -----
online = [GM, STAFF, FAR, GMALT, DOWNED, ELSEWHERE];
let r = run('defend');
check('/warband defend holds the band (stay) and answers with the area around the GM', all((c) => c.staying) && /defends this area: any player within 21 m of where you stand who is not staff is attacked, and none chases past 29 m/.test(r), r);
check('with only staff, the GM\'s own alt, a downed player, someone far off and someone in another cell near, nobody is attacked', all((c) => !c.targetId), band().map((c) => c.targetId));
online.push(NEAR);
tick();
check('a player who walks into the area (1200 of 1500 from the centre) is attacked by the band', all((c) => c.targetId === NEAR), band().map((c) => c.targetId));
// The staff member on an enemy side, so the friendly-GM rule does not spare them and only defend's own rule can
commands.warband(GM, 'side Necromancers'); commands.warband(STAFF, 'side Legion');
check('a staff target, even a GM on an enemy side, is refused by the hit rule while defending', globalThis.__dboWarbandRefusesHit(band()[0].id, STAFF) === true);
check('...but the player in the area is not', globalThis.__dboWarbandRefusesHit(band()[0].id, NEAR) === false);

// ---- the target leaves the area: dropped, and the band goes back to its posts --------------------------------------------
const post = band()[0].id;
put(post, 'pos', [900, 0, 0]);   // it chased the player
at(NEAR, 4000, 0);
moves.length = 0;
tick();
check('a target that leaves the area is dropped (back on stay)', all((c) => !c.targetId && c.staying), band().map((c) => [c.targetId, c.staying]));
check('the NPC that chased it is put back on its post', moves.some(([id, v]) => id === post && Math.hypot(v.pos[0], v.pos[1]) < 200), moves);

// ---- the leash: a target still inside, but the NPC past the edge plus 500, gives up and goes back -------------------------
at(NEAR, 1400, 0);
tick();
check('(the player back inside at 1400 is attacked again)', all((c) => c.targetId === NEAR));
put(post, 'pos', [2100, 0, 0]);  // 1500 + 500 + 100 from the centre
moves.length = 0;
tick();
const leashed = companions.get(post);
check('an NPC chased past the area\'s edge plus the leash drops its target', !leashed.targetId && leashed.staying, [leashed.targetId, leashed.staying]);
check('...and is put back on its post', moves.some(([id, v]) => id === post && Math.hypot(v.pos[0], v.pos[1]) < 200), moves);
check('...while the others inside keep fighting', band().filter((c) => c.id !== post).every((c) => c.targetId === NEAR));

// ---- the area stays where it was ordered, not where the GM walks ----------------------------------------------------------
run('stay');
at(GM, 3000, 0); at(NEAR, 3100, 0); for (const c of band()) put(c.id, 'pos', [2900, 0, 0]);   // the band came with its GM
run('defend');
at(GM, 0, 0);
tick();
check('the area stays where the order was given: the player at 3100 is attacked after the GM walks away', all((c) => c.targetId === NEAR), band().map((c) => c.targetId));
run('stay'); at(GM, 0, 0); at(NEAR, 1200, 0); for (const c of band()) put(c.id, 'pos', [100, 0, 0]);

// ---- a radius of its own, out of range, and the guard alias ---------------------------------------------------------------
run('defend 800');
check('/warband defend 800: the player at 1200 is outside the area and ignored', all((c) => !c.targetId), band().map((c) => c.targetId));
check('a radius outside 200-4000 is refused with the usage', /Usage: \/warband defend \[radius\]/.test(run('defend 50')));
r = run('guard');
check('/warband guard is the same order (an alias)', /defends this area/.test(r) && all((c) => c.targetId === NEAR), r);

// ---- stay or follow ends it ----------------------------------------------------------------------------------------------
run('stay');
tick();
check('/warband stay ends defending: no attack on the next pass', all((c) => !c.targetId), band().map((c) => c.targetId));
run('defend'); run('follow'); tick();
check('/warband follow ends it too', all((c) => !c.targetId && !c.staying));
check('help names defend', /defend \[radius\]/.test(run('nonsense')));

process.chdir(home);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ }
console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
