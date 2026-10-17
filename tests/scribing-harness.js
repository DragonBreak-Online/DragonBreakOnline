// Scripted test for scribing.js (Nate and Swag, 17 Oct): a Master Scholar writes spell tomes and scrolls at a Scholars'
// Ledger. Tomes: a spell the writer knows that a tome teaches; Novice no scroll and 24 h, Apprentice 1 scroll and 48 h, Adept
// 2 and 4 days, Expert 4 and 7 days (any scrolls, the cheapest first), Master 5 of that spell's own scroll and 14 days with a
// co-writer who is a Master of the school, knows the spell, stands within 10 m and accepts; both wait; the writer of a Master
// tome need not know it; one tome timer whatever the rank. Scrolls: a spell the writer knows that has a scroll, below Master;
// a Linen Wrap, a Charcoal and a filled soul gem (an empty gem holding a soul counts, an empty one does not; the smallest
// first); a timer of its own, 1-4 days. Materials go back when the item cannot be given; the timers survive a reload and a
// restart; spells.js's per-rank record of 16 Oct carries over. Also: the ledger rows, the F3 Scholar page, and the colleges
// in schools.js (guild-defs.json "college": true). Loads the real spells.js, schools.js, salvage.js, skillrates.js,
// journalskills.js and scribing.js against one stub mp (the scaffolding of tests/tome-writing-harness.js, which this replaces).
//
//   node tests/scribing-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const F = (n) => path.join(SERVER, n);
const CONFIG = JSON.parse(fs.readFileSync(F('gamemode-config.json'), 'utf8'));
const GUILDS = JSON.parse(fs.readFileSync(F('guild-defs.json'), 'utf8')).factions;
const TOMES = JSON.parse(fs.readFileSync(F('spell-tomes.json'), 'utf8')).tomes;
const SCROLLS = JSON.parse(fs.readFileSync(F('spell-scrolls.json'), 'utf8'));

const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-scribing-'));
process.chdir(dir);
for (const f of ['skills.json', 'spell-tomes.json', 'salvage.json', 'readables.json', 'spell-scrolls.json']) fs.copyFileSync(F(f), f);
// guild-defs.json with one more college, for schools.js's own reading of the file when guilds.js is not there
const defs = JSON.parse(fs.readFileSync(F('guild-defs.json'), 'utf8'));
defs.factions.push({ id: 'college-of-the-test', name: 'College of the Test', kind: 'guild', college: true, ranks: [{ title: 'Head', role: 'leader' }, { title: 'Reader', role: 'officer' }] });
fs.writeFileSync('guild-defs.json', JSON.stringify(defs));

let wallClock = Date.parse('2026-10-17T09:00:00Z');
Date.now = () => wallClock;
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

let failures = 0, checks = 0;
const check = (name, ok, detail) => { checks++; if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); } else console.log(`ok   ${name}`); };

const PLUGINS = { 'Skyrim.esm': 0x00, 'Dawnguard.esm': 0x02, 'HearthFires.esm': 0x03, 'Dragonborn.esm': 0x04, 'ccBGSSSE025-AdvDSGS.esm': 0x09, 'BSAssets.esm': 0x0a, 'BSHeartland.esm': 0x0b, 'SurWR.esp': 0x20, 'Gray Fox Cowl.esm': 0x30, 'DragonBreak.esp': 0x3b, 'DragonBreak Online Edits.esp': 0x3c };
const BY_INDEX = Object.fromEntries(Object.entries(PLUGINS).map(([k, v]) => [v, k]));
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const descOf = (id) => { const p = BY_INDEX[id >>> 24]; if (!p) throw new Error('no plugin ' + (id >>> 0).toString(16)); return `${(id & 0xffffff).toString(16)}:${p}`; };
const canon = (c) => { const i = c.lastIndexOf(':'); return `${parseInt(c.slice(i + 1), 16).toString(16)}:${c.slice(0, i)}`; };
const tome = (edid) => { const t = TOMES.find((x) => x.name === edid); return { book: canon(t.id), spell: canon(t.spellId), rank: t.rank }; };
const scrollOf = (t) => idOf(SCROLLS.spells.find((e) => e.spellId === t.spell).scrollId);
const FLAMES = tome('SpellTomeFlames'), CANDLE = tome('SpellTomeCandlelight'), OAK = tome('SpellTomeOakflesh'), FIREBOLT = tome('SpellTomeFirebolt');
const FIREBALL = tome('SpellTomeFireball'), EBONY = tome('SpellTomeEbonyflesh'), FIRESTORM = tome('SpellTomeFireStorm'), GUARDIAN = tome('SpellTomeGuardianCircle');
const RAISEZ = tome('SpellTomeRaiseZombie'), SPARKS = tome('SpellTomeSparks');
const SC = { firebolt: scrollOf(FIREBOLT), fireball: scrollOf(FIREBALL), candle: scrollOf(CANDLE), oak: scrollOf(OAK), ebony: scrollOf(EBONY), firestorm: scrollOf(FIRESTORM), guardian: scrollOf(GUARDIAN) };
const SCROLL_VALUE = Object.fromEntries(SCROLLS.scrolls.map((s) => [s.id, s.value]));
const LINEN = idOf('34cd6:Skyrim.esm'), CHARCOAL = idOf('33760:Skyrim.esm');
const GEM = { petty: idOf('2e4e3:Skyrim.esm'), lesser: idOf('2e4e5:Skyrim.esm'), grand: idOf('2e4ff:Skyrim.esm'), black: idOf('2e504:Skyrim.esm'), pettyEmpty: idOf('2e4e2:Skyrim.esm'), greaterEmpty: idOf('2e4f4:Skyrim.esm') };

