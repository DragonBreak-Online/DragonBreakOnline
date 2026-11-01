// /f and /p (dispatches.js, Nat 31 Oct, in-game-over-discord A): word by runner to a faction and among a party, delayed
// by distance, signed with rank and own name for a faction, named as each companion knows the speaker for a party.
//   node tests/dispatches-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) pass++; else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };

const A = 0xff000001, B = 0xff000002, C = 0xff000003, D = 0xff000004, E = 0xff000005;
const NAMES = { [A]: 'Aldric', [B]: 'Brynja', [C]: 'Cyrus', [D]: 'Dagny', [E]: 'Erandur' };
const LEGION = { id: 'imperial-legion', name: 'Imperial Legion', title: 'Legionnaire', shown: 'Sergeant', role: 'sergeant' };
const BAND = { id: 'band-otters', name: 'River Otters', title: 'Member', shown: 'Member', role: 'member' };
const memberships = { [A]: [LEGION, BAND], [B]: [LEGION], [C]: [LEGION], [D]: [BAND], [E]: [] };
const holds = { [A]: 'bruma', [B]: 'bruma', [C]: 'whiterun', [D]: 'bruma', [E]: 'bruma' };
const provinces = { [A]: 'cyrodiil', [B]: 'cyrodiil', [C]: 'skyrim', [D]: 'cyrodiil', [E]: 'cyrodiil' };
const party = { [A]: 7, [D]: 7, [B]: null, [C]: null, [E]: null };
const props = new Map();
let online = [A, B, C, D, E];
globalThis.__dboGuildsOf = (a, opts) => (memberships[a] || []).filter((g) => (opts && opts.bands) || !g.id.startsWith('band-'));
globalThis.__dboPartyLeaderOf = (a) => (party[a] === undefined ? null : party[a]);
globalThis.__dboMaskOf = (a) => ({ masked: a === A && masked, real: NAMES[a] });
globalThis.__dboNameFor = (viewer, a) => (a === A && masked ? 'Masked Person' : NAMES[a]);
globalThis.__dboRegions = { provinceAt: (a) => ({ province: provinces[a] }) };
let masked = false;
const lines = [], told = [], timers = [];
const savedTimeout = global.setTimeout; global.setTimeout = (fn, ms) => { timers.push([fn, ms]); return 0; };
const cmds = {};
require(path.resolve(ROOT, 'dispatches.js'))({
  mp: { get: (a, k) => props.get(`${a}|${k}`) }, log: () => {}, personal: (a, t) => told.push([a, t]), deliver: (a, l) => lines.push([a, l]),
  registerChatCommand: (n, f, o) => { cmds[n] = { f, o }; }, onlineActors: () => online, nameOf: (a) => (a === A && masked ? 'Masked Person' : NAMES[a]),
  zoneOfActor: (a) => holds[a], cfg: { dispatches: { delays: { hold: 5, province: 30, far: 90 }, gapSeconds: 4 } },
});
const reset = () => { lines.length = 0; told.length = 0; timers.length = 0; globalThis.__dboDispatchAt.clear(); };
const run = () => { const t = timers.splice(0); for (const [fn] of t) fn(); };
const to = (a) => lines.filter((l) => l[0] === a).map((l) => l[1]);

ok(cmds.f && cmds.p && !cmds.f.o.admin && !cmds.p.o.admin, '/f and /p are registered for everyone');

