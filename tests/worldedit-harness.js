// Scripted test for server\worldedit.js through placement.js (the F7 Place tab editing what the plugins placed). No server
// and no game: run it from this folder's parent with
//
//   node tests/worldedit-harness.js
//
// A mock mp in a scratch folder under /dev/shm (dev IO stalls the live server), so no real list is touched. The mock
// follows the server: plugin REFRs come from lookupEspmRecordById with NAME and DATA fields, and mp.get throws "Form
// doesn't exist" for a reference the server keeps no form for (a static).
'use strict';
const fs = require('fs');
const path = require('path');

const MODULE = path.resolve(__dirname, '..', 'placement.js');
const WE_MODULE = path.resolve(__dirname, '..', 'worldedit.js');
const shm = fs.existsSync('/dev/shm') ? '/dev/shm' : require('os').tmpdir();
const dir = fs.mkdtempSync(path.join(shm, 'claude-nate-worldedit-'));
const home = process.cwd();
// placement.js and worldedit.js resolve by cwd, as on the server
fs.copyFileSync(WE_MODULE, path.join(dir, 'worldedit.js'));
process.chdir(dir);
fs.mkdirSync(path.join(dir, 'state', 'world'), { recursive: true });
fs.symlinkSync(path.join(dir, 'state', 'world'), path.join(dir, 'world'), 'dir');
const FILE = path.join(dir, 'state', 'world-edits.json');
fs.writeFileSync('admin-placeables.json', JSON.stringify({ categories: [{ id: 'Crafting Stations', label: 'Crafting Stations', kind: 'object', items: [['bbcf1:Skyrim.esm', 'Blacksmith Forge', 'Skyrim.esm']] }] }));

const WHERE = 'a764b:BSHeartland.esm';
const GM = 0xff000001, PLAYER = 0xff000002, GM2 = 0xff000003;
const FORGE = 0x0001a2b3, WALL = 0x0002c3d4, DOOR = 0x0003e5f6, BANDIT = 0x0004aaaa, FAR = 0x0005bbbb;
// A REFR record as lookupEspmRecordById gives it: NAME is the base's local id, DATA six floats (rotation in radians)
const refr = (base, pos, rotRad) => {
  const name = Buffer.alloc(4); name.writeUInt32LE(base);
  const d = Buffer.alloc(24); [...pos, ...rotRad].forEach((v, i) => d.writeFloatLE(v, i * 4));
  return { record: { id: 0, editorId: '', type: 'REFR', flags: 0, fields: [{ type: 'NAME', data: new Uint8Array(name) }, { type: 'DATA', data: new Uint8Array(d) }] }, toGlobalRecordId: (x) => x };
};
const RECORDS = {
  [FORGE]: refr(0xbbcf1, [1100, 2000, 300], [0, 0, Math.PI / 2]),
  [WALL]: refr(0x5001, [1200, 2050, 300], [0, 0, 0]),
  [DOOR]: refr(0x6001, [1000, 2100, 300], [0, 0, 0]),
  [BANDIT]: { record: { type: 'ACHR', fields: [] } },
  [FAR]: refr(0xbbcf1, [90000, 2000, 300], [0, 0, 0]),
  0xbbcf1: { record: { type: 'FURN', editorId: 'CraftingBlacksmithForge' } },
  0x5001: { record: { type: 'STAT', editorId: 'WRWallStone01' } },
  0x6001: { record: { type: 'DOOR', editorId: 'BrumaDoor01' } },
};
const props = new Map();
const calls = [];
const set = (id, k, v) => props.set(id + '|' + k, v);
// The server keeps forms for the forge, the door and the far forge; not for the static wall
const FORMS = new Set([GM, PLAYER, GM2, FORGE, DOOR, FAR]);
for (const [a, prof] of [[GM, 2], [PLAYER, 5], [GM2, 7]]) { set(a, 'worldOrCellDesc', WHERE); set(a, 'pos', [1000, 2000, 300]); set(a, 'profileId', prof); }
set(FORGE, 'type', 'MpObjectReference'); set(FORGE, 'worldOrCellDesc', WHERE); set(FORGE, 'pos', [1100, 2000, 300]);
set(DOOR, 'type', 'MpObjectReference'); set(DOOR, 'worldOrCellDesc', WHERE);
set(FAR, 'type', 'MpObjectReference'); set(FAR, 'worldOrCellDesc', WHERE); set(FAR, 'pos', [90000, 2000, 300]);
const mp = {
  get: (id, k) => { if (!FORMS.has(id >>> 0) && k !== 'onlinePlayers') throw new Error("Form doesn't exist"); return props.get(id + '|' + k); },
  set: (id, k, v) => { calls.push(['set', id, k, v]); set(id, k, v); },
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
  getIdFromDesc: (d) => parseInt(d, 16),
  destroyActor: () => {},
  lookupEspmRecordById: (id) => RECORDS[id >>> 0] || {},
  callPapyrusFunction: (kind, cls, fn, self, args) => { calls.push([fn, parseInt(self.desc, 16), args]); return null; },
};
const out = { personal: [], audit: [], packets: [], log: [] };
const TIERS = { [GM]: 'senior', [GM2]: 'leadgm' };
const timers = {};
let online = [GM, PLAYER];
let ui = {}, commands = {};
const load = (cfg) => {
  ui = {}; commands = {};
  require(MODULE)({
    mp, log: (...xs) => out.log.push(xs.join(' ')), personal: (a, t) => out.personal.push([a, t]), audit: (t) => out.audit.push(t), who: (a) => 'P' + (a >>> 0).toString(16),
    onUi: (ev, fn) => { ui[ev] = fn; }, sendPacket: (a, p) => { out.packets.push([a, p]); return true; },
    isAdmin: (a) => !!TIERS[a], tierOf: (a) => TIERS[a] || null, registerChatCommand: (n, fn) => { commands[n] = fn; },
    every: (name, ms, fn) => { timers[name] = { ms, fn }; }, onlineActors: () => online.slice(), cfg,
  });
};
delete require.cache[MODULE];
load({ placement: { rights: { world: 'leadgm' } } });

