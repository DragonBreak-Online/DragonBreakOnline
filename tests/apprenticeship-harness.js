// Scripted test for apprenticeship in server\schools.js (Arcane Mastery stage 2, Nate 14 Oct 2026), with the real
// spells.js: a teacher at Arcane Arts 75 takes a player as apprentice from the X menu and picks a spell they know (the
// apprentice's rank in its school at least the spell's), the apprentice accepts; near the teacher they hold the spell,
// away it is taken back; each cast near the teacher is study, at most dailyXp a day, dailyXp x daysByRank[rank] learns it.
// One apprentice at a time, more for a college's leader or officer. Setup from tests/rank-picks-harness.js.
//
//   node tests/apprenticeship-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const SPELLS = path.join(SERVER, 'spells.js');
const SCHOOLS = path.join(SERVER, 'schools.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-magic-flow-2-'));
process.chdir(dir);
for (const f of ['skills.json', 'spell-tomes.json']) fs.copyFileSync(path.join(SERVER, f), f);
const CONFIG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));

let wallClock = Date.parse('2026-10-01T12:00:00Z');
Date.now = () => wallClock;
const MIN = 60000, HOUR = 3600000;

const PLUGINS = { 'Skyrim.esm': 0x00, 'BSAssets.esm': 0x0a, 'BSHeartland.esm': 0x0b, 'DragonBreak Online Edits.esp': 0x60 };
const BY_INDEX = Object.fromEntries(Object.entries(PLUGINS).map(([k, v]) => [v, k]));
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const descOf = (id) => { const p = BY_INDEX[id >>> 24]; if (!p) throw new Error('no plugin'); return `${(id & 0xffffff).toString(16)}:${p}`; };

// Real places: the Synod Conclave, a bookcase in it (CYRSynodBookCase01, from the census), Bruma's worldspace
const SYNOD = '20ff:BSHeartland.esm', BRUMA = 'a764b:BSHeartland.esm';
const BOOKCASE = idOf('651cc:BSHeartland.esm'), BOOKCASE_BASE = 'cc2d4:BSHeartland.esm';
// Nate's lectern at the Synod (DLE v7): the ClassLectern activator 15e4b7, two boxes 16 units apart, 15e4bb and 15e4bc
const LECTERN = idOf('15e4bb:DragonBreak Online Edits.esp'), LECTERN2 = idOf('15e4bc:DragonBreak Online Edits.esp'), LECTERN_BASE = '15e4b7:DragonBreak Online Edits.esp';
const OTHER_SHELF = idOf('651c3:BSHeartland.esm'); // a Winterhold bookcase: not a study point
// Tomes and spells (book desc, spell desc) from spell-tomes.json
const T = {
  flames: ['9cd51:Skyrim.esm', '12fcd:Skyrim.esm'], firebolt: ['a26fd:Skyrim.esm', '12fd0:Skyrim.esm'],
  fireball: ['a2706:Skyrim.esm', '1c789:Skyrim.esm'], incinerate: ['10f7f4:Skyrim.esm', '10f7ed:Skyrim.esm'],
  boundSword: ['9e2a9:Skyrim.esm', '211eb:Skyrim.esm'], courage: ['9e2ad:Skyrim.esm', '4dee8:Skyrim.esm'],
  calm: ['a2711:Skyrim.esm', '4dee9:Skyrim.esm'], candlelight: ['9e2a7:Skyrim.esm', '43324:Skyrim.esm'],
  oakflesh: ['9e2a8:Skyrim.esm', '5ad5c:Skyrim.esm'], frostbite: ['9cd52:Skyrim.esm', '2b96b:Skyrim.esm'],
  sparks: ['9cd53:Skyrim.esm', '2dd2a:Skyrim.esm'], fury: ['9e2ac:Skyrim.esm', '4deeb:Skyrim.esm'], familiar: ['9e2ab:Skyrim.esm', '640b6:Skyrim.esm'],
  // Spectral Arrow: Conjuration Apprentice by its first, costliest effect (#bugs 1555203751822762084: spell-tomes.json had it
  // Restoration Novice, by its free stagger effect, so a Destruction mage learned it and took up Priest)
  spectral: ['b3165:Skyrim.esm', 'ab23d:Skyrim.esm'],
};
const HEALING = '12fcc:Skyrim.esm';