// A faction dispatch: the sender sees it at once, the others after the runner's time by distance
reset();
cmds.f.f(A, 'Muster at the north gate at dusk.');
ok(to(A).length === 1 && /\[Imperial Legion\] Sergeant Aldric: Muster at the north gate at dusk\.$/.test(to(A)[0]), 'the sender sees the dispatch signed with rank and own name', to(A));
ok(to(B).length === 0 && to(C).length === 0, '...the others do not have it yet: a runner carries it');
const waits = timers.map((t) => t[1]).sort((x, y) => x - y);
ok(JSON.stringify(waits) === JSON.stringify([5000, 90000]), 'the runner takes 5 s within the hold (Brynja, Bruma) and 90 s to another province (Cyrus, Whiterun in Skyrim)', waits);
run();
ok(to(B).length === 1 && to(C).length === 1 && to(B)[0] === to(A)[0], '...and then both of the Legion receive it, word for word');
ok(to(D).length === 0 && to(E).length === 0, 'no one outside the Legion receives it');
ok(told.some(([a, t]) => a === A && /A runner sets out with your word to 2 of Imperial Legion/.test(t)), 'the sender is told how many it goes to');

// Several factions: the default is the first, a prefix picks another, a band has runners too
reset();
cmds.f.f(A, 'otters: Fishing at the lake tomorrow.');
run();
ok(to(D).length === 1 && /\[River Otters\] Member Aldric: Fishing at the lake tomorrow\.$/.test(to(D)[0]) && to(B).length === 0, '/f <faction>: picks another of the speaker\'s factions; a player guild has runners too', lines);

// The gap between runners
reset();
cmds.f.f(A, 'one');
cmds.f.f(A, 'two');
ok(told.some(([, t]) => /only just set out/.test(t)) && to(A).length === 1, 'a second dispatch inside gapSeconds is refused', told);

// Party word: names as each companion knows the speaker, so a mask holds
reset();
masked = true;
cmds.p.f(A, 'Watch the left.');
run();
ok(to(D).length === 1 && /\[Party\] Masked Person: Watch the left\.$/.test(to(D)[0]), 'party word reaches the party, naming a masked speaker as the companion knows them', to(D));
ok(to(B).length === 0 && to(E).length === 0, '...and no one outside the party');
masked = false;

// Refusals
reset();
cmds.p.f(B, 'hello');
ok(told.some(([a, t]) => a === B && /no party/.test(t)), 'no party: told so');
cmds.f.f(E, 'hello');
ok(told.some(([a, t]) => a === E && /serve no faction/.test(t)), 'no faction: told so');
props.set(`${B}|private.dboSentence`, { until: 1 });
cmds.f.f(B, 'Get me out');
ok(told.some(([a, t]) => a === B && /No runner reaches a cell/.test(t)) && !lines.length, 'no runner reaches a jail cell');
props.delete(`${B}|private.dboSentence`);
reset();
cmds.f.f(A, '');
ok(told.some(([, t]) => /\/f <text> sends word to Imperial Legion; \/f <faction>: <text> for another/.test(t)) && !lines.length, '/f alone explains itself');
// Someone who leaves before the runner arrives does not receive it; colour codes in the text are defused
reset();
cmds.f.f(A, 'hidden #{ff0000}red');
online = [A, C];
run();
ok(to(B).length === 0 && to(C).length === 1, 'a member who left the land before the runner arrived is not reached');
ok(!/#\{ff0000\}/.test(to(C)[0]), 'a colour code typed in the text is defused', to(C));
online = [A, B, C, D, E];

// Wiring and config
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
// holdOfActor since deece6d5 (stronghold zones, 1 Nov): a runner's reach is the hold around a stronghold, not the ring
ok(/require\(DISPATCHES_JS\)\(\{ mp, log, personal, deliver, registerChatCommand, onlineActors, nameOf, zoneOfActor, holdOfActor, cfg \}\)/.test(gm), 'gamemode.js loads dispatches.js, with holdOfActor');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8')).dispatches || {};
ok(cfg.enabled === true && cfg.delays && cfg.delays.hold === 5 && cfg.delays.province === 30 && cfg.delays.far === 90, 'gamemode-config.json dispatches: on, 5/30/90 s', cfg);

global.setTimeout = savedTimeout;
console.log(`${pass}/${pass + fail}`);
process.exitCode = fail ? 1 : 0;
