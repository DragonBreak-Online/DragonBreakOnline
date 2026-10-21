// An identity reroll behind a mask (patrons.js blocker, playermenu.js __dboMaskOf) against a stub server.
// #bugs 1561047265534025878 (17 Oct): the reroll's new name was lost when the mask came off, because the mask keeps the
// old name and puts it back. A reroll now asks for the mask to come off first.
// Run from server\: node tests\reroll-mask-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reroll-mask-'));
fs.copyFileSync(path.resolve(__dirname, '..', 'patron-tiers.json'), path.join(tmp, 'patron-tiers.json'));
process.chdir(tmp);

const tiers = JSON.parse(fs.readFileSync('patron-tiers.json', 'utf8')).tiers;
const roleOf = (id) => tiers.find((t) => t.id === id).roleId;

const props = new Map();
const actors = {};
const said = [];
const opened = [];
const mp = {
  get: (a, k) => (props.get(a) || {})[k],
  set: (a, k, v) => { props.set(a, Object.assign(props.get(a) || {}, { [k]: v })); },
  setRaceMenuOpen: (a, on) => { if (on) opened.push(a); },
};
// playermenu.js's contract: the real name is kept in maskName while the mask is on
const MASK_NAME = 'Masked Person';
const isMaskName = (n) => String(n || '').trim().toLowerCase() === MASK_NAME.toLowerCase();
globalThis.__dboMaskOf = (a) => {
  const v = String(mp.get(a, 'maskName') || '');
  return { masked: !!v, real: v && !isMaskName(v) ? v : '', shown: MASK_NAME, isMaskName };
};

const commands = new Map();
delete globalThis.__dboPatronStore;
require(path.resolve(__dirname, '..', 'patrons.js'))({
  mp, log: () => {}, personal: (a, t) => said.push(t), system: (a, t) => said.push(t), audit: () => {},
  registerChatCommand: (n, fn) => commands.set(n, fn), who: String, display: String,
  profileOf: (a) => actors[a].profile, rolesOf: (a) => actors[a].roles, isAdmin: () => false, findByName: () => null,
});

let failures = 0;
const check = (what, got, want) => { const ok = got === want; if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}: got ${got}, want ${want}`); };
const last = () => said[said.length - 1] || '';

// Masked: the creator does not open, nothing is spent, and the player is told to take the mask off
actors[1] = { profile: 10, roles: [roleOf('adventurer')] };
mp.set(1, 'maskName', 'Aldric Stone');
mp.set(1, 'appearance', { name: MASK_NAME });
commands.get('reroll')(1, 'confirm');
check('masked: creator opened', opened.includes(1), false);
check('masked: reroll pending', mp.get(1, 'private.rerollPending') === true, false);
check('masked: told to take the mask off', /mask off/i.test(last()), true);
check('masked: journal offers Reroll', globalThis.__dboCanReroll(1), false);
check('masked: reroll still left', globalThis.__dboRerollsLeft(1).left, 1);

// The mask off (unmask clears maskName): the creator opens
mp.set(1, 'maskName', '');
mp.set(1, 'appearance', { name: 'Aldric Stone' });
check('unmasked: journal offers Reroll', globalThis.__dboCanReroll(1), true);
commands.get('reroll')(1, 'confirm');
check('unmasked: creator opened', opened.includes(1), true);

// Never masked: unchanged
actors[2] = { profile: 20, roles: [roleOf('adventurer')] };
commands.get('reroll')(2, 'confirm');
check('no mask: creator opened', opened.includes(2), true);

// A pending reroll (a crash mid-creator) reopened behind a mask is refused the same way
actors[3] = { profile: 30, roles: [roleOf('adventurer')] };
mp.set(3, 'private.rerollPending', true);
mp.set(3, 'maskName', 'Brenna Hale');
commands.get('reroll')(3, '');
check('pending, masked: creator opened', opened.includes(3), false);

// Without playermenu.js (no __dboMaskOf) nothing is blocked
delete globalThis.__dboMaskOf;
actors[4] = { profile: 40, roles: [roleOf('adventurer')] };
mp.set(4, 'maskName', 'Cael Ward');
commands.get('reroll')(4, 'confirm');
check('no mask module: creator opened', opened.includes(4), true);

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exitCode = failures ? 1 : 0;