const RECORDS = {
  [idOf(BOOKCASE_BASE)]: { type: 'CONT', editorId: 'CYRSynodBookCase01', fields: [] },
  [idOf('109d86:Skyrim.esm')]: { type: 'CONT', editorId: 'WinterholdBookCase01', fields: [] },
  [idOf(LECTERN_BASE)]: { type: 'ACTI', editorId: 'ClassLectern', fields: [] },
};

const MAGE = 0x14, TEACHER = 0x15, ADEPT = 0x16, NOVICE = 0x17, ILLUSIONIST = 0x18, OLDMAGE = 0x19, PRIESTLY = 0x1a, ALTMAGE = 0x1b, OLDPRIEST = 0x1c, NPC = 0xff000123;
const NAMES = { [MAGE]: 'Mage', [TEACHER]: 'Teacher', [ADEPT]: 'Adept', [NOVICE]: 'Novice', [ILLUSIONIST]: 'Illusionist', [OLDMAGE]: 'Oldmage', [PRIESTLY]: 'Priestly', [ALTMAGE]: 'Altmage', [OLDPRIEST]: 'Oldpriest' };
const props = new Map();
const put = (id, p, v) => props.set(id + '|' + p, v);
const at = (id, cell, pos) => { put(id, 'worldOrCellDesc', cell); put(id, 'pos', pos || [0, 0, 0]); };
const arcane = (a, level) => {
  const r = props.get(a + '|private.mastery') || { v: 2, skills: {}, order: [] };
  r.skills.arcane = { level, xp: 0, rank: level >= 90 ? 4 : level >= 75 ? 3 : level >= 50 ? 2 : level >= 25 ? 1 : 0 };
  if (!r.order.includes('arcane')) r.order.push('arcane');
  put(a, 'private.mastery', r);
};
put(BOOKCASE, 'baseDesc', BOOKCASE_BASE); at(BOOKCASE, SYNOD, [0, 0, 0]);
put(OTHER_SHELF, 'baseDesc', '109d86:Skyrim.esm'); at(OTHER_SHELF, SYNOD, [50, 0, 0]);
put(LECTERN, 'baseDesc', LECTERN_BASE); at(LECTERN, SYNOD, [-274, 433.5, 196.6]);
put(LECTERN2, 'baseDesc', LECTERN_BASE); at(LECTERN2, SYNOD, [-258.3, 435.9, 201.9]);
for (const a of [MAGE, TEACHER, ADEPT, NOVICE, ILLUSIONIST, OLDMAGE, PRIESTLY, ALTMAGE, OLDPRIEST]) { at(a, SYNOD, [0, 0, 0]); put(a, 'profileId', a); }
const ENCHANTER = idOf('651cb:BSHeartland.esm'); at(ENCHANTER, SYNOD, [100, 0, 0]);
const priestOf = (a, level) => { const r = props.get(a + '|private.mastery') || { v: 2, skills: {}, order: [] }; r.skills.priest = { level, xp: 0, rank: level >= 25 ? 1 : 0 }; if (!r.order.includes('priest')) r.order.push('priest'); put(a, 'private.mastery', r); };

const learned = new Map();
const known = (a) => learned.get(a) || (learned.set(a, new Set()), learned.get(a));
const anims = [];
const mp = {
  getIdFromDesc: idOf,
  getDescFromId: descOf,
  get: (id, p) => props.get(id + '|' + p),
  set: (id, p, v) => props.set(id + '|' + p, JSON.parse(JSON.stringify(v))),
  lookupEspmRecordById: (id) => (RECORDS[id] ? { record: RECORDS[id], toGlobalRecordId: (local) => local } : null),
  callPapyrusFunction: (kind, cls, fn, self, args) => {
    if (cls === 'Debug' && fn === 'SendAnimationEvent') { anims.push([idOf(args[0].desc), args[1]]); return null; }
    const a = idOf(self.desc); const s = known(a);
    if (fn === 'GetSpellCount') return s.size;
    if (fn === 'GetNthSpell') { const id = [...s][args[0]]; return id === undefined ? null : { type: 'espm', desc: descOf(id) }; }
    const spell = idOf(args[0].desc);
    if (fn === 'AddSpell') { if (s.has(spell)) return false; s.add(spell); return true; }
    if (fn === 'RemoveSpell') return s.delete(spell);
    throw new Error('unexpected papyrus ' + fn);
  },
};
mp.onReadBook = () => undefined;