const SYNOD = '20ff:BSHeartland.esm', BRUMA = 'a764b:BSHeartland.esm';
const SCHOLARS_BASE = 'dcf0f:BSHeartland.esm', LECTERN_BASE = '15e4b7:DragonBreak Online Edits.esp';
const LEDGER = idOf('13f774:DragonBreak Online Edits.esp');
const LECTERN = idOf('15e4bb:DragonBreak Online Edits.esp');
const RECORDS = {
  [idOf(SCHOLARS_BASE)]: { type: 'ACTI', editorId: 'BookBreakdown', fields: [] },
  [idOf(LECTERN_BASE)]: { type: 'ACTI', editorId: 'ClassLectern', fields: [] },
};

const W = 0x14, PRIEST = 0x15, DMAGE = 0x16, EXPERT = 0x17, FAR = 0x18, PLAIN = 0x19;
const NAMES = { [W]: 'Writer', [PRIEST]: 'Priest', [DMAGE]: 'Dmage', [EXPERT]: 'Expertscholar', [FAR]: 'Far', [PLAIN]: 'Plain' };
const props = new Map();
const put = (id, p, v) => props.set((id >>> 0) + '|' + p, v === undefined ? v : JSON.parse(JSON.stringify(v)));
const getp = (id, p) => props.get((id >>> 0) + '|' + p);
const at = (id, cell, pos) => { put(id, 'worldOrCellDesc', cell); put(id, 'pos', pos || [0, 0, 0]); };
const tierOfLevel = (l) => (l >= 90 ? 4 : l >= 75 ? 3 : l >= 50 ? 2 : l >= 25 ? 1 : 0);
const skillAt = (a, skill, level) => {
  const r = getp(a, 'private.mastery') || { v: 2, skills: {}, order: [] };
  r.skills[skill] = { level, xp: 0, rank: tierOfLevel(level) };
  if (!r.order.includes(skill)) r.order.push(skill);
  put(a, 'private.mastery', r);
};
const count = (a, baseId) => ((getp(a, 'inventory') || { entries: [] }).entries.filter((e) => e.baseId === baseId).reduce((n, e) => n + e.count, 0));
const items = (a, list) => put(a, 'inventory', { entries: list.map(([baseId, n, extra]) => Object.assign({ baseId, count: n }, extra || {})) });
const study = (a, book, list) => put(a, 'private.dboStudied', Object.assign({}, getp(a, 'private.dboStudied') || {}, { [book]: list.map((t) => t.spell) }));
put(LEDGER, 'baseDesc', SCHOLARS_BASE); at(LEDGER, SYNOD, [0, 0, 0]);
put(LECTERN, 'baseDesc', LECTERN_BASE); at(LECTERN, SYNOD, [300, 0, 0]);

const MEMBERS = {};
const member = (a, fid, title) => {
  const f = GUILDS.find((x) => x.id === fid) || defs.factions.find((x) => x.id === fid);
  const r = f.ranks.find((x) => x.title === title);
  MEMBERS[a] = [{ id: fid, name: f.name, title, role: r.role }];
  put(a, 'private.dboGuilds', [{ id: fid, rank: f.ranks.indexOf(r), role: r.role }]);
};
globalThis.__dboGuildsOf = (a) => MEMBERS[a >>> 0] || [];
globalThis.__dboGuildRankList = (id) => { const f = GUILDS.find((x) => x.id === String(id)); return f ? f.ranks.map((r) => ({ title: r.title, role: r.role })) : null; };
globalThis.__dboHallFactionAt = (cell) => ({ [SYNOD.toLowerCase()]: { id: 'synod', name: 'The Synod' } }[String(cell).toLowerCase()] || null);

const learned = new Map();
const known = (a) => learned.get(a >>> 0) || (learned.set(a >>> 0, new Set()), learned.get(a >>> 0));
const mp = {
  getIdFromDesc: idOf, getDescFromId: descOf,
  get: (id, p) => getp(id, p),
  set: (id, p, v) => put(id, p, v),
  lookupEspmRecordById: (id) => (RECORDS[id >>> 0] ? { record: RECORDS[id >>> 0], toGlobalRecordId: (l) => l } : null),
  callPapyrusFunction: (kind, cls, fn, self, args) => {
    if (cls === 'Debug') return null;
    const a = idOf(self.desc); const s = known(a);
    if (fn === 'GetSpellCount') return s.size;
    if (fn === 'GetNthSpell') { const id = [...s][args[0]]; return id === undefined ? null : { type: 'espm', desc: descOf(id) }; }
    const spell = idOf(args[0].desc);
    if (fn === 'AddSpell') { if (s.has(spell)) return false; s.add(spell); return true; }
    if (fn === 'RemoveSpell') return s.delete(spell);
    return false;
  },
};
mp.onReadBook = () => undefined;
globalThis.__alduinakMasteryFirstTouch = () => 'ok';
globalThis.__alduinakMasteryEvent = () => {};
globalThis.__alduinakMasteryAward = () => 0;

