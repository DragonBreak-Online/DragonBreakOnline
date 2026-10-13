// Who holds a class at the Class Lectern (Nate, 13 Oct: "Class teacher needs to be the faction leader and officers? GMs
// shouldnt name teachers for magic colleges"). The tracked config has schools.classes.requireList off and teacherRoles
// leader/officer: a college's leader and officers teach, staff name nobody. Loads the real spells.js, schools.js and
// playermenu.js against a fake mp and checks that
//   - the lectern lets a Synod officer or leader with Expert study (or Arcane Arts at teacherArcaneLevel) hold a class, and
//     refuses a plain member, an officer of a non-college faction, and someone in no college;
//   - staff see no "Name class teacher" entry on anyone, and /classteacher names nobody;
//   - a teacher named under the old list keeps no right to teach by it: the rank decides.
// Run it from this folder's parent with
//   node tests/class-teacher-menu-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const SPELLS = path.join(SERVER, 'spells.js'), SCHOOLS = path.join(SERVER, 'schools.js'), MENU = path.join(SERVER, 'playermenu.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'class-teacher-menu-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
for (const f of ['skills.json', 'spell-tomes.json']) fs.copyFileSync(path.join(SERVER, f), f);
const CONFIG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));

const PLUGINS = { 'Skyrim.esm': 0x00, 'BSAssets.esm': 0x0a, 'BSHeartland.esm': 0x0b, 'DragonBreak Online Edits.esp': 0x60 };
const BY_INDEX = Object.fromEntries(Object.entries(PLUGINS).map(([k, v]) => [v, k]));
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const descOf = (id) => { const p = BY_INDEX[id >>> 24]; if (!p) throw new Error('no plugin'); return `${(id & 0xffffff).toString(16)}:${p}`; };
const SYNOD = '20ff:BSHeartland.esm';
const LECTERN = idOf('15e4bb:DragonBreak Online Edits.esp'), LECTERN_BASE = '15e4b7:DragonBreak Online Edits.esp';
const RECORDS = { [idOf(LECTERN_BASE)]: { type: 'ACTI', editorId: 'ClassLectern', fields: [] } };
const FIREBALL = idOf('1c789:Skyrim.esm');

const GM = 0x14, TRIAL = 0x15, MAGE = 0x16, OUTSIDER = 0x17, PLAYER = 0x18;
const NAMES = { [GM]: 'Gm', [TRIAL]: 'Trial', [MAGE]: 'Mage', [OUTSIDER]: 'Outsider', [PLAYER]: 'Player' };
const props = new Map();
const put = (id, p, v) => props.set(id + '|' + p, v);
const arcane = (a, level) => put(a, 'private.mastery', { v: 2, skills: { arcane: { level, xp: 0, rank: level >= 75 ? 3 : 2 } }, order: ['arcane'] });
const online = [GM, TRIAL, MAGE, OUTSIDER, PLAYER];
for (const [i, a] of online.entries()) {
  put(a, 'worldOrCellDesc', SYNOD); put(a, 'pos', [i, 0, 0]); put(a, 'profileId', a);
  put(a, 'locationalData', { cellOrWorldDesc: SYNOD, pos: [i * 10, 0, 0], rot: [0, 0, 0] });
}
put(LECTERN, 'baseDesc', LECTERN_BASE); put(LECTERN, 'worldOrCellDesc', SYNOD); put(LECTERN, 'pos', [0, 0, 0]);
const learned = new Map();
const known = (a) => learned.get(a) || (learned.set(a, new Set()), learned.get(a));
const mp = {
  getIdFromDesc: idOf, getDescFromId: descOf,
  get: (id, p) => props.get(id + '|' + p),
  set: (id, p, v) => props.set(id + '|' + p, v === undefined ? v : JSON.parse(JSON.stringify(v))),
  lookupEspmRecordById: (id) => (RECORDS[id] ? { record: RECORDS[id], toGlobalRecordId: (l) => l } : null),
  makeProperty: () => {},
  callPapyrusFunction: (kind, cls, fn, self, args) => {
    if (cls === 'Debug') return null;
    const s = known(idOf(self.desc));
    if (fn === 'GetSpellCount') return s.size;
    if (fn === 'GetNthSpell') { const id = [...s][args[0]]; return id === undefined ? null : { type: 'espm', desc: descOf(id) }; }
    if (fn === 'AddSpell') { const sp = idOf(args[0].desc); if (s.has(sp)) return false; s.add(sp); return true; }
    if (fn === 'RemoveSpell') return s.delete(idOf(args[0].desc));
    return null;
  },
};
mp.onReadBook = () => undefined;
globalThis.__alduinakMasteryFirstTouch = () => 'ok';
globalThis.__alduinakMasteryEvent = () => {};

