// A stronghold's own people and beasts (stronghold-spawns.json, wildlife.js; Cracked Tusk, Nat 20 Oct): against the real
// wildlife.js and data, with the plugin a spawn's anchor lives in present or not.
//   node tests/stronghold-spawns-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!c) fails++; };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const CFG = readJson('gamemode-config.json');
const base = fs.existsSync('/dev/shm') ? '/dev/shm' : require('os').tmpdir();
const dir = fs.mkdtempSync(path.join(base, 'claude-nate-wd-strong-'));
const savedInterval = global.setInterval, savedClear = global.clearInterval;
const cwd = process.cwd();
// ctkLoaded: whether CrackedTuskKeepExpanded.esp resolves (the server's load order has it); data: the spawns file to use
const load = (ctkLoaded, data) => {
  for (const f of ['wildlife.json', 'owned-spawns.json', 'loot.json', 'artifacts.json', 'blackreach.json', 'dragon-materials.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'stronghold-spawns.json'), JSON.stringify(data || readJson('stronghold-spawns.json')));
  try { fs.unlinkSync(path.join(dir, 'NPC-Spawns.json')); } catch (e) { /* first load */ }
  process.chdir(dir);
  global.setInterval = () => ({ unref() {} }); global.clearInterval = () => {};
  globalThis.__dboWildFactionAudit = ' (skipped in the harness)';
  delete require.cache[path.join(ROOT, 'wildlife.js')];
  globalThis.__dboWildSig = undefined;
  const props = new Map();
  try {
    require(path.join(ROOT, 'wildlife.js'))({ mp: { get: (id, k) => props.get(`${id}|${k}`), set: (id, k, v) => props.set(`${id}|${k}`, v),
      getIdFromDesc: (d) => (/crackedtuskkeepexpanded\.esp$/i.test(String(d)) ? (ctkLoaded ? 0x5000123 : 0) : 0x1234) },
    log: () => {}, personal: () => {}, system: () => {}, registerChatCommand: () => {}, giveItem: () => true, profileOf: () => 1,
    display: String, who: String, audit: () => {}, isAdmin: () => false, cfg: { wildlife: CFG.wildlife, ownedSpawns: CFG.ownedSpawns, blackreach: CFG.blackreach }, onlineActors: () => [], sendPacket: () => {} });
    return JSON.parse(fs.readFileSync(path.join(dir, 'NPC-Spawns.json'), 'utf8')).zones.filter((z) => /^wild:cracked-tusk:/.test(z.Name));
  } finally { process.chdir(cwd); global.setInterval = savedInterval; global.clearInterval = savedClear; }
};
try {
  const S = readJson('stronghold-spawns.json'), site = S.sites.find((s) => s.id === 'cracked-tusk');
  ok(!!site && site.clan === 'clan-cracked-tusk', 'stronghold-spawns.json lists Cracked Tusk for clan-cracked-tusk');
  ok(site.spawns.every((s) => /crackedtuskkeepexpanded\.esp$/i.test(s.anchor)), 'every spawn is anchored on a CrackedTuskKeepExpanded.esp ref');
  ok(!site.spawns.some((s) => /^1cb2c:/i.test(s.base || '')), 'no spawn is DA14Goat (1cb2c), the unique quest goat');
  ok(load(false).length === 0, 'INERT while the plugin is not loaded: no wild:cracked-tusk zone');
  // Nate, 21 Oct: no AI at Cracked Tusk, a player-run stronghold like the others: even with the plugin loaded, nothing spawns
  const z = load(true);
  ok(z.length === 0, 'with the plugin loaded: no wild:cracked-tusk zone at all (every row approved:false)', z.map((x) => x.Name));
  // The mechanism still works if a row is ever approved again: one row approved spawns, the rest stay held
  const one = JSON.parse(JSON.stringify(S)); one.sites[0].spawns[0].approved = true;
  ok(load(true, one).length === 1, 'a single row set approved spawns alone');
  const held = JSON.parse(JSON.stringify(S));
  ok(!load(true, held).some((x) => x.Name === 'wild:cracked-tusk:chief'), 'a spawn set approved:false is held back');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
