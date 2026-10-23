// Scripted test for the gameplay's staff gate (server staffguard.js, globalThis.__dboAdminGate; owner's staff review, 23 Oct):
// every F7 panel action after the rank checks is put to the gate with its mode and the online character it is aimed at; a
// refusal is answered with the gate's text and an admin log line, and nothing happens. At each actor assignment the gate
// says whether the profile's modes are cleared (another character, or one that is not a staff character): every mode on
// is sent off and the mirror cleared. The staffChar action marks a staff character through __dboStaffCharSet. Without
// the gate everything works as before. HousingSystem's staff override asks the same gate ('housing'). It bundles
// adminSystem.ts (settings, NPC spawns, mastery and the ban store stubbed) and housingSystem.ts with esbuild and fakes the
// native server. Run it from skymp5-server with node_modules present:
//
//   node tests/admin-staff-gate-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-staffgate-'));

const stubSources = {
  '../settings': 'module.exports = { Settings: { get: async () => globalThis.__admin.settings } };',
  './npcSpawnSystem': 'module.exports = { NpcSpawnSystem: class {} };',
  './masterySystem': 'module.exports = { MasterySystem: class {}, MAX_GRANT: 0 };',
  './adminBans': 'module.exports = { AdminBans: class { list() { return []; } } };',
};
const stubFilter = new RegExp('^(' + Object.keys(stubSources).map((k) => k.replace(/[./-]/g, '\\$&')).join('|') + ')$');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };

const LEAD = { userId: 1, actorId: 0xff000021, profileId: 21, roles: ['role-lead'], name: 'Leda' };
const ALT = { userId: 1, actorId: 0xff000022, profileId: 21, roles: ['role-lead'], name: 'Leda Alt' };
const MIRA = { userId: 2, actorId: 0xff000023, profileId: 23, roles: [], name: 'Mira' };
const TRIAL = { userId: 3, actorId: 0xff000024, profileId: 24, roles: ['role-trial'], name: 'Trina' };

const users = new Map();
const props = {};
let packets = [], logs = [], gateCalls = [];
const clear = () => { packets = []; logs = []; gateCalls = []; };
const addActor = (p) => { users.set(p.userId, p.actorId); props[p.actorId] = { appearance: { name: p.name }, profileId: p.profileId, 'private.discordRoles': p.roles, locationalData: { cellOrWorldDesc: 'w', pos: [p.actorId & 0xff, 0, 0], rot: [0, 0, 0] } }; };
for (const p of [LEAD, MIRA, TRIAL]) addActor(p);
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

globalThis.__admin = {
  settings: {
    name: 'test', master: '', masterKey: '',
    allSettings: { adminRoles: { leadgm: ['role-lead'], trialgm: ['role-trial'] },
      adminTeleportLocations: [{ name: 'Bruma', cellOrWorldDesc: 'w', pos: [1, 2, 3] }] },
  },
};
globalThis.__alduinakAdminLog = (text) => logs.push(String(text));