const out = { said: [], audits: [], widgets: [], packets: [] };
const handlers = new Map(), commands = new Map();
const isAdmin = (a) => a === GM; // a Trial GM is not isAdmin (gamemode.js staffCan)
const mkApi = (cfg) => ({
  mp, cfg,
  log: () => {}, audit: (t) => out.audits.push(t),
  personal: (a, t) => out.said.push([a, t]), system: (a, t) => out.said.push([a, t]),
  display: (a) => `${NAMES[a] || 'P'} #TAG${(a & 0xf).toString(16)}`, who: (a) => `P${a.toString(16)}`,
  nameOf: (a) => NAMES[a] || 'P', tagOf: (a) => `TAG${(a & 0xf).toString(16)}`, ranksOf: () => [],
  openWidget: (a, w) => { out.widgets.push({ a, w }); return true; }, closeWidget: () => true,
  onUi: (ev, fn) => { const l = handlers.get(ev) || []; l.push(fn); handlers.set(ev, l); },
  registerChatCommand: (name, fn, opts) => commands.set(name, { fn, opts }),
  onlineActors: () => online.slice(), every: () => {},
  distanceMeters: (a, b) => { const p = props.get(a + '|pos'), q = props.get(b + '|pos'); return p && q ? Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 70 : Infinity; },
  sendPacket: (a, p) => { out.packets.push({ a, p }); return true; },
  isAdmin, isLeadStaff: () => false, staffCan: (a, what) => isAdmin(a) || (a === TRIAL && ['playerinfo', 'tp'].includes(what)),
  findByName: (q) => online.find((a) => (NAMES[a] || '').toLowerCase() === String(q).trim().toLowerCase()) || null,
  isWorldspace: () => false, profileOf: (a) => a,
  makeProp: () => {}, giveItem: () => true, runCommand: () => {}, takeGold: () => false, depositToTreasury: (z, n) => n,
});
const cfg = {
  spells: Object.assign({}, CONFIG.spells), playerMenu: CONFIG.playerMenu || {},
  schools: Object.assign({}, CONFIG.schools, { enabled: true, requireClient: false, firstSchoolAt: 0, starters: {} }),
};
require(SPELLS)(mkApi(cfg));
require(SCHOOLS)(mkApi(cfg));
require(MENU)(mkApi(cfg));

let failures = 0;
const check = (name, ok, detail) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); };
const ui = (ev, a, args) => (handlers.get(ev) || []).forEach((fn) => fn(a, args || [], 0));
const menu = (a, t) => { ui('playerMenu', a, [t]); const l = out.packets.filter((x) => x.a === a && x.p.customPacketType === 'dboPlayerMenu'); return l.length ? l[l.length - 1].p.entries : []; };
const labels = (a, t) => menu(a, t).map((e) => e.label);
const ids = (a, t) => menu(a, t).map((e) => e.id);
const act = (a, id, t) => ui('playerAction', a, [id, t]);
const said = (a) => { const l = out.said.filter((p) => p[0] === a); return l.length ? l[l.length - 1][1] : ''; };
const teacher = (a) => ((props.get(a + '|private.dboSchools') || {}).teacher) || null;
const cmd = (name, a, args) => commands.get(name).fn(a, args || '');

