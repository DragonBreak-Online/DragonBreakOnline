// Scripted test for the staff grant of school levels in server\schools.js (__dboSchoolsGrant, mod-0311, Jake 22 Oct) with
// the real spells.js, and a staff gift of school levels delivered through it by the real gifts.js: levels are added (not
// set), capped at 100, the xp into the level kept; like credit() a grant stops at an Apprentice or Adept pick not yet made
// and never pulls back a school already past one; bad input is refused; each grant is audited and refreshes the K menu.
// Setup from tests/rank-picks-harness.js. No server and no game: run it from this folder's parent with
//
//   node tests/schools-grant-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const SPELLS = path.join(SERVER, 'spells.js');
const SCHOOLS = path.join(SERVER, 'schools.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-schools-grant-'));
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

// The hook, or a refusal when this schools.js has none (so every check below fails on code without it)
const grant = (...a) => (typeof globalThis.__dboSchoolsGrant === 'function' ? globalThis.__dboSchoolsGrant(...a) : { ok: false, text: 'no __dboSchoolsGrant' });
const xpOf = (a, school) => { const r = rec(a); return r && r.levels[school] ? r.levels[school].xp : 0; };
const audits = (re) => out.audits.filter((l) => re.test(l));
const picked = { spell: T.flames[1], how: 'chose', at: 1 };
// A mage whose record is written as the live server keeps it: Destruction primary at `lv` with `xp` into the level
const mage = (a, lv, xp, rankPicks) => {
  put(a, 'profileId', a); at(a, SYNOD, [0, 0, 0]); online.push(a);
  put(a, 'private.dboSchools', { v: 1, primary: 'Destruction', secondary: null, grandfathered: [], levels: { Destruction: { level: lv, xp } }, picks: { Destruction: picked }, pickTold: {}, rankPicks: { Destruction: rankPicks } });
};
const BOTH = { Apprentice: picked, Adept: picked };

// ---- Elion's case: 64 and 40% of the way to 65, +21 ----
const ELION = 0x41; mage(ELION, 64, 40, BOTH);
let r = grant(ELION, 'destruction', 21, 'Jake', 'mod-0311: classes underpaid');
check('+21 Destruction from 64 is 85: levels are added, not set', r.ok === true && r.added === 21 && r.from === 64 && r.to === 85 && level(ELION, 'Destruction') === 85, r);
check('...the xp into the level is kept (40)', level(ELION, 'Destruction') === 85 && xpOf(ELION, 'Destruction') === 40, rec(ELION).levels.Destruction);
check('...it is audited in the SCHOOLS style with the giver and the reason', audits(/^SCHOOLS Jake granted P41 21 Destruction levels: 64 to 85 \(primary\); mod-0311: classes underpaid$/).length === 1, out.audits.slice(-2));
check('...and the K menu is sent again', !!lastPacket(ELION, 'dboSchoolProgress') && lastPacket(ELION, 'dboSchoolProgress').progress !== undefined && out.packets.filter((x) => x.a === ELION).length === 1, out.packets.filter((x) => x.a === ELION).length);
check('...the hook tells no one itself (the caller does)', r.ok === true && !out.said.some((x) => x[0] === ELION));

// ---- the cap at 100 ----
r = grant(ELION, 'Destruction', 30, 'Jake', 'cap');
check('+30 from 85 stops at 100: 15 given, xp 0, the rest said in the audit', r.ok && r.added === 15 && level(ELION, 'Destruction') === 100 && xpOf(ELION, 'Destruction') === 0 && audits(/^SCHOOLS Jake granted P41 15 Destruction levels: 85 to 100 \(primary; capped at 100, 15 not given\); cap$/).length === 1, [r, out.audits.slice(-1)]);
let n = out.audits.length;
r = grant(ELION, 'Destruction', 1, 'Jake', 'more');
check('at 100 nothing is given, nothing audited, and it says so', r.ok === false && r.added === 0 && /already 100/.test(r.text) && out.audits.length === n && level(ELION, 'Destruction') === 100, r);

// ---- a rank pick not yet made holds the grant, as it holds credit() ----
const HELD = 0x42; mage(HELD, 40, 20, { Apprentice: picked });
r = grant(HELD, 'Destruction', 20, 'Nate', 'held');
check('+20 from 40 with no Adept spell chosen stops at 50, held (xp 99.99): 10 given', r.ok && r.added === 10 && r.heldFor === 'Adept' && level(HELD, 'Destruction') === 50 && xpOf(HELD, 'Destruction') === 99.99, [r, rec(HELD).levels]);
check('...the audit says it was held and what was not given', audits(/^SCHOOLS Nate granted P42 10 Destruction levels: 40 to 50 \(primary; held at 50 for the Adept spell, 10 not given\); held$/).length === 1, out.audits.slice(-1));
n = out.audits.length;
r = grant(HELD, 'Destruction', 5, 'Nate', 'again');
check('...a second grant while held gives nothing and says why', r.ok === false && r.added === 0 && /held at 50 until its Adept spell is chosen/.test(r.text) && level(HELD, 'Destruction') === 50 && out.audits.length === n, r);
const PAST = 0x43; mage(PAST, 60, 0, { Apprentice: picked });
r = grant(PAST, 'Destruction', 10, 'Nate', 'past');
check('a school already past an unmade pick is never pulled back: 60 +10 is 70', r.ok && r.added === 10 && level(PAST, 'Destruction') === 70 && !r.heldFor, r);
const EXPERT = 0x44; mage(EXPERT, 70, 50, BOTH);
r = grant(EXPERT, 'Destruction', 10, 'Nate', 'expert');
check('crossing Expert at 75 (a rank, no pick) is not held: 70 +10 is 80', r.ok && level(EXPERT, 'Destruction') === 80 && xpOf(EXPERT, 'Destruction') === 50, r);
const RESTING = 0x45; mage(RESTING, 30, 0, BOTH);
r = grant(RESTING, 'Illusion', 5, 'Nate', 'resting');
check('a school not one of theirs is granted as /schools set does, and rests (audited as locked)', r.ok && level(RESTING, 'Illusion') === 5 && audits(/^SCHOOLS Nate granted P45 5 Illusion levels: 0 to 5 \(locked\); resting$/).length === 1, r);