let online = [W, PRIEST, DMAGE, EXPERT, FAR, PLAIN];
for (const a of online) { at(a, SYNOD); put(a, 'profileId', a); items(a, []); }
const out = { widgets: [], closed: [], said: [], audits: [], logs: [], seq: [] };
const handlers = new Map(), commands = new Map(), timers = new Map();
let giveFails = false;
const baseCfg = () => ({ spells: CONFIG.spells, schools: Object.assign({}, CONFIG.schools, { enabled: true }), salvage: CONFIG.salvage, skillRates: CONFIG.skillRates, scribing: CONFIG.scribing });
const api = {
  mp, cfg: baseCfg(),
  log: (...a) => out.logs.push(a.join(' ')), personal: (a, t) => out.said.push([a >>> 0, t]), system: (a, t) => out.said.push([a >>> 0, t]),
  audit: (t) => out.audits.push(t), who: (a) => `P${(a >>> 0).toString(16)}`, display: (a) => NAMES[a >>> 0] || `P${(a >>> 0).toString(16)}`,
  giveItem: (a, baseId, n) => { if (giveFails) return false; const e = (getp(a, 'inventory') || { entries: [] }).entries; const h = e.find((x) => x.baseId === baseId && Object.keys(x).length === 2); if (h) h.count += n; else e.push({ baseId, count: n }); put(a, 'inventory', { entries: e }); return true; },
  takeGold: () => false, depositToTreasury: (zone, n) => n,
  registerChatCommand: (name, fn, opts) => commands.set(name, { fn, opts }),
  onlineActors: () => online.slice(),
  every: (name, ms, fn) => timers.set(name, fn),
  openWidget: (a, w, focus) => { out.widgets.push({ a: a >>> 0, w, focus }); out.seq.push(['open', a >>> 0, w.id]); return true; },
  closeWidget: (a, id) => { out.closed.push([a >>> 0, id]); out.seq.push(['close', a >>> 0, id]); return true; },
  onUi: (ev, fn) => { const l = handlers.get(ev) || []; l.push(fn); handlers.set(ev, l); },
  distanceMeters: (a, b) => { if (getp(a, 'worldOrCellDesc') !== getp(b, 'worldOrCellDesc')) return Infinity; const p = getp(a, 'pos'), q = getp(b, 'pos'); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 70; },
  sendPacket: () => true, isAdmin: () => false, findByName: () => null, isWorldspace: (d) => d === BRUMA,
  profileOf: (a) => { const v = getp(a, 'profileId'); return v === undefined ? -1 : v; },
  masteryOf: (a) => getp(a, 'private.mastery') || null,
  recordOf: (id) => (RECORDS[id >>> 0] ? { record: RECORDS[id >>> 0], toGlobalRecordId: (l) => l } : null),
  fieldsOf: (lr, t) => ((lr && lr.record.fields) || []).filter((f) => f.type === t),
  itemName: () => 'something', inBeastForm: () => false,
};
const MODULES = ['spells.js', 'schools.js', 'salvage.js', 'skillrates.js', 'journalskills.js', 'scribing.js'].map(F);
const load = (cfg) => { api.cfg = cfg || baseCfg(); handlers.clear(); commands.clear(); for (const f of MODULES) delete require.cache[f]; for (const f of MODULES) require(f)(api); };
load();
const ui = (ev, a, args, widgetId) => (handlers.get(ev) || []).forEach((fn) => fn(a, args || [], widgetId || 0));
const lastWidget = (a, type) => { const l = out.widgets.filter((w) => w.a === (a >>> 0) && (!type || w.w.type === type)); return l.length ? l[l.length - 1].w : null; };
const said = (a) => { const l = out.said.filter((p) => p[0] === (a >>> 0)); return l.length ? l[l.length - 1][1] : ''; };
const lastAudit = (re) => out.audits.slice().reverse().find((t) => re.test(t)) || '';
const list = (a, kind) => { globalThis.__dboScribingOpen(a, kind, LEDGER); return lastWidget(a, 'contextMenu'); };
const pick = (a, id) => { ui('scribeChoose', a, [id], 93); return lastWidget(a, 'contextMenu'); };
const rowOf = (m, prefix, t) => m.actions.find((x) => x.id === `${prefix}:${t.spell}`);
const allRows = (a, kind) => {
  let m = list(a, kind); const rows = []; const seen = new Set();
  for (;;) { rows.push(...m.actions.filter((x) => /^[ts]:/.test(x.id))); const more = m.actions.find((x) => x.id.startsWith('page:')); if (!more || seen.has(more.id) || more.id === 'page:0') break; seen.add(more.id); m = pick(a, more.id); }
  return rows;
};

// ---- the writer and their friends -------------------------------------------------------------------------------------------
skillAt(W, 'scholar', 92); skillAt(EXPERT, 'scholar', 80); skillAt(PRIEST, 'priest', 95); skillAt(DMAGE, 'arcane', 95);
study(W, 'arcane', [FLAMES, CANDLE, OAK, FIREBOLT, FIREBALL, EBONY, RAISEZ]);
study(EXPERT, 'arcane', [FLAMES, FIREBOLT]);
study(PRIEST, 'priest', [GUARDIAN]);
study(DMAGE, 'arcane', [FIRESTORM]);
// Dmage is a Master of Destruction on schools.js's meter (level 92, the primary school)
put(DMAGE, 'private.dboSchools', { v: 1, primary: 'Destruction', secondary: null, grandfathered: [], levels: { Destruction: { level: 92, xp: 0 } }, study: { log: [] }, priestStudy: { log: [] }, cast: { day: '', units: {} }, ring: [], classAt: 0, paidAt: 0, teacher: null, picks: {}, pickTold: {}, swapAt: 0, swaps: [] });
member(W, 'synod', 'Associate');

