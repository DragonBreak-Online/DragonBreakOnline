// Hold carriages (carriages.js, Jake 5-6 Nov): activate a stable's carriage or driver, choose a town, pay by distance on departure.
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

const P = 0xff000101, Q = 0xff000102, DRV = 0xff000900, OTHER = 0xff000901, DRV_W = 0xff000910;
const CART_W = 0x1070f0, CART_M = 0x1070ed;
const WHITERUN_STABLE = [17589.8, -12411.6, -4745.1], SOLITUDE_STABLE = [-73225.0, 99456.7, -10906.7];
const GATE_SPOT = { Whiterun: [18313, -10665, -4588.5], Riften: [173137, -90912, 11073.9], Solitude: [-74313.4, 96373.3, -11483.6], Windhelm: [135039, 33143, -12547.6], Markarth: [-171223, 6919.6, -3908.4],
  Falkreath: [-30323.8, -86273.2, -3094.4], Morthal: [-38293.3, 67050.7, -13860.8], Dawnstar: [30549.8, 106123.5, -14178.9], Winterhold: [109208, 102864, -8953.7] };
// From the Whiterun stable: 5 + 1.25 gold per 10,000 units to the arrival, to the nearest 5 (worked out by hand)
const FROM_WHITERUN = { falkreath: 15, morthal: 15, dawnstar: 20, windhelm: 20, riften: 25, solitude: 25, winterhold: 25, markarth: 30 };

let timers = [];
globalThis.setTimeout = (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; };
globalThis.clearTimeout = (t) => { if (t) t.live = false; };
const runTimers = (kind) => { const due = timers.filter((t) => t.live && (kind === 'ride' ? t.ms < 10000 : true)); timers = timers.filter((t) => !due.includes(t)); for (const t of due) { t.live = false; t.fn(); } };