(async () => {
  const build = (name, file, stubs) => esbuild.build({
    entryPoints: [path.join(root, 'ts', 'systems', file)],
    bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, name), logLevel: 'error',
    plugins: stubs ? [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: stubFilter }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubSources[a.path], loader: 'js' }));
      },
    }] : [],
  });
  await build('admin.js', 'adminSystem.ts', true);
  await build('housing.js', 'housingSystem.ts', false);
  const cwd = process.cwd();
  process.chdir(out);
  const { AdminSystem } = require(path.join(out, 'admin.js'));
  const sys = new AdminSystem(() => {}, { listZones: () => [] }, { summaryOf: () => null });
  const ctx = { svr: mp, gm: new EventEmitter() };
  await sys.initAsync(ctx);

  const act = (s, content) => {
    clear();
    sys.customPacket(s.userId, 'adminAction', Object.assign({ customPacketType: 'adminAction' }, content), ctx);
    return packets.filter((x) => x.u === s.userId && x.p.customPacketType === 'adminActionResult').map((x) => x.p);
  };
  const posOf = (s) => JSON.stringify(props[s.actorId].locationalData.pos);
  let answer = () => '';
  const setGate = () => { globalThis.__dboAdminGate = (a, action, info) => { gateCalls.push({ a: a >>> 0, action, info }); return answer(a, action, info); }; };

  // ---- without the gate, as before ----
  delete globalThis.__dboAdminGate;
  {
    const r = act(LEAD, { action: 'teleportTo', target: MIRA.actorId.toString(16) });
    check('without the gate a Lead GM teleports as before', r.length === 1 && r[0].ok === true && posOf(LEAD) === posOf(MIRA), r);
    props[LEAD.actorId].locationalData = { cellOrWorldDesc: 'w', pos: [0x21, 0, 0], rot: [0, 0, 0] };
  }

  // ---- the gate is asked with the action, the mode and the target ----
  setGate();
  answer = () => '';
  act(LEAD, { action: 'teleportTo', target: MIRA.actorId.toString(16) });
  check('the gate is asked for a teleport, with the staff member and the target actor', gateCalls.length === 1 && gateCalls[0].a === LEAD.actorId && gateCalls[0].action === 'teleportTo' && gateCalls[0].info.target === MIRA.actorId && gateCalls[0].info.trial === false, gateCalls);
  props[LEAD.actorId].locationalData = { cellOrWorldDesc: 'w', pos: [0x21, 0, 0], rot: [0, 0, 0] };
  act(LEAD, { action: 'giveItem', item: 'x', count: 1 });
  check('a grant with no name is aimed at the staff member themself', gateCalls.length === 1 && gateCalls[0].info.target === LEAD.actorId, gateCalls);
  act(LEAD, { action: 'giveItem', item: 'x', count: 1, targetName: 'Mira' });
  check('a grant by name is aimed at that player', gateCalls.length === 1 && gateCalls[0].info.target === MIRA.actorId, gateCalls);
  act(LEAD, { action: 'teleportLoc', target: 'Bruma' });
  check('a teleport to a place names the place and no actor (a place name is never read as an actor id)', gateCalls.length === 1 && gateCalls[0].info.target === 0 && gateCalls[0].info.location === 'Bruma', gateCalls);
  act(LEAD, { action: 'toggleMode', mode: 'invis' });
  check('a mode toggle names the mode', gateCalls.length === 1 && gateCalls[0].action === 'toggleMode' && gateCalls[0].info.mode === 'invis', gateCalls);
  act(LEAD, { action: 'toggleMode', mode: 'invis' });

  // ---- a refusal: the text, an admin log line, and nothing done ----
  answer = (a, action) => (action === 'teleportTo' || action === 'toggleMode' ? 'Staff powers work only on your staff character.' : '');
  {
    const before = posOf(LEAD);
    const r = act(LEAD, { action: 'teleportTo', target: MIRA.actorId.toString(16) });
    check('a refused teleport answers with the gate\'s text', r.length === 1 && r[0].ok === false && r[0].text === 'Staff powers work only on your staff character.', r);
    check('...does not move the staff member', posOf(LEAD) === before, posOf(LEAD));
    check('...and leaves an admin log line', logs.length === 1 && /^profile 21 \(leadgm\) was refused teleportTo: Staff powers work only/.test(logs[0]), logs);
    const m = act(LEAD, { action: 'toggleMode', mode: 'ghost' });
    check('a refused mode stays off, and no mode packet goes out', m.length === 1 && m[0].ok === false && !packets.some((x) => x.p.customPacketType === 'adminMode') && !(props[LEAD.actorId].ff_adminModes || {}).ghost, packets);
  }
  // A Trial GM's own refusals come first; the gate sees what they may ask
  answer = () => '';
  act(TRIAL, { action: 'kill', target: MIRA.actorId.toString(16) });
  check('a Trial GM\'s tool refusal comes before the gate', gateCalls.length === 0 && logs.some((l) => /not a Trial GM tool/.test(l)), { gateCalls, logs });
  act(TRIAL, { action: 'teleportLoc', target: 'Bruma' });
  check('the gate hears that a Trial GM asks', gateCalls.length === 1 && gateCalls[0].info.trial === true, gateCalls);

  // ---- the staffChar action ----
  {
    const seen = [];
    globalThis.__dboStaffCharSet = (a, t, on) => { seen.push([a >>> 0, t >>> 0, on]); return { ok: true, text: 'Mira is now a staff character.' }; };
    const r = act(LEAD, { action: 'staffChar', target: MIRA.actorId.toString(16), on: true });
    check('staffChar marks through __dboStaffCharSet and answers with its text', r.length === 1 && r[0].ok === true && r[0].text === 'Mira is now a staff character.' && seen.length === 1 && seen[0][1] === MIRA.actorId && seen[0][2] === true, { r, seen });
    act(LEAD, { action: 'staffChar', target: MIRA.actorId.toString(16), on: false });
    check('...and unmarks with on: false', seen.length === 2 && seen[1][2] === false, seen);
    delete globalThis.__dboStaffCharSet;
    const r2 = act(LEAD, { action: 'staffChar', target: MIRA.actorId.toString(16) });
    check('...without the gameplay layer it says so', r2.length === 1 && r2[0].ok === false && /gameplay layer/.test(r2[0].text), r2);
  }

  // ---- modes cleared at assignment ----
  answer = () => '';
  act(LEAD, { action: 'toggleMode', mode: 'invis' });
  act(LEAD, { action: 'toggleMode', mode: 'noclip' });
  check('setup: Invisible and NoClip are on', (props[LEAD.actorId].ff_adminModes || {}).invis === true, props[LEAD.actorId].ff_adminModes);
  const assign = (p) => { users.set(p.userId, p.actorId); if (!props[p.actorId]) addActor(p); clear(); ctx.gm.emit('userAssignActor', p.userId); };
  answer = (a, action) => (action === 'assign' ? '' : '');
  assign(LEAD);
  const assignCall = gateCalls.find((g) => g.action === 'assign');
  check('the same character again: the gate hears changed false and the modes stay', !!assignCall && assignCall.info.changed === false && packets.some((x) => x.p.customPacketType === 'adminMode' && x.p.mode === 'invis' && x.p.on === true), { gateCalls, packets });
  answer = (a, action, info) => (action === 'assign' && info.changed ? 'clear' : '');
  assign(ALT);
  const alt = gateCalls.find((g) => g.action === 'assign');
  const offs = packets.filter((x) => x.p.customPacketType === 'adminMode' && x.p.on === false).map((x) => x.p.mode).sort();
  check('another character of the profile: the gate hears changed true', !!alt && alt.info.changed === true && alt.a === ALT.actorId, gateCalls);
  check('...every mode that was on is sent off', offs.join() === 'invis,noclip', offs);
  check('...the new character\'s mirror shows none', !(props[ALT.actorId].ff_adminModes || {}).invis, props[ALT.actorId].ff_adminModes);
  check('...and the clear is logged', logs.some((l) => /^profile 21 had the modes invis, noclip cleared/.test(l)), logs);
  // A cleared profile has nothing on any more, so the staff character coming back keeps it so
  answer = () => '';
  assign(LEAD);
  check('back on the first character, nothing comes back on', !packets.some((x) => x.p.customPacketType === 'adminMode' && x.p.on === true), packets);
  // A player (no tier) is never asked
  assign(MIRA);
  check('a player\'s assignment does not ask the gate', !gateCalls.some((g) => g.action === 'assign'), gateCalls);

  // ---- HousingSystem's staff override asks the gate ----
  {
    const { HousingSystem } = require(path.join(out, 'housing.js'));
    const hs = new HousingSystem(() => {});
    hs.roleCfg = { tierRoles: { senior: [], developer: [], leadgm: ['role-lead'], gm: [] }, trialRoles: [], adminRoleIds: [], adminProfileIds: [] };
    const hctx = { svr: mp };
    delete globalThis.__dboAdminGate;
    check('housing: without the gate a Lead GM overrides as before', hs.isAdmin(hctx, LEAD.actorId) === true && hs.isAdmin(hctx, MIRA.actorId) === false);
    const asked = [];
    globalThis.__dboAdminGate = (a, action) => { asked.push([a >>> 0, action]); return action === 'housing' ? 'Staff powers work only on your staff character.' : ''; };
    check('housing: a refusing gate takes the override away', hs.isAdmin(hctx, LEAD.actorId) === false && asked.length === 1 && asked[0][0] === LEAD.actorId && asked[0][1] === 'housing', asked);
    globalThis.__dboAdminGate = () => '';
    check('housing: an allowing gate keeps it', hs.isAdmin(hctx, LEAD.actorId) === true);
    globalThis.__dboAdminGate = () => { throw new Error('boom'); };
    check('housing: a throwing gate keeps the old rule', hs.isAdmin(hctx, LEAD.actorId) === true);
    check('housing: a player is never asked', (() => { let n = 0; globalThis.__dboAdminGate = () => { n++; return ''; }; hs.isAdmin(hctx, MIRA.actorId); return n === 0; })());
  }

  process.chdir(cwd);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL the harness threw', e); fs.rmSync(out, { recursive: true, force: true }); process.exit(1); });
