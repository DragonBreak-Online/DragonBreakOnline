// Class teachers from the X menu (Nate, 12 Oct: "Teachers need to be in the panel. I hate commands."). The Class Lectern
// needs the staff's list (schools.classes.requireList); staff now name and remove teachers from the X player menu
// (playermenu.js) as well as with /classteacher. Loads the real spells.js, schools.js and playermenu.js against a fake mp
// and checks that
//   - staff (isAdmin) see "Name class teacher" on a player the lectern would let teach (a teacherGuilds member with
//     Expert study or Arcane Arts at teacherArcaneLevel), "Name class teacher (not eligible)" with the reason otherwise,
//     and "Remove as class teacher" on a named one; a Trial GM and a player see none of them;
//   - naming and removing write the record /classteacher writes (private.dboSchools.teacher), audit, and tell both;
//   - the lectern then lets the named teacher hold a class, and /classteacher add|remove|list still work on the same list.
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

check('the tracked config still needs the staff\'s list for the Class Lectern', CONFIG.schools.classes.requireList === true);
// MAGE: a Synod member with Arcane Arts 80 (qualified by Arcane Arts), Destruction chosen, knows Fireball
arcane(MAGE, 80);
{ const p = (ui('uiCaps', MAGE, ['schools']), globalThis.__dboSchoolsProgressSend(MAGE), out.packets.filter((x) => x.a === MAGE && x.p.customPacketType === 'dboSchoolProgress').pop()); if (p && p.p.progress) ui('schoolChoose', MAGE, [p.p.progress.nonce, 'Destruction', 'primary']); }
put(MAGE, 'private.dboGuilds', [{ id: 'synod', rank: 0 }]);
known(MAGE).add(FIREBALL);
// OUTSIDER: Arcane Arts 80 but in no college
arcane(OUTSIDER, 80);

check('staff see "Name class teacher" on a Synod mage the lectern would let teach', labels(GM, MAGE).includes('Name class teacher'), labels(GM, MAGE));
check('...and no Remove entry while they are not named', !labels(GM, MAGE).includes('Remove as class teacher'));
check('a Trial GM sees no class-teacher entry', !ids(TRIAL, MAGE).some((i) => /^schools:/.test(i)), ids(TRIAL, MAGE));
check('a player sees no class-teacher entry', !ids(PLAYER, MAGE).some((i) => /^schools:/.test(i)), ids(PLAYER, MAGE));
check('on a mage in no college staff see the entry marked not eligible', labels(GM, OUTSIDER).includes('Name class teacher (not eligible)') && !labels(GM, OUTSIDER).includes('Name class teacher'), labels(GM, OUTSIDER));
act(GM, 'schools:teacherwhy', OUTSIDER);
check('...which tells staff why (a college member) and names nobody', /cannot be named a class teacher yet: a class here is held by a member of/.test(said(GM)) && teacher(OUTSIDER) === null, said(GM));
act(GM, 'schools:teacheron', OUTSIDER);
check('...and a forged Name on them is refused the same way', /cannot be named/.test(said(GM)) && teacher(OUTSIDER) === null, said(GM));

// The lectern before: the list refuses
globalThis.__dboSchoolsActivate(LECTERN, MAGE);
let w = out.widgets.filter((x) => x.a === MAGE && x.w.type === 'classLectern').pop();
check('before naming, the lectern refuses the mage', w && w.w.canTeach === false && /Only teachers/.test(w.w.whyNot), w && w.w);

out.audits.length = 0;
act(TRIAL, 'schools:teacheron', MAGE);
check('a Trial GM\'s forged Name does nothing', teacher(MAGE) === null && out.audits.length === 0);
act(GM, 'schools:teacheron', MAGE);
check('staff Name: the mage is on the list /classteacher keeps', !!(teacher(MAGE) && teacher(MAGE).at && teacher(MAGE).by === 'P14'), teacher(MAGE));
check('...audited as /classteacher audits it', out.audits.some((t) => t === 'SCHOOLS P14 named P16 as a class teacher'), out.audits);
check('...staff are told', said(GM) === 'Mage #TAG6 may now hold classes at a Class Lectern.', said(GM));
check('...and so is the teacher', said(MAGE) === 'You have been named a teacher: you may hold classes at a Class Lectern.', said(MAGE));
check('the menu now offers Remove and not Name', labels(GM, MAGE).includes('Remove as class teacher') && !labels(GM, MAGE).some((l) => /^Name class teacher/.test(l)), labels(GM, MAGE));
globalThis.__dboSchoolsActivate(LECTERN, MAGE);
w = out.widgets.filter((x) => x.a === MAGE && x.w.type === 'classLectern').pop();
check('the lectern now lets the named mage hold a class', w && w.w.canTeach === true, w && w.w);
check('/classteacher list shows the teacher named from the menu', (cmd('classteacher', GM, 'list'), /Named teachers online: Mage #TAG6/.test(said(GM))), said(GM));

act(GM, 'schools:teacheroff', MAGE);
check('staff Remove: off the list, audited, both told', teacher(MAGE) === null && out.audits.includes('SCHOOLS P14 removed P16 as a class teacher') && said(GM) === 'Mage #TAG6 may no longer hold classes.' && said(MAGE) === 'You may no longer hold classes.', [teacher(MAGE), said(GM), said(MAGE)]);
check('...and the menu offers Name again', labels(GM, MAGE).includes('Name class teacher'), labels(GM, MAGE));

// /classteacher still works, on the same record the menu reads
cmd('classteacher', GM, 'add Mage');
check('/classteacher add names them, and the menu sees it', !!teacher(MAGE) && labels(GM, MAGE).includes('Remove as class teacher'));
cmd('classteacher', GM, 'remove Mage');
check('/classteacher remove removes them, and the menu sees it', teacher(MAGE) === null && labels(GM, MAGE).includes('Name class teacher'));
cmd('classteacher', GM, 'add Outsider');
check('/classteacher add still names anyone (unchanged), and the menu then offers Remove', !!teacher(OUTSIDER) && labels(GM, OUTSIDER).includes('Remove as class teacher'));
check('unrelated menu ids fall through to the other handlers', globalThis.__dboSchoolsMenuAction(GM, 'trade', MAGE) === false);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
