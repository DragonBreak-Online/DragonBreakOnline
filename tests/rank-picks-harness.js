// Scripted test for the Arcane Mastery picks in server\schools.js (Nate, 14 Oct 2026), with the real spells.js: after a
// school's first spell, one Apprentice spell and one Adept spell are chosen (F3 Magic tab, a shelf or a ledger) from every
// tome spell of that school and rank (spells.js __dboSpellsRankOptions). The school stops at 25, and again at 50, until that
// pick is made; it opens once the school is held there. A mage already past a pick's level is offered it and never pulled
// back. Priest is held the same way through skillrates.js (__dboSchoolsSkillHeld). Setup from tests/magic-flow-2-harness.js.
// No server and no game: run it from this folder's parent with
//
//   node tests/rank-picks-harness.js
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


// ---- a mage from 25 to past 50 by casting ----
const RP = 0x31; put(RP, 'profileId', RP); at(RP, SYNOD, [0, 0, 0]); online.push(RP); ui('uiCaps', RP, ['bank', 'spellbook', 'schools']); arcane(RP, 25);
tick('schools.first'); advance(91000);
let p = progress(RP); ui('schoolChoose', RP, [p.nonce, 'Destruction', 'primary']);
let w = lastWidget(RP, 'studyMagic');
ui('firstSpellPick', RP, [w.nonce, 'Sparks']);
check('the first spell first: Sparks chosen at 25, no Apprentice pick yet (the school is not held there)', studied(RP).includes(T.sparks[1]) && view(RP).schools.find((x) => x.name === 'Destruction').firstSpell.state === 'made', view(RP).schools.find((x) => x.name === 'Destruction').firstSpell);
const casts = [T.flames[1], T.sparks[1], T.frostbite[1], T.firebolt[1]].map(idOf);
const castDays = (n) => { for (let d = 0; d < n; d++) { for (let i = 0; i < 400; i++) globalThis.__dboSchoolsCast(RP, casts[i % 4]); advance(24 * HOUR); tick('schools.first'); } };
castDays(3);
const xpOf = (a, school) => rec(a).levels[school].xp;
check('casting past 25 stops at 25, the meter full: the Apprentice spell must be chosen first', level(RP, 'Destruction') === 25 && xpOf(RP, 'Destruction') >= 99.99, rec(RP).levels.Destruction);
let d = view(RP).schools.find((x) => x.name === 'Destruction');
check('the Magic tab offers the Apprentice pick in the first spell\'s place, with its stage and level', d.firstSpell.state === 'open' && d.firstSpell.stage === 'Apprentice' && d.firstSpell.at === 25 && d.firstSpell.held === true && d.firstSpell.choices.some((c) => c.name === 'Firebolt') && !d.firstSpell.choices.some((c) => c.name === 'Sparks'), d.firstSpell);
check('...and the player is told once, with where to choose it', saidAny(RP, /has reached 25: choose your Apprentice spell of Destruction \([^)]*Firebolt[^)]*\); it rises no further until you do\. Choose it in the panel, your journal's Magic tab \(F3\)/), out.said.filter((x) => x[0] === RP).map((x) => x[1]));
const toldN = out.said.filter((x) => x[0] === RP && /Apprentice spell/.test(x[1])).length;
tick('schools.first'); tick('schools.first');
check('...not again on the next checks', out.said.filter((x) => x[0] === RP && /Apprentice spell/.test(x[1])).length === toldN);
let r = globalThis.__dboMagicAction(RP, 'firstSpell', ['Destruction', T.sparks[1]]);
check('a spell of the wrong rank is refused', r.ok === false && /not one of Destruction's Apprentice spells/.test(r.text), r);
r = globalThis.__dboMagicAction(RP, 'firstSpell', ['Destruction', T.firebolt[1]]);
check('Firebolt chosen in the Magic tab: learned, recorded as the Apprentice pick, and the school may rise again', r.ok === true && /your Apprentice spell of Destruction/.test(r.text) && /can rise again/.test(r.text) && studied(RP).includes(T.firebolt[1]) && rec(RP).rankPicks.Destruction.Apprentice.how === 'chose', [r, rec(RP).rankPicks]);
check('...audited', out.audits.some((l) => /as their Apprentice spell of Destruction/.test(l)));
castDays(1);
check('the next day\'s casts go past 25', level(RP, 'Destruction') > 25, rec(RP).levels.Destruction);
castDays(20);
check('it stops again at 50 for the Adept spell', level(RP, 'Destruction') === 50 && xpOf(RP, 'Destruction') >= 99.99, rec(RP).levels.Destruction);
d = view(RP).schools.find((x) => x.name === 'Destruction');
check('...the Adept pick is open, Fireball among it, and the Apprentice spell is listed as chosen', d.firstSpell.stage === 'Adept' && d.firstSpell.choices.some((c) => c.name === 'Fireball') && d.rankSpells.some((x) => x.rank === 'Apprentice' && x.spell === 'Firebolt'), d);
r = globalThis.__dboMagicAction(RP, 'firstSpell', ['Destruction', T.fireball[1]]);
castDays(2);
check('Fireball chosen: past 50, and no pick is waiting (Expert and Master come from tomes and teaching)', r.ok && level(RP, 'Destruction') > 50 && !view(RP).schools.find((x) => x.name === 'Destruction').firstSpell.stage, [r, rec(RP).levels.Destruction]);

// ---- a mage already past a pick's level (a change of school, or from before the picks) ----
const OLD = 0x32; put(OLD, 'profileId', OLD); at(OLD, SYNOD, [0, 0, 0]); online.push(OLD); ui('uiCaps', OLD, ['bank', 'spellbook', 'schools']); arcane(OLD, 25);
tick('schools.first'); advance(91000);
p = progress(OLD); ui('schoolChoose', OLD, [p.nonce, 'Destruction', 'primary']);
ui('firstSpellPick', OLD, [lastWidget(OLD, 'studyMagic').nonce, 'Flames']);
setLevel(OLD, 'Destruction', 60);
for (let i = 0; i < 40; i++) globalThis.__dboSchoolsCast(OLD, casts[i % 4]);
check('a mage at 60 with no picks is never pulled back to 25 or 50', level(OLD, 'Destruction') >= 60, rec(OLD).levels.Destruction);
check('...and is offered the Apprentice pick, then the Adept', view(OLD).schools.find((x) => x.name === 'Destruction').firstSpell.stage === 'Apprentice', view(OLD).schools.find((x) => x.name === 'Destruction').firstSpell);

// ---- Priest: held through skillrates.js ----
const PRI = 0x33; put(PRI, 'profileId', PRI); at(PRI, SYNOD, [0, 0, 0]); online.push(PRI); ui('uiCaps', PRI, ['bank', 'spellbook', 'schools']);
priestOf(PRI, 25);
tick('schools.first'); advance(91000);
const setPriestXp = (xp) => { const m = props.get(PRI + '|private.mastery'); m.skills.priest.xp = xp; put(PRI, 'private.mastery', m); };
check('Priest 25 before its first spell: not held (the first spell never holds)', globalThis.__dboSchoolsSkillHeld(PRI, 'priest') === false);
r = globalThis.__dboMagicAction(PRI, 'firstSpell', ['Restoration', HEALING]);
setPriestXp(50);
check('Priest 25, first spell made, half way to 26: not held yet', r.ok && globalThis.__dboSchoolsSkillHeld(PRI, 'priest') === false, r);
// A rank reached whose pick is still a level's tail away: said once, so nobody waits wondering (Choom, #bugs 15 Oct)
tick('schools.first');
check('...and is told the Apprentice spell comes as the level is finished', saidAny(PRI, /You have reached Apprentice in Restoration\. Your Apprentice spell of Restoration is chosen as you finish Priest 25/), said(PRI));
{
  const before = out.said.filter((x) => x[0] === PRI && /chosen as you finish/.test(x[1])).length;
  tick('schools.first'); tick('schools.first');
  const after = out.said.filter((x) => x[0] === PRI && /chosen as you finish/.test(x[1])).length;
  check('...and told only once, however often the check runs', before === 1 && after === 1, [before, after]);
}
setPriestXp(95);
check('...at 95% of the way: held, and its Apprentice pick opens', globalThis.__dboSchoolsSkillHeld(PRI, 'priest') === true && view(PRI).schools.find((x) => x.name === 'Restoration').firstSpell.stage === 'Apprentice');
check('...another skill is never held', globalThis.__dboSchoolsSkillHeld(PRI, 'arcane') === false);
const rest = view(PRI).schools.find((x) => x.name === 'Restoration').firstSpell.choices[0];
r = globalThis.__dboMagicAction(PRI, 'firstSpell', ['Restoration', rest.id]);
check('...chosen: no longer held', r.ok && globalThis.__dboSchoolsSkillHeld(PRI, 'priest') === false, r);
// The Adept pick at Priest 50 opens on reaching 50, however little of the level is done (Esmyr #EB56, 20 Oct: Priest 50 at
// 6%, the skill set to hold, never offered it)
{ const m = props.get(PRI + '|private.mastery'); m.skills.priest.level = 50; m.skills.priest.rank = 2; m.skills.priest.xp = 6; put(PRI, 'private.mastery', m); }
{ const f = view(PRI).schools.find((x) => x.name === 'Restoration').firstSpell;
  check('Priest 50 at 6%: its Adept pick is open at once', f && f.stage === 'Adept', f); }
{ const m = props.get(PRI + '|private.mastery'); m.skills.priest.level = 49; m.skills.priest.xp = 99; put(PRI, 'private.mastery', m); }
{ const f = view(PRI).schools.find((x) => x.name === 'Restoration').firstSpell;
  check('...and not at 49', !f || f.stage !== 'Adept', f); }
const rates = fs.readFileSync(path.join(SERVER, 'skillrates.js'), 'utf8');
check('skillrates.js rates a held skill 0 before anything else', /const rateFor = [^\n]*\n[^\n]*\n\s*try \{ if \(typeof globalThis\.__dboSchoolsSkillHeld === 'function' && globalThis\.__dboSchoolsSkillHeld\(actorId >>> 0, skillId\)\) return 0;/.test(rates));

// ---- spell lines (Nate, 14 Oct, option B): the next spell of each line known comes first ----
const LN = 0x35; put(LN, 'profileId', LN); at(LN, SYNOD, [0, 0, 0]); online.push(LN); ui('uiCaps', LN, ['bank', 'spellbook', 'schools']); arcane(LN, 25);
tick('schools.first'); advance(91000);
p = progress(LN); ui('schoolChoose', LN, [p.nonce, 'Destruction', 'primary']);
ui('firstSpellPick', LN, [lastWidget(LN, 'studyMagic').nonce, 'Flames']);
// Sparks in the book as well, Frostbite and Ice Spike known (read from tomes before the schools)
const book = (a, descs, skill) => { const st = props.get(a + '|private.dboStudied') || {}; st[skill || 'arcane'] = (st[skill || 'arcane'] || []).concat(descs); put(a, 'private.dboStudied', st); };
book(LN, [T.sparks[1]]);
known(LN).add(idOf(T.frostbite[1])); known(LN).add(idOf('2b96c:Skyrim.esm')); // Ice Spike
const ICE_SPIKE = '2b96c:Skyrim.esm', LIGHTNING_BOLT = '2dd29:Skyrim.esm', CHAIN = '45f9d:Skyrim.esm', ICY_SPEAR = '10f7ec:Skyrim.esm';
put(LN, 'private.dboSchools', Object.assign(rec(LN), { levels: Object.assign(rec(LN).levels, { Destruction: { level: 25, xp: 99.99 } }) }));
let f = view(LN).schools.find((x) => x.name === 'Destruction').firstSpell;
const lineChoices = f.choices.filter((c) => c.line);
check('lines: the next spell of each line known comes first, marked (Firebolt from Flames, Lightning Bolt from Sparks)',
  f.stage === 'Apprentice' && lineChoices.length === 2 && f.choices[0].line && f.choices[1].line
  && lineChoices.some((c) => c.name === 'Firebolt' && c.line === 'Flames' && c.blurb === 'Next in your line: Firebolt (from Flames)')
  && lineChoices.some((c) => c.name === 'Lightning Bolt' && c.line === 'Sparks'), f.choices.slice(0, 4));
check('...then the rest of the rank\'s tomes, unmarked, as before', f.choices.length > 2 && f.choices.slice(2).every((c) => !c.line) && f.choices.some((c) => c.name === 'Fire Rune'), f.choices.map((c) => c.name));
check('...a successor already known (Ice Spike, from Frostbite) is not offered again', !f.choices.some((c) => c.id === ICE_SPIKE), f.choices.map((c) => c.name));
let pw = (globalThis.__dboSchoolsActivate(BOOKCASE, LN), lastWidget(LN, 'studyMagic'));
check('...the shelf\'s panel lists them first too, with the line and "you keep" in the question', pw && pw.choices[0].blurb.startsWith('Next in your line: ') && / You keep (Flames|Sparks)\./.test(pw.choices[0].confirm), pw && pw.choices.slice(0, 2));
r = globalThis.__dboMagicAction(LN, 'firstSpell', ['Destruction', T.firebolt[1]]);
check('picking Firebolt adds it: Flames stays in the spellbook', r.ok && studied(LN).includes(T.firebolt[1]) && studied(LN).includes(T.flames[1]) && studied(LN).includes(T.sparks[1]), [r, studied(LN)]);
r = globalThis.__dboMagicAction(LN, 'firstSpell', ['Destruction', LIGHTNING_BOLT]);
check('...and the Apprentice pick cannot be taken twice (Lightning Bolt refused now)', r.ok === false && !studied(LN).includes(LIGHTNING_BOLT), r);
r = (ui('firstSpellPick', LN, [pw.nonce, 'Lightning Bolt']), studied(LN).includes(LIGHTNING_BOLT));
check('...nor through the shelf panel opened before it was chosen', r === false);
// The Adept pick: Fire goes on (Fireball from Firebolt); Shock's next is Lightning Bolt, still an Apprentice spell (not
// offered at Adept), Frost's after Ice Spike is Icy Spear, an Expert spell (no Adept step in spell-tomes.json)
put(LN, 'private.dboSchools', Object.assign(rec(LN), { levels: Object.assign(rec(LN).levels, { Destruction: { level: 50, xp: 99.99 } }) }));
f = view(LN).schools.find((x) => x.name === 'Destruction').firstSpell;
check('the Adept pick: Fireball from Firebolt first; nothing of another rank (Icy Spear, Lightning Bolt) is offered', f.stage === 'Adept' && f.choices[0].name === 'Fireball' && f.choices[0].line === 'Firebolt' && !f.choices.some((c) => c.id === ICY_SPEAR || c.id === LIGHTNING_BOLT) && f.choices.filter((c) => c.line).length === 1, f.choices.slice(0, 3));
known(LN).add(idOf(CHAIN));
f = view(LN).schools.find((x) => x.name === 'Destruction').firstSpell;
check('...Chain Lightning known already: not offered at all', !f.choices.some((c) => c.id === CHAIN));
// An excluded successor: Raise Zombie > Reanimate Corpse is a restricted art (spells.js seniorOnlyTomes), skipped below
// Senior rank and listed first for a Senior; Bound Sword > Bound Battleaxe offered either way
const CJ = 0x36; put(CJ, 'profileId', CJ); at(CJ, SYNOD, [0, 0, 0]); online.push(CJ); ui('uiCaps', CJ, ['bank', 'spellbook', 'schools']); arcane(CJ, 25);
tick('schools.first'); advance(91000);
p = progress(CJ); ui('schoolChoose', CJ, [p.nonce, 'Conjuration', 'primary']);
ui('firstSpellPick', CJ, [lastWidget(CJ, 'studyMagic').nonce, 'Bound Sword']);
known(CJ).add(idOf('7e8e1:Skyrim.esm')); // Raise Zombie
const REANIMATE = '65bd7:Skyrim.esm', BATTLEAXE = '211ec:Skyrim.esm';
put(CJ, 'private.dboSchools', Object.assign(rec(CJ), { levels: Object.assign(rec(CJ).levels, { Conjuration: { level: 25, xp: 99.99 } }) }));
f = view(CJ).schools.find((x) => x.name === 'Conjuration').firstSpell;
check('an excluded successor is skipped: Reanimate Corpse (restricted) is not offered to an Associate; Bound Battleaxe leads', f.stage === 'Apprentice' && !f.choices.some((c) => c.id === REANIMATE) && f.choices[0].id === BATTLEAXE && f.choices[0].line === 'Bound Sword', f.choices.slice(0, 3));
put(CJ, 'private.dboGuilds', [{ id: 'synod', role: 'officer' }]);
const guildsOfWas = globalThis.__dboGuildsOf; globalThis.__dboGuildsOf = (a) => props.get(a + '|private.dboGuilds') || [];
f = view(CJ).schools.find((x) => x.name === 'Conjuration').firstSpell;
const seniorOk = typeof globalThis.__dboSpellsOpenTo === 'function' && globalThis.__dboSpellsOpenTo(CJ, idOf(REANIMATE)) === '';
check('...a Senior rank (a Synod officer) sees it, marked as the next of their line', seniorOk && f.choices.some((c) => c.id === REANIMATE && c.line === 'Raise Zombie'), [seniorOk, f.choices.slice(0, 3)]);
put(CJ, 'private.dboGuilds', []); globalThis.__dboGuildsOf = guildsOfWas;
check('a removed spell (Transmute) is never a rank option', !(globalThis.__dboSpellsRankOptions('Alteration', 2) || []).includes(idOf('109111:Skyrim.esm')) && (globalThis.__dboSpellsRankOptions('Alteration', 2) || []).length > 0);
// Restoration follows Priest: its lines (Healing > Fast Healing, Lesser Ward > Steadfast Ward) at Priest's picks
const RL = 0x37; put(RL, 'profileId', RL); at(RL, SYNOD, [0, 0, 0]); online.push(RL); ui('uiCaps', RL, ['bank', 'spellbook', 'schools']);
priestOf(RL, 25);
tick('schools.first'); advance(91000);
r = globalThis.__dboMagicAction(RL, 'firstSpell', ['Restoration', HEALING]);
book(RL, ['13018:Skyrim.esm'], 'priest'); // Lesser Ward
{ const m = props.get(RL + '|private.mastery'); m.skills.priest.xp = 95; put(RL, 'private.mastery', m); }
f = view(RL).schools.find((x) => x.name === 'Restoration').firstSpell;
check('Restoration\'s lines follow Priest: Fast Healing (from Healing) and Steadfast Ward (from Lesser Ward) first', r.ok && f.stage === 'Apprentice' && f.choices.slice(0, 2).every((c) => c.line) && f.choices.some((c) => c.id === '2f3b8:Skyrim.esm' && c.line === 'Healing') && f.choices.some((c) => c.id === '211f1:Skyrim.esm' && c.line === 'Lesser Ward'), [r, f.choices.slice(0, 3)]);
// A school with no first spells listed still reaches its rank picks (no hold strands it)
load({ firstSpells: Object.assign({}, schoolsCfg.firstSpells || {}, { Illusion: [] }) });
const IL = 0x38; put(IL, 'profileId', IL); at(IL, SYNOD, [0, 0, 0]); online.push(IL); ui('uiCaps', IL, ['bank', 'spellbook', 'schools']); arcane(IL, 25);
tick('schools.first'); advance(91000);
p = progress(IL); ui('schoolChoose', IL, [p.nonce, 'Illusion', 'primary']);
for (let i = 0; i < 600; i++) globalThis.__dboSchoolsCast(IL, idOf(T.courage[1]));
const ilf = view(IL).schools.find((x) => x.name === 'Illusion').firstSpell;
check('a school with no first spells: held at 25 but its Apprentice pick opens (never stranded)', level(IL, 'Illusion') <= 25 && (level(IL, 'Illusion') < 25 || (ilf.state === 'open' && ilf.stage === 'Apprentice')), [rec(IL).levels.Illusion, ilf]);
load();
// Config: a bad value falls back to its default, logged
load({ rankPicks: { ranks: { Apprentice: 'x', Adept: 50 }, priestHoldXp: 500 } });
check('config: a rank at a bad level is left out and a bad priestHoldXp falls back, both logged', out.logs.some((l) => /rankPicks\.ranks\.Apprentice "x" is not a rank/.test(l)) && out.logs.some((l) => /priestHoldXp 500 is not 0 to 99\.99/.test(l)));
load();

// ---- switched off ----
load({ rankPicks: { enabled: false } });
const OFF = 0x34; put(OFF, 'profileId', OFF); at(OFF, SYNOD, [0, 0, 0]); online.push(OFF); ui('uiCaps', OFF, ['bank', 'spellbook', 'schools']); arcane(OFF, 25);
tick('schools.first'); advance(91000);
p = progress(OFF); ui('schoolChoose', OFF, [p.nonce, 'Destruction', 'primary']);
ui('firstSpellPick', OFF, [lastWidget(OFF, 'studyMagic').nonce, 'Frostbite']);
for (let dd = 0; dd < 3; dd++) { for (let i = 0; i < 400; i++) globalThis.__dboSchoolsCast(OFF, casts[i % 4]); advance(24 * HOUR); }
check('rankPicks.enabled false: nothing holds the school at 25', level(OFF, 'Destruction') > 25, rec(OFF).levels.Destruction);

console.log(`${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed:', e.stack || e.message); process.exit(1); });