let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined && !ok ? '   ' + detail : ''}`); if (!ok) failures++; };
const reset = () => { calls.length = 0; out.personal.length = 0; out.audit.length = 0; out.packets.length = 0; out.log.length = 0; };
const said = () => out.personal.map((x) => x[1]).join(' | ');
const papyrus = (fn) => calls.filter((c) => c[0] === fn);
const file = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const h = (id) => id.toString(16);

// ---- what works with the 0.3.101 client: hide and show what the server keeps a form for ----
reset(); ui.placeDelete(PLAYER, [h(FORGE)]);
check('a player cannot hide anything', papyrus('Disable').length === 0 && out.personal.length === 0);
TIERS[GM2] = 'gm';
reset(); ui.placeDelete(GM2, [h(FORGE)]);
check('a GM below the world right is refused', papyrus('Disable').length === 0 && /Lead GM and above/.test(said()), said());
TIERS[GM2] = 'leadgm';

reset(); ui.placeSelect(GM, [h(FORGE)]);
check('Enter on a plugin object says what it is and what Delete does', /CraftingBlacksmithForge \(FURN, ref 1a2b3\), as its plugin has it\. Delete hides it/.test(said()), said());
check('without the 0.3.102 client no edit mode starts', !out.packets.some((p) => p[1].customPacketType === 'placeEdit'));

reset(); ui.placeDelete(GM, [h(FORGE)]);
const dis = papyrus('Disable');
check('Delete on it hides it through Papyrus Disable (change form + clients in view)', dis.length === 1 && dis[0][1] === FORGE && dis[0][2][0] === false, JSON.stringify(calls));
check('the GM is told and it is audited', /Hid CraftingBlacksmithForge for everyone/.test(said()) && /WORLDEDIT Pff000001 hide CraftingBlacksmithForge, ref 1a2b3/.test(out.audit.join('\n')), said());
let f = file();
check('world-edits.json keeps it beside the world state: who, when, where, the plugin pose', f.edits['1a2b3'] && f.edits['1a2b3'].hidden === true && f.edits['1a2b3'].by === 2 && f.edits['1a2b3'].where === WHERE && f.edits['1a2b3'].orig.rot[2] === 90 && f.edits['1a2b3'].serverForm === true && !!f.edits['1a2b3'].at, JSON.stringify(f.edits));
check('and its log has the step', f.log.length === 1 && f.log[0].action === 'hide' && f.log[0].who === 'Pff000001' && f.log[0].ref === '1a2b3');
check('no worldEdits packet goes to 0.3.101 clients', !out.packets.some((p) => p[1].customPacketType === 'worldEdits'));

reset(); ui.placeDelete(GM, [h(FORGE)]);
check('hiding it twice is refused', papyrus('Disable').length === 0 && /already hidden/.test(said()));

reset(); ui.placeList(GM, []);
const lp = out.packets.find((p) => p[1].customPacketType === 'adminPlacements');
const row = lp && lp[1].items.find((r) => r.id === 'w1a2b3');
check('the Placed near me list shows it, with no base so Edit stays off', row && /^Hidden: CraftingBlacksmithForge/.test(row.name) && row.base === undefined && row.dist === 1 && row.mine === true && lp[1].here === 1, JSON.stringify(lp && lp[1]));

// The resend: a later arrival is enabled by 0.3.101 (props.disabled vs isDisabled), so the hide goes out again near players
reset(); timers.worldEditResend.fn();
check('the resend timer hides it again while a player is near', papyrus('Disable').length === 1 && timers.worldEditResend.ms === 4000);
set(GM, 'pos', [50000, 2000, 300]); set(PLAYER, 'pos', [50000, 2000, 300]);
reset(); timers.worldEditResend.fn();
check('and does nothing with nobody near', papyrus('Disable').length === 0);
set(GM, 'pos', [1000, 2000, 300]); set(PLAYER, 'pos', [1000, 2000, 300]);

reset(); ui.placeUndo(GM, []);
check('End (Undo) shows it again', papyrus('Enable').length === 1 && papyrus('Enable')[0][1] === FORGE && /back as its plugin has it/.test(said()) && !file().edits['1a2b3'], said());
reset(); ui.placeUndo(GM, []);
check('Undo again takes back nothing more', papyrus('Enable').length === 0 && papyrus('Disable').length === 0 && /Nothing to undo/.test(said()), said());

reset(); ui.placeDelete(GM, [h(FORGE)]); ui.placeDelete(GM, ['w1a2b3', 'list']);
check('Remove on its list row shows it again and sends the list', papyrus('Enable').length === 1 && !file().edits['1a2b3'] && out.packets.some((p) => p[1].customPacketType === 'adminPlacements'), said());
reset(); ui.placeUndo(GM, []);
check('and Undo of that hides it again', papyrus('Disable').length === 1 && file().edits['1a2b3'].hidden === true, said());

// Another GM's edit needs the others right (developer here); GM2 is a Lead GM
reset(); ui.placeDelete(GM2, ['w1a2b3', 'list']);
check("another GM's hide needs the others right", papyrus('Enable').length === 0 && /Another GM edited that/.test(said()), said());

reset(); ui.placeGoto(GM, ['w1a2b3']);
const go = calls.find((c) => c[0] === 'set' && c[2] === 'locationalData');
check('Go to on a world row moves the GM next to it', go && go[1] === GM && go[3].pos[1] === 2000 - 140 && go[3].cellOrWorldDesc === WHERE);
set(GM, 'pos', [1000, 2000, 300]);

// ---- what is refused ----
reset(); ui.placeDelete(GM, [h(WALL)]);
check('a static (no server form) is refused until the 0.3.102 client', papyrus('Disable').length === 0 && /WRWallStone01 \(STAT\) is not kept by the server, so only the 0.3.102 client/.test(said()), said());
reset(); ui.placeDelete(GM, [h(DOOR)]);
check('a door is refused', papyrus('Disable').length === 0 && /Doors are left alone/.test(said()), said());
reset(); ui.placeDelete(GM, [h(BANDIT)]);
check('a plugin actor is refused', /spawn zone/.test(said()), said());
reset(); ui.placeDelete(GM, [h(FAR)]);
check('a reference far from the GM is refused', papyrus('Disable').length === 0 && /too far away/.test(said()), said());
reset(); ui.placeDelete(GM, ['77777']);
check('an id no plugin has is refused', /No plugin has a reference 77777/.test(said()), said());
reset(); ui.placeMove(GM, [h(FORGE), [1150, 2000, 300], [0, 0, 0]]);
check('moving a plugin object needs the 0.3.102 client', papyrus('SetPosition').length === 0 && /needs the 0.3.102 client/.test(said()), said());
reset(); ui.placeDelete(GM, ['ff000999']);
check('dynamic ids still go to the placement list as before', /Only things placed with the Place tab/.test(said()), said());

// ---- chat commands ----
reset(); commands.worldshow(GM, '0x1a2b3');
check('/worldshow puts it back', papyrus('Enable').length === 1 && !file().edits['1a2b3'], said());
reset(); commands.worldhide(GM, '1a2b3');
check('/worldhide hides it', papyrus('Disable').length === 1 && file().edits['1a2b3'].hidden, said());
reset(); commands.worldedits(GM, '');
check('/worldedits lists what is edited near the GM', /1 plugin objects edited/.test(said()) && /Hidden: CraftingBlacksmithForge, 1 m away, ref 1a2b3/.test(said()), said());
reset(); commands.worldhide(GM, 'zz');
check('/worldhide without an id explains itself', /Use: \/worldhide/.test(said()));

// ---- a restart: the list is read back from the file, and the server's change form had kept isDisabled ----
delete globalThis.__dboWorldEdit;
delete globalThis.__dboPlacement;
reset(); load({ placement: { rights: { world: 'leadgm' } } });
ui.placeList(GM, []);
const lp2 = out.packets.find((p) => p[1].customPacketType === 'adminPlacements');
check('after a restart the hide is still listed', lp2 && lp2[1].items.some((r) => r.id === 'w1a2b3'));
reset(); timers.worldEditResend.fn();
check('and the resend keeps sending it', papyrus('Disable').length === 1);
reset(); ui.worldEditsRequest(PLAYER, []);
check('worldEditsRequest is not answered while client is off', out.packets.length === 0);

// ---- with config placement.worldEdit.client (0.3.102 offered): statics, moves and the worldEdits list ----
delete globalThis.__dboWorldEdit;
reset(); load({ placement: { rights: { world: 'leadgm' }, worldEdit: { client: true, resendMs: 0 } } });
reset(); ui.placeDelete(GM, [h(WALL)]);
const we = out.packets.filter((p) => p[1].customPacketType === 'worldEdits');
check('a static can be hidden: no Papyrus (no form), the list goes to every online client', papyrus('Disable').length === 0 && file().edits['2c3d4'] && file().edits['2c3d4'].serverForm === false && we.length === 2 && we[0][1].edits.some((e) => e.ref === WALL && e.hide === true), said());
check('its where is the GM\'s and its pose the plugin\'s', file().edits['2c3d4'].where === WHERE && file().edits['2c3d4'].orig.pos.join() === '1200,2050,300');
reset(); ui.placeSelect(GM, [h(FORGE)]);
const ed = out.packets.find((p) => p[1].customPacketType === 'placeEdit');
check('Enter on a plugin object starts the edit mode on its base and pose', ed && ed[1].id === '1a2b3' && ed[1].base === 'bbcf1:Skyrim.esm' && ed[1].kind === 'object' && ed[1].pos.join() === '1100,2000,300', JSON.stringify(ed));
reset(); ui.placeMove(GM, [h(FORGE), [1150, 2010, 300], [0, 0, 45]]);
const sp = papyrus('SetPosition');
const we2 = out.packets.filter((p) => p[1].customPacketType === 'worldEdits');
check('the edit mode\'s Enter moves it: server pose and the list for clients', sp.length === 1 && sp[0][2].join() === '1150,2010,300' && papyrus('SetAngle')[0][2].join() === '0,0,45' && we2.length && we2[0][1].edits.find((e) => e.ref === FORGE).pos.join() === '1150,2010,300', JSON.stringify(calls));
check('it stays hidden while moved', file().edits['1a2b3'].hidden === true && file().edits['1a2b3'].moved.rot[2] === 45);
reset(); ui.placeUndo(GM, []);
check('Undo moves it back to the plugin pose', papyrus('SetPosition').length === 1 && papyrus('SetPosition')[0][2].join() === '1100,2000,300' && !file().edits['1a2b3'].moved, JSON.stringify(calls));
reset(); ui.worldEditsRequest(PLAYER, []);
const wr = out.packets.find((p) => p[1].customPacketType === 'worldEdits');
check('a client asking for the list gets it', wr && wr[0] === PLAYER && wr[1].edits.length === 2);
reset(); ui.worldEditsRequest(PLAYER, []);
check('and not again within 5 s', out.packets.length === 0);

process.chdir(home);
fs.rmSync(dir, { recursive: true, force: true });
console.log('');
console.log(failures ? `${failures} FAILURES` : 'all checks passed');
process.exit(failures ? 1 : 0);