// ---- the gate ---------------------------------------------------------------------------------------------------------------
check('a Master Scholar gets both ledger rows', JSON.stringify(globalThis.__dboScribingActions(W).map((r) => r.id)) === '["scribe:tome","scribe:scroll"]', globalThis.__dboScribingActions(W));
check('...an Expert Scholar (80) gets none', globalThis.__dboScribingActions(EXPERT).length === 0);
check('...nor someone who never took up Scholar', globalThis.__dboScribingActions(PLAIN).length === 0);
check('an Expert Scholar is refused the list, with a line in chat', globalThis.__dboScribingOpen(EXPERT, 'tome', LEDGER) === false && /Only a Master Scholar writes spell tomes/.test(said(EXPERT)), said(EXPERT));
// The ledger hands over: the scribing list opens before the ledger menu closes (panel handoff)
globalThis.__dboSalvageActivate(LEDGER, W);
const ledger = lastWidget(W, 'contextMenu');
check('the Scholars\' Ledger menu shows Write a spell tome and Write a scroll', ledger.actions.some((x) => x.id === 'scribe:tome' && x.label === 'Write a spell tome') && ledger.actions.some((x) => x.id === 'scribe:scroll' && x.label === 'Write a scroll'), ledger.actions.map((x) => x.id));
out.seq.length = 0;
ui('salvageChoose', W, ['scribe:tome'], 66);
check('...choosing it opens the tome list (widget 93) and then closes the ledger menu (66)', JSON.stringify(out.seq) === JSON.stringify([['open', W, 93], ['close', W, 66]]), out.seq);

// ---- the tome list -------------------------------------------------------------------------------------------------------
let m = list(W, 'tome');
check('the title shows both timers', /^Tome writing: ready\. Scroll writing: ready\./.test(m.targetName), m.targetName);
const tRows = allRows(W, 'tome');
const tHas = (t) => tRows.some((x) => x.id === `t:${t.spell}`);
check('known spells with a tome are listed (Flames, Candlelight, Firebolt, Fireball, Ebonyflesh)', [FLAMES, CANDLE, FIREBOLT, FIREBALL, EBONY].every(tHas), tRows.map((x) => x.label));
check('...not a spell they do not know below Master (Sparks)', !tHas(SPARKS));
check('...not a restricted art below Senior (Raise Zombie)', !tHas(RAISEZ));
check('...but Master spells with a tome and a scroll of their own are, known or not (Fire Storm, Guardian Circle)', tHas(FIRESTORM) && tHas(GUARDIAN));
check('the list pages at 10 rows', m.actions.filter((x) => /^t:/.test(x.id)).length <= 10 && (tRows.length <= 10 || m.actions.some((x) => x.id === 'page:1')), m.actions.length);
const lab = (t) => (tRows.find((x) => x.id === `t:${t.spell}`) || {}).label || '';
check('rows say rank, materials and ready', /Flames \(Destruction, Novice\): no scrolls - ready/.test(lab(FLAMES)) && /Firebolt \(Destruction, Apprentice\): 1 scroll \(you carry 0\), short of scrolls - ready/.test(lab(FIREBOLT))
  && /Ebonyflesh \(Alteration, Expert\): 4 scrolls/.test(lab(EBONY)) && /Fire Storm \(Destruction, Master\): 5 scrolls of Fire Storm \(you carry 0\), with a Master of Destruction/.test(lab(FIRESTORM))
  && /Guardian Circle \(Restoration, Master\).*with a Master Priest/.test(lab(GUARDIAN)), [lab(FLAMES), lab(FIREBOLT), lab(EBONY), lab(FIRESTORM), lab(GUARDIAN)]);

// Novice: nothing spent, 24 h
items(W, [[SC.fireball, 1]]);
list(W, 'tome');
m = pick(W, `t:${FLAMES.spell}`);
check('a Novice tome is written from nothing; no scroll spent', count(W, idOf(FLAMES.book)) === 1 && count(W, SC.fireball) === 1 && /You write Spell Tome: Flames\. Your next spell tome can be written in 1 d\./.test(said(W)), said(W));
check('...audited with what it spent', /^SCRIBE TOME P14 wrote 9cd51:Skyrim\.esm Spell Tome: Flames \(Novice\) spending nothing$/.test(lastAudit(/SCRIBE TOME/)), lastAudit(/SCRIBE TOME/));
check('...the list title now shows the tome wait', /^Tome writing: in 1 d\./.test(m.targetName), m.targetName);
m = pick(W, `t:${CANDLE.spell}`);
check('one tome timer: another Novice spell (Candlelight) waits too, refused in chat', count(W, idOf(CANDLE.book)) === 0 && /your next can be written in 1 d/.test(said(W)) && /your next can be written in 1 d/.test(m.targetName), said(W));
wallClock += 23 * HOUR;
pick(W, `t:${FIREBOLT.spell}`);
check('...and a higher rank as well, an hour before it ends', count(W, idOf(FIREBOLT.book)) === 0 && /in 1 h/.test(said(W)), said(W));
wallClock += HOUR + MIN;

