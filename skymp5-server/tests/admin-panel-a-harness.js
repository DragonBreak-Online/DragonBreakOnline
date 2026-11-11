// Scripted test for the server half of the admin panel's phase A (Nat, 8 Nov: "i cant even edit individual skills"; the
// staff panel overhaul, _work/admin-panel-1108/DESIGN.md). Three pieces:
// - the Skills detail carries the point system's limits (pool, cap, Seat, Expert and the levels used) for the page's meter;
// - masteryGrant takes a skill and refuses one the character does not hold, where it used to fall back to the first held
//   skill whatever was asked; its admin log line reads as a grant for the player log under points too;
// - adminIdentityRequest gives a profile's masked IP and hardware id to an Owner or a Developer alone (Nat, 8 Nov: senior
//   staff only, every view logged), and logs each view and each refusal.
// It bundles adminSystem.ts with the real masterySystem.ts as admin-skill-level-harness.js does. Run it from skymp5-server
// with node_modules present:
//
//   node tests/admin-panel-a-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-adminpanela-'));

const SKILLS = ['blacksmith', 'alchemist', 'miner', 'cook', 'tailor', 'skinner'];
const markerId = (skill, t) => 0x7000 + SKILLS.indexOf(skill) * 16 + t;
const stubSources = {
  '../settings': 'module.exports = { Settings: { get: async () => globalThis.__admin.settings } };',
  '../scampNative': 'module.exports = {};',
  './npcSpawnSystem': 'module.exports = { NpcSpawnSystem: class {} };',
  './adminBans': 'module.exports = { AdminBans: class { list() { return []; } } };',
  // Marker spells DBO_Skill_<id>_T<n> resolve to 0x7000 + 16 * skill + n; nothing else is in this load order
  './espmEditorIds': `module.exports = { isEditorId: (s) => !s.includes(":"), resolveEditorIds: async (names) => {
    const resolved = new Map();
    for (const n of names) { const m = /^DBO_Skill_(\\w+)_T(\\d)$/.exec(n); const i = m ? ${JSON.stringify(SKILLS)}.indexOf(m[1]) : -1;
      if (i >= 0) resolved.set(n.toLowerCase(), (0x7000 + i * 16 + Number(m[2])).toString(16) + ":Test.esp"); }
    return { resolved, unresolved: [], scannedMs: 0 }; } };`,
};
const stubFilter = new RegExp('^(' + Object.keys(stubSources).map((k) => k.replace(/[./-]/g, '\\$&')).join('|') + ')$');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!ok) failures++; };

