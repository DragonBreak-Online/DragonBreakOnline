// The admin panel's One spell (the Leader, 1 Nov): giveSpell and removeSpell, Lead GM and above, handed to the gamemode's
// __dboStaffSpell (server staffitemspells.js), which applies /givespell and /removespell's own rules and answers { ok, text }.
// Checks the action reaches it with the panel's spell, reason and force, for the player named; its answer goes back as the
// panel's result, logged only when it took; a GM and a Trial GM are refused before it; a missing or throwing hook is said.
// Bundles adminSystem.ts with esbuild (settings, NPC spawns, mastery and the ban store stubbed) and fakes the native server;
// the mutants at the end are bundled from altered copies of the source (never the tracked file). From skymp5-server:
//
//   node tests/admin-one-spell-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const SOURCE = path.join(root, 'ts', 'systems', 'adminSystem.ts');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-onespell-'));

const stubSources = {
  '../settings': 'module.exports = { Settings: { get: async () => globalThis.__admin.settings } };',
  './npcSpawnSystem': 'module.exports = { NpcSpawnSystem: class {} };',
  './masterySystem': 'module.exports = { MasterySystem: class {}, MAX_GRANT: 0 };',
  './adminBans': 'module.exports = { AdminBans: class { list() { return []; } } };',
};
const stubFilter = new RegExp('^(' + Object.keys(stubSources).map((k) => k.replace(/[./-]/g, '\\$&')).join('|') + ')$');

const STAFF = {
  lead: { tier: 'leadgm', userId: 3, actorId: 0xff000013, profileId: 13, roles: ['role-lead'] },
  gm: { tier: 'gm', userId: 4, actorId: 0xff000014, profileId: 14, roles: ['role-gm'] },
  trial: { tier: 'trialgm', userId: 5, actorId: 0xff000015, profileId: 15, roles: ['role-trial'] },
};
const MIRA = { userId: 6, actorId: 0xff000016, profileId: 16, name: 'Mira' };

globalThis.__admin = {
  settings: {
    name: 'test', master: 'http://master.test', masterKey: 'KEY',
    allSettings: { masterApiAuthToken: 't', adminProfileIds: [11], adminRoles: { leadgm: ['role-lead'], gm: ['role-gm'], trialgm: ['role-trial'] } },
  },
};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ players: [] }) });