// Apprentice: 1 scroll of any spell, the cheapest first, 48 h
check('the scrolls\' values come from the plugins (Fireball scroll worth more than Candlelight\'s)', SCROLL_VALUE[descOf(SC.fireball)] > SCROLL_VALUE[descOf(SC.candle)], [SCROLL_VALUE[descOf(SC.fireball)], SCROLL_VALUE[descOf(SC.candle)]]);
items(W, [[SC.fireball, 1], [SC.candle, 1]]);
pick(W, `t:${FIREBOLT.spell}`);
check('an Apprentice tome takes 1 scroll of any spell (not Firebolt\'s), the cheapest', count(W, idOf(FIREBOLT.book)) === 1 && count(W, SC.candle) === 0 && count(W, SC.fireball) === 1, said(W));
check('...audited with the scroll it spent', /Spell Tome: Firebolt \(Apprentice\) spending 1 x 9659b:Skyrim\.esm$/.test(lastAudit(/SCRIBE TOME/)), lastAudit(/SCRIBE TOME/));
wallClock += 47 * HOUR;
check('...the wait is 48 h', /in 1 h/.test(globalThis.__dboScribingBrief(W).tome), globalThis.__dboScribingBrief(W));
wallClock += HOUR + MIN;
// Adept: 2 scrolls
items(W, [[SC.fireball, 1]]);
pick(W, `t:${FIREBALL.spell}`);
check('an Adept tome with 1 scroll is refused with the count, nothing spent', count(W, idOf(FIREBALL.book)) === 0 && count(W, SC.fireball) === 1 && /An Adept tome needs 2 scrolls; you carry 1\./.test(said(W)), said(W));
items(W, [[SC.fireball, 1], [SC.oak, 3]]);
pick(W, `t:${FIREBALL.spell}`);
check('...with 2 or more (two kinds) it takes 2, cheapest first', count(W, idOf(FIREBALL.book)) === 1 && count(W, SC.oak) + count(W, SC.fireball) === 2, [count(W, SC.oak), count(W, SC.fireball)]);
wallClock += 4 * DAY - HOUR;
check('...and waits 4 days', globalThis.__dboScribingBrief(W).tome === 'in 1 h', globalThis.__dboScribingBrief(W));
wallClock += HOUR + MIN;
// Expert: 4 scrolls, 7 days; worn scrolls (in a hand) do not count
items(W, [[SC.oak, 3], [SC.candle, 1, { worn: true }]]);
pick(W, `t:${EBONY.spell}`);
check('an Expert tome needs 4; a scroll held in the hand does not count', count(W, idOf(EBONY.book)) === 0 && /An Expert tome needs 4 scrolls; you carry 3\./.test(said(W)), said(W));
items(W, [[SC.oak, 4]]);
pick(W, `t:${EBONY.spell}`);
check('...with 4 it is written and all 4 spent', count(W, idOf(EBONY.book)) === 1 && count(W, SC.oak) === 0);
wallClock += 7 * DAY - HOUR;
check('...and waits 7 days', globalThis.__dboScribingBrief(W).tome === 'in 1 h', globalThis.__dboScribingBrief(W));
wallClock += HOUR + MIN;

// Master: 5 of the spell's own scroll; a co-writer
items(W, [[SC.oak, 9], [SC.firestorm, 4]]);
m = pick(W, `t:${FIRESTORM.spell}`);
check('a Master tome counts only its own spell\'s scrolls', /A Master tome needs 5 scrolls of Fire Storm; you carry 4\./.test(said(W)), said(W));
items(W, [[SC.firestorm, 5]]);
at(DMAGE, BRUMA);
m = pick(W, `t:${FIRESTORM.spell}`);
check('no co-writer near: refused, nothing spent', /needs a co-writer: a Master of Destruction who knows Fire Storm, within 10 m/.test(said(W)) && count(W, SC.firestorm) === 5, said(W));
at(DMAGE, SYNOD, [70 * 12, 0, 0]);
pick(W, `t:${FIRESTORM.spell}`);
check('...one 12 m away is not near enough', /needs a co-writer/.test(said(W)));
at(DMAGE, SYNOD, [70 * 8, 0, 0]);
m = pick(W, `t:${FIRESTORM.spell}`);
check('...at 8 m a Master of Destruction who knows it is offered; the writer need not know Fire Storm', !known(W).has(idOf(FIRESTORM.spell)) && m.actions.some((x) => x.id === `h:${DMAGE.toString(16)}:${FIRESTORM.spell}`) && !m.actions.some((x) => x.id.startsWith(`h:${PRIEST.toString(16)}`)), m.actions);
pick(W, `h:${DMAGE.toString(16)}:${FIRESTORM.spell}`);
let ask = lastWidget(DMAGE, 'contextMenu');
check('the co-writer is asked', ask && ask.id === 93 && /Writer asks you to co-write a Master tome of Fire Storm/.test(ask.targetName) && ask.events.action === 'dbo:scribeHelp', ask && ask.targetName);
ui('scribeHelp', DMAGE, ['decline'], 93);
check('declining: the writer is told, nothing written or spent', /Dmage declines to co-write/.test(said(W)) && count(W, idOf(FIRESTORM.book)) === 0 && count(W, SC.firestorm) === 5, said(W));
pick(W, `t:${FIRESTORM.spell}`); pick(W, `h:${DMAGE.toString(16)}:${FIRESTORM.spell}`);
wallClock += 61 * 1000;
ui('scribeHelp', DMAGE, ['accept'], 93);
check('an answer after offerSeconds has lapsed', /lapsed/.test(said(DMAGE)) && count(W, idOf(FIRESTORM.book)) === 0);
pick(W, `t:${FIRESTORM.spell}`); pick(W, `h:${DMAGE.toString(16)}:${FIRESTORM.spell}`);
ui('scribeHelp', DMAGE, ['accept'], 93);
check('accepting writes the Master tome and spends the 5 scrolls', count(W, idOf(FIRESTORM.book)) === 1 && count(W, SC.firestorm) === 0, said(W));
check('...the co-writer spends nothing and is told', count(DMAGE, idOf(FIRESTORM.book)) === 0 && /You co-write Spell Tome: Fire Storm with Writer\. Your next spell tome can be written in 14 d\./.test(said(DMAGE)), said(DMAGE));
check('...audited with the co-writer', /Spell Tome: Fire Storm \(Master\) spending 5 x a44b1:Skyrim\.esm, co-writer P16$/.test(lastAudit(/SCRIBE TOME/)), lastAudit(/SCRIBE TOME/));
check('...both wait 14 days', globalThis.__dboScribingBrief(W).tome === 'in 14 d' && JSON.stringify(getp(DMAGE, 'private.dboScribeTome')) === JSON.stringify({ at: wallClock, rank: 4, spell: FIRESTORM.spell }), [globalThis.__dboScribingBrief(W), getp(DMAGE, 'private.dboScribeTome')]);
wallClock += 14 * DAY + MIN;
// A co-writer who is not a Master, does not know the spell, or is still waiting, is not offered
items(W, [[SC.guardian, 5]]);
skillAt(PRIEST, 'priest', 85);
pick(W, `t:${GUARDIAN.spell}`);
check('a Priest at 85 (Expert) is no co-writer for Restoration', /needs a co-writer: a Master Priest who knows Guardian Circle/.test(said(W)), said(W));
skillAt(PRIEST, 'priest', 95); known(PRIEST); study(PRIEST, 'priest', []);
pick(W, `t:${GUARDIAN.spell}`);
check('...a Master Priest who does not know the spell is not either', /needs a co-writer/.test(said(W)));
study(PRIEST, 'priest', [GUARDIAN]); put(PRIEST, 'private.dboScribeTome', { at: wallClock - DAY, rank: 3, spell: EBONY.spell });
pick(W, `t:${GUARDIAN.spell}`);
check('...nor one whose own tome writing is still waiting', /needs a co-writer/.test(said(W)));
put(PRIEST, 'private.dboScribeTome', null);
m = pick(W, `t:${GUARDIAN.spell}`);
check('...a Master Priest who knows Guardian Circle and is ready is offered', m.actions.some((x) => x.id === `h:${PRIEST.toString(16)}:${GUARDIAN.spell}`), m.actions);
pick(W, `h:${PRIEST.toString(16)}:${GUARDIAN.spell}`);
at(PRIEST, BRUMA);
ui('scribeHelp', PRIEST, ['accept'], 93);
check('a co-writer who walked away before accepting: nothing written', count(W, idOf(GUARDIAN.book)) === 0 && count(W, SC.guardian) === 5 && /must stand within 10 m/.test(said(W)), said(W));
at(PRIEST, SYNOD);