check('the tracked config names nobody: leaders and officers of a college teach', CONFIG.schools.classes.requireList === false && CONFIG.schools.classes.teacherRoles.join() === 'leader,officer', CONFIG.schools.classes);
// MAGE: Arcane Arts 80 (qualified by Arcane Arts), Destruction chosen, knows Fireball
arcane(MAGE, 80);
{ const p = (ui('uiCaps', MAGE, ['schools']), globalThis.__dboSchoolsProgressSend(MAGE), out.packets.filter((x) => x.a === MAGE && x.p.customPacketType === 'dboSchoolProgress').pop()); if (p && p.p.progress) ui('schoolChoose', MAGE, [p.p.progress.nonce, 'Destruction', 'primary']); }
known(MAGE).add(FIREBALL);
// OUTSIDER: Arcane Arts 80 but in no college
arcane(OUTSIDER, 80);
const lectern = (a) => { globalThis.__dboSchoolsActivate(LECTERN, a); const w = out.widgets.filter((x) => x.a === a && x.w.type === 'classLectern').pop(); return w ? w.w : {}; };

put(MAGE, 'private.dboGuilds', [{ id: 'synod', role: 'mage' }]);
let w = lectern(MAGE);
check('a plain Synod mage may not hold a class, and is told who may', w.canTeach === false && /held by the leader or an officer of the Synod/.test(w.whyNot), w);
put(MAGE, 'private.dboGuilds', [{ id: 'synod', role: 'member' }, { id: 'east-empire', role: 'leader' }]);
w = lectern(MAGE);
check('...nor the leader of a faction that is no college', w.canTeach === false && /leader or an officer/.test(w.whyNot), w);
w = lectern(OUTSIDER);
check('someone in no college is refused as before', w.canTeach === false && /held by a member of/.test(w.whyNot), w);
put(MAGE, 'private.dboGuilds', [{ id: 'synod', role: 'officer' }]);
w = lectern(MAGE);
check('a Synod officer (Magister) may hold a class, with nobody naming them', w.canTeach === true && teacher(MAGE) === null, w);
put(MAGE, 'private.dboGuilds', [{ id: 'college-of-winterhold', role: 'leader' }]);
check('...and so may a college\'s leader (Arch-Mage)', lectern(MAGE).canTeach === true);

check('staff see no Name entry on a mage who may teach', !ids(GM, MAGE).some((i) => /^schools:/.test(i)), labels(GM, MAGE));
check('...nor on one who may not', !ids(GM, OUTSIDER).some((i) => /^schools:/.test(i)), labels(GM, OUTSIDER));
check('a Trial GM and a player see none either', !ids(TRIAL, MAGE).some((i) => /^schools:/.test(i)) && !ids(PLAYER, MAGE).some((i) => /^schools:/.test(i)));
out.audits.length = 0;
act(GM, 'schools:teacheron', OUTSIDER);
check('a forged Name from staff names nobody', teacher(OUTSIDER) === null && out.audits.length === 0, said(GM));
cmd('classteacher', GM, 'add Outsider');
check('/classteacher says teachers are not named, and names nobody', teacher(OUTSIDER) === null && /not named: the leader and officers of a college may teach/.test(said(GM)), said(GM));

// A teacher named under the old list: the rank decides now
put(OUTSIDER, 'private.dboSchools', Object.assign({}, props.get(OUTSIDER + '|private.dboSchools') || {}, { teacher: { by: 'P14', at: 1 } }));
put(OUTSIDER, 'private.dboGuilds', [{ id: 'synod', role: 'mage' }]);
check('a teacher named under the old list but no officer may not hold a class', lectern(OUTSIDER).canTeach === false);
check('...staff can still clear the old naming from the menu', labels(GM, OUTSIDER).includes('Remove as class teacher') && (act(GM, 'schools:teacheroff', OUTSIDER), teacher(OUTSIDER) === null));
check('unrelated menu ids fall through to the other handlers', globalThis.__dboSchoolsMenuAction(GM, 'trade', MAGE) === false);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