let props, told, packets, widgets, closed, audits, deposits, moves, plog, gold, ui, cmds, online, pickedFor, moveThrows, given;
const reset = () => {
  props = new Map(); told = []; packets = []; widgets = []; closed = []; audits = []; deposits = []; moves = []; plog = []; ui = {}; cmds = {}; online = [P, Q]; pickedFor = [];
  gold = new Map([[P, 100], [Q, 10]]); moveThrows = false; given = [];
  timers = [];
  for (const a of [P, Q]) { props.set(`${a}|worldOrCellDesc`, '3c:Skyrim.esm'); props.set(`${a}|pos`, WHITERUN_STABLE.slice()); }
  props.set(`${DRV}|private.npcSpawner`, 'carriage:solitude'); props.set(`${DRV}|worldOrCellDesc`, '3c:Skyrim.esm'); props.set(`${DRV}|pos`, SOLITUDE_STABLE.slice());
  props.set(`${DRV_W}|private.npcSpawner`, 'carriage:whiterun'); props.set(`${DRV_W}|worldOrCellDesc`, '3c:Skyrim.esm'); props.set(`${DRV_W}|pos`, WHITERUN_STABLE.slice());
  props.set(`${OTHER}|private.npcSpawner`, 'guard:solitude:1');
  props.set(`${CART_W}|pos`, [17781.9, -12144.3, -4740.5]); props.set(`${CART_M}|pos`, [-169753.7, 4926.8, -4100.7]);
  globalThis.__dboCarriageRiding = new Map(); globalThis.__dboCarriageDrivers = new Map(); globalThis.__dboCarriagesSig = undefined;
  globalThis.__dboCarriagePending = new Map(); globalThis.__dboCarriageFading = new Map();
  globalThis.__dboIsDowned = () => false; globalThis.__dboJailUnstuck = () => null;
  globalThis.__dboCourierParcelBase = () => 0x1ac960; globalThis.__dboCourierSealed = () => 0;
  globalThis.__dboPlogHook = (k, a, reason) => plog.push([k, a, reason]);
};
const combatAt = new Map(), pvpAt = new Map();
let creating = new Set();
const idFromDesc = (d) => { const [h, plug] = String(d).split(':'); return String(plug).toLowerCase() === 'skyrim.esm' ? parseInt(h, 16) : 0x01000000 + parseInt(h, 16); };
const load = (carriages) => {
  for (const k of Object.keys(require.cache)) if (k.endsWith('carriages.js')) delete require.cache[k];
  require(path.join(ROOT, 'carriages.js'))({
    mp: { get: (a, k) => props.get(`${a >>> 0}|${k}`), getIdFromDesc: idFromDesc,
      set: (a, k, v) => { if (k === 'locationalData' && moveThrows) throw new Error('no cell'); props.set(`${a >>> 0}|${k}`, v); if (k === 'locationalData') moves.push([a >>> 0, v]); } },
    log: () => {}, personal: (a, t) => told.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `P${(a >>> 0).toString(16)}`, cfg: { carriages },
    registerChatCommand: (n, f) => { cmds[n] = f; }, openWidget: (a, w) => widgets.push([a >>> 0, w]), closeWidget: (a, wid) => closed.push([a >>> 0, wid]),
    onUi: (ev, fn) => { (ui[ev] = ui[ev] || []).push(fn); }, sendPacket: (a, p) => packets.push([a >>> 0, p]),
    takeGold: (a, n) => { const g = gold.get(a >>> 0) || 0; if (!(g > 0) || g < n) return false; gold.set(a >>> 0, g - n); return true; }, goldOf: (a) => gold.get(a >>> 0) || 0,
    giveGold: (a, n) => { given.push([a >>> 0, n]); gold.set(a >>> 0, (gold.get(a >>> 0) || 0) + n); return true; },
    depositToTreasury: (z, n, o) => { deposits.push([z, n, o && o.income]); return n; }, creationPending: (a) => creating.has(a >>> 0),
    arrivalFor: (name, a) => { if (a) pickedFor.push([name, a]); return GATE_SPOT[name] ? { pos: GATE_SPOT[name], rotZ: 0 } : null; }, onlineActors: () => online, combatAt, pvpAt,
  });
};
const said = (a) => told.filter((x) => x[0] === a).map((x) => x[1]);
const last = (a) => { const s = said(a); return s[s.length - 1] || ''; };
const fire = (ev, a, args) => (ui[ev] || []).forEach((fn) => fn(a, args || []));
const fades = (a) => packets.filter((x) => x[0] === a && x[1].customPacketType === 'dboFade').map((x) => x[1].on);
const spawns = () => { try { return JSON.parse(fs.readFileSync('NPC-Spawns.json', 'utf8')).zones || []; } catch (e) { return []; } };
const activate = (a, ref) => globalThis.__dboCarriageActivate(ref === undefined ? DRV_W : ref, a);
const ride = (a, dest, ref) => { activate(a, ref); fire('carriageChoose', a, [dest]); };
const lastMenu = () => { const w = widgets.filter((x) => x[1].id === 176); return w.length ? w[w.length - 1][1] : null; };

// ---- the drivers, written into NPC-Spawns.json beside other writers' zones ----
reset();
fs.writeFileSync('NPC-Spawns.json', JSON.stringify({ _comment: 'x', zones: [{ Name: 'guard:solitude:1', ID: '3c:Skyrim.esm', POS: [1, 2, 3] }, { Name: 'wild:wolf:0' }] }));
load({});
let z = spawns();
const drv = z.filter((x) => String(x.Name).startsWith('carriage:'));
ok(drv.length === 5 && ['whiterun', 'solitude', 'markarth', 'riften', 'windhelm'].every((s) => drv.some((x) => x.Name === `carriage:${s}`)), 'a driver zone at each of the five stables', drv.map((x) => x.Name));
const wd = drv.find((x) => x.Name === 'carriage:whiterun');
ok(wd && wd.ID === '3c:Skyrim.esm' && wd.POS.join() === WHITERUN_STABLE.join() && wd.NPC[0].id === '13669:Skyrim.esm' && wd.Heading === 275 && wd.Hostile === false, 'Whiterun\'s is the base game driver at the base game spot', wd);
ok(z.some((x) => x.Name === 'guard:solitude:1') && z.some((x) => x.Name === 'wild:wolf:0') && JSON.parse(fs.readFileSync('NPC-Spawns.json', 'utf8'))._comment === 'x', 'other writers\' zones and the file\'s own keys are kept');
ok(!cmds.carriage, 'no /carriage command: the carriage itself is the way (Jake, 6 Nov)');
load({});
ok(spawns().filter((x) => String(x.Name).startsWith('carriage:')).length === 5, 'a reload writes no second set');
load({ drivers: { enabled: false } });
ok(spawns().filter((x) => String(x.Name).startsWith('carriage:')).length === 0 && spawns().length === 2, 'drivers.enabled false takes the drivers away, nothing else');
ok(activate(P, CART_W) === true && lastMenu(), 'with no drivers the carriage itself still takes fares');
load({ enabled: false });
ok(spawns().filter((x) => String(x.Name).startsWith('carriage:')).length === 0, 'enabled false: no drivers');
widgets = [];
ok(activate(P, CART_W) === false && activate(P) === false && !widgets.length, 'enabled false: a carriage and a driver are ordinary things again');