// Refusals: an unknown spell, walking away
wallClock += 15 * DAY;
list(W, 'tome');
pick(W, `t:${SPARKS.spell}`);
check('a tome of a spell the writer does not know is refused in chat', /you do not know Sparks/.test(said(W)) && count(W, idOf(SPARKS.book)) === 0, said(W));
pick(W, `t:${RAISEZ.spell}`);
check('a restricted art below Senior is refused in chat', /Raise Zombie cannot be written: Raising the dead/.test(said(W)), said(W));
member(W, 'synod', 'Senior Magister');
check('...a Senior rank may write it', allRows(W, 'tome').some((x) => x.id === `t:${RAISEZ.spell}`));
at(W, BRUMA);
const flamesBefore = count(W, idOf(FLAMES.book));
pick(W, `t:${FLAMES.spell}`);
check('walking away from the ledger closes the list, nothing written', /walked away from the ledger/.test(said(W)) && count(W, idOf(FLAMES.book)) === flamesBefore && out.closed.some((c) => c[0] === W && c[1] === 93));
at(W, SYNOD);

// Refund: the tome cannot be given
items(W, [[SC.oak, 2], [SC.candle, 1, { name: 'Marked' }]]);
list(W, 'tome');
giveFails = true;
pick(W, `t:${FIREBALL.spell}`);
giveFails = false;
check('a tome that cannot be given puts the scrolls back, entries as they were, and no wait starts', count(W, SC.oak) === 2 && count(W, SC.candle) === 1 && (getp(W, 'inventory').entries.find((e) => e.baseId === SC.candle) || {}).name === 'Marked' && globalThis.__dboScribingBrief(W).tome === 'ready' && count(W, idOf(FIREBALL.book)) === 0, [getp(W, 'inventory'), said(W)]);
check('...said and audited', /could not be handed to you, and your materials are back in your pack/.test(said(W)) && /SCRIBE FAILED P14: Spell Tome: Fireball could not be given; materials returned/.test(lastAudit(/SCRIBE FAILED/)), [said(W), lastAudit(/SCRIBE FAILED/)]);