// ---- bad input is refused and changes nothing ----
n = out.audits.length;
const lv0 = level(EXPERT, 'Destruction');
const refusals = [
  ['Restoration', 5, /Priest skill/], ['Fire', 5, /not a school of magic\. Schools: /], ['', 5, /not a school of magic/],
  ['Destruction', 0, /1 to 100 whole levels/], ['Destruction', 101, /1 to 100 whole levels/], ['Destruction', 2.5, /1 to 100 whole levels/],
  ['Destruction', '5', /1 to 100 whole levels/], ['Destruction', -3, /1 to 100 whole levels/], ['Destruction', NaN, /1 to 100 whole levels/],
];
const bad = refusals.map(([s, l, re]) => [s, l, grant(EXPERT, s, l, 'Nate', 'bad')]).filter(([s, l, x], i) => x.ok !== false || !refusals[i][2].test(x.text));
check('Restoration, an unknown school and a level outside whole 1-100 are refused with the reason', bad.length === 0, bad);
check('...and none of them changes a level or writes an audit line', typeof globalThis.__dboSchoolsGrant === 'function' && level(EXPERT, 'Destruction') === lv0 && out.audits.length === n, [level(EXPERT, 'Destruction'), out.audits.slice(n)]);
check('a staff actor as the giver is named as one', grant(EXPERT, 'Destruction', 1, TEACHER, 'by actor').ok && audits(/^SCHOOLS P15 granted P44 1 Destruction level: 80 to 81 \(primary\); by actor$/).length === 1, out.audits.slice(-1));

// ---- a staff gift of school levels through the real gifts.js ----
{
  put(ELION, 'private.charTag', '8YDB');
  const ALDEMAR = 0x46; mage(ALDEMAR, 76, 10, BOTH); put(ALDEMAR, 'private.charTag', '8HSY');
  const giftTimers = new Map();
  const given = [];
  const giftApi = () => ({ mp, log: (...a) => out.logs.push(a.join(' ')), personal: (a, t) => out.said.push([a, t]), audit: (t) => out.audits.push(t), who: (a) => `P${a.toString(16)}`,
    onlineActors: () => online.slice(), profileOf: (a) => props.get(a + '|profileId'), giveItem: (a, b, c) => { given.push([a, b, c]); return true; }, every: (name, ms, fn) => giftTimers.set(name, fn) });
  const GIFTS = path.join(SERVER, 'gifts.js');
  const loadGifts = () => { delete require.cache[GIFTS]; require(GIFTS)(giftApi()); };
  loadGifts();
  fs.mkdirSync('gifts-inbox', { recursive: true });
  fs.writeFileSync(path.join('gifts-inbox', 'g-aldemar.json'), JSON.stringify({ tag: '8HSY', schools: { Destruction: 10 }, reason: 'Your classes were underpaid under the old rule.', by: 'Jake', at: '2026-10-22T00:00:00Z' }));
  online = online.filter((a) => a !== ALDEMAR);
  giftTimers.get('gifts')();
  check('gift: Aldemar offline, the schools gift waits (and is no bad file)', level(ALDEMAR, 'Destruction') === 76 && fs.existsSync(path.join('gifts-inbox', 'g-aldemar.json')) && !out.logs.some((l) => /g-aldemar\.json refused/.test(l)), out.logs.slice(-1));
  online.push(ALDEMAR);
  giftTimers.get('gifts')();
  check('gift: in the world, +10 Destruction through the real hook: 76 to 86, xp kept', level(ALDEMAR, 'Destruction') === 86 && xpOf(ALDEMAR, 'Destruction') === 10, rec(ALDEMAR).levels.Destruction);
  check('gift: he is told in one line with the reason', out.said.filter((x) => x[0] === ALDEMAR).map((x) => x[1]).join('|') === 'A gift from the staff: 10 levels of Destruction. Your classes were underpaid under the old rule.', out.said.filter((x) => x[0] === ALDEMAR));
  check('gift: the SCHOOLS and GIFT audit lines both name it', audits(/^SCHOOLS Jake granted P46 10 Destruction levels: 76 to 86 \(primary\); Your classes/).length === 1 && audits(/^GIFT g-aldemar by Jake to P46: 10 Destruction levels \(76 to 86\); Your classes/).length === 1, out.audits.slice(-2));
  giftTimers.get('gifts')(); loadGifts(); giftTimers.get('gifts')();
  check('gift: a second pass and a reload pay nothing more', level(ALDEMAR, 'Destruction') === 86 && audits(/^SCHOOLS Jake granted P46/).length === 1, rec(ALDEMAR).levels.Destruction);
}

console.log(`\n${checks - failures}/${checks} passed`);
process.chdir(os.tmpdir());
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
