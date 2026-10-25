// The minotaurs back at Minotaur's Rest (Nat, 25 Oct), gated on the dev axe test. Against the real wildlife.js and bosses.js:
//   1. ownedSpawns.replace.minotaur.exceptGroups leaves Minotaur's Rest (17857a) to the plugin's own minotaurs, hostile
//      (hostileKinds minotaur), while Sancre Tor (1833e2) keeps its undead; without it both are undead, as live today;
//   2. ownedSpawns.rearm puts each minotaur's axe back in its inventory by its base, once, and traceKinds logs what it
//      wears at spawn and at each change;
//   3. bosses.js re-arms the Minotaur Lord's minotaur adds (rearmAdds) in test 2 and the live definition, not in test 1.
//   node tests/minotaur-rest-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!c) fails++; };
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
const OWNED = JSON.parse(fs.readFileSync(path.join(ROOT, 'owned-spawns.json'), 'utf8'));
const REST = '17857a:DragonBreak Online Edits.esp', SANCRE = '1833e2:DragonBreak Online Edits.esp';
const MINO = '8b600:BSHeartland.esm', LORD = 'd6fe5:BSHeartland.esm', WAR_AXE = '6026e6:BSAssets.esm', LORD_AXE = '6026df:BSAssets.esm';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-minorest-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
const minos = OWNED.spawns.filter((s) => s.kind === 'minotaur' && (s.group === REST || s.group === SANCRE));
fs.writeFileSync(path.join(dir, 'owned-spawns.json'), JSON.stringify({ spawns: minos, camps: [] }));
fs.writeFileSync(path.join(dir, 'wildlife.json'), JSON.stringify({ placements: [], giantCamps: [] }));
for (const f of ['loot.json', 'artifacts.json', 'dragon-materials.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
ok(minos.filter((s) => s.group === REST).length === 3 && minos.filter((s) => s.group === SANCRE).length > 3, 'Minotaur\'s Rest has its three minotaur spots (the Lord\'s among them); Sancre Tor its own');

const PLUGINS = { 'Skyrim.esm': 0, 'BSAssets.esm': 7, 'BSHeartland.esm': 8, 'DragonBreak Online Edits.esp': 0x49 };
const idOf = (d) => { const [h, p] = String(d).split(':'); if (!(p in PLUGINS)) throw new Error('no plugin ' + p); return ((PLUGINS[p] << 24) | parseInt(h, 16)) >>> 0; };
const props = new Map(), logs = [];
const mp = { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v), getIdFromDesc: idOf };
const cwd = process.cwd();
const savedInterval = global.setInterval, savedClear = global.clearInterval;
globalThis.__dboWildFactionAudit = ' (skipped in the harness)';
const load = (ownedSpawns) => {
  try { fs.unlinkSync(path.join(dir, 'NPC-Spawns.json')); } catch (e) { /* first */ }
  process.chdir(dir); global.setInterval = () => ({ unref() {} }); global.clearInterval = () => {}; globalThis.__dboWildSig = undefined;
  try {
    delete require.cache[path.join(ROOT, 'wildlife.js')];
    require(path.join(ROOT, 'wildlife.js'))({ mp, log: (...x) => logs.push(x.join(' ')), personal: () => {}, system: () => {}, registerChatCommand: () => {}, giveItem: () => true,
      profileOf: () => -1, display: String, who: String, audit: () => {}, isAdmin: () => false, cfg: { ownedSpawns }, onlineActors: () => [], sendPacket: () => {} });
    return JSON.parse(fs.readFileSync(path.join(dir, 'NPC-Spawns.json'), 'utf8')).zones;
  } finally { process.chdir(cwd); global.setInterval = savedInterval; global.clearInterval = savedClear; }
};
const live = JSON.parse(JSON.stringify(CFG.ownedSpawns));
const kindOfZone = (z) => z.Name.split(':')[1];
const restZones = (zs) => zs.filter((z) => /p17857[f]|p17858[01]/.test(z.Name) || minos.filter((s) => s.group === REST).some((s) => z.Name.includes(`p${s.src.split(':')[0]}`)));
const sancreZones = (zs) => zs.filter((z) => minos.filter((s) => s.group === SANCRE).some((s) => z.Name.includes(`p${s.src.split(':')[0]}`)));

// ---- 1. today's config: undead in both ----
let z = load(live);
ok(restZones(z).length === 3 && restZones(z).every((x) => kindOfZone(x) === 'undead') && sancreZones(z).every((x) => kindOfZone(x) === 'undead'), 'the live config as it stands: undead at Minotaur\'s Rest and Sancre Tor alike', restZones(z).map((x) => x.Name));
// ---- with the exception and the arming ----
const withRest = JSON.parse(JSON.stringify(live));
withRest.replace.minotaur.exceptGroups = [REST];
withRest.rearm = { minotaur: { [MINO]: WAR_AXE, [LORD]: LORD_AXE } };
withRest.traceKinds = ['minotaur'];
z = load(withRest);
const rz = restZones(z);
ok(rz.length === 3 && rz.every((x) => kindOfZone(x) === 'minotaur' && x.Hostile === true), 'exceptGroups [Minotaur\'s Rest]: its three spots spawn minotaurs again, hostile (hostileKinds minotaur)', rz);
ok(rz.some((x) => x.NPC[0].id === LORD) && rz.filter((x) => x.NPC[0].id === MINO).length === 2, '...the Minotaur Lord on his spot and two minotaurs, one each');
ok(sancreZones(z).length && sancreZones(z).every((x) => kindOfZone(x) === 'undead'), 'Sancre Tor keeps its undead');

// ---- one Lord: the camp's own Lord spot left out while the boss stands there ----
const oneLord = JSON.parse(JSON.stringify(withRest));
oneLord.leaveOut = ['178580:DragonBreak Online Edits.esp'];
const lz = restZones(load(oneLord));
ok(lz.length === 2 && lz.every((x) => x.NPC[0].id === MINO && kindOfZone(x) === 'minotaur'), 'ownedSpawns.leaveOut [178580]: the camp\'s own Minotaur Lord spot spawns nothing, its two minotaurs stay (one Lord: the boss)', lz.map((x) => x.Name));
z = load(withRest);

// ---- 2. the arming and the trace ----
const ids = rz.map((x, i) => 0xff800000 + i);
rz.forEach((x, i) => { props.set(`${ids[i]}|private.npcSpawner`, x.Name); props.set(`${ids[i]}|baseDesc`, x.NPC[0].id); props.set(`${ids[i]}|inventory`, { entries: [] }); props.set(`${ids[i]}|equipment`, { inv: { entries: [] } }); });
fs.writeFileSync(path.join(dir, 'zone-spawns.json'), JSON.stringify(ids));
logs.length = 0;
process.chdir(dir); try { globalThis.__dboOwnedFactionTick(); globalThis.__dboOwnedTraceTick(); } finally { process.chdir(cwd); }
const invHas = (id, w) => (props.get(`${id}|inventory`).entries || []).some((e) => e.baseId === idOf(w));
const lordId = ids[rz.findIndex((x) => x.NPC[0].id === LORD)], minoId = ids[rz.findIndex((x) => x.NPC[0].id === MINO)];
ok(invHas(lordId, LORD_AXE) && invHas(minoId, WAR_AXE) && !invHas(minoId, LORD_AXE), 'each minotaur gets its own axe back by its base: the Lord his, the others the war axe', logs);
ok(logs.filter((l) => /^wildlife: minotaur ff8000\d\d rearmed with /.test(l)).length === 3 && logs.filter((l) => /equipment at spawn: \[\]/.test(l)).length === 3, '...logged, and the trace logs what each wears at spawn', logs);
props.set(`${minoId}|equipment`, { inv: { entries: [{ baseId: idOf(WAR_AXE), worn: true }] } });
logs.length = 0;
process.chdir(dir); try { globalThis.__dboOwnedTraceTick(); } finally { process.chdir(cwd); }
ok(logs.length === 1 && /equipment changed: \["[0-9a-f]*6026e6"\]/.test(logs[0]), 'a change of what one wears is one line: the axe in hand', logs);

// ---- 3. bosses.js: the Lord's adds ----
const B = JSON.parse(fs.readFileSync(path.join(ROOT, 'bosses.json'), 'utf8')).bosses;
const bdef = (id) => B.find((b) => b.id === id);
ok(['minotaurlord', 'minotaurtest1', 'minotaurtest2'].every((id) => bdef(id).adds.some((a) => a.options[0][1] === MINO)), 'the Minotaur Lord\'s adds are Minotaur\'s Rest\'s own minotaurs (CYREncMinotaur)');
ok(bdef('minotaurtest2').rearmAdds === WAR_AXE && bdef('minotaurlord').rearmAdds === WAR_AXE && !bdef('minotaurtest1').rearmAdds, 'test 2 and the live Lord re-arm the adds\' war axes; test 1 leaves them as they are');
const bsrc = fs.readFileSync(path.join(ROOT, 'bosses.js'), 'utf8');
ok(/r\.boss\.rearmAdds/.test(bsrc) && /rearm\(r\.boss, id, r\.boss\.rearmAdds\)/.test(bsrc), 'bosses.js re-arms a boss\'s adds once each');

console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
