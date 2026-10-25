// A GM fixes locks on someone else's property (Nat, 25 Oct: "give regular GMs the ability to fix locks"; fork HousingSystem
// LOCK_FIX_ACTIONS): unlock, lock, re-key, take back one copy, and cut a key for the owner only (onto the owner's key ring).
// Claim, abandon, revoke, rename, transfer, containers and rooms stay with the owner, the hold's managers and Lead GM+. Each
// fix goes to the admin log as a GM lock fix; the staff rules (__dboAdminGate 'housingLockFix') can refuse it; a Trial GM has
// no admin tier and fixes nothing; the menu a GM sees is the manager's, flagged lockFixOnly, with the copies and no rooms.
//
//   node tests/housing-lock-fix-harness.js <bundled housingSystem.js>
//   (run-all.sh bundles fork skymp5-server/ts/systems/housingSystem.ts with esbuild and passes it)
'use strict';
const path = require('path');

const bundle = process.argv[2];
if (!bundle) { console.error('usage: node tests/housing-lock-fix-harness.js <bundled housingSystem.js>'); process.exit(2); }
const src = require('fs').readFileSync(path.resolve(bundle), 'utf8');
if (!/LOCK_FIX_ACTIONS/.test(src)) { require('./expect')('housing-lock-fix', 'this HousingSystem has no GM lock fixes'); console.log('ok   skipped: this HousingSystem predates GM lock fixes'); process.exit(0); }
const { HousingSystem } = require(path.resolve(bundle));

let fail = 0;
const ok = (c, what, extra) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || extra === undefined ? '' : ': ' + JSON.stringify(extra).slice(0, 400)}`); if (!c) fail++; };

const PROPERTY = 0x100;
const OWNER = 0xff000011, GM = 0xff000021, LEAD = 0xff000031, TRIAL = 0xff000061, STRANGER = 0xff000051;
const PROFILE = { [OWNER]: 11, [GM]: 21, [LEAD]: 31, [TRIAL]: 61, [STRANGER]: 51 };
const ROLES = { [GM]: ['role-gm'], [LEAD]: ['role-leadgm'], [TRIAL]: ['role-trial'] };
const USER = { [OWNER]: 1, [GM]: 2, [LEAD]: 3, [TRIAL]: 6, [STRANGER]: 5 };
const props = new Map();
const sent = [];
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
sys.roleCfg = { tierRoles: { senior: [], developer: [], leadgm: ['role-leadgm'], gm: ['role-gm'] }, trialRoles: ['role-trial'], adminRoleIds: [], adminProfileIds: [] };
sys.holdOf = () => 'bruma';
sys.holdRanks = () => [];
sys.partnerOf = () => 0; sys.saveRegistry = () => { }; sys.nearProperty = () => true; sys.primaryOf = (c, t) => t; sys.withinReach = () => true;
sys.actorOf = (c, u) => mp.getUserActor(u);
const notices = []; sys.notice = (c, u, t) => notices.push([u, t]);
sys.send = (c, u, packet) => sent.push([u, packet]);
const adminLog = []; globalThis.__alduinakAdminLog = (t) => adminLog.push(t);
const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(src) || [])[1] || 'private.dboHousing';
const reset = () => { mp.set(PROPERTY, HP, { owner: 11, ownerName: 'Owner', name: 'Owner\'s House', locked: true, serial: 1, partner: 0, containers: [], issued: [] }); sys.claimed = [PROPERTY]; adminLog.length = 0; };
const rec = () => sys.read(ctx, PROPERTY);
const request = (a, action, extra) => { sys.lastRequestMs = new Map(); notices.length = 0; sys.onPropertyRequest(ctx, USER[a], Object.assign({ target: PROPERTY, action }, extra || {})); };
const said = () => notices.map((n) => n[1]).join(' | ');

reset();
// ---- the fixes ----
request(GM, 'unlock');
ok(rec().locked === false, 'a GM unlocks a player\'s house', rec());
ok(adminLog.length === 1 && /HOUSING gm lock fix: actor ff000021 \(profile 21\) unlock on 100, owner profile 11/.test(adminLog[0]), '...logged as a GM lock fix', adminLog);
request(GM, 'lock');
ok(rec().locked === true, 'a GM locks it again', rec());
const before = rec().serial;
request(GM, 'revokekeys');
ok(rec().serial !== before || /scrap/.test(said()), 'a GM re-keys it (every old key turns to scrap)', { serial: rec().serial, said: said() });
request(GM, 'createkey');
ok((rec().issued || []).length === 0 && /owner/.test(said()), 'a GM\'s key with no recipient is refused: it goes to the owner only', said());
request(GM, 'createkey', { recipient: STRANGER });
ok((rec().issued || []).length === 0 && /owner/.test(said()), '...and not to a stranger', said());
ok(!adminLog.some((t) => /createkey/.test(t)), 'a refused key is not logged as a fix', adminLog);

// With the key ring (housingKeyRing, on in production since 13 Oct): a key cut for the owner lands on the owner's ring
sys.keyRing = true;
request(GM, 'createkey', { recipient: OWNER });
ok((rec().issued || []).length === 1 && /Owner|ring/.test(said()), 'with the key ring, a GM cuts a key for the owner, onto the owner\'s ring', { issued: rec().issued, said: said() });
ok(adminLog.some((t) => /gm lock fix: .* createkey on 100/.test(t)), '...logged as a GM lock fix', adminLog);
const copy = (rec().issued || [])[0];
request(GM, 'takekey', { name: copy });
ok((rec().issued || []).length === 0, 'a GM takes that copy back', rec().issued);
request(GM, 'createkey', { recipient: STRANGER });
ok((rec().issued || []).length === 0 && /owner only/.test(said()), '...and still cuts none for anyone else', said());
sys.keyRing = false;

// ---- what stays with the owner, the managers and Lead GM+ ----
for (const [action, extra] of [['rename', { name: 'Mine' }], ['transfer', { recipient: STRANGER }], ['revoke', {}], ['abandon', {}], ['grantcontainer', { recipient: STRANGER }]]) {
  const r0 = JSON.stringify(rec());
  request(GM, action, extra);
  ok(JSON.stringify(rec()) === r0, `a GM's ${action} changes nothing`, said());
}
ok(rec().owner === 11 && rec().name === 'Owner\'s House', 'the owner still owns it under its own name', rec());
ok(!sys.hasAccess(ctx, PROPERTY, rec(), GM), 'a GM still does not walk through a player\'s lock');

