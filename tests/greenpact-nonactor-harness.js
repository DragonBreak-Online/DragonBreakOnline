// The Green Pact's activate hook (greenpact.js) never asks isDead of a door, chest or workbench: on the server that throws
// in C++ and logs a "treat it as Actor" warning plus a context dump for every E a player presses (live, 2 Nov: nearly all
// of ~9,000 a day). The stub throws as the server does. A player's body and an NPC with a kill on record are still asked,
// so the feed and the consent still start (tests/greenpact-harness.js has the rest). A mutant restoring the old test must fail.
//   node tests/greenpact-nonactor-harness.js [greenpact.js to test]   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const MODULE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'greenpact.js'));

let fails = 0;
const ok = (l, c, g) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${l}${!c && g !== undefined ? `: got ${JSON.stringify(g)}` : ''}`); if (!c) fails++; };

const WOOD_ELF = 0x502, NORD = 0x503, NPC_RACE = 0x500;
const u32 = (type, v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return { type, data: b }; };
const kw = (...ids) => { const b = new Uint8Array(ids.length * 4); const dv = new DataView(b.buffer); ids.forEach((id, i) => dv.setUint32(i * 4, id, true)); return { type: 'KWDA', data: b }; };
const records = new Map([
  [WOOD_ELF, { record: { type: 'RACE', editorId: 'WoodElfRace', fields: [] } }],
  [NORD, { record: { type: 'RACE', editorId: 'NordRace', fields: [] } }],
  [NPC_RACE, { record: { type: 'RACE', editorId: 'ImperialRace', fields: [kw(0x13794)] } }],
  [0x600, { record: { type: 'NPC_', editorId: 'EncBandit01', fields: [u32('RNAM', NPC_RACE)] } }],
  [0x800, { record: { type: 'DOOR', editorId: 'WRHouseDoor01', fields: [] } }],
]);
for (const r of records.values()) r.toGlobalRecordId = (x) => x;
const ELF = 0xff000010, DEAD_P = 0xff000011, BANDIT = 0xff100001, DOOR = 0x1005;
const ACTORS = new Set([ELF, DEAD_P, BANDIT]);
const props = new Map();
const set = (id, p, v) => props.set(id + '|' + p, v);
set(ELF, 'profileId', 1); set(ELF, 'appearance', { raceId: WOOD_ELF, name: 'Elf' }); set(ELF, 'isDead', false);
set(DEAD_P, 'profileId', 2); set(DEAD_P, 'appearance', { raceId: NORD, name: 'Nord' }); set(DEAD_P, 'isDead', true);
set(BANDIT, 'baseDesc', '1536'); set(BANDIT, 'isDead', true); set(DOOR, 'baseDesc', '2048');
let nonActorIsDead = 0;
const said = [];
globalThis.__dboFaithOf = (a) => (a === ELF ? { faith: 'greenpact', patron: 'yffre', sworn: 'greenpact' } : null);
globalThis.__dboClock = { summary: () => ({ gameDays: 10 }) };
globalThis.__dboPartyLeaderOf = () => null;
globalThis.__dboGreenPact = undefined;
delete require.cache[MODULE];
require(MODULE)({
  // the server: isDead (an actor's property) on anything that is not an actor throws
  mp: { get: (id, p) => { if (p === 'isDead' && !ACTORS.has(id >>> 0)) { nonActorIsDead++; throw new Error(`Form with id ${id} is not Actor`); } return props.get(id + '|' + p); },
    set: (id, p, v) => set(id, p, v), getIdFromDesc: (d) => parseInt(d, 10), getDescFromId: String, callPapyrusFunction: () => {} },
  log: () => {}, personal: (a, t) => said.push([a, t]), audit: () => {}, who: (a) => String(a), cfg: { greenPact: { feedSeconds: 0.02 } }, registerChatCommand: () => {},
  recordOf: (id) => records.get(id >>> 0) || null, nameOf: (a) => (props.get(a + '|appearance') || {}).name || 'Stranger',
  profileOf: (a) => props.get(a + '|profileId') || 0, onlineActors: () => [ELF, DEAD_P], distanceMeters: () => 2, sendPacket: () => {}, sate: () => {}, isGoldFlora: () => false,
});
const act = (t, a) => globalThis.__dboGreenPactActivate(t, a);

ok('E on a door asks nothing of it as an actor', act(DOOR, ELF) === false && nonActorIsDead === 0, nonActorIsDead);
ok('E on a dead player\'s body still asks them for consent', act(DEAD_P, ELF) === true && said.some(([a, t]) => a === DEAD_P && /asks to eat of your body/.test(t)), said);
// a kill on record (the module's own onDeath hook writes it; set here as it would)
globalThis.__dboGreenPact.kills.set(BANDIT, { killer: 1, leader: null, day: 10 });
ok('E on a bandit the elf slew still starts the feed', act(BANDIT, ELF) === true, said.slice(-2));
ok('...and nothing in all that asked a non-actor whether it was dead', nonActorIsDead === 0, nonActorIsDead);

if (!process.env.DBO_MUTANT_RUN) {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'greenpact.js'), 'utf8').replace(/\r\n/g, '\n');
  const from = 'if ((isPlayer(t) || S.kills.has(t)) && isDead(t)) {';
  if (!SRC.includes(from)) ok('mutant: its line is still in greenpact.js', false, from);
  else {
    const f = path.join(require('os').tmpdir(), `claude-nate-greenpact-mutant-${process.pid}.js`);
    fs.writeFileSync(f, SRC.replace(from, 'if (isDead(t)) {'));
    let out = '';
    try { out = execFileSync(process.execPath, [__filename, f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { DBO_MUTANT_RUN: '1' }) }); } catch (x) { out = String(x.stdout || '') + 'FAIL crashed'; }
    try { fs.unlinkSync(f); } catch (e) { /* the OS */ }
    ok('mutant caught: isDead asked of every activation again', /^FAIL/m.test(out));
  }
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
