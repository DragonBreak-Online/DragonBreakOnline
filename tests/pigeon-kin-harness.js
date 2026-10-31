// The faction's own birds (gamemode.js, Nat 31 Oct, in-game-over-discord B): between two of one faction or one party a
// pigeon flies free, needs no meeting and waits 5 min per recipient instead of the sender's 35; /circular sends one letter
// to every member (leaders and officers, at a board); /status and the journal list who has written.
//   node tests/pigeon-kin-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const gm = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const cut = (from, to) => { const i = gm.indexOf(from); const j = gm.indexOf(to, i + from.length); if (i < 0 || j < 0) throw new Error(`slice ${from}`); return gm.slice(i, j); };
let fails = 0;
const ok = (c, t, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${t}${c ? '' : '   ' + JSON.stringify(g)}`); if (!c) fails++; };

const A = 0xff000001, B = 0xff000002, C = 0xff000003, D = 0xff000004, E = 0xff000005;
const NAMES = { [A]: 'Aldric', [B]: 'Brynja', [C]: 'Cyrus', [D]: 'Dagny', [E]: 'Erandur' };
const LEGION = (role) => ({ id: 'imperial-legion', name: 'Imperial Legion', title: 'x', shown: 'x', role });
const memberships = { [A]: [LEGION('officer')], [B]: [LEGION('member')], [C]: [LEGION('member')], [D]: [], [E]: [] };
const party = { [A]: null, [B]: null, [C]: null, [D]: 9, [E]: 9 };
globalThis.__dboGuildsOf = (a) => memberships[a] || [];
globalThis.__dboGuildMembers = () => [A, B, C];
globalThis.__dboPartyLeaderOf = (a) => (party[a] === undefined ? null : party[a]);
const props = new Map(), told = [], audits = [], gold = new Map([[A, 100], [D, 100]]);
const online = [A, B, D, E];
const pigeonLastSent = new Map();
const deps = {
  mp: { get: (a, k) => props.get(`${a}|${k}`), set: (a, k, v) => props.set(`${a}|${k}`, v) }, cfg: { pigeons: {} },
  isAdmin: () => false, profileOf: (a) => a & 0xff, pigeonLastSent, PIGEON_COOLDOWN_MS: 35 * 60000, PIGEON_MAX_TEXT: 1000, PIGEON_MAX_UNREAD: 20,
  pigeonContactsOf: () => [], onlineActors: () => online,
  lettersOf: (a) => (props.get(`${a}|private.pigeons`) || []).slice(), saveLetters: (a, l) => props.set(`${a}|private.pigeons`, l),
  pigeonFee: () => 5, takeGold: (a, n) => { const g = gold.get(a) || 0; if (g < n) return false; gold.set(a, g - n); return true; }, giveItem: () => true, GOLD_BASE: 0xf,
  notePigeonSent: (p) => pigeonLastSent.set(p, Date.now()),
  depositToTreasury: (z, n) => n, nextSignature: new Map(), ownDisplay: (a) => `${NAMES[a]} #TAGG`, FORGE: { tellChance: {} },
  audit: (t) => audits.push(t), who: (a) => NAMES[a], nameOf: (a) => NAMES[a], ownNameOf: (a) => NAMES[a], tagOf: () => 'TAGG', log: () => {},
  personal: (a, t) => told.push([a, t]), sendMailState: () => {}, zoneById: () => ({ name: 'Bruma' }),
  boardZoneNear: (a) => (a === A || a === D ? 'bruma' : null), registerChatCommand: (n, f) => { cmds[n] = f; },
  parcelUnbearable: () => false,
};
const cmds = {};
const statusParts = new Map();
const src = `${cut('const PIGEON_KIN = ', '// A letter may carry a parcel')}
${cut('const sendPigeon = (a, to, rawText, zoneId, goldRaw, itemsRaw) => {', 'const openPigeonCoop = ')}
${cut('// /circular [<faction>:] <text>', "}, { help: '[<faction>:] <text>: a letter to every member")}}, {});
${cut('const agoText = ', "} });\n")}} });
return { sendPigeon };`;
const names = Object.keys(deps).concat(['statusParts']);
const { sendPigeon } = new Function(...names, src)(...names.map((n) => (n === 'statusParts' ? statusParts : deps[n])));
const box = (a) => props.get(`${a}|private.pigeons`) || [];