// ---- scrolls -----------------------------------------------------------------------------------------------------------------
const sRows = allRows(W, 'scroll');
const sHas = (t) => sRows.some((x) => x.id === `s:${t.spell}`);
check('the scroll list: known spells with a scroll below Master (Candlelight, Oakflesh, Firebolt, Fireball, Ebonyflesh)', [CANDLE, OAK, FIREBOLT, FIREBALL, EBONY].every(sHas), sRows.map((x) => x.label));
check('...not Flames (no scroll exists) nor a Master spell', !sHas(FLAMES) && !sHas(FIRESTORM));
check('...rows name the materials', /Firebolt \(Destruction, Apprentice\): 1 Linen Wrap, 1 Charcoal and 1 filled soul gem - ready/.test((sRows.find((x) => x.id === `s:${FIREBOLT.spell}`) || {}).label), sRows.map((x) => x.label));
items(W, [[LINEN, 1], [GEM.pettyEmpty, 2], [GEM.greaterEmpty, 1]]);
list(W, 'scroll');
pick(W, `s:${FIREBOLT.spell}`);
check('missing materials are named exactly; an empty gem is no filled gem', /A scroll needs 1 Linen Wrap, 1 Charcoal and 1 filled soul gem; you are missing Charcoal and a filled soul gem\./.test(said(W)) && count(W, LINEN) === 1, said(W));
items(W, [[LINEN, 2], [CHARCOAL, 2], [GEM.grand, 1], [GEM.greaterEmpty, 1, { soul: 4 }], [GEM.lesser, 1], [GEM.pettyEmpty, 3]]);
pick(W, `s:${FIREBOLT.spell}`);
check('a scroll is written: 1 Linen Wrap, 1 Charcoal and the smallest filled gem (Lesser) spent', count(W, SC.firebolt) === 1 && count(W, LINEN) === 1 && count(W, CHARCOAL) === 1 && count(W, GEM.lesser) === 0 && count(W, GEM.grand) === 1 && count(W, GEM.greaterEmpty) === 1 && count(W, GEM.pettyEmpty) === 3, getp(W, 'inventory'));
check('...said, with the wait (2 days for Apprentice)', /You write a scroll of Firebolt\. 1 Linen Wrap, 1 Charcoal and 1 filled soul gem are spent\. Your next scroll can be written in 2 d\./.test(said(W)), said(W));
check('...audited with the materials', /^SCRIBE SCROLL P14 wrote 96598:Skyrim\.esm Firebolt \(Apprentice\) spending 1 x 34cd6:Skyrim\.esm, 1 x 33760:Skyrim\.esm, 1 x 2e4e5:Skyrim\.esm$/.test(lastAudit(/SCRIBE SCROLL/)), lastAudit(/SCRIBE SCROLL/));
check('the scroll timer is its own: tome writing stays ready', globalThis.__dboScribingBrief(W).tome === 'ready' && globalThis.__dboScribingBrief(W).scroll === 'in 2 d');
pick(W, `s:${CANDLE.spell}`);
check('one scroll timer: a Novice scroll waits too, refused in chat', /You wrote a scroll not long ago; your next can be written in 2 d\./.test(said(W)) && count(W, SC.candle) === 0, said(W));
wallClock += 2 * DAY + MIN;
pick(W, `s:${CANDLE.spell}`);
check('a gem filled in play (an empty base holding a soul) counts once the pre-filled ones are smaller... the Greater soul (4) goes before the Grand', count(W, SC.candle) === 1 && count(W, GEM.greaterEmpty) === 0 && count(W, GEM.grand) === 1, getp(W, 'inventory'));
wallClock += DAY - HOUR;
check('...a Novice scroll waits 1 day', globalThis.__dboScribingBrief(W).scroll === 'in 1 h', globalThis.__dboScribingBrief(W));
wallClock += HOUR + MIN;
const scrollWaitAfter = (t, days) => {
  items(W, [[LINEN, 1], [CHARCOAL, 1], [GEM.black, 1]]);
  pick(W, `s:${t.spell}`);
  const ok = count(W, scrollOf(t)) >= 1 && globalThis.__dboScribingBrief(W).scroll === `in ${days} d`;
  wallClock += days * DAY + MIN;
  return ok;
};
check('an Adept scroll (Fireball) takes a black filled gem and waits 3 days', scrollWaitAfter(FIREBALL, 3), said(W));
check('an Expert scroll (Ebonyflesh) waits 4 days', scrollWaitAfter(EBONY, 4), said(W));
study(W, 'arcane', [FLAMES, CANDLE, OAK, FIREBOLT, FIREBALL, EBONY, RAISEZ, FIRESTORM]);
items(W, [[LINEN, 1], [CHARCOAL, 1], [GEM.black, 1]]);
list(W, 'scroll');
pick(W, `s:${FIRESTORM.spell}`);
check('a Master scroll cannot be written, even of a spell known', /Master scrolls cannot be written\./.test(said(W)) && count(W, SC.firestorm) === 0, said(W));
pick(W, `s:${SPARKS.spell}`);
check('a spell with no scroll cannot have one written', /has no scroll|cannot be written/.test(said(W)), said(W));
list(W, 'scroll');
pick(W, `s:${GUARDIAN.spell}`);
check('a scroll of a spell the writer does not know is refused', /Master scrolls cannot be written|you do not know/.test(said(W)), said(W));
const OAKS = scrollOf(OAK);
giveFails = true;
items(W, [[LINEN, 1], [CHARCOAL, 1], [GEM.pettyEmpty, 1, { soul: 1 }]]);
pick(W, `s:${OAK.spell}`);
giveFails = false;
check('a scroll that cannot be given puts the Linen Wrap, Charcoal and the gem (with its soul) back; no wait', count(W, OAKS) === 0 && count(W, LINEN) === 1 && count(W, CHARCOAL) === 1 && (getp(W, 'inventory').entries.find((e) => e.baseId === GEM.pettyEmpty) || {}).soul === 1 && globalThis.__dboScribingBrief(W).scroll === 'ready', getp(W, 'inventory'));

// ---- the timers survive a reload and a restart ------------------------------------------------------------------------------
pick(W, `s:${OAK.spell}`);
items(W, []); list(W, 'tome'); pick(W, `t:${FLAMES.spell}`);
const before = globalThis.__dboScribingBrief(W);
delete globalThis.__dboScribing; load();
check('after a reload (and its in-memory state gone) both timers hold, read from the character', JSON.stringify(globalThis.__dboScribingBrief(W)) === JSON.stringify(before) && before.tome === 'in 1 d' && before.scroll === 'in 1 d', [before, globalThis.__dboScribingBrief(W)]);
check('...kept on the character as private.dboScribeTome / private.dboScribeScroll', getp(W, 'private.dboScribeTome').rank === 0 && getp(W, 'private.dboScribeScroll').rank === 0);
// spells.js's per-rank record of 16 Oct carries over until a tome is written here
put(EXPERT, 'private.dboTomeWrites', { 1: wallClock - DAY, 3: wallClock - 2 * DAY });
skillAt(EXPERT, 'scholar', 95);
check('an old per-rank record (Expert 2 days ago) gives the shared wait under today\'s hours (5 days left)', globalThis.__dboScribingBrief(EXPERT).tome === 'in 5 d', globalThis.__dboScribingBrief(EXPERT));
skillAt(EXPERT, 'scholar', 80);

