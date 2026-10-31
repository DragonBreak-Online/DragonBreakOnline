// Dwarven gear gives steel at the smelter (loottiers.js LOOT_ONLY_METALS: Dwarven ingots come only from Dwemer scrap,
// Nate 4 Oct), and the panel, the item's page and the smelter's result line say why (salvage.js capNotes; the Leader,
// 31 Oct). Gear with no capped metal says nothing extra.
//   node tests/salvage-dwarven-note-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'salvage.js');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-salvagedwarf-'));
const home = process.cwd();
process.chdir(scratch);

const NOTE = "Dwarven metal can't be reclaimed from finished gear; salvage Dwemer scrap for ingots";
const IRON = 0x5ace4, STEEL = 0x5ace5, DWARVEN = 0xdb8a2, DWARF_SWORD = 0x1399b, SWORD = 0x12eb7;
const SMELTER = 0x9000, SMELTER_BASE = 0x9001;
const PLAYER = 0xff000001;
const desc = (id) => `${id.toString(16)}:Skyrim.esm`;
const fromDesc = (d) => parseInt(String(d).split(':')[0], 16) >>> 0;
const NAMES = { [IRON]: 'Iron Ingot', [STEEL]: 'Steel Ingot', [DWARVEN]: 'Dwarven Metal Ingot', [DWARF_SWORD]: 'Dwarven Sword', [SWORD]: 'Iron Sword' };
fs.writeFileSync('salvage.json', JSON.stringify({ items: {
  [desc(DWARF_SWORD)]: ['smelter', 0, [[desc(DWARVEN), 2], [desc(IRON), 1]]],
  [desc(SWORD)]: ['smelter', 0, [[desc(IRON), 2]]],
} }));
// The cap is read with the gear swap's list; an empty one leaves only the mined metals (Dwarven among them)
fs.writeFileSync('gear-swap.json', JSON.stringify({ metals: {} }));

const kwda = (...ids) => { const d = new Uint8Array(ids.length * 4); ids.forEach((id, i) => new DataView(d.buffer).setUint32(i * 4, id, true)); return { type: 'KWDA', data: d }; };
const RECS = { [SMELTER_BASE]: { type: 'FURN', fields: [kwda(0x8001)] }, 0x8001: { type: 'KYWD', editorId: 'CraftingSmelter', fields: [] } };
let INV;
const said = [], widgets = [], ui = {}, logs = [];
const mp = {
  get: (id, k) => (k === 'inventory' ? { entries: INV[id] } : k === 'baseDesc' && id === SMELTER ? desc(SMELTER_BASE) : null),
  set: (id, k, v) => { if (k === 'inventory') INV[id] = v.entries; },
  getDescFromId: desc, getIdFromDesc: fromDesc,
};
const count = (id) => INV[PLAYER].filter((e) => e.baseId === id).reduce((n, e) => n + e.count, 0);
const api = (cfg) => ({
  mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push(t), who: String, cfg,
  openWidget: (a, w) => widgets.push(w), closeWidget: () => widgets.push(null),
  onUi: (n, f) => { (ui[n] = ui[n] || []).push(f); },
  masteryOf: () => ({ order: ['blacksmith'], skills: { blacksmith: { rank: 4 } } }),
  recordOf: (id) => (RECS[id] ? { record: RECS[id], toGlobalRecordId: (l) => l } : null),
  fieldsOf: (lr, t) => ((lr && lr.record.fields) || []).filter((f) => f.type === t),
  giveItem: (a, id, n) => { const e = INV[a].find((x) => x.baseId === id); if (e) e.count += n; else INV[a].push({ baseId: id, count: n }); return true; },
  itemName: (d) => NAMES[fromDesc(d)] || '', distanceMeters: () => 1,
});
const load = (cfg = {}) => { for (const k of Object.keys(ui)) delete ui[k]; globalThis.__dboSalvage = undefined; widgets.length = 0; said.length = 0; logs.length = 0; return require(MODULE)(api(cfg)); };
const choose = (id) => (ui.salvageChoose || []).forEach((f) => f(PLAYER, [id]));
const last = () => widgets[widgets.length - 1];
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

let S = load();
const y = S.yieldOf(DWARF_SWORD, S.stationOf(SMELTER), 4);
ok(y && y.some(([d]) => fromDesc(d) === STEEL) && !y.some(([d]) => fromDesc(d) === DWARVEN), 'a Dwarven sword gives steel, no Dwarven ingot', y);
ok(y && y.notes.length === 1 && y.notes[0].startsWith(NOTE), '...and carries the note', y && y.notes);
const yi = S.yieldOf(SWORD, S.stationOf(SMELTER), 4);
ok(yi && yi.notes.length === 0, 'an iron sword carries no note', yi && yi.notes);

// The breakdown panel
INV = { [PLAYER]: [{ baseId: DWARF_SWORD, count: 2 }, { baseId: SWORD, count: 1 }] };
ok(globalThis.__dboSalvageActivate(SMELTER, PLAYER) === true, 'the panel opens');
ok(last().targetName.includes(NOTE), 'the breakdown panel says why Dwarven gear gives steel', last().targetName);
ok(!last().targetName.includes('..') && !/\.$/.test(last().targetName), '...in one clean sentence run', last().targetName);
INV = { [PLAYER]: [{ baseId: SWORD, count: 1 }] };
globalThis.__dboSalvageActivate(SMELTER, PLAYER);
ok(!last().targetName.includes(NOTE), 'a panel with no Dwarven gear says nothing of it', last().targetName);

// The item's page, then the smelter's result line
INV = { [PLAYER]: [{ baseId: DWARF_SWORD, count: 2 }, { baseId: SWORD, count: 1 }] };
globalThis.__dboSalvageActivate(SMELTER, PLAYER);
choose(`b:${SWORD}`);
ok(!last().targetName.includes(NOTE), "the iron sword's page says nothing of it", last().targetName);
choose('list');
choose(`b:${DWARF_SWORD}`);
ok(last().targetName.includes(NOTE), "the Dwarven sword's page says it", last().targetName);
choose(`x1:${DWARF_SWORD}`);
ok(count(DWARF_SWORD) === 1 && count(STEEL) >= 1 && count(DWARVEN) === 0, 'breaking one gives steel and no Dwarven ingot', INV[PLAYER]);
ok(/Dwarven Sword broken down: .*Steel Ingot.*\. Dwarven metal can't be reclaimed/.test(last().targetName), 'the smelter line says it after what came back', last().targetName);
ok(last().targetName.split(NOTE).length === 2 && !last().targetName.includes('..'), '...once, with no doubled stop', last().targetName);
ok(logs.some((l) => /broke down Dwarven Sword/.test(l)) && !logs.some((l) => l.includes(NOTE)), 'the log keeps the plain line');

// The last one, nothing else to break: the line goes to chat
INV = { [PLAYER]: [{ baseId: DWARF_SWORD, count: 1 }] };
globalThis.__dboSalvageActivate(SMELTER, PLAYER);
choose(`b:${DWARF_SWORD}`);
choose(`x1:${DWARF_SWORD}`);
const line = said[said.length - 1] || '';
ok(line.includes(NOTE) && /Nothing else here to break down\.$/.test(line) && !line.includes('..'), 'the last break says it in chat too', line);

// Config can silence it
S = load({ salvage: { capNotes: {} } });
INV = { [PLAYER]: [{ baseId: DWARF_SWORD, count: 2 }] };
globalThis.__dboSalvageActivate(SMELTER, PLAYER);
ok(!last().targetName.includes(NOTE), 'capNotes {} says nothing', last().targetName);

process.chdir(home);
fs.rmSync(scratch, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