// The mastery system's two hooks: first touch takes Arcane Arts up at level 1, and every credited cast is recorded
const touches = [], wheelEvents = [];
let firstTouchAnswer = 'ok';
globalThis.__alduinakMasteryFirstTouch = (a, skill) => { touches.push([a, skill]); if (firstTouchAnswer === 'ok') arcane(a, 1); return firstTouchAnswer; };
globalThis.__alduinakMasteryEvent = (kind, a, detail) => wheelEvents.push({ kind, a, detail });
// The Wheel's award: recorded, and each one raises Arcane Arts by awardStep levels (the Wheel's own pace is not tested here)
const awards = [];
let awardStep = 1;
const arcaneLevel = (a) => { const r = props.get(a + '|private.mastery'); return r && r.skills.arcane ? r.skills.arcane.level : 0; };
globalThis.__alduinakMasteryAward = (a, skill, weight, key) => { awards.push([a, skill, weight, key]); if (skill === 'arcane' && arcaneLevel(a) >= 1) arcane(a, arcaneLevel(a) + awardStep); return weight; };

let online = [MAGE, TEACHER, ADEPT, NOVICE, ILLUSIONIST, OLDMAGE, PRIESTLY, ALTMAGE, OLDPRIEST];
const out = { widgets: [], closed: [], said: [], audits: [], logs: [], packets: [], seq: [] };
const handlers = new Map(), commands = new Map(), timers = new Map();
const mkApi = (cfg) => ({
  mp, cfg,
  log: (...a) => out.logs.push(a.join(' ')),
  personal: (a, t) => out.said.push([a, t]),
  system: (a, t) => out.said.push([a, t]),
  audit: (t) => out.audits.push(t),
  display: (a) => `${NAMES[a] || 'P'} #TAG${(a & 0xf).toString(16)}`,
  who: (a) => `P${a.toString(16)}`,
  openWidget: (a, w, focus) => { out.widgets.push({ a, w, focus }); out.seq.push(['open', a, w.id, !!focus]); return true; },
  closeWidget: (a, id) => { out.closed.push([a, id]); out.seq.push(['close', a, id]); return true; },
  onUi: (ev, fn) => { const l = handlers.get(ev) || []; l.push(fn); handlers.set(ev, l); },
  registerChatCommand: (name, fn, opts) => commands.set(name, { fn, opts }),
  onlineActors: () => online.slice(),
  every: (name, ms, fn) => timers.set(name, fn),
  distanceMeters: (a, b) => {
    if (props.get(a + '|worldOrCellDesc') !== props.get(b + '|worldOrCellDesc')) return Infinity;
    const p = props.get(a + '|pos'), q = props.get(b + '|pos');
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 70;
  },
  sendPacket: (a, p) => { out.packets.push({ a, p }); return true; },
  isAdmin: (a) => a === TEACHER,
  findByName: (q) => online.find((a) => (NAMES[a] || '').toLowerCase() === String(q).trim().toLowerCase()) || null,
  isWorldspace: (d) => d === BRUMA,
  profileOf: (a) => { const v = props.get(a + '|profileId'); return v === undefined ? -1 : v; },
  takeGold: () => false, giveItem: () => true, depositToTreasury: (z, n) => n,
});
const schoolsCfg = Object.assign({}, CONFIG.schools, { enabled: true });
const load = (overrides, schoolsFile) => {
  handlers.clear(); commands.clear();
  // The Conclave's table is given here even while the tracked config leaves it open (Nate, 30 Sep), so the gate is still tested
  const cfg = { spells: Object.assign({}, CONFIG.spells, { guildWorkshops: ['651cb:BSHeartland.esm'] }), schools: Object.assign({}, schoolsCfg, overrides || {}) };
  delete require.cache[SPELLS]; require(SPELLS)(mkApi(cfg));
  const file = schoolsFile || SCHOOLS;
  delete require.cache[file]; require(file)(mkApi(cfg));
};
load();

