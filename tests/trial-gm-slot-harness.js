// Trial GM's extra character slot (Nate, 11 Oct), in the fork's spawn.ts: one slot more than their roles give, after the
// player slots, for staff work alone. A character created there carries private.dboStaffChar and its card says
// "GM character"; one created in a player slot does not. GMs and above keep their slots from patron-tiers.json; a GM
// role beside the Trial role gets no extra; the total stays capped at ten; without adminRoles.trialgm nothing changes.
//   node tests/trial-gm-slot-harness.js <bundled spawn.js>
// A fork without the staff slot has nothing to test, which is said and not failed unless a gate expects it.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const bundle = process.argv[2];
if (!bundle) { console.error('usage: node tests/trial-gm-slot-harness.js <bundled spawn.js>'); process.exit(2); }
if (!/dboStaffChar/.test(fs.readFileSync(bundle, 'utf8'))) { require('./expect')('trial-gm-slot', 'this spawn.ts has no Trial GM slot'); console.log('ok   skipped: this spawn.ts has no Trial GM slot'); process.exit(0); }

const SERVER = path.resolve(__dirname, '..');
const TIERS = JSON.parse(fs.readFileSync(path.join(SERVER, 'patron-tiers.json'), 'utf8'));
const role = (id) => TIERS.tiers.concat(TIERS.bonuses).find((t) => t.id === id).roleId;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-trialslot-'));
const cwd = process.cwd();
process.chdir(tmp);
fs.copyFileSync(path.join(SERVER, 'patron-tiers.json'), path.join(tmp, 'patron-tiers.json'));
delete globalThis.__dboEarnedSlots;
const { Spawn } = require(path.resolve(bundle));

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

const TRIAL = '1558248795932860507';
const sys = new Spawn(() => {});
sys.maxCharacters = 1;
sys.roleCfg = { tierRoles: { senior: [], developer: [], leadgm: [], gm: [role('gm')] }, trialRoles: [TRIAL], adminRoleIds: [], adminProfileIds: [] };
const users = {
  1: { profileId: 11, roles: [TRIAL] },                               // a Trial GM, no Patreon tier
  2: { profileId: 12, roles: [TRIAL, role('pathfinder')] },           // a Trial GM who is a Pathfinder (3 extra)
  3: { profileId: 13, roles: [TRIAL, role('gm')] },                    // a GM holding the Trial role too
  4: { profileId: 14, roles: [role('gm')] },                           // a GM
  5: { profileId: 15, roles: [] },                                     // a player
  6: { profileId: 16, roles: [TRIAL, role('owner'), role('prealpha')] }, // the Owner patron tier (no admin role in this config) and Pre-Alpha
};
for (const [u, a] of Object.entries(users)) sys.authCache.set(Number(u), a);
ok('a Trial GM: 1 + the staff slot', sys.slotsFor(1) === 2, sys.slotsFor(1));
ok('...the staff slot comes after the player slots', sys.staffSlotOf(users[1]) === 1, sys.staffSlotOf(users[1]));
ok('a Trial GM who is a Pathfinder: 1 + 3 + the staff slot', sys.slotsFor(2) === 5 && sys.staffSlotOf(users[2]) === 4, [sys.slotsFor(2), sys.staffSlotOf(users[2])]);
ok('a GM holding the Trial role keeps the GM\'s slots, no extra', sys.slotsFor(3) === 1 + 4 && sys.staffSlotOf(users[3]) === -1, sys.slotsFor(3));
ok('a GM and a player are unchanged', sys.slotsFor(4) === 5 && sys.slotsFor(5) === 1 && sys.staffSlotOf(users[4]) === -1 && sys.staffSlotOf(users[5]) === -1);
ok('the staff slot stacks on Patreon and bonus slots: 1 + 5 + 1 + 1', sys.slotsFor(6) === 8, sys.slotsFor(6));
const save = sys.maxCharacters;
sys.maxCharacters = 10;
ok('at ten player slots there is no room, and no staff slot', sys.slotsFor(1) === 10 && sys.staffSlotOf(users[1]) === -1, [sys.slotsFor(1), sys.staffSlotOf(users[1])]);
sys.maxCharacters = save;

// Creating in each slot
const props = new Map();
let next = 0xff000100;
const byProfile = new Map();
const mp = {
  get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v),
  createActor: (base, pos, angle, cell, profileId) => { const id = next++; if (!byProfile.has(profileId)) byProfile.set(profileId, []); byProfile.get(profileId).push(id); return id; },
  getActorsByProfileId: (p) => (byProfile.get(p) || []).slice(),
  setEnabled: () => {}, setUserActor: () => {}, getUserActor: () => 0, getUserByActor: () => -1, setRaceMenuOpen: () => {},
  sendCustomPacket: (u, s) => sentLists.push({ u, p: JSON.parse(s) }), getActorName: (id) => `Char${id.toString(16)}`, lookupEspmRecordById: () => null,
  findFormsByPropertyValue: () => [],
};
const sentLists = [];
const ctx = { svr: mp, gm: { emit: () => {} } };
sys.settingsObject = { startPoints: [{ pos: [0, 0, 0], angleZ: 0, worldOrCell: '0x3c' }], allSettings: {} };
sys.startingItems = [];
const create = (u, slot) => { sys.pending.set(u, users[u]); sys.onSelectCharacter(ctx, u, slot); return (byProfile.get(users[u].profileId) || []).slice(-1)[0]; };
const playerChar = create(1, 0);
ok('a Trial GM\'s character in a player slot is not a staff character', playerChar && props.get(`${playerChar}|private.dboStaffChar`) === undefined);
const staffChar = create(1, 1);
ok('...the one created in the staff slot is', staffChar && props.get(`${staffChar}|private.dboStaffChar`) === true && props.get(`${staffChar}|private.charSlot`) === 1);
sentLists.length = 0;
sys.sendCharacterList(ctx, 1, 11);
const list = (sentLists[0] || {}).p || {};
ok('the character screen shows both, the staff one as a GM character', list.maxCharacters === 2 && list.characters.length === 2 && /GM character/.test(list.characters[1].info) && !/GM character/.test(list.characters[0].info), list);
const pathChar = create(2, 4);
ok('a Pathfinder Trial GM\'s fifth slot is their staff slot', props.get(`${pathChar}|private.dboStaffChar`) === true);
const gmChar = create(3, 4);
ok('a GM\'s fifth slot is a plain one', gmChar && props.get(`${gmChar}|private.dboStaffChar`) === undefined);
sys.pending.set(1, users[1]);
const count = byProfile.get(11).length;
sys.onSelectCharacter(ctx, 1, 2);
ok('no slot past the staff slot', byProfile.get(11).length === count);

// Losing the role hides the slot, as a lapsed tier hides its characters; it is never deleted
sys.authCache.set(1, { profileId: 11, roles: [] });
ok('a Trial GM who loses the role is back to the player slots; the staff character stays in the world', sys.slotsFor(1) === 1 && byProfile.get(11).includes(staffChar));

// Without adminRoles.trialgm
sys.roleCfg = { tierRoles: { senior: [], developer: [], leadgm: [], gm: [role('gm')] }, trialRoles: [], adminRoleIds: [], adminProfileIds: [] };
sys.authCache.set(1, users[1]);
ok('without the settings key the Trial role gives no slot', sys.slotsFor(1) === 1 && sys.staffSlotOf(users[1]) === -1);

process.chdir(cwd);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('');
console.log(fails ? `${fails} FAILURES` : 'all checks passed');
process.exit(fails ? 1 : 0);