// Two of the Legion who never met: the bird knows the way, flies free
let r = sendPigeon(A, B, 'Report to the fort.', 'bruma');
ok(r.ok && box(B).length === 1 && gold.get(A) === 100, 'a pigeon to one of the same faction flies without a meeting and costs nothing', [r, gold.get(A)]);
ok(!pigeonLastSent.has(A & 0xff), '...and does not use up the sender\'s 35-minute wait');
r = sendPigeon(A, B, 'And bring rope.', 'bruma');
ok(!r.ok && /only just flown\. Next one in 5 min/.test(r.text), 'a second bird to the same one waits 5 minutes', r);
r = sendPigeon(A, C, 'You too.', 'bruma');
ok(r.ok, '...but another of the faction can be written to at once', r);
// Outside the faction: the usual rules
r = sendPigeon(A, D, 'Hello.', 'bruma');
ok(!r.ok && /never met/.test(r.text), 'someone outside the faction still needs a meeting', r);
// A party is kin too
r = sendPigeon(D, E, 'Meet at the gate.', 'bruma');
ok(r.ok && gold.get(D) === 100, 'a pigeon within a party flies free too', [r, gold.get(D)]);

// /circular: officers only, at a board, to every member offline included, once per 30 min
told.length = 0;
cmds.circular(B, 'Muster');
ok(told.some(([a, t]) => a === B && /Only a faction's leaders and officers/.test(t)), 'a plain member cannot send a circular', told);
props.delete(`${B}|private.pigeons`); props.delete(`${C}|private.pigeons`);
told.length = 0;
cmds.circular(A, 'All of the Legion: muster at dawn.');
ok(box(B).length === 1 && box(C).length === 1 && box(C)[0].from === 'Aldric #TAGG, to all of Imperial Legion', 'the circular reaches every member, the offline one included, signed for the faction', [box(B), box(C)]);
ok(told.some(([a, t]) => a === A && /carry your circular to 2 of Imperial Legion/.test(t)), '...and tells the officer', told);
ok(audits.some((t) => /^CIRCULAR Aldric to Imperial Legion: 2 of 2/.test(t)), '...with an audit line', audits);
told.length = 0;
cmds.circular(A, 'Again');
ok(told.some(([, t]) => /only just gone out\. Next one in 30 min/.test(t)), 'a second circular waits 30 minutes', told);
ok(globalThis.__dboPigeonKin.circular === '', 'the circular flag is cleared after it is sent');

// Who has written: /status and the journal's Status
const line = statusParts.get('letters').fn(E);
ok(/^Letters 1 waiting at the boards: Dagny #TAGG \(0 min ago\)$/.test(line), 'the status line lists who wrote and when', line);
props.set(`${C}|private.pigeons`, box(C).concat([{ id: 'old', from: 'Unsigned', at: Date.now() - 3 * 3600000, read: false }]));
const two = statusParts.get('letters').fn(C);
ok(/^Letters 2 waiting at the boards: Aldric #TAGG, to all of Imperial Legion \(0 min ago\), Unsigned \(3 h ago\)$/.test(two), '...newest first', two);
ok(statusParts.get('letters').fn(0xff000009) === null, '...and nothing when no letter waits', statusParts.get('letters').fn(0xff000009));

// Config: kin off is the old behaviour
const cfgFile = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'gamemode-config.json'), 'utf8'));
const kin = (cfgFile.pigeons || {}).kin || {};
ok(kin.enabled === true && kin.cooldownMinutes === 5 && kin.fee === 0 && kin.circularMinutes === 30, 'gamemode-config.json pigeons.kin: on, 5 min, free, circular every 30 min', kin);
ok(/letters: \['Letters'\]/.test(fs.readFileSync(path.resolve(__dirname, '..', 'journal.js'), 'utf8')), 'journal.js names the Letters status row');

console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
