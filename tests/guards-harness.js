// The hold's watch (guards.js, Jake and Nate 23 Oct) with the real jail.js: /guardpost writes a guard:<hold>:<n> zone, the
// watch gives no Wheel work and no loot, and a player one of its guards brings down wakes in the hold's jail for 30 minutes,
// the city jail's cells first and its prison when they are full (hold-jails.json); a full hold leaves the down alone.
//   node tests/guards-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-guards-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS */ } });
let fails = 0;
const ok = (c, t, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${t}${c || g === undefined ? '' : '   ' + JSON.stringify(g)}`); if (!c) fails++; };
const timers = []; global.setTimeout = (fn) => { timers.push(fn); return 0; };
const flush = () => { while (timers.length) timers.shift()(); };

// Real record ids: Bruma's castle dungeon (the city jail here) and two of its cell doors; Whiterun's prison and one door
const JAIL = '6c410:BSHeartland.esm', PRISON = '4deb9:DragonBreak.esp', D1 = '6c43c:BSHeartland.esm', D2 = '6c438:BSHeartland.esm', D3 = '4dfe4:DragonBreak.esp';
fs.writeFileSync('hold-jails.json', JSON.stringify({ holds: { bruma: [
  { kind: 'jail', cellEdid: 'CYRBrumaCastleDungeon', cell: JAIL, door: D1, spot: [1, 2, 3] },
  { kind: 'jail', cellEdid: 'CYRBrumaCastleDungeon', cell: JAIL, door: D2, spot: [4, 5, 6] },
  { kind: 'prison', cellEdid: 'WhiterunPrison', cell: PRISON, door: D3, spot: [7, 8, 9] }] } }));
fs.writeFileSync('jail-cells.json', JSON.stringify({ cells: [JAIL, PRISON] }));
fs.writeFileSync('doors.json', JSON.stringify({ doors: {} }));
fs.writeFileSync('NPC-Spawns.json', JSON.stringify({ zones: [{ Name: 'wild:wolf:0', ID: '3c:Skyrim.esm', POS: [0, 0, 0], NPC: [] }] }));

const PLUGINS = { 'Skyrim.esm': 0x00, 'BSHeartland.esm': 0x08, 'DragonBreak.esp': 0x40 };
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const props = new Map();
const put = (id, p, v) => props.set((id >>> 0) + '|' + p, v);
const STAFF = 0xff000001, P1 = 0xff000002, P2 = 0xff000003, P3 = 0xff000004, GUARD = 0xff100001, WOLF = 0xff100002;
for (const [a, pid] of [[STAFF, 1], [P1, 2], [P2, 3], [P3, 4]]) { put(a, 'profileId', pid); put(a, 'worldOrCellDesc', '3c:Skyrim.esm'); }
put(GUARD, 'profileId', -1); put(GUARD, 'private.npcSpawner', 'guard:bruma:1'); put(GUARD, 'isDead', false);
put(WOLF, 'profileId', -1); put(WOLF, 'private.npcSpawner', 'wild:wolf:0');
put(STAFF, 'pos', [100.4, 200.6, 300]); put(STAFF, 'angle', [0, 0, 90]);
const said = [], audits = [], cmds = {};
const mp = {
  getIdFromDesc: idOf, getDescFromId: (id) => (id >>> 0).toString(16),
  get: (id, p) => props.get((id >>> 0) + '|' + p), set: (id, p, v) => props.set((id >>> 0) + '|' + p, v),
  lookupEspmRecordById: (id) => ({ [idOf(JAIL)]: { record: { type: 'CELL', editorId: 'CYRBrumaCastleDungeon' } }, [idOf(PRISON)]: { record: { type: 'CELL', editorId: 'WhiterunPrison' } } }[id] || null),
  onDeath: () => true,
};
const api = {
  mp, log: () => {}, personal: (a, t) => said.push([a, t]), system: (a, t) => said.push([a, t]), audit: (t) => audits.push(t),
  display: (a) => `P${(a >>> 0).toString(16)}`, who: (a) => `P${(a >>> 0).toString(16)}`, cfg: {},
  openWidget: () => true, closeWidget: () => true, onUi: () => {}, registerChatCommand: (n, f, o) => { cmds[n] = { f, o }; },
  onlineActors: () => [STAFF, P1, P2, P3], every: () => {}, isAdmin: () => false, distanceMeters: () => 1,
  zoneOfActor: () => ({ id: 'bruma', name: 'Bruma' }), zoneById: () => ({ id: 'bruma', name: 'Bruma' }),
};
globalThis.isLeadStaff = () => false;
require(path.join(SERVER, 'jail.js'))(Object.assign({ isLeadStaff: () => false }, api));
// downed.js's two hooks, as it publishes them
const downed = new Set(); const woke = [];
globalThis.__dboIsDowned = (a) => downed.has(a >>> 0);
globalThis.__dboDownedWakeIn = (t, loc, text) => { if (!downed.has(t)) return false; downed.delete(t); woke.push([t, loc, text]); return true; };
delete globalThis.__dboGuardsDeathWrapped;
require(path.join(SERVER, 'guards.js'))(api);

ok(cmds.guardpost && cmds.guardpost.o.admin === true, '/guardpost is a staff command');
cmds.guardpost.f(STAFF, 'add');
const zones = JSON.parse(fs.readFileSync('NPC-Spawns.json', 'utf8')).zones;
const z = zones.find((x) => x.Name === 'guard:bruma:1');
ok(z && z.NPC[0].id === '6daba:BSHeartland.esm' && z.Hostile === false && JSON.stringify(z.POS) === '[100,201,300]' && z.Heading === 90 && zones.some((x) => x.Name === 'wild:wolf:0'),
  '/guardpost add: a guard:bruma:1 zone with Bruma\'s guard at the staff member\'s spot; the wildlife zones are kept', zones);
ok(globalThis.__dboWatchNoSkill('hit', { targetId: GUARD }) && globalThis.__dboWatchNoSkill('kill', { victimId: GUARD }) && globalThis.__dboWatchNoSkill('hurt', { aggressorId: GUARD }),
  'no Wheel work from hitting, killing or being hit by a guard of the watch');
ok(!globalThis.__dboWatchNoSkill('hit', { targetId: WOLF }) && !globalThis.__dboWatchNoSkill('kill', { victimId: WOLF }), '...a wolf still counts');
ok(globalThis.__dboWatchActivate(GUARD, P1) === false, 'a living guard is activated as usual');
put(GUARD, 'isDead', true);
ok(globalThis.__dboWatchActivate(GUARD, P1) === true && /nothing to take/.test(said.at(-1)[1]), 'a dead guard of the watch cannot be searched');
ok(globalThis.__dboWatchActivate(WOLF, P1) === false, '...a dead wolf can');

// Brought down by the watch: the city jail's two cells, then the prison, then nothing
const down = (a, killer) => { downed.add(a); mp.onDeath(a, killer); flush(); };
down(P1, GUARD);
let w = woke.find((x) => x[0] === P1);
let s = mp.get(P1, 'private.dboSentence');
ok(w && w[1].cellOrWorldDesc === JAIL && JSON.stringify(w[1].pos) === '[1,2,3]' && s && s.totalMs === 30 * 60000 && s.watch === 'bruma' && /30 minutes/.test(w[2]),
  'a player a guard brought down wakes in the first free jail cell for 30 minutes', { w, s });
down(P2, GUARD);
w = woke.find((x) => x[0] === P2);
ok(w && JSON.stringify(w[1].pos) === '[4,5,6]', 'the next goes to the second cell');
down(P3, GUARD);
w = woke.find((x) => x[0] === P3);
ok(w && w[1].cellOrWorldDesc === PRISON && /Whiterun Prison/.test(w[2]), 'with the jail full, the prison takes the overflow', w);
const P4 = 0xff000005; put(P4, 'profileId', 5);
down(P4, GUARD);
ok(!woke.some((x) => x[0] === P4) && downed.has(P4), 'with every cell taken, the down stands');
down(STAFF, WOLF);
ok(!woke.some((x) => x[0] === STAFF), 'a wolf\'s down is no jail');
ok(audits.some((t) => /^JAIL .* jailed by the watch of bruma for 30 min/.test(t)) && audits.some((t) => /^GUARDS .* brought down by the watch of bruma/.test(t)), 'audited');
cmds.guardpost.f(STAFF, 'remove bruma 1');
ok(!JSON.parse(fs.readFileSync('NPC-Spawns.json', 'utf8')).zones.some((x) => x.Name.startsWith('guard:')), '/guardpost remove takes its zone out');
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
