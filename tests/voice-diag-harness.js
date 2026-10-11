// The voice trace: /voicediag (Lead GM and above) opens a window on one player's client, whose front reports its voice
// mix every 5 s; each report is one sanitised log line, only inside the window and at most one per 4 s.
// Lifts the block out of gamemode.js and runs it on stubs.
//   node tests/voice-diag-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'gamemode.js'), 'utf8');
const cut = (start, end) => { const a = SRC.indexOf(start), b = SRC.indexOf(end, a); return a < 0 || b < 0 ? null : SRC.slice(a, b); };
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };

const BLOCK = cut('// The voice trace (front VoiceManager.js startDiag)', '// How hosts repair a split body');
if (!BLOCK) { console.log('FAIL the voice trace block is gone from gamemode.js'); process.exit(1); }
const P1 = 0xff000014, P2 = 0xff000015;
const NAMES = { [P1]: 'Ayla', [P2]: 'Borin' };
let logs, packets, said, audits, handlers, commands;
const load = () => {
  logs = []; packets = []; said = []; audits = []; handlers = {}; commands = {};
  new Function('sendPacket', 'onUi', 'log', 'display', 'registerChatCommand', 'personal', 'findByName', 'audit', 'who', BLOCK)(
    (a, p) => { packets.push([a, p]); return true; },
    (ev, fn) => { handlers[ev] = fn; },
    (...x) => logs.push(x.join(' ')),
    (a) => NAMES[a] || 'someone',
    (name, fn, opts) => { commands[name] = { fn, opts }; },
    (a, t) => said.push(t),
    (q) => (String(q).toLowerCase() === 'borin' ? P2 : 0),
    (t) => audits.push(t),
    (a) => NAMES[a] || 'someone',
  );
};
delete globalThis.__dboVoiceDiag;
load();
// What the front's diagReport sends (VoiceManager.js on client-voice-diag)
const REPORT = { mode: 'talk', vol: 2, mg: 1, mic: 0.02, micPk: 0.05, tx: false, echo: 'on', room: true, peers: [
  { id: 'abcdef0123456789', n: 'Ayla', d: 420, r: 840, m: 'talk', g: 0.799, f: 4, rms: 0.1, pk: 0.3, lk: 0.235, sub: true },
  { id: 'ff00', n: '', d: null, r: 840, m: '', g: 0, f: 1, rms: null, pk: null, lk: 0, sub: false }] };
const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;
const report = (a, r) => handlers.voiceDiag(a, [r]);

report(P2, REPORT);
ok(logs.length === 0, 'no window: a client cannot write voice lines to the log on its own', logs);
ok(commands.voicediag && commands.voicediag.opts.admin === true, '/voicediag is a staff command');
const LEAD = (SRC.match(/const LEAD_ONLY = new Set\(\[([\s\S]*?)\]\);/) || [])[1] || '';
ok(/'voicediag'/.test(LEAD), '...and Lead GM and above (LEAD_ONLY)');
commands.voicediag.fn(P1, '');
ok(/Usage: \/voicediag <player> \[seconds 30-300\]/.test(said.pop() || ''), 'no player named: usage');
commands.voicediag.fn(P1, 'nobody 60');
ok(/No player matches "nobody"/.test(said.pop() || ''), 'an unknown player: said so');
commands.voicediag.fn(P1, 'Borin 60');
ok(packets.length === 1 && packets[0][0] === P2 && packets[0][1].customPacketType === 'dboVoiceDiag' && packets[0][1].seconds === 60, "opens the window on that player's client", packets);
ok(audits.some((t) => /\/voicediag Borin for 60 s/.test(t)) && /grep "voicediag"/.test(said.pop() || ''), '...audited, and the caller is told where to look');

