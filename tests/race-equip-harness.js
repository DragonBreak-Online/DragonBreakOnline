// Scripted test for a people's own armour in gamemode.js (raceEquipCheck): goblin armour on anyone but a goblin comes off.
// No server and no game: run it from this folder's parent with `node tests/race-equip-harness.js`.
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'gamemode.js'), 'utf8');
const from = src.indexOf("// A people's own armour, worn by them alone"), to = src.indexOf('const equipHook = (actorId, equipment, isAllowed, ...rest) => {');
if (from < 0 || to < 0) { console.error('raceEquip block markers not found in gamemode.js'); process.exit(1); }
let fails = 0; const ok = (c, m, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${m}${c ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const GOB_ARMOR = 0x4b0001, IRON = 0x12e49, GOB_WEAP = 0x4b0002;
const records = { [GOB_ARMOR]: { type: 'ARMO', editorId: 'DBOArm_GoblinHideArmor' }, [IRON]: { type: 'ARMO', editorId: 'ArmorIronCuirass' }, [GOB_WEAP]: { type: 'WEAP', editorId: 'DBOArm_GoblinSpear' } };
const calls = [], said = [], logs = []; let race = 'nord';
const mp = { callPapyrusFunction: (...x) => calls.push(x), getDescFromId: (id) => (id >>> 0).toString(16) };
const wornOf = (equipment) => (equipment.inv.entries || []).filter((e) => e.worn || e.wornLeft).map((e) => ({ baseId: e.baseId >>> 0, left: !!e.wornLeft }));
const load = (cfg) => new Function('mp', 'cfg', 'log', 'display', 'recordOf', 'personal', 'sendPacket', 'wornOf', 'setTimeout', `${src.slice(from, to)}; return raceEquipCheck;`)(
  mp, cfg, (...x) => logs.push(x.join(' ')), String, (id) => (records[id] ? { record: records[id] } : null), (a, t) => said.push(t), () => true, wornOf, (fn) => fn());
globalThis.__dboRaceOf = () => race;
let check = load({});
const eq = (...ids) => ({ inv: { entries: ids.map((id) => ({ baseId: id, count: 1, worn: true })) } });
check(0x14, eq(GOB_ARMOR, IRON));
ok(calls.length === 1 && calls[0][2] === 'UnequipItem' && calls[0][4][0].desc === GOB_ARMOR.toString(16) && /fits only a goblin/.test(said[0] || ''), 'a Nord wearing goblin armour: it comes off, told why; the iron stays', { calls, said });
calls.length = 0; said.length = 0; race = 'goblin';
check(0x14, eq(GOB_ARMOR));
ok(!calls.length && !said.length, 'a goblin wears it');
race = ''; check(0x14, eq(GOB_ARMOR));
ok(!calls.length, 'an unknown race (beast form, no overhaul) is left alone');
race = 'orc'; check(0x14, eq(GOB_WEAP));
ok(!calls.length, 'the rule is for armour only');
check = load({ raceEquip: [] }); check(0x14, eq(GOB_ARMOR));
ok(!calls.length, 'raceEquip [] turns it off');
ok(/if \(isAllowed\) \{ try \{ raceEquipCheck\(a, equipment\); \}/.test(src), 'the equip hook calls it on an allowed report');
delete globalThis.__dboRaceOf;
console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
