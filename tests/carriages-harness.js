// Hold carriages (carriages.js, Jake 5 Nov): drivers at the five stables, vanilla fares 20/50, the fare taken at departure into the boarding hold's treasury.
//   node tests/carriages-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carriages-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS clears it */ } });
let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) pass++; else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };

const P = 0xff000101, Q = 0xff000102, DRV = 0xff000900, OTHER = 0xff000901;
const WHITERUN_STABLE = [17589.8, -12411.6, -4745.1];
const ZONES = { whiterun: { majorCity: true }, solitude: { majorCity: true }, markarth: { majorCity: true }, riften: { majorCity: true }, windhelm: { majorCity: true }, falkreath: {}, morthal: {}, dawnstar: {}, winterhold: {} };
const GATE_SPOT = { Whiterun: [18313, -10665, -4588.5], Riften: [173137, -90912, 11073.9], Solitude: [-74313.4, 96373.3, -11483.6], Windhelm: [135039, 33143, -12547.6], Markarth: [-171223, 6919.6, -3908.4],
  Falkreath: [-30323.8, -86273.2, -3094.4], Morthal: [-38293.3, 67050.7, -13860.8], Dawnstar: [30549.8, 106123.5, -14178.9], Winterhold: [109208, 102864, -8953.7] };

let timers = [];
globalThis.setTimeout = (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; };
globalThis.clearTimeout = (t) => { if (t) t.live = false; };
const runTimers = (kind) => { const due = timers.filter((t) => t.live && (kind === 'ride' ? t.ms < 10000 : true)); timers = timers.filter((t) => !due.includes(t)); for (const t of due) { t.live = false; t.fn(); } };

let props, told, packets, widgets, closed, audits, deposits, moves, plog, gold, ui, cmds, online, pickedFor;
const reset = () => {
  props = new Map(); told = []; packets = []; widgets = []; closed = []; audits = []; deposits = []; moves = []; plog = []; ui = {}; cmds = {}; online = [P, Q]; pickedFor = [];
  gold = new Map([[P, 100], [Q, 10]]);
  timers = [];
  for (const a of [P, Q]) { props.set(`${a}|worldOrCellDesc`, '3c:Skyrim.esm'); props.set(`${a}|pos`, WHITERUN_STABLE.slice()); }
  props.set(`${DRV}|private.npcSpawner`, 'carriage:solitude'); props.set(`${DRV}|worldOrCellDesc`, '3c:Skyrim.esm'); props.set(`${DRV}|pos`, [-73225.0, 99456.7, -10906.7]);
  props.set(`${OTHER}|private.npcSpawner`, 'guard:solitude:1');
  globalThis.__dboCarriageRiding = new Map(); globalThis.__dboCarriageDrivers = new Map(); globalThis.__dboCarriagesSig = undefined;
  globalThis.__dboIsDowned = () => false; globalThis.__dboJailUnstuck = () => null;
  globalThis.__dboCourierParcelBase = () => 0x1ac960; globalThis.__dboCourierSealed = () => 0;
  globalThis.__dboPlogHook = (k, a, reason) => plog.push([k, a, reason]);
};
const combatAt = new Map(), pvpAt = new Map();
let creating = new Set();
const load = (carriages) => {
  for (const k of Object.keys(require.cache)) if (k.endsWith('carriages.js')) delete require.cache[k];
  require(path.join(ROOT, 'carriages.js'))({
    mp: { get: (a, k) => props.get(`${a >>> 0}|${k}`), set: (a, k, v) => { props.set(`${a >>> 0}|${k}`, v); if (k === 'locationalData') moves.push([a >>> 0, v]); } },
    log: () => {}, personal: (a, t) => told.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `P${(a >>> 0).toString(16)}`, cfg: { carriages },
    registerChatCommand: (n, f) => { cmds[n] = f; }, openWidget: (a, w) => widgets.push([a >>> 0, w]), closeWidget: (a, wid) => closed.push([a >>> 0, wid]),
    onUi: (ev, fn) => { (ui[ev] = ui[ev] || []).push(fn); }, sendPacket: (a, p) => packets.push([a >>> 0, p]),
    takeGold: (a, n) => { const g = gold.get(a >>> 0) || 0; if (g < n) return false; gold.set(a >>> 0, g - n); return true; }, goldOf: (a) => gold.get(a >>> 0) || 0,
    depositToTreasury: (z, n, o) => { deposits.push([z, n, o && o.income]); return n; }, zoneById: (z) => ZONES[z] || null, creationPending: (a) => creating.has(a >>> 0),
    arrivalFor: (name, a) => { if (a) pickedFor.push([name, a]); return GATE_SPOT[name] ? { pos: GATE_SPOT[name], rotZ: 0 } : null; }, onlineActors: () => online, combatAt, pvpAt,
  });
};
const said = (a) => told.filter((x) => x[0] === a).map((x) => x[1]);
const last = (a) => { const s = said(a); return s[s.length - 1] || ''; };
const fire = (ev, a, args) => (ui[ev] || []).forEach((fn) => fn(a, args || []));
const fades = (a) => packets.filter((x) => x[0] === a && x[1].customPacketType === 'dboFade').map((x) => x[1].on);
const spawns = () => { try { return JSON.parse(fs.readFileSync('NPC-Spawns.json', 'utf8')).zones || []; } catch (e) { return []; } };

