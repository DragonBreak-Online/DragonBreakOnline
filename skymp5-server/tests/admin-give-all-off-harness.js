// Scripted test for the admin panel's Give all spells and Give all shouts, turned off for every rank (Jake, 17 Oct: a
// character given all spells made every learned-spell read cost the square of the list, and the server froze). Each rank,
// Senior, Developer, Lead GM, GM and Trial GM, asks for both on itself, on a player by name and on a player by actor id:
// every request is refused with the turned-off message and an admin log line, no spell is added, no shout lesson is sent
// and the all-shouts flag is not set. The other grants keep working: the werewolf and Vampire Lord powers (one spell each,
// Lead GM and above), a spell tome from the Items tab, and the login lesson of a character given all shouts before.
// It bundles adminSystem.ts with esbuild (settings, NPC spawns, mastery and the ban store stubbed) and fakes the native
// server. Run it from skymp5-server with node_modules present:
//
//   node tests/admin-give-all-off-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-giveall-'));

const stubSources = {
  '../settings': 'module.exports = { Settings: { get: async () => globalThis.__admin.settings } };',
  './npcSpawnSystem': 'module.exports = { NpcSpawnSystem: class {} };',
  './masterySystem': 'module.exports = { MasterySystem: class {}, MAX_GRANT: 0 };',
  './adminBans': 'module.exports = { AdminBans: class { list() { return []; } } };',
};
const stubFilter = new RegExp('^(' + Object.keys(stubSources).map((k) => k.replace(/[./-]/g, '\\$&')).join('|') + ')$');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };

// One staff member per rank (the owner by profile id, the rest by role) and one player
const STAFF = [
  { tier: 'senior', userId: 1, actorId: 0xff000011, profileId: 11, roles: [] },
  { tier: 'developer', userId: 2, actorId: 0xff000012, profileId: 12, roles: ['role-dev'] },
  { tier: 'leadgm', userId: 3, actorId: 0xff000013, profileId: 13, roles: ['role-lead'] },
  { tier: 'gm', userId: 4, actorId: 0xff000014, profileId: 14, roles: ['role-gm'] },
  { tier: 'trialgm', userId: 5, actorId: 0xff000015, profileId: 15, roles: ['role-trial'] },
];
const MIRA = { userId: 6, actorId: 0xff000016, profileId: 16, name: 'Mira' };
const HOLDER = { userId: 7, actorId: 0xff000017, profileId: 17, name: 'Holder' };
const POWERS = {
  spells: [['1001:Test.esp', 'SpellOne'], ['1002:Test.esp', 'SpellTwo'], ['1003:Test.esp', 'SpellThree']],
  shouts: [{ shout: '2001:Test.esp', name: 'ShoutOne', words: ['a:Test.esp', 'b:Test.esp', 'c:Test.esp'] }],
  werewolf: '92c48:Skyrim.esm',
  vampirelord: '283b:Dawnguard.esm',
};
const TOME = '3001:Test.esp';