let failures = 0, checks = 0;
const check = (name, ok, detail) => { checks++; if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); } else console.log(`ok   ${name}`); };
const ui = (ev, a, args, widgetId) => (handlers.get(ev) || []).forEach((fn) => fn(a, args || [], widgetId || 0));
const cmd = (name, a, args) => commands.get(name).fn(a, args || '');
const said = (a) => { const l = out.said.filter((p) => p[0] === a); return l.length ? l[l.length - 1][1] : ''; };
const saidAny = (a, re) => out.said.some((p) => p[0] === a && re.test(p[1]));
const lastSent = (a, type) => { const l = out.widgets.filter((w) => w.a === a && (!type || w.w.type === type)); return l.length ? l[l.length - 1] : null; };
const lastWidget = (a, type) => { const l = out.widgets.filter((w) => w.a === a && (!type || w.w.type === type)); return l.length ? l[l.length - 1].w : null; };
const lastPacket = (a, type) => { const l = out.packets.filter((x) => x.a === a && x.p.customPacketType === type); return l.length ? l[l.length - 1].p : null; };
const rec = (a) => props.get(a + '|private.dboSchools');
const level = (a, school) => { const r = rec(a); return r && r.levels[school] ? r.levels[school].level : 0; };
const setLevel = (a, school, lv) => { const r = rec(a); r.levels[school] = { level: lv, xp: 0 }; put(a, 'private.dboSchools', r); };
const studied = (a) => ((props.get(a + '|private.dboStudied') || {}).arcane || []);
const tick = (name) => timers.get(name)();
const activate = (ref, a) => globalThis.__dboSchoolsActivate(ref, a);
const progress = (a) => { globalThis.__dboSchoolsProgressSend(a); return lastPacket(a, 'dboSchoolProgress').progress; };
const read = async (a, tome) => {
  const book = idOf(tome[0]), spell = idOf(tome[1]);
  const r = mp.onReadBook(a, book);
  if (r !== false && !known(a).has(spell)) known(a).add(spell);
  await new Promise((res) => setTimeout(res, 5));
  return r;
};
const advance = (ms) => { wallClock += ms; };


