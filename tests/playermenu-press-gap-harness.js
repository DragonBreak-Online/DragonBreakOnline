// X presses queued behind a slow answer are dropped (17 Oct). A lead GM's X menu took about 14 s to build (it read a
// learned list of 331 spells three times); the presses made while it was building queued up and ran back to back, and
// 13 in a row held the server 3 minutes. playermenu.js now drops a press inside 1 s of that player's last answer
// finishing when that answer took 100 ms or more; a quick answer, the usual one, drops nothing. Real playermenu.js with
// a mock gamemode api; the slow answer is a menu entry provider that moves the monotonic clock (performance.now).
//
//   node tests/playermenu-press-gap-harness.js
'use strict';
const path = require('path');

const root = path.resolve(__dirname, '..');
process.chdir(root);
let failures = 0, checks = 0;
const check = (name, ok, got) => { checks++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!ok) failures++; };

let wall = 1_900_000_000_000, mono = 1000;
Date.now = () => wall;
performance.now = () => mono;
global.setTimeout = () => 0;

const GM = 0xff000040, OTHER = 0xff000041, TARGET = 0xff000042, FAR = 0xff000043;
const props = new Map();
const at = (a, x) => props.set(`${a}|locationalData`, { pos: [x, 0, 0], cellOrWorldDesc: 'tamriel', rot: [0, 0, 0] });
for (const [a, name] of [[GM, 'Aela'], [OTHER, 'Farkas'], [TARGET, 'Vilkas'], [FAR, 'Kodlak']]) props.set(`${a}|appearance`, { name, raceId: 0x13746 });
at(GM, 0); at(OTHER, 50); at(TARGET, 100); at(FAR, 90000);
const packets = [], logs = [];
const ui = new Map();
const onUi = (ev, fn) => { const l = ui.get(ev) || []; l.push(fn); ui.set(ev, l); };
const press = (a, t) => { for (const fn of ui.get('playerMenu') || []) fn(a, [t], 0); };
const online = [GM, OTHER, TARGET, FAR];
const mp = { get: (a, k) => props.get(`${a}|${k}`), set: (a, k, v) => props.set(`${a}|${k}`, v), getIdFromDesc: () => 0, getDescFromId: (id) => String(id),
  lookupEspmRecordById: () => null };
require(path.resolve('playermenu.js'))({ mp, log: (...a) => logs.push(a.join(' ')), personal: () => {}, system: () => {}, onUi, sendPacket: (a, p) => packets.push([a, p]),
  display: (a) => `#${(a >>> 0).toString(16)}`, nameOf: (a) => (props.get(`${a}|appearance`) || {}).name || '', tagOf: (a) => (a >>> 0).toString(16).slice(-4).toUpperCase(),
  profileOf: (a) => a, onlineActors: () => online, isAdmin: () => false, ranksOf: () => [], giveItem: () => {}, makeProp: () => {}, runCommand: () => {}, cfg: {}, every: () => {},
  registerChatCommand: () => {} });

// How long building a menu takes, per viewer: an entry provider every menu asks (as the journal's Settings check was)
const cost = new Map();
let builds = 0;
globalThis.__dboPickpocketEntries = (a) => { builds++; mono += cost.get(a >>> 0) || 2; return []; };
const menus = (a) => packets.filter(([x, p]) => x === a && p.customPacketType === 'dboPlayerMenu').length;

// ---- quick answers drop nothing ----
press(GM, TARGET); mono += 5; press(GM, TARGET); mono += 5; press(GM, OTHER);
check('three quick presses in a row (a few ms each) are all answered', menus(GM) === 3 && builds === 3, { menus: menus(GM), builds });

// ---- a slow answer: the presses queued behind it are dropped ----
cost.set(GM, 4500);
packets.length = 0; builds = 0; logs.length = 0;
mono += 2000;
press(GM, TARGET);
cost.set(GM, 2);
for (let i = 0; i < 12; i++) { mono += 1; press(GM, TARGET); }
check('after an answer that took 4.5 s, the 12 presses queued behind it are dropped: one menu, one build', menus(GM) === 1 && builds === 1, { menus: menus(GM), builds });
check('...each logged as dropped, with how long after and how slow the last answer was', logs.filter((l) => /playerMenu #ff000040 -> ff000042: dropped \(\d+ ms after an answer that took 4500 ms\)/.test(l)).length === 12, logs.slice(-2));
check('...and the slow one itself logged as sent, as before', logs.some((l) => /playerMenu #ff000040 -> #ff000042: menu sent/.test(l)), logs.slice(0, 2));

// ---- the gap ends a second after the slow answer finished ----
// (counted from here, so each check below stands on its own)
const answered = (a, t) => { const before = menus(a); press(a, t); return menus(a) === before + 1; };
mono += 1000;
check('a press a second after the slow answer finished is answered', answered(GM, TARGET));
mono += 5;
check('...and, that answer being quick, so is the next one at once', answered(GM, OTHER));

// ---- another player is not held back by this one's slow answer ----
cost.set(GM, 4500);
press(GM, TARGET);
mono += 1;
check('another player pressing X right after someone else\'s slow answer is answered', answered(OTHER, TARGET));

// ---- a refused press is quick, and a press after it is answered ----
cost.set(GM, 2);
mono += 1500;
press(GM, FAR);
mono += 5;
check('a refused press (too far) holds nothing back', logs.some((l) => /-> ff000043: refused/.test(l)) && answered(GM, TARGET));

// ---- the wall clock set back drops nothing ----
cost.set(GM, 4500);
mono += 1500;
press(GM, TARGET);
cost.set(GM, 2);
wall -= 3600000;
mono += 1001;
check('the gap is timed on the monotonic clock: a wall clock set back an hour does not hold presses back', answered(GM, TARGET));

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