// ---- the carriage, activated ----
reset(); load({});
props.set(`${P}|pos`, [17781.9 + 50, -12144.3, -4740.5]);
ok(activate(P, CART_W) === true, 'activating the Whiterun carriage is taken (the engine\'s own sit is refused)');
const menu = lastMenu();
ok(menu && menu.type === 'contextMenu' && /Carriage from Whiterun: where to/.test(menu.targetName) && menu.events.action === 'dbo:carriageChoose', 'the carriage opens the destinations menu', menu);
ok(menu && menu.actions.length === 8 && !menu.actions.some((x) => x.id === 'whiterun'), 'every other town, never the one you stand in', menu && menu.actions.map((x) => x.id));
ok(menu && menu.actions.every((x) => x.label === `${x.id[0].toUpperCase()}${x.id.slice(1)}: ${FROM_WHITERUN[x.id]} gold`), 'further costs more: the fares by distance', menu && menu.actions.map((x) => x.label));
ok(menu && menu.actions.map((x) => x.id).join() === 'falkreath,morthal,dawnstar,windhelm,riften,solitude,winterhold,markarth', 'nearest first', menu && menu.actions.map((x) => x.id));
ok(pickedFor.length === 0, 'listing destinations holds no arrival spot');
fire('carriageChoose', P, ['riften']);
ok(closed.some((x) => x[0] === P && x[1] === 176), 'the menu closes on a choice');
ok(gold.get(P) === 100 && fades(P).join() === 'true' && /leaves for Riften; the fare, 25 gold/.test(last(P)), 'aboard: the screen goes black, nothing paid yet', [gold.get(P), fades(P), said(P)]);
ride(P, 'riften', CART_W);
ok(/already aboard/.test(last(P)), 'no second boarding while aboard', said(P));
fire('arrived', P, [0x3c]);
ok(fades(P).join() === 'true', 'an arrival before the trip leaves the black screen up');
runTimers('ride');
ok(gold.get(P) === 75 && deposits.length === 1 && deposits[0].join() === 'whiterun,25,carriage', 'at departure: 25 gold taken, into Whiterun\'s treasury as carriage income', [gold.get(P), deposits]);
ok(moves.length === 1 && moves[0][1].cellOrWorldDesc === '3c:Skyrim.esm' && moves[0][1].pos.join() === GATE_SPOT.Riften.join() && pickedFor.some((x) => x[0] === 'Riften' && x[1] === P), 'set down at Riften\'s gate spot, picked for the rider', [moves, pickedFor]);
ok(/sets you down at Riften/.test(last(P)) && audits.length === 1 && audits[0] === `CARRIAGE P${P.toString(16)} rode from Whiterun to Riften for 25 gold (25 to the whiterun treasury)`, 'told, and audited', [said(P), audits]);
ok(plog.length === 1 && plog[0].join() === ['travel', P, 'carriage'].join(), 'the player log hears a carriage trip', plog);
fire('arrived', P, [0x3c]);
ok(fades(P).join() === 'true,false', 'the black screen lifts on arrival', fades(P));
runTimers();
ok(fades(P).join() === 'true,false', 'the safety timer has nothing left to lift', fades(P));
reset(); load({});
props.set(`${P}|pos`, [-169753.7, 4926.8 + 60, -4100.7]);
ok(activate(P, CART_M) === true && /Carriage from Markarth/.test((lastMenu() || {}).targetName), 'beside Markarth\'s carriage, 770 units from where its driver stands, the carriage still serves', said(P));
props.set(`${P}|pos`, [0, 0, 0]);
widgets = [];
ok(activate(P, CART_W) === true && /Come closer to the carriage/.test(last(P)) && !widgets.length, 'a carriage activated from afar is refused with a line');
ok(activate(P, 0x1070aa) === false, 'any other object is not a carriage');

