// Grand Healing reaches the players around the caster (grandhealing.js, Leader 31 Oct): each hurt player within 600 units
// is healed once by the spell's area health, never twice when the engine's own hit healed them, never the caster, an NPC,
// the dead, a full bar, another cell, or a heal the vampire rules refuse.
//   node tests/grand-healing-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) pass++; else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };

// Records: GrandHealing with Skyrim.esm's four effects (the self-only ones carry a different magnitude to tell them apart)
const GH = 0xb62ee, OTHER_SPELL = 0x12fcc, M_AREA = 0xb62ed, M_STAM = 0xb62f2, M_SELF = 0xdd642, M_HOSTILE = 0x1;
const u32 = (v) => { const d = new Uint8Array(4); new DataView(d.buffer).setUint32(0, v, true); return d; };
const efit = (mag, area) => { const d = new Uint8Array(12); const v = new DataView(d.buffer); v.setFloat32(0, mag, true); v.setUint32(4, area, true); return d; };
const mgef = (flags, av) => { const d = new Uint8Array(0x98); const v = new DataView(d.buffer); v.setUint32(0, flags, true); v.setInt32(0x44, av, true); return { type: 'MGEF', fields: [{ type: 'DATA', data: d }] }; };
const spel = (effects) => ({ type: 'SPEL', fields: effects.flatMap(([id, mag, area]) => [{ type: 'EFID', data: u32(id) }, { type: 'EFIT', data: efit(mag, area) }]) });
const RECORDS = new Map([
  [GH, spel([[M_SELF, 999, 0], [M_AREA, 200, 15], [M_STAM, 200, 15]])],
  [M_AREA, mgef(0x201200, 24)], [M_STAM, mgef(0x209200, 26)], [M_SELF, mgef(0x209a00, 24)], [M_HOSTILE, mgef(0x1, 24)],
]);
const recordOf = (id) => (RECORDS.has(id >>> 0) ? { record: RECORDS.get(id >>> 0), toGlobalRecordId: (l) => l } : null);

const CASTER = 0xff000010, NEAR = 0xff000011, HIT = 0xff000012, FULL = 0xff000013, FAR = 0xff000014, INSIDE = 0xff000015,
  NPC = 0xff000016, DEAD = 0xff000017, VAMP = 0xff000018, LATE = 0xff000019;
const props = new Map();
const put = (a, k, v) => props.set(`${a}|${k}`, v);
const healed = [], logged = [], timers = [];
let online = [];
const mp = {
  get: (a, k) => props.get(`${a}|${k}`), getIdFromDesc: (d) => (d === 'b62ee:Skyrim.esm' ? GH : 0), getDescFromId: (id) => id.toString(16),
  callPapyrusFunction: (kind, cls, fn, self, args) => { if (fn === 'RestoreActorValue') healed.push([parseInt(self.desc, 16), args[0], args[1]]); },
};
const savedTimeout = global.setTimeout; global.setTimeout = (fn, ms) => { timers.push([fn, ms]); return 0; };
const run = () => { while (timers.length) timers.shift()[0](); };
globalThis.__dboVampHealBlocks = (c, t) => t === VAMP;
const load = (grandHealing) => require(path.resolve(ROOT, 'grandhealing.js'))({
  mp, log: (...x) => logged.push(x.join(' ')), recordOf, onlineActors: () => online, profileOf: (a) => (a === NPC ? -1 : 1), display: (a) => a.toString(16), cfg: { grandHealing },
});
const G = load({});
ok(G.areaHealthOf(GH) === 200, "the heal is the area effect's own magnitude (200), not the caster-only one", G.areaHealthOf(GH));
ok(logged.some((l) => /grand healing: on, 600 units, 1 spell\(s\), b62ee heals 200/.test(l)), 'the load line says the range and the heal', logged);

