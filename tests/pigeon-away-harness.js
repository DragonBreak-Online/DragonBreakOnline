// A pigeon to someone away (gamemode.js sendPigeon, blamblam_banana 26 Oct: players read "Away" as "the bird cannot fly"
// and paid for Discord letters instead). The letter waits in the recipient's coop and the login line tells them; the
// sender is now told so.
//   node tests/pigeon-away-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const gm = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const src = gm.slice(gm.indexOf('const sendPigeon = '), gm.indexOf('const openPigeonCoop = '));
let fails = 0;
const ok = (c, t, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${t}${c ? '' : '   ' + JSON.stringify(g)}`); if (!c) fails++; };

const ME = 0xff000001, AWAY = 0xff000002, HERE = 0xff000003;
const NAMES = { [ME]: 'Bobin', [AWAY]: 'Elsilda Farseer', [HERE]: 'Moss-Pocket' };
const props = new Map();
const told = [], mailState = [];
let online = [ME, HERE];
const deps = {
  mp: { get: (a, k) => props.get(`${a}|${k}`), set: (a, k, v) => props.set(`${a}|${k}`, v) },
  isAdmin: () => false, profileOf: (a) => a & 0xff, pigeonLastSent: new Map(), PIGEON_COOLDOWN_MS: 35 * 60000, PIGEON_MAX_TEXT: 240, PIGEON_MAX_UNREAD: 20,
  pigeonContactsOf: () => [AWAY, HERE], onlineActors: () => online,
  lettersOf: (a) => (props.get(`${a}|private.pigeons`) || []).slice(), saveLetters: (a, l) => props.set(`${a}|private.pigeons`, l),
  pigeonFee: () => 5, takeGold: () => true, giveItem: () => true, GOLD_BASE: 0xf, notePigeonSent: () => {},
  depositToTreasury: () => 5, nextSignature: new Map(), ownDisplay: (a) => `${NAMES[a]} #TAGG`, FORGE: { tellChance: {} },
  audit: () => {}, who: (a) => NAMES[a], nameOf: (a) => NAMES[a], ownNameOf: (a) => NAMES[a], tagOf: () => 'TAGG', log: () => {},
  personal: (a, t) => told.push([a, t]), sendMailState: (a) => mailState.push(a), zoneById: () => ({ name: 'Windhelm' }),
};
const sendPigeon = new Function(...Object.keys(deps), `${src}\nreturn sendPigeon;`)(...Object.values(deps));

const r1 = sendPigeon(ME, AWAY, 'Is there a storage I can rent?', 'windhelm');
ok(r1.ok && (props.get(`${AWAY}|private.pigeons`) || []).length === 1 && props.get(`${AWAY}|private.pigeons`)[0].read === false, 'a letter to someone away is stored, unread, in their coop', props.get(`${AWAY}|private.pigeons`));
ok(/Elsilda Farseer is away: the letter waits for them, and they are told of it when they next come into the land\.$/.test(r1.text), 'the sender is told they are away and will be told at their next login', r1.text);
ok(/^Your pigeon flies to Elsilda Farseer, who will read it at a notice board\. 5 gold to the Windhelm treasury\./.test(r1.text), '...after the usual line', r1.text);
ok(!told.some(([a]) => a === AWAY) && !mailState.includes(AWAY), 'nothing is pushed to the absent one (the login line does it)');

deps.pigeonLastSent.clear();
const r2 = sendPigeon(ME, HERE, 'Bobin is coming.', 'windhelm');
ok(r2.ok && !/away/.test(r2.text), 'to someone in the land: no away note', r2.text);
ok(told.some(([a, t]) => a === HERE && /A pigeon has brought you a letter/.test(t)) && mailState.includes(HERE), '...and they are told at once');
ok(/const waiting = pigeonsWaiting\(a\);\n\s*if \(waiting\) personal\(a, `\$\{waiting\} unread letter/.test(gm), 'the login line that tells the absent one is still there');

console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
