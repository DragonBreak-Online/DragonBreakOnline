// Scripted test for the F7 NPC Zones tab's add (adminSystem.ts EVENT_GATED_ACTIONS; the Leader for Nat, 2 Nov: a zone
// needs an open /event, which the gameplay's staff gate, server staffguard.js, checks). An add is refused, never let
// through, when the gate is not loaded or throws; the gate's refusal stops it; the gate's '' adds it. Other zone actions
// keep the old rule. Bundles adminSystem.ts with esbuild (settings, NPC spawns, mastery and the ban store stubbed) and
// fakes the native server. Mutants of a copy must fail. Run it from skymp5-server with node_modules present:
//
//   node tests/admin-event-zone-gate-harness.js [adminSystem.ts to test]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const SRC_FILE = path.resolve(process.argv[2] || path.join(root, 'ts', 'systems', 'adminSystem.ts'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-eventzonegate-'));
process.on('exit', () => { try { fs.rmSync(out, { recursive: true, force: true }); } catch (e) { /* the OS */ } });

const stubSources = {
  '../settings': 'module.exports = { Settings: { get: async () => globalThis.__admin.settings } };',
  './npcSpawnSystem': 'module.exports = { NpcSpawnSystem: class {} };',
  './masterySystem': 'module.exports = { MasterySystem: class {}, MAX_GRANT: 0 };',
  './adminBans': 'module.exports = { AdminBans: class { list() { return []; } } };',
};
const stubFilter = new RegExp('^(' + Object.keys(stubSources).map((k) => k.replace(/[./-]/g, '\\$&')).join('|') + ')$');

const LEAD = { userId: 1, actorId: 0xff000021, profileId: 21, roles: ['role-lead'], name: 'Leda' };
const users = new Map([[LEAD.userId, LEAD.actorId]]);
const props = { [LEAD.actorId]: { profileId: LEAD.profileId, 'private.discordRoles': LEAD.roles, appearance: { name: LEAD.name }, locationalData: { cellOrWorldDesc: 'w', pos: [0, 0, 0], rot: [0, 0, 0] } } };
let packets = [];
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
  getIdFromDesc: () => 0,
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Test.esp`,
  callPapyrusFunction: () => {},
};
globalThis.__admin = { settings: { name: 'test', master: '', masterKey: '', allSettings: { adminRoles: { leadgm: ['role-lead'] } } } };
globalThis.__alduinakAdminLog = () => {};

let n = 0;
const build = async (srcText) => {
  const entry = path.join(root, 'ts', 'systems', `.admin-eventzone-${process.pid}-${n++}.ts`);
  fs.writeFileSync(entry, srcText);
  const bundle = path.join(out, `admin-${n}.js`);
  try {
    await esbuild.build({
      entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: stubFilter }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubSources[a.path], loader: 'js' }));
      } }],
    });
  } finally { fs.unlinkSync(entry); }
  return require(bundle).AdminSystem;
};

const checks = async (AdminSystem, check) => {
  const added = [], deleted = [];
  const spawns = { listZones: () => [], addZone: async (z) => { added.push(z.Name); return null; }, deleteZone: async (name) => { deleted.push(name); return true; } };
  const sys = new AdminSystem(() => {}, spawns, { summaryOf: () => null });
  const ctx = { svr: mp, gm: new EventEmitter() };
  await sys.initAsync(ctx);
  const act = async (content) => {
    packets = [];
    sys.customPacket(LEAD.userId, 'adminAction', Object.assign({ customPacketType: 'adminAction' }, content), ctx);
    await new Promise((r) => setImmediate(r));
    return packets.filter((x) => x.p.customPacketType === 'adminActionResult').map((x) => x.p);
  };
  const zone = (Name) => ({ action: 'npcZoneAdd', zone: JSON.stringify({ Name, ID: 'w', POS: [0, 0, 0], NPC: [] }) });

  delete globalThis.__dboAdminGate;
  let r = await act(zone('no-gate'));
  check('without the staff gate an NPC zone is refused, saying why', added.length === 0 && r.length === 1 && r[0].ok === false && /staff rules are not loaded/.test(r[0].text), r);
  r = await act({ action: 'npcZoneDelete', target: 'old-zone' });
  check('...while deleting a zone works as before', deleted.join() === 'old-zone', r);
  globalThis.__dboAdminGate = () => { throw new Error('boom'); };
  r = await act(zone('gate-throws'));
  check('a gate that throws: refused', added.length === 0 && r.length === 1 && r[0].ok === false && /could not be read/.test(r[0].text), r);
  globalThis.__dboAdminGate = (a, action) => (action === 'npcZoneAdd' ? 'NPC zones belong to an event: start one with /event new first.' : '');
  r = await act(zone('no-event'));
  check('the gate\'s refusal stops it, with its text', added.length === 0 && r.length === 1 && r[0].ok === false && /belong to an event/.test(r[0].text), r);
  globalThis.__dboAdminGate = () => '';
  r = await act(zone('with-event'));
  check('the gate\'s yes adds it', added.join() === 'with-event' && r.some((x) => x.ok === true), r);
  delete globalThis.__dboAdminGate;
};

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!ok) failures++; };

(async () => {
  const SRC = fs.readFileSync(SRC_FILE, 'utf8').replace(/\r\n/g, '\n');
  await checks(await build(SRC), check);
  const MUTANTS = [
    ['a missing gate lets the add through', 'if (EVENT_GATED_ACTIONS.has(action) && typeof (globalThis as any).__dboAdminGate !== "function") {', 'if (false) {'],
    ['a throwing gate lets the add through', '      if (EVENT_GATED_ACTIONS.has(action)) return "The staff rules could not be read', '      if (false) return "The staff rules could not be read'],
    ['every zone action is gated', 'const EVENT_GATED_ACTIONS = new Set(["npcZoneAdd"]);', 'const EVENT_GATED_ACTIONS = new Set(["npcZoneAdd", "npcZoneDelete"]);'],
  ];
  for (const [name, from, to] of MUTANTS) {
    if (!SRC.includes(from)) { check(`mutant "${name}": its line is still in adminSystem.ts`, false, from); continue; }
    let bad = 0;
    try { await checks(await build(SRC.replace(from, to)), (_n, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
    check(`mutant caught: ${name}`, bad > 0);
  }
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exitCode = failures ? 1 : 0;
})();