// ---- the drivers, written into NPC-Spawns.json beside other writers' zones -------------------------------------------------
reset();
fs.writeFileSync('NPC-Spawns.json', JSON.stringify({ _comment: 'x', zones: [{ Name: 'guard:solitude:1', ID: '3c:Skyrim.esm', POS: [1, 2, 3] }, { Name: 'wild:wolf:0' }] }));
load({});
let z = spawns();
const drv = z.filter((x) => String(x.Name).startsWith('carriage:'));
ok(drv.length === 5 && ['whiterun', 'solitude', 'markarth', 'riften', 'windhelm'].every((s) => drv.some((x) => x.Name === `carriage:${s}`)), 'a driver zone at each of the five stables', drv.map((x) => x.Name));
const wd = drv.find((x) => x.Name === 'carriage:whiterun');
ok(wd && wd.ID === '3c:Skyrim.esm' && wd.POS.join() === WHITERUN_STABLE.join() && wd.NPC[0].id === '13669:Skyrim.esm' && wd.Heading === 275 && wd.Hostile === false, 'Whiterun\'s is the base game driver at the base game spot', wd);
ok(z.some((x) => x.Name === 'guard:solitude:1') && z.some((x) => x.Name === 'wild:wolf:0') && JSON.parse(fs.readFileSync('NPC-Spawns.json', 'utf8'))._comment === 'x', 'other writers\' zones and the file\'s own keys are kept');
load({});
ok(spawns().filter((x) => String(x.Name).startsWith('carriage:')).length === 5, 'a reload writes no second set');
load({ drivers: { enabled: false } });
ok(spawns().filter((x) => String(x.Name).startsWith('carriage:')).length === 0 && spawns().length === 2, 'drivers.enabled false takes the drivers away, nothing else');
load({ enabled: false });
ok(spawns().filter((x) => String(x.Name).startsWith('carriage:')).length === 0, 'enabled false: no drivers');
cmds.carriage(P, '');
ok(/not running/.test(last(P)), 'enabled false: the command says so', said(P));

// ---- hiring at a stable ------------------------------------------------------------------------------------------------------
reset(); load({});
props.set(`${P}|pos`, [0, 0, 0]);
cmds.carriage(P, '');
ok(/stables outside Whiterun, Solitude, Markarth, Riften and Windhelm/.test(last(P)) && !widgets.length, 'away from a stable: where the carriages leave from', said(P));
props.set(`${P}|pos`, [WHITERUN_STABLE[0] + 300, WHITERUN_STABLE[1], WHITERUN_STABLE[2]]);
cmds.carriage(P, '');
const menu = widgets[0] && widgets[0][1];
ok(menu && menu.type === 'contextMenu' && menu.id === 176 && /Carriage from Whiterun/.test(menu.targetName) && menu.events.action === 'dbo:carriageChoose', 'by the Whiterun driver: the destinations menu', menu);
ok(menu && menu.actions.length === 8 && !menu.actions.some((x) => x.id === 'whiterun'), 'every other town, never the one you stand in', menu && menu.actions.map((x) => x.id));
ok(menu && menu.actions.find((x) => x.id === 'riften').label === 'Riften: 20 gold' && menu.actions.find((x) => x.id === 'dawnstar').label === 'Dawnstar: 50 gold', 'vanilla fares: 20 to a capital, 50 to a minor hold', menu && menu.actions);
ok(pickedFor.length === 0, 'listing destinations holds no arrival spot');
fire('carriageChoose', P, ['riften']);
ok(closed.some((x) => x[0] === P && x[1] === 176), 'the menu closes on a choice');
ok(gold.get(P) === 100 && fades(P).join() === 'true' && /leaves for Riften/.test(last(P)), 'aboard: the screen goes black, nothing paid yet', [gold.get(P), fades(P), said(P)]);
fire('carriageChoose', P, ['riften']);
cmds.carriage(P, 'riften');
ok(/already aboard/.test(last(P)), 'no second boarding while aboard', said(P));
fire('arrived', P, [0x3c]);
ok(fades(P).join() === 'true', 'an arrival before the trip leaves the black screen up');
runTimers('ride');
ok(gold.get(P) === 80 && deposits.length === 1 && deposits[0].join() === 'whiterun,20,carriage', 'at departure: 20 gold taken, into Whiterun\'s treasury as carriage income', [gold.get(P), deposits]);
ok(moves.length === 1 && moves[0][1].cellOrWorldDesc === '3c:Skyrim.esm' && moves[0][1].pos.join() === GATE_SPOT.Riften.join() && pickedFor.some((x) => x[0] === 'Riften' && x[1] === P), 'set down at Riften\'s gate spot, picked for the rider', [moves, pickedFor]);
ok(/sets you down at Riften/.test(last(P)) && audits.length === 1 && audits[0] === `CARRIAGE P${P.toString(16)} rode from Whiterun to Riften for 20 gold (20 to the whiterun treasury)`, 'told, and audited', [said(P), audits]);
ok(plog.length === 1 && plog[0].join() === ['travel', P, 'carriage'].join(), 'the player log hears a carriage trip', plog);
fire('arrived', P, [0x3c]);
ok(fades(P).join() === 'true,false', 'the black screen lifts on arrival', fades(P));
runTimers();
ok(fades(P).join() === 'true,false', 'the safety timer has nothing left to lift', fades(P));