const at = (a, x, cell = 'tamriel', health = 0.4) => { put(a, 'pos', [x, 0, 0]); put(a, 'worldOrCellDesc', cell); put(a, 'percentages', { health, magicka: 1, stamina: 1 }); };
at(CASTER, 0, 'tamriel', 0.5); at(NEAR, 500); at(HIT, 100); at(FULL, 200, 'tamriel', 1); at(FAR, 700); at(INSIDE, 50, 'innA');
at(NPC, 100); at(DEAD, 100); put(DEAD, 'isDead', true); at(VAMP, 100); at(LATE, 300);
online = [CASTER, NEAR, HIT, FULL, FAR, INSIDE, NPC, DEAD, VAMP, LATE];

// The engine's hits come before the cast; LATE's comes after it, inside the settle
globalThis.__dboGrandHealHit(CASTER, HIT, GH);
globalThis.__dboGrandHealCast(CASTER, GH);
ok(timers.length === 1 && timers[0][1] === 400, 'the extra heal waits a moment for late hits', timers.map((t) => t[1]));
globalThis.__dboGrandHealHit(CASTER, LATE, GH);
run();
const who = healed.map((h) => h[0]);
ok(who.length === 1 && who[0] === NEAR && healed[0][1] === 'Health' && healed[0][2] === 200, 'only the hurt player 500 units away the engine missed is healed, by 200 Health', healed);
ok(!who.includes(HIT) && !who.includes(LATE), 'a player the engine already healed, before or just after the cast, is not healed again');
ok(!who.includes(CASTER), 'the caster is not healed twice');
ok(!who.includes(FULL) && !who.includes(FAR) && !who.includes(INSIDE), 'not a full bar, nor 700 units away, nor in another cell');
ok(!who.includes(NPC) && !who.includes(DEAD) && !who.includes(VAMP), 'not an NPC, the dead or downed, or a heal the vampire rules refuse');
ok(logged.some((l) => /grand healing: ff000010 healed ff000011 by 200 beyond the engine's reach/.test(l)), 'one log line per cast that healed someone', logged.slice(-1));

// The next cast: the old hits no longer count, and NEAR is healed once per cast
healed.length = 0;
global.Date.now = ((n) => () => n)(Date.now() + 10000);
globalThis.__dboGrandHealCast(CASTER, GH);
run();
ok(healed.filter((h) => h[0] === NEAR).length === 1 && healed.some((h) => h[0] === HIT), 'a later cast heals each once again, HIT too now that its old hit is stale', healed);

// Nothing for another spell, an NPC caster, or with the feature off
healed.length = 0;
globalThis.__dboGrandHealCast(CASTER, OTHER_SPELL); run();
globalThis.__dboGrandHealCast(NPC, GH); run();
ok(healed.length === 0 && timers.length === 0, 'another spell or an NPC caster: nothing');
load({ enabled: false });
globalThis.__dboGrandHealCast(CASTER, GH); run();
ok(healed.length === 0, 'enabled false: nothing');
load({ range: 800 });
globalThis.__dboGrandHealCast(CASTER, GH); run();
ok(healed.some((h) => h[0] === FAR), 'range is read from the config');

// Wiring and config
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const cast = gm.slice(gm.indexOf('const castHook = '), gm.indexOf('castHook.__dbo = true;'));
ok(/if \(verdict !== false && typeof globalThis\.__dboGrandHealCast === 'function'\)/.test(cast), 'gamemode castHook passes an allowed cast on');
const hit = gm.slice(gm.indexOf('const spellHitHook = '), gm.indexOf('spellHitHook.__dbo = true;'));
ok(/globalThis\.__dboGrandHealHit\(agg, tgt, spell\)/.test(hit), 'gamemode spellHitHook passes each spell hit on');
ok(/require\(GRANDHEALING_JS\)\(\{ mp, log, recordOf, onlineActors, profileOf, display, cfg \}\)/.test(gm), 'gamemode loads grandhealing.js');
const cfgFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
ok(cfgFile.grandHealing && cfgFile.grandHealing.enabled === true && cfgFile.grandHealing.range === 600 && cfgFile.grandHealing.spells[0] === 'b62ee:Skyrim.esm', 'gamemode-config.json: on, 600 units, Grand Healing', cfgFile.grandHealing);

global.setTimeout = savedTimeout;
console.log(`${pass}/${pass + fail}`);
process.exitCode = fail ? 1 : 0;
