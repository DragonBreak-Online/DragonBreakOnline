// Scripted test for the F7 Thievery tab in server\thievery.js (dbo:staffThievery, staffData widget 162) with a mock gamemode
// api: who sees it, that every button checks its tier as the matching command does (Lead GM for factions and fences, GMs for
// raids, permits and sending back), that the tab and the commands run one action and give one answer, and what the tab
// shows: factions and candidates, fences, open raids, the stolen ledger, permits, live breaches and break-ins.
//   node tests/thievery-panel-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MOD = path.resolve(__dirname, '..', 'thievery.js');
process.chdir(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'thievery-panel-harness-')));
fs.writeFileSync('artifacts.json', JSON.stringify({ patterns: ['^DBO_Artifact'] }));
fs.writeFileSync('guild-defs.json', JSON.stringify({ factions: [{ id: 'thieves-guild', name: 'Thieves Guild' }, { id: 'dark-brotherhood', name: 'Dark Brotherhood' }] }));

let now = Date.UTC(2026, 9, 21, 12, 0);
Date.now = () => now;
let fails = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined && !ok ? `   ${JSON.stringify(detail).slice(0, 300)}` : ''}`); if (!ok) fails++; };

const BREAD = 0x65c9f, SWORD = 0x1397e;
const items = { [BREAD]: ['ALCH', 'Bread'], [SWORD]: ['WEAP', 'IronSword'], 0x9001: ['DOOR', 'DoorBase'], 0x9002: ['CONT', 'ChestBase'] };
const DOOR = 0x500, HALLCHEST = 0x700;
const TRIAL = 80, GM = 71, LEAD = 70, GUARD = 60, THIEF = 101, OWNER = 11;
const props = new Map();
const get = (id, p) => props.get(`${id}|${p}`);
const set = (id, p, v) => props.set(`${id}|${p}`, v);
set(DOOR, 'baseDesc', 'door'); set(DOOR, 'worldOrCellDesc', 'tamriel'); set(DOOR, 'pos', [0, 0, 0]);
set(HALLCHEST, 'baseDesc', 'chest'); set(HALLCHEST, 'worldOrCellDesc', 'cistern'); set(HALLCHEST, 'inventory', { entries: [] });
set(THIEF, 'inventory', { entries: [{ baseId: SWORD, count: 1 }] }); set(OWNER, 'inventory', { entries: [] });
set(GUARD, 'private.dboLawful', true);
const mp = {
  get, set, getDescFromId: (id) => `${id.toString(16)}:Skyrim.esm`, getIdFromDesc: (d) => (d === 'door' ? 0x9001 : d === 'chest' ? 0x9002 : parseInt(d, 16)),
  lookupEspmRecordById: () => null, callPapyrusFunction: () => false,
};
const recs = { [DOOR]: { owner: 11, ownerChar: OWNER, ownerName: 'Lydia', name: 'Lydia\'s house', locked: true } };
globalThis.__dboHousing = { primaryOf: (r) => (recs[r] ? r : 0), recordOf: (r) => recs[r] || null, ownsRecord: (rec, a) => rec.ownerChar === a, keyOpens: () => false, isManager: () => false, ownerActorsOf: () => [OWNER] };
globalThis.__dboGuildsOf = (a) => (a === THIEF ? [{ id: 'thieves-guild' }] : []);
globalThis.__dboGuildExists = (id) => id === 'thieves-guild' || id === 'dark-brotherhood';
globalThis.__dboGuildInfo = (id) => ({ name: { 'thieves-guild': 'Thieves Guild', 'dark-brotherhood': 'Dark Brotherhood' }[id] || id });
globalThis.__dboGuildHall = () => null;

let online = [TRIAL, GM, LEAD, GUARD, THIEF, OWNER];
const widgets = []; const said = []; const notes = []; const ui = new Map(); const cmds = new Map(); const timers = new Map();
const api = {
  mp, log: () => {}, personal: (a, t) => said.push({ a, t }), system: (a, t) => said.push({ a, t }), audit: () => {}, who: (a) => `P${a}`, display: (a) => `P${a}`,
  cfg: { thievery: { enabled: true, factions: [] } }, onUi: (e, f) => ui.set(e, f), openWidget: (a, w) => { widgets.push({ a, w }); return true; }, closeWidget: (a, id) => widgets.push({ a, close: id }),
  onlineActors: () => online.slice(), every: (n, ms, f) => timers.set(n, f), recordOf: (id) => (items[id] ? { record: { type: items[id][0], editorId: items[id][1] } } : null), adminItemName: () => '',
  registerChatCommand: (n, f) => cmds.set(n, f), isAdmin: (a) => [GM, LEAD].includes(a), isLeadStaff: (a) => a === LEAD,
  findByName: (q) => ({ thief: THIEF, lydia: OWNER }[String(q).toLowerCase()] || null), profileOf: (a) => a, sendPacket: () => true, distanceMeters: () => 2,
  approvalForum: () => {}, staffNote: (a, what, detail) => notes.push({ a, what, detail }),
};
delete require.cache[MOD];
const T = require(MOD)(api);
const op = (a, ...args) => ui.get('staffThievery')(a, args);
const last = (a) => { const w = widgets.filter((x) => x.a === a && x.w && x.w.id === 162).pop(); return w ? w.w : null; };
const cmd = (a, name, args) => { said.length = 0; cmds.get(name)(a, args); return said.filter((x) => x.a === a).map((x) => x.t).join(' | '); };
const flush = () => new Promise((r) => setImmediate(r));

(async () => {
  // ---- who sees it
  op(TRIAL, 'watch');
  check('a Trial GM gets no Thievery data', !last(TRIAL));
  op(GM, 'watch');
  const v0 = last(GM);
  check('a GM gets the tab as an unfocused staffData widget 162', v0 && v0.type === 'staffData' && v0.kind === 'thievery' && widgets.find((x) => x.w === v0) && v0.gm === true && v0.lead === false);
  check('nothing approved yet; both factions are candidates', v0.factions.length === 0 && v0.candidates.map((c) => c.id).join(',') === 'thieves-guild,dark-brotherhood', v0.candidates);
  op(LEAD, 'watch');
  check('a Lead GM is flagged lead', last(LEAD).lead === true);

  // ---- factions: Lead GM only, one action with the command
  op(GM, 'approve', 'thieves-guild');
  check('a GM cannot approve a thief faction from the tab', last(GM).result && last(GM).result.ok === false && /Lead GMs/.test(last(GM).result.text) && !T.data().approved.length);
  check('...and the command answers the same', cmd(GM, 'burglary', 'approve thieves-guild') === last(GM).result.text);
  op(LEAD, 'approve', 'thieves-guild');
  check('a Lead GM approves it from the tab', T.data().approved.includes('thieves-guild') && last(LEAD).result.ok === true);
  await flush();
  check('the change reaches the other open tab by itself', last(GM).factions.map((f) => f.id).join() === 'thieves-guild' && !last(GM).candidates.some((c) => c.id === 'thieves-guild'));
  check('a staff note is written for a done action', notes.some((n) => n.a === LEAD && /approve thieves-guild/.test(n.detail)));
  op(LEAD, 'approve', 'no-such');
  check('an unknown faction is refused', last(LEAD).result.ok === false && /No faction/.test(last(LEAD).result.text));

  // ---- fences: Lead GM marks by arming, then opening the chest in the world
  op(GM, 'mark', 'thieves-guild');
  check('a GM cannot mark a fence', last(GM).result.ok === false && !last(GM).armed);
  op(LEAD, 'mark', 'thieves-guild');
  check('a Lead GM arms the mark; the tab shows it armed', last(LEAD).armed && last(LEAD).armed.kind === 'fence');
  globalThis.__dboBurglaryActivate(HALLCHEST, LEAD);
  await flush();
  const f = last(LEAD).factions[0].fence;
  check('opening the chest makes it the Fence Chest, answered in the tab and in chat', f && f.chest === '700' && /now the Fence Chest/.test(last(LEAD).result.text) && said.some((x) => x.a === LEAD && /now the Fence Chest/.test(x.t)));
  check('...and the arm is spent', !last(LEAD).armed);

  // ---- raids: GMs decide; a ruling before the notice is out is Lead GM only
  cmd(GUARD, 'fence', 'report thieves-guild Lydia saw her sword carried down into the Ratway');
  await flush();
  const r1 = last(GM).raids[0];
  check('an open raid report is listed with its evidence', r1 && r1.n === 1 && r1.state === 'pending' && /Ratway/.test(r1.evidence));
  op(GM, 'raid', 1, 'deny', '');
  check('a denial needs a reason', last(GM).result.ok === false && /reason/.test(last(GM).result.text));
  op(GM, 'raid', 1, 'approve');
  await flush();
  check('a GM approves it: the fence is frozen', last(GM).raids[0].state === 'approved' && last(GM).factions[0].fence.frozen === 1);
  op(GM, 'raid', 1, 'won');
  check('a GM cannot rule it before the notice is out', last(GM).result.ok === false && /thieves have until/.test(last(GM).result.text));
  op(LEAD, 'raid', 1, 'lost');
  await flush();
  check('a Lead GM can (as /fence lost does)', T.data().raids[0].state === 'lost' && !last(GM).factions[0].fence.frozen);
  check('a ruled raid stays in the list below the open ones', last(GM).raids[0].state === 'lost');

  // ---- the stolen ledger and sending back
  const d = T.data();
  d.stolen.push({ n: 1, entry: { baseId: SWORD, count: 1 }, owner: 11, ownerChar: OWNER, ownerName: 'Lydia', home: '500', homeName: 'Lydia\'s house', thief: THIEF, thiefName: 'P101', faction: 'thieves-guild', at: now - 60000, state: 'carried' });
  d.stolen.push({ n: 2, entry: { baseId: BREAD, count: 4 }, owner: 11, ownerChar: OWNER, ownerName: 'Lydia', home: '500', homeName: 'Lydia\'s house', thief: THIEF, thiefName: 'P101', faction: 'thieves-guild', at: now - 30000, state: 'fenced', lot: 1 });
  d.lots.push({ n: 1, fid: 'thieves-guild', stolen: 2, entry: { baseId: BREAD, count: 4 }, by: THIEF, byName: 'P101', at: now, matureAt: now + 14 * 86400000, state: 'held', owner: 11, ownerChar: OWNER, ownerName: 'Lydia', homeName: 'Lydia\'s house' });
  d.nextStolen = 3; d.nextLot = 2;
  op(GM, 'watch');
  const led = last(GM).stolen;
  check('the ledger lists newest first, with owner, thief, place and state', led.length === 2 && led[0].n === 2 && led[0].owner === 'Lydia' && led[0].thief === 'P101' && led[1].state === 'carried' && last(GM).stolenTotal === 2);
  check('both can be sent back (fenced, and carried by a thief online)', led.every((x) => x.canSendBack));
  op(TRIAL, 'sendback', 2);
  check('a Trial GM cannot send back', T.data().lots[0].state === 'held');
  op(GM, 'sendback', 2);
  check('a GM sends a fenced lot back: off the fence, into the owner\'s pack', T.data().lots[0].state === 'recovered' && ((get(OWNER, 'inventory') || {}).entries || []).some((e) => e.baseId === BREAD && e.count === 4));
  online = online.filter((a) => a !== THIEF);
  op(GM, 'watch');
  check('a thief offline: the carried entry is not offered', last(GM).stolen.find((x) => x.n === 1).canSendBack === false);
  op(GM, 'sendback', 1);
  check('...and a send-back is refused', last(GM).result.ok === false && /offline/.test(last(GM).result.text));
  online.push(THIEF);
  check('the command runs the same send-back', cmd(GM, 'stolen', 'return 1') === 'Iron Sword goes back to Lydia.' && ((get(THIEF, 'inventory') || {}).entries || []).every((e) => e.baseId !== SWORD));
  op(GM, 'sendback', 1);
  check('an entry already recovered cannot go twice', last(GM).result.ok === false && /recovered/.test(last(GM).result.text));

  // ---- permits: GMs grant (armed, then the door) and revoke
  op(GM, 'permit', 'nobody', 4);
  check('a permit needs a thief who is online', last(GM).result.ok === false);
  op(GM, 'permit', 'thief', 4);
  globalThis.__dboBurglaryActivate(DOOR, GM);
  await flush();
  const p = last(GM).permits[0];
  check('the permit is listed with its home, thief and end', p && p.home === '500' && p.homeName === 'Lydia\'s house' && p.thief === 'P101' && p.until === now + 4 * 3600000, p);
  op(TRIAL, 'unpermit', '500');
  check('a Trial GM cannot revoke it', !!T.data().permits['500']);
  op(GM, 'unpermit', '500');
  check('a GM revokes it', !T.data().permits['500'] && last(GM).result.ok === true);
  now += 5 * 3600000;

  // ---- live breaches and break-ins
  T.data().breaches['500:65'] = { thief: THIEF, name: 'P101', at: now, until: now + 600000, faction: 'thieves-guild' };
  T.data().breaches['501:65'] = { thief: THIEF, name: 'P101', at: now - 3600000, until: now - 3000000, faction: 'thieves-guild' };
  op(GM, 'watch');
  check('only live breaches are listed', last(GM).breaches.length === 1 && last(GM).breaches[0].faction === 'Thieves Guild');

  // ---- revoke and unwatch
  op(LEAD, 'unmark', 'thieves-guild');
  check('a fence with no lots can be unmarked by a Lead GM', !T.data().fences['thieves-guild']);
  op(LEAD, 'revoke', 'thieves-guild');
  check('a Lead GM revokes the faction from the tab', !T.data().approved.includes('thieves-guild'));
  op(GM, 'unwatch');
  check('closing the tab stops the updates', widgets.some((x) => x.a === GM && x.close === 162));
  const before = widgets.length; op(LEAD, 'approve', 'dark-brotherhood'); await flush();
  check('...a closed tab is not sent the next change', widgets.slice(before).every((x) => x.a !== GM));

  console.log(fails ? `${fails} failure(s)` : 'all checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL the harness threw', e.stack); process.exit(1); });
