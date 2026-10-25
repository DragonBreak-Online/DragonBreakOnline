// The Place tab's Warband view made intuitive (Nat, 25 Oct, W1-W10): every panel step is answered with the view (roster
// with counts, the GM's raiders and garrison, nearby players and other GMs' NPCs, side and enemies, the settle plan, presets,
// onLogout and the last answer, packet adminWarbandView); dismiss one by id; attack an NPC by id; preview, then settle calm |
// unleashrest | dismissrest; raid clear raiders | garrison | <id>; presets saved, raised and deleted; onlogout settle with
// the gamemode's logout hook (__dboWarbandLeave). A mock gamemode api; no server and no game.
//   node tests/warband-panel-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'warband.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-wbpanel-'));
const home = process.cwd();
process.chdir(dir);
const TITAN = 0x843, BANDIT = 0x1e7e2, FARMER = 0x600;
fs.writeFileSync('admin-placeables.json', JSON.stringify({ categories: [{ id: 'npc', kind: 'npc', items: [
  ['843:Skyrim.esm', 'Daedroth Titan'], ['1e7e2:Skyrim.esm', 'Bandit'], ['600:Skyrim.esm', 'Farmer'], // verify-formids: ignore (mock catalog)
] }] }));
const u8 = (bytes) => new Uint8Array(bytes);
const acbs = () => new Uint8Array(24);
const NPC = (aidt) => ({ record: { type: 'NPC_', fields: [{ type: 'ACBS', data: acbs() }, { type: 'AIDT', data: u8(aidt) }] }, toGlobalRecordId: (x) => x });
const records = { [TITAN]: NPC([2, 3, 50]), [BANDIT]: NPC([1, 2, 50]), [FARMER]: NPC([0, 1, 50]) };
let next = 0xff000100;
const companions = new Map();
const attacks = [];
globalThis.__dboWarband = undefined;
globalThis.__dboCompanions = {
  spawn: (owner, baseId, opts) => { const id = next++; companions.set(id, { id, ownerId: owner, baseId, kind: opts.kind }); return id; },
  list: (owner) => [...companions.values()].filter((c) => c.ownerId === owner && !c.released),
  release: (id, hostile) => { const c = companions.get(id); c.released = true; c.hostile = hostile; return true; },
  dismiss: (id) => companions.delete(id), follow: () => true, stay: () => true,
  attack: (id, t) => { attacks.push([id, t]); return true; },
};
const GM = 0x14, OTHER_GM = 0x15, PLAYER = 0x16;
const pos = { [GM]: [0, 0, 0], [OTHER_GM]: [700, 0, 0], [PLAYER]: [1400, 0, 0] };
const said = [], packets = [], ui = {}, commands = {}, destroyed = [];
require(MODULE)({
  mp: {
    get: (id, k) => (k === 'pos' ? pos[id] || [100, 0, 0] : k === 'angle' ? [0, 0, 0] : k === 'worldOrCellDesc' ? 'w' : k === 'profileId' ? ({ [GM]: 1, [OTHER_GM]: 2, [PLAYER]: 3 }[id]) : undefined),
    getIdFromDesc: (d) => parseInt(d, 16), set: () => {}, destroyActor: (id) => destroyed.push(id),
    lookupEspmRecordById: (id) => records[id] || null,
  },
  log: () => {}, personal: (a, t) => said.push(t), audit: () => {}, who: (a) => `P${a.toString(16)}`, isAdmin: (a) => a === GM || a === OTHER_GM,
  registerChatCommand: (n, f) => { commands[n] = f; }, findByName: () => 0, cfg: { warband: { maxRaise: 25 } }, onUi: (n, f) => { ui[n] = f; },
  onlineActors: () => [GM, OTHER_GM, PLAYER], sendPacket: (a, p) => { packets.push([a, p]); return true; },
  runChat: (a, line) => { const m = line.match(/^\/(\w+)\s*(.*)$/); commands[m[1]](a, m[2]); },
});
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!c) fails++; };
const view = () => { const p = packets.filter(([a, x]) => a === GM && x.customPacketType === 'adminWarbandView').pop(); return p ? p[1] : null; };
const panel = (text) => ui.warband(GM, [text]);
try {
  // W1/W10: one press raises up to maxRaise (config 25 here)
  panel('raise 1e7e2:Skyrim.esm 12');
  ok(companions.size === 12, 'one press raises 12 (maxRaise 25 from config)', companions.size);
  let v = view();
  ok(!!v && v.members.length === 12 && v.counts[0].name === 'Bandit' && v.counts[0].count === 12, 'the panel step is answered with the view: 12 members, counted by kind', v && v.counts);
  ok(v && /12 Bandit follow you/.test(v.last.text), '...and the last answer, shown in the panel (W3)', v && v.last);
  panel('raise 843:Skyrim.esm 1'); panel('raise 600:Skyrim.esm 2'); // verify-formids: ignore (mock catalog)
  // W2: one member dismissed by id
  const victim = view().members[0].id;
  panel(`dismiss ${victim}`);
  ok(view().members.length === 14 && !view().members.some((m) => m.id === victim), 'dismiss <id> takes only that one', view().members.length);
  // W4: stance and side in the view
  panel('stay');
  ok(view().stance === 'stay', 'the view says the band holds its ground');
  ui.warband(OTHER_GM, ['side Legion']); panel('side Rebels');
  ok(view().side === 'Rebels' && view().enemies.includes('Legion'), 'side and the enemy sides are in the view', [view().side, view().enemies]);
  // W5: an NPC target by id; another GM's NPCs and nearby players listed
  ui.warband(OTHER_GM, ['raise 600:Skyrim.esm 1']);
  ui.warbandView(GM, []);
  v = view();
  ok(v.npcs.some((n) => n.name === 'Farmer' && n.foe === true && n.gm === 'P15'), 'another GM\'s NPC on an enemy side is listed as a target', v.npcs);
  ok(v.players.some((p) => p.name === 'P16' && p.dist === 20), 'a nearby player is listed with the distance in metres', v.players);
  const foe = v.npcs[0].id;
  attacks.length = 0;
  panel(`attacknpc ${foe}`);
  ok(attacks.length === 14 && attacks.every(([, t]) => t === parseInt(foe, 16)), 'attacknpc sets the whole band on that NPC', attacks.length);
  panel(`attacknpc ${(PLAYER).toString(16)}`);
  ok(/That is a player/.test(view().last.text), '...a player id is pointed at /warband attack instead', view().last);
  // W6: the plan before a settle
  v = view();
  ok(v.plan.calm === 13 && /Daedroth Titan/.test(v.plan.kept), 'the view carries the settle plan: 13 calm, the Titan kept', v.plan);
  panel('preview');
  ok(/Settling would leave 13 as a garrison/.test(view().last.text) && /aggressive by nature/.test(view().last.text), 'preview says who settles and who stays', view().last);
  // W10: presets
  panel('preset save Bruma Raid');
  ok(/Saved "Bruma Raid": 11 Bandit, 1 Daedroth Titan, 2 Farmer/.test(view().last.text), 'a preset keeps the band by kind', view().last);
  ok(fs.existsSync('warband-presets.json') && view().presets[0].count === 14, '...on disk beside the world, listed with its size', view().presets);
  // settle calm, unleash the rest
  panel('settle unleashrest');
  const rel = [...companions.values()].filter((c) => c.released);
  ok(rel.filter((c) => !c.hostile).length === 13 && rel.filter((c) => c.hostile).length === 1, 'settle unleashrest: 13 garrison, the Titan loose as a raid', rel.map((c) => c.hostile));
  v = view();
  ok(v.members.length === 0 && v.placed.length === 14 && v.placed.filter((p) => p.hostile).length === 1, 'the view lists the raiders and garrison placed', v.placed.length);
  // W7: raid clear raiders only, then one garrison NPC by id
  ui.raid(GM, ['clear raiders']);
  ok(destroyed.length === 1 && view().placed.length === 13, 'raid clear raiders removes only the raider', destroyed.length);
  const one = view().placed[0].id;
  ui.raid(GM, [`clear ${one}`]);
  ok(destroyed.length === 2 && view().placed.length === 12, 'raid clear <id> removes only that one', destroyed.length);
  ui.raid(GM, ['clear garrison']);
  ok(view().placed.length === 0, 'raid clear garrison takes the rest of the garrison');
  // raise the preset again in one press, then delete it
  panel('preset raise Bruma Raid');
  ok(view().members.length === 14, 'a preset is raised in one press', view().members.length);
  // W8: settle the calm ones on logout
  panel('onlogout settle');
  ok(view().onLogout === 'settle', 'onlogout settle is the GM\'s choice now');
  const settledBefore = [...companions.values()].filter((c) => c.ownerId === GM && c.released && !c.hostile).length;
  globalThis.__dboWarbandLeave(GM);
  const settledNow = [...companions.values()].filter((c) => c.ownerId === GM && c.released && !c.hostile).length - settledBefore;
  ok(settledNow === 13 && globalThis.__dboCompanions.list(GM).length === 1, 'the logout hook settles the 13 calm ones, the Titan left to the companion system', [settledNow, globalThis.__dboCompanions.list(GM).length]);
  panel('preset delete Bruma Raid');
  ok(view().presets.length === 0, 'a preset is deleted');
  // the chat still answers as before
  said.length = 0;
  commands.warband(GM, 'dismiss');
  ok(said.length === 1 && /^Dismissed/.test(said[0]), 'typed commands still answer in chat', said);
} finally {
  process.chdir(home);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Windows may hold the folder a moment */ }
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
