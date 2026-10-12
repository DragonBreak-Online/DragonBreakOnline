// Trial GM in the fork's AdminSystem (the F7 panel; Nate, 11 Oct): a Trial GM gets the menu (the player list with no
// addresses or hardware ids, the Invisible and Ghost modes, the Debug, Players, Teleport and Modes tabs), TP to a player or a
// location, Rename and the Invisible and Ghost modes (Teleport and Ghost: Nate 12 Oct). Every other panel action is refused
// with a reply, every request but the locations list ignored; a player is ignored as
// before and a GM is unchanged.
//   node tests/trial-gm-panel-harness.js <bundled adminSystem.js>
// A fork without the Trial GM tier has nothing to test, which is said and not failed unless a gate expects it.
'use strict';
const fs = require('fs');
const path = require('path');

const bundle = process.argv[2];
if (!bundle) { console.error('usage: node tests/trial-gm-panel-harness.js <bundled adminSystem.js>'); process.exit(2); }
if (!/sendTrialMenu/.test(fs.readFileSync(bundle, 'utf8'))) { require('./expect')('trial-gm-panel', 'this adminSystem has no Trial GM'); console.log('ok   skipped: this adminSystem has no Trial GM'); process.exit(0); }
const { AdminSystem } = require(path.resolve(bundle));

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? `: got ${JSON.stringify(got).slice(0, 400)}` : ''}`); if (!cond) fails++; };

const TRIAL = 0x21, GM = 0x22, PLAYER = 0x23, BOTH = 0x24;
const users = new Map([[1, TRIAL], [2, GM], [3, PLAYER], [4, BOTH]]);
const A = {
  [TRIAL]: { name: 'Tria', profileId: 9, roles: ['t1'] }, [GM]: { name: 'Gerd', profileId: 6, roles: ['g1'] },
  [PLAYER]: { name: 'Mira', profileId: 8, roles: [] }, [BOTH]: { name: 'Bo', profileId: 10, roles: ['t1', 'g1'] },
};
const props = new Map();
const sent = [], kicks = [], logs = [];
const mp = {
  isConnected: (u) => users.has(u),
  getUserActor: (u) => users.get(u) || 0,
  get: (id, k) => {
    const key = `${id}|${k}`; if (props.has(key)) return props.get(key);
    const a = A[id]; if (!a) return undefined;
    if (k === 'appearance') return { name: a.name }; if (k === 'profileId') return a.profileId; if (k === 'private.discordRoles') return a.roles;
    if (k === 'ff_charTag') return `T${id}`; if (k === 'locationalData') return { cellOrWorldDesc: `cell${id}`, pos: [id, 0, 0], rot: [0, 0, 0] };
    return undefined;
  },
  set: (id, k, v) => props.set(`${id}|${k}`, v),
  setEnabled: () => {},
  getUserIp: (u) => `203.0.113.${u}`,
  getUserGuid: (u) => `guid${u}`,
  getPrometheusMetrics: () => '',
  kick: (u) => kicks.push(u),
  sendCustomPacket: (u, s) => sent.push({ u, p: JSON.parse(s) }),
  destroyActor: () => {},
};
const ctx = { svr: mp };
const mastery = { summaryOf: () => ({ profession: 'smith' }), adminDetail: () => ({ skills: [] }), grantPoints: () => { throw new Error('mastery reached'); } };
const sys = new AdminSystem((...x) => logs.push(x.join(' ')), { listZones: () => [{ name: 'z' }], addZone: () => { throw new Error('zone reached'); } }, mastery);
sys.roleCfg = { tierRoles: { senior: [], developer: [], leadgm: [], gm: ['g1'] }, trialRoles: ['t1'], adminRoleIds: [], adminProfileIds: [] };
sys.bans = { list: () => [{ id: 'b1' }], find: () => null, add: () => { throw new Error('ban reached'); }, remove: () => null };
const adminLogs = [];
sys.adminLog = (t) => adminLogs.push(t);
const settle = () => new Promise((r) => setTimeout(r, 30));
const packet = (u, type, content) => { sent.length = 0; sys.customPacket(u, type, Object.assign({ customPacketType: type }, content || {}), ctx); return sent; };
const result = (out) => (out.find((x) => x.p.customPacketType === 'adminActionResult') || {}).p;

(async () => {
  // The menu
  packet(1, 'adminMenuRequest'); await settle();
  const menu = (sent.find((x) => x.u === 1 && x.p.customPacketType === 'adminMenu') || {}).p;
  ok('a Trial GM gets the menu, as trialgm', menu && menu.tier === 'trialgm', menu && menu.tier);
  ok('...with the trial caps: no ban, no spawn, the tabs and actions they may use', menu && menu.caps.trial === true && menu.caps.ban === false && menu.caps.spawn === false
    && menu.caps.tabs.join() === 'debug,players,teleport,modes' && menu.caps.actions.slice().sort().join() === 'rename,teleportLoc,teleportTo', menu && menu.caps);
  const rows = (menu && menu.players) || [];
  ok('...the player list, everyone online but them', rows.length === 3 && rows.every((r) => r.online && r.n), rows.map((r) => r.n));
  ok('...without addresses, hardware ids, mastery or beast rows', rows.every((r) => r.ip === '' && r.hwid === '' && r.m === undefined && r.b === undefined), rows[0]);
  ok('...only the Invisible and Ghost modes, and no zones, locations, bans or mastery', menu.modes.map((m) => m.id).join() === 'invis,ghost' && menu.npcZones.length === 0
    && menu.locations.length === 0 && menu.bans.length === 0 && menu.mastery === null, menu.modes);

  // What they may do
  let out = packet(1, 'adminAction', { action: 'teleportTo', target: PLAYER.toString(16) });
  ok('TP to a player works', result(out).ok === true && props.get(`${TRIAL}|locationalData`).cellOrWorldDesc === `cell${PLAYER}`, result(out));
  let renamed = null;
  globalThis.__dboAdminRename = (a, t, name) => { renamed = [a, t, name]; return { ok: true, text: 'Renamed' }; };
  out = packet(1, 'adminAction', { action: 'rename', target: PLAYER.toString(16), name: 'Mira Valen' });
  ok('Rename reaches the gameplay\'s rename (which checks staffCan itself)', renamed && renamed[0] === TRIAL && renamed[1] === PLAYER && result(out).ok === true, renamed);
  out = packet(1, 'adminAction', { action: 'toggleMode', mode: 'invis' });
  ok('the Invisible mode goes on, mirrored for neighbours', (props.get(`${TRIAL}|ff_adminModes`) || {}).invis === true && out.some((x) => x.p.customPacketType === 'adminMode' && x.p.on === true), props.get(`${TRIAL}|ff_adminModes`));

  // What they may not
  const before = JSON.stringify([...props.entries()]);
  const refusedActions = ['summon', 'kick', 'ban', 'kill', 'deleteCharacter', 'ipBan', 'tempBan', 'unban', 'masteryGrant', 'masteryReset', 'masterySetTier',
    'masteryDrop', 'giveItem', 'giveSpells', 'giveShouts', 'giveWerewolf', 'giveVampireLord', 'giveDisease', 'setSchool', 'beastForm', 'npcZoneAdd',
    'npcZoneDelete', 'npcZoneReset', 'npcZoneTp'];
  const leaked = [];
  for (const action of refusedActions) {
    out = packet(1, 'adminAction', { action, target: PLAYER.toString(16), targetName: 'Mira', item: '0x0000000f', count: 1000, hours: 2, amount: 5, zone: '{}', mode: 'x' });
    const r = result(out);
    if (!r || r.ok !== false || !/Trial GM/.test(r.text)) leaked.push([action, r]);
  }
  ok('every other panel action is refused with a reply', leaked.length === 0, leaked);
  ok('...and nothing changed, nobody kicked', JSON.stringify([...props.entries()]) === before && kicks.length === 0);
  ok('...and each refusal is in the staff log', adminLogs.filter((t) => /\(trialgm\) was refused/.test(t)).length === refusedActions.length, adminLogs.slice(-2));
  for (const mode of ['god', 'noclip', 'freecam', 'smite', 'healhit']) {
    out = packet(1, 'adminAction', { action: 'toggleMode', mode });
    if (!result(out) || result(out).ok !== false) leaked.push(mode);
  }
  ok('every mode but Invisible and Ghost is refused', leaked.length === 0 && Object.keys(props.get(`${TRIAL}|ff_adminModes`)).filter((k) => props.get(`${TRIAL}|ff_adminModes`)[k]).join() === 'invis', leaked);
  for (const type of ['adminItemsRequest', 'npcZonesRequest', 'adminMasteryRequest']) {
    out = packet(1, type, { targetName: 'Mira' });
    if (out.length) leaked.push([type, out]);
  }
  ok('the item, zone and mastery lists are not sent', leaked.length === 0, leaked);
  out = packet(1, 'adminLocationsRequest', {});
  ok('...but the Teleport tab\'s locations are', out.some((x) => x.p.customPacketType === 'adminLocations' && Array.isArray(x.p.locations)), out.map((x) => x.p.customPacketType));
  out = packet(1, 'adminAction', { action: 'teleportLoc', target: 'Nowhere At All' });
  ok('...and teleportLoc reaches the teleport, not the Trial GM refusal', result(out) && result(out).ok === false && /Unknown location/.test(result(out).text), result(out));
  out = packet(1, 'adminAction', { action: 'toggleMode', mode: 'ghost' });
  ok('the Ghost mode goes on, mirrored for neighbours', (props.get(`${TRIAL}|ff_adminModes`) || {}).ghost === true && out.some((x) => x.p.customPacketType === 'adminMode' && x.p.mode === 'ghost' && x.p.on === true), props.get(`${TRIAL}|ff_adminModes`));

  // Everyone else as before
  packet(3, 'adminMenuRequest'); await settle();
  ok('a player still gets nothing', !sent.some((x) => x.u === 3));
  out = packet(3, 'adminAction', { action: 'teleportTo', target: TRIAL.toString(16) });
  ok('...and cannot teleport', out.length === 0 && !props.has(`${PLAYER}|locationalData`));
  packet(2, 'adminMenuRequest'); await settle();
  const gm = (sent.find((x) => x.u === 2 && x.p.customPacketType === 'adminMenu') || {}).p;
  ok('a GM\'s menu is unchanged: tier gm, addresses, every mode, the bans', gm && gm.tier === 'gm' && !gm.caps.trial && gm.players.some((r) => r.ip) && gm.modes.length === 7 && gm.bans.length === 1, gm && gm.caps);
  out = packet(2, 'adminAction', { action: 'kick', target: PLAYER.toString(16) });
  ok('...and a GM may still kick', result(out).ok === true);
  packet(4, 'adminMenuRequest'); await settle();
  const both = (sent.find((x) => x.u === 4 && x.p.customPacketType === 'adminMenu') || {}).p;
  ok('GM and Trial GM roles together get the GM\'s menu', both && both.tier === 'gm' && !both.caps.trial, both && both.tier);

  // A Trial GM keeps only Invisible at the next login (a GM moved down loses the rest)
  sys.modesByProfile.set(9, { invis: true, ghost: true, god: true, noclip: true });
  sys.resyncModes(mp, 1, TRIAL, true, true);
  ok('at login a Trial GM keeps Invisible and Ghost and loses the other modes', JSON.stringify(sys.modesByProfile.get(9)) === '{"invis":true,"ghost":true}', sys.modesByProfile.get(9));

  // Without the settings key the Trial role is a player's
  sys.roleCfg = { tierRoles: { senior: [], developer: [], leadgm: [], gm: ['g1'] }, trialRoles: [], adminRoleIds: [], adminProfileIds: [] };
  packet(1, 'adminMenuRequest'); await settle();
  out = packet(1, 'adminAction', { action: 'teleportTo', target: GM.toString(16) });
  ok('without adminRoles.trialgm a Trial GM role opens nothing', !sent.some((x) => x.u === 1 && x.p.customPacketType !== 'adminActionResult') && out.length === 0);

  console.log('');
  console.log(fails ? `${fails} FAILURES` : 'all checks passed');
  process.exit(fails ? 1 : 0);
})();
