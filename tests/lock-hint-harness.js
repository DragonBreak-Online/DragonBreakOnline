// Scripted test for the locked-property hint in gamemode.js (13 Oct, Roland in #bugs 'Locks'): with housingKeyRing on, a
// locked door or container lets its owner, managers and key holders through, so they are told once per property every few
// minutes that the lock holds for everyone without a key. This cuts the block out of the gamemode and runs it around a
// stand-in chain. Run it from this folder's parent with
//
//   node tests/lock-hint-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const a = src.indexOf('// A key holder walking through a locked property');
const b = src.indexOf('// NPCs open doors but never close them', a);
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };
if (a < 0 || b < 0) { check('the locked-property hint is in gamemode.js', false); console.log('1 failure'); process.exit(1); }
const ruleSrc = src.slice(a, b);

const DOOR = 0x08001001, PARTNER = 0x08001002, CHEST = 0x08001003, NAMED = 0x08001004, OPEN = 0x08001005, WORLD = 0x08001006, UNOWNED = 0x08001007;
const DOOR_BASE = 0x00042035, CONT_BASE = 0x00012000;
const OWNER = 0xff000014, OTHER = 0xff000015, NPC = 0xff00221d;
const housing = {
  [DOOR]: { owner: 7, name: null, locked: true },
  [PARTNER]: { primary: DOOR },
  [CHEST]: { owner: 7, name: null, locked: true },
  [NAMED]: { owner: 7, name: 'Roland\'s House', locked: true },
  [OPEN]: { owner: 7, name: 'Open House', locked: false },
  [UNOWNED]: { owner: 0, name: null, locked: true },
};
const base = { [DOOR]: DOOR_BASE, [PARTNER]: DOOR_BASE, [CHEST]: CONT_BASE, [NAMED]: DOOR_BASE, [OPEN]: DOOR_BASE, [WORLD]: DOOR_BASE, [UNOWNED]: DOOR_BASE };
const mp = {
  get: (id, prop) => {
    id >>>= 0;
    if (prop === 'private.housing') return housing[id] ? JSON.parse(JSON.stringify(housing[id])) : null;
    if (prop === 'baseDesc') return base[id] ? `${base[id].toString(16)}:Skyrim.esm` : '';
    throw new Error(`unexpected property ${prop}`);
  },
  getIdFromDesc: (desc) => parseInt(String(desc).split(':')[0], 16),
  lookupEspmRecordById: (id) => ({ record: { type: (id >>> 0) === CONT_BASE ? 'CONT' : 'DOOR', fields: [] } }),
};
let chainAnswer = true;
const userOf = (actor) => ((actor >>> 0) === NPC ? -1 : 1);
const said = [];
const system = (actor, text) => said.push([actor >>> 0, text]);
let keyRing = true;
const load = (keep) => {
  if (!keep) delete globalThis.__dboLockHintAt;
  globalThis.__dboHousing = { keyRingOn: () => keyRing };
  mp.onActivate = () => chainAnswer;
  new Function('mp', 'userOf', 'system', 'globalThis', ruleSrc)(mp, userOf, system, globalThis);
  return mp.onActivate;
};
const TEXT = (label) => `${label} is locked: your key lets you in. Anyone without a key is refused.`;

let act = load();
check('the owner opens a locked door: it opens', act(DOOR, OWNER) === true);
check('...and they are told the lock still holds for others', said.length === 1 && said[0][0] === OWNER && said[0][1] === TEXT('This door'), said);
act(DOOR, OWNER); act(PARTNER, OWNER);
check('...once per property: again, and through its partner door, nothing more', said.length === 1, said.length);
said.length = 0;
act(CHEST, OWNER);
check('a locked container: told, as a container', said.length === 1 && said[0][1] === TEXT('This container'), said);
said.length = 0;
act(NAMED, OTHER);
check('a named property uses its name, and a key holder is told too', said.length === 1 && said[0][0] === OTHER && said[0][1] === TEXT('Roland\'s House'), said);
said.length = 0;
act(OPEN, OWNER); act(WORLD, OWNER); act(UNOWNED, OWNER);
check('unlocked, unclaimed and ownerless refs say nothing', said.length === 0, said);
act(NAMED, NPC);
check('an NPC through a locked door says nothing', said.length === 0, said);
chainAnswer = false;
check('a refused activation stays refused', act(DOOR, OTHER) === false);
check('...and says nothing (housing already told them it is locked)', said.length === 0, said);
chainAnswer = true;
keyRing = false;
act = load();
act(DOOR, OWNER);
check('with the key ring off nothing is said', said.length === 0, said);
keyRing = true;
act = load(true);
act(DOOR, OWNER);
check('a reload keeps nothing from the key-ring-off run and hints again', said.length === 1, said);
said.length = 0;
act = load(true);
act(DOOR, OWNER);
check('a hot reload keeps the per-property cooldown', said.length === 0, said);
const realNow = Date.now;
Date.now = () => realNow() + 5 * 60 * 1000 + 1;
act(DOOR, OWNER);
Date.now = realNow;
check('after five minutes it is said again', said.length === 1, said.length);
said.length = 0;
mp.get = () => { throw new Error('boom'); };
check('an unreadable ref still opens, silently', act(CHEST, OTHER) === true && said.length === 0);
check('no new mp.on listener in the block', !/\bmp\.on\(/.test(ruleSrc));

console.log(failures ? `${failures} failure(s)` : 'all ok');
process.exit(failures ? 1 : 0);