// ---- typed destinations, list, fares shown --------------------------------------------------------------------------------
reset(); load({});
cmds.carriage(P, 'list');
ok(/^From Whiterun: Solitude 20 gold, .*Winterhold 50 gold\.$/.test(last(P)), '/carriage list names every fare', said(P));
cmds.carriage(P, 'whiterun');
ok(/does not go there/.test(last(P)) && !timers.length, 'not to the town you are in', said(P));
cmds.carriage(P, 'nowhere');
ok(/does not know "nowhere"/.test(last(P)), 'an unknown town is named back', said(P));
cmds.carriage(P, 'daw');
ok(/leaves for Dawnstar/.test(last(P)), 'a town by the start of its name', said(P));
runTimers('ride');
ok(gold.get(P) === 50 && moves[0][1].pos.join() === GATE_SPOT.Dawnstar.join(), 'Dawnstar costs 50', [gold.get(P), moves]);
reset(); load({});
cmds.carriage(P, '');
fire('carriageChoose', P, ['nowhere']);
ok(!timers.length && !moves.length, 'a choice the menu did not offer does nothing');
cmds.carriage(P, '');
fire('carriageClose', P);
fire('carriageChoose', P, ['riften']);
ok(!timers.length, 'a closed menu cannot be answered');
cmds.carriage(P, '');
ui = {}; load({ fares: { major: 30 } });
fire('carriageChoose', P, ['riften']);
ok(!timers.length && gold.get(P) === 100, 'a menu from before a reload (an old fare) pays nothing');
cmds.carriage(P, '');
ok(widgets[widgets.length - 1][1].actions.find((x) => x.id === 'riften').label === 'Riften: 30 gold', 'carriages.fares changes the fare', widgets[widgets.length - 1][1].actions);

// ---- refusals ------------------------------------------------------------------------------------------------------------------
const refusedWith = (setup, rx, what, cfgC) => {
  reset(); load(cfgC || {}); setup(); const before = gold.get(P); cmds.carriage(P, 'riften');
  ok(rx.test(last(P)) && !timers.length && gold.get(P) === before, what, said(P));
};
refusedWith(() => gold.set(P, 15), /fare to Riften is 20 gold, and you do not have it/, 'too little gold');
refusedWith(() => creating.add(P), /not finished/, 'a character still being made');
creating = new Set();
refusedWith(() => props.set(`${P}|isDead`, true), /down/, 'the dead');
refusedWith(() => { globalThis.__dboIsDowned = () => true; }, /down/, 'the downed');
refusedWith(() => props.set(`${P}|private.restrained`, { boundHands: true }), /bound or carried/, 'the bound');
refusedWith(() => { globalThis.__dboJailUnstuck = () => 'x'; }, /prisoner/, 'a prisoner');
refusedWith(() => combatAt.set(P, Date.now() - 20000), /fight on\. Try again in 40 seconds/, 'in combat (60 s)');
combatAt.clear();
refusedWith(() => pvpAt.set(P, Date.now() - 90000), /fight with another traveller\. Try again in 30 seconds/, 'after a PvP fight (120 s)');
pvpAt.clear();
refusedWith(() => { globalThis.__dboCourierSealed = (a, b) => (b === 0x1ac960 ? 1 : 0); }, /courier's parcel/, 'a sealed courier\'s parcel');
reset(); load({ allowParcels: true }); globalThis.__dboCourierSealed = () => 1; cmds.carriage(P, 'riften');
ok(/leaves for Riften/.test(last(P)), 'allowParcels true lets a courier ride', said(P));
refusedWith(() => props.set(`${P}|worldOrCellDesc`, '17482:DragonBreak Hub.esp'), /Talk to the driver there/, 'in another world');
refusedWith(() => props.set(`${P}|private.carriageAt`, Date.now() - 60000), /next carriage leaves in 9 minutes/, 'the cooldown, when set', { cooldownMinutes: 10 });
reset(); load({}); props.set(`${P}|private.carriageAt`, Date.now() - 1000); cmds.carriage(P, 'riften');
ok(/leaves for Riften/.test(last(P)), 'no cooldown by default (vanilla)', said(P));

