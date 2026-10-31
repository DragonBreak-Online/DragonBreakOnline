// Heralds (heralds.js, Nat 31 Oct, in-game-over-discord C): /herald cries a gathering to the province, free for a faction
// leader or an event host and a fee for anyone else; reminders and the start; /events and attend; login line and status.
//   node tests/heralds-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heralds-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS clears it */ } });
let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) pass++; else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };

const LEAD = 0xff000001, PLAIN = 0xff000002, NEAR = 0xff000003, FAR = 0xff000004, HOST = 0xff000005;
const NAMES = { [LEAD]: 'Aldric', [PLAIN]: 'Brynja', [NEAR]: 'Cyrus', [FAR]: 'Dagny', [HOST]: 'Erandur' };
const PROV = { [LEAD]: 'cyrodiil', [PLAIN]: 'cyrodiil', [NEAR]: 'cyrodiil', [FAR]: 'skyrim', [HOST]: 'cyrodiil' };
globalThis.__dboGuildsOf = (a) => (a === LEAD ? [{ id: 'county-bruma', name: 'County of Bruma', role: 'leader' }] : []);
globalThis.__dboIsEventHost = (a) => a === HOST;
globalThis.__dboRegions = { provinceAt: (a) => ({ province: PROV[a] }) };
let atBoard = new Set([LEAD, PLAIN, HOST]);
globalThis.__alduinakBoardNear = (a) => (atBoard.has(a) ? 'bruma' : null);
const discord = [];
globalThis.__dboEventPostDiscord = (text, host) => discord.push([text, host]);
const statusParts = new Map();
globalThis.__dboRegisterStatus = (k, o, fn) => statusParts.set(k, fn);
let now = Date.UTC(2026, 10, 1, 18, 0);
const realNow = Date.now; Date.now = () => now;
const told = [], cried = [], audits = [], timers = {}, cmds = {}, treasury = [];
const gold = new Map([[PLAIN, 60], [LEAD, 0], [HOST, 0]]);
const props = new Map();
const HOLD = { [LEAD]: 'bruma', [PLAIN]: 'bruma', [NEAR]: 'bruma', [FAR]: 'whiterun', [HOST]: 'bruma' };
const load = (cfgH) => require(path.resolve(ROOT, 'heralds.js'))({
  mp: { get: (a, k) => props.get(`${a}|${k}`), set: (a, k, v) => props.set(`${a}|${k}`, v) }, log: () => {}, zoneOfActor: (a) => HOLD[a], personal: (a, t) => told.push([a, t]), system: (a, t) => cried.push([a, t]),
  registerChatCommand: (n, f) => { cmds[n] = f; }, onlineActors: () => [LEAD, PLAIN, NEAR, FAR, HOST], profileOf: (a) => a & 0xff, nameOf: (a) => NAMES[a],
  zoneById: () => ({ name: 'Bruma' }), takeGold: (a, n) => { const g = gold.get(a) || 0; if (g < n) return false; gold.set(a, g - n); return true; },
  depositToTreasury: (z, n) => { treasury.push([z, n]); return n; }, every: (k, ms, f) => { timers[k] = f; }, audit: (t) => audits.push(t), isAdmin: () => false,
  cfg: { heralds: cfgH || {} },
});
load();
const reset = () => { told.length = 0; cried.length = 0; discord.length = 0; };
const saidTo = (a) => told.filter((x) => x[0] === a).map((x) => x[1]).join(' | ');

// Refusals
reset();
atBoard = new Set([LEAD, PLAIN, HOST]);
cmds.herald(NEAR, '+2h A feast');
ok(/at a notice board/.test(saidTo(NEAR)), 'away from a board: refused');
cmds.herald(LEAD, 'tomorrow A feast');
ok(/\/herald <when> <what>/.test(saidTo(LEAD)), 'an unreadable time: the usage');
cmds.herald(LEAD, '+5m A feast');
ok(/at least 10 minutes/.test(saidTo(LEAD)), 'less than 10 minutes ahead: refused');
cmds.herald(LEAD, '+9d A feast');
ok(/7 days ahead/.test(saidTo(LEAD)), 'more than 7 days ahead: refused');

