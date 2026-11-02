// Scripted test for the F7 panel powers a GM gained on 2 Nov (Nat: "empower our lead GMs and GMs"): a temp ban (the
// gameplay's staffguard.js holds it to 72 h and the rank rule), a temp ban by #TAG for an offline player (discipline.js
// __dboPanelTempBan runs /tempban), and small event zones from the NPC Zones tab (staffguard.js gmEventZones). Each needs
// the gameplay's rules loaded and is refused without them; a GM still has no permanent ban, IP ban, unban, spawn or console;
// a Trial GM none of these. It bundles adminSystem.ts with esbuild (settings, NPC spawns, mastery and the ban store stubbed)
// and fakes the native server. Run it from skymp5-server with node_modules present:
//
//   node tests/admin-gm-powers-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-gmpowers-'));

const stubSources = {
  '../settings': 'module.exports = { Settings: { get: async () => globalThis.__admin.settings } };',
  './npcSpawnSystem': 'module.exports = { NpcSpawnSystem: class {} };',
  './masterySystem': 'module.exports = { MasterySystem: class {}, MAX_GRANT: 0 };',
  './adminBans': 'module.exports = { AdminBans: class { list() { return globalThis.__admin.bans; } add(b) { const e = Object.assign({ id: String(globalThis.__admin.bans.length + 1) }, b); globalThis.__admin.bans.push(e); return e; } remove() { return null; } find() { return null; } } };',
};
const stubFilter = new RegExp('^(' + Object.keys(stubSources).map((k) => k.replace(/[./-]/g, '\\$&')).join('|') + ')$');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!ok) failures++; };

const GM = { userId: 1, actorId: 0xff000031, profileId: 31, roles: ['role-gm'], name: 'Gemma' };
const LEAD = { userId: 4, actorId: 0xff000021, profileId: 21, roles: ['role-lead'], name: 'Leda' };
const MIRA = { userId: 2, actorId: 0xff000023, profileId: 23, roles: [], name: 'Mira' };
const TRIAL = { userId: 3, actorId: 0xff000024, profileId: 24, roles: ['role-trial'], name: 'Trina' };

