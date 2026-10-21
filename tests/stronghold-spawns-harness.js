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
  const z = load(true);
  const kinds = (b) => z.filter((x) => x.NPC[0].id === b).length;
  ok(z.length === 11 && kinds('4359c:Skyrim.esm') === 6 && kinds('23a90:Skyrim.esm') === 3 && kinds('a91a0:Skyrim.esm') === 2, 'with the plugin: the livestock spawns, 6 EncGoatDomestic, 3 EncCow, 2 EncChicken', z.map((x) => x.Name));
  ok(z.every((x) => x.hostile === false), '...never hostile');
  ok(!z.some((x) => /chief|blacksmith|guards|miners/.test(x.Name)), '...and no resident yet: the roster waits on Nat (approved false, no base)');
  const approved = JSON.parse(JSON.stringify(S)); const chief = approved.sites[0].spawns.find((s) => s.role === 'chief'); chief.approved = true; chief.base = '13b97:Skyrim.esm';
  const z2 = load(true, approved);
  ok(z2.some((x) => x.Name === 'wild:cracked-tusk:chief' && x.ID === '1526a:Skyrim.esm' && x.hostile === false), 'an approved role with a base spawns in its cell, not hostile', z2.map((x) => x.Name));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
