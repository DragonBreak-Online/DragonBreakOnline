// Bosses worth grinding (Nat, 25 Oct; bosses.js, bosses.json from tools/bosses/bosses_build.py). Loads the real bosses.js
// in a scratch folder with a mock gamemode api and walks a fight: the zones it writes (and keeps the others'), a boss
// rising (named, glowing, announced to its hold), toughness while its guardian lives and after, waves at their shares,
// enrage, its damage on players, the reward per fighter (10% share, the top damager's shards, the schematic or the known
// bonus, Briarhearts left out, a companion's damage for its owner), the 20 h account lockout, a roaming boss's next spot,
// and the boss-only schematic hook in manuals.js.
//   node tests/bosses-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!c) fails++; };
const REAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'bosses.json'), 'utf8'));
const def = (id) => REAL.bosses.find((b) => b.id === id);

// ---- the shipped data ----
ok(REAL.bosses.map((b) => b.id).join() === 'icecap,briarheartking,centurion,palewarlord', 'four bosses: the Ice Cap Wraith, the Briarheart King, the Centurion Master, the Warlord of the Pale Pass');
ok(def('icecap').enabled === false && def('palewarlord').enabled === false && def('briarheartking').enabled && def('centurion').enabled, 'the Wraith and the Warlord wait on Nat (spot, shard); the King and the Centurion are on');
ok(def('icecap').boss.options[0][2] === 'EncIceWraith' && def('icecap').spots.length === 4 && def('icecap').drops.schematic.family === 'glacial_crystal', 'the Wraith: a vanilla ice wraith, four candidate spots, the Glacial Crystal schematic');
ok(def('briarheartking').boss.options.slice(-1)[0][2] === 'EncForsworn06BossMagicBretonM03' && def('briarheartking').guardian.options[0][2] === 'EncHagraven', 'the King: the strongest Forsworn boss shaman, his Hagraven beside him');
ok(REAL.bosses.every((b) => b.spots.every((s) => s.ref && s.anchorDist < 2500)), 'every spot has an anchor within 2500 units');

// ---- a scratch folder and a test copy where every boss is on ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-bosses-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
const SHARD = '3ad5f:Skyrim.esm';   // a stand-in for the Glacial Crystal Shard until Worker 2's id exists
const copy = JSON.parse(JSON.stringify(REAL));
for (const b of copy.bosses) b.enabled = true;
copy.bosses.find((b) => b.id === 'icecap').drops.shards.desc = SHARD;
fs.writeFileSync(path.join(dir, 'bosses.json'), JSON.stringify(copy));
fs.writeFileSync(path.join(dir, 'NPC-Spawns.json'), JSON.stringify({ zones: [{ Name: 'wild:wolf:1', NPC: [{ id: 'x', count: 1 }] }, { Name: 'dungeon:X:1', NPC: [] }] }));

