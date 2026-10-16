// Scripted test for the door sync (doorsync.js, 16 Oct): a game that crossed a load door the server never heard of. Lord Lewin
// Ashcroft #QD7X logged in inside Castle Bruma's Great Hall (6c40f) at 02:34:56, walked out through 6c473 at 02:40:53 and the
// server held him at -2643,3297,2369 by that door for 38 minutes while his heartbeat said "w80a764b". It loads doorsync.js
// against a stand-in mp built from the real records (6c473 -> 6c4d9 in a764b, doors-pos.json rows) and replays his heartbeat,
// then the cases that must not move anyone. Run it from this folder's parent with
//
//   node tests/door-sync-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const ROOT = path.resolve(__dirname, '..');
const MOD = path.join(ROOT, 'doorsync.js');
if (!fs.existsSync(MOD)) { check('doorsync.js exists', false); console.log(`\n${failures} failure(s)`); process.exit(1); }

// The gamemode loads it and hands it every heartbeat
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
check('gamemode.js loads doorsync.js', /require\(DOORSYNC_JS\)/.test(gm) && /path\.resolve\('doorsync\.js'\)/.test(gm));
const drift = gm.slice(gm.indexOf("onUi('npcDrift'"), gm.indexOf("onUi('npcDrift'") + 800);
check("the npcDrift handler passes heartbeats to it", /__dboDoorSync\.heartbeat\(a, r\)/.test(drift));
check('creation is left alone', /__dboDoorSync = require\(DOORSYNC_JS\)\(\{[^)]*skip: \(a\) => creationPending\(a\) \|\| inCreatorRealm\(a\)/.test(gm));

// The real doors-pos.json rows the case needs
const doorsPos = JSON.parse(fs.readFileSync(path.join(ROOT, 'doors-pos.json'), 'utf8'));
check('doors-pos.json has the Great Hall exit 6c473', Array.isArray(doorsPos.doors['6c473:BSHeartland.esm']), doorsPos.doors['6c473:BSHeartland.esm']);

const BSH = 0x08000000;
const ids = { '6c40f:BSHeartland.esm': BSH | 0x6c40f, 'a764b:BSHeartland.esm': BSH | 0xa764b, '3c:Skyrim.esm': 0x3c };
const descOf = new Map();
for (const desc of Object.keys(doorsPos.doors)) { const [hex, file] = desc.split(':'); if (file === 'BSHeartland.esm') ids[desc] = BSH | parseInt(hex, 16); }
for (const [d, id] of Object.entries(ids)) descOf.set(id >>> 0, d);
const xtel = (local) => { const b = new Uint8Array(32); new DataView(b.buffer).setUint32(0, local, true); return b; };
// 6c473 (Great Hall) <-> 6c4d9 (Bruma street, a764b); the hall's other load doors lead elsewhere
const partners = { [BSH | 0x6c473]: 0x6c4d9, [BSH | 0x6c4d9]: 0x6c473, [BSH | 0x6c4dd]: 0x6c4de };
const cells = { [BSH | 0x6c4d9]: 'a764b:BSHeartland.esm', [BSH | 0x6c473]: '6c40f:BSHeartland.esm', [BSH | 0x6c4de]: '6c40c:BSHeartland.esm' };

const LEWIN = 0xff000e2e;
let actor, calls, logs, timers, clock;
const reset = (over) => {
  actor = Object.assign({ worldOrCellDesc: '6c40f:BSHeartland.esm', pos: [-2643.13, 3297.84, 2369.12], isDead: false, 'private.restrained': null }, over || {});
  calls = []; logs = []; timers = []; clock = 1_792_120_000_000;
};
const mp = {
  get: (id, prop) => {
    id >>>= 0;
    if (id === LEWIN) return actor[prop];
    if (prop === 'worldOrCellDesc' && cells[id]) return cells[id];
    throw new Error(`no ${prop} on ${id.toString(16)}`);
  },
  getIdFromDesc: (desc) => { if (!(desc in ids)) throw new Error(`${desc} not found`); return ids[desc]; },
  getDescFromId: (id) => descOf.get(id >>> 0) || (id >>> 0).toString(16),
  lookupEspmRecordById: (id) => {
    const local = partners[id >>> 0];
    return { record: { type: 'REFR', fields: local ? [{ type: 'XTEL', data: xtel(local) }] : [] }, toGlobalRecordId: (l) => (BSH | l) >>> 0 };
  },
  callPapyrusFunction: (...args) => { calls.push(args); },
};
let skipped = false;
const load = (cfg) => {
  delete globalThis.__dboDoorSyncState;
  delete require.cache[MOD];
  return require(MOD)({ mp, log: (...a) => logs.push(a.join(' ')), display: () => 'Lord Lewin Ashcroft #QD7X', cfg: cfg || {}, doors: doorsPos,
    skip: () => skipped, now: () => clock, setTimeout: (fn) => timers.push(fn) });
};
const run = () => { const t = timers.splice(0); for (const fn of t) fn(); };
// His heartbeats from /var/log/skymp-server.log, the "fr" part as logged
const inside = { kind: 'heartbeat', hosted: 0, fr: { n: 1806, ms: 16.7, at: 'c806c40f', forms: 12 } };
const outside = { kind: 'heartbeat', hosted: 0, fr: { n: 1486, ms: 16.8, at: 'w80a764b', forms: 12 } }; // 02:41:02.420
const activated = () => calls.filter((c) => c[0] === 'method' && c[1] === 'ObjectReference' && c[2] === 'Activate')
  .map((c) => [c[3].desc, c[4][0].desc, c[4][1]]);

// 1. Lewin: in the hall since the login, his game outside: the hall's door to the street is used for him
reset(); let ds = load();
ds.heartbeat(LEWIN, inside); clock += 30_000;
ds.heartbeat(LEWIN, inside); clock += 30_000;
check('in the hall, game in the hall: nothing', activated().length === 0);
const got = ds.heartbeat(LEWIN, outside); run();
check('held in the hall by 6c473, game in Bruma: 6c473 activated for him', got === '6c473:BSHeartland.esm' && JSON.stringify(activated()) === JSON.stringify([['6c473:BSHeartland.esm', 'ff000e2e', false]]), activated());
check('the assist is logged', logs.some((l) => /door sync: .*6c40f:BSHeartland.esm -2643,3298,2369 .*w80a764b; activating 6c473:BSHeartland.esm/.test(l)), logs);

// 2. Cooldown: the next heartbeat inside the window does nothing, one after it tries again
calls = []; clock += 10_000; ds.heartbeat(LEWIN, outside); run();
check('again 10 s later: cooldown, nothing', activated().length === 0);
clock += 15_000; ds.heartbeat(LEWIN, outside); run();
check('again 25 s after the assist: tried again', activated().length === 1);

// 3. Just moved here by the server (a door in, a summon): the game's report still names the street
reset(); ds = load();
actor.worldOrCellDesc = 'a764b:BSHeartland.esm'; actor.pos = [53418, 203881, 8567];
ds.heartbeat(LEWIN, outside); clock += 2_000;
actor.worldOrCellDesc = '6c40f:BSHeartland.esm'; actor.pos = [-2600, 3260, 2369];   // the door's arrival spot
ds.heartbeat(LEWIN, outside); run();
check('server moved them into the hall 2 s ago, report still says Bruma: nothing', activated().length === 0);
clock += 30_000; ds.heartbeat(LEWIN, inside); run();
check('the game lands in the hall: nothing', activated().length === 0);

// 4. Not by a door to where the game is
reset(); ds = load(); ds.heartbeat(LEWIN, inside); clock += 60_000;
actor.pos = [-2326, -5, 2506];   // his login spot, 3400 u from the door
ds.heartbeat(LEWIN, outside); run();
check('far from any door to Bruma: nothing', activated().length === 0);
actor.pos = [-2643.13, 3297.84, 2369.12];
ds.heartbeat(LEWIN, { kind: 'heartbeat', fr: { at: 'w3c' } }); run();
check('by 6c473 but the game reports Tamriel (not where 6c473 leads): nothing', activated().length === 0);
ds.heartbeat(LEWIN, { kind: 'heartbeat' }); ds.heartbeat(LEWIN, { kind: 'heartbeat', fr: { at: 'nonsense' } }); ds.heartbeat(LEWIN, { kind: 'perf', fr: { at: 'w80a764b' } }); run();
check('no report, a bad one, or not a heartbeat: nothing', activated().length === 0);

// 5. Never for creation, the dead, the bound, nor with the switch off
for (const [name, over, cfg, sk] of [['in creation', {}, {}, true], ['dead', { isDead: true }, {}, false], ['bound or carried', { 'private.restrained': { boundHands: true } }, {}, false], ['doorSync.enabled false', {}, { doorSync: { enabled: false } }, false]]) {
  reset(over); skipped = sk; ds = load(cfg); ds.heartbeat(LEWIN, inside); clock += 60_000; ds.heartbeat(LEWIN, outside); run();
  check(`${name}: nothing`, activated().length === 0);
  skipped = false;
}

// 6. A failing activation is logged, not thrown
reset(); ds = load(); ds.heartbeat(LEWIN, inside); clock += 60_000;
const real = mp.callPapyrusFunction; mp.callPapyrusFunction = () => { throw new Error('boom'); };
let threw = false; try { ds.heartbeat(LEWIN, outside); run(); } catch (e) { threw = true; }
mp.callPapyrusFunction = real;
check('a failing activation is logged', !threw && logs.some((l) => /activating 6c473:BSHeartland.esm for .* failed: boom/.test(l)), logs.slice(-1));

console.log(`\n${failures ? failures + ' failure(s)' : 'all passed'}`);
process.exit(failures ? 1 : 0);