// ---- choices and fares ----
reset(); load({});
ride(P, 'dawnstar');
runTimers('ride');
ok(gold.get(P) === 80 && moves[0][1].pos.join() === GATE_SPOT.Dawnstar.join(), 'from the Whiterun driver, Dawnstar costs 20', [gold.get(P), moves]);
reset(); load({});
activate(P); fire('carriageChoose', P, ['nowhere']);
ok(!timers.length && !moves.length, 'a choice the menu did not offer does nothing');
activate(P); fire('carriageChoose', P, ['whiterun']);
ok(!timers.length, 'not to the town you are in');
activate(P); fire('carriageClose', P); fire('carriageChoose', P, ['riften']);
ok(!timers.length, 'a closed menu cannot be answered');
activate(P);
ui = {}; load({ fares: { per10k: 2.5 } });
fire('carriageChoose', P, ['riften']);
ok(/fare has changed/.test(last(P)) && !timers.length && gold.get(P) === 100, 'a menu kept across a reload whose fare changed is refused, nothing paid', said(P));
activate(P);
ok(lastMenu().actions.find((x) => x.id === 'riften').label === 'Riften: 50 gold', 'carriages.fares.per10k changes the rate', lastMenu().actions);
reset(); load({ fares: { min: 30 } }); activate(P);
ok(lastMenu().actions.every((x) => /: 30 gold$/.test(x.label)), 'fares.min raises the short trips', lastMenu().actions.map((x) => x.label));
reset(); load({ fares: { max: 20 } }); activate(P);
ok(lastMenu().actions.find((x) => x.id === 'markarth').label === 'Markarth: 20 gold' && lastMenu().actions.find((x) => x.id === 'falkreath').label === 'Falkreath: 15 gold', 'fares.max caps the long ones', lastMenu().actions.map((x) => x.label));

// ---- refusals ----
const refusedWith = (setup, rx, what, cfgC) => {
  reset(); load(cfgC || {}); setup(); const before = gold.get(P); ride(P, 'riften');
  ok(rx.test(last(P)) && !timers.length && gold.get(P) === before, what, said(P));
};
refusedWith(() => gold.set(P, 15), /fare to Riften is 25 gold, and you do not have it/, 'too little gold');
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
reset(); load({ allowParcels: true }); globalThis.__dboCourierSealed = () => 1; ride(P, 'riften');
ok(/leaves for Riften/.test(last(P)), 'allowParcels true lets a courier ride', said(P));
refusedWith(() => props.set(`${P}|worldOrCellDesc`, '17482:DragonBreak Hub.esp'), /Come closer to the carriage/, 'in another world');
refusedWith(() => props.set(`${P}|private.carriageAt`, Date.now() - 60000), /next carriage leaves in 9 minutes/, 'the cooldown, when set', { cooldownMinutes: 10 });
reset(); load({}); props.set(`${P}|private.carriageAt`, Date.now() - 1000); ride(P, 'riften');
ok(/leaves for Riften/.test(last(P)), 'no cooldown by default (vanilla)', said(P));

// ---- what can go wrong between boarding and departure ----
const leftWith = (change, rx, what) => {
  reset(); load({}); ride(P, 'riften'); change(); const before = gold.get(P); runTimers('ride');
  ok(rx.test(last(P)) && gold.get(P) === before && !moves.length && !deposits.length && fades(P).join() === 'true,false', what, [said(P), gold.get(P), fades(P)]);
};
leftWith(() => props.set(`${P}|pos`, [0, 0, 0]), /stepped off before the carriage left\. You paid nothing/, 'walked away: nothing paid, the screen back');
leftWith(() => combatAt.set(P, Date.now()), /fight on.*You paid nothing/, 'a fight started: nothing paid');
combatAt.clear();
leftWith(() => gold.set(P, 5), /cannot pay the fare to Riften, 25 gold/, 'spent the gold meanwhile');
reset(); load({}); ride(P, 'riften'); online = [Q]; runTimers('ride');
ok(gold.get(P) === 100 && !moves.length, 'logged out before it left: nothing paid, nobody moved');