let now = 1790000000000;
const realNow = Date.now; Date.now = () => now;
let rnd = 0.5; const realRandom = Math.random; Math.random = () => rnd;
const P1 = 0xff000101, P2 = 0xff000102, P3 = 0xff000103, BRIAR = 0xff000104, PET = 0xff000105, FAR = 0xff000106;
const PROFILE = { [P1]: 11, [P2]: 12, [P3]: 13, [BRIAR]: 14, [FAR]: 16 };
const props = new Map(), said = [], audits = [], given = [], names = [], glows = [];
const put = (id, k, v) => props.set(`${id}|${k}`, v);
const PLUGINS = { 'Skyrim.esm': 0, 'BSHeartland.esm': 8 };
const idOf = (d) => { const [h, p] = String(d).split(':'); if (!(p in PLUGINS)) throw new Error('no plugin ' + p); return ((PLUGINS[p] << 24) | parseInt(h, 16)) >>> 0; };
const mp = {
  get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v), getIdFromDesc: idOf, getDescFromId: (id) => (id >>> 0).toString(16),
  callPapyrusFunction: (kind, cls, fn, self, args) => { if (fn === 'SetDisplayName') names.push([self.desc, args[0]]); },
};
const HOLD = { [P1]: 'markarth', [P2]: 'markarth', [P3]: 'markarth', [BRIAR]: 'markarth', [FAR]: 'whiterun' };
for (const a of Object.keys(HOLD)) put(a, 'worldOrCellDesc', '3c:Skyrim.esm');
put(PET, 'private.dboCompanion', true); put(PET, 'ff_companionOf', P3);
globalThis.__dboSchematicBook = (fam) => ({ bookId: 0x7000, name: `Schematics: ${fam}` });
let known = new Set();
globalThis.__dboKnowsFamily = (a, fam) => known.has(`${a}:${fam}`);
globalThis.__dboIsBriarheart = (a) => a === BRIAR;
const timers = new Map();
const cwd = process.cwd();
const load = (cfg) => {
  process.chdir(dir);
  try {
    delete require.cache[path.join(ROOT, 'bosses.js')];
    require(path.join(ROOT, 'bosses.js'))({ mp, log: () => {}, personal: (a, t) => said.push([a, t]), audit: (t) => audits.push(t), display: (a) => `P${(a >>> 0).toString(16)}`, who: String,
      cfg: cfg || {}, giveItem: (a, id, n) => { given.push([a, id, n]); return true; }, registerChatCommand: () => {}, sendPacket: (a, p) => glows.push([a, p]),
      onlineActors: () => [P1, P2, P3, BRIAR, FAR], every: (n, ms, fn) => timers.set(n, fn), stopTimer: () => {}, profileOf: (a) => (PROFILE[a] !== undefined ? PROFILE[a] : -1), zoneOfActor: (a) => HOLD[a] || null });
  } finally { process.chdir(cwd); }
};
const zones = () => JSON.parse(fs.readFileSync(path.join(dir, 'NPC-Spawns.json'), 'utf8')).zones;
const tick = (live) => { fs.writeFileSync(path.join(dir, 'zone-spawns.json'), JSON.stringify(live)); process.chdir(dir); try { timers.get('bosses')(); } finally { process.chdir(cwd); } };
const toldTo = (a) => said.filter((x) => x[0] === a).map((x) => x[1]).join(' | ');

// ---- zones ----
load({});
let z = zones();
ok(z.some((x) => x.Name === 'wild:wolf:1') && z.some((x) => x.Name === 'dungeon:X:1'), 'the other modules\' zones are kept');
const bz = z.filter((x) => x.Name.startsWith('boss:'));
const king = bz.find((x) => x.Name === 'boss:briarheartking:boss'), hag = bz.find((x) => x.Name === 'boss:briarheartking:guardian');
ok(king && hag && king.Hostile && hag.Hostile && king.Respawn === 7200 && king.NPC[0].id === 'ad7c1:Skyrim.esm', 'the King and his Hagraven: hostile boss zones, back 2 h after a kill, the strongest boss shaman', [king, hag]);
ok(bz.filter((x) => /^boss:icecap:open\d$/.test(x.Name)).length === 3 && bz.filter((x) => /^boss:palewarlord:open\d$/.test(x.Name)).length === 2, 'opening adds: the Wraith\'s three ice wraiths, the Warlord\'s two bandits');
load({ bosses: { only: ['centurion'] } });
ok(zones().filter((x) => x.Name.startsWith('boss:')).every((x) => x.Name.startsWith('boss:centurion:')), 'bosses.only keeps the rest\'s zones out');
load({ bosses: { enabled: false } });
ok(!zones().some((x) => x.Name.startsWith('boss:')), 'bosses.enabled false writes no boss zone (the rollback)');
load({});

