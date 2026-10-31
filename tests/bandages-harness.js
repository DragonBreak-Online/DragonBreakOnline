// Binding wounds (bandages.js, Nat 31 Oct): the item chosen (a Bandage before a Linen Wrap), one spent, the share given a
// second at a time, a landed blow ending it, the cooldown, the PvP halving, and never at full health, downed or dead.
//   node tests/bandages-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) pass++; else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };
const near = (x, y) => Math.abs(x - y) < 1e-9;

const A = 0xff000001, BANDAGE = 0x900816, LINEN = 0x34cd6;
const props = new Map();
const put = (k, v) => props.set(`${A}|${k}`, v);
const pget = (k) => props.get(`${A}|${k}`);
const mp = { get: (a, k) => props.get(`${a}|${k}`), set: (a, k, v) => props.set(`${a}|${k}`, v), getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0 };
const told = [], packets = [], timers = new Map(), commands = new Map();
let now = 1e12;
const realNow = Date.now; Date.now = () => now;
globalThis.__dboCombatAt = new Map(); globalThis.__dboPvpAt = new Map();
let downed = false; globalThis.__dboIsDowned = () => downed;
delete globalThis.__dboBandages;
const api = { mp, log: () => {}, personal: (a, t) => told.push(t), sendPacket: (a, p) => packets.push(p), every: (n, ms, fn) => timers.set(n, fn),
  registerChatCommand: (n, fn, o) => commands.set(n, { fn, o }), cfg: {} };
const mod = require(path.resolve(ROOT, 'bandages.js'))(api);
const tick = (n) => { for (let i = 0; i < n; i++) { now += 1000; timers.get('bandages')(); } };
const pack = (bandages, linen) => put('inventory', { entries: [{ baseId: BANDAGE, count: bandages }, { baseId: LINEN, count: linen }, { baseId: 0x12eb7, count: 1, worn: true }].filter((e) => e.count) });
const count = (id) => ((pget('inventory') || {}).entries || []).filter((e) => e.baseId === id).reduce((s, e) => s + e.count, 0);
const hp = (h) => put('percentages', { health: h, magicka: 0.4, stamina: 0.7 });
const last = () => told[told.length - 1];

ok(commands.has('bandage') && timers.has('bandages'), '/bandage is registered and a one-second tick runs');
// A Bandage first: 30% over 10 s, one spent, slowed
pack(2, 3); hp(0.5);
commands.get('bandage').fn(A);
ok(/bind your wounds with a bandage\./.test(last()) && count(BANDAGE) === 1 && count(LINEN) === 3, 'a Bandage is chosen over a Linen Wrap, and one is spent', [last(), count(BANDAGE)]);
ok(packets.length === 1 && packets[0].customPacketType === 'dboStatus' && packets[0].kind === 'bandage' && packets[0].seconds === 10 && packets[0].speedMult === -50, 'the binder is slowed for the binding (dboStatus, -50 for 10 s)', packets);
ok(((pget('inventory') || {}).entries || []).some((e) => e.worn), 'what is worn stays');
tick(1);
ok(near(pget('percentages').health, 0.53) && pget('percentages').magicka === 0.4 && pget('percentages').stamina === 0.7, 'a second in: 3% back, magicka and stamina untouched', pget('percentages'));
mod.bind(A);
ok(/already binding/.test(last()), 'one binding at a time');
tick(9);
ok(near(pget('percentages').health, 0.8) && last() === 'Your wounds are bound.' && !mod.state.binding.size, '...after 10 s, 30% back and done', [pget('percentages'), last()]);
tick(3);
ok(near(pget('percentages').health, 0.8), 'nothing more once bound');
// The cooldown, then a Linen Wrap when the Bandages are gone
mod.bind(A);
ok(/still fresh\. Again in 47 s/.test(last()), 'once a minute', last());
now += 60000; pack(0, 3);
mod.bind(A);
tick(10);
ok(/with a linen wrap\./.test(told.find((t) => /linen wrap\./.test(t)) || '') && near(pget('percentages').health, 1.0) && count(LINEN) === 2, 'a Linen Wrap gives 20%, capped at full health', [pget('percentages'), count(LINEN)]);
// Full health, nothing carried, downed, dead
now += 60000;
mod.bind(A);
ok(/no wounds worth binding/.test(last()) && count(LINEN) === 2, 'at full health nothing is spent');
hp(0.4); pack(0, 0);
mod.bind(A);
ok(/carry nothing to bind wounds with/.test(last()), 'nothing to bind with');
pack(1, 0); downed = true;
mod.bind(A);
ok(/past binding/.test(last()) && count(BANDAGE) === 1, 'not while down, and nothing spent');
downed = false; hp(0);
mod.bind(A);
ok(/past binding/.test(last()), 'not when dead');
// A blow ends it; the rest is lost
hp(0.4);
mod.bind(A);
tick(2);
globalThis.__dboCombatAt.set(A, now + 1);
tick(1);
ok(near(pget('percentages').health, 0.46) && /A blow loosens a bandage; the binding is lost\./.test(last()) && !mod.state.binding.size, 'a landed blow ends it: 6% given, the rest lost', [pget('percentages'), last()]);
// In a fight with a player: half
now += 60000; pack(1, 0); hp(0.4);
globalThis.__dboPvpAt.set(A, now - 5000);
mod.bind(A);
ok(/with a bandage, in haste\./.test(last()), 'in a PvP fight it is a hasty binding', last());
tick(10);
ok(near(pget('percentages').health, 0.55), '...15% instead of 30%', pget('percentages'));
// Downed mid-binding stops it
now += 60000; pack(1, 0); hp(0.4); globalThis.__dboPvpAt.clear();
mod.bind(A); tick(1); downed = true; tick(1);
ok(!mod.state.binding.size && near(pget('percentages').health, 0.43), 'downed mid-binding: it stops', pget('percentages'));
downed = false;

// Wiring and config
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
ok(/require\(BANDAGES_JS\)\(\{ mp, log, personal, registerChatCommand, sendPacket, every, cfg \}\)/.test(gm), 'gamemode.js loads bandages.js');
const cfgFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8')).bandages || {};
ok(cfgFile.enabled === true && cfgFile.seconds === 10 && cfgFile.cooldownSeconds === 60 && cfgFile.pvpMult === 0.5 && cfgFile.items[0].desc === '900816:ccBGSSSE001-Fish.esm' && cfgFile.items[1].desc === '34cd6:Skyrim.esm', 'gamemode-config.json bandages: the defaults', cfgFile);

Date.now = realNow;
console.log(`${pass}/${pass + fail}`);
process.exitCode = fail ? 1 : 0;