const users = new Map();
const props = {};
let packets = [], logs = [], gateCalls = [], zoneCalls = [];
const clear = () => { packets = []; logs = []; gateCalls = []; zoneCalls = []; };
const addActor = (p) => { users.set(p.userId, p.actorId); props[p.actorId] = { appearance: { name: p.name }, profileId: p.profileId, 'private.discordRoles': p.roles, locationalData: { cellOrWorldDesc: 'w', pos: [p.actorId & 0xff, 0, 0], rot: [0, 0, 0] } }; };
for (const p of [GM, LEAD, MIRA, TRIAL]) addActor(p);
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
  bans: [],
  settings: {
    name: 'test', master: '', masterKey: '',
    allSettings: { adminRoles: { leadgm: ['role-lead'], gm: ['role-gm'], trialgm: ['role-trial'] },
      adminTeleportLocations: [{ name: 'Bruma', cellOrWorldDesc: 'w', pos: [1, 2, 3] }] },
  },
};
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
  const { AdminSystem } = require(path.join(out, 'admin.js'));
  const zones = {
    listZones: () => [],
    addZone: async (z) => { zoneCalls.push(['add', z.Name]); return null; },
    deleteZone: async (n) => { zoneCalls.push(['delete', n]); return true; },
    resetZone: (n) => { zoneCalls.push(['reset', n]); return true; },
  };
  const sys = new AdminSystem(() => {}, zones, { summaryOf: () => null });
  const ctx = { svr: mp, gm: new EventEmitter() };
  await sys.initAsync(ctx);
  const tick = () => new Promise((r) => setTimeout(r, 10));

  const act = async (s, content) => {
    clear();
    sys.customPacket(s.userId, 'adminAction', Object.assign({ customPacketType: 'adminAction' }, content), ctx);
    await tick();
    return packets.filter((x) => x.u === s.userId && x.p.customPacketType === 'adminActionResult').map((x) => x.p);
  };
  let answer = () => '';
  const setGate = () => { globalThis.__dboAdminGate = (a, action, info) => { gateCalls.push({ a: a >>> 0, action, info }); return answer(a, action, info); }; };
  const zone = (Name, n) => JSON.stringify({ Name, ID: 'w', POS: [0, 0, 0], NPC: [{ id: '1:Skyrim.esm', count: n }] });

  // ---- the menu tells the front what a GM may do ----
  clear();
  sys.customPacket(GM.userId, 'adminMenuRequest', { customPacketType: 'adminMenuRequest' }, ctx);
  await tick(); await tick();
  {
    const menu = packets.find((x) => x.u === GM.userId && x.p.customPacketType === 'adminMenu');
    check('a GM\'s menu says temp ban and event zones, no ban, spawn or delete', !!menu && menu.p.caps.tempBan === true && menu.p.caps.eventZones === true && menu.p.caps.ban === false && menu.p.caps.spawn === false && menu.p.caps.del === false, menu && menu.p.caps);
  }

  // ---- without the gameplay rules, a GM's new powers are refused ----
  delete globalThis.__dboAdminGate;
  {
    const r = await act(GM, { action: 'tempBan', target: MIRA.actorId.toString(16), hours: 24 });
    check('without the staff rules a GM\'s temp ban is refused', r.length === 1 && r[0].ok === false && /staff rules are not loaded/.test(r[0].text) && !globalThis.__admin.bans.length, r);
    const z = await act(GM, { action: 'npcZoneAdd', zone: zone('gm-wolves', 2) });
    check('...and a GM\'s event zone', z.length === 1 && z[0].ok === false && /staff rules are not loaded/.test(z[0].text) && !zoneCalls.length, z);
  }

  // ---- with the rules: a GM's temp ban ----
  setGate();
  {
    const r = await act(GM, { action: 'tempBan', target: MIRA.actorId.toString(16), hours: 24 });
    check('a GM temp bans an online player (the gate is asked with the hours)', r.length === 1 && r[0].ok === true && globalThis.__admin.bans.length === 1 && gateCalls.some((g) => g.action === 'tempBan' && g.info.hours === 24 && g.info.target === MIRA.actorId), { r, gateCalls });
    check('...with an admin log line', logs.some((l) => /^profile 31 banned Mira \(profile 23\) for 24h/.test(l)), logs);
    answer = (a, action, info) => (action === 'tempBan' && info.hours > 72 ? 'A GM can temp ban for at most 72 hours (3 days). For longer, ask a Lead GM.' : '');
    const over = await act(GM, { action: 'tempBan', target: MIRA.actorId.toString(16), hours: 73 });
    check('the gate\'s 72 h rule is what refuses a longer one', over.length === 1 && over[0].ok === false && /at most 72 hours/.test(over[0].text) && globalThis.__admin.bans.length === 1, over);
    answer = () => '';
    const ban = await act(GM, { action: 'ban', target: MIRA.actorId.toString(16) });
    check('a GM still has no permanent ban', ban.length === 1 && ban[0].ok === false, ban);
    const ip = await act(GM, { action: 'ipBan', target: MIRA.actorId.toString(16) });
    check('...nor an IP ban', ip.length === 1 && ip[0].ok === false && globalThis.__admin.bans.length === 1, ip);
    const ub = await act(GM, { action: 'unban', target: '1' });
    check('...nor an unban', ub.length === 1 && ub[0].ok === false, ub);
    const give = await act(GM, { action: 'giveItem', item: 'x', count: 1, targetName: 'Mira' });
    check('...nor any spawn action (giveItem)', give.length === 1 && /Lead GM and above/.test(give[0].text), give);
  }

  // ---- offline temp ban by #TAG ----
  {
    const sent = [];
    delete globalThis.__dboPanelTempBan;
    const none = await act(GM, { action: 'tempBan', targetName: '#OFFL', hours: 24, reason: 'griefed the market' });
    check('without discipline.js the offline temp ban is refused', none.length === 1 && none[0].ok === false && /discipline rules are not loaded/.test(none[0].text), none);
    globalThis.__dboPanelTempBan = (a, tag, hours, reason) => { sent.push([a >>> 0, tag, hours, reason]); return ''; };
    const r = await act(GM, { action: 'tempBan', targetName: '#OFFL', hours: 48, reason: 'griefed the market' });
    check('a GM\'s offline temp ban goes to discipline.js with the #TAG, hours and reason', r.length === 1 && r[0].ok === true && sent.length === 1 && sent[0][0] === GM.actorId && sent[0][1] === '#OFFL' && sent[0][2] === 48 && sent[0][3] === 'griefed the market', { r, sent });
    check('...the gate is told it is offline', gateCalls.some((g) => g.action === 'tempBan' && g.info.offline === true && g.info.target === 0), gateCalls);
    check('...and it is logged', logs.some((l) => /^profile 31 \(gm\) asked for a 48h temp ban on offline #OFFL/.test(l)), logs);
    globalThis.__dboPanelTempBan = () => 'Give the player\'s #TAG.';
    const bad = await act(GM, { action: 'tempBan', targetName: '#OFFL', hours: 48, reason: 'x' });
    check('discipline.js\'s refusal is the answer', bad.length === 1 && bad[0].ok === false && /#TAG/.test(bad[0].text), bad);
    answer = (a, action, info) => (action === 'tempBan' && info.offline ? 'Only staff ban players.' : '');
    sent.length = 0;
    globalThis.__dboPanelTempBan = (a, tag) => { sent.push(tag); return ''; };
    const refused = await act(GM, { action: 'tempBan', targetName: '#OFFL', hours: 48, reason: 'griefed the market' });
    check('a gate refusal stops it before discipline.js', refused.length === 1 && refused[0].ok === false && !sent.length, refused);
    answer = () => '';
  }

  // ---- event zones ----
  {
    const z = await act(GM, { action: 'npcZoneAdd', zone: zone('gm-wolves', 3) });
    check('a GM adds an event zone; the gate sees the zone and its name', z.length === 1 && z[0].ok === true && zoneCalls.some((c) => c[0] === 'add' && c[1] === 'gm-wolves')
      && gateCalls.some((g) => g.action === 'npcZoneAdd' && g.info.zoneName === 'gm-wolves' && g.info.zone && g.info.zone.NPC[0].count === 3), { z, gateCalls });
    const d = await act(GM, { action: 'npcZoneDelete', target: 'gm-wolves' });
    check('...deletes one, the gate seeing its name', d.length === 1 && d[0].ok === true && gateCalls.some((g) => g.action === 'npcZoneDelete' && g.info.zoneName === 'gm-wolves'), { d, gateCalls });
    answer = (a, action, info) => (action === 'npcZoneAdd' && info.zone && info.zone.NPC[0].count > 5 ? 'A GM\'s event zone spawns at most 5 NPCs; this one has 6. Ask a Lead GM for more.' : '');
    const big = await act(GM, { action: 'npcZoneAdd', zone: zone('gm-big', 6) });
    check('the gate\'s refusal stops a big one, nothing written', big.length === 1 && big[0].ok === false && /at most 5 NPCs/.test(big[0].text) && !zoneCalls.length, big);
    answer = () => '';
  }

  // ---- a Trial GM gains none of it ----
  {
    const t = await act(TRIAL, { action: 'tempBan', target: MIRA.actorId.toString(16), hours: 1 });
    check('a Trial GM\'s temp ban is refused before the gate (not a Trial GM tool)', !gateCalls.length && logs.some((l) => /\(trialgm\) was refused tempBan \(not a Trial GM tool\)/.test(l)), { t, logs });
    await act(TRIAL, { action: 'npcZoneAdd', zone: zone('trial-wolves', 1) });
    check('...and their event zone', !gateCalls.length && !zoneCalls.length && logs.some((l) => /\(trialgm\) was refused npcZoneAdd/.test(l)), logs);
    await act(TRIAL, { action: 'tempBan', targetName: '#OFFL', hours: 1, reason: 'griefed the market' });
    check('...and an offline temp ban', !gateCalls.length && logs.some((l) => /\(trialgm\) was refused tempBan/.test(l)), logs);
  }

  // ---- the console stays Lead GM and above ----
  {
    clear();
    ctx.gm.emit('userAssignActor', GM.userId);
    ctx.gm.emit('userAssignActor', LEAD.userId);
    check('a GM has no console; a Lead GM has', props[GM.actorId].consoleCommandsAllowed === false && props[LEAD.actorId].consoleCommandsAllowed === true, [props[GM.actorId].consoleCommandsAllowed, props[LEAD.actorId].consoleCommandsAllowed]);
  }

  process.chdir(cwd);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL the harness threw', e); fs.rmSync(out, { recursive: true, force: true }); process.exit(1); });
