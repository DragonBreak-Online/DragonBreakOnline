// The fork's free hand-over of a house (housingSystem.ts doTransfer) asks the gameplay's citizenship gate (tenancy.js
// __dboPropertyTransferCheck, Nate 14 Oct): an owner hands a house in a hold that grants citizenship only to someone who
// could buy it there; the hold's managers grant as before. Skips on a fork without the hook (fork-citizenship-1014).
//
//   node tests/citizenship-transfer-harness.js <bundled housingSystem.js>
//   (run-all.sh bundles fork skymp5-server/ts/systems/housingSystem.ts with esbuild and passes it)
'use strict';
const fs = require('fs');
const path = require('path');

const bundle = process.argv[2];
if (!bundle) { console.error('usage: node tests/citizenship-transfer-harness.js <bundled housingSystem.js>'); process.exit(2); }
const src = fs.readFileSync(path.resolve(bundle), 'utf8');
if (!src.includes('__dboPropertyTransferCheck')) { require('./expect')('citizenship-transfer', 'this housingSystem.ts has no citizenship hook'); console.log('skipped: this fork\'s housingSystem.ts has no citizenship hook (fork-citizenship-1014)'); process.exit(0); }
const { HousingSystem } = require(path.resolve(bundle));

let fail = 0;
const ok = (c, what, extra) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || extra === undefined ? '' : ': ' + JSON.stringify(extra)}`); if (!c) fail++; };
const PROPERTY = 0x100;
const OWNER = 0xff000011, CITIZEN = 0xff000021, OUTSIDER = 0xff000031, JARL = 0xff000041;
const PROFILE = { [OWNER]: 11, [CITIZEN]: 21, [OUTSIDER]: 31, [JARL]: 41 };
const USER = { [OWNER]: 1, [CITIZEN]: 2, [OUTSIDER]: 3, [JARL]: 4 };
const props = new Map();
const mp = {
  get: (id, key) => {
    if (key === 'profileId') return PROFILE[id] !== undefined ? PROFILE[id] : 0;
    if (key === 'private.discordRoles') return [];
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
sys.roleCfg = { tierRoles: { senior: [], developer: [], leadgm: [], gm: [] }, adminRoleIds: [], adminProfileIds: [] };
sys.holdOf = () => 'bruma';
sys.holdRanks = (c, a) => (a === JARL ? [{ hold: 'bruma', rank: 'count' }] : []);
sys.partnerOf = () => 0; sys.saveRegistry = () => { }; sys.nearProperty = () => true; sys.primaryOf = (c, t) => t;
sys.actorOf = (c, u) => mp.getUserActor(u);
sys.overCap = () => '';
const notices = []; sys.notice = (c, u, t) => notices.push([u, t]);
const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(src) || [])[1] || 'private.housing';
const reset = () => { mp.set(PROPERTY, HP, { owner: 11, ownerName: 'Owner', name: 'Snowpeak House', locked: false, serial: 1, partner: 0, containers: [], issued: [] }); sys.claimed = [PROPERTY]; };
const rec = () => sys.read(ctx, PROPERTY);
const transfer = (a, to) => { sys.lastRequestMs = new Map(); notices.length = 0; sys.onPropertyRequest(ctx, USER[a], { target: PROPERTY, action: 'transfer', recipient: to }); };
const asked = [];
globalThis.__dboPropertyTransferCheck = (ref, to) => { asked.push([ref, to >>> 0]); return (to >>> 0) === OUTSIDER ? 'Only the citizens of Bruma may own property there.' : ''; };

reset();
transfer(OWNER, OUTSIDER);
ok(rec().owner === 11 && notices.some(([, t]) => /citizens of Bruma/.test(t)), 'the owner cannot hand the house to a non-citizen', { rec: rec(), notices });
ok(asked.length === 1 && asked[0][0] === PROPERTY && asked[0][1] === OUTSIDER, 'the gate is asked with the house and the recipient', asked);
transfer(OWNER, CITIZEN);
ok(rec().owner === 21, 'to a citizen it goes', rec());
reset(); asked.length = 0;
transfer(JARL, OUTSIDER);
ok(rec().owner === 31 && asked.length === 0, "the hold's ruler grants it as before, without the gate", { rec: rec(), asked });
reset();
globalThis.__dboPropertyTransferCheck = () => { throw new Error('boom'); };
transfer(OWNER, OUTSIDER);
ok(rec().owner === 31, 'a gate that throws never blocks the hand-over');
delete globalThis.__dboPropertyTransferCheck;
reset();
transfer(OWNER, OUTSIDER);
ok(rec().owner === 31, 'without the gameplay hook nothing is gated');

console.log(fail ? `${fail} FAILED` : 'all checks passed');
process.exit(fail ? 1 : 0);
