// Binding wounds (bandages.js, Nat 31 Oct): the item chosen (a Bandage before a Linen Wrap), seven seconds kept still with a
// countdown banner, the heal and the item spent only on completion, moving, casting or a blow undoing it with the item kept,
// the PvP halving, no cooldown, and never at full health, downed or dead.
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
delete globalThis.__dboBandages; delete globalThis.__dboBandageCast;
const api = { mp, log: () => {}, personal: (a, t) => told.push(t), sendPacket: (a, p) => packets.push(p), every: (n, ms, fn) => timers.set(n, fn),
  registerChatCommand: (n, fn, o) => commands.set(n, { fn, o }), cfg: {} };
const mod = require(path.resolve(ROOT, 'bandages.js'))(api);
const tick = (n) => { for (let i = 0; i < n; i++) { now += 1000; timers.get('bandages')(); } };
const pack = (bandages, linen) => put('inventory', { entries: [{ baseId: BANDAGE, count: bandages }, { baseId: LINEN, count: linen }, { baseId: 0x12eb7, count: 1, worn: true }].filter((e) => e.count) });
const count = (id) => ((pget('inventory') || {}).entries || []).filter((e) => e.baseId === id).reduce((s, e) => s + e.count, 0);
const hp = (h) => put('percentages', { health: h, magicka: 0.4, stamina: 0.7 });
const last = () => told[told.length - 1];
const banners = () => packets.filter((p) => p.customPacketType === 'dboBanner').map((p) => p.text);
put('pos', [100, 200, 300]); put('worldOrCellDesc', '3c:Skyrim.esm');