report(P2, REPORT);
const EXPECT = 'voicediag Borin: mode talk vol 2 micGain 1 mic 0.02/0.05 tx n echo on room y | 2 peer(s): abcdef012345 Ayla d 420 r 840 talk g 0.799 f 4 rms 0.1/0.3 lk 0.235 sub y; ff00 - d - r 840 - g 0 f 1 rms -/- lk 0 sub n';
ok(logs.length === 1 && logs[0] === EXPECT, 'a report is one line, named for the player', logs[0]);
clock += 1000; report(P2, REPORT);
ok(logs.length === 1, 'a second report within 4 s is dropped');
clock += 4000; report(P2, REPORT);
ok(logs.length === 2, '...one after 5 s lands');
clock += 5000; report(P1, REPORT);
ok(logs.length === 2, "another player's reports are not written (their window is not open)");

// Hostile input
clock += 5000;
const big = Object.assign({}, REPORT, { mode: 'talk\nvoicediag Ayla: forged', echo: 'x'.repeat(500), vol: 1e9, mg: -5, mic: 'loud', tx: 'yes',
  peers: Array.from({ length: 200 }, (_, i) => ({ id: i % 2 ? 'zz;\nfake' : 'a'.repeat(40), n: "Ma'jhad <b>\n</b>" + 'q'.repeat(100), d: 1e12, r: -1, m: 'shout', g: 7, f: 99, rms: NaN, pk: Infinity, lk: '0.5', sub: 1 })) });
report(P2, big);
const L = logs[logs.length - 1] || '';
ok(logs.length === 3 && !/[\r\n<>]/.test(L), 'line breaks and markup are stripped, so a report cannot forge a line', L.slice(0, 200));
ok(/ 24 peer\(s\): /.test(L) && L.split('; ').length === 24, 'at most 24 peers', (L.match(/\d+ peer/) || [])[0]);
ok(/vol 4 micGain 0 mic -\/0\.05 tx - echo x{12} /.test(L), 'numbers clamped, wrong types shown as -, words cut short', L.slice(0, 120));
ok(/aaaaaaaaaaaa Ma'jhad bbq{22} d 1000000 r 0 shout g 1 f 4 rms -\/- lk - sub -/.test(L) && /; \? Ma'jhad/.test(L), 'peer fields bounded; an id that is not hex is ?', L.slice(L.indexOf(': ') + 2, L.indexOf(': ') + 200));
ok(L.length < 4000, 'the line stays bounded', L.length);
for (const bad of [null, 'text', [1, 2], 42]) { clock += 5000; report(P2, bad); }
ok(logs.length === 3, 'a report that is not an object is ignored');
clock += 5000; report(P2, { mode: 'talk' });
ok(logs.length === 4 && /\| 0 peer\(s\)$/.test(logs[3]), 'no peers: still a line', logs[3]);

// Window bounds
commands.voicediag.fn(P1, 'Borin 5');
ok(packets[packets.length - 1][1].seconds === 30, 'a window shorter than 30 s is raised to 30');
commands.voicediag.fn(P1, 'Borin 99999');
ok(packets[packets.length - 1][1].seconds === 300, 'longer than 5 minutes is capped at 300 s');
commands.voicediag.fn(P1, 'Borin');
ok(packets[packets.length - 1][1].seconds === 120, 'no seconds: 2 minutes');
clock += 126000; report(P2, REPORT);
ok(logs.length === 4, 'after the window (and a 5 s grace) reports are ignored');

// A hot reload keeps an open window
commands.voicediag.fn(P1, 'Borin 60');
const before = globalThis.__dboVoiceDiag;
load();
ok(globalThis.__dboVoiceDiag === before && before.has(P2 >>> 0), 'a hot reload keeps the open windows');
clock += 5000; report(P2, REPORT);
ok(logs.length === 1, '...and reports still land after it');
const HELP = (SRC.match(/key: 'debug', title: 'Server and debugging', items: \[([\s\S]*?)\] \}/) || [])[1] || '';
ok(/'voicediag'/.test(HELP), 'listed in the staff help under Server and debugging');

Date.now = realNow;
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
