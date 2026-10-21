// Scripted test for the admin panel's Skills tab tier buttons and the Players tab mastery grant (Jake, 21 Oct: every tier
// button was one tier off under the skill point system, because it wrote the old hours 0/10/30/70/150 as the level).
// Under the point system a tier button puts the skill at that tier's first level (Novice 1, Apprentice 25, Adept 50,
// Expert 75, Master 90) with no xp, never removes it, settles rank, order, points and marker spells as write() does, and
// says the level in the staff reply. A set that would break the pool or the Seat and Expert limits is refused, because the
// next counted act would take the excess from other skills (applyGain). The grant speaks in levels and stays inside the
// same limits. With the point system off the hours model is unchanged: 0/10/30/70/150 hours, the chosen limit not applied.
// It bundles adminSystem.ts with the real masterySystem.ts (settings, the espm scan, NPC spawns and the ban store stubbed),
// fakes the native server and sends the panel's packets. Run it from skymp5-server with node_modules present:
//
//   node tests/admin-skill-tier-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-skilltier-'));

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
const MIRA = { userId: 6, actorId: 0xff000016, profileId: 16, name: 'Mira' };
const users = new Map();
const props = {};
let packets = [], papyrus = [], logs = [];
const clear = () => { packets = []; papyrus = []; logs = []; };
const copy = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
users.set(SENIOR.userId, SENIOR.actorId); props[SENIOR.actorId] = { appearance: { name: 'Owner' }, profileId: SENIOR.profileId, 'private.discordRoles': [] };
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
  settings: { name: 'test', master: 'http://master.test', masterKey: 'KEY', dataDir: '.', loadOrder: [], allSettings: { masterApiAuthToken: 't', adminProfileIds: [SENIOR.profileId] } },
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
  const act = (content) => {
    clear();
    admin.customPacket(SENIOR.userId, 'adminAction', Object.assign({ customPacketType: 'adminAction' }, content), ctx);
    return packets.filter((x) => x.u === SENIOR.userId && x.p.customPacketType === 'adminActionResult').map((x) => x.p);
  };
  const setTier = (skill, tier) => act({ action: 'masterySetTier', targetName: MIRA.name, skill, tier });
  const grant = (amount) => act({ action: 'masteryGrant', target: MIRA.actorId.toString(16), amount });
  const rec = () => props[MIRA.actorId]['private.mastery'];
  const skill = (id) => (rec() && rec().skills[id]) || null;
  // A v2 record as write() leaves it, with the marker spells of each tier held
  const put = (levels) => {
    if (!levels) { delete props[MIRA.actorId]['private.mastery']; return; }
    const skills = {};
    for (const [id, v] of Object.entries(levels)) {
      const lv = typeof v === 'number' ? v : v.level;
      const rank = Math.max(0, P.tierOfLevel(lv));
      skills[id] = Object.assign({ level: lv, xp: 0, lock: 'raise', rank, lastPointAt: 0, points: lv,
        granted: lv >= 1 ? Array.from({ length: rank + 1 }, (_, i) => markerId(id, i + 1)) : [] }, typeof v === 'number' ? {} : v);
    }
    props[MIRA.actorId]['private.mastery'] = { v: 2, skills, order: Object.keys(skills).filter((k) => skills[k].level >= 1), respecs: 0 };
  };
  const calls = (fn) => papyrus.filter((c) => c.fn === fn && c.self === mp.getDescFromId(MIRA.actorId));
  const spellsAdded = () => calls('AddSpell').map((c) => mp.getIdFromDesc(c.args[0].desc)).sort((a, b) => a - b);
  const spellsRemoved = () => calls('RemoveSpell').map((c) => mp.getIdFromDesc(c.args[0].desc)).sort((a, b) => a - b);
  const smithingAv = () => { const c = calls('SetActorValue').filter((x) => x.args[0] === 'Smithing'); return c.length ? c[c.length - 1].args[1] : undefined; };
  const notices = () => packets.filter((x) => x.u === MIRA.userId && x.p.customPacketType === 'masteryNotice').map((x) => x.p.text);
  const markers = (id, upTo) => Array.from({ length: upTo }, (_, i) => markerId(id, i + 1));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const used = () => Object.values(rec().skills).reduce((n, s) => n + s.level, 0);
  const NAMES = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'];
  const FLOORS = [1, 25, 50, 75, 90];
  // The player log reads the admin log line by this pattern (server playerlog-rules.js, ADMINLOG mastery_tier)
  const PLAYERLOG_TIER = / set \S+ to tier \d+ for /;

  // ════ the point system ON, as live (skills.json pointSystem.enabled) ════
  admin = await boot({ enabled: true, pool: 300, capPerSkill: 100, seatAbove: 90, seatCount: 1, expertAbove: 75, expertCount: 3, transferFloor: 25, waningFloor: 1, waningFloorBySkill: { blacksmith: 0 } });

  // ---- each tier button on a skill never taken up ----
  for (let tier = 0; tier < 5; tier++) {
    put(null);
    const r = setTier('blacksmith', tier);
    const s = skill('blacksmith');
    const what = `point system: ${NAMES[tier]} on a new skill`;
    check(`${what} answers ok`, r.length === 1 && r[0].ok === true, r);
    check(`${what} sets level ${FLOORS[tier]}, the tier's first level, with no xp`, !!s && s.level === FLOORS[tier] && s.xp === 0, s);
    check(`${what} stores rank ${tier}, points = level and a v2 record`, !!s && s.rank === tier && s.points === s.level && rec().v === 2, s && { rank: s.rank, points: s.points, v: rec().v });
    check(`${what} takes the skill up (in the order)`, !!rec() && rec().order.includes('blacksmith'), rec() && rec().order);
    check(`${what} reads back as ${NAMES[tier]} by the tier bands`, !!s && P.tierOfLevel(s.level) === tier, s && s.level);
    check(`${what} grants the marker spells T1..T${tier + 1} and no more`, !!s && same(s.granted.slice().sort((a, b) => a - b), markers('blacksmith', tier + 1)) && same(spellsAdded(), markers('blacksmith', tier + 1)), { granted: s && s.granted, added: spellsAdded() });
    check(`${what} sets Smithing to ${15 * (tier + 1)}`, smithingAv() === 15 * (tier + 1), smithingAv());
    check(`${what} tells the staff member the level it set`, r.length === 1 && new RegExp(`\\b${NAMES[tier]}\\b.*\\blevel ${FLOORS[tier]}\\b`).test(r[0].text), r[0] && r[0].text);
    check(`${what} leaves an admin log line the player log still reads`, logs.length === 1 && PLAYERLOG_TIER.test(logs[0]) && logs[0].startsWith(`profile ${SENIOR.profileId} set blacksmith to tier ${tier} for Mira (profile ${MIRA.profileId})`), logs);
  }

  // ---- down the tiers on one character: Master, Apprentice, Novice ----
  put(null);
  setTier('blacksmith', 4);
  check('point system: Master stores 90, never more than 100 (the old code wrote 150)', skill('blacksmith').level === 90 && skill('blacksmith').points === 90, skill('blacksmith'));
  let r = setTier('blacksmith', 1);
  check('point system: Master to Apprentice sets 25', r[0].ok === true && skill('blacksmith').level === 25 && skill('blacksmith').rank === 1, skill('blacksmith'));
  check('point system: ...revokes the T3, T4 and T5 markers', same(spellsRemoved(), [markerId('blacksmith', 3), markerId('blacksmith', 4), markerId('blacksmith', 5)]) && same(skill('blacksmith').granted.slice().sort(), markers('blacksmith', 2).sort()), { removed: spellsRemoved(), granted: skill('blacksmith').granted });
  check('point system: ...and puts Smithing at 30', smithingAv() === 30, smithingAv());
  r = setTier('blacksmith', 0);
  check('point system: Novice on a held skill sets level 1 and keeps it taken up (never removes it)', r[0].ok === true && skill('blacksmith').level === 1 && rec().order.includes('blacksmith'), rec());
  check('point system: ...with only the T1 marker left', same(skill('blacksmith').granted, [markerId('blacksmith', 1)]) && same(spellsRemoved(), [markerId('blacksmith', 2)]), { granted: skill('blacksmith').granted, removed: spellsRemoved() });

  // ---- xp, offers and waned skills ----
  put({ blacksmith: { level: 62, xp: 70 } });
  setTier('blacksmith', 2);
  check('point system: Adept from 62 with 70 xp sets 50 with no xp', skill('blacksmith').level === 50 && skill('blacksmith').xp === 0, skill('blacksmith'));
  put({ blacksmith: 40, skinner: { level: 0, shadow: 400, offered: true, granted: [] } });
  setTier('skinner', 0);
  check('point system: Novice on a skill with a banked offer takes it up at 1 and clears the bank', skill('skinner').level === 1 && !skill('skinner').shadow && !skill('skinner').offered, skill('skinner'));
  put({ blacksmith: { level: 0, lock: 'lower', granted: [] }, alchemist: 30 });
  setTier('blacksmith', 1);
  check('point system: a skill that waned to 0 comes back set to Raise, as a first touch does', skill('blacksmith').level === 25 && skill('blacksmith').lock === 'raise', skill('blacksmith'));
  put({ blacksmith: { level: 60, lock: 'hold' } });
  setTier('blacksmith', 3);
  check('point system: a held skill keeps its Hold lock', skill('blacksmith').level === 75 && skill('blacksmith').lock === 'hold', skill('blacksmith'));

  // ---- the limits: pool 300, one skill over 90, three over 75 ----
  put({ alchemist: 80, miner: 80, cook: 80, tailor: 40 });
  let before = copy(rec());
  r = setTier('blacksmith', 1);
  check('point system: Apprentice past the 300 pool (280 + 25) is refused', r.length === 1 && r[0].ok === false, r);
  check('point system: ...with a message naming the pool and what it would use', r.length === 1 && /\b300\b/.test(r[0].text) && /\b305\b/.test(r[0].text) && /level 25/.test(r[0].text), r[0] && r[0].text);
  check('point system: ...and the record, spells and actor values untouched', same(rec(), before) && papyrus.length === 0 && logs.length === 0, { rec: rec(), papyrus, logs });
  r = setTier('blacksmith', 0);
  check('point system: Novice inside the pool (281) is allowed', r[0].ok === true && skill('blacksmith').level === 1 && used() === 281, used());
  put({ alchemist: 100, miner: 100, cook: 100, tailor: 30 });
  r = setTier('tailor', 0);
  check('point system: lowering is never refused, even on a record already over the pool', r[0].ok === true && skill('tailor').level === 1, r);
  r = setTier('alchemist', 4);
  check('point system: ...nor a Master set on a skill above 90', r[0].ok === true && skill('alchemist').level === 90, r);
  put({ alchemist: 95, miner: 40 });
  r = setTier('blacksmith', 4);
  check('point system: Master (90) beside a skill at 95 is allowed: 90 is not over 90', r[0].ok === true && skill('blacksmith').level === 90, r);
  const LIMITS = { pool: 300, capPerSkill: 100, seatAbove: 90, seatCount: 1, expertAbove: 75, expertCount: 3, transferFloor: 25, firstTouchCost: 1 };
  const big = Object.assign({}, LIMITS, { pool: 1000 });
  const lim = typeof P.limitBrokenBySet === 'function' ? P.limitBrokenBySet : null;
  check('limit check: skillPoints has limitBrokenBySet', !!lim);
  if (lim) {
    check('limit check: within every limit is null', lim({ a: 50 }, 'b', 50, LIMITS) === null);
    check('limit check: the pool', lim({ a: 90, b: 80, c: 80, d: 40 }, 'e', 25, LIMITS) === 'pool');
    check('limit check: a second skill over 90 is the Seat', lim({ a: 95 }, 'b', 91, big) === 'seat');
    check('limit check: a fourth skill over 75 is the Expert count', lim({ a: 80, b: 80, c: 80 }, 'd', 90, big) === 'expert');
    check('limit check: a skill already over 75 may move within it', lim({ a: 80, b: 80, c: 80, d: 78 }, 'd', 90, big) === null);
    check('limit check: past the per-skill cap', lim({}, 'a', 101, LIMITS) === 'cap');
    check('limit check: a set that does not rise is never refused', lim({ a: 100, b: 100, c: 100, d: 100 }, 'a', 90, LIMITS) === null);
  }
  // Why a set past the pool is refused: the next counted act on any skill takes the excess from another one
  const over = { skills: { smith: { level: 50, xp: 0, lock: 'raise' }, alch: { level: 100, xp: 0, lock: 'raise' }, mine: { level: 100, xp: 0, lock: 'raise' }, cook: { level: 60, xp: 0, lock: 'raise' } } };
  const gain = P.applyGain(over, 'smith', P.unitsForLevel(51) - P.unitsForLevel(50), Object.assign({}, LIMITS, { bucketBurst: 1e9, bucketPerHour: 1e9, dailyCaps: { low: 1e9, expert: 1e9, master: 1e9 }, characterDaily: 1e9 }), Date.parse('2026-10-21T12:00:00Z'));
  check('control: on a record at 310 of 300, one level of work takes levels from another skill', gain.gained === 1 && gain.tookFrom.some((t) => t.id === 'cook' && t.levels >= 1), gain);
  console.log(`     (applyGain took ${JSON.stringify(gain.tookFrom)} for one level of Smith)`);

  // ---- the Players tab grant ----
  put({ blacksmith: 50, alchemist: 30 });
  r = grant(5);
  check('point system grant: +5 on the top skill at 50 sets 55', r[0].ok === true && skill('blacksmith').level === 55, r);
  check('point system grant: ...the staff reply speaks in levels, not hours', /\b55\b/.test(r[0].text) && !/\bh\b|hour/i.test(r[0].text), r[0].text);
  check('point system grant: ...the player is told the level, not hours', notices().some((t) => /level 55/.test(t)) && !notices().some((t) => /hour/i.test(t)), notices());
  check('point system grant: ...the admin log says levels', logs.length === 1 && /granted 5 mastery level\(s\) to Mira \(profile 16\)/.test(logs[0]) && !/\dh\b|hour/.test(logs[0]), logs);
  put({ blacksmith: 98, alchemist: 30 });
  r = grant(5);
  check('point system grant: +5 at 98 stops at 100, never stored past it', r[0].ok === true && skill('blacksmith').level === 100 && skill('blacksmith').points === 100 && skill('blacksmith').xp === 0, skill('blacksmith'));
  put({ blacksmith: 80, alchemist: 80, miner: 80, cook: 50 });
  before = copy(rec());
  r = grant(20);
  check('point system grant: +20 past the 300 pool is refused, record untouched', r[0].ok === false && /\b300\b/.test(r[0].text) && same(rec(), before), { r, rec: rec() });
  put({ blacksmith: 3, alchemist: 2 });
  r = grant(-5);
  check('point system grant: -5 from 3 lets the skill go (level 0, out of the order, markers revoked)', r[0].ok === true && skill('blacksmith').level === 0 && !rec().order.includes('blacksmith') && skill('blacksmith').granted.length === 0, rec());
  r = grant(1001);
  check('point system grant: an amount past 1000 is refused in levels', r[0].ok === false && /Levels must be a whole number/.test(r[0].text), r);

  // ---- the Skills tab detail keeps its shape ----
  put({ blacksmith: 50 });
  clear();
  admin.customPacket(SENIOR.userId, 'adminMasteryRequest', { customPacketType: 'adminMasteryRequest', targetName: MIRA.name }, ctx);
  const detail = packets.filter((x) => x.p.customPacketType === 'adminMastery').map((x) => x.p.detail)[0];
  const row = detail && detail.skills.find((s) => s.id === 'blacksmith');
  check('point system: the Skills tab row shows Adept, level 50 in its hours field', !!row && row.chosen === true && row.rank === 2 && row.hours === 50, row);

  // ════ the point system OFF: the hours model ════
  admin = await boot(undefined);
  const HOURS = [0, 10, 30, 70, 150];
  for (let tier = 0; tier < 5; tier++) {
    props[MIRA.actorId]['private.mastery'] = { skills: {}, order: [], respecs: 0 };
    r = setTier('blacksmith', tier);
    const s = skill('blacksmith');
    const what = `hours model: ${NAMES[tier]}`;
    check(`${what} sets ${HOURS[tier]} hours at rank ${tier}, taken up`, r[0].ok === true && !!s && s.level === HOURS[tier] && s.points === HOURS[tier] && s.rank === tier && rec().order.includes('blacksmith'), s);
    check(`${what} grants the markers T1..T${tier + 1}`, same(s.granted.slice().sort((a, b) => a - b), markers('blacksmith', tier + 1)), s.granted);
    check(`${what} tells the staff member the hours it set`, new RegExp(`\\b${NAMES[tier]}\\b.*\\b${HOURS[tier]} h\\b`).test(r[0].text), r[0].text);
    check(`${what} leaves an admin log line the player log still reads`, logs.length === 1 && logs[0].startsWith(`profile ${SENIOR.profileId} set blacksmith to tier ${tier} for Mira (profile ${MIRA.profileId})`), logs);
  }
  props[MIRA.actorId]['private.mastery'] = { skills: { alchemist: { points: 5 }, miner: { points: 5 }, cook: { points: 5 } }, order: ['alchemist', 'miner', 'cook'], respecs: 0 };
  r = setTier('blacksmith', 2);
  check('hours model: a fourth skill past the 3-skill limit is still allowed for staff', r[0].ok === true && rec().order.length === 4 && skill('blacksmith').level === 30, rec());
  props[MIRA.actorId]['private.mastery'] = { skills: { blacksmith: { points: 30 } }, order: ['blacksmith'], respecs: 0 };
  r = grant(5);
  check('hours model grant: +5 adds 5 hours (35), Adept', r[0].ok === true && skill('blacksmith').level === 35 && skill('blacksmith').rank === 2, skill('blacksmith'));
  check('hours model grant: ...the reply and the player keep the hours wording', r[0].text === 'Mira: 35h, Adept Blacksmith Adept' && notices().includes('Your hours as a Blacksmith now stand at 35.'), { r, n: notices() });
  check('hours model grant: ...the admin log line is unchanged', logs.length === 1 && logs[0] === `profile ${SENIOR.profileId} granted 5 mastery hour(s) to Mira (profile ${MIRA.profileId}), now 35h, Adept Blacksmith Adept`, logs);
  r = grant(1001);
  check('hours model grant: an amount past 1000 is refused in hours', r[0].ok === false && r[0].text === 'Hours must be a whole number between -1000 and 1000', r);

  process.chdir(cwd);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); try { fs.rmSync(out, { recursive: true, force: true }); } catch { } process.exit(1); });