// A faction leader: free, cried to the province, sent to Discord
reset();
cmds.herald(LEAD, '+2h A feast at the castle for the Count\'s name day');
ok(cried.length === 4 && !cried.some(([a]) => a === FAR), 'cried to everyone in the province (4), not in Skyrim', cried.map((c) => c[0]));
ok(/^A herald cries: A feast at the castle for the Count's name day, at Bruma, in 2 h\. So says Aldric of County of Bruma\.$/.test(cried[0][1]), 'the cry names what, where, when from now and who', cried[0][1]);
ok(gold.get(LEAD) === 0 && !treasury.length, '...free for a faction\'s leader');
ok(discord.length === 1 && /<t:\d+:F> \(<t:\d+:R>\)/.test(discord[0][0]) && discord[0][1] === 'Aldric', '...and sent to Discord with its time', discord);

// Anyone else: pays the fee to the town
reset();
cmds.herald(PLAIN, '+1d A wrestling match by the gate');
ok(gold.get(PLAIN) === 10 && treasury.length === 1 && treasury[0][1] === 50, 'anyone else pays 50 gold to the town treasury', [gold.get(PLAIN), treasury]);
ok(!discord.length, '...and their cry stays in the game');
reset();
cmds.herald(PLAIN, '+3h Another');
ok(/ask 50 gold|asks 50 gold/.test(saidTo(PLAIN)) && !cried.length, 'without the gold: refused, nothing cried', saidTo(PLAIN));
// An event host: free
gold.set(PLAIN, 500);
reset();
cmds.herald(HOST, '20:30 The Jarl\'s tourney');
ok(cried.length === 4 && /in 2 h 30 min/.test(cried[0][1]) && gold.get(HOST) === 0, 'an event host is free; HH:MM by the server clock is shown as time from now', cried[0]);
// The cap per poster
cmds.herald(PLAIN, '+2d Third');
reset();
cmds.herald(PLAIN, '+3d Fourth');
ok(/already have 2 gatherings cried/.test(saidTo(PLAIN)), 'at most 2 cried at once per poster', saidTo(PLAIN));

// /events and attend
reset();
cmds.events(FAR, '');
ok(/The heralds cry: #1 A feast at the castle/.test(saidTo(FAR)) && /\/events attend <n>/.test(saidTo(FAR)), '/events lists what is cried, in order', saidTo(FAR));
reset();
cmds.events(FAR, 'attend 1');
ok(/You will come to A feast/.test(saidTo(FAR)), 'attend says you will come');

// Reminder and start: cried in the province, and the one coming from Skyrim is told
now += 90 * 60000 + 1000;
reset();
timers.heralds();
ok(cried.some(([, t]) => /A feast at the castle.*in 30 min/.test(t)) && told.some(([a, t]) => a === FAR && /Word reaches you of A feast.*begins in 30 min/.test(t)), 'the reminder 30 min before: cried in the province, told to the one coming from afar', [cried, told]);
reset();
timers.heralds();
ok(!cried.some(([, t]) => /A feast/.test(t)), 'the reminder is cried once');
now += 30 * 60000;
reset();
timers.heralds();
ok(cried.some(([, t]) => /A feast at the castle for the Count's name day begins now, at Bruma/.test(t)), 'it is cried again when it begins');

// Cancel: only the poster
reset();
cmds.herald(LEAD, 'cancel 2');
ok(/Only the one who had it cried/.test(saidTo(LEAD)), 'only the poster takes one down');
cmds.herald(PLAIN, 'cancel 2');
ok(cried.some(([, t]) => /A wrestling match by the gate, at Bruma, will not take place/.test(t)), 'the poster takes it down, and it is cried');

// Login line and status; kept on disk
reset();
globalThis.__dboHeraldLogin(NEAR);
ok(/The heralds cry: The Jarl's tourney at Bruma/.test(saidTo(NEAR)) || /The heralds cry: Third at Bruma/.test(saidTo(NEAR)), 'the login line names what is cried in the province', saidTo(NEAR));
ok(/^Heralds cry /.test(statusParts.get('events')(NEAR) || ''), 'the status line names it too', statusParts.get('events')(NEAR));
ok(statusParts.get('events')(FAR) === null, '...and nothing for one far away who said they would come to nothing still ahead', statusParts.get('events')(FAR));
const disk = JSON.parse(fs.readFileSync(path.join(dir, 'heralds.json'), 'utf8'));
ok(disk.seq === 4 && Array.isArray(disk.events), 'heralds.json keeps them over a restart', disk.seq);

// Attendance (in-game-over-discord incentives): the feast (#1) began at 20:00; four stood in Bruma through its hour, one
// in Whiterun. Four is fewer than minAttendees 5: no reward
const boosted = (a) => props.get(`${a}|private.dboGatheringBoost`);
const minutes = (n) => { for (let i = 0; i < n; i++) { now += 60000; timers.heralds(); } };
minutes(61);
ok(![LEAD, PLAIN, NEAR, HOST].some(boosted), 'four who stayed, fewer than minAttendees 5: no reward', [LEAD, PLAIN, NEAR, HOST].map(boosted));
// A smaller gathering's rule: minAttendees 3, so the four who stay through the hour are rewarded, not the one in Whiterun
load({ attendance: { minAttendees: 3 } });
reset();
cmds.herald(LEAD, '+15m A muster at the castle');
minutes(16);
ok(cried.some(([, t]) => /A muster at the castle begins now/.test(t)), 'the muster begins');
minutes(61);
ok([LEAD, PLAIN, NEAR, HOST].every((a) => boosted(a) && boosted(a).mult === 1.1) && !boosted(FAR), 'each who stood there 20 min or more works x1.1, not the one in Whiterun', [LEAD, PLAIN, NEAR, HOST, FAR].map(boosted));
ok(told.some(([a, t]) => a === NEAR && /Having joined A muster at the castle, your work comes easier for the next 60 minutes/.test(t)), '...and is told so');
ok(audits.some((t) => /HERALD #\d+ "A muster at the castle" closed: 4 stayed, 4 rewarded \(x1\.1 for 60 min\)/.test(t)), '...with an audit line', audits.slice(-2));
ok(globalThis.__dboGatheringSkillRate(NEAR) === 1.1 && globalThis.__dboGatheringSkillRate(FAR) === 1, 'skillrates reads x1.1 for the attendee, x1 for anyone else');
now += 61 * 60000;
ok(globalThis.__dboGatheringSkillRate(NEAR) === 1, '...and x1 again once its hour is over');
const sr = fs.readFileSync(path.join(ROOT, 'skillrates.js'), 'utf8');
ok(/kind !== 'award' && typeof globalThis\.__dboGatheringSkillRate === 'function'/.test(sr), 'skillrates.js applies it to normal play, never a staff award');

// Wiring and config
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
ok(/require\(HERALDS_JS\)\(\{ mp, log, personal, system, registerChatCommand, onlineActors, profileOf, nameOf, zoneById, takeGold, depositToTreasury, every, audit, isAdmin, zoneOfActor, cfg \}\)/.test(gm), 'gamemode.js loads heralds.js');
ok(/globalThis\.__dboHeraldLogin\(a\)/.test(gm), '...and the login line runs it');
const cfgFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8')).heralds || {};
ok(cfgFile.enabled === true && cfgFile.fee === 50 && cfgFile.reminderMinutes === 30, 'gamemode-config.json heralds: on, 50 gold, reminder 30 min', cfgFile);
ok(/heralds\.json/.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')), 'heralds.json is gitignored (runtime state)');
ok(/__dboIsEventHost = /.test(fs.readFileSync(path.join(ROOT, 'stafftools.js'), 'utf8')), 'stafftools.js says who hosts events');

Date.now = realNow;
console.log(`${pass}/${pass + fail}`);
process.exitCode = fail ? 1 : 0;
