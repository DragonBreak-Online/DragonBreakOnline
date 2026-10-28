// decor.js takes down a blocked piece (decor.blockBases) wherever it stands, refunds its whole cost to the home's owner, and
// leaves it out of the catalogue (Jake, 28 Oct: Neem #LBRF crashed on every login in Aubert's House). The Bruma Banner
// (CYRBrumaBanner02, 2a7f:BSHeartland.esm) crashes every game that loads it once placed, at SkyrimSE.exe+2E3C27 in the
// background 3D load: profile 97's game crashed 2 s after placing one (28 Oct 03:38:55Z) and on every login after, and
// profile 67's 40 s after theirs (27 Oct). Runs the real decor.js with the real decor-catalog.json in a scratch folder,
// with the two homes as decor.json held them (Neem's banner and loom, profile 67's banner): once on a cold boot, and once
// as the live hot reload does it, over the decor.js the server runs now (5ee767236) in the same process, whose cached
// registry has no recalled map (C's review of 9be6e04ed).
//   node tests/decor-blocked-harness.js   (from server/)
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const scratch = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-jake-b-decor-blocked-'));
process.on('exit', () => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
for (const f of ['decor-catalog.json', 'decor-growing.json']) if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(scratch, f));
process.chdir(scratch);
const NEEM_DOOR = 0x806ca04, PAX_DOOR = 0x8067670, NEEM = 0xff001715, PAX = 0xff0010f0;
const LINEN = '34cd6:Skyrim.esm';   // RuinsLinenPile01, what the banner cost
fs.writeFileSync('housing.json', JSON.stringify([NEEM_DOOR, PAX_DOOR]));
fs.writeFileSync('doors-pos.json', JSON.stringify({ doors: {} }));
fs.writeFileSync('skills.json', JSON.stringify({ skills: [] }));
fs.writeFileSync('admin-placeables.json', JSON.stringify({ categories: [] }));
const banner = (ref, cell, by, char) => ({ ref, base: '2a7f:BSHeartland.esm', name: 'Bruma Banner', group: 'decor', cell, pos: [74.6, 206.8, 26.7], rot: [0, 0, 0], by, char, at: '2026-10-28T03:38:55.308Z', paid: { [LINEN]: 3 } });
const seed = () => fs.writeFileSync('decor.json', JSON.stringify({ places: {
  '806ca04': { owner: 97, ownerChar: NEEM, decorators: [], items: [
    { ref: 'ff00207d', base: '801:MoreCraftableEquipment.esp', name: 'Weaving Loom', group: 'workbenches', cell: 0x806ca03, pos: [0, 0, 0], rot: [0, 0, 0], by: 97, char: NEEM, at: '2026-10-28T03:29:43.956Z', paid: { [LINEN]: 1 } },
    banner('ff00219a', 0x806ca03, 97, NEEM)] },
  '8067670': { owner: 67, ownerChar: PAX, decorators: [], items: [banner('ff0025fc', 0x806765e, 67, PAX)] },
}, owed: {}, carpentry: {} }));
seed();

const props = new Map();
const setp = (id, k, v) => props.set(`${id >>> 0}|${k}`, v), getp = (id, k) => props.get(`${id >>> 0}|${k}`);
setp(NEEM_DOOR, 'private.housing', { owner: 97, ownerChar: NEEM }); setp(PAX_DOOR, 'private.housing', { owner: 67, ownerChar: PAX });
setp(NEEM, 'profileId', 97); setp(PAX, 'profileId', 67); setp(NEEM, 'inventory', { entries: [] }); setp(PAX, 'inventory', { entries: [] });
const deleted = [], said = [], audits = [], gifts = [], cmds = {};
let online = [];
const mp = {
  get: getp, set: setp,
  getIdFromDesc: (x) => parseInt(String(x).split(':')[0], 16) >>> 0,
  getDescFromId: (id) => (id >>> 0).toString(16),
  lookupEspmRecordById: () => null,
  callPapyrusFunction: (kind, cls, fn, self) => { if (fn === 'Delete') deleted.push((parseInt(self.desc, 16) >>> 0).toString(16)); return null; },
};
const giveItem = (a, baseId, count) => { gifts.push([a >>> 0, (baseId >>> 0).toString(16), count]); return true; };
// gamemode.js loads decor.js afresh on every hot reload; what it keeps is in the __dboDecor globals
const boot = (file) => {
  delete require.cache[require.resolve(file)];
  return require(file)({ mp, log: () => {}, personal: (a, t) => said.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `P${(a >>> 0).toString(16)}`,
    onUi: () => {}, sendPacket: () => true, registerChatCommand: (n, f) => { cmds[n] = f; }, onlineActors: () => online.slice(), isAdmin: () => false, giveItem, findByName: () => 0,
    every: () => {}, itemName: (d) => d, cfg: { decor: { enabled: true } } });
};
const coldBoot = () => { for (const k of Object.keys(globalThis)) if (/^__dboDecor/.test(k)) delete globalThis[k]; };
const NEW = path.join(ROOT, 'decor.js');
coldBoot();
let mod = boot(NEW);
const reg = () => JSON.parse(fs.readFileSync(path.join(scratch, 'decor.json'), 'utf8'));