ok(commands.has('bandage') && timers.has('bandages') && typeof globalThis.__dboBandageCast === 'function', '/bandage, a one-second tick and the cast hook are registered');
// A Bandage first; nothing spent or healed until the 7 s are kept
pack(2, 3); hp(0.5);
commands.get('bandage').fn(A);
ok(/start binding your wounds with a bandage\. Keep still for 7 s/.test(last()) && count(BANDAGE) === 2, 'a Bandage is chosen over a Linen Wrap; nothing is spent at the start', [last(), count(BANDAGE)]);
ok(banners()[0] === 'Binding your wounds… (7 s)' && !packets.some((p) => p.customPacketType === 'dboStatus'), 'a "Binding your wounds… (7 s)" banner, and no slow', packets);
mod.bind(A);
ok(/already binding/.test(last()), 'one binding at a time');
put('pos', [130, 200, 300]);   // a shuffle within the tolerance
tick(3);
ok(near(pget('percentages').health, 0.5) && banners().pop() === 'Binding your wounds… (4 s)', 'three seconds in: nothing healed yet, the banner counts down; a small shuffle is allowed', [pget('percentages'), banners().pop()]);
tick(4);
ok(near(pget('percentages').health, 0.8) && pget('percentages').magicka === 0.4 && count(BANDAGE) === 1 && last() === 'Your wounds are bound.' && !mod.state.binding.size, 'after 7 s: one Bandage spent, 30% back at once, magicka untouched', [pget('percentages'), count(BANDAGE), last()]);
ok(((pget('inventory') || {}).entries || []).some((e) => e.worn), 'what is worn stays');
// No cooldown: straight away again, a Linen Wrap once the Bandages are gone
pack(0, 3); hp(0.5);
mod.bind(A);
ok(/with a linen wrap\./.test(last()), 'no cooldown: a second binding straight after', last());
tick(7);
ok(near(pget('percentages').health, 0.7) && count(LINEN) === 2, 'a Linen Wrap gives 20%', [pget('percentages'), count(LINEN)]);
hp(0.9); mod.bind(A); tick(7);
ok(near(pget('percentages').health, 1.0), 'capped at full health', pget('percentages'));
// Moving undoes it, the item kept
hp(0.5); pack(1, 0);
mod.bind(A); tick(2);
put('pos', [100, 300, 300]); tick(1);
ok(/You moved; the binding is left undone\. A bandage is kept\./.test(last()) && count(BANDAGE) === 1 && near(pget('percentages').health, 0.5) && !mod.state.binding.size, 'walking off undoes it: nothing healed, the Bandage kept', [last(), count(BANDAGE)]);
put('pos', [100, 200, 300]);
mod.bind(A); put('worldOrCellDesc', '1234:Skyrim.esm'); tick(1);   // verify-formids: ignore - a made-up cell for the stub
ok(/You moved/.test(last()) && count(BANDAGE) === 1, 'through a door counts as moving');
put('worldOrCellDesc', '3c:Skyrim.esm');
// Casting undoes it
mod.bind(A); tick(1);
globalThis.__dboBandageCast(A);
ok(/leave off binding your wounds to cast\. A bandage is kept\./.test(last()) && !mod.state.binding.size && count(BANDAGE) === 1, 'a cast undoes it, the Bandage kept', last());
globalThis.__dboBandageCast(A);
ok(/to cast/.test(last()) && told.filter((t) => /to cast/.test(t)).length === 1, 'a cast with no binding says nothing');
// A blow undoes it
mod.bind(A); tick(2);
globalThis.__dboCombatAt.set(A, now + 1); tick(1);
ok(/A blow breaks off your binding\. A bandage is kept\./.test(last()) && count(BANDAGE) === 1 && near(pget('percentages').health, 0.5), 'a landed blow undoes it, nothing healed, the Bandage kept', last());
// In a fight with a player: half
globalThis.__dboPvpAt.set(A, now - 5000);
mod.bind(A);
ok(/with a bandage, in haste\./.test(last()), 'in a PvP fight it is a hasty binding', last());
tick(7);
ok(near(pget('percentages').health, 0.65) && last() === 'Your wounds are bound, in haste.' && count(BANDAGE) === 0, '...15% instead of 30%', pget('percentages'));
globalThis.__dboPvpAt.clear();
// The item gone by the end
pack(1, 0); hp(0.5); mod.bind(A); tick(3); pack(0, 0); tick(4);
ok(/no longer have a bandage/.test(last()) && near(pget('percentages').health, 0.5), 'the Bandage dropped mid-binding: no heal', last());
// Full health, nothing carried, downed, dead
hp(1);
mod.bind(A);
ok(/no wounds worth binding/.test(last()), 'not at full health');
hp(0.4);
mod.bind(A);
ok(/carry nothing to bind wounds with/.test(last()), 'nothing to bind with');
pack(1, 0); downed = true;
mod.bind(A);
ok(/past binding/.test(last()) && !mod.state.binding.size, 'not while down');
downed = false; hp(0);
mod.bind(A);
ok(/past binding/.test(last()), 'not when dead');
hp(0.4); mod.bind(A); tick(1); downed = true; tick(1);
ok(!mod.state.binding.size && near(pget('percentages').health, 0.4) && count(BANDAGE) === 1, 'downed mid-binding: it stops, the Bandage kept');
downed = false;

// Wiring and config
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
ok(/require\(BANDAGES_JS\)\(\{ mp, log, personal, registerChatCommand, sendPacket, every, cfg \}\)/.test(gm), 'gamemode.js loads bandages.js');
ok(/const castHook = \(casterId, spellId, \.\.\.rest\) => \{\r?\n.*racial\.onCast.*\r?\n.*\r?\n\s*try \{ if \(typeof globalThis\.__dboBandageCast === 'function'\) globalThis\.__dboBandageCast\(casterId\);/.test(gm), 'castHook tells bandages.js of every cast, before any verdict');
const cfgFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8')).bandages || {};
ok(cfgFile.enabled === true && cfgFile.seconds === 7 && cfgFile.moveTolerance === 48 && cfgFile.pvpMult === 0.5 && !('cooldownSeconds' in cfgFile) && !('speedMult' in cfgFile) && cfgFile.items[0].desc === '900816:ccBGSSSE001-Fish.esm' && cfgFile.items[1].desc === '34cd6:Skyrim.esm', 'gamemode-config.json bandages: 7 s still, no cooldown, no slow', cfgFile);

Date.now = realNow;
console.log(`${pass}/${pass + fail}`);
process.exitCode = fail ? 1 : 0;
