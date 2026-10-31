// Scripted test for warband.js's raid limits (Nat, 31 Oct, after the 31 Oct crash burst: "yes enforce those"):
//   raidMax NPCs per unleash (the rest stay with the GM), raidGapSeconds between one GM's raids (refused with the time the
//   next is allowed), maxHostile live unleashed raiders for the whole server (followers and garrisons stay under maxLive),
//   and the dead removed bodySeconds (60) after they fell. No server and no game:
//
//   node tests\warband-raid-limits-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE = path.resolve(__dirname, '..', 'warband.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-raidlim-'));
const home = process.cwd();
process.chdir(dir);
fs.writeFileSync('admin-placeables.json', JSON.stringify({ categories: [
  { id: 'npc', label: 'NPCs', kind: 'npc', items: [['3ba1:Skyrim.esm', 'Bandit Chief', 'Skyrim.esm']] },   // verify-formids: ignore - harness fixture, a mock catalog
] }));

let now = Date.UTC(2026, 9, 31, 2, 30, 0);
const realNow = Date.now; Date.now = () => now;
const GM1 = 1, GM2 = 2, GM1ALT = 4;
const PROFILE = { [GM1]: 11, [GM1ALT]: 11, [GM2]: 12 };
let next = 0xff000100;
const companions = new Map();
const destroyed = new Set(), dead = new Set();
globalThis.__dboCompanions = {
  spawn: (owner, baseId, opts) => { const id = next++; companions.set(id, { id, ownerId: owner, baseId, kind: opts.kind, pos: opts.pos, staying: false, target: 0 }); return id; },
  list: (owner) => [...companions.values()].filter((c) => c.ownerId === owner && !c.released),
  follow: () => true, stay: () => true, attack: () => true,
  dismiss: (id) => companions.delete(id),
  release: (id, hostile) => { const c = companions.get(id); c.released = true; c.hostile = hostile; return true; },
};
const said = [], commands = {}, timers = {};
const load = (warband) => {
  delete require.cache[MODULE];
  require(MODULE)({
    mp: {
      get: (id, k) => { if (destroyed.has(id)) throw new Error('gone'); if (k === 'pos') return [1000, 2000, 300]; if (k === 'angle') return [0, 0, 90]; if (k === 'isDead') return dead.has(id); if (k === 'ff_companionOf') { const c = companions.get(id); return c && !c.released ? c.ownerId : 0; } return undefined; },
      getIdFromDesc: (d) => parseInt(d, 16),
      destroyActor: (id) => destroyed.add(id),
      lookupEspmRecordById: () => ({ record: { type: 'NPC_', fields: [{ type: 'AIDT', data: new Uint8Array([0]) }] }, toGlobalRecordId: (x) => x }),
    },
    log: () => {}, personal: (a, t) => said.push([a, t]), audit: () => {}, who: (a) => `#${a}`, isAdmin: (a) => [GM1, GM2, GM1ALT].includes(a),
    profileOf: (a) => (PROFILE[a] !== undefined ? PROFILE[a] : -1),
    registerChatCommand: (n, fn) => { commands[n] = fn; }, findByName: () => 0, cfg: { warband: warband || {} }, onUi: () => {},
    every: (n, ms, fn) => { timers[n] = fn; },
  });
};
load({});

