// Scripted test for the admin panel's per-skill level set, masterySetLevel (Nat, 8 Nov: "i cant even edit individual
// skills"). The panel offered a tier button per skill, which puts a skill at the tier's first level, and a mastery grant
// that only ever reached the character's first held skill. masterySetLevel puts one named skill at an exact level (hours
// with the point system off), within the pool and the Seat and Expert limits a tier set keeps. Under the point system 0
// sets a held skill aside. It is Lead GM and above like every mastery action, is gated by the gameplay's staff rules as
// masterySetTier (the same "skills" target rule, so an older gameplay that does not name it still applies it), and leaves
// an admin log line the player log can tell from a tier set and a school set.
// It bundles adminSystem.ts with the real masterySystem.ts (settings, the espm scan, NPC spawns and the ban store stubbed),
// fakes the native server and sends the panel's packets, as admin-skill-tier-harness.js does. Run it from skymp5-server
// with node_modules present:
//
//   node tests/admin-skill-level-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-skilllevel-'));

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
const users = new Map();
const props = {};
let packets = [], papyrus = [], logs = [], gateCalls = [];
const clear = () => { packets = []; papyrus = []; logs = []; gateCalls = []; };
const copy = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
users.set(SENIOR.userId, SENIOR.actorId); props[SENIOR.actorId] = { appearance: { name: 'Owner' }, profileId: SENIOR.profileId, 'private.discordRoles': [] };
users.set(GM.userId, GM.actorId); props[GM.actorId] = { appearance: { name: 'Gemma' }, profileId: GM.profileId, 'private.discordRoles': ['role-gm'] };
users.set(MIRA.userId, MIRA.actorId); props[MIRA.actorId] = { appearance: { name: MIRA.name }, profileId: MIRA.profileId, 'private.discordRoles': [] };
const mp = {
  isConnected: (u) => users.has(u),
  getUserActor: (u) => users.get(u) || 0,
  getUserByActor: (a) => { for (const [u, x] of users) if (x === a) return u; return 65535; },
  // The property store hands out copies, as the native one does
  get: (a, k) => copy((props[a] || {})[k]),
  set: (a, k, v) => { (props[a] = props[a] || {})[k] = copy(v); },
  getUserIp: (u) => `userip-${u}`,
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
  settings: { name: 'test', master: 'http://master.test', masterKey: 'KEY', dataDir: '.', loadOrder: [], allSettings: { masterApiAuthToken: 't', adminProfileIds: [SENIOR.profileId], adminRoles: { gm: ['role-gm'] } } },
};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ players: [] }) });
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

  // ════ the point system ON, as live ════
  admin = await boot({ enabled: true, pool: 300, capPerSkill: 100, seatAbove: 90, seatCount: 1, expertAbove: 75, expertCount: 3, transferFloor: 25, waningFloor: 1, waningFloorBySkill: { blacksmith: 0 } });

  // ---- a skill never taken up, set to 40 ----
  put({ alchemist: 30 });
  let r = one(setLevel('blacksmith', 40));
  check('point system: level 40 on a new skill answers ok', r.ok === true, r);
  check('point system: ...stores level 40 with no xp, points = level', !!skill('blacksmith') && skill('blacksmith').level === 40 && skill('blacksmith').xp === 0 && skill('blacksmith').points === 40, skill('blacksmith'));
  check('point system: ...at rank 1 (Apprentice, 25 to 49), taken up', !!skill('blacksmith') && skill('blacksmith').rank === 1 && rec().order.includes('blacksmith'), rec());
  check('point system: ...grants the T1 and T2 markers and no more', same(spellsAdded(), markers('blacksmith', 2)), spellsAdded());
  check('point system: ...puts Smithing at 30', smithingAv() === 30, smithingAv());
  check('point system: ...leaves the other skill alone', skill('alchemist').level === 30, skill('alchemist'));
  check('point system: ...tells the staff member the level and tier', /^Mira: Blacksmith set to level 40 \(Apprentice\)$/.test(r.text), r.text);
  check('point system: ...tells the player the level', notices().some((t) => /Blacksmith now stands at level 40/.test(t)), notices());
  check('point system: ...re-sends the Skills tab detail with the new level', detailSent().some((d) => d && d.skills.some((s) => s.id === 'blacksmith' && s.hours === 40 && s.rank === 1)), detailSent());
  check('point system: ...writes one admin log line, as "set blacksmith to level 40 for Mira"', logs.length === 1 && logs[0] === `profile ${SENIOR.profileId} set blacksmith to level 40 for Mira (profile ${MIRA.profileId})`, logs);
  check('point system: ...which the player log reads as a level set, not a tier or a school set', logs.length === 1 && PLAYERLOG_LEVEL.test(logs[0]) && !PLAYERLOG_TIER.test(logs[0]) && !PLAYERLOG_SCHOOL.test(logs[0]), logs);

  // ---- an exact level between tier floors, from a held skill with xp ----
  put({ blacksmith: { level: 62, xp: 70 } });
  r = one(setLevel('blacksmith', 68));
  check('point system: 62 (70 xp) to 68 stores 68 with no xp, Adept', r.ok === true && skill('blacksmith').level === 68 && skill('blacksmith').xp === 0 && skill('blacksmith').rank === 2, skill('blacksmith'));
  r = one(setLevel('blacksmith', 10));
  check('point system: 68 down to 10 is Novice', r.ok === true && skill('blacksmith').level === 10 && skill('blacksmith').rank === 0, skill('blacksmith'));
  check('point system: ...revokes the T2 and T3 markers', same(spellsRemoved(), [markerId('blacksmith', 2), markerId('blacksmith', 3)]) && same(skill('blacksmith').granted, [markerId('blacksmith', 1)]), { removed: spellsRemoved(), granted: skill('blacksmith').granted });
  put({ blacksmith: { level: 60, lock: 'hold' } });
  setLevel('blacksmith', 80);
  check('point system: a held skill keeps its Hold lock', skill('blacksmith').level === 80 && skill('blacksmith').lock === 'hold', skill('blacksmith'));

  // ---- 0: set aside ----
  put({ blacksmith: 50, alchemist: 30 });
  r = one(setLevel('blacksmith', 0));
  check('point system: 0 on a held skill sets it aside (level 0, out of the order, markers revoked)', r.ok === true && skill('blacksmith').level === 0 && !rec().order.includes('blacksmith') && skill('blacksmith').granted.length === 0, rec());
  check('point system: ...and says so to staff and player', /set aside/.test(r.text) && notices().some((t) => /Blacksmith has been set aside/.test(t)), { r, n: notices() });
  check('point system: ...logged as level 0', logs.length === 1 && logs[0] === `profile ${SENIOR.profileId} set blacksmith to level 0 for Mira (profile ${MIRA.profileId})`, logs);
  put({ alchemist: 30 });
  let before = copy(rec());
  r = one(setLevel('blacksmith', 0));
  check('point system: 0 on a skill not taken up is refused, record and log untouched', r.ok === false && /not taken up/.test(r.text) && same(rec(), before) && logs.length === 0, { r, rec: rec(), logs });

  // ---- bad values ----
  put({ blacksmith: 50 });
  before = copy(rec());
  for (const bad of [101, -1, 2.5, 'abc', '', null]) {
    r = one(setLevel('blacksmith', bad));
    check(`point system: level ${JSON.stringify(bad)} is refused with the range, record untouched`, r.ok === false && /0 to 100/.test(r.text) && same(rec(), before) && logs.length === 0, { r, rec: rec() });
  }
  r = one(setLevel('dragonriding', 40));
  check('point system: an unknown skill is refused', r.ok === false && /No such skill/.test(r.text) && same(rec(), before), r);

  // ---- the limits: pool 300, one skill over 90, three over 75 ----
  put({ alchemist: 80, miner: 80, cook: 80, tailor: 40 });
  before = copy(rec());
  r = one(setLevel('blacksmith', 30));
  check('point system: 30 past the 300 pool (280 + 30) is refused, naming the pool and the use', r.ok === false && /\b300\b/.test(r.text) && /\b310\b/.test(r.text), r);
  check('point system: ...record, spells and log untouched', same(rec(), before) && papyrus.length === 0 && logs.length === 0, { rec: rec(), papyrus, logs });
  r = one(setLevel('blacksmith', 20));
  check('point system: 20 inside the pool (300) is allowed', r.ok === true && skill('blacksmith').level === 20, r);
  put({ alchemist: 95, miner: 40 });
  r = one(setLevel('miner', 92));
  check('point system: a second skill over 90 is refused (the Seat)', r.ok === false && /limit of 1 skill over 90/.test(r.text) && skill('miner').level === 40, r);
  put({ alchemist: 100, miner: 100, cook: 100, tailor: 30 });
  r = one(setLevel('tailor', 5));
  check('point system: lowering is never refused, even on a record over the pool', r.ok === true && skill('tailor').level === 5, r);

  // ---- a per-skill cap below 100 ----
  admin = await boot({ enabled: true, pool: 300, capPerSkill: 95, seatAbove: 90, seatCount: 1, expertAbove: 75, expertCount: 3, transferFloor: 25 });
  put({ blacksmith: 50 });
  r = one(setLevel('blacksmith', 96));
  check('point system: past a cap of 95 is refused with that range', r.ok === false && /0 to 95/.test(r.text) && skill('blacksmith').level === 50, r);
  r = one(setLevel('blacksmith', 95));
  check('point system: ...95 itself is allowed', r.ok === true && skill('blacksmith').level === 95, r);

  // ---- the staff member themself, with no target ----
  put({ cook: 20 }, SENIOR.actorId);
  r = one(actAs(SENIOR, { action: 'masterySetLevel', skill: 'cook', level: 33 }));
  check('point system: no target means the staff member themself', r.ok === true && skill('cook', SENIOR.actorId).level === 33, r);
  check('point system: ...logged as "for themself"', logs.length === 1 && logs[0] === `profile ${SENIOR.profileId} set cook to level 33 for themself`, logs);

  // ---- rank: a GM observes, Lead GM and above changes skills ----
  put({ blacksmith: 50 });
  before = copy(rec());
  r = one(setLevel('blacksmith', 70, GM));
  check('rank: a GM is refused as for every mastery action', r.ok === false && /Lead GM and above/.test(r.text) && same(rec(), before), r);
  check('rank: ...and the refusal is logged, the record untouched', logs.length === 1 && /profile 12 \(gm\) was refused masterySetLevel/.test(logs[0]), logs);

  // ---- the gameplay's staff rules see it as a tier set, aimed at the target ----
  globalThis.__dboAdminGate = (a, action, info) => { gateCalls.push({ a, action, target: info && info.target }); return ''; };
  put({ blacksmith: 50 });
  setLevel('blacksmith', 55);
  check('gate: the staff rules are asked about masterySetTier (the skills rule), aimed at Mira', gateCalls.length === 1 && gateCalls[0].action === 'masterySetTier' && gateCalls[0].target === MIRA.actorId && gateCalls[0].a === SENIOR.actorId, gateCalls);
  globalThis.__dboAdminGate = (a, action, info) => { gateCalls.push({ action }); return action === 'masterySetTier' && info.target === MIRA.actorId ? 'Not on a player of your own account.' : ''; };
  before = copy(rec());
  r = one(setLevel('blacksmith', 77));
  check('gate: a refusal by the skills rule refuses the level set, record untouched', r.ok === false && r.text === 'Not on a player of your own account.' && same(rec(), before), { r, rec: rec() });
  check('gate: ...and is logged', logs.length === 1 && /was refused masterySetLevel: Not on a player/.test(logs[0]), logs);
  delete globalThis.__dboAdminGate;

  // ════ the point system OFF: the hours model ════
  admin = await boot(undefined);
  props[MIRA.actorId]['private.mastery'] = { skills: {}, order: [], respecs: 0 };
  r = one(setLevel('blacksmith', 45));
  check('hours model: 45 hours on a new skill is Adept (30 to 69), taken up', r.ok === true && skill('blacksmith').level === 45 && skill('blacksmith').rank === 2 && rec().order.includes('blacksmith'), skill('blacksmith'));
  check('hours model: ...the reply speaks in hours', r.text === 'Mira: Blacksmith set to 45 h (Adept)', r.text);
  check('hours model: ...the player is told the hours', notices().includes('Your hours as a Blacksmith now stand at 45.'), notices());
  check('hours model: ...the admin log says hours, and reads as a level set', logs.length === 1 && logs[0] === `profile ${SENIOR.profileId} set blacksmith to hours 45 for Mira (profile ${MIRA.profileId})` && PLAYERLOG_LEVEL.test(logs[0]) && !PLAYERLOG_SCHOOL.test(logs[0]), logs);
  r = one(setLevel('blacksmith', 0));
  check('hours model: 0 hours keeps the skill, at Novice', r.ok === true && skill('blacksmith').level === 0 && skill('blacksmith').rank === 0 && rec().order.includes('blacksmith'), rec());
  props[MIRA.actorId]['private.mastery'] = { skills: { alchemist: { points: 5 }, miner: { points: 5 }, cook: { points: 5 } }, order: ['alchemist', 'miner', 'cook'], respecs: 0 };
  r = one(setLevel('blacksmith', 200));
  check('hours model: a fourth skill past the 3-skill limit is allowed for staff, at Master', r.ok === true && rec().order.length === 4 && skill('blacksmith').level === 200 && skill('blacksmith').rank === 4, rec());
  r = one(setLevel('blacksmith', 1001));
  check('hours model: past 1000 hours is refused in hours', r.ok === false && r.text === 'Mira: Hours must be a whole number from 0 to 1000', r);

  process.chdir(cwd);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); try { fs.rmSync(out, { recursive: true, force: true }); } catch { } process.exit(1); });