(async () => {
for (const a of online) ui('uiCaps', a, ['bank', 'spellbook', 'schools']);
const widgetsOf = (a, id) => out.widgets.filter((w) => w.a === a && w.w.id === id);
const contextOf = (a) => lastWidget(a, 'contextMenu');
const menuRaw = (a, id) => { const w = contextOf(a); const nonce = w.actions[0].id.split('|')[0]; ui('schoolMenu', a, [`${nonce}|${id}`]); };
const menuChoose = (a, id) => { const w = contextOf(a); const row = w.actions.find((x) => x.id.endsWith('|' + id)); ui('schoolMenu', a, [row ? row.id : 'x|' + id]); };
const priestBook = (a) => ((props.get(a + '|private.dboStudied') || {}).priest || []);
const view = (a) => globalThis.__dboMagicView(a);
// Everyone online is first seen here and has been in the world long enough for a first spell (schools.js
// starterSettleSeconds; tests/first-spell-harness.js has the wait itself)
tick('schools.first'); advance(91000);


// ---- a teacher and a student ----
const join = (a, arc) => { put(a, 'profileId', a); at(a, SYNOD, [0, 0, 0]); online.push(a); ui('uiCaps', a, ['bank', 'spellbook', 'schools']); arcane(a, arc); };
const TCH = 0x40, STU = 0x41, STU2 = 0x42, LOW = 0x43;
join(TCH, 80); join(STU, 25); join(STU2, 25); join(LOW, 60);
tick('schools.first'); advance(91000);
for (const a of [TCH, STU, STU2, LOW]) {
  let pp = progress(a); ui('schoolChoose', a, [pp.nonce, 'Destruction', 'primary']);
  ui('firstSpellPick', a, [lastWidget(a, 'studyMagic').nonce, a === TCH ? 'Flames' : 'Sparks']);
}
setLevel(TCH, 'Destruction', 80); setLevel(STU, 'Destruction', 30); setLevel(STU2, 'Destruction', 30);
for (const sp of [T.firebolt, T.fireball]) known(TCH).add(idOf(sp[1]));
const entries = (a, t) => globalThis.__dboSchoolsMenuEntries(a, t).map((x) => x.id);
const act = (a, id, t) => globalThis.__dboSchoolsMenuAction(a, id, t, (x) => String(x));
check('a teacher at Arcane Arts 80 sees "Take as apprentice" on a player', entries(TCH, STU).includes('schools:apprentice'), entries(TCH, STU));
check('...one at Arcane Arts 60 does not', !entries(LOW, STU).includes('schools:apprentice'));
act(TCH, 'schools:apprentice', STU);
let w = lastWidget(TCH, 'studyMagic');
check('the teacher picks from spells they know that the student\'s rank allows: Firebolt (Apprentice), not Fireball (Adept)', w.title === 'Take an Apprentice' && w.choices.some((c) => c.name === 'Firebolt') && !w.choices.some((c) => c.name === 'Fireball') && w.events.choose === 'dbo:apprenticeTeach', w.choices);
ui('apprenticeTeach', TCH, [w.nonce, 'Firebolt']);
let o = lastWidget(STU, 'contextMenu');
check('the student is asked, with the spell and how long', o.id === 85 && /offers to take you as apprentice to learn Firebolt \(Apprentice Destruction\): about 2 days/.test(o.targetName) && o.actions.length === 2, o);
ui('apprenticeOffer', STU, [o.actions.find((x) => x.id.endsWith('|accept')).id]);
check('accepted: the student holds Firebolt near the teacher, and both are recorded', rec(STU).apprentice && rec(STU).apprentice.need === 40 && known(STU).has(idOf(T.firebolt[1])) && rec(TCH).apprentices.length === 1, [rec(STU).apprentice, rec(TCH).apprentices]);
check('...not yet in their spellbook', !studied(STU).includes(T.firebolt[1]));
check('one apprentice at a time: a second is refused with the reason', (act(TCH, 'schools:apprentice', STU2), /already have an apprentice/.test(said(TCH))), said(TCH));
// study: one a cast, at most 20 a day
for (let i = 0; i < 25; i++) { globalThis.__dboSchoolsCast(STU, idOf(T.firebolt[1])); advance(3000); }
check('casting it near the teacher is study: 20 today, then the day is done', rec(STU).apprentice.xp === 20 && rec(STU).apprentice.dayXp === 20 && saidAny(STU, /studied this magic enough for today\. Come back tomorrow to continue your studies/), rec(STU).apprentice);
check('...another spell is no study', (globalThis.__dboSchoolsCast(STU, idOf(T.sparks[1])), rec(STU).apprentice.xp === 20));
check('the Magic tab shows the lesson', view(STU).apprenticeship.apprentice.spell === 'Firebolt' && view(STU).apprenticeship.apprentice.xp === 20 && view(STU).apprenticeship.apprentice.need === 40 && view(TCH).apprenticeship.apprentices[0].spell === 'Firebolt', view(STU).apprenticeship);
// away from the teacher
at(STU, BRUMA, [0, 0, 0]); tick('schools.apprentice');
check('away from the teacher the spell is taken back, and they are told', !known(STU).has(idOf(T.firebolt[1])) && saidAny(STU, /slips from your mind until you return/));
advance(24 * HOUR);
for (let i = 0; i < 5; i++) { globalThis.__dboSchoolsCast(STU, idOf(T.firebolt[1])); advance(3000); }
check('...and casting away (it is not held) is no study', rec(STU).apprentice.xp === 20);
at(STU, SYNOD, [0, 0, 0]); tick('schools.apprentice');
check('back near the teacher it is held again', known(STU).has(idOf(T.firebolt[1])) && saidAny(STU, /can cast Firebolt again/));
for (let i = 0; i < 20; i++) { globalThis.__dboSchoolsCast(STU, idOf(T.firebolt[1])); advance(3000); }
check('the second day\'s 20 complete it: Firebolt is learned for good, in the spellbook', studied(STU).includes(T.firebolt[1]) && !rec(STU).apprentice && saidAny(STU, /You have learned Firebolt from/), rec(STU).apprentice);
check('...the teacher is told and is free again', !(rec(TCH).apprentices || []).length && saidAny(TCH, /has learned Firebolt/) && out.audits.some((l) => /learned 12fd0:Skyrim\.esm Firebolt as apprentice/.test(l)));
at(STU, BRUMA, [0, 0, 0]); tick('schools.apprentice');
check('...and keeps it away from the teacher', known(STU).has(idOf(T.firebolt[1])) || studied(STU).includes(T.firebolt[1]));
// a college's senior rank takes more than one (role sergeant: Senior Magister here; Nat, 25 Oct: the senior college roles too)
put(TCH, 'private.dboGuilds', [{ id: 'synod', role: 'sergeant' }]);
at(STU, SYNOD, [0, 0, 0]);
known(TCH).add(idOf(T.frostbite[1])); known(TCH).add(idOf(T.flames[1]));
act(TCH, 'schools:apprentice', STU2); ui('apprenticeTeach', TCH, [lastWidget(TCH, 'studyMagic').nonce, 'Firebolt']);
ui('apprenticeOffer', STU2, [lastWidget(STU2, 'contextMenu').actions[0].id]);
act(TCH, 'schools:apprentice', LOW);
check('a Senior Magister (sergeant) may take a second apprentice', rec(TCH).apprentices.length === 1 && lastWidget(TCH, 'studyMagic').title === 'Take an Apprentice', [rec(TCH).apprentices, said(TCH)]);
// declining, releasing, leaving
const before = rec(TCH).apprentices.length;
ui('apprenticeOfferClose', LOW);
check('closing the offer declines it', !rec(LOW).apprentice && rec(TCH).apprentices.length === before);
check('the teacher sees "Release apprentice" on their apprentice', entries(TCH, STU2).includes('schools:apprenticeend'));
check('the apprentice sees "Leave apprenticeship" on their teacher', entries(STU2, TCH).includes('schools:apprenticequit'));
act(TCH, 'schools:apprenticeend', STU2);
check('released: the lesson ends and the held spell is taken back', !rec(STU2).apprentice && !known(STU2).has(idOf(T.firebolt[1])) && saidAny(STU2, /has ended your apprenticeship/));

// ---- adversarial cases (release review, 14 Oct) ----
let r;
const T2 = 0x50, S3 = 0x51, S4 = 0x52, T3 = 0x53;
join(T2, 80); join(S3, 80); join(S4, 25); join(T3, 80);
tick('schools.first'); advance(91000);
for (const a of [T2, S3, S4, T3]) {
  const pp = progress(a); ui('schoolChoose', a, [pp.nonce, 'Destruction', 'primary']);
  ui('firstSpellPick', a, [lastWidget(a, 'studyMagic').nonce, a === S4 ? 'Sparks' : 'Flames']);
}
setLevel(T2, 'Destruction', 80); setLevel(S3, 'Destruction', 30); setLevel(S4, 'Destruction', 30); setLevel(T3, 'Destruction', 80);
for (const sp of [T.firebolt, T.fireball]) { known(T2).add(idOf(sp[1])); known(T3).add(idOf(sp[1])); }
const FB = idOf(T.firebolt[1]);
const take = (teacher, student, spell) => {
  act(teacher, 'schools:apprentice', student);
  const tw = lastWidget(teacher, 'studyMagic');
  ui('apprenticeTeach', teacher, [tw.nonce, spell]);
  const ow = lastWidget(student, 'contextMenu');
  ui('apprenticeOffer', student, [ow.actions.find((x) => x.id.endsWith('|accept')).id]);
};
take(T2, S3, 'Firebolt');
check('setup: S3 is T2\'s apprentice in Firebolt and holds it', rec(S3).apprentice && rec(S3).apprentice.held && known(S3).has(FB), rec(S3).apprentice);
// A spell on loan is never passed on
act(S3, 'schools:apprentice', S4);
const s3w = lastWidget(S3, 'studyMagic');
check('an apprentice cannot teach the spell they hold on loan (S3, Arcane Arts 80, offers S4 nothing of it)', !(s3w && s3w.title === 'Take an Apprentice' && s3w.choices.some((c) => c.name === 'Firebolt')) && globalThis.__dboSchoolsOnLoan(S3, FB) === true, [s3w && s3w.choices, said(S3)]);
check('...spells.js sees it as on loan, so /teach, a college lesson and a class pass over it', globalThis.__dboSchoolsOnLoan(S3, FB) === true && globalThis.__dboSchoolsOnLoan(T2, FB) === false);
// Cast gap
const xp0 = rec(S3).apprentice.xp;
globalThis.__dboSchoolsCast(S3, FB); globalThis.__dboSchoolsCast(S3, FB); globalThis.__dboSchoolsCast(S3, FB);
check('casts closer than castGapSeconds count once', rec(S3).apprentice.xp === xp0 + 1, rec(S3).apprentice);
advance(3000);
// Logout while held: taken back at once; after the next login, held again once the client has settled
globalThis.__dboSchoolsLeave(S3); online = online.filter((x) => x !== S3);
check('logout while held: the spell is taken back and the record says so', !known(S3).has(FB) && rec(S3).apprentice.held === false, rec(S3).apprentice);
online.push(S3); globalThis.__dboSchoolsArrived(S3); tick('schools.apprentice');
check('...back online beside the teacher: not held until the client has settled', !known(S3).has(FB) && !rec(S3).apprentice.held);
advance(91000); tick('schools.apprentice');
check('...then held again', known(S3).has(FB) && rec(S3).apprentice.held);
// A cast after walking away but before the tick: no study (near is checked at the cast)
const xp1 = rec(S3).apprentice.xp;
at(S3, BRUMA, [0, 0, 0]); globalThis.__dboSchoolsCast(S3, FB); advance(3000);
check('a cast away from the teacher before the next check is no study', rec(S3).apprentice.xp === xp1);
tick('schools.apprentice'); at(S3, SYNOD, [0, 0, 0]); tick('schools.apprentice');
// Teacher logout
online = online.filter((x) => x !== T2); tick('schools.apprentice');
check('teacher logs out: taken back, the lesson kept', !known(S3).has(FB) && rec(S3).apprentice && !rec(S3).apprentice.held && saidAny(S3, /cannot teach you just now/));
online.push(T2); tick('schools.apprentice');
check('...teacher back: held again', known(S3).has(FB));
// Teacher downed, then dead
globalThis.__dboIsDowned = (x) => x === T2; tick('schools.apprentice');
const xp2 = rec(S3).apprentice.xp; globalThis.__dboSchoolsCast(S3, FB); advance(3000);
check('teacher downed: taken back, and a cast is no study', !known(S3).has(FB) && rec(S3).apprentice.xp === xp2);
globalThis.__dboIsDowned = () => false; put(T2, 'isDead', true); tick('schools.apprentice');
check('teacher dead: still not held', !known(S3).has(FB));
put(T2, 'isDead', false); tick('schools.apprentice');
check('...teacher up again: held', known(S3).has(FB));
// Hot reload: the record and offers live on; a reload with the lesson held keeps it right
load(); tick('schools.apprentice');
check('hot reload: the lesson and the held spell carry over', rec(S3).apprentice && rec(S3).apprentice.held && known(S3).has(FB));
at(S3, BRUMA, [0, 0, 0]); tick('schools.apprentice');
check('...and the new code takes it back away from the teacher', !known(S3).has(FB));
at(S3, SYNOD, [0, 0, 0]); tick('schools.apprentice');
// Server restart without a clean logout (a crash): the engine still holds it, the record says held
delete globalThis.__dboSchoolsState; globalThis.__dboSchoolsSeenAt = new Map();
load(); at(S3, BRUMA, [0, 0, 0]); globalThis.__dboSchoolsArrived(S3); tick('schools.apprentice');
check('restart after a crash, apprentice away: taken back at the first check', !known(S3).has(FB) && !rec(S3).apprentice.held);
at(S3, SYNOD, [0, 0, 0]); advance(91000); tick('schools.apprentice');
check('...beside the teacher once settled: held again', known(S3).has(FB));
// Switched off: the spell is taken back, the lesson waits
load({ apprenticeship: Object.assign({}, schoolsCfg.apprenticeship || {}, { enabled: false }) }); tick('schools.apprentice');
check('apprenticeship switched off: the held spell is taken back, the lesson kept', !known(S3).has(FB) && rec(S3).apprentice && !globalThis.__dboSchoolsMenuEntries(T2, S4).some((x) => /apprentice/.test(x.id)));
const xp3 = rec(S3).apprentice.xp; globalThis.__dboSchoolsCast(S3, FB); advance(3000);
check('...and no study while off', rec(S3).apprentice.xp === xp3);
load(); tick('schools.apprentice');
check('...on again: held beside the teacher', known(S3).has(FB));
// UTC midnight: the day's count starts again at 00:00 UTC; the total carries over
wallClock = Date.parse('2026-10-20T23:59:00Z');
const xp4 = rec(S3).apprentice.xp;
for (let i = 0; i < 25; i++) { globalThis.__dboSchoolsCast(S3, FB); advance(2000); }
const capAt = rec(S3).apprentice;
check('before midnight: at most 20 that day', capAt.dayXp === 20 && capAt.day === '2026-10-20' && capAt.xp === Math.min(capAt.need, xp4 + 20), capAt);
wallClock = Date.parse('2026-10-21T00:00:01Z');
check('...after midnight the Magic tab shows 0 today before a cast', view(S3).apprenticeship.apprentice.today === 0);
// Firebolt (Apprentice) needs 40; S3 is at 20 + the earlier ones, so a reduced number finishes it: count it out
const need = rec(S3).apprentice.need, have = rec(S3).apprentice.xp;
check('...the total carried over the night', have === capAt.xp);
// Alternating teachers gains nothing: leaving ends the lesson and a new one starts from 0
r = globalThis.__dboMagicAction(S3, 'apprenticeLeave', []);
check('leave from the Magic tab (no command, no need to stand beside the teacher)', r.ok && !rec(S3).apprentice && !known(S3).has(FB) && !(rec(T2).apprentices || []).length, [r, rec(T2).apprentices]);
take(T3, S3, 'Firebolt');
check('a new teacher for the same spell starts from 0 (no carrying study between teachers)', rec(S3).apprentice && rec(S3).apprentice.xp === 0 && rec(S3).apprentice.dayXp === 0 && rec(S3).apprentice.need === need, rec(S3).apprentice);
// Release from the Magic tab while the apprentice is offline (and still marked held after a crash)
online = online.filter((x) => x !== S3);
const id3 = view(T3).apprenticeship.apprentices[0].id;
r = globalThis.__dboMagicAction(T3, 'apprenticeRelease', [id3]);
check('release from the Magic tab with the apprentice away: the teacher is free, the apprentice\'s record untouched', r.ok && !(rec(T3).apprentices || []).length && rec(S3).apprentice, [r, rec(T3).apprentices]);
online.push(S3); globalThis.__dboSchoolsArrived(S3); tick('schools.apprentice');
check('...at the apprentice\'s next check the lesson ends and the spell is gone', !rec(S3).apprentice && !known(S3).has(FB) && saidAny(S3, /has ended your apprenticeship/));
// Learned another way: a rank pick or a tome puts it in the book; the lesson ends and the spell stays
take(T3, S3, 'Firebolt'); advance(91000); tick('schools.apprentice');
const st3 = props.get(S3 + '|private.dboStudied') || {}; st3.arcane = (st3.arcane || []).concat([T.firebolt[1]]); put(S3, 'private.dboStudied', st3);
tick('schools.apprentice');
check('learned another way: the lesson ends and the spell stays theirs', !rec(S3).apprentice && known(S3).has(FB) && !(rec(T3).apprentices || []).length, rec(S3).apprentice);
// A teacher's list loses an apprentice whose lesson ended while the teacher was away
take(T3, S4, 'Firebolt');
online = online.filter((x) => x !== T3);
r = globalThis.__dboMagicAction(S4, 'apprenticeLeave', []);
online.push(T3); tick('schools.apprentice');
check('an apprenticeship left while the teacher was away is cleared from their list at their next check', r.ok && !(rec(T3).apprentices || []).length, rec(T3).apprentices);
// Restricted arts, removed and non-tome spells never pass by apprenticeship
const REANIM = idOf('65bd7:Skyrim.esm');
check('spells.js: a restricted art is closed to an Associate, a removed spell and a spell no tome teaches to anyone', /restricted arts/.test(globalThis.__dboSpellsOpenTo(S4, REANIM)) && globalThis.__dboSpellsOpenTo(S4, idOf('109111:Skyrim.esm')) !== '' && globalThis.__dboSpellsOpenTo(S4, idOf('b3165:Skyrim.esm')) !== '' && globalThis.__dboSpellsOpenTo(S4, FB) === '');
// Config: bad values fall back to their defaults, logged; mages-guild is gone from the senior list
out.logs.length = 0;
load({ apprenticeship: { dailyXp: 'lots', radiusMeters: -5, daysByRank: [1, 2], seniorGuilds: 'synod' } });
check('config: a bad dailyXp, radiusMeters, daysByRank and seniorGuilds each fall back and are logged', ['dailyXp "lots"', 'radiusMeters -5', 'daysByRank [1,2]', 'seniorGuilds "synod"'].every((k) => out.logs.some((l) => l.includes(k))), out.logs.filter((l) => /config/.test(l)));
load();
check('leaders, officers and the senior ranks (sergeant) count as senior', /seniorRoles: \['leader', 'officer', 'sergeant'\]/.test(fs.readFileSync(SCHOOLS, 'utf8')));
check('the senior guilds are the four colleges, no mages-guild', !/mages-guild/.test(fs.readFileSync(SCHOOLS, 'utf8')));
// No mp.on of its own
check('schools.js and spells.js register no mp.on handler', !/\bmp\.on\s*\(/.test(fs.readFileSync(SCHOOLS, 'utf8')) && !/\bmp\.on\s*\(/.test(fs.readFileSync(SPELLS, 'utf8')));

console.log(`${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed:', e.stack || e.message); process.exit(1); });
