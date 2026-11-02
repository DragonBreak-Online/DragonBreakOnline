// Who may open or manage someone else's property (claude-jake's review A3-1, 2026-09-28): a GM observes; the staff override
// is Lead GM and above (TIER_CAPS.spawn); a hold's manager ranks keep theirs; every staff override is admin-logged.
// From 2 Nov (Nat: "allow them to do everything" but opening someone's property as its owner; a HousingSystem with
// isStaffOverride, TIER_CAPS.property): a GM grants, transfers, revokes and does every lock and key action, logged as a
// staff override, and still does not open or enter it; the staff rules ('housing') hear the owner and refuse a property of
// the staff member's own account; a Trial GM has no admin tier and none of it.
//
//   node tests/housing-staff-harness.js <bundled housingSystem.js>
//   (run-all.sh bundles fork skymp5-server/ts/systems/housingSystem.ts with esbuild and passes it)
'use strict';
const path = require('path');

const bundle = process.argv[2];
if (!bundle) { console.error('usage: node tests/housing-staff-harness.js <bundled housingSystem.js>'); process.exit(2); }
const { HousingSystem } = require(path.resolve(bundle));

let fail = 0;
const ok = (c, what, extra) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || extra === undefined ? '' : ': ' + JSON.stringify(extra)}`); if (!c) fail++; };

const PROPERTY = 0x100;
const OWNER = 0xff000011, GM = 0xff000021, LEAD = 0xff000031, JARL = 0xff000041, STRANGER = 0xff000051, TRIAL = 0xff000061;
const PROFILE = { [OWNER]: 11, [GM]: 21, [LEAD]: 31, [JARL]: 41, [STRANGER]: 51, [TRIAL]: 61 };
const ROLES = { [GM]: ['role-gm'], [LEAD]: ['role-leadgm'], [TRIAL]: ['role-trial'] };
const USER = { [OWNER]: 1, [GM]: 2, [LEAD]: 3, [JARL]: 4, [STRANGER]: 5, [TRIAL]: 6 };
const props = new Map();
const mp = {
  get: (id, key) => {
    if (key === 'profileId') return PROFILE[id] !== undefined ? PROFILE[id] : 0;
    if (key === 'private.discordRoles') return ROLES[id] || [];
    const v = props.get(`${id >>> 0}:${key}`);
    return v === undefined ? undefined : JSON.parse(v);
  },
  set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
  getUserByActor: (id) => USER[id] || -1,
  getUserActor: (u) => Number(Object.keys(USER).find((a) => USER[a] === u) || 0),
  isConnected: () => false,
  sendCustomPacket: () => { },
};
const ctx = { svr: mp };
const sys = new HousingSystem(() => { });
sys.roleCfg = { tierRoles: { senior: [], developer: [], leadgm: ['role-leadgm'], gm: ['role-gm'] }, adminRoleIds: [], adminProfileIds: [] };
// The world is stubbed: the property stands in Bruma, whose jarl is JARL; no teleport partners; every request is in reach
sys.holdOf = () => 'bruma';
sys.holdRanks = (c, a) => (a === JARL ? [{ hold: 'bruma', rank: 'jarl' }] : []);
sys.partnerOf = () => 0; sys.saveRegistry = () => { }; sys.nearProperty = () => true; sys.primaryOf = (c, t) => t;
sys.actorOf = (c, u) => mp.getUserActor(u);
const notices = []; sys.notice = (c, u, t) => notices.push([u, t]);
const adminLog = []; globalThis.__alduinakAdminLog = (t) => adminLog.push(t);

const src = require('fs').readFileSync(path.resolve(bundle), 'utf8');
const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(src) || [])[1] || 'private.dboHousing';
const reset = () => { mp.set(PROPERTY, HP, { owner: 11, ownerName: 'Owner', name: 'Owner\'s House', locked: true, serial: 1, partner: 0, containers: [], issued: [] }); sys.claimed = [PROPERTY]; };
const rec = () => sys.read(ctx, PROPERTY);
const request = (a, action, extra) => { sys.lastRequestMs = new Map(); notices.length = 0; sys.onPropertyRequest(ctx, USER[a], Object.assign({ target: PROPERTY, action }, extra || {})); };

const GM_PROPERTY = /isStaffOverride/.test(src);
if (GM_PROPERTY) {
  reset();
  // ---- 2 Nov: a GM manages someone else's property in full, but never opens it as its owner ----
  ok(!sys.hasAccess(ctx, PROPERTY, rec(), GM), 'a GM does not walk into a player\'s locked house');
  ok(sys.hasAccess(ctx, PROPERTY, rec(), LEAD), 'a Lead GM still can');
  ok(!sys.hasAccess(ctx, PROPERTY, rec(), TRIAL) && !sys.isManager(ctx, TRIAL, PROPERTY), 'a Trial GM neither opens nor manages it');
  ok(sys.isManager(ctx, GM, PROPERTY), 'a GM manages other people\'s property');
  request(TRIAL, 'unlock');
  ok(rec().locked === true && adminLog.length === 0, 'a Trial GM\'s unlock is refused', { rec: rec(), adminLog });
  request(GM, 'unlock');
  ok(rec().locked === false && adminLog.length === 1 && /HOUSING staff override: actor ff000021 .* unlock on 100, owner profile 11/.test(adminLog[0]), 'a GM unlocks it, logged as a staff override', { rec: rec(), adminLog });
  request(GM, 'lock');
  ok(rec().locked === true && adminLog.length === 2, 'and locks it again', adminLog);
  request(GM, 'createkey');
  ok((rec().issued || []).length === 0 && adminLog.length === 2 && notices.some(([, t]) => /A GM cuts/.test(t)), 'a GM cuts no key for themselves (a key would open it): the owner\'s only', { issued: rec().issued, notices });
  ok(!sys.hasAccess(ctx, PROPERTY, rec(), GM), '...and does not walk through its lock (opening stays Lead GM and above)', rec());
  request(GM, 'transfer', { recipient: GM });
  ok(rec().owner === 11 && notices.some(([, t]) => /never hand a property to your own account/.test(t)), 'a GM never hands it to their own account', { rec: rec(), notices });
  request(GM, 'transfer', { recipient: STRANGER });
  ok(rec().owner === 51 && adminLog.length === 3 && /transfer on 100, owner profile 11/.test(adminLog[2]), 'a GM transfers it to another player, logged', { rec: rec(), adminLog });
  ok(!sys.hasAccess(ctx, PROPERTY, rec(), GM), 'a GM is refused the open while allowed the transfer');
  request(GM, 'revoke');
  ok(rec().owner === 0 && adminLog.length === 4 && /revoke on 100, owner profile 51/.test(adminLog[3]), 'a GM revokes it, logged', { rec: rec(), adminLog });
  request(GM, 'claim');
  ok(rec().owner === 21, 'a GM grants an unowned one (claims it)', rec());
  // The staff rules hear the owner: a property of the GM's own account (another of their characters) is refused
  const asked = [];
  globalThis.__dboAdminGate = (a, action, info) => { asked.push([a >>> 0, action, info && info.ownerProfile]); return action === 'housing' && info && Number(info.ownerProfile) === PROFILE[a >>> 0] ? 'Staff tools never act on your own characters.' : ''; };
  mp.set(PROPERTY, HP, { owner: 21, ownerName: 'Gemma', ownerChar: 0xff0000aa, name: 'Gemma\'s House', locked: true, serial: 1, partner: 0, containers: [], issued: [] });
  adminLog.length = 0;
  request(GM, 'revoke');
  ok(rec().owner === 21 && adminLog.length === 0, 'a GM\'s revoke of their own account\'s property (another character) is refused', { rec: rec(), adminLog });
  ok(asked.some(([a, action, o]) => a === GM && action === 'housing' && o === 21), '...the staff rules heard the owner\'s profile', asked);
  request(LEAD, 'revoke');
  ok(rec().owner === 0, 'a Lead GM still revokes it', rec());
  delete globalThis.__dboAdminGate;
  reset();
  adminLog.length = 0;
  request(JARL, 'createkey');
  ok(adminLog.length === 0, 'a jarl managing a house in their own hold is not a staff override', adminLog);
  request(OWNER, 'createkey');
  ok(adminLog.length === 0, 'nor is the owner', adminLog);
  console.log(fail ? `${fail} FAILED` : 'all checks passed');
  process.exit(fail ? 1 : 0);
}

reset();
// ---- opening a locked property ----
ok(sys.hasAccess(ctx, PROPERTY, rec(), OWNER), 'the owner opens their own locked house');
ok(!sys.hasAccess(ctx, PROPERTY, rec(), GM), 'a GM no longer walks into a player\'s locked house');
ok(sys.hasAccess(ctx, PROPERTY, rec(), LEAD), 'a Lead GM still can');
ok(sys.hasAccess(ctx, PROPERTY, rec(), JARL), 'the hold\'s jarl still can');
ok(!sys.hasAccess(ctx, PROPERTY, rec(), STRANGER), 'a stranger cannot');
// ---- managing it ----
ok(!sys.isManager(ctx, GM, PROPERTY), 'a GM is not a manager of other people\'s property');
ok(sys.isManager(ctx, LEAD, PROPERTY) && sys.isManager(ctx, JARL, PROPERTY), 'a Lead GM and the jarl are');
request(GM, 'revoke');
ok(rec().owner === 11, 'a GM\'s revoke is refused: the owner keeps the house', rec());
request(GM, 'createkey');
ok((rec().issued || []).length === 0, 'a GM cannot cut a key to it for themselves', rec().issued);
ok(adminLog.length === 0, 'nothing refused is logged as a staff override', adminLog);
// Nat, 25 Oct: a GM fixes locks (unlock, lock, re-key, take back a copy, a key for the owner), logged as a GM lock fix
request(GM, 'unlock');
ok(rec().locked === false && adminLog.length === 1 && /HOUSING gm lock fix: actor ff000021 .* unlock on 100, owner profile 11/.test(adminLog[0]), 'a GM can unlock it now, logged as a GM lock fix', { rec: rec(), adminLog });
request(GM, 'lock');
ok(rec().locked === true && adminLog.length === 2, 'and lock it again', adminLog);
ok(sys.hasAccess(ctx, PROPERTY, rec(), GM) === false, '...but still does not walk through its lock', rec());
adminLog.length = 0;
request(LEAD, 'createkey');
ok((rec().issued || []).length === 1, 'a Lead GM can cut a key', rec().issued);
ok(adminLog.length === 1 && /HOUSING staff override: actor ff000031 .* createkey on 100, owner profile 11/.test(adminLog[0]), 'and the override goes to the admin log', adminLog);
request(JARL, 'createkey');
ok(adminLog.length === 1, 'a jarl managing a house in their own hold is not a staff override', adminLog);
request(OWNER, 'createkey');
ok(adminLog.length === 1, 'nor is the owner', adminLog);
request(LEAD, 'revoke');
ok(rec().owner === 0 && adminLog.length === 2 && /revoke/.test(adminLog[1]), 'a Lead GM can revoke, logged', { rec: rec(), adminLog });

console.log(fail ? `${fail} FAILED` : 'all checks passed');
process.exit(fail ? 1 : 0);