const SENIOR = { userId: 1, actorId: 0xff000011, profileId: 11 };
const GM = { userId: 2, actorId: 0xff000012, profileId: 12 };
const MIRA = { userId: 6, actorId: 0xff000016, profileId: 16, name: 'Mira' };
const LEAD = { userId: 3, actorId: 0xff000013, profileId: 13 };
const DEV = { userId: 4, actorId: 0xff000014, profileId: 14 };
const users = new Map();
const props = {};
let packets = [], papyrus = [], logs = [], gateCalls = [];
const clear = () => { packets = []; papyrus = []; logs = []; gateCalls = []; };
const copy = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
users.set(SENIOR.userId, SENIOR.actorId); props[SENIOR.actorId] = { appearance: { name: 'Owner' }, profileId: SENIOR.profileId, 'private.discordRoles': [] };
users.set(GM.userId, GM.actorId); props[GM.actorId] = { appearance: { name: 'Gemma' }, profileId: GM.profileId, 'private.discordRoles': ['role-gm'] };
users.set(LEAD.userId, LEAD.actorId); props[LEAD.actorId] = { appearance: { name: 'Lena' }, profileId: LEAD.profileId, 'private.discordRoles': ['role-lead'] };
users.set(DEV.userId, DEV.actorId); props[DEV.actorId] = { appearance: { name: 'Devi' }, profileId: DEV.profileId, 'private.discordRoles': ['role-dev'] };
users.set(MIRA.userId, MIRA.actorId); props[MIRA.actorId] = { appearance: { name: MIRA.name }, profileId: MIRA.profileId, 'private.discordRoles': [] };
const mp = {
  isConnected: (u) => users.has(u),
  getUserActor: (u) => users.get(u) || 0,
  getUserByActor: (a) => { for (const [u, x] of users) if (x === a) return u; return 65535; },
  // The property store hands out copies, as the native one does
  get: (a, k) => copy((props[a] || {})[k]),
  set: (a, k, v) => { (props[a] = props[a] || {})[k] = copy(v); },
  getUserIp: (u) => `192.0.2.${u}`,
  getUserGuid: (u) => `guid-${u}`,
  getPrometheusMetrics: () => '',
  sendCustomPacket: (u, s) => packets.push({ u, p: JSON.parse(s) }),
  setEnabled: () => {},
  kick: () => {},
  getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Test.esp`,
  lookupEspmRecordById: () => ({ record: null }),
  callPapyrusFunction: (kind, cls, fn, self, args) => { papyrus.push({ fn, self: self && self.desc, args }); },
};
globalThis.__admin = {
  settings: { name: 'test', master: 'http://master.test', masterKey: 'KEY', dataDir: '.', loadOrder: [], allSettings: { masterApiAuthToken: 't', adminProfileIds: [SENIOR.profileId], adminRoles: { gm: ['role-gm'], leadgm: ['role-lead'], developer: ['role-dev'] } } },
};
// The backend's account list: Mira's account and one that is offline
const BACKEND = [
  { profileId: MIRA.profileId, displayName: 'mira-discord', hwid: 'HWID-MIRA-0123456789', lastIp: '203.0.113.9' },
  { profileId: 77, displayName: 'away-discord', hwid: 'HWID-AWAY-9876543210', lastIp: '198.51.100.23' },
];
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ players: BACKEND }) });
globalThis.__alduinakAdminLog = (text) => logs.push(String(text));

const skillsJson = (pointSystem) => JSON.stringify({
  tierHours: [0, 10, 30, 70, 150], tierNames: ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'], maxChosen: 3,
  pointSystem,
  skills: SKILLS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), counts: {}, gates: {}, vanillaSkills: id === 'blacksmith' ? ['Smithing'] : [] })),
});

(async () => {
  fs.writeFileSync(path.join(out, 'entry.ts'), [
    `export { AdminSystem } from ${JSON.stringify(path.join(root, 'ts', 'systems', 'adminSystem'))};`,
    `export { MasterySystem } from ${JSON.stringify(path.join(root, 'ts', 'systems', 'masterySystem'))};`,
    `export * as P from ${JSON.stringify(path.join(root, 'ts', 'systems', 'skillPoints'))};`,
  ].join('\n'));
  await esbuild.build({
    entryPoints: [path.join(out, 'entry.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'admin.js'), logLevel: 'error', external: ['*.node'],
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: stubFilter }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubSources[a.path], loader: 'js' }));
    } }],
  });
  const cwd = process.cwd();
  process.chdir(out);
  const { AdminSystem, MasterySystem, P } = require(path.join(out, 'admin.js'));
  const ctx = { svr: mp, gm: new EventEmitter() };
  const boot = async (pointSystem) => {
    fs.writeFileSync(path.join(out, 'skills.json'), skillsJson(pointSystem));
    const mastery = new MasterySystem(() => {});
    await mastery.initAsync(ctx);
    const admin = new AdminSystem(() => {}, { listZones: () => [] }, mastery);
    await admin.initAsync(ctx);
    return admin;
  };
  let admin = null;
  const actAs = (who, content) => {
    clear();
    admin.customPacket(who.userId, 'adminAction', Object.assign({ customPacketType: 'adminAction' }, content), ctx);
    return packets.filter((x) => x.u === who.userId && x.p.customPacketType === 'adminActionResult').map((x) => x.p);
  };
  const setLevel = (skill, level, who = SENIOR, target = MIRA.name) => actAs(who, Object.assign({ action: 'masterySetLevel', skill, level }, target ? { targetName: target } : {}));
  const rec = (a = MIRA.actorId) => props[a]['private.mastery'];
  const skill = (id, a = MIRA.actorId) => (rec(a) && rec(a).skills[id]) || null;
  // A v2 record as write() leaves it, with the marker spells of each tier held
  const put = (levels, a = MIRA.actorId) => {
    if (!levels) { delete props[a]['private.mastery']; return; }
    const skills = {};
    for (const [id, v] of Object.entries(levels)) {
      const lv = typeof v === 'number' ? v : v.level;
      const rank = Math.max(0, P.tierOfLevel(lv));
      skills[id] = Object.assign({ level: lv, xp: 0, lock: 'raise', rank, lastPointAt: 0, points: lv,
        granted: lv >= 1 ? Array.from({ length: rank + 1 }, (_, i) => markerId(id, i + 1)) : [] }, typeof v === 'number' ? {} : v);
    }
    props[a]['private.mastery'] = { v: 2, skills, order: Object.keys(skills).filter((k) => skills[k].level >= 1), respecs: 0 };
  };
  const calls = (fn) => papyrus.filter((c) => c.fn === fn && c.self === mp.getDescFromId(MIRA.actorId));
  const spellsAdded = () => calls('AddSpell').map((c) => mp.getIdFromDesc(c.args[0].desc)).sort((a, b) => a - b);
  const spellsRemoved = () => calls('RemoveSpell').map((c) => mp.getIdFromDesc(c.args[0].desc)).sort((a, b) => a - b);
  const smithingAv = () => { const c = calls('SetActorValue').filter((x) => x.args[0] === 'Smithing'); return c.length ? c[c.length - 1].args[1] : undefined; };
  const notices = () => packets.filter((x) => x.u === MIRA.userId && x.p.customPacketType === 'masteryNotice').map((x) => x.p.text);
  const detailSent = () => packets.filter((x) => x.u === SENIOR.userId && x.p.customPacketType === 'adminMastery').map((x) => x.p.detail);
  const markers = (id, upTo) => Array.from({ length: upTo }, (_, i) => markerId(id, i + 1));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const one = (r) => r.length === 1 ? r[0] : { ok: null, text: `${r.length} replies` };
  // The player log's admin-line patterns (server playerlog-rules.js ADMINLOG): the level set must read as neither of the others
  const PLAYERLOG_LEVEL = / set \S+ to (?:level|hours) \d+ for /;
  const PLAYERLOG_TIER = / set \S+ to tier \d+ for /;
  const PLAYERLOG_SCHOOL = / set \S+ to \d+ for /;
  const request = (who, type, content) => {
    clear();
    admin.customPacket(who.userId, type, Object.assign({ customPacketType: type }, content), ctx);
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const replies = (who, type) => packets.filter((x) => x.u === who.userId && x.p.customPacketType === type).map((x) => x.p);
  const grant = (amount, skill, who = SENIOR) => actAs(who, Object.assign({ action: 'masteryGrant', target: MIRA.actorId.toString(16), amount }, skill === undefined ? {} : { skill }));
  // The player log's grant pattern (server playerlog-rules.js ADMINLOG mastery_hours), fixed beside this change
  const PLAYERLOG_GRANT = / granted -?\d+ mastery (?:hour|level)/;

  // ════ the point system ON, as live ════
  const POINTS = { enabled: true, pool: 300, capPerSkill: 100, seatAbove: 90, seatCount: 1, expertAbove: 75, expertCount: 3, transferFloor: 25, waningFloor: 1 };
  admin = await boot(POINTS);

  // ---- detail.limits: the Skills page's pool meter and limit warnings ----
  put({ blacksmith: 60, alchemist: 80, cook: 20 });
  request(SENIOR, 'adminMasteryRequest', { targetName: MIRA.name });
  let d = (replies(SENIOR, 'adminMastery')[0] || {}).detail;
  check('limits: the Skills detail carries the point system\'s limits', !!d && !!d.limits, d);
  check('limits: ...pool 300, cap 100, one Seat over 90, three Experts over 75', !!d && !!d.limits && d.limits.pool === 300 && d.limits.capPerSkill === 100 && d.limits.seatAbove === 90 && d.limits.seatCount === 1 && d.limits.expertAbove === 75 && d.limits.expertCount === 3, d && d.limits);
  check('limits: ...and the levels used on the pool (60 + 80 + 20)', !!d && !!d.limits && d.limits.used === 160, d && d.limits);
  check('limits: ...beside every skill with its level, as before', !!d && d.skills.length === SKILLS.length && d.skills.find((s) => s.id === 'alchemist').hours === 80, d && d.skills);
  admin = await boot(Object.assign({}, POINTS, { capPerSkill: 95 }));
  request(SENIOR, 'adminMasteryRequest', { targetName: MIRA.name });
  d = (replies(SENIOR, 'adminMastery')[0] || {}).detail;
  check('limits: a cap of 95 is sent as 95', !!d && !!d.limits && d.limits.capPerSkill === 95, d && d.limits);
  admin = await boot(POINTS);

  // ---- masteryGrant names its skill ----
  put({ blacksmith: 60, alchemist: 30 });
  let r = one(grant(5, 'alchemist'));
  check('grant: 5 levels named to alchemist land on alchemist', r.ok === true && skill('alchemist').level === 35, { r, rec: rec() });
  check('grant: ...and not on the first held skill', skill('blacksmith').level === 60, skill('blacksmith'));
  check('grant: ...one admin log line naming the amount and the target', logs.length === 1 && logs[0].startsWith(`profile ${SENIOR.profileId} granted 5 mastery level(s) to Mira (profile ${MIRA.profileId}), now Alchemist level 35`), logs);
  check('grant: ...which the fixed player-log pattern reads as a grant', logs.length === 1 && PLAYERLOG_GRANT.test(logs[0]), logs);
  r = one(grant(-10, 'alchemist'));
  check('grant: a negative grant takes from the named skill', r.ok === true && skill('alchemist').level === 25 && skill('blacksmith').level === 60, rec());
  check('grant: ...logged with its sign, and still read as a grant', logs.length === 1 && / granted -10 mastery level\(s\) to Mira/.test(logs[0]) && PLAYERLOG_GRANT.test(logs[0]), logs);

  let before = copy(rec());
  r = one(grant(5, 'cook'));
  check('grant: a named skill they do not hold is refused', r.ok === false && /Cook is not taken up/.test(r.text), r);
  check('grant: ...the record and the log untouched (no fallback to the first skill)', same(rec(), before) && logs.length === 0, { rec: rec(), logs });
  put({ blacksmith: 60, alchemist: { level: 0 } });
  before = copy(rec());
  r = one(grant(5, 'alchemist'));
  check('grant: a skill set aside (level 0) counts as not held', r.ok === false && /not taken up/.test(r.text) && same(rec(), before), r);
  r = one(grant(5, 'dragonriding'));
  check('grant: an unknown skill is refused', r.ok === false && /No such skill/.test(r.text) && same(rec(), before), r);
  put({ blacksmith: 60, alchemist: 30 });
  r = one(grant(5));
  check('grant: an older panel names no skill and the first held one takes it, as before', r.ok === true && skill('blacksmith').level === 65 && skill('alchemist').level === 30, rec());
  r = one(grant(5, ''));
  check('grant: ...a blank skill too', r.ok === true && skill('blacksmith').level === 70, rec());
  before = copy(rec());
  r = one(grant(5, 'alchemist', GM));
  check('grant: a GM is still refused (Lead GM and above)', r.ok === false && same(rec(), before), r);

  // ---- hours model: a named grant ----
  admin = await boot(undefined);
  props[MIRA.actorId]['private.mastery'] = { skills: { blacksmith: { points: 10 }, alchemist: { points: 4 } }, order: ['blacksmith', 'alchemist'], respecs: 0 };
  r = one(grant(6, 'alchemist'));
  check('hours model: a named grant adds hours to that skill', r.ok === true && skill('alchemist').level === 10 && skill('blacksmith').level === 10, rec());
  check('hours model: ...logged as hours, read as a grant', logs.length === 1 && / granted 6 mastery hour\(s\) to Mira/.test(logs[0]) && PLAYERLOG_GRANT.test(logs[0]), logs);
  r = one(grant(6, 'cook'));
  check('hours model: a skill not chosen is refused', r.ok === false && /Cook is not taken up/.test(r.text), r);
  request(SENIOR, 'adminMasteryRequest', { targetName: MIRA.name });
  d = (replies(SENIOR, 'adminMastery')[0] || {}).detail;
  check('hours model: limits is null with the point system off', !!d && d.limits === null, d && d.limits);
  admin = await boot(POINTS);

  // ---- IP and HWID on the profile: Owners and Developers only, every view logged ----
  const identityAnywhere = () => packets.filter((x) => x.p.customPacketType === 'adminIdentity');
  const leaks = () => packets.filter((x) => /192\.0\.2|203\.0\.113|198\.51\.100|HWID-|guid-/.test(JSON.stringify(x.p)) && x.u !== SENIOR.userId && x.u !== DEV.userId);
  request(SENIOR, 'adminIdentityRequest', { profile: MIRA.profileId });
  await flush(); await flush();
  let id = replies(SENIOR, 'adminIdentity')[0];
  check('identity: an Owner asking for an online profile gets adminIdentity', !!id && id.profile === MIRA.profileId && id.online === true, packets);
  check('identity: ...the address masked to two octets, as the roster masks it', !!id && id.ip === '192.0.x.x', id);
  check('identity: ...the backend\'s hardware id', !!id && id.hwid === 'HWID-MIRA-0123456789', id);
  check('identity: ...sent to the Owner alone', identityAnywhere().length === 1 && identityAnywhere()[0].u === SENIOR.userId && leaks().length === 0, packets.map((x) => x.u));
  check('identity: ...and logged once, naming the profile and never the address', logs.length === 1 && logs[0] === `profile ${SENIOR.profileId} (senior) viewed the address and hardware id of Mira (profile ${MIRA.profileId})` && !/192\.0|HWID-|guid-/.test(logs[0]), logs);
  // playerlog-rules.js adminLogParse cuts " ip <hex...>" and everything after it, which would take the target with it
  check('identity: ...worded so the player log\'s address cut leaves the target in it', logs.length === 1 && !/ ip [0-9a-f.:\[\]]+/i.test(logs[0]), logs);
  request(DEV, 'adminIdentityRequest', { profile: 77 });
  await flush(); await flush();
  id = replies(DEV, 'adminIdentity')[0];
  check('identity: a Developer asking for an offline profile gets the backend\'s last address, masked', !!id && id.profile === 77 && id.online === false && id.ip === '198.51.x.x' && id.hwid === 'HWID-AWAY-9876543210', id);
  check('identity: ...logged as a view', logs.length === 1 && logs[0].startsWith(`profile ${DEV.profileId} (developer) viewed the address and hardware id of`) && /\(profile 77\)$/.test(logs[0]), logs);
  for (const [who, tier] of [[LEAD, 'leadgm'], [GM, 'gm']]) {
    request(who, 'adminIdentityRequest', { profile: MIRA.profileId });
    await flush(); await flush();
    check(`identity: a ${tier} is refused`, replies(who, 'adminIdentity').length === 0 && replies(who, 'adminActionResult').some((x) => x.ok === false && /Owners and Developers/.test(x.text)), packets);
    check(`identity: ...nothing about the address reaches any client (${tier})`, identityAnywhere().length === 0 && leaks().length === 0, packets);
    check(`identity: ...and the refusal is logged (${tier})`, logs.length === 1 && logs[0] === `profile ${who.profileId} (${tier}) was refused the address and hardware id of profile ${MIRA.profileId} (Owners and Developers only)`, logs);
  }
  request(MIRA, 'adminIdentityRequest', { profile: SENIOR.profileId });
  await flush(); await flush();
  check('identity: a player who is not staff gets nothing', packets.length === 0, packets);
  request(SENIOR, 'adminIdentityRequest', { profile: 999 });
  await flush(); await flush();
  check('identity: a profile neither online nor known is refused, and nothing is logged as viewed', replies(SENIOR, 'adminIdentity').length === 0 && replies(SENIOR, 'adminActionResult').some((x) => x.ok === false) && logs.length === 0, { packets, logs });
  request(SENIOR, 'adminIdentityRequest', { profile: 'abc' });
  await flush();
  check('identity: a profile that is not a number is refused', replies(SENIOR, 'adminIdentity').length === 0 && replies(SENIOR, 'adminActionResult').some((x) => /No such profile/.test(x.text)), packets);

  process.chdir(cwd);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); try { fs.rmSync(out, { recursive: true, force: true }); } catch { } process.exit(1); });
