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

// The staff slot is anchored (claude-jake's review of 5fe6a458, 12 Oct; cases A1-A4 of its probe): the staff slot holds
// the staff character alone and the staff character follows it when the player slots grow or shrink. A spawn.ts without
// the anchor (slotMap has no staffSlot parameter) skips these.
if (!/staffSlot/.test(String(Spawn.prototype.slotMap))) {
  require('./expect')('trial-gm-slot-anchor', 'this spawn.ts has no staff-slot anchor');
  console.log('ok   skipped: this spawn.ts has no staff-slot anchor');
} else {
  const ROLES_PROFILE = globalThis.__alduinakRolesProfile;
  let EARNED = 0;
  const world = (maxChars) => {
    const s = new Spawn(() => {});
    s.maxCharacters = maxChars;
    s.roleCfg = { tierRoles: { senior: [], developer: [], leadgm: [], gm: [role('gm')] }, trialRoles: [TRIAL], adminRoleIds: [], adminProfileIds: [] };
    const pr = new Map();
    let nx = 0xff000100;
    const byP = new Map();
    const sent = [];
    const m = {
      get: (id, k) => pr.get(`${id}|${k}`), set: (id, k, v) => pr.set(`${id}|${k}`, v),
      createActor: (b, p, a, c, profileId) => { const id = nx++; if (!byP.has(profileId)) byP.set(profileId, []); byP.get(profileId).push(id); return id; },
      getActorsByProfileId: (p) => (byP.get(p) || []).slice(),
      destroyActor: (id) => { for (const l of byP.values()) { const i = l.indexOf(id); if (i >= 0) l.splice(i, 1); } },
      setEnabled: () => {}, setUserActor: () => {}, getUserActor: () => 0, getUserByActor: () => -1, setRaceMenuOpen: () => {},
      sendCustomPacket: (u, x) => sent.push(JSON.parse(x)), getActorName: (id) => `C${id - 0xff000100}`, lookupEspmRecordById: () => null,
      findFormsByPropertyValue: () => [],
    };
    const c = { svr: m, gm: { emit: () => {} } };
    s.settingsObject = { startPoints: [{ pos: [0, 0, 0], angleZ: 0, worldOrCell: '0x3c' }], allSettings: {} };
    s.startingItems = [];
    const login = (u, auth) => { s.authCache.set(u, auth); s.pending.set(u, auth); };
    const make = (u, slot) => { const a = s.authCache.get(u); s.pending.set(u, a); s.onSelectCharacter(c, u, slot); return (byP.get(a.profileId) || []).slice(-1)[0]; };
    const cards = (u) => { sent.length = 0; s.sendCharacterList(c, u, s.authCache.get(u).profileId); const l = sent.filter((x) => x.customPacketType === 'characterSelectMenu').slice(-1)[0]; return l.characters.map((x) => x ? `${x.name}${/GM character/.test(x.info) ? '*' : ''}` : null); };
    const name = (a) => `C${a - 0xff000100}`;
    const staffCount = (p) => (byP.get(p) || []).filter((a) => pr.get(`${a}|private.dboStaffChar`) === true).length;
    return { pr, byP, login, make, cards, name, staffCount };
  };
  {
    const w = world(3);
    w.login(1, { profileId: 11, roles: [TRIAL] });
    w.make(1, 0);
    const staff = w.make(1, 3);
    w.login(1, { profileId: 11, roles: [] });
    w.cards(1);
    ok('A1 role lost: the staff character is kept', w.byP.get(11).includes(staff), w.byP.get(11));
    w.login(1, { profileId: 11, roles: [TRIAL] });
    const back = w.cards(1);
    ok('A1 role back: the staff character is in the staff slot again', back[3] === `${w.name(staff)}*`, back);
    ok('A1 role back: slot 1 is an empty player slot again', back[1] === null, back);
    ok('A1 role back: still one staff character', w.staffCount(11) === 1, w.staffCount(11));
  }
  {
    const w = world(1);
    w.login(1, { profileId: 11, roles: [TRIAL] });
    w.make(1, 0);
    const staff = w.make(1, 1);
    w.login(1, { profileId: 11, roles: [TRIAL, role('traveler')] });
    const v = w.cards(1);
    ok('A2 tier added: the staff character sits in the new staff slot (2)', v[2] === `${w.name(staff)}*` && w.pr.get(`${staff}|private.charSlot`) === 2, v);
    const plain = w.make(1, 1);
    ok('A2 tier added: a character made in slot 1 (the new player slot) is a player character', w.pr.get(`${plain}|private.dboStaffChar`) !== true, w.cards(1));
    ok('A2 one staff character', w.staffCount(11) === 1, w.staffCount(11));
  }
  {
    const w = world(1);
    w.login(1, { profileId: 11, roles: [TRIAL, role('traveler')] });
    w.make(1, 0);
    const plain = w.make(1, 1);
    const staff = w.make(1, 2);
    w.login(1, { profileId: 11, roles: [TRIAL] });
    const v = w.cards(1);
    ok('A3 tier lapsed: the staff slot (1) holds the staff character', v[1] === `${w.name(staff)}*`, v);
    ok('A3 tier lapsed: the lapsed slot\'s player character is hidden, not deleted', !v.includes(w.name(plain)) && w.byP.get(11).includes(plain), v);
    w.login(1, { profileId: 11, roles: [TRIAL, role('traveler')] });
    const back = w.cards(1);
    ok('A3 tier back: all three characters shown again, the staff one last', back.filter(Boolean).length === 3 && back[2] === `${w.name(staff)}*`, back);
  }
  {
    globalThis.__dboEarnedSlots = () => EARNED;
    EARNED = 0;
    const w = world(3);
    const roles = [TRIAL];
    if (ROLES_PROFILE instanceof WeakMap) ROLES_PROFILE.set(roles, 44);
    w.login(1, { profileId: 44, roles });
    w.make(1, 0);
    const staff = w.make(1, 3);
    EARNED = 1;
    const v = w.cards(1);
    ok('A4 earned slot: the staff character moves to slot 4 with the staff slot', v[4] === `${w.name(staff)}*`, v);
    const c = w.make(1, 3);
    ok('A4 earned slot: the character made in the earned slot (3) is a player character', w.pr.get(`${c}|private.dboStaffChar`) !== true, w.cards(1));
    delete globalThis.__dboEarnedSlots;
  }
}

process.chdir(cwd);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('');
console.log(fails ? `${fails} FAILURES` : 'all checks passed');
process.exit(fails ? 1 : 0);