// ---- the driver, talked to ----
reset(); load({});
props.set(`${P}|pos`, [-73225.0 + 100, 99456.7, -10906.7]);
ok(activate(P, DRV) === true && widgets.length === 1 && /Carriage from Solitude/.test(widgets[0][1].targetName), 'talking to a driver opens that stable\'s menu (and refuses the engine\'s own talk)', widgets);
ok(activate(P, OTHER) === false && activate(P, 0xff000999) === false, 'any other NPC is not a driver');
props.set(`${DRV}|isDead`, true);
ok(activate(P, DRV) === true && /nothing to take/.test(last(P)) && widgets.length === 1, 'a dead driver cannot be searched and opens no menu', said(P));
props.delete(`${DRV}|isDead`);
props.set(`${DRV}|pos`, [-73225.0 + 2000, 99456.7, -10906.7]); props.set(`${P}|pos`, [-73225.0 + 2100, 99456.7, -10906.7]);
widgets = [];
ok(activate(P, DRV) === true && widgets.length === 1, 'a driver who wandered within the leash still takes fares');
fire('carriageChoose', P, ['windhelm']); runTimers('ride');
ok(gold.get(P) === 70 && deposits[0].join() === 'solitude,30,carriage' && moves[0][1].pos.join() === GATE_SPOT.Windhelm.join(), 'the fare is from the stable (Solitude to Windhelm, 30)', [gold.get(P), deposits, moves]);
reset(); load({});
props.set(`${DRV}|pos`, [-73225.0 + 2600, 99456.7, -10906.7]); props.set(`${P}|pos`, [-73225.0 + 2650, 99456.7, -10906.7]);
ok(activate(P, DRV) === true && /Come closer/.test(last(P)) && !widgets.length, 'a driver past the leash takes no fares');

// ---- the config ----
reset(); load({ stops: { dawnstar: { off: true }, falkreath: { arrival: [[1, 2, 3]], rotZ: 90 }, riverwood: { name: 'Riverwood', arrival: [[5, 6, 7]] } } });
activate(P);
const ids = lastMenu().actions.map((x) => x.id);
ok(!ids.includes('dawnstar') && ids.includes('riverwood') && lastMenu().actions.find((x) => x.id === 'riverwood').label === 'Riverwood: 10 gold', 'a stop can be closed or added (Riverwood, near, at the minimum)', lastMenu().actions);
fire('carriageChoose', P, ['falkreath']); runTimers('ride');
ok(moves[0][1].pos.join() === '1,2,3' && moves[0][1].rot[2] === 90, 'a stop\'s own arrival spot wins over the gate\'s', moves);

// ---- the review's cases (5 Nov) ----
reset(); load({}); moveThrows = true; ride(P, 'riften'); runTimers('ride');
ok(gold.get(P) === 100 && given.length === 1 && !deposits.length && !audits.length && /fare is returned/.test(last(P)) && fades(P).join() === 'true,false', 'a failed move gives the fare back, pays no treasury', [said(P), gold.get(P), deposits]);
reset(); load({ fares: { base: 0, per10k: 0, min: 0 } }); gold.set(P, 0); ride(P, 'riften'); runTimers('ride');
ok(moves.length === 1 && !deposits.length && /sets you down/.test(last(P)), 'a free fare with an empty purse still rides', said(P));
reset(); load({}); props.set(`${Q}|private.restrained`, { boundHands: true, captorActorId: P }); ride(P, 'riften');
ok(/will not take a captive/.test(last(P)) && !timers.length, 'a captor holding someone is refused', said(P));
reset(); load({}); props.set(`${Q}|private.restrained`, { boundHands: true, captorActorId: 0xff000777 }); ride(P, 'riften');
ok(/leaves for Riften/.test(last(P)), 'a captive held by another player nearby does not stop a ride', said(P));
reset(); load({}); ride(P, 'riften'); runTimers('ride'); props.set(`${P}|pos`, WHITERUN_STABLE.slice());
const safety1 = timers.find((x) => x.live && x.ms === 10000);
ride(P, 'solitude');
ok(safety1 && !safety1.live && timers.filter((x) => x.live && x.ms === 10000).length === 1, 'back-to-back rides: the first fade timer is cleared, one left', timers.map((x) => [x.ms, x.live]));

console.log(`carriages: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
