// A faction's roll and standing orders (rosters.js, Nat 31 Oct, in-game-over-discord F): when and where each member was
// last seen, coarse and in-world, never online-now or a position, nothing while disguised; orders by leaders and officers,
// read at login and in /status.
//   node tests/rosters-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rosters-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS clears it */ } });
let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) pass++; else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };

const LEAD = 0xff000001, SGT = 0xff000002, MASK = 0xff000003, ROAD = 0xff000004, AWAY = 0xff000005, OUT = 0xff000006;
const NAMES = { [LEAD]: 'Aldric', [SGT]: 'Brynja', [MASK]: 'Cyrus', [ROAD]: 'Dagny', [AWAY]: 'Erandur', [OUT]: 'Faendal' };
const RANK = { [LEAD]: ['Captain', 'leader'], [SGT]: ['Sergeant', 'officer'], [MASK]: ['Legionnaire', 'member'], [ROAD]: ['Legionnaire', 'member'], [AWAY]: ['Legionnaire', 'member'] };
globalThis.__dboGuildsOf = (a) => (RANK[a] ? [{ id: 'imperial-legion', name: 'Imperial Legion', shown: RANK[a][0], title: RANK[a][0], role: RANK[a][1] }] : []);
globalThis.__dboGuildMembers = () => [LEAD, SGT, MASK, ROAD, AWAY];
globalThis.__dboMaskOf = (a) => ({ real: NAMES[a] });
globalThis.__dboDisguised = (a) => a === MASK;
const statusParts = new Map();
globalThis.__dboRegisterStatus = (k, o, fn) => statusParts.set(k, fn);
const HOLD = { [LEAD]: 'bruma', [SGT]: 'bruma', [MASK]: 'bruma', [ROAD]: null, [AWAY]: 'bruma', [OUT]: 'bruma' };
let online = [LEAD, SGT, MASK, ROAD, AWAY, OUT];
let now = Date.UTC(2026, 10, 1, 18, 0);
const realNow = Date.now; Date.now = () => now;
const told = [], audits = [], timers = {}, cmds = {};
require(path.resolve(ROOT, 'rosters.js'))({
  log: () => {}, personal: (a, t) => told.push([a, t]), registerChatCommand: (n, f) => { cmds[n] = f; }, onlineActors: () => online,
  nameOf: (a) => (a === MASK ? 'Masked Person' : NAMES[a]), zoneOfActor: (a) => HOLD[a], zoneById: (z) => ({ name: z === 'bruma' ? 'Bruma' : z }),
  every: (k, ms, f) => { timers[k] = f; }, audit: (t) => audits.push(t), cfg: { rosters: {} },
});
const saidTo = (a) => told.filter((x) => x[0] === a).map((x) => x[1]).join(' | ');

// Seen once now; Erandur then goes away for three days
timers.rosters();
online = [LEAD, SGT, MASK, ROAD, OUT];
now += 3 * 86400000;
timers.rosters();
now += 10 * 60000;
told.length = 0;
cmds.roster(SGT, '');
const roll = saidTo(SGT);
ok(/^The roll of Imperial Legion \(5\): Captain Aldric, seen in Bruma within the hour; Sergeant Brynja, seen in Bruma within the hour;/.test(roll), 'the roll lists the faction by rank, with the hold each was seen in', roll);
ok(/Legionnaire Dagny, seen on the road within the hour/.test(roll), 'outside any hold: on the road', roll);
ok(/Legionnaire Cyrus, seen within the hour/.test(roll) && !/Cyrus, seen in/.test(roll), 'a member in disguise is seen, but not where: a mask holds', roll);
ok(/Legionnaire Erandur, last seen 3 days ago/.test(roll), 'one away: when last seen, never online or not', roll);
ok(!/online/i.test(roll) && !/\d+\s*,\s*\d+/.test(roll), 'never "online", never a position', roll);
now += 5 * 3600000;
told.length = 0;
cmds.roster(SGT, '');
ok(/Captain Aldric, seen in Bruma today/.test(saidTo(SGT)), 'a few hours on: seen today', saidTo(SGT));
told.length = 0;
cmds.roster(OUT, '');
ok(/serve no faction/.test(saidTo(OUT)), 'someone outside the faction keeps no roll of it');

// Standing orders
told.length = 0;
cmds.orders(ROAD, 'Hold the gate');
ok(/Only a faction's leaders and officers/.test(saidTo(ROAD)), 'a plain member cannot set orders');
told.length = 0;
cmds.orders(SGT, 'Watch the north road; report bandits at the fort.');
ok(/standing orders of Imperial Legion are set/.test(saidTo(SGT)), 'an officer sets the standing orders');
ok(told.some(([a, t]) => a === LEAD && /New standing orders for Imperial Legion: Watch the north road; report bandits at the fort\. \(Sergeant Brynja\)/.test(t)) && !told.some(([a]) => a === OUT), '...members in the land hear them at once, no one else', told);
ok(audits.some((t) => /^ORDERS Brynja set the standing orders of Imperial Legion$/.test(t)), '...audited without the text', audits);
told.length = 0;
globalThis.__dboRosterLogin(AWAY);
ok(/Standing orders of Imperial Legion: Watch the north road; report bandits at the fort\. \(Sergeant Brynja\)/.test(saidTo(AWAY)), 'a member coming into the land reads them at login', saidTo(AWAY));
ok(/^Orders Imperial Legion: Watch the north road/.test(statusParts.get('orders')(ROAD) || '') && statusParts.get('orders')(OUT) === null, '...and in /status and the journal, members only', statusParts.get('orders')(ROAD));
told.length = 0;
cmds.orders(ROAD, '');
ok(/Standing orders\. Imperial Legion: Watch the north road/.test(saidTo(ROAD)), '/orders alone reads them');
told.length = 0;
cmds.orders(LEAD, 'clear');
ok(/are taken down/.test(saidTo(LEAD)) && statusParts.get('orders')(ROAD) === null, 'a leader takes them down');
const disk = JSON.parse(fs.readFileSync(path.join(dir, 'rosters.json'), 'utf8'));
ok(disk.seen && disk.seen[String(AWAY)] && disk.orders && !disk.orders['imperial-legion'], 'rosters.json keeps the sightings and orders over a restart');

// Wiring
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
ok(/require\(ROSTERS_JS\)\(\{ log, personal, registerChatCommand, onlineActors, nameOf, zoneOfActor, zoneById, every, audit, cfg \}\)/.test(gm) && /globalThis\.__dboRosterLogin\(a\)/.test(gm), 'gamemode.js loads rosters.js and runs its login line');
ok(/orders: \['Orders'\]/.test(fs.readFileSync(path.join(ROOT, 'journal.js'), 'utf8')), 'journal.js names the Orders status row');
ok(/rosters\.json/.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')), 'rosters.json is gitignored');

Date.now = realNow;
console.log(`${pass}/${pass + fail}`);
process.exitCode = fail ? 1 : 0;