const users = new Map();
const props = {};
let packets = [], papyrus = [], logs = [];
const clear = () => { packets = []; papyrus = []; logs = []; };
const addActor = (userId, actorId, p) => { users.set(userId, actorId); props[actorId] = p; };
for (const s of STAFF) addActor(s.userId, s.actorId, { appearance: { name: `Staff ${s.tier}` }, profileId: s.profileId, 'private.discordRoles': s.roles });
addActor(MIRA.userId, MIRA.actorId, { appearance: { name: MIRA.name }, profileId: MIRA.profileId, 'private.discordRoles': [] });
const mp = {
  isConnected: (u) => users.has(u),
  getUserActor: (u) => users.get(u) || 0,
  get: (a, k) => (props[a] || {})[k],
  set: (a, k, v) => { (props[a] = props[a] || {})[k] = v; },
  getUserIp: (u) => `userip-${u}`,
  getUserGuid: (u) => `guid-${u}`,
  getPrometheusMetrics: () => '',
  sendCustomPacket: (u, s) => packets.push({ u, p: JSON.parse(s) }),
  setEnabled: () => {},
  kick: () => {},
  getIdFromDesc: (d) => (d === TOME ? 0x3001 : 0),
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Test.esp`,
  callPapyrusFunction: (kind, cls, fn, self, args) => { papyrus.push({ fn, self: self && self.desc, spell: args && args[0] && args[0].desc }); },
};

globalThis.__admin = {
  settings: {
    name: 'test', master: 'http://master.test', masterKey: 'KEY',
    allSettings: { masterApiAuthToken: 't', adminProfileIds: [11], adminRoles: { developer: ['role-dev'], leadgm: ['role-lead'], gm: ['role-gm'], trialgm: ['role-trial'] } },
  },
};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ players: [] }) });
globalThis.__alduinakAdminLog = (text) => logs.push(String(text));

(async () => {
  await esbuild.build({
    entryPoints: [path.join(root, 'ts', 'systems', 'adminSystem.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'admin.js'), logLevel: 'error',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: stubFilter }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubSources[a.path], loader: 'js' }));
      },
    }],
  });
  const cwd = process.cwd();
  process.chdir(out);
  fs.writeFileSync(path.join(out, 'admin-powers.json'), JSON.stringify(POWERS));
  const { AdminSystem } = require(path.join(out, 'admin.js'));
  const sys = new AdminSystem(() => {}, { listZones: () => [] }, { summaryOf: () => null });
  const ctx = { svr: mp, gm: new EventEmitter() };
  await sys.initAsync(ctx);

  const act = (s, content) => {
    clear();
    sys.customPacket(s.userId, 'adminAction', Object.assign({ customPacketType: 'adminAction' }, content), ctx);
    return packets.filter((x) => x.u === s.userId && x.p.customPacketType === 'adminActionResult').map((x) => x.p);
  };
  const noShoutFlag = () => [MIRA, ...STAFF].every((x) => props[x.actorId]['private.dboAllShouts'] === undefined);

  // ---- Give all spells and Give all shouts: refused for every rank, on any target ----
  const WANT = { giveSpells: /^Give all spells is turned off: it froze the server\./, giveShouts: /^Give all shouts is turned off/ };
  for (const s of STAFF) {
    for (const action of ['giveSpells', 'giveShouts']) {
      for (const [label, target] of [['itself', {}], ['a player by name', { targetName: 'Mira' }], ['a player by actor id', { target: MIRA.actorId.toString(16) }]]) {
        const r = act(s, Object.assign({ action }, target));
        const what = `${s.tier}: ${action} on ${label}`;
        check(`${what} is refused with the turned-off message`, r.length === 1 && r[0].ok === false && WANT[action].test(r[0].text), r);
        check(`${what} adds no spell`, papyrus.length === 0, papyrus);
        check(`${what} sends no shout lesson and sets no all-shouts flag`, !packets.some((x) => x.p.customPacketType === 'dboTeachShouts') && noShoutFlag(), packets.map((x) => x.p.customPacketType));
        check(`${what} leaves an admin log line naming the rank`, logs.length === 1 && logs[0] === `profile ${s.profileId} (${s.tier}) was refused ${action} (turned off)`, logs);
      }
    }
  }

  // ---- a player who is not staff is still ignored silently ----
  {
    const r = act(MIRA, { action: 'giveSpells' });
    check('a player who is not staff gets no answer and no spell', r.length === 0 && packets.length === 0 && papyrus.length === 0 && logs.length === 0, { r, papyrus, logs });
  }

  // ---- the werewolf and Vampire Lord powers still work, one spell each, for Lead GM and above ----
  for (const s of STAFF.filter((x) => ['senior', 'developer', 'leadgm'].includes(x.tier))) {
    for (const [action, desc, grant, form] of [['giveWerewolf', POWERS.werewolf, 'private.werewolfGrant', 'werewolf beast form'], ['giveVampireLord', POWERS.vampirelord, 'private.vampireLordGrant', 'Vampire Lord form']]) {
      delete props[MIRA.actorId][grant];
      const r = act(s, { action, targetName: 'Mira' });
      check(`${s.tier}: ${action} still grants the one power`, r.length === 1 && r[0].ok === true && r[0].text === `Mira can now take ${form}`, r);
      check(`${s.tier}: ...by one AddSpell on that player`, papyrus.length === 1 && papyrus[0].fn === 'AddSpell' && papyrus[0].spell === desc && papyrus[0].self === mp.getDescFromId(MIRA.actorId), papyrus);
      check(`${s.tier}: ...with the grant kept on the character and logged`, props[MIRA.actorId][grant] === true && logs.length === 1 && logs[0] === `profile ${s.profileId} gave ${form} to Mira (profile ${MIRA.profileId})`, logs);
    }
  }
  {
    const gm = STAFF.find((x) => x.tier === 'gm'), trial = STAFF.find((x) => x.tier === 'trialgm');
    const r1 = act(gm, { action: 'giveWerewolf', targetName: 'Mira' });
    check('a GM is still refused the werewolf power (Lead GM and above)', r1.length === 1 && r1[0].ok === false && r1[0].text === 'That is for a Lead GM and above' && papyrus.length === 0, r1);
    const r2 = act(trial, { action: 'giveVampireLord', targetName: 'Mira' });
    check('a Trial GM is still refused the Vampire Lord power', r2.length === 1 && r2[0].ok === false && r2[0].text === "That is not one of a Trial GM's tools" && papyrus.length === 0, r2);
  }

  // ---- a single spell tome from the Items tab still works ----
  {
    const lead = STAFF.find((x) => x.tier === 'leadgm');
    const r = act(lead, { action: 'giveItem', item: TOME, count: 1, targetName: 'Mira' });
    const inv = (props[MIRA.actorId].inventory || {}).entries || [];
    check('a Lead GM can still give one spell tome', r.length === 1 && r[0].ok === true && inv.some((e) => e.baseId === 0x3001 && e.count === 1) && papyrus.length === 0, { r, inv });
  }

  // ---- a character given all shouts before keeps the lesson at login ----
  {
    const timers = [];
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn, ms, ...a) => (ms === 15000 ? (timers.push(fn), 0) : realSetTimeout(fn, ms, ...a));
    addActor(HOLDER.userId, HOLDER.actorId, { appearance: { name: HOLDER.name }, profileId: HOLDER.profileId, 'private.discordRoles': [], 'private.dboAllShouts': true });
    clear();
    ctx.gm.emit('userAssignActor', HOLDER.userId, HOLDER.actorId);
    timers.splice(0).forEach((fn) => fn());
    global.setTimeout = realSetTimeout;
    const lesson = packets.find((x) => x.u === HOLDER.userId && x.p.customPacketType === 'dboTeachShouts');
    check('a character given all shouts before is still taught them at login', !!lesson && lesson.p.shouts.length === 1 && lesson.p.shouts[0].shout === POWERS.shouts[0].shout, packets.map((x) => x.p.customPacketType));
  }

  process.chdir(cwd);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL the harness threw', e); fs.rmSync(out, { recursive: true, force: true }); process.exit(1); });