let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? '   ' + JSON.stringify(detail).slice(0, 400) : ''}`); if (!ok) failures++; };
const run = (a, args, cmd) => { said.length = 0; commands[cmd || 'warband'](a, args); return said.map((x) => x[1]).join(' | '); };
const raise = (a, n) => { while (n > 0) { const k = Math.min(10, n); run(a, `raise bandit chief ${k}`); n -= k; } };
const band = (a) => globalThis.__dboCompanions.list(a).length;
const hostileLive = () => [...companions.values()].filter((c) => c.released && c.hostile && !dead.has(c.id) && !destroyed.has(c.id)).length;

// ---- raidMax: a band of 14 goes out as a raid of 10; 4 stay with the GM ----
raise(GM1, 14);
check('the GM leads 14', band(GM1) === 14, band(GM1));
let r = run(GM1, 'unleash');
check('unleash lets 10 go (raidMax), 4 stay with the GM', hostileLive() === 10 && band(GM1) === 4 && /warband of 10 is unleashed/.test(r) && /4 stay with you: a raid is 10 at most/.test(r), [hostileLive(), band(GM1), r]);
check('...and says when the next raid can go (60 s on, UTC)', /next raid can go at 02:31:00 UTC/.test(r), r);
check('the dead are removed after 60 s, said in seconds', /The dead are removed after 60 s/.test(r), r);

// ---- raidGapSeconds: no second raid within 60 s, by the GM's profile ----
now += 30000;
r = run(GM1, 'unleash');
check('a second raid 30 s later is refused, saying when (30 s, at 02:31:00 UTC)', hostileLive() === 10 && band(GM1) === 4 && /next can be unleashed in 30 s \(at 02:31:00 UTC\)/.test(r), r);
raise(GM1ALT, 2);
r = run(GM1ALT, 'unleash');
check('...the same GM on another character too (the gap is the profile\'s)', hostileLive() === 10 && band(GM1ALT) === 2 && /in 30 s/.test(r), r);
r = run(GM1, 'settle');
check('settling is no raid: not held by the gap', /stays here as friendly NPCs/.test(r) && band(GM1) === 0, r);
now += 30000;
raise(GM1, 3);
r = run(GM1, 'unleash');
check('60 s after the first, the next raid goes', hostileLive() === 13 && band(GM1) === 0 && /warband of 3 is unleashed/.test(r), r);
check('...a raid that fits says nothing about waiting', !/stay with you/.test(r), r);

// ---- maxHostile: 25 live raiders for the whole server ----
raise(GM2, 10);
run(GM2, 'unleash');
check('another GM\'s raid of 10: 23 live raiders', hostileLive() === 23, hostileLive());
now += 61000;
raise(GM2, 10);
r = run(GM2, 'unleash');
check('the next goes only up to 25 live raiders: 2 out, 8 stay, told why', hostileLive() === 25 && band(GM2) === 8 && /8 stay with you: the server holds 25 live raiders at most/.test(r), [hostileLive(), band(GM2), r]);
now += 61000;
r = run(GM2, 'unleash');
check('at 25 a raid is refused, saying what frees room', hostileLive() === 25 && band(GM2) === 8 && /holds 25 live raiders already/.test(r) && /\/raid clear/.test(r), r);
// Raiders that die free room; the gap was started by the last raid that let anyone go
const raiders = [...companions.values()].filter((c) => c.released && c.hostile);
for (const c of raiders.slice(0, 5)) dead.add(c.id);
r = run(GM2, 'unleash');
check('five raiders fall: the next raid lets 5 go', hostileLive() === 25 && band(GM2) === 3 && /warband of 5 is unleashed/.test(r), [hostileLive(), band(GM2), r]);
check('followers and garrisons are no raiders: raising still works under maxLive', (() => { run(GM2, 'dismiss'); const before = companions.size; run(GM2, 'raise bandit chief 1'); return companions.size === before + 1; })());

// ---- bodySeconds: the dead removed 60 s after they fell ----
const fallen = [...companions.values()].filter((c) => c.released && dead.has(c.id));
timers.warband();
check('a fresh body stays', fallen.every((c) => !destroyed.has(c.id)));
now += 50000; timers.warband();
check('...50 s on it still lies', fallen.every((c) => !destroyed.has(c.id)));
now += 11000; timers.warband();
check('...61 s after the first look it is removed', fallen.every((c) => destroyed.has(c.id)), fallen.map((c) => destroyed.has(c.id)));

// ---- config ----
load({ raidMax: 3, raidGapSeconds: 0, maxHostile: 999, bodySeconds: 600 });
dead.clear(); for (const c of companions.values()) if (c.released) destroyed.add(c.id);
globalThis.__dboWarband.released = [];
run(GM1, 'dismiss');
raise(GM1, 5);
r = run(GM1, 'unleash');
check('config raidMax 3: three go', /warband of 3 is unleashed/.test(r) && band(GM1) === 2, r);
r = run(GM1, 'unleash');
check('config raidGapSeconds 0: the rest go at once', /warband of 2 is unleashed/.test(r) && band(GM1) === 0, r);
check('config bodySeconds 600 reads in minutes', /removed after 10 min/.test(r), r);

const cfgFile = JSON.parse(fs.readFileSync(path.join(home, 'gamemode-config.json'), 'utf8'));
const w = cfgFile.warband;
check('gamemode-config.json warband: raidMax 10, raidGapSeconds 60, maxHostile 25, bodySeconds 60', w.raidMax === 10 && w.raidGapSeconds === 60 && w.maxHostile === 25 && w.bodySeconds === 60, w);

process.chdir(home);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Windows may hold it */ }
delete globalThis.__dboCompanions; delete globalThis.__dboWarband;
Date.now = realNow;
console.log('');
console.log(failures ? `${failures} FAILURES` : 'all checks passed');
process.exitCode = failures ? 1 : 0;