// ---- the F3 Skills tab's Scholar page ---------------------------------------------------------------------------------------
globalThis.__alduinakMasteryMenu = () => ({ skills: [{ id: 'scholar', description: 'Only a Scholar may read the books of the world.' }, { id: 'arcane', description: 'Magic.' }] });
let page = globalThis.__dboJournalSections.skills.view(W, {});
check('F3: a Master Scholar\'s Scholar page carries both timers', page.skills[0].description === 'Only a Scholar may read the books of the world. Tome writing: in 1 d. Scroll writing: in 1 d.' && page.skills[1].description === 'Magic.', page.skills);
page = globalThis.__dboJournalSections.skills.view(EXPERT, {});
check('...an Expert Scholar\'s does not', page.skills[0].description === 'Only a Scholar may read the books of the world.', page.skills);

// ---- config -----------------------------------------------------------------------------------------------------------------
load(Object.assign(baseCfg(), { scribing: Object.assign({}, CONFIG.scribing, { tome: { scrolls: [0, 1] }, scroll: { enabled: false } }) }));
check('config: a bad tome.scrolls falls back to the default and is logged', out.logs.some((l) => /tome\.scrolls \[0,1\] is not 5 numbers/.test(l)));
check('...scroll.enabled false drops the scroll row', JSON.stringify(globalThis.__dboScribingActions(W).map((r) => r.id)) === '["scribe:tome"]');
load();
check('gamemode-config.json says what the design says', JSON.stringify(CONFIG.scribing.tome.scrolls) === '[0,1,2,4,5]' && JSON.stringify(CONFIG.scribing.tome.cooldownHours) === '[24,48,96,168,336]'
  && JSON.stringify(CONFIG.scribing.scroll.cooldownHours) === '[24,48,72,96]' && CONFIG.scribing.scholarTier === 4 && CONFIG.scribing.scroll.soulGems === 1);
check('the filled gem ids in config are the plugins\' filled gems (spell-scrolls.json soulGems, SOUL 1-5)', CONFIG.scribing.scroll.filledGems.every((d) => { const g = SCROLLS.soulGems.find((x) => x.id === d); return g && g.soul >= 1 && /Filled$/.test(g.edid); }));
check('...and each empty gem fills into one of them (NAM0)', CONFIG.scribing.scroll.emptyGems.every((d) => { const g = SCROLLS.soulGems.find((x) => x.id === d); return g && g.soul === 0 && CONFIG.scribing.scroll.filledGems.includes(g.filledBase); }));

// ---- colleges in schools.js (guild-defs.json "college": true) ----------------------------------------------------------------
check('guild-defs.json marks the Synod, the College of Winterhold and the College of Whispers as colleges', ['synod', 'college-of-winterhold', 'college-of-whispers'].every((id) => GUILDS.find((f) => f.id === id).college === true) && GUILDS.filter((f) => f.college).length === 3);
skillAt(PLAIN, 'arcane', 80);
// The tracked config asks for a client that draws the panels (requireClient): this one says it does
globalThis.__dboSpellbookCaps.set(PLAIN, new Set(['schools']));
const lecternWhy = (a) => { const n = out.widgets.length; globalThis.__dboSchoolsActivate(LECTERN, a); const w = out.widgets.length > n ? lastWidget(a, 'classLectern') : null; return w ? String(w.whyNot || '') : 'no panel'; };
const FG_OFFICER = GUILDS.find((f) => f.id === 'fighters-guild').ranks.find((r) => r.role === 'officer').title;
member(PLAIN, 'fighters-guild', FG_OFFICER);
check('a Class Lectern: an officer of a guild that is no college may not teach', /held by a member of|leader or an officer/.test(lecternWhy(PLAIN)), lecternWhy(PLAIN));
member(PLAIN, 'college-of-the-test', 'Reader');
check('...an officer of a college not named in teacherGuilds may (read from guild-defs.json)', ((w) => w !== 'no panel' && !/held by a member of|leader or an officer/.test(w))(lecternWhy(PLAIN)), lecternWhy(PLAIN));
globalThis.__dboGuildIsCollege = (id) => id === 'east-empire';
put(PLAIN, 'private.dboGuilds', [{ id: 'east-empire', rank: 1, role: 'officer' }]);
check('...guilds.js\'s answer wins when it is there (a player-founded college)', ((w) => w !== 'no panel' && !/held by a member of|leader or an officer/.test(w))(lecternWhy(PLAIN)), lecternWhy(PLAIN));
delete globalThis.__dboGuildIsCollege;
const schoolsSrc = fs.readFileSync(F('schools.js'), 'utf8');
check('schools.js keeps its named lists and adds collegeGuilds to both', /seniorGuilds: \['synod', 'college-of-winterhold', 'college-of-whispers'/.test(schoolsSrc) && (schoolsSrc.match(/collegeGuilds: true/g) || []).length === 2);

console.log(`\n${checks - failures}/${checks} passed`);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
process.exit(failures ? 1 : 0);
