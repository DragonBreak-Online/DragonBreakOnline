// Step 1 of the warband rework (Nat, 25 Oct: "make it more intuitive"): the preview of an NPC before it is raised (/warband
// info: kind from the race's ActorType keywords, level through the template chain, race, aggression), "attack my target"
// (what the GM last struck, else who last struck the GM or the band) and "attack the nearest foe", the strikes noted in
// the hit hook (__dboWarbandRefusesHit), and each member's state, health and target in the view. A mock gamemode api.
//   node tests/warband-step1-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'warband.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-wbstep1-'));
process.chdir(dir);
// verify-formids: ignore (every id in this file is a mock record)
fs.writeFileSync('admin-placeables.json', JSON.stringify({ categories: [{ id: 'npc', kind: 'npc', items: [
  ['a01:Test.esp', 'Giant'], ['a02:Test.esp', 'Bandit'], ['a03:Test.esp', 'Jarl'], ['a04:Test.esp', 'Leveled Bandits'], // verify-formids: ignore (mock catalog)
] }] }));
const u16 = (v, n, at, x) => new DataView(v.buffer).setUint16(at, x, true);
const acbs = ({ flags = 0, level = 1, cmin = 0, cmax = 0, tpl = 0 }) => { const b = new Uint8Array(24); const v = new DataView(b.buffer); v.setUint32(0, flags, true); v.setInt16(8, level, true); v.setUint16(10, cmin, true); v.setUint16(12, cmax, true); v.setUint16(18, tpl, true); return b; };
const u32 = (x) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, x, true); return b; };
const kwda = (...ids) => { const b = new Uint8Array(4 * ids.length); ids.forEach((x, i) => new DataView(b.buffer).setUint32(i * 4, x, true)); return b; };
const rec = (type, editorId, fields) => ({ record: { type, editorId, fields }, toGlobalRecordId: (x) => x });
const KW_NPC = 0x900, KW_GIANT = 0x901, KW_CREATURE = 0x902, RACE_GIANT = 0x800, RACE_NORD = 0x801;
const records = {
  [KW_NPC]: rec('KYWD', 'ActorTypeNPC', []), [KW_GIANT]: rec('KYWD', 'ActorTypeGiant', []), [KW_CREATURE]: rec('KYWD', 'ActorTypeCreature', []),
  [RACE_GIANT]: rec('RACE', 'GiantRace', [{ type: 'KWDA', data: kwda(KW_CREATURE, KW_GIANT) }]),
  [RACE_NORD]: rec('RACE', 'NordRace', [{ type: 'KWDA', data: kwda(KW_NPC) }]),
  0xa01: rec('NPC_', 'EncGiant01', [{ type: 'ACBS', data: acbs({ level: 32, cmin: 10 }) }, { type: 'RNAM', data: u32(RACE_GIANT) }, { type: 'AIDT', data: new Uint8Array([0, 2]) }]),
  // a bandit whose stats and traits come from a template (ACBS template flags 0x01 traits, 0x02 stats, 0x10 AI data)
  0xa02: rec('NPC_', 'EncBandit01', [{ type: 'ACBS', data: acbs({ level: 1, tpl: 0x13 }) }, { type: 'TPLT', data: u32(0xa05) }, { type: 'RNAM', data: u32(RACE_GIANT) }]),
  0xa05: rec('NPC_', 'BanditTemplate', [{ type: 'ACBS', data: acbs({ level: 9 }) }, { type: 'RNAM', data: u32(RACE_NORD) }, { type: 'AIDT', data: new Uint8Array([1, 2]) }]),
  0xa03: rec('NPC_', 'Jarl', [{ type: 'ACBS', data: acbs({ flags: 0x80, level: 1500, cmin: 10, cmax: 30 }) }, { type: 'RNAM', data: u32(RACE_NORD) }, { type: 'AIDT', data: new Uint8Array([0, 1]) }]),
  0xa04: rec('LVLN', 'LCharBandit', [{ type: 'LVLO', data: new Uint8Array(12) }, { type: 'LVLO', data: new Uint8Array(12) }]),
};
let next = 0xff000100;
const companions = new Map();
const attacks = [];
globalThis.__dboWarband = undefined;
globalThis.__dboCompanions = {
  spawn: (owner, baseId, opts) => { const id = next++; companions.set(id, { id, ownerId: owner, baseId, kind: opts.kind, targetId: 0 }); return id; },
  list: (owner) => [...companions.values()].filter((c) => c.ownerId === owner && !c.released),
  release: (id, hostile) => { const c = companions.get(id); c.released = true; c.hostile = hostile; return true; },
  dismiss: (id) => companions.delete(id), follow: () => true, stay: () => true,
  attack: (id, t) => { attacks.push([id, t]); const c = companions.get(id); if (c) c.targetId = t; return true; },
};
const GM = 0x14, PLAYER = 0x16, WOLF = 0xff000900, BEAR = 0xff000901, FAR = 0xff000902;
const pos = { [GM]: [0, 0, 0], [PLAYER]: [700, 0, 0], [WOLF]: [1400, 0, 0], [BEAR]: [350, 0, 0], [FAR]: [99999, 0, 0] };
const health = new Map();
const dead = new Set();
const base = { [WOLF]: 0xa02, [BEAR]: 0xa01, [FAR]: 0xa01 };
const said = [], packets = [], ui = {}, commands = {}, audits = [];
require(MODULE)({
  mp: {
    get: (id, k) => {
      if (k === 'pos') return pos[id] || [100, 0, 0];
      if (k === 'angle') return [0, 0, 0];
      if (k === 'worldOrCellDesc') return 'w';
      if (k === 'profileId') return { [GM]: 1, [PLAYER]: 3 }[id];
      if (k === 'percentages') return { health: health.has(id) ? health.get(id) : 1, magicka: 1, stamina: 1 };
      if (k === 'isDead') return dead.has(id);
      if (k === 'baseId') return base[id];
      return undefined;
    },
    getIdFromDesc: (d) => parseInt(d, 16), set: () => {}, destroyActor: () => {},
    lookupEspmRecordById: (id) => records[id] || null,
  },
  log: () => {}, personal: (a, t) => said.push(t), audit: (t) => audits.push(t), who: (a) => `P${a.toString(16)}`, isAdmin: (a) => a === GM,
  registerChatCommand: (n, f) => { commands[n] = f; }, findByName: () => 0, cfg: { warband: { maxRaise: 25 } }, onUi: (n, f) => { ui[n] = f; },
  onlineActors: () => [GM, PLAYER], sendPacket: (a, p) => { packets.push([a, p]); return true; },
});
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!c) fails++; };
const last = (type) => { const p = packets.filter(([a, x]) => a === GM && x.customPacketType === type).pop(); return p ? p[1] : null; };
const view = () => last('adminWarbandView');
const panel = (text) => ui.warband(GM, [text]);
const hit = (agg, tgt) => globalThis.__dboWarbandRefusesHit(agg, tgt);
try {
  // ---- the preview -------------------------------------------------------------------------------------------------------
  panel('info a01:Test.esp');   // verify-formids: ignore (mock catalog)
  let i = view().info;
  ok(i && i.kind === 'creature' && i.level === '32' && i.race === 'GiantRace' && i.aggression === 'unaggressive' && i.settles === true,
    'a giant: creature, level 32, GiantRace, unaggressive (it would settle)', i);
  ok(i && i.types.join(',') === 'Creature,Giant', '...its kind tags come from the race\'s ActorType keywords', i && i.types);
  panel('info a02:Test.esp');   // verify-formids: ignore (mock catalog)
  i = view().info;
  ok(i && i.kind === 'humanoid' && i.level === '9' && i.race === 'NordRace' && i.aggression === 'aggressive' && i.settles === true,
    'a bandit through its template: level, race and AI data all from the template (Use Stats, Use Traits, Use AI Data); aggressive still settles (it attacks enemies only)', i);
  panel('info a03:Test.esp');   // verify-formids: ignore (mock catalog)
  i = view().info;
  ok(i && /^x1\.50 of the player's level \(10-30\)$/.test(i.level), 'a jarl at PC Level Mult: x1.50 of the player\'s level (10-30)', i && i.level);
  panel('info a04:Test.esp');   // verify-formids: ignore (mock catalog)
  i = view().info;
  ok(i && i.kind === 'leveled list' && i.entries === 2, 'a leveled list says so, with its entry count', i);
  ok(/Giant|Bandit|Jarl|Leveled/.test(view().last.text), 'the preview is also said in chat and shown as the last line', view().last);

  // ---- attack my target --------------------------------------------------------------------------------------------------
  panel('raise a02:Test.esp 3');   // verify-formids: ignore (mock catalog)
  attacks.length = 0;
  panel('attacktarget');
  ok(attacks.length === 0 && /No target/.test(view().last.text), 'no strike yet: no target, and the GM is told how one is made', view().last);
  hit(GM, WOLF);
  panel('attacktarget');
  ok(attacks.length === 3 && attacks.every(([, t]) => t === WOLF), 'the GM struck a wolf: the band goes for it', attacks);
  ok(audits.some((t) => /set 3 NPC\(s\) on NPC ff000900 \(my target\)/.test(t)), '...and it is audited as an attack order', audits.slice(-1));
  // A blow on one of the band marks the striker; with no fresh strike of the GM's own, that is the target
  const member = [...companions.keys()][0];
  globalThis.__dboWarband.struck.clear();
  hit(BEAR, member);
  attacks.length = 0;
  panel('attacktarget');
  ok(attacks.length === 3 && attacks.every(([, t]) => t === BEAR), 'nothing struck by the GM: whoever struck the band is the target', attacks);
  // A strike older than targetSeconds no longer counts
  globalThis.__dboWarband.attackers.get(BEAR).at -= 61000;
  attacks.length = 0;
  panel('attacktarget');
  ok(attacks.length === 0, 'a strike older than 60 s is forgotten');
  // The band's own blows on each other or on the GM do not make a target
  hit(member, GM);
  ok(!globalThis.__dboWarband.attackers.has(member), 'the band\'s own blow on its GM marks nobody');

  // ---- attack the nearest foe --------------------------------------------------------------------------------------------
  hit(WOLF, GM); hit(BEAR, member); hit(FAR, GM);
  attacks.length = 0;
  panel('attacknearest');
  ok(attacks.length === 3 && attacks.every(([, t]) => t === BEAR), 'nearest foe: the bear (5 m) before the wolf (20 m); the far one is out of view', attacks);
  dead.add(BEAR);
  attacks.length = 0;
  panel('attacknearest');
  ok(attacks.every(([, t]) => t === WOLF), '...a dead foe is skipped', attacks);
  dead.delete(BEAR);

  // ---- the view: each member's state, health and target; the GM's target and foes ----------------------------------------
  health.set(member, 0.42);
  ui.warbandView(GM, []);
  let v = view();
  const m = v.members.find((x) => x.id === member.toString(16));
  ok(m && m.health === 42 && m.state === 'fighting' && m.target === 'Bandit', 'a member: 42% health, fighting, its target (the wolf, a Bandit base) named', m);
  ok(v.target && v.target.name && Array.isArray(v.foes) && v.foes[0].name === 'Giant' && v.foes[0].dist === 5, 'the view carries the GM\'s target and the foes, nearest first', [v.target, v.foes]);
  for (const c of companions.values()) c.targetId = 0;
  pos[member] = [5000, 0, 0];
  panel('stay');
  v = view();
  ok(v.members.find((x) => x.id === member.toString(16)).state === 'far behind', 'over 40 m from the GM: far behind', v.members);
  ok(v.members.filter((x) => x.id !== member.toString(16)).every((x) => x.state === 'holding'), 'the rest, near and ordered to stay: holding', v.members);
  dead.add(member);
  ui.warbandView(GM, []);
  ok(view().members.find((x) => x.id === member.toString(16)).state === 'dead' && view().members.find((x) => x.id === member.toString(16)).health === 0, 'a dead member: dead, 0 health');
} catch (e) { ok(false, 'threw: ' + e.stack); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
