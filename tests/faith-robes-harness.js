// The faiths' robes (Divine and Daedric Robes, Nexus 145124) and the Knights of the Nine's Crusader set (Nexus 28392)
// as faction gear (Nat, 25 Oct). The robes' recipes carry no conditions at all, so faction-gear.json is the whole gate:
// a robe made at the tanning rack by anyone but its faction's tailor or leader must be refused. Loads the real
// factiongear.js and the real list, with mocks, as factiongear-harness.js does.
//   node tests/faith-robes-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-faith-robes-'));
fs.copyFileSync(path.join(SERVER, 'faction-gear.json'), path.join(dir, 'faction-gear.json'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let failures = 0;
const check = (label, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${got !== undefined && !ok ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const gear = JSON.parse(fs.readFileSync('faction-gear.json', 'utf8')).items;
const ROBES = 'DivineAndDaedricRobes.esp', KOTN = 'matys knights of the nine armor 2.1.esp';
const named = (name) => { const e = Object.entries(gear).find(([, v]) => v.name === name); return e ? e[0] : null; };

// ---- the list ----
const robes = Object.entries(gear).filter(([k]) => k.endsWith(':' + ROBES));
check('all 49 new robes and hoods are faction gear', robes.length === 49, robes.length);
check('every robe and hood is tailor work (the tanning rack)', robes.every(([, v]) => v.role === 'tailor'));
check('each comes with its own robes-plugin recipe', robes.every(([, v]) => v.recipes.length === 1 && v.recipes[0].endsWith(':' + ROBES)));
const vaer = gear['e739b:Skyrim.esm'];
check("the vanilla Vaermina Robes, which the robes plugin's recipe makes, belong to the Cult of Vaermina", !!vaer && vaer.name === 'Vaermina Robes' && JSON.stringify(vaer.factions) === '["cult-vaermina"]' && vaer.role === 'tailor' && vaer.recipes[0].endsWith(':' + ROBES), vaer);
const of = (name) => (gear[named(name)] || {}).factions || [];
check('the Eight: the Great Faiths and the Imperial Cult', ['Akatosh', 'Arkay', 'Dibella', 'Julianos', 'Kynareth', 'Mara', 'Zenithar']
  .every((g) => JSON.stringify(of(`${g} Robes`)) === '["great-faiths","imperial-cult"]' && JSON.stringify(of(`${g} Hood`)) === '["great-faiths","imperial-cult"]'));
check("Stendarr's also the Vigil's", JSON.stringify(of('Stendarr Robes')) === '["great-faiths","imperial-cult","vigil-of-stendarr"]');
check("Talos's the Knights of the Nine's and the Stormcloaks'", JSON.stringify(of('Talos Robes')) === '["knights-of-the-nine","stormcloaks"]');
check("Malacath's the six Orc clans'", of('Malacath Robes').length === 6 && of('Malacath Robes').every((f) => f.startsWith('clan-')));
const cults = { Azura: 'azura', Boethiah: 'boethiah', 'Clavicus Vile': 'clavicus-vile', 'Hermaeous Mora': 'hermaeus-mora', Hircine: 'hircine',
  'Mehrunes Dagon': 'mehrunes-dagon', Mephala: 'mephala', Meridia: 'meridia', 'Molag Bal': 'molag-bal', Namira: 'namira', Nocturnal: 'nocturnal',
  Peryite: 'peryite', Sanguine: 'sanguine', Sheogorath: 'sheogorath' };
check('each Daedric prince\'s robe and hood belong to his cult alone', Object.entries(cults).every(([n, c]) =>
  JSON.stringify(of(`${n} Robes`)) === `["cult-${c}"]` && JSON.stringify(of(`${n} Hood`)) === `["cult-${c}"]`), Object.keys(cults).filter((n) => JSON.stringify(of(`${n} Robes`)) !== `["cult-${cults[n]}"]`));
check('Vaermina: her new hood to her cult', JSON.stringify(of('Vaermina Hood')) === '["cult-vaermina"]');
const defs = JSON.parse(fs.readFileSync(path.join(SERVER, 'guild-defs.json'), 'utf8')).factions;
const known = new Set(defs.map((f) => f.id));
const unknown = [...new Set(robes.concat(Object.entries(gear).filter(([k]) => k.endsWith(':' + KOTN))).flatMap(([, v]) => v.factions))].filter((f) => !known.has(f));
check('every faction named is one guild-defs.json defines', !unknown.length, unknown);
const templates = JSON.parse(fs.readFileSync(path.join(SERVER, 'guild-defs.json'), 'utf8')).templates || {};
const ranksOf = (fid) => { const f = defs.find((x) => x.id === fid); return f ? (f.ranks || templates[f.template] || []) : []; };
const tailors = [...new Set(robes.flatMap(([, v]) => v.factions))];
check('every faction a robe names has a leader, at least, to make it', tailors.every((fid) => ranksOf(fid).some((r) => r.role === 'tailor' || r.role === 'leader')));
// The two churches have no tailor rank, so until they get one only their High Priest and Primate make the Eight's robes
const noTailor = tailors.filter((fid) => !ranksOf(fid).some((r) => r.role === 'tailor'));
console.log(`${JSON.stringify(noTailor) === '["great-faiths","imperial-cult"]' ? 'NOTE' : 'FAIL'}  factions with no tailor rank, so only their leader makes their robes: ${JSON.stringify(noTailor)}`);
if (JSON.stringify(noTailor) !== '["great-faiths","imperial-cult"]') failures++;

// ---- in play ----
const ids = new Map(); const descs = new Map(); let next = 0x100;
const idOf = (desc) => { const k = String(desc).toLowerCase(); if (!ids.has(k)) { ids.set(k, next); descs.set(next, desc); next++; } return ids.get(k); };
const A = { OUT: 1, PRIEST: 2, CULT_TAILOR: 3, CULT_MEMBER: 4, CULT_LEADER: 5, OTHER_CULT_TAILOR: 6, CHURCH_TAILOR: 7, STORM_TAILOR: 8, ORC_TAILOR: 9,
  KOTN_SMITH: 10, KOTN_TAILOR: 11, KOTN_PILGRIM: 12 };
const ranks = {
  [A.PRIEST]: [{ id: 'great-faiths', role: 'member' }], [A.CULT_TAILOR]: [{ id: 'cult-azura', role: 'tailor' }], [A.CULT_MEMBER]: [{ id: 'cult-azura', role: 'member' }],
  [A.CULT_LEADER]: [{ id: 'cult-azura', role: 'leader' }], [A.OTHER_CULT_TAILOR]: [{ id: 'cult-boethiah', role: 'tailor' }],
  [A.CHURCH_TAILOR]: [{ id: 'imperial-cult', role: 'tailor' }], [A.STORM_TAILOR]: [{ id: 'stormcloaks', role: 'tailor' }],
  [A.ORC_TAILOR]: [{ id: 'clan-narzulbur', role: 'tailor' }],
  [A.KOTN_SMITH]: [{ id: 'knights-of-the-nine', role: 'blacksmith' }], [A.KOTN_TAILOR]: [{ id: 'knights-of-the-nine', role: 'tailor' }],
  [A.KOTN_PILGRIM]: [{ id: 'knights-of-the-nine', role: 'member' }],
};
globalThis.__dboGuildsOf = (a) => ranks[a] || [];
globalThis.__dboGuildInfo = (fid) => { const f = defs.find((x) => x.id === fid); return f ? { id: f.id, name: f.name } : null; };
const said = [];
const mp = { getDescFromId: (id) => descs.get(id) || '', getIdFromDesc: (d) => idOf(d), lookupEspmRecordById: () => ({ record: null }), get: () => undefined };
const api = { mp, log: () => {}, personal: (a, t) => said.push([a, t]), audit: () => {}, who: String, cfg: { factionGear: { enabled: true } },
  registerChatCommand: () => {}, isAdmin: () => false, sendPacket: () => {} };
globalThis.__dboFactionGearState = undefined;
require(path.join(SERVER, 'factiongear.js'))(api);
const craft = globalThis.__dboFactionCraft;
const fresh = () => globalThis.__dboFactionGearState.toldAt.clear();
const lastTo = (a) => { for (let i = said.length - 1; i >= 0; i--) if (said[i][0] === a) return said[i][1]; return ''; };
const AZURA = idOf(named('Azura Robes')), MARA = idOf(named('Mara Robes')), TALOS = idOf(named('Talos Hood')), MALA = idOf(named('Malacath Robes'));

fresh(); check('an outsider at the tanning rack cannot make Azura Robes, and is told whose they are', craft(A.OUT, AZURA) === false && lastTo(A.OUT).includes(defs.find((f) => f.id === 'cult-azura').name), lastTo(A.OUT));
fresh(); check('nor a priest of the Great Faiths', craft(A.PRIEST, AZURA) === false);
fresh(); check("nor a plain member of Azura's cult (it takes the tailor rank)", craft(A.CULT_MEMBER, AZURA) === false && /Tailor rank or their leader/.test(lastTo(A.CULT_MEMBER)), lastTo(A.CULT_MEMBER));
fresh(); check("nor another cult's tailor", craft(A.OTHER_CULT_TAILOR, AZURA) === false);
fresh(); check("Azura's cult's tailor makes them", craft(A.CULT_TAILOR, AZURA) === true);
fresh(); check('so does its leader', craft(A.CULT_LEADER, AZURA) === true);
fresh(); check("the Imperial Cult's tailor makes Mara's robes", craft(A.CHURCH_TAILOR, MARA) === true);
fresh(); check("...but not Talos's hood", craft(A.CHURCH_TAILOR, TALOS) === false);
fresh(); check("a Stormcloak tailor makes Talos's hood", craft(A.STORM_TAILOR, TALOS) === true);
fresh(); check("a Narzulbur tailor makes Malacath's robes", craft(A.ORC_TAILOR, MALA) === true);
const CUIR = idOf(named('Cuirass of the Crusader')), CAPE = idOf(named('Cape of the Crusader'));
fresh(); check('the Crusader Cuirass: an outsider is refused', craft(A.OUT, CUIR) === false);
fresh(); check('...and a Pilgrim', craft(A.KOTN_PILGRIM, CUIR) === false);
fresh(); check("...and the order's Clothier, at the forge", craft(A.KOTN_TAILOR, CUIR) === false);
fresh(); check("the order's Armorer forges it", craft(A.KOTN_SMITH, CUIR) === true);
fresh(); check("the plain Cape is the Clothier's work, at the tanning rack", craft(A.KOTN_TAILOR, CAPE) === true && craft(A.KOTN_SMITH, CAPE) === false);

console.log('');
console.log(failures ? `${failures} FAILURES` : 'all checks passed');
process.exit(failures ? 1 : 0);