// ---- who else ----
reset();
request(TRIAL, 'unlock');
ok(rec().locked === true && adminLog.length === 0, 'a Trial GM (no admin tier) fixes nothing', rec());
request(STRANGER, 'unlock');
ok(rec().locked === true, 'a stranger cannot unlock it', rec());
request(LEAD, 'unlock');
ok(rec().locked === false && /staff override/.test(adminLog.join(' ')), 'a Lead GM still unlocks it as the staff override', adminLog);

// ---- the staff rules have the last word ----
reset();
globalThis.__dboAdminGate = (a, kind, info) => (kind === 'housingLockFix' && info.ownerProfile === 11 ? 'Staff tools never act on your own characters. Ask another member of staff.' : '');
request(GM, 'unlock');
ok(rec().locked === true && adminLog.length === 0, 'a lock fix the staff rules refuse (housingLockFix) does nothing', { rec: rec(), adminLog });
globalThis.__dboAdminGate = () => '';

// ---- the menu a GM sees ----
sent.length = 0;
sys.sendMenu(ctx, USER[GM], GM, PROPERTY);
const menu = (sent.pop() || [])[1] || {};
ok(menu.view === 'manager' && menu.lockFixOnly === true, 'a GM sees the manager menu, flagged lockFixOnly', menu);
sent.length = 0;
sys.sendMenu(ctx, USER[LEAD], LEAD, PROPERTY);
const lead = (sent.pop() || [])[1] || {};
ok(lead.view === 'manager' && !lead.lockFixOnly, 'a Lead GM\'s menu carries no such flag', lead);
sys.sendMenu(ctx, USER[STRANGER], STRANGER, PROPERTY);
const stranger = (sent.pop() || [])[1] || {};
ok(stranger.view === 'denied' && !stranger.lockFixOnly, 'a stranger is denied, as before', stranger);

console.log(fail ? `${fail} FAILED` : 'all checks passed');
process.exit(fail ? 1 : 0);