// ---- what can go wrong between boarding and departure ---------------------------------------------------------------------
const leftWith = (change, rx, what) => {
  reset(); load({}); cmds.carriage(P, 'riften'); change(); const before = gold.get(P); runTimers('ride');
  ok(rx.test(last(P)) && gold.get(P) === before && !moves.length && !deposits.length && fades(P).join() === 'true,false', what, [said(P), gold.get(P), fades(P)]);
};
leftWith(() => props.set(`${P}|pos`, [0, 0, 0]), /stepped off before the carriage left\. You paid nothing/, 'walked away: nothing paid, the screen back');
leftWith(() => combatAt.set(P, Date.now()), /fight on.*You paid nothing/, 'a fight started: nothing paid');
combatAt.clear();
leftWith(() => gold.set(P, 5), /cannot pay the fare to Riften, 20 gold/, 'spent the gold meanwhile');
reset(); load({}); cmds.carriage(P, 'riften'); online = [Q]; runTimers('ride');
ok(gold.get(P) === 100 && !moves.length, 'logged out before it left: nothing paid, nobody moved');

// ---- the driver, talked to --------------------------------------------------------------------------------------------------
reset(); load({});
props.set(`${P}|pos`, [-73225.0 + 100, 99456.7, -10906.7]);
ok(globalThis.__dboCarriageActivate(DRV, P) === true && widgets.length === 1 && /Carriage from Solitude/.test(widgets[0][1].targetName), 'talking to a driver opens that stable\'s menu (and refuses the engine\'s own talk)', widgets);
ok(globalThis.__dboCarriageActivate(OTHER, P) === false && globalThis.__dboCarriageActivate(0xff000999, P) === false, 'any other NPC is not a driver');
props.set(`${DRV}|isDead`, true);
ok(globalThis.__dboCarriageActivate(DRV, P) === false, 'a dead driver is left to the loot chain');
props.delete(`${DRV}|isDead`);
props.set(`${DRV}|pos`, [-73225.0 + 2000, 99456.7, -10906.7]); props.set(`${P}|pos`, [-73225.0 + 2100, 99456.7, -10906.7]);
widgets = [];
ok(globalThis.__dboCarriageActivate(DRV, P) === true && widgets.length === 1, 'a driver who wandered from the stable still takes fares');
fire('carriageChoose', P, ['windhelm']); runTimers('ride');
ok(gold.get(P) === 80 && deposits[0].join() === 'solitude,20,carriage' && moves[0][1].pos.join() === GATE_SPOT.Windhelm.join(), 'and the trip leaves from where the driver stands', [deposits, moves]);
reset(); load({ enabled: false });
ok(globalThis.__dboCarriageActivate(DRV, P) === false, 'enabled false: a driver is an ordinary NPC');

// ---- the config ------------------------------------------------------------------------------------------------------------------
reset(); load({ stops: { dawnstar: { off: true }, falkreath: { arrival: [[1, 2, 3]], rotZ: 90 }, riverwood: { name: 'Riverwood', arrival: [[5, 6, 7]] }, morthal: { major: true } } });
cmds.carriage(P, '');
const ids = widgets[0][1].actions.map((x) => x.id);
ok(!ids.includes('dawnstar') && ids.includes('riverwood') && widgets[0][1].actions.find((x) => x.id === 'morthal').label === 'Morthal: 20 gold', 'a stop can be closed, added, or made a capital', widgets[0][1].actions);
fire('carriageChoose', P, ['falkreath']); runTimers('ride');
ok(moves[0][1].pos.join() === '1,2,3' && moves[0][1].rot[2] === 90, 'a stop\'s own arrival spot wins over the gate\'s', moves);

console.log(`carriages: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
