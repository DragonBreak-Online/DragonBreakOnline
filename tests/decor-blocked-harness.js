// decor.js takes down a blocked piece (decor.blockBases) wherever it stands, refunds its whole cost to the home's owner, and
// leaves it out of the catalogue (Jake, 28 Oct: Neem #LBRF crashed on every login in Aubert's House). The Bruma Banner
// (CYRBrumaBanner02, 2a7f:BSHeartland.esm) crashes every game that loads it once placed, at SkyrimSE.exe+2E3C27 in the
// background 3D load: profile 97's game crashed 2 s after placing one (28 Oct 03:38:55Z) and on every login after, and
// profile 67's 40 s after theirs (27 Oct). Runs the real decor.js with the real decor-catalog.json in a scratch folder,
// with the two homes as decor.json held them (Neem's banner and loom, profile 67's banner).
//   node tests/decor-blocked-harness.js   (from server/)
'use strict';
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
fs.writeFileSync('decor.json', JSON.stringify({ places: {
  '806ca04': { owner: 97, ownerChar: NEEM, decorators: [], items: [
    { ref: 'ff00207d', base: '801:MoreCraftableEquipment.esp', name: 'Weaving Loom', group: 'workbenches', cell: 0x806ca03, pos: [0, 0, 0], rot: [0, 0, 0], by: 97, char: NEEM, at: '2026-10-28T03:29:43.956Z', paid: { [LINEN]: 1 } },
    banner('ff00219a', 0x806ca03, 97, NEEM)] },
  '8067670': { owner: 67, ownerChar: PAX, decorators: [], items: [banner('ff0025fc', 0x806765e, 67, PAX)] },
}, owed: {}, carpentry: {} }));

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
for (const k of Object.keys(globalThis)) if (/^__dboDecor/.test(k)) delete globalThis[k];
const mod = require(path.join(ROOT, 'decor.js'))({ mp, log: () => {}, personal: (a, t) => said.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `P${(a >>> 0).toString(16)}`,
  onUi: () => {}, sendPacket: () => true, registerChatCommand: (n, f) => { cmds[n] = f; }, onlineActors: () => online.slice(), isAdmin: () => false, giveItem, findByName: () => 0,
  every: () => {}, itemName: (d) => d, cfg: { decor: { enabled: true } } });
const reg = () => JSON.parse(fs.readFileSync(path.join(scratch, 'decor.json'), 'utf8'));

// On load (a hot reload): both banners come down, the loom stays
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

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