// One run of every check on a build of `source`; returns the number of failures (quiet: print only the count)
const run = async (source, label, quiet) => {
  let failures = 0;
  const check = (name, ok, got) => { if (!quiet) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };
  const users = new Map(); const props = {};
  let packets = [], logs = [];
  const add = (u, a, p) => { users.set(u, a); props[a] = p; };
  for (const s of Object.values(STAFF)) add(s.userId, s.actorId, { appearance: { name: `Staff ${s.tier}` }, profileId: s.profileId, 'private.discordRoles': s.roles });
  add(MIRA.userId, MIRA.actorId, { appearance: { name: MIRA.name }, profileId: MIRA.profileId, 'private.discordRoles': [] });
  const mp = {
    isConnected: (u) => users.has(u), getUserActor: (u) => users.get(u) || 0,
    get: (a, k) => (props[a] || {})[k], set: (a, k, v) => { (props[a] = props[a] || {})[k] = v; },
    getUserIp: (u) => `ip-${u}`, getUserGuid: (u) => `guid-${u}`, getPrometheusMetrics: () => '',
    sendCustomPacket: (u, s) => packets.push({ u, p: JSON.parse(s) }), setEnabled: () => {}, kick: () => {},
    getIdFromDesc: () => 0, getDescFromId: (id) => `${(id >>> 0).toString(16)}:Test.esp`, callPapyrusFunction: () => {},
  };
  globalThis.__alduinakAdminLog = (t) => logs.push(String(t));
  const file = path.join(out, `${label}.js`);
  await esbuild.build({
    entryPoints: [SOURCE], bundle: true, platform: 'node', format: 'cjs', outfile: file, logLevel: 'error',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: stubFilter }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubSources[a.path], loader: 'js' }));
        b.onLoad({ filter: /adminSystem\.ts$/ }, () => ({ contents: source, loader: 'ts', resolveDir: path.dirname(SOURCE) }));
      },
    }],
  });
  const { AdminSystem } = require(file);
  const sys = new AdminSystem(() => {}, { listZones: () => [] }, { summaryOf: () => null });
  const ctx = { svr: mp, gm: new EventEmitter() };
  await sys.initAsync(ctx);
  const calls = [];
  let answer = { ok: true, text: "Granted spell 'Flames' to Mira." };
  globalThis.__dboStaffSpell = (...a) => { calls.push(a); if (answer instanceof Error) throw answer; return answer; };
  const act = (s, content) => {
    packets = []; logs = []; calls.length = 0;
    sys.customPacket(s.userId, 'adminAction', Object.assign({ customPacketType: 'adminAction' }, content), ctx);
    return packets.filter((x) => x.u === s.userId && x.p.customPacketType === 'adminActionResult').map((x) => x.p);
  };

  let r = act(STAFF.lead, { action: 'giveSpell', targetName: 'Mira', spell: 'Flames', reason: 'lost in the crash', force: true });
  check('a Lead GM\'s giveSpell reaches the gamemode with the player, "give", the spell, the reason and force', calls.length === 1
    && JSON.stringify(calls[0]) === JSON.stringify([STAFF.lead.actorId, MIRA.actorId, 'give', 'Flames', 'lost in the crash', true]), calls);
  check('...its answer is the panel\'s result', r.length === 1 && r[0].ok === true && r[0].text === "Granted spell 'Flames' to Mira.", r);
  check('...and the admin log says what was given to whom', logs.length === 1 && /^profile 13 gave the spell Flames to Mira \(profile 16\)$/.test(logs[0]), logs);
  answer = { ok: true, text: "Removed spell 'Flames' from Mira." };
  r = act(STAFF.lead, { action: 'removeSpell', targetName: 'Mira', spell: 'Flames', reason: 'given twice' });
  check('removeSpell is "remove", force false when the panel sends none', calls.length === 1 && calls[0][2] === 'remove' && calls[0][5] === false && r[0].ok === true, calls);
  check('...logged as taken', logs.length === 1 && /^profile 13 took the spell Flames from Mira \(profile 16\)$/.test(logs[0]), logs);
  answer = { ok: false, text: 'Give a short reason: end the command with reason: <why>' };
  r = act(STAFF.lead, { action: 'giveSpell', targetName: 'Mira', spell: 'Flames', reason: '' });
  check('the gamemode\'s refusal (no reason) is the panel\'s, and nothing is logged', r.length === 1 && r[0].ok === false && /^Give a short reason/.test(r[0].text) && !logs.length, { r, logs });
  r = act(STAFF.gm, { action: 'giveSpell', targetName: 'Mira', spell: 'Flames', reason: 'x' });
  check('a GM is refused before the gamemode is asked (Lead GM and above)', r.length === 1 && r[0].ok === false && r[0].text === 'That is for a Lead GM and above' && !calls.length, r);
  r = act(STAFF.trial, { action: 'removeSpell', targetName: 'Mira', spell: 'Flames', reason: 'x' });
  check('a Trial GM too', r.length === 1 && r[0].ok === false && !calls.length, r);
  r = act(STAFF.lead, { action: 'giveSpell', targetName: 'Nobody', spell: 'Flames', reason: 'x' });
  check('no such player online: said, the gamemode not asked', r.length === 1 && r[0].ok === false && /No online player/.test(r[0].text) && !calls.length, r);
  answer = new Error('boom');
  r = act(STAFF.lead, { action: 'giveSpell', targetName: 'Mira', spell: 'Flames', reason: 'x' });
  check('a hook that throws is said, not passed off as done', r.length === 1 && r[0].ok === false && /did not work/.test(r[0].text) && !logs.some((l) => / gave /.test(l)), { r, logs });
  delete globalThis.__dboStaffSpell;
  r = act(STAFF.lead, { action: 'giveSpell', targetName: 'Mira', spell: 'Flames', reason: 'x' });
  check('a server without the gamemode hook says so', r.length === 1 && r[0].ok === false && /no panel spells/.test(r[0].text), r);
  return failures;
};

const MUTANTS = [
  ['a GM may give a spell', ',\n  "giveSpell", "removeSpell"]);', ']);'],
  ['removeSpell gives', 'action === "giveSpell" ? "give" : "remove"', '"give"'],
  ['force is dropped', 'content["force"] === true', 'false'],
  ['the reason is dropped', 'String(content["spell"] ?? ""), String(content["reason"] ?? "")', 'String(content["spell"] ?? ""), ""'],
  ['a refusal is logged as done', '        if (ok) this.adminLog(`profile ${adminProfile} ${action === "giveSpell"', '        this.adminLog(`profile ${adminProfile} ${action === "giveSpell"'],
];

(async () => {
  const cwd = process.cwd();
  process.chdir(out);
  const src = fs.readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
  let failures = await run(src, 'base', false);
  for (const [i, [name, from, to]] of MUTANTS.entries()) {
    if (!src.includes(from)) { console.log(`FAIL mutant "${name}": its line is still in adminSystem.ts`); failures++; continue; }
    const caught = (await run(src.replace(from, to), `m${i}`, true)) > 0;
    console.log(`${caught ? 'ok  ' : 'FAIL'} mutant caught: ${name}`);
    if (!caught) failures++;
  }
  process.chdir(cwd);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL the harness threw', e); fs.rmSync(out, { recursive: true, force: true }); process.exit(1); });