// ---- a fight: the Briarheart King ----
const K = 0xff200001, H = 0xff200002, ADD = 0xff200003;
put(K, 'private.npcSpawner', 'boss:briarheartking:boss'); put(H, 'private.npcSpawner', 'boss:briarheartking:guardian');
put(K, 'percentages', { health: 1, magicka: 1, stamina: 1 });
tick([K, H]);
ok(names.some(([d, n]) => d === K.toString(16) && n === 'The Briarheart King') && names.some(([d, n]) => d === H.toString(16) && n === "The King's Hagraven"), 'the King and his Hagraven are named', names);
ok(glows.some(([, p]) => p.kind === 'champion' && p.refs.includes(K) && p.on), 'the King glows as a champion does (SetScale is a stub)');
ok(/crowned a Briarheart King/.test(toldTo(P1)) && !/crowned/.test(toldTo(FAR)), 'Markarth\'s hold hears he has risen; Whiterun does not');
const hit = (agg, tgt, dmg, healthAfter) => { put(tgt, 'percentages', { health: healthAfter, magicka: 1, stamina: 1 }); globalThis.__dboBossHit(agg, tgt, dmg); return props.get(`${tgt}|percentages`).health; };
let h = hit(P1, K, 100, 0.9);
ok(Math.abs(h - (0.9 + 0.1 * 0.85)) < 1e-9, 'while the Hagraven lives, 85% of each blow is given back', h);
globalThis.__dboBossDeath(H, P2);
ok(/laid open/.test(toldTo(P1)), 'the Hagraven falls: the King is laid open');
h = hit(P2, K, 250, h - 0.1);
ok(Math.abs(h - (0.985 - 0.1 + 0.1 * 0.4)) < 1e-9, '...and then only 40% is given back', h);
ok(globalThis.__dboBossDamageMult(K, P1) === 1.5 && globalThis.__dboBossDamageMult(ADD, P1) === 1 && globalThis.__dboBossDamageMult(K, ADD) === 1, 'the King hits players x1.5; an add, or a hit on an NPC, is untouched');
h = hit(P3, K, 300, 0.45);
ok(zones().filter((x) => /^boss:briarheartking:w0-\d$/.test(x.Name)).length === 2 && zones().find((x) => x.Name === 'boss:briarheartking:w0-0').Respawn === 1e9, 'below 66%: the first wave, two Forsworn beside him, never respawning', zones().filter((x) => x.Name.includes(':w')).map((x) => x.Name));
h = hit(PET, K, 200, 0.1);
ok(zones().filter((x) => /^boss:briarheartking:w1-\d$/.test(x.Name)).length === 3, 'below 33%: the second wave of three');
now += 481000; tick([K]);
ok(globalThis.__dboBossDamageMult(K, P1) === 2.5 && /grows furious/.test(toldTo(P2)), 'eight minutes after the first blow he is enraged: x2.5');
hit(BRIAR, K, 400, 0.1);
hit(FAR, K, 20, 0.05);   // under 10% of the damage
given.length = 0; said.length = 0; rnd = 0.01;
globalThis.__dboBossDeath(K, P1);
const gotBy = (a) => given.filter((g) => g[0] === a);
ok(gotBy(P1).some((g) => g[1] === idOf('3ad61:Skyrim.esm')) && gotBy(P2).length && gotBy(P3).length, 'every fighter with a real share gets the Briar Heart (P3 for his companion\'s blows too)', given);
ok(gotBy(P1).some((g) => g[1] === 0x7000), '...and at a lucky roll the Silver schematic');
ok(!gotBy(FAR).length, 'a fighter under 10% of the damage gets nothing');
ok(!gotBy(BRIAR).length && /of your own blood/.test(toldTo(BRIAR)), 'a Briarheart gets nothing for the King');
ok(!zones().some((x) => x.Name.startsWith('boss:') && x.Name.includes(':w')) && /fallen/.test(toldTo(P1)), 'the waves go with the fight; the hold hears he has fallen', [zones().filter((x) => x.Name.includes(':w')).map((x) => x.Name), toldTo(P1)]);
ok(audits.some((t) => /^BOSS briarheartking killed at LV \(enraged\) by /.test(t)), 'audited, enraged', audits.slice(-1));
// The lockout: the next King inside 20 h pays nothing
put(K, 'percentages', { health: 1, magicka: 1, stamina: 1 });
now += 7200000; tick([K]);
hit(P1, K, 100, 0.5); given.length = 0; said.length = 0;
globalThis.__dboBossDeath(K, P1);
ok(!gotBy(P1).length && /reward from it lately\. 18 hours to go/.test(toldTo(P1)), 'a second King within 20 h pays that account nothing', toldTo(P1));