// On a cold boot (the server starting): both banners come down, the loom stays
ok(deleted.includes('ff00219a') && deleted.includes('ff0025fc'), "on load both placed Bruma Banners are deleted (Neem's in Aubert's House and profile 67's)", deleted);
ok(!deleted.includes('ff00207d'), 'the Weaving Loom beside it is left alone', deleted);
const r1 = reg();
ok(r1.places['806ca04'].items.map((x) => x.ref).join() === 'ff00207d' && r1.places['8067670'].items.length === 0, 'decor.json keeps only the loom in Neem\'s home and nothing in the other', r1.places);
ok(r1.recalled && r1.recalled[`97:${NEEM}`] && r1.recalled[`97:${NEEM}`][LINEN] === 3 && r1.recalled[`67:${PAX}`][LINEN] === 3, 'each owner is owed the banner\'s whole cost', r1.recalled);
ok(audits.filter((t) => /^DECOR recalled place .* Bruma Banner ref ff0+[0-9a-f]+ base 2a7f:BSHeartland\.esm .*it crashes the game$/.test(t)).length === 2, 'each take-down is an audit line', audits);

// The owner online: paid back at the next owner scan, told why
online = [NEEM];
mod._test.scanOwners();
ok(gifts.some((g) => g[0] === NEEM && g[1] === '34cd6' && g[2] === 3), "Neem gets the 3 linen wraps back at the next scan", gifts);
ok(said.some(([a, t]) => a === NEEM && /taken down because it crashed the game/.test(t)), 'and is told why', said.map((x) => x[1]));
ok(!(reg().recalled || {})[`97:${NEEM}`] && (reg().recalled || {})[`67:${PAX}`], "Neem's debt is cleared; profile 67's waits until they are online", reg().recalled);
const before = deleted.length; mod._test.scanOwners();
ok(deleted.length === before, 'a later scan deletes nothing more');

// The catalogue: the banner cannot be found or placed again
cmds.decor(NEEM, 'find bruma banner');
ok(said.length && /Nothing matches/.test(said[said.length - 1][1]), '/decor find no longer offers the Bruma Banner', said[said.length - 1]);
cmds.decor(NEEM, 'find banner');
ok(!/Bruma Banner/.test(said[said.length - 1][1]) && /found/.test(said[said.length - 1][1]), 'other banners are still offered', said[said.length - 1][1].slice(0, 160));

// A hot reload over the decor.js live now (5ee767236): its registry, cached in the globals, has no recalled map
console.log('\n-- a hot reload over 5ee767236');
const OLD = path.join(scratch, 'decor-5ee767236.js');
fs.writeFileSync(OLD, execFileSync('git', ['-C', ROOT, 'show', '5ee767236:decor.js'], { encoding: 'utf8', maxBuffer: 1 << 26 }));
coldBoot(); seed();
deleted.length = 0; audits.length = 0; gifts.length = 0; said.length = 0; online = [];
const old = boot(OLD);
old._test.reg();
ok(globalThis.__dboDecor.reg && !('recalled' in globalThis.__dboDecor.reg) && deleted.length === 0, 'the old decor.js has the registry cached, without a recalled map, and deletes nothing', Object.keys(globalThis.__dboDecor.reg || {}));
cmds.decor(NEEM, 'find bruma banner');
ok(/1 found/.test(said[said.length - 1][1]) && /Bruma Banner/.test(said[said.length - 1][1]), 'the old catalogue still offers the Bruma Banner to /decor find', said[said.length - 1][1].slice(0, 120));
mod = boot(NEW);
const count = (ref) => deleted.filter((r) => r === ref).length;
ok(count('ff00219a') === 1 && count('ff0025fc') === 1 && count('ff00207d') === 0, 'after the reload both banners are deleted once each and the loom is left alone', deleted);
const h1 = reg();
ok(h1.places['806ca04'].items.map((x) => x.ref).join() === 'ff00207d' && h1.places['8067670'].items.length === 0, 'decor.json keeps only the loom', h1.places);
ok(h1.recalled && JSON.stringify(h1.recalled[`97:${NEEM}`]) === JSON.stringify({ [LINEN]: 3 }) && JSON.stringify(h1.recalled[`67:${PAX}`]) === JSON.stringify({ [LINEN]: 3 }), 'each owner is owed the banner\'s cost exactly once', h1.recalled);
ok(audits.filter((t) => /^DECOR recalled place /.test(t)).length === 2, 'two take-down audit lines', audits);
cmds.decor(NEEM, 'place 1');
ok(/not in the catalogue/.test(said[said.length - 1][1]), '/decor place 1 from the find made before the reload is refused', said[said.length - 1][1]);

// A second reload finds nothing more to take down and owes nothing twice
mod = boot(NEW);
ok(deleted.length === 2 && audits.filter((t) => /^DECOR recalled place /.test(t)).length === 2, 'a second reload deletes and audits nothing more', { deleted, audits });
const h2 = reg();
ok(JSON.stringify(h2.recalled) === JSON.stringify(h1.recalled) && JSON.stringify(h2.places) === JSON.stringify(h1.places), 'and leaves decor.json as it was', h2.recalled);
online = [NEEM];
mod._test.scanOwners(); mod._test.scanOwners();
const linen = gifts.filter((g) => g[0] === NEEM && g[1] === '34cd6').reduce((n, g) => n + g[2], 0);
ok(linen === 3, 'Neem is paid back 3 linen wraps once, over two scans', gifts);
ok(!(reg().recalled || {})[`97:${NEEM}`] && JSON.stringify(reg().recalled[`67:${PAX}`]) === JSON.stringify({ [LINEN]: 3 }), "Neem's debt is cleared; profile 67's waits", reg().recalled);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