// ---- the Wraith: shards, the top damager, the known bonus ----
const W = 0xff300001;
put(W, 'private.npcSpawner', 'boss:icecap:boss'); put(W, 'percentages', { health: 1, magicka: 1, stamina: 1 });
HOLD[P1] = HOLD[P2] = 'winterhold';
tick([W]);
hit(P1, W, 600, 0.5); hit(P2, W, 400, 0.2);
known = new Set([`${P2}:glacial_crystal`]);
given.length = 0; rnd = 0.02;
globalThis.__dboBossDeath(W, P1);
const shards = (a) => given.filter((g) => g[0] === a && g[1] === idOf(SHARD)).reduce((n, g) => n + g[2], 0);
ok(shards(P1) === 7 + 2 && gotBy(P1).some((g) => g[1] === 0x7000 && g[2] === 1), 'the top damager: 7 shards + 2 Frost Salts, and at a 2% roll the Glacial schematic', gotBy(P1));
ok(shards(P2) === 5 + 2 + 2 && !gotBy(P2).some((g) => g[1] === 0x7000), 'a smith who knows Glacial Crystal: 5 shards, 2 more instead of the schematic (+2 Frost Salts)', gotBy(P2));

// ---- the roaming Warlord moves on after a kill ----
const B = 0xff400001;
put(B, 'private.npcSpawner', 'boss:palewarlord:boss'); put(B, 'percentages', { health: 1, magicka: 1, stamina: 1 });
tick([B]);
const before = zones().find((x) => x.Name === 'boss:palewarlord:boss').POS.join();
hit(P3, B, 100, 0.3);
globalThis.__dboBossDeath(B, P3);
const after = zones().find((x) => x.Name === 'boss:palewarlord:boss').POS.join();
ok(before !== after && after === copy.bosses.find((b) => b.id === 'palewarlord').spots[1].pos.join(), 'the Warlord of the Pale Pass rises at his next camp', [before, after]);
ok(JSON.parse(fs.readFileSync(path.join(dir, 'bosses-state.json'), 'utf8')).spot.palewarlord === 1, '...kept in bosses-state.json');

// ---- each boss's own config block (Nat, 25 Oct: they go live one by one) ----
fs.writeFileSync(path.join(dir, 'bosses.json'), JSON.stringify(REAL));
load({ bosses: { icecap: { enabled: true, spot: 'S2' }, briarheartking: { enabled: false } } });
const cz = zones().filter((x) => x.Name.startsWith('boss:'));
const wraith = cz.find((x) => x.Name === 'boss:icecap:boss');
ok(wraith && wraith.POS.join() === def('icecap').spots[1].pos.join(), 'bosses.icecap { enabled, spot: S2 } turns the Wraith on at its second candidate, whatever bosses.json says', wraith);
ok(!cz.some((x) => x.Name.startsWith('boss:briarheartking:')) && cz.some((x) => x.Name === 'boss:centurion:boss') && !cz.some((x) => x.Name.startsWith('boss:palewarlord:')),
  'bosses.briarheartking.enabled false takes the King off; the Centurion stays on and the Warlord off as the data says');
ok(def('icecap').drops.shards.desc === '1d2201:DragonBreak Online Edits.esp' && def('icecap').drops.shards.count === 5 && def('icecap').drops.shards.top === 7,
  'the Wraith drops the Glacial Crystal Shard (DLE 1D2201): 5 a fighter, 7 for the top damager (a 36-shard set in 5-7 days)');

// ---- manuals.js: the boss-only schematic hook ----
const msrc = fs.readFileSync(path.join(ROOT, 'manuals.js'), 'utf8');
ok(/globalThis\.__dboSchematicBook = \(family\) =>/.test(msrc) && /!x\.staffOnly && !x\.withheld/.test(msrc) && /globalThis\.__dboKnowsFamily = /.test(msrc), 'manuals.js hands a family\'s schematic to a boss (never a staff-only or withheld one) and says whether a smith knows it');
const gsrc = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
ok(/__dboBossDeath\(Number\(actorId\)/.test(gsrc) && /__dboBossHit\(agg, tgt, dealt\)/.test(gsrc) && /__dboBossDamageMult\(agg, tgt\)/.test(gsrc) && /require\(BOSSES_JS\)/.test(gsrc), 'gamemode.js loads bosses.js and calls its death, hit and damage hooks');

Date.now = realNow; Math.random = realRandom;
console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
